/**
 * mutate.ts — removing things the Files page lists, with Undo.
 *
 * A removal works on StoreRefs: whole keys, parts of a key's JSON (an array
 * element by id, a property by path), folders, and folder memberships. Every
 * key it touches is read first, so Undo puts each one back exactly as it was.
 * External items (IndexedDB sources) are handed back to the caller, which
 * removes them through their source (sources.ts).
 */
import type { KV } from '../utils/library';
import { FOLDERS_KEY, parseJson, walk, type FileNode, type Inventory, type StoreRef } from './inventory';

export interface MutableKV extends KV { remove(key: string): void }

export const localMutableKV: MutableKV = {
  keys: () => { const out: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } return out; },
  get: k => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  remove: k => localStorage.removeItem(k),
};

export function memoryKV(init: Record<string, string> = {}): MutableKV & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, keys: () => [...data.keys()], get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); }, remove: k => { data.delete(k); } };
}

/**
 * What removing these nodes removes: containers (sections, groups, folders)
 * stand for everything in them, and a part inside something that is also
 * being removed is left to its item.
 */
export function expandRemoval(inv: Inventory, ids: Iterable<string>): FileNode[] {
  const chosen = new Map<string, FileNode>();
  for (const id of ids) {
    const n = inv.byId.get(id);
    if (!n) continue;
    for (const m of walk([n])) {
      if (m.kind === 'section' || m.kind === 'group') continue;
      if (m.kind === 'folder' && !m.ref) continue; // GLSL groups: just their shaders
      if (m.ref || m.kind === 'folder') chosen.set(m.id, m);
    }
  }
  // Drop anything whose ancestor is going too.
  return [...chosen.values()].filter(n => {
    let p = inv.parentOf.get(n.id);
    while (p) { if (chosen.has(p) && chosen.get(p)!.kind !== 'folder') return false; p = inv.parentOf.get(p); }
    return true;
  });
}

export interface RemovalResult {
  /** Keys whose value changed (for refreshing the app's caches). */
  changedKeys: string[];
  /** External items to remove through their sources. */
  external: Array<{ source: string; id: string }>;
  undo: () => void;
}

const MARK = Symbol('remove');

/** Remove nodes' stored data (and their folder memberships). Returns Undo. */
export function removeNodes(kv: MutableKV, nodes: FileNode[]): RemovalResult {
  const refs: StoreRef[] = [];
  const memberships: Array<{ scope: string; id: string }> = [];
  for (const n of nodes) {
    if (n.ref) refs.push(n.ref);
    refs.push(...n.extraRefs ?? []);
    if (n.membership) memberships.push(n.membership);
  }
  const touched = new Set<string>();
  for (const r of refs) if (r.t === 'key' || r.t === 'part') touched.add(r.key);
  if (memberships.length || refs.some(r => r.t === 'folder')) touched.add(FOLDERS_KEY);
  const before = new Map<string, string | null>();
  for (const k of touched) before.set(k, kv.get(k));

  const wholeKeys = new Set(refs.filter((r): r is Extract<StoreRef, { t: 'key' }> => r.t === 'key').map(r => r.key));
  // Parts, grouped by key: one parse and one write per key.
  const parts = new Map<string, Array<Extract<StoreRef, { t: 'part' }>>>();
  for (const r of refs) if (r.t === 'part' && !wholeKeys.has(r.key)) { const l = parts.get(r.key) ?? []; l.push(r); parts.set(r.key, l); }

  for (const k of wholeKeys) kv.remove(k);
  for (const [key, list] of parts) {
    const root = parseJson(kv.get(key));
    if (root === undefined) continue;
    const marked = new Map<unknown[], Set<number>>();
    const mark = (a: unknown[], i: number) => { const s = marked.get(a) ?? new Set(); s.add(i); marked.set(a, s); };
    for (const r of list) {
      const at = r.match ? r.path : r.path.slice(0, -1);
      let cur: unknown = root;
      for (const p of at) cur = cur && typeof cur === 'object' ? (cur as Record<string | number, unknown>)[p] : undefined;
      if (r.match) {
        if (!Array.isArray(cur)) continue;
        const { field, value } = r.match;
        cur.forEach((el, i) => { if (field === '#' ? i === value : el && typeof el === 'object' && (el as Record<string, unknown>)[field] === value) mark(cur as unknown[], i); });
      } else {
        const last = r.path[r.path.length - 1];
        if (Array.isArray(cur) && typeof last === 'number') mark(cur, last);
        else if (cur && typeof cur === 'object' && last !== undefined) (cur as Record<string | number, unknown>)[last] = MARK;
      }
    }
    for (const [a, idx] of marked) for (const i of [...idx].sort((x, y) => y - x)) a.splice(i, 1);
    const text = JSON.stringify(root, (_k, v) => (v === MARK ? undefined : v));
    // An emptied history goes altogether; an emptied list stays an empty list.
    if (key.startsWith('shader-studio-versions:') && Array.isArray(root) && root.length === 0) kv.remove(key);
    else kv.set(key, text);
  }

  // Folders and memberships.
  if (touched.has(FOLDERS_KEY)) {
    const store = (parseJson(kv.get(FOLDERS_KEY)) ?? {}) as Record<string, { folders?: Array<{ id: string }>; membership?: Record<string, string> }>;
    for (const m of memberships) if (store[m.scope]?.membership) delete store[m.scope].membership![m.id];
    for (const r of refs) if (r.t === 'folder') {
      const sc = store[r.scope];
      if (!sc) continue;
      sc.folders = (sc.folders ?? []).filter(f => f.id !== r.folderId);
      for (const [k, v] of Object.entries(sc.membership ?? {})) if (v === r.folderId) delete sc.membership![k];
    }
    if (before.get(FOLDERS_KEY) != null || Object.keys(store).length) kv.set(FOLDERS_KEY, JSON.stringify(store));
  }

  const changedKeys = [...touched].filter(k => kv.get(k) !== before.get(k));
  return {
    changedKeys,
    external: refs.filter((r): r is Extract<StoreRef, { t: 'external' }> => r.t === 'external').map(r => ({ source: r.source, id: r.id })),
    undo: () => { for (const [k, v] of before) { if (v == null) kv.remove(k); else kv.set(k, v); } },
  };
}

/** Delete a folder but keep what is in it (they become loose items of the list). */
export function removeFolderKeepItems(kv: MutableKV, scope: string, folderId: string): () => void {
  const before = kv.get(FOLDERS_KEY);
  const store = (parseJson(before) ?? {}) as Record<string, { folders?: Array<{ id: string }>; membership?: Record<string, string> }>;
  const sc = store[scope];
  if (sc) {
    sc.folders = (sc.folders ?? []).filter(f => f.id !== folderId);
    for (const [k, v] of Object.entries(sc.membership ?? {})) if (v === folderId) delete sc.membership![k];
    kv.set(FOLDERS_KEY, JSON.stringify(store));
  }
  return () => { if (before == null) kv.remove(FOLDERS_KEY); else kv.set(FOLDERS_KEY, before); };
}

/** What removing these breaks or loses, in words, for the confirmation. Empty when nothing else uses them. */
export function removalWarnings(nodes: FileNode[]): { breaks: string[]; copies: string[] } {
  const going = new Set<string>();
  for (const n of nodes) for (const m of walk([n])) going.add(m.id);
  const breaks = new Set<string>(), copies = new Set<string>();
  for (const n of nodes) for (const m of walk([n])) for (const u of m.usedBy ?? []) {
    if (u.id && going.has(u.id)) continue;
    const where = u.where ? ` (${u.where.replace(/ \(a copy\)$/, '')})` : '';
    if (u.breaks) breaks.add(`“${u.label}”${where} loses “${m.label}”`);
    else copies.add(`“${u.label}”${where} keeps its own copy of “${m.label}”`);
  }
  return { breaks: [...breaks], copies: [...copies] };
}
