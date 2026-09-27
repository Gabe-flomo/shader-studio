/**
 * libraryVideos.ts — the Video layers' files (lib/backgroundLibrary.ts,
 * store `videos`) in library ZIPs: Export everything and Download →
 * Backgrounds carry them as `backgrounds/videos.json` plus the files, and
 * Import brings them back (ids kept, so the layers that name one find it).
 *
 * Videos are big: past VIDEO_ZIP_ASK bytes in all, the export asks first
 * whether to take them along or leave them out.
 */
import { unzipSync } from 'fflate';
import { importVideoFiles, listVideos, videoZipFiles } from '../lib/backgroundLibrary';
import { askChoice } from '../components/ui/dialogStore';
import { toast } from '../components/ui/toastStore';
import { formatSize } from './library';
import { errorMessage } from './fileIO';

/** Videos past this much in all: the export asks before putting them in a ZIP. */
export const VIDEO_ZIP_ASK = 200 * 1024 * 1024;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Whether a ZIP should take the videos along: 'all' (none to ask about, or
 * a yes), 'none' (leave them out), or null (the export was called off).
 */
export async function askVideosInZip(ask: typeof askChoice = askChoice, limit = VIDEO_ZIP_ASK): Promise<'all' | 'none' | null> {
  let list: Awaited<ReturnType<typeof listVideos>>;
  try { list = await listVideos(); } catch { return 'all'; }
  const bytes = list.reduce((n, v) => n + v.bytes, 0);
  if (bytes <= limit) return 'all';
  const id = await ask(`Include ${plural(list.length, 'video')} (${formatSize(bytes)})?`, [
    { id: 'none', label: 'Leave them out', variant: 'ghost' },
    { id: 'all', label: 'Include them', variant: 'primary' },
  ], { message: 'The Video layers’ files make the ZIP big. Left out, those layers ask for their files after an import elsewhere.' });
  return id === 'all' || id === 'none' ? id : null;
}

/** The videos' files for a ZIP, as asked (null: called off). None when IndexedDB can't be read. */
export async function videoFilesForZip(choice: 'all' | 'none' | null): Promise<{ files: Record<string, Uint8Array>; count: number } | null> {
  if (choice === null) return null;
  if (choice === 'none') return { files: {}, count: 0 };
  try {
    const files = await videoZipFiles();
    const count = Object.keys(files).filter(p => p.startsWith('backgrounds/videos/')).length;
    return { files, count };
  } catch { return { files: {}, count: 0 }; }
}

/** A ZIP's videos into the library; 0 added when it has none. */
export async function importVideosFrom(bytes: Uint8Array): Promise<{ added: number; same: number }> {
  if (!(bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b)) return { added: 0, same: 0 };
  try {
    const files = unzipSync(bytes, { filter: f => f.name.includes('backgrounds/videos') });
    return await importVideoFiles(files);
  } catch (e) {
    toast.error('Couldn’t bring the videos in', { message: errorMessage(e) });
    return { added: 0, same: 0 };
  }
}
