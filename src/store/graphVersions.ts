/**
 * graphVersions.ts — earlier versions of a saved graph.
 *
 * A saved graph is one project: its newest version lives where saved graphs
 * always have (`shader-studio:<name>`, with a `version` number and an
 * optional `note` in it), so every list and loader keeps working. Saving
 * again moves that version into the project's history
 * (`shader-studio-versions:<name>`, a key the saved-graph list ignores) and
 * writes the new one in its place.
 *
 * History is capped, and when the browser's storage is full the oldest
 * versions are dropped first: the newest version is never lost to history.
 */

const GRAPH_PREFIX = 'shader-studio:';
const HISTORY_PREFIX = 'shader-studio-versions:';
/** How many earlier versions a series keeps at most (the size limit usually decides first). */
export const MAX_VERSIONS = 500;
/** App setting: how big a series' history may grow, in MB (docs/graph-series-plan.md). */
export const SERIES_LIMIT_KEY = 'shader-studio:settings:seriesHistoryMB';
export const DEFAULT_SERIES_MB = 3;

export function seriesLimitBytes(): number {
  try {
    const v = Number(localStorage.getItem(SERIES_LIMIT_KEY));
    return (Number.isFinite(v) && v > 0 ? v : DEFAULT_SERIES_MB) * 1024 * 1024;
  } catch { return DEFAULT_SERIES_MB * 1024 * 1024; }
}

/** A version's place in its series: family (major) and tweak (minor). */
export interface SeriesNumber { major: number; minor: number }
export const seriesLabel = (n: SeriesNumber) => `${n.major}.${n.minor}`;

export interface GraphVersion {
  /** A running count of saves (1, 2, 3…), kept so older code and files still read. */
  version: number;
  major?: number;
  minor?: number;
  savedAt: number;
  note?: string;
  /** Saved by autosave (files/versionAutosave.ts), not by hand: history trimming drops these first. */
  auto?: boolean;
  /** The saved graph, as stored (JSON). */
  payload: string;
}

/** What a version list shows: everything but the graph itself. */
export type GraphVersionInfo = Omit<GraphVersion, 'payload' | 'major' | 'minor'> & SeriesNumber & { current: boolean };

function readHistory(name: string): GraphVersion[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_PREFIX + name) ?? '[]');
    return Array.isArray(v) ? v.filter(x => x && typeof x.payload === 'string' && typeof x.version === 'number') : [];
  } catch { return []; }
}

/** Write history, dropping the oldest versions until it fits. Returns how many were kept. */
function writeHistory(name: string, history: GraphVersion[]): number {
  let list = trimToSize(history.slice(-MAX_VERSIONS), seriesLimitBytes());
  while (list.length) {
    try { localStorage.setItem(HISTORY_PREFIX + name, JSON.stringify(list)); return list.length; }
    catch { const victim = trimVictim(list)!; list = list.filter(v => v !== victim); }
  }
  localStorage.removeItem(HISTORY_PREFIX + name);
  return 0;
}

/**
 * The version trimming drops next: the oldest autosave first, then the oldest tweak saved by
 * hand; never a family's first or latest version unless nothing else is left.
 */
export function trimVictim(list: readonly GraphVersion[]): GraphVersion | undefined {
  if (!list.length) return undefined;
  const byMajor = new Map<number, GraphVersion[]>();
  for (const v of list) { const m = numberOf(v).major; byMajor.set(m, [...(byMajor.get(m) ?? []), v]); }
  const keep = new Set<GraphVersion>();
  for (const fam of byMajor.values()) {
    const sorted = [...fam].sort((a, b) => numberOf(a).minor - numberOf(b).minor);
    keep.add(sorted[0]); keep.add(sorted[sorted.length - 1]);
  }
  return [...list].sort((a, b) => Number(!!b.auto) - Number(!!a.auto) || a.savedAt - b.savedAt).find(v => !keep.has(v)) ?? list[0];
}

/** Drop versions until the history fits `limit` bytes, in trimVictim's order. */
export function trimToSize(history: GraphVersion[], limit: number): GraphVersion[] {
  const list = [...history];
  const size = () => list.reduce((n, v) => n + v.payload.length * 2, 0);
  while (list.length > 1 && size() > limit) list.splice(list.indexOf(trimVictim(list)!), 1);
  return list;
}

/** A stored version's series number; versions saved before series read as 1.(version − 1). */
export function numberOf(v: { version: number; major?: number; minor?: number }): SeriesNumber {
  return typeof v.major === 'number' && typeof v.minor === 'number' ? { major: v.major, minor: v.minor } : { major: 1, minor: Math.max(0, v.version - 1) };
}

/** The version number and note stored in a saved graph (1 for graphs saved before versions). */
export function versionMeta(payload: string | null): { version: number; major: number; minor: number; savedAt: number; note?: string; auto?: boolean } | null {
  if (!payload) return null;
  try {
    const p = JSON.parse(payload) as { version?: unknown; major?: unknown; minor?: unknown; savedAt?: unknown; note?: unknown; auto?: unknown };
    const version = typeof p.version === 'number' && p.version >= 1 ? Math.floor(p.version) : 1;
    return {
      version,
      ...numberOf({ version, major: typeof p.major === 'number' ? p.major : undefined, minor: typeof p.minor === 'number' ? p.minor : undefined }),
      savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0,
      ...(typeof p.note === 'string' && p.note ? { note: p.note } : {}),
      ...(p.auto === true ? { auto: true } : {}),
    };
  } catch { return null; }
}

/**
 * Before a new version is written: move the current one into history and
 * say which number the new one gets (1 for a new project).
 */
export function archiveCurrent(name: string): number {
  const current = localStorage.getItem(GRAPH_PREFIX + name);
  const meta = versionMeta(current);
  if (!current || !meta) return 1;
  const history = readHistory(name).filter(v => v.version !== meta.version);
  history.push({ version: meta.version, major: meta.major, minor: meta.minor, savedAt: meta.savedAt, ...(meta.note ? { note: meta.note } : {}), ...(meta.auto ? { auto: true } : {}), payload: current });
  history.sort((a, b) => a.version - b.version);
  writeHistory(name, history);
  return Math.max(meta.version, ...history.map(v => v.version)) + 1;
}

/** Every version of a project, newest first (the current one included). */
export function listVersions(name: string): GraphVersionInfo[] {
  const meta = versionMeta(localStorage.getItem(GRAPH_PREFIX + name));
  const out: GraphVersionInfo[] = readHistory(name).map(v => ({ version: v.version, ...numberOf(v), savedAt: v.savedAt, ...(v.note ? { note: v.note } : {}), ...(v.auto ? { auto: true } : {}), current: false }));
  if (meta) out.push({ ...meta, current: true });
  // Newest family first, newest tweak first within it.
  return out.sort((a, b) => b.major - a.major || b.minor - a.minor || b.version - a.version);
}

export type SaveKind = 'minor' | 'major' | 'inPlace' | 'new';

/**
 * The number a save gets. `base` is the version open now when it belongs to this series (null when
 * saving under this name from somewhere else: an example, another graph, a fresh graph).
 *  - minor: the next tweak in base's family (2.3 → 2.4, or after the family's newest);
 *  - major, or a save into an existing series from elsewhere: a new family (→ 3.0);
 *  - a name with nothing saved: 1.0.
 */
export function nextNumber(name: string, kind: Exclude<SaveKind, 'inPlace'>, base: SeriesNumber | null): SeriesNumber {
  const all = listVersions(name);
  if (!all.length) return { major: 1, minor: 0 };
  const maxMajor = Math.max(...all.map(v => v.major));
  if (kind !== 'minor' || !base) return { major: maxMajor + 1, minor: 0 };
  const fam = all.filter(v => v.major === base.major);
  return { major: base.major, minor: Math.max(base.minor, ...fam.map(v => v.minor)) + 1 };
}

/** Save in place: replace one stored version's graph, keeping its numbers. True when it was there. */
export function replaceVersion(name: string, version: number, payload: string): boolean {
  const current = localStorage.getItem(GRAPH_PREFIX + name);
  if (versionMeta(current)?.version === version) { localStorage.setItem(GRAPH_PREFIX + name, payload); return true; }
  const history = readHistory(name);
  const i = history.findIndex(v => v.version === version);
  if (i < 0) return false;
  const meta = versionMeta(payload);
  const { auto: _wasAuto, ...rest } = history[i];
  // Saved over by hand: it isn't an autosave any more.
  history[i] = { ...rest, payload, savedAt: meta?.savedAt ?? Date.now(), ...(meta?.note ? { note: meta.note } : {}), ...(meta?.auto ? { auto: true } : {}) };
  writeHistory(name, history);
  return true;
}

/** A version's saved graph (the current one too), or null. */
export function readVersion(name: string, version: number): string | null {
  const current = localStorage.getItem(GRAPH_PREFIX + name);
  if (versionMeta(current)?.version === version) return current;
  return readHistory(name).find(v => v.version === version)?.payload ?? null;
}

/** A series' earlier versions, oldest first (for a whole-series .playfile). */
export function seriesHistory(name: string): GraphVersion[] {
  return readHistory(name);
}

/**
 * A whole series arriving from a .playfile: its earlier versions become this name's history.
 * Only for a name with no history of its own (an import never mixes two series' pasts).
 */
export function adoptSeriesHistory(name: string, history: unknown): number {
  if (readHistory(name).length || !Array.isArray(history)) return 0;
  const list = history.filter((x): x is GraphVersion => !!x && typeof x.payload === 'string' && typeof x.version === 'number');
  return list.length ? writeHistory(name, list) : 0;
}

export function deleteHistory(name: string): void {
  localStorage.removeItem(HISTORY_PREFIX + name);
}

/** "just now", "5 min ago", "yesterday 14:02", "3 Mar 09:15". */
export function whenSaved(t: number): string {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today ${hm}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `yesterday ${hm}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${hm}`;
}
