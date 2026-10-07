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
/** Which walkers a neighbour reading counts (the Neighbours node's Which). */
export type NeighbourWho = 'all' | 'own' | 'others';
/** A force on a particle: down (or along Angle), a gusty wind, curl noise, toward a point or the mouse (negative pushes away). */
export type ForceField = 'gravity' | 'wind' | 'curl' | 'point' | 'mouse';

/**
 * What kind of walkers a rule set is for (docs/agent-rules.md "Kinds"): it picks which sections of
 * the editor, which conditions and which actions show, and the templates offered first. It changes
 * nothing the rules do: a rule set of one kind may use anything (a saved rule stays as it is).
 */
export type WalkerKind = 'trail' | 'particles' | 'flock' | 'ants' | 'swarm' | 'crowd';

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
  | { kind: 'mask'; mask: number; cmp: Cmp; value: number }
  /** How many walkers (everyone, its own kind or other kinds) are within `radius` (0: the rule set's view radius): a Neighbours node's Count. */
  | { kind: 'neighbours'; who: NeighbourWho; cmp: Cmp; count: number; radius?: number };

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
  | { kind: 'align'; degrees: number }
  /** Boids' separation: turn away from the walkers within `radius` (their Push: the closer, the harder), at most `degrees` a step. */
  | { kind: 'separate'; who: NeighbourWho; degrees: number; radius?: number }
  /** Boids' alignment: turn toward the way the walkers within `radius` go (their average velocity). */
  | { kind: 'match'; who: NeighbourWho; degrees: number; radius?: number }
  /** Boids' cohesion: turn toward the middle of the walkers within `radius`. */
  | { kind: 'cohere'; who: NeighbourWho; degrees: number; radius?: number }
  /** Slow down in a crowd: the speed falls from the species' Speed to nearly 0 as the walkers within `radius` reach `jam`. */
  | { kind: 'slow'; who: NeighbourWho; jam: number; radius?: number }
  /** Turn back inward when within `margin` of an edge of the picture (or the box), at most `degrees` a step. */
  | { kind: 'avoidEdges'; margin: number; degrees: number }
  /** Circle a point (or the centre, or the mouse) at `distance`, turning at most `degrees` a step; `cw` clockwise. */
  | { kind: 'orbit'; target: 'point' | 'centre' | 'mouse'; x?: number; y?: number; distance: number; degrees: number; cw?: boolean }
  /** A force (units a second²): it changes the velocity, so the heading and speed follow (particles). */
  | { kind: 'force'; field: ForceField; strength: number; angle?: number; x?: number; y?: number }
  /** Drag: loses this share of its speed a second (exponential: frame-rate independent). */
  | { kind: 'drag'; amount: number }
  /** Fade with age: its colour dims to black over `seconds` from birth (Draw agents' Colour by State or Agent). */
  | { kind: 'fade'; seconds: number };

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
  /** What kind of walkers (the editor's Kind): which sections, conditions and actions it shows. Missing: trail followers. */
  kind?: WalkerKind;
  /** Neighbour readings (flock, swarm, crowd): how far a walker looks (picture units) and how many it reads at most. */
  neighbours?: { radius: number; max: number };
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
  { kind: 'neighbours', label: 'neighbours within reach' },
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
  { kind: 'align', label: 'align with the crowd (via trail)' },
  { kind: 'separate', label: 'steer away from neighbours' },
  { kind: 'match', label: 'match neighbours\' heading' },
  { kind: 'cohere', label: 'move to their centre' },
  { kind: 'slow', label: 'slow down in a crowd' },
  { kind: 'avoidEdges', label: 'avoid edges' },
  { kind: 'orbit', label: 'orbit a point' },
  { kind: 'force', label: 'apply a force' },
  { kind: 'drag', label: 'drag (slow down)' },
  { kind: 'fade', label: 'fade with age' },
];

/** The rule set's view radius and how many neighbours a reading reads at most, when it doesn't say. */
export const DEFAULT_NEIGHBOURS = { radius: 0.05, max: 36 };

type CondKind = RuleCondition['kind'];
type ActKind = RuleAction['kind'];
/** Sections of the editor's left panel a kind shows. */
export type RulesSection = 'states' | 'channels' | 'masks' | 'sensors' | 'neighbours' | 'flow';

/**
 * The kinds (the editor's Kind choice): for each, its sections, the conditions and actions its
 * pickers offer (in this order), and its templates (the first is its starting point).
 */
export const WALKER_KINDS: Record<WalkerKind, { label: string; blurb: string; sections: RulesSection[]; conditions: CondKind[]; actions: ActKind[]; templates: string[] }> = {
  trail: {
    label: 'Trail followers', blurb: 'Walkers that smell a trail and lay one: slime mold, veins and networks.',
    sections: ['states', 'channels', 'masks', 'sensors', 'flow'],
    conditions: ['sense', 'near', 'chance', 'age', 'state', 'memory', 'mask'],
    actions: ['turn', 'wander', 'trail', 'speed', 'flow', 'bounce', 'state', 'memory', 'stop', 'stick', 'die', 'spawn', 'align'],
    templates: ['slime', 'dla', 'predatorPrey'],
  },
  particles: {
    label: 'Particles', blurb: 'No sensing: forces (gravity, wind, curl, toward or away from a point or the mouse) move them; they live, fade and are born again.',
    sections: ['masks', 'flow'],
    conditions: ['chance', 'age', 'mask', 'memory'],
    actions: ['force', 'drag', 'fade', 'bounce', 'speed', 'wander', 'die', 'trail', 'memory'],
    templates: ['particles'],
  },
  flock: {
    label: 'Flock (boids)', blurb: 'Birds that see each other: steer away from the nearest, match their heading, move to their centre, avoid the edges.',
    sections: ['neighbours', 'masks'],
    conditions: ['neighbours', 'chance', 'age', 'mask'],
    actions: ['separate', 'match', 'cohere', 'avoidEdges', 'wander', 'speed', 'turn', 'bounce', 'trail'],
    templates: ['boids'],
  },
  ants: {
    label: 'Ants / carriers', blurb: 'States and memory: searching and carrying, timers and counters, smells laid and followed, masks for food and the nest.',
    sections: ['states', 'channels', 'masks', 'sensors', 'flow'],
    conditions: ['state', 'memory', 'sense', 'near', 'mask', 'chance', 'age', 'neighbours'],
    actions: ['state', 'memory', 'turn', 'trail', 'wander', 'speed', 'bounce', 'stop', 'stick', 'die', 'spawn', 'flow'],
    templates: ['ants', 'termites', 'sir', 'fireflies'],
  },
  swarm: {
    label: 'Swarm / orbiters', blurb: 'Orbit a point (or the mouse) and flock loosely: keep apart, drift together.',
    sections: ['neighbours', 'states', 'flow'],
    conditions: ['neighbours', 'chance', 'age', 'state'],
    actions: ['orbit', 'separate', 'cohere', 'match', 'force', 'drag', 'wander', 'speed', 'state', 'trail'],
    templates: ['swarm'],
  },
  crowd: {
    label: 'Crowd', blurb: 'People walking to a goal (a point or a flow field), slowing and steering round each other by how many are near.',
    sections: ['neighbours', 'states', 'masks', 'flow'],
    conditions: ['neighbours', 'mask', 'chance', 'age', 'state'],
    actions: ['turn', 'flow', 'slow', 'separate', 'match', 'avoidEdges', 'wander', 'speed', 'state', 'stop', 'trail'],
    templates: ['crowd'],
  },
};
export const WALKER_KIND_KEYS = Object.keys(WALKER_KINDS) as WalkerKind[];
/** A rule set's kind (trail followers when it doesn't say). */
export const kindOf = (set: AgentRuleSet): WalkerKind => (set.kind && set.kind in WALKER_KINDS ? set.kind : 'trail');
/** The conditions a kind's "+ and…" picker offers (always is the empty When). */
export const conditionKindsFor = (kind: WalkerKind) => WALKER_KINDS[kind].conditions.map(k => CONDITION_KINDS.find(c => c.kind === k)!);
/** The actions a kind's "+ do…" picker offers. */
export const actionKindsFor = (kind: WalkerKind) => WALKER_KINDS[kind].actions.map(k => ACTION_KINDS.find(a => a.kind === k)!);
/** Does the editor show this section for the rule set: its kind's, or one it uses anyway (a saved rule keeps its settings in view)? */
export function showsSection(set: AgentRuleSet, section: RulesSection): boolean {
  if (WALKER_KINDS[kindOf(set)].sections.includes(section)) return true;
  switch (section) {
    case 'states': return set.species.some(s => s.states.length > 1);
    case 'channels': return set.channels.some(c => c.trim()) || sensedChannels(set).length > 0;
    case 'masks': return set.masks.length > 0;
    case 'sensors': return sensedChannels(set).length > 0;
    case 'neighbours': return neighbourReads(set).length > 0;
    case 'flow': return usesFlow(set);
  }
}

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
    case 'neighbours': return { kind, who: 'all', cmp: '>', count: 8 };
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
    case 'separate': return { kind, who: 'all', degrees: 12 };
    case 'match': return { kind, who: 'all', degrees: 6 };
    case 'cohere': return { kind, who: 'all', degrees: 3 };
    case 'slow': return { kind, who: 'all', jam: 20 };
    case 'avoidEdges': return { kind, margin: 0.1, degrees: 12 };
    case 'orbit': return { kind, target: 'centre', distance: 0.5, degrees: 8 };
    case 'force': return { kind, field: 'gravity', strength: 0.5, angle: -90 };
    case 'drag': return { kind, amount: 0.5 };
    case 'fade': return { kind, seconds: 3 };
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
    case 'neighbours': return `${c.cmp === '>' ? 'more' : 'fewer'} than ${num(c.count)} ${WHO[c.who]} within ${num(reach(set, c.radius))}`;
  }
}

const WHO: Record<NeighbourWho, string> = { all: 'neighbours', own: 'of its own kind', others: 'of other kinds' };
const WHOSE: Record<NeighbourWho, string> = { all: 'neighbours', own: 'its own kind', others: 'other kinds' };
/** A neighbour reading's radius: its own, or the rule set's view radius. */
export const reach = (set: AgentRuleSet, r: number | undefined) => (r && r > 0 ? r : (set.neighbours?.radius ?? DEFAULT_NEIGHBOURS.radius));
const FORCE: Record<ForceField, string> = { gravity: 'gravity', wind: 'wind', curl: 'curl noise', point: 'a pull toward', mouse: 'a pull toward the mouse' };

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
    case 'separate': return `steer away from ${WHOSE[a.who]} within ${num(reach(set, a.radius))} (${num(a.degrees)}°)`;
    case 'match': return `match the heading of ${WHOSE[a.who]} within ${num(reach(set, a.radius))} (${num(a.degrees)}°)`;
    case 'cohere': return `move to the centre of ${WHOSE[a.who]} within ${num(reach(set, a.radius))} (${num(a.degrees)}°)`;
    case 'slow': return `slow down as ${WHOSE[a.who]} within ${num(reach(set, a.radius))} reach ${num(a.jam)}`;
    case 'avoidEdges': return `avoid the edges (within ${num(a.margin)}, ${num(a.degrees)}°)`;
    case 'orbit': {
      const what = a.target === 'point' ? `the point (${num(a.x ?? 0)}, ${num(a.y ?? 0)})` : a.target === 'mouse' ? 'the mouse' : 'the centre';
      return `orbit ${what} at ${num(a.distance)}${a.cw ? ' clockwise' : ''} (${num(a.degrees)}°)`;
    }
    case 'force': {
      const where = a.field === 'point' ? `the point (${num(a.x ?? 0)}, ${num(a.y ?? 0)})` : 'the mouse';
      const what = a.field === 'point' || a.field === 'mouse' ? (a.strength < 0 ? `a push away from ${where}` : `a pull toward ${where}`) : FORCE[a.field];
      const angle = a.field === 'gravity' || a.field === 'wind' ? ` at ${num(a.angle ?? (a.field === 'gravity' ? -90 : 0))}°` : '';
      return `apply ${what} ${num(Math.abs(a.strength))}${angle}`;
    }
    case 'drag': return `drag ${num(a.amount)} a second`;
    case 'fade': return `fade with age over ${num(a.seconds)} s`;
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
  if (neighbourReads(set).length) out.push('Neighbours in 3D look round a ball (the 27 grid cells round it), and the grid is coarser (at most 48 cells a side): a radius under about 0.05 then reads more cells\' worth than it needs.');
  if (usesAction(set, 'orbit')) out.push('Orbit: they circle the point round an axis through it square to the picture, at any depth.');
  if (acts(set).some(a => a.kind === 'force' && (a.field === 'point' || a.field === 'mouse'))) out.push('A pull toward a point or the mouse: the point is on the picture\'s plane (z 0) in 3D.');
  return out;
}

/** Does a rule set read the flow field (follow a flow field, or curl noise as a force)? */
export const usesFlow = (set: AgentRuleSet) => usesAction(set, 'flow') || acts(set).some(a => a.kind === 'force' && a.field === 'curl');
/** Does a rule set fade its walkers with age (its colour times a brightness the rules carry)? */
export const usesFade = (set: AgentRuleSet) => usesAction(set, 'fade');

/**
 * The neighbour readings a rule set needs: one Neighbours node per (which walkers, radius), in the
 * order they are first used (species by species, rule by rule). Every neighbour condition and
 * action with that pair reads the same node.
 */
export function neighbourReads(set: AgentRuleSet): Array<{ key: string; who: NeighbourWho; radius: number }> {
  const out: Array<{ key: string; who: NeighbourWho; radius: number }> = [];
  const add = (who: NeighbourWho, r: number | undefined) => {
    const radius = reach(set, r);
    if (!out.some(x => x.who === who && x.radius === radius)) out.push({ key: `${who}${out.length + 1}`, who, radius });
  };
  for (const s of set.species) for (const r of s.rules) {
    if (r.off) continue;
    for (const c of r.when) if (c.kind === 'neighbours') add(c.who, c.radius);
    for (const a of r.do) if (a.kind === 'separate' || a.kind === 'match' || a.kind === 'cohere' || a.kind === 'slow') add(a.who, a.radius);
  }
  return out;
}
/** The reading (Neighbours node) a neighbour condition or action uses. */
export const neighbourReadOf = (set: AgentRuleSet, who: NeighbourWho, r: number | undefined) => {
  const radius = reach(set, r);
  return neighbourReads(set).find(x => x.who === who && x.radius === radius)!;
};

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
  const nb = r.neighbours && typeof r.neighbours === 'object' ? r.neighbours : null;
  return {
    v: 1,
    ...(typeof r.kind === 'string' && r.kind in WALKER_KINDS ? { kind: r.kind } : {}),
    ...(nb ? { neighbours: { radius: Number(nb.radius) > 0 ? Number(nb.radius) : DEFAULT_NEIGHBOURS.radius, max: Number(nb.max) > 0 ? Number(nb.max) : DEFAULT_NEIGHBOURS.max } } : {}),
    channels: Array.isArray(r.channels) ? [0, 1, 2, 3].map(i => String(r.channels![i] ?? '')) : d.channels,
    masks: Array.isArray(r.masks) ? r.masks.slice(0, MAX_MASKS) : [],
    edges: r.edges === 'bounce' || r.edges === 'slide' ? r.edges : 'wrap',
    sensor: { distance: r.sensor?.distance ?? d.sensor.distance, angle: r.sensor?.angle ?? d.sensor.angle },
    flow: { size: r.flow?.size ?? 1, evolve: r.flow?.evolve ?? 0.15 },
    species,
  };
}
