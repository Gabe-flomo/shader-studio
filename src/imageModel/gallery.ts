/**
 * gallery.ts — small pictures of looks, kept on this device for the Taste page's "How things look"
 * (docs/taste.md): what you kept or picked (with its projected vector), and the bundled examples, embedded
 * lazily in the background once the model is loaded. IndexedDB, one store per kind; never exported (the
 * portable profile carries only the projected centroids, not pictures).
 */
import { loadExampleGraphs } from '../store/exampleIndex';
import { contentHash } from '../taste/portable';
import { EMBEDDER_ID, imageModelReady, useImageModel } from './client';
import { lookFrame, lookOf, thumbOf } from './looks';

export interface LookRecord { id: string; embedder: string; proj: number[]; thumb: string; label: string; at: number; kind: 'kept' | 'example'; hash?: string }

const DB = 'shader-studio-looks';
const STORES = ['kept', 'examples'] as const;
const KEEP_MAX = 48;

let conn: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return conn ??= new Promise<IDBDatabase>((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('No IndexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => { conn = null; rej(req.error ?? new Error('Couldn’t open the looks store')); };
  });
}
async function tx<T>(store: typeof STORES[number], mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise<T>((res, rej) => {
    const r = fn(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const memory: { kept: LookRecord[] | null; examples: Map<string, LookRecord> | null } = { kept: null, examples: null };
const listeners = new Set<() => void>();
/** Called when the gallery changes (the Taste page re-reads it). */
export function onGalleryChange(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
const changed = () => { for (const f of listeners) f(); };

/** Remember a kept or picked look (its small picture and projected vector). */
export async function rememberLook(r: Omit<LookRecord, 'embedder' | 'at' | 'kind'>): Promise<void> {
  const rec: LookRecord = { ...r, embedder: EMBEDDER_ID, at: Date.now(), kind: 'kept' };
  try {
    await tx('kept', 'readwrite', s => s.put(rec));
    const all = await keptLooks();
    const extra = all.length > KEEP_MAX ? all.slice(KEEP_MAX) : [];
    for (const x of extra) await tx('kept', 'readwrite', s => s.delete(x.id));
    memory.kept = all.slice(0, KEEP_MAX);
  } catch { memory.kept = [rec, ...(memory.kept ?? [])].slice(0, KEEP_MAX); }
  changed();
}

/** Kept looks, newest first (this embedder's only). */
export async function keptLooks(): Promise<LookRecord[]> {
  try {
    const all = await tx<LookRecord[]>('kept', 'readonly', s => s.getAll() as IDBRequest<LookRecord[]>);
    memory.kept = all.filter(r => r.embedder === EMBEDDER_ID).sort((a, b) => b.at - a.at);
  } catch { memory.kept ??= []; }
  return memory.kept;
}

/** The examples embedded so far (this embedder's only), by example key. */
export async function exampleLooks(): Promise<Map<string, LookRecord>> {
  if (memory.examples) return memory.examples;
  const m = new Map<string, LookRecord>();
  try {
    for (const r of await tx<LookRecord[]>('examples', 'readonly', s => s.getAll() as IDBRequest<LookRecord[]>)) if (r.embedder === EMBEDDER_ID) m.set(r.id.slice(EMBEDDER_ID.length + 1), r);
  } catch { /* none */ }
  return (memory.examples = m);
}

/** An example's projected look, when it was embedded already (for rating it). */
export async function exampleLook(key: string): Promise<number[] | null> {
  return (await exampleLooks()).get(key)?.proj ?? null;
}

let started = false;
/**
 * Embed the examples' pictures in the background, one at a time when the browser is idle, once per session
 * after the model has loaded. Nothing waits on it; a hidden tab pauses it.
 */
export function startExampleLooks(): void {
  if (started || !imageModelReady()) return;
  started = true;
  void (async () => {
    const graphs = await loadExampleGraphs();
    const have = await exampleLooks();
    const todo = Object.entries(graphs).filter(([k, g]) => k !== 'blank' && g.nodes?.length && have.get(k)?.hash !== contentHash({ nodes: g.nodes }));
    const idle = () => new Promise<void>(r => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(() => r(), { timeout: 2000 }); else setTimeout(r, 200);
    });
    for (const [key, g] of todo) {
      await idle();
      while (typeof document !== 'undefined' && document.hidden) await new Promise(r => setTimeout(r, 2000));
      if (!imageModelReady()) { started = false; return; }
      try {
        const frame = lookFrame(g.nodes);
        const look = await lookOf(frame);
        if (!frame || !look) continue;
        const rec: LookRecord = { id: `${EMBEDDER_ID}:${key}`, embedder: EMBEDDER_ID, proj: Array.from(look.proj), thumb: thumbOf(frame, 72, 72) ?? '', label: g.label || key, at: Date.now(), kind: 'example', hash: contentHash({ nodes: g.nodes }) };
        have.set(key, rec);
        await tx('examples', 'readwrite', s => s.put(rec)).catch(() => undefined);
        changed();
      } catch (e) { console.warn('[image model] example look', key, e); }
    }
  })();
}

// Once the model is ready, the examples follow in the background.
useImageModel.subscribe(s => { if (s.status === 'ready') startExampleLooks(); });
