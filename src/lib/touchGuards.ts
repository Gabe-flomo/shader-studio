/**
 * touchGuards — on touch screens a long press fires `contextmenu`, which (on Android) opens the
 * browser's own menu for a picture or a link, on top of the app's long-press menus. Cancel it
 * everywhere except where text can be selected; the app's own handlers still run, since this
 * only calls preventDefault after them (a window listener, bubbling).
 */
const TEXT = 'input, textarea, [contenteditable]:not([contenteditable="false"]), pre, code, [data-selectable], [data-reading] .pp-md';

/** Is this press one the browser's long-press menu should be kept from? */
export function blocksTouchMenu(target: Element | null, pointerType: string | undefined, coarse: boolean): boolean {
  const touch = pointerType === 'touch' || pointerType === 'pen' || (pointerType === undefined || pointerType === '' ? coarse : false);
  if (!touch) return false;
  return !target?.closest?.(TEXT);
}

export function installTouchGuards(): void {
  if (typeof window === 'undefined') return;
  const coarse = window.matchMedia?.('(pointer: coarse)');
  window.addEventListener('contextmenu', e => {
    const pointerType = (e as PointerEvent).pointerType;
    if (blocksTouchMenu(e.target instanceof Element ? e.target : null, pointerType, !!coarse?.matches)) e.preventDefault();
  });
}
