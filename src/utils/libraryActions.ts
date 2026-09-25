/**
 * libraryActions.ts — the buttons' side of library.ts: export everything to a
 * ZIP, import one back, and say what happened.
 */
import { toast } from '../components/ui/toastStore';
import { buildLibraryZip, describeSnapshot, importLibrary, LIBRARY_REFRESH_EVENTS, libraryZipName, readLibrary, takeSnapshot } from './library';
import { errorMessage, openBinaryFile, saveBinaryFile } from './fileIO';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function librarySummary(): string {
  const d = describeSnapshot(takeSnapshot());
  return [plural(d.graphs, 'graph'), plural(d.presets, 'preset'), ...(d.nodes ? [plural(d.nodes, 'published node')] : [])].join(' · ');
}

export async function exportEverything(): Promise<void> {
  const snap = takeSnapshot();
  const d = describeSnapshot(snap);
  if (d.graphs + d.presets + d.nodes === 0) { toast.info('Nothing to export yet', { message: 'Save a graph or a preset first.' }); return; }
  const res = await saveBinaryFile(buildLibraryZip(snap), libraryZipName(), 'application/zip');
  if (res.ok) toast.success('Library exported', { message: `${librarySummary()}, with their versions, folders and your settings.` });
  else if (!res.cancelled) toast.error('Couldn’t export the library', { message: res.error });
}

export async function importEverything(): Promise<void> {
  let picked: Awaited<ReturnType<typeof openBinaryFile>>;
  try { picked = await openBinaryFile('.zip,.json'); } catch (e) { toast.error('Couldn’t open that file', { message: errorMessage(e) }); return; }
  if (!picked) return;
  try {
    const r = importLibrary(readLibrary(picked.bytes));
    for (const ev of LIBRARY_REFRESH_EVENTS) window.dispatchEvent(new Event(ev));
    const parts = [
      r.added ? `${r.added} added` : '',
      r.renamed.length ? `${plural(r.renamed.length, 'graph')} already here under the same name came in as “… (imported)”` : '',
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
