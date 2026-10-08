/**
 * client.ts — the explanation models in the app (docs/explain-model.md): small language models in their own
 * Web Worker, loaded only after the user opts in (a one-time download per model, then kept by the browser), never
 * at app start, never bundled, never talking to anything but Hugging Face for those files. Several can be
 * downloaded; one is active; only one is in memory at a time.
 *
 *   explainStream(req, onText) → streams the answer (cached by model + code + context)
 *   explainSamples(req, n)     → n sampled answers (temperature 0.7), for the double-check
 *   explainCompare(req, cb)    → the same prompt on every downloaded model, one after another
 *   downloadExplainModel(id)   → the opt-in download, with progress
 *   selectExplainModel(id)     → which one "Explain more" uses
 *   removeExplainModel(id)     → forget the files
 *
 * Off, or not downloaded, nothing here runs and the deterministic explainer works exactly as before.
 */
import { create } from 'zustand';
import { EXPLAIN_MODELS, DEFAULT_MODEL_ID, allFiles, downloadBytes, maxTokensFor, modelById, type Backend, type ExplainModelSpec } from './config';
import { AnswerCache, answerKey } from './cache';
import type { TokenLp } from './confidence';
import type { ChatMessage, WorkerConfig } from './worker';

const ENABLED_KEY = 'shader-studio:settings:useExplainModel';
const DOWNLOADED_KEY = 'shader-studio:settings:explainModelDownloaded';
const ACTIVE_KEY = 'shader-studio:settings:explainModelActive';
/** The first model keeps the key the single-model version used; others add their id. */
const downloadedKey = (id: string): string => (id === DEFAULT_MODEL_ID ? DOWNLOADED_KEY : `${DOWNLOADED_KEY}:${id}`);

const query = (): string => { try { return typeof location === 'undefined' ? '' : location.search; } catch { return ''; } };

function readFlag(key: string): boolean | null {
  try { const v = localStorage.getItem(key); return v === null ? null : v === '1'; } catch { return null; }
}
function writeFlag(key: string, v: boolean): void {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private window */ }
}
function readActive(): string {
  try { const v = localStorage.getItem(ACTIVE_KEY); if (v && EXPLAIN_MODELS.some(m => m.id === v)) return v; } catch { /* private window */ }
  return DEFAULT_MODEL_ID;
}
function writeActive(id: string): void {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* private window */ }
}

export type ExplainModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ExplainModelState {
  /** The setting: use the explanation model. */
  enabled: boolean;
  /** The ACTIVE model's files were downloaded once (the browser keeps them). */
  downloaded: boolean;
  /** The model "Explain more" uses. */
  activeId: string;
  /** Every model whose files are downloaded. */
  downloadedIds: string[];
  /** Which model is in the worker right now (only one at a time). */
  loadedId: string | null;
  /** The model being downloaded or loaded right now. */
  busyId: string | null;
  status: ExplainModelStatus;
  progress: { loaded: number; total: number } | null;
  backend: Backend | null;
  loadMs: number | null;
  /** Speed of the last answer, tokens a second. */
  tokensPerSec: number | null;
  error: string | null;
}

function initial(): ExplainModelState {
  const downloadedIds = EXPLAIN_MODELS.filter(m => readFlag(downloadedKey(m.id)) === true).map(m => m.id);
  const activeId = readActive();
  const downloaded = downloadedIds.includes(activeId);
  const setting = readFlag(ENABLED_KEY);
  return { enabled: setting ?? downloaded, downloaded, activeId, downloadedIds, loadedId: null, busyId: null, status: 'idle', progress: null, backend: null, loadMs: null, tokensPerSec: null, error: null };
}

export const useExplainModel = create<ExplainModelState>(() => initial());

/** On, and the active model's files are here: the model can answer without asking. */
export const explainModelUsable = (s: ExplainModelState = useExplainModel.getState()): boolean => s.enabled && s.downloaded;

/** The active model's spec. */
export const activeModel = (s: ExplainModelState = useExplainModel.getState()): ExplainModelSpec => modelById(s.activeId);

// ── The transport: the worker, or (tests) anything that streams text ──────────

export interface GenerateOptions { maxTokens: number; /** 0 = greedy (the default). */ temperature?: number; signal?: AbortSignal }
export interface GenerateResult {
  text: string; tokens: number; ms: number;
  /** Time to the first piece of text. */
  firstMs?: number;
  /** Each generated token's text and the log-probability the model gave it. */
  logprobs?: TokenLp[];
}
export interface ExplainTransport {
  /** Make a model ready (download it the first time). Replaces whichever model was loaded. */
  load(spec: ExplainModelSpec): Promise<{ backend: Backend; ms: number }>;
  /** Stream an answer: `onText` gets each new piece. Resolves with the whole text and the speed. */
  generate(messages: ChatMessage[], o: GenerateOptions, onText: (piece: string) => void): Promise<GenerateResult>;
  /** Free the loaded model. */
  unload?(): Promise<void>;
  dispose(): void;
}

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; onText?: (t: string) => void }>();
const fileBytes = new Map<string, number>();
let loadingSpec: ExplainModelSpec = modelById(DEFAULT_MODEL_ID);

function startWorker(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'explain-model' });
  w.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { type: string; id: number; file?: string; loaded?: number; done?: boolean; total?: number; text?: string; message?: string };
    if (m.type === 'progress') {
      // Files read back from this browser's cache report progress too: only a first download shows a bar
      if (!pendingDownload.has(loadingSpec.id)) return;
      const known = allFiles(loadingSpec).find(f => m.file?.endsWith(f.path));
      if (m.file) fileBytes.set(m.file, m.done ? known?.bytes ?? m.total ?? 0 : m.loaded ?? 0);
      const backend = useExplainModel.getState().backend ?? 'webgpu';
      const total = downloadBytes(backend, loadingSpec);
      const loaded = [...fileBytes.values()].reduce((s, v) => s + v, 0);
      useExplainModel.setState({ progress: { loaded: Math.min(loaded, total), total } });
      return;
    }
    const p = waiting.get(m.id);
    if (!p) return;
    if (m.type === 'token') { p.onText?.(m.text ?? ''); return; }
    waiting.delete(m.id);
    if (m.type === 'error') { if (import.meta.env.DEV) console.warn('[explain worker]', m.message, (m as { stack?: string }).stack); p.fail(new Error(m.message ?? 'The explanation model failed')); }
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
  async load(spec) {
    if (typeof Worker === 'undefined') throw new Error('This browser can’t run the explanation model (no Web Workers).');
    fileBytes.clear();
    loadingSpec = spec;
    worker ??= startWorker();
    const cfg: WorkerConfig = {
      id: spec.id, thinks: spec.thinks, repo: spec.repo, revision: spec.revision, dtype: { ...spec.dtype },
      webgpu: !/[?&]explainModel=wasm\b/.test(query()),
    };
    return call<{ backend: Backend; ms: number }>({ type: 'load', cfg });
  },
  async generate(messages, o, onText) {
    if (!worker) throw new Error('The explanation model isn’t loaded');
    const abort = () => worker?.postMessage({ type: 'abort' });
    o.signal?.addEventListener('abort', abort);
    try {
      return await call<GenerateResult>({ type: 'generate', messages, maxTokens: o.maxTokens, temperature: o.temperature ?? 0 }, onText);
    } finally { o.signal?.removeEventListener('abort', abort); }
  },
  async unload() { if (worker) await call({ type: 'unload' }); },
  dispose() {
    worker?.terminate(); worker = null;
    for (const p of waiting.values()) p.fail(new Error('The explanation model was turned off'));
    waiting.clear();
  },
};

let transport: ExplainTransport = workerTransport;
/** Tests: swap in a fake model. Pass null to go back to the worker. */
export function setExplainTransport(t: ExplainTransport | null): void {
  transport = t ?? workerTransport; loadPromise = null; loadingId = null;
  useExplainModel.setState({ loadedId: null, busyId: null });
}

// ── Loading ───────────────────────────────────────────────────────────────────

let loadPromise: Promise<boolean> | null = null;
let loadingId: string | null = null;
/** Models being downloaded for the first time: a failed first download forgets them again. */
const pendingDownload = new Set<string>();

/**
 * Load a model (lazily; once; replacing whichever is loaded). Default: the active one, and only if it is on and
 * downloaded. Resolves true when it's ready, false when it's off, missing or failed.
 */
export function ensureExplainModel(retry = false, id?: string): Promise<boolean> {
  const st = useExplainModel.getState();
  const want = id ?? st.activeId;
  if (id === undefined && !explainModelUsable(st)) return Promise.resolve(false);
  if (!st.downloadedIds.includes(want)) return Promise.resolve(false);
  if (st.loadedId === want && st.status === 'ready') return Promise.resolve(true);
  if (st.status === 'error' && !retry && st.busyId === null && st.loadedId === null && failedId === want) return Promise.resolve(false);
  if (loadPromise && loadingId === want) return loadPromise;
  const after = loadPromise ? loadPromise.catch(() => false) : Promise.resolve(false);
  loadingId = want;
  const p = after.then(() => load(want));
  loadPromise = p;
  void p.finally(() => { if (loadPromise === p) { loadPromise = null; loadingId = null; } });
  return p;
}

let failedId: string | null = null;

async function load(id: string): Promise<boolean> {
  const spec = modelById(id);
  const st = useExplainModel.getState();
  const first = pendingDownload.has(id);
  useExplainModel.setState({
    status: 'loading', busyId: id, error: null, loadedId: null,
    progress: first ? { loaded: 0, total: downloadBytes(st.backend ?? 'webgpu', spec) } : null,
  });
  try {
    const r = await transport.load(spec);
    writeFlag(downloadedKey(id), true);
    pendingDownload.delete(id);
    failedId = null;
    useExplainModel.setState(o => ({
      status: 'ready', backend: r.backend, loadMs: r.ms, progress: null, busyId: null, loadedId: id,
      downloadedIds: o.downloadedIds.includes(id) ? o.downloadedIds : [...o.downloadedIds, id],
      downloaded: o.activeId === id ? true : o.downloaded,
    }));
    return true;
  } catch (e) {
    console.warn('[explain model]', e);
    failedId = id;
    useExplainModel.setState({ status: 'error', error: e instanceof Error ? e.message : String(e), progress: null, loadedId: null, busyId: null });
    transport.dispose();
    return false;
  }
}

/** The one-time opt-in download of a model (default: the active one), making it the active one. Resolves true once it is ready. */
export function downloadExplainModel(id?: string): Promise<boolean> {
  const st0 = useExplainModel.getState();
  const want = id ?? st0.activeId;
  writeFlag(ENABLED_KEY, true);
  writeActive(want);
  const was = st0.downloadedIds.includes(want);
  if (!was) pendingDownload.add(want);
  // Mark as present while it downloads so ensure/usable pass; a failed first download undoes it.
  useExplainModel.setState(o => ({
    enabled: true, activeId: want, downloaded: true,
    downloadedIds: o.downloadedIds.includes(want) ? o.downloadedIds : [...o.downloadedIds, want],
  }));
  return ensureExplainModel(true, want).then(ok => {
    if (!ok && !was && readFlag(downloadedKey(want)) !== true) {
      pendingDownload.delete(want);
      useExplainModel.setState(o => { const ids = o.downloadedIds.filter(x => x !== want); return { downloadedIds: ids, downloaded: ids.includes(o.activeId) }; });
    }
    return ok;
  });
}

/** Choose the model "Explain more" uses. The previous one is freed from memory. */
export function selectExplainModel(id: string): void {
  if (!EXPLAIN_MODELS.some(m => m.id === id)) return;
  writeActive(id);
  const st = useExplainModel.getState();
  if (st.activeId === id) return;
  useExplainModel.setState({ activeId: id, downloaded: st.downloadedIds.includes(id), error: null, status: 'idle', progress: null });
  if (st.loadedId && st.loadedId !== id) {
    useExplainModel.setState({ loadedId: null });
    void transport.unload?.().catch(() => { /* gone with the worker */ });
  }
}

/** The setting. Off frees the worker and its memory; the files stay downloaded. */
export function setExplainModelEnabled(on: boolean): void {
  writeFlag(ENABLED_KEY, on);
  useExplainModel.setState({ enabled: on });
  if (!on) {
    transport.dispose(); loadPromise = null; loadingId = null;
    useExplainModel.setState({ status: 'idle', backend: null, progress: null, loadedId: null, busyId: null });
  } else if (useExplainModel.getState().status === 'error') useExplainModel.setState({ status: 'idle', error: null });
}

/** Forget a model's downloaded files (the browser's cache), default the active one. Turns the model off when none are left. */
export async function removeExplainModel(id?: string): Promise<void> {
  const st = useExplainModel.getState();
  const gone = id ?? st.activeId;
  const spec = modelById(gone);
  if (st.loadedId === gone || st.busyId === gone) { transport.dispose(); loadPromise = null; loadingId = null; }
  try {
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const req of await c.keys()) if (req.url.includes(spec.repo)) await c.delete(req);
      }
    }
  } catch (e) { console.warn('[explain model] remove', e); }
  writeFlag(downloadedKey(gone), false);
  const left = useExplainModel.getState().downloadedIds.filter(x => x !== gone);
  if (!left.length) writeFlag(ENABLED_KEY, false);
  answers.clear(); answerMeta.clear();
  useExplainModel.setState(o => ({
    downloadedIds: left,
    downloaded: left.includes(o.activeId),
    enabled: left.length ? o.enabled : false,
    ...(o.loadedId === gone || o.busyId === gone ? { status: 'idle' as const, loadedId: null, busyId: null, backend: null, progress: null, loadMs: null } : {}),
    tokensPerSec: null, error: null,
  }));
}

/** Read the settings again (App settings reset them). */
export function refreshExplainModelSettings(): void {
  const { enabled, downloaded, downloadedIds, activeId } = initial();
  if (!enabled) setExplainModelEnabled(false);
  useExplainModel.setState({ enabled, downloaded, downloadedIds, activeId });
}

// ── Answers ───────────────────────────────────────────────────────────────────

const answers = new AnswerCache(200);
export const explainAnswerCache = answers;

/** What was measured about an answer: its tokens' probabilities, and how long it took. */
export interface AnswerMeta {
  modelId: string;
  /** The answer exactly as generated (the tokens' text joins to this). */
  raw: string;
  tokens?: TokenLp[];
  ms: number;
  firstMs?: number;
  tokenCount: number;
  tokensPerSec?: number;
}
const answerMeta = new Map<string, AnswerMeta>();

export interface ExplainRequest {
  /** 'line' (one JSON object), 'block' (a summary and an object a line) or 'node' (what a node does in its graph). */
  kind: 'line' | 'block' | 'node';
  /** The code asked about, and the context text (the prompt's facts): together they key the cache. */
  code: string;
  context: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export type ExplainOutcome =
  | { ok: true; text: string; cached: boolean; meta?: AnswerMeta }
  | { ok: false; reason: 'off' | 'not-downloaded' | 'failed' | 'aborted'; message?: string };

const speed = (r: GenerateResult): number | undefined => (r.ms > 0 && r.tokens > 0 ? Math.round((r.tokens / r.ms) * 10_000) / 10 : undefined);
const metaOf = (modelId: string, r: GenerateResult, text: string): AnswerMeta => ({ modelId, raw: r.text || text, tokens: r.logprobs, ms: r.ms, firstMs: r.firstMs, tokenCount: r.tokens, tokensPerSec: speed(r) });

/**
 * Ask the model, streaming: `onText` gets the whole answer so far each time it grows (a thinking model's
 * `<think>` pass included; thinking.ts splits it). A repeat of the same code in the same context on the same
 * model answers from the cache at once.
 */
export async function explainStream(req: ExplainRequest, onText: (soFar: string) => void, signal?: AbortSignal): Promise<ExplainOutcome> {
  const st = useExplainModel.getState();
  if (!st.enabled) return { ok: false, reason: 'off' };
  if (!st.downloaded) return { ok: false, reason: 'not-downloaded' };
  const spec = modelById(st.activeId);
  const key = answerKey(req.kind, req.code, `${spec.id}\n${req.context}`);
  const hit = answers.get(key);
  if (hit !== undefined) { onText(hit); return { ok: true, text: hit, cached: true, meta: answerMeta.get(key) }; }
  if (!(await ensureExplainModel())) return { ok: false, reason: 'failed', message: useExplainModel.getState().error ?? undefined };
  let soFar = '';
  try {
    const r = await transport.generate(req.messages, { maxTokens: maxTokensFor(spec, req.maxTokens), signal }, piece => { soFar += piece; onText(soFar); });
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    const text = (r.text || soFar).trim();
    const sp = speed(r);
    if (sp !== undefined) useExplainModel.setState({ tokensPerSec: sp });
    const meta = metaOf(spec.id, r, soFar);
    if (text) { answers.set(key, text); answerMeta.set(key, meta); }
    return { ok: true, text, cached: false, meta };
  } catch (e) {
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    return { ok: false, reason: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

/** The double-check: `n` more answers to the same prompt, sampled at temperature 0.7. Never cached. */
export async function explainSamples(req: ExplainRequest, n = 2, signal?: AbortSignal, temperature = 0.7): Promise<string[]> {
  const st = useExplainModel.getState();
  if (!st.enabled || !st.downloaded || !(await ensureExplainModel())) return [];
  const spec = modelById(st.activeId);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) break;
    try {
      const r = await transport.generate(req.messages, { maxTokens: maxTokensFor(spec, req.maxTokens), temperature, signal }, () => {});
      out.push(r.text);
    } catch { break; }
  }
  return out;
}

export interface CompareResult {
  modelId: string;
  ok: boolean;
  text: string;
  meta?: AnswerMeta;
  error?: string;
}

/**
 * Compare models: the same prompt on every downloaded model, one after another (one is in memory at a time: the
 * worker frees the previous before it loads the next). `onResult` is called as each finishes, `onStart` before it loads.
 */
export async function explainCompare(
  req: ExplainRequest, onResult: (r: CompareResult) => void, signal?: AbortSignal,
  onStart: (id: string) => void = () => {}, onText: (id: string, soFar: string) => void = () => {},
): Promise<CompareResult[]> {
  const ids = useExplainModel.getState().downloadedIds.slice();
  const results: CompareResult[] = [];
  for (const id of ids) {
    if (signal?.aborted) break;
    onStart(id);
    const spec = modelById(id);
    let res: CompareResult;
    if (!(await ensureExplainModel(true, id))) {
      res = { modelId: id, ok: false, text: '', error: useExplainModel.getState().error ?? 'It did not load.' };
    } else {
      let soFar = '';
      try {
        const r = await transport.generate(req.messages, { maxTokens: maxTokensFor(spec, req.maxTokens), signal }, p => { soFar += p; onText(id, soFar); });
        res = { modelId: id, ok: true, text: (r.text || soFar).trim(), meta: metaOf(id, r, soFar) };
      } catch (e) {
        res = { modelId: id, ok: false, text: soFar, error: signal?.aborted ? 'Stopped.' : e instanceof Error ? e.message : String(e) };
      }
    }
    results.push(res);
    onResult(res);
  }
  return results;
}

/** For checking in dev: `window.__explainModel`. */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __explainModel?: unknown }).__explainModel = {
    useExplainModel, downloadExplainModel, ensureExplainModel, setExplainModelEnabled, selectExplainModel, removeExplainModel, explainStream, explainSamples, explainCompare,
    /** Raw chat, for the trial: no cache. */
    async raw(messages: ChatMessage[], maxTokens = 120, onText: (s: string) => void = () => {}, temperature = 0) {
      await ensureExplainModel();
      const t0 = performance.now();
      const spec = modelById(useExplainModel.getState().activeId);
      const r = await transport.generate(messages, { maxTokens: maxTokensFor(spec, maxTokens), temperature }, onText);
      return { ...r, wall: performance.now() - t0 };
    },
  };
}
