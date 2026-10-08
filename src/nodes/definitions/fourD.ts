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

const CAT = '4D';

/** The six planes of rotation in 4D (a rotation turns one axis toward another): the pair each one turns. */
export const ROTATION_PLANES_4D = ['xy', 'xz', 'xw', 'yz', 'yw', 'zw'] as const;
export type RotationPlane4D = typeof ROTATION_PLANES_4D[number];

const DEG = '0.017453292519943295';

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

const SDF4D_GLSL = `
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
