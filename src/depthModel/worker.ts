/// <reference lib="webworker" />
/**
 * worker.ts — the depth models' worker (docs/depth-node.md): Depth Anything V2 and MiDaS through Transformers.js,
 * off the main thread, so the picture never waits on them. The messages are in workerCore.ts.
 *
 * Web: files come from Hugging Face once (pinned revisions) and Transformers.js keeps them in this browser's Cache
 * Storage. Local (`?depthModel=local`): from the app's own files, never the network. ONNX Runtime's WebAssembly is
 * always served by the app (imported with ?url below), never a CDN.
 */
import { AutoModelForDepthEstimation, AutoProcessor, env, RawImage, Tensor } from '@huggingface/transformers';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { createDepthWorker, type DepthLoader, type Estimator } from './workerCore';

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

const loader: DepthLoader = {
  async hasWebGpuF16() {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
      if (!gpu) return false;
      const a = await gpu.requestAdapter();
      return !!a && a.features.has('shader-f16');
    } catch { return false; }
  },
  async load(cfg, backend, onProgress): Promise<Estimator> {
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
      if (p.status === 'progress' && p.file) onProgress({ file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
      else if (p.status === 'done' && p.file) onProgress({ file: p.file, done: true });
    };
    const base = { revision: cfg.revision, progress_callback };
    const processor = await AutoProcessor.from_pretrained(cfg.repo, base);
    const model = await AutoModelForDepthEstimation.from_pretrained(cfg.repo, { ...base, device: backend, dtype: cfg.dtype[backend] });
    const ip = ((processor as unknown as { image_processor?: { size?: unknown } }).image_processor ?? processor) as { size?: unknown };
    return async (rgb, w, h, side) => {
      // The model's input side: the processor resizes to it (Depth Anything keeps the aspect, to a multiple of 14).
      ip.size = { width: side, height: side };
      const inputs = await processor(new RawImage(rgb, w, h, 3));
      const out = await (model as unknown as (i: unknown) => Promise<{ predicted_depth: Tensor }>)(inputs);
      let t = out.predicted_depth;
      if (t.type !== 'float32') t = t.to('float32');
      const [hh, ww] = t.dims.slice(-2);
      return { data: t.data as Float32Array, w: ww, h: hh };
    };
  },
};

const onMessage = createDepthWorker(loader, post);
self.onmessage = (ev: MessageEvent) => { void onMessage(ev.data); };
