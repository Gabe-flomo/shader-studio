/**
 * presetStore.ts — one API for every kind of preset (docs/presets.md, "One preset store").
 *
 * Playfield grew a preset store per subsystem: Transform Vec, group, keyframe, function and
 * Expression Block presets (one localStorage key each, `shader-studio:<p>:<id>`), the builders'
 * presets (one list per builder), Play's layer sets, racks and drum kits, the Finish stack's
 * presets, effects and looks, palettes… This module puts them behind one interface without
 * moving their data: every kind is described by where it already lives (a key prefix or one list
 * key, and the field its name is in), so reading and writing go to the very same keys and records
 * as before. A kind can override any operation when its module keeps state in memory (the
 * builders' zustand stores) or does extra work (a background palette's folder).
 *
 * Kinds register themselves in presetKinds.ts, grouped by what they apply to (nodes in the graph,
 * the Scene builders, Play, the Finish stack, colour), and the Library's Presets filter and
 * <PresetMenu> list them from here.
 *
 *   list(kind)            your presets (built-ins separately: builtIns(kind))
 *   save(kind, name, data, { thumb })
 *   rename(kind, id, name) · remove(kind, id)
 *   folders: the kind's folder scope in the shared folder store (utils/assetFolders.ts)
 *   exportPresets(refs) → a library.json subset · importPresets(text) (never overwrites)
 *
 * Writes never throw: they come back as a FileResult (a full quota, the device's storage limit).
 */
import { useEffect, useState } from 'react';
import { safeSetItem, type FileResult } from '../utils/fileIO';
import { localMutableKV, type MutableKV } from '../files/mutate';
import { LIBRARY_KIND, importLibrary, isLibraryKey, isSnapshot, mergeJson, type LibrarySnapshot } from '../utils/library';
import { removeItemsFromFolders } from '../utils/assetFolders';

/** What a preset applies to: the Presets filter and <PresetMenu> group kinds by this, not by subsystem. */
export type PresetGroupId = 'nodes' | 'builders' | 'play' | 'finish' | 'colour';

export const PRESET_GROUPS: ReadonlyArray<{ id: PresetGroupId; label: string }> = [
  { id: 'nodes', label: 'Nodes in the graph' },
  { id: 'builders', label: 'Scene builders' },
  { id: 'play', label: 'Play: layers and sound' },
  { id: 'finish', label: 'Finish' },
  { id: 'colour', label: 'Colour' },
];

/** Where a kind's presets already live. */
export type PresetStorage =
  /** One key per preset: `<prefix><id>`, holding the record. */
  | { t: 'prefix'; prefix: string; nameField: 'label' | 'name' }
  /** One key holding an array of records with ids. */
  | { t: 'list'; key: string; nameField: 'label' | 'name' };

export interface PresetItem<R = Record<string, unknown>> {
  kind: string;
  id: string;
  name: string;
  /** When it was saved (0 when unknown). */
  savedAt: number;
  /** A small picture of it (a data URL), when the kind keeps one. */
  thumb?: string | null;
  /** Comes with the app: can't be renamed or deleted. */
  builtIn?: boolean;
  /** One line about it (a built-in's blurb, a saved note). */
  hint?: string;
  /** The stored record, untouched (or the built-in's data). */
  record: R;
}

export type SaveResult = FileResult & { id?: string };

export interface PresetKindDef {
  id: string;
  /** Its name in lists: "Vector transforms". */
  label: string;
  /** What it applies to, in words: "Transform Vec node", "3D Scene builder". */
  appliesTo: string;
  group: PresetGroupId;
  storage: PresetStorage;
  /** Its folders' scope in the folder store (the scope its list has always used, where it had one). */
  folderScope: string;
  /** Window events fired after a write, which the kind's own lists listen for. */
  events: readonly string[];
  /** Ids of new presets start with this. */
  idPrefix: string;
  /** The record's picture field ("thumb", "poster"), when it has one. */
  thumbField?: string;
  /** The record's save time field (default "savedAt"). */
  timeField?: string;
  /** The record's one-line field ("note", "description", "blurb"), when it has one. */
  hintField?: string;
  /** Whether a stored record is one of these (corrupt ones are skipped, never rewritten). */
  valid?: (r: Record<string, unknown>) => boolean;
  /** The kind's built-ins, listed before yours. */
  builtIns?: () => PresetItem[];
  /** Refresh in-memory copies after something else wrote the storage (an import, an undo). */
  afterWrite?: () => void;
  /** No folders for this kind (its list is too small, or keeps folders its own way). */
  noFolders?: boolean;
  /** Operations its module does itself (in-memory stores, extra bookkeeping). */
  ops?: Partial<{
    list(): PresetItem[];
    save(name: string, data: Record<string, unknown>, extra: { thumb?: string | null }): SaveResult;
    rename(id: string, name: string): FileResult;
    remove(id: string): FileResult;
  }>;
}

/** Fired on window after any preset write through this store (detail: { kind }). */
export const PRESETS_CHANGED = 'presets-changed';

const KINDS = new Map<string, PresetKindDef>();

export function registerPresetKind(def: PresetKindDef): void { KINDS.set(def.id, def); }
export function presetKinds(): PresetKindDef[] { return [...KINDS.values()]; }
export function presetKind(id: string): PresetKindDef | undefined { return KINDS.get(id); }
/** The kinds of one group, in registration order. */
export const presetKindsIn = (group: PresetGroupId) => presetKinds().filter(k => k.group === group);

// ── Reading ─────────────────────────────────────────────────────────────────

const parse = (v: string | null | undefined): unknown => { if (v == null) return undefined; try { return JSON.parse(v); } catch { return undefined; } };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function itemOf(def: PresetKindDef, r: Record<string, unknown>): PresetItem | null {
  if (typeof r.id !== 'string' || !r.id) return null;
  if (def.valid && !def.valid(r)) return null;
  const nf = def.storage.nameField;
  const name = typeof r[nf] === 'string' && (r[nf] as string).trim() ? (r[nf] as string) : 'Untitled';
  const t = r[def.timeField ?? 'savedAt'];
  const thumb = def.thumbField && typeof r[def.thumbField] === 'string' ? (r[def.thumbField] as string) : undefined;
  const hint = def.hintField && typeof r[def.hintField] === 'string' && (r[def.hintField] as string).trim() ? (r[def.hintField] as string) : undefined;
  return { kind: def.id, id: r.id, name, savedAt: typeof t === 'number' && Number.isFinite(t) ? t : 0, ...(thumb ? { thumb } : {}), ...(hint ? { hint } : {}), record: r };
}

/** The records of a list kind, as stored (never normalised, so nothing of theirs is lost on a write). */
function readList(kv: MutableKV, key: string): unknown[] {
  const a = parse(kv.get(key));
  return Array.isArray(a) ? a : [];
}

/** Your presets of a kind, oldest first. */
export function listPresets(kindId: string, kv: MutableKV = localMutableKV): PresetItem[] {
  const def = KINDS.get(kindId);
  if (!def) return [];
  if (def.ops?.list && kv === localMutableKV) return def.ops.list();
  const out: PresetItem[] = [];
  const s = def.storage;
  if (s.t === 'prefix') {
    for (const k of kv.keys()) {
      if (!k.startsWith(s.prefix)) continue;
      const r = parse(kv.get(k));
      if (!isObj(r)) continue;
      const it = itemOf(def, r);
      if (it) out.push(it);
    }
  } else {
    for (const r of readList(kv, s.key)) {
      if (!isObj(r)) continue;
      const it = itemOf(def, r);
      if (it) out.push(it);
    }
  }
  return out.sort((a, b) => a.savedAt - b.savedAt);
}

export function builtInPresets(kindId: string): PresetItem[] {
  return KINDS.get(kindId)?.builtIns?.() ?? [];
}

/** Every kind's presets (yours), by kind id. */
export function listAllPresets(kv: MutableKV = localMutableKV): Map<string, PresetItem[]> {
  return new Map(presetKinds().map(k => [k.id, listPresets(k.id, kv)]));
}

/** The storage keys a kind's presets (or the given ones) live in: what an undo restores and an export carries. */
export function presetKeys(kindId: string, ids?: readonly string[], kv: MutableKV = localMutableKV): string[] {
  const def = KINDS.get(kindId);
  if (!def) return [];
  if (def.storage.t === 'list') return [def.storage.key];
  const prefix = def.storage.prefix;
  return ids ? ids.map(id => prefix + id) : kv.keys().filter(k => k.startsWith(prefix));
}

// ── Writing ─────────────────────────────────────────────────────────────────

function put(kv: MutableKV, key: string, value: string, what: string): FileResult {
  if (kv === localMutableKV) return safeSetItem(key, value, what);
  try { kv.set(key, value); return { ok: true }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/**
 * Tell the kind's lists (its own events, then everyone's) that its presets changed. `reload`
 * (the default) first refreshes the kind's in-memory copies from storage: an import or an undo
 * wrote it; the kind's own operations keep their memory current themselves.
 */
export function notifyPresets(kindId: string, reload = true): void {
  const def = KINDS.get(kindId);
  if (reload) { try { def?.afterWrite?.(); } catch { /* a list that can't refresh refreshes on its next read */ } }
  if (typeof window === 'undefined') return;
  for (const ev of def?.events ?? []) window.dispatchEvent(new Event(ev));
  window.dispatchEvent(new CustomEvent(PRESETS_CHANGED, { detail: { kind: kindId } }));
}

let seq = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`;

/** Save a preset of a kind: `data` is the record's own fields (the name, id and time are added). */
export function savePreset(kindId: string, name: string, data: Record<string, unknown>, extra: { thumb?: string | null } = {}, kv: MutableKV = localMutableKV): SaveResult {
  const def = KINDS.get(kindId);
  if (!def) return { ok: false, error: `No preset kind “${kindId}”` };
  const n = name.trim() || 'Untitled';
  if (def.ops?.save && kv === localMutableKV) { const r = def.ops.save(n, data, extra); if (r.ok || r.id) notifyPresets(kindId, false); return r; }
  const id = newId(def.idPrefix);
  const record: Record<string, unknown> = { ...data, id, [def.storage.nameField]: n, [def.timeField ?? 'savedAt']: Date.now() };
  if (def.thumbField && extra.thumb) record[def.thumbField] = extra.thumb;
  const s = def.storage;
  const r = s.t === 'prefix'
    ? put(kv, s.prefix + id, JSON.stringify(record), `preset “${n}”`)
    : put(kv, s.key, JSON.stringify([...readList(kv, s.key), record]), `preset “${n}”`);
  if (r.ok && kv === localMutableKV) notifyPresets(kindId);
  return r.ok ? { ok: true, id } : r;
}

export function renamePreset(kindId: string, id: string, name: string, kv: MutableKV = localMutableKV): FileResult {
  const def = KINDS.get(kindId);
  if (!def) return { ok: false, error: `No preset kind “${kindId}”` };
  const n = name.trim();
  if (!n) return { ok: false, error: 'A preset needs a name.' };
  if (def.ops?.rename && kv === localMutableKV) { const r = def.ops.rename(id, n); if (r.ok) notifyPresets(kindId, false); return r; }
  const s = def.storage;
  let r: FileResult;
  if (s.t === 'prefix') {
    const rec = parse(kv.get(s.prefix + id));
    if (!isObj(rec)) return { ok: false, error: 'That preset is gone.' };
    r = put(kv, s.prefix + id, JSON.stringify({ ...rec, [s.nameField]: n }), `preset “${n}”`);
  } else {
    const list = readList(kv, s.key);
    if (!list.some(x => isObj(x) && x.id === id)) return { ok: false, error: 'That preset is gone.' };
    r = put(kv, s.key, JSON.stringify(list.map(x => (isObj(x) && x.id === id ? { ...x, [s.nameField]: n } : x))), `preset “${n}”`);
  }
  if (r.ok && kv === localMutableKV) notifyPresets(kindId);
  return r;
}

export function removePreset(kindId: string, id: string, kv: MutableKV = localMutableKV): FileResult {
  const def = KINDS.get(kindId);
  if (!def) return { ok: false, error: `No preset kind “${kindId}”` };
  if (def.ops?.remove && kv === localMutableKV) {
    const r = def.ops.remove(id);
    if (r.ok) { if (!def.noFolders) { try { removeItemsFromFolders(def.folderScope, [id]); } catch { /* folders are a convenience */ } } notifyPresets(kindId, false); }
    return r;
  }
  const s = def.storage;
  let r: FileResult = { ok: true };
  if (s.t === 'prefix') kv.remove(s.prefix + id);
  else r = put(kv, s.key, JSON.stringify(readList(kv, s.key).filter(x => !(isObj(x) && x.id === id))), 'presets');
  if (r.ok && kv === localMutableKV) {
    if (!def.noFolders) { try { removeItemsFromFolders(def.folderScope, [id]); } catch { /* folders are a convenience */ } }
    notifyPresets(kindId);
  }
  return r;
}

// ── Export and import ───────────────────────────────────────────────────────

export interface PresetRef { kind: string; id: string }

/**
 * The given presets as a library.json (utils/library.ts): only their keys, a list kind's key cut
 * down to them, and their folders. Any Playfield imports it (Library → Import, Files, Import),
 * adding what's new and never overwriting.
 */
export function exportPresets(refs: readonly PresetRef[], kv: MutableKV = localMutableKV): LibrarySnapshot {
  const items: Record<string, string> = {};
  const byKind = new Map<string, string[]>();
  for (const r of refs) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.id]);
  const folders: Record<string, { folders: unknown[]; membership: Record<string, string> }> = {};
  const store = (parse(kv.get('assetbrowser_folders')) ?? {}) as Record<string, { folders?: Array<{ id: string }>; membership?: Record<string, string> }>;
  for (const [kindId, ids] of byKind) {
    const def = KINDS.get(kindId);
    if (!def) continue;
    const s = def.storage;
    if (s.t === 'prefix') {
      for (const id of ids) { const v = kv.get(s.prefix + id); if (v != null) items[s.prefix + id] = v; }
    } else {
      const want = new Set(ids);
      const theirs = readList(kv, s.key).filter(x => isObj(x) && typeof x.id === 'string' && want.has(x.id));
      if (theirs.length) items[s.key] = JSON.stringify(theirs);
    }
    const sc = store[def.folderScope];
    if (sc?.membership) {
      const membership = Object.fromEntries(Object.entries(sc.membership).filter(([id]) => ids.includes(id)));
      const used = new Set(Object.values(membership));
      if (used.size) folders[def.folderScope] = { folders: (sc.folders ?? []).filter(f => used.has(f.id)), membership };
    }
  }
  if (Object.keys(folders).length) items.assetbrowser_folders = JSON.stringify(folders);
  return { kind: LIBRARY_KIND, version: 1, savedAt: Date.now(), items };
}

/** The kinds a library's keys belong to. */
export function kindsInSnapshot(s: LibrarySnapshot): string[] {
  const out = new Set<string>();
  for (const k of Object.keys(s.items)) {
    for (const def of KINDS.values()) {
      if (def.storage.t === 'prefix' ? k.startsWith(def.storage.prefix) : k === def.storage.key) out.add(def.id);
    }
  }
  return [...out];
}

/** Bring presets in from a library.json's text: new ones are added, yours are never overwritten. */
export function importPresets(text: string, kv: MutableKV = localMutableKV): { ok: true; added: number; same: number; kept: number; kinds: string[]; renamed: string[] } | { ok: false; error: string } {
  const s = parse(text);
  if (!isSnapshot(s)) return { ok: false, error: 'Not a Playfield presets file.' };
  const kinds = kindsInSnapshot(s);
  const r = importLibrary(s, kv);
  // Keys the library leaves alone (the builders' `playfield:` lists) but a preset kind owns: merged the same way.
  for (const [k, v] of Object.entries(s.items)) {
    if (isLibraryKey(k) || !presetKinds().some(d => (d.storage.t === 'prefix' ? k.startsWith(d.storage.prefix) : k === d.storage.key))) continue;
    const mine = kv.get(k);
    if (mine == null) { kv.set(k, v); r.added++; continue; }
    if (mine === v) { r.same++; continue; }
    const a = parse(mine), b = parse(v);
    if (Array.isArray(a) && Array.isArray(b)) {
      const merged = JSON.stringify(mergeJson(a, b));
      if (merged !== mine) { kv.set(k, merged); r.added++; } else r.same++;
    } else r.kept++;
  }
  if (kv === localMutableKV) {
    for (const k of kinds) notifyPresets(k);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('assetbrowser-folders-changed'));
  }
  return { ok: true, added: r.added, same: r.same, kept: r.kept, kinds, renamed: r.renamed };
}

// ── React ───────────────────────────────────────────────────────────────────

/** A kind's presets (yours and its built-ins), kept current as they change anywhere (this tab or another). */
export function usePresets(kindId: string): { mine: PresetItem[]; builtIns: PresetItem[] } {
  const [mine, setMine] = useState(() => listPresets(kindId));
  const [builtIns] = useState(() => builtInPresets(kindId));
  useEffect(() => {
    const def = KINDS.get(kindId);
    const refresh = () => setMine(listPresets(kindId));
    refresh();
    const evs = [PRESETS_CHANGED, ...(def?.events ?? [])];
    const onStorage = (e: StorageEvent) => {
      const s = def?.storage;
      if (!s || !e.key || (s.t === 'prefix' ? e.key.startsWith(s.prefix) : e.key === s.key)) refresh();
    };
    for (const ev of evs) window.addEventListener(ev, refresh);
    window.addEventListener('storage', onStorage);
    return () => { for (const ev of evs) window.removeEventListener(ev, refresh); window.removeEventListener('storage', onStorage); };
  }, [kindId]);
  return { mine, builtIns };
}

/** Every preset of every kind, kept current (the Library's Presets filter). */
export function useAllPresets(): Map<string, PresetItem[]> {
  const [all, setAll] = useState(() => listAllPresets());
  useEffect(() => {
    const refresh = () => setAll(listAllPresets());
    const evs = new Set([PRESETS_CHANGED, ...presetKinds().flatMap(k => k.events)]);
    for (const ev of evs) window.addEventListener(ev, refresh);
    window.addEventListener('storage', refresh);
    return () => { for (const ev of evs) window.removeEventListener(ev, refresh); window.removeEventListener('storage', refresh); };
  }, []);
  return all;
}
