/**
 * layout.ts — the workspace folder's layout: what the app's stored things
 * (localStorage keys, the background images in IndexedDB) look like as files,
 * and back. docs/workspace-folder.md describes it for people.
 *
 *   workspace.json                                  format, id, when made, app version
 *   graphs/<folder>/<Name>.graph.json               a saved graph with its Play setup, takes, datasets, layer kinds
 *   graphs/.versions/<Name>/v<N>.graph.json         its earlier versions
 *   presentations/<folder>/<Name>.present.json      a presentation (pictures stay in the backgrounds library)
 *   glsl/<group>/<Name>.glsl  (+ <Name>.glsl.json)  a GLSL shader; its id, note and group beside it
 *   functions/<folder>/<Label>.fn.json              a custom function preset
 *   functions/Function Builder/<Name>.builder.json  (and .builder-group.json) the Function Builder's saved ones
 *   presets/group|expressions|transforms/<folder>/<Label>.json, presets/keyframes/<Label>.json
 *   presets/palettes/<Name>.palette.json            a Palette node preset
 *   published-nodes/<Label>.node.json               a node type published from the Builder
 *   scripts/sketches/<Name>.sketch.json             a saved sketch
 *   scripts/layer-kinds/<folder>/<Name>.kind.json   a layer kind
 *   backgrounds/images/<id>.<ext>, backgrounds/images.json, backgrounds/palettes.json
 *
 * The folder a file sits in is its folder in the app. A name the file system
 * can't hold ("a/b") is kept inside the file (workspaceName, or the label the
 * thing already carries), so it comes back exactly. Everything else in the
 * folder is left alone. Settings (theme, camera, learned roles, sign-ins,
 * panel sizes…) are not in the folder: they stay with each app.
 *
 * encodeTree(kv) is the cache as files (path → content and hash); decodeAreas
 * turns a set of files back into the keys to write. decode(encode(x)) == x.
 */
import type { KV } from '../utils/library';
import { PRESENTATION_FOLDER_SCOPE, PRESENTATION_KEY_PREFIX } from '../utils/library';
import { PRESENTATION_FILE_KIND, parsePresentation } from '../types/presentation';
import { hashBytes, hashString } from './hash';
import { foldCase, labelMatchesBase, nameFor, safeName, splitPath, uniqueName } from './names';
import { toText } from './fs';

// ── Keys (the same as the Files page's; repeated so this stays free of the app) ──

export const GRAPH_PREFIX = 'shader-studio:';
export const VERSIONS_PREFIX = 'shader-studio-versions:';
export const NODE_PREFIX = 'shader-studio:un:';
export const GLSL_KEY = 'shader-studio:glsl-shaders';
export const PALETTE_PRESETS_KEY = 'shader-studio:palette-presets';
export const BG_PALETTES_KEY = 'shader-studio-backgrounds:palettes';
export const SCRIPTS_KEY = 'shader-studio:play:savedScripts';
export const LAYER_KINDS_KEY = 'shader-studio:play:layerKinds';
export const BUILDER_FNS_KEY = 'fn_builder_saved_fns_v1';
export const BUILDER_GROUPS_KEY = 'fn_builder_groups_v1';
export const FOLDERS_KEY = 'assetbrowser_folders';
export const IMAGE_SCOPE = 'backgrounds:images';
export const BG_PALETTE_SCOPE = 'backgrounds:palettes';
const BG_MANIFEST_KIND = 'shader-studio-backgrounds';
const BG_PALETTES_KIND = 'shader-studio-background-palettes';

export type Area = 'graphs' | 'presentations' | 'glsl' | 'functions' | 'presets' | 'nodes' | 'scripts' | 'backgrounds';
export const AREAS: readonly Area[] = ['graphs', 'presentations', 'glsl', 'functions', 'presets', 'nodes', 'scripts', 'backgrounds'];
export const AREA_DIRS: Record<Area, string> = {
  graphs: 'graphs', presentations: 'presentations', glsl: 'glsl', functions: 'functions', presets: 'presets', nodes: 'published-nodes', scripts: 'scripts', backgrounds: 'backgrounds',
};
export const WORKSPACE_FILE = 'workspace.json';
/** The workspace's own bookkeeping (deletions other apps should know about). */
export const META_DIR = '.shader-studio';
export const TOMBSTONES_FILE = `${META_DIR}/deleted.json`;
export const LIST_DIRS = [...Object.values(AREA_DIRS)];

const GRAPH_EXCLUDED = /^shader-studio:(settings|play|osc|theme|shortcuts|minimap|glsl-editor|discover|convert|kaggle|cameraDevice|midiSound|performance-rolling)\b/;

// ── Kinds of file ───────────────────────────────────────────────────────────

/** One kind stored a key per item (`<prefix><id>`). */
interface KeyKind { kind: string; area: Area; prefix: string; root: string; ext: string; scope?: string; label: string }
const KEY_KINDS: KeyKind[] = [
  { kind: 'cfp', area: 'functions', prefix: 'shader-studio:cfp:', root: 'functions', ext: '.fn.json', scope: 'functions', label: 'Custom function' },
  { kind: 'gp', area: 'presets', prefix: 'shader-studio:gp:', root: 'presets/group', ext: '.json', scope: 'presets:group', label: 'Group preset' },
  { kind: 'ep', area: 'presets', prefix: 'shader-studio:ep:', root: 'presets/expressions', ext: '.json', scope: 'expressions', label: 'Expression preset' },
  { kind: 'tp', area: 'presets', prefix: 'shader-studio:tp:', root: 'presets/transforms', ext: '.json', scope: 'presets:transform', label: 'Transform preset' },
  { kind: 'kfp', area: 'presets', prefix: 'shader-studio:kfp:', root: 'presets/keyframes', ext: '.json', label: 'Keyframe preset' },
  { kind: 'un', area: 'nodes', prefix: NODE_PREFIX, root: 'published-nodes', ext: '.node.json', label: 'Published node' },
];

/** One kind stored as a list in one key, a file per element (by its id). */
interface ListKind { kind: string; area: Area; key: string; root: string; ext: string; scope?: string; fixed?: boolean; label: string }
const LIST_KINDS: ListKind[] = [
  { kind: 'sketch', area: 'scripts', key: SCRIPTS_KEY, root: 'scripts/sketches', ext: '.sketch.json', label: 'Sketch' },
  { kind: 'layerKind', area: 'scripts', key: LAYER_KINDS_KEY, root: 'scripts/layer-kinds', ext: '.kind.json', scope: 'layerKinds', label: 'Layer kind' },
  { kind: 'builderFn', area: 'functions', key: BUILDER_FNS_KEY, root: 'functions/Function Builder', ext: '.builder.json', fixed: true, label: 'Function Builder function' },
  { kind: 'builderGroup', area: 'functions', key: BUILDER_GROUPS_KEY, root: 'functions/Function Builder', ext: '.builder-group.json', fixed: true, label: 'Function Builder group' },
  { kind: 'palettePreset', area: 'presets', key: PALETTE_PRESETS_KEY, root: 'presets/palettes', ext: '.palette.json', label: 'Palette preset' },
];

/** How the two sides' changes to a file combine when both changed it. */
export type Policy = 'item' | 'newer' | 'merge';

export interface PathInfo { area: Area; kind: string; policy: Policy; label: string; kindLabel: string; json: boolean }

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' };
const EXT_OF: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

const under = (path: string, root: string) => path.startsWith(`${root}/`);
const eqExt = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What a path in the folder is, or null when it isn't one of ours (left alone). */
export function classify(path: string): PathInfo | null {
  const { base, ext } = splitPath(path);
  const parts = path.split('/');
  if (parts.some(p => !p)) return null;
  const mk = (area: Area, kind: string, policy: Policy, kindLabel: string, json = true): PathInfo => ({ area, kind, policy, label: base, kindLabel, json });
  if (under(path, 'graphs/.versions')) return parts.length === 4 && eqExt(ext, '.graph.json') ? { ...mk('graphs', 'version', 'newer', 'Earlier version'), label: `${parts[2]} · ${base}` } : null;
  if (parts.some(p => p.startsWith('.'))) return null;
  if (under(path, 'graphs')) return eqExt(ext, '.graph.json') ? mk('graphs', 'graph', 'item', 'Graph') : null;
  if (under(path, 'presentations')) return eqExt(ext, '.present.json') ? mk('presentations', 'presentation', 'item', 'Presentation') : null;
  if (under(path, 'glsl')) {
    if (eqExt(ext, '.glsl')) return mk('glsl', 'shader', 'item', 'GLSL shader', false);
    if (eqExt(ext, '.glsl.json')) return mk('glsl', 'shaderMeta', 'newer', 'GLSL shader details');
    return null;
  }
  if (path === 'backgrounds/images.json') return mk('backgrounds', 'imagesManifest', 'merge', 'Background images list');
  if (path === 'backgrounds/palettes.json') return mk('backgrounds', 'bgPalettes', 'merge', 'Background palettes');
  if (under(path, 'backgrounds/images')) return IMAGE_EXT.test(path) && parts.length === 3 ? mk('backgrounds', 'image', 'newer', 'Background image', false) : null;
  for (const k of LIST_KINDS) if (under(path, k.root) && eqExt(ext, k.ext)) return mk(k.area, k.kind, 'item', k.label);
  for (const k of KEY_KINDS) if (under(path, k.root) && eqExt(ext, k.ext)) return mk(k.area, k.kind, 'item', k.label);
  return null;
}

/** The user folder a file sits in under its kind's root ("graphs/Tests/Foo.graph.json" → "Tests"), or null. */
function folderIn(path: string, root: string): string | null {
  const rest = path.slice(root.length + 1).split('/');
  return rest.length > 1 ? rest[0] : null;
}

// ── Values ──────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const parse = (s: string | null | undefined): unknown => { if (s == null) return undefined; try { return JSON.parse(s); } catch { return undefined; } };
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const pretty = (v: unknown) => JSON.stringify(v, null, 1);

/** Put fields first in a pretty-printed object without printing it again. */
function inject(prettyText: string, fields: Obj): string {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return prettyText;
  if (prettyText === '{}') return pretty(fields);
  return `{\n${entries.map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`).join('')}${prettyText.slice(2)}`;
}

interface FolderStore { [scope: string]: { folders?: Array<{ id: string; label: string; collapsed?: boolean; createdAt?: number }>; membership?: Record<string, string> } }
function folderLabel(store: FolderStore, scope: string | undefined, id: string): string | null {
  if (!scope) return null;
  const sc = store[scope];
  const fid = sc?.membership?.[id];
  return (fid && sc?.folders?.find(f => f.id === fid)?.label) || null;
}

// ── Encoding ────────────────────────────────────────────────────────────────

export interface Entry {
  hash: string;
  text?: string;
  bytes?: Uint8Array;
  /** Bytes read when needed (an image in IndexedDB, a file in the folder). */
  load?: () => Promise<Uint8Array>;
}
export type Tree = Map<string, Entry>;

export interface ImageMeta { id: string; name: string; type: string; width: number; height: number; createdAt: number; bytes: number; source?: unknown }
/** The background images (IndexedDB in the app, a map in tests). Folders are the folder store's business, not this. */
export interface ImageStore {
  list(): Promise<ImageMeta[]>;
  read(id: string): Promise<Uint8Array | null>;
  put(meta: ImageMeta, data: Uint8Array): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Keeps the work of turning unchanged values into files between passes. */
export interface EncodeMemo { values: Map<string, { value: string; data: unknown }>; imageHashes: Map<string, string> }
export const newMemo = (): EncodeMemo => ({ values: new Map(), imageHashes: new Map() });

export interface Encoded {
  tree: Tree;
  /** The keys each area wrote files for: what a decode of that area may remove. */
  keys: Map<Area, Set<string>>;
  images: Map<string, ImageMeta>;
}

function memoized<T>(memo: EncodeMemo, slot: string, value: string, make: () => T): T {
  const had = memo.values.get(slot);
  if (had && had.value === value) return had.data as T;
  const data = make();
  memo.values.set(slot, { value, data });
  return data;
}

const textEntry = (text: string): Entry => ({ text, hash: hashString(text) });

interface Pending { area: Area; key: string; dir: string; folder: string | null; name: string; ext: string; uniqueIn: string; emit: (base: string, path: string) => void }

export async function encodeTree(kv: KV, images: ImageStore | null, memo: EncodeMemo = newMemo()): Promise<Encoded> {
  const tree: Tree = new Map();
  const keys = new Map<Area, Set<string>>(AREAS.map(a => [a, new Set<string>()]));
  const own = (a: Area, k: string) => keys.get(a)!.add(k);
  const store = (obj(parse(kv.get(FOLDERS_KEY))) ?? {}) as FolderStore;
  const pending: Pending[] = [];
  const allKeys = kv.keys().sort();

  for (const key of allKeys) {
    const value = kv.get(key);
    if (value == null) continue;

    // Saved graphs
    if (key.startsWith(GRAPH_PREFIX) && !GRAPH_EXCLUDED.test(key) && !KEY_KINDS.some(k => key.startsWith(k.prefix)) && key !== GLSL_KEY && key !== PALETTE_PRESETS_KEY && !LIST_KINDS.some(l => l.key === key)) {
      const g = memoized(memo, key, value, () => { const p = obj(parse(value)); return p && Array.isArray(p.nodes) ? pretty(p) : null; });
      if (g == null) continue;
      const name = key.slice(GRAPH_PREFIX.length);
      own('graphs', key);
      const folder = folderLabel(store, 'graphs', name);
      pending.push({
        area: 'graphs', key, dir: `graphs${folder ? `/${safeName(folder)}` : ''}`, folder, name, ext: '.graph.json', uniqueIn: 'graphs',
        emit: (base, path) => {
          const text = base === name ? g : inject(g, { workspaceName: name });
          tree.set(path, memoized(memo, `${key}#entry`, text, () => textEntry(text)));
          // Its earlier versions, beside it by the same file name.
          const vkey = VERSIONS_PREFIX + name;
          const hist = kv.get(vkey);
          if (hist == null) return;
          const versions = memoized(memo, vkey, hist, () => encodeVersions(hist));
          if (!versions) return;
          own('graphs', vkey);
          const taken = new Set<string>();
          for (const v of versions) {
            const vb = uniqueName('', `v${v.version}`, '.graph.json', taken);
            tree.set(`graphs/.versions/${base}/${vb}.graph.json`, v.entry);
          }
        },
      });
      continue;
    }

    if (key.startsWith(PRESENTATION_KEY_PREFIX)) {
      // Whether it came from a file (its script layers run sandboxed) is this app's business, not the folder's.
      const p = memoized(memo, key, value, () => {
        const o = obj(parse(value));
        if (!o || !parsePresentation(o)) return null;
        delete o.origin;
        return typeof o.kind === 'string' ? pretty(o) : inject(pretty(o), { kind: PRESENTATION_FILE_KIND });
      });
      if (p == null) continue;
      const name = key.slice(PRESENTATION_KEY_PREFIX.length);
      own('presentations', key);
      const folder = folderLabel(store, PRESENTATION_FOLDER_SCOPE, name);
      pending.push({
        area: 'presentations', key, dir: `presentations${folder ? `/${safeName(folder)}` : ''}`, folder, name, ext: '.present.json', uniqueIn: 'presentations',
        emit: (base, path) => {
          const o = memoized(memo, `${key}#title`, value, () => str(obj(parse(value))?.title));
          // The title carries the name; when it doesn't match (an older save), the name goes in beside it.
          const text = o === name || base === name ? p : inject(p, { workspaceName: name });
          tree.set(path, memoized(memo, `${key}#entry`, text, () => textEntry(text)));
        },
      });
      continue;
    }

    const kk = KEY_KINDS.find(k => key.startsWith(k.prefix));
    if (kk) {
      const id = key.slice(kk.prefix.length);
      const d = memoized(memo, key, value, () => {
        const o = obj(parse(value));
        if (!o) return null;
        const text = o.id === id ? pretty(o) : inject(pretty(o), { workspaceKey: id });
        return { label: str(o.label) ?? str(o.name) ?? id, entry: textEntry(text) };
      });
      if (!d) continue;
      own(kk.area, key);
      const folder = folderLabel(store, kk.scope, id);
      pending.push({ area: kk.area, key, dir: `${kk.root}${folder ? `/${safeName(folder)}` : ''}`, folder, name: d.label, ext: kk.ext, uniqueIn: kk.root, emit: (_b, path) => tree.set(path, d.entry) });
      continue;
    }

    const lk = LIST_KINDS.find(l => l.key === key);
    if (lk) {
      const list = memoized(memo, key, value, () => {
        const a = parse(value);
        if (!Array.isArray(a)) return null;
        return a.map(obj).filter((x): x is Obj => !!x && typeof x.id === 'string').map(x => ({ id: x.id as string, name: str(x.name) ?? str(x.label) ?? (x.id as string), entry: textEntry(pretty(x)) }));
      });
      if (!list) continue;
      own(lk.area, key);
      for (const el of list) {
        const folder = lk.fixed ? null : folderLabel(store, lk.scope, el.id);
        pending.push({ area: lk.area, key, dir: `${lk.root}${folder ? `/${safeName(folder)}` : ''}`, folder, name: el.name, ext: lk.ext, uniqueIn: lk.root, emit: (_b, path) => tree.set(path, el.entry) });
      }
      continue;
    }

    if (key === GLSL_KEY) {
      const list = memoized(memo, key, value, () => {
        const a = parse(value);
        if (!Array.isArray(a)) return null;
        return a.map(obj).filter((x): x is Obj => !!x && typeof x.id === 'string').map(x => {
          const { code, ...meta } = x;
          return { id: x.id as string, name: str(x.name) || 'Untitled shader', group: str(x.group)?.trim() || null, code: textEntry(typeof code === 'string' ? code : ''), meta: textEntry(pretty(meta)) };
        });
      });
      if (!list) continue;
      own('glsl', key);
      for (const sh of list) {
        pending.push({ area: 'glsl', key, dir: `glsl${sh.group ? `/${safeName(sh.group)}` : ''}`, folder: sh.group, name: sh.name, ext: '.glsl', uniqueIn: 'glsl', emit: (_b, path) => { tree.set(path, sh.code); tree.set(`${path}.json`, sh.meta); } });
      }
      continue;
    }

    if (key === BG_PALETTES_KEY) {
      const a = parse(value);
      if (!Array.isArray(a)) continue;
      own('backgrounds', key);
      const palettes = a.map(obj).filter((x): x is Obj => !!x).map(x => { const f = typeof x.id === 'string' ? folderLabel(store, BG_PALETTE_SCOPE, x.id) : null; return f ? { ...x, folder: f } : x; });
      const text = pretty({ kind: BG_PALETTES_KIND, version: 1, palettes });
      tree.set('backgrounds/palettes.json', memoized(memo, `${key}#entry`, text, () => textEntry(text)));
    }
  }

  // Names: unique without case within each kind's root (graphs across all their folders, so
  // their versions' folder names are unique too), in a stable order.
  const taken = new Map<string, Set<string>>();
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  pending.sort((a, b) => cmp(a.uniqueIn, b.uniqueIn) || cmp(a.name, b.name) || cmp(a.key, b.key));
  for (const p of pending) {
    const t = taken.get(p.uniqueIn) ?? new Set<string>();
    taken.set(p.uniqueIn, t);
    const base = uniqueName('', safeName(p.name), p.ext, t);
    p.emit(base, `${p.dir}/${base}${p.ext}`);
  }

  // Background images: the files as they are, and a list of their names and folders.
  const metas = new Map<string, ImageMeta>();
  if (images) {
    let list: ImageMeta[] = [];
    try { list = await images.list(); } catch { list = []; }
    const manifest: Obj[] = [];
    for (const m of [...list].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
      const file = `images/${safeName(m.id, 'image')}.${EXT_OF[m.type] ?? 'png'}`;
      const slot = `${m.id}:${m.bytes}:${m.type}`;
      let hash = memo.imageHashes.get(slot);
      if (!hash) {
        const data = await images.read(m.id).catch(() => null);
        if (!data) continue;
        hash = hashBytes(data);
        memo.imageHashes.set(slot, hash);
      }
      metas.set(m.id, m);
      const id = m.id;
      tree.set(`backgrounds/${file}`, { hash, load: async () => { const d = await images.read(id); if (!d) throw new Error(`The background image “${m.name}” is gone`); return d; } });
      const folder = folderLabel(store, IMAGE_SCOPE, m.id);
      manifest.push({ id: m.id, name: m.name, file, type: m.type, width: m.width, height: m.height, createdAt: m.createdAt, ...(m.source ? { source: m.source } : {}), ...(folder ? { folder } : {}) });
    }
    if (manifest.length || list.length) {
      const text = pretty({ kind: BG_MANIFEST_KIND, version: 1, images: manifest });
      tree.set('backgrounds/images.json', memoized(memo, 'images.json#entry', text, () => textEntry(text)));
    }
  }
  return { tree, keys, images: metas };
}

/** A graph's history as one file per version: the stored graph itself, with the version's own details only when they differ from it. */
function encodeVersions(hist: string): Array<{ version: number; entry: Entry }> | null {
  const a = parse(hist);
  if (!Array.isArray(a)) return null;
  const out: Array<{ version: number; entry: Entry }> = [];
  for (const v of a.map(obj)) {
    if (!v || typeof v.version !== 'number' || typeof v.payload !== 'string') continue;
    const p = obj(parse(v.payload));
    if (!p) continue;
    const { payload: _p, ...meta } = v;
    void _p;
    const text = sameAsDerived(meta, p) ? pretty(p) : inject(pretty(p), { workspaceVersion: meta });
    out.push({ version: v.version, entry: textEntry(text) });
  }
  return out;
}

function derivedMeta(p: Obj): Obj {
  const version = typeof p.version === 'number' && p.version >= 1 ? Math.floor(p.version) : 1;
  const savedAt = typeof p.savedAt === 'number' ? p.savedAt : 0;
  return { version, savedAt, ...(typeof p.note === 'string' && p.note ? { note: p.note } : {}) };
}
function sameAsDerived(meta: Obj, p: Obj): boolean { return JSON.stringify(meta) === JSON.stringify(derivedMeta(p)); }

// ── Checking a file from the folder ─────────────────────────────────────────

export function entryText(e: Entry): string | null {
  if (e.text != null) return e.text;
  if (e.bytes) return toText(e.bytes);
  return null;
}

/** Can this file be read as what its name says? null when it can, else what's wrong. */
export function validate(path: string, e: Entry): string | null {
  const info = classify(path);
  if (!info) return 'not a workspace file';
  if (!info.json) return info.kind === 'image' && e.bytes && e.bytes.length === 0 ? 'empty image file' : null;
  const text = entryText(e);
  const v = parse(text);
  if (!obj(v)) return 'not readable JSON (half-written, or edited by hand?)';
  const o = v as Obj;
  switch (info.kind) {
    case 'graph': return Array.isArray(o.nodes) ? null : 'not a graph (no nodes)';
    case 'presentation': { const { kind: _k, workspaceName: _w, ...rest } = o; void _k; void _w; return parsePresentation(rest) ? null : 'not a presentation'; }
    case 'imagesManifest': return Array.isArray(o.images) ? null : 'no images list';
    case 'bgPalettes': return Array.isArray(o.palettes) ? null : 'no palettes list';
    default: return null;
  }
}

// ── Decoding ────────────────────────────────────────────────────────────────

export interface CacheChanges {
  set: Map<string, string>;
  remove: Set<string>;
  /** Folder membership per scope: id → folder label (null: in no folder). */
  membership: Map<string, Map<string, string | null>>;
  images: { put: Array<{ meta: ImageMeta; entry: Entry }>; rename: Array<{ id: string; name: string }>; remove: string[] };
  /** Paths turned into something; the rest were skipped (unreadable, or an earlier version of no graph). */
  consumed: Set<string>;
}

const emptyChanges = (): CacheChanges => ({ set: new Map(), remove: new Set(), membership: new Map(), images: { put: [], rename: [], remove: [] }, consumed: new Set() });

const idSuffix = (path: string) => hashString(path).slice(0, 6);

function member(ch: CacheChanges, scope: string | undefined, id: string, label: string | null): void {
  if (!scope) return;
  const m = ch.membership.get(scope) ?? new Map<string, string | null>();
  m.set(id, label);
  ch.membership.set(scope, m);
}

/** Keep the current list's order for ids it has; new ones after, in path order. */
function inOrder<T extends { id: string }>(current: unknown, items: T[]): T[] {
  const order = new Map<string, number>();
  if (Array.isArray(current)) current.forEach((x, i) => { const id = obj(x)?.id; if (typeof id === 'string' && !order.has(id)) order.set(id, i); });
  return items.map((it, i) => ({ it, i })).sort((a, b) => (order.get(a.it.id) ?? 1e9 + a.i) - (order.get(b.it.id) ?? 1e9 + b.i)).map(x => x.it);
}

/** Elements the encoder couldn't write as files (no id): kept as they are. */
function unencodable(current: unknown): Obj[] {
  return Array.isArray(current) ? current.filter(x => !obj(x) || typeof (x as Obj).id !== 'string') as Obj[] : [];
}

/**
 * The cache as a set of files says: for these areas, the keys to write and
 * remove, folder membership and image changes. `tree` must hold every file
 * of those areas (the cache's own files, with the folder's changes applied).
 */
export function decodeAreas(areas: Iterable<Area>, tree: Tree, kv: KV, enc: Pick<Encoded, 'keys' | 'images'>): CacheChanges {
  const ch = emptyChanges();
  const want = new Set(areas);
  const byKind = new Map<string, Array<{ path: string; entry: Entry; info: PathInfo }>>();
  for (const [path, entry] of [...tree.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const info = classify(path);
    if (!info || !want.has(info.area)) continue;
    const l = byKind.get(info.kind) ?? [];
    l.push({ path, entry, info });
    byKind.set(info.kind, l);
  }
  const files = (kind: string) => byKind.get(kind) ?? [];
  const json = (e: Entry) => obj(parse(entryText(e)));
  const set = (k: string, v: string) => ch.set.set(k, v);

  if (want.has('graphs')) {
    const names = new Set<string>();
    const baseToName = new Map<string, string>();
    const ownGraphKeys = enc.keys.get('graphs') ?? new Set<string>();
    // A name whose key is something else's (the GLSL list, a setting) is taken too.
    const usable = (n: string) => {
      const k = GRAPH_PREFIX + n;
      if (GRAPH_EXCLUDED.test(k) || KEY_KINDS.some(x => k.startsWith(x.prefix)) || k === GLSL_KEY || k === PALETTE_PRESETS_KEY || LIST_KINDS.some(l => l.key === k)) return false;
      return kv.get(k) == null || ownGraphKeys.has(k);
    };
    const free = (n: string) => { let x = n, i = 2; while (names.has(x) || !usable(x)) x = `${n} (${i++})`; names.add(x); return x; };
    // Files whose stored name still matches first, so a copy never takes the original's name.
    const graphs = files('graph').map(f => ({ ...f, o: json(f.entry), base: splitPath(f.path).base }))
      .filter(f => f.o && Array.isArray(f.o.nodes))
      .sort((a, b) => Number(!(typeof a.o!.workspaceName === 'string' ? labelMatchesBase(a.o!.workspaceName as string, a.base) : true)) - Number(!(typeof b.o!.workspaceName === 'string' ? labelMatchesBase(b.o!.workspaceName as string, b.base) : true)) || a.path.localeCompare(b.path));
    for (const f of graphs) {
      const o = f.o!;
      const wn = o.workspaceName;
      delete o.workspaceName;
      const name = free(nameFor(typeof wn === 'string' ? wn : undefined, f.base));
      set(GRAPH_PREFIX + name, JSON.stringify(o));
      member(ch, 'graphs', name, folderIn(f.path, 'graphs'));
      baseToName.set(foldCase(f.base), name);
      ch.consumed.add(f.path);
    }
    // A graph renamed in Finder (same content, new name): its earlier versions go with it.
    for (const oldKey of ownGraphKeys) {
      if (oldKey.startsWith(VERSIONS_PREFIX) || ch.set.has(oldKey)) continue;
      const oldHist = kv.get(VERSIONS_PREFIX + oldKey.slice(GRAPH_PREFIX.length));
      const oldVal = kv.get(oldKey);
      if (!oldHist || oldVal == null) continue;
      for (const [k, v] of ch.set) {
        if (v !== oldVal || kv.get(k) != null || !k.startsWith(GRAPH_PREFIX)) continue;
        const nk = VERSIONS_PREFIX + k.slice(GRAPH_PREFIX.length);
        if (!ch.set.has(nk)) { ch.set.set(nk, oldHist); break; }
      }
    }
    const byGraph = new Map<string, Array<{ path: string; o: Obj }>>();
    for (const f of files('version')) {
      const name = baseToName.get(foldCase(f.path.split('/')[2]));
      const o = json(f.entry);
      if (!name || !o) continue;
      const l = byGraph.get(name) ?? [];
      l.push({ path: f.path, o });
      byGraph.set(name, l);
      ch.consumed.add(f.path);
    }
    for (const [name, list] of byGraph) {
      const out: Obj[] = [];
      for (const { path, o } of list) {
        const meta = obj(o.workspaceVersion);
        delete o.workspaceVersion;
        const payload = JSON.stringify(o);
        const m = meta ?? derivedMeta(o);
        if (typeof m.version !== 'number') { const n = /^v(\d+)/.exec(splitPath(path).base); m.version = n ? Number(n[1]) : 1; }
        out.push({ ...m, payload });
      }
      // Versions the encoder couldn't write as files stay as they are.
      const current = parse(kv.get(VERSIONS_PREFIX + name));
      const kept = (Array.isArray(current) ? current : []).filter(x => { const v = obj(x); return !v || typeof v.version !== 'number' || typeof v.payload !== 'string' || !obj(parse(v.payload)); }) as Obj[];
      const all = [...out, ...kept].sort((a, b) => Number(a.version) - Number(b.version));
      set(VERSIONS_PREFIX + name, JSON.stringify(all));
    }
    for (const k of enc.keys.get('graphs') ?? []) if (!ch.set.has(k)) ch.remove.add(k);
  }

  if (want.has('presentations')) {
    const names = new Set<string>();
    const free = (n: string) => { let x = n, i = 2; while (names.has(x)) x = `${n} (${i++})`; names.add(x); return x; };
    const list = files('presentation').map(f => ({ ...f, o: json(f.entry), base: splitPath(f.path).base })).filter(f => f.o);
    const carried = (o: Obj) => (typeof o.workspaceName === 'string' ? o.workspaceName : str(o.title));
    list.sort((a, b) => Number(!labelMatchesBase(carried(a.o!) ?? '', a.base)) - Number(!labelMatchesBase(carried(b.o!) ?? '', b.base)) || a.path.localeCompare(b.path));
    for (const f of list) {
      const o = f.o!;
      const c = carried(o);
      delete o.workspaceName;
      if (o.kind === PRESENTATION_FILE_KIND) delete o.kind;
      if (!parsePresentation(o)) continue;
      const name = free(nameFor(c, f.base));
      if (o.title !== name) o.title = name;
      // Kept as this app had it; one new to this app whose Plays run scripts is treated like an
      // imported file (its scripts run sandboxed): anything can be put in the folder.
      const had = obj(parse(kv.get(PRESENTATION_KEY_PREFIX + name)));
      delete o.origin;
      if (had) { if (had.origin === 'imported') o.origin = 'imported'; }
      else if (JSON.stringify(o.sources ?? []).includes('"kind":"script"')) o.origin = 'imported';
      set(PRESENTATION_KEY_PREFIX + name, JSON.stringify(o));
      member(ch, PRESENTATION_FOLDER_SCOPE, name, folderIn(f.path, 'presentations'));
      ch.consumed.add(f.path);
    }
    for (const k of enc.keys.get('presentations') ?? []) if (!ch.set.has(k)) ch.remove.add(k);
  }

  if (want.has('glsl')) {
    const metaFiles = new Map(files('shaderMeta').map(f => [foldCase(f.path), f]));
    const ids = new Set<string>();
    const out: Array<Obj & { id: string }> = [];
    const shaders = files('shader').map(f => {
      const mf = metaFiles.get(foldCase(`${f.path}.json`));
      const meta = mf ? json(mf.entry) : null;
      return { ...f, meta, mf, base: splitPath(f.path).base };
    }).sort((a, b) => Number(!(a.meta && labelMatchesBase(str(a.meta.name) ?? '', a.base))) - Number(!(b.meta && labelMatchesBase(str(b.meta.name) ?? '', b.base))) || a.path.localeCompare(b.path));
    for (const f of shaders) {
      const meta = { ...(f.meta ?? {}) };
      const matches = labelMatchesBase(str(meta.name) ?? '', f.base);
      let id = typeof meta.id === 'string' && (matches || !ids.has(meta.id)) ? meta.id : `glsl_${idSuffix(f.path)}`;
      if (ids.has(id)) id = `${id}_${idSuffix(f.path)}`;
      ids.add(id);
      const dir = folderIn(f.path, 'glsl');
      const group = str(meta.group)?.trim() && dir && foldCase(safeName(meta.group as string)) === foldCase(dir) ? meta.group as string : (dir ?? undefined);
      const el: Obj & { id: string } = { ...meta, id, name: nameFor(str(meta.name), f.base), code: entryText(f.entry) ?? '' };
      if (group) el.group = group; else delete el.group;
      out.push(el);
      ch.consumed.add(f.path);
      if (f.mf) ch.consumed.add(f.mf.path);
    }
    const current = parse(kv.get(GLSL_KEY));
    if (out.length || enc.keys.get('glsl')?.has(GLSL_KEY)) set(GLSL_KEY, JSON.stringify([...inOrder(current, out), ...unencodable(current)]));
  }

  for (const kk of KEY_KINDS) {
    if (!want.has(kk.area)) continue;
    const ids = new Set<string>();
    const list = files(kk.kind).map(f => ({ ...f, o: json(f.entry), base: splitPath(f.path).base })).filter(f => f.o);
    const labelOf = (o: Obj) => str(o.label) ?? str(o.name) ?? '';
    list.sort((a, b) => Number(!labelMatchesBase(labelOf(a.o!), a.base)) - Number(!labelMatchesBase(labelOf(b.o!), b.base)) || a.path.localeCompare(b.path));
    for (const f of list) {
      const o = f.o!;
      const wk = str(o.workspaceKey);
      delete o.workspaceKey;
      let id = wk ?? str(o.id) ?? `ws_${idSuffix(f.path)}`;
      if (ids.has(id)) { id = `${id}_${idSuffix(f.path)}`; if (typeof o.id === 'string' && !wk) o.id = id; }
      ids.add(id);
      const nm = nameFor(labelOf(o) || undefined, f.base);
      if (nm !== labelOf(o)) { if ('label' in o || !('name' in o)) o.label = nm; else o.name = nm; }
      set(kk.prefix + id, JSON.stringify(o));
      member(ch, kk.scope, id, folderIn(f.path, kk.root));
      ch.consumed.add(f.path);
    }
    for (const k of enc.keys.get(kk.area) ?? []) if (k.startsWith(kk.prefix) && !ch.set.has(k)) ch.remove.add(k);
  }

  for (const lk of LIST_KINDS) {
    if (!want.has(lk.area)) continue;
    const ids = new Set<string>();
    const out: Array<Obj & { id: string }> = [];
    const list = files(lk.kind).map(f => ({ ...f, o: json(f.entry), base: splitPath(f.path).base })).filter(f => f.o);
    const labelOf = (o: Obj) => str(o.name) ?? str(o.label) ?? '';
    list.sort((a, b) => Number(!labelMatchesBase(labelOf(a.o!), a.base)) - Number(!labelMatchesBase(labelOf(b.o!), b.base)) || a.path.localeCompare(b.path));
    for (const f of list) {
      const o = f.o!;
      let id = str(o.id) ?? `ws_${idSuffix(f.path)}`;
      if (ids.has(id)) id = `${id}_${idSuffix(f.path)}`;
      ids.add(id);
      o.id = id;
      const nm = nameFor(labelOf(o) || undefined, f.base);
      if (nm !== labelOf(o)) { if ('name' in o || !('label' in o)) o.name = nm; else o.label = nm; }
      out.push(o as Obj & { id: string });
      if (!lk.fixed) member(ch, lk.scope, id, folderIn(f.path, lk.root));
      ch.consumed.add(f.path);
    }
    const current = parse(kv.get(lk.key));
    if (out.length || enc.keys.get(lk.area)?.has(lk.key)) set(lk.key, JSON.stringify([...inOrder(current, out), ...unencodable(current)]));
  }

  if (want.has('backgrounds')) {
    const pal = files('bgPalettes')[0];
    const palettes = pal ? json(pal.entry)?.palettes : undefined;
    if (pal && Array.isArray(palettes)) {
      const out = palettes.map(obj).filter((x): x is Obj => !!x).map(x => {
        const { folder, ...rest } = x;
        if (typeof rest.id === 'string') member(ch, BG_PALETTE_SCOPE, rest.id, typeof folder === 'string' && folder ? folder : null);
        return rest;
      });
      set(BG_PALETTES_KEY, JSON.stringify(out));
      ch.consumed.add(pal.path);
    } else if (enc.keys.get('backgrounds')?.has(BG_PALETTES_KEY)) set(BG_PALETTES_KEY, '[]');

    const man = files('imagesManifest')[0];
    const entries = man ? (json(man.entry)?.images as unknown[] | undefined) : undefined;
    if (man) ch.consumed.add(man.path);
    const byFile = new Map<string, Obj>();
    for (const e of Array.isArray(entries) ? entries.map(obj) : []) if (e && typeof e.id === 'string' && typeof e.file === 'string') byFile.set(foldCase(`backgrounds/${e.file}`), e);
    const present = new Set<string>();
    for (const f of files('image')) {
      const e = byFile.get(foldCase(f.path));
      const { base, ext } = splitPath(f.path);
      const id = str(e?.id) ?? base;
      if (present.has(id)) continue;
      present.add(id);
      ch.consumed.add(f.path);
      const had = enc.images.get(id);
      if (had) {
        const name = str(e?.name);
        if (name && name !== had.name) ch.images.rename.push({ id, name });
      } else {
        ch.images.put.push({
          entry: f.entry,
          meta: {
            id, name: str(e?.name) ?? base, type: str(e?.type) ?? MIME[ext.slice(1).toLowerCase()] ?? 'image/png',
            width: typeof e?.width === 'number' ? e.width : 0, height: typeof e?.height === 'number' ? e.height : 0,
            createdAt: typeof e?.createdAt === 'number' ? e.createdAt : Date.now(), bytes: 0, ...(e?.source ? { source: e.source } : {}),
          },
        });
      }
      if (e) member(ch, IMAGE_SCOPE, id, typeof e.folder === 'string' && e.folder ? e.folder : null);
    }
    for (const id of enc.images.keys()) if (!present.has(id)) ch.images.remove.push(id);
  }
  return ch;
}

/** Folder membership from a decode, into the folder store (folders made by name when there's none). */
export function applyMembership(kv: KV, membership: CacheChanges['membership'], now = Date.now()): string | null {
  if (!membership.size) return null;
  const before = kv.get(FOLDERS_KEY);
  const store = (obj(parse(before)) ?? {}) as FolderStore;
  let n = 0;
  for (const [scope, map] of membership) {
    const sc = store[scope] ?? (store[scope] = { folders: [], membership: {} });
    sc.folders ??= [];
    sc.membership ??= {};
    for (const [id, label] of map) {
      if (!label) { delete sc.membership[id]; continue; }
      const cur = sc.membership[id] ? sc.folders.find(f => f.id === sc.membership![id]) : undefined;
      if (cur && foldCase(safeName(cur.label)) === foldCase(safeName(label))) continue;
      let f = sc.folders.find(x => foldCase(safeName(x.label)) === foldCase(safeName(label)));
      if (!f) { f = { id: `folder_${now}_${n++}`, label, collapsed: false, createdAt: now }; sc.folders.push(f); }
      sc.membership[id] = f.id;
    }
  }
  const after = JSON.stringify(store);
  return after === (before ?? '{}') ? null : after;
}

// ── Comparing and combining ─────────────────────────────────────────────────

const IGNORED_IN_COMPARE = ['workspaceName', 'workspaceKey', 'kind', 'origin'];
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = obj(v);
  if (o) return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** The same thing written two ways (spacing, key order, an older backup's extra fields)? */
export function equivalent(path: string, a: Entry, b: Entry): boolean {
  if (a.hash === b.hash) return true;
  const info = classify(path);
  if (!info?.json) return false;
  const pa = obj(parse(entryText(a))), pb = obj(parse(entryText(b)));
  if (!pa || !pb) return false;
  for (const k of IGNORED_IN_COMPARE) { delete pa[k]; delete pb[k]; }
  return canonical(pa) === canonical(pb);
}

/** Both sides changed a list file (images.json, palettes.json): everything from both, the newer side's where both have one. */
export function mergeLists(path: string, local: Entry, folder: Entry, localNewer: boolean): Entry {
  const field = path.endsWith('images.json') ? 'images' : 'palettes';
  const pl = obj(parse(entryText(local))), pf = obj(parse(entryText(folder)));
  if (!pl || !pf) return localNewer || !pf ? local : folder;
  const [first, second] = localNewer ? [pl, pf] : [pf, pl];
  const out: unknown[] = [];
  const ids = new Set<string>();
  for (const x of [...(Array.isArray(first[field]) ? first[field] as unknown[] : []), ...(Array.isArray(second[field]) ? second[field] as unknown[] : [])]) {
    const id = obj(x)?.id;
    if (typeof id === 'string') { if (ids.has(id)) continue; ids.add(id); }
    out.push(x);
  }
  return textEntry(pretty({ ...first, [field]: out }));
}

/** "Keep the other one": the copy's content under the original's identity (its id, name and label). */
export function retarget(path: string, copy: Entry, target: Entry | undefined): Entry {
  const info = classify(path);
  if (!info?.json) return copy.text != null ? textEntry(copy.text) : copy;
  const c = obj(parse(entryText(copy)));
  const t = target ? obj(parse(entryText(target))) : null;
  if (!c) return copy;
  for (const k of ['id', 'label', 'name', 'title', 'workspaceName', 'workspaceKey']) {
    if (t && k in t) c[k] = t[k]; else if (k !== 'label' && k !== 'name' && k !== 'title' && k !== 'id') delete c[k];
  }
  if (!t) for (const k of ['label', 'name', 'title']) if (typeof c[k] === 'string') c[k] = splitPath(path).base;
  return textEntry(pretty(c));
}

/** The name of the thing a file holds, as the app shows it (the stored name when it still names the file). */
export function displayName(path: string, e: Entry | undefined): string {
  const { base } = splitPath(path);
  const info = classify(path);
  if (!e || !info?.json) return base;
  const o = obj(parse(entryText(e)));
  const stored = o ? str(o.workspaceName) ?? str(o.title) ?? str(o.label) ?? str(o.name) : undefined;
  return nameFor(stored, base);
}

/** A path in words for lists ("Graph “Foo”"). */
export function describePath(path: string): { kindLabel: string; label: string; area: Area | null } {
  const info = classify(path);
  return info ? { kindLabel: info.kindLabel, label: info.label, area: info.area } : { kindLabel: 'File', label: path, area: null };
}
