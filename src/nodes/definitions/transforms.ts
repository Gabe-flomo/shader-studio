import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ─── Shared GLSL helpers ──────────────────────────────────────────────────────

const WARP_HASH_GLSL = `
vec2 warpHash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}
float warpHash1(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}`;

// Jitter warp (original blocky feel, but labelled honestly)
const UV_WARP_GLSL = WARP_HASH_GLSL + `
vec2 uvWarpOffset(vec2 uv, float scale, float t, float speed) {
    vec2 p = uv * scale + t * speed;
    return warpHash2(floor(p) + 0.5) * fract(p + 0.5);
}`;

// Smooth value-noise warp — bilinear interp between hashed corners → no grid edges
const SMOOTH_WARP_GLSL = WARP_HASH_GLSL + `
vec2 smoothWarpOffset(vec2 uv, float scale, float t, float speed) {
    vec2 p = uv * scale + t * speed * vec2(1.0, 0.7);
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 a = warpHash2(i);
    vec2 b = warpHash2(i + vec2(1.0, 0.0));
    vec2 c = warpHash2(i + vec2(0.0, 1.0));
    vec2 d = warpHash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}`;

// Curl noise — divergence-free, gives fluid/smoke swirling
const CURL_WARP_GLSL = WARP_HASH_GLSL + `
float curlValueNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(warpHash1(i), warpHash1(i+vec2(1,0)), u.x),
               mix(warpHash1(i+vec2(0,1)), warpHash1(i+vec2(1,1)), u.x), u.y) * 2.0 - 1.0;
}
vec2 curlWarpOffset(vec2 uv, float scale, float t, float speed) {
    float eps = 0.001;
    vec2 p = uv * scale + t * speed;
    float dx = curlValueNoise(p + vec2(eps, 0.0)) - curlValueNoise(p - vec2(eps, 0.0));
    float dy = curlValueNoise(p + vec2(0.0, eps)) - curlValueNoise(p - vec2(0.0, eps));
    return vec2(dy, -dx) / (2.0 * eps * scale);
}`;

// Swirl — rotational twist strongest at center, fades with radius
const SWIRL_WARP_GLSL = `
vec2 swirlWarpOffset(vec2 uv, float cx, float cy, float twist, float falloff, float t, float speed) {
    vec2 delta = uv - vec2(cx, cy);
    float r = length(delta);
    float angle = twist * exp(-r * falloff) + t * speed * 0.5;
    float ca = cos(angle); float sa = sin(angle);
    vec2 rotated = vec2(delta.x * ca - delta.y * sa, delta.x * sa + delta.y * ca);
    return rotated + vec2(cx, cy) - uv;
}`;

// ─── Nodes ────────────────────────────────────────────────────────────────────

export const FractNode: NodeDefinition = {
  type: 'fract',
  label: 'Fract / Tile',
  category: 'Transforms',
  description: 'Tile space using fract with an optional scale multiplier. Wire a float to Scale to animate tile count.',
  inputs: {
    input: { type: 'vec2', label: 'Input' },
    scale: { type: 'float', label: 'Scale' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Output' },
  },
  defaultParams: { scale: 3.0 },
  paramDefs: {
    scale: { label: 'Scale', type: 'float', min: 0.1, max: 20, step: 0.1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_output`;
    const inVar = inputVars.input || 'vec2(0.0)';
    const scale = inputVars.scale || p(node.params.scale, 3.0);
    return {
      code: `    vec2 ${outVar} = fract(${inVar} * ${scale}) - 0.5;\n`,
      outputVars: { output: outVar },
    };
  },
};

export const UVWarpNode: NodeDefinition = {
  type: 'uvWarp',
  label: 'UV Warp (Jitter)',
  category: 'Transforms',
  description: 'Hash-grid jitter warp — intentionally blocky/pixelated displacement. Great for glitch and mosaic effects. For smooth flowing warps use UV Warp (Smooth).',
  inputs: {
    input: { type: 'vec2', label: 'UV' },
    time:  { type: 'float', label: 'Time' },
  },
  outputs: {
    output: { type: 'vec2', label: 'UV out' },
  },
  defaultParams: { strength: 0.05, scale: 8.0, speed: 1.0 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: 0.0,  max: 0.5,  step: 0.001 },
    scale:    { label: 'Scale',    type: 'float', min: 0.1,  max: 40.0, step: 0.1   },
    speed:    { label: 'Speed',    type: 'float', min: 0.0,  max: 5.0,  step: 0.01  },
  },
  glslFunction: UV_WARP_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uv      = inputVars.input || 'vec2(0.0)';
    const timeVar = inputVars.time  || '0.0';
    const str     = p(node.params.strength, 0.05);
    const scale   = p(node.params.scale, 8.0);
    const speed   = p(node.params.speed, 1.0);
    return {
      code: `    vec2 ${id}_output = ${uv} + uvWarpOffset(${uv}, ${scale}, ${timeVar}, ${speed}) * ${str};\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

export const SmoothWarpNode: NodeDefinition = {
  type: 'smoothWarp',
  label: 'UV Warp (Smooth)',
  category: 'Transforms',
  description: 'Smooth bilinear value-noise warp — flowing, organic displacement with no visible grid edges. Use Strength to control how much it moves, Scale for frequency.',
  inputs: {
    input:    { type: 'vec2',  label: 'UV' },
    time:     { type: 'float', label: 'Time' },
    strength: { type: 'float', label: 'Strength' },
  },
  outputs: {
    output: { type: 'vec2', label: 'UV out' },
  },
  defaultParams: { strength: 0.1, scale: 4.0, speed: 0.5 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: 0.0,  max: 1.0,  step: 0.005 },
    scale:    { label: 'Scale',    type: 'float', min: 0.1,  max: 40.0, step: 0.1   },
    speed:    { label: 'Speed',    type: 'float', min: 0.0,  max: 5.0,  step: 0.01  },
  },
  glslFunction: SMOOTH_WARP_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uv      = inputVars.input || 'vec2(0.0)';
    const timeVar = inputVars.time  || '0.0';
    const str     = inputVars.strength || p(node.params.strength, 0.1);
    const scale   = p(node.params.scale, 4.0);
    const speed   = p(node.params.speed, 0.5);
    return {
      code: `    vec2 ${id}_output = ${uv} + smoothWarpOffset(${uv}, ${scale}, ${timeVar}, ${speed}) * ${str};\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

export const CurlWarpNode: NodeDefinition = {
  type: 'curlWarp',
  label: 'UV Warp (Curl)',
  category: 'Transforms',
  description: 'Divergence-free curl noise warp — simulates fluid flow, smoke, and turbulent streams. Particles never converge or diverge, giving a very natural swirling motion.',
  inputs: {
    input:    { type: 'vec2',  label: 'UV' },
    time:     { type: 'float', label: 'Time' },
    strength: { type: 'float', label: 'Strength' },
  },
  outputs: {
    output: { type: 'vec2', label: 'UV out' },
  },
  defaultParams: { strength: 0.15, scale: 3.0, speed: 0.4 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: 0.0,  max: 1.0,  step: 0.005 },
    scale:    { label: 'Scale',    type: 'float', min: 0.1,  max: 20.0, step: 0.1   },
    speed:    { label: 'Speed',    type: 'float', min: 0.0,  max: 5.0,  step: 0.01  },
  },
  glslFunction: CURL_WARP_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uv      = inputVars.input || 'vec2(0.0)';
    const timeVar = inputVars.time  || '0.0';
    const str     = inputVars.strength || p(node.params.strength, 0.15);
    const scale   = p(node.params.scale, 3.0);
    const speed   = p(node.params.speed, 0.4);
    return {
      code: `    vec2 ${id}_output = ${uv} + curlWarpOffset(${uv}, ${scale}, ${timeVar}, ${speed}) * ${str};\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

export const SwirlWarpNode: NodeDefinition = {
  type: 'swirlWarp',
  label: 'UV Warp (Swirl)',
  category: 'Transforms',
  description: 'Rotational twist warp — strongest at center, decays with distance. Twist sets max rotation angle, Falloff controls how quickly it fades outward. Animates with time.',
  inputs: {
    input:    { type: 'vec2',  label: 'UV' },
    time:     { type: 'float', label: 'Time' },
    strength: { type: 'float', label: 'Twist' },
  },
  outputs: {
    output: { type: 'vec2', label: 'UV out' },
  },
  defaultParams: { strength: 2.0, falloff: 4.0, cx: 0.0, cy: 0.0, speed: 0.3 },
  paramDefs: {
    strength: { label: 'Twist',   type: 'float', min: -12.0, max: 12.0, step: 0.05 },
    falloff:  { label: 'Falloff', type: 'float', min: 0.1,   max: 20.0, step: 0.1  },
    cx:       { label: 'Center X',type: 'float', min: -1.0,  max: 1.0,  step: 0.01 },
    cy:       { label: 'Center Y',type: 'float', min: -1.0,  max: 1.0,  step: 0.01 },
    speed:    { label: 'Speed',   type: 'float', min: -5.0,  max: 5.0,  step: 0.01 },
  },
  glslFunction: SWIRL_WARP_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uv      = inputVars.input || 'vec2(0.0)';
    const timeVar = inputVars.time  || '0.0';
    const twist   = inputVars.strength || p(node.params.strength, 2.0);
    const falloff = p(node.params.falloff, 4.0);
    const cx      = p(node.params.cx, 0.0);
    const cy      = p(node.params.cy, 0.0);
    const speed   = p(node.params.speed, 0.3);
    return {
      code: `    vec2 ${id}_output = ${uv} + swirlWarpOffset(${uv}, ${cx}, ${cy}, ${twist}, ${falloff}, ${timeVar}, ${speed});\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

// "Displace" — wire any vec2 as the displacement direction, control amount with Strength
export const DisplaceNode: NodeDefinition = {
  type: 'displace',
  label: 'Displace',
  category: 'Transforms',
  description: 'Displace UV by any vec2 input — plug in noise, math expressions, or any vec2 to use as the warp field. This is the "bring your own function" warp node.',
  inputs: {
    input:  { type: 'vec2',  label: 'UV' },
    offset: { type: 'vec2',  label: 'Offset vec2' },
    amount: { type: 'float', label: 'Amount' },
  },
  outputs: {
    output: { type: 'vec2', label: 'UV out' },
  },
  defaultParams: { amount: 0.1 },
  paramDefs: {
    amount: { label: 'Amount', type: 'float', min: -2.0, max: 2.0, step: 0.005 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id     = node.id;
    const uv     = inputVars.input  || 'vec2(0.0)';
    const offset = inputVars.offset || 'vec2(0.0)';
    const amount = inputVars.amount || p(node.params.amount, 0.1);
    return {
      code: `    vec2 ${id}_output = ${uv} + ${offset} * ${amount};\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

export const Rotate2DNode: NodeDefinition = {
  type: 'rotate2d',
  label: 'Rotate 2D',
  category: 'Transforms',
  description: 'Rotate a 2D vector by an angle (radians)',
  inputs: {
    input: { type: 'vec2', label: 'Input' },
    angle: { type: 'float', label: 'Angle' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Output' },
  },
  defaultParams: { angle: 0.0 },
  paramDefs: {
    angle: { label: 'Angle', type: 'float', min: -6.28, max: 6.28, step: 0.01 },
  },
  // rotate() is now a built-in always emitted by shaderAssembler — no glslFunction needed
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_output`;
    const inVar = inputVars.input || 'vec2(0.0)';
    const angleVar = inputVars.angle || p(node.params.angle, 0.0);
    return {
      code: `    vec2 ${outVar} = rotate(${inVar}, ${angleVar});\n`,
      outputVars: { output: outVar },
    };
  },
};

// ─── UV Transform 2D ──────────────────────────────────────────────────────────
// Full affine transform (translate + rotate + scale) in one mat2 multiply.
export const UvTransform2dNode: NodeDefinition = {
  type: 'uvTransform2d',
  label: 'UV Transform 2D',
  category: 'Transforms',
  description: 'Full 2D affine transform: translate + rotate + scale composed as a single mat2 multiply. More efficient than chaining three separate nodes. Rotation and scale apply relative to pivot.',
  inputs: {
    uv:        { type: 'vec2',  label: 'UV'        },
    translate: { type: 'vec2',  label: 'Translate' },
    angle:     { type: 'float', label: 'Angle'     },
    scale:     { type: 'vec2',  label: 'Scale'     },
  },
  outputs: { result: { type: 'vec2', label: 'Result' } },
  defaultParams: { tx: 0.0, ty: 0.0, angle: 0.0, sx: 1.0, sy: 1.0, pivotX: 0.0, pivotY: 0.0 },
  paramDefs: {
    tx:     { label: 'Translate X', type: 'float', min: -2.0,    max: 2.0,    step: 0.01 },
    ty:     { label: 'Translate Y', type: 'float', min: -2.0,    max: 2.0,    step: 0.01 },
    angle:  { label: 'Angle',       type: 'float', min: -3.14159, max: 3.14159, step: 0.01 },
    sx:     { label: 'Scale X',     type: 'float', min: 0.01,    max: 8.0,    step: 0.01 },
    sy:     { label: 'Scale Y',     type: 'float', min: 0.01,    max: 8.0,    step: 0.01 },
    pivotX: { label: 'Pivot X',     type: 'float', min: -1.0,    max: 1.0,    step: 0.01 },
    pivotY: { label: 'Pivot Y',     type: 'float', min: -1.0,    max: 1.0,    step: 0.01 },
  },
  glslFunction: `vec2 uvTransform2dFn(vec2 uv, vec2 translate, float angle, vec2 scale, vec2 pivot) {
    uv -= pivot;
    float c = cos(angle), s = sin(angle);
    uv = mat2(c * scale.x, s * scale.x, -s * scale.y, c * scale.y) * uv;
    uv += pivot + translate;
    return uv;
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const uv  = inputVars.uv        ?? 'g_uv';
    const tr  = inputVars.translate ?? `vec2(${p(node.params.tx, 0.0)}, ${p(node.params.ty, 0.0)})`;
    const ang = inputVars.angle     ?? p(node.params.angle, 0.0);
    const sc  = inputVars.scale     ?? `vec2(${p(node.params.sx, 1.0)}, ${p(node.params.sy, 1.0)})`;
    const piv = `vec2(${p(node.params.pivotX, 0.0)}, ${p(node.params.pivotY, 0.0)})`;
    return {
      code: `    vec2 ${id}_result = uvTransform2dFn(${uv}, ${tr}, ${ang}, ${sc}, ${piv});\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

// ─── UV Reciprocal ────────────────────────────────────────────────────────────
// N/x family transforms: bounded lens, raw hyperbolic, Möbius-like circle inversion.
export const UvReciprocalNode: NodeDefinition = {
  type: 'uvReciprocal',
  label: 'UV Reciprocal',
  category: 'Transforms',
  description: 'Applies N/x family transforms to UV. Bounded = smooth lens distortion. Raw = hyperbolic (interesting with fract). Circle inversion = Möbius-like, foundation for inversion fractal patterns.',
  inputs: { uv: { type: 'vec2', label: 'UV' } },
  outputs: { result: { type: 'vec2', label: 'Result' } },
  defaultParams: { mode: '0.0', k: 1.0 },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', options: [
      { value: '0.0', label: 'Bounded'          },
      { value: '1.0', label: 'Raw'               },
      { value: '2.0', label: 'Circle Inversion'  },
    ]},
    k: { label: 'k', type: 'float', min: 0.1, max: 20.0, step: 0.1 },
  },
  glslFunction: `vec2 uvReciprocalFn(vec2 uv, float mode, float k) {
    if (mode < 0.5) {
        return uv / (1.0 + length(uv) * k);
    } else if (mode < 1.5) {
        vec2 safe = sign(uv) * max(abs(uv), vec2(0.001));
        return 1.0 / (safe * k);
    } else {
        float d2 = max(dot(uv, uv), 0.0001);
        return uv * k / d2;
    }
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const uv   = inputVars.uv ?? 'g_uv';
    const mode = p(node.params.mode, 0.0);
    const k    = p(node.params.k, 1.0);
    return {
      code: `    vec2 ${id}_result = uvReciprocalFn(${uv}, ${mode}, ${k});\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};
