/**
 * spec.ts — what Combine keeps (docs/combine-plan.md §4, docs/combine.md): a stack of layers, the base first, each a
 * product (a builder's build, a node of the graph, or a mask the layer makes) joined to a layer below it by a verb.
 *
 * The spec lives on the top glue node's params (`combine`, apply.ts); the products keep their own builders' specs, so
 * "Edit product" opens the 3D builder on a 3D layer as it would anywhere. Combine owns only the glue between them.
 *
 * Phase 1 builds two verbs: Place in (every pair of docs/combine-plan.md §2.1 but "on a shape"), and Replace mask
 * with, one fill for all. The other verbs are in the matrix (VERB_MATRIX) but not offered yet (`built: false`).
 * Pure: no store, no graph.
 */
import type { SceneKind } from '../builders/sceneKinds';
import type { DepthBakeInfo } from '../nodes/definitions/depth';

/** What a layer brings (docs/combine-plan.md §1). */
export type ProductKind = 'picture' | 'pictureDepth' | 'scene3d' | 'points' | 'mask' | 'motion';

export type VerbId = 'placeIn' | 'relight' | 'collide' | 'follow' | 'spawn' | 'toPoints' | 'replaceMask';

export type MaskFind = 'people' | 'objects' | 'click';

export interface NodeRef { nodeId: string; outputKey: string }

/** A layer's product: a builder's build, a loose node's output, a mask the layer makes, or a light-rig look (later). */
export type ProductRef =
  /** A builder's build (its own spec stays on it). `out`: its picture as it fed the Output when it was added. */
  | { kind: 'build'; scene: SceneKind; id: string; out?: NodeRef }
  /** A loose node's output (a Texture or Video Input, a Segment, a Blob Track, the node a Warp made…). */
  | { kind: 'node'; nodeId: string; output: string }
  /** A Segment the layer makes on the picture under it: People, Objects (its kinds) or Click. */
  | { kind: 'mask'; find: MaskFind; classes?: string }
  | { kind: 'rig'; look: string };

/**
 * Replace mask's fills. Phase 1 builds `all` (one fill for every blob: the layer's product). `perBlob` is the hook for
 * phase 3: each blob its own fill, chosen By order (oldest first, the default) or By ID, the rest getting `rest`.
 */
export interface FillSpec {
  mode: 'all' | 'perBlob';
  by: 'order' | 'id';
  rest?: ProductRef;
  blobs: { key: number; fill: ProductRef }[];
}

export type SettingValue = number | string | boolean;

export interface CombineLayer {
  /** 'L1', 'L2'…: stable, the roles of its glue start with it. */
  id: string;
  product: ProductRef;
  verb: VerbId | 'base';
  /** The layer it goes on (default: the one below). */
  on?: string;
  /** The verb's own settings (VERB_SETTINGS lists them per verb and pair). */
  settings: Record<string, SettingValue>;
  /** Param → a one-line expression (phase 2, docs/combine-plan.md §2.8). */
  exprs?: Record<string, string>;
  fills?: FillSpec;
  muted?: boolean;
  /** A picture's depth, generated once with Generate depth (builders/depthPicture.ts): the layer's Depth node plays it. */
  depthBake?: DepthBakeInfo | null;
}

export interface CombineSpec {
  v: 1;
  /** Bottom (the base) first. */
  layers: CombineLayer[];
}

export const emptyCombine = (): CombineSpec => ({ v: 1, layers: [] });

// ── Verbs ────────────────────────────────────────────────────────────────────

export interface VerbInfo {
  id: VerbId;
  label: string;
  /** "Put A in B". */
  reads: string;
  /** Built in this phase (offered by the picker). */
  built: boolean;
}

export const VERBS: Record<VerbId, VerbInfo> = {
  placeIn: { id: 'placeIn', label: 'Place in', reads: 'Put it in the layer below', built: true },
  replaceMask: { id: 'replaceMask', label: 'Replace mask with', reads: 'Fill what the mask finds with it', built: true },
  relight: { id: 'relight', label: 'Relight with', reads: 'Light a photo with it', built: false },
  collide: { id: 'collide', label: 'Collide with', reads: 'Its points bounce, slide or settle on it', built: false },
  follow: { id: 'follow', label: 'Follow the shape', reads: 'Its points trace or cling to it', built: false },
  spawn: { id: 'spawn', label: 'Spawn from', reads: 'Its points are born from it', built: false },
  toPoints: { id: 'toPoints', label: 'Turn into points', reads: 'It becomes a point cloud', built: false },
};

/** What the product kinds are called on the cards. */
export const PRODUCT_LABEL: Record<ProductKind, string> = {
  picture: 'Picture', pictureDepth: 'Picture + depth', scene3d: '3D scene', points: 'Points', mask: 'Mask', motion: 'Motion',
};

/**
 * Which verbs join a new layer of kind `a` to a layer of kind `b` (docs/combine-plan.md §1.1). Splats count as a 3D
 * scene; `splat` says the new layer is one (Splats → 3D is Place in; two 3D builds are the 3D builder's job).
 */
export function verbsFor(a: ProductKind, b: ProductKind, o: { splat?: boolean } = {}): VerbId[] {
  const out: VerbId[] = [];
  const pic = (k: ProductKind) => k === 'picture' || k === 'pictureDepth';
  if (a === 'mask') return pic(b) ? ['replaceMask'] : [];
  if (b === 'mask') {
    if (pic(a) || a === 'scene3d' || a === 'points') out.push('replaceMask');
    if (a === 'points') out.push('collide', 'follow', 'spawn');
    return out;
  }
  if (pic(a)) {
    if (pic(b) || b === 'scene3d') out.push('placeIn');
    return out;
  }
  if (a === 'scene3d') {
    if (pic(b)) out.push('placeIn');
    if (b === 'pictureDepth') out.push('relight');
    if (b === 'scene3d' && o.splat) out.push('placeIn');
    return out;
  }
  if (a === 'points') {
    if (pic(b) || b === 'scene3d') out.push('placeIn', 'spawn');
    if (b === 'scene3d') out.push('collide', 'follow');
    if (b === 'picture' || b === 'motion') out.push('follow');
    return [...new Set(out)];
  }
  return out;
}

/** The verbs the picker offers for the pair: valid and built in this phase. */
export const offeredVerbs = (a: ProductKind, b: ProductKind, o: { splat?: boolean } = {}): VerbId[] => verbsFor(a, b, o).filter(v => VERBS[v].built);

// ── Settings ─────────────────────────────────────────────────────────────────

/** How Place in puts a picture in a 3D scene (docs/combine-plan.md §2.1). */
export type PlaceHow3d = 'card' | 'surroundings' | 'depth';
/** How Place in puts a 3D scene on a picture. */
export type PlaceHowPic = 'over' | 'depth';
export type Blend = 'normal' | 'screen' | 'add' | 'multiply' | 'overlay';
/** Replace mask: the fill on each blob (fitted, following it) or the whole frame, masked. */
export type Stick = 'blobs' | 'frame';

/** A layer's settings with their defaults filled in. */
export function settingsOf(layer: CombineLayer, defaults: Record<string, SettingValue>): Record<string, SettingValue> {
  return { ...defaults, ...layer.settings };
}

export const PLACE_DEFAULTS = {
  // Picture on a picture.
  blend: 'normal' as Blend, amount: 1,
  // Picture in 3D.
  how3d: 'card' as PlaceHow3d, x: 0, y: 0.1, z: -0.6, turn: 0, size: 1.6, glow: 0.6,
  // 3D on a picture.
  howPic: 'over' as PlaceHowPic,
  // With depth (both ways): where the picture's near and far things sit, in scene units.
  near: 1.5, far: 8, soft: 0.08,
} satisfies Record<string, SettingValue>;

export const MASK_DEFAULTS = {
  threshold: 0.5, softness: 0.1, grow: 0, invert: false, classes: 'person', maxBlobs: 4,
} satisfies Record<string, SettingValue>;

export const REPLACE_DEFAULTS = {
  stick: 'blobs' as Stick, fit: 'square', padding: 0.15, scale: 1, spin: 0, amount: 1,
} satisfies Record<string, SettingValue>;

export const num = (v: SettingValue | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const str = <T extends string>(v: SettingValue | undefined, allowed: readonly T[], d: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : d);

// ── The stack ────────────────────────────────────────────────────────────────

/** The next free layer id ('L3'). */
export function nextLayerId(spec: CombineSpec): string {
  const used = new Set(spec.layers.map(l => l.id));
  for (let i = 1; ; i++) if (!used.has(`L${i}`)) return `L${i}`;
}

/** The layer `layer` goes on: its `on`, or the one below it. */
export function targetOf(spec: CombineSpec, layer: CombineLayer): CombineLayer | null {
  const i = spec.layers.indexOf(layer);
  if (i <= 0) return null;
  if (layer.on) {
    const t = spec.layers.find(l => l.id === layer.on);
    if (t && spec.layers.indexOf(t) < i) return t;
  }
  return spec.layers[i - 1];
}

/** The product kind of a layer's product, from the stack's view: a mask product is a mask, the rest as `kindOf` says. */
export type KindOf = (ref: ProductRef) => ProductKind | null;

/**
 * What a layer is to the layers above it (docs/combine-plan.md §1, "Result product"): a base is its product; Place in
 * keeps the target's kind; a mask on a picture is a mask; Replace mask's fill gives a picture.
 */
export function resultKind(spec: CombineSpec, layer: CombineLayer, kindOf: KindOf, seen = new Set<string>()): ProductKind | null {
  if (seen.has(layer.id)) return null;
  seen.add(layer.id);
  const own = kindOf(layer.product);
  if (layer.verb === 'base') return own;
  const t = targetOf(spec, layer);
  if (layer.muted) return t ? resultKind(spec, t, kindOf, seen) : own;
  if (layer.verb === 'replaceMask') return own === 'mask' ? 'mask' : 'picture';
  if (layer.verb === 'placeIn') return t ? resultKind(spec, t, kindOf, seen) : own;
  return own;
}

/** Remove a layer: the layers that went on it go on the one it went on (or drop, if none is left below). */
export function removeLayer(spec: CombineSpec, id: string): CombineSpec {
  const gone = spec.layers.find(l => l.id === id);
  if (!gone) return spec;
  const below = targetOf(spec, gone);
  const layers = spec.layers.filter(l => l.id !== id).map(l => (l.on === id ? { ...l, on: below?.id } : l));
  // A new base: the first layer that is left.
  if (layers.length && layers[0].verb !== 'base') layers[0] = { ...layers[0], verb: 'base', on: undefined, settings: {} };
  return { ...spec, layers };
}

/** A short line for a layer card: "Place in · card", "Replace · people". */
export function verbLine(layer: CombineLayer): string {
  if (layer.verb === 'base') return 'Base';
  if (layer.verb === 'replaceMask') return layer.product.kind === 'mask' ? `Find ${layer.product.find}` : 'Replace the mask';
  if (layer.verb === 'placeIn') {
    const how = layer.settings.how3d ?? layer.settings.howPic ?? layer.settings.blend;
    return `Place in${typeof how === 'string' && how !== 'normal' && how !== 'over' ? ` · ${how === 'depth' ? 'by depth' : how}` : ''}`;
  }
  return VERBS[layer.verb].label;
}

/** The spec as stored: known fields only, layers with ids. */
export function normalizeCombine(raw: unknown): CombineSpec | null {
  const r = raw as Partial<CombineSpec> | null;
  if (!r || r.v !== 1 || !Array.isArray(r.layers)) return null;
  const layers = r.layers.filter(l => l && typeof l.id === 'string' && l.product && typeof l.verb === 'string').map(l => ({ ...l, settings: { ...(l.settings ?? {}) } }));
  return { v: 1, layers };
}
