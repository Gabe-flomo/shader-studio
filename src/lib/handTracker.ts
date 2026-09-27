/**
 * handTracker.ts — the frame pump between the camera and MediaPipe's Hand
 * Landmarker (lib/handWorker.ts). Loaded lazily by handFeed.ts the first time
 * hands are turned on, so neither this nor MediaPipe is in the main bundle.
 *
 * About 30 times a second (never more than one frame in flight) it takes the
 * current camera frame, scales it down to 480 px wide as an ImageBitmap and
 * hands it to the worker, which runs the model off the main thread and posts
 * back up to two hands of 21 landmarks. The render loop never waits on it:
 * handFeed keeps the newest result and the Play engine reads it when it ticks.
 *
 * The model and MediaPipe's WebAssembly come from the app itself
 * (public/mediapipe/, and mediapipe/wasm/ which vite.config.ts copies from the
 * npm package), so tracking works offline and no frame leaves the machine.
 */
import type { HdFrame } from '../play/kit/hands.js';
import type { HandSource, HandStats, HandTrackerHandle } from './handFeed';

/** Frames a second to aim for. */
const TARGET_FPS = 30;
/** Width the camera frame is scaled to before the model sees it (it works at 192–224 px inside). */
const INPUT_WIDTH = 480;

type WorkerOut =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'failed'; message: string }
  | { type: 'result'; t: number; w: number; h: number; ms: number; hands: { side: 'left' | 'right'; score: number; lm: Float32Array }[] };

export async function startHandTracker(o: {
  source: () => HandSource | null;
  push: (f: HdFrame) => void;
  stats: (s: HandStats) => void;
}): Promise<HandTrackerHandle> {
  const base = `${import.meta.env.BASE_URL}mediapipe/`;
  const abs = (p: string) => new URL(p, window.location.href).href;
  const worker = new Worker(new URL('./handWorker.ts', import.meta.url), { type: 'module', name: 'hand-tracker' });
  const delegate = await new Promise<'GPU' | 'CPU'>((resolve, reject) => {
    const onMsg = (e: MessageEvent<WorkerOut>) => {
      if (e.data.type === 'ready') { worker.removeEventListener('message', onMsg); resolve(e.data.delegate); }
      else if (e.data.type === 'failed') { worker.removeEventListener('message', onMsg); worker.terminate(); reject(new Error(e.data.message)); }
    };
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', e => { worker.terminate(); reject(new Error(e.message || 'The hand tracker worker failed to load')); }, { once: true });
    worker.postMessage({ type: 'init', wasm: abs(`${base}wasm/`), model: abs(`${base}hand_landmarker.task`) });
  });

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
    if (!paused) o.push({ t: d.t, w: d.w, h: d.h, hands: d.hands });
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
    const w = Math.min(INPUT_WIDTH, size.w), h = Math.max(1, Math.round((w * size.h) / size.w));
    const t = performance.now();
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' });
    } catch {
      // Safari before 17 can't resize while making a bitmap: draw it smaller first.
      try {
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')?.drawImage(src, 0, 0, w, h);
        bitmap = await createImageBitmap(canvas);
      } catch { schedule(250); return; }
    }
    if (!alive) { bitmap.close(); return; }
    busy = true;
    lastSent = t;
    worker.postMessage({ type: 'frame', bitmap, t, w: size.w, h: size.h }, [bitmap]);
  }
  schedule(0);

  return {
    stop() { alive = false; window.clearTimeout(timer); worker.postMessage({ type: 'close' }); window.setTimeout(() => worker.terminate(), 200); },
    setPaused(on) { paused = on; if (!on && !busy) schedule(0); },
  };
}

function sourceSize(src: HandSource): { w: number; h: number } | null {
  if (src instanceof HTMLVideoElement) return src.readyState >= 2 && src.videoWidth > 0 ? { w: src.videoWidth, h: src.videoHeight } : null;
  if (src instanceof HTMLImageElement) return src.complete && src.naturalWidth > 0 ? { w: src.naturalWidth, h: src.naturalHeight } : null;
  return src.width > 0 && src.height > 0 ? { w: src.width, h: src.height } : null;
}
