/**
 * surprise.ts — "Surprise me" (docs/expression-builder-plan.md §4.5, phase 3): a random chain of 2–5
 * moves for where the chain is, drawn from the ranked candidates (weighted by their chance of
 * coming next: the order statistics, the context, the chain's name), skipping anything the dull
 * filter would hide. A seeded RNG, so the same seed gives the same chain. The steps are ordinary
 * steps: undo takes them back, and each stays editable. Pure.
 */
import { nextMoves, tileSteps, type Chain, type ChainStep, type Tile } from './chain';
import { chainSamples, judgeSteps } from './dull';
import type { Catalogue } from './moves';

/** A small seeded RNG (mulberry32): the same seed gives the same numbers. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SurpriseOptions {
  seed: number;
  /** Where to grow from (default: the end). The steps after it are replaced. */
  at?: number;
  minSteps?: number;
  maxSteps?: number;
  /** Draw from this many of the best candidates at each step. */
  top?: number;
}

/** A candidate's weight: its chance of coming next (scores are log-chances), flattened a little so it isn't always the first. */
const weightOf = (t: Tile) => Math.exp(t.score * 0.7);

/**
 * The steps of a random chain from `at` (2–5 of them, fewer only when nothing that isn't dull is
 * left to pick). Every step is a catalogue move that type-checks on what it follows, at its usual
 * values.
 */
export function surpriseSteps(chain: Chain, cat: Catalogue, opts: SurpriseOptions): ChainStep[] {
  const rnd = seededRandom(opts.seed);
  const min = opts.minSteps ?? 2, max = opts.maxSteps ?? 5, top = opts.top ?? 24;
  const want = min + Math.floor(rnd() * (max - min + 1));
  let c: Chain = { seed: chain.seed, steps: chain.steps.slice(0, opts.at ?? chain.steps.length) };
  const added: ChainStep[] = [];
  let lastTemplate = c.steps[c.steps.length - 1]?.template ?? null;
  while (added.length < want) {
    const g = nextMoves(c, cat);
    // Steps of either kind (a recipe is several moves at once; Surprise me builds them one by one).
    const pool = [...g.same, ...g.changing].sort((a, b) => b.score - a.score).slice(0, top);
    const samples = chainSamples(c, c.steps.length);
    let picked: ChainStep[] | null = null;
    const left = pool.slice();
    while (left.length && !picked) {
      const ws = left.map(t => weightOf(t) * (t.template === lastTemplate ? 0.15 : 1));
      const total = ws.reduce((s, w) => s + w, 0);
      let r = rnd() * total, i = 0;
      while (i < ws.length - 1 && r >= ws[i]) { r -= ws[i]; i++; }
      const [tile] = left.splice(i, 1);
      const steps = tileSteps(tile, cat);
      const v = judgeSteps(samples, steps);
      // Only moves seen to show something: not dull, and the CPU could check it.
      if (v.evaluated && !v.dull) picked = steps;
    }
    if (!picked) break;
    added.push(...picked);
    lastTemplate = picked[picked.length - 1].template;
    c = { ...c, steps: [...c.steps, ...picked] };
  }
  return added;
}
