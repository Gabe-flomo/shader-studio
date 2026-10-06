/**
 * The Agents family (docs/agents-plan.md): slime mold and other walkers built
 * from nodes, a million of them on the GPU.
 *
 * Outside a graph has an **Agents** group (its inside is the rule one walker
 * follows every step), **Emit** (where walkers are born), **Deposit** (they
 * leave trail), the **Trail field** (it spreads and fades; an ordinary
 * texture) and **Draw agents**. Inside the group: **Agent Inputs** / **Agent
 * Output** (anchored), **Sense**, **Steer**, **Move** and **By species**.
 *
 * None of these compile through the ordinary single-program path: a graph
 * with any of them goes through compilePassGraph (compiler/agentGraph.ts),
 * which compiles the group's inside as one GPU update shader (the
 * `agentProgram` assembler option) and hands the engine (lib/agentRunner.ts)
 * the deposits, trails and drawings to run. In those programs the inside
 * nodes read the current agent from globals the agent prelude defines
 * (`a_pos`, `a_heading`, … see AGENT_GLOBALS); an unwired socket means
 * "this agent". `g_uv` is the agent's position there, so every ordinary node
 * that defaults to g_uv (noise, SDFs, Texture Input…) is evaluated where the
 * agent stands.
 *
 * Positions are the picture's centred coordinates (y −1…1, x scaled by the
 * aspect), the same space as g_uv; distances and speeds are in those units.
 */
import type { GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { fieldFn, p, pv3 } from './helpers';
import { GP_PALETTES } from '../../play/kit/gpuParticles.js';
import { AG_TRAIL_MEAN_GLSL } from '../../play/kit/agentShaders.js';

// ── Names shared by the compiler, the engine and the nodes ──────────────────

/**
 * State textures of a group: A = (pos.xy, heading, age), B = (vel.xy, speed, life); with per-walker
 * state (agentStateC) also C = (species, memory.xy, colour packed in 24 bits) and D = its deposit (vec4).
 */
export const agentStateUniform = (slug: string, which: 'A' | 'B' | 'C' | 'D') => `u_ag${which}_${slug}`;
/** The step number (uint) a group's update shader runs. */
export const agentStepUniform = (slug: string) => `u_agStep_${slug}`;
/** This step's birth window: (start, count, 0, 0) in agent indices. */
export const agentWindowUniform = (slug: string) => `u_agWin_${slug}`;
/** A Trail field's texture (its state as of the last step; inside a group, the step before). */
export const trailUniform = (slug: string) => `u_trail_${slug}`;
/** A Draw agents node's picture (half float, the picture's size). */
export const agentDrawUniform = (slug: string) => `u_agdraw_${slug}`;
/** A Trail with Add / Block wired: its own step program reads the trail as it was (`Src`) and its settings (`Step`). */
export const trailStepUniforms = (slug: string) => ({ src: `u_trSrc_${slug}`, step: `u_trStep_${slug}` });

/** Agent counts: the state texture's side for each tier (as the Particles node's). */
export const AGENT_TIERS: Record<string, number> = { '64k': 256, '256k': 512, '1m': 1024, '4m': 2048 };
/** Trail resolution choices: a share of the picture, or a fixed number of rows. */
export const TRAIL_RESOLUTIONS: Record<string, { scale?: number; rows?: number }> = {
  '0.5': { scale: 0.5 }, '0.25': { scale: 0.25 }, '1': { scale: 1 },
  '512': { rows: 512 }, '1024': { rows: 1024 }, '2048': { rows: 2048 },
};

/** The type of the group node and of the nodes that only make sense inside it. */
export const AGENTS_GROUP_TYPE = 'agentsGroup';
export const AGENT_INSIDE_TYPES = new Set([
  'agentInputs', 'agentOutput', 'agentSense', 'agentSteer', 'agentMove', 'agentBySpecies',
  // Particles (P2): forces, Integrate, Age / Life, and the nodes that move a walker directly.
  'agentGravity', 'agentWind', 'agentCurl', 'agentAttract', 'agentVortex', 'agentFlow', 'agentSoundKick',
  'agentIntegrate', 'agentAge', 'agentCollide', 'agentChladni',
]);
/** The starters in the Simulation category: each builds a whole working setup (store/agentExamples.ts). */
export const AGENT_PRESET_TYPES = new Set([
  'slimeMoldPreset', 'particlesPreset', 'curlSmokePreset', 'soundBurstPreset',
  // P3: species, food and obstacles
  'multiSlimePreset', 'antsPreset', 'boidsPreset', 'strandsPreset', 'growPicturePreset',
  // P6
  'galaxyPreset', 'myceliumPreset', 'sandPlatePreset',
]);
/** Nodes that go outside the group (engines and programs of their own). */
export const AGENT_OUTSIDE_TYPES = new Set(['agentsGroup', 'agentEmit', 'agentDeposit', 'trailField', 'drawAgents']);

/**
 * The globals an agent program defines (declared at file scope, so field
 * functions can read them too), with their GLSL types. Agent Inputs' outputs
 * and every "this agent" default read these.
 */
export const AGENT_GLOBALS: Array<[string, string]> = [
  ['vec2', 'a_pos'], ['vec2', 'a_vel'], ['float', 'a_heading'], ['float', 'a_speed'], ['float', 'a_age'],
  ['float', 'a_life'], ['float', 'a_species'], ['float', 'a_index'], ['float', 'a_random'], ['uint', 'a_seed'], ['bool', 'a_born'], ['uint', 'a_step'],
];
/** Globals only programs with per-walker state (state C) define: its memory and its own colour. */
export const AGENT_STATE_C_GLOBALS: Array<[string, string]> = [['vec2', 'a_mem'], ['vec3', 'a_colour']];

// ── 3D (docs/agents-plan.md "3D") ───────────────────────────────────────────
//
// A group with Space 3D keeps its walkers in a box: the picture across and up (x ±aspect, y ±1)
// and 2 deep (z ±1). State A = (pos.xyz, age), B = (vel.xyz, life): the Particles node's own
// layout. The heading is the velocity's direction (a walker born still keeps its facing as a
// velocity too small to move it). Inside, positions, velocities, forces and headings are vec3;
// the compiler marks every inside node `agentSpace: '3d'` and retypes its sockets
// (withAgentSpace); the store does the same for the cards (syncAgentSpaces).

/** The globals a 3D update shader defines: a_dir is the heading (a unit vector), a_across a random direction across it this step. */
export const AGENT_GLOBALS_3D: Array<[string, string]> = [
  ['vec3', 'a_pos'], ['vec3', 'a_vel'], ['vec3', 'a_dir'], ['vec3', 'a_across'], ['float', 'a_heading'], ['float', 'a_speed'], ['float', 'a_age'],
  ['float', 'a_life'], ['float', 'a_species'], ['float', 'a_index'], ['float', 'a_random'], ['uint', 'a_seed'], ['bool', 'a_born'], ['uint', 'a_step'],
];
/** The 3D box's half size: the picture across and up, 1 deep each way. */
export const AG_BOX3 = 'vec3(u_resolution.x / u_resolution.y, 1.0, 1.0)';
/**
 * 3D helpers: a random unit vector, a random direction across a heading (the plane Sense and Steer
 * turn in this step), a heading turned toward a side by an angle.
 */
export const AG_3D_GLSL = `vec3 agUnit3(inout uint s) { float z = agRnd(s) * 2.0 - 1.0, a = agRnd(s) * 6.2831853; return vec3(sqrt(max(1.0 - z * z, 0.0)) * vec2(cos(a), sin(a)), z); }
vec3 agAcross(vec3 h, float a) { vec3 e1 = normalize(cross(h, abs(h.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))); return cos(a) * e1 + sin(a) * cross(h, e1); }
vec3 agTurn3(vec3 h, vec3 s, float a) { return normalize(cos(a) * h + sin(a) * s); }`;
/**
 * The trail as a volume (a Trail field filled by a 3D group): its z-slices side by side in one
 * texture, `L` = (columns, rows, slices, slices across). Read at q in the box, trilinear (bilinear
 * inside two slices, then between them). Also in kit/agentShaders.js for Deposit and the step.
 */
export const AG_VOL_GLSL = `vec4 agVolAt(highp sampler2D s, vec4 L, vec3 q) {
  vec3 g = (q / vec3(u_resolution.x / u_resolution.y, 1.0, 1.0) * 0.5 + 0.5) * L.xyz - 0.5;
  vec2 xy = clamp(g.xy, vec2(0.0), L.xy - 1.0) + 0.5;
  float z = clamp(g.z, 0.0, L.z - 1.0), z0 = floor(z);
  int tx = int(L.w + 0.5), i0 = int(z0), i1 = min(i0 + 1, int(L.z + 0.5) - 1);
  vec2 size = vec2(textureSize(s, 0));
  vec2 a = (vec2(float(i0 % tx), float(i0 / tx)) * L.xy + xy) / size, b = (vec2(float(i1 % tx), float(i1 / tx)) * L.xy + xy) / size;
  return mix(texture(s, a), texture(s, b), z - z0);
}`;
/** A volume Trail's layout uniform (vec4: columns, rows, slices, slices across). */
export const trailVolUniform = (slug: string) => `${trailUniform(slug)}_vol`;
/** Volume sizes for a Trail in 3D: its rows (and slices); columns follow the picture's shape. */
export const TRAIL_VOLUMES = ['64', '96', '128', '160'] as const;

/**
 * Sockets that are vectors of the walker's space: in 3D they carry vec3 (and a heading is a
 * direction, vec3, not an angle). Keys per node type, inputs and outputs; every other socket is the same in 2D and 3D.
 */
export const AGENT_3D_SOCKETS: Record<string, { in?: string[]; out?: string[] }> = {
  agentInputs: { out: ['position', 'velocity', 'heading', 'direction'] },
  agentOutput: { in: ['position', 'velocity', 'heading'] },
  agentSense: { in: ['position', 'heading'], out: ['gradient'] },
  agentSteer: { in: ['heading'], out: ['heading', 'direction'] },
  agentMove: { in: ['heading', 'direction', 'position', 'also'], out: ['position', 'velocity', 'heading'] },
  agentGravity: { in: ['direction', 'also'], out: ['force'] },
  agentWind: { in: ['position', 'also'], out: ['force'] },
  agentCurl: { in: ['position', 'also'], out: ['force'] },
  agentAttract: { in: ['target', 'position', 'also'], out: ['force'] },
  agentVortex: { in: ['centre', 'position', 'also'], out: ['force'] },
  agentFlow: { in: ['position', 'also'], out: ['force'] },
  agentSoundKick: { in: ['centre', 'position', 'also'], out: ['force'] },
  agentIntegrate: { in: ['force', 'velocity', 'position'], out: ['position', 'velocity', 'heading'] },
  agentCollide: { in: ['position', 'velocity'], out: ['position', 'velocity'] },
  agentChladni: { in: ['position', 'velocity'], out: ['position', 'velocity'] },
  agentEmit: { in: ['position'] },
};
/** Draw agents' sockets in 3D only: a ray-marched scene's camera and depth (docs/agents-group.md "3D"). */
export const DRAW_3D_INPUTS = {
  camOrigin: { type: 'vec3' as const, label: 'Camera from', hint: '3D: a ray-marched scene\'s camera, its ray origin (March Camera → Ray Origin). With Camera ray wired the walkers are seen through that camera, so they stand inside the scene.' },
  camRay: { type: 'vec3' as const, label: 'Camera ray', hint: '3D: the scene camera\'s ray direction (March Camera → Ray Dir).' },
  depth: { type: 'float' as const, label: 'Depth', hint: '3D, with Camera from and Camera ray: the scene\'s distance along each pixel\'s ray (March Loop → Dist). Walkers behind its surfaces are hidden.' },
};

/** Is this node marked as part of a 3D group (by the compiler, or the store for the cards)? */
export const isAgent3d = (n: { params?: Record<string, unknown> }) => n.params?.agentSpace === '3d';

/**
 * A node of (or wired into) an Agents group with its sockets for the group's space: in 3D, marked
 * `agentSpace: '3d'` with its space vectors vec3 (and Draw agents with its scene-camera inputs);
 * in 2D, unmarked with the definition's types. The same node back when nothing changes, so a 2D
 * graph that never was 3D is left exactly as it is.
 */
export function withAgentSpace(n: GraphNode, d3: boolean, defOf: (type: string) => NodeDefinition | undefined): GraphNode {
  const def = defOf(n.type);
  const keys = AGENT_3D_SOCKETS[n.type];
  if (!def || (!keys && n.type !== 'drawAgents')) return n;
  const was = isAgent3d(n);
  let inputs = n.inputs, outputs = n.outputs, changed = was !== d3;
  const retype = <T extends { type: string }>(socks: Record<string, T>, ks: string[] | undefined, defs: Record<string, { type: string }>): Record<string, T> => {
    if (!ks) return socks;
    let out = socks;
    for (const k of ks) {
      const s = socks[k];
      const want = d3 ? 'vec3' : defs[k]?.type;
      if (!s || !want || s.type === want) continue;
      if (out === socks) out = { ...socks };
      out[k] = { ...s, type: want as T['type'] };
      changed = true;
    }
    return out;
  };
  inputs = retype(inputs, keys?.in, def.inputs);
  outputs = retype(outputs, keys?.out, def.outputs);
  if (n.type === 'drawAgents') {
    const extra = Object.entries(DRAW_3D_INPUTS);
    if (d3 && extra.some(([k]) => !inputs[k])) {
      inputs = { ...inputs };
      for (const [k, s] of extra) if (!inputs[k]) inputs[k] = { ...s };
      changed = true;
    } else if (!d3 && extra.some(([k]) => inputs[k])) {
      // Back in 2D the camera sockets go (their wires with them: a flat picture has no camera).
      inputs = Object.fromEntries(Object.entries(inputs).filter(([k]) => !(k in DRAW_3D_INPUTS)));
      changed = true;
    }
  }
  if (!changed) return n;
  const { agentSpace: _drop, ...rest } = n.params;
  return { ...n, inputs, outputs, params: d3 ? { ...rest, agentSpace: '3d' } : rest };
}

/**
 * Every node's sockets for its group's space (the store calls this before each compile, so the
 * cards show vec3 wires inside a 3D group): the inside of each group, its Emit chain, the Draw
 * agents it feeds and the Trails its Deposits fill (a Trail fed by a 3D group is a volume:
 * marked, for its card). Returns the same array when nothing changes.
 */
export function syncAgentSpaces(nodes: GraphNode[], defOf: (type: string) => NodeDefinition | undefined): GraphNode[] {
  if (!nodes.some(n => n.type === AGENTS_GROUP_TYPE || isAgent3d(n))) return nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const space = new Map<string, boolean>();
  for (const g of nodes) if (g.type === AGENTS_GROUP_TYPE) space.set(g.id, g.params.space === '3d');
  const want = new Map<string, boolean>();
  for (const [gid, d3] of space) {
    const g = byId.get(gid)!;
    // Its Emit chain.
    let c = g.inputs.emit?.connection;
    const seen = new Set<string>();
    while (c && !seen.has(c.nodeId)) {
      seen.add(c.nodeId);
      const e = byId.get(c.nodeId);
      if (e?.type !== 'agentEmit') break;
      want.set(e.id, (want.get(e.id) ?? false) || d3);
      c = e.inputs.also?.connection;
    }
  }
  for (const n of nodes) {
    const gid = n.inputs.agents?.connection?.nodeId;
    if (n.type === 'drawAgents' && gid && space.has(gid)) want.set(n.id, space.get(gid)!);
    if (n.type === 'trailField') {
      // Its Deposit chain: 3D when any of them is a 3D group's.
      let d3 = false;
      let c = n.inputs.deposit?.connection;
      const seen = new Set<string>();
      while (c && !seen.has(c.nodeId)) {
        seen.add(c.nodeId);
        const dep = byId.get(c.nodeId);
        if (dep?.type !== 'agentDeposit') break;
        if (space.get(dep.inputs.agents?.connection?.nodeId ?? '')) d3 = true;
        c = dep.inputs.also?.connection;
      }
      want.set(n.id, d3);
    }
  }
  let changed = false;
  const out = nodes.map(n => {
    if (n.type === AGENTS_GROUP_TYPE) {
      const d3 = space.get(n.id)!;
      const sg = n.params.subgraph as { nodes?: GraphNode[] } | undefined;
      if (!sg?.nodes) return n;
      let inner = false;
      const nodesIn = sg.nodes.map(x => { const y = withAgentSpace(x, d3, defOf); if (y !== x) inner = true; return y; });
      if (!inner) return n;
      changed = true;
      return { ...n, params: { ...n.params, subgraph: { ...sg, nodes: nodesIn } } };
    }
    if (n.type === 'trailField') {
      const d3 = want.get(n.id) ?? false;
      if (d3 === isAgent3d(n)) return n;
      changed = true;
      const { agentSpace: _drop, ...rest } = n.params;
      return { ...n, params: d3 ? { ...rest, agentSpace: '3d' } : rest };
    }
    if (n.type !== 'agentEmit' && n.type !== 'drawAgents') return n;
    const d3 = want.get(n.id) ?? false;
    const y = withAgentSpace(n, d3, defOf);
    if (y !== n) changed = true;
    return y;
  });
  return changed ? out : nodes;
}

/**
 * Per-walker state (docs/agents-plan.md §3.3): state C = (species, memory.x, memory.y, colour) and
 * D = the walker's own deposit (one amount per trail channel). Colour is 8 bits a channel packed
 * into one float's 24 exact integer bits. Helpers for programs that have them.
 */
export const AG_STATE_C_GLSL = `float agPackColour(vec3 c) { vec3 q = floor(clamp(c, 0.0, 1.0) * 255.0 + 0.5); return q.r + q.g * 256.0 + q.b * 65536.0; }
vec3 agUnpackColour(float f) { float b = floor(f / 65536.0); float g = floor((f - b * 65536.0) / 256.0); return vec3(f - b * 65536.0 - g * 256.0, g, b) / 255.0; }
vec4 agOneHot(float s) { return vec4(equal(vec4(s), vec4(0.0, 1.0, 2.0, 3.0))); }`;

const SPECIES_OPTIONS = [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }];
const THIS_AGENT = 'Unwired: this walker\'s own (the card shows "← this walker\'s …").';

/**
 * What an unwired socket of a node inside an Agents group reads by itself, as the card's faint
 * chip says it ("← this walker's position"), or null when it has no walker default (a slider, a
 * plain 0). Only for the cards: the compiler's defaults are in each node's generateGLSL.
 */
const WALKER_READS: Record<string, string> = {
  position: '← this walker\'s position', velocity: '← this walker\'s velocity', heading: '← this walker\'s heading',
  random: '← a fresh random number', age: '← this walker\'s age', life: '← this walker\'s life',
};
const WALKER_SOCKETS: Record<string, string[]> = {
  agentSense: ['position', 'heading'], agentSteer: ['heading', 'random'], agentMove: ['position', 'heading'],
  agentWind: ['position'], agentCurl: ['position'], agentAttract: ['position'], agentVortex: ['position'], agentFlow: ['position'],
  agentSoundKick: ['position'], agentIntegrate: ['position', 'velocity'], agentCollide: ['position', 'velocity'],
  agentChladni: ['position', 'velocity'], agentAge: ['age', 'life'],
};
const OUTPUT_KEEPS: Record<string, string> = {
  position: 'unchanged', velocity: 'unchanged', heading: 'unchanged', speed: 'unchanged', memory: 'unchanged', colour: 'unchanged',
  alive: 'lives out its Life', deposit: 'its own species\' channel',
};
export function agentWalkerDefault(type: string, key: string, socketType: string): string | null {
  if (type === 'agentOutput') return OUTPUT_KEEPS[key] ?? null;
  if (type === 'agentSense' && key === 'channels') return 'its own kind +1, others −½';
  if (WALKER_SOCKETS[type]?.includes(key)) return WALKER_READS[key] ?? null;
  // Ordinary nodes (noise, shapes…) read the picture position by default: inside, that is where the walker stands.
  if (key === 'uv' && socketType === 'vec2') return WALKER_READS.position;
  return null;
}

/** `uv` in picture coordinates → 0–1 texture coordinates (Trail and Pass textures cover the picture). */
export const AG_UV_GLSL = 'vec2 agUv(vec2 q) { return q / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5; }';
/** A unit vector at angle a. */
const AG_DIR_GLSL = 'vec2 agDir(float a) { return vec2(cos(a), sin(a)); }';
/** The integer hash the agent prelude uses (gpHash's), and a 0–1 number from a running state. */
export const AG_HASH_GLSL = `uint agHash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float agRnd(inout uint s) { s = agHash(s); return float(s >> 8) / 16777216.0; }`;

const sel = (v: unknown, allowed: string[], fallback: string) => (typeof v === 'string' && allowed.includes(v) ? v : fallback);

/**
 * A place from Play (P4): Hand X / Y, 0–1 across and up the picture, the Particles node's hand
 * units. In Play, right-click Hand X → Follow a hand (or Add as position with Y, then map the pair
 * to a hand, a null, the pose or the pointer): the anchor's 0–1 lands on them unchanged, at any
 * aspect. As a point in picture units (y −1…1, x scaled by the aspect).
 */
export const agHandPlace = (hx: string, hy: string) => `vec2((${hx} * 2.0 - 1.0) * (u_resolution.x / u_resolution.y), ${hy} * 2.0 - 1.0)`;
/** Hand X / Y sliders, shown while `gate` is `value`. */
export const agHandParams = (gate: string, value: string, what: string) => ({
  handX: { label: 'Hand X', type: 'float' as const, min: 0, max: 1, step: 0.001, hint: `${what}, across: 0 left, 1 right.`, help: 'Made for Play: right-click → Follow a hand (or Add as position with Y and map the pair to a hand, a null, the pose or the pointer). 0–1 across the picture at any shape, like the Particles node\'s Hand X.', showWhen: { param: gate, value } },
  handY: { label: 'Hand Y', type: 'float' as const, min: 0, max: 1, step: 0.001, hint: `${what}, up: 0 bottom, 1 top.`, showWhen: { param: gate, value } },
});

// ── The group ────────────────────────────────────────────────────────────────

/**
 * The group's Sound from (P4): 'nodes' leaves every listening node (Sound kick, Chladni) to its
 * own Sound from, Level and Beat; any other choice is shared by all of them (compiler/agentGraph.ts
 * listenersOf). The choices after 'nodes' are the listening nodes' own.
 */
export const AGENT_GROUP_SOUND_FROM = [
  { value: 'nodes', label: 'Each node\'s own' }, { value: 'graph', label: 'Level (and Beat)' }, { value: 'live', label: 'Mic' }, { value: 'master', label: 'Audio engine' },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(k => ({ value: `track${k}`, label: `Engine track ${k}` })),
];
/** Sound from choices that hear something (all but 'nodes'): Level and Beat show for them. */
const GROUP_HEARD = AGENT_GROUP_SOUND_FROM.map(o => o.value).filter(v => v !== 'nodes');

export const AgentsGroupNode: NodeDefinition = {
  type: AGENTS_GROUP_TYPE,
  label: 'Agents',
  category: 'Simulation',
  aliases: ['Agents group', 'Slime mold', 'Physarum', 'Walkers', 'Swarm', 'Simulation'],
  description: 'Up to 4 million walkers on the GPU. Double-click to open the rule one walker follows every step (Sense → Steer → Move); any ordinary node can join in there. Wire an Emit into Emit (where they are born), its Agents output into a Deposit (they leave trail) or Draw agents (to see them).',
  brief: {
    summary: 'Up to 4 million walkers on the GPU, each following the rule inside the group every step. Slime mold, networks and swarms.',
    start: [
      'Easiest: add the Slime mold preset from Simulation and change things from there.',
      'Double-click (or Open rule) to see the rule: Sense the trail, Steer toward it, Move.',
      'Agents → Deposit → Trail field → Palette → Output shows the trail; Draw agents shows the walkers themselves.',
    ],
  },
  inputs: {
    emit: { type: 'emitter', label: 'Emit', hint: 'Where walkers are born: an Emit node (or a chain of them). Unwired, they fill the whole picture at random.' },
  },
  outputs: {
    agents: { type: 'agents', label: 'Agents', hint: 'Wire into Deposit (they leave trail) or Draw agents (to see them).' },
  },
  defaultParams: { tier: '256k', space: '2d', species: '1', stepsPerFrame: 2, seed: 1, preroll: 0, soundFrom: 'nodes', level: 0, beat: 0, pinned: [], restart: 0 },
  paramDefs: {
    space: { label: 'Space', type: 'select', section: 'Agents', hint: '2D: the walkers move on the picture. 3D: they fill a box as deep as the picture is tall, seen through Draw agents\' camera.', help: '2D: walkers move on the picture\'s plane. 3D: they live in a box (the picture across and up, 2 deep), every position, velocity, force and heading inside has a z, Sense reads a cone round the heading, a Trail they fill is a volume, and Draw agents shows them through a camera with depth of field (or a ray-marched scene\'s camera). Shapes and fields wired in (Field ƒ, Obstacle ƒ, Shape ƒ) are read at the walker\'s x and y, the same through the depth. Changing it starts the simulation over.', options: [
      { value: '2d', label: '2D' }, { value: '3d', label: '3D' },
    ] },
    tier: { label: 'Count', type: 'select', section: 'Agents', hint: 'How many walkers.', help: 'How many walkers there are. 256k runs anywhere; 1M is the slime look on a laptop GPU; 4M wants a fast GPU.', options: [
      { value: '64k', label: '64k' }, { value: '256k', label: '256k' }, { value: '1m', label: '1M' }, { value: '4m', label: '4M' },
    ] },
    restart: { label: 'Start over', type: 'float', min: 0, max: 1, step: 0.01, section: 'Agents', hint: 'A trigger: each time it rises past 0.5 the simulation starts over (as ↺ Start over does).', help: 'A trigger for Play: route a key, a beat, a gesture or a rule to it and every walker is born again at step 0, the trails cleared, as the card\'s ↺ Start over does. Live only: a recording or a rendered video runs from its own start.' },
    species: { label: 'Species', type: 'select', section: 'Agents', hint: 'Kinds of walker (by index); each deposits in its own trail channel.', options: SPECIES_OPTIONS },
    stepsPerFrame: { label: 'Steps per frame', type: 'float', min: 1, max: 8, step: 1, hard: true, section: 'Steps', hint: 'Steps the rule runs each frame at 60 fps: the simulation\'s speed.', help: 'How many times every walker runs its rule each frame (at 60 frames a second). More is faster growth. When the GPU can\'t keep up, fewer steps run and the simulation falls behind the clock; the count of walkers never changes.' },
    seed: { label: 'Seed', type: 'float', min: 0, max: 1000, step: 1, section: 'Steps', hint: 'A different seed gives a different (but repeatable) run.' },
    preroll: { label: 'Pre-roll', type: 'float', min: 0, max: 30, step: 0.5, section: 'Steps', hint: 'Seconds simulated before the first frame, so the picture starts grown.' },
    soundFrom: { label: 'Sound from', type: 'select', section: 'Sound', hint: 'What every Sound kick and Chladni inside listens to.', help: 'Each node\'s own: every Sound kick and Chladni inside keeps its own Sound from, Level and Beat. Anything else is shared by all of them, so one choice here drives the whole rule. Level (and Beat): the Level slider below (map Live audio or a track to it in Play) plus the stand-in Beat. Mic: the live input (enable it in Play). Audio engine: the Play page\'s engine, its master or one track. Level is added to what is heard.', options: AGENT_GROUP_SOUND_FROM },
    level: { label: 'Level', type: 'float', min: 0, max: 1, step: 0.01, section: 'Sound', hint: 'How loud it is now, for every listening node inside (map audio to it in Play).', showWhen: { param: 'soundFrom', value: GROUP_HEARD } },
    beat: { label: 'Beat', type: 'float', min: 0, max: 200, step: 1, section: 'Sound', hint: 'A silent stand-in beat, in beats a minute (0: off), for every listening node inside.', help: 'A silent stand-in for music while you build: a kick every beat at this tempo, as a level that jumps and decays. It is part of the simulation (the same every run), so recordings match. Set it to 0 when real sound drives Level. On a Chladni plate each beat also jolts the sand (Shake rises with every hit) and steps it to the next figure, so a slow Beat reads as a regular pulse: that is the beat, not a glitch.', showWhen: { param: 'soundFrom', value: GROUP_HEARD } },
  },
  assignable: false,
  // Never compiled as a node of a program: the compiler builds its update shader from the inside.
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

// ── Inside the group ─────────────────────────────────────────────────────────

/** Agent Inputs' fixed outputs, as globals (or expressions of them). */
export const AGENT_INPUT_OUTPUTS: Record<string, { type: 'float' | 'vec2'; label: string; expr: string; hint: string }> = {
  position: { type: 'vec2', label: 'Position', expr: 'a_pos', hint: 'Where this walker is, in picture coordinates (y −1…1).' },
  velocity: { type: 'vec2', label: 'Velocity', expr: 'a_vel', hint: 'How fast and which way it moved last step (units a second).' },
  heading: { type: 'float', label: 'Heading', expr: 'a_heading', hint: 'Which way it faces, in radians (0 = right, counter-clockwise).' },
  direction: { type: 'vec2', label: 'Direction', expr: 'vec2(cos(a_heading), sin(a_heading))', hint: 'Its heading as a unit vector.' },
  speed: { type: 'float', label: 'Speed', expr: 'a_speed', hint: 'Its speed last step.' },
  age: { type: 'float', label: 'Age', expr: 'a_age', hint: 'Seconds since it was born (simulated time).' },
  life: { type: 'float', label: 'Life', expr: 'a_life', hint: 'How long it lives, in seconds (huge for "forever").' },
  species: { type: 'float', label: 'Species', expr: 'a_species', hint: 'Which kind it is: 0 to Species − 1.' },
  index: { type: 'float', label: 'Index', expr: 'a_index', hint: 'Its number, 0 to the count − 1.' },
  random: { type: 'float', label: 'Random', expr: 'a_random', hint: 'A fresh 0–1 number for this walker every step (repeatable: it depends only on the step and the seed).' },
};
/** Agent Inputs' per-walker state outputs (they need state C; without it Memory reads 0 and Colour white). */
export const AGENT_INPUT_STATE_OUTPUTS: Record<string, { type: 'vec2' | 'vec3'; label: string; expr: string; hint: string }> = {
  memory: { type: 'vec2', label: 'Memory', expr: 'a_mem', hint: 'Two numbers this walker carries from step to step (what Agent Output\'s Memory set last step; 0 when born). Ants: carrying food or not.' },
  colour: { type: 'vec3', label: 'Colour', expr: 'a_colour', hint: 'Its own colour (what Agent Output\'s Colour set last step; white when born).' },
};

export const AgentInputsNode: NodeDefinition = {
  type: 'agentInputs',
  label: 'Agent Inputs',
  category: 'Simulation',
  description: 'Inside an Agents group: this walker at the start of the step. The rule runs once for every walker, every step. Also carries any inputs you add to the group (a Trail\'s texture, a number…).',
  anchored: true,
  inputs: {},
  outputs: Object.fromEntries([...Object.entries(AGENT_INPUT_OUTPUTS), ...Object.entries(AGENT_INPUT_STATE_OUTPUTS)].map(([k, o]) => [k, { type: o.type, label: o.label, hint: o.hint }])),
  defaultParams: { extraInputs: [] },
  paramDefs: {},
  assignable: false,
  // The extra ports are rewired to their outer sources by the compiler; the fixed ones are globals.
  // Memory and Colour exist only with state C: the compiler gives the program it whenever they are read.
  // In 3D the heading is a direction (a_dir), as is Direction.
  generateGLSL: (node: GraphNode) => ({ code: '', outputVars: { ...Object.fromEntries([...Object.entries(AGENT_INPUT_OUTPUTS), ...Object.entries(AGENT_INPUT_STATE_OUTPUTS)].map(([k, o]) => [k, o.expr])), ...(isAgent3d(node) ? { heading: 'a_dir', direction: 'a_dir' } : {}) } }),
};

export const AgentOutputNode: NodeDefinition = {
  type: 'agentOutput',
  label: 'Agent Output',
  category: 'Simulation',
  description: 'Inside an Agents group: this walker at the end of the step. An unwired socket keeps the walker\'s value, so a group with nothing wired here stands still.',
  anchored: true,
  inputs: {
    position: { type: 'vec2', label: 'Position', hint: 'Where it is now: usually Move\'s Position. ' + THIS_AGENT },
    velocity: { type: 'vec2', label: 'Velocity', hint: 'Its velocity (Move\'s Velocity). Unwired: from Heading and Speed, or its own.' },
    heading: { type: 'float', label: 'Heading', hint: 'Which way it faces now (Steer\'s or Move\'s Heading). Unwired: from Velocity, or its own.' },
    speed: { type: 'float', label: 'Speed', hint: 'Its speed now. Unwired: the length of Velocity, or its own.' },
    alive: { type: 'float', label: 'Alive', hint: 'Below 0.5 kills it (Emit can bring it back). Unwired: it lives until its Life runs out.' },
    memory: { type: 'vec2', label: 'Memory', hint: 'Two numbers it keeps for next step (Agent Inputs\' Memory then). Ants: x = carrying food. Unwired: kept as they are.' },
    deposit: { type: 'vec4', label: 'Deposit', hint: 'How much trail it leaves in each of the four channels this step (times Deposit\'s Amount). Unwired: 1 in its own species\' channel.' },
    colour: { type: 'vec3', label: 'Colour', hint: 'Its own colour, for Draw agents\' Colour by Agent. Unwired: kept as it is (white when born).' },
  },
  outputs: {},
  defaultParams: {},
  paramDefs: {},
  assignable: false,
  // Replaced by the compiler with the program's sink (agentStepOut).
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

/**
 * The end of a group's update shader (made by the compiler from Agent Output
 * plus the Emit chain; never in a graph): a walker born this step takes the
 * Emit's state, any other writes what the rule says.
 */
export const AgentStepOutNode: NodeDefinition = {
  type: 'agentStepOut',
  label: 'Agent step output',
  category: 'Output',
  description: 'Internal: what an Agents group\'s update shader writes.',
  inputs: {
    ...AgentOutputNode.inputs,
    emit: { type: 'emitter', label: 'Emit' },
  },
  outputs: {},
  generateGLSL: (node: GraphNode, v) => {
    if (isAgent3d(node)) return stepOut3d(node, v);
    const id = node.id;
    const pos = v.position ?? 'a_pos';
    const head = v.heading ?? (v.velocity ? `(length(${v.velocity}) > 1e-6 ? atan(${v.velocity}.y, ${v.velocity}.x) : a_heading)` : 'a_heading');
    const speed = v.speed ?? (v.velocity ? `length(${v.velocity})` : 'a_speed');
    const vel = v.velocity ?? (v.heading || v.speed ? `vec2(cos(${id}_h), sin(${id}_h)) * ${id}_s` : 'a_vel');
    const alive = v.alive ?? '1.0';
    const em = v.emit;
    // Per-walker state (state C, D): the compiler sets params.stateC when the group has it.
    const stateC = node.params.stateC === true;
    // Born: its species from the Emit (by index when it doesn't say), no memory, white, its own channel.
    const bornC = stateC
      ? `        float ${id}_bs = ${em ? `${em}_sp >= 0.0 ? ${em}_sp : ` : ''}mod(a_index, a_speciesCount);\n        o_c = vec4(${id}_bs, 0.0, 0.0, 16777215.0); o_d = agOneHot(${id}_bs);\n`
      : '';
    const birth = (em
      ? `        o_a = ${em}_a; o_b = ${em}_b;\n`
      // No Emit wired: born anywhere on the picture, facing anywhere, living forever.
      : `        uint ${id}_r = a_seed ^ 0x6A09E667u;\n        float ${id}_aspect = u_resolution.x / u_resolution.y;\n        vec2 ${id}_bp = (vec2(agRnd(${id}_r), agRnd(${id}_r)) * 2.0 - 1.0) * vec2(${id}_aspect, 1.0);\n        o_a = vec4(${id}_bp, agRnd(${id}_r) * 6.2831853 - 3.1415927, 0.0); o_b = vec4(0.0, 0.0, 0.0, 1.0e30);\n`) + bornC;
    const liveC = stateC
      ? `        o_c = vec4(a_species, ${v.memory ?? 'a_mem'}, agPackColour(${v.colour ?? 'a_colour'}));\n        o_d = ${v.deposit ?? 'agOneHot(a_species)'};\n`
      : '';
    return {
      code: [
        `    float ${id}_h = ${head};\n`,
        `    float ${id}_s = ${speed};\n`,
        `    vec2 ${id}_p = ${pos};\n`,
        `    vec2 ${id}_v = ${vel};\n`,
        `    float ${id}_alive = (${alive}) >= 0.5 && a_age < a_life && !any(isnan(${id}_p)) && !any(isinf(${id}_p)) ? a_life : 0.0;\n`,
        `    if (a_born) {\n${birth}    } else {\n`,
        // Headings stay in −π…π so they keep their precision over a long run.
        `        o_a = vec4(${id}_p, mod(${id}_h + 3.1415927, 6.2831853) - 3.1415927, a_age);\n`,
        `        o_b = vec4(${id}_v, ${id}_s, ${id}_alive);\n`,
        liveC,
        `    }\n`,
      ].join(''),
      outputVars: {},
    };
  },
};

/**
 * The 3D sink: state A = (pos.xyz, age), B = (vel.xyz, life). The heading is the velocity's
 * direction, so with Heading wired and Velocity not, the velocity is the heading times the speed:
 * Speed when wired, else how far Position moved this step (across a wrapped edge the short way
 * round), else the speed it had. A speed of 0 keeps the facing as a velocity too small to move it.
 */
function stepOut3d(node: GraphNode, v: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const stateC = node.params.stateC === true;
  const em = v.emit;
  const lines = [`    vec3 ${id}_p = ${v.position ?? 'a_pos'};\n`];
  if (v.velocity) lines.push(`    vec3 ${id}_v = ${v.velocity};\n`);
  else if (v.heading) {
    const moved = v.position
      ? `length(${id}_d - 2.0 * ${AG_BOX3} * floor(${id}_d / (2.0 * ${AG_BOX3}) + 0.5)) / a_dt`
      : 'length(a_vel)';
    lines.push(
      `    vec3 ${id}_h = ${v.heading};\n`,
      `    ${id}_h = length(${id}_h) > 1e-6 ? normalize(${id}_h) : a_dir;\n`,
      v.position && !v.speed ? `    vec3 ${id}_d = ${id}_p - a_pos;\n` : '',
      `    vec3 ${id}_v = ${id}_h * max(${v.speed ?? moved}, 1e-5);\n`,
    );
  } else if (v.speed) lines.push(`    vec3 ${id}_v = a_dir * max(${v.speed}, 1e-5);\n`);
  else lines.push(`    vec3 ${id}_v = a_vel;\n`);
  const bornC = stateC
    ? `        float ${id}_bs = ${em ? `${em}_sp >= 0.0 ? ${em}_sp : ` : ''}mod(a_index, a_speciesCount);\n        o_c = vec4(${id}_bs, 0.0, 0.0, 16777215.0); o_d = agOneHot(${id}_bs);\n`
    : '';
  const birth = (em
    ? `        o_a = ${em}_a; o_b = ${em}_b;\n`
    // No Emit wired: born anywhere in the box, facing anywhere, living forever.
    : `        uint ${id}_r = a_seed ^ 0x6A09E667u;\n        vec3 ${id}_bp = (vec3(agRnd(${id}_r), agRnd(${id}_r), agRnd(${id}_r)) * 2.0 - 1.0) * ${AG_BOX3};\n        o_a = vec4(${id}_bp, 0.0); o_b = vec4(agUnit3(${id}_r) * 1e-5, 1.0e30);\n`) + bornC;
  const liveC = stateC
    ? `        o_c = vec4(a_species, ${v.memory ?? 'a_mem'}, agPackColour(${v.colour ?? 'a_colour'}));\n        o_d = ${v.deposit ?? 'agOneHot(a_species)'};\n`
    : '';
  lines.push(
    `    float ${id}_alive = (${v.alive ?? '1.0'}) >= 0.5 && a_age < a_life && !any(isnan(${id}_p)) && !any(isinf(${id}_p)) && !any(isnan(${id}_v)) ? a_life : 0.0;\n`,
    `    if (a_born) {\n${birth}    } else {\n`,
    `        o_a = vec4(${id}_p, a_age);\n`,
    `        o_b = vec4(${id}_v, ${id}_alive);\n`,
    liveC,
    `    }\n`,
  );
  return { code: lines.join(''), outputVars: {} };
}

export const AgentSenseNode: NodeDefinition = {
  type: 'agentSense',
  label: 'Sense',
  category: 'Simulation',
  aliases: ['Sensor', 'Sniff', 'Smell trail'],
  description: 'Reads the trail (or any field) at three points ahead of the walker: Distance ahead, Angle to the left, straight on, and Angle to the right. Wire Readings into Steer. Texture takes a Trail field (through an input of the group); Field ƒ takes any chain of nodes as a function of position (noise, a shape, a picture) and is read at the same three points.',
  inputs: {
    texture: { type: 'texture', label: 'Trail image', hint: 'What to smell: a Trail field\'s Image (or a Pass), wired in from outside through an input added on Agent Inputs. Read as it was one step ago.' },
    field: { type: 'float', label: 'Field ƒ', field: true, hint: 'Any chain of nodes, read as a function of position at each sensor (noise, a shape\'s distance, a picture\'s brightness). Added to the texture\'s reading.' },
    channels: { type: 'vec4', label: 'Channels', hint: 'How much each trail channel counts. Unwired: +1 for this walker\'s own species, −0.5 for the others (one species: just the first channel).' },
    angle: { type: 'float', label: 'Angle', hint: 'Degrees between the centre sensor and each side one.' },
    distance: { type: 'float', label: 'Distance', hint: 'How far ahead the sensors are, in picture units (the picture is 2 tall).' },
    position: { type: 'vec2', label: 'Position', hint: THIS_AGENT },
    heading: { type: 'float', label: 'Heading', hint: THIS_AGENT },
    also: { type: 'vec3', label: '+ Other readings', hint: 'Chain: another Sense\'s Readings, added to these (sense two things at once).' },
  },
  outputs: {
    readings: { type: 'vec3', label: 'Readings', hint: 'What the sensors read: x left, y centre, z right. Wire into Steer.' },
    here: { type: 'float', label: 'Here', hint: 'The reading where the walker stands.' },
    gradient: { type: 'vec2', label: 'Gradient', hint: 'Which way the reading rises, at the walker (picture units; in 3D a vec3).' },
    sample: { type: 'vec4', label: 'Channels here', hint: 'The Trail image\'s four channels where the walker stands, unweighted (in 3D, read from the volume): a velocity Deposit\'s flow and count, for flocking.' },
  },
  defaultParams: { angle: 45, distance: 0.03, weight: 1, width: '1', cone: 'plane' },
  paramDefs: {
    cone: { label: 'Sensors (3D)', type: 'select', hint: '3D: where the side sensors sit on the cone round the heading.', help: 'Turning plane: the left and right sensors lie in a plane through the heading that turns at random every step, so over a few steps they sweep the whole cone (3 reads, Steer turns in that plane). Ring of 4: four sensors round the cone every step, and Steer turns in the plane of the strongest pair (5 reads: steadier, a little slower).', options: [
      { value: 'plane', label: 'Turning plane (3 reads)' }, { value: 'ring', label: 'Ring of 4 (5 reads)' },
    ], showWhen: { param: 'agentSpace', value: '3d' } },
    angle: { label: 'Angle', type: 'float', min: 5, max: 90, step: 0.5, hint: 'Degrees between the centre sensor and each side one. Wider makes rounder, blobbier networks; narrow makes long straight veins.' },
    distance: { label: 'Distance', type: 'float', min: 0.002, max: 0.2, step: 0.001, hint: 'How far ahead the sensors are (picture units: the picture is 2 tall). Longer makes coarser networks.' },
    weight: { label: 'Weight', type: 'float', min: -4, max: 4, step: 0.01, hint: 'Multiplies the readings. Negative avoids what it senses.' },
    width: { label: 'Sensor', type: 'select', hint: 'One tap per sensor, or five in a small cross (smoother, five times the reads).', options: [
      { value: '1', label: '1 tap' }, { value: '5', label: '5-tap cross' },
    ] },
  },
  assignable: false,
  glslFunctions: [AG_UV_GLSL, AG_DIR_GLSL],
  glslFunctionsFor: (node: GraphNode) => (isAgent3d(node) && node.params.__vol === true ? [AG_VOL_GLSL] : []),
  // A volume Trail's layout (3D, the compiler marks a Sense whose Trail image is one).
  declarationsFor: (node: GraphNode) => (isAgent3d(node) && typeof node.params.__volOf === 'string' ? [`uniform vec4 ${node.params.__volOf}_vol;`] : []),
  generateGLSL: (node: GraphNode, v) => {
    if (isAgent3d(node)) return sense3d(node, v);
    const id = node.id;
    const tex = v.texture;
    const fn = fieldFn(v.field);
    const five = sel(node.params.width, ['1', '5'], '1') === '5';
    const chan = v.channels ?? 'a_ownChannels';
    const ang = v.angle ? `radians(${v.angle})` : `radians(${p(node.params.angle, 45)})`;
    const dist = v.distance ?? p(node.params.distance, 0.03);
    const at = (q: string) => {
      const parts: string[] = [];
      if (tex) {
        const one = (o: string) => `dot(texture(${tex}, agUv(${q})${o}), ${chan})`;
        parts.push(five
          ? `(${one('')} + ${one(` + vec2(${id}_px.x, 0.0)`)} + ${one(` - vec2(${id}_px.x, 0.0)`)} + ${one(` + vec2(0.0, ${id}_px.y)`)} + ${one(` - vec2(0.0, ${id}_px.y)`)}) * 0.2`
          : one(''));
      }
      if (fn) parts.push(`${fn}(${q}, vec2(0.0), 1.0, 0.0)`);
      return parts.length ? parts.join(' + ') : '0.0';
    };
    const code = [
      `    vec2 ${id}_p = ${v.position ?? 'a_pos'};\n`,
      `    float ${id}_h = ${v.heading ?? 'a_heading'};\n`,
      `    float ${id}_a = ${ang};\n`,
      `    float ${id}_d = ${dist};\n`,
      tex ? `    vec2 ${id}_px = 1.0 / vec2(textureSize(${tex}, 0));\n` : '',
      `    vec2 ${id}_qL = ${id}_p + ${id}_d * agDir(${id}_h + ${id}_a);\n`,
      `    vec2 ${id}_qC = ${id}_p + ${id}_d * agDir(${id}_h);\n`,
      `    vec2 ${id}_qR = ${id}_p + ${id}_d * agDir(${id}_h - ${id}_a);\n`,
      `    vec3 ${id}_read = vec3(${at(`${id}_qL`)}, ${at(`${id}_qC`)}, ${at(`${id}_qR`)}) * ${p(node.params.weight, 1)}${v.also ? ` + ${v.also}` : ''};\n`,
      `    float ${id}_here = (${at(`${id}_p`)}) * ${p(node.params.weight, 1)};\n`,
      // The gradient by central differences a sensor's width apart (the GPU drops it when nothing reads it).
      `    float ${id}_e = max(${id}_d * 0.25, 1e-4);\n`,
      `    vec2 ${id}_grad = vec2((${at(`(${id}_p + vec2(${id}_e, 0.0))`)}) - (${at(`(${id}_p - vec2(${id}_e, 0.0))`)}), (${at(`(${id}_p + vec2(0.0, ${id}_e))`)}) - (${at(`(${id}_p - vec2(0.0, ${id}_e))`)})) * ${p(node.params.weight, 1)} / (2.0 * ${id}_e);\n`,
    ].join('');
    return { code, outputVars: { readings: `${id}_read`, here: `${id}_here`, gradient: `${id}_grad`, sample: tex ? `texture(${tex}, agUv(${id}_p))` : 'vec4(0.0)' } };
  },
};

/**
 * Sense in 3D: the centre sensor Distance ahead along the heading, the side ones Angle off it on
 * the cone round it. Turning plane: left and right in the plane through the heading and this
 * step's random side direction (a_across), which Steer turns in. Ring of 4: also the pair across
 * that plane; the stronger pair's plane becomes a_across. A volume Trail (marked __vol) is read in
 * 3D; any other texture (a Pass) at the walker's x and y; a Field ƒ at x and y too.
 */
function sense3d(node: GraphNode, v: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const tex = v.texture;
  const vol = node.params.__vol === true && !!tex;
  const fn = fieldFn(v.field);
  const chan = v.channels ?? 'a_ownChannels';
  const ang = v.angle ? `radians(${v.angle})` : `radians(${p(node.params.angle, 45)})`;
  const dist = v.distance ?? p(node.params.distance, 0.03);
  const w = p(node.params.weight, 1);
  const raw = (q: string) => (vol ? `agVolAt(${tex}, ${tex}_vol, ${q})` : `texture(${tex}, agUv((${q}).xy))`);
  const at = (q: string) => {
    const parts: string[] = [];
    if (tex) parts.push(`dot(${raw(q)}, ${chan})`);
    if (fn) parts.push(`${fn}((${q}).xy, vec2(0.0), 1.0, 0.0)`);
    return parts.length ? parts.join(' + ') : '0.0';
  };
  const ring = sel(node.params.cone, ['plane', 'ring'], 'plane') === 'ring';
  const lines = [
    `    vec3 ${id}_p = ${v.position ?? 'a_pos'};\n`,
    `    vec3 ${id}_h = ${v.heading ?? 'a_dir'};\n`,
    `    ${id}_h = length(${id}_h) > 1e-6 ? normalize(${id}_h) : a_dir;\n`,
    // The side direction: this step's, kept square to this heading.
    `    vec3 ${id}_s = a_across - ${id}_h * dot(a_across, ${id}_h);\n`,
    `    ${id}_s = length(${id}_s) > 1e-4 ? normalize(${id}_s) : agAcross(${id}_h, 0.0);\n`,
    `    float ${id}_a = ${ang};\n`,
    `    float ${id}_d = ${dist};\n`,
    `    vec3 ${id}_qL = ${id}_p + ${id}_d * agTurn3(${id}_h, ${id}_s, ${id}_a);\n`,
    `    vec3 ${id}_qC = ${id}_p + ${id}_d * ${id}_h;\n`,
    `    vec3 ${id}_qR = ${id}_p + ${id}_d * agTurn3(${id}_h, ${id}_s, -${id}_a);\n`,
    `    vec3 ${id}_read = vec3(${at(`${id}_qL`)}, ${at(`${id}_qC`)}, ${at(`${id}_qR`)}) * ${w};\n`,
  ];
  if (ring) {
    // The pair across: if it smells more, Steer turns in its plane (a_across) and these are the readings.
    lines.push(
      `    vec3 ${id}_t = cross(${id}_h, ${id}_s);\n`,
      `    vec2 ${id}_ud = vec2(${at(`(${id}_p + ${id}_d * agTurn3(${id}_h, ${id}_t, ${id}_a))`)}, ${at(`(${id}_p + ${id}_d * agTurn3(${id}_h, ${id}_t, -${id}_a))`)}) * ${w};\n`,
      `    if (max(${id}_ud.x, ${id}_ud.y) > max(${id}_read.x, ${id}_read.z)) { ${id}_read = vec3(${id}_ud.x, ${id}_read.y, ${id}_ud.y); ${id}_s = ${id}_t; }\n`,
    );
  }
  lines.push(
    `    a_across = ${id}_s;\n`,
    v.also ? `    ${id}_read += ${v.also};\n` : '',
    `    float ${id}_e = max(${id}_d * 0.25, 1e-4);\n`,
  );
  // Here and Gradient are read only where they are wired (expressions, not statements: a volume read is the step's biggest cost).
  const e = `${id}_e`;
  const grad = `(vec3((${at(`(${id}_p + vec3(${e}, 0.0, 0.0))`)}) - (${at(`(${id}_p - vec3(${e}, 0.0, 0.0))`)}), (${at(`(${id}_p + vec3(0.0, ${e}, 0.0))`)}) - (${at(`(${id}_p - vec3(0.0, ${e}, 0.0))`)}), (${at(`(${id}_p + vec3(0.0, 0.0, ${e}))`)}) - (${at(`(${id}_p - vec3(0.0, 0.0, ${e}))`)})) * ${w} / (2.0 * ${e}))`;
  return { code: lines.join(''), outputVars: { readings: `${id}_read`, here: `((${at(`${id}_p`)}) * ${w})`, gradient: grad, sample: tex ? raw(`${id}_p`) : 'vec4(0.0)' } };
}

export const AgentSteerNode: NodeDefinition = {
  type: 'agentSteer',
  label: 'Steer',
  category: 'Simulation',
  aliases: ['Turn', 'Jones rule', 'Physarum steer'],
  description: 'Turns the walker by what its sensors read. Jones (the slime-mold paper\'s rule): straight on if the centre is strongest, a random side if both sides beat the centre, otherwise toward the stronger side by Turn. Smooth turns in proportion to right minus left; Away runs from the strongest.',
  inputs: {
    readings: { type: 'vec3', label: 'Readings', hint: 'Sense\'s Readings (left, centre, right).' },
    heading: { type: 'float', label: 'Heading', hint: THIS_AGENT },
    random: { type: 'float', label: 'Random', hint: 'A 0–1 number for the random choices. ' + THIS_AGENT },
    turn: { type: 'float', label: 'Turn', hint: 'Degrees turned in one step.' },
    jitter: { type: 'float', label: 'Jitter', hint: 'Random wobble, as a share of Turn.' },
  },
  outputs: {
    heading: { type: 'float', label: 'Heading', hint: 'The new heading (radians): wire into Move.' },
    direction: { type: 'vec2', label: 'Direction', hint: 'The new heading as a unit vector.' },
  },
  defaultParams: { mode: 'jones', turn: 45, jitter: 0.1 },
  paramDefs: {
    mode: { label: 'Rule', type: 'select', hint: 'How readings become a turn.', options: [
      { value: 'jones', label: 'Jones (slime mold)' }, { value: 'smooth', label: 'Smooth' }, { value: 'away', label: 'Away' },
    ] },
    turn: { label: 'Turn', type: 'float', min: 0, max: 180, step: 0.5, hint: 'Degrees turned in one step. Small makes long smooth veins; large makes tight, busy networks.' },
    jitter: { label: 'Jitter', type: 'float', min: 0, max: 1, step: 0.01, hint: 'A random wobble every step, as a share of Turn. A little keeps the network alive and pulsing.' },
  },
  assignable: false,
  glslFunctions: [AG_DIR_GLSL],
  generateGLSL: (node: GraphNode, v) => {
    if (isAgent3d(node)) return steer3d(node, v);
    const id = node.id;
    const mode = sel(node.params.mode, ['jones', 'smooth', 'away'], 'jones');
    const r = v.readings ?? 'vec3(0.0)';
    const turn = v.turn ? `radians(${v.turn})` : `radians(${p(node.params.turn, 45)})`;
    const jitter = v.jitter ?? p(node.params.jitter, 0.1);
    const rnd = v.random ?? 'a_random';
    const lines = [
      `    vec3 ${id}_r = ${mode === 'away' ? `-(${r})` : r};\n`,
      `    float ${id}_t = ${turn};\n`,
      `    float ${id}_u = ${rnd};\n`,
      // A second, independent number from the low bits of the first (24 bits; 16 of them are fresh).
      `    float ${id}_u2 = fract(${id}_u * 256.0);\n`,
      `    float ${id}_h = ${v.heading ?? 'a_heading'};\n`,
    ];
    if (mode === 'smooth') {
      lines.push(`    ${id}_h += ${id}_t * clamp((${id}_r.x - ${id}_r.z) / (abs(${id}_r.x) + abs(${id}_r.z) + 1e-6), -1.0, 1.0);\n`);
    } else {
      // Jones 2010: centre strongest → straight; both sides beat the centre → a random side; else toward the stronger side.
      lines.push(
        `    if (${id}_r.y > ${id}_r.x && ${id}_r.y > ${id}_r.z) {}\n`,
        `    else if (${id}_r.y < ${id}_r.x && ${id}_r.y < ${id}_r.z) ${id}_h += (${id}_u < 0.5 ? -${id}_t : ${id}_t);\n`,
        `    else if (${id}_r.x > ${id}_r.z) ${id}_h += ${id}_t;\n`,
        `    else if (${id}_r.z > ${id}_r.x) ${id}_h -= ${id}_t;\n`,
      );
    }
    lines.push(`    ${id}_h += (${id}_u2 * 2.0 - 1.0) * ${jitter} * ${id}_t;\n`);
    return { code: lines.join(''), outputVars: { heading: `${id}_h`, direction: `agDir(${id}_h)` } };
  },
};

/**
 * Steer in 3D: the same rules as in 2D, turning the heading (a direction) toward this step's side
 * direction (a_across, the plane Sense read in: + toward its left sensor, − toward its right).
 */
function steer3d(node: GraphNode, v: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const mode = sel(node.params.mode, ['jones', 'smooth', 'away'], 'jones');
  const r = v.readings ?? 'vec3(0.0)';
  const lines = [
    `    vec3 ${id}_r = ${mode === 'away' ? `-(${r})` : r};\n`,
    `    float ${id}_t = ${v.turn ? `radians(${v.turn})` : `radians(${p(node.params.turn, 45)})`};\n`,
    `    float ${id}_u = ${v.random ?? 'a_random'};\n`,
    `    float ${id}_u2 = fract(${id}_u * 256.0);\n`,
    `    vec3 ${id}_h0 = ${v.heading ?? 'a_dir'};\n`,
    `    ${id}_h0 = length(${id}_h0) > 1e-6 ? normalize(${id}_h0) : a_dir;\n`,
    `    float ${id}_g = 0.0;\n`,
  ];
  if (mode === 'smooth') {
    lines.push(`    ${id}_g = ${id}_t * clamp((${id}_r.x - ${id}_r.z) / (abs(${id}_r.x) + abs(${id}_r.z) + 1e-6), -1.0, 1.0);\n`);
  } else {
    lines.push(
      `    if (${id}_r.y > ${id}_r.x && ${id}_r.y > ${id}_r.z) {}\n`,
      `    else if (${id}_r.y < ${id}_r.x && ${id}_r.y < ${id}_r.z) ${id}_g = ${id}_u < 0.5 ? -${id}_t : ${id}_t;\n`,
      `    else if (${id}_r.x > ${id}_r.z) ${id}_g = ${id}_t;\n`,
      `    else if (${id}_r.z > ${id}_r.x) ${id}_g = -${id}_t;\n`,
    );
  }
  lines.push(
    `    ${id}_g += (${id}_u2 * 2.0 - 1.0) * ${v.jitter ?? p(node.params.jitter, 0.1)} * ${id}_t;\n`,
    `    vec3 ${id}_s = a_across - ${id}_h0 * dot(a_across, ${id}_h0);\n`,
    `    ${id}_s = length(${id}_s) > 1e-4 ? normalize(${id}_s) : agAcross(${id}_h0, 0.0);\n`,
    `    vec3 ${id}_h = agTurn3(${id}_h0, ${id}_s, ${id}_g);\n`,
  );
  return { code: lines.join(''), outputVars: { heading: `${id}_h`, direction: `${id}_h` } };
}

/**
 * Move in 3D: Speed along the heading (or Direction), plus Drift, kept in the box at the edges
 * (x ±aspect, y ±1, z ±1). Obstacle ƒ is a shape in the picture's plane, the same through the depth.
 */
function move3d(node: GraphNode, v: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const edges = sel(node.params.edges, ['wrap', 'bounce', 'slide'], 'wrap');
  const obstacle = fieldFn(v.obstacle);
  const lines = [
    `    vec3 ${id}_h = ${v.direction ?? v.heading ?? 'a_dir'};\n`,
    `    ${id}_h = length(${id}_h) > 1e-6 ? normalize(${id}_h) : a_dir;\n`,
    `    vec3 ${id}_v = ${id}_h * ${v.speed ?? p(node.params.speed, 0.25)}${v.also ? ` + ${v.also}` : ''};\n`,
    `    vec3 ${id}_p = ${v.position ?? 'a_pos'} + ${id}_v * a_dt;\n`,
    `    vec3 ${id}_b = ${AG_BOX3};\n`,
    `    float ${id}_hit = any(greaterThan(abs(${id}_p), ${id}_b)) ? 1.0 : 0.0;\n`,
  ];
  if (edges === 'wrap') lines.push(`    ${id}_p = mod(${id}_p + ${id}_b, 2.0 * ${id}_b) - ${id}_b;\n`);
  else if (edges === 'bounce') {
    for (const c of ['x', 'y', 'z']) lines.push(`    if (abs(${id}_p.${c}) > ${id}_b.${c}) { ${id}_p.${c} = sign(${id}_p.${c}) * (2.0 * ${id}_b.${c} - abs(${id}_p.${c})); ${id}_v.${c} = -${id}_v.${c}; }\n`);
    lines.push(`    if (${id}_hit > 0.5 && length(${id}_v) > 1e-6) ${id}_h = normalize(${id}_v);\n`);
  } else {
    for (const c of ['x', 'y', 'z']) lines.push(`    if (abs(${id}_p.${c}) > ${id}_b.${c}) ${id}_v.${c} = 0.0;\n`);
    lines.push(`    ${id}_p = clamp(${id}_p, -${id}_b, ${id}_b);\n`);
  }
  if (obstacle) {
    const at = (q: string) => `${obstacle}((${q}).xy, vec2(0.0), 1.0, 0.0)`;
    const from = v.position ?? 'a_pos';
    lines.push(`    float ${id}_ob = ${at(`${id}_p`)};\n`);
    if (sel(node.params.onObstacle, ['turn', 'slide'], 'turn') === 'turn') {
      lines.push(`    if (${id}_ob < 0.0) { ${id}_p = ${from}; ${id}_h = normalize(-${id}_h + a_across * ((fract(a_random * 4096.0) - 0.5) * 1.5)); ${id}_v = -${id}_v; ${id}_hit = 1.0; }\n`);
    } else {
      lines.push(
        `    if (${id}_ob < 0.0) {\n`,
        `        float ${id}_e = 1e-3;\n`,
        `        vec3 ${id}_n = vec3(${at(`${id}_p + vec3(${id}_e, 0.0, 0.0)`)} - ${at(`${id}_p - vec3(${id}_e, 0.0, 0.0)`)}, ${at(`${id}_p + vec3(0.0, ${id}_e, 0.0)`)} - ${at(`${id}_p - vec3(0.0, ${id}_e, 0.0)`)}, 0.0);\n`,
        `        ${id}_n = length(${id}_n) > 1e-9 ? normalize(${id}_n) : -${id}_h;\n`,
        `        ${id}_p -= ${id}_n * ${id}_ob;\n`,
        `        ${id}_v -= ${id}_n * min(dot(${id}_v, ${id}_n), 0.0);\n`,
        `        if (length(${id}_v) > 1e-6) ${id}_h = normalize(${id}_v);\n`,
        `        ${id}_hit = 1.0;\n`,
        `    }\n`,
      );
    }
  }
  return { code: lines.join(''), outputVars: { position: `${id}_p`, velocity: `${id}_v`, heading: `${id}_h`, hit: `${id}_hit` } };
}

export const AgentMoveNode: NodeDefinition = {
  type: 'agentMove',
  label: 'Move',
  category: 'Simulation',
  aliases: ['Step', 'Walk', 'Advance'],
  description: 'Moves the walker Speed × one step along its heading (or Direction), and keeps it on the picture: Wrap brings it in on the other side, Bounce reflects it, Slide stops it at the edge.',
  inputs: {
    heading: { type: 'float', label: 'Heading', hint: 'Which way to go: Steer\'s Heading. ' + THIS_AGENT },
    direction: { type: 'vec2', label: 'Direction', hint: 'Which way to go as a vector (wins over Heading when wired; it needn\'t be unit length).' },
    speed: { type: 'float', label: 'Speed', hint: 'Picture units a second (the picture is 2 tall; one step is 1/60 s).' },
    position: { type: 'vec2', label: 'Position', hint: THIS_AGENT },
    also: { type: 'vec2', label: '+ Drift', hint: 'A velocity added to the walk (a drift, a wind), in picture units a second.' },
    obstacle: { type: 'float', label: 'Obstacle ƒ', field: true, hint: 'A shape\'s distance (any SDF chain): walkers can\'t step where it is below 0. On Obstacle says what they do instead.' },
  },
  outputs: {
    position: { type: 'vec2', label: 'Position', hint: 'Where it ends up: wire into Agent Output.' },
    velocity: { type: 'vec2', label: 'Velocity' },
    heading: { type: 'float', label: 'Heading', hint: 'Its heading after the move (Bounce turns it round).' },
    hit: { type: 'float', label: 'Hit', hint: '1 when it touched an edge or an obstacle this step.' },
  },
  defaultParams: { speed: 0.25, edges: 'wrap', onObstacle: 'turn' },
  paramDefs: {
    speed: { label: 'Speed', type: 'float', min: 0, max: 2, step: 0.005, hint: 'Picture units a second (the picture is 2 tall).' },
    edges: { label: 'Edges', type: 'select', hint: 'What happens at the edge of the picture.', options: [
      { value: 'wrap', label: 'Wrap' }, { value: 'bounce', label: 'Bounce' }, { value: 'slide', label: 'Slide' },
    ] },
    onObstacle: { label: 'On obstacle', type: 'select', hint: 'With Obstacle ƒ wired: Turn back stays put and turns round (slime, ants); Slide moves along the shape\'s edge.', options: [
      { value: 'turn', label: 'Turn back' }, { value: 'slide', label: 'Slide along it' },
    ] },
  },
  assignable: false,
  glslFunctions: [AG_DIR_GLSL],
  generateGLSL: (node: GraphNode, v) => {
    if (isAgent3d(node)) return move3d(node, v);
    const id = node.id;
    const edges = sel(node.params.edges, ['wrap', 'bounce', 'slide'], 'wrap');
    const obstacle = fieldFn(v.obstacle);
    const speed = v.speed ?? p(node.params.speed, 0.25);
    const h = v.heading ?? 'a_heading';
    const lines = [
      `    float ${id}_h = ${h};\n`,
      v.direction
        ? `    vec2 ${id}_dir = length(${v.direction}) > 1e-6 ? normalize(${v.direction}) : agDir(${id}_h);\n    ${id}_h = atan(${id}_dir.y, ${id}_dir.x);\n`
        : `    vec2 ${id}_dir = agDir(${id}_h);\n`,
      `    vec2 ${id}_v = ${id}_dir * ${speed}${v.also ? ` + ${v.also}` : ''};\n`,
      `    vec2 ${id}_p = ${v.position ?? 'a_pos'} + ${id}_v * a_dt;\n`,
      `    vec2 ${id}_b = vec2(u_resolution.x / u_resolution.y, 1.0);\n`,
      `    float ${id}_hit = any(greaterThan(abs(${id}_p), ${id}_b)) ? 1.0 : 0.0;\n`,
    ];
    if (edges === 'wrap') {
      lines.push(`    ${id}_p = mod(${id}_p + ${id}_b, 2.0 * ${id}_b) - ${id}_b;\n`);
    } else if (edges === 'bounce') {
      lines.push(
        `    if (abs(${id}_p.x) > ${id}_b.x) { ${id}_p.x = sign(${id}_p.x) * (2.0 * ${id}_b.x - abs(${id}_p.x)); ${id}_v.x = -${id}_v.x; }\n`,
        `    if (abs(${id}_p.y) > ${id}_b.y) { ${id}_p.y = sign(${id}_p.y) * (2.0 * ${id}_b.y - abs(${id}_p.y)); ${id}_v.y = -${id}_v.y; }\n`,
        `    if (${id}_hit > 0.5 && length(${id}_v) > 1e-6) ${id}_h = atan(${id}_v.y, ${id}_v.x);\n`,
      );
    } else {
      lines.push(
        `    if (abs(${id}_p.x) > ${id}_b.x) ${id}_v.x = 0.0;\n`,
        `    if (abs(${id}_p.y) > ${id}_b.y) ${id}_v.y = 0.0;\n`,
        `    ${id}_p = clamp(${id}_p, -${id}_b, ${id}_b);\n`,
      );
    }
    if (obstacle) {
      // Inside the shape (its distance below 0) after the step: turn back where it stood, or slide out along the edge.
      const at = (q: string) => `${obstacle}(${q}, vec2(0.0), 1.0, 0.0)`;
      const from = v.position ?? 'a_pos';
      lines.push(`    float ${id}_ob = ${at(`${id}_p`)};\n`);
      if (sel(node.params.onObstacle, ['turn', 'slide'], 'turn') === 'turn') {
        lines.push(
          `    if (${id}_ob < 0.0) { ${id}_p = ${from}; ${id}_h += 3.1415927 + (fract(a_random * 4096.0) - 0.5) * 1.5; ${id}_v = -${id}_v; ${id}_hit = 1.0; }\n`,
        );
      } else {
        lines.push(
          `    if (${id}_ob < 0.0) {\n`,
          `        float ${id}_e = 1e-3;\n`,
          `        vec2 ${id}_n = vec2(${at(`${id}_p + vec2(${id}_e, 0.0)`)} - ${at(`${id}_p - vec2(${id}_e, 0.0)`)}, ${at(`${id}_p + vec2(0.0, ${id}_e)`)} - ${at(`${id}_p - vec2(0.0, ${id}_e)`)});\n`,
          `        ${id}_n = length(${id}_n) > 1e-9 ? normalize(${id}_n) : -agDir(${id}_h);\n`,
          `        ${id}_p -= ${id}_n * ${id}_ob;\n`,
          `        ${id}_v -= ${id}_n * min(dot(${id}_v, ${id}_n), 0.0);\n`,
          `        if (length(${id}_v) > 1e-6) ${id}_h = atan(${id}_v.y, ${id}_v.x);\n`,
          `        ${id}_hit = 1.0;\n`,
          `    }\n`,
        );
      }
    }
    return { code: lines.join(''), outputVars: { position: `${id}_p`, velocity: `${id}_v`, heading: `${id}_h`, hit: `${id}_hit` } };
  },
};

export const AgentBySpeciesNode: NodeDefinition = {
  type: 'agentBySpecies',
  label: 'By species',
  category: 'Simulation',
  aliases: ['Per species', 'Species select'],
  description: 'Picks one of four numbers by this walker\'s species: a different Turn, Speed or Angle for each kind, from one rule.',
  inputs: {
    a: { type: 'float', label: 'Species 1' },
    b: { type: 'float', label: 'Species 2' },
    c: { type: 'float', label: 'Species 3' },
    d: { type: 'float', label: 'Species 4' },
  },
  outputs: { value: { type: 'float', label: 'Value', hint: 'The number for this walker\'s species.' } },
  defaultParams: { a: 1, b: 1, c: 1, d: 1 },
  paramDefs: {
    a: { label: 'Species 1', type: 'float', min: -10, max: 10, step: 0.01 },
    b: { label: 'Species 2', type: 'float', min: -10, max: 10, step: 0.01 },
    c: { label: 'Species 3', type: 'float', min: -10, max: 10, step: 0.01 },
    d: { label: 'Species 4', type: 'float', min: -10, max: 10, step: 0.01 },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const val = (k: string, fb: number) => v[k] ?? p(node.params[k], fb);
    return {
      code: `    float ${id}_v = a_species < 0.5 ? ${val('a', 1)} : a_species < 1.5 ? ${val('b', 1)} : a_species < 2.5 ? ${val('c', 1)} : ${val('d', 1)};\n`,
      outputVars: { value: `${id}_v` },
    };
  },
};

// ── Outside the group ────────────────────────────────────────────────────────

export const AgentEmitNode: NodeDefinition = {
  type: 'agentEmit',
  label: 'Emit',
  category: 'Simulation',
  aliases: ['Spawn', 'Emitter', 'Birth', 'Agent emitter'],
  description: 'Where walkers are born and how they start. Fill gives everyone a place at once (slime); Rate gives birth to a stream of them a second, each living for Life; Keep full gives each walker a new life the moment it dies (particles). Speed, Spread and Life ± vary them; Burst gives everyone a new life at once. Chain Emits through Also for several sources.',
  inputs: {
    position: { type: 'vec2', label: 'Position', hint: 'The centre of the shape (picture units). Unwired: X and Y on the card.' },
    where: { type: 'float', label: 'Where ƒ', field: true, hint: 'Shape Field: any chain of nodes as a function of position (noise, a shape, a picture\'s brightness); walkers are born where it is above Threshold.' },
    picture: { type: 'texture', label: 'Picture', hint: 'Shape Picture: a texture (a Trail, a Pass); walkers are born where it is bright (more where brighter).' },
    also: { type: 'emitter', label: '+ Another Emit', hint: 'Chain: wire another Emit here and births are shared between them by their Share (one Emit per place, or per species).' },
  },
  outputs: {
    emitter: { type: 'emitter', label: 'Emitter', hint: 'Wire into an Agents group\'s Emit.' },
  },
  defaultParams: { mode: 'fill', shape: 'disc', heading: 'inward', at: 'point', x: 0, y: 0, handX: 0.5, handY: 0.5, size: 0.6, rate: 20000, life: 0, lifeVar: 0.2, speed: 0, speedVar: 0, spread: 0, share: 1, burst: 0, species: 'each', threshold: 0.2, miss: 'best' },
  paramDefs: {
    mode: { label: 'Births', type: 'select', hint: 'Fill: everyone is born at once when the simulation starts (slime). Rate: a stream of births a second. Keep full: born at once, each reborn the moment it dies (particles with a Life).', options: [
      { value: 'fill', label: 'Fill (all at once)' }, { value: 'rate', label: 'Rate (per second)' }, { value: 'respawn', label: 'Keep full (reborn when they die)' },
    ] },
    shape: { label: 'Shape', type: 'select', hint: 'Where in the picture they are born.', options: [
      { value: 'point', label: 'Point' }, { value: 'line', label: 'Line (across, Size each way)' }, { value: 'ring', label: 'Ring' }, { value: 'disc', label: 'Disc' }, { value: 'box', label: 'Box' }, { value: 'screen', label: 'Whole picture' },
      { value: 'picture', label: 'Picture (where bright)' }, { value: 'field', label: 'Field (Where ƒ above Threshold)' },
      { value: 'sphere', label: 'Sphere (3D; a ring in 2D)' }, { value: 'ball', label: 'Ball (3D; a disc in 2D)' },
    ] },
    threshold: { label: 'Threshold', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Picture / Field: how bright (how high) a place must be for walkers to be born there.', showWhen: { param: 'shape', value: ['picture', 'field'] } },
    miss: { label: 'No place found', type: 'select', hint: 'Picture / Field: when none of the 8 tries lands where it is bright enough (a sparse picture): born at the best try anyway, or not born this time (it tries again on a later birth; Keep full: the next step).', options: [
      { value: 'best', label: 'Born at the best try' }, { value: 'skip', label: 'Not born this time' },
    ], showWhen: { param: 'shape', value: ['picture', 'field'] } },
    species: { label: 'Species', type: 'select', hint: 'Which species these walkers are (with the group\'s Species above 1). Each in turn shares them out evenly; chain one Emit per species to give each its own place.', options: [
      { value: 'each', label: 'Each in turn' }, { value: '1', label: 'Species 1' }, { value: '2', label: 'Species 2' }, { value: '3', label: 'Species 3' }, { value: '4', label: 'Species 4' },
    ] },
    heading: { label: 'Facing', type: 'select', hint: 'Which way they face when born.', options: [
      { value: 'random', label: 'Random' }, { value: 'inward', label: 'Inward' }, { value: 'outward', label: 'Outward' }, { value: 'up', label: 'Up' },
    ] },
    at: { label: 'At', type: 'select', hint: 'Where the shape\'s centre comes from when nothing is wired into Position.', help: 'X and Y: picture units. A hand or null: Hand X / Y, 0–1 across and up the picture, made for Play (right-click Hand X → Follow a hand).', options: [{ value: 'point', label: 'X and Y' }, { value: 'hand', label: 'A hand or null (Hand X / Y)' }] },
    x: { label: 'X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Centre of the shape, across.', showWhen: { param: 'at', value: 'point' } },
    y: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Centre of the shape, up.', showWhen: { param: 'at', value: 'point' } },
    ...agHandParams('at', 'hand', 'The centre of the shape'),
    z: { label: 'Z', type: 'float', min: -1, max: 1, step: 0.01, hint: '3D: the centre\'s depth (toward you is +).', showWhen: { param: 'agentSpace', value: '3d' } },
    size: { label: 'Size', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Radius of the ring or disc, half-width of the box (picture units).' },
    rate: { label: 'Rate', type: 'float', min: 0, max: 1000000, step: 100, hint: 'Births a second (Rate mode).' },
    life: { label: 'Life', type: 'float', min: 0, max: 60, step: 0.1, hint: 'Seconds each lives. 0: forever.' },
    lifeVar: { label: 'Life ±', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much Life varies, as a share of it.' },
    speed: { label: 'Speed', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Starting speed along its facing (Move sets its own).' },
    speedVar: { label: 'Speed ±', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much the starting speed varies, as a share of it (0.45: the Particles node\'s).' },
    spread: { label: 'Spread', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How far each one\'s direction strays from its facing toward a random one (1: any direction).' },
    burst: { label: 'Burst', type: 'float', min: 0, max: 1, step: 0.01, hint: 'A trigger: each time it rises past 0.5 everyone is born again at once.', help: 'A trigger. Each time it rises past 0.5 every walker is born again at once, from this Emit. In Play, route a trigger source (a key, a beat, a pad) to it.' },
    share: { label: 'Share', type: 'float', min: 0, max: 10, step: 0.01, hint: 'With Also chained: this Emit\'s share of the births.' },
  },
  assignable: false,
  glslFunctions: [AG_DIR_GLSL],
  glslFunctionsFor: (node: GraphNode) => (node.params.shape === 'picture' ? [AG_UV_GLSL] : []),
  // Compiled only into a group's update shader: its code runs for the walkers born this step.
  generateGLSL: (node: GraphNode, v) => {
    if (isAgent3d(node)) return emit3d(node, v);
    const id = node.id;
    // Sphere and Ball are 3D shapes: on the picture, a ring and a disc.
    const shape0 = node.params.shape === 'sphere' ? 'ring' : node.params.shape === 'ball' ? 'disc' : node.params.shape;
    const shape = sel(shape0, ['point', 'line', 'ring', 'disc', 'box', 'screen', 'picture', 'field'], 'disc');
    const facing = sel(node.params.heading, ['random', 'inward', 'outward', 'up'], 'inward');
    const em = `${id}_em`;
    const centre = v.position ?? (sel(node.params.at, ['point', 'hand'], 'point') === 'hand'
      ? agHandPlace(p(node.params.handX, 0.5), p(node.params.handY, 0.5))
      : `vec2(${p(node.params.x, 0)}, ${p(node.params.y, 0)})`);
    const size = p(node.params.size, 0.6);
    const place: Record<string, string> = {
      point: `${id}_pp = ${id}_c; ${id}_out = agDir(${id}_r1 * 6.2831853);`,
      // A line across, Size each way from the centre; outward is up (the Particles node's Line).
      line: `${id}_pp = ${id}_c + vec2((${id}_r1 * 2.0 - 1.0) * ${size}, 0.0); ${id}_out = vec2(0.0, 1.0);`,
      ring: `${id}_out = agDir(${id}_r1 * 6.2831853); ${id}_pp = ${id}_c + ${size} * ${id}_out;`,
      disc: `${id}_out = agDir(${id}_r1 * 6.2831853); ${id}_pp = ${id}_c + ${size} * sqrt(${id}_r2) * ${id}_out;`,
      box: `${id}_pp = ${id}_c + (vec2(${id}_r1, ${id}_r2) * 2.0 - 1.0) * ${size}; ${id}_out = length(${id}_pp - ${id}_c) > 1e-6 ? normalize(${id}_pp - ${id}_c) : vec2(1.0, 0.0);`,
      screen: `${id}_pp = (vec2(${id}_r1, ${id}_r2) * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0); ${id}_out = length(${id}_pp) > 1e-6 ? normalize(${id}_pp) : vec2(1.0, 0.0);`,
    };
    // Picture / Field: rejection sampling over the whole picture, 8 hashed tries (the best one if none is taken).
    const tex = v.picture;
    const where = fieldFn(v.where);
    const weight = shape === 'picture' && tex
      ? `dot(texture(${tex}, agUv(${id}_q)).rgb, vec3(0.299, 0.587, 0.114))`
      : shape === 'field' && where ? `${where}(${id}_q, vec2(0.0), 1.0, 0.0)` : '';
    // If none of the tries is taken: the best one (the default), or not born this time (it tries again later).
    const skip = (shape === 'picture' || shape === 'field') && node.params.miss === 'skip';
    if (weight) {
      const thr = p(node.params.threshold, 0.2);
      const accept = shape === 'picture' ? `${id}_w > ${thr} ? clamp(${id}_w, 0.0, 1.0) : 0.0` : `${id}_w > ${thr} ? 1.0 : 0.0`;
      place[shape] = [
        `float ${id}_best = -1.0e30; vec2 ${id}_bq = vec2(0.0);${skip ? ` ${id}_miss = true;` : ''}`,
        `        for (int ${id}_k = 0; ${id}_k < 8; ${id}_k++) {`,
        `            vec2 ${id}_q = (vec2(agRnd(${id}_s), agRnd(${id}_s)) * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0);`,
        `            float ${id}_w = ${weight};`,
        `            float ${id}_p = ${accept};`,
        `            if (${id}_p > ${id}_best) { ${id}_best = ${id}_p; ${id}_bq = ${id}_q; }`,
        `            if (agRnd(${id}_s) < ${id}_p) { ${id}_bq = ${id}_q;${skip ? ` ${id}_miss = false;` : ''} break; }`,
        `        }`,
        `        ${id}_pp = ${id}_bq; ${id}_out = agDir(${id}_r1 * 6.2831853);`,
      ].join('\n');
    } else if (shape === 'picture' || shape === 'field') {
      place[shape] = place.screen;
    }
    const speciesSel = sel(node.params.species, ['each', '1', '2', '3', '4'], 'each');
    const species = speciesSel === 'each' ? '-1.0' : `${Number(speciesSel) - 1}.0`;
    const stateC = node.params.__stateC === true;
    const head = facing === 'up' ? '1.5707963' : facing === 'random' ? `${id}_r3 * 6.2831853 - 3.1415927` : facing === 'inward' ? `atan(-${id}_out.y, -${id}_out.x)` : `atan(${id}_out.y, ${id}_out.x)`;
    const life = p(node.params.life, 0);
    const spread = p(node.params.spread, 0);
    const respawn = sel(node.params.mode, ['fill', 'rate', 'respawn'], 'fill') === 'respawn';
    const lines = [
      `    vec4 ${em}_a = vec4(0.0);\n`,
      `    vec4 ${em}_b = vec4(0.0);\n`,
      `    float ${em}_w = max(${p(node.params.share, 1)}, 0.0);\n`,
      // Its species (−1: by index, each in turn), only in groups with per-walker state (the compiler marks the Emit).
      stateC ? `    float ${em}_sp = ${species};\n` : '',
      `    if (a_born) {\n`,
      `        uint ${id}_s = a_seed ^ 0x${(hashId(id) >>> 0).toString(16).padStart(8, '0')}u;\n`,
      `        float ${id}_r1 = agRnd(${id}_s), ${id}_r2 = agRnd(${id}_s), ${id}_r3 = agRnd(${id}_s), ${id}_r4 = agRnd(${id}_s);\n`,
      `        vec2 ${id}_c = ${centre};\n`,
      `        vec2 ${id}_pp = ${id}_c;\n`,
      `        vec2 ${id}_out = vec2(1.0, 0.0);\n`,
      skip ? `        bool ${id}_miss = false;\n` : '',
      `        ${place[shape]}\n`,
      `        float ${id}_hd = ${head};\n`,
      // Spread: the direction strays toward a random one. Speed ±: the speed varies.
      `        float ${id}_r5 = agRnd(${id}_s), ${id}_r6 = agRnd(${id}_s), ${id}_r7 = agRnd(${id}_s);\n`,
      `        vec2 ${id}_dir = agDir(${id}_hd);\n`,
      `        if (${spread} > 0.0) { ${id}_dir = normalize(mix(${id}_dir, agDir(${id}_r5 * 6.2831853), ${spread}) + vec2(0.0, 1e-4)); ${id}_hd = atan(${id}_dir.y, ${id}_dir.x); }\n`,
      `        float ${id}_sp = ${p(node.params.speed, 0)} * (1.0 + ${p(node.params.speedVar, 0)} * (${id}_r6 * 2.0 - 1.0));\n`,
      `        float ${id}_life = ${life} > 0.0 ? ${life} * (1.0 + ${p(node.params.lifeVar, 0.2)} * (${id}_r4 * 2.0 - 1.0)) : 1.0e30;\n`,
      // Keep full: the first births come at every age, so they don't all die (and come back) together.
      `        float ${id}_age0 = ${respawn ? `a_step == 0u && ${id}_life < 1.0e29 ? ${id}_r7 * ${id}_life : 0.0` : '0.0'};\n`,
      `        ${em}_a = vec4(${id}_pp, ${id}_hd, ${id}_age0);\n`,
      `        ${em}_b = vec4(${id}_dir * ${id}_sp, ${id}_sp, max(${id}_life, 1e-3));\n`,
      // Not born this time: dead (life 0), so it tries again on a later birth (Keep full: the next step).
      skip ? `        if (${id}_miss) ${em}_b = vec4(0.0);\n` : '',
    ];
    if (v.also) {
      // Shared births: this Emit keeps its Share of them, the chain behind it the rest.
      lines.push(
        `        if (agRnd(${id}_s) * (${em}_w + ${v.also}_w) >= ${em}_w) { ${em}_a = ${v.also}_a; ${em}_b = ${v.also}_b;${stateC ? ` ${em}_sp = ${v.also}_sp;` : ''} }\n`,
      );
    }
    lines.push(`    }\n`);
    if (v.also) lines.push(`    ${em}_w += ${v.also}_w;\n`);
    return { code: lines.join(''), outputVars: { emitter: em } };
  },
};

/**
 * Emit in 3D: born in the box. Point, Line (across), Ring and Disc (in the picture's plane, at Z),
 * Box (a cube Size each way), Sphere (its shell) and Ball, Whole picture (the whole box), Picture
 * and Field (where bright across and up, at any depth). Facing in 3D; the velocity carries it (a
 * walker born still keeps its facing as a velocity too small to move it).
 */
function emit3d(node: GraphNode, v: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const shape = sel(node.params.shape, ['point', 'line', 'ring', 'disc', 'box', 'screen', 'picture', 'field', 'sphere', 'ball'], 'disc');
  const facing = sel(node.params.heading, ['random', 'inward', 'outward', 'up'], 'inward');
  const em = `${id}_em`;
  const z = p(node.params.z, 0);
  const centre = v.position ?? (sel(node.params.at, ['point', 'hand'], 'point') === 'hand'
    ? `vec3(${agHandPlace(p(node.params.handX, 0.5), p(node.params.handY, 0.5))}, ${z})`
    : `vec3(${p(node.params.x, 0)}, ${p(node.params.y, 0)}, ${z})`);
  const size = p(node.params.size, 0.6);
  const B = AG_BOX3;
  const place: Record<string, string> = {
    point: `${id}_pp = ${id}_c; ${id}_out = agUnit3(${id}_s);`,
    line: `${id}_pp = ${id}_c + vec3((${id}_r1 * 2.0 - 1.0) * ${size}, 0.0, 0.0); ${id}_out = vec3(0.0, 1.0, 0.0);`,
    ring: `${id}_out = vec3(agDir(${id}_r1 * 6.2831853), 0.0); ${id}_pp = ${id}_c + ${size} * ${id}_out;`,
    disc: `${id}_out = vec3(agDir(${id}_r1 * 6.2831853), 0.0); ${id}_pp = ${id}_c + ${size} * sqrt(${id}_r2) * ${id}_out;`,
    box: `${id}_pp = ${id}_c + (vec3(${id}_r1, ${id}_r2, agRnd(${id}_s)) * 2.0 - 1.0) * ${size}; ${id}_out = length(${id}_pp - ${id}_c) > 1e-6 ? normalize(${id}_pp - ${id}_c) : vec3(1.0, 0.0, 0.0);`,
    sphere: `${id}_out = agUnit3(${id}_s); ${id}_pp = ${id}_c + ${size} * ${id}_out;`,
    ball: `${id}_out = agUnit3(${id}_s); ${id}_pp = ${id}_c + ${size} * pow(${id}_r2, 1.0 / 3.0) * ${id}_out;`,
    screen: `${id}_pp = (vec3(${id}_r1, ${id}_r2, agRnd(${id}_s)) * 2.0 - 1.0) * ${B}; ${id}_out = length(${id}_pp) > 1e-6 ? normalize(${id}_pp) : vec3(1.0, 0.0, 0.0);`,
  };
  const tex = v.picture;
  const where = fieldFn(v.where);
  const weight = shape === 'picture' && tex
    ? `dot(texture(${tex}, agUv(${id}_q)).rgb, vec3(0.299, 0.587, 0.114))`
    : shape === 'field' && where ? `${where}(${id}_q, vec2(0.0), 1.0, 0.0)` : '';
  const skip = (shape === 'picture' || shape === 'field') && node.params.miss === 'skip';
  if (weight) {
    const thr = p(node.params.threshold, 0.2);
    const accept = shape === 'picture' ? `${id}_w > ${thr} ? clamp(${id}_w, 0.0, 1.0) : 0.0` : `${id}_w > ${thr} ? 1.0 : 0.0`;
    place[shape] = [
      `float ${id}_best = -1.0e30; vec2 ${id}_bq = vec2(0.0);${skip ? ` ${id}_miss = true;` : ''}`,
      `        for (int ${id}_k = 0; ${id}_k < 8; ${id}_k++) {`,
      `            vec2 ${id}_q = (vec2(agRnd(${id}_s), agRnd(${id}_s)) * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0);`,
      `            float ${id}_w = ${weight};`,
      `            float ${id}_p = ${accept};`,
      `            if (${id}_p > ${id}_best) { ${id}_best = ${id}_p; ${id}_bq = ${id}_q; }`,
      `            if (agRnd(${id}_s) < ${id}_p) { ${id}_bq = ${id}_q;${skip ? ` ${id}_miss = false;` : ''} break; }`,
      `        }`,
      // Across and up where the picture (the field) is bright; at any depth.
      `        ${id}_pp = vec3(${id}_bq, agRnd(${id}_s) * 2.0 - 1.0); ${id}_out = agUnit3(${id}_s);`,
    ].join('\n');
  } else if (shape === 'picture' || shape === 'field') place[shape] = place.screen;
  const speciesSel = sel(node.params.species, ['each', '1', '2', '3', '4'], 'each');
  const species = speciesSel === 'each' ? '-1.0' : `${Number(speciesSel) - 1}.0`;
  const stateC = node.params.__stateC === true;
  const head = facing === 'up' ? 'vec3(0.0, 1.0, 0.0)' : facing === 'random' ? `agUnit3(${id}_s)` : facing === 'inward' ? `-${id}_out` : `${id}_out`;
  const life = p(node.params.life, 0);
  const spread = p(node.params.spread, 0);
  const respawn = sel(node.params.mode, ['fill', 'rate', 'respawn'], 'fill') === 'respawn';
  const lines = [
    `    vec4 ${em}_a = vec4(0.0);\n`,
    `    vec4 ${em}_b = vec4(0.0);\n`,
    `    float ${em}_w = max(${p(node.params.share, 1)}, 0.0);\n`,
    stateC ? `    float ${em}_sp = ${species};\n` : '',
    `    if (a_born) {\n`,
    `        uint ${id}_s = a_seed ^ 0x${(hashId(id) >>> 0).toString(16).padStart(8, '0')}u;\n`,
    `        float ${id}_r1 = agRnd(${id}_s), ${id}_r2 = agRnd(${id}_s), ${id}_r4 = agRnd(${id}_s);\n`,
    `        vec3 ${id}_c = ${centre};\n`,
    `        vec3 ${id}_pp = ${id}_c;\n`,
    `        vec3 ${id}_out = vec3(1.0, 0.0, 0.0);\n`,
    skip ? `        bool ${id}_miss = false;\n` : '',
    `        ${place[shape]}\n`,
    `        vec3 ${id}_dir = ${head};\n`,
    `        float ${id}_r6 = agRnd(${id}_s), ${id}_r7 = agRnd(${id}_s);\n`,
    `        if (${spread} > 0.0) ${id}_dir = normalize(mix(${id}_dir, agUnit3(${id}_s), ${spread}) + vec3(0.0, 1e-4, 0.0));\n`,
    `        float ${id}_sp = ${p(node.params.speed, 0)} * (1.0 + ${p(node.params.speedVar, 0)} * (${id}_r6 * 2.0 - 1.0));\n`,
    `        float ${id}_life = ${life} > 0.0 ? ${life} * (1.0 + ${p(node.params.lifeVar, 0.2)} * (${id}_r4 * 2.0 - 1.0)) : 1.0e30;\n`,
    `        float ${id}_age0 = ${respawn ? `a_step == 0u && ${id}_life < 1.0e29 ? ${id}_r7 * ${id}_life : 0.0` : '0.0'};\n`,
    `        ${em}_a = vec4(${id}_pp, ${id}_age0);\n`,
    // Born still, it keeps its facing as a velocity too small to move it.
    `        ${em}_b = vec4(${id}_dir * (abs(${id}_sp) > 1e-5 ? ${id}_sp : 1e-5), max(${id}_life, 1e-3));\n`,
    skip ? `        if (${id}_miss) ${em}_b = vec4(0.0);\n` : '',
  ];
  if (v.also) lines.push(`        if (agRnd(${id}_s) * (${em}_w + ${v.also}_w) >= ${em}_w) { ${em}_a = ${v.also}_a; ${em}_b = ${v.also}_b;${stateC ? ` ${em}_sp = ${v.also}_sp;` : ''} }\n`);
  lines.push(`    }\n`);
  if (v.also) lines.push(`    ${em}_w += ${v.also}_w;\n`);
  return { code: lines.join(''), outputVars: { emitter: em } };
}

/** A stable 32-bit number from a node id, so two Emits in a chain draw different random numbers. */
export function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export const AgentDepositNode: NodeDefinition = {
  type: 'agentDeposit',
  label: 'Deposit',
  category: 'Simulation',
  aliases: ['Leave trail', 'Pheromone', 'Stigmergy'],
  description: 'Every walker of an Agents group leaves Amount of trail where it stands, every step, into the Trail field this is wired to (each species into its own channel). Chain Deposits through Also to put several groups into one Trail.',
  inputs: {
    agents: { type: 'agents', label: 'Agents', hint: 'An Agents group\'s output.' },
    also: { type: 'deposit', label: '+ Another Deposit', hint: 'Chain: another Deposit (another group\'s walkers) going into the same Trail.' },
  },
  outputs: {
    deposit: { type: 'deposit', label: 'Deposit', hint: 'Wire into a Trail field\'s Deposit.' },
  },
  defaultParams: { amount: 1, size: 1, what: 'trail' },
  paramDefs: {
    what: { label: 'What', type: 'select', hint: 'Trail: each walker\'s own species channel (or what Agent Output\'s Deposit says). Velocity: its velocity in the first two channels and a count in the third, so the trail becomes a field of how the crowd moves (flocking).', options: [
      { value: 'trail', label: 'Trail (by species, or Agent Output\'s Deposit)' }, { value: 'velocity', label: 'Velocity (for flocking)' },
    ] },
    amount: { label: 'Amount', type: 'float', min: 0, max: 20, step: 0.01, hint: 'Trail each walker leaves per step.' },
    size: { label: 'Size', type: 'float', min: 1, max: 4, step: 1, hint: 'Trail pixels square each walker marks (1 is the classic look).' },
  },
  assignable: false,
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

export const TrailFieldNode: NodeDefinition = {
  type: 'trailField',
  label: 'Trail field',
  category: 'Simulation',
  aliases: ['Trail', 'Pheromone field', 'Chemoattractant', 'Trail map'],
  description: 'The trail the walkers leave: every step it spreads out (Diffuse) and fades (Half-life). It is an ordinary texture: Amount at this pixel goes into a Palette or the Output, Texture into Glow, Blur or Sample (texture), and back into the Agents group for Sense to smell (it reads the trail as it was one step before).',
  inputs: {
    deposit: { type: 'deposit', label: 'Deposit', hint: 'A Deposit (or a chain of them).' },
    add: { type: 'vec4', label: 'Add', hint: 'Painted into the trail every step, per second (one amount per channel), at each trail pixel: food from a picture, a shape, noise. Any chain of nodes; it reads that pixel\'s position.' },
    block: { type: 'float', label: 'Block', hint: 'Where this is 1 the trail is wiped every step (0 leaves it): walls and obstacles nothing can smell through. Any chain of nodes.' },
  },
  outputs: {
    amount: { type: 'float', label: 'Amount', hint: 'The trail here, softly scaled to 0–1 by Gain: wire into a Palette.' },
    raw: { type: 'float', label: 'Raw', hint: 'The first channel\'s amount here, unscaled.' },
    channels: { type: 'vec4', label: 'Channels', hint: 'All four channels here, unscaled (one per species).' },
    texture: { type: 'texture', label: 'Image', hint: 'The whole trail as an image (a texture): back into the Agents group for Sense (through an input you add on Agent Inputs), or into Glow, Blur or Sample (texture).' },
  },
  defaultParams: { resolution: '0.5', diffuse: 1, halfLife: 0.12, edges: 'wrap', gain: 0.15, kernel: '3', volume: '96' },
  paramDefs: {
    volume: { label: 'Volume', type: 'select', hint: '3D (a 3D group deposits here): the volume\'s rows and slices; its columns follow the picture\'s shape.', help: 'In 3D the trail is a volume over the walkers\' box: this many rows and as many slices deep (columns follow the picture\'s shape, so 96 at 16:9 is 171 × 96 × 96, about 1.6 million cells). Sense reads it in 3D; Amount, Channels and Image are the volume seen from the front, summed through its depth. Bigger is finer and costs more memory and time (160: 7 million cells, about 110 MB with its copy).', options: [
      { value: '64', label: '64 (fast)' }, { value: '96', label: '96' }, { value: '128', label: '128' }, { value: '160', label: '160 (fine, heavy)' },
    ], showWhen: { param: 'agentSpace', value: '3d' } },
    resolution: { label: 'Resolution', type: 'select', hint: 'Size of the trail texture: a share of the picture, or a fixed height for a look that doesn\'t change with the window.', options: [
      { value: '0.5', label: '½ picture' }, { value: '0.25', label: '¼ picture' }, { value: '1', label: 'Full picture' },
      { value: '512', label: '512 rows' }, { value: '1024', label: '1024 rows' }, { value: '2048', label: '2048 rows' },
    ] },
    diffuse: { label: 'Diffuse', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much the trail spreads to its neighbours each step (a mix toward the 3×3 mean, or the 5×5 blur).' },
    kernel: { label: 'Spread', type: 'select', hint: '3×3: the slime paper\'s mean of the 8 neighbours. 5×5: a wider, smoother blur (a Gaussian-like 1-4-6-4-1), for soft fields such as flocking.', options: [
      { value: '3', label: '3×3 mean' }, { value: '5', label: '5×5 blur' },
    ] },
    halfLife: { label: 'Half-life', type: 'float', min: 0.005, max: 10, step: 0.005, hint: 'Seconds (simulated) for the trail to fade to half. Short makes thin, busy veins; long makes thick, slow ones.' },
    edges: { label: 'Edges', type: 'select', hint: 'Wrap joins opposite edges (matches Move\'s Wrap); Clamp keeps them apart.', options: [
      { value: 'wrap', label: 'Wrap' }, { value: 'clamp', label: 'Clamp' },
    ] },
    gain: { label: 'Gain', type: 'float', min: 0, max: 4, step: 0.001, hint: 'Scales Amount: 1 − e^(−trail × gain).' },
  },
  assignable: false,
  // Compiled as a source only (the compiler strips its Deposit wire): node.id is the slug.
  // The sampling nodes (Sample, Blur, Glow, Edges (texture)) also read the picture's pixel size, `<sampler>_px`, as for a Pass.
  declarationsFor: (node: GraphNode) => [`uniform sampler2D ${trailUniform(node.id)};`, `uniform vec2 ${trailUniform(node.id)}_px;`],
  glslFunctions: [AG_UV_GLSL],
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    const tex = trailUniform(id);
    return {
      code: `    vec4 ${id}_t = texture2D(${tex}, agUv(g_uv));\n`,
      outputVars: {
        amount: `(1.0 - exp(-max(${id}_t.r, 0.0) * ${p(node.params.gain, 0.15)}))`,
        raw: `${id}_t.r`,
        channels: `${id}_t`,
        texture: tex,
      },
    };
  },
};

/**
 * The end of a Trail's own step program (made by the compiler when Add or Block is wired; never in a
 * graph): the spread and fade of agentShaders.js's fixed step, plus Add (per second) and Block. It
 * runs over the trail's texture, so g_uv is each trail pixel's place in the picture.
 */
export const TrailStepOutNode: NodeDefinition = {
  type: 'trailStepOut',
  label: 'Trail step output',
  category: 'Output',
  description: 'Internal: what a Trail field\'s step program writes.',
  inputs: {
    add: { type: 'vec4', label: 'Add' },
    block: { type: 'float', label: 'Block' },
  },
  outputs: {},
  defaultParams: { trail: '' },
  declarationsFor: (node: GraphNode) => {
    const u = trailStepUniforms(String(node.params.trail));
    return [`uniform sampler2D ${u.src};`, `uniform vec4 ${u.step};`];
  },
  glslFunctions: [AG_TRAIL_MEAN_GLSL],
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const u = trailStepUniforms(String(node.params.trail));
    // u.step = (diffuse, keep, flags: 1 wrap + 2 the 5×5 blur + 4 signed, a step's seconds).
    return {
      code: [
        `    ivec2 ${id}_p = ivec2(gl_FragCoord.xy);\n`,
        `    int ${id}_f = int(${u.step}.z + 0.5);\n`,
        `    vec4 ${id}_t = mix(texelFetch(${u.src}, ${id}_p, 0), agTrailMean(${u.src}, ${id}_p, textureSize(${u.src}, 0), ${id}_f & 1, (${id}_f >> 1) & 1), clamp(${u.step}.x, 0.0, 1.0)) * ${u.step}.y;\n`,
        v.add ? `    ${id}_t += ${v.add} * ${u.step}.w;\n` : '',
        v.block ? `    ${id}_t *= 1.0 - clamp(${v.block}, 0.0, 1.0);\n` : '',
        `    gl_FragColor = (${id}_f & 4) != 0 ? ${id}_t : max(${id}_t, vec4(0.0));\n`,
      ].join(''),
      outputVars: {},
    };
  },
};

/**
 * A 3D Draw agents' scene probe (made by the compiler when Camera from and Camera ray are wired;
 * never in a graph): Mode camera writes the camera's origin (uniform .z 0) or its ray (else) at
 * g_uv = uniform.xy (the compiler sets g_uv from it); Mode depth writes Depth into .b at each pixel.
 */
export const AgentProbeOutNode: NodeDefinition = {
  type: 'agentProbeOut',
  label: 'Scene probe output',
  category: 'Output',
  description: 'Internal: a 3D Draw agents\' look at a ray-marched scene (its camera and depth).',
  inputs: {
    ro: { type: 'vec3', label: 'Camera from' },
    rd: { type: 'vec3', label: 'Camera ray' },
    depth: { type: 'float', label: 'Depth' },
  },
  outputs: {},
  defaultParams: { mode: 'camera', uniform: '' },
  declarationsFor: (node: GraphNode) => (node.params.mode === 'camera' ? [`uniform vec4 ${String(node.params.uniform)};`] : []),
  generateGLSL: (node: GraphNode, v) => ({
    code: node.params.mode === 'camera'
      ? `    gl_FragColor = ${String(node.params.uniform)}.z < 0.5 ? vec4(${v.ro ?? 'vec3(0.0, 0.0, 3.0)'}, 1.0) : vec4(normalize(${v.rd ?? 'vec3(0.0, 0.0, -1.0)'}), 1.0);\n`
      // Half floats hold up to 65504: a ray that misses (a huge distance) is just far.
      : `    gl_FragColor = vec4(0.0, 0.0, clamp(${v.depth ?? '60000.0'}, 0.0, 60000.0), 1.0);\n`,
    outputVars: {},
  }),
};

/** The Particles engine's palettes, for Draw agents (its names), or Colour A → B. */
export const AG_PALETTE_OPTIONS = [
  { value: 'ab', label: 'Colour A → B' },
  ...Object.keys(GP_PALETTES).map(k => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })),
];
export const DRAW_STYLES = ['points', 'glow', 'streaks', 'ink'] as const;
export const GP_PALETTE_NAMES = Object.keys(GP_PALETTES);
export const DRAW_COLOR_BY = ['single', 'species', 'speed', 'heading', 'age', 'agent', 'speedFast', 'headingRound'] as const;

/**
 * Draw agents' camera in 3D: the unified camera of Time Cube View and Frame Stack (Distance, Angle,
 * Elevation, Orbit speed, Zoom, Flatten, Translate X / Y / Z; the same keys and the March Camera's
 * way round, Angle and Elevation in degrees here), plus the Particles node's Drift and depth of
 * field (Focus, Blur, Max blur). Shown only in 3D.
 */
export const DRAW_CAMERA_DEFAULTS = { camDist: 3.2, camAngle: 0, camElevation: 15, rotSpeed: 0, fov: 1.8, ortho: 0, camX: 0, camY: 0, camZ: 0, drift: 0, focus: 1, blur: 0, maxBlur: 7 };
const in3d = { showWhen: { param: 'agentSpace', value: '3d' } };
export const DRAW_CAMERA_PARAMS: Record<string, ParamDef> = {
  camDist: { label: 'Distance', type: 'float', min: 0.3, max: 40, step: 0.01, section: 'Camera', hint: 'How far the camera is from the point it looks at (picture units: the picture is 2 tall).', ...in3d },
  camAngle: { label: 'Angle', type: 'float', min: -360, max: 360, step: 0.5, section: 'Camera', hint: 'Where the camera stands round the point it looks at, in degrees (0: in front).', ...in3d },
  camElevation: { label: 'Elevation', type: 'float', min: -89, max: 89, step: 0.5, section: 'Camera', hint: 'How far above (or below) it looks from, in degrees: 0 level, 35 the isometric angle, 89 straight down.', ...in3d },
  rotSpeed: { label: 'Orbit speed', type: 'float', min: -180, max: 180, step: 0.5, section: 'Camera', hint: 'Turns the camera round the point it looks at over time, in degrees a second.', ...in3d },
  fov: { label: 'Zoom', type: 'float', min: 0.5, max: 5, step: 0.01, section: 'Camera', hint: 'Lens length: higher is zoomed in, with less perspective (1.8: Time Cube View\'s).', ...in3d },
  ortho: { label: 'Flatten', type: 'float', min: 0, max: 1, step: 0.01, section: 'Camera', hint: 'From perspective (0) to orthographic (1): far walkers as big as near ones, like an isometric drawing.', ...in3d },
  camX: { label: 'Translate X', type: 'float', min: -5, max: 5, step: 0.01, section: 'Camera', hint: 'Moves the camera and the point it looks at sideways; Angle and Elevation turn round the moved point.', ...in3d },
  camY: { label: 'Translate Y', type: 'float', min: -5, max: 5, step: 0.01, section: 'Camera', hint: 'Moves the camera and the point it looks at up or down.', ...in3d },
  camZ: { label: 'Translate Z', type: 'float', min: -5, max: 5, step: 0.01, section: 'Camera', hint: 'Moves the camera and the point it looks at through the depth: fly through the walkers.', ...in3d },
  drift: { label: 'Drift', type: 'float', min: -1, max: 1, step: 0.01, section: 'Camera', hint: 'The Particles node\'s drift: the camera circles slowly, bobs and breathes in and out on its own (0: still; 0.05–0.2 gentle).', ...in3d },
  focus: { label: 'Focus', type: 'float', min: 0.05, max: 4, step: 0.01, section: 'Camera', hint: 'Where it is sharp, as a share of the distance to the point it looks at (1: there; less: nearer). With a scene\'s camera: of the distance to the world\'s centre.', ...in3d },
  blur: { label: 'Blur', type: 'float', min: 0, max: 4, step: 0.01, section: 'Camera', hint: 'Depth of field: out of focus, walkers spread into soft discs that keep their light (0: everything sharp).', ...in3d },
  maxBlur: { label: 'Max blur', type: 'float', min: 1, max: 32, step: 0.5, section: 'Camera', hint: 'The widest a blurred walker draws (pixels of a 720-high picture). Wider ones are thinned at random, each survivor heavier, so blur costs no fill rate.', ...in3d },
};

export const DrawAgentsNode: NodeDefinition = {
  type: 'drawAgents',
  label: 'Draw agents',
  category: 'Simulation',
  aliases: ['Render agents', 'Agent points', 'Show agents', 'Draw particles', 'Streaks', 'Ink'],
  description: 'Draws every walker of an Agents group over the picture wired into Over, with the Particles node\'s looks: soft dots (Points), dots with a glow (Glow), short lines along their motion (Streaks), or dark ink on paper (Ink), lit by up to four moving lights. Colour by species, speed, heading or age, with Colour A → B or one of the Particles palettes. A 3D group is seen through a camera (Distance, Angle, Elevation, Orbit speed, Zoom, Flatten, Translate) with depth of field, or through a ray-marched scene\'s camera wired into Camera from and Camera ray.',
  inputs: {
    agents: { type: 'agents', label: 'Agents', hint: 'An Agents group\'s output.' },
    over: { type: 'vec3', label: 'Over', hint: 'The picture to draw on. Unwired: black (Ink: Paper).' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'Over with the walkers drawn on it.' },
    density: { type: 'float', label: 'Density', hint: 'How much walker light (Ink: ink) is here.' },
    texture: { type: 'texture', label: 'Image', hint: 'The drawn walkers alone, as an image (a texture): into Glow, Blur or another group.' },
  },
  defaultParams: {
    style: 'points', colorBy: 'heading', palette: 'ab', size: 1.5, brightness: 0.5, glow: 1, scaleBy: 'walker', streak: 0.25, fade: 'on', speedRef: 0.5,
    colorA: [1, 0.75, 0.35], colorB: [0.25, 0.55, 1], paper: [0.95, 0.95, 0.94],
    lights: '0', lightColor: [1, 0.55, 0.25], lightPower: 1.6, lightReach: 0.3, halo: 0.5, lightMotion: 'orbit', lightOrbit: 0.5, lightX: 0, lightY: 0,
    ...DRAW_CAMERA_DEFAULTS,
  },
  paramDefs: {
    style: { label: 'Style', type: 'select', section: 'Look', hint: 'Points: soft dots. Glow: dots with a wide glow. Streaks: short lines along each walker\'s motion, glowing. Ink: dark ink laid on paper, bleeding a little.', options: [
      { value: 'points', label: 'Points' }, { value: 'glow', label: 'Glow' }, { value: 'streaks', label: 'Streaks' }, { value: 'ink', label: 'Ink' },
    ] },
    size: { label: 'Size', type: 'float', min: 0.25, max: 16, step: 0.25, section: 'Look', hint: 'Dot size in pixels (The crowd: pixels of a 720-pixel-high picture).' },
    brightness: { label: 'Brightness', type: 'float', min: 0, max: 8, step: 0.01, section: 'Look', hint: 'Light (Ink: ink) each walker adds.' },
    scaleBy: { label: 'Brightness of', type: 'select', section: 'Look', hint: 'Each walker: Brightness is one walker\'s light. The crowd: the Particles node\'s rule, so the whole cloud looks as bright at every count, size and picture size.', options: [
      { value: 'walker', label: 'Each walker' }, { value: 'crowd', label: 'The crowd' },
    ] },
    glow: { label: 'Glow', type: 'float', min: 0, max: 4, step: 0.01, section: 'Look', hint: 'How strong the glow is (Glow and Streaks; Ink: how far it bleeds).' },
    streak: { label: 'Streak', type: 'float', min: 0, max: 4, step: 0.01, section: 'Look', hint: 'Streaks (and Ink above 0): how long each line is, in seconds of travel × 0.12 (the Particles node\'s Thread).', showWhen: { param: 'style', value: ['streaks', 'ink'] } },
    fade: { label: 'Fade with age', type: 'select', section: 'Look', hint: 'Walkers with a Life fade in at birth and out toward its end.', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
    colorBy: { label: 'Colour by', type: 'select', section: 'Colour', hint: 'What picks each walker\'s colour along the palette (or between Colour A and B).', options: [
      { value: 'single', label: 'One colour (A / the palette\'s start)' }, { value: 'species', label: 'Species' }, { value: 'speed', label: 'Speed' }, { value: 'heading', label: 'Heading' }, { value: 'age', label: 'Age (share of its life)' },
      { value: 'agent', label: 'Agent (its own Colour, set inside the group)' },
      { value: 'speedFast', label: 'Speed, fast first (the Particles node\'s)' }, { value: 'headingRound', label: 'Heading, once round (the Particles node\'s)' },
    ] },
    palette: { label: 'Palette', type: 'select', section: 'Colour', hint: 'Colour A → B, or one of the Particles node\'s palettes.', options: AG_PALETTE_OPTIONS },
    colorA: { label: 'Colour A', type: 'vec3color', section: 'Colour' },
    colorB: { label: 'Colour B', type: 'vec3color', section: 'Colour' },
    speedRef: { label: 'Fast is', type: 'float', min: 0.01, max: 8, step: 0.01, section: 'Colour', hint: 'Colour by Speed: the speed that reaches the end of the palette (Speed, fast first: its start), in picture units a second.' },
    paper: { label: 'Paper', type: 'vec3color', section: 'Colour', hint: 'Ink: the paper\'s colour when nothing is wired into Over.', showWhen: { param: 'style', value: 'ink' } },
    lights: { label: 'Lights', type: 'select', section: 'Lights', hint: 'Point lights that move round the picture: walkers near one glow brighter and larger, with a halo round each light (Glow, Streaks, Ink).', options: [
      { value: '0', label: 'None' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' },
    ] },
    lightColor: { label: 'Light colour', type: 'vec3color', section: 'Lights', hint: 'The first light\'s colour; the others are its neighbours round the colour wheel.', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    lightPower: { label: 'Light power', type: 'float', min: 0, max: 20, step: 0.01, section: 'Lights', hint: 'How bright the lights are.', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    lightReach: { label: 'Light reach', type: 'float', min: 0.01, max: 4, step: 0.01, section: 'Lights', hint: 'How far each light reaches (picture units).', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    halo: { label: 'Halo', type: 'float', min: 0, max: 4, step: 0.01, section: 'Lights', hint: 'The glow round each light itself.', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    lightMotion: { label: 'Light motion', type: 'select', section: 'Lights', hint: 'Orbit: they circle the centre. Still: they stand round it.', options: [{ value: 'orbit', label: 'Orbit' }, { value: 'still', label: 'Still' }], showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    lightOrbit: { label: 'Orbit size', type: 'float', min: 0.1, max: 1.2, step: 0.01, section: 'Lights', hint: 'How far from the centre the lights go (picture units).', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    lightX: { label: 'Centre X', type: 'float', min: -2, max: 2, step: 0.01, section: 'Lights', hint: 'The centre the lights move round, across.', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    lightY: { label: 'Centre Y', type: 'float', min: -1, max: 1, step: 0.01, section: 'Lights', hint: 'The centre the lights move round, up.', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    // 3D only: the camera (after the look, so the look stays the card's first section).
    ...DRAW_CAMERA_PARAMS,
  },
  assignable: false,
  // Compiled as a source only (the compiler strips its Agents wire): node.id is the slug.
  declarationsFor: (node: GraphNode) => [`uniform sampler2D ${agentDrawUniform(node.id)};`, `uniform vec2 ${agentDrawUniform(node.id)}_px;`],
  glslFunctions: [AG_UV_GLSL],
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const tex = agentDrawUniform(id);
    const ink = sel(node.params.style, [...DRAW_STYLES], 'points') === 'ink';
    // Ink is premultiplied (ink colour × cover, cover): it covers the paper. Light adds to the picture.
    const color = ink
      ? `${v.over ?? pv3(node.params.paper, [0.95, 0.95, 0.94])} * (1.0 - clamp(${id}_s.a, 0.0, 1.0)) + max(${id}_s.rgb, vec3(0.0))`
      : `${v.over ?? 'vec3(0.0)'} + max(${id}_s.rgb, vec3(0.0))`;
    return {
      code: `    vec4 ${id}_s = texture2D(${tex}, agUv(g_uv));\n    vec3 ${id}_color = ${color};\n`,
      outputVars: { color: `${id}_color`, density: `max(${id}_s.a, 0.0)`, texture: tex },
    };
  },
};

/**
 * Slime mold — a starter in the Simulation category, never a node in a graph:
 * adding it builds the whole preset next to the Output (nodes/agentPresets.ts).
 */
export const SlimeMoldPresetNode: NodeDefinition = {
  type: 'slimeMoldPreset',
  label: 'Slime mold (preset)',
  category: 'Simulation',
  aliases: ['Physarum preset', 'Slime preset', 'Jones slime'],
  description: 'Adds a working slime mold: 262,144 walkers (256k) that sense the trail ahead, turn toward it, move and leave more trail, which spreads and fades. Veins form, join and pulse by themselves. Every node it adds has a note saying what it does and what to try.',
  inputs: {},
  outputs: {},
  defaultParams: {},
  paramDefs: {},
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

const preset = (type: string, label: string, aliases: string[], description: string): NodeDefinition => ({
  type, label, category: 'Simulation', aliases, description,
  inputs: {}, outputs: {}, defaultParams: {}, paramDefs: {},
  generateGLSL: () => ({ code: '', outputVars: {} }),
});

/** Particles — the Particles node's default look, built from nodes (a starter, never a node in a graph). */
export const ParticlesPresetNode = preset('particlesPreset', 'Particles (preset)', ['Particles from nodes', 'Embers preset', 'Curl particles', 'Particle system'],
  'Adds the Particles node\'s default look built from nodes you can open and rewire: 262,144 embers born on a ring, carried by curl noise and a gentle swirl, pulled by the mouse, slowed by drag, fading over their life, drawn with glow and four orbiting lights. Every node it adds has a note saying what it does and what to try.');
/** Curl smoke — ink-like smoke rising and curling (a starter). */
export const CurlSmokePresetNode = preset('curlSmokePreset', 'Curl smoke (preset)', ['Smoke preset', 'Ink smoke', 'Rising smoke'],
  'Adds smoke built from nodes: particles rise from a small source, warm air lifting them less as they cool, while curl noise folds them into threads and a gusty breeze leans them over, drawn as ink streaks on paper. Every node has a note.');
/** Sound burst — shockwaves on a stand-in beat (a starter). */
export const SoundBurstPresetNode = preset('soundBurstPreset', 'Sound burst (preset)', ['Shockwave preset', 'Beat particles', 'Audio particles'],
  'Adds particles that answer sound: a disc of glowing streaks that a ring of pressure blasts outward on every beat and a spring pulls back together. A silent stand-in beat (120 a minute) drives it until you give it real sound. Every node has a note.');

// ── P3 presets: species, food and obstacles ─────────────────────────────────
/** Multi-species slime — three colonies competing for room (a starter). */
export const MultiSlimePresetNode = preset('multiSlimePreset', 'Multi-species slime (preset)', ['Three species', 'Competing slime', 'Species preset', 'Territories'],
  'Adds three slime colonies of different colours that grow toward each other: each follows its own kind\'s trail and avoids the others\', so they carve the picture into living territories with sharp borders. Every node has a note.');
/** Ants — a nest, food, and walkers that carry it home (a starter). */
export const AntsPresetNode = preset('antsPreset', 'Ants (preset)', ['Ant colony', 'Foraging', 'Pheromone trails', 'Ant trails'],
  'Adds an ant colony built from nodes: ants leave the nest, wander until they find food, pick it up and follow the home smell back, marking a food trail as they go, so busy roads form between the nest and the food. Each ant remembers whether it carries food (Memory). Every node has a note.');
/** Boids — flocking through a velocity field (a starter). */
export const BoidsPresetNode = preset('boidsPreset', 'Boids (preset)', ['Flocking', 'Flock', 'Murmuration', 'Swarm preset', 'Field boids'],
  'Adds flocking built from nodes: every bird leaves its velocity in a blurred field, then steers to match the flow around it, drifts toward the crowd and away from a crush. Flocks gather, turn together and stream past each other. Every node has a note.');
/** Strands — long flowing filaments (a starter). */
export const StrandsPresetNode = preset('strandsPreset', 'Strands (preset)', ['Filaments', 'Hair', 'Flowing lines', 'Fibres'],
  'Adds slime tuned for long flowing filaments: walkers that look far ahead and turn only a little, drawn as dark ink streaks on paper, so the picture fills with combed strands like hair or silk. Every node has a note.');
/** Grow toward a picture — slime feeding on a picture's bright parts (a starter). */
export const GrowPicturePresetNode = preset('growPicturePreset', 'Grow toward a picture (preset)', ['Slime picture', 'Feed on image', 'Food from a picture', 'Image slime'],
  'Adds slime that feeds on a picture: its bright parts are food painted into the trail every step, so the network grows over them and draws the picture in veins. A built-in moonlit picture until you load your own into its Texture Input. Every node has a note.');

// ── P6 presets ───────────────────────────────────────────────────────────────
/** Galaxy — stars on orbits crowding into two turning spiral arms (a starter). */
export const GalaxyPresetNode = preset('galaxyPreset', 'Galaxy (preset)', ['Spiral galaxy', 'Stars', 'Density wave', 'Orbits', 'Space'],
  'Adds a spiral galaxy built from nodes: 262,144 stars circle a bright bulge and crowd into two spiral arms that turn slowly, the arms lit blue with young stars and pink knots, the core warm. Each star remembers its own orbit (Memory). Every node has a note.');
/** Mycelium — a fungus colony branching out of a spore (a starter). */
export const MyceliumPresetNode = preset('myceliumPreset', 'Mycelium (preset)', ['Fungus', 'Hyphae', 'Mould', 'Branching growth', 'Colony'],
  'Adds a fungus colony built from nodes: growing tips shy away from threads already there, and new tips sprout on the young threads at the colony\'s edge, so it branches outward from a spore and fills in behind. Every node has a note.');
/** Sand on a plate — Chladni figures from a silent beat (a starter). */
export const SandPlatePresetNode = preset('sandPlatePreset', 'Sand on a plate (preset)', ['Chladni preset', 'Cymatics preset', 'Sand plate', 'Nodal lines'],
  'Adds grains of sand on a ringing square plate: shaken off wherever the plate moves, they settle on its still lines and draw a Chladni figure. Its stand-in Beat is off (a still figure); set the group\'s Beat to 20 and each beat jolts the sand and steps the plate to the next figure. Every node has a note.');
