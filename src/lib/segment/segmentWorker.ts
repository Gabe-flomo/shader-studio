/**
 * segmentWorker.ts — MediaPipe's segmenters, off the main thread (docs/segment-node.md). The app serves the
 * WASM and the models (public/mediapipe/), as it does the trackers' (lib/trackerWorker.ts).
 *
 *   people   Selfie Segmenter (ImageSegmenter, VIDEO mode): a person's confidence.
 *   objects  DeepLab v3 (ImageSegmenter, VIDEO mode): the summed confidence of the chosen Pascal VOC classes.
 *   click    MagicTouch (InteractiveSegmenterLegacy, image mode): what is under a keypoint.
 *
 * Each segmenter is built the first time its mode is asked for (GPU first, the CPU when that fails) and kept.
 * Messages in: `init` (paths), `segment` (a frame as ImageData, top-down, and what to find). Out: `ready`,
 * `failed`, `mask` (Float32Array, top-down, the frame's size; the same `job`), `error` (that job failed).
 */
import { ImageSegmenter, InteractiveSegmenterLegacy } from '@mediapipe/tasks-vision';

const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

export type SegmentMode = 'people' | 'objects' | 'click';

interface Paths { wasmJs: string; wasmBin: string; models: Record<SegmentMode, string> }
let paths: Paths | null = null;
const built = new Map<SegmentMode, Promise<{ seg: ImageSegmenter | InteractiveSegmenterLegacy; delegate: 'GPU' | 'CPU'; labels: string[] }>>();
let lastT = 0;

async function build(mode: SegmentMode) {
  const p = paths!;
  const fileset = { wasmLoaderPath: p.wasmJs, wasmBinaryPath: p.wasmBin };
  const make = async (delegate: 'GPU' | 'CPU') => {
    const baseOptions = { modelAssetPath: p.models[mode], delegate };
    if (mode === 'click') return InteractiveSegmenterLegacy.createFromOptions(fileset, { baseOptions, outputConfidenceMasks: true, outputCategoryMask: false });
    return ImageSegmenter.createFromOptions(fileset, { baseOptions, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
  };
  let seg: ImageSegmenter | InteractiveSegmenterLegacy, delegate: 'GPU' | 'CPU' = 'GPU';
  try { seg = await make('GPU'); }
  catch (err) { console.warn(`[segment:${mode}] GPU delegate failed, using the CPU`, err); delegate = 'CPU'; seg = await make('CPU'); }
  const labels = mode === 'click' ? [] : (seg as ImageSegmenter).getLabels();
  return { seg, delegate, labels };
}

const segmenter = (mode: SegmentMode) => {
  let b = built.get(mode);
  if (!b) { b = build(mode); built.set(mode, b); b.catch(() => built.delete(mode)); }
  return b;
};

/** The confidence a mask list gives: one mask as it is; for People the person's; for Objects the chosen classes summed. */
function pick(masks: { getAsFloat32Array(): Float32Array }[], mode: SegmentMode, labels: string[], classes: string[]): Float32Array {
  if (masks.length === 1) return masks[0].getAsFloat32Array().slice();
  if (mode === 'people' || mode === 'click') return masks[masks.length - 1].getAsFloat32Array().slice();
  const want = new Set(classes.map(c => c.toLowerCase()));
  let out: Float32Array | null = null;
  labels.forEach((l, i) => {
    if (!want.has(l.toLowerCase()) || !masks[i]) return;
    const m = masks[i].getAsFloat32Array();
    if (!out) out = m.slice();
    else for (let k = 0; k < out.length; k++) out[k] += m[k];
  });
  if (!out) return new Float32Array(masks[0].getAsFloat32Array().length);
  const o = out as Float32Array;
  for (let k = 0; k < o.length; k++) o[k] = Math.min(1, o[k]);
  return o;
}

scope.onmessage = async (e: MessageEvent) => {
  const d = e.data;
  if (d.type === 'init') {
    paths = { wasmJs: d.wasmJs, wasmBin: d.wasmBin, models: d.models };
    // The WASM and a model load with the first segmenter a frame asks for.
    scope.postMessage({ type: 'ready' });
    return;
  }
  if (d.type === 'segment') {
    const job = d.job as number, mode = d.mode as SegmentMode, image = d.image as ImageData;
    try {
      const { seg, labels, delegate } = await segmenter(mode);
      const t0 = performance.now();
      let mask: Float32Array;
      if (mode === 'click') {
        const res = (seg as InteractiveSegmenterLegacy).segment(image, { keypoint: { x: d.point[0], y: d.point[1] } });
        mask = pick(res.confidenceMasks ?? [], mode, labels, []);
        res.close();
      } else {
        // VIDEO mode needs timestamps that only go up.
        const t = Math.max(lastT + 1, Math.round(d.t));
        lastT = t;
        const res = (seg as ImageSegmenter).segmentForVideo(image, t);
        mask = pick(res.confidenceMasks ?? [], mode, labels, d.classes ?? []);
        res.close();
      }
      if (mask.length !== image.width * image.height) mask = new Float32Array(image.width * image.height);
      scope.postMessage({ type: 'mask', job, mask, w: image.width, h: image.height, ms: performance.now() - t0, delegate, labels }, [mask.buffer]);
    } catch (err) {
      scope.postMessage({ type: 'error', job, message: String((err as Error)?.message ?? err) });
    }
    return;
  }
  if (d.type === 'close') {
    for (const b of built.values()) b.then(x => x.seg.close()).catch(() => {});
    built.clear();
  }
};
