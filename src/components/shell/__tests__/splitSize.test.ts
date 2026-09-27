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
import { PLAY_SPLIT, STUDIO_SPLIT, SNAP_VH, clampSplit, readSplit, settleSplit, writeSplit } from '../splitSize';

describe('phone split', () => {
  beforeEach(() => store.clear());

  it('keeps both sides on screen', () => {
    expect(clampSplit(PLAY_SPLIT, 2)).toBe(PLAY_SPLIT.min);
    expect(clampSplit(PLAY_SPLIT, 99)).toBe(PLAY_SPLIT.max);
    expect(settleSplit(PLAY_SPLIT, 99)).toBe(PLAY_SPLIT.max);
  });

  it('snaps when let go near a snap point, and stays put otherwise', () => {
    const s = PLAY_SPLIT.snaps[1];
    expect(settleSplit(PLAY_SPLIT, s + SNAP_VH - 0.5)).toBe(s);
    expect(settleSplit(PLAY_SPLIT, s - 1)).toBe(s);
    expect(settleSplit(PLAY_SPLIT, 49)).toBe(49);
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
