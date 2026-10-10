/// <reference lib="webworker" />
/**
 * worker.ts — the depth models' worker (docs/depth-node.md): Depth Anything V2 / V3, MiDaS, Depth Pro and ZoeDepth
 * through Transformers.js,
 * off the main thread, so the picture never waits on them. The messages are in workerCore.ts.
 *
 * Web: files come from Hugging Face once (pinned revisions) and Transformers.js keeps them in this browser's Cache
 * Storage. Local (`?depthModel=local`): from the app's own files, never the network. ONNX Runtime's WebAssembly is
 * always served by the app (imported with ?url below), never a CDN.
 */
import { AutoModelForDepthEstimation, AutoProcessor, DPTForDepthEstimation, env, RawImage, Tensor } from '@huggingface/transformers';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { createDepthWorker, preprocessFrame, type DepthLoader, type Estimator } from './workerCore';

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
    const opts = {
      ...base, device: backend, dtype: cfg.dtype[backend],
      ...(cfg.subfolder !== undefined ? { subfolder: cfg.subfolder } : {}),
      ...(cfg.externalData ? { use_external_data_format: true } : {}),
    };
    // ZoeDepth's model_type has no Transformers.js class: it runs as a plain DPT-style session (pixel_values → predicted_depth).
    const Model = cfg.modelClass === 'DPTForDepthEstimation' ? DPTForDepthEstimation : AutoModelForDepthEstimation;
    const model = await Model.from_pretrained(cfg.repo, opts as Parameters<typeof AutoModelForDepthEstimation.from_pretrained>[1]);
    const call = model as unknown as (i: unknown) => Promise<{ predicted_depth: Tensor }>;
    const own = cfg.preprocess === 'imagenet14' || cfg.preprocess === 'half32' ? cfg.preprocess : null;
    const processor = own ? null : await AutoProcessor.from_pretrained(cfg.repo, base);
    const ip = (processor ? ((processor as unknown as { image_processor?: object }).image_processor ?? processor) : {}) as { size?: unknown; do_resize?: boolean };
    return async (rgb, w, h, side) => {
      let inputs: unknown;
      if (own) {
        // No usable processor in the repo: resized and normalised here (workerCore.preprocessFrame).
        const f = preprocessFrame(rgb, w, h, side, own);
        inputs = { pixel_values: new Tensor('float32', f.data, f.dims) };
      } else if (ip.do_resize === false) {
        // Depth Pro's processor doesn't resize: the frame goes in at the model's own square side.
        const img = await new RawImage(rgb, w, h, 3).resize(side, side);
        inputs = await processor!(img);
      } else {
        // The model's input side: the processor resizes to it (Depth Anything keeps the aspect, to a multiple of 14).
        ip.size = { width: side, height: side };
        inputs = await processor!(new RawImage(rgb, w, h, 3));
      }
      const out = await call(inputs);
      let t = out.predicted_depth;
      if (t.type !== 'float32') t = t.to('float32');
      const [hh, ww] = t.dims.slice(-2);
      return { data: t.data as Float32Array, w: ww, h: hh };
    };
  },
};

const onMessage = createDepthWorker(loader, post);
self.onmessage = (ev: MessageEvent) => { void onMessage(ev.data); };
