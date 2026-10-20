/**
 * builtUpExamples.ts — the examples that used a whole-shader node, rebuilt from small nodes (2026-10-19, the
 * user's call: a look is built up from small nodes; nodes/notOffered.ts MONOLITH_RETIRED_TYPES). Same keys as
 * before, so links, the Play layer `example:fractalRings` and the startup example keep working.
 *
 *  - fractalRings (2D showcase, the startup example) and motionBlurTrails (Effects & Lens): kishimisu's rings,
 *    once the Fractal Loop node, as an iterated Group: Loop Carry folds the UV with Tile every pass, Loop Index
 *    shifts each pass's palette, and the ring glow is Sin → Abs → Divide.
 *  - newtonFractalZ5 (2D showcase): Newton's method on z⁵ − 1 with Complex Pow and Complex Divide, Loop Break
 *    stopping a pixel once it has settled on a root.
 *  - groupJuliaBreak (Groups & Code): an escape-time Julia set, three Loop Carries (z, the count, an orbit trap)
 *    and Loop Break; its c circles slowly, so the set morphs.
 *  - The retired-list keys that used one (they still open by key): gravitationalLens, comboChaosStars,
 *    magicTextureDemo, waveTextureDemo, waveInterference, comboBlurDirectional.
 *
 * learnFractal (Learn) is a lesson in learnExamples.ts; it uses escapeGroup and smoothEscapeColour from here.
 * Built from the node definitions (graphBuilder.ts), every node with a note; no Expression Blocks.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { PlayControl, PlayMapping } from '../types/play';
import { VECTORIZABLE_NODES } from '../nodes/definitions/math';
import { ctl, group, n, play, port } from './graphBuilder';
import type { ExampleGraph } from './exampleIndex';

type Wire = [string, string];
const note = (text: string) => ({ __comment: text });

/** A math node switched to a vector type, as the type pills on its card do. */
export function vt(node: GraphNode, t: 'vec2' | 'vec3'): GraphNode {
  const v = VECTORIZABLE_NODES[node.type];
  if (!v) throw new Error(`builtUpExamples: ${node.type} can't be vectorised`);
  const keys = new Set([v.primaryInput, ...(v.alsoInputs ?? [])]);
  const inputs = Object.fromEntries(Object.entries(node.inputs).map(([k, s]) => [k, keys.has(k) ? { ...s, type: t } : s]));
  const outputs = v.primaryOutput ? { ...node.outputs, [v.primaryOutput]: { ...node.outputs[v.primaryOutput], type: t } } : node.outputs;
  return { ...node, inputs, outputs, params: { ...node.params, outputType: t } };
}

/** A Loop Carry with its sockets typed by its Type (dataType), as switching the type on its card does. */
function carry(id: string, x: number, y: number, params: Record<string, unknown> & { dataType: 'float' | 'vec2' | 'vec3' }, wires: Record<string, Wire> = {}): GraphNode {
  const node = n('loopCarry', id, x, y, params, wires);
  const t = params.dataType;
  return { ...node, inputs: { init: { ...node.inputs.init, type: t }, next: { ...node.inputs.next, type: t } }, outputs: { value: { ...node.outputs.value, type: t } } };
}

/** A group with a note on its card (house style: every node explains itself). */
const noted = (g: GraphNode, text: string): GraphNode => ({ ...g, params: { ...g.params, __comment: text } });

const example = (label: string, description: string, nodes: GraphNode[], controls?: PlayControl[], notes?: string, mappings?: PlayMapping[]): ExampleGraph => ({
  label, description, nodes, counter: nodes.length,
  ...(controls ? { play: { ...play(controls, notes ?? ''), ...(mappings ? { mappings } : {}) } } : {}),
});

// ── Fractal rings (was the Fractal Loop node) ───────────────────────────────

/**
 * kishimisu's rings as an iterated Group, the same maths the Fractal Loop node ran:
 *   uv = fract(uv × 1.5) − 0.5;  d = length(uv) × exp(−length(uv0));
 *   colour += palette(length(uv0) + i × 0.4 + t × speed) × 0.01 ÷ |sin(d × 8 + t) ÷ 8|.
 * Inputs: in_uv (folded, carried) and in_uv0 (the picture before folding). Output: out_color.
 */
export function ringsGroup(id: string, x: number, y: number, uv: Wire, o: { passes?: number; speed?: number } = {}): GraphNode {
  const passes = o.passes ?? 4, speed = o.speed ?? 0.4;
  return noted(group(id, x, y, {
    label: 'Fractal rings', iterations: passes,
    inputs: [
      { key: 'in_uv', type: 'vec2', label: 'UV', from: uv },
      { key: 'in_uv0', type: 'vec2', label: 'UV0', from: uv },
    ],
    outputs: [{ key: 'out_color', type: 'vec3', label: 'Color', from: ['col', 'result'] }],
    nodes: [
      carry('carry', 60, 120, { dataType: 'vec2', ...note('Loop Carry (vec2): the folded picture, carried from pass to pass. Init is the canvas UV before the first pass; Next is what Tile made of it, so every pass folds the last pass\'s tiles again and they get smaller.') },
        { init: port('in_uv'), next: ['tile', 'output'] }),
      n('fract', 'tile', 300, 120, { scale: 1.5, ...note('Tile: fract(uv × 1.5) − 0.5, the picture cut into tiles, each centred on 0. Carried, the tiles nest inside tiles: the fractal.') }, { input: ['carry', 'value'] }),
      n('length', 'lenT', 540, 120, { scale: 1, ...note('Length: how far this pixel is from the middle of its tile.') }, { input: ['tile', 'output'] }),
      n('length', 'len0', 60, 340, { scale: 1, ...note('Length: how far this pixel is from the middle of the whole picture (UV0, before any folding).') }, { input: port('in_uv0') }),
      n('exp', 'fade', 300, 340, { scale: -1, ...note('Exp, Scale −1: e^−distance from the middle, 1 there and smaller outwards, so the rings spread out towards the edges.') }, { input: ['len0', 'output'] }),
      n('multiply', 'd', 780, 200, note('Multiply: the distance in the tile × the fade: the number the rings are drawn from.'), { a: ['lenT', 'output'], b: ['fade', 'output'] }),
      n('time', 'time', 540, 560, note('Time: seconds since the start. It ripples the rings and drifts the colours.')),
      n('multiply', 'wave', 1020, 200, { b: 8, ...note('Multiply × 8: the ring frequency, how many rings fit in a tile.') }, { a: ['d', 'result'] }),
      n('add', 'phase', 1260, 200, note('Add Time: the rings move outwards as time runs.'), { a: ['wave', 'result'], b: ['time', 'time'] }),
      n('sin', 'sin', 1500, 200, { freq: 1, amp: 0.125, ...note('Sin, Amp 0.125 (1 ÷ the ring frequency): crosses 0 on every ring.') }, { input: ['phase', 'result'] }),
      n('abs', 'abs', 1740, 200, note('Abs: the distance to the nearest ring, never negative.'), { input: ['sin', 'output'] }),
      n('constant', 'glowK', 1740, 40, { value: 0.01, ...note('Constant 0.01: the glow. Smaller makes thinner, sharper rings.') }),
      n('divide', 'glow', 1980, 140, note('Divide: 0.01 ÷ the distance to a ring, bright right on a ring and dim between: a neon line.'), { a: ['glowK', 'value'], b: ['abs', 'output'] }),
      n('loopIndex', 'i', 60, 560, note('Loop Index: which pass this is (0, 1, 2, 3).')),
      n('multiply', 'iOff', 300, 560, { b: 0.4, ...note('Multiply × 0.4: each pass moves 0.4 along the palette, so the layers take different colours.') }, { a: ['i', 'i'] }),
      n('add', 'hueT', 780, 440, note('Add: distance from the middle + the pass\'s shift: where on the palette this pixel sits.'), { a: ['len0', 'output'], b: ['iOff', 'result'] }),
      n('palette', 'pal', 1020, 440, { speed, ...note(`Palette (cosine, rainbow): the pass's colour. Time in Angle offset, Speed ${speed}, slides the colours round slowly.`) }, { value: ['hueT', 'result'], anim: ['time', 'time'] }),
      vt(n('multiply', 'col', 2220, 300, note('Multiply: the colour × the ring glow. Its assignment is += (header), so every pass\'s rings add up instead of the last one winning; the group\'s Color is the sum.'),
        { a: ['pal', 'color'], b: ['glow', 'result'] }, { assignOp: '+=' }), 'vec3'),
    ],
  }), `Fractal rings: a Group that repeats ${passes} times (Iterations on the card), a for loop. Each pass folds the picture into smaller tiles and adds a layer of glowing rings in its own colour. Open it to see how (after kishimisu).`);
}

function fractalRings(): ExampleGraph {
  return example('Fractal Rings',
    'kishimisu\'s fractal rings from small nodes: a Group that repeats 4 times folds the picture into tiles with Tile (Loop Carry passes the folded picture on, so the tiles nest), Sin → Abs → Divide draws glowing rings, and Loop Index gives each pass its own Palette colour.',
    [
      n('uv', 'uv', 40, 220, note('UV: the canvas position, centred on 0. The group folds it.')),
      ringsGroup('rings', 300, 160, ['uv', 'uv']),
      n('output', 'out', 600, 220, note('Output: the rings are the picture.'), { color: ['rings', 'out_color'] }),
    ],
    [
      ctl('tile', 'rings::tile::scale', 'Tile scale', 1.05, 3, 0.01),
      ctl('freq', 'rings::wave::b', 'Ring frequency', 2, 20, 0.1),
      ctl('glow', 'rings::glowK::value', 'Glow', 0.002, 0.04, 0.001),
      ctl('hue', 'rings::iOff::b', 'Colour per pass', 0, 1, 0.01),
    ],
    `**What it shows.** kishimisu's famous fractal rings, built from a dozen small nodes. A **Group** with Iterations 4 is a \`for\` loop: its inside runs four times. Each pass cuts the picture into tiles, and because the tiles are carried on to the next pass, tiles appear inside tiles: the fractal. Every pass adds a layer of glowing rings in its own colour.

**How it is built.** Open the group. **Loop Carry** holds the folded UV between passes; **Tile** folds it again. The distance to the tile's middle, faded by **Exp** of the distance to the picture's middle, becomes rings through **Sin → Abs → Divide** (0.01 ÷ the distance to a ring is a neon line). **Loop Index** shifts the **Palette** per pass, and the final **Multiply** is set to **+=**, so the four passes add up.

**Try.** Tile scale 1.2 makes big soft layers, 2.5 a fine lace. Raise Iterations on the group to 6 for more depth. Ring frequency 3 gives fat bands; Glow 0.003 thin wires.`);
}

function motionBlurTrails(): ExampleGraph {
  return example('Motion Blur Trails',
    'The fractal rings (a repeating Group of small nodes) through Feedback (texture): each frame keeps about 72% of the last (a Tail of 0.23 s, blue fading first) and adds the fresh picture, so moving rings leave smooth trails.',
    [
      n('uv', 'mb_uv', 40, 220, note('UV: the canvas position, for the rings.')),
      ringsGroup('mb_rings', 300, 160, ['mb_uv', 'uv'], { speed: 0.6 }),
      n('textureFeedback', 'mb_blur', 640, 200, { label: 'Trails', amount: 0.28, tail: 0.234, tint: [1, 0.865, 0.757], clean: 0, blend: 'add',
        ...note('Feedback (texture): the rings (Fresh, at 0.28) added over last frame\'s trails, which fade to 1% in 0.23 seconds (about 72% kept each frame at 60 fps), blue fastest (Tint): smooth motion trails at any frame rate.') },
      { fresh: ['mb_rings', 'out_color'] }),
      n('output', 'mb_out', 920, 220, note('Output: the trails.'), { color: ['mb_blur', 'color'] }),
    ]);
}

// ── Escape-time fractals (were Mandelbrot / Julia and Newton Fractal) ───────

/**
 * An escape-time loop: z = z² + c, repeated, with a count, stopped by Loop Break once |z| passes Bailout.
 * Mandelbrot: c is the pixel, z starts at 0 (no z0). Julia: z starts at the pixel (z0), c is one point.
 * Outputs (in this order, so no output pairs with an input as a carry): out_n (float, passes until escape),
 * [out_trap (float, closest |z| came to 0) when trap], out_z (vec2, z where it stopped).
 */
export function escapeGroup(id: string, x: number, y: number, o: { c: Wire; z0?: Wire; iterations: number; trap?: boolean; label?: string }): GraphNode {
  const julia = !!o.z0;
  return noted(group(id, x, y, {
    label: o.label ?? (julia ? 'z = z² + c (Julia)' : 'z = z² + c'), iterations: o.iterations,
    inputs: [
      { key: 'in_c', type: 'vec2', label: 'c', from: o.c },
      ...(o.z0 ? [{ key: 'in_z0', type: 'vec2' as const, label: 'z start', from: o.z0 }] : []),
    ],
    outputs: [
      { key: 'out_n', type: 'float', label: 'Passes', from: ['n', 'value'] },
      ...(o.trap ? [{ key: 'out_trap', type: 'float' as const, label: 'Trap', from: ['trap', 'value'] as Wire }] : []),
      { key: 'out_z', type: 'vec2', label: 'z', from: ['z', 'value'] },
    ],
    nodes: [
      carry('z', 60, 120, { dataType: 'vec2', ...note(julia
        ? 'Loop Carry (vec2): z, carried from pass to pass. It starts at the pixel (Init); every pass writes z² + c into Next.'
        : 'Loop Carry (vec2): z, carried from pass to pass. Init is unwired, so it starts at 0; every pass writes z² + c into Next.') },
      { ...(o.z0 ? { init: port('in_z0') } : {}), next: ['zNext', 'result'] }),
      n('complexMul', 'sq', 300, 120, note('Complex Mul: z × z, z squared as a complex number (its angle doubles, its length squares).'), { a: ['z', 'value'], b: ['z', 'value'] }),
      vt(n('add', 'zNext', 540, 120, note(julia ? 'Add: z² + c, with c the same point for every pixel: the Julia rule.' : 'Add: z² + c, with c this pixel\'s own point: the Mandelbrot rule.'),
        { a: ['sq', 'result'], b: port('in_c') }), 'vec2'),
      carry('n', 60, 340, { dataType: 'float', ...note('Loop Carry (float): how many passes so far. Init 0; Next is one more.') }, { next: ['nNext', 'result'] }),
      n('add', 'nNext', 300, 340, { b: 1, ...note('Add 1: count this pass.') }, { a: ['n', 'value'] }),
      n('length', 'r', 780, 120, { scale: 1, ...note('Length: |z|, how far z is from 0 now.') }, { input: ['zNext', 'result'] }),
      n('constant', 'bailout', 780, 300, { value: 16, ...note('Constant 16: the bailout. Past 2 a point never comes back; going on to 16 makes the smooth colouring after the group exact.') }),
      n('compare', 'out', 1020, 200, { operator: '>', ...note('Compare: is |z| past the bailout? 1 once the point has escaped.') }, { a: ['r', 'output'], b: ['bailout', 'value'] }),
      n('loopBreak', 'stop', 1260, 200, note('Loop Break: stop this pixel\'s loop once it has escaped. z and the count keep the values of the pass that escaped; the passes after it are skipped.'), { when: ['out', 'mask'] }),
      ...(o.trap ? [
        n('constant', 'far', 60, 520, { value: 10, ...note('Constant 10: the orbit trap starts far away.') }),
        carry('trap', 300, 520, { dataType: 'float', ...note('Loop Carry (float): the orbit trap, the closest z has come to 0 so far.') }, { init: ['far', 'value'], next: ['trapNext', 'result'] }),
        n('minMath', 'trapNext', 540, 520, note('Min: keep the closer of the old trap and this pass\'s |z|.'), { a: ['trap', 'value'], b: ['r', 'output'] }),
      ] : []),
    ],
  }), `${julia ? 'Julia' : 'Mandelbrot'} loop: z = z² + c, up to ${o.iterations} times (Iterations on the card). Loop Break stops a pixel as soon as |z| passes 16; Passes says how many it took and z where it stopped${o.trap ? ', Trap how close z came to 0' : ''}.`);
}

/**
 * Smooth colouring for an escape group: n − log₂(log₂ |z|²) (no bands between counts), through a Palette,
 * black where the point never escaped. Returns the nodes and the colour wire.
 */
export function smoothEscapeColour(g: string, x: number, y: number, o: { preset?: string; scale?: number; prefix?: string; anim?: Wire } = {}): { nodes: GraphNode[]; color: Wire } {
  const p = o.prefix ?? '';
  return {
    nodes: [
      n('dot', `${p}zz`, x, y + 160, note('Dot: z · z, |z|² where the point stopped.'), { a: [g, 'out_z'], b: [g, 'out_z'] }),
      n('log', `${p}lg1`, x + 240, y + 160, { base: '2', ...note('Log (base 2): log₂ |z|².') }, { input: [`${p}zz`, 'result'] }),
      n('log', `${p}lg2`, x + 480, y + 160, { base: '2', ...note('Log (base 2) again: log₂ log₂ |z|², how far past the bailout the last pass threw z. It goes from 0 to 1 between one count and the next.') }, { input: [`${p}lg1`, 'output'] }),
      n('subtract', `${p}smooth`, x + 720, y + 80, note('Subtract: the pass count minus that fraction: a smooth escape time, with no bands between whole counts.'), { a: [g, 'out_n'], b: [`${p}lg2`, 'output'] }),
      n('palette', `${p}pal`, x + 960, y + 80, { preset: o.preset ?? '1', scale: o.scale ?? 0.03, speed: o.anim ? 0.05 : 0, ...note(`Palette: the smooth escape time as colour. Scale sets how fast the colours cycle${o.anim ? '; Time in Angle offset turns them slowly' : ''}.`) },
        { value: [`${p}smooth`, 'result'], ...(o.anim ? { anim: o.anim } : {}) }),
      n('compare', `${p}esc`, x + 720, y + 280, { operator: '>', ...note('Compare: |z|² above 4 means the point escaped. Inside the set it never does, and stays black.') }, { a: [`${p}zz`, 'result'], b: [`${p}four`, 'value'] }),
      n('constant', `${p}four`, x + 480, y + 340, { value: 4, ...note('Constant 4: |z|² past 4 (|z| past 2) has escaped.') }),
      vt(n('multiply', `${p}col`, x + 1200, y + 160, note('Multiply: the colour where the point escaped, black inside the set.'), { a: [`${p}pal`, 'color'], b: [`${p}esc`, 'mask'] }), 'vec3'),
    ],
    color: [`${p}col`, 'result'],
  };
}

function groupJuliaBreak(): ExampleGraph {
  const colour = smoothEscapeColour('julia', 820, 120, { preset: '4', scale: 0.04, anim: ['time', 'time'] });
  return example('Group: Julia set (Loop Break)',
    'An escape-time Julia set built from small nodes: an iterated Group carries z, a pass count and an orbit trap (three Loop Carries) and Loop Break stops each pixel as soon as it escapes. c circles slowly, so the set morphs; Log gives smooth colours outside and the trap shades the inside.',
    [
      n('uv', 'uv', 40, 120, note('UV: each pixel\'s point on the complex plane, where its z starts.')),
      vt(n('multiply', 'view', 280, 120, { b: 1.3, ...note('Multiply × 1.3: shows a little more of the plane, so the whole set fits.') }, { a: ['uv', 'uv'] }), 'vec2'),
      n('time', 'time', 40, 360, note('Time: seconds since the start. It walks c round a circle and turns the colours.')),
      n('multiply', 'slow', 280, 360, { b: 0.2, ...note('Multiply × 0.2: one turn every 31 seconds.') }, { a: ['time', 'time'] }),
      n('angleToVec2', 'dir', 520, 360, note('Angle → Vec2: a point on the unit circle at that angle.'), { angle: ['slow', 'result'] }),
      vt(n('multiply', 'c', 760, 360, { b: 0.7885, ...note('Multiply × 0.7885: c on a circle of radius 0.7885, which passes close to the Mandelbrot set\'s edge all the way round: every c gives a lacy, connected Julia set.') }, { a: ['dir', 'result'] }), 'vec2'),
      escapeGroup('julia', 560, 100, { c: ['c', 'result'], z0: ['view', 'result'], iterations: 96, trap: true }),
      ...colour.nodes,
      n('palette', 'inPal', 1820, 520, { preset: '2', scale: 1.5, ...note('Palette: the orbit trap as colour, for the points that never escaped.') }, { value: ['julia', 'out_trap'] }),
      vt(n('multiply', 'inDim', 2060, 520, { b: 0.35, ...note('Multiply × 0.35: the inside stays darker than the edge.') }, { a: ['inPal', 'color'] }), 'vec3'),
      vt(n('mix', 'both', 2300, 300, note('Mix: the dim trap colour inside, the smooth escape colour outside (Blend is the escaped mask).'), { a: ['inDim', 'result'], b: ['col', 'result'], t: ['esc', 'mask'] }), 'vec3'),
      n('output', 'out', 2540, 300, note('Output.'), { color: ['both', 'result'] }),
    ],
    [ctl('rad', 'c::b', 'c radius', 0.5, 1, 0.001), ctl('zoom', 'view::b', 'View size', 0.2, 2, 0.01), ctl('cyc', 'pal::scale', 'Colour cycles', 0.005, 0.2, 0.001)],
    `**What it shows.** A Julia set: start z at the pixel's point, repeat z = z² + c, and see whether it flies away. One fixed c gives one set; here c walks slowly round a circle, so the set keeps changing shape.

**How it is built.** The group repeats up to 96 times. Three **Loop Carries** live across the passes: z, the pass count, and an orbit trap (the closest z ever came to 0, kept with Min). **Loop Break** ends a pixel's loop the moment |z| passes 16, so escaped pixels stop early and keep the z they escaped with. After the group, **Log** twice (n − log₂ log₂ |z|²) turns the count into a smooth value for the Palette; the trap colours the points that never escaped, and **Mix** picks between them.

**Try.** Set c radius to 0.75 or 0.8: thin dust, then fat blobs. View size 0.4 zooms in on the lace. Change Iterations on the group to 24: the edge loses detail, and that is all the extra passes were doing.`);
}

function newtonFractalZ5(): ExampleGraph {
  return example('Newton z⁵−1',
    'Newton\'s method from small nodes: an iterated Group slides every point towards a root of z⁵ − 1 (z − f ÷ f′ with Complex Pow and Complex Divide), Loop Break stops it once it has settled, and Vector Angle → Round says which of the five roots it reached. The step size breathes with Time, so the borders writhe.',
    [
      n('uv', 'uv', 40, 160, note('UV: each pixel is a starting point z on the complex plane.')),
      vt(n('multiply', 'view', 280, 160, { b: 1.4, ...note('Multiply × 1.4: how much of the plane the picture shows.') }, { a: ['uv', 'uv'] }), 'vec2'),
      noted(group('newton', 540, 100, {
        label: 'Newton step', iterations: 40,
        inputs: [{ key: 'in_z0', type: 'vec2', label: 'z start', from: ['view', 'result'] }],
        outputs: [
          { key: 'out_n', type: 'float', label: 'Passes', from: ['n', 'value'] },
          { key: 'out_z', type: 'vec2', label: 'z', from: ['z', 'value'] },
        ],
        nodes: [
          carry('z', 60, 160, { dataType: 'vec2', ...note('Loop Carry (vec2): z, starting at the pixel and moved by every pass.') }, { init: port('in_z0'), next: ['zNext', 'result'] }),
          n('complexPow', 'z5', 300, 60, { exponent: 5, ...note('Complex Pow 5: z⁵.') }, { z: ['z', 'value'] }),
          vt(n('constant', 'one', 300, 220, { x: 1, y: 0, ...note('Constant (vec2): 1 as a complex number, (1, 0).') }), 'vec2'),
          vt(n('subtract', 'f', 540, 60, note('Subtract: f(z) = z⁵ − 1, zero at the five roots.'), { a: ['z5', 'result'], b: ['one', 'value'] }), 'vec2'),
          n('complexPow', 'z4', 300, 380, { exponent: 4, ...note('Complex Pow 4: z⁴.') }, { z: ['z', 'value'] }),
          vt(n('multiply', 'df', 540, 380, { b: 5, ...note('Multiply × 5: the slope f′(z) = 5z⁴.') }, { a: ['z4', 'result'] }), 'vec2'),
          n('complexDiv', 'step', 780, 200, note('Complex Divide: f ÷ f′, Newton\'s step: how far, and which way, to the nearest root along the slope.'), { a: ['f', 'result'], b: ['df', 'result'] }),
          n('time', 'time', 540, 560, note('Time: seconds since the start, to make the step size breathe.')),
          n('sin', 'wob', 780, 560, { freq: 0.4, amp: 0.3, ...note('Sin: ±0.3, one swing every 16 seconds.') }, { input: ['time', 'time'] }),
          n('add', 'relax', 1020, 560, { b: 1, ...note('Add 1: the step size, 0.7 to 1.3. At 1 it is plain Newton; off 1 the borders between the roots curl into new shapes.') }, { a: ['wob', 'output'] }),
          vt(n('multiply', 'scaled', 1020, 200, note('Multiply: the step × the step size.'), { a: ['step', 'result'], b: ['relax', 'result'] }), 'vec2'),
          vt(n('subtract', 'zNext', 1260, 160, note('Subtract: z − the step, one move closer to a root. Next pass starts here.'), { a: ['z', 'value'], b: ['scaled', 'result'] }), 'vec2'),
          carry('n', 60, 720, { dataType: 'float', ...note('Loop Carry (float): how many passes it took.') }, { next: ['nNext', 'result'] }),
          n('add', 'nNext', 300, 720, { b: 1, ...note('Add 1: count this pass.') }, { a: ['n', 'value'] }),
          n('length', 'moved', 1260, 360, { scale: 1, ...note('Length: how far this pass moved z.') }, { input: ['scaled', 'result'] }),
          n('constant', 'tol', 1260, 520, { value: 0.001, ...note('Constant 0.001: close enough.') }),
          n('compare', 'settled', 1500, 400, { operator: '<', ...note('Compare: did z move less than 0.001? Then it has found its root.') }, { a: ['moved', 'output'], b: ['tol', 'value'] }),
          n('loopBreak', 'stop', 1740, 400, note('Loop Break: stop once settled. The count then says how long the point took; the slow ones sit on the borders.'), { when: ['settled', 'mask'] }),
        ],
      }), 'Newton step: z − f(z) ÷ f′(z) for f = z⁵ − 1, up to 40 times (Iterations on the card). Loop Break stops a pixel once it has settled on a root; Passes says how long that took.'),
      n('atan2', 'ang', 860, 60, note('Vector Angle: z\'s angle. The five roots of z⁵ = 1 sit 72° apart round the unit circle.'), { v: ['newton', 'out_z'] }),
      n('multiply', 'fifths', 1100, 60, { b: 0.7958, ...note('Multiply × 5 ÷ 2π: the angle in fifths of a turn.') }, { a: ['ang', 'angle'] }),
      n('round', 'root', 1340, 60, note('Round: which root, −2 to 2.'), { input: ['fifths', 'result'] }),
      n('palette', 'pal', 1580, 60, { preset: '1', scale: 0.2, ...note('Palette, Scale 0.2: one colour per root, a fifth of the way round apart.') }, { value: ['root', 'output'] }),
      n('exp', 'shade', 1340, 260, { scale: -0.06, ...note('Exp, Scale −0.06: bright where the point settled in a few passes, dark where it took many (the chaotic borders).') }, { input: ['newton', 'out_n'] }),
      vt(n('multiply', 'col', 1820, 160, note('Multiply: the root\'s colour, shaded by how long it took.'), { a: ['pal', 'color'], b: ['shade', 'output'] }), 'vec3'),
      n('output', 'out', 2060, 160, note('Output.'), { color: ['col', 'result'] }),
    ],
    [ctl('wob', 'newton::wob::amp', 'Step wobble', 0, 0.6, 0.01), ctl('zoom', 'view::b', 'View size', 0.1, 3, 0.01), ctl('shade', 'shade::scale', 'Shading', -0.3, 0, 0.001)],
    `**What it shows.** Newton's method finds where a function is zero by sliding downhill along its slope. Do it from every pixel for f(z) = z⁵ − 1 and colour each pixel by the root it lands on: five basins, and where they meet the borders are endlessly detailed.

**How it is built.** The group repeats up to 40 times. **Loop Carry** holds z; **Complex Pow** makes z⁵ and z⁴, and **Complex Divide** gives the step f ÷ f′. **Loop Break** stops a pixel once its step is smaller than 0.001, and a second carry counts the passes. After the group, **Vector Angle → Round** names the root and **Exp** of the count darkens the slow points. The step is scaled by 1 ± 0.3 over time: plain Newton at 1, curling borders either side.

**Try.** Step wobble 0 for the still classic picture. View size 0.2 zooms onto a border: it repeats forever. Change both Complex Pows to 3 and 2 (and the × 5 to × 3, the × 0.7958 to × 0.4775) for z³ − 1.`);
}

// ── The retired-list keys (they open by key; not in a folder) ──────────────

function gravitationalLens(): ExampleGraph {
  const colour = smoothEscapeColour('mandel', 1300, 100, { preset: '0', scale: 0.022 });
  return example('Gravity Lens',
    'A lens bent from small nodes: Gravity Field (Repel, 1/d) pushes each pixel\'s look-up away from the mouse, so the Mandelbrot set behind it (an escape-time Group) swirls round a black hole that Smoothstep cuts out.',
    [
      n('uv', 'uv', 40, 120, note('UV: the canvas position.')),
      n('mouse', 'mouse', 40, 300, note('Mouse: where the lens is.')),
      n('gravityField', 'pull', 280, 200, { mode: 'repel', falloff: 'linear', strength: 0.03, ...note('Gravity Field, Repel, Linear: a push away from the mouse, 0.03 ÷ distance. Light passing a mass bends: we look further out than the pixel is.') }, { uv: ['uv', 'uv'], attractor: ['mouse', 'uv'] }),
      vt(n('add', 'bent', 520, 120, note('Add: the pixel + the push: the bent look-up point.'), { a: ['uv', 'uv'], b: ['pull', 'dir'] }), 'vec2'),
      vt(n('multiply', 'view', 760, 120, { b: 1.2, ...note('Multiply × 1.2: the view size.') }, { a: ['bent', 'result'] }), 'vec2'),
      vt(n('constant', 'centre', 760, 300, { x: -0.6, y: 0, ...note('Constant (vec2): the view\'s centre on the plane.') }), 'vec2'),
      vt(n('add', 'c', 1000, 120, note('Add: the point on the plane, c.'), { a: ['view', 'result'], b: ['centre', 'value'] }), 'vec2'),
      escapeGroup('mandel', 1040, 400, { c: ['c', 'result'], iterations: 96 }),
      ...colour.nodes,
      n('smoothstep', 'hole', 2560, 360, { edge0: 0.08, edge1: 0.1, ...note('Smoothstep 0.08 → 0.1: 0 inside the event horizon round the mouse, 1 outside.') }, { value: ['pull', 'dist'] }),
      vt(n('multiply', 'final', 2800, 260, note('Multiply: the picture, black inside the horizon.'), { a: ['col', 'result'], b: ['hole', 'result'] }), 'vec3'),
      n('output', 'out', 3040, 260, note('Output.'), { color: ['final', 'result'] }),
    ]);
}

function comboChaosStars(): ExampleGraph {
  return example('Combo: Star layers + Glow to Colour',
    'Xor\'s Efficient Chaos from small nodes: an iterated Group turns, shifts, shrinks and drifts the picture once per layer (Transform), tiles it, and adds a point light per tile (Length → Divide), five layers; Glow to Colour tints the sum.',
    [
      n('uv', 'uv', 40, 160, note('UV: the canvas position.')),
      vt(n('multiply', 'cells', 280, 160, { b: 6, ...note('Multiply × 6: about six cells across the picture.') }, { a: ['uv', 'uv'] }), 'vec2'),
      noted(group('layers', 520, 100, {
        label: 'Star layers', iterations: 5,
        inputs: [{ key: 'in_p', type: 'vec2', label: 'Position', from: ['cells', 'result'] }],
        outputs: [{ key: 'out_glow', type: 'float', label: 'Glow', from: ['light', 'result'] }],
        nodes: [
          n('loopIndex', 'i', 60, 320, note('Loop Index: which layer (0 … 4).')),
          n('multiply', 'turn', 300, 320, { b: 2.3998, ...note('Multiply × 2.3998: the golden angle in radians. Each layer turns this much more than the last, so no two grids line up.') }, { a: ['i', 'i'] }),
          n('multiply', 'grow', 300, 460, { b: 0.35, ...note('Multiply × 0.35: each layer is drawn 35% bigger than the last (Grow 1, 1.35, 1.7…), so far layers have small, dense stars.') }, { a: ['i', 'i'] }),
          n('add', 'grow1', 540, 460, { b: 1, ...note('Add 1: Grow starts at 1.') }, { a: ['grow', 'result'] }),
          n('time', 'time', 60, 600, note('Time: seconds since the start.')),
          n('multiply', 'drift', 300, 600, { b: 0.3, ...note('Multiply × 0.3: the drift speed.') }, { a: ['time', 'time'] }),
          n('multiply', 'par', 540, 600, note('Multiply: drift × the layer\'s Grow: near layers (big Grow, below) slide further: parallax.'), { a: ['drift', 'result'], b: ['grow1', 'result'] }),
          n('makeVec2', 'move', 780, 600, { y: 0.4, ...note('Make Vec2: the drift as an offset, mostly sideways.') }, { x: ['par', 'result'] }),
          n('transform', 'place', 780, 200, { dim: '2', mode: 'place', ...note('Transform (place): the layer turned (Turn), scaled (Grow) and slid (Offset).') },
            { p: port('in_p'), turn: ['turn', 'result'], grow: ['grow1', 'result'], offset: ['move', 'xy'] }),
          n('fract', 'tile', 1020, 200, { scale: 0.5, ...note('Tile × 0.5: a 2-unit cell grid, each cell centred on 0.') }, { input: ['place', 'p'] }),
          n('length', 'len', 1260, 200, { scale: 2.2, ...note('Length × 2.2: how far from the cell\'s centre, 1 a little inside the cell\'s edge.') }, { input: ['tile', 'output'] }),
          n('smoothstep', 'edge', 1500, 320, { edge0: 1, edge1: 0.3, ...note('Smoothstep 1 → 0.3: fades the light to nothing before the cell edge, so cells don\'t show.') }, { value: ['len', 'output'] }),
          n('constant', 'size', 1260, 40, { value: 0.012, ...note('Constant 0.012: star brightness.') }),
          n('divide', 'pt', 1500, 120, note('Divide: brightness ÷ distance: a point light at the cell\'s centre.'), { a: ['size', 'value'], b: ['len', 'output'] }),
          n('multiply', 'light', 1740, 200, note('Multiply: the point light, faded at the cell edge. Its assignment is +=, so the five layers add up.'), { a: ['pt', 'result'], b: ['edge', 'result'] }, { assignOp: '+=' }),
        ],
      }), 'Star layers: five passes (Iterations), each a grid of point lights turned by the golden angle, grown and drifted, so the grids never line up.'),
      n('glowToColor', 'col', 860, 160, { exposure: 1.4, tint: [0.75, 0.85, 1], ...note('Glow to Colour: Tint × tanh(glow × Exposure), so bright cores don\'t blow out.') }, { glow: ['layers', 'out_glow'] }),
      n('output', 'out', 1100, 160, note('Output.'), { color: ['col', 'color'] }),
    ]);
}

function magicTextureDemo(): ExampleGraph {
  return example('Magic Texture',
    'Blender\'s Magic texture from small nodes: an iterated Group folds a point through Sin again and again (Swizzle swaps x and y each pass), and the result\'s x, y and their difference become red, green and blue.',
    [
      n('uv', 'uv', 40, 160, note('UV: the canvas position.')),
      n('time', 'time', 40, 360, note('Time: makes the pattern drift.')),
      vt(n('multiply', 'p', 280, 160, { b: 4, ...note('Multiply × 4: the scale.') }, { a: ['uv', 'uv'] }), 'vec2'),
      vt(n('add', 'p0', 520, 160, note('Add Time: the pattern drifts diagonally.'), { a: ['p', 'result'], b: ['tDrift', 'result'] }), 'vec2'),
      n('multiply', 'tDrift', 280, 360, { b: 0.3, ...note('Multiply × 0.3: drift speed.') }, { a: ['time', 'time'] }),
      noted(group('folds', 760, 100, {
        label: 'Sine folds', iterations: 4,
        inputs: [{ key: 'in_p', type: 'vec2', label: 'Point', from: ['p0', 'result'] }],
        outputs: [{ key: 'out_q', type: 'vec3', label: 'Folded', from: ['q3', 'output'] }],
        nodes: [
          carry('q', 60, 120, { dataType: 'vec2', ...note('Loop Carry (vec2): the point being folded, the scaled UV at first.') }, { init: port('in_p'), next: ['fold', 'output'] }),
          { ...n('swizzle', 'yx', 300, 120, { inputType: 'vec2', pattern: 'yx', ...note('Swizzle yx: swap x and y, so each pass folds one axis by the other.') }, { input: ['q', 'value'] }), inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'q', outputKey: 'value' } } }, outputs: { output: { type: 'vec2', label: 'Output' } } },
          n('loopIndex', 'i', 60, 340, note('Loop Index: the pass number.')),
          n('add', 'k', 300, 340, { b: 1, ...note('Add 1: the pass number from 1.') }, { a: ['i', 'i'] }),
          vt(n('multiply', 'pk', 540, 340, note('Multiply: the point × the pass number, a finer ripple every pass.'), { a: port('in_p'), b: ['k', 'result'] }), 'vec2'),
          vt(n('add', 'mixd', 540, 120, note('Add: the swapped point + that ripple.'), { a: ['yx', 'output'], b: ['pk', 'result'] }), 'vec2'),
          vt(n('sin', 'fold', 780, 120, { freq: 1, amp: 1, ...note('Sin: folds both numbers back into −1…1. Folding what was already folded is where the interference comes from.') }, { input: ['mixd', 'result'] }), 'vec2'),
          { ...n('swizzle', 'q3', 1020, 120, { inputType: 'vec2', pattern: 'xyx', ...note('Swizzle xyx: x, y and x again, ready to colour.') }), inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'fold', outputKey: 'output' } } }, outputs: { output: { type: 'vec3', label: 'Output' } } },
        ],
      }), 'Sine folds: four passes (Iterations), each folding the point through Sin again.'),
      vt(n('multiply', 'half', 1020, 160, { b: 0.5, ...note('Multiply × 0.5.') }, { a: ['folds', 'out_q'] }), 'vec3'),
      vt(n('add', 'rgb', 1260, 160, { b: 0.5, ...note('Add 0.5: from −1…1 to 0…1, red from x, green from y.') }, { a: ['half', 'result'] }), 'vec3'),
      n('hueRotate', 'hue', 1500, 160, { angle: 1.5708, ...note('Hue Rotate: a quarter turn of hue for Blender\'s look.') }, { color: ['rgb', 'result'] }),
      n('output', 'out', 1740, 160, note('Output.'), { color: ['hue', 'color'] }),
    ]);
}

/** Rings from Length → Sin: what the Wave Texture node's Rings mode did. */
function ringsWave(prefix: string, uv: Wire, time: Wire, x: number, y: number, o: { scale: number; speed: number }): GraphNode[] {
  return [
    n('length', `${prefix}len`, x, y, { scale: o.scale, ...note(`Length × ${o.scale}: the distance from the middle, ${o.scale} per unit.`) }, { input: uv }),
    n('multiply', `${prefix}t`, x, y + 160, { b: o.speed, ...note(`Multiply: Time × ${o.speed}, how fast the waves travel.`) }, { a: time }),
    n('subtract', `${prefix}ph`, x + 240, y, note('Subtract: the waves move outwards as time runs.'), { a: [`${prefix}len`, 'output'], b: [`${prefix}t`, 'result'] }),
    n('sin', `${prefix}w`, x + 480, y, { freq: 1, amp: 0.5, ...note('Sin: a ring wherever the distance passes a whole wave, −0.5 to 0.5.') }, { input: [`${prefix}ph`, 'result'] }),
  ];
}

function waveTextureDemo(): ExampleGraph {
  return example('Wave Texture', 'Rings from three small nodes: Length (the distance from the middle) → Subtract Time → Sin makes travelling rings, and a Palette colours them. What the Wave Texture node did, in the open.', [
    n('uv', 'uv', 40, 160, note('UV: the canvas position.')),
    n('time', 'time', 40, 360, note('Time: seconds since the start.')),
    ...ringsWave('', ['uv', 'uv'], ['time', 'time'], 280, 160, { scale: 8, speed: 1.5 }),
    n('palette', 'pal', 1000, 160, { preset: '1', ...note('Palette: the wave as colour.') }, { value: ['w', 'output'] }),
    n('output', 'out', 1240, 160, note('Output.'), { color: ['pal', 'color'] }),
  ]);
}

function waveInterference(): ExampleGraph {
  return example('Wave Interference', 'Two waves multiplied: rings from Length → Sin and diagonal stripes from Split → Add → Sin. Where both are up or both down the product is bright; the moiré between them is interference.', [
    n('uv', 'uv', 40, 160, note('UV: the canvas position.')),
    n('time', 'time', 40, 520, note('Time: seconds since the start.')),
    ...ringsWave('a', ['uv', 'uv'], ['time', 'time'], 280, 60, { scale: 8, speed: 0.5 }),
    n('splitVec2', 'xy', 280, 360, note('Split Vec2: x and y, for the stripes.'), { v: ['uv', 'uv'] }),
    n('add', 'diag', 520, 360, note('Add: x + y, which grows along the diagonal.'), { a: ['xy', 'x'], b: ['xy', 'y'] }),
    n('multiply', 'bScale', 760, 360, { b: 7.07, ...note('Multiply × 7.07: stripes per unit (10 × 0.707, the diagonal\'s length).') }, { a: ['diag', 'result'] }),
    n('multiply', 'bT', 760, 520, { b: 0.4, ...note('Multiply: Time × 0.4.') }, { a: ['time', 'time'] }),
    n('add', 'bPh', 1000, 360, note('Add: the stripes slide the other way to the rings.'), { a: ['bScale', 'result'], b: ['bT', 'result'] }),
    n('sin', 'bw', 1240, 360, { freq: 1, amp: 0.5, ...note('Sin: diagonal stripes, −0.5 to 0.5.') }, { input: ['bPh', 'result'] }),
    n('multiply', 'both', 1480, 200, note('Multiply: the two waves together. Bright where they agree, dark where they don\'t: interference.'), { a: ['aw', 'output'], b: ['bw', 'output'] }),
    n('palette', 'pal', 1720, 200, { preset: '4', scale: 2, ...note('Palette: the product as colour.') }, { value: ['both', 'result'] }),
    n('output', 'out', 1960, 200, note('Output.'), { color: ['pal', 'color'] }),
  ], [
    ctl('scaleA', 'alen::scale', 'Rings scale', 0.5, 20),
    ctl('scaleB', 'bScale::b', 'Stripes scale', 0.5, 20),
  ], `**What it shows.** Two simple waves multiplied make a third pattern neither has: interference, the moiré you see through two layers of net curtain.

**How it is built.** Rings: Length → Subtract Time → Sin. Stripes: Split Vec2 → x + y → Sin. Multiply them, then a Palette.

**Try.** Move the mouse across: the rings get finer as the stripes get coarser.`, [
    { id: 'mouse', controlId: 'scaleA', source: { kind: 'mouse', axis: 'x' }, outMin: 2, outMax: 14, curve: 'linear', smoothMs: 100, enabled: true },
    { id: 'counter', controlId: 'scaleB', source: { kind: 'control', controlId: 'scaleA' }, outMin: 14, outMax: 2, curve: 'linear', smoothMs: 0, enabled: true },
  ]);
}

function comboBlurDirectional(): ExampleGraph {
  return example('Combo: Rings + Blur',
    'Sharp rings (Length → Sin, posterized) drawn into a Pass, then Blur (texture), Smooth: a true Gaussian made as two hidden passes, across then down, the separable Blur X and Blur Y passes from the blur articles, read between texels so no copies show. Set Method to Fast on the card for the one-pass kind. The threshold, blur and add-back chain in one node: Combo: Grid + SDF Fill + Bloom.',
    [
      n('uv', 'bl_uv', 40, 160, note('UV: the canvas position.')),
      n('time', 'bl_time', 40, 360, note('Time: seconds since the start.')),
      ...ringsWave('bl_', ['bl_uv', 'uv'], ['bl_time', 'time'], 280, 160, { scale: 6, speed: 0.5 }),
      n('palette', 'bl_pal', 1000, 160, { preset: '1', ...note('Palette: the rings as colour.') }, { value: ['bl_w', 'output'] }),
      n('posterize', 'bl_post', 1240, 160, { levels: 3, ...note('Posterize: three levels, so the edges are hard and the blur has something to soften.') }, { color: ['bl_pal', 'color'] }),
      n('pass', 'bl_pass', 1480, 0, { label: 'Waves', ...note('Pass: the sharp rings as a texture, this frame, so the blur can read round each pixel.') }, { color: ['bl_post', 'color'] }),
      n('blurTexture', 'bl_blur', 1480, 200, { method: 'smooth', radius: 12, ...note('Blur (texture), Smooth: a true Gaussian of 12 pixels, made as two hidden passes (across, then down) that read between texels, so no copies show. Fast is one cheap pass.') },
        { texture: ['bl_pass', 'texture'] }),
      n('output', 'bl_out', 1720, 200, note('Output.'), { color: ['bl_blur', 'color'] }),
    ]);
}

/** The rebuilt examples by key (they replace the graphs that used a retired node). */
export function buildBuiltUpExamples(): Record<string, ExampleGraph> {
  return {
    fractalRings: fractalRings(),
    motionBlurTrails: motionBlurTrails(),
    newtonFractalZ5: newtonFractalZ5(),
    groupJuliaBreak: groupJuliaBreak(),
    gravitationalLens: gravitationalLens(),
    comboChaosStars: comboChaosStars(),
    magicTextureDemo: magicTextureDemo(),
    waveTextureDemo: waveTextureDemo(),
    waveInterference: waveInterference(),
    comboBlurDirectional: comboBlurDirectional(),
  };
}
