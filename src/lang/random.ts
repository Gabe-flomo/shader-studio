/**
 * random.ts — randomness in the language (docs/playfield-language-plan.md §13, "Randomness").
 *
 *   falloff=random              a value from the setting's interesting range
 *   falloff=random(0.2..2)      a value from this range
 *   color=random(red, teal)     one of these
 *   random circle · glow        a leading `random`: every setting the line leaves unset
 *   seed=42                     the same result every time; without it each run differs
 *
 * Ranges are per setting and chosen to look good, not merely to be legal (a glow falloff of 0.1
 * is legal and a white screen). They live with each setting (`RandSpec` in the registry and the
 * dialects). Resolution is pure: the same seed and line give the same values, and the resolved
 * values are reported (`falloff=random → 3.7`) so a result can be kept.
 *
 * The generator is mulberry32 seeded from a number. Builder "Surprise me" buttons (src/lib/surprise/)
 * use the same `Rng` interface, so a builder and a line share seeds and ranges.
 */
import type { Value } from './ast';
import { fmtNum } from './print';

export interface Rng {
  /** 0 ≤ x < 1. */
  next(): number;
  /** lo ≤ x ≤ hi. */
  range(lo: number, hi: number): number;
  int(lo: number, hi: number): number;
  pick<T>(xs: readonly T[]): T;
  /** A choice by weight. */
  weighted<T>(xs: ReadonlyArray<readonly [T, number]>): T;
  chance(p: number): boolean;
  readonly seed: number;
}

/** A seeded generator (mulberry32). */
export function makeRng(seed: number): Rng {
  let a = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    seed,
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: xs => xs[Math.min(xs.length - 1, Math.floor(next() * xs.length))],
    weighted: xs => {
      const total = xs.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [x, w] of xs) { if ((r -= w) < 0) return x; }
      return xs[xs.length - 1][0];
    },
    chance: p => next() < p,
  };
  return rng;
}

/** A fresh seed for a run with no `seed=` (1…999999, short enough to read and type back). */
export const freshSeed = () => 1 + Math.floor(Math.random() * 999999);

/** What a setting's random value is drawn from. */
export type RandSpec =
  | { kind: 'num'; lo: number; hi: number; /** Draw on a log scale (sizes, falloffs). */ log?: boolean; int?: boolean; step?: number }
  | { kind: 'vec'; lo: number; hi: number; n: 2 | 3 }
  | { kind: 'colour' }
  | { kind: 'choice'; options: readonly string[] };

/** Colours a random colour is picked from: the bright, readable ones of the table. */
export const RANDOM_COLOURS = ['red', 'orange', 'yellow', 'gold', 'green', 'lime', 'teal', 'cyan', 'blue', 'purple', 'violet', 'pink', 'magenta', 'warm', 'cool', 'ice'] as const;

const snap = (x: number, spec: Extract<RandSpec, { kind: 'num' }>) => {
  if (spec.int) return Math.round(x);
  const step = spec.step ?? (Math.abs(spec.hi - spec.lo) >= 10 ? 0.5 : Math.abs(spec.hi - spec.lo) >= 1 ? 0.05 : 0.005);
  return Math.round(x / step) * step;
};

/** A value drawn from `spec`. */
export function drawFrom(spec: RandSpec, rng: Rng): Value {
  switch (spec.kind) {
    case 'num': {
      const x = spec.log && spec.lo > 0 ? Math.exp(rng.range(Math.log(spec.lo), Math.log(spec.hi))) : rng.range(spec.lo, spec.hi);
      const v = Math.min(spec.hi, Math.max(spec.lo, snap(x, spec)));
      return { k: 'num', v: Number(fmtNum(v)), unit: null };
    }
    case 'vec': return { k: 'vec', v: Array.from({ length: spec.n }, () => Number(fmtNum(snap(rng.range(spec.lo, spec.hi), { kind: 'num', lo: spec.lo, hi: spec.hi })))) };
    case 'colour': return { k: 'word', v: rng.pick(RANDOM_COLOURS) };
    case 'choice': return { k: 'word', v: rng.pick(spec.options) };
  }
}

/**
 * The value a `random…` value resolves to: its own range or choices, else the setting's spec.
 * Null when there is nothing to draw from (the caller reports it).
 */
export function resolveRandom(v: Extract<Value, { k: 'random' }>, spec: RandSpec | undefined, rng: Rng): Value | null {
  if (v.choices?.length) return rng.pick(v.choices);
  if (v.range) {
    const [lo, hi] = v.range;
    const int = spec?.kind === 'num' && spec.int;
    return drawFrom({ kind: 'num', lo, hi, int, log: lo > 0 && hi / lo >= 8 }, rng);
  }
  return spec ? drawFrom(spec, rng) : null;
}

/** One resolved value, for the preview ("falloff=random → 3.7"). */
export interface Resolved { key: string; from: string; to: string; at: number; end: number }
