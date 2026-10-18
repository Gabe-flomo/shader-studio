/**
 * The Studio's split between the graph and the preview (desktop):
 *
 * - Maximize graph: the graph takes the preview's space too (the preview keeps running under it, so
 *   coming back is instant). A toolbar button and ⇧⌘G (useShortcuts.ts `maximizeGraph`) toggle it;
 *   remembered on this device.
 * - The preview's width: the default leaves the graph room for a few cards at a readable zoom at
 *   1440 wide, and a width the divider was dragged to is remembered on this device.
 */
import { create } from 'zustand';

const MAX_KEY = 'playfield.graphMaximized';
const WIDTH_KEY = 'playfield.previewWidth';

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

interface GraphMaximize {
  on: boolean;
  toggle: () => void;
  set: (on: boolean) => void;
}

export const useGraphMaximize = create<GraphMaximize>((set, get) => ({
  on: read(MAX_KEY) === '1',
  toggle: () => get().set(!get().on),
  set: on => { write(MAX_KEY, on ? '1' : null); set({ on }); },
}));

/**
 * The preview's default width on a desktop window `w` wide. Up to 1800 it takes 30% (at least 420):
 * at 1440 that's 432, leaving the graph about 640 beside the node list, room for the starter at a
 * readable zoom. Wider windows have room to spare and keep the larger 38%.
 */
export function defaultPreviewWidth(w: number, bp: 'desktop-lg' | 'desktop-sm' | 'tablet'): number {
  if (bp === 'desktop-lg') return w < 1800 ? Math.max(Math.floor(w * 0.30), 420) : Math.floor(w * 0.38);
  if (bp === 'desktop-sm') return Math.max(Math.floor(w * 0.32), 300);
  return Math.max(Math.floor(w * 0.45), 280);
}

/** A width the divider was dragged to, when it still fits this window. */
export function rememberedPreviewWidth(w: number, min: number, minGraph: number): number | null {
  const v = Number(read(WIDTH_KEY));
  if (!Number.isFinite(v) || v <= 0) return null;
  return v >= min && v <= w - minGraph ? Math.round(v) : null;
}

export function rememberPreviewWidth(px: number): void { write(WIDTH_KEY, String(Math.round(px))); }
