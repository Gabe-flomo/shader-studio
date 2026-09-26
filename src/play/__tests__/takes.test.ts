import { describe, it, expect } from 'vitest';
import { takePointerAt, takeValuesAt, type Take } from '../../lib/takePlayback';

const take: Take = {
  id: 't', name: 'Take 1', from: 1, length: 2,
  times: [1, 2, 3],
  tracks: [
    { control: { id: 'speed', target: 'n::speed', kind: 'float', label: 'Speed' }, values: [0, 1, 0.5] },
    { control: { id: 'tint', target: 'n::tint', kind: 'color', label: 'Tint' }, values: [0, 0, 0, 1, 1, 1, 1, 0, 0] },
  ],
  pointer: [0, 0, 1, 0, 1, 1, 1, 1, 0.5, 0.5, 0, 0],
};

describe('takes play back what was recorded', () => {
  it('reads values between samples, and holds the ends', () => {
    expect(takeValuesAt(take, 1.5).get('speed')).toBeCloseTo(0.5);
    expect(takeValuesAt(take, 2.5).get('speed')).toBeCloseTo(0.75);
    expect(takeValuesAt(take, 0).get('speed')).toBe(0);
    expect(takeValuesAt(take, 9).get('speed')).toBe(0.5);
    expect(takeValuesAt(take, 2.5).get('tint')).toEqual([1, 0.5, 0.5]);
  });

  it('moves the pointer smoothly and keeps a press on the nearest frame', () => {
    const p = takePointerAt(take, 1.5);
    expect(p.x).toBeCloseTo(0.5);
    expect(takePointerAt(take, 1.9).down).toBe(true);
    expect(takePointerAt(take, 1.1).down).toBe(false);
    expect(takePointerAt(take, 3).over).toBe(false);
  });
});
