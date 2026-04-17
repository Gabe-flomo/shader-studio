/**
 * Spaces — UV space transformation nodes
 *
 * These nodes warp the coordinate space itself. Feed a UV in, get a warped UV
 * out, then pass that into any SDF, noise, or pattern node. Anything downstream
 * automatically lives in the new geometry.
 */
import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────

export const PolarSpaceNode: NodeDefinition = {
  type: 'polarSpace',
  label: 'Polar Space',
  category: 'Spaces',
  description: 'Convert UV to polar coordinates (angle, radius). Straight lines become spirals, circles become horizontal stripes. Twist adds a spin that increases with radius. Use the "seamless" vec2 output (cos/sin encoded) for noise inputs — it has zero seam artifacts.',
  inputs: {
    input:       { type: 'vec2',  label: 'UV' },
    twist:       { type: 'float', label: 'Twist' },
    radialScale: { type: 'float', label: 'Radial Scale' },
  },
  outputs: {
    output:   { type: 'vec2',  label: 'Polar UV' },
    seamless: { type: 'vec2',  label: 'Seamless' },
    angle:    { type: 'float', label: 'Angle' },
    radius:   { type: 'float', label: 'Radius' },
  },
  defaultParams: { twist: 0.0, radialScale: 1.0 },
  paramDefs: {
    twist:       { label: 'Twist',        type: 'float', min: -5.0, max: 5.0, step: 0.01 },
    radialScale: { label: 'Radial Scale', type: 'float', min: 0.1,  max: 5.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id     = node.id;
    const inVar  = inputVars.input       || 'vec2(0.0)';
    const twist  = inputVars.twist       || p(node.params.twist, 0.0);
    const rscale = inputVars.radialScale || p(node.params.radialScale, 1.0);
    return {
      code: [
        `    float ${id}_r = length(${inVar}) * ${rscale};\n`,
        // Raw angle [0,1)
        `    float ${id}_a = fract(atan(${inVar}.y, ${inVar}.x) / 6.28318 + 0.5);\n`,
        // Seamless angle: encode as (cos, sin) on unit circle — zero wrap discontinuity
        `    vec2  ${id}_seamless = vec2(cos(${id}_a * 6.28318), sin(${id}_a * 6.28318)) * 0.5 + 0.5;\n`,
        `    vec2  ${id}_output   = vec2(${id}_a + ${id}_r * ${twist}, ${id}_r);\n`,
      ].join(''),
      outputVars: {
        output:   `${id}_output`,
        seamless: `${id}_seamless`,
        angle:    `${id}_a`,
        radius:   `${id}_r`,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const LogPolarSpaceNode: NodeDefinition = {
  type: 'logPolarSpace',
  label: 'Log-Polar Space',
  category: 'Spaces',
  description: 'Logarithmic polar coordinates — spirals become straight lines, concentric circles become uniform stripes. Creates Escher-like infinite spiral tiling.',
  inputs: {
    input: { type: 'vec2',  label: 'UV' },
    scale: { type: 'float', label: 'Scale' },
  },
  outputs: {
    output:   { type: 'vec2',  label: 'Log-Polar UV' },
    seamless: { type: 'vec2',  label: 'Seamless' },
    angle:    { type: 'float', label: 'Angle' },
  },
  defaultParams: { scale: 1.0 },
  paramDefs: {
    scale: { label: 'Scale', type: 'float', min: 0.1, max: 5.0, step: 0.05 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const inVar = inputVars.input || 'vec2(0.0)';
    const scale = inputVars.scale || p(node.params.scale, 1.0);
    return {
      code: [
        `    float ${id}_r = length(${inVar});\n`,
        `    float ${id}_a = fract(atan(${inVar}.y, ${inVar}.x) / 6.28318 + 0.5);\n`,
        `    vec2  ${id}_seamless = vec2(cos(${id}_a * 6.28318), sin(${id}_a * 6.28318)) * 0.5 + 0.5;\n`,
        `    vec2  ${id}_output   = vec2(${id}_a, log(max(${id}_r, 0.00001)) * ${scale});\n`,
      ].join(''),
      outputVars: {
        output:   `${id}_output`,
        seamless: `${id}_seamless`,
        angle:    `${id}_a`,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const HyperbolicSpaceNode: NodeDefinition = {
  type: 'hyperbolicSpace',
  label: 'Hyperbolic Space',
  category: 'Spaces',
  description: "Poincaré disk model of hyperbolic geometry. Space curves away from the center — parallel lines diverge, everything compresses toward the boundary at infinity. Curvature controls how bent the space is.",
  inputs: {
    input:     { type: 'vec2',  label: 'UV' },
    curvature: { type: 'float', label: 'Curvature' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Hyperbolic UV' },
  },
  defaultParams: { curvature: 0.7 },
  paramDefs: {
    curvature: { label: 'Curvature', type: 'float', min: -2.0, max: 2.0, step: 0.01 },
  },
  glslFunction: `
vec2 hyperbolicSpace(vec2 p, float k) {
    float r2 = dot(p, p);
    return p * (2.0 / max(1.0 + k * r2, 0.001));
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id        = node.id;
    const inVar     = inputVars.input     || 'vec2(0.0)';
    const curvature = inputVars.curvature || p(node.params.curvature, 0.7);
    return {
      code: `    vec2 ${id}_output = hyperbolicSpace(${inVar}, ${curvature});\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const InversionSpaceNode: NodeDefinition = {
  type: 'inversionSpace',
  label: 'Circle Inversion',
  category: 'Spaces',
  description: 'Inverts space through a circle of given radius: near→far, far→near. Objects outside the circle map inside and vice versa. Creates Apollonian gasket-like patterns when tiled.',
  inputs: {
    input:  { type: 'vec2',  label: 'UV' },
    radius: { type: 'float', label: 'Radius' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Inverted UV' },
  },
  defaultParams: { radius: 1.0 },
  paramDefs: {
    radius: { label: 'Radius', type: 'float', min: 0.1, max: 3.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id     = node.id;
    const inVar  = inputVars.input  || 'vec2(0.0)';
    const radius = inputVars.radius || p(node.params.radius, 1.0);
    return {
      code: [
        `    float ${id}_d2 = dot(${inVar}, ${inVar});\n`,
        `    vec2 ${id}_output = ${id}_d2 > 0.00001 ? ${inVar} * (${radius} * ${radius} / ${id}_d2) : ${inVar};\n`,
      ].join(''),
      outputVars: { output: `${id}_output` },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const MobiusSpaceNode: NodeDefinition = {
  type: 'mobiusSpace',
  label: 'Möbius Transform',
  category: 'Spaces',
  description: 'Möbius transformation on the complex plane — the only maps that send circles to circles. Conformal (angle-preserving). Shift the pole to move where the warp concentrates; Angle rotates in complex space.',
  inputs: {
    input: { type: 'vec2',  label: 'UV' },
    poleX: { type: 'float', label: 'Pole X' },
    poleY: { type: 'float', label: 'Pole Y' },
    angle: { type: 'float', label: 'Angle' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Möbius UV' },
  },
  defaultParams: { poleX: 0.5, poleY: 0.0, angle: 0.0 },
  paramDefs: {
    poleX: { label: 'Pole X', type: 'float', min: -1.5, max: 1.5,  step: 0.01 },
    poleY: { label: 'Pole Y', type: 'float', min: -1.5, max: 1.5,  step: 0.01 },
    angle: { label: 'Angle',  type: 'float', min: -3.14, max: 3.14, step: 0.01 },
  },
  glslFunction: `
vec2 cMul(vec2 a, vec2 b) { return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 cDiv(vec2 a, vec2 b) {
    float d = dot(b,b);
    return d > 0.00001 ? vec2(dot(a,b), a.y*b.x - a.x*b.y) / d : vec2(0.0);
}
vec2 mobiusSpace(vec2 z, vec2 pole, float ang) {
    vec2 rot = vec2(cos(ang), sin(ang));
    vec2 num = cMul(rot, z - pole);
    vec2 den = vec2(1.0, 0.0) - cMul(vec2(pole.x, -pole.y), z);
    return cDiv(num, den);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const inVar = inputVars.input || 'vec2(0.0)';
    const px    = inputVars.poleX || p(node.params.poleX, 0.5);
    const py    = inputVars.poleY || p(node.params.poleY, 0.0);
    const ang   = inputVars.angle || p(node.params.angle, 0.0);
    return {
      code: `    vec2 ${id}_output = mobiusSpace(${inVar}, vec2(${px}, ${py}), ${ang});\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const SwirlSpaceNode: NodeDefinition = {
  type: 'swirlSpace',
  label: 'Swirl / Vortex',
  category: 'Spaces',
  description: 'Rotates space by an amount that grows with distance from center, forming a vortex. Animate Strength with Time for a spinning galaxy effect.',
  inputs: {
    input:    { type: 'vec2',  label: 'UV' },
    strength: { type: 'float', label: 'Strength' },
    falloff:  { type: 'float', label: 'Falloff' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Swirled UV' },
  },
  defaultParams: { strength: 2.0, falloff: 1.0 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: -10.0, max: 10.0, step: 0.1 },
    falloff:  { label: 'Falloff',  type: 'float', min: 0.1,   max: 5.0,  step: 0.1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const inVar    = inputVars.input    || 'vec2(0.0)';
    const strength = inputVars.strength || p(node.params.strength, 2.0);
    const falloff  = inputVars.falloff  || p(node.params.falloff, 1.0);
    return {
      code: [
        `    float ${id}_r  = length(${inVar});\n`,
        `    float ${id}_sa = ${strength} * exp(-${id}_r * ${falloff});\n`,
        `    float ${id}_sc = cos(${id}_sa), ${id}_ss = sin(${id}_sa);\n`,
        `    vec2 ${id}_output = vec2(${inVar}.x * ${id}_sc - ${inVar}.y * ${id}_ss,\n`,
        `                            ${inVar}.x * ${id}_ss + ${inVar}.y * ${id}_sc);\n`,
      ].join(''),
      outputVars: { output: `${id}_output` },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const KaleidoSpaceNode: NodeDefinition = {
  type: 'kaleidoSpace',
  label: 'Kaleidoscope',
  category: 'Spaces',
  description: 'Folds space into N mirror-symmetric wedge sectors, creating mandala/kaleidoscope symmetry. Any pattern placed downstream gets infinitely reflected.',
  inputs: {
    input:    { type: 'vec2',  label: 'UV' },
    segments: { type: 'float', label: 'Segments' },
    rotate:   { type: 'float', label: 'Rotate' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Folded UV' },
  },
  defaultParams: { segments: 6.0, rotate: 0.0 },
  paramDefs: {
    segments: { label: 'Segments', type: 'float', min: 1.0, max: 24.0, step: 1.0 },
    rotate:   { label: 'Rotate',   type: 'float', min: -3.14, max: 3.14, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const inVar  = inputVars.input    || 'vec2(0.0)';
    const segs   = inputVars.segments || p(node.params.segments, 6.0);
    const rot    = inputVars.rotate   || p(node.params.rotate, 0.0);
    return {
      code: [
        `    float ${id}_a  = atan(${inVar}.y, ${inVar}.x) + ${rot};\n`,
        `    float ${id}_s  = 6.28318 / ${segs};\n`,
        `    ${id}_a = mod(${id}_a, ${id}_s);\n`,
        `    if (${id}_a > ${id}_s * 0.5) ${id}_a = ${id}_s - ${id}_a;\n`,
        `    vec2 ${id}_output = vec2(cos(${id}_a), sin(${id}_a)) * length(${inVar});\n`,
      ].join(''),
      outputVars: { output: `${id}_output` },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const SphericalSpaceNode: NodeDefinition = {
  type: 'sphericalSpace',
  label: 'Spherical / Fisheye',
  category: 'Spaces',
  description: 'Projects UV through a virtual sphere. Positive strength = fisheye barrel distortion (wide-angle). Negative strength = pincushion (telephoto). At ±1 approaches stereographic projection.',
  inputs: {
    input:    { type: 'vec2',  label: 'UV' },
    strength: { type: 'float', label: 'Strength' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Projected UV' },
  },
  defaultParams: { strength: 0.5 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: -1.0, max: 1.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const inVar    = inputVars.input    || 'vec2(0.0)';
    const strength = inputVars.strength || p(node.params.strength, 0.5);
    return {
      code: [
        `    float ${id}_r = length(${inVar});\n`,
        `    float ${id}_k = ${strength};\n`,
        `    float ${id}_f = ${id}_r > 0.0001 && abs(${id}_k) > 0.0001\n`,
        `        ? atan(${id}_r * ${id}_k * 1.5708) / (${id}_r * ${id}_k * 1.5708)\n`,
        `        : 1.0;\n`,
        `    vec2 ${id}_output = ${inVar} * ${id}_f;\n`,
      ].join(''),
      outputVars: { output: `${id}_output` },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const RippleSpaceNode: NodeDefinition = {
  type: 'rippleSpace',
  label: 'Ripple / Wave',
  category: 'Spaces',
  description: 'Displaces UV with sine waves — creates water ripples, heat haze, flag waves. Wire Time to animate continuously.',
  inputs: {
    input: { type: 'vec2',  label: 'UV' },
    freqX: { type: 'float', label: 'Freq X' },
    freqY: { type: 'float', label: 'Freq Y' },
    ampX:  { type: 'float', label: 'Amp X' },
    ampY:  { type: 'float', label: 'Amp Y' },
    time:  { type: 'float', label: 'Time' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Rippled UV' },
  },
  defaultParams: { freqX: 5.0, freqY: 5.0, ampX: 0.1, ampY: 0.1 },
  paramDefs: {
    freqX: { label: 'Freq X', type: 'float', min: 0.0, max: 20.0, step: 0.1 },
    freqY: { label: 'Freq Y', type: 'float', min: 0.0, max: 20.0, step: 0.1 },
    ampX:  { label: 'Amp X',  type: 'float', min: 0.0, max: 1.0,  step: 0.01 },
    ampY:  { label: 'Amp Y',  type: 'float', min: 0.0, max: 1.0,  step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const inVar = inputVars.input || 'vec2(0.0)';
    const fX    = inputVars.freqX || p(node.params.freqX, 5.0);
    const fY    = inputVars.freqY || p(node.params.freqY, 5.0);
    const aX    = inputVars.ampX  || p(node.params.ampX, 0.1);
    const aY    = inputVars.ampY  || p(node.params.ampY, 0.1);
    const t     = inputVars.time  || '0.0';
    return {
      code: [
        `    vec2 ${id}_output = ${inVar} + vec2(\n`,
        `        sin(${inVar}.y * ${fY} + ${t}) * ${aX},\n`,
        `        sin(${inVar}.x * ${fX} + ${t}) * ${aY});\n`,
      ].join(''),
      outputVars: { output: `${id}_output` },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const InfiniteRepeatSpaceNode: NodeDefinition = {
  type: 'infiniteRepeatSpace',
  label: 'Infinite Repeat',
  category: 'Spaces',
  description: 'Tiles space infinitely using modulo, keeping the origin at the center of each cell. Perfect for SDF repetition. Also outputs the integer Cell ID for per-cell variation.',
  inputs: {
    input: { type: 'vec2',  label: 'UV' },
    cellX: { type: 'float', label: 'Cell W' },
    cellY: { type: 'float', label: 'Cell H' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Cell UV' },
    cellID: { type: 'vec2', label: 'Cell ID' },
  },
  defaultParams: { cellX: 1.0, cellY: 1.0 },
  paramDefs: {
    cellX: { label: 'Cell W', type: 'float', min: 0.1, max: 10.0, step: 0.05 },
    cellY: { label: 'Cell H', type: 'float', min: 0.1, max: 10.0, step: 0.05 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const inVar = inputVars.input || 'vec2(0.0)';
    const cX    = inputVars.cellX || p(node.params.cellX, 1.0);
    const cY    = inputVars.cellY || p(node.params.cellY, 1.0);
    const cell  = `vec2(${cX}, ${cY})`;
    return {
      code: [
        `    vec2 ${id}_cellID = floor(${inVar} / ${cell});\n`,
        `    vec2 ${id}_output = mod(${inVar}, ${cell}) - ${cell} * 0.5;\n`,
      ].join(''),
      outputVars: { output: `${id}_output`, cellID: `${id}_cellID` },
    };
  },
};

// ─── New Space Nodes (V2) ──────────────────────────────────────────────────────

// WaveTexture — procedural bands/rings/directional waves
export const WaveTextureNode: NodeDefinition = {
  type: 'waveTexture', label: 'Wave Texture', category: 'Spaces',
  description: 'Procedural wave pattern: bands, rings, or directional waves.',
  inputs: {
    uv:    { type: 'vec2',  label: 'UV' },
    scale: { type: 'float', label: 'Scale' },
    speed: { type: 'float', label: 'Speed' },
    time:  { type: 'float', label: 'Time' },
  },
  outputs: { value: { type: 'float', label: 'Value' } },
  defaultParams: { mode: 'bands', scale: 5.0, speed: 1.0, distortion: 0.0 },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'bands',    label: 'Bands' },
      { value: 'rings',    label: 'Rings' },
      { value: 'x',       label: 'X Axis' },
      { value: 'y',       label: 'Y Axis' },
      { value: 'diagonal',label: 'Diagonal' },
    ]},
    scale:      { label: 'Scale',      type: 'float', min: 0.1, max: 20.0, step: 0.1 },
    speed:      { label: 'Speed',      type: 'float', min: -5.0, max: 5.0, step: 0.1 },
    distortion: { label: 'Distortion', type: 'float', min: 0.0, max: 5.0, step: 0.05 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const uv   = inputVars.uv    || 'vec2(0.0)';
    const sc   = inputVars.scale || p(node.params.scale,      5.0);
    const sp   = inputVars.speed || p(node.params.speed,      1.0);
    const t    = inputVars.time  || '0.0';
    const dist = p(node.params.distortion, 0.0);
    const mode = String(node.params.mode || 'bands');
    const modeExprs: Record<string, string> = {
      bands:    `(${id}_p.x + ${id}_p.y) * ${sc}`,
      rings:    `length(${id}_p) * ${sc}`,
      x:        `${id}_p.x * ${sc}`,
      y:        `${id}_p.y * ${sc}`,
      diagonal: `(${id}_p.x + ${id}_p.y) * ${sc} * 0.7071`,
    };
    const waveExpr = modeExprs[mode] || modeExprs['bands'];
    return {
      code: [
        `    vec2  ${id}_p     = ${uv} + sin(${uv}.yx * 3.14159 + ${t}) * ${dist};\n`,
        `    float ${id}_value = sin(${waveExpr} - ${t} * ${sp}) * 0.5 + 0.5;\n`,
      ].join(''),
      outputVars: { value: `${id}_value` },
    };
  },
};

// MagicTexture — multicolored interference pattern (Blender-style)
export const MagicTextureNode: NodeDefinition = {
  type: 'magicTexture', label: 'Magic Texture', category: 'Spaces',
  description: 'Multicolored interference / psychedelic pattern reminiscent of Blender\'s Magic texture.',
  inputs: {
    uv:    { type: 'vec2',  label: 'UV' },
    scale: { type: 'float', label: 'Scale' },
    time:  { type: 'float', label: 'Time' },
  },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { scale: 4.0, depth: 4, distortion: 1.0 },
  paramDefs: {
    scale:      { label: 'Scale',      type: 'float', min: 0.5, max: 20.0, step: 0.1 },
    depth:      { label: 'Depth',      type: 'select', options: [1,2,3,4,5,6].map(n => ({ value: String(n), label: String(n) })) },
    distortion: { label: 'Distortion', type: 'float', min: 0.0, max: 5.0, step: 0.1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const uv   = inputVars.uv    || 'vec2(0.0)';
    const sc   = inputVars.scale || p(node.params.scale, 4.0);
    const t    = inputVars.time  || '0.0';
    const dist = p(node.params.distortion, 1.0);
    const depth = Math.max(1, Math.min(6, Number(node.params.depth) || 4));
    const lines: string[] = [
      `    vec2  ${id}_p  = ${uv} * ${sc};\n`,
      `    float ${id}_x  = sin(${id}_p.x + sin(${id}_p.y + ${t}));\n`,
      `    float ${id}_y  = cos(${id}_p.x - cos(${id}_p.y));\n`,
    ];
    for (let i = 1; i < depth; i++) {
      lines.push(`    ${id}_x = sin(${id}_x * ${dist} + ${id}_p.y * float(${i}));\n`);
      lines.push(`    ${id}_y = cos(${id}_y * ${dist} - ${id}_p.x * float(${i}));\n`);
    }
    lines.push(`    vec3 ${id}_color = 0.5 + 0.5 * vec3(${id}_x, ${id}_y, sin(${id}_x - ${id}_y));\n`);
    return { code: lines.join(''), outputVars: { color: `${id}_color` } };
  },
};

// Grid — outputs a grid/checkerboard mask + cell ID
export const GridNode: NodeDefinition = {
  type: 'grid', label: 'Grid', category: 'Spaces',
  description: 'Grid lines + checkerboard mask with configurable cell size and line width.',
  inputs: {
    uv:        { type: 'vec2',  label: 'UV' },
    scale:     { type: 'float', label: 'Scale' },
    lineWidth: { type: 'float', label: 'Line Width' },
  },
  outputs: {
    grid:        { type: 'float', label: 'Grid Lines' },
    checker:     { type: 'float', label: 'Checker' },
    cellUV:      { type: 'vec2',  label: 'Cell UV' },
    cellID:      { type: 'vec2',  label: 'Cell ID' },
  },
  defaultParams: { scale: 4.0, lineWidth: 0.05 },
  paramDefs: {
    scale:     { label: 'Scale',      type: 'float', min: 0.5, max: 20.0, step: 0.1 },
    lineWidth: { label: 'Line Width', type: 'float', min: 0.0, max: 0.5,  step: 0.005 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const uv  = inputVars.uv        || 'vec2(0.0)';
    const sc  = inputVars.scale     || p(node.params.scale,     4.0);
    const lw  = inputVars.lineWidth || p(node.params.lineWidth, 0.05);
    return {
      code: [
        `    vec2  ${id}_suv    = ${uv} * ${sc};\n`,
        `    vec2  ${id}_cellID = floor(${id}_suv);\n`,
        `    vec2  ${id}_cuv    = fract(${id}_suv) - 0.5;\n`,
        `    vec2  ${id}_edge   = abs(${id}_cuv);\n`,
        `    float ${id}_grid   = step(0.5 - ${lw}, max(${id}_edge.x, ${id}_edge.y));\n`,
        `    float ${id}_check  = mod(${id}_cellID.x + ${id}_cellID.y, 2.0);\n`,
      ].join(''),
      outputVars: {
        grid:    `${id}_grid`,
        checker: `${id}_check`,
        cellUV:  `${id}_cuv`,
        cellID:  `${id}_cellID`,
      },
    };
  },
};

// Shear — shear/skew a UV coordinate
export const ShearNode: NodeDefinition = {
  type: 'shear', label: 'Shear', category: 'Spaces',
  description: 'Shear/skew UV space: shift X by factor of Y and vice versa.',
  inputs: {
    uv:      { type: 'vec2',  label: 'UV' },
    shearX:  { type: 'float', label: 'Shear X' },
    shearY:  { type: 'float', label: 'Shear Y' },
  },
  outputs: { uv: { type: 'vec2', label: 'UV' } },
  defaultParams: { shearX: 0.5, shearY: 0.0 },
  paramDefs: {
    shearX: { label: 'Shear X', type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    shearY: { label: 'Shear Y', type: 'float', min: -2.0, max: 2.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv = inputVars.uv     || 'vec2(0.0)';
    const sx = inputVars.shearX || p(node.params.shearX, 0.5);
    const sy = inputVars.shearY || p(node.params.shearY, 0.0);
    return {
      code: [
        `    vec2 ${id}_uvi = ${uv};\n`,
        `    vec2 ${id}_uv  = vec2(${id}_uvi.x + ${sx} * ${id}_uvi.y, ${id}_uvi.y + ${sy} * ${id}_uvi.x);\n`,
      ].join(''),
      outputVars: { uv: `${id}_uv` },
    };
  },
};

// ── Perspective 2D ────────────────────────────────────────────────────────────

export const Perspective2DNode: NodeDefinition = {
  type: 'perspective2d',
  label: 'Perspective 2D',
  category: 'Spaces',
  description: 'Fake 3D perspective projection for 2D UVs. ratio=0: flat. ratio=1: mild. ratio=2+: dramatic. Use Y axis for floor, X for wall.',
  inputs: {
    uv:    { type: 'vec2',  label: 'UV'    },
    ratio: { type: 'float', label: 'Ratio' },
  },
  outputs: {
    uv:    { type: 'vec2',  label: 'UV'    },
    depth: { type: 'float', label: 'Depth' },
  },
  defaultParams: { ratio: 1.0, axis: 'y', flip: 'false' },
  paramDefs: {
    ratio: { label: 'Ratio', type: 'float', min: 0.0, max: 5.0, step: 0.05 },
    axis:  { label: 'Axis',  type: 'select', options: [
      { value: 'y',  label: 'Y (floor)'  },
      { value: 'x',  label: 'X (wall)'   },
      { value: 'xy', label: 'XY (tunnel)'},
    ]},
    flip:  { label: 'Flip',  type: 'select', options: [
      { value: 'false', label: 'Off' },
      { value: 'true',  label: 'On'  },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uvVar   = inputVars.uv    || 'vec2(0.0)';
    const ratioV  = inputVars.ratio || p(node.params.ratio, 1.0);
    const axis    = (node.params.axis as string) ?? 'y';
    const flip    = (node.params.flip as string) ?? 'false';
    const sign    = flip === 'true' ? '-1.0' : '1.0';
    let denomExpr: string;
    switch (axis) {
      case 'x':
        denomExpr = `1.0 - ${uvVar}.x * ${ratioV}`;
        break;
      case 'xy':
        denomExpr = `1.0 - (${uvVar}.x + ${uvVar}.y) * 0.5 * ${ratioV}`;
        break;
      default: // y
        denomExpr = `1.0 - ${sign} * ${uvVar}.y * ${ratioV}`;
        break;
    }
    return {
      code: [
        `    float ${id}_denom = max(${denomExpr}, 0.001);\n`,
        `    vec2  ${id}_uv    = ${uvVar} / ${id}_denom;\n`,
        `    float ${id}_depth = 1.0 - ${id}_denom;\n`,
      ].join(''),
      outputVars: { uv: `${id}_uv`, depth: `${id}_depth` },
    };
  },
};

// ─── Domain Repetition Nodes (IQ article) ─────────────────────────────────────

/**
 * Mirrored Repeat 2D
 * Fast, SDF-correct tiling for symmetric shapes. Every other tile is mirrored
 * so the shape is always reflected across tile boundaries — no discontinuities.
 * (From Inigo Quilez "Domain Repetition" article.)
 */
export const MirroredRepeat2DNode: NodeDefinition = {
  type: 'mirroredRepeat2D',
  label: 'Mirrored Repeat',
  category: 'Spaces',
  description: 'Tiles UV space with mirroring on every other cell. Produces SDF-correct tiling for symmetric shapes — no boundary discontinuities. Pairs with any SDF or pattern node.',
  inputs: {
    input: { type: 'vec2',  label: 'UV' },
    cellX: { type: 'float', label: 'Cell W' },
    cellY: { type: 'float', label: 'Cell H' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Cell UV' },
    cellID: { type: 'vec2', label: 'Cell ID' },
  },
  defaultParams: { cellX: 1.0, cellY: 1.0 },
  paramDefs: {
    cellX: { label: 'Cell W', type: 'float', min: 0.1, max: 10.0, step: 0.05 },
    cellY: { label: 'Cell H', type: 'float', min: 0.1, max: 10.0, step: 0.05 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const inVar = inputVars.input || 'vec2(0.0)';
    const cX    = inputVars.cellX || p(node.params.cellX, 1.0);
    const cY    = inputVars.cellY || p(node.params.cellY, 1.0);
    return {
      code: [
        `    vec2 ${id}_s      = vec2(${cX}, ${cY});\n`,
        `    vec2 ${id}_cellID = round(${inVar} / ${id}_s);\n`,
        `    vec2 ${id}_r      = ${inVar} - ${id}_s * ${id}_cellID;\n`,
        // step(0.5, mod(abs(id), 2.0)) → 0 for even tile index, 1 for odd
        `    vec2 ${id}_odd    = step(vec2(0.5), mod(abs(${id}_cellID), vec2(2.0)));\n`,
        `    vec2 ${id}_output = mix(${id}_r, -${id}_r, ${id}_odd);\n`,
      ].join(''),
      outputVars: { output: `${id}_output`, cellID: `${id}_cellID` },
    };
  },
};

/**
 * Limited Repeat 2D
 * Finite grid of N×M tiles. Uses the clamped-ID technique from IQ's article —
 * at the grid boundary the last valid shape is "pressed up against" the edge,
 * giving correct SDF distances for symmetric shapes.
 */
export const LimitedRepeat2DNode: NodeDefinition = {
  type: 'limitedRepeat2D',
  label: 'Limited Repeat',
  category: 'Spaces',
  description: 'Tiles UV space a finite number of times (N×M grid). Correct for symmetric shapes — at the edges the boundary tile is extended rather than clipped. Great for windows, keys, columns.',
  inputs: {
    input:  { type: 'vec2',  label: 'UV'      },
    cellX:  { type: 'float', label: 'Cell W'  },
    cellY:  { type: 'float', label: 'Cell H'  },
    countX: { type: 'float', label: 'Count X' },
    countY: { type: 'float', label: 'Count Y' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Cell UV' },
    cellID: { type: 'vec2', label: 'Cell ID' },
  },
  defaultParams: { cellX: 0.5, cellY: 0.5, countX: 5.0, countY: 3.0 },
  paramDefs: {
    cellX:  { label: 'Cell W',  type: 'float', min: 0.05, max: 10.0, step: 0.05 },
    cellY:  { label: 'Cell H',  type: 'float', min: 0.05, max: 10.0, step: 0.05 },
    countX: { label: 'Count X', type: 'float', min: 1.0,  max: 40.0, step: 1.0  },
    countY: { label: 'Count Y', type: 'float', min: 1.0,  max: 40.0, step: 1.0  },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const inVar = inputVars.input  || 'vec2(0.0)';
    const cX    = inputVars.cellX  || p(node.params.cellX,  0.5);
    const cY    = inputVars.cellY  || p(node.params.cellY,  0.5);
    const nX    = inputVars.countX || p(node.params.countX, 5.0);
    const nY    = inputVars.countY || p(node.params.countY, 3.0);
    return {
      code: [
        `    vec2 ${id}_s    = vec2(${cX}, ${cY});\n`,
        `    vec2 ${id}_half = (vec2(${nX}, ${nY}) - 1.0) * 0.5;\n`,
        `    vec2 ${id}_id   = clamp(round(${inVar} / ${id}_s), -${id}_half, ${id}_half);\n`,
        `    vec2 ${id}_output = ${inVar} - ${id}_s * ${id}_id;\n`,
      ].join(''),
      outputVars: { output: `${id}_output`, cellID: `${id}_id` },
    };
  },
};

/**
 * Angular Repeat 2D
 * Repeats a shape N times in a ring by mapping every angular sector to the
 * canonical first sector. Like kaleidoscope but without the mirror flip.
 * (From IQ "Domain Repetition" — rotational repetition.)
 */
export const AngularRepeat2DNode: NodeDefinition = {
  type: 'angularRepeat2D',
  label: 'Angular Repeat',
  category: 'Spaces',
  description: 'Repeats UV space N times radially around the origin — creates ring/gear/petal arrangements. Feed into any SDF or pattern. sectorID output identifies which copy (0..N-1).',
  inputs: {
    input: { type: 'vec2',  label: 'UV'    },
    count: { type: 'float', label: 'Count' },
  },
  outputs: {
    output:   { type: 'vec2',  label: 'Sector UV' },
    sectorID: { type: 'float', label: 'Sector ID' },
  },
  defaultParams: { count: 6.0 },
  paramDefs: {
    count: { label: 'Count', type: 'float', min: 2.0, max: 32.0, step: 1.0 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const inVar = inputVars.input || 'vec2(0.0)';
    const n     = inputVars.count || p(node.params.count, 6.0);
    return {
      code: [
        // Sector spacing in radians
        `    float ${id}_sp   = 6.28318530718 / ${n};\n`,
        // Raw angle in [-π, π]
        `    float ${id}_an   = atan((${inVar}).y, (${inVar}).x);\n`,
        // Nearest sector index (may be negative — that's fine)
        `    float ${id}_id   = round(${id}_an / ${id}_sp);\n`,
        // Wrap angle into canonical range [-sp/2, sp/2]
        `    float ${id}_aw   = ${id}_an - ${id}_sp * ${id}_id;\n`,
        // Reconstruct canonical UV at same radius
        `    float ${id}_rad  = length(${inVar});\n`,
        `    vec2  ${id}_output = vec2(cos(${id}_aw) * ${id}_rad, sin(${id}_aw) * ${id}_rad);\n`,
        `    float ${id}_sectorID = ${id}_id;\n`,
      ].join(''),
      outputVars: { output: `${id}_output`, sectorID: `${id}_sectorID` },
    };
  },
};
