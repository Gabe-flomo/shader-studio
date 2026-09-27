/**
 * fullscreen.ts — one element full screen: the canvas (Studio and Play
 * preview, the picture alone) or a presentation (Slides and Scroll).
 *
 * Browsers get the Fullscreen API. Where that isn't there or is refused
 * (the desktop app's WKWebView, an iPhone), the element is pinned over the
 * whole window instead (`data-pf-fullscreen`, see FULLSCREEN_CSS) and, in the
 * desktop app, the window itself goes full screen through Tauri; both come
 * back on Esc or the button.
 *
 * `useFullscreen` is the state (what's full screen, and how); the helpers
 * below it are pure, for the keyboard shortcut and the tests.
 */
import { create } from 'zustand';

export type FullscreenTarget = 'canvas' | 'present';
export type FullscreenHow = 'api' | 'window';

export interface FullscreenState {
  target: FullscreenTarget | null;
  how: FullscreenHow | null;
}

export const useFullscreen = create<FullscreenState>(() => ({ target: null, how: null }));

/** The attribute that pins an element over the window when the Fullscreen API can't be used. */
export const PINNED_ATTR = 'data-pf-fullscreen';
export const FULLSCREEN_CSS = `[${PINNED_ATTR}]{position:fixed!important;inset:0!important;z-index:2147483000!important;width:100vw!important;height:100dvh!important;max-width:none!important;max-height:none!important;margin:0!important;border-radius:0!important;background:#000}`;

// ── Pure helpers ────────────────────────────────────────────────────────────

/** The state after entering (with how it went) or leaving. */
export function fullscreenAfter(event: { type: 'enter'; target: FullscreenTarget; how: FullscreenHow } | { type: 'exit' }): FullscreenState {
  return event.type === 'enter' ? { target: event.target, how: event.how } : { target: null, how: null };
}

export interface KeyLike { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; repeat?: boolean }

/**
 * Whether a key press toggles full screen: ⌘⇧F (Ctrl+Shift+F off the Mac)
 * anywhere, or F alone when not typing and `plainF` (the pages where F
 * doesn't already fit the graph in view).
 */
export function isFullscreenKey(e: KeyLike, opts: { typing: boolean; plainF: boolean }): boolean {
  if (e.repeat || e.key.toLowerCase() !== 'f' || e.altKey) return false;
  if ((e.metaKey || e.ctrlKey) && e.shiftKey) return true;
  return opts.plainF && !opts.typing && !e.metaKey && !e.ctrlKey && !e.shiftKey;
}

/** Whether a key event's target is a place to type. */
export function isTyping(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.isContentEditable;
}

/** How to go full screen here: the API when the page may use it, else pin the element (and the window, in the app). */
export function fullscreenMethod(env: { apiEnabled: boolean; hasRequest: boolean; tauri: boolean }): FullscreenHow {
  return env.apiEnabled && env.hasRequest ? 'api' : 'window';
}

// ── Doing it ────────────────────────────────────────────────────────────────

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean };

const fsElement = (): Element | null => {
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
};

async function tauriWindowFullscreen(on: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFullscreen(on);
  } catch { /* the pinned element still fills the window */ }
}

let pinned: HTMLElement | null = null;
let styleTag: HTMLStyleElement | null = null;
let listening = false;

function onFsChange() {
  const st = useFullscreen.getState();
  if (st.how === 'api' && !fsElement()) useFullscreen.setState(fullscreenAfter({ type: 'exit' }));
}

/** Esc leaves a pinned full screen (the API's own Esc is the browser's). Runs first, so Esc doesn't also leave Slides. */
function onKeyCapture(e: KeyboardEvent) {
  if (e.key !== 'Escape' || useFullscreen.getState().how !== 'window') return;
  e.preventDefault();
  e.stopPropagation();
  void exitFullscreen();
}

function listen() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  window.addEventListener('keydown', onKeyCapture, true);
}

function pin(el: HTMLElement) {
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.textContent = FULLSCREEN_CSS;
    document.head.appendChild(styleTag);
  }
  pinned = el;
  el.setAttribute(PINNED_ATTR, '');
  window.dispatchEvent(new Event('resize'));
}

export async function enterFullscreen(el: HTMLElement | null, target: FullscreenTarget): Promise<void> {
  if (!el) return;
  listen();
  if (useFullscreen.getState().target) await exitFullscreen();
  const d = document as FsDocument;
  const e = el as FsElement;
  const request = e.requestFullscreen ? () => e.requestFullscreen() : e.webkitRequestFullscreen ? () => e.webkitRequestFullscreen!() : null;
  const how = fullscreenMethod({ apiEnabled: !!(d.fullscreenEnabled ?? d.webkitFullscreenEnabled), hasRequest: !!request, tauri: isTauri() });
  if (how === 'api' && request) {
    try {
      // Some web views never answer, or answer and do nothing: only a real full screen, soon, counts.
      await Promise.race([Promise.resolve(request()), new Promise(r => setTimeout(r, 900))]);
      if (fsElement()) {
        useFullscreen.setState(fullscreenAfter({ type: 'enter', target, how: 'api' }));
        return;
      }
    } catch { /* refused: pin it instead */ }
  }
  pin(el);
  useFullscreen.setState(fullscreenAfter({ type: 'enter', target, how: 'window' }));
  await tauriWindowFullscreen(true);
}

export async function exitFullscreen(): Promise<void> {
  const st = useFullscreen.getState();
  if (st.how === 'api' && fsElement()) {
    const d = document as FsDocument;
    try { await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()); } catch { /* already out */ }
  }
  if (pinned) {
    pinned.removeAttribute(PINNED_ATTR);
    pinned = null;
    window.dispatchEvent(new Event('resize'));
    if (st.how === 'window') await tauriWindowFullscreen(false);
  }
  useFullscreen.setState(fullscreenAfter({ type: 'exit' }));
}

export function toggleFullscreen(el: HTMLElement | null, target: FullscreenTarget): Promise<void> {
  return useFullscreen.getState().target === target ? exitFullscreen() : enterFullscreen(el, target);
}

/**
 * Elements that can go full screen, by target: the preview's frame registers
 * itself, the Present page its root (with `prepare`, which switches Edit to
 * Slides first). The shortcut toggles whichever the page shows.
 */
const targets = new Map<FullscreenTarget, { el: HTMLElement; prepare?: () => void }>();
export function registerFullscreenTarget(target: FullscreenTarget, el: HTMLElement | null, prepare?: () => void): void {
  if (el) targets.set(target, { el, prepare });
  else targets.delete(target);
}
/** A ref for the preview's frame (whichever layout shows it): the canvas's full screen fills it. */
export const canvasFrameRef = (el: HTMLElement | null): void => registerFullscreenTarget('canvas', el);

export function toggleFullscreenTarget(target: FullscreenTarget): Promise<void> {
  if (useFullscreen.getState().target === target) return exitFullscreen();
  const t = targets.get(target);
  if (!t) return Promise.resolve();
  t.prepare?.();
  return enterFullscreen(t.el, target);
}
