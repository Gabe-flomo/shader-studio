/**
 * A Time Cube's frames: how each tile's picture is made from the video, and in what order the
 * tiles go (docs/time-cube.md, "Frame order and Frames from"). Pure: no DOM, no GL; the tests check
 * it and lib/timeCube/volumes.ts runs it while building.
 *
 * - Frames from: a tile is one frame (Pick), or `sub` frames spread over its slot of time, combined:
 *   Average (a long exposure, motion blur), Brightest (light trails), Darkest, Motion (only what
 *   changed from one sub-frame to the next) or Median (what stayed put: moving things vanish).
 * - Frame order: Time, Reverse, Shuffle (seeded) or Sort by a per-frame number (brightness, hue,
 *   saturation, motion, how much of a key colour), ascending or inverted.
 *
 * The atlas keeps its layout: only which picture goes in which tile changes.
 */

export type FrameOrder = 'time' | 'reverse' | 'shuffle' | 'sort';
export type SortBy = 'brightness' | 'hue' | 'saturation' | 'motion' | 'key';
export type Combine = 'pick' | 'average' | 'max' | 'min' | 'difference' | 'median';

export const COMBINES: readonly Combine[] = ['pick', 'average', 'max', 'min', 'difference', 'median'];
export const MAX_SUB_FRAMES = 16;

export interface OrderSettings {
  order: FrameOrder;
  sortBy: SortBy;
  invert: boolean;
  seed: number;
  keyColor: [number, number, number];
  keyTolerance: number;
}

export interface CombineSettings {
  combine: Combine;
  /** Sub-frames per tile (1 for Pick). */
  sub: number;
}

/** One frame's numbers, 0–1 each (in time order). */
export interface FrameStat {
  /** Mean luma. */
  brightness: number;
  /** Hue of the frame's mean colour (0 when it is grey). */
  hue: number;
  /** Mean saturation. */
  saturation: number;
  /** Mean change in luma from the frames either side. */
  motion: number;
  /** Share of the frame within Key tolerance of the key colour. */
  key: number;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function orderSettingsOf(params: Record<string, unknown>): OrderSettings {
  const order = params.order === 'reverse' || params.order === 'shuffle' || params.order === 'sort' ? params.order : 'time';
  const sortBy = params.sortBy === 'hue' || params.sortBy === 'saturation' || params.sortBy === 'motion' || params.sortBy === 'key' ? params.sortBy : 'brightness';
  const kc = Array.isArray(params.keyColor) && params.keyColor.length >= 3 ? params.keyColor.slice(0, 3).map(v => clamp(num(v, 0), 0, 1)) : [0.85, 0.12, 0.12];
  return {
    order, sortBy,
    invert: params.invert === true,
    seed: Math.round(num(params.seed, 1)),
    keyColor: kc as [number, number, number],
    keyTolerance: clamp(num(params.keyTolerance, 0.25), 0, 1),
  };
}

export function combineSettingsOf(params: Record<string, unknown>): CombineSettings {
  const combine = (COMBINES as readonly unknown[]).includes(params.combine) ? params.combine as Combine : 'pick';
  return { combine, sub: combine === 'pick' ? 1 : Math.round(clamp(num(params.subFrames, 4), 2, MAX_SUB_FRAMES)) };
}

/** The part of a volume's key the decoding depends on ('' for the defaults, so old keys stay the same). */
export function combineKey(c: CombineSettings): string {
  return c.combine === 'pick' ? '' : `|c:${c.combine}x${c.sub}`;
}

/** The part that only reorders tiles ('' in time order). */
export function orderKey(o: OrderSettings): string {
  if (o.order === 'time') return '';
  if (o.order === 'reverse') return '|o:rev';
  if (o.order === 'shuffle') return `|o:shuf${o.seed}`;
  const key = o.sortBy === 'key' ? `:${o.keyColor.map(v => v.toFixed(3)).join(',')}:${o.keyTolerance.toFixed(3)}` : '';
  return `|o:sort:${o.sortBy}${o.invert ? ':inv' : ''}${key}`;
}

/** A small seeded random number generator (mulberry32): the same seed, the same shuffle. */
export function seededRandom(seed: number): () => number {
  let a = (Math.floor(seed) | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Which time-ordered frame each tile shows: tile i gets frame order[i]. Sorting is stable (equal
 * values keep their time order) and needs the frames' stats.
 */
export function frameOrder(n: number, o: OrderSettings, stats?: readonly FrameStat[]): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (o.order === 'reverse') return idx.reverse();
  if (o.order === 'shuffle') {
    const rnd = seededRandom(o.seed);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx;
  }
  if (o.order === 'sort' && stats && stats.length >= n) {
    const v = (i: number) => stats[i][o.sortBy], sgn = o.invert ? -1 : 1;
    // Equal values keep their time order, inverted or not.
    return idx.sort((a, b) => sgn * (v(a) - v(b)) || a - b);
  }
  return idx;
}

/** The video times of a tile's sub-frames: spread evenly over its slot (`every` seconds wide, centred on `t`). */
export function subFrameTimes(t: number, every: number, sub: number, duration: number): number[] {
  if (sub <= 1) return [t];
  const end = duration > 0 ? duration - 1e-3 : Infinity;
  return Array.from({ length: sub }, (_, j) => clamp(t + ((j + 0.5) / sub - 0.5) * every, 0, end));
}

/**
 * Combine sub-frames (RGBA bytes, all the same size) into one picture. Alpha comes out opaque.
 * Difference keeps, per channel, the largest change between neighbouring sub-frames.
 */
export function combineFrames(frames: readonly Uint8ClampedArray[], mode: Combine): Uint8ClampedArray {
  const f = combineFramesFloat(frames, mode), out = new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.round(f[i]);
  return out;
}

/**
 * combineFrames before rounding to bytes (0–255, fractions kept): what a 16-bit atlas holds. An
 * average of six frames lands between the 8-bit steps; rounding it there bands smooth gradients.
 */
export function combineFramesFloat(frames: readonly Uint8ClampedArray[], mode: Combine): Float32Array {
  const k = frames.length, len = frames[0]?.length ?? 0;
  const out = new Float32Array(len);
  if (!k) return out;
  if (mode === 'pick' || k === 1) { out.set(frames[Math.floor((k - 1) / 2)]); return out; }
  const vals = new Float64Array(k);
  for (let p = 0; p < len; p += 4) {
    for (let c = 0; c < 3; c++) {
      const i = p + c;
      let v: number;
      switch (mode) {
        case 'average': { let s = 0; for (let j = 0; j < k; j++) s += frames[j][i]; v = s / k; break; }
        case 'max': { v = 0; for (let j = 0; j < k; j++) v = Math.max(v, frames[j][i]); break; }
        case 'min': { v = 255; for (let j = 0; j < k; j++) v = Math.min(v, frames[j][i]); break; }
        case 'difference': { v = 0; for (let j = 1; j < k; j++) v = Math.max(v, Math.abs(frames[j][i] - frames[j - 1][i])); break; }
        case 'median': {
          for (let j = 0; j < k; j++) vals[j] = frames[j][i];
          const s = Array.from(vals).sort((a, b) => a - b);
          v = k % 2 ? s[(k - 1) / 2] : 0.5 * (s[k / 2 - 1] + s[k / 2]);
          break;
        }
        default: v = frames[0][i];
      }
      out[i] = v;
    }
    out[p + 3] = 255;
  }
  return out;
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Hue (0–1) of an RGB colour, 0–1 channels; 0 for grey. */
export function hueOf(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-6) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return h < 0 ? h + 1 : h;
}

/**
 * A frame's numbers (motion is filled in by frameMotion), reading every `step`-th pixel. Also
 * returns that sparse luma, for the motion between frames.
 */
export function frameStat(px: Uint8ClampedArray, key: { color: readonly number[]; tolerance: number }, step = 4): { stat: Omit<FrameStat, 'motion'>; luma: Float32Array } {
  const n = Math.floor(px.length / 4);
  const count = Math.max(1, Math.floor(n / step));
  const L = new Float32Array(count);
  let sr = 0, sg = 0, sb = 0, sat = 0, keyed = 0;
  const kr = key.color[0], kg = key.color[1], kb = key.color[2], tol = key.tolerance * Math.sqrt(3);
  for (let s = 0; s < count; s++) {
    const p = s * step * 4;
    const r = px[p] / 255, g = px[p + 1] / 255, b = px[p + 2] / 255;
    sr += r; sg += g; sb += b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx > 1e-6 ? (mx - mn) / mx : 0;
    if (Math.hypot(r - kr, g - kg, b - kb) <= tol) keyed++;
    L[s] = luma(r, g, b);
  }
  const mr = sr / count, mg = sg / count, mb = sb / count;
  return { stat: { brightness: luma(mr, mg, mb), hue: hueOf(mr, mg, mb), saturation: sat / count, key: keyed / count }, luma: L };
}

/** Motion of each frame: the mean change in luma from the frames either side (in time order). */
export function frameMotion(lumas: readonly Float32Array[]): number[] {
  const diff = (a: Float32Array, b: Float32Array) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]); return n ? s / n : 0; };
  const n = lumas.length;
  const d = Array.from({ length: Math.max(0, n - 1) }, (_, i) => diff(lumas[i], lumas[i + 1]));
  return Array.from({ length: n }, (_, i) => {
    const a = i > 0 ? d[i - 1] : undefined, b = i < n - 1 ? d[i] : undefined;
    return a === undefined ? (b ?? 0) : b === undefined ? a : 0.5 * (a + b);
  });
}

/** Rough build time for the card: seeking decodes about one frame per 26 ms (docs/time-cube.md, Performance). */
export function buildEstimate(frames: number, sub: number, painted: boolean): { decoded: number; seconds: number } {
  const decoded = frames * Math.max(1, sub);
  return { decoded, seconds: painted ? decoded * 0.0002 : decoded * 0.026 };
}
