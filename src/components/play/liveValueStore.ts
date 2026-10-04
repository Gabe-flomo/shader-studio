/**
 * liveValueStore — the live value of each driven Play control (mappings
 * applied), polled at ~30 fps on one shared animation frame, for readouts that
 * subscribe per control. Only the rows whose own value moved render again: the
 * Play page around them does not (it used to hold every live value in state,
 * which rendered the whole page, Sound rail and all, 30 times a second while
 * anything was mapped).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { playEngine, type ControlValue } from '../../lib/playEngine';

type Read = (id: string) => ControlValue | undefined;

/** The same reading: numbers by value, colours by their three channels. */
export function sameLive(a: ControlValue | undefined, b: ControlValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  return false;
}

/** A store over `read` (playEngine.liveValue in the app; tests pass their own and drive `poll`). */
export function createLiveValueStore(read: Read, schedule = true) {
  const listeners = new Map<string, Set<() => void>>();
  const shown = new Map<string, ControlValue>();
  let raf = 0, last = 0;
  const copy = (v: ControlValue): ControlValue => (Array.isArray(v) ? [v[0], v[1], v[2]] : v);
  /** Read each watched control; tell its listeners when its value moved. */
  const poll = (): void => {
    for (const [id, set] of listeners) {
      const v = read(id);
      if (sameLive(shown.get(id), v)) continue;
      if (v === undefined) shown.delete(id); else shown.set(id, copy(v));
      for (const l of set) l();
    }
  };
  const tick = (t: number): void => {
    raf = listeners.size ? requestAnimationFrame(tick) : 0;
    if (t - last < 33) return;
    last = t;
    poll();
  };
  return {
    poll,
    subscribe(id: string, l: () => void): () => void {
      let set = listeners.get(id);
      if (!set) {
        set = new Set();
        listeners.set(id, set);
        // What it is now, so the first render after subscribing shows it.
        const v = read(id);
        if (v === undefined) shown.delete(id); else shown.set(id, copy(v));
      }
      set.add(l);
      if (schedule && !raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
      return () => {
        const s = listeners.get(id);
        if (!s) return;
        s.delete(l);
        if (!s.size) { listeners.delete(id); shown.delete(id); }
        if (!listeners.size && raf) { cancelAnimationFrame(raf); raf = 0; }
      };
    },
    get(id: string): ControlValue | undefined { return shown.get(id); },
    watching(): number { return listeners.size; },
  };
}

const store = createLiveValueStore(id => playEngine.liveValue(id));

// ── Polled readings on one shared frame ─────────────────────────────────────

const pollers = new Set<(t: number) => void>();
let pollRaf = 0;
function pollLoop(t: number): void {
  pollRaf = pollers.size ? requestAnimationFrame(pollLoop) : 0;
  for (const f of pollers) f(t);
}
/** Run `f` on the shared animation frame until the returned function is called. */
export function onPollFrame(f: (t: number) => void): () => void {
  pollers.add(f);
  if (!pollRaf) pollRaf = requestAnimationFrame(pollLoop);
  return () => { pollers.delete(f); };
}

/**
 * A number read every `ms` while `on` (a meter): the component renders again
 * only when the reading changes. `read` may be a new function each render;
 * the latest one is used. Off, it is `fallback`.
 */
export function usePolledNumber(read: () => number, on: boolean, ms: number, fallback = 0): number {
  const readRef = useRef(read);
  useEffect(() => { readRef.current = read; });
  const [v, setV] = useState(fallback);
  useEffect(() => {
    if (!on) return;
    let last = 0;
    return onPollFrame(t => {
      if (t - last < ms) return;
      last = t;
      setV(readRef.current());
    });
  }, [on, ms]);
  return on ? v : fallback;
}

/** One control's live value; undefined while `on` is false (nothing is mapped) or it isn't driven. */
export function useLiveValue(id: string | undefined, on: boolean): ControlValue | undefined {
  const sub = useCallback((l: () => void) => (on && id ? store.subscribe(id, l) : () => {}), [id, on]);
  const get = useCallback(() => (on && id ? store.get(id) : undefined), [id, on]);
  return useSyncExternalStore(sub, get);
}
