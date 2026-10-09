/**
 * passGroups.ts — a Pass inside a plain group (docs/pass-node-plan.md, phase 7).
 *
 * The pass compile cuts the graph at Pass nodes, and the cut works on the top
 * level. A plain group (one pass through its nodes: Iterations 1, not sealed)
 * that has a Pass inside is opened up for it here: its nodes join the top
 * level, wired as the group wires them (its inputs to what feeds the group,
 * its outputs to what reads the group), so the compile sees an ordinary graph.
 * Only graphs with a Pass inside a group come here; every other group (and
 * every graph without a Pass in a group) compiles inline exactly as before.
 *
 * Inner nodes keep their ids (a collision with another node gets the group's
 * id in front), so their sliders, Pass card thumbnails, probes and Show passes
 * find them by the ids the group view shows. The group's overrides of inner
 * params (`innerId::key`) are applied, and a wire into one of its param
 * sockets (`ps_<innerId>_<key>`) drives that param through the node's
 * `__param_<key>` input, as inside the group.
 *
 * Kinds of group a Pass can't go in get an error saying why.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';

const PASS_TYPE = 'pass';
type Wire = { nodeId: string; outputKey: string };

function hasPass(nodes: GraphNode[]): boolean {
  for (const n of nodes) {
    // A Grid Rules node is a Pass too, once compiled (compiler/gridRulesExpand.ts).
    // So is a Curve Trace in Draw: Beam (compiler/curveBeamExpand.ts).
    if (n.type === PASS_TYPE || n.type === 'gridRules' || (n.type === 'curveTrace' && n.params?.draw === 'beam')) return true;
    const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes && hasPass(sg.nodes)) return true;
  }
  return false;
}

const label = (n: GraphNode, fallback: string) => (typeof n.params?.label === 'string' && n.params.label.trim() ? `"${n.params.label.trim()}"` : fallback);

/** Why a Pass can't be inside this node (null: it can, the node is a plain group). */
export function passGroupProblem(n: GraphNode): string | null {
  const name = label(n, 'this group');
  if (n.type === 'group') {
    if (n.sealed) return `Node ${n.id}: ${name} is sealed, and a sealed group stands for one closed function, so it can't draw a Pass's picture of its own. Unseal it to use the Pass inside (or move the Pass out of it).`;
    const iters = typeof n.params.iterations === 'number' ? Math.round(n.params.iterations) : 1;
    if (iters > 1 || n.params.liveIterations === true) return `Node ${n.id}: ${name} repeats its nodes (Iterations above 1), and a Pass inside it would be another whole picture drawn on every repeat. Set Iterations to 1, or move the Pass out and use its own Repeat setting instead.`;
    if (n.bypassed) return `Node ${n.id}: ${name} is bypassed, but it has a Pass inside, which can't be passed through. Turn bypass off, or move the Pass out of it.`;
    return null;
  }
  if (n.type === 'sceneGroup' || n.type === 'marchLoopGroup' || n.type === 'giLitMarchGroup' || n.type === 'spaceWarpGroup') {
    return `Node ${n.id}: a Pass can't go inside a 3D group (${name}): its nodes run as a distance function, at every step of every ray, and a Pass draws a whole picture of its own. Put the Pass after the group (on the picture it renders) or before it.`;
  }
  if (n.type === 'agentsGroup') return `Node ${n.id}: a Pass can't go inside an Agents group: its nodes run once per walker, and a Pass draws a whole picture of its own. Put the Pass outside and wire its Texture into the group through an input.`;
  return `Node ${n.id}: Pass nodes can't go inside ${name} (only a plain group, run once, can hold one).`;
}

export interface ExpandedGroups {
  nodes: GraphNode[];
  /** Each opened group: its id → its output ports' sources (in the new node list) and the ids its nodes got. */
  groups: Map<string, { outputs: Record<string, Wire | undefined>; inner: string[] }>;
}

/**
 * Open every plain group that has a Pass inside (nested ones too). Returns the errors instead when a
 * Pass is inside something that can't hold one. Graphs where no group has a Pass come back as they are.
 */
export function expandPassGroups(nodes: GraphNode[]): ExpandedGroups | { errors: string[] } {
  const groups: ExpandedGroups['groups'] = new Map();
  const holds = (n: GraphNode) => {
    const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    return n.type !== PASS_TYPE && !!sg?.nodes && hasPass(sg.nodes);
  };
  if (!nodes.some(holds)) return { nodes, groups };
  const errors: string[] = [];
  let list = nodes;
  // One group at a time (a nested group with a Pass joins the top level, then opens in turn).
  for (let guard = 0; guard < 64; guard++) {
    const g = list.find(holds);
    if (!g) break;
    const problem = passGroupProblem(g);
    if (problem) { errors.push(problem); list = list.filter(n => n !== g); continue; }
    const sg = g.params.subgraph as SubgraphData;
    // Ids: kept, unless another node already has it.
    const idOf = new Map<string, string>();
    for (const m of sg.nodes) {
      const clash = list.some(o => o.id === m.id) || [...groups.values()].some(o => o.inner.includes(m.id));
      idOf.set(m.id, clash ? `${g.id}__${m.id}` : m.id);
    }
    const outer = (portKey: string): Wire | undefined => g.inputs[portKey]?.connection;
    const inner: GraphNode[] = sg.nodes.map(m => {
      // The group's overrides of this node's params, and of a nested group's inner params.
      const head = `${m.id}::`;
      const params: Record<string, unknown> = { ...m.params };
      for (const [k, v] of Object.entries(g.params)) if (k.startsWith(head)) params[k.slice(head.length)] = v;
      const inputs: GraphNode['inputs'] = {};
      for (const [k, inp] of Object.entries(m.inputs)) {
        const c = inp.connection;
        if (!c) { inputs[k] = inp; continue; }
        const to = c.nodeId === GROUP_PORT_SENTINEL ? outer(c.outputKey) : { nodeId: idOf.get(c.nodeId) ?? c.nodeId, outputKey: c.outputKey };
        const { connection: _drop, ...rest } = inp;
        inputs[k] = to ? { ...rest, connection: { ...to } } : rest;
      }
      // The group's param sockets wired from outside (ps_<innerId>_<key>) drive the param, as inside it.
      const ps = `ps_${m.id}_`;
      for (const [k, inp] of Object.entries(g.inputs)) {
        if (!k.startsWith(ps) || !inp.connection) continue;
        const rest = k.slice(ps.length);
        if (m.type === 'group') inputs[`ps_${rest}`] = { type: 'float', label: inp.label, connection: { ...inp.connection } };
        else inputs[`__param_${rest}`] = { type: 'float', label: inp.label, connection: { ...inp.connection } };
      }
      return { ...m, id: idOf.get(m.id)!, inputs, params };
    });
    const outputs: Record<string, Wire | undefined> = {};
    for (const p of sg.outputPorts ?? []) outputs[p.key] = p.fromNodeId && idOf.has(p.fromNodeId) ? { nodeId: idOf.get(p.fromNodeId)!, outputKey: p.fromOutputKey } : undefined;
    groups.set(g.id, { outputs, inner: inner.map(m => m.id) });
    // Whatever read the group's outputs reads the node behind each one.
    const rewire = (n: GraphNode): GraphNode => {
      let changed = false;
      const inputs: GraphNode['inputs'] = {};
      for (const [k, inp] of Object.entries(n.inputs)) {
        if (inp.connection?.nodeId !== g.id) { inputs[k] = inp; continue; }
        changed = true;
        const to = outputs[inp.connection.outputKey];
        const { connection: _drop, ...rest } = inp;
        inputs[k] = to ? { ...rest, connection: { ...to } } : rest;
      }
      return changed ? { ...n, inputs } : n;
    };
    list = [...list.filter(n => n !== g), ...inner].map(rewire);
  }
  if (errors.length) return { errors };
  return { nodes: list, groups };
}
