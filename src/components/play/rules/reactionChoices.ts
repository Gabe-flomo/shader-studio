/**
 * What a rule can do, as one list: each layer's actions ("Burst · Sparks"),
 * then Send a signal. Quick rule offers them as chips, the reaction editor as
 * one picker. Pure.
 */
import { actionsForLayer, isLookAction, NOTES_ACTION, SIGNAL_ACTION, type ActionKind, type LookActionKind, type PlayLayer, type PlayReaction, type PlayRecord } from '../../../types/play';
import { FINISH_TARGET_PREFIX, finishHostLabel, finishParamOf, finishParamsOf, finishPropId, type FinishEffect } from '../../../types/playFinish';
import { notesSummary } from '../../../play/notes';
import { actionLabel, LOOK_ACTION_LABELS } from '../layers/help';

export interface DoChoice { value: string; label: string; layerId: string; do: ActionKind | typeof SIGNAL_ACTION; rackId?: string }

export const doValue = (r: Pick<PlayReaction, 'do' | 'layerId' | 'notes'>) => (r.do === SIGNAL_ACTION ? SIGNAL_ACTION : r.do === NOTES_ACTION ? `notes|${r.notes?.rackId ?? ''}` : `${r.layerId}|${r.do}`);

/** Every layer's actions, the preferred layer first, then Send a signal. */
export function doChoices(play: PlayRecord, preferLayer?: string): DoChoice[] {
  const layers = [...play.layers].reverse();
  const first = layers.findIndex(l => l.id === preferLayer);
  if (first > 0) layers.unshift(...layers.splice(first, 1));
  const out: DoChoice[] = [];
  for (const l of layers) for (const k of actionsForLayer(l)) out.push({ value: `${l.id}|${k}`, label: `${actionLabel(k, l)} · ${l.label}`, layerId: l.id, do: k });
  // Look (Finish) effects: Datamosh's Mosh and Reset mosh, and pulsing or setting any effect's setting.
  for (const e of play.finish?.effects ?? []) {
    const id = finishPropId(e.id), name = finishHostLabel(e);
    const look = (k: LookActionKind) => out.push({ value: `${id}|${k}`, label: `${LOOK_ACTION_LABELS[k]} · ${name}`, layerId: id, do: k });
    if (e.kind === 'datamosh') { look('mosh'); look('moshreset'); }
    if (finishParamsOf(e).length) { look('fxpulse'); look('fxset'); }
  }
  // Play notes on each rack of the Audio engine.
  for (const r of play.audioEngine?.racks ?? []) out.push({ value: `notes|${r.id}`, label: `Play notes · ${r.name}`, layerId: '', do: NOTES_ACTION, rackId: r.id });
  out.push({ value: SIGNAL_ACTION, label: 'Send a signal', layerId: '', do: SIGNAL_ACTION });
  return out;
}

/** The Look effect a reaction acts on ('finish:<effectId>'), or undefined. */
export function lookEffectOf(play: PlayRecord, layerId: string): FinishEffect | undefined {
  if (!layerId.startsWith(FINISH_TARGET_PREFIX)) return undefined;
  const id = layerId.slice(FINISH_TARGET_PREFIX.length);
  return play.finish?.effects.find(e => e.id === id);
}

/**
 * A new Look reaction's own fields: Mosh for 2 seconds; a pulse to its setting's top for 1 second,
 * a set to its top (Amount when the effect has one, else its first setting). Nothing for others.
 */
export function lookDefaults(kind: string, layerId: string, play: PlayRecord): Partial<PlayReaction> {
  if (kind === 'mosh') return { seconds: 2 };
  if (kind !== 'fxpulse' && kind !== 'fxset') return {};
  const e = lookEffectOf(play, layerId);
  const ps = e ? finishParamsOf(e).filter(p => !p.hidden) : [];
  const p = ps.find(x => x.key === 'amount') ?? ps[0];
  if (!p) return {};
  return { key: p.key, value: p.max, ...(kind === 'fxpulse' ? { seconds: 1 } : {}) };
}

/** How much a new reaction of this kind does by default. */
export function defaultAmount(kind: string, l: PlayLayer | undefined): number {
  if (kind === SIGNAL_ACTION || kind === 'goto' || kind === 'pad' || l?.kind === 'drumpad') return 1;
  if (kind === 'scatter') return 2;
  return 60;
}

/** "Burst 60 · Sparks", "Send Hit": a reaction in words. */
export function reactionText(r: PlayReaction, play: PlayRecord): string {
  if (r.do === SIGNAL_ACTION) return `Send ${play.signals?.find(s => s.id === r.signal)?.name ?? 'a signal'}`;
  if (r.do === NOTES_ACTION && r.notes) return `Play ${notesSummary(r.notes)} · ${play.audioEngine?.racks.find(x => x.id === r.notes!.rackId)?.name ?? 'a missing rack'}`;
  if (isLookAction(r.do)) {
    const e = lookEffectOf(play, r.layerId);
    const name = e ? finishHostLabel(e) : 'a removed Look effect';
    const p = e && r.key ? finishParamOf(e, r.key) : undefined;
    const v = typeof r.value === 'number' ? +r.value.toFixed(3) : 0, sec = typeof r.seconds === 'number' ? +r.seconds.toFixed(2) : 1;
    if (r.do === 'mosh') return `Mosh ${sec} s · ${name}`;
    if (r.do === 'moshreset') return `Reset mosh · ${name}`;
    return `${r.do === 'fxpulse' ? 'Pulse' : 'Set'} ${p?.label ?? r.key ?? 'a setting'} to ${v}${r.do === 'fxpulse' ? ` for ${sec} s` : ''} · ${name}`;
  }
  const l = play.layers.find(x => x.id === r.layerId);
  const amount = r.do === 'burst' || r.do === 'multiply' || r.do === 'cull' ? ` ${r.amount}` : '';
  return `${actionLabel(r.do, l)}${amount} · ${l?.label ?? 'a deleted layer'}`;
}
