import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f, p, vec3Str } from './helpers';

// Shared palette GLSL function — referenced by both PaletteNode and FractalLoopNode
// so the compiler's Set-based deduplication keeps exactly one copy in the shader.
export const PALETTE_GLSL_FN = `
vec3 palette(float t, vec3 offset, vec3 amplitude, vec3 freq, vec3 phase) {
    return offset + amplitude * cos(6.28318 * (freq * t + phase));
}`;

export const PaletteNode: NodeDefinition = {
  type: 'palette',
  label: 'Palette',
  category: 'Color',
  description: 'Cosine-based color palette. Wire float nodes to offset_r/offset_g/offset_b etc. to animate palette coefficients, or use the vec3 sliders as static fallbacks.',
  inputs: {
    t:           { type: 'float', label: 'T' },
    offset_r:    { type: 'float', label: 'offset.r' },
    offset_g:    { type: 'float', label: 'offset.g' },
    offset_b:    { type: 'float', label: 'offset.b' },
    amplitude_r: { type: 'float', label: 'amplitude.r' },
    amplitude_g: { type: 'float', label: 'amplitude.g' },
    amplitude_b: { type: 'float', label: 'amplitude.b' },
    freq_r:      { type: 'float', label: 'freq.r' },
    freq_g:      { type: 'float', label: 'freq.g' },
    freq_b:      { type: 'float', label: 'freq.b' },
    phase_r:     { type: 'float', label: 'phase.r' },
    phase_g:     { type: 'float', label: 'phase.g' },
    phase_b:     { type: 'float', label: 'phase.b' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
  },
  defaultParams: {
    offset:    [0.5, 0.5, 0.5],
    amplitude: [0.5, 0.5, 0.5],
    freq:      [1.0, 1.0, 1.0],
    phase:     [0.0, 0.33, 0.67],
  },
  paramDefs: {
    offset:    { label: 'Offset',    type: 'vec3', min: -3.14159, max: 3.14159, step: 0.01 },
    amplitude: { label: 'Amplitude', type: 'vec3', min: -3.14159, max: 3.14159, step: 0.01 },
    freq:      { label: 'Freq',      type: 'vec3', min: -3.14159, max: 3.14159, step: 0.01 },
    phase:     { label: 'Phase',     type: 'vec3', min: -3.14159, max: 3.14159, step: 0.01 },
  },
  glslFunction: PALETTE_GLSL_FN,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_color`;
    const tVar = inputVars.t || '0.0';
    const oV = Array.isArray(node.params.offset)    ? node.params.offset    as number[] : [0.5, 0.5, 0.5];
    const aV = Array.isArray(node.params.amplitude) ? node.params.amplitude as number[] : [0.5, 0.5, 0.5];
    const fV = Array.isArray(node.params.freq)      ? node.params.freq      as number[] : [1.0, 1.0, 1.0];
    const phV = Array.isArray(node.params.phase)    ? node.params.phase     as number[] : [0.0, 0.33, 0.67];
    const oR = inputVars.offset_r    || f(oV[0]);  const oG = inputVars.offset_g    || f(oV[1]);  const oB = inputVars.offset_b    || f(oV[2]);
    const aR = inputVars.amplitude_r || f(aV[0]);  const aG = inputVars.amplitude_g || f(aV[1]);  const aB = inputVars.amplitude_b || f(aV[2]);
    const fR = inputVars.freq_r      || f(fV[0]);  const fG = inputVars.freq_g      || f(fV[1]);  const fB = inputVars.freq_b      || f(fV[2]);
    const pR = inputVars.phase_r     || f(phV[0]); const pG = inputVars.phase_g     || f(phV[1]); const pB = inputVars.phase_b     || f(phV[2]);
    return {
      code: `    vec3 ${outVar} = palette(${tVar}, vec3(${oR},${oG},${oB}), vec3(${aR},${aG},${aB}), vec3(${fR},${fG},${fB}), vec3(${pR},${pG},${pB}));\n`,
      outputVars: { color: outVar },
    };
  },
};

// ─── Palette Preset data ───────────────────────────────────────────────────────

interface PalettePreset {
  name: string;
  offset:    [number, number, number];
  amplitude: [number, number, number];
  freq:      [number, number, number];
  phase:     [number, number, number];
}

const PALETTE_PRESETS: PalettePreset[] = [
  { name: 'IQ Blue-Teal',  offset:[0.5,0.5,0.5], amplitude:[0.5,0.5,0.5], freq:[1.0,1.0,1.0], phase:[0.0,0.1,0.2] },
  { name: 'IQ Rainbow',    offset:[0.5,0.5,0.5], amplitude:[0.5,0.5,0.5], freq:[1.0,1.0,1.0], phase:[0.0,0.33,0.67] },
  { name: 'IQ Warm',       offset:[0.5,0.5,0.5], amplitude:[0.5,0.5,0.5], freq:[1.0,1.0,1.0], phase:[0.3,0.2,0.2] },
  { name: 'IQ Lemon',      offset:[0.5,0.5,0.5], amplitude:[0.5,0.5,0.5], freq:[1.0,1.0,0.5], phase:[0.8,0.9,0.3] },
  { name: 'Sunset',        offset:[0.5,0.5,0.5], amplitude:[0.4431,0.4235,0.4235], freq:[1.0,0.7,0.4], phase:[0.0,0.15,0.2] },
  { name: 'Fire',          offset:[0.5,0.5,0.5], amplitude:[0.4431,0.4235,0.4235], freq:[2.0,1.0,0.0], phase:[0.5,0.2,0.25] },
  { name: 'Forest',        offset:[0.8,0.5,0.4], amplitude:[0.2,0.4,0.2], freq:[2.0,1.0,1.0], phase:[0.0,0.25,0.25] },
  { name: 'Purple Haze',   offset:[0.721,0.328,0.542], amplitude:[0.659,0.181,0.896], freq:[0.612,0.14,0.196], phase:[0.538,0.978,0.7] },
  { name: 'Deep Purple',   offset:[0.412,0.102,0.491], amplitude:[0.397,0.13,0.485],  freq:[0.612,0.14,0.196], phase:[0.538,0.978,0.7] },
  { name: 'Psychedelic',   offset:[0.412,0.202,0.491], amplitude:[0.397,0.13,0.485],  freq:[1.147,1.557,1.197], phase:[1.956,5.039,2.541] },
];

export const PALETTE_PRESET_OPTIONS = PALETTE_PRESETS.map((p, i) => ({ value: String(i), label: p.name }));

// ─── Gradient Node ────────────────────────────────────────────────────────────

const GRADIENT_GLSL = `
vec3 gradientBlend(vec2 uv, vec3 colorA, vec3 colorB, int mode, float offset) {
    float t;
    if (mode == 0) { t = uv.x * 0.5 + 0.5; }
    else if (mode == 1) { t = uv.y * 0.5 + 0.5; }
    else if (mode == 2) { t = length(uv); }
    else if (mode == 3) { t = atan(uv.y, uv.x) / 6.28318 + 0.5; }
    else { t = (uv.x + uv.y) * 0.5 * 0.7071 + 0.5; }
    return mix(colorA, colorB, clamp(t + offset, 0.0, 1.0));
}`;

export const GradientNode: NodeDefinition = {
  type: 'gradient',
  label: 'Gradient',
  category: 'Color',
  description: 'Blend between two colors across UV space. Modes: Linear X, Linear Y, Radial (distance), Angular (atan2), Diagonal.',
  inputs: {
    uv:       { type: 'vec2',  label: 'UV'       },
    color_a:  { type: 'vec3',  label: 'Color A'  },
    color_b:  { type: 'vec3',  label: 'Color B'  },
    t_offset: { type: 'float', label: 'T Offset' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
  },
  glslFunction: GRADIENT_GLSL,
  defaultParams: {
    mode: 'linear_x',
    color_a: [1.0, 0.2, 0.2],
    color_b: [0.2, 0.2, 1.0],
    t_offset: 0.0,
  },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'linear_x', label: 'Linear X'  },
      { value: 'linear_y', label: 'Linear Y'  },
      { value: 'radial',   label: 'Radial'    },
      { value: 'angular',  label: 'Angular'   },
      { value: 'diagonal', label: 'Diagonal'  },
    ]},
    color_a:  { label: 'Color A',  type: 'vec3',  min: 0, max: 1, step: 0.01 },
    color_b:  { label: 'Color B',  type: 'vec3',  min: 0, max: 1, step: 0.01 },
    t_offset: { label: 'T Offset', type: 'float', min: -1, max: 1, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uvVar    = inputVars.uv       ?? 'vec2(0.0)';
    const tOffset  = inputVars.t_offset ?? p(node.params.t_offset, 0.0);
    const modeStr  = (node.params.mode as string) ?? 'linear_x';
    const modeMap: Record<string, number> = { linear_x: 0, linear_y: 1, radial: 2, angular: 3, diagonal: 4 };
    const modeInt  = modeMap[modeStr] ?? 0;
    const aV = Array.isArray(node.params.color_a) ? node.params.color_a as number[] : [1.0, 0.2, 0.2];
    const bV = Array.isArray(node.params.color_b) ? node.params.color_b as number[] : [0.2, 0.2, 1.0];
    const colorA = inputVars.color_a ?? vec3Str(aV);
    const colorB = inputVars.color_b ?? vec3Str(bV);
    const outVar = `${id}_color`;
    return {
      code: `    vec3 ${outVar} = gradientBlend(${uvVar}, ${colorA}, ${colorB}, ${modeInt}, ${tOffset});\n`,
      outputVars: { color: outVar },
    };
  },
};

export const PalettePresetNode: NodeDefinition = {
  type: 'palettePreset',
  label: 'Palette Preset',
  category: 'Color',
  description: 'Cosine palette with named presets. Wire a float to T, pick a preset from the dropdown.',
  inputs: {
    t: { type: 'float', label: 'T' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
  },
  defaultParams: { preset: '1' },
  paramDefs: {
    preset: { label: 'Preset', type: 'select', options: PALETTE_PRESET_OPTIONS },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_color`;
    const tVar = inputVars.t || '0.0';
    const idx = parseInt((node.params.preset as string) ?? '1', 10);
    const preset = PALETTE_PRESETS[Math.min(idx, PALETTE_PRESETS.length - 1)] ?? PALETTE_PRESETS[1];
    const fv = (v: number) => v.toFixed(6);
    const ov = `vec3(${fv(preset.offset[0])},${fv(preset.offset[1])},${fv(preset.offset[2])})`;
    const av = `vec3(${fv(preset.amplitude[0])},${fv(preset.amplitude[1])},${fv(preset.amplitude[2])})`;
    const frv = `vec3(${fv(preset.freq[0])},${fv(preset.freq[1])},${fv(preset.freq[2])})`;
    const phv = `vec3(${fv(preset.phase[0])},${fv(preset.phase[1])},${fv(preset.phase[2])})`;
    return {
      code: [
        `    vec3 ${outVar};\n`,
        `    {\n`,
        `        vec3 _po = ${ov}; vec3 _pa = ${av};\n`,
        `        vec3 _pf = ${frv}; vec3 _pph = ${phv};\n`,
        `        ${outVar} = _po + _pa * cos(6.283185 * (_pf * ${tVar} + _pph));\n`,
        `    }\n`,
      ].join(''),
      outputVars: { color: outVar },
    };
  },
};

// ─── HSV ↔ RGB ────────────────────────────────────────────────────────────────

const HSV_GLSL = `
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0*d + 0.0001)), d / (q.x + 0.0001), q.x);
}
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.x + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}`;

export const HSVNode: NodeDefinition = {
  type: 'hsv',
  label: 'RGB ↔ HSV',
  category: 'Color',
  description: 'Convert between RGB and HSV. HSV → RGB lets you wire hue/saturation/value as floats for per-channel animation. RGB → HSV extracts those channels from a color.',
  inputs:  { color: { type: 'vec3', label: 'Color' } },
  outputs: { color: { type: 'vec3', label: 'Color' }, h: { type: 'float', label: 'H' }, s: { type: 'float', label: 'S' }, v: { type: 'float', label: 'V' } },
  defaultParams: { direction: 'rgb2hsv' },
  paramDefs: {
    direction: { label: 'Direction', type: 'select', options: [
      { value: 'rgb2hsv', label: 'RGB → HSV' },
      { value: 'hsv2rgb', label: 'HSV → RGB' },
    ]},
  },
  glslFunction: HSV_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const c  = inputVars.color ?? 'vec3(0.5)';
    const fn = node.params.direction === 'hsv2rgb' ? 'hsv2rgb' : 'rgb2hsv';
    return {
      code: [
        `    vec3  ${id}_color = ${fn}(${c});\n`,
        `    float ${id}_h = ${id}_color.x;\n`,
        `    float ${id}_s = ${id}_color.y;\n`,
        `    float ${id}_v = ${id}_color.z;\n`,
      ].join(''),
      outputVars: { color: `${id}_color`, h: `${id}_h`, s: `${id}_s`, v: `${id}_v` },
    };
  },
};

// ─── Posterize ────────────────────────────────────────────────────────────────

export const PosterizeNode: NodeDefinition = {
  type: 'posterize',
  label: 'Posterize',
  category: 'Color',
  description: 'Quantize color to discrete levels — cel-shading, retro, and paint-like looks. Levels=2 → pure black/white. Wire a Noise Float to levels for organic dithering.',
  inputs:  { color: { type: 'vec3', label: 'Color' }, levels: { type: 'float', label: 'Levels' } },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { levels: 8.0 },
  paramDefs: { levels: { label: 'Levels', type: 'float', min: 2, max: 64, step: 1 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const c  = inputVars.color  ?? 'vec3(0.5)';
    const lv = inputVars.levels ?? p(node.params.levels, 8.0);
    return {
      code: `    vec3 ${id}_color = floor(${c} * ${lv}) / max(${lv}, 1.0);\n`,
      outputVars: { color: `${id}_color` },
    };
  },
};

// ─── Invert ───────────────────────────────────────────────────────────────────

export const InvertNode: NodeDefinition = {
  type: 'invert',
  label: 'Invert',
  category: 'Color',
  description: 'Invert a color (1 − color). Also works for inverting SDF signs or float ranges.',
  inputs:  { color: { type: 'vec3', label: 'Color' } },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const c  = inputVars.color ?? 'vec3(0.5)';
    return {
      code: `    vec3 ${id}_color = 1.0 - ${c};\n`,
      outputVars: { color: `${id}_color` },
    };
  },
};

// ─── Desaturate ───────────────────────────────────────────────────────────────

export const DesaturateNode: NodeDefinition = {
  type: 'desaturate',
  label: 'Desaturate',
  category: 'Color',
  description: 'Blend toward grayscale. Amount=1 → full grayscale, Amount=0 → original color. Wire a Noise Float to Amount for per-pixel variation.',
  inputs:  { color: { type: 'vec3', label: 'Color' }, amount: { type: 'float', label: 'Amount' } },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { amount: 1.0 },
  paramDefs: { amount: { label: 'Amount', type: 'float', min: 0.0, max: 1.0, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const c   = inputVars.color  ?? 'vec3(0.5)';
    const amt = inputVars.amount ?? p(node.params.amount, 1.0);
    return {
      code: [
        `    float ${id}_lum   = dot(${c}, vec3(0.299, 0.587, 0.114));\n`,
        `    vec3  ${id}_color = mix(${c}, vec3(${id}_lum), ${amt});\n`,
      ].join(''),
      outputVars: { color: `${id}_color` },
    };
  },
};
