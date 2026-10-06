/**
 * Clip settings for a video source (components/media/ClipEditor.tsx): which
 * stretches of the video are kept ("segments", played one after another),
 * how a frame budget is shared between them, a speed ramp, and a crop /
 * rotate / flip applied to every frame. Pure maths plus one canvas helper.
 *
 * Used by the Time Cube today (lib/timeCube/plan.ts). Video Input, the Video
 * layer and Bake could take the same settings later: their sample times come
 * from planSampleTimes, and drawClipFrame draws a frame the way the editor
 * previews it.
 */

export interface ClipSegment {
  /** Seconds into the video. */
  in: number;
  /** Seconds; at or before `in`: the end of the video (how an old Start / End with End 0 reads). */
  out: number;
  /** Play this stretch backwards. */
  reverse?: boolean;
}

/** How a frame budget is shared between segments: by their length, or the same number each. */
export type ClipDistribute = 'proportional' | 'equal';
/** Sample spacing through each segment: even, denser at its start (ease-in) or at its end (ease-out). */
export type ClipRamp = 'none' | 'easeIn' | 'easeOut';
export type ClipRotate = 0 | 90 | 180 | 270;

/** A crop of the frame, 0–1 of its width and height, top-left origin. */
export interface ClipCrop { x: number; y: number; w: number; h: number }

export interface ClipTransform {
  crop: ClipCrop;
  /** Clockwise, applied after the crop. */
  rotate: ClipRotate;
  /** Mirror left–right / top–bottom, applied after the rotation. */
  flipX: boolean;
  flipY: boolean;
}

export interface ClipSettings {
  segments: ClipSegment[];
  distribute: ClipDistribute;
  ramp: ClipRamp;
  xf: ClipTransform;
}

/** A segment as planned: its seconds, its share of the frames and where they start. */
export interface PlannedSegment {
  in: number;
  out: number;
  reverse: boolean;
  /** Index of its first frame in the output. */
  first: number;
  frames: number;
}

export interface SamplePlan {
  /** The video time of each output frame, in output order. */
  times: number[];
  /** How much video each frame stands for (seconds): what a frame that combines sub-frames spreads over. */
  slots: number[];
  segments: PlannedSegment[];
  /** Seconds of video kept, all segments together. */
  span: number;
}

export const MAX_SEGMENTS = 16;
/** Shorter than this, a segment is dropped. */
export const MIN_SEGMENT = 1e-4;
export const FULL_CROP: ClipCrop = { x: 0, y: 0, w: 1, h: 1 };
export const IDENTITY_XF: ClipTransform = { crop: FULL_CROP, rotate: 0, flipX: false, flipY: false };
/** The smallest crop side, a share of the frame. */
export const MIN_CROP = 0.05;

const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const defaultClip = (): ClipSettings => ({ segments: [{ in: 0, out: 0 }], distribute: 'proportional', ramp: 'none', xf: { ...IDENTITY_XF, crop: { ...FULL_CROP } } });

/** A crop, cleaned: inside the frame, no side under MIN_CROP. */
export function cleanCrop(c: unknown): ClipCrop {
  const o = (c && typeof c === 'object' ? c : {}) as Partial<ClipCrop>;
  const w = clamp(finite(o.w, 1), MIN_CROP, 1), h = clamp(finite(o.h, 1), MIN_CROP, 1);
  return { x: clamp(finite(o.x, 0), 0, 1 - w), y: clamp(finite(o.y, 0), 0, 1 - h), w, h };
}

export function cleanTransform(v: unknown): ClipTransform {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<ClipTransform>;
  const r = Math.round(finite(o.rotate, 0) / 90) * 90;
  const rotate = (((r % 360) + 360) % 360) as ClipRotate;
  return { crop: cleanCrop(o.crop), rotate, flipX: o.flipX === true, flipY: o.flipY === true };
}

export const isIdentity = (xf: ClipTransform) =>
  xf.rotate === 0 && !xf.flipX && !xf.flipY && xf.crop.x === 0 && xf.crop.y === 0 && xf.crop.w === 1 && xf.crop.h === 1;

/** Raw segments (a saved graph, hand-edited, anything) as a clean list; at most MAX_SEGMENTS. */
export function cleanSegments(raw: unknown): ClipSegment[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ClipSegment[] = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    out.push({ in: Math.max(0, finite(o.in, 0)), out: finite(o.out, 0), ...(o.reverse === true ? { reverse: true } : {}) });
    if (out.length >= MAX_SEGMENTS) break;
  }
  return out.length ? out : [{ in: 0, out: 0 }];
}

/** A node's clip settings from its params: `segments` and `clip`; an older node's Start / End as one segment. */
export function clipSettingsOf(params: Record<string, unknown>): ClipSettings {
  const c = (params.clip && typeof params.clip === 'object' ? params.clip : {}) as Record<string, unknown>;
  const segments = Array.isArray(params.segments)
    ? cleanSegments(params.segments)
    : [{ in: Math.max(0, finite(params.start, 0)), out: finite(params.end, 0) }];
  return {
    segments,
    distribute: c.distribute === 'equal' ? 'equal' : 'proportional',
    ramp: c.ramp === 'easeIn' || c.ramp === 'easeOut' ? c.ramp : 'none',
    xf: cleanTransform(c),
  };
}

/** The params a clip is saved as (the inverse of clipSettingsOf). */
export function clipParams(c: ClipSettings): { segments: ClipSegment[]; clip: Record<string, unknown> } {
  return {
    segments: c.segments.map(s => ({ in: s.in, out: s.out, ...(s.reverse ? { reverse: true } : {}) })),
    clip: { distribute: c.distribute, ramp: c.ramp, crop: { ...c.xf.crop }, rotate: c.xf.rotate, flipX: c.xf.flipX, flipY: c.xf.flipY },
  };
}

/** Migration: a node's old Start / End (End 0: the end of the video) as one segment. */
export function segmentsFromStartEnd(start: unknown, end: unknown): ClipSegment[] {
  return [{ in: Math.max(0, finite(start, 0)), out: finite(end, 0) }];
}

/**
 * Segments placed in a video `duration` seconds long: an `out` at or before `in` runs to the end,
 * everything is clamped into the video, and empty stretches are dropped (none left: the whole video).
 * With the length unknown (0), an out at or before in leaves the segment empty.
 */
export function resolveSegments(segs: readonly ClipSegment[], duration: number): { in: number; out: number; reverse: boolean }[] {
  const d = Math.max(0, finite(duration, 0));
  const out: { in: number; out: number; reverse: boolean }[] = [];
  for (const s of segs) {
    const a = d > 0 ? clamp(s.in, 0, Math.max(0, d - 1e-3)) : Math.max(0, s.in);
    let b = s.out > a ? s.out : d;
    if (d > 0) b = Math.min(b, d);
    if (b - a >= MIN_SEGMENT) out.push({ in: a, out: b, reverse: !!s.reverse });
  }
  return out.length || d <= 0 ? out : [{ in: 0, out: d, reverse: false }];
}

/**
 * Share `total` frames between segments: by length (largest remainder, so the shares add up
 * exactly) or equally (the first ones take the remainder). Every segment gets at least one frame
 * when there are enough to go round.
 */
export function allocateFrames(lengths: readonly number[], total: number, mode: ClipDistribute): number[] {
  const k = lengths.length;
  if (!k) return [];
  const n = Math.max(0, Math.round(total));
  if (n < k) return lengths.map((_, i) => (i < n ? 1 : 0));
  if (mode === 'equal') return lengths.map((_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
  const sum = lengths.reduce((a, b) => a + Math.max(0, b), 0);
  // One frame each first, the rest by length.
  const rest = n - k;
  const exact = lengths.map(l => (sum > 0 ? (Math.max(0, l) / sum) * rest : rest / k));
  const got = exact.map(Math.floor);
  let left = rest - got.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of byRemainder) { if (left <= 0) break; got[i]++; left--; }
  return got.map(g => g + 1);
}

/** Where a sample falls through its segment (0–1, in playing order) for a share `u` of its frames. */
export function rampPosition(u: number, ramp: ClipRamp): number {
  const x = clamp(u, 0, 1);
  if (ramp === 'easeIn') return x * x;
  if (ramp === 'easeOut') return 1 - (1 - x) * (1 - x);
  return x;
}

/**
 * The sample times of a clip: `total` frames shared between the segments, each segment's frames
 * spread through it (in the middle of their slots, ramped), backwards for a reversed one. With one
 * plain segment that is start + (i + ½) × span / total, as the Time Cube always planned.
 */
export function planSampleTimes(segs: readonly { in: number; out: number; reverse: boolean }[], total: number, distribute: ClipDistribute, ramp: ClipRamp): SamplePlan {
  const lengths = segs.map(s => s.out - s.in);
  const counts = allocateFrames(lengths, total, distribute);
  const times: number[] = [], slots: number[] = [], segments: PlannedSegment[] = [];
  segs.forEach((s, k) => {
    const n = counts[k], len = lengths[k];
    segments.push({ in: s.in, out: s.out, reverse: s.reverse, first: times.length, frames: n });
    for (let j = 0; j < n; j++) {
      const p = rampPosition((j + 0.5) / n, ramp);
      slots.push((rampPosition((j + 1) / n, ramp) - rampPosition(j / n, ramp)) * len);
      times.push(s.reverse ? s.out - p * len : s.in + p * len);
    }
  });
  return { times, slots, segments, span: lengths.reduce((a, b) => a + b, 0) };
}

// ── Crop, rotate, flip ───────────────────────────────────────────────────────

/** The size of a w × h frame after the crop and rotation. */
export function clipOutputSize(w: number, h: number, xf: ClipTransform): [number, number] {
  const cw = w * xf.crop.w, ch = h * xf.crop.h;
  return xf.rotate === 90 || xf.rotate === 270 ? [ch, cw] : [cw, ch];
}

/**
 * Forward map as an affine: a point (a, b) of the cropped picture (0–1, top-left origin) to the
 * output (u, v) = (p0 + p1 a + p2 b, q0 + q1 a + q2 b). Rotation is clockwise, then the flips.
 */
function forward(xf: ClipTransform): { p: [number, number, number]; q: [number, number, number] } {
  let p: [number, number, number], q: [number, number, number];
  switch (xf.rotate) {
    case 90: p = [1, 0, -1]; q = [0, 1, 0]; break;   // (a, b) → (1 − b, a)
    case 180: p = [1, -1, 0]; q = [1, 0, -1]; break; // → (1 − a, 1 − b)
    case 270: p = [0, 0, 1]; q = [1, -1, 0]; break;  // → (b, 1 − a)
    default: p = [0, 1, 0]; q = [0, 0, 1];
  }
  if (xf.flipX) p = [1 - p[0], -p[1], -p[2]];
  if (xf.flipY) q = [1 - q[0], -q[1], -q[2]];
  return { p, q };
}

/** Where output point (u, v) (0–1, top-left origin) reads the source frame (0–1). */
export function outputToSource(xf: ClipTransform, u: number, v: number): [number, number] {
  let x = xf.flipX ? 1 - u : u, y = xf.flipY ? 1 - v : v;
  let a: number, b: number;
  switch (xf.rotate) {
    case 90: a = y; b = 1 - x; break;
    case 180: a = 1 - x; b = 1 - y; break;
    case 270: a = 1 - y; b = x; break;
    default: a = x; b = y;
  }
  [x, y] = [xf.crop.x + a * xf.crop.w, xf.crop.y + b * xf.crop.h];
  return [x, y];
}

/** Where source point (x, y) (0–1) lands in the output (0–1): the inverse of outputToSource. */
export function sourceToOutput(xf: ClipTransform, x: number, y: number): [number, number] {
  const a = (x - xf.crop.x) / xf.crop.w, b = (y - xf.crop.y) / xf.crop.h;
  const { p, q } = forward(xf);
  return [p[0] + p[1] * a + p[2] * b, q[0] + q[1] * a + q[2] * b];
}

/**
 * How to draw a frame (sw × sh pixels) cropped, rotated and flipped into the box (x, y, w, h): the
 * source rectangle, a destination size, and the canvas transform to draw it under.
 */
export function clipDrawParams(xf: ClipTransform, sw: number, sh: number, x: number, y: number, w: number, h: number) {
  const rot = xf.rotate === 90 || xf.rotate === 270;
  const dw = rot ? h : w, dh = rot ? w : h;
  const { p, q } = forward(xf);
  return {
    src: [xf.crop.x * sw, xf.crop.y * sh, xf.crop.w * sw, xf.crop.h * sh] as [number, number, number, number],
    dw, dh,
    matrix: [(w * p[1]) / dw, (h * q[1]) / dw, (w * p[2]) / dh, (h * q[2]) / dh, x + w * p[0], y + h * q[0]] as [number, number, number, number, number, number],
  };
}

/** Draw `src` (sw × sh) into the box with the clip's crop, rotation and flips. */
export function drawClipFrame(g: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, xf: ClipTransform, x: number, y: number, w: number, h: number): void {
  if (isIdentity(xf)) { g.drawImage(src, x, y, w, h); return; }
  const d = clipDrawParams(xf, sw, sh, x, y, w, h);
  g.save();
  g.transform(...d.matrix);
  g.drawImage(src, d.src[0], d.src[1], d.src[2], d.src[3], 0, 0, d.dw, d.dh);
  g.restore();
}

/** A short key of a clip transform for caches ('' when it changes nothing). */
export function transformKey(xf: ClipTransform): string {
  if (isIdentity(xf)) return '';
  const c = xf.crop;
  return `|xf${xf.rotate}${xf.flipX ? 'h' : ''}${xf.flipY ? 'v' : ''}:${[c.x, c.y, c.w, c.h].map(v => v.toFixed(4)).join(',')}`;
}
