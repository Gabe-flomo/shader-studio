/**
 * backupFolder.ts — a folder outside the browser that always holds a copy of
 * everything Shader Studio keeps (library.ts), so clearing the browser's data
 * or reinstalling loses nothing.
 *
 *   - Desktop app: on by default, in Documents/Shader Studio (or the app's
 *     data folder when that can't be made); any folder can be chosen instead.
 *   - Chrome and Edge: a folder picked once (File System Access). The browser
 *     asks again each visit, so after a reload it needs one click to reconnect.
 *   - Elsewhere (Safari, Firefox, phones): no folder access; Export everything
 *     is the way to keep a copy.
 *
 * What's written: library.json (the whole library, what Restore reads), a
 * dated copy of it in history/ once a day (the last 14 kept), README.txt, and
 * the same things as readable files in folders (graphs/<folder>/<name>.json…).
 * It's rewritten a few seconds after anything is saved. If Shader Studio's
 * own storage is ever empty while the folder isn't (cleared site data, a new
 * machine), nothing is overwritten: Restore is offered instead.
 */
import { describeSnapshot, importLibrary, isLibraryKey, isSnapshot, LIBRARY_FILE, LIBRARY_REFRESH_EVENTS, readableFiles, takeSnapshot, type ImportResult, type LibrarySnapshot } from './library';
import { toast } from '../components/ui/toastStore';

export type BackupSupport = 'desktop' | 'browser' | 'none';

export interface BackupStatus {
  support: BackupSupport;
  /** Where it goes: a path on desktop, a folder name in the browser. */
  folder: string | null;
  /** The browser needs a click to allow the folder again this visit. */
  needsPermission: boolean;
  lastBackup: number | null;
  /** The folder has a library while Shader Studio's storage is empty. */
  canRestore: boolean;
  error: string | null;
}

const DIR_KEY = 'shader-studio:settings:backupDir';
const HISTORY_KEEP = 14;
const DEBOUNCE_MS = 4000;
/** Top-level entries the readable files use: cleared before rewriting so deleted things don't linger. */
const READABLE_ROOTS = ['graphs', 'group presets', 'functions', 'expressions', 'transforms', 'keyframe presets', 'published nodes', 'palettes.json', 'glsl shaders.json', 'settings.json'];
const README = `Shader Studio backup

Shader Studio keeps this folder up to date with everything you save.

library.json      everything, exactly: Preferences → Library → Restore reads it
history/          a copy of library.json per day, the last ${HISTORY_KEEP} days
graphs/ …         the same things as separate files, to browse or share

Don't edit library.json by hand; the readable files are copies.
`;

// ── Where to write ──────────────────────────────────────────────────────────

export interface Target {
  label: string;
  write(path: string, text: string): Promise<void>;
  read(path: string): Promise<string | null>;
  remove(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function desktopTarget(base: string): Promise<Target> {
  const fs = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');
  await fs.mkdir(base, { recursive: true });
  const full = (p: string) => join(base, ...p.split('/'));
  return {
    label: base,
    async write(p, text) {
      const parts = p.split('/');
      if (parts.length > 1) await fs.mkdir(await join(base, ...parts.slice(0, -1)), { recursive: true });
      await fs.writeTextFile(await full(p), text);
    },
    async read(p) { const f = await full(p); return (await fs.exists(f)) ? fs.readTextFile(f) : null; },
    async remove(p) { const f = await full(p); if (await fs.exists(f)) await fs.remove(f, { recursive: true }); },
    async list(dir) { const f = await full(dir); return (await fs.exists(f)) ? (await fs.readDir(f)).map(e => e.name) : []; },
  };
}

// The File System Access API isn't in TypeScript's DOM types yet.
export interface DirHandle {
  name: string;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<{ getFile(): Promise<File>; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
  keys(): AsyncIterable<string>;
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
}
export type PickerWindow = Window & { showDirectoryPicker?: (o?: { id?: string; mode?: 'readwrite' }) => Promise<DirHandle> };

function browserTarget(root: DirHandle): Target {
  const dirOf = async (parts: string[], create: boolean) => {
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  };
  return {
    label: root.name,
    async write(p, text) {
      const parts = p.split('/');
      const d = await dirOf(parts.slice(0, -1), true);
      const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await w.write(text);
      await w.close();
    },
    async read(p) {
      try { const parts = p.split('/'); const d = await dirOf(parts.slice(0, -1), false); return await (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).text(); } catch { return null; }
    },
    async remove(p) {
      try { const parts = p.split('/'); const d = await dirOf(parts.slice(0, -1), false); await d.removeEntry(parts[parts.length - 1], { recursive: true }); } catch { /* not there */ }
    },
    async list(dir) {
      try { const d = await dirOf(dir.split('/'), false); const out: string[] = []; for await (const k of d.keys()) out.push(k); return out; } catch { return []; }
    },
  };
}

// The picked folder's handle is kept in IndexedDB (handles can't go in localStorage).
export function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return new Promise(resolve => {
    try {
      const open = indexedDB.open('shader-studio-backup', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('handles');
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        const req = run(open.result.transaction('handles', mode).objectStore('handles'));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => resolve(undefined);
      };
    } catch { resolve(undefined); }
  });
}

// ── State ───────────────────────────────────────────────────────────────────

let target: Target | null = null;
let handle: DirHandle | null = null;
let status: BackupStatus = {
  support: typeof window === 'undefined' ? 'none' : isTauri() ? 'desktop' : typeof (window as PickerWindow).showDirectoryPicker === 'function' ? 'browser' : 'none',
  folder: null, needsPermission: false, lastBackup: null, canRestore: false, error: null,
};
const listeners = new Set<(s: BackupStatus) => void>();
const set = (patch: Partial<BackupStatus>) => { status = { ...status, ...patch }; for (const l of listeners) l(status); };

export function backupStatus(): BackupStatus { return status; }
export function onBackupStatus(cb: (s: BackupStatus) => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

// ── Writing ─────────────────────────────────────────────────────────────────

let timer = 0;
let lastLibrary = '';
let lastReadable = '';
let writing = false;
let again = false;

const hasContent = (s: LibrarySnapshot) => { const d = describeSnapshot(s); return d.graphs + d.presets + d.nodes > 0; };
const today = () => new Date().toISOString().slice(0, 10);

async function folderLibrary(): Promise<LibrarySnapshot | null> {
  const text = target ? await target.read(LIBRARY_FILE) : null;
  if (!text) return null;
  try { const v = JSON.parse(text); return isSnapshot(v) ? v : null; } catch { return null; }
}

/** Write the library to the folder now (skipped when nothing changed). */
export async function backupNow(force = false): Promise<void> {
  if (!target) return;
  if (writing) { again = true; return; }
  writing = true;
  try {
    const snap = takeSnapshot();
    // Never replace a backup that has things with an empty library: that's the moment it's needed.
    if (!hasContent(snap)) {
      const there = await folderLibrary();
      if (there && hasContent(there)) { set({ canRestore: true }); return; }
    }
    const libText = JSON.stringify(snap.items);
    if (!force && libText === lastLibrary) return;
    await target.write(LIBRARY_FILE, JSON.stringify(snap));
    await target.write(`history/library-${today()}.json`, JSON.stringify(snap));
    // Settings (panel sizes and such) change often: they have a file of their own, and the
    // graphs and presets are only rewritten when one of them changed.
    const { 'settings.json': settingsFile, ...files } = readableFiles(snap);
    const readableSig = JSON.stringify(files);
    if (force || readableSig !== lastReadable) {
      for (const r of READABLE_ROOTS) if (r !== 'settings.json') await target.remove(r);
      for (const [p, c] of Object.entries(files)) await target.write(p, c);
      await target.write('README.txt', README);
      lastReadable = readableSig;
    }
    if (settingsFile) await target.write('settings.json', settingsFile);
    const old = (await target.list('history')).filter(n => /^library-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().slice(0, -HISTORY_KEEP);
    for (const n of old) await target.remove(`history/${n}`);
    lastLibrary = libText;
    set({ lastBackup: Date.now(), error: null, canRestore: false });
  } catch (e) {
    console.warn('[backup] writing the backup folder failed', e);
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    writing = false;
    if (again) { again = false; schedule(); }
  }
}

function schedule(): void {
  if (!target) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { void backupNow(); }, DEBOUNCE_MS);
}

/** Every write to the app's storage schedules a backup (debounced). */
let hooked = false;
function hookStorage(): void {
  if (hooked || typeof Storage === 'undefined') return;
  hooked = true;
  const setItem = Storage.prototype.setItem, removeItem = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (this: Storage, k: string, v: string) { setItem.call(this, k, v); if (this === localStorage && isLibraryKey(k) && k !== DIR_KEY) schedule(); };
  Storage.prototype.removeItem = function (this: Storage, k: string) { removeItem.call(this, k); if (this === localStorage && isLibraryKey(k)) schedule(); };
  window.addEventListener('pagehide', () => { if (timer) { window.clearTimeout(timer); void backupNow(); } });
}

async function connect(t: Target): Promise<void> {
  target = t;
  lastLibrary = ''; lastReadable = '';
  set({ folder: t.label, needsPermission: false, error: null });
  hookStorage();
  await backupNow();
  if (status.canRestore) offerRestore();
}

function offerRestore(): void {
  void folderLibrary().then(lib => {
    if (!lib) return;
    const d = describeSnapshot(lib);
    toast.info('Your backup folder has your library', {
      message: `${d.graphs} graphs and ${d.presets} presets from ${new Date(lib.savedAt).toLocaleString()}, but Shader Studio’s storage here is empty.`,
      action: { label: 'Restore', onClick: () => { void restoreFromFolder(); } },
      sticky: true,
    });
  });
}

// ── Setup and actions ───────────────────────────────────────────────────────

async function defaultDesktopDir(): Promise<string> {
  const { documentDir, appDataDir, join } = await import('@tauri-apps/api/path');
  try {
    const d = await join(await documentDir(), 'Shader Studio');
    const fs = await import('@tauri-apps/plugin-fs');
    await fs.mkdir(d, { recursive: true });
    return d;
  } catch {
    return join(await appDataDir(), 'Backup');
  }
}

/** Called once at startup: connect to the folder (or say what's needed), keep the browser's storage. */
export async function startBackups(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
  try {
    if (status.support === 'desktop') {
      const chosen = localStorage.getItem(DIR_KEY);
      let dir = chosen || await defaultDesktopDir();
      let t: Target;
      try { t = await desktopTarget(dir); } catch { dir = await defaultDesktopDir(); t = await desktopTarget(dir); }
      await connect(t);
    } else if (status.support === 'browser') {
      const h = await idb<DirHandle>('readonly', s => s.get('folder'));
      if (!h) return;
      handle = h;
      if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') await connect(browserTarget(h));
      else set({ folder: h.name, needsPermission: true });
    }
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** Pick a different folder (desktop) or a folder at all (browser). */
export async function chooseBackupFolder(): Promise<void> {
  if (status.support === 'desktop') {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== 'string') return;
    localStorage.setItem(DIR_KEY, dir);
    await connect(await desktopTarget(dir));
  } else if (status.support === 'browser') {
    const pick = (window as PickerWindow).showDirectoryPicker;
    if (!pick) return;
    const h = await pick({ id: 'shader-studio-backup', mode: 'readwrite' });
    handle = h;
    await idb('readwrite', s => s.put(h, 'folder'));
    await connect(browserTarget(h));
  }
  if (status.lastBackup) toast.success('Backing up to this folder', { message: `${status.folder}: updated a few seconds after anything is saved.` });
}

/** The browser forgot the permission (a new visit): one click to allow the same folder again. */
export async function reconnectBackupFolder(): Promise<void> {
  if (!handle) return;
  if ((await handle.requestPermission({ mode: 'readwrite' })) === 'granted') await connect(browserTarget(handle));
}

/** Back to the default folder (desktop: Documents/Shader Studio; a browser forgets its picked folder). */
export async function resetBackupFolder(): Promise<void> {
  if (status.support === 'desktop') {
    localStorage.removeItem(DIR_KEY);
    await connect(await desktopTarget(await defaultDesktopDir()));
  } else await stopBrowserBackups();
}

export async function stopBrowserBackups(): Promise<void> {
  target = null; handle = null;
  await idb('readwrite', s => s.delete('folder'));
  set({ folder: null, needsPermission: false, lastBackup: null, canRestore: false });
}

/** Bring the folder's library in (merging: nothing of yours is overwritten). */
export async function restoreFromFolder(): Promise<ImportResult | null> {
  const lib = await folderLibrary();
  if (!lib) { toast.error('No library in the backup folder yet'); return null; }
  const r = importLibrary(lib);
  for (const ev of LIBRARY_REFRESH_EVENTS) window.dispatchEvent(new Event(ev));
  set({ canRestore: false });
  toast.success('Restored from the backup folder', {
    message: `${r.added} added${r.renamed.length ? `, ${r.renamed.length} as “… (imported)”` : ''}. Reload to load published nodes and settings.`,
    action: { label: 'Reload', onClick: () => location.reload() },
    sticky: true,
  });
  void backupNow(true);
  return r;
}

/** For tests: back up into any target (an in-memory folder). */
export const backupTesting = { connect: (t: Target) => connect(t) };
