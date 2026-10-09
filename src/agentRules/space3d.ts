/**
 * space3d.ts — rules groups in 3D (docs/agent-rules.md "2D and 3D", "The 3D Agent Builder").
 *
 *  - The 3D templates: a rule set tuned for a volume (sensors and speed about five times a flat
 *    one's), with the setup round it (Emit, Deposit, the volume Trail, Draw agents' camera).
 *  - `agents3dStarter`: the 3D Agent Builder's setup: Emit (Ball) → Agents (Space 3D, rules) →
 *    Deposit → volume Trail, and Draw agents through an orbiting camera over a dark backdrop → Output.
 *  - `convertGroupSpace`: the editor's Space 2D / 3D switch. It turns the whole setup, not only the
 *    group: the rules' sensors and speeds rescaled, Emit's shape (Disc ↔ Ball, Ring ↔ Sphere), the
 *    Trail's fade, and a camera view (Draw agents) added for 3D and taken away again back in 2D.
 *  - `applyTemplate3d`: a 3D template onto a group and its setup (switching it to 3D first).
 *
 * Pure: the store applies the results (agentRules/storeActions.ts) with one undo step and a compile.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { expr, note } from '../store/agentExampleKit';
import { placeInFreeSpace } from '../store/agentSetup';
import { graphOutput } from '../nodes/scene3dDefaults';
import { applyRulesToGroup, groupRules, isRulesGroup } from './apply';
import { rulesGroupNote } from './generate';
import { type AgentRuleSet, type AgentSpeciesRules, sensedChannels } from './spec';

type Conn = { nodeId: string; outputKey: string };
type Params = Record<string, unknown>;
export type AgentSpace = '2d' | '3d';

/**
 * How much further a 3D walker senses and how much faster it moves than a flat one. A volume's cells
 * are coarse (96 rows: 0.02 across, against 0.002 for a 1024-row trail), so a 3D slime that keeps 2D
 * numbers can't see past its own trail and balls up. ×5 takes the 2D slime's 0.03 ahead and 0.22 a
 * second to 0.15 and 1.1: the middle of the range docs/agents-group.md "3D" gives.
 */
export const SPACE_SCALE = 5;

/** Draw agents' camera for a new 3D view: 3.8 from the middle, 15° up, circling at 6° a second, a little depth of field. */
export const CAMERA_3D = { camDist: 3.8, camAngle: 15, camElevation: 15, rotSpeed: 6, fov: 1.8, ortho: 0, camX: 0, camY: 0, camZ: 0, drift: 0, focus: 1, blur: 0.2, maxBlur: 7 };
export type CameraKey = keyof typeof CAMERA_3D;

/** The camera settings the editor's Look tab shows in 3D (the rest are on the Draw agents card). */
export const CAMERA_CONTROLS: Array<{ key: CameraKey; label: string; step: number; fold?: boolean }> = [
  { key: 'camDist', label: 'Distance', step: 0.01 },
  { key: 'camAngle', label: 'Angle', step: 0.5 },
  { key: 'camElevation', label: 'Elevation', step: 0.5 },
  { key: 'rotSpeed', label: 'Orbit speed', step: 0.5 },
  { key: 'fov', label: 'Zoom', step: 0.01 },
  { key: 'focus', label: 'Focus', step: 0.01, fold: true },
  { key: 'blur', label: 'Blur', step: 0.01, fold: true },
  { key: 'maxBlur', label: 'Max blur', step: 0.5, fold: true },
];

/** Where the group is: 3D or 2D. */
export const spaceOfGroup = (g: GraphNode | undefined): AgentSpace => (g?.params.space === '3d' ? '3d' : '2d');

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * The rule set for the other space: a set that smells a trail gets its Sensors ahead and its speeds
 * (each species' Speed, every "set speed" and "accelerate") times SPACE_SCALE going into 3D, divided
 * by it coming back, so 2D → 3D → 2D is where it started. Sets that don't sense a trail (particles,
 * flocks and swarms with Neighbours) are left as they are: their distances are picture units either way.
 */
export function rescaleForSpace(set: AgentRuleSet, to: AgentSpace): AgentRuleSet {
  if (!sensedChannels(set).length) return set;
  const k = to === '3d' ? SPACE_SCALE : 1 / SPACE_SCALE;
  return {
    ...set,
    sensor: { ...set.sensor, distance: round(set.sensor.distance * k) },
    species: set.species.map(sp => ({
      ...sp,
      speed: round(sp.speed * k),
      rules: sp.rules.map(r => ({ ...r, do: r.do.map(a => (a.kind === 'speed' ? { ...a, value: round(a.value * k) } : a)) })),
    })),
  };
}

// ── The 3D templates ─────────────────────────────────────────────────────────

export interface Rules3dTemplate {
  key: string;
  label: string;
  /** One sentence for the menu and the toast. */
  blurb: string;
  set: () => AgentRuleSet;
  /** The group's Count and Pre-roll. */
  tier: string;
  preroll: number;
  emit: Params;
  deposit: Params;
  trail: Params;
  draw: Params;
  /** A note per node: what it does here and why (the group's note starts with its rules). */
  notes: { group: string[]; emit: string[]; deposit: string[]; trail: string[]; draw: string[] };
}

const base = (o: Partial<AgentRuleSet> & { species: AgentSpeciesRules[] }): AgentRuleSet => ({
  v: 1, channels: ['', '', '', ''], masks: [], edges: 'wrap', sensor: { distance: 0.15, angle: 30 }, flow: { size: 1, evolve: 0.15 }, ...o,
});

const slime3d = (): AgentRuleSet => base({
  kind: 'trail',
  sensor: { distance: 0.15, angle: 30 },
  species: [{
    name: 'Slime', speed: 1.2, states: [{ name: 'walking', colour: [1, 0.78, 0.45] }],
    rules: [{ when: [{ kind: 'always' }], do: [
      { kind: 'turn', toward: 'trail', channel: 'own', degrees: 30 },
      { kind: 'wander', degrees: 6 },
      { kind: 'trail', channel: 'own', amount: 1 },
    ] }],
  }],
});

const flock3d = (): AgentRuleSet => base({
  kind: 'flock',
  neighbours: { radius: 0.08, max: 36 },
  species: [{
    name: 'Birds', speed: 0.7, states: [{ name: 'flying', colour: [0.75, 0.9, 1] }],
    rules: [{ when: [{ kind: 'always' }], do: [
      { kind: 'separate', who: 'all', degrees: 12 },
      { kind: 'match', who: 'all', degrees: 10 },
      { kind: 'cohere', who: 'all', degrees: 3 },
      { kind: 'wander', degrees: 3 },
    ] }],
  }],
});

const orbiters3d = (): AgentRuleSet => base({
  kind: 'swarm',
  neighbours: { radius: 0.08, max: 36 },
  species: [{
    name: 'Swarm', speed: 0.7, states: [{ name: 'circling', colour: [0.55, 0.85, 1] }, { name: 'packed', colour: [1, 0.55, 0.35] }],
    rules: [
      { when: [{ kind: 'always' }], do: [
        { kind: 'orbit', target: 'centre', distance: 0.6, degrees: 5 },
        { kind: 'separate', who: 'all', degrees: 10 },
        { kind: 'cohere', who: 'all', degrees: 2 },
        { kind: 'wander', degrees: 6 },
      ] },
      { when: [{ kind: 'neighbours', who: 'all', cmp: '>', count: 60 }], do: [{ kind: 'state', state: 1 }, { kind: 'speed', mode: 'set', value: 1 }] },
      { when: [{ kind: 'neighbours', who: 'all', cmp: '<', count: 60 }], do: [{ kind: 'state', state: 0 }, { kind: 'speed', mode: 'set', value: 0.7 }] },
    ],
  }],
});

const curl3d = (): AgentRuleSet => base({
  kind: 'particles',
  edges: 'bounce',
  flow: { size: 1.2, evolve: 0.2 },
  species: [{
    name: 'Smoke', speed: 0.5, states: [{ name: 'drifting', colour: [0.6, 0.85, 1] }],
    rules: [
      { when: [{ kind: 'always' }], do: [
        { kind: 'force', field: 'curl', strength: 1.2 },
        { kind: 'drag', amount: 0.4 },
        { kind: 'fade', seconds: 6 },
      ] },
      { when: [{ kind: 'age', cmp: '>', seconds: 6 }], do: [{ kind: 'die' }] },
    ],
  }],
});

export const RULES_TEMPLATES_3D: Rules3dTemplate[] = [
  {
    key: 'slime3d', label: '3D slime mold', set: slime3d, tier: '256k', preroll: 3,
    blurb: 'The slime rule in a volume: walkers burst out of a ball, smell the trail on a cone ahead, turn toward it and leave more. A foam of tubes grows through the box.',
    emit: { mode: 'fill', shape: 'ball', heading: 'outward', x: 0, y: 0, z: 0, size: 0.5, life: 0 },
    deposit: { amount: 4, size: 1, what: 'trail' },
    trail: { volume: '96', diffuse: 1, halfLife: 0.1, edges: 'wrap', gain: 0.04, kernel: '3' },
    draw: { style: 'glow', colorBy: 'heading', palette: 'ab', colorA: [1, 0.55, 0.2], colorB: [0.35, 0.65, 1], scaleBy: 'crowd', size: 1.4, brightness: 2.2, glow: 0.9, fade: 'off', lights: '0', ...CAMERA_3D },
    notes: {
      group: [
        'Space 3D: 262,144 walkers (256k) in a box as deep as the picture is tall. Sensors 0.15 ahead and Speed 1.2: a volume\'s cells are coarse (96 rows), so a 3D slime looks and walks about five times further than a flat one, or it can\'t see past its own trail and balls up.',
        'Pre-roll 3: three seconds simulated first, so the network has started when the picture appears.',
        'Try: Edit rules → turn 15° for long smooth tubes, 60° for a busy foam.',
      ],
      emit: ['Emit: every walker is born at once in a Ball 0.5 round the middle, facing outward, so the network grows out from a seed.', 'Try: Shape Whole picture with Facing Random for a network everywhere at once.'],
      deposit: ['Deposit: every walker drops 4 units of trail in the volume cell it stands in, every step (the rules\' "leave trail" × 4).', 'Why: where many walk, more trail pulls in more walkers, and tubes form.'],
      trail: ['Trail field, filled by a 3D group: a volume 96 rows tall and 96 slices deep. Each step every cell is averaged with its 6 neighbours and half fades in 0.1 s.', 'Its Image goes back into the group, where the rules\' Sense reads it in 3D. Its Amount would be the volume seen from the front; Draw agents shows the walkers through a camera instead.', 'Try: Volume 128 for finer tubes (more memory), 64 for a fast coarse one.'],
      draw: ['Draw agents in 3D: every walker a soft glowing dot, amber one way and blue the other (Colour by Heading), seen by a camera 3.8 from the middle that circles at 6° a second, 15° above.', 'Blur 0.2: the middle of the box is sharp, the near and far walkers soft, which makes the depth read.', 'Try: Edit rules → Look for the camera; Orbit speed 0 and drag Angle to look from the side.'],
    },
  },
  {
    key: 'flock3d', label: '3D flock (boids)', set: flock3d, tier: '64k', preroll: 4,
    blurb: 'Birds in a box: each sees the birds within 0.08 round it (a ball), steers away from the closest, matches their heading and drifts to their centre. Flocks gather and wheel in 3D.',
    emit: { mode: 'fill', shape: 'screen', heading: 'random', x: 0, y: 0, z: 0, size: 1, life: 0 },
    deposit: { amount: 0.4, size: 1, what: 'trail' },
    trail: { volume: '64', diffuse: 1, halfLife: 0.08, edges: 'wrap', gain: 0.04, kernel: '5' },
    draw: { style: 'streaks', colorBy: 'heading', palette: 'ab', colorA: [1, 0.72, 0.4], colorB: [0.45, 0.75, 1], scaleBy: 'crowd', size: 1.5, brightness: 0.6, glow: 0.35, streak: 0.35, fade: 'off', lights: '0', ...CAMERA_3D, camDist: 3.6, camAngle: 0, camElevation: 20, rotSpeed: 10, drift: 0.05, blur: 0.15 },
    notes: {
      group: [
        'Space 3D, Kind Flock: 65,536 birds (64k). Each finds the birds within 0.08 of it (one Neighbours node: in 3D the 27 grid cells round it) and steers by Reynolds\' three rules.',
        'Speed 0.7: picture units a second, as in 2D (the box is 2 tall). Neighbours aren\'t a trail, so nothing here needs rescaling for the volume.',
        'Try: Edit rules → separation 20° for airy flocks, cohesion 6° for tight balls.',
      ],
      emit: ['Emit: birds everywhere in the box at once (Whole picture: across, up and 2 deep), facing anywhere. The flocks sort themselves out within seconds.'],
      deposit: ['Deposit: a faint mark where each bird flies. The birds don\'t smell it (they see each other with Neighbours); it is there for a rule that wants a trail.'],
      trail: ['Trail field, a 64-row volume blurred wide and gone in 0.08 s: where the flocks are right now. Nothing reads it yet; Edit rules → align with the crowd would.'],
      draw: ['Draw agents in 3D: each bird a short streak, warm one way and cool the other, so the flocks\' directions show; the camera circles at 10° a second, 20° up, drifting a little.'],
    },
  },
  {
    key: 'orbiters3d', label: 'Swarm: orbiters in 3D', set: orbiters3d, tier: '64k', preroll: 4,
    blurb: 'A swarm circling the middle in a box: each orbits the centre\'s axis, keeps apart and drifts toward its neighbours; packed spots turn orange and speed out. A galaxy-like ring seen from above.',
    emit: { mode: 'fill', shape: 'ball', heading: 'random', x: 0, y: 0, z: 0, size: 0.8, life: 0 },
    deposit: { amount: 0.4, size: 1, what: 'trail' },
    trail: { volume: '64', diffuse: 1, halfLife: 0.1, edges: 'wrap', gain: 0.04, kernel: '3' },
    draw: { style: 'glow', colorBy: 'agent', palette: 'ab', scaleBy: 'crowd', size: 1.5, brightness: 1.6, glow: 1.1, fade: 'off', lights: '0', ...CAMERA_3D, camDist: 3.2, camAngle: 30, camElevation: 38, rotSpeed: 4, drift: 0.08, blur: 0.35, maxBlur: 8 },
    notes: {
      group: [
        'Space 3D, Kind Swarm: 65,536 walkers (64k). Orbit circles the centre round an axis through it square to the picture, at any depth, so the swarm makes a thick ring; Neighbours (0.08, a ball in 3D) keep them apart and together.',
        'More than 60 neighbours: packed (orange) and faster, so crowded spots spill out; fewer: circling (blue) again. A 3D ball holds fewer neighbours than a 2D disc of the same radius, hence 60 rather than the flat template\'s 250.',
        'Try: Edit rules → orbit distance 0.3 for a tight core; switch the cohesion off for a looser cloud.',
      ],
      emit: ['Emit: every walker born at once anywhere in a Ball 0.8 round the middle, facing any way. The orbit gathers them into the ring.'],
      deposit: ['Deposit: a faint mark where each walker flies, for a rule that wants a trail (these rules don\'t read one).'],
      trail: ['Trail field, a 64-row volume fading in 0.1 s. Nothing reads it yet.'],
      draw: ['Draw agents in 3D, Colour by Agent: each walker in its state\'s colour (blue circling, orange packed). The camera looks down from 38° and circles at 4° a second; Blur 0.35 softens the near and far ones.'],
    },
  },
  {
    key: 'curl3d', label: 'Particles: 3D curl smoke', set: curl3d, tier: '64k', preroll: 4,
    blurb: 'Particles born in a small ball, carried by 3D curl noise into folding sheets and threads, slowed by drag; each fades over six seconds and is born again.',
    emit: { mode: 'respawn', shape: 'ball', heading: 'random', x: 0, y: 0, z: 0, size: 0.25, life: 0, speed: 0.3, speedVar: 0.5, spread: 1 },
    deposit: { amount: 0.3, size: 1, what: 'trail' },
    trail: { volume: '64', diffuse: 1, halfLife: 0.1, edges: 'clamp', gain: 0.04, kernel: '3' },
    draw: { style: 'glow', colorBy: 'agent', palette: 'ab', scaleBy: 'crowd', size: 1.3, brightness: 1.4, glow: 1, fade: 'off', lights: '0', ...CAMERA_3D, camDist: 3.4, camElevation: 10, rotSpeed: 8, blur: 0.3 },
    notes: {
      group: [
        'Space 3D, Kind Particles: 65,536 particles (64k), no sensing. Always: curl noise pushes (in a 3D group it is the Particles engine\'s 3D curl, so streams fold into sheets), drag slows, and the colour fades over 6 s; older than 6 s: die, and Emit\'s Keep full brings it straight back.',
        'Edges Bounce keeps them in the box.',
        'Try: Edit rules → curl 2.5 for a storm; Flow size 3 (Trails tab) for small eddies.',
      ],
      emit: ['Emit (Keep full): every particle is born in a small Ball 0.25 in the middle, flying any way at about 0.3, and born there again the moment it dies.'],
      deposit: ['Deposit: a faint mark where each particle flies, for a rule that wants a trail (these rules don\'t read one).'],
      trail: ['Trail field, a 64-row volume fading in 0.1 s. Nothing reads it yet.'],
      draw: ['Draw agents in 3D, Colour by Agent: each particle in its state\'s pale blue, dimmed with its age ("fade with age"), as soft glowing dots; the camera circles at 8° a second.'],
    },
  },
];

export const rulesTemplate3d = (key: string) => RULES_TEMPLATES_3D.find(t => t.key === key);

// ── The setup's pieces ───────────────────────────────────────────────────────

/** A dark backdrop for a 3D view (UV → an Expression Block): plum at the bottom, deep blue at the top, a faint glow in the middle. */
function backdrop(uvId: string, backId: string, x: number, y: number, extra: Params = {}): GraphNode[] {
  const uv = n('uv', uvId, x, y, { ...extra, ...note(['UV: where each pixel is on the picture, for the night backdrop behind the 3D walkers.']) });
  const back = expr(backId, x + 420, y, {
    label: 'Night',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [['float h', 'uv.y * 0.5 + 0.5'], ['float halo', 'exp(-dot(uv, uv) * 1.5)']],
    result: 'mix(vec3(0.010, 0.006, 0.012), vec3(0.004, 0.008, 0.020), h) + vec3(0.030, 0.012, 0.020) * halo',
    outputType: 'vec3',
    wires: { uv: [uvId, 'uv'] },
    note: [
      'Night (an Expression Block): the backdrop Draw agents draws the walkers over, so the camera\'s view has a sky rather than black.',
      'h: 0 at the bottom of the picture, 1 at the top. halo: 1 in the middle, fading out, a faint glow behind the walkers.',
      'Result: near-black, dark plum at the bottom to deep blue at the top, with the glow in the middle.',
    ],
  });
  back.params = { ...back.params, ...extra };
  return [uv, back];
}

/** The 3D Agent Builder's setup (temporary ids; the store gives it fresh ones), from 3D template `key`. */
export function agents3dStarter(key = 'slime3d'): { nodes: GraphNode[]; out: Conn; groupId: string } {
  const t = rulesTemplate3d(key) ?? RULES_TEMPLATES_3D[0];
  const set = t.set();
  const emit = n('agentEmit', 'a3Emit', 0, 0, { ...t.emit, ...note(t.notes.emit) });
  let group = n('agentsGroup', 'a3Agents', 420, 0, {
    label: `${t.label} (rules)`, space: '3d', tier: t.tier, species: String(set.species.length), stepsPerFrame: 2, seed: 1, preroll: t.preroll,
    subgraph: { nodes: [], inputPorts: [], outputPorts: [] },
  }, { emit: ['a3Emit', 'emitter'] });
  group = applyRulesToGroup(group, set);
  group.params.__comment = [rulesGroupNote(set), ...t.notes.group, 'Start here: Edit rules (Space 2D / 3D at the top), Templates… for another 3D setup, the Look tab for the camera.'].join('\n');
  if (group.inputs.trail) group.inputs.trail = { ...group.inputs.trail, connection: { nodeId: 'a3Trail', outputKey: 'texture' } };
  const deposit = n('agentDeposit', 'a3Deposit', 840, 0, { ...t.deposit, ...note(t.notes.deposit) }, { agents: ['a3Agents', 'agents'] });
  const trail = n('trailField', 'a3Trail', 1260, 0, { resolution: '0.5', ...t.trail, ...note(t.notes.trail) }, { deposit: ['a3Deposit', 'deposit'] });
  const back = backdrop('a3Uv', 'a3Back', 840, 760);
  const draw = n('drawAgents', 'a3Draw', 1680, 0, { ...t.draw, ...note(t.notes.draw) }, { agents: ['a3Agents', 'agents'], over: ['a3Back', 'result'] });
  return { nodes: [emit, group, deposit, trail, ...back, draw], out: { nodeId: 'a3Draw', outputKey: 'color' }, groupId: 'a3Agents' };
}

// ── What a group's setup is ──────────────────────────────────────────────────

const reads = (nd: GraphNode, id: string) => Object.values(nd.inputs).some(i => i.connection?.nodeId === id);

/** The group's own Emits (its Emit chain, not the rules' Births Emit), its Deposits, Trail fields and Draw agents. */
export function setupOf(nodes: GraphNode[], groupId: string): { emits: GraphNode[]; deposits: GraphNode[]; trails: GraphNode[]; draws: GraphNode[] } {
  const byId = new Map(nodes.map(x => [x.id, x]));
  const g = byId.get(groupId);
  const emits: GraphNode[] = [];
  let c = g?.inputs.emit?.connection;
  const seen = new Set<string>();
  while (c && !seen.has(c.nodeId)) {
    seen.add(c.nodeId);
    const e = byId.get(c.nodeId);
    if (e?.type !== 'agentEmit') break;
    if (e.params.__rulesBirth !== true) emits.push(e);
    c = e.inputs.also?.connection;
  }
  const deposits = nodes.filter(x => x.type === 'agentDeposit' && x.inputs.agents?.connection?.nodeId === groupId);
  const trails = nodes.filter(x => x.type === 'trailField' && deposits.some(d => reads(x, d.id)));
  const draws = nodes.filter(x => x.type === 'drawAgents' && x.inputs.agents?.connection?.nodeId === groupId);
  return { emits, deposits, trails, draws };
}

const EMIT_TO_3D: Record<string, string> = { disc: 'ball', ring: 'sphere' };
const EMIT_TO_2D: Record<string, string> = { ball: 'disc', sphere: 'ring' };

/**
 * The editor's Space switch: the group and its setup turned to `to`, or null when it is there
 * already. `nextId` names the nodes a 3D view adds.
 *
 *  - The group: Space, and its rules generated again for it, rescaled (rescaleForSpace).
 *  - Emit: Disc ↔ Ball and Ring ↔ Sphere, a 3D shape twice the size (a ball looks smaller than the disc it replaces).
 *  - Trail field: it becomes a volume by itself (a 3D group fills it); its Volume is set (96 when
 *    unset) and its Half-life doubled (a volume's coarse cells want a longer-lasting trail), halved back.
 *  - The view: in 3D the walkers are seen through Draw agents' camera. A Draw agents of the group
 *    gets the camera's settings where it has none; when the Output doesn't show one, it is wired to
 *    one (a new Draw agents over a night backdrop when the group has none, marked as added for 3D),
 *    and what it showed is remembered on the group. Back in 2D the added nodes go and the Output
 *    shows what it showed before.
 */
export function convertGroupSpace(nodes: GraphNode[], groupId: string, to: AgentSpace, nextId: () => string): { nodes: GraphNode[]; message: string; added: string[] } | null {
  const g = nodes.find(x => x.id === groupId);
  if (!g || g.type !== 'agentsGroup' || spaceOfGroup(g) === to) return null;
  const d3 = to === '3d';
  const setup = setupOf(nodes, groupId);
  const emitIds = new Set(setup.emits.map(x => x.id));
  const trailIds = new Set(setup.trails.map(x => x.id));
  const drawIds = new Set(setup.draws.map(x => x.id));
  const said: string[] = [];

  // The group, its rules rescaled.
  let group: GraphNode = { ...g, params: { ...g.params, space: to } };
  if (isRulesGroup(g) || g.params.agentRules) {
    const was = groupRules(g);
    const set = rescaleForSpace(was, to);
    if (set !== was) said.push(`sensors ${was.sensor.distance} → ${set.sensor.distance} ahead, speed ${was.species[0].speed} → ${set.species[0].speed}`);
    group = isRulesGroup(g) ? applyRulesToGroup(group, set) : { ...group, params: { ...group.params, agentRules: set } };
  }

  let out = nodes.map(x => {
    if (x.id === groupId) return group;
    if (emitIds.has(x.id)) {
      const shape = String(x.params.shape ?? 'disc');
      const next = (d3 ? EMIT_TO_3D : EMIT_TO_2D)[shape];
      if (!next) return x;
      const size = typeof x.params.size === 'number' ? x.params.size : 0.15;
      said.push(`Emit ${shape} → ${next}`);
      return { ...x, params: { ...x.params, shape: next, size: round(d3 ? Math.min(1, size * 2) : size / 2) } };
    }
    if (trailIds.has(x.id)) {
      const hl = typeof x.params.halfLife === 'number' ? x.params.halfLife : 0.05;
      return { ...x, params: { ...x.params, halfLife: round(d3 ? hl * 2 : hl / 2), ...(d3 && !x.params.volume ? { volume: '96' } : {}) } };
    }
    if (d3 && drawIds.has(x.id)) {
      const cam = Object.fromEntries(Object.entries(CAMERA_3D).filter(([k]) => typeof x.params[k] !== 'number'));
      return Object.keys(cam).length ? { ...x, params: { ...x.params, ...cam } } : x;
    }
    return x;
  });
  if (trailIds.size) said.push(d3 ? 'the Trail is a volume' : 'the Trail is flat');

  const output = graphOutput(out);
  const showing = output?.inputs.color?.connection ?? null;
  const added: string[] = [];
  if (d3) {
    if (output && !(showing && drawIds.has(showing.nodeId))) {
      let drawId = setup.draws[0]?.id;
      if (!drawId) {
        const uvId = nextId(), backId = nextId();
        drawId = nextId();
        const mark = { __spaceAdded: groupId };
        const view = [
          ...backdrop(uvId, backId, 0, 760, mark),
          n('drawAgents', drawId, 840, 0, {
            ...RULES_TEMPLATES_3D[0].draw, colorBy: 'agent', ...mark,
            ...note([
              'Draw agents in 3D: added by the editor\'s Space switch, so the 3D walkers are seen through a camera: 3.8 from the middle, 15° up, circling at 6° a second, every walker a soft glowing dot in its state\'s colour (Colour by Agent).',
              'Why: a 3D Trail\'s picture is the volume seen flat from the front; a camera shows the depth. Switching back to 2D takes this away again.',
              'Try: Edit rules → Look for the camera (Distance, Angle, Elevation, Orbit speed, Zoom, Focus and Blur).',
            ]),
          }, { agents: [groupId, 'agents'], over: [backId, 'result'] }),
        ];
        const placed = placeInFreeSpace(out, view, { x: g.position.x + 840, y: g.position.y + 760 });
        out = [...out, ...placed];
        added.push(...placed.map(x => x.id));
        said.push('a camera view added (Draw agents over a night backdrop)');
      } else said.push('the Output shows Draw agents\' camera');
      const id = drawId;
      out = out.map(x => {
        if (x.id === output.id) return { ...x, inputs: { ...x.inputs, color: { ...x.inputs.color, connection: { nodeId: id, outputKey: 'color' } } } };
        if (x.id === groupId) return { ...x, params: { ...x.params, __flatView: showing ?? null } };
        return x;
      });
    }
  } else {
    const gone = new Set(out.filter(x => x.params.__spaceAdded === groupId).map(x => x.id));
    const flat = g.params.__flatView as Conn | null | undefined;
    const restore = output && flat !== undefined && (!showing || gone.has(showing.nodeId) || drawIds.has(showing.nodeId));
    out = out.filter(x => !gone.has(x.id)).map(x => {
      if (restore && x.id === output!.id) {
        const back = flat && out.some(y => y.id === flat.nodeId) && !gone.has(flat.nodeId) ? flat : undefined;
        const color = { ...x.inputs.color };
        if (back) color.connection = back; else delete color.connection;
        return { ...x, inputs: { ...x.inputs, color } };
      }
      if (x.id === groupId) {
        const params = { ...x.params };
        delete params.__flatView;
        return { ...x, params };
      }
      return x;
    });
    if (gone.size) said.push('the camera view it added is gone');
    if (restore) said.push('the Output shows what it showed before');
  }
  const message = `${d3 ? 'In 3D' : 'Flat (2D)'}: ${said.join('; ') || 'the group\'s Space changed'}.`;
  return { nodes: out, message, added };
}

/**
 * 3D template `key` onto the group and its setup: the group switched to 3D first (convertGroupSpace),
 * then its rules, Count and Pre-roll, and the template's Emit, Deposit, Trail and Draw agents settings
 * on the group's own (each node's note rewritten to say what it does now). Null when there is no such group or template.
 */
export function applyTemplate3d(nodes: GraphNode[], groupId: string, key: string, nextId: () => string): { nodes: GraphNode[]; message: string } | null {
  const t = rulesTemplate3d(key);
  const g0 = nodes.find(x => x.id === groupId);
  if (!t || !g0 || g0.type !== 'agentsGroup') return null;
  let list = nodes;
  if (spaceOfGroup(g0) !== '3d') list = convertGroupSpace(nodes, groupId, '3d', nextId)?.nodes ?? nodes;
  const set = t.set();
  const s = setupOf(list, groupId);
  const first = (xs: GraphNode[]) => xs[0]?.id;
  const ids = { emit: first(s.emits), deposit: first(s.deposits), trail: first(s.trails), draw: first(s.draws) };
  list = list.map(x => {
    if (x.id === groupId) {
      const ng = applyRulesToGroup({ ...x, params: { ...x.params, tier: t.tier, preroll: t.preroll } }, set);
      const inputs: GraphNode['inputs'] = { ...ng.inputs };
      if (inputs.trail && !inputs.trail.connection && ids.trail) inputs.trail = { ...inputs.trail, connection: { nodeId: ids.trail, outputKey: 'texture' } };
      return { ...ng, inputs, params: { ...ng.params, label: `${t.label} (rules)`, __comment: [rulesGroupNote(set), ...t.notes.group].join('\n') } };
    }
    if (x.id === ids.emit) return { ...x, params: { ...x.params, ...t.emit, ...note(t.notes.emit) } };
    if (x.id === ids.deposit) return { ...x, params: { ...x.params, ...t.deposit, ...note(t.notes.deposit) } };
    if (x.id === ids.trail) return { ...x, params: { ...x.params, ...t.trail, ...note(t.notes.trail) } };
    if (x.id === ids.draw) return { ...x, params: { ...x.params, ...t.draw, ...note(t.notes.draw) } };
    return x;
  });
  return { nodes: list, message: t.blurb };
}
