/**
 * matrixExamples.ts — the Matrices folder (Matrix 1 … Matrix 8), built from
 * the node definitions (graphBuilder.ts). See docs/matrices.md.
 *
 *   1  what a matrix does to space (edit the four numbers)
 *   2  combine and undo: place a shape with Rotation × Stretch × Scale and its inverse
 *   3  lattices: hexagon, brick and triangle grids are basis matrices
 *   4  a grid with any basis (matrix nodes into Grid Pattern's Basis)
 *   5  fold, rotate, scale: a fractal from one matrix in a loop
 *   6  corner pin: a 3×3 matrix puts a picture on a tilted card
 *   7  rotated noise octaves: powers of one matrix
 *   8  colour matrices: hue, saturation and a sepia matrix blended
 *
 * Each example carries Play notes and comments on the nodes that matter.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import type { PlayControl, PlayMapping, PlayRecord, PlaySource } from '../types/play';
import { ctl, group, n, out, port, time, uv } from './graphBuilder';

export const MATRIX_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  matrixWhatItDoes: {
    label: 'Matrix 1 · What a matrix does to space', play: true,
    description: 'A 2×2 Matrix Const multiplies the UV before Grid Pattern reads it, so its four numbers stretch, shear, turn and mirror the whole pattern. Each number is a Play slider. The first column says where the X axis goes, the second where Y goes.',
  },
  matrixCombineUndo: {
    label: 'Matrix 2 · Combine and undo: place a shape', play: true,
    description: 'Rotation × Stretch × Scale combined into one matrix, then inverted to draw a star transformed by it: to move a shape by M, move the space by M⁻¹. The determinant corrects the outline width for the scale part of M.',
  },
  matrixLattices: {
    label: 'Matrix 3 · Lattices: hexagons, bricks, triangles', play: true,
    description: 'Grid Pattern’s Lattice setting: a honeycomb of hexagons, each a Shape SDF wired into the Shape socket, coloured per cell. Every lattice is a basis matrix (the two steps between neighbouring cells); switch to Brick, Diamonds or Triangles on the card.',
  },
  matrixAnyBasis: {
    label: 'Matrix 4 · A grid with any basis', play: true,
    description: 'Rotation × Shear × Scale wired into Grid Pattern’s Basis (Lattice: Custom): the matrix is the grid. An LFO sweeps the shear, so the dots slide from a square grid through brick to diamond while the lattice slowly turns.',
  },
  matrixFoldFractal: {
    label: 'Matrix 5 · Fold, rotate, scale: a fractal from one matrix', play: true,
    description: 'An iterated group repeats three steps seven times: fold the space into one quadrant (abs), turn it with a Rotation Matrix, scale it up. Each pass adds a glowing ring, and the folds multiply them into a kaleidoscopic fractal. One matrix angle reshapes the whole thing.',
  },
  matrixCornerPin: {
    label: 'Matrix 6 · Corner pin: a picture on a tilted card', play: true,
    description: 'Corner Pin builds a 3×3 projective matrix that maps a square onto any four corners and runs the canvas through its inverse, so a Grid Pattern drawn in its UV looks printed on a card seen in perspective. Two slow LFOs sway two of the corners.',
  },
  matrixNoiseOctaves: {
    label: 'Matrix 7 · Rotated noise octaves', play: true,
    description: 'FBM built by hand from four noise octaves, each read through one more power of a Rotation × Scale matrix (A, A², A³). Turning each octave hides the grid that value noise is built on; set Octave turn to 0 to see it come back.',
  },
  matrixColor: {
    label: 'Matrix 8 · Colour matrices', play: true,
    description: 'A colour grade is a 3×3 matrix on RGB. Colour Matrix builds hue rotation, saturation and gain; a Matrix Const holds the classic sepia matrix; Mat3 Mix blends the two and Mat3 × Vec3 applies the result to an FBM picture. An LFO turns the hue.',
  },
};

export const MATRIX_EXAMPLE_KEYS = Object.keys(MATRIX_EXAMPLE_INDEX);

// ── Helpers ─────────────────────────────────────────────────────────────────

const note = (text: string) => ({ __comment: text });
const map = (id: string, controlId: string, source: PlaySource, outMin: number, outMax: number): PlayMapping =>
  ({ id, controlId, source, outMin, outMax, curve: 'linear', smoothMs: 0, enabled: true });
const lfo = (rate: number, shape: 'sine' | 'triangle' | 'saw' = 'sine'): PlaySource => ({ kind: 'lfo', shape, rate, phase: 0 });
const playRecord = (controls: PlayControl[], notes: string, mappings: PlayMapping[] = []): PlayRecord =>
  ({ version: 1, controls, mappings, layers: [], notes });

/** An arithmetic node switched to vec2 (the type pill on the card): both operands and the result. */
function vec2Op(node: GraphNode): GraphNode {
  const inputs = Object.fromEntries(Object.entries(node.inputs).map(([k, s]) => [k, k === 'a' || k === 'b' ? { ...s, type: 'vec2' as const } : s]));
  return { ...node, inputs, outputs: { result: { ...node.outputs.result, type: 'vec2' } }, params: { ...node.params, outputType: 'vec2' } };
}

/** A 2×2 Matrix Const: the card switches its output socket to mat2 when Size is 2 × 2; a built graph has to say so itself. */
function mat2Const(node: GraphNode): GraphNode {
  return { ...node, outputs: { mat: { ...node.outputs.mat, type: 'mat2' } } };
}

const BG: [number, number, number] = [0.045, 0.045, 0.075];

export function buildMatrixExamples(): Record<string, ExampleGraph> {
  const graphs: Record<string, ExampleGraph> = {};
  const add = (key: string, nodes: GraphNode[], play: PlayRecord) => {
    graphs[key] = { ...MATRIX_EXAMPLE_INDEX[key], counter: 60, nodes, play };
  };

  // ── 1 · What a matrix does ────────────────────────────────────────────────
  add('matrixWhatItDoes', [
    uv(),
    mat2Const(n('matConst', 'm', 40, 420, { size: 'mat2', m00: 1, m01: 0.5, m10: 0, m11: 1,
      ...note('A 2×2 matrix is four numbers. Column 1 (m00, m10) is where the X axis lands, column 2 (m01, m11) where Y lands. Identity is 1, 0 / 0, 1. This one is a shear: Y leans over by 0.5.') })),
    n('mat2MulVec', 'apply', 320, 260, { ...note('Matrix × UV: every point of the canvas is moved before the pattern is read, so the whole pattern is transformed at once.') },
      { mat: ['m', 'mat'], vec: ['uv', 'uv'] }),
    n('gridPattern', 'gp', 600, 220, { columns: 6, shape: 'cross', size: 0.32, pattern: 'checker', affect: 'none', color: [0.98, 0.72, 0.36], background: BG },
      { uv: ['apply', 'output'] }),
    out(['gp', 'color'], 880),
  ], playRecord([
    ctl('a', 'm::m00', 'm00 (X → x)', -2, 2, 0.01),
    ctl('b', 'm::m01', 'm01 (Y → x)', -2, 2, 0.01),
    ctl('c', 'm::m10', 'm10 (X → y)', -2, 2, 0.01),
    ctl('d', 'm::m11', 'm11 (Y → y)', -2, 2, 0.01),
  ], `**What it shows.** What the four numbers of a 2×2 matrix do. The matrix multiplies the UV before Grid Pattern reads it, so every point is moved and the whole pattern changes at once. The first column (m00, m10) is where the X axis goes; the second (m01, m11) is where Y goes. This one starts as a shear.

**How it is built.** UV → Mat2 × Vec2 (with a 2×2 Matrix Const) → Grid Pattern's UV → Output. The four entries are Play sliders.

**Try.** m00 = 2: the pattern gets *narrower*, not wider. The matrix moves the space the pattern is read from, so the picture moves the opposite way (Matrix 2 undoes that with the inverse). m00 = −1 mirrors. m00 = m11 = 0.7, m01 = −0.7, m10 = 0.7 is a 45° turn. m11 = 0 flattens everything to a line: the determinant is 0.`));

  // ── 2 · Combine and undo ──────────────────────────────────────────────────
  add('matrixCombineUndo', [
    uv(),
    time(40, 700),
    n('multiply', 'spin', 260, 700, { b: 0.4 }, { a: ['time', 'time'] }),
    n('rotationMatrix', 'rot', 260, 460, {}, { angle: ['spin', 'result'] }),
    n('stretchMatrix', 'st', 260, 220, { angle: 0, amount: 1.8, keepArea: true, ...note('Stretch along an angle: turn the direction onto X, scale, turn back.') }),
    n('scaleMatrix', 'sc', 260, 20, { x: 1.2, y: 1.2 }),
    n('mat2Mul', 'rs', 520, 340, { ...note('A × B does B first: stretch, then turn.') }, { a: ['rot', 'mat2'], b: ['st', 'mat'] }),
    n('mat2Mul', 'm', 760, 200, { ...note('M = Rotation × Stretch × Scale: three transforms, one matrix.') }, { a: ['rs', 'mat'], b: ['sc', 'mat'] }),
    n('mat2Inverse', 'inv', 1000, 200, { ...note('To draw a shape moved by M, read the space through M⁻¹. The determinant is how much M scales area.') }, { mat: ['m', 'mat'] }),
    n('mat2MulVec', 'apply', 1240, 120, {}, { mat: ['inv', 'inverse'], vec: ['uv', 'uv'] }),
    n('shapeSDF', 'star', 1480, 120, { shape: 'starN', r: 0.4, n_pts: 5, m_pts: 2.6 }, { p: ['apply', 'output'] }),
    n('sqrt', 'len', 1240, 360, { ...note('√det: the average length scale of M.') }, { input: ['inv', 'determinant'] }),
    n('multiply', 'fix', 1720, 200, { ...note('The distance was measured in the un-transformed space; × √det brings it back to canvas units for the overall scale, so Width and Height don’t fatten or thin the outline as a whole.') }, { a: ['star', 'distance'], b: ['len', 'output'] }),
    n('colorPicker', 'ink', 1720, 420, { color: [1, 0.95, 0.85] }),
    n('palette', 'pal', 1720, 600, { preset: '1', scale: 0.5 }, { value: ['star', 'distance'] }),
    n('sdfFill', 'fill', 1960, 240, { strokeWidth: 0.025 }, { d: ['fix', 'result'], fillColor: ['pal', 'color'], strokeColor: ['ink', 'rgb'] }),
    out(['fill', 'result'], 2200),
  ], playRecord([
    ctl('amt', 'st::amount', 'Stretch', 0.2, 3, 0.01),
    ctl('dir', 'st::angle', 'Stretch angle', -3.1416, 3.1416, 0.01),
    ctl('w', 'sc::x', 'Width', 0.2, 2.5, 0.01),
    ctl('h', 'sc::y', 'Height', 0.2, 2.5, 0.01),
  ], `**What it shows.** Two things matrices are for. **Combining**: Rotation × Stretch × Scale become one matrix M, applied in one step. **Undoing**: to draw a star transformed by M, the UV is multiplied by M's inverse, because moving the space one way moves the picture the other. Mat2 Inverse also gives the **determinant** (how much M scales area); multiplying the star's distance by its square root corrects the white outline for the overall scale. A stretch still thins it along the long sides: a distance bent by a stretch is only approximate.

**How it is built.** Rotation Matrix (angle = Time × 0.4) × Stretch Matrix → × Scale Matrix = M → Mat2 Inverse → Mat2 × Vec2 on the UV → Shape SDF (Star) → × √determinant → SDF Fill.

**Try.** Swap the order of the first Mat2 × Mat2's inputs: now the stretch turns with the star instead of staying put. Wire the Mat2 Inverse's Transpose instead of Inverse: for the rotation alone it would be the same, with the stretch it isn't. Unwire the √det multiply and set Width and Height to 2.5: the outline gets thinner.`));

  // ── 3 · Lattices ──────────────────────────────────────────────────────────
  add('matrixLattices', [
    uv(),
    n('mouse', 'mouse', 40, 420),
    n('fieldCell', 'cell', 40, 640),
    n('shapeSDF', 'hex', 320, 540, { shape: 'hexagon', r: 0.4, ...note('A hexagon in every hexagonal cell. Its size is in cell units: 0.5 would touch the neighbours.') }),
    n('noiseFloat', 'hash', 320, 760, { mode: 'hash', scale: 1, speed: 0 }, { uv: ['cell', 'cellID'] }),
    n('palette', 'pal', 580, 760, { preset: '3', scale: 0.6 }, { value: ['hash', 'value'] }),
    n('gridPattern', 'gp', 860, 260, { columns: 9, lattice: 'hex', rotation: 0.5236, affect: 'shrink', affectRadius: 0.8, affectSoftness: 0.9, affectAmount: 0.7, background: BG,
      ...note('Lattice: Hexagons. Every lattice is a basis matrix: the two steps from one cell centre to its neighbours, here (1, 0) and (0.5, 0.87). Rotation 30° lines the hexagon up with its cell.') },
      { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'], shape: ['hex', 'distance'], picture: ['pal', 'color'] }),
    out(['gp', 'color'], 1140),
  ], playRecord([
    ctl('r', 'hex::r', 'Hexagon size', 0.1, 0.6, 0.005),
    ctl('rot', 'gp::rotation', 'Shape rotation', -3.1416, 3.1416, 0.01),
    ctl('rad', 'gp::affectRadius', 'Mouse radius', 0.1, 3, 0.01),
  ], `**What it shows.** Grids that aren't square. Grid Pattern's **Lattice** chooses where the cell centres sit, and every choice is a 2×2 basis matrix whose columns are the two steps from one centre to its neighbours. Each pixel belongs to its nearest centre, which turns the hexagonal lattice into a honeycomb. A hexagon SDF wired into Shape fills it; the mouse shrinks the cells near it.

**How it is built.** Shape SDF (Hexagon) → Grid Pattern Shape; Cell → Noise Float (Hash) → Palette → Picture. Grid Pattern: Lattice Hexagons, Rotation 30°, Affect Shrink.

**Try.** Switch Lattice to Brick, Diamonds or Triangles (for Triangles, unwire Shape and pick the built-in Triangle: every other cell flips upside down to fit). Raise Hexagon size to 0.5 so the cells touch. Matrix 4 builds the basis from matrix nodes instead of a preset.`));

  // ── 4 · Any basis ─────────────────────────────────────────────────────────
  add('matrixAnyBasis', [
    uv(),
    time(40, 700),
    n('multiply', 'spin', 260, 700, { b: 0.08 }, { a: ['time', 'time'] }),
    n('rotationMatrix', 'rot', 300, 460, {}, { angle: ['spin', 'result'] }),
    n('shearMatrix', 'sh', 300, 220, { x: 0.5, y: 0, ...note('Shear 0.5 turns squares into bricks; 1.0 into diamonds. An LFO sweeps it in Play.') }),
    n('scaleMatrix', 'sc', 300, 0, { x: 1.0, y: 0.8 }),
    n('mat2Mul', 'rs', 560, 340, {}, { a: ['rot', 'mat2'], b: ['sh', 'mat'] }),
    n('mat2Mul', 'basis', 800, 200, { ...note('Rotation × Shear × Scale: the columns of this matrix are the two steps between neighbouring cell centres.') }, { a: ['rs', 'mat'], b: ['sc', 'mat'] }),
    n('fieldCell', 'cell', 800, 640),
    n('noiseFloat', 'hash', 1040, 640, { mode: 'hash', scale: 1, speed: 0 }, { uv: ['cell', 'cellID'] }),
    n('palette', 'pal', 1280, 640, { preset: '1', scale: 1 }, { value: ['hash', 'value'] }),
    n('circleSDF', 'dot', 1040, 420, { radius: 0.24, ...note('Round dots, so the lattice itself is what you see changing.') }),
    n('gridPattern', 'gp', 1320, 220, { columns: 10, lattice: 'custom', affect: 'none', background: BG,
      ...note('Lattice: Custom reads the grid from the Basis input.') },
      { uv: ['uv', 'uv'], basis: ['basis', 'mat'], shape: ['dot', 'distance'], picture: ['pal', 'color'] }),
    out(['gp', 'color'], 1600),
  ], playRecord([
    ctl('shear', 'sh::x', 'Shear', -1.5, 1.5, 0.01),
    ctl('w', 'sc::x', 'Step across', 0.5, 2, 0.01),
    ctl('h', 'sc::y', 'Step up', 0.5, 2, 0.01),
    ctl('spin', 'spin::b', 'Turn speed', -1, 1, 0.01),
  ], `**What it shows.** A grid is a matrix. Rotation × Shear × Scale make one 2×2 matrix; wired into Grid Pattern's **Basis** (Lattice: Custom), its columns become the two steps from each cell centre to its neighbours. Shear slides the rows over each other (square → brick → diamond), Scale sets the spacing across and up, Rotation turns the grid. An LFO in Play sweeps the shear back and forth.

**How it is built.** Rotation Matrix (Time × 0.08) × Shear Matrix → × Scale Matrix → Grid Pattern Basis. A Circle SDF in Shape draws a round dot per cell and Cell → Hash → Palette → Picture colours each one.

**Try.** Turn the LFO off and set Shear to 0.5 with Step up 0.87: that's the hexagonal lattice from Matrix 3. Set Step up to 0.3: the cells become thin slivers. Unwire Shape: with only Picture wired, each whole cell is filled, and you see the cell shapes the basis makes.`,
  [map('m-shear', 'shear', lfo(0.05, 'triangle'), -1, 1)]));

  // ── 5 · Fold, rotate, scale ───────────────────────────────────────────────
  add('matrixFoldFractal', [
    uv(40, 300),
    group('loop', 320, 200, {
      label: 'Fold · Rotate · Scale ×7', iterations: 7,
      inputs: [{ key: 'in_uv', type: 'vec2', label: 'UV', from: ['uv', 'uv'] }],
      outputs: [{ key: 'out_color', type: 'vec3', label: 'Color', from: ['glow', 'tinted'] }],
      nodes: [
        n('loopCarry', 'carry', 60, 200, { dataType: 'vec2' }, { init: port('in_uv'), next: ['grow', 'result'] }),
        n('transformVec', 'fold', 300, 200, { exprX: 'abs(x)', exprY: 'abs(y)', ...note('Fold: abs() mirrors every quadrant onto the first, so each pass doubles the symmetry.') }, { uv: ['carry', 'value'] }),
        vec2Op(n('subtract', 'off', 540, 200, { b: 0.5, ...note('Shift the folded space, so the next fold cuts somewhere new.') }, { a: ['fold', 'result'] })),
        n('rotationMatrix', 'rot', 540, 420, { angle: 0.7 }),
        n('mat2MulVec', 'turn', 780, 200, { ...note('Turn the space with the matrix: the one angle that shapes the whole fractal.') }, { mat: ['rot', 'mat2'], vec: ['off', 'result'] }),
        vec2Op(n('multiply', 'grow', 1020, 200, { b: 1.4, ...note('Scale up, so each pass zooms into the last: the carry feeds this back into the next pass.') }, { a: ['turn', 'output'] })),
        n('length', 'len', 1260, 200, {}, { input: ['grow', 'result'] }),
        n('subtract', 'ring', 1500, 200, { b: 0.4 }, { a: ['len', 'output'] }),
        n('loopIndex', 'i', 1260, 440),
        n('multiply', 'hue', 1500, 440, { b: 0.11 }, { a: ['i', 'i'] }),
        n('palette', 'pal', 1740, 440, { preset: '1', scale: 1 }, { value: ['hue', 'result'] }),
        n('light', 'glow', 1740, 200, { mode: 'simple', brightness: 0.35, ...note('A thin glowing ring per pass, coloured by the pass number. Its assignment is += so all seven passes add up.') },
          { distance: ['ring', 'result'], tint: ['pal', 'color'] }, { assignOp: '+=' } as Partial<GraphNode>),
      ],
    }),
    n('toneMap', 'tone', 640, 300, { mode: 'aces' }, { color: ['loop', 'out_color'] }),
    out(['tone', 'color'], 900, 300),
  ], playRecord([
    ctl('ang', 'loop::rot::angle', 'Turn per pass', -3.1416, 3.1416, 0.005),
    ctl('off', 'loop::off::b', 'Fold offset', 0, 1.5, 0.005),
    ctl('grow', 'loop::grow::b', 'Zoom per pass', 0.8, 2, 0.005),
    ctl('glow', 'loop::glow::brightness', 'Glow', 0.05, 2, 0.01),
  ], `**What it shows.** The rotate-fold-scale loop behind a whole family of kaleidoscopic fractals. An iterated group runs its subgraph seven times; each pass folds the space into one quadrant with abs(), shifts it, turns it with a **Rotation Matrix**, and scales it up. A Loop Carry feeds the result into the next pass, so the folds compound. Each pass also draws a glowing ring in its own folded space, coloured by the pass number, and the seven rings add up.

**How it is built.** Inside the group: Loop Carry (vec2) → Transform Vec (abs x, abs y) → Subtract 0.5 → Mat2 × Vec2 (Rotation Matrix) → Multiply 1.4 → back into the carry. Length − 0.4 → SDF Glow (Simple, assignment +=), tinted by Palette(pass × 0.11). Tone Map after. In GLSL: \`for (i…) { p = rot * (abs(p) - 0.5) * 1.4; col += glow(length(p) - 0.4) * palette(i * 0.11); }\`.

**Try.** Drag Turn per pass slowly: small changes give completely different fractals. Set it to 0: without the matrix the folds only make a mirrored grid. Raise the group's Iterations to 10. Wire Time × 0.1 into the Rotation Matrix's angle for an animation.`));

  // ── 6 · Corner pin ────────────────────────────────────────────────────────
  add('matrixCornerPin', [
    uv(),
    n('cornerPin', 'pin', 300, 220, { x0: -0.6, y0: -0.55, x1: 0.6, y1: -0.7, x2: 0.45, y2: 0.6, x3: -0.5, y3: 0.5, ...note('Four corners → one 3×3 projective matrix (square → quad). The canvas goes through its inverse, so Centred is −1…1 across the card however it is tilted.') }, { uv: ['uv', 'uv'] }),
    n('gridPattern', 'gp', 600, 120, { columns: 3, shape: 'circle', size: 0.32, pattern: 'checker', affect: 'none', color: [0.98, 0.78, 0.4], background: [0.12, 0.2, 0.42] },
      { uv: ['pin', 'centered'] }),
    n('colorPicker', 'bg', 600, 460, { color: [0.04, 0.04, 0.06] }),
    n('mask', 'card', 900, 220, { edge: 0.004, ...note('Edge is negative inside the quad: Mask shows the pattern there and the background outside.') },
      { a: ['gp', 'color'], b: ['bg', 'rgb'], mask: ['pin', 'edge'] }),
    out(['card', 'result'], 1160),
  ], playRecord([
    ctl('x2', 'pin::x2', 'Top right X', -1.5, 1.5, 0.01),
    ctl('y2', 'pin::y2', 'Top right Y', -1, 1, 0.01),
    ctl('x3', 'pin::x3', 'Top left X', -1.5, 1.5, 0.01),
    ctl('y0', 'pin::y0', 'Bottom left Y', -1, 1, 0.01),
  ], `**What it shows.** Real perspective with a 3×3 matrix. Corner Pin finds the projective matrix that maps a unit square onto any four corners (a homography), and runs the canvas through its inverse: every pixel learns where it is on the card. Grid Pattern drawn in those coordinates looks printed on a card seen at an angle; the circles squash and shrink toward the far edge like a real photo. Two slow LFOs in Play sway the top right and bottom left corners, so the card tilts back and forth.

**How it is built.** UV → Corner Pin → Centred → Grid Pattern's UV. Corner Pin's Edge (negative inside) → Mask chooses the pattern inside the card and a dark background outside.

**Try.** Turn the LFOs off and drag the corner sliders, or map the mouse onto a corner. Cross two corners over each other: the card twists through itself. Feed Quad UV (0…1) into anything that expects texture coordinates. Corner Pin's Matrix with Mat3 × Point maps a point on the card back onto the canvas.`,
  [map('m-x2', 'x2', lfo(0.07), 0.25, 0.62), map('m-y0', 'y0', lfo(0.05, 'triangle'), -0.8, -0.4)]));

  // ── 7 · Rotated noise octaves ─────────────────────────────────────────────
  /** One octave: the base UV through a matrix (none for octave 0), a noise, a weight. */
  const octave = (i: number, x: number, y: number, from?: [string, string]) => [
    ...(from ? [n('mat2MulVec', `p${i}`, x, y, {}, { mat: from, vec: ['base', 'result'] })] : []),
    n('noiseFloat', `n${i}`, x + 240, y, { mode: 'smooth', scale: 1, speed: 0.15 }, { uv: from ? [`p${i}`, 'output'] : ['base', 'result'] }),
    n('multiply', `w${i}`, x + 480, y, { b: 0.5 ** (i + 1) }, { a: [`n${i}`, 'value'] }),
  ];
  add('matrixNoiseOctaves', [
    uv(),
    vec2Op(n('multiply', 'base', 260, 220, { b: 3 }, { a: ['uv', 'uv'] })),
    n('rotationMatrix', 'rot', 40, 520, { angle: 0.64, ...note('The turn between octaves. At 0 every octave lines up with the same grid and it shows.') }),
    n('scaleMatrix', 'sc', 40, 760, { x: 2.03, y: 2.03, ...note('Each octave twice as fine (2.03, not 2, so the octaves never line up exactly).') }),
    n('mat2Mul', 'A', 300, 640, { ...note('A = Rotation × Scale: one octave step.') }, { a: ['rot', 'mat2'], b: ['sc', 'mat'] }),
    n('mat2Mul', 'A2', 540, 760, { ...note('A² = A × A: two steps.') }, { a: ['A', 'mat'], b: ['A', 'mat'] }),
    n('mat2Mul', 'A3', 780, 880, { ...note('A³: three steps.') }, { a: ['A2', 'mat'], b: ['A', 'mat'] }),
    ...octave(0, 560, 60),
    ...octave(1, 560, 260, ['A', 'mat']),
    ...octave(2, 800, 460, ['A2', 'mat']),
    ...octave(3, 1040, 660, ['A3', 'mat']),
    n('add', 's01', 1340, 160, {}, { a: ['w0', 'result'], b: ['w1', 'result'] }),
    n('add', 's23', 1580, 560, {}, { a: ['w2', 'result'], b: ['w3', 'result'] }),
    n('add', 'fbm', 1580, 300, { ...note('Octaves weighted ½, ¼, ⅛, 1⁄16 and added: FBM.') }, { a: ['s01', 'result'], b: ['s23', 'result'] }),
    n('palette', 'pal', 1820, 300, { preset: '0', scale: 2.2 }, { value: ['fbm', 'result'] }),
    out(['pal', 'color'], 2060, 300),
  ], playRecord([
    ctl('turn', 'rot::angle', 'Octave turn', 0, 1.5708, 0.005),
    ctl('lx', 'sc::x', 'Octave scale X', 1.2, 3, 0.01),
    ctl('ly', 'sc::y', 'Octave scale Y', 1.2, 3, 0.01),
  ], `**What it shows.** Why good noise turns every octave. FBM adds copies of a noise at finer and finer scales. Value noise is built on a square grid, and if every octave uses the same grid, straight horizontal and vertical creases show through. Here each octave is read through one more power of a matrix A = Rotation × Scale, so octave k is turned by k × the angle and scaled by 2ᵏ; the creases of different octaves no longer line up.

**How it is built.** UV × 3 → Noise Float (Smooth) as it is, and through Mat2 × Vec2 with A, A² and A³ (Mat2 × Mat2 builds the powers) → Noise Float each → weighted ½, ¼, ⅛, 1⁄16 → added → Palette.

**Try.** Drag Octave turn to 0 and look for the straight lines, then back to 0.64. Make Octave scale X and Y different: the noise gets a grain, like wood. Swap the Rotation Matrix for a Shear Matrix.`));

  // ── 8 · Colour matrices ───────────────────────────────────────────────────
  add('matrixColor', [
    uv(),
    time(40, 460),
    n('fbm', 'fbm', 300, 220, { octaves: 5, scale: 2.2, time_scale: 0.15 }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
    n('palette', 'pic', 560, 220, { preset: '1', scale: 1.6 }, { value: ['fbm', 'value'] }),
    n('colorMatrix', 'grade', 300, 520, { hue: 0, saturation: 1.1, gain: 1.0, ...note('Hue turns every colour around the grey axis; Saturation pulls toward or away from grey; Gain scales it all. One 3×3 matrix.') }),
    n('matConst', 'sepia', 300, 780, {
      size: 'mat3', m00: 0.393, m01: 0.769, m02: 0.189, m10: 0.349, m11: 0.686, m12: 0.168, m20: 0.272, m21: 0.534, m22: 0.131,
      ...note('The classic sepia matrix: each row says how much of R, G and B goes into that output channel.'),
    }),
    n('mat3Mix', 'blend', 560, 620, { t: 0.0, ...note('Blend the two grades: 0 is the Colour Matrix, 1 is sepia.') }, { a: ['grade', 'mat'], b: ['sepia', 'mat'] }),
    n('mat3MulVec', 'apply', 820, 320, { ...note('Matrix × colour: the grade applied to every pixel.') }, { mat: ['blend', 'mat'], vec: ['pic', 'color'] }),
    out(['apply', 'output'], 1080),
  ], playRecord([
    ctl('sepia', 'blend::t', 'Sepia', 0, 1, 0.01),
    ctl('sat', 'grade::saturation', 'Saturation', -1, 3, 0.01),
    ctl('gain', 'grade::gain', 'Gain', 0, 2, 0.01),
    ctl('hue', 'grade::hue', 'Hue', -3.1416, 3.1416, 0.01),
  ], `**What it shows.** A colour grade is a 3×3 matrix: each output channel is a weighted sum of the input R, G and B. **Colour Matrix** builds hue rotation (turning colours around the grey axis), saturation and gain as one matrix; a Matrix Const holds the classic sepia matrix; **Mat3 Mix** blends the two grades and **Mat3 × Vec3** applies the result to every pixel. An LFO in Play turns the hue.

**How it is built.** UV → FBM → Palette (the picture). Colour Matrix and a 3×3 Matrix Const (sepia) → Mat3 Mix → Mat3 × Vec3 with the picture → Output.

**Try.** Sepia to 1, then Saturation to 0. Saturation −1 inverts the colours around grey. Put a Mat3 × Mat3 before the mix to stack two grades. Edit the Matrix Const: set m00 = 0, m02 = 1, m20 = 1, m22 = 0 (the rest identity) to swap red and blue.`,
  [map('m-hue', 'hue', lfo(0.04, 'saw'), -3.1416, 3.1416)]));

  return graphs;
}
