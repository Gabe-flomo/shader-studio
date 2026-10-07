/**
 * surprise.ts — Grid Rules' Surprise me (docs/surprise.md): a random rule that is interesting,
 * with a random start and colours, as a patch for the node's params.
 *
 *  - Count: biased toward the known "alive" Life-like families (B3/S23 and its relatives,
 *    B36/S23-like, B3/S high-survive corals and mazes, blobby B5678 annealers, von Neumann
 *    diamonds, Larger-than-Life bands round Bosco's rule). Each candidate is run on a CPU test
 *    board (gridRules/cpu.ts) and turned down when it dies out, fills the board or freezes
 *    within N steps; the next candidate (a derived seed) is tried.
 *  - Stages: a Generations preset with its counts and number of states nudged, run the same way.
 *  - Smooth: a template with its numbers jittered round values known to work (Gray–Scott feed and
 *    kill near a known spot, diffusion, waves); reaction–diffusion is checked not to die out.
 *  - Patterns and Blocks: a preset with its start, density and chances varied.
 *
 * Pure; deterministic for a seed.
 */
import { harmoniousPalette, hslToRgb, makeRng, darkBackground, rampPalette, deriveSeed, normaliseSeed, type Rng, type SurpriseResult } from '../lib/surprise';
import { cpuSeed, cpuStep } from './cpu';
import {
  COUNT_PRESETS, GRID_DEFAULTS, LOOKS, SMOOTH_PRESETS, STAGES_PRESETS, gridShape, maskOf, maxCount, presetPatch, ruleSummary,
  type GridRuleType,
} from './spec';
import { BLOCK_PRESETS, PATTERN_PRESETS, type BlockRule, type PatternRule } from './stencils';

type P = Record<string, unknown>;

/** The CPU test board and how long a rule must stay alive on it. */
export const TEST_BOARD = { w: 48, h: 48, steps: 60 };
/** Below this share of live cells the board is dead; above the other, full. */
export const DEAD_SHARE = 0.003;
export const FULL_SHARE = 0.85;

export type GridFate = 'alive' | 'died' | 'filled' | 'frozen';

/**
 * What happens to a rule on the CPU test board within `steps`: it stays alive, dies out (fewer
 * than 0.3% of cells on), fills (more than 85%) or freezes (nothing changes between two steps,
 * Count and Stages only, after the first few). The board is dealt as the node's Start would.
 */
export function gridFate(params: P, o: { seed?: number; w?: number; h?: number; steps?: number } = {}): { fate: GridFate; step: number; share: number } {
  const w = o.w ?? TEST_BOARD.w, h = o.h ?? TEST_BOARD.h, steps = o.steps ?? TEST_BOARD.steps;
  const full = { ...GRID_DEFAULTS, ...params };
  const s = gridShape(full);
  const rng = makeRng(o.seed ?? 1);
  let B = cpuSeed(full, w, h, rng.next);
  const n = w * h;
  const share = () => {
    if (s.type === 'smooth') { let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, s.template === 'reaction' ? B.b[i] : Math.abs(B.a[i])); return m; }
    let k = 0; for (let i = 0; i < n; i++) if (Math.round(B.a[i]) !== 0) k++;
    return k / n;
  };
  let last = share();
  for (let step = 1; step <= steps; step++) {
    const prev = B.a;
    B = cpuStep(full, B);
    last = share();
    if (s.type === 'smooth') {
      if (s.template === 'reaction' && last < 0.05) return { fate: 'died', step, share: last };
      continue;
    }
    if (last < DEAD_SHARE) return { fate: 'died', step, share: last };
    if (last > FULL_SHARE) return { fate: 'filled', step, share: last };
    if ((s.type === 'count' || s.type === 'stages') && step > 8) {
      let same = true;
      for (let i = 0; i < n && same; i++) if (Math.round(prev[i]) !== Math.round(B.a[i])) same = false;
      if (same) return { fate: 'frozen', step, share: last };
    }
  }
  return { fate: 'alive', step: steps, share: last };
}

const set = (counts: Iterable<number>) => maskOf([...new Set(counts)].sort((a, b) => a - b));
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/** A Count rule from one of the alive families. */
function countRule(rng: Rng): P {
  const family = rng.weighted<string>([['life', 6], ['highlife', 3], ['coral', 2], ['blobs', 2], ['sparks', 1], ['vonNeumann', 1], ['ltl', 2]]);
  if (family === 'ltl') {
    const radius = rng.int(2, 5), shape = rng.pick(['box', 'circle'] as const);
    const max = maxCount('radius', radius, shape);
    const f = (x: number) => Math.max(1, Math.round(x * max));
    const b0 = rng.float(0.25, 0.31), b1 = b0 + rng.float(0.06, 0.12), s0 = rng.float(0.24, 0.3), s1 = s0 + rng.float(0.15, 0.25);
    return { neighbourhood: 'radius', radius, shape, bornLo: f(b0), bornHi: f(b1), surviveLo: f(s0), surviveHi: f(s1) };
  }
  if (family === 'vonNeumann') {
    return { neighbourhood: 'vonNeumann', bornMask: set(rng.chance(0.6) ? [1] : [1, 3]), surviveMask: set(rng.sample([0, 1, 2, 3, 4], rng.int(2, 4))) };
  }
  const born = new Set<number>(), survive = new Set<number>();
  if (family === 'life' || family === 'highlife') {
    born.add(3);
    if (family === 'highlife') born.add(rng.pick([6, 6, 7, 8]));
    for (const k of [5, 6, 7, 8]) if (rng.chance(0.08)) born.add(k);
    survive.add(2); survive.add(3);
    for (const k of range(0, 8)) if (rng.chance(0.15)) { if (survive.has(k)) survive.delete(k); else survive.add(k); }
    if (!survive.has(2) && !survive.has(3)) survive.add(rng.pick([2, 3]));
  } else if (family === 'coral') {
    born.add(3);
    const a = rng.int(1, 4), b = rng.int(Math.max(a + 1, 4), 8);
    for (const k of range(a, b)) survive.add(k);
  } else if (family === 'blobs') {
    born.add(rng.pick([3, 4])); for (const k of [5, 6, 7, 8]) if (rng.chance(0.75)) born.add(k);
    for (const k of [5, 6, 7, 8]) if (rng.chance(0.8)) survive.add(k);
    if (rng.chance(0.5)) survive.add(rng.pick([3, 4]));
  } else {
    // Sparks: born on 2, survive on a few counts (Seeds and its tamer cousins).
    born.add(2); if (rng.chance(0.3)) born.add(rng.pick([7, 8]));
    for (const k of rng.sample([0, 1, 3, 4, 5], rng.int(0, 2))) survive.add(k);
  }
  return { neighbourhood: 'moore', bornMask: set(born), surviveMask: set(survive) };
}

/** A Stages rule: a Generations preset with its counts and states nudged. */
function stagesRule(rng: Rng): P {
  const pr = rng.pick(Object.values(STAGES_PRESETS));
  const p = { ...pr.params };
  const flip = (mask: number, p0: number, lo = 1) => { let m = mask; for (let k = lo; k <= 8; k++) if (rng.chance(p0)) m ^= 1 << k; return m; };
  p.bornMask = flip(Number(p.bornMask), 0.08, 2) || maskOf([2]);
  p.surviveMask = flip(Number(p.surviveMask), 0.12);
  p.states = Math.max(3, Math.min(16, Number(p.states) + rng.int(-1, 4)));
  return p;
}

const SMOOTH_SPOTS = [SMOOTH_PRESETS.mitosis, SMOOTH_PRESETS.coralRd, SMOOTH_PRESETS.worms, SMOOTH_PRESETS.spots, SMOOTH_PRESETS.maze];

/** A Smooth rule: a template with its numbers jittered round known-good values. */
function smoothRule(rng: Rng): P {
  const t = rng.weighted<string>([['reaction', 5], ['diffusion', 2], ['waves', 2]]);
  if (t === 'reaction') {
    const pr = rng.pick(SMOOTH_SPOTS);
    return { ...presetPatch(pr), feed: Number(pr.params.feed) + rng.float(-0.002, 0.002), kill: Number(pr.params.kill) + rng.float(-0.0012, 0.0012), diffB: rng.float(0.45, 0.55) };
  }
  if (t === 'diffusion') return { ...presetPatch(SMOOTH_PRESETS.heat), spread: rng.float(0.6, 1), decay: rng.logFloat(0.001, 0.01) };
  return { ...presetPatch(SMOOTH_PRESETS.ripples), waveSpeed: rng.float(0.6, 1), damping: rng.float(0.985, 0.999) };
}

/** Patterns: a preset with its density and (Crystal) count varied. */
function patternsRule(rng: Rng): P {
  const key = rng.pick(Object.keys(PATTERN_PRESETS));
  const p = presetPatch(PATTERN_PRESETS[key]);
  if (key === 'crystal') {
    const rules = structuredClone(p.patterns as PatternRule[]);
    rules[0].count = { state: 1, min: 1, max: rng.pick([1, 1, 2]) };
    return { ...p, patterns: rules, start: 'centre', density: rng.float(0.05, 0.2) };
  }
  return { ...p, start: 'noise', density: key === 'wireworld' ? rng.float(0.2, 0.45) : rng.float(0.1, 0.35) };
}

/** Blocks: a preset with its density and chances varied. */
function blocksRule(rng: Rng): P {
  const key = rng.pick(Object.keys(BLOCK_PRESETS));
  const p = presetPatch(BLOCK_PRESETS[key]);
  const rules = structuredClone(p.blocks as BlockRule[]).map(r => (r.chance < 1 || rng.chance(0.3) ? { ...r, chance: Math.round(rng.float(0.5, 1) * 100) / 100 } : r));
  return { ...p, blocks: rules, start: 'noise', density: key === 'gas' ? rng.float(0.08, 0.35) : rng.float(0.2, 0.5) };
}

const r3 = (c: number[]) => c.map(v => Math.round(v * 1000) / 1000);

/** Colours for a rule type: a dark ground and colours that go together. */
function colours(type: GridRuleType, rng: Rng): P {
  if (type === 'smooth') {
    const ramp = rampPalette(rng, 4);
    const out = rng.chance(0.3) ? [...ramp].reverse() : ramp;
    return Object.fromEntries(out.map((c, i) => [`color${i}`, r3(c)]));
  }
  const pal = harmoniousPalette(rng, 7, { light: [0.5, 0.75] });
  const out: P = { color0: r3(darkBackground(rng)) };
  pal.forEach((c, i) => { out[`color${i + 1}`] = r3(c); });
  if (type === 'count') {
    out.color1 = r3(hslToRgb(rng.next(), rng.float(0.2, 0.6), rng.float(0.75, 0.92)));
    out.glowColor = r3(pal[1]).map(v => Math.round(v * 0.6 * 1000) / 1000);
    out.oldColor = r3(pal[2]);
    out.afterglow = rng.chance(0.6) ? Math.round(rng.float(0.6, 0.95) * 100) / 100 : 0;
    out.ageFade = rng.chance(0.4) ? 1 : 0;
  }
  return out;
}

export interface GridSurprise {
  /** The params to merge over the node's. */
  patch: P;
  type: GridRuleType;
  /** One line: "Count B36/S23". */
  summary: string;
}

/** One candidate (no checking): the rule, its start and its colours. */
export function gridCandidate(rng: Rng, type?: GridRuleType): GridSurprise {
  const t = type ?? rng.weighted<GridRuleType>([['count', 5], ['stages', 2], ['smooth', 2], ['patterns', 1], ['blocks', 1]]);
  let rule: P;
  if (t === 'count') rule = { ...presetPatch(COUNT_PRESETS.life), ...LOOKS.count, ...countRule(rng), brushState: 1 };
  else if (t === 'stages') rule = stagesRule(rng);
  else if (t === 'smooth') rule = smoothRule(rng);
  else if (t === 'patterns') rule = patternsRule(rng);
  else rule = blocksRule(rng);
  const start: P = t === 'count' || t === 'stages'
    ? { start: rng.chance(0.85) ? 'noise' : 'centre', density: Math.round(rng.float(0.15, 0.5) * 100) / 100 }
    : t === 'smooth' ? { start: rng.chance(0.75) ? 'noise' : 'centre', density: Math.round(rng.float(0.2, 0.6) * 100) / 100 } : {};
  const patch: P = { ruleType: t, ...rule, ...start, ...colours(t, rng.fork('colours')), seed: rng.int(1, 99), reset: 0 };
  if (patch.start === 'centre' && (t === 'count' || t === 'stages')) patch.density = Math.max(Number(patch.density), 0.4);
  return { patch, type: t, summary: ruleSummary({ ...GRID_DEFAULTS, ...patch }) };
}

/**
 * Surprise me: candidates from `seed` (then derived seeds) until one stays alive on the CPU test
 * board, at most `tries`. Falls back to Conway's Life (always alive on the board) with the last
 * candidate's start and colours, so it never returns a rule that dies or fills.
 */
export function surpriseGrid(seed: number, o: { type?: GridRuleType; tries?: number } = {}): SurpriseResult<GridSurprise> {
  const tries = o.tries ?? 40;
  const rejected: SurpriseResult<GridSurprise>['rejected'] = [];
  let last: GridSurprise | null = null;
  for (let i = 0; i < tries; i++) {
    const s = deriveSeed(normaliseSeed(seed), i);
    const cand = gridCandidate(makeRng(s), o.type);
    last = cand;
    const f = gridFate(cand.patch, { seed: s });
    if (f.fate === 'alive') return { value: cand, seed: s, tries: i + 1, rejected, ok: true };
    rejected.push({ seed: s, why: `${cand.summary}: ${f.fate} at step ${f.step}` });
  }
  const life: GridSurprise = { ...last!, patch: { ...last!.patch, ruleType: 'count', ...COUNT_PRESETS.life.params, start: 'noise', density: 0.3 }, type: 'count' };
  life.summary = ruleSummary({ ...GRID_DEFAULTS, ...life.patch });
  return { value: life, seed: normaliseSeed(seed), tries, rejected, ok: false };
}
