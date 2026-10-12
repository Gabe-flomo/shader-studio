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
    expr('scatter', 620, 760, {
      label: 'Scatter', inputs: [{ name: 'v', type: 'float' }, { name: 'reach', type: 'float', slider: { min: 0, max: 1 } }], values: { reach: 0.22 },
      lines: [], result: 'reach * v', outputType: 'float', wires: { v: ['ease', 'result'] },
      note: ['Scatter: the eased LFO times reach. It is Pieces\' Scatter: every piece\'s own random push (direction and distance from the Seed), so on top of the flow the pieces fly apart each their own way and land back home.'],
    }),
    n('pieces', 'pieces', 900, 220, { count: 32, size: 1.0, shape: 'circle', colourMode: 'flat', order: 'moved', scatterSize: 0, dimFloor: 0, ...note([
      'Pieces: the photo rebuilt from 32 circles across. Each takes the photo\'s colour at its home (the centre of its cell) and is drawn at home + Offset × Amount + its Scatter.',
      'Offset ƒ is the noise field read at each home; Amount is the eased LFO, so the picture scatters and flows back together. Scatter (the same LFO) adds a random push per piece. Pieces moved furthest are drawn on top.',
      'Try: Shape Ball for glowing beads; Hexagon with Stagger 1; Colour: Piece (each carries its bit of the photo); Size by Brightness with Min size 0 for a halftone that scatters; Scatter turn for a jumble.',
    ]) }, { uv: ['uv', 'uv'], picture: ['photo', 'texture'], offset: ['flow', 'dir'], amount: ['ease', 'result'], background: ['ghost', 'result'], scatter: ['scatter', 'result'] }),
    out(['pieces', 'color'], 1200),
  ];
}

/** A kaleidoscope of rings and petals drawn into a Shader Texture: the source for Ball action. */
function kaleidoTexture(x: number, y: number): GraphNode {
  const uv = n('uv', 'kUv', 0, 160, { _groupOriginal: true, ...note(['UV inside the Shader Texture: its own square, −1 to 1.']) });
  const t = n('time', 'kTime', 0, 360, note(['Time: turns the rings.']));
  const k = expr('kRings', 300, 200, {
    label: 'Kaleidoscope', inputs: [{ name: 'p', type: 'vec2' }, { name: 't', type: 'float' }],
    lines: [
      ['float r', 'length(p)'],
      ['float a', 'abs(mod(atan(p.x, p.y) + t * 0.05, 1.0471976) - 0.5235988)'],
      ['vec2 q', 'r * vec2(cos(a), sin(a))'],
      ['float rings', 'sin(r * 11.0 - t * 0.9 + 1.6 * sin(q.y * 7.0 + t * 0.3))'],
      ['float petals', 'sin(q.x * 8.0 + t * 0.5) * sin(q.y * 13.0 - t * 0.4)'],
      ['float v', 'rings + 0.6 * petals'],
      ['float h', 'fract(0.18 * v + 0.55 * r - 0.02 * t)'],
      ['vec3 gold', 'vec3(1.0, 0.68, 0.16)'],
      ['vec3 ember', 'vec3(0.95, 0.28, 0.06)'],
      ['vec3 sky', 'vec3(0.12, 0.5, 1.0)'],
      ['vec3 hue', 'h < 0.33 ? gold + (ember - gold) * (h * 3.0) : h < 0.66 ? ember + (sky - ember) * (h * 3.0 - 1.0) : sky + (gold - sky) * (h * 3.0 - 2.0)'],
    ],
    result: 'hue * 0.85 * smoothstep(-0.2, 0.8, v) * (1.0 - smoothstep(0.85, 1.4, r))', outputType: 'vec3', wires: { p: ['kUv', 'uv'], t: ['kTime', 'time'] },
    note: [
      'Kaleidoscope: the angle folded into six mirrored wedges, rings rolling out (bent by a wave), crossed by petals. The colour runs gold, ember and sky blue with the pattern and the radius (h), drifting slowly; dark between the bands.',
      'Kept below 1 (× 0.85) so the glowing balls brighten it without washing out to white; faded out past the edge.',
    ],
  });
  const o = n('shaderTextureOutput', 'kOut', 620, 200, { _groupOriginal: true, ...note(['Texture Output: drawn into the texture every frame.']) }, { color: ['kRings', 'result'] });
  return n('shaderTexture', 'kal', x, y, {
    label: 'Kaleidoscope', size: '1024', update: 'frame', wrap: 'clamp', starter: 'custom',
    subgraph: { nodes: [uv, t, k, o], inputPorts: [], outputPorts: [] },
    ...note([
      'Shader Texture: a moving kaleidoscope drawn into a 1024 × 1024 texture every frame (double-click to open it). It is the picture the balls are made of: any shader, photo or video works.',
    ]),
  });
}

/** CC Ball Action in 2D: a kaleidoscope rebuilt from dense glowing balls, a little scattered, wobbling. */
function ballAction(): GraphNode[] {
  return [
    n('uv', 'uv', 40, 220, note(['UV: the point being drawn.'])),
    n('time', 'time', 40, 520, note(['Time: drives the LFO.'])),
    kaleidoTexture(40, 0),
    n('lfo', 'lfo', 340, 520, { waveform: 'sine', freq: 0.07, amplitude: 0.5, offset: 0.5, ...note(['LFO: a slow sine, 0 to 1 and back every 14 seconds.']) }, { time: ['time', 'time'] }),
    expr('scatter', 620, 520, {
      label: 'Scatter', inputs: [{ name: 'v', type: 'float' }, { name: 'rest', type: 'float', slider: { min: 0, max: 0.05 } }, { name: 'burst', type: 'float', slider: { min: 0, max: 0.5 } }],
      values: { rest: 0.01, burst: 0.12 },
      lines: [], result: 'rest + burst * smoothstep(0.55, 1.0, v)', outputType: 'float', wires: { v: ['lfo', 'value'] },
      note: ['Scatter: a little all the time (rest: the jittered, organic grid of CC Ball Action), and a burst as the LFO peaks, when the balls fly apart and settle back. It is Pieces\' Scatter.'],
    }),
    n('pieces', 'balls', 900, 220, {
      shape: 'ball', ballLook: 'glow', shading: 1, count: 110, size: 1.12, aspect: 1, scatterSize: 0.15, instability: 0.004, dimFloor: 0.06, order: 'brightness',
      background: [0.005, 0.005, 0.01], ...note([
        'Pieces, Ball shape (Glowing): the kaleidoscope rebuilt from 110 balls across, each the picture\'s colour at its home, brightest at its centre and falling off to the rim, as if it gave off light. Size 1.12: neighbours just overlap.',
        'Scatter (wired) breaks the grid up and bursts it; Scatter size varies them ±15%; Instability 0.004 keeps every ball wobbling at its own pace; Dim floor keeps the dark parts as dim balls. The brightest are drawn on top.',
        'Try: Ball look Lit for beads under a light; Size by Brightness for a halftone; Blur 2 with Focus 0.8 (on the brightness): dim balls go soft.',
      ]),
    }, { uv: ['uv', 'uv'], picture: ['kal', 'texture'], scatter: ['scatter', 'result'] }),
    out(['balls', 'color'], 1200),
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
      n('pieceBalls', 'ball', 600, 200, { layout: 'repeat', count: half * 2 + 1, aspect: o.aspect, lift: o.lift, liftBy: o.liftBy, size: 0.92, ...note([
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
    n('pieceBalls', 'ballColour', 1220, 520, { layout: 'repeat', count: half * 2 + 1, aspect: o.aspect, ...note([
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

/**
 * Balls on their own grid, scattered in depth: an LFO pushes every ball towards or away from the
 * camera by its own random amount, a little sideways scatter and Instability break the grid, and
 * Blur softens the balls away from Focus. The same values reach the scene's Balls (through the group's
 * ports) and the colour's Balls after the loop.
 */
function ballsDepth(): GraphNode[] {
  const P = { layout: 'own', count: 71, width: 4.4, aspect: 16 / 9, lift: 0.35, liftBy: 'brightness', size: 0.95, scatter: 0, instability: 0, seed: 3 };
  const ball = n('sceneGroup', 'balls', 40, 520, {
    label: 'Balls', ...note(['The balls, one shape for the whole picture (Balls on its own grid). The picture, the depth scatter and the focus come in through the group\'s ports.']),
    subgraph: sub([
      n('scenePos', 'sp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured.']) }),
      n('pieceBalls', 'ball', 300, 200, { ...P, ...note([
        'Balls on its own grid: 71 across, lifted a little by the brightness. Scatter depth (from the LFO outside) pushes each ball towards or away from the camera by its own amount (Seed 3).',
        'Try Scatter (in X, Y and Z) or Instability (a wobble): sideways moves are safe on its own grid, as each point then measures the balls of the cells round it too, out to the furthest a ball can reach. That costs more per step, so they start at 0 here.',
      ]) }, { pos: ['sp', 'pos'] }),
      n('sceneOutput', 'so', 620, 200, { _groupOriginal: true, ...note(['Scene Output: the distance to the nearest ball.']) }, { dist: ['ball', 'dist'] }),
    ], [
      { key: 'picture', type: 'texture', label: 'Picture', toNodeId: 'ball', toInputKey: 'picture' },
      { key: 'depth', type: 'float', label: 'Scatter depth', toNodeId: 'ball', toInputKey: 'scatterDepth' },
      { key: 'focus', type: 'float', label: 'Focus', toNodeId: 'ball', toInputKey: 'focus' },
      { key: 'blur', type: 'float', label: 'Blur', toNodeId: 'ball', toInputKey: 'blur' },
    ]),
  }, {}, {});
  const wire = (nodeId: string, outputKey: string) => ({ connection: { nodeId, outputKey } });
  ball.inputs = {
    ...ball.inputs,
    picture: { type: 'texture', label: 'Picture', ...wire('photo', 'texture') },
    depth: { type: 'float', label: 'Scatter depth', ...wire('depthLfo', 'value') },
    focus: { type: 'float', label: 'Focus', ...wire('focus', 'value') },
    blur: { type: 'float', label: 'Blur', ...wire('blur', 'value') },
  };
  const loopBody = sub([
    n('marchLoopInputs', 'march_in', 0, 180, { _groupOriginal: true, ...note(['Group Inputs: the ray at this step.']) }),
    n('marchLoopOutput', 'march_out', 440, 180, { _groupOriginal: true, ...note(['Group Output: the point handed to the scene.']) }, { pos: ['march_in', 'marchPos'] }),
  ]);
  return [
    n('textureInput', 'photo', 40, 0, { fit: 'stretch', ...note([PHOTO]) }),
    n('time', 'time', 40, 300, note(['Time: drives the LFO.'])),
    n('lfo', 'depthLfo', 340, 300, { waveform: 'sine', freq: 0.08, amplitude: 0.9, offset: 0.9, ...note([
      'LFO: Scatter depth, from 0 (the picture flat) to 1.8 and back every 12 seconds: every ball flies towards or away from the camera by its own random share of it.',
    ]) }, { time: ['time', 'time'] }),
    n('constant', 'focus', 340, 460, { value: 0.2, outputType: 'float', ...note(['Focus: the depth (z) that is sharp. 0.2 is about where the bright balls sit.']) }),
    n('constant', 'blur', 340, 600, { value: 0, outputType: 'float', ...note(['Blur: depth of field, off (0). Raise it (Play: Blur) and balls away from Focus spread into soft discs that keep their light; each ball then looks further round itself, so it costs more.']) }),
    n('marchCamera', 'cam', 340, 0, { camDist: 5.2, camAngle: 0.25, camElevation: 0.12, rotSpeed: 0, fov: 1.5, ...note([
      'March Camera a little to the side (Angle 0.25), so the depth reads. Balls\' "Face a camera at Angle 0" keeps the picture the right way round.',
    ]) }, { time: ['time', 'time'] }),
    ball,
    n('marchLoopGroup', 'march', 640, 220, { maxSteps: 180, maxDist: 60, jitter: 0, bg: BG, albedo: [0.8, 0.8, 0.8], subgraph: loopBody, ...note(['March Loop: walks every ray into the balls (180 steps: rays stop at every cell wall).']) },
      { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['balls', 'scene'] }),
    n('pieceBalls', 'ballColour', 940, 520, { ...P, ...note([
      'Balls at Hit Pos, with the same settings and the same wires: its Colour is the picture at the home of the ball each ray hit (spread thin over the ball when it is out of focus).',
    ]) }, { pos: ['march', 'pos'], picture: ['photo', 'texture'], scatterDepth: ['depthLfo', 'value'], focus: ['focus', 'value'], blur: ['blur', 'value'] }),
    expr('shade', 1240, 220, {
      label: 'Glow', inputs: [{ name: 'base', type: 'vec3' }, { name: 'nrm', type: 'vec3' }, { name: 'hit', type: 'float' }],
      lines: [['float core', 'pow(max(nrm.z * 0.8 + 0.2, 0.0), 1.5)'], ['vec3 bg', `vec3(${BG.join(', ')})`]],
      result: 'bg + (base * (0.3 + 1.1 * core) + base * base * 0.5 * pow(core, 6.0) - bg) * hit',
      outputType: 'vec3', wires: { base: ['ballColour', 'color'], nrm: ['march', 'normal'], hit: ['march', 'hit'] },
      note: ['Glow: each ball gives off its own colour, brightest where it faces the camera, dimmer towards its rim (no outside light): glowing beads.'],
    }),
    n('toneMap', 'tone', 1520, 220, { mode: 'aces', ...note(['Tone Map: film-like curve into the displayable range.']) }, { color: ['shade', 'result'] }),
    out(['tone', 'color'], 1780),
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
        ctl('t', 'pieces::scatterTurn', 'Scatter turn', 0, 180, 1),
      ], `**What it shows.** A picture made of pieces (After Effects' CC Ball Action, in 2D). Every piece takes the photo's colour at its **home**, the centre of its cell, and is drawn at home + offset. The offset is a noise field read at each home, scaled by an LFO, and the same LFO drives **Scatter**, a random push per piece, so the whole picture breaks apart and flows back together.

**How it works.** Pieces' Offset ƒ is a field socket: it gets the noise's code, not its value, and evaluates it once per piece. Pieces can travel far from their cells and overlap; each pixel works out which home could have sent a piece there and searches the cells round it.

**Try.** On the Pieces card: Shape **Glyph** for text art, **Hexagon** with Stagger 1 for a honeycomb, Colour **Piece** so each carries its bit of the photo, **Size by Brightness** with Min size 0 for a halftone. Load a video into the Texture: it keeps playing while it scatters.`),
    },
    piecesBallAction: {
      ...PIECES_EXAMPLE_INDEX.piecesBallAction, counter: 40, nodes: ballAction(),
      play: play([
        ctl('s', 'balls::scatterSize', 'Size variety', 0, 0.6, 0.01),
        ctl('z', 'balls::size', 'Ball size', 0.5, 1.6, 0.01),
        ctl('i', 'balls::instability', 'Instability', 0, 0.02, 0.0005),
        ctl('g', 'balls::shading', 'Glow', 0, 1, 0.01),
        ctl('f', 'lfo::freq', 'Bursts per second', 0.02, 0.4, 0.01),
      ], `**What it shows.** After Effects' CC Ball Action on a shader: a moving kaleidoscope (a Shader Texture) rebuilt from 110 glowing balls across. Each ball is the picture's colour at its home, brightest at its centre and dimming to its rim, as if lit from within. A little **Scatter** breaks up the grid, **Instability** keeps every ball wobbling, and an LFO bursts the Scatter now and then.

**How it works.** Pieces with the **Ball** shape (Glowing). Scatter gives every ball its own stable random direction and distance (from the Seed); the search each pixel makes reaches as far as the Scatter does, so no ball is cut. Dim floor keeps the dark bands as faint balls.

**Try.** Ball look **Lit** for beads under a light. **Blur** with Focus (on the brightness) softens the dim balls like a lens. Open the Kaleidoscope to change the source, or wire a photo or video into Picture instead.`),
    },
    piecesBallsDepth: {
      ...PIECES_EXAMPLE_INDEX.piecesBallsDepth, counter: 40, nodes: ballsDepth(), images: { photo: RIDGES_AT_DUSK },
      play: play([
        ctl('d', 'depthLfo::amplitude', 'Depth scatter', 0, 2, 0.01),
        ctl('b', 'blur::value', 'Blur', 0, 3, 0.01),
        ctl('c', 'focus::value', 'Focus', -1.5, 1.5, 0.01),
        ctl('a', 'cam::camAngle', 'Look around', -1.2, 1.2, 0.01),
      ], `**What it shows.** The photo as a grid of balls that breaks up in depth: an LFO on **Scatter depth** sends every ball towards or away from the camera by its own random amount, then brings them back. **Blur** softens the balls away from **Focus**, like a lens.

**How it works.** Balls on its own grid: each point measures the balls of the cells round it, out to the furthest one can reach, so balls can move sideways too without being cut. The LFO, Focus and Blur reach the scene's Balls through the group's ports and the colour's Balls (at Hit Pos) directly, so both agree.

**Try.** Raise **Depth scatter** and **Look around**. Raise **Blur** and move **Focus** to pull the sharp plane through the cloud. Open Balls and try Scatter (sideways too), Instability or Twist.`),
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
