/** The phone split (splitSize.ts): clamped, snapped when let go near a snap point, remembered per page. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  return m;
});
import { PLAY_SPLIT, PLAY_SPLIT_LANDSCAPE, STUDIO_SPLIT, SNAP_VH, clampSplit, readSplit, settleSplit, splitLength, writeSplit } from '../splitSize';

describe('phone split', () => {
  beforeEach(() => store.clear());

  it('keeps both sides on screen', () => {
    expect(clampSplit(PLAY_SPLIT, 2)).toBe(PLAY_SPLIT.min);
    expect(clampSplit(PLAY_SPLIT, 99)).toBe(PLAY_SPLIT.max);
    expect(settleSplit(PLAY_SPLIT, 99)).toBe(PLAY_SPLIT.max);
  });

  it('sideways: snaps when let go near a snap point, and stays put otherwise', () => {
    const spec = PLAY_SPLIT_LANDSCAPE;
    const s = spec.snaps[1];
    expect(settleSplit(spec, s + SNAP_VH - 0.5)).toBe(s);
    expect(settleSplit(spec, s - 1)).toBe(s);
    expect(settleSplit(spec, s + SNAP_VH + 1.5)).toBe(s + SNAP_VH + 1.5);
  });

  it('upright: always settles on the nearest of a strip, the default and a big picture', () => {
    expect(STUDIO_SPLIT.snaps).toEqual([25, 42, 70]);
    expect(STUDIO_SPLIT.snaps).toContain(STUDIO_SPLIT.initial);
    expect(settleSplit(STUDIO_SPLIT, 15)).toBe(25);
    expect(settleSplit(STUDIO_SPLIT, 32)).toBe(25);
    expect(settleSplit(STUDIO_SPLIT, 35)).toBe(42);
    expect(settleSplit(STUDIO_SPLIT, 55)).toBe(42);
    expect(settleSplit(STUDIO_SPLIT, 58)).toBe(70);
    expect(settleSplit(STUDIO_SPLIT, 99)).toBe(70);
    for (const v of [20, 30, 49, 60]) expect(PLAY_SPLIT.snaps).toContain(settleSplit(PLAY_SPLIT, v));
  });

  it('upright sizes are shares of the app height (the visible viewport), not CSS vh', () => {
    expect(splitLength(42)).toBe('calc(var(--app-vh, 100dvh) * 0.42)');
    expect(splitLength(25)).toBe('calc(var(--app-vh, 100dvh) * 0.25)');
    expect(splitLength(42)).not.toMatch(/\dvh\b/);
  });

  it('a snapped size survives a reload', () => {
    writeSplit(STUDIO_SPLIT, settleSplit(STUDIO_SPLIT, 22));
    expect(readSplit(STUDIO_SPLIT)).toBe(25);
  });

  it('is remembered per page, and the default is not stored', () => {
    expect(readSplit(PLAY_SPLIT)).toBe(PLAY_SPLIT.initial);
    writeSplit(PLAY_SPLIT, 56);
    expect(readSplit(PLAY_SPLIT)).toBe(56);
    expect(readSplit(STUDIO_SPLIT)).toBe(STUDIO_SPLIT.initial);
    writeSplit(PLAY_SPLIT, PLAY_SPLIT.initial);
    expect(store.has(PLAY_SPLIT.key)).toBe(false);
  });

  it('ignores a stored size it cannot use', () => {
    store.set(PLAY_SPLIT.key, 'wide');
    expect(readSplit(PLAY_SPLIT)).toBe(PLAY_SPLIT.initial);
    store.set(PLAY_SPLIT.key, '5');
    expect(readSplit(PLAY_SPLIT)).toBe(PLAY_SPLIT.min);
  });
});
