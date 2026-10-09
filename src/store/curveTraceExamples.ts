/**
 * curveTraceExamples.ts — Curve Trace (docs/curve-trace.md): a harmonograph-chart row in 2D and
 * a 3D Lissajous knot. Built from the node definitions (graphBuilder.ts).
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { ctl, n, out, play } from './graphBuilder';
import { expr, note } from './agentExampleKit';
import type { ExampleGraph } from './exampleIndex';
import { CURVE_TRACE_EXAMPLE_INDEX } from './curveTraceExampleIndex';
import { applyRecipe } from '../nodes/recipes/apply';
import { LIGHT_RECIPES } from '../nodes/recipes/lightRecipes';

const sub = (nodes: GraphNode[], inputPorts: SubgraphData['inputPorts'] = []): SubgraphData => ({ nodes, inputPorts, outputPorts: [] });

function intervals(): GraphNode[] {
  const cols: Array<{ id: string; x: number; mode: string; phaseX: number; label: string; why: string }> = [
    { id: 'open', x: -0.66, mode: 'lateral', phaseX: 1.5708, label: 'Lateral, open phase', why: 'X and Y swing on their own waves, X a quarter turn ahead (phase 1.5708): the full Lissajous figure.' },
    { id: 'closed', x: -0.22, mode: 'lateral', phaseX: 0, label: 'Lateral, closed phase', why: 'The same waves in step (phase 0): the figure folds onto itself, the line runs back over its own path.' },
    { id: 'con', x: 0.22, mode: 'rotary', phaseX: 0, label: 'Rotary, concurrent', why: 'Two circular motions turning the same way, the second smaller: circles with loops.' },
    { id: 'counter', x: 0.66, mode: 'counter', phaseX: 0, label: 'Rotary, counter-current', why: 'The second circle turns the other way: stars and flowers, as many points as the two frequencies add up to.' },
  ];
  const lateral = { ampX: 0.18, ampY: 0.18 }, rotary = { ampX: 0.11, ampY: 0.07 };
  const nodes: GraphNode[] = [
    n('constant', 'ra', 0, 0, { label: 'Ratio (top)', value: 3, ...note(['The first frequency of the interval (3 for a fifth, 3 : 2).']) }),
    n('constant', 'rb', 0, 200, { label: 'Ratio (bottom)', value: 2, ...note(['The second frequency (2 for a fifth).']) }),
    n('time', 'time', 0, 400, note(['Time: drifts the phase so the figures slowly turn.'])),
    n('constant', 'spd', 0, 600, { label: 'Drift speed', value: 0.1, ...note(['How fast the figures turn through their shapes (radians a second). 0 holds them still.']) }),
    expr('drift', 300, 400, { label: 'Drift', inputs: [{ name: 't', type: 'float' }, { name: 'speed', type: 'float' }], lines: [], result: 't * speed', outputType: 'float', wires: { t: ['time', 'time'], speed: ['spd', 'value'] }, note: ['Drift: a slow phase change (Time × Drift speed), wired into the second wave or circle so every figure turns through its shapes.'] }),
  ];
  cols.forEach((c, i) => {
    const amps = c.mode === 'lateral' ? lateral : rotary;
    nodes.push(n('curveTrace', c.id, 600, i * 520, {
      mode: c.mode, offX: c.x, ampX: amps.ampX, ampY: amps.ampY, phaseX: c.phaseX, thickness: 0.0025, segments: 320, label: c.label,
      ...note([`Curve Trace, ${c.label}.`, c.why, 'Frequencies come from the two Ratio constants; Y phase from Drift.']),
    }, { freqX: ['ra', 'value'], freqY: ['rb', 'value'], phaseY: ['drift', 'result'] }));
  });
  nodes.push(expr('ink', 1000, 300, {
    label: 'Ink', outputType: 'vec3',
    inputs: cols.flatMap(c => [{ name: `${c.id}D`, type: 'float' as const }, { name: `${c.id}A`, type: 'float' as const }]),
    wires: Object.fromEntries(cols.flatMap(c => [[`${c.id}D`, [c.id, 'distance']], [`${c.id}A`, [c.id, 'along']]])) as Record<string, [string, string]>,
    lines: [
      ['float w', 'fwidth(openD) + 0.0005'],
      ['vec3 col', 'vec3(0.035, 0.035, 0.045)'],
      ...cols.map(c => ['col', `col + (0.75 + 0.25 * cos(6.28318 * (${c.id}A + vec3(0.0, 0.33, 0.67)))) * (smoothstep(w, -w, ${c.id}D) + 0.0012 / max(abs(${c.id}D), 0.0012) * 0.25)`] as [string, string]),
    ],
    result: 'col',
    note: [
      'Ink: each curve\'s Distance becomes a crisp line (smoothstep across one pixel, fwidth) plus a faint glow (1 / distance), tinted by Along, so the colour runs along each line from start to end.',
      'Nothing here is fixed: the curves are plain distance fields, so swap this for any colouring, glow or SDF tool.',
    ],
  }));
  nodes.push(out(['ink', 'result'], 1400, 300));
  return nodes;
}

/** One big figure and a plain ink block: shared by the Pen and Morph examples. */
function single(curve: GraphNode, extra: GraphNode[], inkNote: string, fadeTail: boolean): GraphNode[] {
  return [
    ...extra,
    curve,
    expr('ink', 1000, 200, {
      label: 'Ink', outputType: 'vec3',
      inputs: [{ name: 'd', type: 'float' }, { name: 'a', type: 'float' }],
      wires: { d: ['curve', 'distance'], a: ['curve', 'along'] },
      lines: [
        ['float w', 'fwidth(d) + 0.0005'],
        ['float fade', fadeTail ? 'a * a' : '1.0'],
        ['vec3 tint', '0.7 + 0.3 * cos(6.28318 * (a * 0.6 + vec3(0.55, 0.75, 0.95)))'],
        ['float line', 'smoothstep(w, -w, d) + 0.0015 / max(abs(d), 0.0015) * 0.3'],
      ],
      result: 'vec3(0.03, 0.03, 0.04) + tint * line * fade',
      note: [inkNote, 'Nothing here is fixed: the curve is a plain distance field, so swap this for any colouring or effect.'],
    }),
    out(['ink', 'result'], 1400, 200),
  ];
}

function pen(): GraphNode[] {
  return single(
    n('curveTrace', 'curve', 500, 200, {
      draw: 'pen', penSpeed: 0.12, trail: 0.6, freqX: 3, freqY: 2, phaseX: 1.5708, ampX: 0.42, ampY: 0.42, thickness: 0.003, segments: 320,
      ...note(['Curve Trace, Draw: Pen. A head runs along a 3 : 2 Lissajous figure at Pen speed (turns a second), leaving Trail turns of line behind it.', 'Slow, you watch the figure being drawn. Raise Pen speed toward 3+ and Trail to 1 and it blurs into the whole, continuous figure, as on a fast pen or a scope.']),
    }),
    [],
    'Ink: the line (a pixel-wide smoothstep on Distance) with a faint glow, faded along its length (Along is 0 at the tail and 1 at the head), so the trail dies away behind the pen.',
    true,
  );
}

function morph(): GraphNode[] {
  return single(
    n('curveTrace', 'curve', 500, 200, {
      morphOn: true, freqX: 3, freqY: 2, freqXB: 5, freqYB: 4, phaseX: 1.5708, ampX: 0.42, ampY: 0.42, thickness: 0.003, segments: 400,
      ...note(['Curve Trace with Morph on: figure A (X 3, Y 2: a fifth) and figure B (X 5, Y 4: a major third) are both worked out at every point along the curve and blended by Morph amount.', 'Both figures are closed, so every in-between shape is a smooth closed curve too.']),
    }, { morph: ['flow', 'result'] }),
    [
      n('time', 'time', 0, 200, note(['Time: drives the morph.'])),
      n('constant', 'rate', 0, 400, { label: 'Morph speed', value: 0.3, ...note(['How fast it flows between the two figures (radians a second).']) }),
      expr('flow', 250, 200, { label: 'Flow', inputs: [{ name: 't', type: 'float' }, { name: 'rate', type: 'float' }], lines: [], result: '0.5 - 0.5 * cos(t * rate)', outputType: 'float', wires: { t: ['time', 'time'], rate: ['rate', 'value'] }, note: ['Flow: eases back and forth between 0 (figure A) and 1 (figure B), wired into Morph amount.'] }),
    ],
    'Ink: the line with a faint glow, tinted along its length (Along).',
    false,
  );
}

/** The museum harmonograph: frequencies in Hz, a dot that leaves a short trail, solid at high frequencies. */
function live(): GraphNode[] {
  return [
    n('curveTrace', 'curve', 500, 200, {
      draw: 'live', persistence: 0.25, freqX: 1, freqY: 1, phaseX: 1.5708, ampX: 0.42, ampY: 0.42, thickness: 0.0035, segments: 720,
      ...note([
        'Curve Trace, Draw: Live. X and Y frequencies are in cycles a second: at 1 and 1 (X a quarter turn ahead) the dot goes round a circle once a second.',
        'The line is the last Persistence seconds of the dot\'s path. At low frequencies that is a dot with a short tail; raise them and the same quarter second covers more and more of the figure until it is a solid line. At 0 Hz the dot rests in the middle.',
      ]),
    }),
    expr('ink', 1000, 200, {
      label: 'Ink', outputType: 'vec3',
      inputs: [{ name: 'd', type: 'float' }, { name: 'a', type: 'float' }, { name: 'head', type: 'float' }],
      wires: { d: ['curve', 'distance'], a: ['curve', 'along'], head: ['curve', 'head'] },
      lines: [
        ['float w', 'fwidth(d) + 0.0005'],
        ['float trail', '(smoothstep(w, -w, d) + 0.0015 / max(abs(d), 0.0015) * 0.25) * (0.15 + 0.85 * a * a)'],
        ['float dot', 'smoothstep(0.016, 0.008, head) + 0.004 / max(head, 0.004) * 0.6'],
      ],
      result: 'vec3(0.02, 0.025, 0.035) + vec3(0.55, 0.85, 1.0) * trail + vec3(1.0, 0.95, 0.85) * dot',
      note: [
        'Ink: the trail (a pixel-wide line on Distance with a faint glow) fading toward its tail (Along is 0 at the tail, 1 at the dot), and the dot itself drawn bright from Head.',
        'Nothing here is fixed: Distance, Along and Head are plain numbers, so colour and style them however you like.',
      ],
    }),
    out(['ink', 'result'], 1400, 200),
  ];
}

function knot(): GraphNode[] {
  const scene = n('sceneGroup', 'scene', 300, 500, {
    label: 'Knot', ...note(['The knot: one Curve Trace 3D. Time comes in through a port so the knot can turn (a Scene Group\'s inside is a function of position; outside values come in as ports).']),
    subgraph: sub([
      n('scenePos', 'sp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured.']) }),
      n('curveTrace3D', 'curve', 300, 200, {
        freqX: 3, freqY: 2, freqZ: 5, ampX: 1.0, ampY: 1.0, ampZ: 0.9, thickness: 0.07, segments: 240,
        ...note(['Curve Trace 3D: X, Y and Z each a sine (3, 2 and 5 cycles per turn): a closed 3D Lissajous curve, a knot. Thickness makes it a tube.', 'X phase comes from Time through the port, so the knot slowly winds through its shapes.']),
      }, { pos: ['sp', 'pos'] }),
      n('sceneOutput', 'so', 700, 200, { _groupOriginal: true, ...note(['Scene Output: the distance to the tube.']) }, { dist: ['curve', 'dist'] }),
    ], [{ key: 'ph', type: 'float', label: 'X phase', toNodeId: 'curve', toInputKey: 'phaseX' }]),
  });
  scene.inputs = { ...scene.inputs, ph: { type: 'float', label: 'X phase', connection: { nodeId: 'spin', outputKey: 'result' } } };
  const body = sub([
    n('marchLoopInputs', 'march_in', 0, 180, { _groupOriginal: true, ...note(['Group Inputs: the ray at this step.']) }),
    n('marchLoopOutput', 'march_out', 440, 180, { _groupOriginal: true, ...note(['Group Output: the point handed to the scene, unwarped.']) }, { pos: ['march_in', 'marchPos'] }),
  ]);
  const nodes: GraphNode[] = [
    n('time', 'time', 0, 300, note(['Time: winds the knot and turns the camera.'])),
    expr('spin', 0, 500, { label: 'Wind', inputs: [{ name: 't', type: 'float' }], lines: [], result: '1.5708 + 0.15 * t', outputType: 'float', wires: { t: ['time', 'time'] }, note: ['Wind: X phase starts at a quarter turn and creeps forward, so the knot slowly changes shape.'] }),
    n('marchCamera', 'cam', 0, 0, { camDist: 5.5, camAngle: 0.6, camElevation: 0.35, rotSpeed: 0.08, fov: 1.6, ...note(['March Camera: circles the knot slowly.']) }, { time: ['time', 'time'] }),
    scene,
    n('marchLoopGroup', 'march', 700, 200, { maxSteps: 120, maxDist: 30, bg: [0.04, 0.045, 0.07], albedo: [0.85, 0.55, 0.3], subgraph: body, ...note(['March Loop: finds the tube. Lit by Light the scene (Quick: no shadow rays, so the many-segment tube stays fast).']) }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
    n('output', 'out', 1600, 200),
  ];
  let k = 0;
  const lit = applyRecipe(nodes, 'march', LIGHT_RECIPES.find(r => r.id === 'light-quick')!, () => `lt${k++}`);
  return lit ? lit.nodes : nodes;
}

export function buildCurveTraceExamples(): Record<string, ExampleGraph> {
  return {
    curveTraceIntervals: {
      ...CURVE_TRACE_EXAMPLE_INDEX.curveTraceIntervals, counter: 40, nodes: intervals(),
      play: play([
        ctl('a', 'ra::value', 'Ratio top', 1, 9, 1),
        ctl('b', 'rb::value', 'Ratio bottom', 1, 9, 1),
        ctl('d', 'spd::value', 'Drift', 0, 1, 0.01),
      ], `**What it shows.** One musical interval drawn the four ways of a harmonograph chart. **Lateral**: X and Y swing on sine waves at the two frequencies (3 : 2 is a fifth), open phase (a quarter turn apart) and closed phase (in step, the figure folds onto itself). **Rotary**: the pen goes round two circles at once, turning the same way (concurrent: loops) or opposite ways (counter-current: stars with top + bottom points).

**How it is built.** Four **Curve Trace** nodes, one per column (Offset X places them), each a continuous line made of 320 straight pieces, measured as an exact distance. Their frequencies come from the two Ratio constants; Drift turns the second wave's phase. **Ink** draws each distance as a crisp line with a little glow, coloured along its length (Along).

**Try.** Ratios from the chart: 1:1, 2:1, 3:2, 4:3, 5:3, 5:4, 6:5, 8:5, 9:8. Set **Drift** to 0 to hold a figure still. On any curve's card switch Motion, change a wave to Triangle or Square, raise Damping and Turns for a harmonograph spiral, or set a wave to Custom and type your own formula in t.`),
    },
    curveTracePen: {
      ...CURVE_TRACE_EXAMPLE_INDEX.curveTracePen, counter: 20, nodes: pen(),
      play: play([
        ctl('s', 'curve::penSpeed', 'Pen speed', 0, 5, 0.01),
        ctl('t', 'curve::trail', 'Trail', 0.02, 1.5, 0.01),
        ctl('p', 'curve::phaseX', 'X phase', -3.1416, 3.1416, 0.01),
      ], `**What it shows.** A figure being drawn: a pen head runs along a 3 : 2 Lissajous curve and leaves a trail that fades behind it.

**How it is built.** One **Curve Trace** with Draw set to **Pen**: the head moves **Pen speed** turns a second, and the drawn part is the last **Trail** turns behind it. Along runs from 0 at the tail to 1 at the head, which **Ink** uses to fade the trail.

**Try.** Slow (0.05) to watch it draw; fast (3+) with Trail 1 and it becomes the continuous figure. Change the frequencies or switch Motion to Rotary on the card.`),
    },
    curveTraceMorph: {
      ...CURVE_TRACE_EXAMPLE_INDEX.curveTraceMorph, counter: 20, nodes: morph(),
      play: play([
        ctl('r', 'rate::value', 'Morph speed', 0, 2, 0.01),
        ctl('a', 'curve::freqXB', 'B: X frequency', 1, 9, 1),
        ctl('b', 'curve::freqYB', 'B: Y frequency', 1, 9, 1),
      ], `**What it shows.** One figure flowing into another: a fifth (3 : 2) morphing into a major third (5 : 4) and back.

**How it is built.** **Curve Trace** with **Morph** on works out both figures at every point along the curve and blends them by Morph amount, which **Flow** eases between 0 and 1 over time. Both figures are closed curves, so every in-between shape is closed too.

**Try.** Pick figure B's frequencies with the sliders. On the card, try Morph with Motion Rotary (opposite ways): a star flowering into another star.`),
    },
    curveTraceLive: {
      ...CURVE_TRACE_EXAMPLE_INDEX.curveTraceLive, counter: 20, nodes: live(),
      play: play([
        ctl('x', 'curve::freqX', 'X (Hz)', 0, 30, 0.01),
        ctl('y', 'curve::freqY', 'Y (Hz)', 0, 30, 0.01),
        ctl('p', 'curve::phaseX', 'X phase', -3.1416, 3.1416, 0.01),
        ctl('s', 'curve::persistence', 'Persistence (s)', 0.02, 1.5, 0.01),
      ], `**What it shows.** The museum harmonograph: two frequencies, X and Y, in cycles a second. At 0 Hz there is just a dot in the middle. At 1 and 1 it circles once a second, leaving a short trail. Turn them up and the dot moves faster; the trail (the last quarter second of its path) covers more and more of the figure until it is a solid line.

**How it is built.** One **Curve Trace** with Draw set to **Live**: time is real time, so a frequency is a speed, and **Persistence** is how many seconds of path stay on screen. **Ink** draws the trail fading toward its tail (Along) and the dot from **Head**.

**Try.** X 1, Y 1 is a circle; X 2, Y 1 a figure eight; X 3, Y 2 the fifth's pretzel. Slightly off ratios (X 3, Y 2.01) make the figure slowly turn, as the real machine does. Shorten Persistence to see only the dot, lengthen it to keep the whole figure.`),
    },
    curveTraceKnot: {
      ...CURVE_TRACE_EXAMPLE_INDEX.curveTraceKnot, counter: 60, nodes: knot(),
      play: play([
        ctl('a', 'cam::camAngle', 'Look around', 0, 6.28, 0.02),
        ctl('e', 'cam::camElevation', 'Camera height', -1, 1.2, 0.01),
      ], `**What it shows.** A 3D Lissajous curve: X, Y and Z each a sine wave (3, 2 and 5 cycles per turn), traced as a tube. The X phase creeps forward with time, so the knot slowly winds through its family of shapes.

**How it is built.** One **Curve Trace 3D** in a Scene Group: a continuous line of 240 straight pieces, as a tube distance field (Thickness), so it marches and lights like any shape. Lit with **Light the scene → Quick** (no shadow rays, so it stays fast): the sun button on the March Loop swaps the look, e.g. Studio for shadows.

**Try.** Open the Knot group: set Z frequency to 0 for a flat Lissajous ribbon, or try 2 : 3 : 7. Switch Motion to Rotary (opposite ways) for a 3D star with Z bobbing. Raise Damping and Turns for a spiral that winds inward.`),
    },
  };
}
