/**
 * Spaces — UV space transformation nodes
 *
 * These nodes warp the coordinate space itself. Feed a UV in, get a warped UV
 * out, then pass that into any SDF, noise, or pattern node. Anything downstream
 * automatically lives in the new geometry.
 */
import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';

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
    const twist  = inputVars.twist       || f(typeof node.params.twist       === 'number' ? node.params.twist       : 0.0);
    const rscale = inputVars.radialScale || f(typeof node.params.radialScale === 'number' ? node.params.radialScale : 1.0);
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
    const scale = inputVars.scale || f(typeof node.params.scale === 'number' ? node.params.scale : 1.0);
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
    const curvature = inputVars.curvature || f(typeof node.params.curvature === 'number' ? node.params.curvature : 0.7);
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
    const radius = inputVars.radius || f(typeof node.params.radius === 'number' ? node.params.radius : 1.0);
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
    const px    = inputVars.poleX || f(typeof node.params.poleX === 'number' ? node.params.poleX : 0.5);
    const py    = inputVars.poleY || f(typeof node.params.poleY === 'number' ? node.params.poleY : 0.0);
    const ang   = inputVars.angle || f(typeof node.params.angle === 'number' ? node.params.angle : 0.0);
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
    const strength = inputVars.strength || f(typeof node.params.strength === 'number' ? node.params.strength : 2.0);
    const falloff  = inputVars.falloff  || f(typeof node.params.falloff  === 'number' ? node.params.falloff  : 1.0);
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
    const segs   = inputVars.segments || f(typeof node.params.segments === 'number' ? node.params.segments : 6.0);
    const rot    = inputVars.rotate   || f(typeof node.params.rotate   === 'number' ? node.params.rotate   : 0.0);
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
    const strength = inputVars.strength || f(typeof node.params.strength === 'number' ? node.params.strength : 0.5);
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
    const fX    = inputVars.freqX || f(typeof node.params.freqX === 'number' ? node.params.freqX : 5.0);
    const fY    = inputVars.freqY || f(typeof node.params.freqY === 'number' ? node.params.freqY : 5.0);
    const aX    = inputVars.ampX  || f(typeof node.params.ampX  === 'number' ? node.params.ampX  : 0.1);
    const aY    = inputVars.ampY  || f(typeof node.params.ampY  === 'number' ? node.params.ampY  : 0.1);
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
    const cX    = inputVars.cellX || f(typeof node.params.cellX === 'number' ? node.params.cellX : 1.0);
    const cY    = inputVars.cellY || f(typeof node.params.cellY === 'number' ? node.params.cellY : 1.0);
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
