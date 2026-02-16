import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f, vec3Str } from './helpers';

// ─── Shared GLSL helpers ──────────────────────────────────────────────────────

const NOISE_HELPERS = `
// 2D value noise helpers (shared by FBM, Voronoi, DomainWarp)
vec2 noiseHash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noiseHash1(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(noiseHash1(i + vec2(0.0,0.0)),
                   noiseHash1(i + vec2(1.0,0.0)), u.x),
               mix(noiseHash1(i + vec2(0.0,1.0)),
                   noiseHash1(i + vec2(1.0,1.0)), u.x), u.y);
}`;

// ─── FBM — Fractal Brownian Motion ───────────────────────────────────────────

const FBM_GLSL = NOISE_HELPERS + `
float fbm(vec2 p, int octaves, float lacunarity, float gain) {
    float value = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        value += amp * valueNoise(p * freq);
        amp  *= gain;
        freq *= lacunarity;
    }
    return value;
}`;

export const FBMNode: NodeDefinition = {
  type: 'fbm',
  label: 'FBM',
  category: 'Noise',
  description: 'Fractal Brownian Motion — layered value noise returning a float in [0,1]. Use as a texture, displacement, or color driver.',
  inputs: {
    uv:        { type: 'vec2',  label: 'UV'        },
    time:      { type: 'float', label: 'Time'      },
    scale:     { type: 'float', label: 'Scale'     },
    time_scale:{ type: 'float', label: 'Time Scale'},
  },
  outputs: {
    value: { type: 'float', label: 'Value' },
    uv:    { type: 'vec2',  label: 'UV (pass-through)' },
  },
  glslFunction: FBM_GLSL,
  defaultParams: { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 1.0, time_scale: 0.0 },
  paramDefs: {
    octaves:    { label: 'Octaves',    type: 'float', min: 1,   max: 8,   step: 1    },
    lacunarity: { label: 'Lacunarity', type: 'float', min: 1.0, max: 4.0, step: 0.01 },
    gain:       { label: 'Gain',       type: 'float', min: 0.0, max: 1.0, step: 0.01 },
    scale:      { label: 'Scale',      type: 'float', min: 0.1, max: 10.0,step: 0.1  },
    time_scale: { label: 'Anim Speed', type: 'float', min: 0.0, max: 2.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id         = node.id;
    const uvVar      = inputVars.uv         ?? 'vec2(0.0)';
    const timeVar    = inputVars.time       ?? '0.0';
    const scale      = inputVars.scale      ?? f(typeof node.params.scale      === 'number' ? node.params.scale      : 1.0);
    const timeScale  = inputVars.time_scale ?? f(typeof node.params.time_scale === 'number' ? node.params.time_scale : 0.0);
    const octaves    = Math.round(typeof node.params.octaves    === 'number' ? node.params.octaves    : 4);
    const lacunarity = f(typeof node.params.lacunarity === 'number' ? node.params.lacunarity : 2.0);
    const gain       = f(typeof node.params.gain       === 'number' ? node.params.gain       : 0.5);
    const outVar     = `${id}_value`;
    // Animated UV: shift by time in a diagonal direction
    const animUV = parseFloat(timeScale) === 0.0
      ? `${uvVar} * ${scale}`
      : `(${uvVar} + ${timeVar} * ${timeScale} * vec2(0.31, 0.17)) * ${scale}`;
    return {
      code: `    float ${outVar} = fbm(${animUV}, ${octaves}, ${lacunarity}, ${gain});\n`,
      outputVars: { value: outVar, uv: uvVar },
    };
  },
};

// ─── Voronoi — Worley/cell noise ─────────────────────────────────────────────

const VORONOI_GLSL = NOISE_HELPERS + `
// IQ-style 2D Voronoi returning minimum distance
float voronoi(vec2 p, float jitter) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float minDist = 8.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = noiseHash2(i + neighbor);
            point = 0.5 + 0.5 * sin(jitter * 6.2831853 * point);
            vec2 diff = neighbor + point - f;
            float dist = length(diff);
            minDist = min(minDist, dist);
        }
    }
    return minDist;
}`;

export const VoronoiNode: NodeDefinition = {
  type: 'voronoi',
  label: 'Voronoi',
  category: 'Noise',
  description: 'Worley (cell) noise — returns distance to nearest cell center. Great for organic patterns, cracked textures, and cell-glow effects.',
  inputs: {
    uv:        { type: 'vec2',  label: 'UV'        },
    time:      { type: 'float', label: 'Time'      },
    scale:     { type: 'float', label: 'Scale'     },
    jitter:    { type: 'float', label: 'Jitter'    },
    time_scale:{ type: 'float', label: 'Anim Speed'},
  },
  outputs: {
    dist: { type: 'float', label: 'Distance' },
    uv:   { type: 'vec2',  label: 'UV (pass-through)' },
  },
  glslFunction: VORONOI_GLSL,
  defaultParams: { scale: 5.0, jitter: 1.0, time_scale: 0.0 },
  paramDefs: {
    scale:      { label: 'Scale',      type: 'float', min: 0.5,  max: 20.0, step: 0.1  },
    jitter:     { label: 'Jitter',     type: 'float', min: 0.0,  max: 1.0,  step: 0.01 },
    time_scale: { label: 'Anim Speed', type: 'float', min: 0.0,  max: 2.0,  step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id        = node.id;
    const uvVar     = inputVars.uv         ?? 'vec2(0.0)';
    const timeVar   = inputVars.time       ?? '0.0';
    const scale     = inputVars.scale      ?? f(typeof node.params.scale      === 'number' ? node.params.scale      : 5.0);
    const jitter    = inputVars.jitter     ?? f(typeof node.params.jitter     === 'number' ? node.params.jitter     : 1.0);
    const timeScale = inputVars.time_scale ?? f(typeof node.params.time_scale === 'number' ? node.params.time_scale : 0.0);
    const outVar    = `${id}_dist`;
    const animUV = parseFloat(timeScale) === 0.0
      ? `${uvVar} * ${scale}`
      : `(${uvVar} + ${timeVar} * ${timeScale} * vec2(0.13, 0.27)) * ${scale}`;
    return {
      code: `    float ${outVar} = voronoi(${animUV}, ${jitter});\n`,
      outputVars: { dist: outVar, uv: uvVar },
    };
  },
};

// ─── Domain Warp — UV distortion via noise ────────────────────────────────────

// DomainWarp needs fbm too — combine the GLSL
const DOMAIN_WARP_FULL_GLSL = NOISE_HELPERS + `
float fbmW(vec2 p, int octaves, float lacunarity, float gain) {
    float value = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        value += amp * valueNoise(p * freq);
        amp  *= gain;
        freq *= lacunarity;
    }
    return value;
}
vec2 domainWarp(vec2 p, float strength, int octaves, float lacunarity, float gain) {
    vec2 q = vec2(fbmW(p              , octaves, lacunarity, gain),
                  fbmW(p + vec2(5.2, 1.3), octaves, lacunarity, gain));
    return p + strength * q;
}`;

export const DomainWarpNode: NodeDefinition = {
  type: 'domainWarp',
  label: 'Domain Warp',
  category: 'Noise',
  description: 'Domain warp — distorts UV using layered noise. Produces organic swirling, fluid, and marble-like effects when used before SDFs or fractal loops.',
  inputs: {
    uv:        { type: 'vec2',  label: 'UV'        },
    time:      { type: 'float', label: 'Time'      },
    strength:  { type: 'float', label: 'Strength'  },
    scale:     { type: 'float', label: 'Scale'     },
    time_scale:{ type: 'float', label: 'Anim Speed'},
  },
  outputs: {
    uv:     { type: 'vec2', label: 'Warped UV'  },
    offset: { type: 'vec2', label: 'Warp Offset' },
  },
  glslFunction: DOMAIN_WARP_FULL_GLSL,
  defaultParams: { strength: 0.5, scale: 1.0, octaves: 3, lacunarity: 2.0, gain: 0.5, time_scale: 0.0 },
  paramDefs: {
    strength:   { label: 'Strength',   type: 'float', min: 0.0, max: 3.0, step: 0.01 },
    scale:      { label: 'Scale',      type: 'float', min: 0.1, max: 5.0, step: 0.1  },
    octaves:    { label: 'Octaves',    type: 'float', min: 1,   max: 4,   step: 1    },
    lacunarity: { label: 'Lacunarity', type: 'float', min: 1.0, max: 4.0, step: 0.01 },
    gain:       { label: 'Gain',       type: 'float', min: 0.0, max: 1.0, step: 0.01 },
    time_scale: { label: 'Anim Speed', type: 'float', min: 0.0, max: 2.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id        = node.id;
    const uvVar     = inputVars.uv         ?? 'vec2(0.0)';
    const timeVar   = inputVars.time       ?? '0.0';
    const strength  = inputVars.strength   ?? f(typeof node.params.strength   === 'number' ? node.params.strength   : 0.5);
    const scale     = inputVars.scale      ?? f(typeof node.params.scale      === 'number' ? node.params.scale      : 1.0);
    const timeScale = inputVars.time_scale ?? f(typeof node.params.time_scale === 'number' ? node.params.time_scale : 0.0);
    const octaves   = Math.round(typeof node.params.octaves    === 'number' ? node.params.octaves    : 3);
    const lacunarity= f(typeof node.params.lacunarity === 'number' ? node.params.lacunarity : 2.0);
    const gain      = f(typeof node.params.gain       === 'number' ? node.params.gain       : 0.5);
    const warpedVar  = `${id}_uv`;
    const offsetVar  = `${id}_offset`;
    const animUV = parseFloat(timeScale) === 0.0
      ? `${uvVar} * ${scale}`
      : `(${uvVar} + ${timeVar} * ${timeScale} * vec2(0.11, 0.23)) * ${scale}`;
    const code = [
      `    vec2 ${id}_inp = ${animUV};\n`,
      `    vec2 ${warpedVar} = domainWarp(${id}_inp, ${strength}, ${octaves}, ${lacunarity}, ${gain});\n`,
      `    vec2 ${offsetVar} = ${warpedVar} - ${id}_inp;\n`,
    ].join('');
    return {
      code,
      outputVars: { uv: warpedVar, offset: offsetVar },
    };
  },
};

// ─── Flow Field — fake GLSL particle system ───────────────────────────────────

// ─── Flow Field (Tyler Hobbs-style) ──────────────────────────────────────────
//
// Proper grid-of-angles flow field, as described in Hobbs' 2020 essay.
// Each "curve" starts at a deterministic seed and marches N steps through
// the field using the angle stored at the nearest grid cell.
// Per pixel: accumulate soft glow/line contributions from all curve steps.
//
// field_mode controls the angle distortion:
//   perlin    — smooth FBM noise (classic Hobbs)
//   curl      — noise gradient rotated 90°, creates organic swirling loops
//   quantized — angles snapped to multiples of π/steps, rocky/angular forms
//
const FLOW_FIELD_GLSL = NOISE_HELPERS + `
// FBM variant for flow field (avoids name collision with standalone FBMNode)
float fbmFF(vec2 p, int octaves, float lacunarity, float gain) {
    float value = 0.0; float amp = 0.5; float freq = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        value += amp * valueNoise(p * freq);
        amp *= gain; freq *= lacunarity;
    }
    return value;
}

// Flow field angle at position p.
// mode: 0=perlin, 1=curl, 2=quantized
float ffAngle(vec2 p, float scale, float quant, int mode) {
    vec2  sp = p * scale;
    float n  = fbmFF(sp, 4, 2.0, 0.5);
    if (mode == 1) {
        // Curl: take two offset FBM samples and use the gradient perpendicular
        float eps = 0.01;
        float nx  = fbmFF(sp + vec2(eps, 0.0), 4, 2.0, 0.5);
        float ny  = fbmFF(sp + vec2(0.0, eps), 4, 2.0, 0.5);
        // Curl of the noise field = rotate gradient 90 degrees
        return atan((ny - n) / eps, -(nx - n) / eps);
    }
    float angle = n * 6.28318;
    if (mode == 2 && quant > 0.001) {
        // Snap to nearest multiple of quant radians
        angle = round(angle / quant) * quant;
    }
    return angle;
}`;

export const FlowFieldNode: NodeDefinition = {
  type: 'flowField',
  label: 'Flow Field',
  category: 'Presets',
  description: 'Tyler Hobbs-style flow field — curves march step-by-step through a grid of noise-derived angles. field_mode: perlin (smooth), curl (swirling loops), quantized (rocky angular). Adjust curves, steps, and line_width for fur → long fluid strokes.',
  inputs: {
    uv:    { type: 'vec2',  label: 'UV'   },
    time:  { type: 'float', label: 'Time' },
  },
  outputs: {
    color:    { type: 'vec3',  label: 'Color'      },
    density:  { type: 'float', label: 'Density'    },
    uv:       { type: 'vec2',  label: 'UV (pass-through)' },
  },
  glslFunction: FLOW_FIELD_GLSL,
  defaultParams: {
    curves:        60,
    steps:         24,
    step_size:     0.04,
    noise_scale:   1.8,
    speed:         0.15,
    line_width:    0.006,
    line_softness: 1.5,
    field_mode:    'perlin',
    quant_steps:   10,
    palette_offset: 0.0,
    palette_a: [0.5, 0.5, 0.5],
    palette_b: [0.5, 0.5, 0.5],
    palette_c: [1.0, 1.0, 1.0],
    palette_d: [0.0, 0.33, 0.67],
  },
  paramDefs: {
    curves:        { label: 'Curves',        type: 'float',  min: 4,    max: 150,  step: 1     },
    steps:         { label: 'Steps/Curve',   type: 'float',  min: 2,    max: 64,   step: 1     },
    step_size:     { label: 'Step Size',     type: 'float',  min: 0.002,max: 0.15, step: 0.002 },
    noise_scale:   { label: 'Noise Scale',   type: 'float',  min: 0.1,  max: 8.0,  step: 0.05  },
    speed:         { label: 'Anim Speed',    type: 'float',  min: 0.0,  max: 1.0,  step: 0.005 },
    line_width:    { label: 'Line Width',    type: 'float',  min: 0.001,max: 0.05, step: 0.001 },
    line_softness: { label: 'Line Softness', type: 'float',  min: 0.5,  max: 6.0,  step: 0.1   },
    field_mode:    {
      label: 'Field Mode', type: 'select',
      options: [
        { value: 'perlin',    label: 'Perlin (smooth)'   },
        { value: 'curl',      label: 'Curl (loops)'      },
        { value: 'quantized', label: 'Quantized (rocky)' },
      ],
    },
    quant_steps:   { label: 'Quant Steps',   type: 'float',  min: 2,    max: 32,   step: 1     },
    palette_offset:{ label: 'Color Phase',   type: 'float',  min: 0.0,  max: 6.28, step: 0.01  },
    palette_a:     { label: 'Palette A',     type: 'vec3',   min: 0.0,  max: 1.0,  step: 0.01  },
    palette_b:     { label: 'Palette B',     type: 'vec3',   min: 0.0,  max: 1.0,  step: 0.01  },
    palette_c:     { label: 'Palette C',     type: 'vec3',   min: 0.0,  max: 2.0,  step: 0.01  },
    palette_d:     { label: 'Palette D',     type: 'vec3',   min: 0.0,  max: 1.0,  step: 0.01  },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id         = node.id;
    const uvVar      = inputVars.uv   ?? 'vec2(0.0)';
    const timeVar    = inputVars.time ?? '0.0';
    const curves     = Math.round(typeof node.params.curves     === 'number' ? node.params.curves     : 60);
    const steps      = Math.round(typeof node.params.steps      === 'number' ? node.params.steps      : 24);
    const stepSize   = f(typeof node.params.step_size   === 'number' ? node.params.step_size   : 0.04);
    const noiseScale = f(typeof node.params.noise_scale === 'number' ? node.params.noise_scale : 1.8);
    const speed      = f(typeof node.params.speed       === 'number' ? node.params.speed       : 0.15);
    const lineWidth  = f(typeof node.params.line_width  === 'number' ? node.params.line_width  : 0.006);
    const lineSoft   = f(typeof node.params.line_softness === 'number' ? node.params.line_softness : 1.5);
    const fieldMode  = typeof node.params.field_mode === 'string' ? node.params.field_mode : 'perlin';
    const quantN     = Math.max(typeof node.params.quant_steps === 'number' ? node.params.quant_steps : 10, 2);
    const quantAngle = f(Math.PI / quantN);
    const palOff     = f(typeof node.params.palette_offset === 'number' ? node.params.palette_offset : 0.0);
    const pA = Array.isArray(node.params.palette_a) ? node.params.palette_a as number[] : [0.5,0.5,0.5];
    const pB = Array.isArray(node.params.palette_b) ? node.params.palette_b as number[] : [0.5,0.5,0.5];
    const pC = Array.isArray(node.params.palette_c) ? node.params.palette_c as number[] : [1.0,1.0,1.0];
    const pD = Array.isArray(node.params.palette_d) ? node.params.palette_d as number[] : [0.0,0.33,0.67];

    // Map field_mode string to GLSL int constant (baked at compile time)
    const modeInt = fieldMode === 'curl' ? 1 : fieldMode === 'quantized' ? 2 : 0;

    const code = [
      `    vec3  ${id}_color   = vec3(0.0);\n`,
      `    float ${id}_density = 0.0;\n`,
      // Outer loop: one curve per seed
      `    for (int ${id}_ci = 0; ${id}_ci < ${curves}; ${id}_ci++) {\n`,
      `        float ${id}_cf  = float(${id}_ci);\n`,
      // Seed spread across [-1.0, 1.0] using golden-ratio hash (Hobbs: grid or random)
      `        vec2  ${id}_h   = noiseHash2(vec2(${id}_cf * 0.61803, ${id}_cf * 0.38197));\n`,
      `        vec2  ${id}_pos = ${id}_h * 1.2;\n`,
      // Cosine palette colour for this curve (varies by curve index)
      `        float ${id}_ct  = ${id}_cf / float(${curves}) + ${palOff};\n`,
      `        vec3  ${id}_pc  = ${vec3Str(pA)} + ${vec3Str(pB)} * cos(6.28318 * (${vec3Str(pC)} * ${id}_ct + ${vec3Str(pD)}));\n`,
      // Inner loop: march the curve through the field
      `        for (int ${id}_si = 0; ${id}_si < ${steps}; ${id}_si++) {\n`,
      // Look up angle in flow field at current position (+ time drift)
      `            float ${id}_ang = ffAngle(${id}_pos + ${timeVar} * ${speed}, ${noiseScale}, ${quantAngle}, ${modeInt});\n`,
      // Soft line: distance from current UV to this curve step position
      // Uses fwidth for 1-pixel AA regardless of line width
      `            float ${id}_d   = length(${uvVar} - ${id}_pos);\n`,
      `            float ${id}_fw  = fwidth(${id}_d);\n`,
      `            float ${id}_line = smoothstep(${lineWidth} * ${lineSoft} + ${id}_fw, ${lineWidth}, ${id}_d);\n`,
      // Accumulate colour (front-to-back — later steps overwrite with alpha blend)
      `            float ${id}_w   = ${id}_line * (1.0 - float(${id}_si) / float(${steps}) * 0.4);\n`,
      `            ${id}_color   += ${id}_pc * ${id}_w;\n`,
      `            ${id}_density += ${id}_w;\n`,
      // Step: advance position along the field angle
      `            ${id}_pos += vec2(cos(${id}_ang), sin(${id}_ang)) * ${stepSize};\n`,
      `        }\n`,
      `    }\n`,
      `    ${id}_color   = ${id}_color / (${id}_color + vec3(1.0));\n`,  // Reinhard tone map
      `    ${id}_density = clamp(${id}_density, 0.0, 1.0);\n`,
    ].join('');

    return {
      code,
      outputVars: {
        color:   `${id}_color`,
        density: `${id}_density`,
        uv:      uvVar,
      },
    };
  },
};

// ─── Circle Pack ──────────────────────────────────────────────────────────────
//
// Deterministic circle packing via hash-based placement + collision checking,
// based on Tyler Hobbs' brute-force approach (2016 essay).
//
// For each of N circles, a candidate center is generated from a hash of the
// circle index. Radii vary across configurable size tiers. A soft gradient
// fill makes each circle denser at the centre, dispersing at the edge —
// exactly as probability clouds do in nature.
//
// circle_mode controls what fills the circles:
//   flat      — solid cosine-palette color
//   gradient  — radial gradient from center colour outward
//   ring      — hollow rings (stroke only)
//   noise     — FBM texture fill
//
export const CirclePackNode: NodeDefinition = {
  type: 'circlePack',
  label: 'Circle Pack',
  category: 'Presets',
  description: 'Tyler Hobbs-style brute-force circle packing. Hash-placed circles with collision avoidance. circle_mode: flat, gradient (radial falloff), ring (stroke), or noise-filled. Great as a standalone design or as starting positions for a Flow Field.',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV'   },
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    color:    { type: 'vec3',  label: 'Color'    },
    mask:     { type: 'float', label: 'Mask'     },
    centers:  { type: 'vec2',  label: 'Nearest Centre' },
    uv:       { type: 'vec2',  label: 'UV (pass-through)' },
  },
  glslFunction: NOISE_HELPERS,   // reuses noiseHash1/noiseHash2/valueNoise
  defaultParams: {
    circles:       80,
    min_radius:    0.03,
    max_radius:    0.15,
    padding:       0.01,
    circle_mode:   'gradient',
    edge_softness: 1.0,
    animate:       0.0,
    palette_offset: 0.0,
    palette_a: [0.5, 0.5, 0.5],
    palette_b: [0.5, 0.5, 0.5],
    palette_c: [1.0, 1.0, 1.0],
    palette_d: [0.0, 0.33, 0.67],
  },
  paramDefs: {
    circles:       { label: 'Circles',       type: 'float',  min: 4,    max: 200,  step: 1     },
    min_radius:    { label: 'Min Radius',    type: 'float',  min: 0.005,max: 0.3,  step: 0.005 },
    max_radius:    { label: 'Max Radius',    type: 'float',  min: 0.01, max: 0.5,  step: 0.005 },
    padding:       { label: 'Padding',       type: 'float',  min: 0.0,  max: 0.1,  step: 0.002 },
    circle_mode:   {
      label: 'Circle Mode', type: 'select',
      options: [
        { value: 'flat',     label: 'Flat (solid)'        },
        { value: 'gradient', label: 'Gradient (radial)'   },
        { value: 'ring',     label: 'Ring (stroke)'       },
        { value: 'noise',    label: 'Noise fill'          },
      ],
    },
    edge_softness: { label: 'Edge Softness', type: 'float',  min: 0.1,  max: 6.0,  step: 0.1   },
    animate:       { label: 'Pulse Speed',   type: 'float',  min: 0.0,  max: 2.0,  step: 0.05  },
    palette_offset:{ label: 'Color Phase',   type: 'float',  min: 0.0,  max: 6.28, step: 0.01  },
    palette_a:     { label: 'Palette A',     type: 'vec3',   min: 0.0,  max: 1.0,  step: 0.01  },
    palette_b:     { label: 'Palette B',     type: 'vec3',   min: 0.0,  max: 1.0,  step: 0.01  },
    palette_c:     { label: 'Palette C',     type: 'vec3',   min: 0.0,  max: 2.0,  step: 0.01  },
    palette_d:     { label: 'Palette D',     type: 'vec3',   min: 0.0,  max: 1.0,  step: 0.01  },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id         = node.id;
    const uvVar      = inputVars.uv   ?? 'vec2(0.0)';
    const timeVar    = inputVars.time ?? '0.0';
    const circles    = Math.round(typeof node.params.circles    === 'number' ? node.params.circles    : 80);
    const minR       = f(typeof node.params.min_radius  === 'number' ? node.params.min_radius  : 0.03);
    const maxR       = f(typeof node.params.max_radius  === 'number' ? node.params.max_radius  : 0.15);
    const padding    = f(typeof node.params.padding     === 'number' ? node.params.padding     : 0.01);
    const circMode   = typeof node.params.circle_mode === 'string' ? node.params.circle_mode : 'gradient';
    const edgeSoft   = f(typeof node.params.edge_softness === 'number' ? node.params.edge_softness : 1.0);
    const animate    = f(typeof node.params.animate     === 'number' ? node.params.animate     : 0.0);
    const palOff     = f(typeof node.params.palette_offset === 'number' ? node.params.palette_offset : 0.0);
    const pA = Array.isArray(node.params.palette_a) ? node.params.palette_a as number[] : [0.5,0.5,0.5];
    const pB = Array.isArray(node.params.palette_b) ? node.params.palette_b as number[] : [0.5,0.5,0.5];
    const pC = Array.isArray(node.params.palette_c) ? node.params.palette_c as number[] : [1.0,1.0,1.0];
    const pD = Array.isArray(node.params.palette_d) ? node.params.palette_d as number[] : [0.0,0.33,0.67];

    // Bake mode as integer constant
    const modeInt = circMode === 'ring' ? 2 : circMode === 'flat' ? 0 : circMode === 'noise' ? 3 : 1;

    const code = [
      `    vec3  ${id}_color   = vec3(0.0);\n`,
      `    float ${id}_mask    = 0.0;\n`,
      `    vec2  ${id}_nearest = vec2(0.0);\n`,
      `    float ${id}_nearD   = 99999.0;\n`,
      `    float ${id}_radRange = ${maxR} - ${minR};\n`,
      // Loop over each circle
      `    for (int ${id}_ci = 0; ${id}_ci < ${circles}; ${id}_ci++) {\n`,
      `        float ${id}_cf = float(${id}_ci);\n`,
      // Deterministic center from hash (spread over [-0.9, 0.9])
      `        vec2  ${id}_hc  = noiseHash2(vec2(${id}_cf * 0.31415, ${id}_cf * 0.27182)) * 0.9;\n`,
      // Radius: interpolate between min and max using a second hash
      `        float ${id}_hr  = noiseHash1(vec2(${id}_cf * 0.57721, ${id}_cf * 0.41421));\n`,
      `        float ${id}_r   = ${minR} + ${id}_hr * ${id}_radRange;\n`,
      // Animate: pulse radius with time (when animate > 0)
      ...(parseFloat(animate) > 0.0 ? [
        `        ${id}_r += sin(${timeVar} * ${animate} + ${id}_cf * 0.91) * ${id}_r * 0.15;\n`,
      ] : []),
      // Collision check: skip this circle if it overlaps any earlier circle
      // (approximate Hobbs brute-force — checks first min(ci, MAX_CHECK) circles)
      `        bool  ${id}_ok  = true;\n`,
      `        for (int ${id}_cj = 0; ${id}_cj < ${circles}; ${id}_cj++) {\n`,
      `            if (${id}_cj >= ${id}_ci) break;\n`,
      `            float ${id}_cf2 = float(${id}_cj);\n`,
      `            vec2  ${id}_hc2 = noiseHash2(vec2(${id}_cf2 * 0.31415, ${id}_cf2 * 0.27182)) * 0.9;\n`,
      `            float ${id}_hr2 = noiseHash1(vec2(${id}_cf2 * 0.57721, ${id}_cf2 * 0.41421));\n`,
      `            float ${id}_r2  = ${minR} + ${id}_hr2 * ${id}_radRange;\n`,
      `            if (length(${id}_hc - ${id}_hc2) < ${id}_r + ${id}_r2 + ${padding}) { ${id}_ok = false; break; }\n`,
      `        }\n`,
      `        if (!${id}_ok) continue;\n`,
      // Distance from current pixel to this circle's center
      `        float ${id}_d   = length(${uvVar} - ${id}_hc);\n`,
      // Track nearest circle centre for output
      `        if (${id}_d < ${id}_nearD) { ${id}_nearD = ${id}_d; ${id}_nearest = ${id}_hc; }\n`,
      // Cosine palette colour for this circle
      `        float ${id}_ct  = ${id}_cf / float(${circles}) + ${palOff};\n`,
      `        vec3  ${id}_pc  = ${vec3Str(pA)} + ${vec3Str(pB)} * cos(6.28318 * (${vec3Str(pC)} * ${id}_ct + ${vec3Str(pD)}));\n`,
      // Fill based on circle_mode
      `        float ${id}_fill = 0.0;\n`,
      // mode 0: flat — hard disc with 1px AA
      ...(modeInt === 0 ? [
        `        float ${id}_fw = fwidth(${id}_d);\n`,
        `        ${id}_fill = smoothstep(${id}_r + ${id}_fw, ${id}_r - ${id}_fw, ${id}_d);\n`,
      ] : []),
      // mode 1: gradient — radial falloff, dense centre, disperses at edge
      ...(modeInt === 1 ? [
        `        float ${id}_t  = clamp(${id}_d / ${id}_r, 0.0, 1.0);\n`,
        // Gaussian-ish falloff: 1 at centre, 0 at edge — with hash-noise fringe
        `        float ${id}_en = fract(sin(dot(${uvVar} * 31.4, vec2(127.1, 311.7))) * 43758.5453);\n`,
        `        float ${id}_tn = ${id}_t * (1.0 + ${id}_en * 0.3 * ${edgeSoft});\n`,
        `        ${id}_fill = exp(-${id}_tn * ${id}_tn * ${edgeSoft} * 4.0);\n`,
      ] : []),
      // mode 2: ring — SDF stroke at radius with soft edge
      ...(modeInt === 2 ? [
        `        float ${id}_fw = fwidth(${id}_d);\n`,
        `        float ${id}_rw = ${id}_r * 0.08;\n`,
        `        ${id}_fill = smoothstep(${id}_rw + ${id}_fw, 0.0, abs(${id}_d - ${id}_r));\n`,
      ] : []),
      // mode 3: noise fill — FBM texture masked to disc
      ...(modeInt === 3 ? [
        `        float ${id}_fw = fwidth(${id}_d);\n`,
        `        float ${id}_disc = smoothstep(${id}_r + ${id}_fw, ${id}_r - ${id}_fw, ${id}_d);\n`,
        `        float ${id}_nf = valueNoise((${uvVar} - ${id}_hc) * 6.0 + ${timeVar} * ${animate}) * 0.5 + 0.5;\n`,
        `        ${id}_fill = ${id}_disc * ${id}_nf;\n`,
      ] : []),
      `        ${id}_color  += ${id}_pc * ${id}_fill;\n`,
      `        ${id}_mask   += ${id}_fill;\n`,
      `    }\n`,
      `    ${id}_color  = ${id}_color / (${id}_color + vec3(1.0));\n`,  // Reinhard
      `    ${id}_mask   = clamp(${id}_mask, 0.0, 1.0);\n`,
    ].join('');

    return {
      code,
      outputVars: {
        color:   `${id}_color`,
        mask:    `${id}_mask`,
        centers: `${id}_nearest`,
        uv:      uvVar,
      },
    };
  },
};
