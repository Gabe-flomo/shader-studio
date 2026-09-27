/**
 * The backgrounds library's videos (IndexedDB, lib/backgroundLibrary.ts, the
 * files of Play's Video layers) as a Files source: listed under Backgrounds →
 * Videos with their poster frames, used by the Play setups whose Video layers
 * name them (`videoId`: a reference, not a copy, so removing one leaves those
 * layers asking for their file), and carried in ZIPs in the library's own
 * layout (`backgrounds/videos.json` and the video files).
 */
import { hasVideo, importVideoFiles, findVideosManifest, listVideos, removeVideo, videoZipFiles } from '../lib/backgroundLibrary';
import { registerFilesSource, type FilesSource } from './sources';

const TYPE_NAMES: Record<string, string> = { 'video/mp4': 'MP4', 'video/webm': 'WebM', 'video/quicktime': 'MOV', 'video/ogg': 'Ogg', 'video/x-m4v': 'M4V' };

/** "0:12" */
export const videoLength = (s: number) => { const m = Math.floor(s / 60), r = Math.round(s - m * 60); return `${m}:${r < 10 ? '0' : ''}${r}`; };

export const videosSource: FilesSource = {
  id: 'videos',
  section: 'backgrounds',
  group: 'Videos',
  refField: 'videoId',
  refIsLink: true,
  async list() {
    return (await listVideos()).map(m => ({
      id: m.id, label: m.name, size: m.bytes, modified: m.createdAt, ...(m.thumb ? { thumb: m.thumb } : {}),
      detail: [m.width && m.height ? `${m.width}×${m.height}` : '', m.duration ? videoLength(m.duration) : '', TYPE_NAMES[m.type.split(';')[0]] ?? m.type.replace(/^video\//, '').toUpperCase()].filter(Boolean).join(' · '),
    }));
  },
  zipFiles: ids => videoZipFiles(ids),
  async preview(files) {
    const found = findVideosManifest(files);
    if (!found) return [];
    const out: Array<{ id: string; label: string; size: number; status: 'new' | 'same' }> = [];
    for (const e of found.manifest.videos) {
      if (!e || typeof e.id !== 'string') continue;
      out.push({ id: e.id, label: e.name, size: files[found.root + e.file]?.length ?? 0, status: await hasVideo(e.id) ? 'same' : 'new' });
    }
    return out;
  },
  async install(files, mode) {
    if (mode === 'replace') for (const m of await listVideos()) await removeVideo(m.id);
    const r = await importVideoFiles(files);
    return { added: r.added, same: r.same };
  },
  async remove(ids) {
    const undos: Array<() => Promise<void>> = [];
    for (const id of ids) { const u = await removeVideo(id); if (u) undos.push(u); }
    return async () => { for (const u of undos) await u(); };
  },
};

/** Registered once, by the Files page (which imports this module). */
registerFilesSource(videosSource);
