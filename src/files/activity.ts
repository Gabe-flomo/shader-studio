/**
 * activity.ts — what you did, when: a small log of saves, renders, takes,
 * imports and presentation saves, kept in localStorage so the Files home
 * can say "14 saves this week", draw a sparkline per kind and mark the
 * calendar's active days. Nothing is seeded: it starts counting the first
 * time the app records something (or the home is opened), and says so.
 *
 * Pure over a KV (localStorage in the app, a map in tests); one JSON key,
 * capped, read once and cached until the next write.
 */
export type ActivityEventKind = 'save' | 'render' | 'take' | 'import' | 'presentation';

export interface ActivityEvent {
  at: number;
  kind: ActivityEventKind;
  /** What it was about: the graph's name, the file's name. */
  label?: string;
}

export const ACTIVITY_KINDS: ReadonlyArray<{ id: ActivityEventKind; one: string; many: string; verb: string }> = [
  { id: 'save', one: 'save', many: 'saves', verb: 'Saved' },
  { id: 'render', one: 'render', many: 'renders', verb: 'Rendered' },
  { id: 'take', one: 'take', many: 'takes', verb: 'Recorded' },
  { id: 'import', one: 'import', many: 'imports', verb: 'Imported' },
  { id: 'presentation', one: 'presentation save', many: 'presentation saves', verb: 'Saved the presentation' },
];

export const ACTIVITY_KEY = 'playfield:files-activity';
/** Events kept (the oldest go first). ~40 bytes each: well under 100 KB at the cap. */
export const ACTIVITY_LOG_CAP = 2000;
/** Fired on the window after a record, so an open Files home refreshes. */
export const ACTIVITY_CHANGED = 'files-activity-changed';

interface Stored { since: number; events: ActivityEvent[] }

/** What the log needs of storage (localStorage, or a test's map). */
export interface ActivityKV { get(key: string): string | null; set?(key: string, value: string): void }

const localKV: ActivityKV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* full or blocked: the log just doesn't grow */ } },
};

let cache: { kv: ActivityKV; raw: string | null; parsed: Stored } | null = null;

const isKind = (k: unknown): k is ActivityEventKind => ACTIVITY_KINDS.some(x => x.id === k);

function parse(raw: string | null): Stored {
  if (!raw) return { since: 0, events: [] };
  try {
    const o = JSON.parse(raw) as { since?: unknown; events?: unknown };
    const events = (Array.isArray(o.events) ? o.events : [])
      .filter((e): e is ActivityEvent => !!e && typeof e === 'object' && typeof (e as ActivityEvent).at === 'number' && isKind((e as ActivityEvent).kind))
      .map(e => ({ at: e.at, kind: e.kind, ...(typeof e.label === 'string' ? { label: e.label } : {}) }));
    return { since: typeof o.since === 'number' ? o.since : (events[0]?.at ?? 0), events };
  } catch { return { since: 0, events: [] }; }
}

function read(kv: ActivityKV): Stored {
  const raw = kv.get(ACTIVITY_KEY);
  if (cache && cache.kv === kv && cache.raw === raw) return cache.parsed;
  const parsed = parse(raw);
  cache = { kv, raw, parsed };
  return parsed;
}

function write(kv: ActivityKV, s: Stored): void {
  const raw = JSON.stringify(s);
  kv.set?.(ACTIVITY_KEY, raw);
  cache = { kv, raw, parsed: s };
}

/** The log's events, oldest first. */
export function readActivity(kv: ActivityKV = localKV): ActivityEvent[] {
  return read(kv).events;
}

/** When the log started counting (0 before anything was recorded or the home was opened). */
export function activitySince(kv: ActivityKV = localKV): number {
  return read(kv).since;
}

/** Start counting from now if the log hasn't yet (the home's first open); returns when it started. */
export function startActivity(now = Date.now(), kv: ActivityKV = localKV): number {
  const s = read(kv);
  if (s.since) return s.since;
  write(kv, { since: now, events: s.events });
  return now;
}

/** Note one event. Cheap enough to call from a save: one JSON write of a capped list. */
export function recordActivity(kind: ActivityEventKind, label?: string, now = Date.now(), kv: ActivityKV = localKV): void {
  const s = read(kv);
  const events = [...s.events, { at: now, kind, ...(label ? { label: label.slice(0, 80) } : {}) }];
  if (events.length > ACTIVITY_LOG_CAP) events.splice(0, events.length - ACTIVITY_LOG_CAP);
  write(kv, { since: s.since || now, events });
  if (kv === localKV) { try { window.dispatchEvent(new Event(ACTIVITY_CHANGED)); } catch { /* no window */ } }
}

export function clearActivity(kv: ActivityKV = localKV): void {
  write(kv, { since: 0, events: [] });
  if (kv === localKV) { try { window.dispatchEvent(new Event(ACTIVITY_CHANGED)); } catch { /* no window */ } }
}

// ── Sums ────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

/** Local midnight of the day `t` falls on. */
export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface KindTotals { kind: ActivityEventKind; count: number; /** One number per day, oldest first, `days` long. */ perDay: number[] }

/**
 * Per kind, how many events in the last `days` days (today included) and how
 * many on each of those days, for a sparkline. Days are local calendar days.
 */
export function activityTotals(events: ActivityEvent[], now = Date.now(), days = 7): KindTotals[] {
  const today = startOfDay(now);
  const first = today - (days - 1) * DAY;
  const out = new Map<ActivityEventKind, KindTotals>(ACTIVITY_KINDS.map(k => [k.id, { kind: k.id, count: 0, perDay: new Array<number>(days).fill(0) }]));
  for (const e of events) {
    if (e.at < first || e.at > now) continue;
    const i = Math.min(days - 1, Math.max(0, Math.round((startOfDay(e.at) - first) / DAY)));
    const t = out.get(e.kind)!;
    t.count++;
    t.perDay[i]++;
  }
  return [...out.values()];
}

/** Events of a month by day of month (1-based); days with none are absent. */
export function calendarBuckets(events: ActivityEvent[], year: number, month: number): Map<number, ActivityEvent[]> {
  const from = new Date(year, month, 1).getTime();
  const to = new Date(year, month + 1, 1).getTime();
  const out = new Map<number, ActivityEvent[]>();
  for (const e of events) {
    if (e.at < from || e.at >= to) continue;
    const day = new Date(e.at).getDate();
    const l = out.get(day) ?? [];
    l.push(e);
    out.set(day, l);
  }
  return out;
}

/** "14 saves this week", "1 render", "no takes". */
export function describeCount(kind: ActivityEventKind, n: number): string {
  const k = ACTIVITY_KINDS.find(x => x.id === kind)!;
  return n === 0 ? `no ${k.many}` : `${n} ${n === 1 ? k.one : k.many}`;
}
