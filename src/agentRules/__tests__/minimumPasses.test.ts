/**
 * Agent Rules templates build no Pass nodes: the trail and the agents' state live in the Agents
 * group and its Trail Field (the simulation's own feedback), and the picture after is per pixel.
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
import { RULES_TEMPLATES, rulesTemplateNodes } from '../templates';

describe('Agent Rules: the fewest Passes', () => {
  for (const t of RULES_TEMPLATES) it(t.key, () => {
    expect(passes(rulesTemplateNodes(t.key, 'a', 0, 0, true))).toHaveLength(0);
  });
});
