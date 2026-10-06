/**
 * kinds.ts — what kind of value a socket carries, for the suggestions (docs/suggestions.md).
 *
 * The GLSL type alone says too little: a float can be a distance (negative inside a shape), a
 * mask (0…1, a region) or just a number; a vec2 can be a space (UV) or a direction; a vec3 a
 * colour or a 3D position. The kind is read from the socket's type, its key and label, and the
 * node's family (category), in that order of trust. Moves (moves.ts) are keyed by kind.
 */
import type { GraphNode, NodeDefinition } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';

export type ValueKind = 'distance' | 'mask' | 'colour' | 'space' | 'texture' | 'scene3d' | 'scalar';

export const KIND_LABELS: Record<ValueKind, string> = {
  distance: 'a distance', mask: 'a mask', colour: 'a colour', space: 'a space (UV)', texture: 'a texture', scene3d: '3D', scalar: 'a number',
};

const words = (key: string, label?: string) => `${key} ${label ?? ''}`.toLowerCase();
const word = (text: string, re: RegExp) => re.test(text);

/** Keys and labels that name a distance field. */
const DISTANCE_RE = /(^|[\s_])(d|dist|distance|sdf|mindist|rawdist|signed distance)([\s_(]|$)|distance/;
/** Keys and labels that name a 0…1 region. */
const MASK_RE = /(^|[\s_])(mask|blob|alpha|edges?|inside|coverage|held|invertedmask|horizon_mask)([\s_(]|$)/;
/** vec2 that are directions or points, not a space to draw in. */
const VECTOR_RE = /(^|[\s_])(dir|direction|flow|force|velocity|gradient|curl|normal|wind|heading|offset|center|centre|centers|cellid|cellindex|cellcenter|attractor|lastpad|cell|lens_center|focal_point|light_pos|pos[12345]?|c_pos|translate|scale|spacing|origin|dimensions|ab|a|b|b2|c|n)([\s_(]|$)/;
/** vec2 keys that are always a space to draw in. */
const SPACE_KEYS = new Set(['uv', 'input', 'output', 'result', 'p', 'position', 'celluv', 'warpeduv', 'displaceduv', 'uv_lensed', 'gridpos', 'worldpos', 'seamless', 'local', 'coord', 'uv_final', 'uv0', 'z']);
/** Nodes whose vec2 outputs are points (the pointer, a fixed point), not spaces. */
const POINT_NODES = new Set(['mouse', 'vec2Const', 'makeVec2', 'angleToVec2', 'normalizeVec2']);
/** vec3 that are 3D vectors, not colours. */
const VECTOR3_RE = /(^|[\s_])(pos|position|normal|dir|direction|ro|rd|incident|refracted|v|lightdir|point)([\s_(]|$)/;

/** Nodes whose float outputs are masks whatever they are called. */
const MASK_NODES = new Set(['smoothstep', 'step', 'compare', 'sdfMask', 'dotMask', 'cellFilter', 'metaballThreshold', 'modSelect', 'textureMask', 'distanceShape', 'hueRange']);
/** Families whose float outputs are distances. */
const DISTANCE_CATEGORIES = new Set(['2D Primitives']);
const DISTANCE_SUBCATEGORIES = new Set(['Combine', 'Modify']);
/** Node types that take a distance whatever the socket is called. */
const DISTANCE_TAKERS = new Set(['sdfFill', 'sdfColorize', 'light', 'glowLayer', 'deepGlow', 'sdfOffset', 'sdfOnion', 'sdfSharpen', 'sdfUnion', 'sdfSubtract', 'sdfIntersect', 'distanceShape', 'sdfMask', 'gridPaint']);

const is3dDef = (def: NodeDefinition | undefined) => !!def && /^(3D|Volumetric)/.test(def.category);

/**
 * The kind of one socket. `dir` is which side it is on; `nodeType` the node it belongs to.
 * Null for sockets no move works with (matrices, agents, volumes, emitters…).
 */
export function socketKind(nodeType: string, key: string, socket: { type: string; label?: string }, dir: 'in' | 'out'): ValueKind | null {
  const def = getNodeDefinition(nodeType);
  const t = socket.type;
  const text = words(key, socket.label);
  if (t === 'texture') return 'texture';
  if (t === 'scene3d' || t === 'spacewarp3d') return 'scene3d';
  if (t !== 'float' && t !== 'vec2' && t !== 'vec3' && t !== 'vec4') return null;
  if (is3dDef(def)) return 'scene3d';
  if (t === 'vec3' || t === 'vec4') return word(text, VECTOR3_RE) ? 'scene3d' : 'colour';
  if (t === 'vec2') {
    if (POINT_NODES.has(nodeType)) return 'scalar';
    if (SPACE_KEYS.has(key.toLowerCase())) return 'space';
    return word(text, VECTOR_RE) ? 'scalar' : 'space';
  }
  // float
  if (MASK_NODES.has(nodeType) && dir === 'out') return 'mask';
  if (word(text, MASK_RE)) return 'mask';
  if (word(text, DISTANCE_RE)) return 'distance';
  if (dir === 'out' && def && (DISTANCE_CATEGORIES.has(def.category) || (def.category === 'SDF' && DISTANCE_SUBCATEGORIES.has(def.subcategory ?? '')))) return 'distance';
  if (dir === 'in' && DISTANCE_TAKERS.has(nodeType) && (key === 'd' || key === 'distance' || key === 'sdf' || key === 'dist' || key === 'a' || key === 'b')) return 'distance';
  return 'scalar';
}

/** Space inputs: the vec2 a node reads its position from (UV, Position, Input…), not a point or a size. */
export function isSpaceInput(nodeType: string, key: string, socket: { type: string; label?: string }): boolean {
  return socket.type === 'vec2' && socketKind(nodeType, key, socket, 'in') === 'space';
}

/** Outputs that hand their input straight on ("UV (pass-through)") say nothing about the node. */
export function isPassThrough(node: GraphNode, key: string): boolean {
  const s = node.outputs[key];
  if (!s) return true;
  return /pass-?through/i.test(s.label);
}

export interface SocketKind { key: string; dir: 'in' | 'out'; kind: ValueKind; type: string; label: string }

/** The kinds of a node's outputs (pass-throughs skipped): colours first, then the node's own order. */
export function outputKinds(node: GraphNode): SocketKind[] {
  const out: SocketKind[] = [];
  for (const [key, s] of Object.entries(node.outputs)) {
    if (key.startsWith('__') || isPassThrough(node, key)) continue;
    const kind = socketKind(node.type, key, s, 'out');
    if (kind) out.push({ key, dir: 'out', kind, type: s.type, label: s.label });
  }
  // A colour output is what the preview (and usually the Output) shows: it leads, as the preview picks.
  return [...out.filter(o => o.kind === 'colour'), ...out.filter(o => o.kind !== 'colour')];
}

/** The node's space inputs (where a warp, a repeat or Polar can go in front). */
export function spaceInputs(node: GraphNode): SocketKind[] {
  const def = getNodeDefinition(node.type);
  if (is3dDef(def)) return [];
  return Object.entries(node.inputs)
    .filter(([key, s]) => !key.startsWith('__') && isSpaceInput(node.type, key, s) && !def?.inputs[key]?.field)
    .map(([key, s]) => ({ key, dir: 'in' as const, kind: 'space' as const, type: s.type, label: s.label }));
}

/** The node's main kind: its first output's (a colour output wins, as the preview picks). */
export function primaryKind(node: GraphNode): ValueKind | null {
  const outs = outputKinds(node);
  if (!outs.length) return null;
  return outs[0].kind;
}
