import { describe, expect, it } from 'vitest';
import { explainPreview, previewLegend } from '../previewExplain';
import type { GraphNode, DataType } from '../../types/nodeGraph';

const node = (type: string, outType: DataType, params: Record<string, unknown> = {}): GraphNode =>
  ({ id: 'n', type, position: { x: 0, y: 0 }, inputs: {}, outputs: { out: { type: outType, label: 'Out' } }, params });

describe('explainPreview', () => {
  it('names the clip and the fix for a Multiply', () => {
    expect(explainPreview(node('multiply', 'float', { b: 4 }), undefined, { clipped: 0.62, black: 0, flat: false, mean: 0.9 }))
      .toBe('62% of the picture clips to white because the value runs past 1. Multiply by 4 pushes it over — lower B, or add Tone Map after it.');
  });
  it('explains a black distance field', () => {
    const n = { ...node('circleSDF', 'float'), outputs: { distance: { type: 'float' as const, label: 'Distance' } } };
    expect(explainPreview(n, undefined, { clipped: 0, black: 0.97, flat: false, mean: 0.01 })).toMatch(/negative inside.*SDF Glow/);
  });
  it('calls out a flat frame and a healthy one', () => {
    expect(explainPreview(node('add', 'vec3'), undefined, { clipped: 0, black: 0, flat: true, mean: 0.4 })).toMatch(/One flat colour/);
    expect(explainPreview(node('palette', 'vec3'), undefined, { clipped: 0.01, black: 0.1, flat: false, mean: 0.5 })).toBe('Values stay within 0–1 across the frame.');
    expect(explainPreview(node('palette', 'vec3'), undefined, null)).toBeNull();
  });
  it('has a legend per output type', () => {
    expect(previewLegend(node('length', 'float'), undefined)).toMatch(/grey/);
    expect(previewLegend(node('uv', 'vec2'), undefined)).toMatch(/red is x/);
    expect(previewLegend(node('palette', 'vec3'), undefined)).toBeNull();
  });
});
