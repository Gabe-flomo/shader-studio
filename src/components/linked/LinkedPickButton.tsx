/**
 * The small pieces every asset picker adds for linked folders
 * (docs/linked-folders.md), so each editor's change is a line or two:
 *
 *   <LinkedPickButton filter onPick />   "From a linked folder…": opens the shared picker
 *   relinkLinked(ref, filter)            a missing linked file: allow the folder again,
 *                                        or pick the file again (→ the new ref, or null)
 *   linkedMissingText(ref, name)         what to say about a missing linked file
 *   <LinkedRelinkButton ref onRelinked /> "Relink…" for the missing states
 */
import { Button } from '../ui/Button';
import { toast } from '../ui/toastStore';
import { getLinkedFolder, linkedProblem, linkedSupport, reconnectLinkedFolder, useLinkedFolders, type LinkedEntry } from '../../files/linkedFolders';
import { isLinkedRef, parseLinkedRef, type LinkedFilter } from '../../files/linkedRefs';
import { FILTER_WORDS, openLinkedPicker } from './linkedUi';

/** Are linked folders worth offering here (supported, or some are linked)? */
export function useLinkedAvailable(): boolean {
  const n = useLinkedFolders(s => s.folders.length);
  return n > 0 || linkedSupport() !== 'none';
}

export function LinkedPickButton({ filter, onPick, label, title, disabled, variant }: {
  filter: LinkedFilter;
  onPick: (ref: string, entry: LinkedEntry) => void;
  label?: string;
  title?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const ok = useLinkedAvailable();
  if (!ok) return null;
  return (
    <Button size="sm" variant={variant} icon="link" disabled={disabled} title={title ?? `Use ${FILTER_WORDS[filter].a} from a linked folder, read from disk where it is (not copied into the library)`}
      onClick={async () => { const p = await openLinkedPicker({ filter }); if (p?.kind === 'file') onPick(p.ref, p.entry); }}>
      {label ?? 'From a linked folder…'}
    </Button>
  );
}

/** A missing linked file: the folder asks for permission (one click), or pick the file again. The new ref, the same one when the folder came back, or null. */
export async function relinkLinked(ref: string, filter: LinkedFilter): Promise<string | null> {
  const p = parseLinkedRef(ref);
  if (!p) return null;
  const folder = getLinkedFolder(p.folderId);
  if (folder && linkedProblem(ref) === 'permission') {
    if ((await reconnectLinkedFolder(p.folderId)) === 'connected') return ref;
  }
  const dir = p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/')) : '';
  const pick = await openLinkedPicker({ filter, title: `Relink “${p.path.split('/').pop()}”`, folderId: folder ? p.folderId : undefined, dir: folder ? dir : undefined });
  return pick?.kind === 'file' ? pick.ref : null;
}

/** What a missing linked file's note says. */
export function linkedMissingText(ref: string, name: string): string {
  const p = parseLinkedRef(ref);
  const folder = p ? getLinkedFolder(p.folderId) : null;
  const why = linkedProblem(ref);
  if (!folder) return `“${name}” was in a linked folder this app doesn’t have (another computer, or unlinked). Relink it, or pick another file.`;
  if (why === 'permission') return `“${name}” is in “${folder.name}”, which needs your OK again. Relink allows it.`;
  if (why === 'folder') return `“${name}” is in “${folder.name}”, which isn’t there (drive unplugged, moved or renamed?). Plug it in, or relink.`;
  return `“${name}” isn’t in “${folder.name}” any more (moved, renamed or deleted). Relink it.`;
}

export function LinkedRelinkButton({ id, filter, onRelinked }: { id: string; filter: LinkedFilter; onRelinked: (ref: string) => void }) {
  if (!isLinkedRef(id)) return null;
  return (
    <Button size="sm" variant="primary" icon="link" onClick={async () => {
      try { const r = await relinkLinked(id, filter); if (r) onRelinked(r); }
      catch (e) { toast.error('Couldn’t relink it', { message: e instanceof Error ? e.message : String(e) }); }
    }}>Relink…</Button>
  );
}
