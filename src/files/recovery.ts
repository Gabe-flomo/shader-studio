/**
 * recovery.ts — autosave and crash recovery, wired to the app
 * (docs/crash-recovery.md; the decisions are in autosave.ts).
 *
 * - Snapshots of the open project go to the app's private data folder on the
 *   desktop (src-tauri/src/recovery.rs, `autosave/`), to IndexedDB in a
 *   browser. The newest 3 are kept.
 * - The session marker: the desktop's is kept by Rust (a clean quit marks it);
 *   a browser's in localStorage, marked clean when the page goes away.
 * - At launch, a session that didn't end cleanly with unsaved work autosaved
 *   gets the Recover dialog.
 */
import { create } from 'zustand';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { useTakes } from '../lib/takes';
import { askChoice } from '../components/ui/dialogStore';
import { toast } from '../components/ui/toastStore';
import { requestPage } from '../components/page';
import { installPluginSafety } from '../lib/pluginSafety';
import {
  AUTOSAVE_KEY, AutosaveScheduler, buildSnapshot, graphHasContent, newSessionMarker, parseAutosaveMode, parseSessionMarker,
  parseSnapshot, planRotation, recoverDecision, snapshotFileTime, type AutosaveMode, type PluginCrash, type ProjectInfo,
  type SessionMarker, type Snapshot, type SnapshotMeta,
} from './autosave';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import('@tauri-apps/api/core');
  return inv<T>(cmd, args);
}

// ── Where snapshots live ─────────────────────────────────────────────────────

interface SnapshotStore {
  list(): Promise<string[]>;
  read(file: string): Promise<string>;
  write(file: string, body: string): Promise<void>;
  remove(file: string): Promise<void>;
}

const tauriStore: SnapshotStore = {
  list: () => invoke<string[]>('autosave_list'),
  read: name => invoke<string>('autosave_read', { name }),
  write: (name, body) => invoke<void>('autosave_write', { name, body }),
  remove: name => invoke<void>('autosave_remove', { name }),
};

function idbStore(): SnapshotStore {
  const DB = 'shader-studio-autosave', STORE = 'snapshots';
  let conn: Promise<IDBDatabase> | null = null;
  const open = () => conn ??= new Promise<IDBDatabase>((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('No IndexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'file' }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error ?? new Error('Couldn’t open the autosave store'));
  });
  // Resolves when the transaction commits (a put is only safe then), with the request's result.
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => res(req.result);
      tx.onerror = () => rej(tx.error ?? new Error('Autosave store'));
      tx.onabort = () => rej(tx.error ?? new Error('Autosave store'));
    });
  };
  return {
    list: async () => (await run<IDBValidKey[]>('readonly', s => s.getAllKeys())).map(String),
    read: async file => (await run<{ body?: string } | undefined>('readonly', s => s.get(file) as IDBRequest<{ body?: string } | undefined>))?.body ?? '',
    write: async (file, body) => { await run('readwrite', s => s.put({ file, body })); },
    remove: async file => { await run('readwrite', s => s.delete(file)); },
  };
}

let store: SnapshotStore | null = null;
const snapshots = () => store ??= isTauri() ? tauriStore : idbStore();

// ── The session marker ───────────────────────────────────────────────────────

const SESSION_KEY = 'shader-studio:session';

interface SessionBackend {
  start(): Promise<{ current: SessionMarker; previous: SessionMarker | null }>;
  note(n: { project?: ProjectInfo; lastSaveAt?: number }): void;
}

const tauriSession: SessionBackend = {
  start: async () => {
    const r = await invoke<{ current: unknown; previous: unknown }>('session_start');
    return { current: parseSessionMarker(r.current) ?? newSessionMarker(`s${Date.now()}`, Date.now()), previous: parseSessionMarker(r.previous) };
  },
  note: n => { void invoke('session_note', { note: n }).catch(() => { /* the marker is a best effort */ }); },
};

function browserSession(): SessionBackend {
  let current: SessionMarker | null = null;
  const put = () => { try { if (current) localStorage.setItem(SESSION_KEY, JSON.stringify(current)); } catch { /* storage full or blocked */ } };
  return {
    start: async () => {
      let previous: SessionMarker | null = null;
      try { previous = parseSessionMarker(localStorage.getItem(SESSION_KEY)); } catch { /* none */ }
      current = newSessionMarker(`s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, Date.now());
      put();
      // Closing or reloading the tab is a clean exit; a browser or tab crash isn't.
      window.addEventListener('pagehide', () => { if (current) { current.cleanExit = true; put(); } });
      // Back from the back/forward cache: running again.
      window.addEventListener('pageshow', e => { if (e.persisted && current) { current.cleanExit = false; put(); } });
      return { current, previous };
    },
    note: n => {
      if (!current) return;
      if (n.project) current.project = n.project;
      if (n.lastSaveAt !== undefined) current.lastSaveAt = n.lastSaveAt;
      put();
    },
  };
}

// ── State the settings show ──────────────────────────────────────────────────

interface AutosaveState {
  mode: AutosaveMode;
  /** The snapshots there are, newest first (read at launch and after each write). */
  snapshots: SnapshotMeta[];
  lastAt: number;
  error: string;
  setMode: (m: AutosaveMode) => void;
}

function loadMode(): AutosaveMode {
  try { return parseAutosaveMode(localStorage.getItem(AUTOSAVE_KEY)); } catch { return parseAutosaveMode(null); }
}

export const useAutosave = create<AutosaveState>(set => ({
  mode: loadMode(),
  snapshots: [],
  lastAt: 0,
  error: '',
  setMode: m => {
    try { localStorage.setItem(AUTOSAVE_KEY, m); } catch { /* preference only */ }
    set({ mode: m });
    scheduler?.setMode(m);
  },
}));

// ── Holds: renders and recordings ────────────────────────────────────────────

let holds = 0;
/** While a recording or an offline render runs, autosaves wait (so a write doesn't cost it a frame). Call the result to let go. */
export function holdAutosave(): () => void {
  holds++;
  let done = false;
  return () => { if (!done) { done = true; holds = Math.max(0, holds - 1); } };
}
function held(): boolean {
  if (holds > 0) return true;
  const p = useTakes.getState().phase;
  return p === 'recording' || p === 'countdown';
}

// ── Writing ──────────────────────────────────────────────────────────────────

let scheduler: AutosaveScheduler | null = null;
let session: SessionMarker | null = null;
let backend: SessionBackend | null = null;
let lastBody = '';

function projectNow(): ProjectInfo {
  const s = useNodeGraphStore.getState();
  return { name: s.currentGraph?.name ?? null, version: s.currentGraph?.version ?? null, dirty: s.graphDirty || !s.currentGraph };
}

async function readMeta(files: string[]): Promise<SnapshotMeta[]> {
  const out: SnapshotMeta[] = [];
  for (const f of planRotation(files).keep) {
    try {
      const snap = parseSnapshot(f, await snapshots().read(f));
      if (snap) out.push({ file: snap.file, at: snap.at, session: snap.session, project: snap.project });
    } catch { /* unreadable: skipped */ }
  }
  return out;
}

async function writeSnapshot(): Promise<void> {
  const st = useNodeGraphStore.getState();
  if (st.scratch || !session) return; // a GLSL conversion's scratch graph isn't the project
  const graphJson = st.graphFileJson(false);
  const graph = JSON.parse(graphJson) as Record<string, unknown>;
  if (!graphHasContent(graph)) return;
  const project = projectNow();
  const key = `${JSON.stringify(project)}\n${graphJson}`;
  if (key === lastBody) return; // nothing changed since the last snapshot
  const at = Math.max(Date.now(), (useAutosave.getState().snapshots[0]?.at ?? 0) + 1);
  const { file, body } = buildSnapshot(graphJson, project, session.id, at);
  try {
    await snapshots().write(file, body);
    lastBody = key;
    const files = await snapshots().list();
    const { remove } = planRotation(files);
    for (const f of remove) { try { await snapshots().remove(f); } catch { /* next time */ } }
    const meta: SnapshotMeta = { file, at, session: session.id, project };
    useAutosave.setState(s => ({ lastAt: at, error: '', snapshots: [meta, ...s.snapshots.filter(x => x.file !== file && !remove.includes(x.file))].slice(0, 3) }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!useAutosave.getState().error) toast.warning('Autosave failed', { details: msg, message: 'Your work is still open; save it to be safe. Autosave keeps trying.' });
    useAutosave.setState({ error: msg });
    throw e;
  }
}

// ── Recovering ───────────────────────────────────────────────────────────────

/** Put a snapshot back: the project as it was, still unsaved (an untitled one stays untitled). */
export async function restoreSnapshot(file: string): Promise<boolean> {
  let snap: Snapshot | null = null;
  try { snap = parseSnapshot(file, await snapshots().read(file)); } catch { snap = null; }
  if (!snap) { toast.error('That autosave can’t be read'); return false; }
  const st = useNodeGraphStore.getState();
  const r = st.importGraph(JSON.stringify(snap.graph), { recovered: true });
  if (!r.ok) { toast.error('Couldn’t recover the autosave', { details: r.error }); return false; }
  const name = snap.project.name;
  const stillSaved = name !== null && st.getSavedGraphNames().includes(name);
  let latest = true;
  if (stillSaved) {
    try { const v = (JSON.parse(localStorage.getItem(`shader-studio:${name}`) ?? '{}') as { version?: unknown }).version; latest = typeof v !== 'number' || v === snap.project.version; } catch { /* treat as latest */ }
  }
  useNodeGraphStore.setState({ currentGraph: stillSaved ? { name: name!, version: snap.project.version ?? 1, latest } : null, graphDirty: true });
  toast.success(`Recovered “${name ?? 'Untitled'}”`, { message: 'It’s as it was when it was last autosaved, with its changes still unsaved. Save it to keep it.' });
  return true;
}

/** Files → App settings, where the autosaves are listed. */
export const OPEN_APP_SETTINGS = 'open-files-app-settings';
let appSettingsWanted = false;
export function takeAppSettingsRequest(): boolean { const w = appSettingsWanted; appSettingsWanted = false; return w; }
export function showAutosavesInFiles(): void {
  appSettingsWanted = true;
  requestPage('files');
  // The Files page may already be open: it listens too.
  window.setTimeout(() => window.dispatchEvent(new Event(OPEN_APP_SETTINGS)), 0);
}

export function formatClock(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(now).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

async function offerRecovery(previous: SessionMarker | null, list: SnapshotMeta[], crash: PluginCrash | null): Promise<void> {
  const d = recoverDecision(previous, list[0] ?? null, crash, ms => formatClock(ms));
  if (!d.offer) {
    if (crash) toast.warning(`${crash.name} closed Playfield last time`, { message: 'It’s switched off in Settings → Plugins; Try again there when it’s been updated.', sticky: true });
    return;
  }
  const choice = await askChoice(d.title, [
    { id: 'recover', label: 'Recover', variant: 'primary' },
    { id: 'files', label: 'Show in Files', variant: 'ghost' },
    { id: 'discard', label: 'Discard', variant: 'danger' },
  ], { message: d.message });
  if (choice === 'recover') await restoreSnapshot(d.snapshot.file);
  else if (choice === 'files') showAutosavesInFiles();
  // Discard: nothing is removed; the old snapshots rotate out as new ones are written.
}

// ── Starting ─────────────────────────────────────────────────────────────────

let started = false;

/** At launch, once the app is up (the blank graph loaded): the session, the Recover dialog, then autosaving. */
export async function startRecovery(): Promise<void> {
  if (started) return;
  started = true;
  backend = isTauri() ? tauriSession : browserSession();
  let previous: SessionMarker | null = null;
  try { ({ current: session, previous } = await backend.start()); } catch { session = newSessionMarker(`s${Date.now()}`, Date.now()); }
  const crash = await installPluginSafety().catch(() => null);
  let list: SnapshotMeta[] = [];
  try { list = await readMeta(await snapshots().list()); } catch { list = []; }
  list.sort((a, b) => b.at - a.at || (snapshotFileTime(b.file) ?? 0) - (snapshotFileTime(a.file) ?? 0));
  useAutosave.setState({ snapshots: list });
  await offerRecovery(previous, list, crash);

  scheduler = new AutosaveScheduler({ mode: useAutosave.getState().mode, write: writeSnapshot, held });
  let lastProject = JSON.stringify(projectNow());
  backend.note({ project: projectNow() });
  useNodeGraphStore.subscribe((s, prev) => {
    if (s.nodes !== prev.nodes || s.looseGroups !== prev.looseGroups || s.play !== prev.play || s.datasets !== prev.datasets) scheduler?.changed();
    if (s.currentGraph === prev.currentGraph && s.graphDirty === prev.graphDirty) return;
    const p = projectNow();
    const key = JSON.stringify(p);
    if (key === lastProject) return;
    lastProject = key;
    // Saved (or a saved project just opened): nothing unsaved as of now.
    backend?.note(s.currentGraph && !s.graphDirty ? { project: p, lastSaveAt: Date.now() } : { project: p });
  });
}
