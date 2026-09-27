/**
 * sources.ts — stores outside localStorage that the Files page manages too.
 *
 * localStorage holds almost everything; a store that keeps files in
 * IndexedDB (the backgrounds library's images, see backgroundsSource.ts)
 * registers here and its items appear in their section like any other:
 * listed with sizes and folders, "used by" what points at them, removable
 * with Undo, downloaded into the profile ZIP in the store's own file layout
 * (so the Library's Import reads them too) and installed back from it.
 */
import type { ExternalListing, SectionId } from './inventory';

export interface ExternalItem { id: string; label: string; size: number; modified?: number; detail?: string; hash?: string; thumb?: string }

export interface FilesSource {
  /** Stable id, used in refs and the manifest: 'backgrounds'. */
  id: string;
  section: SectionId;
  /** The group its items show under in the section: 'Images'. */
  group: string;
  /** Its folder scope in the shared folder store, when it has folders. */
  folderScope?: string;
  /** The JSON field saved things use to point at one of its items ("libraryId"), for Used by. */
  refField?: string;
  /** What names an item points at it (a Video layer's `videoId`) instead of keeping a copy: removing it breaks them. */
  refIsLink?: boolean;
  list(): Promise<ExternalItem[]>;
  /** Its files for a ZIP (paths from the ZIP's root), for these items or all (null). Empty when it has none. */
  zipFiles(ids: string[] | null): Promise<Record<string, Uint8Array>>;
  /** What a ZIP's files (paths from its root) hold for this store, and which are here already. */
  preview(files: Record<string, Uint8Array>): Promise<Array<{ id: string; label: string; size: number; status: 'new' | 'same' }>>;
  /** Bring a ZIP's files in: merge (what's here stays) or replace (what's here goes first). */
  install(files: Record<string, Uint8Array>, mode: 'merge' | 'replace'): Promise<{ added: number; same: number }>;
  /** Remove items; returns Undo. */
  remove(ids: string[]): Promise<() => Promise<void>>;
}

const registry = new Map<string, FilesSource>();

/** Register a store; returns a function that unregisters it. */
export function registerFilesSource(src: FilesSource): () => void {
  registry.set(src.id, src);
  return () => { if (registry.get(src.id) === src) registry.delete(src.id); };
}

export function filesSources(): FilesSource[] { return [...registry.values()]; }
export function filesSource(id: string): FilesSource | undefined { return registry.get(id); }

/** Every registered store's items, for the inventory. A store that fails to list is left out. */
export async function listExternal(sources: FilesSource[] = filesSources()): Promise<ExternalListing[]> {
  const out: ExternalListing[] = [];
  for (const s of sources) {
    try { out.push({ source: s.id, section: s.section, group: s.group, folderScope: s.folderScope, refField: s.refField, ...(s.refIsLink ? { refIsLink: true } : {}), items: await s.list() }); } catch { /* unreadable store: not shown */ }
  }
  return out;
}

/** Remove external items, returning one Undo for all of them. */
export async function removeExternal(items: Array<{ source: string; id: string }>): Promise<() => Promise<void>> {
  const bySource = new Map<string, string[]>();
  for (const it of items) { const l = bySource.get(it.source) ?? []; l.push(it.id); bySource.set(it.source, l); }
  const undos: Array<() => Promise<void>> = [];
  for (const [id, ids] of bySource) {
    const src = registry.get(id);
    if (src) undos.push(await src.remove(ids));
  }
  return async () => { for (const u of undos) await u(); };
}
