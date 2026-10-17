/**
 * wireFit — which nodes can go on a wire, or after a node, before they exist.
 *
 * The graph's wire rule is lib/typesCompatible.ts. On top of it, the places that *offer* nodes
 * (the insert-on-wire picker, the search's Related group) use a narrower rule so they don't list
 * nodes that only fit by a vec2 ↔ vec3 pad or truncate:
 *
 *  - same type fits;
 *  - a float fits any vector (vecN(x), every channel the same), so a node that outputs a float
 *    can go on any vector wire, and a float wire can feed a vector input;
 *  - a genType node (VECTORIZABLE_NODES: Exp, Sin, Add…) takes the wire's vector type, so Exp on
 *    a vec3 wire is exp() per channel. Its output follows (Length and Dot stay float, which
 *    broadcasts).
 *
 * The auto-wiring after the node is placed (insertIntoWire in nodeDrop.ts) retypes a genType node
 * the same way, then wires its sockets by pickInsertSockets.
 */
import type { DataType, NodeDefinition } from '../../types/nodeGraph';
import { VECTORIZABLE_NODES, VEC4_CAPABLE_NODES } from '../../nodes/definitions/math';
import { typesCompatible } from '../../lib/typesCompatible';

type Sockets = Record<string, { type: string }>;

const VECTORS = new Set(['vec2', 'vec3', 'vec4']);

/** Expression blocks and custom functions get their sockets from their params, so a definition can't say. */
export const DYNAMIC_SOCKET_TYPES = new Set(['exprNode', 'customFn']);

/**
 * The vector type a genType node of `type` should take for a wire of `wireType`, or null to leave
 * it as it is (not genType, a float or non-vector wire, vec4 on a node without a vec4 pill).
 */
export function genTypeFor(type: string, wireType: string): DataType | null {
  if (!VECTORIZABLE_NODES[type] || !VECTORS.has(wireType)) return null;
  if (wireType === 'vec4' && !VEC4_CAPABLE_NODES.has(type)) return null;
  return wireType as DataType;
}

/** A node's sockets as they would be after it is set to vector type `vt` (changeNodeVectorType). */
export function socketsAs(type: string, inputs: Sockets, outputs: Sockets, vt: string): { inputs: Sockets; outputs: Sockets } {
  const info = VECTORIZABLE_NODES[type];
  if (!info) return { inputs, outputs };
  const ins = { ...inputs }, outs = { ...outputs };
  for (const k of [info.primaryInput, ...(info.alsoInputs ?? [])]) if (ins[k]) ins[k] = { ...ins[k], type: vt };
  for (const k of [info.primaryOutput, ...(info.alsoOutputs ?? [])]) if (k && outs[k]) outs[k] = { ...outs[k], type: vt };
  return { inputs: ins, outputs: outs };
}

/**
 * The inputs a wire may go into without being asked: not a slider's own socket while it is hidden
 * (`socketsOnDemand`, the wireable sliders), or every node with a colour slider would fit a vec3 wire.
 */
export function visibleInputs(def: Pick<NodeDefinition, 'socketsOnDemand'> | null | undefined, inputs: Sockets, shown: readonly string[] = []): Sockets {
  const hidden = def?.socketsOnDemand;
  if (!hidden) return inputs;
  return Object.fromEntries(Object.entries(inputs).filter(([k]) => !(k in hidden) || shown.includes(k)));
}

/** The offering rule: same type, or a float broadcast into a vector. (Wires themselves allow more; see typesCompatible.) */
export function offerFits(from: string, to: string): boolean {
  return from === to || (from === 'float' && typesCompatible(from, to));
}

/** Could a node of `def` sit in a wire from `fromType` to `toType` (the picker's rule)? */
export function fitsWireInsert(def: NodeDefinition, fromType: string, toType: string): boolean {
  if (DYNAMIC_SOCKET_TYPES.has(def.type)) return true;
  const vt = genTypeFor(def.type, fromType);
  const { inputs, outputs } = vt ? socketsAs(def.type, def.inputs, def.outputs, vt) : def;
  return Object.values(visibleInputs(def, inputs)).some(i => offerFits(fromType, i.type))
    && Object.values(outputs).some(o => offerFits(o.type, toType));
}

/** Could a node of `def` take a wire from an output of one of `outTypes` (the Related group after a selected node)? */
export function canFollow(def: NodeDefinition, outTypes: readonly string[]): boolean {
  if (DYNAMIC_SOCKET_TYPES.has(def.type)) return true;
  return outTypes.some(t => {
    const vt = genTypeFor(def.type, t);
    const { inputs } = vt ? socketsAs(def.type, def.inputs, def.outputs, vt) : def;
    return Object.values(visibleInputs(def, inputs)).some(i => offerFits(t, i.type));
  });
}
