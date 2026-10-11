/**
 * store.ts — the Grid builder window's own state (docs/grid-builder.md): open or not, the scene
 * being edited with its undo history, which build it edits, the section in view, and the brush the
 * mini grid paints with. Knows nothing of the node graph (actions.ts joins the two), like the 2D
 * Scene Builder's store.
 */
import { create } from 'zustand';
import { starterGridScene, type GridSceneSpec } from './spec';
import { surpriseGridScene } from './surprise';

export type GridSection = 'shapes' | 'motion' | 'patterns' | 'rules' | 'look';
export const GRID_SECTIONS: GridSection[] = ['shapes', 'motion', 'patterns', 'rules', 'look'];

interface GridBuilderState {
  open: boolean;
  spec: GridSceneSpec;
  past: GridSceneSpec[];
  future: GridSceneSpec[];
  /** The UV node of the build being edited; null builds a new scene. */
  targetSceneId: string | null;
  at: { x: number; y: number } | null;
  section: GridSection;
  /** The shape the mini grid paints with (and Shapes / Motion edit), or 'erase'. */
  brush: string;
  /** A rule waiting for a cell to be picked on the mini grid (its id). */
  picking: string | null;
  dirty: boolean;
  surpriseSeed: number | null;

  openWith: (spec: GridSceneSpec, o?: { targetSceneId?: string | null; at?: { x: number; y: number } | null; section?: GridSection }) => void;
  close: () => void;
  /** Change the scene: one undo step (`coalesce` folds a run of slider moves, or one drag of painting, into one). */
  edit: (fn: (draft: GridSceneSpec) => void, coalesce?: string) => void;
  replace: (spec: GridSceneSpec) => void;
  undo: () => void;
  redo: () => void;
  setSection: (s: GridSection) => void;
  setBrush: (b: string) => void;
  setPicking: (id: string | null) => void;
  setTarget: (id: string | null) => void;
  markBuilt: () => void;
  /** Surprise me: a random scene from `seed`, one undo step. */
  surprise: (seed: number) => void;
}

let lastCoalesce: { key: string; at: number } | null = null;
const HISTORY = 100;

export const useGridBuilder = create<GridBuilderState>((set, get) => ({
  open: false,
  spec: starterGridScene(),
  past: [],
  future: [],
  targetSceneId: null,
  at: null,
  section: 'shapes',
  brush: 'A',
  picking: null,
  dirty: false,
  surpriseSeed: null,

  openWith: (spec, o = {}) => set({
    open: true, spec: structuredClone(spec), past: [], future: [], dirty: !o.targetSceneId,
    targetSceneId: o.targetSceneId ?? null, at: o.at ?? null, section: o.section ?? 'shapes',
    brush: spec.shapes[0]?.id ?? 'erase', picking: null, surpriseSeed: null,
  }),
  close: () => set({ open: false, picking: null }),
  edit: (fn, coalesce) => {
    const { spec, past } = get();
    const next = structuredClone(spec);
    fn(next);
    const now = Date.now();
    // A run of slider moves folds while it keeps coming; a painting stroke ("stroke:…") is one step however slow.
    const fold = !!coalesce && lastCoalesce?.key === coalesce && (coalesce.startsWith('stroke:') || now - lastCoalesce.at < 800);
    lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
    set({ spec: next, past: fold ? past : [...past, spec].slice(-HISTORY), future: [], dirty: true });
  },
  replace: spec => {
    const { spec: was, past, brush } = get();
    lastCoalesce = null;
    const keep = spec.shapes.some(s => s.id === brush) || brush === 'erase';
    set({ spec: structuredClone(spec), past: [...past, was].slice(-HISTORY), future: [], dirty: true, brush: keep ? brush : spec.shapes[0]?.id ?? 'erase', picking: null });
  },
  undo: () => {
    const { past, spec, future } = get();
    if (!past.length) return;
    lastCoalesce = null;
    set({ spec: past[past.length - 1], past: past.slice(0, -1), future: [spec, ...future], dirty: true });
  },
  redo: () => {
    const { past, spec, future } = get();
    if (!future.length) return;
    lastCoalesce = null;
    set({ spec: future[0], past: [...past, spec], future: future.slice(1), dirty: true });
  },
  setSection: section => set({ section, picking: null }),
  setBrush: brush => set({ brush }),
  setPicking: picking => set({ picking }),
  setTarget: id => set({ targetSceneId: id }),
  markBuilt: () => set({ dirty: false }),
  surprise: seed => {
    get().replace(surpriseGridScene(seed));
    set({ surpriseSeed: seed, brush: get().spec.shapes[0]?.id ?? 'erase' });
  },
}));
