/**
 * cleanup.ts — what the Files page suggests removing, each with its reason:
 * the biggest things, earlier graph versions past the newest few, datasets,
 * media, layer kinds and presentation Plays nothing uses, duplicates (same
 * content under another name), and empty folders.
 */
import { STORAGE_LIMIT } from '../utils/library';
import { walk, type FileNode, type Inventory } from './inventory';

export type CleanupKind = 'big' | 'versions' | 'unused' | 'duplicate' | 'emptyFolder';

export interface Suggestion {
  id: string;
  kind: CleanupKind;
  /** The thing it is about (for showing and jumping to it). */
  nodeId: string;
  label: string;
  reason: string;
  /** What Remove removes. */
  removeIds: string[];
  /** What removing it frees. */
  size: number;
}

export interface CleanupGroup { kind: CleanupKind; title: string; hint: string; items: Suggestion[] }

export interface CleanupOptions {
  /** Earlier versions a graph keeps (the newest ones); the current version always stays. */
  keepVersions?: number;
  /** How many of the biggest things to list. */
  biggest?: number;
}

const pct = (n: number) => { const p = (n / STORAGE_LIMIT) * 100; return p < 1 ? 'under 1%' : `${Math.round(p)}%`; };
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function isItem(n: FileNode): boolean {
  return !n.part && n.kind !== 'section' && n.kind !== 'group' && n.kind !== 'folder' && !!n.ref;
}

/** What makes an item big, when one part is most of it: its deepest part that still holds 40% or more. */
function mostly(n: FileNode): string {
  let best: FileNode | null = null;
  const look = (list: FileNode[] | undefined) => { for (const m of list ?? []) if (m.size >= n.size * 0.4) { if (m.kind !== 'play') best = m; look(m.children); } };
  look(n.children);
  if (!best) return '';
  const b = best as FileNode;
  const what = b.kind === 'media' || b.kind === 'take' || b.kind === 'dataset' || b.kind === 'version' ? `“${b.label}”`
    : b.kind === 'source' ? `the Play “${b.label}”` : b.label.toLowerCase();
  return ` · mostly ${what} (${kb(b.size)})`;
}

export function cleanupSuggestions(inv: Inventory, opts: CleanupOptions = {}): CleanupGroup[] {
  const keep = Math.max(0, opts.keepVersions ?? 5);
  const all = [...walk(inv.sections)];
  const items = all.filter(isItem);

  const biggest = items.filter(n => n.kind !== 'setting').sort((a, b) => b.size - a.size)
    .filter(n => n.size >= Math.max(8 * 1024, STORAGE_LIMIT * 0.01)).slice(0, opts.biggest ?? 8)
    .map<Suggestion>(n => ({ id: `big:${n.id}`, kind: 'big', nodeId: n.id, label: n.label, removeIds: [n.id], size: n.size, reason: n.ref?.t === 'external' ? `${kb(n.size)} in the browser’s file storage (IndexedDB), not its 5 MB for saved work` : `${pct(n.size)} of the browser’s room${mostly(n)}` }));

  const versions: Suggestion[] = [];
  for (const n of all) {
    if (n.kind !== 'versions') continue;
    const old = (n.children ?? []).slice(keep); // children are newest first
    if (!old.length) continue;
    const graph = inv.byId.get(inv.parentOf.get(n.id) ?? '');
    versions.push({
      id: `versions:${n.id}`, kind: 'versions', nodeId: graph?.id ?? n.id, label: graph?.label ?? n.label,
      removeIds: old.map(v => v.id), size: old.reduce((s, v) => s + v.size, 0),
      reason: `${old.length} earlier version${old.length === 1 ? '' : 's'} (${old[old.length - 1].label.replace('Version ', 'v')}${old.length > 1 ? `–${old[0].label.replace('Version ', 'v')}` : ''}) past the newest ${keep}`,
    });
  }

  const unused = all.filter(n => n.unused && n.ref).map<Suggestion>(n => {
    const owner = inv.byId.get(ownerId(inv, n.id));
    return { id: `unused:${n.id}`, kind: 'unused', nodeId: n.id, label: owner && owner.id !== n.id ? `${n.label} · in “${owner.label}”` : n.label, removeIds: [n.id], size: n.size, reason: n.unused! };
  });

  const byHash = new Map<string, FileNode[]>();
  for (const n of items) if (n.hash) { const k = `${n.kind}:${n.hash}`; const l = byHash.get(k) ?? []; l.push(n); byHash.set(k, l); }
  const duplicates: Suggestion[] = [];
  for (const list of byHash.values()) {
    if (list.length < 2) continue;
    // Keep the newest (or the first by name when undated); the rest are the copies.
    const sorted = [...list].sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || a.label.localeCompare(b.label));
    const [kept, ...copies] = sorted;
    for (const c of copies) duplicates.push({ id: `dup:${c.id}`, kind: 'duplicate', nodeId: c.id, label: c.label, removeIds: [c.id], size: c.size, reason: `Same content as “${kept.label}”${kept.modified && kept.modified > (c.modified ?? 0) ? ', which is newer' : ''}` });
  }

  const empty = all.filter(n => n.kind === 'folder' && n.ref && !(n.children?.length)).map<Suggestion>(n => {
    const where = inv.byId.get(inv.parentOf.get(n.id) ?? '');
    return { id: `empty:${n.id}`, kind: 'emptyFolder', nodeId: n.id, label: n.label, removeIds: [n.id], size: 0, reason: `An empty folder in ${where?.label ?? 'a list'}` };
  });

  return ([
    { kind: 'big', title: 'Biggest', hint: 'What takes the most room', items: biggest },
    { kind: 'versions', title: 'Old versions', hint: `Earlier graph versions past the newest ${keep}`, items: versions.sort((a, b) => b.size - a.size) },
    { kind: 'unused', title: 'Not used', hint: 'Images, datasets, media, layer kinds and Plays nothing uses', items: unused.sort((a, b) => b.size - a.size) },
    { kind: 'duplicate', title: 'Duplicates', hint: 'The same content saved twice', items: duplicates.sort((a, b) => b.size - a.size) },
    { kind: 'emptyFolder', title: 'Empty folders', hint: 'Folders with nothing in them', items: empty },
  ] satisfies CleanupGroup[]).filter(g => g.items.length > 0);
}

/** The item a part belongs to (itself for an item). */
export function ownerId(inv: Inventory, id: string): string {
  let cur = id;
  while (inv.byId.get(cur)?.part) { const p = inv.parentOf.get(cur); if (!p) break; cur = p; }
  return cur;
}
