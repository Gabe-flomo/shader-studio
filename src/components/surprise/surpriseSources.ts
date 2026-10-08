/**
 * surpriseSources.ts — the word counts the Do bar's random line leans on (lang/surpriseBias.ts):
 * the bundled examples (loaded once, counted once) plus the user's saved graphs (read from storage
 * each time; cheap). Linked workspace files are not read.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { loadExampleGraphs } from '../../store/exampleIndex';
import { isGraphEntry } from '../../files/inventory';
import { countWords, type SurpriseBias } from '../../lang/surpriseBias';

const SAVED_PREFIX = 'shader-studio:';
let exampleCounts: SurpriseBias | null = null;

/** The user's saved graphs' nodes, from storage. */
export function savedGraphNodes(store: Pick<Storage, 'length' | 'key' | 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): GraphNode[][] {
  const out: GraphNode[][] = [];
  if (!store) return out;
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(SAVED_PREFIX)) continue;
      let v: unknown;
      try { v = JSON.parse(store.getItem(key) ?? 'null'); } catch { continue; }
      if (isGraphEntry(key, v)) out.push((v as { nodes: GraphNode[] }).nodes);
    }
  } catch { /* storage unavailable: examples only */ }
  return out;
}

/** Counts from the examples and the saved graphs, added together (examples are counted once per session). */
export async function loadSurpriseBias(): Promise<SurpriseBias> {
  if (!exampleCounts) {
    const all = await loadExampleGraphs();
    exampleCounts = countWords(Object.entries(all).filter(([k]) => k !== 'blank').map(([, g]) => g.nodes));
  }
  const mine = countWords(savedGraphNodes());
  const out: Record<string, number> = { ...exampleCounts };
  for (const [k, n] of Object.entries(mine)) out[k] = (out[k] ?? 0) + n * 4; // your own graphs count 4 times as much, being few
  return out;
}
