/**
 * agentRideCurveExamples.ts — Ride a curve (nodes/definitions/agentRideCurve.ts, docs/agents-group.md
 * "Ride a curve"): walkers locked onto Curve Trace's curves, in the Simulation folder.
 *
 *  - Walkers on a harmonograph: a 3 : 2 Lissajous ridden by a band of walkers, drawn as streaks
 *    coloured by their speed, laying a glowing trail of the figure;
 *  - Morphing ribbon: the same ride with Morph on, an LFO flowing the figure from 3 : 2 into 5 : 4
 *    and back, each walker coloured by where along the curve it is.
 *
 * Every node, inside the group too, carries a plain-language note; every Expression Block explains
 * each named line (examples.test.ts checks both). Each loads with Play controls on the ride itself.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { PlayControl } from '../types/play';
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, play } from './graphBuilder';
import { agentsGroup, expr, note } from './agentExampleKit';

export const RIDE_CURVE_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  agentRideHarmonograph: {
    label: 'Walkers on a harmonograph',
    description: 'A quarter of a million walkers ride a 3 : 2 Lissajous figure (a harmonograph\'s fifth) as a band: each keeps its own place along the curve in Memory and its own lane across it. They speed up on the long sweeps and slow at the turns, drawn as streaks coloured by speed over the glowing trail they lay.',
    play: true,
  },
  agentRideMorph: {
    label: 'Morphing ribbon',
    description: 'A ribbon of walkers on a figure that keeps changing: an LFO flows the curve from a fifth (3 : 2) into a major third (5 : 4) and back, and every walker goes with it, coloured by where along the curve it is, so the colours braid as the figure folds.',
    play: true,
  },
};
export const RIDE_CURVE_EXAMPLE_KEYS = Object.keys(RIDE_CURVE_EXAMPLE_INDEX);

/** A Play control on a slider inside a group: `group::node::param`. */
const inner = (id: string, group: string, node: string, param: string, label: string, min: number, max: number, step?: number): PlayControl =>
  ctl(id, `${group}::${node}::${param}`, label, min, max, step);

/** Emit for a ride: everyone at once, living for ever; Ride a curve puts each on the curve on its first step. */
const rideEmit = (id: string, x: number, y: number) => n('agentEmit', id, x, y, {
  mode: 'fill', shape: 'screen', heading: 'random', life: 0,
  ...note([
    'Emit: every walker is born at once, anywhere on the picture, and lives for ever (Fill, Life 0).',
    'Where it is born doesn\'t matter: on its first step Ride a curve puts it at its own place along the curve (Spread inside the group).',
  ]),
});

const inputsNode = (id: string, lines: string[]) => n('agentInputs', id, 0, 160, { _groupOriginal: true, extraInputs: [], ...note(lines) });

// ── Walkers on a harmonograph ────────────────────────────────────────────────

export function rideHarmonographNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsNode('rhIn', [
    'Agent Inputs: this walker as the step begins. Ride a curve reads its Memory by itself (where along the curve it is), so nothing needs wiring from here.',
  ]);
  const ride = n('agentRideCurve', 'rhRide', 420, 120, {
    speed: 0.04, speedVar: 0.35, direction: 'one', spread: 'random', spreadOver: 1, width: 0.05, wander: 0.25, wanderRate: 0.2, loop: 'wrap',
    mode: 'lateral', turns: 1, damping: 0,
    waveX: 'sine', freqX: 3, phaseX: 1.5708, ampX: 0.95, offX: 0,
    waveY: 'sine', freqY: 2, phaseY: 0, ampY: 0.75, offY: 0,
    ...note([
      'Ride a curve: the 3 : 2 Lissajous figure (X 3 times, Y twice per turn, X a quarter turn ahead), Curve Trace\'s curve. Each walker keeps its place along it in Memory, moves on by its own speed every step and stands on the curve there.',
      'Speed 0.04 turns a second (25 s round), each walker ±35% (Speed variation), so they drift past each other; Ribbon width 0.05 spreads them across the curve into a band, and Wander 0.25 lets each sway a little across it.',
      'Velocity is the curve\'s tangent × its speed, so walkers run fast on the long sweeps and slowly round the turns: Draw agents colours exactly that.',
      'Try: X frequency 5 and Y frequency 4 (a major third); Motion Rotary, opposite ways for a star; Direction Random for two streams through each other; Ribbon width 0.2 for a wide river.',
    ]),
  });
  const output = n('agentOutput', 'rhOut', 840, 140, {
    _groupOriginal: true,
    ...note([
      'Agent Output: Position and Velocity from Ride a curve (Heading follows the velocity). Memory is left unwired: a Ride a curve inside sends its own there by itself, so the walker remembers where along the curve it is.',
    ]),
  }, { position: ['rhRide', 'position'], velocity: ['rhRide', 'velocity'] });
  const group = agentsGroup('rideHarmono', X(420), Y(0), 'rhEmit', [inputs, ride, output], {
    label: 'Harmonograph riders',
    ...note([
      'Agents: 262,144 walkers (256k), 2 steps a frame. Inside (double-click): one Ride a curve node, wired to Agent Output.',
      'Try: Count 1M for a denser band; Steps per frame 4 to ride twice as fast.',
    ]),
  });
  const deposit = n('agentDeposit', 'rhDeposit', X(840), Y(260), {
    amount: 0.4,
    ...note([
      'Deposit: every walker leaves a little trail where it stands, every step, so the band paints the figure as it goes round.',
    ]),
  }, { agents: ['rideHarmono', 'agents'] });
  const trail = n('trailField', 'rhTrail', X(1260), Y(260), {
    resolution: '0.5', diffuse: 0.3, halfLife: 0.6, edges: 'wrap', kernel: '3', gain: 0.02,
    ...note([
      'Trail field: the trail the walkers lay, spreading a little and fading with a Half-life of 0.6 s, so it shows the last few seconds of the ride as a glow along the figure.',
      'Try: Half-life 3 for the whole figure burnt in.',
    ]),
  }, { deposit: ['rhDeposit', 'deposit'] });
  const glow = n('stopPalette', 'rhGlow', X(1680), Y(260), {
    stops: '3', wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
    color0: [0.0, 0.0, 0.0], color1: [0.05, 0.08, 0.22], color2: [0.3, 0.45, 0.9],
    ...note([
      'Stops Palette: the trail as a deep blue glow under the walkers (black where there is none).',
    ]),
  }, { value: ['rhTrail', 'amount'] });
  const draw = n('drawAgents', 'rhDraw', X(2100), Y(0), {
    style: 'streaks', colorBy: 'speed', palette: 'ab', colorA: [1.0, 0.35, 0.15], colorB: [1.0, 0.9, 0.55], speedRef: 1.2,
    size: 1.5, brightness: 0.1, glow: 0.8, streak: 0.5, scaleBy: 'crowd', fade: 'off', lights: '0',
    ...note([
      'Draw agents, Streaks: every walker a short glowing line along its velocity, over the trail\'s glow.',
      'Colour by Speed, red-orange (slow) to pale gold (fast, Fast is 1.2 picture units a second): the turns of the figure glow red where the walkers slow down, the long sweeps gold.',
      'Brightness 0.1 of The crowd: the whole crowd rides one thin band, so a little light each is plenty (higher washes the band out to white).',
      'Try: Colour by Heading for a rainbow round the figure; Streak 1.5 for long threads.',
    ]),
  }, { agents: ['rideHarmono', 'agents'], over: ['rhGlow', 'color'] });
  const nodes = [rideEmit('rhEmit', X(0), Y(0)), group, deposit, trail, glow, draw];
  if (withOutput) nodes.push(n('output', 'rhOutput', X(2520), Y(0), { ...note(['Output: the streaking walkers over their glowing trail are the picture.']) }, { color: ['rhDraw', 'color'] }));
  return nodes;
}

const harmonographPlay = play([
  inner('speed', 'rideHarmono', 'rhRide', 'speed', 'Speed (turns a second)', -0.3, 0.3, 0.001),
  inner('var', 'rideHarmono', 'rhRide', 'speedVar', 'Speed variation', 0, 1, 0.01),
  inner('width', 'rideHarmono', 'rhRide', 'width', 'Ribbon width', 0, 0.3, 0.001),
  inner('wander', 'rideHarmono', 'rhRide', 'wander', 'Wander', 0, 1, 0.01),
  inner('phase', 'rideHarmono', 'rhRide', 'phaseX', 'X phase', -3.1416, 3.1416, 0.01),
  ctl('again', 'rideHarmono::restart', 'Start over', 0, 1),
], `**What it shows.** A quarter of a million walkers riding a 3 : 2 Lissajous figure, the fifth of a harmonograph chart, as a band. Each one remembers its own place along the curve and its own lane across it; they run fast on the long sweeps and slow round the turns, so the colour (by speed) shows where the curve stretches.

**How it's built.** Inside the Agents group, one **Ride a curve** node: Curve Trace's curve (each axis a wave), and every step each walker moves its place along it by its own speed, stands on the curve there (offset across it within Ribbon width) and moves along the tangent. Agent Output takes its Position and Velocity; its place is kept in Memory by itself. Outside, Deposit and a Trail lay the glow, and Draw agents draws streaks coloured by speed.

**Try.** **Speed** below 0 rides backward; **Speed variation** 0 keeps everyone evenly spaced. **Ribbon width** 0 puts every walker on the line; **Wander** sways them across the band. **X phase** opens and closes the figure (0 folds it onto itself). On the Ride a curve card, change the frequencies, switch Motion to Rotary, or set a wave to Custom.`);

// ── Morphing ribbon ─────────────────────────────────────────────────────────

export function rideMorphNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsNode('rmIn', [
    'Agent Inputs: this walker as the step begins. Ride a curve reads its Memory by itself (where along the curve it is).',
  ]);
  const lfo = n('lfo', 'rmLfo', 0, 520, {
    waveform: 'sine', freq: 0.05, phase: 0, amplitude: 0.5, offset: 0.5,
    ...note([
      'LFO: a slow sine between 0 and 1 (Amplitude 0.5 around Offset 0.5), once every 20 seconds: the Morph amount. It runs on the simulation\'s clock, so a recording morphs exactly as the preview.',
      'Try: Frequency 0.2 for a quicker breath; Waveform Triangle for a steady flow with sharp turns.',
    ]),
  });
  const ride = n('agentRideCurve', 'rmRide', 420, 120, {
    speed: 0.03, speedVar: 0.2, direction: 'one', spread: 'even', spreadOver: 1, width: 0.08, wander: 0, wanderRate: 0.25, loop: 'wrap',
    mode: 'lateral', turns: 1, damping: 0,
    waveX: 'sine', freqX: 3, phaseX: 1.5708, ampX: 0.95, offX: 0,
    waveY: 'sine', freqY: 2, phaseY: 0, ampY: 0.75, offY: 0,
    morphOn: true, morph: 0, freqXB: 5, freqYB: 4,
    ...note([
      'Ride a curve with Morph on: figure A is the 3 : 2 Lissajous (the frequencies), figure B the 5 : 4 (the B frequencies), and every point of the curve moves between them as Morph amount goes 0 → 1. Both are closed, so every shape in between is too, and the walkers ride whatever shape it is now.',
      'Morph amount is wired from the LFO. Spread: evenly spaced by Index, so the ribbon starts as one smooth band; Ribbon width 0.08, each walker in its own lane (Wander 0).',
      'Along (0 at the start of the curve, 1 at its end) goes to Colour along.',
      'Try: B frequencies 7 and 6; Motion Rotary, opposite ways (stars that morph); Loop Ping-pong.',
    ]),
  }, { morph: ['rmLfo', 'value'] });
  const colour = expr('rmColour', 840, 440, {
    label: 'Colour along',
    inputs: [{ name: 'along', type: 'float' }, { name: 'speed', type: 'float' }],
    lines: [
      ['vec3 hue', '0.5 + 0.5 * cos(6.2831853 * (along + vec3(0.0, 0.33, 0.67)))'],
      ['float lift', '0.55 + 0.45 * smoothstep(0.0, 1.5, speed)'],
    ],
    result: 'hue * lift',
    outputType: 'vec3',
    wires: { along: ['rmRide', 'along'], speed: ['rmRide', 'speed'] },
    note: [
      'Colour along (an Expression Block): each walker\'s own colour, for Draw agents\' Colour by Agent.',
      'hue: a rainbow once round the curve, from where along it the walker is (Along, 0 → 1), so each stretch of the figure keeps its colour as it folds.',
      'lift: brighter where the walker moves fast (Speed, picture units a second), dimmer round the slow turns.',
      'Result: the rainbow, lit by speed.',
    ],
  });
  const output = n('agentOutput', 'rmOut', 1260, 140, {
    _groupOriginal: true,
    ...note([
      'Agent Output: Position and Velocity from Ride a curve, Colour from Colour along. Memory is left unwired: Ride a curve keeps its place along the curve there by itself.',
    ]),
  }, { position: ['rmRide', 'position'], velocity: ['rmRide', 'velocity'], colour: ['rmColour', 'result'] });
  const group = agentsGroup('rideMorph', X(420), Y(0), 'rmEmit', [inputs, lfo, ride, colour, output], {
    label: 'Morphing ribbon',
    ...note([
      'Agents: 262,144 walkers (256k), 2 steps a frame. Inside (double-click): an LFO morphs Ride a curve\'s figure, Colour along colours each walker.',
    ]),
  });
  const draw = n('drawAgents', 'rmDraw', X(840), Y(0), {
    style: 'glow', colorBy: 'agent', palette: 'ab', size: 1.25, brightness: 0.3, glow: 1, scaleBy: 'crowd', fade: 'off', lights: '0',
    ...note([
      'Draw agents, Glow: every walker a soft glowing dot in its own colour (Colour by Agent: Colour along, inside the group).',
      'Try: Style Streaks with Streak 1 for silk threads.',
    ]),
  }, { agents: ['rideMorph', 'agents'] });
  const nodes = [rideEmit('rmEmit', X(0), Y(0)), group, draw];
  if (withOutput) nodes.push(n('output', 'rmOutput', X(1260), Y(0), { ...note(['Output: the ribbon is the picture.']) }, { color: ['rmDraw', 'color'] }));
  return nodes;
}

const morphPlay = play([
  inner('rate', 'rideMorph', 'rmLfo', 'freq', 'Morph speed', 0.01, 0.5, 0.01),
  inner('xb', 'rideMorph', 'rmRide', 'freqXB', 'B: X frequency', 1, 9, 1),
  inner('yb', 'rideMorph', 'rmRide', 'freqYB', 'B: Y frequency', 1, 9, 1),
  inner('speed', 'rideMorph', 'rmRide', 'speed', 'Speed (turns a second)', -0.3, 0.3, 0.001),
  inner('width', 'rideMorph', 'rmRide', 'width', 'Ribbon width', 0, 0.3, 0.001),
  ctl('again', 'rideMorph::restart', 'Start over', 0, 1),
], `**What it shows.** A ribbon of walkers on a figure that keeps changing: a fifth (3 : 2) flowing into a major third (5 : 4) and back, the walkers going with it, coloured by where along the curve they are.

**How it's built.** Inside the Agents group, **Ride a curve** with Morph on works out both figures at every walker's place and blends them by Morph amount, which an **LFO** sweeps between 0 and 1. **Colour along** turns each walker's Along into a rainbow, brighter where it moves fast; Draw agents colours by Agent.

**Try.** **Morph speed** sets how fast the figure breathes; the **B frequencies** pick the figure it becomes (7 : 6, 2 : 1). **Ribbon width** 0 threads every walker on the line.`);

export function buildRideCurveExamples(): Record<string, ExampleGraph> {
  return {
    agentRideHarmonograph: { ...RIDE_CURVE_EXAMPLE_INDEX.agentRideHarmonograph, counter: 40, nodes: rideHarmonographNodes(0, 200), play: harmonographPlay },
    agentRideMorph: { ...RIDE_CURVE_EXAMPLE_INDEX.agentRideMorph, counter: 40, nodes: rideMorphNodes(0, 200), play: morphPlay },
  };
}
