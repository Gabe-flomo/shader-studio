/**
 * boundsExamples.ts — Bounds (docs/bounds-node.md): a grid of copies, each a ball that wanders off by a
 * straight drift and a noise wobble, kept in its box by Bounds' Bounce. Listed in the Grid folder.
 * Built from the node definitions (graphBuilder.ts); every node carries a note.
 */
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, nv, play } from './graphBuilder';
import { note } from './agentExampleKit';

export const BOUNDS_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  boundsBouncingCopies: {
    label: 'Grid · Bounds: copies bouncing in their boxes', play: true,
    description: 'A grid of copies, each a ball drifting its own way with a noise wobble. Left alone they would wander off; Bounds (Behaviour Bounce) keeps every one inside its box, ping-ponging off the walls, and its Direction flips the ball\'s shade at each wall. The wall lights up next to the ball as it bounces. Try Clip, Wrap and Soft on the Bounds card.',
  },
};
export const BOUNDS_EXAMPLE_KEYS = Object.keys(BOUNDS_EXAMPLE_INDEX);

export function buildBoundsExamples(): Record<string, ExampleGraph> {
  return {
    boundsBouncingCopies: {
      ...BOUNDS_EXAMPLE_INDEX.boundsBouncingCopies,
      counter: 40,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture; the Grid cuts it into cells.'])),
        n('gridLayout', 'grid', 300, 260, { columns: 6, ...note(['Grid: 6 columns of square cells. Cell UV is the pixel\'s place inside its cell (−0.5 to 0.5 each way); Cell ID numbers the cell, so every copy can be different.']) }, { uv: ['uv', 'uv'] }),
        n('time', 'clock', 40, 620, note(['Time: seconds since the start. The drift grows with it, so without Bounds the balls would leave for good.'])),
        n('randomFromId', 'rnd', 600, 60, { from: 0, to: 6.2832, ...note(['Random (from ID): a steady random number per cell, from its Cell ID, from 0 to a full turn (6.28): the direction this cell\'s ball drifts. Its Random colour output picks the ball\'s colour below.']) }, { id2: ['grid', 'cellID'] }),
        n('noiseFloat', 'nx', 600, 360, { scale: 0.37, speed: 0.4, mode: 'perlin', outMin: -0.6, outMax: 0.6, ...note(['Noise Float: a slow wobble for X, up to 0.6 either way, read at the Cell ID so each cell wobbles its own way.']) }, { uv: ['grid', 'cellID'], time: ['clock', 'time'] }),
        n('noiseFloat', 'ny', 600, 620, { scale: 0.37, speed: 0.4, mode: 'perlin', outMin: -0.6, outMax: 0.6, ...note(['Noise Float: the wobble for Y, read at the Cell Center (a different place from the X one), so X and Y wobble apart.']) }, { uv: ['grid', 'cellCenter'], time: ['clock', 'time'] }),
        n('constant', 'speed', 600, 880, { label: 'Speed', value: 0.35, ...note(['Speed: how far each ball drifts in a second, in cells. A Play control.']) }),
        n('angleToVec2', 'heading', 900, 60, { ...note(['Angle → Vec2: the random direction as a step of length 1 that way.']) }, { angle: ['rnd', 'value'] }),
        n('multiply', 'travel', 900, 880, { outputType: 'float', ...note(['Multiply: Speed × Time, how far the ball has drifted so far. It grows without end, so without Bounds the ball would leave for good.']) }, { a: ['speed', 'value'], b: ['clock', 'time'] }),
        nv('vec2', 'multiply', 'drift', 1140, 60, { ...note(['Multiply: the direction × the distance travelled: the straight drift.']) }, { a: ['heading', 'result'], b: ['travel', 'result'] }),
        n('makeVec2', 'wobble', 900, 480, { ...note(['Make Vec2: the two noises as one wobble.']) }, { x: ['nx', 'value'], y: ['ny', 'value'] }),
        nv('vec2', 'add', 'wander', 1380, 360, { ...note(['Add: drift + wobble, where this cell\'s ball would be with nothing to stop it (in Cell UV units). It leaves the cell within a second or two.']) }, { a: ['drift', 'result'], b: ['wobble', 'xy'] }),
        n('bounds', 'box', 1620, 360, {
          outputType: 'vec2', behaviour: 'bounce', minX: -0.36, maxX: 0.36, minY: -0.36, maxY: 0.36,
          ...note([
            'Bounds, Behaviour Bounce: keeps the wandering position inside a box from −0.36 to 0.36 each way (the wall at 0.46 less the ball\'s radius 0.1), sending it back and forth between the walls like a ball, however far Wander has gone.',
            'Value is the kept position; Direction is +1 or −1 per axis (−1 on the way back). Inside (unused here) is 1 only while Wander is still inside the box, the first second or so.',
            'Switch Behaviour to Wrap (out one side, in the other), Clip (stuck at the wall) or Soft (eases to the wall).',
          ]),
        }, { value: ['wander', 'result'] }),
        // ── Draw: the wall and the ball, from distances ──
        n('boxSDF', 'wallBox', 1620, 900, { width: 0.46, height: 0.46, ...note(['Box SDF: the square wall of each cell, 0.46 from its middle.']) }, { position: ['grid', 'cellUV'] }),
        n('circleSDF', 'ball', 1860, 620, { radius: 0.1, ...note(['Circle SDF: the ball, radius 0.1, at the kept position (Center from Bounds).']) }, { position: ['grid', 'cellUV'], offset: ['box', 'value'] }),
        n('palette', 'tint', 1860, 60, { preset: 'custom', offset: [0.55, 0.55, 0.55], amplitude: [0.45, 0.45, 0.45], freq: [1, 1, 1], phase: [0, 0.33, 0.67], ...note(['Palette: a bright colour per cell from its random number (a rainbow cosine palette).']) }, { value: ['rnd', 'value'] }),
        n('light', 'near', 2100, 860, { mode: 'glow', brightness: 18, ...note(['SDF Glow on the ball\'s distance: 1 at the ball, fading out over about a tenth of the cell. Tinted with the ball\'s colour, it is how much the wall lights up where the ball bounces.']) }, { distance: ['ball', 'distance'], tint: ['tint', 'color'] }),
        n('colorPicker', 'wallGrey', 2100, 1080, { color: [0.3, 0.34, 0.42], ...note(['Colour: the wall\'s own blue-grey.']) }),
        n('addColor', 'wallCol', 2340, 960, { ...note(['Add Colours: the wall\'s grey plus the ball\'s light on it.']) }, { a: ['wallGrey', 'rgb'], b: ['near', 'tinted'] }),
        n('sdfFill', 'walls', 2580, 700, { fillColor: [0.03, 0.035, 0.05], strokeWidth: 0.012, ...note(['SDF Fill on the wall\'s distance: the inside of the cell a dark ground, and a thin Stroke (0.012) on the wall in the wall colour.']) }, { d: ['wallBox', 'distance'], strokeColor: ['wallCol', 'result'] }),
        n('splitVec2', 'dir', 1860, 360, { ...note(['Split Vec2: the bounce direction in X and Y (each +1 or −1).']) }, { v: ['box', 'direction'] }),
        n('multiply', 'flipXY', 2100, 360, { outputType: 'float', ...note(['Multiply: X × Y, +1 or −1: it changes sign every time the ball bounces off a wall.']) }, { a: ['dir', 'x'], b: ['dir', 'y'] }),
        n('remap', 'shade', 2340, 360, { inMin: -1, inMax: 1, outMin: 0.55, outMax: 1, ...note(['Remap: −1…1 to 0.55…1, the ball\'s shade, so it dims and brightens at each bounce.']) }, { value: ['flipXY', 'result'] }),
        nv('vec3', 'multiply', 'ballCol', 2580, 300, { ...note(['Multiply: the ball\'s colour × its shade.']) }, { a: ['tint', 'color'], b: ['shade', 'result'] }),
        n('sdfFill', 'draw', 2820, 520, { ...note(['SDF Fill on the ball\'s distance: the ball in its colour, over the walls.']) }, { d: ['ball', 'distance'], fillColor: ['ballCol', 'result'], background: ['walls', 'result'] }),
        n('output', 'out', 3060, 520, note(['Output: a grid of balls, each bouncing round its own box.']), { color: ['draw', 'result'] }),
      ],
      play: play([
        ctl('speed', 'speed::value', 'Speed (cells a second)', 0, 2, 0.01),
        ctl('wall', 'box::maxX', 'Box right edge', -0.36, 0.36, 0.01),
      ], `**What it shows.** Bounds keeps a position inside a box. Every cell's ball drifts away for ever (Wander), and Bounds' **Bounce** folds that endless path back into the box, so the balls ping-pong off the walls. **Direction** (−1 on the way back) flips each ball's shade at a wall. **Inside** (not used here) says whether the unbounded position is still in the box.

**How it is built.** UV → Grid (Cell UV, Cell ID). Random (from ID) picks each cell's direction (Angle → Vec2), times Speed × Time is the drift; two Noise Floats add a wobble; Add gives where the ball would wander → Bounds (vec2, Bounce). Then it is drawn from distances: a Circle SDF at the kept position and a Box SDF wall, painted by two SDF Fills, with SDF Glow lighting the wall in the ball's colour and Direction (X × Y) flipping its shade.

**Try.** On the Bounds card set Behaviour to **Wrap** (out one side, in the other), **Clip** (they pile up at the walls) or **Soft** (they slow into the walls). Narrow the box with *Box right edge*. Raise *Speed* for frantic bouncing.`),
    },
  };
}
