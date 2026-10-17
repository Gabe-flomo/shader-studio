/**
 * boundsExamples.ts — Bounds (docs/bounds-node.md): a grid of copies, each a ball that wanders off by a
 * straight drift and a noise wobble, kept in its box by Bounds' Bounce. Listed in the Grid folder.
 * Built from the node definitions (graphBuilder.ts); every node carries a note.
 */
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, play } from './graphBuilder';
import { expr, note } from './agentExampleKit';

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
        n('randomFromId', 'rnd', 600, 60, note(['Random (from ID): three steady random numbers per cell (Random colour), from its Cell ID: where the ball starts, which way it drifts, and its colour.']), { id2: ['grid', 'cellID'] }),
        n('noiseFloat', 'nx', 600, 360, { scale: 0.37, speed: 0.4, mode: 'perlin', outMin: -1, outMax: 1, ...note(['Noise Float: a slow wobble for X, read at the Cell ID so each cell wobbles its own way.']) }, { uv: ['grid', 'cellID'], time: ['clock', 'time'] }),
        n('noiseFloat', 'ny', 600, 620, { scale: 0.37, speed: 0.4, mode: 'perlin', outMin: -1, outMax: 1, ...note(['Noise Float: the wobble for Y, read at the Cell Center (a different place from the X one), so X and Y wobble apart.']) }, { uv: ['grid', 'cellCenter'], time: ['clock', 'time'] }),
        n('constant', 'speed', 600, 880, { label: 'Speed', value: 0.35, ...note(['Speed: how far each ball drifts in a second, in cells. A Play control.']) }),
        expr('wander', 900, 360, {
          label: 'Wander', outputType: 'vec2',
          inputs: [{ name: 'r', type: 'vec3' }, { name: 't', type: 'float' }, { name: 'nx', type: 'float' }, { name: 'ny', type: 'float' }, { name: 'speed', type: 'float' }],
          wires: { r: ['rnd', 'colour'], t: ['clock', 'time'], nx: ['nx', 'value'], ny: ['ny', 'value'], speed: ['speed', 'value'] },
          lines: [
            ['vec2 start', '(r.xy - 0.5) * 0.5'],
            ['float ang', 'r.z * 6.2831853'],
            ['vec2 drift', 'vec2(cos(ang), sin(ang)) * speed * t'],
            ['vec2 wobble', 'vec2(nx, ny) * 0.6'],
          ],
          result: 'start + drift + wobble',
          note: [
            'Wander: where this cell\'s ball would be with nothing to stop it, in Cell UV units.',
            'start: a random place near the middle of the cell. ang: a random direction (0 to a full turn).',
            'drift: straight along that direction at Speed, for Time seconds, so it grows without end.',
            'wobble: the two noises, up to 0.6 either way. The sum leaves the cell within a second or two.',
          ],
        }),
        n('bounds', 'box', 1200, 360, {
          outputType: 'vec2', behaviour: 'bounce', minX: -0.36, maxX: 0.36, minY: -0.36, maxY: 0.36,
          ...note([
            'Bounds, Behaviour Bounce: keeps the wandering position inside a box from −0.36 to 0.36 each way (the wall at 0.46 less the ball\'s radius 0.1), sending it back and forth between the walls like a ball, however far Wander has gone.',
            'Value is the kept position; Direction is +1 or −1 per axis (−1 on the way back). Inside (unused here) is 1 only while Wander is still inside the box, the first second or so.',
            'Switch Behaviour to Wrap (out one side, in the other), Clip (stuck at the wall) or Soft (eases to the wall).',
          ]),
        }, { value: ['wander', 'result'] }),
        expr('draw', 1500, 260, {
          label: 'Draw', outputType: 'vec3',
          inputs: [{ name: 'p', type: 'vec2' }, { name: 'c', type: 'vec2' }, { name: 'd', type: 'vec2' }, { name: 'r', type: 'vec3' }],
          wires: { p: ['grid', 'cellUV'], c: ['box', 'value'], d: ['box', 'direction'], r: ['rnd', 'colour'] },
          lines: [
            ['float ball', 'length(p - c) - 0.1'],
            ['vec2 q', 'abs(p) - 0.46'],
            ['float wall', 'abs(max(q.x, q.y))'],
            ['vec3 tint', '0.55 + 0.45 * cos(6.2831853 * (r.x + vec3(0.0, 0.33, 0.67)))'],
            ['float flip', '0.5 + 0.5 * d.x * d.y'],
            ['vec3 col', 'vec3(0.03, 0.035, 0.05)'],
            ['float near', 'exp(-max(ball, 0.0) * 18.0)'],
            ['col', 'mix(col, mix(vec3(0.3, 0.34, 0.42), tint, near), 1.0 - smoothstep(0.0, 0.012, wall))'],
            ['col', 'mix(col, tint * (0.55 + 0.45 * flip), 1.0 - smoothstep(-0.006, 0.006, ball))'],
          ],
          result: 'col',
          note: [
            'Draw: the box and the ball in each cell.',
            'ball: the distance to a ball of radius 0.1 at the kept position c (negative inside it).',
            'q, wall: the distance to the square wall at 0.46 from the cell\'s middle.',
            'tint: a colour per cell from its random number. flip: 1 or 0 from Direction (X × Y), so the ball\'s shade changes each time it bounces off a wall.',
            'near: 1 at the ball, fading with distance, so the wall lights up in the ball\'s colour where it bounces. col: a dark ground, the wall, then the ball on top.',
          ],
        }),
        n('output', 'out', 1800, 260, note(['Output: a grid of balls, each bouncing round its own box.']), { color: ['draw', 'result'] }),
      ],
      play: play([
        ctl('speed', 'speed::value', 'Speed (cells a second)', 0, 2, 0.01),
        ctl('wall', 'box::maxX', 'Box right edge', -0.36, 0.36, 0.01),
      ], `**What it shows.** Bounds keeps a position inside a box. Every cell's ball drifts away for ever (Wander), and Bounds' **Bounce** folds that endless path back into the box, so the balls ping-pong off the walls. **Direction** (−1 on the way back) flips each ball's shade at a wall. **Inside** (not used here) says whether the unbounded position is still in the box.

**How it is built.** UV → Grid (Cell UV, Cell ID). Random (from ID) and two Noise Floats make a per-cell drift and wobble (Wander) → Bounds (vec2, Bounce) → Draw: a ball at the kept position and the square wall.

**Try.** On the Bounds card set Behaviour to **Wrap** (out one side, in the other), **Clip** (they pile up at the walls) or **Soft** (they slow into the walls). Narrow the box with *Box right edge*. Raise *Speed* for frantic bouncing.`),
    },
  };
}
