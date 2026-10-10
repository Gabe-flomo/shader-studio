/**
 * plan.ts — the Depth node's bookkeeping, apart from the browser (docs/depth-node.md): when a node runs its
 * model, the size frames are grabbed at, smoothing over time, the texture's rows, a bake's frames and file,
 * and how a baked depth video keeps to its source video. lib/depth/engine.ts and bake.ts use these; the tests
 * check them.
 */
import type { DepthBakeInfo, DepthUpdate } from '../../nodes/definitions/depth';

/** A bake keeps at most this much video (frames are a model run each). */
export const DEPTH_BAKE_MAX_SECONDS = 60;
export const DEPTH_BAKE_FPS = 30;

/** The size a frame is grabbed at for the model: the long side `side`, the source's shape, at least 16 a side. */
export function grabSize(srcW: number, srcH: number, side: number): { w: number; h: number } {
  const w0 = Math.max(1, srcW || 1), h0 = Math.max(1, srcH || 1);
  const k = side / Math.max(w0, h0);
  return { w: Math.max(16, Math.round(w0 * k)), h: Math.max(16, Math.round(h0 * k)) };
}

export interface RunCheck {
  update: DepthUpdate;
  /** Every Nth frame's N. */
  every: number;
  /** Frames this node has seen since it last ran (counted by the engine). */
  framesSince: number;
  /** A run is in flight. */
  busy: boolean;
  /** The model is downloaded (or local). Not: nothing runs. */
  usable: boolean;
  /** The source has a frame to grab. */
  hasSource: boolean;
  /** The source is a still (an image): its key, else null. */
  stillKey: string | null;
  /** The key of what it last ran on (still key + model + side), or null. */
  lastKey: string | null;
  /** This run's key for a still. */
  runKey: string | null;
  /** The clock runs. Paused, a moving source (video, a Pass, the picture) runs once per change of program. */
  playing: boolean;
  /** It has run since the program last changed. */
  ranSinceProgram: boolean;
  /** The source is a video: its depth is baked first (Bake depth), never worked out live, so it plays smoothly. */
  video?: boolean;
}

/**
 * Whether a Depth node's source must be baked first: a video file (a Video Input or Baked node's sampler). A webcam
 * (a Video Input with `params.source: 'webcam'`, docs/texture-node.md) is a live feed that can't be baked: it runs
 * live, at the node's Update (the Texture node's Generate depth sets every 4th frame).
 */
export function sourceNeedsBake(src: string, videoUniforms: Record<string, string>, webcamIds: ReadonlySet<string>): boolean {
  if (src === 'picture' || !(src in videoUniforms)) return false;
  return !webcamIds.has(videoUniforms[src]);
}

/** Whether a Depth node runs its model on this frame. */
export function shouldRun(c: RunCheck): boolean {
  if (!c.usable || !c.hasSource || c.busy || c.update === 'baked' || c.video) return false;
  if (c.stillKey !== null) return c.runKey !== c.lastKey;
  if (!c.playing && c.ranSinceProgram) return false;
  if (c.update === 'every') return c.framesSince >= Math.max(1, Math.round(c.every) || 1);
  return true;
}

/** Smoothing over time: prev ← prev × s + next × (1 − s), in place (when the sizes match). Returns prev, or next when they don't. */
export function blendDepth(prev: Float32Array | null, next: Float32Array, s: number): Float32Array {
  const k = Math.max(0, Math.min(0.99, s || 0));
  if (!prev || prev.length !== next.length || k <= 0) return next;
  for (let i = 0; i < next.length; i++) prev[i] = prev[i] * k + next[i] * (1 - k);
  return prev;
}

/** Top-down rows to bottom-up (as a texture's v runs), one value a pixel, into `out` (RGBA, alpha 1) via `enc`. */
export function depthRowsUp<T extends { [i: number]: number; length: number }>(depth: ArrayLike<number>, w: number, h: number, out: T, enc: (v: number) => number, one: number): T {
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) {
      const v = enc(depth[src + x]), d = (y * w + x) * 4;
      out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = one;
    }
  }
  return out;
}

/** A frame of depth as grey RGBA bytes (top-down), cropped to an even size for the video encoder. */
export function depthToGreyRgba(depth: ArrayLike<number>, w: number, h: number, outW = w & ~1, outH = h & ~1): Uint8Array {
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const v = Math.round(Math.max(0, Math.min(1, depth[y * w + x])) * 255), d = (y * outW + x) * 4;
      out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = 255;
    }
  }
  return out;
}

export interface DepthBakePlan {
  fps: number;
  frames: number;
  /** Seconds of video kept (the source's, up to the limit). */
  duration: number;
  /** Was the source longer than the limit? */
  clipped: boolean;
  /** The source time of each frame (the middle of each frame). */
  times: number[];
}

/** The frames a bake runs the model on: every frame at `fps` through the source, up to the limit. */
export function planDepthBake(sourceDuration: number, fps = DEPTH_BAKE_FPS, maxSeconds = DEPTH_BAKE_MAX_SECONDS): DepthBakePlan {
  const f = Math.max(1, Math.min(60, Math.round(fps) || DEPTH_BAKE_FPS));
  const full = Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : 0;
  const duration = Math.min(full, maxSeconds);
  const frames = Math.max(1, Math.floor(duration * f + 1e-6));
  return { fps: f, frames, duration: frames / f, clipped: full > maxSeconds, times: Array.from({ length: frames }, (_, i) => Math.min((i + 0.5) / f, Math.max(0, full - 1e-3))) };
}

/** "Depth of Beach clip 2026-10-09 15.57.01.webm". */
export function depthBakeFileName(source: string, ext: string, now = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}.${p2(now.getMinutes())}.${p2(now.getSeconds())}`;
  const name = (source || 'picture').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'picture';
  return `Depth of ${name} ${stamp}.${ext}`;
}

/** The params a finished bake writes on its node: the info, and Update switched to Baked. */
export function bakedParams(info: DepthBakeInfo): { depthBake: DepthBakeInfo; update: 'baked' } {
  return { depthBake: info, update: 'baked' };
}

/**
 * Keeping a baked depth video on its source video: what to do this frame. The depth plays when the source
 * plays, at its rate; it jumps when it drifts past a quarter second (or, paused, past half a frame).
 */
export function followSource(src: { time: number; paused: boolean; rate: number }, depth: { time: number; paused: boolean }, fps: number, duration: number):
  { seek: number | null; play: boolean; rate: number } {
  const t = duration > 0 ? Math.min(Math.max(0, src.time), Math.max(0, duration - 0.5 / fps)) : Math.max(0, src.time);
  const drift = Math.abs(depth.time - t);
  const limit = src.paused ? 0.5 / fps : 0.25;
  return { seek: drift > limit ? t : null, play: !src.paused, rate: src.rate > 0 ? src.rate : 1 };
}
