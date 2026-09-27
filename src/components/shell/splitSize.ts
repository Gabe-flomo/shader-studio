/**
 * splitSize — how much of a phone's screen the picture gets above what sits
 * under it (the Studio's preview over the graph, the Play page's picture over
 * its panels), in vh, remembered on this device per page. PhoneSplit.tsx
 * draws the handle that sets it.
 *
 * Drag to any size between the page's min and max; let go near a snap point
 * and it settles there. Double-tap goes back to the page's default.
 */
import { useCallback, useRef, useState } from 'react';

export interface SplitSpec {
  /** Where the size is kept (localStorage). */
  key: string;
  /** The picture's height, in vh. */
  initial: number;
  min: number;
  max: number;
  /** Let go within SNAP_VH of one of these and the size settles on it. */
  snaps: readonly number[];
}

export const SNAP_VH = 3;

export const STUDIO_SPLIT: SplitSpec = { key: 'shader-studio:phoneSplit:studio', initial: 42, min: 15, max: 75, snaps: [30, 42, 60] };
export const PLAY_SPLIT: SplitSpec = { key: 'shader-studio:phoneSplit:play', initial: 42, min: 20, max: 70, snaps: [30, 42, 56] };

export const clampSplit = (spec: SplitSpec, vh: number): number => Math.max(spec.min, Math.min(spec.max, vh));

/** Where a drag that let go at `vh` settles: the nearest snap point within SNAP_VH, else where it is. */
export function settleSplit(spec: SplitSpec, vh: number): number {
  const v = clampSplit(spec, vh);
  let best = v, dist = SNAP_VH;
  for (const s of spec.snaps) { const d = Math.abs(s - v); if (d <= dist) { best = s; dist = d; } }
  return Math.round(best * 10) / 10;
}

export function readSplit(spec: SplitSpec): number {
  try {
    const raw = localStorage.getItem(spec.key);
    const n = Number(raw);
    if (raw !== null && Number.isFinite(n)) return clampSplit(spec, n);
  } catch { /* storage blocked */ }
  return spec.initial;
}

export function writeSplit(spec: SplitSpec, vh: number): void {
  try {
    if (vh === spec.initial) localStorage.removeItem(spec.key);
    else localStorage.setItem(spec.key, String(vh));
  } catch { /* storage blocked */ }
}

export interface PhoneSplit { vh: number; drag: (vh: number) => void; settle: (vh?: number) => void; reset: () => void }

/** The size, a setter for while dragging, and `settle` for letting go (snaps and remembers). */
export function usePhoneSplit(spec: SplitSpec): PhoneSplit {
  const [vh, setVh] = useState(() => readSplit(spec));
  // The size mid-drag, before React has re-rendered with it.
  const dragged = useRef<number | null>(null);
  const drag = useCallback((v: number) => { dragged.current = clampSplit(spec, v); setVh(dragged.current); }, [spec]);
  const settle = useCallback((v?: number) => {
    const s = settleSplit(spec, v ?? dragged.current ?? vh);
    dragged.current = null;
    setVh(s);
    writeSplit(spec, s);
  }, [spec, vh]);
  const reset = useCallback(() => { dragged.current = null; setVh(spec.initial); writeSplit(spec, spec.initial); }, [spec]);
  return { vh, drag, settle, reset };
}
