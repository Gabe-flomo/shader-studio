/**
 * workerCore.ts — the depth worker's message handling (docs/depth-node.md), apart from Transformers.js so the
 * tests can drive it with a mocked model. worker.ts plugs the real loader in.
 *
 * Messages in:
 *   { type: 'load', id, cfg }                                 load one model (WebGPU when it has shader-f16, else WebAssembly)
 *   { type: 'depth', id, model, rgba, w, h, flipY, side }     → { type: 'depth', id, depth, w, h, ms }
 *   { type: 'unload', id, model }                             free one model
 * Messages out: progress while loading, { type: 'ready', id, model, backend, ms }, { type: 'error', id, message }.
 *
 * Depth comes back as a Float32Array, 0–1 (the model's relative depth stretched to its own min and max), rows top
 * to bottom, at the size the model worked at. Both families give inverse depth: 1 is the nearest thing in the frame.
 */
import type { DepthBackend, DepthDtype } from './config';

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
  const models = new Map<string, { run: Estimator; backend: DepthBackend; ms: number }>();
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
    models.set(cfg.model, { run, backend, ms: Math.round(performance.now() - t0) });
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
        const depth = normalizeDepth(out.data);
        post({ type: 'depth', id: m.id, depth, w: out.w, h: out.h, ms: performance.now() - t0 }, [depth.buffer]);
        return;
      }
      throw new Error(`Unknown message ${m.type}`);
    } catch (e) {
      post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) });
    }
  };
}
