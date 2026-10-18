/**
 * The Splat builder builds a Pass only for its Bloom (Glow (texture) reads round each pixel).
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
import { SPLAT_TEMPLATES } from '../templates';
import { buildSplatStandalone } from '../build';

describe('Splat builder: the fewest Passes', () => {
  for (const t of SPLAT_TEMPLATES) it(t.key, () => {
    const spec = t.make();
    expect(passes(buildSplatStandalone(spec).nodes)).toHaveLength(spec.look.bloom.on ? 1 : 0);
  });
});
