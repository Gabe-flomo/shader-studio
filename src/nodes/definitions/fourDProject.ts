/**
 * fourDProject.ts — 4D phase 3 (docs/4d.md): PROJECTION. Slicing shows one cross-section of a 4D
 * object; projection shows the whole object squashed into 3D, like a shadow, the way a cube drawn
 * on paper shows all its faces at once. Three ways:
 *
 *   4D Wireframe        the edges and corners of a regular polytope, each corner carried from 4D to 3D
 *                       (perspective or orthographic), as capsules and spheres. A normal 3D SDF.
 *   Project 4D          the solid shadow of a 4D shape along w: the nearest of the shape's distances
 *                       at a stack of w values. An approximation (docs/4d.md says how good).
 *   Stereographic 4D    a 3D point is mapped onto the 3-sphere, turned in 4D, and handed to a 4D
 *                       shape living on that sphere (a Clifford torus, Hopf circles); the distance
 *                       is corrected for the stretch of the map so the march stays safe.
 *
 * Also here: Hopf Circles SDF, a few fibres of the Hopf fibration as thin tori around great circles.
 *
 * The maths is plain enough to repeat in TypeScript, and the tests do (the polytope lists, the
 * projection, the stereographic map and its stretch) against the real GLSL run on the CPU.
 */
import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';
import {
  CAT, DEG, ROTATION_PLANES_4D, planeAxes, shapeNode,
  HypersphereSDFNode, TesseractSDFNode, DuocylinderSDFNode, SpherinderSDFNode, CubinderSDFNode,
  DitorusSDFNode, CliffordTorusSDFNode, Cell5SDFNode, Cell16SDFNode, Cell24SDFNode,
} from './fourD';

// ─── Polytopes: vertices and edges, generated here ─────────────────────────────

export const POLYTOPES = ['tesseract', 'cell5', 'cell16', 'cell24'] as const;
export type Polytope = typeof POLYTOPES[number];

export interface PolytopeData { vertices: number[][]; edges: Array<[number, number]> }

const norm4 = (v: number[]) => { const l = Math.hypot(...v); return v.map(x => x / l); };

/**
 * Corners on the unit 3-sphere, and the edges (index pairs).
 *   tesseract  16 corners (±1,±1,±1,±1)/2; an edge joins two corners that differ in one sign: 32 edges
 *   5-cell      5 corners; every pair is an edge: 10 edges. One corner points along +w (as the 5-Cell SDF)
 *   16-cell     8 corners ±e_k; every pair except opposite corners: 24 edges
 *   24-cell    24 corners (±1,±1,0,0)/√2 in every arrangement; an edge joins corners 60 degrees apart (dot = 1/2): 96 edges
 */
export function polytope(kind: string): PolytopeData {
  const vertices: number[][] = [];
  let edgeOf: (a: number[], b: number[]) => boolean;
  if (kind === 'cell5') {
    const s = 1 / Math.sqrt(5);
    for (const [x, y, z] of [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]) vertices.push(norm4([x, y, z, -s]));
    vertices.push([0, 0, 0, 1]);
    edgeOf = () => true;
  } else if (kind === 'cell16') {
    for (let k = 0; k < 4; k++) for (const sg of [1, -1]) { const v = [0, 0, 0, 0]; v[k] = sg; vertices.push(v); }
    edgeOf = (a, b) => Math.abs(a.reduce((s, x, i) => s + x * b[i], 0) + 1) > 1e-9;
  } else if (kind === 'cell24') {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) for (const si of [1, -1]) for (const sj of [1, -1]) {
      const v = [0, 0, 0, 0]; v[i] = si; v[j] = sj; vertices.push(norm4(v));
    }
    edgeOf = (a, b) => Math.abs(a.reduce((s, x, i) => s + x * b[i], 0) - 0.5) < 1e-9;
  } else {
    for (let m = 0; m < 16; m++) vertices.push([0, 1, 2, 3].map(k => ((m >> k) & 1 ? 0.5 : -0.5)));
    edgeOf = (a, b) => a.filter((x, i) => Math.abs(x - b[i]) > 1e-9).length === 1;
  }
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) if (edgeOf(vertices[i], vertices[j])) edges.push([i, j]);
  return { vertices, edges };
}

/** One 4D point to 3D. Perspective: xyz * d / (d - w) (a camera on the w axis at distance d; w = 0 keeps its size); orthographic: drop w. */
export function project4(v: readonly number[], camDist: number, perspective: boolean): [number, number, number] {
  const k = perspective ? camDist / Math.max(camDist - v[3], 0.05) : 1;
  return [v[0] * k, v[1] * k, v[2] * k];
}

/** Turn a 4D point in plane `a-b` (component letters) by `t` radians, the Rotate 4D way (the shape turns from a toward b). */
export function rotatePlane(v: readonly number[], plane: string, t: number): number[] {
  const [a, b] = planeAxes(plane);
  const ia = 'xyzw'.indexOf(a), ib = 'xyzw'.indexOf(b);
  const c = Math.cos(t), s = Math.sin(t), out = [...v];
  out[ia] = c * v[ia] + s * v[ib];
  out[ib] = -s * v[ia] + c * v[ib];
  return out;
}

/** The inverse stereographic map R³ -> unit S³ (pole at +w): x -> (2x, |x|² - 1) / (|x|² + 1). */
export function stereoInverse(x: readonly number[]): number[] {
  const r2 = x[0] * x[0] + x[1] * x[1] + x[2] * x[2];
  return [2 * x[0] / (r2 + 1), 2 * x[1] / (r2 + 1), 2 * x[2] / (r2 + 1), (r2 - 1) / (r2 + 1)];
}
/** Back again: X on S³ -> X.xyz / (1 - X.w). */
export function stereoForward(X: readonly number[]): number[] {
  const k = 1 - X[3];
  return [X[0] / k, X[1] / k, X[2] / k];
}
/** How much the map stretches near x (the conformal factor, unit sphere): 2 / (1 + |x|²) per unit of x. */
export const stereoStretch = (x: readonly number[]) => 2 / (1 + x[0] * x[0] + x[1] * x[1] + x[2] * x[2]);

// ─── Rotation: two planes, turned into the images of the four axes ─────────────

const PLANE_OPTIONS = ROTATION_PLANES_4D.map(v => ({ value: v, label: v }));

/** The settings of the two turns every projection node takes. */
function rotationDefs(plane1: string, plane2: string) {
  return {
    defaults: { plane1, angle1: 0.0, spin1: 0.0, plane2, angle2: 0.0, spin2: 0.0 },
    paramDefs: {
      plane1: { label: 'Turn 1 plane', type: 'select' as const, options: PLANE_OPTIONS, hint: 'The first 4D turn: which two directions it mixes. Planes with w change the picture the most.' },
      angle1: { label: 'Turn 1 angle (deg)', type: 'float' as const, min: -360.0, max: 360.0, step: 0.5, hint: 'How far the first turn has gone, in degrees.' },
      spin1:  { label: 'Turn 1 spin (deg/s)', type: 'float' as const, min: -180.0, max: 180.0, step: 0.5, hint: 'Keeps turning over time at this many degrees a second, on top of the angle.' },
      plane2: { label: 'Turn 2 plane', type: 'select' as const, options: PLANE_OPTIONS, hint: 'The second 4D turn, applied after the first. Two turns at different speeds make the double rotation of a 4D object.' },
      angle2: { label: 'Turn 2 angle (deg)', type: 'float' as const, min: -360.0, max: 360.0, step: 0.5, hint: 'How far the second turn has gone, in degrees.' },
      spin2:  { label: 'Turn 2 spin (deg/s)', type: 'float' as const, min: -180.0, max: 180.0, step: 0.5, hint: 'Keeps turning over time at this many degrees a second, on top of the angle.' },
    },
  };
}

/** `vec4(...)` that turns the vec4 variable `q` in `plane` by an angle with cosine `c` and sine `s`: the same mixing as Rotate 4D. */
function rotExpr(q: string, plane: string, c: string, s: string): string {
  const [a, b] = planeAxes(plane);
  const comp = ['x', 'y', 'z', 'w'];
  const out = comp.map(k => (k === a ? `${c} * ${q}.${a} + ${s} * ${q}.${b}` : k === b ? `-${s} * ${q}.${a} + ${c} * ${q}.${b}` : `${q}.${k}`));
  return `vec4(${out.join(', ')})`;
}

/**
 * GLSL that builds `<id>_c0 .. <id>_c3`: where the two turns carry the four axes (the columns of the rotation M = turn2 * turn1).
 * A corner v turns to c0*v.x + c1*v.y + c2*v.z + c3*v.w; a point turned the other way (to ask a shape what it looks like turned) is
 * vec4(dot(c0, q), dot(c1, q), dot(c2, q), dot(c3, q)).
 */
function rotationColumns(node: GraphNode, inputVars: Record<string, string | undefined>): string {
  const id = node.id;
  const a1 = inputVars.angle1 || p(node.params.angle1, 0.0), a2 = inputVars.angle2 || p(node.params.angle2, 0.0);
  const sp1 = p(node.params.spin1, 0.0), sp2 = p(node.params.spin2, 0.0);
  const pl1 = String(node.params.plane1 ?? 'xw'), pl2 = String(node.params.plane2 ?? 'yz');
  const lines = [
    `    float ${id}_t1 = (${a1} + ${sp1} * u_time) * ${DEG}; float ${id}_k1 = cos(${id}_t1); float ${id}_s1 = sin(${id}_t1);\n`,
    `    float ${id}_t2 = (${a2} + ${sp2} * u_time) * ${DEG}; float ${id}_k2 = cos(${id}_t2); float ${id}_s2 = sin(${id}_t2);\n`,
  ];
  const E = ['vec4(1.0, 0.0, 0.0, 0.0)', 'vec4(0.0, 1.0, 0.0, 0.0)', 'vec4(0.0, 0.0, 1.0, 0.0)', 'vec4(0.0, 0.0, 0.0, 1.0)'];
  for (let k = 0; k < 4; k++) {
    lines.push(`    vec4 ${id}_a${k} = ${E[k]};\n`);
    lines.push(`    vec4 ${id}_b${k} = ${rotExpr(`${id}_a${k}`, pl1, `${id}_k1`, `${id}_s1`)};\n`);
    lines.push(`    vec4 ${id}_c${k} = ${rotExpr(`${id}_b${k}`, pl2, `${id}_k2`, `${id}_s2`)};\n`);
  }
  return lines.join('');
}
const colArgs = (id: string) => [0, 1, 2, 3].map(k => `${id}_c${k}`).join(', ');

/** Plain decimal text for a GLSL float literal. */
const lit = (x: number) => { const s = x.toFixed(8).replace(/0+$/, ''); return s.endsWith('.') ? `${s}0` : s; };

// ─── 4D Wireframe ──────────────────────────────────────────────────────────────

const WIRE_HELPERS = `
vec3 sdf4d_proj(vec4 v, float camD, float persp) {
    return v.xyz * mix(1.0, camD / max(camD - v.w, 0.05), persp);
}
float sdf4d_seg2(vec3 p, vec3 a, vec3 b) {
    vec3 pa = p - a;
    vec3 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00000001), 0.0, 1.0);
    vec3 d = pa - ba * h;
    return dot(d, d);
}`;

/** The GLSL function that measures one polytope's wireframe: every corner turned and projected once, then one segment test per edge, all unrolled. */
export function wireframeFunction(kind: string): string {
  const { vertices, edges } = polytope(kind);
  const term = (x: number, k: number) => (Math.abs(x) < 1e-9 ? '' : `c${k} * ${lit(x)}`);
  const lines: string[] = [];
  vertices.forEach((v, i) => {
    const sum = v.map((x, k) => term(x, k)).filter(Boolean).join(' + ').replace(/\+ c(\d) \* -/g, '- c$1 * ');
    lines.push(`    vec3 q${i} = sdf4d_proj((${sum}) * R, camD, persp);\n`);
  });
  lines.push('    float e2 = 1000000.0;\n    float v2 = 1000000.0;\n');
  for (const [a, b] of edges) lines.push(`    e2 = min(e2, sdf4d_seg2(p, q${a}, q${b}));\n`);
  vertices.forEach((_, i) => lines.push(`    v2 = min(v2, dot(p - q${i}, p - q${i}));\n`));
  return `
float sdf4d_wire_${kind}(vec3 p, vec4 c0, vec4 c1, vec4 c2, vec4 c3, float R, float camD, float persp, float er, float vr) {
    float reach = R * mix(1.0, camD / max(camD - R, 0.05), persp);
    float far = length(p) - reach - max(er, vr);
    if (far > 0.25) return far;
${lines.join('')}    return min(sqrt(e2) - er, sqrt(v2) - vr);
}`;
}

const rot12 = rotationDefs('xw', 'yz');

export const Wireframe4DNode: NodeDefinition = {
  type: 'wireframe4D', label: '4D Wireframe', category: CAT,
  aliases: ['4d projection', 'projected tesseract', 'hypercube wireframe', 'polytope wireframe', 'schlegel', 'tesseract projection', '24-cell wireframe'],
  description:
    'The edges and corners of a 4D regular polytope (tesseract, 5-cell, 16-cell or 24-cell), turned in 4D and projected into 3D, as thin tubes and balls. A slice shows one cross-section; this shows the whole thing at once, the way a drawing of a cube shows all its edges. ' +
    'Perspective looks along w from a camera at Camera distance: the far cell shrinks inside the near one, the classic cube-in-a-cube of the tesseract. Orthographic simply drops w. ' +
    'A normal 3D distance: wire Scene Pos in, put it in a Scene Group and union it with other shapes. Turn it with the two 4D turns (xw makes the inner cube swell out through the faces).',
  inputs: {
    pos:     { type: 'vec3',  label: 'Position', hint: 'The 3D point being measured: wire Scene Pos here.' },
    radius:  { type: 'float', label: 'Radius' },
    edge:    { type: 'float', label: 'Edge radius' },
    vertex:  { type: 'float', label: 'Corner radius' },
    camDist: { type: 'float', label: 'Camera distance' },
    angle1:  { type: 'float', label: 'Turn 1 angle (deg)' },
    angle2:  { type: 'float', label: 'Turn 2 angle (deg)' },
  },
  outputs: { dist: { type: 'float', label: 'Distance', hint: 'Signed distance to the tubes and balls. Exact for the tubes; wire into a Union or straight to Scene Output.' } },
  defaultParams: { polytope: 'tesseract', projection: 'perspective', radius: 1.0, camDist: 3.0, edge: 0.025, vertex: 0.05, ...rot12.defaults },
  paramDefs: {
    polytope: { label: 'Polytope', type: 'select', hint: 'Which 4D shape to draw.',
                help: 'Tesseract: 16 corners, 32 edges (a cube in 4D). 5-cell: 5 corners, 10 edges (the 4D tetrahedron). 16-cell: 8 corners, 24 edges (the 4D octahedron). 24-cell: 24 corners, 96 edges (no 3D relative).',
                options: [{ value: 'tesseract', label: 'Tesseract (16 / 32)' }, { value: 'cell5', label: '5-cell (5 / 10)' }, { value: 'cell16', label: '16-cell (8 / 24)' }, { value: 'cell24', label: '24-cell (24 / 96)' }] },
    projection: { label: 'Projection', type: 'select', hint: 'Perspective shrinks what is far along w; orthographic ignores w.',
                  help: 'Perspective: a camera on the w axis at Camera distance sees each corner at (x, y, z) × d / (d − w): corners at small w are far and look small. Orthographic: the corner is just (x, y, z). Perspective needs Camera distance bigger than Radius.',
                  options: [{ value: 'perspective', label: 'Perspective' }, { value: 'orthographic', label: 'Orthographic' }] },
    radius:  { label: 'Radius', type: 'float', min: 0.05, max: 5.0, step: 0.01, hint: 'Distance from the centre to each corner in 4D, before projecting.' },
    camDist: { label: 'Camera distance', type: 'float', min: 1.05, max: 12.0, step: 0.01, showWhen: { param: 'projection', value: 'perspective' },
               hint: 'How far along w the camera sits. Keep it above Radius. Near (1.5) is dramatic, far (6) approaches orthographic.' },
    edge:    { label: 'Edge radius', type: 'float', min: 0.002, max: 0.4, step: 0.001, hint: 'Thickness of the tubes along the edges (3D units, the same everywhere).' },
    vertex:  { label: 'Corner radius', type: 'float', min: 0.0, max: 0.5, step: 0.001, hint: 'Radius of the ball at each corner. 0 hides them.' },
    ...rot12.paramDefs,
  },
  glslFunctionsFor: (node: GraphNode) => [WIRE_HELPERS, wireframeFunction(String(node.params.polytope ?? 'tesseract'))],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const kind = (POLYTOPES as readonly string[]).includes(String(node.params.polytope)) ? String(node.params.polytope) : 'tesseract';
    const persp = node.params.projection === 'orthographic' ? '0.0' : '1.0';
    const R = inputVars.radius || p(node.params.radius, 1.0);
    const d = inputVars.camDist || p(node.params.camDist, 3.0);
    const er = inputVars.edge || p(node.params.edge, 0.025), vr = inputVars.vertex || p(node.params.vertex, 0.05);
    return {
      code: rotationColumns(node, inputVars) +
        `    float ${id}_dist = sdf4d_wire_${kind}(${inputVars.pos || 'vec3(0.0)'}, ${colArgs(id)}, ${R}, ${d}, ${persp}, ${er}, ${vr});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

// ─── Project 4D ────────────────────────────────────────────────────────────────

/** Which 4D shape, with its GLSL and how Size / Ratio / Thickness become its arguments. */
const PROJECT_SHAPES: Record<string, { fn: string; def: NodeDefinition; args: string }> = {
  hypersphere: { fn: 'sdf4d_hypersphere', def: HypersphereSDFNode, args: 'sz' },
  tesseract:   { fn: 'sdf4d_tesseract', def: TesseractSDFNode, args: 'sz, 0.0' },
  duocylinder: { fn: 'sdf4d_duocylinder', def: DuocylinderSDFNode, args: 'sz, sz * ra' },
  spherinder:  { fn: 'sdf4d_spherinder', def: SpherinderSDFNode, args: 'sz, sz * ra' },
  cubinder:    { fn: 'sdf4d_cubinder', def: CubinderSDFNode, args: 'sz, sz * ra' },
  ditorus:     { fn: 'sdf4d_ditorus', def: DitorusSDFNode, args: 'sz, sz * ra, th' },
  clifford:    { fn: 'sdf4d_clifford', def: CliffordTorusSDFNode, args: 'sz, th, 45.0' },
  cell5:       { fn: 'sdf4d_cell5', def: Cell5SDFNode, args: 'sz' },
  cell16:      { fn: 'sdf4d_cell16', def: Cell16SDFNode, args: 'sz' },
  cell24:      { fn: 'sdf4d_cell24', def: Cell24SDFNode, args: 'sz' },
};

const SMIN_GLSL = `
float sdf4d_smin(float a, float b, float k) {
    if (k <= 0.0) return min(a, b);
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
}`;

/** Most w samples a shadow may take (the loop bound). */
export const PROJECT_MAX_SAMPLES = 48;

/** The shadow function for one shape: the smooth minimum of its 4D distance at `n` evenly spaced w values in [-W, W], the point turned first. */
export function projectFunction(shape: string): string {
  const s = PROJECT_SHAPES[shape] ?? PROJECT_SHAPES.duocylinder;
  return `
float sdf4d_project_${shape in PROJECT_SHAPES ? shape : 'duocylinder'}(vec3 pos, vec4 c0, vec4 c1, vec4 c2, vec4 c3, float W, float n, float sm, float stepScale, float sz, float ra, float th) {
    float h = 2.0 * W / max(n - 1.0, 1.0);
    float k = sm * h;
    float d = 1000000.0;
    for (int i = 0; i < ${PROJECT_MAX_SAMPLES}; i++) {
        if (float(i) >= n) break;
        float w = n < 1.5 ? 0.0 : -W + h * float(i);
        vec4 q = vec4(pos, w);
        q = vec4(dot(c0, q), dot(c1, q), dot(c2, q), dot(c3, q));
        float di = ${s.fn}(q, ${s.args});
        d = i == 0 ? di : sdf4d_smin(d, di, k);
    }
    return d > 0.0 ? d * stepScale : d;
}`;
}

const rot0 = rotationDefs('xw', 'yz');

export const Project4DNode: NodeDefinition = {
  type: 'project4D', label: 'Project 4D', category: CAT,
  aliases: ['4d shadow', 'volumetric projection', 'extrusion union', 'project along w', 'solid projection', 'duocylinder shadow'],
  description:
    'The solid shadow of a 4D shape: what you would see if the whole shape were flattened along w into 3D. It measures the shape\'s 4D distance at a stack of w values (Samples, spread over ±W range) and keeps the nearest, ' +
    'so the result is wherever ANY slice of the shape is. APPROXIMATE: with infinitely many samples the minimum is exactly the distance to the shadow; with a few it is the shadow of a stack of slices, a little bumpy, and it can read larger than the true distance ' +
    '(the surface is never too small, the march can overshoot). Smooth rounds the steps between slices; Step scale shortens the march steps to be safe. Turn the shape with the two 4D turns first: the shadow of a turning shape changes shape.',
  inputs: {
    pos:   { type: 'vec3',  label: 'Position', hint: 'The 3D point being measured: wire Scene Pos here.' },
    size:  { type: 'float', label: 'Size' },
    wRange: { type: 'float', label: 'W range' },
    angle1: { type: 'float', label: 'Turn 1 angle (deg)' },
    angle2: { type: 'float', label: 'Turn 2 angle (deg)' },
  },
  outputs: { dist: { type: 'float', label: 'Distance', hint: 'Approximate signed distance to the shadow.' } },
  defaultParams: { shape: 'duocylinder', size: 0.7, ratio: 0.8, thick: 0.15, wRange: 1.0, samples: 16, smooth: 1.0, stepScale: 0.8, ...rot0.defaults },
  paramDefs: {
    shape: { label: 'Shape', type: 'select', hint: 'Which 4D shape to cast the shadow of.',
             options: [{ value: 'duocylinder', label: 'Duocylinder' }, { value: 'tesseract', label: 'Tesseract' }, { value: 'hypersphere', label: 'Hypersphere' }, { value: 'spherinder', label: 'Spherinder' },
                       { value: 'cubinder', label: 'Cubinder' }, { value: 'ditorus', label: 'Ditorus' }, { value: 'clifford', label: 'Clifford torus' }, { value: 'cell5', label: '5-cell' },
                       { value: 'cell16', label: '16-cell' }, { value: 'cell24', label: '24-cell' }] },
    size:  { label: 'Size', type: 'float', min: 0.05, max: 3.0, step: 0.01, hint: 'The shape\'s main size: radius (or half size, or the first radius). The shape is centred.' },
    ratio: { label: 'Second size ratio', type: 'float', min: 0.05, max: 2.0, step: 0.01, showWhen: { param: 'shape', value: ['duocylinder', 'spherinder', 'cubinder', 'ditorus'] },
             hint: 'The second radius (or height) as a fraction of Size: Duocylinder\'s zw radius, Spherinder\'s half height, Cubinder\'s disc, Ditorus\'s second circle.' },
    thick: { label: 'Tube thickness', type: 'float', min: 0.01, max: 1.0, step: 0.005, showWhen: { param: 'shape', value: ['ditorus', 'clifford'] }, hint: 'Radius of the tube around the torus.' },
    wRange: { label: 'W range (±)', type: 'float', min: 0.05, max: 4.0, step: 0.01, hint: 'The slices are taken from −W to +W. Make it at least as big as the shape\'s reach along w, or the shadow is cut short.' },
    samples: { label: 'Samples', type: 'float', min: 1.0, max: PROJECT_MAX_SAMPLES, step: 1.0, hint: 'How many w values to look at. More is a truer, smoother shadow and costs one shape evaluation each.',
               help: 'The distance to the true shadow is the minimum over EVERY w. With few samples the minimum is taken over thin slices, so the surface shows steps between them and can sit a little inside the true silhouette. An odd count includes w = 0.' },
    smooth: { label: 'Smooth (× spacing)', type: 'float', min: 0.0, max: 4.0, step: 0.05, hint: 'Rounds the steps between neighbouring slices, as a multiple of the spacing between samples. 0 is a hard minimum.' },
    stepScale: { label: 'Step scale', type: 'float', min: 0.2, max: 1.0, step: 0.01, hint: 'Multiplies the outside distance. Below 1 the march takes shorter steps, which hides overshoot from a coarse sample count.' },
    ...rot0.paramDefs,
  },
  glslFunctionsFor: (node: GraphNode) => {
    const shape = String(node.params.shape ?? 'duocylinder');
    const s = PROJECT_SHAPES[shape] ?? PROJECT_SHAPES.duocylinder;
    return [s.def.glslFunction as string, SMIN_GLSL, projectFunction(shape in PROJECT_SHAPES ? shape : 'duocylinder')];
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const shape = String(node.params.shape ?? 'duocylinder') in PROJECT_SHAPES ? String(node.params.shape ?? 'duocylinder') : 'duocylinder';
    const sz = inputVars.size || p(node.params.size, 0.7);
    const W = inputVars.wRange || p(node.params.wRange, 1.0);
    const args = [W, p(node.params.samples, 16), p(node.params.smooth, 1.0), p(node.params.stepScale, 0.8), sz, p(node.params.ratio, 0.8), p(node.params.thick, 0.15)];
    return {
      code: rotationColumns(node, inputVars) +
        `    float ${id}_dist = sdf4d_project_${shape}(${inputVars.pos || 'vec3(0.0)'}, ${colArgs(id)}, ${args.join(', ')});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

// ─── Stereographic 4D ──────────────────────────────────────────────────────────

const rotS = rotationDefs('xw', 'yz');

export const Stereographic4DNode: NodeDefinition = {
  type: 'stereo4D', label: 'Stereographic 4D', category: CAT,
  aliases: ['stereographic projection', 'hopf', 'three-sphere', 'inverse stereographic', 's3', 'conformal'],
  description:
    'Lays all of 3D space onto the surface of a 3-sphere (the 4D ball\'s skin), turns it in 4D, and hands the 4D point to a shape that lives on that sphere. The origin goes to the south pole, infinity to the north pole, and circles stay circles. ' +
    'So a Clifford torus on the 3-sphere appears as an ordinary torus, and Hopf circles as a bundle of linked rings that fills space. The map stretches distances (by 2 / (1 + |x/Scale|²) × Radius / Scale), so a 4D distance is not a 3D one: ' +
    'wire the Factor and Scale outputs, and the shape\'s Distance, into Stereographic Distance, which divides the stretch out so marching never steps through the surface.',
  inputs: {
    pos:    { type: 'vec3',  label: 'Position', hint: 'The 3D point being measured: wire Scene Pos here.' },
    scale:  { type: 'float', label: 'Scale' },
    radius: { type: 'float', label: 'Sphere radius' },
    angle1: { type: 'float', label: 'Turn 1 angle (deg)' },
    angle2: { type: 'float', label: 'Turn 2 angle (deg)' },
  },
  outputs: {
    p4:     { type: 'vec4',  label: 'Point 4D', hint: 'The point on the 3-sphere, turned. Wire into a 4D shape that lives on the sphere (Clifford Torus, Hopf Circles).' },
    factor: { type: 'float', label: 'Factor', hint: 'How many 3D units one unit of 4D distance is worth at this point. Wire into Stereographic Distance.' },
    scale:  { type: 'float', label: 'Scale', hint: 'The Scale setting, for Stereographic Distance\'s safety limit.' },
  },
  defaultParams: { scale: 1.0, radius: 1.0, ...rotS.defaults },
  paramDefs: {
    scale:  { label: 'Scale', type: 'float', min: 0.05, max: 8.0, step: 0.01, hint: 'How big the picture is in 3D: the unit sphere around the origin is the equator of the 3-sphere. Bigger Scale shows a bigger picture.' },
    radius: { label: 'Sphere radius', type: 'float', min: 0.1, max: 4.0, step: 0.01, hint: 'The 3-sphere\'s radius in 4D. Match the shape\'s own radius (Clifford Torus: Sphere radius).' },
    ...rotS.paramDefs,
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const sc = inputVars.scale || p(node.params.scale, 1.0), rho = inputVars.radius || p(node.params.radius, 1.0);
    return {
      code: rotationColumns(node, inputVars) + [
        `    float ${id}_s = max(${sc}, 0.0001);\n`,
        `    float ${id}_rho = max(${rho}, 0.0001);\n`,
        `    vec3  ${id}_x = ${inputVars.pos || 'vec3(0.0)'} / ${id}_s;\n`,
        `    float ${id}_r2 = dot(${id}_x, ${id}_x);\n`,
        `    vec4  ${id}_P = vec4(2.0 * ${id}_x, ${id}_r2 - 1.0) / (${id}_r2 + 1.0) * ${id}_rho;\n`,
        `    vec4  ${id}_p4 = vec4(dot(${id}_c0, ${id}_P), dot(${id}_c1, ${id}_P), dot(${id}_c2, ${id}_P), dot(${id}_c3, ${id}_P));\n`,
        // The map stretches by 2 rho / (s (1 + r2)); one unit of 4D distance is worth s (1 + r2) / (2 rho) units of 3D.
        `    float ${id}_factor = ${id}_s * (1.0 + ${id}_r2) / (2.0 * ${id}_rho);\n`,
      ].join(''),
      outputVars: { p4: `${id}_p4`, factor: `${id}_factor`, scale: `${id}_s` },
    };
  },
};

export const StereoDistanceNode: NodeDefinition = {
  type: 'stereoDist4D', label: 'Stereographic Distance', category: CAT,
  aliases: ['stereographic correction', 'conformal distance', 'stereographic fix'],
  description:
    'Turns the distance a 4D shape measured on the 3-sphere into a safe 3D distance for the march. The stereographic map stretches space by a known amount at each point, so E = Distance × Factor is about the 3D distance; ' +
    'but the stretch can grow by a factor e per Scale as you move, so the safe value is min(E, Scale) × e^(−min(E, Scale) / Scale): equal to E for small distances, never over the true one, and capped at Scale / e far away. Inside the shape E is used as it is.',
  inputs: {
    dist:   { type: 'float', label: 'Distance (4D)', hint: 'The distance a 4D shape measured at Stereographic 4D\'s Point 4D.' },
    factor: { type: 'float', label: 'Factor', hint: 'Stereographic 4D\'s Factor output.' },
    scale:  { type: 'float', label: 'Scale', hint: 'Stereographic 4D\'s Scale output.' },
  },
  outputs: { dist: { type: 'float', label: 'Distance (3D)', hint: 'Safe signed 3D distance: goes on to Scene Output.' } },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    return {
      code: [
        `    float ${id}_E = (${inputVars.dist ?? '0.0'}) * (${inputVars.factor ?? '1.0'});\n`,
        `    float ${id}_sc = max(${inputVars.scale ?? '1.0'}, 0.0001);\n`,
        `    float ${id}_m = min(${id}_E, ${id}_sc);\n`,
        `    float ${id}_dist = ${id}_E > 0.0 ? ${id}_m * exp(-${id}_m / ${id}_sc) : ${id}_E;\n`,
      ].join(''),
      outputVars: { dist: `${id}_dist` },
    };
  },
};

// ─── Hopf Circles ──────────────────────────────────────────────────────────────

/** Most fibres per ring, and rings, the Hopf Circles loop allows. */
export const HOPF_MAX_COUNT = 24;
export const HOPF_MAX_RINGS = 3;

export const HopfCirclesSDFNode = shapeNode({
  type: 'hopfCirclesSDF', label: 'Hopf Circles SDF', fn: 'sdf4d_hopf',
  aliases: ['hopf fibration', 'hopf fibres', 'villarceau', 'linked circles', 'great circles'],
  description:
    'A few fibres of the Hopf fibration: great circles on a 3-sphere, any two of which link once. Each is a thin tube (exact distance: around a circle, the distance is √((ρ − R)² + perp²)). ' +
    'On its own in a slice they look like rings; through Stereographic 4D they become the famous bundle of linked circles filling space, nested around circles of latitude. ' +
    'Count is how many fibres in a ring; Latitude is where the ring sits on the base sphere (90 = equator); more Rings stack further ones.',
  params: {
    radius: { def: 1.0, label: 'Sphere radius', min: 0.1, max: 4, step: 0.01, hint: 'Radius of the 3-sphere (and of every circle on it).' },
    thickness: { def: 0.07, label: 'Thickness', min: 0.005, max: 1, step: 0.005, hint: 'Radius of the tube around each circle.' },
    count: { def: 8, label: 'Fibres per ring', min: 1, max: HOPF_MAX_COUNT, step: 1, hint: 'How many circles in each ring (whole numbers).' },
    latitude: { def: 90, label: 'Latitude (deg)', min: 1, max: 179, step: 0.5, hint: 'Where the ring sits on the base 2-sphere: 90 is the equator, near 0 and 180 are the poles. Fibres in a ring lie on one torus.' },
    spread: { def: 45, label: 'Ring spacing (deg)', min: 5, max: 90, step: 0.5, hint: 'How far apart further rings sit in latitude.' },
    rings: { def: 1, label: 'Rings', min: 1, max: HOPF_MAX_RINGS, step: 1, hint: 'How many rings of fibres (1 to 3), centred on Latitude.' },
    phase: { def: 0, label: 'Phase (deg)', min: -180, max: 180, step: 0.5, hint: 'Turns the fibres round their ring (the Hopf flow); animate it and the circles slide through each other.' },
  },
  glsl: `
float sdf4d_hopf(vec4 p, float R, float t, float cnt, float latDeg, float spreadDeg, float rings, float phaseDeg) {
    float best = 1000000.0;
    float pp = dot(p, p);
    for (int j = 0; j < ${HOPF_MAX_RINGS}; j++) {
        if (float(j) >= rings) break;
        float eta = (latDeg + (float(j) - 0.5 * (rings - 1.0)) * spreadDeg) * ${DEG};
        float ca = cos(eta * 0.5);
        float sa = sin(eta * 0.5);
        for (int i = 0; i < ${HOPF_MAX_COUNT}; i++) {
            if (float(i) >= cnt) break;
            float phi = 6.28318531 * (float(i) + 0.5 * float(j)) / max(cnt, 1.0) + phaseDeg * ${DEG};
            float cp = cos(phi);
            float sp = sin(phi);
            vec4 u = vec4(ca, 0.0, sa * cp, sa * sp);
            vec4 v = vec4(0.0, ca, -sa * sp, sa * cp);
            float a = dot(p, u);
            float b = dot(p, v);
            float rho = sqrt(a * a + b * b);
            float perp2 = max(pp - a * a - b * b, 0.0);
            best = min(best, sqrt((rho - R) * (rho - R) + perp2));
        }
    }
    return best - t;
}`,
  distHint: 'Exact signed distance to the tubes.',
});

/** Phase 3 nodes, for the registry. */
export const FOURD_P3_NODES: Record<string, NodeDefinition> = {
  wireframe4D: Wireframe4DNode, project4D: Project4DNode, stereo4D: Stereographic4DNode, stereoDist4D: StereoDistanceNode, hopfCirclesSDF: HopfCirclesSDFNode,
};
