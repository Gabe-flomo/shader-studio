/**
 * libraryActions.ts — the buttons' side of library.ts: export everything to a
 * ZIP, import one back, and say what happened.
 */
import { toast } from '../components/ui/toastStore';
import { buildLibraryZip, buildSetZip, countInSet, describeSnapshot, DOWNLOAD_SETS, importLibrary, LIBRARY_REFRESH_EVENTS, libraryZipName, readLibrary, takeSnapshot, type DownloadSetId } from './library';
import { errorMessage, openBinaryFile, saveBinaryFile } from './fileIO';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function librarySummary(): string {
  const d = describeSnapshot(takeSnapshot());
  return [plural(d.graphs, 'graph'), ...(d.presentations ? [plural(d.presentations, 'presentation')] : []), plural(d.presets, 'preset'), ...(d.nodes ? [plural(d.nodes, 'published node')] : [])].join(' · ');
}

export async function exportEverything(): Promise<void> {
  const snap = takeSnapshot();
  const d = describeSnapshot(snap);
  if (d.graphs + d.presets + d.nodes + d.presentations === 0) { toast.info('Nothing to export yet', { message: 'Save a graph, a presentation or a preset first.' }); return; }
  const res = await saveBinaryFile(buildLibraryZip(snap), libraryZipName(), 'application/zip');
  if (res.ok) toast.success('Library exported', { message: `${librarySummary()}, with their versions, folders and your settings.` });
  else if (!res.cancelled) toast.error('Couldn’t export the library', { message: res.error });
}

/** Download one kind of thing (or everything) as a ZIP: plain files to share, plus a library.json to import back. */
export async function exportSet(set: DownloadSetId): Promise<void> {
  if (set === 'everything') return exportEverything();
  const snap = takeSnapshot();
  const def = DOWNLOAD_SETS.find(d => d.id === set)!;
  const n = countInSet(snap, set);
  if (n === 0) { toast.info(`Nothing to download yet`, { message: `${def.label.replace(/^Only /, '')}: none saved so far.` }); return; }
  const { bytes, name } = buildSetZip(snap, set);
  const res = await saveBinaryFile(bytes, name, 'application/zip');
  if (res.ok) toast.success(`Downloaded ${n} ${n === 1 ? 'item' : 'items'}`, { message: `${name}: the files in folders, plus a library.json that imports them back.` });
  else if (!res.cancelled) toast.error('Couldn’t download', { message: res.error });
}

export async function importEverything(): Promise<void> {
  let picked: Awaited<ReturnType<typeof openBinaryFile>>;
  try { picked = await openBinaryFile('.zip,.json'); } catch (e) { toast.error('Couldn’t open that file', { message: errorMessage(e) }); return; }
  if (!picked) return;
  importLibraryBytes(picked.name, picked.bytes);
}

/** Merge a library ZIP or library.json (already read) into this browser and say what came in. */
export function importLibraryBytes(fileName: string, bytes: Uint8Array): void {
  const picked = { name: fileName, bytes };
  try {
    const r = importLibrary(readLibrary(picked.bytes));
    for (const ev of LIBRARY_REFRESH_EVENTS) window.dispatchEvent(new Event(ev));
    const parts = [
      r.added ? `${r.added} added` : '',
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
