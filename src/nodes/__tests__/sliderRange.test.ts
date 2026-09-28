import { describe, expect, it } from 'vitest';
import { extendRangePatch, hasCustomRange, paramSliderRange, resetRangePatch } from '../sliderRange';
import { collectParamCandidates } from '../userNodes/paramCandidates';
import type { GraphNode } from '../../types/nodeGraph';

const pd = { min: -10, max: 10 };

describe('paramSliderRange', () => {
  it('is the definition’s range by default', () => {
    expect(paramSliderRange({}, 'b', pd)).toEqual({ min: -10, max: 10 });
    expect(paramSliderRange({}, 'b', {})).toEqual({ min: 0, max: 1 });
  });
  it('a typed max starts at 0, as before; bidirectional mirrors it', () => {
    expect(paramSliderRange({ __scMax_b: 50 }, 'b', pd)).toEqual({ min: 0, max: 50 });
    expect(paramSliderRange({ __scMax_b: 50, __scBidir_b: true }, 'b', pd)).toEqual({ min: -50, max: 50 });
  });
  it('a range a typed value widened keeps both ends, and Reset puts the definition’s back', () => {
    const params = { ...extendRangePatch('b', -2, 300) };
    expect(paramSliderRange(params, 'b', pd)).toEqual({ min: -2, max: 300 });
    expect(hasCustomRange(params, 'b')).toBe(true);
    const reset = { ...params, ...resetRangePatch('b') };
    expect(hasCustomRange(reset, 'b')).toBe(false);
    expect(paramSliderRange(reset, 'b', pd)).toEqual({ min: -10, max: 10 });
  });
  it('typing past a bidirectional range keeps it bidirectional (−N to N)', () => {
    const params = { __scBidir_b: true, ...extendRangePatch('b', -50, 50) };
    expect(paramSliderRange(params, 'b', pd)).toEqual({ min: -50, max: 50 });
    expect(params.__scBidir_b).toBe(true);
    // Turning bidirectional off drops the mirrored min: 0 to max, as typing past the range always gave.
    expect(paramSliderRange({ ...params, __scBidir_b: false, __scMin_b: null }, 'b', pd)).toEqual({ min: 0, max: 50 });
  });
});

describe('Play candidates', () => {
  it('a slider set past its range (Multiply B = 107 on −10–10) is offered with a range that holds it', () => {
    const nodes: GraphNode[] = [
      { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'm', type: 'multiply', position: { x: 0, y: 0 }, params: { b: 107, label: 'electricFieldRadius' },
        inputs: { a: { type: 'float', label: 'A' } }, outputs: { result: { type: 'float', label: 'Result' } },
      },
    ];
    const c = collectParamCandidates({ nodes, inputPorts: [], outputPorts: [] }).find(x => x.sourcePath === 'm::b')!;
    expect(c.value).toBe(107);
    expect(c.min).toBeLessThanOrEqual(107);
    expect(c.max).toBeGreaterThanOrEqual(107);
    expect(c.nodeLabel).toBe('electricFieldRadius');
  });
});
