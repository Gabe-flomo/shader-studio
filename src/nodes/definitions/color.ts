import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f, vec3Str } from './helpers';

// Shared palette GLSL function — referenced by both PaletteNode and FractalLoopNode
// so the compiler's Set-based deduplication keeps exactly one copy in the shader.
export const PALETTE_GLSL_FN = `
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
}`;

export const PaletteNode: NodeDefinition = {
  type: 'palette',
  label: 'Palette',
  category: 'Color',
  description: 'Cosine-based color palette. Wire float nodes to a_r/a_g/a_b etc. to animate palette coefficients, or use the vec3 sliders as static fallbacks.',
  inputs: {
    t:   { type: 'float', label: 'T' },
    a_r: { type: 'float', label: 'a.r' },
    a_g: { type: 'float', label: 'a.g' },
    a_b: { type: 'float', label: 'a.b' },
    b_r: { type: 'float', label: 'b.r' },
    b_g: { type: 'float', label: 'b.g' },
    b_b: { type: 'float', label: 'b.b' },
    c_r: { type: 'float', label: 'c.r' },
    c_g: { type: 'float', label: 'c.g' },
    c_b: { type: 'float', label: 'c.b' },
    d_r: { type: 'float', label: 'd.r' },
    d_g: { type: 'float', label: 'd.g' },
    d_b: { type: 'float', label: 'd.b' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
  },
  defaultParams: {
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.33, 0.67],
  },
  paramDefs: {
    a: { label: 'A (offset)',    type: 'vec3', min: -3.14159, max: 3.14159, step: 0.01 },
    b: { label: 'B (amplitude)', type: 'vec3', min: -3.14159, max: 3.14159, step: 0.01 },
    c: { label: 'C (frequency)', type: 'vec3', min: -3.14159, max: 3.14159, step: 0.01 },
    d: { label: 'D (phase)',     type: 'vec3', min: -3.14159, max: 3.14159, step: 0.01 },
  },
  glslFunction: PALETTE_GLSL_FN,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_color`;
    const tVar = inputVars.t || '0.0';
    const aV = Array.isArray(node.params.a) ? node.params.a as number[] : [0.5, 0.5, 0.5];
    const bV = Array.isArray(node.params.b) ? node.params.b as number[] : [0.5, 0.5, 0.5];
    const cV = Array.isArray(node.params.c) ? node.params.c as number[] : [1.0, 1.0, 1.0];
    const dV = Array.isArray(node.params.d) ? node.params.d as number[] : [0.0, 0.33, 0.67];
    const aR = inputVars.a_r || f(aV[0]); const aG = inputVars.a_g || f(aV[1]); const aB = inputVars.a_b || f(aV[2]);
    const bR = inputVars.b_r || f(bV[0]); const bG = inputVars.b_g || f(bV[1]); const bB = inputVars.b_b || f(bV[2]);
    const cR = inputVars.c_r || f(cV[0]); const cG = inputVars.c_g || f(cV[1]); const cB = inputVars.c_b || f(cV[2]);
    const dR = inputVars.d_r || f(dV[0]); const dG = inputVars.d_g || f(dV[1]); const dB = inputVars.d_b || f(dV[2]);
    return {
      code: `    vec3 ${outVar} = palette(${tVar}, vec3(${aR},${aG},${aB}), vec3(${bR},${bG},${bB}), vec3(${cR},${cG},${cB}), vec3(${dR},${dG},${dB}));\n`,
      outputVars: { color: outVar },
    };
  },
};

// ─── Palette Preset data ───────────────────────────────────────────────────────

interface PalettePreset {
  name: string;
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  d: [number, number, number];
}

const PALETTE_PRESETS: PalettePreset[] = [
  { name: 'IQ Blue-Teal',  a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.0,0.1,0.2] },
  { name: 'IQ Rainbow',    a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.0,0.33,0.67] },
  { name: 'IQ Warm',       a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.3,0.2,0.2] },
  { name: 'IQ Lemon',      a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,0.5], d:[0.8,0.9,0.3] },
  { name: 'Sunset',        a:[0.5,0.5,0.5], b:[0.4431,0.4235,0.4235], c:[1.0,0.7,0.4], d:[0.0,0.15,0.2] },
  { name: 'Fire',          a:[0.5,0.5,0.5], b:[0.4431,0.4235,0.4235], c:[2.0,1.0,0.0], d:[0.5,0.2,0.25] },
  { name: 'Forest',        a:[0.8,0.5,0.4], b:[0.2,0.4,0.2], c:[2.0,1.0,1.0], d:[0.0,0.25,0.25] },
  { name: 'Purple Haze',   a:[0.721,0.328,0.542], b:[0.659,0.181,0.896], c:[0.612,0.14,0.196], d:[0.538,0.978,0.7] },
  { name: 'Deep Purple',   a:[0.412,0.102,0.491], b:[0.397,0.13,0.485],  c:[0.612,0.14,0.196], d:[0.538,0.978,0.7] },
  { name: 'Psychedelic',   a:[0.412,0.202,0.491], b:[0.397,0.13,0.485],  c:[1.147,1.557,1.197], d:[1.956,5.039,2.541] },
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
    const tOffset  = inputVars.t_offset ?? f(typeof node.params.t_offset === 'number' ? node.params.t_offset : 0.0);
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
    const p = PALETTE_PRESETS[Math.min(idx, PALETTE_PRESETS.length - 1)] ?? PALETTE_PRESETS[1];
    const fv = (v: number) => v.toFixed(6);
    const av = `vec3(${fv(p.a[0])},${fv(p.a[1])},${fv(p.a[2])})`;
    const bv = `vec3(${fv(p.b[0])},${fv(p.b[1])},${fv(p.b[2])})`;
    const cv = `vec3(${fv(p.c[0])},${fv(p.c[1])},${fv(p.c[2])})`;
    const dv = `vec3(${fv(p.d[0])},${fv(p.d[1])},${fv(p.d[2])})`;
    return {
      code: [
        `    vec3 ${outVar};\n`,
        `    {\n`,
        `        vec3 _pa = ${av}; vec3 _pb = ${bv};\n`,
        `        vec3 _pc = ${cv}; vec3 _pd = ${dv};\n`,
        `        ${outVar} = _pa + _pb * cos(6.283185 * (_pc * ${tVar} + _pd));\n`,
        `    }\n`,
      ].join(''),
      outputVars: { color: outVar },
    };
  },
};
