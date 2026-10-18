/**
 * The save nudge (SaveNudge.tsx): a new graph (never saved) that has been worked on for 15 minutes
 * without a save asks, once, to be saved. The clock starts at the first edit after it was opened
 * (an example, the starter, a file: every load bumps graphEpoch and starts over) and stops when it
 * gets saved. "Don't say I didn't warn you" stops it for that graph.
 */
import { create } from 'zustand';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

export const SAVE_NUDGE_AFTER_MS = 15 * 60 * 1000;

export const useSaveNudge = create<{ open: boolean }>(() => ({ open: false }));

/** Whether to ask now: never saved, edited since `since`, long enough, and not waved off for this graph. */
export function shouldNudge(o: { saved: boolean; scratch: boolean; since: number | null; now: number; dismissed: boolean; shown: boolean }): boolean {
  if (o.saved || o.scratch || o.dismissed || o.shown || o.since === null) return false;
  return o.now - o.since >= SAVE_NUDGE_AFTER_MS;
}

let since: number | null = null;
let epoch = -1;
let dismissedEpoch = -1;
let shownEpoch = -1;
let installed = false;

/** Start watching (once). Returns a stop function (for tests). */
export function installSaveNudge(now: () => number = Date.now): () => void {
  if (installed) return () => {};
  installed = true;
  epoch = useNodeGraphStore.getState().graphEpoch;
  const unsub = useNodeGraphStore.subscribe((s, prev) => {
    if (s.graphEpoch !== epoch) { epoch = s.graphEpoch; since = null; return; }
    if (s.currentGraph) { since = null; if (useSaveNudge.getState().open) useSaveNudge.setState({ open: false }); return; }
    const edited = s.nodes !== prev.nodes || s.looseGroups !== prev.looseGroups || s.play !== prev.play || s.datasets !== prev.datasets;
    if (edited && since === null) since = now();
  });
  const tick = () => {
    const s = useNodeGraphStore.getState();
    if (shouldNudge({ saved: !!s.currentGraph, scratch: !!s.scratch, since, now: now(), dismissed: dismissedEpoch === epoch, shown: shownEpoch === epoch })) {
      shownEpoch = epoch;
      useSaveNudge.setState({ open: true });
    }
  };
  const timer = setInterval(tick, 20_000);
  return () => { clearInterval(timer); unsub(); installed = false; since = null; };
}

/** "Don't say I didn't warn you": no more asking for this graph. */
export function dismissSaveNudge(): void {
  dismissedEpoch = epoch;
  useSaveNudge.setState({ open: false });
}

/** For tests: run the check now. */
export function checkSaveNudgeNow(now: number): void {
  const s = useNodeGraphStore.getState();
  if (shouldNudge({ saved: !!s.currentGraph, scratch: !!s.scratch, since, now, dismissed: dismissedEpoch === epoch, shown: shownEpoch === epoch })) {
    shownEpoch = epoch;
    useSaveNudge.setState({ open: true });
  }
}
