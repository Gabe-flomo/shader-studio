/**
 * The 3D Scene Builder builds no Pass nodes: its look (tone map, fog, depth composite) is per pixel,
 * and GI's own passes belong to the GI-lit march group.
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
import { SCENE_TEMPLATES, templateSpec } from '../templates';
import { buildStandaloneGraph } from '../build';

describe('3D Scene Builder: the fewest Passes', () => {
  for (const t of SCENE_TEMPLATES) it(t.key, () => {
    expect(passes(buildStandaloneGraph(templateSpec(t.key)).nodes)).toHaveLength(0);
  });
});
