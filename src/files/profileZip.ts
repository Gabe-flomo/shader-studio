/**
 * profileZip.ts — downloading and installing a Shader Studio profile.
 *
 * A profile ZIP is the Library's export ZIP (utils/library.ts) with a
 * manifest: so the Library's Import reads it, and Install reads Library
 * exports and older backups.
 *
 *   <root>/library.json        the stored keys and values (LibrarySnapshot): what an import reads
 *   <root>/manifest.json       kind 'shader-studio-profile', app version, when, everything or a
 *                              selection, counts and sizes per section, the items, external files
 *   <root>/README.txt
 *   <root>/graphs/…, presentations/…, glsl shaders/…   the same things as readable files
 *   <root>/backgrounds/…       IndexedDB stores' files in their own layout (sources.ts): the
 *                              background images as backgrounds/images.json + picture files
 *
 * A selection holds just the chosen items (a whole section or folder, or
 * single things), optionally their earlier versions and what they depend on
 * (the published nodes a graph is built from, the graphs a presentation was
 * made from), plus the folders they sit in.
 *
 * Install previews what is inside by section with sizes and what clashes,
 * then Merges (nothing of yours is overwritten; a clashing name comes in as
 * "Name (2)") or Replaces everything (after a backup ZIP of what is there).
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { LIBRARY_FILE, LIBRARY_KIND, libraryZipName, mergeJson, PRESENTATION_FOLDER_SCOPE, PRESENTATION_KEY_PREFIX, readableFiles, readLibrary, type LibrarySnapshot } from '../utils/library';
import { parsePresentation } from '../types/presentation';
import { fixImportedLinks } from '../present/links';
import { APP_VERSION } from './appVersion';
import {
  buildInventory, FOLDERS_KEY, GRAPH_PREFIX, hashText, isGraphEntry, isOwnedKey, itemsOf, NODE_PREFIX, parseJson, PRESET_PREFIXES, PRIVATE_KEYS,
  SECTIONS, settingLabel, VERSIONS_PREFIX, walk, type FileNode, type Inventory, type SectionId,
} from './inventory';
import type { MutableKV } from './mutate';
import { filesSources, type FilesSource } from './sources';

export const PROFILE_KIND = 'shader-studio-profile';
export const MANIFEST_FILE = 'manifest.json';
/** Kept on this machine when everything is replaced: where its backups go. */
const DEVICE_KEYS = new Set(['shader-studio:settings:backupDir', 'shader-studio:settings:recordings']);
const LIST_KEYS = new Set(['shader-studio:glsl-shaders', 'shader-studio:palette-presets', 'shader-studio:finish-presets', 'shader-studio:finish-effects', 'shader-studio:finish-looks', 'shader-studio-backgrounds:palettes', 'shader-studio:play:savedScripts', 'shader-studio:play:layerKinds', 'fn_builder_saved_fns_v1', 'fn_builder_groups_v1']);
/** Lists whose items sit in folders by id: a renamed copy keeps its folder. */
const LIST_SCOPES: Record<string, string> = { 'shader-studio:play:layerKinds': 'layerKinds', 'shader-studio-backgrounds:palettes': 'backgrounds:palettes' };

export interface ProfileManifest {
  kind: typeof PROFILE_KIND;
  format: 1;
  app: { name: 'Shader Studio'; version: string };
  createdAt: number;
  scope: 'everything' | 'selection';
  options: { versions: boolean; dependencies: boolean };
  sections: Partial<Record<SectionId, { count: number; size: number }>>;
  total: { count: number; size: number };
  items: Array<{ section: SectionId; kind: string; label: string; size: number }>;
  /** Items of IndexedDB stores (sources.ts); their files sit in the store's own layout. */
  external: Array<{ source: string; section: SectionId; id: string; name: string; size: number }>;
}

export interface Profile {
  snapshot: LibrarySnapshot;
  manifest: ProfileManifest | null;
  /** The ZIP's other files, from its root folder (the stores' files: backgrounds/…). */
  files: Record<string, Uint8Array>;
}

/** An external store's part of a ZIP: its files, and its items for the manifest. */
export interface ExternalPart { files: Record<string, Uint8Array>; items: ProfileManifest['external'] }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);

/** A read-only KV over a snapshot's items (to build an inventory of what is in a ZIP). */
export function snapshotKV(items: Record<string, string>): MutableKV {
  const data = new Map(Object.entries(items));
  return { keys: () => [...data.keys()], get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); }, remove: k => { data.delete(k); } };
}

// ── What goes in ────────────────────────────────────────────────────────────

/** Everything this browser keeps, sign-ins left out. */
export function everythingSnapshot(kv: MutableKV, now = Date.now()): LibrarySnapshot {
  const items: Record<string, string> = {};
  for (const k of kv.keys()) {
    if (!isOwnedKey(k) || PRIVATE_KEYS.has(k)) continue;
    const v = kv.get(k);
    if (v != null) items[k] = v;
  }
  return { kind: LIBRARY_KIND, version: 1, savedAt: now, items };
}

export interface SelectionOptions { versions?: boolean; dependencies?: boolean }

/** Selected things (and folders), as a snapshot of just them. */
export function selectionSnapshot(kv: MutableKV, inv: Inventory, ids: Iterable<string>, opts: SelectionOptions = {}, now = Date.now()): {
  snapshot: LibrarySnapshot; items: FileNode[]; dependencies: FileNode[]; external: Array<{ source: string; id: string }>;
} {
  const idList = [...ids];
  const chosen = itemsOf(inv, idList).filter(n => !n.private);
  const deps: FileNode[] = [];
  if (opts.dependencies) {
    const have = new Set(chosen.map(n => n.id));
    const queue = [...chosen];
    while (queue.length) {
      const n = queue.shift()!;
      for (const u of n.uses ?? []) {
        const d = inv.byId.get(u);
        if (!d || have.has(d.id)) continue;
        have.add(d.id); deps.push(d); queue.push(d);
      }
    }
  }
  const all = [...chosen, ...deps];
  const items: Record<string, string> = {};
  const listPicks = new Map<string, Array<{ field: string; value: string | number }>>();
  const external: Array<{ source: string; id: string }> = [];
  const memberships = new Map<string, Set<string>>();
  for (const n of all) {
    const r = n.ref;
    if (!r) continue;
    if (r.t === 'key') { const v = kv.get(r.key); if (v != null) items[r.key] = v; }
    else if (r.t === 'part' && r.path.length === 0 && r.match) { const l = listPicks.get(r.key) ?? []; l.push(r.match); listPicks.set(r.key, l); }
    else if (r.t === 'external') external.push({ source: r.source, id: r.id });
    if (opts.versions) for (const x of n.extraRefs ?? []) if (x.t === 'key') { const v = kv.get(x.key); if (v != null) items[x.key] = v; }
    if (n.membership) { const s = memberships.get(n.membership.scope) ?? new Set(); s.add(n.membership.id); memberships.set(n.membership.scope, s); }
  }
  for (const [key, picks] of listPicks) {
    const list = parseJson(kv.get(key));
    if (!Array.isArray(list)) continue;
    const kept = list.filter(el => picks.some(p => obj(el)?.[p.field] === p.value));
    if (kept.length) items[key] = JSON.stringify(kept);
  }
  // Folders: the ones the chosen things sit in, and folders chosen themselves (even empty).
  const chosenFolders = new Map<string, Set<string>>();
  for (const id of idList) for (const n of walk([inv.byId.get(id)!].filter(Boolean))) {
    if (n.kind === 'folder' && n.ref?.t === 'folder') { const s = chosenFolders.get(n.ref.scope) ?? new Set(); s.add(n.ref.folderId); chosenFolders.set(n.ref.scope, s); }
  }
  const store = obj(parseJson(kv.get(FOLDERS_KEY)));
  if (store && (memberships.size || chosenFolders.size)) {
    const out: Record<string, { folders: unknown[]; membership: Record<string, string> }> = {};
    for (const [scope, data] of Object.entries(store)) {
      const d = obj(data);
      const members = Object.fromEntries(Object.entries(obj(d?.membership) ?? {}).filter(([id]) => memberships.get(scope)?.has(id))) as Record<string, string>;
      const want = new Set([...Object.values(members), ...chosenFolders.get(scope) ?? []]);
      const folders = (Array.isArray(d?.folders) ? d.folders : []).filter(f => want.has(obj(f)?.id as string));
      if (folders.length) out[scope] = { folders, membership: members };
    }
    if (Object.keys(out).length) items[FOLDERS_KEY] = JSON.stringify(out);
  }
  // A chosen setting that isn't an item (Settings is all keys): nothing else to add.
  return { snapshot: { kind: LIBRARY_KIND, version: 1, savedAt: now, items }, items: chosen, dependencies: deps, external };
}

// ── The ZIP ─────────────────────────────────────────────────────────────────

const README = `Shader Studio profile

library.json holds everything in this ZIP. To bring it into Shader Studio,
open the Files page and choose Install (or Preferences → Library → Import a
library, which adds it the same way). manifest.json says what is inside:
the app version it came from, and how many things of each kind, how big.

The folders are the same things as separate files, to look through or to
share one at a time: a graph file opens with Import, a .present.json file
(under presentations/) opens on the Present page, a .glsl file is plain GLSL.
`;


/** Counts and sizes per section of a snapshot (from its own inventory). */
export async function describeProfile(snapshot: LibrarySnapshot): Promise<{ inv: Inventory; sections: ProfileManifest['sections']; items: ProfileManifest['items']; total: { count: number; size: number } }> {
  const inv = await buildInventory(snapshotKV(snapshot.items));
  const sections: ProfileManifest['sections'] = {};
  const items: ProfileManifest['items'] = [];
  for (const s of inv.sections) {
    const its = itemsOf(inv, [s.id]);
    if (!its.length && !s.size) continue;
    sections[s.section] = { count: its.length, size: s.size };
    for (const n of its) items.push({ section: n.section, kind: n.kind, label: n.label, size: n.size });
  }
  return { inv, sections, items, total: { count: items.length, size: inv.total } };
}

export async function buildProfileZip(snapshot: LibrarySnapshot, opts: { scope: 'everything' | 'selection'; name?: string; versions?: boolean; dependencies?: boolean; external?: ExternalPart }): Promise<{ bytes: Uint8Array; name: string; manifest: ProfileManifest }> {
  const name = opts.name ?? libraryZipName(new Date(snapshot.savedAt), opts.scope === 'everything' ? 'profile' : 'selection');
  const root = name.replace(/\.zip$/, '');
  const d = await describeProfile(snapshot);
  const ext = opts.external ?? { files: {}, items: [] };
  for (const e of ext.items) {
    const sec = d.sections[e.section] ?? (d.sections[e.section] = { count: 0, size: 0 });
    sec.count++; sec.size += e.size;
  }
  const manifest: ProfileManifest = {
    kind: PROFILE_KIND, format: 1, app: { name: 'Shader Studio', version: APP_VERSION }, createdAt: snapshot.savedAt, scope: opts.scope,
    options: { versions: opts.scope === 'everything' || !!opts.versions, dependencies: opts.scope === 'everything' || !!opts.dependencies },
    sections: d.sections,
    total: { count: d.total.count + ext.items.length, size: d.total.size + ext.items.reduce((n, e) => n + e.size, 0) },
    items: [...d.items, ...ext.items.map(e => ({ section: e.section, kind: 'background', label: e.name, size: e.size }))],
    external: ext.items,
  };
  const files: Record<string, Uint8Array> = {
    [`${root}/${LIBRARY_FILE}`]: strToU8(JSON.stringify(snapshot)),
    [`${root}/${MANIFEST_FILE}`]: strToU8(JSON.stringify(manifest, null, 1)),
    [`${root}/README.txt`]: strToU8(README),
  };
  for (const [p, c] of Object.entries(readableFiles(snapshot))) {
    if (opts.scope === 'selection' && p === 'settings.json' && !Object.keys(snapshot.items).some(k => !k.startsWith(GRAPH_PREFIX) || k.startsWith('shader-studio:settings'))) continue;
    files[`${root}/${p}`] = strToU8(c);
  }
  for (const [p, b] of Object.entries(ext.files)) files[`${root}/${p}`] = b;
  return { bytes: zipSync(files, { level: 6 }), name, manifest };
}

/** A profile ZIP, a Library export, an old Backup ZIP, a library.json or a .present.json. */
export function readProfile(bytes: Uint8Array): Profile {
  const snapshot = readLibrary(bytes);
  let manifest: ProfileManifest | null = null;
  const files: Record<string, Uint8Array> = {};
  if (bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const all = unzipSync(bytes);
    const lib = Object.keys(all).find(p => p === LIBRARY_FILE || p.endsWith(`/${LIBRARY_FILE}`));
    const root = lib ? lib.slice(0, -LIBRARY_FILE.length) : '';
    const m = parseJson(all[root + MANIFEST_FILE] ? strFromU8(all[root + MANIFEST_FILE]) : null) as ProfileManifest | undefined;
    if (m && m.kind === PROFILE_KIND) manifest = m;
    for (const [p, b] of Object.entries(all)) {
      if (!p.startsWith(root) || p.endsWith('/')) continue;
      const rel = p.slice(root.length);
      if (rel === LIBRARY_FILE || rel === MANIFEST_FILE || rel === 'README.txt') continue;
      files[rel] = b;
    }
  }
  return { snapshot, manifest, files };
}

// ── Install ─────────────────────────────────────────────────────────────────

export type InstallStatus = 'new' | 'same' | 'rename' | 'keep' | 'merge';

export interface InstallRow {
  section: SectionId;
  label: string;
  kind: string;
  size: number;
  status: InstallStatus;
  /** The name it comes in as (rename). */
  as?: string;
}

/** `name`, else `name (2)`, `name (3)`… whichever isn't taken ("Sunset (2)" counts on from 2). */
export function freeName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  const base = name.replace(/ \(\d+\)$/, '');
  let i = 2;
  while (taken(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

/** Is this already here as an earlier install's "Name (2)", "Name (3)"…? */
function earlierCopy(name: string, get: (n: string) => string | null, same: (v: string) => boolean): boolean {
  const base = name.replace(/ \(\d+\)$/, '');
  for (let i = 2; ; i++) {
    const v = get(`${base} (${i})`);
    if (v == null) return false;
    if (same(v)) return true;
  }
}

type Op = { set: [string, string] } | { remove: string };

interface Plan { rows: InstallRow[]; ops: Op[]; folders: { remap: Array<{ scope: string; from: string; to: string }> } }

/** Content without the fields a save stamps (for "is it the same"). */
function sameContent(a: unknown, b: unknown, drop: string[]): boolean {
  const strip = (v: unknown) => { const o = obj(v); if (!o) return JSON.stringify(v); const c = { ...o }; for (const d of drop) delete c[d]; return JSON.stringify(c); };
  return strip(a) === strip(b);
}

function graphHash(v: string | null): string {
  const g = obj(parseJson(v));
  return g ? hashText(JSON.stringify([g.nodes, g.looseGroups ?? null, g.play ?? null, g.datasets ?? null])) : '';
}

function sectionOfKey(key: string): SectionId {
  if (key.startsWith(PRESENTATION_KEY_PREFIX)) return 'presentations';
  if (key.startsWith(NODE_PREFIX)) return 'nodes';
  const p = PRESET_PREFIXES.find(x => key.startsWith(x.prefix));
  if (p) return p.section;
  if (key === 'shader-studio:glsl-shaders') return 'glsl';
  if (key === 'shader-studio:palette-presets') return 'backgrounds';
  if (key === 'shader-studio:finish-presets' || key === 'shader-studio:finish-effects' || key === 'shader-studio:finish-looks') return 'presets';
  if (key === 'shader-studio:play:savedScripts' || key === 'shader-studio:play:layerKinds') return 'scripts';
  if (key.startsWith('fn_builder_')) return 'functions';
  return 'settings';
}

/** What a merge would do, row by row, and the writes that do it. */
function planMerge(snapshot: LibrarySnapshot, kv: MutableKV): Plan {
  const rows: InstallRow[] = [];
  const ops: Op[] = [];
  const remap: Plan['folders']['remap'] = [];
  const written = new Map<string, string>();
  const get = (k: string) => (written.has(k) ? written.get(k)! : kv.get(k));
  const set = (k: string, v: string) => { written.set(k, v); ops.push({ set: [k, v] }); };
  const inc = snapshot.items;
  // Every graph and presentation of the import → its name here, and the ones written (for their links).
  const graphNames = new Map<string, string>(), presNames = new Map<string, string>();
  const wrote = { graphs: [] as string[], presentations: [] as string[] };

  for (const [key, value] of Object.entries(inc)) {
    if (!isOwnedKey(key) || PRIVATE_KEYS.has(key) || key.startsWith(VERSIONS_PREFIX) || key === FOLDERS_KEY) continue;
    const parsed = parseJson(value);
    const mine = get(key);

    if (isGraphEntry(key, parsed)) {
      const name = key.slice(GRAPH_PREFIX.length);
      const row: InstallRow = { section: 'graphs', label: name, kind: 'graph', size: key.length + value.length + (inc[VERSIONS_PREFIX + name]?.length ?? 0), status: 'new' };
      const hist = inc[VERSIONS_PREFIX + name];
      const h = graphHash(value);
      if (mine == null) { set(key, value); if (hist && get(VERSIONS_PREFIX + name) == null) set(VERSIONS_PREFIX + name, hist); graphNames.set(name, name); wrote.graphs.push(name); }
      else if (graphHash(mine) === h || earlierCopy(name, n => get(GRAPH_PREFIX + n), v => graphHash(v) === h)) { row.status = 'same'; graphNames.set(name, name); }
      else {
        const to = freeName(name, n => get(GRAPH_PREFIX + n) != null);
        set(GRAPH_PREFIX + to, value);
        graphNames.set(name, to); wrote.graphs.push(to);
        if (hist) set(VERSIONS_PREFIX + to, hist);
        remap.push({ scope: 'graphs', from: name, to });
        Object.assign(row, { status: 'rename', as: to });
      }
      rows.push(row);
      continue;
    }

    if (key.startsWith(PRESENTATION_KEY_PREFIX)) {
      const name = key.slice(PRESENTATION_KEY_PREFIX.length);
      const p = parsePresentation(parsed);
      if (!p) continue;
      // Script layers from a file are someone else's code: they run in a sandboxed frame.
      if (p.sources.some(src => src.bundle.play.layers.some(l => l.kind === 'script'))) p.origin = 'imported';
      const row: InstallRow = { section: 'presentations', label: name, kind: 'presentation', size: key.length + value.length, status: 'new' };
      // Kept as stored (the app parses it again on load); only the imported mark and the title are added.
      const stored = { ...obj(parsed), title: name, ...(p.origin ? { origin: p.origin } : {}) };
      const text = JSON.stringify(stored) === value ? value : JSON.stringify(stored);
      if (mine == null) { set(key, text); presNames.set(name, name); wrote.presentations.push(name); }
      else if (sameContent(parsePresentation(parseJson(mine)), p, ['title', 'updatedAt', 'createdAt', 'origin', 'linkedGraphs'])
        || earlierCopy(name, n => get(PRESENTATION_KEY_PREFIX + n), v => sameContent(parsePresentation(parseJson(v)), p, ['title', 'updatedAt', 'createdAt', 'origin', 'linkedGraphs']))) { row.status = 'same'; presNames.set(name, name); }
      else {
        const to = freeName(name, n => get(PRESENTATION_KEY_PREFIX + n) != null);
        set(PRESENTATION_KEY_PREFIX + to, JSON.stringify({ ...stored, title: to }));
        presNames.set(name, to); wrote.presentations.push(to);
        remap.push({ scope: PRESENTATION_FOLDER_SCOPE, from: name, to });
        Object.assign(row, { status: 'rename', as: to });
      }
      rows.push(row);
      continue;
    }

    const preset = PRESET_PREFIXES.find(x => key.startsWith(x.prefix));
    if (preset || key.startsWith(NODE_PREFIX)) {
      const p = obj(parsed) ?? {};
      const label = typeof p.label === 'string' ? p.label : key.split(':').pop()!;
      const row: InstallRow = { section: preset?.section ?? 'nodes', label, kind: preset ? (preset.section === 'functions' ? 'function' : 'preset') : 'node', size: key.length + value.length, status: 'new' };
      if (mine == null) set(key, value);
      else if (sameContent(parseJson(mine), p, ['savedAt'])) row.status = 'same';
      else if (!preset) row.status = 'keep';
      else if (earlierCopy(key, k => get(k.replace(/ \((\d+)\)$/, '_$1')), v => sameContent({ ...obj(parseJson(v)), id: 0, label: 0 }, { ...p, id: 0, label: 0 }, ['savedAt']))) row.status = 'same'; // a node type's id is what graphs point at: yours stays
      else {
        const prefix = preset.prefix;
        const id = key.slice(prefix.length);
        let n = 2;
        while (get(`${prefix}${id}_${n}`) != null) n++;
        const newId = `${id}_${n}`;
        const labels = new Set<string>();
        for (const k of [...kv.keys(), ...written.keys()]) if (k.startsWith(prefix)) { const l = obj(parseJson(get(k)))?.label; if (typeof l === 'string') labels.add(l); }
        const to = freeName(label, x => labels.has(x));
        set(prefix + newId, JSON.stringify({ ...p, id: newId, label: to }));
        if (preset.scope) remap.push({ scope: preset.scope, from: id, to: newId });
        Object.assign(row, { status: 'rename', as: to });
      }
      rows.push(row);
      continue;
    }

    if (LIST_KEYS.has(key) && Array.isArray(parsed)) {
      const list: Obj[] = Array.isArray(parseJson(mine)) ? [...parseJson(mine) as Obj[]] : [];
      const section = sectionOfKey(key);
      let changed = false;
      for (const el of parsed.map(obj).filter((x): x is Obj => !!x)) {
        const nameField = typeof el.name === 'string' ? 'name' : 'label';
        const label = String(el[nameField] ?? 'Untitled');
        const row: InstallRow = { section, label, kind: key.split(':').pop()!, size: JSON.stringify(el).length, status: 'new' };
        const byId = typeof el.id === 'string' ? list.find(x => x.id === el.id) : undefined;
        const byName = list.find(x => x[nameField] === label);
        const copyOf = (x: Obj) => sameContent({ ...x, id: 0, [nameField]: 0 }, { ...el, id: 0, [nameField]: 0 }, ['savedAt']);
        const base = label.replace(/ \(\d+\)$/, '');
        const earlier = list.some(x => typeof x[nameField] === 'string' && (x[nameField] as string).startsWith(`${base} (`) && copyOf(x));
        if (byId ? sameContent(byId, el, ['savedAt']) || earlier : byName && sameContent({ ...byName, id: 0 }, { ...el, id: 0 }, ['savedAt'])) row.status = 'same';
        else if (byId || byName) {
          const to = freeName(label, x => list.some(y => y[nameField] === x));
          const newId = typeof el.id === 'string' ? freeName(el.id, x => list.some(y => y.id === x)).replace(/ \((\d+)\)$/, '_$1') : el.id;
          list.push({ ...el, id: newId, [nameField]: to });
          if (LIST_SCOPES[key] && typeof el.id === 'string') remap.push({ scope: LIST_SCOPES[key], from: el.id, to: String(newId) });
          Object.assign(row, { status: 'rename', as: to });
          changed = true;
        } else { list.push(el); changed = true; }
        rows.push(row);
      }
      if (changed) set(key, JSON.stringify(list));
      continue;
    }

    // Settings and everything else: new ones come in; yours stay; maps and lists merge (yours win).
    const row: InstallRow = { section: sectionOfKey(key), label: settingLabel(key), kind: 'setting', size: key.length + value.length, status: 'new' };
    if (mine == null) set(key, value);
    else if (mine === value) row.status = 'same';
    else {
      const a = parseJson(mine), b = parseJson(value);
      const merged = a && b && typeof a === 'object' && typeof b === 'object' ? JSON.stringify(mergeJson(a, b)) : null;
      if (merged && merged !== mine) { set(key, merged); row.status = 'merge'; } else row.status = 'keep';
    }
    rows.push(row);
  }

  // Graphs and presentations linked to each other stay linked under their names here.
  fixImportedLinks({ get, set }, graphNames, presNames, wrote);

  // Folders: theirs join yours; renamed things keep their folder.
  const theirs = obj(parseJson(inc[FOLDERS_KEY]));
  if (theirs) {
    const copy = JSON.parse(JSON.stringify(theirs)) as Record<string, { membership?: Record<string, string> }>;
    for (const r of remap) { const m = copy[r.scope]?.membership; if (m && m[r.from]) { m[r.to] = m[r.from]; delete m[r.from]; } }
    const merged = JSON.stringify(mergeJson(parseJson(get(FOLDERS_KEY)) ?? {}, copy));
    if (merged !== get(FOLDERS_KEY)) set(FOLDERS_KEY, merged);
  }
  return { rows, ops, folders: { remap } };
}

export interface InstallPreview {
  manifest: ProfileManifest | null;
  /** The ZIP's own inventory: its sections, sizes and items (localStorage's part). */
  inv: Inventory;
  rows: InstallRow[];
  counts: Record<InstallStatus, number>;
  /** How many of the rows are IndexedDB stores' items (images). */
  external: number;
}

export async function previewInstall(profile: Profile, kv: MutableKV, sources: FilesSource[] = filesSources()): Promise<InstallPreview> {
  const inv = await buildInventory(snapshotKV(profile.snapshot.items));
  const { rows } = planMerge(profile.snapshot, kv);
  let external = 0;
  for (const s of sources) {
    for (const r of await s.preview(profile.files)) { rows.push({ section: s.section, label: r.label, kind: 'background', size: r.size, status: r.status }); external++; }
  }
  const counts: Record<InstallStatus, number> = { new: 0, same: 0, rename: 0, keep: 0, merge: 0 };
  for (const r of rows) counts[r.status]++;
  return { manifest: profile.manifest, inv, rows, counts, external };
}

export interface InstallSummary {
  mode: 'merge' | 'replace';
  added: number;
  renamed: Array<{ from: string; to: string; section: SectionId }>;
  same: number;
  kept: number;
  merged: number;
  /** Keys written (for refreshing the app's caches). */
  changedKeys: string[];
}

/** Add a profile to what is here. Nothing of yours is overwritten. */
export function installMerge(profile: Profile, kv: MutableKV): InstallSummary {
  const plan = planMerge(profile.snapshot, kv);
  const changed = new Set<string>();
  for (const op of plan.ops) if ('set' in op) { kv.set(op.set[0], op.set[1]); changed.add(op.set[0]); }
  return {
    mode: 'merge',
    added: plan.rows.filter(r => r.status === 'new').length,
    renamed: plan.rows.filter(r => r.status === 'rename').map(r => ({ from: r.label, to: r.as!, section: r.section })),
    same: plan.rows.filter(r => r.status === 'same').length,
    kept: plan.rows.filter(r => r.status === 'keep').length,
    merged: plan.rows.filter(r => r.status === 'merge').length,
    changedKeys: [...changed],
  };
}

/** Bring the stores' files (images) in; adds to a summary. */
export async function installSources(profile: Profile, mode: 'merge' | 'replace', summary: InstallSummary, sources: FilesSource[] = filesSources()): Promise<InstallSummary> {
  for (const s of sources) {
    const r = await s.install(profile.files, mode);
    summary.added += r.added;
    summary.same += r.same;
  }
  return summary;
}

/**
 * Replace everything with a profile: first a backup ZIP of what is here goes
 * to `backup` (a download); if that fails or is cancelled nothing changes.
 * Sign-ins and this machine's backup and recordings folders stay.
 */
export async function installReplace(profile: Profile, kv: MutableKV, backup: (zip: { bytes: Uint8Array; name: string }) => Promise<boolean>, opts: { now?: number; sources?: FilesSource[] } = {}): Promise<InstallSummary> {
  const now = opts.now ?? Date.now();
  const sources = opts.sources ?? filesSources();
  const current = everythingSnapshot(kv, now);
  const zip = await buildProfileZip(current, { scope: 'everything', name: libraryZipName(new Date(now), 'backup before install'), external: await externalPart(null, sources) });
  if (!(await backup({ bytes: zip.bytes, name: zip.name }))) throw new Error('The backup wasn’t saved, so nothing was replaced.');
  const changed = new Set<string>();
  for (const k of kv.keys()) if (isOwnedKey(k) && !PRIVATE_KEYS.has(k) && !DEVICE_KEYS.has(k)) { kv.remove(k); changed.add(k); }
  for (const [k, v] of Object.entries(profile.snapshot.items)) {
    if (!isOwnedKey(k) || PRIVATE_KEYS.has(k) || DEVICE_KEYS.has(k)) continue;
    kv.set(k, v); changed.add(k);
  }
  const added = (await describeProfile(profile.snapshot)).total.count;
  return installSources(profile, 'replace', { mode: 'replace', added, renamed: [], same: 0, kept: 0, merged: 0, changedKeys: [...changed] }, sources);
}

/** The stores' part of a ZIP: every item's files (refs null) or these, with manifest entries named from their lists. */
export async function externalPart(refs: Array<{ source: string; id: string }> | null, sources: FilesSource[] = filesSources()): Promise<ExternalPart> {
  const out: ExternalPart = { files: {}, items: [] };
  for (const s of sources) {
    const ids = refs ? refs.filter(r => r.source === s.id).map(r => r.id) : null;
    if (ids && !ids.length) continue;
    const listed = await s.list();
    const want = ids ? listed.filter(i => ids.includes(i.id)) : listed;
    if (!want.length) continue;
    Object.assign(out.files, await s.zipFiles(ids));
    for (const i of want) out.items.push({ source: s.id, section: s.section, id: i.id, name: i.label, size: i.size });
  }
  return out;
}

/** Section labels for rows and summaries. */
export const sectionLabel = (id: SectionId) => SECTIONS.find(s => s.id === id)?.label ?? id;
