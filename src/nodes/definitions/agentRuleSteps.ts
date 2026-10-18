/**
 * Rule steps (docs/agent-rules.md "As nodes"): the actions the Agent Builder's rules use most, as
 * real nodes inside an Agents group, so a rule set opened as nodes reads as Turn toward → Wander →
 * Leave trail rather than one Expression Block per rule. Each takes the walker's running values
 * (heading, speed, trail to leave, brightness) from the step before it and gives them on, changed;
 * When (0 or 1, from the rule's When block) scales what it does, so with When at 0 it changes
 * nothing. Unwired, When is 1: the step always applies.
 *
 * The maths is the rule generator's own (agentRules/generate.ts actionLines): the same formulas, in
 * the same order, so a rule set made of these nodes moves its walkers as the Expression Blocks did
 * (agentRules/__tests__/ruleSteps.test.ts runs both). The random steps (Follow trail, Wander) draw
 * from the walker's seed hashed with a number of their own (Salt, kept on the node), the same
 * numbers the blocks drew.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';
import { hashId, isAgent3d } from './agents';

const THIS_AGENT = 'Unwired: this walker\'s own (the card shows "← this walker\'s …").';
const MOUSE = '((u_mouse / u_resolution.y - vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5) * 2.0)';
const PI = '3.1415927';
const TAU = '6.2831853';
const sel = (v: unknown, allowed: string[], fallback: string) => (typeof v === 'string' && allowed.includes(v) ? v : fallback);
/** A GLSL float literal, rounded as the rule generator rounds (6 places). */
const glf = (v: number): string => {
  const r = Math.round((isFinite(v) ? v : 0) * 1e6) / 1e6;
  const s = String(r);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
const num = (v: unknown, fallback: number) => (typeof v === 'number' && isFinite(v) ? v : fallback);

const WHEN = { type: 'float' as const, label: 'When', hint: '1 when the rule applies to this walker this step, 0 when not (the rule\'s When block). Unwired: always.' };
const HEADING_IN = { type: 'float' as const, label: 'Heading', hint: 'The heading so far this step (the step before\'s Heading). ' + THIS_AGENT };
const HEADING_OUT = { heading: { type: 'float' as const, label: 'Heading', hint: 'The heading, turned: into the next step\'s Heading, or Move.' } };
const SPEED_IN = { type: 'float' as const, label: 'Speed', hint: 'The speed so far this step. ' + THIS_AGENT };
const POSITION_IN = { type: 'vec2' as const, label: 'Position', hint: THIS_AGENT };
const DEGREES = { label: 'Max turn', type: 'float' as const, min: 0, max: 180, step: 0.5, hint: 'At most this many degrees a step.' };
const SALT = 'Salt: a number of its own, hashed with the walker\'s seed for its random numbers (repeatable; two steps never share them).';

/** The heading the step reads, and When. */
const headingOf = (node: GraphNode, v: Record<string, string>) => v.heading ?? (isAgent3d(node) ? 'a_dir' : 'a_heading');
const whenOf = (v: Record<string, string>) => v.when ?? '1.0';
/** Its random number for this walker and step: the walker's seed hashed with the node's Salt. */
export const ruleDice = (salt: number) => `float(agHash(a_seed ^ 0x${(salt >>> 0).toString(16).toUpperCase().padStart(8, '0')}u) >> 8) / 16777216.0`;
const saltOf = (node: GraphNode, k = 0) => (typeof node.params.salt === 'number' ? node.params.salt : (hashId(node.id) + k) >>> 0);

/**
 * Turn the heading `H` toward the direction `to` by at most `deg` degrees, scaled by `go`
 * (generate.ts toward()): 2D an angle the short way round; 3D in the plane of the heading and `to`.
 */
export function towardCode(id: string, to: string, H: string, go: string, deg: string, d3: boolean): { code: string; heading: string } {
  if (!d3) {
    return {
      code: [
        `    vec2 ${id}_to = ${to};\n`,
        `    float ${id}_turn = length(${id}_to) > 1e-6 ? clamp(mod(atan(${id}_to.y, ${id}_to.x) - ${H} + ${PI}, ${TAU}) - ${PI}, -radians(${deg}), radians(${deg})) : 0.0;\n`,
        `    float ${id}_h = ${H} + ${go} * ${id}_turn;\n`,
      ].join(''),
      heading: `${id}_h`,
    };
  }
  return {
    code: [
      `    vec3 ${id}_to = ${to};\n`,
      `    ${id}_to = length(${id}_to) > 1e-6 ? normalize(${id}_to) : ${H};\n`,
      `    vec3 ${id}_side = ${id}_to - ${H} * dot(${id}_to, ${H});\n`,
      `    float ${id}_turn = min(radians(${deg}), acos(clamp(dot(${H}, ${id}_to), -1.0, 1.0)));\n`,
      `    vec3 ${id}_h = length(${id}_side) > 1e-5 ? agTurn3(${H}, normalize(${id}_side), ${go} * ${id}_turn) : ${H};\n`,
    ].join(''),
    heading: `${id}_h`,
  };
}

/** 3D: this step's random direction across the heading (a_across, kept square to it): the plane a random turn happens in. */
const acrossCode = (id: string, H: string) => [
  `    vec3 ${id}_side = a_across - ${H} * dot(a_across, ${H});\n`,
  `    ${id}_side = length(${id}_side) > 1e-4 ? normalize(${id}_side) : agAcross(${H}, 0.0);\n`,
].join('');

/** A point of the picture as the walker's space (flat in z in 3D). */
const pointOf = (node: GraphNode, which: string, d3: boolean) => {
  const t = which === 'mouse' ? MOUSE : which === 'centre' ? 'vec2(0.0)' : `vec2(${p(node.params.x, 0)}, ${p(node.params.y, 0)})`;
  return d3 ? `vec3(${t}, 0.0)` : t;
};

// ── Turn toward ─────────────────────────────────────────────────────────────

export const AgentTurnTowardNode: NodeDefinition = {
  type: 'agentTurnToward',
  label: 'Turn Toward',
  category: 'Simulation',
  aliases: ['Turn toward', 'Steer toward', 'Seek', 'Flee', 'Head for', 'Keep apart', 'Separation', 'Alignment', 'Cohesion', 'Follow flow'],
  description: 'Turns the walker toward a way to go (Direction) or a point (Target, the mouse, the centre), at most Max turn a step, the short way round. Away turns the other way. The Agent Builder\'s seek, flee, keep apart, align and stay together are this node.',
  inputs: {
    heading: HEADING_IN,
    direction: { type: 'vec2', label: 'Direction', hint: 'Aim: Direction. The way to turn toward (any length; none: no turn), e.g. Neighbours\' Push or Heading, or a flow.' },
    target: { type: 'vec2', label: 'Target', hint: 'Aim: Point. The point to turn toward (wins over X and Y), e.g. Neighbours\' Centre.' },
    position: POSITION_IN,
    when: WHEN,
  },
  outputs: HEADING_OUT,
  defaultParams: { aim: 'direction', away: 'toward', x: 0, y: 0, degrees: 10 },
  paramDefs: {
    aim: { label: 'Aim', type: 'select', hint: 'What it turns toward.', options: [
      { value: 'direction', label: 'Direction' }, { value: 'point', label: 'Point' }, { value: 'mouse', label: 'The mouse' }, { value: 'centre', label: 'The centre' },
    ] },
    away: { label: 'Way', type: 'select', hint: 'Toward it, or away from it.', options: [{ value: 'toward', label: 'Toward' }, { value: 'away', label: 'Away' }] },
    x: { label: 'X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'The point across (picture units), when Target is unwired.', showWhen: { param: 'aim', value: 'point' } },
    y: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01, hint: 'The point up (picture units), when Target is unwired.', showWhen: { param: 'aim', value: 'point' } },
    degrees: DEGREES,
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const d3 = isAgent3d(node);
    const id = node.id;
    const H = headingOf(node, v);
    const aim = sel(node.params.aim, ['direction', 'point', 'mouse', 'centre'], 'direction');
    const away = node.params.away === 'away';
    let to: string;
    if (aim === 'direction') {
      const dir = v.direction ?? (d3 ? 'vec3(0.0)' : 'vec2(0.0)');
      to = away ? `-${dir}` : dir;
    } else {
      const T = aim === 'point' && v.target ? v.target : pointOf(node, aim, d3);
      const pos = v.position ?? 'a_pos';
      to = away ? `${pos} - ${T}` : `${T} - ${pos}`;
    }
    const r = towardCode(id, to, H, whenOf(v), p(node.params.degrees, 10), d3);
    return { code: r.code, outputVars: { heading: r.heading } };
  },
};

// ── Follow trail ────────────────────────────────────────────────────────────

export const AgentFollowTrailNode: NodeDefinition = {
  type: 'agentFollowTrail',
  label: 'Follow Trail',
  category: 'Simulation',
  aliases: ['Follow trail', 'Slime mold turn', 'Jones rule', 'Smell', 'Avoid trail', 'Physarum'],
  description: 'The slime-mold turn, gated by When: straight on when the trail is strongest ahead, a random side when both sides beat ahead, else Turn toward the stronger side. Away runs from the trail instead. Readings come from a Sense node.',
  inputs: {
    heading: HEADING_IN,
    readings: { type: 'vec3', label: 'Readings', hint: 'Sense\'s Readings: the trail to the left, ahead and to the right.' },
    when: WHEN,
  },
  outputs: HEADING_OUT,
  defaultParams: { away: 'toward', degrees: 45 },
  paramDefs: {
    away: { label: 'Way', type: 'select', hint: 'Toward the trail, or away from it.', options: [{ value: 'toward', label: 'Toward' }, { value: 'away', label: 'Away' }] },
    degrees: { label: 'Turn', type: 'float', min: 0, max: 180, step: 0.5, hint: 'Degrees turned in one step. Small makes long smooth veins; large makes tight, busy networks.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const d3 = isAgent3d(node);
    const id = node.id;
    const H = headingOf(node, v);
    const go = whenOf(v);
    const r = v.readings ?? 'vec3(0.0)';
    const deg = p(node.params.degrees, 45);
    const lines = [
      `    vec3 ${id}_r = ${node.params.away === 'away' ? `-(${r})` : r};\n`,
      `    float ${id}_coin = ${ruleDice(saltOf(node))};\n`,
      `    float ${id}_turn = ${id}_r.y > ${id}_r.x && ${id}_r.y > ${id}_r.z ? 0.0 : ${id}_r.y < ${id}_r.x && ${id}_r.y < ${id}_r.z ? (${id}_coin < 0.5 ? -1.0 : 1.0) : sign(${id}_r.x - ${id}_r.z);\n`,
    ];
    if (d3) lines.push(acrossCode(id, H), `    vec3 ${id}_h = agTurn3(${H}, ${id}_side, ${go} * radians(${deg}) * ${id}_turn);\n`);
    else lines.push(`    float ${id}_h = ${H} + ${go} * radians(${deg}) * ${id}_turn;\n`);
    return { code: lines.join(''), outputVars: { heading: `${id}_h` } };
  },
};

// ── Wander ──────────────────────────────────────────────────────────────────

export const AgentWanderNode: NodeDefinition = {
  type: 'agentWander',
  label: 'Wander',
  category: 'Simulation',
  aliases: ['Random turn', 'Wobble', 'Jitter', 'Drunk walk'],
  description: 'A random turn of up to Max turn either way, a fresh one every step: walkers drift instead of going dead straight. ' + SALT,
  inputs: { heading: HEADING_IN, when: WHEN },
  outputs: HEADING_OUT,
  defaultParams: { degrees: 5 },
  paramDefs: { degrees: { ...DEGREES, hint: 'At most this many degrees either way, a step.' } },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const d3 = isAgent3d(node);
    const id = node.id;
    const H = headingOf(node, v);
    const go = whenOf(v);
    const lines = [`    float ${id}_w = (${ruleDice(saltOf(node))} * 2.0 - 1.0) * radians(${p(node.params.degrees, 5)});\n`];
    if (d3) lines.push(acrossCode(id, H), `    vec3 ${id}_h = agTurn3(${H}, ${id}_side, ${go} * ${id}_w);\n`);
    else lines.push(`    float ${id}_h = ${H} + ${go} * ${id}_w;\n`);
    return { code: lines.join(''), outputVars: { heading: `${id}_h` } };
  },
};

// ── Orbit ───────────────────────────────────────────────────────────────────

export const AgentOrbitNode: NodeDefinition = {
  type: 'agentOrbit',
  label: 'Orbit',
  category: 'Simulation',
  aliases: ['Circle', 'Go round', 'Swarm', 'Moths'],
  description: 'Steers the walker round a point at Distance: along the circle, in toward it when further, out when nearer, at most Max turn a step. In 3D also back toward the point\'s depth.',
  inputs: {
    heading: HEADING_IN,
    position: POSITION_IN,
    target: { type: 'vec2', label: 'Target', hint: 'The point to circle (wins over Around).' },
    when: WHEN,
  },
  outputs: HEADING_OUT,
  defaultParams: { around: 'centre', x: 0, y: 0, distance: 0.5, degrees: 6, way: 'ccw' },
  paramDefs: {
    around: { label: 'Around', type: 'select', hint: 'The point it circles when Target is unwired.', options: [
      { value: 'centre', label: 'The centre' }, { value: 'mouse', label: 'The mouse' }, { value: 'point', label: 'Point' },
    ] },
    x: { label: 'X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'The point across (picture units).', showWhen: { param: 'around', value: 'point' } },
    y: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01, hint: 'The point up (picture units).', showWhen: { param: 'around', value: 'point' } },
    distance: { label: 'Distance', type: 'float', min: 0.01, max: 2, step: 0.01, hint: 'How far from the point it circles (picture units).' },
    degrees: DEGREES,
    way: { label: 'Way round', type: 'select', hint: 'Which way it circles.', options: [{ value: 'ccw', label: 'Counter-clockwise' }, { value: 'cw', label: 'Clockwise' }] },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const d3 = isAgent3d(node);
    const id = node.id;
    const H = headingOf(node, v);
    const pos = v.position ?? 'a_pos';
    const T = v.target ?? pointOf(node, sel(node.params.around, ['centre', 'mouse', 'point'], 'centre'), d3);
    const R = `max(${p(node.params.distance, 0.5)}, 1e-3)`;
    const S = node.params.way === 'cw' ? '-1.0' : '1.0';
    const lines: string[] = [];
    let to: string;
    if (d3) {
      lines.push(`    vec3 ${id}_off = ${pos} - ${T};\n`, `    float ${id}_r = max(length(${id}_off.xy), 1e-5);\n`);
      to = `vec3(-${id}_off.y, ${id}_off.x, 0.0) * ${S} / ${id}_r - vec3(${id}_off.xy / ${id}_r, 0.0) * clamp((${id}_r - ${R}) / ${R}, -1.0, 1.0) - vec3(0.0, 0.0, ${id}_off.z)`;
    } else {
      lines.push(`    vec2 ${id}_off = ${pos} - ${T};\n`, `    float ${id}_r = max(length(${id}_off), 1e-5);\n`);
      to = `vec2(-${id}_off.y, ${id}_off.x) * ${S} / ${id}_r - ${id}_off / ${id}_r * clamp((${id}_r - ${R}) / ${R}, -1.0, 1.0)`;
    }
    const r = towardCode(id, to, H, whenOf(v), p(node.params.degrees, 6), d3);
    return { code: lines.join('') + r.code, outputVars: { heading: r.heading } };
  },
};

// ── Avoid walls ─────────────────────────────────────────────────────────────

export const AgentAvoidWallsNode: NodeDefinition = {
  type: 'agentAvoidWalls',
  label: 'Avoid Walls',
  category: 'Simulation',
  aliases: ['Avoid walls', 'Avoid edges', 'Stay inside', 'Keep in the picture'],
  description: 'Within Margin of an edge of the picture (or the box in 3D), turns the walker back inward, at most Max turn a step. Elsewhere it does nothing.',
  inputs: { heading: HEADING_IN, position: POSITION_IN, when: WHEN },
  outputs: HEADING_OUT,
  defaultParams: { margin: 0.2, degrees: 10 },
  paramDefs: {
    margin: { label: 'Margin', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How near an edge it starts turning back (picture units).' },
    degrees: DEGREES,
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const d3 = isAgent3d(node);
    const pos = v.position ?? 'a_pos';
    const m = `max(${p(node.params.margin, 0.2)}, 0.0)`;
    const axis = (c: string, half: string) => `${pos}.${c} > ${half} - ${m} ? -1.0 : ${pos}.${c} < ${m} - ${half} ? 1.0 : 0.0`;
    const aspect = '(u_resolution.x / u_resolution.y)';
    const to = d3 ? `vec3(${axis('x', aspect)}, ${axis('y', '1.0')}, ${axis('z', '1.0')})` : `vec2(${axis('x', aspect)}, ${axis('y', '1.0')})`;
    const r = towardCode(node.id, to, headingOf(node, v), whenOf(v), p(node.params.degrees, 10), d3);
    return { code: r.code, outputVars: { heading: r.heading } };
  },
};

// ── Apply force ─────────────────────────────────────────────────────────────

export const AgentApplyForceNode: NodeDefinition = {
  type: 'agentApplyForce',
  label: 'Apply Force',
  category: 'Simulation',
  aliases: ['Apply force', 'Push', 'Pull', 'Gravity', 'Wind', 'Attract', 'Accelerate'],
  description: 'Changes the walker\'s velocity (which way it heads, times how fast) by a force for one step, so its heading and speed follow: gravity, a gusty wind, a pull toward (or, with a negative Strength, a push from) a point or the mouse, or any force wired into Force (Curl noise\'s).',
  inputs: {
    heading: HEADING_IN,
    speed: SPEED_IN,
    position: POSITION_IN,
    force: { type: 'vec2', label: 'Force', hint: 'Kind: Force input. The force (picture units a second²), e.g. Curl noise\'s Force; times Strength.' },
    when: WHEN,
  },
  outputs: {
    heading: { type: 'float', label: 'Heading', hint: 'The velocity\'s direction (kept while it stands still).' },
    speed: { type: 'float', label: 'Speed', hint: 'The velocity\'s length.' },
  },
  defaultParams: { field: 'gravity', strength: 0.5, angle: -90, x: 0, y: 0 },
  paramDefs: {
    field: { label: 'Kind', type: 'select', hint: 'Which force.', options: [
      { value: 'gravity', label: 'Gravity' }, { value: 'wind', label: 'Wind' }, { value: 'point', label: 'Pull to a point' },
      { value: 'mouse', label: 'Pull to the mouse' }, { value: 'input', label: 'Force input' },
    ] },
    strength: { label: 'Strength', type: 'float', min: -4, max: 4, step: 0.01, hint: 'How hard (picture units a second²). Negative pushes the other way.' },
    angle: { label: 'Angle', type: 'float', min: -180, max: 180, step: 1, hint: 'Which way, in degrees: −90 is down, 90 up, 0 right.', showWhen: { param: 'field', value: ['gravity', 'wind'] } },
    x: { label: 'X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'The point across (picture units).', showWhen: { param: 'field', value: 'point' } },
    y: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01, hint: 'The point up (picture units).', showWhen: { param: 'field', value: 'point' } },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const d3 = isAgent3d(node);
    const id = node.id;
    const P = d3 ? 'vec3' : 'vec2';
    const H = headingOf(node, v);
    const S = v.speed ?? 'a_speed';
    const pos = v.position ?? 'a_pos';
    const field = sel(node.params.field, ['gravity', 'wind', 'point', 'mouse', 'input'], 'gravity');
    const sv = p(node.params.strength, 0.5);
    const lift = (e: string) => (d3 ? `vec3(${e}, 0.0)` : e);
    const dirOf = (fallback: number) => {
      const a = node.params.angle;
      // A number: its cos and sin as literals (the rule generator's); a live uniform: worked out in the shader.
      if (typeof a === 'string') return lift(`vec2(cos(radians(${a})), sin(radians(${a})))`);
      const deg = num(a, fallback);
      return lift(`vec2(${glf(Math.cos(deg * Math.PI / 180))}, ${glf(Math.sin(deg * Math.PI / 180))})`);
    };
    const lines: string[] = [];
    let force: string;
    if (field === 'gravity') force = `${sv} * ${dirOf(-90)}`;
    else if (field === 'wind') force = `${sv} * (1.0 + 0.6 * sin(u_time * 1.3 + ${pos}.y * 2.0) * sin(u_time * 0.37)) * ${dirOf(0)}`;
    else if (field === 'input') force = `${sv} * ${v.force ?? `${P}(0.0)`}`;
    else {
      lines.push(`    ${P} ${id}_pull = ${lift(field === 'mouse' ? MOUSE : `vec2(${p(node.params.x, 0)}, ${p(node.params.y, 0)})`)} - ${pos};\n`);
      force = `${sv} * (length(${id}_pull) > 1e-4 ? normalize(${id}_pull) : ${P}(0.0))`;
    }
    lines.push(
      `    ${P} ${id}_vel = ${d3 ? H : `vec2(cos(${H}), sin(${H}))`} * ${S} + ${whenOf(v)} * ${force} * a_dt;\n`,
      `    float ${id}_s = length(${id}_vel);\n`,
      d3 ? `    vec3 ${id}_h = ${id}_s > 1e-6 ? ${id}_vel / ${id}_s : ${H};\n` : `    float ${id}_h = ${id}_s > 1e-6 ? atan(${id}_vel.y, ${id}_vel.x) : ${H};\n`,
    );
    return { code: lines.join(''), outputVars: { heading: `${id}_h`, speed: `${id}_s` } };
  },
};

// ── Drag ────────────────────────────────────────────────────────────────────

export const AgentDragNode: NodeDefinition = {
  type: 'agentDrag',
  label: 'Drag',
  category: 'Simulation',
  aliases: ['Friction', 'Air resistance', 'Damping', 'Slow down'],
  description: 'The speed loses Amount of itself a second (e to the minus Amount, a second: the same at any frame rate), so the walker coasts to a stop.',
  inputs: { speed: SPEED_IN, when: WHEN },
  outputs: { speed: { type: 'float', label: 'Speed', hint: 'The speed after drag.' } },
  defaultParams: { amount: 1 },
  paramDefs: { amount: { label: 'Amount', type: 'float', min: 0, max: 10, step: 0.01, hint: 'The share of its speed lost a second.' } },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => ({
    code: `    float ${node.id}_s = ${v.speed ?? 'a_speed'} * mix(1.0, exp(-max(${p(node.params.amount, 1)}, 0.0) * a_dt), ${whenOf(v)});\n`,
    outputVars: { speed: `${node.id}_s` },
  }),
};

// ── Slow in a crowd ─────────────────────────────────────────────────────────

export const AgentSlowInCrowdNode: NodeDefinition = {
  type: 'agentSlowInCrowd',
  label: 'Slow in a Crowd',
  category: 'Simulation',
  aliases: ['Slow in a crowd', 'Jam', 'Crowd speed', 'Traffic'],
  description: 'The speed falls from Walking speed toward a crawl as Count (how many walkers are near: Neighbours\' Count) reaches Jam; at most 95% slower, so nobody stops for good.',
  inputs: {
    speed: SPEED_IN,
    count: { type: 'float', label: 'Count', hint: 'How many walkers are within reach (Neighbours\' Count).' },
    when: WHEN,
  },
  outputs: { speed: { type: 'float', label: 'Speed', hint: 'The speed, slower the more crowded.' } },
  defaultParams: { jam: 20, base: 0.2 },
  paramDefs: {
    jam: { label: 'Jam', type: 'float', min: 1, max: 100, step: 1, hint: 'How many neighbours make a jam.' },
    base: { label: 'Walking speed', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Its speed with nobody near (picture units a second): the species\' Speed.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    return {
      code: [
        `    float ${id}_c = clamp(${v.count ?? '0.0'} / max(${p(node.params.jam, 20)}, 1e-3), 0.0, 0.95);\n`,
        `    float ${id}_s = mix(${v.speed ?? 'a_speed'}, ${p(node.params.base, 0.2)} * (1.0 - ${id}_c), ${whenOf(v)});\n`,
      ].join(''),
      outputVars: { speed: `${id}_s` },
    };
  },
};

// ── Leave trail ─────────────────────────────────────────────────────────────

export const AgentLeaveTrailNode: NodeDefinition = {
  type: 'agentLeaveTrail',
  label: 'Leave Trail',
  category: 'Simulation',
  aliases: ['Leave trail', 'Deposit', 'Pheromone', 'Mark'],
  description: 'Adds Amount to the trail the walker leaves this step, in its own species\' channel or one channel. Wire Deposit on to the next step, and the last into Agent Output\'s Deposit.',
  inputs: {
    deposit: { type: 'vec4', label: 'Deposit', hint: 'The trail it leaves so far this step, one amount per channel (unwired: none yet).' },
    species: { type: 'float', label: 'Species', hint: THIS_AGENT },
    when: WHEN,
  },
  outputs: { deposit: { type: 'vec4', label: 'Deposit', hint: 'The trail it leaves, with this added.' } },
  defaultParams: { channel: 'own', amount: 1 },
  paramDefs: {
    channel: { label: 'Channel', type: 'select', hint: 'Which trail channel.', options: [
      { value: 'own', label: 'Its own species\'' }, { value: '0', label: 'Channel 1' }, { value: '1', label: 'Channel 2' }, { value: '2', label: 'Channel 3' }, { value: '3', label: 'Channel 4' },
    ] },
    amount: { label: 'Amount', type: 'float', min: 0, max: 10, step: 0.01, hint: 'How much a step (times Deposit\'s Amount outside the group).' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const ch = sel(node.params.channel, ['own', '0', '1', '2', '3'], 'own');
    const amt = `${whenOf(v)} * ${p(node.params.amount, 1)}`;
    const add = ch === 'own'
      ? `${amt} * vec4(equal(vec4(${v.species ?? 'a_species'}), vec4(0.0, 1.0, 2.0, 3.0)))`
      : `vec4(${[0, 1, 2, 3].map(c => (String(c) === ch ? amt : '0.0')).join(', ')})`;
    return { code: `    vec4 ${id}_d = ${v.deposit ?? 'vec4(0.0)'} + ${add};\n`, outputVars: { deposit: `${id}_d` } };
  },
};

// ── Fade with age ───────────────────────────────────────────────────────────

export const AgentFadeWithAgeNode: NodeDefinition = {
  type: 'agentFadeWithAge',
  label: 'Fade with Age',
  category: 'Simulation',
  aliases: ['Fade with age', 'Fade out', 'Dim', 'Die out', 'Brightness'],
  description: 'Dims the walker from full brightness at birth to black at Over seconds old (Brightness times what is left), for its colour.',
  inputs: {
    bright: { type: 'float', label: 'Brightness', hint: 'Its brightness so far this step (unwired: 1).' },
    age: { type: 'float', label: 'Age', hint: THIS_AGENT },
    when: WHEN,
  },
  outputs: { bright: { type: 'float', label: 'Brightness', hint: 'Its brightness, 1 to 0 over its life: multiply its colour by it.' } },
  defaultParams: { seconds: 3 },
  paramDefs: { seconds: { label: 'Over', type: 'float', min: 0.05, max: 30, step: 0.05, hint: 'Seconds from birth to black.' } },
  assignable: false,
  generateGLSL: (node: GraphNode, v) => ({
    code: `    float ${node.id}_b = ${v.bright ?? '1.0'} * mix(1.0, clamp(1.0 - ${v.age ?? 'a_age'} / max(${p(node.params.seconds, 3)}, 1e-3), 0.0, 1.0), ${whenOf(v)});\n`,
    outputVars: { bright: `${node.id}_b` },
  }),
};

/** The rule-step nodes, by type. */
export const RULE_STEP_NODES = [
  AgentTurnTowardNode, AgentFollowTrailNode, AgentWanderNode, AgentOrbitNode, AgentAvoidWallsNode,
  AgentApplyForceNode, AgentDragNode, AgentSlowInCrowdNode, AgentLeaveTrailNode, AgentFadeWithAgeNode,
];
export const RULE_STEP_TYPES = RULE_STEP_NODES.map(d => d.type);
