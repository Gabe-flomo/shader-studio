/**
 * takePlayback.ts — a take's keyframes (see takes.ts and PlayTake in
 * types/play.ts): writing a recorded track as few keys as keep its shape,
 * and reading any track back at a clock time. Pure, no store.
 *
 * A track is recorded once a frame. Most of it is a knob held still or a
 * smooth sweep, so on stop each track keeps only the samples it needs to be
 * redrawn within a small tolerance (Ramer–Douglas–Peucker); a press or a
 * hover keeps only its changes. The keys are text (`gap,value…`) so a saved
 * take stays compact in a pretty-printed graph file.
 */
import type { PlayTake, TakeEvent, TakeTrack } from '../types/play';
import type { KitPointer } from '../play/kit/kit.js';

export type { PlayTake as Take, TakeTrack } from '../types/play';

// ── Writing ──────────────────────────────────────────────────────────────────

/** Round for the keys text: 5 significant digits, no trailing zeros. */
function short(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Number(v.toPrecision(5));
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * The indices of the samples to keep: the ends, and every sample a straight
 * line between its kept neighbours would miss by more than `tol` (in any
 * channel). A step track keeps only the samples where the value changes.
 */
export function keepIndices(times: number[], values: number[], width: number, tol: number, step = false): number[] {
  const n = times.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  if (step) {
    const out = [0];
    for (let i = 1; i < n; i++) {
      for (let c = 0; c < width; c++) if (values[i * width + c] !== values[(i - 1) * width + c]) { out.push(i); break; }
    }
    if (out[out.length - 1] !== n - 1) out.push(n - 1);
    return out;
  }
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!, a = stack.pop()!;
    if (b - a < 2) continue;
    const ta = times[a], span = times[b] - ta;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const f = span > 0 ? (times[i] - ta) / span : 0;
      let d = 0;
      for (let c = 0; c < width; c++) {
        const va = values[a * width + c], vb = values[b * width + c];
        d = Math.max(d, Math.abs(values[i * width + c] - (va + (vb - va) * f)));
      }
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol) { keep[at] = 1; stack.push(a, at, at, b); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/**
 * A recorded track as keys text. `times` are seconds from the take's start;
 * `values` has `width` numbers per sample. `precision` scales the tolerance
 * (1 = 0.2% of the track's own range).
 */
export function encodeKeys(times: number[], values: number[], width: number, step = false, precision = 1): string {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = Number.isFinite(hi - lo) ? hi - lo : 0;
  const tol = Math.max(range * 0.002, 1e-5 * Math.max(1, Math.abs(hi), Math.abs(lo))) * precision;
  const keep = keepIndices(times, values, width, tol, step);
  const parts: string[] = [];
  let lastMs = 0;
  for (const i of keep) {
    const ms = Math.max(lastMs, Math.round(times[i] * 1000));
    parts.push(String(ms - lastMs));
    lastMs = ms;
    for (let c = 0; c < width; c++) parts.push(short(values[i * width + c]));
  }
  return parts.join(',');
}

// ── Reading ──────────────────────────────────────────────────────────────────

interface Decoded { t: Float64Array; v: Float64Array }
const decoded = new WeakMap<TakeTrack, Decoded>();

/** A track's keys as times (s from the take's start) and values; decoded once per track. */
export function decodeKeys(track: TakeTrack): Decoded {
  let d = decoded.get(track);
  if (d) return d;
  const nums = track.keys ? track.keys.split(',').map(Number) : [];
  const stride = track.width + 1;
  const n = Math.floor(nums.length / stride);
  const t = new Float64Array(n), v = new Float64Array(n * track.width);
  let ms = 0;
  for (let i = 0; i < n; i++) {
    ms += nums[i * stride] || 0;
    t[i] = ms / 1000;
    for (let c = 0; c < track.width; c++) v[i * track.width + c] = nums[i * stride + 1 + c] || 0;
  }
  d = { t, v };
  decoded.set(track, d);
  return d;
}

/** The key at or before `s`, and how far towards the next one `s` is. */
function locate(t: Float64Array, s: number): { i: number; f: number } {
  const n = t.length;
  if (n === 0 || s <= t[0]) return { i: 0, f: 0 };
  if (s >= t[n - 1]) return { i: n - 1, f: 0 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= s) lo = m; else hi = m; }
  const span = t[hi] - t[lo];
  return { i: lo, f: span > 0 ? (s - t[lo]) / span : 0 };
}

/** A track's value `s` seconds into the take: a number, or [r, g, b]. Holds the ends. */
export function trackAt(track: TakeTrack, s: number): number | number[] {
  const { t, v } = decodeKeys(track);
  if (t.length === 0) return track.width === 3 ? [0, 0, 0] : 0;
  const { i, f } = locate(t, s);
  const j = Math.min(i + 1, t.length - 1);
  const k = track.step ? 0 : f;
  const w = track.width;
  if (w === 1) return v[i] + (v[j] - v[i]) * k;
  return [0, 1, 2].map(c => v[i * w + c] + (v[j * w + c] - v[i * w + c]) * k);
}

const num = (v: number | number[]) => (typeof v === 'number' ? v : v[0]);

/** The take's control values at clock `time`: per control id, a number or [r, g, b]. */
export function takeValuesAt(take: PlayTake, time: number): Map<string, number | number[]> {
  const out = new Map<string, number | number[]>();
  for (const tr of take.tracks) if (tr.kind === 'control') out.set(tr.id, trackAt(tr, time - take.from));
  return out;
}

/** The pointer over the layers at clock `time`, or null when the take has none. */
export function takePointerAt(take: PlayTake, time: number): KitPointer | null {
  const s = time - take.from;
  let x: number | null = null, y = 0.5, over = false, down = false;
  for (const tr of take.tracks) {
    if (tr.kind !== 'pointer') continue;
    const v = num(trackAt(tr, s));
    if (tr.id === 'x') x = v; else if (tr.id === 'y') y = v; else if (tr.id === 'over') over = v > 0.5; else if (tr.id === 'down') down = v > 0.5;
  }
  return x === null ? null : { x, y, over, down };
}

/** The shader's mouse (u_mouse) at clock `time`, 0..1 of the picture, or null when the take has none. */
export function takeMouseAt(take: PlayTake, time: number): [number, number] | null {
  const s = time - take.from;
  let x: number | null = null, y = 0;
  for (const tr of take.tracks) {
    if (tr.kind !== 'mouse') continue;
    if (tr.id === 'x') x = num(trackAt(tr, s)); else if (tr.id === 'y') y = num(trackAt(tr, s));
  }
  return x === null ? null : [x, y];
}

/**
 * Actions that fired after clock time `after` and up to `upTo`. A frame asks
 * for the span since the frame before, so each action fires once, on the first
 * frame at or after the moment it fired; the first frame passes -Infinity.
 */
export function takeEventsBetween(take: PlayTake, after: number, upTo: number): TakeEvent[] {
  const a = after - take.from, b = upTo - take.from;
  return take.events.filter(e => e.t > a && e.t <= b);
}

/** Characters of keyframe text: what the take costs in a saved file (near enough). */
export function takeSize(take: PlayTake): number {
  let n = 0;
  for (const t of take.tracks) n += t.keys.length + t.id.length + (t.target?.length ?? 0) + t.label.length + 40;
  for (const a of take.audioFrames ?? []) n += a.times.length + a.data.length + a.source.length + 60;
  return n + take.events.length * 60;
}
