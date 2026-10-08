/// <reference lib="webworker" />
/**
 * worker.ts — the image model's worker (docs/taste.md "How things look"): MobileCLIP-S0 through
 * Transformers.js, off the main thread so the UI never waits on it.
 *
 * Messages in:  { type: 'load', id, cfg }   load the tokenizer, processor and both towers (WebGPU, else WASM)
 *               { type: 'image', id, rgba, w, h, flipY }   → { type: 'embedding', id, vec, ms }
 *               { type: 'text', id, texts }   → { type: 'embeddings', id, vecs, ms }
 * Messages out: progress while loading, { type: 'ready', id, backend, ms }, { type: 'error', id, message }.
 *
 * Web: files come from Hugging Face once and Transformers.js keeps them in this browser's Cache Storage.
 * Desktop: from the app's own bundle (`local`), never the network. ONNX Runtime's WebAssembly is always
 * served by the app (imported with ?url below), never a CDN.
 */
import { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, env, RawImage } from '@huggingface/transformers';
// ONNX Runtime's WebAssembly, served by the app (never a CDN): Vite emits these as assets of this worker.
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

export interface WorkerConfig {
  repo: string;
  revision: string;
  dtype: { vision: string; text: string };
  /** Load from the app's own files (desktop), not the network. */
  local: boolean;
  /**
   * The bundled models folder, root-relative (`/models/`): Transformers.js only reads local files from a
   * path, not an absolute URL (it skips a local path that parses as a URL).
   */
  localPath: string;
  /** Try WebGPU first. */
  webgpu: boolean;
}

type Proc = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
type Tok = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Vision = Awaited<ReturnType<typeof CLIPVisionModelWithProjection.from_pretrained>>;
type Text = Awaited<ReturnType<typeof CLIPTextModelWithProjection.from_pretrained>>;

let models: { proc: Proc; tok: Tok; vision: Vision; text: Text; backend: 'webgpu' | 'wasm' } | null = null;
let loading: Promise<void> | null = null;
let loadMs = 0;

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

async function hasWebGpuF16(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    if (!gpu) return false;
    const a = await gpu.requestAdapter();
    // The vision tower is fp16: WebGPU needs shader-f16 for it.
    return !!a && a.features.has('shader-f16');
  } catch { return false; }
}

async function load(id: number, cfg: WorkerConfig): Promise<void> {
  const t0 = performance.now();
  env.allowLocalModels = cfg.local;
  env.allowRemoteModels = !cfg.local;
  env.localModelPath = cfg.localPath;
  env.useBrowserCache = !cfg.local;
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href, mjs: new URL(ortMjs, self.location.href).href };
    if (!self.crossOriginIsolated) onnx.wasm.numThreads = 1;
  }
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress' && p.file) post({ type: 'progress', id, file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    else if (p.status === 'done' && p.file) post({ type: 'progress', id, file: p.file, done: true });
  };
  const base = { revision: cfg.revision, progress_callback };
  const tok = await AutoTokenizer.from_pretrained(cfg.repo, base);
  const proc = await AutoProcessor.from_pretrained(cfg.repo, base);
  const tryDevice = async (device: 'webgpu' | 'wasm') => {
    const vision = await CLIPVisionModelWithProjection.from_pretrained(cfg.repo, { ...base, device, dtype: cfg.dtype.vision as 'fp16' });
    const text = await CLIPTextModelWithProjection.from_pretrained(cfg.repo, { ...base, device: device === 'webgpu' ? 'wasm' : device, dtype: cfg.dtype.text as 'q8' });
    return { vision, text };
  };
  let backend: 'webgpu' | 'wasm' = cfg.webgpu && (await hasWebGpuF16()) ? 'webgpu' : 'wasm';
  let towers: { vision: Vision; text: Text };
  try { towers = await tryDevice(backend); } catch (e) {
    if (backend !== 'webgpu') throw e;
    console.warn('[image model] WebGPU failed, using WebAssembly', e);
    backend = 'wasm';
    towers = await tryDevice('wasm');
  }
  models = { proc, tok, ...towers, backend };
  loadMs = Math.round(performance.now() - t0);
}

function toRawImage(rgba: Uint8Array, w: number, h: number, flipY: boolean): RawImage {
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = flipY ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const s = (sy * w + x) * 4, d = (y * w + x) * 3;
      rgb[d] = rgba[s]; rgb[d + 1] = rgba[s + 1]; rgb[d + 2] = rgba[s + 2];
    }
  }
  return new RawImage(rgb, w, h, 3);
}

function unit(data: ArrayLike<number>, from = 0, n = data.length): Float32Array {
  const out = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) { out[i] = Number(data[from + i]); s += out[i] * out[i]; }
  const k = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data as { type: string; id: number; cfg?: WorkerConfig; rgba?: Uint8Array; w?: number; h?: number; flipY?: boolean; texts?: string[] };
  try {
    if (m.type === 'load') {
      loading ??= load(m.id, m.cfg!).catch(e => { loading = null; throw e; });
      await loading;
      if (models) post({ type: 'ready', id: m.id, backend: models.backend, ms: loadMs });
      return;
    }
    if (!models) throw new Error('The image model isn’t loaded');
    if (m.type === 'image') {
      const t0 = performance.now();
      const inputs = await models.proc(toRawImage(m.rgba!, m.w!, m.h!, !!m.flipY));
      const { image_embeds } = await models.vision(inputs);
      const vec = unit(image_embeds.data as Float32Array);
      post({ type: 'embedding', id: m.id, vec, ms: performance.now() - t0 }, [vec.buffer]);
      return;
    }
    if (m.type === 'text') {
      const t0 = performance.now();
      const inputs = models.tok(m.texts!, { padding: 'max_length', truncation: true });
      const { text_embeds } = await models.text(inputs);
      const data = text_embeds.data as Float32Array;
      const d = data.length / m.texts!.length;
      const vecs = m.texts!.map((_, i) => unit(data, i * d, d));
      post({ type: 'embeddings', id: m.id, vecs, ms: performance.now() - t0 }, vecs.map(v => v.buffer));
    }
  } catch (e) {
    post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) });
  }
};
