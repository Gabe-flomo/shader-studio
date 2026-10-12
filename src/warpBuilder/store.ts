/**
 * store.ts — the Warp Builder window's own state (docs/warp-builder.md): open or not, the warp stack
 * (with undo), the preview view, the picked tile, the hovered block, and where it was opened from
 * (a new warp, or the 2D Scene Builder's space, whose blocks Done writes back). Knows nothing of the
 * graph (actions.ts joins them).
 */
import { create } from 'zustand';
import { starterWarp, surpriseWarp, type PreviewMode, type WarpSel, type WarpSpec } from './spec';

export type { WarpSel };

/** A new warp (Done builds a small graph), or blocks of the 2D builder's space (`ids`; null: add to its end). */
export type WarpOrigin = { kind: 'new' } | { kind: '2d'; ids: string[] | null };

interface WarpState {
  open: boolean;
  spec: WarpSpec;
  past: WarpSpec[];
  future: WarpSpec[];
  mode: PreviewMode;
  sel: WarpSel | null;
  /** The block whose "space after it" the preview shows (hover). */
  hover: number | null;
  origin: WarpOrigin;
  surpriseSeed: number | null;

  openWith: (spec: WarpSpec, origin?: WarpOrigin) => void;
  close: () => void;
  edit: (fn: (d: WarpSpec) => void, coalesce?: string) => void;
  replace: (spec: WarpSpec) => void;
  undo: () => void;
  redo: () => void;
  setMode: (m: PreviewMode) => void;
  select: (s: WarpSel | null) => void;
  setHover: (b: number | null) => void;
  surprise: (seed: number) => void;
}

let lastCoalesce: { key: string; at: number } | null = null;
const HISTORY = 100;

export const useWarpBuilder = create<WarpState>((set, get) => ({
  open: false,
  spec: starterWarp(),
  past: [],
  future: [],
  mode: 'checker',
  sel: null,
  hover: null,
  origin: { kind: 'new' },
  surpriseSeed: null,

  openWith: (spec, origin = { kind: 'new' }) => set({
    open: true, spec: structuredClone(spec), past: [], future: [], origin, hover: null,
    sel: spec.blocks.length ? { block: 0, line: 0, path: [] } : null,
  }),
  close: () => set({ open: false, hover: null }),
  edit: (fn, coalesce) => {
    const { spec, past } = get();
    const next = structuredClone(spec);
    fn(next);
    const now = Date.now();
    const fold = !!coalesce && lastCoalesce?.key === coalesce && now - lastCoalesce.at < 800;
    lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
    set({ spec: next, past: fold ? past : [...past, spec].slice(-HISTORY), future: [] });
  },
  replace: spec => {
    const { spec: was, past } = get();
    lastCoalesce = null;
    set({ spec: structuredClone(spec), past: [...past, was].slice(-HISTORY), future: [] });
  },
  undo: () => {
    const { past, spec, future } = get();
    if (!past.length) return;
    lastCoalesce = null;
    set({ spec: past[past.length - 1], past: past.slice(0, -1), future: [spec, ...future] });
  },
  redo: () => {
    const { past, spec, future } = get();
    if (!future.length) return;
    lastCoalesce = null;
    set({ spec: future[0], past: [...past, spec], future: future.slice(1) });
  },
  setMode: mode => set({ mode }),
  select: sel => set({ sel }),
  setHover: hover => set({ hover }),
  surprise: seed => {
    get().replace(surpriseWarp(seed));
    set({ surpriseSeed: seed, sel: { block: 0, line: 0, path: [] } });
  },
}));
