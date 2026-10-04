/**
 * linkedFolders.ts — folders on disk the app uses media from in place
 * (docs/linked-folders.md): a samples folder, an image folder, a video
 * folder, fonts. Nothing is copied into the library: a setup names a file as
 * `linked:<folderId>/<path>` (linkedRefs.ts) and it's read from the folder
 * when it's needed, read-only.
 *
 *   Desktop   a folder picked in the system dialog, read through the read-only
 *             Rust commands in src-tauri/src/linked.rs (lf_*: the roots are
 *             registered with lf_set_roots; nothing there can write). A watcher
 *             per folder says when a file changed.
 *   Browser   a File System Access directory handle (Chrome, Edge), kept in
 *             IndexedDB like the workspace folder's; after a restart the browser
 *             wants one click to allow it again (status 'permission', "Reconnect").
 *             Safari and Firefox have no folder access: `linkedSupport()` is 'none'.
 *   Memory    tests (and a stand-in anywhere) through `addLinkedFolder(…, fs)`.
 *
 *   loadLinkedFolders()                 read the list, check each folder, start watching
 *   refreshLinkedFolders()              read the list again (another window changed it; focus)
 *   linkFolder({ kind? })               pick a folder and link it → the folder, or null
 *   renameLinkedFolder · setLinkedKind · unlinkFolder (→ undo) · reconnectLinkedFolder · relocateLinkedFolder
 *   listLinked(folderId, dir)           one folder's entries (folders first, then files, natural order)
 *   searchLinked(folderId, q, filter)   files under it whose name has q
 *   resolveLinked(ref)                  the file (a Blob, cached for the session while unchanged)
 *                                       or why not: 'folder' (not connected), 'permission', 'file' (missing), 'bad'
 *   statLinked(ref)                     its size and time, or null
 *   onLinkedChange(cb)                  a file in use changed or went (cb gets the refs; null = anything)
 *
 * The list is kept one record per folder (desktop: the app's data folder;
 * browser: IndexedDB), see "Keeping the list" below.
 *
 * Files here are never counted by the storage limit: they aren't stored.
 */
import { create } from 'zustand';
import { fsError } from '../workspace/fs';
import { baseNameOf, cleanPath, linkedRef, mimeOf, naturalCompare, parseLinkedRef, matchesFilter, type LinkedFilter, type LinkedKindHint } from './linkedRefs';

// ── Types ───────────────────────────────────────────────────────────────────

export interface LinkedEntry {
  name: string;
  /** Path inside the linked folder ('/'-separated). */
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
}

/** A linked folder as the model reads it: one level at a time, read-only. */
export interface LinkedFs {
  probe(): Promise<'ok' | 'gone' | 'permission'>;
  /** One folder's entries ('' = the linked folder itself). */
  list(dir: string): Promise<Omit<LinkedEntry, 'path'>[]>;
  /** Throws LinkedError 'file' when it's not there. */
  stat(path: string): Promise<{ size: number; mtime: number }>;
  read(path: string): Promise<Blob>;
  /** Ask again for access (a browser after a restart); true when granted. */
  requestPermission?(): Promise<boolean>;
  /** Watch for changes (desktop); returns a stop function. */
  watch?(onChange: (paths: string[]) => void): Promise<() => void>;
}

export type LinkedBackend = 'desktop' | 'browser' | 'memory';

export interface LinkedFolder {
  id: string;
  name: string;
  kind: LinkedKindHint;
  backend: LinkedBackend;
  /** Desktop: the folder's full path. */
  path?: string;
  /** Browser: the picked folder (a FileSystemDirectoryHandle). */
  handle?: BrowserDirHandle;
  addedAt: number;
}

export type LinkedStatus = 'checking' | 'connected' | 'missing' | 'permission';
export type LinkedProblem = 'folder' | 'permission' | 'file' | 'bad';
export type Resolved =
  | { ok: true; blob: Blob; name: string; type: string; size: number; mtime: number }
  | { ok: false; reason: LinkedProblem };

export class LinkedError extends Error {
  reason: LinkedProblem;
  constructor(reason: LinkedProblem, message: string) { super(message); this.reason = reason; this.name = 'LinkedError'; }
}

/** The parts of FileSystemDirectoryHandle used here. */
export interface BrowserDirHandle {
  kind?: 'directory';
  name: string;
  getDirectoryHandle(name: string): Promise<BrowserDirHandle>;
  getFileHandle(name: string): Promise<{ kind: 'file'; name: string; getFile(): Promise<File> }>;
  entries(): AsyncIterable<[string, { kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File> }]>;
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

// ── Support ─────────────────────────────────────────────────────────────────

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
type PickerWindow = Window & { showDirectoryPicker?: (o?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<BrowserDirHandle> };

/** Where linked folders work: the desktop app, Chrome/Edge, or not here (Safari, Firefox). */
export function linkedSupport(): 'desktop' | 'browser' | 'none' {
  if (typeof window === 'undefined') return 'none';
  if (isTauri()) return 'desktop';
  return typeof (window as PickerWindow).showDirectoryPicker === 'function' ? 'browser' : 'none';
}

export const UNSUPPORTED_TEXT = 'Linked folders need the desktop app, or Chrome or Edge: Safari and Firefox don’t let web pages open a folder on your computer. Files you pick are copied into the library instead.';

// ── Backends ────────────────────────────────────────────────────────────────

const toError = (e: unknown, path = ''): LinkedError => {
  if (e instanceof LinkedError) return e;
  const name = (e as { name?: string })?.name ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  if (/^missing:/.test(msg)) return new LinkedError('file', msg.replace(/^missing:\s*/, ''));
  if (path && (name === 'NotFoundError' || name === 'TypeMismatchError')) return new LinkedError('file', msg);
  if (/^Not a linked folder/.test(msg)) return new LinkedError('folder', msg);
  const f = fsError(e);
  return new LinkedError(f.code === 'permission' ? 'permission' : f.code === 'gone' ? 'folder' : 'file', f.message);
};

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invokeP: Promise<Invoke> | null = null;
const tauri = () => (invokeP ??= import('@tauri-apps/api/core').then(m => m.invoke as Invoke));

/** The desktop app: the read-only lf_* commands (src-tauri/src/linked.rs). */
export function desktopLinkedFs(root: string): LinkedFs {
  const call = async <T>(cmd: string, args: Record<string, unknown>, path = ''): Promise<T> => {
    try { return await (await tauri())<T>(cmd, args); } catch (e) { throw toError(e, path); }
  };
  return {
    async probe() { try { return await (await tauri())<'ok' | 'gone' | 'permission'>('lf_probe', { root }); } catch { return 'gone'; } },
    async list(dir) { return (await call<Array<{ name: string; dir: boolean; size: number; mtime: number }>>('lf_list', { root, dir })).map(e => ({ ...e, name: e.name.normalize('NFC') })); },
    stat: path => call('lf_stat', { root, path }, path),
    async read(path) { const buf = await call<ArrayBuffer>('lf_read', { root, path }, path); return new Blob([buf], { type: mimeOf(path) }); },
    async watch(onChange) {
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen<{ root: string; paths: string[] }>('linked-changed', e => { if (e.payload?.root === root) onChange(e.payload.paths ?? []); });
      try { await (await tauri())('lf_watch', { root }); } catch (e) { console.warn('[linked] watching a folder failed; checking on focus instead', e); }
      return () => { off(); void tauri().then(i => i('lf_unwatch', { root })).catch(() => {}); };
    },
  };
}

/** A browser folder handle (File System Access), read-only. */
export function handleLinkedFs(root: BrowserDirHandle): LinkedFs {
  const dirOf = async (parts: string[]) => { let d = root; for (const p of parts) d = await d.getDirectoryHandle(p); return d; };
  const fileOf = async (path: string) => {
    const parts = path.split('/');
    const d = await dirOf(parts.slice(0, -1));
    return (await d.getFileHandle(parts[parts.length - 1])).getFile();
  };
  const wrap = async <T>(run: () => Promise<T>, path = ''): Promise<T> => { try { return await run(); } catch (e) { throw toError(e, path); } };
  return {
    async probe() {
      try {
        if (root.queryPermission && (await root.queryPermission({ mode: 'read' })) !== 'granted') return 'permission';
        const it = root.entries()[Symbol.asyncIterator]();
        await it.next();
        return 'ok';
      } catch (e) { return fsError(e).code === 'permission' ? 'permission' : 'gone'; }
    },
    list: dir => wrap(async () => {
      const d = await dirOf(dir ? dir.split('/') : []);
      const out: Omit<LinkedEntry, 'path'>[] = [];
      for await (const [name, h] of d.entries()) {
        if (name.startsWith('.') || name === 'Thumbs.db' || name.endsWith('.crswap')) continue;
        if (h.kind === 'directory') out.push({ name: name.normalize('NFC'), dir: true, size: 0, mtime: 0 });
        else { const f = await h.getFile!(); out.push({ name: name.normalize('NFC'), dir: false, size: f.size, mtime: f.lastModified }); }
      }
      return out;
    }, dir),
    stat: path => wrap(async () => { const f = await fileOf(path); return { size: f.size, mtime: f.lastModified }; }, path),
    read: path => wrap(async () => { const f = await fileOf(path); return f.type ? f : new Blob([f], { type: mimeOf(path) }); }, path),
    async requestPermission() {
      if (!root.requestPermission) return true;
      try { return (await root.requestPermission({ mode: 'read' })) === 'granted'; } catch { return false; }
    },
  };
}

/** A folder in memory (tests): paths → bytes and a time. `gone` pretends the drive was pulled out. */
export interface MemoryLinkedFs extends LinkedFs {
  files: Map<string, { data: Uint8Array; mtime: number }>;
  put(path: string, data: Uint8Array | string, mtime?: number): void;
  remove(path: string): void;
  setGone(gone: boolean): void;
  setPermission(ok: boolean): void;
}

export function memoryLinkedFs(init: Record<string, Uint8Array | string> = {}): MemoryLinkedFs {
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  let gone = false, allowed = true, clock = 1_000;
  const bytes = (d: Uint8Array | string) => (typeof d === 'string' ? new TextEncoder().encode(d) : d);
  const check = () => { if (gone) throw new LinkedError('folder', 'The folder isn’t there'); if (!allowed) throw new LinkedError('permission', 'Not allowed'); };
  const fs: MemoryLinkedFs = {
    files,
    put(p, d, mtime) { files.set(p, { data: bytes(d), mtime: mtime ?? (clock += 1000) }); },
    remove(p) { files.delete(p); },
    setGone(g) { gone = g; },
    setPermission(ok) { allowed = ok; },
    async probe() { return gone ? 'gone' : allowed ? 'ok' : 'permission'; },
    async list(dir) {
      check();
      const prefix = dir ? `${dir}/` : '';
      const out = new Map<string, Omit<LinkedEntry, 'path'>>();
      for (const [p, f] of files) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length), slash = rest.indexOf('/');
        if (slash < 0) out.set(rest, { name: rest, dir: false, size: f.data.length, mtime: f.mtime });
        else if (!out.has(rest.slice(0, slash))) out.set(rest.slice(0, slash), { name: rest.slice(0, slash), dir: true, size: 0, mtime: 0 });
      }
      if (dir && !out.size) throw new LinkedError('file', `No folder ${dir}`);
      return [...out.values()];
    },
    async stat(p) { check(); const f = files.get(p); if (!f) throw new LinkedError('file', `missing: ${p}`); return { size: f.data.length, mtime: f.mtime }; },
    async read(p) { check(); const f = files.get(p); if (!f) throw new LinkedError('file', `missing: ${p}`); const copy = new Uint8Array(f.data.length); copy.set(f.data); return new Blob([copy], { type: mimeOf(p) }); },
    async requestPermission() { allowed = true; return true; },
  };
  for (const [p, d] of Object.entries(init)) fs.put(p, d);
  return fs;
}

// ── Keeping the list (IndexedDB: handles can only live there) ──────────────

const DB = 'shader-studio-linked';
const KV = 'kv';
export const THUMBS = 'thumbs';

let dbP: Promise<IDBDatabase | null> | null = null;
export function linkedDb(): Promise<IDBDatabase | null> {
  if (dbP) return dbP;
  const p: Promise<IDBDatabase | null> = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { for (const s of [KV, THUMBS]) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
      req.onsuccess = () => {
        const db = req.result;
        // A connection WebKit (or another tab's upgrade) closed is opened again next
        // time, not kept: every write through a closed one fails.
        const drop = () => { if (dbP === p) dbP = null; try { db.close(); } catch { /* closed */ } };
        db.onversionchange = drop;
        (db as IDBDatabase & { onclose: (() => void) | null }).onclose = drop;
        resolve(db);
      };
      req.onerror = () => { if (dbP === p) dbP = null; resolve(null); };
    } catch { resolve(null); queueMicrotask(() => { if (dbP === p) dbP = null; }); }
  });
  dbP = p;
  return p;
}

/** One request in a transaction; rejects when it fails (opening the database again, once, when its connection went). */
async function idbRun<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void, retry = true): Promise<T | undefined> {
  const opened = linkedDb();
  const db = await opened;
  if (!db) throw new Error('No IndexedDB here (a private window?).');
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      t.onerror = () => reject(t.error ?? req?.error ?? new Error('IndexedDB error'));
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
    });
  } catch (e) {
    // "The database connection is closing" / "Connection to Indexed Database server lost": open it again.
    const name = (e as { name?: string })?.name;
    if (retry && (name === 'InvalidStateError' || name === 'UnknownError' || name === 'TransactionInactiveError')) {
      if (dbP === opened) dbP = null;
      try { db.close(); } catch { /* closed */ }
      return idbRun(store, mode, fn, false);
    }
    throw e;
  }
}

/** Lenient: undefined when it fails (thumbnails, which are only a cache). */
export async function linkedIdb<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  try { return await idbRun<T>(store, mode, fn); } catch { return undefined; }
}

// The list of linked folders is kept one record per folder, so a change only
// ever writes its own folder: nothing can write a whole list over folders
// linked in another window, tab or copy of the app, or before the list was read.
//   Desktop   the app's data folder (linked-folders.json, through lf_store_* in
//             src-tauri/src/linked.rs), not WebKit's storage
//   Browser   IndexedDB `kv`, key `folder:<id>` (a directory handle can only live there)
// Older versions kept one array under `folders` (rewritten whole on every
// change): it's moved over, once, the first time the list is read.

/** What's kept of a folder (no memory backends, no session state). */
export type SavedFolder = LinkedFolder;

export interface LinkedListStore {
  list(): Promise<SavedFolder[]>;
  put(f: SavedFolder): Promise<void>;
  remove(id: string): Promise<void>;
}

const LEGACY = 'folders';
const REC = 'folder:';
const validSaved = (f: unknown): f is SavedFolder => !!f && typeof (f as SavedFolder).id === 'string' && !!(f as SavedFolder).id && typeof (f as SavedFolder).backend === 'string';
const toSaved = (f: LinkedFolder): SavedFolder => {
  const out: SavedFolder = { id: f.id, name: f.name, kind: f.kind, backend: f.backend, addedAt: f.addedAt };
  if (f.path) out.path = f.path;
  if (f.handle) out.handle = f.handle;
  return out;
};

/** The legacy single array, if it's still there. */
async function readLegacy(): Promise<SavedFolder[]> {
  const got = await idbRun<unknown>(KV, 'readonly', s => s.get(LEGACY));
  return Array.isArray(got) ? got.filter(validSaved) : [];
}

/** Browser: one IndexedDB record per folder. */
export function idbListStore(): LinkedListStore {
  return {
    async list() {
      // Move the old single array over (its folders become records, unless one's already there).
      const legacy = await readLegacy();
      if (legacy.length) {
        await idbRun(KV, 'readwrite', s => {
          for (const f of legacy) {
            const key = REC + f.id;
            const r = s.get(key);
            r.onsuccess = () => { if (!r.result) s.put(f, key); };
          }
          s.delete(LEGACY);
        });
      } else {
        // An empty legacy array: drop it so it's never read again.
        await idbRun(KV, 'readwrite', s => { s.delete(LEGACY); }).catch(() => {});
      }
      const out: SavedFolder[] = [];
      await idbRun(KV, 'readonly', s => {
        const range = IDBKeyRange.bound(REC, `${REC}￿`);
        const req = s.openCursor(range);
        req.onsuccess = () => { const c = req.result; if (!c) return; if (validSaved(c.value)) out.push(c.value); c.continue(); };
        return req;
      });
      return out.sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
    },
    async put(f) { await idbRun(KV, 'readwrite', s => s.put(f, REC + f.id)); },
    async remove(id) { await idbRun(KV, 'readwrite', s => s.delete(REC + id)); },
  };
}

/**
 * Desktop: the list in the app's data folder (src-tauri/src/linked.rs). The
 * first time, folders WebKit's IndexedDB still has (the old array, or records)
 * are moved over, and then dropped from there.
 */
export function desktopListStore(invoke: Invoke = async (cmd, args) => (await tauri())(cmd, args)): LinkedListStore {
  let migrated = false;
  const fromIdb = async (): Promise<SavedFolder[]> => {
    // WebKit's storage can stall; the list mustn't wait on it for long.
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000));
    const read = (async () => {
      const legacy = await readLegacy();
      const recs = await idbListStore().list().catch(() => [] as SavedFolder[]);
      const seen = new Set<string>();
      return [...legacy, ...recs].filter(f => f.backend === 'desktop' && !!f.path && !seen.has(f.id) && !!seen.add(f.id));
    })();
    return Promise.race([read, timeout]);
  };
  return {
    async list() {
      const saved = (await invoke<unknown[]>('lf_store_list')).filter(validSaved);
      if (!migrated) {
        migrated = true;
        try {
          const old = await fromIdb();
          const have = new Set(saved.map(f => f.id));
          const add = old.filter(f => !have.has(f.id));
          for (const f of add) { const s = { ...f }; delete s.handle; await invoke('lf_store_put', { folder: s }); saved.push(s); }
          // Moved: the page's copy goes, so a folder unlinked later can't come back from it.
          if (old.length) await idbRun(KV, 'readwrite', s => { s.delete(LEGACY); for (const f of old) s.delete(REC + f.id); });
        } catch (e) { migrated = false; if ((e as Error)?.message !== 'timeout') console.warn('[linked] couldn’t move the older list over', e); }
      }
      return saved;
    },
    async put(f) { const s = { ...f }; delete s.handle; await invoke('lf_store_put', { folder: s }); },
    async remove(id) { await invoke('lf_store_remove', { id }); },
  };
}

let listStore: LinkedListStore | null = null;
const store = (): LinkedListStore => (listStore ??= linkedSupport() === 'desktop' ? desktopListStore() : idbListStore());
/** Tests: keep the list somewhere else (null: back to the default). */
export function setLinkedListStore(s: LinkedListStore | null): void { listStore = s; }

/** Other windows and tabs: the list changed, read it again. */
let channel: BroadcastChannel | null | undefined;
const bus = () => {
  if (channel === undefined) {
    try { channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('playfield-linked-folders') : null; } catch { channel = null; }
    if (channel) channel.onmessage = () => { void refreshLinkedFolders(); };
  }
  return channel;
};
const announce = () => { try { bus()?.postMessage('changed'); } catch { /* closed */ } };

/** Folders that are linked this session but couldn't be saved (tried again on the next change or focus). */
const unsaved = new Set<string>();

async function saveFolder(f: LinkedFolder): Promise<boolean> {
  if (f.backend === 'memory') return true;
  unsaved.add(f.id); // (also: on its way, so a list read meanwhile keeps it)
  try {
    await store().put(toSaved(f));
    unsaved.delete(f.id);
    announce();
    return true;
  } catch (e) {
    unsaved.add(f.id);
    console.warn('[linked] couldn’t save a linked folder', e);
    warnUnsaved(f, e);
    return false;
  }
}

async function dropFolder(id: string): Promise<void> {
  unsaved.delete(id);
  try { await store().remove(id); announce(); } catch (e) { console.warn('[linked] couldn’t remove a linked folder from the list', e); }
}

let warned = 0;
function warnUnsaved(f: LinkedFolder, e: unknown): void {
  if (Date.now() - warned < 10_000) return;
  warned = Date.now();
  void import('../components/ui/toastStore').then(({ toast }) => toast.error(`“${f.name}” is linked, but couldn’t be saved`, {
    message: `It works until the app closes; the app tries again. ${e instanceof Error ? e.message : String(e)}`,
  })).catch(() => {});
}

// ── The store ───────────────────────────────────────────────────────────────

interface LinkedState {
  loaded: boolean;
  folders: LinkedFolder[];
  status: Record<string, LinkedStatus>;
}

export const useLinkedFolders = create<LinkedState>(() => ({ loaded: false, folders: [], status: {} }));

const backends = new Map<string, LinkedFs>();
const watchers = new Map<string, () => void>();

function fsFor(f: LinkedFolder): LinkedFs | null {
  const had = backends.get(f.id);
  if (had) return had;
  const made = f.backend === 'desktop' && f.path ? desktopLinkedFs(f.path) : f.backend === 'browser' && f.handle ? handleLinkedFs(f.handle) : null;
  if (made) backends.set(f.id, made);
  return made;
}

export const getLinkedFolder = (id: string) => useLinkedFolders.getState().folders.find(f => f.id === id) ?? null;
const setStatus = (id: string, s: LinkedStatus) => {
  if (useLinkedFolders.getState().status[id] === s) return;
  useLinkedFolders.setState(st => ({ status: { ...st.status, [id]: s } }));
};

let seq = 0;
export const newLinkedId = () => `lf_${Date.now().toString(36)}${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const cleanName = (n: string) => n.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Folder';
const guessKind = (name: string): LinkedKindHint =>
  /sample|drum|kit|sound|audio|loop|one.?shot|wav/i.test(name) ? 'samples' : /font|type/i.test(name) ? 'fonts' : /video|clip|footage|movie/i.test(name) ? 'videos' : /image|photo|picture|texture|img|png|jpg/i.test(name) ? 'images' : 'any';

/** Desktop: tell the Rust side which roots it may read. */
async function registerRoots(): Promise<void> {
  if (linkedSupport() !== 'desktop') return;
  const roots = useLinkedFolders.getState().folders.filter(f => f.backend === 'desktop' && f.path).map(f => f.path!);
  try { await (await tauri())('lf_set_roots', { roots }); } catch (e) { console.warn('[linked] couldn’t register the linked folders', e); }
}

/** Check a folder (and start watching it when it's there). */
export async function checkLinkedFolder(id: string): Promise<LinkedStatus> {
  const f = getLinkedFolder(id);
  const fs = f ? fsFor(f) : null;
  if (!f || !fs) return 'missing';
  const p = await fs.probe();
  const s: LinkedStatus = p === 'ok' ? 'connected' : p === 'permission' ? 'permission' : 'missing';
  setStatus(id, s);
  if (s === 'connected' && fs.watch && !watchers.has(id)) {
    watchers.set(id, () => {});
    try { watchers.set(id, await fs.watch(paths => onFolderChanged(id, paths))); } catch { watchers.delete(id); }
  }
  return s;
}

/** Changes made here, numbered: a list read from storage before a change doesn't undo it. */
let gen = 0;
const touched = new Map<string, number>();
const touch = (id: string) => { touched.set(id, ++gen); };

function stopFolder(id: string): void {
  watchers.get(id)?.();
  watchers.delete(id);
  backends.delete(id);
  forgetFolder(id);
}

/**
 * Bring the in-memory list in line with what's saved (read when `since` was
 * the change number). Folders changed here since then stay as they are here;
 * memory folders (tests) and ones that couldn't be saved yet stay too. Folders
 * gone from the list stop; ones moved elsewhere are opened again. Returns the
 * ids that are new or moved (to check).
 */
function applySaved(saved: SavedFolder[], since: number): string[] {
  const st = useLinkedFolders.getState();
  const local = (id: string) => (touched.get(id) ?? 0) > since;
  const savedIds = new Set(saved.map(f => f.id));
  const next: LinkedFolder[] = [];
  const fresh: string[] = [];
  for (const f of saved) {
    const had = st.folders.find(x => x.id === f.id);
    if (local(f.id)) { if (had) next.push(had); continue; }
    if (!had) { next.push(f); fresh.push(f.id); continue; }
    // (A handle read again is a new object for the same folder: compare what it points at by name.)
    const moved = had.backend !== f.backend || had.path !== f.path || had.handle?.name !== f.handle?.name;
    if (moved) { stopFolder(f.id); fresh.push(f.id); }
    next.push(moved ? { ...had, ...f } : had.name !== f.name || had.kind !== f.kind ? { ...had, name: f.name, kind: f.kind } : had);
  }
  for (const f of st.folders) {
    if (savedIds.has(f.id)) continue;
    if (f.backend === 'memory' || unsaved.has(f.id) || local(f.id)) next.push(f);
    else stopFolder(f.id);
  }
  const status: Record<string, LinkedStatus> = {};
  for (const f of next) status[f.id] = fresh.includes(f.id) ? 'checking' : st.status[f.id] ?? 'checking';
  const same = next.length === st.folders.length && next.every((f, i) => f === st.folders[i]);
  if (!same || !st.loaded) useLinkedFolders.setState({ loaded: true, folders: next, status });
  return fresh;
}

let listing: Promise<boolean> | null = null;
/** Read the saved list into memory (once; again after it failed). True when it was read. */
function readList(): Promise<boolean> {
  return (listing ??= (async () => {
    const since = gen;
    try {
      applySaved(await store().list(), since);
      return true;
    } catch (e) {
      console.warn('[linked] couldn’t read the linked folders list', e);
      listing = null;
      if (!useLinkedFolders.getState().loaded) useLinkedFolders.setState({ loaded: true });
      return false;
    }
  })());
}

let loading: Promise<void> | null = null;
/** Read the list and check each folder. Safe to call again (does it once). */
export function loadLinkedFolders(): Promise<void> {
  return (loading ??= (async () => {
    const ok = await readList();
    if (!ok) loading = null;
    await registerRoots();
    await Promise.all(useLinkedFolders.getState().folders.map(f => checkLinkedFolder(f.id)));
    startRecheck();
  })());
}

/**
 * Read the list again (another window or tab changed it, the window got focus)
 * and save any folder that couldn't be saved before.
 */
export async function refreshLinkedFolders(): Promise<void> {
  if (!useLinkedFolders.getState().loaded) { await loadLinkedFolders(); return; }
  for (const id of [...unsaved]) { const f = getLinkedFolder(id); if (f) await saveFolder(f); else unsaved.delete(id); }
  const since = gen;
  let saved: SavedFolder[];
  try { saved = await store().list(); } catch { return; }
  const before = useLinkedFolders.getState().folders;
  const fresh = applySaved(saved, since);
  if (!fresh.length && useLinkedFolders.getState().folders === before) return;
  await registerRoots();
  await Promise.all(fresh.map(id => checkLinkedFolder(id)));
  emitChange(null);
}

/** Link a folder that's already open (a test's memory folder, a handle from elsewhere). */
export async function addLinkedFolder(f: Omit<LinkedFolder, 'id' | 'addedAt' | 'kind'> & { id?: string; kind?: LinkedKindHint }, fs?: LinkedFs): Promise<LinkedFolder> {
  // The saved list first, so this one joins it (never the other way round).
  await readList();
  const folder: LinkedFolder = { ...f, id: f.id ?? newLinkedId(), name: cleanName(f.name), kind: f.kind ?? guessKind(f.name), addedAt: Date.now() };
  if (fs) backends.set(folder.id, fs);
  touch(folder.id);
  useLinkedFolders.setState(st => ({ loaded: true, folders: [...st.folders.filter(x => x.id !== folder.id), folder], status: { ...st.status, [folder.id]: 'checking' } }));
  await saveFolder(folder);
  await registerRoots();
  await checkLinkedFolder(folder.id);
  return folder;
}

/** Pick a folder in the system dialog (desktop) or the browser's folder picker, and link it. Null when cancelled. */
export async function linkFolder(o: { kind?: LinkedKindHint } = {}): Promise<LinkedFolder | null> {
  const picked = await pickFolder();
  if (!picked) return null;
  await readList();
  const same = useLinkedFolders.getState().folders.find(f => (picked.path && f.path === picked.path));
  if (same) {
    if (unsaved.has(same.id)) await saveFolder(same);
    await checkLinkedFolder(same.id);
    return same;
  }
  return addLinkedFolder({ ...picked, kind: o.kind });
}

async function pickFolder(): Promise<Pick<LinkedFolder, 'name' | 'backend' | 'path' | 'handle'> | null> {
  const support = linkedSupport();
  if (support === 'desktop') {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, multiple: false, title: 'Link a folder' });
    if (typeof dir !== 'string' || !dir) return null;
    return { name: dir.split(/[\\/]/).filter(Boolean).pop() ?? dir, backend: 'desktop', path: dir };
  }
  if (support === 'browser') {
    try {
      const h = await (window as PickerWindow).showDirectoryPicker!({ id: 'playfield-linked', mode: 'read' });
      return { name: h.name, backend: 'browser', handle: h };
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return null;
      throw e;
    }
  }
  throw new Error(UNSUPPORTED_TEXT);
}

/** Change one folder here and save just that folder. */
async function changeFolder(id: string, fn: (f: LinkedFolder) => LinkedFolder): Promise<LinkedFolder | null> {
  const had = getLinkedFolder(id);
  if (!had) return null;
  const next = fn(had);
  touch(id);
  useLinkedFolders.setState(st => ({ folders: st.folders.map(f => (f.id === id ? next : f)) }));
  await saveFolder(next);
  return next;
}

export async function renameLinkedFolder(id: string, name: string): Promise<void> {
  await changeFolder(id, f => ({ ...f, name: cleanName(name) }));
}

export async function setLinkedKind(id: string, kind: LinkedKindHint): Promise<void> {
  await changeFolder(id, f => ({ ...f, kind }));
}

/** Unlink a folder (nothing on disk is touched). Returns a function that links it back (same id, so setups find it again). */
export async function unlinkFolder(id: string): Promise<(() => Promise<void>) | null> {
  const f = getLinkedFolder(id);
  if (!f) return null;
  const fs = backends.get(id);
  stopFolder(id);
  touch(id);
  useLinkedFolders.setState(st => {
    const status = { ...st.status };
    delete status[id];
    return { folders: st.folders.filter(x => x.id !== id), status };
  });
  if (f.backend !== 'memory') await dropFolder(id);
  await registerRoots();
  emitChange(null);
  return async () => {
    if (fs) backends.set(id, fs);
    touch(id);
    useLinkedFolders.setState(st => ({ folders: [...st.folders.filter(x => x.id !== id), f], status: { ...st.status, [id]: 'checking' } }));
    await saveFolder(f);
    await registerRoots();
    await checkLinkedFolder(id);
    emitChange(null);
  };
}

/** One click to allow a browser folder again (or check a desktop one again). */
export async function reconnectLinkedFolder(id: string): Promise<LinkedStatus> {
  const f = getLinkedFolder(id);
  const fs = f ? fsFor(f) : null;
  if (!f || !fs) return 'missing';
  if (fs.requestPermission) await fs.requestPermission();
  const s = await checkLinkedFolder(id);
  if (s === 'connected') { forgetFolder(id); emitChange(null); }
  return s;
}

/**
 * Point a linked folder at another place on disk (it was moved, or the drive
 * has a new name). It keeps its id, so everything that uses its files finds
 * them again when the paths inside are the same.
 */
export async function relocateLinkedFolder(id: string, picked?: Pick<LinkedFolder, 'backend' | 'path' | 'handle'>, fs?: LinkedFs): Promise<boolean> {
  const f = getLinkedFolder(id);
  if (!f) return false;
  const to = picked ?? await pickFolder();
  if (!to) return false;
  stopFolder(id);
  if (fs) backends.set(id, fs);
  setStatus(id, 'checking');
  await changeFolder(id, x => ({ ...x, backend: to.backend, path: to.path, handle: to.handle }));
  await registerRoots();
  await checkLinkedFolder(id);
  emitChange(null);
  return true;
}

// ── Browsing ────────────────────────────────────────────────────────────────

function ready(folderId: string): LinkedFs {
  const f = getLinkedFolder(folderId);
  const fs = f ? fsFor(f) : null;
  if (!f || !fs) throw new LinkedError('folder', 'That linked folder isn’t here any more.');
  return fs;
}

const byNameDirsFirst = (a: LinkedEntry, b: LinkedEntry) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : naturalCompare(a.name, b.name));

/** One folder's entries: folders first, then files, in Finder's order. */
export async function listLinked(folderId: string, dir = ''): Promise<LinkedEntry[]> {
  const d = dir ? cleanPath(dir) : '';
  if (d === null) throw new LinkedError('bad', `Not a folder path: ${dir}`);
  try {
    const got = await ready(folderId).list(d);
    setStatus(folderId, 'connected');
    return got.map(e => ({ ...e, path: d ? `${d}/${e.name}` : e.name })).sort(byNameDirsFirst);
  } catch (e) {
    const err = toError(e);
    if (err.reason === 'folder' || err.reason === 'permission') setStatus(folderId, err.reason === 'folder' ? 'missing' : 'permission');
    throw err;
  }
}

/**
 * Files under a folder whose name has `query` (any case) and that take
 * `filter`, walking at most `maxDirs` folders and returning at most `limit`.
 */
export async function searchLinked(folderId: string, query: string, filter: LinkedFilter, o: { dir?: string; limit?: number; maxDirs?: number } = {}): Promise<{ files: LinkedEntry[]; complete: boolean }> {
  const q = query.trim().toLowerCase();
  const limit = o.limit ?? 300, maxDirs = o.maxDirs ?? 400;
  const out: LinkedEntry[] = [];
  const queue = [o.dir ?? ''];
  let walked = 0;
  while (queue.length && out.length < limit) {
    if (walked++ >= maxDirs) return { files: out, complete: false };
    const dir = queue.shift()!;
    let entries: LinkedEntry[];
    try { entries = await listLinked(folderId, dir); } catch (e) { if (dir === (o.dir ?? '')) throw e; continue; }
    for (const e of entries) {
      if (e.dir) queue.push(e.path);
      else if (matchesFilter(e.name, filter) && (!q || e.name.toLowerCase().includes(q))) { out.push(e); if (out.length >= limit) break; }
    }
  }
  return { files: out, complete: !queue.length };
}

// ── Resolving references ────────────────────────────────────────────────────

/** Files read this session, by reference (read again when the file changed). */
const cache = new Map<string, { blob: Blob; size: number; mtime: number }>();
const problems = new Map<string, LinkedProblem>();

function forgetFolder(folderId: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(`linked:${folderId}/`)) cache.delete(k);
}

/** A linked file's size and time, or null (and why, through linkedProblem). */
export async function statLinked(ref: string): Promise<{ size: number; mtime: number } | null> {
  const p = parseLinkedRef(ref);
  if (!p) return null;
  try { return await ready(p.folderId).stat(p.path); } catch { return null; }
}

/** The file a reference names: from this session's copy while it's unchanged, else read from the folder. */
export async function resolveLinked(ref: string): Promise<Resolved> {
  const p = parseLinkedRef(ref);
  if (!p) return { ok: false, reason: 'bad' };
  const f = getLinkedFolder(p.folderId);
  if (!f && !useLinkedFolders.getState().loaded) await loadLinkedFolders().catch(() => {});
  try {
    const fs = ready(p.folderId);
    const st = await fs.stat(p.path);
    const had = cache.get(ref);
    let blob: Blob;
    if (had && had.mtime === st.mtime && had.size === st.size) blob = had.blob;
    else { blob = await fs.read(p.path); cache.set(ref, { blob, size: st.size, mtime: st.mtime }); }
    problems.delete(ref);
    setStatus(p.folderId, 'connected');
    return { ok: true, blob, name: baseNameOf(p.path), type: blob.type || mimeOf(p.path), size: st.size, mtime: st.mtime };
  } catch (e) {
    let err = toError(e, p.path);
    // A file that isn't there may be a whole folder that isn't: ask the folder.
    if (err.reason === 'file' && getLinkedFolder(p.folderId)) {
      const pr = await fsFor(getLinkedFolder(p.folderId)!)?.probe();
      if (pr === 'gone') err = new LinkedError('folder', err.message); else if (pr === 'permission') err = new LinkedError('permission', err.message);
    }
    problems.set(ref, err.reason);
    if (err.reason === 'folder') setStatus(p.folderId, 'missing');
    else if (err.reason === 'permission') setStatus(p.folderId, 'permission');
    return { ok: false, reason: err.reason };
  }
}

/** Why the last resolve of a reference failed (null: it didn't, or it wasn't tried). */
export const linkedProblem = (ref: string): LinkedProblem | null => problems.get(ref) ?? null;

/** A reference for a file in a folder (see linkedRefs.ts). */
export const refFor = (folderId: string, path: string) => linkedRef(folderId, path);

// ── Changes ─────────────────────────────────────────────────────────────────

const changeListeners = new Set<(refs: string[] | null) => void>();
/** Called when files in use changed or went (their refs), or null when a whole folder changed state. */
export function onLinkedChange(cb: (refs: string[] | null) => void): () => void { changeListeners.add(cb); return () => { changeListeners.delete(cb); }; }
function emitChange(refs: string[] | null): void { for (const cb of [...changeListeners]) { try { cb(refs); } catch { /* a listener's problem */ } } }

/** Desktop watcher: drop what changed from the cache and tell the users of those files. */
function onFolderChanged(folderId: string, paths: string[]): void {
  if (paths.some(p => !p)) { void checkLinkedFolder(folderId).then(() => emitChange(null)); return; }
  const changed: string[] = [];
  for (const k of cache.keys()) {
    const p = parseLinkedRef(k);
    if (p && p.folderId === folderId && paths.some(x => x.normalize('NFC') === p.path)) changed.push(k);
  }
  for (const k of changed) cache.delete(k);
  if (changed.length) emitChange(changed);
}

/** Check the files in use again (focus, every 15 s in a browser): changed or gone ones are dropped and announced. */
export async function recheckLinked(): Promise<string[]> {
  const folders = useLinkedFolders.getState().folders;
  const before = { ...useLinkedFolders.getState().status };
  await Promise.all(folders.map(f => checkLinkedFolder(f.id)));
  const changed: string[] = [];
  for (const [ref, had] of [...cache]) {
    const st = await statLinked(ref);
    if (!st || st.mtime !== had.mtime || st.size !== had.size) { cache.delete(ref); changed.push(ref); }
  }
  // Problems that went away (a folder allowed again, a file put back).
  for (const ref of [...problems.keys()]) if (await statLinked(ref)) { problems.delete(ref); changed.push(ref); }
  const after = useLinkedFolders.getState().status;
  const flipped = folders.some(f => before[f.id] !== after[f.id]);
  if (flipped) emitChange(null); else if (changed.length) emitChange(changed);
  return changed;
}

let rechecking = false;
function startRecheck(): void {
  if (rechecking || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  rechecking = true;
  // Another window or copy of the app may have changed the list meanwhile.
  window.addEventListener('focus', () => { void refreshLinkedFolders().then(() => recheckLinked()); });
  bus();
  // The desktop watches; a browser can only look again.
  if (linkedSupport() === 'browser') window.setInterval(() => { if (document.visibilityState === 'visible' && (cache.size || problems.size)) void recheckLinked(); }, 15_000);
}

/**
 * Development: link a folder made in the browser's private file system (OPFS)
 * with these files, so the browser path (a real directory handle) can be tried
 * where the folder picker can't be clicked through.
 */
export async function devLinkOpfs(name: string, files: Record<string, Blob | string>, kind?: LinkedKindHint): Promise<LinkedFolder> {
  type W = { getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<W>; getFileHandle(n: string, o?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }> }> };
  const root = await (navigator.storage as unknown as { getDirectory(): Promise<W> }).getDirectory();
  const top = await root.getDirectoryHandle(`linked-${name}`, { create: true });
  for (const [path, data] of Object.entries(files)) {
    const parts = path.split('/');
    let d = top;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
    await w.write(data);
    await w.close();
  }
  await loadLinkedFolders();
  return addLinkedFolder({ name, backend: 'browser', handle: top as unknown as BrowserDirHandle, kind });
}

/** Tests: forget everything. */
export function resetLinkedForTests(): void {
  for (const w of watchers.values()) w();
  watchers.clear(); backends.clear(); cache.clear(); problems.clear();
  loading = null; listing = null; dbP = null;
  unsaved.clear(); touched.clear(); gen = 0;
  useLinkedFolders.setState({ loaded: false, folders: [], status: {} });
}
