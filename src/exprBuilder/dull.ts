/**
 * dull.ts — the dull-move filter (docs/expression-builder-plan.md §4.2, phase 3).
 *
 * Each candidate runs on the CPU (glslPatterns' evaluator) over the tile's picture: a grid of
 * points across the seed's domain, the same one the tiles render (UV −1…1, a world position's
 * z = 0 slice of a box 4 wide, time 0…2π), each point as two samples half a pixel apart. A
 * candidate sinks out of the grid (into "Show hidden") when it is:
 *
 *  - **NaN or infinite** over more than a sliver of the picture;
 *  - **constant**: the same value everywhere;
 *  - **unchanged**: the same values as the expression before it;
 *  - **too fine to see**: it changes as much inside one pixel as across the picture (aliasing:
 *    within-pixel spread over the overall spread, averaged over the pixels).
 *
 * The rest get `change` (0…1): how much they change the picture, for a small lift in the ranking.
 *
 * The chain so far is evaluated once per position (`chainSamples`, cached), and each candidate
 * only runs its own step(s) on those values, so a candidate costs a few hundred evaluations of a
 * small template. A move the evaluator can't run (a helper it doesn't know) is `evaluated: false`
 * and stays where the ranking put it. Pure.
 */
import { compileExpr, parseExpr, type EvalEnv, type Value } from '../lib/glslPatterns';
import { stepCode, tileSteps, type Chain, type ChainStep, type Tile } from './chain';
import type { Catalogue } from './moves';

export type DullReason = 'nan' | 'constant' | 'same' | 'alias';

export interface Verdict {
  /** Why it is dull, or null. */
  dull: DullReason | null;
  /** How much it changes the picture, 0…1 (0 when unknown). */
  change: number;
  /** Whether the CPU could run it at all. */
  evaluated: boolean;
}

export const DULL_WORDS: Record<DullReason, string> = {
  nan: 'not a number (NaN or infinite) over the picture',
  constant: 'the same value everywhere',
  same: 'no change from the step before',
  alias: 'too fine to see at this size (it would shimmer)',
};

/** The sample points are GRID² (2D, spread over the picture), or TIME_SAMPLES along time (the plot's own count). */
export const GRID = 6;
export const TIME_SAMPLES = 96;
/** The tile's size in pixels across the domain (the pictures are 112 CSS px). */
export const TILE_PIXELS = 112;
/** NaN over more than this share of the points: dull. */
const NAN_SHARE = 0.02;
/**
 * Within-pixel spread over the overall spread, averaged over the pixels: above this it aliases.
 * Two samples half a pixel apart: noise gives about 1/3, a sine about 1/P for a period of P pixels,
 * so this flags detail finer than about 4–5 pixels.
 */
const ALIAS_RATIO = 0.22;

export interface Samples {
  /** The chain so far at every sub-sample (point-major, 2 per point; 1 per point for time). */
  values: Value[];
  /** Time at every sub-sample (the pictures render at t = 1; a time seed runs along t). */
  times: number[];
  /** Sub-samples per point. */
  sub: number;
  /** Did the chain itself evaluate? */
  ok: boolean;
}

type Fn = (env: EvalEnv) => Value;
const fnCache = new Map<string, Fn | null>();
function compiled(code: string): Fn | null {
  let f = fnCache.get(code);
  if (f === undefined) {
    const r = parseExpr(code);
    f = r.ok ? compileExpr(r.expr) : null;
    if (fnCache.size > 4000) fnCache.clear();
    fnCache.set(code, f);
  }
  return f;
}

const IN = '__in';
const stepCache = new Map<string, Fn | null>();
/** A step's code with its input as `__in` and its holes as numbers, compiled (cached by template and values). */
function stepExpr(s: Pick<ChainStep, 'template' | 'holes'>): Fn | null {
  const k = `${s.template}|${s.holes.map(h => (h.kind === 'number' ? h.value : h.code)).join('|')}`;
  let f = stepCache.get(k);
  if (f === undefined) {
    f = compiled(stepCode(s, IN));
    if (stepCache.size > 4000) stepCache.clear();
    stepCache.set(k, f);
  }
  return f;
}

/**
 * The seed's value at a point of the picture (p in −1…1), as the preview graph feeds it. A world
 * position also gets a depth per point (`z`): the tiles show the z = 0 slice, but a move that only
 * bends along z still matters in a 3D scene, so it shouldn't count as "no change".
 */
function seedAt(chain: Chain, x: number, y: number, z: number): Value {
  const s = chain.seed;
  if (s.kind === 'uv') return [x, y];
  if (s.kind === 'world') return [x * 2, y * 2, z];
  if (s.type === 'vec3') return [x * 0.5 + 0.5, y * 0.5 + 0.5, 0.5];
  if (s.type === 'vec2') return [x, y];
  return x * 0.5 + 0.5;
}

/** Run compiled steps on a value. Throws when the evaluator can't. */
function run(fns: readonly Fn[], v: Value, t: number): Value {
  const env: EvalEnv = { [IN]: v, t, u_time: t, iTime: t };
  for (const f of fns) { env[IN] = v; v = f(env); }
  return v;
}

let lastSamples: { chain: Chain; upTo: number; s: Samples } | null = null;

/** The chain's first `upTo` steps over the picture's sample points (cached for the last chain asked). */
export function chainSamples(chain: Chain, upTo: number): Samples {
  if (lastSamples && lastSamples.chain === chain && lastSamples.upTo === upTo) return lastSamples.s;
  const exprs = chain.steps.slice(0, upTo).map(stepExpr);
  const values: Value[] = [], times: number[] = [];
  let ok = exprs.every(Boolean);
  const time = chain.seed.kind === 'time';
  const sub = time ? 1 : 2;
  if (ok) {
    try {
      if (time) {
        for (let i = 0; i < TIME_SAMPLES; i++) {
          const t = (i / (TIME_SAMPLES - 1)) * 2 * Math.PI;
          values.push(run(exprs as Fn[], t, t));
          times.push(t);
        }
      } else {
        const px = 2 / TILE_PIXELS, q = px / 4;
        for (let i = 0; i < GRID * GRID; i++) {
          // Points spread evenly but on no regular grid (the R2 sequence): a regular grid would
          // land on the same phase of a repeat whose period matches its spacing.
          const x = -0.98 + 1.96 * ((0.5 + i * 0.7548776662) % 1), y = -0.98 + 1.96 * ((0.5 + i * 0.5698402910) % 1);
          // A depth per point for a world position (−2…2, scattered so neighbours differ).
          const z = -2 + 4 * ((0.5 + i * 0.6180339887) % 1);
          for (const [dx, dy] of [[-q, -q], [q, q]]) {
            values.push(run(exprs as Fn[], seedAt(chain, x + dx, y + dy, z), 1));
            times.push(1);
          }
        }
      }
    } catch { ok = false; }
  }
  const s: Samples = { values, times, sub, ok };
  lastSamples = { chain, upTo, s };
  return s;
}

const flat = (v: Value): number[] => (Array.isArray(v) ? (v.length === 5 && Number.isNaN(v[0]) ? v.slice(1) : v) : [v]);

/**
 * Judge a candidate (its steps, applied after the samples' chain). `evaluated: false` when the
 * evaluator can't run it here; then it isn't called dull.
 */
export function judgeSteps(samples: Samples, steps: ReadonlyArray<Pick<ChainStep, 'template' | 'holes'>>): Verdict {
  const unknown: Verdict = { dull: null, change: 0, evaluated: false };
  if (!samples.ok || !samples.values.length) return unknown;
  const exprs = steps.map(stepExpr);
  if (exprs.some(e => !e)) return unknown;
  const out: number[][] = [];
  try {
    for (let i = 0; i < samples.values.length; i++) out.push(flat(run(exprs as Fn[], samples.values[i], samples.times[i])));
  } catch { return unknown; }
  const n = out[0].length;
  const N = out.length, sub = samples.sub;
  // NaN / infinite
  let bad = 0;
  for (const o of out) if (o.some(v => !Number.isFinite(v))) bad++;
  if (bad / N > NAN_SHARE) return { dull: 'nan', change: 0, evaluated: true };
  const finite = out.filter(o => o.every(Number.isFinite));
  // Per component: range and spread
  const lo = new Array(n).fill(Infinity), hi = new Array(n).fill(-Infinity);
  let mag = 0;
  for (const o of finite) for (let c = 0; c < n; c++) { lo[c] = Math.min(lo[c], o[c]); hi[c] = Math.max(hi[c], o[c]); mag = Math.max(mag, Math.abs(o[c])); }
  const eps = 1e-6 * Math.max(1, mag);
  const spread = Math.max(...hi.map((h, c) => h - lo[c]));
  if (!(spread > eps)) return { dull: 'constant', change: 0, evaluated: true };
  // Unchanged from the chain so far
  const before = samples.values.map(flat);
  let change = 1;
  if (before[0].length === n) {
    let diff = 0, bLo = Infinity, bHi = -Infinity;
    for (let i = 0; i < N; i++) for (let c = 0; c < n; c++) {
      const b = before[i][c], o = out[i][c];
      if (Number.isFinite(b) && Number.isFinite(o)) diff = Math.max(diff, Math.abs(o - b));
      if (Number.isFinite(b)) { bLo = Math.min(bLo, b); bHi = Math.max(bHi, b); }
    }
    if (diff <= eps) return { dull: 'same', change: 0, evaluated: true };
    // Mean change against the spread of before and after
    let sum = 0, cnt = 0;
    for (let i = 0; i < N; i++) for (let c = 0; c < n; c++) {
      const b = before[i][c], o = out[i][c];
      if (Number.isFinite(b) && Number.isFinite(o)) { sum += Math.abs(o - b); cnt++; }
    }
    change = Math.min(1, (sum / Math.max(1, cnt)) / Math.max(eps, Math.max(spread, bHi - bLo)));
  }
  // Too fine to see: spread inside a pixel against the spread over the picture, per component
  if (sub > 1) {
    let ratio = 0;
    for (let c = 0; c < n; c++) {
      const w = hi[c] - lo[c];
      if (!(w > eps)) continue;
      let inside = 0, pts = 0;
      for (let i = 0; i + sub <= N; i += sub) {
        let a = Infinity, b = -Infinity, ok = true;
        for (let k = 0; k < sub; k++) { const v = out[i + k][c]; if (!Number.isFinite(v)) { ok = false; break; } a = Math.min(a, v); b = Math.max(b, v); }
        if (ok) { inside += (b - a) / w; pts++; }
      }
      if (pts) ratio = Math.max(ratio, inside / pts);
    }
    if (ratio > ALIAS_RATIO) return { dull: 'alias', change, evaluated: true };
  } else {
    // Along time: neighbouring samples as unrelated as any two (the plot would be a scribble). A
    // smooth curve moves about twice as far over two samples as over one; noise doesn't.
    const w = Math.max(eps, spread);
    const median = (k: number) => {
      const js: number[] = [];
      for (let i = k; i < N; i++) js.push(Math.max(...out[i].map((v, c) => Math.abs(v - out[i - k][c]))) / w);
      js.sort((a, b) => a - b);
      return js[Math.floor(js.length / 2)] ?? 0;
    };
    const one = median(1);
    if (one > 0.1 && median(2) < 1.3 * one) return { dull: 'alias', change, evaluated: true };
  }
  return { dull: null, change, evaluated: true };
}

// ── Applying verdicts to the grid ─────────────────────────────────────────────

/** How much changing the picture lifts a tile (its score is a log-chance; a full change is about ×1.4). */
export const CHANGE_WEIGHT = 0.35;
/** The change a tile not judged (yet, or at all) is taken to make. */
const UNKNOWN_CHANGE = 0.3;

/**
 * A section's tiles with the verdicts in: the dull ones taken out (with why), the rest re-ranked a
 * little by how much they change the picture. Tiles without a verdict keep their place. Pure.
 */
export function applyVerdicts(tiles: readonly Tile[], verdicts: ReadonlyMap<string, Verdict> | null): { shown: Tile[]; hidden: Array<{ tile: Tile; reason: DullReason }> } {
  if (!verdicts) return { shown: [...tiles], hidden: [] };
  const hidden: Array<{ tile: Tile; reason: DullReason }> = [];
  const kept: Array<{ t: Tile; s: number; i: number }> = [];
  tiles.forEach((t, i) => {
    const v = verdicts.get(t.key);
    if (v?.dull) { hidden.push({ tile: t, reason: v.dull }); return; }
    kept.push({ t, i, s: t.score + CHANGE_WEIGHT * (v?.evaluated ? v.change : UNKNOWN_CHANGE) });
  });
  kept.sort((a, b) => b.s - a.s || a.i - b.i);
  return { shown: kept.map(k => k.t), hidden };
}

/** Every tile judged at once (tests, Surprise me; the window spreads this over frames). */
export function judgeTiles(chain: Chain, upTo: number, tiles: readonly Tile[], cat: Pick<Catalogue, 'docs'>): Map<string, Verdict> {
  const s = chainSamples(chain, upTo);
  return new Map(tiles.map(t => [t.key, judgeSteps(s, tileSteps(t, cat))]));
}
