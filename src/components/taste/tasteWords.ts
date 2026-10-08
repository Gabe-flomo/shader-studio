/**
 * tasteWords.ts — words and small actions the Taste page's components share (docs/taste.md "The Taste
 * page"): signal kinds, signed numbers, times, a log entry's ref in words, and pinning a feature.
 */
import type { SignalKind } from '../../taste/model';
import type { SignalRef } from '../../taste/log';
import type { Pin } from '../../taste/steering';
import { updateSteering } from '../../taste/store';

export const KIND_WORDS: Record<SignalKind, string> = {
  pick: 'Evolve pick', rating: 'Rating', kept: 'Kept', undone: 'Undone', favourited: 'Starred', edited: 'Edited after keeping', opened: 'Opened often',
};
export const KIND_PLURAL: Record<SignalKind, string> = {
  pick: 'Evolve picks', rating: 'ratings', kept: 'kept', undone: 'undone', favourited: 'stars', edited: 'edits', opened: 'opens',
};

export const signed = (v: number, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ago(at: number, now = Date.now()): string {
  if (!at) return 'before the log';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString();
}

/** A log entry's ref in words: the item, or the seed and pair. */
export function describeRef(ref: SignalRef | undefined): string {
  if (!ref) return '';
  const bits: string[] = [];
  if (ref.pair) bits.push(`round ${ref.pair.round}: ${ref.pair.chosenWhat ?? ref.pair.chosen} over ${ref.pair.otherWhat ?? ref.pair.other}`);
  else if (ref.label) bits.push(ref.label);
  else if (ref.item) bits.push(ref.item);
  if (ref.value != null && ref.item) bits.push(ref.value > 0 ? 'liked' : ref.value < 0 ? 'disliked' : 'cleared');
  if (ref.seed != null) bits.push(`seed ${ref.seed}`);
  if (ref.via) bits.push(ref.via);
  if (ref.foreign) bits.push('not on this install');
  return bits.join(' · ');
}

/** Pin a feature (boost / avoid / ban), or unpin it when it already has that pin. */
export function togglePin(key: string, pin: Pin): void {
  updateSteering(s => {
    const pins = { ...s.pins };
    if (pins[key] === pin) delete pins[key]; else pins[key] = pin;
    return { ...s, pins };
  });
}
