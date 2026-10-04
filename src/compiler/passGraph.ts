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
import type { AgentDepositProgram, AgentDrawProgram, AgentGroupProgram, AgentTrailProgram, CompilationResult, PassProgram } from './types';
import { VERTEX_SHADER } from './types';
import { topologicalSort } from './topoSort';
import { validateGraph } from './validate';
import { generateFragmentShader } from './shaderAssembler';
import { computeNodeSlug } from './nodeSlug';
import { PASS_SCALES } from '../nodes/definitions/passes';
import { getNodeDefinitionFor } from '../nodes/definitions';
import {
  agentStepNodes, asAgentSource, checkProgramWires, depositSpec, depositTargets, drawSpec, emitMode, engineParams, groupSide, groupSpecies,
  hasAgentsNode, insideSlugs, isAgentEngineOnly, isAgentLoopWire, isAgentSource, MAX_AGENT_GROUPS, MAX_TRAILS, trailSpec,
} from './agentGraph';
import { agentPlacementProblems, agentProgramProblems } from './agentRules';

export const PASS_TYPE = 'pass';
/** Most Pass nodes in one graph. */
export const MAX_PASSES = 8;
/** WebGL2 guarantees 16 texture units per fragment shader. */
export const MAX_SAMPLERS = 16;

type Sub = { nodes?: GraphNode[] } | undefined;

/** Does the graph have a Pass node (at the top level or inside a group)? */
export function hasPassNode(nodes: GraphNode[]): boolean {
  for (const n of nodes) {
    if (n.type === PASS_TYPE) return true;
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
    const { nodes } = graph;
    // Agents-family nodes (agentGraph.ts) add their own programs; without one, everything below runs as it always has.
    const agents = hasAgentsNode(nodes);
    if (agents) {
      const placement = agentPlacementProblems(nodes, getNodeDefinitionFor);
      if (placement.length) return failure(placement);
    }
    // Pass nodes inside groups aren't supported (a Pass in an iterated group would be N draws a frame).
    const nested: string[] = [];
    for (const n of nodes) {
      const sg = n.params?.subgraph as Sub;
      if (n.type !== PASS_TYPE && sg?.nodes && hasPassNode(sg.nodes)) nested.push(`Node ${n.id}: Pass nodes go at the top level for now`);
    }
    if (nested.length) return failure(nested);

    const validation = validateGraph(nodes);
    if (!validation.valid) return failure(validation.errors ?? ['Invalid graph']);

    const passNodes = nodes.filter(n => n.type === PASS_TYPE);
    if (passNodes.length > MAX_PASSES) return failure([`A graph can have up to ${MAX_PASSES} Pass nodes (this one has ${passNodes.length})`]);
    const byId = new Map(nodes.map(n => [n.id, n]));

    // 1. Slugs, once for the whole graph, in the usual sort order (Previous wires left out, so feedback isn't a cycle;
    //    with agents, the wires out of a group, Deposit or Emit too, so a Trail read back by its group isn't one either).
    const cut = (c: { nodeId: string; outputKey: string } | undefined) => !!c && (
      (c.outputKey === 'previous' && byId.get(c.nodeId)?.type === PASS_TYPE) || (agents && isAgentLoopWire(c, byId)));
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
    const agentLists = new Map<string, { inside: GraphNode[]; sink: GraphNode; outer: Collected; problems: string[] }>();
    for (const g of groupNodes) {
      const { inner, sink, starts, problems } = agentStepNodes(g);
      agentLists.set(g.id, { inside: inner, sink, outer: collectOuter(starts, byId), problems });
    }
    const onlyForPasses = new Set<string>();
    for (const c of passLists.values()) for (const [id, n] of c.nodes) if (n.type !== PASS_TYPE && !outputAncestors.nodes.has(id)) onlyForPasses.add(id);
    for (const a of agentLists.values()) for (const [id, n] of a.outer.nodes) if (!isAgentSource(n) && n.type !== PASS_TYPE && !outputAncestors.nodes.has(id)) onlyForPasses.add(id);
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
        (c.outputKey === 'previous' ? finalList.readsPrevious : finalList.reads).add(src.id);
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
    const previousRead = new Set<string>();
    for (const c of [finalList, ...passLists.values()]) for (const r of c.readsPrevious) previousRead.add(r);

    // 4. Compile each list with today's compiler.
    const compileList = (list: GraphNode[]) => generateFragmentShader(topologicalSort(list), list, { slugs });
    const errors: string[] = [];
    const passes: PassProgram[] = [];
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
      const r = compileList([...c.nodes.values(), sink]);
      absorb(r);
      const slug = slugs.get(id)!;
      const label = typeof pass.params.label === 'string' && pass.params.label.trim() ? pass.params.label.trim() : 'Pass';
      if (countSamplers(r.fragmentShader) > MAX_SAMPLERS) errors.push(`Node ${id}: ${label} samples more than ${MAX_SAMPLERS} textures (images, videos, passes, feedback) in one program`);
      passes.push({
        nodeId: id, slug, label, fragmentShader: r.fragmentShader,
        reads: [...c.reads].map(r2 => slugs.get(r2)!), readsPrevious: [...c.readsPrevious].map(r2 => slugs.get(r2)!),
        scale: PASS_SCALES[String(pass.params.scale ?? '1')] ?? 1,
        format: sel(pass.params.format, ['half', 'byte'] as const, 'half'),
        filter: sel(pass.params.filter, ['linear', 'nearest'] as const, 'linear'),
        wrap: sel(pass.params.wrap, ['clamp', 'repeat', 'mirror'] as const, 'clamp'),
        previous: previousRead.has(id), live: live.has(id),
        nodeIds: [...c.nodes.values()].filter(n => n.type !== PASS_TYPE).map(n => n.id),
        ...(agents ? { afterAgents: afterAgents.has(id) } : {}),
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
        const seedExpr = typeof seed === 'string' ? seed : `${Number(seed ?? 1).toFixed(1)}`;
        const r = generateFragmentShader(topologicalSort(list), list, {
          slugs,
          agentProgram: {
            slug: slugOf(g.id), side: groupSide(g), species: groupSpecies(g), seed: seedExpr,
            declarations: typeof seed === 'string' ? [`uniform float ${seed};`] : [],
          },
        });
        absorb(r);
        if (countSamplers(r.fragmentShader) > MAX_SAMPLERS) errors.push(`Node ${g.id}: ${label} samples more than ${MAX_SAMPLERS} textures (its state, trails, passes, images) in one program`);
        groups.push({
          nodeId: g.id, slug: slugOf(g.id), label, fragmentShader: r.fragmentShader,
          side: groupSide(g), species: groupSpecies(g),
          params: { stepsPerFrame: params.stepsPerFrame as number | string, seed: params.seed as number | string, preroll: params.preroll as number | string },
          emit: emitMode(g, byId, slugOf),
          readsTrails: [...(a.outer.agentReads ?? [])].filter(id => byId.get(id)?.type === 'trailField').map(slugOf),
          readsPasses: [...a.outer.reads].map(slugOf),
          live: liveAgents.has(g.id),
          nodeIds: list.filter(n => n !== a.sink && !isAgentSource(n) && n.type !== PASS_TYPE).map(n => n.id),
        });
      }
      const groupIds = new Set(groupNodes.map(g => g.id));
      const trails: AgentTrailProgram[] = nodes.filter(n => n.type === 'trailField')
        .map(n => ({ ...trailSpec(n, slugOf(n.id), engine(n)), live: liveAgents.has(n.id) }));
      const deposits: AgentDepositProgram[] = [];
      for (const [dep, trail] of depositTo) {
        const d = byId.get(dep)!;
        const g = d.inputs.agents?.connection?.nodeId;
        if (!g || !groupIds.has(g)) continue;
        deposits.push(depositSpec(d, slugOf(dep), slugOf(g), slugOf(trail), engine(d)));
      }
      const draws: AgentDrawProgram[] = [];
      for (const d of nodes.filter(n => n.type === 'drawAgents')) {
        const g = d.inputs.agents?.connection?.nodeId;
        const params = engine(d);
        if (!g || !groupIds.has(g)) continue;
        draws.push({ ...drawSpec(d, slugOf(d.id), slugOf(g), params), live: liveAgents.has(d.id) });
      }
      agentsSpec = { groups, deposits, trails, draws };
    }
    const finalNodes = [...finalList.nodes.values()];
    const fin = compileList(finalNodes);
    absorb(fin);
    if (countSamplers(fin.fragmentShader) > MAX_SAMPLERS) errors.push(`The final picture samples more than ${MAX_SAMPLERS} textures (images, videos, passes, feedback) in one program`);
    if (errors.length) return failure(errors);

    return {
      vertexShader: VERTEX_SHADER,
      fragmentShader: fin.fragmentShader,
      success: true,
      // Probes read the final program only (phase 3 adds pass programs).
      nodeOutputVars: fin.nodeOutputVars,
      ...merged,
      nodeSlugMap: slugs,
      passes,
      ...(agentsSpec ? { agents: agentsSpec } : {}),
    };
  } catch (error) {
    return failure([error instanceof Error ? error.message : 'Unknown compilation error']);
  }
}
