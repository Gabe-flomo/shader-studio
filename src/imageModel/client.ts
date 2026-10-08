/**
 * client.ts — the image model in the app (docs/taste.md "How things look"): MobileCLIP-S0 in a Web Worker,
 * loaded lazily the first time something needs it (never at app start), with small LRU caches.
 *
 *   embedImage(frame) → its 512-d unit vector (or null when the model is off)
 *   embedText(text)   → the same for words
 *
 * Settings: "Use the image model". On the web the model is downloaded once (about 65 MB, with a progress
 * bar) and the browser keeps it; after that it's on by default. On the desktop the files are bundled with
 * the app, so it's on from the first launch and never touches the network. Off, or not loaded, everything
 * works exactly as before: the taste model has no look, Deep and Surprise use their histogram novelty, and
 * the context box lists unknown words.
 */
import { create } from 'zustand';
import { IMAGE_MODEL, LOCAL_MODEL_DIR, MODEL_BYTES } from './config';
import { PROJECTION_VERSION, LOOK_DIMS, project, registerImageEmbedder } from '../taste/look';
import type { WorkerConfig } from './worker';
import { tasteSteering, updateSteering } from '../taste/store';
import { withContext } from '../taste/context';

/** What the taste model stores as its embedder: the model and the projection (a change of either resets the look). */
export const EMBEDDER_ID = `${IMAGE_MODEL.id}+${PROJECTION_VERSION}`;

const ENABLED_KEY = 'shader-studio:settings:useImageModel';
const DOWNLOADED_KEY = 'shader-studio:settings:imageModelDownloaded';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const query = (): string => { try { return typeof location === 'undefined' ? '' : location.search; } catch { return ''; } };
/** The files come with the app (desktop), or in dev with `?imageModel=local` (served from .cache/image-model). */
export const modelBundled = (): boolean => isTauri() || (import.meta.env.DEV && /[?&]imageModel=local\b/.test(query()));

function readFlag(key: string): boolean | null {
  try { const v = localStorage.getItem(key); return v === null ? null : v === '1'; } catch { return null; }
}
function writeFlag(key: string, v: boolean): void {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private window */ }
}

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ImageModelState {
  /** The setting: use the image model. */
  enabled: boolean;
  /** The web download happened (the browser keeps the files). Always true on the desktop. */
  downloaded: boolean;
  bundled: boolean;
  status: ModelStatus;
  /** While loading: bytes so far of the whole download. */
  progress: { loaded: number; total: number } | null;
  backend: 'webgpu' | 'wasm' | null;
  /** How long loading took (ms). */
  loadMs: number | null;
  /** A picture's embedding time (ms), averaged, and how many were made. */
  embedMs: number | null;
  embeds: number;
  error: string | null;
}

function initial(): ImageModelState {
  const bundled = modelBundled();
  const downloaded = bundled || readFlag(DOWNLOADED_KEY) === true;
  const setting = readFlag(ENABLED_KEY);
  return { enabled: setting ?? downloaded, downloaded, bundled, status: 'idle', progress: null, backend: null, loadMs: null, embedMs: null, embeds: 0, error: null };
}

export const useImageModel = create<ImageModelState>(() => initial());

/** On, and the files are here (bundled, or downloaded once): the model can be used without asking. */
export const imageModelUsable = (s: ImageModelState = useImageModel.getState()): boolean => s.enabled && (s.bundled || s.downloaded);
export const imageModelReady = (): boolean => imageModelUsable() && useImageModel.getState().status === 'ready';
export const IMAGE_MODEL_BYTES = MODEL_BYTES;

// ── The worker ───────────────────────────────────────────────────────────────

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
let loadPromise: Promise<boolean> | null = null;
const fileProgress = new Map<string, number>();

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((ok, fail) => {
    waiting.set(id, { ok: ok as (v: unknown) => void, fail });
    worker!.postMessage({ ...msg, id }, transfer);
  });
}

function startWorker(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'image-model' });
  w.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { type: string; id: number; file?: string; loaded?: number; total?: number; done?: boolean; backend?: 'webgpu' | 'wasm'; ms?: number; vec?: Float32Array; vecs?: Float32Array[]; message?: string };
    if (m.type === 'progress') {
      if (m.file) fileProgress.set(m.file, m.done ? (IMAGE_MODEL.files.find(f => m.file!.endsWith(f.path))?.bytes ?? m.total ?? 0) : m.loaded ?? 0);
      const loaded = [...fileProgress.values()].reduce((s, v) => s + v, 0);
      useImageModel.setState({ progress: { loaded: Math.min(loaded, MODEL_BYTES), total: MODEL_BYTES } });
      return;
    }
    const p = waiting.get(m.id);
    if (!p) return;
    waiting.delete(m.id);
    if (m.type === 'error') p.fail(new Error(m.message ?? 'The image model failed'));
    else p.ok(m);
  };
  w.onerror = e => {
    const err = new Error(e.message || 'The image model’s worker failed');
    for (const p of waiting.values()) p.fail(err);
    waiting.clear();
  };
  return w;
}


/**
 * Load the model (lazily; once). Resolves true when it's ready, false when it's off or failed. On the web
 * this is the one-time download the first time (`downloadImageModel` asks for it).
 */
export function ensureImageModel(retry = false): Promise<boolean> {
  if (!imageModelUsable()) return Promise.resolve(false);
  const status = useImageModel.getState().status;
  if (status === 'ready') return Promise.resolve(true);
  // A failed load isn't tried again on every picture: only when asked (Try again, or turning it on again).
  if (status === 'error' && !retry) return Promise.resolve(false);
  return (loadPromise ??= load());
}

async function load(): Promise<boolean> {
  if (typeof Worker === 'undefined') return false;
  const st = useImageModel.getState();
  useImageModel.setState({ status: 'loading', error: null, progress: st.downloaded ? null : { loaded: 0, total: MODEL_BYTES } });
  fileProgress.clear();
  worker ??= startWorker();
  const cfg: WorkerConfig = {
    repo: IMAGE_MODEL.repo, revision: IMAGE_MODEL.revision, dtype: { ...IMAGE_MODEL.dtype },
    local: st.bundled, localPath: `${import.meta.env.BASE_URL}${LOCAL_MODEL_DIR}`,
    webgpu: !/[?&]imageModel=wasm\b/.test(query()),
  };
  try {
    const r = await call<{ backend: 'webgpu' | 'wasm'; ms: number }>({ type: 'load', cfg });
    if (!st.bundled) writeFlag(DOWNLOADED_KEY, true);
    useImageModel.setState({ status: 'ready', backend: r.backend, loadMs: r.ms, progress: null, downloaded: true });
    return true;
  } catch (e) {
    console.warn('[image model]', e);
    useImageModel.setState({ status: 'error', error: e instanceof Error ? e.message : String(e), progress: null });
    loadPromise = null;
    worker?.terminate(); worker = null;
    return false;
  }
}

/** Read the settings again (App settings reset them). */
export function refreshImageModelSettings(): void {
  const { enabled, downloaded } = initial();
  if (!enabled) setImageModelEnabled(false);
  useImageModel.setState({ enabled, downloaded });
}

/** Web: download the model once (and turn it on). */
export function downloadImageModel(): Promise<boolean> {
  writeFlag(ENABLED_KEY, true);
  useImageModel.setState({ enabled: true, downloaded: true });
  return ensureImageModel(true).then(ok => {
    if (!ok && !useImageModel.getState().bundled && readFlag(DOWNLOADED_KEY) !== true) useImageModel.setState({ downloaded: false });
    return ok;
  });
}

/** The setting. Off frees the worker; everything goes back to how it works without the model. */
export function setImageModelEnabled(on: boolean): void {
  writeFlag(ENABLED_KEY, on);
  useImageModel.setState({ enabled: on });
  if (!on) {
    worker?.terminate(); worker = null; loadPromise = null;
    for (const p of waiting.values()) p.fail(new Error('The image model was turned off'));
    waiting.clear();
    useImageModel.setState({ status: 'idle', backend: null, progress: null });
  }
}

// ── Caches ───────────────────────────────────────────────────────────────────

class Lru<V> {
  private m = new Map<string, V>();
  private cap: number;
  constructor(cap: number) { this.cap = cap; }
  get(k: string): V | undefined { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v); } return v; }
  set(k: string, v: V): void { this.m.delete(k); this.m.set(k, v); if (this.m.size > this.cap) this.m.delete(this.m.keys().next().value as string); }
}
const imageCache = new Lru<Promise<Float32Array | null>>(256);
const textCache = new Lru<Promise<Float32Array | null>>(128);

/** A frame's hash: FNV-1a over a sample of its bytes and its size (cache key). */
export function frameHash(f: { rgba: ArrayLike<number>; w: number; h: number }): string {
  let h = 0x811c9dc5 ^ f.w ^ (f.h << 16);
  const n = f.rgba.length, step = Math.max(1, Math.floor(n / 4096));
  for (let i = 0; i < n; i += step) { h ^= f.rgba[i] & 255; h = Math.imul(h, 0x01000193); }
  return `${f.w}x${f.h}:${(h >>> 0).toString(16)}`;
}

/**
 * A picture's embedding (unit length, 512-d), or null when the model is off or failed. `flipY`: rows run
 * bottom-up, as WebGL reads them (the default).
 */
export async function embedImage(frame: { rgba: ArrayLike<number>; w: number; h: number }, o: { flipY?: boolean } = {}): Promise<Float32Array | null> {
  if (!imageModelUsable()) return null;
  const key = `${o.flipY === false ? 'u' : 'f'}:${frameHash(frame)}`;
  const hit = imageCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    if (!(await ensureImageModel())) return null;
    const rgba = new Uint8Array(frame.rgba as ArrayLike<number>);
    try {
      const r = await call<{ vec: Float32Array; ms: number }>({ type: 'image', rgba, w: frame.w, h: frame.h, flipY: o.flipY !== false }, [rgba.buffer]);
      const s = useImageModel.getState();
      useImageModel.setState({ embeds: s.embeds + 1, embedMs: s.embedMs == null ? r.ms : s.embedMs * 0.8 + r.ms * 0.2 });
      return r.vec;
    } catch (e) { console.warn('[image model] embed', e); return null; }
  })();
  imageCache.set(key, p);
  void p.then(v => { if (!v) imageCache.set(key, Promise.resolve(null)); });
  return p;
}

/** Words' embeddings (unit length), cached per text; nulls when the model is off. */
export async function embedTexts(texts: readonly string[]): Promise<Array<Float32Array | null>> {
  if (!imageModelUsable() || !texts.length) return texts.map(() => null);
  const missing = texts.filter(t => !textCache.get(t));
  if (missing.length) {
    const batch = (async () => {
      if (!(await ensureImageModel())) return missing.map(() => null);
      try { return (await call<{ vecs: Float32Array[] }>({ type: 'text', texts: missing })).vecs; } catch (e) { console.warn('[image model] text', e); return missing.map(() => null); }
    })();
    missing.forEach((t, i) => textCache.set(t, batch.then(v => v[i] ?? null)));
  }
  return Promise.all(texts.map(t => textCache.get(t) ?? Promise.resolve(null)));
}
export const embedText = async (text: string): Promise<Float32Array | null> => (await embedTexts([text]))[0];

// ── The taste model's embedder ───────────────────────────────────────────────

/** While the model can be used, the taste model sees looks (src/taste/look.ts); otherwise it has none. */
function syncEmbedder(): void {
  registerImageEmbedder(imageModelUsable() ? {
    id: EMBEDDER_ID, dims: LOOK_DIMS,
    embed: async f => { const v = await embedImage(f); return v ? project(v) : new Float32Array(LOOK_DIMS); },
  } : null);
}
/** The context box reads words by look only while the model can be used: read it again when that changes. */
function rereadContext(): void {
  const s = tasteSteering();
  if (!s.context.trim()) return;
  const next = withContext(s, s.context, { byLook: imageModelUsable() });
  if (JSON.stringify(next.chips) !== JSON.stringify(s.chips) || next.unknown.join('|') !== s.unknown.join('|')) updateSteering(() => next);
}

syncEmbedder();
useImageModel.subscribe((s, prev) => { if (imageModelUsable(s) !== imageModelUsable(prev)) { syncEmbedder(); rereadContext(); } });
rereadContext();

/** For checking in dev: `window.__imageModel`. */
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __imageModel?: unknown }).__imageModel = { useImageModel, ensureImageModel, embedImage, embedText, embedTexts, downloadImageModel, setImageModelEnabled };
