/**
 * sources.ts — stores outside localStorage that the Files page manages too.
 *
 * localStorage holds almost everything; a store that keeps files (images,
 * recordings) in IndexedDB registers here and its items appear in their
 * section like any other: listed with sizes, removable with Undo, downloaded
 * into the profile ZIP (as `blobs/<source>/<file>`, with their metadata in
 * `blobs/<source>/index.json`) and installed back from it.
 *
 * Nothing registers yet; the background library (lib/backgroundLibrary.ts)
 * is meant to, with section 'backgrounds'.
 */
import type { ExternalListing, SectionId } from './inventory';

export interface ExternalItem { id: string; label: string; size: number; modified?: number; detail?: string; hash?: string }

/** One item's file and what the store needs to put it back. */
export interface ExternalFile { id: string; name: string; meta: unknown; bytes: Uint8Array }

export interface FilesSource {
  /** Stable id, used in ZIP paths and refs: 'backgrounds'. */
  id: string;
  section: SectionId;
  /** The group its items show under in the section: 'Images'. */
  group: string;
  list(): Promise<ExternalItem[]>;
  read(ids: string[]): Promise<ExternalFile[]>;
  /** Add files (merge: a clashing name becomes "Name (2)"), or replace everything the store has. */
  write(files: ExternalFile[], mode: 'merge' | 'replace'): Promise<{ added: number; renamed: string[] }>;
  remove(ids: string[]): Promise<void>;
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
export async function listExternal(): Promise<ExternalListing[]> {
  const out: ExternalListing[] = [];
  for (const s of registry.values()) {
    try { out.push({ source: s.id, section: s.section, group: s.group, items: await s.list() }); } catch { /* unreadable store: not shown */ }
  }
  return out;
}

/** Remove external items, returning Undo (puts the same files back). */
export async function removeExternal(items: Array<{ source: string; id: string }>): Promise<() => Promise<void>> {
  const bySource = new Map<string, string[]>();
  for (const it of items) { const l = bySource.get(it.source) ?? []; l.push(it.id); bySource.set(it.source, l); }
  const saved: Array<{ src: FilesSource; files: ExternalFile[] }> = [];
  for (const [id, ids] of bySource) {
    const src = registry.get(id);
    if (!src) continue;
    saved.push({ src, files: await src.read(ids) });
    await src.remove(ids);
  }
  return async () => { for (const s of saved) await s.src.write(s.files, 'merge'); };
}
