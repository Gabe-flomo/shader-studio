/** DesktopTopNav's responsive folding (topNavFold.ts): the pure decision, given the bar's own
 *  measured width, independent of the DOM/ResizeObserver plumbing that feeds it. */
import { describe, expect, it } from 'vitest';
import { getTopNavFold, TOP_NAV_FOLD_WIDTH } from '../topNavFold';

describe('getTopNavFold', () => {
  it('shows everything at full width', () => {
    const fold = getTopNavFold(1440);
    expect(fold).toEqual({ iconOnly: false, foldAux: false, recordLabel: true, hideWordmark: false });
  });

  it('assumes the roomiest layout before the bar has been measured', () => {
    expect(getTopNavFold(0)).toEqual({ iconOnly: false, foldAux: false, recordLabel: true, hideWordmark: false });
    expect(getTopNavFold(-1)).toEqual(getTopNavFold(0));
  });

  it('drops Import/GLSL/Export labels (and the saved-graph name) once things get tight', () => {
    const wide = getTopNavFold(TOP_NAV_FOLD_WIDTH.iconOnly + 1);
    const narrow = getTopNavFold(TOP_NAV_FOLD_WIDTH.iconOnly - 1);
    expect(wide.iconOnly).toBe(false);
    expect(narrow.iconOnly).toBe(true);
  });

  it('folds the least-used items (Workspace/Keyboard/Hands, Rebuild, theme) into the overflow menu', () => {
    const above = getTopNavFold(TOP_NAV_FOLD_WIDTH.foldAux + 1);
    const below = getTopNavFold(TOP_NAV_FOLD_WIDTH.foldAux - 1);
    expect(above.foldAux).toBe(false);
    expect(below.foldAux).toBe(true);
  });

  it('drops the Record label only once narrower than the aux fold', () => {
    expect(getTopNavFold(TOP_NAV_FOLD_WIDTH.recordLabel).recordLabel).toBe(true);
    expect(getTopNavFold(TOP_NAV_FOLD_WIDTH.recordLabel - 1).recordLabel).toBe(false);
    // Sanity: the priority order from the bug report — labels go before aux folds, before the
    // Record label, before the brand wordmark.
    expect(TOP_NAV_FOLD_WIDTH.iconOnly).toBeGreaterThan(TOP_NAV_FOLD_WIDTH.foldAux);
    expect(TOP_NAV_FOLD_WIDTH.foldAux).toBeGreaterThan(TOP_NAV_FOLD_WIDTH.recordLabel);
    expect(TOP_NAV_FOLD_WIDTH.recordLabel).toBeGreaterThan(TOP_NAV_FOLD_WIDTH.hideWordmark);
  });

  it('hides the brand wordmark last, only at the narrowest widths', () => {
    expect(getTopNavFold(TOP_NAV_FOLD_WIDTH.hideWordmark).hideWordmark).toBe(false);
    expect(getTopNavFold(TOP_NAV_FOLD_WIDTH.hideWordmark - 1).hideWordmark).toBe(true);
  });

  it('fits the bar\'s known trouble spot: fully folded well before 900px, fully open by 1440px', () => {
    expect(getTopNavFold(900)).toEqual({ iconOnly: true, foldAux: true, recordLabel: false, hideWordmark: true });
    expect(getTopNavFold(1440).iconOnly).toBe(false);
  });

  // The status pills (Keyboard, Hands) render in the right-hand cluster only while `!foldAux`
  // (DesktopTopNav.tsx); the slot decision below 900/1024/1180/1440 — the widths the pill-overlap
  // bug was checked at — has to keep folding them into the "···" menu rather than trying to
  // squeeze both pills' full labels in alongside everything else at borderline widths, because
  // (unlike the tab strip) the right-hand cluster is deliberately never allowed to shrink below
  // its own content's natural width — see DesktopTopNav.tsx and the class doc above. So this
  // fold decision is what keeps the cluster's content small enough to actually fit in the common
  // case; the *no-overlap* guarantee itself is structural (CSS), not this function's job.
  it('slots the Keyboard/Hands pills into the overflow menu at every checked narrow width', () => {
    for (const w of [900, 1024, 1180 - 1]) {
      expect(getTopNavFold(w).foldAux).toBe(true);
    }
    // 1180 and 1440 (both pills' full labels, inline, alongside undo/redo/save/load/etc.) are the
    // widths the bar was checked at with room to spare; foldAux only lifts once the bar is at
    // least the foldAux threshold itself.
    for (const w of [TOP_NAV_FOLD_WIDTH.foldAux, 1440]) {
      expect(getTopNavFold(w).foldAux).toBe(false);
    }
  });
});
