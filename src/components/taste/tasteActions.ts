/**
 * tasteActions.ts — the taste model in the app (docs/taste.md): ratings from the like/dislike controls,
 * and the implicit signals (a surprise kept or undone, a node starred, a graph edited after keeping, a
 * saved graph opened often). All local: src/taste/store.ts.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { loadExampleGraphs } from '../../store/exampleIndex';
import { graphFeatures, learnSignal, nodeTypeFeatures, noteOpened, paletteFeatures, rateItem, techniqueFeatures, type Features, type RatingKind } from '../../taste';
import { updateTaste } from '../../taste/store';

export interface RateTarget {
  id: string;
  kind: RatingKind;
  label?: string;
  /** The item's features (may need loading: an example's graph). */
  features: () => Features | Promise<Features>;
}

/** Rate an item: 1 like, −1 dislike, 0 clears. */
export async function rate(t: RateTarget, value: number): Promise<void> {
  let f: Features;
  try { f = await t.features(); } catch { f = { _bias: 1 }; }
  updateTaste(m => rateItem(m, { id: t.id, kind: t.kind, label: t.label }, value, f));
}

/** Rate targets for the things the app shows. */
export const rateTargets = {
  saved(name: string): RateTarget {
    return {
      id: `saved:${name}`, kind: 'graph', label: name,
      features: () => {
        try {
          const v = JSON.parse(localStorage.getItem(`shader-studio:${name}`) ?? 'null') as { nodes?: GraphNode[] } | null;
          return graphFeatures(v?.nodes ?? [], { id: `saved:${name}` });
        } catch { return { _bias: 1 }; }
      },
    };
  },
  example(key: string, label: string): RateTarget {
    return { id: `example:${key}`, kind: 'example', label, features: async () => graphFeatures((await loadExampleGraphs())[key]?.nodes ?? [], { id: `example:${key}` }) };
  },
  shader(id: string, label: string): RateTarget {
    // A GLSL shader: it carries code; its functions' stages come from the inspired fragments when it's a source.
    return { id: `shader:${id}`, kind: 'shader', label, features: () => ({ _bias: 1, 'code:yes': 1 }) };
  },
  technique(id: string, label: string): RateTarget {
    return { id: `technique:${id}`, kind: 'technique', label, features: () => techniqueFeatures(id) };
  },
  palette(colours: ReadonlyArray<readonly number[]>, label = 'Palette'): RateTarget {
    const id = `palette:${colours.map(c => c.map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')).join('-')}`;
    return { id, kind: 'palette', label, features: () => ({ _bias: 1, ...paletteFeatures(colours) }) };
  },
};

/** A node starred in the Nodes tab. */
export function favouritedNode(type: string, on: boolean): void {
  if (on) updateTaste(m => learnSignal(m, 'favourited', nodeTypeFeatures(type)));
}

/** A saved graph opened; the third and later opens count as "opened often". */
export function openedSaved(name: string, nodes: readonly GraphNode[]): void {
  updateTaste(m => {
    const o = noteOpened(m, `saved:${name}`);
    return o.often ? learnSignal(o.model, 'opened', graphFeatures(nodes, { id: `saved:${name}` })) : o.model;
  });
}

let stopWatch: (() => void) | null = null;

/**
 * After a kept surprise: the first edit within ten minutes counts as "edited after keeping" (a good sign),
 * and going back to the graph before it (Undo) counts as "undone".
 */
export function watchAfterKeep(before: readonly GraphNode[], after: readonly GraphNode[], f: Features): void {
  stopWatch?.();
  const until = Date.now() + 10 * 60_000;
  const ids = (ns: readonly GraphNode[]) => ns.map(n => n.id).sort().join(',');
  const beforeIds = ids(before);
  const unsub = useNodeGraphStore.subscribe(s => {
    if (s.nodes === after) return;
    stop();
    if (Date.now() > until) return;
    updateTaste(m => learnSignal(m, ids(s.nodes) === beforeIds ? 'undone' : 'edited', f));
  });
  const stop = () => { unsub(); if (stopWatch === stop) stopWatch = null; };
  stopWatch = stop;
}

/** Stop watching (the toast's Undo already counted it). */
export function stopWatchingKeep(): void { stopWatch?.(); }
