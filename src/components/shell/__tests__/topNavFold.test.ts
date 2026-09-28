/** DesktopTopNav's responsive folding (topNavFold.ts): the pure decision, given the bar's own
 *  measured width, independent of the DOM/ResizeObserver plumbing that feeds it. */
import { describe, expect, it } from 'vitest';
import { getTopNavFold, TOP_NAV_FOLD_WIDTH } from '../topNavFold';

describe('getTopNavFold', () => {
  it('shows everything at full width', () => {
    const fold = getTopNavFold(1440);
    expect(fold).toEqual({ iconOnly: false, foldAux: false, recordLabel: true, scrollTabs: false, hideWordmark: false });
  });

  it('assumes the roomiest layout before the bar has been measured', () => {
    expect(getTopNavFold(0)).toEqual({ iconOnly: false, foldAux: false, recordLabel: true, scrollTabs: false, hideWordmark: false });
    expect(getTopNavFold(-1)).toEqual(getTopNavFold(0));
  });

  it('drops Import/GLSL/Export labels (and the saved-graph name) once things get tight', () => {
    const wide = getTopNavFold(TOP_NAV_FOLD_WIDTH.iconOnly + 1);
    const narrow = getTopNavFold(TOP_NAV_FOLD_WIDTH.iconOnly - 1);
    expect(wide.iconOnly).toBe(false);
    expect(narrow.iconOnly).toBe(true);
  });

  it('folds the least-used items into the overflow menu, and scrolls the tabs, together', () => {
    const above = getTopNavFold(TOP_NAV_FOLD_WIDTH.foldAux + 1);
    const below = getTopNavFold(TOP_NAV_FOLD_WIDTH.foldAux - 1);
    expect(above.foldAux).toBe(false);
    expect(above.scrollTabs).toBe(false);
    expect(below.foldAux).toBe(true);
    expect(below.scrollTabs).toBe(true);
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
    expect(getTopNavFold(900)).toEqual({ iconOnly: true, foldAux: true, recordLabel: false, scrollTabs: true, hideWordmark: true });
    expect(getTopNavFold(1440).iconOnly).toBe(false);
  });
});
