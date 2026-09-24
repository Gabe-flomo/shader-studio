import { describe, expect, it } from 'vitest';
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { randomizedParams } from '../randomizeParams';

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
  it('uses the slider range, −1…1 when none is declared, and skips wired / keyframed / select', () => {
    const lo = randomizedParams(node(), def, () => 0);
    const hi = randomizedParams(node(), def, () => 0.999999);
    expect(lo.radius).toBe(0.01); expect(hi.radius).toBe(2);
    expect(lo.free).toBe(-1); expect(hi.free).toBe(1);
    expect(lo.count).toBe(1); expect(hi.count).toBe(8);
    expect(lo.col).toEqual([0, 0, 0]);
    expect(Object.keys(lo).sort()).toEqual(['col', 'count', 'free', 'radius']);
  });

  it('follows a typed max and the both-ways setting', () => {
    expect(randomizedParams(node({ __scMax_radius: 3 }), def, () => 0.999999).radius).toBe(3);
    expect(randomizedParams(node({ __scMax_radius: 3, __scBidir_radius: true }), def, () => 0).radius).toBe(-3);
  });

  it('keeps whole-number sliders whole', () => {
    for (let i = 0; i < 20; i++) expect(Number.isInteger(randomizedParams(node(), def).count)).toBe(true);
  });
});
