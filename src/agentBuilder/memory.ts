/**
 * memory.ts — the Agent Builder's Memory section (docs/agent-builder.md "Memory"), its pure part:
 * the named memories (add, rename, change, take away), the operation cards that change them (each
 * one rule action, agentRules/spec.ts `mem`, with the card's "only when" as its trigger), memory
 * conditions for any card's only when, and "× a memory" on sliders. The rules underneath are
 * generated as always (agentRules/generate.ts), into the group's More memory (state E).
 */
import {
  type AgentMemory, type AgentRule, type AgentRuleSet, type ChannelRef, type MemoryTimes, type MemoryType, type RuleAction, type RuleCondition,
  memoryIdent,
} from '../agentRules/spec';
import { MEMORY_SLOTS, memorySlots, newMemoryId, slotsOf, slotsUsed } from '../agentRules/memory';
import { type Loc, withRules } from './behaviours';

export const MEMORY_TYPE_WORDS: Record<MemoryType, { label: string; hint: string; example: string }> = {
  counter: { label: 'Counter', hint: 'A number it counts up or down.', example: 'visits' },
  timer: { label: 'Timer', hint: 'Seconds since it was last started: it counts by itself.', example: 'away' },
  flag: { label: 'On / off', hint: 'Yes or no: carrying, hungry, lost.', example: 'carrying' },
  value: { label: 'A value', hint: 'A number it remembers: what it smelled, how far it went.', example: 'smelled' },
  position: { label: 'A place', hint: 'Where it was (two numbers).', example: 'home' },
  level: { label: 'A level that fades', hint: 'A number that drains by itself, like energy.', example: 'energy' },
};
export const MEMORY_TYPE_ORDER: readonly MemoryType[] = ['counter', 'timer', 'flag', 'value', 'position', 'level'];

/** Room for a memory of this type (four numbers between them). */
export const roomFor = (set: AgentRuleSet, t: MemoryType) => slotsUsed(set) + slotsOf(t) <= MEMORY_SLOTS;

/** A name not taken (an identifier expressions can write). */
function freeName(set: AgentRuleSet, want: string): string {
  const taken = new Set((set.memories ?? []).map(m => memoryIdent(m.name)));
  const base = memoryIdent(want) || 'memory';
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

/** Add a memory of a type (null when there is no room). A level starts full and fades 0.3 a second. */
export function addMemory(set: AgentRuleSet, type: MemoryType, name?: string): { set: AgentRuleSet; id: string } | null {
  if (!roomFor(set, type)) return null;
  const id = newMemoryId(set);
  const m: AgentMemory = { id, name: freeName(set, name ?? MEMORY_TYPE_WORDS[type].example), type, ...(type === 'level' ? { start: 1, fade: 0.3 } : {}) };
  return { set: { ...set, memories: [...(set.memories ?? []), m] }, id };
}

export function patchMemory(set: AgentRuleSet, id: string, patch: Partial<Omit<AgentMemory, 'id'>>): AgentRuleSet {
  const next = { ...patch };
  if (patch.name !== undefined) next.name = memoryIdent(patch.name) || 'memory';
  return { ...set, memories: (set.memories ?? []).map(m => (m.id === id ? { ...m, ...next } : m)) };
}

/**
 * Rename a memory: its name in every expression changes with it (`food * 0.98` → `fuel * 0.98`).
 */
export function renameMemory(set: AgentRuleSet, id: string, name: string): AgentRuleSet {
  const old = set.memories?.find(m => m.id === id);
  if (!old) return set;
  const to = memoryIdent(name);
  if (!to || (set.memories ?? []).some(m => m.id !== id && memoryIdent(m.name) === to)) return set;
  const from = memoryIdent(old.name);
  const re = new RegExp(`(?<![\\w.])${from}(?!\\w)`, 'g');
  const next = patchMemory(set, id, { name: to });
  return { ...next, species: next.species.map(sp => ({ ...sp, rules: sp.rules.map(r => ({ ...r, do: r.do.map(a => (a.kind === 'mem' && a.op === 'expr' && a.expr ? { ...a, expr: a.expr.replace(re, to) } : a)) })) })) };
}

/** Take a memory away, with the cards that change it, the conditions that read it and the × it gave. */
export function removeMemory(set: AgentRuleSet, id: string): AgentRuleSet {
  const dropTimes = <T extends { times?: MemoryTimes }>(x: T): T => { if (x.times?.memory !== id) return x; const { times: _t, ...rest } = x; return rest as T; };
  const species = set.species.map(sp => {
    const { speedTimes, ...rest } = sp;
    const rules: AgentRule[] = [];
    for (const r of sp.rules) {
      const doing = r.do.filter(a => !(a.kind === 'mem' && a.memory === id)).map(dropTimes);
      if (!doing.length) continue;
      const when = r.when.filter(c => !(c.kind === 'mem' && c.memory === id));
      rules.push({ ...r, when: when.length ? when : [{ kind: 'always' }], do: doing });
    }
    return { ...rest, ...(speedTimes && speedTimes.memory !== id ? { speedTimes } : {}), rules };
  });
  const { colourBy, ...base } = set;
  const memories = (set.memories ?? []).filter(m => m.id !== id);
  return { ...base, ...(colourBy && colourBy.memory !== id ? { colourBy } : {}), ...(memories.length ? { memories } : {}), species };
}

// ── Operation cards ──────────────────────────────────────────────────────────

export type OpCardId = 'countUp' | 'countDown' | 'startTimer' | 'toggle' | 'setOn' | 'setOff' | 'setTo' | 'place' | 'smell' | 'sum' | 'decay' | 'reset' | 'expr';

export interface OpCardDef {
  id: OpCardId;
  label: string;
  hint: string;
  /** The memory types it is offered for. */
  types: readonly MemoryType[];
  make: (m: AgentMemory) => Extract<RuleAction, { kind: 'mem' }>;
}

const T_NUM: readonly MemoryType[] = ['counter', 'value', 'level'];
export const OP_CARDS: readonly OpCardDef[] = [
  { id: 'countUp', label: 'Count up when …', hint: 'Adds to it each step its only when holds (or so much a second).', types: T_NUM, make: m => ({ kind: 'mem', memory: m.id, op: 'add', value: 1 }) },
  { id: 'countDown', label: 'Count down when …', hint: 'Takes from it each step its only when holds (or so much a second).', types: T_NUM, make: m => ({ kind: 'mem', memory: m.id, op: 'add', value: -1 }) },
  { id: 'startTimer', label: 'Start the timer when …', hint: 'Back to 0; it counts the seconds from there. "After N s" is an only when on any card.', types: ['timer'], make: m => ({ kind: 'mem', memory: m.id, op: 'reset' }) },
  { id: 'toggle', label: 'Toggle on …', hint: 'On becomes off, off becomes on.', types: ['flag'], make: m => ({ kind: 'mem', memory: m.id, op: 'toggle' }) },
  { id: 'setOn', label: 'Set on when …', hint: 'Switches it on.', types: ['flag'], make: m => ({ kind: 'mem', memory: m.id, op: 'set', value: 1 }) },
  { id: 'setOff', label: 'Set off when …', hint: 'Switches it off.', types: ['flag'], make: m => ({ kind: 'mem', memory: m.id, op: 'set', value: 0 }) },
  { id: 'setTo', label: 'Set to … when …', hint: 'Sets it to a number (a level refilled, a counter reset to 5).', types: T_NUM, make: m => ({ kind: 'mem', memory: m.id, op: 'set', value: 1 }) },
  { id: 'place', label: 'Remember where it was when …', hint: 'Keeps the place it is at now.', types: ['position'], make: m => ({ kind: 'mem', memory: m.id, op: 'place' }) },
  { id: 'smell', label: 'Remember what it smells', hint: 'Keeps how strong a trail is where it stands.', types: ['value', 'level', 'counter'], make: m => ({ kind: 'mem', memory: m.id, op: 'smell', channel: 'own' }) },
  { id: 'sum', label: 'Add up what it smells', hint: 'Adds the trail where it stands, a second\'s worth a second.', types: ['value', 'level', 'counter'], make: m => ({ kind: 'mem', memory: m.id, op: 'sum', channel: 'own', value: 1 }) },
  { id: 'decay', label: 'Decay over time', hint: 'Loses so much of itself a second.', types: ['value', 'level', 'counter'], make: m => ({ kind: 'mem', memory: m.id, op: 'decay', value: 0.5 }) },
  { id: 'reset', label: 'Reset when …', hint: 'Back to 0.', types: ['counter', 'value', 'level', 'position', 'flag'], make: m => ({ kind: 'mem', memory: m.id, op: 'reset' }) },
  { id: 'expr', label: 'Write it as an expression', hint: 'Any line of its senses and memories: food * 0.98 + here.food.', types: ['counter', 'timer', 'flag', 'value', 'position', 'level'], make: m => ({ kind: 'mem', memory: m.id, op: 'expr', expr: m.type === 'position' ? 'pos' : `${memoryIdent(m.name)} * 0.98` }) },
];
export const opCardsFor = (m: AgentMemory) => OP_CARDS.filter(o => o.types.includes(m.type));

/** Which operation card an action is (by its op and value). */
export function opCardOf(a: Extract<RuleAction, { kind: 'mem' }>, m: AgentMemory | undefined): OpCardId {
  switch (a.op) {
    case 'add': return (a.value ?? 0) < 0 ? 'countDown' : 'countUp';
    case 'set': return m?.type === 'flag' ? ((a.value ?? 0) >= 0.5 ? 'setOn' : 'setOff') : 'setTo';
    case 'reset': return m?.type === 'timer' ? 'startTimer' : 'reset';
    case 'toggle': return 'toggle';
    case 'place': return 'place';
    case 'smell': return 'smell';
    case 'sum': return 'sum';
    case 'decay': return 'decay';
    case 'expr': return 'expr';
  }
}

/** Add an operation card for a memory: a rule of its own at the end of the species' rules (switched on, always). */
export function addOpCard(set: AgentRuleSet, sp: number, op: OpCardId, memoryId: string): { set: AgentRuleSet; at: Loc } | null {
  const m = set.memories?.find(x => x.id === memoryId);
  const d = OP_CARDS.find(o => o.id === op);
  if (!m || !d) return null;
  const rules = [...set.species[sp].rules, { when: [{ kind: 'always' }], do: [d.make(m)] } as AgentRule];
  return { set: withRules(set, sp, rules), at: { rule: rules.length - 1, action: 0 } };
}

// ── Memory in "only when" and in sliders ─────────────────────────────────────

/** A new memory condition for a memory: on (on / off), after 2 s (a timer), within 0.1 (a place), above 0.5 (the rest). */
export function newMemCondition(m: AgentMemory): RuleCondition {
  switch (m.type) {
    case 'flag': return { kind: 'mem', memory: m.id, cmp: '>', value: 0.5 };
    case 'timer': return { kind: 'mem', memory: m.id, cmp: '>', value: 2 };
    case 'position': return { kind: 'mem', memory: m.id, cmp: '<', value: 0.1 };
    default: return { kind: 'mem', memory: m.id, cmp: '>', value: 0.5 };
  }
}

/** A memory condition's chip words: "carrying is on", "2 s after away started", "energy above 0.5". */
export function memWhenText(set: AgentRuleSet, c: RuleCondition): string {
  if (c.kind !== 'mem') return '';
  const m = set.memories?.find(x => x.id === c.memory);
  const name = m?.name ?? 'a memory';
  const v = Math.round(c.value * 100) / 100;
  if (m?.type === 'flag') return `${name} is ${c.cmp === '<' ? 'off' : 'on'}`;
  if (m?.type === 'timer') return c.cmp === '<' ? `within ${v} s of starting ${name}` : `${v} s after ${name} started`;
  if (m?.type === 'position') return `${c.cmp === '<' ? 'within' : 'further than'} ${v} of ${name}`;
  return `${name} ${c.cmp === '<' ? 'below' : c.cmp === '=' ? 'is' : 'above'} ${v}`;
}

/** Memories a slider can be multiplied by (a place can't). */
export const timesMemories = (set: AgentRuleSet) => (set.memories ?? []).filter(m => m.type !== 'position' && memorySlots(set).has(m.id));

/** A memory's place for the viewport lens and Under the hood: 'E:0'… (null: no slot). */
export function memoryLensSlot(set: AgentRuleSet, id: string): string | null {
  const sl = memorySlots(set).get(id);
  return sl ? `E:${'xyzw'.indexOf(sl[0])}` : null;
}

/** Under the hood's names for E's four channels. */
export function memorySlotNames(set: AgentRuleSet): string[] {
  const out = ['', '', '', ''];
  const slots = memorySlots(set);
  for (const m of set.memories ?? []) {
    const sl = slots.get(m.id);
    if (!sl) continue;
    [...sl].forEach((c, k) => { out['xyzw'.indexOf(c)] = sl.length > 1 ? `${m.name} ${'xy'[k]}` : m.name; });
  }
  return out;
}

/** A sensible lens range for a memory before the live one arrives: on / off 0–1, a timer 0–10 s, the rest 0–1. */
export const defaultMemRange = (m: AgentMemory): [number, number] => (m.type === 'timer' ? [0, 10] : [0, Math.max(1, m.start ?? 1)]);

// ── The ants, rebuilt with named memories ────────────────────────────────────

const ANT_NEST = { x: -0.15, y: -0.1 };

/**
 * The ants preset as cards (docs/agent-builder.md "Memory"): `carrying` (on / off) and `away` (a
 * timer: seconds since it left the nest or the food) instead of states and the Memory number. Every
 * rule is a card: one action, with at most a mask and a memory as its only when. The marks it lays
 * fade with `away` (× e^(−0.15 · away)), as the old ants' "leave trail … fading with Memory" did.
 */
export function antsWithMemories(): AgentRuleSet {
  const carrying = 'm1', away = 'm2';
  const on: RuleCondition = { kind: 'mem', memory: carrying, cmp: '>', value: 0.5 };
  const off: RuleCondition = { kind: 'mem', memory: carrying, cmp: '<', value: 0.5 };
  const food: RuleCondition = { kind: 'mask', mask: 0, cmp: '>', value: 0.5 };
  const nest: RuleCondition = { kind: 'mask', mask: 1, cmp: '>', value: 0.5 };
  const fading: MemoryTimes = { memory: away, fade: 0.15 };
  const rule = (when: RuleCondition[], a: RuleAction): AgentRule => ({ when: when.length ? when : [{ kind: 'always' }], do: [a] });
  const ch = (c: number) => c as ChannelRef;
  return {
    v: 1, kind: 'ants',
    channels: ['home', 'food', '', ''],
    masks: [{ name: 'Food', kind: 'number' }, { name: 'Nest', kind: 'number' }],
    edges: 'bounce',
    sensor: { distance: 0.04, angle: 35 },
    flow: { size: 1, evolve: 0.15 },
    memories: [{ id: carrying, name: 'carrying', type: 'flag' }, { id: away, name: 'away', type: 'timer' }],
    colourBy: { memory: carrying, lo: -1.2, hi: 1 },
    species: [{
      name: 'Ants', speed: 0.3,
      states: [{ name: 'walking', colour: [0.62, 0.42, 0.3] }],
      rules: [
        rule([], { kind: 'wander', degrees: 5 }),
        rule([off], { kind: 'turn', toward: 'trail', channel: ch(1), degrees: 20 }),
        rule([on], { kind: 'turn', toward: 'trail', channel: ch(0), degrees: 20 }),
        rule([on], { kind: 'turn', toward: 'point', x: ANT_NEST.x, y: ANT_NEST.y, degrees: 2 }),
        rule([off], { kind: 'trail', channel: ch(0), amount: 1, times: fading }),
        rule([on], { kind: 'trail', channel: ch(1), amount: 1, times: fading }),
        rule([food, off], { kind: 'bounce' }),
        rule([food, off], { kind: 'mem', memory: away, op: 'reset' }),
        rule([food, off], { kind: 'mem', memory: carrying, op: 'set', value: 1 }),
        rule([nest, on], { kind: 'bounce' }),
        rule([nest, on], { kind: 'mem', memory: away, op: 'reset' }),
        rule([nest, on], { kind: 'mem', memory: carrying, op: 'set', value: 0 }),
      ],
    }],
  };
}
