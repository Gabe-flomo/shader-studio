/**
 * timeTick — the preview clock, for UI that follows it (the keyframe
 * editor's playhead). A plain listener set instead of a window CustomEvent
 * so the frame loop can skip the work entirely when nobody is listening.
 */
type Listener = (time: number) => void;
const listeners = new Set<Listener>();
let lastTime: number | null = null;

export function subscribeTimeTick(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Record the clock (every frame) and tell whoever follows it. */
export function emitTimeTick(time: number): void {
  lastTime = time;
  for (const cb of listeners) cb(time);
}

/** The preview clock as of the last frame, or null before the first one. */
export function clockNow(): number | null {
  return lastTime;
}

export function hasTimeTickListeners(): boolean {
  return listeners.size > 0;
}

/**
 * Ref callback for a text node that shows the clock ("12.34s"). Writes the text directly on each
 * tick, so a readout following every frame doesn't re-render React.
 */
export function timeReadoutRef(el: HTMLElement | null): (() => void) | void {
  if (!el) return;
  let last = '';
  return subscribeTimeTick(t => {
    const text = `${t.toFixed(2)}s`;
    if (text !== last) { el.textContent = text; last = text; }
  });
}
