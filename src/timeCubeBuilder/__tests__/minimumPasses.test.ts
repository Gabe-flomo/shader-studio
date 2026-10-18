/**
 * Time Cube presets build no Pass nodes: the frame history is the Time Cube node's own.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import type { GraphNode } from '../../types/nodeGraph';

/** The Pass nodes of a graph, groups' insides included. */
const passes = (nodes: readonly GraphNode[]): GraphNode[] => nodes.flatMap(n => [
  ...(n.type === 'pass' ? [n] : []),
  ...passes(((n.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes) ?? []),
]);
import { TC_PRESETS, presetSpec } from '../presets';
import { applyTimeCube } from '../apply';

describe('Time Cube builder: the fewest Passes', () => {
  for (const t of TC_PRESETS) it(t.key, () => {
    let id = 0;
    expect(passes(applyTimeCube([], presetSpec(t.key), { nextId: () => `n${++id}` }).nodes)).toHaveLength(0);
  });
});
