/**
 * ranges.ts — "interesting" ranges for random values (docs/surprise.md).
 *
 * A slider's legal range is what the GLSL accepts; most of it looks bad. A Frequency of 0.01 is a
 * flat field, 40 is noise; an Octaves of 1 is a blob; a Radius at its max fills the frame. The
 * table below says, per parameter name, the part of the range worth landing in: wide enough to
 * vary, narrow enough to avoid blank, blown-out or noisy pictures. It is always cut to the legal
 * range a caller passes, so it can never produce a value the slider can't hold.
 *
 * Lookup, most specific first: `nodeType.key` ("gridRules.density"), the key itself, the key
 * without an axis or number suffix ("offsetX" → "offset", "color2" → "color"), then its last word
 * ("glowFalloff" → "falloff"). No entry: a band round the slider's default (or the middle of its
 * range). Some keys are never randomised (bit masks, reset counters): `interestingRange` returns
 * null for them.
 *
 * Other modules (the shared language's vocabulary) add entries with `registerInterestingRanges`.
 */
import type { Rng } from './rng';

export interface CuratedRange {
  lo: number;
  hi: number;
  /** Spread evenly on a log scale (sizes, frequencies). Default: when lo > 0 and hi ≥ 8 × lo. */
  log?: boolean;
  /** Whole numbers. */
  int?: boolean;
  /** Use the whole legal range (angles, hues, seeds: every value is as good as another). */
  full?: boolean;
}

/** What a caller knows of the slider: its legal range, step and default. */
export interface RangeHint {
  min?: number;
  max?: number;
  step?: number;
  def?: number;
  int?: boolean;
}

export interface Interesting {
  lo: number;
  hi: number;
  log: boolean;
  int: boolean;
  /** Where it came from: the table, a band round the default, the legal range, or −1…1 for a slider with no range. */
  source: 'curated' | 'default' | 'legal' | 'none';
}

const R = (lo: number, hi: number, o: Partial<CuratedRange> = {}): CuratedRange => ({ lo, hi, ...o });
const FULL: CuratedRange = { lo: -Infinity, hi: Infinity, full: true };

/** The table. Keys are lower case. */
export const INTERESTING_RANGES: Record<string, CuratedRange> = {
  // Noise and patterns
  frequency: R(1, 12, { log: true }), freq: R(1, 12, { log: true }),
  scale: R(0.6, 6, { log: true }),
  octaves: R(3, 6, { int: true }),
  lacunarity: R(1.8, 2.6),
  persistence: R(0.35, 0.65),
  roughness: R(0.3, 0.7),
  warp: R(0.1, 0.8), distortion: R(0.1, 0.8), distort: R(0.1, 0.8),
  // Amounts
  strength: R(0.2, 1.2), amount: R(0.2, 1), intensity: R(0.4, 1.6), mix: R(0.3, 0.9), blend: R(0.3, 0.9),
  alpha: R(0.5, 1), opacity: R(0.5, 1),
  // Tone
  brightness: R(0.7, 1.4), contrast: R(0.85, 1.6), saturation: R(0.7, 1.5), gamma: R(0.75, 1.5), exposure: R(0.7, 1.8),
  // Shapes and sizes
  radius: R(0.12, 0.7), size: R(0.15, 0.8), thickness: R(0.01, 0.15, { log: true }), width: R(0.01, 0.2, { log: true }),
  softness: R(0.01, 0.3, { log: true }), smoothness: R(0.01, 0.3, { log: true }), blur: R(0.5, 4), feather: R(0.01, 0.3, { log: true }),
  k: R(0.05, 0.4), zoom: R(0.8, 2.5),
  // Glow and light
  glow: R(0.3, 2), falloff: R(2, 20, { log: true }), density: R(0.15, 0.6), threshold: R(0.2, 0.7),
  // Repeats
  iterations: R(3, 8, { int: true }), iter: R(3, 8, { int: true }), itercount: R(3, 8, { int: true }),
  count: R(3, 12, { int: true }), copies: R(3, 12, { int: true }), segments: R(3, 12, { int: true }), sides: R(3, 9, { int: true }),
  folds: R(2, 5, { int: true }),
  // Motion
  speed: R(0.1, 1.2, { log: true }), time_scale: R(0.2, 1.5), timescale: R(0.2, 1.5), rate: R(0.2, 1.5),
  amplitude: R(0.05, 0.5), amp: R(0.05, 0.5),
  // Placement
  offset: R(-0.5, 0.5), x: R(-0.5, 0.5), y: R(-0.5, 0.5), z: R(-0.5, 0.5), pos: R(-0.5, 0.5),
  // Trails
  halflife: R(0.03, 0.3, { log: true }), diffuse: R(0.3, 1), decay: R(0.002, 0.02, { log: true }),
  // Anything goes
  angle: FULL, rotation: FULL, rotate: FULL, hue: FULL, hueshift: FULL, phase: FULL, seed: FULL,
  // Per node type
  'gridrules.density': R(0.15, 0.5),
  'gridrules.rate': R(0.3, 1),
  'gridrules.afterglow': R(0.6, 0.97),
};

/** Keys that are never randomised: bit masks, counters, switches stored as numbers. */
export const NEVER_RANDOMISE = new Set(['bornmask', 'survivemask', 'reset', 'paint', 'resolution', 'tier', 'steps', 'preroll', 'stepsperframe']);

/** Add (or replace) entries: the shared language's vocabulary, a builder's own words. Keys are matched case-insensitively. */
export function registerInterestingRanges(entries: Record<string, CuratedRange>): void {
  for (const [k, v] of Object.entries(entries)) INTERESTING_RANGES[k.toLowerCase()] = v;
}

/** The table entry for a key (most specific first), or null. */
export function curatedRange(key: string, nodeType?: string): CuratedRange | null {
  const k = key.toLowerCase();
  if (nodeType) {
    const typed = INTERESTING_RANGES[`${nodeType.toLowerCase()}.${k}`];
    if (typed) return typed;
  }
  if (INTERESTING_RANGES[k]) return INTERESTING_RANGES[k];
  // offsetX → offset, color2 → color, scale_y → scale
  const bare = key.replace(/[_\s]?([XYZxyz]|\d+)$/, '').toLowerCase();
  if (bare !== k && INTERESTING_RANGES[bare]) return INTERESTING_RANGES[bare];
  // glowFalloff → falloff, noise_scale → scale
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_]+/).filter(Boolean);
  const last = words[words.length - 1]?.toLowerCase().replace(/\d+$/, '');
  if (words.length > 1 && last && INTERESTING_RANGES[last]) return INTERESTING_RANGES[last];
  return null;
}

/** Whether a key is never randomised. */
export const neverRandomise = (key: string) => key.startsWith('_') || NEVER_RANDOMISE.has(key.toLowerCase());

const autoLog = (lo: number, hi: number) => lo > 0 && hi >= lo * 8;

/**
 * The range a random value for `key` should come from, inside the legal range `legal`.
 * Null: never randomise this key.
 */
export function interestingRange(key: string, legal: RangeHint = {}, nodeType?: string): Interesting | null {
  if (neverRandomise(key)) return null;
  const int = !!legal.int || (legal.step !== undefined && legal.step >= 1 && Number.isInteger(legal.step));
  const hasMin = typeof legal.min === 'number' && Number.isFinite(legal.min);
  const hasMax = typeof legal.max === 'number' && Number.isFinite(legal.max);
  const lmin = hasMin ? legal.min! : -Infinity;
  const lmax = hasMax ? legal.max! : Infinity;
  const c = curatedRange(key, nodeType);
  if (c) {
    if (c.full) {
      if (hasMin && hasMax) return { lo: lmin, hi: lmax, log: false, int, source: 'legal' };
      return { lo: -1, hi: 1, log: false, int, source: 'none' };
    }
    const lo = Math.max(lmin, c.lo), hi = Math.min(lmax, c.hi);
    // The table's band must overlap the legal range by a useful amount; otherwise fall through.
    const legalWidth = hasMin && hasMax ? lmax - lmin : Infinity;
    if (hi > lo && (hi - lo) >= Math.min(legalWidth * 0.05, c.hi - c.lo)) {
      return { lo, hi, log: c.log ?? autoLog(lo, hi), int: int || !!c.int, source: 'curated' };
    }
  }
  if (hasMin && hasMax && lmax > lmin) {
    const w = lmax - lmin;
    const def = typeof legal.def === 'number' && Number.isFinite(legal.def) ? Math.min(lmax, Math.max(lmin, legal.def)) : null;
    // A band round the default (35% of the range each way), or the middle of the range.
    const lo = def !== null ? Math.max(lmin, def - w * 0.35) : lmin + w * 0.15;
    const hi = def !== null ? Math.min(lmax, def + w * 0.35) : lmin + w * 0.75;
    return { lo, hi, log: false, int, source: def !== null ? 'default' : 'legal' };
  }
  if (hasMin && typeof legal.def === 'number' && legal.def > lmin) {
    return { lo: Math.max(lmin, legal.def * 0.5), hi: legal.def * 2, log: legal.def > 0, int, source: 'default' };
  }
  return { lo: -1, hi: 1, log: false, int, source: 'none' };
}

/** A value from a range (0 ≤ r < 1, or a Rng): log-spread when the range says so, whole when it is whole. */
export function sampleRange(r: Pick<Interesting, 'lo' | 'hi' | 'log' | 'int'>, rand: Rng | (() => number)): number {
  const u = typeof rand === 'function' ? rand() : rand.next();
  if (r.int) {
    const a = Math.ceil(r.lo), b = Math.floor(r.hi);
    if (b < a) return Math.round((r.lo + r.hi) / 2);
    if (r.log && a > 0) return Math.min(b, Math.floor(Math.exp(Math.log(a) + u * (Math.log(b + 1) - Math.log(a)))));
    return a + Math.min(b - a, Math.floor(u * (b - a + 1)));
  }
  return r.log && r.lo > 0 ? Math.exp(Math.log(r.lo) + u * (Math.log(r.hi) - Math.log(r.lo))) : r.lo + u * (r.hi - r.lo);
}

/** A random value for `key`: interestingRange then sampleRange. Null when the key is never randomised. */
export function randomValue(key: string, legal: RangeHint, rand: Rng | (() => number), nodeType?: string): number | null {
  const r = interestingRange(key, legal, nodeType);
  return r ? sampleRange(r, rand) : null;
}
