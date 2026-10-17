import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { overlayFitScale } from '../MobileGraphBrowser';

describe('the phone preview’s graph overlay fits the picture', () => {
  it('shrinks a wide graph to the box', () => {
    expect(overlayFitScale(1208, 200, 375, 300)).toBeCloseTo(367 / 1208, 5);
  });
  it('never enlarges a small graph', () => {
    expect(overlayFitScale(200, 100, 375, 300)).toBe(1);
  });
  it('stops at 0.2 for a huge one (1:1 then scrolls)', () => {
    expect(overlayFitScale(10000, 100, 375, 300)).toBe(0.2);
  });
  it('an unmeasured box leaves it at 1:1', () => {
    expect(overlayFitScale(1000, 100, 0, 0)).toBe(1);
  });
});
