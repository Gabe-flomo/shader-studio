/** Taking a snapshot into the open presentation, saying where a source came from, and opening its graph. */
import { snapshotExample, snapshotSaved } from '../../present/snapshot';
import type { PresentSource } from '../../types/presentation';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { askConfirm } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import type { PlayableRow } from '../play/OpenPlayable';
import type { Page } from '../page';
import { usePresentation } from './presentationStore';

/** Snapshot a saved graph or example into the open presentation. */
export async function addSourceFrom(row: PlayableRow): Promise<PresentSource | null> {
  const doc = usePresentation.getState().doc;
  // The same Play twice is one source (take a new snapshot with Refresh).
  const existing = doc?.sources.find(s => (row.kind === 'saved' ? s.from.kind === 'saved' && s.from.name === row.id : s.from.kind === 'example' && s.from.key === row.id));
  if (existing) return existing;
  const r = row.kind === 'saved' ? snapshotSaved(row.id) : await snapshotExample(row.id);
  if (!r.ok) { toast.error(`Couldn’t take a snapshot of “${row.label}”`, { message: r.error }); return null; }
  usePresentation.getState().addSource(r.source);
  return r.source;
}

export function originText(s: PresentSource): string {
  const when = s.capturedAt ? new Date(s.capturedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  return `${s.from.kind === 'saved' ? 'Saved graph' : 'Example'}${when ? ` · copied ${when}` : ''}`;
}

/** Open a source's graph in the Studio or on the Play page (asks first if that would replace unsaved work). */
export async function openSourceGraph(s: PresentSource, page: Page, navigate: (p: Page) => void): Promise<void> {
  const st = useNodeGraphStore.getState();
  if (st.graphDirty && !(await askConfirm('Open this graph?', { message: 'The graph open in the Studio has changes that aren’t saved. Opening another one replaces it.', confirmLabel: 'Open it' }))) return;
  if (s.from.kind === 'saved') {
    const r = st.loadSavedGraph(s.from.name);
    if (!r.ok) { toast.error('Couldn’t open it', { message: r.error }); return; }
  } else {
    await st.loadExampleGraph(s.from.key);
  }
  navigate(page);
}
