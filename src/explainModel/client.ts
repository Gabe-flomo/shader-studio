/**
 * client.ts — the explanation model in the app (docs/explain-model.md): a small language model in its own
 * Web Worker, loaded only after the user opts in (a one-time download, then kept by the browser), never at
 * app start, never bundled, never talking to anything but Hugging Face for those files.
 *
 *   explainStream(req, onText) → streams the answer (cached by code + context)
 *   downloadExplainModel()     → the opt-in download, with progress
 *   removeExplainModel()       → forget the files
 *
 * Off, or not downloaded, nothing here runs and the deterministic explainer works exactly as before.
 */
import { create } from 'zustand';
import { EXPLAIN_MODEL, downloadBytes, type Backend } from './config';
import { AnswerCache, answerKey } from './cache';
import type { ChatMessage, WorkerConfig } from './worker';

const ENABLED_KEY = 'shader-studio:settings:useExplainModel';
const DOWNLOADED_KEY = 'shader-studio:settings:explainModelDownloaded';

const query = (): string => { try { return typeof location === 'undefined' ? '' : location.search; } catch { return ''; } };

function readFlag(key: string): boolean | null {
  try { const v = localStorage.getItem(key); return v === null ? null : v === '1'; } catch { return null; }
}
function writeFlag(key: string, v: boolean): void {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private window */ }
}

export type ExplainModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ExplainModelState {
  /** The setting: use the explanation model. */
  enabled: boolean;
  /** The files were downloaded once (the browser keeps them). */
  downloaded: boolean;
  status: ExplainModelStatus;
  progress: { loaded: number; total: number } | null;
  backend: Backend | null;
  loadMs: number | null;
  /** Speed of the last answer, tokens a second. */
  tokensPerSec: number | null;
  error: string | null;
}

function initial(): ExplainModelState {
  const downloaded = readFlag(DOWNLOADED_KEY) === true;
  const setting = readFlag(ENABLED_KEY);
  return { enabled: setting ?? downloaded, downloaded, status: 'idle', progress: null, backend: null, loadMs: null, tokensPerSec: null, error: null };
}

export const useExplainModel = create<ExplainModelState>(() => initial());

/** On, and the files are here: the model can answer without asking. */
export const explainModelUsable = (s: ExplainModelState = useExplainModel.getState()): boolean => s.enabled && s.downloaded;

// ── The transport: the worker, or (tests) anything that streams text ──────────

export interface GenerateOptions { maxTokens: number; signal?: AbortSignal }
export interface ExplainTransport {
  /** Make the model ready (download it the first time). */
  load(): Promise<{ backend: Backend; ms: number }>;
  /** Stream an answer: `onText` gets each new piece. Resolves with the whole text and the speed. */
  generate(messages: ChatMessage[], o: GenerateOptions, onText: (piece: string) => void): Promise<{ text: string; tokens: number; ms: number }>;
  dispose(): void;
}

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; onText?: (t: string) => void }>();
const fileBytes = new Map<string, number>();

function startWorker(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'explain-model' });
  w.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { type: string; id: number; file?: string; loaded?: number; done?: boolean; total?: number; text?: string; message?: string };
    if (m.type === 'progress') {
      const known = [...EXPLAIN_MODEL.files, EXPLAIN_MODEL.weights.webgpu, EXPLAIN_MODEL.weights.wasm].find(f => m.file?.endsWith(f.path));
      if (m.file) fileBytes.set(m.file, m.done ? known?.bytes ?? m.total ?? 0 : m.loaded ?? 0);
      const backend = useExplainModel.getState().backend ?? 'webgpu';
      const loaded = [...fileBytes.values()].reduce((s, v) => s + v, 0);
      useExplainModel.setState({ progress: { loaded: Math.min(loaded, downloadBytes(backend)), total: downloadBytes(backend) } });
      return;
    }
    const p = waiting.get(m.id);
    if (!p) return;
    if (m.type === 'token') { p.onText?.(m.text ?? ''); return; }
    waiting.delete(m.id);
    if (m.type === 'error') p.fail(new Error(m.message ?? 'The explanation model failed'));
    else p.ok(m);
  };
  w.onerror = e => {
    const err = new Error(e.message || 'The explanation model’s worker failed');
    for (const p of waiting.values()) p.fail(err);
    waiting.clear();
  };
  return w;
}

function call<T>(msg: Record<string, unknown>, onText?: (t: string) => void): Promise<T> {
  const id = nextId++;
  return new Promise<T>((ok, fail) => {
    waiting.set(id, { ok: ok as (v: unknown) => void, fail, onText });
    worker!.postMessage({ ...msg, id });
  });
}

const workerTransport: ExplainTransport = {
  async load() {
    if (typeof Worker === 'undefined') throw new Error('This browser can’t run the explanation model (no Web Workers).');
    fileBytes.clear();
    worker ??= startWorker();
    const cfg: WorkerConfig = {
      repo: EXPLAIN_MODEL.repo, revision: EXPLAIN_MODEL.revision, dtype: { ...EXPLAIN_MODEL.dtype },
      webgpu: !/[?&]explainModel=wasm\b/.test(query()),
    };
    return call<{ backend: Backend; ms: number }>({ type: 'load', cfg });
  },
  async generate(messages, o, onText) {
    if (!worker) throw new Error('The explanation model isn’t loaded');
    const abort = () => worker?.postMessage({ type: 'abort' });
    o.signal?.addEventListener('abort', abort);
    try {
      return await call<{ text: string; tokens: number; ms: number }>({ type: 'generate', messages, maxTokens: o.maxTokens }, onText);
    } finally { o.signal?.removeEventListener('abort', abort); }
  },
  dispose() {
    worker?.terminate(); worker = null;
    for (const p of waiting.values()) p.fail(new Error('The explanation model was turned off'));
    waiting.clear();
  },
};

let transport: ExplainTransport = workerTransport;
/** Tests: swap in a fake model. Pass null to go back to the worker. */
export function setExplainTransport(t: ExplainTransport | null): void { transport = t ?? workerTransport; loadPromise = null; }

// ── Loading ───────────────────────────────────────────────────────────────────

let loadPromise: Promise<boolean> | null = null;

/** Load the model (lazily; once). Resolves true when it's ready, false when it's off, missing or failed. */
export function ensureExplainModel(retry = false): Promise<boolean> {
  if (!explainModelUsable()) return Promise.resolve(false);
  const status = useExplainModel.getState().status;
  if (status === 'ready') return Promise.resolve(true);
  if (status === 'error' && !retry) return Promise.resolve(false);
  return (loadPromise ??= load());
}

async function load(): Promise<boolean> {
  const st = useExplainModel.getState();
  useExplainModel.setState({ status: 'loading', error: null, progress: st.downloaded ? null : { loaded: 0, total: downloadBytes() } });
  try {
    const r = await transport.load();
    writeFlag(DOWNLOADED_KEY, true);
    useExplainModel.setState({ status: 'ready', backend: r.backend, loadMs: r.ms, progress: null, downloaded: true });
    return true;
  } catch (e) {
    console.warn('[explain model]', e);
    useExplainModel.setState({ status: 'error', error: e instanceof Error ? e.message : String(e), progress: null });
    loadPromise = null;
    transport.dispose();
    return false;
  }
}

/** The one-time opt-in download (and turn it on). Resolves true once the model is ready. */
export function downloadExplainModel(): Promise<boolean> {
  writeFlag(ENABLED_KEY, true);
  // Mark as present while it downloads so ensure/usable pass; a failed first download undoes it.
  const was = useExplainModel.getState().downloaded;
  useExplainModel.setState({ enabled: true, downloaded: true });
  return ensureExplainModel(true).then(ok => {
    if (!ok && !was && readFlag(DOWNLOADED_KEY) !== true) useExplainModel.setState({ downloaded: false });
    return ok;
  });
}

/** The setting. Off frees the worker and its memory; the files stay downloaded. */
export function setExplainModelEnabled(on: boolean): void {
  writeFlag(ENABLED_KEY, on);
  useExplainModel.setState({ enabled: on });
  if (!on) {
    transport.dispose(); loadPromise = null;
    useExplainModel.setState({ status: 'idle', backend: null, progress: null });
  } else if (useExplainModel.getState().status === 'error') useExplainModel.setState({ status: 'idle', error: null });
}

/** Forget the downloaded files (the browser's cache) and turn it off. */
export async function removeExplainModel(): Promise<void> {
  setExplainModelEnabled(false);
  try {
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const req of await c.keys()) if (req.url.includes(EXPLAIN_MODEL.repo)) await c.delete(req);
      }
    }
  } catch (e) { console.warn('[explain model] remove', e); }
  writeFlag(DOWNLOADED_KEY, false);
  writeFlag(ENABLED_KEY, false);
  answers.clear();
  useExplainModel.setState({ downloaded: false, enabled: false, status: 'idle', loadMs: null, tokensPerSec: null, error: null });
}

/** Read the settings again (App settings reset them). */
export function refreshExplainModelSettings(): void {
  const { enabled, downloaded } = initial();
  if (!enabled) setExplainModelEnabled(false);
  useExplainModel.setState({ enabled, downloaded });
}

// ── Answers ───────────────────────────────────────────────────────────────────

const answers = new AnswerCache(200);
export const explainAnswerCache = answers;

export interface ExplainRequest {
  /** 'line' (1–3 sentences), 'block' (a summary and a list) or 'node' (what a node does in its graph). */
  kind: 'line' | 'block' | 'node';
  /** The code asked about, and the context text (the prompt's facts): together they key the cache. */
  code: string;
  context: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export type ExplainOutcome = { ok: true; text: string; cached: boolean } | { ok: false; reason: 'off' | 'not-downloaded' | 'failed' | 'aborted'; message?: string };

/**
 * Ask the model, streaming: `onText` gets the whole answer so far each time it grows. A repeat of the
 * same code in the same context answers from the cache at once.
 */
export async function explainStream(req: ExplainRequest, onText: (soFar: string) => void, signal?: AbortSignal): Promise<ExplainOutcome> {
  const st = useExplainModel.getState();
  if (!st.enabled) return { ok: false, reason: 'off' };
  if (!st.downloaded) return { ok: false, reason: 'not-downloaded' };
  const key = answerKey(req.kind, req.code, req.context);
  const hit = answers.get(key);
  if (hit !== undefined) { onText(hit); return { ok: true, text: hit, cached: true }; }
  if (!(await ensureExplainModel())) return { ok: false, reason: 'failed', message: useExplainModel.getState().error ?? undefined };
  let soFar = '';
  try {
    const r = await transport.generate(req.messages, { maxTokens: req.maxTokens, signal }, piece => { soFar += piece; onText(soFar); });
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    const text = (r.text || soFar).trim();
    if (r.ms > 0 && r.tokens > 0) useExplainModel.setState({ tokensPerSec: Math.round((r.tokens / r.ms) * 10_000) / 10 });
    if (text) answers.set(key, text);
    return { ok: true, text, cached: false };
  } catch (e) {
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    return { ok: false, reason: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

/** For checking in dev: `window.__explainModel`. */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __explainModel?: unknown }).__explainModel = {
    useExplainModel, downloadExplainModel, ensureExplainModel, setExplainModelEnabled, removeExplainModel, explainStream,
    /** Raw chat, for the trial: no cache. */
    async raw(messages: ChatMessage[], maxTokens = 120, onText: (s: string) => void = () => {}) {
      await ensureExplainModel();
      const t0 = performance.now();
      const r = await transport.generate(messages, { maxTokens }, onText);
      return { ...r, wall: performance.now() - t0 };
    },
  };
}
