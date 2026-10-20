/**
 * store.ts — Texture Lab's window state (docs/texture-lab.md): open or not, the build with its undo history, the source
 * node it is built on, which card the inspector shows, and the preview (the before / after divider, a block shown on
 * its own). Knows nothing of the node graph (actions.ts joins the two: every change is built into the graph at once,
 * since the picture is the main preview's).
 */
import { create } from 'zustand';
import { blankSpec, type TextureLabSpec } from './spec';

interface TextureLabState {
  open: boolean;
  spec: TextureLabSpec;
  past: TextureLabSpec[];
  future: TextureLabSpec[];
  /** The source node of the build being edited; null until the first build. */
  targetId: string | null;
  at: { x: number; y: number } | null;
  /** The inspector's card: 'source' or a block id. */
  selected: string;
  /** The before / after divider (0–1 across the picture), or null for the picture alone. */
  split: number | null;
  /** The stack shown only up to this block (its card's eye), or null for all of it. */
  upTo: string | null;
  surpriseSeed: number | null;

  openWith: (spec: TextureLabSpec, o?: { targetId?: string | null; at?: { x: number; y: number } | null }) => void;
  close: () => void;
  /** Change the build: one undo step (`coalesce` folds a run of slider moves into one). */
  edit: (fn: (draft: TextureLabSpec) => void, coalesce?: string) => void;
  /** A preset, Surprise me: the whole build, one undo step. */
  replace: (spec: TextureLabSpec) => void;
  undo: () => void;
  redo: () => void;
  select: (id: string) => void;
  setSplit: (v: number | null) => void;
  setUpTo: (id: string | null) => void;
  setTarget: (id: string | null) => void;
  setSeed: (seed: number | null) => void;
}

let lastCoalesce: { key: string; at: number } | null = null;
const HISTORY = 100;

export const useTextureLab = create<TextureLabState>((set, get) => ({
  open: false,
  spec: blankSpec(),
  past: [],
  future: [],
  targetId: null,
  at: null,
  selected: 'source',
  split: 0.5,
  upTo: null,
  surpriseSeed: null,

  openWith: (spec, o = {}) => {
    lastCoalesce = null;
    set({ open: true, spec: structuredClone(spec), past: [], future: [], targetId: o.targetId ?? null, at: o.at ?? null, selected: spec.blocks[0]?.id ?? 'source', upTo: null, surpriseSeed: null });
  },
  close: () => set({ open: false, upTo: null }),
  edit: (fn, coalesce) => {
    const { spec, past } = get();
    const next = structuredClone(spec);
    fn(next);
    const now = Date.now();
    const fold = !!coalesce && lastCoalesce?.key === coalesce && now - lastCoalesce.at < 800;
    lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
    set({ spec: next, past: fold && past.length ? past : [...past, spec].slice(-HISTORY), future: [] });
  },
  replace: spec => {
    const { spec: was, past } = get();
    lastCoalesce = null;
    set({ spec: structuredClone(spec), past: [...past, was].slice(-HISTORY), future: [], upTo: null });
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
  select: selected => set({ selected }),
  setSplit: split => set({ split }),
  setUpTo: upTo => set({ upTo }),
  setTarget: targetId => set({ targetId }),
  setSeed: surpriseSeed => set({ surpriseSeed }),
}));
