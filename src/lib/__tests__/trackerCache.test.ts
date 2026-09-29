/**
 * trackerCache.ts (docs/tracking.md "Models"): the "Keep tracking models on
 * this device" and per-tracker "Warm up" settings default correctly, persist
 * to the keys files/appSettings.ts knows about (so Reset and profile ZIPs see
 * them), migrate an unset key to its default rather than treating it as off,
 * and the cache name changes when the version bumps (so an app update
 * refetches instead of reading stale bytes).
 */
import { describe, it, expect, beforeEach } from 'vitest';

function fakeLocalStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

describe('trackerCache settings', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeLocalStorage();
  });

  it('defaults: keep models on, warm-up off for every tracker', async () => {
    const { useTrackerCacheSettings, keepModelsEnabled, warmupEnabled, warmupKinds } = await import('../trackerCache');
    expect(keepModelsEnabled()).toBe(true);
    expect(warmupEnabled('hands')).toBe(false);
    expect(warmupEnabled('face')).toBe(false);
    expect(warmupEnabled('pose')).toBe(false);
    expect(warmupKinds()).toEqual([]);
    expect(useTrackerCacheSettings.getState().keepModels).toBe(true);
  });

  it('an unset key reads back as the default, not as off: turning keep-models off writes "0" (a migration reading it as merely absent would wrongly default it back on)', async () => {
    const { setKeepModels, keepModelsEnabled } = await import('../trackerCache');
    expect(localStorage.getItem('shader-studio:settings:keepTrackerModels')).toBeNull();
    setKeepModels(false);
    expect(localStorage.getItem('shader-studio:settings:keepTrackerModels')).toBe('0');
    expect(keepModelsEnabled()).toBe(false);
    // A later session with the key still "0" (not missing) must stay off.
    const { useTrackerCacheSettings } = await import('../trackerCache');
    useTrackerCacheSettings.setState({ keepModels: localStorage.getItem('shader-studio:settings:keepTrackerModels') !== '0' });
    expect(useTrackerCacheSettings.getState().keepModels).toBe(false);
  });

  it('setWarmup persists per tracker independently', async () => {
    const { setWarmup, warmupEnabled, warmupKinds } = await import('../trackerCache');
    setWarmup('face', true);
    expect(warmupEnabled('face')).toBe(true);
    expect(warmupEnabled('hands')).toBe(false);
    expect(warmupEnabled('pose')).toBe(false);
    expect(warmupKinds()).toEqual(['face']);
    expect(localStorage.getItem('shader-studio:settings:warmupTracker:face')).toBe('1');
    expect(localStorage.getItem('shader-studio:settings:warmupTracker:hands')).toBeNull();
  });

  it('the store and the plain getters agree (a settings page and an inline note read the same value)', async () => {
    const { useTrackerCacheSettings, setKeepModels, keepModelsEnabled } = await import('../trackerCache');
    setKeepModels(false);
    expect(useTrackerCacheSettings.getState().keepModels).toBe(keepModelsEnabled());
    setKeepModels(true);
    expect(useTrackerCacheSettings.getState().keepModels).toBe(keepModelsEnabled());
  });

  it('a private window that refuses storage still returns sensible defaults, not a throw', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
    };
    const { keepModelsEnabled, setKeepModels } = await import('../trackerCache');
    expect(keepModelsEnabled()).toBe(true);
    expect(() => setKeepModels(false)).not.toThrow();
  });
});

describe('trackerCache versioning', () => {
  it('the cache name carries the version, so bumping it is a different cache (an app update refetches)', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeLocalStorage();
    const { TRACKER_CACHE_VERSION, TRACKER_CACHE_NAME } = await import('../trackerCache');
    expect(TRACKER_CACHE_NAME).toBe(`tracker-models-v${TRACKER_CACHE_VERSION}`);
  });

  it('modelsBundled() follows the Tauri flag, not the platform guess', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeLocalStorage();
    const w = globalThis as unknown as { window?: Record<string, unknown> };
    const hadWindow = 'window' in globalThis;
    const prevWindow = w.window;
    w.window = { ...(prevWindow as object ?? {}) };
    const { modelsBundled } = await import('../trackerCache');
    expect(modelsBundled()).toBe(false);
    (w.window as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(modelsBundled()).toBe(true);
    if (hadWindow) w.window = prevWindow; else delete w.window;
  });
});

describe('sizeText and loadPct', () => {
  it('formats bytes as MB, one decimal under 10 MB, none at or above', async () => {
    const { sizeText } = await import('../trackerCache');
    expect(sizeText(0)).toBe('0 MB');
    expect(sizeText(1_500_000)).toBe('1.4 MB');
    expect(sizeText(23_000_000)).toBe('22 MB');
  });

  it('loadPct shows a percentage once the total is known, just the size otherwise', async () => {
    const { loadPct } = await import('../trackerCache');
    expect(loadPct({ loaded: 0, total: 0 })).toBe(' (0 MB)');
    expect(loadPct({ loaded: 3_909_552, total: 7_819_105 })).toBe(' (7.5 MB · 50%)');
    expect(loadPct({ loaded: 7_819_105, total: 7_819_105 })).toBe(' (7.5 MB · 100%)');
  });
});
