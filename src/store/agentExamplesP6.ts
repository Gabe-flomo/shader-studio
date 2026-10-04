/**
 * agentExamplesP6.ts — the Agents presets of P6 (docs/agents-plan.md §12): Galaxy,
 * Mycelium and Sand on a plate. Each is also an example; every node,
 * inside the group too, carries a plain-language note, and every Expression Block
 * explains each named line ("name: …"), which examples.test.ts checks.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';
import { agentsGroup, expr, groupInput, note, withOutputs } from './agentExampleKit';

// ── Galaxy ──────────────────────────────────────────────────────────────────

/**
 * Galaxy: a million stars circling a bright bulge, crowding into two spiral arms
 * that turn slowly (a density wave: the arms are a pattern the stars pass through,
 * not the same stars), warm in the core and blue in the arms, with a few pink
 * star-forming knots. Each star remembers its own orbit (Memory), so the galaxy
 * keeps its shape for ever.
 */
export function galaxyNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  // ── Inside: the rule every star follows, every step ──
  const inputs = n('agentInputs', 'gxIn', 0, 160, {
    _groupOriginal: true, extraInputs: [],
    ...note([
      'Agent Inputs: this star as the step begins: where it is (Position), what it remembers (Memory: the radius of its own orbit, 0 on its first step) and its number (Index), which Star colour uses to give each star a colour of its own.',
    ]),
  });
  const time = n('time', 'gxTime', 0, 620, {
    ...note(['Time: the simulation\'s clock (each step\'s own time), so the spiral pattern turns at the same pace in the preview and in a recording.']),
  });
  const orbit = expr('gxOrbit', 420, 40, {
    label: 'Orbit and arms',
    inputs: [
      { name: 'p', type: 'vec2' }, { name: 'mem', type: 'vec2' }, { name: 't', type: 'float' },
      { name: 'spin', type: 'float', slider: { min: 0, max: 2 } }, { name: 'arms', type: 'float', slider: { min: 0, max: 0.4 } },
      { name: 'wind', type: 'float', slider: { min: 0, max: 12 } }, { name: 'pattern', type: 'float', slider: { min: -1, max: 1 } },
    ],
    values: { spin: 0.5, arms: 0.12, wind: 6, pattern: 0.12 },
    lines: [
      ['float home', 'mem.x > 0.0 ? mem.x : length(p) + 1e-3'],
      ['float vc', 'spin * home / (home + 0.12)'],
      ['float angle', 'atan(p.y, p.x) + vc / home / 60.0'],
      ['float disc', 'smoothstep(0.08, 0.3, home)'],
      ['float phase', '2.0 * angle - wind * log(home) - pattern * t'],
      ['float r', 'home * (1.0 + arms * cos(phase) * disc)'],
      ['float crest', 'pow(0.5 + 0.5 * cos(phase + 0.35), 4.0) * disc'],
      ['vec2 next', 'r * vec2(cos(angle), sin(angle))'],
      ['vec2 vel', '(next - p) * 60.0'],
      ['vec2 keep', 'vec2(home, 0.0)'],
    ],
    result: 'next',
    outputType: 'vec2',
    exposed: [{ name: 'vel', type: 'vec2' }, { name: 'keep', type: 'vec2' }, { name: 'crest', type: 'float' }],
    wires: { p: ['gxIn', 'position'], mem: ['gxIn', 'memory'], t: ['gxTime', 'time'] },
    note: [
      'Orbit and arms (an Expression Block): moves each star one step round its own circular orbit and bends that orbit a little into two spiral arms. Its Result is the star\'s new position.',
      'home: the radius of the star\'s own orbit: what it remembers (Memory), or, on its first step, how far from the centre it was born.',
      'vc: the orbit speed at that radius, rising from the centre and then nearly the same at every radius (Spin), as real galaxies spin: inner stars go round far more often, so any pattern made of the same stars would wind up.',
      'angle: where round the orbit the star is after this step (one step is 1/60 s).',
      'disc: 0 in the bulge, 1 out in the disc, so the arms start outside the core.',
      'phase: where the star is against a two-armed logarithmic spiral (Wind: how tightly it winds), turning slowly with time (Pattern).',
      'r: the orbit bent in and out by the spiral (Arms: how much). Neighbouring orbits bend by different amounts, so stars bunch where they come close: that crowding is the arms, and it stays put while the stars stream through it.',
      'crest: 1 where the stars bunch, 0 between the arms (an output: Star colour lights the stars up there, as young stars are born in the arms).',
      'next: the new position. vel: the step as a velocity (an output, for Agent Output). keep: home again, to remember (an output, for Agent Output\'s Memory).',
      'Try: Arms 0 for a smooth disc; Wind 10 for tightly wound arms; Pattern 0 for arms that stand still; Spin 1 to turn twice as fast.',
    ],
  });
  const colour = expr('gxColour', 840, 520, {
    label: 'Star colour',
    inputs: [{ name: 'i', type: 'float' }, { name: 'home', type: 'vec2' }, { name: 'crest', type: 'float' }],
    lines: [
      ['float r', 'home.x'],
      ['float h', 'fract(sin(i * 12.9898) * 43758.5453)'],
      ['vec3 core', 'vec3(1.0, 0.8, 0.55) * (0.08 + 1.4 * exp(-r * r * 40.0))'],
      ['vec3 young', 'mix(vec3(0.55, 0.72, 1.0), vec3(1.0, 0.45, 0.7), step(0.95, h)) * (0.55 + 0.9 * h)'],
      ['vec3 old', 'vec3(0.75, 0.68, 0.62) * 0.14'],
      ['vec3 disc', 'mix(old, young, crest) * (0.5 + exp(-r * 1.6))'],
    ],
    result: 'mix(core, disc, smoothstep(0.06, 0.32, r))',
    outputType: 'vec3',
    wires: { i: ['gxIn', 'index'], home: ['gxOrbit', 'keep'], crest: ['gxOrbit', 'crest'] },
    note: [
      'Star colour (an Expression Block): each star\'s own colour, for Draw agents\' Colour by Agent.',
      'r: the radius of the star\'s orbit. h: a number 0–1 of the star\'s own (from its Index), the same every step.',
      'core: the old, warm stars of the bulge, blazing in the middle and fading outward. young: blue, some brighter than others (by h), and one star in twenty pink, like the star-forming knots along real spiral arms. old: dim, dusty stars between the arms.',
      'disc: old turning young where crest (Orbit and arms) says the star is in an arm, so the arms light up as stars pass through them; brighter toward the middle, as a galaxy\'s disc is.',
      'Result: core in the middle turning to disc further out.',
    ],
  });
  const output = n('agentOutput', 'gxOut', 1260, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Orbit and arms, Memory its orbit\'s radius (keep), Colour from Star colour. Heading follows the velocity.']),
  }, { position: ['gxOrbit', 'result'], velocity: ['gxOrbit', 'vel'], memory: ['gxOrbit', 'keep'], colour: ['gxColour', 'result'] });

  // ── Outside ──
  const disc = n('agentEmit', 'gxDisc', X(0), Y(160), {
    mode: 'fill', shape: 'disc', heading: 'random', x: 0, y: 0, size: 0.95, life: 0, share: 3,
    ...note([
      'Emit (the disc): three quarters of the stars are born anywhere in a wide disc (radius 0.95); each circles at the radius it was born at.',
      'Its Also chains the bulge Emit in: births are shared by Share (3 here, 1 there).',
    ]),
  }, { also: ['gxBulge', 'emitter'] });
  const bulge = n('agentEmit', 'gxBulge', X(0), Y(-160), {
    mode: 'fill', shape: 'disc', heading: 'random', x: 0, y: 0, size: 0.45, life: 0, share: 1,
    ...note([
      'Emit (the bulge): a quarter of the stars are born in a disc in the middle (radius 0.45), so the middle is denser; Star colour makes its centre blaze.',
      'Fill with Life 0: every star is born at the start and lives for ever.',
    ]),
  });
  const group = agentsGroup('galaxy', X(420), Y(0), 'gxDisc', [inputs, time, orbit, colour, output], {
    label: 'Galaxy', preroll: 2,
    ...note([
      'Agents: a million stars (1M), 2 steps a frame. Inside (double-click): Orbit and arms moves each star round its orbit, Star colour colours it.',
      'Pre-roll 2: two seconds simulated before the first frame, so the stars have found their places in the arms when it appears.',
      'Try: Count 256k for a sparser, grainier galaxy; Steps per frame 4 to spin it twice as fast.',
    ]),
  });
  const uv = n('uv', 'gxUv', X(420), Y(420), { ...note(['UV: where each pixel is, for the glow behind the stars.']) });
  const sky = expr('gxSky', X(840), Y(420), {
    label: 'Deep space',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [['float r', 'length(uv)'], ['float glow', 'exp(-r * r * 9.0)']],
    result: 'vec3(0.004, 0.006, 0.014) + vec3(1.0, 0.75, 0.45) * 0.08 * glow',
    outputType: 'vec3',
    wires: { uv: ['gxUv', 'uv'] },
    note: [
      'Deep space (an Expression Block): the dark behind the stars.',
      'r: how far this pixel is from the centre. glow: 1 in the middle fading out quickly, the unresolved light of the bulge.',
      'Result: near-black blue, with a faint warm haze round the core.',
    ],
  });
  const draw = n('drawAgents', 'gxDraw', X(1260), Y(0), {
    style: 'glow', colorBy: 'agent', palette: 'ab', scaleBy: 'crowd', size: 1.5, brightness: 1.3, glow: 1.1, fade: 'off', lights: '0',
    ...note([
      'Draw agents, Glow: every star a soft dot in its own colour (Colour by Agent: Star colour inside the group), with the Particles node\'s glow, so the crowded core and arms bloom.',
      'Try: Brightness 1 for a blazing core; Style Points for a crisp star field.',
    ]),
  }, { agents: ['galaxy', 'agents'], over: ['gxSky', 'result'] });
  const nodes = [bulge, disc, group, uv, sky, draw];
  if (withOutput) nodes.push(n('output', 'gxOutput', X(1680), Y(0), { ...note(['Output: the stars over deep space are the picture.']) }, { color: ['gxDraw', 'color'] }));
  return nodes;
}

// ── Mycelium ────────────────────────────────────────────────────────────────

/** Agent Inputs with a Trail input added to the group (a texture). */
function inputsWithTrail(id: string, lines: string[]): GraphNode {
  return withOutputs(n('agentInputs', id, 0, 160, {
    _groupOriginal: true,
    extraInputs: [{ key: 'trail', type: 'texture', label: 'Trail' }],
    ...note(lines),
  }), { trail: { type: 'texture', label: 'Trail' } });
}

/**
 * Mycelium: a fungus colony creeping out of a spore. Every hypha is a short walk by
 * a growing tip that shies away from threads already there; new tips sprout from the
 * young, thin threads at the colony's edge (Emit, Shape Field on the trail itself), so
 * the colony branches outward and fills in behind its front. The threads last.
 */
export function myceliumNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWithTrail('myIn', [
    'Agent Inputs: this growing tip as the step begins: where it is (Position) goes to Spread out.',
    'Trail is an input added to the group: the threads laid so far (the Trail field outside), as they were one step ago.',
  ]);
  const sense = n('agentSense', 'mySense', 420, 100, {
    angle: 40, distance: 0.02, weight: 1, width: '1',
    ...note([
      'Sense: each tip feels the threads 0.02 ahead, 40° to the left, straight on and 40° to the right.',
      'Steer is set to Away, so the tip turns toward the side with the fewest threads: hyphae grow into empty ground and spread evenly instead of piling up.',
      'Try: Angle 20° for straighter, more parallel hyphae.',
    ]),
  }, { texture: ['myIn', 'trail'] });
  const steer = n('agentSteer', 'mySteer', 840, 100, {
    mode: 'away', turn: 25, jitter: 0.3,
    ...note([
      'Steer, Away: turn 25° toward the emptier side, with some Jitter (0.3) so each hypha wanders a little, like real ones.',
      'Try: Jitter 0 for crisp, geometric branching; 0.8 for a fuzzy, frizzy mat.',
    ]),
  }, { readings: ['mySense', 'readings'] });
  const outward = expr('mySpread', 840, 520, {
    label: 'Spread out',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'drift', type: 'float', slider: { min: 0, max: 0.3 } }],
    values: { drift: 0.03 },
    lines: [['vec2 away', 'p / max(length(p), 1e-3)']],
    result: 'away * drift',
    outputType: 'vec2',
    wires: { p: ['myIn', 'position'] },
    note: [
      'Spread out (an Expression Block): a gentle drift away from the spore (Drift, 0.03 a second), added to the tip\'s walk (Move\'s Also velocity), as hyphae grow outward looking for food.',
      'away: the direction from the middle to the tip.',
      'Try: Drift 0 for a colony that grows as much inward as out; 0.1 for long, combed, star-like rays.',
    ],
  });
  const move = n('agentMove', 'myMove', 1260, 100, {
    speed: 0.08, edges: 'slide',
    ...note([
      'Move: one slow step (0.08 picture units a second) along the new heading, plus Spread out\'s drift. Slide at the edges: a tip that reaches the edge creeps along it.',
      'Try: Speed 0.16 to grow twice as fast (and longer, straighter hyphae).',
    ]),
  }, { heading: ['mySteer', 'heading'], also: ['mySpread', 'result'] });
  const output = n('agentOutput', 'myOutNode', 1680, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position, Heading and Velocity from Move. Alive is left unwired: a tip grows until its Life (from Emit) is up.']),
  }, { position: ['myMove', 'position'], heading: ['myMove', 'heading'], velocity: ['myMove', 'velocity'] });

  // ── Outside ──
  const young = expr('myYoung', X(0), Y(420), {
    label: 'Young threads',
    inputs: [{ name: 'a', type: 'float' }],
    lines: [],
    result: 'a * (1.0 - a) * 4.0',
    outputType: 'float',
    wires: { a: ['myTrail', 'amount'] },
    note: [
      'Young threads (an Expression Block): where new tips may sprout, from the trail\'s Amount: 1 on a thin, freshly laid thread (Amount about 0.5), 0 on bare ground and 0 on old cords walked over again and again.',
      'Result: a · (1 − a) · 4, a hill that peaks at one half.',
      'Why: the thin threads are the colony\'s edge, so that is where it branches; the old middle stops sprouting, as a real colony does once the food there is used up.',
    ],
  });
  const branch = n('agentEmit', 'myBranch', X(0), Y(0), {
    mode: 'rate', rate: 200, shape: 'field', threshold: 0.6, miss: 'skip', heading: 'random', life: 5, lifeVar: 0.5, share: 1,
    ...note([
      'Emit (branches): 200 new tips a second (Rate), each sprouting on a young thread (Shape Field: Young threads above 0.6, wired into Where ƒ), facing anywhere, and growing for about 5 s.',
      'No place found: Not born this time. While the colony is tiny most tries miss, so it starts slowly and speeds up as it grows, instead of tips appearing in empty ground.',
      'Its Also chains the spore in: births are shared by Share.',
    ]),
  }, { where: ['myYoung', 'result'], also: ['mySpore', 'emitter'] });
  const spore = n('agentEmit', 'mySpore', X(0), Y(-260), {
    mode: 'rate', shape: 'disc', heading: 'random', x: 0, y: 0, size: 0.02, life: 5, lifeVar: 0.5, share: 0.02,
    ...note([
      'Emit (the spore): a tiny share of the tips (Share 0.02 against the branches\' 1) start from a spore in the middle (radius 0.02). They lay the first threads that the branches then sprout from.',
      'Try: X and Y to move the spore; a Ring of Size 0.5 for a fairy ring.',
    ]),
  });
  let group = agentsGroup('mycelium', X(420), Y(0), 'myBranch', [inputs, sense, steer, outward, move, output], {
    label: 'Mycelium', tier: '64k',
    ...note([
      'Agents: room for 65,536 tips (64k); about a thousand grow at once (200 born a second, 5 s each), 2 steps a frame. Inside (double-click): Sense → Steer (Away) → Move, with Spread out pushing the tips away from the spore.',
      'No pre-roll: the colony grows from nothing and reaches the edges in about a minute.',
      'Try: Rate 600 on the branches Emit for a denser, faster colony.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['myTrail', 'texture']);
  const deposit = n('agentDeposit', 'myDeposit', X(840), Y(0), {
    amount: 1, size: 1,
    ...note(['Deposit: every tip lays 1 unit of thread a step where it goes.']),
  }, { agents: ['mycelium', 'agents'] });
  const trail = n('trailField', 'myTrail', X(1260), Y(0), {
    resolution: '1024', diffuse: 0.05, halfLife: 60, edges: 'clamp', gain: 0.6,
    ...note([
      'Trail field: the threads, 1024 rows. It hardly spreads (Diffuse 0.05) and lasts (half-life 60 s), so hyphae stay thin and the colony keeps its shape while it grows.',
      'Gain 0.6: a thread walked once reads about one half (Young threads looks for those); walked over many times it reads near 1.',
    ]),
  }, { deposit: ['myDeposit', 'deposit'] });
  const colour = n('stopPalette', 'myColour', X(1680), Y(0), {
    stops: '5', wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
    color0: [0.02, 0.016, 0.012], color1: [0.2, 0.14, 0.09], color2: [0.42, 0.33, 0.23], color3: [0.8, 0.75, 0.64], color4: [1.0, 0.99, 0.95],
    ...note([
      'Stops Palette: the threads\' Amount as colour: dark soil where there are none, brown and tan on young threads, bone white in the old cords.',
      'Try: black to teal to white for a glowing, deep-sea look.',
    ]),
  }, { value: ['myTrail', 'amount'] });
  const draw = n('drawAgents', 'myDraw', X(2100), Y(0), {
    style: 'glow', colorBy: 'single', palette: 'ab', colorA: [1.0, 0.82, 0.5], scaleBy: 'crowd', size: 1, brightness: 0.12, glow: 0.8, fade: 'on', lights: '0',
    ...note([
      'Draw agents: the growing tips themselves as faint warm sparks over the threads (Over), fading in and out over their short life, so the growing edge glows.',
      'Try: Brightness 0 to see only the threads.',
    ]),
  }, { agents: ['mycelium', 'agents'], over: ['myColour', 'color'] });
  const nodes = [spore, branch, young, group, deposit, trail, colour, draw];
  if (withOutput) nodes.push(n('output', 'myOutput', X(2520), Y(0), { ...note(['Output: the threads and the glowing tips are the picture.']) }, { color: ['myDraw', 'color'] }));
  return nodes;
}

// ── Sand on a plate ─────────────────────────────────────────────────────────

/**
 * Sand on a plate: a million grains on a square metal plate that a silent beat sets
 * ringing. The sand is shaken off wherever the plate moves and comes to rest on its
 * still lines, drawing a Chladni figure; every beat the plate rings at another
 * mode and the sand runs to the new figure.
 */
export function sandPlateNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = n('agentInputs', 'spIn', 0, 160, {
    _groupOriginal: true, extraInputs: [],
    ...note([
      'Agent Inputs: this grain as the step begins. Chladni reads its Position and Velocity by itself (unwired sockets mean "this grain").',
    ]),
  });
  const plate = n('agentChladni', 'spPlate', 420, 100, {
    shape: 'square', symmetry: 'minus', modeFrom: 'sound', modeN: 3, modeM: 5, modes: 3, plateFreq: 1.4, plateWeights: 0.5,
    size: 0.92, x: 0, y: 0, settle: 1, shake: 0.9, soundFrom: 'graph', level: 0, beat: 0,
    ...note([
      'Chladni: the plate (square, 0.92 each way from the middle). Where it moves, the grain is shaken about (Shake 0.9); everywhere it slides down toward the still lines (Settle 1). That is how sand draws a Chladni figure.',
      'Mode from Sound: what the plate hears picks the figure, and here it hears the group\'s silent Beat: each beat steps the figure on, three modes summed (Modes 3, Weights 0.5) for lace-like figures.',
      'Try: Mode from N and M with N 3, M 5 for one classic still figure; Plate Round for rings and spokes; Settle 4 for crisp, fast lines.',
    ]),
  });
  const output = n('agentOutput', 'spOut', 840, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Chladni (the plate moves the grain directly; no forces, no Integrate).']),
  }, { position: ['spPlate', 'position'], velocity: ['spPlate', 'velocity'] });

  const emit = n('agentEmit', 'spEmit', X(0), Y(0), {
    mode: 'fill', shape: 'box', heading: 'random', x: 0, y: 0, size: 0.92, life: 0,
    ...note([
      'Emit: every grain is poured onto the plate at the start, evenly over the square (Box, 0.92 each way, the plate\'s size), and stays for ever (Life 0).',
    ]),
  });
  const group = agentsGroup('sand', X(420), Y(0), 'spEmit', [inputs, plate, output], {
    label: 'Sand on a plate', soundFrom: 'graph', level: 0, beat: 20, preroll: 3,
    ...note([
      'Agents: a million grains of sand (1M), 2 steps a frame. Inside (double-click): just Chladni, the plate.',
      'Sound from Level (and Beat), Beat 20: a silent stand-in, a kick every three seconds, so the figure changes on its own. Set Beat to 0 and Sound from to the Mic or the Audio engine to let music pick the figures.',
      'Pre-roll 3: the sand has found its first figure when the picture appears.',
    ]),
  });
  const uv = n('uv', 'spUv', X(420), Y(380), { ...note(['UV: where each pixel is, for the plate under the sand.']) });
  const metal = expr('spMetal', X(840), Y(380), {
    label: 'Metal plate',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [
      ['vec2 q', 'abs(uv) - vec2(0.92)'],
      ['float edge', 'max(q.x, q.y)'],
      ['float sheen', '0.5 + 0.5 * uv.y - 0.25 * uv.x'],
    ],
    result: 'edge < 0.0 ? vec3(0.07, 0.075, 0.085) * (0.6 + 0.6 * sheen) + vec3(0.25) * exp(edge * 120.0) : vec3(0.01, 0.01, 0.012)',
    outputType: 'vec3',
    wires: { uv: ['spUv', 'uv'] },
    note: [
      'Metal plate (an Expression Block): the dark brushed plate under the sand, with a thin bright rim.',
      'q: how far outside the square (0.92 each way) the pixel is, along each axis. edge: the larger of the two: below 0 on the plate.',
      'sheen: a soft gradient across the plate, brighter toward the top left, like light on metal.',
      'Result: on the plate, dark grey-blue lit by sheen with a bright rim at its edge; off it, near black.',
    ],
  });
  const draw = n('drawAgents', 'spDraw', X(1260), Y(0), {
    style: 'glow', colorBy: 'speed', palette: 'gold', speedRef: 0.4, scaleBy: 'crowd', size: 1, brightness: 1.6, glow: 0.8, fade: 'off', lights: '0',
    ...note([
      'Draw agents, Glow: every grain a small soft dot, coloured by how fast it moves along the Gold palette (Fast is 0.4): grains resting on a line are pale gold, grains being shaken across the plate darker amber, so the figure stands out and you can see the sand run when it changes.',
      'Try: Palette Ice for frost; Brightness 2 for a glowing figure.',
    ]),
  }, { agents: ['sand', 'agents'], over: ['spMetal', 'result'] });
  const nodes = [emit, group, uv, metal, draw];
  if (withOutput) nodes.push(n('output', 'spOutput', X(1680), Y(0), { ...note(['Output: the sand on the plate is the picture.']) }, { color: ['spDraw', 'color'] }));
  return nodes;
}
