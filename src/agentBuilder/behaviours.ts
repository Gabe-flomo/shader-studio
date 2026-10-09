/**
 * behaviours.ts — the Agent Builder's behaviour cards for every kind of walker (docs/agent-builder.md),
 * read from and written to an Agents group's rule set (agentRules/spec.ts). Pure.
 *
 * A card is one action of a rule. The rule may carry one plain condition, the card's
 * **"Only when…"** line (a neighbour is near, it smells …, inside a shape, older than …, by chance,
 * in state …). Rules with more conditions, Stop after this rule, or a condition the cards can't
 * say, are Advanced rules (the rules editor). So:
 *
 *  - reading the cards and writing back the same values leaves the rule set unchanged, and
 *    generate.ts makes the same nodes from it (Open as nodes, Play and export keep working);
 *  - editing a card changes its action in place;
 *  - switching a card off, giving it an "only when", or dragging it moves that action into a rule
 *    of its own (so the rule's `off`, `when` and place in the list are the card's).
 *
 * Rule order is the order the cards run in: dragging a card to another place moves its rule.
 */
import {
  type AgentRule, type AgentRuleSet, type AgentSpeciesRules, type RuleAction, type RuleCondition,
  MAX_SPECIES, describeRule,
} from '../agentRules/spec';
import { DEFAULT_FIELD } from '../agentRules/fields';

export type CardId =
  // Trail followers
  | 'senses' | 'wobble' | 'trail'
  // Particles
  | 'gravity' | 'wind' | 'curl' | 'field' | 'attract' | 'drag' | 'fade' | 'die'
  // Flocks, crowds and orbiters
  | 'separate' | 'match' | 'cohere' | 'avoidEdges' | 'goal' | 'slow' | 'orbit';

export interface CardDef {
  id: CardId;
  /** Does this action belong to the card? */
  match: (a: RuleAction) => boolean;
  /** The action a new card starts with. */
  make: () => RuleAction;
  /** Several cards of this kind may be there (two gravities, two separations); else the first is the card and the rest are Advanced. */
  multi?: boolean;
  /** The "only when" a new card starts with (Dies: older than 3 s). */
  when?: () => RuleCondition;
}

type Act<K extends RuleAction['kind']> = Extract<RuleAction, { kind: K }>;
const is = <K extends RuleAction['kind']>(k: K) => (a: RuleAction): a is Act<K> => a.kind === k;
const force = (f: Act<'force'>['field'][]) => (a: RuleAction) => a.kind === 'force' && f.includes(a.field);

export const CARD_DEFS: Record<CardId, CardDef> = {
  senses: { id: 'senses', match: a => a.kind === 'turn' && a.toward === 'trail', make: () => ({ kind: 'turn', toward: 'trail', channel: 'own', degrees: 45 }) },
  wobble: { id: 'wobble', match: is('wander'), make: () => ({ kind: 'wander', degrees: 7 }) },
  trail: { id: 'trail', match: a => a.kind === 'trail' && !a.fade, make: () => ({ kind: 'trail', channel: 'own', amount: 1 }) },
  gravity: { id: 'gravity', multi: true, match: force(['gravity']), make: () => ({ kind: 'force', field: 'gravity', strength: 0.5, angle: -90 }) },
  wind: { id: 'wind', multi: true, match: force(['wind']), make: () => ({ kind: 'force', field: 'wind', strength: 0.3, angle: 0 }) },
  curl: { id: 'curl', multi: true, match: force(['curl']), make: () => ({ kind: 'force', field: 'curl', strength: 0.6 }) },
  field: { id: 'field', multi: true, match: is('field'), make: () => ({ kind: 'field', strength: 1, grip: 3, spec: DEFAULT_FIELD() }) },
  attract: { id: 'attract', multi: true, match: force(['point', 'mouse']), make: () => ({ kind: 'force', field: 'point', strength: 0.6, x: 0, y: 0 }) },
  drag: { id: 'drag', match: is('drag'), make: () => ({ kind: 'drag', amount: 0.5 }) },
  fade: { id: 'fade', match: is('fade'), make: () => ({ kind: 'fade', seconds: 3 }) },
  die: { id: 'die', match: is('die'), make: () => ({ kind: 'die' }), when: () => ({ kind: 'age', cmp: '>', seconds: 3 }) },
  separate: { id: 'separate', multi: true, match: is('separate'), make: () => ({ kind: 'separate', who: 'all', degrees: 12 }) },
  match: { id: 'match', multi: true, match: is('match'), make: () => ({ kind: 'match', who: 'all', degrees: 8 }) },
  cohere: { id: 'cohere', multi: true, match: is('cohere'), make: () => ({ kind: 'cohere', who: 'all', degrees: 3 }) },
  avoidEdges: { id: 'avoidEdges', match: is('avoidEdges'), make: () => ({ kind: 'avoidEdges', margin: 0.1, degrees: 12 }) },
  goal: { id: 'goal', multi: true, match: a => a.kind === 'turn' && a.toward !== 'trail', make: () => ({ kind: 'turn', toward: 'point', x: 0.8, y: 0, degrees: 10 }) },
  slow: { id: 'slow', match: is('slow'), make: () => ({ kind: 'slow', who: 'all', jam: 20 }) },
  orbit: { id: 'orbit', multi: true, match: is('orbit'), make: () => ({ kind: 'orbit', target: 'centre', distance: 0.5, degrees: 6 }) },
};

/** The conditions an "only when" line can say (one per card). The rest make a rule Advanced. */
export const ONLY_WHEN_KINDS = ['neighbours', 'sense', 'shape', 'age', 'chance', 'state'] as const;
export type OnlyWhenKind = typeof ONLY_WHEN_KINDS[number];

/** Where a card's action is: rule and action index in the species' rules. */
export interface Loc { rule: number; action: number }
export interface CardAt extends Loc { card: CardId }

/** The conditions of a rule that aren't "always". */
export const conditionsOf = (r: AgentRule) => r.when.filter(c => c.kind !== 'always');
const sayable = (c: RuleCondition) => (ONLY_WHEN_KINDS as readonly string[]).includes(c.kind);

/** A rule whose actions can be cards: no Stop after this rule, and at most one condition, one the cards can say. */
export function cardRule(r: AgentRule): boolean {
  const c = conditionsOf(r);
  return !r.stop && c.length <= 1 && c.every(sayable);
}

/** Actions that change what a condition reads (its state, its Memory number): later actions in a conditional rule stay Advanced. */
const changesWhen = (a: RuleAction) => a.kind === 'state' || a.kind === 'memory';

/**
 * The cards of species `sp` (of the given kinds), in reading order: each action that matches a
 * card (the first one only, unless the card is `multi`) in a rule the cards can read.
 */
export function locate(set: AgentRuleSet, sp: number, cards: readonly CardId[]): CardAt[] {
  const found = new Set<CardId>();
  const out: CardAt[] = [];
  (set.species[sp]?.rules ?? []).forEach((r, ri) => {
    if (!cardRule(r)) return;
    const conditional = conditionsOf(r).length > 0;
    let blocked = false;
    r.do.forEach((a, ai) => {
      if (!blocked) {
        for (const id of cards) {
          const d = CARD_DEFS[id];
          if (d.match(a) && (d.multi || !found.has(id))) { found.add(id); out.push({ card: id, rule: ri, action: ai }); break; }
        }
      }
      if (conditional && changesWhen(a)) blocked = true;
    });
  });
  return out;
}

export interface CardRead<A extends RuleAction = RuleAction> {
  card: CardId;
  /** Stable while editing: the card and which one of its kind (`gravity#0`, `gravity#1`). */
  key: string;
  at: Loc;
  action: A;
  on: boolean;
  /** Its "only when" (null: always). */
  when: RuleCondition | null;
}

export interface Behaviours {
  cards: CardRead[];
  /** Rules (by index) with something the cards don't show: each is an Advanced rule. */
  advanced: Array<{ rule: number; text: string; off: boolean }>;
}

/** The cards of species `sp`, and the rest as Advanced rules. */
export function readBehaviours(set: AgentRuleSet, sp: number, cards: readonly CardId[]): Behaviours {
  const s = Math.min(Math.max(sp, 0), set.species.length - 1);
  const rules = set.species[s]?.rules ?? [];
  const at = locate(set, s, cards);
  const nth = new Map<CardId, number>();
  const read: CardRead[] = at.map(l => {
    const r = rules[l.rule];
    const n = nth.get(l.card) ?? 0;
    nth.set(l.card, n + 1);
    return { card: l.card, key: `${l.card}#${n}`, at: { rule: l.rule, action: l.action }, action: r.do[l.action], on: !r.off, when: conditionsOf(r)[0] ?? null };
  });
  const taken = new Set(at.map(l => `${l.rule}:${l.action}`));
  const advanced: Behaviours['advanced'] = [];
  rules.forEach((r, ri) => {
    const rest = r.do.filter((_, ai) => !taken.has(`${ri}:${ai}`));
    if (cardRule(r) && !rest.length) return;
    advanced.push({ rule: ri, text: describeRule(set, s, cardRule(r) ? { ...r, do: rest } : r), off: !!r.off });
  });
  return { cards: read, advanced };
}

// ── Writing ──────────────────────────────────────────────────────────────────

const cloneRules = (set: AgentRuleSet, sp: number): AgentRule[] => set.species[sp].rules.map(r => ({ ...r, when: [...r.when], do: [...r.do] }));
export const withRules = (set: AgentRuleSet, sp: number, rules: AgentRule[]): AgentRuleSet =>
  ({ ...set, species: set.species.map((x, i) => (i === sp ? { ...x, rules } : x)) });

/**
 * The species' rules with the action at `at` alone in a rule of its own: its rule is split round
 * it (the actions before, it, the actions after), each piece keeping the conditions and switch, so
 * everything still runs in the same order. (A card is never after a state or Memory change in a
 * conditional rule, so the pieces' conditions read what the whole rule read.)
 */
function isolate(rules: AgentRule[], at: Loc): number {
  const r = rules[at.rule];
  if (r.do.length === 1) return at.rule;
  const piece = (d: RuleAction[]): AgentRule => ({ ...r, when: [...r.when], do: d });
  const before = r.do.slice(0, at.action), after = r.do.slice(at.action + 1);
  const pieces = [...(before.length ? [piece(before)] : []), piece([r.do[at.action]]), ...(after.length ? [piece(after)] : [])];
  rules.splice(at.rule, 1, ...pieces);
  return at.rule + (before.length ? 1 : 0);
}

/** Switch the card at `at` on or off (its rule's `off`). */
export function setOnAt(set: AgentRuleSet, sp: number, at: Loc, on: boolean): AgentRuleSet {
  const rules = cloneRules(set, sp);
  const ri = isolate(rules, at);
  const r = { ...rules[ri] };
  if (on) delete r.off; else r.off = true;
  rules[ri] = r;
  return withRules(set, sp, rules);
}

/** Change the card's action at `at`. */
export function patchAt<A extends RuleAction>(set: AgentRuleSet, sp: number, at: Loc, patch: Partial<A>): AgentRuleSet {
  const rules = set.species[sp].rules.map((r, ri) => (ri !== at.rule ? r : { ...r, do: r.do.map((a, ai) => (ai === at.action ? { ...a, ...patch } as RuleAction : a)) }));
  return withRules(set, sp, rules);
}

/**
 * A new card (switched on): a rule of its own, placed after the cards that come before it in
 * `order` (the kind's cards in the order a step runs them), else first.
 */
export function addCard(set: AgentRuleSet, sp: number, card: CardId, order: readonly CardId[], off = false): { set: AgentRuleSet; at: Loc } {
  const d = CARD_DEFS[card];
  const rules = cloneRules(set, sp);
  const before = order.slice(0, Math.max(0, order.indexOf(card)));
  const locs = locate(set, sp, order).filter(l => before.includes(l.card) || l.card === card);
  const pos = locs.length ? Math.max(...locs.map(l => l.rule)) + 1 : 0;
  rules.splice(pos, 0, { when: d.when ? [d.when()] : [{ kind: 'always' }], do: [d.make()], ...(off ? { off: true } : {}) });
  return { set: withRules(set, sp, rules), at: { rule: pos, action: 0 } };
}

/** Take a card away (its action; its rule too when that was all it did). */
export function removeAt(set: AgentRuleSet, sp: number, at: Loc): AgentRuleSet {
  const rules = cloneRules(set, sp);
  if (rules[at.rule].do.length === 1) rules.splice(at.rule, 1);
  else rules[at.rule].do.splice(at.action, 1);
  return withRules(set, sp, rules);
}

/** Give the card at `at` an "only when" (null: always): its action in a rule of its own with that condition. */
export function setOnlyWhen(set: AgentRuleSet, sp: number, at: Loc, cond: RuleCondition | null): AgentRuleSet {
  const rules = cloneRules(set, sp);
  const ri = isolate(rules, at);
  rules[ri] = { ...rules[ri], when: cond ? [cond] : [{ kind: 'always' }] };
  return withRules(set, sp, rules);
}

/**
 * Drag a card to another place: its action, in a rule of its own, goes just before the card at
 * `before` (null: just after the card at `after`, the last of its section). A rule the target
 * shares with other actions is split there, keeping its conditions on both halves.
 */
export function moveCard(set: AgentRuleSet, sp: number, from: Loc, target: { before: Loc } | { after: Loc }): AgentRuleSet {
  const rules = cloneRules(set, sp);
  const src = rules[from.rule];
  const moving = src.do[from.action];
  const anchor = 'before' in target ? rules[target.before.rule].do[target.before.action] : rules[target.after.rule].do[target.after.action];
  if (moving === anchor) return set;
  const own: AgentRule = { when: [...src.when], do: [moving], ...(src.off ? { off: true } : {}) };
  if (src.do.length === 1) rules.splice(from.rule, 1); else src.do.splice(from.action, 1);
  // Find the anchor again (indices moved) by the action itself.
  const ri = rules.findIndex(r => r.do.includes(anchor));
  if (ri < 0) return set;
  const ai = rules[ri].do.indexOf(anchor);
  const split = 'before' in target ? ai : ai + 1;
  const r = rules[ri];
  if (split > 0 && split < r.do.length) {
    rules.splice(ri, 1, { ...r, do: r.do.slice(0, split) }, { ...r, when: [...r.when], do: r.do.slice(split) });
    rules.splice(ri + 1, 0, own);
  } else rules.splice(split === 0 ? ri : ri + 1, 0, own);
  return withRules(set, sp, rules);
}

/** Move the card at index `i` of a section's cards (in reading order) to index `j`. */
export function reorderCards(set: AgentRuleSet, sp: number, section: readonly CardRead[], i: number, j: number): AgentRuleSet {
  if (i === j || i < 0 || j < 0 || i >= section.length || j >= section.length) return set;
  const from = section[i].at;
  return j < i ? moveCard(set, sp, from, { before: section[j].at }) : moveCard(set, sp, from, { after: section[j].at });
}

// ── Kinds of walker (species) ────────────────────────────────────────────────

/** The chips' colours, in order: a new kind takes the first one no other kind has. */
export const KIND_COLOURS: Array<[number, number, number]> = [[1, 0.62, 0.25], [0.3, 0.72, 1], [0.45, 0.92, 0.5], [0.85, 0.5, 1]];
const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 0.02);

/** A new kind (up to 4): a copy of kind `from` (its cards and speed), with the next name and colour. */
export function addSpecies(set: AgentRuleSet, from: number): AgentRuleSet {
  if (set.species.length >= MAX_SPECIES) return set;
  const src = set.species[Math.min(Math.max(from, 0), set.species.length - 1)];
  const used = set.species.map(s => s.states[0]?.colour ?? [1, 1, 1]);
  const colour = KIND_COLOURS.find(c => !used.some(u => same(u, c))) ?? KIND_COLOURS[set.species.length % KIND_COLOURS.length];
  const names = new Set(set.species.map(s => s.name));
  let k = set.species.length + 1;
  while (names.has(`Kind ${k}`)) k++;
  const copy: AgentSpeciesRules = structuredClone(src);
  copy.name = `Kind ${k}`;
  copy.states = copy.states.map((st, i) => (i === 0 ? { ...st, colour: [...colour] as [number, number, number] } : st));
  return { ...set, species: [...set.species, copy] };
}

export const renameSpecies = (set: AgentRuleSet, i: number, name: string): AgentRuleSet =>
  ({ ...set, species: set.species.map((s, k) => (k === i ? { ...s, name } : s)) });

/** A kind's colour: its first state's (what Colour by State draws it in). */
export const setSpeciesColour = (set: AgentRuleSet, i: number, colour: [number, number, number]): AgentRuleSet =>
  ({ ...set, species: set.species.map((s, k) => (k === i ? { ...s, states: s.states.map((st, j) => (j === 0 ? { ...st, colour } : st)) } : s)) });

/**
 * Take kind `i` away (one always stays). Conditions that named a later kind ("near Predators'
 * trail") follow it down one; ones that named this kind are dropped with their rule's condition.
 */
export function removeSpecies(set: AgentRuleSet, i: number): AgentRuleSet {
  if (set.species.length <= 1 || i < 0 || i >= set.species.length) return set;
  const follow = (c: RuleCondition): RuleCondition[] => (c.kind !== 'near' ? [c] : c.species === i ? [] : [{ ...c, species: c.species > i ? c.species - 1 : c.species }]);
  const species: AgentSpeciesRules[] = set.species.filter((_, k) => k !== i).map(s => ({
    ...s,
    rules: s.rules.map((r): AgentRule => {
      const when = r.when.flatMap(follow);
      return { ...r, when: when.length ? when : [{ kind: 'always' }] };
    }),
  }));
  return { ...set, species };
}
