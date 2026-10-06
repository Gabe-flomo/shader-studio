/**
 * Clip settings for a video source (components/media/ClipEditor.tsx): which
 * stretches of the video are kept ("segments", played one after another),
 * how a frame budget is shared between them, a speed ramp, and a crop /
 * rotate / flip applied to every frame. Pure maths plus one canvas helper.
 *
 * The editor is the app's one video viewer and editor (docs/clip-editor.md).
 * The Time Cube samples frames from a clip (planSampleTimes); the playback
 * hosts (Video Input, Video layers, Baked nodes, the Background) play it as a
 * playlist. The playlist and crop maths live in play/kit/clipPlay.js, shared
 * with web exports, and are re-exported here; CLIP_CAPS says which controls
 * each host shows.
 */
import {
  CP_MIN_CROP, cpCleanCrop, cpCleanTransform, cpDrawFrame, cpDrawParams, cpFrames, cpIsIdentity, cpIsPlain,
  cpOutputSize, cpOutputToSource, cpParse, cpResolve, cpSourceToOutput, cpTextureAffine, type CpSaved,
} from '../../play/kit/clipPlay.js';

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
  /** Playback hosts: the playback rate (1 = as recorded). */
  speed?: number;
  /** Playback hosts: play the segments round and round. */
  loop?: boolean;
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
export const MIN_CROP = CP_MIN_CROP;

const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const defaultClip = (): ClipSettings => ({ segments: [{ in: 0, out: 0 }], distribute: 'proportional', ramp: 'none', xf: { ...IDENTITY_XF, crop: { ...FULL_CROP } } });

/** A crop, cleaned: inside the frame, no side under MIN_CROP. */
export const cleanCrop = (c: unknown): ClipCrop => cpCleanCrop(c);
export const cleanTransform = (v: unknown): ClipTransform => cpCleanTransform(v);
export const isIdentity = (xf: ClipTransform) => cpIsIdentity(xf);

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
  return cpResolve(segs, duration);
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

// The maths is play/kit/clipPlay.js's, so web exports draw exactly the same.

/** The size of a w × h frame after the crop and rotation. */
export const clipOutputSize = (w: number, h: number, xf: ClipTransform): [number, number] => cpOutputSize(w, h, xf);
/** Where output point (u, v) (0–1, top-left origin) reads the source frame (0–1). */
export const outputToSource = (xf: ClipTransform, u: number, v: number): [number, number] => cpOutputToSource(xf, u, v);
/** Where source point (x, y) (0–1) lands in the output (0–1): the inverse of outputToSource. */
export const sourceToOutput = (xf: ClipTransform, x: number, y: number): [number, number] => cpSourceToOutput(xf, x, y);
/**
 * How to draw a frame (sw × sh pixels) cropped, rotated and flipped into the box (x, y, w, h): the
 * source rectangle, a destination size, and the canvas transform to draw it under.
 */
export const clipDrawParams = (xf: ClipTransform, sw: number, sh: number, x: number, y: number, w: number, h: number) => cpDrawParams(xf, sw, sh, x, y, w, h);
/** Draw `src` (sw × sh) into the box with the clip's crop, rotation and flips. */
export function drawClipFrame(g: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, xf: ClipTransform, x: number, y: number, w: number, h: number): void {
  cpDrawFrame(g, src, sw, sh, xf, x, y, w, h);
}

/** A short key of a clip transform for caches ('' when it changes nothing). */
export function transformKey(xf: ClipTransform): string {
  if (isIdentity(xf)) return '';
  const c = xf.crop;
  return `|xf${xf.rotate}${xf.flipX ? 'h' : ''}${xf.flipY ? 'v' : ''}:${[c.x, c.y, c.w, c.h].map(v => v.toFixed(4)).join(',')}`;
}

// ── Hosts, and what the editor shows each ────────────────────────────────────

/** Who opened the editor: each host gets the controls that mean something to it. */
export type ClipHost = 'timeCube' | 'videoInput' | 'videoLayer' | 'baked' | 'background' | 'viewer';

export interface ClipCaps {
  /** In / Out handles on the strip. */
  trim: boolean;
  /** Several segments, reordered. */
  segments: boolean;
  /** A segment played backwards. */
  reverse: boolean;
  /** Share a frame budget by length or equally (frame sampling only). */
  distribute: boolean;
  ramp: boolean;
  /** Ticks at the sampled frames, and the host's frame budget (the Time Cube). */
  frameSamples: boolean;
  crop: boolean;
  rotate: boolean;
  flip: boolean;
  /** Playback speed: the host plays the clip as a playlist. */
  speed: boolean;
  loop: boolean;
  /** False: a viewer (nothing to apply; the strip only scrubs). */
  edit: boolean;
}

const NO_CAPS: ClipCaps = { trim: false, segments: false, reverse: false, distribute: false, ramp: false, frameSamples: false, crop: false, rotate: false, flip: false, speed: false, loop: false, edit: false };
const PLAYBACK_CAPS: ClipCaps = { ...NO_CAPS, trim: true, segments: true, reverse: true, crop: true, rotate: true, flip: true, speed: true, loop: true, edit: true };

/** Which controls each host shows (docs/clip-editor.md has the table). */
export const CLIP_CAPS: Readonly<Record<ClipHost, ClipCaps>> = {
  timeCube: { ...NO_CAPS, trim: true, segments: true, reverse: true, distribute: true, ramp: true, frameSamples: true, crop: true, rotate: true, flip: true, edit: true },
  videoInput: PLAYBACK_CAPS,
  videoLayer: PLAYBACK_CAPS,
  // A bake is one take of the clock: trim it, loop it, change its speed, crop it.
  baked: { ...NO_CAPS, trim: true, crop: true, speed: true, loop: true, edit: true },
  // A background's Placement already crops and turns it: timing only.
  background: { ...NO_CAPS, trim: true, segments: true, reverse: true, speed: true, loop: true, edit: true },
  viewer: NO_CAPS,
};

/** Does the host play the clip as a playlist (rather than sample frames from it, or only show it)? */
export const isPlaybackHost = (h: ClipHost) => h !== 'timeCube' && h !== 'viewer';

/** Hosts that keep speed and loop in their own fields (a Video Input's, a layer's), not in the clip. */
export const HOST_OWN_SPEED: Readonly<Record<ClipHost, boolean>> = { timeCube: false, videoInput: true, videoLayer: true, baked: false, background: true, viewer: false };

export type SavedClip = CpSaved;

/** A saved clip from anything (a node's or a layer's `clip`), or null when it has none. */
export const parseSavedClip = (raw: unknown): SavedClip | null => cpParse(raw);
/** Does a saved clip change nothing? Then the host plays exactly as without one. */
export const isPlainClip = (c: SavedClip | null | undefined) => cpIsPlain(c);

/**
 * The editor's value for a playback host: the saved clip (or the whole video) with explicit
 * outs, and the speed and loop it plays at (the host's own when the clip has none).
 */
export function settingsFromSaved(saved: SavedClip | null, duration: number, speed: number, loop: boolean): ClipSettings {
  const d = Math.max(0.05, duration);
  const segs = (saved?.segments ?? [{ in: 0, out: 0 }]).map(s => {
    const a = clamp(s.in, 0, Math.max(0, d - 0.05));
    const b = s.out > a ? Math.min(s.out, d) : d;
    return { in: a, out: Math.max(b, Math.min(d, a + 0.05)), ...(s.reverse ? { reverse: true } : {}) };
  });
  return {
    segments: segs.length ? segs : [{ in: 0, out: d }],
    distribute: 'proportional',
    ramp: 'none',
    xf: saved ? cleanTransform(saved) : { ...IDENTITY_XF, crop: { ...FULL_CROP } },
    speed: saved?.speed ?? (speed > 0 ? speed : 1),
    loop: saved?.loop ?? loop,
  };
}

/**
 * What a playback host saves from the editor's value: the segments (an out at the end of the
 * video saved as 0, "to the end"), the crop / rotate / flip the host shows, and speed and loop
 * when the host keeps them in the clip and they differ from `defaults`. Null when it changes
 * nothing: the host then plays exactly as before it had a clip.
 */
export function savedFromSettings(c: ClipSettings, duration: number, host: ClipHost, defaults: { speed: number; loop: boolean } = { speed: 1, loop: true }): SavedClip | null {
  const caps = CLIP_CAPS[host];
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const segs = (caps.segments ? c.segments : c.segments.slice(0, 1)).map(s => ({
    in: s.in <= 1e-3 ? 0 : r4(s.in),
    out: duration > 0 && s.out >= duration - 1e-3 ? 0 : r4(s.out),
    ...(s.reverse && caps.reverse ? { reverse: true } : {}),
  }));
  const xf = cleanTransform({
    crop: caps.crop ? c.xf.crop : FULL_CROP,
    rotate: caps.rotate ? c.xf.rotate : 0,
    flipX: caps.flip && c.xf.flipX, flipY: caps.flip && c.xf.flipY,
  });
  const out: SavedClip = { segments: segs, crop: { ...xf.crop }, rotate: xf.rotate, flipX: xf.flipX, flipY: xf.flipY };
  if (!HOST_OWN_SPEED[host]) {
    if (caps.speed && c.speed !== undefined && Math.abs(c.speed - defaults.speed) > 1e-9) out.speed = c.speed;
    if (caps.loop && c.loop !== undefined && c.loop !== defaults.loop) out.loop = c.loop;
  }
  return isPlainClip(out) ? null : out;
}

/** The frames a playback host shows once through at `fps` (source times): what Result steps through. */
export function playbackFrames(c: ClipSettings, duration: number, fps: number): number[] {
  return cpFrames(cpResolve(c.segments, duration), c.speed ?? 1, c.loop !== false, fps);
}

/** The Time Cube's frames in cube order (tile i shows time-ordered frame order[i]): what Result steps through. */
export function cubeSequence(times: readonly number[], order: readonly number[] | null | undefined): number[] {
  return order && order.length === times.length ? order.map(i => times[i]) : [...times];
}

/**
 * GLSL that reads a video texture through a clip's crop / rotate / flip: `st` (0–1 over the
 * frame, as the shader samples it) becomes `<id>_cst`. No code when the clip changes nothing,
 * so a graph without one compiles exactly as before.
 */
export function clipGlsl(id: string, st: string, raw: unknown): { code: string; st: string } {
  const c = parseSavedClip(raw);
  const xf = c ? cleanTransform(c) : null;
  if (!xf || isIdentity(xf)) return { code: '', st };
  const a = cpTextureAffine(xf).map(v => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(6));
  return { code: `    vec2 ${id}_cst = vec2(${a[0]} + ${a[1]} * ${st}.x + ${a[2]} * ${st}.y, ${a[3]} + ${a[4]} * ${st}.x + ${a[5]} * ${st}.y);\n`, st: `${id}_cst` };
}
