/**
 * agentRideCurve.ts — Ride a curve (docs/agents-group.md "Ride a curve"): walkers locked onto a
 * parametric curve, each carrying its own place along it.
 *
 * The curve is Curve Trace's (curveTrace.ts: per-axis waves or Custom GLSL in t, Lateral / Rotary /
 * Counter motion, Damping, Turns, Morph to the B frequencies), built by the same `curvePoint`. Agents
 * are "push": each walker knows its own state, so it keeps its parameter in Memory.x, advances it by
 * its speed every step and stands at curve(t). That is three evaluations of the curve per walker
 * (the point, and either side of it for the tangent): no search over segments, no buffer.
 *
 * Memory.x holds the walker's place along the curve plus 1 (0 means "not on the curve yet": a walker
 * just born, or one that was there before the node was), so its first step puts it at its Spread place.
 * Memory.y passes through untouched, for the rest of the rule. When Agent Output's Memory is left
 * unwired, the compiler routes this node's Memory there by itself (compiler/agentGraph.ts), so a ride
 * keeps going with only Position wired.
 *
 * The velocity is the curve's tangent × the walker's speed (t a second × dp/dt), so Draw agents'
 * streaks, colour by speed and heading, and Deposit's velocity trail all see real motion; the
 * Ribbon offset moves each walker across the curve's normal (in 3D, round a tube of that radius).
 */
import type { GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { p } from './helpers';
import { axisDefaults, axisParams, COMMON_PARAMS, curvePoint, type Axis } from './curveTrace';
import { isAgent3d } from './agents';

const in3d = { param: 'agentSpace', value: '3d' };
const sel = (v: unknown, allowed: string[], fallback: string) => (typeof v === 'string' && allowed.includes(v) ? v : fallback);

/** Curve Trace's settings this node shares (same names, so its helpers read them as they are). */
function curveParams(): Record<string, ParamDef> {
  const c = COMMON_PARAMS({ def: 0, max: 1 }, 16);
  const pick = (k: string, extra: Partial<ParamDef> = {}): ParamDef => ({ ...c[k], ...extra });
  // Z only in a 3D group (the 2D picture has no depth).
  const z = Object.fromEntries(Object.entries(axisParams('Z')).map(([k, d]) => [k, { ...d, showWhen: in3d, hint: `3D: ${d.hint}` }]));
  return {
    mode: pick('mode'),
    turns: pick('turns', { hint: 't runs from 0 to Turns × 2π: the length of the ride. One turn closes any whole-number figure; more turns for Damping spirals or non-whole ratios.' }),
    damping: pick('damping', { hint: 'The waves shrink as t runs (exp(−Damping × t)): a harmonograph spiral, an open curve (Loop: Ping-pong or Respawn suit it). Use more Turns.' }),
    ...axisParams('X'),
    ...axisParams('Y'),
    ...z,
    morphOn: pick('morphOn'),
    morph: pick('morph'),
    freqXB: pick('freqXB'),
    freqYB: pick('freqYB'),
    freqZB: { section: 'Morph', label: 'Z frequency B', type: 'float', min: 0, max: 20, step: 0.01, showWhen: in3d, hint: '3D: Z frequency of the figure it morphs into.' },
  };
}

const SPEED_HELP = 'Turns a second: one turn is 2π of t, the whole figure when Turns is 1. 0.05 goes round in 20 s. Negative goes the other way.';

export const AgentRideCurveNode: NodeDefinition = {
  type: 'agentRideCurve',
  label: 'Ride a curve',
  category: 'Simulation',
  aliases: ['Curve ride', 'Follow a curve', 'Ride curve', 'Lissajous walkers', 'Harmonograph walkers', 'On a curve'],
  description: 'Locks walkers onto a parametric curve (Curve Trace\'s: Lissajous, harmonograph, rose, your own GLSL in t). Each walker keeps its own place along it in Memory, moves by its own speed, and sits across the curve within Ribbon width, so they flow as a band. Position, Velocity (the tangent × speed) and Heading go to Agent Output.',
  inputs: {
    speed: { type: 'float', label: 'Speed', hint: 'Overrides Speed (turns a second); each walker\'s variation still applies.' },
    width: { type: 'float', label: 'Ribbon width', hint: 'Overrides Ribbon width.' },
    morph: { type: 'float', label: 'Morph amount', hint: 'Overrides Morph amount (Morph on): wire an LFO to flow between the two figures.' },
    freqX: { type: 'float', label: 'X frequency', hint: 'Overrides X frequency.' },
    freqY: { type: 'float', label: 'Y frequency', hint: 'Overrides Y frequency.' },
    phaseX: { type: 'float', label: 'X phase', hint: 'Overrides X phase: wire Time (× a speed) to make the figure turn.' },
    phaseY: { type: 'float', label: 'Y phase', hint: 'Overrides Y phase.' },
    time: { type: 'float', label: 'Time', hint: 'The time a Custom formula reads as `time`. Unwired: the simulation\'s clock.' },
    memory: { type: 'vec2', label: 'Memory', hint: 'Where the walker is along the curve is kept in Memory.x (y passes through). Unwired: this walker\'s own Memory.' },
  },
  outputs: {
    position: { type: 'vec2', label: 'Position', hint: 'On the curve, offset across it within Ribbon width: Agent Output\'s Position.' },
    velocity: { type: 'vec2', label: 'Velocity', hint: 'The curve\'s tangent × the walker\'s speed (picture units a second): Agent Output\'s Velocity, for streaks and colour by speed.' },
    heading: { type: 'float', label: 'Heading', hint: 'Which way it rides (along the tangent).' },
    speed: { type: 'float', label: 'Speed', hint: 'How fast it moves, picture units a second: fast where the curve stretches, slow at its turns.' },
    along: { type: 'float', label: 'Along', hint: 'Where on the curve it is: 0 at the start, 1 at the end (Turns × 2π). Colour along the curve with it.' },
    memory: { type: 'vec2', label: 'Memory', hint: 'Its place along the curve for next step (x), y as it came in: Agent Output\'s Memory. Left unwired there, it goes there by itself.' },
  },
  defaultParams: {
    speed: 0.05, speedVar: 0.3, direction: 'one', spread: 'random', spreadOver: 1, width: 0.04, wander: 0, wanderRate: 0.25, loop: 'wrap',
    mode: 'lateral', turns: 1, damping: 0, morphOn: false, morph: 0, freqXB: 5, freqYB: 4, freqZB: 7,
    ...axisDefaults('X', { freq: 3, phase: 1.5708, amp: 0.9 }, 'sin(3.0 * t)'),
    ...axisDefaults('Y', { freq: 2, phase: 0, amp: 0.7 }, 'sin(2.0 * t)'),
    ...axisDefaults('Z', { freq: 5, phase: 0.7854, amp: 0.5 }, 'sin(5.0 * t)'),
  },
  paramDefs: {
    speed: { section: 'Ride', label: 'Speed', type: 'float', min: -1, max: 1, step: 0.001, hint: SPEED_HELP },
    speedVar: { section: 'Ride', label: 'Speed variation', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much each walker\'s speed differs: 0 all the same (they keep their spacing), 0.3 each ±30%, so they drift past each other.' },
    direction: { section: 'Ride', label: 'Direction', type: 'select', options: [
      { value: 'one', label: 'All one way' }, { value: 'both', label: 'Random: both ways' },
    ], hint: 'All one way, or each walker picks a way at random (half go backward): two streams through each other.' },
    spread: { section: 'Ride', label: 'Spread', type: 'select', options: [
      { value: 'random', label: 'Random places' }, { value: 'even', label: 'Evenly spaced (by Index)' },
    ], hint: 'Where each walker starts along the curve: at random, or evenly spaced in Index order (a smooth, even band).' },
    spreadOver: { section: 'Ride', label: 'Spread over', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much of the curve they start over: 1 the whole curve, 0 all at the start (a stream that leaves together).' },
    width: { section: 'Ride', label: 'Ribbon width', type: 'float', min: 0, max: 0.5, step: 0.001, hint: 'Half the band\'s width, picture units: each walker rides this far (at most) to one side of the curve, across its normal. In 3D, the radius of a tube round it.' },
    wander: { section: 'Ride', label: 'Wander', type: 'float', min: 0, max: 1, step: 0.01, hint: '0: each walker keeps its own lane across the band. 1: each sways from side to side across the whole width (in 3D, circles round the tube).' },
    wanderRate: { section: 'Ride', label: 'Wander rate', type: 'float', min: 0, max: 4, step: 0.01, hint: 'How fast they sway across the band, about this many times a second (each walker a little faster or slower).' },
    loop: { section: 'Ride', label: 'Loop', type: 'select', options: [
      { value: 'wrap', label: 'Wrap (closed curves)' }, { value: 'pingpong', label: 'Ping-pong (back and forth)' }, { value: 'respawn', label: 'Respawn at the start' },
    ], hint: 'At the end of the curve: Wrap goes on round (seamless on a closed figure); Ping-pong turns back; Respawn jumps back to the start (a stream along an open curve, a spiral with Damping).' },
    ...curveParams(),
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const d3 = isAgent3d(node);
    const axes: Axis[] = d3 ? ['X', 'Y', 'Z'] : ['X', 'Y'];
    const vt = d3 ? 'vec3' : 'vec2';
    const { point } = curvePoint(node, v, axes);
    const loop = sel(node.params.loop, ['wrap', 'pingpong', 'respawn'], 'wrap');
    const speed = v.speed ?? p(node.params.speed, 0.05);
    const width = v.width ?? p(node.params.width, 0.04);
    const wander = p(node.params.wander, 0);
    const rate = p(node.params.wanderRate, 0.25);
    const damping = p(node.params.damping, 0);
    const at = (tv: string) => `      t = ${tv}; ${id}_damp = exp(-${damping} * t);\n`;
    const lines = [
      `    // Ride a curve: each walker keeps its place along the curve (s) in Memory.x, plus 1 (0: not on it yet).\n`,
      `    ${vt} ${id}_p; ${vt} ${id}_v; float ${id}_along; vec2 ${id}_mem;\n`,
      `    {\n`,
      `      float time = ${v.time ?? 'u_time'};\n`,
      `      float ${id}_L = max(${p(node.params.turns, 1)}, 1e-3) * 6.2831853;\n`,
      // Numbers of the walker's own, the same every step (from its Index).
      `      uint ${id}_r = agHash(uint(a_index) ^ 0x2C1B3C6Du);\n`,
      `      float ${id}_h1 = agRnd(${id}_r), ${id}_h2 = agRnd(${id}_r), ${id}_h3 = agRnd(${id}_r), ${id}_h4 = agRnd(${id}_r), ${id}_h5 = agRnd(${id}_r), ${id}_h6 = agRnd(${id}_r);\n`,
      `      vec2 ${id}_m = ${v.memory ?? 'a_mem'};\n`,
      // Spread: where it starts (random, or evenly by Index), over Spread over of the curve.
      `      float ${id}_s0 = ${sel(node.params.spread, ['random', 'even'], 'random') === 'even' ? `(a_index + 0.5) / a_count` : `${id}_h1`} * clamp(${p(node.params.spreadOver, 1)}, 0.0, 1.0) * ${id}_L;\n`,
      // Its speed in t a second: Speed turns a second, varied per walker, one way or both.
      `      float ${id}_sp = ${speed} * (1.0 + ${p(node.params.speedVar, 0.3)} * (2.0 * ${id}_h2 - 1.0)) * 6.2831853${node.params.direction === 'both' ? ` * (${id}_h6 < 0.5 ? -1.0 : 1.0)` : ''};\n`,
      `      float ${id}_s = (${id}_m.x > 0.5 ? ${id}_m.x - 1.0 : ${id}_s0) + ${id}_sp * a_dt;\n`,
      `      float ${id}_sg = 1.0;\n`,
      ...(loop === 'wrap' ? [
        `      ${id}_s = mod(${id}_s, ${id}_L);\n`,
        `      float ${id}_t = ${id}_s;\n`,
      ] : loop === 'pingpong' ? [
        // Out along 0 → L, back along L → 2L: t folds back, and the velocity turns round with it.
        `      ${id}_s = mod(${id}_s, 2.0 * ${id}_L);\n`,
        `      float ${id}_t = ${id}_L - abs(${id}_s - ${id}_L);\n`,
        `      ${id}_sg = ${id}_s < ${id}_L ? 1.0 : -1.0;\n`,
      ] : [
        // Off the end: back to the start (off the start, riding backward: to the end).
        `      if (${id}_s > ${id}_L) ${id}_s = 0.0; else if (${id}_s < 0.0) ${id}_s = ${id}_L;\n`,
        `      float ${id}_t = ${id}_s;\n`,
      ]),
      // The curve at t, and either side for the tangent (Curve Trace's point, with t, time and damp declared here).
      `      float t; float ${id}_damp;\n`,
      `      float ${id}_e = 2e-3;\n`,
      at(`${id}_t - ${id}_e`), `      ${vt} ${id}_a = ${point};\n`,
      at(`${id}_t + ${id}_e`), `      ${vt} ${id}_b = ${point};\n`,
      at(`${id}_t`), `      ${vt} ${id}_c = ${point};\n`,
      `      ${vt} ${id}_d = (${id}_b - ${id}_a) / (2.0 * ${id}_e);\n`,
      `      float ${id}_dl = length(${id}_d);\n`,
    ];
    if (d3) {
      lines.push(
        `      vec3 ${id}_T = ${id}_dl > 1e-8 ? ${id}_d / ${id}_dl : vec3(1.0, 0.0, 0.0);\n`,
        // A frame round the tangent (the picture's depth as the reference, so a flat figure's ribbon lies flat).
        `      vec3 ${id}_e1 = normalize(cross(${id}_T, abs(${id}_T.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));\n`,
        `      vec3 ${id}_e2 = cross(${id}_T, ${id}_e1);\n`,
        `      float ${id}_ang = 6.2831853 * ${id}_h5 + ${wander} * a_age * ${rate} * 6.2831853 * (2.0 * ${id}_h4 - 1.0);\n`,
        `      ${id}_p = ${id}_c + ${width} * sqrt(${id}_h3) * (cos(${id}_ang) * ${id}_e1 + sin(${id}_ang) * ${id}_e2);\n`,
      );
    } else {
      lines.push(
        `      vec2 ${id}_T = ${id}_dl > 1e-8 ? ${id}_d / ${id}_dl : vec2(1.0, 0.0);\n`,
        // Across the curve: its own lane (−1…1), or swaying across the band with Wander.
        `      float ${id}_off = ${width} * mix(2.0 * ${id}_h3 - 1.0, sin(a_age * ${rate} * 6.2831853 * (0.6 + 0.8 * ${id}_h4) + 6.2831853 * ${id}_h5), clamp(${wander}, 0.0, 1.0));\n`,
        `      ${id}_p = ${id}_c + vec2(-${id}_T.y, ${id}_T.x) * ${id}_off;\n`,
      );
    }
    lines.push(
      `      ${id}_v = ${id}_d * ${id}_sp * ${id}_sg;\n`,
      `      ${id}_along = ${id}_t / ${id}_L;\n`,
      `      ${id}_mem = vec2(${id}_s + 1.0, ${id}_m.y);\n`,
      `    }\n`,
      d3
        ? `    vec3 ${id}_h = length(${id}_v) > 1e-6 ? normalize(${id}_v) : a_dir;\n`
        : `    float ${id}_h = length(${id}_v) > 1e-6 ? atan(${id}_v.y, ${id}_v.x) : a_heading;\n`,
    );
    return {
      code: lines.join(''),
      outputVars: { position: `${id}_p`, velocity: `${id}_v`, heading: `${id}_h`, speed: `length(${id}_v)`, along: `${id}_along`, memory: `${id}_mem` },
    };
  },
};
