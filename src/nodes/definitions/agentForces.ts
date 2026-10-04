/**
 * Particle forces inside an Agents group (docs/agents-plan.md §2, phase P2):
 * Gravity, Wind, Curl noise, Attract / Repel, Vortex, Flow, Sound kick, then
 * Integrate (velocity, drag, edges) and Age / Life; Collide and Chladni move
 * the walker directly after Integrate, as the Particles node does.
 *
 * Forces chain: each has an **Also** input (a vec2 force) that it adds its own
 * to, so Curl → Vortex → Attract wired in a row is their sum. Ordinary Add
 * nodes work on the same wires. Units are the picture's (y −1…1, x ±aspect),
 * so a force is picture units a second per second; one step is 1/60 s.
 *
 * The maths is the Particles engine's own: every formula below is built from
 * the GLSL pieces gpuParticles.js writes its simulation with (gpCurlPlane,
 * gpSwirl, gpHandPush, gpShockPush, gpPlateGlsl…), called with this node's
 * names. gpEngineShaders.test.ts proves those pieces give the engine's text
 * byte for byte, so the two engines can't drift apart.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { fieldFn, p } from './helpers';
import { agHandParams, agHandPlace, hashId } from './agents';
import {
  GP_SHADERS, gpAttractPull, gpBesselGlsl, gpCrunch, gpCurlAt, gpCurlOctave2, gpCurlPlane, gpFade, gpFlowPush, gpGust,
  gpHandFall, gpHandPush, gpLevelGlsl, gpPlateGlsl, gpPlateStep, gpShockPush, gpShockRing, gpSwirl, gpVibrate, gpWavePhase, gpWavePush,
} from '../../play/kit/gpuParticles.js';

const THIS_AGENT = 'Unwired: this walker\'s own (the card shows "← this walker\'s …").';
/** The chain socket (key `also`, kept for saved graphs): another force wired here is added to this one. */
const ALSO = { type: 'vec2' as const, label: '+ Another force', hint: 'Chain: wire another force (or a chain of them) here and they add up. Forces in a row, e.g. Curl noise → Vortex → Attract, then the last one into Integrate\'s Force.' };
const FORCE_OUT = { force: { type: 'vec2' as const, label: 'Force', hint: 'This force plus any chained into "+ Another force": wire into the next force\'s "+ Another force", or into Integrate\'s Force.' } };
const sel = (v: unknown, allowed: string[], fallback: string) => (typeof v === 'string' && allowed.includes(v) ? v : fallback);
const plus = (also: string | undefined) => (also ? ` + ${also}` : '');
/** The pointer in picture coordinates (the Mouse node's formula). */
const MOUSE = '((u_mouse / u_resolution.y - vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5) * 2.0)';
/** The Particles engine's hash and gradient noise (gpHash, gpRnd, gpUnit; gpNoised), as they are. */
const GP_HASH_NOISE = [GP_SHADERS.GP_HASH, GP_SHADERS.GP_NOISE];
/** A random-number state for this node: this walker, this step, this node. */
const rngState = (id: string) => `a_seed ^ 0x${hashId(id).toString(16).padStart(8, '0')}u`;

/** Uniform names the engine fills for a node that listens (Sound kick, Chladni): by the node's slug. */
export const listenUniforms = (slug: string) => ({
  /** vec4: level, bass, treble, onset (0…1, as the Particles engine hears them). */
  sound: `u_agSnd_${slug}`,
  /** vec4[4]: the shock rings in flight (x, y, start time, strength). */
  shocks: `u_agShk_${slug}`,
  /** The level history, 256 × 1, newest first, 60 a second. */
  levels: `u_agLv_${slug}`,
  /** vec4[8] modes (n, m, k, weight), their count, and the shake now (a plate). */
  plateModes: `u_agPlM_${slug}`,
  plateCount: `u_agPlN_${slug}`,
  plateShake: `u_agPlS_${slug}`,
});
/** The Bessel table (J_n for a round plate), shared by every Chladni node. */
export const AG_BESSEL_UNIFORM = 'u_agBessel';

/** Sound from: what a listening node hears (the Particles node's choices). */
const SOUND_FROM_OPTIONS = [
  { value: 'graph', label: 'Level (and Beat)' }, { value: 'live', label: 'Mic' }, { value: 'master', label: 'Audio engine' },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(k => ({ value: `track${k}`, label: `Engine track ${k}` })),
];
const SOUND_PARAMS = {
  soundFrom: { label: 'Sound from', type: 'select' as const, section: 'Sound', hint: 'What it listens to.', help: 'Level (and Beat): the Level slider (map Live audio or an audio track to it in Play) plus the stand-in Beat. Mic: the live input (enable it in Play). Audio engine: the Play page\'s engine, its master or one track. The Level slider is added to what is heard. When the Agents group\'s own Sound from is set (anything but Each node\'s own), it wins: every listening node inside hears the group\'s, with its Level and Beat.', options: SOUND_FROM_OPTIONS },
  level: { label: 'Level', type: 'float' as const, min: 0, max: 1, step: 0.01, section: 'Sound', hint: 'How loud it is now (map audio to it in Play).' },
  beat: { label: 'Beat', type: 'float' as const, min: 0, max: 200, step: 1, section: 'Sound', hint: 'A stand-in beat, in beats a minute (0: off). Silent: it only moves the numbers.', help: 'A silent stand-in for music while you build: a kick every beat at this tempo, as a level that jumps and decays. It is part of the simulation (the same every run), so recordings match. Set it to 0 when real sound drives Level. On a Chladni plate each beat also jolts the sand (Shake rises with every hit) and steps it to the next figure, so a slow Beat reads as a regular pulse: that is the beat, not a glitch.' },
};

// ── Forces ──────────────────────────────────────────────────────────────────

export const AgentGravityNode: NodeDefinition = {
  type: 'agentGravity',
  label: 'Gravity',
  category: 'Simulation',
  aliases: ['Fall', 'Weight', 'Buoyancy', 'Constant force'],
  description: 'A constant pull, the same everywhere: down by default. Point it up for smoke and sparks rising. Add it to the other forces through Also, then into Integrate.',
  inputs: {
    direction: { type: 'vec2', label: 'Direction', hint: 'Which way it pulls (wins over Angle). It needn\'t be unit length.' },
    strength: { type: 'float', label: 'Strength', hint: 'Picture units a second, every second.' },
    also: ALSO,
  },
  outputs: FORCE_OUT,
  defaultParams: { strength: 0.5, angle: -90 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: -4, max: 4, step: 0.01, hint: 'How hard it pulls (picture units/s²). Negative pulls the other way.' },
    angle: { label: 'Angle', type: 'float', min: -180, max: 180, step: 1, hint: 'Which way, in degrees: −90 is down, 90 up, 0 right.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const dir = v.direction ? `(length(${v.direction}) > 1e-6 ? normalize(${v.direction}) : vec2(0.0))` : `vec2(cos(radians(${p(node.params.angle, -90)})), sin(radians(${p(node.params.angle, -90)})))`;
    return {
      code: `    vec2 ${id}_f = ${dir} * ${v.strength ?? p(node.params.strength, 0.5)}${plus(v.also)};\n`,
      outputVars: { force: `${id}_f` },
    };
  },
};

export const AgentWindNode: NodeDefinition = {
  type: 'agentWind',
  label: 'Wind',
  category: 'Simulation',
  aliases: ['Breeze', 'Gusts', 'Drift'],
  description: 'A steady wind with gusts, the Particles node\'s: it blows along Angle, stronger and weaker from place to place as slow noise drifts through.',
  inputs: {
    strength: { type: 'float', label: 'Strength', hint: 'Picture units a second, every second.' },
    position: { type: 'vec2', label: 'Position', hint: THIS_AGENT },
    also: ALSO,
  },
  outputs: FORCE_OUT,
  defaultParams: { strength: 0.3, angle: 0, gust: 1, size: 1, evolve: 0.15 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: -4, max: 4, step: 0.01, hint: 'How hard it blows (picture units/s²).' },
    angle: { label: 'Angle', type: 'float', min: -180, max: 180, step: 1, hint: 'Which way it blows, in degrees (0: to the right).' },
    gust: { label: 'Gusts', type: 'float', min: 0, max: 2, step: 0.01, hint: 'How much it varies from place to place (0: steady; 1: the Particles node\'s).' },
    size: { label: 'Size', type: 'float', min: 0.05, max: 10, step: 0.01, hint: 'Size of the gusts: bigger numbers, smaller gusts.' },
    evolve: { label: 'Evolve', type: 'float', min: 0, max: 4, step: 0.01, hint: 'How fast the gusts change (noise time a second).' },
  },
  assignable: false,
  glslFunctions: GP_HASH_NOISE,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const pos = v.position ?? 'a_pos';
    const ang = `radians(${p(node.params.angle, 0)})`;
    return {
      code: [
        `    vec4 ${id}_n = gpNoised(${gpCurlAt(`vec3(${pos}, 0.0)`, p(node.params.size, 1), `u_time * ${p(node.params.evolve, 0.15)}`)});\n`,
        `    float ${id}_g = mix(1.0, ${gpGust(`${id}_n`)}, ${p(node.params.gust, 1)});\n`,
        `    vec2 ${id}_f = vec2(cos(${ang}), sin(${ang})) * (${v.strength ?? p(node.params.strength, 0.3)} * ${id}_g)${plus(v.also)};\n`,
      ].join(''),
      outputVars: { force: `${id}_f` },
    };
  },
};

export const AgentCurlNode: NodeDefinition = {
  type: 'agentCurl',
  label: 'Curl noise',
  category: 'Simulation',
  aliases: ['Turbulence', 'Curl', 'Swirling noise', 'Smoke'],
  description: 'Swirling currents that never bunch up (the curl of two octaves of noise, the Particles node\'s Turbulence): walkers fold into streams, threads and eddies. Evolve makes the currents drift.',
  inputs: {
    strength: { type: 'float', label: 'Strength', hint: 'Picture units a second, every second.' },
    position: { type: 'vec2', label: 'Position', hint: 'Where the currents are read. ' + THIS_AGENT },
    also: ALSO,
  },
  outputs: {
    ...FORCE_OUT,
    noise: { type: 'float', label: 'Noise', hint: 'The noise itself here (−1…1).' },
  },
  defaultParams: { strength: 0.4, size: 1, evolve: 0.15 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: 0, max: 8, step: 0.01, hint: 'How hard the currents push (the Particles node\'s Turbulence).' },
    size: { label: 'Size', type: 'float', min: 0.05, max: 10, step: 0.01, hint: 'Bigger numbers make smaller, tighter eddies.' },
    evolve: { label: 'Evolve', type: 'float', min: 0, max: 4, step: 0.01, hint: 'How fast the currents change shape (0: a still flow).' },
  },
  assignable: false,
  glslFunctions: GP_HASH_NOISE,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const pos = v.position ?? 'a_pos';
    return {
      code: [
        `    vec3 ${id}_q = ${gpCurlAt(`vec3(${pos}, 0.0)`, p(node.params.size, 1), `u_time * ${p(node.params.evolve, 0.15)}`)};\n`,
        `    vec4 ${id}_a = gpNoised(${id}_q), ${id}_b = ${gpCurlOctave2(`${id}_q`)};\n`,
        `    vec2 ${id}_f = (${gpCurlPlane(`${id}_a`, `${id}_b`)}).xy * ${v.strength ?? p(node.params.strength, 0.4)}${plus(v.also)};\n`,
      ].join(''),
      outputVars: { force: `${id}_f`, noise: `${id}_a.x` },
    };
  },
};

export const AgentAttractNode: NodeDefinition = {
  type: 'agentAttract',
  label: 'Attract / Repel',
  category: 'Simulation',
  aliases: ['Attractor', 'Repel', 'Magnet', 'Pull', 'Push', 'Hand force', 'Mouse force'],
  description: 'Pulls walkers toward a point (negative Strength pushes them away), and can stir them round it. The point is the mouse, X and Y, or anything wired into Target: a hand, a null, a moving point.',
  inputs: {
    target: { type: 'vec2', label: 'Target', hint: 'The point (picture units). Wins over Target on the card. A hand or a null from Play goes here.' },
    strength: { type: 'float', label: 'Strength', hint: 'Negative repels.' },
    position: { type: 'vec2', label: 'Position', hint: THIS_AGENT },
    also: ALSO,
  },
  outputs: FORCE_OUT,
  defaultParams: { target: 'mouse', x: 0, y: 0, handX: 0.5, handY: 0.5, strength: 0.8, reach: 0.35, swirl: 0, falloff: 'reach' },
  paramDefs: {
    target: { label: 'Target', type: 'select', hint: 'Where the point is when nothing is wired into Target.', help: 'The mouse: the pointer over the picture. X and Y: a point in picture units. A hand or null: Hand X / Y (0–1 across and up), made for Play: right-click Hand X → Follow a hand, and a tracked hand (or the pointer, until a hand is seen) moves the point.', options: [
      { value: 'mouse', label: 'The mouse' }, { value: 'point', label: 'X and Y' }, { value: 'hand', label: 'A hand or null (Hand X / Y)' },
    ] },
    x: { label: 'X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'The point, across (picture units).', showWhen: { param: 'target', value: 'point' } },
    y: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01, hint: 'The point, up.', showWhen: { param: 'target', value: 'point' } },
    ...agHandParams('target', 'hand', 'The point'),
    strength: { label: 'Strength', type: 'float', min: -8, max: 8, step: 0.01, hint: 'How hard it pulls; negative pushes away.' },
    reach: { label: 'Reach', type: 'float', min: 0.02, max: 4, step: 0.01, hint: 'How far it reaches (picture units).' },
    swirl: { label: 'Swirl', type: 'float', min: -8, max: 8, step: 0.01, hint: 'Stirs them round the point (negative: the other way).' },
    falloff: { label: 'Falloff', type: 'select', hint: 'Reach: only near the point, like a hand (the Particles node\'s hands). Far: everywhere, strongest near it (its attractor).', options: [
      { value: 'reach', label: 'Within Reach' }, { value: 'far', label: 'Everywhere' },
    ] },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const pos = v.position ?? 'a_pos';
    const at = sel(node.params.target, ['mouse', 'point', 'hand'], 'mouse');
    const target = v.target ?? (at === 'mouse' ? MOUSE : at === 'hand' ? agHandPlace(p(node.params.handX, 0.5), p(node.params.handY, 0.5)) : `vec2(${p(node.params.x, 0)}, ${p(node.params.y, 0)})`);
    const strength = v.strength ?? p(node.params.strength, 0.8);
    const reach = p(node.params.reach, 0.35), swirl = p(node.params.swirl, 0);
    const lines = [`    vec2 ${id}_t = ${target};\n`];
    if (sel(node.params.falloff, ['reach', 'far'], 'reach') === 'far') {
      lines.push(
        `    vec2 ${id}_g = ${id}_t - ${pos};\n`,
        `    float ${id}_r = length(${id}_g) + 1e-4;\n`,
        `    vec2 ${id}_f = ${gpAttractPull(strength, `${id}_g`, `${id}_r`)} + ${gpSwirl(swirl, `(-${id}_g)`, `${id}_r`, `(${reach} * ${reach})`)}${plus(v.also)};\n`,
      );
    } else {
      lines.push(
        `    vec3 ${id}_hd = vec3(${id}_t - ${pos}, 0.0);\n`,
        `    float ${id}_hr = length(${id}_hd) + 1e-4;\n`,
        `    float ${id}_fall = ${gpHandFall(`${id}_hr`, reach)};\n`,
        `    vec2 ${id}_f = (${gpHandPush(strength, swirl, `${id}_hd`, `${id}_hr`, reach, `${id}_fall`)}).xy${plus(v.also)};\n`,
      );
    }
    return { code: lines.join(''), outputVars: { force: `${id}_f` } };
  },
};

export const AgentVortexNode: NodeDefinition = {
  type: 'agentVortex',
  label: 'Vortex',
  category: 'Simulation',
  aliases: ['Swirl', 'Whirlpool', 'Spin'],
  description: 'Swirls walkers round a centre, counter-clockwise (negative Strength: clockwise), strongest at Reach from it and fading toward the middle and far away (the Particles node\'s Swirl).',
  inputs: {
    centre: { type: 'vec2', label: 'Centre', hint: 'The centre (picture units). Wins over X and Y.' },
    strength: { type: 'float', label: 'Strength' },
    position: { type: 'vec2', label: 'Position', hint: THIS_AGENT },
    also: ALSO,
  },
  outputs: FORCE_OUT,
  defaultParams: { at: 'point', x: 0, y: 0, handX: 0.5, handY: 0.5, strength: 0.3, reach: 0.5 },
  paramDefs: {
    at: { label: 'Centre at', type: 'select', hint: 'Where the centre is when nothing is wired into Centre.', help: 'X and Y: picture units. The mouse: the pointer. A hand or null: Hand X / Y (0–1 across and up), made for Play (right-click Hand X → Follow a hand).', options: [
      { value: 'point', label: 'X and Y' }, { value: 'mouse', label: 'The mouse' }, { value: 'hand', label: 'A hand or null (Hand X / Y)' },
    ] },
    x: { label: 'X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'The centre, across.', showWhen: { param: 'at', value: 'point' } },
    y: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01, hint: 'The centre, up.', showWhen: { param: 'at', value: 'point' } },
    ...agHandParams('at', 'hand', 'The centre'),
    strength: { label: 'Strength', type: 'float', min: -8, max: 8, step: 0.01, hint: 'How hard it swirls; negative turns the other way.' },
    reach: { label: 'Reach', type: 'float', min: 0.02, max: 4, step: 0.01, hint: 'The radius where it swirls hardest (0.5: the Particles node\'s).' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const at = sel(node.params.at, ['point', 'mouse', 'hand'], 'point');
    const c = v.centre ?? (at === 'mouse' ? MOUSE : at === 'hand' ? agHandPlace(p(node.params.handX, 0.5), p(node.params.handY, 0.5)) : `vec2(${p(node.params.x, 0)}, ${p(node.params.y, 0)})`);
    const reach = p(node.params.reach, 0.5);
    return {
      code: [
        `    vec2 ${id}_d = ${v.position ?? 'a_pos'} - ${c};\n`,
        `    float ${id}_r = length(${id}_d) + 1e-4;\n`,
        `    vec2 ${id}_f = ${gpSwirl(v.strength ?? p(node.params.strength, 0.3), `${id}_d`, `${id}_r`, `(${reach} * ${reach})`)}${plus(v.also)};\n`,
      ].join(''),
      outputVars: { force: `${id}_f` },
    };
  },
};

/** Central differences of a field function at p, `e` apart: its gradient (vec2), as statements. */
function gradientLines(id: string, fn: string, pos: string, e: string): string[] {
  const at = (q: string) => `${fn}(${q}, vec2(0.0), 1.0, 0.0)`;
  return [
    `    float ${id}_e = ${e};\n`,
    `    vec2 ${id}_gr = vec2(${at(`${pos} + vec2(${id}_e, 0.0)`)} - ${at(`${pos} - vec2(${id}_e, 0.0)`)}, ${at(`${pos} + vec2(0.0, ${id}_e)`)} - ${at(`${pos} - vec2(0.0, ${id}_e)`)}) / (2.0 * ${id}_e);\n`,
  ];
}

export const AgentFlowNode: NodeDefinition = {
  type: 'agentFlow',
  label: 'Flow',
  category: 'Simulation',
  aliases: ['Follow field', 'Flow field', 'Gradient force', 'Along contours'],
  description: 'Pushes walkers along a field wired into Field ƒ (any chain of nodes: noise, a shape\'s distance, a picture\'s brightness): uphill (Slope; negative Strength: downhill) or round its contours (Around). Read where each walker is, every step, with no lag.',
  inputs: {
    field: { type: 'float', label: 'Field ƒ', field: true, hint: 'Any chain of nodes, read as a function of position around each walker.' },
    strength: { type: 'float', label: 'Strength' },
    position: { type: 'vec2', label: 'Position', hint: THIS_AGENT },
    also: ALSO,
  },
  outputs: {
    ...FORCE_OUT,
    value: { type: 'float', label: 'Value', hint: 'The field where the walker is.' },
  },
  defaultParams: { mode: 'slope', strength: 1, step: 0.01 },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', hint: 'Slope: up the field (negative Strength: down it). Around: along its contour lines, circling its hills.', options: [
      { value: 'slope', label: 'Slope' }, { value: 'around', label: 'Around' },
    ] },
    strength: { label: 'Strength', type: 'float', min: -8, max: 8, step: 0.01, hint: 'How hard it pushes.' },
    step: { label: 'Detail', type: 'float', min: 0.001, max: 0.2, step: 0.001, hint: 'How far apart the field is read to find its slope (picture units). Larger smooths fine detail away.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const fn = fieldFn(v.field);
    if (!fn) return { code: `    vec2 ${id}_f = vec2(0.0)${plus(v.also)};\n`, outputVars: { force: `${id}_f`, value: v.field ?? '0.0' } };
    const pos = `${id}_p`;
    const around = sel(node.params.mode, ['slope', 'around'], 'slope') === 'around';
    return {
      code: [
        `    vec2 ${pos} = ${v.position ?? 'a_pos'};\n`,
        ...gradientLines(id, fn, pos, `max(${p(node.params.step, 0.01)}, 1e-4)`),
        `    float ${id}_gl = length(${id}_gr);\n`,
        `    vec2 ${id}_dir = ${around ? `vec2(-${id}_gr.y, ${id}_gr.x)` : `${id}_gr`};\n`,
        `    vec2 ${id}_f = (${id}_gl > 1e-5 ? ${gpFlowPush(`${id}_dir`, `${id}_gl`, v.strength ?? p(node.params.strength, 1))} : vec2(0.0))${plus(v.also)};\n`,
      ].join(''),
      outputVars: { force: `${id}_f`, value: `${fn}(${pos}, vec2(0.0), 1.0, 0.0)` },
    };
  },
};

export const AgentSoundKickNode: NodeDefinition = {
  type: 'agentSoundKick',
  label: 'Sound kick',
  category: 'Simulation',
  aliases: ['Shockwave', 'Beat push', 'Audio force', 'Sound wave', 'Vibrate', 'Shake'],
  description: 'Sound as a force, the Particles node\'s: Shockwave sends a ring of pressure out from the centre on every beat; Wave sends rings as loud as the sound was when they left; Vibrate shivers walkers where the wave is; Shake jitters everything with the level. It listens to Sound from (with a silent stand-in Beat while you build).',
  inputs: {
    centre: { type: 'vec2', label: 'Centre', hint: 'Where the rings start. Wins over X and Y.' },
    strength: { type: 'float', label: 'Strength' },
    position: { type: 'vec2', label: 'Position', hint: THIS_AGENT },
    also: ALSO,
  },
  outputs: {
    ...FORCE_OUT,
    level: { type: 'float', label: 'Level', hint: 'How loud it is now (0…1).' },
    onset: { type: 'float', label: 'Hit', hint: 'How hard the last beat hit, fading away (0…1).' },
  },
  defaultParams: { mode: 'shock', x: 0, y: 0, strength: 1, speed: 1.4, soundFrom: 'graph', level: 0, beat: 0 },
  paramDefs: {
    mode: { label: 'Kick', type: 'select', hint: 'What the sound does.', options: [
      { value: 'shock', label: 'Shockwave (on each beat)' }, { value: 'wave', label: 'Wave (rings as loud as the sound)' },
      { value: 'vibrate', label: 'Vibrate (shiver in the wave)' }, { value: 'shake', label: 'Shake (jitter with the level)' },
    ] },
    x: { label: 'X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the rings start, across.' },
    y: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Where the rings start, up.' },
    strength: { label: 'Strength', type: 'float', min: 0, max: 8, step: 0.01, hint: 'How hard it pushes.' },
    speed: { label: 'Ring speed', type: 'float', min: 0.05, max: 6, step: 0.01, hint: 'How fast the rings travel (picture heights a second, roughly).' },
    ...SOUND_PARAMS,
  },
  assignable: false,
  glslFunctions: [GP_SHADERS.GP_HASH],
  declarationsFor: (node: GraphNode) => {
    const u = listenUniforms(node.id);
    const mode = sel(node.params.mode, ['shock', 'wave', 'vibrate', 'shake'], 'shock');
    return [
      `uniform vec4 ${u.sound};`,
      ...(mode === 'shock' ? [`uniform vec4 ${u.shocks}[4];`] : []),
      ...(mode === 'wave' || mode === 'vibrate' ? [`uniform highp sampler2D ${u.levels};`] : []),
    ];
  },
  // The level history comes in as an argument: helpers are shared by every Sound kick (and named before slugs exist).
  glslFunctionsFor: (node: GraphNode) => {
    const mode = sel(node.params.mode, ['shock', 'wave', 'vibrate', 'shake'], 'shock');
    return mode === 'wave' || mode === 'vibrate' ? [gpLevelGlsl('agLevel', 'levels', 'highp sampler2D levels, ')] : [];
  },
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const u = listenUniforms(id);
    const mode = sel(node.params.mode, ['shock', 'wave', 'vibrate', 'shake'], 'shock');
    const pos = v.position ?? 'a_pos';
    const strength = v.strength ?? p(node.params.strength, 1);
    const speed = `max(${p(node.params.speed, 1.4)}, 0.01)`;
    const centre = v.centre ?? `vec2(${p(node.params.x, 0)}, ${p(node.params.y, 0)})`;
    const lines = [`    vec2 ${id}_f = vec2(0.0);\n`];
    if (mode === 'shock') {
      // Each beat leaves a ring (the engine keeps the last four: where, when, how hard).
      lines.push(
        `    for (int ${id}_j = 0; ${id}_j < 4; ${id}_j++) {\n`,
        `        vec4 ${id}_k = ${u.shocks}[${id}_j];\n`,
        `        float ${id}_age = u_time - ${id}_k.z;\n`,
        `        if (${id}_k.w <= 0.0 || ${id}_age < 0.0 || ${id}_age > 3.0) continue;\n`,
        `        vec2 ${id}_kd = ${pos} - ${v.centre ?? `${id}_k.xy`};\n`,
        `        float ${id}_kr = length(${id}_kd) + 1e-4;\n`,
        `        float ${id}_ring = ${gpShockRing(`${id}_kr`, `${id}_age`, speed)};\n`,
        `        ${id}_f += ${gpShockPush(`${id}_kd`, `${id}_kr`, `(${id}_k.w * ${strength})`, `${id}_ring`, `${id}_age`)};\n`,
        `    }\n`,
      );
    } else if (mode === 'shake') {
      lines.push(
        `    uint ${id}_s = ${rngState(id)};\n`,
        `    ${id}_f = (${gpCrunch(`${id}_s`, `(${strength} * (0.5 * ${u.sound}.x + 0.7 * ${u.sound}.z))`)}).xy;\n`,
      );
    } else {
      lines.push(
        `    vec2 ${id}_sd = ${pos} - ${centre};\n`,
        `    float ${id}_sr = length(${id}_sd) + 1e-4;\n`,
        `    vec3 ${id}_dir = vec3(${id}_sd / ${id}_sr, 0.0);\n`,
        `    float ${id}_lv = agLevel(${u.levels}, ${id}_sr / ${speed});\n`,
        `    float ${id}_ph = ${gpWavePhase(`${id}_sr`, 'u_time', speed)};\n`,
      );
      if (mode === 'wave') lines.push(`    ${id}_f = (${gpWavePush(`${id}_dir`, strength, `${id}_lv`, `${id}_ph`)}).xy;\n`);
      else lines.push(`    uint ${id}_s = ${rngState(id)};\n`, `    ${id}_f = (${gpVibrate(`${id}_dir`, `${id}_s`, strength, `${id}_lv`, `${id}_ph`)}).xy;\n`);
    }
    if (v.also) lines.push(`    ${id}_f += ${v.also};\n`);
    return { code: lines.join(''), outputVars: { force: `${id}_f`, level: `${u.sound}.x`, onset: `${u.sound}.w` } };
  },
};

// ── Moving: Integrate, then the nodes that move the walker directly ───────────

const EDGE_OPTIONS = [
  { value: 'free', label: 'Free (fly off)' }, { value: 'wrap', label: 'Wrap' }, { value: 'bounce', label: 'Bounce' },
  { value: 'slide', label: 'Slide' }, { value: 'kill', label: 'Die' },
];

export const AgentIntegrateNode: NodeDefinition = {
  type: 'agentIntegrate',
  label: 'Integrate',
  category: 'Simulation',
  aliases: ['Physics step', 'Euler', 'Velocity', 'Drag', 'Newton'],
  description: 'Turns the total force into motion, the Particles node\'s way: velocity += Force ÷ Mass × one step, slowed by Drag, capped at Max speed; then position += velocity × one step. At the picture\'s edges: Free, Wrap, Bounce, Slide or Die.',
  inputs: {
    force: { type: 'vec2', label: 'Force', hint: 'The total force: the last force of the chain.' },
    velocity: { type: 'vec2', label: 'Velocity', hint: THIS_AGENT },
    position: { type: 'vec2', label: 'Position', hint: THIS_AGENT },
    drag: { type: 'float', label: 'Drag' },
  },
  outputs: {
    position: { type: 'vec2', label: 'Position', hint: 'Where it ends up: Agent Output\'s Position (or Collide / Chladni first).' },
    velocity: { type: 'vec2', label: 'Velocity', hint: 'Its new velocity: Agent Output\'s Velocity.' },
    heading: { type: 'float', label: 'Heading', hint: 'Which way it moves (radians).' },
    speed: { type: 'float', label: 'Speed' },
    alive: { type: 'float', label: 'Alive', hint: '0 when it left the picture with Edges on Die, else 1: Agent Output\'s Alive.' },
    hit: { type: 'float', label: 'Hit', hint: '1 when it crossed an edge this step.' },
  },
  defaultParams: { drag: 1, maxSpeed: 4, mass: 1, edges: 'free' },
  paramDefs: {
    drag: { label: 'Drag', type: 'float', min: 0, max: 20, step: 0.01, hint: 'How quickly it slows (a share of its speed lost a second, roughly). 1: the Particles node\'s.' },
    maxSpeed: { label: 'Max speed', type: 'float', min: 0, max: 20, step: 0.01, hint: 'Fastest it may go, picture units a second (0: no limit).' },
    mass: { label: 'Mass', type: 'float', min: 0.01, max: 20, step: 0.01, hint: 'Heavier walkers answer forces more slowly.' },
    edges: { label: 'Edges', type: 'select', hint: 'At the edge of the picture.', options: EDGE_OPTIONS },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const edges = sel(node.params.edges, ['free', 'wrap', 'bounce', 'slide', 'kill'], 'free');
    const max = p(node.params.maxSpeed, 4);
    const lines = [
      // Semi-implicit Euler, as the Particles engine: the velocity first, then the position with the new velocity.
      `    vec2 ${id}_v = ${v.velocity ?? 'a_vel'} + ${v.force ?? 'vec2(0.0)'} / max(${p(node.params.mass, 1)}, 1e-3) * a_dt;\n`,
      `    ${id}_v *= exp(-${v.drag ?? p(node.params.drag, 1)} * a_dt);\n`,
      `    float ${id}_sp = length(${id}_v);\n`,
      `    if (${max} > 0.0 && ${id}_sp > ${max}) ${id}_v *= ${max} / ${id}_sp;\n`,
      `    vec2 ${id}_p = ${v.position ?? 'a_pos'} + ${id}_v * a_dt;\n`,
      `    vec2 ${id}_b = vec2(u_resolution.x / u_resolution.y, 1.0);\n`,
      `    float ${id}_hit = any(greaterThan(abs(${id}_p), ${id}_b)) ? 1.0 : 0.0;\n`,
      `    float ${id}_alive = 1.0;\n`,
    ];
    if (edges === 'wrap') lines.push(`    ${id}_p = mod(${id}_p + ${id}_b, 2.0 * ${id}_b) - ${id}_b;\n`);
    else if (edges === 'bounce') {
      lines.push(
        `    if (abs(${id}_p.x) > ${id}_b.x) { ${id}_p.x = sign(${id}_p.x) * (2.0 * ${id}_b.x - abs(${id}_p.x)); ${id}_v.x = -${id}_v.x; }\n`,
        `    if (abs(${id}_p.y) > ${id}_b.y) { ${id}_p.y = sign(${id}_p.y) * (2.0 * ${id}_b.y - abs(${id}_p.y)); ${id}_v.y = -${id}_v.y; }\n`,
      );
    } else if (edges === 'slide') {
      lines.push(
        `    if (abs(${id}_p.x) > ${id}_b.x) ${id}_v.x = 0.0;\n`,
        `    if (abs(${id}_p.y) > ${id}_b.y) ${id}_v.y = 0.0;\n`,
        `    ${id}_p = clamp(${id}_p, -${id}_b, ${id}_b);\n`,
      );
    } else if (edges === 'kill') lines.push(`    ${id}_alive = 1.0 - ${id}_hit;\n`);
    lines.push(`    float ${id}_h = length(${id}_v) > 1e-6 ? atan(${id}_v.y, ${id}_v.x) : a_heading;\n`);
    return {
      code: lines.join(''),
      outputVars: { position: `${id}_p`, velocity: `${id}_v`, heading: `${id}_h`, speed: `length(${id}_v)`, alive: `${id}_alive`, hit: `${id}_hit` },
    };
  },
};

export const AgentAgeNode: NodeDefinition = {
  type: 'agentAge',
  label: 'Age / Life',
  category: 'Simulation',
  aliases: ['Life', 'Lifetime', 'Fade', 'Die'],
  description: 'How old the walker is against how long it lives. Alive goes to 0 when its Life runs out (Agent Output\'s Alive), and an Emit set to Keep full gives it a new life at once. Age 0–1 and Fade are handy for colour and size.',
  inputs: {
    age: { type: 'float', label: 'Age', hint: THIS_AGENT },
    life: { type: 'float', label: 'Life', hint: 'How long it lives (seconds). ' + THIS_AGENT },
  },
  outputs: {
    alive: { type: 'float', label: 'Alive', hint: '1 while Age is under Life × Live for, else 0: Agent Output\'s Alive.' },
    age: { type: 'float', label: 'Age', hint: 'Seconds since it was born.' },
    unit: { type: 'float', label: 'Age 0–1', hint: 'Age as a share of its life (0 for walkers that live for ever).' },
    fade: { type: 'float', label: 'Fade', hint: 'Fades in at birth and out toward the end of its life (the Particles node\'s curve).' },
  },
  defaultParams: { span: 1 },
  paramDefs: {
    span: { label: 'Live for', type: 'float', min: 0.01, max: 4, step: 0.01, hint: 'Its life as a share of what Emit gave it (0.5: half as long).' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    return {
      code: [
        `    float ${id}_age = ${v.age ?? 'a_age'};\n`,
        `    float ${id}_life = ${v.life ?? 'a_life'} * max(${p(node.params.span, 1)}, 1e-3);\n`,
        `    float ${id}_u = ${id}_life > 1.0e20 ? 0.0 : clamp(${id}_age / max(${id}_life, 1e-4), 0.0, 1.0);\n`,
      ].join(''),
      outputVars: {
        alive: `(${id}_age < ${id}_life ? 1.0 : 0.0)`,
        age: `${id}_age`,
        unit: `${id}_u`,
        fade: `(${id}_life > 1.0e20 ? 1.0 : ${gpFade(`${id}_u`)})`,
      },
    };
  },
};

export const AgentCollideNode: NodeDefinition = {
  type: 'agentCollide',
  label: 'Collide',
  category: 'Simulation',
  aliases: ['Obstacle', 'Slide around', 'SDF collide', 'Walls'],
  description: 'Keeps walkers out of a shape: wire its distance (any SDF chain) into Shape ƒ. A walker that touches it is put back on its surface, loses the part of its velocity going in, and slides round it; a cushion just outside parts a stream before it touches. Goes after Integrate (Position and Velocity), the Particles node\'s Obstacle.',
  inputs: {
    shape: { type: 'float', label: 'Shape ƒ', field: true, hint: 'A signed distance: negative inside the shape (an SDF node\'s Distance).' },
    position: { type: 'vec2', label: 'Position', hint: 'Integrate\'s Position. ' + THIS_AGENT },
    velocity: { type: 'vec2', label: 'Velocity', hint: 'Integrate\'s Velocity. ' + THIS_AGENT },
  },
  outputs: {
    position: { type: 'vec2', label: 'Position' },
    velocity: { type: 'vec2', label: 'Velocity' },
    hit: { type: 'float', label: 'Hit', hint: '1 when it touched the shape this step.' },
    distance: { type: 'float', label: 'Distance', hint: 'How far from the shape it is.' },
  },
  defaultParams: { margin: 0.012, cushion: 0.08, bounce: 0, friction: 0.03 },
  paramDefs: {
    margin: { label: 'Margin', type: 'float', min: 0, max: 0.2, step: 0.001, hint: 'How close to the surface they may come (picture units).' },
    cushion: { label: 'Cushion', type: 'float', min: 0, max: 0.5, step: 0.001, hint: 'How far out a stream starts to part (0: none).' },
    bounce: { label: 'Bounce', type: 'float', min: 0, max: 1, step: 0.01, hint: '0 slides along the surface; 1 bounces off as fast as it came.' },
    friction: { label: 'Friction', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Speed lost on each touch (0.03: the Particles node\'s).' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const pos = v.position ?? 'a_pos', vel = v.velocity ?? 'a_vel';
    const fn = fieldFn(v.shape);
    if (!fn) return { code: '', outputVars: { position: pos, velocity: vel, hit: '0.0', distance: v.shape ?? '1.0e3' } };
    const margin = p(node.params.margin, 0.012), cushion = p(node.params.cushion, 0.08);
    return {
      code: [
        `    vec2 ${id}_p = ${pos};\n`,
        `    vec2 ${id}_v = ${vel};\n`,
        `    float ${id}_dd = ${fn}(${id}_p, vec2(0.0), 1.0, 0.0);\n`,
        ...gradientLines(id, fn, `${id}_p`, '0.002'),
        `    float ${id}_gl = length(${id}_gr);\n`,
        `    vec2 ${id}_n = ${id}_gl > 1e-6 ? ${id}_gr / ${id}_gl : vec2(0.0);\n`,
        `    float ${id}_hit = 0.0;\n`,
        `    if (${id}_dd < ${margin} && ${id}_gl > 1e-6) {\n`,
        // Out to the surface, the inward part of the velocity gone (or turned round by Bounce), a little friction.
        `        ${id}_p += ${id}_n * (${margin} - ${id}_dd);\n`,
        `        float ${id}_vn = dot(${id}_v, ${id}_n);\n`,
        `        if (${id}_vn < 0.0) ${id}_v -= (1.0 + ${p(node.params.bounce, 0)}) * ${id}_vn * ${id}_n;\n`,
        `        ${id}_v *= 1.0 - ${p(node.params.friction, 0.03)};\n`,
        `        ${id}_hit = 1.0;\n`,
        `    } else if (${id}_dd < ${cushion} && ${id}_gl > 1e-6) {\n`,
        // A cushion just outside, so a stream parts before it touches.
        `        ${id}_v += ${id}_n * (${cushion} - ${id}_dd) * 6.0 * a_dt;\n`,
        `    }\n`,
      ].join(''),
      outputVars: { position: `${id}_p`, velocity: `${id}_v`, hit: `${id}_hit`, distance: `${id}_dd` },
    };
  },
};

/** The plate function for a shape and symmetry (shared by every Chladni node of that kind). */
const plateFn = (round: boolean, plus: boolean) => `agPlate${round ? 'Round' : 'Square'}${plus ? 'Plus' : 'Minus'}`;

export const AgentChladniNode: NodeDefinition = {
  type: 'agentChladni',
  label: 'Chladni',
  category: 'Simulation',
  aliases: ['Chladni plate', 'Sand on a plate', 'Cymatics', 'Nodal lines'],
  description: 'Sand on a vibrating plate, the Particles node\'s Pattern: walkers slide to the plate\'s still lines and are shaken off everywhere else, drawing a Chladni figure. N and M pick the figure, or the sound does (Mode from). Goes after Integrate (Position and Velocity), or straight into Agent Output.',
  inputs: {
    position: { type: 'vec2', label: 'Position', hint: THIS_AGENT },
    velocity: { type: 'vec2', label: 'Velocity', hint: THIS_AGENT },
  },
  outputs: {
    position: { type: 'vec2', label: 'Position' },
    velocity: { type: 'vec2', label: 'Velocity' },
    plate: { type: 'float', label: 'Plate', hint: 'How far the plate moves here (0 on the still lines).' },
  },
  defaultParams: { shape: 'square', symmetry: 'minus', modeFrom: 'manual', modeN: 3, modeM: 5, modes: 1, plateFreq: 1, plateWeights: 0.5, size: 0.9, x: 0, y: 0, settle: 1, shake: 0.6, soundFrom: 'graph', level: 0, beat: 0 },
  paramDefs: {
    shape: { label: 'Plate', type: 'select', hint: 'Square or round.', options: [{ value: 'square', label: 'Square' }, { value: 'circle', label: 'Round' }] },
    symmetry: { label: 'Symmetry', type: 'select', hint: 'Which of a mode\'s two figures (minus or plus).', options: [{ value: 'minus', label: 'Minus' }, { value: 'plus', label: 'Plus' }] },
    modeFrom: { label: 'Mode from', type: 'select', hint: 'N and M, or the sound (each beat steps the figure on).', options: [{ value: 'manual', label: 'N and M' }, { value: 'sound', label: 'Sound' }] },
    modeN: { label: 'N', type: 'float', min: 0, max: 15, step: 1, hint: 'The figure: lines across (square) or spokes (round).' },
    modeM: { label: 'M', type: 'float', min: 0, max: 15, step: 1, hint: 'The figure: lines down (square) or rings (round).' },
    modes: { label: 'Modes', type: 'float', min: 1, max: 8, step: 1, hint: 'How many figures are summed (1: a pure one).' },
    plateFreq: { label: 'Frequency', type: 'float', min: 0.25, max: 4, step: 0.01, hint: 'Higher figures (finer lines).' },
    plateWeights: { label: 'Weights', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much the extra figures weigh.' },
    size: { label: 'Size', type: 'float', min: 0.05, max: 2, step: 0.01, hint: 'Half the plate\'s width (picture units).' },
    x: { label: 'X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'The plate\'s centre, across.' },
    y: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01, hint: 'The plate\'s centre, up.' },
    settle: { label: 'Settle', type: 'float', min: 0, max: 10, step: 0.01, hint: 'How fast sand slides to the lines.' },
    shake: { label: 'Shake', type: 'float', min: 0, max: 10, step: 0.01, hint: 'How hard the plate shakes the sand (harder with the sound).' },
    ...SOUND_PARAMS,
  },
  assignable: false,
  glslFunctions: [GP_SHADERS.GP_HASH],
  declarationsFor: (node: GraphNode) => {
    const u = listenUniforms(node.id);
    return [
      `uniform vec4 ${u.plateModes}[8];`, `uniform int ${u.plateCount};`, `uniform float ${u.plateShake};`,
      ...(sel(node.params.shape, ['square', 'circle'], 'square') === 'circle' ? [`uniform highp sampler2D ${AG_BESSEL_UNIFORM};`] : []),
    ];
  },
  // One plate function for each shape and symmetry, shared by every Chladni node: its modes come in as arguments.
  glslFunctionsFor: (node: GraphNode) => {
    const round = sel(node.params.shape, ['square', 'circle'], 'square') === 'circle';
    const plus = sel(node.params.symmetry, ['minus', 'plus'], 'minus') === 'plus';
    const plate = gpPlateGlsl(plateFn(round, plus), { count: 'count', modes: 'modes', shape: round ? '2' : '1', sym: plus ? '1' : '0', J: round ? 'agJ' : 'agJNone', args: ', int count, vec4 modes[8]' });
    // A square plate never reaches the round branch, but it still compiles: a J_n that is 0 stands in.
    return [round ? gpBesselGlsl('agJ', AG_BESSEL_UNIFORM) : 'float agJNone(float n, float x) { return 0.0; }', plate];
  },
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const u = listenUniforms(id);
    const round = sel(node.params.shape, ['square', 'circle'], 'square') === 'circle';
    const centre = `vec2(${p(node.params.x, 0)}, ${p(node.params.y, 0)})`;
    const plus = sel(node.params.symmetry, ['minus', 'plus'], 'minus') === 'plus';
    const step = gpPlateStep('        ', {
      half: `max(${p(node.params.size, 0.9)}, 0.02)`, plate: plateFn(round, plus), settle: p(node.params.settle, 1),
      shake: u.plateShake, dt: 'a_dt', shape: round ? '2' : '1', s: `${id}_s`, args: `, ${u.plateCount}, ${u.plateModes}`,
    });
    return {
      code: [
        `    vec2 ${id}_p = ${v.position ?? 'a_pos'};\n`,
        `    vec2 ${id}_v = ${v.velocity ?? 'a_vel'};\n`,
        `    float ${id}_u = 0.0;\n`,
        `    {\n`,
        `        uint ${id}_s = ${rngState(id)};\n`,
        `        vec2 c = ${id}_p - ${centre};\n`,
        `${step}\n`,
        `        ${id}_u = a0;\n`,
        `        ${id}_p = ${centre} + c;\n`,
        `    }\n`,
        // The sand's own flight dies away fast on the plate.
        `    ${id}_v *= exp(-6.0 * a_dt);\n`,
      ].join(''),
      outputVars: { position: `${id}_p`, velocity: `${id}_v`, plate: `${id}_u` },
    };
  },
};
