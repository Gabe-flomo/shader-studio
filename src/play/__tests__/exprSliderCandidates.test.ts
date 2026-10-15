/** Expression Block sliders are Play controls and quick-map targets (playControls.ts collectExprSliderCandidates). */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { candidateFor, collectPlayCandidates } from '../playControls';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildMemoryExamples } from '../../store/memoryExamples';
import type { GraphNode } from '../../types/nodeGraph';

describe('Expression Block sliders as Play controls', () => {
  it('a slider input is a candidate (and a wired one is not)', () => {
    const nodes = buildMemoryExamples().memFollow.nodes.map(n => (n.id === 'look'
      ? { ...n, params: { ...n.params, inputs: [...(n.params.inputs as object[]), { name: 'glowAmt', type: 'float', slider: { min: 0, max: 2 } }], glowAmt: 0.7, result: 'vec3(glowAmt)', expr: 'vec3(glowAmt)' } }
      : n)) as GraphNode[];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const c = candidateFor(collectPlayCandidates(nodes, r.paramBindings), 'look', 'glowAmt');
    expect(c).toMatchObject({ kind: 'float', min: 0, max: 2, value: 0.7, paramLabel: 'glowAmt' });
    expect(candidateFor(collectPlayCandidates(nodes, r.paramBindings), 'look', 'vy')).toBeUndefined();
  });
});
