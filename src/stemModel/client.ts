/**
 * client.ts — the stem models in the app (docs/stems.md): one Web Worker, started the first time a downloaded model
 * is used (never at app start).
 *
 *   downloadStemModel(id)                       the opt-in download (with progress): only after the person said yes
 *   separateStems(id, left, right, sr, …)       a whole song → its stems, encoded (Opus/WebM, else WAV)
 *   stemModelUsable(id)                         downloaded (or served locally): it may run without asking
 *   forgetStemModel(id)                         unload it and offer the download again
 *
 * Nothing touches the network until downloadStemModel: separateStems refuses a model that isn't downloaded, without
 * starting the worker. Dev: `?stemModel=local` reads the files from `.cache/stem-models/` (vite.config.ts),
 * `?stemModel=wasm` forces WebAssembly; `window.__stemModel` exposes this module.
 */
import { create } from 'zustand';
import { LOCAL_STEM_DIR, STEM_MODELS, stemDownloadBytes, stemFileUrl, stemModelById, type StemBackend } from './config';
import type { StemWorkerConfig } from './workerCore';
import type { EncodedStem } from './encode';
import type { StemName } from './config';

const downloadedKey = (id: string) => `shader-studio:stemModel:${id}:downloaded`;

const query = (): string => { try { return typeof location === 'undefined' ? '' : location.search; } catch { return ''; } };
/** The files are served by the app (a local check in dev): no download, no network. */
export const stemModelsLocal = (): boolean => !!import.meta.env?.DEV && /[?&]stemModel=local\b/.test(query());

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key: string, v: boolean): void {
  try { if (v) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* private window */ }
}

export type StemModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface StemModelEntry {
  /** The person said yes to the download and it finished (the browser keeps the files), or they're served locally. */
  downloaded: boolean;
  status: StemModelStatus;
  progress: { loaded: number; total: number } | null;
  backend: StemBackend | null;
  threads: number;
  error: string | null;
}

export interface StemModelsState { models: Record<string, StemModelEntry> }

const entry = (id: string): StemModelEntry => ({
  downloaded: stemModelsLocal() || readFlag(downloadedKey(id)),
  status: 'idle', progress: null, backend: null, threads: 1, error: null,
});

export const useStemModels = create<StemModelsState>(() => ({ models: Object.fromEntries(STEM_MODELS.map(m => [m.id, entry(m.id)])) }));

const patch = (id: string, p: Partial<StemModelEntry>) =>
  useStemModels.setState(s => ({ models: { ...s.models, [id]: { ...(s.models[id] ?? entry(id)), ...p } } }));

export const stemEntry = (id: string): StemModelEntry => useStemModels.getState().models[id] ?? entry(id);
/** Downloaded (or local): it may run without asking. */
export const stemModelUsable = (id: string): boolean => stemEntry(id).downloaded;

// ── The worker ───────────────────────────────────────────────────────────────────────────────────────────────

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate'> & { onmessage: ((ev: MessageEvent) => void) | null; onerror: ((ev: ErrorEvent) => void) | null };

const realWorker = (): WorkerLike => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'stem-model' }) as WorkerLike;
let makeWorker: () => WorkerLike = realWorker;
let worker: WorkerLike | null = null;
let nextId = 1;
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; progress?: (m: StemProgressMsg) => void }>();
const loads = new Map<string, Promise<boolean>>();

/** Tests: a fake worker. */
export function __setStemWorkerFactory(fn: (() => WorkerLike) | null): void {
  makeWorker = fn ?? realWorker;
  resetStemWorker();
}
/** Whether the worker has been started (tests: nothing runs until a model is downloaded). */
export const stemWorkerStarted = (): boolean => worker !== null;

export function resetStemWorker(): void {
  worker?.terminate(); worker = null;
  for (const p of waiting.values()) p.fail(new Error('The stem worker stopped'));
  waiting.clear(); loads.clear();
  useStemModels.setState(s => ({ models: Object.fromEntries(Object.entries(s.models).map(([id, e]) => [id, { ...e, status: e.status === 'error' ? e.status : 'idle' as const, progress: null }])) }));
}

export type StemProgressMsg =
  | { phase: 'download'; loaded: number; total: number }
  | { phase: 'separate'; chunk: number; chunks: number; piece: number; pieces: number }
  | { phase: 'encode'; stem: number; stems: number };

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = [], progress?: (m: StemProgressMsg) => void): { id: number; done: Promise<T> } {
  const id = nextId++;
  const done = new Promise<T>((ok, fail) => {
    waiting.set(id, { ok: ok as (v: unknown) => void, fail, progress });
    worker!.postMessage({ ...msg, id }, transfer);
  });
  return { id, done };
}

function startWorker(): WorkerLike {
  const w = makeWorker();
  w.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { type: string; id: number; message?: string; cancelled?: boolean } & Record<string, unknown>;
    const p = waiting.get(m.id);
    if (!p) return;
    if (m.type === 'progress') { p.progress?.(m as unknown as StemProgressMsg); return; }
    waiting.delete(m.id);
    if (m.type === 'error') {
      const e = new Error(m.message ?? 'The stem model failed');
      if (m.cancelled) e.name = 'AbortError';
      p.fail(e);
    } else p.ok(m);
  };
  w.onerror = (e: ErrorEvent) => {
    const err = new Error(e.message || 'The stem worker failed');
    for (const p of waiting.values()) p.fail(err);
    waiting.clear();
  };
  return w;
}

/** What the worker is told about a model. */
export function workerConfig(id: string): StemWorkerConfig {
  const spec = stemModelById(id);
  const local = stemModelsLocal();
  const base = `${import.meta.env?.BASE_URL ?? '/'}${LOCAL_STEM_DIR}${spec.repo}/`;
  const url = (f: { path: string }) => (local ? new URL(`${base}${f.path}`, typeof location !== 'undefined' ? location.href : 'http://localhost/').href : stemFileUrl(spec, f as never));
  return {
    model: spec.id, layout: spec.layout, stems: [...spec.stems], cpuNodes: spec.cpuNodes, local,
    webgpu: !/[?&]stemModel=wasm\b/.test(query()),
    ...(spec.manifest ? { manifest: { url: url(spec.manifest), file: spec.manifest } } : {}),
    files: spec.files.map(f => ({ url: url(f), file: f })),
  };
}

/** Load a downloaded model (once). False when it isn't downloaded (nothing starts) or it failed. */
export function ensureStemModel(id: string, retry = false): Promise<boolean> {
  if (!stemModelUsable(id)) return Promise.resolve(false);
  const e = stemEntry(id);
  if (e.status === 'ready' && loads.has(id)) return loads.get(id)!;
  if (e.status === 'error' && !retry) return Promise.resolve(false);
  let p = loads.get(id);
  if (!p || retry) { p = load(id); loads.set(id, p); }
  return p;
}

async function load(id: string): Promise<boolean> {
  const local = stemModelsLocal();
  patch(id, { status: 'loading', error: null, progress: local ? null : { loaded: 0, total: stemDownloadBytes(stemModelById(id)) } });
  try {
    worker ??= startWorker();
    const r = await call<{ backend: StemBackend; threads: number }>({ type: 'load', cfg: workerConfig(id) }, [], m => {
      if (m.phase === 'download') patch(id, { progress: { loaded: m.loaded, total: m.total } });
    }).done;
    if (!local) writeFlag(downloadedKey(id), true);
    patch(id, { status: 'ready', backend: r.backend, threads: r.threads, progress: null, downloaded: true });
    return true;
  } catch (err) {
    console.warn('[stem model]', err);
    patch(id, { status: 'error', error: err instanceof Error ? err.message : String(err), progress: null });
    loads.delete(id);
    return false;
  }
}

/** The opt-in download, once the person said yes: fetch the files once, then the model is ready. */
export function downloadStemModel(id: string): Promise<boolean> {
  patch(id, { downloaded: true });
  return ensureStemModel(id, true).then(ok => {
    if (!ok && !stemModelsLocal() && !readFlag(downloadedKey(id))) patch(id, { downloaded: false });
    return ok;
  });
}

/** Forget a model: unload it and offer the download again (the browser may still hold the files). */
export function forgetStemModel(id: string): void {
  writeFlag(downloadedKey(id), false);
  loads.delete(id);
  if (worker) void call({ type: 'unload', model: id }).done.catch(() => {});
  patch(id, { downloaded: stemModelsLocal(), status: 'idle', backend: null, progress: null });
}

export interface StemResult {
  stems: Array<{ name: StemName } & EncodedStem>;
  backend: StemBackend;
  threads: number;
  ms: number;
}

/**
 * A whole song (44.1 kHz stereo) through a downloaded model. Rejects without starting anything when the model isn't
 * downloaded. `signal` cancels: the worker stops at the next piece; if it doesn't answer within `hardStopMs`, it is
 * stopped outright (and starts again next time).
 */
export async function separateStems(id: string, left: Float32Array, right: Float32Array, sampleRate: number,
  o: { onProgress?: (m: StemProgressMsg) => void; signal?: AbortSignal; hardStopMs?: number } = {}): Promise<StemResult> {
  if (!stemModelUsable(id)) throw new Error('Download the stem model first.');
  if (o.signal?.aborted) throw abortError();
  if (!(await ensureStemModel(id))) throw new Error(stemEntry(id).error ?? 'The stem model didn\'t load.');
  if (o.signal?.aborted) throw abortError();
  const c = call<StemResult>({ type: 'separate', model: id, left, right, sampleRate }, [left.buffer, right.buffer], o.onProgress);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onAbort = () => {
    worker?.postMessage({ type: 'cancel', id: nextId++, job: c.id });
    timer = setTimeout(() => {
      // Busy in one long step: stop the worker (the model loads again next time).
      const p = waiting.get(c.id);
      waiting.delete(c.id);
      resetStemWorker();
      p?.fail(abortError());
    }, o.hardStopMs ?? 4000);
  };
  o.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await c.done;
    const e = stemEntry(id);
    if (r.backend !== e.backend) patch(id, { backend: r.backend });
    return r;
  } finally {
    o.signal?.removeEventListener('abort', onAbort);
    if (timer) clearTimeout(timer);
  }
}

const abortError = () => { const e = new Error('Cancelled'); e.name = 'AbortError'; return e; };

/** For checking in dev: `window.__stemModel`. */
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __stemModel?: unknown }).__stemModel = { useStemModels, ensureStemModel, downloadStemModel, forgetStemModel, separateStems };
