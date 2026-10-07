/**
 * random.ts — randomness in the language (docs/playfield-language-plan.md §13, "Randomness"),
 * built on the app's one seeded generator and interesting-ranges table (src/lib/surprise,
 * docs/surprise.md), so a line and a builder's "Surprise me" draw the same way.
 *
 *   falloff=random              a value from the setting's interesting range
 *   falloff=random(0.2..2)      a value from this range
 *   color=random(red, teal)     one of these
 *   random circle · glow        a leading `random`: every setting the line leaves unset
 *   seed=42 (or seed=mossy)     the same result every time; without it each run differs
 *
 * A setting's range comes, most specific first, from the registry entry (`rand`, where the
 * language knows better: a glow's falloff, a Gray–Scott feed), else from lib/surprise's table by
 * the setting's name, cut to its legal range. Random colours come from one harmonious palette per
 * line (lib/surprise/colour.ts), so a line's colours go together. Resolution is pure: the same
 * seed and line give the same values, and what was drawn is reported (`falloff=random → 3.7`)
 * so a result can be kept.
 */
import type { Value } from './ast';
import { fmtNum } from './print';
import { colourText } from './colours';
import {
  harmoniousPalette, interestingRange, makeRng as surpriseRng, newSeed, registerInterestingRanges, sampleRange, seedFrom,
  type RangeHint, type Rng as SurpriseRng,
} from '../lib/surprise';

export type Rng = SurpriseRng;

/** A seeded generator (any number, or a word: `seed=mossy`). */
export const makeRng = (seed: number | string): Rng => surpriseRng(seed);

/** A fresh seed for a run with no `seed=` (1…999 999). */
export const freshSeed = (): number => newSeed();

/** The seed a `seed=` value names (a number or a word), or null. */
export const seedOf = (text: string): number | null => seedFrom(text);

/** What a setting's random value is drawn from. */
export type RandSpec =
  | { kind: 'num'; lo: number; hi: number; /** Draw on a log scale (sizes, falloffs). */ log?: boolean; int?: boolean; step?: number }
  | { kind: 'vec'; lo: number; hi: number; n: 2 | 3 }
  | { kind: 'colour' }
  | { kind: 'choice'; options: readonly string[] };

/** A range for setting `key` from lib/surprise's table, cut to its legal range (null: never random). */
export function rangeFor(key: string, legal: RangeHint = {}): RandSpec | null {
  const r = interestingRange(key, legal);
  return r ? { kind: 'num', lo: r.lo, hi: r.hi, log: r.log, int: r.int } : null;
}

/** The language's own words with ranges lib/surprise's table doesn't have (by setting name). */
registerInterestingRanges({
  feed: { lo: 0.025, hi: 0.065 }, kill: { lo: 0.055, hi: 0.065 }, cooling: { lo: 0, hi: 0.01 }, 'wave-speed': { lo: 0.5, hi: 1 },
  damping: { lo: 0.98, hi: 0.999 }, 'spread-a': { lo: 0.8, hi: 1 }, 'spread-b': { lo: 0.3, hi: 0.6 }, shine: { lo: 0, hi: 0.8 },
  wander: { lo: 3, hi: 30 }, ahead: { lo: 0.015, hi: 0.06, log: true },
});

const snap = (x: number, spec: Extract<RandSpec, { kind: 'num' }>) => {
  if (spec.int) return Math.round(x);
  const step = spec.step ?? (Math.abs(spec.hi - spec.lo) >= 10 ? 0.5 : Math.abs(spec.hi - spec.lo) >= 1 ? 0.05 : Math.abs(spec.hi - spec.lo) >= 0.1 ? 0.005 : 0.0005);
  return Math.round(x / step) * step;
};

/** Colours drawn on one generator come from one harmonious palette (6 at a time). */
const palettes = new WeakMap<Rng, { cols: Array<[number, number, number]>; i: number }>();

function nextColour(rng: Rng): [number, number, number] {
  let p = palettes.get(rng);
  if (!p || p.i >= p.cols.length) { p = { cols: harmoniousPalette(rng.fork(`colours:${p ? p.i : 0}`), 6), i: 0 }; palettes.set(rng, p); }
  const c = p.cols[p.i++];
  return c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255) / 255) as [number, number, number];
}

/** A value drawn from `spec`. */
export function drawFrom(spec: RandSpec, rng: Rng): Value {
  switch (spec.kind) {
    case 'num': {
      const x = sampleRange({ lo: spec.lo, hi: spec.hi, log: !!spec.log && spec.lo > 0, int: !!spec.int }, rng);
      const v = Math.min(spec.hi, Math.max(spec.lo, snap(x, spec)));
      return { k: 'num', v: Number(fmtNum(v)), unit: null };
    }
    case 'vec': return { k: 'vec', v: Array.from({ length: spec.n }, () => Number(fmtNum(snap(rng.float(spec.lo, spec.hi), { kind: 'num', lo: spec.lo, hi: spec.hi })))) };
    case 'colour': { const c = nextColour(rng); return { k: 'colour', v: c.map(x => Math.round(x * 10000) / 10000) as [number, number, number], text: colourText(c) }; }
    case 'choice': return { k: 'word', v: rng.pick(spec.options) };
  }
}

/**
 * The value a `random…` value resolves to: its own range or choices, else the setting's spec.
 * Null when there is nothing to draw from (the caller reports it).
 */
export function resolveRandom(v: Extract<Value, { k: 'random' }>, spec: RandSpec | null | undefined, rng: Rng): Value | null {
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
