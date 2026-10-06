/**
 * linkedCorpus.ts — .glsl / .frag files in linked folders, as docs (`file:<folder>/<path>`).
 *
 * Walks each connected folder (read-only, as the linked-folder model does),
 * reading a file again only when its size or time changed. Bounded so a huge
 * folder can't stall the app.
 */
import { listLinked, loadLinkedFolders, resolveLinked, useLinkedFolders } from '../files/linkedFolders';
import { linkedRef } from '../files/linkedRefs';
import { fileDoc } from './corpus';
import type { DocInput } from './types';

export const LINKED_PREFIXES = ['file:'];
export const GLSL_FILE = /\.(glsl|frag|fs|fsh|vert|vs|vsh|glslf|shader)$/i;
const MAX_DIRS = 300, MAX_FILES = 400, MAX_BYTES = 256 * 1024;

const cache = new Map<string, { size: number; mtime: number; doc: DocInput | null }>();

export async function collectLinkedDocs(): Promise<DocInput[]> {
  const st = useLinkedFolders.getState();
  if (!st.loaded) await loadLinkedFolders().catch(() => {});
  const out: DocInput[] = [];
  for (const f of useLinkedFolders.getState().folders) {
    const queue = [''];
    let dirs = 0, files = 0;
    while (queue.length && dirs++ < MAX_DIRS && files < MAX_FILES) {
      const dir = queue.shift()!;
      let entries;
      try { entries = await listLinked(f.id, dir); } catch { break; }
      for (const e of entries) {
        if (e.dir) { queue.push(e.path); continue; }
        if (!GLSL_FILE.test(e.name) || e.size > MAX_BYTES || ++files > MAX_FILES) continue;
        const docId = `file:${f.id}/${e.path}`;
        const hit = cache.get(docId);
        if (hit && hit.size === e.size && hit.mtime === e.mtime) { if (hit.doc) out.push(hit.doc); continue; }
        let doc: DocInput | null = null;
        try {
          const r = await resolveLinked(linkedRef(f.id, e.path));
          if (r.ok) doc = fileDoc(docId, 'linked', e.path, 'Linked files', 'file', await r.blob.text(), f.name);
        } catch { /* unreadable: skipped */ }
        cache.set(docId, { size: e.size, mtime: e.mtime, doc });
        if (doc) out.push(doc);
      }
    }
  }
  return out;
}
