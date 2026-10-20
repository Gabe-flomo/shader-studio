/**
 * glue.ts — the pieces build.ts and points.ts make Combine's glue with: a glue node of any type (sockets from its
 * definition, a role and a note), a vec3 Mix / Select, a Simple Expression, a picture as a texture (a Pass when it has
 * none), and the shapes of what a layer is once built. Pure.
 */
import type { DataType, GraphNode, InputSocket, OutputSocket } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { startingSockets } from '../nodes/definitions/transformAny';
import { CB_ROLE } from './meta';
import type { NodeRef, ProductKind } from './spec';

/**
 * Nodes Combine adds inside a product's Agents group (Collide with, Follow the shape), set apart from the top-level
 * glue: ports the group gains (an input wired from outside, through Agent Inputs), the nodes (each with a role), and
 * the Agent Output inputs they take over. apply.ts puts them in and takes them out again before every rebuild.
 */
export interface InnerEdit {
  layer: string;
  groupId: string;
  ports: Array<{ key: string; type: DataType; label: string; from: NodeRef }>;
  nodes: GraphNode[];
  out: Record<string, NodeRef | null>;
}

/** A wire the build sets on a product's own node (null: unwire it). */
export interface Patch { nodeId: string; input: string; from: NodeRef | null; note: string }

/** What a layer is, built: its picture and, for 3D and masks, what the layers above it wire from. */
export interface LayerOut {
  id: string;
  kind: ProductKind;
  label: string;
  colour: NodeRef | null;
  texture: NodeRef | null;
  cam?: string;
  loop?: { id: string; dist: boolean; hit: boolean };
  sceneGroup?: string;
  /** A 2D build's shape (its layers' distances): what points collide with and follow. */
  shape?: NodeRef[];
  /** A mask layer: its mask, texture, Blob data (when it has some), and the picture it masks. */
  mask?: { mask: NodeRef; texture: NodeRef | null; blobs: NodeRef | null; under: LayerOut; maxBlobs?: number };
}

export const ref = (n: GraphNode, outputKey: string): NodeRef => ({ nodeId: n.id, outputKey });

export interface Ctx {
  graph: readonly GraphNode[];
  idFor: (role: string) => string;
  glue: GraphNode[];
  patches: Patch[];
  warnings: string[];
  /** The layer being built: its glue ids. */
  mine: string[];
  /** Nodes added inside products' Agents groups (Collide with, Follow the shape). */
  inner: InnerEdit[];
}

/** A glue node of `type`: sockets from its definition, params = defaults + `params`, its role and note. */
export function mk(ctx: Ctx, layer: string, part: string, type: string, params: Record<string, unknown>, wires: Record<string, NodeRef | null | undefined>, note: string): GraphNode {
  const def = getNodeDefinition(type);
  if (!def) throw new Error(`Combine: unknown node type ${type}`);
  const sockets = startingSockets(type, def, { ...(def.defaultParams ?? {}), ...params });
  const inputs: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries({ ...def.inputs, ...sockets.inputs })) {
    const w = wires[k];
    if (!(k in sockets.inputs) && !w) continue;
    inputs[k] = { type: s.type, label: s.label, ...(w ? { connection: { ...w } } : {}) };
  }
  const outputs: Record<string, OutputSocket> = {};
  for (const [k, s] of Object.entries(sockets.outputs)) outputs[k] = { type: s.type, label: s.label };
  const role = `${layer}:${part}`;
  const node: GraphNode = { id: ctx.idFor(role), type, position: { x: 0, y: 0 }, inputs, outputs, params: { ...(def.defaultParams ?? {}), ...params, __comment: note, [CB_ROLE]: role } };
  ctx.glue.push(node);
  ctx.mine.push(node.id);
  return node;
}

/** A math node (Mix, Select) set to vec3, its sockets retyped as the card's type picker leaves them. */
export function mkVec3(ctx: Ctx, layer: string, part: string, type: 'mix' | 'select', wires: Record<string, NodeRef | null | undefined>, note: string, params: Record<string, unknown> = {}): GraphNode {
  const node = mk(ctx, layer, part, type, { outputType: 'vec3', ...params }, wires, note);
  for (const k of Object.keys(node.inputs)) if (!(type === 'mix' && k === 't') && !(type === 'select' && k === 'mask')) node.inputs[k] = { ...node.inputs[k], type: 'vec3' };
  for (const k of Object.keys(node.outputs)) node.outputs[k] = { ...node.outputs[k], type: 'vec3' };
  return node;
}

/** A Simple Expression with named inputs (their types follow the wires when the graph compiles). */
export function simple(ctx: Ctx, layer: string, part: string, label: string, expr: string, outputType: 'float' | 'vec3', ins: Array<[string, NodeRef]>, note: string): GraphNode {
  const vars = ins.map(([name], i) => ({ key: `in${i + 1}`, name }));
  const node = mk(ctx, layer, part, 'simpleExpr', { label, vars, expr, outputType }, {}, note);
  node.inputs = Object.fromEntries(ins.map(([name, from], i) => [`in${i + 1}`, { type: 'float', label: name, connection: { ...from } }]));
  node.outputs = { result: { type: outputType, label: 'Result' } };
  return node;
}

/** The picture as a texture: its own when it has one, else a Pass (one pass) that renders it into one. */
export function textureFor(ctx: Ctx, layer: string, out: { texture: NodeRef | null; colour: NodeRef | null; label: string }, why: string): NodeRef | null {
  if (out.texture) return out.texture;
  if (!out.colour) return null;
  const pass = mk(ctx, layer, 'pass', 'pass', {}, { color: out.colour },
    `Pass: ${out.label} drawn into a texture (one pass), because ${why} reads a picture as a texture, not a colour worked out per pixel.`);
  return ref(pass, 'texture');
}

/** Lay `nodes` out in a row, left to right in the order made (a group's inside). */
export function tidy(nodes: GraphNode[], y = 120, x0 = 0): void {
  nodes.forEach((n, i) => { n.position = { x: x0 + i * 300, y }; });
}
