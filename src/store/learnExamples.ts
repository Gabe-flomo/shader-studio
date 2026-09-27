/**
 * learnExamples.ts — the Learn folder: The Book of Shaders
 * (https://thebookofshaders.com/, Patricio Gonzalez Vivo and Jen Lowe) as
 * graphs, chapter by chapter and in the Book's order, one idea per lesson.
 * Each has a one-line description in the examples list and notes on the Play
 * page that say what it shows, how it is built and what to try, and credit
 * the chapter it follows. The notes are our own words; the ideas are the
 * Book's.
 *
 * Also here: the earlier Learn lessons that teach something the Book doesn't
 * (a Bezier shaper, SDF nodes, cosine palettes, the Grid nodes). They keep
 * their keys and notes and live in the folders they fit (learnExampleIndex.ts).
 *
 * Graphs are built from the node definitions themselves (sockets come from
 * the definition, params are the defaults plus what the lesson changes), so a
 * lesson can't drift from the node it teaches. The tests compile every one
 * and check its Play controls point at live params.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { PlayControl } from '../types/play';
import { VECTORIZABLE_NODES } from '../nodes/definitions/math';
import { ctl, colourCtl, group, n, out, play, port, time, uv } from './graphBuilder';
import type { ExampleGraph } from './exampleIndex';
import { LEARN_EXAMPLE_INDEX, LEARN_MOVED_INDEX } from './learnExampleIndex';

// ── Helpers ─────────────────────────────────────────────────────────────────

type Wire = [string, string];
type RGB = [number, number, number];

const note = (text: string) => ({ __comment: text });

/** A math node switched to a vector type, as the type pills on its card do: its main sockets, its result and params.outputType. */
function vt(node: GraphNode, t: 'vec2' | 'vec3'): GraphNode {
  const v = VECTORIZABLE_NODES[node.type];
  if (!v) throw new Error(`learnExamples: ${node.type} can't be vectorised`);
  const keys = new Set([v.primaryInput, ...(v.alsoInputs ?? [])]);
  const inputs = Object.fromEntries(Object.entries(node.inputs).map(([k, s]) => [k, keys.has(k) ? { ...s, type: t } : s]));
  const outputs = { ...node.outputs, [v.primaryOutput]: { ...node.outputs[v.primaryOutput], type: t } };
  return { ...node, inputs, outputs, params: { ...node.params, outputType: t } };
}

/** An Expression Block: named inputs wired in, a few lines, a float result. */
function expr(id: string, x: number, y: number, label: string, wires: Record<string, Wire>, types: Record<string, 'float' | 'vec2'>,
  lines: Array<{ lhs: string; op: string; rhs: string }>, result: string, comment: string): GraphNode {
  const base = n('exprNode', id, x, y, {
    inputs: Object.keys(wires).map(name => ({ name, type: types[name] ?? 'float', slider: null })),
    outputType: 'float', lines, result, expr: result, label, ...note(comment),
  });
  const inputs: GraphNode['inputs'] = {};
  for (const [k, [from, key]] of Object.entries(wires)) inputs[k] = { type: types[k] ?? 'float', label: k, connection: { nodeId: from, outputKey: key } };
  return { ...base, inputs, outputs: { result: { type: 'float', label: 'Result' } } };
}

/** The Book's `st`: the pixel's position divided by the canvas size, 0…1 on both axes. */
const stNodes = (): GraphNode[] => [
  n('fragCoord', 'px', 40, 160),
  n('resolution', 'res', 40, 340),
  vt(n('divide', 'st', 280, 220, { ...note('st = pixel position ÷ canvas size: (0, 0) at the bottom-left corner, 1 at the right and top edges. The Book calls it st.') },
    { a: ['px', 'coord'], b: ['res', 'res'] }), 'vec2'),
];

/** st, split into x and y: the frame every plot draws in. */
const plotFrame = (): GraphNode[] => [...stNodes(), n('splitVec2', 'xy', 520, 220, {}, { v: ['st', 'result'] })];

const PLOT_BG: RGB = [0.04, 0.045, 0.07];
/** The Book's plot background: the function's value as brightness. */
const plotBg = (f: Wire, x: number, y: number) =>
  n('colorize', 'bg', x, y, { color: [0.62, 0.64, 0.72], background: PLOT_BG, ...note('The background is the value itself: dark where the function gives 0, light where it gives 1.') }, { field: f });

/** A line where y equals f: Compare ≈ is 1 on the curve and fades within Smoothing; Colorize paints it over `under`. */
function plotLine(id: string, f: Wire, under: Wire, colour: RGB, x: number, y: number, width = 0.012): GraphNode[] {
  return [
    n('compare', `${id}_on`, x, y, { operator: '≈', smoothing: width, ...note('Is this pixel\'s y (almost) equal to the function\'s value at its x? 1 on the curve, 0 away from it: the Book\'s plot().') }, { a: f, b: ['xy', 'y'] }),
    n('colorize', id, x + 240, y, { color: colour }, { field: [`${id}_on`, 'mask'], background: under }),
  ];
}

/** Paint a shape from its distance: inside (d < 0) in `fill`, the rest in `bg`. */
function paint(id: string, d: Wire, x: number, y: number, fill: RGB, bg: RGB = [0.05, 0.05, 0.09]): GraphNode[] {
  return [
    n('compare', `${id}_in`, x, y, { operator: '<', smoothing: 0.006, ...note('Inside the shape the distance is below 0: 1 there, 0 outside, with a soft edge.') }, { a: d }),
    n('colorize', id, x + 240, y, { color: fill, background: bg }, { field: [`${id}_in`, 'mask'] }),
  ];
}

const GREEN: RGB = [0.35, 0.95, 0.45];
const ORANGE: RGB = [1.0, 0.6, 0.25];
const BLUE: RGB = [0.45, 0.7, 1.0];
const RED: RGB = [1.0, 0.35, 0.35];
const CREAM: RGB = [0.97, 0.9, 0.78];

/** The credit line every Book lesson ends with. */
const book = (ch: number, title: string) =>
  `\n\n**Source.** The Book of Shaders by Patricio Gonzalez Vivo and Jen Lowe, chapter ${ch}, ${title}: https://thebookofshaders.com/${String(ch).padStart(2, '0')}/`;

// ── Lessons ─────────────────────────────────────────────────────────────────

type Lesson = { key: string; nodes: GraphNode[]; controls: PlayControl[]; notes: string };
const L: Lesson[] = [];
const lesson = (key: string, nodes: GraphNode[], controls: PlayControl[], notes: string) => L.push({ key, nodes, controls, notes });

// ── Getting started (chapters 2–3) ──────────────────────────────────────────

lesson('learnColour', [
  n('colorPicker', 'col', 200, 220, { color: [0.96, 0.55, 0.2] }),
  out(['col', 'rgb'], 480),
], [colourCtl('c', 'col::color', 'Colour')], `**What it shows.** A fragment shader is a tiny program the GPU runs once for every pixel, all at the same time, and the only thing each run has to decide is that pixel's colour. This graph is the smallest possible one: a **Colour** node wired into **Output**. Every pixel gets the same answer, so the whole picture is orange.

**How it is built.** Output is the shader's \`gl_FragColor\`. Anything that produces a vec3 (three numbers: red, green, blue, each 0–1) can be wired into it. Open the GLSL tab to see the two lines it compiles to.

**Try.** Click the swatch and pick another colour; the shader recompiles nothing, the number just changes. Next: give each pixel a different answer.${book(2, 'Hello world')}`);

lesson('learnTime', [
  time(40, 220),
  n('sin', 'sn', 260, 220, { freq: 1, amp: 1 }, { input: ['time', 'time'] }),
  n('remap', 'rm', 480, 220, { inMin: -1, inMax: 1, outMin: 0, outMax: 1 }, { value: ['sn', 'output'] }),
  n('oklabMix', 'mix', 720, 220, { a: [0.98, 0.8, 0.2], b: [0.15, 0.3, 0.95] }, { t: ['rm', 'result'] }),
  out(['mix', 'result'], 960),
], [ctl('speed', 'sn::freq', 'Speed', 0.1, 4, 0.1)], `**What it shows.** A *uniform* is a value the program hands to every pixel alike, and **Time** (the Book's \`u_time\`) is the first one: the seconds since the shader started. On its own it runs off to infinity, so it is almost always bent into a wave first: **Sin** turns it into −1…1, Remap makes that 0…1, and that drives the blend between two colours. The picture breathes.

**How it is built.** OkLab Mix blends in a perceptual colour space, so the halfway colour stays bright instead of going grey (compare the plain Mix node). Nothing here depends on position yet, so the whole screen changes together.

**Try.** Raise Speed until the pulse is a flicker, then lower it until you can barely see it move. Give red, green and blue their own Sin at different speeds (Make Vec3) and the colour wanders.${book(3, 'Uniforms')}`);

lesson('learnUV', [
  ...stNodes(),
  n('splitVec2', 'split', 520, 220, {}, { v: ['st', 'result'] }),
  n('makeVec3', 'rgb', 760, 220, { b: 0, ...note('x becomes red, y becomes green. Blue is a slider.') }, { r: ['split', 'x'], g: ['split', 'y'] }),
  out(['rgb', 'rgb'], 1000),
], [ctl('b', 'rgb::b', 'Blue', 0, 1, 0.01)], `**What it shows.** The one thing that differs from pixel to pixel is *where* it is. **Pixel Coordinates** (\`gl_FragCoord\`) is that position in pixels; dividing it by **Resolution** (\`u_resolution\`, the canvas size) gives \`st\`, which runs from 0 at the bottom-left corner to 1 at the top and right edges on any screen. Painting x as red and y as green shows the coordinate system itself: black at the bottom-left, red at the bottom-right, green at the top-left, yellow at the top-right.

**How it is built.** Pixel Coordinates ÷ Resolution (a Divide switched to vec2) → Split Vec2 → Make Vec3 → Output. The shaping lessons that come next plot their curves in this same \`st\`. Later lessons mostly use the **UV** node instead: the same idea, but centred on the middle of the screen, running −1…1 up the screen and corrected for the screen's shape so circles stay round.

**Try.** Raise Blue. Swap the two wires into Make Vec3. Use the **Mouse** node's Pixels output divided by Resolution in place of st: now the whole screen takes the mouse's colour, because the mouse is a uniform too.${book(3, 'Uniforms')}`);

// ── Shaping functions (chapter 5) ───────────────────────────────────────────

lesson('learnPlot', [
  ...plotFrame(),
  n('multiply', 'slope', 760, 160, { b: 1, ...note('The function. Here y = slope × x + offset; at slope 1 and offset 0 it is y = x.') }, { a: ['xy', 'x'] }),
  n('add', 'f', 1000, 160, { b: 0 }, { a: ['slope', 'result'] }),
  plotBg(['f', 'result'], 1000, 420),
  ...plotLine('line', ['f', 'result'], ['bg', 'color'], GREEN, 1240, 220),
  out(['line', 'color'], 1720),
], [ctl('m', 'slope::b', 'Slope', -2, 3, 0.01), ctl('c', 'f::b', 'Offset', -1, 1, 0.01), ctl('w', 'line_on::smoothing', 'Line width', 0.002, 0.05, 0.001)], `**What it shows.** How to *see* a function. Each pixel feeds its x into the function and gets a number back. That number is painted as brightness (the gradient behind) and, where it equals the pixel's own y, as a green line. At slope 1 and offset 0 the function is y = x: the gradient runs evenly from black to light and the line is the diagonal.

**How it is built.** st (from the UV lesson) → Split Vec2. The function is Multiply then Add on x. **Compare** in ≈ mode asks "is this y (almost) the function's value?" and answers 1 on the curve: that is the Book's \`plot()\`. Colorize paints the line over the gradient. Every lesson in this chapter reuses this frame and only swaps the function.

**Try.** Tilt the line with Slope, lift it with Offset. At slope 0 the gradient is flat: every pixel gets the same value. Put any node between x and Add (a Sin, a Pow) and the plot draws it.${book(5, 'Shaping functions')}`);

lesson('learnPow', [
  ...plotFrame(),
  n('pow', 'f', 760, 140, { exponent: 5, ...note('y = x to the power n. Below 1 the curve bulges up, above 1 it sags.') }, { base: ['xy', 'x'] }),
  n('sqrt', 'root', 760, 380, { ...note('For comparison: √x, which is x to the power 0.5.') }, { input: ['xy', 'x'] }),
  plotBg(['f', 'result'], 1000, 520),
  ...plotLine('ref', ['root', 'output'], ['bg', 'color'], BLUE, 1000, 340, 0.008),
  ...plotLine('line', ['f', 'result'], ['ref', 'color'], GREEN, 1480, 160),
  out(['line', 'color'], 1960),
], [ctl('e', 'f::exponent', 'Exponent', 0.05, 10, 0.01)], `**What it shows.** **Pow** bends the straight line into a curve while keeping both ends put: 0 stays 0 and 1 stays 1, because 0ⁿ = 0 and 1ⁿ = 1. Above 1 the curve sags (a slow start, a fast finish, an ease-in); below 1 it bulges (an ease-out). The blue line is **Square Root**, the same thing as an exponent of 0.5.

**How it is built.** The plot frame from the previous lesson with Pow as the function, plus a second line for √x. The gradient behind shows the green curve's values.

**Try.** Slide the exponent to 0.5: the green line lands on the blue one. 1 gives back y = x. Swap Pow for **Exp**, **Square Root** or **Round Up** and watch the shape change; the Book lists these as the everyday bending tools.${book(5, 'Shaping functions')}`);

lesson('learnStep', [
  ...plotFrame(),
  n('step', 'hard', 760, 140, { edge: 0.5, ...note('step(edge, x): 0 below the threshold, 1 at or above it. A hard switch.') }, { x: ['xy', 'x'] }),
  n('smoothstep', 'soft', 760, 400, { edge0: 0.1, edge1: 0.9, ...note('smoothstep(from, to, x): 0 before From, 1 after To, and an S-shaped ramp in between.') }, { value: ['xy', 'x'] }),
  plotBg(['soft', 'result'], 1000, 560),
  ...plotLine('hardLine', ['hard', 'result'], ['bg', 'color'], ORANGE, 1000, 340),
  ...plotLine('line', ['soft', 'result'], ['hardLine', 'color'], GREEN, 1480, 160),
  out(['line', 'color'], 1960),
], [ctl('t', 'hard::edge', 'Step threshold', 0, 1, 0.01), ctl('a', 'soft::edge0', 'Smooth from', 0, 1, 0.01), ctl('b', 'soft::edge1', 'Smooth to', 0, 1, 0.01)], `**What it shows.** The two functions shaders use to make decisions without an \`if\`. **Step** (orange) jumps from 0 to 1 at a threshold. **Smoothstep** (green, and the gradient behind) climbs from 0 to 1 between two edges along an S-curve that starts and ends flat, so whatever it drives eases in and out.

**How it is built.** The plot frame with two functions, each drawn as its own line. The vertical part of the step isn't drawn: the plot only marks where y equals the value, and at the jump there is no value in between.

**Try.** Bring Smooth from and Smooth to close together: smoothstep turns into a step with a soft edge, which is how the next chapters anti-alias shapes. Subtract a second smoothstep that starts a little later and you get a bump.${book(5, 'Shaping functions')}`);

lesson('learnSinCos', [
  ...plotFrame(),
  time(520, 520),
  n('multiply', 'drift', 760, 520, { b: 1, ...note('Time × speed, added to x, slides the wave along.') }, { a: ['time', 'time'] }),
  n('add', 'phase', 760, 360, {}, { a: ['xy', 'x'], b: ['drift', 'result'] }),
  n('constant', 'freq', 760, 40, { value: 12.57, ...note('Frequency: how many radians the wave turns per unit of x. 2π (6.28) is one full wave across the screen.') }),
  n('constant', 'amp', 760, 180, { value: 0.4, ...note('Amplitude: how far the wave swings up and down.') }),
  n('sin', 's', 1000, 140, {}, { input: ['phase', 'result'], freq: ['freq', 'value'], amp: ['amp', 'value'] }),
  n('add', 'sy', 1240, 140, { b: 0.5, ...note('+ 0.5 lifts the wave into the middle of the screen.') }, { a: ['s', 'output'] }),
  n('cos', 'c', 1000, 380, {}, { input: ['phase', 'result'], freq: ['freq', 'value'], amp: ['amp', 'value'] }),
  n('add', 'cy', 1240, 380, { b: 0.5 }, { a: ['c', 'output'] }),
  plotBg(['sy', 'result'], 1480, 600),
  ...plotLine('cosLine', ['cy', 'result'], ['bg', 'color'], BLUE, 1480, 400, 0.01),
  ...plotLine('line', ['sy', 'result'], ['cosLine', 'color'], GREEN, 1960, 200),
  out(['line', 'color'], 2440),
], [ctl('f', 'freq::value', 'Frequency', 1, 40, 0.1), ctl('a', 'amp::value', 'Amplitude', 0, 0.5, 0.01), ctl('s', 'drift::b', 'Speed', -3, 3, 0.01)], `**What it shows.** **Sin** (green) and **Cos** (blue) go smoothly up and down between −1 and 1 forever: the most used functions in shaders, for anything that should swing, pulse or repeat. Cosine is the same wave a quarter turn ahead of sine. Adding Time to x makes the wave travel.

**How it is built.** x + Time × speed is the input; one Frequency and one Amplitude Constant feed both waves; + 0.5 centres them on the screen. The Sin node computes amp × sin(input × freq).

**Try.** Frequency 6.28 (2π) fits exactly one wave across. Amplitude 0 flattens both lines. Speed 0 freezes them; a negative speed runs them backwards. Wire the Sin output into Abs and the lower halves flip up into bounces.${book(5, 'Shaping functions')}`);

lesson('learnFractFloor', [
  ...plotFrame(),
  n('constant', 'count', 760, 420, { value: 4, ...note('How many times per screen the pattern repeats.') }),
  n('multiply', 'xn', 760, 180, {}, { a: ['xy', 'x'], b: ['count', 'value'] }),
  n('fractRaw', 'saw', 1000, 120, { ...note('fract: only the part after the decimal point, so 0 → 1, then back to 0, again and again: a sawtooth.') }, { input: ['xn', 'result'] }),
  n('floor', 'fl', 1000, 300, { ...note('floor: only the whole part, so the value climbs in steps.') }, { input: ['xn', 'result'] }),
  n('divide', 'stair', 1240, 300, {}, { a: ['fl', 'output'], b: ['count', 'value'] }),
  plotBg(['saw', 'output'], 1240, 540),
  ...plotLine('stairLine', ['stair', 'result'], ['bg', 'color'], ORANGE, 1480, 360),
  ...plotLine('line', ['saw', 'output'], ['stairLine', 'color'], GREEN, 1960, 160),
  out(['line', 'color'], 2440),
], [ctl('n', 'count::value', 'Count', 1, 12, 1), ctl('w', 'line_on::smoothing', 'Line width', 0.002, 0.05, 0.001)], `**What it shows.** Two functions that split a number in two. **Floor** keeps the whole part (1.7 → 1), so x × 4 floored and divided by 4 climbs in a staircase (orange). **Fract** keeps what's left after the decimal point (1.7 → 0.7), so it rises and drops back to 0 every time a whole number is passed: a sawtooth (green, and the gradient). Between them they are the whole of repetition: fract says *where inside* a repeat you are, floor says *which* repeat.

**How it is built.** x × Count, then Fract (scalar) and Floor side by side; Divide scales the staircase back into 0…1.

**Try.** Change Count. Swap Floor for **Round Up** (ceil) or **Round**. The same chapter's other small helpers are all nodes too: **Modulo** (fract with any period), **Abs**, **Sign**, **Clamp**, **Min** and **Max**; put one on x and plot it. The Patterns chapter uses Fract on the whole UV.${book(5, 'Shaping functions')}`);

lesson('learnShapers', [
  ...plotFrame(),
  n('doubleExpSigmoid', 'levin', 760, 140, { a: 0.6, ...note('Golan Levin\'s double-exponential sigmoid: an S-curve whose sharpness is one number.') }, { x: ['xy', 'x'] }),
  n('constant', 'k', 760, 520, { value: 6, ...note('k: how early and how sharply the impulse peaks (at x = 1/k).') }),
  expr('iq', 1000, 380, 'Exp impulse', { x: ['xy', 'x'], k: ['k', 'value'] }, {}, [], 'k * x * exp(1.0 - k * x)',
    'Inigo Quilez\'s exponential impulse: rises fast to 1 at x = 1/k, then decays slowly. Good for a hit, a flash, a bounce.'),
  plotBg(['levin', 'y'], 1000, 620),
  ...plotLine('iqLine', ['iq', 'result'], ['bg', 'color'], ORANGE, 1240, 420),
  ...plotLine('line', ['levin', 'y'], ['iqLine', 'color'], GREEN, 1720, 160),
  out(['line', 'color'], 2200),
], [ctl('a', 'levin::a', 'Sigmoid sharpness', 0, 1, 0.01), ctl('k', 'k::value', 'Impulse k', 1, 30, 0.1)], `**What it shows.** Beyond the built-in functions there are whole families of hand-made curves, and the Book points to two collections. Golan Levin's polynomial and exponential shaping functions give eases, seats and S-curves with one or two handles: the green line is his **Exp Sigmoid**. Inigo Quilez's functions are small formulas with a job: the orange line is his *exponential impulse*, k·x·e^(1−k·x), which shoots up to 1 and dies away slowly.

**How it is built.** The plot frame with two functions. Exp Sigmoid is a node from the **Shapers** category, which holds Levin's set (Exp Ease, Exp Seat, Logistic Sigmoid, Circle Seat and Sigmoid, Elliptic Sigmoid, Bezier). The impulse is an **Expression Block** with x and k as inputs, since there's no node for it: any formula from Quilez's page can go in one the same way.

**Try.** Sharpness 0 is almost y = x; 1 is almost a step. Raise k and the impulse peaks earlier. Swap Exp Sigmoid for Exp Seat or Circle Seat. In the Expression Block, try Quilez's cubic pulse: 1 − smoothstep(0, 0.1, abs(x − 0.5)).${book(5, 'Shaping functions')}`);

// ── Colours (chapter 6) ─────────────────────────────────────────────────────

lesson('learnGradient', [
  ...plotFrame(),
  n('colorPicker', 'ca', 520, 460, { color: [0.12, 0.1, 0.42] }),
  n('colorPicker', 'cb', 520, 640, { color: [1.0, 0.72, 0.3] }),
  n('smoothstep', 'pr', 760, 60, { edge0: 0, edge1: 1, ...note('How far red has gone from A to B, at this x.') }, { value: ['xy', 'x'] }),
  n('sin', 'pg', 760, 240, { freq: 3.1416, amp: 1, ...note('Green: half a sine wave, so it peaks in the middle and comes back.') }, { input: ['xy', 'x'] }),
  n('pow', 'pb', 760, 420, { exponent: 0.5, ...note('Blue: a power curve.') }, { base: ['xy', 'x'] }),
  n('mix', 'mr', 1000, 60, {}, { a: ['ca', 'r'], b: ['cb', 'r'], t: ['pr', 'result'] }),
  n('mix', 'mg', 1000, 240, {}, { a: ['ca', 'g'], b: ['cb', 'g'], t: ['pg', 'output'] }),
  n('mix', 'mb', 1000, 420, {}, { a: ['ca', 'b'], b: ['cb', 'b'], t: ['pb', 'result'] }),
  n('makeVec3', 'col', 1240, 240, { ...note('Each channel mixed from A to B by its own amount.') }, { r: ['mr', 'result'], g: ['mg', 'result'], b: ['mb', 'result'] }),
  ...plotLine('lr', ['pr', 'result'], ['col', 'rgb'], RED, 1480, 60, 0.008),
  ...plotLine('lg', ['pg', 'output'], ['lr', 'color'], GREEN, 1480, 240, 0.008),
  ...plotLine('lb', ['pb', 'result'], ['lg', 'color'], BLUE, 1480, 420, 0.008),
  out(['lb', 'color'], 1960),
], [ctl('r', 'pr::edge1', 'Red: ramp end', 0.05, 1, 0.01), ctl('g', 'pg::freq', 'Green: sine frequency', 0, 6.28, 0.01), ctl('b', 'pb::exponent', 'Blue: power', 0.1, 5, 0.01)], `**What it shows.** **Mix** blends two values by a percentage: 0 gives A, 1 gives B, 0.5 halfway. Colours are three numbers, so a gradient is a mix, and nothing forces the three channels to travel at the same pace. Here red, green and blue each go from colour A to colour B along their own shaping function from the last chapter, drawn as the red, green and blue lines. The picture is the result: a gradient with a shape.

**How it is built.** Two Colour nodes split into channels; three Mix nodes, one per channel, each blended by its own curve of x (Smoothstep, a half Sin, Pow); Make Vec3 puts the channels back together; the plot lines are drawn over it.

**Try.** Move each channel's slider and watch its line and the colour change together. Pick two new colours on the Colour nodes: a sunset, a sea. For the plain version, wire one float into all three Mix nodes: every channel moves in step.${book(6, 'Colors')}`);

lesson('learnHSB', [
  ...stNodes(),
  n('splitVec2', 'xy', 520, 220, {}, { v: ['st', 'result'] }),
  n('add', 'hue', 760, 140, { b: 0, ...note('Hue: x, plus a shift. It wraps, so 1.2 is the same hue as 0.2.') }, { a: ['xy', 'x'] }),
  n('makeVec3', 'hsb', 1000, 220, { g: 1, ...note('Hue, saturation, brightness: x, a slider, y.') }, { r: ['hue', 'result'], b: ['xy', 'y'] }),
  n('hsv', 'rgb', 1240, 220, { direction: 'hsv2rgb' }, { color: ['hsb', 'rgb'] }),
  out(['rgb', 'color'], 1480),
], [ctl('s', 'hsb::g', 'Saturation', 0, 1, 0.01), ctl('h', 'hue::b', 'Hue shift', 0, 1, 0.01)], `**What it shows.** RGB is how screens make colour, not how people think about it. **HSB** (hue, saturation, brightness) is closer: hue walks round the colour circle, saturation goes from grey to vivid, brightness from black to full. Put hue on x and brightness on y and the whole spectrum lies across the screen.

**How it is built.** st → Split Vec2 → Make Vec3 (x as hue, a Saturation slider, y as brightness) → **RGB ↔ HSV** set to HSV → RGB, which does the conversion.

**Try.** Lower Saturation to see the colours drain to grey. Shift the hue. Wire Time × 0.1 into the Add and the rainbow scrolls.${book(6, 'Colors')}`);

lesson('learnColorWheel', [
  uv(),
  time(40, 460),
  n('polarSpace', 'polar', 280, 220, { radialScale: 1.15, ...note('Angle (0…1 once round) and radius (distance from the centre).') }, { input: ['uv', 'uv'] }),
  n('multiply', 'spin', 280, 460, { b: 0.1 }, { a: ['time', 'time'] }),
  n('add', 'hue', 520, 160, { ...note('Angle + Time × speed: the hues turn round the wheel.') }, { a: ['polar', 'angle'], b: ['spin', 'result'] }),
  n('makeVec3', 'hsb', 760, 220, { b: 1, ...note('Hue from the angle, saturation from the radius, brightness a slider.') }, { r: ['hue', 'result'], g: ['polar', 'radius'] }),
  n('hsv', 'rgb', 1000, 220, { direction: 'hsv2rgb' }, { color: ['hsb', 'rgb'] }),
  n('smoothstep', 'outside', 1000, 440, { edge0: 0.98, edge1: 1.0, ...note('1 beyond radius 1, where the wheel ends.') }, { value: ['polar', 'radius'] }),
  n('colorize', 'wheel', 1240, 220, { color: [0.05, 0.05, 0.08] }, { field: ['outside', 'result'], background: ['rgb', 'color'] }),
  out(['wheel', 'color'], 1480),
], [ctl('s', 'spin::b', 'Spin speed', -1, 1, 0.01), ctl('v', 'hsb::b', 'Brightness', 0, 1, 0.01)], `**What it shows.** Hue is an angle, so HSB belongs on a circle. Turn the UV into polar coordinates (the angle around the centre and the distance from it), use the angle as hue and the distance as saturation, and you have a colour picker's wheel: grey in the middle, vivid at the rim.

**How it is built.** UV → **Polar Space** (Angle already runs 0…1 once round; Radius is the distance) → Make Vec3 → RGB ↔ HSV. Time is added to the angle to spin it. A Smoothstep on the radius masks everything past the rim.

**Try.** Spin it the other way. Lower Brightness. Put a shaping function (Pow, Exp Ease) on the angle before the Add: some hues take up more of the wheel and others squeeze together.${book(6, 'Colors')}`);

// ── Shapes (chapter 7) ──────────────────────────────────────────────────────

lesson('learnRect', [
  ...stNodes(),
  n('constant', 'm', 280, 480, { value: 0.1, ...note('The margin: how far in from each edge the rectangle starts.') }),
  n('add', 'me', 520, 480, { b: 0.01, ...note('Margin + softness: where the edge finishes fading in.') }, { a: ['m', 'value'] }),
  vt(n('smoothstep', 'bl', 760, 120, { ...note('Bottom and left edges at once: 0 inside the margin, 1 past it, for x and y together.') }, { value: ['st', 'result'], edge0: ['m', 'value'], edge1: ['me', 'result'] }), 'vec2'),
  n('vec2Const', 'one', 280, 640, { x: 1, y: 1 }),
  vt(n('subtract', 'inv', 520, 640, { ...note('1 − st: the same coordinates measured from the top-right corner.') }, { a: ['one', 'val'], b: ['st', 'result'] }), 'vec2'),
  vt(n('smoothstep', 'tr', 760, 360, { ...note('Top and right edges: the same test on 1 − st.') }, { value: ['inv', 'result'], edge0: ['m', 'value'], edge1: ['me', 'result'] }), 'vec2'),
  vt(n('multiply', 'both', 1000, 220, {}, { a: ['bl', 'result'], b: ['tr', 'result'] }), 'vec2'),
  n('splitVec2', 'bt', 1240, 220, {}, { v: ['both', 'result'] }),
  n('multiply', 'and', 1480, 220, { ...note('x × y: 1 only where every edge said 1. Multiplying is AND.') }, { a: ['bt', 'x'], b: ['bt', 'y'] }),
  n('colorize', 'paint', 1720, 220, { color: CREAM, background: [0.12, 0.2, 0.45] }, { field: ['and', 'result'] }),
  out(['paint', 'color'], 1960),
], [ctl('m', 'm::value', 'Margin', 0, 0.45, 0.005), ctl('s', 'me::b', 'Edge softness', 0.001, 0.3, 0.001)], `**What it shows.** The first shape, drawn the way a shader has to: every pixel asks "am I inside?". A pixel is inside the rectangle if it is past the margin from the left *and* the bottom *and* the right *and* the top. Each "past the margin" is a step (0 or 1), and multiplying the answers is the AND: one 0 anywhere makes the pixel background.

**How it is built.** Smoothstep switched to vec2 tests x and y against the margin in one node (the bottom-left edges). 1 − st measures from the other corner, and the same test gives the top-right edges. Multiply them, then multiply x by y. Smoothstep instead of Step lets the edge be soft.

**Try.** Raise Edge softness for a blurred rectangle, lower it to 0.001 for a crisp one. Give the two Smoothsteps different margins for a rectangle off-centre. The Book's exercise: several of these, coloured, make a Mondrian.${book(7, 'Shapes')}`);

lesson('learnCircle', [
  uv(),
  n('length', 'dist', 280, 220, { scale: 1, ...note('How far this pixel is from the centre: 0 in the middle, growing outward in every direction.') }, { input: ['uv', 'uv'] }),
  n('constant', 'r', 280, 440, { value: 0.5 }),
  n('compare', 'inside', 520, 300, { operator: '<', smoothing: 0.005, ...note('Nearer than the radius? 1 inside the circle, 0 outside. Smoothing softens the edge.') }, { a: ['dist', 'output'], b: ['r', 'value'] }),
  n('colorize', 'cone', 520, 80, { color: [0.22, 0.25, 0.36], background: [0.02, 0.02, 0.04], ...note('The distance itself, as brightness: a cone seen from above.') }, { field: ['dist', 'output'] }),
  n('colorize', 'disc', 760, 220, { color: [1.0, 0.62, 0.3] }, { field: ['inside', 'mask'], background: ['cone', 'color'] }),
  out(['disc', 'color'], 1000),
], [ctl('r', 'r::value', 'Radius', 0.05, 1.2, 0.01), ctl('s', 'inside::smoothing', 'Edge blur', 0, 0.3, 0.001)], `**What it shows.** A circle is every point closer to the centre than the radius, so the shader measures each pixel's distance from the centre and compares it with the radius. The distance on its own (the grey glow behind) is a cone seen from above: dark in the middle, lighter outward. Cutting the cone at a height gives the circle.

**How it is built.** UV → **Length** (the distance from the centre; the Book's \`distance()\`, since the UV node already puts 0 in the middle) → **Compare** (<) with the Radius → Colorize paints the circle over the cone.

**Try.** Raise Edge blur until the circle is a soft spot. Wire Time → Sin (amp 0.1) → Add 0.5 into the Radius and the circle beats. Swap Length for **Dot** of the UV with itself (x² + y²) and square the radius: the same circle without a square root, a saving the Book points out.${book(7, 'Shapes')}`);

lesson('learnDistanceField', [
  uv(),
  n('boxSDF', 'box', 280, 220, { width: 0.5, height: 0.28, ...note('The distance from each pixel to the rectangle\'s edge: negative inside, positive outside, zero on the edge.') }, { position: ['uv', 'uv'] }),
  n('multiply', 'rings', 520, 120, { b: 5 }, { a: ['box', 'distance'] }),
  n('fractRaw', 'bands', 760, 120, { ...note('fract of distance × 5: a band every 0.2 of distance, like contour lines on a map.') }, { input: ['rings', 'result'] }),
  n('colorize', 'field', 1000, 120, { color: [0.95, 0.68, 0.42], background: [0.08, 0.06, 0.16] }, { field: ['bands', 'output'] }),
  n('compare', 'edge', 760, 360, { operator: '≈', smoothing: 0.012, ...note('Where the distance is 0: the shape\'s outline.') }, { a: ['box', 'distance'] }),
  n('colorize', 'outline', 1240, 220, { color: [1, 1, 1] }, { field: ['edge', 'mask'], background: ['field', 'color'] }),
  out(['outline', 'color'], 1480),
], [ctl('n', 'rings::b', 'Rings', 1, 30, 0.5), ctl('w', 'box::width', 'Half width', 0.01, 1, 0.01), ctl('h', 'box::height', 'Half height', 0.01, 1, 0.01)], `**What it shows.** The circle lesson's cone generalised: a *distance field* gives every pixel its distance to a shape, for any shape. Drawing Fract of that distance shows the field as contour rings: near the box they follow its straight sides, further out they round off into circles, and inside they shrink toward the middle. The white line is where the distance is exactly 0, the shape itself.

**How it is built.** UV → **Box SDF** (the Book builds it from abs, max and length; the node does the same maths) → × Rings → Fract (scalar) → Colorize. Compare ≈ 0 finds the outline.

**Try.** Change the box and watch every ring follow. Set Rings to 1. Replace Box SDF with Circle SDF, or put a **Min** of two SDFs in its place: the rings flow around both shapes, which is how shapes are combined (see Combining shapes).${book(7, 'Shapes')}`);

lesson('learnPolar', [
  uv(),
  n('polarSpace', 'polar', 280, 220, { ...note('Angle (0…1 once round the centre) and radius (the distance from it).') }, { input: ['uv', 'uv'] }),
  n('multiply', 'petals', 520, 120, { b: 3 }, { a: ['polar', 'angle'] }),
  n('cos', 'wave', 760, 120, { freq: 6.2832, amp: 1, ...note('A cosine of the angle: it goes up and down Frequency times as you go round.') }, { input: ['petals', 'result'] }),
  n('abs', 'fold', 1000, 120, { ...note('abs folds the negative half up, so each wave makes two petals.') }, { input: ['wave', 'output'] }),
  n('multiply', 'depth', 1000, 300, { b: 0.35 }, { a: ['fold', 'output'] }),
  n('add', 'f', 1240, 300, { b: 0.3, ...note('The radius the shape reaches at this angle.') }, { a: ['depth', 'result'] }),
  n('compare', 'inside', 1480, 220, { operator: '<', smoothing: 0.01, ...note('Is the pixel nearer the centre than the shape reaches at its angle?') }, { a: ['polar', 'radius'], b: ['f', 'result'] }),
  n('colorize', 'rays', 1480, 440, { color: [0.3, 0.2, 0.45], background: [0.04, 0.03, 0.07] }, { field: ['f', 'result'] }),
  n('colorize', 'flower', 1720, 300, { color: [1.0, 0.55, 0.45] }, { field: ['inside', 'mask'], background: ['rays', 'color'] }),
  out(['flower', 'color'], 1960),
], [ctl('p', 'petals::b', 'Frequency', 1, 12, 1), ctl('d', 'depth::b', 'Petal depth', 0, 0.6, 0.01), ctl('s', 'f::b', 'Centre size', 0.05, 0.8, 0.01)], `**What it shows.** A circle is a shape whose radius is the same at every angle. Let the radius *depend* on the angle and the circle becomes a flower, a star, a gear. Polar coordinates give each pixel its angle and its distance from the centre; a shaping function of the angle gives the edge's distance there; the pixel is inside if it is nearer than that.

**How it is built.** UV → **Polar Space** → angle × Frequency → Cos → Abs → × depth + size = the edge radius f. Compare radius < f fills the shape. The background shows f itself as faint rays.

**Try.** Frequency 1 gives two petals, 6 a daisy. Depth 0 is a plain circle. Swap Abs for a Smoothstep (from −0.5 to 1) of the Cos: the Book's gear-like shape. Wire Time into the angle (an Add before the Multiply) and the flower turns.${book(7, 'Shapes')}`);

lesson('learnPolygon', [
  uv(),
  n('constant', 'sides', 40, 440, { value: 5 }),
  expr('poly', 300, 220, 'Polygon field', { p: ['uv', 'uv'], n: ['sides', 'value'] }, { p: 'vec2' }, [
    { lhs: 'float a', op: '=', rhs: 'atan(p.x, p.y) + 3.14159' },
    { lhs: 'float r', op: '=', rhs: '6.28318 / n' },
  ], 'cos(floor(0.5 + a / r) * r - a) * length(p)',
  'The Book\'s polygon: the angle picks which of n slices the pixel is in; the cosine turns the distance into distance from that slice\'s side.'),
  n('constant', 'size', 300, 440, { value: 0.45 }),
  n('compare', 'inside', 560, 300, { operator: '<', smoothing: 0.006 }, { a: ['poly', 'result'], b: ['size', 'value'] }),
  n('multiply', 'rings', 560, 80, { b: 8 }, { a: ['poly', 'result'] }),
  n('fractRaw', 'bands', 800, 80, {}, { input: ['rings', 'result'] }),
  n('colorize', 'field', 1040, 80, { color: [0.25, 0.35, 0.55], background: [0.03, 0.04, 0.08], ...note('The field as contour rings: they are polygons too, all the way out.') }, { field: ['bands', 'output'] }),
  n('colorize', 'shape', 1040, 300, { color: [0.98, 0.8, 0.35] }, { field: ['inside', 'mask'], background: ['field', 'color'] }),
  out(['shape', 'color'], 1280),
], [ctl('n', 'sides::value', 'Sides', 3, 12, 1), ctl('s', 'size::value', 'Size', 0.1, 0.9, 0.01)], `**What it shows.** Polar coordinates and distance fields together make any regular polygon from one formula. Cut the circle into n equal slices by angle; in each slice, measure the distance along the direction that points straight at that slice's side instead of at the pixel. That distance is the same all along a straight side, so a threshold on it draws a polygon, and its contour rings are polygons too.

**How it is built.** An **Expression Block** holds the Book's three lines: the angle, the slice size 2π / n, and cos(nearest slice centre − angle) × length. A Constant sets n; Compare against Size fills the shape; Fract of the field × 8 draws the rings.

**Try.** Sides 3, 4, 6, 12. Past 12 it is nearly a circle. Put **Rotate 2D** (angle from Time) on the UV before the block to spin it. The **Shape SDF** node has exact polygons, stars and many more shapes ready-made.${book(7, 'Shapes')}`);

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
], [ctl('k', 'un::k', 'Smoothness', 0, 0.6, 0.01), ctl('r', 'circ::radius', 'Circle radius', 0.05, 0.6, 0.01)], `**What it shows.** Two distance fields combine with plain maths: the minimum of the two distances is their **Union** (a pixel is inside if it is inside either shape), and the maximum is their intersection. With a little k, Union blends the two like putty where they meet, so the swinging circle and the box merge and pull apart smoothly.

**How it is built.** Time → Sin → Make Vec2 gives the circle an offset that swings left and right. Box SDF and Circle SDF both read the same UV; Union takes both distances and SDF Fill paints the result. Intersect and Subtract sit next to Union in the SDF category.

**Try.** Set Smoothness to 0 for a hard join: that is exactly min(). Swap Union for Subtract and the circle bites out of the box.${book(7, 'Shapes')}`);

// ── Matrices (chapter 8) ────────────────────────────────────────────────────

const CROSS = { shape: 'cross', rx: 0.32, ry: 0.09, roundness: 0 };

lesson('learnTranslate', [
  uv(),
  time(40, 460),
  n('multiply', 'spd', 280, 460, { b: 1 }, { a: ['time', 'time'] }),
  n('angleToVec2', 'dir', 520, 460, { ...note('(cos t, sin t): a point going round a circle.') }, { angle: ['spd', 'result'] }),
  vt(n('multiply', 'off', 760, 460, { b: 0.5, ...note('How far from the centre the cross travels.') }, { a: ['dir', 'result'] }), 'vec2'),
  vt(n('subtract', 'moved', 1000, 220, { ...note('UV − offset: the space slides, so what is drawn at 0 now sits at the offset.') }, { a: ['uv', 'uv'], b: ['off', 'result'] }), 'vec2'),
  n('shapeSDF', 'cross', 1240, 220, CROSS, { p: ['moved', 'result'] }),
  ...paint('paint', ['cross', 'distance'], 1480, 220, [0.4, 0.9, 1.0]),
  out(['paint', 'color'], 1960),
], [ctl('d', 'off::b', 'Distance', 0, 1, 0.01), ctl('s', 'spd::b', 'Speed', -3, 3, 0.01)], `**What it shows.** Shaders can't pick a shape up and move it; every pixel just asks what is at its own position. So to move a shape you move the *space* it is measured in: subtract an offset from the coordinates and whatever was drawn at the centre now appears at the offset. Here the offset goes round a circle and the cross follows it.

**How it is built.** Time × speed → Angle → Vec2 gives (cos t, sin t); × Distance scales it; UV − that (Subtract switched to vec2) is the moved space. **Shape SDF** (Cross) draws in it, and a Compare + Colorize paints it.

**Try.** Speed 0 and a Distance: the cross parks off-centre. Wire only the Sin of Time into a Make Vec2's y to make it bob up and down like a buoy (one of the Book's exercises).${book(8, '2D Matrices')}`);

lesson('learnRotate', [
  uv(),
  time(40, 460),
  n('multiply', 'spd', 280, 460, { b: 0.8, ...note('The angle, in radians: Time × speed.') }, { a: ['time', 'time'] }),
  n('rotationMatrix', 'rot', 520, 460, { ...note('A 2×2 matrix of cos and sin: multiplying a point by it turns the point round the origin.') }, { angle: ['spd', 'result'] }),
  n('mat2MulVec', 'turned', 760, 220, {}, { mat: ['rot', 'mat2'], vec: ['uv', 'uv'] }),
  n('shapeSDF', 'cross', 1000, 220, CROSS, { p: ['turned', 'output'] }),
  ...paint('paint', ['cross', 'distance'], 1240, 220, [1.0, 0.7, 0.35]),
  out(['paint', 'color'], 1720),
], [ctl('s', 'spd::b', 'Speed', -3, 3, 0.01), ctl('l', 'cross::rx', 'Arm length', 0.1, 0.9, 0.01)], `**What it shows.** Rotation needs a **matrix**: four numbers (cos a, −sin a, sin a, cos a) that, multiplied with a point, turn it by the angle a round the origin. Multiply the coordinates by it and the whole space turns, so the cross spins. As with moving, turning the space one way turns the picture the other.

**How it is built.** Time × speed is the angle → **Rotation Matrix** → **Mat2 × Vec2** on the UV → Shape SDF (Cross) → paint. Because the UV node puts (0, 0) in the middle of the screen, the cross turns round its own centre; the Book, working in 0…1 st, first subtracts 0.5 to get the same effect.

**Try.** Put the Translate lesson's Subtract *before* the matrix: the cross spins in place away from the centre. Put it *after*: the cross orbits instead. The order of transforms matters.${book(8, '2D Matrices')}`);

lesson('learnScale', [
  uv(),
  time(40, 460),
  n('sin', 'pulse', 280, 460, { freq: 1, amp: 0.5 }, { input: ['time', 'time'] }),
  n('add', 's', 520, 460, { b: 1, ...note('1 + a wave: the scale swings round 1 (unchanged).') }, { a: ['pulse', 'output'] }),
  n('scaleMatrix', 'sc', 760, 460, { ...note('A matrix with the scale on its diagonal: x × sx, y × sy.') }, { x: ['s', 'result'], y: ['s', 'result'] }),
  n('mat2MulVec', 'scaled', 1000, 220, {}, { mat: ['sc', 'mat'], vec: ['uv', 'uv'] }),
  n('shapeSDF', 'cross', 1240, 220, CROSS, { p: ['scaled', 'output'] }),
  ...paint('paint', ['cross', 'distance'], 1480, 220, [0.75, 1.0, 0.45]),
  out(['paint', 'color'], 1960),
], [ctl('a', 'pulse::amp', 'Pulse', 0, 0.9, 0.01), ctl('f', 'pulse::freq', 'Speed', 0.1, 5, 0.01)], `**What it shows.** The third transform, and a second matrix: **Scale Matrix** multiplies x and y by its two numbers. Scaling the space by 2 fits twice as much space into the screen, so the cross looks *half* the size; by 0.5 it looks twice as big. Here the scale swings round 1 and the cross breathes.

**How it is built.** Time → Sin → + 1 is the scale → Scale Matrix (the same value for x and y) → Mat2 × Vec2 on the UV → Cross → paint.

**Try.** Pulse 0 stops it. Wire a separate Sin into the matrix's Y and the cross squashes and stretches. Chain the Rotation lesson's matrix after this one (Mat2 × Vec2 twice), then swap their order.${book(8, '2D Matrices')}`);

lesson('learnTransform', [
  uv(),
  time(40, 420),
  n('multiply', 'spd', 260, 420, { b: 0.4 }, { a: ['time', 'time'] }),
  n('uvTransform2d', 'xf', 480, 220, { sx: 1, sy: 1, tx: 0, ty: 0 }, { uv: ['uv', 'uv'], angle: ['spd', 'result'] }),
  n('boxSDF', 'box', 740, 220, { width: 0.3, height: 0.3 }, { position: ['xf', 'result'] }),
  n('sdfFill', 'fill', 1000, 220, { strokeWidth: 0.02 }, { d: ['box', 'distance'] }),
  out(['fill', 'result'], 1260),
], [ctl('spd', 'spd::b', 'Spin speed', -2, 2, 0.05), ctl('sx', 'xf::sx', 'Scale x', 0.2, 3, 0.01), ctl('sy', 'xf::sy', 'Scale y', 0.2, 3, 0.01)], `**What it shows.** The last three lessons in one node. **UV Transform 2D** moves, rotates and scales the UV before Box SDF sees it, so the box appears to spin. Rotate the space one way and the picture turns the other, which is why the maths looks backwards at first.

**How it is built.** Time × 0.4 is the angle in radians. Inside, the node builds one 2×2 matrix from the rotation and the scale and applies it round a pivot, then the translation. Everything downstream of it, however much you add, is transformed together.

**Try.** Change Scale x alone: the space stretches, so the box squashes. Put the transform *after* the Tiling lesson's Tile node and every tile turns on its own. The Matrices folder goes further: shears, inverses, lattices.${book(8, '2D Matrices')}`);

lesson('learnYUV', [
  uv(),
  vt(n('multiply', 'spread', 280, 220, { b: 0.5 }, { a: ['uv', 'uv'] }), 'vec2'),
  n('splitVec2', 'uvs', 520, 220, {}, { v: ['spread', 'result'] }),
  n('makeVec3', 'yuv', 760, 220, { r: 0.5, ...note('Y (brightness) is a slider; U and V (the two colour differences) come from x and y.') }, { g: ['uvs', 'x'], b: ['uvs', 'y'] }),
  n('matConst', 'toRgb', 760, 460, {
    size: 'mat3', m00: 1, m01: 0, m02: 1.13983, m10: 1, m11: -0.39465, m12: -0.5806, m20: 1, m21: 2.03211, m22: 0,
    ...note('The YUV → RGB matrix: each row says how much of Y, U and V goes into red, green and blue.'),
  }),
  n('mat3MulVec', 'rgb', 1000, 220, {}, { mat: ['toRgb', 'mat'], vec: ['yuv', 'rgb'] }),
  out(['rgb', 'output'], 1240),
], [ctl('y', 'yuv::r', 'Y (brightness)', 0, 1, 0.01), ctl('s', 'spread::b', 'U/V spread', 0, 1.5, 0.01)], `**What it shows.** Matrices move colours as well as points. **YUV** stores a colour as its brightness (Y) and two colour differences (U, roughly blue versus yellow, and V, roughly red versus cyan), the way analogue TV sent it. One 3×3 matrix turns YUV into RGB. Put U on x and V on y and the screen shows every colour at one brightness.

**How it is built.** UV × spread → Split → Make Vec3 (Y from a slider, U and V from x and y) → **Mat3 × Vec3** with a **Matrix Const** holding the YUV → RGB numbers → Output.

**Try.** Move Y from dark to light: the colours stay, the brightness changes. Raise the spread until the corners clip. The Colour Matrix node builds other colour matrices (hue rotation, saturation); the Matrices folder has one.${book(8, '2D Matrices')}`);

// ── Patterns (chapter 9) ────────────────────────────────────────────────────

lesson('learnTiling', [
  uv(),
  n('fract', 'tile', 280, 220, { scale: 3 }, { input: ['uv', 'uv'] }),
  n('circleSDF', 'circ', 540, 220, { radius: 0.3 }, { position: ['tile', 'output'] }),
  n('sdfFill', 'fill', 800, 220, { strokeWidth: 0.03 }, { d: ['circ', 'distance'] }),
  out(['fill', 'result'], 1060),
], [ctl('n', 'tile::scale', 'Tiles', 1, 12, 1), ctl('r', 'circ::radius', 'Radius', 0.05, 0.7, 0.01)], `**What it shows.** The Shaping lesson's Fract, applied to the whole UV. Multiply the coordinates by 3 and they run from 0 to 3; keep only the fractional part and they run 0…1 three times over. **Tile** does both (and recentres each tile on 0). One circle drawn after it appears in every tile, because every tile has the same coordinates. It costs nothing extra: each pixel still draws one circle.

**How it is built.** UV → Tile → Circle SDF → SDF Fill. The circle has no idea it is repeated. Anything placed between Tile and the shape happens inside each tile (next lesson).

**Try.** More tiles, smaller radius. Replace the circle with the Rectangle or Polar lesson's shape. Tile count 1.5 shows that tiles are cut wherever the screen ends.${book(9, 'Patterns')}`);

lesson('learnTileRotate', [
  uv(),
  time(40, 460),
  n('fract', 'tile', 280, 220, { scale: 2 }, { input: ['uv', 'uv'] }),
  n('multiply', 'spd', 280, 460, { b: 0.6 }, { a: ['time', 'time'] }),
  n('rotationMatrix', 'rot', 520, 460, {}, { angle: ['spd', 'result'] }),
  n('mat2MulVec', 'turned', 520, 220, { ...note('The rotation acts on each tile\'s own coordinates, so every tile turns round its own centre.') }, { mat: ['rot', 'mat2'], vec: ['tile', 'output'] }),
  n('boxSDF', 'box', 760, 220, { width: 0.28, height: 0.28 }, { position: ['turned', 'output'] }),
  ...paint('paint', ['box', 'distance'], 1000, 220, [1.0, 0.82, 0.4], [0.1, 0.07, 0.2]),
  out(['paint', 'color'], 1480),
], [ctl('n', 'tile::scale', 'Tiles', 1, 12, 1), ctl('s', 'spd::b', 'Spin speed', -2, 2, 0.01), ctl('w', 'box::width', 'Square size', 0.05, 0.5, 0.01)], `**What it shows.** Transforms and tiling combine. Put the Rotation lesson's matrix *after* Tile and it turns each tile's coordinates round that tile's centre, so every square spins on its own. Before Tile, it would turn the whole grid instead.

**How it is built.** UV → Tile → Mat2 × Vec2 with a Rotation Matrix (angle = Time × speed) → Box SDF → paint. When the squares grow past the tile's half width they get clipped at the tile border and start to form a lattice.

**Try.** Square size 0.5 and a slow spin: the gaps between the squares become the pattern. Move the Mat2 × Vec2 before the Tile node and compare. Add a Scale Matrix too.${book(9, 'Patterns')}`);

lesson('learnBricks', [
  uv(),
  n('scaleMatrix', 'size', 40, 440, { x: 2.5, y: 5, ...note('How many bricks fit across and up: wider than tall.') }),
  n('mat2MulVec', 'wall', 280, 220, {}, { mat: ['size', 'mat'], vec: ['uv', 'uv'] }),
  n('splitVec2', 'wp', 520, 220, {}, { v: ['wall', 'output'] }),
  n('mod', 'row', 760, 360, { period: 2, ...note('mod(y, 2): 0…1 on even rows, 1…2 on odd rows.') }, { input: ['wp', 'y'] }),
  n('step', 'odd', 1000, 360, { edge: 1, ...note('1 on odd rows, 0 on even ones.') }, { x: ['row', 'output'] }),
  n('multiply', 'shift', 1240, 360, { b: 0.5, ...note('How far odd rows slide: half a brick.') }, { a: ['odd', 'result'] }),
  n('add', 'sx', 1480, 160, {}, { a: ['wp', 'x'], b: ['shift', 'result'] }),
  n('makeVec2', 'shifted', 1720, 220, {}, { x: ['sx', 'result'], y: ['wp', 'y'] }),
  vt(n('fractRaw', 'cell', 1960, 220, { ...note('Then tile: 0…1 inside every brick.') }, { input: ['shifted', 'xy'] }), 'vec2'),
  n('boxSDF', 'brick', 2200, 220, { width: 0.46, height: 0.4, posX: 0.5, posY: 0.5 }, { position: ['cell', 'output'] }),
  ...paint('paint', ['brick', 'distance'], 2440, 220, [0.78, 0.36, 0.24], [0.86, 0.82, 0.74]),
  out(['paint', 'color'], 2920),
], [ctl('o', 'shift::b', 'Row offset', 0, 1, 0.01), ctl('w', 'brick::width', 'Brick half width', 0.2, 0.5, 0.005), ctl('h', 'brick::height', 'Brick half height', 0.2, 0.5, 0.005)], `**What it shows.** A brick wall is a grid where every other row slides half a brick. To slide only the odd rows the shader needs to know which row a pixel is on: **Modulo** by 2 of y is below 1 on even rows and above 1 on odd ones, and **Step** at 1 turns that into 0 or 1. Multiply by half a brick, add to x, then tile.

**How it is built.** UV × a Scale Matrix (bricks wider than tall) → Split → y → Mod 2 → Step 1 → × Offset → added to x → Make Vec2 → Fract (vec2) → Box SDF centred in the tile → paint, with the mortar as the background.

**Try.** Row offset 0 is a plain grid, 1 looks the same as 0 (a whole brick). Wire Time × 0.3 into the Multiply's B in place of the slider and the odd rows slide along forever. Do the same on x for columns.${book(9, 'Patterns')}`);

lesson('learnTruchet', [
  uv(),
  n('constant', 'cols', 40, 440, { value: 16 }),
  n('gridLayout', 'grid', 280, 220, { ...note('Cell UV: coordinates inside each cell. Cell ID: which cell, as whole numbers.') }, { uv: ['uv', 'uv'], columns: ['cols', 'value'] }),
  n('splitVec2', 'id', 520, 400, {}, { v: ['grid', 'cellID'] }),
  n('mod', 'mx', 760, 340, { period: 2, ...note('Odd or even column?') }, { input: ['id', 'x'] }),
  n('mod', 'my', 760, 500, { period: 2, ...note('Odd or even row?') }, { input: ['id', 'y'] }),
  n('multiply', 'my2', 1000, 500, { b: 2 }, { a: ['my', 'output'] }),
  n('add', 'index', 1240, 420, { ...note('0, 1, 2 or 3: where the cell sits in its 2×2 block.') }, { a: ['mx', 'output'], b: ['my2', 'result'] }),
  n('multiply', 'turn', 1480, 420, { b: 1.5708, ...note('Index × a quarter turn (π/2).') }, { a: ['index', 'result'] }),
  n('rotate2d', 'spun', 1720, 220, {}, { input: ['grid', 'cellUV'], angle: ['turn', 'result'] }),
  n('splitVec2', 'c', 1960, 220, {}, { v: ['spun', 'output'] }),
  n('step', 'half', 2200, 220, { ...note('step(x, y): 1 above the diagonal, 0 below. One triangle, the whole tile design.') }, { edge: ['c', 'x'], x: ['c', 'y'] }),
  n('colorize', 'paint', 2440, 220, { color: [0.96, 0.86, 0.62], background: [0.1, 0.3, 0.35] }, { field: ['half', 'result'] }),
  out(['paint', 'color'], 2680),
], [ctl('n', 'cols::value', 'Columns', 4, 48, 1), ctl('t', 'turn::b', 'Turn per index', 0, 3.1416, 0.01)], `**What it shows.** Truchet tiles: one simple tile design, here a square cut into two triangles along its diagonal, turned four different ways. Turning each cell by a quarter turn per its place in a 2×2 block makes big patterns (diamonds, zigzags, arrows) out of that one triangle.

**How it is built.** **Grid** gives each cell its coordinates and its ID. Mod 2 of the ID's x and y (x + 2y) numbers the cells 0–3 in every 2×2 block; × π/2 is the cell's rotation; Rotate 2D turns the Cell UV; Step(x, y) draws the triangle.

**Try.** Slide Turn per index: 0 lines all triangles up, π/2 is the classic pattern, other angles break the tiles apart. The **Truchet Tiles** node draws the other famous tile, quarter circles, turned at random (random is the next chapter).${book(9, 'Patterns')}`);

// ── Random (chapter 10) ─────────────────────────────────────────────────────

lesson('learnRandom', [
  ...plotFrame(),
  n('sin', 's', 760, 160, { freq: 10, amp: 1, ...note('sin(x × 10) × Multiplier. Amp is the multiplier.') }, { input: ['xy', 'x'] }),
  n('fractRaw', 'r', 1000, 160, { ...note('Keep only the fractional part.') }, { input: ['s', 'output'] }),
  plotBg(['r', 'output'], 1000, 420),
  ...plotLine('line', ['r', 'output'], ['bg', 'color'], GREEN, 1240, 220, 0.008),
  out(['line', 'color'], 1720),
], [ctl('m', 's::amp', 'Multiplier', 1, 3000, 1)], `**What it shows.** Where randomness in shaders comes from. Take a sine wave, multiply it, keep the fractional part. With a multiplier of 1 you see a wave wrapped into 0…1. Raise it and the wraps come faster and faster until, around a few thousand, the line is chaos and the background is noise. It isn't truly random: the same x always gives the same value, which is exactly what a shader needs, since every frame must agree with the last.

**How it is built.** The plot frame with Sin (amp = the multiplier) → Fract (scalar).

**Try.** Sweep Multiplier from 1 upwards slowly and watch order turn into noise. At huge values the result depends on the GPU's precision, one reason the Hash mode of Noise Float uses a better recipe.${book(10, 'Random')}`);

lesson('learnRandomGrid', [
  uv(),
  vt(n('multiply', 'cells', 280, 220, { b: 10 }, { a: ['uv', 'uv'] }), 'vec2'),
  vt(n('floor', 'cell', 520, 220, { ...note('floor: every pixel in the same cell gets the same whole-number coordinates.') }, { input: ['cells', 'result'] }), 'vec2'),
  n('noiseFloat', 'rnd', 760, 220, { mode: 'hash', scale: 1, speed: 0, ...note('Hash mode: a random number from a position, the 2D version of the sine trick.') }, { uv: ['cell', 'output'] }),
  n('colorize', 'paint', 1000, 220, { color: [0.98, 0.9, 0.7], background: [0.06, 0.08, 0.2] }, { field: ['rnd', 'value'] }),
  out(['paint', 'color'], 1240),
], [ctl('n', 'cells::b', 'Cells', 1, 300, 1)], `**What it shows.** Random in 2D: a hash turns a position into a random number. Fed every pixel's own position it gives TV static. Fed the position after **Floor**, every pixel inside a cell has the same input, so the cell gets one random value: a mosaic. That is the balance the Book is after, chaos with some order.

**How it is built.** UV × Cells → Floor (vec2) → **Noise Float** in Hash mode → Colorize.

**Try.** Cells 300 and the cells are nearly pixels: static. Cells 3: a few big tiles. Put the grey through Step (threshold 0.5) for a black-and-white random pattern, or through a Palette.${book(10, 'Random')}`);

lesson('learnMaze', [
  uv(),
  n('constant', 'cols', 40, 440, { value: 28 }),
  n('gridLayout', 'grid', 280, 220, {}, { uv: ['uv', 'uv'], columns: ['cols', 'value'] }),
  n('noiseFloat', 'rnd', 520, 400, { mode: 'hash', scale: 1, speed: 0, ...note('One random number per cell.') }, { uv: ['grid', 'cellID'] }),
  n('step', 'flip', 760, 400, { edge: 0.5, ...note('Heads or tails: which way this cell\'s line leans.') }, { x: ['rnd', 'value'] }),
  n('remap', 'sgn', 1000, 400, { inMin: 0, inMax: 1, outMin: -1, outMax: 1 }, { value: ['flip', 'result'] }),
  n('splitVec2', 'c', 760, 160, {}, { v: ['grid', 'cellUV'] }),
  n('multiply', 'mx', 1240, 160, { ...note('x or −x, depending on the coin.') }, { a: ['c', 'x'], b: ['sgn', 'result'] }),
  n('subtract', 'diff', 1480, 220, {}, { a: ['mx', 'result'], b: ['c', 'y'] }),
  n('abs', 'dist', 1720, 220, { ...note('|±x − y|: 0 along one of the two diagonals of the cell.') }, { input: ['diff', 'result'] }),
  n('constant', 'w', 1720, 440, { value: 0.09 }),
  n('compare', 'ink', 1960, 300, { operator: '<', smoothing: 0.02 }, { a: ['dist', 'output'], b: ['w', 'value'] }),
  n('colorize', 'paint', 2200, 220, { color: [0.35, 0.85, 1.0], background: [0.05, 0.06, 0.16] }, { field: ['ink', 'mask'] }),
  out(['paint', 'color'], 2440),
], [ctl('n', 'cols::value', 'Columns', 4, 80, 1), ctl('p', 'flip::edge', 'Chance', 0, 1, 0.01), ctl('w', 'w::value', 'Line width', 0.01, 0.3, 0.005)], `**What it shows.** The Book's version of *10 PRINT*, a one-line program from the Commodore 64 that prints ╱ or ╲ at random, over and over. Each cell tosses a coin and draws one diagonal or the other. The lines meet at the corners, and a maze appears out of nothing but coin tosses.

**How it is built.** **Grid** → Cell ID → Noise Float (Hash) → Step 0.5 is the coin → Remap to −1 or +1. In the Cell UV, |±x − y| is zero along one diagonal or the other; Compare against the Width draws it.

**Try.** Chance 0 or 1: every coin lands the same way and the maze becomes stripes. 0.3 biases the maze into long runs. Replace the diagonal with the Truchet lesson's triangle for random Truchet tiles.${book(10, 'Random')}`);

// ── Noise (chapter 11) ──────────────────────────────────────────────────────

lesson('learnNoise1D', [
  ...plotFrame(),
  n('multiply', 'xs', 760, 220, { b: 8, ...note('How many whole numbers (random points) fit across.') }, { a: ['xy', 'x'] }),
  n('floor', 'i', 1000, 120, { ...note('Which whole number we are past…') }, { input: ['xs', 'result'] }),
  n('fractRaw', 'f', 1000, 400, { ...note('…and how far past it.') }, { input: ['xs', 'result'] }),
  n('makeVec2', 'p0', 1240, 60, {}, { x: ['i', 'output'] }),
  n('noiseFloat', 'r0', 1480, 60, { mode: 'hash', scale: 1, speed: 0, ...note('A random value at this whole number.') }, { uv: ['p0', 'xy'] }),
  n('add', 'i1', 1240, 220, { b: 1 }, { a: ['i', 'output'] }),
  n('makeVec2', 'p1', 1480, 220, {}, { x: ['i1', 'result'] }),
  n('noiseFloat', 'r1', 1720, 220, { mode: 'hash', scale: 1, speed: 0, ...note('…and at the next one.') }, { uv: ['p1', 'xy'] }),
  n('smoothstep', 'ease', 1240, 400, {}, { value: ['f', 'output'] }),
  n('mix', 't', 1480, 400, { t: 1, ...note('Blend: 0 is a straight line between the two values, 1 is a smoothstep curve.') }, { a: ['f', 'output'], b: ['ease', 'result'] }),
  n('mix', 'noise', 1960, 220, { ...note('Mix from this value to the next by the eased fraction: value noise.') }, { a: ['r0', 'value'], b: ['r1', 'value'], t: ['t', 'result'] }),
  plotBg(['noise', 'result'], 2200, 520),
  ...plotLine('stepLine', ['r0', 'value'], ['bg', 'color'], ORANGE, 2200, 340, 0.006),
  ...plotLine('line', ['noise', 'result'], ['stepLine', 'color'], GREEN, 2680, 160),
  out(['line', 'color'], 3160),
], [ctl('n', 'xs::b', 'Scale', 1, 30, 0.5), ctl('s', 't::t', 'Smooth (0 linear, 1 curve)', 0, 1, 0.01)], `**What it shows.** Random numbers jump; nature doesn't. *Noise* is randomness with memory: pick random values only at whole numbers (the orange steps) and glide between them (green). **Floor** says which whole number we're past, **Fract** how far past it; the value there is a Mix of this whole number's random value and the next one's. Gliding in a straight line leaves corners; easing the glide with a smoothstep curve hides them.

**How it is built.** x × Scale → Floor and Fract. Two Hash Noise Floats read the random value at i and i + 1. Smoothstep eases the fraction, and a Mix blends between plain and eased so you can compare. The last Mix is the noise.

**Try.** Slide Smooth from 1 to 0 and watch the corners appear at every whole number. Raise Scale for busier noise. Wire the noise into a circle's radius (Circle lesson) to make it wobble organically.${book(11, 'Noise')}`);

lesson('learnNoise', [
  uv(),
  time(40, 420),
  n('noiseFloat', 'nz', 300, 220, { mode: 'smooth', scale: 4, speed: 0.4 }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
  n('colorize', 'col', 560, 220, { color: [0.95, 0.75, 0.4], background: [0.08, 0.06, 0.12] }, { field: ['nz', 'value'] }),
  out(['col', 'color'], 820),
], [ctl('sc', 'nz::scale', 'Scale', 0.5, 16, 0.1), ctl('sp', 'nz::speed', 'Speed', 0, 2, 0.01)], `**What it shows.** The previous lesson in 2D. Random values sit on the corners of a grid, and each pixel blends the four corners around it, eased the same way: that is *value noise*. **Noise Float** in Smooth mode is exactly that. Perlin mode is *gradient noise*: it blends random directions instead of random values, which hides the grid's blockiness. Time slides through it, so it drifts.

**How it is built.** UV → Noise Float → Colorize (background where the noise is 0, colour where it is 1). Scale is how many grid cells fit across; Speed how fast it moves. Switch Mode to Hash to see the random values it is built from, one per cell.

**Try.** Scale 1 for one big blob, 16 for grain. Switch Mode between Smooth and Perlin and compare the shapes. Wire the noise into a circle's radius, a UV Transform angle, or a Palette.${book(11, 'Noise')}`);

lesson('learnWood', [
  uv(),
  vt(n('multiply', 'pos', 280, 220, { b: 3 }, { a: ['uv', 'uv'] }), 'vec2'),
  n('noiseFloat', 'nz', 520, 400, { mode: 'smooth', scale: 1, speed: 0, ...note('A slowly changing number for every point.') }, { uv: ['pos', 'result'] }),
  n('multiply', 'twist', 760, 400, { b: 0.6, ...note('The noise becomes an angle.') }, { a: ['nz', 'value'] }),
  n('rotate2d', 'bent', 1000, 220, { ...note('Each point is turned by its own noise angle, so straight lines bend.') }, { input: ['pos', 'result'], angle: ['twist', 'result'] }),
  n('splitVec2', 'b', 1240, 220, {}, { v: ['bent', 'output'] }),
  n('sin', 'rings', 1480, 220, { freq: 14, amp: 1, ...note('Stripes: a sine of x.') }, { input: ['b', 'x'] }),
  n('abs', 'a', 1720, 220, {}, { input: ['rings', 'output'] }),
  n('smoothstep', 'grain', 1960, 220, { edge0: 0, edge1: 0.9 }, { value: ['a', 'output'] }),
  n('colorize', 'wood', 2200, 220, { color: [0.86, 0.62, 0.38], background: [0.3, 0.14, 0.06] }, { field: ['grain', 'result'] }),
  out(['wood', 'color'], 2440),
], [ctl('t', 'twist::b', 'Twist', 0, 3, 0.01), ctl('r', 'rings::freq', 'Ring density', 2, 40, 0.1), ctl('s', 'pos::b', 'Scale', 0.5, 8, 0.01)], `**What it shows.** Noise is rarely the picture itself; it bends something else. Straight stripes (a sine of x) look like nothing; turn every point of the space by a noise-driven angle before drawing them and the stripes wander and bunch like the grain in a plank of wood.

**How it is built.** UV × Scale → Noise Float → × Twist is an angle → **Rotate 2D** turns each point by its own angle → x → Sin → Abs → Smoothstep → Colorize in two browns.

**Try.** Twist 0 shows the plain stripes. Push Twist up for knots. Swap Rotate 2D for an Add of the noise to x only: a different, wavier grain. The Book's other example, splatter, is Noise Float → Smoothstep with close edges.${book(11, 'Noise')}`);

// ── Cellular noise (chapter 12) ─────────────────────────────────────────────

lesson('learnCellDistance', [
  uv(),
  n('mouse', 'mouse', 40, 700),
  n('circleSDF', 'pA', 280, 100, { radius: 0, posX: -0.8, posY: 0.4, ...note('A Circle SDF of radius 0 is just the distance to its centre point.') }, { position: ['uv', 'uv'] }),
  n('circleSDF', 'pB', 280, 280, { radius: 0, posX: 0.6, posY: 0.55 }, { position: ['uv', 'uv'] }),
  n('circleSDF', 'pC', 280, 460, { radius: 0, posX: 0.25, posY: -0.5 }, { position: ['uv', 'uv'] }),
  n('circleSDF', 'pM', 280, 640, { radius: 0, ...note('The fourth point is the mouse.') }, { position: ['uv', 'uv'], offset: ['mouse', 'uv'] }),
  n('minMath', 'm1', 520, 190, {}, { a: ['pA', 'distance'], b: ['pB', 'distance'] }),
  n('minMath', 'm2', 760, 300, {}, { a: ['m1', 'result'], b: ['pC', 'distance'] }),
  n('minMath', 'd', 1000, 400, { ...note('The smallest of the four: the distance to the nearest point.') }, { a: ['m2', 'result'], b: ['pM', 'distance'] }),
  n('colorize', 'field', 1240, 200, { color: [0.55, 0.85, 1.0], background: [0.02, 0.03, 0.08], gain: 1.2 }, { field: ['d', 'result'] }),
  n('sin', 'iso', 1240, 440, { freq: 40, amp: 1 }, { input: ['d', 'result'] }),
  n('abs', 'isoA', 1480, 440, {}, { input: ['iso', 'output'] }),
  n('step', 'lines', 1720, 440, { edge: 0.85, ...note('Thin lines where the distance crosses each ring.') }, { x: ['isoA', 'output'] }),
  n('colorize', 'ringed', 1720, 200, { color: [0.02, 0.03, 0.08], gain: 0.35 }, { field: ['lines', 'result'], background: ['field', 'color'] }),
  n('remap', 'dot', 1480, 640, { inMin: 0.015, inMax: 0.03, outMin: 1, outMax: 0 }, { value: ['d', 'result'] }),
  n('colorize', 'final', 1960, 300, { color: [1, 1, 1] }, { field: ['dot', 'result'], background: ['ringed', 'color'] }),
  out(['final', 'color'], 2200),
], [ctl('x', 'pA::posX', 'Point A x', -1.6, 1.6, 0.01), ctl('y', 'pA::posY', 'Point A y', -1, 1, 0.01), ctl('r', 'iso::freq', 'Rings', 5, 80, 0.5)], `**What it shows.** The idea under cellular noise: scatter a few points and give every pixel its distance to the *nearest* one. Around each point the field grows in circles; where two points' circles meet, the field folds into a crease. Those creases split the plane into cells, one per point. Move the mouse: it is one of the points.

**How it is built.** Four Circle SDFs with radius 0 measure the distance to three fixed points and the mouse; three **Min** nodes keep the smallest. Colorize shows the distance; a Sin → Abs → Step of it draws contour rings; a Remap near 0 puts a dot on each point.

**Try.** Move point A with its sliders and watch the cell boundaries shift. Add a fifth point (another Circle SDF and Min). With hundreds of points this gets slow, which is what the next lesson solves.${book(12, 'Cellular noise')}`);

lesson('learnVoronoi', [
  uv(),
  n('voronoi', 'cells', 280, 220, { scale: 3, jitter: 1, time_scale: 0, ...note('Tiles the space; one random point per tile; each pixel checks only its own tile and the eight around it.') }, { uv: ['uv', 'uv'] }),
  n('colorize', 'field', 520, 160, { color: [1.0, 0.75, 0.45], background: [0.06, 0.03, 0.12], gain: 1.3 }, { field: ['cells', 'dist'] }),
  n('remap', 'dot', 520, 400, { inMin: 0.04, inMax: 0.07, outMin: 1, outMax: 0 }, { value: ['cells', 'dist'] }),
  n('colorize', 'final', 760, 220, { color: [1, 1, 1] }, { field: ['dot', 'result'], background: ['field', 'color'] }),
  out(['final', 'color'], 1000),
], [ctl('s', 'cells::scale', 'Density', 1, 15, 0.1), ctl('j', 'cells::jitter', 'Randomness', 0, 1, 0.01)], `**What it shows.** The previous lesson for any number of points, at a fixed cost. Cut the plane into tiles (the Patterns chapter) and put one random point in each (the Random chapter). The nearest point can only be in a pixel's own tile or one of the eight around it, so each pixel checks nine points, however many there are. The result, distance to the nearest point, is Steven Worley's *cellular noise*: cells like skin, stone or foam.

**How it is built.** UV → **Voronoi** (Distance out) → Colorize, plus a Remap near 0 for the points themselves.

**Try.** Randomness 0 puts every point at its tile's centre: the cells become a square grid. Raise it slowly and the grid dissolves. Put the distance through a Step for cracked tiles, or into a Palette. Wire Time into the Voronoi's Time and raise Speed to drift it.${book(12, 'Cellular noise')}`);

// ── Fractal Brownian motion (chapter 13) ────────────────────────────────────

lesson('learnOctaves', [
  ...plotFrame(),
  time(520, 520),
  n('makeVec2', 'p', 760, 220, {}, { x: ['xy', 'x'] }),
  n('fbm', 'fbm', 1000, 220, { octaves: 6, gain: 0.5, lacunarity: 2, scale: 4, time_scale: 0.2, ...note('Six layers of noise: each one Lacunarity times finer and Gain times weaker than the last.') }, { uv: ['p', 'xy'], time: ['time', 'time'] }),
  plotBg(['fbm', 'value'], 1240, 460),
  ...plotLine('line', ['fbm', 'value'], ['bg', 'color'], GREEN, 1240, 220),
  out(['line', 'color'], 1720),
], [ctl('g', 'fbm::gain', 'Gain', 0, 0.9, 0.01), ctl('l', 'fbm::lacunarity', 'Lacunarity', 1, 4, 0.01), ctl('f', 'fbm::scale', 'Frequency', 1, 10, 0.1)], `**What it shows.** One noise is a gentle hill. Add a second at twice the frequency and half the height, a third at twice that and half again, and so on: each layer (an *octave*, as in music) adds finer detail without changing the big shape. The sum is **fractal Brownian motion**, and its line looks like a mountain range: zoom in and the small bumps look like the big ones.

**How it is built.** The plot frame: x (with Time drifting it) → **Fractal Noise (FBM)**, which runs six octaves. Gain is how much each octave's height shrinks; Lacunarity how much its frequency grows.

**Try.** Gain 0 leaves only the first octave: smooth hills. 0.5 is the natural look; 0.8 is jagged rock. Lacunarity near 1 stacks octaves of almost the same size; 3 or 4 spreads them far apart.${book(13, 'Fractal Brownian Motion')}`);

lesson('learnFBM', [
  uv(),
  time(40, 420),
  n('fbm', 'fbm', 300, 220, { octaves: 5, scale: 1.5, time_scale: 0.15 }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
  n('palette', 'pal', 560, 220, { preset: '0', scale: 1 }, { value: ['fbm', 'value'] }),
  out(['pal', 'color'], 820),
], [ctl('sc', 'fbm::scale', 'Scale', 0.3, 6, 0.05), ctl('g', 'fbm::gain', 'Gain (roughness)', 0.2, 0.8, 0.01)], `**What it shows.** The same stack of octaves in 2D: big soft shapes with finer and finer detail on top, the look of clouds, smoke, terrain and marble. Octaves is how many layers; Gain how much each finer layer counts.

**How it is built.** Fractal Noise (FBM) is a loop of noise inside one node. Palette colours the height. The Matrices folder's *Rotated noise octaves* builds the loop by hand, turning each octave so the grid underneath doesn't line up.

**Try.** Gain 0.3 for smooth hills, 0.7 for rough rock. Scale up for detail. Feed the FBM value into an SDF's radius to make a wobbly shape.${book(13, 'Fractal Brownian Motion')}`);

lesson('learnTurbulence', [
  uv(),
  time(40, 700),
  vt(n('multiply', 'zoom', 280, 220, { b: 1.5 }, { a: ['uv', 'uv'] }), 'vec2'),
  ...[1, 2, 4, 8].flatMap((f, i) => [
    n('noiseFloat', `o${i + 1}`, 520, 40 + i * 200, { mode: 'perlin', scale: f, speed: 0.05 * f, ...(i === 0 ? note('Four octaves by hand: each twice the frequency of the last. Signed is −1…1.') : {}) }, { uv: ['zoom', 'result'], time: ['time', 'time'] }),
    n('abs', `a${i + 1}`, 760, 40 + i * 200, i === 0 ? note('abs folds each octave at 0: the smooth zero-crossings become sharp creases.') : {}, { input: [`o${i + 1}`, 'signed'] }),
  ]),
  n('weightedAverage', 'turb', 1000, 320, { inputs_used: '4', w1: 1, w2: 0.5, w3: 0.25, w4: 0.125, ...note('Add them up, each half as strong as the last: turbulence.') },
    { a: ['a1', 'output'], b: ['a2', 'output'], c: ['a3', 'output'], d: ['a4', 'output'] }),
  n('remap', 'ridge', 1240, 320, { inMin: 0, inMax: 0.6, outMin: 1, outMax: 0, ...note('Upside down: the creases become ridges.') }, { value: ['turb', 'result'] }),
  n('pow', 'sharp', 1480, 320, { exponent: 3 }, { base: ['ridge', 'result'] }),
  n('colorize', 'paint', 1720, 320, { color: [0.75, 0.9, 1.0], background: [0.03, 0.02, 0.1] }, { field: ['sharp', 'result'] }),
  out(['paint', 'color'], 1960, 320),
], [ctl('z', 'zoom::b', 'Zoom', 0.3, 5, 0.01), ctl('s', 'sharp::exponent', 'Ridge sharpness', 0.5, 8, 0.01), ctl('w', 'turb::w4', 'Finest octave', 0, 1, 0.01)], `**What it shows.** Change what goes into the sum and FBM changes character. **Turbulence** takes the absolute value of each octave before adding: where a noise crosses zero it folds, and those folds become sharp valleys. Flip it upside down and sharpen it and the valleys are **ridges**: glowing veins, lightning, mountain crests.

**How it is built.** FBM by hand so the abs can go inside: four Perlin Noise Floats at 1, 2, 4 and 8 times the frequency, each through Abs, summed by Weighted Average with halving weights. Remap turns it upside down; Pow sharpens the ridges.

**Try.** Ridge sharpness 1 is soft, 8 leaves only thin veins. Set Finest octave to 0 to see what the last layer adds. Take the Abs nodes out (wire Value instead of Signed) and it is plain FBM again.${book(13, 'Fractal Brownian Motion')}`);

lesson('learnWarp', [
  uv(),
  time(40, 420),
  n('domainWarp', 'warp', 300, 220, { strength: 0.6, scale: 1.2, time_scale: 0.1 }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
  n('fbm', 'fbm', 560, 220, { octaves: 5, scale: 1.5, time_scale: 0.0 }, { uv: ['warp', 'uv'] }),
  n('palette', 'pal', 820, 220, { preset: '7', scale: 1 }, { value: ['fbm', 'value'] }),
  out(['pal', 'color'], 1080),
], [ctl('st', 'warp::strength', 'Warp strength', 0, 1.5, 0.01), ctl('sc', 'warp::scale', 'Warp scale', 0.2, 4, 0.05)], `**What it shows.** *Domain warping*, the chapter's last trick: FBM applied to the coordinates before more FBM reads them. The space itself is pushed around, so the pattern after it flows and folds like marble or ink in water. Inigo Quilez's article on it is where the Book sends you next.

**How it is built.** Domain Warp takes the UV and returns a displaced UV (its Offset output is the displacement alone). FBM reads the warped UV, Palette colours it. Two warps in a row go further still.

**Try.** Strength 0 to see the un-warped FBM, then raise it. Warp a Grid or a Tile instead of noise and the cells bend.${book(13, 'Fractal Brownian Motion')}`);

// ── Fractals (chapter 14, not yet written in the Book) ──────────────────────

lesson('learnFractal', [
  uv(),
  n('constant', 'zoom', 40, 440, { value: 8, ...note('How many times the view has doubled in magnification.') }),
  n('exp', 'size', 280, 440, { scale: -0.6931, ...note('exp(−zoom × ln 2) = 2^−zoom: the size of the view.') }, { input: ['zoom', 'value'] }),
  vt(n('multiply', 'view', 280, 220, {}, { a: ['uv', 'uv'], b: ['size', 'output'] }), 'vec2'),
  n('mandelbrot', 'm', 520, 220, { center_x: -0.7453, center_y: 0.1127, zoom: 0.7, color_scale: 3, ...note('For each pixel: z = z² + c, over and over, with c the pixel\'s position. The colour is how many steps z took to escape.') }, { uv: ['view', 'result'] }),
  out(['m', 'color'], 820),
], [ctl('z', 'zoom::value', 'Zoom (doublings)', 0, 16, 0.01)], `**What it shows.** A fractal is a shape made of smaller copies of itself, and the most famous one comes from one line of maths. Take the pixel's position as a complex number c, start z at 0, and repeat z = z² + c. For some pixels z stays small forever: they are the black **Mandelbrot set**. For the rest it flies off, and colouring by how quickly draws the glowing border, which is infinitely detailed.

**How it is built.** UV → **Mandelbrot / Julia** → Output. The node runs the loop and colours it with a cosine palette. The UV is shrunk by 2^−zoom before the node reads it, so each step of Zoom doubles the magnification, here into the "seahorse valley" on the set's edge.

**Try.** Zoom out to 0 to see the whole set, then back in slowly: the valley, then seahorses and spirals, then tiny copies of the whole set. Switch Mode to Julia and wire the Mouse into C Pos: every mouse position is a different Julia set. The Book's chapter on fractals isn't written yet; the next lesson builds a fractal from nodes instead.${book(14, 'Fractals (not yet written)')}`);

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
], [ctl('f', 'loop::fold::scale', 'Fold scale', 1.05, 3, 0.01)], `**What it shows.** A fractal built by hand: the same fold applied to its own result, again and again, so the pattern repeats inside itself. A group with Iterations set to 4 is a \`for\` loop: its subgraph runs four times in a row. Two nodes make the passes talk to each other. **Loop Carry** is a variable that lives across passes: Init is its value before the first pass, Next is what the pass writes into it, Value is what the current pass reads. Here it carries the UV: each pass folds it with Tile, and the next pass folds the folded one, so four passes fold four times. **Loop Index** is the pass number, used to shift the palette per pass.

**How it is built.** Inside the group: Loop Carry (vec2) → Tile → Length → + Index × 0.3 → Palette. The Palette node's assignment is set to **+=** in its header, so instead of the last pass winning, all four colours add up; Add Colors × 0.25 averages them and Tone Map rounds off the peaks. In GLSL: \`vec2 c = uv; for (i…) { c = fract(c*1.5)-0.5; col += palette(length(c)+i*0.3); }\`. The ⟳ carry-mode button on a node is a shortcut for the same wiring when a node feeds itself.

**Try.** Raise Iterations on the group to 6. Change Fold scale. Swap Tile for Rotate 2D and the carry becomes an accumulated rotation.${book(14, 'Fractals (not yet written)')}`);

// ── Moved: earlier Learn lessons that teach something the Book doesn't ─────
// Same keys, graphs and notes as before; they now live in Curves & Shapes,
// Color & Lighting and Grid (learnExampleIndex.ts).

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

**Try.** Lower Falloff for a wider halo. Switch SDF Glow's Mode to Rings. Wire Time → Sin → Remap into Radius and the lamp pulses.`);

lesson('learnPalette', [
  uv(),
  time(40, 420),
  n('length', 'len', 280, 220, { scale: 1 }, { input: ['uv', 'uv'] }),
  n('palette', 'pal', 540, 220, { preset: '1', scale: 1, speed: 0.15 }, { value: ['len', 'output'], anim: ['time', 'time'] }),
  out(['pal', 'color'], 820),
], [ctl('sc', 'pal::scale', 'Repeats', 0.2, 6, 0.05), ctl('sp', 'pal::speed', 'Speed', 0, 1, 0.01)], `**What it shows.** A **Palette** turns one number into a colour by running three cosine waves, one per channel, each with its own offset, amplitude, frequency and phase (Inigo Quilez's formula). Feed it the distance from the centre and you get coloured rings; feed it Time and they cycle.

**How it is built.** Length of the UV is the input; the preset picks the four vec3s; Speed scrolls the palette. Set the preset to Custom to edit the waves yourself. Palettes are the standard way to colour any float: noise, iteration counts, cell IDs.

**Try.** Raise Repeats. Change the preset. Replace Length with the x of the UV for a horizontal gradient.`);

lesson('learnGrid', [
  uv(),
  n('gridLayout', 'grid', 280, 220, { columns: 12 }, { uv: ['uv', 'uv'] }),
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
  n('gridPattern', 'gp', 320, 220, { columns: 16, shape: 'circle', size: 0.3, pattern: 'checker', affect: 'grow', affectRadius: 0.7, affectSoftness: 0.8 }, { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'] }),
  out(['gp', 'color'], 620),
], [ctl('s', 'gp::size', 'Size', 0.05, 0.6, 0.01), ctl('r', 'gp::affectRadius', 'Mouse radius', 0.1, 2, 0.01), ctl('a', 'gp::affectAmount', 'Mouse strength', 0, 2, 0.01)], `**What it shows.** The whole *Grid: Cell ID and hash* example in one node. **Grid Pattern** cuts the UV into cells, puts a shape in each, decides which cells get one (every cell, every other column or row, a checkerboard, diagonals, random), and lets a point affect the shapes near it. Here the mouse makes the dots grow.

**How it is built.** UV in, Mouse UV into Affect Pos, colour out. Pick the shape, the pattern and the affect mode on the card. For a shape of your own, wire Cell UV into any SDF and finish with Grid Paint (see *Grid: Effects across the grid*); the raw grid is also on the other outputs (Cell ID, Distance, Influence) for the rest of the Grid family or SDF Glow.

**Try.** Change Pattern to Diagonal stripes and Shape to Cross. Set Affect to Hide, then to Spin. Add Jitter to break the grid.`);

lesson('learnGridSpread', [
  uv(),
  n('mouse', 'mouse', 40, 420),
  n('gridPattern', 'gp', 300, 220, { columns: 20, pattern: 'all', affect: 'pull', affectRadius: 1.1, affectSoftness: 1.0, affectAmount: 1.2 }, { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'] }),
  n('shapeSDF', 'star', 600, 160, { shape: 'box', wx: 0.22, wy: 0.22 }, { p: ['gp', 'cellUV'] }),
  n('palette', 'pal', 600, 400, { preset: '5', scale: 1 }, { value: ['gp', 'influence'] }),
  n('gridPaint', 'paint', 880, 220, { background: [0.05, 0.05, 0.08] }, { distance: ['star', 'distance'], color: ['pal', 'color'], placed: ['gp', 'placed'] }),
  out(['paint', 'color'], 1140),
], [ctl('a', 'gp::affectAmount', 'Pull', 0, 2, 0.01), ctl('r', 'gp::affectRadius', 'Reach', 0.1, 3, 0.01), ctl('o', 'paint::strokeWidth', 'Outline', 0, 0.3, 0.005)], `**What it shows.** Two things at once. First, a shape of your own on the grid: Grid Pattern's **Cell UV** goes into an ordinary Shape SDF, and **Grid Paint** brings the distance back and paints it, gated by Placed so the pattern's empty cells stay empty. Anything that turns a vec2 into a distance or a colour can sit between the two nodes. Second, an effect spreading across the grid: **Influence** is 1 at the mouse and fades to 0 at the radius, and because Cell UV already carries the pull, the squares slide toward the mouse while a Palette of the Influence colours them.

**How it is built.** Grid Pattern → Cell UV → Shape SDF → Grid Paint (Distance), with Grid Pattern's Placed into Grid Paint's Placed and Palette(Influence) into its Colour. Swap Shape SDF for a Custom Function or a text SDF and the grid draws that instead. Cell Displace and Neighbor Dist in the Grid folder do the spreading by hand.

**Try.** Set Affect to Grow: Cell UV is scaled, so the boxes grow without the SDF knowing. Wire a Texture Input's colour into Grid Paint's Colour and leave Distance empty: every placed cell shows the picture.`);

// ── Assembly ────────────────────────────────────────────────────────────────

const RAYMARCH_NOTES = `**What it shows.** An extra beyond the Book, whose 3D chapters aren't written yet. Everything so far was flat: a colour per (x, y). Ray marching adds depth without any geometry. **March Camera** turns each pixel into a ray (an origin and a direction). The **Scene Group** describes the world as a 3D distance field, exactly like the 2D SDFs of the Shapes chapter but with a vec3 position. The **March Loop Group** walks the ray forward by the scene distance until it is close enough to call it a hit, and reports the hit's position, normal and depth. The normal is painted as colour, the standard first look at any surface.

**How it is built.** March Camera → March Loop Group, with the Scene Group wired into its Scene input; inside the Scene Group a Sphere 3D on the Scene Pos. Open the group to see the sphere; add a Box 3D and a Union, wire the Union into Scene Output (whatever reaches Scene Output is the scene), and the scene grows. The Learn 3D folder takes it from here, one idea at a time.

**Try.** Turn and pull back the camera with the sliders. Replace Normal to Color with Multi-Light and the sphere is lit.`;

/**
 * The Learn lessons and the moved ones. The last lesson reuses the 3D "Hello
 * Sphere" example's nodes, so it stays exactly in step with that graph; it is
 * passed in because this module is loaded by exampleGraphs.ts itself.
 */
export function buildLearnExamples(base: Record<string, ExampleGraph>): Record<string, ExampleGraph> {
  const out: Record<string, ExampleGraph> = {};
  for (const l of L) {
    const index = LEARN_EXAMPLE_INDEX[l.key] ?? LEARN_MOVED_INDEX[l.key];
    if (!index) throw new Error(`learnExamples: ${l.key} is not in the index`);
    out[l.key] = { ...index, counter: 40, nodes: l.nodes, play: play(l.controls, l.notes) };
  }
  const hello = base.rayMarchOutputs3D;
  if (hello) {
    out.learnRaymarch = {
      ...LEARN_EXAMPLE_INDEX.learnRaymarch, counter: hello.counter, nodes: hello.nodes,
      play: play([
        ctl('a', 'cam_ro3_ray::camAngle', 'Camera angle', -3.14, 3.14, 0.01),
        ctl('d', 'cam_ro3_ray::camDist', 'Camera distance', 1.5, 6, 0.01),
      ], RAYMARCH_NOTES),
    };
  }
  return out;
}
