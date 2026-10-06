/**
 * simGridExamples.ts — the "Simulations: grids" folder (docs/simulations-grids.md): cellular
 * automata and grid simulations built only from existing nodes. A Pass holds the board; its
 * Previous output is the board one step ago; Sample (texture) and Neighbours (texture) read the
 * cells round each one; Compare, Mix and Max write the rule. Built from the node definitions
 * (graphBuilder.ts).
 *
 * Every node carries a plain-language note saying what it does and why it is there; an
 * Expression Block's note explains each named line ("name: …").
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import type { PlayControl, PlayMapping, PlayRecord, PlaySource } from '../types/play';
import { colourCtl, ctl, n } from './graphBuilder';
import RIDGES_AT_DUSK from './playAssets/ridges-at-dusk.jpg?inline';

export const SIM_GRID_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  simGridLife: {
    label: 'Grid sims 1 · Game of Life', play: true,
    description: 'Conway\'s Game of Life on a blocky board: a Pass at ⅛ size with Nearest sampling holds the cells, eight Sample (texture) reads of its Previous count the neighbours, and Compare nodes apply B3/S23. Noise seeds it, Reset starts again, the mouse paints live cells, and dead cells fade through an afterglow.',
  },
  simGridLifeLike: {
    label: 'Grid sims 2 · Life-like rules', play: true,
    description: 'The same board with the rule as switches: which neighbour counts give birth and which let a cell survive. Flip them for HighLife (B36/S23), Seeds (B2/S), Day & Night (B3678/S34678), Maze, Coral and more.',
  },
  simGridBrain: {
    label: 'Grid sims 3 · Brian\'s Brain', play: true,
    description: 'A three-state automaton (on, dying, off) in two channels of a Pass: an off cell with exactly two on neighbours turns on, on cells start dying, dying cells switch off. The result is endless gliding sparks.',
  },
  simGridCave: {
    label: 'Grid sims 4 · Cave generator', play: true,
    description: 'Noise smoothed into caves by the 4-5 rule (a cell is rock when 5 or more of its 3×3 block are rock), run 8 times a frame with the Pass\'s Repeat. A second Pass holds the blurred rock as height for a terrain palette and hill shading. Move Seed for a new map.',
  },
  simGridWater: {
    label: 'Grid sims 5 · Water ripples', play: true,
    description: 'The two-buffer water of Hugo Elias: a Pass keeps this height and the last one, Neighbours (Difference from average) spreads them as waves, damping calms them. Raindrops and the mouse drop ripples; Flow (texture) bends a photo through the surface.',
  },
  simGridHeat: {
    label: 'Grid sims 6 · Heat diffusion', play: true,
    description: 'Paint heat with the mouse and watch it spread and cool: each step blends every cell towards its Neighbours average (diffusion) and takes a little off (cooling). Drifting hot spots keep it going; a Stops Palette colours the temperature.',
  },
  simGridFire: {
    label: 'Grid sims 7 · Forest fire', play: true,
    description: 'The Drossel–Schwabl forest fire: trees grow on empty ground, lightning now and then sets one alight, fire spreads to the trees round it (Neighbours, Max) and leaves glowing ash. Per-cell hashed noise with Time rolls the dice. Click to start a fire.',
  },
  simGridSand: {
    label: 'Grid sims 8 · Falling sand', play: true,
    description: 'Falling sand made only from gathers: every cell decides from its 3×3 block whether a grain leaves it or arrives, so no grain is lost or doubled. Grains fall, then slide to one side, the side flipping every frame. Spouts pour sand; the mouse pours more.',
  },
  simGridWire: {
    label: 'Grid sims 9 · Wireworld', play: true,
    description: 'Brian Silverman\'s Wireworld: copper wire, electron heads and tails. A head becomes a tail, a tail becomes copper, and copper becomes a head when one or two heads touch it. Loops on a grid of wires send electrons pulsing through it; click a wire to send one more.',
  },
};

/** The ordered keys, for the Simulations: grids folder. */
export const SIM_GRID_EXAMPLE_KEYS = Object.keys(SIM_GRID_EXAMPLE_INDEX);

// ── Helpers ─────────────────────────────────────────────────────────────────

/** A node comment (shown on the card's Comment tab and, as // lines, in the generated code). */
const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

const mouseDown: PlaySource = { kind: 'mouse', axis: 'down' };
const mapTo = (id: string, controlId: string, source: PlaySource, outMin = 0, outMax = 1): PlayMapping =>
  ({ id, controlId, source, outMin, outMax, curve: 'linear', smoothMs: 0, enabled: true });
const toggle = (id: string, target: string, label: string, group?: string): PlayControl =>
  ({ ...ctl(id, target, label, 0, 1, 1), toggle: true, ...(group ? { group } : {}) });

function playRecord(controls: PlayControl[], notes: string, mappings: PlayMapping[] = []): PlayRecord {
  return { version: 1, controls, mappings, layers: [], notes };
}

type Wire = [string, string];

/** An Expression Block: named inputs (wired as given), lines `type name = rhs`, a result; its note explains every named line. */
function expr(id: string, x: number, y: number, o: {
  label: string; outputType: 'float' | 'vec2' | 'vec3';
  inputs: Array<[name: string, type: 'float' | 'vec2' | 'vec3', from: Wire]>;
  lines: Array<[lhs: string, rhs: string]>;
  result: string; note: string[];
}): GraphNode {
  const node = n('exprNode', id, x, y, {
    label: o.label,
    inputs: o.inputs.map(([name, type]) => ({ name, type, slider: null })),
    outputType: o.outputType,
    lines: o.lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
    result: o.result, expr: o.result,
    ...note(o.note),
  });
  node.inputs = Object.fromEntries(o.inputs.map(([name, type, from]) => [name, { type, label: name, connection: { nodeId: from[0], outputKey: from[1] } }]));
  node.outputs = { result: { type: o.outputType, label: 'Result' } };
  return node;
}

/** A Mix retyped to colours: A, B and the result are vec3 (as its type pill set to vec3). */
function colourMix(id: string, x: number, y: number, params: Record<string, unknown>, wires: Record<string, Wire>): GraphNode {
  const m = n('mix', id, x, y, { outputType: 'vec3', ...params }, wires);
  return { ...m, inputs: { ...m.inputs, a: { ...m.inputs.a, type: 'vec3' }, b: { ...m.inputs.b, type: 'vec3' } }, outputs: { result: { ...m.outputs.result, type: 'vec3' } } };
}

/** A Multiply retyped to vec2 (the mouse's pixels times the Pass's scale). */
function vec2Scale(id: string, x: number, y: number, by: number, from: Wire, why: string): GraphNode {
  const m = n('multiply', id, x, y, { outputType: 'vec2', b: by, ...note(why) }, { a: from });
  return { ...m, inputs: { ...m.inputs, a: { ...m.inputs.a, type: 'vec2' }, b: { ...m.inputs.b, type: 'vec2' } }, outputs: { result: { ...m.outputs.result, type: 'vec2' } } };
}

/** A Constants card of live float entries (each an output and a Play target `id::key`). */
function constantsCard(id: string, x: number, y: number, label: string, items: Array<[key: string, label: string, value: number]>, why: string, max = 1): GraphNode {
  const node = n('constants', id, x, y, {
    label,
    items: items.map(([key, lbl, value]) => ({ key, label: lbl, type: 'float', value, slider: true, min: 0, max })),
    ...Object.fromEntries(items.map(([key, , value]) => [key, value])),
    ...note(why),
  });
  node.outputs = Object.fromEntries(items.map(([key, lbl]) => [key, { type: 'float', label: lbl }]));
  return node;
}

/** The eight neighbours (Moore neighbourhood), named by compass point, as cell offsets (x right, y up). */
const MOORE: Array<[name: string, dx: number, dy: number, word: string]> = [
  ['N', 0, 1, 'above'], ['NE', 1, 1, 'above right'], ['E', 1, 0, 'right'], ['SE', 1, -1, 'below right'],
  ['S', 0, -1, 'below'], ['SW', -1, -1, 'below left'], ['W', -1, 0, 'left'], ['NW', -1, 1, 'above left'],
];

/**
 * Eight Sample (texture) nodes reading the board one cell away in each direction. `cell` is one
 * board cell in picture pixels (8 for a Pass at ⅛ size): Sample's Offset is in picture pixels, so
 * with Nearest sampling each read lands on the middle of the next cell, exactly.
 */
function mooreSamples(prefix: string, board: string, cell: number, x: number, y: number, what: string): GraphNode[] {
  return MOORE.map(([name, dx, dy, word], i) => n('sampleTexture', `${prefix}${name}`, x, y + i * 150, {
    offsetX: dx * cell, offsetY: dy * cell,
    ...note(`Sample (texture): the cell ${word} (${name}), from the board one step ago (the Pass's Previous). Offset ${dx * cell}, ${dy * cell} picture pixels is one cell at this Pass's size. ${what}`),
  }, { texture: [board, 'previous'] }));
}

/** The sum of eight neighbour reads, as one Expression Block (one line reads better than seven Add cards). */
function countBlock(id: string, x: number, y: number, prefix: string, channel: 'alpha' | 'r', what: string): GraphNode {
  const names = MOORE.map(([name]) => name.toLowerCase());
  return expr(id, x, y, {
    label: 'Count the neighbours', outputType: 'float',
    inputs: MOORE.map(([name], i) => [names[i], channel === 'alpha' ? 'float' : 'vec3', [`${prefix}${name}`, channel === 'alpha' ? 'alpha' : 'color']]),
    lines: [],
    result: names.map(nm => (channel === 'alpha' ? nm : `${nm}.r`)).join(' + '),
    note: [
      `Count the neighbours: adds up the eight neighbour reads (${what}), so the result is how many of the 8 cells round this one are set: 0 to 8.`,
      'Why an Expression Block: one sum of eight reads is clearer as one line than as seven Add cards.',
      'result: n + ne + e + se + s + sw + w + nw.',
    ],
  });
}

/**
 * A rare random event at a random place: `rate` events a second, each at a spot picked by hashing
 * the event's number (Time × rate, rounded down). Per-cell dice can't do rare events: the hash's
 * numbers come in steps of about 1/256 near 0, so a chance below ~0.004 per cell is not honoured.
 * Ids: `${p}Clock` (Multiply, B = rate: the Play target), `${p}Spot` (Compare: 1 on the spot), `${p}Phase` (0→1 per event).
 */
function timedSpot(p: string, x: number, y: number, o: { rate: number; radius: number; soft: number; what: string }): GraphNode[] {
  return [
    n('multiply', `${p}Clock`, x, y, { b: o.rate, ...note(`Multiply: Time × ${o.what} per second (B). Its whole part counts the events, its fraction is how far into this one we are.`) }, { a: ['time', 'time'] }),
    n('floor', `${p}Index`, x + 300, y - 80, note('Floor: the event\'s number (0, 1, 2…). It changes once per event.'), { input: [`${p}Clock`, 'result'] }),
    n('fractRaw', `${p}Phase`, x + 300, y + 80, note('Fract (scalar): how far into the current event, 0 to 1.'), { input: [`${p}Clock`, 'result'] }),
    n('makeVec2', `${p}Key`, x + 600, y - 80, { y: 0.5, ...note('Make Vec2: the event\'s number as a point, to hash below (one random place per event).') }, { x: [`${p}Index`, 'output'] }),
    n('noiseFloat', `${p}X`, x + 900, y - 160, { mode: 'hash', scale: 1, speed: 0, outMin: -1.7, outMax: 1.7, ...note('Noise Float, Hash: a random X for this event, spread across the picture (Out Min / Max ±1.7).') }, { uv: [`${p}Key`, 'xy'] }),
    n('noiseFloat', `${p}Y`, x + 900, y, { mode: 'hash', scale: 1.37, speed: 0, outMin: -0.95, outMax: 0.95, ...note('Noise Float, Hash (another Scale, so another number): a random Y for this event.') }, { uv: [`${p}Key`, 'xy'] }),
    n('makeVec2', `${p}At`, x + 1200, y - 80, note(`Make Vec2: where this one lands (${o.what}).`), { x: [`${p}X`, 'value'], y: [`${p}Y`, 'value'] }),
    n('circleSDF', `${p}Dist`, x + 1500, y - 80, { radius: o.radius, ...note(`Circle SDF: how far this cell is from that place, minus Radius (${o.radius} in picture units).`) }, { position: ['uv', 'uv'], offset: [`${p}At`, 'xy'] }),
    n('compare', `${p}Spot`, x + 1800, y - 80, { operator: '<', smoothing: o.soft, ...note('Compare (< 0, B left empty): 1 on the spot.') }, { a: [`${p}Dist`, 'distance'] }),
  ];
}

// ── The board kit shared by Life, Life-like rules and Brian's Brain ─────────

/**
 * The parts every "blocky board" automaton here shares: where this cell is, the board one step
 * ago, its 8 neighbours counted, a step clock (Speed), a noise seed with Reset, and a mouse brush.
 * The board Pass itself (`board`) and the rule are the example's own.
 *
 * Board channels: Alpha = the main state (alive / on), Red = the example's second state, Green = 1
 * once the board has started (0 on the very first frame, when the Pass is still empty), Blue = the
 * step clock's phase.
 */
function boardKit(o: { cell: number; seedScale: number; density: number; speed: number; brush: number; stateWord: string }): GraphNode[] {
  const s = 1 / o.cell;
  return [
    n('uv', 'uv', 40, 1500, note('UV: this cell\'s place in the picture. The seed noise is read at it, so every cell gets its own roll.')),
    n('time', 'time', 40, 1700, note('Time: seconds since the start. Fed into the seed noise so each Reset deals a new board.')),
    n('fragCoord', 'pix', 40, 1900, note('Pixel Coordinates: inside the board\'s Pass this counts board cells (the Pass draws one pixel per cell). The brush is measured in cells with it.')),
    n('mouse', 'mouse', 40, 2100, note('Mouse: its Pixels output is where the pointer is, in picture pixels. Below it is scaled to board cells.')),

    n('sampleTexture', 'self', 340, 120, note([
      `Sample (texture): this cell one step ago (the board Pass\'s Previous). Alpha is ${o.stateWord}; Color carries the other channels.`,
      'With the Pass on Nearest, the read is exactly this cell, never a blend of two.',
    ]), { texture: ['board', 'previous'] }),
    n('splitVec3', 'selfParts', 640, 120, note('Split Vec3: the Color read in three numbers. X (red) is the second state, Y (green) is 1 once the board has started, Z (blue) is the step clock.'), { v: ['self', 'color'] }),

    n('constant', 'speed', 640, 1250, { value: o.speed, label: 'Speed', ...note('Speed: steps per frame, 0 to 1. At 1 the rule runs every frame (60 steps a second); at 0.25 every fourth frame. A constant so Play can drive it.') }),
    n('add', 'clock', 940, 1250, note('Add: the step clock. Last frame\'s phase (blue) plus Speed. When it reaches 1, a step is due.'), { a: ['selfParts', 'z'], b: ['speed', 'value'] }),
    n('floor', 'tick', 1240, 1180, note('Floor: 1 on the frames where the clock passed 1 (a step happens), 0 on the others (the board holds still).'), { input: ['clock', 'result'] }),
    n('fractRaw', 'phase', 1240, 1340, note('Fract (scalar): the clock with the whole step taken off, stored in blue for the next frame.'), { input: ['clock', 'result'] }),

    n('noiseFloat', 'seedNoise', 640, 1500, { mode: 'hash', scale: o.seedScale, speed: 1,
      ...note('Noise Float, Hash: a different random number (0 to 1) for every cell, and a new set every moment because Time is wired in. Used for the starting board and the brush.') },
    { uv: ['uv', 'uv'], time: ['time', 'time'] }),
    n('constant', 'density', 640, 1700, { value: o.density, label: 'Density', ...note('Density: the share of cells that start set (0 to 1). A constant so Play can drive it.') }),
    n('compare', 'seedOn', 940, 1560, { operator: '<', ...note('Compare (<): 1 where the cell\'s roll is under Density. That many cells start set: the random first board.') }, { a: ['seedNoise', 'value'], b: ['density', 'value'] }),

    n('compare', 'fresh', 940, 1800, { operator: '≈', smoothing: 0.5, ...note('Compare (≈ 0, B left empty): 1 when green is 0. Green is only 0 on the very first frame (the Pass starts empty) or after its texture is made again, so the board seeds itself.') }, { a: ['selfParts', 'y'] }),
    n('constant', 'reset', 940, 1960, { value: 0, label: 'Reset', ...note('Reset: while 1, the board is dealt again from the noise every frame. Flip it on and off (a switch in Play) for a new board.') }),
    n('max', 'restart', 1240, 1860, note('Max: start over when this is the first frame or Reset is on.'), { a: ['fresh', 'mask'], b: ['reset', 'value'] }),

    vec2Scale('brushAt', 340, 2100, s, ['mouse', 'px'], `Multiply (vec2): the pointer\'s picture pixels times ${s} (the board Pass\'s Scale), so the pointer is in board cells like Pixel Coordinates. (Mouse\'s UV is measured against the picture, not the smaller Pass.)`),
    n('circleSDF', 'brushDist', 640, 2000, { radius: o.brush, ...note(`Circle SDF: how far this cell is from the pointer, in cells, minus Radius (${o.brush} cells). Below 0 inside the brush.`) }, { position: ['pix', 'coord'], offset: ['brushAt', 'result'] }),
    n('compare', 'inBrush', 940, 2060, { operator: '<', ...note('Compare (< 0, B left empty): 1 inside the brush circle.') }, { a: ['brushDist', 'distance'] }),
    n('constant', 'brushOn', 940, 2220, { value: 0, label: 'Brush (mouse button)', ...note('Brush: 1 while the mouse button is down. Play maps the mouse button onto it, so the brush only paints while you hold the button (it stays 0 in the editor until Play is on).') }),
    n('multiply', 'paint', 1240, 2100, note('Multiply: inside the brush and the button is down.'), { a: ['inBrush', 'mask'], b: ['brushOn', 'value'] }),
  ];
}

// ── 1 · Game of Life ────────────────────────────────────────────────────────

const LIFE_CELL = 8; // picture pixels per cell: the board Pass is at ⅛ size

function lifeDisplay(x: number, y: number, deadTo: [number, number, number][], alive: [number, number, number]): GraphNode[] {
  return [
    n('splitVec3', 'showParts', x, y + 200, note('Split Vec3: the board as it is now (the Pass\'s Color at this pixel). X (red) is the afterglow.'), { v: ['board', 'color'] }),
    n('stopPalette', 'glowColour', x + 300, y + 200, {
      stops: '5', wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
      color0: deadTo[0], color1: deadTo[1], color2: deadTo[2], color3: deadTo[3], color4: deadTo[4],
      ...note('Stops Palette: the afterglow as colour. 0 (long empty) is the dark background; a cell that has just died is warm and cools down the palette as it fades.') },
    { value: ['showParts', 'x'] }),
    n('colorPicker', 'aliveColour', x + 300, y + 480, { color: alive, ...note('Color: the colour of a live cell. Click the swatch to change it.') }),
    colourMix('cells', x + 600, y + 260, { t: 0.5, ...note('Mix: the afterglow colour, or the live colour where the cell is alive (Blend is the board\'s Alpha, 1 for a live cell).') }, { a: ['glowColour', 'color'], b: ['aliveColour', 'rgb'], t: ['board', 'alpha'] }),
    n('output', 'out', x + 900, y + 260, note('Output: the board, one block per cell (the Pass is read with Nearest sampling, so cells stay square). The board Pass draws first each frame.'), { color: ['cells', 'result'] }),
  ];
}

function lifeTail(x: number, ruleNext: Wire, label: string): GraphNode[] {
  return [
    n('mix', 'stepped', x, 400, note('Mix: on a step frame (Blend = the tick) the rule\'s answer, otherwise the cell as it was. This is how Speed slows the board down.'), { a: ['self', 'alpha'], b: ruleNext, t: ['tick', 'output'] }),
    n('mix', 'seeded', x + 300, 400, note('Mix: the random board instead when starting over (first frame or Reset).'), { a: ['stepped', 'result'], b: ['seedOn', 'mask'], t: ['restart', 'result'] }),
    n('multiply', 'paintCells', x + 300, 640, note('Multiply: the brush paints a random half of the cells under it (the seed roll), so a stroke lands as a fizzing patch rather than a solid block, which would just die from crowding.'), { a: ['paint', 'result'], b: ['seedOn', 'mask'] }),
    n('max', 'aliveSoft', x + 600, 400, note('Max: alive if the rule (or the seed) says so, or the brush painted it.'), { a: ['seeded', 'result'], b: ['paintCells', 'result'] }),
    n('round', 'alive', x + 600, 560, note('Round: exactly 0 or 1. A Compare can, very rarely, land between the two (a brush edge right on a cell\'s centre), and a half-alive cell would muddy every count round it.'), { input: ['aliveSoft', 'result'] }),
    n('multiply', 'glowFade', x + 300, 120, { b: 0.93, ...note('Multiply: last frame\'s afterglow (red) times Afterglow (B, 0.93 per frame), so a dead cell fades over about a second. A live param so Play can drive it.') }, { a: ['selfParts', 'x'] }),
    n('max', 'glow', x + 600, 160, note('Max: a live cell glows fully (1); a dead one keeps its fading afterglow.'), { a: ['glowFade', 'result'], b: ['alive', 'output'] }),
    n('makeVec3', 'pack', x + 900, 260, { g: 1, ...note('Make Vec3: what the board stores besides Alpha: red the afterglow, green 1 (the board has started), blue the step clock\'s phase.') }, { r: ['glow', 'result'], b: ['phase', 'output'] }),
    n('pass', 'board', x + 1200, 300, { label, scale: '0.125', filter: 'nearest', wrap: 'repeat', format: 'half',
      ...note([
        'Pass, the board: one pixel per cell at ⅛ size (240 × 135 cells on a 1080p picture). Alpha holds alive (1) or dead (0).',
        'Nearest keeps every read exactly one cell; Edges Repeat wraps the board round (a torus), so gliders leave one side and come back on the other.',
        'Its Previous output is this board one frame ago: every read above comes from it.',
      ]) },
    { color: ['pack', 'rgb'], alpha: ['alive', 'output'] }),
  ];
}

// ── The builder ─────────────────────────────────────────────────────────────

export function buildSimGridExamples(): Record<string, ExampleGraph> {
  const g: Record<string, ExampleGraph> = {};

  // ── 1 · Game of Life ──
  g.simGridLife = {
    ...SIM_GRID_EXAMPLE_INDEX.simGridLife,
    counter: 80,
    nodes: [
      ...boardKit({ cell: LIFE_CELL, seedScale: 37.3, density: 0.3, speed: 0.5, brush: 4, stateWord: 'alive (1) or dead (0)' }),
      ...mooreSamples('nb', 'board', LIFE_CELL, 340, 300, 'Its Alpha is 1 if that cell is alive.'),
      countBlock('count', 640, 520, 'nb', 'alpha', 'each read\'s Alpha, 1 for a live cell'),
      constantsCard('ruleNums', 640, 820, 'Rule B3/S23', [['born', 'Born with', 3], ['stayA', 'Survives with', 2], ['stayB', 'or with', 3]],
        'Constants: the rule\'s three numbers. A dead cell with exactly Born with (3) neighbours is born; a live cell with Survives with (2) or (3) neighbours lives on. Live entries, so Play can change them.', 8),
      n('compare', 'born', 940, 420, { operator: '≈', smoothing: 0.5, ...note('Compare (≈): 1 when the count is exactly Born with (3). Counts are whole numbers, so a smoothing of 0.5 makes it an exact match.') }, { a: ['count', 'result'], b: ['ruleNums', 'born'] }),
      n('compare', 'stayA', 940, 600, { operator: '≈', smoothing: 0.5, ...note('Compare (≈): 1 when the count is exactly 2.') }, { a: ['count', 'result'], b: ['ruleNums', 'stayA'] }),
      n('compare', 'stayB', 940, 780, { operator: '≈', smoothing: 0.5, ...note('Compare (≈): 1 when the count is exactly 3.') }, { a: ['count', 'result'], b: ['ruleNums', 'stayB'] }),
      n('max', 'stays', 1240, 690, note('Max: a live cell survives with 2 or with 3 neighbours (either match).'), { a: ['stayA', 'mask'], b: ['stayB', 'mask'] }),
      n('mix', 'ruleNext', 1240, 470, note('Mix: the rule. For a dead cell (Blend = its Alpha, 0) the answer is Born; for a live one (1) it is Survives.'), { a: ['born', 'mask'], b: ['stays', 'result'], t: ['self', 'alpha'] }),
      ...lifeTail(1540, ['ruleNext', 'result'], 'Life board'),
      ...lifeDisplay(2740, 300,
        [[0.02, 0.025, 0.05], [0.12, 0.05, 0.22], [0.55, 0.12, 0.35], [0.95, 0.45, 0.2], [1.0, 0.8, 0.45]],
        [0.85, 1.0, 0.92]),
    ],
    play: playRecord([
      ctl('speed', 'speed::value', 'Speed (steps per frame)', 0.02, 1, 0.01),
      ctl('density', 'density::value', 'Seed density', 0.02, 0.9, 0.01),
      toggle('reset', 'reset::value', 'Reset'),
      ctl('afterglow', 'glowFade::b', 'Afterglow', 0, 0.99, 0.005),
      ctl('born', 'ruleNums::born', 'Born with', 0, 8, 1),
      ctl('stayA', 'ruleNums::stayA', 'Survives with', 0, 8, 1),
      ctl('stayB', 'ruleNums::stayB', 'or with', 0, 8, 1),
      ctl('brush', 'brushDist::radius', 'Brush size (cells)', 1, 30, 0.5),
      ctl('brushOn', 'brushOn::value', 'Brush (mouse button)', 0, 1, 1),
      colourCtl('aliveColour', 'aliveColour::color', 'Live cells'),
    ], `**What it shows.** Conway's Game of Life (Gardner, 1970) with no new nodes: a Pass holds the board and remembers it, its Previous output is the board one step ago, and ordinary nodes write the rule.

**How it is built.** The Life board Pass is at ⅛ size with Nearest sampling, so each pixel of it is a cell and reads never blend. Sample (texture) reads this cell and its eight neighbours from Previous; one Expression Block adds the eight up. Compare nodes check the count against the rule (born with 3, survives with 2 or 3), and a Mix picks Born or Survives by whether the cell is alive. Noise seeds the board on the first frame and while Reset is on; the mouse button paints. Red keeps an afterglow that fades after a cell dies, coloured by a Stops Palette.

**Try.** Hold the mouse button and draw. Slow Speed right down to watch single steps. Flip Reset on and off for a new board, at a different Seed density. Change the rule numbers on the Constants card (born with 3, survives with 2 or 3).`,
    [mapTo('mouseBrush', 'brushOn', mouseDown)]),
  };

  // ── 2 · Life-like rules: Born / Survives as 18 switches ──
  const DAY_NIGHT_BORN = [3, 6, 7, 8], DAY_NIGHT_SURVIVE = [3, 4, 6, 7, 8];
  const ruleCard = (id: string, y: number, label: string, on: number[], why: string) =>
    constantsCard(id, 640, y, label, Array.from({ length: 9 }, (_, k) => [`n${k}`, `${k}`, on.includes(k) ? 1 : 0] as [string, string, number]), why);
  const lookup = (id: string, y: number, card: string, what: string) => expr(id, 940, y, {
    label: what === 'born' ? 'Born?' : 'Survives?', outputType: 'float',
    inputs: [['count', 'float', ['count', 'result']], ...Array.from({ length: 9 }, (_, k) => [`n${k}`, 'float', [card, `n${k}`]] as [string, 'float', Wire])],
    lines: [
      ['vec3 low', 'vec3(n0, n1, n2) * (1.0 - step(0.5, abs(vec3(0.0, 1.0, 2.0) - count)))'],
      ['vec3 mid', 'vec3(n3, n4, n5) * (1.0 - step(0.5, abs(vec3(3.0, 4.0, 5.0) - count)))'],
      ['vec3 high', 'vec3(n6, n7, n8) * (1.0 - step(0.5, abs(vec3(6.0, 7.0, 8.0) - count)))'],
    ],
    result: 'low.x + low.y + low.z + mid.x + mid.y + mid.z + high.x + high.y + high.z',
    note: [
      `${what === 'born' ? 'Born?' : 'Survives?'}: looks the neighbour count up in the switches on the card to its left: 1 if the switch for this count is on, else 0. n0 to n8 are the nine switches (0 to 8 neighbours).`,
      'Why an Expression Block: nine Compare nodes and eight Adds would say the same thing at much greater length.',
      'low: switches 0, 1 and 2, each kept only where the count equals its number (1 − step(0.5, |k − count|) is 1 exactly when count = k).',
      'mid: the same for 3, 4 and 5.',
      'high: the same for 6, 7 and 8.',
      'result: the sum: at most one of the nine matches, so it is that switch, 0 or 1.',
    ],
  });
  g.simGridLifeLike = {
    ...SIM_GRID_EXAMPLE_INDEX.simGridLifeLike,
    counter: 80,
    nodes: [
      ...boardKit({ cell: LIFE_CELL, seedScale: 37.3, density: 0.5, speed: 0.5, brush: 5, stateWord: 'alive (1) or dead (0)' }),
      ...mooreSamples('nb', 'board', LIFE_CELL, 340, 300, 'Its Alpha is 1 if that cell is alive.'),
      countBlock('count', 640, 300, 'nb', 'alpha', 'each read\'s Alpha, 1 for a live cell'),
      ruleCard('bornWith', 520, 'Born with', DAY_NIGHT_BORN, 'Constants, Born with: nine switches, one per neighbour count (0 to 8). A dead cell with a count whose switch is on is born. Set to 3, 6, 7, 8 (Day & Night). Live entries, so each is a Play switch.'),
      ruleCard('surviveWith', 820, 'Survives with', DAY_NIGHT_SURVIVE, 'Constants, Survives with: nine switches. A live cell with a count whose switch is on lives on; any other count kills it. Set to 3, 4, 6, 7, 8 (Day & Night).'),
      lookup('bornQ', 480, 'bornWith', 'born'),
      lookup('stayQ', 780, 'surviveWith', 'survive'),
      n('mix', 'ruleNext', 1240, 470, note('Mix: the rule. For a dead cell (Blend = its Alpha, 0) the answer is Born?; for a live one (1) it is Survives?.'), { a: ['bornQ', 'result'], b: ['stayQ', 'result'], t: ['self', 'alpha'] }),
      ...lifeTail(1540, ['ruleNext', 'result'], 'Rule board'),
      ...lifeDisplay(2740, 300,
        [[0.015, 0.02, 0.04], [0.04, 0.12, 0.2], [0.08, 0.35, 0.45], [0.3, 0.65, 0.6], [0.7, 0.9, 0.75]],
        [1.0, 0.86, 0.55]),
    ],
    play: playRecord([
      ...Array.from({ length: 9 }, (_, k) => toggle(`b${k}`, `bornWith::n${k}`, `${k} neighbours`, 'Born with')),
      ...Array.from({ length: 9 }, (_, k) => toggle(`s${k}`, `surviveWith::n${k}`, `${k} neighbours`, 'Survives with')),
      ctl('speed', 'speed::value', 'Speed (steps per frame)', 0.02, 1, 0.01),
      ctl('density', 'density::value', 'Seed density', 0.02, 0.9, 0.01),
      toggle('reset', 'reset::value', 'Reset'),
      ctl('afterglow', 'glowFade::b', 'Afterglow', 0, 0.99, 0.005),
      ctl('brushOn', 'brushOn::value', 'Brush (mouse button)', 0, 1, 1),
    ], `**What it shows.** Life is one rule out of 2¹⁸ "Life-like" rules: a cell is born with some neighbour counts and survives with others. Here the rule is eighteen switches, so you can flip from one to another while it runs.

**How it is built.** The board is the Game of Life's (a ⅛-size Pass on Nearest, eight Sample reads counted). Two Constants cards hold the switches; two small Expression Blocks look the count up in them; a Mix picks Born? or Survives? by whether the cell is alive. It starts as Day & Night (B3678/S34678), where live and dead regions behave the same.

**Try these rules** (turn on just these switches, then Reset with a sensible density):
• Life B3/S23: born 3; survives 2, 3.
• HighLife B36/S23: Life plus born 6; it has a self-copying replicator.
• Seeds B2/S: born 2, survives nothing. Every cell dies at once and the board explodes; Reset at density 0.05.
• Day & Night B3678/S34678: the start.
• Maze B3/S12345: corridors. Coral B3/S45678: slow growth. Diamoeba B35678/S5678: blobs. Anneal B4678/S35678: regions that smooth out.`,
    [mapTo('mouseBrush', 'brushOn', mouseDown)]),
  };

  // ── 3 · Brian's Brain: on, dying, off ──
  g.simGridBrain = {
    ...SIM_GRID_EXAMPLE_INDEX.simGridBrain,
    counter: 80,
    nodes: [
      ...boardKit({ cell: 4, seedScale: 37.3, density: 0.2, speed: 0.5, brush: 8, stateWord: 'on (1) or not (0)' }),
      ...mooreSamples('nb', 'board', 4, 340, 300, 'Its Alpha is 1 if that cell is on.'),
      countBlock('count', 640, 520, 'nb', 'alpha', 'each read\'s Alpha, 1 for an on cell; dying cells don\'t count'),
      n('constant', 'bornN', 640, 820, { value: 2, label: 'Born with', ...note('Born with: an off cell turns on with exactly this many on neighbours (2 in Brian\'s Brain). A constant so Play can drive it.') }),
      n('compare', 'two', 940, 420, { operator: '≈', smoothing: 0.5, ...note('Compare (≈): 1 when exactly Born with (2) neighbours are on.') }, { a: ['count', 'result'], b: ['bornN', 'value'] }),
      n('add', 'busy', 940, 600, note('Add: on (Alpha) plus dying (red). 0 only for an off cell.'), { a: ['self', 'alpha'], b: ['selfParts', 'x'] }),
      n('compare', 'off', 940, 780, { operator: '≈', smoothing: 0.5, ...note('Compare (≈ 0, B left empty): 1 for an off cell (neither on nor dying). Only off cells can be born: a dying cell must rest a step first.') }, { a: ['busy', 'result'] }),
      n('multiply', 'birth', 1240, 500, note('Multiply: an off cell with exactly two on neighbours turns on.'), { a: ['two', 'mask'], b: ['off', 'mask'] }),
      n('mix', 'stepOn', 1540, 400, note('Mix: on a step frame the newly born cells are on (and every on cell goes off), otherwise the cell keeps its state.'), { a: ['self', 'alpha'], b: ['birth', 'result'], t: ['tick', 'output'] }),
      n('mix', 'stepDying', 1540, 640, note('Mix: on a step frame a cell is dying exactly when it was on (on → dying); a dying cell becomes off.'), { a: ['selfParts', 'x'], b: ['self', 'alpha'], t: ['tick', 'output'] }),
      n('mix', 'seeded', 1840, 400, note('Mix: the random board instead when starting over (first frame or Reset).'), { a: ['stepOn', 'result'], b: ['seedOn', 'mask'], t: ['restart', 'result'] }),
      n('compare', 'keep', 1840, 800, { operator: '≈', smoothing: 0.5, ...note('Compare (≈ 0, B left empty): 1 unless starting over. The fresh board has no dying cells.') }, { a: ['restart', 'result'] }),
      n('multiply', 'dying', 2140, 640, note('Multiply: dying cells, cleared when starting over.'), { a: ['stepDying', 'result'], b: ['keep', 'mask'] }),
      n('multiply', 'paintCells', 1840, 600, note('Multiply: the brush switches on a random share of the cells under it (the seed roll).'), { a: ['paint', 'result'], b: ['seedOn', 'mask'] }),
      n('max', 'onSoft', 2140, 400, note('Max: on if the rule or the seed says so, or the brush painted it.'), { a: ['seeded', 'result'], b: ['paintCells', 'result'] }),
      n('round', 'on', 2440, 300, note('Round: exactly 0 or 1, so a rare in-between value from a Compare (a brush edge right on a cell\'s centre) can never creep into the counts.'), { input: ['onSoft', 'result'] }),
      n('makeVec3', 'pack', 2440, 500, { g: 1, ...note('Make Vec3: what the board stores besides Alpha: red is dying, green 1 (started), blue the step clock.') }, { r: ['dying', 'result'], b: ['phase', 'output'] }),
      n('pass', 'board', 2740, 500, { label: 'Brain board', scale: '0.25', filter: 'nearest', wrap: 'repeat', format: 'half',
        ...note([
          'Pass, the board: one pixel per cell at ¼ size (480 × 270 on 1080p: Brian\'s Brain needs room, and on a small board it can burn out). Two channels hold the three states: Alpha 1 is on, red 1 is dying, both 0 is off.',
          'Nearest keeps every read one exact cell; Edges Repeat wraps the board round. Its Previous is the board one frame ago.',
        ]) },
      { color: ['pack', 'rgb'], alpha: ['on', 'output'] }),
      n('splitVec3', 'showParts', 3040, 700, note('Split Vec3: the board now. X (red) is dying.'), { v: ['board', 'color'] }),
      n('colorPicker', 'bg', 3040, 900, { color: [0.015, 0.015, 0.035], ...note('Color: the background (off cells).') }),
      n('colorPicker', 'dyingColour', 3040, 1060, { color: [0.2, 0.25, 0.9], ...note('Color: dying cells (resting a step after firing).') }),
      n('colorPicker', 'onColour', 3040, 1220, { color: [0.75, 1.0, 1.0], ...note('Color: on cells, the firing sparks.') }),
      colourMix('withDying', 3340, 800, { t: 0.5, ...note('Mix: the dying colour where red (dying) is 1.') }, { a: ['bg', 'rgb'], b: ['dyingColour', 'rgb'], t: ['showParts', 'x'] }),
      colourMix('cells', 3640, 700, { t: 0.5, ...note('Mix: the on colour where Alpha (on) is 1.') }, { a: ['withDying', 'result'], b: ['onColour', 'rgb'], t: ['board', 'alpha'] }),
      n('pass', 'picture', 3940, 700, { label: 'Brain picture', scale: '0.5', ...note('Pass, the picture: the coloured cells drawn once at ½ size so Glow (texture) can spread them.') }, { color: ['cells', 'result'] }),
      n('glowTexture', 'glow', 4240, 600, { method: 'bloom', threshold: 0.4, radius: 14, intensity: 1.2, ...note('Glow (texture): a soft halo round the bright (on) cells, so the sparks look lit.') }, { texture: ['picture', 'texture'] }),
      n('addColor', 'lit', 4540, 700, note('Add Colors: the cells plus their glow.'), { a: ['cells', 'result'], b: ['glow', 'glow'] }),
      n('output', 'out', 4840, 700, note('Output: the board with its glow. The board and picture Passes draw first each frame.'), { color: ['lit', 'result'] }),
    ],
    play: playRecord([
      ctl('speed', 'speed::value', 'Speed (steps per frame)', 0.02, 1, 0.01),
      ctl('density', 'density::value', 'Seed density', 0.02, 0.9, 0.01),
      toggle('reset', 'reset::value', 'Reset'),
      ctl('glow', 'glow::intensity', 'Glow', 0, 4, 0.05),
      ctl('brushOn', 'brushOn::value', 'Brush (mouse button)', 0, 1, 1),
      colourCtl('onColour', 'onColour::color', 'On'),
      colourCtl('dyingColour', 'dyingColour::color', 'Dying'),
    ], `**What it shows.** Brian's Brain (Brian Silverman): three states instead of two. An off cell with exactly two on neighbours turns on; every on cell starts dying; every dying cell switches off. Because a cell must rest a step after firing, sparks can't go back the way they came, and the board fills with gliding sparks that never settle.

**How it is built.** A board like Life's, at ¼ size (sparks need room: on a small board they can burn out), with the three states in two channels of the Pass (Alpha = on, red = dying). The neighbours are counted from Alpha, so dying cells don't count. Compare finds "exactly two" and "off"; a Multiply combines them. A second Pass holds the coloured picture so Glow (texture) can light the sparks.

**Try.** Hold the mouse button to drop a handful of on cells. Slow Speed to follow single sparks. Set Born with to 3 for a quieter, sparser variant.`,
    [mapTo('mouseBrush', 'brushOn', mouseDown)]),
  };

  // ── 4 · Cave generator: the 4-5 rule, repeated 8 times a frame ──
  const CAVE_CELL = 8; // the cave Pass is at ⅛ size
  g.simGridCave = {
    ...SIM_GRID_EXAMPLE_INDEX.simGridCave,
    counter: 80,
    nodes: [
      n('uv', 'uv', 40, 1500, note('UV: this cell\'s place. The noise that starts the map is read at it.')),
      n('sampleTexture', 'self', 340, 120, note('Sample (texture): this cell from the step before (the Cave map Pass\'s Previous). Red is rock (1) or open (0); green and blue remember the Seed and Rock density the map was made with.'), { texture: ['cave', 'previous'] }),
      n('splitVec3', 'selfParts', 640, 120, note('Split Vec3: rock (X), the Seed it was made with (Y), the density it was made with (Z).'), { v: ['self', 'color'] }),
      ...mooreSamples('nb', 'cave', CAVE_CELL, 340, 300, 'Its red is 1 for rock.'),
      expr('count', 640, 520, {
        label: 'Count the 3×3 block', outputType: 'float',
        inputs: [['c', 'vec3', ['self', 'color']], ...MOORE.map(([name]) => [name.toLowerCase(), 'vec3', [`nb${name}`, 'color']] as [string, 'vec3', Wire])],
        lines: [],
        result: 'c.r + n.r + ne.r + e.r + se.r + s.r + sw.r + w.r + nw.r',
        note: [
          'Count the 3×3 block: how many of the nine cells (this one and its eight neighbours) are rock: 0 to 9. Red is 1 for rock.',
          'Why an Expression Block: one sum of nine reads is clearer as one line than as eight Add cards.',
          'result: c.r (this cell) + the eight neighbours\' red.',
        ],
      }),
      n('constant', 'atLeast', 640, 820, { value: 5, label: 'Rock if at least', ...note('Rock if at least: the 4-5 rule. A cell becomes rock when 5 or more of its 3×3 block are rock, and open when 4 or fewer. A constant so Play can drive it.') }),
      n('compare', 'rockNext', 940, 520, { operator: '>=', ...note('Compare (≥): 1 (rock) when the block count is at least Rock if at least. Run again and again, this melts lone rocks and fills small holes: noise smooths into caves.') }, { a: ['count', 'result'], b: ['atLeast', 'value'] }),
      n('constant', 'seed', 340, 1500, { value: 7, label: 'Seed', ...note('Seed: which noise the map starts from. A new Seed is a new map. A constant so Play can drive it (whole numbers).') }),
      n('constant', 'density', 340, 1700, { value: 0.47, label: 'Rock density', ...note('Rock density: the share of cells that start as rock. Around 0.45 gives open caves, 0.5 tight tunnels.') }),
      n('noiseFloat', 'seedNoise', 640, 1500, { mode: 'hash', scale: 53.1, speed: 1,
        ...note('Noise Float, Hash: a random number for every cell. Seed is wired into its Time, so each Seed gives a different set.') },
      { uv: ['uv', 'uv'], time: ['seed', 'value'] }),
      n('compare', 'seedRock', 940, 1560, { operator: '<', ...note('Compare (<): rock where the cell\'s roll is under Rock density: the noisy starting map.') }, { a: ['seedNoise', 'value'], b: ['density', 'value'] }),
      n('compare', 'sameSeed', 940, 1100, { operator: '≈', smoothing: 0.5, ...note('Compare (≈): 1 while the map was made with this Seed. On the first frame green is 0, so it is 0 there too and the map starts.') }, { a: ['selfParts', 'y'], b: ['seed', 'value'] }),
      n('compare', 'sameDensity', 940, 1280, { operator: '≈', smoothing: 0.004, ...note('Compare (≈): 1 while the map was made with this Rock density (to within 0.004).') }, { a: ['selfParts', 'z'], b: ['density', 'value'] }),
      n('multiply', 'same', 1240, 1180, note('Multiply: 1 when both still match, 0 as soon as Seed or Rock density changes.'), { a: ['sameSeed', 'mask'], b: ['sameDensity', 'mask'] }),
      n('mix', 'rock', 1540, 600, note('Mix: keep smoothing while the settings match; start again from the noise when one changes (Blend = same).'), { a: ['seedRock', 'mask'], b: ['rockNext', 'mask'], t: ['same', 'result'] }),
      n('round', 'rockExact', 1840, 760, note('Round: rock back to exactly 0 or 1. The density check above matches to within a hair (the Pass stores 0.47 as 0.46997), so the Mix can give 0.9998, and five such rocks would count as less than 5.'), { input: ['rock', 'result'] }),
      n('makeVec3', 'pack', 1840, 600, note('Make Vec3: rock in red; the Seed and Rock density it was made with in green and blue, so a change is noticed next step.'), { r: ['rockExact', 'output'], g: ['seed', 'value'], b: ['density', 'value'] }),
      n('pass', 'cave', 2140, 600, { label: 'Cave map', scale: '0.125', filter: 'nearest', wrap: 'clamp', format: 'half', repeat: 8,
        ...note([
          'Pass, the cave: one pixel per cell at ⅛ size (240 × 135 on 1080p), Nearest so reads never blend.',
          'Repeat 8: drawn eight times a frame, each reading the step before through Previous, so a new map is smoothed in a single frame. After a few steps the rule stops changing anything and the map holds still.',
        ]) },
      { color: ['pack', 'rgb'] }),
      n('blurTexture', 'soft', 2440, 600, { method: 'smooth', radius: 24, ...note('Blur (texture): the rock map softened (24 picture pixels, three cells). The blurred rock reads as height: deep inside rock is high, open floor far from rock is low.') }, { texture: ['cave', 'texture'] }),
      n('pass', 'height', 2740, 600, { label: 'Cave height', scale: '0.5', ...note('Pass, height: the soft rock held as a texture, so Flow can measure its slope for shading.') }, { color: ['soft', 'color'] }),
      n('textureLevels', 'heightValue', 3040, 500, { channel: 'red', ...note('Levels (texture), Channel Red: the height as one number.') }, { texture: ['height', 'texture'] }),
      n('stopPalette', 'terrain', 3340, 500, {
        stops: '8', wrap: 'clamp', blend: 'linear', scale: 1, speed: 0,
        color0: [0.04, 0.12, 0.25], color1: [0.08, 0.3, 0.42], color2: [0.78, 0.72, 0.5], color3: [0.42, 0.6, 0.25], color4: [0.25, 0.47, 0.18], color5: [0.15, 0.32, 0.13], color6: [0.4, 0.36, 0.32], color7: [0.93, 0.93, 0.96],
        ...note('Stops Palette: height as terrain. Low open ground is water and shallows, then a sandy shore at the cave wall, grass and forest on the slopes, bare rock, and snow deep inside the rock.') },
      { value: ['heightValue', 'value'] }),
      n('textureFlow', 'slope', 3040, 800, { channel: 'red', direction: 'uphill', length: 'raw', strength: 4, reach: 3,
        ...note('Flow (texture), Uphill, Raw: which way the height rises here and how steeply. Used for the light.') },
      { texture: ['height', 'texture'] }),
      n('constant', 'sun', 3040, 1050, { outputType: 'vec2', x: -0.7, y: 0.7, label: 'Sun direction', ...note('Constant (vec2): where the light comes from (up and to the left).') }),
      n('dot', 'facing', 3340, 900, { outputType: 'vec2', ...note('Dot: how much the slope faces the sun: positive on slopes lit by it, negative in shadow.') }, { a: ['slope', 'flow'], b: ['sun', 'value'] }),
      n('add', 'light', 3640, 900, { b: 0.8, ...note('Add: 0.8 plus the facing, so flat ground is a little dimmed and lit slopes brighter. B is the base light.') }, { a: ['facing', 'result'] }),
      n('addColor', 'shaded', 3940, 600, note('Add Colors, used as colour × light: nothing plus the terrain colour times the light.'), { b: ['terrain', 'color'], scale: ['light', 'result'] }),
      n('output', 'out', 4240, 600, note('Output: the cave map as shaded terrain. The Cave map Pass (8 times), the blur and the Cave height Pass draw first.'), { color: ['shaded', 'result'] }),
    ].map(nd => (nd.id === 'sun' ? { ...nd, outputs: { value: { type: 'vec2', label: 'Value' } } } : nd)),
    play: playRecord([
      ctl('seed', 'seed::value', 'Seed (new map)', 1, 200, 1),
      ctl('density', 'density::value', 'Rock density', 0.3, 0.65, 0.005),
      ctl('atLeast', 'atLeast::value', 'Rock if at least (of 9)', 3, 7, 1),
      ctl('soft', 'soft::radius', 'Terrain softness', 1, 32, 0.5),
      ctl('relief', 'slope::strength', 'Relief', 0, 4, 0.05),
    ], `**What it shows.** The classic cave-generation cellular automaton: start from noise, then repeat "a cell is rock when 5 or more of its 3×3 block are rock" a few times. Scattered noise smooths into caverns and tunnels.

**How it is built.** The Cave map Pass is at ⅛ size with Nearest sampling and Repeat 8, so the rule runs eight times every frame. Each run reads the step before through Previous, counts the 3×3 block with nine Sample reads, and Compare (≥) applies the rule. The Seed and Rock density used are stored in the board's green and blue; when you change one, the map starts again from the noise and is smoothed within the same frame. For the picture, Blur (texture) turns rock into height, a second Pass holds it, a Stops Palette colours it as terrain and Flow (texture) shades the slopes.

**Try.** Drag Seed for new maps. Rock density 0.42 for open caverns, 0.52 for a maze of tunnels. Rock if at least 4 fills the map in, 6 opens it right up.`),
  };

  // ── 5 · Water ripples: Hugo Elias's two-buffer wave ──
  const WATER_CELL = 2; // the water Pass is at ½ size
  g.simGridWater = {
    ...SIM_GRID_EXAMPLE_INDEX.simGridWater,
    counter: 80,
    images: { pool: RIDGES_AT_DUSK },
    nodes: [
      n('uv', 'uv', 40, 900, note('UV: this cell\'s place, for the raindrop rolls.')),
      n('time', 'time', 40, 1100, note('Time: seconds since the start. Fed into the rain\'s noise so every frame rolls new drops.')),
      n('fragCoord', 'pix', 40, 1300, note('Pixel Coordinates: inside the Water heights Pass this counts its cells. The mouse\'s drop is measured in cells.')),
      n('mouse', 'mouse', 40, 1500, note('Mouse: its Pixels output is the pointer in picture pixels.')),
      n('sampleTexture', 'self', 340, 120, note('Sample (texture): this cell one step ago (the Water heights Pass\'s Previous). Red is the height now, green the height the step before: the two buffers.'), { texture: ['water', 'previous'] }),
      n('splitVec3', 'heights', 640, 120, note('Split Vec3: X is the height now (h), Y the height a step before (h old).'), { v: ['self', 'color'] }),
      n('textureNeighbours', 'spread', 340, 420, { mode: 'difference', size: '3', spacing: WATER_CELL, strength: 2,
        ...note([
          'Neighbours (texture), Difference from average: the average height round this cell minus its own. That is the Laplacian: how much the water around is higher or lower, which is what pushes a wave outwards.',
          'Spacing 2 picture pixels is one cell of the ½-size Pass. Strength 2 is the wave speed of Hugo Elias\'s version (new = neighbours / 2 − old); keep it at 4 or under, or the waves blow up.',
        ]) },
      { texture: ['water', 'previous'] }),
      n('splitVec3', 'spreadParts', 640, 420, note('Split Vec3: the Laplacian of the height (X, from red).'), { v: ['spread', 'color'] }),
      n('multiply', 'twice', 940, 100, { b: 2, ...note('Multiply: 2 × h. With the next node, 2h − h old is where the water would go if it kept moving as it was (its momentum).') }, { a: ['heights', 'x'] }),
      n('subtract', 'momentum', 1240, 160, note('Subtract: 2h − h old, the water carrying on at its speed.'), { a: ['twice', 'result'], b: ['heights', 'y'] }),
      n('add', 'wave', 1540, 260, note('Add: plus the pull of the neighbours (the Laplacian). This is the wave equation, one step.'), { a: ['momentum', 'result'], b: ['spreadParts', 'x'] }),
      n('multiply', 'damped', 1840, 260, { b: 0.985, ...note('Multiply: Damping (B, 0.985): each step keeps 98.5% of the wave, so ripples die away in a few seconds. 1 never calms; 0.95 is thick oil.') }, { a: ['wave', 'result'] }),
      ...timedSpot('rain', 340, 760, { rate: 3, radius: 0.012, soft: 0.006, what: 'drops' }),
      n('constant', 'dropTime', 2140, 900, { value: 0.1, label: 'Drop length', ...note('Drop length: the drop pushes for the first tenth of its turn (a couple of frames), then the water is left to ripple.') }),
      n('compare', 'dropNow', 2440, 820, { operator: '<', ...note('Compare (<): 1 during the first Drop length of each drop\'s turn.') }, { a: ['rainPhase', 'output'], b: ['dropTime', 'value'] }),
      n('multiply', 'drop', 2740, 760, note('Multiply: on the drop\'s spot, while it is landing.'), { a: ['rainSpot', 'mask'], b: ['dropNow', 'mask'] }),
      n('multiply', 'dropDepth', 3040, 760, { b: -1, ...note('Multiply: a drop pushes the surface down by 1 (B) each frame it lands.') }, { a: ['drop', 'result'] }),
      vec2Scale('brushAt', 340, 1500, 1 / WATER_CELL, ['mouse', 'px'], 'Multiply (vec2): the pointer\'s picture pixels times 0.5 (the Water heights Pass\'s Scale), so it is in water cells like Pixel Coordinates.'),
      n('circleSDF', 'brushDist', 640, 1350, { radius: 5, ...note('Circle SDF: how far this cell is from the pointer, in cells, minus Radius (5). Below 0 under the finger.') }, { position: ['pix', 'coord'], offset: ['brushAt', 'result'] }),
      n('compare', 'inBrush', 940, 1350, { operator: '<', smoothing: 2, ...note('Compare (< 0, B left empty): 1 under the pointer, with a soft 2-cell edge so the push is smooth (a hard edge rings).') }, { a: ['brushDist', 'distance'] }),
      n('constant', 'brushOn', 940, 1550, { value: 0, label: 'Push (mouse button)', ...note('Push: 1 while the mouse button is down (Play maps the button onto it).') }),
      n('multiply', 'press', 1240, 1400, { ...note('Multiply: under the pointer and the button is down.') }, { a: ['inBrush', 'mask'], b: ['brushOn', 'value'] }),
      n('multiply', 'pressDepth', 1540, 1400, { b: -0.04, ...note('Multiply: the finger pushes the surface down by 0.04 (B) each frame it is held; drag it to draw a wake.') }, { a: ['press', 'result'] }),
      n('add', 'withRain', 2140, 500, note('Add: the wave plus this frame\'s raindrops.'), { a: ['damped', 'result'], b: ['dropDepth', 'result'] }),
      n('add', 'newHeight', 2440, 500, note('Add: plus the finger.'), { a: ['withRain', 'result'], b: ['pressDepth', 'result'] }),
      n('makeVec3', 'pack', 2740, 500, note('Make Vec3: the new height in red, and this step\'s height in green (it becomes h old next step). The two buffers swap by moving one channel along.'), { r: ['newHeight', 'result'], g: ['heights', 'x'] }),
      n('pass', 'water', 3040, 500, { label: 'Water heights', scale: '0.5', filter: 'linear', wrap: 'clamp', format: 'half',
        ...note([
          'Pass, the water: heights at ½ size (960 × 540 on 1080p). Half float keeps negative heights (troughs).',
          'Edges Clamp: the border reads itself, so waves reflect off the sides of the pool. Linear filtering makes the picture smooth.',
        ]) },
      { color: ['pack', 'rgb'] }),
      n('textureFlow', 'bend', 3340, 400, { channel: 'red', direction: 'uphill', length: 'raw', strength: 0.12, reach: 2,
        ...note('Flow (texture), From Red, Uphill, Raw: the slope of the water surface. Its UV output is this pixel pushed along the slope: looking through a tilted surface shifts what is under it (refraction).') },
      { texture: ['water', 'texture'] }),
      n('textureInput', 'pool', 3640, 400, { fit: 'stretch', ...note('Texture Input: the photo under the water (ridges at dusk; load your own). Read at Flow\'s UV, so the ripples bend it.') }, { uv: ['bend', 'uv'] }),
      n('textureLevels', 'shine', 3640, 700, { channel: 'red', inBlack: 0.03, inWhite: 1.2, gamma: 0.8, outWhite: 0.5, clamp: true, ...note('Levels (texture), Channel Red: the crests of the waves (heights from 0.03 up to 1.2) as 0 to 0.5: a soft highlight where the water bulges up.') }, { texture: ['water', 'texture'] }),
      n('colorPicker', 'shineColour', 3640, 950, { color: [0.75, 0.9, 1.0], ...note('Color: the highlight colour, a cool sky reflection.') }),
      n('addColor', 'lit', 3940, 500, note('Add Colors: the bent photo plus the highlight colour, times the crest (wired into Scale).'), { a: ['pool', 'color'], b: ['shineColour', 'rgb'], scale: ['shine', 'value'] }),
      n('output', 'out', 4240, 500, note('Output: the photo seen through the rippling water. The Water heights Pass steps first each frame.'), { color: ['lit', 'result'] }),
    ],
    play: playRecord([
      ctl('damping', 'damped::b', 'Damping', 0.9, 1, 0.001),
      ctl('speed', 'spread::strength', 'Wave speed', 0.2, 4, 0.05),
      ctl('rain', 'rainClock::b', 'Drops per second', 0, 30, 0.1),
      ctl('depth', 'dropDepth::b', 'Drop strength', -3, 0, 0.01),
      ctl('finger', 'pressDepth::b', 'Finger strength', -0.5, 0, 0.005),
      ctl('dropSize', 'rainDist::radius', 'Drop size', 0.002, 0.08, 0.001),
      ctl('refraction', 'bend::strength', 'Refraction', 0, 0.3, 0.005),
      ctl('brushOn', 'brushOn::value', 'Push (mouse button)', 0, 1, 1),
    ], `**What it shows.** Hugo Elias's classic 2D water: two height buffers and one line of maths, new = (neighbours) / 2 − old, times a damping just under 1. It is a discrete wave equation, so ripples spread, bounce off the edges and pass through each other.

**How it is built.** The Water heights Pass keeps two heights per cell: red is now, green is the step before. Each step reads both from Previous, takes 2h − h old (the water carrying on) and adds the Laplacian from Neighbours (Difference from average, Strength 2, the wave speed). Damping multiplies it down; raindrops (rare hashed cells) and the mouse push the surface. The new height goes in red and the old red moves to green. For the picture, Flow (texture) finds the surface's slope and bends a photo through it; Levels picks the crests for a highlight.

**Try.** Hold the mouse button and drag to draw a wake. Rain 0 and a single click to watch one ring bounce round the pool. Damping 0.999 to let the ripples pile up; Wave speed 0.5 for slow, heavy water.`,
    [mapTo('mousePush', 'brushOn', mouseDown)]),
  };

  // ── 6 · Heat: diffusion as a Neighbours average blend ──
  const HEAT_CELL = 4; // the heat Pass is at ¼ size
  g.simGridHeat = {
    ...SIM_GRID_EXAMPLE_INDEX.simGridHeat,
    counter: 80,
    nodes: [
      n('uv', 'uv', 40, 900, note('UV: this cell\'s place, for the drifting hot spots.')),
      n('time', 'time', 40, 1100, note('Time: drifts the hot spots.')),
      n('fragCoord', 'pix', 40, 1300, note('Pixel Coordinates: inside the Heat map Pass this counts its cells. The brush is measured in cells.')),
      n('mouse', 'mouse', 40, 1500, note('Mouse: its Pixels output is the pointer in picture pixels.')),
      n('sampleTexture', 'self', 340, 120, note('Sample (texture): this cell\'s temperature one step ago (the Heat map Pass\'s Previous). The temperature is stored in Alpha (and as grey in Color).'), { texture: ['heat', 'previous'] }),
      n('textureNeighbours', 'around', 340, 380, { mode: 'average', size: '3', spacing: HEAT_CELL,
        ...note('Neighbours (texture), Average: the mean temperature of the cells round this one (one cell apart: 4 picture pixels at ¼ size). Its Value is that mean (the colour is grey, so its brightness is the temperature).') },
      { texture: ['heat', 'previous'] }),
      n('constant', 'spreadRate', 640, 560, { value: 0.9, label: 'Spread', ...note('Spread: how far each step moves a cell towards its neighbours\' average (0 to 1). This is the diffusion rate. A constant so Play can drive it.') }),
      n('mix', 'diffused', 940, 260, note('Mix: diffusion. The cell\'s temperature moved Spread of the way towards the average round it. Heat flows from hot cells to cold ones, and sharp spots spread into soft hills.'), { a: ['self', 'alpha'], b: ['around', 'value'], t: ['spreadRate', 'value'] }),
      n('multiply', 'cooled', 1240, 260, { b: 0.996, ...note('Multiply: cooling. Each step keeps Cooling (B, 0.996) of the heat; the rest leaks away, so everything slowly goes cold.') }, { a: ['diffused', 'result'] }),
      n('noiseFloat', 'spots', 340, 900, { mode: 'perlin', scale: 2.2, speed: 0.12, ...note('Noise Float, Perlin: slow noise drifting with Time. Its peaks are where the floor is heated.') }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
      n('constant', 'spotLevel', 340, 1100, { value: 0.66, label: 'Hot spot level', ...note('Hot spot level: how high the noise must be to heat. Higher means fewer, smaller hot spots.') }),
      n('compare', 'hot', 640, 950, { operator: '>', smoothing: 0.03, ...note('Compare (>): 1 where the noise is above Hot spot level, with a soft edge: drifting hot spots.') }, { a: ['spots', 'value'], b: ['spotLevel', 'value'] }),
      n('multiply', 'heating', 940, 950, { b: 0.04, ...note('Multiply: the heat a hot spot adds each step (B, 0.04).') }, { a: ['hot', 'mask'] }),
      vec2Scale('brushAt', 340, 1500, 1 / HEAT_CELL, ['mouse', 'px'], 'Multiply (vec2): the pointer\'s picture pixels times 0.25 (the Heat map Pass\'s Scale), so it is in heat cells.'),
      n('circleSDF', 'brushDist', 640, 1350, { radius: 6, ...note('Circle SDF: distance from the pointer in cells, minus Radius (6).') }, { position: ['pix', 'coord'], offset: ['brushAt', 'result'] }),
      n('compare', 'inBrush', 940, 1350, { operator: '<', smoothing: 1.5, ...note('Compare (< 0, B left empty): 1 under the brush, with a soft edge.') }, { a: ['brushDist', 'distance'] }),
      n('constant', 'brushOn', 940, 1550, { value: 0, label: 'Brush (mouse button)', ...note('Brush: 1 while the mouse button is down (Play maps the button onto it).') }),
      n('multiply', 'paint', 1240, 1400, note('Multiply: the brush\'s heat: under the pointer while the button is down.'), { a: ['inBrush', 'mask'], b: ['brushOn', 'value'] }),
      n('add', 'warmed', 1540, 400, note('Add: the hot spots\' heat.'), { a: ['cooled', 'result'], b: ['heating', 'result'] }),
      n('max', 'temperature', 1840, 400, note('Max: the brush sets what it touches to full heat (1).'), { a: ['warmed', 'result'], b: ['paint', 'result'] }),
      n('floatToVec3', 'grey', 2140, 300, note('Float → Color: the temperature as grey, so the Neighbours Value read above is the temperature.'), { input: ['temperature', 'result'] }),
      n('pass', 'heat', 2440, 400, { label: 'Heat map', scale: '0.25', filter: 'linear', wrap: 'clamp', format: 'half', repeat: 4,
        ...note([
          'Pass, the heat: temperatures at ¼ size. Repeat 4: four diffusion steps a frame, so heat spreads four times as fast for little cost.',
          'Linear filtering keeps the picture smooth. Its Previous is the step before.',
        ]) },
      { color: ['grey', 'rgb'], alpha: ['temperature', 'result'] }),
      n('textureLevels', 'tone', 2740, 400, { channel: 'alpha', gamma: 0.7, clamp: true, ...note('Levels (texture), Channel Alpha: the temperature, Gamma 0.7 so faint warmth shows.') }, { texture: ['heat', 'texture'] }),
      n('stopPalette', 'heatColour', 3040, 400, {
        stops: '6', wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
        color0: [0.01, 0.01, 0.04], color1: [0.16, 0.04, 0.33], color2: [0.55, 0.08, 0.38], color3: [0.9, 0.3, 0.1], color4: [0.99, 0.72, 0.18], color5: [1.0, 0.98, 0.85],
        ...note('Stops Palette: a heat map (like Inferno): cold black and violet, warm red, hot orange and yellow, white at full heat.') },
      { value: ['tone', 'value'] }),
      n('output', 'out', 3340, 400, note('Output: the temperature as a heat map. The Heat map Pass steps four times first.'), { color: ['heatColour', 'color'] }),
    ],
    play: playRecord([
      ctl('spread', 'spreadRate::value', 'Spread (diffusion)', 0, 1, 0.01),
      ctl('cooling', 'cooled::b', 'Cooling (kept per step)', 0.95, 1, 0.0005),
      ctl('spotLevel', 'spotLevel::value', 'Hot spot level', 0.5, 1, 0.005),
      ctl('heating', 'heating::b', 'Hot spot heat', 0, 0.2, 0.002),
      ctl('brush', 'brushDist::radius', 'Brush size (cells)', 1, 30, 0.5),
      ctl('brushOn', 'brushOn::value', 'Brush (mouse button)', 0, 1, 1),
    ], `**What it shows.** Heat diffusion on a grid. Every step each cell moves towards the average of the cells round it (heat flows from hot to cold) and loses a little (cooling). That is the discrete heat equation.

**How it is built.** The Heat map Pass holds the temperature (in Alpha, and as grey in Color). Neighbours (texture), Average, reads the cells round each one from Previous; a Mix moves the cell Spread of the way to that average; a Multiply cools it. Drifting Perlin hot spots and the mouse add heat. Repeat 4 runs four steps a frame. Levels and a Stops Palette turn temperature into colour.

**Try.** Hold the mouse button and paint. Spread 0.1 for slow, sticky heat; Cooling 1 for no losses (the heat only spreads). Hot spot level 1 turns the spots off.`,
    [mapTo('mouseBrush', 'brushOn', mouseDown)]),
  };

  // ── 7 · Forest fire (Drossel–Schwabl) ──
  const FIRE_CELL = 4; // the forest Pass is at ¼ size
  g.simGridFire = {
    ...SIM_GRID_EXAMPLE_INDEX.simGridFire,
    counter: 80,
    nodes: [
      n('uv', 'uv', 40, 1100, note('UV: this cell\'s place, for the per-cell dice.')),
      n('time', 'time', 40, 1300, note('Time: fed into the dice so they roll anew every frame.')),
      n('fragCoord', 'pix', 40, 1500, note('Pixel Coordinates: inside the Forest Pass this counts its cells. The click is measured in cells.')),
      n('mouse', 'mouse', 40, 1700, note('Mouse: its Pixels output is the pointer in picture pixels.')),
      n('sampleTexture', 'self', 340, 120, note('Sample (texture): this cell one step ago (the Forest Pass\'s Previous). Alpha is fire (1 burning); Color holds tree, ash and the started flag.'), { texture: ['forest', 'previous'] }),
      n('splitVec3', 'selfParts', 640, 120, note('Split Vec3: X (red) is a tree (1), Y (green) the ash\'s glow, Z (blue) 1 once the forest has started.'), { v: ['self', 'color'] }),
      n('textureNeighbours', 'nearFire', 340, 380, { mode: 'max', size: '3', spacing: FIRE_CELL,
        ...note('Neighbours (texture), Max around: the largest value in the 3×3 block round this cell (one cell apart: 4 picture pixels). Its Alpha is 1 if any of them is burning. Max reads each cell exactly, so it works on a Nearest board.') },
      { texture: ['forest', 'previous'] }),
      n('noiseFloat', 'growRoll', 340, 700, { mode: 'hash', scale: 41.7, speed: 1.37, ...note('Noise Float, Hash: a die for every cell, rolled again every frame (Time wired in). Decides where trees grow.') }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
      n('constant', 'growth', 640, 760, { value: 0.004, label: 'Growth (p)', ...note('Growth p: the chance each frame that empty ground grows a tree. A constant so Play can drive it.') }),
      ...timedSpot('strike', 340, 2000, { rate: 0.7, radius: 0.012, soft: 0, what: 'strikes' }),
      n('compare', 'grows', 940, 700, { operator: '<', ...note('Compare (<): 1 where the growth die came up (roll under p).') }, { a: ['growRoll', 'value'], b: ['growth', 'value'] }),
      n('constant', 'spreadChance', 640, 560, { value: 0.6, label: 'Spread chance', ...note('Spread chance: how likely a tree next to a fire is to catch each step. At 1 fire fronts are perfect squares (the 3×3 block grows one ring a step); below 1 they turn ragged and round, and some trees survive.') }),
      n('compare', 'spreads', 940, 560, { operator: '<', ...note('Compare (<): the catch die. It reuses the growth die: growth only matters on empty ground and catching only on trees, so one roll serves both without the two ever meeting.') }, { a: ['growRoll', 'value'], b: ['spreadChance', 'value'] }),
      n('multiply', 'nearCatch', 1240, 380, note('Multiply: fire next door, and the catch die came up.'), { a: ['nearFire', 'alpha'], b: ['spreads', 'mask'] }),
      n('max', 'ignite', 1240, 560, note('Max: something lights this cell: a burning neighbour that spread, or a strike.'), { a: ['nearCatch', 'result'], b: ['strikeSpot', 'mask'] }),
      n('multiply', 'catches', 1540, 400, note('Multiply: only a tree can catch fire. A tree with fire next to it (or struck) burns this step.'), { a: ['selfParts', 'x'], b: ['ignite', 'result'] }),
      n('subtract', 'standing', 2140, 160, note('Subtract: the trees still standing: the tree minus one that just caught fire (or was lit).'), { a: ['selfParts', 'x'], b: ['fire', 'result'] }),
      n('add', 'occupied', 940, 1100, note('Add: tree plus fire. 0 only on empty ground.'), { a: ['selfParts', 'x'], b: ['self', 'alpha'] }),
      n('compare', 'empty', 1240, 1100, { operator: '≈', smoothing: 0.5, ...note('Compare (≈ 0, B left empty): 1 on empty ground (no tree, no fire). A burning cell is empty next step: fire lasts one step, then it is ash.') }, { a: ['occupied', 'result'] }),
      n('multiply', 'sprout', 1540, 900, note('Multiply: a tree grows on empty ground where the growth die came up.'), { a: ['empty', 'mask'], b: ['grows', 'mask'] }),
      n('add', 'trees', 2440, 160, note('Add: next step\'s trees: the ones standing plus the new ones.'), { a: ['standing', 'result'], b: ['sprout', 'result'] }),
      n('multiply', 'ashFade', 1540, 1300, { b: 0.95, ...note('Multiply: last step\'s ash glow times Ash fade (B, 0.95), so embers cool over a second or so.') }, { a: ['selfParts', 'y'] }),
      n('max', 'ash', 1840, 1300, note('Max: a cell that was burning becomes fresh, fully glowing ash.'), { a: ['ashFade', 'result'], b: ['self', 'alpha'] }),
      vec2Scale('brushAt', 340, 1700, 1 / FIRE_CELL, ['mouse', 'px'], 'Multiply (vec2): the pointer\'s picture pixels times 0.25 (the Forest Pass\'s Scale), so it is in forest cells.'),
      n('circleSDF', 'brushDist', 640, 1550, { radius: 3, ...note('Circle SDF: distance from the pointer in cells, minus Radius (3).') }, { position: ['pix', 'coord'], offset: ['brushAt', 'result'] }),
      n('compare', 'inBrush', 940, 1550, { operator: '<', ...note('Compare (< 0, B left empty): 1 under the pointer.') }, { a: ['brushDist', 'distance'] }),
      n('constant', 'brushOn', 940, 1750, { value: 0, label: 'Light (mouse button)', ...note('Light: 1 while the mouse button is down (Play maps the button onto it).') }),
      n('multiply', 'torch', 1240, 1600, note('Multiply: the click sets the trees under the pointer alight.'), { a: ['inBrush', 'mask'], b: ['brushOn', 'value'] }),
      n('multiply', 'torchTrees', 1540, 1600, note('Multiply: only trees burn, so clicking bare ground does nothing.'), { a: ['torch', 'result'], b: ['selfParts', 'x'] }),
      n('max', 'fire', 1840, 500, note('Max: next step\'s fire: trees that caught, or the ones you lit.'), { a: ['catches', 'result'], b: ['torchTrees', 'result'] }),
      n('compare', 'fresh', 1840, 1000, { operator: '≈', smoothing: 0.5, ...note('Compare (≈ 0, B left empty): 1 on the very first frame, when the Pass is still empty (blue, the started flag, is 0).') }, { a: ['selfParts', 'z'] }),
      n('constant', 'reset', 1840, 1150, { value: 0, label: 'Reset', ...note('Reset: while 1 the forest is planted again. Flip it on and off (a switch in Play).') }),
      n('max', 'restart', 2140, 1050, note('Max: start over on the first frame or while Reset is on.'), { a: ['fresh', 'mask'], b: ['reset', 'value'] }),
      n('compare', 'planted', 2140, 800, { operator: '<', ...note('Compare (<): the starting forest: trees wherever the growth die is under Starting forest.') }, { a: ['growRoll', 'value'], b: ['half', 'value'] }),
      n('constant', 'half', 1840, 820, { value: 0.55, label: 'Starting forest', ...note('Starting forest: the share of ground that starts as trees.') }),
      n('mix', 'treesOut', 2740, 160, note('Mix: the planted forest when starting over, else the trees.'), { a: ['trees', 'result'], b: ['planted', 'mask'], t: ['restart', 'result'] }),
      n('round', 'treesRound', 2740, 300, note('Round: trees exactly 0 or 1, for the same reason.'), { input: ['treesOut', 'result'] }),
      n('compare', 'keep', 2440, 1050, { operator: '≈', smoothing: 0.5, ...note('Compare (≈ 0, B left empty): 1 unless starting over.') }, { a: ['restart', 'result'] }),
      n('multiply', 'fireSoft', 2440, 500, note('Multiply: no fire on a fresh forest.'), { a: ['fire', 'result'], b: ['keep', 'mask'] }),
      n('round', 'fireOut', 2740, 560, note('Round: fire exactly 0 or 1 (a Compare can, very rarely, give a value in between on the edge of the click or a strike).'), { input: ['fireSoft', 'result'] }),
      n('multiply', 'ashOut', 2440, 700, note('Multiply: no ash on a fresh forest.'), { a: ['ash', 'result'], b: ['keep', 'mask'] }),
      n('makeVec3', 'pack', 3040, 400, { b: 1, ...note('Make Vec3: red is a tree, green the ash glow, blue 1 (started).') }, { r: ['treesRound', 'output'], g: ['ashOut', 'result'] }),
      n('pass', 'forest', 3340, 400, { label: 'Forest', scale: '0.25', filter: 'nearest', wrap: 'clamp', format: 'half',
        ...note([
          'Pass, the forest: one pixel per cell at ¼ size (480 × 270 on 1080p). Alpha is fire; red tree; green ash.',
          'Nearest keeps every read one exact cell. Its Previous is the forest one frame ago.',
        ]) },
      { color: ['pack', 'rgb'], alpha: ['fireOut', 'output'] }),
      n('splitVec3', 'showParts', 3640, 600, note('Split Vec3: the forest now: tree (X) and ash (Y).'), { v: ['forest', 'color'] }),
      n('noiseFloat', 'leafRoll', 3640, 820, { mode: 'hash', scale: 41.7, speed: 0, ...note('Noise Float, Hash, no Time: a fixed random number per cell, so each tree keeps its own shade of green.') }, { uv: ['uv', 'uv'] }),
      n('colorPicker', 'soil', 3640, 1000, { color: [0.05, 0.04, 0.03], ...note('Color: bare ground, where a tree can grow.') }),
      n('colorPicker', 'leafA', 3640, 1150, { color: [0.06, 0.28, 0.09], ...note('Color: the darkest shade of tree.') }),
      n('colorPicker', 'leafB', 3640, 1300, { color: [0.2, 0.5, 0.14], ...note('Color: a light tree.') }),
      n('colorPicker', 'ember', 3640, 1450, { color: [0.9, 0.18, 0.04], ...note('Color: glowing ash, times its glow.') }),
      n('colorPicker', 'flame', 3640, 1600, { color: [1.0, 0.85, 0.35], ...note('Color: burning trees (fire).') }),
      colourMix('leaf', 3940, 1150, { t: 0.5, ...note('Mix: each tree somewhere between the two greens (Blend is its own fixed roll).') }, { a: ['leafA', 'rgb'], b: ['leafB', 'rgb'], t: ['leafRoll', 'value'] }),
      colourMix('wood', 3940, 800, { t: 0.5, ...note('Mix: ground, or a tree where red is 1.') }, { a: ['soil', 'rgb'], b: ['leaf', 'result'], t: ['showParts', 'x'] }),
      n('addColor', 'embers', 4240, 800, note('Add Colors: plus the ash glow (ember colour times the ash).'), { a: ['wood', 'result'], b: ['ember', 'rgb'], scale: ['showParts', 'y'] }),
      colourMix('cells', 4540, 700, { t: 0.5, ...note('Mix: fire colour where the cell is burning (Alpha).') }, { a: ['embers', 'result'], b: ['flame', 'rgb'], t: ['forest', 'alpha'] }),
      n('pass', 'picture', 4840, 700, { label: 'Forest picture', scale: '0.5', ...note('Pass, the picture: the coloured forest at ½ size, so Glow (texture) can light the fire fronts.') }, { color: ['cells', 'result'] }),
      n('glowTexture', 'glow', 5140, 600, { method: 'bloom', threshold: 0.55, radius: 16, intensity: 1.6, tint: [1, 0.6, 0.3], ...note('Glow (texture): a warm halo round the brightest parts (the fire and fresh ash).') }, { texture: ['picture', 'texture'] }),
      n('addColor', 'lit', 5440, 700, note('Add Colors: the forest plus the fire\'s glow.'), { a: ['cells', 'result'], b: ['glow', 'glow'] }),
      n('output', 'out', 5740, 700, note('Output: the forest. The Forest and Forest picture Passes draw first each frame.'), { color: ['lit', 'result'] }),
    ],
    play: playRecord([
      ctl('growth', 'growth::value', 'Tree growth (p)', 0, 0.05, 0.0005),
      ctl('spread', 'spreadChance::value', 'Spread chance', 0, 1, 0.01),
      ctl('lightning', 'strikeClock::b', 'Lightning (strikes per second)', 0, 10, 0.05),
      ctl('ashFade', 'ashFade::b', 'Ash fade', 0.5, 0.995, 0.005),
      toggle('reset', 'reset::value', 'Reset'),
      ctl('glow', 'glow::intensity', 'Fire glow', 0, 4, 0.05),
      ctl('brushOn', 'brushOn::value', 'Light (mouse button)', 0, 1, 1),
    ], `**What it shows.** The Drossel–Schwabl forest-fire model (1992), a probabilistic cellular automaton: empty ground grows a tree with chance p, a tree is struck by lightning with a much smaller chance f, a tree next to a fire catches, and a fire burns out in one step. Forests build up, then burn in sweeping fronts of every size.

**How it is built.** The Forest Pass (¼ size, Nearest) keeps fire in Alpha, trees in red and the ash glow in green. Neighbours (texture) on Max reads the 3×3 block and its Alpha says "fire next door". A hashed Noise Float die with Time wired in rolls growth for every cell every frame. Lightning is rarer than a per-cell die can roll (the hash's numbers come in steps of about 1/256), so instead it strikes one random place, Lightning times a second: the strike's number (Time × rate, rounded down) is hashed into a position. Compare, Max, Multiply, Add and Subtract write the rules. A second Pass holds the coloured picture so Glow (texture) lights the fires.

**Try.** Click (hold the mouse button) on a forest to start a fire. Raise Lightning for many small fires; set it to 0 and Tree growth to 0.03 for a dense forest, then light it. Ash fade 0.99 leaves long burn scars.`,
    [mapTo('mouseLight', 'brushOn', mouseDown)]),
  };

  // ── 8 · Falling sand, from gathers only ──
  const SAND_CELL = 4; // the sand Pass is at ¼ size
  const seg = (id: string, x: number, y: number, a: [number, number], b: [number, number], which: string): GraphNode[] => [
    n('makeVec2', `${id}A`, x, y, { x: a[0], y: a[1], ...note(`Make Vec2: one end of the ${which} ledge (picture units).`) }),
    n('makeVec2', `${id}B`, x, y + 150, { x: b[0], y: b[1], ...note(`Make Vec2: the other end of the ${which} ledge.`) }),
    n('sdSegment', id, x + 300, y + 60, note(`Line Segment SDF: how far this cell is from the ${which} ledge.`), { p: ['uv', 'uv'], a: [`${id}A`, 'xy'], b: [`${id}B`, 'xy'] }),
  ];
  g.simGridSand = {
    ...SIM_GRID_EXAMPLE_INDEX.simGridSand,
    counter: 80,
    nodes: [
      n('uv', 'uv', 40, 1500, note('UV: this cell\'s place, for the spouts, the ledges and the dice.')),
      n('time', 'time', 40, 1700, note('Time: moves one spout and rolls the dice anew every frame.')),
      n('fragCoord', 'pix', 40, 1900, note('Pixel Coordinates: inside the Sand grains Pass this counts its cells. Its Y tells the step which row is the floor; the brush is measured with it.')),
      n('mouse', 'mouse', 40, 2100, note('Mouse: its Pixels output is the pointer in picture pixels.')),
      n('resolution', 'res', 40, 2300, note('Resolution: inside the Sand grains Pass this is the Pass\'s own size, in cells (rows and columns). The step uses it to find the top row.')),
      n('sampleTexture', 'self', 340, 120, note('Sample (texture): this cell one step ago (the Sand grains Pass\'s Previous). Red is filled (1) or empty (0); green is the grain\'s shade, or −1 for a ledge (a wall that never moves); blue is the side grains slide to this step.'), { texture: ['sand', 'previous'] }),
      ...mooreSamples('nb', 'sand', SAND_CELL, 340, 300, 'Red: something there; green: its shade (−1 for a ledge).'),
      expr('step', 940, 500, {
        label: 'Falling sand step', outputType: 'vec3',
        inputs: [
          ['c', 'vec3', ['self', 'color']],
          ...MOORE.map(([name]) => [name.toLowerCase(), 'vec3', [`nb${name}`, 'color']] as [string, 'vec3', Wire]),
          ['px', 'vec2', ['pix', 'coord']], ['size', 'vec2', ['res', 'res']], ['pour', 'float', ['pourHere', 'result']], ['shade', 'float', ['shadeRoll', 'value']],
          ['wall', 'float', ['ledge', 'mask']], ['clear', 'float', ['clear', 'value']],
        ],
        lines: [
          ['float d', 'c.b < 0.5 ? 1.0 : -1.0'],
          ['vec3 side', 'd > 0.0 ? e : w'],
          ['vec3 diag', 'd > 0.0 ? se : sw'],
          ['vec3 upOpp', 'd > 0.0 ? nw : ne'],
          ['vec3 sideOpp', 'd > 0.0 ? w : e'],
          ['float floorRow', 'step(px.y, 1.0)'],
          ['float roof', 'step(size.y - 1.0, px.y)'],
          ['float grain', 'c.r * step(0.0, c.g)'],
          ['float below', 'max(s.r, floorRow)'],
          ['float fall', 'grain * (1.0 - below)'],
          ['float slide', 'grain * below * (1.0 - max(diag.r, floorRow)) * (1.0 - side.r * step(0.0, side.g))'],
          ['float fromAbove', '(1.0 - roof) * (1.0 - c.r) * n.r * step(0.0, n.g)'],
          ['float fromSide', '(1.0 - roof) * (1.0 - c.r) * (1.0 - n.r * step(0.0, n.g)) * upOpp.r * step(0.0, upOpp.g) * sideOpp.r'],
          ['float sandNow', 'grain * (1.0 - fall - slide) + fromAbove + fromSide'],
          ['float tint', 'fromAbove > 0.5 ? n.g : (fromSide > 0.5 ? upOpp.g : c.g)'],
          ['float poured', 'step(0.5, pour) * (1.0 - sandNow)'],
        ],
        result: 'wall > 0.5 ? vec3(1.0, -1.0, 1.0 - c.b) : vec3(step(0.5, sandNow + poured) * (1.0 - clear), mix(tint, shade, poured), 1.0 - c.b)',
        note: [
          'Falling sand step: the whole rule, written as gathers. A shader can only write its own cell, so no grain is "moved": every cell works out, from its 3×3 block, whether its grain leaves and whether a grain arrives. Both cells of every move see the same facts, so they always agree and no grain is lost or doubled.',
          'Why an Expression Block: the rule is a dozen small yes/no tests on nine reads; as nodes it would be sixty cards.',
          'd: this step\'s slide side, +1 right or −1 left. It flips every step (blue), so piles grow evenly on both sides.',
          'side: the cell beside this one on that side.',
          'diag: the cell below on that side, where this grain would slide to.',
          'upOpp: the cell above on the other side: the only grain that could slide into this cell this step.',
          'sideOpp: the cell beside on the other side: what that grain is standing on.',
          'floorRow: 1 on the bottom row (Pixel Coordinates Y is 0.5 there): the floor counts as full.',
          'roof: 1 on the top row (size is the Pass\'s own size in cells). A read above the top row reads the top row itself, so nothing may arrive from up there.',
          'grain: 1 if this cell holds a grain (a ledge has green −1, so it is not one).',
          'below: is the cell under this one full (sand, ledge or the floor)?',
          'fall: the grain drops straight down into an empty cell below.',
          'slide: it can\'t drop, so it slides down to the side, if that cell is empty and no grain is about to drop into it from above.',
          'fromAbove: this cell is empty and a grain above drops into it (never on the top row).',
          'fromSide: this cell is empty, nothing drops in from above, and the grain up on the other side is standing on something: it slides in.',
          'sandNow: what this cell holds after the moves: its grain unless it left, plus any grain that arrived.',
          'tint: the arriving grain brings its shade with it; otherwise the cell keeps its own.',
          'poured: a new grain where a spout or the brush pours and the cell is empty. step(0.5, pour) makes the pour exactly 0 or 1 (a Compare can, very rarely, give a value in between right on a spout\'s edge).',
          'result: a ledge cell is always a ledge (1, −1); otherwise the sand, kept exactly 0 or 1 by step(0.5, …) so a stray in-between value can never smear (cleared while Clear is on), its shade (a new grain gets a fresh random one), and the slide side flipped for next step.',
        ],
      }),
      n('pass', 'sand', 1240, 500, { label: 'Sand grains', scale: '0.25', filter: 'nearest', wrap: 'clamp', format: 'half',
        ...note([
          'Pass, the sand: one pixel per grain at ¼ size (480 × 270 on 1080p). Nearest keeps every read one exact cell; Half float keeps the ledges\' −1.',
          'Edges Clamp: a read past the side reads the edge cell itself, which the rule treats as a wall. Its Previous is the sand one frame ago.',
        ]) },
      { color: ['step', 'result'] }),

      n('noiseFloat', 'dribbleRoll', 340, 1500, { mode: 'hash', scale: 37.3, speed: 1.13, ...note('Noise Float, Hash: a die per cell per frame, so a spout dribbles grains rather than pouring a solid column.') }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
      n('noiseFloat', 'shadeRoll', 340, 1700, { mode: 'hash', scale: 53.9, speed: 2.71, ...note('Noise Float, Hash: a second, independent roll: the shade a new grain gets.') }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
      n('constant', 'flow', 640, 1560, { value: 0.35, label: 'Pour rate', ...note('Pour rate: the share of a spout\'s cells that drop a grain each frame. A constant so Play can drive it.') }),
      n('compare', 'dribble', 940, 1500, { operator: '<', ...note('Compare (<): 1 on the cells whose die is under Pour rate.') }, { a: ['dribbleRoll', 'value'], b: ['flow', 'value'] }),
      n('circleSDF', 'spoutA', 640, 1750, { radius: 0.03, posX: -1.0, posY: 0.93, ...note('Circle SDF: a fixed spout near the top left.') }),
      n('sin', 'swing', 340, 1950, { freq: 0.3, amp: 1.2, ...note('Sin: 1.2 × sin(0.3 × Time): the second spout swings slowly from side to side.') }, { input: ['time', 'time'] }),
      n('makeVec2', 'spoutBAt', 640, 1950, { y: 0.93, ...note('Make Vec2: the swinging spout\'s place, near the top.') }, { x: ['swing', 'output'] }),
      n('circleSDF', 'spoutB', 940, 1900, { radius: 0.03, ...note('Circle SDF: the swinging spout.') }, { position: ['uv', 'uv'], offset: ['spoutBAt', 'xy'] }),
      n('minMath', 'spouts', 1240, 1800, note('Min: both spouts as one shape (the nearer one\'s distance).'), { a: ['spoutA', 'distance'], b: ['spoutB', 'distance'] }),
      n('compare', 'inSpout', 1540, 1800, { operator: '<', ...note('Compare (< 0, B left empty): 1 inside a spout.') }, { a: ['spouts', 'result'] }),
      vec2Scale('brushAt', 340, 2150, 1 / SAND_CELL, ['mouse', 'px'], 'Multiply (vec2): the pointer\'s picture pixels times 0.25 (the Sand grains Pass\'s Scale), so it is in sand cells.'),
      n('circleSDF', 'brushDist', 640, 2150, { radius: 6, ...note('Circle SDF: distance from the pointer in cells, minus Radius (6).') }, { position: ['pix', 'coord'], offset: ['brushAt', 'result'] }),
      n('compare', 'inBrush', 940, 2150, { operator: '<', ...note('Compare (< 0, B left empty): 1 under the brush.') }, { a: ['brushDist', 'distance'] }),
      n('constant', 'brushOn', 940, 2300, { value: 0, label: 'Pour (mouse button)', ...note('Pour: 1 while the mouse button is down (Play maps the button onto it).') }),
      n('multiply', 'brushPour', 1240, 2150, note('Multiply: under the pointer while the button is down.'), { a: ['inBrush', 'mask'], b: ['brushOn', 'value'] }),
      n('max', 'pourWhere', 1840, 1900, note('Max: the spouts and the brush.'), { a: ['inSpout', 'mask'], b: ['brushPour', 'result'] }),
      n('multiply', 'pourHere', 2140, 1700, note('Multiply: where sand is poured this frame: in a spout or the brush, on the cells whose die came up.'), { a: ['pourWhere', 'result'], b: ['dribble', 'mask'] }),

      ...seg('ledgeL', 340, 2400, [-1.4, 0.35], [-0.25, 0.0], 'left'),
      ...seg('ledgeR', 340, 2700, [1.45, -0.05], [0.35, -0.35], 'right'),
      n('minMath', 'ledges', 940, 2550, note('Min: both ledges as one shape.'), { a: ['ledgeL', 'distance'], b: ['ledgeR', 'distance'] }),
      n('constant', 'thick', 940, 2750, { value: 0.012, label: 'Ledge thickness', ...note('Ledge thickness: half the width of a ledge, in picture units.') }),
      n('compare', 'ledge', 1240, 2550, { operator: '<', ...note('Compare (<): 1 on a ledge (closer than the thickness). The step writes these cells as walls every frame.') }, { a: ['ledges', 'result'], b: ['thick', 'value'] }),
      n('constant', 'clear', 1240, 2750, { value: 0, label: 'Clear', ...note('Clear: while 1 all the sand is removed. A switch in Play.') }),

      n('splitVec3', 'showParts', 1540, 700, note('Split Vec3: the sand now: filled (X) and shade (Y, −1 on a ledge).'), { v: ['sand', 'color'] }),
      n('stopPalette', 'sandColour', 1840, 600, {
        stops: '4', wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
        color0: [0.76, 0.55, 0.3], color1: [0.93, 0.78, 0.5], color2: [0.85, 0.42, 0.25], color3: [0.98, 0.9, 0.7],
        ...note('Stops Palette: each grain\'s shade (0 to 1) as a sand colour: tan, pale gold, a few rusty grains, cream.') },
      { value: ['showParts', 'y'] }),
      n('constant', 'ledgeMark', 1540, 1000, { value: -1, label: 'Ledge mark', ...note('Ledge mark: the shade a ledge cell stores (−1), to find the ledges in the picture.') }),
      n('compare', 'isLedge', 1840, 900, { operator: '≈', smoothing: 0.5, ...note('Compare (≈): 1 where the shade is the Ledge mark (−1): a ledge.') }, { a: ['showParts', 'y'], b: ['ledgeMark', 'value'] }),
      n('colorPicker', 'bg', 1840, 1060, { color: [0.05, 0.06, 0.1], ...note('Color: the empty background.') }),
      n('colorPicker', 'stone', 1840, 1220, { color: [0.36, 0.38, 0.45], ...note('Color: the stone ledges.') }),
      colourMix('withSand', 2140, 700, { t: 0.5, ...note('Mix: the background, or sand where the cell is filled.') }, { a: ['bg', 'rgb'], b: ['sandColour', 'color'], t: ['showParts', 'x'] }),
      colourMix('cells', 2440, 800, { t: 0.5, ...note('Mix: stone on the ledges.') }, { a: ['withSand', 'result'], b: ['stone', 'rgb'], t: ['isLedge', 'mask'] }),
      n('output', 'out', 2740, 800, note('Output: the sand, one block per grain. The Sand grains Pass steps first each frame.'), { color: ['cells', 'result'] }),
    ],
    play: playRecord([
      ctl('flow', 'flow::value', 'Pour rate', 0, 1, 0.01),
      ctl('swing', 'swing::amp', 'Spout swing', 0, 1.7, 0.01),
      toggle('clear', 'clear::value', 'Clear'),
      ctl('brush', 'brushDist::radius', 'Brush size (cells)', 1, 30, 0.5),
      ctl('brushOn', 'brushOn::value', 'Pour (mouse button)', 0, 1, 1),
    ], `**What it shows.** Falling sand, built only from gathers. A shader writes one cell and can't push a grain into its neighbour, so the usual "move the grain" code is impossible. Instead every cell asks the question from both ends: "does my grain leave?" and "does a grain arrive?". The two cells of every move read the same 3×3 facts, so they always agree, and grains are never lost or doubled.

**How it is built.** The Sand grains Pass (¼ size, Nearest) stores filled in red, each grain's shade in green (−1 marks a ledge) and the slide side in blue. Nine Sample (texture) reads go into one Expression Block, explained line by line in its note: a grain falls if the cell below is empty; otherwise it slides diagonally to this step's side if that cell is empty and nothing is falling into it. The side flips every step, so piles stay symmetric. Spouts (Circle SDFs, one swinging on a Sin) and the mouse pour new grains; two Line Segment SDFs make ledges.

**Try.** Hold the mouse button to pour. Turn Pour rate up to fill the screen, then Clear. Spout swing 0 makes two steady cones.`,
    [mapTo('mousePour', 'brushOn', mouseDown)]),
  };

  // ── 9 · Wireworld: copper, electron heads and tails ──
  const WIRE_CELL = 8; // the wires Pass is at ⅛ size
  g.simGridWire = {
    ...SIM_GRID_EXAMPLE_INDEX.simGridWire,
    counter: 80,
    nodes: [
      n('fragCoord', 'pix', 40, 1500, note('Pixel Coordinates: inside the Circuit Pass this counts its cells (one pixel per cell). The starter circuit and the brush are laid out with it.')),
      n('mouse', 'mouse', 40, 1900, note('Mouse: its Pixels output is the pointer in picture pixels.')),
      n('sampleTexture', 'self', 340, 120, note('Sample (texture): this cell one step ago (the Circuit Pass\'s Previous). Red is an electron head, green its tail, blue copper (any wire); Alpha is 3 + the step clock once the circuit has started (an empty Pass reads 0 or 1 there).'), { texture: ['wires', 'previous'] }),
      n('splitVec3', 'selfParts', 640, 120, note('Split Vec3: head (X), tail (Y), wire (Z).'), { v: ['self', 'color'] }),
      ...mooreSamples('nb', 'wires', WIRE_CELL, 340, 300, 'Its red is 1 for an electron head.'),
      countBlock('count', 640, 520, 'nb', 'r', 'each read\'s red, 1 for an electron head'),
      n('constant', 'one', 640, 760, { value: 1, label: 'One', ...note('One: the fewest heads that fire a copper cell.') }),
      n('constant', 'two', 640, 900, { value: 2, label: 'Two', ...note('Two: the most heads that fire a copper cell. With three or more the cell stays quiet (that is what makes Wireworld\'s gates work).') }),
      n('compare', 'ones', 940, 640, { operator: '≈', smoothing: 0.5, ...note('Compare (≈): exactly one head round this cell.') }, { a: ['count', 'result'], b: ['one', 'value'] }),
      n('compare', 'twos', 940, 800, { operator: '≈', smoothing: 0.5, ...note('Compare (≈): exactly two heads round this cell.') }, { a: ['count', 'result'], b: ['two', 'value'] }),
      n('max', 'fires', 1240, 720, note('Max: one or two heads next to it.'), { a: ['ones', 'mask'], b: ['twos', 'mask'] }),
      n('add', 'busy', 940, 300, note('Add: head plus tail. 1 on a cell carrying an electron.'), { a: ['selfParts', 'x'], b: ['selfParts', 'y'] }),
      n('subtract', 'idle', 1240, 300, note('Subtract: wire minus busy. 1 on plain copper (wire with no electron on it), 0 everywhere else.'), { a: ['selfParts', 'z'], b: ['busy', 'result'] }),
      n('multiply', 'newHead', 1540, 500, note('Multiply: plain copper with one or two heads next to it becomes a head.'), { a: ['idle', 'result'], b: ['fires', 'result'] }),

      n('add', 'clockWas', 940, 1100, { b: -3, ...note('Add (B −3): the step clock\'s phase, stored in Alpha as 3 + phase.') }, { a: ['self', 'alpha'] }),
      n('constant', 'speed', 940, 1260, { value: 0.5, label: 'Speed', ...note('Speed: steps per frame, 0 to 1 (1 is 60 steps a second). A constant so Play can drive it.') }),
      n('add', 'clock', 1240, 1150, note('Add: phase plus Speed. When it passes 1, a step is due.'), { a: ['clockWas', 'result'], b: ['speed', 'value'] }),
      n('floor', 'tick', 1540, 1100, note('Floor: 1 on a step frame, 0 when the circuit holds still.'), { input: ['clock', 'result'] }),
      n('fractRaw', 'phase', 1540, 1260, note('Fract (scalar): the phase left over.'), { input: ['clock', 'result'] }),
      n('add', 'clockNext', 1840, 1260, { b: 3, ...note('Add (B 3): 3 + the phase, for Alpha. Always 3 or more, while a new, empty Pass reads 0 or 1 in Alpha: that is how the first frame is told apart.') }, { a: ['phase', 'output'] }),

      n('mix', 'headStep', 1840, 400, note('Mix: on a step frame the new heads; otherwise the heads stay where they are.'), { a: ['selfParts', 'x'], b: ['newHead', 'result'], t: ['tick', 'output'] }),
      n('mix', 'tailStep', 1840, 600, note('Mix: on a step frame every head becomes a tail (and every tail, copper again).'), { a: ['selfParts', 'y'], b: ['selfParts', 'x'], t: ['tick', 'output'] }),

      expr('starter', 340, 1500, {
        label: 'Starter circuit', outputType: 'vec3',
        inputs: [['cell', 'vec2', ['pix', 'coord']], ['bridges', 'float', ['bridgeShare', 'value']]],
        lines: [
          ['vec2 tile', 'floor(cell / 24.0)'],
          ['vec2 at', 'floor(cell) - tile * 24.0 - 12.0'],
          ['float ring', 'max(abs(at.x), abs(at.y))'],
          ['float onRing', 'step(abs(ring - 3.0), 0.1) + step(abs(ring - 6.0), 0.1) + step(abs(ring - 9.0), 0.1)'],
          ['float right', 'step(noiseHash1(tile), bridges) * step(abs(at.y), 0.1) * step(9.5, at.x)'],
          ['float fromLeft', 'step(noiseHash1(tile - vec2(1.0, 0.0)), bridges) * step(abs(at.y), 0.1) * step(at.x, -9.5)'],
          ['float up', 'step(noiseHash1(tile + 17.0), bridges) * step(abs(at.x), 0.1) * step(9.5, at.y)'],
          ['float fromBelow', 'step(noiseHash1(tile + vec2(17.0, 16.0)), bridges) * step(abs(at.x), 0.1) * step(at.y, -9.5)'],
          ['float wire', 'min(onRing + right + fromLeft + up + fromBelow, 1.0)'],
          ['float head', 'onRing * step(abs(at.x - ring), 0.1) * step(abs(at.y - 1.0), 0.1)'],
          ['float tail', 'onRing * step(abs(at.x - ring), 0.1) * step(abs(at.y), 0.1)'],
        ],
        result: 'vec3(head, tail, wire)',
        note: [
          'Starter circuit: the copper and electrons the board starts with (and gets back on Reset). cell is this cell\'s column and row; bridges is the share of tiles joined to their neighbours.',
          'Why an Expression Block: a layout is a handful of yes/no tests on the cell\'s position; drawn as nodes it would sprawl.',
          'tile: which 24 × 24 tile this cell is in.',
          'at: where in its tile, with 0 at the tile\'s middle.',
          'ring: the square "radius" (the larger of |x| and |y|): rings of cells at the same distance form square loops.',
          'onRing: 1 on three square loops, 3, 6 and 9 cells out from the middle.',
          'right: a wire from the outer loop to the right edge of the tile, on some tiles (a hash of the tile under Bridges).',
          'fromLeft: the other half of the bridge the tile to the left sends (same hash), so a bridge joins two loops.',
          'up: the same upwards, with another hash.',
          'fromBelow: the other half of the bridge from the tile below.',
          'wire: copper wherever any of those is.',
          'head: one electron head on every loop, on its right side one cell above the middle.',
          'tail: its tail just below, so each electron runs up the right side (anticlockwise).',
          'result: (head, tail, wire), packed like the board.',
        ],
      }),
      n('constant', 'bridgeShare', 40, 1700, { value: 0.35, label: 'Bridges', ...note('Bridges: the share of tiles whose outer loop is joined to the next tile\'s (0 to 1). Joined loops trade electrons and fill up with trains of them; lone loops keep a single electron. Takes effect on Reset.') }),

      n('compare', 'fresh', 1240, 1500, { operator: '<', ...note('Compare (<): 1 when Alpha is under Two: the very first frame, when the Pass is still empty (its Alpha is 0 or 1 then, never 3 or more).') }, { a: ['self', 'alpha'], b: ['two', 'value'] }),
      n('constant', 'reset', 1240, 1660, { value: 0, label: 'Reset', ...note('Reset: while 1, the starter circuit is laid down again (wiping what you drew). A switch in Play.') }),
      n('max', 'restart', 1540, 1560, note('Max: start over on the first frame or while Reset is on.'), { a: ['fresh', 'mask'], b: ['reset', 'value'] }),

      vec2Scale('brushAt', 340, 1900, 1 / WIRE_CELL, ['mouse', 'px'], 'Multiply (vec2): the pointer\'s picture pixels times ⅛ (the Circuit Pass\'s Scale), so it is in cells.'),
      n('circleSDF', 'brushDist', 640, 1900, { radius: 1.2, ...note('Circle SDF: distance from the pointer in cells, minus Radius (1.2 cells: a fine pen for wires).') }, { position: ['pix', 'coord'], offset: ['brushAt', 'result'] }),
      n('compare', 'inBrush', 940, 1900, { operator: '<', ...note('Compare (< 0, B left empty): 1 under the pen.') }, { a: ['brushDist', 'distance'] }),
      n('constant', 'brushOn', 940, 2060, { value: 0, label: 'Pen (mouse button)', ...note('Pen: 1 while the mouse button is down (Play maps the button onto it).') }),
      n('multiply', 'pen', 1240, 1950, note('Multiply: under the pointer while the button is down.'), { a: ['inBrush', 'mask'], b: ['brushOn', 'value'] }),
      n('constant', 'drawWire', 1240, 2110, { value: 0, label: 'Pen draws copper', ...note('Pen draws copper: 0, the pen sends sparks (heads) into the copper under it; 1, it lays new copper. A switch in Play.') }),
      n('multiply', 'newCopper', 1540, 2000, note('Multiply: the pen lays copper when Pen draws copper is on.'), { a: ['pen', 'result'], b: ['drawWire', 'value'] }),
      n('compare', 'sparkMode', 1540, 2160, { operator: '≈', smoothing: 0.5, ...note('Compare (≈ 0, B left empty): 1 while Pen draws copper is off.') }, { a: ['drawWire', 'value'] }),
      n('multiply', 'penSpark', 1840, 2000, note('Multiply: the pen sparks when it isn\'t drawing copper.'), { a: ['pen', 'result'], b: ['sparkMode', 'mask'] }),
      n('multiply', 'spark', 2140, 2000, note('Multiply: a spark only takes on plain copper.'), { a: ['penSpark', 'result'], b: ['idle', 'result'] }),

      n('max', 'headAll', 2140, 400, note('Max: the heads, plus any spark.'), { a: ['headStep', 'result'], b: ['spark', 'result'] }),
      n('round', 'headExact', 2440, 400, note('Round: heads exactly 0 or 1 (a Compare can, very rarely, give a value in between on the pen\'s edge).'), { input: ['headAll', 'result'] }),
      n('max', 'wireAll', 2140, 800, note('Max: the copper, plus any the pen lays.'), { a: ['selfParts', 'z'], b: ['newCopper', 'result'] }),
      n('makeVec3', 'stepped', 2440, 600, note('Make Vec3: the circuit after this frame: head, tail, wire.'), { r: ['headExact', 'output'], g: ['tailStep', 'result'], b: ['wireAll', 'result'] }),
      colourMix('next', 2740, 600, { t: 0.5, ...note('Mix: the starter circuit instead when starting over.') }, { a: ['stepped', 'rgb'], b: ['starter', 'result'], t: ['restart', 'result'] }),
      n('pass', 'wires', 3040, 600, { label: 'Circuit', scale: '0.125', filter: 'nearest', wrap: 'clamp', format: 'half',
        ...note([
          'Pass, the circuit: one pixel per cell at ⅛ size (240 × 135 on 1080p). Red is a head, green a tail, blue copper; Alpha carries the step clock (3 + phase).',
          'Nearest keeps every read one exact cell. Its Previous is the circuit one frame ago.',
        ]) },
      { color: ['next', 'result'], alpha: ['clockNext', 'result'] }),

      n('splitVec3', 'showParts', 3340, 700, note('Split Vec3: the circuit now: head (X), tail (Y), wire (Z).'), { v: ['wires', 'color'] }),
      n('colorPicker', 'bg', 3340, 900, { color: [0.02, 0.02, 0.035], ...note('Color: the empty board.') }),
      n('colorPicker', 'copper', 3340, 1050, { color: [0.45, 0.24, 0.08], ...note('Color: copper wire with no electron.') }),
      n('colorPicker', 'tailColour', 3340, 1200, { color: [1.0, 0.32, 0.12], ...note('Color: electron tails.') }),
      n('colorPicker', 'headColour', 3340, 1350, { color: [0.6, 0.95, 1.0], ...note('Color: electron heads.') }),
      colourMix('withCopper', 3640, 800, { t: 0.5, ...note('Mix: copper where there is wire.') }, { a: ['bg', 'rgb'], b: ['copper', 'rgb'], t: ['showParts', 'z'] }),
      colourMix('withTail', 3940, 800, { t: 0.5, ...note('Mix: tail colour on tails.') }, { a: ['withCopper', 'result'], b: ['tailColour', 'rgb'], t: ['showParts', 'y'] }),
      colourMix('cells', 4240, 800, { t: 0.5, ...note('Mix: head colour on heads.') }, { a: ['withTail', 'result'], b: ['headColour', 'rgb'], t: ['showParts', 'x'] }),
      n('pass', 'wirePicture', 4540, 800, { label: 'Circuit picture', scale: '0.5', ...note('Pass, the picture: the coloured circuit at ½ size, so Glow (texture) can light the electrons.') }, { color: ['cells', 'result'] }),
      n('glowTexture', 'glow', 4840, 700, { method: 'bloom', threshold: 0.5, radius: 12, intensity: 1.4, ...note('Glow (texture): a halo round the bright electrons (heads and tails), not the dim copper.') }, { texture: ['wirePicture', 'texture'] }),
      n('addColor', 'lit', 5140, 800, note('Add Colors: the circuit plus the glow.'), { a: ['cells', 'result'], b: ['glow', 'glow'] }),
      n('output', 'out', 5440, 800, note('Output: the circuit. The Circuit and Circuit picture Passes draw first each frame.'), { color: ['lit', 'result'] }),
    ],
    play: playRecord([
      ctl('speed', 'speed::value', 'Speed (steps per frame)', 0.02, 1, 0.01),
      ctl('bridges', 'bridgeShare::value', 'Bridges (on Reset)', 0, 1, 0.01),
      toggle('reset', 'reset::value', 'Reset'),
      toggle('drawWire', 'drawWire::value', 'Pen draws copper'),
      ctl('pen', 'brushDist::radius', 'Pen size (cells)', 0.5, 6, 0.1),
      ctl('brushOn', 'brushOn::value', 'Pen (mouse button)', 0, 1, 1),
      ctl('glow', 'glow::intensity', 'Glow', 0, 4, 0.05),
    ], `**What it shows.** Wireworld (Brian Silverman, 1987; A. K. Dewdney's Computer Recreations, 1990): four states, empty, copper, electron head and electron tail. A head becomes a tail, a tail becomes copper, and copper becomes a head when exactly one or two of its eight neighbours are heads. Electrons run along wires; the tail stops them turning back.

**How it is built.** The Circuit Pass (⅛ size, Nearest) keeps head in red, tail in green and copper in blue. Eight Sample (texture) reads count the heads round each cell; two Compare nodes and a Max say "one or two"; Subtract finds plain copper; Multiply fires it. A small Expression Block lays out the starter circuit: three square loops per tile, each with one electron, with some outer loops bridged to their neighbours. Bridged loops trade electrons and fill with trains of them; lone loops keep circling their single electron.

**Try.** Hold the mouse button on a wire to send a spark. Turn on Pen draws copper and draw a wire from one loop to another, then turn it off and watch them trade electrons. Change Bridges, then Reset.`,
    [mapTo('mousePen', 'brushOn', mouseDown)]),
  };

  return g;
}
