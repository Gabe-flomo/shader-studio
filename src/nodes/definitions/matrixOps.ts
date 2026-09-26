import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

/**
 * Matrix operations and builders (docs/matrices.md).
 *
 * The basic matrix nodes (Matrix Const, Construct, Inspect, Mat × Vec,
 * Rotation Matrix) live in matrix.ts. These add what makes matrices worth
 * having: combining them (A × B), undoing them (inverse), measuring them
 * (determinant), blending them, building the common 2D ones (scale, shear,
 * stretch along an angle), projective maps (Mat3 × Point, Corner Pin) and a
 * colour matrix.
 *
 * GLSL is column-major: mat2(a, b, c, d) has columns (a, b) and (c, d), and
 * A × B applies B first, then A.
 */

/** mat2 inverse that never divides by zero (a flattened matrix stays finite). */
export const GLSL_MAT2_INV = `mat2 m2Inv(mat2 m) {
    float d = m[0][0] * m[1][1] - m[1][0] * m[0][1];
    d = abs(d) < 1e-6 ? (d < 0.0 ? -1e-6 : 1e-6) : d;
    return mat2(m[1][1], -m[0][1], -m[1][0], m[0][0]) / d;
}`;

const MAT2_ID = 'mat2(1.0)';
const MAT3_ID = 'mat3(1.0)';

// ─── Multiply ───────────────────────────────────────────────────────────────

const mulNode = (n: 2 | 3): NodeDefinition => ({
  type: `mat${n}Mul`,
  label: `Mat${n} × Mat${n}`,
  category: 'Matrix',
  aliases: ['matrix multiply', 'compose matrix', 'combine matrix'],
  description: `Combine two mat${n}s into one. A × B does B first, then A: Rotation × Stretch stretches, then turns the result. Build a transform once and apply it with Mat${n} × Vec${n}; multiply a matrix by itself for twice the effect.`,
  inputs: {
    a: { type: `mat${n}`, label: 'A', hint: 'Applied second.' },
    b: { type: `mat${n}`, label: 'B', hint: 'Applied first.' },
  },
  outputs: { mat: { type: `mat${n}`, label: 'A × B' } },
  generateGLSL: (node: GraphNode, inputVars) => ({
    code: `    mat${n} ${node.id}_mat = ${inputVars.a || (n === 2 ? MAT2_ID : MAT3_ID)} * ${inputVars.b || (n === 2 ? MAT2_ID : MAT3_ID)};\n`,
    outputVars: { mat: `${node.id}_mat` },
  }),
});
export const Mat2MulNode = mulNode(2);
export const Mat3MulNode = mulNode(3);

// ─── Inverse / transpose / determinant ──────────────────────────────────────

export const Mat2InverseNode: NodeDefinition = {
  type: 'mat2Inverse',
  label: 'Mat2 Inverse',
  category: 'Matrix',
  aliases: ['invert matrix', 'determinant', 'transpose', 'undo matrix'],
  description: 'The matrix that undoes this one, its transpose, and its determinant. To draw a shape transformed by M, move the space by M’s inverse: that is why a shape rotated by +30° needs the UV turned by −30°. The determinant is how much M scales area (negative when it mirrors).',
  inputs: { mat: { type: 'mat2', label: 'Mat2' } },
  outputs: {
    inverse:     { type: 'mat2',  label: 'Inverse', hint: 'M⁻¹: M × M⁻¹ is the identity. Safe on a flattened matrix (it gets very large instead of breaking).' },
    transpose:   { type: 'mat2',  label: 'Transpose', hint: 'Rows and columns swapped. For a pure rotation this is also its inverse.' },
    determinant: { type: 'float', label: 'Determinant', hint: 'Area scale: 1 keeps area, 2 doubles it, 0 flattens to a line, negative mirrors. √|det| is the average length scale, handy for keeping outlines even after a stretch.' },
  },
  glslFunction: GLSL_MAT2_INV,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const m = inputVars.mat || MAT2_ID;
    return {
      code: [
        `    mat2  ${id}_m   = ${m};\n`,
        `    mat2  ${id}_inv = m2Inv(${id}_m);\n`,
        `    mat2  ${id}_tr  = transpose(${id}_m);\n`,
        `    float ${id}_det = determinant(${id}_m);\n`,
      ].join(''),
      outputVars: { inverse: `${id}_inv`, transpose: `${id}_tr`, determinant: `${id}_det` },
    };
  },
};

export const Mat3InverseNode: NodeDefinition = {
  type: 'mat3Inverse',
  label: 'Mat3 Inverse',
  category: 'Matrix',
  aliases: ['invert matrix', 'determinant', 'transpose', 'undo matrix'],
  description: 'The matrix that undoes this one, its transpose, and its determinant. Invert a Corner Pin matrix to map the other way, or a colour matrix to undo a grade.',
  inputs: { mat: { type: 'mat3', label: 'Mat3' } },
  outputs: {
    inverse:     { type: 'mat3',  label: 'Inverse', hint: 'M⁻¹. A flattened matrix (determinant 0) has none; the result is then not meaningful.' },
    transpose:   { type: 'mat3',  label: 'Transpose' },
    determinant: { type: 'float', label: 'Determinant', hint: 'Volume scale (area scale for a 2D projective matrix at the origin).' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const m = inputVars.mat || MAT3_ID;
    return {
      code: [
        `    mat3  ${id}_m   = ${m};\n`,
        `    float ${id}_det = determinant(${id}_m);\n`,
        `    mat3  ${id}_inv = abs(${id}_det) > 1e-8 ? inverse(${id}_m) : mat3(1.0);\n`,
        `    mat3  ${id}_tr  = transpose(${id}_m);\n`,
      ].join(''),
      outputVars: { inverse: `${id}_inv`, transpose: `${id}_tr`, determinant: `${id}_det` },
    };
  },
};

// ─── Mix ────────────────────────────────────────────────────────────────────

const mixNode = (n: 2 | 3): NodeDefinition => ({
  type: `mat${n}Mix`,
  label: `Mat${n} Mix`,
  category: 'Matrix',
  aliases: ['blend matrix', 'lerp matrix', 'interpolate matrix'],
  description: `Blend two mat${n}s entry by entry: A at 0, B at 1. Good for easing between two looks (a colour grade, a shear). Blending two rotations passes through a shrunken matrix halfway: interpolate the angle instead when you want a clean turn.`,
  inputs: {
    a: { type: `mat${n}`, label: 'A' },
    b: { type: `mat${n}`, label: 'B' },
    t: { type: 'float', label: 'Blend' },
  },
  outputs: { mat: { type: `mat${n}`, label: 'Matrix' } },
  defaultParams: { t: 0.5 },
  paramDefs: { t: { label: 'Blend', type: 'float', min: 0, max: 1, step: 0.01, hint: '0 = A, 1 = B.' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const I = n === 2 ? MAT2_ID : MAT3_ID;
    const t = inputVars.t ?? p(node.params.t, 0.5);
    return {
      code: `    mat${n} ${id}_mat = ${inputVars.a || I} * (1.0 - ${t}) + ${inputVars.b || I} * ${t};\n`,
      outputVars: { mat: `${id}_mat` },
    };
  },
});
export const Mat2MixNode = mixNode(2);
export const Mat3MixNode = mixNode(3);

// ─── 2D builders ────────────────────────────────────────────────────────────

export const ScaleMatrixNode: NodeDefinition = {
  type: 'scaleMatrix',
  label: 'Scale Matrix',
  category: 'Matrix',
  description: 'A mat2 that scales X and Y separately. Applied to a UV it zooms the space; applied as Grid Pattern’s Basis it sets the cell width and height.',
  inputs: {
    x: { type: 'float', label: 'X' },
    y: { type: 'float', label: 'Y' },
  },
  outputs: { mat: { type: 'mat2', label: 'Mat2' } },
  defaultParams: { x: 1.0, y: 1.0 },
  paramDefs: {
    x: { label: 'X', type: 'float', min: -3, max: 3, step: 0.01, hint: 'Negative mirrors.' },
    y: { label: 'Y', type: 'float', min: -3, max: 3, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => ({
    code: `    mat2 ${node.id}_mat = mat2(${inputVars.x ?? p(node.params.x, 1)}, 0.0, 0.0, ${inputVars.y ?? p(node.params.y, 1)});\n`,
    outputVars: { mat: `${node.id}_mat` },
  }),
};

export const ShearMatrixNode: NodeDefinition = {
  type: 'shearMatrix',
  label: 'Shear Matrix',
  category: 'Matrix',
  aliases: ['skew matrix'],
  description: 'A mat2 that slants space: X shifts by X × y, Y shifts by Y × x. A square becomes a parallelogram; a square grid becomes a diamond or brick-like one.',
  inputs: {
    x: { type: 'float', label: 'X (by y)' },
    y: { type: 'float', label: 'Y (by x)' },
  },
  outputs: { mat: { type: 'mat2', label: 'Mat2' } },
  defaultParams: { x: 0.5, y: 0.0 },
  paramDefs: {
    x: { label: 'X (by y)', type: 'float', min: -2, max: 2, step: 0.01, hint: 'How far X slides per unit of Y.' },
    y: { label: 'Y (by x)', type: 'float', min: -2, max: 2, step: 0.01, hint: 'How far Y slides per unit of X.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => ({
    // Columns: where x̂ goes (1, y) and where ŷ goes (x, 1).
    code: `    mat2 ${node.id}_mat = mat2(1.0, ${inputVars.y ?? p(node.params.y, 0)}, ${inputVars.x ?? p(node.params.x, 0.5)}, 1.0);\n`,
    outputVars: { mat: `${node.id}_mat` },
  }),
};

export const StretchMatrixNode: NodeDefinition = {
  type: 'stretchMatrix',
  label: 'Stretch Matrix',
  category: 'Matrix',
  aliases: ['squash and stretch', 'anisotropic scale', 'directional scale'],
  description: 'A mat2 that stretches space along any direction: turn the direction onto X, scale X, turn back. With Keep Area on, the other direction squashes by the same factor (squash and stretch).',
  inputs: {
    angle:  { type: 'float', label: 'Angle', hint: 'The stretch direction in radians (0 = along X).' },
    amount: { type: 'float', label: 'Amount', hint: '1 = unchanged, 2 = twice as long along the direction, 0.5 = half.' },
  },
  outputs: { mat: { type: 'mat2', label: 'Mat2' } },
  defaultParams: { angle: 0.785, amount: 1.6, keepArea: true },
  paramDefs: {
    angle:    { label: 'Angle', type: 'float', min: -3.1416, max: 3.1416, step: 0.01 },
    amount:   { label: 'Amount', type: 'float', min: 0.05, max: 4, step: 0.01 },
    keepArea: { label: 'Keep area', type: 'bool', hint: 'Squash the other direction by 1 / Amount, so the area stays the same.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const a = inputVars.angle ?? p(node.params.angle, 0.785);
    const k = inputVars.amount ?? p(node.params.amount, 1.6);
    const other = node.params.keepArea === false ? '1.0' : `1.0 / max(${k}, 1e-3)`;
    return {
      code: [
        `    float ${id}_c = cos(${a}), ${id}_s = sin(${a});\n`,
        `    mat2  ${id}_r = mat2(${id}_c, ${id}_s, -${id}_s, ${id}_c);\n`,
        `    mat2  ${id}_mat = ${id}_r * mat2(${k}, 0.0, 0.0, ${other}) * transpose(${id}_r);\n`,
      ].join(''),
      outputVars: { mat: `${id}_mat` },
    };
  },
};

// ─── Projective ─────────────────────────────────────────────────────────────

export const Mat3MulPointNode: NodeDefinition = {
  type: 'mat3MulPoint',
  label: 'Mat3 × Point',
  category: 'Matrix',
  aliases: ['homogeneous', 'projective transform', 'homography'],
  description: 'Apply a 3×3 matrix to a 2D point the projective way: (x, y, 1) → M × (x, y, 1) → divide by the third component. Translation lives in the third column; a non-zero bottom row adds perspective. Use with Corner Pin’s matrix or a Matrix Const.',
  inputs: {
    mat:   { type: 'mat3', label: 'Mat3' },
    point: { type: 'vec2', label: 'Point' },
  },
  outputs: {
    point: { type: 'vec2', label: 'Point' },
    w:     { type: 'float', label: 'W', hint: 'The divisor. Below 0 the point is behind the projection (usually drawn as empty).' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    return {
      code: [
        `    vec3  ${id}_h = ${inputVars.mat || MAT3_ID} * vec3(${inputVars.point || 'g_uv'}, 1.0);\n`,
        `    float ${id}_w = ${id}_h.z;\n`,
        `    vec2  ${id}_p = ${id}_h.xy / (abs(${id}_w) > 1e-6 ? ${id}_w : 1e-6);\n`,
      ].join(''),
      outputVars: { point: `${id}_p`, w: `${id}_w` },
    };
  },
};

/** Heckbert's square → quad homography: (0,0)→p0, (1,0)→p1, (1,1)→p2, (0,1)→p3. */
export const GLSL_SQUARE_TO_QUAD = `mat3 squareToQuad(vec2 p0, vec2 p1, vec2 p2, vec2 p3) {
    vec2 d1 = p1 - p2, d2 = p3 - p2, d3 = p0 - p1 + p2 - p3;
    float den = d1.x * d2.y - d2.x * d1.y;
    den = abs(den) < 1e-6 ? 1e-6 : den;
    float g = (d3.x * d2.y - d2.x * d3.y) / den;
    float h = (d1.x * d3.y - d3.x * d1.y) / den;
    return mat3(p1.x - p0.x + g * p1.x, p1.y - p0.y + g * p1.y, g,
                p3.x - p0.x + h * p3.x, p3.y - p0.y + h * p3.y, h,
                p0.x, p0.y, 1.0);
}`;

export const CornerPinNode: NodeDefinition = {
  type: 'cornerPin',
  label: 'Corner Pin',
  category: '2D Space',
  subcategory: 'Map',
  aliases: ['quad warp', 'perspective warp', 'homography', 'four corner'],
  description: 'Pin a picture to any four corners, in true perspective. Outputs the UV inside the quad (0…1 across it, or −1…1 Centred for shapes and SDFs), a mask for the inside, and the 3×3 matrix that maps the square onto the quad. Anything drawn with the output UV looks printed on a tilted card.',
  inputs: {
    uv: { type: 'vec2', label: 'UV' },
    c0: { type: 'vec2', label: 'Bottom Left',  axisParams: ['x0', 'y0'] },
    c1: { type: 'vec2', label: 'Bottom Right', axisParams: ['x1', 'y1'] },
    c2: { type: 'vec2', label: 'Top Right',    axisParams: ['x2', 'y2'] },
    c3: { type: 'vec2', label: 'Top Left',     axisParams: ['x3', 'y3'] },
  },
  outputs: {
    uv:       { type: 'vec2',  label: 'Quad UV', hint: '0…1 across the quad (bottom left to top right). Feed a texture, Grid Pattern or anything that wants 0…1.' },
    centered: { type: 'vec2',  label: 'Centred', hint: '−1…1 across the quad, so shapes drawn for the canvas fit it.' },
    mask:     { type: 'float', label: 'Inside', hint: '1 inside the quad, 0 outside.' },
    edge:     { type: 'float', label: 'Edge', hint: 'A distance to the quad’s border in quad units: negative inside, 0 on the edge. Feed Mask, SDF Fill or SDF Glow for a soft or outlined card.' },
    matrix:   { type: 'mat3',  label: 'Matrix', hint: 'Maps the unit square onto the quad (use Mat3 × Point). Its inverse maps the quad back to the square.' },
  },
  defaultParams: { x0: -0.9, y0: -0.6, x1: 0.8, y1: -0.8, x2: 0.55, y2: 0.7, x3: -0.6, y3: 0.55 },
  paramDefs: {
    x0: { label: 'Bottom Left X',  type: 'float', min: -2, max: 2, step: 0.01 },
    y0: { label: 'Bottom Left Y',  type: 'float', min: -2, max: 2, step: 0.01 },
    x1: { label: 'Bottom Right X', type: 'float', min: -2, max: 2, step: 0.01 },
    y1: { label: 'Bottom Right Y', type: 'float', min: -2, max: 2, step: 0.01 },
    x2: { label: 'Top Right X',    type: 'float', min: -2, max: 2, step: 0.01 },
    y2: { label: 'Top Right Y',    type: 'float', min: -2, max: 2, step: 0.01 },
    x3: { label: 'Top Left X',     type: 'float', min: -2, max: 2, step: 0.01 },
    y3: { label: 'Top Left Y',     type: 'float', min: -2, max: 2, step: 0.01 },
  },
  glslFunction: GLSL_SQUARE_TO_QUAD,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const c = (k: string, x: string, y: string, fx: number, fy: number) =>
      inputVars[k] ?? `vec2(${p(node.params[x], fx)}, ${p(node.params[y], fy)})`;
    return {
      code: [
        `    mat3  ${id}_H   = squareToQuad(${c('c0', 'x0', 'y0', -0.9, -0.6)}, ${c('c1', 'x1', 'y1', 0.8, -0.8)}, ${c('c2', 'x2', 'y2', 0.55, 0.7)}, ${c('c3', 'x3', 'y3', -0.6, 0.55)});\n`,
        `    vec3  ${id}_h   = inverse(${id}_H) * vec3(${inputVars.uv || 'g_uv'}, 1.0);\n`,
        `    vec2  ${id}_uv  = ${id}_h.xy / (abs(${id}_h.z) > 1e-6 ? ${id}_h.z : 1e-6);\n`,
        `    vec2  ${id}_ctr = ${id}_uv * 2.0 - 1.0;\n`,
        `    vec2  ${id}_e   = abs(${id}_uv - 0.5) - 0.5;\n`,
        `    float ${id}_sd  = ${id}_h.z > 0.0 ? max(${id}_e.x, ${id}_e.y) : 1.0;\n`,
        `    float ${id}_in  = step(${id}_sd, 0.0);\n`,
      ].join(''),
      outputVars: { uv: `${id}_uv`, centered: `${id}_ctr`, mask: `${id}_in`, edge: `${id}_sd`, matrix: `${id}_H` },
    };
  },
};

// ─── Colour ─────────────────────────────────────────────────────────────────

/** Hue rotation (about the grey axis), saturation (around Rec. 709 luma) and gain as one mat3. */
export const GLSL_COLOR_MATRIX = `mat3 colorMatrix(float hue, float sat, float gain) {
    float c = cos(hue), s = sin(hue), k = 0.57735027;
    float t = (1.0 - c) / 3.0;
    mat3 R = mat3(c + t, t + s * k, t - s * k,
                  t - s * k, c + t, t + s * k,
                  t + s * k, t - s * k, c + t);
    vec3 w = vec3(0.2126, 0.7152, 0.0722) * (1.0 - sat);
    mat3 S = mat3(w.x + sat, w.x, w.x,
                  w.y, w.y + sat, w.y,
                  w.z, w.z, w.z + sat);
    return gain * S * R;
}`;

export const ColorMatrixNode: NodeDefinition = {
  type: 'colorMatrix',
  label: 'Colour Matrix',
  category: 'Color',
  aliases: ['color matrix', 'hue rotate matrix', 'grade matrix', 'channel mixer'],
  description: 'A colour grade as a 3×3 matrix: hue rotation (turning colours around the grey axis), saturation and gain. Apply it with Mat3 × Vec3 on a colour; multiply it with other colour matrices (Mat3 × Mat3) or blend two grades (Mat3 Mix). A Matrix Const makes any channel mix (sepia, swap red and blue…).',
  inputs: {
    hue:        { type: 'float', label: 'Hue', hint: 'Radians around the colour wheel: 2.09 turns red to green.' },
    saturation: { type: 'float', label: 'Saturation', hint: '0 = grey, 1 = unchanged, 2 = twice as vivid. Negative inverts the colours around grey.' },
    gain:       { type: 'float', label: 'Gain', hint: 'Multiplies everything: brightness.' },
  },
  outputs: { mat: { type: 'mat3', label: 'Mat3' } },
  defaultParams: { hue: 0.0, saturation: 1.0, gain: 1.0 },
  paramDefs: {
    hue:        { label: 'Hue', type: 'float', min: -3.1416, max: 3.1416, step: 0.01 },
    saturation: { label: 'Saturation', type: 'float', min: -1, max: 3, step: 0.01 },
    gain:       { label: 'Gain', type: 'float', min: 0, max: 3, step: 0.01 },
  },
  glslFunction: GLSL_COLOR_MATRIX,
  generateGLSL: (node: GraphNode, inputVars) => ({
    code: `    mat3 ${node.id}_mat = colorMatrix(${inputVars.hue ?? p(node.params.hue, 0)}, ${inputVars.saturation ?? p(node.params.saturation, 1)}, ${inputVars.gain ?? p(node.params.gain, 1)});\n`,
    outputVars: { mat: `${node.id}_mat` },
  }),
};
