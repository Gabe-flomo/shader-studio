/**
 * The backgrounds library's videos (IndexedDB, lib/backgroundLibrary.ts, the
 * files of Play's Video layers) as a Files source: listed under Backgrounds →
 * Videos with their poster frames, used by the Play setups whose Video layers
 * name them (`videoId`: a reference, not a copy, so removing one leaves those
 * layers asking for their file), and carried in ZIPs in the library's own
 * layout (`backgrounds/videos.json` and the video files).
 *
 * Drum pad samples are kept in the same store; they are a source of their
 * own, Backgrounds → Sounds (`sampleId`), with waveform thumbnails. Both write
 * the same manifest into a ZIP, which profileZip merges.
 */
import { findVideosManifest, hasVideo, importVideoFiles, isAudioType, listVideos, manifestEntryIsAudio, removeVideo, videoZipFiles } from '../lib/backgroundLibrary';
import { registerFilesSource, type FilesSource } from './sources';

const TYPE_NAMES: Record<string, string> = {
  'video/mp4': 'MP4', 'video/webm': 'WebM', 'video/quicktime': 'MOV', 'video/ogg': 'Ogg', 'video/x-m4v': 'M4V',
  'audio/wav': 'WAV', 'audio/x-wav': 'WAV', 'audio/wave': 'WAV', 'audio/mpeg': 'MP3', 'audio/ogg': 'Ogg', 'audio/mp4': 'M4A', 'audio/x-m4a': 'M4A', 'audio/aac': 'AAC', 'audio/flac': 'FLAC', 'audio/x-flac': 'FLAC', 'audio/aiff': 'AIFF', 'audio/x-aiff': 'AIFF',
};

/** "0:12" */
export const videoLength = (s: number) => { const m = Math.floor(s / 60), r = Math.round(s - m * 60); return `${m}:${r < 10 ? '0' : ''}${r}`; };

function keptFilesSource(kind: 'video' | 'audio'): FilesSource {
  const audio = kind === 'audio';
  const mine = async () => (await listVideos()).filter(m => isAudioType(m.type) === audio);
  return {
    id: audio ? 'sounds' : 'videos',
    section: 'backgrounds',
    group: audio ? 'Sounds' : 'Videos',
    refField: audio ? 'sampleId' : 'videoId',
    refIsLink: true,
    async list() {
      return (await mine()).map(m => ({
        id: m.id, label: m.name, size: m.bytes, modified: m.createdAt, ...(m.thumb ? { thumb: m.thumb } : {}),
        detail: [m.width && m.height ? `${m.width}×${m.height}` : '', m.duration ? videoLength(m.duration) : '', TYPE_NAMES[m.type.split(';')[0]] ?? m.type.replace(/^(video|audio)\//, '').toUpperCase()].filter(Boolean).join(' · '),
      }));
    },
    zipFiles: ids => videoZipFiles(ids, { only: kind }),
    async preview(files) {
      const found = findVideosManifest(files);
      if (!found) return [];
      const out: Array<{ id: string; label: string; size: number; status: 'new' | 'same' }> = [];
      for (const e of found.manifest.videos) {
        if (!e || typeof e.id !== 'string' || manifestEntryIsAudio(e) !== audio) continue;
        out.push({ id: e.id, label: e.name, size: files[found.root + e.file]?.length ?? 0, status: await hasVideo(e.id) ? 'same' : 'new' });
      }
      return out;
    },
    async install(files, mode) {
      if (mode === 'replace') for (const m of await mine()) await removeVideo(m.id);
      const r = await importVideoFiles(files, { only: kind });
      return { added: r.added, same: r.same };
    },
    async remove(ids) {
      const undos: Array<() => Promise<void>> = [];
      for (const id of ids) { const u = await removeVideo(id); if (u) undos.push(u); }
      return async () => { for (const u of undos) await u(); };
    },
  };
}

export const videosSource = keptFilesSource('video');
export const soundsSource = keptFilesSource('audio');

/** Registered once, by the Files page (which imports this module). */
registerFilesSource(videosSource);
registerFilesSource(soundsSource);
