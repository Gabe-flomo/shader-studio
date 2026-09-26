/**
 * takePlayback.ts — reading a take back by time (see takes.ts): the values
 * and pointer between two recorded frames. Pure, no store.
 */
import type { PlayControl } from '../types/play';
import type { KitPointer } from '../play/kit/kit.js';

export interface TakeTrack {
  control: Pick<PlayControl, 'id' | 'target' | 'kind' | 'label'>;
  /** One value per sample (three for a colour). */
  values: number[];
}

export interface Take {
  id: string;
  name: string;
  /** Graph-clock time of each sample, rising. */
  times: number[];
  tracks: TakeTrack[];
  /** Pointer per sample: x, y, over, down (0/1). */
  pointer: number[];
  /** Clock time the take starts and how long it runs (s). */
  from: number;
  length: number;
}

/** Index and blend of the samples around `time` (clamped to the take). */
function at(take: Take, time: number): { i: number; f: number } {
  const ts = take.times;
  if (time <= ts[0]) return { i: 0, f: 0 };
  if (time >= ts[ts.length - 1]) return { i: ts.length - 2, f: 1 };
  let lo = 0, hi = ts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= time) lo = m; else hi = m; }
  const span = ts[hi] - ts[lo];
  return { i: lo, f: span > 0 ? (time - ts[lo]) / span : 0 };
}

/** The take's values at clock `time`: per control, a number or [r, g, b]. */
export function takeValuesAt(take: Take, time: number): Map<string, number | number[]> {
  const out = new Map<string, number | number[]>();
  if (take.times.length === 0) return out;
  const { i, f } = take.times.length === 1 ? { i: 0, f: 0 } : at(take, time);
  const j = Math.min(i + 1, take.times.length - 1);
  for (const t of take.tracks) {
    if (t.control.kind === 'color') {
      const a = i * 3, b = j * 3;
      out.set(t.control.id, [0, 1, 2].map(k => t.values[a + k] + (t.values[b + k] - t.values[a + k]) * f));
    } else {
      out.set(t.control.id, t.values[i] + (t.values[j] - t.values[i]) * f);
    }
  }
  return out;
}

/** The pointer at clock `time` (a press holds for the frames it was down). */
export function takePointerAt(take: Take, time: number): KitPointer {
  const { i, f } = take.times.length < 2 ? { i: 0, f: 0 } : at(take, time);
  const j = Math.min(i + 1, take.times.length - 1);
  const p = take.pointer, a = i * 4, b = j * 4;
  const near = f < 0.5 ? a : b;
  return { x: p[a] + (p[b] - p[a]) * f, y: p[a + 1] + (p[b + 1] - p[a + 1]) * f, over: p[near + 2] > 0, down: p[near + 3] > 0 };
}
