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
  const q0 = Math.ceil((Math.max(min, value - span) / unit) * 4 - 1e-6);
  const q1 = Math.floor((Math.min(max, value + span) / unit) * 4 + 1e-6);
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

/** Count after dragging by `dx` px — right adds items. ⇧ slows it to a third. */
export function countAfterDrag(start: number, dx: number, fine: boolean): number {
  return start + (dx / COUNT_PX_PER_STEP) * (fine ? 1 / 3 : 1);
}

export function formatValue(v: number, step: number, integer = false): string {
  if (integer || step >= 1) return String(Math.round(v));
  const decimals = Math.abs(v) >= 10 ? 2 : step >= 0.1 ? 2 : 3;
  return v.toFixed(decimals);
}
