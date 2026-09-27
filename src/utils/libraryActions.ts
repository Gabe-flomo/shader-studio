/**
 * libraryActions.ts — the buttons' side of library.ts: export everything to a
 * ZIP, import one back, and say what happened.
 */
import { internStoredPresentations } from '../present/presentAssets';
import { savePresentation } from '../present/storage';
import { toast } from '../components/ui/toastStore';
import { buildLibraryZip, buildSetZip, countInSet, describeSnapshot, DOWNLOAD_SETS, importLibrary, LIBRARY_REFRESH_EVENTS, libraryZipName, readLibrary, takeSnapshot, type DownloadSetId } from './library';
import { errorMessage, openBinaryFile, saveBinaryFile } from './fileIO';
import { unzipSync } from 'fflate';
import { requireFeature } from '../lib/plan';
import { backgroundZipFiles, importBackgroundFiles, listImages } from '../lib/backgroundLibrary';
import { askVideosInZip, importVideosFrom, videoFilesForZip } from './libraryVideos';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function librarySummary(images = 0, videos = 0): string {
  const d = describeSnapshot(takeSnapshot());
  return [plural(d.graphs, 'graph'), ...(d.presentations ? [plural(d.presentations, 'presentation')] : []), plural(d.presets, 'preset'), ...(d.nodes ? [plural(d.nodes, 'published node')] : []), ...(images ? [plural(images, 'image background')] : []), ...(videos ? [plural(videos, 'video')] : [])].join(' · ');
}

/** The image backgrounds' files for a ZIP (none when IndexedDB can't be read). */
async function imageFiles(): Promise<{ files: Record<string, Uint8Array>; count: number }> {
  try { const count = (await listImages()).length; return { files: count ? await backgroundZipFiles() : {}, count }; } catch { return { files: {}, count: 0 }; }
}

export async function exportEverything(): Promise<void> {
  if (!requireFeature('files.everything')) return;
  const snap = takeSnapshot();
  const d = describeSnapshot(snap);
  const images = await imageFiles();
  const videos = await videoFilesForZip(await askVideosInZip());
  if (videos === null) return;
  if (d.graphs + d.presets + d.nodes + d.presentations + images.count + videos.count === 0) { toast.info('Nothing to export yet', { message: 'Save a graph, a presentation or a preset first.' }); return; }
  const res = await saveBinaryFile(buildLibraryZip(snap, undefined, { ...images.files, ...videos.files }), libraryZipName(), 'application/zip');
  if (res.ok) toast.success('Library exported', { message: `${librarySummary(images.count, videos.count)}, with their versions, folders and your settings.` });
  else if (!res.cancelled) toast.error('Couldn’t export the library', { message: res.error });
}

/** Download one kind of thing (or everything) as a ZIP: plain files to share, plus a library.json to import back. */
export async function exportSet(set: DownloadSetId): Promise<void> {
  if (set === 'everything') return exportEverything();
  const snap = takeSnapshot();
  const def = DOWNLOAD_SETS.find(d => d.id === set)!;
  const images = set === 'backgrounds' ? await imageFiles() : { files: {}, count: 0 };
  const videos = set === 'backgrounds' ? await videoFilesForZip(await askVideosInZip()) : { files: {}, count: 0 };
  if (videos === null) return;
  const n = countInSet(snap, set) + images.count + videos.count;
  if (n === 0) { toast.info(`Nothing to download yet`, { message: `${def.label.replace(/^Only /, '')}: none saved so far.` }); return; }
  const { bytes, name } = buildSetZip(snap, set, { ...images.files, ...videos.files });
  const res = await saveBinaryFile(bytes, name, 'application/zip');
  if (res.ok) toast.success(`Downloaded ${n} ${n === 1 ? 'item' : 'items'}`, { message: `${name}: the files in folders, plus a library.json that imports them back.` });
  else if (!res.cancelled) toast.error('Couldn’t download', { message: res.error });
}

export async function importEverything(): Promise<void> {
  if (!requireFeature('files.install')) return;
  let picked: Awaited<ReturnType<typeof openBinaryFile>>;
  try { picked = await openBinaryFile('.zip,.json'); } catch (e) { toast.error('Couldn’t open that file', { message: errorMessage(e) }); return; }
  if (!picked) return;
  await importLibraryBytes(picked.name, picked.bytes);
}

/** A ZIP's image backgrounds (backgrounds/images.json and its files) into IndexedDB; 0 added when it has none. */
async function importImagesFrom(bytes: Uint8Array): Promise<{ added: number; same: number }> {
  if (!(bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b)) return { added: 0, same: 0 };
  try {
    const files = unzipSync(bytes, { filter: f => f.name.includes('backgrounds/') });
    return await importBackgroundFiles(files);
  } catch (e) {
    toast.error('Couldn’t bring the image backgrounds in', { message: errorMessage(e) });
    return { added: 0, same: 0 };
  }
}

/** Merge a library ZIP or library.json (already read) into this browser and say what came in. */
export async function importLibraryBytes(fileName: string, bytes: Uint8Array): Promise<void> {
  if (!requireFeature('files.install')) return;
  const picked = { name: fileName, bytes };
  try {
    const r = importLibrary(readLibrary(picked.bytes));
    const img = await importImagesFrom(picked.bytes);
    const vid = await importVideosFrom(picked.bytes);
    // Presentations that came in with their pictures and fonts embedded keep references to the library instead.
    await internStoredPresentations(savePresentation).catch(() => []);
    for (const ev of LIBRARY_REFRESH_EVENTS) window.dispatchEvent(new Event(ev));
    const parts = [
      r.added ? `${r.added} added` : '',
      img.added ? `${plural(img.added, 'image background')} added` : '',
      vid.added ? `${plural(vid.added, 'video')} added` : '',
      r.renamed.length ? `${plural(r.renamed.length, 'graph')} already here under the same name came in as “… (imported)”` : '',
      r.renamedPresentations.length ? `${plural(r.renamedPresentations.length, 'presentation')} whose name was taken came in as ${r.renamedPresentations.map(n => `“${n}”`).join(', ')}` : '',
      r.skipped ? `${plural(r.skipped, 'presentation')} that couldn’t be read left out` : '',
      r.kept ? `${r.kept} you already had a different copy of (yours kept)` : '',
      r.same ? `${r.same} already here` : '',
    ].filter(Boolean);
    toast.success(`Imported “${picked.name}”`, {
      message: `${parts.join(' · ') || 'Nothing new'}. Reload to load imported nodes and settings.`,
      action: { label: 'Reload', onClick: () => location.reload() },
      sticky: true,
    });
  } catch (e) {
    toast.error(`Couldn’t import “${picked.name}”`, { message: errorMessage(e) });
  }
}
