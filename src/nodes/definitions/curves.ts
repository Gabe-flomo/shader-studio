/**
 * Curves and Threshold (docs/curves.md): After Effects' Curves and Threshold, as Texture tools.
 *
 * Curves: five curves, Master (RGB), Red, Green, Blue and Alpha, each a few control points (x, y in
 * 0–1) joined by a smooth curve that never overshoots (monotone cubic, Fritsch–Carlson) or, with the
 * curve's Linear switch, straight lines. Master is applied first, then each channel's own (AE's order).
 * Past the first and last points the curve holds their heights.
 *
 * How the curves reach the shader without a recompile while a point is dragged: each point is one
 * vec3 param, `c<channel><i>` = [x, y, slope], its slope worked out in JS (curveTangents) whenever
 * the curve changes. Those params are live uniforms (`liveParamKeys`, compiler/uniformPatcher.ts),
 * so a drag writes a handful of vec3s; only adding or removing a point (a new uniform) recompiles.
 * The GLSL evaluates the curve exactly from them (one cubic piece per pair of points: the same
 * numbers a baked lookup table would hold, with no table to rebuild). `bakeCurveLut` is the JS
 * mirror the card draws from and the tests check the GLSL against.
 *
 * Threshold: a number (brightness, a channel, or a plain Value) cut at Level with a soft edge.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

const LUMA = 'vec3(0.299, 0.587, 0.114)';

// ── The curves, in plain JS ─────────────────────────────────────────────────

export type CurveChannel = 'm' | 'r' | 'g' | 'b' | 'a';
export const CURVE_CHANNELS: ReadonlyArray<{ key: CurveChannel; label: string; colour: string }> = [
  { key: 'm', label: 'Master', colour: '#d8d8d8' },
  { key: 'r', label: 'Red', colour: '#ff5f57' },
  { key: 'g', label: 'Green', colour: '#3ecf6e' },
  { key: 'b', label: 'Blue', colour: '#4f8dff' },
  { key: 'a', label: 'Alpha', colour: '#b9a6ff' },
];
export const MAX_CURVE_POINTS = 12;
export type CurvePoint = [number, number];
export const IDENTITY_CURVE: CurvePoint[] = [[0, 0], [1, 1]];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** The param holding point `i` of a channel's curve. */
export const curvePointKey = (c: CurveChannel, i: number) => `c${c}${i}`;
/** The param holding a channel's Linear switch (0 smooth, 1 straight lines). */
export const curveLinearKey = (c: CurveChannel) => `c${c}Lin`;

/** How many points a channel's curve has in these params (as stored, or as uniform names once compiled). */
export function curvePointCount(params: Record<string, unknown>, c: CurveChannel): number {
  let n = 0;
  while (n < MAX_CURVE_POINTS && params[curvePointKey(c, n)] != null) n++;
  return n;
}

/** A channel's points, sorted by x, kept in 0–1 (the identity diagonal when fewer than two are stored). */
export function curvePoints(params: Record<string, unknown>, c: CurveChannel): CurvePoint[] {
  const pts: CurvePoint[] = [];
  for (let i = 0; i < curvePointCount(params, c); i++) {
    const v = params[curvePointKey(c, i)];
    if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') pts.push([clamp01(v[0]), clamp01(v[1])]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  return pts.length >= 2 ? pts : IDENTITY_CURVE.map(q => [...q] as CurvePoint);
}

export const curveIsLinear = (params: Record<string, unknown>, c: CurveChannel): boolean => Number(params[curveLinearKey(c)]) >= 0.5;

/**
 * Fritsch–Carlson slopes for a monotone cubic through the points: between two points the curve
 * never goes above or below both of them (no overshoot), and where the points turn back the
 * curve is flat. Points must be sorted by x.
 */
export function curveTangents(pts: CurvePoint[]): number[] {
  const n = pts.length;
  if (n < 2) return pts.map(() => 0);
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const h = pts[k + 1][0] - pts[k][0];
    d.push(h > 1e-6 ? (pts[k + 1][1] - pts[k][1]) / h : 0);
  }
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
    const a = m[k] / d[k], b = m[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
  }
  return m;
}

/** The curve at x, as the GLSL works it out: Hermite pieces (or straight lines), held flat past the ends. */
export function evalCurve(pts: CurvePoint[], x: number, linear = false, tangents = curveTangents(pts)): number {
  const n = pts.length;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  let k = 0;
  while (k < n - 2 && x >= pts[k + 1][0]) k++;
  const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
  const h = Math.max(x1 - x0, 1e-5);
  const t = clamp01((x - x0) / h);
  if (linear) return y0 + (y1 - y0) * t;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * tangents[k] + (3 * t2 - 2 * t3) * y1 + (t3 - t2) * h * tangents[k + 1];
}

/** The curve sampled at `size` evenly spaced places from 0 to 1 (a lookup table): what the card draws. */
export function bakeCurveLut(pts: CurvePoint[], linear = false, size = 256): Float32Array {
  const m = curveTangents(pts);
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = evalCurve(pts, i / (size - 1), linear, m);
  return out;
}
/** A lookup table read with linear interpolation between its samples. */
export function readLut(lut: Float32Array, x: number): number {
  const f = clamp01(x) * (lut.length - 1);
  const i = Math.min(Math.floor(f), lut.length - 2);
  return lut[i] + (lut[i + 1] - lut[i]) * (f - i);
}

/**
 * The params for a channel's curve: every point as [x, y, slope] (sorted, kept in 0–1, at most
 * MAX_CURVE_POINTS), the Linear switch, and `undefined` for points it no longer has. Points that
 * stay put are rewritten too: a moved point changes its neighbours' slopes.
 */
export function curvePatch(c: CurveChannel, points: CurvePoint[], linear: boolean, oldCount = 0): Record<string, unknown> {
  let pts = points.map(([x, y]) => [clamp01(x), clamp01(y)] as CurvePoint).sort((a, b) => a[0] - b[0]).slice(0, MAX_CURVE_POINTS);
  if (pts.length < 2) pts = IDENTITY_CURVE.map(q => [...q] as CurvePoint);
  const m = curveTangents(pts);
  const out: Record<string, unknown> = { [curveLinearKey(c)]: linear ? 1 : 0 };
  pts.forEach(([x, y], i) => { out[curvePointKey(c, i)] = [round(x), round(y), round(m[i])]; });
  for (let i = pts.length; i < Math.max(oldCount, pts.length); i++) out[curvePointKey(c, i)] = undefined;
  return out;
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Every channel's curve as params (channels not given are the straight diagonal). */
export function curvesParams(curves: Partial<Record<CurveChannel, CurvePoint[]>>, linear: Partial<Record<CurveChannel, boolean>> = {}): Record<string, unknown> {
  return Object.assign({}, ...CURVE_CHANNELS.map(({ key }) => curvePatch(key, curves[key] ?? IDENTITY_CURVE, !!linear[key])));
}

/** The whole node on one colour, in the node's order (Master, then each channel): for tests and the card. */
export function applyCurves(params: Record<string, unknown>, rgba: [number, number, number, number]): [number, number, number, number] {
  const f = (c: CurveChannel, x: number) => evalCurve(curvePoints(params, c), x, curveIsLinear(params, c));
  const [r, g, b, a] = rgba.map((v, i) => (i < 3 ? f('m', v) : v));
  return [f('r', r), f('g', g), f('b', b), f('a', a)];
}

// ── Presets ─────────────────────────────────────────────────────────────────

export interface CurvesPreset { value: string; label: string; curves: Partial<Record<CurveChannel, CurvePoint[]>>; linear?: Partial<Record<CurveChannel, boolean>> }
const steps = (n: number): CurvePoint[] => {
  // Flat steps joined by near-vertical risers, drawn with straight lines: a posterize.
  const pts: CurvePoint[] = [[0, 0]];
  for (let i = 1; i < n; i++) {
    const x = i / n, y0 = (i - 1) / (n - 1), y1 = i / (n - 1);
    pts.push([x - 0.01, y0], [x + 0.01, y1]);
  }
  pts.push([1, 1]);
  return pts;
};
export const CURVES_PRESETS: CurvesPreset[] = [
  { value: 'linear', label: 'Linear (reset all)', curves: {} },
  { value: 'contrast', label: 'Increase contrast (S)', curves: { m: [[0, 0], [0.25, 0.17], [0.75, 0.84], [1, 1]] } },
  { value: 'flatten', label: 'Decrease contrast', curves: { m: [[0, 0.08], [0.25, 0.3], [0.75, 0.7], [1, 0.92]] } },
  { value: 'brighten', label: 'Brighten', curves: { m: [[0, 0], [0.45, 0.62], [1, 1]] } },
  { value: 'darken', label: 'Darken', curves: { m: [[0, 0], [0.55, 0.38], [1, 1]] } },
  { value: 'invert', label: 'Invert', curves: { m: [[0, 1], [1, 0]] } },
  { value: 'posterize', label: 'Posterize (4 steps)', curves: { m: steps(4) }, linear: { m: true } },
  { value: 'cross', label: 'Cross-process', curves: {
    r: [[0, 0], [0.25, 0.18], [0.75, 0.86], [1, 1]],
    g: [[0, 0.04], [0.3, 0.26], [0.7, 0.8], [1, 0.96]],
    b: [[0, 0.16], [0.5, 0.48], [1, 0.82]],
  } },
];
export const curvesPresetParams = (value: string): Record<string, unknown> | null => {
  const pr = CURVES_PRESETS.find(x => x.value === value);
  return pr ? curvesParams(pr.curves, pr.linear) : null;
};

// ── GLSL ────────────────────────────────────────────────────────────────────

/** A point's GLSL: its live uniform's name, or [x, y, slope] baked as a vec3. */
const pointExpr = (v: unknown): string => {
  if (typeof v === 'string') return v;
  const a = Array.isArray(v) ? v.map(Number) : [0, 0, 1];
  return `vec3(${a.slice(0, 3).map(x => p(Number.isFinite(x) ? x : 0, 0)).join(', ')})`;
};

/** The code that runs `target` (a float variable) through one curve, in place. */
function curveLines(id: string, k: string, target: string, pts: string[], lin: string): string {
  const a = `${id}_a${k}`, b = `${id}_b${k}`, x = `${id}_x${k}`, h = `${id}_h${k}`, t = `${id}_t${k}`, yh = `${id}_y${k}`;
  const last = pts[pts.length - 1];
  const L = [
    `    float ${x} = ${target};\n`,
    `    vec3 ${a} = ${last};\n`,
    `    vec3 ${b} = ${last};\n`,
    `    if (${x} <= ${pts[0]}.x) { ${a} = ${pts[0]}; ${b} = ${pts[0]}; }\n`,
  ];
  for (let i = 1; i < pts.length; i++) L.push(`    else if (${x} < ${pts[i]}.x) { ${a} = ${pts[i - 1]}; ${b} = ${pts[i]}; }\n`);
  L.push(
    `    float ${h} = max(${b}.x - ${a}.x, 0.00001);\n`,
    `    float ${t} = clamp((${x} - ${a}.x) / ${h}, 0.0, 1.0);\n`,
    `    float ${yh} = (2.0 * ${t} * ${t} * ${t} - 3.0 * ${t} * ${t} + 1.0) * ${a}.y + (${t} * ${t} * ${t} - 2.0 * ${t} * ${t} + ${t}) * ${h} * ${a}.z + (3.0 * ${t} * ${t} - 2.0 * ${t} * ${t} * ${t}) * ${b}.y + (${t} * ${t} * ${t} - ${t} * ${t}) * ${h} * ${b}.z;\n`,
    `    ${target} = mix(${yh}, mix(${a}.y, ${b}.y, ${t}), ${lin});\n`,
  );
  return L.join('');
}

/** The texture (or the plain Color / Value) at the read, as a vec4 named `${id}_in`. */
function readSource(id: string, v: Record<string, string>): string {
  if (v.texture) return `    vec4 ${id}_in = texture2D(${v.texture}, ${texUv(v.uv ?? 'g_uv')});\n`;
  if (v.color) return `    vec4 ${id}_in = vec4(${v.color}, 1.0);\n`;
  if (v.value) return `    vec4 ${id}_in = vec4(vec3(${v.value}), 1.0);\n`;
  return `    vec4 ${id}_in = vec4(0.0, 0.0, 0.0, 1.0);\n`;
}

const TEX_HINT = 'Any texture: a picture (Texture Input), Video Input, a Pass, Baked. Read at this pixel, or at UV.';

export const CurvesNode: NodeDefinition = {
  type: 'curves',
  label: 'Curves',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Curves (AE)', 'Colour curves', 'Color curves', 'RGB curves', 'Tone curve', 'Contrast curve', 'S-curve', 'Cross process', 'Grade', 'Lookup curve'],
  description: 'After Effects\' Curves: drag points on the card\'s graph to reshape the tones. The bottom of the graph is what comes in (dark on the left, bright on the right), its height what goes out. Master (RGB) shapes all three colours, then Red, Green, Blue and Alpha each shape their own. An S shape adds contrast; a different curve per colour gives a cross-processed look. Works on a Texture, a Color, or a plain Value from 0 to 1.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the Texture, in picture coordinates. Empty: this pixel.' },
    color: { type: 'vec3', label: 'Color', hint: 'A colour from any chain, used when Texture is not wired.' },
    value: { type: 'float', label: 'Value', hint: 'Any number from 0 to 1 (a mask, a distance, a fade), shaped by Master; used when neither Texture nor Color is wired.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The colour through Master, then its own channel\'s curve.' },
    value: { type: 'float', label: 'Value', hint: 'The Value through Master when Value is what is wired; otherwise the brightness of Color.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'The Texture\'s alpha (1 for a Color or Value) through the Alpha curve.' },
  },
  defaultParams: { ...curvesParams({}) },
  // The curves are edited on the card's graph (components/NodeGraph/CurvesEditor.tsx), not as sliders.
  paramDefs: {},
  liveParamKeys: (params) => CURVE_CHANNELS.flatMap(({ key }) => [
    curveLinearKey(key),
    ...Array.from({ length: curvePointCount(params, key) }, (_, i) => curvePointKey(key, i)),
  ]),
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const ptsOf = (c: CurveChannel): string[] => {
      const n = curvePointCount(P, c);
      if (n < 2) return ['vec3(0.0, 0.0, 1.0)', 'vec3(1.0, 1.0, 1.0)'];
      return Array.from({ length: n }, (_, i) => pointExpr(P[curvePointKey(c, i)]));
    };
    const lin = (c: CurveChannel) => p(P[curveLinearKey(c)], 0);
    const lines = [
      readSource(id, v),
      `    float ${id}_r = ${id}_in.r;\n`,
      `    float ${id}_g = ${id}_in.g;\n`,
      `    float ${id}_b = ${id}_in.b;\n`,
      `    float ${id}_al = ${id}_in.a;\n`,
    ];
    // Master on each colour first, then each channel's own curve (After Effects' order)
    const m = ptsOf('m');
    for (const ch of ['r', 'g', 'b'] as const) lines.push(curveLines(id, `m${ch}`, `${id}_${ch}`, m, lin('m')));
    lines.push(`    float ${id}_mv = ${id}_r;\n`);
    for (const ch of ['r', 'g', 'b'] as const) lines.push(curveLines(id, ch, `${id}_${ch}`, ptsOf(ch), lin(ch)));
    lines.push(curveLines(id, 'al', `${id}_al`, ptsOf('a'), lin('a')));
    lines.push(`    vec3 ${id}_c = vec3(${id}_r, ${id}_g, ${id}_b);\n`);
    const valueOnly = !!v.value && !v.texture && !v.color;
    return {
      code: lines.join(''),
      outputVars: { color: `${id}_c`, value: valueOnly ? `${id}_mv` : `dot(${id}_c, ${LUMA})`, alpha: `${id}_al` },
    };
  },
};

// ── Threshold ───────────────────────────────────────────────────────────────

export const ThresholdNode: NodeDefinition = withParamSockets({
  type: 'threshold',
  label: 'Threshold',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Threshold (AE)', 'Black and white', 'Cut-off', 'Bright parts', 'Soft mask', 'Light mask', 'Luma matte'],
  description: 'Splits a picture into what is brighter than Level (white) and what is darker (black), like After Effects\' Threshold. Softness gives the cut a soft edge, so it fades instead of jumping. Read the brightness or one channel; Invert swaps the two sides. Mask is the 0–1 result, Color the picture kept where the mask is (or the black and white itself). Works on a Texture, a Color, or a plain Value.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the Texture, in picture coordinates. Empty: this pixel.' },
    color: { type: 'vec3', label: 'Color', hint: 'A colour from any chain, used when Texture is not wired.' },
    value: { type: 'float', label: 'Value', hint: 'Any number, used when neither Texture nor Color is wired.' },
  },
  outputs: {
    mask: { type: 'float', label: 'Mask', hint: '1 above Level, 0 below, with a soft edge Softness wide.' },
    color: { type: 'vec3', label: 'Color', hint: 'The picture kept where the mask is (black elsewhere), or black and white, as Color out says.' },
  },
  defaultParams: { mode: 'brightness', level: 0.5, softness: 0.05, invert: false, colorOut: 'masked' },
  paramDefs: {
    mode: { label: 'Read', type: 'select', hint: 'Which number of each pixel is compared with Level.', options: [
      { value: 'brightness', label: 'Brightness' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }, { value: 'alpha', label: 'Alpha' },
    ] },
    level: { label: 'Level', type: 'float', min: 0, max: 1, step: 0.005, hint: 'Where black turns to white: brighter than this is kept.' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 1, step: 0.005, hint: 'How wide the edge between black and white is, centred on Level (0: a hard cut).' },
    invert: { label: 'Invert', type: 'bool', hint: 'Keep the darker side instead.' },
    colorOut: { label: 'Color out', type: 'select', hint: 'What the Color output is.', options: [
      { value: 'masked', label: 'The picture, where kept' }, { value: 'bw', label: 'Black and white' },
    ] },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const mode = String(P.mode ?? 'brightness');
    const src = mode === 'red' ? `${id}_in.r` : mode === 'green' ? `${id}_in.g` : mode === 'blue' ? `${id}_in.b` : mode === 'alpha' ? `${id}_in.a` : `dot(${id}_in.rgb, ${LUMA})`;
    const lv = p(P.level, 0.5), sw = `max(${p(P.softness, 0.05)}, 0.00001)`;
    const lines = [
      readSource(id, v),
      `    float ${id}_s = ${src};\n`,
      `    float ${id}_m = smoothstep(${lv} - ${sw} * 0.5, ${lv} + ${sw} * 0.5, ${id}_s);\n`,
      P.invert === true ? `    ${id}_m = 1.0 - ${id}_m;\n` : '',
      `    vec3 ${id}_c = ${P.colorOut === 'bw' ? `vec3(${id}_m)` : `${id}_in.rgb * ${id}_m`};\n`,
    ];
    return { code: lines.join(''), outputVars: { mask: `${id}_m`, color: `${id}_c` } };
  },
}, ['level', 'softness']);

/** JS mirror of Threshold's mask (tests, docs). */
export function thresholdMask(s: number, level: number, softness: number, invert = false): number {
  const w = Math.max(softness, 1e-5);
  const t = clamp01((s - (level - w / 2)) / w);
  const m = t * t * (3 - 2 * t);
  return invert ? 1 - m : m;
}
