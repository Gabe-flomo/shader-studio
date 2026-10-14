/**
 * Built-in compound effects (store/compoundEffects.ts): each places as a group, wires colour in and
 * out, and the whole graph compiles (the group is opened before the passes are cut).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { useNodeGraphStore } from '../useNodeGraphStore';
import { COMPOUND_EFFECTS, compoundSubgraph } from '../compoundEffects';
import { compileGraph } from '../../compiler/graphCompiler';
import type { CompilationResult } from '../../compiler/types';

const st = () => useNodeGraphStore.getState();
beforeEach(() => { st().replaceGraph([]); });

describe('built-in compound effects', () => {
  it('there are five, each with a description', () => {
    expect(COMPOUND_EFFECTS.map(c => c.label)).toEqual(['Long exposure', 'Trails where it moves', 'Datamosh', 'Kaleidoscope feedback', 'Ripples (waves)']);
    for (const c of COMPOUND_EFFECTS) expect(c.description.length).toBeGreaterThan(40);
  });

  for (const c of COMPOUND_EFFECTS) {
    it(`${c.label}: places as a group and the graph compiles`, () => {
      const pic = st().addNode('colorPicker', { x: 0, y: 0 })!;
      const out = st().addNode('output', { x: 900, y: 0 })!;
      const g = st().placeSubgraphAsGroup(c.label, compoundSubgraph(c), { x: 400, y: 0 }, c.description)!;
      expect(g).toBeTruthy();
      const group = st().nodes.find(x => x.id === g)!;
      if (group.inputs.c) expect(st().connectNodes(pic, 'rgb', g, 'c')).not.toBe(false);
      expect(st().connectNodes(g, 'o', out, 'color')).not.toBe(false);
      const r = compileGraph({ nodes: st().nodes }) as CompilationResult;
      expect(r.errors ?? []).toEqual([]);
      expect(r.success).toBe(true);
      expect((r.passes ?? []).length).toBeGreaterThan(0);
    });
  }
});
