/**
 * sendReceive.ts — Send and Receive as virtual wires (docs/send-receive.md).
 *
 * Before anything else in the compile, each Receive is turned into a real wire to its Send: the
 * Receive gets a hidden input (RECEIVE_VIA) and, when the two are in different scopes, the value is
 * routed through group ports added for this compile only:
 *
 *   - up out of each group the Send is in, below the scope both share: an output port `sr_<sendId>`
 *     wired to the Send's Value (or to the port of the group below);
 *   - down into each group the Receive is in: an input port `sr_<sendId>`, fed from the level above,
 *     read inside through the group-port sentinel.
 *
 * After that the graph is an ordinary graph: the existing group compiler, Pass cutting, Agents
 * programs, dead-code removal and the type checks all see wires and ports they already handle. The
 * stored graph is never changed (the routing works on a copy); only the sockets' types are kept in
 * step with what they carry (syncSendReceiveTypes).
 *
 * What a value can cross:
 *   - into a plain group (any depth, iterated or not: the value is the same every iteration) and into
 *     an Agents group (its ports reach the agents' program);
 *   - out of a plain group. Out of an iterated group the value is the one after the last iteration,
 *     exactly what an output port of that group gives.
 *   - Any other kind of group (3D scene groups, march loops, Shader Texture, …) is refused, with a
 *     message naming it: those compile into functions or programs of their own.
 * A link that would make a loop (a Receive feeding its own Send, or a group both sending to and
 * receiving from the level it sits on) is refused with the loop named, as a wire would be.
 */
import type { DataType, GraphNode, SubgraphData } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { getNodeDefinitionFor } from '../nodes/definitions';
import { RECEIVE_TYPE, RECEIVE_VIA, SEND_CARRIES, SEND_TYPE } from '../nodes/definitions/sendReceive';
import { findLoop, loopPath } from './graphLoops';

const AGENTS_GROUP = 'agentsGroup';
/** Groups a value can be routed into, and out of. */
const INTO = new Set(['group', AGENTS_GROUP]);
const OUT_OF = new Set(['group']);
export const SR_PORT_PREFIX = 'sr_';

type Wire = { nodeId: string; outputKey: string };
const subOf = (n: GraphNode): SubgraphData | undefined => {
  const sg = n.params?.subgraph as SubgraphData | undefined;
  return sg && Array.isArray(sg.nodes) ? sg : undefined;
};

/** A Send's name, trimmed ('' when it has none). */
export const sendNameOf = (n: GraphNode): string => (typeof n.params?.name === 'string' ? n.params.name.trim() : '');
const nodeName = (n: GraphNode): string =>
  (typeof n.params?.label === 'string' && n.params.label.trim()) || getNodeDefinitionFor(n)?.label || n.type;

export interface SendInfo {
  id: string;
  name: string;
  type: DataType;
  /** Container ids from the top level inward. */
  path: string[];
  /** Their names, for the picker ("Top level" when empty). */
  where: string;
}

/** Every node in the graph with the groups it is in (ids from the top level inward). */
function walk(nodes: GraphNode[], visit: (n: GraphNode, path: string[], scope: GraphNode[], container?: GraphNode) => void, path: string[] = [], container?: GraphNode, names: string[] = []): void {
  for (const n of nodes) {
    visit(n, path, nodes, container);
    const sg = subOf(n);
    if (sg) walk(sg.nodes, visit, [...path, n.id], n, [...names, nodeName(n)]);
  }
}

/** Every Send in the graph (inside groups too), in graph order. */
export function listSends(nodes: GraphNode[]): SendInfo[] {
  const out: SendInfo[] = [];
  const names = new Map<string, string>();
  walk(nodes, (n, path) => {
    if (subOf(n)) names.set(n.id, nodeName(n));
    if (n.type !== SEND_TYPE) return;
    out.push({ id: n.id, name: sendNameOf(n), type: (n.outputs?.value?.type ?? 'float') as DataType, path, where: path.length ? path.map(id => names.get(id) ?? id).join(' › ') : 'Top level' });
  });
  return out;
}

/** Every Receive in the graph reading the Send `sendId`, with where each is. */
export function receiversOf(nodes: GraphNode[], sendId: string): Array<{ id: string; path: string[] }> {
  const out: Array<{ id: string; path: string[] }> = [];
  walk(nodes, (n, path) => { if (n.type === RECEIVE_TYPE && n.params?.sendId === sendId) out.push({ id: n.id, path }); });
  return out;
}

/** Where a node is: the group ids from the top level inward, or null when it is nowhere. */
export function pathOf(nodes: GraphNode[], id: string): string[] | null {
  let found: string[] | null = null;
  walk(nodes, (n, path) => { if (found === null && n.id === id) found = path; });
  return found;
}

/** Sends sharing a name with another Send (the ids of all of them). */
export function duplicateSendIds(nodes: GraphNode[]): Set<string> {
  const byName = new Map<string, string[]>();
  for (const s of listSends(nodes)) if (s.name) byName.set(s.name, [...(byName.get(s.name) ?? []), s.id]);
  return new Set([...byName.values()].filter(ids => ids.length > 1).flat());
}

export function hasSendOrReceive(nodes: GraphNode[]): boolean {
  for (const n of nodes) {
    if (n.type === SEND_TYPE || n.type === RECEIVE_TYPE) return true;
    const sg = subOf(n);
    if (sg && hasSendOrReceive(sg.nodes)) return true;
  }
  return false;
}

/** The type a wire carries, read in the scope it is in (`container` owns the scope's group ports). */
export function wireType(c: Wire, scope: GraphNode[], container: GraphNode | undefined): string | undefined {
  if (c.nodeId === GROUP_PORT_SENTINEL) return subOf(container!)?.inputPorts?.find(p => p.key === c.outputKey)?.type ?? container?.inputs?.[c.outputKey]?.type;
  const src = scope.find(n => n.id === c.nodeId);
  if (!src) return undefined;
  if ((src.type === 'exprNode' || src.type === 'expr' || src.type === 'customFn' || src.type === 'simpleExpr') && c.outputKey === 'result' && typeof src.params?.outputType === 'string') return src.params.outputType;
  return src.outputs?.[c.outputKey]?.type ?? getNodeDefinitionFor(src)?.outputs?.[c.outputKey]?.type;
}

/** Map every node of the tree; a node (and each list) is only copied when something in it changed. */
export function mapTree(nodes: GraphNode[], fn: (n: GraphNode, scope: GraphNode[], container?: GraphNode) => GraphNode, container?: GraphNode): GraphNode[] {
  let changed = false;
  const out = nodes.map(n => {
    let m = fn(n, nodes, container);
    const sg = subOf(m);
    if (sg) {
      const inner = mapTree(sg.nodes, fn, m);
      if (inner !== sg.nodes) m = { ...m, params: { ...m.params, subgraph: { ...sg, nodes: inner } } };
    }
    if (m !== n) changed = true;
    return m;
  });
  return changed ? out : nodes;
}

const withType = (n: GraphNode, t: string, name?: string): GraphNode => {
  const inT = n.inputs?.value?.type, outT = n.outputs?.value?.type;
  const nameChanged = name !== undefined && n.params?.name !== name;
  if (outT === t && (n.type !== SEND_TYPE || inT === t) && !nameChanged) return n;
  return {
    ...n,
    ...(n.type === SEND_TYPE ? { inputs: { ...n.inputs, value: { ...(n.inputs?.value ?? { label: 'Value' }), type: t as DataType } } } : {}),
    outputs: { ...n.outputs, value: { ...(n.outputs?.value ?? { label: 'Value' }), type: t as DataType } },
    ...(nameChanged ? { params: { ...n.params, name } } : {}),
  };
};

/**
 * Keep the sockets in step with what they carry: a Send takes the type of the wire into it, a
 * Receive its Send's type (and remembers its name). Returns `nodes` itself when nothing changed.
 * A chain (a Receive feeding another Send) settles in a few rounds.
 */
export function syncSendReceiveTypes(nodes: GraphNode[]): GraphNode[] {
  if (!hasSendOrReceive(nodes)) return nodes;
  let cur = nodes;
  for (let round = 0; round < 6; round++) {
    const sends = new Map(listSends(cur).map(s => [s.id, s] as const));
    const next = mapTree(cur, (n, scope, container) => {
      if (n.type === SEND_TYPE) {
        const c = n.inputs?.value?.connection;
        const t = c ? wireType(c, scope, container) : undefined;
        return t && SEND_CARRIES.has(t) ? withType(n, t) : n;
      }
      if (n.type === RECEIVE_TYPE) {
        const s = sends.get(String(n.params?.sendId ?? ''));
        return s ? withType(n, s.type, s.name) : n;
      }
      return n;
    });
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

interface Loc { node: GraphNode; path: string[]; scope: GraphNode[] }

function locate(nodes: GraphNode[]): Map<string, Loc> {
  const m = new Map<string, Loc>();
  walk(nodes, (n, path, scope) => { if (!m.has(n.id)) m.set(n.id, { node: n, path, scope }); });
  return m;
}

export interface ResolveResult { nodes: GraphNode[]; errors: string[] }

/**
 * The graph with every Receive wired to its Send (see the file comment). `nodes` is not changed.
 * A Receive with no Send (none picked, or the Send deleted) is left unwired: its Value is zero.
 */
export function resolveSendReceive(nodes: GraphNode[]): ResolveResult {
  if (!hasSendOrReceive(nodes)) return { nodes, errors: [] };
  const synced = syncSendReceiveTypes(nodes);
  // Already resolved (the store resolves before building a preview graph): nothing more to do.
  let pending = false;
  walk(synced, n => { if (n.type === RECEIVE_TYPE && !n.inputs?.[RECEIVE_VIA]?.connection) pending = true; });
  if (!pending) return { nodes: synced, errors: [] };

  const work: GraphNode[] = structuredClone(synced);
  const loc = locate(work);
  const errors: string[] = [];
  const before = new Map<GraphNode[], boolean>();
  walk(work, (_n, _p, scope) => { if (!before.has(scope)) before.set(scope, !!findLoop(scope)); });

  const receives: Loc[] = [];
  walk(work, (n, path, scope) => { if (n.type === RECEIVE_TYPE && !n.inputs?.[RECEIVE_VIA]?.connection) receives.push({ node: n, path, scope }); });

  for (const r of receives) {
    const s = loc.get(String(r.node.params?.sendId ?? ''));
    if (!s || s.node.type !== SEND_TYPE) continue; // no Send: zero / black
    const name = sendNameOf(s.node) || 'unnamed';
    const t = (s.node.outputs?.value?.type ?? 'float') as DataType;
    if (!SEND_CARRIES.has(t)) { errors.push(`Send "${name}" carries ${t}, which a Send can't share: only numbers, vectors and textures.`); continue; }
    if (r.node.id === s.node.id) continue;
    let common = 0;
    while (common < s.path.length && common < r.path.length && s.path[common] === r.path[common]) common++;
    const problem = (() => {
      for (let i = s.path.length - 1; i >= common; i--) {
        const g = loc.get(s.path[i])!.node;
        if (!OUT_OF.has(g.type)) return `Send "${name}" is inside ${nodeName(g)} (${getNodeDefinitionFor(g)?.label ?? g.type}), which a Send can't reach out of. Move the Send out, or wire its Value to an output of that group.`;
      }
      for (let j = common; j < r.path.length; j++) {
        const g = loc.get(r.path[j])!.node;
        if (g.type === AGENTS_GROUP && !subOf(g)!.nodes.some(m => m.type === 'agentInputs')) return `A Receive of "${name}" is inside ${nodeName(g)}, which has no Agent Inputs node to bring it in through.`;
        if (!INTO.has(g.type)) return `A Receive of "${name}" is inside ${nodeName(g)} (${getNodeDefinitionFor(g)?.label ?? g.type}), which Send and Receive can't reach into. Wire the value in through a group input instead.`;
      }
      return null;
    })();
    if (problem) { errors.push(problem); continue; }

    const key = `${SR_PORT_PREFIX}${s.node.id}`;
    const label = `Send ${name}`;
    let wire: Wire = { nodeId: s.node.id, outputKey: 'value' };
    // Up: out of each group the Send is in, below the shared scope.
    for (let i = s.path.length - 1; i >= common; i--) {
      const g = loc.get(s.path[i])!.node;
      const sg = subOf(g)!;
      sg.outputPorts = sg.outputPorts ?? [];
      if (!sg.outputPorts.some(p => p.key === key)) sg.outputPorts.push({ key, type: t, label, fromNodeId: wire.nodeId, fromOutputKey: wire.outputKey });
      g.outputs = { ...g.outputs, [key]: { type: t, label } };
      wire = { nodeId: g.id, outputKey: key };
    }
    // Down: into each group the Receive is in.
    for (let j = common; j < r.path.length; j++) {
      const g = loc.get(r.path[j])!.node;
      const sg = subOf(g)!;
      if (!g.inputs?.[key]?.connection) g.inputs = { ...g.inputs, [key]: { type: t, label, connection: wire } };
      if (g.type === AGENTS_GROUP) {
        // An Agents group's added inputs come out of its Agent Inputs node (compiler/agentGraph.ts agentStepNodes).
        const ai = sg.nodes.find(m => m.type === 'agentInputs')!;
        const extras = (ai.params.extraInputs ?? []) as Array<{ key: string; type: DataType; label: string }>;
        if (!extras.some(e => e.key === key)) ai.params = { ...ai.params, extraInputs: [...extras, { key, type: t, label }] };
        ai.outputs = { ...ai.outputs, [key]: { type: t, label } };
        wire = { nodeId: ai.id, outputKey: key };
        continue;
      }
      sg.inputPorts = sg.inputPorts ?? [];
      const next = j + 1 < r.path.length ? r.path[j + 1] : r.node.id;
      if (!sg.inputPorts.some(p => p.key === key)) sg.inputPorts.push({ key, type: t, label, toNodeId: next, toInputKey: j + 1 < r.path.length ? key : RECEIVE_VIA });
      wire = { nodeId: GROUP_PORT_SENTINEL, outputKey: key };
    }
    r.node.inputs = { ...r.node.inputs, [RECEIVE_VIA]: { type: t, label: 'Value', connection: wire } };
  }

  // A link that closes a loop: named, as a wire that would close one is.
  let loopError: string | null = null;
  walk(work, (_n, _p, scope) => {
    if (loopError || before.get(scope)) return;
    const loop = findLoop(scope);
    if (!loop) return;
    const byId = new Map(scope.map(n => [n.id, n]));
    const rec = loop.nodeIds.map(id => byId.get(id)).find(n => n?.type === RECEIVE_TYPE);
    const s = rec ? loc.get(String(rec.params?.sendId ?? ''))?.node : undefined;
    const who = s ? `Send "${sendNameOf(s) || 'unnamed'}" and its Receive` : 'A Send and Receive link';
    loopError = `${who} make a loop: ${loopPath(scope, loop)}. A node can’t use its own result in the same frame: the Receive must not feed (through any wires or groups) the Send it reads.`;
  });
  if (loopError) errors.push(loopError);
  return { nodes: work, errors };
}
