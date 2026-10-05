/**
 * Time cube planning and maths (docs/time-cube.md). Pure: no DOM, no GL.
 *
 * A video becomes a box of time: N frames, each scaled to one tile, laid out
 * in a grid on one 2D texture (an atlas). The shaders read it as a volume
 * (u, v across the frame, t through time) with two texture reads per sample,
 * blended between the two nearest frames.
 *
 * The functions under "Transfer function" and "Slice plane" are the same
 * maths the GLSL in nodes/definitions/timeCube.ts writes out; the tests check
 * them, so the two are kept in step by hand.
 */

const MB = 1024 * 1024;

/** The longest side of the atlas. WebGL2 promises 2048, every desktop and phone GPU in use has 4096 or more. */
export const ATLAS_MAX_SIDE = 4096;
/** The most memory one volume may take on the GPU (RGBA, 8 bits a channel). */
export const VOLUME_MAX_BYTES = 64 * MB;
/** The most frames a volume holds. */
export const MAX_FRAMES = 256;
export const MIN_FRAMES = 2;
/** Frame widths offered on the card. */
export const FRAME_WIDTHS = [128, 192, 256, 384, 512] as const;
/** We never ask for more frames than this many a second of video (no video we decode is faster). */
const MAX_FPS = 60;

export interface VideoMeta {
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
}

/** What the Time Cube card sets. */
export interface StackSettings {
  /** How many frames (spacing 'count'). */
  frames: number;
  /** Tile width in pixels. */
  width: number;
  /** Seconds into the video where the stack starts. */
  start: number;
  /** Where it ends, in seconds; 0 or less: the end of the video. */
  end: number;
  /** 'count': spread `frames` frames over start…end. 'step': one frame every `step` seconds. */
  spacing: 'count' | 'step';
  step: number;
  /**
   * A 16-bit (half-float) atlas: Precision 16-bit while Frames from combines frames, whose averages
   * and medians hold more than 8 bits. Twice the memory of 8-bit (8 bytes a pixel).
   */
  deep?: boolean;
}

export type StackCap = 'frames' | 'atlas' | 'memory' | 'duration' | null;

export interface StackPlan {
  tileW: number;
  tileH: number;
  /** The video's own width / height (the tiles are rounded to whole blocks of 8 pixels). */
  aspect: number;
  frames: number;
  /** Frames the settings asked for, before any cap. */
  requested: number;
  /** Why fewer frames than asked for, if so. */
  capped: StackCap;
  cols: number;
  rows: number;
  atlasW: number;
  atlasH: number;
  /** GPU memory of the atlas, bytes. */
  bytes: number;
  start: number;
  end: number;
  /** Seconds between frames. */
  every: number;
  /** The video time of each frame (the middle of its slot). */
  times: number[];
}

const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round8 = (v: number) => Math.max(8, Math.round(v / 8) * 8);

/** The settings a node's params hold, cleaned (an old or hand-edited graph can hold anything). */
export function stackSettingsOf(params: Record<string, unknown>): StackSettings {
  return {
    frames: Math.round(clamp(finite(params.frames, 128), MIN_FRAMES, MAX_FRAMES)),
    width: Math.round(clamp(finite(params.frameWidth === undefined ? undefined : Number(params.frameWidth), 256), 32, 1024)),
    start: Math.max(0, finite(params.start, 0)),
    end: finite(params.end, 0),
    spacing: params.spacing === 'step' ? 'step' : 'count',
    step: Math.max(1 / MAX_FPS, finite(params.step, 1 / 30)),
    deep: params.precision === '16' && typeof params.combine === 'string' && params.combine !== 'pick',
  };
}

/**
 * Lay out a frame stack: tile size, frame count after the caps, the atlas grid and each frame's
 * time. Tiles are whole blocks of 8 pixels so a JPEG of the atlas (web exports) never smears one
 * frame into the next. The grid is kept near square, which keeps the atlas small on both sides.
 */
export function planFrameStack(meta: VideoMeta, s: StackSettings, o: { maxSide?: number; maxBytes?: number } = {}): StackPlan {
  const maxSide = o.maxSide ?? ATLAS_MAX_SIDE;
  const maxBytes = o.maxBytes ?? VOLUME_MAX_BYTES;
  const vw = Math.max(1, finite(meta.width, 16)), vh = Math.max(1, finite(meta.height, 9));
  const aspect = vw / vh;
  const tileW = Math.min(round8(s.width), Math.floor(maxSide / 8) * 8);
  const tileH = Math.min(round8(tileW / aspect), Math.floor(maxSide / 8) * 8);
  const duration = Math.max(0, finite(meta.duration, 0));
  const start = clamp(s.start, 0, Math.max(0, duration - 1e-3));
  const end = s.end > start ? Math.min(s.end, duration || s.end) : duration;
  const span = Math.max(0, end - start);
  const requested = s.spacing === 'step' ? Math.max(MIN_FRAMES, Math.floor(span / s.step + 1e-6)) : s.frames;

  let frames = requested, capped: StackCap = null;
  const cap = (limit: number, why: StackCap) => { if (frames > limit) { frames = limit; capped = why; } };
  cap(MAX_FRAMES, 'frames');
  cap(Math.max(MIN_FRAMES, Math.ceil(span * MAX_FPS)), 'duration');
  const maxCols = Math.max(1, Math.floor(maxSide / tileW)), maxRows = Math.max(1, Math.floor(maxSide / tileH));
  cap(maxCols * maxRows, 'atlas');
  const bpp = s.deep ? 8 : 4;
  cap(Math.max(MIN_FRAMES, Math.floor(maxBytes / (tileW * tileH * bpp))), 'memory');
  frames = Math.max(MIN_FRAMES, frames);

  // Near square: as many columns as make the grid's width about its height.
  let cols = clamp(Math.ceil(Math.sqrt((frames * tileH) / tileW)), 1, maxCols);
  let rows = Math.ceil(frames / cols);
  while (rows > maxRows && cols < maxCols) { cols++; rows = Math.ceil(frames / cols); }
  const atlasW = cols * tileW, atlasH = rows * tileH;
  const every = span / frames;
  const times = Array.from({ length: frames }, (_, i) => start + (i + 0.5) * every);
  return { tileW, tileH, aspect, frames, requested, capped, cols, rows, atlasW, atlasH, bytes: atlasW * atlasH * bpp, start, end, every, times };
}

/** Where frame `i` sits on the atlas canvas (pixels, top-left origin). */
export function tileOrigin(plan: Pick<StackPlan, 'cols' | 'tileW' | 'tileH'>, i: number): { x: number; y: number } {
  const row = Math.floor(i / plan.cols), col = i - row * plan.cols;
  return { x: col * plan.tileW, y: row * plan.tileH };
}

/**
 * The atlas coordinate (0–1, v up, as the texture is uploaded flipped) of frame `f` at frame
 * coordinate (u, v): what the GLSL `tcTile` computes.
 */
export function atlasUv(plan: Pick<StackPlan, 'cols' | 'rows'>, f: number, u: number, v: number): [number, number] {
  const row = Math.floor((f + 0.5) / plan.cols), col = f - row * plan.cols;
  return [(col + u) / plan.cols, 1 - (row + 1 - v) / plan.rows];
}

export const formatBytes = (b: number) => (b >= MB ? `${(b / MB).toFixed(b >= 10 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** One line on the card about a cap, or ''. */
export function capText(plan: StackPlan): string {
  if (!plan.capped) return '';
  const why = {
    frames: `at most ${MAX_FRAMES} frames`,
    duration: 'the clip is too short for more',
    atlas: `frames this size fit ${plan.frames} to a ${ATLAS_MAX_SIDE}-pixel texture`,
    memory: `kept under ${formatBytes(VOLUME_MAX_BYTES)}`,
  }[plan.capped];
  return `${plan.frames} of ${plan.requested} frames: ${why}.`;
}

// ── Transfer function ────────────────────────────────────────────────────────

/**
 * The reference thickness the opacity sliders are measured over, as a share of the box's length in
 * time: half the box, which is how deep the frames before (or after) the slice are at the default
 * Offset 0.5. An opacity is how much a slab this thick hides, looking straight through it in time:
 * 0.5 lets half of what is behind it through, 1 is solid. The look does not change with Quality (the
 * step count), Frames, Time stretch or Box size. GLSL: tcDepth in the view.
 */
export const OPACITY_REF = 0.5;

/**
 * Where the opacity sliders stop measuring a see-through slab and start firming the frames up into
 * a solid surface (GLSL tcDepth). Up to here an opacity is exactly what a slab OPACITY_REF thick
 * hides. Above it the depth rises on a log scale (easing in) to the hard surface at 1, so the last
 * stretch of the slider sharpens the block step by step (frames blended over fewer and fewer of
 * their neighbours) instead of snapping from a soft blend to crisp on the final tick.
 */
export const OPACITY_KNEE = 0.85;
/** The depth used for an opacity of 1 (as before the change): opaque within a hair of the surface. */
export const OD_SOLID = 1000;
const OD_KNEE = -Math.log(1 - OPACITY_KNEE) / OPACITY_REF;
/** How the firming eases in above the knee (on the log of the depth): 1.5 starts it gently. */
export const KNEE_EASE = 1.5;

/**
 * Optical depth across the box's full length in time for an opacity (GLSL tcDepth): up to the knee
 * the opacity holds over OPACITY_REF of the box, so a step `len` long hides 1 − (1 − v)^(len / (ref
 * × time length)) of what is behind it; then on to OD_SOLID, a hard, opaque surface (a frame face).
 */
export function opticalDepth(opacity: number): number {
  const o = clamp(opacity, 0, 1);
  if (o <= 0) return 0;
  if (o >= 1) return OD_SOLID;
  if (o <= OPACITY_KNEE) return -Math.log(1 - o) / OPACITY_REF;
  return OD_KNEE * Math.pow(OD_SOLID / OD_KNEE, Math.pow((o - OPACITY_KNEE) / (1 - OPACITY_KNEE), KNEE_EASE));
}

/** The opacity whose depth is `depth` (the inverse of opticalDepth). */
export function opacityForDepth(depth: number): number {
  if (depth <= 0) return 0;
  if (depth >= OD_SOLID) return 1;
  if (depth <= OD_KNEE) return 1 - Math.exp(-depth * OPACITY_REF);
  return OPACITY_KNEE + (1 - OPACITY_KNEE) * Math.pow(Math.log(depth / OD_KNEE) / Math.log(OD_SOLID / OD_KNEE), 1 / KNEE_EASE);
}

/** Alpha of one march step `len` long, in a box whose time axis is `timeLen` long. */
export function stepAlpha(opacity: number, len: number, timeLen: number): number {
  return 1 - Math.exp(-opticalDepth(opacity) * len / Math.max(1e-6, timeLen));
}

/**
 * What a slab of time `thick` (a share of the box's length) hides at an opacity: the composite of
 * marching through it in `steps` steps. At thick = OPACITY_REF it is the opacity itself, whatever
 * the steps: the sliders are even from 0 to 1.
 */
export function slabOpacity(opacity: number, thick: number, steps = 64): number {
  let a = 0;
  const one = stepAlpha(opacity, thick / steps, 1);
  for (let i = 0; i < steps; i++) a += (1 - a) * one;
  return a;
}

// Before view schema 2 an opacity was what the whole box's length hid, and from 0.95
// it climbed steeply to a surface at 1: most of the change was in the top 5 % of the slider.
const OD_95 = -Math.log(0.05);
const OD_MAX = 1000;
/** The optical depth (whole box) an opacity setting had before the change (schema 1). */
export function legacyOpticalDepth(opacity: number): number {
  const o = clamp(opacity, 0, 1);
  if (o <= 0) return 0;
  if (o <= 0.95) return -Math.log(1 - o);
  const k = (o - 0.95) / 0.05;
  return OD_95 + (OD_MAX - OD_95) * k * k;
}

/**
 * An opacity saved before the change, in today's units, so an old graph looks as it did: the same
 * optical depth. 1 stays 1; 0.45 (the old default) becomes about 0.26.
 */
export function migrateOpacity(old: number): number {
  return Math.round(opacityForDepth(legacyOpticalDepth(old)) * 1e4) / 1e4;
}

const luma = (c: readonly number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); };

/** Hue (0–1) and saturation (0–1) of an RGB colour, as GLSL tcHueSat. */
export function hueSat(c: readonly number[]): [number, number] {
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
  if (d < 1e-6) return [0, 0];
  let h: number;
  if (mx === c[0]) h = ((c[1] - c[2]) / d) % 6;
  else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
  else h = (c[0] - c[1]) / d + 4;
  h /= 6; if (h < 0) h += 1;
  return [h, d / Math.max(mx, 1e-6)];
}

export type KeyMode = 'off' | 'color' | 'hue' | 'luma';
export interface KeySettings { mode: KeyMode; color: readonly number[]; tolerance: number; softness: number; lumaLo: number; lumaHi: number }

/** How much a colour matches the key, 0–1 (GLSL tcKey). */
export function keyMatch(c: readonly number[], k: KeySettings): number {
  const soft = Math.max(1e-3, k.softness);
  switch (k.mode) {
    case 'color': {
      const d = Math.hypot(c[0] - k.color[0], c[1] - k.color[1], c[2] - k.color[2]) / Math.sqrt(3);
      return 1 - smoothstep(k.tolerance, k.tolerance + soft, d);
    }
    case 'hue': {
      const [h, s] = hueSat(c), [hk] = hueSat(k.color);
      const dh = Math.abs(((h - hk + 1.5) % 1) - 0.5) * 2;
      return (1 - smoothstep(k.tolerance, k.tolerance + soft, dh)) * smoothstep(0.2, 0.4, s);
    }
    case 'luma': {
      const l = luma(c);
      return smoothstep(k.lumaLo - soft, k.lumaLo, l) * (1 - smoothstep(k.lumaHi, k.lumaHi + soft, l));
    }
    default: return 0;
  }
}

export interface VoxelLook {
  before: number;
  after: number;
  darkClear: number;
  key: KeySettings;
  keyOpacity: number;
  othersOpacity: number;
}

/**
 * A voxel's opacity setting (before turning it into a step alpha): Before opacity in front of the
 * slice (f < 0), After opacity behind it; dark voxels thinned by Dark is clear; with a key, the
 * matching colours take Key opacity and the rest are multiplied by Others. GLSL: the view's loop,
 * which keys the two frames either side of a sample separately and blends the matches (tcFrames).
 */
export function voxelOpacity(c: readonly number[], f: number, L: VoxelLook): number {
  let op = f < 0 ? L.before : L.after;
  // Dark is clear above 0; below 0, light is clear (footage on white).
  const dc = clamp(L.darkClear, -1, 1), a = Math.abs(dc);
  op *= 1 - a + a * (dc >= 0 ? smoothstep(0.02, 0.4, luma(c)) : 1 - smoothstep(0.6, 0.98, luma(c)));
  if (L.key.mode !== 'off') {
    const m = keyMatch(c, L.key);
    op = op * L.othersOpacity * (1 - m) + L.keyOpacity * m;
  }
  return clamp(op, 0, 1);
}

// ── Slice plane ──────────────────────────────────────────────────────────────

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * The time the slice plane passes through at frame point (u, v): Offset, tilted across the frame
 * by Tilt X / Tilt Y (degrees). A tilt makes time run across the picture: slit-scan.
 */
export function sliceTime(u: number, v: number, offset: number, tiltX: number, tiltY: number): number {
  return offset + Math.tan(rad(clamp(tiltX, -85, 85))) * (u - 0.5) + Math.tan(rad(clamp(tiltY, -85, 85))) * (v - 0.5);
}

/** Signed side of the slice plane: < 0 is before it (earlier), > 0 behind it (later). */
export function sliceSide(u: number, v: number, t: number, offset: number, tiltX: number, tiltY: number): number {
  return t - sliceTime(u, v, offset, tiltX, tiltY);
}

export type StackAxis = 'z' | 'x' | 'y';

/** The box's half size for a stack axis: the frame `aspect` wide and 1 high, time `depth` long, all times `size`. */
export function boxHalf(axis: StackAxis, aspect: number, depth: number, size: number): [number, number, number] {
  const h = 0.5 * size;
  if (axis === 'x') return [depth * h, h, aspect * h];
  if (axis === 'y') return [aspect * h, depth * h, h];
  return [aspect * h, h, depth * h];
}

/**
 * Volume coordinate (u, v, t) of a box point q in 0–1³ for a stack axis (the view's GLSL `tcUvt`).
 * Time starts at the +z face (+x, +y for the other axes). The app's cameras put screen right at
 * −x when looking down −z, so u runs toward −x and a frame reads the right way round from there.
 */
export function boxToVolume(axis: StackAxis, q: readonly number[]): [number, number, number] {
  if (axis === 'x') return [q[2], q[1], 1 - q[0]];
  if (axis === 'y') return [1 - q[0], 1 - q[2], 1 - q[1]];
  return [1 - q[0], q[1], 1 - q[2]];
}

/** Ray against the box (slab test): entry and exit distances, or null on a miss. */
export function rayBox(ro: readonly number[], rd: readonly number[], half: readonly number[]): [number, number] | null {
  let tn = -Infinity, tf = Infinity;
  for (let i = 0; i < 3; i++) {
    const inv = 1 / (Math.abs(rd[i]) < 1e-8 ? (rd[i] < 0 ? -1e-8 : 1e-8) : rd[i]);
    const a = (-half[i] - ro[i]) * inv, b = (half[i] - ro[i]) * inv;
    tn = Math.max(tn, Math.min(a, b)); tf = Math.min(tf, Math.max(a, b));
  }
  tn = Math.max(tn, 0);
  return tf > tn ? [tn, tf] : null;
}
