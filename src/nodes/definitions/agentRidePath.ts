/**
 * agentRidePath.ts — Ride a path (docs/agents-group.md "Ride a path"): walkers that travel along the
 * outline of whatever shape is wired into Path ƒ, as a flowing band. The node has no shapes of its own:
 * a Circle SDF, a Lissajous Curve, a Chladni plate, Metaballs, noise, text, an Expression Block blending
 * several, anything with a value at every point.
 *
 * Path ƒ is a field socket (as Collide's Shape): the node calls the shape's function at points of its
 * own choosing. Each step a walker is pulled onto the outline, where the shape equals Level (Newton
 * steps along the shape's slope, each at most 0.15 so one born far away comes in over a few frames),
 * slides along it perpendicular to the slope by its speed, is pulled back on, then set across it in its
 * own lane within Ribbon width. Its offset is taken off again by next step's pull, so lanes hold.
 * Nothing is kept in Memory: where a walker is now is its place, so the shape can move or change and the
 * walkers follow it. In 3D the outline is the picture's, at the walker's own depth (a prism).
 *
 * The parametric curves (Curve Trace's) that Ride a curve (agentRideCurve.ts, kept for saved graphs)
 * had built in are not here: wire a Lissajous Curve, or any other curve's distance, instead.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { fieldFn, p } from './helpers';
import { isAgent3d } from './agents';

export const AgentRidePathNode: NodeDefinition = {
  type: 'agentRidePath',
  label: 'Ride a path',
  category: 'Simulation',
  aliases: ['Ride a curve', 'Follow a path', 'Ride an outline', 'Follow an outline', 'Follow a shape', 'Contour walkers', 'Ride a shape', 'Path walkers'],
  description: 'Walkers that travel along a shape\'s outline as a flowing band. Wire any shape into Path ƒ (a Circle SDF, a Lissajous Curve, a Chladni plate, Metaballs, text) and they slide along where it equals Level, pulled back onto it every step, so they follow it as it moves. Position, Velocity and Heading go to Agent Output.',
  inputs: {
    path: { type: 'float', label: 'Path ƒ', field: true, hint: 'The shape to ride the outline of: an SDF\'s Distance (a circle, a star, a union), a Lissajous Curve, a Chladni plate (its nodal lines), noise. Walkers follow where it equals Level. Unwired, they stay where they are.' },
    speed: { type: 'float', label: 'Speed', hint: 'Overrides Speed; each walker\'s variation still applies.' },
    level: { type: 'float', label: 'Level', hint: 'Overrides Level: wire a beat or an LFO to make the band breathe in and out.' },
    width: { type: 'float', label: 'Ribbon width', hint: 'Overrides Ribbon width.' },
  },
  outputs: {
    position: { type: 'vec2', label: 'Position', hint: 'On the outline, offset across it within Ribbon width: Agent Output\'s Position.' },
    velocity: { type: 'vec2', label: 'Velocity', hint: 'Along the outline × the walker\'s speed (picture units a second): Agent Output\'s Velocity, for streaks and colour by speed.' },
    heading: { type: 'float', label: 'Heading', hint: 'Which way it rides.' },
    speed: { type: 'float', label: 'Speed', hint: 'How fast it moves, picture units a second.' },
    along: { type: 'float', label: 'Along', hint: 'The angle round the picture\'s middle, 0–1 (an outline has no start of its own): colour round the shape with it.' },
  },
  defaultParams: { speed: 0.25, speedVar: 0.3, direction: 'one', level: 0, width: 0.04, wander: 0, wanderRate: 0.25 },
  paramDefs: {
    speed: { section: 'Ride', label: 'Speed', type: 'float', min: -2, max: 2, step: 0.001, hint: 'Picture units a second along the outline (the picture is 2 tall). Negative goes the other way round.' },
    speedVar: { section: 'Ride', label: 'Speed variation', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much each walker\'s speed differs: 0 all the same, 0.3 each ±30%, so they drift past each other.' },
    direction: { section: 'Ride', label: 'Direction', type: 'select', options: [
      { value: 'one', label: 'All one way' }, { value: 'both', label: 'Random: both ways' },
    ], hint: 'All one way, or each walker picks a way at random (half go backward): two streams through each other.' },
    level: { section: 'Ride', label: 'Level', type: 'float', min: -1, max: 1, step: 0.001, hint: 'Which outline to ride: where the shape equals this. 0 is the shape\'s edge; a little above rides just outside it, below inside. A line\'s distance (a Lissajous Curve\'s) never goes below 0, so ride it a little above.' },
    width: { section: 'Ride', label: 'Ribbon width', type: 'float', min: 0, max: 0.5, step: 0.001, hint: 'Half the band\'s width, picture units: each walker rides this far (at most) to one side of the outline.' },
    wander: { section: 'Ride', label: 'Wander', type: 'float', min: 0, max: 1, step: 0.01, hint: '0: each walker keeps its own lane across the band. 1: each sways from side to side across the whole width.' },
    wanderRate: { section: 'Ride', label: 'Wander rate', type: 'float', min: 0, max: 4, step: 0.01, hint: 'How fast they sway across the band, about this many times a second (each walker a little faster or slower).' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const d3 = isAgent3d(node);
    const vt = d3 ? 'vec3' : 'vec2';
    const fn = fieldFn(v.path);
    const heading = d3
      ? `    vec3 ${id}_h = length(${id}_v) > 1e-6 ? normalize(${id}_v) : a_dir;\n`
      : `    float ${id}_h = length(${id}_v) > 1e-6 ? atan(${id}_v.y, ${id}_v.x) : a_heading;\n`;
    const outputVars = { position: `${id}_p`, velocity: `${id}_v`, heading: `${id}_h`, speed: `length(${id}_v)`, along: `${id}_along` };
    if (!fn) {
      // Nothing to ride: they stay where they are.
      return {
        code: `    // Ride a path: Path ƒ unwired, nothing to ride.\n    ${vt} ${id}_p = a_pos; ${vt} ${id}_v = ${vt}(0.0); float ${id}_along = 0.0;\n${heading}`,
        outputVars,
      };
    }
    const width = v.width ?? p(P.width, 0.04);
    const wander = p(P.wander, 0), rate = p(P.wanderRate, 0.25);
    const at = (q: string) => `(${fn}(${q}, vec2(0.0), 1.0, 0.0) - ${id}_lv)`;
    // One Newton step onto the outline (at most 0.15, so a walker far off comes in over a few frames): three
    // lookups of the shape (here, and a little across and up: its slope), the slope kept for the walker's normal.
    // A walker on the outline last step needs only a nudge, so three steps a frame hold it (the shape is the cost).
    const pull = () => `      { float f0 = ${at(`${id}_q`)}; ${id}_g = vec2(${at(`${id}_q + vec2(${id}_e, 0.0)`)} - f0, ${at(`${id}_q + vec2(0.0, ${id}_e)`)} - f0) / ${id}_e; vec2 st = ${id}_g * f0 / max(dot(${id}_g, ${id}_g), 1e-8); float sl = length(st); ${id}_q -= sl > 0.15 ? st * (0.15 / sl) : st; }\n`;
    const lines = [
      `    // Ride a path: slide along where Path ƒ equals Level, pulled back onto it every step.\n`,
      `    ${vt} ${id}_p; ${vt} ${id}_v; float ${id}_along;\n`,
      `    {\n`,
      `      float ${id}_lv = ${v.level ?? p(P.level, 0)};\n`,
      `      float ${id}_e = 2e-3;\n`,
      `      uint ${id}_r = agHash(uint(a_index) ^ 0x2C1B3C6Du);\n`,
      `      float ${id}_h2 = agRnd(${id}_r), ${id}_h3 = agRnd(${id}_r), ${id}_h4 = agRnd(${id}_r), ${id}_h5 = agRnd(${id}_r), ${id}_h6 = agRnd(${id}_r);\n`,
      `      vec2 ${id}_q = ${d3 ? 'a_pos.xy' : 'a_pos'};\n`,
      `      float ${id}_sp = ${v.speed ?? p(P.speed, 0.25)} * (1.0 + ${p(P.speedVar, 0.3)} * (2.0 * ${id}_h2 - 1.0))${P.direction === 'both' ? ` * (${id}_h6 < 0.5 ? -1.0 : 1.0)` : ''};\n`,
      `      vec2 ${id}_g = vec2(0.0, 1.0);\n`,
      pull(), pull(),
      `      vec2 ${id}_n = length(${id}_g) > 1e-6 ? normalize(${id}_g) : vec2(0.0, 1.0);\n`,
      `      vec2 ${id}_T = vec2(-${id}_n.y, ${id}_n.x);\n`,
      `      ${id}_q += ${id}_T * ${id}_sp * a_dt;\n`,
      pull(),
      `      ${id}_n = length(${id}_g) > 1e-6 ? normalize(${id}_g) : ${id}_n;\n`,
      // Across the outline: its own lane (−1…1), or swaying across the band with Wander.
      `      float ${id}_off = ${width} * mix(2.0 * ${id}_h3 - 1.0, sin(a_age * ${rate} * 6.2831853 * (0.6 + 0.8 * ${id}_h4) + 6.2831853 * ${id}_h5), clamp(${wander}, 0.0, 1.0));\n`,
      `      vec2 ${id}_xy = ${id}_q + ${id}_n * ${id}_off;\n`,
      d3 ? `      ${id}_p = vec3(${id}_xy, a_pos.z);\n      ${id}_v = vec3(${id}_T * ${id}_sp, 0.0);\n` : `      ${id}_p = ${id}_xy;\n      ${id}_v = ${id}_T * ${id}_sp;\n`,
      // Along: the angle round the picture's middle, 0–1 (an outline has no start of its own).
      `      ${id}_along = fract(atan(${id}_q.y, ${id}_q.x) / 6.2831853 + 0.5);\n`,
      `    }\n`,
      heading,
    ];
    return { code: lines.join(''), outputVars };
  },
};
