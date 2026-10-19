/**
 * exampleLinksModel.ts — the non-visual half of ExampleLinks.tsx: which nodes a search is about, and
 * opening an example the normal way (docs/node-browser.md, "Examples using a node").
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { askConfirm } from '../ui/dialogStore';
import { requestPage } from '../page';
import { TIER, type RankedMatch } from './nodeSearchModel';
import { exampleCountFor } from '../../store/exampleNodeIndex';

/** Open an example: ask first when the open graph has unsaved changes. True when it opened. */
export async function openExampleAsking(key: string, label: string): Promise<boolean> {
  const st = useNodeGraphStore.getState();
  if (st.graphDirty && !(await askConfirm(`Open the example “${label}”?`, { message: 'The graph open now has changes that aren’t saved; opening another one drops them.', confirmLabel: 'Open', danger: true }))) return false;
  await useNodeGraphStore.getState().loadExampleGraph(key);
  requestPage('studio');
  return true;
}

/**
 * The node types a search is about, or none when it is too vague to say: the best tier's matches
 * (up to three) when that tier is a name match (exact, prefix or word), or the matches themselves
 * when there are three or fewer. Types no example uses are left out.
 */
export function searchFocusTypes(matches: readonly Pick<RankedMatch, 'def' | 'tier'>[], max = 3): string[] {
  if (!matches.length) return [];
  const best = matches[0].tier;
  const pool = best >= TIER.word ? matches.filter(m => m.tier === best) : matches.length <= max ? matches : [];
  return pool.map(m => m.def.type).filter(t => exampleCountFor(t) > 0).slice(0, max);
}

/** "Examples using Circle SDF", "… using Circle SDF and Box SDF", "… using Circle SDF, Box SDF…". */
export function usingTitle(labels: string[]): string {
  if (labels.length <= 1) return `Examples using ${labels[0] ?? 'these nodes'}`;
  if (labels.length === 2) return `Examples using ${labels[0]} and ${labels[1]}`;
  return `Examples using ${labels.slice(0, 2).join(', ')}…`;
}
