/**
 * workerCore.ts — the depth worker's message handling (docs/depth-node.md), apart from Transformers.js so the
 * tests can drive it with a mocked model. worker.ts plugs the real loader in.
 *
 * Messages in:
 *   { type: 'load', id, cfg }                                 load one model (WebGPU when it has shader-f16, else WebAssembly)
 *   { type: 'depth', id, model, rgba, w, h, flipY, side }     → { type: 'depth', id, depth, w, h, ms, range? }
 *   { type: 'unload', id, model }                             free one model
 * Messages out: progress while loading, { type: 'ready', id, model, backend, ms }, { type: 'error', id, message }.
 *
 * Depth comes back as a Float32Array of nearness, 0–1 (1 is the nearest thing in the frame), rows top to bottom, at
 * the size the model worked at. Depth Anything V2 and MiDaS give inverse depth, stretched to its own min and max. Depth
 * Anything V3 gives depth (big is far) and the metric models depth in metres: those are turned over (1 / depth) first,
 * and a metric model's answer carries `range: [nearest, farthest]` in metres, so a pixel's distance is
 * 1 / mix(1 / farthest, 1 / nearest, nearness) exactly (metricDistance).
 */
import type { DepthBackend, DepthDtype, DepthOutput, DepthPreprocess } from './config';

export interface DepthWorkerConfig {
  model: string;
  repo: string;
  revision: string;
  dtype: Record<DepthBackend, DepthDtype>;
  /** Load from the app's own files (a local check or a desktop bundle), not the network. */
  local: boolean;
  /** The local models folder, root-relative (`/depth-models/`). */
  localPath: string;
  /** Try WebGPU first. */
  webgpu: boolean;
  /** What the output means (default inverse depth). */
  output?: DepthOutput;
  /** How a frame is prepared (default the repo's processor). */
  preprocess?: DepthPreprocess;
  /** The .onnx files' folder ('' for the repo's root; default onnx). */
  subfolder?: string;
  /** Weights in an external `_data` file beside the .onnx. */
  externalData?: boolean;
  /** A Transformers.js class to load with, when the repo's model_type has none. */
  modelClass?: string;
}

/** One loaded model: an RGB frame in, raw depth out (any scale), at the model's working size. */
export type Estimator = (rgb: Uint8ClampedArray, w: number, h: number, side: number) => Promise<{ data: ArrayLike<number>; w: number; h: number }>;

export type Progress = { file: string; loaded?: number; total?: number; done?: boolean };

export interface DepthLoader {
  load(cfg: DepthWorkerConfig, backend: DepthBackend, onProgress: (p: Progress) => void): Promise<Estimator>;
  /** WebGPU with shader-f16 (fp16 and q4f16 need it). */
  hasWebGpuF16(): Promise<boolean>;
}

type Post = (m: unknown, transfer?: Transferable[]) => void;

/** RGBA (optionally bottom-up, as WebGL reads) to top-down RGB. */
export function rgbaToRgb(rgba: ArrayLike<number>, w: number, h: number, flipY: boolean): Uint8ClampedArray {
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = flipY ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const s = (sy * w + x) * 4, d = (y * w + x) * 3;
      rgb[d] = rgba[s]; rgb[d + 1] = rgba[s + 1]; rgb[d + 2] = rgba[s + 2];
    }
  }
  return rgb;
}

/** Depth (big is far) turned into inverse depth, so it stretches the same way as the inverse-depth models'. */
export function invertDepth(data: ArrayLike<number>): { inv: Float32Array; near: number; far: number } {
  const n = data.length, inv = new Float32Array(n);
  let near = Infinity, far = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.max(Number(data[i]), 1e-4);
    inv[i] = 1 / d;
    if (d < near) near = d;
    if (d > far) far = d;
  }
  return { inv, near: Number.isFinite(near) ? near : 0, far };
}

/** A metric model's pixel distance (metres) from its nearness and the frame's range: the inverse of the stretch. */
export function metricDistance(nearness: number, near: number, far: number): number {
  const inv = (1 / Math.max(far, 1e-4)) * (1 - nearness) + (1 / Math.max(near, 1e-4)) * nearness;
  return 1 / Math.max(inv, 1e-6);
}

/** Stretch raw depth to 0–1 over its own range (a flat frame reads 0). */
export function normalizeDepth(data: ArrayLike<number>): Float32Array {
  const n = data.length, out = new Float32Array(n);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const v = Number(data[i]); if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo;
  if (!(span > 1e-12)) return out;
  const k = 1 / span;
  for (let i = 0; i < n; i++) out[i] = (Number(data[i]) - lo) * k;
  return out;
}

export function createDepthWorker(loader: DepthLoader, post: Post) {
  const models = new Map<string, { run: Estimator; backend: DepthBackend; ms: number; output: DepthOutput }>();
  const loading = new Map<string, Promise<void>>();

  async function load(id: number, cfg: DepthWorkerConfig): Promise<void> {
    const t0 = performance.now();
    const onProgress = (p: Progress) => post({ type: 'progress', id, model: cfg.model, ...p });
    let backend: DepthBackend = cfg.webgpu && (await loader.hasWebGpuF16()) ? 'webgpu' : 'wasm';
    let run: Estimator;
    try { run = await loader.load(cfg, backend, onProgress); } catch (e) {
      if (backend !== 'webgpu') throw e;
      console.warn('[depth] WebGPU failed, using WebAssembly', e);
      backend = 'wasm';
      run = await loader.load(cfg, backend, onProgress);
    }
    models.set(cfg.model, { run, backend, ms: Math.round(performance.now() - t0), output: cfg.output ?? 'inverse' });
  }

  return async function onMessage(m: { type: string; id: number; cfg?: DepthWorkerConfig; model?: string; rgba?: Uint8Array; w?: number; h?: number; flipY?: boolean; side?: number }): Promise<void> {
    try {
      if (m.type === 'load') {
        const cfg = m.cfg!;
        let p = loading.get(cfg.model);
        if (!p) { p = load(m.id, cfg).catch(e => { loading.delete(cfg.model); throw e; }); loading.set(cfg.model, p); }
        await p;
        const got = models.get(cfg.model)!;
        post({ type: 'ready', id: m.id, model: cfg.model, backend: got.backend, ms: got.ms });
        return;
      }
      if (m.type === 'unload') {
        models.delete(m.model!); loading.delete(m.model!);
        post({ type: 'unloaded', id: m.id, model: m.model });
        return;
      }
      if (m.type === 'depth') {
        const got = models.get(m.model!);
        if (!got) throw new Error('That depth model isn’t loaded');
        const t0 = performance.now();
        const rgb = rgbaToRgb(m.rgba!, m.w!, m.h!, !!m.flipY);
        const out = await got.run(rgb, m.w!, m.h!, m.side ?? 518);
        const kind = got.output;
        let depth: Float32Array, range: [number, number] | undefined;
        if (kind === 'inverse') depth = normalizeDepth(out.data);
        else {
          const t = invertDepth(out.data);
          depth = normalizeDepth(t.inv);
          if (kind === 'metric') range = [t.near, t.far];
        }
        post({ type: 'depth', id: m.id, depth, w: out.w, h: out.h, ms: performance.now() - t0, ...(range ? { range } : {}) }, [depth.buffer]);
        return;
      }
      throw new Error(`Unknown message ${m.type}`);
    } catch (e) {
      post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) });
    }
  };
}

/** The model's input size for a frame: the long side `side`, both sides a multiple of `multiple` (at least one step). */
export function inputSize(w: number, h: number, side: number, multiple: number): { w: number; h: number } {
  const k = side / Math.max(w, h, 1);
  const snap = (v: number) => Math.max(multiple, Math.round((v * k) / multiple) * multiple);
  return { w: snap(w), h: snap(h) };
}

const IMAGENET_MEAN = [0.485, 0.456, 0.406], IMAGENET_STD = [0.229, 0.224, 0.225];

/**
 * A frame prepared by the worker itself, for repos without a usable processor (config.ts DepthPreprocess): bilinear
 * resize to `inputSize`, then (v / 255 − mean) / std, planar (CHW). `imagenet14`: ImageNet mean/std, sides a multiple
 * of 14, dims [1, 1, 3, h, w] (Depth Anything V3 takes a batch of views). `half32`: mean/std 0.5, a multiple of 32,
 * dims [1, 3, h, w] (ZoeDepth).
 */
export function preprocessFrame(rgb: ArrayLike<number>, w: number, h: number, side: number, mode: 'imagenet14' | 'half32'): { data: Float32Array; dims: number[]; w: number; h: number } {
  const multiple = mode === 'imagenet14' ? 14 : 32;
  const mean = mode === 'imagenet14' ? IMAGENET_MEAN : [0.5, 0.5, 0.5];
  const std = mode === 'imagenet14' ? IMAGENET_STD : [0.5, 0.5, 0.5];
  const t = inputSize(w, h, side, multiple);
  const data = new Float32Array(3 * t.w * t.h);
  const plane = t.w * t.h;
  for (let y = 0; y < t.h; y++) {
    const sy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / t.h - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < t.w; x++) {
      const sx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / t.w - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      for (let c = 0; c < 3; c++) {
        const a = Number(rgb[(y0 * w + x0) * 3 + c]), b = Number(rgb[(y0 * w + x1) * 3 + c]);
        const d = Number(rgb[(y1 * w + x0) * 3 + c]), e = Number(rgb[(y1 * w + x1) * 3 + c]);
        const v = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
        data[c * plane + y * t.w + x] = (v / 255 - mean[c]) / std[c];
      }
    }
  }
  return { data, dims: mode === 'imagenet14' ? [1, 1, 3, t.h, t.w] : [1, 3, t.h, t.w], w: t.w, h: t.h };
}
