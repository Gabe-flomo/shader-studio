/**
 * Time Cube View's look (docs/time-cube.md, "Shape, glow and highlights"). Pure maths, no GL: the
 * same functions the view's GLSL writes out (nodes/definitions/timeCube.ts, the `tc*` helpers), so
 * the tests can check them. Kept in step with the GLSL by hand, like plan.ts.
 *
 * - The shape: a box with rounded corners and puffed-out faces, as a signed distance.
 * - Edge softness: how much of a pixel the shape covers, from how deep its ray goes into it.
 * - Highlights: a comb of frames, Count of them Spacing apart, from a start that can travel with
 *   the slice and wrap round the box.
 * - Frame motion: a bump that travels with the slice (or sits on the highlights), and how it moves
 *   a frame: lifted, scaled, turned.
 */

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
const fract = (x: number) => x - Math.floor(x);

type V3 = readonly [number, number, number] | readonly number[];

/** Signed distance to a box of half size `b` with corners rounded by `r` (GLSL tcRoundBox): < 0 inside. */
export function roundBox(p: V3, b: V3, r: number): number {
  const q = [0, 1, 2].map(i => Math.abs(p[i]) - b[i] + r);
  const out = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
  return out + Math.min(Math.max(q[0], q[1], q[2]), 0) - r;
}

/**
 * The view's shape (GLSL tcShape): a rounded box whose faces puff out by `bulge` (world units) at
 * their middles. The rounding is capped at the smallest half size: there the box is a pill.
 */
export function shapeDistance(p: V3, b: V3, round: number, bulge: number): number {
  const s = [0, 1, 2].map(i => { const v = clamp(p[i] / b[i], -1, 1); return v * v; });
  const grow = [bulge * (1 - s[1]) * (1 - s[2]), bulge * (1 - s[0]) * (1 - s[2]), bulge * (1 - s[0]) * (1 - s[1])];
  const bb = [b[0] + grow[0], b[1] + grow[1], b[2] + grow[2]];
  return roundBox(p, bb, Math.min(round, bb[0], bb[1], bb[2]));
}

/** Corner rounding (0–1 on the card) in world units: 1 rounds by the box's smallest half size, a pill. */
export const cornerRadius = (roundness: number, half: V3) => clamp(roundness, 0, 1) * Math.min(half[0], half[1], half[2]);

/**
 * How much of a pixel the shape covers (GLSL: the view's `_cov`), from `md`, the least distance to
 * the shape along the pixel's ray: < 0 when the ray goes in, and then minus how deep. Rays that only
 * graze the shape cover little of the pixel, so its silhouette fades out over `feather` (world
 * units), never less than a pixel (`px`, world units at that depth): an anti-aliased edge.
 */
export function coverage(md: number, feather: number, px: number): number {
  return smoothstep(-0.5 * px, Math.max(feather, px), -md);
}

/** The rim glow's strength at least-distance `md`: brightest on the silhouette, gone by a few widths. */
export function rimGlow(md: number, strength: number, width: number): number {
  return clamp(strength * Math.exp(-Math.abs(md) / Math.max(width, 1e-4)), 0, 1);
}

export type HighlightMode = 'loop' | 'follow' | 'fixed';

export interface HighlightComb {
  /** Where the first highlighted frame is, 0–1 in time. */
  start: number;
  /** Time between highlighted frames, 0–1. */
  spacing: number;
  count: number;
  loop: boolean;
}

/**
 * The comb of highlighted frames for the card's settings (GLSL: the view's `_hl`). `start` and
 * `spacing` are in frames; `frames` is the volume's frame count. With 'loop' or 'follow' the comb
 * starts at the slice (Offset) and travels with it; 'loop' wraps it round the box, so as the slice
 * sweeps the highlighted frames come round again and again.
 */
export function highlightComb(mode: HighlightMode, offset: number, start: number, spacing: number, count: number, frames: number): HighlightComb {
  const fs = 1 / Math.max(frames - 1, 1);
  return {
    start: (mode === 'fixed' ? 0 : offset) + start * fs,
    spacing: Math.max(spacing, 0.25) * fs,
    count: Math.max(Math.floor(count + 0.5), 1),
    loop: mode === 'loop',
  };
}

/**
 * Signed time from `g` to the nearest highlighted frame (GLSL tcComb): g minus that frame's time.
 * Frames sit at start + k × spacing for k < count; looping, they wrap round modulo 1 (a comb up to
 * two box-lengths long wraps correctly).
 */
export function combDistance(g: number, c: HighlightComb): number {
  const S = Math.max(c.spacing, 1e-4), n = Math.max(c.count, 1);
  let x = g - c.start;
  if (!c.loop) return x - clamp(Math.floor(x / S + 0.5), 0, n - 1) * S;
  x = fract(x);
  let best = 1e9;
  for (let m = -1; m <= 1; m++) {
    const xm = x + m;
    const d = xm - clamp(Math.floor(xm / S + 0.5), 0, n - 1) * S;
    if (Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}

/** The times of the highlighted frames that are inside the box (0–1), sorted. */
export function highlightTimes(c: HighlightComb): number[] {
  const out: number[] = [];
  for (let k = 0; k < c.count; k++) {
    const t = c.start + k * c.spacing;
    const w = c.loop ? fract(t) : t;
    if (w >= 0 && w <= 1) out.push(+w.toFixed(9));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * How much of one march step, from time ga to gb, lies inside the highlighted frame nearest its
 * middle, `thick` (time) thick (GLSL: the view's `_fr` and `_cr`). `share` is the part of the step
 * inside it (it dims Others by that much); `crossed` the part of the frame the step crosses, so the
 * steps through one frame add up to one whole frame whatever the ray's angle.
 */
export function stepInHighlight(ga: number, gb: number, c: HighlightComb, thick: number): { share: number; crossed: number; centre: number } {
  const lo = Math.min(ga, gb), hi = Math.max(ga, gb), mid = 0.5 * (lo + hi);
  const centre = mid - combDistance(mid, c);
  const hw = 0.5 * Math.max(thick, 1e-6);
  const ov = Math.max(Math.min(hi, centre + hw) - Math.max(lo, centre - hw), 0);
  const share = hi - lo > 1e-6 ? ov / (hi - lo) : (Math.abs(mid - centre) <= hw ? 1 : 0);
  const crossed = Math.min(ov / (2 * hw), 1);
  return { share, crossed, centre };
}

/** The motion bump (GLSL tcBump): 1 at distance 0, easing (a half cosine) to 0 at `width`. */
export function bump(d: number, width: number): number {
  const x = clamp(Math.abs(d) / Math.max(width, 1e-5), 0, 1);
  return 0.5 + 0.5 * Math.cos(Math.PI * x);
}

export interface FrameMotion {
  /** Lift sideways and up, in frame heights. */
  side: number;
  up: number;
  /** Scale: 1 + scale × bump. */
  scale: number;
  /** Turn in radians at the top of the bump. */
  turn: number;
}

/**
 * Where to read the frame for frame point (u, v) when its frame is moved by bump `b` (GLSL tcWarp).
 * The frame is turned, scaled and then lifted, so reading goes the other way: un-lift, un-scale,
 * un-turn. This is the inverse mapping: each sample of the march asks which point of the still
 * frame lands on it, so no frame has to be drawn on its own.
 */
export function warpUv(u: number, v: number, b: number, m: FrameMotion, aspect: number): [number, number] {
  let dx = (u - 0.5) * aspect - m.side * b;
  let dy = v - 0.5 - m.up * b;
  const s = Math.max(1 + m.scale * b, 0.05);
  dx /= s; dy /= s;
  const a = -m.turn * b, c = Math.cos(a), sn = Math.sin(a);
  const rx = c * dx - sn * dy, ry = sn * dx + c * dy;
  return [rx / aspect + 0.5, ry + 0.5];
}

/** The forward move (for tests): where frame point (u, v) ends up under bump `b`. */
export function moveUv(u: number, v: number, b: number, m: FrameMotion, aspect: number): [number, number] {
  const a = m.turn * b, c = Math.cos(a), sn = Math.sin(a);
  const dx = (u - 0.5) * aspect, dy = v - 0.5;
  const s = Math.max(1 + m.scale * b, 0.05);
  const rx = (c * dx - sn * dy) * s + m.side * b, ry = (sn * dx + c * dy) * s + m.up * b;
  return [rx / aspect + 0.5, ry + 0.5];
}

/**
 * How far moved frames can reach past the box's sides, in frame heights (GLSL: the view's `_grow`):
 * the march's box grows by this across the frame, so lifted frames are not cut off.
 */
export function motionReach(m: FrameMotion, aspect: number): number {
  const wide = Math.max(aspect, 1);
  return Math.abs(m.side) + Math.abs(m.up) + Math.max(m.scale, 0) * 0.5 * wide + (m.turn !== 0 ? 0.25 * wide : 0);
}

// ── Flow ─────────────────────────────────────────────────────────────────────

/**
 * Flow mode (GLSL: the view's `tmap`): the clip time read at box time z, with the crisp frame at
 * `framePos` and the flow at `tau` clip lengths (Flow time + Flow speed × seconds). At the frame the
 * clip plays (time = tau, wrapped); a frame of the clip moves through the box toward the front as
 * tau grows and wraps round to the back.
 */
export function flowTime(z: number, framePos: number, tau: number): number {
  return fract(z + tau - framePos);
}

/** Where in the box (0–1) clip time `t` sits at flow `tau`: the inverse of flowTime. */
export function flowPlace(t: number, framePos: number, tau: number): number {
  return fract(t - tau + framePos);
}

// ── Key pulse and lightning ─────────────────────────────────────────────────

export type PulseDir = 'forward' | 'backward' | 'bounce' | 'outward';

/** The pulse's phase at time `seconds` (GLSL: the view's `_pph`): back and forth across the box for 'bounce'. */
export function pulsePhase(dir: PulseDir, phase: number, speed: number, seconds: number, count: number): number {
  const raw = phase + seconds * speed;
  if (dir !== 'bounce') return raw;
  const m = ((raw % 2) + 2) % 2;
  return (1 - Math.abs(1 - m)) * Math.max(Math.floor(count + 0.5), 1);
}

/**
 * Is box time g inside a pulse band (GLSL tcPulse)? `count` bands along the box, each `width` of
 * the space between them, soft edges by `softness`; the bands move one spacing per unit of phase.
 */
export function pulseBand(g: number, count: number, width: number, softness: number, phase: number, dir: PulseDir = 'forward', slice = 0): number {
  const x = dir === 'backward' ? 1 - g : dir === 'outward' ? Math.abs(g - slice) : g;
  const d = Math.abs(fract(x * Math.max(count, 0) - phase) - 0.5) * 2;
  const w = clamp(width, 0.001, 1);
  return 1 - smoothstep(w * (1 - clamp(softness, 0, 1)), w + 1e-4, d);
}

/** GLSL tcHash: a float hash of n, 0–1. */
export const hash = (n: number) => fract(Math.sin(n * 12.9898 + 4.1414) * 43758.5453);

/**
 * A lightning burst (GLSL tcBurstAt): slot k of a clock at `rate` a second. It strikes (4 slots in
 * 5) at a random moment in the first half of its slot, at a random place in time, flickers, and dies
 * away over about a fifth of a second (whatever the rate: at 2.5 a second a flash used to last only
 * 50 ms, a frame or two, and was easy to miss). Returns [centre, width, strength now].
 */
export function lightningBurst(k: number, rate: number, seed: number, width: number, seconds: number): [number, number, number] {
  const s = seconds * Math.max(rate, 0.01);
  const h0 = hash(k + seed * 17.17), h1 = hash(k * 1.31 + seed * 3.7 + 11), h2 = hash(k * 2.17 + seed * 5.3 + 23);
  const age = s - k - h0 * 0.5;
  const fire = (h2 <= 0.8 ? 1 : 0) * (age >= 0 ? 1 : 0);
  const flick = 0.7 + 0.3 * (hash(Math.floor(seconds * 24) + k * 7) >= 0.35 ? 1 : 0);
  return [h1, Math.max(width, 0.002) * (0.4 + 0.75 * h2), fire * Math.exp(-Math.max(age, 0) / Math.max(rate, 0.01) * 10) * flick];
}

/**
 * How visible the keyed colour is at box time g (GLSL: the view's `_kv`): the pulse bands (Pulse 0
 * shows it all), then lightning: up to 0.5 the flashes come in on top, from 0.5 to 1 the rest fades.
 */
export function keyVisibility(band: number, pulse: number, lightning: number, flash: number): number {
  const kv = 1 + (band - 1) * clamp(pulse, 0, 1);
  if (lightning <= 0) return kv;
  return Math.max(kv * (1 - clamp(2 * lightning - 1, 0, 1)), Math.min(2 * lightning, 1) * flash);
}

// ── Depth of field ───────────────────────────────────────────────────────────

/** The lens's aperture per unit of Blur, in box sizes (GLSL: the view's APERTURE). */
export const APERTURE = 0.3;

/**
 * The blur's radius (world units) at distance t along a ray (GLSL: the view's `cocAt`): Blur sets
 * the aperture (APERTURE × Blur × Box size), zero at the focus distance F, capped at Max blur pixels
 * (`px` = a pixel's width in world units at t). At the default Blur the ends of the box blur by
 * several pixels (the old 0.08 aperture blurred them by one or two: switching Focus on barely showed).
 */
export function blurRadius(t: number, focusDist: number, blur: number, size: number, maxBlurPx: number, px: number): number {
  const ap = Math.max(blur, 0) * APERTURE * size;
  return Math.min(ap * Math.abs(t - focusDist) / Math.max(focusDist, 1e-3), maxBlurPx * px);
}

/**
 * How many reads the blur takes (GLSL tcBlurTaps) for a blur `rpx` pixels across: enough to cover
 * its disc evenly (Smooth up to 32, Fast up to 8), times `share`, how much the read can still show
 * (a thin stretch of the box needs only one, at a point on the disc turned per pixel and per stretch:
 * many thin stretches add up to the blur). One read in focus.
 */
export function blurTaps(rpx: number, smooth: boolean, share: number): number {
  if (rpx < 0.5) return 1;
  const n = smooth ? clamp(0.6 * rpx * rpx, 6, 32) : clamp(0.25 * rpx * rpx, 4, 8);
  return Math.max(Math.ceil(n * clamp(share * 8, 0, 1)), 1);
}

/** Per-frame treatments (GLSL tcFx): hue turned along time, posterized to `levels`, older frames greyed. */
export function frameFx(c: V3, t: number, age: number, hue: number, levels: number, ageGrey: number): [number, number, number] {
  let r = c[0], g = c[1], b = c[2];
  if (hue !== 0) {
    const a = 2 * Math.PI * hue * t, k = 1 / Math.sqrt(3), cs = Math.cos(a), sn = Math.sin(a);
    const d = k * (r + g + b) * (1 - cs);
    const cx = k * (b - g), cy = k * (r - b), cz = k * (g - r); // cross((k,k,k), c)
    [r, g, b] = [r * cs + cx * sn + d, g * cs + cy * sn + d, b * cs + cz * sn + d];
  }
  if (levels >= 2) { const L = levels - 1; [r, g, b] = [r, g, b].map(x => Math.floor(x * L + 0.5) / L); }
  if (ageGrey > 0) {
    const l = 0.299 * r + 0.587 * g + 0.114 * b, w = clamp(ageGrey * age * 2, 0, 1);
    [r, g, b] = [r + (l - r) * w, g + (l - g) * w, b + (l - b) * w];
  }
  return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)];
}
