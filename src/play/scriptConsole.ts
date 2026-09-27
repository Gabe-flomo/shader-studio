/**
 * scriptConsole — what each Script layer's sketch prints: console.log / info /
 * warn / error / table and p5's print(), its runtime errors, and the values it
 * watches (watch(name, value)). The layer kit reports it (env.scriptLog, see
 * kit.js) and the Sketch editor's Console shows it. Like scriptStatus it lives
 * outside the graph store: it changes every frame and is never saved.
 *
 * Values are copied when they are logged (a later change to the object does
 * not rewrite the line) into a small tree the Console can open. A line that
 * repeats the one before it (a log in draw, 60 times a second) folds into it
 * with a count, and each layer keeps at most CONSOLE_MAX lines.
 */
import { useSyncExternalStore } from 'react';

export const CONSOLE_MAX = 1000;
/** How many numbers a watch keeps for its sparkline. */
export const WATCH_HISTORY = 60;

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'table';

/** A logged value as the Console shows it. */
export type ConsoleValue =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'undef' }
  | { t: 'fn'; name: string }
  | { t: 'vec'; x: number; y: number; z: number }
  | { t: 'colour'; css: string; levels: number[] }
  | { t: 'arr'; items: ConsoleValue[]; more: number; name?: string }
  | { t: 'obj'; name: string; entries: Array<[string, ConsoleValue]>; more: number }
  | { t: 'err'; message: string }
  | { t: 'more' };

export interface ConsoleLine {
  id: number;
  level: ConsoleLevel;
  values: ConsoleValue[];
  /** The line as text: what repeats compare and what Copy gives. */
  text: string;
  /** How many times it came in a row. */
  count: number;
  /** A runtime or compile error's place, to jump to. */
  at?: { file: string; line: number };
}
export interface ConsoleWatch { name: string; value: ConsoleValue; text: string; history: number[] }
export interface LayerConsole { lines: ConsoleLine[]; watches: ConsoleWatch[]; runs: number; dropped: number }

const consoles = new Map<string, LayerConsole>();
const listeners = new Set<() => void>();
let nextId = 1;
let version = 0;
let pending = false;
/** Keep what earlier runs printed when the sketch starts over (the Console's “Keep old output”). */
let keepOld = false;

function notify() {
  version++;
  // Logs arrive every frame: tell React at most once a frame.
  if (pending) return;
  pending = true;
  const flush = () => { pending = false; for (const fn of listeners) fn(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush); else setTimeout(flush, 0);
}

/** A value copied into a tree the Console can show, `depth` levels deep. */
export function consoleValue(v: unknown, depth = 3, seen: Set<unknown> = new Set()): ConsoleValue {
  if (v === null) return { t: 'null' };
  switch (typeof v) {
    case 'number': return { t: 'num', v };
    case 'bigint': return { t: 'num', v: Number(v) };
    case 'string': return { t: 'str', v: v.length > 2000 ? `${v.slice(0, 2000)}…` : v };
    case 'boolean': return { t: 'bool', v };
    case 'undefined': return { t: 'undef' };
    case 'function': return { t: 'fn', name: (v as { name?: string }).name || 'function' };
    case 'symbol': return { t: 'str', v: String(v) };
  }
  const o = v as Record<string, unknown>;
  if (seen.has(o)) return { t: 'str', v: '[circular]' };
  if (o instanceof Error) return { t: 'err', message: o.message };
  // p5.Vector and p5.Color, compactly.
  if (typeof o.x === 'number' && typeof o.y === 'number' && typeof o.heading === 'function') return { t: 'vec', x: o.x, y: o.y, z: typeof o.z === 'number' ? o.z : 0 };
  if (Array.isArray(o.levels) && o.levels.length === 4 && typeof o.toString === 'function' && typeof o.setAlpha === 'function') return { t: 'colour', css: String(o), levels: (o.levels as number[]).map(n => Math.round(n)) };
  if (depth <= 0) return { t: 'more' };
  seen.add(o);
  try {
    if (Array.isArray(o) || ArrayBuffer.isView(o)) {
      const arr = Array.from(o as ArrayLike<unknown>);
      return { t: 'arr', items: arr.slice(0, 100).map(x => consoleValue(x, depth - 1, seen)), more: Math.max(0, arr.length - 100), ...(Array.isArray(o) ? {} : { name: o.constructor?.name }) };
    }
    const keys = Object.keys(o);
    const name = o.constructor && o.constructor !== Object && typeof o.constructor.name === 'string' ? o.constructor.name : '';
    return { t: 'obj', name, entries: keys.slice(0, 50).map(k => [k, consoleValue(o[k], depth - 1, seen)] as [string, ConsoleValue]), more: Math.max(0, keys.length - 50) };
  } finally { seen.delete(o); }
}

/** A value as one line of text (for repeats, Copy and the layer card). */
export function consoleText(v: ConsoleValue, top = true): string {
  switch (v.t) {
    case 'num': return String(Math.round(v.v * 1e6) / 1e6);
    case 'str': return top ? v.v : JSON.stringify(v.v);
    case 'bool': return String(v.v);
    case 'null': return 'null';
    case 'undef': return 'undefined';
    case 'fn': return `ƒ ${v.name}()`;
    case 'vec': return `(${[v.x, v.y, v.z].map(n => Math.round(n * 1000) / 1000).join(', ')})`;
    case 'colour': return v.css;
    case 'err': return v.message;
    case 'more': return '…';
    case 'arr': return `[${v.items.map(x => consoleText(x, false)).join(', ')}${v.more ? `, … ${v.more} more` : ''}]`;
    case 'obj': return `${v.name ? `${v.name} ` : ''}{${v.entries.map(([k, x]) => `${k}: ${consoleText(x, false)}`).join(', ')}${v.more ? ', …' : ''}}`;
  }
}

function consoleOf(layerId: string): LayerConsole {
  let c = consoles.get(layerId);
  if (!c) { c = { lines: [], watches: [], runs: 0, dropped: 0 }; consoles.set(layerId, c); }
  return c;
}

/**
 * What the kit reports for a layer: a level and its arguments. `run` means the
 * sketch started over (the lines go, unless Keep old output is on); `clear` is
 * console.clear(); `watch` is [name, value].
 */
export function logScript(layerId: string, level: string, args: readonly unknown[]): void {
  const c = consoleOf(layerId);
  if (level === 'run') {
    c.runs++;
    if (!keepOld) { c.lines = []; c.dropped = 0; }
    c.watches = [];
    notify();
    return;
  }
  if (level === 'clear') { c.lines = []; c.dropped = 0; notify(); return; }
  if (level === 'watch') {
    const name = String(args[0] ?? '');
    const value = consoleValue(args[1]);
    let w = c.watches.find(x => x.name === name);
    if (!w) { w = { name, value, text: '', history: [] }; c.watches = [...c.watches, w].slice(-24); }
    w.value = value; w.text = consoleText(value);
    if (value.t === 'num' && Number.isFinite(value.v)) { w.history.push(value.v); if (w.history.length > WATCH_HISTORY) w.history.shift(); }
    notify();
    return;
  }
  const lvl: ConsoleLevel = level === 'info' || level === 'warn' || level === 'error' || level === 'table' ? level : 'log';
  const values = args.map(a => consoleValue(a));
  const text = values.map(v => consoleText(v)).join(' ');
  const last = c.lines[c.lines.length - 1];
  if (last && last.level === lvl && last.text === text) {
    // The same line again: count it instead.
    c.lines = [...c.lines.slice(0, -1), { ...last, count: last.count + 1 }];
  } else {
    const m = lvl === 'error' ? /\(([^():]+):(\d+)\)/.exec(text) : null;
    const line: ConsoleLine = { id: nextId++, level: lvl, values, text, count: 1, ...(m ? { at: { file: m[1], line: +m[2] } } : {}) };
    const next = [...c.lines, line];
    if (next.length > CONSOLE_MAX) { c.dropped += next.length - CONSOLE_MAX; next.splice(0, next.length - CONSOLE_MAX); }
    c.lines = next;
  }
  notify();
}

/** Empty a layer's console (the Clear button). */
export function clearScriptConsole(layerId: string): void { const c = consoleOf(layerId); c.lines = []; c.watches = []; c.dropped = 0; notify(); }
export function setKeepOldOutput(on: boolean): void { keepOld = on; notify(); }
export function keepOldOutput(): boolean { return keepOld; }

const EMPTY: LayerConsole = { lines: [], watches: [], runs: 0, dropped: 0 };
/** A layer's console, read now (tests, Copy). */
export function scriptConsole(layerId: string): LayerConsole { return consoles.get(layerId) ?? EMPTY; }

/** A layer's console, kept current (at most once a frame). */
export function useScriptConsole(layerId: string): LayerConsole {
  return useSyncExternalStore(
    fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => { const c = consoles.get(layerId); return c ? snapshot(layerId, c) : EMPTY; },
  );
}
// useSyncExternalStore needs the same object until something changed.
const snaps = new Map<string, { v: number; s: LayerConsole }>();
function snapshot(id: string, c: LayerConsole): LayerConsole {
  const hit = snaps.get(id);
  if (hit && hit.v === version) return hit.s;
  const s = { lines: c.lines, watches: c.watches.map(w => ({ ...w, history: w.history.slice() })), runs: c.runs, dropped: c.dropped };
  snaps.set(id, { v: version, s });
  return s;
}
/** The last thing a layer printed, for its card: its last error, or its last line. */
export function lastConsoleLine(c: LayerConsole): ConsoleLine | null {
  for (let i = c.lines.length - 1; i >= 0; i--) if (c.lines[i].level === 'error') return c.lines[i];
  return c.lines[c.lines.length - 1] ?? null;
}
/** The console as text (Copy). */
export function consoleCopyText(c: LayerConsole): string {
  const lines = c.lines.map(l => `${l.level === 'log' ? '' : `[${l.level}] `}${l.text}${l.count > 1 ? ` ×${l.count}` : ''}`);
  const watches = c.watches.map(w => `${w.name} = ${w.text}`);
  return [...lines, ...(watches.length ? ['', ...watches] : [])].join('\n');
}
