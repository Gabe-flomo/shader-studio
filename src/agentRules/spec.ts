/**
 * Agent Rules (docs/agent-rules.md): an Agents group's behaviour written as **When … Do …** lines.
 *
 * A rule set is plain data kept on the group (`params.agentRules`). Its inside is generated from
 * it (generate.ts) as ordinary nodes: Agent Inputs, Sense, Curl noise, one Expression Block per
 * rule, Move and Agent Output. So the rules compile to exactly the per-agent GLSL that the same
 * nodes do, and **Open as nodes** is the stored inside with the rules switched off.
 *
 * State per walker lives in Agent Output's Memory (two floats):
 *  - Memory x: the state index (0, 1, 2…), plus 0.5 once the walker has stuck;
 *  - Memory y: the walker's one free number (a timer, a counter, a phase).
 * That is the limit: a walker can't remember more than a state and one number.
 */

export type Cmp = '>' | '<';
/** Which trail channel: the walker's own species' channel, or channel 1–4 (0–3 here). */
export type ChannelRef = 'own' | 0 | 1 | 2 | 3;
/** Where the trail is read: a sensor (left, ahead, right), any of the three, or where the walker stands. */
export type SenseWhere = 'ahead' | 'left' | 'right' | 'any' | 'here';
export type TurnTarget = 'trail' | 'point' | 'centre' | 'mouse';

export type RuleCondition =
  | { kind: 'always' }
  /** The trail (one channel) read at a sensor, compared with a value. */
  | { kind: 'sense'; channel: ChannelRef; where: SenseWhere; cmp: Cmp; value: number }
  /** Another species' trail anywhere round the walker (any sensor or here) above a value. */
  | { kind: 'near'; species: number; value: number }
  /** A random chance within one second (0–1), frame-rate independent: 1 − (1 − p)^dt a step. */
  | { kind: 'chance'; perSecond: number }
  /** Seconds since it was born. */
  | { kind: 'age'; cmp: Cmp; seconds: number }
  /** In (or not in) one of its species' states. */
  | { kind: 'state'; state: number; not?: boolean }
  /** Its Memory number (Memory y). */
  | { kind: 'memory'; cmp: Cmp | '='; value: number }
  /** A mask (a texture or any chain wired into the group) where the walker stands. */
  | { kind: 'mask'; mask: number; cmp: Cmp; value: number };

export type RuleAction =
  /** Turn toward (or away from) the trail, a point, the centre or the mouse, at most `degrees` a step. */
  | { kind: 'turn'; toward: TurnTarget; away?: boolean; channel?: ChannelRef; x?: number; y?: number; degrees: number }
  /** A random turn of up to `degrees` either way. */
  | { kind: 'wander'; degrees: number }
  /** Set the speed, or accelerate (add `value` a second). Picture units a second. */
  | { kind: 'speed'; mode: 'set' | 'add'; value: number }
  /** Leave trail in a channel (times Deposit's Amount); `fade` weakens it with the Memory number (e^(−fade·number)). */
  | { kind: 'trail'; channel: ChannelRef; amount: number; fade?: number }
  /** Change to another state. */
  | { kind: 'state'; state: number }
  /** Set, add to, count up (a second) or randomise the Memory number. */
  | { kind: 'memory'; mode: 'set' | 'add' | 'perSecond' | 'random'; value: number }
  /** Speed 0 (another rule can set it moving again). */
  | { kind: 'stop' }
  /** Speed 0 for good: it never moves again (its rules still run, so it can leave trail). */
  | { kind: 'stick' }
  /** Dies (an Emit with Keep full or Rate brings a new one). */
  | { kind: 'die' }
  /** Lays a birth mark in trail channel 4; the group's Births Emit gives birth where there are marks. */
  | { kind: 'spawn'; amount: number }
  /** Turns round. */
  | { kind: 'bounce' }
  /** Turns toward (or against) a curl-noise flow field, at most `degrees` a step. */
  | { kind: 'flow'; degrees: number; away?: boolean }
  /**
   * Turns toward the way the crowd round it flies, at most `degrees` a step: the trail's flow where it
   * stands, from a velocity trail (the group's Deposit set to What: Velocity). Boids' alignment.
   */
  | { kind: 'align'; degrees: number };

export interface AgentRule {
  /** All must hold (an empty list: always). */
  when: RuleCondition[];
  do: RuleAction[];
  /** Stop after this rule: when it applies, the rules below are skipped this step. */
  stop?: boolean;
  /** Switched off: kept, skipped. */
  off?: boolean;
}

export interface AgentState { name: string; colour: [number, number, number] }

export interface AgentSpeciesRules {
  name: string;
  /** Picture units a second: each walker starts at it (Set speed / Accelerate change it, and it is kept). */
  speed: number;
  /** At least one; the first is the state every walker is born in. */
  states: AgentState[];
  rules: AgentRule[];
}

export interface AgentMask { name: string; kind: 'texture' | 'number' }

export interface AgentRuleSet {
  v: 1;
  /** Names of the four trail channels, for the sentences ("food trail"). Empty: "trail 1"… */
  channels: string[];
  /** Up to two masks: inputs on the group card (a texture, or any number chain read where the walker is). */
  masks: AgentMask[];
  /** What happens at the edges of the picture (or the 3D box). */
  edges: 'wrap' | 'bounce' | 'slide';
  /** The sensors every trail reading uses: how far ahead (picture units) and how wide (degrees). */
  sensor: { distance: number; angle: number };
  /** The flow field Follow a flow field reads (Curl noise: Size, Evolve). */
  flow: { size: number; evolve: number };
  /** One per species (1–4): the group's Species follows it. */
  species: AgentSpeciesRules[];
}

export const MAX_SPECIES = 4;
export const MAX_STATES = 8;
export const MAX_MASKS = 2;

/** A walker's chance of a rule with `perSecond` firing in one step of `dt` seconds. */
export const chancePerStep = (perSecond: number, dt: number) => 1 - Math.pow(1 - Math.min(Math.max(perSecond, 0), 1), dt);

export const DEFAULT_STATE_COLOURS: Array<[number, number, number]> = [
  [0.95, 0.9, 0.8], [1.0, 0.42, 0.25], [0.35, 0.85, 0.45], [0.35, 0.6, 1.0], [0.95, 0.8, 0.25], [0.8, 0.45, 0.95], [0.3, 0.9, 0.9], [0.6, 0.6, 0.6],
];

/** A new rule set that already moves: every walker follows its trail, wanders and leaves trail. */
export function defaultRuleSet(): AgentRuleSet {
  return {
    v: 1,
    channels: ['', '', '', ''],
    masks: [],
    edges: 'wrap',
    sensor: { distance: 0.03, angle: 40 },
    flow: { size: 1, evolve: 0.15 },
    species: [defaultSpecies(0)],
  };
}

export function defaultSpecies(i: number): AgentSpeciesRules {
  return {
    name: ['Walkers', 'Second kind', 'Third kind', 'Fourth kind'][i] ?? `Kind ${i + 1}`,
    speed: 0.25,
    states: [{ name: 'walking', colour: DEFAULT_STATE_COLOURS[i] ?? [1, 1, 1] }],
    rules: [defaultRule()],
  };
}

/** Wander and leave trail, following the trail it smells: the slime-mold step. */
export function defaultRule(): AgentRule {
  return {
    when: [{ kind: 'always' }],
    do: [
      { kind: 'turn', toward: 'trail', channel: 'own', degrees: 30 },
      { kind: 'wander', degrees: 8 },
      { kind: 'trail', channel: 'own', amount: 1 },
    ],
  };
}

// ── Defaults for the editor's pickers ────────────────────────────────────────

export const CONDITION_KINDS: Array<{ kind: RuleCondition['kind']; label: string }> = [
  { kind: 'always', label: 'always' },
  { kind: 'sense', label: 'trail sensed' },
  { kind: 'near', label: 'near another species\' trail' },
  { kind: 'chance', label: 'random chance' },
  { kind: 'age', label: 'age' },
  { kind: 'state', label: 'in state' },
  { kind: 'memory', label: 'Memory number' },
  { kind: 'mask', label: 'inside a mask' },
];

export const ACTION_KINDS: Array<{ kind: RuleAction['kind']; label: string }> = [
  { kind: 'turn', label: 'turn toward / away' },
  { kind: 'wander', label: 'wander' },
  { kind: 'speed', label: 'set speed / accelerate' },
  { kind: 'trail', label: 'leave trail' },
  { kind: 'state', label: 'change state' },
  { kind: 'memory', label: 'Memory number' },
  { kind: 'stop', label: 'stop' },
  { kind: 'stick', label: 'stick' },
  { kind: 'die', label: 'die' },
  { kind: 'spawn', label: 'spawn a child' },
  { kind: 'bounce', label: 'bounce (turn round)' },
  { kind: 'flow', label: 'follow a flow field' },
  { kind: 'align', label: 'align with the crowd' },
];

export function newCondition(kind: RuleCondition['kind']): RuleCondition {
  switch (kind) {
    case 'always': return { kind };
    case 'sense': return { kind, channel: 'own', where: 'ahead', cmp: '>', value: 0.3 };
    case 'near': return { kind, species: 1, value: 0.2 };
    case 'chance': return { kind, perSecond: 0.5 };
    case 'age': return { kind, cmp: '>', seconds: 2 };
    case 'state': return { kind, state: 0 };
    case 'memory': return { kind, cmp: '>', value: 1 };
    case 'mask': return { kind, mask: 0, cmp: '>', value: 0.5 };
  }
}

export function newAction(kind: RuleAction['kind']): RuleAction {
  switch (kind) {
    case 'turn': return { kind, toward: 'trail', channel: 'own', degrees: 30 };
    case 'wander': return { kind, degrees: 10 };
    case 'speed': return { kind, mode: 'set', value: 0.25 };
    case 'trail': return { kind, channel: 'own', amount: 1 };
    case 'state': return { kind, state: 0 };
    case 'memory': return { kind, mode: 'set', value: 0 };
    case 'spawn': return { kind, amount: 1 };
    case 'flow': return { kind, degrees: 20 };
    case 'align': return { kind, degrees: 10 };
    default: return { kind } as RuleAction;
  }
}

// ── Plain sentences ──────────────────────────────────────────────────────────

const num = (v: number) => String(Math.round(v * 1000) / 1000);
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

export function channelName(set: AgentRuleSet, c: ChannelRef | undefined): string {
  if (c === undefined || c === 'own') return 'its own trail';
  const name = set.channels[c]?.trim();
  return name ? `${name} trail` : `trail ${c + 1}`;
}

const stateName = (set: AgentRuleSet, sp: number, s: number) => set.species[sp]?.states[s]?.name || `state ${s + 1}`;
const maskName = (set: AgentRuleSet, m: number) => set.masks[m]?.name || `mask ${m + 1}`;
const WHERE: Record<SenseWhere, string> = { ahead: 'ahead', left: 'to the left', right: 'to the right', any: 'anywhere ahead', here: 'here' };

export function describeCondition(set: AgentRuleSet, sp: number, c: RuleCondition): string {
  switch (c.kind) {
    case 'always': return 'always';
    case 'sense': return `${channelName(set, c.channel)} ${WHERE[c.where]} ${c.cmp} ${num(c.value)}`;
    case 'near': return `near ${set.species[c.species]?.name ?? `species ${c.species + 1}`}'s trail (${channelName(set, c.species as ChannelRef)}) > ${num(c.value)}`;
    case 'chance': return `a ${pct(c.perSecond)} chance a second`;
    case 'age': return `age ${c.cmp} ${num(c.seconds)} s`;
    case 'state': return `${c.not ? 'not ' : ''}${stateName(set, sp, c.state)}`;
    case 'memory': return `Memory number ${c.cmp} ${num(c.value)}`;
    case 'mask': return `${maskName(set, c.mask)} ${c.cmp} ${num(c.value)}`;
  }
}

export function describeAction(set: AgentRuleSet, sp: number, a: RuleAction): string {
  switch (a.kind) {
    case 'turn': {
      const what = a.toward === 'trail' ? channelName(set, a.channel) : a.toward === 'point' ? `the point (${num(a.x ?? 0)}, ${num(a.y ?? 0)})` : a.toward === 'centre' ? 'the centre' : 'the mouse';
      return `turn ${a.away ? 'away from' : 'toward'} ${what} (${num(a.degrees)}°)`;
    }
    case 'wander': return `wander ±${num(a.degrees)}°`;
    case 'speed': return a.mode === 'set' ? `set speed ${num(a.value)}` : `accelerate ${num(a.value)} a second`;
    case 'trail': return `leave ${channelName(set, a.channel).replace(/^its own trail$/, 'its own trail')} ${num(a.amount)}${a.fade ? ` (fading with Memory ×${num(a.fade)})` : ''}`;
    case 'state': return `become ${stateName(set, sp, a.state)}`;
    case 'memory': return a.mode === 'set' ? `set Memory number to ${num(a.value)}` : a.mode === 'add' ? `add ${num(a.value)} to Memory number` : a.mode === 'perSecond' ? `count Memory number up ${num(a.value)} a second` : `set Memory number to a random 0–${num(a.value)}`;
    case 'stop': return 'stop';
    case 'stick': return 'stick (never move again)';
    case 'die': return 'die';
    case 'spawn': return `spawn a child (birth mark ${num(a.amount)})`;
    case 'bounce': return 'bounce (turn round)';
    case 'flow': return `${a.away ? 'go against' : 'follow'} the flow field (${num(a.degrees)}°)`;
    case 'align': return `align with the crowd (${num(a.degrees)}°)`;
  }
}

/** "When food trail ahead > 0.3 → turn toward food trail (25°)". */
export function describeRule(set: AgentRuleSet, sp: number, r: AgentRule): string {
  const when = r.when.length ? r.when.map(c => describeCondition(set, sp, c)).join(' and ') : 'always';
  const what = r.do.length ? r.do.map(a => describeAction(set, sp, a)).join(', ') : 'nothing';
  return `When ${when} → ${what}${r.stop ? '; stop after this rule' : ''}${r.off ? ' (off)' : ''}`;
}

// ── What a rule set needs ────────────────────────────────────────────────────

/** Channel keys a rule set reads with Sense ('own', '0'…'3'), in a fixed order. */
export function sensedChannels(set: AgentRuleSet): string[] {
  const used = new Set<string>();
  for (const s of set.species) for (const r of s.rules) {
    if (r.off) continue;
    for (const c of r.when) {
      if (c.kind === 'sense') used.add(String(c.channel));
      if (c.kind === 'near') used.add(String(c.species));
    }
    for (const a of r.do) {
      if (a.kind === 'turn' && a.toward === 'trail') used.add(String(a.channel ?? 'own'));
      if (a.kind === 'align') used.add('own');
    }
  }
  return ['own', '0', '1', '2', '3'].filter(k => used.has(k));
}

const acts = (set: AgentRuleSet) => set.species.flatMap(s => s.rules.filter(r => !r.off).flatMap(r => r.do));
const conds = (set: AgentRuleSet) => set.species.flatMap(s => s.rules.filter(r => !r.off).flatMap(r => r.when));
export const usesAction = (set: AgentRuleSet, kind: RuleAction['kind']) => acts(set).some(a => a.kind === kind);
export const usesCondition = (set: AgentRuleSet, kind: RuleCondition['kind']) => conds(set).some(c => c.kind === kind);
export const usesMask = (set: AgentRuleSet, m: number) => conds(set).some(c => c.kind === 'mask' && c.mask === m);
export const usesDeposit = (set: AgentRuleSet) => acts(set).some(a => a.kind === 'trail' || a.kind === 'spawn');
export const usesStop = (set: AgentRuleSet) => set.species.some(s => s.rules.some(r => !r.off && r.stop));

/** The ports a rule set puts on the group card: the trail (when anything smells it) and its masks. */
export function rulePorts(set: AgentRuleSet): Array<{ key: string; type: 'texture' | 'float'; label: string }> {
  const ports: Array<{ key: string; type: 'texture' | 'float'; label: string }> = [];
  if (sensedChannels(set).length) ports.push({ key: 'trail', type: 'texture', label: 'Trail' });
  set.masks.forEach((m, i) => { if (i < MAX_MASKS) ports.push({ key: `mask${i + 1}`, type: m.kind === 'texture' ? 'texture' : 'float', label: m.name || `Mask ${i + 1}` }); });
  return ports;
}

/** Things in a rule set that don't work (or mean less) in 3D, one plain sentence each. */
export function notesFor3d(set: AgentRuleSet): string[] {
  const out: string[] = [];
  if (sensedChannels(set).length) out.push('A 3D trail is a coarse volume (96 rows): set Sensors ahead to 0.1–0.2 and the Speed to 1–1.5, or the walkers can\'t escape their own trail and gather into balls.');
  if (acts(set).some(a => a.kind === 'turn' && (a.toward === 'point' || a.toward === 'mouse'))) out.push('Turn toward a point or the mouse: the point is on the picture\'s plane (z 0) in 3D.');
  if (set.masks.length) out.push('Masks are flat in 3D: read at the walker\'s x and y, the same through the depth.');
  if (usesAction(set, 'flow')) out.push('Follow a flow field: the curl noise is 3D in a 3D group.');
  if (usesAction(set, 'align')) out.push('Align with the crowd: a velocity trail in 3D is a volume of (x, y, z, count): the count is channel 4, not 3.');
  return out;
}

/** A rule set read from a saved graph, with anything missing filled in (never throws). */
export function normalizeRuleSet(raw: unknown): AgentRuleSet {
  const d = defaultRuleSet();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<AgentRuleSet>;
  const species = Array.isArray(r.species) && r.species.length ? r.species.slice(0, MAX_SPECIES).map((s, i) => ({
    name: typeof s?.name === 'string' ? s.name : defaultSpecies(i).name,
    speed: typeof s?.speed === 'number' && isFinite(s.speed) ? s.speed : 0.25,
    states: Array.isArray(s?.states) && s.states.length ? s.states.slice(0, MAX_STATES) : defaultSpecies(i).states,
    rules: Array.isArray(s?.rules) ? s.rules : [],
  })) : d.species;
  return {
    v: 1,
    channels: Array.isArray(r.channels) ? [0, 1, 2, 3].map(i => String(r.channels![i] ?? '')) : d.channels,
    masks: Array.isArray(r.masks) ? r.masks.slice(0, MAX_MASKS) : [],
    edges: r.edges === 'bounce' || r.edges === 'slide' ? r.edges : 'wrap',
    sensor: { distance: r.sensor?.distance ?? d.sensor.distance, angle: r.sensor?.angle ?? d.sensor.angle },
    flow: { size: r.flow?.size ?? 1, evolve: r.flow?.evolve ?? 0.15 },
    species,
  };
}
