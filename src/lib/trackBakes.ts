/**
 * trackBakes.ts — baked tracks (docs/tracking.md): a Video layer analysed
 * once by a tracker, its frames kept in the browser's own track store
 * (IndexedDB `shader-studio-tracks`, store `bakes`, one record of bytes per
 * bake) and read back by video time. The setup keeps only a note of each
 * (types/playTracking.ts TrackBakeRef). Pure storage plus the analysis
 * itself; the engine reads decoded tracks from the cache here, synchronously.
 *
 * Where IndexedDB is missing or refuses (a private window, storage full) a
 * bake lives for the session only.
 */
import { tkDecode, tkEncode, tkToBase64, type TkRawFrame, type TkTrack } from '../play/kit/tracks.js';
import type { TrackerKind, TrackerOptions } from './handFeed';
import { inputBus } from './inputBus';
import { hdTrackerOptions } from '../play/kit/hands.js';

const DB = 'shader-studio-tracks';
const STORE = 'bakes';

interface Entry { track: TkTrack | null; bytes: Uint8Array | null; state: 'loading' | 'ready' | 'missing' }
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
function emit(): void { for (const l of listeners) l(); inputBus.wake(); }
/** A bake finished loading (or turned out missing). Returns an unsubscribe. */
export function onBakes(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  const d = await db();
  if (!d) return null;
  return new Promise(resolve => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => { const v = req.result; resolve(v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null); };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbPut(key: string, bytes: Uint8Array): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  return new Promise(resolve => {
    try {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

/** Remove a bake's frames (a bake replaced by a newer one for the same layer and file). */
export async function deleteBake(key: string): Promise<void> {
  cache.delete(key);
  const d = await db();
  if (!d) return;
  try { d.transaction(STORE, 'readwrite').objectStore(STORE).delete(key); } catch { /* gone already */ }
}

/** A new bake's key. */
export function newBakeKey(kind: TrackerKind): string {
  return `${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Keep a bake: in the cache now, in the store for later. False when it could be kept for this session only. */
export async function saveBake(key: string, bytes: Uint8Array): Promise<boolean> {
  cache.set(key, { track: tkDecode(bytes), bytes, state: 'ready' });
  emit();
  return idbPut(key, bytes);
}

/** The decoded track under `key`, or null while it loads (then onBakes fires) or when this browser doesn't have it. */
export function bakeTrack(key: string): TkTrack | null {
  const e = cache.get(key);
  if (e) return e.track;
  const entry: Entry = { track: null, bytes: null, state: 'loading' };
  cache.set(key, entry);
  void idbGet(key).then(bytes => {
    if (cache.get(key) !== entry) return;
    if (bytes) { entry.bytes = bytes; entry.track = tkDecode(bytes); }
    entry.state = entry.track ? 'ready' : 'missing';
    emit();
  });
  return null;
}

/** Is a bake loading, here, or missing from this browser? */
export function bakeState(key: string): 'loading' | 'ready' | 'missing' {
  bakeTrack(key);
  return cache.get(key)?.state ?? 'loading';
}

/** A loaded bake's bytes as base64 (web exports carry it as text), or null while it isn't loaded. */
export function bakeBase64(key: string): string | null {
  const e = cache.get(key);
  return e?.bytes ? tkToBase64(e.bytes) : null;
}

/** The model settings a bake was made with, as a string: a different one makes the bake stale. */
export function bakeSig(kind: TrackerKind, o: TrackerOptions): string {
  return [kind, o.numHands ?? '', o.detection, o.presence, o.tracking].join('|');
}

/**
 * MediaPipe's options for a tracker's settings: hands as play/kit/hands.js
 * hdTrackerOptions says (hands to look for, Strictness or the thresholds set
 * by hand); face and pose from Strictness alone (one face, one body).
 */
export function trackerOptionsFor(kind: TrackerKind, settings: Parameters<typeof hdTrackerOptions>[0]): TrackerOptions {
  const o = hdTrackerOptions(settings);
  if (kind === 'hands') return o;
  return { detection: o.detection, presence: o.presence, tracking: o.tracking };
}

/** Frames a second an analysis may use. */
export const BAKE_RATES = [30, 15, 10] as const;
/** The longest clip analysed (s): past this, the analysis stops there. */
export const BAKE_MAX_S = 600;

export class BakeCancelled extends Error { constructor() { super('Analysis cancelled'); this.name = 'BakeCancelled'; } }

/**
 * Run a tracker over a whole video file: seek to each step (1/fps apart),
 * hand that frame to the model and keep what it finds. `progress` gets 0..1.
 * Returns the encoded track and what it holds. Cancel with `signal`.
 */
export async function analyseVideo(o: { kind: TrackerKind; blob: Blob; fps: number; options: TrackerOptions; progress?: (p: number) => void; signal?: AbortSignal }): Promise<{ bytes: Uint8Array; frames: number; duration: number; w: number; h: number }> {
  const { openTrackerWorker, frameBitmap, sourceSize, resultFrame } = await import('./trackerPump');
  const url = URL.createObjectURL(o.blob);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
  const canvas = document.createElement('canvas');
  let worker: Worker | null = null;
  const cancelled = () => { if (o.signal?.aborted) throw new BakeCancelled(); };
  try {
    v.src = url;
    await once(v, 'loadedmetadata', 10000);
    // Recorded in a browser, a video can say its length is Infinity until a seek past the end works it out.
    if (v.duration === Infinity) { v.currentTime = 1e7; await once(v, 'durationchange', 5000).catch(() => {}); }
    const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    if (!duration) throw new Error('This video’s length isn’t known, so it can’t be analysed.');
    cancelled();
    ({ worker } = await openTrackerWorker(o.kind, o.options));
    const fps = Math.max(1, Math.min(60, o.fps));
    const n = Math.max(1, Math.floor(Math.min(duration, BAKE_MAX_S) * fps) + 1);
    const frames: TkRawFrame[] = [];
    let w = 0, h = 0;
    const w0 = worker;
    for (let i = 0; i < n; i++) {
      cancelled();
      const t = Math.min(i / fps, Math.max(0, duration - 0.001));
      if (Math.abs(v.currentTime - t) > 1e-4 || v.readyState < 2) {
        const seeked = once(v, 'seeked', 5000);
        v.currentTime = t;
        await seeked;
      }
      if (v.readyState < 2) await once(v, 'loadeddata', 3000).catch(() => {});
      const size = sourceSize(v);
      const bitmap = size ? await frameBitmap(v, size, canvas) : null;
      if (!size || !bitmap) { frames.push({ t, items: [] }); continue; }
      w = size.w; h = size.h;
      const res = await new Promise<Parameters<typeof resultFrame>[1]>((resolve, reject) => {
        const onMsg = (e: MessageEvent) => { if (e.data?.type === 'result') { w0.removeEventListener('message', onMsg); resolve(e.data); } };
        w0.addEventListener('message', onMsg);
        w0.addEventListener('error', () => reject(new Error('The tracker stopped')), { once: true });
        // Timestamps that only go up (VIDEO mode), a frame's worth apart.
        w0.postMessage({ type: 'frame', bitmap, t: 1 + (i * 1000) / fps, w: size.w, h: size.h }, [bitmap]);
      });
      const f = resultFrame(o.kind, res);
      frames.push({
        t,
        items: 'hands' in f ? f.hands.map(hd => ({ meta: [hd.side === 'right' ? 1 : -1, hd.score], lm: hd.lm })) : f.items,
      });
      o.progress?.((i + 1) / n);
    }
    const bytes = tkEncode({ kind: o.kind, w, h, duration, fps, frames });
    return { bytes, frames: frames.length, duration, w, h };
  } finally {
    if (worker) { worker.postMessage({ type: 'close' }); const wk = worker; window.setTimeout(() => wk.terminate(), 200); }
    v.removeAttribute('src'); v.load();
    URL.revokeObjectURL(url);
  }
}

function once(el: HTMLElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => { el.removeEventListener(event, done); reject(new Error(`The video didn’t answer (${event})`)); }, ms);
    const done = () => { window.clearTimeout(t); el.removeEventListener(event, done); resolve(); };
    el.addEventListener(event, done);
  });
}

/** Tests: forget every cached bake. */
export function clearBakeCache(): void { cache.clear(); }
/** Tests and web exports: put decoded bytes in the cache directly. */
export function putBake(key: string, bytes: Uint8Array): void { cache.set(key, { track: tkDecode(bytes), bytes, state: 'ready' }); emit(); }
