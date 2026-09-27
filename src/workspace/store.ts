/**
 * store.ts — where this app keeps its own workspace bookkeeping: which
 * folder (a path, or a browser folder handle — handles can only live in
 * IndexedDB) and each workspace's sync state (the base hashes, conflicts).
 * It's this app's, not the folder's: nothing here is user content.
 */
import type { SyncState } from './engine';
import type { DirHandleLike } from './fs';

export interface WorkspaceConfig {
  backend: 'desktop' | 'browser' | 'opfs';
  /** Desktop: the folder's path. */
  path?: string;
  /** Browser: the picked folder. */
  handle?: DirHandleLike;
  /** Shown in the UI: the path, or the folder's name. */
  label: string;
  /** The workspace.json id last synced with. */
  workspaceId?: string;
}

const DB = 'shader-studio-workspace';
const STORE = 'kv';

function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

let dbP: Promise<IDBDatabase | null> | null = null;
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await (dbP ??= open());
  if (!db) return undefined;
  return new Promise(resolve => {
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result as T : undefined);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

export const loadConfig = () => run<WorkspaceConfig>('readonly', s => s.get('config'));
export const saveConfig = (c: WorkspaceConfig | null) => run('readwrite', s => (c ? s.put(c, 'config') : s.delete('config')));
export const loadSyncState = (id: string) => run<SyncState>('readonly', s => s.get(`state:${id}`));
export const saveSyncState = (st: SyncState) => run('readwrite', s => s.put(st, `state:${st.workspaceId}`));
