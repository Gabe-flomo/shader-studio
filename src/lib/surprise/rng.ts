/**
 * rng.ts — the seeded random numbers every "Surprise me" uses (docs/surprise.md).
 *
 * A seed is a whole number from 1 to 999 999 (short enough to read out, type back and share).
 * The same seed always gives the same sequence, so a result can be kept, shared or rebuilt:
 * `makeRng(seed)` is mulberry32 behind a small toolbox (float, int, chance, pick, weighted…).
 * Any text is a seed too (`seedFrom('mossy')`): it hashes to a number.
 *
 * Pure: no DOM, no store.
 */

export const MAX_SEED = 999_999;

/** A fresh seed for a new surprise (1 … 999 999). Uses Math.random: the one place that isn't repeatable. */
export function newSeed(): number {
  return 1 + Math.floor(Math.random() * MAX_SEED);
}

/** FNV-1a: any text → 32-bit number. */
function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A seed from what someone typed: a whole number is itself (kept in 1 … 999 999), anything else
 * (a word, a phrase) hashes to one. Null for empty text.
 */
export function seedFrom(text: string | number): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? normaliseSeed(text) : null;
  const t = text.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return normaliseSeed(Number(t));
  return 1 + (hashText(t.toLowerCase()) % MAX_SEED);
}

/** Any number as a seed in 1 … 999 999. */
export function normaliseSeed(n: number): number {
  const i = Math.abs(Math.round(n)) % (MAX_SEED + 1);
  return i === 0 ? 1 : i;
}

/** The seed of retry `attempt` after `seed` (0 is the seed itself): a new, repeatable seed. */
export function deriveSeed(seed: number, attempt: number | string): number {
  if (attempt === 0) return normaliseSeed(seed);
  return 1 + (hashText(`${seed}:${attempt}`) % MAX_SEED);
}

/** mulberry32: a fast 32-bit generator, 0 ≤ x < 1. */
export function mulberry32(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One item with its weight (a weight of 0 is never picked). */
export type Weighted<T> = readonly [T, number];

export interface Rng {
  /** The seed it started from. */
  readonly seed: number;
  /** 0 ≤ x < 1. */
  next(): number;
  /** lo ≤ x < hi. */
  float(lo: number, hi: number): number;
  /** lo ≤ x < hi, spread evenly on a log scale (lo and hi above 0): good for sizes and frequencies. */
  logFloat(lo: number, hi: number): number;
  /** A whole number lo … hi (both included). */
  int(lo: number, hi: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** −1 or 1. */
  sign(): number;
  /** One item, evenly. */
  pick<T>(items: readonly T[]): T;
  /** One item by weight: `weighted([['a', 3], ['b', 1]])` picks a three times as often. */
  weighted<T>(items: ReadonlyArray<Weighted<T>>): T;
  /** `n` different items (fewer when there aren't enough). */
  sample<T>(items: readonly T[], n: number): T[];
  /** A shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
  /** An independent stream named `label`: adding draws to one part of a generator doesn't change another. */
  fork(label: string | number): Rng;
}

/** Weighted choice with any 0 ≤ r < 1 (exported for code that has its own random source). */
export function weightedChoice<T>(items: ReadonlyArray<Weighted<T>>, r: number): T {
  if (!items.length) throw new Error('weightedChoice: nothing to choose from');
  const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (total <= 0) return items[Math.min(items.length - 1, Math.floor(r * items.length))][0];
  let x = r * total;
  for (const [item, w] of items) {
    x -= Math.max(0, w);
    if (x < 0) return item;
  }
  return items[items.length - 1][0];
}

/** A seeded generator (any number or text as the seed). */
export function makeRng(seed: number | string): Rng {
  const s = typeof seed === 'string' ? (seedFrom(seed) ?? 1) : normaliseSeed(seed);
  const next = mulberry32(s * 2654435761);
  const rng: Rng = {
    seed: s,
    next,
    float: (lo, hi) => lo + next() * (hi - lo),
    logFloat: (lo, hi) => (lo > 0 && hi > 0 ? Math.exp(Math.log(lo) + next() * (Math.log(hi) - Math.log(lo))) : lo + next() * (hi - lo)),
    int: (lo, hi) => {
      const a = Math.ceil(Math.min(lo, hi)), b = Math.floor(Math.max(lo, hi));
      return a + Math.min(b - a, Math.floor(next() * (b - a + 1)));
    },
    chance: p => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: items => {
      if (!items.length) throw new Error('pick: nothing to choose from');
      return items[Math.min(items.length - 1, Math.floor(next() * items.length))];
    },
    weighted: items => weightedChoice(items, next()),
    sample: (items, n) => rng.shuffle(items).slice(0, Math.max(0, n)),
    shuffle: items => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    fork: label => makeRng(deriveSeed(s, `fork:${label}`)),
  };
  return rng;
}
