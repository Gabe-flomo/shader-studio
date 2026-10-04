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
import type { CompilationResult, PassProgram } from './types';
import { VERTEX_SHADER } from './types';
import { topologicalSort } from './topoSort';
import { validateGraph } from './validate';
import { generateFragmentShader } from './shaderAssembler';
import { computeNodeSlug } from './nodeSlug';
import { PASS_SCALES } from '../nodes/definitions/passes';

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
}

/**
 * The ancestors of `starts` (input wires), stopping at Pass nodes, which
 * join as sources. `self` is the Pass whose program this is: reaching it
 * through anything but its Previous output is a loop.
 */
function collect(starts: Array<{ nodeId: string; outputKey: string }>, byId: Map<string, GraphNode>, self: string | null, into?: Collected): Collected {
  const out: Collected = into ?? { nodes: new Map(), reads: new Set(), readsPrevious: new Set() };
  const stack = [...starts];
  while (stack.length) {
    const c = stack.pop()!;
    const src = byId.get(c.nodeId);
    if (!src) continue;
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

    // 1. Slugs, once for the whole graph, in the usual sort order (Previous wires left out, so feedback isn't a cycle).
    const withoutPrevious = nodes.map(n => {
      const wires = Object.entries(n.inputs);
      if (!wires.some(([, i]) => i.connection?.outputKey === 'previous' && byId.get(i.connection.nodeId)?.type === PASS_TYPE)) return n;
      return { ...n, inputs: Object.fromEntries(wires.map(([k, i]) => [k, i.connection?.outputKey === 'previous' && byId.get(i.connection.nodeId)?.type === PASS_TYPE ? { ...i, connection: undefined } : i])) };
    });
    let sortedAll: GraphNode[];
    try { sortedAll = topologicalSort(withoutPrevious); } catch {
      return failure(['This graph has a loop. A loop through a Pass must come out of its Previous output (the picture from the frame before).']);
    }
    const used = new Set<string>();
    const slugs = new Map<string, string>();
    for (const n of sortedAll) slugs.set(n.id, computeNodeSlug(n, used));

    // 2. One node list per program.
    const passLists = new Map<string, Collected>();
    for (const p of passNodes) passLists.set(p.id, collect(wiresOf(p), byId, p.id));
    const output = nodes.find(n => n.type === 'output' || n.type === 'vec4Output')!;
    const outputAncestors = collect(wiresOf(output), byId, null);
    const onlyForPasses = new Set<string>();
    for (const c of passLists.values()) for (const [id, n] of c.nodes) if (n.type !== PASS_TYPE && !outputAncestors.nodes.has(id)) onlyForPasses.add(id);
    const finalList: Collected = { nodes: new Map(), reads: new Set(), readsPrevious: new Set() };
    for (const n of nodes) {
      if (n.type === PASS_TYPE || onlyForPasses.has(n.id)) continue;
      finalList.nodes.set(n.id, n);
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
      });
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
    };
  } catch (error) {
    return failure([error instanceof Error ? error.message : 'Unknown compilation error']);
  }
}
