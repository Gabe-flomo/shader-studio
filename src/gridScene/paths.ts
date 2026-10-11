/**
 * paths.ts — the Grid builder's drawn motion paths (docs/grid-builder.md "Drawn paths"): a stroke
 * drawn on the motion pad (or generated), smoothed, resampled by arc length to PATH_POINTS points
 * so the shape moves at an even speed, and packed into numbers the shader reads live (no rebuild
 * when the path is redrawn). Points are in pad units, −1 … 1 each way (y up); the XY reach scales
 * them to cells and the Angle turns them. Pure: no store, no React.
 *
 * One cycle of motion, at u = 0 … 1:
 *   - closed: once round the loop;
 *   - open, snap back: start → end, then straight back to the start;
 *   - open, ease back: start → end over (1 − back) of the cycle, then a straight eased glide home
 *     over the last `back`;
 *   - open, ping-pong: start → end → start along the path.
 * `ease` (0 … 1) blends an ease-in-out into the progress along the path.
 */
import { makeRng } from '../lib/surprise';
import type { Vec2 } from './spec';

/** How many points the shader reads (arc-length spaced). */
export const PATH_POINTS = 32;
/** The numbers before the points in the packed data: bounds (bx, by) and rates (gx, gy). */
export const PATH_HEAD = 4;
/** The most stroke points kept in the spec. */
export const MAX_STROKE = 64;

export const PATH_ENDS = ['snap', 'ease', 'pingpong'] as const;
export type PathEnd = typeof PATH_ENDS[number];
export const PATH_END_LABELS: Record<PathEnd, { label: string; blurb: string }> = {
  snap: { label: 'Snap back', blurb: 'At the end it jumps straight back to the start.' },
  ease: { label: 'Ease back', blurb: 'At the end it glides straight home, easing, over the Back share of the cycle.' },
  pingpong: { label: 'Ping-pong', blurb: 'At the end it turns round and goes back along the path.' },
};

export interface DrawnPath {
  /** The stroke as drawn (or generated): pad units, −1 … 1, y up. At least 2 points. */
  pts: Vec2[];
  /** Loops round (the end joins the start). */
  closed: boolean;
  /** What an open path does at its end. */
  ends: PathEnd;
  /** Ease back: the share of the cycle the glide home takes (0.05 … 0.9). */
  back: number;
  /** 0 … 1: ease in and out along the path each cycle. */
  ease: number;
  /** 0 … 1: how much the stroke is rounded (corner cutting) before it is resampled. */
  smooth: number;
  /** Auto smooth: a drawn stroke is thinned and faired when the pointer lifts. */
  auto: boolean;
}

export const defaultDrawnPath = (): DrawnPath => ({ pts: circlePts(12, 0.8), closed: true, ends: 'snap', back: 0.3, ease: 0, smooth: 0.5, auto: true });

function circlePts(n: number, r: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * Math.PI * 2), r * Math.sin((i / n) * Math.PI * 2)] as Vec2);
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ── Smoothing ─────────────────────────────────────────────────────────────────

/** Chaikin corner cutting, `iterations` times (open paths keep their ends). */
export function chaikin(pts: Vec2[], closed: boolean, iterations: number): Vec2[] {
  let p = pts;
  for (let k = 0; k < iterations && p.length > 2; k++) {
    const out: Vec2[] = closed ? [] : [p[0]];
    const n = closed ? p.length : p.length - 1;
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!closed) out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Ramer–Douglas–Peucker: the fewest points that stay within `tol` of the stroke. */
export function simplify(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const a = pts[i0], b = pts[i1];
    const L = dist(a, b);
    let worst = -1, at = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i];
      const d = L < 1e-9 ? dist(p, a) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol && at > 0) { keep[at] = true; stack.push([i0, at], [at, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * A raw pointer stroke made ready to keep: thinned (and, with auto smooth, faired: simplified to
 * within `tol` then rounded once) and capped at MAX_STROKE points, all inside −1 … 1.
 */
export function cleanStroke(raw: Vec2[], auto: boolean, tol = 0.02): Vec2[] {
  let p = raw.map(([x, y]) => [clamp1(x), clamp1(y)] as Vec2).filter((q, i, a) => i === 0 || dist(q, a[i - 1]) > 1e-4);
  if (p.length < 2) return p;
  if (auto) p = simplify(p, tol);
  // Cap: drop every other point until it fits (keeping the ends).
  while (p.length > MAX_STROKE) p = p.filter((_, i) => i % 2 === 0 || i === p.length - 1);
  return p;
}

// ── Arc length ────────────────────────────────────────────────────────────────

/** `n` points evenly spaced along the polyline (closed: round the loop, the n-th would be the first again). */
export function resampleArc(pts: Vec2[], n: number, closed: boolean): Vec2[] {
  if (pts.length === 0) return Array.from({ length: n }, () => [0, 0] as Vec2);
  if (pts.length === 1) return Array.from({ length: n }, () => [...pts[0]] as Vec2);
  const seq = closed ? [...pts, pts[0]] : pts;
  const cum = [0];
  for (let i = 1; i < seq.length; i++) cum.push(cum[i - 1] + dist(seq[i - 1], seq[i]));
  const total = cum[cum.length - 1];
  if (total < 1e-9) return Array.from({ length: n }, () => [...pts[0]] as Vec2);
  const out: Vec2[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const s = (closed ? k / n : k / (n - 1)) * total;
    while (j < seq.length - 1 && cum[j] < s) j++;
    const a = seq[j - 1], b = seq[j], seg = cum[j] - cum[j - 1];
    const f = seg < 1e-12 ? 0 : (s - cum[j - 1]) / seg;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

/** The path the shader reads: the stroke rounded by `smooth` (up to 3 Chaikin passes) and arc-length resampled. */
export function samplePoints(p: DrawnPath): Vec2[] {
  const iters = Math.round(Math.max(0, Math.min(1, p.smooth)) * 3);
  return resampleArc(chaikin(p.pts, p.closed, iters), PATH_POINTS, p.closed);
}

/**
 * The packed numbers (PATH_HEAD + 2 · PATH_POINTS): the bounds bx, by (the largest |x|, |y| of
 * the points: the path stays in that box, before the reach and the Angle) and the rates gx, gy
 * (the largest |Δx|, |Δy| of a step times the steps a cycle: how fast it can go, per unit of
 * progress), then the points x0, y0, x1, y1…
 */
export function packPath(p: DrawnPath): number[] {
  const q = samplePoints(p);
  const steps = p.closed ? q.length : q.length - 1;
  let bx = 0, by = 0, gx = 0, gy = 0;
  q.forEach((a, i) => {
    bx = Math.max(bx, Math.abs(a[0])); by = Math.max(by, Math.abs(a[1]));
    if (i < steps) {
      const b = q[(i + 1) % q.length];
      gx = Math.max(gx, Math.abs(b[0] - a[0]) * steps); gy = Math.max(gy, Math.abs(b[1] - a[1]) * steps);
    }
  });
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  return [r(bx), r(by), r(gx), r(gy), ...q.flatMap(([x, y]) => [r(x), r(y)])];
}

/** The live settings the shader reads beside the points: (closed, end mode 0 snap / 1 ease / 2 ping-pong, back, ease). */
export const pathConfig = (p: DrawnPath): [number, number, number, number] => [p.closed ? 1 : 0, PATH_ENDS.indexOf(p.ends), clampBack(p.back), Math.max(0, Math.min(1, p.ease))];
export const clampBack = (b: number) => Math.max(0.05, Math.min(0.9, b));

// ── Where the shape is (the shader's sums, glsl.ts gs_path) ───────────────────

const smooth01 = (x: number) => x * x * (3 - 2 * x);
const eased = (s: number, e: number) => s + (smooth01(s) - s) * e;

/** A point on the packed path at progress s (0 … 1): straight between the arc-length points. */
function along(q: Vec2[], closed: boolean, s: number): Vec2 {
  const n = q.length;
  let i: number, j: number, k: number;
  if (closed) {
    const f = (s - Math.floor(s)) * n;
    i = Math.floor(f) % n; j = (i + 1) % n; k = f - Math.floor(f);
  } else {
    const f = Math.max(0, Math.min(1, s)) * (n - 1);
    i = Math.min(Math.floor(f), n - 2); j = i + 1; k = f - i;
  }
  return [q[i][0] + (q[j][0] - q[i][0]) * k, q[i][1] + (q[j][1] - q[i][1]) * k];
}

/** The path's offset (pad units, y up) at phase `ph` cycles: the progress, the end mode, the ease. */
export function pathAt(q: Vec2[], cfg: readonly [number, number, number, number], ph: number): Vec2 {
  const [closed, mode, back0, e] = cfg;
  const u = ph - Math.floor(ph);
  if (closed > 0.5) return along(q, true, eased(u, e));
  if (mode < 0.5) return along(q, false, eased(u, e));
  if (mode < 1.5) {
    const back = clampBack(back0);
    if (u < 1 - back) return along(q, false, eased(u / (1 - back), e));
    const k = smooth01((u - (1 - back)) / back);
    const a = q[q.length - 1], b = q[0];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  return along(q, false, eased(1 - Math.abs(2 * u - 1), e));
}

// ── Generate ──────────────────────────────────────────────────────────────────

export interface GenerateOptions { closed: boolean; wiggle: number; points: number }

/** A random path from `seed` (the same seed, the same path): a wobbly loop, or a meandering line left to right. */
export function generatePath(seed: number, o: GenerateOptions): Vec2[] {
  const rng = makeRng(`path:${seed}`);
  const n = Math.max(3, Math.min(MAX_STROKE, Math.round(o.points)));
  const w = Math.max(0, Math.min(1, o.wiggle));
  let pts: Vec2[];
  if (o.closed) {
    // Round a loop, the radius wobbling by a few smooth harmonics.
    const harm = Array.from({ length: 3 }, (_, i) => ({ k: i + 2, a: rng.float(-1, 1) * w * 0.5 / (i + 1), p: rng.float(0, Math.PI * 2) }));
    const sx = rng.float(0.7, 1), sy = rng.float(0.7, 1);
    pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = 1 + harm.reduce((acc, h) => acc + h.a * Math.sin(h.k * a + h.p), 0);
      return [sx * r * Math.cos(a), sy * r * Math.sin(a)] as Vec2;
    });
  } else {
    // A meander: x steps across, y a smoothed random walk.
    let y = rng.float(-0.3, 0.3), v = 0;
    pts = Array.from({ length: n }, (_, i) => {
      v = v * 0.6 + rng.float(-1, 1) * w;
      y += v * 0.5;
      return [-1 + (2 * i) / (n - 1), y] as Vec2;
    });
  }
  return fit(pts);
}

/** Scaled (keeping its shape) and centred so it fills −0.95 … 0.95 at most. */
export function fit(pts: Vec2[]): Vec2[] {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const half = Math.max(Math.max(...xs) - cx, Math.max(...ys) - cy, 1e-6);
  const k = 0.95 / half;
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return pts.map(([x, y]) => [r((x - cx) * k), r((y - cy) * k)] as Vec2);
}
