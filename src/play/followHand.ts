/**
 * followHand.ts — "Follow a hand" (docs/agents-group.md, Agents P4): one step
 * from a graph slider with an X/Y partner (Hand X / Hand Y on Attract / Repel,
 * Vortex or Emit; any `…X` / `…Y` pair) to a hand moving it in Play.
 *
 * It is the Particles node's "Add as position with Y" flow, finished: both
 * sliders become Play controls, paired as a position, and the pair gets two
 * position mappings: the pointer over the picture first, then a tracked hand's
 * index fingertip. A mapping writes its last value while its anchor has none,
 * so the pointer moves the place until a hand is first seen, and from then on
 * the hand does (where it was last seen while it is out of view). Both axes
 * map 0..1 onto the controls' ranges, so Hand X / Y (0–1) follow the hand
 * exactly at any picture shape.
 */
import type { PlayRecord } from '../types/play';
import { handAnchor } from '../types/play';
import { addCandidateControl } from '../components/play/layerOps';
import { axisFor, partnerTarget, positionPair } from './pairs';
import { candidateLabel, playId, type PlayCandidate } from './playControls';

/** The index fingertip (landmark 8) of either hand. */
export const FOLLOW_HAND_ANCHOR = handAnchor('any', 8);

/** Can `c` follow a hand: a float with an X/Y partner among the candidates? */
export function canFollowHand(candidates: readonly PlayCandidate[], c: PlayCandidate): boolean {
  if (c.kind !== 'float') return false;
  const partner = partnerTarget(c.target);
  return !!partner && candidates.some(x => x.target === partner.target && x.kind === 'float');
}

/**
 * Make `c` and its X/Y partner Play controls, pair them as a position, and map the pair to the
 * pointer and then a hand. Returns the record unchanged (and pairId '') when there is no partner.
 */
export function followHand(play: PlayRecord, candidates: readonly PlayCandidate[], c: PlayCandidate): { play: PlayRecord; pairId: string } {
  const partner = partnerTarget(c.target);
  const other = partner && candidates.find(x => x.target === partner.target && x.kind === 'float');
  if (!partner || !other || c.kind !== 'float') return { play, pairId: '' };
  let next = addCandidateControl(addCandidateControl(play, c), other);
  const id = next.controls.find(x => x.target === c.target)!.id;
  const made = positionPair(next, id, t => (t === other.target ? { label: candidateLabel(other), min: other.min, max: other.max, ...(other.step ? { step: other.step } : {}) } : null));
  if (!made.pairId) return { play, pairId: '' };
  next = made.play;
  const pair = next.pairs!.find(x => x.id === made.pairId)!;
  const ca = next.controls.find(x => x.id === pair.a), cb = next.controls.find(x => x.id === pair.b);
  const mapping = (anchor: string) => ({ id: playId('pmap'), pairId: pair.id, source: { kind: 'position' as const, anchor }, affect: 'both' as const, a: { ...axisFor(ca), smoothMs: 60 }, b: { ...axisFor(cb), smoothMs: 60 }, enabled: true });
  // Pointer first, the hand second: the later mapping wins once it has a value.
  next = { ...next, pairMappings: [...(next.pairMappings ?? []), mapping('pointer'), mapping(FOLLOW_HAND_ANCHOR)] };
  return { play: next, pairId: pair.id };
}
