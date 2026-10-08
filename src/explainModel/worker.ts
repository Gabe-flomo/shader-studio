/// <reference lib="webworker" />
/**
 * worker.ts — the explanation model's worker (docs/explain-model.md): a small Qwen coder model through
 * Transformers.js, off the main thread so the UI never waits on it, streaming tokens as they are made.
 *
 * In:  { type: 'load', id, cfg }                              load tokenizer + model (WebGPU, else WASM)
 *      { type: 'generate', id, messages, maxTokens, temperature } → many { type: 'token', id, text }, then { type: 'done', id, text, tokens, firstMs, ms, logprobs }
 *                                                           (logprobs: for each token its text and the log-probability the model gave it)
 *      { type: 'unload', id }                                 free the model (only one is held at a time)
 *      { type: 'abort' }                                      stop the running generation
 * Out: progress while loading, { type: 'ready', id, backend, ms }, { type: 'error', id, message }.
 *
 * Files come from Hugging Face once and Transformers.js keeps them in this browser's Cache Storage
 * (the desktop webview's too): never bundled. ONNX Runtime's WebAssembly is served by the app itself.
 */
import { AutoModelForCausalLM, AutoTokenizer, InterruptableStoppingCriteria, LogitsProcessor, TextStreamer, env } from '@huggingface/transformers';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import type { Backend } from './config';

export interface WorkerConfig {
  /** Which model (the app's id), so a second load of the same one is a no-op and another one replaces it. */
  id: string;
  /** Reasons in a <think> pass: the chat template is told to let it. */
  thinks: boolean;
  repo: string;
  revision: string;
  dtype: { webgpu: string; wasm?: string };
  /** Try WebGPU first. */
  webgpu: boolean;
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type Tok = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Model = Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;

let state: { id: string; thinks: boolean; tok: Tok; model: Model; backend: Backend } | null = null;
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

/** Free the model's session (GPU buffers, WASM heap) before another is loaded: only one lives here at a time. */
async function unload(): Promise<void> {
  const old = state;
  state = null; loading = null;
  if (!old) return;
  try { await (old.model as unknown as { dispose?: () => Promise<void> }).dispose?.(); } catch (e) { console.warn('[explain model] dispose', e); }
}

async function load(id: number, cfg: WorkerConfig): Promise<void> {
  await unload();
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
  const open = (device: Backend) => AutoModelForCausalLM.from_pretrained(cfg.repo, { ...base, device, dtype: (cfg.dtype[device] ?? cfg.dtype.webgpu) as 'q4' });
  let backend: Backend = cfg.webgpu && (await hasWebGpuF16()) ? 'webgpu' : 'wasm';
  if (backend === 'wasm' && !cfg.dtype.wasm) throw new Error('This model needs WebGPU with 16-bit floats, which this browser does not have.');
  let model: Model;
  try { model = await open(backend); } catch (e) {
    if (backend !== 'webgpu') throw e;
    console.warn('[explain model] WebGPU failed, using WebAssembly', e);
    backend = 'wasm';
    model = await open('wasm');
  }
  state = { id: cfg.id, thinks: cfg.thinks, tok, model, backend };
  loadMs = Math.round(performance.now() - t0);
}

/** Records, for each step, the log-probability the model gave the token that was then chosen (read from its logits). */
class LogprobRecorder extends LogitsProcessor {
  private row: Float32Array | null = null;
  private lse = 0;
  // The library types `_call` as returning nothing, but its processor list passes the returned logits on
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _call(_ids: bigint[][], logits: any): any {
    const d = logits.data as Float32Array;
    let max = -Infinity;
    for (let i = 0; i < d.length; i++) if (d[i] > max) max = d[i];
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += Math.exp(d[i] - max);
    this.row = d; this.lse = max + Math.log(sum);
    return logits;
  }
  lpOf(token: number): number { return this.row ? this.row[token] - this.lse : NaN; }
}

async function generate(id: number, messages: ChatMessage[], maxTokens: number, temperature: number): Promise<void> {
  if (!state) throw new Error('The explanation model isn’t loaded');
  const { tok, model, thinks } = state;
  stopper.reset();
  const inputs = tok.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, enable_thinking: thinks } as Record<string, unknown>) as Record<string, unknown>;
  const t0 = performance.now();
  let firstMs = 0, tokens = 0, text = '';
  const rec = new LogprobRecorder();
  const logprobs: Array<{ t: string; lp: number }> = [];
  const streamer = new TextStreamer(tok, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      if (!firstMs) firstMs = performance.now() - t0;
      text += chunk;
      post({ type: 'token', id, text: chunk });
    },
    token_callback_function: (ids: bigint[]) => {
      tokens++;
      const piece = tok.decode(ids as unknown as number[], { skip_special_tokens: true });
      const lp = rec.lpOf(Number(ids[0]));
      if (piece && Number.isFinite(lp)) logprobs.push({ t: piece, lp: Math.round(lp * 1000) / 1000 });
    },
  });
  const sample = temperature > 0;
  await (model as unknown as { generate(o: Record<string, unknown>): Promise<unknown> }).generate({
    ...inputs, max_new_tokens: maxTokens, do_sample: sample, ...(sample ? { temperature, top_k: 40 } : {}), repetition_penalty: 1.1,
    streamer, stopping_criteria: stopper, logits_processor: [rec],
  });
  post({ type: 'done', id, text, tokens, firstMs, ms: performance.now() - t0, logprobs });
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data as { type: string; id: number; cfg?: WorkerConfig; messages?: ChatMessage[]; maxTokens?: number; temperature?: number };
  try {
    if (m.type === 'abort') { stopper.interrupt(); return; }
    if (m.type === 'unload') { await unload(); post({ type: 'unloaded', id: m.id }); return; }
    if (m.type === 'load') {
      if (state && state.id !== m.cfg!.id) { await unload(); }
      loading ??= load(m.id, m.cfg!).catch(e => { loading = null; throw e; });
      await loading;
      if (state) post({ type: 'ready', id: m.id, backend: state.backend, ms: loadMs });
      return;
    }
    if (m.type === 'generate') await generate(m.id, m.messages!, m.maxTokens ?? 120, m.temperature ?? 0);
  } catch (e) {
    post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
  }
};
