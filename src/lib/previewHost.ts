/**
 * previewHost — where the main preview's canvas is right now. One ShaderCanvas
 * is mounted at a time (the app's preview column, or a page hosting the canvas
 * itself: shell/PageCanvas.tsx); whichever mounted last registers here, and
 * Record / Snapshot take the picture from it.
 */
import { create } from 'zustand';
import type { OfflineRenderHandle } from '../components/ShaderCanvas';

interface PreviewHost {
  canvas: HTMLCanvasElement | null;
  offline: OfflineRenderHandle | null;
  setCanvas: (c: HTMLCanvasElement | null) => void;
  setOffline: (h: OfflineRenderHandle | null) => void;
}

export const usePreviewHost = create<PreviewHost>(set => ({
  canvas: null,
  offline: null,
  setCanvas: canvas => set({ canvas }),
  setOffline: offline => set({ offline }),
}));

/** Open Record (App listens): the same as the top bar's button. */
export function openRecord(): void {
  window.dispatchEvent(new Event('open-record'));
}
