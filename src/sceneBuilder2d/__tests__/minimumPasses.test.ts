/**
 * The 2D Scene Builder builds a Pass only where something reads round a pixel: the Look's older
 * Bloom, and each read on the Effects page (blur, glow, rays, chroma, displace by a picture).
 * Moves bend the scene's coordinates and CRT mask works on the colour (fewerPasses.test.ts).
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
import { buildStandalone2D } from '../build';
import { TEMPLATES_2D, GRID_TEMPLATES_2D, templateScene } from '../templates';
import { fxClass } from '../../builders/look/effects';

describe('2D Scene Builder: the fewest Passes', () => {
  for (const t of [...TEMPLATES_2D, ...GRID_TEMPLATES_2D]) it(t.key, () => {
    const s = templateScene(t.key);
    const reads = (s.effects ?? []).filter(it => it.on && fxClass(it) === 'read').length;
    expect(passes(buildStandalone2D(s).nodes)).toHaveLength((s.look.post.bloom > 0 ? 1 : 0) + reads);
  });
});
