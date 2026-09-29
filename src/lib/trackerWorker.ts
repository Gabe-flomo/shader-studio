/**
 * trackerWorker.ts — one of MediaPipe's landmarkers, off the main thread
 * (docs/tracking.md): hands, a face or a body. The pump (lib/trackerPump.ts)
 * or a bake (lib/trackBakes.ts) sends `init` with the kind and where the
 * WebAssembly and the model are (served by the app itself), then frames as
 * ImageBitmaps; each comes back as landmarks.
 *
 *   hands  up to two hands of 21 landmarks, each with MediaPipe's side and score
 *   face   one face: 478 landmarks, and meta = [yaw, pitch, roll (over π), ...52 blendshapes]
 *   pose   one body: 33 landmarks of x, y, z and visibility
 *
 * GPU first (WebGL2 on an OffscreenCanvas), the CPU when that fails.
 * `options` changes the confidence thresholds (and hands to look for) while it runs.
 *
 * Handedness: MediaPipe Tasks labels the hand as it is in the image it gets.
 * Camera frames arrive unmirrored, so its "Right" is the performer's right
 * hand, and it's passed on as it is. (Checked with a photo of a right hand:
 * "Right", and "Left" once the photo is flipped. The older MediaPipe Hands
 * docs say the opposite, for selfie images.) The label is one frame's vote:
 * play/kit/hands.js keeps each hand's side steady across frames.
 */
import { FaceLandmarker, HandLandmarker, PoseLandmarker, type FaceLandmarkerResult, type HandLandmarkerResult, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { FC_BLEND_NAMES, fcHeadAngles } from '../play/kit/face.js';

/** The worker's global scope (typed by hand: the app's tsconfig has the DOM lib, not the worker one). */
const scope = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

type Kind = 'hands' | 'face' | 'pose';
type Landmarker = HandLandmarker | FaceLandmarker | PoseLandmarker;

let kind: Kind = 'hands';
let landmarker: Landmarker | null = null;
let lastT = 0;

/** How many hands, and the confidence thresholds (lib/handFeed.ts TrackerOptions). */
interface Options { numHands?: number; detection: number; presence: number; tracking: number }
let options: Options = { numHands: 2, detection: 0.6, presence: 0.57, tracking: 0.55 };

function mpOptions(o: Options) {
  if (kind === 'face') return { numFaces: 1, minFaceDetectionConfidence: o.detection, minFacePresenceConfidence: o.presence, minTrackingConfidence: o.tracking };
  if (kind === 'pose') return { numPoses: 1, minPoseDetectionConfidence: o.detection, minPosePresenceConfidence: o.presence, minTrackingConfidence: o.tracking };
  return { numHands: o.numHands ?? 2, minHandDetectionConfidence: o.detection, minHandPresenceConfidence: o.presence, minTrackingConfidence: o.tracking };
}

async function create(wasm: string, model: string, delegate: 'GPU' | 'CPU'): Promise<Landmarker> {
  // The ES-module build of the loader: a module worker can import() it (importScripts can't).
  const fileset = { wasmLoaderPath: `${wasm}vision_wasm_module_internal.js`, wasmBinaryPath: `${wasm}vision_wasm_module_internal.wasm` };
  const base = { baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO' as const };
  if (kind === 'face') return FaceLandmarker.createFromOptions(fileset, { ...base, ...mpOptions(options), outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
  if (kind === 'pose') return PoseLandmarker.createFromOptions(fileset, { ...base, ...mpOptions(options), outputSegmentationMasks: false });
  return HandLandmarker.createFromOptions(fileset, { ...base, ...mpOptions(options) });
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

function toFace(res: FaceLandmarkerResult) {
  const out: { meta: Float32Array; lm: Float32Array }[] = [];
  const pts = res.faceLandmarks[0];
  if (!pts) return out;
  const lm = new Float32Array(478 * 3);
  for (let j = 0; j < 478 && j < pts.length; j++) { lm[j * 3] = pts[j].x; lm[j * 3 + 1] = pts[j].y; lm[j * 3 + 2] = pts[j].z; }
  const meta = new Float32Array(3 + FC_BLEND_NAMES.length);
  meta.set(fcHeadAngles(res.facialTransformationMatrixes?.[0]?.data), 0);
  for (const c of res.faceBlendshapes?.[0]?.categories ?? []) {
    const i = FC_BLEND_NAMES.indexOf(c.categoryName);
    if (i >= 0) meta[3 + i] = c.score;
  }
  out.push({ meta, lm });
  return out;
}

function toPose(res: PoseLandmarkerResult) {
  const out: { meta: Float32Array; lm: Float32Array }[] = [];
  const pts = res.landmarks[0];
  if (!pts) return out;
  const lm = new Float32Array(33 * 4);
  for (let j = 0; j < 33 && j < pts.length; j++) { lm[j * 4] = pts[j].x; lm[j * 4 + 1] = pts[j].y; lm[j * 4 + 2] = pts[j].z; lm[j * 4 + 3] = pts[j].visibility ?? 1; }
  out.push({ meta: new Float32Array(0), lm });
  return out;
}

scope.onmessage = async (e: MessageEvent) => {
  const d = e.data;
  if (d.type === 'init') {
    if (d.kind === 'face' || d.kind === 'pose') kind = d.kind;
    if (d.options) options = d.options;
    try {
      let delegate: 'GPU' | 'CPU' = 'GPU';
      try { landmarker = await create(d.wasm, d.model, 'GPU'); }
      catch (err) { console.warn(`[${kind}] GPU delegate failed, using the CPU`, err); delegate = 'CPU'; landmarker = await create(d.wasm, d.model, 'CPU'); }
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
    let items: ReturnType<typeof toFace> = [];
    try {
      if (kind === 'face') items = toFace((landmarker as FaceLandmarker).detectForVideo(bitmap, t));
      else if (kind === 'pose') items = toPose((landmarker as PoseLandmarker).detectForVideo(bitmap, t));
      else hands = toHands((landmarker as HandLandmarker).detectForVideo(bitmap, t));
    } catch (err) { console.warn(`[${kind}] detect failed`, err); }
    bitmap.close();
    const transfer = [...hands.map(h => h.lm.buffer), ...items.flatMap(it => [it.lm.buffer, it.meta.buffer])] as ArrayBuffer[];
    scope.postMessage({ type: 'result', t: d.t, w: d.w, h: d.h, ms: performance.now() - t0, hands, items }, transfer);
    return;
  }
  if (d.type === 'options') {
    options = d.options;
    try { await landmarker?.setOptions(mpOptions(options)); } catch (err) { console.warn(`[${kind}] could not change the tracker settings`, err); }
    return;
  }
  if (d.type === 'close') { landmarker?.close(); landmarker = null; }
};
