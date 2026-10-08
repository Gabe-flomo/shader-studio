/// <reference lib="webworker" />
/**
 * worker.ts — the explanation model's worker (docs/explain-model.md): a small Qwen coder model through
 * Transformers.js, off the main thread so the UI never waits on it, streaming tokens as they are made.
 *
 * In:  { type: 'load', id, cfg }                              load tokenizer + model (WebGPU, else WASM)
 *      { type: 'generate', id, messages, maxTokens }          → many { type: 'token', id, text }, then { type: 'done', id, text, tokens, firstMs, ms }
 *      { type: 'abort' }                                      stop the running generation
 * Out: progress while loading, { type: 'ready', id, backend, ms }, { type: 'error', id, message }.
 *
 * Files come from Hugging Face once and Transformers.js keeps them in this browser's Cache Storage
 * (the desktop webview's too): never bundled. ONNX Runtime's WebAssembly is served by the app itself.
 */
import { AutoModelForCausalLM, AutoTokenizer, InterruptableStoppingCriteria, TextStreamer, env } from '@huggingface/transformers';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import type { Backend } from './config';

export interface WorkerConfig {
  repo: string;
  revision: string;
  dtype: { webgpu: string; wasm: string };
  /** Try WebGPU first. */
  webgpu: boolean;
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type Tok = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Model = Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;

let state: { tok: Tok; model: Model; backend: Backend } | null = null;
let loading: Promise<void> | null = null;
let loadMs = 0;
const stopper = new InterruptableStoppingCriteria();

const post = (m: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

async function hasWebGpuF16(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    if (!gpu) return false;
    const a = await gpu.requestAdapter();
    return !!a && a.features.has('shader-f16');
  } catch { return false; }
}

async function load(id: number, cfg: WorkerConfig): Promise<void> {
  const t0 = performance.now();
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
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
  const open = (device: Backend) => AutoModelForCausalLM.from_pretrained(cfg.repo, { ...base, device, dtype: cfg.dtype[device] as 'q4' });
  let backend: Backend = cfg.webgpu && (await hasWebGpuF16()) ? 'webgpu' : 'wasm';
  let model: Model;
  try { model = await open(backend); } catch (e) {
    if (backend !== 'webgpu') throw e;
    console.warn('[explain model] WebGPU failed, using WebAssembly', e);
    backend = 'wasm';
    model = await open('wasm');
  }
  state = { tok, model, backend };
  loadMs = Math.round(performance.now() - t0);
}

async function generate(id: number, messages: ChatMessage[], maxTokens: number): Promise<void> {
  if (!state) throw new Error('The explanation model isn’t loaded');
  const { tok, model } = state;
  stopper.reset();
  const inputs = tok.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true }) as Record<string, unknown>;
  const t0 = performance.now();
  let firstMs = 0, tokens = 0, text = '';
  const streamer = new TextStreamer(tok, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      if (!firstMs) firstMs = performance.now() - t0;
      text += chunk;
      post({ type: 'token', id, text: chunk });
    },
    token_callback_function: () => { tokens++; },
  });
  await (model as unknown as { generate(o: Record<string, unknown>): Promise<unknown> }).generate({
    ...inputs, max_new_tokens: maxTokens, do_sample: false, repetition_penalty: 1.1, streamer, stopping_criteria: stopper,
  });
  post({ type: 'done', id, text, tokens, firstMs, ms: performance.now() - t0 });
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data as { type: string; id: number; cfg?: WorkerConfig; messages?: ChatMessage[]; maxTokens?: number };
  try {
    if (m.type === 'abort') { stopper.interrupt(); return; }
    if (m.type === 'load') {
      loading ??= load(m.id, m.cfg!).catch(e => { loading = null; throw e; });
      await loading;
      if (state) post({ type: 'ready', id: m.id, backend: state.backend, ms: loadMs });
      return;
    }
    if (m.type === 'generate') await generate(m.id, m.messages!, m.maxTokens ?? 120);
  } catch (e) {
    post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) });
  }
};
