/**
 * learnExamples.ts — the Learn folder: a Book of Shaders-style course as
 * graphs, one idea per example, in the order you would learn them. Each has a
 * one-line description in the examples list and notes on the Play page that
 * say what it shows, how it is built, and what to try.
 *
 * Graphs are built from the node definitions themselves (sockets come from
 * the definition, params are the defaults plus what the lesson changes), so a
 * lesson can't drift from the node it teaches. The examples test compiles
 * every one and checks its Play controls point at live params.
 */
import type { GraphNode, GroupInputPort, GroupOutputPort } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import type { PlayControl, PlayRecord } from '../types/play';
import { getNodeDefinition } from '../nodes/definitions';
import type { ExampleGraph } from './exampleIndex';
import { LEARN_EXAMPLE_INDEX } from './learnExampleIndex';

// ── Graph builder ───────────────────────────────────────────────────────────

type Wire = [fromId: string, outputKey: string];
type Wires = Record<string, Wire>;

/** A node of `type` at (x, y): sockets from its definition, params = defaults + `params`, inputs wired per `wires`. */
function n(type: string, id: string, x: number, y: number, params: Record<string, unknown> = {}, wires: Wires = {}, extra: Partial<GraphNode> = {}): GraphNode {
  const def = getNodeDefinition(type);
  if (!def) throw new Error(`learnExamples: unknown node type ${type}`);
  const inputs: GraphNode['inputs'] = {};
  for (const [k, v] of Object.entries(def.inputs ?? {})) {
    inputs[k] = { type: v.type, label: v.label, ...(wires[k] ? { connection: { nodeId: wires[k][0], outputKey: wires[k][1] } } : {}) };
  }
  for (const k of Object.keys(wires)) if (!inputs[k]) throw new Error(`learnExamples: ${type} has no input ${k}`);
  const outputs: GraphNode['outputs'] = {};
  for (const [k, v] of Object.entries(def.outputs ?? {})) outputs[k] = { type: v.type, label: v.label };
  return { id, type, position: { x, y }, inputs, outputs, params: { ...(def.defaultParams ?? {}), ...params }, ...extra };
}

/** An iterated group: ports in and out, a subgraph, and how many times it runs. */
function group(id: string, x: number, y: number, o: {
  label: string; iterations: number;
  inputs: Array<{ key: string; type: GraphNode['inputs'][string]['type']; label: string; from: Wire }>;
  outputs: Array<{ key: string; type: GraphNode['outputs'][string]['type']; label: string; from: Wire }>;
  nodes: GraphNode[];
}): GraphNode {
  const inputs: GraphNode['inputs'] = {};
  const inputPorts: GroupInputPort[] = [];
  for (const p of o.inputs) {
    inputs[p.key] = { type: p.type, label: p.label, connection: { nodeId: p.from[0], outputKey: p.from[1] } };
    // The live wiring is the subgraph nodes that read GROUP_PORT_SENTINEL/p.key; toNodeId is the back-compat display target.
    const reader = o.nodes.find(sn => Object.values(sn.inputs).some(i => i.connection?.nodeId === GROUP_PORT_SENTINEL && i.connection.outputKey === p.key));
    const readerKey = reader ? Object.entries(reader.inputs).find(([, i]) => i.connection?.nodeId === GROUP_PORT_SENTINEL && i.connection.outputKey === p.key)![0] : '';
    inputPorts.push({ key: p.key, type: p.type, label: p.label, toNodeId: reader?.id ?? '', toInputKey: readerKey } as GroupInputPort);
  }
  const outputs: GraphNode['outputs'] = {};
  const outputPorts: GroupOutputPort[] = [];
  for (const p of o.outputs) {
    outputs[p.key] = { type: p.type, label: p.label };
    outputPorts.push({ key: p.key, type: p.type, label: p.label, fromNodeId: p.from[0], fromOutputKey: p.from[1] });
  }
  return { id, type: 'group', position: { x, y }, inputs, outputs, params: { label: o.label, iterations: o.iterations, subgraph: { nodes: o.nodes, inputPorts, outputPorts } } };
}

/** A reference to a group port, for wiring subgraph nodes. */
const port = (key: string): Wire => [GROUP_PORT_SENTINEL, key];

const ctl = (id: string, target: string, label: string, min: number, max: number, step?: number): PlayControl =>
  ({ id, target, kind: 'float', label, min, max, ...(step ? { step } : {}) });
const colourCtl = (id: string, target: string, label: string): PlayControl => ({ id, target, kind: 'color', label, min: 0, max: 1 });

function play(controls: PlayControl[], notes: string): PlayRecord {
  return { version: 1, controls, mappings: [], layers: [], notes };
}

const uv = (x = 40, y = 220) => n('uv', 'uv', x, y);
const time = (x = 40, y = 420) => n('time', 'time', x, y);
const out = (from: Wire, x: number, y = 220) => n('output', 'out', x, y, {}, { color: from });

// ── Lessons ─────────────────────────────────────────────────────────────────

type Lesson = { key: string; nodes: GraphNode[]; controls: PlayControl[]; notes: string };
const L: Lesson[] = [];
const lesson = (key: string, nodes: GraphNode[], controls: PlayControl[], notes: string) => L.push({ key, nodes, controls, notes });

lesson('learnColour', [
  n('colorPicker', 'col', 200, 220, { color: [0.96, 0.55, 0.2] }),
  out(['col', 'rgb'], 480),
], [colourCtl('c', 'col::color', 'Colour')], `**What it shows.** A fragment shader is a tiny program the GPU runs once for every pixel, all at the same time, and the only thing each run has to decide is that pixel's colour. This graph is the smallest possible one: a **Colour** node wired into **Output**. Every pixel gets the same answer, so the whole picture is orange.

**How it is built.** Output is the shader's \`gl_FragColor\`. Anything that produces a vec3 (three numbers: red, green, blue, each 0–1) can be wired into it. Open the GLSL tab to see the two lines it compiles to.

**Try.** Click the swatch and pick another colour; the shader recompiles nothing, the number just changes. Next: give each pixel a different answer.`);

lesson('learnUV', [
  uv(),
  n('splitVec2', 'split', 260, 220, {}, { v: ['uv', 'uv'] }),
  n('remap', 'rx', 480, 160, { inMin: -1, inMax: 1, outMin: 0, outMax: 1 }, { value: ['split', 'x'] }),
  n('remap', 'ry', 480, 300, { inMin: -1, inMax: 1, outMin: 0, outMax: 1 }, { value: ['split', 'y'] }),
  n('combineRGB', 'rgb', 720, 220, {}, { r: ['rx', 'result'], g: ['ry', 'result'] }),
  out(['rgb', 'color'], 960),
], [], `**What it shows.** The one thing that differs from pixel to pixel is *where* it is. **UV** gives that position: x runs left to right, y bottom to top, with (0, 0) at the centre and y from −1 to 1 (x reaches further on a wide screen). Painting x as red and y as green shows the coordinate system itself: black at the bottom-left, yellow at the top-right.

**How it is built.** Split Vec2 takes the vec2 apart. Remap moves each axis from −1…1 to 0…1, because colours below 0 are just black. Combine RGB puts the two numbers back together as a colour (blue stays 0).

**Try.** Swap the wires into Combine RGB, or send x into all three channels for a grey ramp. Everything in the rest of the course starts from this vec2.`);

lesson('learnTime', [
  time(40, 220),
  n('sin', 'sn', 260, 220, { freq: 1, amp: 1 }, { input: ['time', 'time'] }),
  n('remap', 'rm', 480, 220, { inMin: -1, inMax: 1, outMin: 0, outMax: 1 }, { value: ['sn', 'output'] }),
  n('oklabMix', 'mix', 720, 220, { a: [0.98, 0.8, 0.2], b: [0.15, 0.3, 0.95] }, { t: ['rm', 'result'] }),
  out(['mix', 'result'], 960),
], [ctl('speed', 'sn::freq', 'Speed', 0.1, 4, 0.1)], `**What it shows.** **Time** is a number that keeps rising, in seconds. On its own it runs off to infinity, so it is almost always bent into a wave first: **Sin** turns it into −1…1, Remap makes that 0…1, and that drives the blend between two colours. The picture breathes.

**How it is built.** OkLab Mix blends in a perceptual colour space, so the halfway colour stays bright instead of going grey (compare the plain Mix node). Nothing here depends on position yet, so the whole screen changes together.

**Try.** Raise Speed. Then wire the Remap result into something spatial from the next lessons, such as a circle's radius.`);

lesson('learnShaping', [
  uv(),
  n('splitVec2', 'split', 240, 220, {}, { v: ['uv', 'uv'] }),
  n('remap', 'rx', 440, 140, { inMin: -1, inMax: 1, outMin: 0, outMax: 1 }, { value: ['split', 'x'] }),
  n('remap', 'ry', 440, 320, { inMin: -1, inMax: 1, outMin: 0, outMax: 1 }, { value: ['split', 'y'] }),
  n('cubicBezierShaper', 'shape', 660, 140, { a: 0.25, b: 0.1, c: 0.25, d: 1.0 }, { x: ['rx', 'result'] }),
  n('compare', 'cmp', 900, 220, { operator: '>', smoothing: 0.01 }, { a: ['shape', 'y'], b: ['ry', 'result'] }),
  n('colorPicker', 'under', 900, 380, { color: [0.95, 0.6, 0.25] }),
  n('colorPicker', 'over', 900, 500, { color: [0.1, 0.1, 0.14] }),
  n('select', 'sel', 1140, 220, { outputType: 'vec3' }, { mask: ['cmp', 'mask'], ifTrue: ['under', 'rgb'], ifFalse: ['over', 'rgb'] }),
  out(['sel', 'result'], 1380),
], [ctl('a', 'shape::a', 'Handle 1 x', 0, 1, 0.01), ctl('b', 'shape::b', 'Handle 1 y', 0, 1, 0.01), ctl('c', 'shape::c', 'Handle 2 x', 0, 1, 0.01), ctl('d', 'shape::d', 'Handle 2 y', 0, 1, 0.01)], `**What it shows.** A shaping function takes a number from 0 to 1 and gives back another number from 0 to 1, bent: eased in, eased out, S-curved. The Book of Shaders plots them; this graph does the same. x across the screen goes through a **Cubic Bezier** shaper, and every pixel below the curve is painted, so the boundary *is* the curve.

**How it is built.** Compare asks "is the shaped x greater than y?" and answers 1 or 0 (Smoothing softens the edge by a hair). Select picks one of two colours with that mask. The **Shapers** category holds a dozen more curves; swap the node and the outline changes.

**Try.** Move the four handles from the Play page. Then use a shaper anywhere a 0–1 number feels too linear: a fade, a radius, a palette input.`);

lesson('learnShape', [
  uv(),
  n('circleSDF', 'circ', 280, 220, { radius: 0.4 }, { position: ['uv', 'uv'] }),
  n('sdfFill', 'fill', 540, 220, { strokeWidth: 0.03 }, { d: ['circ', 'distance'] }),
  out(['fill', 'result'], 820),
], [ctl('r', 'circ::radius', 'Radius', 0.05, 0.9, 0.01), ctl('s', 'fill::strokeWidth', 'Stroke', 0, 0.2, 0.005)], `**What it shows.** Shapes in shaders are *distance fields*. **Circle SDF** doesn't draw anything: for each pixel it returns how far that pixel is from the circle's edge, negative inside and positive outside. **SDF Fill** then paints by that number: inside gets the fill, a band around zero gets the stroke, the rest the background, with a soft anti-aliased edge.

**How it is built.** UV in, a float out, a colour out. Keeping shape and paint separate is the whole trick: the same distance can be filled, stroked, glowed, warped or combined before anyone paints it.

**Try.** Click the swatches on SDF Fill. Set Stroke to 0 for a plain disc. Replace Circle SDF with Box SDF or Shape SDF; SDF Fill doesn't care what made the distance.`);

lesson('learnDistance', [
  uv(),
  n('circleSDF', 'circ', 280, 220, { radius: 0.3 }, { position: ['uv', 'uv'] }),
  n('light', 'glow', 540, 220, { mode: 'glow', brightness: 8, tint: [1.0, 0.7, 0.35] }, { distance: ['circ', 'distance'] }),
  n('toneMap', 'tone', 800, 220, { mode: 'aces' }, { color: ['glow', 'tinted'] }),
  out(['tone', 'color'], 1040),
], [ctl('f', 'glow::brightness', 'Falloff', 1, 40, 0.5), colourCtl('t', 'glow::tint', 'Tint')], `**What it shows.** Because a distance is just a number, it can be turned into light instead of a hard edge. **SDF Glow** maps the distance to brightness that fades with the distance from the edge, so the circle becomes a soft lamp. Its Tinted output already carries the colour.

**How it is built.** Circle SDF → SDF Glow → Tone Map → Output. Tone Map (ACES) rolls very bright values off gently instead of clipping to white; put one before Output whenever you add light.

**Try.** Lower Falloff for a wider halo. Switch SDF Glow's Mode to Rings. Wire the Time lesson's Remap into Radius and the lamp pulses.`);

lesson('learnCombine', [
  uv(),
  time(40, 480),
  n('sin', 'sn', 260, 480, { freq: 0.7, amp: 0.55 }, { input: ['time', 'time'] }),
  n('makeVec2', 'off', 480, 480, { y: 0 }, { x: ['sn', 'output'] }),
  n('circleSDF', 'circ', 700, 360, { radius: 0.28 }, { position: ['uv', 'uv'], offset: ['off', 'xy'] }),
  n('boxSDF', 'box', 700, 160, { width: 0.32, height: 0.32, posX: 0.0, posY: 0.0 }, { position: ['uv', 'uv'] }),
  n('sdfUnion', 'un', 960, 220, { k: 0.18 }, { a: ['box', 'distance'], b: ['circ', 'distance'] }),
  n('sdfFill', 'fill', 1200, 220, { strokeWidth: 0.0 }, { d: ['un', 'dist'] }),
  out(['fill', 'result'], 1460),
], [ctl('k', 'un::k', 'Smoothness', 0, 0.6, 0.01), ctl('r', 'circ::radius', 'Circle radius', 0.05, 0.6, 0.01)], `**What it shows.** Two distance fields combine with plain maths: the minimum of the two distances is their **Union**. With a little k, Union blends the two like putty where they meet, so the swinging circle and the box merge and pull apart smoothly.

**How it is built.** Time → Sin → Make Vec2 gives the circle an offset that swings left and right. Box SDF and Circle SDF both read the same UV; Union takes both distances and SDF Fill paints the result. Intersect and Subtract sit next to Union in the SDF category.

**Try.** Set Smoothness to 0 for a hard join. Swap Union for Subtract and the circle bites out of the box.`);

lesson('learnTransform', [
  uv(),
  time(40, 420),
  n('multiply', 'spd', 260, 420, { b: 0.4 }, { a: ['time', 'time'] }),
  n('uvTransform2d', 'xf', 480, 220, { sx: 1, sy: 1, tx: 0, ty: 0 }, { uv: ['uv', 'uv'], angle: ['spd', 'result'] }),
  n('boxSDF', 'box', 740, 220, { width: 0.3, height: 0.3 }, { position: ['xf', 'result'] }),
  n('sdfFill', 'fill', 1000, 220, { strokeWidth: 0.02 }, { d: ['box', 'distance'] }),
  out(['fill', 'result'], 1260),
], [ctl('spd', 'spd::b', 'Spin speed', -2, 2, 0.05), ctl('sx', 'xf::sx', 'Scale x', 0.2, 3, 0.01), ctl('sy', 'xf::sy', 'Scale y', 0.2, 3, 0.01)], `**What it shows.** Shaders don't move shapes; they move the *coordinates* the shapes are measured in. **UV Transform 2D** rotates, scales and shifts the UV before Box SDF sees it, so the box appears to spin. Rotate the space one way and the picture turns the other, which is why the maths looks backwards at first.

**How it is built.** Time × 0.4 is the angle in radians. Everything downstream of UV Transform 2D, however much you add, is transformed together. In GLSL this is a 2×2 rotation matrix; the Matrix folder shows it spelled out.

**Try.** Change Scale x alone: the space stretches, so the box squashes. Put the transform *after* the Tiling lesson's Tile node and every tile turns on its own.`);

lesson('learnPalette', [
  uv(),
  time(40, 420),
  n('length', 'len', 280, 220, { scale: 1 }, { input: ['uv', 'uv'] }),
  n('palette', 'pal', 540, 220, { preset: '1', scale: 1, speed: 0.15 }, { value: ['len', 'output'], anim: ['time', 'time'] }),
  out(['pal', 'color'], 820),
], [ctl('sc', 'pal::scale', 'Repeats', 0.2, 6, 0.05), ctl('sp', 'pal::speed', 'Speed', 0, 1, 0.01)], `**What it shows.** A **Palette** turns one number into a colour by running three cosine waves, one per channel, each with its own offset, amplitude, frequency and phase (Inigo Quilez's formula). Feed it the distance from the centre and you get coloured rings; feed it Time and they cycle.

**How it is built.** Length of the UV is the input; the preset picks the four vec3s; Speed scrolls the palette. Set the preset to Custom to edit the waves yourself. Palettes are the standard way to colour any float in the rest of the course: noise, iteration counts, cell IDs.

**Try.** Raise Repeats. Change the preset. Replace Length with the x from the UV lesson for a horizontal gradient.`);

lesson('learnTiling', [
  uv(),
  n('fract', 'tile', 280, 220, { scale: 3 }, { input: ['uv', 'uv'] }),
  n('circleSDF', 'circ', 540, 220, { radius: 0.3 }, { position: ['tile', 'output'] }),
  n('sdfFill', 'fill', 800, 220, { strokeWidth: 0.03 }, { d: ['circ', 'distance'] }),
  out(['fill', 'result'], 1060),
], [ctl('n', 'tile::scale', 'Tiles', 1, 12, 1), ctl('r', 'circ::radius', 'Radius', 0.05, 0.7, 0.01)], `**What it shows.** **Tile** multiplies the UV and keeps only the fractional part, recentred, so the coordinates run 0…1 again and again across the screen. One circle drawn after it appears in every tile, because every tile has the same coordinates. This is the Book of Shaders' *patterns* chapter in one node.

**How it is built.** UV → Tile → Circle SDF → SDF Fill. The circle has no idea it is repeated. Anything placed between Tile and the shape (a rotation, an offset) happens inside each tile.

**Try.** More tiles, smaller radius. Put the UV Transform from the previous lesson between Tile and Circle SDF. Next lesson: telling the tiles apart.`);

lesson('learnGrid', [
  uv(),
  n('gridLayout', 'grid', 280, 220, { columns: 6 }, { uv: ['uv', 'uv'] }),
  n('noiseFloat', 'hash', 540, 400, { mode: 'hash', scale: 1, speed: 0 }, { uv: ['grid', 'cellID'] }),
  n('remap', 'rad', 780, 400, { inMin: 0, inMax: 1, outMin: 0.1, outMax: 0.42 }, { value: ['hash', 'value'] }),
  n('palette', 'pal', 780, 560, { preset: '4', scale: 1 }, { value: ['hash', 'value'] }),
  n('circleSDF', 'circ', 1020, 220, {}, { position: ['grid', 'cellUV'], radius: ['rad', 'result'] }),
  n('sdfFill', 'fill', 1280, 220, { strokeWidth: 0, background: [0.06, 0.06, 0.09] }, { d: ['circ', 'distance'], fillColor: ['pal', 'color'] }),
  out(['fill', 'result'], 1540),
], [ctl('min', 'rad::outMin', 'Smallest', 0.02, 0.5, 0.01), ctl('max', 'rad::outMax', 'Largest', 0.02, 0.5, 0.01)], `**What it shows.** **Grid** is Tile with a memory: besides the coordinates inside each cell (**Cell UV**) it gives each cell a whole-number **Cell ID**. Hash the ID and every cell gets its own random number that never changes, so the circles differ in size and colour but hold still.

**How it is built.** Noise Float in Hash mode reads the Cell ID and gives 0…1 per cell. Remap turns that into a radius; Palette turns it into a colour; Circle SDF draws in the Cell UV; SDF Fill paints. The same recipe colours bricks, windows, stars.

**Try.** Change Columns on the Grid card. Wire Time into Noise Float's time input and set its speed above 0 to make the cells flicker. Use Cell ID for anything that should differ per cell.`);

lesson('learnGridPattern', [
  uv(),
  n('mouse', 'mouse', 40, 420),
  n('gridPattern', 'gp', 320, 220, { columns: 8, shape: 'circle', size: 0.3, pattern: 'checker', affect: 'grow', affectRadius: 0.7, affectSoftness: 0.8 }, { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'] }),
  out(['gp', 'color'], 620),
], [ctl('s', 'gp::size', 'Size', 0.05, 0.6, 0.01), ctl('r', 'gp::affectRadius', 'Mouse radius', 0.1, 2, 0.01), ctl('a', 'gp::affectAmount', 'Mouse strength', 0, 2, 0.01)], `**What it shows.** The whole previous lesson in one node. **Grid Pattern** cuts the UV into cells, puts a shape in each, decides which cells get one (every cell, every other column or row, a checkerboard, diagonals, random), and lets a point affect the shapes near it. Here the mouse makes the dots grow.

**How it is built.** UV in, Mouse UV into Affect Pos, colour out. Pick the shape, the pattern and the affect mode on the card. The raw grid is still there on the other outputs (Cell UV, Cell ID, Distance, Influence), so you can take it further with the rest of the Grid family or SDF Glow.

**Try.** Change Pattern to Diagonal stripes and Shape to Cross. Set Affect to Hide, then to Spin. Add Jitter to break the grid.`);

lesson('learnGridSpread', [
  uv(),
  n('mouse', 'mouse', 40, 420),
  n('gridPattern', 'gp', 320, 220, { columns: 10, shape: 'box', size: 0.22, pattern: 'all', affect: 'pull', affectRadius: 1.1, affectSoftness: 1.0, affectAmount: 1.2 }, { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'] }),
  n('palette', 'pal', 620, 400, { preset: '5', scale: 1 }, { value: ['gp', 'influence'] }),
  n('colorize', 'paint', 880, 220, { background: [0.05, 0.05, 0.08] }, { field: ['gp', 'mask'], color: ['pal', 'color'] }),
  out(['paint', 'color'], 1140),
], [ctl('a', 'gp::affectAmount', 'Pull', 0, 2, 0.01), ctl('r', 'gp::affectRadius', 'Reach', 0.1, 3, 0.01), ctl('sz', 'gp::size', 'Size', 0.05, 0.5, 0.01)], `**What it shows.** An effect spreading across a grid is a distance from a point, measured per cell. **Influence** is 1 at the mouse and fades to 0 at the radius; here it pulls the squares toward the mouse *and* colours them through a Palette, so the disturbance ripples outward as one thing.

**How it is built.** Grid Pattern's Influence output goes into a Palette, and Colorize paints Grid Pattern's Mask with that palette colour: the shapes and their colour come from the same node, through two different outputs. Cell Displace and Neighbor Dist in the Grid folder do the same idea by hand.

**Try.** Set Affect to Push. Feed Influence into a Remap → Size instead of the colour. Drive Affect Pos from a Play null instead of the mouse.`);

lesson('learnNoise', [
  uv(),
  time(40, 420),
  n('noiseFloat', 'nz', 300, 220, { mode: 'smooth', scale: 4, speed: 0.4 }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
  n('colorize', 'col', 560, 220, { color: [0.95, 0.75, 0.4], background: [0.08, 0.06, 0.12] }, { field: ['nz', 'value'] }),
  out(['col', 'color'], 820),
], [ctl('sc', 'nz::scale', 'Scale', 0.5, 16, 0.1), ctl('sp', 'nz::speed', 'Speed', 0, 2, 0.01)], `**What it shows.** A hash is random from pixel to pixel, which reads as static. *Noise* is random too, but smooth: random values on a grid, interpolated between. **Noise Float** in Smooth mode is that value noise; Perlin is the gradient version with fewer blobs. Time moves through a third dimension of it, so it drifts.

**How it is built.** UV → Noise Float → Colorize (background where the noise is 0, colour where it is 1). Scale is how many noise cells fit across; Speed how fast it evolves. Switch Mode to Hash to see the static it is built from.

**Try.** Scale 1 for one big blob, 16 for grain. Wire the noise into a circle's radius, a UV Transform angle, or a Palette.`);

lesson('learnFBM', [
  uv(),
  time(40, 420),
  n('fbm', 'fbm', 300, 220, { octaves: 5, scale: 1.5, time_scale: 0.15 }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
  n('palette', 'pal', 560, 220, { preset: '0', scale: 1 }, { value: ['fbm', 'value'] }),
  out(['pal', 'color'], 820),
], [ctl('sc', 'fbm::scale', 'Scale', 0.3, 6, 0.05), ctl('g', 'fbm::gain', 'Gain (roughness)', 0.2, 0.8, 0.01)], `**What it shows.** Stack noise at doubling frequencies and halving strengths and you get **fractal Brownian motion**: big soft shapes with finer and finer detail on top, the look of clouds, smoke, terrain and marble. Octaves is how many layers; Gain how much each finer layer counts.

**How it is built.** Fractal Noise (FBM) is a loop of Noise Float inside one node. Palette colours the height. The Iterated Groups lesson shows how to build that loop yourself from nodes.

**Try.** Gain 0.3 for smooth hills, 0.7 for rough rock. Scale up for detail. Feed the FBM value into an SDF's radius to make a wobbly shape.`);

lesson('learnWarp', [
  uv(),
  time(40, 420),
  n('domainWarp', 'warp', 300, 220, { strength: 0.6, scale: 1.2, time_scale: 0.1 }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
  n('fbm', 'fbm', 560, 220, { octaves: 5, scale: 1.5, time_scale: 0.0 }, { uv: ['warp', 'uv'] }),
  n('palette', 'pal', 820, 220, { preset: '7', scale: 1 }, { value: ['fbm', 'value'] }),
  out(['pal', 'color'], 1080),
], [ctl('st', 'warp::strength', 'Warp strength', 0, 1.5, 0.01), ctl('sc', 'warp::scale', 'Warp scale', 0.2, 4, 0.05)], `**What it shows.** *Domain warping* is noise applied to the coordinates before more noise reads them: the space itself is pushed around, so the FBM after it flows and folds like marble or ink in water. This is the last of the Book of Shaders' generative chapters, and the trick behind most "organic" shaders.

**How it is built.** Domain Warp takes the UV and returns a displaced UV (its Offset output is the displacement alone). FBM reads the warped UV, Palette colours it. Two warps in a row go further still.

**Try.** Strength 0 to see the un-warped FBM, then raise it. Warp a Grid or a Tile instead of noise and the cells bend.`);

lesson('learnLoop', [
  uv(40, 260),
  group('loop', 300, 160, {
    label: 'Fold 4×', iterations: 4,
    inputs: [{ key: 'in_uv', type: 'vec2', label: 'UV', from: ['uv', 'uv'] }],
    outputs: [{ key: 'out_color', type: 'vec3', label: 'Color', from: ['pal', 'color'] }],
    nodes: [
      n('loopCarry', 'carry', 80, 200, { dataType: 'vec2' }, { init: port('in_uv'), next: ['fold', 'output'] }),
      n('fract', 'fold', 320, 200, { scale: 1.5 }, { input: ['carry', 'value'] }),
      n('length', 'len', 560, 200, { scale: 1 }, { input: ['fold', 'output'] }),
      n('loopIndex', 'i', 320, 400),
      n('multiply', 'i3', 560, 400, { b: 0.3 }, { a: ['i', 'i'] }),
      n('add', 't', 800, 300, {}, { a: ['len', 'output'], b: ['i3', 'result'] }),
      n('palette', 'pal', 1040, 300, { preset: '1', scale: 1 }, { value: ['t', 'result'] }, { assignOp: '+=' } as Partial<GraphNode>),
    ],
  }),
  n('addColor', 'quarter', 600, 260, { scale: 0.25 }, { a: ['loop', 'out_color'] }),
  n('toneMap', 'tone', 840, 260, { mode: 'aces' }, { color: ['quarter', 'result'] }),
  out(['tone', 'color'], 1080, 260),
], [ctl('f', 'loop::fold::scale', 'Fold scale', 1.05, 3, 0.01)], `**What it shows.** A group with Iterations set to 4 is a \`for\` loop: its subgraph runs four times in a row. Two nodes make the passes talk to each other. **Loop Carry** is a variable that lives across passes: Init is its value before the first pass, Next is what the pass writes into it, Value is what the current pass reads. Here it carries the UV: each pass folds it with Tile, and the next pass folds the folded one, so four passes fold four times. **Loop Index** is the pass number, used to shift the palette per pass.

**How it is built.** Inside the group: Loop Carry (vec2) → Tile → Length → + Index × 0.3 → Palette. The Palette node's assignment is set to **+=** in its header, so instead of the last pass winning, all four colours add up; Add Colors × 0.25 averages them and Tone Map rounds off the peaks. In GLSL: \`vec2 c = uv; for (i…) { c = fract(c*1.5)-0.5; col += palette(length(c)+i*0.3); }\`. The ⟳ carry-mode button on a node is a shortcut for the same wiring when a node feeds itself.

**Try.** Raise Iterations on the group to 6. Change Fold scale. Swap Tile for Rotate 2D and the carry becomes an accumulated rotation.`);

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * The Learn folder's graphs. The last lesson reuses the 3D "Hello Sphere"
 * example's nodes, so it stays exactly in step with that graph; it is passed
 * in because this module is loaded by exampleGraphs.ts itself.
 */
export function buildLearnExamples(base: Record<string, ExampleGraph>): Record<string, ExampleGraph> {
  const out: Record<string, ExampleGraph> = {};
  for (const l of L) {
    out[l.key] = { ...LEARN_EXAMPLE_INDEX[l.key], counter: 40, nodes: l.nodes, play: play(l.controls, l.notes) };
  }
  const hello = base.rayMarchOutputs3D;
  if (hello) {
    out.learnRaymarch = {
      ...LEARN_EXAMPLE_INDEX.learnRaymarch, counter: hello.counter, nodes: hello.nodes,
      play: play([], `**What it shows.** Everything so far was flat: a colour per (x, y). Ray marching adds depth without any geometry. **March Camera** turns each pixel into a ray (an origin and a direction). The **Scene Group** describes the world as a 3D distance field, exactly like the 2D SDFs but with a vec3 position. The **March Loop Group** walks the ray forward by the scene distance until it is close enough to call it a hit, and reports the hit's position, normal and depth. The normal is painted as colour, the standard first look at any surface.

**How it is built.** March Camera → March Loop Group, with the Scene Group wired into its Scene input; inside the Scene Group a Sphere 3D on the Scene Pos. Open the group to see the sphere; add a Box 3D and a Union and the scene grows. The 3D folders take it from here: lighting, shadows, repetition, glass.

**Try.** Change the camera's angle and distance on the March Camera card. Replace Normal to Color with Multi-Light and the sphere is lit.`),
    };
  }
  return out;
}
