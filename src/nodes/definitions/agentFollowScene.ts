/**
 * agentFollowScene.ts — Follow surface (3D Scene) (docs/combine-plan.md §2.4): walkers that stay on a ray-marched
 * scene's surfaces and move along them. It reads the Scene the way Collide (3D Scene) does, on the Particles node's
 * coarse 48³ grid of its distance (filled every step by the engine: compiler/agentGraph.ts `grids`), so the update
 * shader never marches or evaluates the scene.
 *
 * Each step, at the walker's place on the grid: the surface's normal from the grid's slope; the velocity kept along
 * the surface (its part going in or out taken off) and steered toward the mode's direction:
 *
 *   Cling   its own way along the surface, at Speed (a walker standing still picks a way round the Axis);
 *   Around  round the Axis (a line through the grid's centre), the way a ring of walkers circles a shape;
 *   Along   the Axis's direction, flowing over the surface (up and over, round the sides). Where the surface faces
 *           the Axis (its top) the pull lets go and they lift off; leaving the grid that way they come back in at its
 *           other side, so the stream keeps flowing instead of pooling on the top.
 *
 * Then a step, and a pull back onto the surface at Offset (a share of the gap a step, at most 0.15, so a walker born
 * far off comes in over a few frames). Outside the grid there is no surface: it heads for the grid's centre.
 * In a 2D group it passes the walker through, as Collide (3D Scene) does.
 *
 * `followSceneStep` is the same maths in JS, for the tests.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';
import { isAgent3d } from './agents';
import { sceneGridUniforms } from './agentForces';
import { GP_VOL, gpVolAtGlsl } from '../../play/kit/gpuParticles.js';

const THIS_AGENT = 'Unwired: this walker\'s own (the card shows "← this walker\'s …").';

export type FollowMode = 'cling' | 'around' | 'along';
export const FOLLOW_MODES: readonly FollowMode[] = ['cling', 'around', 'along'];
export type FollowAxis = 'x' | 'y' | 'z';
const AXIS_VEC: Record<FollowAxis, [number, number, number]> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const sel = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : d);

export const AgentFollowSceneNode: NodeDefinition = {
  type: 'agentFollowScene',
  label: 'Follow surface (3D Scene)',
  category: 'Simulation',
  aliases: ['Follow surface', 'Follow the shape 3D', 'Cling to a scene', 'Crawl on a surface', 'Surface walkers', 'Orbit a scene', 'Flow over a shape'],
  description: 'In a 3D group: walkers that stay on a ray-marched scene\'s surfaces and move along them: Cling (their own way), Around (circling an axis) or Along (flowing one way over it). Wire a Scene Group\'s Scene into the group (a Scene port) and that port into Scene. The scene is read on the same coarse 48³ grid Collide (3D Scene) uses, so it costs almost nothing. Its Position, Velocity and Heading go to Agent Output.',
  inputs: {
    scene: { type: 'scene3d', label: 'Scene', hint: 'A Scene Group\'s Scene, through a port added to the group (Agent Inputs → + Add an input from outside → Scene).' },
    position: { type: 'vec3', label: 'Position', hint: THIS_AGENT },
    velocity: { type: 'vec3', label: 'Velocity', hint: THIS_AGENT },
    speed: { type: 'float', label: 'Speed', hint: 'Overrides Speed; each walker\'s variation still applies.' },
    offset: { type: 'float', label: 'Offset', hint: 'Overrides Offset: wire a beat or an LFO to make the shell breathe.' },
  },
  outputs: {
    position: { type: 'vec3', label: 'Position', hint: 'On the surface, Offset out from it: Agent Output\'s Position.' },
    velocity: { type: 'vec3', label: 'Velocity', hint: 'Along the surface: Agent Output\'s Velocity.' },
    heading: { type: 'vec3', label: 'Heading', hint: 'Which way it goes (a unit vector): Agent Output\'s Heading.' },
    distance: { type: 'float', label: 'Distance', hint: 'How far from the surface it is (from the grid; 1000 outside it).' },
    along: { type: 'float', label: 'Along', hint: 'The angle round the Axis, 0–1: colour round the shape with it.' },
  },
  defaultParams: { mode: 'around', axis: 'y', offset: 0.06, speed: 0.4, speedVar: 0.3, steer: 0.15, pull: 0.35, reach: 2, x: 0, y: 0, z: 0 },
  paramDefs: {
    mode: { section: 'Follow', label: 'Mode', type: 'select', hint: 'Cling: each its own way along the surface. Around: circling the Axis. Along: flowing the Axis\'s way over the surface.', options: [
      { value: 'cling', label: 'Cling' }, { value: 'around', label: 'Around' }, { value: 'along', label: 'Along' },
    ] },
    axis: { section: 'Follow', label: 'Axis', type: 'select', hint: 'Around: the axis they circle (through the grid\'s centre). Along: the way they flow.', options: [
      { value: 'y', label: 'Up (Y)' }, { value: 'x', label: 'Across (X)' }, { value: 'z', label: 'Depth (Z)' },
    ] },
    offset: { section: 'Follow', label: 'Offset', type: 'float', min: -0.5, max: 2, step: 0.001, hint: 'How far out from the surface they ride (scene units): 0 on it, more a shell round it.' },
    speed: { section: 'Follow', label: 'Speed', type: 'float', min: -4, max: 4, step: 0.01, hint: 'Scene units a second along the surface. Negative goes the other way round.' },
    speedVar: { section: 'Follow', label: 'Speed variation', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much each walker\'s speed differs: 0.3 each ±30%.' },
    steer: { section: 'Follow', label: 'Steer', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How quickly a walker turns to the mode\'s way each step: 1 at once, small keeps some of its own drift.' },
    pull: { section: 'Follow', label: 'Pull', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much of the gap to the surface (at Offset) is closed each step: 1 snaps on, small drifts in.' },
    reach: { section: 'Grid', label: 'Scene size', type: 'float', min: 0.2, max: 20, step: 0.05, hint: 'How far from the centre the scene is felt (scene units): the grid spans twice this, 48 cells across. Keep it just big enough to hold the shapes.' },
    x: { section: 'Grid', label: 'X', type: 'float', min: -10, max: 10, step: 0.01, hint: 'The grid\'s centre, across.' },
    y: { section: 'Grid', label: 'Y', type: 'float', min: -10, max: 10, step: 0.01, hint: 'The grid\'s centre, up.' },
    z: { section: 'Grid', label: 'Z', type: 'float', min: -10, max: 10, step: 0.01, hint: 'The grid\'s centre, in depth.' },
  },
  assignable: false,
  declarationsFor: (node: GraphNode) => {
    const u = sceneGridUniforms(node.id);
    return [`uniform highp sampler2D ${u.grid};`, `uniform vec4 ${u.at};`];
  },
  glslFunctions: [gpVolAtGlsl('agSceneAt', 's', 'highp sampler2D s, ')],
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const pos = v.position ?? 'a_pos', vel = v.velocity ?? 'a_vel';
    // In a 2D group it does nothing (the compiler says so on the card).
    if (!isAgent3d(node)) return { code: '', outputVars: { position: pos, velocity: vel, heading: 'a_heading', distance: '1.0e3', along: '0.0' } };
    const u = sceneGridUniforms(id);
    const at = (q: string) => `agSceneAt(${u.grid}, ${q})`;
    const cells = (x: string) => `((${x} - ${u.at}.xyz) / max(${u.at}.w, 1e-3) * 0.5 + 0.5) * ${GP_VOL}.0`;
    const inGrid = (q: string) => `(all(greaterThan(${q}, vec3(0.0))) && all(lessThan(${q}, vec3(${GP_VOL}.0))))`;
    const mode = sel(P.mode, FOLLOW_MODES, 'around');
    const [ax, ay, az] = AXIS_VEC[sel(P.axis, ['x', 'y', 'z'] as const, 'y')];
    const axis = `vec3(${ax.toFixed(1)}, ${ay.toFixed(1)}, ${az.toFixed(1)})`;
    // Two directions across the axis, for Along's angle (and a way round for a walker that stands still).
    const across = ay ? ['vec3(1.0, 0.0, 0.0)', 'vec3(0.0, 0.0, 1.0)'] : ax ? ['vec3(0.0, 0.0, 1.0)', 'vec3(0.0, 1.0, 0.0)'] : ['vec3(1.0, 0.0, 0.0)', 'vec3(0.0, 1.0, 0.0)'];
    const along = mode === 'along';
    const want = along
      ? `${id}_A - ${id}_n * dot(${id}_A, ${id}_n) * (1.0 - ${id}_lift)`
      : mode === 'around'
        ? `cross(${id}_A, ${id}_n)`
        : `${id}_vt`;
    const lines = [
      `    // Follow surface (3D Scene): along the scene's surface (its 48³ grid), ${mode === 'cling' ? 'each its own way' : mode === 'around' ? 'round the axis' : 'the axis\'s way'}, pulled back to Offset.\n`,
      `    vec3 ${id}_p = ${pos};\n`,
      `    vec3 ${id}_v = ${vel};\n`,
      `    float ${id}_dd = 1.0e3;\n`,
      `    {\n`,
      `      vec3 ${id}_A = ${axis};\n`,
      `      uint ${id}_r = agHash(uint(a_index) ^ 0x51A7E3C1u);\n`,
      `      float ${id}_sp = ${v.speed ?? p(P.speed, 0.4)} * (1.0 + ${p(P.speedVar, 0.3)} * (2.0 * agRnd(${id}_r) - 1.0));\n`,
      `      float ${id}_off = ${v.offset ?? p(P.offset, 0.06)};\n`,
      `      vec3 ${id}_q = ${cells(`${id}_p`)};\n`,
      `      if (${inGrid(`${id}_q`)}) {\n`,
      // The surface's normal: the grid's slope, a cell either side.
      `        vec3 ${id}_gr = vec3(${at(`${id}_q + vec3(1.0, 0.0, 0.0)`)} - ${at(`${id}_q - vec3(1.0, 0.0, 0.0)`)}, ${at(`${id}_q + vec3(0.0, 1.0, 0.0)`)} - ${at(`${id}_q - vec3(0.0, 1.0, 0.0)`)}, ${at(`${id}_q + vec3(0.0, 0.0, 1.0)`)} - ${at(`${id}_q - vec3(0.0, 0.0, 1.0)`)});\n`,
      `        vec3 ${id}_n = length(${id}_gr) > 1e-6 ? normalize(${id}_gr) : vec3(0.0, 1.0, 0.0);\n`,
      // Its own velocity along the surface (in or out taken off); a walker standing still goes round the axis.
      `        vec3 ${id}_vt = ${id}_v - ${id}_n * dot(${id}_v, ${id}_n);\n`,
      `        if (length(${id}_vt) < 1e-4) ${id}_vt = cross(${id}_A, ${id}_n) + 1e-3 * ${across[0]};\n`,
      // Along: where the surface faces the axis (its top) it lets go, so they lift off rather than pool there.
      `        float ${id}_lift = ${along ? `smoothstep(0.7, 0.95, dot(${id}_n, ${id}_A))` : '0.0'};\n`,
      ...(along ? [`        if (${id}_lift > 0.0) ${id}_vt += ${id}_n * dot(${id}_v, ${id}_n) * ${id}_lift;\n`] : []),
      `        vec3 ${id}_w = ${want};\n`,
      `        if (length(${id}_w) < 1e-4) ${id}_w = ${id}_vt;\n`,
      // Steered toward the mode's way, at its speed.
      `        ${id}_v = mix(${id}_vt, normalize(${id}_w) * ${id}_sp, clamp(${p(P.steer, 0.15)}, 0.0, 1.0));\n`,
      `        ${id}_p += ${id}_v * a_dt;\n`,
      // Back onto the surface at Offset: a share of the gap (Pull), at most 0.15 a step.
      `        vec3 ${id}_q2 = ${cells(`${id}_p`)};\n`,
      `        ${id}_dd = ${at(`${id}_q2`)};\n`,
      `        ${id}_p -= ${id}_n * clamp((${id}_dd - ${id}_off) * clamp(${p(P.pull, 0.35)}, 0.0, 1.0), -0.15, 0.15) * (1.0 - ${id}_lift);\n`,
      // Along: out of the grid's far side, back in at its near side (the stream comes round again).
      ...(along ? [`        if (dot(${id}_p - ${u.at}.xyz, ${id}_A) > 0.9 * ${u.at}.w) ${id}_p -= ${id}_A * 1.8 * ${u.at}.w;\n`] : []),
      `      } else {\n`,
      // Outside the grid there is no surface: head for its centre.
      `        vec3 ${id}_to = ${u.at}.xyz - ${id}_p;\n`,
      `        ${id}_v = mix(${id}_v, (length(${id}_to) > 1e-6 ? normalize(${id}_to) : vec3(0.0)) * abs(${id}_sp), 0.05);\n`,
      `        ${id}_p += ${id}_v * a_dt;\n`,
      `      }\n`,
      `    }\n`,
      `    vec3 ${id}_h = length(${id}_v) > 1e-6 ? normalize(${id}_v) : a_dir;\n`,
      `    vec3 ${id}_rel = ${id}_p - ${u.at}.xyz;\n`,
      `    float ${id}_along = fract(atan(dot(${id}_rel, ${across[1]}), dot(${id}_rel, ${across[0]})) / 6.2831853 + 0.5);\n`,
    ];
    return { code: lines.join(''), outputVars: { position: `${id}_p`, velocity: `${id}_v`, heading: `${id}_h`, distance: `${id}_dd`, along: `${id}_along` } };
  },
};

// ── The same maths in JS (tests) ─────────────────────────────────────────────

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => (len(a) > 1e-9 ? mul(a, 1 / len(a)) : [0, 0, 0]);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix = (a: V3, b: V3, t: number): V3 => add(mul(a, 1 - t), mul(b, t));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface FollowStepParams { mode: FollowMode; axis: FollowAxis; offset: number; speed: number; steer: number; pull: number; dt: number; reach?: number }

/**
 * One step of Follow surface on a distance function `sdf` (the grid read exactly, its slope a small step either
 * side): the velocity kept along the surface and steered to the mode's way, a step, and the pull back to Offset
 * (Along: let go at the top, back round from the grid's far side). The grid's centre is 0; each walker's own speed
 * variation is left out (speedVar 0).
 */
export function followSceneStep(pos: V3, vel: V3, sdf: (q: V3) => number, o: FollowStepParams): { p: V3; v: V3; d: number } {
  const e = 1e-3;
  const gr: V3 = [sdf([pos[0] + e, pos[1], pos[2]]) - sdf([pos[0] - e, pos[1], pos[2]]), sdf([pos[0], pos[1] + e, pos[2]]) - sdf([pos[0], pos[1] - e, pos[2]]), sdf([pos[0], pos[1], pos[2] + e]) - sdf([pos[0], pos[1], pos[2] - e])];
  const n = len(gr) > 1e-9 ? norm(gr) : [0, 1, 0] as V3;
  const A = AXIS_VEC[o.axis];
  let vt = sub(vel, mul(n, dot(vel, n)));
  if (len(vt) < 1e-4) vt = add(cross(A, n), [1e-3, 0, 0]);
  const t = clamp((dot(n, A) - 0.7) / 0.25, 0, 1);
  const lift = o.mode === 'along' ? t * t * (3 - 2 * t) : 0;
  if (lift > 0) vt = add(vt, mul(n, dot(vel, n) * lift));
  let w = o.mode === 'along' ? sub(A, mul(n, dot(A, n) * (1 - lift))) : o.mode === 'around' ? cross(A, n) : vt;
  if (len(w) < 1e-4) w = vt;
  const v = mix(vt, mul(norm(w), o.speed), clamp(o.steer, 0, 1));
  let p = add(pos, mul(v, o.dt));
  const d = sdf(p);
  p = sub(p, mul(n, clamp((d - o.offset) * clamp(o.pull, 0, 1), -0.15, 0.15) * (1 - lift)));
  if (o.mode === 'along' && dot(p, A) > 0.9 * (o.reach ?? 2)) p = sub(p, mul(A, 1.8 * (o.reach ?? 2)));
  return { p, v, d };
}
