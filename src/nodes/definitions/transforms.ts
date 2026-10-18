import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';

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
  label: 'Tile', aliases: ['fract', 'repeat'],
  description: 'Repeats the space: fract(uv * count) - 0.5, so each tile is centred on 0. Cell ID is floor(uv * count), the tile’s integer column and row: hash it for per-tile variation. For a plain scalar fract use Fract (scalar).',
  category: '2D Space', subcategory: 'Basic',
  inputs: {
    input: { type: 'vec2', label: 'Input' },
    scale: { type: 'float', label: 'Tile count' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Output' },
    cellID: { type: 'vec2', label: 'Cell ID', hint: 'floor(uv × count): which tile this is, as an integer column and row. Hash it for per-tile variation.' },
  },
  defaultParams: { scale: 3.0 },
  paramDefs: {
    scale: { label: 'Tile count', type: 'float', min: 0.1, max: 20, step: 0.1, hint: 'How many times the space repeats.' },
  },
  // Tiles saved before Cell ID existed get the new output on load (loading backfills inputs only).
  syncSockets: (node) => node.outputs.cellID ? node : {
    ...node,
    outputs: { ...node.outputs, cellID: { type: 'vec2', label: 'Cell ID' } },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_output`;
    const inVar = inputVars.input || 'vec2(0.0)';
    const scale = inputVars.scale || p(node.params.scale, 3.0);
    const idVar = `${node.id}_cid`;
    return {
      code: `    vec2 ${idVar} = floor(${inVar} * ${scale});\n` +
            `    vec2 ${outVar} = fract(${inVar} * ${scale}) - 0.5;\n`,
      outputVars: { output: outVar, cellID: idVar },
    };
  },
};

/**
 * UV Warp: one node for the four noise-and-twist warps (2026-10-17 sweep). Kind picks the field:
 * Smooth (value noise), Jitter (blocky hash grid), Curl (divergence-free flow) or Swirl (a twist round a
 * centre, the old Swirl / Vortex too). Each kind runs exactly the GLSL its old node did, so the old
 * types (smoothWarp, curlWarp, swirlWarp, swirlSpace) migrate here through NODE_ALIASES.
 * A uvWarp saved before Kind (version < 2, no `kind`) was the Jitter node and stays Jitter.
 */
export const UV_WARP_KINDS = ['smooth', 'jitter', 'curl', 'swirl'] as const;
export type UvWarpKind = typeof UV_WARP_KINDS[number];
export const uvWarpKind = (v: unknown): UvWarpKind => ((UV_WARP_KINDS as readonly string[]).includes(v as string) ? v as UvWarpKind : 'jitter');
/** Each kind's old defaults (what its node used when a setting was missing). */
const UV_WARP_DEFAULTS: Record<UvWarpKind, { strength: number; scale: number; speed: number }> = {
  smooth: { strength: 0.1, scale: 4.0, speed: 0.5 },
  jitter: { strength: 0.05, scale: 8.0, speed: 1.0 },
  curl: { strength: 0.15, scale: 3.0, speed: 0.4 },
  swirl: { strength: 2.0, scale: 4.0, speed: 0.3 },
};
const UV_WARP_GLSL_OF: Record<UvWarpKind, string> = { smooth: SMOOTH_WARP_GLSL, jitter: UV_WARP_GLSL, curl: CURL_WARP_GLSL, swirl: SWIRL_WARP_GLSL };
const NOISE_KINDS = ['smooth', 'jitter', 'curl'];

export const UVWarpNode: NodeDefinition = withParamSockets({
  type: 'uvWarp',
  label: 'UV Warp',
  aliases: ['UV Warp (Smooth)', 'UV Warp (Jitter)', 'UV Warp (Curl)', 'UV Warp (Swirl)', 'Swirl / Vortex', 'Swirl', 'Vortex', 'Twirl', 'Curl warp', 'Jitter warp'],
  category: '2D Space', subcategory: 'Warp',
  description: 'Pushes the UV around. Kind picks how: Smooth is flowing value noise with no grid edges; Jitter is a blocky hash grid (glitch, mosaic); Curl is divergence-free noise that swirls like smoke; Swirl twists space round a centre, most at the middle. Strength is how far it moves (for Swirl, the twist in radians); wire Time to animate.',
  version: 2,
  migrateParams: (params, fromVersion) => (fromVersion < 2 && !('kind' in params) ? { ...params, kind: 'jitter' } : params),
  inputs: {
    input:    { type: 'vec2',  label: 'UV' },
    time:     { type: 'float', label: 'Time', hint: 'Wire Time to animate the warp; unwired it is a fixed displacement (Swirl holds still).' },
    strength: { type: 'float', label: 'Strength' },
  },
  outputs: {
    output: { type: 'vec2', label: 'UV out' },
  },
  defaultParams: { kind: 'smooth', strength: 0.1, scale: 4.0, speed: 0.5, falloff: 4.0, cx: 0.0, cy: 0.0 },
  paramDefs: {
    kind: { label: 'Kind', type: 'select', hint: 'Smooth: flowing noise. Jitter: blocky, glitchy shifts. Curl: smoke-like swirling flow. Swirl: a twist round a centre.', options: [
      { value: 'smooth', label: 'Smooth' }, { value: 'jitter', label: 'Jitter' }, { value: 'curl', label: 'Curl' }, { value: 'swirl', label: 'Swirl' },
    ] },
    strength: { label: 'Strength', type: 'float', min: 0.0, max: 1.0, step: 0.005, hint: 'How far the warp pushes: 0.05 is a subtle ripple, 0.5 melts. For Swirl it is the twist at the centre in radians (2 is a strong twist; negative twists the other way).' },
    scale:    { label: 'Scale',    type: 'float', min: 0.1,  max: 40.0, step: 0.1, showWhen: { param: 'kind', value: NOISE_KINDS }, hint: 'Frequency of the warp field. Higher = smaller, busier blocks or swirls.' },
    speed:    { label: 'Speed',    type: 'float', min: 0.0,  max: 5.0,  step: 0.01, hint: 'How fast the field drifts (Swirl: keeps spinning). Needs Time wired.' },
    falloff:  { label: 'Falloff',  type: 'float', min: 0.1,  max: 20.0, step: 0.1, showWhen: { param: 'kind', value: 'swirl' }, hint: 'How quickly the twist fades outward. Higher keeps it tight to the centre.' },
    cx:       { label: 'Center X', type: 'float', min: -1.0, max: 1.0,  step: 0.01, showWhen: { param: 'kind', value: 'swirl' }, hint: 'Horizontal position of the swirl centre.' },
    cy:       { label: 'Center Y', type: 'float', min: -1.0, max: 1.0,  step: 0.01, showWhen: { param: 'kind', value: 'swirl' }, hint: 'Vertical position of the swirl centre.' },
  },
  glslFunctionsFor: node => [UV_WARP_GLSL_OF[uvWarpKind(node.params.kind)]],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const kind    = uvWarpKind(node.params.kind);
    const D       = UV_WARP_DEFAULTS[kind];
    const uv      = inputVars.input || 'vec2(0.0)';
    const timeVar = inputVars.time  || '0.0';
    const str     = inputVars.strength || p(node.params.strength, D.strength);
    const speed   = p(node.params.speed, D.speed);
    if (kind === 'swirl') {
      const falloff = p(node.params.falloff, 4.0);
      const cx      = p(node.params.cx, 0.0);
      const cy      = p(node.params.cy, 0.0);
      return {
        code: `    vec2 ${id}_output = ${uv} + swirlWarpOffset(${uv}, ${cx}, ${cy}, ${str}, ${falloff}, ${timeVar}, ${speed});\n`,
        outputVars: { output: `${id}_output` },
      };
    }
    const scale = p(node.params.scale, D.scale);
    const fn = kind === 'smooth' ? 'smoothWarpOffset' : kind === 'curl' ? 'curlWarpOffset' : 'uvWarpOffset';
    return {
      code: `    vec2 ${id}_output = ${uv} + ${fn}(${uv}, ${scale}, ${timeVar}, ${speed}) * ${str};\n`,
      outputVars: { output: `${id}_output` },
    };
  },
}, ['scale', 'speed', 'falloff', 'cx', 'cy']);

// "Displace" — wire any vec2 as the displacement direction, control amount with Strength
export const DisplaceNode: NodeDefinition = {
  type: 'displace',
  label: 'Displace',
  category: '2D Space', subcategory: 'Basic',
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
    amount: { label: 'Amount', type: 'float', min: -2.0, max: 2.0, step: 0.005, hint: 'Scales the Offset vector. Negative pushes the opposite way.' },
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
  category: '2D Space', subcategory: 'Basic',
  description: 'Rotate a 2D vector by an angle (radians)',
  inputs: {
    input: { type: 'vec2', label: 'Input' },
    angle: { type: 'float', label: 'Angle (rad)' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Output' },
  },
  defaultParams: { angle: 0.0 },
  paramDefs: {
    angle: { label: 'Angle (rad)', type: 'float', min: -6.28, max: 6.28, step: 0.01, hint: 'In radians: 3.14 is half a turn.' },
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
  category: '2D Space', subcategory: 'Basic',
  description: 'Full 2D affine transform: Translate, rotation and Scale composed as a single mat2 multiply. More efficient than chaining three separate nodes. Rotation and scale apply relative to pivot.',
  inputs: {
    uv:        { type: 'vec2',  label: 'UV'        },
    translate: { type: 'vec2',  label: 'Translate', axisParams: ['tx', 'ty'] },
    angle:     { type: 'float', label: 'Angle'     },
    scale:     { type: 'vec2',  label: 'Scale',     axisParams: ['sx', 'sy'] },
  },
  outputs: { result: { type: 'vec2', label: 'Result' } },
  defaultParams: { tx: 0.0, ty: 0.0, angle: 0.0, sx: 1.0, sy: 1.0, pivotX: 0.0, pivotY: 0.0 },
  paramDefs: {
    tx:     { label: 'Translate X', type: 'float', min: -2.0,    max: 2.0,    step: 0.01, hint: 'Shifts the space horizontally.' },
    ty:     { label: 'Translate Y', type: 'float', min: -2.0,    max: 2.0,    step: 0.01, hint: 'Shifts the space vertically.' },
    angle:  { label: 'Angle',       type: 'float', min: -3.14159, max: 3.14159, step: 0.01, hint: 'Rotation in radians around the pivot. 3.14 is half a turn.' },
    sx:     { label: 'Scale X',     type: 'float', min: 0.01,    max: 8.0,    step: 0.01, hint: 'Horizontal stretch. Below 1 zooms in, above 1 zooms out.' },
    sy:     { label: 'Scale Y',     type: 'float', min: 0.01,    max: 8.0,    step: 0.01, hint: 'Vertical stretch. Below 1 zooms in, above 1 zooms out.' },
    pivotX: { label: 'Pivot X',     type: 'float', min: -1.0,    max: 1.0,    step: 0.01, hint: 'Horizontal center that rotation and scale happen around.' },
    pivotY: { label: 'Pivot Y',     type: 'float', min: -1.0,    max: 1.0,    step: 0.01, hint: 'Vertical center that rotation and scale happen around.' },
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
export const UvReciprocalNode: NodeDefinition = withParamSockets({
  type: 'uvReciprocal',
  label: 'UV Reciprocal',
  category: '2D Space', subcategory: 'Warp',
  description: 'Applies N/x family transforms to UV. Bounded = smooth lens distortion. Raw = hyperbolic (interesting with fract). Circle inversion = Möbius-like, foundation for inversion fractal patterns.',
  inputs: { uv: { type: 'vec2', label: 'UV' } },
  outputs: { result: { type: 'vec2', label: 'Result' } },
  defaultParams: { mode: '0.0', k: 1.0 },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', hint: 'Bounded is a soft lens, Raw is hyperbolic, Circle Inversion swaps inside and outside.', options: [
      { value: '0.0', label: 'Bounded'          },
      { value: '1.0', label: 'Raw'               },
      { value: '2.0', label: 'Circle Inversion'  },
    ]},
    k: { label: 'Strength', type: 'float', min: 0.1, max: 20.0, step: 0.1, hint: 'How strongly the space is bent.' },
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
}, ['k']);
