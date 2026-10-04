import { describe, it, expect } from 'vitest';
import { vizScaleForZoom } from '../vizKit';

describe('vizScaleForZoom', () => {
  it('stays 1 at and below 100% (no bigger canvases when zoomed out)', () => {
    for (const z of [0.15, 0.4, 0.99, 1, 1.05]) expect(vizScaleForZoom(z)).toBe(1);
  });
  it('rounds up to half steps above 100%, capped at 2.5', () => {
    expect(vizScaleForZoom(1.2)).toBe(1.5);
    expect(vizScaleForZoom(1.5)).toBe(1.5);
    expect(vizScaleForZoom(1.6)).toBe(2);
    expect(vizScaleForZoom(2)).toBe(2);
    expect(vizScaleForZoom(2.5)).toBe(2.5);
    expect(vizScaleForZoom(4)).toBe(2.5);
  });
});
