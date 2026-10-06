/**
 * templates.ts — the Agent Rules templates (docs/agent-rules.md): each a rule set of a few
 * readable lines, and the setup round it (Emit, the rules group, Deposit, Trail, the picture,
 * Draw agents), every node with a note. The editor's Templates menu replaces a group's rules
 * with a template's; the "Agents: rules" examples are these setups.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { applyRulesToGroup } from './apply';
import { rulesGroupNote } from './generate';
import type { AgentRuleSet, AgentSpeciesRules, RuleCondition } from './spec';

type Wire = [string, string];
type RGB = [number, number, number];

export interface RulesTemplate {
  key: string;
  label: string;
  /** One sentence for the menu and the example's description. */
  blurb: string;
  set: () => AgentRuleSet;
}

const base = (o: Partial<AgentRuleSet> & { species: AgentSpeciesRules[] }): AgentRuleSet => ({
  v: 1, channels: ['', '', '', ''], masks: [], edges: 'wrap', sensor: { distance: 0.03, angle: 40 }, flow: { size: 1, evolve: 0.15 }, ...o,
});

// ── The rule sets ────────────────────────────────────────────────────────────

const slime = (): AgentRuleSet => base({
  sensor: { distance: 0.035, angle: 22.5 },
  species: [{
    name: 'Slime', speed: 0.22, states: [{ name: 'walking', colour: [1, 0.85, 0.5] }],
    rules: [{ when: [{ kind: 'always' }], do: [
      { kind: 'turn', toward: 'trail', channel: 'own', degrees: 45 },
      { kind: 'wander', degrees: 7 },
      { kind: 'trail', channel: 'own', amount: 1 },
    ] }],
  }],
});

const ants = (): AgentRuleSet => base({
  channels: ['home', 'food', '', ''],
  masks: [{ name: 'Food', kind: 'number' }, { name: 'Nest', kind: 'number' }],
  edges: 'bounce',
  sensor: { distance: 0.04, angle: 35 },
  species: [{
    name: 'Ants', speed: 0.3,
    states: [{ name: 'searching', colour: [0.62, 0.42, 0.3] }, { name: 'carrying', colour: [1, 0.86, 0.25] }],
    rules: [
      { when: [{ kind: 'always' }], do: [{ kind: 'memory', mode: 'perSecond', value: 1 }, { kind: 'wander', degrees: 5 }] },
      { when: [{ kind: 'state', state: 0 }, { kind: 'mask', mask: 0, cmp: '>', value: 0.5 }], do: [{ kind: 'state', state: 1 }, { kind: 'bounce' }, { kind: 'memory', mode: 'set', value: 0 }], stop: true },
      { when: [{ kind: 'state', state: 1 }, { kind: 'mask', mask: 1, cmp: '>', value: 0.5 }], do: [{ kind: 'state', state: 0 }, { kind: 'bounce' }, { kind: 'memory', mode: 'set', value: 0 }], stop: true },
      { when: [{ kind: 'state', state: 0 }], do: [{ kind: 'trail', channel: 0, amount: 1, fade: 0.15 }] },
      { when: [{ kind: 'state', state: 0 }, { kind: 'sense', channel: 1, where: 'any', cmp: '>', value: 0.05 }], do: [{ kind: 'turn', toward: 'trail', channel: 1, degrees: 20 }] },
      { when: [{ kind: 'state', state: 1 }], do: [{ kind: 'trail', channel: 1, amount: 1, fade: 0.15 }, { kind: 'turn', toward: 'trail', channel: 0, degrees: 20 }, { kind: 'turn', toward: 'point', x: -0.15, y: -0.1, degrees: 2 }] },
    ],
  }],
});

const boids = (): AgentRuleSet => base({
  channels: ['flow x', 'flow y', 'birds', ''],
  sensor: { distance: 0.06, angle: 30 },
  species: [{
    name: 'Birds', speed: 0.4, states: [{ name: 'flying', colour: [0.75, 0.9, 1] }],
    rules: [
      { when: [{ kind: 'sense', channel: 2, where: 'here', cmp: '>', value: 16 }], do: [{ kind: 'turn', toward: 'trail', channel: 2, away: true, degrees: 15 }], stop: true },
      { when: [{ kind: 'always' }], do: [
        { kind: 'align', degrees: 10 },
        { kind: 'turn', toward: 'trail', channel: 2, degrees: 3 },
        { kind: 'wander', degrees: 3 },
      ] },
    ],
  }],
});

const predatorPrey = (): AgentRuleSet => base({
  channels: ['prey', 'predators', '', ''],
  sensor: { distance: 0.06, angle: 35 },
  species: [
    {
      name: 'Prey', speed: 0.2, states: [{ name: 'grazing', colour: [0.45, 1, 0.55] }, { name: 'fleeing', colour: [1, 1, 0.6] }],
      rules: [
        { when: [{ kind: 'sense', channel: 1, where: 'here', cmp: '>', value: 3 }], do: [{ kind: 'die' }], stop: true },
        { when: [{ kind: 'near', species: 1, value: 1 }], do: [{ kind: 'turn', toward: 'trail', channel: 1, away: true, degrees: 35 }, { kind: 'speed', mode: 'set', value: 0.42 }, { kind: 'state', state: 1 }, { kind: 'trail', channel: 0, amount: 1 }], stop: true },
        { when: [{ kind: 'always' }], do: [{ kind: 'state', state: 0 }, { kind: 'speed', mode: 'set', value: 0.2 }, { kind: 'turn', toward: 'trail', channel: 0, degrees: 20 }, { kind: 'wander', degrees: 10 }, { kind: 'trail', channel: 0, amount: 1 }] },
      ],
    },
    {
      name: 'Predators', speed: 0.3, states: [{ name: 'hunting', colour: [1, 0.3, 0.25] }],
      rules: [
        { when: [{ kind: 'always' }], do: [{ kind: 'turn', toward: 'trail', channel: 0, degrees: 30 }, { kind: 'wander', degrees: 6 }, { kind: 'trail', channel: 1, amount: 1 }] },
      ],
    },
  ],
});

const sir = (): AgentRuleSet => base({
  channels: ['germs', '', '', ''],
  sensor: { distance: 0.02, angle: 40 },
  species: [{
    name: 'People', speed: 0.12,
    states: [{ name: 'healthy', colour: [0.55, 0.75, 1] }, { name: 'sick', colour: [1, 0.25, 0.2] }, { name: 'recovered', colour: [0.35, 0.95, 0.45] }],
    rules: [
      { when: [{ kind: 'always' }], do: [{ kind: 'wander', degrees: 30 }] },
      { when: [{ kind: 'state', state: 0 }, { kind: 'age', cmp: '<', seconds: 0.3 }, { kind: 'chance', perSecond: 0.002 }], do: [{ kind: 'state', state: 1 }, { kind: 'memory', mode: 'set', value: 0 }] },
      { when: [{ kind: 'state', state: 0 }, { kind: 'sense', channel: 0, where: 'here', cmp: '>', value: 0.3 }, { kind: 'chance', perSecond: 0.6 }], do: [{ kind: 'state', state: 1 }, { kind: 'memory', mode: 'set', value: 0 }] },
      { when: [{ kind: 'state', state: 1 }], do: [{ kind: 'memory', mode: 'perSecond', value: 1 }, { kind: 'trail', channel: 0, amount: 1 }] },
      { when: [{ kind: 'state', state: 1 }, { kind: 'memory', cmp: '>', value: 5 }], do: [{ kind: 'state', state: 2 }, { kind: 'memory', mode: 'set', value: 0 }] },
      { when: [{ kind: 'state', state: 2 }], do: [{ kind: 'memory', mode: 'perSecond', value: 1 }] },
      { when: [{ kind: 'state', state: 2 }, { kind: 'memory', cmp: '>', value: 20 }], do: [{ kind: 'state', state: 0 }, { kind: 'memory', mode: 'set', value: 0 }] },
    ],
  }],
});

/**
 * Termites, tuned (2026-10): one termite in eight lives and each lays 8 chips, so termites are
 * sparse (two seldom share a pixel) and chips plentiful. The rules only ever take a chip from a
 * pixel that surely holds one and lay one where there surely is none, because the trail can't go
 * below 0 (a −1 on an empty pixel would be lost, making a chip from nothing): the trail is read
 * blended over the 4 nearest pixels, and a walker's own pixel weighs at least a quarter of it, so
 * "here > 0.76" means its pixel has a chip and "here < 0.24" means it has none (with no pixel above
 * 1). Acting on a dice roll while waiting in place makes two termites in one pixel seldom act in
 * the same step. Empty termites steer toward chips and slow down near them.
 */
const termites = (): AgentRuleSet => {
  const age0: RuleCondition = { kind: 'age', cmp: '<', seconds: 0.02 };
  const ready: RuleCondition = { kind: 'memory', cmp: '>', value: 0.3 };
  const here = (cmp: '>' | '<', value: number): RuleCondition => ({ kind: 'sense', channel: 0, where: 'here', cmp, value });
  const st = (state: number): RuleCondition => ({ kind: 'state', state });
  const onChip = [st(1), here('>', 0.76), ready];
  const besidePile: RuleCondition[] = [st(2), { kind: 'sense', channel: 0, where: 'any', cmp: '>', value: 0.5 }, here('<', 0.24), ready];
  const dice: RuleCondition = { kind: 'chance', perSecond: 0.9 };
  return base({
    channels: ['wood chips', '', '', ''],
    sensor: { distance: 0.008, angle: 45 },
    species: [{
      name: 'Termites', speed: 0.25,
      states: [{ name: 'new', colour: [0.75, 0.75, 0.8] }, { name: 'empty', colour: [0.75, 0.75, 0.8] }, { name: 'carrying', colour: [1, 0.6, 0.2] }],
      rules: [
        { when: [age0], do: [{ kind: 'memory', mode: 'random', value: 8 }] },
        { when: [age0, { kind: 'memory', cmp: '>', value: 1 }], do: [{ kind: 'die' }], stop: true },
        // New: lay a chip on each empty spot it stands on, counting in Memory (it starts at 0–1), 8 in all.
        { when: [st(0), here('<', 0.24)], do: [{ kind: 'trail', channel: 0, amount: 1 }, { kind: 'memory', mode: 'add', value: 1 }, { kind: 'stop' }], stop: true },
        { when: [st(0), { kind: 'memory', cmp: '>', value: 8.3 }], do: [{ kind: 'state', state: 1 }, { kind: 'memory', mode: 'set', value: 0 }] },
        { when: [{ kind: 'always' }], do: [{ kind: 'memory', mode: 'perSecond', value: 1 }, { kind: 'wander', degrees: 30 }, { kind: 'speed', mode: 'set', value: 0.25 }] },
        { when: [st(1), ready], do: [{ kind: 'turn', toward: 'trail', channel: 0, degrees: 40 }] },
        { when: [st(1), ready, here('>', 0.3)], do: [{ kind: 'speed', mode: 'set', value: 0.08 }] },
        { when: onChip, do: [{ kind: 'stop' }] },
        { when: besidePile, do: [{ kind: 'stop' }] },
        { when: [...onChip, dice], do: [{ kind: 'trail', channel: 0, amount: -1 }, { kind: 'state', state: 2 }, { kind: 'stop' }, { kind: 'bounce' }, { kind: 'memory', mode: 'set', value: 0 }], stop: true },
        { when: [...besidePile, dice], do: [{ kind: 'trail', channel: 0, amount: 1 }, { kind: 'state', state: 1 }, { kind: 'stop' }, { kind: 'bounce' }, { kind: 'memory', mode: 'set', value: 0 }], stop: true },
      ],
    }],
  });
};

/**
 * Fireflies, tuned (2026-10) for one swarm-wide flash: sensors far out (0.5 ahead, ±90°), so a
 * flash is seen across a big neighbourhood and the light sweeps the picture in a few steps; a
 * refractory first 60% of the cycle; a 1.5 s cycle and a short 0.12 s flash.
 */
const fireflies = (): AgentRuleSet => base({
  channels: ['light', '', '', ''],
  sensor: { distance: 0.5, angle: 90 },
  species: [{
    name: 'Fireflies', speed: 0.05,
    states: [{ name: 'dark', colour: [0.12, 0.25, 0.1] }, { name: 'flash', colour: [1, 0.95, 0.4] }],
    rules: [
      { when: [{ kind: 'age', cmp: '<', seconds: 0.02 }], do: [{ kind: 'memory', mode: 'random', value: 10 }] },
      { when: [{ kind: 'age', cmp: '<', seconds: 0.02 }, { kind: 'memory', cmp: '>', value: 1 }], do: [{ kind: 'die' }], stop: true },
      { when: [{ kind: 'always' }], do: [{ kind: 'memory', mode: 'perSecond', value: 0.667 }, { kind: 'wander', degrees: 25 }] },
      { when: [{ kind: 'state', state: 0 }, { kind: 'sense', channel: 0, where: 'any', cmp: '>', value: 0.5 }, { kind: 'memory', cmp: '>', value: 0.6 }], do: [{ kind: 'state', state: 1 }, { kind: 'memory', mode: 'set', value: 0 }] },
      { when: [{ kind: 'state', state: 0 }, { kind: 'memory', cmp: '>', value: 1 }], do: [{ kind: 'state', state: 1 }, { kind: 'memory', mode: 'set', value: 0 }] },
      { when: [{ kind: 'state', state: 1 }], do: [{ kind: 'trail', channel: 0, amount: 1 }] },
      { when: [{ kind: 'state', state: 1 }, { kind: 'memory', cmp: '>', value: 0.08 }], do: [{ kind: 'state', state: 0 }] },
    ],
  }],
});

const dla = (): AgentRuleSet => base({
  channels: ['crystal', '', '', ''],
  masks: [{ name: 'Seed', kind: 'number' }],
  sensor: { distance: 0.006, angle: 60 },
  species: [{
    name: 'Particles', speed: 0.3,
    states: [{ name: 'free', colour: [0.3, 0.45, 0.8] }, { name: 'stuck', colour: [0.9, 0.97, 1] }],
    rules: [
      { when: [{ kind: 'state', state: 0 }, { kind: 'mask', mask: 0, cmp: '>', value: 0.5 }], do: [{ kind: 'stick' }, { kind: 'state', state: 1 }], stop: true },
      { when: [{ kind: 'state', state: 0 }, { kind: 'sense', channel: 0, where: 'any', cmp: '>', value: 0.3 }], do: [{ kind: 'stick' }, { kind: 'state', state: 1 }], stop: true },
      { when: [{ kind: 'state', state: 1 }], do: [{ kind: 'trail', channel: 0, amount: 1 }], stop: true },
      { when: [{ kind: 'always' }], do: [{ kind: 'wander', degrees: 60 }] },
    ],
  }],
});

export const RULES_TEMPLATES: RulesTemplate[] = [
  { key: 'slime', label: 'Slime mold', blurb: 'Every walker turns toward the trail it smells, wobbles and leaves trail: veins and networks.', set: slime },
  { key: 'ants', label: 'Ants with food', blurb: 'Searching ants follow the food smell and lay the home smell; carrying ants the other way round; they turn at the food and the nest.', set: ants },
  { key: 'boids', label: 'Boids-like (via trail)', blurb: 'Birds align with the crowd\'s flow (a velocity trail), drift toward where the birds are and away where they are packed: flocks gather and wheel.', set: boids },
  { key: 'predatorPrey', label: 'Predator & prey', blurb: 'Prey graze along their own trail and flee the predators\' smell; predators chase the prey\'s; prey caught die and are born again.', set: predatorPrey },
  { key: 'sir', label: 'Infection (SIR)', blurb: 'Healthy, sick, recovered: the sick leave germs, the healthy who walk through them may fall sick, the sick recover, immunity wanes.', set: sir },
  { key: 'termites', label: 'Termites', blurb: 'Termites pick up wood chips and drop them beside other chips: within half a minute the scattered chips gather into piles.', set: termites },
  { key: 'fireflies', label: 'Fireflies', blurb: 'Each firefly flashes on its own clock; one past 60% of its cycle that sees a flash (its sensors look far out) flashes at once, so within seconds the whole swarm flashes together.', set: fireflies },
  { key: 'dla', label: 'DLA growth', blurb: 'Random walkers stick when they touch the crystal (or the seed) and become part of it: branching frost.', set: dla },
];

export const rulesTemplate = (key: string) => RULES_TEMPLATES.find(t => t.key === key);

// ── The setups round them (the examples) ─────────────────────────────────────

const note = (lines: string[]) => ({ __comment: lines.filter(Boolean).join('\n') });

/** An Expression Block whose note explains every named line ("name: …") and its result. */
function look(id: string, x: number, y: number, label: string, inputs: Array<[string, 'float' | 'vec2' | 'vec3' | 'vec4', Wire]>, lines: Array<[string, string, string]>, result: string, out: 'float' | 'vec3', intro: string, resultWhy: string): GraphNode {
  const node = n('exprNode', id, x, y, {
    label, inputs: inputs.map(([name, type]) => ({ name, type, slider: null })), outputType: out,
    lines: lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })), result, expr: result,
    ...note([intro, ...lines.map(([lhs, , why]) => `${lhs.split(/\s+/).pop()}: ${why}`), `result: ${resultWhy}`]),
  });
  node.inputs = Object.fromEntries(inputs.map(([name, type, from]) => [name, { type, label: `${name} (${type})`, connection: { nodeId: from[0], outputKey: from[1] } }]));
  node.outputs = { result: { type: out, label: `Result (${out})` } };
  return node;
}

interface SetupOpts {
  p: string; set: AgentRuleSet; label: string; tier: string; steps: number; preroll: number; groupWhy: string[];
  emits: Array<Record<string, unknown>>;
  depositAmount: number; depositWhy: string; depositWhat?: string; depositSize?: number;
  trail: Record<string, unknown>; trailWhy: string[];
  masks?: Array<{ port: string; node: GraphNode; out: Wire }>;
  picture: (trail: string) => { nodes: GraphNode[]; out: Wire };
  draw?: Record<string, unknown>;
  nodeVersion?: string;
}

/** Emit(s) → the rules group → Deposit → Trail → the picture → Draw agents → Output. */
function setup(x: number, y: number, o: SetupOpts, withOutput: boolean): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const { p } = o;
  const gid = `${p}Agents`, trailId = `${p}Trail`, depId = `${p}Deposit`, drawId = `${p}Draw`;
  const emits = o.emits.map((e, i) => {
    const id = `${p}Emit${i ? i + 1 : ''}`;
    const node = n('agentEmit', id, X(0), Y(-900 * (o.emits.length - 1 - i)), e);
    return node;
  });
  for (let i = emits.length - 1; i > 0; i--) emits[i].inputs.also = { ...emits[i].inputs.also, connection: { nodeId: emits[i - 1].id, outputKey: 'emitter' } };
  const lastEmit = emits[emits.length - 1].id;
  let group = n('agentsGroup', gid, X(420), Y(0), {
    label: o.label, tier: o.tier, species: String(o.set.species.length), stepsPerFrame: o.steps, seed: 1, preroll: o.preroll,
    subgraph: { nodes: [], inputPorts: [], outputPorts: [] },
  }, { emit: [lastEmit, 'emitter'] });
  group = applyRulesToGroup(group, o.set);
  group.params.__comment = [
    rulesGroupNote(o.set),
    ...o.groupWhy,
    o.nodeVersion ? `See the node version: Examples → ${o.nodeVersion}, the same idea built from raw nodes.` : '',
  ].filter(Boolean).join('\n');
  const wire = (key: string, from: Wire) => { if (group.inputs[key]) group.inputs[key] = { ...group.inputs[key], connection: { nodeId: from[0], outputKey: from[1] } }; };
  wire('trail', [trailId, 'texture']);
  for (const m of o.masks ?? []) wire(m.port, m.out);
  const deposit = n('agentDeposit', depId, X(840), Y(0), { amount: o.depositAmount, size: o.depositSize ?? 1, ...(o.depositWhat ? { what: o.depositWhat } : {}), ...note([o.depositWhy]) }, { agents: [gid, 'agents'] });
  const trail = n('trailField', trailId, X(1260), Y(0), { ...o.trail, ...note(o.trailWhy) }, { deposit: [depId, 'deposit'] });
  const pic = o.picture(trailId);
  const nodes: GraphNode[] = [...emits, ...(o.masks ?? []).map(m => m.node), group, deposit, trail, ...pic.nodes];
  let out = pic.out;
  if (o.draw) {
    nodes.push(n('drawAgents', drawId, X(2100), Y(0), o.draw, { agents: [gid, 'agents'], over: pic.out }));
    out = [drawId, 'color'];
  }
  if (withOutput) nodes.push(n('output', `${p}Output`, X(2520), Y(0), { ...note(['Output: the picture, the walkers drawn over what they leave behind.']) }, { color: out }));
  return nodes;
}

const palette = (id: string, x: number, y: number, trail: string, stops: RGB[], why: string[]) => n('stopPalette', id, x, y, {
  stops: String(stops.length), wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
  ...Object.fromEntries(stops.map((c, i) => [`color${i}`, c])),
  ...note(why),
}, { value: [trail, 'amount'] });

/** The setup of template `key` at (x, y), ids prefixed by `p` (an example: its nodes, with an Output). */
export function rulesTemplateNodes(key: string, p: string, x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  switch (key) {
    case 'slime': return setup(x, y, {
      p, set: slime(), label: 'Slime mold (rules)', tier: '256k', steps: 2, preroll: 0, nodeVersion: 'Simulation → Slime mold',
      groupWhy: ['One rule: always turn toward the trail (the slime-mold paper\'s rule: straight on when it is strongest ahead), wobble a little, and leave trail. That feedback grows the veins.', 'Try: Edit rules and set the turn to 20° for long straight veins, or the wander to 30° for a restless foam.'],
      emits: [{ mode: 'fill', shape: 'disc', heading: 'outward', x: 0, y: 0, size: 0.15, life: 0, ...note(['Emit: all the walkers are born at once in a small disc in the middle, facing outward, so they burst out as a fan of veins.']) }],
      depositAmount: 4, depositWhy: 'Deposit: every walker leaves what its rule says (1 in its own channel), times 4 (256k walkers leave as much as a million would at 1).',
      trail: { resolution: '1024', diffuse: 1, halfLife: 0.05, edges: 'wrap', gain: 0.04 },
      trailWhy: ['Trail field: 1024 rows; it spreads (Diffuse 1) and fades fast (half-life 0.05 s). Its Image goes back into the group, where the rules\' Sense smells it.'],
      picture: t => ({ nodes: [palette(`${p}Colour`, X(1680), Y(0), t, [[0, 0, 0], [0.16, 0.05, 0.01], [0.75, 0.38, 0.05], [1, 0.82, 0.32], [1, 0.98, 0.85]], ['Stops Palette: the trail\'s Amount as colour, black through amber to pale gold.'])], out: [`${p}Colour`, 'color'] }),
    }, withOutput);
    case 'ants': {
      const uv = n('uv', `${p}Uv`, X(-420), Y(420), { ...note(['UV: where each pixel is (inside the group: where each ant is), for Food and Nest.']) });
      const food = look(`${p}Food`, X(0), Y(420), 'Food', [['uv', 'vec2', [`${p}Uv`, 'uv']]], [
        ['float pile1', 'length(uv - vec2(1.2, 0.55)) - 0.08', 'the distance to a food pile at the top right (below 0 inside).'],
        ['float pile2', 'length(uv - vec2(0.95, -0.68)) - 0.07', 'one at the bottom right.'],
        ['float pile3', 'length(uv - vec2(-1.05, 0.45)) - 0.08', 'one at the left.'],
      ], 'step(min(pile1, min(pile2, pile3)), 0.0)', 'float', 'Food (an Expression Block): 1 inside a food pile, 0 elsewhere. Wired into the group\'s Food mask: the rule "searching and Food > 0.5" picks food up.', '1 inside any pile.');
      const nest = look(`${p}Nest`, X(0), Y(760), 'Nest', [['uv', 'vec2', [`${p}Uv`, 'uv']]], [
        ['float d', 'length(uv - vec2(-0.15, -0.1)) - 0.07', 'the distance to the nest, a circle near the middle (below 0 inside).'],
      ], 'step(d, 0.0)', 'float', 'Nest (an Expression Block): 1 inside the nest. Wired into the group\'s Nest mask: "carrying and Nest > 0.5" drops the food at home.', '1 inside the nest.');
      return [uv, ...setup(x, y, {
        p, set: ants(), label: 'Ants (rules)', tier: '256k', steps: 3, preroll: 20, nodeVersion: 'Simulation → Ants',
        groupWhy: ['States: searching and carrying (Memory x). The Memory number counts the seconds since it left the nest or the food, so its marks fade with distance (leave trail … fading with Memory) and the smell leads back to its source.', 'Try: change the fade to 0.05 for roads that reach further; take out the last rule\'s turn toward the nest to watch them find home by smell alone.'],
        emits: [{ mode: 'respawn', shape: 'disc', heading: 'outward', x: -0.15, y: -0.1, size: 0.06, life: 30, lifeVar: 0.5, ...note(['Emit: ants are born in the nest, searching, facing outward; each lives 30 s ± half and is born again in the nest (Keep full).']) }],
        depositAmount: 1, depositWhy: 'Deposit: each ant leaves what its rules say: the home smell (channel 1) while searching, the food smell (channel 2) while carrying.',
        trail: { resolution: '512', diffuse: 0.12, halfLife: 2.5, edges: 'clamp', gain: 0.5 },
        trailWhy: ['Trail field: the two smells, 512 rows; they spread a little and last (half-life 2.5 s), so a road outlives the ants that made it.'],
        masks: [{ port: 'mask1', node: food, out: [`${p}Food`, 'result'] }, { port: 'mask2', node: nest, out: [`${p}Nest`, 'result'] }],
        picture: t => ({ nodes: [look(`${p}Ground`, X(1680), Y(420), 'Ground', [['ch', 'vec4', [t, 'channels']], ['food', 'float', [`${p}Food`, 'result']], ['nest', 'float', [`${p}Nest`, 'result']]], [
          ['vec3 soil', 'vec3(0.085, 0.07, 0.055)', 'dark earth.'],
          ['float home', '(1.0 - exp(-max(ch.r, 0.0) * 0.08)) * 0.5', 'the home smell (channel 1), shown blue.'],
          ['float smell', '1.0 - exp(-max(ch.g, 0.0) * 0.03)', 'the food smell (channel 2), shown orange: the roads.'],
        ], 'mix(mix(soil + vec3(0.12, 0.3, 0.6) * home + vec3(1.0, 0.55, 0.12) * smell, vec3(0.42, 0.24, 0.12), nest), vec3(0.35, 0.85, 0.3), food)', 'vec3',
        'Ground (an Expression Block): the picture under the ants.', 'the smells over the soil, the nest brown and the food green on top.')], out: [`${p}Ground`, 'result'] }),
        draw: { style: 'points', colorBy: 'state', palette: 'ab', size: 1, brightness: 0.35, scaleBy: 'walker', fade: 'off', lights: '0', ...note(['Draw agents, Colour by State: each ant in its state\'s colour (brown searching, gold carrying), from the rules.']) },
      }, withOutput)];
    }
    case 'boids': return setup(x, y, {
      p, set: boids(), label: 'Boids (rules)', tier: '256k', steps: 2, preroll: 6, nodeVersion: 'Simulation → Boids',
      groupWhy: ['Boids in two rules, through a velocity trail (the Deposit leaves each bird\'s velocity and a count): too crowded (more than 16 birds\' worth here) → turn away from the crowd (separation); otherwise → align with the way the crowd round it flies (alignment), turn a little toward where the birds are (cohesion) and wobble.', 'The trail\'s channels: 1 and 2 the crowd\'s flow (x, y), 3 the count of birds. The node version builds the same three forces from Sense, Sample and an Expression Block.'],
      emits: [{ mode: 'fill', shape: 'screen', heading: 'random', life: 0, ...note(['Emit: birds everywhere at once, facing anywhere. The flocks sort themselves out within seconds.']) }],
      depositWhat: 'velocity',
      depositAmount: 1, depositWhy: 'Deposit, What: Velocity: each bird leaves its velocity (channels 1 and 2) and a count (channel 3) instead of a smell: the crowd\'s flow, which the rules\' "align with the crowd" reads.',
      trail: { resolution: '512', diffuse: 1, halfLife: 0.08, edges: 'wrap', gain: 0.04, kernel: '5' },
      trailWhy: ['Trail field: the flow of the flock, 512 rows, blurred wide (the soft 5×5) and gone in 0.08 s: where the birds are now, and which way they fly.'],
      picture: t => ({ nodes: [palette(`${p}Colour`, X(1680), Y(0), t, [[0.01, 0.02, 0.05], [0.03, 0.08, 0.2], [0.08, 0.3, 0.5], [0.4, 0.75, 0.9], [0.9, 0.98, 1]], ['Stops Palette: the trail as a deep-blue sky that brightens where the flocks fly.'])], out: [`${p}Colour`, 'color'] }),
      draw: { style: 'streaks', colorBy: 'heading', palette: 'ab', colorA: [1, 0.8, 0.5], colorB: [0.5, 0.8, 1], size: 1, brightness: 0.1, glow: 0.4, streak: 0.5, scaleBy: 'walker', fade: 'off', lights: '0', ...note(['Draw agents: each bird as a short streak, warm or cool by which way it flies, so the flocks\' directions show.']) },
    }, withOutput);
    case 'predatorPrey': return setup(x, y, {
      p, set: predatorPrey(), label: 'Predator & prey (rules)', tier: '256k', steps: 2, preroll: 3, nodeVersion: 'Simulations: agents → Predators and prey (with births, energy and grass)',
      groupWhy: ['Two species. Prey (channel 1) graze along their own trail and flee when they smell predators (channel 2), turning yellow; predators follow the prey\'s smell. Prey standing in thick predator smell are caught: they die, and the Emit gives them a new life elsewhere.'],
      emits: [
        { mode: 'respawn', shape: 'screen', heading: 'random', life: 0, species: '1', share: 0.85, ...note(['Emit (prey): 85% of the walkers are prey, born anywhere; Keep full brings a caught one back at once, somewhere else.']) },
        { mode: 'respawn', shape: 'screen', heading: 'random', life: 0, species: '2', share: 0.15, ...note(['Emit (predators): 15% are predators, born anywhere. Chained to the prey Emit through "+ Another Emit"; births are shared by Share.']) },
      ],
      depositAmount: 0.2, depositWhy: 'Deposit: prey leave channel 1, predators channel 2 (the rules\' "leave trail"), 0.2 a step each: spread out, the prey smell averages about 2 and the predators\' about 0.4, so "near predators > 1" means a hunting pack close by.',
      trail: { resolution: '512', diffuse: 1, halfLife: 0.25, edges: 'wrap', gain: 0.2 },
      trailWhy: ['Trail field: the two smells, 512 rows, spread and fading in 0.25 s.'],
      picture: t => ({ nodes: [look(`${p}Field`, X(1680), Y(0), 'Field', [['ch', 'vec4', [t, 'channels']]], [
        ['float prey', '1.0 - exp(-max(ch.r, 0.0) * 0.15)', 'the prey\'s smell (channel 1), 0–1.'],
        ['float hunt', '1.0 - exp(-max(ch.g, 0.0) * 0.4)', 'the predators\' smell (channel 2), 0–1.'],
      ], 'vec3(0.01, 0.015, 0.02) + vec3(0.1, 0.45, 0.2) * prey + vec3(0.7, 0.12, 0.08) * hunt', 'vec3', 'Field (an Expression Block): the two smells as colour.', 'green where prey graze, red where predators hunt.')], out: [`${p}Field`, 'result'] }),
      draw: { style: 'points', colorBy: 'state', palette: 'ab', size: 1, brightness: 0.25, scaleBy: 'walker', fade: 'off', lights: '0', ...note(['Draw agents, Colour by State: prey green (yellow while fleeing), predators red.']) },
    }, withOutput);
    case 'sir': return setup(x, y, {
      p, set: sir(), label: 'Infection (rules)', tier: '64k', steps: 2, preroll: 0, nodeVersion: 'Simulations: agents → Infection spread (SIR)',
      groupWhy: ['States: healthy, sick, recovered (Memory x). The Memory number is a clock: how long it has been sick, or immune. A few start sick; the sick leave germs; the healthy who walk through germs may fall sick (60% a second); after 5 s the sick recover; after 20 s immunity wanes and waves of infection come back (SIRS).', 'Try: a 15% chance for an epidemic that fizzles out; recovery after 10 s for a bigger wave.'],
      emits: [{ mode: 'fill', shape: 'screen', heading: 'random', life: 0, ...note(['Emit: people everywhere at once, all healthy (Memory 0: the first state).']) }],
      depositAmount: 1, depositWhy: 'Deposit: the sick leave germs (channel 1) where they walk.',
      trail: { resolution: '512', diffuse: 0.3, halfLife: 0.5, edges: 'wrap', gain: 0.4 },
      trailWhy: ['Trail field: the germs, 512 rows, spreading a little and fading in 0.5 s, so they linger behind the sick.'],
      picture: t => ({ nodes: [palette(`${p}Colour`, X(1680), Y(0), t, [[0.015, 0.015, 0.025], [0.12, 0.03, 0.04], [0.35, 0.06, 0.06]], ['Stops Palette: germs as a faint red haze on a dark ground.'])], out: [`${p}Colour`, 'color'] }),
      draw: { style: 'glow', colorBy: 'state', palette: 'ab', size: 1.5, brightness: 0.5, glow: 0.5, scaleBy: 'walker', fade: 'off', lights: '0', ...note(['Draw agents, Colour by State: healthy blue, sick red, recovered green.']) },
    }, withOutput);
    case 'termites': return setup(x, y, {
      p, set: termites(), label: 'Termites (rules)', tier: '64k', steps: 8, preroll: 0, nodeVersion: 'Simulations: agents → Termites and wood chips (chips exactly conserved)',
      groupWhy: [
        'States: new, empty and carrying. One termite in eight lives (the rest die at birth: Memory is set to a random 0–8 and those above 1 die), and each new one lays 8 chips on empty spots before it starts work (Memory counts them), so termites are sparse and chips plentiful.',
        'Empty termites steer toward chips and slow down near them; on a chip they wait and, on a dice roll, pick it up (leave −1). Carrying termites that sense a chip nearby while standing on bare ground wait and, on a dice roll, drop theirs there (+1). Both stop for that step and turn round, and the Memory number keeps them from acting again for 0.3 s. Chips gather into piles within about 20 s.',
        'Why the odd thresholds: the trail never goes below 0, so taking a chip from an empty pixel would make one from nothing. Sensing reads the trail blended over the 4 nearest pixels, and the termite\'s own pixel weighs at least a quarter: "here above 0.76" means its own pixel holds a chip, "here below 0.24" that it holds none. The dice make two termites in one pixel seldom act in the same step. Chips are kept to within about 1% over half a minute; only the node version (a per-cell handshake) keeps them exactly.',
      ],
      emits: [{ mode: 'fill', shape: 'screen', heading: 'random', life: 0, ...note(['Emit: termites everywhere at once.']) }],
      depositAmount: 1, depositWhy: 'Deposit: chips laid and taken (the rules\' leave trail +1 and −1).',
      trail: { resolution: '512', diffuse: 0, halfLife: 10000000, edges: 'wrap', gain: 0.8 },
      trailWhy: ['Trail field: the wood chips, one per pixel at 512 rows. Diffuse 0 and a half-life of 10,000,000 s: chips stay where they lie (a shorter half-life loses a half-float step every step, docs/simulations-agents.md).', 'Two termites taking the same chip in the same step would make a chip from nothing; the rules\' waiting and dice make that rare (about 1% over 30 s). The node version shakes hands to keep chips exact.'],
      picture: t => ({ nodes: [palette(`${p}Colour`, X(1680), Y(0), t, [[0.05, 0.04, 0.03], [0.45, 0.3, 0.15], [0.85, 0.65, 0.4]], ['Stops Palette: chips as light wood on dark ground.'])], out: [`${p}Colour`, 'color'] }),
      draw: { style: 'points', colorBy: 'state', palette: 'ab', size: 1, brightness: 0.4, scaleBy: 'walker', fade: 'off', lights: '0', ...note(['Draw agents, Colour by State: empty termites grey, carrying ones orange.']) },
    }, withOutput);
    case 'fireflies': return setup(x, y, {
      p, set: fireflies(), label: 'Fireflies (rules)', tier: '64k', steps: 2, preroll: 0, nodeVersion: 'Simulations: agents → Fireflies flashing in time',
      groupWhy: [
        'States: dark and flash. The Memory number is each firefly\'s clock. At birth it is set at random from 0 to 10 and nine in ten die at once (those above 1): a sparse swarm whose clocks start anywhere from 0 to 1. The clock runs at 0.667 a second (a 1.5 s cycle); at 1 a firefly flashes for 0.12 s and starts again.',
        'A dark firefly past 60% of its cycle that sees light (its sensors look 0.5 ahead and 90° to each side, so it sees flashes across a wide patch of the swarm) flashes at once. A flash sets off everyone near the end of their cycle, and theirs the next ring out, so the light sweeps the picture in a few steps; those still early in their cycle (the refractory 60%) ignore it and flash on their own, setting the others off next time. Within a few cycles the whole swarm flashes together (pulse-coupled clocks, Mirollo and Strogatz).',
        'Try: sensors 0.12 ahead for local coupling: light then runs through the swarm in waves instead of flashing all at once.',
      ],
      emits: [{ mode: 'fill', shape: 'screen', heading: 'random', life: 0, ...note(['Emit: fireflies everywhere at once.']) }],
      depositAmount: 1, depositSize: 4, depositWhy: 'Deposit, Size 4: a flashing firefly lights a square 4 trail pixels across round it (channel 1).',
      trail: { resolution: '512', diffuse: 0.5, halfLife: 0.05, edges: 'wrap', gain: 0.5 },
      trailWhy: ['Trail field: the light of the flashes. It spreads a little and is gone in a few steps, so a firefly sees a flash only while it happens.', 'Pre-roll 0: they start out of step; watch them fall into step in the first few seconds (Start over to see it again).'],
      picture: t => ({ nodes: [palette(`${p}Colour`, X(1680), Y(0), t, [[0.0, 0.01, 0.02], [0.1, 0.18, 0.05], [0.6, 0.65, 0.2], [1, 1, 0.7]], ['Stops Palette: the flashes\' light on a night sky.'])], out: [`${p}Colour`, 'color'] }),
      draw: { style: 'glow', colorBy: 'state', palette: 'ab', size: 2, brightness: 0.8, glow: 0.8, scaleBy: 'walker', fade: 'off', lights: '0', ...note(['Draw agents, Colour by State: dim green while dark, bright yellow while flashing.']) },
    }, withOutput);
    case 'dla': {
      const uv = n('uv', `${p}Uv`, X(-420), Y(420), { ...note(['UV: where each pixel (inside the group: each walker) is, for Seed.']) });
      const seed = look(`${p}Seed`, X(0), Y(420), 'Seed', [['uv', 'vec2', [`${p}Uv`, 'uv']]], [
        ['float d', 'length(uv) - 0.012', 'the distance to a tiny disc in the middle (below 0 inside).'],
      ], 'step(d, 0.0)', 'float', 'Seed (an Expression Block): 1 in a tiny disc in the middle, where the crystal starts. Wired into the group\'s Seed mask.', '1 inside the seed.');
      return [uv, ...setup(x, y, {
        p, set: dla(), label: 'DLA growth (rules)', tier: '64k', steps: 4, preroll: 0, nodeVersion: 'Simulations: agents → Diffusion-limited aggregation',
        groupWhy: ['States: free and stuck. Free walkers wander at random; one that touches the seed or the crystal (its trail at its sensors, just ahead) sticks and becomes part of it, leaving crystal from then on. Branches grow because tips are easier to reach than the gaps between them (diffusion-limited aggregation).'],
        emits: [{ mode: 'fill', shape: 'screen', heading: 'random', life: 0, ...note(['Emit: walkers everywhere at once, all free.']) }],
        depositAmount: 1, depositWhy: 'Deposit: stuck walkers leave crystal (channel 1) every step.',
        trail: { resolution: '512', diffuse: 0, halfLife: 30, edges: 'wrap', gain: 0.6 },
        trailWhy: ['Trail field: the crystal, 512 rows. It doesn\'t spread (Diffuse 0), so a free walker sticks only where its sensors (0.006 ahead, ±60°) touch the crystal itself; the stuck walkers keep it lit.'],
        masks: [{ port: 'mask1', node: seed, out: [`${p}Seed`, 'result'] }],
        picture: t => ({ nodes: [palette(`${p}Colour`, X(1680), Y(0), t, [[0.01, 0.01, 0.03], [0.05, 0.12, 0.3], [0.4, 0.7, 0.95], [0.95, 0.99, 1]], ['Stops Palette: the crystal as frost: deep blue to white.'])], out: [`${p}Colour`, 'color'] }),
        draw: { style: 'points', colorBy: 'state', palette: 'ab', size: 1, brightness: 0.12, scaleBy: 'walker', fade: 'off', lights: '0', ...note(['Draw agents, Colour by State: free walkers a faint blue dust; stuck ones white.']) },
      }, withOutput)];
    }
  }
  return [];
}
