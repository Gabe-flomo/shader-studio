/**
 * presentationFiles — a presentation as a `.present.json` file, out and in,
 * and the file actions around the saved list (download one, download all,
 * delete with Undo). Importing goes through parsePresentation and marks the
 * presentation as someone else's, so its Script layers run in a sandboxed
 * frame.
 */
import { presentationFileJson } from '../../present/exportPresentation';
import { withEmbeddedAssets } from '../../present/presentAssets';
import { deletePresentation, loadPresentation, restorePresentation } from '../../present/storage';
import { PRESENTATION_FILE_KIND, parsePresentation, type Presentation } from '../../types/presentation';
import { openTextFile, saveTextFile } from '../../utils/fileIO';
import { exportSet } from '../../utils/libraryActions';
import { toast } from '../ui/toastStore';
import { reportFileResult } from '../shell/reportFileResult';
import { usePresentation } from './presentationStore';

export const fileBase = (title: string) => title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'presentation';

/** Download a presentation (the open one, or a saved one by name) as a `.present.json` file. */
export async function exportPresentationFile(name?: string): Promise<void> {
  const st = usePresentation.getState();
  const doc: Presentation | null = name === undefined || name === st.name ? st.doc : loadPresentation(name);
  if (!doc) { toast.error('Couldn’t download it', { message: 'That presentation isn’t readable.' }); return; }
  // The file carries its pictures and fonts (from the library and the font cache), so it opens anywhere.
  const { doc: full, missingImages } = await withEmbeddedAssets(doc);
  const left = missingImages.length ? ` ${missingImages.length === 1 ? 'One image background isn’t' : `${missingImages.length} image backgrounds aren’t`} in this browser’s library, so only a preview went in.` : '';
  reportFileResult(await saveTextFile(presentationFileJson(full), `${fileBase(doc.title)}.present.json`), { failTitle: 'Couldn’t download the presentation', success: `Downloaded “${doc.title}”${left}` });
}

/** Every saved presentation as one ZIP of .present.json files (plus a library.json that imports them back). */
export function downloadAllPresentations(): Promise<void> {
  return exportSet('presentations');
}

/**
 * Read a `.present.json` file's text and open it as a new presentation.
 * Returns its name, or null (after saying why) when it isn't one.
 */
export function importPresentationText(text: string): string | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { toast.error('That isn’t a presentation file', { message: 'It isn’t JSON.' }); return null; }
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind !== undefined && kind !== PRESENTATION_FILE_KIND) { toast.error('That isn’t a presentation file', { message: kind === 'shader-studio-play' ? 'It’s a play file: import it on the Play page.' : 'Its kind is something else.' }); return null; }
  const doc = parsePresentation(raw);
  if (!doc) { toast.error('That isn’t a presentation file', { message: 'It has no steps.' }); return null; }
  // Its Script layers are someone else's JavaScript: they run in a sandboxed frame.
  const name = usePresentation.getState().adopt({ ...doc, origin: 'imported' });
  const scripts = doc.sources.some(s => s.bundle.play.layers.some(l => l.kind === 'script'));
  const renamed = name !== doc.title;
  const message = [
    renamed ? `There was already one called “${doc.title}”, so this one is “${name}”.` : '',
    scripts ? 'Its Script layers run in a sandboxed frame, since they’re code from somewhere else.' : '',
  ].filter(Boolean).join(' ');
  toast.success(`Imported “${name}”`, message ? { message } : undefined);
  return name;
}

export async function importPresentationFile(): Promise<void> {
  let text: string | null;
  try { text = await openTextFile('.json,.present.json'); } catch (e) { toast.error('Couldn’t open the file', { message: e instanceof Error ? e.message : String(e) }); return; }
  if (text === null) return;
  importPresentationText(text);
}

/** Delete a saved presentation (closing it if it's the open one), with Undo. */
export function deleteWithUndo(name: string): void {
  const st = usePresentation.getState();
  const wasOpen = st.name === name;
  const gone = wasOpen ? st.remove() : deletePresentation(name);
  if (!gone) return;
  toast.info(`Deleted “${name}”`, {
    message: 'The graphs it was built from stay.',
    action: { label: 'Undo', onClick: () => { const back = restorePresentation(gone); if (wasOpen) usePresentation.getState().open(back); } },
  });
}

/** A copy of the open presentation under a new name, opened. */
export function saveCopy(title: string): string | null {
  const doc = usePresentation.getState().doc;
  if (!doc) return null;
  return usePresentation.getState().adopt({ ...structuredClone(doc), title: title.trim() || doc.title, createdAt: Date.now() });
}
