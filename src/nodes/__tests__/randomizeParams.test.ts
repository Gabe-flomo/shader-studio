import { describe, expect, it } from 'vitest';
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { DEFAULT_RANDOMIZE_OPTIONS } from '../randomizeOptions';
import { randomizableParams, randomizedGraph, randomizedParams } from '../randomizeParams';

const FULL = { ...DEFAULT_RANDOMIZE_OPTIONS, strength: 1 };

const def = {
  paramDefs: {
    radius: { label: 'Radius', type: 'float', min: 0.01, max: 2, step: 0.01 },
    free:   { label: 'Free', type: 'float', step: 0.01 },
    count:  { label: 'Count', type: 'int', min: 1, max: 8, step: 1 },
    wired:  { label: 'Wired', type: 'float', min: 0, max: 1 },
    kf:     { label: 'Kf', type: 'float', min: 0, max: 1 },
    col:    { label: 'Col', type: 'vec3color' },
    mode:   { label: 'Mode', type: 'select', options: [] },
  },
} as unknown as NodeDefinition;

const node = (params: Record<string, unknown> = {}): GraphNode => ({
  id: 'n', type: 't', position: { x: 0, y: 0 }, outputs: {},
  inputs: { wired: { type: 'float', label: 'Wired', connection: { nodeId: 'x', outputKey: 'y' } } },
  params: { __keyframes_kf: [{ t: 0, v: 0 }, { t: 1, v: 1 }], ...params },
});

describe('randomizedParams', () => {
  it('uses the interesting range inside the slider range, −1…1 when none is declared, and skips wired / keyframed / select', () => {
    const lo = randomizedParams(node(), def, () => 0, FULL);
    const hi = randomizedParams(node(), def, () => 0.999999, FULL);
    // Radius 0.01–2 lands in 0.12–0.7 (lib/surprise ranges), Count 1–8 in 3–8.
    expect(lo.radius).toBe(0.12); expect(hi.radius).toBe(0.7);
    expect(lo.free).toBe(-1); expect(hi.free).toBe(1);
    expect(lo.count).toBe(3); expect(hi.count).toBe(8);
    // A colour is a pleasant one, not three random channels.
    const col = lo.col as number[];
    expect(Math.max(...col) - Math.min(...col)).toBeGreaterThan(0.2);
    expect(Object.keys(lo).sort()).toEqual(['col', 'count', 'free', 'radius']);
  });

  it('stays inside the slider range for any draw, and never touches bit masks', () => {
    const masks = { paramDefs: { ...def.paramDefs, bornMask: { label: 'Born', type: 'float', min: 0, max: 511 } } } as unknown as NodeDefinition;
    for (let i = 0; i < 200; i++) {
      const p = randomizedParams(node(), masks, Math.random, FULL);
      expect(p.radius as number).toBeGreaterThanOrEqual(0.01); expect(p.radius as number).toBeLessThanOrEqual(2);
      expect('bornMask' in p).toBe(false);
    }
  });

  it('follows a typed max and the both-ways setting', () => {
    expect(randomizedParams(node({ __scMax_radius: 3 }), def, () => 0.999999, FULL).radius).toBe(3);
    expect(randomizedParams(node({ __scMax_radius: 3, __scBidir_radius: true }), def, () => 0, FULL).radius).toBe(-3);
  });

  it('keeps whole-number sliders whole', () => {
    for (let i = 0; i < 20; i++) expect(Number.isInteger(randomizedParams(node(), def, Math.random, FULL).count)).toBe(true);
  });

  it('leaves excluded sliders alone but still lists them', () => {
    const n = node({ __randExclude: ['radius', 'count'] });
    expect(Object.keys(randomizedParams(n, def, Math.random, FULL)).sort()).toEqual(['col', 'free']);
    expect(randomizableParams(n, def).map(p => p.key).sort()).toEqual(['col', 'count', 'free', 'radius']);
  });

  it('randomizes a whole graph level from a seed, repeatably', () => {
    const nodes: GraphNode[] = [{ id: 'a', type: 'fbm', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} }];
    const a = randomizedGraph(nodes, 99, FULL), b = randomizedGraph(nodes, 99, FULL), c = randomizedGraph(nodes, 100, FULL);
    expect(a).toEqual(b);
    expect(a.changed).toBeGreaterThan(0);
    expect(c.nodes).not.toEqual(a.nodes);
  });
});
