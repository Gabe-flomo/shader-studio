/**
 * sceneDraftFlag.ts — whether a Scene builder session is open (builders/sceneDraft.ts). While it is, the graph in
 * the store is the builder's draft, not the user's graph: what saves or remembers the graph (recovery, the save
 * nudge, the graph's dirty mark, the code index) waits, and the graph canvas behind the window doesn't re-render
 * (FreezeBehindBuilder). No imports, so the graph store and anything else can read it.
 */
import { useSyncExternalStore } from 'react';

let active = false;
const listeners = new Set<() => void>();

/** Whether the graph in the store is a Scene builder draft now. */
export function sceneDraftActive(): boolean { return active; }

export function setSceneDraftActive(on: boolean): void {
  if (on === active) return;
  active = on;
  for (const l of listeners) l();
}

export function onSceneDraft(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** React: whether a Scene builder draft is open. */
export function useSceneDraftActive(): boolean {
  return useSyncExternalStore(onSceneDraft, sceneDraftActive, sceneDraftActive);
}
