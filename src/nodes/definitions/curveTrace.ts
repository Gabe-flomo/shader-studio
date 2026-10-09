/**
 * curveTrace.ts — Curve Trace (2D) and Curve Trace 3D (docs/curve-trace.md).
 *
 * A continuous parametric curve as a real distance field: each axis is a signal of t (a sine,
 * triangle, square or saw with its own frequency, phase, amplitude and offset, or your own GLSL
 * in t), the curve is cut into Segments straight pieces, and the output is the exact distance to
 * the nearest piece minus Thickness. So it is an SDF like any other: union it, round it, onion it,
 * glow it, colour it. Lissajous figures (X 3 : Y 2), harmonograph spirals (Damping), rose and
 * knot shapes (3D, Z on its own frequency) all come out of the same node.
 *
 * Along is where on the curve the nearest point is (0 at Start, 1 at End), for colouring along
 * the line. Start / End (wireable) draw it on or off.
 *
 * The 3D version runs inside a Scene Group. It skips the loop when the point is clearly outside
 * the curve's bounding sphere (distance to the sphere is a safe lower bound), so most march
 * steps cost one length().
 */
import type { GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { p } from './helpers';

export type Axis = 'X' | 'Y' | 'Z';

const WAVES = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'square', label: 'Square' },
  { value: 'saw', label: 'Saw' },
  { value: 'custom', label: 'Custom (GLSL in t)' },
];

/** Only names, numbers, operators and brackets: a custom axis can't break out of its expression. */
const SAFE_EXPR = /^[A-Za-z0-9_+\-*/%().,\s<>=?:!&|]*$/;

export function axisParams(a: Axis): Record<string, ParamDef> {
  const custom = { param: `wave${a}`, value: 'custom' };
  const notCustom = { param: `wave${a}`, value: ['sine', 'triangle', 'square', 'saw'] };
  return {
    [`wave${a}`]: { section: `${a}`, label: `${a} wave`, type: 'select', options: WAVES, compileTime: true, hint: `The signal along ${a}: how ${a} moves as t runs. Custom: your own GLSL in t.` },
    [`freq${a}`]: { section: `${a}`, label: `${a} frequency`, type: 'float', min: 0, max: 20, step: 0.01, showWhen: notCustom, hint: `Cycles of the ${a} wave per turn. Whole-number ratios between axes give closed figures (3 : 2 is the pretzel).` },
    [`phase${a}`]: { section: `${a}`, label: `${a} phase`, type: 'float', min: -6.2832, max: 6.2832, step: 0.01, showWhen: notCustom, hint: 'Shifts the wave along, in radians (1.5708 = 90°). Changes the figure: a circle at 1 : 1 and 90°, a line at 0°.' },
    [`amp${a}`]: { section: `${a}`, label: `${a} size`, type: 'float', min: 0, max: 5, step: 0.01, showWhen: notCustom, hint: `How far the curve swings along ${a}.` },
    [`off${a}`]: { section: `${a}`, label: `${a} offset`, type: 'float', min: -5, max: 5, step: 0.01, hint: `Moves the whole curve along ${a}.` },
    [`expr${a}`]: { section: `${a}`, label: `${a} =`, type: 'string', showWhen: custom, hint: 'GLSL in t (radians along the curve) and time. E.g. sin(3.0*t) * cos(t), or 0.3*t/6.28 for a spiral.' },
  } as Record<string, ParamDef>;
}

export function axisDefaults(a: Axis, d: { freq: number; phase: number; amp: number }, expr: string): Record<string, unknown> {
  return { [`wave${a}`]: 'sine', [`freq${a}`]: d.freq, [`phase${a}`]: d.phase, [`amp${a}`]: d.amp, [`off${a}`]: 0, [`expr${a}`]: expr };
}

export const COMMON_PARAMS = (thick: { def: number; max: number }, segs: number): Record<string, ParamDef> => ({
  mode: { section: 'Curve', label: 'Motion', type: 'select', compileTime: true, options: [
    { value: 'lateral', label: 'Lateral: X and Y swing (Lissajous)' },
    { value: 'rotary', label: 'Rotary: two circles, same way (loops)' },
    { value: 'counter', label: 'Rotary: two circles, opposite ways (stars, flowers)' },
  ], hint: 'Lateral: each axis is its own wave. Rotary: two circular motions added: X\'s frequency, size and phase are the first circle, Y\'s the second (waves ignored).',
  help: 'A harmonograph\'s two kinds of motion. Lateral: X and Y swing back and forth on their own waves, which draws Lissajous figures (3 : 2 is the fifth\'s pretzel). Rotary: the pen goes round two circles at once, the first at X frequency / size / phase and the second at Y\'s. Turning the same way makes looped circles; opposite ways makes stars and flowers (3 : 2 counter-current is a five-pointed star). The Z axis (3D) stays a wave either way.' },
  turns: { section: 'Curve', label: 'Turns', type: 'float', min: 0.01, max: 20, step: 0.01, hint: 't runs from 0 to Turns × 2π. One turn closes any whole-number figure; more turns for Damping spirals or non-whole ratios.' },
  draw: { section: 'Curve', label: 'Draw', type: 'select', compileTime: true, options: [
    { value: 'whole', label: 'The whole curve (Start to End)' },
    { value: 'pen', label: 'Pen: a moving head with a trail' },
    { value: 'live', label: 'Live: frequencies in Hz, a dot that leaves a trail' },
  ], hint: 'Pen: a head runs along the curve and leaves a trail. Slow, you see it drawn; fast with a long Trail, it becomes the whole figure.' },
  penSpeed: { section: 'Curve', label: 'Pen speed', type: 'float', min: 0, max: 20, step: 0.01, showWhen: { param: 'draw', value: 'pen' }, hint: 'How fast the head moves, in turns a second. 0.1 draws slowly; 5+ blurs into a continuous figure.' },
  persistence: { section: 'Curve', label: 'Persistence (s)', type: 'float', min: 0.001, max: 3, step: 0.001, showWhen: { param: 'draw', value: 'live' }, hint: 'How many seconds of the dot\'s path stay on screen. Low frequencies show a dot with a short tail; as they rise, the same time covers more of the figure until it is a solid line.' },
  trail: { section: 'Curve', label: 'Trail', type: 'float', min: 0.001, max: 4, step: 0.001, showWhen: { param: 'draw', value: 'pen' }, hint: 'How much of the curve stays behind the head, in turns. 1 is a whole figure (for whole-number ratios). Along runs 0 at the tail to 1 at the head: fade with it.' },
  start: { section: 'Curve', label: 'Start', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'draw', value: 'whole' }, hint: 'Where the drawn part begins (0–1 of the curve). Wire it to draw the curve on or off.' },
  end: { section: 'Curve', label: 'End', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'draw', value: 'whole' }, hint: 'Where the drawn part ends (0–1).' },
  damping: { section: 'Curve', label: 'Damping', type: 'float', min: 0, max: 2, step: 0.001, hint: 'The waves shrink as t runs (exp(−Damping × t)), like a harmonograph\'s pendulums: a figure spirals in. Use more Turns.' },
  morphOn: { section: 'Morph', label: 'Morph', type: 'bool', compileTime: true, hint: 'Blend into a second figure (frequencies B): every point of the curve moves from figure A to figure B as Morph amount goes 0 → 1. Both are closed, so every shape in between is too.' },
  morph: { section: 'Morph', label: 'Morph amount', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'morphOn', value: 'true' }, hint: '0 is the figure from the X/Y frequencies, 1 the figure from the B frequencies. Wire an LFO to flow back and forth.' },
  freqXB: { section: 'Morph', label: 'X frequency B', type: 'float', min: 0, max: 20, step: 0.01, showWhen: { param: 'morphOn', value: 'true' }, hint: 'X frequency of the figure it morphs into.' },
  freqYB: { section: 'Morph', label: 'Y frequency B', type: 'float', min: 0, max: 20, step: 0.01, showWhen: { param: 'morphOn', value: 'true' }, hint: 'Y frequency of the figure it morphs into.' },
  thickness: { section: 'Curve', label: 'Thickness', type: 'float', min: 0, max: thick.max, step: 0.001, hint: 'Half the line\'s width: subtracted from the distance. 0 is an infinitely thin line (use a glow on Distance).' },
  segments: { section: 'Curve', label: 'Segments', type: 'float', min: 16, max: 2048, step: 1, compileTime: true, hint: `Straight pieces the curve is cut into. More for high frequencies (a smooth curve needs ~10 per wiggle); costs that many steps per pixel. Default ${segs}.` },
});

const COMMON_DEFAULTS = (thick: number, segs: number) => ({ mode: 'lateral', draw: 'whole', penSpeed: 0.25, trail: 0.5, persistence: 0.2, morphOn: false, morph: 0, freqXB: 5, freqYB: 4, turns: 1, start: 0, end: 1, damping: 0, thickness: thick, segments: segs });

function waveExpr(wave: string, x: string): string {
  switch (wave) {
    case 'triangle': return `(0.63662 * asin(sin(${x})))`;
    case 'square': return `sign(sin(${x}))`;
    case 'saw': return `(2.0 * fract(${x} / 6.28318 + 0.5) - 1.0)`;
    default: return `sin(${x})`;
  }
}

/**
 * Live: a phase only means something once its wave moves, so it grows in over the first hertz.
 * At 0 Hz every axis sits at its offset: the dot rests in the middle, as on a real harmonograph.
 */
function livePhase(node: GraphNode, phase: string, freq: string): string {
  return node.params.draw === 'live' ? `(${phase} * min(abs(${freq}), 1.0))` : phase;
}

/** GLSL for one axis at the loop's `t`. */
/**
 * One axis: its GLSL at the loop's `t`, a bound on how far it reaches (`bound`), and a bound on how
 * fast it moves per unit of t (`lip`, null when it can jump: square, saw, custom), which lets the
 * loop skip whole stretches of the curve that can't hold the nearest point.
 */
function axisExpr(node: GraphNode, a: Axis, inputVars: Record<string, string>, freqOf: (a: Axis) => string): { expr: string; bound: string | null; lip: string | null } {
  const wave = String(node.params[`wave${a}`] ?? 'sine');
  const off = p(node.params[`off${a}`], 0);
  if (wave === 'custom') {
    const raw = String(node.params[`expr${a}`] ?? '0.0').trim() || '0.0';
    if (!SAFE_EXPR.test(raw)) throw new Error(`Node ${node.id}: ${a} = "${raw}" has characters a curve formula can't use (only names, numbers, operators and brackets).`);
    return { expr: `(${off} + (${raw}))`, bound: null, lip: null };
  }
  const freq = freqOf(a);
  const phase = livePhase(node, inputVars[`phase${a}`] || p(node.params[`phase${a}`], 0), freq);
  const amp = p(node.params[`amp${a}`], 1);
  // Speed along the axis: amp × (frequency + damping) for a sine; a triangle's slope is 2/π of a sine's peak.
  const damping = p(node.params.damping, 0);
  const slope = wave === 'sine' ? `abs(${freq})` : wave === 'triangle' ? `(0.63662 * abs(${freq}))` : null;
  const lip = slope ? `(abs(${amp}) * (${slope} + abs(${damping})))` : null;
  return { expr: `(${off} + ${amp} * ${node.id}_damp * ${waveExpr(wave, `${freq} * t + ${phase}`)})`, bound: `(abs(${off}) + abs(${amp}))`, lip };
}

/** Segments per stretch the chunked loop tests as a whole. */
const CHUNK = 16;

/** One segment, from `prev` to `cur` (the point at the loop's t): keeps the nearest, squared, and where along it. */
const segmentLines = (id: string, vt: string, n: number, point: string, pos: string, dampAt: (tv: string) => string, ind: string, i: string): string[] => [
  `${ind}float ${id}_f = float(${i}) / ${n}.0;\n`,
  `${ind}t = mix(${id}_t0, ${id}_t1, ${id}_f);\n`,
  `${ind}${id}_damp = ${dampAt('t')};\n`,
  `${ind}${vt} ${id}_cur = ${point};\n`,
  `${ind}${vt} ${id}_pa = ${pos} - ${id}_prev;\n`,
  `${ind}${vt} ${id}_ba = ${id}_cur - ${id}_prev;\n`,
  `${ind}float ${id}_h = clamp(dot(${id}_pa, ${id}_ba) / max(dot(${id}_ba, ${id}_ba), 1e-10), 0.0, 1.0);\n`,
  `${ind}${vt} ${id}_q = ${id}_pa - ${id}_ba * ${id}_h;\n`,
  // Squared distances in the loop, one square root after it.
  `${ind}float ${id}_dd = dot(${id}_q, ${id}_q);\n`,
  `${ind}if (${id}_dd < ${id}_d) { ${id}_d = ${id}_dd; ${id}_u = (float(${i}) - 1.0 + ${id}_h) / ${n}.0; }\n`,
  `${ind}${id}_prev = ${id}_cur;\n`,
];

/** Every segment, in order: for curves that can jump (square, saw, custom), where nothing can be skipped. */
function plainLoop(id: string, vt: string, n: number, point: string, pos: string, dampAt: (tv: string) => string): string[] {
  return [
    `      float t = ${id}_t0;\n`,
    `      float ${id}_damp = ${dampAt('t')};\n`,
    `      ${vt} ${id}_prev = ${point};\n`,
    `      for (int ${id}_i = 1; ${id}_i <= ${n}; ${id}_i++) {\n`,
    ...segmentLines(id, vt, n, point, pos, dampAt, '        ', `${id}_i`),
    `      }\n`,
  ];
}

/**
 * The same nearest segment, found without visiting most of them. The curve moves at most `lip` per
 * unit of t, so every point of a stretch of CHUNK segments lies within (CHUNK / 2) × dt × lip of the
 * stretch's middle vertex. First pass: the middle vertices alone (each is on the polyline, so the
 * nearest of them is an upper bound on the answer). Second pass: only the stretches whose ball comes
 * nearer than the best so far are walked segment by segment. The result is the plain loop's, at a
 * fraction of the cost away from the curve (and most pixels are away from a thin line).
 */
function chunkedLoop(id: string, vt: string, n: number, point: string, pos: string, lip: string, dampAt: (tv: string) => string): string[] {
  const chunks = Math.ceil(n / CHUNK);
  const midOf = (c: string) => `min(float(${c} * ${CHUNK} + ${CHUNK / 2}), ${n}.0)`;
  return [
    `      float t = ${id}_t0;\n`,
    `      float ${id}_damp = 1.0;\n`,
    `      float ${id}_dt = (${id}_t1 - ${id}_t0) / ${n}.0;\n`,
    // A stretch's reach round its middle vertex (its far end is CHUNK / 2 segments away)
    // (× the most Damping can swell it: exp(−Damping × t) passes 1 where t is negative, a Pen's tail at the start)
    `      float ${id}_reach = ${lip} * abs(${id}_dt) * ${CHUNK / 2}.0 * max(1.0, max(${dampAt(`${id}_t0`)}, ${dampAt(`${id}_t1`)}));\n`,
    // Kept apart from the best segment (not seeded into it), so the segment through that vertex still
    // claims it and sets Along.
    `      float ${id}_ub = 1e9;\n`,
    `      for (int ${id}_c = 0; ${id}_c < ${chunks}; ${id}_c++) {\n`,
    `        t = ${id}_t0 + ${id}_dt * ${midOf(`${id}_c`)};\n`,
    `        ${id}_damp = ${dampAt('t')};\n`,
    `        ${vt} ${id}_m = ${pos} - ${point};\n`,
    `        ${id}_ub = min(${id}_ub, dot(${id}_m, ${id}_m));\n`,
    `      }\n`,
    `      for (int ${id}_c = 0; ${id}_c < ${chunks}; ${id}_c++) {\n`,
    `        t = ${id}_t0 + ${id}_dt * ${midOf(`${id}_c`)};\n`,
    `        ${id}_damp = ${dampAt('t')};\n`,
    `        float ${id}_lb = max(length(${pos} - ${point}) - ${id}_reach, 0.0);\n`,
    `        if (${id}_lb * ${id}_lb > min(${id}_d, ${id}_ub)) continue;\n`,
    `        t = ${id}_t0 + ${id}_dt * float(${id}_c * ${CHUNK});\n`,
    `        ${id}_damp = ${dampAt('t')};\n`,
    `        ${vt} ${id}_prev = ${point};\n`,
    `        for (int ${id}_j = 1; ${id}_j <= ${CHUNK}; ${id}_j++) {\n`,
    `          int ${id}_i = ${id}_c * ${CHUNK} + ${id}_j;\n`,
    `          if (${id}_i > ${n}) break;\n`,
    ...segmentLines(id, vt, n, point, pos, dampAt, '          ', `${id}_i`),
    `        }\n`,
    `      }\n`,
  ];
}

/** One axis's piece of the curve's point: its GLSL, its reach and its speed bound (see axisExpr). */
type CurvePart = { expr: string; bound: string | null; lip: string | null };

/**
 * The curve's point at a GLSL float `t` for a set of frequencies: X, Y (and Z) by the node's waves,
 * or the two circles of Rotary motion. The expression reads `t`, `${node.id}_damp` (exp(−Damping × t),
 * set by the caller) and, in a Custom axis, `time`: the caller declares all three.
 */
export function curvePointWith(node: GraphNode, inputVars: Record<string, string>, axes: Axis[], freqOf: (a: Axis) => string): { point: string; parts: CurvePart[] } {
  const id = node.id;
  const vt = axes.length === 3 ? 'vec3' : 'vec2';
  const mode = String(node.params.mode ?? 'lateral');
  const parts = axes.map(a => axisExpr(node, a, inputVars, freqOf));
  const damping = p(node.params.damping, 0);
  if (mode === 'rotary' || mode === 'counter') {
    // Two circles: the first from X's settings, the second from Y's (counter: the second turns the other way).
    const c = (a: Axis) => ({ f: freqOf(a), ph: livePhase(node, inputVars[`phase${a}`] || p(node.params[`phase${a}`], 0), freqOf(a)), r: p(node.params[`amp${a}`], 1) });
    const A = c('X'), B = c('Y'), op = mode === 'counter' ? '-' : '+';
    const offX = p(node.params.offX, 0), offY = p(node.params.offY, 0);
    const lip = `(abs(${A.r}) * (abs(${A.f}) + abs(${damping})) + abs(${B.r}) * (abs(${B.f}) + abs(${damping})))`;
    parts[0] = { expr: `(${offX} + ${id}_damp * (${A.r} * cos(${A.f} * t + ${A.ph}) + ${B.r} * cos(${B.f} * t + ${B.ph})))`, bound: `(abs(${offX}) + abs(${A.r}) + abs(${B.r}))`, lip };
    parts[1] = { expr: `(${offY} + ${id}_damp * (${A.r} * sin(${A.f} * t + ${A.ph}) ${op} ${B.r} * sin(${B.f} * t + ${B.ph})))`, bound: `(abs(${offY}) + abs(${A.r}) + abs(${B.r}))`, lip };
  }
  return { point: `${vt}(${parts.map(x => x.expr).join(', ')})`, parts };
}

/**
 * The curve's point as the node draws it: figure A from the frequencies, blended into figure B
 * (the B frequencies) by Morph amount when Morph is on. Used by Curve Trace and by Ride a curve
 * (agentRideCurve.ts), which evaluates it once per walker.
 */
export function curvePoint(node: GraphNode, inputVars: Record<string, string>, axes: Axis[]): { point: string; shapeA: { point: string; parts: CurvePart[] }; shapeB: { point: string; parts: CurvePart[] } | null } {
  const shapeA = curvePointWith(node, inputVars, axes, a => inputVars[`freq${a}`] || p(node.params[`freq${a}`], 1));
  const shapeB = node.params.morphOn === true ? curvePointWith(node, inputVars, axes, a => inputVars[`freq${a}B`] || p(node.params[`freq${a}B`], 1)) : null;
  const morph = inputVars.morph || p(node.params.morph, 0);
  const point = shapeB ? `mix(${shapeA.point}, ${shapeB.point}, clamp(${morph}, 0.0, 1.0))` : shapeA.point;
  return { point, shapeA, shapeB };
}

/** The shared loop: nearest piece of the polyline and where along it. */
function traceCode(node: GraphNode, inputVars: Record<string, string>, axes: Axis[], pos: string): { code: string; bounds: string[] | null; along: string } {
  const id = node.id;
  const vt = axes.length === 3 ? 'vec3' : 'vec2';
  const { point, shapeA, shapeB } = curvePoint(node, inputVars, axes);
  const both = (x: string | null, y: string | null) => (x && y ? `max(${x}, ${y})` : null);
  const parts = shapeB ? shapeA.parts.map((x, i) => ({ expr: x.expr, bound: both(x.bound, shapeB.parts[i].bound), lip: both(x.lip, shapeB.parts[i].lip) })) : shapeA.parts;
  // How fast the curve can move per unit of t (null: it can jump, so no stretch can be skipped)
  const lip = parts.every(x => x.lip) ? `length(${vt}(${parts.map(x => x.lip).join(', ')}))` : null;
  const n = Math.max(16, Math.min(2048, Math.round(Number(node.params.segments) || 256)));
  const turns = p(node.params.turns, 1);
  const start = inputVars.start || p(node.params.start, 0);
  const end = inputVars.end || p(node.params.end, 1);
  const time = inputVars.time || 'u_time';
  const damping = p(node.params.damping, 0);
  const pen = node.params.draw === 'pen';
  const live = node.params.draw === 'live';
  // Damping: from the start of t, or (Live) from the head back, so the trail shrinks behind the dot.
  const dampAt = (tv: string) => (live ? `exp(-${damping} * (${id}_t1 - ${tv}))` : `exp(-${damping} * ${tv})`);
  const code = [
    `    float ${id}_d  = 1e9;\n`,
    `    float ${id}_u  = 0.0;\n`,
    `    float ${id}_hd = 1e9;\n`,
    `    {\n`,
    `      float time = ${time};\n`,
    ...(live ? [
      // Live: t is real time (2π a second), so a frequency is cycles a second: the dot goes round
      // as fast as the frequency says, and the trail is the last Persistence seconds of its path.
      `      float ${id}_t1 = time * 6.28318;\n`,
      `      float ${id}_t0 = (time - max(${p(node.params.persistence, 0.2)}, 0.0005)) * 6.28318;\n`,
    ] : pen ? [
      // Pen: the head moves Pen speed turns a second; the drawn part is the last Trail turns behind it.
      `      float ${id}_head = time * ${p(node.params.penSpeed, 0.25)};\n`,
      `      float ${id}_t0 = (${id}_head - ${p(node.params.trail, 0.5)}) * 6.28318;\n`,
      `      float ${id}_t1 = ${id}_head * 6.28318;\n`,
    ] : [
      `      float ${id}_t0 = ${start} * ${turns} * 6.28318;\n`,
      `      float ${id}_t1 = ${end} * ${turns} * 6.28318;\n`,
    ]),
    // `__plainLoop` (tests only) forces the plain loop, to check the chunked one against it.
    ...(lip && n >= 2 * CHUNK && node.params.__plainLoop !== true ? chunkedLoop(id, vt, n, point, pos, lip, dampAt) : plainLoop(id, vt, n, point, pos, dampAt)),
    `      ${id}_d = sqrt(${id}_d);\n`,
    // The head: where the curve is at its end (Live and Pen: where the dot is now).
    `      t = ${id}_t1;\n`,
    `      ${id}_damp = ${dampAt('t')};\n`,
    `      ${id}_hd = length(${pos} - ${point});\n`,
    `    }\n`,
  ].join('');
  // Along: 0 → 1 over the drawn part (Pen: tail → head, so it fades a trail).
  const along = pen || live ? `${id}_u` : `mix(${start}, ${end}, ${id}_u)`;
  return { code, bounds: parts.every(x => x.bound) ? parts.map(x => x.bound!) : null, along };
}

const SHAPES_NOTE = 'Lissajous: X 3, Y 2, X phase 1.5708. A circle: X 1, Y 1, phase 1.5708. A harmonograph: X 2, Y 3, Damping 0.05, Turns 8. Rotary opposite ways, X 2, Y 3: a five-pointed star.';

export const CurveTraceNode: NodeDefinition = {
  type: 'curveTrace', label: 'Curve Trace', category: '2D Primitives',
  description: 'A continuous curve from two signals (X and Y as waves or your own GLSL in t), as a distance field you can colour, glow, round or combine like any SDF. Lissajous figures, harmonograph spirals, waveforms.',
  inputs: {
    uv: { type: 'vec2', label: 'UV' },
    time: { type: 'float', label: 'Time', hint: 'The time a Custom formula reads as `time`. Unwired: seconds since the start.' },
    freqX: { type: 'float', label: 'X frequency', hint: 'Overrides X frequency (per cell in a Grid Pattern, say).' },
    freqY: { type: 'float', label: 'Y frequency', hint: 'Overrides Y frequency.' },
    phaseX: { type: 'float', label: 'X phase', hint: 'Overrides X phase: wire Time (× a speed) to make the figure turn.' },
    phaseY: { type: 'float', label: 'Y phase', hint: 'Overrides Y phase.' },
    start: { type: 'float', label: 'Start', hint: 'Overrides Start: draw the curve on.' },
    morph: { type: 'float', label: 'Morph amount', hint: 'Overrides Morph amount (Morph on): wire an LFO to flow between the two figures.' },
    end: { type: 'float', label: 'End', hint: 'Overrides End.' },
  },
  outputs: {
    distance: { type: 'float', label: 'Distance', hint: 'Distance to the curve minus Thickness: negative on the line. An SDF like any other.' },
    along: { type: 'float', label: 'Along', hint: 'Where on the curve the nearest point is: 0 at Start, 1 at End. Colour along the line with it (a Palette on Along).' },
    head: { type: 'float', label: 'Head', hint: 'Distance to the end of the curve: in Live and Pen, the moving dot. Draw a bright dot with it (a glow on Head).' },
  },
  defaultParams: {
    ...axisDefaults('X', { freq: 3, phase: 1.5708, amp: 0.4 }, 'sin(3.0 * t)'),
    ...axisDefaults('Y', { freq: 2, phase: 0, amp: 0.4 }, 'sin(2.0 * t)'),
    ...COMMON_DEFAULTS(0.004, 256),
  },
  paramDefs: {
    ...axisParams('X'),
    ...axisParams('Y'),
    ...COMMON_PARAMS({ def: 0.004, max: 0.3 }, 256),
  },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const uv = inputVars.uv || 'g_uv';
    const { code, along } = traceCode(node, inputVars, ['X', 'Y'], uv);
    return {
      code: `    // Curve Trace. ${SHAPES_NOTE}\n` + code + `    float ${id}_dist = ${id}_d - ${p(node.params.thickness, 0.004)};\n    float ${id}_along = ${along};\n`,
      outputVars: { distance: `${id}_dist`, along: `${id}_along`, head: `${id}_hd` },
    };
  },
};

export const CurveTrace3DNode: NodeDefinition = {
  type: 'curveTrace3D', label: 'Curve Trace 3D', category: '3D Primitives',
  description: 'A continuous 3D curve from three signals (X, Y and Z as waves or your own GLSL in t) as a tube SDF: 3D Lissajous knots, spirals, springs. Use it in a Scene Group like any shape.',
  inputs: {
    pos: { type: 'vec3', label: 'Position' },
    time: { type: 'float', label: 'Time', hint: 'The time a Custom formula reads as `time`. Unwired: seconds since the start.' },
    freqX: { type: 'float', label: 'X frequency' },
    freqY: { type: 'float', label: 'Y frequency' },
    freqZ: { type: 'float', label: 'Z frequency' },
    phaseX: { type: 'float', label: 'X phase', hint: 'Overrides X phase: wire Time to make the knot turn.' },
    phaseY: { type: 'float', label: 'Y phase' },
    phaseZ: { type: 'float', label: 'Z phase' },
    start: { type: 'float', label: 'Start', hint: 'Overrides Start: draw the tube on.' },
    morph: { type: 'float', label: 'Morph amount', hint: 'Overrides Morph amount (Morph on).' },
    end: { type: 'float', label: 'End', hint: 'Overrides End.' },
  },
  outputs: {
    dist: { type: 'float', label: 'Distance', hint: 'Distance to the tube: an SDF like any shape.' },
    along: { type: 'float', label: 'Along', hint: 'Where along the curve (0 at Start, 1 at End): for colour or for varying thickness.' },
    head: { type: 'float', label: 'Head', hint: 'Distance to the end of the curve (in Live and Pen, the moving dot): a ball there with a Sphere-like Thickness.' },
  },
  defaultParams: {
    ...axisDefaults('X', { freq: 3, phase: 1.5708, amp: 1.0 }, 'sin(3.0 * t)'),
    ...axisDefaults('Y', { freq: 2, phase: 0, amp: 1.0 }, 'sin(2.0 * t)'),
    ...axisDefaults('Z', { freq: 5, phase: 0.7854, amp: 1.0 }, 'sin(5.0 * t)'),
    ...COMMON_DEFAULTS(0.06, 192), freqZB: 7,
  },
  paramDefs: {
    ...axisParams('X'),
    ...axisParams('Y'),
    ...axisParams('Z'),
    ...COMMON_PARAMS({ def: 0.06, max: 1 }, 192),
    freqZB: { section: 'Morph', label: 'Z frequency B', type: 'float', min: 0, max: 20, step: 0.01, showWhen: { param: 'morphOn', value: 'true' }, hint: 'Z frequency of the figure it morphs into.' },
  },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const thick = p(node.params.thickness, 0.06);
    const { code, bounds, along } = traceCode(node, inputVars, ['X', 'Y', 'Z'], pos);
    // Far outside the curve's bounding sphere the distance to the sphere is a safe (lower) estimate: skip the loop.
    const wrapped = bounds
      ? `    float ${id}_R = length(vec3(${bounds.join(', ')}));\n`
        + `    float ${id}_far = length(${pos}) - ${id}_R;\n`
        + `    float ${id}_d = ${id}_far;\n    float ${id}_u = 0.0;\n    float ${id}_hd = ${id}_far;\n`
        + `    if (${id}_far < ${thick} + 0.25) {\n` + code.replace(`    float ${id}_d  = 1e9;\n    float ${id}_u  = 0.0;\n    float ${id}_hd = 1e9;\n`, `    ${id}_d = 1e9;\n`) + `    }\n`
      : code;
    return {
      code: `    // Curve Trace 3D. ${SHAPES_NOTE} Z on its own frequency (5) makes a knot.\n` + wrapped
        + `    float ${id}_dist = ${id}_d - ${thick};\n    float ${id}_along = ${along};\n`,
      outputVars: { dist: `${id}_dist`, along: `${id}_along`, head: `${id}_hd` },
    };
  },
};
