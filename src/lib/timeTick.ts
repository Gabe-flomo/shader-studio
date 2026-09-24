/**
 * timeTick — the preview clock, for UI that follows it (the keyframe
 * editor's playhead). A plain listener set instead of a window CustomEvent
 * so the frame loop can skip the work entirely when nobody is listening.
 */
type Listener = (time: number) => void;
const listeners = new Set<Listener>();

export function subscribeTimeTick(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function emitTimeTick(time: number): void {
  for (const cb of listeners) cb(time);
}

export function hasTimeTickListeners(): boolean {
  return listeners.size > 0;
}
