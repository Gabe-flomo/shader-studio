/**
 * presentationFiles — a presentation as a `.present.json` file, out and in.
 * Importing goes through parsePresentation and marks the presentation as
 * someone else's, so its Script layers run in a sandboxed frame.
 */
import { presentationFileJson } from '../../present/exportPresentation';
import { PRESENTATION_FILE_KIND, parsePresentation } from '../../types/presentation';
import { openTextFile, saveTextFile } from '../../utils/fileIO';
import { toast } from '../ui/toastStore';
import { reportFileResult } from '../shell/reportFileResult';
import { usePresentation } from './presentationStore';

export const fileBase = (title: string) => title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'presentation';

export async function exportPresentationFile(): Promise<void> {
  const doc = usePresentation.getState().doc;
  if (!doc) return;
  reportFileResult(await saveTextFile(presentationFileJson(doc), `${fileBase(doc.title)}.present.json`), { failTitle: 'Couldn’t export the presentation', success: 'Presentation exported' });
}

export async function importPresentationFile(): Promise<void> {
  let text: string | null;
  try { text = await openTextFile('.json,.present.json'); } catch (e) { toast.error('Couldn’t open the file', { message: e instanceof Error ? e.message : String(e) }); return; }
  if (text === null) return;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { toast.error('That isn’t a presentation file', { message: 'It isn’t JSON.' }); return; }
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind !== undefined && kind !== PRESENTATION_FILE_KIND) { toast.error('That isn’t a presentation file', { message: kind === 'shader-studio-play' ? 'It’s a play file: import it on the Play page.' : 'Its kind is something else.' }); return; }
  const doc = parsePresentation(raw);
  if (!doc) { toast.error('That isn’t a presentation file', { message: 'It has no steps.' }); return; }
  // Its Script layers are someone else's JavaScript: they run in a sandboxed frame.
  const name = usePresentation.getState().adopt({ ...doc, origin: 'imported' });
  const scripts = doc.sources.some(s => s.bundle.play.layers.some(l => l.kind === 'script'));
  toast.success(`Imported “${name}”`, scripts ? { message: 'Its Script layers run in a sandboxed frame, since they’re code from somewhere else.' } : undefined);
}
