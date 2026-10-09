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
 *  - Around a shape (`addShapeAround`, `stripShape`): a ray-marched torus, sphere or box the walkers
 *    flow round, as the "Swarm round a torus" example wires it: the Scene into the group's Scene port
 *    and Collide (3D scene) after Move (the rules' `collide`), Draw agents through the March Camera
 *    and hidden behind the shape by the March Loop's Distance, over the lit shape.
 *
 * Nodes these add are marked with the group's id (`__spaceAdded`, `__shapeAdded`) so switching back
 * or taking the shape away removes exactly them; the builder's own camera view is marked `true`.
 *
 * Pure: the store applies the results (agentRules/storeActions.ts) with one undo step and a compile.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { expr, note } from '../store/agentExampleKit';
import { placeInFreeSpace } from '../store/agentSetup';
import { graphOutput } from '../nodes/scene3dDefaults';
import { DRAW_3D_INPUTS } from '../nodes/definitions/agents';
import { applyRulesToGroup, groupRules, isRulesGroup } from './apply';
import { rulesGroupNote } from './generate';
import { type AgentRuleSet, type AgentSpeciesRules, DEFAULT_COLLIDE, sensedChannels } from './spec';

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
  /** Around a shape: the setup adds this ray-marched shape (addShapeAround) after the rest. */
  shape?: ShapeKind;
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

RULES_TEMPLATES_3D.push({
  key: 'shape3d', label: 'Around a shape: slime round a torus', set: slime3d, tier: '256k', preroll: 3, shape: 'torus',
  blurb: 'The 3D slime round a ray-marched torus: Collide (3D scene) keeps the walkers out of it, so the network grows over and round it; they are drawn through the scene\'s camera and hidden behind it.',
  emit: { mode: 'fill', shape: 'sphere', heading: 'random', x: 0, y: 0, z: 0, size: 1, life: 0 },
  deposit: { amount: 4, size: 1, what: 'trail' },
  trail: { volume: '96', diffuse: 1, halfLife: 0.1, edges: 'wrap', gain: 0.04, kernel: '3' },
  draw: { style: 'glow', colorBy: 'heading', palette: 'ab', colorA: [1, 0.55, 0.2], colorB: [0.35, 0.65, 1], scaleBy: 'crowd', size: 1.4, brightness: 2.2, glow: 0.9, fade: 'off', lights: '0', ...CAMERA_3D, blur: 0.25 },
  notes: {
    group: [
      'Space 3D, round a shape: the 3D slime (sensors 0.15 ahead, Speed 1.2) with Collide (3D scene) after Move, reading the Torus scene through the group\'s Scene socket, so the walkers can\'t go into the torus and their network wraps round it.',
      'Try: Edit rules → Look → Around a shape: Sphere or Box; None takes the shape away again.',
    ],
    emit: ['Emit: every walker born at once on a Sphere 1.0 round the middle (its shell, outside the shape), facing any way, so none starts inside the torus.'],
    deposit: ['Deposit: every walker drops 4 units of trail in the volume cell it stands in, every step (the rules\' "leave trail" × 4).'],
    trail: ['Trail field, filled by a 3D group: a 96-row volume, spread to each cell\'s 6 neighbours and half gone in 0.1 s. Its Image goes back into the group for the rules\' Sense.'],
    draw: ['Draw agents in 3D through the scene\'s camera (Camera from, Camera ray: the March Camera\'s), over the lit torus; Depth is the March Loop\'s Distance, so walkers behind the torus are hidden.', 'Colour by Heading, amber one way and blue the other; Blur 0.25 softens the near and far ones.'],
  },
});

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
  // The camera view is the builder's: marked, so switching to 2D swaps it for the flat palette.
  const back = backdrop('a3Uv', 'a3Back', 840, 760, { __spaceAdded: true });
  const draw = n('drawAgents', 'a3Draw', 1680, 0, { ...t.draw, __spaceAdded: true, ...note(t.notes.draw) }, { agents: ['a3Agents', 'agents'], over: ['a3Back', 'result'] });
  let nodes = [emit, group, deposit, trail, ...back, draw];
  // Around a shape: the shape added round the group (its marks name the temporary ids: the store remaps them, remapMarks).
  if (t.shape) {
    let k = 0;
    nodes = addShapeAround(nodes, 'a3Agents', t.shape, () => `a3s${++k}`)?.nodes ?? nodes;
  }
  return { nodes, out: { nodeId: 'a3Draw', outputKey: 'color' }, groupId: 'a3Agents' };
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
  const g0 = nodes.find(x => x.id === groupId);
  if (!g0 || g0.type !== 'agentsGroup' || spaceOfGroup(g0) === to) return null;
  const d3 = to === '3d';
  const said: string[] = [];
  // A shape works in 3D only: it goes first.
  if (!d3 && shapeOf(nodes, groupId)) { nodes = stripShape(nodes, groupId); said.push('the shape is gone (it works in 3D only)'); }
  const g = nodes.find(x => x.id === groupId)!;
  const setup = setupOf(nodes, groupId);
  const emitIds = new Set(setup.emits.map(x => x.id));
  const trailIds = new Set(setup.trails.map(x => x.id));
  const drawIds = new Set(setup.draws.map(x => x.id));

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
    const gone = addedFor(out, groupId, '__spaceAdded');
    const flat = g.params.__flatView as Conn | null | undefined;
    const lost = !showing || gone.has(showing.nodeId) || drawIds.has(showing.nodeId);
    const restore = !!output && flat !== undefined && lost;
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
    if (gone.size) said.push('the camera view is gone');
    if (restore) said.push('the Output shows what it showed before');
    else if (output && lost && gone.size) {
      // A setup born in 3D (the builder's): the flat view the 2D starter has, the trail through a palette, on the Output.
      const flatView = flatPicture(out, groupId, nextId);
      if (flatView) {
        out = flatView.nodes.map(x => (x.id === output.id ? { ...x, inputs: { ...x.inputs, color: { ...x.inputs.color, connection: flatView.out } } } : x));
        added.push(...flatView.added);
        said.push(flatView.added.length ? 'the trail shows through a palette on the Output, as the 2D starter\'s' : 'the Output shows the trail\'s palette');
      }
    }
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
  // A group round a shape keeps it (and its Collide) through a template without one.
  const had = groupRules(list.find(x => x.id === groupId)!).collide;
  const set = { ...t.set(), ...(had && !t.shape ? { collide: had } : {}) };
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
  if (t.shape) list = addShapeAround(list, groupId, t.shape, nextId)?.nodes ?? list;
  return { nodes: list, message: t.blurb };
}

// ── Nodes added for a group (the 3D view, the shape) ─────────────────────────

type Mark = '__spaceAdded' | '__shapeAdded';

/**
 * The nodes added for the group under `mark`: those marked with its id, its Draw agents marked
 * `true` (the builder's), and what feeds only them and is marked too (the builder's backdrop).
 */
export function addedFor(nodes: GraphNode[], groupId: string, mark: Mark): Set<string> {
  const set = new Set(nodes.filter(x => x.params[mark] === groupId || (x.params[mark] === true && x.type === 'drawAgents' && x.inputs.agents?.connection?.nodeId === groupId)).map(x => x.id));
  for (let grew = true; grew;) {
    grew = false;
    for (const x of nodes) {
      if (set.has(x.id) || !x.params[mark]) continue;
      const readers = nodes.filter(y => reads(y, x.id));
      if (readers.length && readers.every(y => set.has(y.id))) { set.add(x.id); grew = true; }
    }
  }
  return set;
}

/** Owner marks (and the group's remembered flat view) after the setup's nodes got fresh ids. */
export function remapMarks(nodes: GraphNode[], idOf: (old: string) => string): GraphNode[] {
  return nodes.map(x => {
    const params = { ...x.params };
    let changed = false;
    for (const k of ['__spaceAdded', '__shapeAdded'] as const) if (typeof params[k] === 'string') { params[k] = idOf(params[k] as string); changed = true; }
    for (const k of ['__flatView', '__overBefore'] as const) {
      const c = params[k] as Conn | null | undefined;
      if (c) { params[k] = { ...c, nodeId: idOf(c.nodeId) }; changed = true; }
    }
    return changed ? { ...x, params } : x;
  });
}

/** The 2D starter's colours for a trail: black through amber to pale gold. */
const FLAT_STOPS: Array<[number, number, number]> = [[0, 0, 0], [0.16, 0.05, 0.01], [0.75, 0.38, 0.05], [1, 0.82, 0.32], [1, 0.98, 0.85]];

/** The group's trail as the 2D starter shows it: a Stops Palette on its Trail field's Amount (the one there, or a new one). */
function flatPicture(nodes: GraphNode[], groupId: string, nextId: () => string): { nodes: GraphNode[]; out: Conn; added: string[] } | null {
  const trail = setupOf(nodes, groupId).trails[0];
  if (!trail) return null;
  const had = nodes.find(x => x.type === 'stopPalette' && x.inputs.value?.connection?.nodeId === trail.id);
  if (had) return { nodes, out: { nodeId: had.id, outputKey: 'color' }, added: [] };
  const id = nextId();
  const colour = n('stopPalette', id, trail.position.x + 420, trail.position.y, {
    stops: '5', wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
    ...Object.fromEntries(FLAT_STOPS.map((c, i) => [`color${i}`, c])),
    ...note([
      'Stops Palette: the trail\'s Amount as colour, black where there is none, through amber to pale gold in the thickest veins (the 2D starter\'s).',
      'Added when the group went flat: in 2D the trail is the picture; in 3D a camera (Draw agents) shows the walkers instead.',
    ]),
  }, { value: [trail.id, 'amount'] });
  const placed = placeInFreeSpace(nodes, [colour], colour.position);
  return { nodes: [...nodes, ...placed], out: { nodeId: id, outputKey: 'color' }, added: [id] };
}

// ── Around a shape ───────────────────────────────────────────────────────────

export type ShapeKind = 'torus' | 'sphere' | 'box';
export const SHAPE_KINDS: Array<{ value: ShapeKind; label: string }> = [
  { value: 'torus', label: 'Torus' }, { value: 'sphere', label: 'Sphere' }, { value: 'box', label: 'Box' },
];
const SDF_OF: Record<ShapeKind, { type: string; params: Params; note: string[] }> = {
  torus: { type: 'torusSDF3D', params: { majorR: 0.85, minorR: 0.3 }, note: ['Torus SDF 3D: a ring 0.85 from its middle, its tube 0.3 thick, lying flat (round the up axis). Its distance is the whole scene.', 'Try: Tube r 0.15 for a thin hoop the walkers pour through.'] },
  sphere: { type: 'sphereSDF3D', params: { radius: 0.6 }, note: ['Sphere SDF 3D: a ball 0.6 round the middle. Its distance is the whole scene.', 'Try: Radius 0.9 to crowd the walkers against the box\'s edges.'] },
  box: { type: 'boxSDF3D', params: { sizeX: 0.45, sizeY: 0.45, sizeZ: 0.45 }, note: ['Box SDF 3D: a cube 0.9 across round the middle (half-sizes 0.45). Its distance is the whole scene.', 'Try: Size Y 0.1 for a slab the walkers flow over and under.'] },
};

/** The shape round group `groupId` (its Scene Group, marked as added for it) and its kind, or null. */
export function shapeOf(nodes: GraphNode[], groupId: string): { kind: ShapeKind; sceneId: string; camId?: string } | null {
  const scene = nodes.find(x => x.type === 'sceneGroup' && x.params.__shapeAdded === groupId);
  if (!scene) return null;
  const inner = ((scene.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes) ?? [];
  const kind = (Object.keys(SDF_OF) as ShapeKind[]).find(k => inner.some(x => x.type === SDF_OF[k].type)) ?? 'torus';
  const cam = nodes.find(x => x.type === 'marchCamera' && x.params.__shapeAdded === groupId);
  return { kind, sceneId: scene.id, camId: cam?.id };
}

const DRAW_SCENE_KEYS = Object.keys(DRAW_3D_INPUTS) as Array<keyof typeof DRAW_3D_INPUTS>;

/**
 * The group round a ray-marched shape (the "Swarm round a torus" example's wiring), or with its
 * shape changed to `kind` when it has one. The group goes to 3D first. Added, each with a note and
 * marked for the group: Time → March Camera, a Scene Group (Scene Pos → the shape's SDF → Scene
 * Output), a March Loop, the shape's colour, Multi-Light and Tone Map. The rules gain Collide
 * (3D scene) (their `collide`) and the group a Scene socket wired to the Scene. Draw agents sees
 * the walkers through the March Camera (Camera from, Camera ray), hides those behind the shape
 * (Depth: the March Loop's Distance) and draws them over the lit shape; what it drew over before
 * is remembered for stripShape. Emit's Ball or Disc becomes a Sphere shell outside the shape.
 */
export function addShapeAround(nodes: GraphNode[], groupId: string, kind: ShapeKind, nextId: () => string): { nodes: GraphNode[]; message: string } | null {
  const g0 = nodes.find(x => x.id === groupId);
  if (!g0 || g0.type !== 'agentsGroup') return null;
  let list = nodes;
  if (spaceOfGroup(g0) !== '3d') list = convertGroupSpace(list, groupId, '3d', nextId)?.nodes ?? list;
  const sdf = SDF_OF[kind];
  const label = SHAPE_KINDS.find(k => k.value === kind)!.label;
  // A shape there already: only its SDF changes.
  const was = shapeOf(list, groupId);
  if (was) {
    if (was.kind === kind) return null;
    list = list.map(x => {
      if (x.id !== was.sceneId) return x;
      const sg = x.params.subgraph as { nodes: GraphNode[] };
      const inner = sg.nodes.map(m => (m.type === SDF_OF[was.kind].type
        ? { ...n(sdf.type, m.id, m.position.x, m.position.y, { ...sdf.params, ...note(sdf.note) }), inputs: { ...n(sdf.type, m.id, 0, 0).inputs, pos: m.inputs.pos } }
        : m));
      return { ...x, params: { ...x.params, label, subgraph: { ...sg, nodes: inner } } };
    });
    return { nodes: list, message: `The shape is a ${label.toLowerCase()} now.` };
  }
  const mark = { __shapeAdded: groupId };
  const id = { time: nextId(), cam: nextId(), scene: nextId(), pos: nextId(), sdf: nextId(), sOut: nextId(), march: nextId(), mIn: nextId(), mOut: nextId(), base: nextId(), lit: nextId(), tone: nextId() };
  const time = n('time', id.time, 0, 0, { ...mark, ...note(['Time: the clock, so the March Camera circles the shape the same way in the preview and in a recording.']) });
  const cam = n('marchCamera', id.cam, 420, 0, {
    camDist: 3.6, camAngle: 0.4, camElevation: 0.42, rotSpeed: 0.12, fov: 1.6, targetX: 0, targetY: 0, targetZ: 0, ...mark,
    ...note(['March Camera: 3.6 from the middle, 24° above it, circling at 0.12 radians a second. Its Ray Origin and Ray Dir go to the March Loop and to Draw agents (Camera from, Camera ray), so the walkers are seen through the same camera as the shape.', 'Try: Edit rules → Look: its Distance, Angle, Elevation, Orbit speed and Zoom are there.']),
  }, { time: [id.time, 'time'] });
  const scene = n('sceneGroup', id.scene, 0, 300, {
    label, ...mark,
    subgraph: {
      nodes: [
        n('scenePos', id.pos, 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured: every ray step of the march, and every cell of Collide (3D scene)\'s grid.']) }),
        n(sdf.type, id.sdf, 420, 200, { ...sdf.params, ...note(sdf.note) }, { pos: [id.pos, 'pos'] }),
        n('sceneOutput', id.sOut, 840, 200, { _groupOriginal: true, ...note([`Scene Output: the ${label.toLowerCase()}'s distance is the scene: the March Loop draws it, Collide (3D scene) keeps the walkers out of it.`]) }, { dist: [id.sdf, 'dist'] }),
      ],
      inputPorts: [], outputPorts: [],
    },
    ...note([`Scene Group: the shape as one distance function, here a ${label.toLowerCase()}. The same Scene goes to the March Loop (to draw it) and into the Agents group's Scene socket (to collide with it).`, 'Try: Edit rules → Look → Around a shape for a Sphere or a Box.']),
  });
  const march = n('marchLoopGroup', id.march, 840, 0, {
    maxSteps: 80, bg: [0.02, 0.022, 0.035], ...mark,
    subgraph: {
      nodes: [
        n('marchLoopInputs', id.mIn, 0, 180, { _groupOriginal: true, ...note(['Group Inputs: where the ray has got to (March Pos) at each step of the march.']) }),
        n('marchLoopOutput', id.mOut, 440, 180, { _groupOriginal: true, ...note(['Group Output: the point measured at this step, left as it is (nothing warped).']) }, { pos: [id.mIn, 'marchPos'] }),
      ],
      inputPorts: [], outputPorts: [],
    },
    ...note(['March Loop: for each pixel, steps along its ray until it hits the shape. Its Normal and Hit light the shape; its Distance (how far the ray went) goes to Draw agents\' Depth, so walkers behind the shape are hidden.']),
  }, { ro: [id.cam, 'ro'], rd: [id.cam, 'rd'], scene: [id.scene, 'scene'] });
  const base = n('colorPicker', id.base, 840, 300, { color: [0.32, 0.34, 0.4], ...mark, ...note(['Color Picker: the shape\'s colour, a cool dark grey that lets the walkers\' light stand out.']) });
  const lit = n('multiLight', id.lit, 1260, 0, {
    sunDirX: 0.6, sunDirY: 0.8, sunDirZ: 0.3, skyR: 0.08, skyG: 0.1, skyB: 0.16, bounceR: 0.05, bounceG: 0.03, bounceB: 0.02, ...mark,
    ...note(['Multi-Light: the shape lit by a sun from above and a faint blue sky; where the rays miss (Hit 0) it stays dark.']),
  }, { baseColor: [id.base, 'rgb'], normal: [id.march, 'normal'], hit: [id.march, 'hit'] });
  const tone = n('toneMap', id.tone, 1680, 0, { mode: 'aces', ...mark, ...note(['Tone Map: keeps the lit shape from clipping; its colour is what Draw agents draws the walkers over.']) }, { color: [id.lit, 'color'] });
  const g = list.find(x => x.id === groupId)!;
  const placed = placeInFreeSpace(list, [time, cam, scene, march, base, lit, tone], { x: g.position.x, y: g.position.y - 1300 });

  const setup = setupOf(list, groupId);
  const drawId = setup.draws[0]?.id;
  const emitId = setup.emits[0]?.id;
  list = list.map(x => {
    if (x.id === groupId) {
      const set = { ...groupRules(x), collide: { ...DEFAULT_COLLIDE } };
      const ng = applyRulesToGroup(x, set);
      return { ...ng, inputs: { ...ng.inputs, scene: { ...ng.inputs.scene, connection: { nodeId: id.scene, outputKey: 'scene' } } } };
    }
    if (x.id === drawId) {
      const inputs: GraphNode['inputs'] = { ...x.inputs, over: { ...x.inputs.over, connection: { nodeId: id.tone, outputKey: 'color' } } };
      inputs.camOrigin = { ...DRAW_3D_INPUTS.camOrigin, connection: { nodeId: id.cam, outputKey: 'ro' } };
      inputs.camRay = { ...DRAW_3D_INPUTS.camRay, connection: { nodeId: id.cam, outputKey: 'rd' } };
      inputs.depth = { ...DRAW_3D_INPUTS.depth, connection: { nodeId: id.march, outputKey: 'dist' } };
      return { ...x, inputs, params: { ...x.params, agentSpace: '3d', __overBefore: x.inputs.over?.connection ?? null } };
    }
    if (x.id === emitId && x.params.shape !== 'sphere') {
      return { ...x, params: { ...x.params, __shapeEmitBefore: { shape: x.params.shape, size: x.params.size }, shape: 'sphere', size: 1 } };
    }
    return x;
  });
  list = [...list, ...placed];
  const output = graphOutput(list);
  if (output && drawId && output.inputs.color?.connection?.nodeId !== drawId) {
    list = list.map(x => (x.id === output.id ? { ...x, inputs: { ...x.inputs, color: { ...x.inputs.color, connection: { nodeId: drawId, outputKey: 'color' } } } } : x));
  }
  return { nodes: list, message: `Round a ${label.toLowerCase()}: Collide (3D scene) keeps the walkers out of it, and they are drawn through its camera, hidden behind it.${drawId ? '' : ' Add a Draw agents (the card\'s Next steps) to see them.'}` };
}

/** The group without its shape: the nodes added for it gone, Collide out of its rules, Draw agents and Emit as they were. */
export function stripShape(nodes: GraphNode[], groupId: string): GraphNode[] {
  const gone = addedFor(nodes, groupId, '__shapeAdded');
  const g = nodes.find(x => x.id === groupId);
  if (!g || (!gone.size && !groupRules(g).collide)) return nodes;
  const setup = setupOf(nodes, groupId);
  const drawIds = new Set(setup.draws.map(x => x.id));
  const emitIds = new Set(setup.emits.map(x => x.id));
  let list = nodes.filter(x => !gone.has(x.id)).map(x => {
    if (x.id === groupId) {
      const set = { ...groupRules(x) };
      delete set.collide;
      return isRulesGroup(x) ? applyRulesToGroup(x, set) : { ...x, params: { ...x.params, agentRules: set } };
    }
    if (drawIds.has(x.id) && x.params.__overBefore !== undefined) {
      const before = x.params.__overBefore as Conn | null;
      const inputs = { ...x.inputs };
      for (const k of DRAW_SCENE_KEYS) if (inputs[k]) { const s = { ...inputs[k] }; delete s.connection; inputs[k] = s; }
      const over = { ...inputs.over };
      if (before && !gone.has(before.nodeId)) over.connection = before; else delete over.connection;
      inputs.over = over;
      const params = { ...x.params };
      delete params.__overBefore;
      return { ...x, inputs, params };
    }
    if (emitIds.has(x.id) && x.params.__shapeEmitBefore) {
      const b = x.params.__shapeEmitBefore as { shape: unknown; size: unknown };
      const params: Params = { ...x.params, shape: b.shape, size: b.size };
      delete params.__shapeEmitBefore;
      return { ...x, params };
    }
    return x;
  });
  const output = graphOutput(list);
  const showing = output?.inputs.color?.connection;
  if (output && showing && gone.has(showing.nodeId) && setup.draws[0]) {
    list = list.map(x => (x.id === output.id ? { ...x, inputs: { ...x.inputs, color: { ...x.inputs.color, connection: { nodeId: setup.draws[0].id, outputKey: 'color' } } } } : x));
  }
  return list;
}
