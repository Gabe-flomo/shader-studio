/**
 * cards.ts — Trail followers' behaviour cards (docs/agent-builder.md), read from and written to an
 * Agents group's rule set (agentRules/spec.ts) through the cards of every kind (behaviours.ts). Pure.
 *
 *  - Senses: a Turn toward a trail (its channel is the Smells chip; Avoid is Turn away). The
 *    sensors (how far ahead, how wide) are the rule set's.
 *  - Turning: How sharply is that Turn's degrees; Wobble is a Wander.
 *  - Moving: Speed is the species' speed; At the edges is the rule set's edges.
 *  - Trail: a Leave trail (without a Memory fade).
 *
 * The first matching action in a rule the cards can read is the card's: an always rule, or one
 * with an "only when" (behaviours.ts). Anything else is an Advanced rule, edited in the rules editor.
 */
import type { AgentRuleSet, ChannelRef, RuleAction, RuleCondition } from '../agentRules/spec';
import { addCard, cardRule, locate, patchAt, readBehaviours, setOnAt, type Loc } from './behaviours';

export type { Loc } from './behaviours';

/** The behaviours a card holds (Moving and Born aren't rules). */
export type RuleCard = 'senses' | 'wobble' | 'trail';
export const RULE_CARDS: readonly RuleCard[] = ['senses', 'wobble', 'trail'];

/** A rule the cards can read (always, or one "only when"; no Stop). */
export const plainRule = cardRule;

/** Each card's action, the first matching one in reading order (null: not there). */
export function locateCards(set: AgentRuleSet, sp: number): Record<RuleCard, Loc | null> {
  const out: Record<RuleCard, Loc | null> = { senses: null, wobble: null, trail: null };
  for (const l of locate(set, sp, RULE_CARDS)) out[l.card as RuleCard] = { rule: l.rule, action: l.action };
  return out;
}

/** The defaults a card's action starts with when switched on for the first time. */
export const CARD_DEFAULTS = { turn: 45, wobble: 7, amount: 1 } as const;

export interface TrailCards {
  senses: { on: boolean; there: boolean; channel: ChannelRef; away: boolean; distance: number; angle: number };
  turning: { sharp: number; sharpOn: boolean; wobble: number; wobbleOn: boolean };
  moving: { speed: number; edges: AgentRuleSet['edges'] };
  trail: { on: boolean; there: boolean; amount: number; channel: ChannelRef };
  /** Each card's "only when" (null: always, or not there). */
  when: Record<RuleCard, RuleCondition | null>;
  /** Where each card's action is (null: not there). */
  at: Record<RuleCard, Loc | null>;
  /** Rules (by index) with something the cards don't show: each is an Advanced rule card. */
  advanced: Array<{ rule: number; text: string; off: boolean }>;
}

/** The cards of species `sp`, read from the rule set. */
export function readCards(set: AgentRuleSet, sp: number): TrailCards {
  const s = Math.min(Math.max(sp, 0), set.species.length - 1);
  const b = readBehaviours(set, s, RULE_CARDS);
  const get = (c: RuleCard) => b.cards.find(x => x.card === c);
  const turn = get('senses')?.action as Extract<RuleAction, { kind: 'turn' }> | undefined;
  const wander = get('wobble')?.action as Extract<RuleAction, { kind: 'wander' }> | undefined;
  const trail = get('trail')?.action as Extract<RuleAction, { kind: 'trail' }> | undefined;
  const on = (c: RuleCard) => !!get(c)?.on;
  return {
    senses: { on: on('senses'), there: !!turn, channel: turn?.channel ?? 'own', away: !!turn?.away, distance: set.sensor.distance, angle: set.sensor.angle },
    turning: { sharp: turn?.degrees ?? CARD_DEFAULTS.turn, sharpOn: on('senses'), wobble: wander?.degrees ?? 0, wobbleOn: on('wobble') },
    moving: { speed: set.species[s].speed, edges: set.edges },
    trail: { on: on('trail'), there: !!trail, amount: trail?.amount ?? CARD_DEFAULTS.amount, channel: trail?.channel ?? 'own' },
    when: { senses: get('senses')?.when ?? null, wobble: get('wobble')?.when ?? null, trail: get('trail')?.when ?? null },
    at: { senses: get('senses')?.at ?? null, wobble: get('wobble')?.at ?? null, trail: get('trail')?.at ?? null },
    advanced: b.advanced,
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** Switch a card on or off (its action's rule's `off`). Switching on a card that isn't there adds it. */
export function setCardOn(set: AgentRuleSet, sp: number, c: RuleCard, on: boolean): AgentRuleSet {
  const at = locateCards(set, sp)[c];
  if (at) return setOnAt(set, sp, at, on);
  return on ? addCard(set, sp, c, RULE_CARDS).set : set;
}

/** Change a card's action (adding it, switched on, when it isn't there). */
export function patchCard<A extends RuleAction>(set: AgentRuleSet, sp: number, c: RuleCard, patch: Partial<A>): AgentRuleSet {
  const at = locateCards(set, sp)[c];
  if (at) return patchAt(set, sp, at, patch);
  const added = addCard(set, sp, c, RULE_CARDS);
  return patchAt(added.set, sp, added.at, patch);
}

/** The settings every card reads that live on the rule set or the species. */
export const setSensors = (set: AgentRuleSet, patch: Partial<AgentRuleSet['sensor']>): AgentRuleSet => ({ ...set, sensor: { ...set.sensor, ...patch } });
export const setEdges = (set: AgentRuleSet, edges: AgentRuleSet['edges']): AgentRuleSet => ({ ...set, edges });
export const setSpeed = (set: AgentRuleSet, sp: number, speed: number): AgentRuleSet =>
  ({ ...set, species: set.species.map((x, i) => (i === sp ? { ...x, speed } : x)) });
/** The rule set's view radius and how many neighbours a reading counts at most. */
export const setNeighbours = (set: AgentRuleSet, patch: Partial<{ radius: number; max: number }>): AgentRuleSet =>
  ({ ...set, neighbours: { radius: set.neighbours?.radius ?? 0.05, max: set.neighbours?.max ?? 36, ...patch } });
/** The flow field's Size and Evolve (Curl noise). */
export const setFlow = (set: AgentRuleSet, patch: Partial<AgentRuleSet['flow']>): AgentRuleSet => ({ ...set, flow: { ...set.flow, ...patch } });

// ── Smells ───────────────────────────────────────────────────────────────────

/** The Smells / Lays chips: its own trail, then the four channels by name. */
export function smellChips(set: AgentRuleSet): Array<{ value: ChannelRef; label: string }> {
  return [
    { value: 'own', label: 'its own' },
    ...([0, 1, 2, 3] as const).map(c => ({ value: c as ChannelRef, label: set.channels[c]?.trim() || `trail ${c + 1}` })),
  ];
}

/** One line for a section in the left nav (its folded summary). */
export function sectionSummary(cards: TrailCards, section: 'senses' | 'turning' | 'moving' | 'trail'): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  switch (section) {
    case 'senses': return cards.senses.on ? `${n(cards.senses.distance)} ahead · ${n(cards.senses.angle)}°` : 'off';
    case 'turning': return `${cards.turning.sharpOn ? `${n(cards.turning.sharp)}°` : 'no turn'}${cards.turning.wobbleOn ? ` · wobble ${n(cards.turning.wobble)}°` : ''}`;
    case 'moving': return `${n(cards.moving.speed)} · ${cards.moving.edges}`;
    case 'trail': return cards.trail.on ? `leaves ${n(cards.trail.amount)}` : 'off';
  }
}
