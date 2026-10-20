/**
 * passLock.ts — the pass lock (docs/pass-node-plan.md, "Grace and the lock").
 *
 * A graph may use up to HARD_MAX_PASSES (10) passes: 8 at full quality and 2 in the grace zone. The lock is one
 * guard on the graph store's writes: any write that would take the graph past 10 is refused, with a toast that
 * says why and offers Show passes (the toolbar chip's panel). One guard covers every way a pass arrives (adding,
 * pasting, duplicating, a recipe or builder, un-bypassing, a setting that opens a pass, a wire to a Value at
 * Point), whether it goes through a store action or a builder's own setState.
 *
 * Not refused: loading a graph (the write that starts a new graph, `graphEpoch`), undo and redo
 * (withPassLockOff), and any change that doesn't add passes: a graph loaded past the limit can still have
 * passes removed, and its compile names what to remove (overBudgetMessage).
 */
import { create, type StateCreator } from 'zustand';
import type { GraphNode } from '../types/nodeGraph';
import { passLockMessage, wouldExceedPasses } from '../compiler/passBudget';
import { toast, useToastStore } from '../components/ui/toastStore';

/** Open the Passes chip's panel (the toast's Show passes): the chip watches `n`. */
export const usePassPanelRequest = create<{ n: number }>(() => ({ n: 0 }));
export const requestShowPasses = (): void => usePassPanelRequest.setState(s => ({ n: s.n + 1 }));

let off = 0;
/** Run `fn` with the lock off (undo and redo put back a graph that was already there). */
export function withPassLockOff<T>(fn: () => T): T {
  off++;
  try { return fn(); } finally { off--; }
}

function refuse(used: number): void {
  const title = passLockMessage(used);
  // One toast while it shows (a drag or a slider that keeps asking).
  if (useToastStore.getState().toasts.some(t => t.title === title)) return;
  toast.warning(title, {
    message: 'Remove a pass first, or bypass a node that adds passes. Passes 9 and 10 already run at lower quality in the preview.',
    action: { label: 'Show passes', onClick: requestShowPasses },
  });
}

/**
 * Is this write refused by the lock? `prev` is the state before it, `next` the partial it writes.
 * Exported for tests; the middleware below is what the store uses.
 */
export function passLockRefuses(prev: { nodes: GraphNode[] }, next: Partial<{ nodes: GraphNode[]; graphEpoch: number }> | null | undefined): number | null {
  if (off > 0 || !next || !next.nodes || next.nodes === prev.nodes || 'graphEpoch' in next) return null;
  const over = wouldExceedPasses(next.nodes, prev.nodes);
  return over ? over.used : null;
}

/**
 * The graph store's middleware: wraps `set` (and the store's own setState, which builders call) with the lock.
 * `onRefused` runs after a refusal with the nodes kept (the store drops the undo step the action pushed).
 */
export function passLocked<T extends { nodes: GraphNode[] }>(config: StateCreator<T>, onRefused?: (kept: GraphNode[]) => void): StateCreator<T> {
  return (set, get, api) => {
    const guarded = ((partial: unknown, replace?: boolean) => {
      const prev = get();
      const next = typeof partial === 'function' ? (partial as (s: T) => Partial<T>)(prev) : partial as Partial<T>;
      const used = passLockRefuses(prev, next as Partial<{ nodes: GraphNode[]; graphEpoch: number }>);
      if (used !== null) {
        onRefused?.(prev.nodes);
        refuse(used);
        return;
      }
      (set as (p: unknown, r?: boolean) => void)(next, replace);
    }) as typeof set;
    api.setState = guarded as typeof api.setState;
    return config(guarded, get, api);
  };
}
