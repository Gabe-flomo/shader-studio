/** App settings → Background (lib/backgroundPolicy.ts): defaults, and stored values round-trip. */
import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); }, key: () => null, length: 0, clear: () => store.clear(),
});

import { backgroundFrame, SLOW_FPS, backgroundMode, releaseGpuWhenHidden, setBackgroundMode, setReleaseGpuWhenHidden, BACKGROUND_MODE_KEY, RELEASE_GPU_KEY } from '../backgroundPolicy';
import { describeSetting } from '../../files/appSettings';

describe('background policy', () => {
  it('defaults to Slow down and freeing GPU memory, stored as nothing', () => {
    expect(backgroundMode()).toBe('slow');
    expect(releaseGpuWhenHidden()).toBe(true);
  });
  it('keeps a chosen mode and switch, and the defaults clear their keys', () => {
    setBackgroundMode('pause');
    expect(backgroundMode()).toBe('pause');
    setBackgroundMode('keep');
    expect(backgroundMode()).toBe('keep');
    setBackgroundMode('slow');
    expect(store.has(BACKGROUND_MODE_KEY)).toBe(false);
    setReleaseGpuWhenHidden(false);
    expect(releaseGpuWhenHidden()).toBe(false);
    setReleaseGpuWhenHidden(true);
    expect(store.has(RELEASE_GPU_KEY)).toBe(false);
  });
  it('an unknown stored mode reads as the default', () => {
    store.set(BACKGROUND_MODE_KEY, 'warp');
    expect(backgroundMode()).toBe('slow');
    store.clear();
  });
  it('both settings have names in App settings', () => {
    expect(describeSetting(BACKGROUND_MODE_KEY).category).toBe('app');
    expect(describeSetting(RELEASE_GPU_KEY).category).toBe('app');
  });

  it('the loop draws, skips or stops as the mode says', () => {
    const at = (o: Partial<Parameters<typeof backgroundFrame>[0]>) => backgroundFrame({ focused: false, mode: 'slow', fullSpeed: false, now: 1000, lastDraw: 0, ...o });
    expect(at({ focused: true })).toBe('draw');
    expect(at({ fullSpeed: true, mode: 'pause' })).toBe('draw');
    expect(at({ mode: 'keep' })).toBe('draw');
    expect(at({ mode: 'pause' })).toBe('stop');
    expect(at({ lastDraw: 1000 - 1000 / SLOW_FPS / 2 })).toBe('skip');
    expect(at({ lastDraw: 1000 - 1000 / SLOW_FPS })).toBe('draw');
  });
});
