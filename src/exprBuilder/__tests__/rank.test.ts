/**
 * Ranking by what usually comes next (docs/expression-builder-plan.md §4.1, phase 3).
 *
 *  - The scorer backs off from specific to general context: the order statistics after the last
 *    move in this dimension and feed, then in this dimension, then anywhere, then after its family,
 *    then the base (uses, by how well their contexts match).
 *  - Held-out evaluation: the examples split five ways; each fifth's chains are rebuilt from a
 *    catalogue mined from the other four, and the real next move is looked for in the ranked
 *    candidates. It should rank well above chance (and above phase 2's simple order).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import raw from '../prebuilt/moves.json?raw';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { getNodeDefinition } from '../../nodes/definitions';
import { exampleMoveDocs } from '../exampleMoves';
import { buildCatalogue, movesFor, type Catalogue, type Move, type MoveDoc, type Seed } from '../moves';
import { unpackCatalogue, type PackedCatalogue } from '../pack';
import { rankByContext, rankIndex, scoreMoves, type RankContext } from '../rank';
import { candidatePool, nextMoves, simpleRank, UV_SEED, WORLD_SEED, type Ranker } from '../chain';

let cat: Catalogue;
beforeAll(() => { cat = unpackCatalogue(JSON.parse(raw) as PackedCatalogue); });

describe('the scorer', () => {
  it('puts what followed the last move first, by context, and backs off when there is none', () => {
    // fract(x * #a) on UV: what follows it in the examples?
    const fract = cat.moves.find(m => m.template === 'fract(x)' && m.sig.in === 'vec2' && m.step)!;
    expect(fract).toBeTruthy();
    const pool = movesFor({ type: 'vec2', dimension: '2d', role: 'space' }, cat);
    const ix = rankIndex(cat);
    const seen = ix.fd.get(`${fract.id}|2d`)!;
    expect(seen.size).toBeGreaterThan(0);
    const ranked = rankByContext(pool, { dimension: '2d', feeds: ['uv'], prev: fract.id, prevFamily: 'repeat' }, cat);
    // The most frequent follow-up in the pool is near the top.
    const top = [...seen.entries()].filter(([id]) => pool.some(m => m.id === id)).sort((a, b) => b[1] - a[1])[0][0];
    expect(ranked.findIndex(s => s.move.id === top)).toBeLessThan(3);
    // With no previous move, the base alone: the most used moves in a matching context lead.
    const base = rankByContext(pool, { dimension: '2d', feeds: ['uv'] }, cat);
    expect(base[0].move.count).toBeGreaterThan(5);
    // An unknown previous move backs off to its family.
    const fam = rankByContext(pool, { dimension: '2d', prev: 'no-such-move', prevFamily: 'repeat' }, cat);
    const famTop = [...(ix.famd.get('repeat|2d') ?? new Map()).entries()].filter(([id]) => pool.some(m => m.id === id)).sort((a, b) => b[1] - a[1])[0][0];
    expect(fam.findIndex(s => s.move.id === famTop)).toBeLessThan(5);
  });

  it('weights contexts: a 3D world seed gets moves seen in 3D first, a UV seed moves seen in 2D', () => {
    const world = nextMoves({ seed: WORLD_SEED, steps: [] }, cat);
    const top = world.same.slice(0, 12).map(t => t.move);
    const in3d = top.filter(m => m.generated || m.contexts.some(c => c.dim === '3d-world')).length;
    expect(in3d).toBeGreaterThanOrEqual(10);
    const uv = nextMoves({ seed: UV_SEED, steps: [] }, cat);
    expect(uv.same.slice(0, 12).every(t => t.move.generated || t.move.contexts.some(c => c.dim === '2d'))).toBe(true);
  });

  it('boosts are factors on the chance (a finishing move rises, nothing else moves)', () => {
    const pool = movesFor({ type: 'vec2', dimension: '2d', role: 'space' }, cat);
    const ctx: RankContext = { dimension: '2d', feeds: ['uv'] };
    const plain = scoreMoves(pool, ctx, cat);
    const target = pool[pool.length - 1];
    const boosted = scoreMoves(pool, { ...ctx, boost: new Map([[target.id, 4]]) }, cat);
    plain.forEach((s, i) => expect(boosted[i].score - s.score).toBeCloseTo(s.move.id === target.id ? Math.log(4) : 0, 9));
  });

  it('is pure and quick: a step\'s grid ranks in a few milliseconds once the index is built', () => {
    rankIndex(cat);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) nextMoves({ seed: UV_SEED, steps: [] }, cat);
    const ms = (performance.now() - t0) / 10;
    console.log(`[rank] nextMoves from UV (≈${nextMoves({ seed: UV_SEED, steps: [] }, cat).same.length} same-type tiles): ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(60);
  });
});

// ── Held-out evaluation ───────────────────────────────────────────────────────

interface Case { from: Move; to: Move; dim: Seed['dimension']; feed: string; n: number }

/** The candidate list nextMoves would show (steps and generated moves, one tile per template), ranked. */
function candidates(train: Catalogue, c: Case, rank: Ranker): Move[] {
  const role = c.from.sig.outRole !== 'unknown' && c.from.sig.outRole !== 'value' ? c.from.sig.outRole : undefined;
  const pool = candidatePool({ type: c.from.sig.out, dimension: c.dim, ...(role ? { role } : {}) }, train);
  const ctx: RankContext = { dimension: c.dim, role, feeds: [c.feed as never], prev: c.from.id, prevFamily: c.from.family };
  const out: Move[] = [];
  const seen = new Set<string>();
  for (const { move } of rank(pool, ctx, train)) {
    if (!(move.step || move.generated)) continue;
    const k = `${move.sig.in}|${move.template}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(move);
  }
  return out;
}

interface Score { cases: number; ranked: number; top1: number; top5: number; top10: number; mrr: number; chance10: number; pool: number }
const zero = (): Score => ({ cases: 0, ranked: 0, top1: 0, top5: 0, top10: 0, mrr: 0, chance10: 0, pool: 0 });

function evaluate(docs: MoveDoc[], folds: number, rank: Ranker): { all: Score; byDim: Record<string, Score> } {
  const all = zero();
  const byDim: Record<string, Score> = {};
  for (let f = 0; f < folds; f++) {
    const train = buildCatalogue(docs.filter((_, i) => i % folds !== f));
    const held = buildCatalogue(docs.filter((_, i) => i % folds === f), { generated: false });
    const heldById = new Map(held.moves.map(m => [m.id, m]));
    const trainIds = new Set(train.moves.map(m => m.id));
    for (const o of held.order) {
      const from = heldById.get(o.from), to = heldById.get(o.to);
      if (!from || !to) continue;
      const c: Case = { from, to, dim: o.dim, feed: o.feed, n: o.n };
      const s = (byDim[o.dim] ??= zero());
      for (const sc of [all, s]) sc.cases += o.n;
      // A move the other examples never had can't be suggested by them.
      if (!trainIds.has(to.id)) continue;
      const list = candidates(train, c, rank);
      const at = list.findIndex(m => m.template === to.template && m.sig.in === to.sig.in);
      for (const sc of [all, s]) {
        sc.ranked += o.n;
        sc.pool += list.length * o.n;
        sc.chance10 += Math.min(1, 10 / Math.max(1, list.length)) * o.n;
        if (at < 0) continue;
        if (at < 1) sc.top1 += o.n;
        if (at < 5) sc.top5 += o.n;
        if (at < 10) sc.top10 += o.n;
        sc.mrr += o.n / (at + 1);
      }
    }
  }
  return { all, byDim };
}

const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
const line = (name: string, s: Score) =>
  `${name.padEnd(12)} cases ${String(s.cases).padStart(4)}, rankable ${pct(s.ranked, s.cases).padStart(6)} | top-1 ${pct(s.top1, s.ranked).padStart(6)}  top-5 ${pct(s.top5, s.ranked).padStart(6)}  top-10 ${pct(s.top10, s.ranked).padStart(6)}  MRR ${(s.mrr / Math.max(1, s.ranked)).toFixed(3)} | chance top-10 ${pct(s.chance10, s.ranked).padStart(6)}, ~${Math.round(s.pool / Math.max(1, s.ranked))} candidates`;

describe('held-out evaluation (the examples, five folds)', () => {
  it('ranks the real next move well above chance, and above phase 2\'s order', () => {
    const docs = exampleMoveDocs(EXAMPLE_GRAPHS as never, t => getNodeDefinition(t)?.label);
    const ctx = evaluate(docs, 5, rankByContext);
    const simple = evaluate(docs, 5, simpleRank);
    console.log(['[rank] held-out next-move evaluation (occurrence-weighted)',
      line('context', ctx.all), ...Object.entries(ctx.byDim).map(([d, s]) => line(`  ${d}`, s)),
      line('phase 2', simple.all), ...Object.entries(simple.byDim).map(([d, s]) => line(`  ${d}`, s)),
    ].join('\n'));
    const a = ctx.all;
    expect(a.ranked).toBeGreaterThan(200);
    // Most of the time in the top 10, and several times chance.
    expect(a.top10 / a.ranked).toBeGreaterThan(0.5);
    expect(a.top10).toBeGreaterThan(3 * a.chance10);
    // Better than the simple order on every measure.
    expect(a.top1).toBeGreaterThan(simple.all.top1);
    expect(a.top10).toBeGreaterThan(simple.all.top10);
    expect(a.mrr).toBeGreaterThan(simple.all.mrr);
  }, 120000);
});
