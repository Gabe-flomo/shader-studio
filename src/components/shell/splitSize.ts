/**
 * splitSize — how much of a phone's screen the picture gets above what sits
 * under it (the Studio's preview over the graph, the Play page's picture over
 * its panels), in vh, remembered on this device per page. PhoneSplit.tsx
 * draws the handle that sets it.
 *
 * Drag to any size between the page's min and max; let go and it settles on
 * the nearest snap point (portrait: a small strip, the default, a big picture),
 * or, sideways, only when let go near one. Double-tap goes back to the default.
 *
 * Portrait sizes are fractions of the app's own height (--app-vh, the visible
 * viewport, so iOS's sliding address bar can't push the sheet under the bottom
 * bar), not CSS vh: see splitLength.
 *
 * Held sideways, the picture sits on the left and the size is its width in
 * vw instead (the *_LANDSCAPE specs), remembered separately.
 */
import { useCallback, useRef, useState } from 'react';

export interface SplitSpec {
  /** Where the size is kept (localStorage). */
  key: string;
  /** The picture's height in vh (portrait), or its width in vw (landscape). */
  initial: number;
  min: number;
  max: number;
  /** Let go within SNAP_VH of one of these and the size settles on it. */
  snaps: readonly number[];
  /** Always settle on the nearest snap point, wherever it's let go (portrait phones). */
  snapAlways?: boolean;
}

export const SNAP_VH = 3;

// Portrait: three stops: a 25% strip (the sheet gets most of the screen), the 42% default, a 70% big picture.
export const STUDIO_SPLIT: SplitSpec = { key: 'shader-studio:phoneSplit:studio', initial: 42, min: 15, max: 75, snaps: [25, 42, 70], snapAlways: true };
export const PLAY_SPLIT: SplitSpec = { key: 'shader-studio:phoneSplit:play', initial: 42, min: 20, max: 70, snaps: [25, 42, 70], snapAlways: true };
export const STUDIO_SPLIT_LANDSCAPE: SplitSpec = { key: 'shader-studio:phoneSplit:studio:landscape', initial: 45, min: 25, max: 70, snaps: [35, 45, 55] };
export const PLAY_SPLIT_LANDSCAPE: SplitSpec = { key: 'shader-studio:phoneSplit:play:landscape', initial: 50, min: 30, max: 70, snaps: [40, 50, 60] };

export const clampSplit = (spec: SplitSpec, vh: number): number => Math.max(spec.min, Math.min(spec.max, vh));

/** Where a drag that let go at `vh` settles: the nearest snap point (within SNAP_VH unless the spec always snaps), else where it is. */
export function settleSplit(spec: SplitSpec, vh: number): number {
  const v = clampSplit(spec, vh);
  let best = v, dist = spec.snapAlways ? Infinity : SNAP_VH;
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

/**
 * A portrait split size as a CSS length: that share of the app's height (--app-vh is the
 * visible viewport in px, kept current as iOS's address bar slides; 100dvh before it's set).
 * Plain vh is the *large* viewport on iOS, so 42vh was more than 42% of what's on screen.
 */
export const splitLength = (vh: number): string => `calc(var(--app-vh, 100dvh) * ${Math.round(vh * 10) / 1000})`;

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
