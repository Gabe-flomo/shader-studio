/**
 * The maths behind the "Show as" previews (docs/node-previews.md): the value field read back from
 * the GPU, its range, the colour maps, the slice, the arrow grid and the CPU painter the node card
 * uses. The GLSL in previewGlsl.ts draws the same pictures on the GPU for the eye preview; the two
 * are kept in step by hand (same constants, same formulas).
 *
 * A field is RGBA float32, `w × h`, row 0 at the bottom (as WebGL reads it). For a vec2 node R, G
 * are x, y. For a float node R is the value and G its primary input (the slice plot's "before").
 * For a colour (vec3, vec4) RGB is the colour (a vec4's alpha is dropped, as the picture does).
 */
import type { PreviewStats } from '../previewExplain';

/** The output types a node card's preview reads back. */
export type FieldType = 'float' | 'vec2' | 'vec3' | 'vec4';
export const isColourType = (t: string) => t === 'vec3' || t === 'vec4';

export interface ValueField {
  data: Float32Array;
  w: number;
  h: number;
  type: FieldType;
  /** G holds the primary input (float nodes with a wired input; see showAs.primaryInput). */
  hasInput: boolean;
}

export interface FieldStats {
  /** Lowest / highest finite value (float: R; vec2: per component in minX… below). */
  min: number;
  max: number;
  minX: number; maxX: number; minY: number; maxY: number;
  /** Longest vec2 in view (0 for floats). */
  maxMag: number;
  /** Range of the primary input (float nodes with one), else NaN. */
  inMin: number;
  inMax: number;
  /** Texels with a finite value / all texels. */
  finite: number;
  total: number;
  /** Every finite texel holds the same value (within float noise). */
  constant: boolean;
  /** The constant value: a number for floats, [x, y] for vec2. */
  value: number | [number, number];
}

/** Two numbers are "the same" for constant detection: float32 noise relative to their size. */
export function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));
}

export function fieldStats(f: ValueField): FieldStats {
  const { data, w, h } = f;
  let min = Infinity, max = -Infinity, minY = Infinity, maxY = -Infinity, maxMag = 0;
  let inMin = Infinity, inMax = -Infinity, finite = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const x = data[o], y = data[o + 1];
    if (isColourType(f.type)) {
      const m = Math.max(x, y, data[o + 2]);
      if (!Number.isFinite(m)) continue;
      finite++;
      if (m < min) min = m; if (m > max) max = m;
    } else if (f.type === 'vec2') {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      finite++;
      if (x < min) min = x; if (x > max) max = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const m = Math.hypot(x, y);
      if (m > maxMag) maxMag = m;
    } else {
      if (!Number.isFinite(x)) continue;
      finite++;
      if (x < min) min = x; if (x > max) max = x;
      if (f.hasInput && Number.isFinite(y)) { if (y < inMin) inMin = y; if (y > inMax) inMax = y; }
    }
  }
  if (finite === 0) {
    return { min: NaN, max: NaN, minX: NaN, maxX: NaN, minY: NaN, maxY: NaN, maxMag: 0, inMin: NaN, inMax: NaN, finite, total: n, constant: false, value: NaN };
  }
  if (inMin === Infinity) { inMin = NaN; inMax = NaN; }
  // A colour is shown as itself: one flat colour is a picture, not a "= … everywhere" label
  if (isColourType(f.type)) return { min, max, minX: min, maxX: max, minY: NaN, maxY: NaN, maxMag: 0, inMin, inMax, finite, total: n, constant: false, value: max };
  if (f.type === 'vec2') {
    const constant = nearlyEqual(min, max) && nearlyEqual(minY, maxY);
    return { min: Math.min(min, minY), max: Math.max(max, maxY), minX: min, maxX: max, minY, maxY, maxMag, inMin, inMax, finite, total: n, constant, value: [min, minY] };
  }
  return { min, max, minX: min, maxX: max, minY: NaN, maxY: NaN, maxMag: 0, inMin, inMax, finite, total: n, constant: nearlyEqual(min, max), value: min };
}

// ── Labels ───────────────────────────────────────────────────────────────────

const MINUS = '−';

/** A value for a key: about three significant figures, a real minus sign. */
export function formatValue(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : `${MINUS}∞`;
  const a = Math.abs(v);
  let s: string;
  if (a === 0) s = '0';
  else if (a >= 1e4 || a < 1e-3) s = a.toExponential(1).replace('e+', 'e');
  else if (a >= 100) s = a.toFixed(0);
  else if (a >= 1) s = a.toFixed(1);
  else s = a.toFixed(2);
  if (s === '0.00') s = '0';
  if (s === '1.00') s = '1.0';
  return v < 0 && s !== '0' ? MINUS + s : s;
}

/** "−2.4 … 7.1" (an end within a thousandth of the span of 0 reads as 0) */
export function rangeLabel(min: number, max: number): string {
  const tiny = (Math.max(Math.abs(min), Math.abs(max)) || 1) * 1e-3;
  const f = (v: number) => (Math.abs(v) < tiny ? '0' : formatValue(v));
  return `${f(min)} … ${f(max)}`;
}

/** The arrows key: what a full-length arrow stands for. */
export const arrowKey = (maxMag: number) => `full arrow = ${formatValue(maxMag)} (strongest)`;

/** "= 3.0 everywhere" / "= (0.50, 0.20) everywhere" */
export function constantLabel(value: number | [number, number]): string {
  if (Array.isArray(value)) return `= (${formatValue(value[0])}, ${formatValue(value[1])}) everywhere`;
  const s = formatValue(value);
  // A whole number reads as a number, not an index: 3 → 3.0
  return `= ${/^[−-]?\d+$/.test(s) ? s + '.0' : s} everywhere`;
}

/** The key under a preview: the range, the constant, or why there's nothing to show. */
export function valueKey(s: FieldStats, type: FieldType, mode: string): string {
  if (s.finite === 0) return 'NaN or ∞ everywhere';
  if (isColourType(type)) return `${rangeLabel(s.min, s.max)} (brightest channel)`;
  if (s.constant) return constantLabel(s.value);
  const bad = s.total - s.finite;
  const tail = bad > 0 ? ` · ${Math.round((bad / s.total) * 100) || '<1'}% NaN/∞` : '';
  if (type === 'vec2') {
    if (mode === 'arrows') return `${arrowKey(s.maxMag)}${tail}`;
    if (mode === 'wheel') return `longest = ${formatValue(s.maxMag)}${tail}`;
    return `x ${rangeLabel(s.minX, s.maxX)}  y ${rangeLabel(s.minY, s.maxY)}${tail}`;
  }
  return rangeLabel(s.min, s.max) + tail;
}

/**
 * How the picture shows this field without a "Show as" map (Raw, or a colour), as the frame stats
 * the preview caption explains (lib/previewExplain.ts): share clipped to white, share black,
 * whether it's one flat colour, mean brightness. Read from the field, so no extra readback.
 */
export function displayStats(f: ValueField): PreviewStats {
  const { data, w, h } = f;
  const n = w * h;
  let clipped = 0, black = 0, sum = 0, flat = true;
  const ch = (o: number): [number, number, number] => {
    const r = data[o], g = data[o + 1], b = data[o + 2];
    if (f.type === 'float') return [r, r, r];
    if (f.type === 'vec2') return [r, g, 0];
    return [r, g, b];
  };
  const c0 = ch(0).map(clamp01);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = ch(i * 4).map(v => (Number.isFinite(v) ? clamp01(v) : 0));
    const mx = Math.max(r, g, b);
    if (mx >= 0.996) clipped++;
    if (mx <= 0.008) black++;
    sum += (r + g + b) / 3;
    if (flat && (Math.abs(r - c0[0]) > 0.024 || Math.abs(g - c0[1]) > 0.024 || Math.abs(b - c0[2]) > 0.024)) flat = false;
  }
  return { clipped: clipped / n, black: black / n, flat, mean: sum / n };
}

// ── Colour maps (mirrored in previewGlsl.ts) ─────────────────────────────────

export type RGB = [number, number, number];
const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const DIVERGING = {
  zero: [0.5, 0.5, 0.5] as RGB,
  negMid: [0.32, 0.5, 0.88] as RGB,
  negEnd: [0.06, 0.16, 0.62] as RGB,
  posMid: [0.95, 0.52, 0.18] as RGB,
  posEnd: [1.0, 0.93, 0.55] as RGB,
};

/** Does this range get the diverging map (negatives present, so 0 means something)? */
export const isDiverging = (min: number, max: number) => min < 0 && max > min;

/**
 * Diverging map: grey at 0, blue toward the most negative value, warm toward the most positive.
 * Each side is scaled to its own extreme, so both ends of the range reach full colour.
 */
export function divergingColor(v: number, min: number, max: number): RGB {
  const D = DIVERGING;
  if (v < 0) {
    const t = min < 0 ? clamp01(v / min) : 0;
    return t < 0.5 ? mix3(D.zero, D.negMid, t * 2) : mix3(D.negMid, D.negEnd, t * 2 - 1);
  }
  const t = max > 0 ? clamp01(v / max) : 0;
  return t < 0.5 ? mix3(D.zero, D.posMid, t * 2) : mix3(D.posMid, D.posEnd, t * 2 - 1);
}

/** Grey map: the lowest value near black, the highest white. */
export function greyColor(v: number, min: number, max: number): RGB {
  const t = max > min ? clamp01((v - min) / (max - min)) : 0.5;
  const g = 0.04 + 0.92 * t;
  return [g, g, g];
}

/** The auto-range colour of a value: diverging with negatives present, else grey. */
export function rangeColor(v: number, min: number, max: number): RGB {
  return isDiverging(min, max) ? divergingColor(v, min, max) : greyColor(v, min, max);
}

/** HSV → RGB, h in turns. */
export function hsv(h: number, s: number, v: number): RGB {
  const k = (n: number) => (n + h * 6) % 6;
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}

/** Colour wheel: hue is the angle (0 = +x, red), brightness the length against the longest. */
export function wheelColor(x: number, y: number, maxMag: number): RGB {
  const a = Math.atan2(y, x) / (Math.PI * 2);
  const m = maxMag > 0 ? clamp01(Math.hypot(x, y) / maxMag) : 0;
  return hsv(a < 0 ? a + 1 : a, 0.85, m);
}

/**
 * Grid picture at a vec2 `p` with pixel footprint `wx, wy` (fwidth), as previewGlsl's pvz_grid:
 * `checks` checker squares and `lines` grid lines per unit (showAs.gridDensity).
 */
export function gridColor(px: number, py: number, wx: number, wy: number, checks = 10, lines = 2): RGB {
  wx = Math.max(wx, 1e-6); wy = Math.max(wy, 1e-6);
  const chk = ((Math.floor(px * checks) + Math.floor(py * checks)) % 2 + 2) % 2;
  // The checker fades to its average once its squares are smaller than a pixel (no moiré).
  const fade = 1 - smooth(0.3, 1.0, Math.max(wx, wy) * checks);
  const shade = 0.24 + (chk - 0.5) * 0.14 * fade;
  const fx = px - Math.floor(px), fy = py - Math.floor(py);
  let col: RGB = [shade + fx * 0.22, shade + 0.02, shade + fy * 0.26];
  // Lines every 1/lines of a unit
  const lx = Math.abs(((px * lines + 0.5) % 1 + 1) % 1 - 0.5) / (wx * lines);
  const ly = Math.abs(((py * lines + 0.5) % 1 + 1) % 1 - 0.5) / (wy * lines);
  col = mix3(col, [0.82, 0.84, 0.9], (1 - smooth(0.5, 1.5, Math.min(lx, ly))) * 0.55);
  // Axes: green where x = 0, red where y = 0
  col = mix3(col, [0.3, 0.95, 0.45], 1 - smooth(0.75, 2.0, Math.abs(px) / wx));
  col = mix3(col, [1.0, 0.35, 0.35], 1 - smooth(0.75, 2.0, Math.abs(py) / wy));
  return col;
}

export function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** A "nice" contour spacing (1, 2 or 5 × 10ⁿ) giving about `target` lines across the range. */
export function niceStep(min: number, max: number, target = 10): number {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

// ── Slice ────────────────────────────────────────────────────────────────────

/** The field row a slice at `sliceY` (0 bottom … 1 top) reads. */
export const sliceRowIndex = (h: number, sliceY: number) => Math.max(0, Math.min(h - 1, Math.round(clamp01(sliceY) * (h - 1))));

/** One channel of the row through `sliceY`, left to right (0 = the value, 1 = vec2 y / the input). */
export function sliceRow(f: ValueField, sliceY: number, channel = 0): Float32Array {
  const r = sliceRowIndex(f.h, sliceY);
  const out = new Float32Array(f.w);
  for (let i = 0; i < f.w; i++) out[i] = f.data[(r * f.w + i) * 4 + channel];
  return out;
}

/** The value axis of a slice plot over these series: their finite range with a little room. */
export function sliceAxis(...series: ArrayLike<number>[]): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (let i = 0; i < s.length; i++) { const v = s[i]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (lo === Infinity) return { lo: -1, hi: 1 };
  if (nearlyEqual(lo, hi)) { const d = Math.max(1, Math.abs(lo)) * 0.5; return { lo: lo - d, hi: hi + d }; }
  const pad = (hi - lo) * 0.06;
  return { lo: lo - pad, hi: hi + pad };
}

// ── Arrows ───────────────────────────────────────────────────────────────────

export interface ArrowGrid {
  cols: number;
  rows: number;
  /** Cell centres in UV (0…1, y up), row-major from the bottom row. */
  centers: Array<[number, number]>;
}

/**
 * A coarse grid of square cells over a `w × h` picture: `cols` across, as many rows as fit,
 * centred cells. Square in pixels so arrows don't stretch with the aspect.
 */
export function arrowGrid(w: number, h: number, cols: number): ArrowGrid {
  cols = Math.max(1, Math.round(cols));
  const cell = w / cols;
  const rows = Math.max(1, Math.round(h / cell));
  const centers: Array<[number, number]> = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) centers.push([(i + 0.5) / cols, (j + 0.5) / rows]);
  return { cols, rows, centers };
}

/** The vec2 at a UV point of the field (nearest texel). */
export function sampleField(f: ValueField, u: number, v: number): [number, number] {
  const x = Math.max(0, Math.min(f.w - 1, Math.floor(u * f.w)));
  const y = Math.max(0, Math.min(f.h - 1, Math.floor(v * f.h)));
  const o = (y * f.w + x) * 4;
  return [f.data[o], f.data[o + 1]];
}

export interface ArrowSamples extends ArrowGrid {
  /** x, y per cell (NaN where the field isn't finite). */
  vecs: Float32Array;
  /** Longest sampled arrow: the key's reference length. */
  maxMag: number;
}

/**
 * One arrow per cell: the cell's strongest vec2 (longest), so a sparse field (edge directions,
 * zero away from the edges) still shows an arrow wherever it is non-zero in the cell, and a smooth
 * one shows about its value at the centre.
 */
export function arrowSamples(f: ValueField, cols: number): ArrowSamples {
  const g = arrowGrid(f.w, f.h, cols);
  const vecs = new Float32Array(g.centers.length * 2);
  let maxMag = 0;
  for (let j = 0; j < g.rows; j++) {
    const y0 = Math.floor((j / g.rows) * f.h), y1 = Math.max(y0 + 1, Math.floor(((j + 1) / g.rows) * f.h));
    for (let i = 0; i < g.cols; i++) {
      const x0 = Math.floor((i / g.cols) * f.w), x1 = Math.max(x0 + 1, Math.floor(((i + 1) / g.cols) * f.w));
      let bx = NaN, by = NaN, best = -1;
      for (let y = y0; y < Math.min(y1, f.h); y++) for (let x = x0; x < Math.min(x1, f.w); x++) {
        const o = (y * f.w + x) * 4;
        const vx = f.data[o], vy = f.data[o + 1];
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
        const m = vx * vx + vy * vy;
        if (m > best) { best = m; bx = vx; by = vy; }
      }
      const k = j * g.cols + i;
      vecs[k * 2] = bx; vecs[k * 2 + 1] = by;
      if (best > 0) maxMag = Math.max(maxMag, Math.sqrt(best));
    }
  }
  return { ...g, vecs, maxMag };
}

/**
 * An arrow's strength, 0…1: its vec2's length over the largest length in view (the global max over
 * every cell, never per cell), so the strongest vector draws a full arrow and weaker ones shorter.
 */
export const arrowStrength = (mag: number, maxMag: number) => (maxMag > 0 && Number.isFinite(mag) ? Math.min(mag, maxMag) / maxMag : 0);
/** Arrows below this strength draw as a small dot (still there, too short to point). */
export const ARROW_DOT_BELOW = 0.03;
/** Share of a cell a full-strength arrow spans (the rest keeps neighbours' heads apart). */
export const ARROW_FILL = 0.9;
/** An arrow's drawn length in pixels: strength × the full length. */
export const arrowLength = (mag: number, maxMag: number, cellPx: number) => arrowStrength(mag, maxMag) * cellPx * ARROW_FILL;

// ── CPU painter (node card thumbnails) ───────────────────────────────────────

export interface PaintOptions {
  mode: string;
  stats: FieldStats;
  /** Contour spacing (auto when omitted). */
  step?: number;
  /** Grid density (showAs.gridDensity; Medium when omitted). */
  grid?: { checks: number; lines: number };
}

/**
 * Paint the field into `out` (RGBA bytes, `dw × dh`, top row first) the way the eye preview's
 * shader does, "cover"-fitted. Values are resampled bilinearly to the canvas, except across a
 * jump (a fract or a repeat seam), where the nearest texel is kept so seams stay sharp.
 */
export function paintField(out: Uint8ClampedArray, dw: number, dh: number, f: ValueField, opts: PaintOptions): void {
  const { mode, stats } = opts;
  // Grid keeps seams (a fract, a repeat) sharp; the colour maps blend across them like the GPU would.
  const vals = resample(f, dw, dh, mode === 'grid' ? 0.25 : Infinity);
  // A colour's blue channel, resampled the same way
  const colours = isColourType(f.type) ? resample({ ...f, data: shiftChannels(f.data) }, dw, dh).filter((_, i) => i % 2 === 0) : null;
  const step = opts.step ?? niceStep(stats.min, stats.max);
  const lo = stats.min, hi = stats.max;
  const at = (x: number, y: number, c: number) => vals[(Math.min(dh - 1, y) * dw + Math.min(dw - 1, x)) * 2 + c];
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const vx = at(x, y, 0), vy = at(x, y, 1);
      let col: RGB;
      if (isColourType(f.type)) {
        const vz = colours![(Math.min(dh - 1, y) * dw + Math.min(dw - 1, x))];
        col = Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz) ? [clamp01(vx), clamp01(vy), clamp01(vz)] : [0.5, 0, 0.5];
      } else if (f.type === 'vec2') {
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) col = [0.5, 0, 0.5];
        else if (mode === 'grid') {
          const wx = Math.abs(at(x + 1, y, 0) - vx) + Math.abs(at(x, y + 1, 0) - vx);
          const wy = Math.abs(at(x + 1, y, 1) - vy) + Math.abs(at(x, y + 1, 1) - vy);
          col = gridColor(vx, vy, wx, wy, opts.grid?.checks, opts.grid?.lines);
        } else if (mode === 'wheel') col = wheelColor(vx, vy, stats.maxMag);
        else if (mode === 'arrows') { const c = wheelColor(vx, vy, stats.maxMag); col = [c[0] * 0.35, c[1] * 0.35, c[2] * 0.35]; }
        else col = [clamp01(vx), clamp01(vy), 0];
      } else {
        if (!Number.isFinite(vx)) col = [0.5, 0, 0.5];
        else if (mode === 'raw') { const g = clamp01(vx); col = [g, g, g]; }
        else if (stats.constant) col = [0.16, 0.16, 0.18];
        else {
          col = rangeColor(vx, lo, hi);
          if (mode === 'slice') col = [col[0] * 0.45, col[1] * 0.45, col[2] * 0.45];
          else if (mode === 'contours') {
            const fv = vx / step;
            const fw = Math.abs(at(x + 1, y, 0) / step - fv) + Math.abs(at(x, y + 1, 0) / step - fv);
            const d = Math.abs(((fv + 0.5) % 1 + 1) % 1 - 0.5) / Math.max(fw, 1e-6);
            const line = 1 - smooth(0.5, 1.5, d);
            const lum = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2];
            const lc = lum > 0.55 ? 0.06 : 0.94;
            col = mix3(col, [lc, lc, lc], line * 0.85);
          }
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = col[0] * 255; out[o + 1] = col[1] * 255; out[o + 2] = col[2] * 255; out[o + 3] = 255;
    }
  }
}

/** The field with B moved into R (to resample a colour's third channel with the same code). */
function shiftChannels(data: Float32Array): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) out[i] = data[i + 2];
  return out;
}

/** The field's R, G at each canvas pixel ("cover" fit, top row first). */
export function resample(f: ValueField, dw: number, dh: number, jump = Infinity): Float32Array {
  const out = new Float32Array(dw * dh * 2);
  const { data, w, h } = f;
  // Cover: the field's scale is the larger of the two ratios, centred.
  const s = Math.max(dw / w, dh / h);
  const ox = (w - dw / s) / 2, oy = (h - dh / s) / 2;
  for (let y = 0; y < dh; y++) {
    // Canvas rows go down, field rows go up
    const fy = Math.max(0, Math.min(h - 1.001, oy + (dh - 1 - y + 0.5) / s - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.max(0, Math.min(w - 1.001, ox + (x + 0.5) / s - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const o = (y * dw + x) * 2;
      for (let c = 0; c < 2; c++) {
        const a = data[(y0 * w + x0) * 4 + c], b = data[(y0 * w + x1) * 4 + c];
        const cc = data[(y1 * w + x0) * 4 + c], d = data[(y1 * w + x1) * 4 + c];
        const spread = Math.max(a, b, cc, d) - Math.min(a, b, cc, d);
        if (spread > jump || !Number.isFinite(spread)) {
          out[o + c] = tx < 0.5 ? (ty < 0.5 ? a : cc) : (ty < 0.5 ? b : d);
        } else {
          out[o + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
        }
      }
    }
  }
  return out;
}
