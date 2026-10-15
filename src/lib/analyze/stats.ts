/**
 * Analyze, the CPU half (docs/analyze-node.md): one small frame of RGBA bytes (rows bottom-up, as a texture's
 * coordinates run) measured into a handful of numbers.
 *
 * - average colour and brightness (Rec. 709 luma, 0–1);
 * - coverage: the share of pixels brighter than Threshold, and their centroid (0–1; the frame's centre when none);
 * - the brightest pixel's position and its brightness;
 * - contrast: the standard deviation of brightness;
 * - motion: the mean change in brightness from the last frame (0 on the first).
 *
 * `packAnalysis` lays them out for the shader: ANALYZE_TEXELS RGBA floats.
 */

export const ANALYZE_TEXELS = 4;

export interface Analysis {
  r: number; g: number; b: number;
  brightness: number;
  coverage: number;
  cx: number; cy: number;
  peak: number;
  px: number; py: number;
  contrast: number;
  motion: number;
}

export const emptyAnalysis = (): Analysis => ({ r: 0, g: 0, b: 0, brightness: 0, coverage: 0, cx: 0.5, cy: 0.5, peak: 0, px: 0.5, py: 0.5, contrast: 0, motion: 0 });

/** Measure one frame. `prevLuma` (the last frame's brightness per pixel, same size) gives Motion; the new one is returned. */
export function analyzeFrame(rgba: Uint8Array, w: number, h: number, threshold: number, prevLuma: Float32Array | null): { a: Analysis; luma: Float32Array } {
  const n = w * h;
  const luma = new Float32Array(n);
  let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, cover = 0, cxs = 0, cys = 0, peak = -1, pi = 0, motion = 0;
  const t = Math.max(0, Math.min(1, threshold));
  const still = prevLuma && prevLuma.length === n ? prevLuma : null;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = rgba[o] / 255, g = rgba[o + 1] / 255, b = rgba[o + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[i] = l;
    sr += r; sg += g; sb += b; sl += l; sl2 += l * l;
    if (l > peak) { peak = l; pi = i; }
    if (l > t) { cover++; const x = i % w; cxs += x; cys += (i - x) / w; }
    if (still) motion += Math.abs(l - still[i]);
  }
  const mean = sl / n;
  const a: Analysis = {
    r: sr / n, g: sg / n, b: sb / n,
    brightness: mean,
    coverage: cover / n,
    cx: cover ? (cxs / cover + 0.5) / w : 0.5,
    cy: cover ? (cys / cover + 0.5) / h : 0.5,
    peak: Math.max(0, peak),
    px: ((pi % w) + 0.5) / w,
    py: (Math.floor(pi / w) + 0.5) / h,
    contrast: Math.sqrt(Math.max(0, sl2 / n - mean * mean)),
    motion: still ? motion / n : 0,
  };
  return { a, luma };
}

/** Blend this frame's numbers with the last (0: none, 0.95: very smooth). Positions blend too. */
export function smoothAnalysis(prev: Analysis | null, next: Analysis, k: number): Analysis {
  const m = Math.max(0, Math.min(0.95, k));
  if (!prev || m === 0) return next;
  const out = { ...next };
  for (const key of Object.keys(next) as (keyof Analysis)[]) out[key] = prev[key] * m + next[key] * (1 - m);
  return out;
}

/**
 * The shader's data: ANALYZE_TEXELS RGBA floats. 0: average r, g, b, brightness; 1: centroid x, y, coverage,
 * peak brightness; 2: brightest x, y, contrast, motion; 3: unused.
 */
export function packAnalysis(a: Analysis, out: Float32Array<ArrayBuffer> = new Float32Array(ANALYZE_TEXELS * 4)): Float32Array<ArrayBuffer> {
  out.set([a.r, a.g, a.b, a.brightness, a.cx, a.cy, a.coverage, a.peak, a.px, a.py, a.contrast, a.motion, 0, 0, 0, 0]);
  return out;
}

/** The size to read a source at: `side` on its long side, its shape kept (at least 4 px). */
export function analyzeGrabSize(w: number, h: number, side: number): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: side, h: Math.max(4, Math.round(side * 9 / 16)) };
  const s = side / Math.max(w, h);
  return { w: Math.max(4, Math.round(w * s)), h: Math.max(4, Math.round(h * s)) };
}
