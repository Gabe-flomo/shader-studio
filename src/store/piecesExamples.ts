/**
 * piecesExamples.ts — Pieces and Balls (docs/pieces.md): a photo rebuilt from pieces that scatter
 * and come home (2D), and a photo as a grid of balls lifted by its brightness (3D, CC Ball Action).
 *
 * Listed in the Pictures in pieces folder. Built from the node definitions (graphBuilder.ts); the
 * photo is the bundled "ridges at dusk".
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { ctl, n, out, play } from './graphBuilder';
import { expr, note } from './agentExampleKit';
import type { ExampleGraph } from './exampleIndex';
import { PIECES_EXAMPLE_INDEX } from './piecesExampleIndex';
import RIDGES_AT_DUSK from './playAssets/ridges-at-dusk.jpg?inline';

const PHOTO = 'Texture Input: a photo (ridges at dusk, until you load your own with Load image). Video works too: the pieces read it again every frame, so it plays while it scatters.';

function scatterAndReturn(): GraphNode[] {
  return [
    n('uv', 'uv', 40, 220, note(['UV: the point being drawn.'])),
    n('time', 'time', 40, 420, note(['Time: moves the noise and the LFO.'])),
    n('textureInput', 'photo', 40, 0, { fit: 'stretch', ...note([PHOTO, 'Its Texture output is the picture the pieces are made of; its Color is the dim ghost behind them.']) }, { uv: ['uv', 'uv'] }),
    n('vectorField', 'flow', 340, 360, { mode: 'fbm', scale: 0.8, speed: 0.12, strength: 0.35, ...note([
      'Vector Field (FBM Noise): a direction at every point, turning slowly with time. Strength is how far the pieces fly (a share of the frame\'s height).',
      'It is wired into Pieces\' Offset ƒ, a field socket: Pieces reads it at each piece\'s home, so every piece gets its own direction and neighbours drift together.',
    ]) }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
    n('lfo', 'lfo', 340, 560, { waveform: 'sine', freq: 0.1, amplitude: 0.5, offset: 0.5, ...note([
      'LFO: a slow sine from 0 to 1 and back, once every 10 seconds.',
    ]) }, { time: ['time', 'time'] }),
    expr('ease', 620, 560, {
      label: 'Ease', inputs: [{ name: 'v', type: 'float' }],
      lines: [], result: 'smoothstep(0.15, 0.95, v)', outputType: 'float', wires: { v: ['lfo', 'value'] },
      note: ['Ease: the LFO through smoothstep, so it rests at 0 for a moment (the picture whole) and eases in and out of the scatter. It is Pieces\' Amount.'],
    }),
    expr('ghost', 620, 0, {
      label: 'Ghost', inputs: [{ name: 'c', type: 'vec3' }], lines: [], result: 'c * 0.12', outputType: 'vec3', wires: { c: ['photo', 'color'] },
      note: ['Ghost: the photo, very dim, behind the pieces (Pieces\' Background), so the gaps they leave read as where they came from.'],
    }),
    n('pieces', 'pieces', 900, 220, { count: 32, size: 1.0, shape: 'circle', colourMode: 'flat', order: 'moved', ...note([
      'Pieces: the photo rebuilt from 32 circles across. Each takes the photo\'s colour at its home (the centre of its cell) and is drawn at home + Offset × Amount.',
      'Offset ƒ is the noise field read at each home; Amount is the eased LFO, so the picture scatters and flows back together. Pieces moved furthest are drawn on top.',
      'Try: Shape Hexagon with Stagger 1; Colour: Piece (each carries its bit of the photo); Size by Brightness with Min size 0 for a halftone that scatters.',
    ]) }, { uv: ['uv', 'uv'], picture: ['photo', 'texture'], offset: ['flow', 'dir'], amount: ['ease', 'result'], background: ['ghost', 'result'] }),
    out(['pieces', 'color'], 1200),
  ];
}

const sub = (nodes: GraphNode[], inputPorts: SubgraphData['inputPorts'] = []): SubgraphData => ({ nodes, inputPorts, outputPorts: [] });
const BG: [number, number, number] = [0.02, 0.025, 0.04];

/** A picture as balls: Repeat Scene's copies, one Balls each; after the loop, the ball each ray hit gives its colour. */
export function ballsGraph(o: { across: number; aspect: number; cell: number; lift: number; liftBy: string; wave: number }): GraphNode[] {
  const half = Math.floor(o.across / 2);
  const rows = Math.max(0, Math.floor(o.across / o.aspect / 2));
  const ball = n('sceneGroup', 'balls', 40, 480, {
    label: 'One ball', ...note(['One ball of the picture, measured once per copy by Repeat Scene. The picture comes in through the group\'s Picture port.']),
    subgraph: sub([
      n('scenePos', 'sp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured, already moved into this copy\'s cell by Repeat Scene.']) }),
      n('repeatCell', 'cell', 0, 420, note(['Repeat Cell: which copy this is. Its Centre is where the copy sits in the world.'])),
      n('time', 'btime', 0, 600, note(['Time: rolls the wave.'])),
      expr('wave', 300, 460, {
        label: 'Wave', inputs: [{ name: 'c', type: 'vec3' }, { name: 't', type: 'float' }, { name: 'amp', type: 'float', slider: { min: 0, max: 2 } }], values: { amp: o.wave },
        lines: [], result: 'vec3(0.0, 0.0, amp * sin(length(c.xy) * 1.6 - t * 2.0))', outputType: 'vec3', wires: { c: ['cell', 'centre'], t: ['btime', 'time'] },
        note: ['Wave: a ring rolling out from the middle, moving each ball along Z by its distance from the centre (Repeat Cell\'s Centre), so every ball moves its own way. It is Balls\' Displace: wire any vec3 here (noise of the Centre scatters them).'],
      }),
      n('pieceBalls', 'ball', 600, 200, { count: half * 2 + 1, aspect: o.aspect, lift: o.lift, liftBy: o.liftBy, size: 0.92, ...note([
        `Balls: this copy's ball. It reads the picture at its cell's centre (the picture spans ${half * 2 + 1} copies across), is lifted towards the camera by the ${o.liftBy} there (Lift), and moved by the Wave.`,
      ]) }, { pos: ['sp', 'pos'], displace: ['wave', 'result'] }),
      n('sceneOutput', 'so', 900, 200, { _groupOriginal: true, ...note(['Scene Output: the distance to this copy\'s ball.']) }, { dist: ['ball', 'dist'] }),
    ], [{ key: 'picture', type: 'texture', label: 'Picture', toNodeId: 'ball', toInputKey: 'picture' }]),
  }, {}, {});
  ball.inputs = { ...ball.inputs, picture: { type: 'texture', label: 'Picture', connection: { nodeId: 'photo', outputKey: 'texture' } } };
  const rep = n('repeatScene', 'rep', 340, 600, {
    cellX: o.cell, cellY: o.cell, cellZ: 50, countX: half, countY: rows, countZ: 0, neighbours: 'wall', ...note([
      `Repeat Scene: one ball in every ${o.cell} × ${o.cell} cell, ${half * 2 + 1} across and ${rows * 2 + 1} down (Copies each side ${half} and ${rows}); Cell Z 50 is one layer.`,
      'Neighbours "Wall cap": the balls move only along Z (lift and wave), so each stays inside its own cell across the picture, but they stand at different depths. Without the cap a ray could step over a short ball\'s cell straight into a tall neighbour two cells on and miss it. If you displace balls sideways past their cells, use "Nearest 8, only when needed" with Overlap.',
    ]),
  }, { scene: ['balls', 'scene'] });
  const loopBody = sub([
    n('marchLoopInputs', 'march_in', 0, 180, { _groupOriginal: true, ...note(['Group Inputs: the ray at this step.']) }),
    n('marchLoopOutput', 'march_out', 440, 180, { _groupOriginal: true, ...note(['Group Output: the point handed to the scene.']) }, { pos: ['march_in', 'marchPos'] }),
  ]);
  return [
    n('textureInput', 'photo', 40, 0, { fit: 'stretch', ...note([PHOTO]) }),
    n('time', 'time', 40, 300, note(['Time: turns the camera a little.'])),
    n('marchCamera', 'cam', 340, 0, { camDist: 5.6, camAngle: 0, camElevation: 0.18, rotSpeed: 0, fov: 1.5, ...note([
      'March Camera at Angle 0, looking along −Z at the picture (Balls\' "Face a camera at Angle 0" reads it the right way round from here). Drag Angle to look round the balls.',
    ]) }, { time: ['time', 'time'] }),
    ball, rep,
    n('marchLoopGroup', 'march', 640, 220, { maxSteps: 200, maxDist: 60, jitter: 0, bg: BG, albedo: [0.8, 0.8, 0.8], subgraph: loopBody, ...note(['March Loop: walks every ray into the balls (200 steps: the wall cap makes rays stop at every cell wall).']) },
      { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['rep', 'scene'] }),
    n('repeatCell', 'hitCell', 940, 520, note([
      'Repeat Cell, after the loop: with the Repeat Scene and the Hit Pos wired in, it looks up which ball each ray hit.',
    ]), { scene: ['rep', 'scene'], pos: ['march', 'pos'] }),
    n('pieceBalls', 'ballColour', 1220, 520, { count: half * 2 + 1, aspect: o.aspect, ...note([
      'Balls, after the loop: with Repeat Cell\'s Cell wired in, its Colour is the picture at the home of the ball each ray hit (the same reading as inside the scene).',
    ]) }, { cell: ['hitCell', 'cell'], picture: ['photo', 'texture'] }),
    expr('shade', 1500, 220, {
      label: 'Shade', inputs: [{ name: 'base', type: 'vec3' }, { name: 'nrm', type: 'vec3' }, { name: 'hit', type: 'float' }, { name: 'dist', type: 'float' }],
      lines: [
        ['float key', 'max(dot(nrm, normalize(vec3(-0.4, 0.7, 0.6))), 0.0)'],
        ['float fill', '0.45 + 0.35 * nrm.z'],
        ['float rim', 'pow(1.0 - abs(nrm.z), 3.0)'],
      ],
      result: `mix(vec3(${BG.join(', ')}), base * (0.35 * fill + 0.9 * key) + 0.12 * rim, hit)`,
      outputType: 'vec3', wires: { base: ['ballColour', 'color'], nrm: ['march', 'normal'], hit: ['march', 'hit'], dist: ['march', 'dist'] },
      note: ['Shade: each ball in its picture colour, lit by a key light from the upper left and a soft fill from the camera, with a little rim.'],
    }),
    n('toneMap', 'tone', 1780, 220, { mode: 'aces', ...note(['Tone Map: film-like curve into the displayable range.']) }, { color: ['shade', 'result'] }),
    out(['tone', 'color'], 2040),
  ];
}

export function buildPiecesExamples(): Record<string, ExampleGraph> {
  return {
    piecesScatterReturn: {
      ...PIECES_EXAMPLE_INDEX.piecesScatterReturn, counter: 40, nodes: scatterAndReturn(), images: { photo: RIDGES_AT_DUSK },
      play: play([
        ctl('s', 'flow::strength', 'Scatter', 0, 1.5, 0.01),
        ctl('z', 'pieces::size', 'Size', 0.2, 2, 0.01),
        ctl('w', 'flow::scale', 'Swirl size', 0.3, 5, 0.01),
        ctl('f', 'lfo::freq', 'Breaks per second', 0.02, 0.5, 0.01),
      ], `**What it shows.** A picture made of pieces (After Effects' CC Ball Action, in 2D). Every piece takes the photo's colour at its **home**, the centre of its cell, and is drawn at home + offset. The offset is a noise field read at each home, scaled by an LFO, so the whole picture breaks apart and flows back together.

**How it works.** Pieces' Offset ƒ is a field socket: it gets the noise's code, not its value, and evaluates it once per piece. Pieces can travel far from their cells and overlap; each pixel works out which home could have sent a piece there and searches the cells round it.

**Try.** On the Pieces card: Shape **Glyph** for text art, **Hexagon** with Stagger 1 for a honeycomb, Colour **Piece** so each carries its bit of the photo, **Size by Brightness** with Min size 0 for a halftone. Load a video into the Texture: it keeps playing while it scatters.`),
    },
    piecesBalls3D: {
      ...PIECES_EXAMPLE_INDEX.piecesBalls3D, counter: 40, nodes: ballsGraph({ across: 41, aspect: 16 / 9, cell: 0.24, lift: 1.4, liftBy: 'brightness', wave: 0.25 }), images: { photo: RIDGES_AT_DUSK },
      play: play([
        ctl('l', 'balls::ball::lift', 'Lift', -3, 3, 0.01),
        ctl('e', 'cam::camElevation', 'Look from above', -0.8, 0.8, 0.01),
        ctl('z', 'balls::ball::size', 'Ball size', 0.2, 1.6, 0.01),
        ctl('a', 'cam::camAngle', 'Look around', -1.2, 1.2, 0.01),
      ], `**What it shows.** CC Ball Action in a March Loop: the photo as a grid of balls. Repeat Scene puts one ball in every cell; inside it, **Balls** reads the photo at the cell's centre and lifts the ball towards the camera by the brightness there, so bright parts of the picture stand out in relief. A wave rolls through them.

**How it works.** The balls are measured once per copy, so anything worked out from Repeat Cell (its Centre, its Random) moves each ball its own way: that is the Wave, wired into Displace. After the loop a second Balls, given the copy each ray hit (Repeat Cell with Hit Pos), hands out the ball's colour.

**Try.** **Look around** to see the relief from the side. Open One ball and raise the Wave's amp. Set Lift negative to push the bright balls back. On the Balls card inside One ball, Shape **Rounded box**, or **Lift by Depth** with a Depth node's Depth texture wired into the group.`),
    },
  };
}
