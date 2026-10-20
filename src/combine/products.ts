/**
 * products.ts — a layer's product, found in the graph (docs/combine-plan.md §1): what kind it is and the sockets the
 * verbs wire from. A product keeps its own nodes and its own builder's spec; Combine only reads from them (and, for a
 * few pairs, sets a wire on one of them: build.ts `patches`).
 *
 *  - Picture (2D, Grid, Grid simulation, Time Cube, Warp, a Texture or Video Input, any node's colour): its colour, and
 *    its texture when it has one (a Texture / Video Input's, Draw agents' Image);
 *  - 3D scene (a 3D build): its picture, its March Camera and its March Loop (Distance, Hit), its Scene Group;
 *  - Splats (a Splat build): its Splat Scene, placed in a 3D scene by distance;
 *  - Points (an Agent build): its Draw agents' colour, density and image;
 *  - Mask (a Segment, a Blob Track): its mask, its texture, and Blob Track's Blob data.
 *
 * Pure: reads the nodes it is given.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { builtSceneIds, builtScenes, sceneKindInfo, type SceneKind } from '../builders/builtScenes';
import { findBuild } from '../sceneBuilder/apply';
import { findSplatBuild } from '../splatBuilder/apply';
import type { NodeRef, ProductKind, ProductRef } from './spec';
import { CB_BUILD } from './meta';

export interface Resolved {
  kind: ProductKind;
  /** "3D scene", "Room and cat"… */
  label: string;
  /** The picture (vec3). */
  colour: NodeRef | null;
  /** A texture of it, when one exists without a Pass. */
  texture: NodeRef | null;
  /** 3D: the March Camera, the March Loop (and whether it has Distance and Hit), the Scene Group. */
  cam?: string;
  loop?: { id: string; dist: boolean; hit: boolean };
  sceneGroup?: string;
  /** A splat build: its Splat Scene. */
  splat?: string;
  /** Points: the Draw agents node, and whether the group is 3D. */
  draw?: { id: string; d3: boolean };
  /** A mask node in the graph: its mask (float) and texture, and Blob data when it is a Blob Track. */
  mask?: { mask: NodeRef; texture: NodeRef | null; blobs: NodeRef | null };
  /** Why it can't be used ("Product missing: pick another"). */
  missing?: string;
}

const ref = (nodeId: string, outputKey: string): NodeRef => ({ nodeId, outputKey });
const labelOf = (n: GraphNode | undefined, fallback: string) => (n && typeof n.params.label === 'string' && n.params.label.trim()) || (n ? (n.params._imageName as string | undefined) || (n.params._fileName as string | undefined) || getNodeDefinition(n.type)?.label : undefined) || fallback;

const PICTURE_NODES = new Set(['textureInput', 'videoInput', 'baked']);
const MASK_NODES = new Set(['segment', 'blobTrack', 'textureMask']);
const MOTION_NODES = new Set(['opticalFlow', 'textureChange']);
const isOutput = (n: GraphNode) => n.type === 'output' || n.type === 'vec4Output';

/** The kind of product a build of `scene` is. */
export function buildKind(scene: SceneKind): ProductKind {
  if (scene === '3d' || scene === 'splat') return 'scene3d';
  if (scene === 'agents') return 'points';
  return 'picture';
}

/** The kind of product a node is (by its type). */
export function nodeKind(type: string): ProductKind {
  if (MASK_NODES.has(type)) return 'mask';
  if (MOTION_NODES.has(type)) return 'motion';
  return 'picture';
}

/** A product's kind without looking it up in detail (null: a light rig, not offered yet). */
export function productKind(p: ProductRef, nodes: readonly GraphNode[]): ProductKind | null {
  if (p.kind === 'build') return buildKind(p.scene);
  if (p.kind === 'mask') return 'mask';
  if (p.kind === 'node') return nodeKind(nodes.find(n => n.id === p.nodeId)?.type ?? '');
  return null;
}

/** Whether a product is a splat build (Splats → 3D is Place in; two 3D builds aren't). */
export const isSplat = (p: ProductRef): boolean => p.kind === 'build' && p.scene === 'splat';

/**
 * The picture of a set of top-level nodes (a build): `out` when that node is still there; else the one of them the
 * Output reads; else a colour output none of the others reads (the end of its chain).
 */
export function pictureOf(nodes: readonly GraphNode[], ids: ReadonlySet<string>, out?: NodeRef): NodeRef | null {
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (out && byId.get(out.nodeId)?.outputs[out.outputKey]) return out;
  for (const o of nodes.filter(isOutput)) {
    const c = o.inputs.color?.connection;
    if (c && ids.has(c.nodeId)) return { ...c };
  }
  const read = new Set<string>();
  for (const id of ids) for (const s of Object.values(byId.get(id)?.inputs ?? {})) if (s.connection && ids.has(s.connection.nodeId)) read.add(s.connection.nodeId);
  const ends = [...ids].map(id => byId.get(id)).filter((n): n is GraphNode => !!n && !read.has(n.id) && !n.params[CB_BUILD]);
  for (const n of ends.reverse()) {
    const k = Object.entries(n.outputs).find(([, s]) => s.type === 'vec3')?.[0];
    if (k) return ref(n.id, k);
  }
  return null;
}

/** The Draw agents node that draws the Agents group `groupId` (top level). */
function drawOf(nodes: readonly GraphNode[], groupId: string): GraphNode | undefined {
  return nodes.find(n => n.type === 'drawAgents' && n.inputs.agents?.connection?.nodeId === groupId);
}

/** A product as the verbs see it. Missing nodes give `missing` (the layer says "Product missing: pick another"). */
export function resolveProduct(p: ProductRef, nodes: readonly GraphNode[]): Resolved {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const none = (kind: ProductKind, label: string, why: string): Resolved => ({ kind, label, colour: null, texture: null, missing: why });
  if (p.kind === 'rig') return none('picture', 'Light rig', 'Light rigs come with Relight with (a later phase).');
  if (p.kind === 'mask') {
    const label = p.find === 'people' ? 'People' : p.find === 'click' ? 'Clicked thing' : (p.classes || 'Objects').split(',').map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ');
    return { kind: 'mask', label, colour: null, texture: null };
  }
  if (p.kind === 'node') {
    const n = byId.get(p.nodeId);
    if (!n) return none('picture', 'A node', 'Product missing: its node was deleted. Pick another.');
    const kind = nodeKind(n.type);
    const label = labelOf(n, 'A node');
    if (kind === 'mask') {
      if (n.type === 'blobTrack') return { kind, label, colour: null, texture: null, mask: { mask: ref(n.id, 'inside'), texture: n.inputs.texture?.connection ? { ...n.inputs.texture.connection } : null, blobs: ref(n.id, 'texture') } };
      return { kind, label, colour: null, texture: null, mask: { mask: ref(n.id, n.type === 'segment' ? 'mask' : 'mask'), texture: n.outputs.texture ? ref(n.id, 'texture') : null, blobs: null } };
    }
    const tex = PICTURE_NODES.has(n.type) && n.outputs.texture ? ref(n.id, 'texture') : n.type === 'pass' ? ref(n.id, 'texture') : null;
    const out = n.outputs[p.output] ? p.output : Object.entries(n.outputs).find(([, s]) => s.type === 'vec3')?.[0];
    return { kind, label, colour: out ? ref(n.id, out) : null, texture: tex };
  }
  // A builder's build.
  const kindInfo = sceneKindInfo(p.scene);
  const kind = buildKind(p.scene);
  if (!byId.has(p.id)) return none(kind, kindInfo.title, `Product missing: the ${kindInfo.title} was deleted. Pick another.`);
  // Its own nodes: Combine's glue reading only from it is not part of it.
  const ids = new Set([...builtSceneIds(nodes, { kind: p.scene, id: p.id })].filter(id => !byId.get(id)?.params[CB_BUILD]));
  // A build's name: the one you gave it, else its kind ("2D scene"), not its anchor node's type ("UV").
  const own = byId.get(p.id)?.params.label;
  const label = typeof own === 'string' && own.trim() && own !== 'Scene' ? own.trim() : kindInfo.title;
  if (p.scene === '3d') {
    const b = findBuild(nodes as GraphNode[], p.id);
    const loop = b?.byRole.get('march')?.node;
    const cam = b?.byRole.get('camera')?.node;
    // The 3D picture: what fed the Output, else the end of its chain (Tone Map, or the compose before it).
    const colour = pictureOf(nodes, ids, p.out) ?? (loop?.outputs.color ? ref(loop.id, 'color') : null);
    return {
      kind, label, colour, texture: null, cam: cam?.id, sceneGroup: p.id,
      loop: loop ? { id: loop.id, dist: !!loop.outputs.dist, hit: !!loop.outputs.hit } : undefined,
      ...(loop && cam ? {} : { missing: 'This 3D scene has no March Loop and camera to join.' }),
    };
  }
  if (p.scene === 'splat') {
    const b = findSplatBuild(nodes, p.id);
    return { kind, label, colour: b ? ref(p.id, 'color') : null, texture: null, splat: p.id, cam: b?.byRole.get('camera')?.id };
  }
  if (p.scene === 'agents') {
    const draw = drawOf(nodes, p.id);
    if (!draw) return none(kind, label, 'This Agents group has no Draw agents to show it.');
    return { kind, label, colour: ref(draw.id, 'color'), texture: draw.outputs.texture ? ref(draw.id, 'texture') : null, draw: { id: draw.id, d3: byId.get(p.id)?.params.space === '3d' } };
  }
  return { kind, label, colour: pictureOf(nodes, ids, p.out), texture: null };
}

/** One product the picker offers from the graph ("From this graph"). */
export interface GraphProduct { ref: ProductRef; kind: ProductKind; label: string; detail: string }

/**
 * What the graph already has to combine (docs/combine-plan.md §3.3, "From this graph"): the builders' builds, and the
 * loose Texture / Video Inputs, Segments and Blob Tracks. Nodes inside a build, or Combine's own glue, are left out.
 */
export function graphProducts(nodes: readonly GraphNode[]): GraphProduct[] {
  const out: GraphProduct[] = [];
  const inBuild = new Set<string>();
  for (const b of builtScenes(nodes)) {
    if (b.kind === 'combine') continue;
    for (const id of builtSceneIds(nodes, b)) inBuild.add(id);
    out.push({ ref: { kind: 'build', scene: b.kind, id: b.id }, kind: buildKind(b.kind), label: b.label, detail: `${sceneKindInfo(b.kind).title} · ${b.detail}` });
  }
  for (const n of nodes) {
    if (inBuild.has(n.id) || n.params[CB_BUILD]) continue;
    if (PICTURE_NODES.has(n.type)) out.push({ ref: { kind: 'node', nodeId: n.id, output: 'color' }, kind: 'picture', label: labelOf(n, 'Picture'), detail: getNodeDefinition(n.type)?.label ?? n.type });
    else if (n.type === 'segment' || n.type === 'blobTrack') out.push({ ref: { kind: 'node', nodeId: n.id, output: n.type === 'segment' ? 'mask' : 'inside' }, kind: 'mask', label: labelOf(n, 'Mask'), detail: getNodeDefinition(n.type)?.label ?? n.type });
  }
  return out;
}

/** Two product refs name the same product. */
export function sameProduct(a: ProductRef, b: ProductRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'build' && b.kind === 'build') return a.id === b.id;
  if (a.kind === 'node' && b.kind === 'node') return a.nodeId === b.nodeId;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The top-level nodes a product is made of (empty for a mask the layer makes). */
export function productNodeIds(p: ProductRef, nodes: readonly GraphNode[]): Set<string> {
  if (p.kind === 'build') {
    const glue = new Set(nodes.filter(n => n.params[CB_BUILD]).map(n => n.id));
    return new Set([...builtSceneIds(nodes, { kind: p.scene, id: p.id })].filter(id => !glue.has(id)));
  }
  if (p.kind === 'node') return new Set(nodes.some(n => n.id === p.nodeId) ? [p.nodeId] : []);
  return new Set();
}
