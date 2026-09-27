/**
 * workspace.ts — the workspace folder in the app: which folder, its status,
 * when to sync, and the actions the Files page and Settings offer.
 *
 * The app keeps working from its own storage at all times; the folder is
 * synced in the background (engine.ts) a moment after anything is saved,
 * when the window comes back into focus, every so often while it's visible,
 * and (desktop) when the folder changes on disk. When the folder can't be
 * reached (drive unplugged, permission not given again after a reload,
 * folder moved) the status says so, changes wait, and it tries again —
 * nothing here ever throws into the UI or removes anything from the app's
 * storage because the folder is missing.
 *
 *   Desktop       any folder (Rust commands, tauriFs.ts), watched for changes
 *   Chrome/Edge   a picked folder (File System Access); after a reload the
 *                 browser asks again: one click on "Reconnect"
 *   Safari etc.   not available; Files → Download/Install still work
 */
import { useSyncExternalStore } from 'react';
import { localMutableKV } from '../files/mutate';
import { isLibraryKey } from '../utils/library';
import { APP_VERSION } from '../files/appVersion';
import { toast } from '../components/ui/toastStore';
import { newState, SyncEngine, UNUSED, type ConflictRecord, type PendingChange, type SyncState } from './engine';
import { handleFs, WorkspaceFsError, type DirHandleLike, type WsFs } from './fs';
import { WORKSPACE_FILE, type ImageStore } from './layout';
import { loadConfig, loadSyncState, saveConfig, saveSyncState, type WorkspaceConfig } from './store';

export type WorkspaceSupport = 'desktop' | 'browser' | 'none';
export type WorkspaceState =
  | 'off'              // no workspace chosen
  | 'connecting'
  | 'syncing'
  | 'synced'
  | 'offline'          // the folder can't be reached (drive removed, moved)
  | 'needs-permission' // the browser wants a click to allow the folder again
  | 'not-workspace'    // the folder is there but isn't the workspace this app synced with
  | 'held'             // many deletions at once: waiting for a yes
  | 'error';

export interface WorkspaceStatus {
  support: WorkspaceSupport;
  state: WorkspaceState;
  /** The folder: a path on desktop, its name in a browser. */
  folder: string | null;
  message: string | null;
  lastSyncAt: number | null;
  pending: PendingChange[];
  conflicts: ConflictRecord[];
  problems: string[];
  held: number;
  /** Where the held deletions happened: in the folder, or in this app's storage. */
  heldWhere: 'folder' | 'here';
  /** The old backup folder, offered as the workspace. */
  legacy: { label: string } | null;
  /** Desktop: the suggested folder (Documents/Shader Studio). */
  suggested: string | null;
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
type PickerWindow = Window & { showDirectoryPicker?: (o?: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<DirHandleLike> };
const support: WorkspaceSupport = typeof window === 'undefined' ? 'none' : isTauri() ? 'desktop' : typeof (window as PickerWindow).showDirectoryPicker === 'function' ? 'browser' : 'none';

let status: WorkspaceStatus = { support, state: 'off', folder: null, message: null, lastSyncAt: null, pending: [], conflicts: [], problems: [], held: 0, heldWhere: 'folder', legacy: null, suggested: null };
const listeners = new Set<() => void>();
function set(patch: Partial<WorkspaceStatus>): void {
  status = { ...status, ...patch };
  for (const l of [...listeners]) { try { l(); } catch { /* a listener's problem */ } }
}
export function workspaceStatus(): WorkspaceStatus { return status; }
export function onWorkspaceStatus(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function useWorkspaceStatus(): WorkspaceStatus { return useSyncExternalStore(onWorkspaceStatus, workspaceStatus, workspaceStatus); }

// ── The app's stores ────────────────────────────────────────────────────────

async function appImages(): Promise<ImageStore> {
  const lib = await import('../lib/backgroundLibrary');
  return {
    list: () => lib.listImages(),
    async read(id) { const img = await lib.getImage(id); return img ? new Uint8Array(await img.blob.arrayBuffer()) : null; },
    async put(meta, data) {
      const copy = new Uint8Array(data.byteLength); copy.set(data);
      await lib.addImage(new Blob([copy.buffer], { type: meta.type }), {
        id: meta.id, name: meta.name, createdAt: meta.createdAt, width: meta.width || undefined, height: meta.height || undefined,
        ...(meta.source ? { source: meta.source as never } : {}),
      });
    },
    rename: (id, name) => lib.renameImage(id, name),
    async remove(id) { await lib.deleteImage(id); },
  };
}

/** Tell the app what the folder changed, so lists refresh (and offer to reopen a changed open graph). */
async function refreshApp(keys: string[], images: boolean): Promise<void> {
  if (!keys.length && !images) return;
  try {
    const { syncApp } = await import('../components/files/filesActions');
    syncApp(keys);
    const { useNodeGraphStore } = await import('../store/useNodeGraphStore');
    const open = useNodeGraphStore.getState().currentGraph;
    if (open && keys.includes(`shader-studio:${open.name}`) && localStorage.getItem(`shader-studio:${open.name}`) != null) {
      toast.info(`“${open.name}” changed in the workspace folder`, {
        message: 'The open graph was saved from another app. Open the new version to see it (unsaved changes here would be replaced).',
        action: { label: 'Open new version', onClick: () => { useNodeGraphStore.getState().loadSavedGraph(open.name); } },
        sticky: true,
      });
    }
  } catch (e) { console.warn('[workspace] refreshing the app', e); }
}

// ── Connection ──────────────────────────────────────────────────────────────

let config: WorkspaceConfig | null = null;
let fs: WsFs | null = null;
let engine: SyncEngine | null = null;
let images: ImageStore | null = null;
let unwatch: (() => void) | null = null;
let lastProblems: string[] = [];

const describeError = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function fsFor(c: WorkspaceConfig): Promise<WsFs> {
  if (c.backend === 'desktop') { const { tauriFs } = await import('./tauriFs'); return tauriFs(c.path!); }
  const f = handleFs(c.handle!, c.label);
  return c.backend === 'opfs' ? devGate(f) : f;
}

/** The folder's workspace.json id, or null when it has none (or an unreadable one). Throws when the folder itself is gone. */
async function readMarkerId(f: WsFs): Promise<string | null> {
  let text: string;
  try { text = await f.readText(WORKSPACE_FILE); } catch (e) { if ((await f.probe()) !== 'ok') throw e; return null; }
  try { const v = JSON.parse(text) as { id?: unknown }; return typeof v.id === 'string' && v.id ? v.id : null; } catch { return null; }
}

/** workspace.json: the folder's id. Made when the folder is new to Shader Studio; missing in a folder this app synced before means "not the right folder". */
async function ensureMarker(f: WsFs, firstTime: boolean): Promise<string | null> {
  const had = await readMarkerId(f);
  if (had) return had;
  if (!firstTime && config?.workspaceId) {
    const st = await loadSyncState(config.workspaceId);
    if (st && Object.keys(st.base).length) return null;
  }
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await f.write(WORKSPACE_FILE, JSON.stringify({
    kind: 'shader-studio-workspace', format: 1, id, created: new Date().toISOString(),
    app: { name: 'Shader Studio', version: APP_VERSION, where: support === 'desktop' ? 'desktop app' : 'browser' },
    about: 'Shader Studio keeps graphs, presentations, shaders, functions, presets and backgrounds here as files. See docs/workspace-folder.md.',
  }, null, 2));
  return id;
}

async function attach(firstTime: boolean): Promise<boolean> {
  if (!fs || !config) return false;
  const id = await ensureMarker(fs, firstTime);
  if (!id) {
    set({ state: 'not-workspace', message: `“${fs.label}” isn’t the workspace this app syncs with: its workspace.json is missing. If your workspace is on a drive that isn’t connected, connect it. Or use this folder anyway: what’s in it and what’s here are merged, nothing is removed.` });
    return false;
  }
  const state: SyncState = (await loadSyncState(id)) ?? newState(id);
  images ??= await appImages().catch(() => null);
  engine = new SyncEngine({ kv: localMutableKV, images, fs, state, saveState: s => saveSyncState(s).then(() => undefined) });
  if (config.workspaceId !== id) { config = { ...config, workspaceId: id }; await saveConfig(config); }
  set({ conflicts: state.conflicts, lastSyncAt: state.lastSyncAt });
  await startWatch();
  return true;
}

async function startWatch(): Promise<void> {
  if (config?.backend !== 'desktop' || unwatch) return;
  try { const { watchDesktop } = await import('./tauriFs'); unwatch = await watchDesktop(config.path!, () => schedule(800)); } catch { /* the interval covers it */ }
}

// ── Passes ──────────────────────────────────────────────────────────────────

let running = false;
let again = false;
let timer = 0;
let pendingTimer = 0;
let massOk = false;

function schedule(ms = 1500): void {
  if (!config) { refreshPendingSoon(); return; }
  if (running) { again = true; return; }
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { void pass(); }, ms);
}

function refreshPendingSoon(): void {
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => { void refreshPending(); }, 600);
}

async function refreshPending(): Promise<void> {
  if (!engine) return;
  try { set({ pending: await engine.pending() }); } catch { /* shown next pass */ }
}

function problemsNow(state: SyncState | undefined): string[] {
  const ignored = Object.entries(state?.ignored ?? {}).filter(([, v]) => v.why !== UNUSED).map(([p, v]) => `${p}: ${v.why}`);
  return [...new Set([...lastProblems, ...ignored])];
}

async function offline(probe: 'gone' | 'permission'): Promise<void> {
  // The watcher of a folder on an unplugged drive is dead: a new one starts when it's back.
  unwatch?.(); unwatch = null;
  await refreshPending();
  if (probe === 'permission') set({ state: 'needs-permission', message: support === 'browser' ? 'The browser needs your OK to use the folder again.' : 'Shader Studio isn’t allowed to use this folder.' });
  else set({ state: 'offline', message: `${status.folder ?? 'The folder'} can’t be reached (drive removed, or folder moved or renamed). Your work is safe here; changes will sync when it’s back.` });
}

async function pass(): Promise<void> {
  if (!fs || !config) return;
  if (running) { again = true; return; }
  running = true;
  try {
    const probe = await fs.probe();
    if (probe !== 'ok') { await offline(probe); return; }
    // Still the same workspace? (A different drive at the same place, or workspace.json removed.)
    if (engine && (await readMarkerId(fs)) !== engine.state.workspaceId) { unwatch?.(); unwatch = null; engine = null; }
    if (!engine && !(await attach(false))) return;
    await startWatch();
    if (status.state !== 'synced') set({ state: 'syncing', message: null });
    const r = await engine!.sync({ allowMassDelete: massOk });
    massOk = false;
    lastProblems = r.problems;
    await refreshApp(r.changedKeys, r.imagesChanged);
    if (r.conflicts.length) {
      toast.warning(r.conflicts.length === 1 ? `“${r.conflicts[0].label}” was changed here and in the workspace folder` : `${r.conflicts.length} things were changed here and in the workspace folder`, {
        message: 'Both versions are kept; choose which to keep in Files.',
        action: { label: 'Open Files', onClick: () => window.dispatchEvent(new Event('open-files-page')) },
      });
    }
    const held = r.held || r.heldHere;
    set({
      state: held ? 'held' : 'synced', held, heldWhere: r.held ? 'folder' : 'here',
      message: r.held ? `${r.held} things are gone from the workspace folder. Remove them here too?` : r.heldHere ? `${r.heldHere} things are gone from this app’s storage. Remove them from the folder too, or bring them back?` : null,
      lastSyncAt: engine!.state.lastSyncAt, conflicts: engine!.state.conflicts, problems: problemsNow(engine!.state),
    });
  } catch (e) {
    const probe = await fs.probe().catch(() => 'gone' as const);
    if (probe !== 'ok') await offline(probe);
    else set({ state: 'error', message: `Syncing stopped: ${describeError(e)}. Trying again shortly.` });
    console.warn('[workspace] sync', e);
  } finally {
    running = false;
    await refreshPending();
    if (again) { again = false; schedule(300); }
  }
}

// ── Triggers ────────────────────────────────────────────────────────────────

let hooked = false;

function hook(): void {
  if (hooked || typeof window === 'undefined') return;
  hooked = true;
  if (typeof Storage !== 'undefined') {
    const setItem = Storage.prototype.setItem, removeItem = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) { setItem.call(this, k, v); if (this === localStorage && isLibraryKey(k)) schedule(); };
    Storage.prototype.removeItem = function (this: Storage, k: string) { removeItem.call(this, k); if (this === localStorage && isLibraryKey(k)) schedule(); };
  }
  // Another tab of this app changed storage.
  window.addEventListener('storage', e => { if (!e.key || isLibraryKey(e.key)) schedule(); });
  void import('../lib/backgroundLibrary').then(m => m.subscribe(() => schedule())).catch(() => {});
  const wake = () => { if (document.visibilityState === 'visible' && config) schedule(200); };
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);
  // While visible: pick up changes from the other app, and retry an unreachable folder.
  window.setInterval(() => {
    if (!config || document.visibilityState !== 'visible') return;
    if (support === 'desktop' && status.state === 'synced' && unwatch) { if (Date.now() - (status.lastSyncAt ?? 0) < 60_000) return; }
    if (status.state === 'needs-permission' || status.state === 'held') return;
    void pass();
  }, 15_000);
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function connectTo(c: WorkspaceConfig, firstTime: boolean): Promise<void> {
  unwatch?.(); unwatch = null;
  engine = null;
  config = c;
  lastProblems = [];
  set({ state: 'connecting', folder: c.label, message: null, held: 0, conflicts: [], problems: [], legacy: null });
  try {
    fs = await fsFor(c);
    hook();
    const probe = await fs.probe();
    if (probe !== 'ok') { await offline(probe); return; }
    if (!(await attach(firstTime))) return;
    await saveConfig(config);
    stopLegacy();
    await pass();
    if (firstTime && status.state === 'synced') toast.success('Workspace folder connected', { message: `${c.label} now holds your graphs, presentations, shaders and presets as files. Changes sync both ways.` });
  } catch (e) {
    set({ state: 'error', message: describeError(e) });
  }
}

/** Called once when the app is up. */
export async function startWorkspace(): Promise<void> {
  try {
    if (support === 'desktop') {
      try {
        const { documentDir, join } = await import('@tauri-apps/api/path');
        set({ suggested: await join(await documentDir(), 'Shader Studio') });
      } catch { /* no suggestion */ }
    }
    config = (await loadConfig()) ?? null;
    if (!config) {
      set({ state: 'off' });
      await findLegacy();
      // Until a workspace is chosen, the old backup folder keeps its copy.
      void import('../utils/backupFolder').then(m => m.startBackups()).catch(() => {});
      return;
    }
    if (config.backend === 'browser' && config.handle?.queryPermission && (await config.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      fs = await fsFor(config);
      set({ folder: config.label });
      hook();
      await offline('permission');
      return;
    }
    await connectTo(config, false);
  } catch (e) {
    set({ state: 'error', message: describeError(e) });
  }
}

/** Pick the workspace folder (desktop: a folder dialog; Chrome/Edge: the folder picker). */
export async function chooseWorkspaceFolder(): Promise<void> {
  try {
    if (support === 'desktop') {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({ directory: true, multiple: false, defaultPath: status.suggested ?? undefined, title: 'Choose the Shader Studio workspace folder' });
      if (typeof dir !== 'string') return;
      await connectTo({ backend: 'desktop', path: dir, label: dir }, true);
    } else if (support === 'browser') {
      const pick = (window as PickerWindow).showDirectoryPicker!;
      let h: DirHandleLike;
      try { h = await pick({ id: 'shader-studio-workspace', mode: 'readwrite', startIn: 'documents' }); } catch { return; /* cancelled */ }
      await connectTo({ backend: 'browser', handle: h, label: h.name }, true);
    }
  } catch (e) { toast.error('Couldn’t use that folder', { message: describeError(e) }); }
}

/** Desktop: make and use Documents/Shader Studio. */
export async function connectSuggestedFolder(): Promise<void> {
  if (support !== 'desktop' || !status.suggested) return;
  try {
    const { createDesktopRoot } = await import('./tauriFs');
    await createDesktopRoot(status.suggested);
    await connectTo({ backend: 'desktop', path: status.suggested, label: status.suggested }, true);
  } catch (e) { toast.error('Couldn’t make that folder', { message: describeError(e) }); }
}

/** Chrome/Edge after a reload: allow the same folder again (needs the click). */
export async function reconnectWorkspace(): Promise<void> {
  try {
    if (config?.backend === 'browser' && config.handle?.requestPermission) {
      if ((await config.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      await connectTo(config, false);
      return;
    }
    if (config) { if (!engine) await connectTo(config, false); else await pass(); }
  } catch (e) { set({ state: 'error', message: describeError(e) }); }
}

/** The folder has no workspace.json (or another one): use it anyway, merging (nothing in the app is removed). */
export async function adoptFolderAnyway(): Promise<void> {
  if (!config || !fs) return;
  config = { ...config, workspaceId: undefined };
  await connectTo(config, true);
}

/** Many things are gone from one side: remove them from the other too. */
export async function confirmDeletions(): Promise<void> { massOk = true; set({ state: 'syncing', held: 0, message: null }); await pass(); }

/** Many things are gone from this app's storage: bring them back from the folder. */
export async function restoreFromWorkspace(): Promise<void> {
  if (!engine) return;
  try { await engine.restoreFromFolder(); set({ state: 'syncing', held: 0, message: null }); await pass(); } catch (e) { set({ state: 'error', message: describeError(e) }); }
}

export async function syncWorkspaceNow(): Promise<void> {
  if (!config) return;
  if (!engine || !fs) { await connectTo(config, false); return; }
  await pass();
}

/** Stop using the folder. Everything stays in the app and in the folder. */
export async function disconnectWorkspace(): Promise<void> {
  unwatch?.(); unwatch = null;
  window.clearTimeout(timer);
  config = null; fs = null; engine = null;
  await saveConfig(null);
  set({ state: 'off', folder: null, message: null, pending: [], conflicts: [], problems: [], held: 0, lastSyncAt: null });
  await findLegacy();
}

export async function revealWorkspace(): Promise<void> {
  if (config?.backend !== 'desktop' || !config.path) return;
  try { const { revealDesktop } = await import('./tauriFs'); await revealDesktop(config.path); } catch (e) { toast.error('Couldn’t open the folder', { message: describeError(e) }); }
}

/** Keep this (the version with the name), keep the other (the copy), or keep both. */
export async function resolveConflict(id: string, choice: 'this' | 'other' | 'both'): Promise<void> {
  if (!engine) { toast.error('The workspace folder isn’t connected'); return; }
  try {
    const r = await engine.resolve(id, choice);
    await refreshApp(r.keys, r.images);
    set({ conflicts: engine.state.conflicts });
    schedule(300);
  } catch (e) { toast.error('Couldn’t do that', { message: describeError(e) }); }
}

// ── The old backup folder ───────────────────────────────────────────────────

let legacyHandle: DirHandleLike | null = null;
let legacyPath: string | null = null;

async function findLegacy(): Promise<void> {
  try {
    if (support === 'desktop') {
      const chosen = localStorage.getItem('shader-studio:settings:backupDir');
      let dir = chosen;
      if (!dir) { const { documentDir, join } = await import('@tauri-apps/api/path'); dir = await join(await documentDir(), 'Playfield'); }
      const { tauriFs } = await import('./tauriFs');
      if ((await tauriFs(dir).probe()) === 'ok') { legacyPath = dir; set({ legacy: { label: dir } }); }
    } else if (support === 'browser') {
      const { idb } = await import('../utils/backupFolder');
      const h = await idb<DirHandleLike>('readonly', s => s.get('folder'));
      if (h) { legacyHandle = h; set({ legacy: { label: h.name } }); }
    }
  } catch { /* nothing to offer */ }
}

/** Use the old backup folder as the workspace (its old files are left as they are). */
export async function connectLegacyFolder(): Promise<void> {
  try {
    if (legacyPath) await connectTo({ backend: 'desktop', path: legacyPath, label: legacyPath }, true);
    else if (legacyHandle) {
      if (legacyHandle.requestPermission && (await legacyHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      await connectTo({ backend: 'browser', handle: legacyHandle, label: legacyHandle.name }, true);
    }
  } catch (e) { toast.error('Couldn’t use that folder', { message: describeError(e) }); }
}

function stopLegacy(): void {
  void import('../utils/backupFolder').then(m => m.stopBackups()).catch(() => {});
}

// ── Development: the browser's private file system as a workspace, and a pretend unplug ──

let devGone = false;
function devGate(f: WsFs): WsFs {
  const gone = () => new WorkspaceFsError('gone', 'The folder can’t be reached (pretend unplugged)');
  const g = <T extends unknown[], R>(fn: (...a: T) => Promise<R>) => async (...a: T): Promise<R> => { if (devGone) throw gone(); return fn(...a); };
  return { label: f.label, probe: async () => (devGone ? 'gone' : f.probe()), list: g(f.list), readText: g(f.readText), readBytes: g(f.readBytes), write: g(f.write), remove: g(f.remove) };
}

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __workspaceDev: unknown }).__workspaceDev = {
    /** Use a folder in the browser's private file system (OPFS) as the workspace. */
    async useOpfs(name = 'Shader Studio (test)') {
      const root = await (navigator.storage as unknown as { getDirectory(): Promise<DirHandleLike> }).getDirectory();
      const h = await root.getDirectoryHandle(name, { create: true });
      await connectTo({ backend: 'opfs', handle: h, label: `${name} (browser test folder)` }, true);
    },
    /** Show what a browser asking for permission again looks like. */
    needPermission() { void offline('permission'); },
    /** Pretend the drive was unplugged (true) or put back (false). */
    setGone(g: boolean) { devGone = g; schedule(100); },
    /** The test folder's files, or write one as another app would. */
    async files() { const root = await (navigator.storage as unknown as { getDirectory(): Promise<DirHandleLike> }).getDirectory(); return [...(await handleFs(await root.getDirectoryHandle('Shader Studio (test)')).list(['graphs', 'presentations', 'glsl', 'functions', 'presets', 'published-nodes', 'scripts', 'backgrounds', '.shader-studio'], ['workspace.json'])).keys()]; },
    async put(path: string, text: string) { const root = await (navigator.storage as unknown as { getDirectory(): Promise<DirHandleLike> }).getDirectory(); await handleFs(await root.getDirectoryHandle('Shader Studio (test)')).write(path, text); schedule(100); },
    async read(path: string) { const root = await (navigator.storage as unknown as { getDirectory(): Promise<DirHandleLike> }).getDirectory(); return handleFs(await root.getDirectoryHandle('Shader Studio (test)')).readText(path); },
    status: () => status,
  };
}
