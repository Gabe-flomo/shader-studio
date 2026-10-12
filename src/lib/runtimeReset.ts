/**
 * runtimeReset.ts — the one ↺ (docs/true-reset.md): every reset button calls `resetRuntime()`, and
 * everything that keeps state from frame to frame registers how to start over with
 * `onRuntimeReset()`. A reset is a true reset: the next frame is the one a fresh open draws.
 *
 * Registered today:
 *  - the Studio preview (components/ShaderCanvas.tsx): the clock and frame count to 0, the
 *    feedback (u_prevFrame) and echo histories, every Pass's Previous (Grid Rules boards and rule
 *    memory included), the agents' walkers, trails, schedules and step snapshots, the GPU
 *    particles, the Play layers and the Play mappings' smoothing, delays and step states;
 *  - each builder's own preview canvas (components/builders/useBuilderPreview.ts): its clock and
 *    its Pass textures; the Warp Builder's clock (components/warpBuilder/WarpPreview.tsx);
 *  - the Grid Rules try board (components/gridRules/useTryRun.ts): back to step 0's board, the
 *    kept steps dropped.
 *
 * Play and pause are not touched (a paused preview draws the fresh first frame and stays paused),
 * and nothing here is an undo step: a reset changes no document state.
 *
 * Callers used to send a 'reset-time' window event; it still works (it calls resetRuntime), so a
 * page or plug-in sending it gets the same true reset.
 */

type Resetter = () => void;

const resetters = new Set<Resetter>();
let count = 0;
let resetting = false;

/** Run `fn` on every reset (in the order registered). Returns the unregister. */
export function onRuntimeReset(fn: Resetter): () => void {
  resetters.add(fn);
  return () => { resetters.delete(fn); };
}

/**
 * Start everything over: clock, frames, every persistent texture, step counters, smoothing. Each
 * part resets on its own; one that throws is reported and the rest still reset.
 */
export function resetRuntime(): void {
  // A part that sends the old event while resetting must not start a second round.
  if (resetting) return;
  resetting = true;
  count++;
  try {
    for (const fn of [...resetters]) {
      try { fn(); } catch (e) { console.error('[resetRuntime] a part did not reset:', e); }
    }
  } finally {
    resetting = false;
  }
}

/** How many resets so far (tests; a view that wants to know a reset happened since it last looked). */
export const runtimeResetCount = (): number => count;

/** The old event name: `window.dispatchEvent(new CustomEvent('reset-time'))` still resets everything. */
export const RESET_TIME_EVENT = 'reset-time';

// Once per page (a hot reload of this module doesn't add a second listener).
const LISTENING = '__playfieldResetTimeListener';
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const w = window as unknown as Record<string, (() => void) | undefined>;
  if (w[LISTENING]) window.removeEventListener(RESET_TIME_EVENT, w[LISTENING]!);
  w[LISTENING] = () => resetRuntime();
  window.addEventListener(RESET_TIME_EVENT, w[LISTENING]!);
}
