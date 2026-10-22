/**
 * autoType — math nodes that work per channel take their type from their wires.
 *
 * Add, Multiply, Mix, Sin, Floor… (VECTORIZABLE_NODES) have one type for the whole node,
 * `params.outputType`, which their main sockets carry. Unless it is locked (a type pill picked on
 * the card, `params.typeLocked`), the node is **Auto**: whenever a wire into one of those sockets is
 * made or taken away, the node takes the widest type wired into them (float < vec2 < vec3 < vec4),
 * the way GLSL types `colour * 0.5`. Every narrower wire is promoted by the graph's one wire rule
 * (lib/typesCompatible.ts: a float spreads, vec2 → vec3 adds 0, vec3 → vec4 adds alpha 1). With
 * nothing wired the node keeps the type it has.
 *
 * Nodes that need a vector of a set size (Length, Dot, Normalize) and Constant / Bounds keep their
 * pills only (FIXED_VECTOR_NODES).
 *
 * A change flows downstream: an Auto node fed by one that changed works its type out again, and
 * every other socket it feeds must still take the new type. When anything would break, nothing
 * changes and the plan says why (the store then refuses the wire, or keeps the old types).
 *
 * Inference runs only when wires change (the store's connect / disconnect), never on load or on
 * compile, so an existing graph renders exactly as it was saved.
 */
import type { DataType, GraphNode, SubgraphData } from '../types/nodeGraph';
import { VECTORIZABLE_NODES, VEC4_CAPABLE_NODES } from './definitions/math';
import { coerce, typesCompatible } from '../lib/typesCompatible';
import { wireType } from '../compiler/sendReceive';

/** Vectorizable nodes whose type is only ever picked on the card. */
export const FIXED_VECTOR_NODES: ReadonlySet<string> = new Set(['length', 'dot', 'normalizeVec2', 'constant', 'bounds']);

const RANK: Record<string, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };

/** Can a node of this type be Auto at all? */
export function isAutoTypeKind(type: string): boolean {
  return !!VECTORIZABLE_NODES[type] && !FIXED_VECTOR_NODES.has(type);
}

/** Is this node Auto now (an Auto kind, its type not locked by a pill)? */
export function isAutoTyped(node: Pick<GraphNode, 'type' | 'params'>): boolean {
  return isAutoTypeKind(node.type) && node.params?.typeLocked !== true;
}

/** The sockets that carry the node's type: its main input and the other operands. */
export function typedInputKeys(type: string): string[] {
  const info = VECTORIZABLE_NODES[type];
  return info ? [info.primaryInput, ...(info.alsoInputs ?? [])] : [];
}

/** The outputs that carry the node's type. */
export function typedOutputKeys(type: string): string[] {
  const info = VECTORIZABLE_NODES[type];
  return info ? [info.primaryOutput, ...(info.alsoOutputs ?? [])].filter(Boolean) : [];
}

/** The node's type now (`params.outputType`, float when unset). */
export function currentType(node: Pick<GraphNode, 'params'>): DataType {
  const t = node.params?.outputType;
  return (typeof t === 'string' && t in RANK ? t : 'float') as DataType;
}

/** Would this input take a wire of type `t` by retyping the node (the drag highlight)? */
export function acceptsByRetype(node: Pick<GraphNode, 'type' | 'params'>, inputKey: string, t: string): boolean {
  if (!isAutoTyped(node) || !typedInputKeys(node.type).includes(inputKey) || !(t in RANK)) return false;
  return t !== 'vec4' || VEC4_CAPABLE_NODES.has(node.type);
}

/**
 * Can a wire of `fromType` go into this input: by the plain wire rule, or by an Auto node retyping?
 * The pickers that offer sockets (Smart connect, the mobile connect lists, search) use this, so they
 * offer what a drag would take. `node` may be a definition's defaults (a node not placed yet).
 */
export function inputTakes(node: Pick<GraphNode, 'type' | 'params'>, inputKey: string, inputType: string, fromType: string): boolean {
  return typesCompatible(fromType, inputType) || acceptsByRetype(node, inputKey, fromType);
}

/** The widest of these types, or null when there are none. */
export function widest(types: readonly string[]): DataType | null {
  let best: string | null = null;
  for (const t of types) if (t in RANK && (best === null || RANK[t] > RANK[best])) best = t;
  return best as DataType | null;
}

export type RetypePlan = { ok: true; types: Map<string, DataType> } | { ok: false; reason: string };

const nameOf = (n: GraphNode) => (typeof n.params?.label === 'string' && n.params.label) || n.type;

/**
 * Work out the types after a wire change at one level of the graph (`scope`, inside `container`
 * when that is a group). `seeds` are the nodes whose wires changed; `forced` are nodes given a type
 * outright (a pill), whose consumers then follow. Returns the nodes whose type changes (only those),
 * or why it can't be done.
 */
export function planRetypes(
  scope: GraphNode[],
  container: GraphNode | undefined,
  seeds: readonly string[],
  forced: ReadonlyMap<string, DataType> = new Map(),
): RetypePlan {
  const byId = new Map(scope.map(n => [n.id, n] as const));
  const types = new Map<string, DataType>(forced);
  const typeOf = (n: GraphNode) => types.get(n.id) ?? currentType(n);
  const ports = (container?.params?.subgraph as SubgraphData | undefined)?.outputPorts ?? [];

  /** The type a wire carries, with the plan's new types applied to its source. */
  const carried = (c: { nodeId: string; outputKey: string }): string | undefined => {
    const src = byId.get(c.nodeId);
    if (src && types.has(src.id) && typedOutputKeys(src.type).includes(c.outputKey)) return types.get(src.id);
    return wireType(c, scope, container);
  };

  const work: string[] = [...seeds];
  const consumersOf = (id: string) => {
    for (const k of typedOutputKeys(byId.get(id)!.type)) {
      for (const n of scope) {
        for (const [key, inp] of Object.entries(n.inputs)) {
          if (inp.connection?.nodeId === id && inp.connection.outputKey === k) work.push(`${n.id}\u0000${key}`);
        }
      }
    }
  };
  for (const id of forced.keys()) if (byId.has(id)) consumersOf(id);

  let steps = 0;
  const limit = Math.max(16, scope.length * 8);
  while (work.length) {
    if (++steps > limit) return { ok: false, reason: 'the types keep changing round a loop' };
    const item = work.shift()!;
    const [id, viaKey] = item.split('\u0000');
    const n = byId.get(id);
    if (!n) continue;

    // A socket fed by a node that changed: an Auto node works its type out again; any other must take it.
    if (viaKey !== undefined && !(isAutoTyped(n) && !forced.has(n.id) && typedInputKeys(n.type).includes(viaKey))) {
      const c = n.inputs[viaKey]?.connection;
      const t = c && carried(c);
      const want = typedInputKeys(n.type).includes(viaKey) ? typeOf(n) : n.inputs[viaKey]?.type;
      if (t && want && coerce('x', t, want) === null) {
        return { ok: false, reason: `${nameOf(n)}’s ${n.inputs[viaKey]?.label ?? viaKey} takes a ${want}, and it would get a ${t}` };
      }
      continue;
    }
    if (!isAutoTyped(n) || forced.has(n.id)) continue;

    const wired: string[] = [];
    for (const k of typedInputKeys(n.type)) {
      const c = n.inputs[k]?.connection;
      const t = c && carried(c);
      if (t) wired.push(t);
    }
    const next = widest(wired) ?? typeOf(n);
    if (next === 'vec4' && !VEC4_CAPABLE_NODES.has(n.type)) return { ok: false, reason: `${nameOf(n)} doesn’t work on a vec4` };
    const odd = wired.find(t => coerce('x', t, next) === null);
    if (odd) return { ok: false, reason: `${nameOf(n)} can’t mix a ${odd} with a ${next}` };
    if (next === typeOf(n)) continue;

    types.set(n.id, next);
    consumersOf(n.id);
    for (const p of ports) {
      if (p.fromNodeId === n.id && typedOutputKeys(n.type).includes(p.fromOutputKey) && coerce('x', next, p.type) === null) {
        return { ok: false, reason: `the group’s ${p.label} output takes a ${p.type}, and it would get a ${next}` };
      }
    }
  }

  for (const [id, t] of [...types]) {
    const n = byId.get(id);
    if (n && currentType(n) === t && !forced.has(id)) types.delete(id);
  }
  return { ok: true, types };
}

/** The node set to type `t`: its outputType and the sockets that carry it (wires stay). */
export function withType(node: GraphNode, t: DataType, lock?: boolean): GraphNode {
  const inputs = { ...node.inputs };
  for (const k of typedInputKeys(node.type)) if (inputs[k]) inputs[k] = { ...inputs[k], type: t };
  const outputs = { ...node.outputs };
  for (const k of typedOutputKeys(node.type)) if (outputs[k]) outputs[k] = { ...outputs[k], type: t };
  const params: Record<string, unknown> = { ...node.params, outputType: t };
  if (lock === true) params.typeLocked = true;
  else if (lock === false) delete params.typeLocked;
  return { ...node, params, inputs, outputs };
}

/** Apply a plan to one level of the graph (the same list back when nothing changes). */
export function applyRetypes(scope: GraphNode[], types: ReadonlyMap<string, DataType>): GraphNode[] {
  if (types.size === 0) return scope;
  return scope.map(n => {
    const t = types.get(n.id);
    return t ? withType(n, t) : n;
  });
}
