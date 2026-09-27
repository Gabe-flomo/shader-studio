/**
 * The backgrounds library's image backgrounds (IndexedDB, lib/backgroundLibrary.ts)
 * as a Files source: listed under Backgrounds → Images in their folders, used
 * by the Play setups and presentations that embedded one (they keep its id
 * as `libraryId` beside their copy), and carried in ZIPs in the library's own
 * layout (`backgrounds/images.json` and the picture files) so the Library's
 * Import and the Files page's Install read each other's ZIPs.
 */
import { strFromU8, strToU8 } from 'fflate';
import {
  BACKGROUNDS_MANIFEST, BACKGROUNDS_MANIFEST_KIND, backgroundZipFiles, deleteImage, hasImage, IMAGE_FOLDER_SCOPE, importBackgroundFiles, listImages,
  type BackgroundsManifest,
} from '../lib/backgroundLibrary';
import { registerFilesSource, type FilesSource } from './sources';

const TYPE_NAMES: Record<string, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'image/svg+xml': 'SVG', 'image/avif': 'AVIF' };

/** The images manifest in a set of ZIP files, and the folder it sits in ("…/backgrounds/"). */
export function findImagesManifest(files: Record<string, Uint8Array>): { root: string; manifest: BackgroundsManifest } | null {
  const path = Object.keys(files).find(p => p === BACKGROUNDS_MANIFEST || p.endsWith(`/${BACKGROUNDS_MANIFEST}`));
  if (!path) return null;
  try {
    const m = JSON.parse(strFromU8(files[path])) as BackgroundsManifest;
    if (m?.kind !== BACKGROUNDS_MANIFEST_KIND || !Array.isArray(m.images)) return null;
    return { root: path.slice(0, path.length - 'images.json'.length), manifest: m };
  } catch { return null; }
}

/** Just these images' files (and a manifest of just them) out of the library's ZIP files. */
export function pickImages(files: Record<string, Uint8Array>, ids: Set<string>): Record<string, Uint8Array> {
  const found = findImagesManifest(files);
  if (!found) return {};
  const images = found.manifest.images.filter(e => ids.has(e.id));
  if (!images.length) return {};
  const out: Record<string, Uint8Array> = { [found.root + 'images.json']: strToU8(JSON.stringify({ ...found.manifest, images }, null, 1)) };
  for (const e of images) { const f = files[found.root + e.file]; if (f) out[found.root + e.file] = f; }
  return out;
}

export const backgroundsSource: FilesSource = {
  id: 'backgrounds',
  section: 'backgrounds',
  group: 'Images',
  folderScope: IMAGE_FOLDER_SCOPE,
  refField: 'libraryId',
  async list() {
    return (await listImages()).map(m => ({
      id: m.id, label: m.name, size: m.bytes, modified: m.createdAt, ...(m.thumb ? { thumb: m.thumb } : {}),
      detail: [`${m.width}×${m.height}`, TYPE_NAMES[m.type] ?? m.type.replace(/^image\//, '').toUpperCase(), m.source ? `captured from “${m.source.graph}”` : ''].filter(Boolean).join(' · '),
    }));
  },
  async zipFiles(ids) {
    const all = await backgroundZipFiles();
    return ids ? pickImages(all, new Set(ids)) : all;
  },
  async preview(files) {
    const found = findImagesManifest(files);
    if (!found) return [];
    const out: Array<{ id: string; label: string; size: number; status: 'new' | 'same' }> = [];
    for (const e of found.manifest.images) {
      if (!e || typeof e.id !== 'string') continue;
      out.push({ id: e.id, label: e.name, size: files[found.root + e.file]?.length ?? 0, status: await hasImage(e.id) ? 'same' : 'new' });
    }
    return out;
  },
  async install(files, mode) {
    if (mode === 'replace') for (const m of await listImages()) await deleteImage(m.id);
    const r = await importBackgroundFiles(files);
    return { added: r.added, same: r.same };
  },
  async remove(ids) {
    const undos: Array<() => Promise<void>> = [];
    for (const id of ids) { const u = await deleteImage(id); if (u) undos.push(u); }
    return async () => { for (const u of undos) await u(); };
  },
};

/** Registered once, by the Files page (which imports this module). */
registerFilesSource(backgroundsSource);
