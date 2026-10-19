/**
 * fitLayout.ts — which of a toolbar's items stay on the bar and which go into its "⋯" menu
 * (docs/toolbars.md). Pure, so it can be tested without layout; FitToolbar.tsx measures the widths.
 *
 * Every item has a priority (higher stays longer). When the items don't all fit, room is made for
 * the "⋯" button and the items are taken in priority order (ties: the earlier one on the bar stays)
 * until one doesn't fit; it and every item below it fold. Pinned items never fold. Items marked
 * `menu: 'always'` are never on the bar. Order on the bar never changes: folding only removes.
 */

export interface FitMeasure {
  key: string;
  /** Measured width on the bar, px (the last one seen while it was there). */
  width: number;
  priority: number;
  /** Never folds (the bar scrolls sideways instead, as a last resort). */
  pinned?: boolean;
  /** Always in the menu, never on the bar. */
  alwaysMenu?: boolean;
  /** Folding drops it rather than moving it into the menu (a label, a divider). */
  noMenu?: boolean;
}

export interface FitResult {
  /** Keys moved off the bar (into the menu, or dropped when `noMenu`). */
  folded: Set<string>;
  /** Whether the "⋯" button shows: something is in the menu. */
  more: boolean;
}

/**
 * @param avail   the bar's inner width, px
 * @param moreW   the "⋯" button's width, px
 * @param gap     the gap between items, px
 */
export function fitItems(items: readonly FitMeasure[], avail: number, moreW: number, gap = 0): FitResult {
  const folded = new Set<string>(items.filter(i => i.alwaysMenu).map(i => i.key));
  const onBar = items.filter(i => !i.alwaysMenu);
  const width = (list: readonly FitMeasure[]) => list.reduce((s, i) => s + i.width, 0) + gap * Math.max(0, list.length - 1);
  const anyMenu = (set: Set<string>) => items.some(i => set.has(i.key) && !i.noMenu);
  // Everything fits (with the "⋯" if the always-in-menu items need it): nothing more folds.
  if (avail <= 0 || width(onBar) + (anyMenu(folded) ? moreW + gap : 0) <= avail + 0.5) {
    return { folded, more: anyMenu(folded) };
  }
  // Pinned first, then by priority (stable: earlier on the bar wins a tie).
  const order = onBar.map((it, idx) => ({ it, idx })).sort((a, b) =>
    (Number(!!b.it.pinned) - Number(!!a.it.pinned)) || (b.it.priority - a.it.priority) || (a.idx - b.idx));
  const hasMenuItems = onBar.some(i => !i.noMenu && !i.pinned) || anyMenu(folded);
  let budget = avail - (hasMenuItems ? moreW + gap : 0);
  let full = false;
  for (const { it } of order) {
    const need = it.width + gap;
    if (it.pinned) { budget -= need; continue; }
    if (!full && need <= budget + 0.5) { budget -= need; continue; }
    full = true;
    folded.add(it.key);
  }
  return { folded, more: anyMenu(folded) };
}
