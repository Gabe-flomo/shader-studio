/**
 * linkActions — what the links between graphs and presentations do
 * (present/links.ts keeps the data): make a presentation from a graph, open a
 * linked presentation or sample, load a linked graph (asking first when that
 * would replace unsaved work), and the offer made when a presentation with
 * linked graphs is opened. Loaded with the Present page, or on first use from
 * the Studio.
 */
import { snapshotSaved } from '../../present/snapshot';
import { emptyPresentation, newBlock, newStep } from '../../types/presentation';
import { decideOnPresentationOpen, link, linkedGraphsOf, linkedOpenSetting } from '../../present/links';
import { presentationExists } from '../../present/storage';
import { SAMPLE_PRESENTATIONS } from '../../present/samples';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { toast } from '../ui/toastStore';
import { requestPage } from '../page';
import { usePresentation } from './presentationStore';
import { confirmReplaceGraph } from './sourceActions';

/** Toast titles (so a page can clear its own). */
export const LINKED_GRAPH_TOAST = 'This presentation has a graph';

const more = (n: number) => (n > 0 ? ` (and ${n} more)` : '');

/**
 * A new presentation from a saved graph: one step with the graph's picture
 * (with its first controls when it has a Play setup), linked to the graph,
 * and opened on the Present page. Returns its name.
 */
export function createPresentationFromGraph(graph: string): string | null {
  const r = snapshotSaved(graph);
  if (!r.ok) { toast.error(`Couldn’t make a presentation from “${graph}”`, { message: r.error }); return null; }
  const source = r.source;
  const block = newBlock(source.bundle.play.controls.length ? 'interactive' : 'render', source);
  const doc = emptyPresentation(graph);
  const step = { ...newStep(graph), blocks: [block] };
  const name = usePresentation.getState().adopt({ ...doc, steps: [step], sources: [source] });
  link(graph, name);
  return name;
}

/** Open a saved presentation on the Present page's store (the page itself isn't shown). */
export function openPresentation(name: string): boolean {
  const st = usePresentation.getState();
  if (st.name === name) return true;
  if (!st.open(name)) { toast.error(`Couldn’t open “${name}”`, { message: 'It isn’t saved here any more.' }); return false; }
  return true;
}

/**
 * A sample presentation by title: the one already saved under that name when
 * there is one, else built fresh (like picking it on the Present page).
 */
export async function openSampleByTitle(title: string): Promise<boolean> {
  if (presentationExists(title)) return openPresentation(title);
  const sample = SAMPLE_PRESENTATIONS.find(s => s.title === title);
  if (!sample) return false;
  try {
    usePresentation.getState().adopt(await sample.build());
    return true;
  } catch (e) {
    toast.error('Couldn’t build the sample', { message: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/** Load a linked saved graph into the Studio (asking first if that replaces unsaved work). Stays on this page. */
export async function loadLinkedGraph(graph: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  if (useNodeGraphStore.getState().currentGraph?.name === graph && !useNodeGraphStore.getState().graphDirty) return true;
  if (!(await confirmReplaceGraph())) return false;
  const r = useNodeGraphStore.getState().loadSavedGraph(graph);
  if (!r.ok) { toast.error(`Couldn’t open “${graph}”`, { message: r.error }); return false; }
  if (!opts.quiet) toast.success(`Loaded “${graph}”`, { message: 'It’s the open graph in the Studio and on Play now.', action: { label: 'Open Studio', onClick: () => requestPage('studio') } });
  return true;
}

/**
 * A presentation was opened by hand: its linked graph is offered (a notice
 * with Load), loaded (the "Always" setting, when nothing unsaved is in the
 * way), or left alone.
 */
export function announcePresentationOpened(name: string): void {
  const st = useNodeGraphStore.getState();
  const d = decideOnPresentationOpen({ setting: linkedOpenSetting(), linked: linkedGraphsOf(name), currentGraph: st.currentGraph?.name ?? null, graphDirty: st.graphDirty });
  if (d.kind === 'none') return;
  if (d.kind === 'open') {
    void loadLinkedGraph(d.name, { quiet: true }).then(ok => {
      if (ok) toast.info(`Loaded its graph, “${d.name}”${more(d.others)}`, { message: 'Linked to this presentation.', action: { label: 'Open Studio', onClick: () => requestPage('studio') } });
    });
    return;
  }
  toast.info(LINKED_GRAPH_TOAST, {
    message: `“${d.name}”${more(d.others)}`,
    action: { label: 'Load it', onClick: () => { void loadLinkedGraph(d.name); } },
  });
}

/** The saved graphs the open presentation's Plays were copied from (that are still here). */
export function graphsUsedHere(): string[] {
  const doc = usePresentation.getState().doc;
  const out: string[] = [];
  for (const s of doc?.sources ?? []) {
    if (s.from.kind !== 'saved' || out.includes(s.from.name)) continue;
    try { if (localStorage.getItem(`shader-studio:${s.from.name}`) !== null) out.push(s.from.name); } catch { /* storage unavailable */ }
  }
  return out;
}
