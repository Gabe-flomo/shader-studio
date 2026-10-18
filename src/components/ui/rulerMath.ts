// Geometry for RulerSlider: a fixed centre needle over a ruler that scrolls under it.
// Kept free of React so the maths can be checked on its own.

/** Horizontal pixels per ruler unit. */
export const PX_PER_UNIT = 40;
/** Visible half-width of the ruler; ticks fade to nothing at this distance from the needle. */
export const HALF_WIDTH = 72;

/** One ruler unit, scaled to the param's range so there's always something to read. */
export function rulerUnit(min: number, max: number, integer = false): number {
  if (integer) return 1;
  const range = max - min;
  return range > 20 ? 10 : range > 4.5 ? 1 : 0.1;
}

/**
 * A finer ruler unit for a small range (0–0.12, say), which the default 0.1 unit squeezes into a
 * few pixels of drag: the smallest 1, 2 or 5 × 10^k whose whole range is at most 800 px of drag.
 * Undefined for ranges above 0.45 (the default unit already suits those).
 */
export function fineUnit(min: number, max: number): number | undefined {
  const range = Math.abs(max - min);
  if (!(range > 0) || range > 0.45) return undefined;
  for (const u of [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05]) if ((range / u) * PX_PER_UNIT <= 800) return u;
  return undefined;
}

export interface Tick {
  /** Offset from the needle in px (negative = left, the ≤ value side). */
  dx: number;
  /** 0 = whole unit, 1 = half, 2 = quarter. */
  tier: 0 | 1 | 2;
  opacity: number;
}

export const TICK_HEIGHT = [16, 10, 6] as const;
export const TICK_WIDTH = [2, 1.5, 1] as const;

/**
 * Ticks visible around `value`: whole / half / quarter units, one tier per position so they
 * never stack, none at or past min/max, fading quadratically towards the edges. The side left
 * of the needle (values below the current one) is drawn darker.
 */
export function rulerTicks(value: number, min: number, max: number, unit: number, integer = false): Tick[] {
  const span = (HALF_WIDTH / PX_PER_UNIT) * unit;
  // A value outside its declared range (a default set past the max, an old
  // graph with a wider range) still gets a readable ruler: the tick window
  // stretches to include the value instead of drawing nothing around the needle.
  const lo = value < min ? value - span : min;
  const hi = value > max ? value + span : max;
  const q0 = Math.ceil((Math.max(lo, value - span) / unit) * 4 - 1e-6);
  const q1 = Math.floor((Math.min(hi, value + span) / unit) * 4 + 1e-6);
  const ticks: Tick[] = [];
  for (let q = q0; q <= q1; q++) {
    const tv = (q / 4) * unit;
    const dx = ((tv - value) / unit) * PX_PER_UNIT;
    if (Math.abs(dx) < 3) continue;                                   // hidden under the needle
    if (Math.abs(tv - min) < 1e-9 || Math.abs(tv - max) < 1e-9) continue; // the range edge line marks these
    const tier: Tick['tier'] = q % 4 === 0 ? 0 : q % 2 === 0 ? 1 : 2;
    if (integer && tier > 0) continue;
    const fade = Math.max(0, 1 - (Math.abs(dx) / HALF_WIDTH) ** 2);
    const base = dx < 0 ? [1, 0.72, 0.55][tier] : [0.5, 0.36, 0.28][tier];
    ticks.push({ dx, tier, opacity: base * fade });
  }
  return ticks;
}

/** Pixel offsets of the min/max edges from the needle, or null when they're out of view. */
export function rangeEdges(value: number, min: number, max: number, unit: number): { lo: number | null; hi: number | null } {
  const lo = ((min - value) / unit) * PX_PER_UNIT;
  const hi = ((max - value) / unit) * PX_PER_UNIT;
  const reach = HALF_WIDTH + 40;
  return { lo: lo > -reach ? lo : null, hi: hi < reach ? hi : null };
}

/** Whether a range runs symmetrically both ways about zero (−N … N): such a slider is shown bipolar. */
export const isSymmetricRange = (min: number, max: number) => min < 0 && max > 0 && Math.abs(min + max) <= 1e-9 * Math.max(1, max);

/**
 * A bipolar (centred) ruler: where zero is, in px from the needle, and the band between zero and
 * the needle (left/width in px from the needle), kept within `reach` either side. Null when the
 * range isn't symmetric about zero.
 */
export function bipolarBand(value: number, min: number, max: number, unit: number, reach = 2000): { zero: number; left: number; width: number } | null {
  if (!isSymmetricRange(min, max)) return null;
  const zero = Math.max(-reach, Math.min(reach, ((0 - value) / unit) * PX_PER_UNIT));
  return { zero, left: Math.min(zero, 0), width: Math.abs(zero) };
}

export { niceCeil, rangeAfterTyping, rangeIncluding } from '../../lib/rangeMath';

export function clampToStep(n: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, n));
  const stepped = step > 0 ? Math.round(clamped / step) * step : clamped;
  // Round away float noise (0.1 + 0.2) without losing the step's precision.
  return parseFloat(Math.min(max, Math.max(min, stepped)).toFixed(6));
}

/** Value after dragging the ruler by `dx` px. Dragging left brings higher values under the needle. */
export function valueAfterDrag(start: number, dx: number, unit: number, fine: boolean): number {
  return start - (dx / PX_PER_UNIT) * unit * (fine ? 0.1 : 1);
}

/** Integer (count) params: drag distance per item, and how many marks are drawn before they merge into a band. */
export const COUNT_PX_PER_STEP = 14;
export const COUNT_MAX_MARKS = 96;

/**
 * Should a whole-number param get the count track (one mark per item)? Only a small range: a
 * step-1 param over thousands (a filter's 20–20000 Hz, an echo's 1–2000 ms) is a measure, not a
 * count, and its count track was a solid grey bar.
 */
export function isCountRange(step: number | undefined, min: number, max: number): boolean {
  return step === 1 && max - min <= COUNT_MAX_MARKS;
}

/** A frequency spanning decades (20 Hz–20 kHz) reads best on a log scale. */
export function isLogRange(min: number, max: number, unit?: string): boolean {
  return unit === 'Hz' && min > 0 && max / min >= 50;
}

/** Count after dragging by `dx` px — right adds items. ⇧ slows it to a third. */
export function countAfterDrag(start: number, dx: number, fine: boolean): number {
  return start + (dx / COUNT_PX_PER_STEP) * (fine ? 1 / 3 : 1);
}

/**
 * One pointer move of a drag, relative to where the drag has got to (`acc`, which starts at the
 * value itself): never an absolute position on the track, so the first move can't jump. Kept
 * inside `range`, the slider's range widened to hold the value (rangeIncluding).
 */
export function dragStep(acc: number, dx: number, range: { min: number; max: number }, unit: number, integer: boolean, fine: boolean): number {
  const moved = integer ? countAfterDrag(acc, dx, fine) : valueAfterDrag(acc, dx, unit, fine);
  return Math.min(range.max, Math.max(range.min, moved));
}

export function formatValue(v: number, step: number, integer = false): string {
  if (integer || step >= 1) return String(Math.round(v));
  const decimals = Math.abs(v) >= 10 ? 2 : step >= 0.1 ? 2 : 3;
  return v.toFixed(decimals);
}
