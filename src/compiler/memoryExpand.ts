/**
 * memoryExpand.ts — opens every top-level memory node (nodes/definitions/memory.ts: Lag, Spring, Envelope, Timer,
 * Counter, Sample & Hold, Speed) into one shared Pass before the pass compile cuts the graph (compiler/passGraph.ts),
 * as Data Textures are (dataTextureExpand.ts):
 *
 *   Memory pack (`__memory__pack`) ──▶ Pass `__memory` (N × N full float, nearest; texel i is node i)
 *        ▲ reads the Pass's Previous            └──▶ Memory read (the node's own id) ──▶ every wire out of the node
 *
 *  - the pack is the Pass's whole program: texel i works out node i's next state from last frame's and node i's
 *    inputs (wired into the pack as `m<i>_<input>`);
 *  - each node is replaced by a Memory read with its id, so every wire out of it reads its texel, this frame;
 *  - what feeds the memory nodes (their inputs, and everything upstream) is drawn inside the pack's program, so a
 *    read of a memory node there is last frame's (`<id>__mprev`): a Lag into a Spring is one frame late, never a cycle.
 *
 * One Pass for all of them, so they never use up the graph's Pass slots. Graphs without one come back as they are.
 */
import type { GraphNode, InputSocket } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';
import { MEMORY_PACK_TYPE, MEMORY_READ_TYPE, MEMORY_SPECS, isMemoryType, packInputKey, type MemoryKind, type MemoryMember } from '../nodes/definitions/memory';

type Wire = { nodeId: string; outputKey: string };

export const MEMORY_PASS_ID = '__memory';
export const MEMORY_PACK_ID = '__memory__pack';
export const memoryPrevId = (id: string) => `${id}__mprev`;

export const isMemoryNode = (n: GraphNode): boolean => isMemoryType(n.type);
export const hasMemoryNode = (nodes: GraphNode[]): boolean => nodes.some(n => isMemoryNode(n) && !n.bypassed);

const passOutputs = (): GraphNode['outputs'] => Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }]));
const wire = (nodeId: string, outputKey: string, type: InputSocket['type'], label: string): InputSocket => ({ type, label, connection: { nodeId, outputKey } });

/** A reader in a memory node's place: its outputs, from texel `index` of the memory Pass (`out` 'texture' now, 'previous' last frame). */
function reader(id: string, n: GraphNode, index: number, out: 'texture' | 'previous'): GraphNode {
  const kind = n.type as MemoryKind;
  return {
    id, type: MEMORY_READ_TYPE, position: n.position,
    params: { kind, index, memParams: { ...MEMORY_SPECS[kind].defaultParams, ...n.params } },
    inputs: { state: wire(MEMORY_PASS_ID, out, 'texture', 'Memory') },
    outputs: Object.fromEntries(Object.entries(MEMORY_SPECS[kind].outputs).map(([k, o]) => [k, { type: 'float' as const, label: o.label }])),
  };
}

export function expandMemory(nodes: GraphNode[]): GraphNode[] {
  const mems = nodes.filter(n => isMemoryNode(n) && !n.bypassed);
  if (!mems.length) return nodes;
  const index = new Map(mems.map((m, i) => [m.id, i]));
  const byId = new Map(nodes.map(n => [n.id, n]));
  // Everything the pack's program draws: upstream of the memory nodes' inputs, stopping at memory nodes and at
  // wires already a frame ago.
  const up = new Set<string>();
  const stack: Wire[] = mems.flatMap(m => Object.values(m.inputs).flatMap(i => (i.connection ? [i.connection] : [])));
  while (stack.length) {
    const c = stack.pop()!;
    if (index.has(c.nodeId) || up.has(c.nodeId)) continue;
    const src = byId.get(c.nodeId);
    if (!src) continue;
    if (src.type === 'pass' && (c.outputKey === 'previous' || c.outputKey === 'step' || c.outputKey === 'steps')) continue;
    up.add(c.nodeId);
    for (const i of Object.values(src.inputs)) if (i.connection) stack.push(i.connection);
  }
  // In there, a read of a memory node is last frame's.
  const prevReaders = new Map<string, GraphNode>();
  const retarget = (n: GraphNode): GraphNode => {
    if (!up.has(n.id) && !index.has(n.id)) return n;
    let changed = false;
    const inputs: GraphNode['inputs'] = {};
    for (const [k, inp] of Object.entries(n.inputs)) {
      const c = inp.connection;
      const m = c ? byId.get(c.nodeId) : undefined;
      if (!c || !m || !index.has(c.nodeId)) { inputs[k] = inp; continue; }
      const rid = memoryPrevId(c.nodeId);
      if (!prevReaders.has(rid)) prevReaders.set(rid, reader(rid, m, index.get(c.nodeId)!, 'previous'));
      inputs[k] = { ...inp, connection: { nodeId: rid, outputKey: c.outputKey } };
      changed = true;
    }
    return changed ? { ...n, inputs } : n;
  };
  const list = nodes.map(retarget);
  // The pack: every memory node's wired inputs, under its index.
  const members: MemoryMember[] = [];
  const packInputs: GraphNode['inputs'] = { prev: wire(MEMORY_PASS_ID, 'previous', 'texture', 'Last frame') };
  for (const m0 of mems) {
    const m = list.find(n => n.id === m0.id)!;
    const i = index.get(m.id)!;
    const kind = m.type as MemoryKind;
    const wired: string[] = [];
    for (const k of Object.keys(MEMORY_SPECS[kind].inputs)) {
      const c = m.inputs[k]?.connection;
      if (!c) continue;
      wired.push(k);
      packInputs[packInputKey(i, k)] = wire(c.nodeId, c.outputKey, 'float', `${k} (${m.id})`);
    }
    members.push({ kind, params: { ...MEMORY_SPECS[kind].defaultParams, ...m.params }, wired });
  }
  const pack: GraphNode = {
    id: MEMORY_PACK_ID, type: MEMORY_PACK_TYPE, position: mems[0].position,
    params: { __members: members }, inputs: packInputs,
    outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
  };
  const pass: GraphNode = {
    id: MEMORY_PASS_ID, type: 'pass', position: mems[0].position, outputs: passOutputs(),
    params: { label: 'Memory', scale: '1', format: 'float', filter: 'nearest', wrap: 'clamp', repeat: 1, __size: mems.length },
    inputs: { color: wire(pack.id, 'color', 'vec3', 'Color'), alpha: wire(pack.id, 'alpha', 'float', 'Alpha') },
  };
  const out = list.map(n => (index.has(n.id) ? reader(n.id, n, index.get(n.id)!, 'texture') : n));
  return [...out, pack, pass, ...prevReaders.values()];
}
