/**
 * gridExamples.ts — the numbered Grid tour (Grid 1 … Grid 8), built from the
 * node definitions (graphBuilder.ts).
 *
 * One example per way of building a grid, and per kind of control over it:
 *   1  Grid Pattern alone (the built-in shapes, patterns and affect modes)
 *   2  by hand: the Grid node, Cell ID and SDF Fill
 *   3  one wire: a shape chain in Grid Pattern's Shape, varied per cell
 *   4  big patterns made from per-cell numbers (a wave over the Cell ID)
 *   5  the affect point changing the shape, not just its size
 *   6  Overflow: shapes that cross their cell borders
 *   7  an Array in every cell (nested field sockets)
 *   8  the Array node as the grid itself, with smooth union
 *
 * Every example carries Play notes (what it shows, how it is built, what to
 * try) and comments on the nodes that matter, so reading the graph explains
 * it too. Some Play setups include a mapping (an LFO or the mouse) to show a
 * param being driven instead of set.
 */
import type { ExampleGraph } from './exampleIndex';
import type { PlayControl, PlayMapping, PlayRecord, PlaySource } from '../types/play';
import { ctl, n, out, time, uv } from './graphBuilder';

export const GRID_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  gridTourBuiltIn: {
    label: 'Grid 1 · Built-in shapes and patterns', play: true,
    description: 'Grid Pattern on its own: cells, a built-in shape, which cells get one (a checkerboard here) and what the mouse does to the shapes near it (grow). An LFO in Play slowly turns every shape. The quickest grid there is.',
  },
  gridTourByHand: {
    label: 'Grid 2 · By hand: Grid node + SDF Fill', play: true,
    description: 'The long way round, with every step a node: the Grid node cuts the UV into cells, a hash of each Cell ID sets a circle’s radius and colour, a Cell Filter empties a regular set of cells, and SDF Fill paints it. Nothing hidden, everything rewireable.',
  },
  gridTourMorph: {
    label: 'Grid 3 · One wire: shapes that morph and spin per cell', play: true,
    description: 'A whole chain wired into Grid Pattern’s Shape: a star and a square mixed together, spun by a Rotate 2D, with a Cell node giving every cell its own phase. Each cell morphs between the two shapes and turns on its own clock.',
  },
  gridTourRipple: {
    label: 'Grid 4 · Big patterns from per-cell numbers', play: true,
    description: 'A ripple across the whole grid, made per cell: the distance of each Cell ID from the centre goes through a sine with Time, and sets that cell’s circle size and colour. The mouse’s X, mapped in Play, sets the ring spacing.',
  },
  gridTourMouseMorph: {
    label: 'Grid 5 · The mouse changes the shape', play: true,
    description: 'Influence as a blend: inside the shape chain the Cell node’s Influence (1 at the mouse, 0 outside its radius) mixes a circle into a star and picks the colour, while Affect spins the cells near the mouse.',
  },
  gridTourOverflow: {
    label: 'Grid 6 · Overflow: rings that cross their cells', play: true,
    description: 'Rings bigger than their cells, jittered and pushed away from the mouse, drawn with Overflow on Neighbours so each ring stays whole where it crosses into the next cell. An LFO in Play breathes the jitter. Switch Overflow to Clip to see what it fixes.',
  },
  gridTourArrayInCells: {
    label: 'Grid 7 · An Array in every cell', play: true,
    description: 'Field sockets nest: a ring of dots made by an Array goes into Grid Pattern’s Shape, so every cell holds its own little ring. A Cell node before the Array gives each cell its own number of dots; a second Cell node inside the dot chain grows the dots around each ring.',
  },
  gridTourArrayBlobs: {
    label: 'Grid 8 · Array as the grid: melting dots', play: true,
    description: 'The Array node laid out as a 6 × 6 grid with Smooth union, so neighbouring dots melt together. Each dot’s size follows a wave over its Index, and a rainbow Palette of the Index colours it. An LFO in Play slowly changes how much they melt.',
  },
};

/** The ordered keys, for the Grid folder. */
export const GRID_EXAMPLE_KEYS = Object.keys(GRID_EXAMPLE_INDEX);

// ── Small helpers ───────────────────────────────────────────────────────────

/** A node comment (shown on the card's Comment tab and in the generated code). */
const note = (text: string) => ({ __comment: text });

const map = (id: string, controlId: string, source: PlaySource, outMin: number, outMax: number): PlayMapping =>
  ({ id, controlId, source, outMin, outMax, curve: 'linear', smoothMs: 0, enabled: true });
const lfo = (rate: number, shape: 'sine' | 'triangle' = 'sine', phase = 0): PlaySource => ({ kind: 'lfo', shape, rate, phase });

function playRecord(controls: PlayControl[], notes: string, mappings: PlayMapping[] = []): PlayRecord {
  return { version: 1, controls, mappings, layers: [], notes };
}

const BG: [number, number, number] = [0.045, 0.045, 0.075];

export function buildGridExamples(): Record<string, ExampleGraph> {
  const graphs: Record<string, ExampleGraph> = {};
  const add = (key: string, nodes: ExampleGraph['nodes'], play: PlayRecord) => {
    graphs[key] = { ...GRID_EXAMPLE_INDEX[key], counter: 60, nodes, play };
  };

  // ── 1 · Grid Pattern on its own ───────────────────────────────────────────
  add('gridTourBuiltIn', [
    uv(),
    n('mouse', 'mouse', 40, 420),
    n('gridPattern', 'gp', 320, 220, {
      columns: 10, shape: 'diamond', size: 0.34, pattern: 'checker',
      affect: 'grow', affectRadius: 0.8, affectSoftness: 0.8, affectAmount: 1.2, overflow: 'neighbours',
      color: [0.98, 0.78, 0.42], background: BG,
      ...note('Everything happens in this one node. Columns cuts the canvas into cells; Built-in shape and Size draw one shape per cell; Pattern picks which cells get one; Affect says what the Affect Pos point (the mouse) does to the shapes inside Affect Radius. Overflow is on Neighbours so the grown diamonds are not cut at their cell edges.'),
    }, { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'] }),
    out(['gp', 'color'], 640),
  ], playRecord([
    ctl('size', 'gp::size', 'Shape size', 0.05, 0.8, 0.01),
    ctl('rot', 'gp::rotation', 'Rotation', -3.1416, 3.1416, 0.01),
    ctl('jit', 'gp::jitter', 'Jitter', 0, 0.5, 0.01),
    ctl('rad', 'gp::affectRadius', 'Mouse radius', 0.1, 3, 0.01),
  ], `**What it shows.** The quickest grid: one Grid Pattern node and nothing else. It cuts the canvas into cells, puts a built-in shape (a diamond) in each, leaves every other cell empty (Pattern: Checkerboard), and grows the shapes near the mouse (Affect: Grow). The Rotation slider is driven by a slow LFO in Play, so every diamond turns together.

**How it is built.** UV → Grid Pattern (UV), Mouse → Grid Pattern (Affect Pos), Grid Pattern's Color → Output. The shape, the pattern, the affect and Overflow (Neighbours, so grown shapes can spill into the empty cells) are dropdowns on the card.

**Try.** On the card, change Built-in shape (Circle, Ring, Cross, Triangle), Pattern (Diagonal stripes, Random with Density) and Affect (Pull, Spin, Hide). Set Overflow to Clip: the grown diamonds near the mouse are cut into octagons at their cell edges. Turn the LFO off in Play to take Rotation back.`,
  [map('m-rot', 'rot', lfo(0.05), -0.8, 0.8)]));

  // ── 2 · By hand ───────────────────────────────────────────────────────────
  add('gridTourByHand', [
    uv(),
    n('gridLayout', 'grid', 300, 220, { columns: 12,
      ...note('The Grid node does only the cutting: Cell UV is the position inside each cell (−0.5…0.5), Cell ID the column and row. Everything else is up to the nodes after it.') },
      { uv: ['uv', 'uv'] }),
    n('noiseFloat', 'hash', 560, 360, { mode: 'hash', scale: 1, speed: 0, outMin: 0.12, outMax: 0.44,
      ...note('Hash mode turns each Cell ID into its own random number, the same for the whole cell. Out Min/Max make it a radius directly.') },
      { uv: ['grid', 'cellID'] }),
    n('cellFilter', 'pick', 560, 580, { mode: '1.0', x: 3, y: 2,
      ...note('Modulo mode picks every 3rd column of every 2nd row. Its Inv Mask is 0 on those cells and 1 everywhere else.') },
      { cellID: ['grid', 'cellID'] }),
    n('multiply', 'mul', 820, 360, { ...note('Radius × Inv Mask: the picked cells get radius 0, so their circles disappear. Any 0/1 per-cell value works here.') },
      { a: ['hash', 'value'], b: ['pick', 'invertedMask'] }),
    n('circleSDF', 'circ', 1060, 180, {}, { position: ['grid', 'cellUV'], radius: ['mul', 'result'] }),
    n('palette', 'pal', 1060, 420, { preset: '1', scale: 3.0 }, { value: ['hash', 'value'] }),
    n('colorPicker', 'ink', 1060, 640, { color: [0.96, 0.94, 0.9] }),
    n('sdfFill', 'fill', 1320, 260, { strokeWidth: 0.03,
      ...note('SDF Fill paints the distance: Fill inside, Stroke on the edge, black outside.') },
      { d: ['circ', 'distance'], fillColor: ['pal', 'color'], strokeColor: ['ink', 'rgb'] }),
    out(['fill', 'result'], 1580),
  ], playRecord([
    ctl('max', 'hash::outMax', 'Largest radius', 0.1, 0.5, 0.005),
    ctl('min', 'hash::outMin', 'Smallest radius', 0, 0.4, 0.005),
    ctl('stroke', 'fill::strokeWidth', 'Outline', 0, 0.1, 0.002),
  ], `**What it shows.** What Grid Pattern does for you, done by hand. Every step is its own node, so every step can be swapped: the Grid node only cuts the UV into cells, a Hash of the Cell ID gives each cell a random radius and colour, a Cell Filter empties a regular set of cells, and SDF Fill paints the result.

**How it is built.** UV → Grid → Cell UV → Circle SDF (UV). Grid's Cell ID → Noise Float (Hash, Out 0.12–0.44) → Multiply by Cell Filter's Inv Mask → Circle SDF's Radius. The same hash → Palette → SDF Fill's Fill; a Colour Picker → its Stroke. Circle SDF → SDF Fill → Output.

**Try.** Change the Cell Filter's X and Y, or use its Mask instead of Inv Mask to keep only the picked cells. Put a Rotate 2D between Cell UV and Circle SDF and swap the circle for a Box SDF. Compare with Grid 1: Grid Pattern is this whole chain in one card.`));

  // ── 3 · One wire: morph + spin per cell ───────────────────────────────────
  add('gridTourMorph', [
    time(40, 520),
    n('fieldCell', 'cell', 40, 260, { ...note('Inside the chain wired into Grid Pattern’s Shape, Cell is the cell being drawn. Its Cell ID seeds everything below, so every cell is on its own clock.') }),
    n('noiseFloat', 'phase', 280, 260, { mode: 'hash', scale: 1, speed: 0, outMin: 0, outMax: 6.2832,
      ...note('A random phase per cell, 0…2π.') }, { uv: ['cell', 'cellID'] }),
    n('add', 'clock', 520, 360, { ...note('Phase + Time: each cell’s own clock.') }, { a: ['phase', 'value'], b: ['time', 'time'] }),
    n('sin', 'wave', 760, 440, { freq: 1.2 }, { input: ['clock', 'result'] }),
    n('remap', 'blend', 1000, 440, { inMin: -1, inMax: 1, outMin: 0, outMax: 1,
      ...note('The sine, from −1…1 to 0…1: how far this cell is between the star and the square.') }, { value: ['wave', 'output'] }),
    n('multiply', 'spin', 760, 200, { b: 0.6, ...note('The same clock, slower: the turning angle.') }, { a: ['clock', 'result'] }),
    n('uv', 'luv', 760, 40, { ...note('Inside a field chain the UV node is the cell’s own coordinates (−0.5…0.5), not the canvas.') }),
    n('rotate2d', 'rot', 1000, 120, {}, { input: ['luv', 'uv'], angle: ['spin', 'result'] }),
    n('shapeSDF', 'star', 1240, 40, { shape: 'starN', r: 0.36, n_pts: 5, m_pts: 2.4 }, { p: ['rot', 'output'] }),
    n('boxSDF', 'box', 1240, 240, { width: 0.24, height: 0.24 }, { position: ['rot', 'output'] }),
    n('mix', 'morph', 1480, 200, { ...note('Mixing two distances gives the shapes in between: 0 is the star, 1 the square.') },
      { a: ['star', 'distance'], b: ['box', 'distance'], t: ['blend', 'result'] }),
    n('palette', 'pal', 1480, 460, { preset: '1', scale: 0.16 }, { value: ['phase', 'value'] }),
    n('gridPattern', 'gp', 1740, 260, { columns: 9, pattern: 'all', affect: 'none', background: BG,
      ...note('Shape and Picture are field sockets (ƒ): the whole chain behind them is run once per cell, in that cell’s coordinates.') },
      { shape: ['morph', 'result'], picture: ['pal', 'color'] }),
    out(['gp', 'color'], 2000),
  ], playRecord([
    ctl('speed', 'wave::freq', 'Morph speed', 0, 5, 0.01),
    ctl('spin', 'spin::b', 'Spin speed', -3, 3, 0.01),
    ctl('star', 'star::r', 'Star size', 0.1, 0.5, 0.005),
    ctl('box', 'box::width', 'Square width', 0.05, 0.45, 0.005),
  ], `**What it shows.** A shape of your own on the grid, with one wire, varying per cell. Everything from Cell to Mix is wired into Grid Pattern's **Shape**, a field socket: Grid Pattern runs that whole chain once in every cell, in the cell's own coordinates. The **Cell** node is the cell being drawn, so hashing its Cell ID gives every cell its own phase: each one morphs between a star and a square and spins on its own clock.

**How it is built.** Cell (Cell ID) → Noise Float (Hash, 0…2π) + Time → Sin → Remap (0…1) → Mix's Blend. The same clock × 0.6 → Rotate 2D's angle, turning a UV node (inside a chain it's the cell's coordinates) before Shape SDF (Star) and Box SDF. Mix → Grid Pattern Shape. The phase → Palette → Grid Pattern Picture.

**Try.** Set Spin speed to 0 and Morph speed high. Replace the Box SDF with a Circle SDF. Set Grid Pattern's Affect to Grow and wire a Mouse into Affect Pos: the wired shape grows near the mouse like a built-in one.`));

  // ── 4 · Big patterns from per-cell numbers ────────────────────────────────
  add('gridTourRipple', [
    time(40, 520),
    n('multiply', 'speed', 280, 520, { b: 1.5 }, { a: ['time', 'time'] }),
    n('fieldCell', 'cell', 40, 260, { ...note('Cell ID is the column and row, centred on the middle of the canvas: a number per cell that big patterns can be computed from.') }),
    n('length', 'dist', 280, 260, { scale: 0.9, ...note('How far this cell is from the centre, in cells. Scale sets the ring spacing (Play maps the mouse X to it).') }, { input: ['cell', 'cellID'] }),
    n('subtract', 'phase', 520, 360, { ...note('Distance − Time: rings moving outward.') }, { a: ['dist', 'output'], b: ['speed', 'result'] }),
    n('sin', 'wave', 760, 360, {}, { input: ['phase', 'result'] }),
    n('remap', 'size', 1000, 260, { inMin: -1, inMax: 1, outMin: 0.05, outMax: 0.46,
      ...note('The wave as a radius: each cell’s circle is as big as the wave is high at that cell.') }, { value: ['wave', 'output'] }),
    n('circleSDF', 'circ', 1240, 200, {}, { radius: ['size', 'result'] }),
    n('palette', 'pal', 1240, 440, { preset: '4', scale: 0.3 }, { value: ['wave', 'output'] }),
    n('gridPattern', 'gp', 1500, 260, { columns: 18, pattern: 'all', affect: 'none', background: BG },
      { shape: ['circ', 'distance'], picture: ['pal', 'color'] }),
    out(['gp', 'color'], 1760),
  ], playRecord([
    ctl('spacing', 'dist::scale', 'Ring spacing', 0.1, 2.5, 0.01),
    ctl('speed', 'speed::b', 'Speed', -5, 5, 0.01),
    ctl('big', 'size::outMax', 'Largest dot', 0.1, 0.5, 0.005),
    ctl('small', 'size::outMin', 'Smallest dot', 0, 0.3, 0.005),
  ], `**What it shows.** A pattern much bigger than a cell, built one cell at a time. Each cell only knows its own Cell ID, but every cell computes the same formula (distance from the centre, minus time, through a sine), so together they draw rings rolling outward across the whole grid. The dot size and colour both follow the wave. In Play, the mouse's X is mapped to Ring spacing.

**How it is built.** Cell (Cell ID) → Length → Subtract (Time × Speed) → Sin → Remap (0.05–0.46) → Circle SDF's Radius → Grid Pattern Shape. The same Sin → Palette → Grid Pattern Picture. Circle SDF's UV is empty: in a field chain that's the cell's coordinates.

**Try.** Swap Length for Split Vec2 and use only X: vertical stripes march across. Use Vec2 → Angle instead: a spinning spiral. Add a Noise Float (smooth, not hash) on the Cell ID into Subtract for an organic wobble. Turn the mouse mapping off in Play to use the Ring spacing slider.`,
  [map('m-spacing', 'spacing', { kind: 'mouse', axis: 'x' }, 0.25, 2.2)]));

  // ── 5 · The mouse changes the shape ───────────────────────────────────────
  add('gridTourMouseMorph', [
    uv(),
    n('mouse', 'mouse', 40, 420),
    n('fieldCell', 'cell', 40, 620, { ...note('Influence: how much the mouse reaches this cell, 1 at the mouse, 0 outside Affect Radius. Grid Pattern computes it; the Cell node hands it to the shape chain.') }),
    n('circleSDF', 'circ', 320, 520, { radius: 0.2 }),
    n('shapeSDF', 'star', 320, 700, { shape: 'starN', r: 0.44, n_pts: 6, m_pts: 2.2 }),
    n('mix', 'morph', 580, 600, { ...note('Circle far from the mouse, star under it, everything in between on the way.') },
      { a: ['circ', 'distance'], b: ['star', 'distance'], t: ['cell', 'influence'] }),
    n('palette', 'pal', 580, 820, { preset: '0', scale: 1, __inExpr_value: '0.55 - input * 0.55',
      ...note('Influence picks the colour: an input expression turns 0…1 into a walk along the palette from blue (far) to cream (under the mouse).') }, { value: ['cell', 'influence'] }),
    n('gridPattern', 'gp', 860, 260, { columns: 11, pattern: 'all', affect: 'spin', affectRadius: 0.9, affectSoftness: 0.9, affectAmount: 1.0, background: BG,
      ...note('Affect is Spin, so the stars turn as they appear. Influence reaches the shape chain whatever Affect does, even Nothing.') },
      { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'], shape: ['morph', 'result'], picture: ['pal', 'color'] }),
    out(['gp', 'color'], 1140),
  ], playRecord([
    ctl('rad', 'gp::affectRadius', 'Mouse radius', 0.1, 3, 0.01),
    ctl('soft', 'gp::affectSoftness', 'Softness', 0, 1, 0.01),
    ctl('amt', 'gp::affectAmount', 'Strength', 0, 1, 0.01),
    ctl('star', 'star::r', 'Star size', 0.1, 0.5, 0.005),
  ], `**What it shows.** The affect point doing more than the built-in effects. Grid Pattern works out how much the mouse reaches each cell (its **Influence**) and the **Cell** node passes it into the Shape chain, so the chain can do anything with it: here it blends each circle into a six-point star and picks its colour. Affect is still Spin on top.

**How it is built.** Circle SDF and Shape SDF (Star) → Mix, with Cell's Influence as the Blend → Grid Pattern Shape. Cell's Influence → Palette → Grid Pattern Picture. Mouse → Affect Pos.

**Try.** Lower Softness for a hard edge between the circles and the stars. Set Affect to Nothing: the morph still follows the mouse. Wire Influence into the Circle SDF's Radius instead of the Mix for a size-only version.`));

  // ── 6 · Overflow ──────────────────────────────────────────────────────────
  add('gridTourOverflow', [
    uv(),
    n('mouse', 'mouse', 40, 420),
    n('fieldCell', 'cell', 40, 620),
    n('ringSDF', 'ring', 300, 520, { radius: 0.56, ...note('A ring wider than its cell (the cell is 1 across, the ring 1.12). Without Overflow it would be cut to a square.') }),
    n('subtract', 'thick', 540, 520, { b: 0.05, ...note('Ring SDF is a line; subtracting a width gives it thickness.') }, { a: ['ring', 'distance'] }),
    n('noiseFloat', 'hash', 300, 740, { mode: 'hash', scale: 1, speed: 0 }, { uv: ['cell', 'cellID'] }),
    n('palette', 'pal', 540, 740, { preset: '1', scale: 1 }, { value: ['hash', 'value'] }),
    n('gridPattern', 'gp', 820, 260, {
      columns: 7, pattern: 'all', jitter: 0.25, affect: 'push', affectRadius: 0.9, affectSoftness: 0.8, affectAmount: 0.45,
      overflow: 'neighbours', antialias: 0.012, background: BG,
      ...note('Overflow: Neighbours. Each pixel also draws the rings of the eight cells around it, each moved by its own jitter and push, so rings cross cell borders whole. Overlaps stack the same way on both sides of a border.'),
    }, { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'], shape: ['thick', 'result'], picture: ['pal', 'color'] }),
    out(['gp', 'color'], 1100),
  ], playRecord([
    ctl('jit', 'gp::jitter', 'Jitter', 0, 0.5, 0.01),
    ctl('ring', 'ring::radius', 'Ring radius', 0.1, 0.9, 0.005),
    ctl('width', 'thick::b', 'Ring width', 0.005, 0.2, 0.001),
    ctl('push', 'gp::affectAmount', 'Push', 0, 2, 0.01),
  ], `**What it shows.** Shapes that don't fit in their cells. The rings are wider than a cell, jittered, and pushed away from the mouse, yet each one stays whole: with **Overflow** on Neighbours, Grid Pattern draws the rings of the surrounding cells too, each in that cell's own frame. An LFO in Play breathes the jitter so the rings drift over one another.

**How it is built.** Ring SDF (radius 0.56) → Subtract 0.05 (thickness) → Grid Pattern Shape. Cell → Noise Float (Hash) → Palette → Grid Pattern Picture for a colour per ring. Grid Pattern: Jitter 0.25, Affect Push, Overflow Neighbours.

**Try.** Set Overflow to Clip: the rings are cut into squares at their cell edges. Raise Ring radius past 0.9 and Jitter to 0.5, then set Overflow to Far (5×5): slower, but nothing is cut. Far also matters if you raise Push past 0.6. Swap Push for Pull and wave the mouse.`,
  [map('m-jit', 'jit', lfo(0.07, 'triangle'), 0.05, 0.45)]));

  // ── 7 · An Array in every cell ────────────────────────────────────────────
  add('gridTourArrayInCells', [
    time(40, 700),
    n('fieldCell', 'gcell', 40, 460, { label: 'Grid cell', ...note('This Cell node feeds the Array’s Count, outside the Array’s own Shape chain, so it is Grid Pattern’s cell.') }),
    n('noiseFloat', 'count', 300, 460, { mode: 'hash', scale: 1, speed: 0, outMin: 3, outMax: 9,
      ...note('3 to 9 dots, a different number per grid cell.') }, { uv: ['gcell', 'cellID'] }),
    n('multiply', 'spin', 300, 700, { b: 0.6 }, { a: ['time', 'time'] }),
    n('fieldCell', 'dcell', 40, 180, { label: 'Dot', ...note('This Cell node is inside the chain wired into the Array’s Shape, so it is the Array’s copy: Index 0, 1, 2… around the ring.') }),
    n('remap', 'grow', 300, 180, { inMin: 0, inMax: 8, outMin: 0.035, outMax: 0.09 }, { value: ['dcell', 'index'] }),
    n('circleSDF', 'dot', 560, 180, {}, { radius: ['grow', 'result'] }),
    n('arrayField', 'arr', 820, 300, { layout: 'ring', count: 6, radius: 0.3, combine: 'min', background: BG,
      ...note('A ring of dots. Its UV is unwired, and because the Array is itself wired into Grid Pattern’s Shape, that UV is the grid cell’s coordinates: one ring per cell.') },
      { shape: ['dot', 'distance'], count: ['count', 'value'], rotation: ['spin', 'result'] }),
    n('palette', 'pal', 820, 620, { preset: '1', scale: 0.12 }, { value: ['count', 'value'] }),
    n('gridPattern', 'gp', 1100, 300, { columns: 7, pattern: 'all', affect: 'none', background: BG },
      { shape: ['arr', 'distance'], picture: ['pal', 'color'] }),
    out(['gp', 'color'], 1360),
  ], playRecord([
    ctl('ring', 'arr::radius', 'Ring radius', 0.05, 0.45, 0.005),
    ctl('most', 'count::outMax', 'Most dots', 3, 16, 0.1),
    ctl('spin', 'spin::b', 'Spin speed', -3, 3, 0.01),
    ctl('big', 'grow::outMax', 'Biggest dot', 0.01, 0.15, 0.001),
  ], `**What it shows.** Field sockets inside field sockets. The Array node makes a ring of dots from a Circle SDF wired into its Shape; the Array's Distance is wired into Grid Pattern's Shape, so every grid cell holds its own ring. Two Cell nodes read two different things: **Grid cell** (feeding the Array's Count) is Grid Pattern's cell, so each cell gets its own number of dots; **Dot** (inside the Array's Shape chain) is the Array's copy, so the dots grow around each ring.

**How it is built.** Dot (Index) → Remap → Circle SDF's Radius → Array Shape (Ring). Grid cell (Cell ID) → Noise Float (Hash, 3–9) → Array Count and → Palette → Grid Pattern Picture. Time × 0.6 → Array Rotation. Array Distance → Grid Pattern Shape.

**Try.** Set the Array's Layout to Grid for a little grid in every cell. Set Combine to Smooth union. Give Grid Pattern Affect Grow and a Mouse: whole rings grow near it.`));

  // ── 8 · The Array as the grid ─────────────────────────────────────────────
  add('gridTourArrayBlobs', [
    time(40, 520),
    n('fieldCell', 'cell', 40, 260, { ...note('Inside the Array’s Shape chain, Index is which dot this is (0…35).') }),
    n('multiply', 'offset', 280, 260, { b: 0.35, ...note('Index × 0.35: each dot a little later in the wave than the one before.') }, { a: ['cell', 'index'] }),
    n('add', 'clock', 520, 360, {}, { a: ['offset', 'result'], b: ['time', 'time'] }),
    n('sin', 'wave', 760, 360, { freq: 1.4 }, { input: ['clock', 'result'] }),
    n('remap', 'rad', 1000, 360, { inMin: -1, inMax: 1, outMin: 0.03, outMax: 0.11 }, { value: ['wave', 'output'] }),
    n('circleSDF', 'dot', 1240, 260, {}, { radius: ['rad', 'result'] }),
    n('palette', 'pal', 1240, 500, { preset: '1', scale: 1, __inExpr_value: 'input / 36.0' }, { value: ['cell', 'index'] }),
    n('arrayField', 'arr', 1500, 300, {
      layout: 'grid', count: 36, cols: 6, spacingX: 0.2, spacingY: 0.2, combine: 'smin', smoothK: 0.06, antialias: 0.006, background: BG,
      ...note('Layout Grid: 36 copies, 6 per row. Combine Smooth union melts neighbours together wherever they come within Smoothness of each other.'),
    }, { shape: ['dot', 'distance'], picture: ['pal', 'color'] }),
    out(['arr', 'color'], 1780),
  ], playRecord([
    ctl('melt', 'arr::smoothK', 'Melt', 0.001, 0.2, 0.001),
    ctl('spacing', 'arr::spacingX', 'Spacing', 0.08, 0.4, 0.005),
    ctl('rows', 'arr::spacingY', 'Row spacing', 0.08, 0.4, 0.005),
    ctl('speed', 'wave::freq', 'Wave', 0, 4, 0.01),
  ], `**What it shows.** The Array node as a grid builder. Grid Pattern fills the whole canvas; the Array makes an exact number of copies (36, 6 per row) where you put them, and can melt them together. Each dot's size follows a wave over its Index, so a pulse runs through the block row by row, and Smooth union turns touching dots into blobs. An LFO in Play slowly changes the Melt.

**How it is built.** Cell (Index) × 0.35 + Time → Sin → Remap (0.03–0.11) → Circle SDF's Radius → Array Shape. Cell (Index) → Palette (input / 36) → Array Picture. Array: Layout Grid, Count 36, Columns 6, Combine Smooth union.

**Try.** Change Layout to Ring or Line. Set Combine to Union to see the dots separately, then back to Smooth union and raise Melt. Turn on Turn copies and wire Time into Rotation.`,
  [map('m-melt', 'melt', lfo(0.06), 0.02, 0.12)]));

  return graphs;
}
