/**
 * easeExamples.ts — Ease (docs/ease-node.md): named motion curves in use. A bouncing ball, a menu that slides in
 * with an overshoot and holds, an elastic logo pop, a wave of dots each starting a little later, a chart of the
 * curves side by side on one set of axes, and a ping-pong pan. Listed in the Ease & Motion folder. Built from the
 * node definitions (graphBuilder.ts); every node carries a note.
 */
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, nv, play } from './graphBuilder';
import { note } from './agentExampleKit';
import type { GraphNode } from '../types/nodeGraph';

export const EASE_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  easeBouncingBall: {
    label: 'Ease: a bouncing ball', play: true,
    description: 'One Ease node drops a ball: Curve Bounce, Direction Out, From high up To the floor, Loop Repeat with a Hold at each end. Its Speed output makes the ball glow brighter while it moves fast. Try Elastic or Back on the Ease card.',
  },
  easeSlideInMenu: {
    label: 'Ease: a menu sliding in', play: true,
    description: 'A side menu slides in from the left with Back Out (it goes a little too far and settles), holds, then slides away again: Loop Ping-pong with a Hold. A second Ease, started a moment later, brings the menu items in after the panel.',
  },
  easeElasticPop: {
    label: 'Ease: an elastic logo pop', play: true,
    description: 'A star logo pops in with Elastic Out: Ease drives its size from 0 to full, springing past it and back a few times before it settles. Amount sets how many wobbles. A ring rides out with Expo Out behind it.',
  },
  easeDotWave: {
    label: 'Ease: a wave of dots', play: true,
    description: 'A grid of dots, every one eased by the same Ease node, but each cell\'s Time starts a little later the further along the diagonal it is, so the motion rolls across the grid as a wave. Back In-Out, Ping-pong.',
  },
  easeCurveChart: {
    label: 'Ease: the curves side by side', play: true,
    description: 'A chart of six easing curves on one set of axes, all Out: Sine, Cubic, Expo, Back, Elastic and Bounce, each its own colour. Progress runs left to right, the eased value bottom to top. Switch any card\'s Direction to In, In-Out or Out-In to see the curve change.',
  },
  easePingPongPan: {
    label: 'Ease: a ping-pong pan', play: true,
    description: 'A camera pan over a cell pattern, there and back with Sine In-Out (Loop Ping-pong): slow at each end, fastest in the middle, like a camera on a slider. A second Ease drifts it up and down on a different Duration.',
  },
};
export const EASE_EXAMPLE_KEYS = Object.keys(EASE_EXAMPLE_INDEX);

function bouncingBall(): GraphNode[] {
  return [
    n('uv', 'uv', 40, 300, note(['UV: this pixel\'s place in the picture, (0, 0) in the middle, −1 at the bottom and 1 at the top.'])),
    n('ease', 'drop', 40, 40, {
      curve: 'bounce', direction: 'out', loop: 'repeat', duration: 1.6, hold: 0.5, from: 0.7, to: -0.5,
      ...note([
        'Ease, Curve Bounce, Direction Out: the ball\'s height. It falls From 0.7 To −0.5 (resting on the floor) and bounces against the end like a dropped ball.',
        'Loop Repeat: each drop takes Duration 1.6 s, it rests Hold 0.5 s on the floor, jumps back to the top, waits 0.5 s and drops again. Time is unwired, so it uses the global clock.',
        'Speed is how fast the height changes, per second: used below to light the ball while it moves.',
      ]),
    }),
    n('makeVec2', 'pos', 300, 40, { x: 0, ...note(['Make Vec2: the ball\'s centre, X 0 (the middle) and Y the eased height.']) }, { y: ['drop', 'value'] }),
    n('circleSDF', 'ball', 560, 120, { radius: 0.2, ...note(['Circle SDF: the ball, radius 0.2, centred where the Ease puts it.']) }, { position: ['uv', 'uv'], offset: ['pos', 'xy'] }),
    n('abs', 'spd', 300, 260, note(['Abs: the speed without its sign (falling or rising, it is the same glow).']), { input: ['drop', 'speed'] }),
    n('remap', 'fast', 560, 300, { inMin: 0, inMax: 4, outMin: 0, outMax: 1, ...note(['Remap: a speed of 0 to 4 a second becomes 0 to 1, how much of the bright colour the ball takes.']) }, { value: ['spd', 'output'] }),
    n('colorPicker', 'slowCol', 300, 480, { color: [0.95, 0.42, 0.18], ...note(['Colour: the ball at rest, orange.']) }),
    n('colorPicker', 'fastCol', 300, 640, { color: [1, 0.92, 0.6], ...note(['Colour: the ball at full speed, a hot pale yellow.']) }),
    nv('vec3', 'mix', 'ballCol', 820, 420, { ...note(['Mix: between the rest and the speed colours, by how fast the ball is going.']) }, { a: ['slowCol', 'rgb'], b: ['fastCol', 'rgb'], t: ['fast', 'result'] }),
    n('boxSDF', 'floor', 560, 560, { width: 3, height: 0.1, posY: -0.8, ...note(['Box SDF: the floor, its top at −0.7, where the ball\'s bottom lands (−0.5 less the radius 0.2).']) }, { position: ['uv', 'uv'] }),
    n('colorPicker', 'sky', 560, 760, { color: [0.06, 0.07, 0.11], ...note(['Colour: the dark background.']) }),
    n('sdfFill', 'floorFill', 820, 640, { fillColor: [0.24, 0.26, 0.34], ...note(['SDF Fill: the floor in slate grey over the background.']) }, { d: ['floor', 'distance'], background: ['sky', 'rgb'] }),
    n('sdfFill', 'draw', 1080, 300, note(['SDF Fill: the ball in its colour, over the floor.']), { d: ['ball', 'distance'], fillColor: ['ballCol', 'result'], background: ['floorFill', 'result'] }),
    n('output', 'out', 1340, 300, note(['Output: the ball, bouncing.']), { color: ['draw', 'result'] }),
  ];
}

function slideInMenu(): GraphNode[] {
  const item = (k: number, y: number, x: number): GraphNode[] => [
    n('makeVec2', `itemPos${k}`, 820, 380 + k * 200, { y, ...note([`Make Vec2: menu item ${k + 1}'s place, X from the items' Ease and Y ${y}.`]) }, { x: ['items', 'value'] }),
    n('boxSDF', `item${k}`, 1080, 380 + k * 200, { width: 0.3 - k * 0.04, height: 0.045, ...note([`Box SDF: menu item ${k + 1}, a short bar (each a little shorter than the last).`]) }, { position: ['uv', 'uv'], offset: [`itemPos${k}`, 'xy'] }),
  ].map(nd => ({ ...nd, position: { x: nd.position.x + x, y: nd.position.y } }));
  return [
    n('uv', 'uv', 40, 300, note(['UV: this pixel\'s place in the picture, (0, 0) in the middle; the left edge is about −1.8 on a wide screen.'])),
    n('ease', 'slide', 40, 40, {
      curve: 'back', direction: 'out', loop: 'pingpong', duration: 0.7, hold: 1.2, amount: 1, from: -2.4, to: -1.1,
      ...note([
        'Ease, Curve Back, Direction Out: the panel\'s X, From −2.4 (off the left edge) To −1.1. Back Out goes a little past To and settles back, the "overshoot" a menu has.',
        'Loop Ping-pong: in over Duration 0.7 s, it holds 1.2 s, then plays backwards to slide away, holds, and again. Amount sets how far it overshoots (a Play control).',
      ]),
    }),
    n('makeVec2', 'panelPos', 300, 40, { y: 0, ...note(['Make Vec2: the panel\'s centre, X from the Ease and Y 0.']) }, { x: ['slide', 'value'] }),
    n('boxSDF', 'panel', 560, 40, { width: 0.5, height: 0.92, ...note(['Box SDF: the panel, a tall bar 1 wide.']) }, { position: ['uv', 'uv'], offset: ['panelPos', 'xy'] }),
    n('time', 'clock', 40, 560, note(['Time: seconds since the start.'])),
    n('subtract', 'later', 300, 560, { b: 0.12, ...note(['Subtract: Time less 0.12 s, so the items\' Ease runs 0.12 s behind the panel\'s.']) }, { a: ['clock', 'time'] }),
    n('ease', 'items', 560, 520, {
      curve: 'back', direction: 'out', loop: 'pingpong', duration: 0.7, hold: 1.2, amount: 1.6, from: -2.6, to: -1.2,
      ...note(['Ease: the same move for the items, wired to the later Time, with a bigger overshoot (Amount 1.6). They arrive just after the panel.']),
    }, { time: ['later', 'result'] }),
    ...item(0, 0.5, 0), ...item(1, 0.3, 0), ...item(2, 0.1, 0),
    n('sdfUnion', 'items01', 1340, 480, note(['Union: menu items 1 and 2 as one shape.']), { a: ['item0', 'distance'], b: ['item1', 'distance'] }),
    n('sdfUnion', 'itemsAll', 1600, 560, note(['Union: and item 3.']), { a: ['items01', 'dist'], b: ['item2', 'distance'] }),
    n('colorPicker', 'bg', 820, 40, { color: [0.86, 0.87, 0.9], ...note(['Colour: the page behind the menu, light grey.']) }),
    n('sdfFill', 'panelFill', 1080, 40, { fillColor: [0.13, 0.15, 0.22], ...note(['SDF Fill: the panel in dark navy over the page.']) }, { d: ['panel', 'distance'], background: ['bg', 'rgb'] }),
    n('sdfFill', 'draw', 1860, 300, { fillColor: [0.55, 0.75, 1], ...note(['SDF Fill: the menu items in light blue, over the panel.']) }, { d: ['itemsAll', 'dist'], background: ['panelFill', 'result'] }),
    n('output', 'out', 2120, 300, note(['Output: the menu, sliding in and out.']), { color: ['draw', 'result'] }),
  ];
}

function elasticPop(): GraphNode[] {
  return [
    n('uv', 'uv', 40, 300, note(['UV: this pixel\'s place in the picture, (0, 0) in the middle.'])),
    n('ease', 'pop', 40, 40, {
      curve: 'elastic', direction: 'out', loop: 'repeat', duration: 1.4, hold: 0.8, amount: 1, from: 0, to: 0.45,
      ...note([
        'Ease, Curve Elastic, Direction Out: the star\'s size, From 0 To 0.45. Elastic Out shoots past full size and springs back and forth, smaller each time, before it settles.',
        'Loop Repeat: pop over 1.4 s, hold 0.8 s at full size, vanish, wait 0.8 s, pop again. Amount sets the number of wobbles (a Play control).',
      ]),
    }),
    n('shapeSDF', 'star', 300, 120, { shape: 'star5', rf: 0.5, ...note(['Shape SDF, Star: the logo. Its size (R) is wired from the Ease.']) }, { p: ['uv', 'uv'], r: ['pop', 'value'] }),
    n('ease', 'ring', 40, 560, {
      curve: 'expo', direction: 'out', loop: 'repeat', duration: 1.4, hold: 0.8, from: 0.1, to: 0.85,
      ...note(['Ease, Curve Expo, Direction Out: a ring that rushes out from the middle and slows to a stop at 0.85, on the same timing as the star.']),
    }),
    n('circleSDF', 'ringShape', 300, 560, { ...note(['Circle SDF: the ring, its radius from the second Ease.']) }, { position: ['uv', 'uv'], radius: ['ring', 'value'] }),
    n('colorPicker', 'bg', 560, 760, { color: [0.07, 0.05, 0.12], ...note(['Colour: the dark purple background.']) }),
    n('colorPicker', 'ringCol', 560, 600, { color: [0.95, 0.5, 0.8], ...note(['Colour: the ring\'s pink.']) }),
    n('sdfFill', 'ringFill', 820, 600, { strokeWidth: 0.012, ...note(['SDF Fill: only the ring\'s outline (Stroke Width 0.012); the inside and outside both stay background.']) }, { d: ['ringShape', 'distance'], fillColor: ['bg', 'rgb'], strokeColor: ['ringCol', 'rgb'], background: ['bg', 'rgb'] }),
    n('sdfFill', 'draw', 1080, 200, { fillColor: [1, 0.8, 0.25], ...note(['SDF Fill: the star in gold, over the ring.']) }, { d: ['star', 'distance'], background: ['ringFill', 'result'] }),
    n('output', 'out', 1340, 200, note(['Output: the logo, popping in.']), { color: ['draw', 'result'] }),
  ];
}

function dotWave(): GraphNode[] {
  return [
    n('uv', 'uv', 40, 300, note(['UV: this pixel\'s place in the picture; the Grid cuts it into cells.'])),
    n('gridLayout', 'grid', 300, 300, { columns: 12, _schemaVersion: 2, ...note(['Grid: 12 columns of square cells. Cell UV is the pixel\'s place inside its cell (−0.5 to 0.5); Cell ID numbers the cell.']) }, { uv: ['uv', 'uv'] }),
    n('splitVec2', 'id', 560, 120, note(['Split Vec2: the cell\'s column (X) and row (Y).']), { v: ['grid', 'cellID'] }),
    n('add', 'diag', 820, 120, { ...note(['Add: column + row, how far along the diagonal the cell is.']) }, { a: ['id', 'x'], b: ['id', 'y'] }),
    n('multiply', 'stag', 1080, 120, { b: 0.08, ...note(['Multiply: × 0.08 s, the delay for this cell. Stagger is a Play control: 0 moves every dot together.']) }, { a: ['diag', 'result'] }),
    n('time', 'clock', 820, 360, note(['Time: seconds since the start.'])),
    n('subtract', 'cellTime', 1080, 360, { ...note(['Subtract: Time less the cell\'s delay, so each cell\'s clock runs a little behind the one before.']) }, { a: ['clock', 'time'], b: ['stag', 'result'] }),
    n('ease', 'size', 1340, 300, {
      curve: 'back', direction: 'inOut', loop: 'pingpong', duration: 0.9, hold: 0.6, amount: 1, from: 0.1, to: 0.4,
      ...note([
        'Ease, Curve Back, Direction In-Out: the dot\'s radius, From 0.1 To 0.4 of a cell. Back In-Out pulls back a little, swings across and overshoots a little before it settles.',
        'Its Time is the cell\'s own late clock, so every cell plays the same move a moment after its neighbour: a wave. Loop Ping-pong with a Hold of 0.6 s at each end.',
      ]),
    }, { time: ['cellTime', 'result'] }),
    n('circleSDF', 'dot', 1600, 300, { ...note(['Circle SDF: a dot in the middle of each cell, its radius from the Ease.']) }, { position: ['grid', 'cellUV'], radius: ['size', 'value'] }),
    n('palette', 'tint', 1600, 40, { preset: 'custom', offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0.0, 0.1, 0.2], ...note(['Palette: a colour from the Ease\'s Progress (0 small, 1 big), so the dots change colour as they grow.']) }, { value: ['size', 'progress'] }),
    n('colorPicker', 'bg', 1600, 560, { color: [0.05, 0.05, 0.08], ...note(['Colour: the near-black background.']) }),
    n('sdfFill', 'draw', 1860, 300, note(['SDF Fill: the dots in their colour over the background.']), { d: ['dot', 'distance'], fillColor: ['tint', 'color'], background: ['bg', 'rgb'] }),
    n('output', 'out', 2120, 300, note(['Output: a wave of dots rolling across the grid.']), { color: ['draw', 'result'] }),
  ];
}

const CHART_CURVES: Array<{ curve: string; label: string; colour: [number, number, number]; feel: string }> = [
  { curve: 'sine', label: 'Sine', colour: [0.55, 0.85, 1], feel: 'the gentlest ease' },
  { curve: 'cubic', label: 'Cubic', colour: [0.6, 1, 0.6], feel: 'a firmer one' },
  { curve: 'expo', label: 'Expo', colour: [1, 0.95, 0.45], feel: 'the most extreme: it rushes, then almost stops' },
  { curve: 'back', label: 'Back', colour: [1, 0.6, 0.3], feel: 'goes past the top and settles back' },
  { curve: 'elastic', label: 'Elastic', colour: [1, 0.45, 0.7], feel: 'springs about the top' },
  { curve: 'bounce', label: 'Bounce', colour: [0.75, 0.6, 1], feel: 'bounces against the top' },
];

function curveChart(): GraphNode[] {
  const nodes: GraphNode[] = [
    n('uv', 'uv', 40, 300, note(['UV: this pixel\'s place in the picture, (0, 0) in the middle.'])),
    n('splitVec2', 'xy', 300, 300, note(['Split Vec2: the pixel\'s X (across) and Y (up).']), { v: ['uv', 'uv'] }),
    n('remap', 'across', 560, 300, { inMin: -1.2, inMax: 1.2, outMin: 0, outMax: 1, clamp: true, ...note(['Remap: X from −1.2 to 1.2 becomes the progress 0 to 1, fed into every Ease\'s Value, so each draws its curve left to right.']) }, { value: ['xy', 'x'] }),
    n('boxSDF', 'frame', 560, 40, { width: 1.2, height: 0.6, ...note(['Box SDF: the chart\'s frame, 0 to 1 across and From −0.6 To 0.6 up.']) }, { position: ['uv', 'uv'] }),
    n('colorPicker', 'bg', 300, 40, { color: [0.05, 0.06, 0.09], ...note(['Colour: the dark background.']) }),
    n('colorPicker', 'grid', 300, 140, { color: [0.3, 0.32, 0.4], ...note(['Colour: the frame\'s grey.']) }),
    n('sdfFill', 'chart', 820, 40, { strokeWidth: 0.006, ...note(['SDF Fill: just the frame\'s outline over the background. The bottom edge is 0 (From), the top edge 1 (To).']) }, { d: ['frame', 'distance'], fillColor: ['bg', 'rgb'], strokeColor: ['grid', 'rgb'], background: ['bg', 'rgb'] }),
  ];
  let prev: [string, string] = ['chart', 'result'];
  CHART_CURVES.forEach((c, i) => {
    const y = 300 + i * 260, x = 820;
    nodes.push(
      n('ease', `e_${c.curve}`, x, y, { curve: c.curve, direction: 'out', from: -0.6, to: 0.6, ...note([`Ease, Curve ${c.label}, Direction Out: ${c.feel}. Value is wired (the progress across), so it does not play by itself; From −0.6 and To 0.6 put the curve in the frame.`]) }, { value: ['across', 'result'] }),
      n('subtract', `dy_${c.curve}`, x + 260, y, note([`Subtract: the pixel's Y less the ${c.label} curve's height: 0 on the curve, negative below it.`]), { a: ['xy', 'y'], b: [`e_${c.curve}`, 'value'] }),
      n('colorPicker', `col_${c.curve}`, x + 260, y + 120, { color: c.colour, ...note([`Colour: the ${c.label} line's colour.`]) }),
      n('sdfFill', `line_${c.curve}`, x + 520, y, { strokeWidth: 0.014, ...note([`SDF Fill: a line where the difference is 0 (Stroke Width 0.014), over the chart so far; both sides keep the picture underneath.`]) }, { d: [`dy_${c.curve}`, 'result'], fillColor: prev, strokeColor: [`col_${c.curve}`, 'rgb'], background: prev }),
    );
    prev = [`line_${c.curve}`, 'result'];
  });
  nodes.push(n('output', 'out', 1600, 300, note(['Output: the six curves on one chart.']), { color: prev }));
  return nodes;
}

function pingPongPan(): GraphNode[] {
  return [
    n('uv', 'uv', 40, 300, note(['UV: this pixel\'s place in the picture, (0, 0) in the middle.'])),
    n('ease', 'panX', 40, 40, {
      curve: 'sine', direction: 'inOut', loop: 'pingpong', duration: 3, hold: 0.4, from: -1.5, to: 1.5,
      ...note([
        'Ease, Curve Sine, Direction In-Out: the camera\'s X, From −1.5 To 1.5. Sine In-Out starts gently, is fastest in the middle and slows gently into the end, like a camera on a slider.',
        'Loop Ping-pong: there in 3 s, hold 0.4 s, and back.',
      ]),
    }),
    n('ease', 'panY', 40, 560, {
      curve: 'quad', direction: 'inOut', loop: 'pingpong', duration: 4.3, hold: 0, from: -0.4, to: 0.4,
      ...note(['Ease, Curve Quad, Direction In-Out: a slow drift up and down, on a different Duration (4.3 s), so the path differs every time round.']),
    }),
    n('makeVec2', 'cam', 300, 300, note(['Make Vec2: where the camera is.']), { x: ['panX', 'value'], y: ['panY', 'value'] }),
    nv('vec2', 'add', 'view', 560, 300, { ...note(['Add: every pixel\'s place moved by the camera, so the whole pattern slides past.']) }, { a: ['uv', 'uv'], b: ['cam', 'xy'] }),
    n('voronoi', 'cells', 820, 300, { scale: 4, ...note(['Voronoi: a pattern of cells to pan over; Dist is the distance to the nearest cell centre.']) }, { uv: ['view', 'result'] }),
    n('palette', 'col', 1080, 300, { preset: 'custom', offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0.55, 0.65, 0.8], ...note(['Palette: a colour from the distance, so each cell is a soft blob of colour.']) }, { value: ['cells', 'dist'] }),
    n('output', 'out', 1340, 300, note(['Output: the pan, there and back.']), { color: ['col', 'color'] }),
  ];
}

export function buildEaseExamples(): Record<string, ExampleGraph> {
  const I = EASE_EXAMPLE_INDEX;
  return {
    easeBouncingBall: {
      ...I.easeBouncingBall, counter: 40, nodes: bouncingBall(),
      play: play([
        ctl('dur', 'drop::duration', 'Duration (s)', 0.3, 4, 0.05),
        ctl('hold', 'drop::hold', 'Hold at each end (s)', 0, 2, 0.05),
      ], `**What it shows.** One Ease node is the whole animation: Curve **Bounce**, Direction **Out** moves the ball From high up To the floor, bouncing as it arrives. Loop **Repeat** plays it again and again with a **Hold** at each end. Its **Speed** output lights the ball while it moves fast.

**How it is built.** Ease (Value unwired, so it plays by itself from Time) → Make Vec2 → the ball's Circle SDF. Ease's Speed → Abs → Remap picks between two colours. A Box SDF floor and two SDF Fills draw it.

**Try.** On the Ease card set Curve to **Elastic** or **Back**, or Direction to **In** (it bounces as it leaves instead). Change *Duration* and *Hold*.`),
    },
    easeSlideInMenu: {
      ...I.easeSlideInMenu, counter: 40, nodes: slideInMenu(),
      play: play([
        ctl('amt', 'slide::amount', 'Overshoot (Amount)', 0, 3, 0.01),
        ctl('hold', 'slide::hold', 'Hold (s)', 0, 3, 0.05),
      ], `**What it shows.** A menu sliding in with **Back Out**: it goes a little past where it stops and settles, which reads as quick and springy. **Ping-pong** plays it backwards to slide away, holding **Hold** seconds at each end.

**How it is built.** One Ease moves the panel's X From off-screen To its place; a second Ease does the same for the items, with its Time wired from Time − 0.12 s so they arrive just after. Box SDFs and SDF Fills draw them.

**Try.** *Overshoot* 0 is a plain ease-out; 2 or more is a big bounce. Set the items' Ease to Curve **Elastic**.`),
    },
    easeElasticPop: {
      ...I.easeElasticPop, counter: 40, nodes: elasticPop(),
      play: play([
        ctl('amt', 'pop::amount', 'Wobbles (Amount)', 0.3, 3, 0.01),
        ctl('dur', 'pop::duration', 'Duration (s)', 0.3, 4, 0.05),
      ], `**What it shows.** An **Elastic Out** pop: the logo's size springs past full size and back, smaller each time, then settles. A ring rushes out behind it with **Expo Out**.

**How it is built.** Ease (Elastic, From 0 To 0.45) → a Star's size (Shape SDF R). A second Ease (Expo) → a Circle SDF's radius, drawn as an outline. Both Loop Repeat with the same Duration and Hold.

**Try.** More *Wobbles* for a jelly, fewer for a single spring. Set the star's Ease to **Back** for a single overshoot.`),
    },
    easeDotWave: {
      ...I.easeDotWave, counter: 40, nodes: dotWave(),
      play: play([
        ctl('stag', 'stag::b', 'Stagger (s per cell)', 0, 0.3, 0.005),
        ctl('amt', 'size::amount', 'Overshoot (Amount)', 0, 3, 0.01),
      ], `**What it shows.** One Ease plays in every cell, but each cell's **Time** starts a little later than its neighbour's, so the same move rolls across the grid as a wave. Back In-Out with Ping-pong and a Hold.

**How it is built.** Grid → Cell ID → column + row × *Stagger* is the cell's delay; Time − delay → the Ease's Time. Ease's Value is the dot's radius (Circle SDF on Cell UV); its Progress picks the Palette colour.

**Try.** *Stagger* 0: every dot moves together. Big *Stagger*: a slow ripple. Set Curve to **Bounce** or **Elastic**.`),
    },
    easeCurveChart: {
      ...I.easeCurveChart, counter: 60, nodes: curveChart(),
      play: play([
        ctl('back', 'e_back::amount', 'Back overshoot (Amount)', 0, 3, 0.01),
        ctl('elastic', 'e_elastic::amount', 'Elastic wobbles (Amount)', 0.3, 3, 0.01),
      ], `**What it shows.** Six easing curves on one chart, all **Out**: Sine, Cubic, Expo, Back, Elastic, Bounce. Across is the progress 0 to 1, up is the eased value From the bottom of the frame To the top. Back and Elastic leave the frame: they go past the end.

**How it is built.** UV → X → Remap to 0…1 into every Ease's **Value** (wired, so they do not play by themselves). Each curve's height is From −0.6 To 0.6; Y − height is 0 on the curve, and an SDF Fill strokes that line in the curve's colour.

**Try.** On any Ease card switch Direction to **In**, **In-Out** or **Out-In**; or change its Curve to Quad, Quart, Circ or Steps.`),
    },
    easePingPongPan: {
      ...I.easePingPongPan, counter: 40, nodes: pingPongPan(),
      play: play([
        ctl('dur', 'panX::duration', 'Pan time (s)', 0.5, 8, 0.1),
        ctl('hold', 'panX::hold', 'Hold at each end (s)', 0, 3, 0.05),
      ], `**What it shows.** A camera pan, there and back, with **Sine In-Out** and Loop **Ping-pong**: it eases out of each end and into the next, like a camera on a slider. A second, slower Ease drifts it up and down.

**How it is built.** Two Eases (X and Y) → Make Vec2 → Add to UV, so the whole Voronoi pattern slides; a Palette colours it.

**Try.** Set the X Ease's Curve to **Linear** to see how mechanical a pan looks without easing, or **Expo** for a whip pan.`),
    },
  };
}
