/**
 * Grid Rules' Surprise me (docs/surprise.md): repeatable by seed; never a rule that dies, fills or
 * freezes on the CPU test board within N steps; every rule type turns up and compiles.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { makeRng } from '../../lib/surprise';
import { n } from '../../store/graphBuilder';
import { COUNT_PRESETS, maskOf } from '../spec';
import { gridCandidate, gridFate, surpriseGrid, TEST_BOARD } from '../surprise';

const SEEDS = Array.from({ length: 24 }, (_, i) => 17 + i * 104729);
/** The CPU board runs take a few seconds; more under a loaded machine. */
const SLOW = 60_000;

describe('Grid Rules Surprise me', () => {
  it('the same seed gives the same rule', () => {
    expect(surpriseGrid(4242)).toEqual(surpriseGrid(4242));
    expect(surpriseGrid(4242).value.patch).not.toEqual(surpriseGrid(4243).value.patch);
  });

  it('gridFate tells a dying, a filling and a living rule apart', () => {
    expect(gridFate({ ruleType: 'count', neighbourhood: 'moore', bornMask: maskOf([8]), surviveMask: 0, start: 'noise', density: 0.3 }).fate).toBe('died');
    expect(gridFate({ ruleType: 'count', neighbourhood: 'moore', bornMask: maskOf([1, 2, 3, 4, 5, 6, 7, 8]), surviveMask: maskOf([0, 1, 2, 3, 4, 5, 6, 7, 8]), start: 'noise', density: 0.3 }).fate).toBe('filled');
    expect(gridFate({ ruleType: 'count', ...COUNT_PRESETS.life.params, start: 'noise', density: 0.3 }).fate).toBe('alive');
  });

  it(`never returns a Count or Stages rule that dies, fills or freezes within ${TEST_BOARD.steps} steps`, () => {
    for (const type of ['count', 'stages'] as const) for (const seed of SEEDS) {
      const r = surpriseGrid(seed, { type });
      expect(r.value.type).toBe(type);
      const f = gridFate(r.value.patch, { seed: r.seed });
      expect(f.fate, `${type} seed ${seed}: ${r.value.summary}`).toBe('alive');
    }
  }, SLOW);

  it('with any type: alive on the test board, and every type turns up', () => {
    const types = new Set<string>();
    for (const seed of SEEDS) {
      const r = surpriseGrid(seed);
      types.add(r.value.type);
      expect(gridFate(r.value.patch, { seed: r.seed }).fate, `seed ${seed}: ${r.value.summary}`).toBe('alive');
    }
    expect(types.size).toBeGreaterThanOrEqual(3);
    expect(new Set(Array.from({ length: 80 }, (_, i) => gridCandidate(makeRng(i + 1)).type))).toEqual(new Set(['count', 'stages', 'smooth', 'patterns', 'blocks']));
  }, SLOW);

  it('turns down candidates that die or fill, so the alive families win most of the time', () => {
    let firstTry = 0;
    for (const seed of SEEDS) if (surpriseGrid(seed, { type: 'count' }).tries === 1) firstTry++;
    expect(firstTry / SEEDS.length).toBeGreaterThan(0.3);
    // The raw candidates do include rules that die or fill: the check is doing something.
    const fates = SEEDS.map(s => gridFate(gridCandidate(makeRng(s), 'count').patch, { seed: s }).fate);
    expect(fates.some(f => f !== 'alive')).toBe(true);
  }, SLOW);

  it('every surprise compiles as a Grid Rules node', () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const r = surpriseGrid(seed);
      const res = compileGraph({ nodes: [n('gridRules', 'node_3', 0, 0, { label: 'T', ...r.value.patch }), n('output', 'node_9', 0, 0, {}, { color: ['node_3', 'color'] })] });
      expect(res.errors, `seed ${seed}: ${r.value.summary}`).toBeUndefined();
      expect(res.success).toBe(true);
    }
  }, SLOW);
});
