/**
 * library.ts — everything Playfield keeps in this browser, as one thing
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
 * favourites) are merged. A presentation is checked (parsePresentation) and,
 * when its name is taken by a different one, comes in as "<name> (2)".
 * ZIPs from the old Backup button (graphs/presets/functions folders, no
 * library.json), a lone .present.json and ZIPs of them import too.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PRESENTATION_FILE_KIND, parsePresentation, type Presentation } from '../types/presentation';
import { fixImportedLinks } from '../present/links';

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

/** Keys Playfield stores without its prefix. */
const EXTRA_KEYS = new Set(['nodepalette_favorites', 'fn_builder_groups_v1', 'fn_builder_saved_fns_v1', 'assetbrowser_folders', 'codePanel_height']);
const GRAPH_PREFIX = 'shader-studio:';
const VERSIONS_PREFIX = 'shader-studio-versions:';
export const PRESENTATION_KEY_PREFIX = 'shader-studio-presentation:';
/** The folder scope of the Present page's list of presentations. */
export const PRESENTATION_FOLDER_SCOPE = 'presentations';

/** Stored under a prefix: what it is, where it goes in the ZIP, and its folder scope. */
const KINDS: Array<{ prefix: string; dir: string; scope?: string }> = [
  { prefix: 'shader-studio:gp:', dir: 'group presets', scope: 'presets:group' },
  { prefix: 'shader-studio:cfp:', dir: 'functions', scope: 'functions' },
  { prefix: 'shader-studio:ep:', dir: 'expressions' },
  { prefix: 'shader-studio:tp:', dir: 'transforms' },
  { prefix: 'shader-studio:kfp:', dir: 'keyframe presets' },
  { prefix: 'shader-studio:un:', dir: 'published nodes' },
  { prefix: PRESENTATION_KEY_PREFIX, dir: 'presentations', scope: PRESENTATION_FOLDER_SCOPE },
];
/** Background palettes (lib/backgroundLibrary.ts PALETTES_KEY); their images travel as files beside library.json. */
export const BACKGROUND_PALETTES_KEY = 'shader-studio-backgrounds:palettes';
/** The Finish stack's lists (components/play/finish/finishLibrary.ts, savedLooks.ts): stack presets, custom effects, saved looks. */
export const FINISH_LIST_KEYS = ['shader-studio:finish-presets', 'shader-studio:finish-effects', 'shader-studio:finish-looks'];
/** Saved drum kits (play/drumKits.ts). */
export const DRUM_KITS_KEY = 'shader-studio:drum-kits';
/** Saved layer sets and rack presets (play/layerSets.ts, play/rackPresets.ts; docs/presets.md). */
export const PLAY_PRESET_KEYS = ['shader-studio:layer-sets', 'shader-studio:rack-presets'];
const NAMED_FILES: Record<string, string> = {
  'shader-studio:palette-presets': 'palettes.json',
  'shader-studio:finish-presets': 'finish stack presets.json',
  'shader-studio:finish-effects': 'finish effects.json',
  'shader-studio:finish-looks': 'finish looks.json',
  [DRUM_KITS_KEY]: 'drum kits.json',
  'shader-studio:layer-sets': 'layer sets.json',
  'shader-studio:rack-presets': 'rack presets.json',
  [BACKGROUND_PALETTES_KEY]: 'background palettes.json',
  'shader-studio:glsl-shaders': 'glsl shaders.json',
  // Your saved Present themes (present/userThemes.ts USER_THEMES_KEY).
  'shader-studio-present:themes': 'present themes.json',
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
export function describeSnapshot(s: LibrarySnapshot): { graphs: number; presets: number; nodes: number; presentations: number; other: number } {
  let graphs = 0, presets = 0, nodes = 0, presentations = 0, other = 0;
  for (const [k, v] of Object.entries(s.items)) {
    if (isGraphKey(k, v)) graphs++;
    else if (k.startsWith('shader-studio:un:')) nodes++;
    else if (k.startsWith(PRESENTATION_KEY_PREFIX)) presentations++;
    else if (KINDS.some(x => k.startsWith(x.prefix))) presets++;
    else if (!k.startsWith(VERSIONS_PREFIX)) other++;
  }
  return { graphs, presets, nodes, presentations, other };
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
export function readableFiles(s: LibrarySnapshot, folders: Record<string, string> = s.items): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (path: string, content: string) => {
    let p = path, n = 2;
    while (p in out) p = path.replace(/((\.present)?\.json)?$/, ` (${n++})$1`);
    out[p] = content;
  };
  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.items)) {
    if (isGraphKey(k, v)) {
      const name = k.slice(GRAPH_PREFIX.length);
      const folder = folderOf(folders, 'graphs', name);
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
    if (k.startsWith(PRESENTATION_KEY_PREFIX)) {
      // As the file the Present page downloads (.present.json), so one can be taken out and opened anywhere.
      const name = k.slice(PRESENTATION_KEY_PREFIX.length);
      const folder = folderOf(folders, PRESENTATION_FOLDER_SCOPE, name);
      put(`presentations/${folder ? `${folder}/` : ''}${safeName(name)}.present.json`, presentationFileText(v));
      continue;
    }
    const kind = KINDS.find(x => k.startsWith(x.prefix));
    if (kind) {
      const id = k.slice(kind.prefix.length);
      const p = parse(v) as { label?: string; name?: string } | undefined;
      const folder = kind.scope ? folderOf(folders, kind.scope, id) : null;
      put(`${kind.dir}/${folder ? `${folder}/` : ''}${safeName(p?.label ?? p?.name ?? id)}.json`, v);
      continue;
    }
    if (NAMED_FILES[k]) {
      put(NAMED_FILES[k], v);
      // Saved shaders also as plain .glsl files, one each, so a single shader can be shared or opened elsewhere.
      if (k === 'shader-studio:glsl-shaders') {
        const list = parse(v);
        if (Array.isArray(list)) for (const sh of list as Array<{ name?: string; code?: string; group?: string; note?: string }>) {
          if (typeof sh?.code !== 'string') continue;
          const head = sh.note?.trim() ? `// ${safeName(sh.name ?? 'shader')}\n// ${sh.note.trim().replace(/\n/g, '\n// ')}\n\n` : '';
          put(`glsl shaders/${sh.group?.trim() ? `${safeName(sh.group)}/` : ''}${safeName(sh.name ?? 'shader')}.glsl`, head + sh.code);
        }
      }
      continue;
    }
    settings[k] = parse(v) ?? v;
  }
  if (Object.keys(settings).length) put('settings.json', JSON.stringify(settings, null, 2));
  return out;
}

/** A stored presentation as a `.present.json` file: its kind first, without the imported mark (the reader decides that). */
export function presentationFileText(stored: string): string {
  const p = parse(stored);
  if (!p || typeof p !== 'object') return stored;
  const { origin: _origin, kind: _kind, ...rest } = p as Record<string, unknown>;
  void _origin; void _kind;
  return JSON.stringify({ kind: PRESENTATION_FILE_KIND, ...rest }, null, 1);
}

const README = `Shader Studio library

library.json is the whole library: import this ZIP (or just library.json) in
Playfield (Preferences → Library → Import) to bring everything back.

The folders are the same things as separate files, to look through or to
share one at a time: a graph file opens with Import in Playfield, and a
.present.json file (under presentations/) opens on the Present page.
Image backgrounds are picture files under backgrounds/images/ (their names,
folders and where they were captured from are in backgrounds/images.json).
`;

export function libraryZipName(at = new Date(), what = 'library'): string {
  const d = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  return `Shader Studio ${what} ${d}.zip`;
}

/**
 * The export ZIP: `<root>/library.json`, `<root>/README.txt` and the readable
 * files, plus `extra` binary files (the image backgrounds: backgroundZipFiles
 * in lib/backgroundLibrary.ts), which live in IndexedDB rather than the snapshot.
 */
export function buildLibraryZip(s: LibrarySnapshot, root = libraryZipName(new Date(s.savedAt)).replace(/\.zip$/, ''), extra: Record<string, Uint8Array> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [`${root}/${LIBRARY_FILE}`]: strToU8(JSON.stringify(s)),
    [`${root}/README.txt`]: strToU8(README),
  };
  for (const [p, c] of Object.entries(readableFiles(s))) files[`${root}/${p}`] = strToU8(c);
  for (const [p, b] of Object.entries(extra)) files[`${root}/${p}`] = b;
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
    const one = presentationItem(v);
    if (one) return { kind: LIBRARY_KIND, version: 1, savedAt: 0, items: { [one[0]]: one[1] } };
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
    const pres = presentationItem(v);
    if (pres) {
      let key = pres[0], i = 2;
      while (key in items) key = `${pres[0]} (${i++})`;
      items[key] = pres[1];
      continue;
    }
    const base = path.split('/').pop()!.replace(/\.json$/, '');
    if (/(^|\/)graphs\//.test(path) && Array.isArray(v.nodes)) items[GRAPH_PREFIX + base] = text;
    else if (/(^|\/)presets\//.test(path) && typeof v.id === 'string') items[`shader-studio:gp:${v.id}`] = text;
    else if (/(^|\/)functions\//.test(path) && typeof v.id === 'string') items[`shader-studio:cfp:${v.id}`] = text;
  }
  if (Object.keys(items).length === 0) throw new Error('No Playfield graphs, presets or presentations in that ZIP');
  return { kind: LIBRARY_KIND, version: 1, savedAt: 0, items };
}

/** A `.present.json` file's content as a stored presentation: [key, value], or null when it isn't one. */
function presentationItem(v: unknown): [string, string] | null {
  if (!v || typeof v !== 'object' || (v as { kind?: unknown }).kind !== PRESENTATION_FILE_KIND) return null;
  const p = parsePresentation(v);
  return p ? [PRESENTATION_KEY_PREFIX + p.title, JSON.stringify(p)] : null;
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
  /** Presentations whose name was taken by a different one, brought in as "<name> (2)", "(3)"… */
  renamedPresentations: string[];
  /** Presentations that weren't readable, left out. */
  skipped: number;
  /** Things you already had a different copy of; yours was kept. */
  kept: number;
  /** Already here, identical. */
  same: number;
}

/** `name`, or `name (2)`, `name (3)`… whichever no presentation has. */
export function freePresentationName(name: string, kv: Pick<KV, 'get'>): string {
  const b = name.trim() || 'Untitled presentation';
  if (kv.get(PRESENTATION_KEY_PREFIX + b) == null) return b;
  let i = 2;
  while (kv.get(`${PRESENTATION_KEY_PREFIX}${b} (${i})`) != null) i++;
  return `${b} (${i})`;
}

/** The same presentation, whatever its title, save time or imported mark. */
function samePresentation(mine: Presentation | null, theirs: Presentation): boolean {
  if (!mine) return false;
  const strip = (x: object) => JSON.stringify({ ...x, title: '', updatedAt: 0, origin: undefined, linkedGraphs: undefined });
  return strip(mine) === strip(theirs);
}

/** Merge a library into storage. Never overwrites anything of yours. */
export function importLibrary(s: LibrarySnapshot, kv: KV = localKV): ImportResult {
  const r: ImportResult = { added: 0, renamed: [], renamedPresentations: [], skipped: 0, kept: 0, same: 0 };
  const has = (k: string) => kv.get(k) != null;
  const free = (name: string) => {
    let n = `${name} (imported)`, i = 2;
    while (has(GRAPH_PREFIX + n)) n = `${name} (imported ${i++})`;
    return n;
  };
  const renamedTo = new Map<string, string>();
  const presRenamedTo = new Map<string, string>();
  // Every graph and presentation of the import → its name here, and the ones written (for their links).
  const graphNames = new Map<string, string>(), presNames = new Map<string, string>();
  const wrote = { graphs: [] as string[], presentations: [] as string[] };
  for (const [k, v] of Object.entries(s.items)) {
    if (!isLibraryKey(k) || k.startsWith(VERSIONS_PREFIX) || k === 'assetbrowser_folders') continue;
    const mine = kv.get(k);
    if (k.startsWith(PRESENTATION_KEY_PREFIX)) {
      const name = k.slice(PRESENTATION_KEY_PREFIX.length);
      if (mine === v) { r.same++; presNames.set(name, name); continue; }
      const p = parsePresentation(parse(v));
      if (!p) { r.skipped++; continue; }
      // Script layers from a library are code from somewhere else: they run in a sandboxed frame.
      if (p.sources.some(src => src.bundle.play.layers.some(l => l.kind === 'script'))) p.origin = 'imported';
      if (mine == null) { kv.set(k, JSON.stringify({ ...p, title: name })); r.added++; presNames.set(name, name); wrote.presentations.push(name); continue; }
      // Already here under this name, or as an earlier import's "(2)", "(3)"…
      const same = (key: string) => samePresentation(parsePresentation(parse(kv.get(key))), p);
      let dup = same(k);
      for (let i = 2; !dup && kv.get(`${k} (${i})`) != null; i++) dup = same(`${k} (${i})`);
      if (dup) { r.same++; presNames.set(name, name); continue; }
      const n = freePresentationName(name, kv);
      kv.set(PRESENTATION_KEY_PREFIX + n, JSON.stringify({ ...p, title: n }));
      presRenamedTo.set(name, n);
      presNames.set(name, n); wrote.presentations.push(n);
      r.renamedPresentations.push(n);
      continue;
    }
    if (isGraphKey(k, v)) {
      const name = k.slice(GRAPH_PREFIX.length);
      if (mine == null) {
        kv.set(k, v);
        const hist = s.items[VERSIONS_PREFIX + name];
        if (hist && !has(VERSIONS_PREFIX + name)) kv.set(VERSIONS_PREFIX + name, hist);
        r.added++;
        graphNames.set(name, name); wrote.graphs.push(name);
      } else if (mine === v) { r.same++; graphNames.set(name, name); }
      else {
        const n = free(name);
        kv.set(GRAPH_PREFIX + n, v);
        const hist = s.items[VERSIONS_PREFIX + name];
        if (hist) kv.set(VERSIONS_PREFIX + n, hist);
        renamedTo.set(name, n);
        r.renamed.push(n);
        graphNames.set(name, n); wrote.graphs.push(n);
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
    for (const [from, to] of presRenamedTo) {
      const m = theirFolders[PRESENTATION_FOLDER_SCOPE]?.membership;
      if (m && m[from]) { m[to] = m[from]; delete m[from]; }
    }
    const merged = mergeJson(parse(kv.get('assetbrowser_folders')) ?? {}, theirFolders);
    kv.set('assetbrowser_folders', JSON.stringify(merged));
  }
  // Graphs and presentations linked to each other stay linked under their names here.
  fixImportedLinks(kv, graphNames, presNames, wrote);
  return r;
}

/** Events the lists listen for, so imported things show up without a reload where possible. */
export const LIBRARY_REFRESH_EVENTS = ['finish-library-changed', 'finish-looks-changed', 'backgrounds-changed', 'saved-graphs-changed', 'presentations-changed', 'assetbrowser-folders-changed', 'customfn-changed', 'exprpreset-changed', 'transformpreset-changed', 'keyframepreset-changed'];

// ── Stats ─────────────────────────────────────────────────────────────────────

export type LibraryKind = 'graphs' | 'versions' | 'group presets' | 'functions' | 'expressions' | 'transforms' | 'keyframe presets' | 'published nodes' | 'presentations' | 'palettes' | 'finish' | 'drum kits' | 'play presets' | 'glsl shaders' | 'backgrounds' | 'settings';

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
  const kinds = Object.fromEntries((['graphs', 'versions', 'group presets', 'functions', 'expressions', 'transforms', 'keyframe presets', 'published nodes', 'presentations', 'palettes', 'finish', 'drum kits', 'play presets', 'glsl shaders', 'backgrounds', 'settings'] as LibraryKind[]).map(k => [k, { count: 0, size: 0 }])) as LibraryStats['kinds'];
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
    } else if (k === BACKGROUND_PALETTES_KEY) {
      kind = 'backgrounds';
      const a = parse(v);
      count = Array.isArray(a) ? a.length : 0;
    } else if (FINISH_LIST_KEYS.includes(k) || k === DRUM_KITS_KEY || PLAY_PRESET_KEYS.includes(k)) {
      kind = k === DRUM_KITS_KEY ? 'drum kits' : PLAY_PRESET_KEYS.includes(k) ? 'play presets' : 'finish';
      const a = parse(v);
      count = Array.isArray(a) ? a.length : 0;
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

// ── Downloading part of the library ─────────────────────────────────────

/** Which kind a stored key is (the same buckets as the statistics). */
export function kindOfKey(k: string, v: string): LibraryKind {
  if (isGraphKey(k, v)) return 'graphs';
  if (k.startsWith(VERSIONS_PREFIX)) return 'versions';
  const found = KINDS.find(x => k.startsWith(x.prefix));
  if (found) return found.dir as LibraryKind;
  if (k === 'shader-studio:palette-presets') return 'palettes';
  if (FINISH_LIST_KEYS.includes(k)) return 'finish';
  if (k === DRUM_KITS_KEY) return 'drum kits';
  if (PLAY_PRESET_KEYS.includes(k)) return 'play presets';
  if (k === 'shader-studio:glsl-shaders') return 'glsl shaders';
  if (k === BACKGROUND_PALETTES_KEY) return 'backgrounds';
  return 'settings';
}

/** The sets the Download menu offers: everything, or one kind of thing. */
export type DownloadSetId = 'everything' | 'graphs' | 'presentations' | 'backgrounds' | 'glsl' | 'functions' | 'nodes' | 'presets';
export const DOWNLOAD_SETS: ReadonlyArray<{ id: DownloadSetId; label: string; hint: string; kinds: readonly LibraryKind[] | null }> = [
  { id: 'everything', label: 'Everything', hint: 'The whole library: graphs with their versions, presentations, backgrounds, shaders, functions, nodes, presets and settings', kinds: null },
  { id: 'graphs', label: 'Only graphs', hint: 'Every saved graph as a .json file (with its versions), in its folders', kinds: ['graphs', 'versions'] },
  { id: 'presentations', label: 'Only presentations', hint: 'Every presentation as a .present.json file (with the Plays it shows), in its folders', kinds: ['presentations'] },
  { id: 'backgrounds', label: 'Only backgrounds', hint: 'Image backgrounds as picture files and background palettes, in their folders', kinds: ['backgrounds'] },
  { id: 'glsl', label: 'Only GLSL shaders', hint: 'Every saved shader as a plain .glsl file (notes as a comment at the top), in its folders', kinds: ['glsl shaders'] },
  { id: 'functions', label: 'Only custom functions', hint: 'The Functions library: each preset as a .json file', kinds: ['functions'] },
  { id: 'nodes', label: 'Only published nodes', hint: 'Node types you published from the Builder, as .json files', kinds: ['published nodes'] },
  { id: 'presets', label: 'Only the other presets', hint: 'Group, expression, transform and keyframe presets, palettes, and the Finish stack’s presets, effects and looks', kinds: ['group presets', 'expressions', 'transforms', 'keyframe presets', 'palettes', 'finish', 'drum kits', 'play presets'] },
];

/** The part of a snapshot that is of these kinds (plus the folder store, so folders survive an import). */
export function snapshotOfKinds(s: LibrarySnapshot, kinds: readonly LibraryKind[] | null): LibrarySnapshot {
  if (!kinds) return s;
  const want = new Set(kinds);
  const items: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.items)) if (want.has(kindOfKey(k, v)) || (k === 'assetbrowser_folders' && (want.has('graphs') || want.has('functions') || want.has('group presets') || want.has('presentations') || want.has('backgrounds')))) items[k] = v;
  return { ...s, items };
}

/** How many things a set holds in this snapshot (graphs, shaders, functions… not versions or settings). */
export function countInSet(s: LibrarySnapshot, set: DownloadSetId): number {
  const def = DOWNLOAD_SETS.find(d => d.id === set)!;
  let n = 0;
  for (const [k, v] of Object.entries(s.items)) {
    const kind = kindOfKey(k, v);
    if (def.kinds && !def.kinds.includes(kind)) continue;
    if (kind === 'versions' || kind === 'settings') continue;
    if (kind === 'glsl shaders') { const list = parse(v); n += Array.isArray(list) ? list.length : 0; continue; }
    if (kind === 'palettes' || kind === 'backgrounds' || kind === 'finish') { const list = parse(v); n += Array.isArray(list) ? list.length : 1; continue; }
    n++;
  }
  return n;
}

/** A ZIP of one set: `library.json` restricted to it (importable) plus the readable files of that set, and `extra` files (image backgrounds). */
export function buildSetZip(s: LibrarySnapshot, set: DownloadSetId, extra: Record<string, Uint8Array> = {}): { bytes: Uint8Array; name: string } {
  const def = DOWNLOAD_SETS.find(d => d.id === set)!;
  const part = snapshotOfKinds(s, def.kinds);
  const what = set === 'everything' ? 'library' : set === 'glsl' ? 'GLSL shaders' : set === 'nodes' ? 'published nodes' : set === 'functions' ? 'custom functions' : set;
  const name = libraryZipName(new Date(s.savedAt), what);
  const root = name.replace(/\.zip$/, '');
  const files: Record<string, Uint8Array> = {
    [`${root}/${LIBRARY_FILE}`]: strToU8(JSON.stringify(part)),
    [`${root}/README.txt`]: strToU8(README),
  };
  const readable = readableFiles(part, s.items);
  for (const [p, c] of Object.entries(readable)) {
    if (def.kinds && p === 'settings.json') continue;
    files[`${root}/${p}`] = strToU8(c);
  }
  for (const [p, b] of Object.entries(extra)) files[`${root}/${p}`] = b;
  return { bytes: zipSync(files, { level: 6 }), name };
}
