/**
 * passGraph.ts — compiling a graph that has Pass nodes (docs/pass-node-plan.md).
 *
 * A graph with no Pass node never comes here: compileGraph checks hasPassNode
 * first and otherwise runs exactly as it always has.
 *
 * A graph with Pass nodes is cut at them into several smaller graphs, and each
 * one goes through the ordinary compiler (topologicalSort →
 * generateFragmentShader) unchanged:
 *
 *  - one program per Pass: the Pass's input ancestors, stopping at other Pass
 *    nodes, ending in a passOutput node wired to the Pass's colour and alpha;
 *  - the final program: every top-level node except those only Pass inputs
 *    need, ending in the graph's Output.
 *
 * In every program an upstream Pass node is replaced by a copy with no
 * inputs: compiled as a source it reads its texture (nodes/definitions/
 * passes.ts). That also cuts the one legal cycle, a Pass's Previous output
 * feeding back into its own input, before topologicalSort sees the list.
 *
 * Slugs are worked out once for the whole graph and handed to every program
 * (ShaderAssemblerOptions.slugs), so a node's uniforms have the same name in
 * every program it lands in: one uniform table drives them all.
 */
import type { GraphNode, NodeGraph } from '../types/nodeGraph';
import type { AgentDepositProgram, AgentDrawProgram, AgentGroupProgram, AgentParam, AgentTrailProgram, CompilationResult, PassProgram } from './types';
import { VERTEX_SHADER } from './types';
import { topologicalSort } from './topoSort';
import { validateGraph } from './validate';
import { generateFragmentShader } from './shaderAssembler';
import { computeNodeSlug } from './nodeSlug';
import { PASS_SCALES, passRepeat } from '../nodes/definitions/passes';
import { getNodeDefinition, getNodeDefinitionFor } from '../nodes/definitions';
import { isAgent3d, syncAgentSpaces, trailUniform, withAgentSpace } from '../nodes/definitions/agents';
import {
  agentStepNodes, asAgentSource, checkProgramWires, depositSpec, depositTargets, drawProbeSink, drawSeesScene, drawSpec, emitMode, engineParams, gridSink, groupSide, groupSpecies, toProbeCamera,
  groupSound, hasAgentsNode, insideSlugs, isAgentEngineOnly, isAgentLoopWire, isAgentSource, listenersOf, MAX_AGENT_GROUPS, MAX_TRAILS, trailHasStepProgram, trailSpec, trailStepSink,
} from './agentGraph';
import { agentPlacementProblems, agentProgramProblems } from './agentRules';
import { expandPassGroups } from './passGroups';
import { FINAL, planHiddenBlurs } from './hiddenBlurs';
import { GRID_TYPE, expandGridRules } from './gridRulesExpand';
import { expandCurveBeams, isBeamTrace } from './curveBeamExpand';

export const PASS_TYPE = 'pass';
/** Most Pass nodes in one graph. */
export const MAX_PASSES = 8;
/** WebGL2 guarantees 16 texture units per fragment shader. */
export const MAX_SAMPLERS = 16;

type Sub = { nodes?: GraphNode[] } | undefined;

/** Does the graph have a Pass node (at the top level or inside a group)? */
export function hasPassNode(nodes: GraphNode[]): boolean {
  for (const n of nodes) {
    // A Grid Rules node is opened into a board Pass (compiler/gridRulesExpand.ts).
    // So is a Curve Trace in Draw: Beam, into its screen Pass (compiler/curveBeamExpand.ts).
    if (n.type === PASS_TYPE || n.type === GRID_TYPE || isBeamTrace(n)) return true;
    const sg = n.params?.subgraph as Sub;
    if (sg?.nodes && hasPassNode(sg.nodes)) return true;
  }
  return false;
}

function failure(errors: string[]): CompilationResult {
  return {
    vertexShader: '', fragmentShader: '', success: false, errors,
    nodeOutputVars: new Map(), paramUniforms: {}, paramBindings: {}, textureUniforms: {},
    audioUniforms: {}, liveUniforms: {}, videoUniforms: {}, isStateful: false,
  };
}

/** A Pass as a source: no inputs, so it reads its texture (and never joins a cycle). */
function asSource(pass: GraphNode): GraphNode {
  return { ...pass, inputs: {}, bypassed: false };
}

const sel = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : fallback) as T;

interface Collected {
  /** Graph nodes in the program (Pass nodes as sources included). */
  nodes: Map<string, GraphNode>;
  /** Pass ids sampled this frame / from the frame before. */
  reads: Set<string>;
  readsPrevious: Set<string>;
  /** Trail field and Draw agents ids sampled (graphs with agents only; see agentGraph.ts). */
  agentReads?: Set<string>;
}

/**
 * The ancestors of `starts` (input wires), stopping at Pass nodes, which
 * join as sources. `self` is the Pass whose program this is: reaching it
 * through anything but its Previous output is a loop.
 */
function collect(starts: Array<{ nodeId: string; outputKey: string }>, byId: Map<string, GraphNode>, self: string | null, into?: Collected, agents = false): Collected {
  const out: Collected = into ?? { nodes: new Map(), reads: new Set(), readsPrevious: new Set() };
  const stack = [...starts];
  while (stack.length) {
    const c = stack.pop()!;
    const src = byId.get(c.nodeId);
    if (!src) continue;
    if (agents) {
      // Trail field and Draw agents join as sources (Draw keeps its Over picture); the engine-only
      // nodes (group, Deposit, Emit) are never part of a picture program.
      if (isAgentEngineOnly(src)) continue;
      if (isAgentSource(src)) {
        (out.agentReads ??= new Set()).add(src.id);
        if (out.nodes.has(src.id)) continue;
        const source = asAgentSource(src);
        out.nodes.set(src.id, source);
        for (const inp of Object.values(source.inputs)) if (inp.connection) stack.push(inp.connection);
        continue;
      }
    }
    if (src.type === PASS_TYPE) {
      if (c.outputKey === 'previous') out.readsPrevious.add(src.id);
      else if (isStepKey(c.outputKey)) { /* Repeat's Step / Steps: a uniform and a number, not a read */ }
      else {
        if (src.id === self) throw new Error(`Node ${src.id}: this loop feeds a Pass its own picture; wire its Previous output instead`);
        out.reads.add(src.id);
      }
      if (!out.nodes.has(src.id)) out.nodes.set(src.id, asSource(src));
      continue;
    }
    if (out.nodes.has(src.id)) continue;
    out.nodes.set(src.id, src);
    for (const inp of Object.values(src.inputs)) if (inp.connection) stack.push(inp.connection);
  }
  return out;
}

/**
 * The outer nodes compiled into a group's update shader: everything upstream
 * of its ports and its Emit chain. Emits are included (their code is the
 * births); Trails, Draws and Passes join as sources.
 */
function collectOuter(starts: Array<{ nodeId: string; outputKey: string }>, byId: Map<string, GraphNode>): Collected {
  const out: Collected = { nodes: new Map(), reads: new Set(), readsPrevious: new Set() };
  const stack = [...starts];
  const emits: Array<{ nodeId: string; outputKey: string }> = [];
  // Emits first (they are engine-only to every other program), then the ordinary ancestors of everything.
  while (stack.length) {
    const c = stack.pop()!;
    const src = byId.get(c.nodeId);
    if (src?.type !== 'agentEmit' || out.nodes.has(src.id)) { emits.push(c); continue; }
    out.nodes.set(src.id, src);
    for (const inp of Object.values(src.inputs)) if (inp.connection) stack.push(inp.connection);
  }
  return collect(emits, byId, null, out, true);
}

/** A Pass's Step and Steps outputs (Repeat): read anywhere, even inside its own program; never a texture read. */
const isStepKey = (k: string) => k === 'step' || k === 'steps';

const wiresOf = (n: GraphNode) => Object.values(n.inputs).flatMap(i => (i.connection ? [i.connection] : []));

/** Kahn's sort of the passes by what they sample this frame; null on a loop. */
function orderPasses(ids: string[], reads: Map<string, Set<string>>): string[] | null {
  const deg = new Map(ids.map(id => [id, 0]));
  const users = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const id of ids) for (const r of reads.get(id) ?? []) { if (!deg.has(r)) continue; deg.set(id, deg.get(id)! + 1); users.get(r)!.push(id); }
  const queue = ids.filter(id => deg.get(id) === 0);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const u of users.get(id)!) { deg.set(u, deg.get(u)! - 1); if (deg.get(u) === 0) queue.push(u); }
  }
  return out.length === ids.length ? out : null;
}

const countSamplers = (fs: string) => (fs.match(/^uniform sampler2D \w+;/gm) ?? []).length;

export function compilePassGraph(graph: NodeGraph): CompilationResult {
  try {
    // Agents-family nodes (agentGraph.ts) add their own programs; without one, everything below runs as it always has.
    const agents = hasAgentsNode(graph.nodes);
    if (agents) {
      const placement = agentPlacementProblems(graph.nodes, getNodeDefinitionFor);
      if (placement.length) return failure(placement);
    }
    // A Pass inside a plain group (phase 7): the group is opened onto the top level for the cut
    // (compiler/passGroups.ts). Inside any other kind of group, an error saying why.
    const opened = expandPassGroups(graph.nodes);
    if ('errors' in opened) return failure(opened.errors);
    // Grid Rules nodes: each opened into its board Pass and step (compiler/gridRulesExpand.ts); without one, unchanged.
    const gridOnly = expandGridRules(opened.nodes);
    // Curve Trace in Draw: Beam: each opened into its screen Pass and step (compiler/curveBeamExpand.ts); without one, unchanged.
    const beams = expandCurveBeams(gridOnly.nodes);
    const grid = beams.bindAs.size ? { nodes: beams.nodes, bindAs: new Map([...gridOnly.bindAs, ...beams.bindAs]) } : gridOnly;
    // With agents: every node of (or wired into) a 3D group marked for its space (a 2D graph is left as it is).
    const nodes = agents ? syncAgentSpaces(grid.nodes, getNodeDefinition) : grid.nodes;

    const validation = validateGraph(nodes);
    if (!validation.valid) return failure(validation.errors ?? ['Invalid graph']);

    const passNodes = nodes.filter(n => n.type === PASS_TYPE);
    if (passNodes.length > MAX_PASSES) return failure([`A graph can have up to ${MAX_PASSES} Pass nodes (this one has ${passNodes.length}${gridOnly.bindAs.size ? ', counting each Grid Rules board, and its picture when its Texture is wired' : ''}${beams.bindAs.size ? ', counting each Curve Trace Beam\'s screen' : ''})`]);
    const byId = new Map(nodes.map(n => [n.id, n]));

    // 1. Slugs, once for the whole graph, in the usual sort order (Previous wires left out, so feedback isn't a cycle;
    //    with agents, the wires out of a group, Deposit or Emit too, so a Trail read back by its group isn't one either).
    const cut = (c: { nodeId: string; outputKey: string } | undefined) => !!c && (
      ((c.outputKey === 'previous' || isStepKey(c.outputKey)) && byId.get(c.nodeId)?.type === PASS_TYPE) || (agents && isAgentLoopWire(c, byId)));
    const withoutPrevious = nodes.map(n => {
      const wires = Object.entries(n.inputs);
      if (!wires.some(([, i]) => cut(i.connection))) return n;
      return { ...n, inputs: Object.fromEntries(wires.map(([k, i]) => [k, cut(i.connection) ? { ...i, connection: undefined } : i])) };
    });
    let sortedAll: GraphNode[];
    try { sortedAll = topologicalSort(withoutPrevious); } catch {
      return failure(['This graph has a loop. A loop through a Pass must come out of its Previous output (the picture from the frame before).']);
    }
    const used = new Set<string>();
    const slugs = new Map<string, string>();
    for (const n of sortedAll) slugs.set(n.id, computeNodeSlug(n, used));
    // A Grid Rules node's step (and picture copy) compile under its slug: its params are one set of uniforms.
    for (const [id, as] of grid.bindAs) { const sl = slugs.get(as); if (sl) slugs.set(id, sl); }
    const groupNodes = agents ? sortedAll.filter(n => n.type === 'agentsGroup').map(n => byId.get(n.id)!) : [];
    if (agents) {
      if (groupNodes.length > MAX_AGENT_GROUPS) return failure([`A graph can have up to ${MAX_AGENT_GROUPS} Agents groups (this one has ${groupNodes.length})`]);
      const trailCount = nodes.filter(n => n.type === 'trailField').length;
      if (trailCount > MAX_TRAILS) return failure([`A graph can have up to ${MAX_TRAILS} Trail fields (this one has ${trailCount})`]);
      insideSlugs(groupNodes, used, slugs);
    }

    // 2. One node list per program.
    const passLists = new Map<string, Collected>();
    for (const p of passNodes) passLists.set(p.id, collect(wiresOf(p), byId, p.id, undefined, agents));
    const output = nodes.find(n => n.type === 'output' || n.type === 'vec4Output')!;
    const outputAncestors = collect(wiresOf(output), byId, null, undefined, agents);
    // Each group's update shader: its inside plus the outer nodes wired into its ports and Emit.
    const agentLists = new Map<string, { inside: GraphNode[]; sink: GraphNode; outer: Collected; problems: string[]; stateC: boolean; space3d: boolean; grids: Array<{ nodeId: string; from: { nodeId: string; outputKey: string } }> }>();
    // A Trail filled by a 3D group is a volume: a 3D group's Sense reads it by its layout uniform.
    const volumeOf = (id: string) => { const t = byId.get(id); return t?.type === 'trailField' && isAgent3d(t) ? trailUniform(slugs.get(id) ?? id) : null; };
    for (const g of groupNodes) {
      const { inner, sink, starts, problems, stateC, space3d, grids } = agentStepNodes(g, volumeOf);
      const outer = collectOuter(starts, byId);
      // With per-walker state the Emits also say which species they give birth to (a copy, marked for this program).
      if (stateC) for (const [id, n] of outer.nodes) if (n.type === 'agentEmit') outer.nodes.set(id, { ...n, params: { ...n.params, __stateC: true } });
      // The Emits give birth in this group's space (a copy, for this program).
      for (const [id, n] of outer.nodes) if (n.type === 'agentEmit' && isAgent3d(n) !== space3d) outer.nodes.set(id, withAgentSpace(n, space3d, getNodeDefinition));
      agentLists.set(g.id, { inside: inner, sink, outer, problems, stateC, space3d, grids });
    }
    // Trails with Add / Block wired: their step program's nodes (the ancestors of those inputs).
    const trailLists = new Map<string, Collected>();
    if (agents) for (const t of nodes) {
      if (t.type !== 'trailField' || !trailHasStepProgram(t)) continue;
      trailLists.set(t.id, collect([t.inputs.add?.connection, t.inputs.block?.connection].filter((c): c is { nodeId: string; outputKey: string } => !!c), byId, null, undefined, true));
    }
    const onlyForPasses = new Set<string>();
    for (const c of passLists.values()) for (const [id, n] of c.nodes) if (n.type !== PASS_TYPE && !outputAncestors.nodes.has(id)) onlyForPasses.add(id);
    for (const a of agentLists.values()) for (const [id, n] of a.outer.nodes) if (!isAgentSource(n) && n.type !== PASS_TYPE && !outputAncestors.nodes.has(id)) onlyForPasses.add(id);
    for (const c of trailLists.values()) for (const [id, n] of c.nodes) if (!isAgentSource(n) && n.type !== PASS_TYPE && !outputAncestors.nodes.has(id)) onlyForPasses.add(id);
    // A node the final program keeps (one wired to nothing, such as a Particles node left beside its
    // Open-as-nodes copy) needs what it reads there too, even when that also feeds a Pass or a group.
    if (onlyForPasses.size) {
      const stack = nodes.filter(n => n.type !== PASS_TYPE && !onlyForPasses.has(n.id) && !(agents && (isAgentEngineOnly(n) || isAgentSource(n))));
      const seen = new Set(stack.map(n => n.id));
      while (stack.length) {
        for (const c of wiresOf(stack.pop()!)) {
          const s = byId.get(c.nodeId);
          if (!s || seen.has(s.id) || s.type === PASS_TYPE || (agents && (isAgentEngineOnly(s) || isAgentSource(s)))) continue;
          seen.add(s.id);
          onlyForPasses.delete(s.id);
          stack.push(s);
        }
      }
    }
    const finalList: Collected = { nodes: new Map(), reads: new Set(), readsPrevious: new Set() };
    for (const n of nodes) {
      if (n.type === PASS_TYPE || onlyForPasses.has(n.id)) continue;
      if (agents && isAgentEngineOnly(n)) continue;
      finalList.nodes.set(n.id, agents && isAgentSource(n) ? asAgentSource(n) : n);
    }
    // Pass nodes the final program's nodes sample join it as sources.
    for (const n of [...finalList.nodes.values()]) {
      for (const c of wiresOf(n)) {
        const src = byId.get(c.nodeId);
        if (src?.type !== PASS_TYPE) continue;
        if (!isStepKey(c.outputKey)) (c.outputKey === 'previous' ? finalList.readsPrevious : finalList.reads).add(src.id);
        if (!finalList.nodes.has(src.id)) finalList.nodes.set(src.id, asSource(src));
      }
    }

    // 3. Drawing order, and which passes the picture needs at all.
    const order = orderPasses(passNodes.map(p => p.id), new Map([...passLists].map(([id, c]) => [id, c.reads])));
    if (!order) return failure(['These Pass nodes sample each other in a loop. A loop between passes must come out of a Previous output.']);
    const live = new Set<string>();
    const visit = (id: string) => {
      if (live.has(id)) return;
      live.add(id);
      const c = passLists.get(id)!;
      for (const r of [...c.reads, ...c.readsPrevious]) visit(r);
    };
    for (const r of [...finalList.reads, ...finalList.readsPrevious]) visit(r);
    // With agents: what the picture needs, through passes, trails, drawings and groups (a fixpoint).
    const depositTo = agents ? depositTargets(nodes) : new Map<string, string>();
    const liveAgents = new Set<string>();
    if (agents) {
      const groupOf = (id: string) => byId.get(id)?.inputs.agents?.connection?.nodeId;
      const queue: string[] = [...live, ...(outputAncestors.agentReads ?? [])];
      const seen = new Set<string>();
      while (queue.length) {
        const id = queue.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const n = byId.get(id);
        if (!n) continue;
        if (n.type === PASS_TYPE) {
          live.add(id);
          const c = passLists.get(id)!;
          queue.push(...c.reads, ...c.readsPrevious, ...(c.agentReads ?? []));
        } else if (n.type === 'trailField') {
          liveAgents.add(id);
          for (const [dep, trail] of depositTo) if (trail === id) { const g = groupOf(dep); if (g) queue.push(g); }
          const c = trailLists.get(id);
          if (c) queue.push(...c.reads, ...c.readsPrevious, ...(c.agentReads ?? []));
        } else if (n.type === 'drawAgents') {
          liveAgents.add(id);
          const g = groupOf(id);
          if (g) queue.push(g);
        } else if (n.type === 'agentsGroup') {
          liveAgents.add(id);
          const a = agentLists.get(id);
          if (a) queue.push(...a.outer.reads, ...a.outer.readsPrevious, ...(a.outer.agentReads ?? []));
        }
      }
    }
    // A pass that samples a trail or a drawing (directly or through earlier passes) draws after the agents step.
    const afterAgents = new Set<string>();
    if (agents) for (const id of order) {
      const c = passLists.get(id)!;
      if ((c.agentReads?.size ?? 0) > 0 || [...c.reads, ...c.readsPrevious].some(r => afterAgents.has(r))) afterAgents.add(id);
    }
    // Passes a Particles node reads (wired into it, except Over and UV: the picture it is laid on), and the
    // passes those read, draw before the particles step (phase 6: Emit from, and a Flow or Obstacle read
    // through a pass), so the engine sees this frame's texture. A pass that itself has a Particles node, or
    // draws after the agents, can't: the particles then read its previous frame. Without a Particles node
    // reading a pass, nothing is marked and the frame runs as it always has.
    const beforeParticles = new Set<string>();
    const particleNodes = nodes.filter(nd => nd.type === 'gpuParticles');
    if (particleNodes.length) {
      const starts = particleNodes.flatMap(pn => Object.entries(pn.inputs)
        .filter(([k, i]) => !!i.connection && k !== 'over' && k !== 'uv').map(([, i]) => i.connection!));
      const reached = collect(starts, byId, null, undefined, agents);
      const canBefore = (id: string): boolean => {
        const c = passLists.get(id);
        if (!c || afterAgents.has(id)) return false;
        if ([...c.nodes.values()].some(x => x.type === 'gpuParticles')) return false;
        return [...c.reads].every(canBefore);
      };
      const mark = (id: string) => {
        if (beforeParticles.has(id) || !canBefore(id)) return;
        beforeParticles.add(id);
        for (const r of passLists.get(id)!.reads) mark(r);
      };
      for (const r of reached.reads) mark(r);
    }
    const previousRead = new Set<string>();
    for (const c of [finalList, ...passLists.values()]) for (const r of c.readsPrevious) previousRead.add(r);

    // 4. Compile each list with today's compiler.
    const compileList = (list: GraphNode[], pictureScale?: number) => generateFragmentShader(topologicalSort(list), list, {
      slugs,
      // A pass program's size relative to the picture (read only by a wired Texture Input / Video Texture).
      ...(pictureScale !== undefined && pictureScale !== 1 ? { pictureScale } : {}),
      // The eye preview of a node inside an Agents group: its chain is in this picture (agentEyeNodes).
      ...(agents && list.some(n => n.params?.__agentEye === true) ? { agentEye: true } : {}),
    });
    const errors: string[] = [];
    const passes: PassProgram[] = [];
    // Each pass program's node variables (probes, scopes: a node only a pass draws is read from that program).
    const passVars = new Map<string, Record<string, string>>();
    const merged = {
      paramUniforms: {} as Record<string, number | number[]>, paramBindings: {} as Record<string, string>,
      textureUniforms: {} as Record<string, string>, audioUniforms: {} as Record<string, string>,
      liveUniforms: {} as Record<string, string>, videoUniforms: {} as Record<string, string>,
      isStateful: false, echo: null as { copies: number; delay: number } | null,
      mlgDynamicOutputs: new Map<string, Record<string, { type: string; label: string }>>(),
    };
    const absorb = (r: ReturnType<typeof compileList>) => {
      Object.assign(merged.paramUniforms, r.paramUniforms);
      Object.assign(merged.paramBindings, r.paramBindings);
      Object.assign(merged.textureUniforms, r.textureUniforms);
      Object.assign(merged.audioUniforms, r.audioUniforms);
      Object.assign(merged.liveUniforms, r.liveUniforms);
      Object.assign(merged.videoUniforms, r.videoUniforms);
      merged.isStateful ||= r.isStateful;
      for (const [k, v] of r.mlgDynamicOutputs) merged.mlgDynamicOutputs.set(k, v);
      if (r.echo && (!merged.echo || r.echo.copies > merged.echo.copies)) merged.echo = { copies: r.echo.copies, delay: merged.echo?.delay ?? r.echo.delay };
    };
    // 3b. Blur and Glow (texture), Smooth and Bloom chain: their hidden passes (compiler/blurPasses.ts),
    // drawn just before the first program that has the node. Without such a node nothing here runs.
    const hidden = planHiddenBlurs({
      nodes, byId, slugs, order, passLists, finalList, agents, afterAgents, beforeParticles, live, compileList, absorb,
      collect: starts => collect(starts, byId, null, undefined, agents),
    });
    errors.push(...hidden.errors);
    for (const id of order) {
      const pass = byId.get(id)!;
      const c = passLists.get(id)!;
      const sink: GraphNode = {
        id: `${id}__out`, type: 'passOutput', position: { x: 0, y: 0 }, params: {}, outputs: {},
        inputs: {
          color: { type: 'vec3', label: 'Color', ...(pass.inputs.color?.connection ? { connection: pass.inputs.color.connection } : {}) },
          alpha: { type: 'float', label: 'Alpha', ...(pass.inputs.alpha?.connection ? { connection: pass.inputs.alpha.connection } : { defaultValue: 1 }) },
        },
      };
      const r = compileList(hidden.annotate([...c.nodes.values(), sink], id), PASS_SCALES[String(pass.params.scale ?? '1')] ?? 1);
      absorb(r);
      for (const [nid, vars] of r.nodeOutputVars) if (nid !== sink.id && !passVars.has(nid)) passVars.set(nid, vars);
      const slug = slugs.get(id)!;
      const label = typeof pass.params.label === 'string' && pass.params.label.trim() ? pass.params.label.trim() : 'Pass';
      if (countSamplers(r.fragmentShader) > MAX_SAMPLERS) errors.push(`Node ${id}: ${label} samples more than ${MAX_SAMPLERS} textures (images, videos, passes, feedback) in one program`);
      passes.push(...(hidden.before.get(id) ?? []));
      passes.push({
        nodeId: id, slug, label, fragmentShader: r.fragmentShader,
        reads: [...[...c.reads].map(r2 => slugs.get(r2)!), ...(hidden.reads.get(id) ?? [])], readsPrevious: [...c.readsPrevious].map(r2 => slugs.get(r2)!),
        scale: PASS_SCALES[String(pass.params.scale ?? '1')] ?? 1,
        format: sel(pass.params.format, ['half', 'byte'] as const, 'half'),
        filter: sel(pass.params.filter, ['linear', 'nearest'] as const, 'linear'),
        wrap: sel(pass.params.wrap, ['clamp', 'repeat', 'mirror'] as const, 'clamp'),
        previous: previousRead.has(id), live: live.has(id),
        nodeIds: [...c.nodes.values()].filter(n => n.type !== PASS_TYPE).map(n => n.id),
        ...(agents ? { afterAgents: afterAgents.has(id) } : {}),
        ...(beforeParticles.has(id) ? { beforeParticles: true } : {}),
        ...(passRepeat(pass.params.repeat) > 1 ? { repeat: passRepeat(pass.params.repeat) } : {}),
      });
    }
    // 5. With agents: each group's update shader, and the engine's view of deposits, trails and drawings.
    let agentsSpec: CompilationResult['agents'];
    if (agents) {
      const groups: AgentGroupProgram[] = [];
      const slugOf = (id: string) => slugs.get(id) ?? id;
      const engine = (n: GraphNode) => {
        const e = engineParams(n, slugOf(n.id));
        Object.assign(merged.paramUniforms, e.uniforms);
        Object.assign(merged.paramBindings, e.bindings);
        return e.params;
      };
      for (const g of groupNodes) {
        const a = agentLists.get(g.id)!;
        const label = typeof g.params.label === 'string' && g.params.label.trim() ? g.params.label.trim() : 'Agents';
        const params = engine(g);
        const outer = [...a.outer.nodes.values()];
        const list = [...outer, ...a.inside, a.sink];
        const problems = [
          ...a.problems,
          ...agentProgramProblems(list.filter(n => !isAgentSource(n) && n.type !== PASS_TYPE && !(n.type === 'agentEmit' && a.outer.nodes.has(n.id))), getNodeDefinitionFor),
          ...checkProgramWires(list),
        ];
        if (problems.length) { errors.push(...problems); continue; }
        const seed = params.seed;
        const emit = emitMode(g, byId, slugOf);
        const seedExpr = typeof seed === 'string' ? seed : `${Number(seed ?? 1).toFixed(1)}`;
        // Neighbours: the grid the group builds every step for them (its largest Radius and Max neighbours).
        const nbNodes = a.inside.filter(n => n.type === 'agentNeighbours');
        const nbParams = nbNodes.map(n => engine(n) as Record<string, AgentParam>);
        const r = generateFragmentShader(topologicalSort(list), list, {
          slugs,
          agentProgram: {
            slug: slugOf(g.id), side: groupSide(g), species: groupSpecies(g), seed: seedExpr,
            declarations: typeof seed === 'string' ? [`uniform float ${seed};`] : [],
            respawn: emit.mode === 'respawn',
            ...(a.stateC ? { stateC: true } : {}),
            ...(a.space3d ? { space3d: true } : {}),
            ...(nbNodes.length ? { neighbours: true } : {}),
          },
        });
        absorb(r);
        if (countSamplers(r.fragmentShader) > MAX_SAMPLERS) errors.push(`Node ${g.id}: ${label} samples more than ${MAX_SAMPLERS} textures (its state, trails, passes, images) in one program`);
        // Collide (3D scene): each one's grid program (the Scene outside, compiled as a picture-kind program).
        const grids: NonNullable<AgentGroupProgram['grids']> = [];
        for (const gr of a.grids) {
          const node = a.inside.find(x => x.id === gr.nodeId)!;
          const slug = slugOf(gr.nodeId);
          const c = collect([gr.from], byId, null, undefined, true);
          const list = [...c.nodes.values(), gridSink(gr.nodeId, slug, gr.from)];
          const wires = checkProgramWires(list);
          if (wires.length) { errors.push(...wires); continue; }
          const gp = compileList(list);
          absorb(gp);
          const P = engine(node) as Record<string, AgentParam>;
          grids.push({ nodeId: gr.nodeId, slug, shader: gp.fragmentShader, at: [P.x ?? 0, P.y ?? 0, P.z ?? 0, P.reach ?? 2] });
        }
        groups.push({
          ...(grids.length ? { grids } : {}),
          ...(nbNodes.length ? { neighbours: { radius: nbParams.map(P => P.radius ?? 0.05), max: nbParams.map(P => P.max ?? 36) } } : {}),
          nodeId: g.id, slug: slugOf(g.id), label, fragmentShader: r.fragmentShader,
          side: groupSide(g), species: groupSpecies(g),
          ...(a.stateC ? { stateC: true } : {}),
          ...(a.space3d ? { space3d: true } : {}),
          params: { stepsPerFrame: params.stepsPerFrame as number | string, seed: params.seed as number | string, preroll: params.preroll as number | string, ...(params.restart !== undefined ? { restart: params.restart as number | string } : {}) },
          emit,
          listeners: listenersOf(a.inside, slugOf, engine, groupSound(g, params)),
          readsTrails: [...(a.outer.agentReads ?? [])].filter(id => byId.get(id)?.type === 'trailField').map(slugOf),
          readsPasses: [...a.outer.reads].map(slugOf),
          live: liveAgents.has(g.id),
          nodeIds: list.filter(n => n !== a.sink && !isAgentSource(n) && n.type !== PASS_TYPE).map(n => n.id),
        });
      }
      const groupIds = new Set(groupNodes.map(g => g.id));
      const deposits: AgentDepositProgram[] = [];
      for (const [dep, trail] of depositTo) {
        const d = byId.get(dep)!;
        const g = d.inputs.agents?.connection?.nodeId;
        if (!g || !groupIds.has(g)) continue;
        deposits.push(depositSpec(d, slugOf(dep), slugOf(g), slugOf(trail), engine(d)));
      }
      const trails: AgentTrailProgram[] = [];
      for (const n of nodes.filter(t => t.type === 'trailField')) {
        const spec: AgentTrailProgram = { ...trailSpec(n, slugOf(n.id), engine(n)), live: liveAgents.has(n.id) };
        // A trail that velocities go into keeps its negative values.
        if (deposits.some(d => d.trail === spec.slug && d.what === 'velocity')) spec.signed = true;
        const c = trailLists.get(n.id);
        if (c && spec.volume) { errors.push(`Node ${n.id}: ${spec.label}: Add and Block don't work on a 3D trail (a volume) yet; unwire them, or set the group's Space to 2D`); continue; }
        if (c) {
          const list = [...c.nodes.values(), trailStepSink(n, spec.slug)];
          const problems = checkProgramWires(list);
          if (problems.length) { errors.push(...problems); continue; }
          const r = compileList(list);
          absorb(r);
          if (countSamplers(r.fragmentShader) > MAX_SAMPLERS) errors.push(`Node ${n.id}: ${spec.label} samples more than ${MAX_SAMPLERS} textures (images, passes, trails) in its Add / Block`);
          spec.stepShader = r.fragmentShader;
          spec.readsPasses = [...c.reads].map(slugOf);
          spec.stepNodeIds = [...c.nodes.values()].filter(x => x.type !== PASS_TYPE && !isAgentSource(x)).map(x => x.id);
        }
        trails.push(spec);
      }
      const draws: AgentDrawProgram[] = [];
      for (const d of nodes.filter(n => n.type === 'drawAgents')) {
        const g = d.inputs.agents?.connection?.nodeId;
        const params = engine(d);
        if (!g || !groupIds.has(g)) continue;
        const spec: AgentDrawProgram = { ...drawSpec(d, slugOf(d.id), slugOf(g), params), live: liveAgents.has(d.id) };
        if (drawSeesScene(d)) {
          // A ray-marched scene's camera (and its depth): small programs of the picture's kind, compiled from what is wired in.
          const probeOf = (mode: 'camera' | 'depth') => {
            const sink = drawProbeSink(d, spec.slug, mode);
            const c = collect(Object.values(sink.inputs).flatMap(i => (i.connection ? [i.connection] : [])), byId, null, undefined, true);
            const list = [...c.nodes.values(), sink];
            const problems = checkProgramWires(list);
            if (problems.length) { errors.push(...problems); return null; }
            const r = compileList(list);
            absorb(r);
            return mode === 'camera' ? toProbeCamera(r.fragmentShader, sink.params.uniform as string) : r.fragmentShader;
          };
          const camera = probeOf('camera');
          const depth = d.inputs.depth?.connection ? probeOf('depth') : null;
          if (camera) spec.probe = { uniform: drawProbeSink(d, spec.slug, 'camera').params.uniform as string, camera, ...(depth ? { depth } : {}) };
        }
        draws.push(spec);
      }
      agentsSpec = { groups, deposits, trails, draws };
    }
    passes.push(...(hidden.before.get(FINAL) ?? []));
    const finalNodes = [...finalList.nodes.values()];
    const fin = compileList(hidden.annotate(finalNodes, FINAL));
    absorb(fin);
    if (countSamplers(fin.fragmentShader) > MAX_SAMPLERS) errors.push(`The final picture samples more than ${MAX_SAMPLERS} textures (images, videos, passes, feedback) in one program`);
    if (errors.length) return failure(errors);

    // Probes and scopes: the final program's variables, and those of nodes only a pass program has
    // (slugs are shared, so a node's variables have the same names in every program it lands in).
    const nodeOutputVars = new Map([...passVars, ...fin.nodeOutputVars]);
    let finalNodeIds = finalNodes.filter(n => n.type !== PASS_TYPE && !(agents && isAgentSource(n))).map(n => n.id);
    // Show passes: a Grid Rules node runs in its board's program too.
    if (grid.bindAs.size) for (const p of passes) for (const [id, as] of grid.bindAs) if (p.nodeIds.includes(id) && !p.nodeIds.includes(as)) p.nodeIds = [...p.nodeIds, as];
    // An opened group (a Pass inside it): its card reads its outputs from the nodes behind them, and
    // Show passes tints it as the programs its nodes run in.
    for (const [gid, g] of opened.groups) {
      const behind = (w: { nodeId: string; outputKey: string } | undefined, depth = 0): string | undefined => {
        if (!w) return undefined;
        const og = opened.groups.get(w.nodeId);
        if (og && depth < 8) return behind(og.outputs[w.outputKey], depth + 1);
        return nodeOutputVars.get(w.nodeId)?.[w.outputKey];
      };
      const vars: Record<string, string> = {};
      for (const [k, w] of Object.entries(g.outputs)) { const v = behind(w); if (v) vars[k] = v; }
      nodeOutputVars.set(gid, vars);
      const inner = new Set(g.inner);
      if (finalNodeIds.some(id => inner.has(id))) finalNodeIds = [...finalNodeIds, gid];
      for (const p of passes) if (p.nodeIds.some(id => inner.has(id))) p.nodeIds = [...p.nodeIds, gid];
    }

    return {
      vertexShader: VERTEX_SHADER,
      fragmentShader: fin.fragmentShader,
      success: true,
      nodeOutputVars,
      ...merged,
      nodeSlugMap: slugs,
      passes,
      finalNodeIds,
      ...(agentsSpec ? { agents: agentsSpec } : {}),
    };
  } catch (error) {
    return failure([error instanceof Error ? error.message : 'Unknown compilation error']);
  }
}
