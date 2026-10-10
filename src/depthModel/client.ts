/**
 * client.ts — the depth models in the app (docs/depth-node.md): one Web Worker, started the first time a Depth
 * node runs a downloaded model (never at app start), holding whichever models have been used.
 *
 *   downloadDepthModel(id)                  the opt-in download (with progress), then the model is ready
 *   estimateDepth(id, frame, side)          → { depth (0–1, rows top-down), w, h, ms }, or null
 *   depthModelUsable(id)                    downloaded (or served locally): it may run without asking
 *   forgetDepthModel(id)                    unload it and offer the download again
 *
 * Nothing here runs until a model is downloaded: estimateDepth and ensureDepthModel return null / false
 * without starting the worker. Files come from Hugging Face once, pinned (config.ts), and the browser keeps them.
 * Dev: `?depthModel=local` reads them from `.cache/depth-models/` (tools/fetch-depth-models.mjs);
 * `?depthModel=wasm` forces WebAssembly; `window.__depthModel` exposes this module.
 */
import { create } from 'zustand';
import { DEPTH_MODELS, LOCAL_DEPTH_DIR, depthDownloadBytes, depthModelById, depthModelFiles, modelSide, type DepthBackend } from './config';
import type { DepthWorkerConfig } from './workerCore';

const downloadedKey = (id: string) => `shader-studio:depthModel:${id}:downloaded`;

const query = (): string => { try { return typeof location === 'undefined' ? '' : location.search; } catch { return ''; } };
/** The files are served by the app (a local check in dev): no download, no network. */
export const depthModelsLocal = (): boolean => !!import.meta.env?.DEV && /[?&]depthModel=local\b/.test(query());

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key: string, v: boolean): void {
  try { if (v) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* private window */ }
}

export type DepthModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DepthModelEntry {
  /** The one-time download happened (the browser keeps the files), or they're served locally. */
  downloaded: boolean;
  status: DepthModelStatus;
  progress: { loaded: number; total: number } | null;
  backend: DepthBackend | null;
  loadMs: number | null;
  /** Time per frame (ms), averaged, and how many frames. */
  inferMs: number | null;
  runs: number;
  error: string | null;
}

export interface DepthModelsState {
  models: Record<string, DepthModelEntry>;
  /** The backend this browser will likely use (for the size in the offer), once known. */
  likely: DepthBackend | null;
}

const entry = (id: string): DepthModelEntry => ({
  downloaded: depthModelsLocal() || readFlag(downloadedKey(id)),
  status: 'idle', progress: null, backend: null, loadMs: null, inferMs: null, runs: 0, error: null,
});

export const useDepthModels = create<DepthModelsState>(() => ({
  models: Object.fromEntries(DEPTH_MODELS.map(m => [m.id, entry(m.id)])),
  likely: null,
}));

const patch = (id: string, p: Partial<DepthModelEntry>) =>
  useDepthModels.setState(s => ({ models: { ...s.models, [id]: { ...(s.models[id] ?? entry(id)), ...p } } }));

export const depthEntry = (id: string): DepthModelEntry => useDepthModels.getState().models[id] ?? entry(id);
/** Downloaded (or local): it may run without asking. */
export const depthModelUsable = (id: string): boolean => depthEntry(id).downloaded;

/** The download this browser will make for a model, in bytes (WebGPU's files unless it's known to be WebAssembly). */
export const depthOfferBytes = (id: string): number => depthDownloadBytes(depthModelById(id), useDepthModels.getState().likely ?? 'webgpu');

/** Which backend the worker will pick (a cheap adapter check, no model): for the size the offer shows. */
export async function probeLikelyBackend(): Promise<DepthBackend> {
  const known = useDepthModels.getState().likely;
  if (known) return known;
  let b: DepthBackend = 'wasm';
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    const a = gpu && !/[?&]depthModel=wasm\b/.test(query()) ? await gpu.requestAdapter() : null;
    if (a && a.features.has('shader-f16')) b = 'webgpu';
  } catch { /* WebAssembly */ }
  useDepthModels.setState({ likely: b });
  return b;
}

// ── The worker ───────────────────────────────────────────────────────────────

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate'> & { onmessage: ((ev: MessageEvent) => void) | null; onerror: ((ev: ErrorEvent) => void) | null };

let makeWorker: () => WorkerLike = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'depth-model' }) as WorkerLike;
let worker: WorkerLike | null = null;
let nextId = 1;
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
const loads = new Map<string, Promise<boolean>>();
const fileProgress = new Map<string, Map<string, number>>();

/** Tests: a fake worker. */
export function __setDepthWorkerFactory(fn: (() => WorkerLike) | null): void {
  makeWorker = fn ?? (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'depth-model' }) as WorkerLike);
  resetDepthWorker();
}
/** Whether the worker has been started (tests: nothing runs until a model is downloaded). */
export const depthWorkerStarted = (): boolean => worker !== null;

export function resetDepthWorker(): void {
  worker?.terminate(); worker = null;
  for (const p of waiting.values()) p.fail(new Error('The depth worker stopped'));
  waiting.clear(); loads.clear(); fileProgress.clear();
  useDepthModels.setState(s => ({ models: Object.fromEntries(Object.entries(s.models).map(([id, e]) => [id, { ...e, status: 'idle' as const, progress: null, backend: null }])) }));
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((ok, fail) => {
    waiting.set(id, { ok: ok as (v: unknown) => void, fail });
    worker!.postMessage({ ...msg, id }, transfer);
  });
}

function startWorker(): WorkerLike {
  const w = makeWorker();
  w.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { type: string; id: number; model?: string; file?: string; loaded?: number; total?: number; done?: boolean; message?: string };
    if (m.type === 'progress') {
      if (!m.model || !m.file) return;
      const spec = depthModelById(m.model);
      const files = fileProgress.get(m.model) ?? new Map<string, number>();
      fileProgress.set(m.model, files);
      const known = depthModelFiles(spec).find(f => m.file!.endsWith(f.path));
      files.set(m.file, m.done ? (known?.bytes ?? m.total ?? 0) : m.loaded ?? 0);
      const total = depthOfferBytes(m.model);
      const loaded = [...files.values()].reduce((s, v) => s + v, 0);
      patch(m.model, { progress: { loaded: Math.min(loaded, total), total } });
      return;
    }
    const p = waiting.get(m.id);
    if (!p) return;
    waiting.delete(m.id);
    if (m.type === 'error') p.fail(new Error(m.message ?? 'The depth model failed'));
    else p.ok(m);
  };
  w.onerror = (e: ErrorEvent) => {
    const err = new Error(e.message || 'The depth worker failed');
    for (const p of waiting.values()) p.fail(err);
    waiting.clear();
  };
  return w;
}

/** Load a downloaded model (once). False when it isn't downloaded (nothing starts) or it failed. */
export function ensureDepthModel(id: string, retry = false): Promise<boolean> {
  if (!depthModelUsable(id)) return Promise.resolve(false);
  const e = depthEntry(id);
  if (e.status === 'ready' && loads.has(id)) return loads.get(id)!;
  if (e.status === 'error' && !retry) return Promise.resolve(false);
  let p = loads.get(id);
  if (!p || retry) { p = load(id); loads.set(id, p); }
  return p;
}

async function load(id: string): Promise<boolean> {
  const spec = depthModelById(id);
  const local = depthModelsLocal();
  patch(id, { status: 'loading', error: null, progress: local ? null : { loaded: 0, total: depthOfferBytes(id) } });
  fileProgress.delete(id);
  try {
    worker ??= startWorker();
    const cfg: DepthWorkerConfig = {
      model: spec.id, repo: spec.repo, revision: spec.revision, dtype: { ...spec.dtype },
      local, localPath: `${import.meta.env?.BASE_URL ?? '/'}${LOCAL_DEPTH_DIR}`,
      webgpu: !/[?&]depthModel=wasm\b/.test(query()),
    };
    const r = await call<{ backend: DepthBackend; ms: number }>({ type: 'load', cfg });
    if (!local) writeFlag(downloadedKey(id), true);
    patch(id, { status: 'ready', backend: r.backend, loadMs: r.ms, progress: null, downloaded: true });
    return true;
  } catch (err) {
    console.warn('[depth model]', err);
    patch(id, { status: 'error', error: err instanceof Error ? err.message : String(err), progress: null });
    loads.delete(id);
    return false;
  }
}

/** The opt-in download (web): fetch the files once, then the model is ready. */
export function downloadDepthModel(id: string): Promise<boolean> {
  patch(id, { downloaded: true });
  return ensureDepthModel(id, true).then(ok => {
    if (!ok && !depthModelsLocal() && !readFlag(downloadedKey(id))) patch(id, { downloaded: false });
    return ok;
  });
}

/** Forget a model: unload it and offer the download again (the browser may still hold the files). */
export function forgetDepthModel(id: string): void {
  writeFlag(downloadedKey(id), false);
  loads.delete(id);
  if (worker) void call({ type: 'unload', model: id }).catch(() => {});
  patch(id, { downloaded: depthModelsLocal(), status: 'idle', backend: null, progress: null });
}

export interface DepthFrame {
  /** RGBA bytes. */
  rgba: Uint8Array;
  w: number;
  h: number;
  /** Rows run bottom-up (as WebGL reads them). */
  flipY: boolean;
}

export interface DepthResult { depth: Float32Array; w: number; h: number; ms: number }

/**
 * A frame's depth with one model, or null when the model isn't downloaded (nothing runs) or failed.
 * The frame's buffer is transferred to the worker: pass a copy if you need it afterwards.
 */
export async function estimateDepth(id: string, frame: DepthFrame, side: number): Promise<DepthResult | null> {
  if (!depthModelUsable(id)) return null;
  if (!(await ensureDepthModel(id))) return null;
  try {
    const r = await call<DepthResult>({ type: 'depth', model: id, rgba: frame.rgba, w: frame.w, h: frame.h, flipY: frame.flipY, side: modelSide(depthModelById(id), side) }, [frame.rgba.buffer]);
    const e = depthEntry(id);
    patch(id, { runs: e.runs + 1, inferMs: e.inferMs == null ? r.ms : e.inferMs * 0.8 + r.ms * 0.2 });
    return r;
  } catch (err) {
    console.warn('[depth model] estimate', err);
    return null;
  }
}

/** For checking in dev: `window.__depthModel`. */
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __depthModel?: unknown }).__depthModel = { useDepthModels, ensureDepthModel, estimateDepth, downloadDepthModel, forgetDepthModel };
