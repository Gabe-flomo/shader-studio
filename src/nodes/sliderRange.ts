import type { ParamDef } from '../types/nodeGraph';

/**
 * A float param's slider range as its card shows it. The definition gives the default; a node
 * can carry its own in UI-only params the compiler never reads:
 * - `__scMax_<key>`: a max set by typing a value past the range, or by editing the range;
 * - `__scMin_<key>`: a min set by editing the range on the slider;
 * - `__scBidir_<key>`: the range runs −max to max.
 * A custom max without a custom min starts at 0 (what typing past the range always did).
 */
export function paramSliderRange(params: Record<string, unknown>, key: string, pd: Pick<ParamDef, 'min' | 'max'>): { min: number; max: number } {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const customMax = num(params[`__scMax_${key}`]);
  const customMin = num(params[`__scMin_${key}`]);
  const bidir = params[`__scBidir_${key}`] === true;
  const max = customMax ?? pd.max ?? 1;
  let min = bidir ? -max : customMin ?? (customMax !== null ? 0 : pd.min ?? 0);
  if (!(min < max)) min = max - 1;
  return { min, max };
}

/** Whether the node has its own range for the param (so the card offers to reset it). */
export function hasCustomRange(params: Record<string, unknown>, key: string): boolean {
  return typeof params[`__scMax_${key}`] === 'number' || typeof params[`__scMin_${key}`] === 'number';
}

/**
 * The params patch for a range a typed value widened (rangeAfterTyping): both ends. Bidirectional
 * stays as it is: the widened range of a bidirectional slider is symmetric, so `__scMin_` agrees
 * with −max, and turning bidirectional off clears `__scMin_` anyway.
 */
export function extendRangePatch(key: string, min: number, max: number): Record<string, unknown> {
  return { [`__scMin_${key}`]: min, [`__scMax_${key}`]: max };
}

/** The params patch that puts the definition's range back. */
export function resetRangePatch(key: string): Record<string, unknown> {
  return { [`__scMin_${key}`]: null, [`__scMax_${key}`]: null };
}
