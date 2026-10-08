/**
 * scene2d.ts — the three small nodes the 2D Scene Builder needs and the 2D set didn't have
 * (docs/scene-builder-2d-plan.md):
 *
 *   Place 2D    moves, turns and scales one shape (or a whole cluster): the 2D twin of a 3D shape's
 *               Position / Rotation, and it hands out the scale so the distance can be put right.
 *   Motion 2D   a motion for it: orbit, bob, spin or pulse, from Time. Chain several to combine them.
 *   Mirror 2D   folds space onto one side of a line (or two): symmetry in one node.
 *
 * Everything else the builder makes (UV, space transforms, SDF shapes, combines, glow, palettes,
 * tone map, post) is an existing node.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';

const DEG = '0.017453292519943295';
const TAU = '6.28318530718';

export const Place2DNode: NodeDefinition = {
  type: 'place2D',
  label: 'Place 2D',
  category: '2D Space', subcategory: 'Basic',
  aliases: ['place shape', 'move rotate scale', 'shape transform'],
  description:
    'Places a shape: moves it, turns it and scales it, in one node. It does not move the shape itself, it gives the shape a new view of space (the point as the shape sees it), so wire its Local UV into the shape\'s Position. ' +
    'When it scales, a shape drawn through it measures in its own, scaled units: multiply the shape\'s Distance by the Scale output to get it back to the picture\'s units (SDF Union, glow and outlines then stay right).',
  inputs: {
    uv:     { type: 'vec2',  label: 'UV', hint: 'The space to place the shape in: UV, or the output of another Place 2D or a space transform.' },
    offset: { type: 'vec2',  label: 'Offset', hint: 'Added to Move: wire a Motion 2D here for a shape that orbits or bobs.' },
    turn:   { type: 'float', label: 'Turn (rad)', hint: 'Added to Rotate, in radians: wire a Motion 2D here for a shape that spins.' },
    grow:   { type: 'float', label: 'Grow', hint: 'Multiplies Scale: wire a Motion 2D here for a shape that pulses. Leave empty for 1.' },
  },
  outputs: {
    p:     { type: 'vec2',  label: 'Local UV', hint: 'The point as the placed shape sees it. Wire into a shape\'s Position.' },
    scale: { type: 'float', label: 'Scale', hint: 'How much bigger the shape is drawn (Scale × Grow). Multiply the shape\'s Distance by it.' },
  },
  defaultParams: { x: 0.0, y: 0.0, rotate: 0.0, scale: 1.0 },
  paramDefs: {
    x:      { label: 'Move X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the shape\'s centre sits, left to right.' },
    y:      { label: 'Move Y', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the shape\'s centre sits, bottom to top.' },
    rotate: { label: 'Rotate (deg)', type: 'float', min: -360, max: 360, step: 0.5, hint: 'Turns the shape counter-clockwise about its centre.' },
    scale:  { label: 'Scale', type: 'float', min: 0.05, max: 8, step: 0.01, hint: 'Makes the shape bigger (above 1) or smaller. Multiply its Distance by the Scale output afterwards.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv = inputVars.uv ?? 'g_uv';
    const off = inputVars.offset ? ` + ${inputVars.offset}` : '';
    const turn = inputVars.turn ? ` + ${inputVars.turn}` : '';
    const grow = inputVars.grow ? ` * max(${inputVars.grow}, 0.0001)` : '';
    return {
      code: [
        `    vec2  ${id}_at = vec2(${p(node.params.x, 0)}, ${p(node.params.y, 0)})${off};\n`,
        `    float ${id}_scale = max(${p(node.params.scale, 1)}, 0.0001)${grow};\n`,
        `    float ${id}_a = ${p(node.params.rotate, 0)} * ${DEG}${turn};\n`,
        `    vec2  ${id}_q = ${uv} - ${id}_at;\n`,
        `    vec2  ${id}_p = vec2(cos(${id}_a) * ${id}_q.x + sin(${id}_a) * ${id}_q.y, -sin(${id}_a) * ${id}_q.x + cos(${id}_a) * ${id}_q.y) / ${id}_scale;\n`,
      ].join(''),
      outputVars: { p: `${id}_p`, scale: `${id}_scale` },
    };
  },
};

export const Motion2DNode: NodeDefinition = {
  type: 'motion2D',
  label: 'Motion 2D',
  category: '2D Space', subcategory: 'Basic',
  aliases: ['orbit', 'bob', 'spin', 'pulse', 'shape motion'],
  description:
    'One motion for a shape, driven by Time: Orbit goes round a circle, Bob slides back and forth along a line, Spin turns, Pulse swells and shrinks. ' +
    'Wire Offset, Turn and Grow into a Place 2D. To give a shape two motions, chain a second Motion 2D after the first: it adds its motion to what comes in.',
  inputs: {
    time:   { type: 'float', label: 'Time', hint: 'Seconds. Left empty it uses the clock.' },
    offset: { type: 'vec2',  label: 'Offset in', hint: 'Another Motion 2D\'s Offset: this motion is added to it.' },
    turn:   { type: 'float', label: 'Turn in', hint: 'Another Motion 2D\'s Turn: this motion is added to it.' },
    grow:   { type: 'float', label: 'Grow in', hint: 'Another Motion 2D\'s Grow: this motion multiplies it.' },
  },
  outputs: {
    offset: { type: 'vec2',  label: 'Offset', hint: 'Where the motion has moved the shape. Into a Place 2D\'s Offset.' },
    turn:   { type: 'float', label: 'Turn (rad)', hint: 'How far it has turned, in radians. Into a Place 2D\'s Turn.' },
    grow:   { type: 'float', label: 'Grow', hint: 'How much it has swollen: 1 is its own size. Into a Place 2D\'s Grow.' },
  },
  defaultParams: { mode: 'orbit', speed: 0.25, amount: 0.3, phase: 0.0, direction: 0.0 },
  paramDefs: {
    mode:      { label: 'Motion', type: 'select', hint: 'Orbit: round a circle. Bob: along a line. Spin: turn in place. Pulse: swell and shrink.', options: [
      { value: 'orbit', label: 'Orbit' }, { value: 'bob', label: 'Bob' }, { value: 'spin', label: 'Spin' }, { value: 'pulse', label: 'Pulse' },
    ] },
    speed:     { label: 'Speed (cycles/s)', type: 'float', min: -4, max: 4, step: 0.01, hint: 'Whole cycles a second. 0.25 is one lap every four seconds; negative goes the other way.' },
    amount:    { label: 'Amount', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Orbit: the radius. Bob: how far each way. Pulse: how much it swells (0.3 is 30% bigger at most). Spin: not used.', showWhen: { param: 'mode', value: ['orbit', 'bob', 'pulse'] } },
    phase:     { label: 'Phase (deg)', type: 'float', min: -360, max: 360, step: 1, hint: 'Where in the cycle it starts: give copies different phases so they do not move together.' },
    direction: { label: 'Direction (deg)', type: 'float', min: -180, max: 180, step: 1, hint: 'Bob: the line it slides along (0 is left to right, 90 is up and down).', showWhen: { param: 'mode', value: 'bob' } },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const mode = String(node.params.mode ?? 'orbit');
    const t = inputVars.time ?? 'u_time';
    const lines = [
      `    float ${id}_w = ${TAU} * ${p(node.params.speed, 0.25)} * ${t} + ${p(node.params.phase, 0)} * ${DEG};\n`,
      `    vec2  ${id}_offset = ${inputVars.offset ?? 'vec2(0.0)'};\n`,
      `    float ${id}_turn = ${inputVars.turn ?? '0.0'};\n`,
      `    float ${id}_grow = ${inputVars.grow ?? '1.0'};\n`,
    ];
    const amt = p(node.params.amount, 0.3);
    if (mode === 'orbit') lines.push(`    ${id}_offset += ${amt} * vec2(cos(${id}_w), sin(${id}_w));\n`);
    else if (mode === 'bob') lines.push(`    ${id}_offset += ${amt} * sin(${id}_w) * vec2(cos(${p(node.params.direction, 0)} * ${DEG}), sin(${p(node.params.direction, 0)} * ${DEG}));\n`);
    else if (mode === 'spin') lines.push(`    ${id}_turn += ${id}_w;\n`);
    else lines.push(`    ${id}_grow *= 1.0 + ${amt} * sin(${id}_w);\n`);
    return { code: lines.join(''), outputVars: { offset: `${id}_offset`, turn: `${id}_turn`, grow: `${id}_grow` } };
  },
};

export const Mirror2DNode: NodeDefinition = {
  type: 'mirror2D',
  label: 'Mirror 2D',
  category: '2D Space', subcategory: 'Repeat',
  aliases: ['symmetry', 'fold', 'flip', 'reflect'],
  description:
    'Folds space over a line so the two sides match: what is drawn on one side appears mirrored on the other. Mirror X makes left and right the same, Mirror Y makes top and bottom the same, both makes four quarters. ' +
    'Move the fold line with Offset. (For rotational symmetry use Kaleidoscope or Angular Repeat.)',
  inputs: { uv: { type: 'vec2', label: 'UV' } },
  outputs: { uv: { type: 'vec2', label: 'Folded UV' } },
  defaultParams: { axes: 'x', offsetX: 0.0, offsetY: 0.0 },
  paramDefs: {
    axes:    { label: 'Mirror', type: 'select', hint: 'Which lines to fold over: the vertical line (X), the horizontal line (Y) or both.', options: [
      { value: 'x', label: 'Left / right (X)' }, { value: 'y', label: 'Top / bottom (Y)' }, { value: 'xy', label: 'Both (four quarters)' },
    ] },
    offsetX: { label: 'Offset X', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'axes', value: ['x', 'xy'] }, hint: 'Where the vertical fold line sits.' },
    offsetY: { label: 'Offset Y', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'axes', value: ['y', 'xy'] }, hint: 'Where the horizontal fold line sits.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv = inputVars.uv ?? 'g_uv';
    const axes = String(node.params.axes ?? 'x');
    const lines = [`    vec2 ${id}_uv = ${uv};\n`];
    if (axes.includes('x')) lines.push(`    ${id}_uv.x = abs(${id}_uv.x - ${p(node.params.offsetX, 0)}) + ${p(node.params.offsetX, 0)};\n`);
    if (axes.includes('y')) lines.push(`    ${id}_uv.y = abs(${id}_uv.y - ${p(node.params.offsetY, 0)}) + ${p(node.params.offsetY, 0)};\n`);
    return { code: lines.join(''), outputVars: { uv: `${id}_uv` } };
  },
};

export const SCENE2D_NODES = { place2D: Place2DNode, motion2D: Motion2DNode, mirror2D: Mirror2DNode };
