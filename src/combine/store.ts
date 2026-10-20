/**
 * store.ts — the Combine window's own state (docs/combine.md): open or not, the stack being edited with its undo
 * history, the build it is in the graph as (its anchor), the layer selected and the one isolated in the viewport, and
 * the "+ Add a layer" picker. Knows nothing of the graph (actions.ts joins the two: every change is built into the
 * draft graph at once, since the picture is the main preview's).
 */
import { create } from 'zustand';
import { emptyCombine, type CombineSpec, type ProductRef } from './spec';

/** "+ Add a layer": the layer it goes on (null: a base), and the product picked so far (then: how it joins). */
export interface CombinePicker { on: string | null; product: ProductRef | null }

interface CombineState {
  open: boolean;
  spec: CombineSpec;
  past: CombineSpec[];
  future: CombineSpec[];
  /** The glue node holding the spec once built; null until there is glue (two layers). */
  anchorId: string | null;
  selected: string | null;
  /** The layer the viewport shows on its own (the stack up to it); null: the whole stack. */
  isolate: string | null;
  picker: CombinePicker | null;
  /** Hand edits on the glue found when it opened (Keep my edits / Rebuild it), until answered. */
  edits: { params: string[]; wires: string[] } | null;
  /** The last build's warnings, and each layer's problem / passes (actions.ts sets them). */
  warnings: string[];
  layerInfo: Record<string, { problem?: string; passes: number }>;

  openWith: (spec: CombineSpec, o?: { anchorId?: string | null; picker?: CombinePicker | null; selected?: string | null }) => void;
  close: () => void;
  /** Change the stack: one undo step. */
  edit: (fn: (draft: CombineSpec) => void) => void;
  replace: (spec: CombineSpec) => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  setIsolate: (id: string | null) => void;
  setPicker: (p: CombinePicker | null) => void;
  setAnchor: (id: string | null) => void;
  setEdits: (e: CombineState['edits']) => void;
  setBuilt: (warnings: string[], layerInfo: CombineState['layerInfo']) => void;
}

const HISTORY = 60;

export const useCombine = create<CombineState>((set, get) => ({
  open: false,
  spec: emptyCombine(),
  past: [],
  future: [],
  anchorId: null,
  selected: null,
  isolate: null,
  picker: null,
  edits: null,
  warnings: [],
  layerInfo: {},

  openWith: (spec, o = {}) => set({
    open: true, spec: structuredClone(spec), past: [], future: [], anchorId: o.anchorId ?? null, isolate: null,
    picker: o.picker ?? null, selected: o.selected ?? spec.layers[spec.layers.length - 1]?.id ?? null, edits: null, warnings: [], layerInfo: {},
  }),
  close: () => set({ open: false, picker: null, isolate: null }),
  edit: fn => {
    const { spec, past } = get();
    const next = structuredClone(spec);
    fn(next);
    set({ spec: next, past: [...past, spec].slice(-HISTORY), future: [] });
  },
  replace: spec => set(s => ({ spec: structuredClone(spec), past: [...s.past, s.spec].slice(-HISTORY), future: [] })),
  undo: () => {
    const { past, spec, future } = get();
    if (!past.length) return;
    set({ spec: past[past.length - 1], past: past.slice(0, -1), future: [spec, ...future] });
  },
  redo: () => {
    const { past, spec, future } = get();
    if (!future.length) return;
    set({ spec: future[0], past: [...past, spec], future: future.slice(1) });
  },
  select: selected => set({ selected }),
  setIsolate: isolate => set({ isolate }),
  setPicker: picker => set({ picker }),
  setAnchor: anchorId => set({ anchorId }),
  setEdits: edits => set({ edits }),
  setBuilt: (warnings, layerInfo) => set({ warnings, layerInfo }),
}));
