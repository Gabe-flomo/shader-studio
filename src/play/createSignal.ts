/**
 * createSignal.ts — "Create signal" from a control or a layer property's +
 * (the simplification plan's front door): a signal named for what it
 * watches, and an action that sends it when the value crosses the middle of
 * its range. Tuned on the Signals page afterwards. Pure.
 */
import { SIGNAL_ACTION, type PlayAction, type PlayRecord } from '../types/play';
import { addSignal } from './pairs';
import { playId } from './playControls';

/** What a new signal watches: a condition value path (play/kit/signals.js sgParseValueRef), its name and its range. */
export interface SignalSource { value: string; label: string; min: number; max: number }

/**
 * A signal named for what it watches, and an action that sends it each time
 * the value crosses up through the middle of its range (a small hysteresis,
 * so a value resting there doesn't chatter). Empty ids when the setup is
 * full of signals already.
 */
export function createSignalFrom(p: PlayRecord, src: SignalSource): { play: PlayRecord; signalId: string; actionId: string } {
  const { play: withSig, id: signalId } = addSignal(p, `${src.label} rises`);
  if (!signalId) return { play: p, signalId: '', actionId: '' };
  const lo = Math.min(src.min, src.max), hi = Math.max(src.min, src.max);
  const span = hi - lo || 1;
  const actionId = playId('act');
  const action: PlayAction = {
    id: actionId,
    trigger: { on: 'value', value: src.value, cmp: 'crossUp', threshold: lo + span / 2, hysteresis: span * 0.05, tolerance: span * 0.01 },
    do: SIGNAL_ACTION, layerId: '', amount: 1, enabled: true, signal: signalId,
  };
  return { play: { ...withSig, actions: [...(withSig.actions ?? []), action] }, signalId, actionId };
}
