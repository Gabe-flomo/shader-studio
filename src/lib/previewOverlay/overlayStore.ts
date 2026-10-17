/**
 * The preview Overlay's settings (session only): the mode, the space whose grid is drawn, the
 * position marked in Position mode, the SDF measured in Shape mode, Distance's From centre, and
 * the Warp blend. React reads it only for the menu; the
 * canvas loop and the overlay drawing read it with getState() / subscribe.
 */
import { create } from 'zustand';

export type OverlayMode = 'off' | 'grid' | 'position' | 'shape' | 'distance';
/** A vec2 output in the graph. */
export interface SocketRef { nodeId: string; outputKey: string }

interface OverlayState {
  mode: OverlayMode;
  /** The space whose grid is drawn; null = the app's plain UV. */
  space: SocketRef | null;
  /** Position mode: the vec2 point to mark (read at the picture's centre). */
  position: SocketRef | null;
  /** Shape mode: the float SDF output measured (its d = 0 boundary, box, centre, radius). */
  sdf: SocketRef | null;
  /** Distance mode: each click measures from the space's origin (with the angle) instead of in pairs. */
  fromCentre: boolean;
  /** 0 = plain UV, 1 = the chosen space. */
  blend: number;
  /** Position mode draws the grid too. */
  gridInPosition: boolean;
  setMode: (m: OverlayMode) => void;
  setSpace: (s: SocketRef | null) => void;
  setPosition: (p: SocketRef | null) => void;
  setSdf: (s: SocketRef | null) => void;
  setFromCentre: (on: boolean) => void;
  setBlend: (t: number) => void;
  setGridInPosition: (on: boolean) => void;
}

export const useOverlay = create<OverlayState>(set => ({
  mode: 'off',
  space: null,
  position: null,
  sdf: null,
  fromCentre: false,
  blend: 1,
  gridInPosition: true,
  setMode: mode => set({ mode }),
  setSpace: space => set({ space }),
  setPosition: position => set({ position }),
  setSdf: sdf => set({ sdf }),
  setFromCentre: fromCentre => set({ fromCentre }),
  setBlend: blend => set({ blend: Math.max(0, Math.min(1, blend)) }),
  setGridInPosition: gridInPosition => set({ gridInPosition }),
}));

export const refKey = (r: SocketRef | null) => (r ? `${r.nodeId}::${r.outputKey}` : '');
export const parseRef = (k: string): SocketRef | null => {
  const i = k.indexOf('::');
  return i > 0 ? { nodeId: k.slice(0, i), outputKey: k.slice(i + 2) } : null;
};

/** What a read is of (mode, space, point, SDF): a frame read for another key is never drawn. */
export function overlayKey(st: { mode: OverlayMode; space: SocketRef | null; position: SocketRef | null; sdf: SocketRef | null }): string {
  return `${st.mode}|${refKey(st.space)}|${refKey(st.mode === 'position' ? st.position : null)}|${refKey(st.mode === 'shape' ? st.sdf : null)}`;
}

if (typeof window !== 'undefined') (window as unknown as { __overlay?: typeof useOverlay }).__overlay = useOverlay;
