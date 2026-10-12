/**
 * crashReports.ts — local crash reports (docs/crash-recovery.md "Crash
 * reports"). Written when the app goes down (a web content process killed, a
 * force quit, a Rust panic, a fatal JS error) or loses its WebGL context, and
 * kept on this device only: nothing is ever sent anywhere.
 *
 * - Desktop: `~/Library/Application Support/com.shaderstudio.app/crash-reports/<timestamp>.json`
 *   (src-tauri/src/crash.rs, which also writes the Rust panic ones).
 * - Browser: IndexedDB `shader-studio-crash-reports`, the same JSON.
 * The newest 20 are kept.
 */
import { create } from 'zustand';
import { APP_VERSION } from './appVersion';
import { crashContext, crashLog, previousPageLog, type CapturedError, type CrashLogLine } from '../lib/crashLog';
import { reasonWords } from './autosave';

export const CRASH_REPORT_FORMAT = 'playfield-crash-report';
export const CRASH_REPORT_KEEP = 20;

export interface CrashReport {
  format: typeof CRASH_REPORT_FORMAT;
  version: 1;
  /** ms, and the same as ISO 8601. */
  at: number;
  time: string;
  /** What happened: 'web-content-terminated', 'unknown' (force quit / kill), 'rust-panic', 'js-fatal', 'js-error', 'webgl-context-lost', 'page-reloaded', 'report-a-problem'. */
  kind: string;
  /** The kind in words. */
  summary: string;
  appVersion: string;
  /** The app version of the session that crashed, when that was an earlier launch. */
  crashedAppVersion?: string;
  os: string;
  gpu: { renderer: string; vendor: string; webgl: string };
  page: string;
  graph: { name: string | null; nodes: number; groups: number; dirty: boolean };
  session?: { id: string; startedAt: number };
  error?: CapturedError;
  /** The last log lines (oldest first): console warnings and errors, app events. */
  log: CrashLogLine[];
  context?: Record<string, string>;
}

/** `2026-10-11T20-04-22-570Z.json`: sortable, and safe as a file name. */
export function reportFileName(at: number): string {
  return `${new Date(at).toISOString().replace(/[:.]/g, '-')}.json`;
}

const NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;
export const isReportName = (n: string): boolean => NAME_RE.test(n);

/** The time in a report's file name (ms), or null. */
export function reportFileTime(name: string): number | null {
  if (!isReportName(name)) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name)!;
  return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
}

/** Newest first: the `keep` newest stay, the rest go (names that aren't reports are left alone). */
export function planReportRotation(names: readonly string[], keep = CRASH_REPORT_KEEP): { keep: string[]; remove: string[] } {
  const r = names.filter(isReportName).sort().reverse();
  return { keep: r.slice(0, keep), remove: r.slice(keep) };
}

export interface ReportInput {
  kind: string;
  at: number;
  appVersion?: string;
  crashedAppVersion?: string;
  os: string;
  gpu: CrashReport['gpu'];
  page: string;
  graph: CrashReport['graph'];
  session?: CrashReport['session'];
  error?: CapturedError | null;
  log: readonly CrashLogLine[];
  context?: Record<string, string>;
}

const LOG_LINES = 200;

export function buildCrashReport(i: ReportInput): CrashReport {
  return {
    format: CRASH_REPORT_FORMAT,
    version: 1,
    at: i.at,
    time: new Date(i.at).toISOString(),
    kind: i.kind,
    summary: i.kind === 'report-a-problem' ? 'Reported from the app (Report a problem…)' : i.kind === 'js-error' ? 'An uncaught error (the app kept running)' : reasonWords(i.kind),
    appVersion: i.appVersion ?? APP_VERSION,
    ...(i.crashedAppVersion && i.crashedAppVersion !== (i.appVersion ?? APP_VERSION) ? { crashedAppVersion: i.crashedAppVersion } : {}),
    os: i.os,
    gpu: i.gpu,
    page: i.page,
    graph: i.graph,
    ...(i.session ? { session: i.session } : {}),
    ...(i.error ? { error: i.error } : {}),
    log: i.log.slice(-LOG_LINES),
    ...(i.context && Object.keys(i.context).length ? { context: i.context } : {}),
  };
}

export function parseCrashReport(text: string): CrashReport | null {
  try {
    const v = JSON.parse(text) as Partial<CrashReport> | null;
    if (!v || v.format !== CRASH_REPORT_FORMAT || typeof v.at !== 'number') return null;
    return { ...v, log: Array.isArray(v.log) ? v.log : [] } as CrashReport;
  } catch { return null; }
}

// ── Where reports live ──────────────────────────────────────────────────────

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import('@tauri-apps/api/core');
  return inv<T>(cmd, args);
}

export interface ReportStore {
  list(): Promise<string[]>;
  read(name: string): Promise<string>;
  write(name: string, body: string): Promise<void>;
  remove(name: string): Promise<void>;
}

const tauriReports: ReportStore = {
  list: () => invoke<string[]>('crash_report_list'),
  read: name => invoke<string>('crash_report_read', { name }),
  // Rust rotates (keeps the newest 20) after each write.
  write: (name, body) => invoke<void>('crash_report_write', { name, body }),
  remove: name => invoke<void>('crash_report_remove', { name }),
};

/** IndexedDB, one record per report: `{ name, body }`. Exported for tests (fake-indexeddb). */
export function idbReports(dbName = 'shader-studio-crash-reports'): ReportStore {
  const STORE = 'reports';
  let conn: Promise<IDBDatabase> | null = null;
  const open = () => conn ??= new Promise<IDBDatabase>((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('No IndexedDB')); return; }
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'name' }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error ?? new Error('Couldn’t open the crash reports'));
  });
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => res(req.result);
      tx.onerror = () => rej(tx.error ?? new Error('Crash reports'));
      tx.onabort = () => rej(tx.error ?? new Error('Crash reports'));
    });
  };
  return {
    list: async () => (await run<IDBValidKey[]>('readonly', s => s.getAllKeys())).map(String),
    read: async name => (await run<{ body?: string } | undefined>('readonly', s => s.get(name) as IDBRequest<{ body?: string } | undefined>))?.body ?? '',
    write: async (name, body) => { await run('readwrite', s => s.put({ name, body })); },
    remove: async name => { await run('readwrite', s => s.delete(name)); },
  };
}

let store: ReportStore | null = null;
const reports = (): ReportStore => store ??= isTauri() ? tauriReports : idbReports();
/** Tests: a store of their own. */
export function setReportStoreForTests(s: ReportStore | null): void { store = s; }

/** Write a report and keep the newest 20. Resolves with its name. */
export async function writeCrashReport(report: CrashReport, s: ReportStore = reports()): Promise<string> {
  let name = reportFileName(report.at);
  const existing = await s.list().catch(() => [] as string[]);
  // Two in the same millisecond: the next free one.
  for (let at = report.at + 1; existing.includes(name); at++) name = reportFileName(at);
  await s.write(name, JSON.stringify(report, null, 1));
  if (!isTauri() || s !== tauriReports) {
    const { remove } = planReportRotation([...existing, name]);
    for (const r of remove) { try { await s.remove(r); } catch { /* next time */ } }
  }
  return name;
}

// ── The environment a report records ────────────────────────────────────────

let gpuCache: CrashReport['gpu'] | null = null;
/** The WebGL renderer, read once from a throwaway context (cached: a crash is no time to make one). */
export function gpuInfo(): CrashReport['gpu'] {
  if (gpuCache) return gpuCache;
  const out = { renderer: 'unknown', vendor: 'unknown', webgl: 'unknown' };
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      out.webgl = gl.getParameter(gl.VERSION) as string;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      out.renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      out.vendor = String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* none */ }
  return gpuCache = out;
}

let osCache: string | null = null;
export async function osInfo(): Promise<string> {
  if (osCache) return osCache;
  if (isTauri()) {
    try { const e = await invoke<{ os: string; arch: string }>('crash_env'); return osCache = `${e.os} (${e.arch})`; } catch { /* below */ }
  }
  return osCache = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
}

/** Warm the caches while nothing is wrong (startup), so a report later needn't make a GL context. */
export function primeCrashEnv(): void { try { gpuInfo(); } catch { /* none */ } void osInfo(); }

/** The page a log was on: its last "page: …" event. */
export function pageFromLog(lines: readonly CrashLogLine[]): string {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].level === 'event' && lines[i].msg.startsWith('page: ')) return lines[i].msg.slice(6);
  return 'unknown';
}

async function graphNow(): Promise<CrashReport['graph']> {
  try {
    const { useNodeGraphStore } = await import('../store/useNodeGraphStore');
    const s = useNodeGraphStore.getState();
    return { name: s.currentGraph?.name ?? null, nodes: s.nodes.length, groups: s.looseGroups?.length ?? 0, dirty: s.graphDirty };
  } catch { return { name: null, nodes: 0, groups: 0, dirty: false }; }
}

/**
 * Write a report about now (or, with `previous`, about the page or launch that
 * went down: its log lines are the ones it left behind).
 */
export async function saveCrashReport(kind: string, opts: { error?: CapturedError | null; previous?: boolean; crashedAppVersion?: string; session?: CrashReport['session'] } = {}): Promise<string | null> {
  try {
    const ctx = crashContext();
    const report = buildCrashReport({
      kind, at: Date.now(), os: await osInfo(), gpu: gpuInfo(),
      page: opts.previous ? pageFromLog(previousPageLog()) : (ctx.page ?? 'unknown'),
      graph: await graphNow(),
      session: opts.session,
      crashedAppVersion: opts.crashedAppVersion,
      error: opts.error ?? null,
      log: opts.previous ? previousPageLog() : crashLog.get(),
      context: ctx,
    });
    const name = await writeCrashReport(report);
    useCrashReports.getState().refresh();
    return name;
  } catch { return null; }
}

// ── The list, and showing one ───────────────────────────────────────────────

interface CrashReportsState {
  names: string[];
  viewing: { name: string; text: string } | null;
  refresh: () => void;
}

export const useCrashReports = create<CrashReportsState>(set => ({
  names: [],
  viewing: null,
  refresh: () => { void reports().list().then(n => set({ names: planReportRotation(n).keep })).catch(() => set({ names: [] })); },
}));

/** The newest report's name, or null. */
export async function latestCrashReport(): Promise<string | null> {
  try { return planReportRotation(await reports().list()).keep[0] ?? null; } catch { return null; }
}

export async function readCrashReport(name: string): Promise<string> {
  return reports().read(name);
}

export async function showCrashReport(name: string): Promise<void> {
  try { useCrashReports.setState({ viewing: { name, text: await reports().read(name) } }); } catch (e) {
    const { toast } = await import('../components/ui/toastStore');
    toast.error('That crash report can’t be read', { details: e instanceof Error ? e.message : String(e) });
  }
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export async function copyCrashReport(name: string): Promise<void> {
  const { toast } = await import('../components/ui/toastStore');
  try {
    const ok = await copyText(await reports().read(name));
    if (ok) toast.success('Crash report copied'); else toast.error('Couldn’t copy the crash report');
  } catch (e) { toast.error('Couldn’t copy the crash report', { details: e instanceof Error ? e.message : String(e) }); }
}

/** The report in Finder (desktop); a download of it in a browser. */
export async function revealCrashReport(name?: string): Promise<void> {
  if (isTauri()) {
    try { await invoke('crash_report_reveal', { name: name ?? null }); } catch { /* no folder yet */ }
    return;
  }
  if (!name) return;
  const { saveTextFile } = await import('../utils/fileIO');
  await saveTextFile(await reports().read(name), `playfield-crash-${name}`);
}

/**
 * Report a problem…: the latest crash report (if any) and this page's log in
 * one file, saved where you choose or copied. Nothing is sent anywhere.
 */
export async function reportProblem(): Promise<void> {
  const [{ askChoice }, { toast }] = await Promise.all([import('../components/ui/dialogStore'), import('../components/ui/toastStore')]);
  const now = buildCrashReport({
    kind: 'report-a-problem', at: Date.now(), os: await osInfo(), gpu: gpuInfo(), page: crashContext().page ?? 'unknown',
    graph: await graphNow(), log: crashLog.get(), context: crashContext(),
  });
  let latest: unknown = null;
  try {
    const names = planReportRotation(await reports().list()).keep;
    if (names[0]) latest = JSON.parse(await reports().read(names[0])) as unknown;
  } catch { latest = null; }
  const bundle = JSON.stringify({ format: 'playfield-problem-report', version: 1, now, latestCrashReport: latest }, null, 1);
  const choice = await askChoice('Report a problem', [
    { id: 'copy', label: 'Copy to clipboard', variant: 'ghost' },
    { id: 'save', label: 'Save as a file…', variant: 'primary' },
  ], { message: `This puts ${latest ? 'the latest crash report, ' : ''}the app’s recent log (the last ${crashLog.size} lines), its version, macOS and GPU into one file for you to send with a description. Nothing is sent anywhere by Playfield.` });
  if (choice === 'copy') {
    if (await copyText(bundle)) toast.success('Problem report copied', { message: 'Paste it into your message.' });
    else toast.error('Couldn’t copy the report');
  } else if (choice === 'save') {
    const { saveTextFile } = await import('../utils/fileIO');
    const r = await saveTextFile(bundle, `playfield-problem-${reportFileName(Date.now())}`);
    if (r.ok) toast.success('Problem report saved');
  }
}
