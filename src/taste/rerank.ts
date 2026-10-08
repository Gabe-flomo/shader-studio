/**
 * rerank.ts — the Do bar's type-ahead and node search, leaned on lightly by taste (docs/taste.md). An item
 * can move up by at most ~1.5 places, and exact matches of what was typed never move.
 */
import { nodeBucket } from './features';
import { nodeLean, type TasteModel } from './model';

/** Re-rank `items` (best first) by a taste lean of −1 … 1; items that `exact` says match exactly stay first, in order. */
export function tasteRerank<T>(items: readonly T[], lean: (item: T) => number, exact: (item: T) => boolean = () => false, reach = 1.5): T[] {
  const ex = items.filter(exact);
  const rest = items.map((item, i) => ({ item, i })).filter(x => !exact(x.item));
  const keyed = rest.map((x, j) => ({ item: x.item, k: j - reach * Math.max(-1, Math.min(1, lean(x.item))) }));
  keyed.sort((a, b) => a.k - b.k);
  return [...ex, ...keyed.map(x => x.item)];
}

/** How much the model likes a node type (−1 … 1). */
export const nodeTypeLean = (m: TasteModel, type: string) => nodeLean(m, nodeBucket(type));
