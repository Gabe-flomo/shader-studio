/**
 * useLiveValues — the live values of driven Play controls (mappings applied),
 * polled at ~30 fps, for the Play panel and Present.
 */
import { useEffect, useState } from 'react';
import type { PlayRecord } from '../../types/play';
import { playEngine, type ControlValue } from '../../lib/playEngine';

/** What each driven control is right now (mappings applied), by control id. */
export function useLiveValues(play: PlayRecord): Map<string, ControlValue> {
  const [values, setValues] = useState<Map<string, ControlValue>>(() => new Map());
  const anyMapped = play.mappings.some(m => m.enabled);
  useEffect(() => {
    if (!anyMapped) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      setValues(prev => {
        let changed = false;
        const next = new Map<string, ControlValue>();
        for (const c of play.controls) {
          const v = playEngine.liveValue(c.id);
          if (v === undefined) continue;
          const copy = Array.isArray(v) ? [v[0], v[1], v[2]] : v;
          next.set(c.id, copy);
          const p = prev.get(c.id);
          if (p === undefined || (Array.isArray(copy) ? !Array.isArray(p) || p.some((x, i) => x !== copy[i]) : p !== copy)) changed = true;
        }
        if (next.size !== prev.size) changed = true;
        return changed ? next : prev;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anyMapped, play.controls]);
  return anyMapped ? values : EMPTY_VALUES;
}

const EMPTY_VALUES: Map<string, ControlValue> = new Map();
