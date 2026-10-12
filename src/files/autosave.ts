/**
 * autosave.ts — autosave and crash recovery, the pure part
 * (docs/crash-recovery.md). No storage, no timers of its own: the app's
 * wiring (recovery.ts) hands it a clock and timers, and tests hand it fakes.
 *
 * - The setting: every 5 minutes (the default), every minute, on every change
 *   (2 s after the last one, at most 10 s behind a stream of them), or off.
 * - A snapshot: the open project exactly as Save writes it (the graph file:
 *   nodes, loose groups, the Play setup, datasets) plus which project it was
 *   and whether it had unsaved changes. Files are `autosave-<ms>.json`; the
 *   newest 3 are kept.
 * - The session marker: written at launch, marked clean on a clean quit. A
 *   launch that finds the last one not clean, with a snapshot of unsaved work
 *   from that session newer than its last real save, offers to recover it.
 */

export type AutosaveMode = 'off' | '1m' | '5m' | 'change';

export const AUTOSAVE_KEY = 'shader-studio:settings:autosave';
export const DEFAULT_AUTOSAVE: AutosaveMode = '5m';
export const AUTOSAVE_MODES: ReadonlyArray<{ id: AutosaveMode; label: string }> = [
  { id: 'change', label: 'On every change' },
  { id: '1m', label: 'Every minute' },
  { id: '5m', label: 'Every 5 minutes' },
  { id: 'off', label: 'Off' },
];
/** Snapshots kept. */
export const AUTOSAVE_KEEP = 3;
/** "On every change": this long after the last change… */
export const CHANGE_DEBOUNCE_MS = 2000;
/** …but never more than this behind the first unsaved one (a slider dragged for a minute still gets saved). */
export const CHANGE_MAX_WAIT_MS = 10_000;

export function parseAutosaveMode(raw: string | null | undefined): AutosaveMode {
  return raw === 'off' || raw === '1m' || raw === '5m' || raw === 'change' ? raw : DEFAULT_AUTOSAVE;
}

/** The interval a timed mode saves on (ms); null for "on every change" and off. */
export function autosaveInterval(mode: AutosaveMode): number | null {
  return mode === '1m' ? 60_000 : mode === '5m' ? 300_000 : null;
}

export function autosaveLabel(mode: AutosaveMode): string {
  return AUTOSAVE_MODES.find(m => m.id === mode)?.label ?? mode;
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export const SNAPSHOT_FORMAT = 'playfield-autosave';

/** Which project a snapshot (or a session) had open: its saved name (null: never saved, "Untitled"), version, and unsaved changes. */
export interface ProjectInfo {
  name: string | null;
  version: number | null;
  dirty: boolean;
}

export interface SnapshotMeta {
  file: string;
  /** When it was written (ms). */
  at: number;
  /** The session (app launch) that wrote it. */
  session: string;
  project: ProjectInfo;
  /** How much is in it (graphWork): 0 is a blank canvas (an Output node alone). Missing: not known, treated as work. */
  work?: number;
}

export interface Snapshot extends SnapshotMeta {
  /** The graph file, exactly what Save / "Export as readable JSON" writes (parsed). */
  graph: Record<string, unknown>;
}

/**
 * `autosave-<ms>.play` (the desktop), `autosave-<ms>.playfile` (the desktop in
 * 2026.10.183, still read) or `autosave-<ms>.json` (the browser's IndexedDB, and older desktop ones).
 */
const FILE_RE = /^autosave-(\d{10,16})\.(json|play|playfile)$/;

export function snapshotFileName(at: number, ext: 'json' | 'play' = 'json'): string {
  return `autosave-${Math.max(0, Math.floor(at))}.${ext}`;
}

/** A container snapshot: `.play`, or `.playfile` from 2026.10.183. */
export const isPlayfileSnapshot = (file: string): boolean => file.endsWith('.play') || file.endsWith('.playfile');

/** The time in a snapshot's file name, null when it isn't one. */
export function snapshotFileTime(file: string): number | null {
  const m = FILE_RE.exec(file);
  return m ? Number(m[1]) : null;
}

/** Newest first, keeping `keep`; the rest (and anything that isn't a snapshot's name) are left alone or removed. */
export function planRotation(files: readonly string[], keep = AUTOSAVE_KEEP): { keep: string[]; remove: string[] } {
  const snaps = files.filter(f => snapshotFileTime(f) !== null).sort((a, b) => snapshotFileTime(b)! - snapshotFileTime(a)!);
  return { keep: snaps.slice(0, keep), remove: snaps.slice(keep) };
}

export function buildSnapshot(graphJson: string, project: ProjectInfo, session: string, at: number): { file: string; body: string } {
  const graph = JSON.parse(graphJson) as unknown;
  const body = JSON.stringify({ format: SNAPSHOT_FORMAT, version: 1, at, session, project, graph });
  return { file: snapshotFileName(at), body };
}

function projectOf(v: unknown): ProjectInfo {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : {};
  return {
    name: typeof o.name === 'string' && o.name.trim() ? o.name : null,
    version: typeof o.version === 'number' && Number.isFinite(o.version) ? o.version : null,
    dirty: o.dirty !== false,
  };
}

/** A snapshot file's text, or null when it isn't one (or its graph is missing). */
export function parseSnapshot(file: string, text: string): Snapshot | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.format !== SNAPSHOT_FORMAT) return null;
  const g = o.graph;
  if (!g || typeof g !== 'object' || !Array.isArray((g as Record<string, unknown>).nodes)) return null;
  return snapshotFrom(file, o, g as Record<string, unknown>);
}

/** A snapshot from its envelope fields (`at`, `session`, `project`) and its graph. */
export function snapshotFrom(file: string, o: Record<string, unknown>, graph: Record<string, unknown>): Snapshot {
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : snapshotFileTime(file) ?? 0;
  return { file, at, session: typeof o.session === 'string' ? o.session : '', project: projectOf(o.project), graph, work: graphWork(graph) };
}

/**
 * How much work a graph holds: its nodes other than the Output node, its loose
 * groups, and a Play setup with anything in it. 0 is the blank canvas a new
 * project starts with (the 346-byte autosave), never worth offering.
 */
export function graphWork(graph: Record<string, unknown>): number {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes as Array<{ type?: unknown }> : [];
  const groups = Array.isArray(graph.looseGroups) ? graph.looseGroups.length : 0;
  const play = graph.play && typeof graph.play === 'object' && Object.keys(graph.play).length > 0 ? 1 : 0;
  return nodes.filter(n => !n || n.type !== 'output').length + groups + play;
}

/** A project worth a snapshot: something on the canvas or in the Play setup. */
export function graphHasContent(graph: Record<string, unknown>): boolean {
  const nodes = graph.nodes;
  if (Array.isArray(nodes) && nodes.length) return true;
  const play = graph.play;
  return !!play && typeof play === 'object' && Object.keys(play).length > 0;
}

// ── The session marker ───────────────────────────────────────────────────────

export interface SessionMarker {
  id: string;
  startedAt: number;
  /** Set on a clean quit (desktop: the app exiting; browser: the page going away). */
  cleanExit: boolean;
  project: ProjectInfo;
  /** The last real Save in this session (ms, 0 none). */
  lastSaveAt: number;
  /**
   * Why it ended, when something saw it go (crashReasons.ts): 'web-content-terminated',
   * 'rust-panic', 'js-fatal', 'page-reloaded'; 'unknown' when the next launch found it
   * still running (a force quit, a kill, the app replaced, a power loss).
   */
  reason?: string;
  /** The app version that ran it. Informational only: recovery never depends on it matching. */
  appVersion?: string;
}

export function newSessionMarker(id: string, now: number, appVersion?: string): SessionMarker {
  return { id, startedAt: now, cleanExit: false, project: { name: null, version: null, dirty: false }, lastSaveAt: 0, ...(appVersion ? { appVersion } : {}) };
}

export function parseSessionMarker(raw: unknown): SessionMarker | null {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return {
    id: o.id, startedAt: num(o.startedAt), cleanExit: o.cleanExit === true, project: projectOf(o.project), lastSaveAt: num(o.lastSaveAt),
    ...(typeof o.reason === 'string' && o.reason ? { reason: o.reason.slice(0, 80) } : {}),
    ...(typeof o.appVersion === 'string' && o.appVersion ? { appVersion: o.appVersion.slice(0, 40) } : {}),
  };
}

/**
 * The browser's (and the tests') version of what the desktop's recovery.rs does
 * at launch: the marker to offer recovery for. The last launch's when it didn't
 * end cleanly (with 'unknown' as its reason when nothing saw it go), else one
 * still waiting from before (a launch that went down again before the page
 * answered). Never depends on the app version.
 */
export function pendingAtLaunch(previous: SessionMarker | null, leftover: SessionMarker | null): SessionMarker | null {
  if (previous && !previous.cleanExit) return { ...previous, reason: previous.reason ?? 'unknown' };
  return leftover && !leftover.cleanExit ? leftover : null;
}

/**
 * A page load inside a running session (the desktop process keeps going): if
 * the page before it went without a clean unload, or something saw it die,
 * the session is offered as if it had crashed.
 */
export function pendingOnPageLoad(o: { loads: number; pageClean: boolean; crashReason: string | null; current: SessionMarker }): SessionMarker | null {
  if (o.crashReason) return { ...o.current, cleanExit: false, reason: o.crashReason };
  if (o.loads > 0 && !o.pageClean) return { ...o.current, cleanExit: false, reason: 'page-reloaded' };
  return null;
}

/** A crash reason in words, for the Recover dialog and reports. */
export function reasonWords(reason: string | undefined): string {
  switch (reason) {
    case 'web-content-terminated': return 'Its web content process stopped (WebKit), so the window went blank';
    case 'rust-panic': return 'The app’s native side hit an error (a Rust panic)';
    case 'js-fatal': return 'An error stopped the page';
    case 'page-reloaded': return 'The page reloaded before it closed cleanly';
    case 'webgl-context-lost': return 'The graphics (WebGL) context was lost';
    case 'unknown': case undefined: return 'It was force-quit, killed, replaced by a new build, or the Mac lost power';
    default: return reason;
  }
}

/** A plug-in that was loading when the app went down (the engine's `loading-plugin.json`). */
export interface PluginCrash {
  name: string;
  code: string;
  at: number;
  /** What it was doing: "load", "window", "preset". */
  stage?: string;
}

export function parsePluginCrash(raw: unknown): PluginCrash | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.code !== 'string' || !o.code) return null;
  return {
    name: typeof o.name === 'string' && o.name ? o.name : o.code,
    code: o.code,
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0,
    ...(typeof o.stage === 'string' && o.stage ? { stage: o.stage } : {}),
  };
}

export type RecoverDecision =
  | { offer: false; reason: 'no-session' | 'clean' | 'no-snapshot' | 'other-session' | 'nothing-unsaved' | 'saved-since' | 'empty' }
  | { offer: true; snapshot: SnapshotMeta; others: SnapshotMeta[]; skippedEmpty: number; title: string; message: string };

const stageWords = (s?: string) => (s === 'window' ? 'opening the window of' : s === 'preset' ? 'restoring the settings of' : 'loading');
const hasWork = (s: SnapshotMeta) => s.work === undefined || s.work > 0;

/**
 * Offer to recover? Only when the last session didn't end cleanly, and that
 * session's newest autosave with work in it (a blank canvas is skipped) had
 * unsaved changes and is newer than the session's last real save. `others`
 * are the session's other autosaves, newest first, for the dialog to list.
 */
export function recoverDecision(prev: SessionMarker | null, snaps: SnapshotMeta | readonly SnapshotMeta[] | null, crash: PluginCrash | null, formatTime: (ms: number) => string): RecoverDecision {
  const list = (snaps === null ? [] : Array.isArray(snaps) ? [...snaps] : [snaps as SnapshotMeta]).sort((a, b) => b.at - a.at);
  if (!prev) return { offer: false, reason: 'no-session' };
  if (prev.cleanExit) return { offer: false, reason: 'clean' };
  if (!list.length) return { offer: false, reason: 'no-snapshot' };
  const mine = list.filter(s => s.session === prev.id);
  if (!mine.length) return { offer: false, reason: 'other-session' };
  const pick = mine.find(hasWork);
  if (!pick) return { offer: false, reason: 'empty' };
  if (!pick.project.dirty) return { offer: false, reason: 'nothing-unsaved' };
  if (prev.lastSaveAt && prev.lastSaveAt >= pick.at) return { offer: false, reason: 'saved-since' };
  const skippedEmpty = mine.indexOf(pick);
  const name = pick.project.name ?? 'Untitled';
  const what = crash ? ` while ${stageWords(crash.stage)} ${crash.name}, with “${name}” open` : ` while “${name}” was open`;
  return {
    offer: true,
    snapshot: pick,
    others: mine.filter(s => s !== pick),
    skippedEmpty,
    title: 'Recover your work?',
    message: `Playfield closed unexpectedly${what} (last autosaved ${formatTime(pick.at)}).`
      + (skippedEmpty ? ` The newest autosave${skippedEmpty > 1 ? 's were' : ' was'} empty, so this is the latest one with your work.` : '')
      + (crash ? ` ${crash.name} has been switched off in Settings → Plugins; you can try it again there.` : ''),
  };
}

// ── The scheduler ────────────────────────────────────────────────────────────

export interface Timers {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (h: unknown) => void;
}

export const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: h => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: h => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
};

/**
 * When to write. `changed()` on every project change; the scheduler calls
 * `write` when the mode says so and something changed since the last write.
 * While `held()` (a render or a recording), a due write waits and is tried
 * again shortly after (1 s on every change, 5 s for the timed modes).
 */
export class AutosaveScheduler {
  private mode: AutosaveMode;
  private pending = false;
  private firstPendingAt = 0;
  private debounce: unknown = null;
  private interval: unknown = null;
  private writing = false;
  private readonly t: Timers;
  private readonly write: () => Promise<void> | void;
  private readonly held: () => boolean;

  constructor(opts: { mode: AutosaveMode; write: () => Promise<void> | void; held?: () => boolean; timers?: Timers }) {
    this.mode = opts.mode;
    this.write = opts.write;
    this.held = opts.held ?? (() => false);
    this.t = opts.timers ?? realTimers;
    this.arm();
  }

  get currentMode(): AutosaveMode { return this.mode; }
  get hasPending(): boolean { return this.pending; }

  setMode(mode: AutosaveMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.disarm();
    this.arm();
    if (mode === 'change' && this.pending) this.schedule(CHANGE_DEBOUNCE_MS);
  }

  changed(): void {
    if (!this.pending) this.firstPendingAt = this.t.now();
    this.pending = true;
    if (this.mode !== 'change') return;
    const behind = this.t.now() - this.firstPendingAt;
    this.schedule(Math.max(0, Math.min(CHANGE_DEBOUNCE_MS, CHANGE_MAX_WAIT_MS - behind)));
  }

  /** Write now if anything changed (and nothing holds it); resolves when written. */
  async flush(): Promise<boolean> {
    if (!this.pending || this.mode === 'off' || this.writing) return false;
    if (this.held()) { this.retrySoon(); return false; }
    this.pending = false;
    this.writing = true;
    try { await this.write(); return true; } catch { this.pending = true; return false; } finally { this.writing = false; }
  }

  dispose(): void {
    this.disarm();
  }

  private arm(): void {
    const ms = autosaveInterval(this.mode);
    if (ms) this.interval = this.t.setInterval(() => { void this.flush(); }, ms);
  }

  private disarm(): void {
    if (this.interval !== null) { this.t.clearInterval(this.interval); this.interval = null; }
    if (this.debounce !== null) { this.t.clearTimeout(this.debounce); this.debounce = null; }
  }

  private schedule(ms: number): void {
    if (this.debounce !== null) this.t.clearTimeout(this.debounce);
    this.debounce = this.t.setTimeout(() => { this.debounce = null; void this.flush(); }, ms);
  }

  private retrySoon(): void {
    if (this.debounce === null) this.schedule(this.mode === 'change' ? 1000 : 5000);
  }
}
