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
  defaultParams: { w: 0.0 },
  paramDefs: {
    w: { label: 'W (slice)', type: 'float', min: -2.0, max: 2.0, step: 0.01, hint: 'Which slice of the 4D shape you see. 0 is through the middle.',
         help: 'The fourth coordinate given to every point. A 4D shape is solid in four directions; this chooses the 3D layer you are looking at. At 0 you cut through the middle, past the shape\'s edge in w the slice is empty. Animatable and live.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const w = inputVars.w || p(node.params.w, 0.0);
    return {
      code: `    vec4 ${id}_p4 = vec4(${pos}, ${w});\n`,
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
