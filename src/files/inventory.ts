/**
 * inventory.ts — everything Shader Studio keeps in this browser, as a tree the
 * Files page shows: sections (Graphs, Presentations, GLSL shaders…) holding
 * the user's folders, the things themselves, and what is inside them (a
 * graph's earlier versions and its Play setup: takes, datasets, layer kinds,
 * embedded media; a presentation's Plays and their pictures).
 *
 * Every node says how big it is (characters of stored JSON, which is what the
 * browser's ~5 MB budget counts), when it last changed where that is known,
 * where it is stored (a `StoreRef`, so it can be removed, restored and
 * downloaded), what uses it and what it uses, and a content hash for spotting
 * duplicates. Pure: it reads a KV (localStorage in the app, a map in tests)
 * plus the lists of any external stores (IndexedDB sources, see sources.ts).
 */
import { isLibraryKey, PRESENTATION_FOLDER_SCOPE, PRESENTATION_KEY_PREFIX, type KV } from '../utils/library';
import { GRAPH_LINK_FIELD, normalizeLinks, PRESENTATION_LINK_FIELD } from '../present/links';
import { describeSetting, groupSettings, settingLabel } from './appSettings';

export type SectionId = 'graphs' | 'presentations' | 'glsl' | 'functions' | 'presets' | 'nodes' | 'scripts' | 'backgrounds' | 'settings';

export const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; hint: string }> = [
  { id: 'graphs', label: 'Graphs', hint: 'Saved graphs, their earlier versions and Play setups' },
  { id: 'presentations', label: 'Presentations', hint: 'Present page lessons and the Plays they show' },
  { id: 'glsl', label: 'GLSL shaders', hint: 'Shaders saved on the GLSL page' },
  { id: 'functions', label: 'Functions', hint: 'Custom function presets and the Builder’s saved functions' },
  { id: 'presets', label: 'Presets', hint: 'Group, expression, transform, keyframe and Palette node presets, the Finish stack’s presets, effects and looks, and drum kits' },
  { id: 'nodes', label: 'Published nodes', hint: 'Node types you published from a group or code' },
  { id: 'scripts', label: 'Scripts', hint: 'Saved sketches and layer kinds' },
  { id: 'backgrounds', label: 'Backgrounds', hint: 'The backgrounds library: images and palettes' },
  { id: 'settings', label: 'Settings', hint: 'Folders, learned roles, sign-ins and app settings' },
];

export type NodeKind =
  | 'section' | 'group' | 'folder'
  | 'graph' | 'versions' | 'version' | 'play' | 'takes' | 'take' | 'datasets' | 'dataset' | 'media' | 'layerKinds' | 'layerKind'
  | 'presentation' | 'source'
  | 'shader' | 'function' | 'builderFn' | 'preset' | 'node' | 'script' | 'palette' | 'background' | 'setting';

/**
 * Where a thing is stored.
 *   key       a whole localStorage key
 *   part      inside a key's JSON: at `path`, or (with `match`) the element of the array at `path` whose `field` is `value`
 *   folder    a folder in the folder store (assetbrowser_folders)
 *   external  an item of an external store (sources.ts), by id
 */
export type StoreRef =
  | { t: 'key'; key: string }
  | { t: 'part'; key: string; path: Array<string | number>; match?: { field: string; value: string | number } }
  | { t: 'folder'; scope: string; folderId: string }
  | { t: 'external'; source: string; id: string };

export interface UsedBy {
  /** The node that uses it (for jumping there), when it has one. */
  id?: string;
  label: string;
  /** Where in it: "Step 3", "2 Custom function nodes". */
  where?: string;
  /** Removing this breaks that (a published node a graph is built from); otherwise that keeps its own copy. */
  breaks?: boolean;
}

export interface FileNode {
  id: string;
  section: SectionId;
  kind: NodeKind;
  label: string;
  /** One short line: "v7 · 24 nodes · Play". */
  detail?: string;
  /** Characters of stored JSON (≈ bytes of the browser's budget). */
  size: number;
  modified?: number;
  children?: FileNode[];
  /** Where it lives; absent on containers that aren't stored as one thing (a section, a group). */
  ref?: StoreRef;
  /** Stored alongside it and removed with it (a graph's history). */
  extraRefs?: StoreRef[];
  /** Its folder membership entry, dropped when it is removed. */
  membership?: { scope: string; id: string };
  /** Folder scope a folder or group node's user folders belong to (for “New folder”). */
  scope?: string;
  usedBy?: UsedBy[];
  /** Node ids it needs (a graph's published nodes) or came from (a presentation's graphs). */
  uses?: string[];
  /** Content hash, for spotting duplicates (items only). */
  hash?: string;
  /** Part of an item (a version, a take, a dataset…): downloadable only with its item. */
  part?: boolean;
  /** Why nothing uses it (datasets, media, presentation sources). */
  unused?: string;
  /** Kept out of downloads (sign-ins). */
  private?: boolean;
  /** A small picture of it (an image background's thumbnail), as a data URL. */
  thumb?: string;
  /** A graph's linked presentations, or a presentation's linked graphs, by name (present/links.ts). */
  linked?: string[];
  /** The tree shows it as one row and doesn't open it (App settings: its own view lists what's inside). */
  treeLeaf?: boolean;
}

export interface Inventory {
  sections: FileNode[];
  byId: Map<string, FileNode>;
  parentOf: Map<string, string>;
  /** Characters in keys Shader Studio owns. */
  total: number;
  /** Characters in other keys on this origin (still count against the budget). */
  other: number;
  /** Bytes in external stores (IndexedDB), when listed. */
  external: number;
  /** Of which, per section (a section's size counts them; the localStorage budget doesn't). */
  externalBySection: Partial<Record<SectionId, number>>;
}

/** An external store's items, listed ahead of building (sources.ts). */
export interface ExternalListing {
  source: string;
  section: SectionId;
  group: string;
  /** Its folder scope in the folder store, when its items can sit in folders. */
  folderScope?: string;
  /** The JSON field saved things point at its items with ("libraryId"), for Used by. */
  refField?: string;
  /** Saved things point at its items (a Video layer's file) rather than keeping a copy: removing one breaks them. */
  refIsLink?: boolean;
  items: Array<{ id: string; label: string; size: number; modified?: number; detail?: string; hash?: string; thumb?: string }>;
}

// ── Keys ────────────────────────────────────────────────────────────────────

export const GRAPH_PREFIX = 'shader-studio:';
export const VERSIONS_PREFIX = 'shader-studio-versions:';
export const GLSL_KEY = 'shader-studio:glsl-shaders';
/** The Studio's Palette node presets. */
export const PALETTES_KEY = 'shader-studio:palette-presets';
/** The Finish stack's lists (components/play/finish/finishLibrary.ts, savedLooks.ts). */
export const FINISH_PRESETS_KEY = 'shader-studio:finish-presets';
export const FINISH_EFFECTS_KEY = 'shader-studio:finish-effects';
export const FINISH_LOOKS_KEY = 'shader-studio:finish-looks';
/** Saved drum kits (play/drumKits.ts). */
export const DRUM_KITS_KEY = 'shader-studio:drum-kits';
/** The backgrounds library's palettes (lib/backgroundLibrary.ts); its images live in IndexedDB (backgroundsSource.ts). */
export const BG_PALETTES_KEY = 'shader-studio-backgrounds:palettes';
export const BG_PALETTE_SCOPE = 'backgrounds:palettes';
export const SCRIPTS_KEY = 'shader-studio:play:savedScripts';
export const LAYER_KINDS_KEY = 'shader-studio:play:layerKinds';
export const FOLDERS_KEY = 'assetbrowser_folders';
export const BUILDER_FNS_KEY = 'fn_builder_saved_fns_v1';
export const BUILDER_GROUPS_KEY = 'fn_builder_groups_v1';
export const ROLES_KEY = 'shader-studio:discover:learned-roles';
export const SHORTCUTS_KEY = 'shader-studio:shortcuts';
/** Sign-ins: shown so they can be removed, never downloaded. */
export const PRIVATE_KEYS = new Set(['shader-studio:kaggle']);

/** Presets stored one per key, by prefix: which group of the Presets section, and their folder scope. */
export const PRESET_PREFIXES: ReadonlyArray<{ prefix: string; group: string; scope?: string; section: SectionId }> = [
  { prefix: 'shader-studio:cfp:', group: 'Custom functions', scope: 'functions', section: 'functions' },
  { prefix: 'shader-studio:gp:', group: 'Group presets', scope: 'presets:group', section: 'presets' },
  { prefix: 'shader-studio:ep:', group: 'Expressions', scope: 'expressions', section: 'presets' },
  { prefix: 'shader-studio:tp:', group: 'Transforms', scope: 'presets:transform', section: 'presets' },
  { prefix: 'shader-studio:kfp:', group: 'Keyframe presets', section: 'presets' },
];
export const NODE_PREFIX = 'shader-studio:un:';

/** Keys Shader Studio owns: the library's, plus the editor's own view state. */
export function isOwnedKey(k: string): boolean {
  return isLibraryKey(k) || k.startsWith('playfield:') || k.startsWith('glsl-editor:');
}

/** A saved graph: `shader-studio:<name>` whose value has a `nodes` array (and isn't a preset or a setting). */
export function isGraphEntry(key: string, parsed: unknown): boolean {
  if (!key.startsWith(GRAPH_PREFIX) || key.startsWith(NODE_PREFIX) || PRESET_PREFIXES.some(p => key.startsWith(p.prefix))) return false;
  if (key === GLSL_KEY || key === PALETTES_KEY || key === FINISH_PRESETS_KEY || key === FINISH_EFFECTS_KEY || key === FINISH_LOOKS_KEY || key === DRUM_KITS_KEY || /^shader-studio:(settings|play|osc|theme|shortcuts|minimap|glsl-editor)\b/.test(key)) return false;
  return !!parsed && typeof parsed === 'object' && Array.isArray((parsed as { nodes?: unknown }).nodes);
}

export { settingLabel };

/** The App settings group's id (inside the Settings section): the Files page shows it as its own view. */
export const APP_SETTINGS_ID = 'section:settings/app';

// ── Helpers ─────────────────────────────────────────────────────────────────

export function parseJson(v: string | null | undefined): unknown {
  if (v == null) return undefined;
  try { return JSON.parse(v); } catch { return undefined; }
}

/** FNV-1a, 32-bit, hex: cheap and good enough to spot identical content. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A value without the fields that change on every save, for comparing content. */
function contentOf(v: unknown, drop: string[]): string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return JSON.stringify(v);
  const o = { ...(v as Record<string, unknown>) };
  for (const d of drop) delete o[d];
  return JSON.stringify(o);
}

const size = (v: unknown) => (typeof v === 'string' ? v.length : JSON.stringify(v)?.length ?? 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface FolderScope { folders: Array<{ id: string; label: string; createdAt?: number }>; membership: Record<string, string> }
function readFolders(kv: KV): Record<string, FolderScope> {
  const raw = obj(parseJson(kv.get(FOLDERS_KEY))) ?? {};
  const out: Record<string, FolderScope> = {};
  for (const [scope, v] of Object.entries(raw)) {
    const o = obj(v);
    out[scope] = {
      folders: arr(o?.folders).map(obj).filter((f): f is Obj => !!f && typeof f.id === 'string').map(f => ({ id: f.id as string, label: str(f.label) ?? 'Folder', createdAt: num(f.createdAt) })),
      membership: Object.fromEntries(Object.entries(obj(o?.membership) ?? {}).filter(([, x]) => typeof x === 'string')) as Record<string, string>,
    };
  }
  return out;
}

/** Wrap items into the user's folders for a scope (folders first, then loose items), sizes summed. */
function inFolders(section: SectionId, parentId: string, scope: string | undefined, items: FileNode[], folders: Record<string, FolderScope>, idOf: (n: FileNode) => string | undefined): FileNode[] {
  const sc = scope ? folders[scope] : undefined;
  if (!sc || sc.folders.length === 0) return items;
  const byFolder = new Map<string, FileNode[]>();
  const loose: FileNode[] = [];
  for (const it of items) {
    const id = idOf(it);
    const fid = id != null ? sc.membership[id] : undefined;
    if (fid && sc.folders.some(f => f.id === fid)) { const l = byFolder.get(fid) ?? []; l.push(it); byFolder.set(fid, l); }
    else loose.push(it);
  }
  const folderNodes: FileNode[] = sc.folders.map(f => {
    const children = byFolder.get(f.id) ?? [];
    return {
      id: `${parentId}/folder:${f.id}`, section, kind: 'folder', label: f.label, scope,
      detail: children.length ? plural(children.length, 'item') : 'Empty',
      size: children.reduce((n, c) => n + c.size, 0), modified: f.createdAt,
      children, ref: { t: 'folder', scope: scope!, folderId: f.id },
    };
  });
  return [...folderNodes.sort((a, b) => a.label.localeCompare(b.label)), ...loose];
}

function group(section: SectionId, parentId: string, key: string, label: string, children: FileNode[], extra: Partial<FileNode> = {}): FileNode {
  return {
    id: `${parentId}/${key}`, section, kind: 'group', label, children,
    size: children.reduce((n, c) => n + c.size, 0),
    detail: plural(countLeaves(children), 'item'),
    ...extra,
  };
}

/** Items under a node (folders and groups don't count; an item's own parts don't either). */
export function countLeaves(nodes: FileNode[] | undefined): number {
  let n = 0;
  for (const c of nodes ?? []) n += c.kind === 'folder' || c.kind === 'group' || c.kind === 'section' ? countLeaves(c.children) : 1;
  return n;
}

// ── Embedded media ──────────────────────────────────────────────────────────

interface MediaHit { path: Array<string | number>; owner: Obj; ownerPath: Array<string | number>; src: string }

/** Data URLs inside a value: the string, the object holding it and that object's path. */
function findMedia(root: unknown, base: Array<string | number> = []): MediaHit[] {
  const out: MediaHit[] = [];
  const walk = (v: unknown, path: Array<string | number>, parent: Obj | null, parentPath: Array<string | number>) => {
    if (typeof v === 'string') {
      if (v.length > 200 && v.startsWith('data:') && parent) out.push({ path, owner: parent, ownerPath: parentPath, src: v });
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...path, i], parent, parentPath)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k], v as Obj, path);
  };
  walk(root, base, null, base);
  return out;
}

function mediaType(src: string): string {
  const m = /^data:([a-z]+)\/([a-z0-9.+-]+)/i.exec(src);
  if (!m) return 'File';
  if (m[1] === 'image') return 'Image';
  if (m[1] === 'video') return 'Video';
  if (m[1] === 'audio') return 'Audio';
  if (/midi/.test(m[2])) return 'MIDI file';
  return 'File';
}

/** What a data URL is part of, in words, from where it sits in a play record. */
function mediaPlace(hit: MediaHit, play: Obj | undefined): { label: string; where: string } {
  const p = hit.path.map(String);
  const name = str(hit.owner.name) ?? str(hit.owner.label) ?? '';
  const i = p.indexOf('layers');
  if (p.includes('display')) return { label: name || 'Picture', where: 'the Play picture' };
  if (p.includes('midiFile')) return { label: name || 'MIDI file', where: 'MIDI file' };
  if (i >= 0) {
    const layer = obj(arr(play?.layers)[Number(p[i + 1])]);
    const layerName = str(layer?.name) ?? str(layer?.kind) ?? 'layer';
    if (p.includes('items')) return { label: name || 'Background source', where: `Background “${layerName}”` };
    return { label: name || layerName, where: `${str(layer?.kind) === 'image' ? 'Image' : 'A'} layer “${layerName}”` };
  }
  if (p.includes('poster')) return { label: 'Poster', where: 'still for lists' };
  if (p.includes('media')) return { label: name || str(hit.owner.label) || 'Input file', where: 'a graph input' };
  return { label: name || mediaType(hit.src), where: '' };
}

// ── The build ───────────────────────────────────────────────────────────────

export interface BuildOptions {
  /** Called between items; the page yields to the browser here so a big library never blocks it. */
  pause?: () => Promise<void> | void;
  external?: ExternalListing[];
}

interface GraphInfo { name: string; id: string; raw: string; parsed: Obj; node: FileNode }

export async function buildInventory(kv: KV, opts: BuildOptions = {}): Promise<Inventory> {
  const pause = opts.pause ?? (() => undefined);
  const keys = kv.keys().sort();
  const folders = readFolders(kv);
  let total = 0, other = 0;
  const graphs: GraphInfo[] = [];
  const presentations: Array<{ name: string; raw: string; parsed: Obj; node: FileNode }> = [];
  const perPrefix = new Map<string, FileNode[]>();
  const publishedNodes: FileNode[] = [];
  const settings: FileNode[] = [];
  let finishPresets: FileNode[] = [], finishEffects: FileNode[] = [], finishLooks: FileNode[] = [], drumKits: FileNode[] = [];
  let glsl: FileNode[] = [], palettes: FileNode[] = [], bgPalettes: FileNode[] = [], scripts: FileNode[] = [], kinds: FileNode[] = [], builderFns: FileNode[] = [], builderGroups: FileNode[] = [];
  const installedKinds: Array<{ id: string; node: FileNode }> = [];
  const cfpBodies: Array<{ body: string; node: FileNode }> = [];

  for (const key of keys) {
    const value = kv.get(key);
    if (value == null) continue;
    const s = key.length + value.length;
    if (!isOwnedKey(key)) { other += s; continue; }
    total += s;
    if (key.startsWith(VERSIONS_PREFIX)) continue; // counted with its graph below
    const parsed = parseJson(value);

    if (isGraphEntry(key, parsed)) {
      const name = key.slice(GRAPH_PREFIX.length);
      const node = graphNode(name, value, parsed as Obj, kv.get(VERSIONS_PREFIX + name));
      graphs.push({ name, id: node.id, raw: value, parsed: parsed as Obj, node });
    } else if (key.startsWith(PRESENTATION_KEY_PREFIX)) {
      const name = key.slice(PRESENTATION_KEY_PREFIX.length);
      const node = presentationNode(name, key, value, obj(parsed));
      presentations.push({ name, raw: value, parsed: obj(parsed) ?? {}, node });
    } else if (key.startsWith(NODE_PREFIX)) {
      const p = obj(parsed);
      const id = key.slice(NODE_PREFIX.length);
      publishedNodes.push({
        id: `node:${id}`, section: 'nodes', kind: 'node', label: str(p?.label) ?? id, size: s, modified: num(p?.savedAt),
        detail: [str(p?.category), `${arr(p?.inputs).length} in · ${arr(p?.outputs).length} out`].filter(Boolean).join(' · '),
        ref: { t: 'key', key }, hash: hashText(contentOf(p, ['savedAt'])),
      });
    } else if (PRESET_PREFIXES.some(x => key.startsWith(x.prefix))) {
      const def = PRESET_PREFIXES.find(x => key.startsWith(x.prefix))!;
      const p = obj(parsed);
      const id = key.slice(def.prefix.length);
      const isFn = def.section === 'functions';
      const node: FileNode = {
        id: `${isFn ? 'fn' : 'preset'}:${key.slice('shader-studio:'.length)}`, section: def.section, kind: isFn ? 'function' : 'preset',
        label: str(p?.label) ?? id, size: s, modified: num(p?.savedAt), ref: { t: 'key', key },
        detail: isFn ? `${arr(p?.inputs).length ? plural(arr(p?.inputs).length, 'input') : 'No inputs'} → ${str(p?.outputType) ?? '?'}` : str(p?.description),
        hash: hashText(contentOf(p, ['id', 'savedAt', 'label'])),
        ...(def.scope ? { membership: { scope: def.scope, id } } : {}),
      };
      if (isFn && typeof p?.body === 'string' && p.body.trim().length >= 8) cfpBodies.push({ body: p.body, node });
      const l = perPrefix.get(def.prefix) ?? []; l.push(node); perPrefix.set(def.prefix, l);
    } else if (key === GLSL_KEY) {
      glsl = arr(parsed).map(obj).filter((x): x is Obj => !!x).map((sh, i) => {
        const id = str(sh.id) ?? String(i);
        const code = str(sh.code) ?? '';
        return {
          id: `glsl:${id}`, section: 'glsl' as const, kind: 'shader' as const, label: str(sh.name) || 'Untitled shader', size: size(sh),
          detail: [`${code.split('\n').length} lines`, str(sh.note)?.split('\n')[0]].filter(Boolean).join(' · '),
          ref: { t: 'part' as const, key, path: [], match: typeof sh.id === 'string' ? { field: 'id', value: sh.id } : { field: 'name', value: str(sh.name) ?? '' } },
          hash: hashText(code), glslGroup: str(sh.group)?.trim() ?? '',
        } as FileNode & { glslGroup: string };
      });
    } else if (key === FINISH_PRESETS_KEY) {
      finishPresets = listItems(key, parsed, 'presets', 'preset', 'fstack', x => { const fx = arr(obj(x.finish)?.effects).map(obj); return fx.length ? fx.map(e => (str(e?.kind) === 'custom' ? str(e?.name) ?? 'Custom' : str(e?.kind) ?? '?')).join(', ') : 'Empty'; });
    } else if (key === FINISH_EFFECTS_KEY) {
      finishEffects = listItems(key, parsed, 'presets', 'preset', 'feffect', x => [x.sealed ? 'Sealed' : `${(str(x.code) ?? '').split('\n').length} lines`, str(x.pack) ? `from ${str(x.pack)}` : ''].filter(Boolean).join(' · '));
    } else if (key === FINISH_LOOKS_KEY) {
      finishLooks = listItems(key, parsed, 'presets', 'preset', 'flook', x => `${Object.keys(obj(x.values) ?? {}).length} settings${str(x.tone) && str(x.tone) !== 'none' ? ` · ${str(x.tone)}` : ''}`);
    } else if (key === DRUM_KITS_KEY) {
      drumKits = listItems(key, parsed, 'presets', 'preset', 'dkit', x => { const pads = arr(x.pads).map(obj).filter(p => p && (p.sampleId || p.synth)); const samples = new Set(pads.map(p => str(p?.sampleId)).filter(Boolean)).size; const fx = arr(obj(x.fx)?.effects).length; return `${plural(pads.length, 'pad')} · ${samples ? plural(samples, 'sample') : 'generated drums'}${fx ? ` · ${plural(fx, 'effect')}` : ''}`; });
    } else if (key === PALETTES_KEY) {
      palettes = listItems(key, parsed, 'presets', 'palette', 'palette', x => `${str(x.kind) === 'stops' ? `${arr(x.stops).length} stops` : 'Cosine'}`);
    } else if (key === BG_PALETTES_KEY) {
      bgPalettes = listItems(key, parsed, 'backgrounds', 'palette', 'bgpal', x => `${arr(x.stops).length} colours · ${str(x.style) === 'bands' ? 'bands' : 'gradient'}`);
      for (const n of bgPalettes) if (n.ref?.t === 'part' && n.ref.match) n.membership = { scope: BG_PALETTE_SCOPE, id: String(n.ref.match.value) };
    } else if (key === SCRIPTS_KEY) {
      scripts = listItems(key, parsed, 'scripts', 'script', 'script', x => `${str(x.mode) === '3d' ? '3D' : '2D'} sketch · ${(str(x.code) ?? '').split('\n').length} lines`);
    } else if (key === LAYER_KINDS_KEY) {
      kinds = listItems(key, parsed, 'scripts', 'layerKind', 'kind', x => str(x.hint) || `${arr(x.paramDefs).length} controls`);
      for (const k of kinds) if (k.ref?.t === 'part' && k.ref.match) { k.membership = { scope: 'layerKinds', id: String(k.ref.match.value) }; installedKinds.push({ id: String(k.ref.match.value), node: k }); }
    } else if (key === BUILDER_FNS_KEY) {
      builderFns = listItems(key, parsed, 'functions', 'builderFn', 'bfn', x => `${str(x.returnType) ?? 'float'} · ${str(x.body)?.slice(0, 40) ?? ''}`);
    } else if (key === BUILDER_GROUPS_KEY) {
      builderGroups = listItems(key, parsed, 'functions', 'builderFn', 'bgroup', x => plural(arr(x.tabs).length, 'tab'));
    } else {
      settings.push({
        id: `setting:${key}`, section: 'settings', kind: 'setting', label: settingLabel(key), size: s, ref: { t: 'key', key },
        detail: describeSetting(key).hint ?? key, ...(PRIVATE_KEYS.has(key) ? { private: true } : {}),
      });
    }
    await pause();
  }

  // ── Used by ──
  const graphByName = new Map(graphs.map(g => [g.name, g]));
  for (const g of graphs) {
    // Published nodes a graph is built from: removing one breaks the graph.
    for (const n of publishedNodes) {
      const typeId = n.id.slice('node:'.length);
      const count = g.raw.split(`"type":"${typeId}"`).length - 1;
      if (count > 0) {
        (n.usedBy ??= []).push({ id: g.id, label: g.name, where: plural(count, 'node'), breaks: true });
        (g.node.uses ??= []).push(n.id);
      }
    }
    // Custom functions: graphs keep a copy of the body in their node.
    for (const f of cfpBodies) {
      const needle = JSON.stringify(f.body).slice(1, -1);
      const count = g.raw.split(needle).length - 1;
      if (count > 0) (f.node.usedBy ??= []).push({ id: g.id, label: g.name, where: `${plural(count, 'Custom function node')} (a copy)` });
    }
    // Layer kinds: the play file carries a copy of each kind its layers use.
    const play = obj(g.parsed.play);
    for (const k of arr(play?.layerKinds).map(obj)) {
      const inst = installedKinds.find(x => x.id === k?.id);
      if (!inst) continue;
      const layers = arr(play?.layers).filter(l => obj(l)?.kindId === k?.id).length;
      (inst.node.usedBy ??= []).push({ id: g.id, label: g.name, where: `${plural(layers, 'layer')} (a copy)` });
    }
    // Other graphs shown in this one's Background layer (copied when added).
    for (const l of arr(play?.layers).map(obj)) for (const it of arr(l?.items).map(obj)) {
      const ref = str(it?.graph);
      const other = ref?.startsWith('saved:') ? graphByName.get(ref.slice(6)) : undefined;
      if (other && other !== g) (other.node.usedBy ??= []).push({ id: g.id, label: g.name, where: `Background “${str(l?.name) ?? 'Background'}” (a copy)` });
    }
  }
  for (const p of presentations) {
    const steps = arr(p.parsed.steps).map(obj);
    const stepsUsing = (sourceId: string) => steps.map((st, i) => (arr(st?.blocks).some(b => { const o = obj(b); return o?.source === sourceId || obj(o?.from)?.source === sourceId; }) ? i + 1 : 0)).filter(Boolean);
    for (const src of arr(p.parsed.sources).map(obj)) {
      const from = obj(src?.from);
      const g = from?.kind === 'saved' ? graphByName.get(str(from.name) ?? '') : undefined;
      const used = stepsUsing(str(src?.id) ?? '');
      if (g) {
        (g.node.usedBy ??= []).push({ id: p.node.id, label: p.name, where: used.length ? `${used.length === 1 ? 'Step' : 'Steps'} ${used.join(', ')} (a copy)` : 'A copy, on no step' });
        (p.node.uses ??= []).push(g.id);
      }
      for (const k of arr(obj(obj(src?.bundle)?.play)?.layerKinds).map(obj)) {
        const inst = installedKinds.find(x => x.id === k?.id);
        if (inst) (inst.node.usedBy ??= []).push({ id: p.node.id, label: p.name, where: `Play “${str(src?.title) ?? ''}” (a copy)` });
      }
    }
  }
  // Links between graphs and presentations (present/links.ts), where the other side is still here.
  const presNames = new Set(presentations.map(p => p.name));
  for (const g of graphs) { const l = normalizeLinks(g.parsed[GRAPH_LINK_FIELD]).filter(n => presNames.has(n)); if (l.length) g.node.linked = l; }
  for (const p of presentations) { const l = normalizeLinks(p.parsed[PRESENTATION_LINK_FIELD]).filter(n => graphByName.has(n)); if (l.length) p.node.linked = l; }

  // ── Sections ──
  const sectionNode = (id: SectionId, children: FileNode[]): FileNode => {
    const def = SECTIONS.find(s => s.id === id)!;
    const n = countLeaves(children);
    return { id: `section:${id}`, section: id, kind: 'section', label: def.label, detail: n ? plural(n, 'item') : 'Nothing saved', size: children.reduce((a, c) => a + c.size, 0), children };
  };
  const byName = (a: FileNode, b: FileNode) => a.label.localeCompare(b.label);
  const presetGroup = (prefix: string) => (perPrefix.get(prefix) ?? []).sort(byName);
  const membershipId = (n: FileNode) => n.membership?.id;

  const graphItems = inFolders('graphs', 'section:graphs', 'graphs', graphs.map(g => g.node).sort(byName), folders, membershipId);
  const presItems = inFolders('presentations', 'section:presentations', PRESENTATION_FOLDER_SCOPE, presentations.map(p => p.node).sort(byName), folders, membershipId);

  // GLSL shaders: the list's own groups are its folders.
  const glslGroups = new Map<string, FileNode[]>();
  const glslLoose: FileNode[] = [];
  for (const sh of glsl as Array<FileNode & { glslGroup?: string }>) {
    const g = sh.glslGroup;
    delete sh.glslGroup;
    if (g) { const l = glslGroups.get(g) ?? []; l.push(sh); glslGroups.set(g, l); } else glslLoose.push(sh);
  }
  const glslItems: FileNode[] = [
    ...[...glslGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, children]) => ({
      id: `section:glsl/folder:${label}`, section: 'glsl' as const, kind: 'folder' as const, label, children: children.sort(byName),
      size: children.reduce((n, c) => n + c.size, 0), detail: plural(children.length, 'shader'),
    })),
    ...glslLoose.sort(byName),
  ];

  const cfp = inFolders('functions', 'section:functions/custom', 'functions', presetGroup('shader-studio:cfp:'), folders, membershipId);
  const fnChildren: FileNode[] = [];
  if (cfp.length || folders.functions?.folders.length) fnChildren.push(group('functions', 'section:functions', 'custom', 'Custom function presets', cfp, { scope: 'functions' }));
  if (builderFns.length || builderGroups.length) fnChildren.push(group('functions', 'section:functions', 'builder', 'Function Builder', [
    ...(builderFns.length ? [group('functions', 'section:functions/builder', 'fns', 'Saved functions', builderFns.sort(byName))] : []),
    ...(builderGroups.length ? [group('functions', 'section:functions/builder', 'groups', 'Saved groups', builderGroups.sort(byName))] : []),
  ]));

  const presetChildren: FileNode[] = [];
  for (const def of PRESET_PREFIXES.filter(p => p.section === 'presets')) {
    const items = inFolders('presets', `section:presets/${def.prefix}`, def.scope, presetGroup(def.prefix), folders, membershipId);
    if (items.length) presetChildren.push({ ...group('presets', 'section:presets', def.prefix, def.group, items), id: `section:presets/${def.prefix}`, ...(def.scope ? { scope: def.scope } : {}) });
  }

  if (palettes.length) presetChildren.push(group('presets', 'section:presets', 'palettes', 'Palette node presets', palettes.sort(byName)));
  if (finishPresets.length) presetChildren.push(group('presets', 'section:presets', 'finish-stacks', 'Finish stack presets', finishPresets.sort(byName)));
  if (finishEffects.length) presetChildren.push(group('presets', 'section:presets', 'finish-effects', 'Finish effects (Your effects)', finishEffects.sort(byName)));
  if (finishLooks.length) presetChildren.push(group('presets', 'section:presets', 'finish-looks', 'Finish looks', finishLooks.sort(byName)));
  if (drumKits.length) presetChildren.push(group('presets', 'section:presets', 'drum-kits', 'Drum kits', drumKits.sort(byName)));

  const scriptChildren: FileNode[] = [];
  if (scripts.length) scriptChildren.push(group('scripts', 'section:scripts', 'sketches', 'Saved sketches', scripts.sort(byName)));
  const kindItems = inFolders('scripts', 'section:scripts/kinds', 'layerKinds', kinds.sort(byName), folders, membershipId);
  if (kindItems.length) scriptChildren.push(group('scripts', 'section:scripts', 'kinds', 'Layer kinds', kindItems, { scope: 'layerKinds' }));

  let external = 0;
  const externalSizes: Partial<Record<SectionId, number>> = {};
  const externalBySection = new Map<SectionId, FileNode[]>();
  for (const ext of opts.external ?? []) {
    const items: FileNode[] = ext.items.map(it => {
      const n: FileNode = {
        id: `ext:${ext.source}:${it.id}`, section: ext.section, kind: 'background', label: it.label, size: it.size, modified: it.modified,
        detail: it.detail, hash: it.hash, ref: { t: 'external', source: ext.source, id: it.id }, ...(it.thumb ? { thumb: it.thumb } : {}),
        ...(ext.folderScope ? { membership: { scope: ext.folderScope, id: it.id } } : {}),
      };
      if (ext.refField && ext.refIsLink) {
        // Setups whose layers point at it (a Video layer's file): without it, those layers ask for it again.
        const needle = `"${ext.refField}":${JSON.stringify(it.id)}`;
        const usedBy: UsedBy[] = [];
        const [one, many] = ext.refField === 'sampleId' ? ['A drum pad', 'drum pads'] : ['A Video layer', 'Video layers'];
        const layers = (c: number) => `${c === 1 ? one : `${c} ${many}`}`;
        for (const g of graphs) { const c = g.raw.split(needle).length - 1; if (c) usedBy.push({ id: g.id, label: g.name, where: `${layers(c)} in its Play setup`, breaks: true }); }
        for (const p of presentations) { const c = p.raw.split(needle).length - 1; if (c) usedBy.push({ id: p.node.id, label: p.name, where: `${layers(c)} in a Play in it`, breaks: true }); }
        n.usedBy = usedBy;
        if (!usedBy.length) n.unused = 'No saved Play setup or presentation uses it';
      } else if (ext.refField) {
        // What embedded a copy of it names it beside the copy.
        const needle = `"${ext.refField}":${JSON.stringify(it.id)}`;
        const usedBy: UsedBy[] = [];
        for (const g of graphs) { const c = g.raw.split(needle).length - 1; if (c) usedBy.push({ id: g.id, label: g.name, where: `${c === 1 ? 'Its Play setup' : `${c} places in its Play setup`} (a copy)` }); }
        for (const p of presentations) {
          // Step backgrounds point at a library image (by reference); anything else that names it is a Play's copy.
          const bg = presentationBackgroundUse(p.parsed, ext.refField, it.id);
          const c = p.raw.split(needle).length - 1 - bg.images;
          if (bg.where) usedBy.push({ id: p.node.id, label: p.name, where: bg.where });
          if (c > 0) usedBy.push({ id: p.node.id, label: p.name, where: `${c === 1 ? 'A Play in it' : `${c} places in it`} (a copy)` });
        }
        n.usedBy = usedBy;
        if (!usedBy.length) n.unused = 'No Play setup or presentation uses it';
      }
      return n;
    });
    const bytes = items.reduce((n, c) => n + c.size, 0);
    external += bytes;
    externalSizes[ext.section] = (externalSizes[ext.section] ?? 0) + bytes;
    const l = externalBySection.get(ext.section) ?? [];
    const key = `ext:${ext.source}`;
    l.push({ ...group(ext.section, `section:${ext.section}`, key, ext.group, inFolders(ext.section, `section:${ext.section}/${key}`, ext.folderScope, items.sort(byName), folders, membershipId)), ...(ext.folderScope ? { scope: ext.folderScope } : {}) });
    externalBySection.set(ext.section, l);
  }
  const bgChildren: FileNode[] = [...externalBySection.get('backgrounds') ?? []];
  const bgPaletteItems = inFolders('backgrounds', 'section:backgrounds/palettes', BG_PALETTE_SCOPE, bgPalettes.sort(byName), folders, membershipId);
  if (bgPaletteItems.length) bgChildren.push({ ...group('backgrounds', 'section:backgrounds', 'palettes', 'Palettes', bgPaletteItems), scope: BG_PALETTE_SCOPE });

  // App preferences (theme, shortcuts, panel sizes…) sit in one App settings group, by category, after the saved things.
  const prefs = settings.filter(s => ![ROLES_KEY, FOLDERS_KEY].includes((s.ref as { key: string }).key) && !s.private);
  const settingsChildren: FileNode[] = [];
  for (const s of prefs) {
    const key = (s.ref as { key: string }).key;
    s.detail = key === SHORTCUTS_KEY ? plural(Object.keys(obj(parseJson(kv.get(key))) ?? {}).length, 'custom shortcut') : describeSetting(key).hint;
    if (!s.detail) delete s.detail;
  }
  const appCats = groupSettings(prefs.map(n => ({ key: (n.ref as { key: string }).key, size: n.size, node: n })))
    .map(c => group('settings', APP_SETTINGS_ID, c.id, c.label, c.items.map(i => i.node)));
  for (const s of settings) {
    const key = (s.ref as { key: string }).key;
    if (key === FOLDERS_KEY) {
      const all = Object.values(folders).reduce((n, sc) => n + sc.folders.length, 0);
      s.detail = `${plural(all, 'folder')} across ${plural(Object.keys(folders).filter(k => folders[k].folders.length).length, 'list')}`;
      settingsChildren.push(s);
    } else if (key === ROLES_KEY) {
      s.detail = plural(Object.keys(obj(parseJson(kv.get(key))) ?? {}).length, 'learned role');
      settingsChildren.push(s);
    }
  }
  const privates = settings.filter(s => s.private);
  if (privates.length) settingsChildren.push(group('settings', 'section:settings', 'signins', 'Sign-ins', privates, { detail: 'Never downloaded' }));
  if (appCats.length) settingsChildren.push(group('settings', 'section:settings', 'app', 'App settings', appCats, { detail: `${plural(prefs.length, 'preference')} · reset to default here`, treeLeaf: true }));

  const withExternal = (id: SectionId, list: FileNode[]) => (id === 'backgrounds' ? list : [...list, ...externalBySection.get(id) ?? []]);
  const sections: FileNode[] = [
    sectionNode('graphs', withExternal('graphs', graphItems)),
    sectionNode('presentations', withExternal('presentations', presItems)),
    sectionNode('glsl', withExternal('glsl', glslItems)),
    sectionNode('functions', withExternal('functions', fnChildren)),
    sectionNode('presets', withExternal('presets', presetChildren)),
    sectionNode('nodes', withExternal('nodes', publishedNodes.sort(byName))),
    sectionNode('scripts', withExternal('scripts', scriptChildren)),
    sectionNode('backgrounds', bgChildren),
    sectionNode('settings', withExternal('settings', settingsChildren)),
  ];
  for (const s of sections) if (s.id === 'section:functions' || s.id === 'section:presets' || s.id === 'section:scripts') s.scope = undefined;
  sections.find(s => s.section === 'graphs')!.scope = 'graphs';
  sections.find(s => s.section === 'presentations')!.scope = PRESENTATION_FOLDER_SCOPE;

  const byId = new Map<string, FileNode>();
  const parentOf = new Map<string, string>();
  const index = (n: FileNode, parent?: string) => {
    byId.set(n.id, n);
    if (parent) parentOf.set(n.id, parent);
    for (const c of n.children ?? []) index(c, n.id);
  };
  for (const s of sections) index(s);
  return { sections, byId, parentOf, total, other, external, externalBySection: externalSizes };
}

/** Array-stored things (shaders, palettes, sketches, kinds): one node per element, removed by id. */
function listItems(key: string, parsed: unknown, section: SectionId, kind: NodeKind, idPrefix: string, detail: (x: Obj) => string): FileNode[] {
  return arr(parsed).map(obj).filter((x): x is Obj => !!x).map((x, i) => {
    const id = str(x.id) ?? String(i);
    return {
      id: `${idPrefix}:${id}`, section, kind, label: str(x.name) ?? str(x.label) ?? 'Untitled', size: size(x), modified: num(x.savedAt),
      detail: detail(x), ref: { t: 'part' as const, key, path: [], match: typeof x.id === 'string' ? { field: 'id', value: x.id } : { field: 'name', value: str(x.name) ?? '' } },
      hash: hashText(contentOf(x, ['id', 'savedAt', 'name', 'label'])),
    };
  });
}

function graphNode(name: string, raw: string, g: Obj, historyRaw: string | null): FileNode {
  const id = `graph:${name}`;
  const key = GRAPH_PREFIX + name;
  const vkey = VERSIONS_PREFIX + name;
  const children: FileNode[] = [];
  const history = arr(parseJson(historyRaw)).map(obj).filter((v): v is Obj => !!v && typeof v.version === 'number');
  if (history.length) {
    const versions: FileNode[] = history.sort((a, b) => (b.version as number) - (a.version as number)).map(v => ({
      id: `${id}/v:${v.version}`, section: 'graphs', kind: 'version', label: `Version ${v.version}`, part: true,
      detail: str(v.note) || `${arr(obj(parseJson(str(v.payload)))?.nodes).length} nodes`, size: size(v), modified: num(v.savedAt),
      ref: { t: 'part', key: vkey, path: [], match: { field: 'version', value: v.version as number } },
    }));
    children.push({ id: `${id}/versions`, section: 'graphs', kind: 'versions', label: 'Earlier versions', part: true, detail: plural(versions.length, 'version'), size: (historyRaw?.length ?? 0) + vkey.length, children: versions, ref: { t: 'key', key: vkey } });
  }
  const play = obj(g.play);
  const datasets = obj(g.datasets);
  const playKids: FileNode[] = [];
  const takes = arr(play?.takes).map(obj).filter((t): t is Obj => !!t);
  if (takes.length) playKids.push({
    id: `${id}/takes`, section: 'graphs', kind: 'takes', label: 'Takes', part: true, detail: plural(takes.length, 'take'), size: size(play?.takes),
    ref: { t: 'part', key, path: ['play', 'takes'] },
    children: takes.map((t, i) => ({
      id: `${id}/take:${str(t.id) ?? i}`, section: 'graphs' as const, kind: 'take' as const, label: str(t.name) || `Take ${i + 1}`, part: true,
      detail: `${(num(t.length) ?? 0).toFixed(1)} s · ${plural(arr(t.tracks).length, 'track')}`, size: size(t),
      ref: { t: 'part' as const, key, path: ['play', 'takes'], match: { field: 'id', value: str(t.id) ?? '' } },
    })),
  });
  const nodesText = JSON.stringify(g.nodes ?? []);
  const playText = JSON.stringify(play ?? {});
  const dsList = Object.entries(datasets ?? {}).map(([dsId, d]) => ({ dsId, d: obj(d) ?? {} }));
  if (dsList.length) playKids.push({
    id: `${id}/datasets`, section: 'graphs', kind: 'datasets', label: 'Datasets', part: true, detail: plural(dsList.length, 'dataset'), size: size(datasets),
    ref: { t: 'part', key, path: ['datasets'] },
    children: dsList.map(({ dsId, d }) => {
      const nodeUses = nodesText.split(`"dataset":"${dsId}"`).length - 1;
      const playUses = playText.split(`"dataset":"${dsId}"`).length - 1;
      const scriptUses = playText.includes(`data('${str(d.name) ?? '\u0000'}`) || playText.includes(`data(\\"${str(d.name) ?? '\u0000'}`) ? 1 : 0;
      const usedBy: UsedBy[] = [];
      if (nodeUses) usedBy.push({ id, label: name, where: plural(nodeUses, 'Data node'), breaks: true });
      if (playUses) usedBy.push({ id, label: name, where: plural(playUses, 'layer or mapping', 'layers or mappings'), breaks: true });
      if (scriptUses) usedBy.push({ id, label: name, where: 'a Script layer', breaks: true });
      const result = obj(d.result);
      return {
        id: `${id}/dataset:${dsId}`, section: 'graphs' as const, kind: 'dataset' as const, label: str(d.name) || dsId, part: true, size: size(d), modified: num(d.ranAt),
        detail: result?.kind === 'table' ? `${num(result.rows) ?? 0} rows · ${plural(arr(result.columns).length, 'column')}` : str(result?.kind) ?? 'Not run',
        ref: { t: 'part' as const, key, path: ['datasets', dsId] }, usedBy,
        ...(usedBy.length ? {} : { unused: 'No Data node, layer, mapping or script reads it' }),
      };
    }),
  });
  const kinds = arr(play?.layerKinds).map(obj).filter((k): k is Obj => !!k);
  if (kinds.length) playKids.push({
    id: `${id}/kinds`, section: 'graphs', kind: 'layerKinds', label: 'Layer kinds', part: true, detail: plural(kinds.length, 'kind'), size: size(play?.layerKinds),
    children: kinds.map(k => {
      const layers = arr(play?.layers).filter(l => obj(l)?.kindId === k.id).length;
      return {
        id: `${id}/kind:${str(k.id)}`, section: 'graphs' as const, kind: 'layerKind' as const, label: str(k.name) ?? 'Layer kind', part: true, size: size(k),
        detail: layers ? plural(layers, 'layer') : 'No layers', ref: { t: 'part' as const, key, path: ['play', 'layerKinds'], match: { field: 'id', value: str(k.id) ?? '' } },
        usedBy: layers ? [{ id, label: name, where: plural(layers, 'layer'), breaks: true }] : [],
        ...(layers ? {} : { unused: 'No layer is made from it' }),
      };
    }),
  });
  const media = findMedia(play, ['play']);
  if (media.length) {
    const source = str(obj(play?.display)?.source) ?? 'shader';
    playKids.push({
      id: `${id}/media`, section: 'graphs', kind: 'group', label: 'Media', part: true, detail: plural(media.length, 'file'), size: media.reduce((n, m) => n + m.src.length, 0),
      children: media.map(m => {
        const place = mediaPlace(m, play);
        const displayKind = m.path.includes('display') ? String(m.path[m.path.indexOf('display') + 1]) : null;
        const unused = displayKind && (displayKind === 'image' || displayKind === 'video') && displayKind !== source
          ? `Kept from when the Play picture was ${displayKind === 'image' ? 'an image' : 'a video'}; it shows the ${source === 'colour' ? 'colour' : source} now`
          : undefined;
        return {
          id: `${id}/media:${m.path.join('.')}`, section: 'graphs' as const, kind: 'media' as const, label: place.label, part: true,
          detail: [mediaType(m.src), place.where].filter(Boolean).join(' · '), size: m.src.length, hash: hashText(m.src),
          ref: pathRef(key, m.ownerPath),
          usedBy: unused ? [] : [{ id, label: name, where: place.where, breaks: true }],
          ...(unused ? { unused } : {}),
        };
      }),
    });
  }
  if (playKids.length) {
    children.push({
      id: `${id}/play`, section: 'graphs', kind: 'play', label: 'Play setup', part: true, children: playKids,
      detail: [plural(arr(play?.layers).length, 'layer'), plural(arr(play?.controls).length, 'control')].join(' · '), size: size(play) + size(datasets),
    });
  } else if (play && arr(play.layers).length + arr(play.controls).length > 0) {
    children.push({ id: `${id}/play`, section: 'graphs', kind: 'play', label: 'Play setup', part: true, size: size(play), detail: [plural(arr(play.layers).length, 'layer'), plural(arr(play.controls).length, 'control')].join(' · ') });
  }
  const version = num(g.version) ?? 1;
  return {
    id, section: 'graphs', kind: 'graph', label: name,
    detail: [`v${version}`, plural(arr(g.nodes).length, 'node'), play && (arr(play.layers).length || arr(play.controls).length) ? 'Play' : ''].filter(Boolean).join(' · '),
    size: key.length + raw.length + (historyRaw ? vkey.length + historyRaw.length : 0), modified: num(g.savedAt),
    ref: { t: 'key', key }, ...(historyRaw ? { extraRefs: [{ t: 'key', key: vkey }] } : {}), membership: { scope: 'graphs', id: name },
    hash: hashText(JSON.stringify([g.nodes, g.looseGroups ?? null, g.play ?? null, g.datasets ?? null])),
    children: children.length ? children : undefined,
  };
}

/** A ref to the object at `path` inside a key: an array element by its id when it has one, else the path. */
function pathRef(key: string, path: Array<string | number>): StoreRef {
  const last = path[path.length - 1];
  return { t: 'part', key, path: typeof last === 'number' ? path.slice(0, -1) : path, ...(typeof last === 'number' ? { match: { field: '#', value: last } } : {}) };
}

/**
 * Where a presentation shows a library image as a background: its images
 * that name the id (`images` counts them, to tell them from Plays' copies)
 * and the steps and default that use those ("Background of steps 1, 3").
 */
export function presentationBackgroundUse(p: Obj, field: string, id: string): { images: number; where: string } {
  const imgs = arr(p.images).map(obj).filter((x): x is Obj => !!x && x[field] === id);
  if (!imgs.length) return { images: 0, where: '' };
  const ids = new Set(imgs.map(x => str(x.id)));
  const steps = arr(p.steps).map((st, i) => (ids.has(str(obj(obj(st)?.background)?.image)) ? i + 1 : 0)).filter(Boolean);
  const byDefault = ids.has(str(obj(obj(obj(p.style)?.background))?.image));
  const parts = [byDefault ? 'the default background' : '', steps.length ? `the background of step${steps.length === 1 ? '' : 's'} ${steps.join(', ')}` : ''].filter(Boolean);
  const where = parts.length ? parts.join(' and ') : 'a background no step shows';
  return { images: imgs.length, where: where[0].toUpperCase() + where.slice(1) };
}

function presentationNode(name: string, key: string, raw: string, p: Obj | undefined): FileNode {
  const id = `pres:${name}`;
  const steps = arr(p?.steps).map(obj);
  const sources = arr(p?.sources).map(obj).filter((s): s is Obj => !!s);
  const children: FileNode[] = sources.map(src => {
    const sid = str(src.id) ?? '';
    const used = steps.map((st, i) => (arr(st?.blocks).some(b => { const o = obj(b); return o?.source === sid || obj(o?.from)?.source === sid; }) ? i + 1 : 0)).filter(Boolean);
    const stepLabel = (n: number) => { const t = str(steps[n - 1]?.title); return t ? `Step ${n} “${t}”` : `Step ${n}`; };
    const media = findMedia(src, []).filter(m => !m.path.includes('poster'));
    const bundle = obj(src.bundle);
    const mediaKids: FileNode[] = media.map(m => {
      const place = mediaPlace({ ...m, path: m.path.slice(2) }, obj(bundle?.play));
      return {
        id: `${id}/src:${sid}/media:${m.path.join('.')}`, section: 'presentations' as const, kind: 'media' as const, label: place.label, part: true,
        detail: [mediaType(m.src), place.where].filter(Boolean).join(' · '), size: m.src.length, hash: hashText(m.src),
        usedBy: used.map(n => ({ id, label: name, where: stepLabel(n) })),
        ...(used.length ? {} : { unused: 'Its Play is on no step' }),
      };
    });
    const from = obj(src.from);
    return {
      id: `${id}/src:${sid}`, section: 'presentations' as const, kind: 'source' as const, label: str(src.title) || 'Play', part: true, size: size(src), modified: num(src.capturedAt),
      detail: [from?.kind === 'saved' ? `From “${str(from.name)}”` : from?.kind === 'example' ? 'From an example' : '', used.length ? `${used.length === 1 ? 'Step' : 'Steps'} ${used.join(', ')}` : 'On no step'].filter(Boolean).join(' · '),
      ref: { t: 'part' as const, key, path: ['sources'], match: { field: 'id', value: sid } },
      usedBy: used.map(n => ({ id, label: name, where: stepLabel(n), breaks: true })),
      ...(used.length ? {} : { unused: 'No step shows this Play' }),
      children: mediaKids.length ? mediaKids : undefined,
    };
  });
  return {
    id, section: 'presentations', kind: 'presentation', label: name,
    detail: [plural(steps.length, 'step'), plural(sources.length, 'Play')].join(' · '),
    size: key.length + raw.length, modified: num(p?.updatedAt), ref: { t: 'key', key }, membership: { scope: PRESENTATION_FOLDER_SCOPE, id: name },
    hash: hashText(contentOf(p, ['title', 'updatedAt', 'createdAt', 'origin', 'linkedGraphs'])),
    children: children.length ? children : undefined,
  };
}

// ── Walking ─────────────────────────────────────────────────────────────────

/** The chain from the section down to a node (for breadcrumbs). */
export function pathTo(inv: Inventory, id: string): FileNode[] {
  const out: FileNode[] = [];
  let cur: string | undefined = id;
  while (cur) { const n = inv.byId.get(cur); if (!n) break; out.unshift(n); cur = inv.parentOf.get(cur); }
  return out;
}

/** Every node under (and including) these. */
export function* walk(nodes: Iterable<FileNode>): Generator<FileNode> {
  for (const n of nodes) { yield n; if (n.children) yield* walk(n.children); }
}

/** The whole items a selection stands for: a section/folder/group gives its items; an item gives itself; a part gives its item. */
export function itemsOf(inv: Inventory, ids: Iterable<string>): FileNode[] {
  const out = new Map<string, FileNode>();
  const add = (n: FileNode) => {
    if (n.kind === 'section' || n.kind === 'folder' || n.kind === 'group') { for (const c of n.children ?? []) add(c); return; }
    if (n.part) { let p = inv.parentOf.get(n.id); while (p && inv.byId.get(p)?.part) p = inv.parentOf.get(p); const item = p ? inv.byId.get(p) : undefined; if (item) out.set(item.id, item); return; }
    out.set(n.id, n);
  };
  for (const id of ids) { const n = inv.byId.get(id); if (n) add(n); }
  return [...out.values()];
}
