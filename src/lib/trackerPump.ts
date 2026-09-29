/**
 * trackerPump.ts — the frame pump between a picture (the camera, or a Video
 * layer being tracked live) and one of MediaPipe's landmarkers
 * (lib/trackerWorker.ts). Loaded lazily by handFeed.ts the first time a
 * tracker is turned on, so neither this nor MediaPipe is in the main bundle.
 *
 * About 30 times a second (never more than one frame in flight) it takes the
 * current frame, scales it down to 480 px wide as an ImageBitmap and hands it
 * to the worker, which runs the model off the main thread and posts back the
 * landmarks. The render loop never waits on it: the feed keeps the newest
 * result and the Play engine reads it when it ticks.
 *
 * The models and MediaPipe's WebAssembly come from the app itself
 * (public/mediapipe/, and mediapipe/wasm/ which vite.config.ts copies from the
 * npm package), so tracking works offline and no frame leaves the machine.
 */
import type { TrackerFrame, TrackerKind, TrackerOptions, TrackerSource, TrackerStats, TrackerHandle } from './handFeed';
import { keepModelsEnabled, TRACKER_CACHE_VERSION } from './trackerCache';

/** Dev only: `?slowTrackerFetch=1` paces the model download so the states are easy to see and screenshot (docs/tracking.md). */
const SLOW_FETCH = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('slowTrackerFetch');

/** Frames a second to aim for. */
const TARGET_FPS = 30;
/** Width a frame is scaled to before the model sees it (it works at 192–256 px inside). */
export const INPUT_WIDTH = 480;

/** Each tracker's model, in public/mediapipe/ (float16 builds from Google's MediaPipe model storage). */
export const MODEL_FILES: Record<TrackerKind, string> = { hands: 'hand_landmarker.task', face: 'face_landmarker.task', pose: 'pose_landmarker_lite.task' };

type WorkerOut =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'failed'; message: string }
  | { type: 'progress'; phase: 'downloading' | 'loading'; loaded?: number; total?: number }
  | { type: 'result'; t: number; w: number; h: number; ms: number; hands: { side: 'left' | 'right'; score: number; lm: Float32Array }[]; items: { meta: Float32Array; lm: Float32Array }[] };
export type TrackerResult = Extract<WorkerOut, { type: 'result' }>;
export type TrackerLoadEvent = Extract<WorkerOut, { type: 'progress' }>;

/** Start a worker with a kind's model loaded. Rejects when MediaPipe can't start here. `onProgress` reports the download and the WASM/model init that follows (docs/tracking.md "Models"). */
export async function openTrackerWorker(kind: TrackerKind, options: TrackerOptions, onProgress?: (p: TrackerLoadEvent) => void): Promise<{ worker: Worker; delegate: 'GPU' | 'CPU' }> {
  const base = `${import.meta.env.BASE_URL}mediapipe/`;
  const abs = (p: string) => new URL(p, window.location.href).href;
  const worker = new Worker(new URL('./trackerWorker.ts', import.meta.url), { type: 'module', name: `${kind}-tracker` });
  const delegate = await new Promise<'GPU' | 'CPU'>((resolve, reject) => {
    const onMsg = (e: MessageEvent<WorkerOut>) => {
      if (e.data.type === 'ready') { worker.removeEventListener('message', onMsg); resolve(e.data.delegate); }
      else if (e.data.type === 'failed') { worker.removeEventListener('message', onMsg); worker.terminate(); reject(new Error(e.data.message)); }
      else if (e.data.type === 'progress') onProgress?.(e.data);
    };
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', e => { worker.terminate(); reject(new Error(e.message || `The ${kind} tracker worker failed to load`)); }, { once: true });
    worker.postMessage({
      type: 'init', kind, options,
      wasmJs: abs(`${base}wasm/vision_wasm_module_internal.js`),
      wasmBin: abs(`${base}wasm/vision_wasm_module_internal.wasm`),
      model: abs(`${base}${MODEL_FILES[kind]}`),
      cacheModels: keepModelsEnabled(),
      cacheVersion: TRACKER_CACHE_VERSION,
      slow: SLOW_FETCH,
    });
  });
  return { worker, delegate };
}

/** A frame as an ImageBitmap at most INPUT_WIDTH wide (Safari before 17 can't resize while making one: drawn smaller first). */
export async function frameBitmap(src: TrackerSource, size: { w: number; h: number }, canvas: HTMLCanvasElement): Promise<ImageBitmap | null> {
  const w = Math.min(INPUT_WIDTH, size.w), h = Math.max(1, Math.round((w * size.h) / size.w));
  try {
    return await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' });
  } catch {
    try {
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')?.drawImage(src, 0, 0, w, h);
      return await createImageBitmap(canvas);
    } catch { return null; }
  }
}

/** A worker result as the frame its feed passes on. */
export function resultFrame(kind: TrackerKind, d: TrackerResult): TrackerFrame {
  return kind === 'hands' ? { t: d.t, w: d.w, h: d.h, hands: d.hands } : { t: d.t, w: d.w, h: d.h, items: d.items };
}

export async function startTracker(o: {
  kind: TrackerKind;
  source: () => TrackerSource | null;
  push: (f: TrackerFrame) => void;
  stats: (s: TrackerStats) => void;
  options: TrackerOptions;
  onProgress?: (p: TrackerLoadEvent) => void;
}): Promise<TrackerHandle> {
  const { worker, delegate } = await openTrackerWorker(o.kind, o.options, o.onProgress);

  let alive = true, paused = false, busy = false, timer = 0;
  let lastSent = 0, lastVideoTime = -1;
  const times: number[] = [];
  const canvas = document.createElement('canvas');

  const schedule = (ms: number) => { window.clearTimeout(timer); if (alive) timer = window.setTimeout(pump, ms); };

  worker.addEventListener('message', (e: MessageEvent<WorkerOut>) => {
    const d = e.data;
    if (d.type !== 'result') return;
    busy = false;
    const now = performance.now();
    times.push(now);
    while (times.length && now - times[0] > 1000) times.shift();
    o.stats({ fps: times.length, inferMs: Math.round(d.ms * 10) / 10, latencyMs: Math.round(now - d.t), delegate });
    if (!paused) o.push(resultFrame(o.kind, d));
    schedule(Math.max(0, 1000 / TARGET_FPS - (now - lastSent)));
  });

  async function pump(): Promise<void> {
    if (!alive || busy) return;
    const src = paused ? null : o.source();
    const size = src ? sourceSize(src) : null;
    if (!src || !size) { schedule(120); return; }
    // A video that hasn't moved on since the last frame has nothing new to show.
    if (src instanceof HTMLVideoElement) {
      if (src.currentTime === lastVideoTime && !src.srcObject) { schedule(1000 / TARGET_FPS); return; }
      lastVideoTime = src.currentTime;
    }
    const t = performance.now();
    const bitmap = await frameBitmap(src, size, canvas);
    if (!bitmap) { schedule(250); return; }
    if (!alive) { bitmap.close(); return; }
    busy = true;
    lastSent = t;
    worker.postMessage({ type: 'frame', bitmap, t, w: size.w, h: size.h }, [bitmap]);
  }
  schedule(0);

  return {
    stop() { alive = false; window.clearTimeout(timer); worker.postMessage({ type: 'close' }); window.setTimeout(() => worker.terminate(), 200); },
    setPaused(on) { paused = on; if (!on && !busy) schedule(0); },
    setOptions(options) { worker.postMessage({ type: 'options', options }); },
  };
}

export function sourceSize(src: TrackerSource): { w: number; h: number } | null {
  if (src instanceof HTMLVideoElement) return src.readyState >= 2 && src.videoWidth > 0 ? { w: src.videoWidth, h: src.videoHeight } : null;
  if (src instanceof HTMLImageElement) return src.complete && src.naturalWidth > 0 ? { w: src.naturalWidth, h: src.naturalHeight } : null;
  return src.width > 0 && src.height > 0 ? { w: src.width, h: src.height } : null;
}
