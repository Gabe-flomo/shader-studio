/**
 * score.ts — how good does a surprise look? Cheap image metrics over a few small frames, no AI
 * (docs/surprise.md, "Deep"). Pure: RGBA bytes in, numbers out.
 *
 *   colourfulness   Hasler–Süsstrunk (opponent channels' spread and mean), 0–1
 *   contrast        the spread of brightness, 0–1
 *   detail          how many pixels sit on an edge (brightness gradient), best in the middle: all-edge is noise
 *   motion          how much the frames differ from each other
 *   structure       mirror symmetry (left–right or top–bottom), a little
 *   novelty         distance of a colour + edge histogram from the last few kept results
 *
 * A frame the degenerate check turns down (blank, blown out, flat) at every moment scores -1.
 */
import { degenerateReason, frameStats } from './degenerate';

export interface Frame { rgba: ArrayLike<number>; w: number; h: number }
/** A tiny description of a picture: a 4×4×4 colour histogram and an 8-bin edge histogram, each summing to 1. */
export interface Signature { colour: number[]; edges: number[] }
export interface Metrics { colourful: number; contrast: number; detail: number; motion: number; structure: number; novelty: number }
export interface Score { score: number; metrics: Metrics; why: string[]; signature: Signature; degenerate: string | null }

const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function lumaOf(f: Frame): Float32Array {
  const out = new Float32Array(f.w * f.h);
  for (let i = 0; i < out.length; i++) out[i] = lum(f.rgba[i * 4], f.rgba[i * 4 + 1], f.rgba[i * 4 + 2]);
  return out;
}

export function colourfulness(f: Frame): number {
  let sRg = 0, sYb = 0, qRg = 0, qYb = 0;
  const n = f.w * f.h;
  for (let i = 0; i < n; i++) {
    const r = f.rgba[i * 4], g = f.rgba[i * 4 + 1], b = f.rgba[i * 4 + 2];
    const rg = r - g, yb = 0.5 * (r + g) - b;
    sRg += rg; sYb += yb; qRg += rg * rg; qYb += yb * yb;
  }
  const mRg = sRg / n, mYb = sYb / n;
  const sd = Math.sqrt(Math.max(0, qRg / n - mRg * mRg) + Math.max(0, qYb / n - mYb * mYb));
  // ~110 is "extremely colourful" on Hasler–Süsstrunk's scale.
  return clamp01((sd + 0.3 * Math.sqrt(mRg * mRg + mYb * mYb)) / 110);
}

function gradient(l: Float32Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    g[i] = Math.hypot(l[i + 1] - l[i - 1], l[i + w] - l[i - w]) * 0.5;
  }
  return g;
}

export function signatureOf(f: Frame): Signature {
  const colour = new Array(64).fill(0);
  const n = f.w * f.h;
  for (let i = 0; i < n; i++) colour[(f.rgba[i * 4] >> 6) * 16 + (f.rgba[i * 4 + 1] >> 6) * 4 + (f.rgba[i * 4 + 2] >> 6)]++;
  const g = gradient(lumaOf(f), f.w, f.h);
  const edges = new Array(8).fill(0);
  for (let i = 0; i < g.length; i++) edges[Math.min(7, Math.floor(Math.sqrt(g[i] * 4) * 8))]++;
  return { colour: colour.map(c => c / n), edges: edges.map(c => c / g.length) };
}

/** 0 (the same) to 1 (nothing shared): half the L1 distance, colour weighted 2:1 over edges. */
export function signatureDistance(a: Signature, b: Signature): number {
  const half = (x: number[], y: number[]) => x.reduce((s, v, i) => s + Math.abs(v - (y[i] ?? 0)), 0) / 2;
  return (2 * half(a.colour, b.colour) + half(a.edges, b.edges)) / 3;
}

function symmetry(l: Float32Array, w: number, h: number): number {
  let lr = 0, tb = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    lr += Math.abs(l[y * w + x] - l[y * w + (w - 1 - x)]);
    tb += Math.abs(l[y * w + x] - l[(h - 1 - y) * w + x]);
  }
  return clamp01(1 - Math.min(lr, tb) / (w * h) * 4);
}

const WEIGHTS: Metrics = { colourful: 0.22, contrast: 0.18, detail: 0.2, motion: 0.12, structure: 0.06, novelty: 0.22 };
const WHY: Record<keyof Metrics, [number, string]> = {
  colourful: [0.35, 'colourful'], contrast: [0.45, 'high contrast'], detail: [0.6, 'high detail'], motion: [0.25, 'moves'], structure: [0.6, 'symmetric'], novelty: [0.5, 'new look'],
};

/**
 * Score a candidate from its frames (the same size, a couple of moments) against the signatures of the
 * last few kept results. Higher is better; -1 when every frame is degenerate.
 */
export function scoreFrames(frames: readonly Frame[], recent: readonly Signature[] = []): Score {
  const f0 = frames[0];
  const signature = signatureOf(f0);
  const reasons = frames.map(f => degenerateReason(frameStats(f.rgba as Uint8Array, f.w, f.h)));
  const degenerate = reasons.every(Boolean) ? reasons[0] : null;
  const lumas = frames.map(lumaOf);
  const l0 = lumas[0];
  let mean = 0;
  for (const v of l0) mean += v;
  mean /= l0.length;
  let varc = 0;
  for (const v of l0) varc += (v - mean) ** 2;
  const contrast = clamp01(Math.sqrt(varc / l0.length) * 3);
  const g = gradient(l0, f0.w, f0.h);
  let onEdge = 0;
  for (const v of g) if (v > 0.04) onEdge++;
  const edgeShare = onEdge / g.length;
  // Best around a third of the picture on an edge; all edges is noise.
  const detail = clamp01(1 - Math.abs(edgeShare - 0.35) / 0.35);
  let motion = 0;
  for (let k = 1; k < lumas.length; k++) {
    let d = 0;
    for (let i = 0; i < l0.length; i++) d += Math.abs(lumas[k][i] - lumas[k - 1][i]);
    motion = Math.max(motion, d / l0.length);
  }
  motion = clamp01(motion * 6);
  const metrics: Metrics = {
    colourful: frames.reduce((s, f) => s + colourfulness(f), 0) / frames.length,
    contrast, detail, motion, structure: symmetry(l0, f0.w, f0.h),
    novelty: recent.length ? Math.min(...recent.map(r => signatureDistance(signature, r))) : 1,
  };
  if (degenerate) return { score: -1, metrics, why: [degenerate], signature, degenerate };
  const score = (Object.keys(WEIGHTS) as Array<keyof Metrics>).reduce((s, k) => s + WEIGHTS[k] * metrics[k], 0);
  const why = (Object.keys(WHY) as Array<keyof Metrics>)
    .filter(k => metrics[k] >= WHY[k][0] && (k !== 'novelty' || recent.length > 0))
    .sort((a, b) => WEIGHTS[b] * metrics[b] - WEIGHTS[a] * metrics[a])
    .slice(0, 3).map(k => WHY[k][1]);
  return { score, metrics, why, signature, degenerate: null };
}

/**
 * The same score with another novelty (e.g. the image model's: distance to the last few kept looks, mixed
 * with the histogram's). The score moves by novelty's weight; the why-chips are made again.
 */
export function withNovelty(sc: Score, novelty: number, hasRecent = true): Score {
  if (sc.degenerate) return sc;
  const n = clamp01(novelty);
  const metrics = { ...sc.metrics, novelty: n };
  const score = sc.score + WEIGHTS.novelty * (n - sc.metrics.novelty);
  const why = (Object.keys(WHY) as Array<keyof Metrics>)
    .filter(k => metrics[k] >= WHY[k][0] && (k !== 'novelty' || hasRecent))
    .sort((a, b) => WEIGHTS[b] * metrics[b] - WEIGHTS[a] * metrics[a])
    .slice(0, 3).map(k => WHY[k][1]);
  return { ...sc, score, metrics, why };
}

/** The best `n` of some scored candidates, best first (degenerate ones never). Stable on ties. */
export function bestOf<T extends { score: Score }>(items: readonly T[], n: number): T[] {
  return items.map((x, i) => ({ x, i })).filter(({ x }) => !x.score.degenerate)
    .sort((a, b) => b.x.score.score - a.x.score.score || a.i - b.i).slice(0, n).map(({ x }) => x);
}
