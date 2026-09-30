/**
 * conditionModel.ts — the condition editor's arithmetic (ConditionFields.tsx):
 * switching a condition between raw units and a share of its range, and where
 * on its ruler it is met. Pure.
 */
import type { ValueCondition } from '../../types/play';

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A condition switched between raw units and a share of its range: its
 * thresholds (and the band's other edge) move to the same place, the
 * hysteresis and tolerance keep the same size.
 */
export function withUnit(c: ValueCondition, unit: 'raw' | 'pct', range: { min: number; max: number }): ValueCondition {
  if ((c.unit === 'pct') === (unit === 'pct')) return c;
  const span = range.max - range.min || 1;
  const to = unit === 'pct' ? (x: number) => round((x - range.min) / span) : (x: number) => round(range.min + x * span);
  const size = unit === 'pct' ? (x: number) => round(x / span) : (x: number) => round(x * span);
  const out: ValueCondition = { ...c, threshold: to(c.threshold), hysteresis: size(c.hysteresis), tolerance: size(c.tolerance) };
  if (typeof c.hi === 'number') out.hi = to(c.hi);
  if (unit === 'pct') out.unit = 'pct'; else delete out.unit;
  return out;
}

/** Where a condition is met on its ruler (one or two stretches), and the lighter stretches it holds through. */
export function conditionBands(c: ValueCondition, min: number, max: number): { met: Array<[number, number]>; hold: Array<[number, number]> } {
  const th = c.threshold, h = c.hysteresis, tol = c.tolerance;
  const lo = Math.min(th, c.hi ?? th), hi = Math.max(th, c.hi ?? th);
  switch (c.cmp) {
    case 'below': case 'crossDown': return { met: [[min, th]], hold: [[th, th + h]] };
    case 'equals': return { met: [[th - tol, th + tol]], hold: [[th - tol - h, th - tol], [th + tol, th + tol + h]] };
    case 'not': return { met: [[min, th - tol], [th + tol, max]], hold: [[th - tol, th - tol + h], [th + tol - h, th + tol]] };
    case 'between': return { met: [[lo, hi]], hold: [[lo - h, lo], [hi, hi + h]] };
    case 'outside': return { met: [[min, lo], [hi, max]], hold: [[lo, lo + h], [hi - h, hi]] };
    case 'neverAbove': return { met: [[min, th]], hold: [] };
    case 'neverBelow': return { met: [[th, max]], hold: [] };
    default: return { met: [[th, max]], hold: [[th - h, th]] };
  }
}
