import { describe, it, expect } from 'vitest';
import { rulerTicks, rulerUnit } from '../rulerMath';

describe('rulerTicks', () => {
  it('draws ticks around a value that sits outside the declared range', () => {
    // A published node's slider with range 0..1 but a default of 6.26 used to
    // render an empty ruler: every tick was clamped to [min, max].
    const unit = rulerUnit(0, 1);
    const ticks = rulerTicks(6.26, 0, 1, unit);
    expect(ticks.length).toBeGreaterThan(4);
    expect(ticks.some(t => t.dx < 0) && ticks.some(t => t.dx > 0)).toBe(true);
  });

  it('still stops at the range edges when the value is inside them', () => {
    const unit = rulerUnit(0, 1);
    const ticks = rulerTicks(0.95, 0, 1, unit);
    // nothing past max (1.0) → no tick further right than the max edge
    const maxDx = ((1 - 0.95) / unit) * 40;
    expect(ticks.every(t => t.dx <= maxDx + 1e-6)).toBe(true);
  });
});
