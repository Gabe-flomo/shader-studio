/**
 * spec.ts — what the 3D Scene Builder describes (docs/scene-builder.md).
 *
 * A scene is a tree: groups that combine their children (union, subtract,
 * intersect, each optionally smooth) and shapes at the leaves. Any item can
 * carry warps that bend the space it lives in; the root's warps bend the whole
 * scene. Around the tree sit the look (render mode, lights, fog, background),
 * the camera (the unified orbit camera) and the march quality.
 *
 * Everything the builder knows about a shape or a warp lives in the two
 * catalogues below, so the form, the recipe language, the graph builder and
 * the recogniser all read the same table and cannot drift apart.
 *
 * Pure data: no React, no store.
 */

import type { OutputSpec } from './output';

export type Vec3 = [number, number, number];

// ── Shapes ──────────────────────────────────────────────────────────────────

/** One setting of a shape or warp: its recipe key, the node param(s) it sets and its range. */
export interface ParamDef {
  /** The recipe key (`r`, `size`, `h`…). */
  key: string;
  label: string;
  /** Node param it sets; three for a vector. */
  param: string | [string, string, string];
  def: number | Vec3;
  min: number;
  max: number;
  step: number;
  /** Shown in degrees, stored on the node in radians. */
  deg?: boolean;
  hint?: string;
}

export interface ShapeDef {
  kind: string;
  label: string;
  /** Other words the recipe accepts for it. */
  aliases: string[];
  /** The node it builds (`roundType` when its Round is above 0). */
  type: string;
  roundType?: string;
  /** The position socket (Plane 3D's is `p`). */
  posKey: string;
  /** The distance output (a field's is `surface`). */
  distKey: string;
  params: ParamDef[];
  /** A field that fills all of space: cut to a ball of this radius. */
  field?: boolean;
  /** Not an exact distance: the march wants smaller steps. */
  stepHint?: number;
  /** A 4D shape: built as Lift to 4D (slice `w`, this direction) → Rotate 4D in xw (`spin`) → the shape, measured from p4. */
  fourD?: { slice: 'face' | 'edge' | 'corner' };
  blurb: string;
}

const P = (key: string, label: string, param: ParamDef['param'], def: number | Vec3, min: number, max: number, step = 0.01, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, param, def, min, max, step, ...extra });

export const SHAPES: ShapeDef[] = [
  { kind: 'sphere', label: 'Sphere', aliases: ['ball', 'orb'], type: 'sphereSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'A ball.',
    params: [P('r', 'Radius', 'radius', 0.5, 0.01, 5)] },
  { kind: 'box', label: 'Box', aliases: ['cube', 'rounded-box', 'roundbox'], type: 'boxSDF3D', roundType: 'roundedBoxSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'A box; Round softens its edges.',
    params: [P('size', 'Size (half)', ['sizeX', 'sizeY', 'sizeZ'], [0.5, 0.5, 0.5], 0.01, 5, 0.01, { hint: 'Half its width, height and depth.' }), P('round', 'Round', 'radius', 0, 0, 1, 0.005, { hint: 'Above 0 it becomes a Rounded Box with edges this round.' })] },
  { kind: 'torus', label: 'Torus', aliases: ['donut', 'ring'], type: 'torusSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'A ring lying flat.',
    params: [P('R', 'Ring radius', 'majorR', 0.5, 0.1, 5), P('r', 'Tube radius', 'minorR', 0.2, 0.01, 2)] },
  { kind: 'cone', label: 'Cone', aliases: [], type: 'coneSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'A pointed cone, tip at the top.',
    params: [P('angle', 'Angle', 'angle', 22.92, 0.5, 89, 0.5, { deg: true }), P('h', 'Height', 'height', 1, 0.1, 5)] },
  { kind: 'capped-cone', label: 'Capped cone', aliases: ['frustum'], type: 'cappedConeSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'A cone with its tip cut off.',
    params: [P('h', 'Height', 'height', 0.5, 0.01, 5), P('r1', 'Bottom radius', 'r1', 0.4, 0, 3), P('r2', 'Top radius', 'r2', 0.1, 0, 3)] },
  { kind: 'cylinder', label: 'Cylinder', aliases: ['pillar', 'column', 'rounded-cylinder'], type: 'cylinderSDF3D', roundType: 'roundedCylinderSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'An upright cylinder; Round softens its rims.',
    params: [P('r', 'Radius', 'radius', 0.3, 0.01, 5), P('h', 'Height (half)', 'height', 0.5, 0.01, 5), P('round', 'Round', 'edgeRadius', 0, 0, 0.5, 0.005)] },
  { kind: 'capsule', label: 'Capsule', aliases: ['pill'], type: 'capsuleSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'An upright pill.',
    params: [P('h', 'Height', 'height', 0.6, 0.01, 5), P('r', 'Radius', 'radius', 0.2, 0.01, 2)] },
  { kind: 'plane', label: 'Plane', aliases: ['floor', 'ground'], type: 'planeSDF3D', posKey: 'p', distKey: 'dist', blurb: 'An endless floor.',
    params: [P('y', 'Height', 'height', -0.75, -5, 5)] },
  { kind: 'octahedron', label: 'Octahedron', aliases: ['diamond'], type: 'octahedronSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'Two pyramids base to base.',
    params: [P('s', 'Size', 'size', 0.5, 0.01, 5)] },
  { kind: 'pyramid', label: 'Pyramid', aliases: [], type: 'pyramidSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'A square pyramid.',
    params: [P('h', 'Height', 'height', 0.8, 0.05, 5)] },
  { kind: 'ellipsoid', label: 'Ellipsoid', aliases: ['egg'], type: 'ellipsoidSDF3D', posKey: 'pos', distKey: 'dist', stepHint: 0.8, blurb: 'A squashed ball.',
    params: [P('size', 'Radii', ['rx', 'ry', 'rz'], [0.6, 0.3, 0.4], 0.01, 5)] },
  { kind: 'hex-prism', label: 'Hex prism', aliases: ['hexagon'], type: 'hexPrismSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'A six-sided column.',
    params: [P('r', 'Radius', 'radius', 0.4, 0.01, 3), P('h', 'Height', 'height', 0.2, 0.01, 3)] },
  { kind: 'tri-prism', label: 'Tri prism', aliases: ['triangle'], type: 'triPrismSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'A three-sided column.',
    params: [P('r', 'Radius', 'radius', 0.4, 0.01, 3), P('h', 'Height', 'height', 0.2, 0.01, 3)] },
  { kind: 'link', label: 'Chain link', aliases: ['chain'], type: 'linkSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'One link of a chain.',
    params: [P('len', 'Length', 'length', 0.3, 0, 2), P('R', 'Loop radius', 'r1', 0.25, 0.05, 2), P('r', 'Wire radius', 'r2', 0.08, 0.01, 0.5)] },
  { kind: 'box-frame', label: 'Box frame', aliases: ['frame', 'wireframe'], type: 'boxFrameSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'The twelve edges of a box.',
    params: [P('size', 'Size (half)', ['sizeX', 'sizeY', 'sizeZ'], [0.4, 0.4, 0.4], 0.01, 5), P('t', 'Thickness', 'thickness', 0.05, 0.005, 0.5, 0.005)] },
  { kind: 'capped-torus', label: 'Capped torus', aliases: ['arc'], type: 'cappedTorusSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'Part of a ring.',
    params: [P('R', 'Ring radius', 'majorR', 0.5, 0.05, 3), P('r', 'Tube radius', 'minorR', 0.1, 0.01, 1), P('angle', 'Opening', 'angle', 68.75, 0.5, 180, 0.5, { deg: true })] },
  { kind: 'solid-angle', label: 'Solid angle', aliases: ['wedge'], type: 'solidAngleSDF3D', posKey: 'pos', distKey: 'dist', blurb: 'A ball cut to a cone: an ice-cream scoop.',
    params: [P('r', 'Radius', 'radius', 0.6, 0.05, 3), P('angle', 'Angle', 'angle', 57.3, 0.5, 180, 0.5, { deg: true })] },
  { kind: 'cross', label: 'Cross', aliases: ['plus'], type: 'sdCross3D', posKey: 'pos', distKey: 'dist', blurb: 'Three endless bars crossing: the Menger cutter.',
    params: [P('s', 'Bar size', 'size', 0.3, 0.01, 2)] },
  { kind: 'gyroid', label: 'Gyroid', aliases: [], type: 'gyroidField', posKey: 'pos', distKey: 'surface', field: true, stepHint: 0.6, blurb: 'A curving lattice that fills space, cut to a ball.',
    params: [P('freq', 'Frequency', 'frequency', 3.5, 0.1, 10), P('t', 'Thickness', 'thickness', 0.3, 0.001, 0.5, 0.005), P('ball', 'Ball radius', '', 1.1, 0, 5, 0.01, { hint: 'The ball the lattice is cut to. 0 fills all of space.' })] },
  { kind: 'schwarz-p', label: 'Schwarz-P', aliases: ['schwarz'], type: 'schwarzPField', posKey: 'pos', distKey: 'surface', field: true, stepHint: 0.6, blurb: 'A lattice of round chambers, cut to a ball.',
    params: [P('freq', 'Frequency', 'frequency', 3.5, 0.1, 10), P('t', 'Thickness', 'thickness', 0.3, 0.001, 0.5, 0.005), P('ball', 'Ball radius', '', 1.1, 0, 5, 0.01)] },
  // 4D shapes (docs/4d.md): sliced into the scene. W moves the slice; Spin turns the shape in the xw plane, so the slice morphs.
  { kind: 'hypersphere', label: 'Hypersphere', aliases: ['4d-ball', '4d-sphere'], type: 'hypersphereSDF', posKey: 'p4', distKey: 'dist', fourD: { slice: 'face' }, blurb: 'A 4D ball: its slice is a ball that grows and shrinks as W moves.',
    params: [P('r', 'Radius', 'radius', 0.6, 0.01, 5), P('w', 'Slice (w)', '', 0, -2, 2, 0.01, { hint: 'Where the 3D slice cuts the 4D shape.' }), P('spin', 'Spin', '', 0, -90, 90, 0.5, { hint: 'Degrees a second it turns in the xw plane.' })] },
  { kind: 'tesseract', label: 'Tesseract', aliases: ['hypercube', '4d-cube'], type: 'tesseractSDF', posKey: 'p4', distKey: 'dist', fourD: { slice: 'corner' }, blurb: 'A 4D cube, cut corner-first: as W moves it goes from a point to a tetrahedron, an octahedron and back.',
    params: [P('size', 'Size (half)', 'size', 0.5, 0.01, 5), P('round', 'Round', 'rounding', 0.02, 0, 0.5, 0.005), P('w', 'Slice (w)', '', 0, -2, 2, 0.01, { hint: 'Where the 3D slice cuts the 4D shape.' }), P('spin', 'Spin', '', 12, -90, 90, 0.5, { hint: 'Degrees a second it turns in the xw plane.' })] },
  { kind: 'duocylinder', label: 'Duocylinder', aliases: ['4d-cylinder'], type: 'duocylinderSDF', posKey: 'p4', distKey: 'dist', fourD: { slice: 'face' }, blurb: 'Two discs at right angles in 4D; turning, it rolls between a cylinder and a pill.',
    params: [P('r1', 'Radius xy', 'r1', 0.6, 0.01, 5), P('r2', 'Radius zw', 'r2', 0.45, 0.01, 5), P('w', 'Slice (w)', '', 0, -2, 2, 0.01), P('spin', 'Spin', '', 15, -90, 90, 0.5)] },
  { kind: 'clifford-torus', label: 'Clifford torus', aliases: ['clifford', '4d-torus'], type: 'cliffordTorusSDF', posKey: 'p4', distKey: 'dist', fourD: { slice: 'face' }, blurb: 'A torus on the 4D sphere: its slice is a pair of linked rings or a fat torus.',
    params: [P('r', 'Radius', 'radius', 0.8, 0.05, 5), P('t', 'Thickness', 'thickness', 0.15, 0.005, 1, 0.005), P('w', 'Slice (w)', '', 0, -2, 2, 0.01), P('spin', 'Spin', '', 9, -90, 90, 0.5)] },
  { kind: 'cell24', label: '24-cell', aliases: ['icositetrachoron', 'twenty-four-cell'], type: 'cell24SDF', posKey: 'p4', distKey: 'dist', fourD: { slice: 'corner' }, blurb: 'A regular 4D solid with no 3D relative; its slices are octahedra and their cousins.',
    params: [P('r', 'Radius', 'radius', 0.7, 0.05, 5), P('w', 'Slice (w)', '', 0, -2, 2, 0.01), P('spin', 'Spin', '', 10, -90, 90, 0.5)] },
  { kind: 'julia4d', label: 'Quaternion Julia', aliases: ['julia', 'quaternion-julia'], type: 'quatJuliaSDF', posKey: 'p4', distKey: 'dist', stepHint: 0.8, fourD: { slice: 'face' }, blurb: 'A 4D fractal, sliced: lumpy bulbs that curl into each other.',
    params: [P('cx', 'c x', 'cx', -0.2, -1.5, 1.5, 0.005), P('cy', 'c y', 'cy', 0.6, -1.5, 1.5, 0.005), P('scale', 'Size', 'scale', 0.75, 0.05, 5), P('w', 'Slice (w)', '', 0, -2, 2, 0.01), P('spin', 'Spin', '', 6, -90, 90, 0.5)] },
  { kind: 'mandel4d', label: 'Quaternion Mandelbrot', aliases: ['mandelbrot4d', 'quaternion-mandelbrot'], type: 'quatMandelSDF', posKey: 'p4', distKey: 'dist', stepHint: 0.8, fourD: { slice: 'face' }, blurb: 'The 4D Mandelbrot set, sliced: the familiar outline spun round and folded.',
    params: [P('scale', 'Size', 'scale', 0.6, 0.05, 5), P('w', 'Slice (w)', '', 0, -2, 2, 0.01), P('spin', 'Spin', '', 6, -90, 90, 0.5)] },
];

export const SHAPE_BY_KIND: Record<string, ShapeDef> = Object.fromEntries(SHAPES.map(s => [s.kind, s]));

// ── Warps ───────────────────────────────────────────────────────────────────

export interface WarpDef {
  kind: string;
  label: string;
  aliases: string[];
  type: string;
  /** Position socket in and out (Sin Warp 3D's are `p`). */
  posIn: string;
  posOut: string;
  /** A distance modifier (Displace 3D, Round, Onion): it reshapes the distance rather than the space. */
  modifier?: boolean;
  /**
   * The node that changes the distance: a modifier's only node, or Scale's second one (it
   * corrects the distance of the space it shrank). Applied once the item's distance exists,
   * innermost first, so a stack reads outside in like the recipe.
   */
  distStep?: { type: string; distIn: string; distOut: string; posIn?: string };
  params: ParamDef[];
  /** Axis-letter setting: `mirror xz` (bool params), `turn y` / `polar-repeat axis=y` (a select). */
  axes?: { key: string; label: string; kind: 'flags'; params: [string, string, string]; def: string } | { key: string; label: string; kind: 'one'; param: string; def: string; options: string[] };
  /** A second select (Sin Warp's source axis, Kaleidoscope's symmetry). */
  select?: { key: string; label: string; param: string; def: string; options: string[] };
  /** How small a step it wants: 1 when it keeps distances, less when it stretches space. */
  stepHint: (w: WarpSpec) => number;
  blurb: string;
}

const exact = () => 1;
const stretch = (amount: number) => Math.max(0.3, Math.min(1, Math.round(20 / (1 + amount)) / 20));

export const WARPS: WarpDef[] = [
  { kind: 'move', label: 'Move', aliases: ['translate', 'offset'], type: 'translate3D', posIn: 'pos', posOut: 'pos', stepHint: exact,
    blurb: 'Shifts what follows.', params: [P('by', 'By', ['tx', 'ty', 'tz'], [0, 0, 0], -10, 10)] },
  { kind: 'turn', label: 'Turn', aliases: [], type: 'rotate3D', posIn: 'pos', posOut: 'pos', stepHint: exact,
    blurb: 'Turns what follows about one axis.', axes: { key: 'axis', label: 'Axis', kind: 'one', param: 'axis', def: 'y', options: ['x', 'y', 'z'] },
    params: [P('angle', 'Angle', 'angle', 0, -360, 360, 0.5, { deg: true })] },
  { kind: 'rotate', label: 'Rotate', aliases: ['rotation'], type: 'rotate3D', posIn: 'pos', posOut: 'pos', stepHint: exact,
    blurb: 'Turns what follows about X, then Y, then Z (degrees), like a shape\'s own Rotation.', params: [P('by', 'Degrees', '', [0, 0, 0], -180, 180, 0.5, { hint: 'About X, then Y, then Z.' })] },
  { kind: 'scale', label: 'Scale', aliases: ['resize', 'grow'], type: 'scale3d', posIn: 'p', posOut: 'p', stepHint: exact,
    distStep: { type: 'scale3d', distIn: 'dist', distOut: 'dist' },
    blurb: 'Makes what follows bigger (above 1) or smaller, keeping distances exact.', params: [P('s', 'Factor', '', 1.5, 0.05, 10, 0.01)] },
  { kind: 'repeat', label: 'Repeat', aliases: ['tile', 'grid'], type: 'repeat3D', posIn: 'pos', posOut: 'pos', stepHint: exact,
    blurb: 'Endless copies, one per cell. Keep each copy inside its cell.', params: [P('cell', 'Cell size', ['cellX', 'cellY', 'cellZ'], [2, 2, 2], 0.1, 10)] },
  { kind: 'mirror-repeat', label: 'Mirrored repeat', aliases: ['mirrored-repeat', 'flip-repeat'], type: 'mirroredRepeat3D', posIn: 'pos', posOut: 'pos', stepHint: exact,
    blurb: 'Endless copies, every other one flipped, so neighbours meet seamlessly.', params: [P('cell', 'Cell size', ['cellX', 'cellY', 'cellZ'], [2, 2, 2], 0.1, 10)] },
  { kind: 'limited-repeat', label: 'Limited repeat', aliases: ['repeat-n', 'array'], type: 'limitedRepeat3D', posIn: 'pos', posOut: 'pos', stepHint: exact,
    blurb: 'A few copies each way.', params: [P('cell', 'Cell size', ['cellX', 'cellY', 'cellZ'], [1, 1, 1], 0.1, 10), P('count', 'Copies each way', ['limX', 'limY', 'limZ'], [2, 2, 2], 0, 20, 1)] },
  { kind: 'mirror', label: 'Mirror', aliases: ['symmetry', 'abs'], type: 'fold3D', posIn: 'pos', posOut: 'pos', stepHint: exact,
    blurb: 'One half of space mirrored onto the other, on the chosen axes.', axes: { key: 'axes', label: 'Axes', kind: 'flags', params: ['foldX', 'foldY', 'foldZ'], def: 'xz' }, params: [] },
  { kind: 'fold', label: 'Fold', aliases: ['mirror-fold'], type: 'mirrorFold3D', posIn: 'pos', posOut: 'pos', stepHint: exact,
    blurb: 'Mirror with an offset: folds space along planes, the move fractals repeat.', axes: { key: 'axes', label: 'Axes', kind: 'flags', params: ['foldX', 'foldY', 'foldZ'], def: 'xy' },
    params: [P('offset', 'Offset', ['offsetX', 'offsetY', 'offsetZ'], [0, 0, 0], -2, 2)] },
  { kind: 'polar-repeat', label: 'Polar repeat', aliases: ['radial', 'around', 'polar'], type: 'polarRepeat3D', posIn: 'pos', posOut: 'pos', stepHint: () => 0.9,
    blurb: 'Copies round an axis, like slices of a cake.', axes: { key: 'axis', label: 'Axis', kind: 'one', param: 'axis', def: 'y', options: ['y', 'x', 'z'] },
    params: [P('count', 'Copies', 'count', 6, 2, 32, 1)] },
  { kind: 'kaleido', label: 'Kaleidoscope', aliases: ['kaleidoscope'], type: 'kaleidoscope3D', posIn: 'pos', posOut: 'pos', stepHint: () => 0.9,
    blurb: 'Repeated mirror folds with the symmetry of a solid.', select: { key: 'sym', label: 'Symmetry', param: 'symmetry', def: 'oct', options: ['oct', 'tet', 'icos'] },
    params: [P('n', 'Folds', 'iterations', 3, 1, 5, 1)] },
  { kind: 'twist', label: 'Twist', aliases: [], type: 'twist3D', posIn: 'pos', posOut: 'pos', stepHint: w => stretch(Math.abs(num(w.values.k, 2)) * 0.5),
    blurb: 'Turns space round the up axis more the higher it goes.', params: [P('k', 'Amount', 'k', 2, -10, 10)] },
  { kind: 'bend', label: 'Bend', aliases: ['curve'], type: 'bend3D', posIn: 'pos', posOut: 'pos', stepHint: w => stretch(Math.abs(num(w.values.k, 0.5)) * 0.6),
    blurb: 'Curves space along X.', params: [P('k', 'Amount', 'k', 0.5, -5, 5)] },
  { kind: 'sine', label: 'Sine warp', aliases: ['wave', 'sin', 'sine-warp'], type: 'sinWarp3D', posIn: 'p', posOut: 'p', stepHint: w => stretch(num(w.values.amp, 0.1) * num(w.values.freq, 2) * 1.5),
    blurb: 'Shifts one axis by a sine of another.', axes: { key: 'axis', label: 'Shifts', kind: 'one', param: 'distort_axis', def: 'y', options: ['x', 'y', 'z'] },
    select: { key: 'from', label: 'Along', param: 'source_axis', def: 'x', options: ['x', 'y', 'z'] },
    params: [P('amp', 'Amplitude', 'amplitude', 0.1, 0, 2), P('freq', 'Frequency', 'frequency', 2, 0.01, 20)] },
  { kind: 'noise', label: 'Noise warp', aliases: ['domain-warp', 'warp'], type: 'domainWarp3D', posIn: 'pos', posOut: 'pos', stepHint: w => stretch(num(w.values.amt, 0.3) * num(w.values.scale, 1) * 3),
    blurb: 'Pushes space about with smooth noise: lumpy, organic shapes.', params: [P('amt', 'Strength', 'strength', 0.3, 0, 2), P('scale', 'Scale', 'scale', 1, 0.1, 5), P('octaves', 'Octaves', 'octaves', 3, 1, 6, 1)] },
  { kind: 'displace', label: 'Displace', aliases: ['bumps', 'ripple'], type: 'displace3D', posIn: 'pos', posOut: 'pos', modifier: true,
    distStep: { type: 'displace3D', distIn: 'dist', distOut: 'dist', posIn: 'pos' }, stepHint: w => stretch(num(w.values.amp, 0.05) * num(w.values.freq, 8) * 1.7),
    blurb: 'Bumps on the surface: adds a 3D sine pattern to the distance.', params: [P('amp', 'Amplitude', 'amp', 0.05, 0, 0.5, 0.005), P('freq', 'Frequency', 'freq', 8, 0.1, 40, 0.1)] },
  { kind: 'round', label: 'Round', aliases: ['inflate', 'soften'], type: 'sdfOffset', posIn: 'pos', posOut: 'pos', modifier: true, stepHint: exact,
    distStep: { type: 'sdfOffset', distIn: 'sdf', distOut: 'result' },
    blurb: 'Rounds every edge and corner by growing the surface outward this much.', params: [P('r', 'Radius', '', 0.05, 0, 0.5, 0.005)] },
  { kind: 'onion', label: 'Onion', aliases: ['shell', 'hollow'], type: 'sdfOnion', posIn: 'pos', posOut: 'pos', modifier: true, stepHint: exact,
    distStep: { type: 'sdfOnion', distIn: 'dist', distOut: 'dist' },
    blurb: 'Hollows it into a thin shell of this thickness (cut it open to see inside).', params: [P('t', 'Thickness', 'r', 0.03, 0.001, 0.5, 0.005)] },
];

/** The per-item modifiers the inspector offers first, in its order (the rest of WARPS follow under "More"). */
export const MODIFIER_KINDS = ['move', 'rotate', 'scale', 'twist', 'bend', 'repeat', 'mirror', 'polar-repeat', 'round', 'onion'] as const;

export const WARP_BY_KIND: Record<string, WarpDef> = Object.fromEntries(WARPS.map(w => [w.kind, w]));

// ── The spec ────────────────────────────────────────────────────────────────

export interface WarpSpec {
  id: string;
  kind: string;
  /** Numbers and vectors by ParamDef key; axis letters and selects by their key. */
  values: Record<string, number | Vec3 | string>;
  /** kind === 'custom': what the recogniser could not read. */
  label?: string;
}

export interface ShapeSpec {
  id: string;
  type: 'shape';
  kind: string;
  name: string;
  /** Where its centre is. */
  at: Vec3;
  /** How it is turned, in degrees about X, then Y, then Z. */
  rot: Vec3;
  /** Size settings by ParamDef key. */
  size: Record<string, number | Vec3>;
  color: Vec3;
  /** 0 matt … 1 glossy highlight. */
  shine: number;
  /** In Glass mode: made of glass (the rest is seen through it). */
  glass: boolean;
  warps: WarpSpec[];
  /** kind === 'custom': what the recogniser could not read. */
  label?: string;
}

export type CombineOp = 'union' | 'subtract' | 'intersect';

export interface GroupSpec {
  id: string;
  type: 'group';
  name: string;
  op: CombineOp;
  /** Blend radius: 0 is the hard operation, above 0 the smooth one. */
  k: number;
  children: SceneItem[];
  warps: WarpSpec[];
}

export type SceneItem = ShapeSpec | GroupSpec;

export type RenderMode = 'surface' | 'volumetric' | 'glass' | 'gi';
export const TONE_MODES = ['aces', 'agx', 'hable', 'reinhard2', 'tanh', 'oklab', 'none'] as const;
export type ToneMode = typeof TONE_MODES[number];

export interface LookSpec {
  mode: RenderMode;
  sunDir: Vec3;
  sunColor: Vec3;
  sky: Vec3;
  bounce: Vec3;
  /** Soft shadow hardness (k); 0 turns shadows off. */
  shadows: number;
  /** Ambient occlusion sample step; 0 turns it off. */
  ao: number;
  /** Fog density; 0 is clear. */
  fog: number;
  /** Fog colour; null: the background's. */
  fogColor: Vec3 | null;
  /** Background, or the top of a gradient when `bg2` is set. */
  bg: Vec3;
  /** The bottom of a background gradient; null for a solid colour. */
  bg2: Vec3 | null;
  tone: ToneMode;
  glow: { density: number; falloff: number; shell: number; exposure: number; tint: Vec3 };
  glass: { ior: number; dispersion: number; tint: Vec3 };
  gi: { strength: number; metal: number; rough: number; spec: number };
}

/** The unified orbit camera: Distance, Angle, Elevation, Orbit speed, Zoom, Flatten, Translate X / Y / Z (angles in degrees). */
export interface CameraSpec {
  dist: number; angle: number; elev: number; orbit: number; zoom: number; flatten: number; x: number; y: number; z: number;
}

export interface QualitySpec {
  steps: number;
  maxDist: number;
  /** A number, or 'auto': the smallest step any warp or shape asks for. */
  stepScale: number | 'auto';
  jitter: number;
}

export interface SceneSpec {
  root: GroupSpec;
  look: LookSpec;
  camera: CameraSpec;
  quality: QualitySpec;
  /** What the built scene shows (output.ts); absent: the picture. */
  output?: OutputSpec;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_COLOR: Vec3 = [0.8, 0.8, 0.8];

export const DEFAULT_LOOK: LookSpec = {
  mode: 'surface',
  sunDir: [0.6, 0.7, 0.4], sunColor: [1, 0.9, 0.7], sky: [0.3, 0.5, 0.7], bounce: [0.1, 0.1, 0.08],
  shadows: 16, ao: 0.06, fog: 0, fogColor: null,
  bg: [0.04, 0.045, 0.07], bg2: null, tone: 'aces',
  glow: { density: 0.03, falloff: 10, shell: 0, exposure: 1.2, tint: [0.3, 0.8, 1] },
  glass: { ior: 1.5, dispersion: 0.06, tint: [1, 1, 1] },
  gi: { strength: 0.4, metal: 0, rough: 0.5, spec: 0.5 },
};

export const DEFAULT_CAMERA: CameraSpec = { dist: 4, angle: 35, elev: 17, orbit: 0, zoom: 1.5, flatten: 0, x: 0, y: 0, z: 0 };
export const DEFAULT_QUALITY: QualitySpec = { steps: 96, maxDist: 20, stepScale: 'auto', jitter: 1 };

export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
export function vec(v: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(v) && v.length >= 3 && v.every(x => typeof x === 'number') ? [v[0], v[1], v[2]] : [...fallback] as Vec3;
}
const cloneVal = <T>(v: T): T => (Array.isArray(v) ? [...v] as T : v);

/** A fresh id that no item of `spec` has yet: `s3`, `g2`, `w5`. */
export function nextId(spec: SceneSpec | null, prefix: 's' | 'g' | 'w'): string {
  const used = new Set<string>();
  if (spec) walkItems(spec.root, it => { used.add(it.id); for (const w of it.warps) used.add(w.id); });
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

export function defaultSize(kind: string): Record<string, number | Vec3> {
  const def = SHAPE_BY_KIND[kind];
  return Object.fromEntries((def?.params ?? []).map(p => [p.key, cloneVal(p.def)]));
}

export function newShape(kind: string, id: string, over: Partial<ShapeSpec> = {}): ShapeSpec {
  return { id, type: 'shape', kind, name: '', at: [0, 0, 0], rot: [0, 0, 0], size: defaultSize(kind), color: [...DEFAULT_COLOR] as Vec3, shine: 0, glass: false, warps: [], ...over };
}

export function newGroup(id: string, over: Partial<GroupSpec> = {}): GroupSpec {
  return { id, type: 'group', name: '', op: 'union', k: 0, children: [], warps: [], ...over };
}

export function defaultWarpValues(kind: string): WarpSpec['values'] {
  const def = WARP_BY_KIND[kind];
  if (!def) return {};
  const out: WarpSpec['values'] = Object.fromEntries(def.params.map(p => [p.key, cloneVal(p.def)]));
  if (def.axes) out[def.axes.key] = def.axes.def;
  if (def.select) out[def.select.key] = def.select.def;
  return out;
}

export function newWarp(kind: string, id: string, values: WarpSpec['values'] = {}): WarpSpec {
  return { id, kind, values: { ...defaultWarpValues(kind), ...values } };
}

export function emptySpec(): SceneSpec {
  return {
    root: newGroup('g1', { name: 'Scene' }),
    look: structuredClone(DEFAULT_LOOK), camera: { ...DEFAULT_CAMERA }, quality: { ...DEFAULT_QUALITY },
  };
}

/** A scene with one sphere: what a new builder opens with. */
export function starterSpec(): SceneSpec {
  const spec = emptySpec();
  spec.root.children.push(newShape('sphere', 's1', { size: { r: 0.8 }, color: [0.85, 0.55, 0.35] }));
  return spec;
}

// ── Walking the tree ────────────────────────────────────────────────────────

export function walkItems(item: SceneItem, visit: (it: SceneItem, parent: GroupSpec | null, depth: number) => void, parent: GroupSpec | null = null, depth = 0): void {
  visit(item, parent, depth);
  if (item.type === 'group') for (const c of item.children) walkItems(c, visit, item, depth + 1);
}

export function allShapes(spec: SceneSpec): ShapeSpec[] {
  const out: ShapeSpec[] = [];
  walkItems(spec.root, it => { if (it.type === 'shape') out.push(it); });
  return out;
}

export function findItem(spec: SceneSpec, id: string): { item: SceneItem; parent: GroupSpec | null } | null {
  let hit: { item: SceneItem; parent: GroupSpec | null } | null = null;
  walkItems(spec.root, (it, parent) => { if (!hit && it.id === id) hit = { item: it, parent }; });
  return hit;
}

/** The groups from the root down to (not including) `id`. */
export function pathTo(spec: SceneSpec, id: string): GroupSpec[] {
  const out: GroupSpec[] = [];
  const go = (g: GroupSpec): boolean => {
    out.push(g);
    for (const c of g.children) {
      if (c.id === id) return true;
      if (c.type === 'group' && go(c)) return true;
    }
    out.pop();
    return false;
  };
  if (spec.root.id === id) return [];
  return go(spec.root) ? out : [];
}

/** What an item is called in notes and lists: its name, or its kind and number. */
export function itemName(spec: SceneSpec | null, it: SceneItem): string {
  if (it.name.trim()) return it.name.trim();
  if (it.type === 'group') return spec && it.id === spec.root.id ? 'the scene' : opLabel(it);
  const def = SHAPE_BY_KIND[it.kind];
  const label = it.kind === 'custom' ? (it.label ?? 'custom') : def?.label ?? it.kind;
  if (!spec) return label;
  const same = allShapes(spec).filter(s => s.kind === it.kind);
  return same.length > 1 ? `${label} ${same.indexOf(it as ShapeSpec) + 1}` : label;
}

/** A modifier chip's words: its label and its main setting (`Move 1,0,0`, `Mirror xz`, `Twist 2`). */
export function modifierSummary(w: WarpSpec): { label: string; value: string } {
  const def = WARP_BY_KIND[w.kind];
  if (!def) return { label: w.label ?? 'custom', value: '' };
  const r = (n: number) => String(Math.round(n * 1000) / 1000);
  const parts: string[] = [];
  if (def.axes) parts.push(String(w.values[def.axes.key] ?? def.axes.def));
  const first = def.params[0];
  if (first) {
    const v = w.values[first.key];
    if (Array.isArray(v)) parts.push(v[0] === v[1] && v[1] === v[2] ? r(v[0]) : v.map(r).join(','));
    else if (typeof v === 'number') parts.push(`${w.kind === 'scale' ? '×' : ''}${r(v)}${first.deg ? '°' : ''}`);
  }
  return { label: def.label, value: parts.join(' ') };
}

export function opLabel(g: Pick<GroupSpec, 'op' | 'k'>): string {
  const base = g.op === 'union' ? 'Union' : g.op === 'subtract' ? 'Subtract' : 'Intersect';
  return g.k > 0 ? `Smooth ${base.toLowerCase()}` : base;
}

// ── Step scale ──────────────────────────────────────────────────────────────

/** The step each warp or shape asks for, smallest first, with who asks. */
export function stepHints(spec: SceneSpec): Array<{ value: number; why: string }> {
  const out: Array<{ value: number; why: string }> = [];
  walkItems(spec.root, it => {
    for (const w of it.warps) {
      const def = WARP_BY_KIND[w.kind];
      if (!def) continue;
      const v = def.stepHint(w);
      if (v < 1) out.push({ value: v, why: `${def.label} on ${itemName(spec, it)}` });
    }
    if (it.type === 'shape') {
      const def = SHAPE_BY_KIND[it.kind];
      if (def?.stepHint) out.push({ value: def.stepHint, why: `${def.label} (${itemName(spec, it)}) is not an exact distance` });
    }
  });
  return out.sort((a, b) => a.value - b.value);
}

export function autoStepScale(spec: SceneSpec): number {
  return stepHints(spec)[0]?.value ?? 1;
}

export function effectiveStepScale(spec: SceneSpec): number {
  return spec.quality.stepScale === 'auto' ? autoStepScale(spec) : spec.quality.stepScale;
}

// ── Canonical form (for comparing specs) ────────────────────────────────────

/** The spec with ids renumbered in tree order: two specs that say the same thing compare equal. */
export function canonicalSpec(spec: SceneSpec): SceneSpec {
  const out = structuredClone(spec);
  if (!out.output || out.output.show === 'picture') delete out.output;
  else if (!out.output.palette) delete out.output.palette;
  if (out.look.fogColor && out.look.fogColor.every((v, i) => v === out.look.bg[i])) out.look.fogColor = null;
  let s = 0, g = 0, w = 0;
  walkItems(out.root, it => {
    it.id = it.type === 'group' ? `g${++g}` : `s${++s}`;
    for (const wp of it.warps) wp.id = `w${++w}`;
  });
  return out;
}

/** The glass and non-glass parts of the tree (Glass mode's two scenes); empty groups dropped. */
export function filterTree(g: GroupSpec, keep: (s: ShapeSpec) => boolean): GroupSpec | null {
  const kept = g.children.map(c => (c.type === 'shape' ? (keep(c) ? c : null) : filterTree(c, keep)));
  // A subtract keeps its cutters only alongside the shape they cut.
  if (g.op === 'subtract' && !kept[0]) return null;
  const children = kept.filter((c): c is SceneItem => c !== null);
  return children.length ? { ...g, children } : null;
}
