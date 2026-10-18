/**
 * The Grid builder builds a Pass only for the rules' memory (it reads its own last frame, at one
 * texel a cell): never for the look, which is all per pixel.
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
import { GRID_TEMPLATES } from '../templates';
import { buildStandaloneGrid } from '../build';

describe('Grid builder: the fewest Passes', () => {
  for (const t of GRID_TEMPLATES) it(t.key, () => {
    for (const p of passes(buildStandaloneGrid(t.make()).nodes)) expect(p.params._gsRole).toBe('memory');
    expect(passes(buildStandaloneGrid(t.make()).nodes).length).toBeLessThanOrEqual(1);
  });
});
