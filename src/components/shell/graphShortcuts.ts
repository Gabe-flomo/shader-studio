/**
 * Graph shortcuts that need more than one line in App.tsx: ⌘S, ⇧⌘S and ⌘A (useShortcuts.ts
 * `save` / `saveAs` / `selectAll`).
 *
 * ⌘S saves the open graph as its next Minor version straight away, the same as the save form's
 * primary button. With nothing saved yet it opens the save form beside the name, so the first
 * save asks for a name. ⇧⌘S always opens the form on "New graph…" (save under another name).
 *
 * The form lives in the top bar (DesktopTopNav's name chip, the phone's Save button); it listens
 * for OPEN_SAVE_FORM.
 */
import { getActiveNodes, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { nextNumber, seriesLabel } from '../../store/graphVersions';
import { reportFileResult } from './reportFileResult';

export const OPEN_SAVE_FORM = 'playfield:open-save-form';

export interface OpenSaveFormDetail {
  /** Open on the "save under a name" side of the form. */
  asNew: boolean;
}

export function openSaveForm(asNew: boolean): void {
  window.dispatchEvent(new CustomEvent<OpenSaveFormDetail>(OPEN_SAVE_FORM, { detail: { asNew } }));
}

/** What ⌘S does: `'saved'` when it saved a new version, `'form'` when it opened the form to ask for a name. */
export async function saveShortcut(): Promise<'saved' | 'form'> {
  const st = useNodeGraphStore.getState();
  const current = st.currentGraph;
  if (!current) {
    openSaveForm(true);
    return 'form';
  }
  const next = nextNumber(current.name, 'minor', { major: current.major, minor: current.minor });
  reportFileResult(await st.saveGraph(current.name, '', 'minor'), {
    failTitle: `Couldn’t save “${current.name}”`,
    success: `Saved “${current.name}” ${seriesLabel(next)}`,
  });
  return 'saved';
}

export function saveAsShortcut(): void {
  openSaveForm(true);
}

/** ⌘A: select every node at the level the canvas shows (top level, or inside the open group). */
export function selectAllNodesAtLevel(): number {
  const st = useNodeGraphStore.getState();
  const ids = (getActiveNodes(st.nodes, st.activeGroupPath) ?? []).map(n => n.id);
  st.selectNodes(ids);
  return ids.length;
}
