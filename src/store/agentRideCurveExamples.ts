/**
 * agentRideCurveExamples.ts — Ride a path (nodes/definitions/agentRidePath.ts, docs/agents-group.md
 * "Ride a path"): walkers riding the outline of a wired shape, in the Simulation folder.
 *
 *  - Walkers on a harmonograph: a 3 : 2 Lissajous Curve ridden by a band of walkers, drawn as streaks
 *    coloured by their speed, laying a glowing trail of the figure;
 *  - Riding outlines: a circle, a Lissajous Curve and a Chladni Field, one Shape slider blending them;
 *  - Morphing ribbon: an LFO sweeps a 3 : 2 Lissajous Curve's phase, folding it, the walkers following,
 *    each coloured by where round the figure it is.
 *
 * (The file keeps its name from Ride a curve, the node with curves built in that Ride a path replaced.)
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
    description: 'Sixty-five thousand walkers ride a 3 : 2 Lissajous Curve (a harmonograph\'s fifth) as a band, each in its own lane, drawn as streaks coloured by speed over the glowing trail they lay.',
    play: true,
  },
  agentRidePath: {
    label: 'Riding outlines',
    description: 'Walkers riding the outline of any shape wired into Ride a path: a circle, a Lissajous Curve, a Chladni plate\'s nodal lines. One Shape slider slides the path from one into the next, and the walkers follow, pulled back onto the outline every step.',
    play: true,
  },
  agentRideMorph: {
    label: 'Morphing ribbon',
    description: 'A ribbon of walkers on a figure that keeps changing: an LFO sweeps a 3 : 2 Lissajous Curve\'s phase, folding and unfolding it like a harmonograph, and every walker goes with it, coloured by where round the figure it is.',
    play: true,
  },
};
export const RIDE_CURVE_EXAMPLE_KEYS = Object.keys(RIDE_CURVE_EXAMPLE_INDEX);

/** A Play control on a slider inside a group: `group::node::param`. */
const inner = (id: string, group: string, node: string, param: string, label: string, min: number, max: number, step?: number): PlayControl =>
  ctl(id, `${group}::${node}::${param}`, label, min, max, step);

/** Emit for a ride: everyone at once, living for ever; Ride a path pulls each onto the outline in its first steps. */
const rideEmit = (id: string, x: number, y: number) => n('agentEmit', id, x, y, {
  mode: 'fill', shape: 'screen', heading: 'random', life: 0,
  ...note([
    'Emit: every walker is born at once, anywhere on the picture, and lives for ever (Fill, Life 0).',
    'Where it is born doesn\'t matter much: in its first steps Ride a path pulls it onto the outline, to the nearest point of it.',
  ]),
});

const inputsNode = (id: string, lines: string[]) => n('agentInputs', id, 0, 160, { _groupOriginal: true, extraInputs: [], ...note(lines) });

/** A Lissajous Curve's distance, for Path ƒ (UV unwired: inside a group it is worked out wherever Ride a path asks). */
const lissajous = (id: string, x: number, y: number, a: number, b: number, lines: string[]) => n('lissajous', id, x, y, {
  freq_a: a, freq_b: b, thickness: 0.004, delta: 1.5708, delta_speed: 0, ...note(lines),
});

// ── Walkers on a harmonograph ────────────────────────────────────────────────

export function rideHarmonographNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsNode('rhIn', [
    'Agent Inputs: this walker as the step begins. Ride a path reads its Position by itself (where it is now), so nothing needs wiring from here.',
  ]);
  const lis = lissajous('rhLis', 0, 420, 3, 2, [
    'Lissajous Curve: the distance to a 3 : 2 figure (X three times, Y twice per turn, X a quarter turn ahead: Phase 1.57), the fifth of a harmonograph chart.',
    'Its Distance goes into Ride a path\'s Path ƒ: the walkers ride its outline.',
    'Try: Freq A 5, Freq B 4 (a major third); Phase 0 folds the figure onto itself.',
  ]);
  const ride = n('agentRidePath', 'rhRide', 420, 120, {
    speed: 0.35, speedVar: 0.35, direction: 'one', level: 0.012, width: 0.03, wander: 0.25, wanderRate: 0.2,
    ...note([
      'Ride a path: each walker rides the Lissajous Curve\'s outline, Level 0.012 beside its line (a line\'s distance never goes below 0). Every step it is pulled onto the outline, slides along it and sits in its own lane.',
      'Speed 0.35 picture units a second, each walker ±35% (Speed variation), so they drift past each other; Ribbon width 0.03 spreads them into a band, and Wander 0.25 lets each sway a little across it.',
      'Try: Direction Random for two streams through each other; Ribbon width 0.1 for a wide river; Level 0.05 to ride further from the line.',
    ]),
  }, { path: ['rhLis', 'distance'] });
  const output = n('agentOutput', 'rhOut', 840, 140, {
    _groupOriginal: true,
    ...note([
      'Agent Output: Position and Velocity from Ride a path (Heading follows the velocity).',
    ]),
  }, { position: ['rhRide', 'position'], velocity: ['rhRide', 'velocity'] });
  const group = agentsGroup('rideHarmono', X(420), Y(0), 'rhEmit', [inputs, lis, ride, output], {
    label: 'Harmonograph riders', tier: '64k',
    ...note([
      'Agents: 65,536 walkers (64k), 2 steps a frame (each step asks the Lissajous Curve, 128 segments, where its line is: more walkers cost a lot). Inside (double-click): a Lissajous Curve wired into Ride a path\'s Path ƒ.',
      'Try: Count 256k for a denser band (four times the work); Steps per frame 4 to ride twice as fast.',
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
  inner('speed', 'rideHarmono', 'rhRide', 'speed', 'Speed', -1, 1, 0.001),
  inner('var', 'rideHarmono', 'rhRide', 'speedVar', 'Speed variation', 0, 1, 0.01),
  inner('width', 'rideHarmono', 'rhRide', 'width', 'Ribbon width', 0, 0.3, 0.001),
  inner('wander', 'rideHarmono', 'rhRide', 'wander', 'Wander', 0, 1, 0.01),
  inner('phase', 'rideHarmono', 'rhLis', 'delta', 'Figure phase', 0, 6.28, 0.01),
  ctl('again', 'rideHarmono::restart', 'Start over', 0, 1),
], `**What it shows.** Sixty-five thousand walkers riding a 3 : 2 Lissajous figure, the fifth of a harmonograph chart, as a band, each in its own lane across it, drawn as streaks over the trail they lay.

**How it's built.** Inside the Agents group, a **Lissajous Curve** wired into **Ride a path**'s Path ƒ. Every step each walker is pulled onto the curve's outline, slides along it by its own speed and sits in its lane. Agent Output takes its Position and Velocity. Outside, Deposit and a Trail lay the glow, and Draw agents draws streaks coloured by speed.

**Try.** **Speed** below 0 rides backward; **Speed variation** 0 keeps everyone together. **Ribbon width** 0 puts every walker on one thread; **Wander** sways them across the band. **Figure phase** opens and closes the figure, and the walkers follow it as it changes.`);

// ── Riding outlines ─────────────────────────────────────────────────────────

export function ridePathNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsNode('rpIn', [
    'Agent Inputs: this walker as the step begins. Ride a path reads its Position by itself (where it is now), so nothing needs wiring from here.',
  ]);
  const circle = n('circleSDF', 'rpCircle', 0, 360, {
    radius: 0.55, posX: 0, posY: 0,
    ...note([
      'Circle SDF: the distance to a circle of radius 0.55, negative inside. Its outline (0) is the circle itself.',
      'Inside an Agents group a shape is worked out at each walker\'s own position (UV unwired), so Ride a path can ask it "how far, and which way is the edge?" from anywhere.',
    ]),
  });
  const lis = n('lissajous', 'rpLis', 0, 560, {
    freq_a: 3, freq_b: 2, thickness: 0.02, delta: 1.5708, delta_speed: 0,
    ...note([
      'Lissajous Curve: the distance to a 3 : 2 figure. A line\'s distance never goes below 0, so the walkers ride Level (0.02) beside the line, not on it.',
      'Try: Freq A 5, Freq B 4.',
    ]),
  });
  const plate = n('chladniField', 'rpPlate', 0, 760, {
    n: 5, m: 3, mix: 1, scale: 1, geometry: 'square', aspect: 'square', bounded: 'plate',
    ...note([
      'Chladni Field: a vibrating square plate, + where it moves up, − down. Its outline (0) is the nodal lines, where sand gathers on a real plate.',
      '(Chladni Field, not Chladni Pattern: the Pattern draws its lines with screen derivatives, which an agent, not being a pixel, cannot use.)',
      'Try: n 7 and m 2 for another pattern; Mix 0 for a plain grid.',
    ]),
  });
  const pick = expr('rpPick', 300, 520, {
    label: 'Shape',
    inputs: [{ name: 'circle', type: 'float' }, { name: 'curve', type: 'float' }, { name: 'plate', type: 'float' }, { name: 'shape', type: 'float', slider: { min: 0, max: 2 } }],
    lines: [
      ['float a', 'mix(circle, curve, clamp(shape, 0.0, 1.0))'],
    ],
    result: 'mix(a, plate * 0.15, clamp(shape - 1.0, 0.0, 1.0))',
    outputType: 'float',
    values: { shape: 0 },
    wires: { circle: ['rpCircle', 'distance'], curve: ['rpLis', 'distance'], plate: ['rpPlate', 'field'] },
    note: [
      'Shape (an Expression Block): which outline to ride, as one value to wire into Path ƒ. Shape 0 is the circle, 1 the Lissajous Curve, 2 the plate; in between, one melts into the next.',
      'a: the circle blended into the curve, by Shape from 0 to 1.',
      'Result: a blended into the plate\'s field (scaled down by 0.15 to about the same size as a distance), by Shape from 1 to 2.',
    ],
  });
  const ride = n('agentRidePath', 'rpRide', 600, 120, {
    speed: 0.3, level: 0.02, speedVar: 0.4, direction: 'both', width: 0.03, wander: 0.3, wanderRate: 0.3,
    ...note([
      'Ride a path: each walker rides the outline of the shape wired into Path ƒ, where it equals Level (0.02).',
      'Every step it is pulled onto the outline along the shape\'s slope, slides along it by its speed (Speed 0.3 picture units a second, ±40%), and sits across it in its own lane (Ribbon width 0.03). Direction Both sends half of them the other way.',
      'Try: Level 0.1 to ride further out; Ribbon width 0 for one thin thread.',
    ]),
  }, { path: ['rpPick', 'result'] });
  const output = n('agentOutput', 'rpOut', 900, 140, {
    _groupOriginal: true,
    ...note([
      'Agent Output: Position and Velocity from Ride a path (Heading follows the velocity).',
    ]),
  }, { position: ['rpRide', 'position'], velocity: ['rpRide', 'velocity'] });
  const group = agentsGroup('ridePath', X(420), Y(0), 'rpEmit', [inputs, circle, lis, plate, pick, ride, output], {
    label: 'Outline riders',
    tier: '64k',
    ...note([
      'Agents: 65,536 walkers, 2 steps a frame. Inside (double-click): three shapes, the Shape block choosing between them, and Ride a path riding the result.',
    ]),
  });
  const draw = n('drawAgents', 'rpDraw', X(840), Y(0), {
    style: 'streaks', colorBy: 'heading', size: 1.5, brightness: 0.15, glow: 0.8, streak: 0.6, scaleBy: 'crowd', fade: 'off', lights: '0',
    ...note([
      'Draw agents, Streaks coloured by Heading: walkers going opposite ways round the outline get opposite colours, so the two streams show.',
    ]),
  }, { agents: ['ridePath', 'agents'] });
  const nodes = [rideEmit('rpEmit', X(0), Y(0)), group, draw];
  if (withOutput) nodes.push(n('output', 'rpOutput', X(1260), Y(0), { ...note(['Output: the riders are the picture.']) }, { color: ['rpDraw', 'color'] }));
  return nodes;
}

const pathPlay = play([
  inner('shape', 'ridePath', 'rpPick', 'shape', 'Shape (circle · curve · plate)', 0, 2, 0.001),
  inner('speed', 'ridePath', 'rpRide', 'speed', 'Speed', -1, 1, 0.001),
  inner('level', 'ridePath', 'rpRide', 'level', 'Level', -0.2, 0.3, 0.001),
  inner('width', 'ridePath', 'rpRide', 'width', 'Ribbon width', 0, 0.2, 0.001),
  ctl('again', 'ridePath::restart', 'Start over', 0, 1),
], `**What it shows.** Walkers riding the outline of whatever shape is wired into **Ride a path**: a circle, a 3 : 2 Lissajous Curve, the nodal lines of a Chladni plate. Slide **Shape** and the path melts from one into the next; the walkers follow, because every step pulls them back onto it.

**How it's built.** Inside the Agents group, three shapes feed one Expression Block, **Shape**, that blends them into one value. That goes into Ride a path's **Path ƒ**: a field socket, so the node can ask the shape at any point, not just read one number. Each step it finds the edge along the shape's slope, slides along it and sits in its lane.

**Try.** **Level** rides a different outline: a little above 0 outside the shape, below 0 inside. Wire any other shape into Path ƒ: a Star SDF, Metaballs, noise, text.`);

// ── Morphing ribbon ─────────────────────────────────────────────────────────

export function rideMorphNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsNode('rmIn', [
    'Agent Inputs: this walker as the step begins. Ride a path reads its Position by itself (where it is now).',
  ]);
  const lfo = n('lfo', 'rmLfo', 0, 760, {
    waveform: 'sine', freq: 0.05, phase: 0, amplitude: 1.5708, offset: 1.5708,
    ...note([
      'LFO: a slow sine between 0 and π (Amplitude π/2 around Offset π/2), once every 20 seconds: the figure\'s phase. It runs on the simulation\'s clock, so a recording morphs exactly as the preview.',
      'Try: Frequency 0.2 for a quicker breath; Waveform Triangle for a steady flow with sharp turns.',
    ]),
  });
  const lis = lissajous('rmLis', 300, 520, 3, 2, [
    'Lissajous Curve: a 3 : 2 figure whose Phase comes from the LFO. As the phase goes from 0 to π the figure opens out of a folded arch into the full pretzel and folds back the other way, a harmonograph slowly drifting.',
    'Try: Freq A 5, Freq B 4; Freq A 7, Freq B 6.',
  ]);
  (lis.inputs as Record<string, { connection?: { nodeId: string; outputKey: string } }>).delta.connection = { nodeId: 'rmLfo', outputKey: 'value' };
  const ride = n('agentRidePath', 'rmRide', 600, 120, {
    speed: 0.3, speedVar: 0.2, direction: 'one', level: 0.015, width: 0.06, wander: 0, wanderRate: 0.25,
    ...note([
      'Ride a path: the walkers ride the Lissajous Curve\'s outline as it is now, Level 0.015 beside the line, pulled back onto it every step, so the ribbon goes with the figure as it changes.',
      'Ribbon width 0.06, each walker in its own lane (Wander 0). Along (the angle round the middle, 0 → 1) and Speed go to Colour along.',
      'Try: Direction Random; Ribbon width 0 for one bright thread.',
    ]),
  }, { path: ['rmLis', 'distance'] });
  const colour = expr('rmColour', 900, 440, {
    label: 'Colour along',
    inputs: [{ name: 'along', type: 'float' }, { name: 'speed', type: 'float' }],
    lines: [
      ['vec3 hue', '0.5 + 0.5 * cos(6.2831853 * (along + vec3(0.0, 0.33, 0.67)))'],
      ['float lift', '0.55 + 0.45 * smoothstep(0.0, 0.5, speed)'],
    ],
    result: 'hue * lift',
    outputType: 'vec3',
    wires: { along: ['rmRide', 'along'], speed: ['rmRide', 'speed'] },
    note: [
      'Colour along (an Expression Block): each walker\'s own colour, for Draw agents\' Colour by Agent.',
      'hue: a rainbow once round the picture, from where round the middle the walker is (Along, 0 → 1), so each part of the figure keeps its colour as it folds.',
      'lift: brighter where the walker moves fast (Speed, picture units a second).',
      'Result: the rainbow, lit by speed.',
    ],
  });
  const output = n('agentOutput', 'rmOut', 1260, 140, {
    _groupOriginal: true,
    ...note([
      'Agent Output: Position and Velocity from Ride a path, Colour from Colour along.',
    ]),
  }, { position: ['rmRide', 'position'], velocity: ['rmRide', 'velocity'], colour: ['rmColour', 'result'] });
  const group = agentsGroup('rideMorph', X(420), Y(0), 'rmEmit', [inputs, lfo, lis, ride, colour, output], {
    label: 'Morphing ribbon', tier: '64k',
    ...note([
      'Agents: 65,536 walkers (64k), 2 steps a frame (each step asks the Lissajous Curve, 128 segments, where its line is: more walkers cost a lot). Inside (double-click): an LFO turns a Lissajous Curve\'s phase, wired into Ride a path\'s Path ƒ; Colour along colours each walker.',
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
  inner('depth', 'rideMorph', 'rmLfo', 'amplitude', 'Morph depth', 0, 3.1416, 0.01),
  inner('speed', 'rideMorph', 'rmRide', 'speed', 'Speed', -1, 1, 0.001),
  inner('width', 'rideMorph', 'rmRide', 'width', 'Ribbon width', 0, 0.3, 0.001),
  ctl('again', 'rideMorph::restart', 'Start over', 0, 1),
], `**What it shows.** A ribbon of walkers on a figure that keeps changing: a 3 : 2 Lissajous folding and unfolding as its phase drifts, like a harmonograph's pen, the walkers going with it, coloured by where round the figure they are.

**How it's built.** Inside the Agents group, an **LFO** sweeps a **Lissajous Curve**'s Phase, and the curve goes into **Ride a path**'s Path ƒ, which pulls the walkers back onto the outline every step, whatever shape it is now. **Colour along** turns each walker's Along into a rainbow; Draw agents colours by Agent.

**Try.** **Morph speed** sets how fast the figure breathes; **Morph depth** how far it folds (0 holds it still). On the Lissajous Curve's card, Freq A and B pick the figure (5 : 4, 7 : 6). **Ribbon width** 0 threads every walker on the line.`);

export function buildRideCurveExamples(): Record<string, ExampleGraph> {
  return {
    agentRideHarmonograph: { ...RIDE_CURVE_EXAMPLE_INDEX.agentRideHarmonograph, counter: 40, nodes: rideHarmonographNodes(0, 200), play: harmonographPlay },
    agentRidePath: { ...RIDE_CURVE_EXAMPLE_INDEX.agentRidePath, counter: 40, nodes: ridePathNodes(0, 200), play: pathPlay },
    agentRideMorph: { ...RIDE_CURVE_EXAMPLE_INDEX.agentRideMorph, counter: 40, nodes: rideMorphNodes(0, 200), play: morphPlay },
  };
}
