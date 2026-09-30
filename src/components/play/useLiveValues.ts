/**
 * useLiveValues — the live values of driven Play controls (mappings applied),
 * polled at ~30 fps, for the Play panel and the Stage. A poll that finds
 * nothing changed allocates nothing.
 */
import { useEffect, useRef, useState } from 'react';
import type { PlayRecord } from '../../types/play';
import { playEngine, type ControlValue } from '../../lib/playEngine';

/** What each driven control is right now (mappings applied), by control id. */
export function useLiveValues(play: PlayRecord): Map<string, ControlValue> {
  const [values, setValues] = useState<Map<string, ControlValue>>(() => new Map());
  const shownRef = useRef(values);
  const anyMapped = play.mappings.some(m => m.enabled) || !!play.pairMappings?.some(m => m.enabled);
  useEffect(() => {
    if (!anyMapped) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      // Compare against what is shown first; a new Map is made only when something moved.
      const prev = shownRef.current;
      let changed = false, n = 0;
      for (const c of play.controls) {
        const v = playEngine.liveValue(c.id);
        if (v === undefined) continue;
        n++;
        const p = prev.get(c.id);
        if (p === undefined || (Array.isArray(v) ? !Array.isArray(p) || p[0] !== v[0] || p[1] !== v[1] || p[2] !== v[2] : p !== v)) { changed = true; break; }
      }
      if (!changed && n === prev.size) return;
      const next = new Map<string, ControlValue>();
      for (const c of play.controls) {
        const v = playEngine.liveValue(c.id);
        if (v !== undefined) next.set(c.id, Array.isArray(v) ? [v[0], v[1], v[2]] : v);
      }
      shownRef.current = next;
      setValues(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anyMapped, play.controls]);
  return anyMapped ? values : EMPTY_VALUES;
}

const EMPTY_VALUES: Map<string, ControlValue> = new Map();
