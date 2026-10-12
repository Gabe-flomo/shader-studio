/**
 * crashLog.ts — the last ~200 console warnings and errors, uncaught errors,
 * unhandled rejections, WebGL context losses and app events (page changes,
 * compiles, builders opened), kept in a ring buffer for crash reports
 * (docs/crash-recovery.md "Crash reports"). Nothing leaves the device.
 *
 * The buffer is copied to localStorage a moment after each new line, so a page
 * that dies outright (WebKit's web content process killed) still leaves its
 * last lines for the report the next page load writes.
 */

export type CrashLogLevel = 'error' | 'warn' | 'event';

export interface CrashLogLine {
  t: number;
  level: CrashLogLevel;
  msg: string;
  /** The same line repeated back to back (a compile on every slider step): counted, not stored again. */
  n?: number;
}

export const CRASH_LOG_MAX = 200;
export const CRASH_LOG_KEY = 'shader-studio:crash-log';
const MSG_MAX = 2000;

/** A fixed-size log: the oldest line drops off once it holds `max`. */
export class RingLog {
  private lines: CrashLogLine[] = [];
  readonly max: number;
  constructor(max = CRASH_LOG_MAX) { this.max = max; }
  push(level: CrashLogLevel, msg: string, t = Date.now()): void {
    const last = this.lines[this.lines.length - 1];
    if (last && last.level === level && last.msg === msg) { last.n = (last.n ?? 1) + 1; last.t = t; return; }
    this.lines.push({ t, level, msg: msg.length > MSG_MAX ? `${msg.slice(0, MSG_MAX)}…` : msg });
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }
  get(): CrashLogLine[] { return this.lines.slice(); }
  clear(): void { this.lines = []; }
  get size(): number { return this.lines.length; }
}

/** Anything logged, as one line of text (errors with their message, objects as JSON). */
export function describe(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

export interface CapturedError { message: string; stack?: string; source?: string }

/** The error an `error` or `unhandledrejection` event carries. */
export function errorFrom(ev: { error?: unknown; reason?: unknown; message?: string; filename?: string; lineno?: number; colno?: number }): CapturedError {
  const e = ev.error ?? ev.reason;
  if (e instanceof Error) return { message: `${e.name}: ${e.message}`, ...(e.stack ? { stack: e.stack } : {}) };
  const message = e !== undefined ? describe(e) : ev.message ?? 'Unknown error';
  return { message, ...(ev.filename ? { source: `${ev.filename}:${ev.lineno ?? 0}:${ev.colno ?? 0}` } : {}) };
}

export const crashLog = new RingLog();

/** What the app is doing, for a report: the open page, mostly (App sets it). */
const context: Record<string, string> = {};
export function setCrashContext(key: string, value: string): void { context[key] = value; }
export function crashContext(): Record<string, string> { return { ...context }; }
let lastError: CapturedError | null = null;
/** The last uncaught error or rejection this page saw (for a report). */
export function lastCapturedError(): CapturedError | null { return lastError; }

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistSoon(): void {
  if (persistTimer !== null || typeof localStorage === 'undefined') return;
  persistTimer = setTimeout(() => { persistTimer = null; persistNow(); }, 750);
}
export function persistNow(): void {
  try { localStorage.setItem(CRASH_LOG_KEY, JSON.stringify({ at: Date.now(), lines: crashLog.get() })); } catch { /* storage full or blocked */ }
}

/** Log an app event ("page: play", "compile: 42 nodes in 12 ms", "builder: Grid Rules"). */
export function logEvent(msg: string): void {
  crashLog.push('event', msg);
  persistSoon();
}

/** The previous page's lines (left in localStorage), read once at launch before this page's overwrite them. */
let previousLines: CrashLogLine[] | null = null;
export function previousPageLog(): CrashLogLine[] {
  return previousLines ?? [];
}
function readPrevious(): void {
  try {
    const v = JSON.parse(localStorage.getItem(CRASH_LOG_KEY) ?? 'null') as { lines?: unknown } | null;
    previousLines = Array.isArray(v?.lines) ? (v.lines as CrashLogLine[]).filter(l => l && typeof l.msg === 'string').slice(-CRASH_LOG_MAX) : [];
  } catch { previousLines = []; }
}

type Listener = (e: CapturedError, kind: 'error' | 'rejection') => void;
const listeners = new Set<Listener>();
/** Called for each uncaught error and unhandled rejection. */
export function onCapturedError(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }

let installed = false;
/**
 * Hook console.warn / console.error, window `error` and `unhandledrejection`,
 * and WebGL context loss (any canvas in the page). Call once, first thing.
 */
export function installCrashCapture(target: Window & typeof globalThis = window): void {
  if (installed) return;
  installed = true;
  readPrevious();
  const con = target.console;
  for (const level of ['warn', 'error'] as const) {
    const orig = con[level].bind(con);
    con[level] = (...args: unknown[]) => {
      try { crashLog.push(level, args.map(describe).join(' ')); persistSoon(); } catch { /* never break logging */ }
      orig(...args);
    };
  }
  const capture = (e: CapturedError, kind: 'error' | 'rejection') => {
    lastError = e;
    crashLog.push('error', `${kind === 'rejection' ? 'Unhandled rejection' : 'Uncaught'}: ${e.message}${e.stack ? `\n${e.stack.split('\n').slice(0, 6).join('\n')}` : ''}`);
    persistSoon();
    for (const l of listeners) { try { l(e, kind); } catch { /* a listener's own error */ } }
  };
  target.addEventListener('error', ev => {
    // A resource that failed to load (an <img>) fires `error` without an error object: not a script error.
    if (!(ev instanceof ErrorEvent)) return;
    capture(errorFrom(ev), 'error');
  });
  target.addEventListener('unhandledrejection', ev => capture(errorFrom(ev), 'rejection'));
  // webglcontextlost doesn't bubble: listen in the capture phase for canvases in the document.
  target.document?.addEventListener('webglcontextlost', ev => {
    const c = ev.target as HTMLCanvasElement | null;
    logEvent(`WebGL context lost${c?.width ? ` (canvas ${c.width}×${c.height})` : ''}`);
    for (const l of contextLossListeners) { try { l(); } catch { /* ignore */ } }
  }, true);
  target.document?.addEventListener('webglcontextrestored', () => logEvent('WebGL context restored'), true);
  target.addEventListener('pagehide', () => persistNow());
}

const contextLossListeners = new Set<() => void>();
export function onContextLoss(fn: () => void): () => void { contextLossListeners.add(fn); return () => contextLossListeners.delete(fn); }

/** Tests: start over. */
export function resetCrashCaptureForTests(): void {
  installed = false;
  lastError = null;
  previousLines = null;
  listeners.clear();
  contextLossListeners.clear();
  crashLog.clear();
}
