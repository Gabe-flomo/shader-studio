/**
 * libraryFacade.ts — the Library's one read/write interface over everything you save
 * (docs/library.md). The things themselves stay where they have always been stored:
 *
 *   Graphs            `shader-studio:<name>` (+ `shader-studio-versions:<name>`), folder scope `graphs`
 *   Presets           every kind in presets/presetKinds.ts, except the three below
 *   Functions         Custom Function presets (`shader-studio:cfp:<id>`), scope `functions`
 *   Expression Blocks `shader-studio:ep:<id>`, scope `expressions`
 *   Keyframes         keyframe curves (`shader-studio:kfp:<id>`), scope `keyframes`
 *   My nodes          published node types (`shader-studio:un:<id>`), scope `presets:usernodes`
 *   Shaders           the Code page's saved shaders (one list, `shader-studio:glsl-shaders`, folders by `group`)
 *
 * so lists, renames, deletes and exports read and write the very same keys the old panels did.
 * Every write says what changed (window events and in-memory stores refreshed), and a delete
 * hands back an undo that puts every key it touched back exactly as it was.
 */
import { localMutableKV, type MutableKV } from '../files/mutate';
import { LIBRARY_KIND, isGraphKey, isSnapshot, type LibrarySnapshot } from '../utils/library';
import type { FileResult } from '../utils/fileIO';
import { safeSetItem } from '../utils/fileIO';
import { graphRenamed } from '../present/links';
import { getFolderForItem, moveItemsToFolder, removeItemsFromFolders } from '../utils/assetFolders';
import { exportPresets, importPresets, listPresets, notifyPresets, presetKinds, renamePreset, removePreset, type PresetItem } from '../presets/presetStore';

export type LibraryType = 'graphs' | 'presets' | 'functions' | 'expressions' | 'keyframes' | 'nodes' | 'shaders';

export const LIBRARY_TYPES: ReadonlyArray<{ id: LibraryType; label: string; one: string; empty: string }> = [
  { id: 'graphs', label: 'Graphs', one: 'graph', empty: 'Save the graph (⌘S) to keep it here.' },
  { id: 'presets', label: 'Presets', one: 'preset', empty: 'Save a group, a builder scene, a layer set or a look as a preset.' },
  { id: 'functions', label: 'Functions', one: 'function', empty: 'Save a Custom Function node as a preset.' },
  { id: 'expressions', label: 'Expression Blocks', one: 'Expression Block', empty: 'Save an Expression Block node as a preset.' },
  { id: 'keyframes', label: 'Keyframes', one: 'keyframe curve', empty: 'Save a curve from the keyframe editor.' },
  { id: 'nodes', label: 'My nodes', one: 'node type', empty: 'Publish a graph or a group as a node (Publish node).' },
  { id: 'shaders', label: 'Shaders', one: 'shader', empty: 'Save a shader on the Code page’s Shader tab.' },
];

/** Which preset kind backs a type that is a preset underneath. */
export const TYPE_KIND: Partial<Record<LibraryType, string>> = { functions: 'customFn', expressions: 'expr', keyframes: 'keyframe' };
/** The preset kinds the Library shows under their own filters rather than under Presets. */
export const OWN_FILTER_KINDS: ReadonlySet<string> = new Set(Object.values(TYPE_KIND));

export const GRAPH_PREFIX = 'shader-studio:';
export const VERSIONS_PREFIX = 'shader-studio-versions:';
export const USER_NODE_PREFIX = 'shader-studio:un:';
export const SHADERS_KEY = 'shader-studio:glsl-shaders';
export const GRAPH_FOLDER_SCOPE = 'graphs';
export const NODE_FOLDER_SCOPE = 'presets:usernodes';
/** Fired when the saved graphs change (the store's SAVED_GRAPHS_CHANGED). */
export const SAVED_GRAPHS_CHANGED = 'saved-graphs-changed';
/** Fired when the Code page's saved shaders change, so an open Shader tab re-reads them. */
export const SHADERS_CHANGED = 'glsl-shaders-changed';
/** Ask an open Shader tab to load a saved shader (detail: { id }). */
export const OPEN_SAVED_SHADER = 'open-saved-shader';
const USER_NODE_CHANGED = 'usernode-changed';

export interface LibraryItem {
  type: LibraryType;
  id: string;
  name: string;
  /** Its preset kind (presets, functions, expressions, keyframes). */
  kind?: string;
  /** Its folder scope in the folder store; absent when it keeps folders its own way (shaders). */
  folderScope?: string;
  /** A shader's group (its folder on the Code page). */
  group?: string;
  savedAt: number;
  thumb?: string | null;
  hint?: string;
  /** The stored record (presets, nodes, shaders). */
  record?: Record<string, unknown>;
}

const parse = (v: string | null | undefined): unknown => { if (v == null) return undefined; try { return JSON.parse(v); } catch { return undefined; } };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The keys that are saved graphs (a `nodes` array at the top, not a preset, a node type or a setting). */
export function graphNames(kv: MutableKV = localMutableKV): string[] {
  const out: string[] = [];
  for (const k of kv.keys()) {
    if (!k.startsWith(GRAPH_PREFIX) || k.startsWith(USER_NODE_PREFIX)) continue;
    if (isGraphKey(k, kv.get(k))) out.push(k.slice(GRAPH_PREFIX.length));
  }
  return out.sort();
}

const fromPreset = (type: LibraryType) => (p: PresetItem): LibraryItem => ({
  type, id: p.id, name: p.name, kind: p.kind, folderScope: presetKinds().find(k => k.id === p.kind)?.noFolders ? undefined : presetKinds().find(k => k.id === p.kind)?.folderScope,
  savedAt: p.savedAt, thumb: p.thumb, hint: p.hint, record: p.record,
});

/** Everything of one type, as the Library lists it. */
export function listLibrary(type: LibraryType, kv: MutableKV = localMutableKV): LibraryItem[] {
  switch (type) {
    case 'graphs':
      return graphNames(kv).map(name => {
        const v = parse(kv.get(GRAPH_PREFIX + name)) as { savedAt?: unknown } | undefined;
        return { type, id: name, name, folderScope: GRAPH_FOLDER_SCOPE, savedAt: typeof v?.savedAt === 'number' ? v.savedAt : 0 };
      });
    case 'functions': case 'expressions': case 'keyframes':
      return listPresets(TYPE_KIND[type]!, kv).map(fromPreset(type));
    case 'presets':
      return presetKinds().filter(k => !OWN_FILTER_KINDS.has(k.id)).flatMap(k => listPresets(k.id, kv).map(fromPreset('presets')));
    case 'nodes': {
      const out: LibraryItem[] = [];
      for (const k of kv.keys()) {
        if (!k.startsWith(USER_NODE_PREFIX)) continue;
        const r = parse(kv.get(k));
        if (!isObj(r) || typeof r.id !== 'string') continue;
        out.push({ type, id: r.id, name: typeof r.label === 'string' ? r.label : r.id, folderScope: NODE_FOLDER_SCOPE, savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0, record: r });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    case 'shaders': {
      const list = parse(kv.get(SHADERS_KEY));
      return (Array.isArray(list) ? list : []).flatMap((s): LibraryItem[] => (isObj(s) && typeof s.id === 'string'
        ? [{ type, id: s.id, name: typeof s.name === 'string' && s.name.trim() ? s.name : 'Untitled shader', ...(typeof s.group === 'string' && s.group ? { group: s.group } : {}), savedAt: 0, ...(typeof s.note === 'string' && s.note.trim() ? { hint: s.note } : {}), record: s }]
        : []));
    }
  }
}

/** Every type's items. */
export function listEverything(kv: MutableKV = localMutableKV): Record<LibraryType, LibraryItem[]> {
  return Object.fromEntries(LIBRARY_TYPES.map(t => [t.id, listLibrary(t.id, kv)])) as Record<LibraryType, LibraryItem[]>;
}

/** The events that mean the Library's lists changed. */
export function libraryEvents(): string[] {
  return [...new Set([SAVED_GRAPHS_CHANGED, SHADERS_CHANGED, USER_NODE_CHANGED, 'presets-changed', 'assetbrowser-folders-changed', ...presetKinds().flatMap(k => k.events)])];
}

// ── Keeping the app in step ───────────────────────────────────────────────────

/** Hooks for the parts of the app that hold copies in memory (set by the app; tests leave them). */
export const librarySync: {
  /** Published nodes changed in storage: reload the registry. */
  reloadUserNodes?: () => void;
  /** A saved graph was renamed: the open graph's name follows. */
  graphRenamed?: (from: string, to: string) => void;
} = {};

/** Tell everything holding a copy of these keys that they changed. */
export function syncKeys(keys: Iterable<string>): void {
  const ks = [...keys];
  const any = (p: (k: string) => boolean) => ks.some(p);
  for (const def of presetKinds()) {
    const s = def.storage;
    if (any(k => (s.t === 'prefix' ? k.startsWith(s.prefix) : k === s.key))) notifyPresets(def.id);
  }
  if (any(k => k.startsWith(USER_NODE_PREFIX))) librarySync.reloadUserNodes?.();
  if (typeof window === 'undefined') return;
  if (any(k => k.startsWith(GRAPH_PREFIX) || k.startsWith(VERSIONS_PREFIX))) window.dispatchEvent(new Event(SAVED_GRAPHS_CHANGED));
  if (any(k => k === SHADERS_KEY)) window.dispatchEvent(new Event(SHADERS_CHANGED));
  if (any(k => k === 'assetbrowser_folders')) window.dispatchEvent(new Event('assetbrowser-folders-changed'));
}

/**
 * Run a change and return an undo for it: every key it added, changed or removed is put back as
 * it was (the store's own bookkeeping, a presentation's link, a folder membership included).
 */
export function withUndo(change: () => FileResult, kv: MutableKV = localMutableKV): { result: FileResult; undo: () => void; keys: string[] } {
  const before = new Map(kv.keys().map(k => [k, kv.get(k)]));
  const result = change();
  const after = new Map(kv.keys().map(k => [k, kv.get(k)]));
  const keys = [...new Set([...before.keys(), ...after.keys()])].filter(k => before.get(k) !== after.get(k));
  const undo = () => {
    for (const k of keys) {
      const v = before.get(k);
      if (v == null) kv.remove(k); else kv.set(k, v);
    }
    if (kv === localMutableKV) syncKeys(keys);
  };
  return { result, undo, keys };
}

// ── Rename ────────────────────────────────────────────────────────────────────

/** Rename a saved graph: its versions, folder and linked presentations come along; the name must be free. */
export function renameGraph(from: string, to: string, kv: MutableKV = localMutableKV): FileResult {
  const name = to.trim();
  if (!name) return { ok: false, error: 'A graph needs a name.' };
  if (name === from) return { ok: true };
  const v = kv.get(GRAPH_PREFIX + from);
  if (v == null) return { ok: false, error: `No saved graph named “${from}”.` };
  if (kv.get(GRAPH_PREFIX + name) != null) return { ok: false, error: `There is already a graph named “${name}”.` };
  if (kv === localMutableKV) { const r = safeSetItem(GRAPH_PREFIX + name, v, `graph “${name}”`); if (!r.ok) return r; } else kv.set(GRAPH_PREFIX + name, v);
  const hist = kv.get(VERSIONS_PREFIX + from);
  if (hist != null) { kv.set(VERSIONS_PREFIX + name, hist); kv.remove(VERSIONS_PREFIX + from); }
  kv.remove(GRAPH_PREFIX + from);
  if (kv === localMutableKV) {
    const folder = getFolderForItem(GRAPH_FOLDER_SCOPE, from);
    if (folder) { moveItemsToFolder(GRAPH_FOLDER_SCOPE, [name], folder); removeItemsFromFolders(GRAPH_FOLDER_SCOPE, [from]); }
    graphRenamed(from, name);
    librarySync.graphRenamed?.(from, name);
    syncKeys([GRAPH_PREFIX + name]);
  } else {
    graphRenamed(from, name, kv);
  }
  return { ok: true };
}

function editList(kv: MutableKV, key: string, edit: (list: unknown[]) => unknown[], what: string): FileResult {
  const list = parse(kv.get(key));
  const next = JSON.stringify(edit(Array.isArray(list) ? list : []));
  if (kv === localMutableKV) return safeSetItem(key, next, what);
  kv.set(key, next);
  return { ok: true };
}

export function renameItem(item: LibraryItem, name: string, kv: MutableKV = localMutableKV): FileResult {
  const n = name.trim();
  if (!n) return { ok: false, error: 'It needs a name.' };
  switch (item.type) {
    case 'graphs': return renameGraph(item.id, n, kv);
    case 'nodes': {
      const key = USER_NODE_PREFIX + item.id;
      const r = parse(kv.get(key));
      if (!isObj(r)) return { ok: false, error: 'That node type is gone.' };
      const res = kv === localMutableKV ? safeSetItem(key, JSON.stringify({ ...r, label: n }), `node type “${n}”`) : (kv.set(key, JSON.stringify({ ...r, label: n })), { ok: true as const });
      if (res.ok && kv === localMutableKV) syncKeys([key]);
      return res;
    }
    case 'shaders': {
      const res = editList(kv, SHADERS_KEY, l => l.map(s => (isObj(s) && s.id === item.id ? { ...s, name: n } : s)), 'shaders');
      if (res.ok && kv === localMutableKV) syncKeys([SHADERS_KEY]);
      return res;
    }
    default: return renamePreset(item.kind!, item.id, n, kv);
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** How deleting is done for the things whose module does more than drop a key (set by the app). */
export const libraryDeleters: Partial<Record<'graph' | 'node', (id: string) => void>> = {};

export function deleteItem(item: LibraryItem, kv: MutableKV = localMutableKV): { result: FileResult; undo: () => void } {
  const { result, undo } = withUndo(() => {
    switch (item.type) {
      case 'graphs':
        if (kv === localMutableKV && libraryDeleters.graph) libraryDeleters.graph(item.id);
        else { kv.remove(GRAPH_PREFIX + item.id); kv.remove(VERSIONS_PREFIX + item.id); }
        return { ok: true };
      case 'nodes':
        if (kv === localMutableKV && libraryDeleters.node) libraryDeleters.node(item.id);
        else kv.remove(USER_NODE_PREFIX + item.id);
        return { ok: true };
      case 'shaders': {
        const r = editList(kv, SHADERS_KEY, l => l.filter(s => !(isObj(s) && s.id === item.id)), 'shaders');
        if (r.ok && kv === localMutableKV) syncKeys([SHADERS_KEY]);
        return r;
      }
      default: return removePreset(item.kind!, item.id, kv);
    }
  }, kv);
  return { result, undo };
}

// ── Export and import ─────────────────────────────────────────────────────────

/** These things as one library.json (utils/library.ts): their keys only, with their folders and versions. */
export function exportItems(items: readonly LibraryItem[], kv: MutableKV = localMutableKV): LibrarySnapshot {
  const presetRefs = items.filter(i => i.kind).map(i => ({ kind: i.kind!, id: i.id }));
  const snap = exportPresets(presetRefs, kv);
  const folders = (parse(snap.items.assetbrowser_folders) ?? {}) as Record<string, { folders: unknown[]; membership: Record<string, string> }>;
  const store = (parse(kv.get('assetbrowser_folders')) ?? {}) as Record<string, { folders?: Array<{ id: string }>; membership?: Record<string, string> }>;
  const addFolder = (scope: string, id: string) => {
    const fid = store[scope]?.membership?.[id];
    const f = fid ? store[scope]?.folders?.find(x => x.id === fid) : undefined;
    if (!f) return;
    const sc = folders[scope] ??= { folders: [], membership: {} };
    sc.membership[id] = fid!;
    if (!sc.folders.some(x => (x as { id?: string }).id === fid)) sc.folders.push(f);
  };
  const shaderIds = new Set<string>();
  for (const it of items) {
    if (it.type === 'graphs') {
      const v = kv.get(GRAPH_PREFIX + it.id);
      if (v == null) continue;
      snap.items[GRAPH_PREFIX + it.id] = v;
      const h = kv.get(VERSIONS_PREFIX + it.id);
      if (h != null) snap.items[VERSIONS_PREFIX + it.id] = h;
      addFolder(GRAPH_FOLDER_SCOPE, it.id);
    } else if (it.type === 'nodes') {
      const v = kv.get(USER_NODE_PREFIX + it.id);
      if (v != null) snap.items[USER_NODE_PREFIX + it.id] = v;
      addFolder(NODE_FOLDER_SCOPE, it.id);
    } else if (it.type === 'shaders') shaderIds.add(it.id);
  }
  if (shaderIds.size) {
    const list = parse(kv.get(SHADERS_KEY));
    const mine = (Array.isArray(list) ? list : []).filter(s => isObj(s) && typeof s.id === 'string' && shaderIds.has(s.id));
    if (mine.length) snap.items[SHADERS_KEY] = JSON.stringify(mine);
  }
  if (Object.keys(folders).length) snap.items.assetbrowser_folders = JSON.stringify(folders);
  else delete snap.items.assetbrowser_folders;
  return snap;
}

export const exportText = (items: readonly LibraryItem[], kv: MutableKV = localMutableKV) => JSON.stringify(exportItems(items, kv), null, 1);

/** The keys of a library.json that only hold things the Library lists (no settings, no presentations). */
export function onlyLibraryThings(text: string): boolean {
  const s = parse(text);
  if (!isSnapshot(s)) return false;
  return Object.keys(s.items).every(k => k === 'assetbrowser_folders' || k.startsWith(USER_NODE_PREFIX) || k === SHADERS_KEY
    || presetKinds().some(d => (d.storage.t === 'prefix' ? k.startsWith(d.storage.prefix) : k === d.storage.key))
    || k.startsWith(VERSIONS_PREFIX) || (k.startsWith(GRAPH_PREFIX) && isObj(parse(s.items[k])) && Array.isArray((parse(s.items[k]) as { nodes?: unknown }).nodes)));
}

/** Bring a Library export (or any library.json) in: new things are added, a taken graph name comes in as “(imported)”; nothing of yours is overwritten. */
export function importText(text: string, kv: MutableKV = localMutableKV): { ok: true; added: number; same: number; kept: number; renamed: string[] } | { ok: false; error: string } {
  const s = parse(text);
  if (!isSnapshot(s) || (s as LibrarySnapshot).kind !== LIBRARY_KIND) return { ok: false, error: 'Not a Playfield library file.' };
  const keys = Object.keys((s as LibrarySnapshot).items);
  const r = importPresets(text, kv);
  if (!r.ok) return r;
  // importPresets ran importLibrary over the whole file: graphs, node types and shaders came in with it.
  const renamed = r.renamed;
  if (kv === localMutableKV) syncKeys([...keys, ...renamed.map(n => GRAPH_PREFIX + n)]);
  return { ok: true, added: r.added, same: r.same, kept: r.kept, renamed };
}
