/**
 * Bake planning (docs/bake.md): the pure arithmetic behind "render and
 * replace": which clock times get rendered, how a seamless loop crossfades its
 * tail into its head, how big the file and the render are likely to be, and
 * which frame a Baked node shows at a given clock time.
 *
 * Nothing here touches the GPU, the store or the DOM, so it is all unit tested
 * (src/lib/bake/__tests__/plan.test.ts).
 */

/** What happens after the last baked frame: hold it, or loop (the tail crossfaded into the head). */
export type BakeLoop = 'none' | 'seamless';

/** Full: the preview's size. Half: half of it. A number: that many pixels tall (the preview's shape kept). */
export type BakeResolution = 'full' | 'half' | number;

export interface BakeSettings {
  /** Clock time of the first baked frame, in seconds. */
  start: number;
  /** Length of the baked video, in seconds. */
  duration: number;
  fps: number;
  resolution: BakeResolution;
  loop: BakeLoop;
  /** Keep the alpha channel (stored beneath the colour in the same video, see BAKE_ALPHA_PACKED). */
  alpha: boolean;
}

export const DEFAULT_BAKE: BakeSettings = { start: 0, duration: 10, fps: 30, resolution: 'full', loop: 'seamless', alpha: false };

/** Limits the dialog clamps to. */
export const BAKE_LIMITS = { maxDuration: 600, minDuration: 0.1, maxFps: 120, minFps: 1, maxSide: 4096, minSide: 16 } as const;

/** The longest crossfade a seamless loop gets, in seconds (a quarter of the bake when shorter). */
export const BAKE_FADE_SECONDS = 1;
/** The head frames a seamless loop holds in memory while it renders: at most this many bytes. */
export const BAKE_FADE_BUDGET = 256 * 1024 * 1024;

/**
 * An alpha bake stores two pictures in one frame: the colour on top, the
 * alpha (as grey) beneath it. Every video format and every browser plays
 * that, decodes it in hardware, and the Baked node's shader puts them back
 * together, so the web page export needs nothing special either.
 */
export const BAKE_ALPHA_PACKED = true;

export interface BakePlan {
  /** Picture size (one picture: an alpha bake's frame is twice as tall). */
  width: number;
  height: number;
  /** The encoded frame's size (height doubled for alpha). */
  frameWidth: number;
  frameHeight: number;
  fps: number;
  start: number;
  duration: number;
  loop: BakeLoop;
  alpha: boolean;
  /** Frames in the video. */
  frames: number;
  /** Seamless loops: how many frames at the end are crossfaded into the head (0 otherwise). */
  fadeFrames: number;
  /** Frames rendered in all: the pre-roll the fade blends towards, then every video frame. */
  renders: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The picture size for a resolution choice, keeping the preview's shape; even sides (4:2:0 video needs them). */
export function bakeSize(resolution: BakeResolution, previewW: number, previewH: number): { width: number; height: number } {
  const pw = Math.max(1, previewW), ph = Math.max(1, previewH);
  let w: number, h: number;
  if (resolution === 'half') { w = pw / 2; h = ph / 2; }
  else if (typeof resolution === 'number') { h = resolution; w = resolution * pw / ph; }
  else { w = pw; h = ph; }
  // Shrink to fit the largest side the GPU and video encoders take, keeping the shape.
  const s = Math.min(1, BAKE_LIMITS.maxSide / Math.max(w, h));
  return { width: even(clamp(w * s, BAKE_LIMITS.minSide, BAKE_LIMITS.maxSide)), height: even(clamp(h * s, BAKE_LIMITS.minSide, BAKE_LIMITS.maxSide)) };
}

/** How many tail frames a seamless loop crossfades: up to a second (a quarter of the bake), within the memory budget. */
export function fadeFramesFor(loop: BakeLoop, fps: number, frames: number, frameBytes: number): number {
  if (loop !== 'seamless' || frames < 4) return 0;
  const want = Math.round(Math.min(BAKE_FADE_SECONDS * fps, frames / 4));
  const fit = Math.floor(BAKE_FADE_BUDGET / Math.max(1, frameBytes));
  return Math.max(0, Math.min(want, fit));
}

export function planBake(s: BakeSettings, previewW: number, previewH: number): BakePlan {
  const fps = Math.round(clamp(s.fps || 30, BAKE_LIMITS.minFps, BAKE_LIMITS.maxFps));
  const duration = clamp(s.duration || 0, BAKE_LIMITS.minDuration, BAKE_LIMITS.maxDuration);
  const { width, height } = bakeSize(s.resolution, previewW, previewH);
  const frames = Math.max(1, Math.round(duration * fps));
  const frameWidth = width, frameHeight = s.alpha && BAKE_ALPHA_PACKED ? height * 2 : height;
  const fadeFrames = fadeFramesFor(s.loop, fps, frames, frameWidth * frameHeight * 4);
  return {
    width, height, frameWidth, frameHeight, fps, start: Math.max(0, s.start || 0), duration: frames / fps,
    loop: s.loop, alpha: !!s.alpha, frames, fadeFrames, renders: frames + fadeFrames,
  };
}

/**
 * One step of the render, in order. A seamless loop first renders the
 * `fadeFrames` just before the start (the pre-roll, held in memory), then every
 * video frame; the last `fadeFrames` video frames blend towards the pre-roll,
 * so the video's last frame runs straight into its first:
 *
 *   out[i] = render(start + i/fps)                                  i < N − F
 *   out[i] = mix(render(start + i/fps), pre[k], (k + 1) / F)        k = i − (N − F)
 *
 * so the last frame is pre[F − 1], the frame right before render(start) = out[0].
 */
export interface BakeStep {
  /** Clock time to render. */
  time: number;
  /** A pre-roll frame: keep it as pre[preIndex], don't encode it. */
  preIndex: number | null;
  /** The video frame this render becomes (null for pre-roll). */
  frame: number | null;
  /** Blend this render with pre[blend.index] by blend.weight (0 = all render, 1 = all pre-roll). */
  blend: { index: number; weight: number } | null;
}

export function bakeSteps(p: BakePlan): BakeStep[] {
  const out: BakeStep[] = [];
  const F = p.fadeFrames, N = p.frames;
  for (let k = 0; k < F; k++) out.push({ time: p.start + (k - F) / p.fps, preIndex: k, frame: null, blend: null });
  for (let i = 0; i < N; i++) {
    const k = i - (N - F);
    out.push({ time: p.start + i / p.fps, preIndex: null, frame: i, blend: F > 0 && k >= 0 ? { index: k, weight: fadeWeight(k, F) } : null });
  }
  return out;
}

/** The crossfade's weight towards the pre-roll for the k-th of F tail frames: rises from 1/F to 1 (the last frame is all pre-roll). */
export const fadeWeight = (k: number, F: number) => (k + 1) / F;

/** Blend `pre` into `into` in place (RGBA bytes): into = into·(1−w) + pre·w, rounded. */
export function blendInto(into: Uint8Array, pre: Uint8Array, w: number): void {
  const a = 1 - w;
  for (let i = 0; i < into.length; i++) into[i] = Math.round(into[i] * a + pre[i] * w);
}

/**
 * An alpha bake's frame: the picture's colour on top (alpha forced opaque, as
 * every 4:2:0 video is) and its alpha as grey beneath. `rgba` is one picture,
 * top-down; `out` is width × height·2 × 4 bytes.
 */
export function packAlpha(rgba: Uint8Array, width: number, height: number, out: Uint8Array): void {
  const n = width * height * 4;
  out.set(rgba.subarray(0, n), 0);
  for (let i = 0; i < n; i += 4) {
    out[i + 3] = 255;
    const a = rgba[i + 3];
    out[n + i] = a; out[n + i + 1] = a; out[n + i + 2] = a; out[n + i + 3] = 255;
  }
}

export interface BakeClock { start: number; duration: number; fps: number; loop: BakeLoop }

/**
 * The frame a Baked node shows at clock time `t`: frame = (t − start) × fps,
 * wrapped for a loop, held at the first frame before the start and at the last
 * after the end otherwise. A tiny epsilon keeps t = i/fps on frame i despite
 * floating point.
 */
export function bakeFrameAt(t: number, c: BakeClock): number {
  const n = Math.max(1, Math.round(c.duration * c.fps));
  const f = Math.floor((t - c.start) * c.fps + 1e-6);
  if (c.loop === 'seamless') return ((f % n) + n) % n;
  return Math.min(n - 1, Math.max(0, f));
}

/** Where to seek the video for frame `f`: the middle of the frame, so a decoder rounding either way lands on it. */
export const bakeVideoTime = (f: number, fps: number) => (f + 0.5) / fps;

export interface BakeEstimate {
  /** Likely file size in bytes. */
  bytes: number;
  /** Rough render time in seconds (unknown graph cost: a guide, not a promise). */
  seconds: number;
}

/**
 * A rough size and time: H.264/VP9 at the bake's quality runs about 0.12 bits
 * per pixel per frame for busy generative pictures (more for noise, less for
 * flat colour). `msPerFrame` is the graph's measured frame time when known.
 */
export function estimateBake(p: BakePlan, msPerFrame?: number): BakeEstimate {
  const bpp = 0.12;
  const bytes = Math.round(p.frameWidth * p.frameHeight * p.frames * bpp / 8);
  // Rendering scales with pixels relative to the preview the measurement came from; reading back and encoding add ~4 ms per megapixel.
  const perFrame = (msPerFrame ?? 16) + 4 * (p.frameWidth * p.frameHeight) / 1e6;
  return { bytes, seconds: Math.round(p.renders * perFrame / 100) / 10 };
}

/** The bake's file name: the source's name and a timestamp. */
export function bakeFileName(source: string, ext: string, now = new Date()): string {
  const clean = source.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 48) || 'Bake';
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `Baked ${clean} ${stamp}.${ext}`;
}
