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
  category: 'Presets',
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
  category: 'Presets',
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
  category: 'Presets',
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

export const ExprNode: NodeDefinition = {
  type: 'expr',
  label: 'Expr',
  category: 'Sources',
  description: 'Write a single-line GLSL expression. Name each input slot, wire nodes into them, then use the names in your formula. Output type sets the declared GLSL type.',
  inputs: {
    in0: { type: 'float', label: 'in0' },
    in1: { type: 'float', label: 'in1' },
    in2: { type: 'float', label: 'in2' },
    in3: { type: 'float', label: 'in3' },
  },
  outputs: {
    result: { type: 'float', label: 'Result' },
  },
  defaultParams: { expr: 'in0', outputType: 'float', in0Name: 'in0', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' },
  paramDefs: {
    expr:       { label: 'Expression', type: 'string' },
    outputType: { label: 'Output Type', type: 'select', options: [
      { value: 'float', label: 'float' },
      { value: 'vec2',  label: 'vec2'  },
      { value: 'vec3',  label: 'vec3'  },
    ]},
    in0Name: { label: 'in0 name', type: 'string' },
    in1Name: { label: 'in1 name', type: 'string' },
    in2Name: { label: 'in2 name', type: 'string' },
    in3Name: { label: 'in3 name', type: 'string' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outType = (node.params.outputType as string) || 'float';
    const outVar  = `${node.id}_result`;
    let expr = (node.params.expr as string) || '0.0';
    for (let i = 0; i < 4; i++) {
      const rawName = (node.params[`in${i}Name`] as string) ?? `in${i}`;
      const name = rawName.trim();
      if (!name) continue;
      const glslVar = inputVars[`in${i}`] || (outType === 'vec2' ? 'vec2(0.0)' : outType === 'vec3' ? 'vec3(0.0)' : '0.0');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expr = expr.replace(new RegExp(`\\b${escaped}\\b`, 'g'), glslVar);
    }
    return { code: `    ${outType} ${outVar} = ${expr};\n`, outputVars: { result: outVar } };
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
