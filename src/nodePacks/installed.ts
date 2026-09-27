/**
 * Node packs that came in (docs/node-packs.md, "Opening a pack"): which node
 * types each brought, the category they're listed under, and the example
 * graphs and presentations that came with it, so the node list can show the
 * pack's entry with its examples a click away.
 *
 * One localStorage key holding every pack by id. Storage is guarded so the
 * module loads in tests.
 */
import type { InstalledPack } from './types';

export const INSTALLED_PACKS_KEY = 'shader-studio-nodepacks:installed';
export const INSTALLED_PACKS_CHANGED = 'nodepacks-installed-changed';

interface KV { get(k: string): string | null; set(k: string, v: string): void }
const localKV: KV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* full or blocked */ } },
};

export function installedPacks(kv: KV = localKV): InstalledPack[] {
  try {
    const raw = JSON.parse(kv.get(INSTALLED_PACKS_KEY) ?? '{}') as Record<string, InstalledPack>;
    return Object.values(raw && typeof raw === 'object' ? raw : {}).filter(p => p && typeof p.name === 'string' && Array.isArray(p.nodeIds));
  } catch { return []; }
}

/** Remember a pack (a newer copy of the same pack replaces the older record). */
export function recordInstalledPack(pack: InstalledPack, kv: KV = localKV): void {
  let all: Record<string, InstalledPack> = {};
  try { all = JSON.parse(kv.get(INSTALLED_PACKS_KEY) ?? '{}') as Record<string, InstalledPack>; } catch { /* start again */ }
  const had = all[pack.id];
  // Examples that came with an earlier version stay listed.
  all[pack.id] = had ? {
    ...pack,
    nodeIds: [...new Set([...pack.nodeIds, ...had.nodeIds])],
    examples: [...new Set([...(pack.examples ?? []), ...(had.examples ?? [])])],
    presentations: [...new Set([...(pack.presentations ?? []), ...(had.presentations ?? [])])],
  } : pack;
  kv.set(INSTALLED_PACKS_KEY, JSON.stringify(all));
  try { window.dispatchEvent(new Event(INSTALLED_PACKS_CHANGED)); } catch { /* no window in tests */ }
}

export function forgetInstalledPack(id: string, kv: KV = localKV): void {
  try {
    const all = JSON.parse(kv.get(INSTALLED_PACKS_KEY) ?? '{}') as Record<string, InstalledPack>;
    delete all[id];
    kv.set(INSTALLED_PACKS_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event(INSTALLED_PACKS_CHANGED));
  } catch { /* nothing to forget */ }
}

/** The pack whose nodes are listed under this category, if one is. */
export function packForCategory(category: string, kv: KV = localKV): InstalledPack | null {
  return installedPacks(kv).filter(p => p.category === category).sort((a, b) => b.installedAt - a.installedAt)[0] ?? null;
}
