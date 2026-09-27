/** Below this width (the app's phone breakpoint) a Menu opens as a bottom sheet. */
export const MENU_SHEET_BELOW = 768;

/** Does a menu open as a bottom sheet at this viewport width? `sheet` forces it either way. */
export function menuAsSheet(viewportWidth: number, sheet: boolean | 'auto' = 'auto'): boolean {
  return sheet === 'auto' ? viewportWidth < MENU_SHEET_BELOW : sheet;
}
