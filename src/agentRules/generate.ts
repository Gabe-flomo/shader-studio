/**
 * generate.ts — a rule set (spec.ts) → the inside of an Agents group, as ordinary nodes.
 *
 *   Agent Inputs ─┬─ Channel weights → Sense (one per trail channel the rules read)
 *                 ├─ Curl noise (Follow a flow field), Sample (texture) (a texture mask)
 *                 └─ Start → Rule 1 → Rule 2 → … → Finish → Move → Agent Output
 *
 * Start, every rule and Finish are Expression Blocks. The walker's running values are carried
 * from block to block as wires: h (heading), spd (speed), mem (Memory: state index, number),
 * dep (deposit, one amount per trail channel), alive and done ("stop after this rule" fired).
 * Each rule computes `go` (1 when its When holds for this walker this step, 0 otherwise) and
 * applies its actions scaled by it, so a rule that doesn't apply changes nothing. Every node
 * carries a note; an Expression Block's note explains each named line ("go: …").
 *
 * Deterministic: the same rule set and group id give the same nodes, ids and GLSL. Randomness
 * comes only from the walker's seed (the step, its index and the group's Seed) hashed with a
 * number of the rule's own, as the engine's other random numbers are.
 */
import type { DataType, GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { withAgentSpace } from '../nodes/definitions/agents';
import { getNodeDefinition } from '../nodes/definitions';
import {
  type AgentRule, type AgentRuleSet, type ChannelRef, type NeighbourWho, type RuleAction, type RuleCondition,
  DEFAULT_NEIGHBOURS, channelName, describeAction, kindOf, describeCondition, describeRule, neighbourReadOf, neighbourReads, rulePorts, sensedChannels,
  usesAction, usesDeposit, usesFade, usesFlow, usesStop,
} from './spec';

type Wire = [string, string];
type ExprType = 'float' | 'vec2' | 'vec3' | 'vec4';
interface Line { lhs: string; op: string; rhs: string }

/** A GLSL float literal. */
export const glf = (v: number): string => {
  const r = Math.round((isFinite(v) ? v : 0) * 1e6) / 1e6;
  const s = String(r);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
const vec3Of = (c: number[]) => `vec3(${glf(c[0] ?? 1)}, ${glf(c[1] ?? 1)}, ${glf(c[2] ?? 1)})`;
const MOUSE = '((u_mouse / u_resolution.y - vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5) * 2.0)';
const PI = '3.1415927';
const TAU = '6.2831853';

/** A salt for a rule's own random numbers: species, rule and which number, mixed (a uint literal). */
const salt = (sp: number, rule: number, k: number) => `0x${(Math.imul(((sp * 97 + rule) * 13 + k + 1) >>> 0, 0x9E3779B1) >>> 0).toString(16).toUpperCase().padStart(8, '0')}u`;
const dice = (sp: number, rule: number, k: number) => `float(agHash(a_seed ^ ${salt(sp, rule, k)}) >> 8) / 16777216.0`;

/** An Expression Block as the app saves one, with lines of any operator and the note that explains them. */
function block(id: string, x: number, y: number, o: {
  label: string; inputs: Array<{ name: string; type: ExprType; from?: Wire }>; lines: Line[];
  result: string; outputType: ExprType; exposed: Array<{ name: string; type: ExprType }>; note: string[];
}): GraphNode {
  const node = n('exprNode', id, x, y, {
    label: o.label,
    inputs: o.inputs.map(i => ({ name: i.name, type: i.type, slider: null })),
    outputType: o.outputType,
    lines: o.lines.map(l => ({ lhs: l.lhs, op: l.op, rhs: l.rhs })),
    result: o.result,
    expr: o.result,
    ...(o.exposed.length ? { outputs: o.exposed.map(e => e.name) } : {}),
    __comment: o.note.join('\n'),
  });
  node.inputs = Object.fromEntries(o.inputs.map(i => [i.name, {
    type: i.type as DataType, label: `${i.name} (${i.type})`,
    ...(i.from ? { connection: { nodeId: i.from[0], outputKey: i.from[1] } } : {}),
  }]));
  node.outputs = {
    result: { type: o.outputType, label: `Result (${o.outputType})` },
    ...Object.fromEntries(o.exposed.map(e => [e.name, { type: e.type as DataType, label: `${e.name} (${e.type})` }])),
  };
  return node;
}

/** The ids of a group's generated inside (by the group's id, so two rule groups never share one). */
export const ruleIds = (gid: string) => ({
  inputs: `${gid}_ru_in`, start: `${gid}_ru_start`, finish: `${gid}_ru_finish`, move: `${gid}_ru_move`, output: `${gid}_ru_out`, flow: `${gid}_ru_flow`,
  collide: `${gid}_ru_collide`, after: `${gid}_ru_after`,
  channel: (k: string) => `${gid}_ru_ch_${k}`, sense: (k: string) => `${gid}_ru_sense_${k}`, mask: (m: number) => `${gid}_ru_mask${m + 1}`,
  neighbours: (k: string) => `${gid}_ru_nb_${k}`,
  rule: (sp: number, i: number) => `${gid}_ru_r${sp + 1}_${i + 1}`,
});

const chanKey = (c: ChannelRef | undefined) => String(c ?? 'own');
const smellVar = (k: string) => (k === 'own' ? 'smellOwn' : `smell${Number(k) + 1}`);
const hereVar = (k: string) => (k === 'own' ? 'hereOwn' : `here${Number(k) + 1}`);

export interface GenerateOptions { groupId: string; d3: boolean }

/** Room for a Sense card (and the Curl noise card) in the column of sensors. */
const ROW = 840;

/** The inside of a rules group: every node, notes on all of them. */
export function generateRulesInside(set: AgentRuleSet, o: GenerateOptions): GraphNode[] {
  const { d3 } = o;
  const id = ruleIds(o.groupId);
  const many = set.species.length > 1;
  const H: ExprType = d3 ? 'vec3' : 'float';
  const P: ExprType = d3 ? 'vec3' : 'vec2';
  const nodes: GraphNode[] = [];
  const ports = rulePorts(set);
  const space = (nd: GraphNode) => (d3 ? withAgentSpace(nd, true, getNodeDefinition) : nd);

  // ── Agent Inputs, with the ports the rules read ──
  const inputs = n('agentInputs', id.inputs, 0, 200, {
    _groupOriginal: true,
    extraInputs: ports,
    __comment: [
      'Agent Inputs: this walker as the step begins (its heading, speed, age, species and Memory). Generated by the group\'s rules.',
      ports.length ? `Inputs from outside (sockets on the group card): ${ports.map(p => `${p.label} (${p.type === 'texture' ? 'a texture' : p.type === 'scene3d' ? 'a ray-marched Scene, for Collide (3D scene)' : 'a number chain'})`).join(', ')}.` : 'The rules read nothing from outside the group.',
      'Memory x is the walker\'s state (0, 1, 2… plus 0.5 once it has stuck); Memory y is its one free number.',
    ].join('\n'),
  });
  inputs.outputs = { ...inputs.outputs, ...Object.fromEntries(ports.map(p => [p.key, { type: p.type as DataType, label: p.label }])) };
  nodes.push(space(inputs));
  const IN = (k: string): Wire => [id.inputs, k];

  // ── Sensors: one Sense per trail channel the rules read ──
  const senses = sensedChannels(set);
  senses.forEach((k, i) => {
    const y = 40 + i * ROW;
    const own = k === 'own';
    const label = own ? 'its own trail' : channelName(set, Number(k) as ChannelRef);
    nodes.push(block(id.channel(k), 420, y + 360, {
      label: `Channel: ${label}`,
      inputs: own ? [{ name: 'sp', type: 'float', from: IN('species') }] : [],
      lines: [],
      result: own ? 'vec4(equal(vec4(sp), vec4(0.0, 1.0, 2.0, 3.0)))' : `vec4(${[0, 1, 2, 3].map(c => (c === Number(k) ? '1.0' : '0.0')).join(', ')})`,
      outputType: 'vec4', exposed: [],
      note: [
        `Channel weights (an Expression Block): which trail channel the Sense beside it reads: ${own ? 'the walker\'s own species\' channel (1 for its species, 0 for the others)' : `channel ${Number(k) + 1} only`}.`,
        `result: ${own ? 'a one-hot vec4 from the species (sp: this walker\'s species, 0–3)' : 'a one-hot vec4'}, wired into Sense's Channels.`,
      ],
    }));
    nodes.push(space(n('agentSense', id.sense(k), 840, y, {
      angle: set.sensor.angle, distance: set.sensor.distance, weight: 1, width: '1',
      __comment: [
        `Sense: smells ${label} ${set.sensor.distance} ahead, ${set.sensor.angle}° to the left, straight on and ${set.sensor.angle}° to the right (Readings: left, ahead, right), and where the walker stands (Here).`,
        'The rules\' "trail sensed", "near another species\' trail" and "turn toward the trail" read it. Distance and Angle are the rule set\'s Sensors.',
        d3 ? '3D: the left and right sensors lie in this step\'s turning plane (a random plane through the heading).' : '',
      ].filter(Boolean).join('\n'),
    }, { texture: IN('trail'), channels: [id.channel(k), 'result'] })));
  });

  // ── The flow field and texture masks ──
  if (usesFlow(set)) {
    nodes.push(space(n('agentCurl', id.flow, 840, 40 + senses.length * ROW, {
      strength: 1, size: set.flow.size, evolve: set.flow.evolve,
      __comment: [
        `Curl noise: the flow field (Size ${set.flow.size}, Evolve ${set.flow.evolve}): swirling currents that never bunch up. "Follow a flow field" reads its Force as a direction to turn toward; "apply curl noise" adds it to the velocity as a force.`,
        d3 ? '3D: the curl noise is the Particles engine\'s 3D curl.' : '',
      ].filter(Boolean).join('\n'),
    })));
  }
  set.masks.forEach((m, i) => {
    if (m.kind !== 'texture') return;
    nodes.push(n('sampleTexture', id.mask(i), 840, 40 + (senses.length + 1) * ROW + i * 420, {
      __comment: `Sample (texture): the ${m.name || `Mask ${i + 1}`} texture (the group's input) read where the walker stands, for the rules' "inside a mask"${d3 ? ' (at its x and y: masks are flat in 3D)' : ''}.`,
    }, { texture: IN(`mask${i + 1}`) }));
  });

  // ── Neighbours: one per (which walkers, radius) the rules read ──
  const max = set.neighbours?.max ?? DEFAULT_NEIGHBOURS.max;
  neighbourReads(set).forEach((r, i) => {
    const who = r.who === 'all' ? 'every walker' : r.who === 'own' ? 'the walkers of its own kind' : 'the walkers of other kinds';
    nodes.push(space(n('agentNeighbours', id.neighbours(r.key), 420, 40 + senses.length * ROW + 420 + i * 640, {
      radius: r.radius, max, species: r.who, edges: set.edges === 'wrap' ? 'wrap' : 'stop',
      __comment: [
        `Neighbours: ${who} within ${r.radius} of this one, found through the group's grid (the walkers themselves, not a trail). Count is how many, Centre where their middle is, Heading which way they go on average, Push away from them (harder the closer).`,
        `The rules' ${[...new Set(ruleUses(set, r.who, r.radius))].join(', ')} read it. Max neighbours ${max}: it reads at most that many (Max ÷ ${d3 ? 27 : 9} from each cell round it), so in a crowd denser than that its outputs are estimates from a fixed sample.`,
        set.edges === 'wrap' ? 'Across edges: Wrap, as the rules\' Edges: a walker near one edge sees those near the other.' : 'Across edges: Stop: the edges are walls, as the rules\' Edges.',
      ].join('\n'),
    })));
  });

  // ── Start: the values the rules carry ──
  const dep = usesDeposit(set), die = usesAction(set, 'die'), stop = usesStop(set), fade = usesFade(set), particlesKind = kindOf(set) === 'particles';
  const speeds = set.species.map(s => glf(s.speed));
  const base = speeds.length === 1 ? speeds[0] : speeds.slice(0, -1).map((s, i) => `sp < ${glf(i + 0.5)} ? ${s} : `).join('') + speeds[speeds.length - 1];
  const startLines: Line[] = [
    { lhs: 'float base', op: '=', rhs: base },
    // Particles keep the speed the Emit shot them out at (Speed ±); other kinds start at their species' Speed.
    { lhs: 'float spd', op: '=', rhs: particlesKind ? 'age < 0.025 && speed < 1e-4 ? base : speed' : 'age < 0.025 ? base : speed' },
  ];
  const startExposed: Array<{ name: string; type: ExprType }> = [];
  if (dep) { startLines.push({ lhs: 'vec4 dep', op: '=', rhs: 'vec4(0.0)' }); startExposed.push({ name: 'dep', type: 'vec4' }); }
  if (die) { startLines.push({ lhs: 'float alive', op: '=', rhs: '1.0' }); startExposed.push({ name: 'alive', type: 'float' }); }
  if (stop) { startLines.push({ lhs: 'float done', op: '=', rhs: '0.0' }); startExposed.push({ name: 'done', type: 'float' }); }
  if (fade) { startLines.push({ lhs: 'float bright', op: '=', rhs: '1.0' }); startExposed.push({ name: 'bright', type: 'float' }); }
  nodes.push(block(id.start, 1260, 200, {
    label: 'Start',
    inputs: [{ name: 'speed', type: 'float', from: IN('speed') }, { name: 'age', type: 'float', from: IN('age') }, ...(many ? [{ name: 'sp', type: 'float' as ExprType, from: IN('species') }] : [])],
    lines: startLines,
    result: 'spd', outputType: 'float', exposed: startExposed,
    note: [
      'Start (an Expression Block): the values the rules below pass from one to the next.',
      `base: the species' Speed (${set.species.map(s => `${s.name} ${s.speed}`).join(', ')}), picture units a second.`,
      particlesKind ? 'spd: the speed it had last step, or on its first step the speed its Emit shot it out at (base, the species\' Speed, if the Emit gave none): forces change it from there.' : 'spd: the speed it had last step, or base on its first step after birth (age below 0.025 s), so Set speed and Accelerate last from step to step.',
      dep ? 'dep: how much trail it leaves in each of the four channels this step; the rules\' "leave trail" add to it (0 to start).' : '',
      die ? 'alive: 1; a rule\'s "die" makes it 0.' : '',
      stop ? 'done: 0; a rule with "stop after this rule" makes it 1 when it applies, and the rules below then skip this walker this step.' : '',
      fade ? 'bright: 1; "fade with age" dims it, and Finish multiplies the colour by it.' : '',
      'result: spd.',
    ].filter(Boolean),
  }));

  const src: Record<string, Wire> = { h: IN('heading'), mem: IN('memory'), spd: [id.start, 'result'] };
  if (dep) src.dep = [id.start, 'dep'];
  if (die) src.alive = [id.start, 'alive'];
  if (stop) src.done = [id.start, 'done'];
  if (fade) src.bright = [id.start, 'bright'];
  const CHAIN: Record<string, ExprType> = { h: H, spd: 'float', mem: 'vec2', dep: 'vec4', alive: 'float', done: 'float', bright: 'float' };

  // ── The rules, top to bottom (species by species) ──
  let x = 1680;
  let stopSeen = false;
  set.species.forEach((sp, s) => {
    sp.rules.forEach((rule, ri) => {
      if (rule.off) return;
      const r = ruleBlock(set, rule, s, ri, { d3, many, stopSeen, H, P, src, IN, id, x, chain: CHAIN });
      nodes.push(r.node);
      for (const v of r.modified) src[v] = [r.node.id, v];
      if (rule.stop) stopSeen = true;
      x += 460;
    });
  });

  // ── Finish: its state's colour, and the speed (stuck walkers don't move) ──
  const colourOf = (s: number) => {
    const st = set.species[s].states;
    return st.length === 1 ? vec3Of(st[0].colour) : st.slice(0, -1).map((c, i) => `state < ${glf(i + 0.5)} ? ${vec3Of(c.colour)} : `).join('') + vec3Of(st[st.length - 1].colour);
  };
  const colours = set.species.map((_, s) => colourOf(s));
  const colour = colours.length === 1 ? colours[0] : colours.slice(0, -1).map((c, i) => `sp < ${glf(i + 0.5)} ? (${c}) : `).join('') + `(${colours[colours.length - 1]})`;
  nodes.push(block(id.finish, x, 200, {
    label: 'Finish',
    inputs: [
      { name: 'mem', type: 'vec2', from: src.mem }, { name: 'spd', type: 'float', from: src.spd },
      ...(many ? [{ name: 'sp', type: 'float' as ExprType, from: IN('species') }] : []),
      ...(fade ? [{ name: 'bright', type: 'float' as ExprType, from: src.bright }] : []),
    ],
    lines: [
      { lhs: 'float state', op: '=', rhs: 'floor(mem.x + 0.01)' },
      { lhs: 'float stuck', op: '=', rhs: 'step(0.25, fract(mem.x))' },
      { lhs: 'float speed', op: '=', rhs: 'max(spd, 0.0) * (1.0 - stuck)' },
    ],
    result: fade ? `(${colour}) * bright` : colour, outputType: 'vec3', exposed: [{ name: 'speed', type: 'float' }],
    note: [
      'Finish (an Expression Block): what the rules decided, made ready for Move and Agent Output.',
      'state: the walker\'s state, Memory x without its stuck half.',
      'stuck: 1 once a rule made it stick (Memory x has a half added), else 0.',
      'speed: the speed the rules left (never below 0), and 0 while stuck.',
      `result: its colour, its state's colour (${set.species.map(sp => sp.states.map(st => st.name).join(' / ')).join('; ')})${fade ? ', times bright (dimmed by "fade with age")' : ''}, for Draw agents' Colour by Agent.`,
    ],
  }));
  x += 460;

  // ── Move and Agent Output ──
  nodes.push(space(n('agentMove', id.move, x, 120, {
    speed: set.species[0]?.speed ?? 0.25, edges: set.edges, onObstacle: 'turn',
    __comment: [
      `Move: one step along the heading the rules left, at Finish's speed. Edges: ${set.edges === 'wrap' ? 'Wrap (out one side, in the other)' : set.edges === 'bounce' ? 'Bounce (reflected back in)' : 'Slide (stopped at the edge)'}.`,
    ].join('\n'),
  }, { heading: src.h, speed: [id.finish, 'speed'] })));
  x += 420;
  const outWires: Record<string, Wire> = {
    position: [id.move, 'position'], heading: [id.move, 'heading'], speed: [id.finish, 'speed'], memory: src.mem, colour: [id.finish, 'result'],
  };
  // ── Around a shape (3D): Collide (3D scene) after Move, the heading following the velocity it leaves ──
  if (d3 && set.collide) {
    const c = set.collide;
    nodes.push(space(n('agentCollideScene', id.collide, x, 120, {
      reach: c.reach, x: 0, y: 0, z: 0, margin: c.margin, cushion: c.cushion, bounce: c.bounce, friction: 0.02,
      __comment: [
        `Collide (3D scene): keeps the walkers out of the shape. It reads the Scene (the group's Scene socket) on a coarse 48-cell grid spanning ±${c.reach} round the middle, filled every step, and puts a walker that touches a surface back on it with its inward speed gone (Bounce ${c.bounce} keeps some), parting the stream ${c.cushion} before it touches (Cushion).`,
        'Why after Move: Move takes the step the rules chose; Collide corrects it where it would go into the shape.',
      ].join('\n'),
    }, { scene: IN('scene'), position: [id.move, 'position'], velocity: [id.move, 'velocity'] })));
    x += 420;
    nodes.push(block(id.after, x, 360, {
      label: 'Heading after the shape',
      inputs: [{ name: 'v', type: 'vec3', from: [id.collide, 'velocity'] }, { name: 'h', type: 'vec3', from: [id.move, 'heading'] }],
      lines: [{ lhs: 'float spd', op: '=', rhs: 'length(v)' }],
      result: 'spd > 1e-6 ? v / spd : h', outputType: 'vec3', exposed: [],
      note: [
        'Heading after the shape (an Expression Block): the way the walker now goes, after Collide (3D scene) slid or bounced it off the surface.',
        'spd: how fast it goes after the collision.',
        'result: its velocity\'s direction (the heading the rules turn next step), or Move\'s heading while it stands still.',
      ],
    }));
    x += 420;
    outWires.position = [id.collide, 'position'];
    outWires.heading = [id.after, 'result'];
  }
  if (!d3) outWires.velocity = [id.move, 'velocity'];
  if (die) outWires.alive = src.alive;
  if (dep) outWires.deposit = src.dep;
  nodes.push(space(n('agentOutput', id.output, x, 160, {
    _groupOriginal: true,
    // Born walkers leave no trail on the step they are born: the rules decide every deposit.
    ...(dep ? { quietBirth: true } : {}),
    __comment: [
      'Agent Output: the walker at the end of the step. Position and Heading from Move; Speed and Colour from Finish; Memory (its state and number) from the last rule that changed it.',
      dep ? 'Deposit: the trail the rules left this step, one amount per channel (times Deposit\'s Amount outside). A walker leaves none on the step it is born (quietBirth): only the rules lay trail.' : 'Deposit unwired: it leaves 1 in its own species\' channel (if a Deposit is wired outside).',
      die ? 'Alive: 0 when a rule said die.' : '',
    ].filter(Boolean).join('\n'),
  }, outWires)));
  return nodes;
}

interface RuleCtx {
  d3: boolean; many: boolean; stopSeen: boolean; H: ExprType; P: ExprType;
  src: Record<string, Wire>; IN: (k: string) => Wire; id: ReturnType<typeof ruleIds>; x: number; chain: Record<string, ExprType>;
}

/** One rule as an Expression Block: its `go`, then each action scaled by it. */
function ruleBlock(set: AgentRuleSet, rule: AgentRule, s: number, ri: number, c: RuleCtx): { node: GraphNode; modified: string[] } {
  const lines: Line[] = [];
  const why: Array<[string, string]> = [];
  const reads = new Set<string>();
  const modified = new Set<string>();
  const explain = (name: string, text: string) => { if (!why.some(([n]) => n === name)) why.push([name, text]); };
  const add = (lhs: string, op: string, rhs: string, text: string, mods?: string) => {
    lines.push({ lhs, op, rhs });
    explain(lhs.trim().split(/\s+/).pop()!, text);
    if (mods) { modified.add(mods); reads.add(mods); }
  };
  const read = (v: string) => { reads.add(v); return v; };

  // When
  const terms: string[] = [];
  if (c.stopSeen) terms.push(`(1.0 - ${read('done')})`);
  if (c.many) terms.push(`float(${read('sp')} == ${glf(s)})`);
  let k = 0;
  for (const cond of rule.when) terms.push(...conditionTerm(set, cond, s, ri, () => k++, add, read, c.d3));
  add('float go', '=', terms.length ? terms.join(' * ') : '1.0',
    `1 when this rule applies to this walker this step, else 0: ${[c.stopSeen ? 'no rule above stopped it' : '', c.many ? `it is a ${set.species[s].name}` : '', ...rule.when.filter(w => w.kind !== 'always').map(w => describeCondition(set, s, w))].filter(Boolean).join(', and ') || 'always'}. Every action below is scaled by it.`);

  // Do
  rule.do.forEach((a, j) => actionLines(set, a, s, ri, j + 1, c, add, read));
  if (rule.stop) add('done', '=', `max(${read('done')}, go)`, 'done: 1 once this rule applied, so the rules below skip this walker this step (stop after this rule).', 'done');

  const order = ['h', 'spd', 'mem', 'dep', 'alive', 'done', 'bright'];
  const inputs: Array<{ name: string; type: ExprType; from?: Wire }> = [];
  for (const v of order) if (reads.has(v)) inputs.push({ name: v, type: c.chain[v], from: c.src[v] });
  const extra: Record<string, { type: ExprType; from: Wire }> = {
    sp: { type: 'float', from: c.IN('species') }, age: { type: 'float', from: c.IN('age') }, pos: { type: c.P, from: c.IN('position') },
    flow: { type: c.P, from: [c.id.flow, 'force'] },
    crowd: { type: 'vec4', from: [c.id.sense('own'), 'sample'] },
  };
  neighbourReads(set).forEach((r, i) => {
    const nb = c.id.neighbours(r.key);
    extra[`nb${i + 1}Count`] = { type: 'float', from: [nb, 'count'] };
    extra[`nb${i + 1}Centre`] = { type: c.P, from: [nb, 'centre'] };
    extra[`nb${i + 1}Heading`] = { type: c.P, from: [nb, 'heading'] };
    extra[`nb${i + 1}Push`] = { type: c.P, from: [nb, 'push'] };
  });
  for (const ch of ['own', '0', '1', '2', '3']) {
    extra[smellVar(ch)] = { type: 'vec3', from: [c.id.sense(ch), 'readings'] };
    extra[hereVar(ch)] = { type: 'float', from: [c.id.sense(ch), 'here'] };
  }
  set.masks.forEach((m, i) => { extra[`mask${i + 1}`] = m.kind === 'texture' ? { type: 'vec3', from: [c.id.mask(i), 'color'] } : { type: 'float', from: c.IN(`mask${i + 1}`) }; });
  for (const [name, e] of Object.entries(extra)) if (reads.has(name)) inputs.push({ name, ...e });

  const exposed = order.filter(v => modified.has(v)).map(v => ({ name: v, type: c.chain[v] }));
  const sentence = describeRule(set, s, rule);
  const readsNote = inputs.filter(i => !order.includes(i.name)).map(i => `${i.name} (${READS[i.name.replace(/\d$/, '#').replace(/^(smell|here)(Own|#)$/, '$1').replace(/^nb\d+/, 'nb')] ?? i.name})`);
  const node = block(c.id.rule(s, ri), c.x, 120, {
    label: `Rule ${ri + 1}${c.many ? ` · ${set.species[s].name}` : ''}`,
    inputs, lines, result: 'go', outputType: 'float', exposed,
    note: [
      `Rule ${ri + 1}${c.many ? ` of the ${set.species[s].name}` : ''} (an Expression Block): ${sentence}.`,
      `Its inputs are the values the rules carry (${inputs.filter(i => order.includes(i.name)).map(i => i.name).join(', ') || 'none'}: wired from the rule above that last changed them)${readsNote.length ? ` and what it reads: ${readsNote.join(', ')}` : ''}.`,
      ...why.map(([name, text]) => (text.startsWith(`${name}:`) ? text : `${name}: ${text}`)),
      `result: go (1 when the rule applied this step). ${exposed.length ? `${exposed.map(e => e.name).join(', ')} go on to the next block.` : 'It changes nothing the next block reads.'}`,
    ],
  });
  return { node, modified: [...modified] };
}

const READS: Record<string, string> = {
  sp: 'its species, 0–3', age: 'seconds since it was born', pos: 'where it is', flow: 'the curl-noise flow at the walker',
  crowd: 'the trail\'s four channels where it stands (Sense\'s Channels here): with a velocity Deposit, the crowd\'s flow and count',
  smell: 'Sense\'s readings: x left, y ahead, z right', here: 'the trail where it stands', 'mask#': 'the mask where it stands',
  nbCount: 'how many walkers are within reach (a Neighbours node\'s Count)', nbCentre: 'where their middle is (Neighbours\' Centre)',
  nbHeading: 'which way they go on average (Neighbours\' Heading)', nbPush: 'away from them, harder the closer (Neighbours\' Push)',
};

/** The variable a rule block reads a neighbour output through (nb1Count, nb2Push…). */
function nbVar(set: AgentRuleSet, who: NeighbourWho, radius: number | undefined, what: 'Count' | 'Centre' | 'Heading' | 'Push'): string {
  const r = neighbourReadOf(set, who, radius);
  return `nb${neighbourReads(set).findIndex(x => x.who === r.who && x.radius === r.radius) + 1}${what}`;
}

/** The phrases of the rules that read a neighbour reading, for its node's note. */
function ruleUses(set: AgentRuleSet, who: NeighbourWho, radius: number): string[] {
  const out: string[] = [];
  const same = (w: NeighbourWho, r: number | undefined) => w === who && neighbourReadOf(set, w, r)?.radius === radius;
  for (const s of set.species) for (const r of s.rules) {
    if (r.off) continue;
    for (const c of r.when) if (c.kind === 'neighbours' && same(c.who, c.radius)) out.push('"neighbours within reach"');
    for (const a of r.do) if ((a.kind === 'separate' || a.kind === 'match' || a.kind === 'cohere' || a.kind === 'slow') && same(a.who, a.radius)) out.push(`"${({ separate: 'steer away from neighbours', match: 'match neighbours\' heading', cohere: 'move to their centre', slow: 'slow down in a crowd' } as const)[a.kind]}"`);
  }
  return out;
}

type Add = (lhs: string, op: string, rhs: string, text: string, mods?: string) => void;

function conditionTerm(set: AgentRuleSet, cond: RuleCondition, s: number, ri: number, next: () => number, add: Add, read: (v: string) => string, d3 = false): string[] {
  switch (cond.kind) {
    case 'always': return [];
    case 'sense': {
      const k = chanKey(cond.channel);
      const sm = read(smellVar(k));
      const val = cond.where === 'here' ? read(hereVar(k)) : cond.where === 'ahead' ? `${sm}.y` : cond.where === 'left' ? `${sm}.x` : cond.where === 'right' ? `${sm}.z` : `max(${sm}.x, max(${sm}.y, ${sm}.z))`;
      return [`float(${val} ${cond.cmp} ${glf(cond.value)})`];
    }
    case 'near': {
      const k = String(cond.species);
      const sm = read(smellVar(k));
      return [`float(max(max(${sm}.x, ${sm}.y), max(${sm}.z, ${read(hereVar(k))})) > ${glf(cond.value)})`];
    }
    case 'chance': {
      const i = next() + 1;
      const p = Math.min(Math.max(cond.perSecond, 0), 1);
      add(`float dice${i}`, '=', dice(s, ri, 20 + i), `dice${i}: a fresh random number 0–1 for this walker, this step and this rule (the walker's seed hashed with a number of the rule's own: repeatable).`);
      add(`float odds${i}`, '=', `1.0 - pow(1.0 - ${glf(p)}, a_dt)`, `odds${i}: the chance in one step (a_dt, 1/60 s) of ${Math.round(p * 1000) / 10}% in a second: 1 − (1 − p)^dt, so the chance a second is the same at any number of steps a frame.`);
      return [`float(dice${i} < odds${i})`];
    }
    case 'age': return [`float(${read('age')} ${cond.cmp} ${glf(cond.seconds)})`];
    case 'state': return [`float(floor(${read('mem')}.x + 0.01) ${cond.not ? '!=' : '=='} ${glf(cond.state)})`];
    case 'memory': return [cond.cmp === '=' ? `float(abs(${read('mem')}.y - ${glf(cond.value)}) < 0.001)` : `float(${read('mem')}.y ${cond.cmp} ${glf(cond.value)})`];
    case 'mask': {
      const m = set.masks[cond.mask];
      if (!m) return ['0.0'];
      const v = read(`mask${cond.mask + 1}`);
      return [`float(${m.kind === 'texture' ? `dot(${v}, vec3(0.299, 0.587, 0.114))` : v} ${cond.cmp} ${glf(cond.value)})`];
    }
    case 'neighbours': return [`float(${read(nbVar(set, cond.who, cond.radius, 'Count'))} ${cond.cmp} ${glf(cond.count)})`];
    case 'shape': {
      // In 3D the shape is a column through the depth: only x and y count.
      const p = `${read('pos')}${d3 ? '.xy' : ''}`;
      const at = `vec2(${glf(cond.x)}, ${glf(cond.y)})`;
      const dist = cond.shape === 'circle' ? `length(${p} - ${at})` : `max(abs(${p}.x - ${glf(cond.x)}), abs(${p}.y - ${glf(cond.y)}))`;
      return [`float(${dist} ${cond.outside ? '>=' : '<'} ${glf(Math.max(cond.size, 0))})`];
    }
  }
}

function actionLines(set: AgentRuleSet, a: RuleAction, s: number, ri: number, j: number, c: RuleCtx, add: Add, read: (v: string) => string): void {
  const say = describeAction(set, s, a);
  const { d3 } = c;
  // 3D: a direction across the heading to turn in (this step's random plane, kept square to the heading).
  const across = () => {
    add(`vec3 side${j}`, '=', `a_across - ${read('h')} * dot(a_across, h)`, `side${j}: this step's random direction across the heading (a_across), the plane a 3D walker turns in.`);
    add(`side${j}`, '=', `length(side${j}) > 1e-4 ? normalize(side${j}) : agAcross(h, 0.0)`, '');
  };
  /** Turn toward a direction `to` (a vector of the walker's space) by at most `deg`. */
  const toward = (to: string, deg: number, what: string) => {
    if (!d3) {
      add(`vec2 to${j}`, '=', to, `to${j}: the way to ${what}.`);
      add(`float turn${j}`, '=', `length(to${j}) > 1e-6 ? clamp(mod(atan(to${j}.y, to${j}.x) - ${read('h')} + ${PI}, ${TAU}) - ${PI}, -radians(${glf(deg)}), radians(${glf(deg)})) : 0.0`,
        `turn${j}: the angle from the heading to it (the short way round), at most ${deg}° either way.`);
      add('h', '+=', `go * turn${j}`, `h: the heading, turned (${say}).`, 'h');
      return;
    }
    add(`vec3 to${j}`, '=', to, `to${j}: the way to ${what}.`);
    add(`to${j}`, '=', `length(to${j}) > 1e-6 ? normalize(to${j}) : ${read('h')}`, '');
    add(`vec3 side${j}`, '=', `to${j} - h * dot(to${j}, h)`, `side${j}: the part of it across the heading, the plane to turn in.`);
    add(`float turn${j}`, '=', `min(radians(${glf(deg)}), acos(clamp(dot(h, to${j}), -1.0, 1.0)))`, `turn${j}: the angle to it, at most ${deg}°.`);
    add('h', '=', `length(side${j}) > 1e-5 ? agTurn3(h, normalize(side${j}), go * turn${j}) : h`, `h: the heading (a direction in 3D), turned (${say}).`, 'h');
  };
  switch (a.kind) {
    case 'turn': {
      if (a.toward === 'trail') {
        const k = chanKey(a.channel);
        const r = a.away ? `(-${read(smellVar(k))})` : read(smellVar(k));
        add(`float coin${j}`, '=', dice(s, ri, 40 + j), `coin${j}: a random number, for which side when both sides smell stronger than ahead.`);
        add(`float turn${j}`, '=', `${r}.y > ${r}.x && ${r}.y > ${r}.z ? 0.0 : ${r}.y < ${r}.x && ${r}.y < ${r}.z ? (coin${j} < 0.5 ? -1.0 : 1.0) : sign(${r}.x - ${r}.z)`,
          `turn${j}: which way to turn ${a.away ? 'away from' : 'toward'} ${channelName(set, a.channel)} (the slime-mold rule): 0 when it is strongest ahead, a random side when both sides beat ahead, else +1 toward the left sensor or −1 toward the right.`);
        if (d3) { across(); add('h', '=', `agTurn3(${read('h')}, side${j}, go * radians(${glf(a.degrees)}) * turn${j})`, `h: the heading, turned ${a.degrees}° that way (${say}).`, 'h'); }
        else add('h', '+=', `go * radians(${glf(a.degrees)}) * turn${j}`, `h: the heading, turned ${a.degrees}° that way (${say}).`, 'h');
        return;
      }
      const target = a.toward === 'mouse' ? MOUSE : a.toward === 'centre' ? 'vec2(0.0)' : `vec2(${glf(a.x ?? 0)}, ${glf(a.y ?? 0)})`;
      const t = d3 ? `vec3(${target}, 0.0)` : target;
      const pos = read('pos');
      toward(a.away ? `${pos} - ${t}` : `${t} - ${pos}`, a.degrees, a.away ? `away from ${a.toward === 'mouse' ? 'the mouse' : a.toward === 'centre' ? 'the centre' : 'the point'}` : (a.toward === 'mouse' ? 'the mouse' : a.toward === 'centre' ? 'the centre' : 'the point'));
      return;
    }
    case 'flow':
      toward(a.away ? `-${read('flow')}` : read('flow'), a.degrees, a.away ? 'against the flow' : 'along the flow');
      return;
    case 'align':
      // A velocity trail's channels where it stands: the crowd's summed velocity (x, y, and z in 3D).
      toward(`${read('crowd')}.${d3 ? 'xyz' : 'xy'}`, a.degrees, 'the way the crowd round it flies (the velocity trail\'s flow here)');
      return;
    case 'wander':
      add(`float wobble${j}`, '=', `(${dice(s, ri, 60 + j)} * 2.0 - 1.0) * radians(${glf(a.degrees)})`, `wobble${j}: a random turn of up to ${a.degrees}° either way.`);
      if (d3) { across(); add('h', '=', `agTurn3(${read('h')}, side${j}, go * wobble${j})`, `h: the heading, wobbled (${say}).`, 'h'); }
      else add('h', '+=', `go * wobble${j}`, `h: the heading, wobbled (${say}).`, 'h');
      return;
    case 'speed':
      read('spd');
      if (a.mode === 'set') add('spd', '=', `mix(spd, ${glf(a.value)}, go)`, `spd: the speed (${say}).`, 'spd');
      else add('spd', '+=', `go * ${glf(a.value)} * a_dt`, `spd: the speed (${say}: a_dt is one step, 1/60 s).`, 'spd');
      return;
    case 'trail': {
      read('dep');
      const fade = a.fade ? ` * exp(-${glf(a.fade)} * ${read('mem')}.y)` : '';
      if (a.channel === 'own' || a.channel === undefined) add('dep', '+=', `go * ${glf(a.amount)}${fade} * vec4(equal(vec4(${read('sp')}), vec4(0.0, 1.0, 2.0, 3.0)))`, `dep: the trail it leaves, ${a.amount} in its own species' channel${a.fade ? ', weaker the bigger its Memory number' : ''} (${say}).`, 'dep');
      else add(`dep.${'xyzw'[a.channel]}`, '+=', `go * ${glf(a.amount)}${fade}`, `dep.${'xyzw'[a.channel]}: the trail it leaves in channel ${a.channel + 1} (${say}).`, 'dep');
      return;
    }
    case 'state':
      read('mem');
      add('mem.x', '=', `mix(mem.x, ${glf(a.state)} + fract(mem.x), go)`, `mem.x: its state, now ${a.state} (${say}); the fraction keeps a stuck walker stuck.`, 'mem');
      return;
    case 'memory':
      read('mem');
      if (a.mode === 'set') add('mem.y', '=', `mix(mem.y, ${glf(a.value)}, go)`, `mem.y: its Memory number (${say}).`, 'mem');
      else if (a.mode === 'add') add('mem.y', '+=', `go * ${glf(a.value)}`, `mem.y: its Memory number (${say}).`, 'mem');
      else if (a.mode === 'perSecond') add('mem.y', '+=', `go * ${glf(a.value)} * a_dt`, `mem.y: its Memory number (${say}: a_dt is one step, 1/60 s).`, 'mem');
      else {
        add(`float dice${j + 10}`, '=', dice(s, ri, 80 + j), `dice${j + 10}: a random number 0–1 for this walker and step.`);
        add('mem.y', '=', `mix(mem.y, dice${j + 10} * ${glf(a.value)}, go)`, `mem.y: its Memory number (${say}).`, 'mem');
      }
      return;
    case 'stop':
      add('spd', '*=', `1.0 - go`, `spd: the speed, 0 when this rule applies (${say}).`, 'spd');
      return;
    case 'stick':
      read('mem');
      add('spd', '*=', `1.0 - go`, `spd: the speed, 0 when this rule applies (${say}).`, 'spd');
      add('mem.x', '=', `mix(mem.x, floor(mem.x + 0.01) + 0.5, go)`, 'mem.x: its state with a half added: the mark of a stuck walker (Finish keeps its speed at 0 from now on).', 'mem');
      return;
    case 'die':
      add('alive', '*=', `1.0 - go`, `alive: 0 when this rule applies (${say}).`, 'alive');
      return;
    case 'spawn':
      read('dep');
      add('dep.w', '+=', `go * ${glf(a.amount)}`, `dep.w: a birth mark in trail channel 4 (${say}): the group's Births Emit gives birth where there are marks.`, 'dep');
      return;
    case 'bounce':
      if (d3) add('h', '=', `mix(${read('h')}, -h, go)`, `h: the heading, turned round (${say}).`, 'h');
      else add('h', '+=', `go * ${PI}`, `h: the heading, turned round (${say}).`, 'h');
      return;
    // ── Neighbours (a Neighbours node per (which walkers, radius): the walkers themselves) ──
    case 'separate':
      toward(read(nbVar(set, a.who, a.radius, 'Push')), a.degrees, 'get away from the walkers within reach (their Push, harder the closer they are; 0 when there are none)');
      return;
    case 'match':
      toward(read(nbVar(set, a.who, a.radius, 'Heading')), a.degrees, 'go the way the walkers within reach go (their average velocity; 0 when there are none)');
      return;
    case 'cohere':
      toward(`${read(nbVar(set, a.who, a.radius, 'Centre'))} - ${read('pos')}`, a.degrees, 'the middle of the walkers within reach (their Centre less its position; 0 when there are none)');
      return;
    case 'slow': {
      read('spd');
      const count = read(nbVar(set, a.who, a.radius, 'Count'));
      add(`float crowded${j}`, '=', `clamp(${count} / ${glf(Math.max(a.jam, 1e-3))}, 0.0, 0.95)`, `crowded${j}: how many walkers are within reach against Jam (${a.jam}), at most 0.95 so nobody stops for good.`);
      add('spd', '=', `mix(spd, ${glf(set.species[s].speed)} * (1.0 - crowded${j}), go)`, `spd: the species' Speed (${set.species[s].speed}), slower the more crowded (${say}).`, 'spd');
      return;
    }
    // ── Edges, orbits ──
    case 'avoidEdges': {
      const pos = read('pos');
      const m = glf(Math.max(a.margin, 0));
      const axis = (c: string, half: string) => `${pos}.${c} > ${half} - ${m} ? -1.0 : ${pos}.${c} < ${m} - ${half} ? 1.0 : 0.0`;
      const aspect = '(u_resolution.x / u_resolution.y)';
      toward(d3 ? `vec3(${axis('x', aspect)}, ${axis('y', '1.0')}, ${axis('z', '1.0')})` : `vec2(${axis('x', aspect)}, ${axis('y', '1.0')})`, a.degrees,
        `get back inward: −1 or +1 on each axis within ${a.margin} of an edge (the picture is ±aspect across and ±1 up${d3 ? ', and ±1 deep' : ''}), 0 elsewhere`);
      return;
    }
    case 'orbit': {
      const pos = read('pos');
      const target = a.target === 'mouse' ? MOUSE : a.target === 'centre' ? 'vec2(0.0)' : `vec2(${glf(a.x ?? 0)}, ${glf(a.y ?? 0)})`;
      const R = glf(Math.max(a.distance, 1e-3));
      const turnSign = a.cw ? '-1.0' : '1.0';
      if (d3) {
        add(`vec3 off${j}`, '=', `${pos} - vec3(${target}, 0.0)`, `off${j}: from the point it circles to the walker.`);
        add(`float r${j}`, '=', `max(length(off${j}.xy), 1e-5)`, `r${j}: how far it is from the axis through the point (square to the picture).`);
        toward(`vec3(-off${j}.y, off${j}.x, 0.0) * ${turnSign} / r${j} - vec3(off${j}.xy / r${j}, 0.0) * clamp((r${j} - ${R}) / ${R}, -1.0, 1.0) - vec3(0.0, 0.0, off${j}.z)`, a.degrees,
          `go along the circle (${a.cw ? 'clockwise' : 'counter-clockwise'}), in toward it when further than ${a.distance} and out when nearer, and back toward the point's depth`);
        return;
      }
      add(`vec2 off${j}`, '=', `${pos} - ${target}`, `off${j}: from the point it circles to the walker.`);
      add(`float r${j}`, '=', `max(length(off${j}), 1e-5)`, `r${j}: how far it is from the point.`);
      toward(`vec2(-off${j}.y, off${j}.x) * ${turnSign} / r${j} - off${j} / r${j} * clamp((r${j} - ${R}) / ${R}, -1.0, 1.0)`, a.degrees,
        `go along the circle (${a.cw ? 'clockwise' : 'counter-clockwise'}), in toward the point when further than ${a.distance} and out when nearer`);
      return;
    }
    // ── Forces: change the velocity, then the heading and speed follow ──
    case 'force': {
      read('h'); read('spd');
      const P = d3 ? 'vec3' : 'vec2';
      const lift = (v: string) => (d3 ? `vec3(${v}, 0.0)` : v);
      const sv = glf(a.strength);
      const dirOf = (deg: number) => lift(`vec2(${glf(Math.cos(deg * Math.PI / 180))}, ${glf(Math.sin(deg * Math.PI / 180))})`);
      let force: string, why: string;
      if (a.field === 'gravity') { force = `${sv} * ${dirOf(a.angle ?? -90)}`; why = `gravity: ${a.strength} a second², toward ${a.angle ?? -90}° (−90° is down)`; }
      else if (a.field === 'wind') {
        // Gusts: the wind rises and falls over time and across the picture (the step's clock: the same every run).
        force = `${sv} * (1.0 + 0.6 * sin(u_time * 1.3 + ${read('pos')}.y * 2.0) * sin(u_time * 0.37)) * ${dirOf(a.angle ?? 0)}`;
        why = `a gusty wind toward ${a.angle ?? 0}°: ${a.strength} a second², rising and falling over time and across the picture`;
      } else if (a.field === 'curl') { force = `${sv} * ${read('flow')}`; why = `curl noise (the Curl noise node's flow) times ${a.strength}: swirling currents that never bunch up`; }
      else {
        const t = lift(a.field === 'mouse' ? MOUSE : `vec2(${glf(a.x ?? 0)}, ${glf(a.y ?? 0)})`);
        add(`${P} pull${j}`, '=', `${t} - ${read('pos')}`, `pull${j}: from the walker to ${a.field === 'mouse' ? 'the mouse' : 'the point'}.`);
        force = `${sv} * (length(pull${j}) > 1e-4 ? normalize(pull${j}) : ${P}(0.0))`;
        why = `${a.strength < 0 ? 'a push away from' : 'a pull toward'} ${a.field === 'mouse' ? 'the mouse' : 'the point'}, ${Math.abs(a.strength)} a second² whatever the distance`;
      }
      add(`${P} vel${j}`, '=', `${d3 ? 'h' : 'vec2(cos(h), sin(h))'} * spd + go * ${force} * a_dt`, `vel${j}: its velocity (heading × speed) after ${why} for one step (a_dt, 1/60 s).`);
      add('spd', '=', `length(vel${j})`, `spd: the speed, the velocity's length (${say}).`, 'spd');
      add('h', '=', d3 ? `spd > 1e-6 ? vel${j} / spd : h` : `spd > 1e-6 ? atan(vel${j}.y, vel${j}.x) : h`, `h: the heading, the velocity's direction (kept when it stands still).`, 'h');
      return;
    }
    case 'drag':
      read('spd');
      add('spd', '*=', `mix(1.0, exp(-${glf(Math.max(a.amount, 0))} * a_dt), go)`, `spd: the speed, losing ${a.amount} of itself a second (e^(−${a.amount}·dt) a step: the same at any frame rate) (${say}).`, 'spd');
      return;
    case 'fade':
      read('bright');
      add('bright', '*=', `mix(1.0, clamp(1.0 - ${read('age')} / ${glf(Math.max(a.seconds, 1e-3))}, 0.0, 1.0), go)`, `bright: its brightness, from 1 at birth to 0 at ${a.seconds} s old (${say}).`, 'bright');
      return;
  }
}

/** The group's note in rules mode: the rules as sentences. */
export function rulesGroupNote(set: AgentRuleSet): string {
  const lines = ['Agents (rules): this group\'s behaviour is written as When … Do … rules. Press Edit rules (or double-click the card) to change them, or Open as nodes to see and rewire the nodes they make.'];
  set.species.forEach((sp, s) => {
    if (set.species.length > 1) lines.push(`${sp.name}:`);
    sp.rules.forEach((r, i) => lines.push(`${i + 1}. ${describeRule(set, s, r)}`));
  });
  return lines.join('\n');
}
