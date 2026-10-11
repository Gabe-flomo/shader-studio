/**
 * store.ts — the Splat builder window's own state (docs/splat-builder.md): open or not, the scene being edited
 * with its undo history, the Splat Scene it is built as, the section in view and the effect card picked. Knows
 * nothing of the node graph (actions.ts joins the two: every change is built into the graph at once, since the
 * picture is the main preview's).
 */
import { create } from 'zustand';
import { starterSplatScene, type SplatBuilderSpec, type SplatSection } from './spec';
import { surpriseSplatScene } from './surprise';
import type { ScanBox } from './place';

export const SPLAT_SECTIONS: SplatSection[] = ['scan', 'place', 'effects', 'scene', 'camera', 'look'];

interface SplatBuilderState {
  open: boolean;
  spec: SplatBuilderSpec;
  past: SplatBuilderSpec[];
  future: SplatBuilderSpec[];
  /** The Splat Scene of the build being edited; null until the first build. */
  targetId: string | null;
  at: { x: number; y: number } | null;
  section: SplatSection;
  /** Under the hood: the recipe in place of the settings. */
  hood: boolean;
  /** The effect card picked (its id). */
  picked: string | null;
  surpriseSeed: number | null;
  /**
   * A new file was picked: fit it to the view once the engine knows its box (the box it knew before, as text, so
   * the old scan's box isn't taken for the new one). Null: nothing waiting.
   */
  fitPending: { was: string } | null;

  openWith: (spec: SplatBuilderSpec, o?: { targetId?: string | null; at?: { x: number; y: number } | null; section?: SplatSection }) => void;
  close: () => void;
  /** Change the scene: one undo step (`coalesce` folds a run of slider moves into one). */
  edit: (fn: (draft: SplatBuilderSpec) => void, coalesce?: string) => void;
  replace: (spec: SplatBuilderSpec) => void;
  undo: () => void;
  redo: () => void;
  /** A viewport drag: one undo step however long it pauses. */
  beginGesture: () => void;
  endGesture: () => void;
  setSection: (s: SplatSection) => void;
  setHood: (on: boolean) => void;
  setPicked: (id: string | null) => void;
  setTarget: (id: string | null) => void;
  setFitPending: (p: { was: string } | null) => void;
  /** Surprise me: a scene from `seed` over this one (the scan stays), one undo step. */
  surprise: (seed: number, box?: ScanBox | null) => void;
}

let lastCoalesce: { key: string; at: number } | null = null;
let gesture = false;
const HISTORY = 100;

export const useSplatBuilder = create<SplatBuilderState>((set, get) => ({
  open: false,
  spec: starterSplatScene(),
  past: [],
  future: [],
  targetId: null,
  at: null,
  section: 'scan',
  hood: false,
  picked: null,
  surpriseSeed: null,
  fitPending: null,

  openWith: (spec, o = {}) => {
    lastCoalesce = null;
    gesture = false;
    set({
      open: true, spec: structuredClone(spec), past: [], future: [], targetId: o.targetId ?? null, at: o.at ?? null,
      section: o.section ?? 'scan', hood: false, picked: spec.effects[0]?.id ?? null, surpriseSeed: null, fitPending: null,
    });
  },
  close: () => set({ open: false, hood: false }),
  edit: (fn, coalesce) => {
    const { spec, past } = get();
    const next = structuredClone(spec);
    fn(next);
    const now = Date.now();
    const fold = gesture || (!!coalesce && lastCoalesce?.key === coalesce && now - lastCoalesce.at < 800);
    lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
    set({ spec: next, past: fold && past.length ? past : [...past, spec].slice(-HISTORY), future: [] });
  },
  replace: spec => {
    const { spec: was, past, picked } = get();
    lastCoalesce = null;
    set({ spec: structuredClone(spec), past: [...past, was].slice(-HISTORY), future: [], picked: spec.effects.some(e => e.id === picked) ? picked : spec.effects[0]?.id ?? null });
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
  beginGesture: () => {
    // The first edit of the drag makes its step; the rest fold into it.
    const { spec, past } = get();
    set({ past: [...past, spec].slice(-HISTORY), future: [] });
    gesture = true;
    lastCoalesce = null;
  },
  endGesture: () => {
    if (!gesture) return;
    gesture = false;
    // A click that changed nothing leaves no step.
    const { spec, past } = get();
    if (past.length && past[past.length - 1] === spec) set({ past: past.slice(0, -1) });
  },
  setSection: section => set({ section, hood: false }),
  setHood: hood => set({ hood }),
  setPicked: picked => set({ picked }),
  setTarget: targetId => set({ targetId }),
  setFitPending: fitPending => set({ fitPending }),
  surprise: (seed, box) => {
    get().replace(surpriseSplatScene(seed, get().spec, box));
    set({ surpriseSeed: seed, picked: get().spec.effects[0]?.id ?? null });
  },
}));
