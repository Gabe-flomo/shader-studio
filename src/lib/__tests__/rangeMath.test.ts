import { describe, expect, it } from 'vitest';
import { niceCeil, rangeForValue, rangeIncluding } from '../rangeMath';
import { clampToStep, dragStep, rulerUnit } from '../../components/ui/rulerMath';

describe('niceCeil', () => {
  it('rounds up to 1, 2 or 5 × 10^k', () => {
    expect([0.3, 1, 1.2, 3, 7, 10, 107, 160.5, 999].map(niceCeil)).toEqual([0.5, 1, 2, 5, 10, 10, 200, 200, 1000]);
  });
});

describe('rangeIncluding', () => {
  it('leaves a range that holds the value alone', () => {
    expect(rangeIncluding(0.4, 0, 1)).toEqual({ min: 0, max: 1 });
    expect(rangeIncluding(1, 0, 1)).toEqual({ min: 0, max: 1 });
  });
  it('widens the end the value is past to a round number with room', () => {
    expect(rangeIncluding(107, 0, 1)).toEqual({ min: 0, max: 200 });
    expect(rangeIncluding(1.2, 0, 1)).toEqual({ min: 0, max: 2 });
    expect(rangeIncluding(-3, -1, 1)).toEqual({ min: -5, max: 1 });
  });
  it('a positive value below a positive min widens to 0; a negative one above a negative max to 0', () => {
    expect(rangeIncluding(0.05, 0.1, 2)).toEqual({ min: 0, max: 2 });
    expect(rangeIncluding(-0.5, -10, -1)).toEqual({ min: -10, max: 0 });
  });
  it('always holds the value', () => {
    for (const v of [-1e5, -123.4, -2, -0.3, 0, 0.7, 3, 99.9, 107, 5e4]) {
      for (const [lo, hi] of [[0, 1], [-1, 1], [0.01, 2], [10, 20]]) {
        const r = rangeIncluding(v, lo, hi);
        expect(r.min).toBeLessThanOrEqual(v);
        expect(r.max).toBeGreaterThanOrEqual(v);
        expect(r.min).toBeLessThanOrEqual(lo);
        expect(r.max).toBeGreaterThanOrEqual(hi);
      }
    }
  });
});

describe('rangeForValue (a range for a number that came without one)', () => {
  it('0–1 or −1–1 for small values, else 0 to about twice the value, symmetric for negatives', () => {
    expect(rangeForValue(0.5)).toEqual({ min: 0, max: 1, step: 0.01 });
    expect(rangeForValue(-0.5)).toEqual({ min: -1, max: 1, step: 0.01 });
    expect(rangeForValue(2.5)).toEqual({ min: 0, max: 5, step: 0.01 });
    expect(rangeForValue(107)).toEqual({ min: 0, max: 500, step: 1 });
    expect(rangeForValue(-3)).toEqual({ min: -10, max: 10, step: 0.1 });
  });
  it('always holds the value', () => {
    for (const v of [-4000, -12.5, -1.01, 0, 1.01, 7, 33, 107, 12345]) {
      const r = rangeForValue(v);
      expect(r.min <= v && v <= r.max).toBe(true);
    }
  });
});

describe('dragging a slider whose value is past its declared range', () => {
  // The bug: an imported block showed 107 (default 100) on a 0–1 slider; the first touch clamped it to ~0.9.
  const value = 107, declared = { min: 0, max: 1 };
  const range = rangeIncluding(value, declared.min, declared.max);
  const unit = rulerUnit(range.min, range.max);

  it('widens the range around the value (and the default)', () => {
    expect(range.min).toBeLessThanOrEqual(100);
    expect(range.max).toBeGreaterThanOrEqual(value);
  });
  it('moves relative to the value: a small drag is a small change, never a jump into 0–1', () => {
    for (const dx of [-3, -1, 1, 3]) {
      const next = clampToStep(dragStep(value, dx, range, unit, false, false), range.min, range.max, 0.01);
      expect(Math.abs(next - value)).toBeLessThan(unit);
      expect(next).toBeGreaterThan(declared.max);
    }
  });
  it('no movement leaves the value exactly as it was', () => {
    expect(clampToStep(dragStep(value, 0, range, unit, false, false), range.min, range.max, 0.01)).toBe(107);
  });
  it('a count past its range drags from where it is too', () => {
    const r = rangeIncluding(40, 1, 16);
    expect(Math.round(dragStep(40, 14, r, 1, true, false))).toBe(41);
  });
});
