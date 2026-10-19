/**
 * perform.ts — Perform mode's pure parts (docs/perform-mode.md): which widget each control
 * gets, how the grid lays them out, Randomize's new values, and how the Stage splits the
 * window between the controls and the picture. No store, no engine: the actions that write
 * values and stop sound are in performActions.ts.
 */
import type { PlayControl, PlayPair } from '../types/play';

export type PerformWidget = 'fader' | 'knob' | 'toggle' | 'xy' | 'swatch' | 'pad';

/**
 * The widget for one control. Numbers with a 0–1 style range (levels, mixes, amounts) are
 * faders; any other number (a signed or wider range, or whole steps) is a knob. Position pairs
 * become XY pads in `performItems`, not here.
 */
export function performWidget(c: Pick<PlayControl, 'kind' | 'min' | 'max' | 'step' | 'toggle'>): Exclude<PerformWidget, 'xy'> {
  if (c.kind === 'action') return 'pad';
  if (c.kind === 'color') return 'swatch';
  if (c.toggle) return 'toggle';
  const whole = (c.step ?? 0) >= 1;
  return c.min >= 0 && c.max <= 1 && !whole ? 'fader' : 'knob';
}

/** Grid cells each widget takes (columns × rows). */
export const WIDGET_SPAN: Record<PerformWidget, { cols: number; rows: number }> = {
  fader: { cols: 1, rows: 2 },
  knob: { cols: 1, rows: 1 },
  toggle: { cols: 1, rows: 1 },
  pad: { cols: 1, rows: 1 },
  swatch: { cols: 1, rows: 1 },
  xy: { cols: 2, rows: 2 },
};

export type PerformSize = 'S' | 'M' | 'L';
/** The grid's cell, in px, per size (every cell is a 44 px+ target). */
export const PERFORM_CELL: Record<PerformSize, number> = { S: 88, M: 112, L: 148 };
export const PERFORM_GAP: Record<PerformSize, number> = { S: 8, M: 10, L: 12 };

export type PerformItem =
  | { kind: 'heading'; key: string; label: string }
  | { kind: Exclude<PerformWidget, 'xy'>; key: string; control: PlayControl }
  | { kind: 'xy'; key: string; pair: PlayPair; a: PlayControl; b: PlayControl };

/**
 * The grid's items in the list's order: one widget per control, a position pair (both halves
 * shown) as one XY pad where its A is, and a heading where a control group starts.
 */
export function performItems(shown: readonly PlayControl[], pairs: readonly PlayPair[] = []): PerformItem[] {
  const out: PerformItem[] = [];
  const byId = new Map(shown.map(c => [c.id, c]));
  let group: string | undefined;
  for (const c of shown) {
    const pair = pairs.find(p => p.position && (p.a === c.id || p.b === c.id));
    const a = pair ? byId.get(pair.a) : undefined, b = pair ? byId.get(pair.b) : undefined;
    if (pair && a && b && c.id === pair.b) continue;  // drawn with its A
    if (c.group !== group) {
      group = c.group;
      if (group) out.push({ kind: 'heading', key: `h:${group}:${c.id}`, label: group });
    }
    if (pair && a && b) { out.push({ kind: 'xy', key: c.id, pair, a, b }); continue; }
    out.push({ kind: performWidget(c), key: c.id, control: c });
  }
  return out;
}

/** Randomize's strength: how far (a share of each range) a control may move. */
export const RANDOM_STRENGTH = { min: 0.05, max: 1, default: 0.35 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const snap = (v: number, c: Pick<PlayControl, 'min' | 'step'>) => {
  const st = c.step ?? 0;
  if (!(st > 0)) return v;
  return c.min + Math.round((v - c.min) / st) * st;
};

/**
 * New values for Randomize: every number moves by up to `strength` of its range (either way,
 * kept inside it, on its step); a switch flips with chance `strength`; a colour moves toward a
 * random colour by `strength`. Actions are left alone. Only changed values are returned.
 */
export function randomizedValues(
  controls: readonly PlayControl[],
  current: ReadonlyMap<string, number | number[]>,
  strength: number,
  rand: () => number = Math.random,
): Map<string, number | number[]> {
  const k = clamp(strength, 0, 1);
  const out = new Map<string, number | number[]>();
  for (const c of controls) {
    if (c.kind === 'action') continue;
    const v = current.get(c.id);
    if (c.kind === 'color') {
      if (!Array.isArray(v)) continue;
      const next = v.map((x, i) => (i < 3 ? clamp(x + (rand() - x) * k, 0, 1) : x));
      if (next.some((x, i) => x !== v[i])) out.set(c.id, next);
      continue;
    }
    if (typeof v !== 'number') continue;
    const lo = Math.min(c.min, c.max), hi = Math.max(c.min, c.max);
    if (c.toggle) {
      if (rand() < k) out.set(c.id, v >= (lo + hi) / 2 ? lo : hi);
      continue;
    }
    const range = hi - lo;
    if (!(range > 0)) continue;
    const next = clamp(snap(clamp(v + (rand() * 2 - 1) * k * range, lo, hi), c), lo, hi);
    if (next !== v) out.set(c.id, next);
  }
  return out;
}

/** Reset: the home values that differ from now (only controls still in the setup). */
export function resetValues(
  controls: readonly PlayControl[],
  home: ReadonlyMap<string, number | number[]>,
  current: ReadonlyMap<string, number | number[]>,
): Map<string, number | number[]> {
  const out = new Map<string, number | number[]>();
  for (const c of controls) {
    if (c.kind === 'action') continue;
    const h = home.get(c.id), v = current.get(c.id);
    if (h === undefined) continue;
    const same = Array.isArray(h) && Array.isArray(v) ? h.length === v.length && h.every((x, i) => x === v[i]) : h === v;
    if (!same) out.set(c.id, h);
  }
  return out;
}

/** A fader's or knob's value as 0–1 of its range. */
export function unitOf(v: number, c: Pick<PlayControl, 'min' | 'max'>): number {
  return c.max > c.min ? clamp((v - c.min) / (c.max - c.min), 0, 1) : 0;
}

/** The value at `u` (0–1) of a control's range, on its step. */
export function valueAt(u: number, c: Pick<PlayControl, 'min' | 'max' | 'step'>): number {
  return clamp(snap(c.min + clamp(u, 0, 1) * (c.max - c.min), c), Math.min(c.min, c.max), Math.max(c.min, c.max));
}

/** Phone-sized: the Stage stacks the picture on top of the controls. */
export const PERFORM_STACK_PX = 640;

/**
 * How the Stage shares the window: the controls on the left (about 40 %, kept between 300 and
 * 620 px), the picture on the right; at phone width they stack, picture on top.
 */
export function performSplit(width: number): { stacked: boolean; controls: number } {
  if (width <= PERFORM_STACK_PX) return { stacked: true, controls: width };
  return { stacked: false, controls: Math.round(clamp(width * 0.4, 300, 620)) };
}

/** The Perform keys (Shift + letter); null when the key isn't one. */
export function performKey(e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>): 'randomize' | 'reset' | 'panic' | null {
  if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return null;
  return e.code === 'KeyR' ? 'randomize' : e.code === 'KeyH' ? 'reset' : e.code === 'KeyP' ? 'panic' : null;
}
