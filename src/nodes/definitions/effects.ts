import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f, p, vec3Str } from './helpers';
import { PALETTE_GLSL_FN } from './color';

export const MakeLightNode: NodeDefinition = {
  type: 'makeLight',
  label: 'Make Light',
  category: 'Effects',
  description: 'Convert an SDF distance to a glow value using exp falloff',
  inputs: {
    distance: { type: 'float', label: 'Distance' },
    brightness: { type: 'float', label: 'Brightness' },
  },
  outputs: {
    glow: { type: 'float', label: 'Glow' },
  },
  defaultParams: { brightness: 10.0 },
  paramDefs: {
    brightness: { label: 'Brightness', type: 'float', min: 0.1, max: 100, step: 0.1 },
  },
  glslFunction: `
float make_light(float dist, float brightness) {
    brightness = clamp(brightness, 0.1, 100.0);
    return exp(-brightness * dist);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_glow`;
    const distVar = inputVars.distance || '0.0';
    const brightVar = inputVars.brightness || p(node.params.brightness, 10.0);
    return {
      code: `    float ${outVar} = make_light(${distVar}, ${brightVar});\n`,
      outputVars: { glow: outVar },
    };
  },
};

export const AbsNode: NodeDefinition = {
  type: 'abs',
  label: 'Abs',
  category: 'Math',
  description: 'Absolute value of a float',
  inputs: {
    input: { type: 'float', label: 'Input' },
  },
  outputs: {
    output: { type: 'float', label: 'Output' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_output`;
    const inVar = inputVars.input || '0.0';
    return {
      code: `    float ${outVar} = abs(${inVar});\n`,
      outputVars: { output: outVar },
    };
  },
};

export const ToneMapNode: NodeDefinition = {
  type: 'toneMap',
  label: 'Tone Map',
  category: 'Effects',
  description: 'Apply tone mapping to a vec3 color. ACES, Hable, Unreal, Tanh, Reinhard2, Lottes, Uchimura, AgX.',
  inputs: {
    color: { type: 'vec3', label: 'Color' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
  },
  defaultParams: { mode: 'aces' },
  paramDefs: {
    mode: {
      label: 'Mode', type: 'select',
      options: [
        { value: 'aces',       label: 'ACES'       },
        { value: 'hable',      label: 'Hable'      },
        { value: 'unreal',     label: 'Unreal'     },
        { value: 'tanh',       label: 'Tanh'       },
        { value: 'reinhard2',  label: 'Reinhard2'  },
        { value: 'lottes',     label: 'Lottes'     },
        { value: 'uchimura',   label: 'Uchimura'   },
        { value: 'agx',        label: 'AgX'        },
      ],
    },
  },
  glslFunction: `vec3 toneACES(vec3 c) {
  return clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14), 0.0, 1.0);
}
vec3 toneHable(vec3 x) {
  x *= 16.0;
  float A=0.15,B=0.5,C=0.1,D=0.2,E=0.02,F=0.3;
  return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;
}
vec3 toneUnreal(vec3 c) { return c/(c+0.155)*1.019; }
vec3 toneTanh(vec3 c) {
  c = clamp(c, -40.0, 40.0);
  vec3 e = exp(c); vec3 em = exp(-c);
  return (e-em)/(e+em);
}
vec3 toneReinhard2(vec3 c) {
  float Lw = 4.0;
  return (c * (1.0 + c / (Lw * Lw))) / (1.0 + c);
}
float _lottesF(float x) {
  float a=1.6, d=0.977, hdrMax=8.0, midIn=0.18, midOut=0.267;
  float b = (-pow(midIn,a) + pow(hdrMax,a)*midOut) / ((pow(hdrMax,a)-pow(midIn,a))*midOut);
  float c2 = (pow(hdrMax,a*d)*(-pow(midIn,a)) + pow(hdrMax,a)*pow(midIn,a*d)*midOut) /
             ((pow(hdrMax,a*d)-pow(midIn,a*d))*midOut);
  return pow(x,a) / (pow(x,a*d)*b + c2);
}
vec3 toneLottes(vec3 c) {
  return clamp(vec3(_lottesF(c.r),_lottesF(c.g),_lottesF(c.b)), 0.0, 1.0);
}
float _uchi(float x) {
  float P=1.0,a=1.0,m=0.22,l=0.4,c2=1.33,b=0.0;
  float l0=(P-m)*l/a, S0=m+l0, S1=m+a*l0;
  float C2=a*P/(P-S1), CP=-C2/P;
  float w0=1.0-smoothstep(0.0,m,x);
  float w2=step(S0,x);
  float w1=1.0-w0-w2;
  float T=m*pow(max(x/m,0.0001),c2)+b;
  float S=P-(P-S1)*exp(CP*(x-S0));
  float L=m+a*(x-m);
  return T*w0+L*w1+S*w2;
}
vec3 toneUchimura(vec3 c) {
  return clamp(vec3(_uchi(c.r),_uchi(c.g),_uchi(c.b)), 0.0, 1.0);
}
vec3 toneAgX(vec3 c) {
  c = mat3(0.84248,0.04233,0.04238, 0.07843,0.87847,0.07843, 0.07922,0.07917,0.87914) * c;
  c = clamp(c, 0.000061, 256.0);
  c = (log2(c) - log2(0.000061)) / (log2(256.0) - log2(0.000061));
  c = clamp(c, 0.0, 1.0);
  return clamp(c*(c*(c*(1.67*c - 4.0)+4.33)), 0.0, 1.0);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const colorVar = inputVars.color ?? 'vec3(0.0)';
    const mode = (node.params.mode as string) ?? 'aces';
    const fnMap: Record<string, string> = {
      aces: 'toneACES', hable: 'toneHable', unreal: 'toneUnreal', tanh: 'toneTanh',
      reinhard2: 'toneReinhard2', lottes: 'toneLottes', uchimura: 'toneUchimura', agx: 'toneAgX',
    };
    const fn = fnMap[mode] ?? 'toneACES';
    const outVar = `${node.id}_color`;
    return {
      code: `    vec3 ${outVar} = ${fn}(${colorVar});\n`,
      outputVars: { color: outVar },
    };
  },
};

export const GrainNode: NodeDefinition = {
  type: 'grain',
  label: 'Grain',
  category: 'Effects',
  description: 'Film grain. Basic: uniform RGB noise. Luma: more grain in shadows. Temporal: pattern animates each frame (wire Time). Scale < 1 = coarser grain, Scale > 1 = finer.',
  inputs: {
    color: { type: 'vec3',  label: 'Color' },
    uv:    { type: 'vec2',  label: 'UV'    },
    seed:  { type: 'float', label: 'Seed'  },
    time:  { type: 'float', label: 'Time'  },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
  },
  defaultParams: { mode: 'basic', amount: 0.05, scale: 1.0, seed: 0.0 },
  paramDefs: {
    mode: {
      label: 'Mode', type: 'select',
      options: [
        { value: 'basic',    label: 'Basic'    },
        { value: 'luma',     label: 'Luma'     },
        { value: 'temporal', label: 'Temporal' },
      ],
    },
    amount: { label: 'Amount', type: 'float', min: 0.0, max: 0.5, step: 0.005 },
    scale:  { label: 'Scale',  type: 'float', min: 0.1, max: 8.0, step: 0.05  },
    seed:   { label: 'Seed',   type: 'float', min: 0.0, max: 1.0, step: 0.01  },
  },
  glslFunction: `float _grainH(vec2 n) {
  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}
vec3 grainBasic(vec3 color, vec2 uv, float amount, float scale, float seed) {
  vec2 s = uv * scale;
  return clamp(color + vec3(
    mix(-amount, amount, fract(seed + _grainH(s * 1234.5678))),
    mix(-amount, amount, fract(seed + _grainH(s * 876.5432))),
    mix(-amount, amount, fract(seed + _grainH(s * 3214.5678)))
  ), 0.0, 1.0);
}
vec3 grainLuma(vec3 color, vec2 uv, float amount, float scale, float seed) {
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  float w = 1.0 - luma;
  vec2 s = uv * scale;
  float n = fract(sin(dot(s * 1234.5678 + seed, vec2(12.9898, 78.233))) * 43758.5453);
  return clamp(color + vec3(mix(-amount, amount, n) * w), 0.0, 1.0);
}
vec3 grainTemporal(vec3 color, vec2 uv, float amount, float scale, float time) {
  vec2 s = uv * scale + fract(time * 0.123456);
  float n = fract(sin(dot(s, vec2(127.1, 311.7))) * 43758.5453);
  return clamp(color + vec3(mix(-amount, amount, n)), 0.0, 1.0);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const mode     = (node.params.mode as string) ?? 'basic';
    const colorVar = inputVars.color ?? 'vec3(0.0)';
    const uvVar    = inputVars.uv    ?? 'vec2(0.0)';
    const amount   = p(node.params.amount, 0.05);
    const scale    = p(node.params.scale,  1.0);
    const seed     = inputVars.seed ?? p(node.params.seed, 0.0);
    const timeVar  = inputVars.time ?? 'iTime';
    const fnMap: Record<string, string> = {
      basic:    `grainBasic(${colorVar}, ${uvVar}, ${amount}, ${scale}, ${seed})`,
      luma:     `grainLuma(${colorVar}, ${uvVar}, ${amount}, ${scale}, ${seed})`,
      temporal: `grainTemporal(${colorVar}, ${uvVar}, ${amount}, ${scale}, ${timeVar})`,
    };
    return {
      code: `    vec3 ${id}_color = ${fnMap[mode] ?? fnMap.basic};\n`,
      outputVars: { color: `${id}_color` },
    };
  },
};

// ─── Legacy grain variants (hidden from palette, kept for backward compat) ────

export const LumaGrainNode: NodeDefinition = {
  type: 'lumaGrain', label: 'Luma Grain', category: 'Effects',
  description: 'Legacy — use Grain node (Luma mode) instead.',
  inputs: { color: { type: 'vec3', label: 'Color' }, uv: { type: 'vec2', label: 'UV' }, seed: { type: 'float', label: 'Seed' } },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { amount: 0.06, seed: 0.0 },
  paramDefs: { amount: { label: 'Amount', type: 'float', min: 0.0, max: 0.5, step: 0.005 }, seed: { label: 'Seed', type: 'float', min: 0.0, max: 1.0, step: 0.01 } },
  glslFunction: `vec3 applyLumaGrain(vec3 color, vec2 uv, float amount, float seed) {
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  float w = 1.0 - luma;
  float n = fract(sin(dot(uv * 1234.5678 + seed, vec2(12.9898, 78.233))) * 43758.5453);
  return clamp(color + vec3(mix(-amount, amount, n) * w), 0.0, 1.0);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    return { code: `    vec3 ${id}_color = applyLumaGrain(${inputVars.color ?? 'vec3(0.0)'}, ${inputVars.uv ?? 'vec2(0.0)'}, ${p(node.params.amount, 0.06)}, ${inputVars.seed ?? p(node.params.seed, 0.0)});\n`, outputVars: { color: `${id}_color` } };
  },
};

export const TemporalGrainNode: NodeDefinition = {
  type: 'temporalGrain', label: 'Temporal Grain', category: 'Effects',
  description: 'Legacy — use Grain node (Temporal mode) instead.',
  inputs: { color: { type: 'vec3', label: 'Color' }, uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' } },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { amount: 0.05 },
  paramDefs: { amount: { label: 'Amount', type: 'float', min: 0.0, max: 0.5, step: 0.005 } },
  glslFunction: `vec3 applyTemporalGrain(vec3 color, vec2 uv, float amount, float time) {
  vec2 uvt = uv + fract(time * 0.123456);
  float n = fract(sin(dot(uvt, vec2(127.1, 311.7))) * 43758.5453);
  return clamp(color + vec3(mix(-amount, amount, n)), 0.0, 1.0);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    return { code: `    vec3 ${id}_color = applyTemporalGrain(${inputVars.color ?? 'vec3(0.0)'}, ${inputVars.uv ?? 'vec2(0.0)'}, ${p(node.params.amount, 0.05)}, ${inputVars.time ?? 'iTime'});\n`, outputVars: { color: `${id}_color` } };
  },
};

export const LightNode: NodeDefinition = {
  type: 'light',
  label: 'Light',
  category: 'Effects',
  description: 'Convert SDF distance to glow. Mode: Glow (exp), Ring (ring_light), Simple (1/d).',
  inputs: {
    distance:   { type: 'float', label: 'Distance'   },
    brightness: { type: 'float', label: 'Brightness' },
  },
  outputs: {
    glow: { type: 'float', label: 'Glow' },
  },
  defaultParams: { mode: 'glow', brightness: 10.0, ringFreq: 8.0 },
  paramDefs: {
    mode: {
      label: 'Mode', type: 'select',
      options: [
        { value: 'glow',   label: 'Glow (exp)'   },
        { value: 'ring',   label: 'Ring Light'    },
        { value: 'simple', label: 'Simple (1/d)'  },
      ],
    },
    brightness: { label: 'Brightness', type: 'float', min: 0.1, max: 100, step: 0.1 },
    ringFreq:   { label: 'Ring Freq',  type: 'float', min: 1.0, max: 30,  step: 0.5 },
  },
  glslFunction: `float ringLight(float d, float brightness, float freq) {
  float ring = abs(sin(d * freq));
  return exp(-brightness * ring * d);
}
float simpleLight(float d, float brightness) {
  return brightness * 0.01 / max(abs(d), 0.0001);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar   = `${node.id}_glow`;
    const distVar  = inputVars.distance   ?? '0.0';
    const brightVar = inputVars.brightness ?? p(node.params.brightness, 10.0);
    const mode     = (node.params.mode as string) ?? 'glow';
    const ringFreq = p(node.params.ringFreq, 8.0);

    let code: string;
    if (mode === 'ring') {
      code = `    float ${outVar} = ringLight(${distVar}, ${brightVar}, ${ringFreq});\n`;
    } else if (mode === 'simple') {
      code = `    float ${outVar} = simpleLight(${distVar}, ${brightVar});\n`;
    } else {
      code = `    float ${outVar} = exp(-${brightVar} * max(${distVar}, 0.0));\n`;
    }
    return { code, outputVars: { glow: outVar } };
  },
};

export const FractalLoopNode: NodeDefinition = {
  type: 'fractalLoop',
  label: 'Fractal Loop',
  category: 'Fractals',
  description: 'IQ-style iterated fractal with built-in palette. Each iteration tiles UV and accumulates glowing rings.',
  inputs: {
    uv:          { type: 'vec2',  label: 'UV'           },
    time:        { type: 'float', label: 'Time'         },
    fract_scale: { type: 'float', label: 'Tile Scale'   },
    scale_exp:   { type: 'float', label: 'Scale Growth' },
    ring_freq:   { type: 'float', label: 'Ring Freq'    },
    glow:        { type: 'float', label: 'Glow'         },
    glow_pow:    { type: 'float', label: 'Glow Power'   },
    iter_offset: { type: 'float', label: 'Layer Offset' },
    time_scale:  { type: 'float', label: 'Anim Speed'   },
  },
  outputs: {
    color:    { type: 'vec3', label: 'Color'    },
    uv_final: { type: 'vec2', label: 'UV Final' },
    uv0:      { type: 'vec2', label: 'UV0'      },
  },
  glslFunction: PALETTE_GLSL_FN,
  defaultParams: {
    iterations:  4,
    fract_scale: 1.5,
    scale_exp:   1.0,
    ring_freq:   8.0,
    glow:        0.01,
    glow_pow:    1.0,
    iter_offset: 0.4,
    time_scale:  0.4,
    offset:    [0.5,  0.5,  0.5 ],
    amplitude: [0.5,  0.5,  0.5 ],
    freq:      [1.0,  1.0,  1.0 ],
    phase:     [0.0,  0.33, 0.67],
  },
  paramDefs: {
    iterations:  { label: 'Iterations',   type: 'float', min: 1,     max: 8,    step: 1     },
    fract_scale: { label: 'Tile Scale',   type: 'float', min: 0.01,  max: 10.0, step: 0.01  },
    scale_exp:   { label: 'Scale Growth', type: 'float', min: 0.0,   max: 2.0,  step: 0.01  },
    ring_freq:   { label: 'Ring Freq',    type: 'float', min: 1.0,   max: 20.0, step: 0.1   },
    glow:        { label: 'Glow',         type: 'float', min: 0.001, max: 0.1,  step: 0.001 },
    glow_pow:    { label: 'Glow Power',   type: 'float', min: 0.5,   max: 5.0,  step: 0.1   },
    iter_offset: { label: 'Layer Offset', type: 'float', min: 0.0,   max: 1.0,  step: 0.01  },
    time_scale:  { label: 'Anim Speed',   type: 'float', min: 0.0,   max: 2.0,  step: 0.01  },
    offset:    { label: 'Offset',    type: 'vec3', min: 0.0, max: 1.0, step: 0.01 },
    amplitude: { label: 'Amplitude', type: 'vec3', min: 0.0, max: 1.0, step: 0.01 },
    freq:      { label: 'Freq',      type: 'vec3', min: 0.0, max: 2.0, step: 0.01 },
    phase:     { label: 'Phase',     type: 'vec3', min: 0.0, max: 1.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id        = node.id;
    const uvVar     = inputVars.uv   || 'vec2(0.0)';
    const timeVar   = inputVars.time || '0.0';
    const iters     = Math.round(typeof node.params.iterations  === 'number' ? node.params.iterations  : 4);
    const scale     = inputVars.fract_scale ?? p(node.params.fract_scale, 1.5);
    const scaleExp  = inputVars.scale_exp   ?? p(node.params.scale_exp, 1.0);
    const freq      = inputVars.ring_freq   ?? p(node.params.ring_freq, 8.0);
    const glow      = inputVars.glow        ?? p(node.params.glow, 0.01);
    const glowPow   = inputVars.glow_pow    ?? p(node.params.glow_pow, 1.0);
    const iterOff   = inputVars.iter_offset ?? p(node.params.iter_offset, 0.4);
    const timeScale = inputVars.time_scale  ?? p(node.params.time_scale, 0.4);
    const a = Array.isArray(node.params.offset)    ? node.params.offset    as number[] : [0.5, 0.5, 0.5];
    const b = Array.isArray(node.params.amplitude) ? node.params.amplitude as number[] : [0.5, 0.5, 0.5];
    const c = Array.isArray(node.params.freq)      ? node.params.freq      as number[] : [1.0, 1.0, 1.0];
    const d = Array.isArray(node.params.phase)     ? node.params.phase     as number[] : [0.0, 0.33, 0.67];
    const scaleExpr = (scaleExp === '1.0' || scaleExp === '1') ? scale : `(${scale} * pow(${scaleExp}, ${id}_i))`;
    const glowExpr = (glowPow === '1.0' || glowPow === '1')
      ? `${glow} / max(${id}_d, 0.0001)`
      : `pow(${glow} / max(${id}_d, 0.0001), ${glowPow})`;
    const code = [
      `    vec2 ${id}_uv0 = ${uvVar};\n`,
      `    vec2 ${id}_uv = ${uvVar};\n`,
      `    vec3 ${id}_color = vec3(0.0);\n`,
      `    for (float ${id}_i = 0.0; ${id}_i < ${iters}.0; ${id}_i++) {\n`,
      `        ${id}_uv = fract(${id}_uv * ${scaleExpr}) - 0.5;\n`,
      `        float ${id}_d = length(${id}_uv) * exp(-length(${id}_uv0));\n`,
      `        float ${id}_t = length(${id}_uv0) + ${id}_i * ${iterOff} + ${timeVar} * ${timeScale};\n`,
      `        vec3 ${id}_col = palette(${id}_t, ${vec3Str(a)}, ${vec3Str(b)}, ${vec3Str(c)}, ${vec3Str(d)});\n`,
      `        ${id}_d = sin(${id}_d * ${freq} + ${timeVar}) / ${freq};\n`,
      `        ${id}_d = abs(${id}_d);\n`,
      `        ${id}_d = ${glowExpr};\n`,
      `        ${id}_color += ${id}_col * ${id}_d;\n`,
      `    }\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_color`, uv_final: `${id}_uv`, uv0: `${id}_uv0` } };
  },
};

export const RotatingLinesLoopNode: NodeDefinition = {
  type: 'rotatingLinesLoop',
  label: 'Rotating Lines',
  category: 'Fractals',
  description: 'Iterated rotating box/line glow. Each layer builds a pseudo-random mat2 from cosines, tiles rotated space, and accumulates glowing horizontal stripes with an RGBA cosine palette.',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV (Pixel)'  },
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    color: { type: 'vec4', label: 'Color (RGBA)' },
    uv:    { type: 'vec2', label: 'UV (pass-through)' },
  },
  defaultParams: {
    iterations: 20, uv_scale: 0.1, scroll_y: 0.2, box_half_y: 0.2,
    glow: 0.001, color_freq: 0.1,
    phase_r: 0.0, phase_g: 1.0, phase_b: 2.0, phase_a: 3.0,
    rot_offset_1: 33.0, rot_offset_2: 11.0,
  },
  paramDefs: {
    iterations:   { label: 'Iterations',   type: 'float', min: 2,      max: 40,   step: 1     },
    uv_scale:     { label: 'UV Scale',     type: 'float', min: 0.01,   max: 1.0,  step: 0.01  },
    scroll_y:     { label: 'Scroll Y',     type: 'float', min: 0.0,    max: 2.0,  step: 0.01  },
    box_half_y:   { label: 'Box Height',   type: 'float', min: 0.01,   max: 1.0,  step: 0.01  },
    glow:         { label: 'Glow',         type: 'float', min: 0.0001, max: 0.01, step: 0.0001 },
    color_freq:   { label: 'Color Freq',   type: 'float', min: 0.01,   max: 1.0,  step: 0.01  },
    phase_r:      { label: 'Phase R',      type: 'float', min: 0.0,    max: 6.28, step: 0.01  },
    phase_g:      { label: 'Phase G',      type: 'float', min: 0.0,    max: 6.28, step: 0.01  },
    phase_b:      { label: 'Phase B',      type: 'float', min: 0.0,    max: 6.28, step: 0.01  },
    phase_a:      { label: 'Phase A',      type: 'float', min: 0.0,    max: 6.28, step: 0.01  },
    rot_offset_1: { label: 'Rot Offset 1', type: 'float', min: 0.0,    max: 60.0, step: 0.1   },
    rot_offset_2: { label: 'Rot Offset 2', type: 'float', min: 0.0,    max: 60.0, step: 0.1   },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uvVar    = inputVars.uv   || 'vec2(0.0)';
    const timeVar  = inputVars.time || '0.0';
    const iters    = Math.round(typeof node.params.iterations   === 'number' ? node.params.iterations   : 20);
    const uvScale  = p(node.params.uv_scale, 0.1);
    const scrollY  = p(node.params.scroll_y, 0.2);
    const boxHalfY = p(node.params.box_half_y, 0.2);
    const glow     = p(node.params.glow, 0.001);
    const cFreq    = p(node.params.color_freq, 0.1);
    const pR       = p(node.params.phase_r, 0.0);
    const pG       = p(node.params.phase_g, 1.0);
    const pB       = p(node.params.phase_b, 2.0);
    const pA       = p(node.params.phase_a, 3.0);
    const rot1     = p(node.params.rot_offset_1, 33.0);
    const rot2     = p(node.params.rot_offset_2, 11.0);
    const code = [
      `    vec4 ${id}_color = vec4(0.0);\n`,
      `    vec2 ${id}_b = vec2(0.0, ${boxHalfY});\n`,
      `    vec2 ${id}_p;\n`,
      `    mat2 ${id}_R;\n`,
      `    for (float ${id}_i = 0.9; ${id}_i++ < ${iters}.0;) {\n`,
      `        ${id}_R = mat2(cos(${id}_i), cos(${id}_i + ${rot1}), cos(${id}_i + ${rot2}), cos(${id}_i));\n`,
      `        vec2 ${id}_uv = fract((${uvVar} * ${id}_i * ${uvScale} + ${timeVar} * vec2(0.0, ${scrollY})) * ${id}_R) - 0.5;\n`,
      `        ${id}_p = ${id}_uv * ${id}_R;\n`,
      `        float ${id}_d = length(clamp(${id}_p, -${id}_b, ${id}_b) - ${id}_p);\n`,
      `        ${id}_color += ${glow} / max(${id}_d, 0.00001) * (cos(${id}_p.y / ${cFreq} + vec4(${pR}, ${pG}, ${pB}, ${pA})) + 1.0);\n`,
      `    }\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_color`, uv: uvVar } };
  },
};

export const AccumulateLoopNode: NodeDefinition = {
  type: 'accumulateLoop',
  label: 'Accumulate Loop',
  category: 'Fractals',
  description: 'General iterated accumulation loop. Configure position, distance, attenuation, color and tonemap modes to create stars, orbs, arc rings, plasma, and more.',
  inputs: {
    uv:        { type: 'vec2',  label: 'UV'        },
    time:      { type: 'float', label: 'Time'      },
    freq:      { type: 'float', label: 'UV Freq'   },
    glow:      { type: 'float', label: 'Glow'      },
    time_scale:{ type: 'float', label: 'Time Scale'},
    pos_scale: { type: 'float', label: 'Pos Scale' },
    pos_freq:  { type: 'float', label: 'Pos Freq'  },
    pos_phase: { type: 'float', label: 'Pos Phase' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    uv:    { type: 'vec2', label: 'UV (pass-through)' },
  },
  defaultParams: {
    iterations: 50, time_scale: 0.2, freq: 60.0, glow: 0.0003,
    color_phase_r: 0.0, color_phase_g: 2.0, color_phase_b: 4.0,
    pos_scale: 0.05, pos_freq: 0.31, pos_phase: 5.0, arc_freq: 1.0,
    position_mode: 'sinusoidal', distance_mode: 'circle',
    atten_mode: 'inverse', color_mode: 'cos_vec3', tonemap_mode: 'tanh_sq',
  },
  paramDefs: {
    iterations:    { label: 'Iterations',   type: 'float',  min: 5,       max: 200,  step: 1      },
    time_scale:    { label: 'Time Scale',   type: 'float',  min: 0.0,     max: 2.0,  step: 0.01   },
    freq:          { label: 'UV Freq',      type: 'float',  min: 1.0,     max: 200,  step: 1.0    },
    glow:          { label: 'Glow',         type: 'float',  min: 0.00001, max: 0.01, step: 0.00001 },
    color_phase_r: { label: 'Phase R',      type: 'float',  min: 0.0,     max: 6.28, step: 0.01   },
    color_phase_g: { label: 'Phase G',      type: 'float',  min: 0.0,     max: 6.28, step: 0.01   },
    color_phase_b: { label: 'Phase B',      type: 'float',  min: 0.0,     max: 6.28, step: 0.01   },
    pos_scale:     { label: 'Pos Scale',    type: 'float',  min: 0.001,   max: 0.5,  step: 0.001  },
    pos_freq:      { label: 'Pos Freq',     type: 'float',  min: 0.01,    max: 2.0,  step: 0.01   },
    pos_phase:     { label: 'Pos Phase',    type: 'float',  min: 0.0,     max: 10.0, step: 0.01   },
    arc_freq:      { label: 'Arc Freq',     type: 'float',  min: 0.1,     max: 10.0, step: 0.1    },
    position_mode: { label: 'Position',  type: 'select', options: [
      { value: 'sinusoidal', label: 'Sinusoidal (orbs)' },
      { value: 'radial',     label: 'Radial (stars)'    },
      { value: 'direct',     label: 'Direct UV'         },
    ]},
    distance_mode: { label: 'Distance',  type: 'select', options: [
      { value: 'circle', label: 'Circle (length)'   },
      { value: 'polar',  label: 'Polar (arc rings)' },
    ]},
    atten_mode: { label: 'Attenuation', type: 'select', options: [
      { value: 'inverse',    label: 'Inverse (glow/d)'   },
      { value: 'exp',        label: 'Exp falloff'        },
      { value: 'inverse_sq', label: 'Inverse² (glow/d²)' },
    ]},
    color_mode: { label: 'Color',  type: 'select', options: [
      { value: 'cos_vec3', label: 'Cosine RGB'  },
      { value: 'cos_vec4', label: 'Cosine RGBA' },
    ]},
    tonemap_mode: { label: 'Tonemap', type: 'select', options: [
      { value: 'tanh_sq', label: 'tanh(x²)' },
      { value: 'tanh',    label: 'tanh(x)'  },
      { value: 'pow_sq',  label: 'x²'       },
      { value: 'none',    label: 'None'      },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uvVar    = inputVars.uv   || 'vec2(0.5)';
    const timeVar  = inputVars.time || '0.0';
    const iters    = Math.round(typeof node.params.iterations  === 'number' ? node.params.iterations  : 50);
    const tScale   = inputVars.time_scale ?? p(node.params.time_scale, 0.2);
    const freq     = inputVars.freq       ?? p(node.params.freq, 60.0);
    const glow     = inputVars.glow       ?? p(node.params.glow, 0.0003);
    const phR      = p(node.params.color_phase_r, 0.0);
    const phG      = p(node.params.color_phase_g, 2.0);
    const phB      = p(node.params.color_phase_b, 4.0);
    const posScale = inputVars.pos_scale ?? p(node.params.pos_scale, 0.05);
    const posFreq  = inputVars.pos_freq  ?? p(node.params.pos_freq, 0.31);
    const posPhase = inputVars.pos_phase ?? p(node.params.pos_phase, 5.0);
    const posMode   = typeof node.params.position_mode === 'string' ? node.params.position_mode : 'sinusoidal';
    const distMode  = typeof node.params.distance_mode === 'string' ? node.params.distance_mode : 'circle';
    const attenMode = typeof node.params.atten_mode    === 'string' ? node.params.atten_mode    : 'inverse';
    const colorMode = typeof node.params.color_mode    === 'string' ? node.params.color_mode    : 'cos_vec3';
    const tonemapMode = typeof node.params.tonemap_mode === 'string' ? node.params.tonemap_mode : 'tanh_sq';
    const posExpr = posMode === 'radial'
      ? `${uvVar} + ${posScale} * cos(${id}_i * ${posFreq} + vec2(0.0, ${posPhase})) * sqrt(${id}_i)`
      : posMode === 'sinusoidal'
      ? `sin(${uvVar} * ${freq} / ${id}_i + ${timeVar} * ${tScale} + cos(${id}_i * vec2(9.0, 7.0)))`
      : uvVar;
    let distExpr: string;
    if (distMode === 'polar') {
      distExpr = `abs(length(${id}_pos) * ${freq} * 0.02 - ${id}_i)`;
    } else {
      distExpr = `length(${id}_pos)`;
    }
    const attenExpr = attenMode === 'exp'
      ? `exp(-${id}_d / ${glow})`
      : attenMode === 'inverse_sq'
      ? `${glow} / max(${id}_d * ${id}_d, 0.000001)`
      : `${glow} / max(${id}_d, 0.00001)`;
    const colorExpr = colorMode === 'cos_vec4'
      ? `(cos(${id}_i + vec4(${phR}, ${phG}, ${phB}, 0.0)) + 1.0).xyz`
      : `(cos(${id}_i + vec3(${phR}, ${phG}, ${phB})) + 1.0)`;
    const tonemapExpr = tonemapMode === 'tanh'
      ? `tanh(${id}_acc)`
      : tonemapMode === 'pow_sq'
      ? `${id}_acc * ${id}_acc`
      : tonemapMode === 'none'
      ? `${id}_acc`
      : `tanh(${id}_acc * ${id}_acc)`;
    const code = [
      `    vec3 ${id}_acc = vec3(0.0);\n`,
      `    for (float ${id}_i = 1.0; ${id}_i < ${iters}.0; ${id}_i++) {\n`,
      `        vec2 ${id}_pos = ${posExpr};\n`,
      `        float ${id}_d = ${distExpr};\n`,
      `        float ${id}_a = ${attenExpr};\n`,
      `        ${id}_acc += ${colorExpr} * ${id}_a;\n`,
      `    }\n`,
      `    vec3 ${id}_color = ${tonemapExpr};\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_color`, uv: uvVar } };
  },
};

const DEFAULT_LOOP_BODY = [
  '@uv = fract(@uv * 3.0) - 0.5;',
  'float d = length(@uv) * exp(-length(@uv0));',
  'float t2 = length(@uv0) + @i * 0.4 + @t * 0.4;',
  'vec3 col = palette(t2, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));',
  'float g = sin(d * 8.0 + @t) / 8.0;',
  'g = 0.01 / abs(g);',
  '@color += col * g;',
].join('\n');

export const ForLoopNode: NodeDefinition = {
  type: 'forLoop',
  label: 'For Loop',
  category: 'Effects',
  description: 'General-purpose accumulator loop. Write GLSL body using @uv, @uv0, @color, @i, @t tokens. Outputs accumulated vec3 color.',
  inputs: {
    uv:         { type: 'vec2',  label: 'UV'         },
    time:       { type: 'float', label: 'Time'       },
    iterations: { type: 'float', label: 'Iterations' },
  },
  outputs: {
    color:    { type: 'vec3', label: 'Color'    },
    uv_final: { type: 'vec2', label: 'UV Final' },
  },
  defaultParams: { iterations: 4, body: DEFAULT_LOOP_BODY },
  paramDefs: {
    iterations: { label: 'Iterations', type: 'float', min: 1, max: 16, step: 1 },
    body:        { label: 'Body',       type: 'string' },
  },
  glslFunction: PALETTE_GLSL_FN,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uvVar    = inputVars.uv   || 'vec2(0.0)';
    const timeVar  = inputVars.time || '0.0';
    const iters    = inputVars.iterations ?? f(typeof node.params.iterations === 'number' ? Math.floor(node.params.iterations) : 4);
    const rawBody  = typeof node.params.body === 'string' ? node.params.body : DEFAULT_LOOP_BODY;
    const body = rawBody
      .replace(/@uv0/g,   `${id}_uv0`)
      .replace(/@uv/g,    `${id}_uv`)
      .replace(/@color/g, `${id}_color`)
      .replace(/@i/g,     `${id}_i`)
      .replace(/@t/g,     `${id}_t`);
    const indentedBody = body.split('\n').map(line => line.trim() ? `        ${line}` : '').join('\n');
    const code = [
      `    vec2  ${id}_uv0   = ${uvVar};\n`,
      `    vec2  ${id}_uv    = ${uvVar};\n`,
      `    vec3  ${id}_color = vec3(0.0);\n`,
      `    float ${id}_t     = ${timeVar};\n`,
      `    for (float ${id}_i = 0.0; ${id}_i < ${iters}; ${id}_i++) {\n`,
      `${indentedBody}\n`,
      `    }\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_color`, uv_final: `${id}_uv` } };
  },
};

// ─── Expr Block Node ─────────────────────────────────────────────────────────
// A GLSL statement block where each input key becomes a local variable name.
// Write sequential warp expressions: "p.xy = p.xy * rot2D(t * 0.2); p.y += sin(t * 1.5) * 0.3; p"
// The LAST semicolon-separated token is the return expression. All others are statements.
// Block scope isolates locals from the surrounding function — no name collisions.
// Inputs: p (vec3), t / time / mx / my / a / b (float).
// For loops or multi-line code blocks: use CustomFn node instead.

export const ExprBlockNode: NodeDefinition = {
  type: 'exprNode',
  label: 'Expr Block',
  category: 'Sources',
  description: [
    'Generalized multi-statement GLSL warp block.',
    'Click ⟴ to open the editor and define any inputs (with optional sliders).',
    'Each input name becomes a local variable. Write assignment lines then set the return expression.',
  ].join(' '),
  // Dynamic — populated from params.inputs via addNode() / updateNodeSockets()
  inputs: {},
  outputs: {
    result: { type: 'vec3', label: 'Result (vec3)' },
  },
  defaultParams: {
    // Dynamic inputs — each entry becomes a socket + local variable.
    // New nodes start with one float, one vec2, one vec3 slot (deletable via the modal).
    inputs: [
      { name: 'a', type: 'float', slider: null },
      { name: 'b', type: 'vec2',  slider: null },
      { name: 'c', type: 'vec3',  slider: null },
    ] as Array<{ name: string; type: string; slider: { min: number; max: number } | null }>,
    outputType: 'vec3',
    // Per-line warp statements
    lines: [] as Array<{ lhs: string; op: string; rhs: string }>,
    result: 'a',
    // Legacy field kept for backward compatibility with old saved graphs
    expr: 'a',
  },
  // No paramDefs needed — inputs + lines are handled by ExprBlockModal and inline UI
  paramDefs: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const outType = (node.params.outputType as string) || 'vec3';
    const outVar  = `${id}_result`;

    const decls: string[] = [];

    // ── Determine input declarations ─────────────────────────────────────────
    const dynamicInputs = node.params.inputs as Array<{ name: string; type: string; slider: unknown; carry?: boolean }> | undefined;

    // Type-appropriate zero for the output type — used as fallback value
    const outDefault = outType === 'float' ? '0.0' : outType === 'vec2' ? 'vec2(0.0)' : 'vec3(0.0)';

    if (Array.isArray(dynamicInputs)) {
      // New format: handles empty array (inputs:[]) and populated arrays
      for (const inp of dynamicInputs) {
        const fallback = inp.type === 'vec3' ? 'vec3(0.0)' : inp.type === 'vec2' ? 'vec2(0.0)' : '0.0';
        const carryVar = inputVars[`__carry_${inp.name}`];
        if (carryVar) {
          // Carry input: read from outer carry variable (forward-declared before the loop)
          decls.push(`        ${inp.type} ${inp.name} = ${carryVar};\n`);
        } else {
          const val = inputVars[inp.name] || fallback;
          decls.push(`        ${inp.type} ${inp.name} = ${val};\n`);
        }
      }
      // Always inject t = u_time unless user explicitly has a t input socket
      if (!dynamicInputs.some(inp => inp.name === 't')) {
        decls.push(`        float t = u_time;\n`);
      }
      // Always inject p as a writable scratch variable (backward compat with old graphs
      // that use semicolon-separated statements like "p = sin(x + t); p").
      if (!dynamicInputs.some(inp => inp.name === 'p')) {
        decls.push(`        ${outType} p = ${outDefault};\n`);
      }
    } else {
      // Legacy fallback: fixed set of variables (p, t, time, mx, my, a, b)
      // Works for old saved graphs that have these keys in node.inputs.
      const legacyDefs: Array<{ key: string; type: string; fallback: string }> = [
        { key: 'p',    type: 'vec3',  fallback: 'vec3(0.0)' },
        { key: 't',    type: 'float', fallback: '0.0'       },
        { key: 'time', type: 'float', fallback: 'u_time'    },
        { key: 'mx',   type: 'float', fallback: '0.0'       },
        { key: 'my',   type: 'float', fallback: '0.0'       },
        { key: 'a',    type: 'float', fallback: '0.0'       },
        { key: 'b',    type: 'float', fallback: '0.0'       },
      ];
      for (const def of legacyDefs) {
        const val = inputVars[def.key] || def.fallback;
        decls.push(`        ${def.type} ${def.key} = ${val};\n`);
      }
    }

    const stmts: string[] = [];

    // ── Per-line format (lines + result) ─────────────────────────────────────
    const lines = node.params.lines as Array<{ lhs: string; op: string; rhs: string }> | undefined;
    const resultExpr = (node.params.result as string | undefined)?.trim() || '';

    if (Array.isArray(lines)) {
      // New format: lines array is present (may be empty — just a result expression)
      for (const line of lines) {
        if (line.lhs && line.rhs) {
          stmts.push(`        ${line.lhs} ${line.op || '='} ${line.rhs};\n`);
        }
      }
      stmts.push(`        ${outVar} = ${resultExpr || outDefault};\n`);
    } else {
      // ── Legacy semicolon-separated expr format (backward compat) ─────────
      // Only reached when lines is undefined (old saved graphs without the lines field)
      const rawExpr = ((node.params.expr as string) || outDefault).trim();
      const parts = rawExpr.split(';').map(s => s.trim()).filter(s => s.length > 0);
      if (parts.length <= 1) {
        stmts.push(`        ${outVar} = ${parts[0] ?? outDefault};\n`);
      } else {
        for (let i = 0; i < parts.length - 1; i++) {
          stmts.push(`        ${parts[i]};\n`);
        }
        stmts.push(`        ${outVar} = ${parts[parts.length - 1]};\n`);
      }
    }

    // Carry write-backs: after user lines, persist local var back to outer carry var
    const carryWritebacks: string[] = [];
    if (Array.isArray(dynamicInputs)) {
      for (const inp of dynamicInputs) {
        const carryVar = inputVars[`__carry_${inp.name}`];
        if (carryVar) carryWritebacks.push(`        ${carryVar} = ${inp.name};\n`);
      }
    }

    const code = [
      `    ${outType} ${outVar};\n`,
      `    {\n`,
      ...decls,
      ...stmts,
      ...carryWritebacks,
      `    }\n`,
    ].join('');

    return { code, outputVars: { result: outVar } };
  },
};

export const CustomFnNode: NodeDefinition = {
  type: 'customFn',
  label: 'Custom Fn',
  category: 'Sources',
  description: 'User-defined GLSL function. Define input sockets, output type, and write the GLSL body.',
  inputs: {},
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: {
    label: 'Custom Fn',
    inputs: [{ name: 'uv', type: 'vec2', slider: null }] as Array<{ name: string; type: string; slider: null }>,
    outputType: 'float',
    body: '0.0',
    glslFunctions: '',
  },
  generateGLSL: (node: GraphNode, inputVars: Record<string, string>) => {
    const customInputs = (node.params.inputs as Array<{ name: string; type: string }>) || [];
    const outType = (node.params.outputType as string) || 'float';
    const outVar = `${node.id}_result`;
    const rawBody = (node.params.body as string) || '0.0';
    let body = rawBody;
    for (const inp of customInputs) {
      const glslVar = inputVars[inp.name] || (inp.type === 'vec2' ? 'vec2(0.0)' : inp.type === 'vec3' ? 'vec3(0.0)' : '0.0');
      const escaped = inp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      body = body.replace(new RegExp(`\\b${escaped}\\b`, 'g'), glslVar);
    }
    const trimmed = body.trim();
    const isMultiLine = trimmed.includes('\n');
    let code: string;
    if (isMultiLine) {
      const indented = trimmed.split('\n').map(l => `        ${l}`).join('\n');
      code = `    ${outType} ${outVar};\n    {\n${indented}\n    }\n`;
    } else {
      code = `    ${outType} ${outVar} = ${trimmed};\n`;
    }
    return { code, outputVars: { result: outVar } };
  },
};

// ─── Gravitational Lens Node ──────────────────────────────────────────────────
// Outputs a UV-distorted by an inverse-square (or fisheye / ripple) lens.
// Wire uv_lensed into any upstream shader node's UV input to lens its output.
// Wire lens_center to Mouse for interactive lensing.

export const GravitationalLensNode: NodeDefinition = {
  type: 'gravitationalLens',
  label: 'Gravitational Lens',
  category: 'Effects',
  description: [
    'Warps UV coordinates using a gravitational lens (inverse-square falloff). ',
    'Wire uv_lensed into any shader\'s UV input — it samples the content at the displaced position. ',
    'Wire lens_center to Mouse for interactive black-hole lensing. ',
    'Modes: gravity (1/r²), fisheye (smooth barrel), ripple (animated wave). ',
    'Relativistic extras: Einstein radius sizing, gravitational redshift tint, photon ring glow, Kerr frame-dragging spin.',
  ].join(''),
  inputs: {
    uv:          { type: 'vec2',  label: 'UV'                          },
    lens_center: { type: 'vec2',  label: 'Lens Center (wire Mouse →)'  },
    time:        { type: 'float', label: 'Time (ripple / spin)'        },
  },
  outputs: {
    uv_lensed:    { type: 'vec2',  label: 'Lensed UV'                  },
    horizon_mask: { type: 'float', label: 'Horizon Mask (1=outside)'   },
    dist:         { type: 'float', label: 'Distance to Lens'           },
    redshift:     { type: 'float', label: 'Redshift (0=horizon,1=far)' },
    photon_ring:  { type: 'float', label: 'Photon Ring glow'           },
  },
  defaultParams: {
    lens_type:       'gravity',
    strength:        0.002,
    einstein_radius: 0.12,
    horizon_radius:  0.05,
    softening:       0.0001,
    aspect_correct:  'yes',
    ripple_freq:     20.0,
    ripple_speed:     2.0,
    spin:            0.0,
    redshift_power:  2.0,
    photon_width:    0.008,
  },
  paramDefs: {
    lens_type: { label: 'Lens Type', type: 'select', options: [
      { value: 'gravity', label: 'Gravity (1/r²)'      },
      { value: 'fisheye', label: 'Fisheye (barrel)'    },
      { value: 'ripple',  label: 'Ripple (animated)'   },
    ]},
    einstein_radius: { label: 'Einstein Radius',   type: 'float', min: 0.01,   max: 0.6,   step: 0.005  },
    strength:        { label: 'Strength',           type: 'float', min: 0.0001, max: 0.05,  step: 0.0001 },
    horizon_radius:  { label: 'Horizon Radius',     type: 'float', min: 0.0,    max: 0.3,   step: 0.005  },
    softening:       { label: 'Softening',          type: 'float', min: 0.0,    max: 0.01,  step: 0.0001 },
    spin:            { label: 'Spin (Kerr)',         type: 'float', min: -1.0,   max: 1.0,   step: 0.01   },
    redshift_power:  { label: 'Redshift Power',     type: 'float', min: 0.0,    max: 6.0,   step: 0.1    },
    photon_width:    { label: 'Photon Ring Width',  type: 'float', min: 0.0,    max: 0.05,  step: 0.001  },
    aspect_correct: { label: 'Aspect Correct', type: 'select', options: [
      { value: 'yes', label: 'Yes (circular lens)' },
      { value: 'no',  label: 'No (square space)'   },
    ]},
    ripple_freq:  { label: 'Ripple Freq',  type: 'float', min: 1.0,  max: 100.0, step: 0.5 },
    ripple_speed: { label: 'Ripple Speed', type: 'float', min: 0.0,  max: 10.0,  step: 0.1 },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar         = inputVars.uv          ?? 'vec2(0.0)';
    const lensCenterVar = inputVars.lens_center  ?? 'vec2(0.0)';
    const timeVar       = inputVars.time         ?? '0.0';

    const lensType      = (node.params.lens_type      as string) ?? 'gravity';
    const strength      = p(node.params.strength, 0.002);
    const einsteinR     = p(node.params.einstein_radius, 0.12);
    const horizonRadius = p(node.params.horizon_radius, 0.05);
    const softening     = p(node.params.softening, 0.0001);
    const aspectCorr    = (node.params.aspect_correct as string) ?? 'yes';
    const rippleFreq    = p(node.params.ripple_freq, 20.0);
    const rippleSpeed   = p(node.params.ripple_speed, 2.0);
    const spin          = p(node.params.spin, 0.0);
    const redshiftPow   = p(node.params.redshift_power, 2.0);
    const photonWidth   = p(node.params.photon_width, 0.008);

    // Kerr frame-dragging: rotate displacement direction by spin * time
    const spinVal = typeof node.params.spin === 'number' ? node.params.spin : 0;
    const kerrLine = Math.abs(spinVal) > 0.001
      ? `    float ${id}_kerrA = ${spin} * ${timeVar} * 0.5;\n` +
        `    ${id}_offset = vec2(${id}_offset.x*cos(${id}_kerrA) - ${id}_offset.y*sin(${id}_kerrA),\n` +
        `                        ${id}_offset.x*sin(${id}_kerrA) + ${id}_offset.y*cos(${id}_kerrA));\n`
      : '';

    // Per-mode warp expression
    let warpExpr: string;
    if (lensType === 'fisheye') {
      const scale = f(typeof node.params.strength === 'number' ? node.params.strength * 5.0 : 0.01);
      warpExpr = `${id}_dir * (tanh(${id}_dist * 10.0) / max(${id}_dist, 0.00001) - 1.0) * ${scale}`;
    } else if (lensType === 'ripple') {
      warpExpr = `${id}_dir * sin(${id}_dist * ${rippleFreq} - ${timeVar} * ${rippleSpeed}) * ${strength}`;
    } else {
      // Gravity: deflection scaled by Einstein radius² → intuitive sizing
      warpExpr = `${id}_dir * (${strength} * ${einsteinR} * ${einsteinR} / (${id}_dist * ${id}_dist + ${softening}))`;
    }

    const aspectLine = aspectCorr === 'yes'
      ? `    ${id}_offset.x *= u_resolution.x / u_resolution.y;\n`
      : '';

    // Photon sphere ≈ 1.5× Schwarzschild radius
    const horizonVal = typeof node.params.horizon_radius === 'number' ? node.params.horizon_radius : 0.05;
    const photonR = f(horizonVal * 1.5);

    const code = [
      `    // Gravitational Lens (${lensType})\n`,
      `    vec2 ${id}_offset = ${lensCenterVar} - ${uvVar};\n`,
      aspectLine,
      kerrLine,
      `    float ${id}_dist = length(${id}_offset);\n`,
      `    vec2  ${id}_dir  = ${id}_offset / max(${id}_dist, 0.00001);\n`,
      `    vec2  ${id}_uv_lensed = ${uvVar} + (${warpExpr});\n`,
      `    float ${id}_horizon_mask = step(${horizonRadius}, ${id}_dist);\n`,
      `    float ${id}_redshift = 1.0 - exp(-pow(max(${id}_dist - ${horizonRadius}, 0.0) / max(${einsteinR}, 0.0001), ${redshiftPow}));\n`,
      `    float ${id}_photon_ring = ${photonWidth} > 0.0001 ? smoothstep(0.0, 1.0, 1.0 - abs(${id}_dist - ${photonR}) / ${photonWidth}) : 0.0;\n`,
    ].join('');

    return {
      code,
      outputVars: {
        uv_lensed:    `${id}_uv_lensed`,
        horizon_mask: `${id}_horizon_mask`,
        dist:         `${id}_dist`,
        redshift:     `${id}_redshift`,
        photon_ring:  `${id}_photon_ring`,
      },
    };
  },
};

// ─── Float Warp ───────────────────────────────────────────────────────────────
// A single-float expression node. Wire any float in as `value`, optionally wire
// `a`, `b`, `c` for extra parameters, write a one-liner to transform it.
// Perfect for time remapping: sin(value), abs(fract(value*2.0)-0.5)*2.0, etc.

export const FloatWarpNode: NodeDefinition = {
  type: 'floatWarp',
  label: 'Float Warp',
  category: 'Effects',
  description: 'Transform a single float with a one-line GLSL expression. Use "value" for the input. Wire a, b, c for extra params. Intensity blends between the original value (0) and the expression result (1). Great for time remapping, oscillation, ping-pong, etc.',
  inputs: {
    value:     { type: 'float', label: 'Value' },
    a:         { type: 'float', label: 'A' },
    b:         { type: 'float', label: 'B' },
    c:         { type: 'float', label: 'C' },
    intensity: { type: 'float', label: 'Intensity' },
  },
  outputs: {
    result: { type: 'float', label: 'Result' },
  },
  defaultParams: { expr: 'sin(value)', intensity: 1.0 },
  paramDefs: {
    expr:      { label: 'Expression', type: 'string' },
    intensity: { label: 'Intensity',  type: 'float', min: 0.0, max: 1.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id     = node.id;
    const outVar = `${id}_result`;
    let expr = (node.params.expr as string) || 'value';
    const valueVar = inputVars.value || '0.0';
    const subs: Record<string, string> = {
      value: valueVar,
      a:     inputVars.a || '0.0',
      b:     inputVars.b || '0.0',
      c:     inputVars.c || '0.0',
    };
    for (const [name, glslVar] of Object.entries(subs)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expr = expr.replace(new RegExp(`\\b${escaped}\\b`, 'g'), glslVar);
    }
    const intensityParam = typeof node.params.intensity === 'number' ? node.params.intensity : 1.0;
    const intensityVar   = inputVars.intensity || f(intensityParam);
    // Blend: mix(original_value, expr_result, intensity) — dial intensity for A/B
    return {
      code: [
        `    float ${id}_warped = ${expr};\n`,
        `    float ${outVar} = mix(${valueVar}, ${id}_warped, clamp(${intensityVar}, 0.0, 1.0));\n`,
      ].join(''),
      outputVars: { result: outVar },
    };
  },
};

// ─── New Effect Nodes (V2) ────────────────────────────────────────────────────

// Vignette — smoothstep darkening around the edges
export const VignetteNode: NodeDefinition = {
  type: 'vignette', label: 'Vignette', category: 'Effects',
  description: 'Add a soft darkening vignette around the edges of the frame.',
  inputs: {
    color:    { type: 'vec3',  label: 'Color' },
    uv:       { type: 'vec2',  label: 'UV (0-1)' },
    radius:   { type: 'float', label: 'Radius' },
    softness: { type: 'float', label: 'Softness' },
    strength: { type: 'float', label: 'Strength' },
  },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: { radius: 0.65, softness: 0.45, strength: 1.0 },
  paramDefs: {
    radius:   { label: 'Radius',   type: 'float', min: 0.0, max: 1.5, step: 0.01 },
    softness: { label: 'Softness', type: 'float', min: 0.0, max: 1.0, step: 0.01 },
    strength: { label: 'Strength', type: 'float', min: 0.0, max: 2.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const col = inputVars.color    || 'vec3(0.5)';
    const uv  = inputVars.uv       || 'vec2(0.5)';
    const rad = inputVars.radius   || p(node.params.radius,   0.65);
    const sft = inputVars.softness || p(node.params.softness, 0.45);
    const str = inputVars.strength || p(node.params.strength, 1.0);
    return {
      code: [
        `    vec2  ${id}_vc  = ${uv} - 0.5;\n`,
        `    float ${id}_d   = length(${id}_vc);\n`,
        `    float ${id}_vig = smoothstep(${rad}, ${rad} - ${sft}, ${id}_d);\n`,
        `    vec3  ${id}_result = ${col} * mix(1.0, ${id}_vig, ${str});\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};

// Scanlines — CRT-style horizontal scan lines
export const ScanlinesNode: NodeDefinition = {
  type: 'scanlines', label: 'Scanlines', category: 'Effects',
  description: 'Add CRT-style scanlines to a color.',
  inputs: {
    color:     { type: 'vec3',  label: 'Color' },
    uv:        { type: 'vec2',  label: 'UV (0-1)' },
    count:     { type: 'float', label: 'Line Count' },
    intensity: { type: 'float', label: 'Intensity' },
    time:      { type: 'float', label: 'Time (scroll)' },
  },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: { count: 240.0, intensity: 0.3, scroll: 0.0 },
  paramDefs: {
    count:     { label: 'Line Count', type: 'float', min: 20.0, max: 600.0, step: 10.0 },
    intensity: { label: 'Intensity',  type: 'float', min: 0.0,  max: 1.0,   step: 0.01 },
    scroll:    { label: 'Scroll Spd', type: 'float', min: -5.0, max: 5.0,   step: 0.1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const col = inputVars.color     || 'vec3(0.5)';
    const uv  = inputVars.uv        || 'vec2(0.5)';
    const cnt = inputVars.count     || p(node.params.count,     240.0);
    const ity = inputVars.intensity || p(node.params.intensity, 0.3);
    const t   = inputVars.time      || '0.0';
    const spd = p(node.params.scroll, 0.0);
    return {
      code: [
        `    float ${id}_line  = sin((${uv}.y + ${t} * ${spd}) * 3.14159 * ${cnt}) * 0.5 + 0.5;\n`,
        `    vec3  ${id}_result = ${col} * (1.0 - ${ity} * (1.0 - ${id}_line));\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};

// Sobel — edge detection using finite-difference Sobel operator on a grayscale value
// Expects neighboring UV samples; for simplicity takes the color + UV and approximates
// using fwidth (available in fragment shaders)
export const SobelNode: NodeDefinition = {
  type: 'sobel', label: 'Sobel Edges', category: 'Effects',
  description: 'Sobel edge detection. Wire a float/luminance value and UV; outputs edge strength.',
  inputs: {
    value:    { type: 'float', label: 'Value' },
    uv:       { type: 'vec2',  label: 'UV' },
    strength: { type: 'float', label: 'Strength' },
  },
  outputs: {
    edges:  { type: 'float', label: 'Edge Strength' },
    result: { type: 'vec3',  label: 'Edge Color' },
  },
  defaultParams: { strength: 1.0, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: 0.0, max: 10.0, step: 0.1 },
    colorR:   { label: 'Color R',  type: 'float', min: 0.0, max: 1.0,  step: 0.01 },
    colorG:   { label: 'Color G',  type: 'float', min: 0.0, max: 1.0,  step: 0.01 },
    colorB:   { label: 'Color B',  type: 'float', min: 0.0, max: 1.0,  step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const val = inputVars.value    || '0.0';
    const str = inputVars.strength || p(node.params.strength, 1.0);
    const r   = p(node.params.colorR, 1.0);
    const g   = p(node.params.colorG, 1.0);
    const b   = p(node.params.colorB, 1.0);
    return {
      code: [
        `    float ${id}_dx    = dFdx(${val});\n`,
        `    float ${id}_dy    = dFdy(${val});\n`,
        `    float ${id}_edges = clamp(length(vec2(${id}_dx, ${id}_dy)) * ${str}, 0.0, 1.0);\n`,
        `    vec3  ${id}_result = vec3(${r}, ${g}, ${b}) * ${id}_edges;\n`,
      ].join(''),
      outputVars: { edges: `${id}_edges`, result: `${id}_result` },
    };
  },
};

// ── Radiance Cascades 2D ─────────────────────────────────────────────────────

const RC2D_GLSL = `vec3 rcSampleScene_rc2d(vec2 uv) {
    vec2 sampleUV = clamp(uv * 0.5 + 0.5, 0.0, 1.0);
    return texture2D(u_prevFrame, sampleUV).rgb;
}
vec4 rcMarchRay_rc2d(vec2 origin, float angle, float rayLen, float dt, float emitThresh) {
    vec2 dir = vec2(cos(angle), sin(angle));
    for (float t = 0.0; t < rayLen; t += dt) {
        vec2 pos = origin + dir * t;
        if (abs(pos.x) > 1.0 || abs(pos.y) > 1.0) return vec4(0.0);
        vec3 s = rcSampleScene_rc2d(pos);
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        if (lum > emitThresh) return vec4(s, 1.0);
    }
    return vec4(0.0);
}
vec3 rcRadiance_rc2d(vec2 uv, int nRays, float rayLen, float dt, float c1s, float emitThresh, vec3 sky) {
    vec3 rad = vec3(0.0);
    float step_angle = 6.28318 / float(nRays);
    for (int i = 0; i < 16; i++) {
        if (i >= nRays) break;
        float angle = float(i) * step_angle;
        vec4 c0 = rcMarchRay_rc2d(uv, angle, rayLen, dt, emitThresh);
        if (c0.a > 0.5) {
            rad += c0.rgb;
        } else {
            vec4 c1 = rcMarchRay_rc2d(uv, angle, rayLen * 4.0, dt * 2.0, emitThresh);
            rad += c1.a > 0.5 ? c1.rgb : sky;
        }
    }
    return rad / float(nRays);
}`;

export const RadianceCascadesApproxNode: NodeDefinition = {
  type: 'radianceCascadesApprox',
  label: 'Radiance Cascades 2D',
  category: 'Effects',
  description: 'Per-pixel 2D global illumination using Radiance Cascades (Sannikov, 2024). Uses Prev Frame as emitter scene — bright pixels cast light. Wire PrevFrame node to scene, then connect UV here. 2-level approximation runs in a single pass.',
  inputs: {
    uv:        { type: 'vec2', label: 'UV'        },
    sky_color: { type: 'vec3', label: 'Sky Color' },
  },
  outputs: {
    radiance: { type: 'vec3',  label: 'Radiance' },
    gi_r:     { type: 'float', label: 'GI Red'   },
    gi_g:     { type: 'float', label: 'GI Green' },
    gi_b:     { type: 'float', label: 'GI Blue'  },
  },
  defaultParams: {
    ray_count:      8.0,
    ray_length:     0.3,
    ray_step:       0.02,
    c1_scale:       2.0,
    emit_threshold: 0.7,
  },
  paramDefs: {
    ray_count:      { label: 'Ray Count',       type: 'float', min: 4.0,   max: 16.0, step: 4.0  },
    ray_length:     { label: 'Ray Length',      type: 'float', min: 0.05,  max: 1.0,  step: 0.01 },
    ray_step:       { label: 'Ray Step',        type: 'float', min: 0.005, max: 0.05, step: 0.005},
    c1_scale:       { label: 'Cascade 1 Scale', type: 'float', min: 1.0,   max: 4.0,  step: 0.5  },
    emit_threshold: { label: 'Emit Threshold',  type: 'float', min: 0.3,   max: 1.0,  step: 0.05 },
  },
  glslFunction: RC2D_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id         = node.id;
    const uvVar      = inputVars.uv        || 'vec2(0.0)';
    const skyVar     = inputVars.sky_color || 'vec3(0.0)';
    const rayCount   = p(node.params.ray_count,      8.0);
    const rayLen     = p(node.params.ray_length,     0.3);
    const rayStep    = p(node.params.ray_step,       0.02);
    const c1Scale    = p(node.params.c1_scale,       2.0);
    const emitThresh = p(node.params.emit_threshold, 0.7);
    return {
      code: [
        `    vec3  ${id}_radiance = rcRadiance_rc2d(${uvVar}, int(${rayCount}), ${rayLen}, ${rayStep}, ${c1Scale}, ${emitThresh}, ${skyVar});\n`,
        `    float ${id}_gi_r = ${id}_radiance.r;\n`,
        `    float ${id}_gi_g = ${id}_radiance.g;\n`,
        `    float ${id}_gi_b = ${id}_radiance.b;\n`,
      ].join(''),
      outputVars: {
        radiance: `${id}_radiance`,
        gi_r:     `${id}_gi_r`,
        gi_g:     `${id}_gi_g`,
        gi_b:     `${id}_gi_b`,
      },
    };
  },
};

// ─── ChromaticAberrationAutoNode ──────────────────────────────────────────────
// Self-contained chromatic aberration node: UV in → split R/G/B UVs + composite color out.
// When no scene color is wired, shows a built-in glow-ring visualization.

export const ChromaticAberrationAutoNode: NodeDefinition = {
  type: 'chromaticAberrationAuto',
  label: 'Chroma Aberration Auto',
  category: 'Effects',
  description: 'Self-contained chromatic aberration: takes UV + optional scene color (vec3), applies spectral channel split, outputs a composited vec3 with R/G/B shifted. Uses glow-ring visualization if no color input is wired. Great as a one-node CA effect.',
  inputs: {
    uv:       { type: 'vec2',  label: 'UV'                  },
    time:     { type: 'float', label: 'Time'                 },
    color:    { type: 'vec3',  label: 'Scene Color (opt)'    },
    strength: { type: 'float', label: 'Strength'             },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color'    },
    uv_r:  { type: 'vec2', label: 'UV Red'   },
    uv_g:  { type: 'vec2', label: 'UV Green' },
    uv_b:  { type: 'vec2', label: 'UV Blue'  },
  },
  defaultParams: {
    mode:       'radial',
    strength:   0.04,
    contrast:   1.5,
    angle_deg:  0.0,
    animate:    'true',
    anim_speed: 0.4,
  },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'radial',  label: 'Radial'  },
      { value: 'linear',  label: 'Linear'  },
      { value: 'twist',   label: 'Twist'   },
      { value: 'barrel',  label: 'Barrel'  },
    ]},
    strength:   { label: 'Strength',   type: 'float', min: 0.0, max: 0.2,  step: 0.001 },
    contrast:   { label: 'Contrast',   type: 'float', min: 0.0, max: 3.0,  step: 0.05  },
    angle_deg:  { label: 'Angle (°)',  type: 'float', min: 0,   max: 360,  step: 1     },
    animate:    { label: 'Animate',    type: 'select', options: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }] },
    anim_speed: { label: 'Anim Speed', type: 'float', min: 0,   max: 3,    step: 0.01  },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uvVar   = inputVars.uv       ?? 'g_uv';
    const timeVar = inputVars.time     ?? '0.0';
    const strIn   = inputVars.strength ?? p(node.params.strength, 0.04);
    const cont    = p(node.params.contrast, 1.5);
    const mode    = (node.params.mode as string) ?? 'radial';
    const animate = (node.params.animate as string) ?? 'true';
    const aspd    = p(node.params.anim_speed, 0.4);
    const ang     = p(node.params.angle_deg, 0.0);

    const strExpr = animate === 'true'
      ? `(${strIn} * (0.8 + 0.2 * sin(${timeVar} * ${aspd})))`
      : strIn;

    let baseOff: string;
    switch (mode) {
      case 'linear':
        baseOff = `(vec2(cos(${ang} * 3.14159 / 180.0), sin(${ang} * 3.14159 / 180.0)) * ${strExpr})`;
        break;
      case 'twist':
        baseOff = `(vec2(${uvVar}.y - 0.5, 0.5 - ${uvVar}.x) * ${strExpr})`;
        break;
      case 'barrel':
        baseOff = `(${uvVar} * dot(${uvVar}, ${uvVar}) * ${strExpr})`;
        break;
      default: // radial
        baseOff = `(normalize(${uvVar} + vec2(0.00001)) * ${strExpr} * length(${uvVar}))`;
    }

    const spread   = `(${baseOff} * ${cont} * 0.25)`;
    const hasColor = !!inputVars.color;

    const parts: string[] = [
      `    vec2 ${id}_uv_r = ${uvVar} + ${spread};\n`,
      `    vec2 ${id}_uv_g = ${uvVar};\n`,
      `    vec2 ${id}_uv_b = ${uvVar} - ${spread};\n`,
    ];

    if (!hasColor) {
      parts.push(
        `    float ${id}_gr = 0.02 / (length(${id}_uv_r) + 0.001);\n`,
        `    float ${id}_gg = 0.02 / (length(${id}_uv_g) + 0.001);\n`,
        `    float ${id}_gb = 0.02 / (length(${id}_uv_b) + 0.001);\n`,
        `    vec3 ${id}_color = clamp(vec3(${id}_gr, ${id}_gg, ${id}_gb), 0.0, 1.0);\n`,
      );
    } else {
      parts.push(
        `    vec3 ${id}_color = ${inputVars.color!} + vec3(${spread}.x, 0.0, -(${spread}).x) * 2.0;\n`,
      );
    }

    return {
      code: parts.join(''),
      outputVars: {
        color: `${id}_color`,
        uv_r:  `${id}_uv_r`,
        uv_g:  `${id}_uv_g`,
        uv_b:  `${id}_uv_b`,
      },
    };
  },
};

// ─── Gaussian Blur ────────────────────────────────────────────────────────────
// Samples u_prevFrame with a Gaussian kernel. Center tap = color input (current
// scene, sharp). Surrounding taps read the previous frame so the blur
// converges to a correct result within 1–2 frames for static/slow content.

export const GaussianBlurNode: NodeDefinition = {
  type: 'gaussianBlur',
  label: 'Gaussian Blur',
  category: 'Effects',
  description: 'Smooth photographic blur. Wire your scene color + UV, then connect the result to Output. Converges to correct blur within 1–2 frames for static content.',
  inputs: {
    color: { type: 'vec3', label: 'Color' },
    uv:    { type: 'vec2', label: 'UV'    },
  },
  outputs: {
    result: { type: 'vec3', label: 'Result' },
  },
  defaultParams: { radius: 4.0, quality: 'standard' },
  paramDefs: {
    radius:  { label: 'Radius (px)', type: 'float', min: 0.5, max: 20.0, step: 0.5 },
    quality: { label: 'Quality', type: 'select', options: [
      { value: 'fast',     label: 'Fast (3×3)'     },
      { value: 'standard', label: 'Standard (5×5)' },
      { value: 'high',     label: 'High (7×7)'     },
    ]},
  },
  glslFunction: `
float gaussBlurWeight(float x, float y, float sigma) {
  return exp(-0.5 * (x*x + y*y) / (sigma*sigma));
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const col     = inputVars.color || 'vec3(0.0)';
    const uvVar   = inputVars.uv    || 'g_uv';
    const radius  = p(node.params.radius, 4.0);
    const quality = (node.params.quality as string) ?? 'standard';
    const half_n  = quality === 'fast' ? 1 : quality === 'high' ? 3 : 2;
    const sigma   = half_n === 1 ? '1.0' : half_n === 3 ? '2.0' : '1.5';

    const lines: string[] = [
      `    vec2  ${id}_uv01 = clamp(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
      `    vec2  ${id}_px   = 1.0 / u_resolution;\n`,
      `    vec3  ${id}_acc  = ${col};\n`,
      `    float ${id}_wsum = 1.0;\n`,
    ];

    for (let gx = -half_n; gx <= half_n; gx++) {
      for (let gy = -half_n; gy <= half_n; gy++) {
        if (gx === 0 && gy === 0) continue;
        const w = `gaussBlurWeight(${f(gx)}, ${f(gy)}, ${sigma})`;
        lines.push(
          `    { float ${id}_w = ${w}; ` +
          `${id}_acc += texture2D(u_prevFrame, clamp(${id}_uv01 + vec2(${f(gx)}, ${f(gy)}) * ${id}_px * ${radius}, 0.0, 1.0)).rgb * ${id}_w; ` +
          `${id}_wsum += ${id}_w; }\n`,
        );
      }
    }
    lines.push(`    vec3 ${id}_result = ${id}_acc / ${id}_wsum;\n`);

    return { code: lines.join(''), outputVars: { result: `${id}_result` } };
  },
};

// ─── Radial Blur ──────────────────────────────────────────────────────────────
// Samples u_prevFrame along the radial direction from a center point, creating
// a zoom/spin blur effect. Center tap = color input.

export const RadialBlurNode: NodeDefinition = {
  type: 'radialBlur',
  label: 'Radial Blur',
  category: 'Effects',
  description: 'Zoom/spin blur radiating outward from a center point. Wire Mouse UV to center for interactive control.',
  inputs: {
    color:  { type: 'vec3', label: 'Color'  },
    uv:     { type: 'vec2', label: 'UV'     },
    center: { type: 'vec2', label: 'Center' },
  },
  outputs: {
    result: { type: 'vec3', label: 'Result' },
  },
  defaultParams: { strength: 0.02, samples: '16', falloff: 1.0 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: 0.0, max: 0.08, step: 0.001 },
    samples:  { label: 'Samples',  type: 'select', options: [
      { value: '8',  label: '8 (fast)'    },
      { value: '16', label: '16 (medium)' },
      { value: '24', label: '24 (high)'   },
    ]},
    falloff: { label: 'Edge Falloff', type: 'float', min: 0.0, max: 2.0, step: 0.05 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const col      = inputVars.color  || 'vec3(0.0)';
    const uvVar    = inputVars.uv     || 'g_uv';
    const ctrVar   = inputVars.center || 'vec2(0.0)';
    const strength = p(node.params.strength, 0.02);
    const falloff  = p(node.params.falloff,  1.0);
    const nSamples = parseInt((node.params.samples as string) ?? '16', 10);

    const lines: string[] = [
      `    vec2  ${id}_uv01  = clamp(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
      `    vec2  ${id}_ctr01 = clamp(${ctrVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
      `    vec2  ${id}_dir   = ${id}_uv01 - ${id}_ctr01;\n`,
      `    float ${id}_dist  = length(${id}_dir);\n`,
      `    float ${id}_fo    = pow(${id}_dist, ${falloff});\n`,
      `    vec2  ${id}_step  = (${id}_dist > 0.0001 ? normalize(${id}_dir) : vec2(0.0)) * ${strength} * ${id}_fo;\n`,
      `    vec3  ${id}_acc   = ${col};\n`,
      `    float ${id}_ns    = ${f(nSamples)};\n`,
    ];

    for (let i = 1; i <= nSamples; i++) {
      const t = f(i / nSamples);
      lines.push(
        `    ${id}_acc += texture2D(u_prevFrame, clamp(${id}_uv01 - ${id}_step * ${t}, 0.0, 1.0)).rgb;\n`,
      );
    }
    lines.push(`    vec3 ${id}_result = ${id}_acc / (${id}_ns + 1.0);\n`);

    return { code: lines.join(''), outputVars: { result: `${id}_result` } };
  },
};

// ─── Tilt-Shift Blur ──────────────────────────────────────────────────────────
// Variable-radius blur whose strength increases with distance from a tilted
// focus band, simulating a miniature / tilt-shift lens.

export const TiltShiftBlurNode: NodeDefinition = {
  type: 'tiltShiftBlur',
  label: 'Tilt-Shift Blur',
  category: 'Effects',
  description: 'Miniature / tilt-shift effect. A focus band stays sharp; blur increases away from it. Tilt the band angle for creative looks.',
  inputs: {
    color: { type: 'vec3',  label: 'Color'        },
    uv:    { type: 'vec2',  label: 'UV'           },
  },
  outputs: {
    result: { type: 'vec3',  label: 'Result'      },
    mask:   { type: 'float', label: 'Focus Mask'  },
  },
  defaultParams: {
    focus_center: 0.0,
    band_width:   0.25,
    max_blur:     6.0,
    tilt_angle:   0.0,
    axis:         'horizontal',
  },
  paramDefs: {
    focus_center: { label: 'Focus Center', type: 'float', min: -1.0,  max: 1.0,  step: 0.01 },
    band_width:   { label: 'Band Width',   type: 'float', min: 0.02,  max: 0.6,  step: 0.01 },
    max_blur:     { label: 'Max Blur (px)',type: 'float', min: 1.0,   max: 16.0, step: 0.5  },
    tilt_angle:   { label: 'Tilt Angle°',  type: 'float', min: -60.0, max: 60.0, step: 1.0  },
    axis: { label: 'Axis', type: 'select', options: [
      { value: 'horizontal', label: 'Horizontal' },
      { value: 'vertical',   label: 'Vertical'   },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id     = node.id;
    const col    = inputVars.color || 'vec3(0.0)';
    const uvVar  = inputVars.uv    || 'g_uv';
    const fc     = p(node.params.focus_center, 0.0);
    const bw     = p(node.params.band_width,   0.25);
    const mb     = p(node.params.max_blur,     6.0);
    const angle  = p(node.params.tilt_angle,   0.0);
    const isVert = (node.params.axis as string) === 'vertical';

    // For horizontal axis: focus plane is along X, distance measured in Y.
    // tiltDir is perpendicular to the focus band.
    const tiltDir = isVert
      ? `vec2(cos(${angle} * 0.01745329), sin(${angle} * 0.01745329))`
      : `vec2(-sin(${angle} * 0.01745329), cos(${angle} * 0.01745329))`;

    // The blur kernel runs perpendicular to the tilt direction for best quality.
    const blurDir = isVert
      ? `vec2(-sin(${angle} * 0.01745329), cos(${angle} * 0.01745329))`
      : `vec2(cos(${angle} * 0.01745329), sin(${angle} * 0.01745329))`;

    const lines: string[] = [
      `    vec2  ${id}_uv01  = clamp(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
      `    vec2  ${id}_px    = 1.0 / u_resolution;\n`,
      `    vec2  ${id}_td    = ${tiltDir};\n`,
      `    float ${id}_dist  = abs(dot(${uvVar} - vec2(0.0, ${fc}), ${id}_td));\n`,
      `    float ${id}_mask  = clamp((${id}_dist - ${bw}) / (1.0 - ${bw}), 0.0, 1.0);\n`,
      `    float ${id}_br    = ${id}_mask * ${mb};\n`,
      `    vec2  ${id}_bd    = ${blurDir};\n`,
      `    vec3  ${id}_acc   = ${col};\n`,
      `    float ${id}_wsum  = 1.0;\n`,
    ];

    // 9-tap 1D Gaussian along blur direction, variable radius
    const offsets = [-4, -3, -2, -1, 1, 2, 3, 4];
    for (const o of offsets) {
      const w = `exp(-0.5 * ${f(o * o)} / (${id}_br * ${id}_br + 0.0001))`;
      lines.push(
        `    { float ${id}_w${o < 0 ? 'n' + Math.abs(o) : o} = ${w}; ` +
        `${id}_acc += texture2D(u_prevFrame, clamp(${id}_uv01 + ${id}_bd * ${f(o)} * ${id}_px * ${id}_br, 0.0, 1.0)).rgb * ${id}_w${o < 0 ? 'n' + Math.abs(o) : o}; ` +
        `${id}_wsum += ${id}_w${o < 0 ? 'n' + Math.abs(o) : o}; }\n`,
      );
    }
    lines.push(`    vec3 ${id}_result = ${id}_acc / ${id}_wsum;\n`);

    return {
      code: lines.join(''),
      outputVars: { result: `${id}_result`, mask: `${id}_mask` },
    };
  },
};

// ─── Lens Blur ────────────────────────────────────────────────────────────────
// Simulates a camera lens with configurable focal length and aperture.
// Circle-of-confusion size drives a bokeh-disc sample pattern on u_prevFrame.

const LENS_BLUR_GLSL = `
vec3 lensBlurDisc(sampler2D tex, vec2 uv01, vec2 px, float coc, vec3 center) {
  vec3 acc = center;
  float wsum = 1.0;
  // 12-tap golden-angle spiral disc
  for (int i = 1; i <= 12; i++) {
    float t = float(i) / 12.0;
    float angle = t * 2.3999632 * 12.0;
    float r = sqrt(t);
    vec2 off = vec2(cos(angle), sin(angle)) * r * coc * px;
    acc += texture2D(tex, clamp(uv01 + off, 0.0, 1.0)).rgb;
    wsum += 1.0;
  }
  return acc / wsum;
}
vec3 lensBlurHex(sampler2D tex, vec2 uv01, vec2 px, float coc, vec3 center) {
  vec3 acc = center;
  float wsum = 1.0;
  // 6 vertices + 6 edge midpoints
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988; // pi/6
    float r = (mod(float(i), 2.0) < 0.5) ? 1.0 : 0.866;
    vec2 off = vec2(cos(a), sin(a)) * r * coc * px;
    acc += texture2D(tex, clamp(uv01 + off, 0.0, 1.0)).rgb;
    wsum += 1.0;
  }
  return acc / wsum;
}
vec3 lensBlurOct(sampler2D tex, vec2 uv01, vec2 px, float coc, vec3 center) {
  vec3 acc = center;
  float wsum = 1.0;
  // 8 vertices + 8 edge midpoints
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.3926991; // pi/8
    float r = (mod(float(i), 2.0) < 0.5) ? 1.0 : 0.9239;
    vec2 off = vec2(cos(a), sin(a)) * r * coc * px;
    acc += texture2D(tex, clamp(uv01 + off, 0.0, 1.0)).rgb;
    wsum += 1.0;
  }
  return acc / wsum;
}`;

export const LensBlurNode: NodeDefinition = {
  type: 'lensBlur',
  label: 'Lens Blur',
  category: 'Effects',
  description: 'Simulate a camera lens with focal length and aperture. Pixels far from the focal point get a bokeh blur disc. Try 35mm f/1.4 for cinematic portraits.',
  inputs: {
    color:       { type: 'vec3', label: 'Color'       },
    uv:          { type: 'vec2', label: 'UV'          },
    focal_point: { type: 'vec2', label: 'Focal Point' },
  },
  outputs: {
    result: { type: 'vec3',  label: 'Result' },
    coc:    { type: 'float', label: 'CoC'    },
  },
  defaultParams: {
    focal_length:   '50mm',
    aperture:       'f2.8',
    focus_distance: 0.25,
    bokeh_shape:    'disc',
    boost:          1.0,
  },
  paramDefs: {
    focal_length: { label: 'Focal Length', type: 'select', options: [
      { value: '24mm',  label: '24mm (wide)'      },
      { value: '35mm',  label: '35mm (street)'    },
      { value: '50mm',  label: '50mm (standard)'  },
      { value: '75mm',  label: '75mm (portrait)'  },
      { value: '85mm',  label: '85mm (portrait)'  },
      { value: '135mm', label: '135mm (telephoto)' },
    ]},
    aperture: { label: 'Aperture', type: 'select', options: [
      { value: 'f1.4', label: 'f/1.4 (wide open)' },
      { value: 'f2',   label: 'f/2'                },
      { value: 'f2.8', label: 'f/2.8'              },
      { value: 'f4',   label: 'f/4'                },
      { value: 'f5.6', label: 'f/5.6'              },
      { value: 'f8',   label: 'f/8 (stopped down)' },
    ]},
    focus_distance: { label: 'Focus Distance', type: 'float', min: 0.02, max: 1.5,  step: 0.01 },
    bokeh_shape: { label: 'Bokeh Shape', type: 'select', options: [
      { value: 'disc', label: 'Disc (circular)'  },
      { value: 'hex',  label: 'Hex (6-blade)'    },
      { value: 'oct',  label: 'Oct (8-blade)'    },
    ]},
    boost: { label: 'Boost', type: 'float', min: 0.1, max: 4.0, step: 0.05 },
  },
  glslFunction: LENS_BLUR_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const col   = inputVars.color       || 'vec3(0.0)';
    const uvVar = inputVars.uv          || 'g_uv';
    const fpVar = inputVars.focal_point || 'vec2(0.0)';

    const focalFactors: Record<string, string> = {
      '24mm': '1.0', '35mm': '1.6', '50mm': '2.5',
      '75mm': '3.8', '85mm': '4.4', '135mm': '7.2',
    };
    const apertureFactors: Record<string, string> = {
      'f1.4': '1.0', 'f2': '0.71', 'f2.8': '0.5',
      'f4': '0.35', 'f5.6': '0.25', 'f8': '0.18',
    };

    const fl    = (node.params.focal_length as string) ?? '50mm';
    const ap    = (node.params.aperture     as string) ?? 'f2.8';
    const shape = (node.params.bokeh_shape  as string) ?? 'disc';
    const ffac  = focalFactors[fl]  ?? '2.5';
    const afac  = apertureFactors[ap] ?? '0.5';
    const fd    = p(node.params.focus_distance, 0.25);
    const boost = p(node.params.boost, 1.0);

    const samplerFn = shape === 'hex' ? 'lensBlurHex' : shape === 'oct' ? 'lensBlurOct' : 'lensBlurDisc';

    const lines: string[] = [
      `    vec2  ${id}_uv01 = clamp(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
      `    vec2  ${id}_px   = 1.0 / u_resolution;\n`,
      `    float ${id}_dist = length(${uvVar} - ${fpVar});\n`,
      `    float ${id}_coc  = max(0.0, ${id}_dist - ${fd}) * ${ffac} * ${afac} * ${boost};\n`,
      `    vec3  ${id}_result = ${samplerFn}(u_prevFrame, ${id}_uv01, ${id}_px, ${id}_coc, ${col});\n`,
    ];

    return {
      code: lines.join(''),
      outputVars: { result: `${id}_result`, coc: `${id}_coc` },
    };
  },
};

// ─── Depth of Field (post-process) ───────────────────────────────────────────
// Reads dist from marchLoopGroup (world-unit ray distance). Pixels whose depth
// deviates from focalDist by more than focalRange get a bokeh disc blur sampled
// from u_prevFrame. Reuses the lensBlurDisc/Hex/Oct helpers from LensBlurNode.

export const DepthOfFieldNode: NodeDefinition = {
  type: 'depthOfField',
  label: 'Depth of Field',
  category: 'Effects',
  description: 'Smooth post-process DoF. Wire color + dist from marchLoopGroup. Pixels far from the focal plane get a soft bokeh blur. Disc/Hex/Oct bokeh shapes.',
  inputs: {
    color: { type: 'vec3',  label: 'Color' },
    uv:    { type: 'vec2',  label: 'UV'    },
    dist:  { type: 'float', label: 'Dist'  },
  },
  outputs: {
    result: { type: 'vec3',  label: 'Result' },
    coc:    { type: 'float', label: 'CoC'    },
  },
  defaultParams: {
    focalDist:  3.0,
    focalRange: 1.0,
    maxBlur:    8.0,
    bokehShape: 'disc',
  },
  paramDefs: {
    focalDist:  { label: 'Focal Dist',  type: 'float' as const, min: 0.1,  max: 50.0, step: 0.1,  hint: 'World-unit depth that stays sharp. Match your camera camDist for tight focus.' },
    focalRange: { label: 'Focal Range', type: 'float' as const, min: 0.05, max: 20.0, step: 0.05, hint: 'Depth band around focalDist that stays sharp. Smaller = shallower DoF.' },
    maxBlur:    { label: 'Max Blur',    type: 'float' as const, min: 0.0,  max: 24.0, step: 0.5,  hint: 'Maximum bokeh disc radius in pixels.' },
    bokehShape: { label: 'Bokeh Shape', type: 'select' as const, options: [
      { value: 'disc', label: 'Disc (circular)' },
      { value: 'hex',  label: 'Hex (6-blade)'   },
      { value: 'oct',  label: 'Oct (8-blade)'   },
    ]},
  },
  glslFunction: LENS_BLUR_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const col   = inputVars.color || 'vec3(0.0)';
    const uvVar = inputVars.uv    || 'g_uv';
    const dist  = inputVars.dist  || '0.0';
    const fd    = p(node.params.focalDist,  3.0);
    const fr    = p(node.params.focalRange, 1.0);
    const mb    = p(node.params.maxBlur,    8.0);
    const shape = (node.params.bokehShape as string) ?? 'disc';
    const fn    = shape === 'hex' ? 'lensBlurHex' : shape === 'oct' ? 'lensBlurOct' : 'lensBlurDisc';
    return {
      code: [
        `    vec2  ${id}_uv01   = clamp(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
        `    vec2  ${id}_px     = 1.0 / u_resolution;\n`,
        `    float ${id}_coc    = clamp(abs(${dist} - ${fd}) / max(${fr}, 0.001), 0.0, ${mb});\n`,
        `    vec3  ${id}_result = ${fn}(u_prevFrame, ${id}_uv01, ${id}_px, ${id}_coc, ${col});\n`,
      ].join(''),
      outputVars: { result: `${id}_result`, coc: `${id}_coc` },
    };
  },
};

// ─── Motion Blur ─────────────────────────────────────────────────────────────
// Temporal accumulation: blends current scene with the previous frame.
// Creates smooth motion trails for animated shaders. Fast-moving elements
// leave beautiful light streaks; persistence controls how long trails linger.

export const MotionBlurNode: NodeDefinition = {
  type: 'motionBlur',
  label: 'Motion Blur',
  category: 'Effects',
  description: 'Temporal accumulation motion blur. Blends the current frame with the previous frame to create motion trails. Adjust persistence to control trail length.',
  inputs: {
    color: { type: 'vec3', label: 'Color' },
    uv:    { type: 'vec2', label: 'UV'   },
  },
  outputs: {
    result: { type: 'vec3', label: 'Result' },
  },
  defaultParams: {
    persistence:   0.65,
    feedback_gain: 1.0,
    decay_r: 1.0, decay_g: 1.0, decay_b: 1.0,
  },
  paramDefs: {
    persistence:   { label: 'Persistence',    type: 'float', min: 0.0, max: 0.98, step: 0.01 },
    feedback_gain: { label: 'Feedback Gain',  type: 'float', min: 0.5, max: 2.0,  step: 0.01 },
    decay_r: { label: 'Decay R', type: 'float', min: 0.0, max: 1.0, step: 0.01 },
    decay_g: { label: 'Decay G', type: 'float', min: 0.0, max: 1.0, step: 0.01 },
    decay_b: { label: 'Decay B', type: 'float', min: 0.0, max: 1.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const col   = inputVars.color || 'vec3(0.0)';
    const uvVar = inputVars.uv    || 'g_uv';
    const pers  = p(node.params.persistence,   0.65);
    const gain  = p(node.params.feedback_gain, 1.0);
    const dr    = p(node.params.decay_r, 1.0);
    const dg    = p(node.params.decay_g, 1.0);
    const db    = p(node.params.decay_b, 1.0);

    return {
      code: [
        `    vec2  ${id}_uv01   = clamp(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
        `    vec3  ${id}_prev   = texture2D(u_prevFrame, ${id}_uv01).rgb * vec3(${dr}, ${dg}, ${db});\n`,
        `    vec3  ${id}_result = clamp(mix(${col}, ${id}_prev, ${pers}) * ${gain}, 0.0, 1.0);\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};

// ─── Bloom ────────────────────────────────────────────────────────────────────
// Multi-tap bright-pixel extraction from u_prevFrame with gaussian weighting.
// Pixels above the threshold glow; knee softens the cutoff edge. The bloom
// accumulates over frames via u_prevFrame feedback — converges in 1-2 frames.

export const BloomNode: NodeDefinition = {
  type: 'bloom',
  label: 'Bloom',
  category: 'Effects',
  description: 'Photographic glow from bright pixels. Wire scene color + UV, connect result to Output. Threshold sets the brightness cutoff; Knee softens it.',
  inputs: {
    color: { type: 'vec3', label: 'Color' },
    uv:    { type: 'vec2', label: 'UV'    },
  },
  outputs: {
    result: { type: 'vec3', label: 'Result'    },
    glow:   { type: 'vec3', label: 'Glow Only' },
  },
  defaultParams: { threshold: 0.6, knee: 0.15, intensity: 1.5, radius: 6.0, quality: 'standard' },
  paramDefs: {
    threshold: { label: 'Threshold',   type: 'float', min: 0.0, max: 2.0,  step: 0.01 },
    knee:      { label: 'Knee',        type: 'float', min: 0.0, max: 0.5,  step: 0.01 },
    intensity: { label: 'Intensity',   type: 'float', min: 0.0, max: 8.0,  step: 0.05 },
    radius:    { label: 'Radius (px)', type: 'float', min: 1.0, max: 32.0, step: 0.5  },
    quality:   { label: 'Quality', type: 'select', options: [
      { value: 'fast',     label: 'Fast (3×3)'   },
      { value: 'standard', label: 'Medium (5×5)' },
      { value: 'high',     label: 'High (7×7)'   },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id        = node.id;
    const col       = inputVars.color || 'vec3(0.0)';
    const uvVar     = inputVars.uv    || 'g_uv';
    const threshold = p(node.params.threshold, 0.6);
    const knee      = p(node.params.knee,      0.15);
    const intensity = p(node.params.intensity, 1.5);
    const radius    = p(node.params.radius,    6.0);
    const quality   = (node.params.quality as string) ?? 'standard';
    const half_n    = quality === 'fast' ? 1 : quality === 'high' ? 3 : 2;
    const sigma     = half_n === 1 ? 1.0 : half_n === 3 ? 2.0 : 1.5;

    const gw = (x: number, y: number) => Math.exp(-0.5 * (x * x + y * y) / (sigma * sigma));

    // Inline knee: quadratic ramp from (threshold-knee) to (threshold+knee)
    // bright = 0 below lo, linear above hi, smooth quadratic in between
    const lo = `(${threshold} - ${knee})`;
    const hi = `(${threshold} + ${knee})`;

    const lines: string[] = [
      `    vec2  ${id}_uv01 = clamp(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
      `    vec2  ${id}_px   = 1.0 / u_resolution;\n`,
      `    vec3  ${id}_glow = vec3(0.0);\n`,
      `    float ${id}_wsum = 0.0001;\n`,
    ];

    for (let gx = -half_n; gx <= half_n; gx++) {
      for (let gy = -half_n; gy <= half_n; gy++) {
        const w = f(gw(gx, gy));
        lines.push(
          `    { vec3 ${id}_s = texture2D(u_prevFrame, clamp(${id}_uv01 + vec2(${f(gx)},${f(gy)}) * ${id}_px * ${radius}, 0.0, 1.0)).rgb; ` +
          `float ${id}_l = dot(${id}_s, vec3(0.2126, 0.7152, 0.0722)); ` +
          `float ${id}_t = clamp((${id}_l - ${lo}) / max(${hi} - ${lo}, 0.0001), 0.0, 1.0); ` +
          `float ${id}_bw = mix(0.0, max(${id}_l - ${threshold}, 0.0), ${id}_t) * ${w}; ` +
          `${id}_glow += ${id}_s * ${id}_bw; ${id}_wsum += ${id}_bw; }\n`,
        );
      }
    }

    lines.push(
      `    ${id}_glow /= ${id}_wsum;\n`,
      `    ${id}_glow *= ${intensity};\n`,
      // Clamp: prevents u_prevFrame from exceeding [0,1] which causes exponential feedback
      `    vec3 ${id}_result = clamp(${col} + ${id}_glow, 0.0, 1.0);\n`,
    );

    return { code: lines.join(''), outputVars: { result: `${id}_result`, glow: `${id}_glow` } };
  },
};

// ─── Stochastic Bloom ─────────────────────────────────────────────────────────
// Random-disc samples into u_prevFrame extract bright spots with organic jitter.
// When temporal=true the hash seed shifts each frame — the per-frame noise
// averages out via u_prevFrame feedback into a smooth, painterly glow.

export const StochasticBloomNode: NodeDefinition = {
  type: 'stochasticBloom',
  label: 'Stochastic Bloom',
  category: 'Effects',
  description: 'Organic glow using random disc sampling. Temporal mode dithers samples across frames via u_prevFrame feedback, producing a smooth painterly bloom. Inspired by XorDev stochastic rendering.',
  inputs: {
    color: { type: 'vec3',  label: 'Color' },
    uv:    { type: 'vec2',  label: 'UV'    },
    time:  { type: 'float', label: 'Time'  },
  },
  outputs: {
    result: { type: 'vec3', label: 'Result'    },
    glow:   { type: 'vec3', label: 'Glow Only' },
  },
  defaultParams: { threshold: 0.5, intensity: 2.0, spread: 12.0, samples: '16', temporal: 'true' },
  paramDefs: {
    threshold: { label: 'Threshold',   type: 'float', min: 0.0, max: 2.0,  step: 0.01 },
    intensity: { label: 'Intensity',   type: 'float', min: 0.0, max: 8.0,  step: 0.05 },
    spread:    { label: 'Spread (px)', type: 'float', min: 1.0, max: 60.0, step: 0.5  },
    samples:   { label: 'Samples', type: 'select', options: [
      { value: '8',  label: '8 (fast)'    },
      { value: '16', label: '16 (medium)' },
      { value: '32', label: '32 (high)'   },
    ]},
    temporal: { label: 'Temporal', type: 'select', options: [
      { value: 'true',  label: 'On (smooth over time)' },
      { value: 'false', label: 'Off (stable pattern)'  },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id        = node.id;
    const col       = inputVars.color || 'vec3(0.0)';
    const uvVar     = inputVars.uv    || 'g_uv';
    const timeVar   = inputVars.time  || 'u_time';
    const threshold = p(node.params.threshold, 0.5);
    const intensity = p(node.params.intensity, 2.0);
    const spread    = p(node.params.spread,    12.0);
    const nSamples  = parseInt((node.params.samples as string) ?? '16', 10);
    const temporal  = (node.params.temporal as string) ?? 'true';
    const timeSeed  = temporal === 'true' ? `${timeVar} * 0.37` : '0.0';

    const lines: string[] = [
      `    vec2  ${id}_uv01 = clamp(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
      `    vec2  ${id}_px   = 1.0 / u_resolution;\n`,
      `    vec3  ${id}_glow = vec3(0.0);\n`,
    ];

    for (let i = 0; i < nSamples; i++) {
      // Inline hash using proven sin-based noise (same family as other nodes)
      const seed1 = f(i * 13.7 + 0.1);
      const seed2 = f(i * 7.31 + 0.2);
      lines.push(
        `    { vec2 ${id}_p = ${id}_uv01 + vec2(${seed1}, ${seed2}) + ${timeSeed}; ` +
        `float ${id}_hx = fract(sin(dot(${id}_p, vec2(127.1, 311.7))) * 43758.5453); ` +
        `float ${id}_hy = fract(sin(dot(${id}_p, vec2(269.5, 183.3))) * 43758.5453); ` +
        `float ${id}_ang = ${id}_hx * 6.28318; ` +
        `float ${id}_r   = sqrt(${id}_hy) * ${spread}; ` +
        `vec2  ${id}_off = vec2(cos(${id}_ang), sin(${id}_ang)) * ${id}_r * ${id}_px; ` +
        `vec3  ${id}_s   = texture2D(u_prevFrame, clamp(${id}_uv01 + ${id}_off, 0.0, 1.0)).rgb; ` +
        `float ${id}_l   = dot(${id}_s, vec3(0.2126, 0.7152, 0.0722)); ` +
        `${id}_glow += ${id}_s * max(${id}_l - ${threshold}, 0.0); }\n`,
      );
    }

    lines.push(
      `    ${id}_glow /= ${f(nSamples)};\n`,
      `    ${id}_glow *= ${intensity};\n`,
      `    vec3 ${id}_result = clamp(${col} + ${id}_glow, 0.0, 1.0);\n`,
    );

    return { code: lines.join(''), outputVars: { result: `${id}_result`, glow: `${id}_glow` } };
  },
};

// ─── Chroma Shift ─────────────────────────────────────────────────────────────
// Color-space chromatic aberration: takes an already-rendered vec3 color and
// spreads the R and B channels apart from G. Same modes as Chroma Aberration Auto
// but works directly on a color value — no UV resampling required.

export const ChromaShiftNode: NodeDefinition = {
  type: 'chromaShift',
  label: 'Chroma Shift',
  category: 'Effects',
  description: 'Color-space chromatic aberration. Spreads R and B channels apart from G using the same radial/linear/twist/barrel modes as the UV-based CA node — but works directly on a color, no resampling needed.',
  inputs: {
    color:    { type: 'vec3',  label: 'Color'    },
    uv:       { type: 'vec2',  label: 'UV'       },
    time:     { type: 'float', label: 'Time'     },
    strength: { type: 'float', label: 'Strength' },
  },
  outputs: {
    result: { type: 'vec3', label: 'Result' },
  },
  defaultParams: {
    mode:       'radial',
    strength:   0.5,
    contrast:   1.5,
    angle_deg:  0.0,
    animate:    'false',
    anim_speed: 0.4,
  },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'radial',  label: 'Radial'  },
      { value: 'linear',  label: 'Linear'  },
      { value: 'twist',   label: 'Twist'   },
      { value: 'barrel',  label: 'Barrel'  },
    ]},
    strength:   { label: 'Strength',   type: 'float', min: 0.0, max: 2.0,  step: 0.01 },
    contrast:   { label: 'Contrast',   type: 'float', min: 0.0, max: 3.0,  step: 0.05 },
    angle_deg:  { label: 'Angle (°)',  type: 'float', min: 0,   max: 360,  step: 1    },
    animate:    { label: 'Animate',    type: 'select', options: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }] },
    anim_speed: { label: 'Anim Speed', type: 'float', min: 0,   max: 3,    step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const col     = inputVars.color    || 'vec3(0.0)';
    const uvVar   = inputVars.uv       || 'g_uv';
    const timeVar = inputVars.time     || '0.0';
    const strIn   = inputVars.strength ?? p(node.params.strength, 0.5);
    const cont    = p(node.params.contrast,   1.5);
    const mode    = (node.params.mode as string) ?? 'radial';
    const animate = (node.params.animate as string) ?? 'false';
    const aspd    = p(node.params.anim_speed, 0.4);
    const ang     = p(node.params.angle_deg,  0.0);

    // Same animated strength expression as UV-based CA
    const strExpr = animate === 'true'
      ? `(${strIn} * (0.8 + 0.2 * sin(${timeVar} * ${aspd})))`
      : strIn;

    // Same offset vector as UV-based CA — we use its magnitude as the edge factor
    let baseOff: string;
    switch (mode) {
      case 'linear':
        baseOff = `(vec2(cos(${ang} * 3.14159 / 180.0), sin(${ang} * 3.14159 / 180.0)) * ${strExpr})`;
        break;
      case 'twist':
        baseOff = `(vec2(${uvVar}.y - 0.5, 0.5 - ${uvVar}.x) * ${strExpr})`;
        break;
      case 'barrel':
        baseOff = `(${uvVar} * dot(${uvVar}, ${uvVar}) * ${strExpr})`;
        break;
      default: // radial
        baseOff = `(normalize(${uvVar} + vec2(0.00001)) * ${strExpr} * length(${uvVar}))`;
    }

    return {
      code: [
        `    vec3  ${id}_col  = ${col};\n`,
        // Luminance of the input — works on any color including pure white/black
        `    float ${id}_luma = dot(${id}_col, vec3(0.299, 0.587, 0.114));\n`,
        // Screen-space gradient of luma — large at shape edges, zero in flat regions
        `    vec2  ${id}_grad = vec2(dFdx(${id}_luma), dFdy(${id}_luma));\n`,
        // Aberration offset vector (direction + magnitude) from chosen mode
        `    vec2  ${id}_off  = ${baseOff};\n`,
        // Fringe = gradient projected onto offset direction × magnitude × contrast
        // Positive at one side of an edge, negative at the other → R-B split
        `    float ${id}_fringe = dot(${id}_grad, normalize(${id}_off + vec2(0.00001))) * length(${id}_off) * ${cont};\n`,
        `    vec3  ${id}_result = clamp(${id}_col + vec3(${id}_fringe, 0.0, -${id}_fringe), 0.0, 1.0);\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};
