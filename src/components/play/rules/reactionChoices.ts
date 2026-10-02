/**
 * What a rule can do, as one list: each layer's actions ("Burst · Sparks"),
 * then Send a signal. Quick rule offers them as chips, the reaction editor as
 * one picker. Pure.
 */
import { actionsForLayer, SIGNAL_ACTION, type ActionKind, type PlayLayer, type PlayReaction, type PlayRecord } from '../../../types/play';
import { actionLabel } from '../layers/help';

export interface DoChoice { value: string; label: string; layerId: string; do: ActionKind | typeof SIGNAL_ACTION }

export const doValue = (r: Pick<PlayReaction, 'do' | 'layerId'>) => (r.do === SIGNAL_ACTION ? SIGNAL_ACTION : `${r.layerId}|${r.do}`);

/** Every layer's actions, the preferred layer first, then Send a signal. */
export function doChoices(play: PlayRecord, preferLayer?: string): DoChoice[] {
  const layers = [...play.layers].reverse();
  const first = layers.findIndex(l => l.id === preferLayer);
  if (first > 0) layers.unshift(...layers.splice(first, 1));
  const out: DoChoice[] = [];
  for (const l of layers) for (const k of actionsForLayer(l)) out.push({ value: `${l.id}|${k}`, label: `${actionLabel(k, l)} · ${l.label}`, layerId: l.id, do: k });
  out.push({ value: SIGNAL_ACTION, label: 'Send a signal', layerId: '', do: SIGNAL_ACTION });
  return out;
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
  const l = play.layers.find(x => x.id === r.layerId);
  const amount = r.do === 'burst' || r.do === 'multiply' || r.do === 'cull' ? ` ${r.amount}` : '';
  return `${actionLabel(r.do, l)}${amount} · ${l?.label ?? 'a deleted layer'}`;
}
