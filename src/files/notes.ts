/**
 * notes.ts — every note people wrote, for the Files page's Notes view: a
 * saved graph's Play notes (PlayRecord.notes, with its credit, PlayRecord.source)
 * and its node comments (node.params.__comment, with node.params.__credit),
 * inside groups too. The open graph counts as well: unsaved, or with changes
 * not saved yet (then its live notes stand in for the saved ones).
 *
 * Plus the numbers the view shows (stats), search, filter and sort, and
 * removing one note from a saved graph with an undo. Examples aren't listed:
 * their notes belong to the app, not to you.
 *
 * Pure: reads a KV (localStorage in the app, a map in tests).
 */
import type { KV } from '../utils/library';
import { parseSourceCredit, type SourceCredit } from '../types/credit';
import { GRAPH_PREFIX, isGraphEntry, parseJson } from './inventory';

export type NoteKind = 'play' | 'comment';

export interface NoteEntry {
  /** Stable: `<graph key>|play` or `<graph key>|node:<path…>/<id>`. */
  id: string;
  kind: NoteKind;
  /** The saved graph's name; null for the open graph that was never saved. */
  graph: string | null;
  /** How the graph is shown: its name, or "Open graph (not saved)". */
  graphLabel: string;
  /** From the open graph's live state (not what's saved). */
  live: boolean;
  text: string;
  credit?: SourceCredit;
  /** When it was last saved (the graph's save time), when known. */
  date?: number;
  /** Comments: the node, its name and type, and the groups it sits in (outermost first). */
  nodeId?: string;
  nodeLabel?: string;
  nodeType?: string;
  /** The node type's name ("Noise"), for "most-commented nodes". */
  nodeTypeLabel?: string;
  groupPath?: string[];
  /** The names of those groups, for the owner path. */
  groupLabels?: string[];
}

export interface OpenGraphState {
  /** The saved graph it is, or null when it was never saved. */
  name: string | null;
  dirty: boolean;
  nodes: unknown[];
  play?: unknown;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export const OPEN_GRAPH_LABEL = 'Open graph (not saved)';

/** A node's shown name: its own label, else its type's name (from `labelOf`), else the type made readable. */
function nodeName(n: Obj, labelOf?: (type: string) => string | undefined): string {
  const own = str(obj(n.params)?.label)?.trim();
  return own || typeName(str(n.type) ?? 'node', labelOf);
}
function typeName(type: string, labelOf?: (type: string) => string | undefined): string {
  return labelOf?.(type) ?? type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
}

/** Every node in a graph's nodes (groups' insides too), with the groups it sits in. */
export function* walkGraphNodes(nodes: unknown[], path: Obj[] = []): Generator<{ node: Obj; path: Obj[] }> {
  for (const raw of nodes) {
    const n = obj(raw);
    if (!n || typeof n.id !== 'string') continue;
    yield { node: n, path };
    const sub = arr(obj(obj(n.params)?.subgraph)?.nodes);
    if (sub.length) yield* walkGraphNodes(sub, [...path, n]);
  }
}

function notesOf(graphKeyId: string, graph: string | null, g: { nodes: unknown[]; play?: unknown; savedAt?: number }, live: boolean, labelOf?: (type: string) => string | undefined): NoteEntry[] {
  const graphLabel = graph ?? OPEN_GRAPH_LABEL;
  const out: NoteEntry[] = [];
  const play = obj(g.play);
  const text = str(play?.notes)?.trim();
  if (text) {
    const credit = parseSourceCredit(play?.source);
    out.push({ id: `${graphKeyId}|play`, kind: 'play', graph, graphLabel, live, text, ...(credit ? { credit } : {}), ...(g.savedAt ? { date: g.savedAt } : {}) });
  }
  for (const { node, path } of walkGraphNodes(g.nodes)) {
    const p = obj(node.params);
    const comment = str(p?.__comment)?.trim();
    if (!comment) continue;
    const credit = parseSourceCredit(p?.__credit);
    const groupPath = path.map(x => x.id as string);
    out.push({
      id: `${graphKeyId}|node:${[...groupPath, node.id as string].join('/')}`, kind: 'comment', graph, graphLabel, live, text: comment,
      ...(credit ? { credit } : {}), ...(g.savedAt ? { date: g.savedAt } : {}),
      nodeId: node.id as string, nodeLabel: nodeName(node, labelOf), nodeType: str(node.type), nodeTypeLabel: typeName(str(node.type) ?? 'node', labelOf), groupPath, groupLabels: path.map(x => nodeName(x, labelOf)),
    });
  }
  return out;
}

export interface NotesCollection {
  notes: NoteEntry[];
  /** Every graph looked at (saved ones without notes too; the unsaved open graph only when it has notes): name (null = the unsaved open graph) → its node count and how many have a comment. */
  graphs: Array<{ graph: string | null; label: string; nodes: number; commented: number }>;
}

/**
 * Every note in the saved graphs (and the open graph, when it is unsaved or
 * has changes). `labelOf` names a node type ("Noise") for nodes without a label.
 */
export function collectNotes(kv: KV, opts: { open?: OpenGraphState | null; labelOf?: (type: string) => string | undefined } = {}): NotesCollection {
  const notes: NoteEntry[] = [];
  const graphs: NotesCollection['graphs'] = [];
  const open = opts.open;
  const liveName = open && open.dirty ? open.name : undefined;
  const count = (nodes: unknown[]) => { let n = 0, c = 0; for (const { node } of walkGraphNodes(nodes)) { n++; if (str(obj(node.params)?.__comment)?.trim()) c++; } return { nodes: n, commented: c }; };
  for (const key of kv.keys().sort()) {
    if (!key.startsWith(GRAPH_PREFIX)) continue;
    const raw = kv.get(key);
    const parsed = parseJson(raw);
    if (!isGraphEntry(key, parsed)) continue;
    const name = key.slice(GRAPH_PREFIX.length);
    const g = parsed as Obj;
    const useLive = liveName === name && open;
    const src = useLive ? { nodes: open.nodes, play: open.play, savedAt: typeof g.savedAt === 'number' ? g.savedAt : undefined } : { nodes: arr(g.nodes), play: g.play, savedAt: typeof g.savedAt === 'number' ? g.savedAt : undefined };
    notes.push(...notesOf(key, name, src, !!useLive, opts.labelOf));
    graphs.push({ graph: name, label: name, ...count(src.nodes) });
  }
  if (open && open.name == null) {
    const list = notesOf('open', null, { nodes: open.nodes, play: open.play }, true, opts.labelOf);
    const c = count(open.nodes);
    if (list.length) { notes.push(...list); graphs.push({ graph: null, label: OPEN_GRAPH_LABEL, ...c }); }
  }
  return { notes, graphs };
}

// ── Stats ───────────────────────────────────────────────────────────────────

export interface NotesStats {
  total: number;
  play: number;
  comments: number;
  withCredit: number;
  /** Notes per graph, most first (graphs without notes left out). */
  perGraph: Array<{ graph: string | null; label: string; count: number }>;
  /** The five graphs with the most notes. */
  topGraphs: Array<{ graph: string | null; label: string; count: number }>;
  /** The five most-commented kinds of node across graphs ("Noise": 4 comments). */
  topNodes: Array<{ label: string; count: number }>;
  /** Nodes across the listed graphs, with and without a comment. */
  nodesWith: number;
  nodesWithout: number;
}

export function notesStats(c: NotesCollection): NotesStats {
  const per = new Map<string, { graph: string | null; label: string; count: number }>();
  const byNode = new Map<string, number>();
  let play = 0, comments = 0, withCredit = 0;
  for (const n of c.notes) {
    const k = n.graph ?? '\u0000open';
    const e = per.get(k) ?? { graph: n.graph, label: n.graphLabel, count: 0 };
    e.count++;
    per.set(k, e);
    if (n.kind === 'play') play++; else { comments++; const l = n.nodeTypeLabel ?? n.nodeLabel ?? 'Node'; byNode.set(l, (byNode.get(l) ?? 0) + 1); }
    if (n.credit) withCredit++;
  }
  const perGraph = [...per.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const topNodes = [...byNode.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 5);
  const nodes = c.graphs.reduce((n, g) => n + g.nodes, 0);
  const nodesWith = c.graphs.reduce((n, g) => n + g.commented, 0);
  return { total: c.notes.length, play, comments, withCredit, perGraph, topGraphs: perGraph.slice(0, 5), topNodes, nodesWith, nodesWithout: nodes - nodesWith };
}

// ── Search, filter, sort ────────────────────────────────────────────────────

export type NoteSort = 'date' | 'length' | 'graph';
export interface NoteQuery {
  search?: string;
  kind?: NoteKind | 'all';
  /** A graph's name, '' for the unsaved open graph, undefined for all. */
  graph?: string;
  sort?: NoteSort;
}

/** The note's owner as words: "Sunset → Group → Noise", or "Sunset → Play notes". */
export function ownerPath(n: NoteEntry): string[] {
  return n.kind === 'play' ? [n.graphLabel, 'Play notes'] : [n.graphLabel, ...(n.groupLabels ?? []), n.nodeLabel ?? 'Node'];
}

export function queryNotes(notes: NoteEntry[], q: NoteQuery): NoteEntry[] {
  const words = (q.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = notes.filter(n => {
    if (q.kind && q.kind !== 'all' && n.kind !== q.kind) return false;
    if (q.graph !== undefined && (n.graph ?? '') !== q.graph) return false;
    if (!words.length) return true;
    const hay = [n.text, ...ownerPath(n), n.nodeType ?? '', n.credit?.title ?? '', n.credit?.author ?? ''].join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  });
  const byGraph = (a: NoteEntry, b: NoteEntry) => a.graphLabel.localeCompare(b.graphLabel) || (a.kind === b.kind ? 0 : a.kind === 'play' ? -1 : 1) || (a.nodeLabel ?? '').localeCompare(b.nodeLabel ?? '');
  const sort = q.sort ?? 'graph';
  if (sort === 'date') out.sort((a, b) => (b.live ? Infinity : b.date ?? 0) - (a.live ? Infinity : a.date ?? 0) || byGraph(a, b));
  else if (sort === 'length') out.sort((a, b) => b.text.length - a.text.length || byGraph(a, b));
  else out.sort(byGraph);
  return out;
}

/** Notes grouped by graph, keeping the order they come in (the first note of a graph places the graph). */
export function groupByGraph(notes: NoteEntry[]): Array<{ graph: string | null; label: string; notes: NoteEntry[] }> {
  const map = new Map<string, { graph: string | null; label: string; notes: NoteEntry[] }>();
  for (const n of notes) {
    const k = n.graph ?? '\u0000open';
    const g = map.get(k) ?? { graph: n.graph, label: n.graphLabel, notes: [] };
    g.notes.push(n);
    map.set(k, g);
  }
  return [...map.values()];
}

/** Text for a one-glance preview: Play note links ([[layer:…]]) become their kind, extra blank lines go. */
export function previewText(text: string, max = 280): string {
  const t = text.replace(/\[\[(layer|control):[A-Za-z0-9_-]+\]\]/g, (_, k: string) => `(${k})`).replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

// ── Remove one ──────────────────────────────────────────────────────────────

/**
 * Take one note out of its saved graph (a comment's credit goes with it; Play
 * notes keep their credit, which is the setup's). Returns an undo that puts
 * the graph back exactly as it was, or null when it isn't there any more (or
 * belongs to the open graph, which is edited in place).
 */
export function removeNote(kv: KV, note: NoteEntry): (() => void) | null {
  if (note.live || note.graph == null) return null;
  const key = GRAPH_PREFIX + note.graph;
  const before = kv.get(key);
  const g = obj(parseJson(before));
  if (!before || !g) return null;
  if (note.kind === 'play') {
    const play = obj(g.play);
    if (!play || typeof play.notes !== 'string') return null;
    const next = { ...play };
    delete next.notes;
    g.play = next;
  } else {
    // Copy down the path so only the node's own params change.
    let scope = arr(g.nodes).slice();
    g.nodes = scope;
    for (const gid of note.groupPath ?? []) {
      const i = scope.findIndex(x => obj(x)?.id === gid);
      if (i < 0) return null;
      const grp = { ...obj(scope[i])! };
      const params = { ...obj(grp.params) };
      const sub = { ...obj(params.subgraph) };
      const inner = arr(sub.nodes).slice();
      sub.nodes = inner; params.subgraph = sub; grp.params = params; scope[i] = grp;
      scope = inner;
    }
    const i = scope.findIndex(x => obj(x)?.id === note.nodeId);
    if (i < 0) return null;
    const n = { ...obj(scope[i])! };
    const params = { ...obj(n.params) };
    if (typeof params.__comment !== 'string') return null;
    delete params.__comment;
    delete params.__credit;
    n.params = params;
    scope[i] = n;
  }
  kv.set(key, JSON.stringify(g));
  return () => kv.set(key, before);
}
