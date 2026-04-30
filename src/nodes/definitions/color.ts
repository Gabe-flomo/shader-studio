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
    t:           { type: 'float', label: 'T', defaultValue: 0 },
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

export const PALETTE_PRESETS: PalettePreset[] = [
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
    t: { type: 'float', label: 'T', defaultValue: 0 },
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

export const HSV_GLSL = `
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

// ─── Hue Range ────────────────────────────────────────────────────────────────

export const HueRangeNode: NodeDefinition = {
  type: 'hueRange',
  label: 'Hue Range',
  category: 'Color',
  description: 'Boost or suppress a hue band\'s saturation. Boost > 1 = more vivid, < 1 = desaturate. Input space: RGB (default) or HSV (if already converted). Output is always RGB.',
  inputs: {
    color:      { type: 'vec3',  label: 'Color'      },
    hue_center: { type: 'float', label: 'Hue Center' },
    hue_width:  { type: 'float', label: 'Hue Width'  },
    boost:      { type: 'float', label: 'Boost'      },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color' },
    mask:  { type: 'float', label: 'Mask'  },
  },
  defaultParams: { input_space: 'rgb', hue_center: 0.0, hue_width: 0.1, boost: 2.0 },
  paramDefs: {
    input_space: {
      label: 'Input', type: 'select',
      options: [
        { value: 'rgb', label: 'RGB' },
        { value: 'hsv', label: 'HSV' },
      ],
    },
    hue_center: { label: 'Hue Center', type: 'float', min: 0.0, max: 1.0, step: 0.005 },
    hue_width:  { label: 'Hue Width',  type: 'float', min: 0.0, max: 0.5, step: 0.005 },
    boost:      { label: 'Boost',      type: 'float', min: 0.0, max: 8.0, step: 0.05  },
  },
  glslFunction: HSV_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const c   = inputVars.color      ?? 'vec3(0.5)';
    const hc  = inputVars.hue_center ?? p(node.params.hue_center, 0.0);
    const hw  = inputVars.hue_width  ?? p(node.params.hue_width,  0.1);
    const bv  = inputVars.boost      ?? p(node.params.boost,      2.0);
    const isHSVInput = (node.params.input_space as string) === 'hsv';
    // When input is already HSV, skip the rgb2hsv conversion
    const toHSV = isHSVInput ? c : `rgb2hsv(${c})`;
    return {
      code: [
        `    vec3  ${id}_hsv   = ${toHSV};\n`,
        `    float ${id}_hdiff = abs(fract(${id}_hsv.x - ${hc} + 0.5) - 0.5);\n`,
        `    float ${id}_mask  = clamp(1.0 - ${id}_hdiff / max(${hw}, 0.001), 0.0, 1.0);\n`,
        // Boost SATURATION (not value) — makes selected hue more/less vivid
        `    float ${id}_newS  = ${id}_hsv.y * (1.0 + (${bv} - 1.0) * ${id}_mask);\n`,
        // Always output RGB
        `    vec3  ${id}_color = hsv2rgb(vec3(${id}_hsv.x, clamp(${id}_newS, 0.0, 1.0), ${id}_hsv.z));\n`,
      ].join(''),
      outputVars: { color: `${id}_color`, mask: `${id}_mask` },
    };
  },
};

// ─── New Color Nodes (V2) ─────────────────────────────────────────────────────

// ColorRamp: multi-stop gradient (up to 8 stops), generates a chain of mix() calls
export const ColorRampNode: NodeDefinition = {
  type: 'colorRamp', label: 'Color Ramp', category: 'Color',
  description: 'Multi-stop gradient — up to 8 color stops, evenly spaced.',
  inputs: { t: { type: 'float', label: 't (0-1)' } },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: {
    stops: 3,
    color0: [0.0, 0.0, 0.0],
    color1: [0.5, 0.0, 1.0],
    color2: [1.0, 1.0, 1.0],
    color3: [1.0, 0.5, 0.0],
    color4: [1.0, 0.0, 0.0],
    color5: [0.0, 1.0, 0.5],
    color6: [0.0, 0.5, 1.0],
    color7: [1.0, 1.0, 0.0],
  },
  paramDefs: {
    stops:  { label: 'Stops',   type: 'select', options: [2,3,4,5,6,7,8].map(n => ({ value: String(n), label: String(n) })) },
    color0: { label: 'Stop 0',  type: 'vec3color' },
    color1: { label: 'Stop 1',  type: 'vec3color' },
    color2: { label: 'Stop 2',  type: 'vec3color' },
    color3: { label: 'Stop 3',  type: 'vec3color' },
    color4: { label: 'Stop 4',  type: 'vec3color' },
    color5: { label: 'Stop 5',  type: 'vec3color' },
    color6: { label: 'Stop 6',  type: 'vec3color' },
    color7: { label: 'Stop 7',  type: 'vec3color' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id     = node.id;
    const t      = inputVars.t || '0.0';
    const stops  = Math.max(2, Math.min(8, Number(node.params.stops) || 3));
    const colors = Array.from({ length: stops }, (_, i) => {
      const raw = node.params[`color${i}`];
      const arr = Array.isArray(raw) ? raw as number[] : [0.0, 0.0, 0.0];
      return vec3Str(arr);
    });
    // Build chain: for N stops there are N-1 segments evenly in [0,1]
    const lines: string[] = [];
    // Declare all stop colors
    colors.forEach((c, i) => lines.push(`    vec3 ${id}_c${i} = ${c};\n`));
    // Build nested mix chain
    let expr = `${id}_c0`;
    for (let i = 0; i < stops - 1; i++) {
      const lo = f(i / (stops - 1));
      const hi = f((i + 1) / (stops - 1));
      const seg = `clamp((${t} - ${lo}) / (${hi} - ${lo}), 0.0, 1.0)`;
      expr = `mix(${expr}, ${id}_c${i + 1}, ${seg})`;
    }
    lines.push(`    vec3 ${id}_color = ${expr};\n`);
    return { code: lines.join(''), outputVars: { color: `${id}_color` } };
  },
};

// BlendModes: full Photoshop-style blend operations
export const BlendModesNode: NodeDefinition = {
  type: 'blendModes', label: 'Blend Modes', category: 'Color',
  description: 'Photoshop-style blend operations: Multiply, Screen, Overlay, Soft Light, Hard Light, Difference, Exclusion, Dodge, Burn, Lighten, Darken.',
  inputs: {
    base:    { type: 'vec3', label: 'Base' },
    blend:   { type: 'vec3', label: 'Blend' },
    opacity: { type: 'float', label: 'Opacity' },
  },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: { mode: 'multiply', opacity: 1.0 },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'multiply',    label: 'Multiply' },
      { value: 'screen',      label: 'Screen' },
      { value: 'overlay',     label: 'Overlay' },
      { value: 'soft_light',  label: 'Soft Light' },
      { value: 'hard_light',  label: 'Hard Light' },
      { value: 'difference',  label: 'Difference' },
      { value: 'exclusion',   label: 'Exclusion' },
      { value: 'dodge',       label: 'Color Dodge' },
      { value: 'burn',        label: 'Color Burn' },
      { value: 'lighten',     label: 'Lighten' },
      { value: 'darken',      label: 'Darken' },
    ]},
    opacity: { label: 'Opacity', type: 'float', min: 0.0, max: 1.0, step: 0.01 },
  },
  glslFunction: `
vec3 blendMultiply(vec3 b, vec3 s) { return b * s; }
vec3 blendScreen(vec3 b, vec3 s) { return 1.0 - (1.0 - b) * (1.0 - s); }
vec3 blendOverlay(vec3 b, vec3 s) {
    return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, b));
}
vec3 blendSoftLight(vec3 b, vec3 s) {
    return mix(2.0*b*s + b*b*(1.0-2.0*s), sqrt(b)*(2.0*s-1.0)+2.0*b*(1.0-s), step(0.5, s));
}
vec3 blendHardLight(vec3 b, vec3 s) {
    return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, s));
}
vec3 blendDifference(vec3 b, vec3 s) { return abs(b - s); }
vec3 blendExclusion(vec3 b, vec3 s) { return b + s - 2.0*b*s; }
vec3 blendDodge(vec3 b, vec3 s) { return clamp(b / max(1.0 - s, 0.001), 0.0, 1.0); }
vec3 blendBurn(vec3 b, vec3 s) { return 1.0 - clamp((1.0 - b) / max(s, 0.001), 0.0, 1.0); }
vec3 blendLighten(vec3 b, vec3 s) { return max(b, s); }
vec3 blendDarken(vec3 b, vec3 s) { return min(b, s); }`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const base    = inputVars.base    || 'vec3(0.5)';
    const blend   = inputVars.blend   || 'vec3(0.5)';
    const opacity = inputVars.opacity || p(node.params.opacity, 1.0);
    const mode    = String(node.params.mode || 'multiply');
    const fnMap: Record<string, string> = {
      multiply:   'blendMultiply',
      screen:     'blendScreen',
      overlay:    'blendOverlay',
      soft_light: 'blendSoftLight',
      hard_light: 'blendHardLight',
      difference: 'blendDifference',
      exclusion:  'blendExclusion',
      dodge:      'blendDodge',
      burn:       'blendBurn',
      lighten:    'blendLighten',
      darken:     'blendDarken',
    };
    const fn = fnMap[mode] || 'blendMultiply';
    return {
      code: `    vec3 ${id}_result = mix(${base}, ${fn}(${base}, ${blend}), clamp(${opacity}, 0.0, 1.0));\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

// BrightnessContrast
export const BrightnessContrastNode: NodeDefinition = {
  type: 'brightnessContrast', label: 'Brightness / Contrast', category: 'Color',
  description: 'Adjust brightness and contrast of a vec3 color.',
  inputs: {
    color:      { type: 'vec3',  label: 'Color' },
    brightness: { type: 'float', label: 'Brightness' },
    contrast:   { type: 'float', label: 'Contrast' },
  },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: { brightness: 0.0, contrast: 1.0 },
  paramDefs: {
    brightness: { label: 'Brightness', type: 'float', min: -1.0, max: 1.0, step: 0.01 },
    contrast:   { label: 'Contrast',   type: 'float', min:  0.0, max: 4.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const c   = inputVars.color      || 'vec3(0.5)';
    const br  = inputVars.brightness || p(node.params.brightness, 0.0);
    const con = inputVars.contrast   || p(node.params.contrast,   1.0);
    return {
      code: `    vec3 ${id}_result = clamp((${c} - 0.5) * ${con} + 0.5 + ${br}, 0.0, 1.0);\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

// ─── Color Grading Suite ──────────────────────────────────────────────────────

// Lift/Gamma/Gain: classic 3-way color correction
// lift shifts black point (additive), gain scales whites (multiplicative),
// gamma applies a power curve to midtones.
export const LiftGammaGainNode: NodeDefinition = {
  type: 'liftGammaGain', label: 'Lift / Gamma / Gain', category: 'Color Grading',
  description: 'Classic 3-way color correction. Lift shifts shadows (additive), Gain scales highlights (multiplicative), Gamma applies a per-channel power curve to midtones.',
  inputs: {
    color: { type: 'vec3', label: 'Color' },
    lift:  { type: 'vec3', label: 'Lift'  },
    gamma: { type: 'vec3', label: 'Gamma' },
    gain:  { type: 'vec3', label: 'Gain'  },
  },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { lift: [0.0, 0.0, 0.0], gamma: [1.0, 1.0, 1.0], gain: [1.0, 1.0, 1.0] },
  paramDefs: {
    lift:  { label: 'Lift',  type: 'vec3', min: -1.0, max: 1.0, step: 0.01 },
    gamma: { label: 'Gamma', type: 'vec3', min:  0.1, max: 4.0, step: 0.01 },
    gain:  { label: 'Gain',  type: 'vec3', min:  0.0, max: 4.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const c  = inputVars.color ?? 'vec3(0.5)';
    const lv = Array.isArray(node.params.lift)  ? node.params.lift  as number[] : [0, 0, 0];
    const gv = Array.isArray(node.params.gamma) ? node.params.gamma as number[] : [1, 1, 1];
    const kv = Array.isArray(node.params.gain)  ? node.params.gain  as number[] : [1, 1, 1];
    const lt = inputVars.lift  ?? `vec3(${f(lv[0])}, ${f(lv[1])}, ${f(lv[2])})`;
    const gm = inputVars.gamma ?? `vec3(${f(gv[0])}, ${f(gv[1])}, ${f(gv[2])})`;
    const gn = inputVars.gain  ?? `vec3(${f(kv[0])}, ${f(kv[1])}, ${f(kv[2])})`;
    return {
      code: [
        `    vec3 ${id}_g = max(${gm}, vec3(0.001));\n`,
        `    vec3 ${id}_lifted = max(${c} * ${gn} + ${lt}, vec3(0.0));\n`,
        `    vec3 ${id}_color = vec3(\n`,
        `        pow(${id}_lifted.r, 1.0 / ${id}_g.r),\n`,
        `        pow(${id}_lifted.g, 1.0 / ${id}_g.g),\n`,
        `        pow(${id}_lifted.b, 1.0 / ${id}_g.b));\n`,
      ].join(''),
      outputVars: { color: `${id}_color` },
    };
  },
};

// Hue Rotate: rotates all hues by an angle (radians) by rotating around the
// neutral-gray axis (1,1,1)/√3 in RGB space via Rodrigues' formula.
export const HueRotateNode: NodeDefinition = {
  type: 'hueRotate', label: 'Hue Rotate', category: 'Color Grading',
  description: 'Rotate all hues by angle (radians). Uses a matrix rotation around the neutral-gray (1,1,1) axis in RGB space — preserves luminance.',
  inputs: {
    color: { type: 'vec3',  label: 'Color' },
    angle: { type: 'float', label: 'Angle' },
  },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { angle: 0.0 },
  paramDefs: { angle: { label: 'Angle (rad)', type: 'float', min: -3.14159, max: 3.14159, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const c  = inputVars.color ?? 'vec3(0.5)';
    const a  = inputVars.angle ?? p(node.params.angle, 0.0);
    return {
      code: [
        `    float ${id}_c = cos(${a});\n`,
        `    float ${id}_s = sin(${a});\n`,
        `    float ${id}_lum = dot(${c}, vec3(0.333333));\n`,
        `    vec3  ${id}_cross = vec3((${c}).g - (${c}).b, (${c}).b - (${c}).r, (${c}).r - (${c}).g);\n`,
        `    vec3  ${id}_color = ${c} * ${id}_c + ${id}_cross * (${id}_s * 0.57735) + vec3(${id}_lum) * (1.0 - ${id}_c);\n`,
      ].join(''),
      outputVars: { color: `${id}_color` },
    };
  },
};

// Saturation: mix between grayscale luminance and original color.
// amount=1 → original, amount=0 → grayscale, amount>1 → hyper-saturated.
export const SaturationNode: NodeDefinition = {
  type: 'colorSaturation', label: 'Saturation', category: 'Color Grading',
  description: 'Scale color saturation. 1 = unchanged, 0 = grayscale, >1 = hyper-saturated, <0 = inverted chrominance. Wire a float node to override the slider.',
  inputs: {
    color:  { type: 'vec3',  label: 'Color'  },
    amount: { type: 'float', label: 'Amount' },
  },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { amount: 1.0 },
  paramDefs: { amount: { label: 'Amount', type: 'float', min: 0.0, max: 3.0, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const c   = inputVars.color  ?? 'vec3(0.5)';
    const amt = inputVars.amount ?? p(node.params.amount, 1.0);
    return {
      code: [
        `    float ${id}_lum = dot(${c}, vec3(0.2126, 0.7152, 0.0722));\n`,
        `    vec3  ${id}_color = mix(vec3(${id}_lum), ${c}, ${amt});\n`,
      ].join(''),
      outputVars: { color: `${id}_color` },
    };
  },
};

// Shadows/Highlights: push shadows and highlights independently using a
// luminance mask. Positive shadows = brighten darks, negative = crush them.
export const ShadowsHighlightsNode: NodeDefinition = {
  type: 'shadowsHighlights', label: 'Shadows / Highlights', category: 'Color Grading',
  description: 'Push shadows and highlights independently. Uses a luminance mask: positive shadows lifts darks, negative crushes them. Pivot sets the midpoint.',
  inputs: {
    color:      { type: 'vec3',  label: 'Color'      },
    shadows:    { type: 'float', label: 'Shadows'    },
    highlights: { type: 'float', label: 'Highlights' },
  },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { shadows: 0.0, highlights: 0.0, pivot: 0.5 },
  paramDefs: {
    shadows:    { label: 'Shadows',    type: 'float', min: -1.0, max: 1.0, step: 0.01 },
    highlights: { label: 'Highlights', type: 'float', min: -1.0, max: 1.0, step: 0.01 },
    pivot:      { label: 'Pivot',      type: 'float', min:  0.1, max: 0.9, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const c   = inputVars.color      ?? 'vec3(0.5)';
    const sh  = inputVars.shadows    ?? p(node.params.shadows,    0.0);
    const hi  = inputVars.highlights ?? p(node.params.highlights, 0.0);
    const pv  = p(node.params.pivot, 0.5);
    return {
      code: [
        `    float ${id}_lum    = dot(${c}, vec3(0.2126, 0.7152, 0.0722));\n`,
        `    float ${id}_shMask = 1.0 - smoothstep(0.0, ${pv}, ${id}_lum);\n`,
        `    float ${id}_hiMask = smoothstep(${pv}, 1.0, ${id}_lum);\n`,
        `    vec3  ${id}_color  = clamp(${c} + ${id}_shMask * ${sh} + ${id}_hiMask * ${hi}, vec3(0.0), vec3(1.0));\n`,
      ].join(''),
      outputVars: { color: `${id}_color` },
    };
  },
};

// Tone Curve: remap the tonal range with a black point, white point, and
// S-curve strength. Blacks/whites set the input range; strength blends
// between linear and the smoothstep S-curve.
export const ToneCurveNode: NodeDefinition = {
  type: 'toneCurve', label: 'Tone Curve', category: 'Color Grading',
  description: 'Remap tonal range. Blacks sets the dark floor, Whites sets the bright ceiling, Strength blends between linear (0) and a smoothstep S-curve (1).',
  inputs: {
    color:    { type: 'vec3',  label: 'Color'    },
    strength: { type: 'float', label: 'Strength' },
  },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { blacks: 0.0, whites: 1.0, strength: 0.5 },
  paramDefs: {
    blacks:   { label: 'Blacks',   type: 'float', min: -0.5, max: 0.5,  step: 0.01 },
    whites:   { label: 'Whites',   type: 'float', min:  0.5, max: 2.0,  step: 0.01 },
    strength: { label: 'Strength', type: 'float', min:  0.0, max: 1.0,  step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const c   = inputVars.color    ?? 'vec3(0.5)';
    const str = inputVars.strength ?? p(node.params.strength, 0.5);
    const bl  = p(node.params.blacks, 0.0);
    const wh  = p(node.params.whites, 1.0);
    return {
      code: [
        `    vec3  ${id}_r  = clamp((${c} - vec3(${bl})) / max(${wh} - ${bl}, 0.001), vec3(0.0), vec3(1.0));\n`,
        `    vec3  ${id}_sc = ${id}_r * ${id}_r * (3.0 - 2.0 * ${id}_r);\n`,
        `    vec3  ${id}_color = mix(${id}_r, ${id}_sc, ${str});\n`,
      ].join(''),
      outputVars: { color: `${id}_color` },
    };
  },
};

// Blackbody: converts color temperature (Kelvin) to approximate RGB
// Uses IQ's polynomial fit for [1000K .. 12000K]
export const BlackbodyNode: NodeDefinition = {
  type: 'blackbody', label: 'Blackbody', category: 'Color',
  description: 'Convert color temperature in Kelvin to an approximate RGB color (1000K – 12000K).',
  inputs: { kelvin: { type: 'float', label: 'Kelvin' } },
  outputs: { color: { type: 'vec3', label: 'Color' } },
  defaultParams: { kelvin: 6500.0 },
  paramDefs: { kelvin: { label: 'Kelvin', type: 'float', min: 1000.0, max: 12000.0, step: 100.0 } },
  glslFunction: `
vec3 blackbodyColor(float kelvin) {
    float t = clamp(kelvin, 1000.0, 12000.0) / 100.0;
    float r, g, b;
    if (t <= 66.0) {
        r = 1.0;
        g = clamp((99.4708025861 * log(t) - 161.1195681661) / 255.0, 0.0, 1.0);
    } else {
        r = clamp((329.698727446 * pow(t - 60.0, -0.1332047592)) / 255.0, 0.0, 1.0);
        g = clamp((288.1221695283 * pow(t - 60.0, -0.0755148492)) / 255.0, 0.0, 1.0);
    }
    if (t >= 66.0) {
        b = 1.0;
    } else if (t <= 19.0) {
        b = 0.0;
    } else {
        b = clamp((138.5177312231 * log(t - 10.0) - 305.0447927307) / 255.0, 0.0, 1.0);
    }
    return vec3(r, g, b);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const k   = inputVars.kelvin || p(node.params.kelvin, 6500.0);
    return {
      code: `    vec3 ${id}_color = blackbodyColor(${k});\n`,
      outputVars: { color: `${id}_color` },
    };
  },
};
