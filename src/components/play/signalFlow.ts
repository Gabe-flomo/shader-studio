/**
 * signalFlow.ts — the Signals page's view of a setup as one flow (the
 * simplification plan's Signals noun): each named signal with what sends it
 * (its When: actions whose Do is Send this signal) and what it sets off (its
 * Then: actions that fire on it), and the reactions that stand alone (a key
 * that bursts particles, with no signal between). Pure: FullPages.tsx draws it.
 * (Create signal, from a slider's +, is play/createSignal.ts.)
 */
import { SIGNAL_ACTION, SIGNAL_ANCHOR, type PlayAction, type PlayRecord, type PlaySignal, type TriggerSpec } from '../../types/play';
import { layerPositionPair, newPairMapping } from '../../play/pairs';
import { mapSourceTo, type MapTarget } from './layerOps';
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

/** Set: `target` (a control, made first if needed) takes what the signal captured, jumping (no glide) and staying. */
export function setFromSignal(p: PlayRecord, signalId: string, target: MapTarget): { play: PlayRecord; controlLabel?: string } {
  const r = mapSourceTo(p, { kind: 'captured', signal: signalId, release: 'stay' }, target, 0);
  return { play: r.play, controlLabel: r.control?.label };
}

/**
 * Move a layer to where the signal captured a position: its X and Y as a
 * position pair (made if needed), driven by the anchor `sig:<id>` with no
 * glide, so it jumps there on each capture and stays.
 */
export function moveLayerToSignal(p: PlayRecord, layerId: string, signalId: string): { play: PlayRecord; ok: boolean } {
  const { play, pairId } = layerPositionPair(p, layerId, 'x');
  const pm = pairId ? newPairMapping(play, pairId, { kind: 'position', anchor: `${SIGNAL_ANCHOR}${signalId}` }) : null;
  if (!pm) return { play: p, ok: false };
  return { play: { ...play, pairMappings: [...(play.pairMappings ?? []), { ...pm, a: { ...pm.a, smoothMs: 0 }, b: { ...pm.b, smoothMs: 0 } }] }, ok: true };
}
