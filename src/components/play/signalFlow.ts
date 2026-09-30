/**
 * signalFlow.ts — the Signals page's view of a setup as one flow (the
 * simplification plan's Signals noun): each named signal with what sends it
 * (its When: actions whose Do is Send this signal) and what it sets off (its
 * Then: actions that fire on it), and the reactions that stand alone (a key
 * that bursts particles, with no signal between). Pure: FullPages.tsx draws it.
 * (Create signal, from a slider's +, is play/createSignal.ts.)
 */
import { SIGNAL_ACTION, type PlayAction, type PlayRecord, type PlaySignal, type TriggerSpec } from '../../types/play';
import { addAction } from './layers/ActionsSection';

export interface SignalGroup {
  signal: PlaySignal;
  /** Actions that send it. */
  when: PlayAction[];
  /** Actions that fire on it. */
  then: PlayAction[];
}

export interface SignalFlow { groups: SignalGroup[]; others: PlayAction[] }

export const sendsSignal = (a: PlayAction, id: string) => a.do === SIGNAL_ACTION && a.signal === id;
export const firesOnSignal = (a: PlayAction, id: string) => a.trigger.on === 'signal' && a.trigger.signal === id;

/** Every signal with its When and Then; an action linking two signals shows under both. */
export function signalFlow(play: PlayRecord): SignalFlow {
  const actions = play.actions ?? [];
  const linked = new Set<string>();
  const groups = (play.signals ?? []).map(signal => {
    const when = actions.filter(a => sendsSignal(a, signal.id));
    const then = actions.filter(a => firesOnSignal(a, signal.id));
    for (const a of [...when, ...then]) linked.add(a.id);
    return { signal, when, then };
  });
  return { groups, others: actions.filter(a => !linked.has(a.id)) };
}

/** A new action that sends `signalId` (fired by Space until it is changed). */
export function addWhen(p: PlayRecord, signalId: string): { play: PlayRecord; id: string } {
  const r = addAction(p);
  const play = { ...r.play, actions: (r.play.actions ?? []).map(a => (a.id === r.id ? { ...a, do: SIGNAL_ACTION, layerId: '', amount: 1, signal: signalId } : a)) };
  return { play, id: r.id };
}

/** A new action that fires on `signalId` (it does the last layer's first button until it is changed). */
export function addThen(p: PlayRecord, signalId: string): { play: PlayRecord; id: string } {
  const r = addAction(p);
  const play = { ...r.play, actions: (r.play.actions ?? []).map(a => (a.id === r.id ? { ...a, trigger: { on: 'signal', signal: signalId } as TriggerSpec } : a)) };
  return { play, id: r.id };
}
