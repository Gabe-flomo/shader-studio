/**
 * handWorker.ts — MediaPipe's Hand Landmarker, off the main thread. The
 * tracker (lib/handTracker.ts) sends `init` with where the WebAssembly and
 * the model are (served by the app itself), then camera frames as
 * ImageBitmaps; each comes back as up to two hands of 21 landmarks.
 *
 * GPU first (WebGL2 on an OffscreenCanvas), the CPU when that fails.
 * `options` changes how many hands it looks for and its confidence
 * thresholds while it runs (the setup's Max hands and Strictness).
 *
 * Handedness: MediaPipe Tasks labels the hand as it is in the image it gets.
 * Camera frames arrive unmirrored, so its "Right" is the performer's right
 * hand, and it's passed on as it is. (Checked with a photo of a right hand:
 * "Right", and "Left" once the photo is flipped. The older MediaPipe Hands
 * docs say the opposite, for selfie images.) The label is one frame's vote:
 * play/kit/hands.js keeps each hand's side steady across frames.
 */
import { HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

/** The worker's global scope (typed by hand: the app's tsconfig has the DOM lib, not the worker one). */
const scope = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

let landmarker: HandLandmarker | null = null;
let lastT = 0;

/** How many hands, and the confidence thresholds (lib/handFeed.ts HandOptions). */
interface Options { numHands: number; detection: number; presence: number; tracking: number }
let options: Options = { numHands: 2, detection: 0.6, presence: 0.57, tracking: 0.55 };
const mpOptions = (o: Options) => ({ numHands: o.numHands, minHandDetectionConfidence: o.detection, minHandPresenceConfidence: o.presence, minTrackingConfidence: o.tracking });

async function create(wasm: string, model: string, delegate: 'GPU' | 'CPU'): Promise<HandLandmarker> {
  // The ES-module build of the loader: a module worker can import() it (importScripts can't).
  const fileset = { wasmLoaderPath: `${wasm}vision_wasm_module_internal.js`, wasmBinaryPath: `${wasm}vision_wasm_module_internal.wasm` };
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: 'VIDEO',
    ...mpOptions(options),
  });
}

function toHands(res: HandLandmarkerResult) {
  const out: { side: 'left' | 'right'; score: number; lm: Float32Array }[] = [];
  for (let i = 0; i < res.landmarks.length; i++) {
    const pts = res.landmarks[i];
    const cat = (res.handedness[i] ?? res.handednesses?.[i])?.[0];
    const lm = new Float32Array(63);
    for (let j = 0; j < 21 && j < pts.length; j++) { lm[j * 3] = pts[j].x; lm[j * 3 + 1] = pts[j].y; lm[j * 3 + 2] = pts[j].z; }
    out.push({ side: cat?.categoryName === 'Left' ? 'left' : 'right', score: cat?.score ?? 0, lm });
  }
  return out;
}

scope.onmessage = async (e: MessageEvent) => {
  const d = e.data;
  if (d.type === 'init') {
    if (d.options) options = d.options;
    try {
      let delegate: 'GPU' | 'CPU' = 'GPU';
      try { landmarker = await create(d.wasm, d.model, 'GPU'); }
      catch (err) { console.warn('[hands] GPU delegate failed, using the CPU', err); delegate = 'CPU'; landmarker = await create(d.wasm, d.model, 'CPU'); }
      scope.postMessage({ type: 'ready', delegate });
    } catch (err) {
      scope.postMessage({ type: 'failed', message: String((err as Error)?.message ?? err) });
    }
    return;
  }
  if (d.type === 'frame') {
    const bitmap = d.bitmap as ImageBitmap;
    if (!landmarker) { bitmap.close(); return; }
    // VIDEO mode needs timestamps that only go up.
    const t = Math.max(lastT + 1, Math.round(d.t));
    lastT = t;
    const t0 = performance.now();
    let hands: ReturnType<typeof toHands> = [];
    try { hands = toHands(landmarker.detectForVideo(bitmap, t)); } catch (err) { console.warn('[hands] detect failed', err); }
    bitmap.close();
    scope.postMessage({ type: 'result', t: d.t, w: d.w, h: d.h, ms: performance.now() - t0, hands }, hands.map(h => h.lm.buffer));
    return;
  }
  if (d.type === 'options') {
    options = d.options;
    try { await landmarker?.setOptions(mpOptions(options)); } catch (err) { console.warn('[hands] could not change the tracker settings', err); }
    return;
  }
  if (d.type === 'close') { landmarker?.close(); landmarker = null; }
};
