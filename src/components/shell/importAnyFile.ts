/**
 * importAnyFile — the top bar's Import: one button for the files Playfield
 * makes. A `.playfile` opens its preview (what's inside, then import); the
 * older formats keep opening as before: a graph (or Play) file opens in the
 * Studio, a `.present.json` on the Present page as a new presentation, a
 * library.json or library/profile ZIP merges into the library. The kind is
 * read from the file, not its name.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { PRESENTATION_FILE_KIND } from '../../types/presentation';
import { errorMessage, openBinaryFile } from '../../utils/fileIO';
import { CONTAINER_ACCEPT } from '../../playfile/format';
import { isPlayfile } from '../../playfile/reader';
import { LIBRARY_KIND } from '../../utils/library';
import { importLibraryBytes } from '../../utils/libraryActions';
import { toast } from '../ui/toastStore';
import type { Page } from '../page';
import { reportFileResult } from './reportFileResult';

export type ImportedAs = 'graph' | 'presentation' | 'library' | 'playfile' | null;

/** What a file's text is, by its `kind`. Anything else is tried as a graph. */
export function fileKind(text: string): Exclude<ImportedAs, null | 'playfile'> {
  let kind: unknown;
  try { kind = (JSON.parse(text) as { kind?: unknown } | null)?.kind; } catch { return 'graph'; }
  if (kind === PRESENTATION_FILE_KIND) return 'presentation';
  if (kind === LIBRARY_KIND) return 'library';
  return 'graph';
}

/** Import text already read from a file, going to the page it belongs on. Returns what it came in as (null: it didn't). */
export async function importText(text: string, navigate: (p: Page) => void, fileName = 'the file'): Promise<ImportedAs> {
  const kind = fileKind(text);
  if (kind === 'presentation') {
    // The Present page's code loads with the page, so only when a presentation comes in.
    const { importPresentationText } = await import('../present/presentationFiles');
    if (!importPresentationText(text)) return null;
    navigate('present');
    return 'presentation';
  }
  if (kind === 'library') {
    void importLibraryBytes(fileName, new TextEncoder().encode(text));
    return 'library';
  }
  const ok = reportFileResult(useNodeGraphStore.getState().importGraph(text), { failTitle: 'Couldn’t import that file' });
  return ok ? 'graph' : null;
}

/** Import a file's bytes: a .playfile opens its preview; a ZIP is a library or profile; anything else is read as text. */
export async function importBytes(name: string, bytes: Uint8Array, navigate: (p: Page) => void): Promise<ImportedAs> {
  if (isPlayfile(bytes)) {
    const { openPlayfileBytes } = await import('../../playfile/app');
    return (await openPlayfileBytes(name, bytes)) ? 'playfile' : null;
  }
  if (bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    void importLibraryBytes(name, bytes);
    return 'library';
  }
  return importText(new TextDecoder().decode(bytes), navigate, name);
}

/** Pick a file and import it (top bar Import, its shortcut, the phone ⋯ menu). */
export async function importAnyFile(navigate: (p: Page) => void): Promise<ImportedAs> {
  let picked: Awaited<ReturnType<typeof openBinaryFile>>;
  try { picked = await openBinaryFile(`${CONTAINER_ACCEPT},.json,.present.json,.zip`); } catch (e) { toast.error('Couldn’t import that file', { message: errorMessage(e) }); return null; }
  if (!picked) return null;
  return importBytes(picked.name, picked.bytes, navigate);
}
