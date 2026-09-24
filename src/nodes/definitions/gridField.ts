import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ─── Gaussian Field ───────────────────────────────────────────────────────────
// Single Gaussian emission from one source: exp(-d² · k).
// Use inside a looped group with += carry to accumulate field from multiple sources.

export const GaussianFieldNode: NodeDefinition = {
  type: 'gaussianField',
  label: 'Gaussian Field',
  category: 'Field',
  description: 'Computes a single Gaussian field emission: exp(-d²·k). 1.0 at center, falls off smoothly. Use with += carry in a looped group to accumulate from multiple sources.',
  inputs: {
    pos:    { type: 'vec2', label: 'Position' },
    center: { type: 'vec2', label: 'Center' },
  },
  outputs: {
    field: { type: 'float', label: 'Field' },
  },
  defaultParams: { k: 2.5, gridSize: 8.0 },
  paramDefs: {
    k:        { label: 'Tightness', type: 'float', min: 0.5,  max: 8.0,  step: 0.05 },
    gridSize: { label: 'Grid Size', type: 'float', min: 1.0,  max: 24.0, step: 1.0  },
  },
  glslFunction: `float gaussianFieldFn(vec2 pos, vec2 center, float k, float gridSize) {
    vec2 d = (pos - center) * gridSize;
    return exp(-dot(d, d) * k);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id     = node.id;
    const pos    = inputVars.pos    ?? 'g_uv';
    const center = inputVars.center ?? 'vec2(0.0)';
    const k      = p(node.params.k,        2.5);
    const gs     = p(node.params.gridSize, 8.0);
    return {
      code: `    float ${id}_field = gaussianFieldFn(${pos}, ${center}, ${k}, ${gs});\n`,
      outputVars: { field: `${id}_field` },
    };
  },
};

// ─── Field Accumulate ─────────────────────────────────────────────────────────
// Self-contained neighbor loop summing Gaussian contributions from a 3×3 or 5×5 grid neighborhood.
// Uses two hardcoded glslFunction strings (compiler deduplicates each via Set).

const FIELD_ACCUMULATE_3X3 = `float fieldAccumulate3x3Fn(vec2 worldPos, vec2 cellID, vec2 dotOffset, float gridSize, float k) {
    float total = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            vec2 nCell  = cellID + vec2(float(dx), float(dy));
            vec2 center = (nCell + 0.5 + dotOffset) / gridSize;
            vec2 d      = (worldPos - center) * gridSize;
            total      += exp(-dot(d, d) * k);
        }
    }
    return total;
}`;

const FIELD_ACCUMULATE_5X5 = `float fieldAccumulate5x5Fn(vec2 worldPos, vec2 cellID, vec2 dotOffset, float gridSize, float k) {
    float total = 0.0;
    for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
            vec2 nCell  = cellID + vec2(float(dx), float(dy));
            vec2 center = (nCell + 0.5 + dotOffset) / gridSize;
            vec2 d      = (worldPos - center) * gridSize;
            total      += exp(-dot(d, d) * k);
        }
    }
    return total;
}`;

export const FieldAccumulateNode: NodeDefinition = {
  type: 'fieldAccumulate',
  label: 'Field Accumulate',
  category: 'Field',
  description: 'Sums Gaussian field contributions from a 3×3 or 5×5 grid neighborhood. Quick metaball setup. For animated positions use a looped group + Gaussian Field instead.',
  inputs: {
    worldPos:  { type: 'vec2', label: 'World Pos' },
    cellID:    { type: 'vec2', label: 'Cell ID'   },
    dotOffset: { type: 'vec2', label: 'Dot Offset' },
  },
  outputs: {
    totalField: { type: 'float', label: 'Total Field' },
  },
  defaultParams: { gridSize: 8.0, k: 2.5, neighborRadius: 2 },
  paramDefs: {
    gridSize:       { label: 'Grid Size',  type: 'float',  min: 1.0, max: 24.0, step: 1.0 },
    k:              { label: 'Tightness',  type: 'float',  min: 0.5, max: 6.0,  step: 0.05 },
    neighborRadius: { label: 'Radius',     type: 'select', options: [
      { value: '1', label: '1 (3×3)' },
      { value: '2', label: '2 (5×5)' },
    ]},
  },
  glslFunctions: [FIELD_ACCUMULATE_3X3, FIELD_ACCUMULATE_5X5],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const wp  = inputVars.worldPos  ?? 'g_uv';
    const cid = inputVars.cellID    ?? 'vec2(0.0)';
    const off = inputVars.dotOffset ?? 'vec2(0.0)';
    const gs  = p(node.params.gridSize, 8.0);
    const k   = p(node.params.k, 2.5);
    const nr  = typeof node.params.neighborRadius === 'number'
      ? node.params.neighborRadius
      : parseFloat(String(node.params.neighborRadius ?? '2'));
    const fnName = nr > 1 ? 'fieldAccumulate5x5Fn' : 'fieldAccumulate3x3Fn';
    return {
      code: `    float ${id}_field = ${fnName}(${wp}, ${cid}, ${off}, ${gs}, ${k});\n`,
      outputVars: { totalField: `${id}_field` },
    };
  },
};

// ─── Metaball Threshold ───────────────────────────────────────────────────────
// Converts summed field into a blob fill and edge ring via smoothstep.

export const MetaballThresholdNode: NodeDefinition = {
  type: 'metaballThreshold',
  label: 'Metaball Threshold',
  category: 'Field',
  description: 'Converts summed Gaussian field into a blob fill and edge ring. Wire threshold to an LFO for pulsing blobs. Edge output drives neon outline effects.',
  inputs: {
    field:     { type: 'float', label: 'Field' },
    threshold: { type: 'float', label: 'Threshold' },
  },
  outputs: {
    blob: { type: 'float', label: 'Blob' },
    edge: { type: 'float', label: 'Edge' },
  },
  defaultParams: { threshold: 0.7, softness: 0.06 },
  paramDefs: {
    threshold: { label: 'Threshold', type: 'float', min: 0.2, max: 1.5,  step: 0.01  },
    softness:  { label: 'Softness',  type: 'float', min: 0.01, max: 0.2, step: 0.005 },
  },
  glslFunction: `vec2 metaballThresholdFn(float field, float thresh, float soft) {
    float blob = smoothstep(thresh - soft, thresh + soft, field);
    float edge = smoothstep(thresh + soft * 3.0, thresh + soft, field)
               * smoothstep(thresh - soft, thresh, field);
    return vec2(blob, edge);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const field = inputVars.field     ?? '0.0';
    const thr   = inputVars.threshold ?? p(node.params.threshold, 0.7);
    const soft  = p(node.params.softness, 0.06);
    return {
      code: `    vec2  ${id}_mt   = metaballThresholdFn(${field}, ${thr}, ${soft});\n` +
            `    float ${id}_blob = ${id}_mt.x;\n` +
            `    float ${id}_edge = ${id}_mt.y;\n`,
      outputVars: { blob: `${id}_blob`, edge: `${id}_edge` },
    };
  },
};

// ─── Field to Lines ───────────────────────────────────────────────────────────
// Draws the zero-crossing of any scalar field as an anti-aliased line, using
// the fwidth()+smoothstep trick the Chladni node has always used internally
// (see physics.ts). Pulled out here as a generic node — works on any float
// field: a Weighted Average of Wave Terms, a noise field, an SDF, a math
// expression. Not Chladni-specific.

export const FieldToLinesNode: NodeDefinition = {
  type: 'fieldToLines',
  label: 'Field to Lines',
  category: 'Field',
  description: 'Draws the zero-crossing of any scalar field as an anti-aliased nodal line (fwidth-based). This is the exact technique the Chladni node uses internally — generalized so it works on any float field, not just Chladni sums. Width Jitter + Grain give it a scattered, hand-drawn/sand-like texture — crank Width Jitter well past 1 for a fully dust-like edge. Grain alone controls both how much and how sporadically it reshuffles: 0 is fully static/off, and raising it makes the grain both more visible and more restless. Grain is multiplied onto the already-computed density, so it can only ever appear where the line already is — the "mask" is automatic.',
  inputs: {
    field:        { type: 'float', label: 'Field' },
    uv:           { type: 'vec2',  label: 'UV (for texture)' },
    time:         { type: 'float', label: 'Time (for grain animation)' },
    line_width:   { type: 'float', label: 'Line Width' },
    aa:           { type: 'float', label: 'AA Smooth' },
    brightness:   { type: 'float', label: 'Brightness' },
    width_jitter: { type: 'float', label: 'Width Jitter' },
    jitter_scale: { type: 'float', label: 'Jitter Scale' },
    grain:        { type: 'float', label: 'Grain' },
  },
  outputs: {
    density: { type: 'float', label: 'Density' },
    color:   { type: 'vec3',  label: 'Color'   },
  },
  defaultParams: {
    line_width:   1.5,
    aa:           1.0,
    brightness:   1.0,
    width_jitter: 0.0,
    jitter_scale: 6.0,
    grain:        0.0,
  },
  paramDefs: {
    line_width:   { label: 'Line Width',   type: 'float', min: 0.1, max: 8.0,  step: 0.05 },
    aa:           { label: 'AA Smooth',    type: 'float', min: 0.0, max: 4.0,  step: 0.1  },
    brightness:   { label: 'Brightness',   type: 'float', min: 0.1, max: 5.0,  step: 0.05 },
    width_jitter: { label: 'Width Jitter', type: 'float', min: 0.0, max: 20.0, step: 0.05, hint: 'Organic line-thickness wobble via coherent noise sampled at UV. Push well past 1 for a scattered, dust-like edge rather than a clean line. Needs UV wired.' },
    jitter_scale: { label: 'Jitter Scale', type: 'float', min: 0.5, max: 30.0, step: 0.5,  hint: 'Spatial frequency of the width-jitter noise.' },
    grain:        { label: 'Grain',        type: 'float', min: 0.0, max: 1.0,  step: 0.01, hint: 'Sand-like dropout on the finished density. 0 = off/static; raising it makes the grain both more visible AND more sporadic — it reshuffles faster as you turn it up. Needs UV+Time wired for real animated per-pixel grain.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id          = node.id;
    const fieldVar    = inputVars.field ?? '0.0';
    const lineWidth   = inputVars.line_width   ?? p(node.params.line_width, 1.5);
    const aa          = inputVars.aa           ?? p(node.params.aa, 1.0);
    const brightness  = inputVars.brightness   ?? p(node.params.brightness, 1.0);
    const widthJitter = inputVars.width_jitter ?? p(node.params.width_jitter, 0.0);
    const jitterScale = inputVars.jitter_scale ?? p(node.params.jitter_scale, 6.0);
    const grain       = inputVars.grain        ?? p(node.params.grain, 0.0);
    const timeVar     = inputVars.time ?? '0.0';
    // Falls back to a field-derived pseudo-position when UV isn't wired — keeps
    // Width Jitter/Grain usable (if less spatially coherent) without a forced input.
    const texUv       = inputVars.uv ?? `vec2(${fieldVar} * 3.7, ${fieldVar} * 1.9)`;

    const code = [
      `    vec2  ${id}_texUv  = ${texUv};\n`,
      `    float ${id}_wjN    = valueNoise(${id}_texUv * ${jitterScale}) * 2.0 - 1.0;\n`,
      `    float ${id}_fw     = fwidth(${fieldVar});\n`,
      `    float ${id}_thresh = max(${id}_fw * max(${aa}, 0.01) * (1.0 + ${id}_wjN * ${widthJitter}), 0.0001);\n`,
      `    float ${id}_density = 1.0 - smoothstep(0.0, ${id}_thresh * ${lineWidth}, abs(${fieldVar}));\n`,
      // noiseHash1 has zero temporal coherence — any change to its input fully
      // decorrelates the output, every single render frame, regardless of how
      // that change is scaled. So there's no such thing as a "slow" flicker
      // here: it's either static (grain=0, time term has no visible effect
      // since it's multiplied by 0 below) or shimmering at full frame rate —
      // which reads as smooth, like real TV static/sand vibration. Grain
      // controls how much of that shimmer shows through, not its rate.
      `    float ${id}_grainN  = noiseHash1(${id}_texUv * 45.0 + vec2(1.0, 1.37) * ${timeVar});\n`,
      `    ${id}_density *= mix(1.0, ${id}_grainN, ${grain});\n`,
      `    vec3  ${id}_color   = vec3(${id}_density * ${brightness});\n`,
    ].join('');

    return {
      code,
      outputVars: { density: `${id}_density`, color: `${id}_color` },
    };
  },
};

// ─── Distance Falloff ─────────────────────────────────────────────────────────
// Converts distance to smooth falloff using one of four physically-motivated curves.

export const DistanceFalloffNode: NodeDefinition = {
  type: 'distanceFalloff',
  label: 'Distance Falloff',
  category: 'Field',
  description: 'Converts a distance value to a smooth 0–1 falloff. Bounded inverse square is the most useful: 1.0 at d=0, decays without blowing up.',
  inputs: {
    distance: { type: 'float', label: 'Distance' },
  },
  outputs: {
    falloff: { type: 'float', label: 'Falloff' },
  },
  defaultParams: { mode: 'bounded_inv_sq', k: 5.0, power: 2.0 },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'bounded_inv_sq', label: 'Bounded Inv²' },
      { value: 'gaussian',       label: 'Gaussian'      },
      { value: 'linear',         label: 'Linear'        },
      { value: 'wyvill',         label: 'Wyvill'        },
    ]},
    k:     { label: 'Rate',  type: 'float', min: 0.1, max: 20.0, step: 0.1 },
    power: { label: 'Power', type: 'float', min: 1.0, max: 4.0,  step: 0.1, showWhen: { param: 'mode', value: 'bounded_inv_sq' } },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const d    = inputVars.distance ?? '0.0';
    const k    = p(node.params.k, 5.0);
    const pw   = p(node.params.power, 2.0);
    const mode = String(node.params.mode ?? 'bounded_inv_sq');
    let expr: string;
    if (mode === 'gaussian') {
      expr = `exp(-${d} * ${d} * ${k})`;
    } else if (mode === 'linear') {
      expr = `max(0.0, 1.0 - ${d} * ${k})`;
    } else if (mode === 'wyvill') {
      expr = `pow(max(0.0, 1.0 - ${d} * ${d} * ${k}), 3.0)`;
    } else {
      expr = `1.0 / (1.0 + pow(max(${d}, 0.0), ${pw}) * ${k})`;
    }
    return {
      code: `    float ${id}_falloff = ${expr};\n`,
      outputVars: { falloff: `${id}_falloff` },
    };
  },
};

// ─── Glow Falloff ─────────────────────────────────────────────────────────────
// Bounded inverse-square glow: brightness / (1 + d^power · k).
// Safe for carry accumulation — stays finite at d=0.

export const GlowFalloffNode: NodeDefinition = {
  type: 'glowFalloff',
  label: 'Glow Falloff',
  category: 'Field',
  description: 'Bounded inverse-square glow: brightness/(1+d^p·k). Stays finite at d=0 — safe for carry accumulation. Use for point lights and metaball glow.',
  inputs: {
    distance:   { type: 'float', label: 'Distance'   },
    brightness: { type: 'float', label: 'Brightness' },
  },
  outputs: {
    glow: { type: 'float', label: 'Glow' },
  },
  defaultParams: { brightness: 0.5, k: 20.0, power: 2.0 },
  paramDefs: {
    brightness: { label: 'Brightness', type: 'float', min: 0.001, max: 2.0,  step: 0.01 },
    k:          { label: 'Falloff rate',          type: 'float', min: 0.5,   max: 50.0, step: 0.5, hint: 'Higher fades faster.'  },
    power:      { label: 'Power',      type: 'float', min: 1.0,   max: 4.0,  step: 0.1  },
  },
  glslFunction: `float glowFalloffFn(float dist, float brightness, float k, float power) {
    return brightness / (1.0 + pow(max(dist, 0.0), power) * k);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const dist = inputVars.distance   ?? '0.0';
    const br   = inputVars.brightness ?? p(node.params.brightness, 0.5);
    const k    = p(node.params.k,     20.0);
    const pw   = p(node.params.power,  2.0);
    return {
      code: `    float ${id}_glow = glowFalloffFn(${dist}, ${br}, ${k}, ${pw});\n`,
      outputVars: { glow: `${id}_glow` },
    };
  },
};

// ─── Noisy Grid SDF ───────────────────────────────────────────────────────────
// Smooth-min of noise-displaced circle SDFs over a grid neighborhood.
// Circles merge organically when noise brings them close together.
// Works in grid-pos space (0..columns). Connect sdf → smoothstep to visualize.

const SMIN_POLY_FN = `float sminPolyFn(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
}`;

const NOISY_GRID_SDF_3X3 = `float noisyGridSDF3x3Fn(vec2 gpos, vec2 cid, float time, float radius, float noiseAmt, float speed, float smoothK) {
    float result = 1e5;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            vec2 nid = cid + vec2(float(dx), float(dy));
            float ph = nid.x * 1.618034 + nid.y * 2.618034;
            vec2 offs = noiseHash2(nid) * (noiseAmt + 0.06 * sin(time * speed + ph));
            vec2 center = nid + 0.5 + offs;
            float sdf = length(gpos - center) - radius;
            result = sminPolyFn(result, sdf, smoothK);
        }
    }
    return result;
}`;

const NOISY_GRID_SDF_5X5 = `float noisyGridSDF5x5Fn(vec2 gpos, vec2 cid, float time, float radius, float noiseAmt, float speed, float smoothK) {
    float result = 1e5;
    for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
            vec2 nid = cid + vec2(float(dx), float(dy));
            float ph = nid.x * 1.618034 + nid.y * 2.618034;
            vec2 offs = noiseHash2(nid) * (noiseAmt + 0.06 * sin(time * speed + ph));
            vec2 center = nid + 0.5 + offs;
            float sdf = length(gpos - center) - radius;
            result = sminPolyFn(result, sdf, smoothK);
        }
    }
    return result;
}`;

export const NoisyGridSDFNode: NodeDefinition = {
  type: 'noisyGridSDF',
  label: 'Noisy Grid SDF',
  category: 'Field',
  description: 'Smooth-min of noise-displaced circle SDFs over a 3×3 or 5×5 neighborhood. SDF is negative inside circles, zero at edges. Circles merge organically when noise brings them close. Connect sdf → smoothstep for fill; smoothstep(0.5,−0.3,sdf) → palette for inner glow.',
  inputs: {
    gridPos: { type: 'vec2',  label: 'Grid Pos' },
    cellID:  { type: 'vec2',  label: 'Cell ID'  },
    time:    { type: 'float', label: 'Time'     },
  },
  outputs: {
    sdf: { type: 'float', label: 'SDF' },
  },
  defaultParams: { radius: 0.30, noiseAmt: 0.28, speed: 0.4, smoothK: 0.20, neighborRadius: 2 },
  paramDefs: {
    radius:         { label: 'Radius',    type: 'float', min: 0.05, max: 0.49, step: 0.01  },
    noiseAmt:       { label: 'Noise Amt', type: 'float', min: 0.0,  max: 0.5,  step: 0.01  },
    speed:          { label: 'Speed',     type: 'float', min: 0.0,  max: 2.0,  step: 0.05  },
    smoothK:        { label: 'Blend radius',   type: 'float', min: 0.01, max: 0.5,  step: 0.01, hint: 'How far apart shapes start to merge. 0 is a hard edge.'  },
    neighborRadius: { label: 'Neighbors', type: 'select', options: [
      { value: '1', label: '1 (3×3)' },
      { value: '2', label: '2 (5×5)' },
    ]},
  },
  glslFunctions: [SMIN_POLY_FN, NOISY_GRID_SDF_3X3, NOISY_GRID_SDF_5X5],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const gp  = inputVars.gridPos ?? 'g_uv';
    const cid = inputVars.cellID  ?? 'vec2(0.0)';
    const t   = inputVars.time    ?? 'u_time';
    const r   = p(node.params.radius,   0.30);
    const na  = p(node.params.noiseAmt, 0.28);
    const sp  = p(node.params.speed,    0.4);
    const sk  = p(node.params.smoothK,  0.20);
    const nr  = typeof node.params.neighborRadius === 'number'
      ? node.params.neighborRadius
      : parseFloat(String(node.params.neighborRadius ?? '2'));
    const fnName = nr > 1 ? 'noisyGridSDF5x5Fn' : 'noisyGridSDF3x3Fn';
    return {
      code: `    float ${id}_sdf = ${fnName}(${gp}, ${cid}, ${t}, ${r}, ${na}, ${sp}, ${sk});\n`,
      outputVars: { sdf: `${id}_sdf` },
    };
  },
};
