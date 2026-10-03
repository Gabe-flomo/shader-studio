/**
 * controlSwing.ts — the swing ring on a slider (Inputs board): the part of a
 * control's range its sources can move it across, so a driven slider shows
 * where it can go and not only where it is. Read from the record the way
 * rtFrame (kit/routes.js) plays it:
 *
 *   Replace   a route sets the control somewhere in [outMin, outMax] (either
 *             way round: an inverted range covers the same span); several
 *             Replaces cover the union of theirs (the last one wins a frame,
 *             but any of them can be the last)
 *   Add       routes sum on top of the control's last Replace (else its own
 *             slider, `base`), so the reach is from + Σ low ends .. from +
 *             Σ high ends, `from` running over the Replaces' span when there
 *             are any
 *
 * Old mappings count as Replace routes (rtSourcesOf reads them so). Off
 * sources and routes don't count. The result is kept in the control's range,
 * as the engine keeps it. Colours and buttons have no slider to shade: null,
 * as is a control nothing drives (or that isn't there). Pure.
 */
import { rtSourcesOf } from './kit/routes.js';
import type { PlayRecord } from '../types/play';

export interface Swing { lo: number; hi: number }

export function controlSwing(play: Pick<PlayRecord, 'controls' | 'mappings' | 'sources'>, controlId: string, base: number): Swing | null {
  const c = play.controls.find(x => x.id === controlId);
  if (!c || c.kind !== 'float') return null;
  let rLo = Infinity, rHi = -Infinity, aLo = 0, aHi = 0, adds = false;
  for (const s of rtSourcesOf(play)) {
    if (!s.enabled) continue;
    for (const o of s.outputs) for (const r of o.routes) {
      if (r.enabled === false || r.to !== controlId) continue;
      const lo = Math.min(r.outMin, r.outMax), hi = Math.max(r.outMin, r.outMax);
      if (r.mode === 'add') { adds = true; aLo += lo; aHi += hi; continue; }
      rLo = Math.min(rLo, lo); rHi = Math.max(rHi, hi);
    }
  }
  const replaced = rLo <= rHi;
  if (!replaced && !adds) return null;
  let lo = replaced ? rLo : base, hi = replaced ? rHi : base;
  if (adds) { lo += aLo; hi += aHi; }
  const min = Math.min(c.min, c.max), max = Math.max(c.min, c.max);
  lo = Math.max(min, Math.min(max, lo));
  hi = Math.max(min, Math.min(max, hi));
  return { lo, hi };
}

/** Where a value sits along a control's range, 0..1 (for drawing), clamped. */
export function swingFraction(v: number, min: number, max: number): number {
  const span = max - min;
  if (!span || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, (v - min) / span));
}
