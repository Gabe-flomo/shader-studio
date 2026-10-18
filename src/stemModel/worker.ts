/// <reference lib="webworker" />
/**
 * worker.ts — the stem separation worker (docs/stems.md): HT-Demucs on ONNX Runtime Web, off the main thread. The
 * messages are in workerCore.ts; the sums around the model in dsp.ts and runners.ts.
 *
 * WebGPU (with shader-f16) first: the split 4-stem model runs as 21 chained sessions whose in-between tensors stay
 * on the GPU; piece 0's input normalisation runs on the CPU (it overflows in fp16 on WebGPU). Else WebAssembly, with
 * threads when the page is cross-origin isolated (the desktop app: src-tauri/tauri.conf.json), one thread otherwise.
 *
 * Files come from Hugging Face once, pinned and checked (SHA-256), and are kept in this browser's Cache Storage
 * (the same cache as the depth models). ONNX Runtime's WebAssembly is served by the app (imported with ?url), never a CDN.
 */
import * as ort from 'onnxruntime-web/webgpu';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { STEM_CACHE } from './config';
import { encodeStem } from './encode';
import { createStemWorker, fetchChecked, type LoadedBackend, type StemRuntime } from './workerCore';

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

const threads = (): number => (self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 1);

ort.env.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href, mjs: new URL(ortMjs, self.location.href).href };
ort.env.wasm.numThreads = threads();
// Piece 0's CPU-pinned nodes make ONNX Runtime warn on every load: only errors in the console.
ort.env.logLevel = 'error';

let cache: Promise<Cache | null> | null = null;
const openCache = (): Promise<Cache | null> => (cache ??= (typeof caches !== 'undefined' ? caches.open(STEM_CACHE).catch(() => null) : Promise.resolve(null)));

type T = ort.Tensor;

const runtime: StemRuntime<T> = {
  async hasWebGpuF16() {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
      if (!gpu) return false;
      const a = await gpu.requestAdapter();
      return !!a && a.features.has('shader-f16');
    } catch { return false; }
  },
  async fetchFile(url, f, onBytes, useCache) {
    return fetchChecked(url, f, onBytes, { cache: useCache ? await openCache() : null });
  },
  async open(files, backend, o): Promise<LoadedBackend<T>> {
    const sessions: ort.InferenceSession[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const gpu = backend === 'webgpu';
        const ep = gpu ? (i === 0 && o.cpuNodes?.length ? [{ name: 'webgpu', forceCpuNodeNames: o.cpuNodes } as unknown as ort.InferenceSession.ExecutionProviderConfig] : ['webgpu']) : ['wasm'];
        sessions.push(await ort.InferenceSession.create(files[i], {
          executionProviders: ep,
          graphOptimizationLevel: 'all',
          // On the GPU the tensors between pieces stay there.
          ...(gpu ? { preferredOutputLocation: 'gpu-buffer' as const } : {}),
        }));
      }
    } catch (e) {
      for (const s of sessions) await s.release().catch(() => {});
      throw e;
    }
    return {
      tensor: (data, dims) => new ort.Tensor('float32', data, dims),
      run: (i, feeds) => sessions[i].run(feeds),
      read: async t => (t.location === 'cpu' ? t.data : await t.getData(true)) as Float32Array,
      dispose: t => { try { if (t.location !== 'cpu') t.dispose(); } catch { /* gone */ } },
      release: async () => { for (const s of sessions) await s.release().catch(() => {}); },
    };
  },
  threads,
  encode: (left, right, sampleRate) => encodeStem(left, right, sampleRate),
};

const onMessage = createStemWorker(runtime, post);
self.onmessage = (ev: MessageEvent) => { void onMessage(ev.data); };
