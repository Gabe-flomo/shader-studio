/**
 * Golden outputs (implementation guide, phase 0): every example's Play
 * record, and a set of setups that cover each source kind and feature, run
 * through the engine on one script of inputs (goldenHarness.ts). The
 * snapshots are the engine's behaviour today; a refactor must leave them
 * unchanged. If one changes on purpose, update it with `vitest -u` and say why
 * in the commit.
 */
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { EXAMPLE_GRAPHS } from '../../../store/exampleGraphs';
import { goldenRun } from './goldenHarness';
import { GOLDEN_FIXTURES } from './goldenFixtures';
import { normalizeRules } from '../../rules';
import type { PlayRecord } from '../../../types/play';
import type { GraphNode } from '../../../types/nodeGraph';

const examples = Object.entries(EXAMPLE_GRAPHS).filter(([, g]) => (g as { play?: PlayRecord }).play?.controls.length);

describe('golden outputs: examples', () => {
  it('has examples with Play setups to run', () => expect(examples.length).toBeGreaterThan(20));
  for (const [key, g] of examples) {
    it(key, () => {
      const graph = g as unknown as { play: PlayRecord; nodes?: GraphNode[] };
      expect(goldenRun(graph.play, graph.nodes ?? [])).toMatchSnapshot();
    });
  }
});

describe('golden outputs: fixtures', () => {
  for (const [name, rec] of Object.entries(GOLDEN_FIXTURES)) {
    it(name, () => expect(goldenRun(rec)).toMatchSnapshot());
  }
});

/**
 * Rules (implementation guide, phase 2): every example and fixture, its
 * actions, signal definitions and links turned into rules (play/rules.ts),
 * plays exactly as it did.
 */
describe('golden outputs: the same setups as rules', () => {
  const all: Array<[string, PlayRecord, GraphNode[]]> = [
    ...examples.map(([k, g]) => [k, (g as unknown as { play: PlayRecord }).play, (g as unknown as { nodes?: GraphNode[] }).nodes ?? []] as [string, PlayRecord, GraphNode[]]),
    ...Object.entries(GOLDEN_FIXTURES).map(([k, r]) => [k, r, []] as [string, PlayRecord, GraphNode[]]),
  ];
  for (const [key, play, nodes] of all) {
    const rules = normalizeRules(play);
    it(key, () => expect(goldenRun(rules, nodes)).toEqual(goldenRun(play, nodes)));
  }
  it('normalising is idempotent', () => {
    for (const [, play] of all) { const once = normalizeRules(play); expect(normalizeRules(once)).toEqual(once); }
  });
});
