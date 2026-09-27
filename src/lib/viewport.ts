/**
 * viewport.ts — one source of truth for "is this a phone" and "which way is
 * it held", and the live viewport size the layout is built on.
 *
 * A phone is a touch device whose *shorter* side is small, so turning an
 * iPhone sideways (≈850px wide) keeps the phone layout instead of opening
 * the desktop one; an iPad (shorter side ≥ 744) and a narrow desktop window
 * with a mouse never count. The touch fact is remembered for the session
 * (a device doesn't stop being a phone), and the short-side test has a
 * little hysteresis so the address bar coming and going can't flip it.
 *
 * `useViewport` is the store; `watchViewport` keeps it fresh on resize,
 * orientationchange and visualViewport changes, measuring again a moment
 * later because iOS reports the previous orientation for a frame or two.
 * It also writes `--app-vh` (the layout viewport's height in px) on <html>,
 * which the app's roots use in place of a `100dvh` that iOS sometimes
 * leaves stale after a rotation, and scrolls the page back to 0,0 so the
 * top bar can't end up under the status bar.
 */
import { create } from 'zustand';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop-sm' | 'desktop-lg';

/** The width-only breakpoint (what everything used before phones were detected by device). */
export function getBreakpoint(width: number): Breakpoint {
  if (width < 768)  return 'mobile';
  if (width < 1024) return 'tablet';
  if (width < 1280) return 'desktop-sm';
  return 'desktop-lg';
}

export interface ViewportSample {
  width: number;
  height: number;
  /** `(pointer: coarse)` matches, or the device has touch points, or the UA says it's a phone/tablet. */
  touch: boolean;
}

export interface Viewport {
  width: number;
  height: number;
  /** A phone (touch, short side small): the phone layout, either way up. */
  phone: boolean;
  /** Wider than tall. Meaningful on phones; desktop windows are usually landscape too. */
  landscape: boolean;
  /** The width-based breakpoint everything else keys on; `mobile` whenever `phone`. */
  breakpoint: Breakpoint;
  /** Whether a touch device has been seen this session (remembered: see above). */
  touchSeen: boolean;
}

/** A phone's shorter side is under this… */
export const PHONE_SHORT_SIDE = 600;
/** …and it stops being one only past this (hysteresis against the address bar). */
export const PHONE_SHORT_SIDE_LEAVE = 640;

/** The next viewport after a measurement, given the last one (for the latch and the hysteresis). */
export function nextViewport(prev: Viewport | null, s: ViewportSample): Viewport {
  const touchSeen = !!prev?.touchSeen || s.touch;
  const short = Math.min(s.width, s.height);
  const wasPhone = !!prev?.phone;
  const phone = touchSeen && (wasPhone ? short < PHONE_SHORT_SIDE_LEAVE : short < PHONE_SHORT_SIDE);
  const bp = phone ? 'mobile' : (() => { const b = getBreakpoint(s.width); return b === 'mobile' ? 'tablet' : b; })();
  return { width: s.width, height: s.height, phone, landscape: s.width > s.height, breakpoint: bp, touchSeen };
}

/** Whether a device is a touch one, from what a browser exposes. Pure, for the tests. */
export function isTouchDevice(env: { coarse: boolean; maxTouchPoints: number; ua: string }): boolean {
  if (env.coarse) return true;
  // iPadOS reports a desktop Mac UA — its touch points give it away.
  if (/Macintosh/.test(env.ua) && env.maxTouchPoints > 1) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(env.ua)) return true;
  return false;
}

/** The CSS custom properties the roots read: the layout viewport's height in px. */
export function viewportCssVars(s: { height: number }): Record<string, string> {
  return { '--app-vh': `${Math.round(s.height)}px` };
}

/** The app roots' height: the measured viewport, else the dynamic viewport height. */
export const APP_HEIGHT = 'var(--app-vh, 100dvh)';

function sample(): ViewportSample {
  const w = typeof window === 'undefined' ? null : window;
  if (!w) return { width: 1280, height: 800, touch: false };
  return {
    width: w.innerWidth,
    height: w.innerHeight,
    touch: isTouchDevice({ coarse: !!w.matchMedia?.('(pointer: coarse)').matches, maxTouchPoints: w.navigator?.maxTouchPoints ?? 0, ua: w.navigator?.userAgent ?? '' }),
  };
}

export const useViewport = create<Viewport>(() => nextViewport(null, sample()));

/** The viewport now, outside React. */
export const viewportSnapshot = (): Viewport => useViewport.getState();

export function measureViewport(): void {
  const s = sample();
  const prev = useViewport.getState();
  const next = nextViewport(prev, s);
  if (next.width !== prev.width || next.height !== prev.height || next.phone !== prev.phone || next.landscape !== prev.landscape || next.breakpoint !== prev.breakpoint || next.touchSeen !== prev.touchSeen) {
    useViewport.setState(next);
  }
  if (typeof document !== 'undefined') {
    const vars = viewportCssVars(s);
    for (const k of Object.keys(vars)) document.documentElement.style.setProperty(k, vars[k]);
  }
}

export interface ViewportEvents {
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  visualViewport?: { addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void } | null;
  screen?: { orientation?: { addEventListener?: (type: string, fn: () => void) => void; removeEventListener?: (type: string, fn: () => void) => void } };
  scrollTo?: (x: number, y: number) => void;
}

/** iOS reports the previous orientation for a frame or two: measure again this much later. */
export const RECHECK_MS = 250;

/**
 * Keeps `measure` fresh: on resize, orientationchange, visualViewport
 * resize/scroll and screen.orientation change, measuring at once and again
 * after RECHECK_MS (once per burst). A rotation also scrolls back to 0,0.
 * Returns a stop function. `win` is injectable for the tests.
 */
export function watchViewport(win: ViewportEvents, measure: () => void, timers: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (t: unknown) => void } = globalThis): () => void {
  let recheck: unknown = null;
  const fresh = () => {
    measure();
    if (recheck !== null) timers.clearTimeout(recheck);
    recheck = timers.setTimeout(() => { recheck = null; measure(); }, RECHECK_MS);
  };
  const rotated = () => { win.scrollTo?.(0, 0); fresh(); };
  win.addEventListener('resize', fresh);
  win.addEventListener('orientationchange', rotated);
  win.visualViewport?.addEventListener('resize', fresh);
  win.visualViewport?.addEventListener('scroll', fresh);
  win.screen?.orientation?.addEventListener?.('change', rotated);
  return () => {
    win.removeEventListener('resize', fresh);
    win.removeEventListener('orientationchange', rotated);
    win.visualViewport?.removeEventListener('resize', fresh);
    win.visualViewport?.removeEventListener('scroll', fresh);
    win.screen?.orientation?.removeEventListener?.('change', rotated);
    if (recheck !== null) timers.clearTimeout(recheck);
  };
}

let watching = false;
/** Start watching the real window (once). */
export function installViewportWatcher(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  measureViewport();
  watchViewport(window as unknown as ViewportEvents, measureViewport);
}
