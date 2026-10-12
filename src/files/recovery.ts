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
import { listVersions, numberOf } from '../store/graphVersions';
import { create } from 'zustand';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { useTakes } from '../lib/takes';
import { askChoice } from '../components/ui/dialogStore';
import { toast } from '../components/ui/toastStore';
import { requestPage } from '../components/page';
import { installPluginSafety } from '../lib/pluginSafety';
import {
  AUTOSAVE_KEY, AutosaveScheduler, buildSnapshot, graphHasContent, graphWork, isPlayfileSnapshot, newSessionMarker, parseAutosaveMode, parseSessionMarker,
  pendingAtLaunch, planRotation, reasonWords, recoverDecision, snapshotFileTime, type AutosaveMode, type PluginCrash, type ProjectInfo,
  type SessionMarker, type Snapshot, type SnapshotMeta,
} from './autosave';
import { buildSnapshotPlayfile, readAnySnapshot, snapshotAsPlayfile } from './autosavePlayfile';
import { APP_VERSION } from './appVersion';
import { fromBase64, toBase64 } from '../playfile/bytes';
import { PLAYFILE_MIME } from '../playfile/format';
import { copyCrashReport, latestCrashReport, primeCrashEnv, revealCrashReport, saveCrashReport, showCrashReport, useCrashReports } from './crashReports';
import { lastCapturedError, onContextLoss, persistNow } from '../lib/crashLog';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import('@tauri-apps/api/core');
  return inv<T>(cmd, args);
}

// ── Where snapshots live ─────────────────────────────────────────────────────

interface SnapshotStore {
  /** Does it write .play snapshots (the desktop) or JSON ones (IndexedDB)? */
  playfile: boolean;
  list(): Promise<string[]>;
  /** A .play file's bytes, a .json's text. */
  read(file: string): Promise<Uint8Array | string>;
  write(file: string, body: Uint8Array | string): Promise<void>;
  remove(file: string): Promise<void>;
}

// A .play file crosses the bridge as base64 (an autosave is a few KB: no media is bundled).
const tauriStore: SnapshotStore = {
  playfile: true,
  list: () => invoke<string[]>('autosave_list'),
  read: async name => { const r = await invoke<string>('autosave_read', { name }); return isPlayfileSnapshot(name) ? fromBase64(r) : r; },
  write: (name, body) => invoke<void>('autosave_write', typeof body === 'string' ? { name, body } : { name, body: toBase64(body), base64: true }),
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
    playfile: false,
    list: async () => (await run<IDBValidKey[]>('readonly', s => s.getAllKeys())).map(String),
    read: async file => (await run<{ body?: string | Uint8Array } | undefined>('readonly', s => s.get(file) as IDBRequest<{ body?: string | Uint8Array } | undefined>))?.body ?? '',
    write: async (file, body) => { await run('readwrite', s => s.put({ file, body })); },
    remove: async file => { await run('readwrite', s => s.delete(file)); },
  };
}

let store: SnapshotStore | null = null;
const snapshots = () => store ??= isTauri() ? tauriStore : idbStore();

// ── The session marker ───────────────────────────────────────────────────────

const SESSION_KEY = 'shader-studio:session';

const PENDING_KEY = 'shader-studio:session:pending';

interface SessionBackend {
  /** This session, and the one to offer recovery for (kept until `done`). */
  start(): Promise<{ current: SessionMarker; previous: SessionMarker | null }>;
  note(n: { project?: ProjectInfo; lastSaveAt?: number }): void;
  /** The offer was made or wasn't needed: forget the pending one. */
  done(): void;
  /** This page is going away cleanly (a reload, the tab closing). */
  pageHide(): void;
  /** This page is going down (a fatal error): the next page load offers recovery. */
  pageCrashed(reason: string): Promise<void>;
}

/**
 * The desktop: Rust keeps the marker (recovery.rs). The previous launch's, if it
 * didn't end cleanly, waits in `pending-recovery.json` until the page answers;
 * a page that dies inside a running app (WebKit's content process killed, a
 * fatal error) is pending too, so the reload offers recovery.
 */
const tauriSession: SessionBackend = {
  start: async () => {
    const r = await invoke<{ current: unknown; previous: unknown }>('session_start');
    return { current: parseSessionMarker(r.current) ?? newSessionMarker(`s${Date.now()}`, Date.now(), APP_VERSION), previous: parseSessionMarker(r.previous) };
  },
  note: n => { void invoke('session_note', { note: n }).catch(() => { /* the marker is a best effort */ }); },
  done: () => { void invoke('session_recovery_done').catch(() => { /* asked again next launch */ }); },
  pageHide: () => { void invoke('session_page_hide').catch(() => { /* treated as a crash on reload */ }); },
  pageCrashed: async reason => { await invoke('session_page_crashed', { reason }).catch(() => { /* best effort */ }); },
};

function browserSession(): SessionBackend {
  let current: SessionMarker | null = null;
  let crashed = false;
  const put = () => { try { if (current) localStorage.setItem(SESSION_KEY, JSON.stringify(current)); } catch { /* storage full or blocked */ } };
  return {
    start: async () => {
      let previous: SessionMarker | null = null;
      let leftover: SessionMarker | null = null;
      try { previous = parseSessionMarker(localStorage.getItem(SESSION_KEY)); } catch { /* none */ }
      try { leftover = parseSessionMarker(localStorage.getItem(PENDING_KEY)); } catch { /* none */ }
      const pending = pendingAtLaunch(previous, leftover);
      try { if (pending) localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch { /* storage full */ }
      current = newSessionMarker(`s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, Date.now(), APP_VERSION);
      put();
      // Closing or reloading the tab is a clean exit; a browser or tab crash (or a fatal error) isn't.
      window.addEventListener('pagehide', () => { if (current && !crashed) { current.cleanExit = true; put(); } });
      // Back from the back/forward cache: running again.
      window.addEventListener('pageshow', e => { if (e.persisted && current) { current.cleanExit = false; put(); } });
      return { current, previous: pending };
    },
    done: () => { try { localStorage.removeItem(PENDING_KEY); } catch { /* none */ } },
    pageHide: () => { /* the pagehide listener above */ },
    pageCrashed: async reason => { crashed = true; if (current) { current.cleanExit = false; current.reason = reason; put(); } },
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
/** A recording, a render or a take holds autosaves (crash snapshots and autosaved versions alike). */
export function isAutosaveHeld(): boolean { return held(); }
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
      const snap = await readAnySnapshot(f, await snapshots().read(f));
      if (snap) out.push({ file: snap.file, at: snap.at, session: snap.session, project: snap.project, work: snap.work });
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
  const store = snapshots();
  const { file, body } = store.playfile
    ? await (async () => { const p = await buildSnapshotPlayfile(graphJson, project, session!.id, at); return { file: p.file, body: p.bytes as Uint8Array | string }; })()
    : buildSnapshot(graphJson, project, session.id, at);
  try {
    await store.write(file, body);
    lastBody = key;
    const files = await snapshots().list();
    const { remove } = planRotation(files);
    for (const f of remove) { try { await snapshots().remove(f); } catch { /* next time */ } }
    const meta: SnapshotMeta = { file, at, session: session.id, project, work: graphWork(graph) };
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
  try { snap = await readAnySnapshot(file, await snapshots().read(file)); } catch { snap = null; }
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
  const version = snap.project.version ?? 1;
  // Its place in the series: as stored for that version, else as an older save reads (1.(v − 1)).
  const num = stillSaved ? (listVersions(name!).find(v => v.version === version) ?? numberOf({ version })) : numberOf({ version });
  useNodeGraphStore.setState({ currentGraph: stillSaved ? { name: name!, version, major: num.major, minor: num.minor, latest } : null, graphDirty: true });
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

/** An autosave as a .play file, saved where you choose (the browser's are kept as JSON; the desktop's are .play files already). */
export async function downloadSnapshot(file: string): Promise<void> {
  let snap: Snapshot | null = null;
  try { snap = await readAnySnapshot(file, await snapshots().read(file)); } catch { snap = null; }
  if (!snap) { toast.error('That autosave can’t be read'); return; }
  const { name, bytes } = await snapshotAsPlayfile(snap);
  const { saveBinaryFile } = await import('../utils/fileIO');
  await saveBinaryFile(bytes, name, PLAYFILE_MIME);
}

/** Reasons a report was already written for, by the page (a fatal error) or by Rust (a panic). */
const REPORTED = new Set(['js-fatal', 'rust-panic']);

async function offerRecovery(previous: SessionMarker | null, list: SnapshotMeta[], crash: PluginCrash | null): Promise<void> {
  const unclean = !!previous && !previous.cleanExit;
  // A crash report for the session that went down: written now from what it left behind
  // (its log lines in localStorage), unless the page or Rust wrote one as it went.
  let report: string | null = null;
  if (unclean && previous) {
    const reason = previous.reason ?? 'unknown';
    if (REPORTED.has(reason)) {
      useCrashReports.getState().refresh();
      report = await latestCrashReport();
    } else {
      report = await saveCrashReport(reason, { previous: true, crashedAppVersion: previous.appVersion, session: { id: previous.id, startedAt: previous.startedAt } });
    }
  }
  const links = report ? [
    { label: 'Show report', onClick: () => { void showCrashReport(report!); } },
    { label: 'Copy report', onClick: () => { void copyCrashReport(report!); } },
    { label: isTauri() ? 'Reveal in Finder' : 'Download report', onClick: () => { void revealCrashReport(report!); } },
  ] : undefined;
  const d = recoverDecision(previous, list, crash, ms => formatClock(ms));
  if (!d.offer) {
    if (crash) toast.warning(`${crash.name} closed Playfield last time`, { message: 'It’s switched off in Settings → Plugins; Try again there when it’s been updated.', sticky: true });
    else if (report && previous) {
      toast.warning('Playfield closed unexpectedly last time', {
        message: `${reasonWords(previous.reason)}. Nothing unsaved was lost. A crash report was saved.`,
        action: { label: 'Show report', onClick: () => { void showCrashReport(report!); } },
      });
    }
    backend?.done();
    return;
  }
  const others = d.others.length ? ` Other autosaves from then: ${d.others.map(o => formatClock(o.at)).join(', ')} (Files → App settings lists them).` : '';
  const why = previous?.reason && previous.reason !== 'unknown' ? ` ${reasonWords(previous.reason)}.` : '';
  const choice = await askChoice(d.title, [
    { id: 'recover', label: 'Recover', variant: 'primary' },
    { id: 'files', label: 'Show in Files', variant: 'ghost' },
    { id: 'discard', label: 'Discard', variant: 'danger' },
  ], { message: d.message + why + others, ...(report ? { note: 'A crash report was saved.', links } : {}) });
  backend?.done();
  if (choice === 'recover') await restoreSnapshot(d.snapshot.file);
  else if (choice === 'files') showAutosavesInFiles();
  // Discard: nothing is removed; the old snapshots rotate out as new ones are written.
}

// ── A page going down ────────────────────────────────────────────────────────

let crashing = false;
/**
 * A fatal error (the page went blank): write a report, mark the session so the
 * next page load offers recovery, and reload into that offer.
 */
export async function crashPage(reason: string, error?: { message: string; stack?: string } | null, opts: { reload?: boolean } = {}): Promise<void> {
  if (crashing) return;
  crashing = true;
  await saveCrashReport(reason, { error: error ?? lastCapturedError() });
  persistNow();
  await (backend ?? (isTauri() ? tauriSession : null))?.pageCrashed(reason);
  if (opts.reload !== false) location.reload();
}

let lastContextReport = 0;
function watchPage(): void {
  window.addEventListener('pagehide', () => { if (!crashing) backend?.pageHide(); });
  // WebGL context loss: a report (at most one every 10 minutes); the app restores the context itself.
  onContextLoss(() => {
    if (Date.now() - lastContextReport < 600_000) return;
    lastContextReport = Date.now();
    void saveCrashReport('webgl-context-lost');
  });
}

// ── Starting ─────────────────────────────────────────────────────────────────

let started = false;

/** At launch, once the app is up (the blank graph loaded): the session, the Recover dialog, then autosaving. */
export async function startRecovery(): Promise<void> {
  if (started) return;
  started = true;
  backend = isTauri() ? tauriSession : browserSession();
  watchPage();
  primeCrashEnv();
  let previous: SessionMarker | null = null;
  try { ({ current: session, previous } = await backend.start()); } catch { session = newSessionMarker(`s${Date.now()}`, Date.now(), APP_VERSION); }
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
