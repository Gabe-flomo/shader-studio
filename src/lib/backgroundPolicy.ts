/**
 * backgroundPolicy.ts — what Playfield does with the GPU while you're elsewhere (App settings →
 * Background). Two settings:
 *
 *  - When the window isn't the active one (another app or browser window in front, the tab
 *    still showing): Slow down (default, about 8 frames a second), Pause, or Keep drawing.
 *    A hidden tab already draws nothing (ShaderCanvas). An open output window or a recording
 *    always keeps full speed: the renderer checks those itself.
 *  - Free GPU memory after a few minutes hidden (default on): the main canvas and the node
 *    preview renderer give their WebGL contexts back, so other tabs and apps (Shadertoy, a
 *    game) get the memory, and rebuild when you come back. Simulations start over then.
 *
 * The settings live in localStorage like every App setting; this module only reads them and
 * watches focus and visibility.
 */
export type BackgroundMode = 'slow' | 'pause' | 'keep';

export const BACKGROUND_MODE_KEY = 'shader-studio:settings:backgroundMode';
export const RELEASE_GPU_KEY = 'shader-studio:settings:releaseGpuWhenHidden';
/** Frames a second while slowed down. */
export const SLOW_FPS = 8;
/** How long the tab must stay hidden before the GPU contexts are given back. */
export const RELEASE_AFTER_MS = 3 * 60 * 1000;

const read = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};

export function backgroundMode(): BackgroundMode {
  const v = read(BACKGROUND_MODE_KEY);
  return v === 'pause' || v === 'keep' ? v : 'slow';
}

export function setBackgroundMode(mode: BackgroundMode): void {
  try { if (mode === 'slow') localStorage.removeItem(BACKGROUND_MODE_KEY); else localStorage.setItem(BACKGROUND_MODE_KEY, mode); } catch { /* storage unavailable: the default holds */ }
}

export function releaseGpuWhenHidden(): boolean {
  return read(RELEASE_GPU_KEY) !== 'off';
}

export function setReleaseGpuWhenHidden(on: boolean): void {
  try { if (on) localStorage.removeItem(RELEASE_GPU_KEY); else localStorage.setItem(RELEASE_GPU_KEY, 'off'); } catch { /* storage unavailable */ }
}

/**
 * What the render loop does this frame while another window may be in front: 'draw', 'skip'
 * (Slow down, too soon since the last drawn frame: ask for the next one) or 'stop' (Pause: stop
 * the loop until focus returns). 'hold': an overlay holds the preview (lib/previewHold.ts, the
 * explain view drawing its own picture): stop until it lets go, the clock paused. An output
 * window or a recording (fullSpeed) is never held. Pure, for the loop and the tests.
 */
export function backgroundFrame(o: { focused: boolean; mode: BackgroundMode; fullSpeed: boolean; now: number; lastDraw: number; held?: boolean }): 'draw' | 'skip' | 'stop' | 'hold' {
  if (o.held && !o.fullSpeed) return 'hold';
  if (o.focused || o.fullSpeed || o.mode === 'keep') return 'draw';
  if (o.mode === 'pause') return 'stop';
  return o.now - o.lastDraw < 1000 / SLOW_FPS ? 'skip' : 'draw';
}

// ── Focus and visibility ────────────────────────────────────────────────────

const hasDoc = typeof document !== 'undefined' && typeof window !== 'undefined';
let focused = hasDoc ? document.hasFocus() : true;
const focusListeners = new Set<(focused: boolean) => void>();

/** Whether this window is the active one (keyboard focus is somewhere in it). */
export function appFocused(): boolean { return focused; }

/** Called when the window gains or loses focus; returns the unsubscribe. */
export function onFocusChange(cb: (focused: boolean) => void): () => void {
  focusListeners.add(cb);
  return () => { focusListeners.delete(cb); };
}

interface Releaser { release: () => void; restore: () => void }
const releasers = new Set<Releaser>();
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let released = false;

/**
 * Register something holding GPU memory: `release` runs once the tab has been hidden for
 * RELEASE_AFTER_MS (and the setting is on), `restore` when it shows again. `release` may
 * decline (an output window or a recording still needs it) by doing nothing.
 */
export function onLongHidden(r: Releaser): () => void {
  releasers.add(r);
  return () => { releasers.delete(r); };
}

/** Whether the GPU contexts were given back and not yet restored. */
export function gpuReleased(): boolean { return released; }

if (hasDoc) {
  const setFocused = (f: boolean) => {
    if (f === focused) return;
    focused = f;
    for (const cb of focusListeners) cb(f);
  };
  window.addEventListener('focus', () => setFocused(true));
  window.addEventListener('blur', () => setFocused(false));
  // A click into an iframe (the output preview, a docs frame) blurs the window without leaving the app.
  document.addEventListener('pointerdown', () => setFocused(true), true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (releaseTimer) clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        if (!document.hidden || !releaseGpuWhenHidden() || released) return;
        released = true;
        for (const r of releasers) { try { r.release(); } catch (e) { console.warn('[background] release failed', e); } }
      }, RELEASE_AFTER_MS);
    } else {
      if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
      if (released) {
        released = false;
        for (const r of releasers) { try { r.restore(); } catch (e) { console.warn('[background] restore failed', e); } }
      }
      setFocused(document.hasFocus());
    }
  });
}
