/**
 * store.ts — the Time Cube builder window's own state (docs/timecube-builder.md): open or not, the scene with its undo
 * history, the Time Cube it is built as, the section in view. Knows nothing of the node graph (actions.ts joins the
 * two: every change is built into the graph at once, since the picture is the main preview's).
 */
import { create } from 'zustand';
import { blankSpec, type TcSection, type TimeCubeSpec } from './spec';
import { surpriseTimeCube } from './surprise';

interface TimeCubeBuilderState {
  open: boolean;
  spec: TimeCubeSpec;
  past: TimeCubeSpec[];
  future: TimeCubeSpec[];
  /** The Time Cube of the build being edited; null until the first build. */
  targetId: string | null;
  at: { x: number; y: number } | null;
  section: TcSection;
  surpriseSeed: number | null;

  openWith: (spec: TimeCubeSpec, o?: { targetId?: string | null; at?: { x: number; y: number } | null; section?: TcSection }) => void;
  close: () => void;
  /** Change the scene: one undo step (`coalesce` folds a run of slider moves into one). */
  edit: (fn: (draft: TimeCubeSpec) => void, coalesce?: string) => void;
  /** A preset, Surprise me: the whole scene, one undo step. */
  replace: (spec: TimeCubeSpec) => void;
  /** Take what the graph has now (a card or the clip editor changed a built node): no undo step of its own. */
  adopt: (spec: TimeCubeSpec) => void;
  undo: () => void;
  redo: () => void;
  setSection: (s: TcSection) => void;
  setTarget: (id: string | null) => void;
  /** Surprise me: a scene from `seed` (your video stays), one undo step. */
  surprise: (seed: number) => void;
}

let lastCoalesce: { key: string; at: number } | null = null;
const HISTORY = 100;

export const useTimeCubeBuilder = create<TimeCubeBuilderState>((set, get) => ({
  open: false,
  spec: blankSpec(),
  past: [],
  future: [],
  targetId: null,
  at: null,
  section: 'shape',
  surpriseSeed: null,

  openWith: (spec, o = {}) => {
    lastCoalesce = null;
    set({ open: true, spec: structuredClone(spec), past: [], future: [], targetId: o.targetId ?? null, at: o.at ?? null, section: o.section ?? 'shape', surpriseSeed: null });
  },
  close: () => set({ open: false }),
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
    set({ spec: structuredClone(spec), past: [...past, was].slice(-HISTORY), future: [] });
  },
  adopt: spec => set({ spec }),
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
  setSection: section => set({ section }),
  setTarget: targetId => set({ targetId }),
  surprise: seed => {
    get().replace(surpriseTimeCube(seed, get().spec));
    set({ surpriseSeed: seed });
  },
}));
