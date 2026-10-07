/**
 * degenerate.ts — is a random result worth showing? (docs/surprise.md)
 *
 * A surprise is checked with the same frame stats the node preview explains itself with
 * (lib/previewExplain.ts PreviewStats: share clipped to white, share black, one flat colour, mean
 * brightness). A picture that is nearly all black, nearly all white or one flat colour is
 * rejected and the generator tries again with the next seed, a few times. The seed that is kept
 * is the one that made the result, so typing it back reproduces it without a retry.
 */
import type { PreviewStats } from '../previewExplain';
import { deriveSeed, makeRng, normaliseSeed, type Rng } from './rng';

export type FrameStats = PreviewStats & {
  /** How much brightness varies across the picture (standard deviation, 0–0.5). */
  spread?: number;
};

/**
 * Frame stats from RGBA bytes (a readPixels, an ImageData, a CPU board's colours). `every` samples
 * one pixel in that many, for speed. The thresholds match the node preview's (valueField.ts).
 */
export function frameStats(rgba: ArrayLike<number>, w: number, h: number, every = 1): FrameStats {
  const n = Math.max(1, Math.floor((w * h) / Math.max(1, every)));
  let clipped = 0, black = 0, sum = 0, sum2 = 0, flat = true, seen = 0;
  const r0 = rgba[0], g0 = rgba[1], b0 = rgba[2];
  for (let k = 0; k < n; k++) {
    const o = Math.min(w * h - 1, k * Math.max(1, every)) * 4;
    const r = rgba[o] / 255, g = rgba[o + 1] / 255, b = rgba[o + 2] / 255;
    const mx = Math.max(r, g, b);
    if (mx >= 0.996) clipped++;
    if (mx <= 0.008) black++;
    const l = (r + g + b) / 3;
    sum += l; sum2 += l * l; seen++;
    if (flat && (Math.abs(rgba[o] - r0) > 6 || Math.abs(rgba[o + 1] - g0) > 6 || Math.abs(rgba[o + 2] - b0) > 6)) flat = false;
  }
  const mean = sum / seen;
  return { clipped: clipped / seen, black: black / seen, flat, mean, spread: Math.sqrt(Math.max(0, sum2 / seen - mean * mean)) };
}

export interface DegenerateLimits {
  /** Most of the picture that may be black (default 0.97). */
  maxBlack: number;
  /** Most that may clip to white (default 0.9). */
  maxClipped: number;
  /** Least brightness spread (default 0.012): below it the picture is as good as flat. */
  minSpread: number;
}

export const DEFAULT_LIMITS: DegenerateLimits = { maxBlack: 0.97, maxClipped: 0.9, minSpread: 0.012 };

/** Why a picture isn't worth showing ('blank', 'blown out', 'flat'), or null when it is. */
export function degenerateReason(s: FrameStats, limits: Partial<DegenerateLimits> = {}): string | null {
  const L = { ...DEFAULT_LIMITS, ...limits };
  if (s.black >= L.maxBlack) return 'blank';
  if (s.clipped >= L.maxClipped) return 'blown out';
  if (s.flat) return 'flat';
  if (s.spread !== undefined && s.spread < L.minSpread) return 'flat';
  return null;
}

export const isDegenerate = (s: FrameStats, limits?: Partial<DegenerateLimits>) => degenerateReason(s, limits) !== null;

export interface SurpriseResult<T> {
  value: T;
  /** The seed that made `value` (the asked-for seed, or a later one after retries). */
  seed: number;
  /** How many results were made (1 when the first was good). */
  tries: number;
  /** The results turned down, with why. */
  rejected: Array<{ seed: number; why: string }>;
  /** False when every try was turned down (`value` is then the last one). */
  ok: boolean;
}

export interface RetryOptions<T> {
  /** The first seed to try. */
  seed: number;
  /** Most tries (default 4). */
  tries?: number;
  /** Make a result from a generator seeded with `seed`. */
  make: (rng: Rng, seed: number) => T;
  /** Why it isn't good enough, or null when it is. No judge: the first result is kept. */
  judge?: (value: T, seed: number) => string | null;
}

/**
 * Make a result, judge it, and try the next seed (deriveSeed) while it is judged degenerate,
 * up to `tries` times. Deterministic: the same seed gives the same sequence of tries.
 */
export function withRetries<T>(o: RetryOptions<T>): SurpriseResult<T> {
  const max = Math.max(1, o.tries ?? 4);
  const rejected: SurpriseResult<T>['rejected'] = [];
  let last: { value: T; seed: number } | null = null;
  for (let i = 0; i < max; i++) {
    const seed = deriveSeed(normaliseSeed(o.seed), i);
    const value = o.make(makeRng(seed), seed);
    last = { value, seed };
    const why = o.judge ? o.judge(value, seed) : null;
    if (!why) return { value, seed, tries: i + 1, rejected, ok: true };
    rejected.push({ seed, why });
  }
  return { value: last!.value, seed: last!.seed, tries: max, rejected, ok: false };
}

/** withRetries with a judge that takes time (a GPU frame read back): the same tries, awaited. */
export async function withRetriesAsync<T>(o: Omit<RetryOptions<T>, 'judge'> & { judge?: (value: T, seed: number) => Promise<string | null> | string | null }): Promise<SurpriseResult<T>> {
  const max = Math.max(1, o.tries ?? 4);
  const rejected: SurpriseResult<T>['rejected'] = [];
  let last: { value: T; seed: number } | null = null;
  for (let i = 0; i < max; i++) {
    const seed = deriveSeed(normaliseSeed(o.seed), i);
    const value = o.make(makeRng(seed), seed);
    last = { value, seed };
    const why = o.judge ? await o.judge(value, seed) : null;
    if (!why) return { value, seed, tries: i + 1, rejected, ok: true };
    rejected.push({ seed, why });
  }
  return { value: last!.value, seed: last!.seed, tries: max, rejected, ok: false };
}

/** A judge from frame stats: `stats(value)` (null: can't tell, e.g. no GPU) → degenerateReason. */
export function statsJudge<T>(stats: (value: T) => FrameStats | null, limits?: Partial<DegenerateLimits>): (value: T) => string | null {
  return value => {
    const s = stats(value);
    return s ? degenerateReason(s, limits) : null;
  };
}
