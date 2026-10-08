/**
 * fourD.ts — the 4D nodes (docs/4d.md): a first taste of a fourth dimension by SLICING.
 *
 * A 4D shape is a distance function of a point with four coordinates, p4 = (x, y, z, w).
 * The screen can only show 3D, so we show one slice through it: the ray marcher keeps
 * asking for the distance at 3D points, Lift to 4D adds a fourth coordinate w to each one
 * (the slice position), and everything after that is ordinary maths. Rotating the shape in
 * a plane that includes w (xw, yw, zw) changes which part of it the slice cuts, so the 3D
 * cross-section morphs without anything in 3D moving.
 *
 * The nodes carry a point as a vec4 (the graph already has the vec4 socket type), so they
 * sit inside a normal Scene Group and the result goes to Scene Output like any distance:
 * lighting, materials and the march loop need no changes.
 */
import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

export const CAT = '4D';

/** The six planes of rotation in 4D (a rotation turns one axis toward another): the pair each one turns. */
export const ROTATION_PLANES_4D = ['xy', 'xz', 'xw', 'yz', 'yw', 'zw'] as const;
export type RotationPlane4D = typeof ROTATION_PLANES_4D[number];

export const DEG = '0.017453292519943295';

// ─── Lift to 4D ────────────────────────────────────────────────────────────────

/**
 * Which way the slice cuts. The slice is a hyperplane (a 3D flat inside 4D) with a normal n; the 3D
 * point is mapped to `basis · pos + n · w`, where basis is three orthonormal vectors perpendicular to n.
 *   face   n = (0,0,0,1)        the w axis: the slice is parallel to one of the tesseract's cubic cells
 *   edge   n = (0,0,1,1) / √2   the slice meets an edge first
 *   corner n = (1,1,1,1) / 2    the slice meets a corner first: point, tetrahedron, octahedron, ...
 *   custom two angles (see sliceNormal)
 */
export const SLICE_DIRECTIONS = ['face', 'edge', 'corner', 'custom'] as const;

/** Custom direction: tilt `a` away from the w axis (degrees), toward the spatial direction chosen by `b` (degrees). */
export function sliceNormal(dir: string, a = 0, b = 0): [number, number, number, number] {
  if (dir === 'edge') return [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  if (dir === 'corner') return [0.5, 0.5, 0.5, 0.5];
  if (dir === 'custom') {
    const ra = a * Math.PI / 180, rb = b * Math.PI / 180;
    const s = Math.sin(ra);
    // The spatial part points along (cos b, sin b / √2, sin b / √2): b = 0 along x, b = 54.74 along a cube diagonal.
    return [s * Math.cos(rb), s * Math.sin(rb) * Math.SQRT1_2, s * Math.sin(rb) * Math.SQRT1_2, Math.cos(ra)];
  }
  return [0, 0, 0, 1];
}

/**
 * The orthonormal basis of a slice: three 4D vectors perpendicular to n (and to each other), plus n itself.
 * They are the columns of the Householder reflection that carries the w axis onto n, which is what the
 * shader applies (no matrices needed): lift(pos, w) = pos.x * b0 + pos.y * b1 + pos.z * b2 + w * n.
 */
export function sliceBasis(n: readonly number[]): { basis: number[][]; normal: number[] } {
  const v = [-n[0], -n[1], -n[2], 1 - n[3]];
  const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3];
  const col = (k: number) => {
    const e = [0, 0, 0, 0]; e[k] = 1;
    if (vv < 1e-8) return e;
    const d = 2 * v[k] / vv;
    return e.map((x, i) => x - v[i] * d);
  };
  return { basis: [col(0), col(1), col(2)], normal: col(3) };
}

export const Lift4DNode: NodeDefinition = {
  type: 'lift4D', label: 'Lift to 4D', category: CAT,
  aliases: ['4d', 'slice', 'fourth dimension', 'vec4 point'],
  description:
    'Turns the 3D point being measured into a 4D point by giving it a fourth coordinate, w. The screen can only show 3D, so what you see is a slice: ' +
    'everything in the 4D shape that sits at this w. Move w and the slice moves through the shape, so it grows, shrinks and changes form.',
  inputs: {
    pos: { type: 'vec3',  label: 'Position', hint: 'The 3D point being measured: wire Scene Pos here.' },
    w:   { type: 'float', label: 'W (slice)', hint: 'Where the slice is along the fourth axis. Wire a Time or an LFO for a slice that sweeps through the shape.' },
  },
  outputs: { p4: { type: 'vec4', label: 'Point 4D', hint: 'The point as (x, y, z, w). Wire into Rotate 4D, Translate 4D or a 4D shape.' } },
  defaultParams: { w: 0.0, sliceDir: 'face', sliceA: 60.0, sliceB: 54.7356 },
  paramDefs: {
    w: { label: 'W (slice)', type: 'float', min: -2.0, max: 2.0, step: 0.01, hint: 'Which slice of the 4D shape you see. 0 is through the middle.',
         help: 'How far along the slice direction the cut is. A 4D shape is solid in four directions; this chooses the 3D layer you are looking at. At 0 you cut through the middle, past the shape\'s edge the slice is empty. Animatable and live.' },
    sliceDir: { label: 'Slice direction', type: 'select', hint: 'Which way the slice cuts: face-first, edge-first, corner-first or custom angles.',
                help: 'Face-first slices parallel to a cubic cell (the w axis): a tesseract gives a cube. Edge-first tilts the cut to (0,0,1,1): the slice meets an edge first. Corner-first cuts along (1,1,1,1): a tesseract gives a point, then a tetrahedron, then an octahedron at w = 0, and back. Custom takes two angles.',
                options: [{ value: 'face', label: 'Face-first' }, { value: 'edge', label: 'Edge-first' }, { value: 'corner', label: 'Corner-first' }, { value: 'custom', label: 'Custom' }] },
    sliceA: { label: 'Tilt (deg)', type: 'float', min: 0.0, max: 90.0, step: 0.5, showWhen: { param: 'sliceDir', value: 'custom' },
              hint: 'Custom: how far the slice normal leans away from the w axis. 0 is face-first.' },
    sliceB: { label: 'Swing (deg)', type: 'float', min: 0.0, max: 90.0, step: 0.5, showWhen: { param: 'sliceDir', value: 'custom' },
              hint: 'Custom: which way it leans among x, y and z. Tilt 45 with Swing 0 is edge-first; Tilt 60 with Swing 54.74 is corner-first.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const w = inputVars.w || p(node.params.w, 0.0);
    const dir = String(node.params.sliceDir ?? 'face');
    if (dir !== 'edge' && dir !== 'corner' && dir !== 'custom') {
      return { code: `    vec4 ${id}_p4 = vec4(${pos}, ${w});\n`, outputVars: { p4: `${id}_p4` } };
    }
    // The normal n, then the reflection that carries the w axis onto n: its first three columns are the
    // slice's orthonormal basis, its fourth is n, so H * (pos, w) = basis * pos + n * w.
    let nExpr: string;
    if (dir === 'edge') nExpr = 'vec4(0.0, 0.0, 0.70710678, 0.70710678)';
    else if (dir === 'corner') nExpr = 'vec4(0.5)';
    else {
      const a = `(${p(node.params.sliceA, 60.0)} * ${DEG})`, b = `(${p(node.params.sliceB, 54.7356)} * ${DEG})`;
      nExpr = `vec4(sin(${a}) * cos(${b}), sin(${a}) * sin(${b}) * 0.70710678, sin(${a}) * sin(${b}) * 0.70710678, cos(${a}))`;
    }
    return {
      code: [
        `    vec4  ${id}_n = ${nExpr};\n`,
        `    vec4  ${id}_v = vec4(0.0, 0.0, 0.0, 1.0) - ${id}_n;\n`,
        `    float ${id}_vv = dot(${id}_v, ${id}_v);\n`,
        `    vec4  ${id}_q = vec4(${pos}, ${w});\n`,
        `    vec4  ${id}_p4 = ${id}_vv < 0.00000001 ? ${id}_q : ${id}_q - ${id}_v * (2.0 * dot(${id}_v, ${id}_q) / ${id}_vv);\n`,
      ].join(''),
      outputVars: { p4: `${id}_p4` },
    };
  },
};

// ─── Rotate 4D ─────────────────────────────────────────────────────────────────

/** The two axes (component letters) a plane turns: the shape turns from the first toward the second. */
export function planeAxes(plane: string): [string, string] {
  const pl = (ROTATION_PLANES_4D as readonly string[]).includes(plane) ? plane : 'xw';
  return [pl[0], pl[1]];
}

export const Rotate4DNode: NodeDefinition = {
  type: 'rotate4D', label: 'Rotate 4D', category: CAT,
  aliases: ['4d rotation', 'rotate w', 'xw rotation', 'hyperrotate'],
  description:
    'Rotates a 4D point in one of the six planes (xy, xz, xw, yz, yw, zw). In 3D you turn around an axis; in 4D you turn in a plane, because two directions are swapped and the rest stay put. ' +
    'xy, xz and yz are the ordinary 3D turns. xw, yw and zw swap an ordinary direction with w: the shape does not just spin, its slice changes form. ' +
    'Like Rotate 3D it moves the point the opposite way, so the shape turns from the first axis toward the second.',
  inputs: {
    p4:    { type: 'vec4',  label: 'Point 4D' },
    angle: { type: 'float', label: 'Angle (deg)', hint: 'How far to turn, in degrees. Live.' },
  },
  outputs: { p4: { type: 'vec4', label: 'Rotated Point', hint: 'The point after the turn: wire into a 4D shape.' } },
  defaultParams: { plane: 'xw', angle: 0.0, spin: 0.0 },
  paramDefs: {
    plane: { label: 'Plane', type: 'select', hint: 'Which two directions to turn between. Any plane with w morphs the slice.', options: ROTATION_PLANES_4D.map(v => ({ value: v, label: v })) },
    angle: { label: 'Angle (deg)', type: 'float', min: -360.0, max: 360.0, step: 0.5, hint: 'Turn, in degrees.' },
    spin:  { label: 'Spin (deg/s)', type: 'float', min: -180.0, max: 180.0, step: 0.5, hint: 'Keeps turning over time at this many degrees a second, on top of Angle. 0 holds still.',
             help: 'Adds Time × Spin degrees to the angle, so the shape turns by itself. Set Angle to move the starting point; wire the Angle socket for your own motion.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const q = inputVars.p4 || 'vec4(0.0)';
    const angle = inputVars.angle || p(node.params.angle, 0.0);
    const spin = p(node.params.spin, 0.0);
    const [a, b] = planeAxes(String(node.params.plane ?? 'xw'));
    const comp = ['x', 'y', 'z', 'w'];
    const ia = comp.indexOf(a), ib = comp.indexOf(b);
    // c and s of the total angle; the two chosen components mix, the other two pass through.
    const out = comp.map((k, i) =>
      i === ia ? `${id}_c * ${id}_q.${a} + ${id}_s * ${id}_q.${b}`
      : i === ib ? `-${id}_s * ${id}_q.${a} + ${id}_c * ${id}_q.${b}`
      : `${id}_q.${k}`);
    return {
      code: [
        `    vec4  ${id}_q = ${q};\n`,
        `    float ${id}_t = (${angle} + ${spin} * u_time) * ${DEG};\n`,
        `    float ${id}_c = cos(${id}_t); float ${id}_s = sin(${id}_t);\n`,
        `    vec4  ${id}_p4 = vec4(${out.join(', ')});\n`,
      ].join(''),
      outputVars: { p4: `${id}_p4` },
    };
  },
};

// ─── Translate 4D ──────────────────────────────────────────────────────────────

export const Translate4DNode: NodeDefinition = {
  type: 'translate4D', label: 'Translate 4D', category: CAT,
  aliases: ['4d move', 'offset 4d'],
  description:
    'Moves a 4D shape by an offset in x, y, z and w (it subtracts the offset from the point, as Translate 3D does). Offsetting w moves the shape along the fourth axis, ' +
    'so the slice you see cuts it at a different place. Put it before the Rotate 4D to turn the shape around its own centre, after to swing it around the origin.',
  inputs: {
    p4: { type: 'vec4',  label: 'Point 4D' },
    tx: { type: 'float', label: 'X' },
    ty: { type: 'float', label: 'Y' },
    tz: { type: 'float', label: 'Z' },
    tw: { type: 'float', label: 'W' },
  },
  outputs: { p4: { type: 'vec4', label: 'Moved Point' } },
  defaultParams: { tx: 0.0, ty: 0.0, tz: 0.0, tw: 0.0 },
  paramDefs: {
    tx: { label: 'X', type: 'float', min: -5.0, max: 5.0, step: 0.01, hint: 'Move along x.' },
    ty: { label: 'Y', type: 'float', min: -5.0, max: 5.0, step: 0.01, hint: 'Move along y.' },
    tz: { label: 'Z', type: 'float', min: -5.0, max: 5.0, step: 0.01, hint: 'Move along z.' },
    tw: { label: 'W', type: 'float', min: -5.0, max: 5.0, step: 0.01, hint: 'Move along the fourth axis: the slice cuts the shape somewhere else.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const q = inputVars.p4 || 'vec4(0.0)';
    const t = (['tx', 'ty', 'tz', 'tw'] as const).map(k => inputVars[k] || p(node.params[k], 0.0));
    return {
      code: `    vec4 ${id}_p4 = ${q} - vec4(${t.join(', ')});\n`,
      outputVars: { p4: `${id}_p4` },
    };
  },
};

// ─── Shapes ────────────────────────────────────────────────────────────────────

export const SDF4D_GLSL = `
float sdf4d_hypersphere(vec4 p, float r) { return length(p) - r; }
float sdf4d_tesseract(vec4 p, float h, float rnd) {
    float rr = min(max(rnd, 0.0), h);
    vec4 d = abs(p) - vec4(h - rr);
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, max(d.z, d.w))), 0.0) - rr;
}`;

export const HypersphereSDFNode: NodeDefinition = {
  type: 'hypersphereSDF', label: 'Hypersphere SDF', category: CAT,
  aliases: ['4d sphere', '3-sphere', 'glome'],
  description:
    'Signed distance to a 4D sphere (a hypersphere) at the origin: length(p4) - radius. Its 3D slice is always a sphere, but the size depends on w: ' +
    'radius at w = 0, shrinking to a point as w reaches the radius, and gone beyond. Sweep w and a sphere swells and shrinks.',
  inputs: {
    p4:     { type: 'vec4',  label: 'Point 4D' },
    radius: { type: 'float', label: 'Radius' },
  },
  outputs: { dist: { type: 'float', label: 'Distance', hint: 'Signed distance of the slice. Wire into Union / Subtract or straight to Scene Output.' } },
  defaultParams: { radius: 0.8 },
  paramDefs: { radius: { label: 'Radius', type: 'float', min: 0.01, max: 5.0, step: 0.01, hint: 'Radius in all four directions. The slice at w has radius √(r² − w²).' } },
  glslFunction: SDF4D_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const q = inputVars.p4 || 'vec4(0.0)';
    const r = inputVars.radius || p(node.params.radius, 0.8);
    return { code: `    float ${id}_dist = sdf4d_hypersphere(${q}, ${r});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const TesseractSDFNode: NodeDefinition = {
  type: 'tesseractSDF', label: 'Tesseract SDF', category: CAT,
  aliases: ['4d box', 'hypercube', '8-cell', 'tesseract'],
  description:
    'Signed distance to a tesseract (a 4D cube): the 3D box formula with a fourth coordinate. At w = 0 with no rotation its slice is an ordinary cube. ' +
    'Turn it in a plane with w (Rotate 4D, xw) and the slice morphs: it stretches along x and returns; add a second turn (yw, zw) and it becomes a many-faced solid before settling back to a cube.',
  inputs: {
    p4:   { type: 'vec4',  label: 'Point 4D' },
    size: { type: 'float', label: 'Half size' },
    rounding: { type: 'float', label: 'Rounding' },
  },
  outputs: { dist: { type: 'float', label: 'Distance', hint: 'Signed distance of the slice.' } },
  defaultParams: { size: 0.6, rounding: 0.0 },
  paramDefs: {
    size:     { label: 'Half size', type: 'float', min: 0.01, max: 5.0, step: 0.01, hint: 'Distance from the centre to each face, in all four directions.' },
    rounding: { label: 'Rounding', type: 'float', min: 0.0, max: 1.0, step: 0.005, hint: 'Rounds the edges and corners by this much (never more than the half size). 0 is sharp.' },
  },
  glslFunction: SDF4D_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const q = inputVars.p4 || 'vec4(0.0)';
    const h = inputVars.size || p(node.params.size, 0.6);
    const r = inputVars.rounding || p(node.params.rounding, 0.0);
    return { code: `    float ${id}_dist = sdf4d_tesseract(${q}, ${h}, ${r});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

// ═══ Phase 2: more shapes, transforms and noise ════════════════════════════════
//
// Every shape here is vec4 point -> float distance, wired like the tesseract. Which are exact and which
// are bounds (docs/4d.md): a BOUND never overestimates the true distance and is 1-Lipschitz, so the
// march can step by it safely; it only slows down (more steps) where it underestimates.

export type ShapeParam = { def: number; label: string; min: number; max: number; step: number; hint: string; help?: string };
export interface ShapeSpec {
  type: string; label: string; aliases: string[]; description: string;
  params: Record<string, ShapeParam>;
  /** Name of the GLSL function (in `glsl`) called as fn(p4, ...params in order). */
  fn: string; glsl: string;
  distHint: string;
}

export function shapeNode(s: ShapeSpec): NodeDefinition {
  const keys = Object.keys(s.params);
  return {
    type: s.type, label: s.label, category: CAT, aliases: s.aliases, description: s.description,
    inputs: {
      p4: { type: 'vec4', label: 'Point 4D' },
      ...Object.fromEntries(keys.map(k => [k, { type: 'float' as const, label: s.params[k].label }])),
    },
    outputs: { dist: { type: 'float', label: 'Distance', hint: s.distHint } },
    defaultParams: Object.fromEntries(keys.map(k => [k, s.params[k].def])),
    paramDefs: Object.fromEntries(keys.map(k => {
      const d = s.params[k];
      return [k, { label: d.label, type: 'float' as const, min: d.min, max: d.max, step: d.step, hint: d.hint, ...(d.help ? { help: d.help } : {}) }];
    })),
    glslFunction: s.glsl,
    generateGLSL: (node: GraphNode, inputVars) => {
      const id = node.id;
      const q = inputVars.p4 || 'vec4(0.0)';
      const args = keys.map(k => inputVars[k] || p(node.params[k], s.params[k].def));
      return { code: `    float ${id}_dist = ${s.fn}(${[q, ...args].join(', ')});\n`, outputVars: { dist: `${id}_dist` } };
    },
  };
}

/** Distance to a product of two convex sets A x B from their signed distances a, b: exact (docs/4d.md). */
const PRODUCT = 'length(max(vec2(a, b), 0.0)) + min(max(a, b), 0.0)';

export const DuocylinderSDFNode = shapeNode({
  type: 'duocylinderSDF', label: 'Duocylinder SDF', fn: 'sdf4d_duocylinder',
  aliases: ['duocylinder', '4d cylinder', 'disc times disc'],
  description:
    'A duocylinder: the product of two discs, one in the xy plane (radius 1) and one in the zw plane (radius 2). Its distance is max(length(p.xy) - r1, length(p.zw) - r2) inside and an exact ' +
    'distance outside. Its slice at w is a cylinder along z with radius 1 and a height that shrinks as w grows: sqrt(r2² - w²) each way. Turn it in xw and yz together and it rolls.',
  params: {
    r1: { def: 0.7, label: 'Radius xy', min: 0.01, max: 5, step: 0.01, hint: 'Radius of the disc in the xy plane.' },
    r2: { def: 0.55, label: 'Radius zw', min: 0.01, max: 5, step: 0.01, hint: 'Radius of the disc in the zw plane. The slice at w has half-height √(r2² − w²).' },
  },
  glsl: `
float sdf4d_duocylinder(vec4 p, float r1, float r2) {
    float a = length(p.xy) - r1;
    float b = length(p.zw) - r2;
    return ${PRODUCT};
}`,
  distHint: 'Exact signed distance (negative inside).',
});

export const SpherinderSDFNode = shapeNode({
  type: 'spherinderSDF', label: 'Spherinder SDF', fn: 'sdf4d_spherinder',
  aliases: ['spherinder', 'sphere times line', 'ball prism'],
  description:
    'A spherinder: a sphere stretched along w into a segment (a sphere × a line, the 4D cousin of a cylinder). Exact. Its slice at w = 0 with no rotation is a ball for as long as |w| is under the half height, then nothing: ' +
    'a ball that appears and disappears. Rotate it in xw and the ball stretches into a capsule-like shape.',
  params: {
    radius: { def: 0.55, label: 'Radius', min: 0.01, max: 5, step: 0.01, hint: 'Radius of the sphere in x, y and z.' },
    halfHeight: { def: 0.5, label: 'Half height (w)', min: 0.0, max: 5, step: 0.01, hint: 'How far the segment reaches either side along w. 0 is a flat ball.' },
  },
  glsl: `
float sdf4d_spherinder(vec4 p, float r, float h) {
    float a = length(p.xyz) - r;
    float b = abs(p.w) - h;
    return ${PRODUCT};
}`,
  distHint: 'Exact signed distance.',
});

export const CubinderSDFNode = shapeNode({
  type: 'cubinderSDF', label: 'Cubinder SDF', fn: 'sdf4d_cubinder',
  aliases: ['cubinder', 'square times circle', 'square disc'],
  description:
    'A cubinder, built as a SQUARE × DISC: a square in the xy plane (half size h) times a disc in the zw plane (radius r). Exact. Its boundary is cube-like where the square meets the disc ' +
    'and cylinder-like along the disc edge. At w = 0 the slice is a box of half size h in x and y whose height along z is the disc\'s; as w grows the box shortens. (The other reading, a cylinder × segment, is the Cylindrical Prism.)',
  params: {
    half: { def: 0.5, label: 'Half size (xy)', min: 0.01, max: 5, step: 0.01, hint: 'Half the side of the square in the xy plane.' },
    radius: { def: 0.6, label: 'Radius (zw)', min: 0.01, max: 5, step: 0.01, hint: 'Radius of the disc in the zw plane.' },
  },
  glsl: `
float sdf4d_cubinder(vec4 p, float h, float r) {
    vec2 q = abs(p.xy) - vec2(h);
    float a = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float b = length(p.zw) - r;
    return ${PRODUCT};
}`,
  distHint: 'Exact signed distance.',
});

export const CylPrismSDFNode = shapeNode({
  type: 'cylPrismSDF', label: 'Cylindrical Prism SDF', fn: 'sdf4d_cylprism',
  aliases: ['cylindrical prism', 'cylinder times segment', '4d prism'],
  description:
    'A cylindrical prism: an ordinary cylinder (a disc in xy, a segment in z) extruded along w. Exact. The same set as a disc × a rectangle in the zw plane. At w within the half extent its slice is the cylinder; ' +
    'turn it in xw and the circular cross-section becomes an ellipse, and in zw the cylinder tilts into its fourth direction.',
  params: {
    radius: { def: 0.45, label: 'Radius (xy)', min: 0.01, max: 5, step: 0.01, hint: 'Radius of the disc in the xy plane.' },
    halfZ: { def: 0.6, label: 'Half height (z)', min: 0.01, max: 5, step: 0.01, hint: 'Half the length along z.' },
    halfW: { def: 0.4, label: 'Half extent (w)', min: 0.0, max: 5, step: 0.01, hint: 'Half the length along w.' },
  },
  glsl: `
float sdf4d_cylprism(vec4 p, float r, float hz, float hw) {
    float a = length(p.xy) - r;
    vec2 q = abs(p.zw) - vec2(hz, hw);
    float b = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    return ${PRODUCT};
}`,
  distHint: 'Exact signed distance.',
});

export const DitorusSDFNode = shapeNode({
  type: 'ditorusSDF', label: 'Ditorus SDF', fn: 'sdf4d_ditorus',
  aliases: ['ditorus', 'tiger', 'tiger torus', 'duotorus', 'torus 4d'],
  description:
    'A ditorus ("tiger"): a thickened torus that sits in 4D as the product of two circles, one of radius R1 in the xy plane and one of radius R2 in the zw plane. ' +
    'length(vec2(length(p.xy) − R1, length(p.zw) − R2)) − r. Exact. Its slices are tori (and thin rings, and two-lobed shapes near the ends) that change as w moves or as it turns.',
  params: {
    R1: { def: 0.7, label: 'Major radius xy', min: 0.0, max: 5, step: 0.01, hint: 'Radius of the circle in the xy plane.' },
    R2: { def: 0.5, label: 'Major radius zw', min: 0.0, max: 5, step: 0.01, hint: 'Radius of the circle in the zw plane.' },
    r: { def: 0.18, label: 'Minor radius', min: 0.005, max: 2, step: 0.005, hint: 'Thickness of the tube around the two circles.' },
  },
  glsl: `
float sdf4d_ditorus(vec4 p, float R1, float R2, float r) {
    return length(vec2(length(p.xy) - R1, length(p.zw) - R2)) - r;
}`,
  distHint: 'Exact signed distance.',
});

export const CliffordTorusSDFNode = shapeNode({
  type: 'cliffordTorusSDF', label: 'Clifford Torus SDF', fn: 'sdf4d_clifford',
  aliases: ['clifford torus', 'torus on the 3-sphere', 'hopf torus'],
  description:
    'A thickened Clifford torus: the flat torus that sits on the surface of a 3-sphere (radius s), made from a circle in xy of radius s·cos(a) and a circle in zw of radius s·sin(a). ' +
    'At Balance 45 degrees both circles are equal (s/√2): the true Clifford torus, which divides the 3-sphere into two equal solid tori. Other balances give the other tori that foliate the sphere. ' +
    'Exact: it is a ditorus whose two radii are tied to a sphere.',
  params: {
    radius: { def: 0.9, label: 'Sphere radius', min: 0.05, max: 5, step: 0.01, hint: 'Radius of the 3-sphere the torus lies on.' },
    thickness: { def: 0.16, label: 'Thickness', min: 0.005, max: 2, step: 0.005, hint: 'Radius of the tube around the torus.' },
    balance: { def: 45, label: 'Balance (deg)', min: 0, max: 90, step: 0.5, hint: '45 is the Clifford torus (equal circles). 0 and 90 shrink one circle to nothing.' },
  },
  glsl: `
float sdf4d_clifford(vec4 p, float s, float t, float balDeg) {
    float a = balDeg * ${DEG};
    return length(vec2(length(p.xy) - s * cos(a), length(p.zw) - s * sin(a))) - t;
}`,
  distHint: 'Exact signed distance.',
});

export const Cell5SDFNode = shapeNode({
  type: 'cell5SDF', label: '5-Cell SDF', fn: 'sdf4d_cell5',
  aliases: ['5-cell', 'pentachoron', '4-simplex', 'simplex 4d', 'hypertetrahedron'],
  description:
    'The 5-cell (pentachoron, the 4D simplex): five tetrahedral cells, five corners. BOUND: the distance is the largest of the five face-plane distances, which is exact inside and ' +
    'never more than the true distance outside, so marching is safe but takes a few more steps near corners. Radius is the distance from the centre to a corner. One corner points along +w.',
  params: { radius: { def: 0.9, label: 'Radius (to corners)', min: 0.01, max: 5, step: 0.01, hint: 'Distance from the centre to each corner. The faces are at a quarter of this.' } },
  glsl: `
float sdf4d_cell5(vec4 p, float R) {
    float s = 0.5590169944;
    float d0 = -( s * p.x + s * p.y + s * p.z - 0.25 * p.w);
    float d1 = -( s * p.x - s * p.y - s * p.z - 0.25 * p.w);
    float d2 = -(-s * p.x + s * p.y - s * p.z - 0.25 * p.w);
    float d3 = -(-s * p.x - s * p.y + s * p.z - 0.25 * p.w);
    float d4 = -p.w;
    return max(max(max(d0, d1), max(d2, d3)), d4) - 0.25 * R;
}`,
  distHint: 'A bound: exact inside, never over the true distance outside.',
});

export const Cell16SDFNode = shapeNode({
  type: 'cell16SDF', label: '16-Cell SDF', fn: 'sdf4d_cell16',
  aliases: ['16-cell', 'hexadecachoron', 'cross-polytope 4d', 'hyperoctahedron', 'orthoplex'],
  description:
    'The 16-cell (hexadecachoron, the 4D cross-polytope): sixteen tetrahedral cells, eight corners on the axes. BOUND: (|x| + |y| + |z| + |w| − s) / 2, exact inside and never over the true distance ' +
    'outside. Radius s is the distance from the centre to each corner; at w = 0 the slice is an octahedron.',
  params: { radius: { def: 0.9, label: 'Radius (to corners)', min: 0.01, max: 5, step: 0.01, hint: 'Distance from the centre to each of the eight corners (on the axes).' } },
  glsl: `
float sdf4d_cell16(vec4 p, float s) {
    return (abs(p.x) + abs(p.y) + abs(p.z) + abs(p.w) - s) * 0.5;
}`,
  distHint: 'A bound: exact inside, never over the true distance outside.',
});

export const Cell24SDFNode = shapeNode({
  type: 'cell24SDF', label: '24-Cell SDF', fn: 'sdf4d_cell24',
  aliases: ['24-cell', 'icositetrachoron', 'octaplex'],
  description:
    'The 24-cell (icositetrachoron): twenty-four octahedral cells, 24 corners, and no 3D counterpart. It is self-dual: its cells and its corners have the same arrangement. BOUND: the larger of ' +
    'the biggest |coordinate| and half the sum of the four |coordinates|, minus the face distance: exact inside and never over the true distance outside. Radius is the distance to a corner; the faces are at 1/√2 of it.',
  params: { radius: { def: 0.95, label: 'Radius (to corners)', min: 0.01, max: 5, step: 0.01, hint: 'Distance from the centre to each corner. The 24 faces are at 0.707 of this.' } },
  glsl: `
float sdf4d_cell24(vec4 p, float R) {
    vec4 a = abs(p);
    return max(max(max(a.x, a.y), max(a.z, a.w)), 0.5 * (a.x + a.y + a.z + a.w)) - R * 0.70710678;
}`,
  distHint: 'A bound: exact inside, never over the true distance outside.',
});

// ─── More transforms ───────────────────────────────────────────────────────────

export const Scale4DNode: NodeDefinition = {
  type: 'scale4D', label: 'Scale 4D', category: CAT,
  aliases: ['4d scale', 'resize 4d', 'hyperscale'],
  description:
    'Scales a 4D shape evenly in all four directions: the point is divided by the scale on the way in and the distance is multiplied by it on the way out, so the distance stays true. ' +
    'Wire the point into a shape, then the shape\'s Distance back into Distance (in); the Corrected Distance is what goes on. Scale 2 makes the shape twice as big (the opposite of Scale 3D, whose factor shrinks).',
  inputs: {
    p4:    { type: 'vec4',  label: 'Point 4D' },
    dist:  { type: 'float', label: 'Distance (in)', hint: 'The distance measured on the scaled point, by a shape further on.' },
    scale: { type: 'float', label: 'Scale' },
  },
  outputs: {
    p4:   { type: 'vec4',  label: 'Scaled Point', hint: 'Wire into the shape.' },
    dist: { type: 'float', label: 'Corrected Distance', hint: 'The shape\'s distance, scaled back to the true size.' },
  },
  defaultParams: { scale: 1.5 },
  paramDefs: { scale: { label: 'Scale', type: 'float', min: 0.05, max: 10.0, step: 0.01, hint: 'How many times bigger the shape gets, in all four directions.' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const s = inputVars.scale || p(node.params.scale, 1.5);
    return {
      code: [
        `    float ${id}_s = max(${s}, 0.0001);\n`,
        `    vec4  ${id}_p4 = ${inputVars.p4 || 'vec4(0.0)'} / ${id}_s;\n`,
        `    float ${id}_dist = (${inputVars.dist ?? '0.0'}) * ${id}_s;\n`,
      ].join(''),
      outputVars: { p4: `${id}_p4`, dist: `${id}_dist` },
    };
  },
};

const AXIS_OPTIONS = [{ value: 'x', label: 'x' }, { value: 'y', label: 'y' }, { value: 'z', label: 'z' }, { value: 'w', label: 'w' }];

export const Repeat4DNode: NodeDefinition = {
  type: 'repeat4D', label: 'Repeat 4D', category: CAT,
  aliases: ['4d repeat', 'lattice 4d', 'tile 4d', 'hyperlattice'],
  description:
    'Repeats a 4D shape on a lattice: along every axis you switch on, the point is wrapped into one cell, so the shape appears in every cell. ' +
    'Repeat along w too and the slice sees a different part of each copy, so as a lattice of hyperspheres turns the 3D slice shows spheres swelling and shrinking in a pattern. ' +
    'Count 0 repeats forever; Count N keeps only the cells within N steps of the middle. Put it before the Rotate 4D to turn each copy, after to turn the whole lattice.',
  inputs: { p4: { type: 'vec4', label: 'Point 4D' } },
  outputs: { p4: { type: 'vec4', label: 'Repeated Point', hint: 'Wire into a 4D shape. Keep the shape smaller than half a cell so copies do not overlap.' } },
  defaultParams: { cellX: 1.0, cellY: 1.0, cellZ: 1.0, cellW: 1.0, repX: true, repY: true, repZ: true, repW: true, limit: 0.0 },
  paramDefs: {
    cellX: { label: 'Cell X', type: 'float', min: 0.05, max: 10, step: 0.01, hint: 'Spacing along x.' },
    cellY: { label: 'Cell Y', type: 'float', min: 0.05, max: 10, step: 0.01, hint: 'Spacing along y.' },
    cellZ: { label: 'Cell Z', type: 'float', min: 0.05, max: 10, step: 0.01, hint: 'Spacing along z.' },
    cellW: { label: 'Cell W', type: 'float', min: 0.05, max: 10, step: 0.01, hint: 'Spacing along the fourth axis.' },
    repX: { label: 'Repeat X', type: 'bool', hint: 'Repeat along x. Off keeps one copy in x.' },
    repY: { label: 'Repeat Y', type: 'bool', hint: 'Repeat along y.' },
    repZ: { label: 'Repeat Z', type: 'bool', hint: 'Repeat along z.' },
    repW: { label: 'Repeat W', type: 'bool', hint: 'Repeat along w.' },
    limit: { label: 'Count limit', type: 'float', min: 0.0, max: 20.0, step: 1.0, hint: '0 repeats forever. N keeps N copies on each side of the middle in every repeated direction.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const q = inputVars.p4 || 'vec4(0.0)';
    const cell = `vec4(${p(node.params.cellX, 1.0)}, ${p(node.params.cellY, 1.0)}, ${p(node.params.cellZ, 1.0)}, ${p(node.params.cellW, 1.0)})`;
    const on = (k: string) => (node.params[k] === false ? '0.0' : '1.0');
    const lim = p(node.params.limit, 0.0);
    return {
      code: [
        `    vec4 ${id}_q = ${q};\n`,
        `    vec4 ${id}_cell = max(${cell}, vec4(0.0001));\n`,
        `    vec4 ${id}_k = floor(${id}_q / ${id}_cell + 0.5);\n`,
        `    ${id}_k = ${lim} > 0.5 ? clamp(${id}_k, vec4(-${lim}), vec4(${lim})) : ${id}_k;\n`,
        `    vec4 ${id}_p4 = ${id}_q - ${id}_cell * ${id}_k * vec4(${on('repX')}, ${on('repY')}, ${on('repZ')}, ${on('repW')});\n`,
      ].join(''),
      outputVars: { p4: `${id}_p4` },
    };
  },
};

/** The mirror hyperplanes Fold 4D can reflect across: the unit normal of each. */
export const FOLD_MIRRORS_4D: Record<string, [number, number, number, number]> = {
  xy: [Math.SQRT1_2, -Math.SQRT1_2, 0, 0], xz: [Math.SQRT1_2, 0, -Math.SQRT1_2, 0], xw: [Math.SQRT1_2, 0, 0, -Math.SQRT1_2],
  yz: [0, Math.SQRT1_2, -Math.SQRT1_2, 0], yw: [0, Math.SQRT1_2, 0, -Math.SQRT1_2], zw: [0, 0, Math.SQRT1_2, -Math.SQRT1_2],
  sum: [0.5, 0.5, 0.5, 0.5],
};

const lit = (n: number): string => { const s = String(n); return s.includes('.') || s.includes('e') ? s : `${s}.0`; };

export const Fold4DNode: NodeDefinition = {
  type: 'fold4D', label: 'Mirror / Fold 4D', category: CAT,
  aliases: ['4d fold', 'mirror 4d', 'kaleidoscope 4d', 'abs 4d', 'symmetry 4d'],
  description:
    'Mirrors 4D space so the shape has the symmetry of a polytope. Each axis you switch on folds across its coordinate plane (abs: the shape appears on both sides). ' +
    'The Mirror across setting adds one more fold across a slanted hyperplane, x = y for instance, which swaps the two coordinates wherever one is smaller: put a shape off-centre and a ' +
    'copy appears on the other side of it. Folding never stretches space, so distances stay safe.',
  inputs: { p4: { type: 'vec4', label: 'Point 4D' } },
  outputs: { p4: { type: 'vec4', label: 'Folded Point' } },
  defaultParams: { foldX: true, foldY: true, foldZ: true, foldW: true, mirror: 'none' },
  paramDefs: {
    foldX: { label: 'Fold X', type: 'bool', hint: 'Mirror across x = 0.' },
    foldY: { label: 'Fold Y', type: 'bool', hint: 'Mirror across y = 0.' },
    foldZ: { label: 'Fold Z', type: 'bool', hint: 'Mirror across z = 0.' },
    foldW: { label: 'Fold W', type: 'bool', hint: 'Mirror across w = 0.' },
    mirror: { label: 'Mirror across', type: 'select', hint: 'One more fold across a slanted hyperplane, after the axis folds.',
              help: 'x = y (and the other pairs) swaps the two coordinates wherever the first is smaller, so everything ends on one side. "x + y + z + w = 0" reflects across the hyperplane whose normal is the corner direction (1,1,1,1). Combine with Fold X/Y/Z/W for the mirrors of the 16-cell and 24-cell.',
              options: [{ value: 'none', label: 'None' }, { value: 'xy', label: 'x = y' }, { value: 'xz', label: 'x = z' }, { value: 'xw', label: 'x = w' },
                        { value: 'yz', label: 'y = z' }, { value: 'yw', label: 'y = w' }, { value: 'zw', label: 'z = w' }, { value: 'sum', label: 'x + y + z + w = 0' }] },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const q = inputVars.p4 || 'vec4(0.0)';
    const comp = ['x', 'y', 'z', 'w'], keys = ['foldX', 'foldY', 'foldZ', 'foldW'];
    const parts = comp.map((c, i) => (node.params[keys[i]] === false ? `${id}_q.${c}` : `abs(${id}_q.${c})`));
    const m = String(node.params.mirror ?? 'none');
    const lines = [`    vec4 ${id}_q = ${q};\n`, `    vec4 ${id}_p4 = vec4(${parts.join(', ')});\n`];
    if (FOLD_MIRRORS_4D[m]) {
      lines.push(`    vec4 ${id}_n = vec4(${FOLD_MIRRORS_4D[m].map(lit).join(', ')});\n`, `    ${id}_p4 -= 2.0 * min(dot(${id}_p4, ${id}_n), 0.0) * ${id}_n;\n`);
    }
    return { code: lines.join(''), outputVars: { p4: `${id}_p4` } };
  },
};

/** The coordinate Twist 4D grows its angle with: `along`, unless it is in the plane (then the first axis outside the plane). */
export function twistAxis(plane: string, along: string): string {
  const [a, b] = planeAxes(plane);
  if (along !== a && along !== b && 'xyzw'.includes(along)) return along;
  return 'xyzw'.split('').find(c => c !== a && c !== b)!;
}

export const Twist4DNode: NodeDefinition = {
  type: 'twist4D', label: 'Twist 4D', category: CAT,
  aliases: ['4d twist', 'screw 4d', 'helix 4d'],
  description:
    'Twists 4D space: the point is rotated in a plane by an angle that grows with its coordinate along another axis (a screw). Not an exact distance: stretched space makes the distance ' +
    'run high, so the march can step through thin parts. The node scales the distance for you: wire the shape\'s Distance into Distance (in) and use the Corrected Distance, or lower the March Loop\'s Step Scale. ' +
    'Gentle twists need little correction; strong ones need a lower Step scale.',
  inputs: {
    p4:   { type: 'vec4',  label: 'Point 4D' },
    dist: { type: 'float', label: 'Distance (in)', hint: 'The distance measured on the twisted point, by a shape further on.' },
    amount: { type: 'float', label: 'Amount (deg/unit)' },
  },
  outputs: {
    p4:   { type: 'vec4',  label: 'Twisted Point' },
    dist: { type: 'float', label: 'Corrected Distance', hint: 'Distance times Step scale, to keep the march safe.' },
  },
  defaultParams: { plane: 'xz', along: 'y', amount: 40.0, stepScale: 0.7 },
  paramDefs: {
    plane: { label: 'Plane', type: 'select', hint: 'Which plane turns.', options: ROTATION_PLANES_4D.map(v => ({ value: v, label: v })) },
    along: { label: 'Along axis', type: 'select', hint: 'The coordinate the angle grows with. If it is in the plane, the first axis outside the plane is used.', options: AXIS_OPTIONS },
    amount: { label: 'Amount (deg/unit)', type: 'float', min: -360.0, max: 360.0, step: 0.5, hint: 'Degrees of turn per unit along the axis.' },
    stepScale: { label: 'Step scale', type: 'float', min: 0.2, max: 1.0, step: 0.01, hint: 'Multiplies the distance coming back; 1 is no correction. A twist is not 1-Lipschitz: about 1 / (1 + amount in radians × shape size) is safe.',
                 help: 'The twist makes the true distance up to a factor (1 + k·r) shorter than the measured one, where k is the amount in radians per unit and r how far from the axis the shape reaches. Dropping the step scale to that reciprocal keeps the march from stepping into the surface.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const q = inputVars.p4 || 'vec4(0.0)';
    const amount = inputVars.amount || p(node.params.amount, 40.0);
    const [a, b] = planeAxes(String(node.params.plane ?? 'xz'));
    const al = twistAxis(String(node.params.plane ?? 'xz'), String(node.params.along ?? 'y'));
    const out = ['x', 'y', 'z', 'w'].map(k => k === a ? `${id}_c * ${id}_q.${a} + ${id}_s * ${id}_q.${b}` : k === b ? `-${id}_s * ${id}_q.${a} + ${id}_c * ${id}_q.${b}` : `${id}_q.${k}`);
    return {
      code: [
        `    vec4  ${id}_q = ${q};\n`,
        `    float ${id}_t = ${amount} * ${DEG} * ${id}_q.${al};\n`,
        `    float ${id}_c = cos(${id}_t); float ${id}_s = sin(${id}_t);\n`,
        `    vec4  ${id}_p4 = vec4(${out.join(', ')});\n`,
        `    float ${id}_dist = (${inputVars.dist ?? '0.0'}) * ${p(node.params.stepScale, 0.7)};\n`,
      ].join(''),
      outputVars: { p4: `${id}_p4`, dist: `${id}_dist` },
    };
  },
};

// ─── 4D noise ──────────────────────────────────────────────────────────────────

const NOISE4D_GLSL = `
float noise4d_hash(vec4 q) {
    vec4 h = fract(q * vec4(0.1031, 0.1030, 0.0973, 0.1099));
    h += dot(h, h.wzxy + 33.33);
    return fract((h.x + h.y) * (h.z + h.w));
}
float noise4d_c(vec4 i, float a, float b, float c, float d) { return noise4d_hash(i + vec4(a, b, c, d)); }
float noise4d_x(vec4 i, float fx, float b, float c, float d) { return mix(noise4d_c(i, 0.0, b, c, d), noise4d_c(i, 1.0, b, c, d), fx); }
float noise4d_y(vec4 i, vec2 f, float c, float d) { return mix(noise4d_x(i, f.x, 0.0, c, d), noise4d_x(i, f.x, 1.0, c, d), f.y); }
float noise4d_z(vec4 i, vec3 f, float d) { return mix(noise4d_y(i, f.xy, 0.0, d), noise4d_y(i, f.xy, 1.0, d), f.z); }
float noise4d_value(vec4 q) {
    vec4 i = floor(q);
    vec4 f = fract(q);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(noise4d_z(i, f.xyz, 0.0), noise4d_z(i, f.xyz, 1.0), f.w);
}`;

export const Noise4DNode: NodeDefinition = {
  type: 'noise4D', label: 'Noise 4D', category: CAT,
  aliases: ['4d noise', 'value noise 4d', 'fbm 4d', 'evolving noise', 'time noise'],
  description:
    'Smooth value noise at a 4D point (vec4 to float), optionally layered into several octaves. The same point always gives the same number. ' +
    'Put the 3D position in x, y, z and time in w (Lift to 4D with w from Time) and the 3D pattern evolves smoothly instead of sliding; or add it to a 4D shape\'s distance to roughen the surface. ' +
    'Value is 0 to 1, Signed is −1 to 1 (the same noise stretched).',
  inputs: {
    p4:    { type: 'vec4',  label: 'Point 4D' },
    scale: { type: 'float', label: 'Scale' },
  },
  outputs: {
    value:  { type: 'float', label: 'Value (0..1)', hint: 'The noise from 0 to 1.' },
    signed: { type: 'float', label: 'Signed (−1..1)', hint: 'The noise from −1 to 1: add it to a distance to displace a surface in and out.' },
  },
  defaultParams: { scale: 2.0, octaves: '2', gain: 0.5 },
  paramDefs: {
    scale: { label: 'Scale', type: 'float', min: 0.05, max: 30.0, step: 0.05, hint: 'Features per unit: higher is finer.' },
    octaves: { label: 'Octaves', type: 'select', hint: 'Layers of noise, each twice as fine.', options: ['1', '2', '3', '4'].map(v => ({ value: v, label: v })) },
    gain: { label: 'Gain', type: 'float', min: 0.1, max: 0.9, step: 0.01, hint: 'How strong each finer layer is compared with the one before.' },
  },
  glslFunction: NOISE4D_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const q = inputVars.p4 || 'vec4(0.0)';
    const scale = inputVars.scale || p(node.params.scale, 2.0);
    const gain = p(node.params.gain, 0.5);
    const oct = Math.min(4, Math.max(1, parseInt(String(node.params.octaves ?? '2'), 10) || 2));
    const lines = [`    vec4  ${id}_q = ${q} * ${scale};\n`, `    float ${id}_a = 1.0;\n`, `    float ${id}_sum = 0.0;\n`, `    float ${id}_tot = 0.0;\n`];
    for (let o = 0; o < oct; o++) {
      lines.push(`    ${id}_sum += ${id}_a * noise4d_value(${id}_q); ${id}_tot += ${id}_a;\n`);
      if (o < oct - 1) lines.push(`    ${id}_q = ${id}_q * 2.03 + vec4(${(17.1 + o * 3.7).toFixed(1)}, ${(31.7 + o * 1.3).toFixed(1)}, ${(5.3 + o * 7.9).toFixed(1)}, ${(9.9 + o * 2.1).toFixed(1)}); ${id}_a *= ${gain};\n`);
    }
    lines.push(`    float ${id}_value = ${id}_sum / ${id}_tot;\n`, `    float ${id}_signed = ${id}_value * 2.0 - 1.0;\n`);
    return { code: lines.join(''), outputVars: { value: `${id}_value`, signed: `${id}_signed` } };
  },
};

/** Phase 2 nodes, for the registry. */
export const FOURD_P2_NODES: Record<string, NodeDefinition> = {
  duocylinderSDF: DuocylinderSDFNode, spherinderSDF: SpherinderSDFNode, cubinderSDF: CubinderSDFNode, cylPrismSDF: CylPrismSDFNode,
  ditorusSDF: DitorusSDFNode, cliffordTorusSDF: CliffordTorusSDFNode, cell5SDF: Cell5SDFNode, cell16SDF: Cell16SDFNode, cell24SDF: Cell24SDFNode,
  scale4D: Scale4DNode, repeat4D: Repeat4DNode, fold4D: Fold4DNode, twist4D: Twist4DNode, noise4D: Noise4DNode,
};
export const FOURD_SHAPE_TYPES = ['hypersphereSDF', 'tesseractSDF', 'duocylinderSDF', 'spherinderSDF', 'cubinderSDF', 'cylPrismSDF', 'ditorusSDF', 'cliffordTorusSDF', 'cell5SDF', 'cell16SDF', 'cell24SDF'] as const;
