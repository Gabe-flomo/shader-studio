import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';
import { PALETTE_GLSL_FN, PALETTE_PRESET_OPTIONS } from './color';

// ─── Truchet Tiles ────────────────────────────────────────────────────────────

const TRUCHET_GLSL_FN = `
float truchetHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float truchetQuarter(vec2 uv, float scale, float lineWidth) {
    vec2 cell = floor(uv * scale);
    vec2 f2 = fract(uv * scale);
    float h = truchetHash(cell);
    if (h > 0.5) f2 = 1.0 - f2;
    float d1 = abs(length(f2 - vec2(0.0, 0.0)) - 0.5);
    float d2 = abs(length(f2 - vec2(1.0, 1.0)) - 0.5);
    return min(d1, d2) - lineWidth * 0.5;
}`;

export const TruchetNode: NodeDefinition = {
  type: 'truchet',
  label: 'Truchet Tiles',
  category: '2D Primitives',
  description: 'Truchet tiling pattern — quarter-circle arcs randomly oriented per cell. Classic woven/maze aesthetic.',
  inputs: {
    uv:      { type: 'vec2',  label: 'UV'      },
    time:    { type: 'float', label: 'Time'     },
    color_a: { type: 'vec3',  label: 'Color A'  },
    color_b: { type: 'vec3',  label: 'Color B'  },
  },
  outputs: {
    color:    { type: 'vec3',  label: 'Color'    },
    distance: { type: 'float', label: 'Distance' },
    mask:     { type: 'float', label: 'Mask'     },
  },
  glslFunction: TRUCHET_GLSL_FN,
  defaultParams: {
    scale:      8.0,
    line_width: 0.1,
    aa:         0.02,
    animate:    0.0,
    color_a:    [0.1, 0.1, 0.15],
    color_b:    [0.8, 0.8, 0.9],
  },
  paramDefs: {
    scale:      { label: 'Scale',      type: 'float', min: 1,    max: 32,   step: 0.5   },
    line_width: { label: 'Line Width', type: 'float', min: 0.01, max: 0.49, step: 0.01  },
    aa:         { label: 'Smoothness', type: 'float', min: 0.001,max: 0.1,  step: 0.001 },
    animate:    { label: 'Animate',    type: 'float', min: 0,    max: 1,    step: 0.01  },
    color_a:    { label: 'Color A',    type: 'vec3',  min: 0,    max: 1,    step: 0.01  },
    color_b:    { label: 'Color B',    type: 'vec3',  min: 0,    max: 1,    step: 0.01  },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar   = inputVars.uv      ?? 'vec2(0.0)';
    const timeVar = inputVars.time    ?? '0.0';
    const colAVar = inputVars.color_a;
    const colBVar = inputVars.color_b;

    const scale   = p(node.params.scale, 8.0);
    const lineW   = p(node.params.line_width, 0.1);
    const aa      = p(node.params.aa, 0.02);
    const animate = p(node.params.animate, 0.0);

    const colAArr  = Array.isArray(node.params.color_a) ? node.params.color_a as number[] : [0.1, 0.1, 0.15];
    const colBArr  = Array.isArray(node.params.color_b) ? node.params.color_b as number[] : [0.8, 0.8, 0.9];
    const colAExpr = colAVar ?? `vec3(${colAArr.map(v => (v as number).toFixed(3)).join(',')})`;
    const colBExpr = colBVar ?? `vec3(${colBArr.map(v => (v as number).toFixed(3)).join(',')})`;

    const code = [
      `    // Truchet Tiles\n`,
      `    vec2 ${id}_uv = ${uvVar} + ${animate} * vec2(${timeVar} * 0.1, 0.0);\n`,
      `    float ${id}_dist = truchetQuarter(${id}_uv, ${scale}, ${lineW});\n`,
      `    float ${id}_mask = smoothstep(${aa}, -${aa}, ${id}_dist);\n`,
      `    vec3  ${id}_color = mix(${colAExpr}, ${colBExpr}, ${id}_mask);\n`,
    ].join('');

    return {
      code,
      outputVars: { color: `${id}_color`, distance: `${id}_dist`, mask: `${id}_mask` },
    };
  },
};

// ─── Metaballs 2D ─────────────────────────────────────────────────────────────

const METABALLS_GLSL_FN = `
float metaballField(vec2 p, vec2 c1, vec2 c2, vec2 c3, float r1, float r2, float r3) {
    float field = 0.0;
    float d;
    d = length(p - c1); field += (r1*r1) / max(d*d, 0.0001);
    d = length(p - c2); field += (r2*r2) / max(d*d, 0.0001);
    d = length(p - c3); field += (r3*r3) / max(d*d, 0.0001);
    return field - 1.0;
}`;

export const MetaballsNode: NodeDefinition = {
  type: 'metaballs',
  label: 'Metaballs 2D',
  category: '2D Primitives',
  description: 'Three animated 2D metaballs with implicit surface coloring. Wire Time for motion, or override positions.',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV'   },
    time: { type: 'float', label: 'Time' },
    pos1: { type: 'vec2',  label: 'Ball 1 Pos' },
    pos2: { type: 'vec2',  label: 'Ball 2 Pos' },
    pos3: { type: 'vec2',  label: 'Ball 3 Pos' },
  },
  outputs: {
    field: { type: 'float', label: 'Field'  },
    color: { type: 'vec3',  label: 'Color'  },
    mask:  { type: 'float', label: 'Inside' },
  },
  glslFunction: METABALLS_GLSL_FN + '\n' + PALETTE_GLSL_FN,
  defaultParams: {
    radius1:        0.25,
    radius2:        0.2,
    radius3:        0.18,
    speed1:         0.7,
    speed2:         1.1,
    speed3:         0.9,
    threshold:      0.0,
    aa:             0.02,
    palette_preset: '4',
    color_scale:    1.0,
  },
  paramDefs: {
    radius1:        { label: 'Ball 1 Radius',  type: 'float', min: 0.05, max: 0.5, step: 0.01 },
    radius2:        { label: 'Ball 2 Radius',  type: 'float', min: 0.05, max: 0.5, step: 0.01 },
    radius3:        { label: 'Ball 3 Radius',  type: 'float', min: 0.05, max: 0.5, step: 0.01 },
    speed1:         { label: 'Ball 1 Speed',   type: 'float', min: 0.0,  max: 3.0, step: 0.1  },
    speed2:         { label: 'Ball 2 Speed',   type: 'float', min: 0.0,  max: 3.0, step: 0.1  },
    speed3:         { label: 'Ball 3 Speed',   type: 'float', min: 0.0,  max: 3.0, step: 0.1  },
    threshold:      { label: 'Threshold',      type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    aa:             { label: 'Smoothness',     type: 'float', min: 0.001,max: 0.1, step: 0.001 },
    palette_preset: { label: 'Palette',        type: 'select', options: PALETTE_PRESET_OPTIONS },
    color_scale:    { label: 'Color Scale',    type: 'float', min: 0.1,  max: 5.0, step: 0.1  },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar   = inputVars.uv   ?? 'vec2(0.0)';
    const timeVar = inputVars.time ?? '0.0';

    const r1  = p(node.params.radius1, 0.25);
    const r2  = p(node.params.radius2, 0.2);
    const r3  = p(node.params.radius3, 0.18);
    const s1  = p(node.params.speed1, 0.7);
    const s2  = p(node.params.speed2, 1.1);
    const s3  = p(node.params.speed3, 0.9);
    const thr = p(node.params.threshold, 0.0);
    const aa  = p(node.params.aa, 0.02);
    const colorScale = p(node.params.color_scale, 1.0);
    const presIdx = parseInt((node.params.palette_preset as string) ?? '4', 10);

    // Use wired positions if available, otherwise animated sinusoidal centers
    const c1 = inputVars.pos1 ?? `vec2(0.5 * sin(${timeVar} * ${s1}), 0.4 * cos(${timeVar} * ${s1} * 0.7))`;
    const c2 = inputVars.pos2 ?? `vec2(0.4 * cos(${timeVar} * ${s2}), 0.5 * sin(${timeVar} * ${s2} * 0.8))`;
    const c3 = inputVars.pos3 ?? `vec2(0.3 * sin(${timeVar} * ${s3} * 1.3), 0.35 * sin(${timeVar} * ${s3}))`;

    // Palette for coloring — use a local inline approach
    const palettes = [
      { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.0,0.1,0.2] },
      { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.0,0.33,0.67] },
      { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.3,0.2,0.2] },
      { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,0.5], d:[0.8,0.9,0.3] },
      { a:[0.5,0.5,0.5], b:[0.4431,0.4235,0.4235], c:[1.0,0.7,0.4], d:[0.0,0.15,0.2] },
      { a:[0.5,0.5,0.5], b:[0.4431,0.4235,0.4235], c:[2.0,1.0,0.0], d:[0.5,0.2,0.25] },
      { a:[0.8,0.5,0.4], b:[0.2,0.4,0.2], c:[2.0,1.0,1.0], d:[0.0,0.25,0.25] },
      { a:[0.721,0.328,0.542], b:[0.659,0.181,0.896], c:[0.612,0.14,0.196], d:[0.538,0.978,0.7] },
      { a:[0.412,0.102,0.491], b:[0.397,0.13,0.485], c:[0.612,0.14,0.196], d:[0.538,0.978,0.7] },
      { a:[0.412,0.202,0.491], b:[0.397,0.13,0.485], c:[1.147,1.557,1.197], d:[1.956,5.039,2.541] },
    ];
    const pres = palettes[Math.min(presIdx, palettes.length - 1)];
    const pv = (v: number[]) => `vec3(${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)})`;
    const [pA, pB, pC, pD] = [pv(pres.a), pv(pres.b), pv(pres.c), pv(pres.d)];

    const code = [
      `    // Metaballs 2D\n`,
      `    vec2  ${id}_c1 = ${c1};\n`,
      `    vec2  ${id}_c2 = ${c2};\n`,
      `    vec2  ${id}_c3 = ${c3};\n`,
      `    float ${id}_field = metaballField(${uvVar}, ${id}_c1, ${id}_c2, ${id}_c3, ${r1}, ${r2}, ${r3});\n`,
      `    float ${id}_mask  = smoothstep(-${aa}, ${aa}, ${id}_field - ${thr});\n`,
      `    float ${id}_ct    = clamp(${id}_field * ${colorScale}, 0.0, 1.0);\n`,
      `    vec3  ${id}_color = palette(${id}_ct, ${pA}, ${pB}, ${pC}, ${pD}) * ${id}_mask;\n`,
    ].join('');

    return {
      code,
      outputVars: { field: `${id}_field`, color: `${id}_color`, mask: `${id}_mask` },
    };
  },
};

// ─── Lissajous ───────────────────────────────────────────────────────────────

const LISSAJOUS_GLSL_FN = `
float lissajousSDF(vec2 p, float a, float b, float delta, float thickness) {
    float minD = 1e10;
    for (float t = 0.0; t < 128.0; t++) {
        float tt = t / 128.0 * 6.28318 * 2.0;
        vec2 curve = vec2(0.45 * sin(a * tt + delta), 0.45 * sin(b * tt));
        float d = length(p - curve);
        if (d < minD) minD = d;
    }
    return minD - thickness;
}`;

export const LissajousNode: NodeDefinition = {
  type: 'lissajous',
  label: 'Lissajous Curve',
  category: '2D Primitives',
  description: 'Lissajous curve SDF with configurable frequency ratios. Wire Time → delta for spinning animation.',
  inputs: {
    uv:    { type: 'vec2',  label: 'UV'    },
    time:  { type: 'float', label: 'Time'  },
    delta: { type: 'float', label: 'Phase' },
  },
  outputs: {
    distance: { type: 'float', label: 'Distance' },
    mask:     { type: 'float', label: 'Mask'     },
    color:    { type: 'vec3',  label: 'Color'    },
  },
  glslFunction: LISSAJOUS_GLSL_FN,
  defaultParams: {
    freq_a:     3,
    freq_b:     2,
    thickness:  0.02,
    aa:         0.005,
    delta:      0.0,
    delta_speed: 0.5,
    color_inner: [0.9, 0.8, 0.3],
    color_outer: [0.0, 0.0, 0.0],
  },
  paramDefs: {
    freq_a:      { label: 'Freq A',     type: 'float', min: 1,    max: 10,  step: 1    },
    freq_b:      { label: 'Freq B',     type: 'float', min: 1,    max: 10,  step: 1    },
    thickness:   { label: 'Thickness',  type: 'float', min: 0.005,max: 0.1, step: 0.005 },
    aa:          { label: 'Smoothness', type: 'float', min: 0.001,max: 0.02,step: 0.001 },
    delta:       { label: 'Phase',      type: 'float', min: 0.0,  max: 6.28,step: 0.01 },
    delta_speed: { label: 'Phase Speed',type: 'float', min: 0.0,  max: 3.0, step: 0.05 },
    color_inner: { label: 'Line Color', type: 'vec3',  min: 0,    max: 1,   step: 0.01 },
    color_outer: { label: 'BG Color',   type: 'vec3',  min: 0,    max: 1,   step: 0.01 },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar   = inputVars.uv    ?? 'vec2(0.0)';
    const timeVar = inputVars.time  ?? '0.0';

    const freqA      = p(node.params.freq_a, 3);
    const freqB      = p(node.params.freq_b, 2);
    const thickness  = p(node.params.thickness, 0.02);
    const aa         = p(node.params.aa, 0.005);
    const deltaParam = p(node.params.delta, 0.0);
    const deltaSpeed = p(node.params.delta_speed, 0.5);

    // If delta is wired, use that; otherwise animate from time
    const deltaExpr  = inputVars.delta ?? `${deltaParam} + ${timeVar} * ${deltaSpeed}`;

    const colInArr = Array.isArray(node.params.color_inner) ? node.params.color_inner as number[] : [0.9, 0.8, 0.3];
    const colOutArr = Array.isArray(node.params.color_outer) ? node.params.color_outer as number[] : [0.0, 0.0, 0.0];
    const colIn  = `vec3(${colInArr.map(v => (v as number).toFixed(3)).join(',')})`;
    const colOut = `vec3(${colOutArr.map(v => (v as number).toFixed(3)).join(',')})`;

    const code = [
      `    // Lissajous Curve\n`,
      `    float ${id}_delta = ${deltaExpr};\n`,
      `    float ${id}_distance = lissajousSDF(${uvVar}, ${freqA}, ${freqB}, ${id}_delta, ${thickness});\n`,
      `    float ${id}_mask = smoothstep(${aa}, -${aa}, ${id}_distance);\n`,
      `    vec3  ${id}_color = mix(${colOut}, ${colIn}, ${id}_mask);\n`,
    ].join('');

    return {
      code,
      outputVars: { distance: `${id}_distance`, mask: `${id}_mask`, color: `${id}_color` },
    };
  },
};
