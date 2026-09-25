/**
 * library.ts — everything Shader Studio keeps in this browser, as one thing
 * to export, back up and bring back.
 *
 * A snapshot is every stored key the app owns (saved graphs and their
 * versions, presets, published nodes, palettes, folders, settings) with its
 * value, exactly. An export is a ZIP with the snapshot as `library.json`
 * (what an import reads) next to the same things as readable files in
 * folders (graphs/<folder>/<name>.json, presets, functions…), so a backup can
 * also be browsed, and single files taken out of it.
 *
 * Importing never overwrites: new things are added; a graph whose name is
 * taken comes in as "<name> (imported)" with its versions; a preset or
 * setting you already have is kept as yours; lists (palettes, folders,
 * favourites) are merged. ZIPs from the old Backup button (graphs/presets/
 * functions folders, no library.json) import too.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export const LIBRARY_KIND = 'shader-studio-library';
export const LIBRARY_FILE = 'library.json';

/** The storage a library reads and writes: localStorage in the app, a map in tests. */
export interface KV {
  keys(): string[];
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const localKV: KV = {
  keys: () => { const out: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } return out; },
  get: k => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
};

export interface LibrarySnapshot {
  kind: typeof LIBRARY_KIND;
  version: 1;
  savedAt: number;
  items: Record<string, string>;
}

/** Keys Shader Studio stores without its prefix. */
const EXTRA_KEYS = new Set(['nodepalette_favorites', 'fn_builder_groups_v1', 'fn_builder_saved_fns_v1', 'assetbrowser_folders', 'codePanel_height']);
const GRAPH_PREFIX = 'shader-studio:';
const VERSIONS_PREFIX = 'shader-studio-versions:';

/** Stored under a prefix: what it is, where it goes in the ZIP, and its folder scope. */
const KINDS: Array<{ prefix: string; dir: string; scope?: string }> = [
  { prefix: 'shader-studio:gp:', dir: 'group presets', scope: 'presets:group' },
  { prefix: 'shader-studio:cfp:', dir: 'functions', scope: 'functions' },
  { prefix: 'shader-studio:ep:', dir: 'expressions' },
  { prefix: 'shader-studio:tp:', dir: 'transforms' },
  { prefix: 'shader-studio:kfp:', dir: 'keyframe presets' },
  { prefix: 'shader-studio:un:', dir: 'published nodes' },
];
const NAMED_FILES: Record<string, string> = {
  'shader-studio:palette-presets': 'palettes.json',
  'shader-studio:glsl-shaders': 'glsl shaders.json',
};

export function isLibraryKey(key: string): boolean {
  return key.startsWith('shader-studio') || EXTRA_KEYS.has(key);
}

function parse(v: string | null | undefined): unknown {
  if (v == null) return undefined;
  try { return JSON.parse(v); } catch { return undefined; }
}

/** A saved graph: `shader-studio:<name>` holding a graph (not a preset or a setting). */
export function isGraphKey(key: string, value: string | null): boolean {
  if (!key.startsWith(GRAPH_PREFIX) || KINDS.some(k => key.startsWith(k.prefix)) || key in NAMED_FILES) return false;
  if (/^shader-studio:(settings|play|osc|theme|shortcuts|minimap|glsl-editor)\b/.test(key)) return false;
  const p = parse(value) as { nodes?: unknown } | undefined;
  return !!p && Array.isArray(p.nodes);
}

export function takeSnapshot(kv: KV = localKV): LibrarySnapshot {
  const items: Record<string, string> = {};
  for (const k of kv.keys()) {
    if (!isLibraryKey(k)) continue;
    const v = kv.get(k);
    if (v != null) items[k] = v;
  }
  return { kind: LIBRARY_KIND, version: 1, savedAt: Date.now(), items };
}

/** How much is in a snapshot, for the UI ("12 graphs · 30 presets"). */
export function describeSnapshot(s: LibrarySnapshot): { graphs: number; presets: number; nodes: number; other: number } {
  let graphs = 0, presets = 0, nodes = 0, other = 0;
  for (const [k, v] of Object.entries(s.items)) {
    if (isGraphKey(k, v)) graphs++;
    else if (k.startsWith('shader-studio:un:')) nodes++;
    else if (KINDS.some(x => k.startsWith(x.prefix))) presets++;
    else if (!k.startsWith(VERSIONS_PREFIX)) other++;
  }
  return { graphs, presets, nodes, other };
}

// ── Export ────────────────────────────────────────────────────────────────────

function safeName(label: string): string {
  return label.trim().replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'unnamed';
}

/** Folder labels and membership for a scope, read from the snapshot's own folder store. */
function folderOf(items: Record<string, string>, scope: string, id: string): string | null {
  const store = parse(items.assetbrowser_folders) as Record<string, { folders?: Array<{ id: string; label: string }>; membership?: Record<string, string> }> | undefined;
  const sc = store?.[scope];
  const fid = sc?.membership?.[id];
  const label = fid ? sc?.folders?.find(f => f.id === fid)?.label : undefined;
  return label ? safeName(label) : null;
}

/** The readable side of an export: path → content, next to library.json. */
export function readableFiles(s: LibrarySnapshot): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (path: string, content: string) => {
    let p = path, n = 2;
    while (p in out) p = path.replace(/(\.json)?$/, ` (${n++})$1`);
    out[p] = content;
  };
  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.items)) {
    if (isGraphKey(k, v)) {
      const name = k.slice(GRAPH_PREFIX.length);
      const folder = folderOf(s.items, 'graphs', name);
      put(`graphs/${folder ? `${folder}/` : ''}${safeName(name)}.json`, v);
      const history = parse(s.items[VERSIONS_PREFIX + name]);
      if (Array.isArray(history)) {
        for (const h of history as Array<{ version?: number; payload?: string }>) {
          if (typeof h?.payload === 'string') put(`graphs/${folder ? `${folder}/` : ''}${safeName(name)} (versions)/v${h.version ?? '?'}.json`, h.payload);
        }
      }
      continue;
    }
    if (k.startsWith(VERSIONS_PREFIX)) continue;
    const kind = KINDS.find(x => k.startsWith(x.prefix));
    if (kind) {
      const id = k.slice(kind.prefix.length);
      const p = parse(v) as { label?: string; name?: string } | undefined;
      const folder = kind.scope ? folderOf(s.items, kind.scope, id) : null;
      put(`${kind.dir}/${folder ? `${folder}/` : ''}${safeName(p?.label ?? p?.name ?? id)}.json`, v);
      continue;
    }
    if (NAMED_FILES[k]) { put(NAMED_FILES[k], v); continue; }
    settings[k] = parse(v) ?? v;
  }
  if (Object.keys(settings).length) put('settings.json', JSON.stringify(settings, null, 2));
  return out;
}

const README = `Shader Studio library

library.json is the whole library: import this ZIP (or just library.json) in
Shader Studio (Preferences → Library → Import) to bring everything back.

The folders are the same things as separate files, to look through or to
share one at a time: a graph file opens with Import in Shader Studio.
`;

export function libraryZipName(at = new Date()): string {
  const d = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  return `Shader Studio library ${d}.zip`;
}

/** The export ZIP: `<root>/library.json`, `<root>/README.txt` and the readable files. */
export function buildLibraryZip(s: LibrarySnapshot, root = libraryZipName(new Date(s.savedAt)).replace(/\.zip$/, '')): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [`${root}/${LIBRARY_FILE}`]: strToU8(JSON.stringify(s)),
    [`${root}/README.txt`]: strToU8(README),
  };
  for (const [p, c] of Object.entries(readableFiles(s))) files[`${root}/${p}`] = strToU8(c);
  return zipSync(files, { level: 6 });
}

// ── Import ────────────────────────────────────────────────────────────────────

export function isSnapshot(v: unknown): v is LibrarySnapshot {
  const s = v as LibrarySnapshot | undefined;
  return !!s && s.kind === LIBRARY_KIND && !!s.items && typeof s.items === 'object';
}

/**
 * Read a library from an exported ZIP, a library.json, or a ZIP from the old
 * Backup button (graphs/, presets/, functions/ folders of loose files).
 */
export function readLibrary(bytes: Uint8Array): LibrarySnapshot {
  const isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    const v = parse(strFromU8(bytes));
    if (isSnapshot(v)) return v;
    throw new Error('Not a Shader Studio library (export one with “Export everything”)');
  }
  const files = unzipSync(bytes);
  const lib = Object.keys(files).find(p => p.endsWith(LIBRARY_FILE));
  if (lib) {
    const v = parse(strFromU8(files[lib]));
    if (isSnapshot(v)) return v;
  }
  // The old Backup ZIP: loose files by kind.
  const items: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) {
    if (!path.endsWith('.json')) continue;
    const text = strFromU8(data);
    const v = parse(text) as { id?: string; nodes?: unknown } | undefined;
    if (!v) continue;
    const base = path.split('/').pop()!.replace(/\.json$/, '');
    if (/(^|\/)graphs\//.test(path) && Array.isArray(v.nodes)) items[GRAPH_PREFIX + base] = text;
    else if (/(^|\/)presets\//.test(path) && typeof v.id === 'string') items[`shader-studio:gp:${v.id}`] = text;
    else if (/(^|\/)functions\//.test(path) && typeof v.id === 'string') items[`shader-studio:cfp:${v.id}`] = text;
  }
  if (Object.keys(items).length === 0) throw new Error('No Shader Studio graphs or presets in that ZIP');
  return { kind: LIBRARY_KIND, version: 1, savedAt: 0, items };
}

/** Lists and maps merge: union by id (or by value), yours winning where both have one. */
export function mergeJson(mine: unknown, theirs: unknown): unknown {
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const idOf = (x: unknown) => (x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : null);
    const out = [...mine];
    const ids = new Set(mine.map(idOf).filter(Boolean));
    const seen = new Set(mine.map(x => JSON.stringify(x)));
    for (const t of theirs) {
      const id = idOf(t);
      if (id ? ids.has(id) : seen.has(JSON.stringify(t))) continue;
      out.push(t);
    }
    return out;
  }
  if (mine && theirs && typeof mine === 'object' && typeof theirs === 'object' && !Array.isArray(mine) && !Array.isArray(theirs)) {
    const out: Record<string, unknown> = { ...(mine as Record<string, unknown>) };
    for (const [k, v] of Object.entries(theirs as Record<string, unknown>)) out[k] = k in out ? mergeJson(out[k], v) : v;
    return out;
  }
  return mine;
}

export interface ImportResult {
  added: number;
  /** Graphs whose name was taken, brought in as "<name> (imported)". */
  renamed: string[];
  /** Things you already had a different copy of; yours was kept. */
  kept: number;
  /** Already here, identical. */
  same: number;
}

/** Merge a library into storage. Never overwrites anything of yours. */
export function importLibrary(s: LibrarySnapshot, kv: KV = localKV): ImportResult {
  const r: ImportResult = { added: 0, renamed: [], kept: 0, same: 0 };
  const has = (k: string) => kv.get(k) != null;
  const free = (name: string) => {
    let n = `${name} (imported)`, i = 2;
    while (has(GRAPH_PREFIX + n)) n = `${name} (imported ${i++})`;
    return n;
  };
  const renamedTo = new Map<string, string>();
  for (const [k, v] of Object.entries(s.items)) {
    if (!isLibraryKey(k) || k.startsWith(VERSIONS_PREFIX) || k === 'assetbrowser_folders') continue;
    const mine = kv.get(k);
    if (isGraphKey(k, v)) {
      const name = k.slice(GRAPH_PREFIX.length);
      if (mine == null) {
        kv.set(k, v);
        const hist = s.items[VERSIONS_PREFIX + name];
        if (hist && !has(VERSIONS_PREFIX + name)) kv.set(VERSIONS_PREFIX + name, hist);
        r.added++;
      } else if (mine === v) r.same++;
      else {
        const n = free(name);
        kv.set(GRAPH_PREFIX + n, v);
        const hist = s.items[VERSIONS_PREFIX + name];
        if (hist) kv.set(VERSIONS_PREFIX + n, hist);
        renamedTo.set(name, n);
        r.renamed.push(n);
      }
      continue;
    }
    if (mine == null) { kv.set(k, v); r.added++; continue; }
    if (mine === v) { r.same++; continue; }
    // Lists (palettes, favourites, saved functions, GLSL shaders): merge; one-off things (a preset, a setting): keep yours.
    const a = parse(mine), b = parse(v);
    if (Array.isArray(a) && Array.isArray(b)) {
      const merged = JSON.stringify(mergeJson(a, b));
      if (merged !== mine) { kv.set(k, merged); r.added++; } else r.same++;
    } else r.kept++;
  }
  // Folders: theirs join yours, and a renamed graph keeps its folder.
  const theirFolders = parse(s.items.assetbrowser_folders) as Record<string, { folders?: unknown[]; membership?: Record<string, string> }> | undefined;
  if (theirFolders) {
    for (const [from, to] of renamedTo) {
      const m = theirFolders.graphs?.membership;
      if (m && m[from]) m[to] = m[from];
    }
    const merged = mergeJson(parse(kv.get('assetbrowser_folders')) ?? {}, theirFolders);
    kv.set('assetbrowser_folders', JSON.stringify(merged));
  }
  return r;
}

/** Events the lists listen for, so imported things show up without a reload where possible. */
export const LIBRARY_REFRESH_EVENTS = ['saved-graphs-changed', 'assetbrowser-folders-changed', 'customfn-changed', 'exprpreset-changed', 'transformpreset-changed', 'keyframepreset-changed'];

// ── Stats ─────────────────────────────────────────────────────────────────────

export type LibraryKind = 'graphs' | 'versions' | 'group presets' | 'functions' | 'expressions' | 'transforms' | 'keyframe presets' | 'published nodes' | 'palettes' | 'glsl shaders' | 'settings';

export interface LibraryStats {
  /** Per kind: how many and how much space (characters, about bytes: saved work is mostly plain text). */
  kinds: Record<LibraryKind, { count: number; size: number }>;
  /** Saved graphs that carry a Play setup (controls, mappings or layers). */
  playSetups: number;
  total: number;
}

/** Most browsers give a site about 5 million characters of this storage; when it's full, saving fails. */
export const STORAGE_LIMIT = 5 * 1024 * 1024;

export function libraryStats(s: LibrarySnapshot): LibraryStats {
  const kinds = Object.fromEntries((['graphs', 'versions', 'group presets', 'functions', 'expressions', 'transforms', 'keyframe presets', 'published nodes', 'palettes', 'glsl shaders', 'settings'] as LibraryKind[]).map(k => [k, { count: 0, size: 0 }])) as LibraryStats['kinds'];
  let playSetups = 0, total = 0;
  for (const [k, v] of Object.entries(s.items)) {
    const size = k.length + v.length;
    total += size;
    let kind: LibraryKind, count = 1;
    if (isGraphKey(k, v)) {
      kind = 'graphs';
      const p = parse(v) as { play?: { controls?: unknown[]; mappings?: unknown[]; layers?: unknown[] } } | undefined;
      if (p?.play && ((p.play.controls?.length ?? 0) + (p.play.mappings?.length ?? 0) + (p.play.layers?.length ?? 0)) > 0) playSetups++;
    } else if (k.startsWith(VERSIONS_PREFIX)) {
      kind = 'versions';
      const h = parse(v);
      count = Array.isArray(h) ? h.length : 0;
    } else if (k === 'shader-studio:palette-presets' || k === 'shader-studio:glsl-shaders') {
      kind = k === 'shader-studio:palette-presets' ? 'palettes' : 'glsl shaders';
      const a = parse(v);
      count = Array.isArray(a) ? a.length : 0;
    } else {
      const found = KINDS.find(x => k.startsWith(x.prefix));
      kind = found ? found.dir as LibraryKind : 'settings';
    }
    kinds[kind].count += count;
    kinds[kind].size += size;
  }
  return { kinds, playSetups, total };
}

/** "12 KB", "1.4 MB" */
export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
