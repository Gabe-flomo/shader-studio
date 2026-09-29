/**
 * trackerCache.ts — settings for keeping the trackers' models on this device
 * (docs/tracking.md "Models"): whether Cache Storage keeps the WebAssembly
 * and model files between reloads, and which trackers warm up when the app
 * opens. A small zustand store over localStorage, so both a settings page and
 * an inline note (e.g. under Enable) stay in sync. The actual caching happens
 * in the worker (lib/trackerWorker.ts), which is the one place with both the
 * bytes and the Cache Storage API in the same context.
 *
 * On the desktop the files are bundled with the app (public/mediapipe/), so
 * there's nothing to cache or clear: `modelsBundled()` says so, and the
 * settings UI (TrackerModelsSettings.tsx) shows "Bundled with the app" there
 * instead of the toggle and the Clear button.
 */
import { create } from 'zustand';
import type { TrackerKind } from './handFeed';

/** Bump this when a model or the MediaPipe WebAssembly build changes: a new
 * version means a different cache key, so an app update refetches instead of
 * reading stale bytes. Keep it in step with public/mediapipe/*.task and the
 * @mediapipe/tasks-vision version in package.json. */
export const TRACKER_CACHE_VERSION = '1';

/** The Cache Storage cache tracker models and the WebAssembly are kept in. */
export const TRACKER_CACHE_NAME = `tracker-models-v${TRACKER_CACHE_VERSION}`;

/** Each tracker's model file, in bytes (public/mediapipe/*.task; docs/tracking.md's table). */
export const MODEL_BYTES: Record<TrackerKind, number> = { hands: 7819105, face: 3758596, pose: 5777746 };

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** On the desktop the models ship inside the app bundle: nothing to fetch, cache or clear. */
export const modelsBundled = (): boolean => isTauri();

const KEEP_KEY = 'shader-studio:settings:keepTrackerModels';
const WARMUP_KEY = (kind: TrackerKind) => `shader-studio:settings:warmupTracker:${kind}`;
const KINDS = ['hands', 'face', 'pose'] as const;

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch { return fallback; }
}
function writeBool(key: string, v: boolean): void {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private window, storage full */ }
}

interface TrackerCacheSettings {
  keepModels: boolean;
  warmup: Record<TrackerKind, boolean>;
  setKeepModels(v: boolean): void;
  setWarmup(kind: TrackerKind, v: boolean): void;
}

/** The store behind the settings: subscribe from a component, or read `.getState()` from plain code (trackerPump.ts, handFeed.ts). */
export const useTrackerCacheSettings = create<TrackerCacheSettings>((set, get) => ({
  keepModels: readBool(KEEP_KEY, true),
  warmup: { hands: readBool(WARMUP_KEY('hands'), false), face: readBool(WARMUP_KEY('face'), false), pose: readBool(WARMUP_KEY('pose'), false) },
  setKeepModels(v) { writeBool(KEEP_KEY, v); set({ keepModels: v }); },
  setWarmup(kind, v) { writeBool(WARMUP_KEY(kind), v); set({ warmup: { ...get().warmup, [kind]: v } }); },
}));

/** "Keep tracking models on this device" (default on). Meaningless on the desktop: they're always bundled. */
export const keepModelsEnabled = (): boolean => useTrackerCacheSettings.getState().keepModels;
export const setKeepModels = (v: boolean): void => useTrackerCacheSettings.getState().setKeepModels(v);

/** "Warm up trackers when the app opens", per tracker (default off). */
export const warmupEnabled = (kind: TrackerKind): boolean => useTrackerCacheSettings.getState().warmup[kind];
export const setWarmup = (kind: TrackerKind, v: boolean): void => useTrackerCacheSettings.getState().setWarmup(kind, v);

/** Every tracker with warm-up on. */
export function warmupKinds(): TrackerKind[] {
  return KINDS.filter(warmupEnabled);
}

/** Total bytes this browser has cached for the trackers (every version's cache; only the current one is read back). */
export async function modelCacheSize(): Promise<number> {
  if (modelsBundled() || typeof caches === 'undefined') return 0;
  let total = 0;
  try {
    for (const name of await caches.keys()) {
      if (!name.startsWith('tracker-models-v')) continue;
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        const blob = await res?.blob().catch(() => null);
        if (blob) total += blob.size;
      }
    }
  } catch { /* Cache Storage unavailable (a private window, some Safari modes) */ }
  return total;
}

/** Forget every cached tracker model and the WebAssembly: the next Enable downloads them again. */
export async function clearModelCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    for (const name of await caches.keys()) if (name.startsWith('tracker-models-v')) await caches.delete(name);
  } catch { /* nothing to clear */ }
}

/** A byte count as "7.8 MB" (files/appSettings.ts and the size readouts use the same rounding). */
export function sizeText(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** "downloading" progress as " (7.8 MB · 42%)", or " (7.8 MB)" until the total is known (HandsChip.tsx, TrackingChips.tsx). */
export function loadPct(p: { loaded: number; total: number }): string {
  const size = sizeText(p.total || p.loaded);
  return p.total > 0 ? ` (${size} · ${Math.min(100, Math.round((p.loaded / p.total) * 100))}%)` : ` (${size})`;
}

/** The one-line note under Enable / the tracker's settings: bundled, kept, or downloaded fresh each time (docs/tracking.md "Models"). */
export function modelNoteText(kind: TrackerKind): string {
  if (modelsBundled()) return 'Bundled with the app.';
  return useTrackerCacheSettings.getState().keepModels
    ? `Models are kept on this device — ${sizeText(MODEL_BYTES[kind])}.`
    : 'Downloaded when needed.';
}
