/**
 * store.ts — where the index is kept between sessions (docs/code-explorer-plan.md §4.4).
 *
 * IndexedDB database `code-explorer`: `docs` (one record per doc, with its
 * sites; docId → DocRecord) and `meta` (the schema version and which bundled
 * index was last applied). The corpus is small (§4.5: ≈0.8 MB for the
 * examples), so the postings are rebuilt in memory when the worker starts
 * rather than stored as their own object stores. A memory store stands in
 * where there is no IndexedDB (tests, private windows).
 */
import type { DocRecord } from './types';

export interface IndexMeta { schema: number; prebuilt?: string; builtAt?: number }

export interface IndexStore {
  load(): Promise<{ meta: IndexMeta | null; docs: DocRecord[] }>;
  put(docs: DocRecord[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  setMeta(meta: IndexMeta): Promise<void>;
  clear(): Promise<void>;
}

export function memoryStore(): IndexStore & { docs: Map<string, DocRecord>; meta: IndexMeta | null } {
  const s = {
    docs: new Map<string, DocRecord>(),
    meta: null as IndexMeta | null,
    async load() { return { meta: s.meta, docs: [...s.docs.values()] }; },
    async put(docs: DocRecord[]) { for (const d of docs) s.docs.set(d.docId, d); },
    async remove(ids: string[]) { for (const id of ids) s.docs.delete(id); },
    async setMeta(meta: IndexMeta) { s.meta = meta; },
    async clear() { s.docs.clear(); s.meta = null; },
  };
  return s;
}

export const DB_NAME = 'code-explorer';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}

/** The IndexedDB store, or null when IndexedDB can't be opened. */
export async function idbStore(idb: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB, name = DB_NAME): Promise<IndexStore | null> {
  if (!idb) return null;
  let db: IDBDatabase;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = idb.open(name, DB_VERSION);
      open.onupgradeneeded = () => {
        const d = open.result;
        if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'docId' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('blocked'));
    });
  } catch {
    return null;
  }
  return {
    async load() {
      const tx = db.transaction(['docs', 'meta'], 'readonly');
      const [docs, meta] = await Promise.all([req(tx.objectStore('docs').getAll() as IDBRequest<DocRecord[]>), req(tx.objectStore('meta').get('meta') as IDBRequest<IndexMeta | undefined>)]);
      return { meta: meta ?? null, docs };
    },
    async put(docs) {
      if (!docs.length) return;
      const tx = db.transaction('docs', 'readwrite');
      const s = tx.objectStore('docs');
      for (const d of docs) s.put(d);
      await done(tx);
    },
    async remove(ids) {
      if (!ids.length) return;
      const tx = db.transaction('docs', 'readwrite');
      const s = tx.objectStore('docs');
      for (const id of ids) s.delete(id);
      await done(tx);
    },
    async setMeta(meta) {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(meta, 'meta');
      await done(tx);
    },
    async clear() {
      const tx = db.transaction(['docs', 'meta'], 'readwrite');
      tx.objectStore('docs').clear();
      tx.objectStore('meta').clear();
      await done(tx);
    },
  };
}
