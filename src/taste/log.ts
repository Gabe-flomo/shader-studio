/**
 * log.ts — the signal log (docs/taste.md "The log and tracing"): every lesson the taste model takes, in
 * order, with what it was about (an item, a seed, an Evolve pair) and the change it made to each weight.
 * Append-only and capped (the newest LOG_CAP entries); pure.
 *
 * Tracing. An entry's `d` is the exact change of each weight across that update (after − before), so it
 * includes the L2 decay that step applied, not only the gradient. A weight is therefore always
 *
 *     w[k] = carried[k] + Σ entries d[k]
 *
 * where `carried` holds what isn't listed: entries that fell off the end of the cap, the weights learned
 * before the log existed (a version-1 model), and the rounding of each listed change to 1e-4 (the
 * remainder goes to `carried` at once). So a trace sums to its weight to floating-point precision.
 */
import type { SignalKind } from './model';

/** How many entries are kept. */
export const LOG_CAP = 1000;
/** Listed changes are rounded to this (the remainder is carried). */
const ROUND = 1e-4;

/** What a signal was about. */
export interface SignalRef {
  /** The rated, opened or kept item: `saved:<name>`, `example:<key>`, `shader:<id>`, `technique:<id>`, `palette:<…>`, `node:<type>`. */
  item?: string;
  label?: string;
  /** The seed it came from (a Surprise, or an Evolve session). */
  seed?: number;
  /** Where: 'surprise', 'deep', 'evolve', 'rate', 'nodes', 'files'. */
  via?: string;
  /** Evolve: the pair, the round and what each candidate was. */
  pair?: { round: number; chosen: string; other: string; chosenWhat?: string; otherWhat?: string };
  /** A rating's value (−1 … 1, 0 = cleared). */
  value?: number;
  /** Imported from another install, about an item that isn't here (portable.ts). */
  foreign?: boolean;
}

export interface LogEntry {
  /** Increasing; never reused. */
  id: number;
  at: number;
  kind: SignalKind;
  ref?: SignalRef;
  /** The change of each weight (rounded to 1e-4; zero changes left out). */
  d: Record<string, number>;
  /** The change to the stage table, `stage=choice` → evidence. */
  st?: Record<string, number>;
}

export interface SignalLog {
  entries: LogEntry[];
  /** Weight not listed: older than the log, fallen off the cap, or rounding (see the top). */
  carried: Record<string, number>;
  /** The next entry id. */
  next: number;
  /** How many entries have fallen off the cap. */
  dropped: number;
}

export const emptyLog = (): SignalLog => ({ entries: [], carried: {}, next: 1, dropped: 0 });

/** A version-1 model's weights, carried (there was no log before version 2). */
export function migrateLog(w: Record<string, number>): SignalLog {
  return { ...emptyLog(), carried: { ...w } };
}

const add = (into: Record<string, number>, k: string, v: number) => {
  const x = (into[k] ?? 0) + v;
  if (Math.abs(x) < 1e-12) delete into[k]; else into[k] = x;
};

/** The change of every weight between two weight tables. */
export function weightDelta(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const d: Record<string, number> = {};
  for (const k in after) { const v = after[k] - (before[k] ?? 0); if (v) d[k] = v; }
  for (const k in before) if (!(k in after) && before[k]) d[k] = -before[k];
  return d;
}

/** The change of the stage table, as `stage=choice` → evidence. */
export function stageDelta(before: Record<string, Record<string, number>>, after: Record<string, Record<string, number>>): Record<string, number> {
  const d: Record<string, number> = {};
  const stages = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const st of stages) {
    const a = before[st] ?? {}, b = after[st] ?? {};
    for (const c of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const v = (b[c] ?? 0) - (a[c] ?? 0);
      if (Math.abs(v) > 1e-9) d[`${st}=${c}`] = Math.round(v * 1000) / 1000;
    }
  }
  return d;
}

/**
 * Append an entry made of the exact weight change `delta`: listed rounded, the rounding carried. The oldest
 * entries past `cap` fold into `carried`.
 */
export function appendLog(log: SignalLog, e: { at: number; kind: SignalKind; ref?: SignalRef; delta: Record<string, number>; st?: Record<string, number> }, cap = LOG_CAP): SignalLog {
  const carried = { ...log.carried };
  const d: Record<string, number> = {};
  for (const [k, v] of Object.entries(e.delta)) {
    const r = Math.round(v / ROUND) * ROUND;
    const listed = Number(r.toFixed(4));
    if (listed) d[k] = listed;
    if (v - listed) add(carried, k, v - listed);
  }
  const entry: LogEntry = { id: log.next, at: e.at, kind: e.kind, ...(e.ref ? { ref: e.ref } : {}), d, ...(e.st && Object.keys(e.st).length ? { st: e.st } : {}) };
  let entries = [...log.entries, entry];
  let dropped = log.dropped;
  if (entries.length > cap) {
    const gone = entries.slice(0, entries.length - cap);
    entries = entries.slice(-cap);
    dropped += gone.length;
    for (const g of gone) for (const [k, v] of Object.entries(g.d)) add(carried, k, v);
  }
  return { entries, carried, next: log.next + 1, dropped };
}

export interface TraceItem { entry: LogEntry; delta: number }
export interface Trace {
  feature: string;
  /** Not listed (older, fallen off, rounding). */
  carried: number;
  /** Each listed entry that changed it, newest first. */
  items: TraceItem[];
  /** carried + Σ items: equals the weight. */
  sum: number;
  /** The total by signal kind (listed entries only). */
  byKind: Partial<Record<SignalKind, number>>;
}

/** Where a weight came from. */
export function traceOf(log: SignalLog, feature: string): Trace {
  const items: TraceItem[] = [];
  const byKind: Partial<Record<SignalKind, number>> = {};
  for (let i = log.entries.length - 1; i >= 0; i--) {
    const e = log.entries[i];
    const v = e.d[feature];
    if (!v) continue;
    items.push({ entry: e, delta: v });
    byKind[e.kind] = (byKind[e.kind] ?? 0) + v;
  }
  const carried = log.carried[feature] ?? 0;
  return { feature, carried, items, sum: carried + items.reduce((s, x) => s + x.delta, 0), byKind };
}

/** How many entries of each kind are in the log. */
export function logCounts(log: SignalLog): Partial<Record<SignalKind, number>> {
  const out: Partial<Record<SignalKind, number>> = {};
  for (const e of log.entries) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numbers = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  return out;
};
const KINDS = new Set<SignalKind>(['pick', 'rating', 'kept', 'undone', 'favourited', 'edited', 'opened']);

/** Read a stored log (whatever is unreadable is dropped). */
export function parseLog(v: unknown): SignalLog {
  if (!isRecord(v)) return emptyLog();
  const entries: LogEntry[] = [];
  if (Array.isArray(v.entries)) for (const e of v.entries) {
    if (!isRecord(e) || typeof e.id !== 'number' || !KINDS.has(e.kind as SignalKind)) continue;
    const ref = isRecord(e.ref) ? (e.ref as SignalRef) : undefined;
    entries.push({ id: e.id, at: Number(e.at) || 0, kind: e.kind as SignalKind, ...(ref ? { ref } : {}), d: numbers(e.d), ...(isRecord(e.st) ? { st: numbers(e.st) } : {}) });
  }
  const next = Math.max(Number(v.next) || 1, (entries[entries.length - 1]?.id ?? 0) + 1);
  return { entries: entries.slice(-LOG_CAP), carried: numbers(v.carried), next, dropped: Number(v.dropped) || 0 };
}
