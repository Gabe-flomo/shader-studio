/**
 * spec.ts — what the 2D Scene Builder describes (docs/scene-builder-2d-plan.md).
 *
 * A 2D scene is three things stacked: a SPACE (a list of transforms applied to the picture's
 * coordinates: pixelate, mirror, kaleidoscope, warp…), LAYERS of shapes painted over the
 * background in order, and a LOOK (glow, colour by a palette, tone map, post effects).
 *
 * A layer is a shape or a combine group (union, subtract, intersect, each optionally smooth) of
 * shapes and further groups. Any item can be placed (move, rotate, scale), given motion (orbit,
 * bob, spin, pulse) and duplicated (a ring of copies, optionally rings of rings, optionally the
 * whole ring repeated at bigger scales).
 *
 * Every shape and space transform lives in a catalogue below, so the form, the recipe language,
 * the graph builder and the thumbnails all read the same table and cannot drift apart.
 *
 * Pure data: no React, no store.
 */

import type { GridSpec } from './grid';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** One setting of a shape or space transform: its recipe key, the node param(s) it sets and its range. */
export interface ParamDef {
  /** The recipe key (`r`, `size`, `by`…). */
  key: string;
  label: string;
  /** Node param it sets; two for a vector (x, y). Empty: the builder handles it. */
  param: string | [string, string];
  def: number | Vec2;
  min: number;
  max: number;
  step: number;
  /** Shown in degrees, stored on the node in radians. */
  deg?: boolean;
  hint?: string;
}

const P = (key: string, label: string, param: ParamDef['param'], def: number | Vec2, min: number, max: number, step = 0.01, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, param, def, min, max, step, ...extra });

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface ShapeDef {
  kind: string;
  label: string;
  /** Other words the recipe accepts for it. */
  aliases: string[];
  /** The Shape SDF node's `shape` setting; `ring` is the Ring SDF node. */
  shape: string;
  params: ParamDef[];
  /** A unit-size shape with no size of its own (Heart): its `size` scales the placement instead. */
  unit?: boolean;
  blurb: string;
}

export const SHAPES: ShapeDef[] = [
  { kind: 'circle', label: 'Circle', aliases: ['disc', 'disk', 'dot', 'ball'], shape: 'circle', blurb: 'A disc.',
    params: [P('r', 'Radius', 'r', 0.3, 0.01, 2)] },
  { kind: 'ring', label: 'Ring', aliases: ['hoop', 'annulus', 'donut'], shape: 'ring', blurb: 'A circle line with some thickness.',
    params: [P('r', 'Radius', 'radius', 0.3, 0.01, 2), P('th', 'Thickness', '', 0.04, 0.002, 0.5, 0.002, { hint: 'How thick the line is (the Ring SDF is a hairline; an Offset widens it).' })] },
  { kind: 'box', label: 'Box', aliases: ['square', 'rectangle', 'rect', 'block'], shape: 'box', blurb: 'A rectangle.',
    params: [P('size', 'Size (half)', ['rx', 'ry'], [0.3, 0.2], 0.01, 2, 0.01, { hint: 'Half its width and half its height.' })] },
  { kind: 'rounded-box', label: 'Rounded box', aliases: ['roundbox', 'rounded-rect', 'pill'], shape: 'roundedBox', blurb: 'A rectangle with round corners.',
    params: [P('size', 'Size (half)', ['rx', 'ry'], [0.3, 0.2], 0.01, 2), P('round', 'Corner', 'roundness', 0.08, 0, 0.5, 0.005)] },
  { kind: 'triangle', label: 'Triangle', aliases: ['tri'], shape: 'triangle', blurb: 'An equilateral triangle.',
    params: [P('r', 'Size', 'r', 0.3, 0.01, 2)] },
  { kind: 'diamond', label: 'Diamond', aliases: ['rhombus'], shape: 'rhombus', blurb: 'A rhombus.',
    params: [P('size', 'Size (half)', ['rx', 'ry'], [0.22, 0.34], 0.01, 2)] },
  { kind: 'pentagon', label: 'Pentagon', aliases: [], shape: 'pentagon', blurb: 'Five equal sides.',
    params: [P('r', 'Size', 'r', 0.3, 0.01, 2)] },
  { kind: 'hexagon', label: 'Hexagon', aliases: ['hex'], shape: 'hexagon', blurb: 'Six equal sides.',
    params: [P('r', 'Size', 'r', 0.3, 0.01, 2)] },
  { kind: 'octagon', label: 'Octagon', aliases: [], shape: 'octagon', blurb: 'Eight equal sides.',
    params: [P('r', 'Size', 'r', 0.3, 0.01, 2)] },
  { kind: 'star', label: 'Star', aliases: ['star5'], shape: 'star5', blurb: 'A five-point star; Inner sets how deep the points are.',
    params: [P('r', 'Size', 'r', 0.32, 0.01, 2), P('inner', 'Inner', 'rf', 0.45, 0.1, 0.9)] },
  { kind: 'burst', label: 'Burst', aliases: ['starn', 'spikes'], shape: 'starN', blurb: 'A star with any number of points.',
    params: [P('r', 'Size', 'r', 0.32, 0.01, 2), P('points', 'Points', 'n_pts', 8, 3, 16, 1), P('sharp', 'Sharpness', 'm_pts', 3, 2, 6, 0.1, { hint: '2 is the spikiest; as it nears the number of points the star fills out.' })] },
  { kind: 'hexagram', label: 'Hexagram', aliases: ['star-of-david'], shape: 'hexagram', blurb: 'A six-point star.',
    params: [P('r', 'Size', 'r', 0.2, 0.01, 2)] },
  { kind: 'heart', label: 'Heart', aliases: [], shape: 'heart', unit: true, blurb: 'A heart.',
    params: [P('size', 'Size', '', 0.3, 0.02, 2)] },
  { kind: 'cross', label: 'Cross', aliases: ['plus'], shape: 'cross', blurb: 'A plus sign.',
    params: [P('size', 'Size (half)', ['rx', 'ry'], [0.32, 0.1], 0.01, 2), P('round', 'Corner', 'roundness', 0, 0, 0.3, 0.005)] },
  { kind: 'ellipse', label: 'Ellipse', aliases: ['oval', 'egg'], shape: 'ellipse', blurb: 'A stretched circle.',
    params: [P('size', 'Radii', ['rx', 'ry'], [0.36, 0.2], 0.01, 2)] },
  { kind: 'moon', label: 'Moon', aliases: ['crescent'], shape: 'moon', blurb: 'A crescent.',
    params: [P('r', 'Radius', 'r', 0.3, 0.02, 2), P('cut', 'Cut radius', 'r2', 0.24, 0.02, 2), P('d', 'Offset', 'd', 0.18, 0, 2)] },
  { kind: 'vesica', label: 'Vesica', aliases: ['lens', 'eye'], shape: 'vesica', blurb: 'The lens where two circles overlap.',
    params: [P('w', 'Width', 'rx', 0.34, 0.02, 2), P('h', 'Height', 'he', 0.18, 0.02, 2)] },
];

export const SHAPE_BY_KIND: Record<string, ShapeDef> = Object.fromEntries(SHAPES.map(s => [s.kind, s]));

// ── Space transforms ────────────────────────────────────────────────────────

export interface SpaceDef {
  kind: string;
  label: string;
  aliases: string[];
  /** The node it builds. */
  type: string;
  /** Position socket in and out. */
  posIn: string;
  posOut: string;
  params: ParamDef[];
  /** A choice setting (`mirror x`). */
  select?: { key: string; label: string; param: string; def: string; options: string[] };
  /** Moves with Time when its speed is above 0 (warp, wave) or always (rotate's spin). */
  animated?: boolean;
  blurb: string;
}

export const SPACES: SpaceDef[] = [
  { kind: 'zoom', label: 'Zoom', aliases: ['scale', 'magnify'], type: 'uvTransform2d', posIn: 'uv', posOut: 'result', blurb: 'Magnifies the picture (above 1) or shrinks it.',
    params: [P('by', 'Zoom', '', 1.5, 0.1, 8)] },
  { kind: 'rotate', label: 'Rotate', aliases: ['turn', 'spin'], type: 'rotate2d', posIn: 'input', posOut: 'output', animated: true, blurb: 'Turns the picture; Spin keeps it turning.',
    params: [P('angle', 'Angle', 'angle', 30, -360, 360, 0.5, { deg: true }), P('spin', 'Spin', '', 0, -2, 2, 0.01, { hint: 'Whole turns a second. 0 stands still.' })] },
  { kind: 'move', label: 'Move', aliases: ['offset', 'shift', 'pan', 'translate'], type: 'uvTransform2d', posIn: 'uv', posOut: 'result', blurb: 'Slides the picture.',
    params: [P('by', 'By', '', [0.25, 0], -3, 3)] },
  { kind: 'pixelate', label: 'Pixelate', aliases: ['pixel', 'mosaic', 'blocks'], type: 'pixelate', posIn: 'uv', posOut: 'uv', blurb: 'Snaps the picture to a coarse grid of blocks.',
    params: [P('size', 'Block size', 'pixelSize', 0.06, 0.005, 0.5, 0.005)] },
  { kind: 'tile', label: 'Tile', aliases: ['repeat', 'grid', 'cells'], type: 'infiniteRepeatSpace', posIn: 'input', posOut: 'output', blurb: 'Repeats the picture in a grid of cells.',
    params: [P('cell', 'Cell size', ['cellX', 'cellY'], [1, 1], 0.1, 4)] },
  { kind: 'mirror-tile', label: 'Mirror tile', aliases: ['mirrored-repeat', 'flip-tile'], type: 'mirroredRepeat2D', posIn: 'input', posOut: 'output', blurb: 'A tiling where neighbours are mirror images, so the seams match.',
    params: [P('cell', 'Cell size', ['cellX', 'cellY'], [1, 1], 0.1, 4)] },
  { kind: 'mirror', label: 'Mirror', aliases: ['symmetry', 'reflect', 'flip'], type: 'mirror2D', posIn: 'uv', posOut: 'uv', blurb: 'Folds the picture over a line so both sides match.',
    select: { key: 'axes', label: 'Mirror', param: 'axes', def: 'x', options: ['x', 'y', 'xy'] }, params: [] },
  { kind: 'kaleidoscope', label: 'Kaleidoscope', aliases: ['kaleido', 'mandala'], type: 'kaleidoSpace', posIn: 'input', posOut: 'output', blurb: 'Folds space into mirrored wedges round the centre.',
    params: [P('n', 'Segments', 'segments', 6, 1, 24, 1), P('angle', 'Rotate', 'rotate', 0, -180, 180, 0.5, { deg: true })] },
  { kind: 'polar-repeat', label: 'Polar repeat', aliases: ['radial', 'petals', 'around', 'angular'], type: 'angularRepeat2D', posIn: 'input', posOut: 'output', blurb: 'Copies the picture round the centre, like slices of a cake.',
    params: [P('count', 'Copies', 'count', 6, 2, 32, 1)] },
  { kind: 'polar', label: 'Polar', aliases: ['polar-map'], type: 'polarSpace', posIn: 'input', posOut: 'output', blurb: 'Reads the picture as angle and distance: straight lines become spirals and circles.',
    params: [P('twist', 'Twist', 'twist', 0, -5, 5), P('scale', 'Radial scale', 'radialScale', 1, 0.1, 5)] },
  { kind: 'swirl', label: 'Swirl', aliases: ['twist', 'vortex', 'whirl'], type: 'swirlSpace', posIn: 'input', posOut: 'output', blurb: 'Twists space round the centre, most at the middle.',
    params: [P('amount', 'Strength', 'strength', 2, -10, 10, 0.1), P('falloff', 'Falloff', 'falloff', 1, 0.1, 5, 0.1)] },
  { kind: 'warp', label: 'Noise warp', aliases: ['distort', 'wobble', 'domain-warp', 'organic'], type: 'domainWarp', posIn: 'uv', posOut: 'uv', animated: true, blurb: 'Pushes space about with smooth noise: organic, flowing edges.',
    params: [P('amount', 'Strength', 'strength', 0.3, 0, 1.5), P('scale', 'Scale', 'scale', 1.5, 0.1, 6), P('speed', 'Speed', 'time_scale', 0, 0, 2, 0.01, { hint: 'How fast the noise drifts. 0 stands still.' })] },
  { kind: 'wave', label: 'Wave', aliases: ['ripple', 'wavy'], type: 'rippleSpace', posIn: 'input', posOut: 'output', animated: true, blurb: 'Shifts space by sines: a rippling, wavy picture.',
    params: [P('freq', 'Frequency', '', 5, 0.5, 20, 0.1), P('amp', 'Amplitude', '', 0.1, 0, 0.6), P('speed', 'Speed', '', 0, -4, 4, 0.05, { hint: 'How fast the waves travel. 0 stands still.' })] },
  { kind: 'fisheye', label: 'Fisheye', aliases: ['bulge', 'lens'], type: 'sphericalSpace', posIn: 'input', posOut: 'output', blurb: 'Bulges the picture like a wide-angle lens.',
    params: [P('amount', 'Strength', 'strength', 0.5, -1, 1)] },
  { kind: 'invert', label: 'Invert', aliases: ['inversion', 'inside-out'], type: 'inversionSpace', posIn: 'input', posOut: 'output', blurb: 'Turns space inside out round a circle.',
    params: [P('radius', 'Radius', 'radius', 1, 0.1, 3)] },
];

export const SPACE_BY_KIND: Record<string, SpaceDef> = Object.fromEntries(SPACES.map(s => [s.kind, s]));

// ── Motion and duplication ──────────────────────────────────────────────────

export type MotionKind = 'orbit' | 'bob' | 'spin' | 'pulse';

export interface MotionDef {
  kind: MotionKind;
  label: string;
  blurb: string;
  /** Which settings it uses besides speed and phase. */
  amount?: { label: string; min: number; max: number; def: number };
  dir?: boolean;
  speed: number;
}

export const MOTIONS: MotionDef[] = [
  { kind: 'orbit', label: 'Orbit', blurb: 'Goes round a circle about where it sits.', amount: { label: 'Radius', min: 0, max: 1.5, def: 0.3 }, speed: 0.25 },
  { kind: 'bob', label: 'Bob', blurb: 'Slides back and forth along a line.', amount: { label: 'Distance', min: 0, max: 1.5, def: 0.15 }, dir: true, speed: 0.5 },
  { kind: 'spin', label: 'Spin', blurb: 'Turns about its own centre.', speed: 0.25 },
  { kind: 'pulse', label: 'Pulse', blurb: 'Swells and shrinks.', amount: { label: 'Swell', min: 0, max: 0.95, def: 0.25 }, speed: 0.5 },
];
export const MOTION_BY_KIND: Record<string, MotionDef> = Object.fromEntries(MOTIONS.map(m => [m.kind, m]));

export interface MotionSpec {
  id: string;
  kind: MotionKind;
  /** Whole cycles a second. */
  speed: number;
  amount: number;
  /** Degrees. */
  phase: number;
  /** Degrees: the line a bob slides along. */
  dir: number;
}

/** A ring of copies about the item's centre: `count` copies, each `radius` out, optionally rings of rings and the whole repeated at bigger scales. */
export interface DupSpec {
  count: number;
  radius: number;
  /** Rings of rings: each copy of the ring is itself a ring of this many copies at this radius. */
  inner?: { count: number; radius: number };
  /** The whole ring repeated `levels` times, each `factor` times the one before (1 level: no repeat). */
  levels: number;
  factor: number;
}

export const MAX_DUP = 32;
export const MAX_LEVELS = 6;

// ── Items ───────────────────────────────────────────────────────────────────

export type CombineOp = 'union' | 'subtract' | 'intersect';

interface ItemBase {
  id: string;
  name: string;
  /** Where its centre is. */
  at: Vec2;
  /** Turned this many degrees, counter-clockwise. */
  rot: number;
  scale: number;
  motion: MotionSpec[];
  dup: DupSpec | null;
  /** Grows the edge outward by this much, which rounds its corners (0: as it is). */
  inflate: number;
  /** Above 0: only an outline this thick (a shell). */
  hollow: number;
  /** A layer's colour (a nested item's is not used). */
  color: Vec3;
  /** With Glow set to "selected": this layer glows. */
  glow: boolean;
}

export interface ShapeSpec extends ItemBase {
  type: 'shape';
  kind: string;
  /** Size settings by ParamDef key. */
  size: Record<string, number | Vec2>;
}

export interface GroupSpec extends ItemBase {
  type: 'group';
  op: CombineOp;
  /** Blend radius: 0 is the hard operation, above 0 the smooth one. */
  k: number;
  children: Item[];
}

export type Item = ShapeSpec | GroupSpec;

export interface SpaceOp {
  id: string;
  kind: string;
  /** Numbers and vectors by ParamDef key; selects by their key. */
  values: Record<string, number | Vec2 | string>;
}

export const TONE_MODES = ['none', 'aces', 'agx', 'hable', 'reinhard2', 'tanh', 'oklab'] as const;
export type ToneMode = typeof TONE_MODES[number];

export type GlowMode = 'off' | 'all' | 'selected';
export const COLOUR_BYS = ['layer', 'length', 'angle', 'x', 'y', 'time', 'distance'] as const;
export type ColourBy = typeof COLOUR_BYS[number];

export interface LookSpec {
  bg: Vec3;
  glow: { mode: GlowMode; amount: number; falloff: number; tint: Vec3 | null };
  colour: { by: ColourBy; palette: string; scale: number; speed: number };
  tone: ToneMode;
  post: { bloom: number; vignette: number; grain: number; scanlines: number };
}

export type Show2D = 'picture' | 'distance' | 'mask' | 'space';
export interface OutputSpec { show: Show2D; /** Colour the number through this palette (a key of PALETTES). */ palette?: string }

export interface Scene2D {
  space: SpaceOp[];
  layers: Item[];
  /** A grid of cells drawn over the layers (grid.ts), or none. */
  grid?: GridSpec | null;
  look: LookSpec;
  output?: OutputSpec;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_COLOR: Vec3 = [0.92, 0.92, 0.96];

export const DEFAULT_LOOK: LookSpec = {
  bg: [0.02, 0.02, 0.04],
  glow: { mode: 'off', amount: 0.012, falloff: 1.2, tint: null },
  colour: { by: 'layer', palette: 'sunset', scale: 1, speed: 0 },
  tone: 'none',
  post: { bloom: 0, vignette: 0, grain: 0, scanlines: 0 },
};

export const OUTPUT_SHOWS: Array<{ show: Show2D; label: string; blurb: string; words: string[] }> = [
  { show: 'picture', label: 'Picture', words: ['picture', 'image'], blurb: 'The finished picture (the default).' },
  { show: 'distance', label: 'Distance bands', words: ['distance', 'dist', 'field'], blurb: 'The distance to the nearest shape as repeating bands: how the shapes measure space.' },
  { show: 'mask', label: 'Mask', words: ['mask', 'silhouette', 'coverage'], blurb: 'White where a shape is, black elsewhere.' },
  { show: 'space', label: 'Space', words: ['space', 'checker', 'warp'], blurb: 'A checkerboard drawn through the space transforms: see what the Space tab does.' },
];
export const SHOW_WORDS: Record<string, Show2D> = Object.fromEntries(OUTPUT_SHOWS.flatMap(o => o.words.map(w => [w, o.show])));

export const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const cloneVal = <T>(v: T): T => (Array.isArray(v) ? [...v] as T : v);

export function defaultSize(kind: string): Record<string, number | Vec2> {
  return Object.fromEntries((SHAPE_BY_KIND[kind]?.params ?? []).map(p => [p.key, cloneVal(p.def)]));
}

export function defaultSpaceValues(kind: string): SpaceOp['values'] {
  const def = SPACE_BY_KIND[kind];
  if (!def) return {};
  const out: SpaceOp['values'] = Object.fromEntries(def.params.map(p => [p.key, cloneVal(p.def)]));
  if (def.select) out[def.select.key] = def.select.def;
  return out;
}

const base = (id: string, over: Partial<ItemBase>): ItemBase => ({
  id, name: '', at: [0, 0], rot: 0, scale: 1, motion: [], dup: null, inflate: 0, hollow: 0, color: [...DEFAULT_COLOR] as Vec3, glow: false, ...over,
});

export function newShape(kind: string, id: string, over: Partial<ShapeSpec> = {}): ShapeSpec {
  return { ...base(id, over), type: 'shape', kind, size: defaultSize(kind), ...over } as ShapeSpec;
}

export function newGroup(id: string, over: Partial<GroupSpec> = {}): GroupSpec {
  return { ...base(id, over), type: 'group', op: 'union', k: 0, children: [], ...over } as GroupSpec;
}

export function newSpaceOp(kind: string, id: string, values: SpaceOp['values'] = {}): SpaceOp {
  return { id, kind, values: { ...defaultSpaceValues(kind), ...values } };
}

export function newMotion(kind: MotionKind, id: string, over: Partial<MotionSpec> = {}): MotionSpec {
  const d = MOTION_BY_KIND[kind];
  return { id, kind, speed: d.speed, amount: d.amount?.def ?? 0, phase: 0, dir: kind === 'bob' ? 90 : 0, ...over };
}

export function newDup(over: Partial<DupSpec> = {}): DupSpec {
  return { count: 6, radius: 0.5, levels: 1, factor: 1.6, ...over };
}

export function emptyScene(): Scene2D {
  return { space: [], layers: [], look: structuredClone(DEFAULT_LOOK) };
}

/** What a new builder opens with: one glowing ring. */
export function starterScene(): Scene2D {
  const s = emptyScene();
  s.layers.push(newShape('ring', 's1', { color: [0.3, 0.8, 1], glow: true, size: { r: 0.4, th: 0.03 } }));
  s.look.glow.mode = 'all';
  s.look.tone = 'aces';
  return s;
}

// ── Walking the tree ────────────────────────────────────────────────────────

export function walkItems(items: Item[], visit: (it: Item, parent: GroupSpec | null, depth: number) => void, parent: GroupSpec | null = null, depth = 0): void {
  for (const it of items) {
    visit(it, parent, depth);
    if (it.type === 'group') walkItems(it.children, visit, it, depth + 1);
  }
}

export function allItems(spec: Scene2D): Item[] {
  const out: Item[] = [];
  walkItems(spec.layers, it => { out.push(it); });
  return out;
}

export function allShapes(spec: Scene2D): ShapeSpec[] {
  return allItems(spec).filter((i): i is ShapeSpec => i.type === 'shape');
}

export function findItem(spec: Scene2D, id: string): { item: Item; parent: GroupSpec | null; index: number } | null {
  let hit: { item: Item; parent: GroupSpec | null; index: number } | null = null;
  walkItems(spec.layers, (it, parent) => {
    if (hit || it.id !== id) return;
    const list = parent ? parent.children : spec.layers;
    hit = { item: it, parent, index: list.indexOf(it) };
  });
  return hit;
}

/** The ids already used by items, motions and space transforms. */
function usedIds(spec: Scene2D): Set<string> {
  const used = new Set<string>(spec.space.map(s => s.id));
  walkItems(spec.layers, it => { used.add(it.id); for (const m of it.motion) used.add(m.id); });
  return used;
}

/** A fresh id that nothing in `spec` has yet: `s3`, `g2`, `m5` (motion), `p1` (space). */
export function nextId(spec: Scene2D | null, prefix: 's' | 'g' | 'm' | 'p'): string {
  const used = spec ? usedIds(spec) : new Set<string>();
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

/** What an item is called in notes and lists. */
export function itemName(spec: Scene2D | null, it: Item): string {
  if (it.name.trim()) return it.name.trim();
  if (it.type === 'group') return opLabel(it);
  const label = SHAPE_BY_KIND[it.kind]?.label ?? it.kind;
  if (!spec) return label;
  const same = allShapes(spec).filter(s => s.kind === it.kind);
  return same.length > 1 ? `${label} ${same.indexOf(it) + 1}` : label;
}

export function opLabel(g: Pick<GroupSpec, 'op' | 'k'>): string {
  const base = g.op === 'union' ? 'Union' : g.op === 'subtract' ? 'Subtract' : 'Intersect';
  return g.k > 0 ? `Smooth ${base.toLowerCase()}` : base;
}

/** A line about what an item has done to it, for tree rows. */
export function itemSummary(it: Item): string {
  const parts: string[] = [];
  if (it.dup) parts.push(`${it.dup.inner ? `${it.dup.count}×${it.dup.inner.count}` : it.dup.count}${it.dup.levels > 1 ? `×${it.dup.levels} sizes` : ' copies'}`);
  for (const m of it.motion) parts.push(MOTION_BY_KIND[m.kind]?.label.toLowerCase() ?? m.kind);
  if (it.hollow > 0) parts.push('outline');
  return parts.join(' · ');
}

/** A space transform's chip words: its label and its main setting. */
export function spaceSummary(op: SpaceOp): { label: string; value: string } {
  const def = SPACE_BY_KIND[op.kind];
  if (!def) return { label: op.kind, value: '' };
  const r = (n: number) => String(Math.round(n * 1000) / 1000);
  if (def.select) return { label: def.label, value: String(op.values[def.select.key] ?? def.select.def) };
  const first = def.params[0];
  if (!first) return { label: def.label, value: '' };
  const v = op.values[first.key];
  if (Array.isArray(v)) return { label: def.label, value: v[0] === v[1] ? r(v[0]) : v.map(r).join(',') };
  return { label: def.label, value: typeof v === 'number' ? `${r(v)}${first.deg ? '°' : ''}` : '' };
}

/** The scene with ids renumbered in tree order: two scenes that say the same thing compare equal. */
export function canonicalScene(spec: Scene2D): Scene2D {
  const out = structuredClone(spec);
  if (!out.output || out.output.show === 'picture') delete out.output;
  else if (!out.output.palette) delete out.output.palette;
  let s = 0, g = 0, m = 0, p = 0;
  for (const op of out.space) op.id = `p${++p}`;
  walkItems(out.layers, it => {
    it.id = it.type === 'group' ? `g${++g}` : `s${++s}`;
    for (const mo of it.motion) mo.id = `m${++m}`;
  });
  return out;
}

/** Does the scene have anything to draw? */
export function hasShapes(spec: Scene2D): boolean {
  return allShapes(spec).length > 0 || !!spec.grid;
}
