/**
 * store.ts — the 2D Scene Builder window's own state: open or not, the scene being edited (with
 * its undo history), which build it edits, and the tab and item in view. Knows nothing of the
 * node graph (actions.ts joins the two), like the 3D builder's store.
 */
import { create } from 'zustand';
import { starterScene, type Scene2D } from './spec';

export type Builder2DTab = 'space' | 'shapes' | 'grid' | 'look' | 'output' | 'recipe' | 'templates';
export const BUILDER_2D_TABS: Builder2DTab[] = ['space', 'shapes', 'grid', 'look', 'output', 'recipe', 'templates'];

interface Builder2DState {
  open: boolean;
  scene: Scene2D;
  past: Scene2D[];
  future: Scene2D[];
  /** The UV node of the build being edited; null builds a new scene. */
  targetSceneId: string | null;
  at: { x: number; y: number } | null;
  tab: Builder2DTab;
  selectedId: string | null;
  dirty: boolean;

  openWith: (scene: Scene2D, o?: { targetSceneId?: string | null; at?: { x: number; y: number } | null; tab?: Builder2DTab }) => void;
  close: () => void;
  /** Change the scene (one undo step; `coalesce` folds a run of slider moves into one). */
  edit: (fn: (draft: Scene2D) => void, coalesce?: string) => void;
  replace: (scene: Scene2D) => void;
  undo: () => void;
  redo: () => void;
  setTab: (tab: Builder2DTab) => void;
  select: (id: string | null) => void;
  setTarget: (id: string | null) => void;
  markBuilt: () => void;
}

let lastCoalesce: { key: string; at: number } | null = null;
const HISTORY = 100;

export const useSceneBuilder2D = create<Builder2DState>((set, get) => ({
  open: false,
  scene: starterScene(),
  past: [],
  future: [],
  targetSceneId: null,
  at: null,
  tab: 'shapes',
  selectedId: null,
  dirty: false,

  openWith: (scene, o = {}) => set({
    open: true, scene: structuredClone(scene), past: [], future: [], dirty: false,
    targetSceneId: o.targetSceneId ?? null, at: o.at ?? null, tab: o.tab ?? 'shapes',
    selectedId: scene.layers[0]?.id ?? null,
  }),
  close: () => set({ open: false }),
  edit: (fn, coalesce) => {
    const { scene, past } = get();
    const next = structuredClone(scene);
    fn(next);
    const now = Date.now();
    const fold = !!coalesce && lastCoalesce?.key === coalesce && now - lastCoalesce.at < 800;
    lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
    set({ scene: next, past: fold ? past : [...past, scene].slice(-HISTORY), future: [], dirty: true });
  },
  replace: scene => {
    const { scene: was, past } = get();
    lastCoalesce = null;
    set({ scene: structuredClone(scene), past: [...past, was].slice(-HISTORY), future: [], dirty: true });
  },
  undo: () => {
    const { past, scene, future } = get();
    if (!past.length) return;
    lastCoalesce = null;
    set({ scene: past[past.length - 1], past: past.slice(0, -1), future: [scene, ...future], dirty: true });
  },
  redo: () => {
    const { past, scene, future } = get();
    if (!future.length) return;
    lastCoalesce = null;
    set({ scene: future[0], past: [...past, scene], future: future.slice(1), dirty: true });
  },
  setTab: tab => set({ tab }),
  select: id => set({ selectedId: id }),
  setTarget: id => set({ targetSceneId: id }),
  markBuilt: () => set({ dirty: false }),
}));
