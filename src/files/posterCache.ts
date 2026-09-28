/**
 * posterCache.ts — small rendered pictures of saved things (graphs, Plays,
 * GLSL shaders, example graphs), kept in IndexedDB with the content hash they
 * were drawn from, so a poster is drawn once and again only when the thing
 * changed. The store is abstract (a map in tests); the app's is one object
 * store keyed by the item's id.
 */

export interface PosterRecord { id: string; hash: string; url: string; at: number }

export interface PosterStore {
  get(id: string): Promise<PosterRecord | undefined>;
  put(rec: PosterRecord): Promise<void>;
  delete(id: string): Promise<void>;
  /** Every record's id and hash (to drop posters of things that are gone). */
  list(): Promise<Array<Pick<PosterRecord, 'id' | 'hash' | 'at'>>>;
}

/** The cache's key for an item: its Files id (or `example:<key>`), one poster per thing. */
export const posterId = (kind: 'item' | 'example', id: string) => (kind === 'item' ? id : `example:${id}`);

export class PosterCache {
  private memory = new Map<string, PosterRecord | null>();
  private store: PosterStore;
  constructor(store: PosterStore) { this.store = store; }

  /** The poster drawn from exactly this content, or null when there's none (or it's stale). */
  async get(id: string, hash: string): Promise<string | null> {
    const m = this.memory.get(id);
    if (m !== undefined) return m && m.hash === hash ? m.url : null;
    let rec: PosterRecord | undefined;
    try { rec = await this.store.get(id); } catch { rec = undefined; }
    this.memory.set(id, rec ?? null);
    return rec && rec.hash === hash ? rec.url : null;
  }

  async put(id: string, hash: string, url: string, at = Date.now()): Promise<void> {
    const rec = { id, hash, url, at };
    this.memory.set(id, rec);
    try { await this.store.put(rec); } catch { /* the memory copy still serves this session */ }
  }

  /** Forget posters of things that no longer exist (`keep`: ids still around). */
  async prune(keep: Set<string>): Promise<number> {
    let n = 0;
    let all: Array<Pick<PosterRecord, 'id'>> = [];
    try { all = await this.store.list(); } catch { return 0; }
    for (const r of all) {
      if (keep.has(r.id)) continue;
      this.memory.delete(r.id);
      try { await this.store.delete(r.id); n++; } catch { /* next time */ }
    }
    return n;
  }
}

export function memoryPosterStore(): PosterStore & { data: Map<string, PosterRecord> } {
  const data = new Map<string, PosterRecord>();
  return {
    data,
    get: async id => data.get(id),
    put: async rec => { data.set(rec.id, rec); },
    delete: async id => { data.delete(id); },
    list: async () => [...data.values()].map(({ id, hash, at }) => ({ id, hash, at })),
  };
}

// ── IndexedDB ───────────────────────────────────────────────────────────────

const DB = 'shader-studio-posters';
const STORE = 'posters';

function idbStore(): PosterStore {
  let conn: Promise<IDBDatabase> | null = null;
  const open = () => conn ??= new Promise<IDBDatabase>((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('No IndexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error ?? new Error('Couldn’t open the poster cache'));
  });
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error ?? new Error('Poster cache'));
    });
  };
  return {
    get: id => run<PosterRecord | undefined>('readonly', s => s.get(id) as IDBRequest<PosterRecord | undefined>),
    put: async rec => { await run('readwrite', s => s.put(rec)); },
    delete: async id => { await run('readwrite', s => s.delete(id)); },
    list: async () => (await run<PosterRecord[]>('readonly', s => s.getAll() as IDBRequest<PosterRecord[]>)).map(({ id, hash, at }) => ({ id, hash, at })),
  };
}

let shared: PosterCache | null = null;
/** The app's poster cache (IndexedDB), made on first use. */
export function posterCache(): PosterCache {
  return shared ??= new PosterCache(idbStore());
}
