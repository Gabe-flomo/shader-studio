/**
 * createSignal.ts — "Rule from this" on a control or a layer property's +
 * (the simplification plan's front door, as a rule since the implementation
 * guide's phase 3): the When of a new rule, the value going above the middle
 * of its range (a small hysteresis, so a value resting there doesn't
 * chatter). Quick rule then asks what happens. Pure.
 */
import type { TriggerSpec } from '../types/play';

/** What a new rule watches: a condition value path (play/kit/signals.js sgParseValueRef), its name and its range. */
export interface SignalSource { value: string; label: string; min: number; max: number }

/** The value above the middle of its range: a rule's When. */
export function ruleWhenFrom(src: SignalSource): TriggerSpec {
  const lo = Math.min(src.min, src.max), hi = Math.max(src.min, src.max);
  const span = hi - lo || 1;
  return { on: 'value', value: src.value, cmp: 'above', threshold: lo + span / 2, hysteresis: span * 0.05, tolerance: span * 0.01 };
}
