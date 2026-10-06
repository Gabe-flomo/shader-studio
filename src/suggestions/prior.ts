/**
 * prior.ts — the bundled examples as a small prior for the suggestions (docs/suggestions.md).
 *
 * Built at build time (examplePrior.json; regenerate with
 * `WRITE_PRIOR=1 npx vitest run src/suggestions/__tests__/examplePrior.test.ts`), so the app never
 * loads the examples chunk to rank a suggestion. Each example counts a pair once, and examples
 * whose wiring is the same shape (the many tiny circle → glow templates) share one example's
 * weight between them, so they don't dominate.
 */
import { graphPairs, pairSignature } from './usage';

export interface PriorTable {
  v: 1;
  /** How many examples went in. */
  examples: number;
  /** Pair → weight (an example is worth 1, shared among identical templates). */
  pairs: Record<string, number>;
}

export function buildPrior(graphs: Array<{ nodes: unknown }>): PriorTable {
  const perGraph = graphs.map(g => graphPairs(g.nodes)).filter(p => p.size > 0);
  const shapeCount = new Map<string, number>();
  const sigs = perGraph.map(p => pairSignature(p));
  for (const s of sigs) shapeCount.set(s, (shapeCount.get(s) ?? 0) + 1);
  const pairs: Record<string, number> = {};
  perGraph.forEach((p, i) => {
    const w = 1 / (shapeCount.get(sigs[i]) ?? 1);
    for (const pair of p) pairs[pair] = (pairs[pair] ?? 0) + w;
  });
  // Rounded, and the faintest dropped: the table ships in the app.
  const kept: Record<string, number> = {};
  for (const k of Object.keys(pairs).sort()) {
    const v = Math.round(pairs[k] * 100) / 100;
    if (v >= 0.2) kept[k] = v;
  }
  return { v: 1, examples: perGraph.length, pairs: kept };
}
