/**
 * desktopPolish — evens out where the desktop app's WKWebView behaves unlike Chrome.
 *
 * - `data-desktop` on <html> turns on the desktop-only CSS in index.css (no native dragging of
 *   pictures, links and controls).
 * - The native context menu (Reload, Inspect Element) is kept off the app: it only opens where text
 *   can be edited or selected (Cut / Copy / Paste). The app's own right-click menus call
 *   preventDefault themselves and are unaffected.
 * - Trackpad pinch: WebKit sends GestureEvents where Chrome sends ctrl+wheel, so canvases that zoom
 *   on ctrl+wheel (the node graph, the keyframe editor) didn't zoom on desktop. A pinch that no
 *   element handled itself becomes ctrl+wheel events on the element under it.
 */

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Where the native menu stays: text that can be edited or selected (matches touchGuards / index.css). */
const TEXT = 'input, textarea, [contenteditable]:not([contenteditable="false"]), pre, code, [data-selectable], [data-reading] .pp-md';

/** Should the native context menu be kept from opening on this target? */
export function blocksNativeMenu(target: Element | null): boolean {
  return !target?.closest?.(TEXT);
}

/** The ctrl+wheel deltaY for a pinch step from scale `from` to `to` (Chrome's sign: out is positive). */
export const pinchDeltaY = (from: number, to: number): number => (from > 0 && to > 0 ? -Math.log(to / from) * 125 : 0);

interface GestureLike extends UIEvent { scale: number; clientX: number; clientY: number }

let installed = false;

export function installDesktopPolish(): void {
  if (installed || !isTauri()) return;
  installed = true;
  document.documentElement.setAttribute('data-desktop', '');

  // Bubbling, so the app's own handlers (which preventDefault) have already run.
  window.addEventListener('contextmenu', e => {
    if (!e.defaultPrevented && blocksNativeMenu(e.target instanceof Element ? e.target : null)) e.preventDefault();
  });

  let last = 1;
  let target: EventTarget | null = null;
  // If WebKit ever sends real ctrl+wheel for a pinch too, stand aside instead of zooming twice.
  let nativeCtrlWheel = false;
  window.addEventListener('wheel', e => { if (e.ctrlKey && e.isTrusted) nativeCtrlWheel = true; }, { capture: true, passive: true });
  window.addEventListener('gesturestart', e => {
    if (e.defaultPrevented) return; // an element handles pinch itself (the clip editor)
    e.preventDefault();
    last = 1;
    target = e.target;
    nativeCtrlWheel = false;
  });
  window.addEventListener('gesturechange', ev => {
    if (ev.defaultPrevented || !target) return;
    ev.preventDefault();
    const e = ev as GestureLike;
    const deltaY = pinchDeltaY(last, e.scale);
    last = e.scale;
    if (nativeCtrlWheel || !deltaY) return;
    const at = document.elementFromPoint(e.clientX, e.clientY) ?? (target instanceof Element ? target : document.body);
    at.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode: 0, ctrlKey: true, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true }));
  });
  window.addEventListener('gestureend', ev => { if (!ev.defaultPrevented) ev.preventDefault(); target = null; });
}
