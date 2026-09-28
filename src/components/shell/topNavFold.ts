/**
 * DesktopTopNav's responsive folding: a pure function of the bar's *measured* width (from a
 * ResizeObserver on the bar itself, not the window or a page-level breakpoint), so it adapts to
 * the actual space — including a narrowed studio pane in split view or a wide Hands pill.
 *
 * Folding priority, widest to narrowest:
 *  1. `iconOnly`     — Import/GLSL/Export drop their text labels (icon + tooltip only), and the
 *                      current graph's name/version next to Save hides.
 *  2. `foldAux`      — the least-used items (Workspace chip, Keyboard pill, Hands pill, Rebuild,
 *                      theme toggle) move into the "···" overflow menu; the tab strip becomes
 *                      horizontally scrollable instead of shrinking the right cluster further.
 *  3. `recordLabel`  — false once things get very tight: Record drops its "Record" text, keeping
 *                      only the red dot + icon.
 *  4. `hideWordmark` — the brand block sheds "Playfield" last, keeping only the mark.
 */
export interface TopNavFold {
  /** Import/GLSL/Export show icons only; the saved-graph name next to Save hides. */
  iconOnly: boolean;
  /** Workspace/Keyboard/Hands chips and Rebuild/theme fold into the "···" overflow menu. */
  foldAux: boolean;
  /** Whether Record still shows its "Record" text (true = shown). */
  recordLabel: boolean;
  /** Whether the tab strip should scroll horizontally instead of overflowing. */
  scrollTabs: boolean;
  /** Whether the brand wordmark ("Playfield") is hidden, keeping only the mark. */
  hideWordmark: boolean;
}

/** Bar-width thresholds (px) below which each fold stage kicks in. Tuned against the real bar at
 *  900/1024/1180/1440px so nothing clips across that range; see DesktopTopNav.tsx. */
export const TOP_NAV_FOLD_WIDTH = {
  iconOnly: 1300,
  foldAux: 1180,
  recordLabel: 1010,
  hideWordmark: 940,
} as const;

/**
 * `width <= 0` means "not measured yet" (first paint, before the ResizeObserver reports): assume
 * the roomiest layout so nothing flashes folded before it has to.
 */
export function getTopNavFold(width: number): TopNavFold {
  if (width <= 0) {
    return { iconOnly: false, foldAux: false, recordLabel: true, scrollTabs: false, hideWordmark: false };
  }
  const foldAux = width < TOP_NAV_FOLD_WIDTH.foldAux;
  return {
    iconOnly: width < TOP_NAV_FOLD_WIDTH.iconOnly,
    foldAux,
    recordLabel: width >= TOP_NAV_FOLD_WIDTH.recordLabel,
    scrollTabs: foldAux,
    hideWordmark: width < TOP_NAV_FOLD_WIDTH.hideWordmark,
  };
}
