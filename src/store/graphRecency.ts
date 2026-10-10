/**
 * graphRecency.ts — saved graphs by when they were last worked on (Today, This week, Earlier).
 *
 * "Worked on" is the latest save time of any version in the series (graphVersions.ts): the
 * newest version's, or an older one's when it was saved in place since. Lists group by it
 * (the top bar's Load menu, the sidebar's Saved Graphs), newest first.
 */

const GRAPH_PREFIX = 'shader-studio:';
const HISTORY_PREFIX = 'shader-studio-versions:';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

export type TimeBucket = 'today' | 'week' | 'earlier';
export const TIME_BUCKETS: ReadonlyArray<{ id: TimeBucket; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'earlier', label: 'Earlier' },
];

/** Today: the last 24 hours; This week: the last 7 days; Earlier: the rest (and never-dated saves). */
export function timeBucket(t: number, now = Date.now()): TimeBucket {
  if (!(t > 0)) return 'earlier';
  const age = now - t;
  if (age < DAY_MS) return 'today';
  if (age < WEEK_MS) return 'week';
  return 'earlier';
}

export interface TimeGroup<T> { id: TimeBucket; label: string; items: T[] }

/** Sort newest first (undated last, then by name) and split into the non-empty time groups, in order. */
export function groupByTime<T>(items: readonly T[], timeOf: (item: T) => number, nameOf: (item: T) => string, now = Date.now()): TimeGroup<T>[] {
  const sorted = sortByRecent(items, timeOf, nameOf);
  return TIME_BUCKETS
    .map(b => ({ id: b.id, label: b.label, items: sorted.filter(it => timeBucket(timeOf(it), now) === b.id) }))
    .filter(g => g.items.length > 0);
}

/** Newest first; ties and undated ones by name. */
export function sortByRecent<T>(items: readonly T[], timeOf: (item: T) => number, nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => (timeOf(b) || 0) - (timeOf(a) || 0) || nameOf(a).localeCompare(nameOf(b)));
}

// A history's own `savedAt` fields sit at its top level; the ones inside each stored graph are
// escaped (\"savedAt\"), so this reads the versions' times without parsing every graph.
const HISTORY_SAVED_AT = /(?:^|[^\\])"savedAt":(\d+)/g;
const PAYLOAD_SAVED_AT = /^\{[\s\S]*?"savedAt":(\d+)/;

const cache = new Map<string, { sig: string; t: number }>();

/** When a saved series was last worked on: the latest save of any of its versions (0 when undated). */
export function lastWorkedOn(name: string): number {
  let current: string | null = null, history: string | null = null;
  try { current = localStorage.getItem(GRAPH_PREFIX + name); history = localStorage.getItem(HISTORY_PREFIX + name); } catch { return 0; }
  const sig = `${current?.length ?? -1}:${history?.length ?? -1}:${current?.slice(-64) ?? ''}`;
  const hit = cache.get(name);
  if (hit && hit.sig === sig) return hit.t;
  let t = 0;
  if (current) {
    try { const v = (JSON.parse(current) as { savedAt?: unknown }).savedAt; if (typeof v === 'number') t = v; }
    catch { const m = PAYLOAD_SAVED_AT.exec(current); if (m) t = Number(m[1]); }
  }
  if (history) for (const m of history.matchAll(HISTORY_SAVED_AT)) t = Math.max(t, Number(m[1]));
  cache.set(name, { sig, t });
  return t;
}

/** Saved graphs' names, newest worked-on first. */
export function sortGraphsByRecent(names: readonly string[]): string[] {
  return sortByRecent(names, lastWorkedOn, n => n);
}

/** Saved graphs' names under Today, This week and Earlier. */
export function groupGraphsByTime(names: readonly string[], now = Date.now()): TimeGroup<string>[] {
  return groupByTime(names, lastWorkedOn, n => n, now);
}
