/**
 * What goes into a .playfile when something is exported: the chosen things
 * as items, and (optionally) what they depend on, so the file opens on
 * another machine with nothing missing.
 *
 * Works on the Files page's inventory (src/files/inventory.ts), so every
 * export (a graph, a Play setup, a presentation, a Files selection, one
 * section) chooses items the same way:
 *
 *   graph         → a `graph` item (or `play` when exported as a Play setup)
 *   presentation  → a `presentation` item, pictures and fonts embedded
 *   published node→ one `nodes` item for all of them (a node pack)
 *   GLSL shader   → a `glsl` item each
 *   background    → a `background` item each (the picture file)
 *   anything else → one `library` item (presets, functions, scripts, palettes, settings)
 *
 * Dependencies: the published nodes a graph is built from (sealed ones stay
 * sealed), the graphs a presentation was made from, and the custom function
 * presets, layer kinds and background images a graph or presentation uses.
 * The graph itself already carries its groups, expression and custom function
 * nodes' code, datasets, Play media and layer kinds, so it opens without them;
 * they come along so they're in the recipient's library too.
 *
 * Pure apart from what `env` does (reading a background's bytes, embedding a
 * presentation's assets), so tests run it on a map.
 */
import type { UserNodeDefinition } from '../types/userNode';
import { selectionSnapshot } from '../files/profileZip';
import { FOLDERS_KEY, GRAPH_PREFIX, itemsOf, parseJson, type FileNode, type Inventory } from '../files/inventory';
import type { MutableKV } from '../files/mutate';
import { sealDefinition, storedForm } from './sealing';
import type { WriteItem } from './writer';
import { mediaKindOf } from '../files/linkedRefs';

export const PLAY_FILE_KIND = 'shader-studio-play';

export interface BundleEnv {
  /** A presentation's stored JSON → its .present.json text with pictures and fonts embedded. */
  presentationFile?: (name: string, stored: string) => Promise<string>;
  /** A background image's file. */
  backgroundFile?: (source: string, id: string) => Promise<{ bytes: Uint8Array; type: string; name: string } | null>;
}

export interface BundleOptions {
  /** Bring what they use along (default true). */
  dependencies?: boolean;
  /** Seal the node pack (sealed nodes are always sealed). */
  seal?: boolean;
  /** May published nodes be exported as a pack when chosen themselves (Pro: nodes.pack)? Dependencies always come along. */
  canPack?: boolean;
  /** Graph ids to write as Play setups (`play` items) instead of graphs. */
  asPlay?: ReadonlySet<string>;
  /** Name the node pack. */
  packName?: string;
  /** Bring the presentations a graph is linked to, and the graphs a presentation is linked to (default true; see linkedTo). */
  linked?: boolean;
}

export interface Bundle {
  items: WriteItem[];
  /** Sentences for the person exporting ("2 published nodes it uses came along"). */
  notes: string[];
  /** Counts by what was chosen and what came along. */
  chosen: number;
  dependencies: number;
  /** Did any sealed node go in? */
  sealed: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);

/** A saved graph's stored JSON as a readable graph (or play) file. */
export function graphFileText(stored: string, asPlay: boolean): string {
  const g = obj(parseJson(stored)) ?? {};
  const { savedAt: _s, version: _v, note: _n, kind: _k, ...rest } = g;
  void _s; void _v; void _n; void _k;
  return JSON.stringify(asPlay ? { kind: PLAY_FILE_KIND, ...rest } : rest, null, 1);
}

/** Every item a set of ids stands for, plus (optionally) what they depend on. */
export function collectForBundle(inv: Inventory, ids: Iterable<string>, dependencies = true, linked?: (n: FileNode) => string[]): { chosen: FileNode[]; deps: FileNode[] } {
  const chosen = itemsOf(inv, ids).filter(n => !n.private && !n.part);
  const have = new Set(chosen.map(n => n.id));
  const deps: FileNode[] = [];
  if (!dependencies) return { chosen, deps };
  const add = (n: FileNode | undefined) => { if (n && !have.has(n.id) && !n.private) { have.add(n.id); deps.push(n); queue.push(n); } };
  const queue = [...chosen];
  // Things that name a chosen item in their Used by (functions, layer kinds, images a graph uses).
  const usedByIndex = new Map<string, FileNode[]>();
  for (const s of inv.sections) for (const n of walkItems(s)) for (const u of n.usedBy ?? []) if (u.id) { const l = usedByIndex.get(u.id) ?? []; l.push(n); usedByIndex.set(u.id, l); }
  while (queue.length) {
    const n = queue.shift()!;
    if (n.kind !== 'graph' && n.kind !== 'presentation') continue;
    for (const u of n.uses ?? []) add(inv.byId.get(u));
    for (const l of linked?.(n) ?? []) add(inv.byId.get(l));
    for (const d of usedByIndex.get(n.id) ?? []) {
      // A graph shown in another's Background layer is copied into it: not a dependency.
      if (d.kind === 'graph') continue;
      add(d);
    }
  }
  return { chosen, deps };
}

function* walkItems(n: FileNode): Generator<FileNode> {
  if (!n.part && n.kind !== 'section' && n.kind !== 'group' && n.kind !== 'folder') yield n;
  for (const c of n.children ?? []) yield* walkItems(c);
}

/**
 * Links between saved graphs and presentations: a graph record's
 * `linkedPresentations` and a presentation's `linkedGraphs` (ids or names).
 * Read if present; a store without them has no links.
 */
export function linkedTo(kv: MutableKV, inv: Inventory, n: FileNode): string[] {
  if (n.ref?.t !== 'key') return [];
  const rec = obj(parseJson(kv.get(n.ref.key)));
  const field = n.kind === 'graph' ? rec?.linkedPresentations : n.kind === 'presentation' ? rec?.linkedGraphs : undefined;
  if (!Array.isArray(field) || !field.length) return [];
  const want = n.kind === 'graph' ? 'presentation' : 'graph';
  const prefix = want === 'graph' ? 'graph:' : 'pres:';
  const out: string[] = [];
  for (const v of field.filter((x): x is string => typeof x === 'string')) {
    if (inv.byId.get(prefix + v)?.kind === want) { out.push(prefix + v); continue; }
    // By the record's own id.
    for (const s of inv.sections) for (const c of walkItems(s)) {
      if (c.kind !== want || c.ref?.t !== 'key') continue;
      if (obj(parseJson(kv.get(c.ref.key)))?.id === v) out.push(c.id);
    }
  }
  return out;
}

/** How many linked presentations (or graphs) a Files node has (for "Include linked presentations"). */
export function linkedCount(kv: MutableKV, inv: Inventory, id: string): number {
  const n = inv.byId.get(id);
  return n ? linkedTo(kv, inv, n).length : 0;
}

export async function buildBundle(kv: MutableKV, inv: Inventory, ids: Iterable<string>, opts: BundleOptions = {}, env: BundleEnv = {}): Promise<Bundle> {
  const { chosen, deps } = collectForBundle(inv, ids, opts.dependencies ?? true, opts.linked === false ? undefined : n => linkedTo(kv, inv, n));
  const items: WriteItem[] = [];
  const notes: string[] = [];
  const nodeIds: string[] = [];
  const libraryIds: string[] = [];
  const isDep = new Set(deps.map(d => d.id));
  let skippedNodes = 0;
  let nodesChosen = false, libraryChosen = false;
  let sealed = false;

  for (const n of [...chosen, ...deps]) {
    const r = n.ref;
    if (n.kind === 'graph' && r?.t === 'key') {
      const v = kv.get(r.key);
      if (!v) continue;
      const play = !!opts.asPlay?.has(n.id);
      items.push({ kind: play ? 'play' : 'graph', name: r.key.slice(GRAPH_PREFIX.length), data: graphFileText(v, play), meta: { ...(isDep.has(n.id) ? { dependency: true } : {}), ...(n.detail ? { detail: n.detail } : {}) } });
    } else if (n.kind === 'presentation' && r?.t === 'key') {
      const v = kv.get(r.key);
      if (!v) continue;
      const text = env.presentationFile ? await env.presentationFile(n.label, v) : v;
      items.push({ kind: 'presentation', name: n.label, data: text, ...(isDep.has(n.id) ? { meta: { dependency: true } } : {}) });
    } else if (n.kind === 'node' && r?.t === 'key') {
      if (!isDep.has(n.id) && !opts.canPack) { skippedNodes++; continue; }
      nodeIds.push(r.key); if (!isDep.has(n.id)) nodesChosen = true;
    } else if (n.kind === 'shader' && r?.t === 'part') {
      const list = parseJson(kv.get(r.key));
      const sh = Array.isArray(list) ? list.map(obj).find(x => x && r.match && x[r.match.field] === r.match.value) : undefined;
      if (!sh || typeof sh.code !== 'string') continue;
      items.push({ kind: 'glsl', name: typeof sh.name === 'string' && sh.name ? sh.name : n.label, data: sh.code, meta: { ...(typeof sh.note === 'string' && sh.note ? { note: sh.note } : {}), ...(typeof sh.group === 'string' && sh.group ? { group: sh.group } : {}) } });
    } else if (n.kind === 'background' && r?.t === 'external') {
      const f = env.backgroundFile ? await env.backgroundFile(r.source, r.id) : null;
      if (!f) { notes.push(`“${n.label}” couldn’t be read, so it was left out.`); continue; }
      items.push({ kind: 'background', name: f.name || n.label, data: f.bytes, ext: extFor(f.type), meta: { type: f.type, ...(isDep.has(n.id) ? { dependency: true } : {}) } });
    } else if (r) {
      libraryIds.push(n.id); if (!isDep.has(n.id)) libraryChosen = true;
    }
  }

  if (nodeIds.length) {
    const defs = nodeIds.map(k => obj(parseJson(kv.get(k))) as UserNodeDefinition | undefined).filter((d): d is UserNodeDefinition => !!d && typeof d.id === 'string');
    const out = defs.map(d => (opts.seal || d.sealed ? sealDefinition(d) : storedForm(d)));
    sealed = out.some(d => !!d.sealed);
    const name = opts.packName?.trim() || (out.length === 1 ? out[0].label : `${plural(out.length, 'node type')}`);
    items.push({ kind: 'nodes', name, data: JSON.stringify({ version: 1, nodes: out }, null, 1), meta: { ...(nodesChosen ? {} : { dependency: true }), count: out.length, sealed: out.every(d => !!d.sealed) ? true : out.some(d => !!d.sealed) ? 'some' : false, labels: out.map(d => d.label).slice(0, 50) } });
  }
  if (libraryIds.length) {
    const sel = selectionSnapshot(kv, inv, libraryIds, { dependencies: false });
    // Folders only matter next to what sits in them.
    const keys = Object.keys(sel.snapshot.items).filter(k => k !== FOLDERS_KEY);
    if (keys.length) items.push({ kind: 'library', name: libraryName(sel.items), data: JSON.stringify(sel.snapshot), meta: { ...(libraryChosen ? {} : { dependency: true }), count: sel.items.length } });
  }

  const depCount = deps.length;
  if (depCount) {
    const kinds = new Map<string, number>();
    for (const d of deps) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
    const words: Record<string, [string, string]> = { video: ['video', 'videos'], presentation: ['linked presentation', 'linked presentations'], node: ['published node', 'published nodes'], graph: ['graph', 'graphs'], function: ['custom function', 'custom functions'], layerKind: ['layer kind', 'layer kinds'], background: ['background image', 'background images'], script: ['script', 'scripts'] };
    notes.push(`Came along: ${[...kinds].map(([k, c]) => plural(c, words[k]?.[0] ?? k, words[k]?.[1])).join(', ')}.`);
  }
  if (skippedNodes) notes.push(`${plural(skippedNodes, 'published node')} left out: making node packs is part of Pro.`);
  return { items, notes, chosen: chosen.length, dependencies: depCount, sealed };
}

function libraryName(items: FileNode[]): string {
  if (items.length === 1) return items[0].label;
  return `${plural(items.length, 'preset or setting', 'presets and settings')}`;
}

function extFor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('png')) return '.png';
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  if (t.includes('webp')) return '.webp';
  if (t.includes('gif')) return '.gif';
  if (t.includes('avif')) return '.avif';
  if (t.includes('svg')) return '.svg';
  return '.bin';
}

// ── Videos ──────────────────────────────────────────────────────────────────
// A Video layer names its file by `videoId` (the videos library, lib/backgroundLibrary.ts),
// a Drum pad layer's pads their samples by `sampleId` (the same store).
// Graphs, Play setups, presentations and library snapshots that use one carry the file
// as a `video` item, so the layer finds it after an import elsewhere.

/** Every video id the graph, Play, presentation and library items name (also inside a library snapshot's escaped JSON). */
export function videoIdsIn(items: readonly WriteItem[]): string[] {
  const out = new Set<string>();
  const re = /\\?"(?:videoId|sampleId)\\?"\s*:\s*\\?"([^"\\]{1,400})\\?"/g;
  for (const it of items) {
    if (it.kind !== 'graph' && it.kind !== 'play' && it.kind !== 'presentation' && it.kind !== 'library') continue;
    const text = typeof it.data === 'string' ? it.data : '';
    if (!text.includes('videoId') && !text.includes('sampleId')) continue;
    for (const m of text.matchAll(re)) out.add(m[1]);
  }
  // A Background's video from a linked folder names it as `libraryId` (docs/linked-folders.md).
  const linkedRe = /\\?"libraryId\\?"\s*:\s*\\?"(linked:[^"\\]{1,400})\\?"/g;
  for (const it of items) {
    if (it.kind !== 'graph' && it.kind !== 'play' && it.kind !== 'presentation' && it.kind !== 'library') continue;
    const text = typeof it.data === 'string' ? it.data : '';
    if (!text.includes('linked:')) continue;
    for (const m of text.matchAll(linkedRe)) { const k = mediaKindOf(m[1]); if (k === 'video' || k === 'audio') out.add(m[1]); }
  }
  return [...out];
}

interface VideosManifestLike { videos?: Array<{ id?: unknown; name?: unknown; file?: unknown; type?: unknown; createdAt?: unknown; width?: unknown; height?: unknown; duration?: unknown }> }

/**
 * The videos library's ZIP files (`videoZipFiles`: `backgrounds/videos.json` and
 * `backgrounds/videos/…`) as `video` items: the file, with its id, type and size
 * in `meta` so the import puts it back under the same id.
 */
export function videoItemsFrom(files: Record<string, Uint8Array>, dependency = true): WriteItem[] {
  const raw = files['backgrounds/videos.json'];
  if (!raw) return [];
  let m: VideosManifestLike;
  try { m = JSON.parse(new TextDecoder().decode(raw)) as VideosManifestLike; } catch { return []; }
  const out: WriteItem[] = [];
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  for (const v of m.videos ?? []) {
    if (typeof v.id !== 'string' || typeof v.file !== 'string') continue;
    const data = files[`backgrounds/${v.file}`];
    if (!data) continue;
    const ext = /\.[a-z0-9]{2,4}$/i.exec(v.file)?.[0] ?? '.mp4';
    out.push({
      kind: 'video', name: typeof v.name === 'string' && v.name ? v.name : v.id, data, ext,
      meta: {
        id: v.id, type: typeof v.type === 'string' ? v.type : '', ...(dependency ? { dependency: true } : {}),
        ...(num(v.createdAt) !== undefined ? { createdAt: num(v.createdAt) } : {}),
        ...(num(v.width) !== undefined && num(v.height) !== undefined ? { width: num(v.width), height: num(v.height) } : {}),
        ...(num(v.duration) !== undefined ? { duration: num(v.duration) } : {}),
      },
    });
  }
  return out;
}

/** A `video` item back as the files `importVideoFiles` reads (the manifest and the file). */
export function videoFilesFor(item: { name: string; path: string; data: Uint8Array; meta?: Record<string, unknown> }): Record<string, Uint8Array> {
  const m = item.meta ?? {};
  const id = typeof m.id === 'string' ? m.id : '';
  const file = `videos/${item.path.split('/').pop() ?? 'video.mp4'}`;
  const entry = {
    id, name: item.name, file, type: typeof m.type === 'string' ? m.type : '', bytes: item.data.length,
    createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
    ...(typeof m.width === 'number' ? { width: m.width } : {}), ...(typeof m.height === 'number' ? { height: m.height } : {}),
    ...(typeof m.duration === 'number' ? { duration: m.duration } : {}),
  };
  return {
    'backgrounds/videos.json': new TextEncoder().encode(JSON.stringify({ kind: 'shader-studio-videos', version: 1, videos: [entry] })),
    [`backgrounds/${file}`]: item.data,
  };
}
