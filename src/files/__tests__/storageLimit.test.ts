/**
 * The storage limit (docs/storage-limit.md): the usage sum, the refusal
 * threshold, the message, removals never blocked (a shrinking save goes
 * through even over the limit), the 90% warning firing once a session, and
 * the setting's storage and labels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  g.addEventListener = () => undefined;
  g.removeEventListener = () => undefined;
});
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
} as Storage;

import {
  DEFAULT_STORAGE_LIMIT, ensureRoom, GB, isStorageLimitError, limitLabel, limitMessage, localBytes, nearLimit, readStorageLimit, resetLimitWarning, roomFor, roomNow, setLimitReporter, setStorageLimit,
  setUsageSources, STORAGE_LIMIT_KEY, storageUsage, usageTotal, usedLabel, warnIfNear,
} from '../storageLimit';
import { safeSetItem } from '../../utils/fileIO';

const MB = 1024 * 1024;
let media = { images: 0, videos: 0, sounds: 0 };
let workspace = 0;
const refused: string[] = [];
const warned: Array<[number, number]> = [];

beforeEach(() => {
  store.clear();
  media = { images: 0, videos: 0, sounds: 0 };
  workspace = 0;
  refused.length = 0; warned.length = 0;
  resetLimitWarning();
  setUsageSources({
    local: () => localBytes(() => [...store.keys()], k => store.get(k) ?? null, k => k.startsWith('shader-studio')),
    media: async () => media,
    workspace: async () => workspace,
  });
  setLimitReporter({ refused: m => { refused.push(m); }, warn: (u, l) => { warned.push([u, l]); } });
});
afterEach(() => { setUsageSources(null); setLimitReporter(null); });

describe('usage math', () => {
  it('sums saved work, the media library and the workspace folder', async () => {
    store.set('shader-studio:Glow', 'x'.repeat(1000));
    store.set('other-site', 'y'.repeat(5000));
    media = { images: 3 * MB, videos: 20 * MB, sounds: 1 * MB };
    workspace = 7 * MB;
    const u = await storageUsage(true);
    expect(u.local).toBe('shader-studio:Glow'.length + 1000);
    expect(u.total).toBe(u.local + 31 * MB);
    expect(usageTotal({ local: 1, images: 2, videos: 3, sounds: 4, workspace: 5 })).toBe(15);
  });

  it('labels: the limit as its preset, used with one decimal in GB', () => {
    expect(limitLabel(10 * GB)).toBe('10 GB');
    expect(limitLabel(0)).toBe('No limit');
    expect(limitLabel(1.5 * GB)).toBe('1.5 GB');
    expect(limitLabel(512 * MB)).toBe('512 MB');
    expect(usedLabel(10 * GB)).toBe('10.0 GB');
    expect(usedLabel(1.25 * GB)).toBe('1.3 GB');
    expect(usedLabel(300 * MB)).toBe('300 MB');
    expect(limitMessage(10 * GB, 10 * GB)).toBe('Storage limit reached: 10.0 GB of 10 GB used. Free space on the Files page or raise the limit in Settings.');
  });
});

describe('the threshold', () => {
  it('refuses only growth that crosses the limit', () => {
    expect(roomFor(9 * GB, 10 * GB, 1 * GB).ok).toBe(true);
    expect(roomFor(9 * GB, 10 * GB, 1 * GB + 1).ok).toBe(false);
    expect(roomFor(11 * GB, 10 * GB, 1).ok).toBe(false);
    expect(roomFor(11 * GB, 10 * GB, 0).ok).toBe(true);
    expect(roomFor(11 * GB, 10 * GB, -5).ok).toBe(true);
    expect(roomFor(11 * GB, 0, 5 * GB).ok).toBe(true);
    const r = roomFor(9.5 * GB, 10 * GB, 1 * GB);
    expect(!r.ok && r.error).toMatch(/^Storage limit reached: 9\.5 GB of 10 GB used\./);
  });

  it('ensureRoom measures, refuses with the toast and a StorageLimitError', async () => {
    setStorageLimit(4 * MB);
    media = { images: 3 * MB, videos: 0, sounds: 0 };
    await expect(ensureRoom(0.5 * MB)).resolves.toBeUndefined();
    let caught: unknown;
    try { await ensureRoom(2 * MB); } catch (e) { caught = e; }
    expect(isStorageLimitError(caught)).toBe(true);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toBe('Storage limit reached: 3.0 MB of 4.0 MB used. Free space on the Files page or raise the limit in Settings.');
    // No limit: anything goes.
    setStorageLimit(0);
    await expect(ensureRoom(500 * GB)).resolves.toBeUndefined();
  });

  it('safeSetItem refuses a save that would cross the limit and names it', async () => {
    setStorageLimit(1 * MB);
    media = { images: 0.9 * MB, videos: 0, sounds: 0 };
    await storageUsage(true);
    const r = safeSetItem('shader-studio:Big', 'x'.repeat(200_000), 'graph "Big"');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Could not save graph "Big"\. Storage limit reached: /);
    expect(store.has('shader-studio:Big')).toBe(false);
    expect(refused).toHaveLength(1);
    expect(safeSetItem('shader-studio:Small', 'x'.repeat(1000)).ok).toBe(true);
  });
});

describe('removing is never blocked', () => {
  it('a save that shrinks a key goes through over the limit; only growth is refused', async () => {
    store.set('shader-studio:finish-looks', JSON.stringify([{ id: 'a', name: 'A', values: {} }, { id: 'b', name: 'B', values: {} }]));
    setStorageLimit(1 * MB);
    media = { images: 2 * MB, videos: 0, sounds: 0 };
    await storageUsage(true);
    // Way over the limit: deleting a look (the list gets shorter) is fine.
    const shorter = JSON.stringify([{ id: 'a', name: 'A', values: {} }]);
    expect(safeSetItem('shader-studio:finish-looks', shorter).ok).toBe(true);
    expect(store.get('shader-studio:finish-looks')).toBe(shorter);
    // The same size again (a rename of equal length) is fine too.
    expect(safeSetItem('shader-studio:finish-looks', shorter.replace('"A"', '"Z"')).ok).toBe(true);
    // Growing it is not.
    expect(safeSetItem('shader-studio:finish-looks', shorter + ' ').ok).toBe(false);
    expect(roomNow(-100).ok).toBe(true);
    expect(roomNow(0).ok).toBe(true);
    expect(refused).toHaveLength(1);
  });
});

describe('the 90% warning', () => {
  it('fires once a session, at 90% and above, never without a limit', () => {
    expect(nearLimit(8.9 * GB, 10 * GB)).toBe(false);
    expect(nearLimit(9 * GB, 10 * GB)).toBe(true);
    expect(nearLimit(50 * GB, 0)).toBe(false);
    expect(warnIfNear(5 * GB, 10 * GB)).toBe(false);
    expect(warnIfNear(9.2 * GB, 10 * GB)).toBe(true);
    expect(warned).toEqual([[9.2 * GB, 10 * GB]]);
    expect(warnIfNear(9.9 * GB, 10 * GB)).toBe(false);
    expect(warned).toHaveLength(1);
    resetLimitWarning();
    expect(warnIfNear(9.9 * GB, 10 * GB)).toBe(true);
  });

  it('a save that lands past 90% warns once, through the gate', async () => {
    setStorageLimit(1 * MB);
    media = { images: 0.85 * MB, videos: 0, sounds: 0 };
    await storageUsage(true);
    expect(safeSetItem('shader-studio:A', 'x'.repeat(60_000)).ok).toBe(true);
    expect(warned).toHaveLength(1);
    expect(safeSetItem('shader-studio:B', 'x'.repeat(10_000)).ok).toBe(true);
    expect(warned).toHaveLength(1);
  });
});

describe('the setting', () => {
  it('defaults to 10 GB, stores presets and custom values, and 0 means no limit', () => {
    expect(readStorageLimit()).toBe(DEFAULT_STORAGE_LIMIT);
    setStorageLimit(5 * GB);
    expect(store.get(STORAGE_LIMIT_KEY)).toBe(String(5 * GB));
    expect(readStorageLimit()).toBe(5 * GB);
    setStorageLimit(0);
    expect(readStorageLimit()).toBe(0);
    setStorageLimit(DEFAULT_STORAGE_LIMIT);
    expect(store.has(STORAGE_LIMIT_KEY)).toBe(false);
    store.set(STORAGE_LIMIT_KEY, 'garbage');
    expect(readStorageLimit()).toBe(DEFAULT_STORAGE_LIMIT);
  });
});
