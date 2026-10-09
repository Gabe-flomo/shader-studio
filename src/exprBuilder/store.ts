/**
 * store.ts — the Expression Builder window's own state: open or not, the chain (seed and steps),
 * where in the chain you are, and the tiles' tuned holes. Knows nothing of the node graph
 * (actions.ts joins the two), like the Scene Builders' stores.
 *
 * The chain is a line with a cursor: `at` steps are the expression so far. Clicking an earlier
 * step moves the cursor back and keeps the steps after it (shown dimmed); picking the same move
 * as the next kept step walks forward onto it, picking anything else replaces the rest.
 */
import { create } from 'zustand';
import { UV_SEED, type ExprSeed } from './seeds';
import type { Chain, ChainStep } from './chain';

export type ExprTab = 'moves' | 'seed' | 'code';

interface ExprBuilderState {
  open: boolean;
  chain: Chain;
  /** How many steps are the expression so far (the rest are kept until something else is picked). */
  at: number;
  /** Where "Add to graph" puts the nodes (the canvas point the menu was opened at), when known. */
  place: { x: number; y: number } | null;
  tab: ExprTab;
  /** Hole values tuned on tiles before picking: tile key → `"<step>:<hole>"` → value. */
  drafts: Record<string, Record<string, number>>;
  /** The tile whose sliders are showing. */
  expanded: string | null;
  /** The tile under the pointer (the big preview shows it). */
  hover: string | null;
  /** The step whose sliders are showing in the chain. */
  openStep: number | null;
  /** Earlier chains, for Undo (picks, Surprise me, a new seed, a loaded example), newest last. */
  undoStack: Array<{ chain: Chain; at: number }>;
  /** Sections showing their hidden (dull) moves. */
  showHidden: Record<string, boolean>;
  /** Surprise me's next seed (bumped per press; the same seed gives the same chain). */
  surpriseSeed: number;

  openWith: (o?: { seed?: ExprSeed; steps?: ChainStep[]; place?: { x: number; y: number } | null; tab?: ExprTab }) => void;
  close: () => void;
  setSeed: (seed: ExprSeed) => void;
  /** Pick a tile's steps as the next ones. */
  pick: (steps: ChainStep[]) => void;
  /** Move the cursor to after step `n` (0: the seed). */
  goTo: (n: number) => void;
  /** Replace the whole chain (a worked example). */
  load: (chain: Chain) => void;
  setHole: (step: number, hole: string, value: number) => void;
  setDraft: (tile: string, key: string, value: number) => void;
  setExpanded: (tile: string | null) => void;
  setHover: (tile: string | null) => void;
  setOpenStep: (step: number | null) => void;
  setTab: (tab: ExprTab) => void;
  /** Replace the steps after the cursor with these (Surprise me), undoably. */
  surprise: (steps: ChainStep[]) => void;
  /** Put the chain back as it was before the last pick, Surprise me, seed or example. */
  undo: () => void;
  setShowHidden: (section: string, on: boolean) => void;
}

const sameMoves = (a: readonly ChainStep[], b: readonly ChainStep[]) => a.length === b.length && a.every((s, i) => s.moveId === b[i].moveId);

/** Undo keeps this many chains. */
const UNDO_CAP = 30;
const pushUndo = (s: { chain: Chain; at: number; undoStack: Array<{ chain: Chain; at: number }> }) => [...s.undoStack, { chain: s.chain, at: s.at }].slice(-UNDO_CAP);

export const useExprBuilder = create<ExprBuilderState>((set, get) => ({
  open: false,
  chain: { seed: UV_SEED, steps: [] },
  at: 0,
  place: null,
  tab: 'moves',
  drafts: {},
  expanded: null,
  hover: null,
  openStep: null,
  undoStack: [],
  showHidden: {},
  surpriseSeed: 1,

  openWith: (o = {}) => {
    const steps = o.steps ?? [];
    set({
      open: true, chain: { seed: o.seed ?? get().chain.seed ?? UV_SEED, steps: structuredClone(steps) }, at: steps.length,
      place: o.place ?? null, tab: o.tab ?? 'moves', drafts: {}, expanded: null, hover: null, openStep: null, undoStack: [],
      // A new run of surprises each time the window opens (each press then steps the seed on).
      surpriseSeed: 1 + (Date.now() % 1_000_003),
    });
  },
  close: () => set({ open: false, hover: null, expanded: null }),
  setSeed: seed => set(s => ({ chain: { seed, steps: [] }, at: 0, drafts: {}, expanded: null, hover: null, openStep: null, undoStack: pushUndo(s) })),
  pick: steps => {
    const { chain, at } = get();
    const ahead = chain.steps.slice(at, at + steps.length);
    if (sameMoves(ahead, steps)) { set(s => ({ at: at + steps.length, expanded: null, hover: null, undoStack: pushUndo(s) })); return; }
    set(s => ({ chain: { ...chain, steps: [...chain.steps.slice(0, at), ...structuredClone(steps)] }, at: at + steps.length, expanded: null, hover: null, openStep: null, undoStack: pushUndo(s) }));
  },
  surprise: steps => set(s => ({
    chain: { ...s.chain, steps: [...s.chain.steps.slice(0, s.at), ...structuredClone(steps)] }, at: s.at + steps.length,
    expanded: null, hover: null, openStep: null, undoStack: pushUndo(s), surpriseSeed: s.surpriseSeed + 1,
  })),
  undo: () => set(s => {
    const last = s.undoStack[s.undoStack.length - 1];
    if (!last) return {};
    return { chain: last.chain, at: last.at, undoStack: s.undoStack.slice(0, -1), expanded: null, hover: null, openStep: null };
  }),
  setShowHidden: (section, on) => set(s => ({ showHidden: { ...s.showHidden, [section]: on } })),
  goTo: n => set(s => ({ at: Math.max(0, Math.min(s.chain.steps.length, n)), expanded: null, hover: null })),
  load: chain => set(s => ({ chain: structuredClone(chain), at: chain.steps.length, drafts: {}, expanded: null, hover: null, openStep: null, undoStack: pushUndo(s) })),
  setHole: (step, hole, value) => set(s => ({
    chain: {
      ...s.chain,
      steps: s.chain.steps.map((st, i) => (i !== step ? st : {
        ...st,
        // A value past the slider's range widens it (the slider conventions: never clamped).
        holes: st.holes.map(h => (h.kind === 'number' && h.name === hole ? { ...h, value, min: Math.min(h.min, value), max: Math.max(h.max, value) } : h)),
      })),
    },
  })),
  setDraft: (tile, key, value) => set(s => ({ drafts: { ...s.drafts, [tile]: { ...s.drafts[tile], [key]: value } } })),
  setExpanded: tile => set({ expanded: tile }),
  setHover: tile => set({ hover: tile }),
  setOpenStep: step => set({ openStep: step }),
  setTab: tab => set({ tab }),
}));

/** Open the builder on a new chain (from UV unless a seed is given). Light: the window and the catalogue load when it shows. */
export function openExpressionBuilder(o: { seed?: ExprSeed; place?: { x: number; y: number } | null } = {}): void {
  useExprBuilder.getState().openWith({ seed: o.seed, place: o.place ?? null });
}
