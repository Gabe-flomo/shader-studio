/**
 * The preview Overlay's settings (session only): the mode, the space whose grid is drawn, the
 * position marked in Position mode, and the Warp blend. React reads it only for the menu; the
 * canvas loop and the overlay drawing read it with getState() / subscribe.
 */
import { create } from 'zustand';

export type OverlayMode = 'off' | 'grid' | 'position';
/** A vec2 output in the graph. */
export interface SocketRef { nodeId: string; outputKey: string }

interface OverlayState {
  mode: OverlayMode;
  /** The space whose grid is drawn; null = the app's plain UV. */
  space: SocketRef | null;
  /** Position mode: the vec2 point to mark (read at the picture's centre). */
  position: SocketRef | null;
  /** 0 = plain UV, 1 = the chosen space. */
  blend: number;
  /** Position mode draws the grid too. */
  gridInPosition: boolean;
  setMode: (m: OverlayMode) => void;
  setSpace: (s: SocketRef | null) => void;
  setPosition: (p: SocketRef | null) => void;
  setBlend: (t: number) => void;
  setGridInPosition: (on: boolean) => void;
}

export const useOverlay = create<OverlayState>(set => ({
  mode: 'off',
  space: null,
  position: null,
  blend: 1,
  gridInPosition: true,
  setMode: mode => set({ mode }),
  setSpace: space => set({ space }),
  setPosition: position => set({ position }),
  setBlend: blend => set({ blend: Math.max(0, Math.min(1, blend)) }),
  setGridInPosition: gridInPosition => set({ gridInPosition }),
}));

export const refKey = (r: SocketRef | null) => (r ? `${r.nodeId}::${r.outputKey}` : '');
export const parseRef = (k: string): SocketRef | null => {
  const i = k.indexOf('::');
  return i > 0 ? { nodeId: k.slice(0, i), outputKey: k.slice(i + 2) } : null;
};

if (typeof window !== 'undefined') (window as unknown as { __overlay?: typeof useOverlay }).__overlay = useOverlay;
