/**
 * runtimeHost.ts — the web player (play/runtime/play-runtime.js, with the
 * layer kit) running inside the app, for the Present page's canvases. It is
 * the same script the exported page carries, evaluated once here, so a
 * canvas on the page and on the exported web page are the same player.
 *
 * It also keeps the page's live canvases under a cap (browsers allow about
 * 16 WebGL contexts a page; every running canvas costs a frame): a canvas asks
 * for a slot while it's visible, gets one if fewer than LIVE_CAP are running,
 * and shows its last still frame otherwise.
 */
import { create } from 'zustand';
import runtimeSource from '../play/runtime/play-runtime.js?raw';
import { kitScript, playBundle, type PlayHtmlInput } from '../play/exportHtml';

export interface PlayMountOptions {
  mode?: 'player' | 'background';
  fit?: 'contain' | 'cover';
  markers?: boolean;
  panel?: boolean;
  pointer?: boolean;
  startTime?: number;
  paused?: boolean;
  pauseOffscreen?: boolean;
  maxDpr?: number;
}

export interface PlayMount {
  destroy(): void;
  pause?(): void;
  play?(): void;
  get?(id: string): { value: number | number[] | undefined; driven: boolean } | null;
  set?(id: string, value: number | number[]): void;
  fire?(id: string): void;
  still?(): string | null;
}

interface PlayRuntime {
  version: number;
  mount(el: HTMLElement, bundle: unknown, opts: PlayMountOptions): PlayMount;
  enableMidi?(): Promise<boolean>;
  listen?(): Promise<string>;
}

declare global {
  interface Window { ShaderStudioPlay?: PlayRuntime }
}

/** The runtime, evaluated on first use. */
export function playRuntime(): PlayRuntime {
  if (!window.ShaderStudioPlay || window.ShaderStudioPlay.version < 3) {
    // The same text the web export inlines: the kit first, then the player.
    new Function(`${kitScript()}\n${runtimeSource}`)();
  }
  return window.ShaderStudioPlay!;
}

/** Mount a source's bundle; the mount is cleaned out of `el` on destroy even if the shader failed. */
export function mountPlay(el: HTMLElement, input: PlayHtmlInput, opts: PlayMountOptions): PlayMount {
  const m = playRuntime().mount(el, playBundle(input), { mode: 'player', fit: 'cover', ...opts });
  return {
    ...m,
    destroy() { try { m.destroy(); } finally { el.innerHTML = ''; el.classList.remove('ssp', 'ssp-bg'); } },
  };
}

// ── Live canvases under a cap ───────────────────────────────────────────────

/** Most canvases running at once (phones get fewer). */
export const LIVE_CAP = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches ? 3 : 6;

interface SlotState { queue: string[]; want(id: string): void; drop(id: string): void; promote(id: string): void }
export const useLiveSlots = create<SlotState>(set => ({
  queue: [],
  want: id => set(s => (s.queue.includes(id) ? s : { queue: [...s.queue, id] })),
  drop: id => set(s => (s.queue.includes(id) ? { queue: s.queue.filter(x => x !== id) } : s)),
  // Run this one now: it goes to the front, and the oldest running one waits.
  promote: id => set(s => ({ queue: [id, ...s.queue.filter(x => x !== id)] })),
}));

/** Whether this canvas has a live slot right now. */
export function useHasSlot(id: string): boolean {
  return useLiveSlots(s => { const i = s.queue.indexOf(id); return i >= 0 && i < LIVE_CAP; });
}

/** The last frame each canvas showed (by block), for when it isn't running. */
export const stills = new Map<string, string>();

/**
 * A small still of a source, for lists and canvases that don't run: mounted
 * off-screen for a moment, one frame at `time` seconds, then released.
 */
export async function renderPoster(input: PlayHtmlInput, time = 1.5, width = 480, height = 270): Promise<string | null> {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(host);
  let m: PlayMount | null = null;
  try {
    m = mountPlay(host, input, { panel: false, pointer: false, startTime: time, paused: true, maxDpr: 1 });
    for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(() => r(null)));
    const png = m.still?.() ?? null;
    if (!png) return null;
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('still')); img.src = png; });
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d')!.drawImage(img, 0, 0, width, height);
    return c.toDataURL('image/jpeg', 0.78);
  } catch {
    return null;
  } finally {
    m?.destroy();
    host.remove();
  }
}
