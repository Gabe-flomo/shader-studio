/**
 * cards.ts — the Agent Builder's behaviour cards (docs/agent-builder.md) read from and written to
 * an Agents group's rule set (agentRules/spec.ts). Pure.
 *
 * The cards are another view of the same rule set, so generate.ts makes the same nodes from it
 * and Open as nodes, Play and web export keep working. A card is an action in an "always" rule
 * (no conditions, no Stop after this rule):
 *
 *  - Senses: a Turn toward a trail (its channel is the Smells chip; Avoid is Turn away). The
 *    sensors (how far ahead, how wide) are the rule set's.
 *  - Turning: How sharply is that Turn's degrees; Wobble is a Wander.
 *  - Moving: Speed is the species' speed; At the edges is the rule set's edges.
 *  - Trail: a Leave trail (without a Memory fade).
 *
 * The first matching action in reading order is the card's; anything else (conditions, Stop, a
 * second Turn, a state change…) is an Advanced rule, edited in the rules editor. An old rule set
 * opens as it is: editing a card changes its action in place, and only switching a card off or on
 * moves that action into a rule of its own (so the rule's `off` can carry the switch).
 */
import {
  type AgentRule, type AgentRuleSet, type ChannelRef, type RuleAction,
  describeRule,
} from '../agentRules/spec';

/** The behaviours a card holds (Moving and Born aren't rules). */
export type RuleCard = 'senses' | 'wobble' | 'trail';
export const RULE_CARDS: readonly RuleCard[] = ['senses', 'wobble', 'trail'];

/** Where a card's action is: rule and action index in the species' rules. */
export interface Loc { rule: number; action: number }

/** A rule the cards can read: always (no conditions but "always"), no Stop. */
export const plainRule = (r: AgentRule) => !r.stop && r.when.every(c => c.kind === 'always');

const MATCH: Record<RuleCard, (a: RuleAction) => boolean> = {
  senses: a => a.kind === 'turn' && a.toward === 'trail',
  wobble: a => a.kind === 'wander',
  trail: a => a.kind === 'trail' && !a.fade,
};

/** Each card's action, the first matching one in reading order (null: not there). */
export function locateCards(set: AgentRuleSet, sp: number): Record<RuleCard, Loc | null> {
  const out: Record<RuleCard, Loc | null> = { senses: null, wobble: null, trail: null };
  (set.species[sp]?.rules ?? []).forEach((r, ri) => {
    if (!plainRule(r)) return;
    r.do.forEach((a, ai) => {
      for (const c of RULE_CARDS) if (!out[c] && MATCH[c](a)) { out[c] = { rule: ri, action: ai }; return; }
    });
  });
  return out;
}

/** The defaults a card's action starts with when switched on for the first time. */
export const CARD_DEFAULTS = { turn: 45, wobble: 7, amount: 1 } as const;

export interface TrailCards {
  senses: { on: boolean; there: boolean; channel: ChannelRef; away: boolean; distance: number; angle: number };
  turning: { sharp: number; sharpOn: boolean; wobble: number; wobbleOn: boolean };
  moving: { speed: number; edges: AgentRuleSet['edges'] };
  trail: { on: boolean; there: boolean; amount: number; channel: ChannelRef };
  /** Rules (by index) with something the cards don't show: each is an Advanced rule card. */
  advanced: Array<{ rule: number; text: string; off: boolean }>;
}

const actionAt = (set: AgentRuleSet, sp: number, l: Loc | null) => (l ? set.species[sp].rules[l.rule].do[l.action] : undefined);
const onAt = (set: AgentRuleSet, sp: number, l: Loc | null) => !!l && !set.species[sp].rules[l.rule].off;

/** The cards of species `sp`, read from the rule set. */
export function readCards(set: AgentRuleSet, sp: number): TrailCards {
  const s = Math.min(Math.max(sp, 0), set.species.length - 1);
  const at = locateCards(set, s);
  const turn = actionAt(set, s, at.senses) as Extract<RuleAction, { kind: 'turn' }> | undefined;
  const wander = actionAt(set, s, at.wobble) as Extract<RuleAction, { kind: 'wander' }> | undefined;
  const trail = actionAt(set, s, at.trail) as Extract<RuleAction, { kind: 'trail' }> | undefined;
  const taken = new Set(RULE_CARDS.map(c => at[c]).filter((l): l is Loc => !!l).map(l => `${l.rule}:${l.action}`));
  const advanced: TrailCards['advanced'] = [];
  set.species[s].rules.forEach((r, ri) => {
    const rest = r.do.filter((_, ai) => !taken.has(`${ri}:${ai}`));
    if (plainRule(r) && !rest.length) return;
    advanced.push({ rule: ri, text: describeRule(set, s, plainRule(r) ? { ...r, do: rest } : r), off: !!r.off });
  });
  const sensesOn = onAt(set, s, at.senses);
  return {
    senses: { on: sensesOn, there: !!at.senses, channel: turn?.channel ?? 'own', away: !!turn?.away, distance: set.sensor.distance, angle: set.sensor.angle },
    turning: { sharp: turn?.degrees ?? CARD_DEFAULTS.turn, sharpOn: sensesOn, wobble: wander?.degrees ?? 0, wobbleOn: onAt(set, s, at.wobble) },
    moving: { speed: set.species[s].speed, edges: set.edges },
    trail: { on: onAt(set, s, at.trail), there: !!at.trail, amount: trail?.amount ?? CARD_DEFAULTS.amount, channel: trail?.channel ?? 'own' },
    advanced,
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

const withRules = (set: AgentRuleSet, sp: number, rules: AgentRule[]): AgentRuleSet =>
  ({ ...set, species: set.species.map((x, i) => (i === sp ? { ...x, rules } : x)) });

const always = (a: RuleAction, off = false): AgentRule => ({ when: [{ kind: 'always' }], do: [a], ...(off ? { off: true } : {}) });

const NEW_ACTION: Record<RuleCard, () => RuleAction> = {
  senses: () => ({ kind: 'turn', toward: 'trail', channel: 'own', degrees: CARD_DEFAULTS.turn }),
  wobble: () => ({ kind: 'wander', degrees: CARD_DEFAULTS.wobble }),
  trail: () => ({ kind: 'trail', channel: 'own', amount: CARD_DEFAULTS.amount }),
};

/**
 * The species' rules with card `c`'s action alone in a rule of its own (so its rule's `off` is the
 * card's switch): a new always rule when it isn't there, placed after the card before it (Senses,
 * Wobble, Trail: the slime step's order), else first.
 */
function ownRule(set: AgentRuleSet, sp: number, c: RuleCard): { rules: AgentRule[]; at: number } {
  const rules = set.species[sp].rules.map(r => ({ ...r, do: [...r.do] }));
  const at = locateCards(set, sp)[c];
  if (at) {
    const r = rules[at.rule];
    if (r.do.length === 1) return { rules, at: at.rule };
    const [a] = r.do.splice(at.action, 1);
    rules.splice(at.rule + 1, 0, always(a, !!r.off));
    return { rules, at: at.rule + 1 };
  }
  const locs = locateCards(set, sp);
  const before = RULE_CARDS.slice(0, RULE_CARDS.indexOf(c)).map(k => locs[k]).filter((l): l is Loc => !!l);
  const pos = before.length ? Math.max(...before.map(l => l.rule)) + 1 : 0;
  rules.splice(pos, 0, always(NEW_ACTION[c](), true));
  return { rules, at: pos };
}

/** Switch a card on or off (its action's rule's `off`). Switching on a card that isn't there adds it. */
export function setCardOn(set: AgentRuleSet, sp: number, c: RuleCard, on: boolean): AgentRuleSet {
  if (!on && !locateCards(set, sp)[c]) return set;
  const { rules, at } = ownRule(set, sp, c);
  const r = { ...rules[at] };
  if (on) delete r.off; else r.off = true;
  rules[at] = r;
  return withRules(set, sp, rules);
}

/** Change a card's action (adding it, switched on, when it isn't there). */
export function patchCard<A extends RuleAction>(set: AgentRuleSet, sp: number, c: RuleCard, patch: Partial<A>): AgentRuleSet {
  let next = set;
  let at = locateCards(next, sp)[c];
  if (!at) { next = setCardOn(next, sp, c, true); at = locateCards(next, sp)[c]!; }
  const rules = next.species[sp].rules.map((r, ri) => (ri !== at!.rule ? r : { ...r, do: r.do.map((a, ai) => (ai === at!.action ? { ...a, ...patch } as RuleAction : a)) }));
  return withRules(next, sp, rules);
}

/** The settings every card reads that live on the rule set or the species. */
export const setSensors = (set: AgentRuleSet, patch: Partial<AgentRuleSet['sensor']>): AgentRuleSet => ({ ...set, sensor: { ...set.sensor, ...patch } });
export const setEdges = (set: AgentRuleSet, edges: AgentRuleSet['edges']): AgentRuleSet => ({ ...set, edges });
export const setSpeed = (set: AgentRuleSet, sp: number, speed: number): AgentRuleSet =>
  ({ ...set, species: set.species.map((x, i) => (i === sp ? { ...x, speed } : x)) });

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
