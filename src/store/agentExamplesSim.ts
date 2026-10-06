/**
 * agentExamplesSim.ts — "Simulations: agents" (docs/simulations-agents.md): classic agent-based
 * models, each one a custom rule written from ordinary nodes inside an Agents group. No new node
 * types: Agent Inputs / Agent Output, Sense used only as a reader (what the trail holds here and
 * around), plain math, Compare and Expression Blocks, and Move where a walker just walks.
 *
 *  - Predators and prey (Lotka–Volterra): slots alive or unborn in Memory, energy, Alive and Emit;
 *  - Diffusion-limited aggregation (Witten & Sander): walkers wander until they touch, then freeze;
 *  - Sand drift (Werner): gusts lift, carry, drop and slump slabs of a Trail that never fades;
 *  - Crowd: two-way pedestrian traffic sorting itself into lanes (Helbing), slowing as it packs;
 *  - Painter bots: turtles with a turning rhythm and a colour in Memory, answering each other's paint;
 *  - Termites (Resnick): chips on a grid, picked up and dropped by an exact one-step handshake;
 *  - Fireflies (Mirollo & Strogatz): pulse-coupled clocks in Memory falling into step;
 *  - Infection (Kermack & McKendrick, SIRS): state and time in state in Memory.
 *
 * Every node, inside the group too, carries a plain-language note, and every Expression Block
 * explains each named line ("name: …"), which examples.test.ts checks. Each example loads with a
 * Play setup whose controls are the rule's own numbers.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { PlayControl } from '../types/play';
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, play } from './graphBuilder';
import { agentsGroup, expr, groupInput, note, withOutputs } from './agentExampleKit';

type PortType = GraphNode['inputs'][string]['type'];

/** Agent Inputs with ports added to the group (a Trail's image, a number from outside). */
function inputsWith(id: string, ports: Array<{ key: string; type: PortType; label: string }>, lines: string[]): GraphNode {
  return withOutputs(n('agentInputs', id, 0, 160, {
    _groupOriginal: true,
    extraInputs: ports,
    ...note(lines),
  }), Object.fromEntries(ports.map(p => [p.key, { type: p.type, label: p.label }])));
}

/** Agent Output, anchored, wired as given. */
const agentOut = (id: string, x: number, y: number, lines: string[], wires: Record<string, [string, string]>) =>
  n('agentOutput', id, x, y, { _groupOriginal: true, ...note(lines) }, wires);

/** A Play control on a slider inside a group: `group::node::param`. */
const inner = (id: string, group: string, node: string, param: string, label: string, min: number, max: number, step?: number): PlayControl =>
  ctl(id, `${group}::${node}::${param}`, label, min, max, step);

export const SIM_AGENT_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  simAgentPredatorPrey: {
    label: 'Predators and prey',
    description: 'Lotka and Volterra as animals that move: prey graze and multiply, predators hunt them by scent, eat, multiply and starve. Every walker is a slot that is alive or waiting to be born (Memory), with its energy; the eaten and the starved die (Alive) and Emit gives their slots back. Herds and packs chase each other across the pasture in waves.',
    play: true,
  },
  simAgentDla: {
    label: 'Diffusion-limited aggregation',
    description: 'Coral and lightning from a random walk: walkers wander at random until they touch the cluster, then stick there for good and become part of it. Tips reach further out and catch more walkers than the hollows behind them, so the cluster grows into branching fingers from one seed in the middle (Witten and Sander, 1981). The whole rule is one Compare and one Expression Block.',
    play: true,
  },
  simAgentSandDrift: {
    label: 'Sand drift: dunes from wind',
    description: 'Erosion and deposition: each walker is a gust that lifts a slab of sand where the sand lies, carries it downwind and drops it, more readily on sand than on bare ground and always in the wind shadow behind a crest. The sand is a Trail that never fades; Memory says whether a gust carries sand. A flat bed grows ripples that merge into dunes marching downwind (after Werner, 1995).',
    play: true,
  },
  simAgentCrowd: {
    label: 'Crowd: lanes in two-way traffic',
    description: 'Two crowds walk a corridor in opposite directions. Each walker heads for its goal round the pillars, sidesteps away from oncoming walkers and toward its own kind ahead, and slows where the crowd ahead is thick. Nobody is told to keep to one side, yet the crowd sorts itself into lanes, and jams form and clear round the pillars.',
    play: true,
  },
  simAgentPainters: {
    label: 'Painter bots',
    description: 'Generative art from turtles: each bot keeps a turning rhythm (Memory.x) that swings it through waves, loops and petals, and a colour (Memory.y) it paints with. When it wanders onto paint it answers the stroke: it flips the way it curls and shifts its colour. The canvas is the Trail\'s colour channels.',
    play: true,
  },
  simAgentTermites: {
    label: 'Termites and wood chips',
    description: 'Mitchel Resnick\'s termites: each one wanders, picks up a wood chip when it finds one, and puts it down next to the next chip it bumps into. Nobody plans a pile, yet the scattered chips gather into fewer, bigger piles. The chips are a Trail that never fades; each termite remembers in Memory whether it carries one.',
    play: true,
  },
  simAgentFireflies: {
    label: 'Fireflies flashing in time',
    description: 'Pulse-coupled clocks: every firefly flashes when its own clock runs out, and a flash it sees nudges its clock forward. At first the meadow twinkles at random; then patches fall into step, spread as waves and merge until the whole meadow flashes together (Mirollo and Strogatz). Each clock lives in Memory.',
    play: true,
  },
  simAgentInfection: {
    label: 'Infection spread (SIR)',
    description: 'An epidemic in a crowd that only meets its neighbours: each person is susceptible, infected or recovered (Memory), the infected breathe infection into a Trail and the susceptible catch it with a chance that grows with what is in the air. Rings of infection spread out; when immunity wears off they break into turning spirals (Kermack and McKendrick\'s SIR, with waning immunity).',
    play: true,
  },
};

// ── Diffusion-limited aggregation ────────────────────────────────────────────

/**
 * DLA (Witten & Sander 1981): free walkers take random steps; a walker that smells the stuck
 * channel above Stick at freezes for good (Memory.x = 1, Speed 0) and lays that channel itself,
 * so the cluster grows from the seed the Trail's Add paints in the middle.
 */
export function dlaNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('dlaIn', [{ key: 'trail', type: 'texture', label: 'Cluster' }], [
    'Agent Inputs: this walker as the step begins. Memory is what it carried over from the last step: x is 1 once it has stuck to the cluster (0 while it wanders), y how far from the middle it was when it stuck (for its colour).',
    'Cluster is an input added to the group: the Trail field from outside, as it was one step ago. Its first channel is the smell of the stuck walkers (and of the seed).',
  ]);
  const smell = n('agentSense', 'dlaSmell', 420, 100, {
    angle: 45, distance: 0.01, weight: 1, width: '1',
    ...note([
      'Sense, used only as a reader: its Here output is the cluster\'s smell exactly where the walker stands (its three sensors and Steer are not used: this walker doesn\'t steer toward anything, it stumbles about).',
      'The smell is the stuck walkers\' trail spread a couple of pixels round them, so Here is high only right next to the cluster: that is what "touching" means here.',
    ]),
  }, { texture: ['dlaIn', 'trail'] });
  const stickAt = n('constant', 'dlaStickAt', 420, 520, {
    value: 0.08,
    ...note([
      'Stick at (a Constant): how strong the cluster\'s smell must be for a walker to count as touching it. A Play control.',
      'Lower: walkers stick a little further out, so the branches grow thicker and faster. Higher: they must almost land on a stuck walker, so the branches are thinner and the growth slower.',
    ]),
  });
  const touch = n('compare', 'dlaTouch', 840, 100, {
    operator: '>', smoothing: 0,
    ...note([
      'Compare: 1 when the smell here (Sense\'s Here, A) is above Stick at (B), else 0. This is the whole "is it touching the cluster?" test, as a plain node you can read.',
      'Try: swap the operator to < and walkers freeze everywhere except next to the cluster.',
    ]),
  }, { a: ['dlaSmell', 'here'], b: ['dlaStickAt', 'value'] });
  const rule = expr('dlaRule', 1260, 100, {
    label: 'Stick or wander',
    inputs: [
      { name: 'mem', type: 'vec2' }, { name: 'touching', type: 'float' }, { name: 'rnd', type: 'float' }, { name: 'pos', type: 'vec2' },
      { name: 'age', type: 'float' }, { name: 'stickiness', type: 'float', slider: { min: 0, max: 1 } }, { name: 'walk', type: 'float', slider: { min: 0, max: 1 } },
      { name: 'pull', type: 'float', slider: { min: 0, max: 0.5 } },
    ],
    values: { stickiness: 1, walk: 0.2, pull: 0.0015 },
    lines: [
      ['float wasStuck', 'step(0.5, mem.x)'],
      ['float sticks', 'touching * (1.0 - step(stickiness, fract(rnd * 4096.0))) * step(0.5, age)'],
      ['float stuck', 'max(wasStuck, sticks)'],
      ['float stuckAt', 'wasStuck > 0.5 ? mem.y : length(pos)'],
      ['float angle', 'rnd * 6.2831853'],
      ['float speed', 'walk * (1.0 - stuck)'],
      ['vec2 drift', '-pos / max(length(pos), 1e-3) * pull * (1.0 - stuck)'],
      ['vec4 deposit', 'vec4(stuck, 0.0, 0.0, 0.0)'],
      ['vec3 coral', 'mix(mix(vec3(0.6, 0.06, 0.22), vec3(1.0, 0.42, 0.22), smoothstep(0.0, 0.35, stuckAt)), vec3(1.0, 0.88, 0.68), smoothstep(0.35, 0.8, stuckAt))'],
      ['vec3 colour', 'mix(vec3(0.05, 0.08, 0.14), coral, stuck)'],
    ],
    result: 'vec2(stuck, stuckAt)',
    outputType: 'vec2',
    exposed: [
      { name: 'angle', type: 'float' }, { name: 'speed', type: 'float' }, { name: 'drift', type: 'vec2' },
      { name: 'deposit', type: 'vec4' }, { name: 'colour', type: 'vec3' },
    ],
    wires: { mem: ['dlaIn', 'memory'], touching: ['dlaTouch', 'mask'], rnd: ['dlaIn', 'random'], pos: ['dlaIn', 'position'], age: ['dlaIn', 'age'] },
    note: [
      'Stick or wander (an Expression Block): the whole DLA rule. Its Result is the new Memory; angle, speed, drift, deposit and colour are extra outputs. Stickiness, Walk and Pull are Play controls.',
      'wasStuck: 1 if this walker stuck on an earlier step (Memory.x). sticks: it touches the cluster now and wins a dice roll against Stickiness (1: always sticks), and it is older than half a second (on the step it is born every walker lays one step of trail where it stands, which it must not mistake for the cluster).',
      'stuck: stuck from now on, for good: nothing ever sets it back to 0. stuckAt: how far from the middle it stuck (kept in Memory.y), so each walker remembers when in the growth it joined.',
      'angle: a brand-new random direction every step (Brownian motion: no memory of where it was going). speed: Walk while free, 0 once stuck.',
      'drift: a gentle pull toward the middle (Pull) so walkers keep arriving; 0 once stuck. Pull 0 is pure DLA, slower but even more branched.',
      'deposit: stuck walkers lay the cluster\'s smell (channel 1) every step; free walkers lay nothing. coral: a colour picked by stuckAt, deep rose at the old heart through orange to pale sand at the young tips. colour: dim blue while it wanders, coral once stuck.',
      'Try: Stickiness 0.2 (each touch only sticks one time in five) for denser, bushier coral; Pull 0.2 for a fast, thick tree.',
    ],
  });
  const move = n('agentMove', 'dlaMove', 1680, 100, {
    speed: 0.15, edges: 'wrap',
    ...note([
      'Move: one step along the random angle at the rule\'s speed, plus its drift (the "+ Drift" input). A stuck walker\'s speed and drift are 0, so it stays exactly where it stuck. Wrap: off one edge, back on the other.',
    ]),
  }, { heading: ['dlaRule', 'angle'], speed: ['dlaRule', 'speed'], also: ['dlaRule', 'drift'] });
  const output = agentOut('dlaOut', 2100, 140, [
    'Agent Output: Position and Velocity from Move; Memory, Deposit and Colour from the rule. Alive is left unwired: in this model nobody dies, the free walkers just get used up.',
  ], {
    position: ['dlaMove', 'position'], velocity: ['dlaMove', 'velocity'],
    memory: ['dlaRule', 'result'], deposit: ['dlaRule', 'deposit'], colour: ['dlaRule', 'colour'],
  });

  // ── Outside ──
  const emit = n('agentEmit', 'dlaEmit', X(0), Y(0), {
    mode: 'fill', shape: 'disc', size: 1, heading: 'random',
    ...note([
      'Emit: every walker starts at a random place in a disc as tall as the picture round the seed, free (Memory 0), all at once (Fill).',
      'Try: Shape Whole picture for a cluster that ends up the picture\'s shape; Size 0.5 for a small, dense one.',
    ]),
  });
  let group = agentsGroup('dla', X(420), Y(0), 'dlaEmit', [inputs, smell, stickAt, touch, rule, move, output], {
    label: 'Aggregation', tier: '64k', stepsPerFrame: 4, preroll: 0,
    ...note([
      'Agents: 65,536 walkers (64k), 4 steps a frame. Inside (double-click): Sense reads the cluster\'s smell here, Compare decides "touching", the Stick or wander block keeps or changes the walker\'s Memory, Move walks it.',
      'Each walker remembers in Memory whether it has stuck; that one number is what turns a random walk into a growing cluster.',
      'Why 64k: DLA wants walkers few and far between (one to every 28 trail pixels here); a crowd of them fills the hollows and the coral grows into a solid blob.',
      'Try: Start over with a new Seed for a new coral; Count 256k for a denser, bushier one.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Cluster', ['dlaTrail', 'texture']);
  const uv = n('uv', 'dlaUv', X(420), Y(520), { ...note(['UV: where each trail pixel (and each picture pixel) is, for the Seed.']) });
  const seed = expr('dlaSeed', X(840), Y(520), {
    label: 'Seed',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [['float dot', '1.0 - smoothstep(0.006, 0.012, length(uv))']],
    result: 'vec4(dot * 60.0, 0.0, 0.0, 0.0)',
    outputType: 'vec4',
    wires: { uv: ['dlaUv', 'uv'] },
    note: [
      'Seed (an Expression Block): a tiny dot in the middle, painted into the cluster\'s smell every step (the Trail\'s Add): the first thing walkers can stick to.',
      'dot: 1 inside a circle 0.01 across round the middle, 0 outside. Result: that dot in channel 1, 60 a second (as strong as a stuck walker laying 1 a step).',
      'Try: 1.0 - smoothstep(0.0, 0.01, abs(uv.y + 0.95)) for a seed line along the bottom: a forest (or lightning striking the ground, upside down).',
    ],
  });
  const deposit = n('agentDeposit', 'dlaDeposit', X(840), Y(0), {
    amount: 1, size: 1, what: 'trail',
    ...note(['Deposit: every walker leaves its rule\'s deposit each step: 1 in channel 1 once stuck, nothing while free.']),
  }, { agents: ['dla', 'agents'] });
  const trail = n('trailField', 'dlaTrail', X(1260), Y(0), {
    resolution: '1024', diffuse: 1, halfLife: 0.05, edges: 'wrap', gain: 0.6, kernel: '3',
    ...note([
      'Trail field: the cluster\'s smell, 1024 rows. It spreads a pixel or two (Diffuse 1) and fades fast (half-life 0.05 s), so it is a thin halo round the stuck walkers, refreshed every step because they never stop laying it.',
      'Add: the Seed. Its Image goes back into the group (Cluster); its Amount glows under the picture.',
    ]),
  }, { deposit: ['dlaDeposit', 'deposit'], add: ['dlaSeed', 'result'] });
  const glow = expr('dlaGlow', X(1680), Y(520), {
    label: 'Cluster glow',
    inputs: [{ name: 'amount', type: 'float' }, { name: 'uv', type: 'vec2' }],
    lines: [['vec3 deep', 'vec3(0.01, 0.02, 0.05) + vec3(0.0, 0.02, 0.04) * (1.0 - length(uv) * 0.6)']],
    result: 'deep + vec3(1.0, 0.45, 0.35) * amount * 0.35',
    outputType: 'vec3',
    wires: { amount: ['dlaTrail', 'amount'], uv: ['dlaUv', 'uv'] },
    note: [
      'Cluster glow (an Expression Block): the picture under the walkers, deep sea blue, with a faint warm glow where the cluster\'s smell is.',
      'deep: a dark blue, a little lighter in the middle.',
    ],
  });
  const draw = n('drawAgents', 'dlaDraw', X(2100), Y(0), {
    style: 'points', colorBy: 'agent', size: 1.5, brightness: 0.9, scaleBy: 'walker', fade: 'off', lights: '0',
    ...note([
      'Draw agents: every walker as a dot in its own Colour (Colour by Agent): the free ones a dim blue haze, the stuck ones coral by when they joined.',
      'Try: Brightness 0.3 to hide the haze; Style Glow for lightning.',
    ]),
  }, { agents: ['dla', 'agents'], over: ['dlaGlow', 'result'] });
  const nodes = [emit, group, uv, seed, deposit, trail, glow, draw];
  if (withOutput) nodes.push(n('output', 'dlaOutput', X(2520), Y(0), { ...note(['Output: the coral over its glow is the picture.']) }, { color: ['dlaDraw', 'color'] }));
  return nodes;
}

const dlaPlay = play([
  inner('stick', 'dla', 'dlaRuleStickiness', 'value', 'Stickiness', 0, 1),
  inner('walk', 'dla', 'dlaRuleWalk', 'value', 'Walk speed', 0, 1),
  inner('pull', 'dla', 'dlaRulePull', 'value', 'Pull to the middle', 0, 0.5),
  inner('at', 'dla', 'dlaStickAt', 'value', 'Stick at', 0.01, 0.5),
  ctl('again', 'dla::restart', 'Start over', 0, 1),
], `**What it shows.** Diffusion-limited aggregation (Witten and Sander, 1981): sixty-five thousand walkers take random steps, and any walker that touches the cluster stops there for good. The tips of the cluster stick out into the crowd and catch walkers before they can reach the hollows behind, so tips grow faster and split: coral, frost and lightning all grow this way.

**How it's built.** Inside the Agents group, Sense reads the cluster's smell where the walker stands, a Compare node asks "is it above Stick at?", and one Expression Block (Stick or wander) keeps the answer in Memory.x for good, sets Speed to 0 and makes the stuck walker lay the smell itself. A Seed dot painted into the Trail's Add starts it off.

**Try.** **Stickiness** below 1 makes each touch stick only sometimes, so walkers creep further into the hollows: denser, bushier coral. **Pull to the middle** brings walkers in faster (thicker branches); 0 is pure DLA. **Stick at** is how close counts as touching. **Start over** grows a new one.`);

// ── Termites and wood chips ──────────────────────────────────────────────────

/**
 * On the grid (an Expression Block): snaps a walker to the middle of the trail pixel it stands in,
 * for a Trail of `rows` rows, so it reads and changes exactly that one pixel.
 */
function gridBlock(id: string, x: number, y: number, rows: number, wires: Record<string, [string, string]>, why: string): GraphNode {
  return expr(id, x, y, {
    label: 'On the grid',
    inputs: [{ name: 'pos', type: 'vec2' }, { name: 'res', type: 'vec2' }],
    lines: [
      ['float aspect', 'res.x / res.y'],
      ['vec2 cells', `vec2(floor(${rows.toFixed(1)} * aspect + 0.5), ${rows.toFixed(1)})`],
      ['vec2 cell', 'floor((pos / vec2(aspect, 1.0) * 0.5 + 0.5) * cells)'],
    ],
    result: '((cell + 0.5) / cells * 2.0 - 1.0) * vec2(aspect, 1.0)',
    outputType: 'vec2',
    exposed: [{ name: 'cell', type: 'vec2' }, { name: 'cells', type: 'vec2' }],
    wires,
    note: [
      `On the grid (an Expression Block): ${why}`,
      `aspect: the picture's width over its height (from Resolution). cells: how many trail pixels there are across and up, worked out exactly as the Trail field does for its ${rows} rows.`,
      'cell: which trail pixel this walker stands in (0 to cells − 1). Result: the middle of that pixel, in picture units: reading the trail exactly there gives that one pixel\'s value, not a blend of its neighbours.',
    ],
  });
}

/**
 * Termites (Resnick, "Turtles, Termites and Traffic Jams", 1994): wood chips lie on a grid (one per trail
 * pixel, kept for ever: Half-life 100000 s, no spreading). A termite wanders; on a chip, empty-handed,
 * it picks it up (deposit −1); carrying, when it bumps into another chip it walks on to the next empty
 * cell and puts its chip down there (deposit +1). Nobody plans a pile, yet piles form and merge.
 */
export function termitesNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const ROWS = 512;
  const inputs = inputsWith('tmIn', [{ key: 'chips', type: 'texture', label: 'Chips' }], [
    'Agent Inputs: this termite as the step begins. Memory is what it carried over: x is what it is doing (0 scattering the first chips, 1 empty-handed, 2 reaching for a chip, 3 carrying one, 4 carrying and next to a pile, looking for a free cell), y the seconds left before it may act again.',
    'Chips is an input added to the group: the Trail field from outside, as it was one step ago. Channel 1: how many wood chips lie in each cell. Channel 2: how many termites are reaching for a chip there right now.',
  ]);
  const res = n('resolution', 'tmRes', 0, 560, { ...note(['Resolution: the picture\'s size in pixels, so On the grid can work out the trail\'s cells exactly.']) });
  const grid = gridBlock('tmGrid', 420, 360, ROWS, { pos: ['tmIn', 'position'], res: ['tmRes', 'res'] },
    'termites walk on the trail\'s pixels as on a chess board, one cell a step, so a chip is exactly one cell and a termite always reads and changes the cell it stands on.');
  const look = n('agentSense', 'tmLook', 840, 100, {
    angle: 45, distance: 0.01, weight: 1, width: '1',
    ...note([
      'Sense, used only as a reader: Channels here is the trail in this termite\'s cell (Position: the middle of the cell, from On the grid): the chips there (red) and the termites reaching for one (green). Its sensors and Steer are not used: termites wander blindly.',
    ]),
  }, { texture: ['tmIn', 'chips'], position: ['tmGrid', 'result'] });
  const rule = expr('tmRule', 1260, 100, {
    label: 'Termite rule',
    inputs: [
      { name: 'mem', type: 'vec2' }, { name: 'here', type: 'vec4' }, { name: 'cell', type: 'vec2' }, { name: 'cells', type: 'vec2' },
      { name: 'res', type: 'vec2' }, { name: 'h', type: 'float' }, { name: 'rnd', type: 'float' }, { name: 'age', type: 'float' },
      { name: 'wiggle', type: 'float', slider: { min: 0, max: 180 } }, { name: 'pickChance', type: 'float', slider: { min: 0, max: 1 } },
      { name: 'rest', type: 'float', slider: { min: 0, max: 2 } }, { name: 'scatter', type: 'float', slider: { min: 0, max: 0.2 } },
    ],
    values: { wiggle: 50, pickChance: 1, rest: 0.3, scatter: 0.015 },
    lines: [
      ['float job', 'mem.x'],
      ['float wait', 'mem.y'],
      ['float chip', 'step(0.5, here.r)'],
      ['float reachers', 'floor(here.g + 0.5)'],
      ['float ready', 'step(wait, 0.0)'],
      ['float roll', 'fract(rnd * 4096.0)'],
      ['float seeding', 'step(job, 0.5) * step(age, 0.5)'],
      ['float drops0', 'seeding * (1.0 - step(scatter, roll))'],
      ['float reach', 'step(0.5, job) * step(job, 1.5) * chip * ready * (1.0 - step(pickChance, roll))'],
      ['float reaching', 'step(1.5, job) * step(job, 2.5)'],
      ['float take', 'reaching * chip * step(reachers, 1.5)'],
      ['float found', 'step(2.5, job) * step(job, 3.5) * chip * ready'],
      ['float drop', 'step(3.5, job) * (1.0 - chip)'],
      ['float acts', 'max(max(reach, reaching), max(drop, drops0))'],
      ['float nextJob', 'job < 0.5 ? (seeding > 0.5 ? 0.0 : 1.0) : job < 1.5 ? 1.0 + reach : job < 2.5 ? 1.0 + 2.0 * take : job < 3.5 ? 3.0 + found : 4.0 - 3.0 * drop'],
      ['float turnRound', 'max(reaching, drop)'],
      ['float nextWait', 'turnRound > 0.5 ? rest : max(wait - 1.0 / 60.0, 0.0)'],
      ['float heading', 'h + (fract(rnd * 64.0) - 0.5) * radians(wiggle) + turnRound * 3.1415927'],
      ['float octant', 'floor(heading / 0.7853982 + 0.5)'],
      ['vec2 stepTo', 'vec2(floor(cos(octant * 0.7853982) + 0.5), floor(sin(octant * 0.7853982) + 0.5))'],
      ['vec2 nextCell', 'mod(cell + stepTo * (1.0 - acts), cells)'],
      ['vec2 position', '((nextCell + 0.5) / cells * 2.0 - 1.0) * vec2(res.x / res.y, 1.0)'],
      ['vec4 deposit', 'vec4(drops0 + drop - take, reach - reaching, 0.0, 0.0)'],
      ['vec3 colour', 'nextJob > 2.5 ? vec3(1.0, 0.55, 0.15) : vec3(0.85, 0.9, 1.0)'],
    ],
    result: 'vec2(nextJob, nextWait)',
    outputType: 'vec2',
    exposed: [{ name: 'position', type: 'vec2' }, { name: 'heading', type: 'float' }, { name: 'deposit', type: 'vec4' }, { name: 'colour', type: 'vec3' }],
    wires: {
      mem: ['tmIn', 'memory'], here: ['tmLook', 'sample'], cell: ['tmGrid', 'cell'], cells: ['tmGrid', 'cells'], res: ['tmRes', 'res'],
      h: ['tmIn', 'heading'], rnd: ['tmIn', 'random'], age: ['tmIn', 'age'],
    },
    note: [
      'Termite rule (an Expression Block): Resnick\'s termite, step by step. Its Result is the new Memory; position, heading, deposit and colour are extra outputs. Wiggle, Pick chance, Rest and Scatter are Play controls.',
      'job: what it is doing (Memory.x). wait: seconds before it may act again (Memory.y). chip: 1 if a chip lies in its cell. reachers: how many termites reached for a chip in this cell last step. ready: its wait is over. roll: a fresh dice roll, 0–1.',
      'seeding: its first half second (job 0), when it scatters the starting chips. drops0: it drops a new chip this step (Scatter is the chance a step). Every termite also lays one chip where it is born: that is Deposit\'s start (one unit in its own channel).',
      'reach: empty-handed, on a chip, ready, and the dice say yes (Pick chance): it reaches for the chip, marking the cell (+1 in channel 2). reaching: it reached last step. take: it was the only one reaching in this cell and the chip is still there, so it lifts it (−1 chip). If two reached at once, neither takes it: a trail can only add up what termites do, so this one-step handshake is what stops two termites lifting one chip.',
      'found: carrying, ready, and it has bumped into a chip: a pile. drop: carrying past a pile and now on a free cell: it puts its chip down there, next to the pile.',
      'acts: it reaches, lifts or puts down this step, so it stays in its cell (the cell it reads and the cell it changes must be the same).',
      'nextJob: 0 → 1 after seeding; 1 → 2 when it reaches; 2 → 3 if it took the chip, else back to 1; 3 → 4 when it finds a pile; 4 → 1 when it drops. turnRound: after reaching or dropping it turns right round. nextWait: then Rest seconds (so it walks away first), else counting down.',
      'heading: wander a little (Wiggle degrees at most), plus the turn round. octant: that heading rounded to one of eight directions. stepTo: the neighbouring cell in that direction (a king\'s move on the board).',
      'nextCell: one cell on, or the same cell when it acts; mod wraps round the edges. position: the middle of that cell, in picture units.',
      'deposit: channel 1, +1 chip when it drops (or scatters), −1 when it lifts one; channel 2, +1 when it reaches and −1 the step after, so the mark lasts exactly one step. colour: orange while it carries a chip, pale while empty-handed.',
    ],
  });
  const output = agentOut('tmOut', 1680, 140, [
    'Agent Output: Position, Heading, Memory, Deposit and Colour from the Termite rule. No Move node: the rule steps the termite from cell to cell itself.',
  ], {
    position: ['tmRule', 'position'], heading: ['tmRule', 'heading'], memory: ['tmRule', 'result'], deposit: ['tmRule', 'deposit'], colour: ['tmRule', 'colour'],
  });

  const emit = n('agentEmit', 'tmEmit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random',
    ...note(['Emit: every termite starts at a random place on the picture, facing anywhere, empty-handed (Memory 0), all at once (Fill).']),
  });
  let group = agentsGroup('termites', X(420), Y(0), 'tmEmit', [inputs, res, grid, look, rule, output], {
    label: 'Termites', tier: '64k', stepsPerFrame: 8, preroll: 0,
    ...note([
      'Agents: 65,536 termites (64k), 8 steps a frame. Inside (double-click): On the grid snaps each termite to its cell, Sense reads the chips there, the Termite rule decides and moves.',
      'Why 64k: one termite to every seven cells of the 512-row trail: crowded enough to find chips, sparse enough that they seldom queue for the same one.',
    ]),
  });
  group = groupInput(group, 'chips', 'texture', 'Chips', ['tmTrail', 'texture']);
  const deposit = n('agentDeposit', 'tmDeposit', X(840), Y(0), {
    amount: 1, size: 1, what: 'trail',
    ...note(['Deposit: each termite\'s changes go into the trail: chips +1 where one is put down and −1 where one is lifted (channel 1), and its reaching mark (channel 2).']),
  }, { agents: ['termites', 'agents'] });
  const trail = n('trailField', 'tmTrail', X(1260), Y(0), {
    resolution: String(ROWS), diffuse: 0, halfLife: 10000000, edges: 'wrap', gain: 1, kernel: '3',
    ...note([
      'Trail field: the wood chips, one number per cell (512 rows). Diffuse 0 (chips don\'t spread) and Half-life 100000 s (they never fade: typed past the slider\'s end): a board that only the termites change.',
      'Its Image goes back into the group (Chips); its Channels draw the chips.',
    ]),
  }, { deposit: ['tmDeposit', 'deposit'] });
  const uv = n('uv', 'tmUv', X(840), Y(420), { ...note(['UV: where each pixel is, for the soil\'s texture.']) });
  const ground = expr('tmGround', X(1680), Y(420), {
    label: 'Chips on soil',
    inputs: [{ name: 'ch', type: 'vec4' }, { name: 'uv', type: 'vec2' }],
    lines: [
      ['float chips', 'clamp(ch.r, 0.0, 3.0)'],
      ['vec3 soil', 'vec3(0.07, 0.055, 0.045) * (0.85 + 0.15 * sin(uv.x * 40.0) * sin(uv.y * 37.0))'],
      ['vec3 wood', 'mix(vec3(0.75, 0.55, 0.3), vec3(1.0, 0.85, 0.55), clamp(chips - 1.0, 0.0, 1.0))'],
    ],
    result: 'mix(soil, wood, clamp(chips, 0.0, 1.0))',
    outputType: 'vec3',
    wires: { ch: ['tmTrail', 'channels'], uv: ['tmUv', 'uv'] },
    note: [
      'Chips on soil (an Expression Block): the picture under the termites.',
      'chips: how many chips lie here (0 to 3). soil: dark brown earth with a faint ripple. wood: a chip\'s colour, paler where chips are stacked.',
    ],
  });
  const draw = n('drawAgents', 'tmDraw', X(2100), Y(0), {
    style: 'points', colorBy: 'agent', size: 1.25, brightness: 0.8, scaleBy: 'walker', fade: 'off', lights: '0',
    ...note(['Draw agents: each termite as a small dot in its own Colour: pale when empty-handed, orange while it carries a chip. Try: Brightness 0 to watch only the chips.']),
  }, { agents: ['termites', 'agents'], over: ['tmGround', 'result'] });
  const nodes = [emit, group, deposit, trail, uv, ground, draw];
  if (withOutput) nodes.push(n('output', 'tmOutput', X(2520), Y(0), { ...note(['Output: termites over their chips are the picture.']) }, { color: ['tmDraw', 'color'] }));
  return nodes;
}

const termitesPlay = play([
  inner('wiggle', 'termites', 'tmRuleWiggle', 'value', 'Wiggle', 0, 180),
  inner('pick', 'termites', 'tmRulePickChance', 'value', 'Pick chance', 0, 1),
  inner('rest', 'termites', 'tmRuleRest', 'value', 'Rest after acting', 0, 2),
  inner('scatter', 'termites', 'tmRuleScatter', 'value', 'Starting chips', 0, 0.2),
  ctl('again', 'termites::restart', 'Start over', 0, 1),
], `**What it shows.** Mitchel Resnick's termites: wood chips lie scattered on the ground. Each termite wanders; when it finds a chip empty-handed it picks it up, and when it bumps into another chip while carrying one it puts its chip down next to it. No termite plans anything, yet the chips gather into fewer and bigger piles.

**How it's built.** The chips are a Trail field that never fades or spreads, one number per cell. Inside the group, On the grid snaps each termite to a cell, Sense reads the chips there, and the Termite rule (one Expression Block) keeps the termite's job in Memory.x and a short rest in Memory.y. Deposit −1 takes a chip away, +1 puts one down.

**Try.** **Wiggle** is how much termites wander: 0 sends them in straight lines. **Pick chance** below 1 makes them hesitate. **Rest after acting** is how far they walk before they may act again. **Starting chips** sets how many chips there are (Start over to apply).`);

// ── Fireflies that flash in time ─────────────────────────────────────────────

/**
 * Pulse-coupled oscillators (Mirollo & Strogatz 1990; Buck's synchronous fireflies): each firefly's
 * clock (Memory.x, a phase 0 → 1) runs at its own pace; at 1 it flashes (Deposit) and starts again.
 * A firefly that sees a flash nearby jumps its clock forward a little, more the later it is in its
 * cycle. Neighbours fall into step, patches of synchrony grow and meet, and the meadow flashes as one.
 */
export function firefliesNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('ffIn', [{ key: 'flashes', type: 'texture', label: 'Flashes' }], [
    'Agent Inputs: this firefly as the step begins. Memory is what it carried over: x is its clock (its phase, 0 just after a flash, 1 when the next is due), y how bright its own light still is (1 when it flashes, fading).',
    'Flashes is an input added to the group: the Trail field from outside, as it was one step ago: the light of every flash, spread over a short distance and gone in a fraction of a second.',
  ]);
  const see = n('agentSense', 'ffSee', 420, 100, {
    angle: 45, distance: 0.02, weight: 1, width: '1',
    ...note([
      'Sense, used only as a reader: Here is how much flash light reaches this firefly from its neighbours this step. Its sensors and Steer are not used: a firefly doesn\'t fly toward the light, it only sees it.',
    ]),
  }, { texture: ['ffIn', 'flashes'] });
  const clock = expr('ffClock', 840, 100, {
    label: 'Firefly clock',
    inputs: [
      { name: 'mem', type: 'vec2' }, { name: 'seen', type: 'float' }, { name: 'index', type: 'float' }, { name: 'age', type: 'float' }, { name: 'rnd', type: 'float' },
      { name: 'period', type: 'float', slider: { min: 0.2, max: 4 } }, { name: 'spread', type: 'float', slider: { min: 0, max: 0.5 } },
      { name: 'coupling', type: 'float', slider: { min: 0, max: 2 } }, { name: 'deaf', type: 'float', slider: { min: 0, max: 0.9 } },
    ],
    values: { period: 1, spread: 0.06, coupling: 1, deaf: 0.25 },
    lines: [
      ['float phase0', 'age < 0.02 ? rnd : mem.x'],
      ['float own', 'fract(index * 0.6180339887)'],
      ['float pace', '1.0 / (period * (1.0 + spread * (own * 2.0 - 1.0)))'],
      ['float listening', 'step(deaf, phase0) * step(0.2, age)'],
      ['float nudge', 'coupling * seen * phase0 * listening'],
      ['float phase', 'phase0 + pace / 60.0 + nudge'],
      ['float flash', 'step(1.0, phase)'],
      ['float nextPhase', 'flash > 0.5 ? 0.0 : phase'],
      ['float glow', 'max(flash, mem.y * 0.88)'],
      ['vec4 deposit', 'vec4(flash, 0.0, 0.0, 0.0)'],
      ['vec3 colour', 'mix(vec3(0.02, 0.04, 0.02), vec3(0.75, 1.0, 0.25), glow)'],
    ],
    result: 'vec2(nextPhase, glow)',
    outputType: 'vec2',
    exposed: [{ name: 'deposit', type: 'vec4' }, { name: 'colour', type: 'vec3' }],
    wires: { mem: ['ffIn', 'memory'], seen: ['ffSee', 'here'], index: ['ffIn', 'index'], age: ['ffIn', 'age'], rnd: ['ffIn', 'random'] },
    note: [
      'Firefly clock (an Expression Block): the whole synchrony rule. Its Result is the new Memory (clock, glow); deposit and colour are extra outputs. Period, Spread, Coupling and Deaf are Play controls.',
      'phase0: its clock as the step begins; on its very first step a random one, so the meadow starts out of step.',
      'own: a number 0–1 of its own (from its Index), the same every step. pace: how fast its clock runs: one cycle in Period seconds, each firefly a little faster or slower (Spread).',
      'listening: 1 once its clock is past Deaf (just after flashing a firefly ignores light, so it doesn\'t answer its neighbours\' echo of its own flash), and not in its first 0.2 s (on the step it is born every walker lays one unit of trail, which would look like everyone flashing at once). nudge: how far a flash it sees jumps its clock forward: Coupling × the light × its phase, so a firefly nearly due to flash is pulled in most (Mirollo and Strogatz\'s condition for synchrony).',
      'phase: the clock after this step. flash: 1 when it reaches 1. nextPhase: back to 0 after a flash. glow: its own light, 1 at a flash and fading (× 0.88 a step).',
      'deposit: one unit of flash light into the trail on the step it flashes, nothing otherwise. colour: dark green at rest, bright yellow-green as it glows.',
      'Try: Coupling 0 and they never fall into step; Spread 0.3 and the fast and slow ones can\'t agree; Deaf 0 and patches lock in a ragged echo.',
    ],
  });
  const wander = expr('ffWander', 840, 560, {
    label: 'Wander',
    inputs: [{ name: 'h', type: 'float' }, { name: 'rnd', type: 'float' }],
    lines: [],
    result: 'h + (fract(rnd * 256.0) - 0.5) * 0.6',
    outputType: 'float',
    wires: { h: ['ffIn', 'heading'], rnd: ['ffIn', 'random'] },
    note: ['Wander (an Expression Block): its heading, turned a little at random every step (up to ±0.3 radians), so each firefly drifts in slow curves and meets new neighbours.'],
  });
  const move = n('agentMove', 'ffMove', 1260, 560, {
    speed: 0.04, edges: 'wrap',
    ...note(['Move: drifts along the wandering heading, slowly (0.04 picture units a second). Wrap: off one edge, back on the other. Try: Speed 0 and only neighbours who stay neighbours can sync, in patches.']),
  }, { heading: ['ffWander', 'result'] });
  const output = agentOut('ffOut', 1680, 140, [
    'Agent Output: Position and Velocity from Move; Memory (clock and glow), Deposit (its flash) and Colour from the Firefly clock.',
  ], {
    position: ['ffMove', 'position'], velocity: ['ffMove', 'velocity'],
    memory: ['ffClock', 'result'], deposit: ['ffClock', 'deposit'], colour: ['ffClock', 'colour'],
  });

  const emit = n('agentEmit', 'ffEmit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random',
    ...note(['Emit: every firefly starts at a random place on the picture, facing anywhere, all at once (Fill).']),
  });
  let group = agentsGroup('fireflies', X(420), Y(0), 'ffEmit', [inputs, see, clock, wander, move, output], {
    label: 'Fireflies', tier: '64k', stepsPerFrame: 1, preroll: 0,
    ...note([
      'Agents: 65,536 fireflies (64k), 1 step a frame (a step is 1/60 s, so a 1-second Period is a flash a second). Inside (double-click): Sense sees the flash light, the Firefly clock runs and nudges each clock, Wander and Move drift.',
      'Try: 2 steps a frame for the same story twice as fast; Count 256k for a denser meadow (lower Coupling, as each sees more light).',
    ]),
  });
  group = groupInput(group, 'flashes', 'texture', 'Flashes', ['ffTrail', 'texture']);
  const deposit = n('agentDeposit', 'ffDeposit', X(840), Y(0), {
    amount: 1, size: 1, what: 'trail',
    ...note(['Deposit: a flashing firefly leaves one unit of light in the trail; the others leave nothing.']),
  }, { agents: ['fireflies', 'agents'] });
  const trail = n('trailField', 'ffTrail', X(1260), Y(0), {
    resolution: '512', diffuse: 1, halfLife: 0.05, edges: 'wrap', gain: 2, kernel: '5',
    ...note([
      'Trail field: the flash light. It spreads a few pixels (the soft 5×5 spread) and is gone in a fraction of a second (half-life 0.05 s): a firefly sees only flashes near it, and only as they happen.',
      'Try: Spread 3×3 for shorter sight (smaller patches, slower to agree).',
    ]),
  }, { deposit: ['ffDeposit', 'deposit'] });
  const uv = n('uv', 'ffUv', X(840), Y(420), { ...note(['UV: where each pixel is, for the night backdrop.']) });
  const night = expr('ffNight', X(1680), Y(420), {
    label: 'Night meadow',
    inputs: [{ name: 'uv', type: 'vec2' }, { name: 'light', type: 'float' }],
    lines: [['float h', 'uv.y * 0.5 + 0.5']],
    result: 'mix(vec3(0.01, 0.025, 0.015), vec3(0.01, 0.015, 0.04), h) + vec3(0.35, 0.5, 0.1) * light * 0.6',
    outputType: 'vec3',
    wires: { uv: ['ffUv', 'uv'], light: ['ffTrail', 'amount'] },
    note: [
      'Night meadow (an Expression Block): dark green grass at the bottom to a dark blue sky at the top, lit faintly where flashes are.',
      'h: 0 at the bottom of the picture, 1 at the top.',
    ],
  });
  const draw = n('drawAgents', 'ffDraw', X(2100), Y(0), {
    style: 'glow', colorBy: 'agent', size: 3, brightness: 1.6, glow: 1, scaleBy: 'walker', fade: 'off', lights: '0',
    ...note(['Draw agents, Glow: each firefly as a glowing dot in its own Colour: dim at rest, bright yellow-green as it flashes, so you see the flashes ripple and then beat together.']),
  }, { agents: ['fireflies', 'agents'], over: ['ffNight', 'result'] });
  const nodes = [emit, group, deposit, trail, uv, night, draw];
  if (withOutput) nodes.push(n('output', 'ffOutput', X(2520), Y(0), { ...note(['Output: the fireflies over the night meadow are the picture.']) }, { color: ['ffDraw', 'color'] }));
  return nodes;
}

const firefliesPlay = play([
  inner('coupling', 'fireflies', 'ffClockCoupling', 'value', 'Coupling', 0, 2),
  inner('period', 'fireflies', 'ffClockPeriod', 'value', 'Period (s)', 0.2, 4),
  inner('spread', 'fireflies', 'ffClockSpread', 'value', 'Spread of paces', 0, 0.5),
  inner('deaf', 'fireflies', 'ffClockDeaf', 'value', 'Deaf after a flash', 0, 0.9),
  ctl('again', 'fireflies::restart', 'Start over', 0, 1),
], `**What it shows.** Fireflies that teach themselves to flash together. Each has its own clock and flashes when it runs out; a firefly that sees a flash nearby jumps its clock a little forward. At first the meadow twinkles at random, then patches flash together, the patches spread as waves and merge, and the whole meadow beats as one (Mirollo and Strogatz, 1990).

**How it's built.** Inside the Agents group, Sense reads how much flash light reaches the firefly and one Expression Block (Firefly clock) keeps its clock in Memory.x and its glow in Memory.y. On the step its clock passes 1 it deposits one unit of light and starts again. The Trail spreads that light a few pixels and lets it die in a twentieth of a second.

**Try.** **Coupling** is how strongly a flash pulls a clock: 0 never syncs, high syncs in seconds. **Spread of paces** makes the fireflies' own rhythms differ, which fights the coupling. **Deaf after a flash** stops a firefly answering its own echo. **Period** is the time between flashes.`);

// ── Infection spread (SIR, with immunity that wears off) ─────────────────────

/**
 * Kermack & McKendrick's SIR model as walkers: each person is Susceptible, Infected or Recovered
 * (Memory.x), with the time in that state in Memory.y. The infected breathe infection into the
 * trail; a susceptible person catches it with a chance that grows with how much is in the air where
 * they stand; the infected recover after a while and are immune for a while (SIRS). In a crowd that
 * only mixes locally the epidemic travels as rings and, once immunity wears off, as spirals.
 */
export function infectionNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('irIn', [{ key: 'air', type: 'texture', label: 'Infection' }], [
    'Agent Inputs: this person as the step begins. Memory is what they carried over: x is their state (0 just born, 1 susceptible, 2 infected, 3 recovered and immune), y the seconds they have been in it.',
    'Infection is an input added to the group: the Trail field from outside, as it was one step ago: how much infection the infected have breathed into the air at each place.',
  ]);
  const channel = expr('irChannel', 0, 560, {
    label: 'Infection channel',
    inputs: [],
    lines: [],
    result: 'vec4(0.0, 1.0, 0.0, 0.0)',
    outputType: 'vec4',
    note: [
      'Infection channel (an Expression Block): picks the trail\'s second channel for Sense. The infection lives there, not in the first, because on the step they are born all walkers lay one unit in the first channel (their species\'), and that burst must not count as everyone coughing at once.',
    ],
  });
  const air = n('agentSense', 'irAir', 420, 100, {
    angle: 45, distance: 0.02, weight: 1, width: '1',
    ...note([
      'Sense, used only as a reader: Here is how much infection is in the air where this person stands (the second channel, picked by Infection channel). Its sensors and Steer are not used: people don\'t walk toward or away from it (try a second Sense and Steer, Away, for a cautious crowd).',
    ]),
  }, { texture: ['irIn', 'air'], channels: ['irChannel', 'result'] });
  const sir = expr('irRule', 840, 100, {
    label: 'S → I → R',
    inputs: [
      { name: 'mem', type: 'vec2' }, { name: 'exposure', type: 'float' }, { name: 'rnd', type: 'float' },
      { name: 'infectivity', type: 'float', slider: { min: 0, max: 20 } }, { name: 'sickDays', type: 'float', slider: { min: 0.1, max: 10 } },
      { name: 'immuneDays', type: 'float', slider: { min: 0, max: 60 } }, { name: 'firstCases', type: 'float', slider: { min: 0, max: 0.01 } },
      { name: 'imported', type: 'float', slider: { min: 0, max: 0.001 } },
    ],
    values: { infectivity: 1.5, sickDays: 0.7, immuneDays: 12, firstCases: 0.0001, imported: 0.00002 },
    lines: [
      ['float state', 'mem.x < 0.5 ? (rnd < firstCases ? 2.0 : 1.0) : mem.x'],
      ['float since', 'mem.x < 0.5 ? 0.0 : mem.y + 1.0 / 60.0'],
      ['float roll', 'rnd'],
      ['float catchChance', '1.0 - exp(-(infectivity * exposure + imported) / 60.0)'],
      ['float catches', 'step(state, 1.5) * (1.0 - step(catchChance, roll))'],
      ['float recovers', 'step(1.5, state) * step(state, 2.5) * step(sickDays, since)'],
      ['float wanes', 'step(2.5, state) * step(immuneDays, since) * step(0.01, immuneDays)'],
      ['float next', 'catches > 0.5 ? 2.0 : recovers > 0.5 ? 3.0 : wanes > 0.5 ? 1.0 : state'],
      ['float changed', 'step(0.5, abs(next - state))'],
      ['float infected', 'step(1.5, next) * step(next, 2.5)'],
      ['vec4 deposit', 'vec4(0.0, infected, 0.0, 0.0)'],
      ['float immunity', 'step(2.5, next) * (1.0 - clamp(since / max(immuneDays, 0.01), 0.0, 1.0))'],
      ['vec3 colour', 'infected > 0.5 ? vec3(1.0, 0.32, 0.12) : mix(vec3(0.16, 0.3, 0.62), vec3(0.25, 0.85, 0.45), immunity)'],
    ],
    result: 'vec2(next, changed > 0.5 ? 0.0 : since)',
    outputType: 'vec2',
    exposed: [{ name: 'deposit', type: 'vec4' }, { name: 'colour', type: 'vec3' }],
    wires: { mem: ['irIn', 'memory'], exposure: ['irAir', 'here'], rnd: ['irIn', 'random'] },
    note: [
      'S → I → R (an Expression Block): the whole epidemic rule. Its Result is the new Memory (state, time in it); deposit and colour are extra outputs. Infectivity, Sick days, Immune days, First cases and Imported are Play controls (a "day" here is a second of simulated time).',
      'state: S = 1, I = 2, R = 3; on their first step each person is susceptible, or one of the First cases (a share of everyone, at random). since: seconds in that state, counting up.',
      'roll: this step\'s random number itself, 0–1 (its full precision: the chances here are as small as one in a million). catchChance: the chance a susceptible person catches it this step, 1 − e^(−(Infectivity × exposure + Imported) × dt): the more infection in the air, the likelier (Kermack and McKendrick\'s mass action, made local), plus a tiny chance of catching it from outside (Imported), which keeps the epidemic from dying out for good.',
      'catches: susceptible and the dice say yes (roll below the chance, written 1 − step(chance, roll) so that a chance of 0 never fires). recovers: infected for Sick days. wanes: immune for Immune days (0: immune for good, plain SIR).',
      'next: the new state. changed: 1 when the state changed this step, so since starts again from 0. infected: 1 while infected.',
      'deposit: the infected breathe one unit of infection into the trail\'s second channel every step; nobody else does. immunity: 1 just after recovering, fading to 0 as immunity wears off.',
      'colour: hot orange while infected; green while immune, fading back to the susceptible blue as immunity wears off.',
    ],
  });
  const wander = expr('irWander', 840, 600, {
    label: 'Wander',
    inputs: [{ name: 'h', type: 'float' }, { name: 'rnd', type: 'float' }],
    lines: [],
    result: 'h + (fract(rnd * 256.0) - 0.5) * 0.8',
    outputType: 'float',
    wires: { h: ['irIn', 'heading'], rnd: ['irIn', 'random'] },
    note: ['Wander (an Expression Block): its heading turned a little at random every step (up to ±0.4 radians): people mill about, each in slow curves.'],
  });
  const move = n('agentMove', 'irMove', 1260, 600, {
    speed: 0.03, edges: 'wrap',
    ...note([
      'Move: people stroll along the wandering heading at 0.03 picture units a second. Wrap: off one edge, back on the other.',
      'Try: Speed 0.3: people travel further while infected, the rings blur and the epidemic burns through far faster (that is why travel matters).',
    ]),
  }, { heading: ['irWander', 'result'] });
  const output = agentOut('irOut', 1680, 140, [
    'Agent Output: Position and Velocity from Move; Memory (state, time in it), Deposit (the infection they breathe out) and Colour from S → I → R.',
  ], {
    position: ['irMove', 'position'], velocity: ['irMove', 'velocity'],
    memory: ['irRule', 'result'], deposit: ['irRule', 'deposit'], colour: ['irRule', 'colour'],
  });

  const emit = n('agentEmit', 'irEmit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random',
    ...note(['Emit: everyone starts at a random place on the picture, all at once (Fill). Memory starts at 0: the rule makes them susceptible, or one of the first cases, on their first step.']),
  });
  let group = agentsGroup('epidemic', X(420), Y(0), 'irEmit', [inputs, channel, air, sir, wander, move, output], {
    label: 'Epidemic', tier: '256k', stepsPerFrame: 2, seed: 3, preroll: 0,
    ...note([
      'Agents: 262,144 people (256k), 2 steps a frame. Inside (double-click): Sense reads the infection in the air, S → I → R keeps each person\'s state in Memory, Wander and Move walk them about.',
      'Try: a new Seed and Start over: the first cases land elsewhere and the rings and spirals grow differently.',
    ]),
  });
  group = groupInput(group, 'air', 'texture', 'Infection', ['irTrail', 'texture']);
  const deposit = n('agentDeposit', 'irDeposit', X(840), Y(0), {
    amount: 1, size: 1, what: 'trail',
    ...note(['Deposit: each infected person breathes one unit of infection into the trail\'s second channel every step (the rule\'s deposit); the others nothing.']),
  }, { agents: ['epidemic', 'agents'] });
  const trail = n('trailField', 'irTrail', X(1260), Y(0), {
    resolution: '512', diffuse: 1, halfLife: 0.1, edges: 'wrap', gain: 1.5, kernel: '5',
    ...note([
      'Trail field: the infection in the air, 512 rows. It spreads a few pixels (5×5) and is gone in a fraction of a second (half-life 0.1 s): only people near an infected person are exposed.',
      'Try: Half-life 1 for an infection that lingers in the air: it jumps further and the waves get wider.',
    ]),
  }, { deposit: ['irDeposit', 'deposit'] });
  const uv = n('uv', 'irUv', X(840), Y(420), { ...note(['UV: where each pixel is, for the backdrop.']) });
  const back = expr('irBack', X(1680), Y(420), {
    label: 'Map',
    inputs: [{ name: 'uv', type: 'vec2' }, { name: 'air', type: 'vec4' }],
    lines: [['float vignette', '1.0 - 0.35 * dot(uv * vec2(0.55, 1.0), uv * vec2(0.55, 1.0))']],
    result: 'vec3(0.012, 0.016, 0.03) * vignette + vec3(0.6, 0.12, 0.05) * (1.0 - exp(-air.g * 1.5)) * 0.5',
    outputType: 'vec3',
    wires: { uv: ['irUv', 'uv'], air: ['irTrail', 'channels'] },
    note: [
      'Map (an Expression Block): a near-black backdrop, with a dull red haze where infection is in the air (the trail\'s second channel, softly scaled).',
      'vignette: a little darker toward the corners.',
    ],
  });
  const draw = n('drawAgents', 'irDraw', X(2100), Y(0), {
    style: 'points', colorBy: 'agent', size: 1.5, brightness: 1, scaleBy: 'walker', fade: 'off', lights: '0',
    ...note(['Draw agents: everyone as a dot in their own Colour: blue susceptible, orange infected, green immune (fading back to blue).']),
  }, { agents: ['epidemic', 'agents'], over: ['irBack', 'result'] });
  const nodes = [emit, group, deposit, trail, uv, back, draw];
  if (withOutput) nodes.push(n('output', 'irOutput', X(2520), Y(0), { ...note(['Output: the crowd over its map is the picture.']) }, { color: ['irDraw', 'color'] }));
  return nodes;
}

const infectionPlay = play([
  inner('beta', 'epidemic', 'irRuleInfectivity', 'value', 'Infectivity', 0, 20),
  inner('sick', 'epidemic', 'irRuleSickDays', 'value', 'Sick for (s)', 0.1, 10),
  inner('immune', 'epidemic', 'irRuleImmuneDays', 'value', 'Immune for (s, 0 = for good)', 0, 60),
  inner('imported', 'epidemic', 'irRuleImported', 'value', 'Imported cases', 0, 0.001),
  inner('walk', 'epidemic', 'irMove', 'speed', 'Walking speed', 0, 0.5),
  ctl('again', 'epidemic::restart', 'Start over', 0, 1),
], `**What it shows.** An epidemic in a crowd that only meets its neighbours. A few people start infected; infection spreads outward as rings, the infected recover and are immune for a while, and when immunity wears off the next wave can come back through: rings break into spirals that turn for ever (the SIRS model, after Kermack and McKendrick).

**How it's built.** Inside the Agents group, Sense reads how much infection is in the air where a person stands, and one Expression Block (S → I → R) keeps their state in Memory.x and the time in it in Memory.y. The infected deposit infection into the Trail every step; the Trail spreads it a few pixels and lets it fade fast.

**Try.** **Infectivity** is how catching it is: too low and the first cases fizzle out. **Sick for** is how long people stay infectious. **Immune for** 0 makes immunity last for good (plain SIR: one wave and done). **Walking speed** mixes the crowd: faster walking smears the rings into one big fast outbreak.`);

// ── Predators and prey ───────────────────────────────────────────────────────

/**
 * Predators and prey on a pasture (Lotka–Volterra, as walkers). Two species share one group:
 * prey (species 1) graze, flee the predators' scent and breed where prey and grass are; predators
 * (species 2) chase the prey's scent, eat, starve without it, and breed where they feed. Every walker
 * is a slot: Memory.x says whether it is alive (1) or an unborn slot waiting (0), Memory.y is its
 * energy. A walker that is eaten or starves dies (Alive 0) and Emit (Keep full) brings its slot back
 * at once, unborn and somewhere new, to wait for a parent nearby.
 */
export function predatorPreyNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('ppIn', [
    { key: 'scent', type: 'texture', label: 'Scent' },
    { key: 'grass', type: 'texture', label: 'Grass' },
  ], [
    'Agent Inputs: this walker as the step begins. Its Species (0 prey, 1 predator) came from the Emit it was born from. Memory: x is 1 while it is alive and 0 while it is an unborn slot waiting for a parent nearby; y is its energy.',
    'Scent and Grass are inputs added to the group, from outside, as they were one step ago. Scent: channel 3 is where prey are, channel 4 where predators are. Grass: channel 1 is the pasture.',
  ]);
  const chans = expr('ppChans', 0, 640, {
    label: 'What to smell',
    inputs: [{ name: 'species', type: 'float' }, { name: 'fear', type: 'float', slider: { min: 0, max: 4 } }],
    values: { fear: 2 },
    lines: [['float isPredator', 'step(0.5, species)']],
    result: 'mix(vec4(0.0, 0.0, 0.0, -fear), vec4(0.0, 0.0, 1.0, 0.0), isPredator)',
    outputType: 'vec4',
    wires: { species: ['ppIn', 'species'] },
    exposed: [{ name: 'isPredator', type: 'float' }],
    note: [
      'What to smell (an Expression Block): the scent channels this walker steers by, for Sense\'s Channels. Fear is a Play control.',
      'isPredator: 1 for a predator (species 2), 0 for prey.',
      'Result: a predator follows the prey\'s scent (channel 3, +1); a prey runs from the predators\' scent (channel 4, −Fear).',
    ],
  });
  const smell = n('agentSense', 'ppSmell', 420, 100, {
    angle: 40, distance: 0.04, weight: 1, width: '1',
    ...note([
      'Sense (scent): reads the Scent trail 0.04 ahead, 40° left, straight on and 40° right, weighed by What to smell; its Readings go to Choose a way after the grass is added (through + Other readings).',
      'Its Channels here output is the scent where the walker stands, all four channels, for the Life and death rule.',
    ]),
  }, { texture: ['ppIn', 'scent'], channels: ['ppChans', 'result'], also: ['ppGrassSense', 'readings'] });
  const grassChan = expr('ppGrassChan', 420, 640, {
    label: 'Grass appetite',
    inputs: [{ name: 'isPredator', type: 'float' }],
    lines: [],
    result: 'vec4(1.0 - isPredator, 0.0, 0.0, 0.0)',
    outputType: 'vec4',
    wires: { isPredator: ['ppChans', 'isPredator'] },
    note: ['Grass appetite (an Expression Block): prey are drawn to grass (channel 1 of the Grass trail, +1); predators don\'t care about it (0).'],
  });
  const grassSense = n('agentSense', 'ppGrassSense', 840, 640, {
    angle: 40, distance: 0.04, weight: 0.5, width: '1',
    ...note([
      'Sense (grass): reads the Grass trail at the same three points, weighed by Grass appetite (× 0.5): prey lean toward the greener side. Its Readings are added to the scent\'s (wired into its + Other readings), and its Here output is the grass where the walker stands.',
    ]),
  }, { texture: ['ppIn', 'grass'], channels: ['ppGrassChan', 'result'] });
  const way = expr('ppWay', 840, 100, {
    label: 'Choose a way',
    inputs: [
      { name: 'reads', type: 'vec3' }, { name: 'h', type: 'float' }, { name: 'rnd', type: 'float' },
      { name: 'turn', type: 'float', slider: { min: 0, max: 90 } },
    ],
    values: { turn: 25 },
    lines: [
      ['float lean', 'clamp((reads.x - reads.z) / (abs(reads.x) + abs(reads.z) + 0.05), -1.0, 1.0)'],
      ['float wobble', '(fract(rnd * 256.0) - 0.5) * 0.6'],
    ],
    result: 'h + radians(turn) * lean + wobble',
    outputType: 'float',
    wires: { reads: ['ppSmell', 'readings'], h: ['ppIn', 'heading'], rnd: ['ppIn', 'random'] },
    note: [
      'Choose a way (an Expression Block, in place of Steer): a smooth turn toward whichever side reads more. Turn is a Play control.',
      'lean: −1 to 1, how much more the left sensor reads than the right (the 0.05 keeps a whisper of scent from swinging it fully). wobble: a small random turn every step, so walkers with nothing to smell still roam.',
      'Result: the new heading: up to Turn degrees toward the better side, plus the wobble.',
    ],
  });
  const life = expr('ppLife', 1260, 100, {
    label: 'Life and death',
    inputs: [
      { name: 'mem', type: 'vec2' }, { name: 'scent', type: 'vec4' }, { name: 'grass', type: 'float' }, { name: 'isPredator', type: 'float' },
      { name: 'rnd', type: 'float' }, { name: 'time', type: 'float' },
      { name: 'preyBirth', type: 'float', slider: { min: 0, max: 5 } }, { name: 'predatorBirth', type: 'float', slider: { min: 0, max: 5 } },
      { name: 'kill', type: 'float', slider: { min: 0, max: 20 } }, { name: 'hunger', type: 'float', slider: { min: 0, max: 2 } },
    ],
    values: { preyBirth: 1.5, predatorBirth: 0.5, kill: 1.5, hunger: 0.48 },
    lines: [
      ['float alive', 'step(0.5, mem.x)'],
      ['float energy', 'mem.y'],
      ['float prey', '1.0 - exp(-scent.b / 3.0)'],
      ['float predators', '1.0 - exp(-scent.a / 2.0)'],
      ['float food', '1.0 - exp(-grass / 1.5)'],
      ['float roll', 'rnd'],
      ['float atStart', 'step(time, 0.05)'],
      ['float startShare', 'mix(0.25, 0.03, isPredator)'],
      ['float hatchRate', 'mix(preyBirth * prey * (1.0 - prey) * food + 0.003, predatorBirth * predators * prey + 0.0005, isPredator)'],
      ['float hatches', '(1.0 - alive) * (atStart > 0.5 ? 1.0 - step(startShare, roll) : 1.0 - step(hatchRate / 60.0, roll))'],
      ['float eatenChance', '(1.0 - isPredator) * kill * predators / 60.0'],
      ['float eaten', 'alive * (1.0 - step(eatenChance, fract(rnd * 4096.0)))'],
      ['float gain', 'mix(food * 0.8 - 0.3, prey * 1.5 - hunger * 3.0, isPredator)'],
      ['float nextEnergy', 'hatches > 0.5 ? 1.0 : clamp(energy + gain / 60.0, -1.0, 2.0)'],
      ['float starved', 'alive * step(nextEnergy, 0.0)'],
      ['float living', 'max(alive, hatches) * (1.0 - eaten) * (1.0 - starved)'],
      ['float dies', 'max(eaten, starved)'],
      ['float speed', 'mix(0.02, mix(0.16, 0.2, isPredator), living)'],
      ['vec4 deposit', 'vec4(-0.005 * living * (1.0 - isPredator), 0.0, living * (1.0 - isPredator), living * isPredator)'],
      ['vec3 colour', 'living * mix(vec3(0.95, 0.92, 0.65), vec3(1.0, 0.22, 0.12), isPredator)'],
    ],
    result: 'vec2(living, nextEnergy)',
    outputType: 'vec2',
    exposed: [{ name: 'dies', type: 'float' }, { name: 'speed', type: 'float' }, { name: 'deposit', type: 'vec4' }, { name: 'colour', type: 'vec3' }],
    wires: {
      mem: ['ppIn', 'memory'], scent: ['ppSmell', 'sample'], grass: ['ppGrassSense', 'here'], isPredator: ['ppChans', 'isPredator'],
      rnd: ['ppIn', 'random'], time: ['ppTime', 'time'],
    },
    note: [
      'Life and death (an Expression Block): births, meals, hunger and deaths. Its Result is the new Memory (alive, energy); dies, speed, deposit and colour are extra outputs. Prey birth, Predator birth, Kill and Hunger are Play controls (rates are per second).',
      'alive: 1 while alive (Memory.x). energy: Memory.y. prey, predators: how much prey and predator scent is here, each softly scaled to 0–1. food: how much grass is here, 0–1. roll: this step\'s random number.',
      'atStart: 1 on the first few steps of the run. startShare: the share of slots alive at the start (a quarter of the prey, 3% of the predators).',
      'hatchRate: how often an unborn slot comes alive, a second. Prey: Prey birth × prey × (1 − prey) × food, so prey breed where prey already are, but not where they are packed, and only on grass. Predators: Predator birth × predators × prey: they breed where they are feeding. Each has a tiny base rate (0.003, 0.0005), as if a few wandered in from outside.',
      'hatches: an unborn slot comes alive this step (on the dice: roll below the rate × dt, written 1 − step(rate, roll) so that a rate of 0 never fires). eatenChance: for prey, Kill × the predators here, a second. eaten: a live prey is caught this step.',
      'gain: energy gained a second: prey 0.8 × food − 0.3 (grass feeds them, bare ground starves them); predators 1.5 × prey − 3 × Hunger. nextEnergy: 1 when it hatches, else energy + gain × dt (kept between −1 and 2). starved: alive and out of energy.',
      'living: alive after this step (hatched or alive, and neither eaten nor starved). dies: eaten or starved: Alive 0, and Emit gives the slot back, unborn, somewhere new.',
      'speed: unborn slots drift slowly (0.02); live prey run at 0.16 and predators at 0.2, a little faster, or they would never catch anything.',
      'deposit: channel 1 −0.005 (a live prey eats that much grass a step: on the Grass trail), channel 3 a live prey\'s scent, channel 4 a live predator\'s. colour: cream prey, red predators, unborn slots black (invisible).',
    ],
  });
  const time = n('time', 'ppTime', 840, 1000, { ...note(['Time: inside the group it is this step\'s (simulated) time, so Life and death knows the first few steps of a run, when the starting animals are born.']) });
  const alive = expr('ppAlive', 1680, 560, {
    label: 'Still alive',
    inputs: [{ name: 'dies', type: 'float' }],
    lines: [],
    result: '1.0 - dies',
    outputType: 'float',
    wires: { dies: ['ppLife', 'dies'] },
    note: ['Still alive (an Expression Block): 0 the step a walker is eaten or starves, for Agent Output\'s Alive: below 0.5 the walker dies, and Emit (Keep full) gives its slot a new life at once.'],
  });
  const move = n('agentMove', 'ppMove', 1680, 100, {
    speed: 0.16, edges: 'wrap',
    ...note(['Move: one step along the chosen way at the speed Life and death gives it. Wrap: off one edge, back on the other.']),
  }, { heading: ['ppWay', 'result'], speed: ['ppLife', 'speed'] });
  const output = agentOut('ppOut', 2100, 140, [
    'Agent Output: Position and Velocity from Move; Alive from Still alive; Memory (alive, energy), Deposit (scent, grazing) and Colour from Life and death.',
  ], {
    position: ['ppMove', 'position'], velocity: ['ppMove', 'velocity'], alive: ['ppAlive', 'result'],
    memory: ['ppLife', 'result'], deposit: ['ppLife', 'deposit'], colour: ['ppLife', 'colour'],
  });

  // ── Outside ──
  const emitPrey = n('agentEmit', 'ppEmitPrey', X(0), Y(0), {
    mode: 'respawn', shape: 'screen', heading: 'random', life: 0, species: '1', share: 3,
    ...note([
      'Emit (prey, species 1): three quarters of the slots, anywhere on the picture. Births Keep full with Life 0 (for ever): a slot is only given back when its walker dies (eaten or starved), at once, unborn (Memory 0), somewhere new.',
      'Its "+ Another Emit" takes the predators\' Emit; births are shared by Share (3 to 1).',
    ]),
  }, { also: ['ppEmitPred', 'emitter'] });
  const emitPred = n('agentEmit', 'ppEmitPred', X(0), Y(380), {
    mode: 'respawn', shape: 'screen', heading: 'random', life: 0, species: '2', share: 1,
    ...note(['Emit (predators, species 2): the other quarter of the slots, the same way.']),
  });
  let group = agentsGroup('predprey', X(420), Y(0), 'ppEmitPrey', [inputs, chans, smell, grassChan, grassSense, way, life, time, alive, move, output], {
    label: 'Predators and prey', species: '2', tier: '256k', stepsPerFrame: 2, seed: 2, preroll: 0,
    ...note([
      'Agents: 262,144 slots (256k) of 2 species, 2 steps a frame. Not all are alive: each slot is an animal or an unborn place waiting for a parent nearby, so the populations can rise and fall.',
      'Inside (double-click): two Senses read the scent and the grass, Choose a way turns, Life and death decides births, meals and deaths, Move walks.',
    ]),
  });
  group = groupInput(group, 'scent', 'texture', 'Scent', ['ppScent', 'texture']);
  group = groupInput(group, 'grass', 'texture', 'Grass', ['ppGrass', 'texture']);
  const depScent = n('agentDeposit', 'ppDepScent', X(840), Y(0), {
    amount: 1, size: 1, what: 'trail',
    ...note(['Deposit (scent): every walker\'s deposit into the Scent trail: channel 3 for live prey, channel 4 for live predators (its channel 1, the grazing, is negative and is kept at 0 there).']),
  }, { agents: ['predprey', 'agents'] });
  const scent = n('trailField', 'ppScent', X(1260), Y(0), {
    resolution: '512', diffuse: 1, halfLife: 0.15, edges: 'wrap', gain: 0.3, kernel: '5',
    ...note([
      'Trail field (scent): where prey (channel 3) and predators (channel 4) are, spread a few pixels and gone in a fraction of a second: a map of the herds and the hunting packs.',
      'Channels 1 and 2 only ever hold the one unit every walker lays on the step it is born (its species\' channel): nothing reads them.',
    ]),
  }, { deposit: ['ppDepScent', 'deposit'] });
  const depGrass = n('agentDeposit', 'ppDepGrass', X(840), Y(420), {
    amount: 1, size: 2, what: 'trail',
    ...note(['Deposit (grazing): the same deposit into the Grass trail, two pixels square: its channel 1 is −0.005 a step under every live prey, which eats the grass there.']),
  }, { agents: ['predprey', 'agents'] });
  const uv = n('uv', 'ppUv', X(840), Y(800), { ...note(['UV: where each trail pixel (and picture pixel) is, for Regrowth.']) });
  const regrow = expr('ppRegrow', X(1260), Y(800), {
    label: 'Regrowth',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [['float fertile', '0.75 + 0.25 * sin(uv.x * 3.0 + 1.0) * sin(uv.y * 4.0)']],
    result: 'vec4(0.35 * fertile, 0.0, 0.0, 0.0)',
    outputType: 'vec4',
    wires: { uv: ['ppUv', 'uv'] },
    note: [
      'Regrowth (an Expression Block): grass growing back, painted into the Grass trail every step (its Add, per second).',
      'fertile: some ground grows faster than other (0.5 to 1), so the herds have places to head for. Result: 0.35 × fertile a second in channel 1.',
    ],
  });
  const grass = n('trailField', 'ppGrass', X(1260), Y(420), {
    resolution: '512', diffuse: 0.05, halfLife: 3, edges: 'wrap', gain: 1, kernel: '3',
    ...note([
      'Trail field (grass): the pasture, channel 1. It grows back (Add: Regrowth), creeps a little (Diffuse 0.05) and withers when left long (half-life 3 s), so on its own it settles at about 1.5. Prey graze it down where they gather.',
      'Its other channels collect the scent deposits too and are never read.',
    ]),
  }, { deposit: ['ppDepGrass', 'deposit'], add: ['ppRegrow', 'result'] });
  const land = expr('ppLand', X(1680), Y(420), {
    label: 'Land',
    inputs: [{ name: 'grass', type: 'vec4' }, { name: 'scent', type: 'vec4' }],
    lines: [
      ['float green', '1.0 - exp(-max(grass.r, 0.0) / 1.2)'],
      ['vec3 ground', 'mix(vec3(0.07, 0.05, 0.03), vec3(0.08, 0.26, 0.08), green)'],
      ['float hunt', '1.0 - exp(-max(scent.a, 0.0) * 0.3)'],
    ],
    result: 'ground + vec3(0.45, 0.06, 0.02) * hunt',
    outputType: 'vec3',
    wires: { grass: ['ppGrass', 'channels'], scent: ['ppScent', 'channels'] },
    note: [
      'Land (an Expression Block): the picture under the animals.',
      'green: how grassy it is here, 0–1. ground: bare brown earth to green pasture. hunt: the predators\' scent, a red glow where packs are hunting.',
    ],
  });
  const draw = n('drawAgents', 'ppDraw', X(2100), Y(0), {
    style: 'points', colorBy: 'agent', size: 1.5, brightness: 0.8, scaleBy: 'walker', fade: 'off', lights: '0',
    ...note(['Draw agents: every walker as a dot in its own Colour: cream prey, red predators; unborn slots are black, so they add nothing.']),
  }, { agents: ['predprey', 'agents'], over: ['ppLand', 'result'] });
  const nodes = [emitPrey, emitPred, group, depScent, scent, depGrass, uv, regrow, grass, land, draw];
  if (withOutput) nodes.push(n('output', 'ppOutput', X(2520), Y(0), { ...note(['Output: the animals over the land are the picture.']) }, { color: ['ppDraw', 'color'] }));
  return nodes;
}

const predatorPreyPlay = play([
  inner('preyBirth', 'predprey', 'ppLifePreyBirth', 'value', 'Prey birth', 0, 5),
  inner('predBirth', 'predprey', 'ppLifePredatorBirth', 'value', 'Predator birth', 0, 5),
  inner('kill', 'predprey', 'ppLifeKill', 'value', 'Kill rate', 0, 20),
  inner('hunger', 'predprey', 'ppLifeHunger', 'value', 'Predator hunger', 0, 2),
  inner('fear', 'predprey', 'ppChansFear', 'value', 'Prey fear', 0, 4),
  inner('turn', 'predprey', 'ppWayTurn', 'value', 'Turn (°)', 0, 90),
  ctl('again', 'predprey::restart', 'Start over', 0, 1),
], `**What it shows.** Predators and prey on a pasture, as Lotka and Volterra described them, but as animals that move. Prey graze and multiply; predators find them by scent, eat, multiply and starve when the prey are gone. Herds and hunting packs chase each other across the land in waves: wherever prey boom, predators follow and wipe them out, then die back, and the grass and the prey return.

**How it's built.** One Agents group with two species. Every walker is a slot: Memory.x says whether it is alive or waiting to be born, Memory.y is its energy. Two Senses read the scent (where prey and predators are) and the grass; Choose a way turns toward or away from them; Life and death (one Expression Block) decides births, meals, hunger and deaths. A walker that dies sets Alive to 0 and Emit (Keep full) gives its slot back, unborn. The grass is a second Trail: it grows back (Add) and the prey eat it (negative Deposit).

**Try.** **Prey birth** and **Predator birth** are how fast each multiplies. **Kill rate** is how deadly a predator is; too deadly and they eat everything and starve. **Predator hunger** is how fast they burn energy. **Prey fear** is how hard prey run from the predators' scent.`);

// ── Sand drift: erosion and deposition ───────────────────────────────────────

/**
 * Wind-blown sand (after Werner's 1995 slab model of dunes, as walkers). The sand's height is a Trail
 * that never fades. Each walker is a gust: empty, it lifts a slab where there is sand (−) unless it
 * is in the wind shadow behind a crest; carrying (Memory.x), it is blown downwind and drops the slab
 * (+) more readily on sand than on bare ground, and always in a wind shadow. A little spreading in the
 * Trail plays the part of avalanches. Ripples grow out of a flat bed and merge into dunes that march
 * downwind.
 */
export function sandDriftNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('sdIn', [{ key: 'sand', type: 'texture', label: 'Sand' }], [
    'Agent Inputs: this gust as the step begins. Memory is what it carried over: x is what it is doing (0 laying the first sand, 1 blowing empty, 2 carrying a slab of sand), y how long it has carried it (seconds).',
    'Sand is an input added to the group: the Trail field from outside, as it was one step ago: how deep the sand is everywhere.',
  ]);
  const windDir = expr('sdWindDir', 0, 600, {
    label: 'Wind',
    inputs: [{ name: 'angle', type: 'float', slider: { min: -180, max: 180 } }],
    values: { angle: 10 },
    lines: [],
    result: 'radians(angle)',
    outputType: 'float',
    exposed: [],
    note: [
      'Wind (an Expression Block): which way the wind blows, as a heading in radians (from Angle, in degrees: 0 blows to the right, 90 up). A Play control.',
    ],
  });
  const back = expr('sdBack', 420, 600, {
    label: 'Look upwind',
    inputs: [{ name: 'wind', type: 'float' }],
    lines: [],
    result: 'wind + 3.1415927',
    outputType: 'float',
    wires: { wind: ['sdWindDir', 'result'] },
    note: ['Look upwind (an Expression Block): the wind\'s heading turned right round, for Sense\'s Heading, so its middle sensor looks back into the wind.'],
  });
  const res = n('resolution', 'sdRes', 0, 900, { ...note(['Resolution: the picture\'s size in pixels, so On the grid can work out the trail\'s cells exactly.']) });
  const grid = gridBlock('sdGrid', 420, 900, 512, { pos: ['sdIn', 'position'], res: ['sdRes', 'res'] },
    'the gust reads the sand in exactly the trail pixel it stands in, the one its Deposit will change, so a slab is never lifted from a pixel that hasn\'t got one.');
  const look = n('agentSense', 'sdLook', 840, 100, {
    angle: 20, distance: 0.012, weight: 1, width: '1',
    ...note([
      'Sense, used as a reader: Here is how deep the sand is in the gust\'s pixel (Position: its middle, from On the grid); its middle Reading (the y of Readings) is the sand 0.012 upwind (its Heading is Look upwind\'s). If upwind is much higher, this spot is in the wind shadow behind a crest.',
    ]),
  }, { texture: ['sdIn', 'sand'], heading: ['sdBack', 'result'], position: ['sdGrid', 'result'] });
  const rule = expr('sdRule', 1260, 100, {
    label: 'Lift, drop and slump',
    inputs: [
      { name: 'mem', type: 'vec2' }, { name: 'here', type: 'float' }, { name: 'reads', type: 'vec3' }, { name: 'grad', type: 'vec2' },
      { name: 'age', type: 'float' }, { name: 'rnd', type: 'float' },
      { name: 'wind', type: 'float' }, { name: 'gust', type: 'float', slider: { min: 0, max: 2 } },
      { name: 'lift', type: 'float', slider: { min: 0, max: 0.5 } }, { name: 'stickSand', type: 'float', slider: { min: 0, max: 1 } },
      { name: 'stickBare', type: 'float', slider: { min: 0, max: 1 } }, { name: 'shadowDrop', type: 'float', slider: { min: 0, max: 5 } },
      { name: 'repose', type: 'float', slider: { min: 0.2, max: 5 } },
    ],
    values: { gust: 0.6, lift: 0.1, stickSand: 0.3, stickBare: 0.08, shadowDrop: 1, repose: 1 },
    lines: [
      ['float job', 'mem.x'],
      ['float aloft', 'mem.y'],
      ['float slab', '0.5'],
      ['float roll', 'rnd'],
      ['float seeding', 'step(job, 0.5) * step(age, 0.5)'],
      ['float upwind', 'reads.y'],
      ['float shadow', 'step(shadowDrop, upwind - here)'],
      ['float slope', 'length(grad) * 2.0 / 512.0'],
      ['float empty', 'step(0.5, job) * step(job, 1.5)'],
      ['float carrying', 'step(1.5, job) * step(job, 2.5)'],
      ['float picks', 'empty * step(slab * 2.0, here) * (1.0 - shadow) * (1.0 - step(lift, roll))'],
      ['float slumps', 'empty * (1.0 - picks) * step(slab * 3.0, here) * step(repose, slope) * (1.0 - step(0.1, fract(roll * 256.0)))'],
      ['float landChance', 'shadow > 0.5 ? 1.0 : (here > slab ? stickSand : stickBare)'],
      ['float lands', 'carrying * step(0.05, aloft) * (1.0 - step(landChance, fract(roll * 4096.0)))'],
      ['float settles', 'step(3.5, job)'],
      ['float nextJob', 'job < 0.5 ? (seeding > 0.5 ? 0.0 : 1.0) : job < 1.5 ? (picks > 0.5 ? 2.0 : slumps > 0.5 ? 3.0 : 1.0) : job < 2.5 ? (lands > 0.5 ? 1.0 : 2.0) : job < 3.5 ? 4.0 : 1.0'],
      ['float nextAloft', 'nextJob > 1.5 && nextJob < 2.5 ? aloft * (1.0 - picks) + 1.0 / 60.0 : 0.0'],
      ['float downhill', 'atan(-grad.y, -grad.x)'],
      ['float sliding', 'step(2.5, job) * step(job, 3.5)'],
      ['float heading', 'sliding > 0.5 ? downhill : wind + (fract(roll * 64.0) - 0.5) * 0.5'],
      ['float speed', 'sliding > 0.5 ? 0.35 : max(max(picks, lands), max(slumps, settles)) > 0.5 ? 0.0 : gust'],
      ['vec4 deposit', 'vec4(seeding * 0.25 + (lands + settles - picks - slumps) * slab, 0.0, 0.0, 0.0)'],
      ['vec3 colour', 'carrying + picks > 0.5 ? vec3(1.0, 0.92, 0.75) : vec3(0.0)'],
    ],
    result: 'vec2(nextJob, nextAloft)',
    outputType: 'vec2',
    exposed: [{ name: 'heading', type: 'float' }, { name: 'speed', type: 'float' }, { name: 'deposit', type: 'vec4' }, { name: 'colour', type: 'vec3' }],
    wires: {
      mem: ['sdIn', 'memory'], here: ['sdLook', 'here'], reads: ['sdLook', 'readings'], grad: ['sdLook', 'gradient'],
      age: ['sdIn', 'age'], rnd: ['sdIn', 'random'], wind: ['sdWindDir', 'result'],
    },
    note: [
      'Lift, drop and slump (an Expression Block): the sand rule. Its Result is the new Memory; heading, speed, deposit and colour are extra outputs. Gust, Lift, Stick on sand, Stick on bare, Shadow drop and Repose are Play controls.',
      'job: what the gust is doing (Memory.x: 0 seeding, 1 empty, 2 carrying on the wind, 3 sliding a slab downhill, 4 setting it down). aloft: how long it has carried its slab (Memory.y). slab: how much sand one gust moves. roll: this step\'s random number.',
      'seeding: its first half second, when every gust sprinkles a little sand where it blows (0.25 a step): a flat, slightly rough bed to start from.',
      'upwind: the sand depth a little way upwind. shadow: 1 when upwind is higher than here by more than Shadow drop: the lee of a crest, where the wind can\'t reach. slope: how steep the sand is here, in depth per trail pixel (from Sense\'s Gradient).',
      'empty: it blows empty-handed now. carrying: it carries a slab on the wind now. picks: empty, on at least two slabs\' depth, out of the shadow, and the dice say yes (Lift, a chance a step): it lifts a slab into the wind. slumps: empty, not lifting, on a slope steeper than Repose and at least three slabs deep: one time in ten it takes a slab to slide it downhill (an avalanche, one slab at a time). Why three slabs, and why only one time in ten: several gusts in one pixel taking slabs in the same step must never take more than lies there, since a trail can only add up what they do. This also passes sand sideways between neighbouring streaks, so the sand gathers into ridges across the wind.',
      'landChance: the chance a step that a carried slab comes down: always in a shadow, Stick on sand on sand (sand catches sand: that is what makes ripples grow), Stick on bare on bare ground. lands: it has been aloft at least 0.05 s and comes down. settles: the slid slab is set down.',
      'nextJob: 0 → 1 after seeding; 1 → 2 when it lifts, 1 → 3 when it slumps; 2 → 1 when it lands; 3 → 4 → 1 as it slides and sets down. nextAloft: counting up while it carries, from 0.',
      'downhill: the way the sand falls away here. sliding: it is moving a slumped slab this step. heading: downhill while sliding, else downwind with a little wobble.',
      'speed: 0.35 while sliding (one or two pixels in a step), 0 on a step it lifts, drops or slumps (so the sand it moves is the sand of the pixel it read), else Gust. deposit: +slab where it lands or settles, −slab where it lifts or slumps, a sprinkle while seeding. colour: windblown sand as pale grains; the rest are invisible.',
    ],
  });
  const move = n('agentMove', 'sdMove', 1680, 100, {
    speed: 0.6, edges: 'wrap',
    ...note([
      'Move: every gust blows downwind at the rule\'s speed (Gust, 0.6 picture units a second: 2–3 trail pixels a step). Wrap: what blows off one edge comes in at the other, so the dunes march round and round.',
    ]),
  }, { heading: ['sdRule', 'heading'], speed: ['sdRule', 'speed'] });
  const output = agentOut('sdOut', 2100, 140, [
    'Agent Output: Position and Velocity from Move; Memory, Deposit and Colour from Lift, drop and slump.',
  ], {
    position: ['sdMove', 'position'], velocity: ['sdMove', 'velocity'],
    memory: ['sdRule', 'result'], deposit: ['sdRule', 'deposit'], colour: ['sdRule', 'colour'],
  });

  const emit = n('agentEmit', 'sdEmit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random',
    ...note(['Emit: every gust starts at a random place on the picture, all at once (Fill).']),
  });
  let group = agentsGroup('sandDrift', X(420), Y(0), 'sdEmit', [inputs, windDir, back, res, grid, look, rule, move, output], {
    label: 'Wind', tier: '256k', stepsPerFrame: 8, preroll: 0,
    ...note([
      'Agents: 262,144 gusts (256k), 8 steps a frame. Inside (double-click): Sense reads the sand here, upwind and its slope, Lift, drop and slump decides, Move blows the gust downwind.',
      'Try: Steps per frame 4 to watch the ripples form at half the pace.',
    ]),
  });
  group = groupInput(group, 'sand', 'texture', 'Sand', ['sdTrail', 'texture']);
  const deposit = n('agentDeposit', 'sdDeposit', X(840), Y(0), {
    amount: 1, size: 1, what: 'trail',
    ...note(['Deposit: each gust\'s sand changes go into the sand: +slab where it lands, −slab where it lifts.']),
  }, { agents: ['sandDrift', 'agents'] });
  const trail = n('trailField', 'sdTrail', X(1260), Y(0), {
    resolution: '512', diffuse: 0, halfLife: 10000000, edges: 'wrap', gain: 0.1, kernel: '3',
    ...note([
      'Trail field: the sand\'s depth, 512 rows. Half-life 10,000,000 s (typed past the slider\'s end, so the share kept each step rounds to exactly 1): sand never vanishes, only moves.',
      'Diffuse 0: sand doesn\'t spread by itself (the trail is stored as half floats, which round each spread step\'s fractions down, so a spreading trail would slowly lose sand).',
    ]),
  }, { deposit: ['sdDeposit', 'deposit'] });
  const relief = n('edgesTexture', 'sdRelief', X(1680), Y(420), {
    strength: 0.08, width: 6,
    ...note([
      'Edges (texture): the slope of the sand, from its Image: Direction is which way it rises, Edges how steep it is. Desert lighting is made from it.',
    ]),
  }, { texture: ['sdTrail', 'texture'] });
  const light = expr('sdLight', X(2100), Y(420), {
    label: 'Desert light',
    inputs: [{ name: 'depth', type: 'vec4' }, { name: 'dir', type: 'vec2' }, { name: 'steep', type: 'float' }],
    lines: [
      ['float d', 'max(depth.r, 0.0)'],
      ['float sun', 'dot(dir, normalize(vec2(-0.6, 0.8))) * steep'],
      ['vec3 sand', 'mix(vec3(0.55, 0.33, 0.18), vec3(0.98, 0.78, 0.5), smoothstep(0.0, 9.0, d))'],
    ],
    result: 'sand * (0.8 - 0.9 * sun) * smoothstep(0.0, 0.5, d) + vec3(0.12, 0.08, 0.06) * (1.0 - smoothstep(0.0, 0.5, d))',
    outputType: 'vec3',
    wires: { depth: ['sdTrail', 'channels'], dir: ['sdRelief', 'direction'], steep: ['sdRelief', 'edges'] },
    note: [
      'Desert light (an Expression Block): shades the sand as if the sun were low in the upper left.',
      'd: the sand\'s depth here. sun: how much this slope faces away from the sun (the slope\'s direction against the light\'s, times how steep): faces toward the sun are bright, lee slopes dark. sand: deeper sand paler.',
      'Result: lit sand, and dark rock where it is bare.',
    ],
  });
  const draw = n('drawAgents', 'sdDraw', X(2520), Y(0), {
    style: 'points', colorBy: 'agent', size: 1, brightness: 0.25, scaleBy: 'walker', fade: 'off', lights: '0',
    ...note(['Draw agents: the gusts that carry sand as faint pale grains blowing over the dunes; empty gusts are black, so they add nothing. Try: Brightness 0 for the dunes alone.']),
  }, { agents: ['sandDrift', 'agents'], over: ['sdLight', 'result'] });
  const nodes = [emit, group, deposit, trail, relief, light, draw];
  if (withOutput) nodes.push(n('output', 'sdOutput', X(2940), Y(0), { ...note(['Output: the dunes and the blowing sand are the picture.']) }, { color: ['sdDraw', 'color'] }));
  return nodes;
}

const sandDriftPlay = play([
  inner('wind', 'sandDrift', 'sdWindDirAngle', 'value', 'Wind direction (°)', -180, 180),
  inner('lift', 'sandDrift', 'sdRuleLift', 'value', 'Lift', 0, 0.5),
  inner('sand', 'sandDrift', 'sdRuleStickSand', 'value', 'Stick on sand', 0, 1),
  inner('bare', 'sandDrift', 'sdRuleStickBare', 'value', 'Stick on bare ground', 0, 1),
  inner('gust', 'sandDrift', 'sdRuleGust', 'value', 'Wind speed', 0, 2),
  inner('shadow', 'sandDrift', 'sdRuleShadowDrop', 'value', 'Shadow drop', 0, 5),
  inner('repose', 'sandDrift', 'sdRuleRepose', 'value', 'Steepest slope', 0.2, 5),
  ctl('again', 'sandDrift::restart', 'Start over', 0, 1),
], `**What it shows.** Wind building dunes out of a flat bed of sand. Each walker is a gust: it lifts a slab of sand, carries it downwind and drops it, more readily where sand already lies, and always in the wind shadow behind a crest. Ripples appear, grow, merge into dunes and march downwind (after Werner's 1995 dune model).

**How it's built.** The sand is a Trail field that never fades: Deposit −slab lifts sand, +slab drops it. Inside the group, Sense reads the sand here and a little way upwind (its Heading turned into the wind), and one Expression Block (Lift, drop and slump) keeps what the gust is doing in Memory.x (blowing empty, carrying sand on the wind, or sliding a slab down a slope that is too steep) and how long it has carried in Memory.y. Gusts stop for the step they lift or drop, so a slab always leaves and arrives in a whole trail pixel and no sand is made or lost.

**Try.** **Wind direction** turns the wind: the dunes turn to face it. **Lift** is how easily the wind picks sand up. **Stick on sand** against **Stick on bare ground**: the bigger the difference, the more the sand gathers into separate dunes. **Shadow drop** is how high a crest must be to shelter the sand behind it: lower makes steeper, choppier dunes.`);

// ── Crowd: two-way traffic in a corridor ─────────────────────────────────────

/**
 * Pedestrians in a corridor, half walking right and half walking left (Helbing's lane formation, and
 * the traffic jams of Resnick's book). Each walker heads for its goal along a field that bends round
 * the pillars; it sidesteps away from oncoming walkers and toward its own kind ahead, and slows down
 * where the crowd ahead is thick (Greenshields' rule: speed falls as density rises). Nobody plans it,
 * yet the crowd sorts itself into lanes, and jams form and dissolve behind the pillars.
 */
export function crowdNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('cwIn', [
    { key: 'crowd', type: 'texture', label: 'Crowd' },
    { key: 'walls', type: 'float', label: 'Walls' },
  ], [
    'Agent Inputs: this walker as the step begins. Its Species (0 walks right, 1 walks left) came from the Emit it was born from.',
    'Crowd and Walls are inputs added to the group. Crowd: the Trail field from outside, one step ago: channel 1 where right-walkers are, channel 2 where left-walkers are. Walls: the corridor\'s distance field (outside), read at this walker.',
  ]);
  const who = expr('cwWho', 0, 640, {
    label: 'Who to follow',
    inputs: [{ name: 'species', type: 'float' }, { name: 'follow', type: 'float', slider: { min: -1, max: 2 } }, { name: 'avoid', type: 'float', slider: { min: 0, max: 4 } }],
    values: { follow: -0.3, avoid: 1.5 },
    lines: [['float goingLeft', 'step(0.5, species)']],
    result: 'mix(vec4(follow, -avoid, 0.0, 0.0), vec4(-avoid, follow, 0.0, 0.0), goingLeft)',
    outputType: 'vec4',
    wires: { species: ['cwIn', 'species'] },
    exposed: [{ name: 'goingLeft', type: 'float' }],
    note: [
      'Who to follow (an Expression Block): how much each crowd channel counts for this walker\'s sidestep, for Sense\'s Channels. Follow and Avoid are Play controls.',
      'goingLeft: 1 for a left-walker (species 2), 0 for a right-walker.',
      'Result: its own direction\'s walkers count Follow (−0.3: a little personal space, so people don\'t bunch up; above 0 they fall in behind each other in single file), the oncoming ones − Avoid (step out of their way).',
    ],
  });
  const lanes = n('agentSense', 'cwLanes', 420, 100, {
    angle: 35, distance: 0.05, weight: 1, width: '1',
    ...note([
      'Sense (lanes): reads the crowd 0.05 ahead, 35° to the left, straight on and 35° to the right, weighed by Who to follow: high where its own kind walk ahead, low where people come the other way.',
    ]),
  }, { texture: ['cwIn', 'crowd'], channels: ['cwWho', 'result'] });
  const everyone = expr('cwEveryone', 420, 640, {
    label: 'Everyone',
    inputs: [],
    lines: [],
    result: 'vec4(1.0, 1.0, 0.0, 0.0)',
    outputType: 'vec4',
    note: ['Everyone (an Expression Block): both crowd channels counted alike, for the Sense that measures how packed it is ahead.'],
  });
  const ahead = n('agentSense', 'cwAhead', 840, 640, {
    angle: 20, distance: 0.025, weight: 1, width: '1',
    ...note(['Sense (how packed): reads everybody, both directions, 0.025 ahead; its middle Reading (the y of Readings) is how crowded it is just in front.']),
  }, { texture: ['cwIn', 'crowd'], channels: ['cwEveryone', 'result'] });
  const walls = n('agentSense', 'cwWalls', 840, 1000, {
    angle: 45, distance: 0.03, weight: 1, width: '1',
    ...note(['Sense (walls), with no trail: its Field ƒ is the Walls input, so Here is how far the nearest wall or pillar is and Gradient points away from it.']),
  }, { field: ['cwIn', 'walls'] });
  const way = expr('cwWay', 1260, 100, {
    label: 'Way to go',
    inputs: [
      { name: 'goingLeft', type: 'float' }, { name: 'reads', type: 'vec3' }, { name: 'packed', type: 'vec3' }, { name: 'wallDist', type: 'float' }, { name: 'wallDir', type: 'vec2' },
      { name: 'rnd', type: 'float' },
      { name: 'sidestep', type: 'float', slider: { min: 0, max: 90 } }, { name: 'pace', type: 'float', slider: { min: 0, max: 1 } },
      { name: 'jam', type: 'float', slider: { min: 1, max: 60 } },
    ],
    values: { sidestep: 40, pace: 0.22, jam: 14 },
    lines: [
      ['vec2 goal', 'vec2(1.0 - 2.0 * goingLeft, 0.0)'],
      ['vec2 away', 'normalize(wallDir + vec2(1e-6, 0.0)) * exp(-max(wallDist, 0.0) / 0.06) * 2.0'],
      ['vec2 wish', 'goal + away'],
      ['float lean', 'clamp((reads.x - reads.z) / (abs(reads.x) + abs(reads.z) + 0.5), -1.0, 1.0)'],
      ['float heading', 'atan(wish.y, wish.x) + radians(sidestep) * lean + (fract(rnd * 256.0) - 0.5) * 0.3'],
      ['float crowding', 'max(packed.y, 0.0) / jam'],
      ['float speed', 'pace * clamp(1.0 - crowding, 0.05, 1.0) * (0.85 + 0.3 * fract(rnd * 4096.0))'],
    ],
    result: 'heading',
    outputType: 'float',
    exposed: [{ name: 'speed', type: 'float' }, { name: 'crowding', type: 'float' }],
    wires: {
      goingLeft: ['cwWho', 'goingLeft'], reads: ['cwLanes', 'readings'], packed: ['cwAhead', 'readings'],
      wallDist: ['cwWalls', 'here'], wallDir: ['cwWalls', 'gradient'], rnd: ['cwIn', 'random'],
    },
    note: [
      'Way to go (an Expression Block, in place of Steer): where this walker heads and how fast. Its Result is the new heading; speed and crowding are extra outputs. Sidestep, Pace and Jam are Play controls.',
      'goal: straight along the corridor, right or left. away: a push away from the nearest wall or pillar (along the walls\' Gradient), strong close up and gone 0.1 away. wish: the two together: the way it would walk if it were alone.',
      'lean: −1 to 1, how much better the left looks than the right (own kind ahead, nobody coming). heading: the wished-for way, sidestepping up to Sidestep degrees toward the better side, with a little wobble.',
      'crowding: how packed it is just ahead, against Jam (the crowding at which people stop). speed: Pace × (1 − crowding), never quite 0 (Greenshields\' traffic rule), each step a little faster or slower than the next walker.',
    ],
  });
  const move = n('agentMove', 'cwMove', 1680, 100, {
    speed: 0.22, edges: 'wrap', onObstacle: 'slide',
    ...note([
      'Move: one step along Way to go\'s heading at its speed. Obstacle ƒ is the Walls input: a walker that would step into a wall or a pillar slides along it instead. Wrap: walking off one end of the corridor, back in at the other.',
    ]),
  }, { heading: ['cwWay', 'result'], speed: ['cwWay', 'speed'], obstacle: ['cwIn', 'walls'] });
  const colour = expr('cwColour', 1680, 640, {
    label: 'Colour',
    inputs: [{ name: 'goingLeft', type: 'float' }, { name: 'crowding', type: 'float' }],
    lines: [['vec3 tint', 'mix(vec3(1.0, 0.6, 0.2), vec3(0.25, 0.75, 1.0), goingLeft)']],
    result: 'tint * mix(1.0, 0.35, clamp(crowding, 0.0, 1.0))',
    outputType: 'vec3',
    wires: { goingLeft: ['cwWho', 'goingLeft'], crowding: ['cwWay', 'crowding'] },
    note: [
      'Colour (an Expression Block): this walker\'s own colour for Draw agents.',
      'tint: orange for right-walkers, sky blue for left-walkers. Result: dimmer the more packed it is ahead, so jams show as dark knots.',
    ],
  });
  const output = agentOut('cwOut', 2100, 140, [
    'Agent Output: Position, Velocity and Heading from Move; Colour from Colour. Deposit is left unwired: each walker leaves one unit a step in its own species\' channel, which is exactly the crowd map.',
  ], { position: ['cwMove', 'position'], velocity: ['cwMove', 'velocity'], heading: ['cwMove', 'heading'], colour: ['cwColour', 'result'] });

  // ── Outside ──
  const uv = n('uv', 'cwUv', X(0), Y(800), { ...note(['UV: where each pixel (or, inside the group, each walker) is, for the corridor.']) });
  const corridor = expr('cwCorridor', X(420), Y(800), {
    label: 'Corridor',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [
      ['float walls', '0.8 - abs(uv.y)'],
      ['float pillarA', 'length(uv - vec2(-0.9, 0.25)) - 0.1'],
      ['float pillarB', 'length(uv - vec2(0.0, -0.3)) - 0.13'],
      ['float pillarC', 'length(uv - vec2(0.85, 0.35)) - 0.09'],
    ],
    result: 'min(walls, min(pillarA, min(pillarB, pillarC)))',
    outputType: 'float',
    wires: { uv: ['cwUv', 'uv'] },
    note: [
      'Corridor (an Expression Block): how far a point is from the nearest wall or pillar (below 0 inside one).',
      'walls: the corridor\'s top and bottom walls, 0.8 from the middle. pillarA: a pillar up and to the left. pillarB: a bigger one just below the middle. pillarC: a small one up and to the right.',
      'Wired into the group\'s Walls it is read at each walker; wired into the picture, at each pixel, so the drawing and the rule agree. Try: move a pillar, or add a fourth.',
    ],
  });
  const emitR = n('agentEmit', 'cwEmitR', X(0), Y(0), {
    mode: 'fill', shape: 'box', size: 0.78, x: -1, y: 0, heading: 'random', species: '1', share: 1,
    ...note([
      'Emit (right-walkers, species 1): half the crowd, scattered over the left half of the corridor at the start.',
      'Its "+ Another Emit" takes the left-walkers\' Emit; Share 1 each.',
    ]),
  }, { also: ['cwEmitL', 'emitter'] });
  const emitL = n('agentEmit', 'cwEmitL', X(0), Y(380), {
    mode: 'fill', shape: 'box', size: 0.78, x: 1, y: 0, heading: 'random', species: '2', share: 1,
    ...note(['Emit (left-walkers, species 2): the other half, scattered over the right half, so the two crowds meet head-on in the middle.']),
  });
  let group = agentsGroup('crowd', X(420), Y(0), 'cwEmitR', [inputs, who, lanes, everyone, ahead, walls, way, move, colour, output], {
    label: 'Crowd', species: '2', tier: '64k', stepsPerFrame: 2, preroll: 0,
    ...note([
      'Agents: 65,536 walkers (64k) of 2 species, 2 steps a frame. Inside (double-click): three Senses read the lanes, how packed it is ahead and the walls; Way to go picks a heading and a speed; Move walks, sliding along walls.',
      'Why 64k: enough for a dense crowd, few enough that a lane is a line of people you can follow.',
    ]),
  });
  group = groupInput(group, 'crowd', 'texture', 'Crowd', ['cwTrail', 'texture']);
  group = groupInput(group, 'walls', 'float', 'Walls', ['cwCorridor', 'result']);
  const deposit = n('agentDeposit', 'cwDeposit', X(840), Y(0), {
    amount: 1, size: 1, what: 'trail',
    ...note(['Deposit: each walker leaves one unit a step in its own direction\'s channel: the crowd map.']),
  }, { agents: ['crowd', 'agents'] });
  const trail = n('trailField', 'cwTrail', X(1260), Y(0), {
    resolution: '512', diffuse: 1, halfLife: 0.08, edges: 'wrap', gain: 0.4, kernel: '5',
    ...note([
      'Trail field: the crowd map, 512 rows: channel 1 right-walkers, channel 2 left-walkers, spread a few pixels and gone in a fraction of a second: where people are now.',
    ]),
  }, { deposit: ['cwDeposit', 'deposit'] });
  const floor = expr('cwFloor', X(1680), Y(420), {
    label: 'Floor plan',
    inputs: [{ name: 'd', type: 'float' }, { name: 'ch', type: 'vec4' }],
    lines: [
      ['float solid', '1.0 - smoothstep(0.0, 0.006, d)'],
      ['vec3 trails', 'vec3(1.0, 0.5, 0.15) * (1.0 - exp(-ch.r * 0.15)) + vec3(0.15, 0.55, 1.0) * (1.0 - exp(-ch.g * 0.15))'],
    ],
    result: 'mix(vec3(0.03, 0.035, 0.045) + trails * 0.35, vec3(0.2, 0.21, 0.24), solid)',
    outputType: 'vec3',
    wires: { d: ['cwCorridor', 'result'], ch: ['cwTrail', 'channels'] },
    note: [
      'Floor plan (an Expression Block): the corridor under the walkers.',
      'solid: 1 inside a wall or pillar (drawn grey). trails: the crowd map, orange where right-walkers are and blue where left-walkers are, faint, so the lanes show as streaks.',
    ],
  });
  const draw = n('drawAgents', 'cwDraw', X(2100), Y(0), {
    style: 'points', colorBy: 'agent', size: 2, brightness: 0.9, scaleBy: 'walker', fade: 'off', lights: '0',
    ...note(['Draw agents: every walker as a dot in its own Colour: orange right, blue left, darker where they are stuck in a crowd.']),
  }, { agents: ['crowd', 'agents'], over: ['cwFloor', 'result'] });
  const nodes = [uv, corridor, emitR, emitL, group, deposit, trail, floor, draw];
  if (withOutput) nodes.push(n('output', 'cwOutput', X(2520), Y(0), { ...note(['Output: the crowd in its corridor is the picture.']) }, { color: ['cwDraw', 'color'] }));
  return nodes;
}

const crowdPlay = play([
  inner('avoid', 'crowd', 'cwWhoAvoid', 'value', 'Avoid oncoming', 0, 4),
  inner('follow', 'crowd', 'cwWhoFollow', 'value', 'Follow own kind', -1, 2),
  inner('side', 'crowd', 'cwWaySidestep', 'value', 'Sidestep (°)', 0, 90),
  inner('pace', 'crowd', 'cwWayPace', 'value', 'Walking pace', 0, 1),
  inner('jam', 'crowd', 'cwWayJam', 'value', 'Jam density', 1, 60),
  ctl('again', 'crowd::restart', 'Start over', 0, 1),
], `**What it shows.** Two crowds walking through a corridor in opposite directions. Nobody is told to keep right or left, yet within seconds people sort themselves into lanes going each way, and jams build up and clear round the pillars (Helbing's lane formation; Greenshields' rule that traffic slows as it thickens).

**How it's built.** One Agents group with two species. Each walker deposits into its own direction's channel of the Trail. Inside, one Sense reads the crowd ahead weighed so that its own kind count for and oncoming walkers against, another reads how packed it is just ahead, and a third reads the walls' distance field. Way to go (an Expression Block in place of Steer) heads for the goal, bends round pillars, sidesteps toward the better side and slows with the crowding.

**Try.** **Avoid oncoming** 0 and the lanes never form: the crowds grind into each other. **Follow own kind** above 0 makes people fall in behind each other in single file; below 0 they keep their distance. **Jam density** low makes people stop early, so jams spread back like traffic waves. **Walking pace** is everyone's speed.`);

// ── Painter bots ─────────────────────────────────────────────────────────────

/**
 * Generative painting robots (turtle geometry, after Papert and Abelson & diSessa, with a Langton's-ant
 * twist): each bot steers by a turning rhythm it keeps in Memory.x (its curvature swings like a
 * pendulum, so it draws loops, waves and spirograph petals), paints in the colour it keeps in
 * Memory.y, and when it wanders onto paint it flips its turning and shifts its colour, so the bots
 * answer each other's strokes. The canvas is the Trail's three colour channels.
 */
export function painterNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('pbIn', [{ key: 'canvas', type: 'texture', label: 'Canvas' }], [
    'Agent Inputs: this bot as the step begins. Memory is what it carried over: x is where it is in its turning rhythm (0–1, round and round), y its paint colour (a hue, 0–1).',
    'Canvas is an input added to the group: the Trail field from outside, as it was one step ago: red, green and blue paint, and in the fourth channel how much paint lies there in all.',
  ]);
  const layer = expr('pbLayer', 0, 600, {
    label: 'Paint layer',
    inputs: [],
    lines: [],
    result: 'vec4(0.0, 0.0, 0.0, 1.0)',
    outputType: 'vec4',
    note: ['Paint layer (an Expression Block): picks the canvas\'s fourth channel, how much paint lies there whatever its colour, for Sense\'s Channels.'],
  });
  const look = n('agentSense', 'pbLook', 420, 100, {
    angle: 30, distance: 0.012, weight: 1, width: '1',
    ...note([
      'Sense, used only as a reader: its middle Reading (the y of Readings) is how much paint lies 0.012 ahead of the bot: ahead, so it never trips over the stroke it is laying itself. Its side sensors and Steer are not used: the bot steers by its own rhythm.',
    ]),
  }, { texture: ['pbIn', 'canvas'], channels: ['pbLayer', 'result'] });
  const brush = expr('pbBrush', 840, 100, {
    label: 'Brush',
    inputs: [
      { name: 'mem', type: 'vec2' }, { name: 'paint', type: 'vec3' }, { name: 'h', type: 'float' }, { name: 'index', type: 'float' },
      { name: 'age', type: 'float' }, { name: 'rnd', type: 'float' },
      { name: 'curl', type: 'float', slider: { min: 0, max: 12 } }, { name: 'rhythm', type: 'float', slider: { min: 0, max: 2 } },
      { name: 'answer', type: 'float', slider: { min: 0, max: 1 } }, { name: 'hueStep', type: 'float', slider: { min: 0, max: 0.3 } },
      { name: 'pens', type: 'float', slider: { min: 0, max: 1 } },
    ],
    values: { curl: 1.6, rhythm: 0.12, answer: 0.25, hueStep: 0.05, pens: 0.004 },
    lines: [
      ['float own', 'fract(index * 0.6180339887)'],
      ['float family', 'floor(own * 5.0)'],
      ['float phase', 'age < 0.02 ? family * 0.2 : mem.x'],
      ['float hue', 'age < 0.02 ? family / 5.0 : mem.y'],
      ['float penDown', '1.0 - step(pens, fract(own * 97.0))'],
      ['float onPaint', 'step(0.6, paint.y)'],
      ['float answers', 'onPaint * (1.0 - step(answer, fract(rnd * 4096.0)))'],
      ['float bend', 'curl * (0.6 + 0.3 * family) * sin(6.2831853 * phase) + 0.25 * (family - 2.0)'],
      ['float heading', 'h + bend / 60.0'],
      ['float nextPhase', 'fract(phase + rhythm * (0.6 + 0.2 * family) / 60.0 + answers * 0.5)'],
      ['float nextHue', 'fract(hue + answers * hueStep)'],
      ['vec3 ink', '0.5 + 0.5 * cos(6.2831853 * (hue + vec3(0.0, 0.33, 0.67)))'],
      ['vec4 deposit', 'vec4(ink, 1.0) * penDown'],
      ['vec3 colour', 'ink * penDown'],
    ],
    result: 'vec2(nextPhase, nextHue)',
    outputType: 'vec2',
    exposed: [{ name: 'heading', type: 'float' }, { name: 'deposit', type: 'vec4' }, { name: 'colour', type: 'vec3' }],
    wires: { mem: ['pbIn', 'memory'], paint: ['pbLook', 'readings'], h: ['pbIn', 'heading'], index: ['pbIn', 'index'], age: ['pbIn', 'age'], rnd: ['pbIn', 'random'] },
    note: [
      'Brush (an Expression Block): the painting rule. Its Result is the new Memory (rhythm, hue); heading, deposit and colour are extra outputs. Curl, Rhythm, Answer, Hue step and Pens are Play controls.',
      'own: a number 0–1 of its own (from its Index), the same every step. family: which of five families it belongs to (0–4): each family turns a little differently, so the canvas has five kinds of stroke.',
      'phase: where it is in its turning rhythm (Memory.x); on its first step its family\'s starting point, so a whole family swings in step and draws the same figure side by side, until answers set them apart. hue: its paint colour (Memory.y); on its first step its family\'s colour.',
      'penDown: 1 for the bots that paint: a share Pens of them (0.4%: about 260 brushes; the rest wander with their pens up, or the canvas would be mud). onPaint: 1 when it is heading into paint (more than half a layer just ahead). answers: on paint, and the dice say yes (Answer, a chance a step): it answers the stroke it found.',
      'bend: how hard it turns this step, in radians a second: a swing back and forth (Curl × sin of the phase, so it draws waves and loops), plus a steady lean by family (so some families spiral one way and some the other). heading: its heading turned by that much.',
      'nextPhase: the rhythm moves on (Rhythm, each family at its own pace); an answer jumps it half a turn, which flips the way it curls. nextHue: an answer also shifts its colour by Hue step, so colours drift where strokes cross.',
      'ink: its hue as a colour (a cosine rainbow). deposit: that colour in the first three channels and one layer of paint in the fourth, if its pen is down. colour: its ink if its pen is down, else black (Draw agents adds nothing for it).',
    ],
  });
  const move = n('agentMove', 'pbMove', 1260, 100, {
    speed: 0.12, edges: 'wrap',
    ...note(['Move: one step along the Brush\'s heading at 0.12 picture units a second. Wrap: off one edge, back on the other. Try: Speed 0.3 for long sweeping strokes.']),
  }, { heading: ['pbBrush', 'heading'] });
  const output = agentOut('pbOut', 1680, 140, [
    'Agent Output: Position, Velocity and Heading from Move; Memory, Deposit and Colour from the Brush.',
  ], { position: ['pbMove', 'position'], velocity: ['pbMove', 'velocity'], heading: ['pbMove', 'heading'], memory: ['pbBrush', 'result'], deposit: ['pbBrush', 'deposit'], colour: ['pbBrush', 'colour'] });

  const emit = n('agentEmit', 'pbEmit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random',
    ...note(['Emit: every bot starts at a random place on the canvas, facing anywhere, all at once (Fill).']),
  });
  let group = agentsGroup('painters', X(420), Y(0), 'pbEmit', [inputs, layer, look, brush, move, output], {
    label: 'Painter bots', tier: '64k', stepsPerFrame: 2, preroll: 0,
    ...note([
      'Agents: 65,536 bots (64k), 2 steps a frame. Inside (double-click): Sense reads the paint under the bot, the Brush turns it, colours it and decides when it answers another stroke, Move walks it.',
      'Try: a new Seed and Start over for a new painting; Count 256k for a denser weave.',
    ]),
  });
  group = groupInput(group, 'canvas', 'texture', 'Canvas', ['pbTrail', 'texture']);
  const deposit = n('agentDeposit', 'pbDeposit', X(840), Y(0), {
    amount: 1, size: 1, what: 'trail',
    ...note(['Deposit: every painting bot lays one layer of its colour each step: the canvas\'s red, green and blue, and one layer in the fourth channel.']),
  }, { agents: ['painters', 'agents'] });
  const trail = n('trailField', 'pbTrail', X(1260), Y(0), {
    resolution: '1024', diffuse: 0.05, halfLife: 8, edges: 'wrap', gain: 1, kernel: '3',
    ...note([
      'Trail field: the canvas, 1024 rows. Paint bleeds a little (Diffuse 0.05) and fades slowly (half-life 8 s), so old strokes give way to new ones and the painting keeps changing.',
      'Try: Half-life 2 for fleeting strokes.',
    ]),
  }, { deposit: ['pbDeposit', 'deposit'] });
  const paper = expr('pbPaper', X(1680), Y(420), {
    label: 'Paint on paper',
    inputs: [{ name: 'paint', type: 'vec4' }],
    lines: [
      ['float layers', 'max(paint.a, 0.0)'],
      ['vec3 hue', 'paint.rgb / max(layers, 1e-3)'],
      ['float cover', '1.0 - exp(-layers * 2.5)'],
    ],
    result: 'mix(vec3(0.035, 0.03, 0.045), hue * 1.1, cover)',
    outputType: 'vec3',
    wires: { paint: ['pbTrail', 'channels'] },
    note: [
      'Paint on paper (an Expression Block): turns the canvas into a picture: luminous inks on black.',
      'layers: how much paint lies here (the fourth channel). hue: the paint\'s average colour (the colour channels over the layers). cover: how well the paper is covered, 0–1.',
      'Result: near-black paper, covered by the paint\'s colour where there is paint.',
    ],
  });
  const draw = n('drawAgents', 'pbDraw', X(2100), Y(0), {
    style: 'points', colorBy: 'agent', size: 2, brightness: 0.6, scaleBy: 'walker', fade: 'off', lights: '0',
    ...note(['Draw agents: each painting bot as a small glint of its own colour at the tip of its stroke, so you can see the brushes at work; bots with their pens up are black and add nothing. Try: Brightness 0 for the painting alone.']),
  }, { agents: ['painters', 'agents'], over: ['pbPaper', 'result'] });
  const nodes = [emit, group, deposit, trail, paper, draw];
  if (withOutput) nodes.push(n('output', 'pbOutput', X(2520), Y(0), { ...note(['Output: the painting is the picture.']) }, { color: ['pbDraw', 'color'] }));
  return nodes;
}

const painterPlay = play([
  inner('curl', 'painters', 'pbBrushCurl', 'value', 'Curl', 0, 12),
  inner('rhythm', 'painters', 'pbBrushRhythm', 'value', 'Rhythm', 0, 2),
  inner('answer', 'painters', 'pbBrushAnswer', 'value', 'Answer strokes', 0, 1),
  inner('hue', 'painters', 'pbBrushHueStep', 'value', 'Colour shift', 0, 0.3),
  inner('pens', 'painters', 'pbBrushPens', 'value', 'Share of bots painting', 0, 1),
  inner('speed', 'painters', 'pbMove', 'speed', 'Brush speed', 0, 0.6),
  ctl('fade', 'pbTrail::halfLife', 'Paint lasts (s)', 0.5, 10),
  ctl('again', 'painters::restart', 'Start over', 0, 1),
], `**What it shows.** A few hundred painting robots (one bot in 250 has its pen down). Each one follows its own turning rhythm, swinging from one curve to the other, so it draws waves, loops and petals; it paints in a colour it remembers; and when it wanders onto someone else's paint it answers: it flips the way it curls and shifts its colour. A painting grows that nobody designed, and keeps changing as old strokes fade.

**How it's built.** The canvas is a Trail field: each bot deposits its colour into the red, green and blue channels and one layer into the fourth. Inside the group, Sense reads the paint under the bot, and one Expression Block (Brush) keeps the bot's rhythm in Memory.x and its hue in Memory.y, turns it, and decides when to answer. Paint on paper divides the colour by the layers to get the average colour.

**Try.** **Curl** is how hard the bots swing: 0 draws straight lines. **Rhythm** is how fast they swing (slow: big loops; fast: tight waves). **Answer strokes** is how often they react to paint: 0 and each bot paints alone. **Colour shift** is how far a colour moves at each answer. **Share of bots painting** puts more pens down (all of them make mud). **Paint lasts** sets how long strokes stay.`);

/**
 * What each rule number does, for the note on its knob (the Constant that feeds it: see knobify).
 */
const KNOB_WHY: Record<string, string> = {
  stickiness: 'the chance that a walker touching the cluster sticks this step. Below 1, walkers creep further into the hollows before they stick, so the coral grows denser and bushier.',
  walk: 'how fast a free walker stumbles about (picture units a second). Faster walkers arrive sooner but may hop over a thin branch.',
  pull: 'a gentle pull toward the middle that keeps walkers arriving. 0 is pure DLA (slow, most branched); more grows a fast, thick tree.',
  wiggle: 'how much a termite wanders, in degrees at most each step. 0 sends termites in straight lines (and wrapping round the picture); 180 makes them dither on the spot.',
  pickChance: 'the chance a step that an empty-handed termite on a chip reaches for it. Lower makes the termites hesitate, so the piles form more slowly.',
  rest: 'seconds a termite walks on after picking up or putting down a chip before it may act again, so it carries a chip away from the pile it found it in.',
  scatter: 'the chance a step, during their first half second, that a termite drops an extra starting chip: how many chips there are (Start over to apply).',
  period: 'the seconds between a firefly\'s flashes when nobody nudges it.',
  spread: 'how much the fireflies\' own paces differ (0.1: some run 10% fast, some 10% slow). The bigger it is, the harder it is for them to agree.',
  coupling: 'how far a flash it sees jumps a firefly\'s clock forward. 0 and they never fall into step; high and patches lock together in seconds.',
  deaf: 'the share of its cycle just after a flash during which a firefly ignores light, so it doesn\'t answer the echo of its own flash.',
  infectivity: 'how catching the infection is: the rate at which the air\'s infection infects a susceptible person. Too low and the first cases fizzle out.',
  sickDays: 'how long (simulated seconds, "days") an infected person stays infectious.',
  immuneDays: 'how long a recovered person stays immune. 0: immune for good (plain SIR, one wave and done); short: the next wave comes sooner.',
  firstCases: 'the share of people infected at the start (Start over to apply).',
  imported: 'a tiny chance a second that a susceptible person catches it from outside, so the epidemic never dies out for good.',
  preyBirth: 'how fast unborn prey slots come alive near living prey on grass: the prey\'s birth rate.',
  predatorBirth: 'how fast unborn predator slots come alive where predators are feeding: the predators\' birth rate.',
  kill: 'how deadly the predators are: the rate at which a prey among them is caught.',
  hunger: 'how fast a predator burns its energy. Low and predators outlive their prey and wipe them out; high and they starve before they find any.',
  fear: 'how hard prey turn away from the predators\' scent.',
  turn: 'the most a walker turns in one step, toward the side it likes better, in degrees.',
  angle: 'which way the wind blows, in degrees: 0 blows to the right, 90 up. The dunes turn to face it.',
  gust: 'how fast the wind blows the gusts (picture units a second).',
  lift: 'the chance a step that an empty gust lifts a slab of sand (out of the wind shadow): how easily the wind erodes.',
  stickSand: 'the chance a step that a carried slab comes down on sand. Higher than on bare ground: sand catches sand, which is what makes ripples grow.',
  stickBare: 'the chance a step that a carried slab comes down on bare ground. The lower it is against the sand\'s, the more the sand gathers into separate dunes.',
  shadowDrop: 'how much higher the sand upwind must be for this spot to lie in the wind shadow, where the wind drops everything and lifts nothing.',
  repose: 'the steepest slope (sand depth per trail pixel) the sand holds before it slumps downhill, a slab at a time: the angle of repose.',
  follow: 'how much walkers going the same way count for the sidestep: below 0 they keep a little distance; above 0 they fall in behind each other in single file.',
  avoid: 'how much walkers coming the other way count against a side: the urge to step out of their way that makes lanes form.',
  sidestep: 'the most a walker swerves from its way, in degrees, toward the better side.',
  pace: 'how fast people walk when nothing is in their way (picture units a second).',
  jam: 'how packed it must be ahead for a walker to stop (Greenshields\' jam density). Low and people stop early, so jams spread back like traffic waves.',
  curl: 'how hard the bots swing from one curve to the other. 0 draws straight lines; high draws tight loops.',
  rhythm: 'how fast the bots swing (slow: long waves and big loops; fast: tight wiggles).',
  answer: 'the chance a step that a bot heading into paint answers it, flipping its curl and shifting its colour. 0 and every bot paints alone.',
  hueStep: 'how far a bot\'s colour moves each time it answers a stroke.',
  pens: 'the share of bots with their pens down. All of them at once paints the canvas into mud.',
};

/**
 * Every slider input of an Expression Block inside an Agents group becomes a Constant wired into it:
 * a knob of its own, with a note, that Play (and MIDI, LFOs, mappings) can drive. The block keeps
 * the rule; the knobs, placed above it, are the numbers you tune.
 */
function knobify(nodes: GraphNode[], controls: PlayControl[]): GraphNode[] {
  const labelOf = new Map(controls.map(c => [c.target.split('::').slice(-2)[0], c.label]));
  return nodes.map(g => {
    if (g.type !== 'agentsGroup') return g;
    const sub = g.params.subgraph as { nodes: GraphNode[]; inputPorts: unknown[]; outputPorts: unknown[] };
    const knobs: GraphNode[] = [];
    const inside = sub.nodes.map(e => {
      const ins = e.params.inputs as Array<{ name: string; type: string; slider: unknown }> | undefined;
      if (e.type !== 'exprNode' || !ins?.some(i => i.slider)) return e;
      const params: Record<string, unknown> = { ...e.params };
      const inputs = { ...e.inputs };
      let k = 0;
      for (const i of ins) {
        if (!i.slider) continue;
        const id = `${e.id}${i.name[0].toUpperCase()}${i.name.slice(1)}`;
        const label = labelOf.get(id) ?? i.name;
        const what = KNOB_WHY[i.name] ?? `the ${i.name} number of ${String(e.params.label)}.`;
        knobs.push(n('constant', id, e.position.x + 200 * k++, e.position.y - 260, {
          value: params[i.name], label,
          ...note([`${label} (a Constant, wired into ${String(e.params.label)}'s ${i.name}): ${what}`, 'Turn it here, or on Play, where it is a control: it is a uniform, so changing it never recompiles.']),
        }));
        delete params[i.name];
        inputs[i.name] = { ...inputs[i.name], connection: { nodeId: id, outputKey: 'value' } };
      }
      params.inputs = ins.map(i => ({ ...i, slider: null }));
      params.__comment = String(params.__comment)
        .replace(/ are Play controls/g, ' come in from Constants above it, its knobs (Play controls)')
        .replace(/ is a Play control/g, ' comes in from a Constant above it, its knob (a Play control)')
        .replace(/A Play control\./g, 'Its knob, a Constant above it, is a Play control.');
      return { ...e, params, inputs };
    });
    return { ...g, params: { ...g.params, subgraph: { ...sub, nodes: [...inside, ...knobs] } } };
  });
}

export const SIM_AGENT_EXAMPLE_KEYS = Object.keys(SIM_AGENT_EXAMPLE_INDEX);

export function buildSimAgentExamples(): Record<string, ExampleGraph> {
  return {
    simAgentPredatorPrey: { ...SIM_AGENT_EXAMPLE_INDEX.simAgentPredatorPrey, counter: 40, nodes: knobify(predatorPreyNodes(0, 200), predatorPreyPlay.controls), play: predatorPreyPlay },
    simAgentDla: { ...SIM_AGENT_EXAMPLE_INDEX.simAgentDla, counter: 40, nodes: knobify(dlaNodes(0, 200), dlaPlay.controls), play: dlaPlay },
    simAgentSandDrift: { ...SIM_AGENT_EXAMPLE_INDEX.simAgentSandDrift, counter: 40, nodes: knobify(sandDriftNodes(0, 200), sandDriftPlay.controls), play: sandDriftPlay },
    simAgentCrowd: { ...SIM_AGENT_EXAMPLE_INDEX.simAgentCrowd, counter: 40, nodes: knobify(crowdNodes(0, 200), crowdPlay.controls), play: crowdPlay },
    simAgentPainters: { ...SIM_AGENT_EXAMPLE_INDEX.simAgentPainters, counter: 40, nodes: knobify(painterNodes(0, 200), painterPlay.controls), play: painterPlay },
    simAgentTermites: { ...SIM_AGENT_EXAMPLE_INDEX.simAgentTermites, counter: 40, nodes: knobify(termitesNodes(0, 200), termitesPlay.controls), play: termitesPlay },
    simAgentFireflies: { ...SIM_AGENT_EXAMPLE_INDEX.simAgentFireflies, counter: 40, nodes: knobify(firefliesNodes(0, 200), firefliesPlay.controls), play: firefliesPlay },
    simAgentInfection: { ...SIM_AGENT_EXAMPLE_INDEX.simAgentInfection, counter: 40, nodes: knobify(infectionNodes(0, 200), infectionPlay.controls), play: infectionPlay },
  };
}
