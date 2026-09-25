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
/** How many earlier versions a project keeps. */
export const MAX_VERSIONS = 30;

export interface GraphVersion {
  version: number;
  savedAt: number;
  note?: string;
  /** The saved graph, as stored (JSON). */
  payload: string;
}

/** What a version list shows: everything but the graph itself. */
export type GraphVersionInfo = Omit<GraphVersion, 'payload'> & { current: boolean };

function readHistory(name: string): GraphVersion[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_PREFIX + name) ?? '[]');
    return Array.isArray(v) ? v.filter(x => x && typeof x.payload === 'string' && typeof x.version === 'number') : [];
  } catch { return []; }
}

/** Write history, dropping the oldest versions until it fits. Returns how many were kept. */
function writeHistory(name: string, history: GraphVersion[]): number {
  let list = history.slice(-MAX_VERSIONS);
  while (list.length) {
    try { localStorage.setItem(HISTORY_PREFIX + name, JSON.stringify(list)); return list.length; }
    catch { list = list.slice(1); }
  }
  localStorage.removeItem(HISTORY_PREFIX + name);
  return 0;
}

/** The version number and note stored in a saved graph (1 for graphs saved before versions). */
export function versionMeta(payload: string | null): { version: number; savedAt: number; note?: string } | null {
  if (!payload) return null;
  try {
    const p = JSON.parse(payload) as { version?: unknown; savedAt?: unknown; note?: unknown };
    return {
      version: typeof p.version === 'number' && p.version >= 1 ? Math.floor(p.version) : 1,
      savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0,
      ...(typeof p.note === 'string' && p.note ? { note: p.note } : {}),
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
  history.push({ version: meta.version, savedAt: meta.savedAt, ...(meta.note ? { note: meta.note } : {}), payload: current });
  history.sort((a, b) => a.version - b.version);
  writeHistory(name, history);
  return Math.max(meta.version, ...history.map(v => v.version)) + 1;
}

/** Every version of a project, newest first (the current one included). */
export function listVersions(name: string): GraphVersionInfo[] {
  const meta = versionMeta(localStorage.getItem(GRAPH_PREFIX + name));
  const out: GraphVersionInfo[] = readHistory(name).map(({ version, savedAt, note }) => ({ version, savedAt, ...(note ? { note } : {}), current: false }));
  if (meta) out.push({ ...meta, current: true });
  return out.sort((a, b) => b.version - a.version);
}

/** A version's saved graph (the current one too), or null. */
export function readVersion(name: string, version: number): string | null {
  const current = localStorage.getItem(GRAPH_PREFIX + name);
  if (versionMeta(current)?.version === version) return current;
  return readHistory(name).find(v => v.version === version)?.payload ?? null;
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
