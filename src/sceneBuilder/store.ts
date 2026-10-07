/**
 * store.ts — the Scene Builder window's own state: open or not, the spec being
 * edited (with its undo history), which build it edits, and the tab and item
 * in view. Knows nothing of the node graph (actions.ts joins the two), so the
 * graph store can open the window without an import cycle.
 */
import { create } from 'zustand';
import { starterSpec, type SceneSpec } from './spec';
import type { DescribeResult } from './recognize';

export type BuilderTab = 'shapes' | 'combine' | 'warps' | 'look' | 'camera' | 'quality' | 'output' | 'recipe' | 'templates' | 'describe';
/** Every tab, in order (the help registry has an entry for each: components/builders/helpContent.ts). */
export const BUILDER_TABS: BuilderTab[] = ['shapes', 'combine', 'warps', 'look', 'camera', 'quality', 'output', 'recipe', 'templates', 'describe'];

interface SceneBuilderState {
  open: boolean;
  spec: SceneSpec;
  past: SceneSpec[];
  future: SceneSpec[];
  /** The Scene Group of the build being edited; null builds a new scene. */
  targetSceneId: string | null;
  /** Where a new scene goes on the canvas. */
  at: { x: number; y: number } | null;
  tab: BuilderTab;
  selectedId: string | null;
  /** The modifier chip open in the inspector (one of the selected item's warps). */
  warpId: string | null;
  /** What Describe this graph found, shown on the Describe tab. */
  describe: DescribeResult | null;
  /** The spec changed since the window opened or last built. */
  dirty: boolean;

  openWith: (spec: SceneSpec, o?: { targetSceneId?: string | null; at?: { x: number; y: number } | null; tab?: BuilderTab; describe?: DescribeResult | null }) => void;
  close: () => void;
  /** Change the spec (one undo step; `coalesce` folds a run of slider moves into one). */
  edit: (fn: (draft: SceneSpec) => void, coalesce?: string) => void;
  replace: (spec: SceneSpec) => void;
  undo: () => void;
  redo: () => void;
  setTab: (tab: BuilderTab) => void;
  select: (id: string | null) => void;
  /** Select an item and open one of its modifier chips. */
  selectWarp: (itemId: string, warpId: string | null) => void;
  setTarget: (id: string | null) => void;
  markBuilt: () => void;
  setDescribe: (d: DescribeResult | null) => void;
}

let lastCoalesce: { key: string; at: number } | null = null;
const HISTORY = 100;

export const useSceneBuilder = create<SceneBuilderState>((set, get) => ({
  open: false,
  spec: starterSpec(),
  past: [],
  future: [],
  targetSceneId: null,
  at: null,
  tab: 'shapes',
  selectedId: null,
  warpId: null,
  describe: null,
  dirty: false,

  openWith: (spec, o = {}) => set({
    open: true, spec: structuredClone(spec), past: [], future: [], targetSceneId: o.targetSceneId ?? null, at: o.at ?? null,
    tab: o.tab ?? 'shapes', selectedId: spec.root.children[0]?.id ?? null, describe: o.describe ?? null, dirty: !o.targetSceneId,
  }),
  close: () => set({ open: false, describe: null }),
  edit: (fn, coalesce) => {
    const before = get().spec;
    const draft = structuredClone(before);
    fn(draft);
    const now = performance.now();
    const merge = coalesce && lastCoalesce && lastCoalesce.key === coalesce && now - lastCoalesce.at < 800;
    lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
    set(s => ({ spec: draft, past: merge ? s.past : [...s.past, before].slice(-HISTORY), future: [], dirty: true }));
  },
  replace: spec => set(s => ({ spec: structuredClone(spec), past: [...s.past, s.spec].slice(-HISTORY), future: [], dirty: true })),
  undo: () => set(s => (s.past.length ? { spec: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.spec, ...s.future], dirty: true } : s)),
  redo: () => set(s => (s.future.length ? { spec: s.future[0], future: s.future.slice(1), past: [...s.past, s.spec], dirty: true } : s)),
  setTab: tab => set({ tab }),
  select: id => set(s => (s.selectedId === id ? s : { selectedId: id, warpId: null })),
  selectWarp: (itemId, warpId) => set({ selectedId: itemId, warpId }),
  setTarget: id => set({ targetSceneId: id }),
  markBuilt: () => set({ dirty: false }),
  setDescribe: d => set({ describe: d }),
}));

/** Open the builder on a fresh scene (the node browser's "New 3D scene…"). */
export function openNewSceneBuilder(at?: { x: number; y: number }): void {
  useSceneBuilder.getState().openWith(starterSpec(), { at: at ?? null, tab: 'templates' });
}
