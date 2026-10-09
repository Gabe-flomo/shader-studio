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
}

const sameMoves = (a: readonly ChainStep[], b: readonly ChainStep[]) => a.length === b.length && a.every((s, i) => s.moveId === b[i].moveId);

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

  openWith: (o = {}) => {
    const steps = o.steps ?? [];
    set({
      open: true, chain: { seed: o.seed ?? get().chain.seed ?? UV_SEED, steps: structuredClone(steps) }, at: steps.length,
      place: o.place ?? null, tab: o.tab ?? 'moves', drafts: {}, expanded: null, hover: null, openStep: null,
    });
  },
  close: () => set({ open: false, hover: null, expanded: null }),
  setSeed: seed => set({ chain: { seed, steps: [] }, at: 0, drafts: {}, expanded: null, hover: null, openStep: null }),
  pick: steps => {
    const { chain, at } = get();
    const ahead = chain.steps.slice(at, at + steps.length);
    if (sameMoves(ahead, steps)) { set({ at: at + steps.length, expanded: null, hover: null }); return; }
    set({ chain: { ...chain, steps: [...chain.steps.slice(0, at), ...structuredClone(steps)] }, at: at + steps.length, expanded: null, hover: null, openStep: null });
  },
  goTo: n => set(s => ({ at: Math.max(0, Math.min(s.chain.steps.length, n)), expanded: null, hover: null })),
  load: chain => set({ chain: structuredClone(chain), at: chain.steps.length, drafts: {}, expanded: null, hover: null, openStep: null }),
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
