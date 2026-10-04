/**
 * agentExamplesP3.ts — the Agents presets of P3 (docs/agents-plan.md §12): species,
 * food and obstacles. Multi-species slime, Ants, Boids (via a velocity field),
 * Strands and Grow toward a picture. Each is also an example; every node, inside
 * the group too, carries a plain-language note, and every Expression Block explains
 * each named line ("name: …"), which examples.test.ts checks.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';
import { agentsGroup, expr, groupInput, note, withOutputs } from './agentExampleKit';

/** Agent Inputs with a Trail input added to the group (a texture). */
function inputsWithTrail(id: string, lines: string[], extra: Array<{ key: string; type: GraphNode['inputs'][string]['type']; label: string }> = []): GraphNode {
  const ports = [{ key: 'trail', type: 'texture' as const, label: 'Trail' }, ...extra];
  return withOutputs(n('agentInputs', id, 0, 160, {
    _groupOriginal: true,
    extraInputs: ports,
    ...note(lines),
  }), Object.fromEntries(ports.map(p => [p.key, { type: p.type, label: p.label }])));
}

// ── Multi-species slime ──────────────────────────────────────────────────────

/**
 * Three slime colonies that compete for room: each follows its own species' trail and avoids the
 * others' (Sense's default Channels), so the picture is carved into living territories.
 */
export function multiSlimeNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWithTrail('msIn', [
    'Agent Inputs: this walker as the step begins. Its Species (0, 1 or 2) was given to it by the Emit it was born from, and it keeps it all its life.',
    'Trail is an input added to the group: the Trail field from outside, as it was one step ago, with one channel per species.',
  ]);
  const sense = n('agentSense', 'msSense', 420, 100, {
    angle: 30, distance: 0.03, weight: 1, width: '1',
    ...note([
      'Sense: sniffs the trail 0.03 ahead, 30° to the left, straight on and 30° to the right.',
      'Its Channels are left unwired, which means: its own species\' trail counts +1 and the other two count −0.5. So each walker is drawn to its own kind and pushed away from the others: that is what keeps the three colours apart.',
      'Try: wire an Expression Block giving vec4(1.0, 1.0, 1.0, 0.0) into Channels and the three colonies merge into one network.',
    ]),
  }, { texture: ['msIn', 'trail'] });
  const crowd = expr('msCrowd', 840, 100, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3' }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    values: { sat: 50 },
    lines: [],
    result: 'r * exp(-r / sat)',
    outputType: 'vec3',
    wires: { r: ['msSense', 'readings'] },
    note: [
      'Crowding (an ordinary Expression Block inside the rule): the pull of a reading rises with it up to Sat (50) and falls off past it, as r · e^(−r / sat). A negative reading (the other species\' trail) only gets more negative, so rivals still repel.',
      'Why: without it each colony collapses into a few thick rivers; with it the veins stay fine and keep reorganising.',
    ],
  });
  const steer = n('agentSteer', 'msSteer', 1260, 100, {
    mode: 'jones', turn: 40, jitter: 0.12,
    ...note([
      'Steer (Jones rule): straight on if the centre smells best, a random side if both sides beat it, otherwise 40° toward the better side. Jitter 0.12 keeps the network restless.',
    ]),
  }, { readings: ['msCrowd', 'result'] });
  const speeds = n('agentBySpecies', 'msSpeed', 1260, 520, {
    a: 0.24, b: 0.2, c: 0.17,
    ...note([
      'By species: a different speed for each colony from the one rule: coral 0.24, teal 0.20, violet 0.17 picture units a second.',
      'Why: unequal speeds make the contest uneven, so the borders keep moving instead of freezing in a stalemate.',
      'Try: make them equal for a balanced, slowly settling map.',
    ]),
  });
  const move = n('agentMove', 'msMove', 1680, 100, {
    speed: 0.22, edges: 'wrap',
    ...note([
      'Move: one step along the new heading at its species\' speed (from By species). Wrap: off one edge, back on the other.',
    ]),
  }, { heading: ['msSteer', 'heading'], speed: ['msSpeed', 'value'] });
  const output = n('agentOutput', 'msOut', 2100, 140, {
    _groupOriginal: true,
    ...note([
      'Agent Output: Position, Heading and Velocity from Move. Deposit is left unwired: each walker leaves trail in its own species\' channel.',
    ]),
  }, { position: ['msMove', 'position'], heading: ['msMove', 'heading'], velocity: ['msMove', 'velocity'] });

  // ── Outside: three Emits chained, one per species ──
  const emitA = n('agentEmit', 'msEmitA', X(0), Y(0), {
    mode: 'fill', shape: 'disc', heading: 'outward', x: -0.75, y: -0.35, size: 0.12, species: '1', share: 1,
    ...note([
      'Emit (coral, species 1): a third of the walkers start in a small disc on the left, facing outward.',
      'Its Also takes the teal Emit, which takes the violet one: births are shared between the three by their Share (1 each).',
      'Try: move the discs; give one colony a larger Share for more walkers.',
    ]),
  }, { also: ['msEmitB', 'emitter'] });
  const emitB = n('agentEmit', 'msEmitB', X(0), Y(380), {
    mode: 'fill', shape: 'disc', heading: 'outward', x: 0.75, y: -0.35, size: 0.12, species: '2', share: 1,
    ...note(['Emit (teal, species 2): a third of the walkers in a disc on the right, facing outward.']),
  }, { also: ['msEmitC', 'emitter'] });
  const emitC = n('agentEmit', 'msEmitC', X(0), Y(760), {
    mode: 'fill', shape: 'disc', heading: 'outward', x: 0, y: 0.55, size: 0.12, species: '3', share: 1,
    ...note(['Emit (violet, species 3): the last third in a disc at the top, facing outward.']),
  });
  let group = agentsGroup('multiSlime', X(420), Y(0), 'msEmitA', [inputs, sense, crowd, steer, speeds, move, output], {
    label: 'Three colonies', species: '3',
    ...note([
      'Agents: a million walkers (1M) of 3 species, each running the rule inside (double-click) every step, 2 steps a frame.',
      'Species 3: each walker keeps the species its Emit gave it, deposits into that species\' trail channel, and senses its own channel against the others.',
      'Try: Species 2 (and drop one Emit) for a two-way front; a new Seed and Start over for a different map.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['msTrail', 'texture']);
  const deposit = n('agentDeposit', 'msDeposit', X(840), Y(0), {
    amount: 1, size: 1, what: 'trail',
    ...note([
      'Deposit: every walker leaves 1 unit of trail a step in its own species\' channel (red for coral, green for teal, blue for violet).',
    ]),
  }, { agents: ['multiSlime', 'agents'] });
  const trail = n('trailField', 'msTrail', X(1260), Y(0), {
    resolution: '1024', diffuse: 1, halfLife: 0.06, edges: 'wrap', gain: 0.04,
    ...note([
      'Trail field: three channels, one per species, 1024 rows tall; each step it spreads (3×3) and fades (half gone in 0.06 s).',
      'Its Texture goes back into the group for Sense; its Channels colour the picture.',
    ]),
  }, { deposit: ['msDeposit', 'deposit'] });
  const colour = expr('msColour', X(1680), Y(0), {
    label: 'Three colours',
    inputs: [{ name: 'ch', type: 'vec4' }],
    lines: [
      ['vec3 k', '1.0 - exp(-max(ch.rgb, 0.0) * 0.035)'],
      ['vec3 coral', 'vec3(1.0, 0.42, 0.22) * k.r'],
      ['vec3 teal', 'vec3(0.12, 0.85, 0.78) * k.g'],
      ['vec3 violet', 'vec3(0.62, 0.36, 1.0) * k.b'],
    ],
    result: 'coral + teal + violet + vec3(0.012, 0.012, 0.02)',
    outputType: 'vec3',
    wires: { ch: ['msTrail', 'channels'] },
    note: [
      'Three colours (an Expression Block): turns the three trail channels into three colours, added together over near-black.',
      'k: each channel\'s trail softly scaled to 0–1 (1 − e^(−trail × 0.035)).',
      'coral: species 1\'s trail in coral. teal: species 2\'s in teal. violet: species 3\'s in violet.',
      'Try: other colours on the three lines; a larger 0.035 for brighter, thicker veins.',
    ],
  });
  const nodes = [emitA, emitB, emitC, group, deposit, trail, colour];
  if (withOutput) nodes.push(n('output', 'msOutput', X(2100), Y(0), { ...note(['Output: the three coloured trails are the picture.']) }, { color: ['msColour', 'result'] }));
  return nodes;
}

// ── Ants ────────────────────────────────────────────────────────────────────

/**
 * Ants: a nest and three food piles. Each ant remembers (Memory.x) whether it carries food.
 * Searching, it lays "home" smell (channel 1) and follows "food" smell (channel 2); carrying, the
 * other way round. Each mark is weaker the longer since it left the nest or the food (Memory.y),
 * so the smell grows toward its source and roads form between the nest and the food.
 */
export function antsNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWithTrail('antIn', [
    'Agent Inputs: this ant as the step begins. Memory is what it carried over from last step: x is 1 while it carries food, y the seconds since it last left the nest or the food.',
    'Trail and Places are inputs added to the group: the two smells (Trail field, one step ago) and how far this ant is from the nest and the food (Nest and food, outside).',
  ], [{ key: 'places', type: 'vec4', label: 'Places' }, { key: 'rocks', type: 'float', label: 'Rocks' }]);
  const smell = expr('antSmell', 420, 360, {
    label: 'Which smell',
    inputs: [{ name: 'mem', type: 'vec2' }],
    lines: [['float carrying', 'step(0.5, mem.x)']],
    result: 'mix(vec4(0.0, 1.0, 0.0, 0.0), vec4(1.0, 0.0, 0.0, 0.0), carrying)',
    outputType: 'vec4',
    wires: { mem: ['antIn', 'memory'] },
    note: [
      'Which smell (an Expression Block): the trail channels this ant follows, wired into Sense\'s Channels.',
      'carrying: 1 if it carries food (Memory.x), else 0.',
      'Result: searching ants follow only the food smell (channel 2), carrying ants only the home smell (channel 1). Where there is nothing to smell all three sensors read 0 and the ant walks straight on.',
    ],
  });
  const sense = n('agentSense', 'antSense', 840, 100, {
    angle: 35, distance: 0.04, weight: 1, width: '1',
    ...note([
      'Sense: smells the trail 0.04 ahead, 35° to the left, straight on and 35° to the right, weighing the channels by Which smell.',
    ]),
  }, { texture: ['antIn', 'trail'], channels: ['antSmell', 'result'] });
  const steer = n('agentSteer', 'antSteer', 1260, 100, {
    mode: 'jones', turn: 20, jitter: 0.2,
    ...note([
      'Steer (Jones rule): toward the stronger smell by 20°; with nothing to smell, straight on. Jitter 0.2 makes each ant\'s path wander in long curves, which is how ants find food no road leads to yet.',
      'Try: Jitter 0.15 for ants that stick to the roads; 1 for lost ants.',
    ]),
  }, { readings: ['antSense', 'readings'] });
  const move = n('agentMove', 'antMove', 1680, 100, {
    speed: 0.3, edges: 'bounce', onObstacle: 'turn',
    ...note([
      'Move: one step at 0.3 picture units a second; Bounce keeps ants on the picture.',
      'Obstacle ƒ is the Rocks from outside (through the group\'s Rocks input): an ant that would step into a rock turns back instead. On obstacle: Turn back.',
    ]),
  }, { heading: ['antSteer', 'heading'], obstacle: ['antIn', 'rocks'] });
  const rule = expr('antRule', 1680, 560, {
    label: 'Ant rule',
    inputs: [{ name: 'places', type: 'vec4' }, { name: 'mem', type: 'vec2' }, { name: 'h', type: 'float' }],
    lines: [
      ['float carrying', 'step(0.5, mem.x)'],
      ['float found', '(1.0 - carrying) * step(places.y, 0.0)'],
      ['float home', 'carrying * step(places.x, 0.0)'],
      ['float flip', 'max(found, home)'],
      ['float carry', 'carrying + found - home'],
      ['float since', '(mem.y + 1.0 / 60.0) * (1.0 - flip)'],
      ['float mark', 'exp(-since * 0.15)'],
      ['vec4 deposit', 'mix(vec4(1.0, 0.0, 0.0, 0.0), vec4(0.0, 1.0, 0.0, 0.0), carry) * mark'],
      ['vec3 colour', 'mix(vec3(0.62, 0.42, 0.3), vec3(1.0, 0.86, 0.25), carry)'],
      ['float toNest', 'atan(-places.w, -places.z)'],
      ['float homing', 'carry * 0.04 * sin(toNest - h)'],
      ['float heading', 'h + flip * 3.1415927 + homing'],
    ],
    result: 'vec2(carry, since)',
    outputType: 'vec2',
    exposed: [{ name: 'deposit', type: 'vec4' }, { name: 'colour', type: 'vec3' }, { name: 'heading', type: 'float' }],
    wires: { places: ['antIn', 'places'], mem: ['antIn', 'memory'], h: ['antMove', 'heading'] },
    note: [
      'Ant rule (an Expression Block): what an ant remembers, marks and looks like. Its Result is the new Memory; deposit, colour and heading are extra outputs.',
      'carrying: 1 while it carries food. found: it was searching and stands in the food. home: it was carrying and stands in the nest. flip: either happened this step.',
      'carry: carrying from now on (it picks food up, or drops it at home). since: seconds since it left the nest or the food (back to 0 at either).',
      'mark: how strongly it marks the way, weaker the longer it has walked (e^(−0.15 × since)): that is what makes the smell lead back to its source.',
      'deposit: searching ants mark the home smell (channel 1), carrying ants the food smell (channel 2). colour: brown when searching, gold when carrying food.',
      'toNest: the direction of the nest from here. homing: a carrying ant leans a little toward it each step (real ants keep count of their way home), which helps the first ones back before a road exists. heading: its new heading, turned round when it flips.',
    ],
  });
  const output = n('agentOutput', 'antOut', 2100, 140, {
    _groupOriginal: true,
    ...note([
      'Agent Output: Position and Velocity from Move; Heading, Memory, Deposit and Colour from Ant rule. Memory, Deposit and Colour give every ant state of its own (kept from step to step).',
    ]),
  }, {
    position: ['antMove', 'position'], velocity: ['antMove', 'velocity'], heading: ['antRule', 'heading'],
    memory: ['antRule', 'result'], deposit: ['antRule', 'deposit'], colour: ['antRule', 'colour'],
  });

  // ── Outside ──
  const uv = n('uv', 'antUv', X(0), Y(420), { ...note(['UV: where each pixel (or, inside the group, each ant) is, for Nest and food and Rocks.']) });
  const places = expr('antPlaces', X(420), Y(420), {
    label: 'Nest and food',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [
      ['float nest', 'length(uv - vec2(-0.15, -0.1)) - 0.07'],
      ['float food1', 'length(uv - vec2(1.2, 0.55)) - 0.08'],
      ['float food2', 'length(uv - vec2(0.95, -0.68)) - 0.07'],
      ['float food3', 'length(uv - vec2(-1.05, 0.45)) - 0.08'],
    ],
    result: 'vec4(nest, min(food1, min(food2, food3)), uv - vec2(-0.15, -0.1))',
    outputType: 'vec4',
    wires: { uv: ['antUv', 'uv'] },
    note: [
      'Nest and food (an Expression Block): how far a point is from the nest (x) and from the nearest food (y), below 0 inside; z and w are the way from the nest to the point (an ant\'s sense of where home is).',
      'nest: the nest, a circle near the middle. food1: a food pile at the top right. food2: one at the bottom right. food3: one at the left.',
      'Wired into the group\'s Places it is read at each ant; wired into the picture, at each pixel, so the drawing and the rule agree. Try: move a pile and watch the roads re-route.',
    ],
  });
  const rocks = expr('antRocks', X(420), Y(800), {
    label: 'Rocks',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [
      ['float rock1', 'length((uv - vec2(0.55, 0.22)) * vec2(1.0, 0.5)) - 0.11'],
      ['float rock2', 'length(uv - vec2(-0.75, 0.18)) - 0.09'],
    ],
    result: 'min(rock1, rock2)',
    outputType: 'float',
    wires: { uv: ['antUv', 'uv'] },
    note: [
      'Rocks (an Expression Block): the distance to two rocks (below 0 inside), the obstacles on the ants\' way.',
      'rock1: a tall rock across the way to the top-right food. rock2: a round one on the way to the left food.',
      'It goes into the group (Move\'s Obstacle ƒ: ants can\'t walk in), into the Trail\'s Block (no smell there) and into the picture.',
    ],
  });
  const rockMask = expr('antRockMask', X(840), Y(800), {
    label: 'Rock mask',
    inputs: [{ name: 'd', type: 'float' }],
    lines: [],
    result: 'step(d, 0.0)',
    outputType: 'float',
    wires: { d: ['antRocks', 'result'] },
    note: ['Rock mask (an Expression Block): 1 inside a rock, 0 outside, for the Trail\'s Block.'],
  });
  const emit = n('agentEmit', 'antEmit', X(0), Y(0), {
    mode: 'respawn', shape: 'disc', heading: 'outward', x: -0.15, y: -0.1, size: 0.06, life: 30, lifeVar: 0.5,
    ...note([
      'Emit: ants are born in the nest (the same place as Nest and food\'s nest), facing outward, searching (Memory 0), and each lives 30 s ± half.',
      'Births Keep full: an ant whose life is up is born again in the nest at once, so fresh ants keep streaming out and marking the home smell near the nest; lost ants don\'t stay lost.',
      'Try: Life 60 for a colony that explores further; 10 for one that stays close to home.',
    ]),
  });
  let group = agentsGroup('ants', X(840), Y(0), 'antEmit', [inputs, smell, sense, steer, move, rule, output], {
    label: 'Ants', tier: '256k', stepsPerFrame: 3, preroll: 20,
    ...note([
      'Agents: 262,144 ants (256k), 3 steps a frame. Each one remembers whether it carries food (Memory), and leaves a smell of its own (Deposit).',
      'Pre-roll 20: twenty seconds are simulated before the first frame, so the roads have formed when the picture appears. Start over to watch them being found.',
      'Try: 1M for crowded highways; 64k for a sparse colony that takes longer to find the far food.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['antTrail', 'texture']);
  group = groupInput(group, 'places', 'vec4', 'Places', ['antPlaces', 'result']);
  group = groupInput(group, 'rocks', 'float', 'Rocks', ['antRocks', 'result']);
  const deposit = n('agentDeposit', 'antDeposit', X(1260), Y(0), {
    amount: 1, size: 1, what: 'trail',
    ...note(['Deposit: every ant leaves its own mark (the Ant rule\'s deposit) each step: home smell or food smell, fading with the time since its source.']),
  }, { agents: ['ants', 'agents'] });
  const trail = n('trailField', 'antTrail', X(1680), Y(0), {
    resolution: '512', diffuse: 0.12, halfLife: 2.5, edges: 'clamp', gain: 0.5, kernel: '3',
    ...note([
      'Trail field: two smells (channel 1 home, channel 2 food), 512 rows. They spread a little (Diffuse 0.12) and last long (half-life 2.5 s), so a road outlives the ants that made it.',
      'Block: wired from Rock mask, the smell is wiped inside the rocks every step.',
      'Try: Half-life 0.8 for roads that vanish as soon as the food runs out of visitors.',
    ]),
  }, { deposit: ['antDeposit', 'deposit'], block: ['antRockMask', 'result'] });
  const ground = expr('antGround', X(2100), Y(420), {
    label: 'Ground',
    inputs: [{ name: 'ch', type: 'vec4' }, { name: 'places', type: 'vec4' }, { name: 'rock', type: 'float' }],
    lines: [
      ['vec3 soil', 'vec3(0.085, 0.07, 0.055)'],
      ['float homeSmell', '(1.0 - exp(-max(ch.r, 0.0) * 0.08)) * 0.5'],
      ['float foodSmell', '1.0 - exp(-max(ch.g, 0.0) * 0.03)'],
      ['float nestDisc', '1.0 - smoothstep(0.0, 0.01, places.x)'],
      ['float foodDisc', '1.0 - smoothstep(0.0, 0.01, places.y)'],
      ['float rockDisc', '1.0 - smoothstep(0.0, 0.01, rock)'],
    ],
    result: 'mix(mix(mix(soil + vec3(0.12, 0.3, 0.6) * homeSmell + vec3(1.0, 0.55, 0.12) * foodSmell, vec3(0.36, 0.33, 0.3), rockDisc), vec3(0.42, 0.24, 0.12), nestDisc), vec3(0.35, 0.85, 0.3), foodDisc)',
    outputType: 'vec3',
    wires: { ch: ['antTrail', 'channels'], places: ['antPlaces', 'result'], rock: ['antRocks', 'result'] },
    note: [
      'Ground (an Expression Block): the picture under the ants.',
      'soil: dark brown earth. homeSmell: the home smell (channel 1), shown blue. foodSmell: the food smell (channel 2), shown orange: the roads to the food.',
      'nestDisc: 1 inside the nest (drawn brown). foodDisc: 1 inside the food (green). rockDisc: 1 inside a rock (grey). They are drawn over everything.',
    ],
  });
  const draw = n('drawAgents', 'antDraw', X(2520), Y(0), {
    style: 'points', colorBy: 'agent', palette: 'ab', size: 1, brightness: 0.35, scaleBy: 'walker', fade: 'off', lights: '0',
    ...note([
      'Draw agents: every ant as a small dot in its own Colour (Colour by Agent): brown while it searches, gold while it carries food home.',
      'Try: Brightness 1 to see every ant; 0 to see only the smell.',
    ]),
  }, { agents: ['ants', 'agents'], over: ['antGround', 'result'] });
  const nodes = [emit, uv, places, rocks, rockMask, group, deposit, trail, ground, draw];
  if (withOutput) nodes.push(n('output', 'antOutput', X(2940), Y(0), { ...note(['Output: the ants over their smells, nest, food and rocks are the picture.']) }, { color: ['antDraw', 'color'] }));
  return nodes;
}

// ── Boids (via a velocity field) ─────────────────────────────────────────────

/**
 * Field boids: every bird deposits its velocity (and a count) into a blurred, signed trail. Each
 * then matches the average velocity around it (align), drifts up the crowd's slope (cohere) and,
 * past a crowding level, down it (separate). No neighbour lists: a million birds cost the same.
 */
export function boidsNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWithTrail('bdIn', [
    'Agent Inputs: this bird as the step begins: its Velocity goes to Flock.',
    'Trail is an input added to the group: the flow field from outside (the birds\' velocities, blurred), as it was one step ago.',
  ]);
  const count = expr('bdCount', 420, 460, {
    label: 'Count channel',
    inputs: [],
    lines: [],
    result: 'vec4(0.0, 0.0, 1.0, 0.0)',
    outputType: 'vec4',
    note: ['Count channel (an Expression Block): picks the trail\'s third channel, the count of birds, for Sense: so Sense measures how crowded it is, not how they move.'],
  });
  const sense = n('agentSense', 'bdSense', 840, 360, {
    angle: 30, distance: 0.06, weight: 1, width: '1',
    ...note([
      'Sense: reads the crowd (Count channel) around the bird. Its Gradient output, which way the crowd thickens, goes to Flock.',
    ]),
  }, { texture: ['bdIn', 'trail'], channels: ['bdCount', 'result'] });
  const flow = n('sampleTexture', 'bdFlow', 840, 40, {
    ...note([
      'Sample (texture): the flow field where the bird is: red and green are the summed velocities of the birds around it, blue how many there are.',
    ]),
  }, { texture: ['bdIn', 'trail'] });
  const flock = expr('bdFlock', 1260, 100, {
    label: 'Flock',
    inputs: [
      { name: 'flow', type: 'vec3' }, { name: 'grad', type: 'vec2' }, { name: 'v', type: 'vec2' },
      { name: 'alignW', type: 'float', slider: { min: 0, max: 10 } }, { name: 'cohereW', type: 'float', slider: { min: 0, max: 4 } },
      { name: 'packed', type: 'float', slider: { min: 1, max: 100 } }, { name: 'cruiseSpeed', type: 'float', slider: { min: 0, max: 1.5 } },
    ],
    values: { alignW: 3, cohereW: 0.5, packed: 16, cruiseSpeed: 0.4 },
    lines: [
      ['float crowd', 'max(flow.z, 0.0)'],
      ['vec2 avg', 'flow.xy / max(crowd, 1e-3)'],
      ['vec2 align', '(avg - v) * alignW * crowd / (crowd + 1.0)'],
      ['vec2 cohere', 'grad / (crowd + 1.0) * cohereW * (1.0 - crowd / packed)'],
      ['float speed', 'max(length(v), 1e-4)'],
      ['vec2 cruise', 'v / speed * (cruiseSpeed - speed) * 2.5'],
    ],
    result: 'align + cohere + cruise',
    outputType: 'vec2',
    wires: { flow: ['bdFlow', 'color'], grad: ['bdSense', 'gradient'], v: ['bdIn', 'velocity'] },
    note: [
      'Flock (an Expression Block): the three boid rules, read from the field instead of from neighbours. Its Result is a force for Curl noise\'s Also. Its four sliders tune the flock.',
      'crowd: how many birds are around (the field\'s count). avg: their average velocity.',
      'align: steer toward the average velocity (match the flock) by Align W, more where there are more birds.',
      'cohere: drift up the crowd\'s slope (toward the flock) by Cohere W while fewer than Packed are around, and down it once more are (separation).',
      'speed: this bird\'s speed. cruise: speed up or slow down toward Cruise speed.',
      'Try: Align W 6 for tight, glassy flocks; 0 for a gas. Packed 4 for loose flocks, 40 for dense balls.',
    ],
  });
  const curl = n('agentCurl', 'bdCurl', 1680, 100, {
    strength: 0.35, size: 1.2, evolve: 0.25,
    ...note([
      'Curl noise: a swirling breeze added to Flock (its Also), so flocks wheel, split and meet instead of all ending up flying one way.',
      'Try: 0 and the whole sky slowly agrees on one direction; 0.8 for restless murmurations.',
    ]),
  }, { also: ['bdFlock', 'result'] });
  const integrate = n('agentIntegrate', 'bdMove', 2100, 100, {
    drag: 0.2, maxSpeed: 0.7, mass: 1, edges: 'wrap',
    ...note([
      'Integrate: the force moves the bird; Max speed 0.7 caps a dive, Drag 0.2 smooths it. Wrap: off one edge, back on the other.',
    ]),
  }, { force: ['bdCurl', 'force'] });
  const output = n('agentOutput', 'bdOut', 2520, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Integrate; Heading follows the velocity (the streaks point along it).']),
  }, { position: ['bdMove', 'position'], velocity: ['bdMove', 'velocity'] });

  const emit = n('agentEmit', 'bdEmit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random', speed: 0.3, speedVar: 0.2,
    ...note(['Emit: every bird starts somewhere on the picture, flying in a random direction at about 0.3. The flocks sort themselves out within seconds.']),
  });
  let group = agentsGroup('boids', X(420), Y(0), 'bdEmit', [inputs, count, sense, flow, flock, curl, integrate, output], {
    label: 'Boids', tier: '256k', preroll: 6,
    ...note([
      'Agents: 262,144 birds (256k), 2 steps a frame. The rule inside (double-click) is Flock → Curl noise → Integrate.',
      'Pre-roll 6: six seconds simulated first, so flocks have formed when the picture appears.',
      'Try: 1M for a sky full of murmurations (the field\'s numbers scale with the count: halve Deposit\'s Amount).',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['bdTrail', 'texture']);
  const deposit = n('agentDeposit', 'bdDeposit', X(840), Y(0), {
    what: 'velocity', amount: 1, size: 1,
    ...note([
      'Deposit, What Velocity: every bird adds its velocity to the field\'s first two channels and 1 to the third (a count), each step.',
      'Why: the blurred sum is "how the birds around here move" and "how many there are", which is all Flock needs.',
    ]),
  }, { agents: ['boids', 'agents'] });
  const trail = n('trailField', 'bdTrail', X(1260), Y(0), {
    resolution: '512', diffuse: 1, halfLife: 0.08, edges: 'wrap', gain: 0.1, kernel: '5',
    ...note([
      'Trail field: the flow field, 512 rows, spread by the 5×5 blur every step and fading fast (half-life 0.08 s), so it is the birds\' motion right now, blurred over a few body lengths.',
      'It keeps negative numbers (velocities point both ways) because a Velocity deposit goes into it.',
      'Try: 3×3 for smaller, twitchier flocks; ¼ picture for big, slow ones.',
    ]),
  }, { deposit: ['bdDeposit', 'deposit'] });
  const sky = n('uv', 'bdUv', X(840), Y(380), { ...note(['UV: where each pixel is, for the evening sky behind the birds.']) });
  const skyCol = expr('bdSky', X(1260), Y(380), {
    label: 'Evening sky',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [['float h', 'uv.y * 0.5 + 0.5']],
    result: 'mix(vec3(0.16, 0.07, 0.1), vec3(0.03, 0.05, 0.12), h)',
    outputType: 'vec3',
    wires: { uv: ['bdUv', 'uv'] },
    note: [
      'Evening sky (an Expression Block): the background, dusky red at the bottom to deep blue at the top.',
      'h: 0 at the bottom of the picture, 1 at the top.',
    ],
  });
  const draw = n('drawAgents', 'bdDraw', X(1680), Y(0), {
    style: 'streaks', colorBy: 'heading', palette: 'ab', colorA: [1.0, 0.72, 0.4], colorB: [0.45, 0.75, 1.0],
    scaleBy: 'crowd', size: 1.5, brightness: 0.7, glow: 0.5, streak: 0.6, fade: 'off', lights: '0',
    ...note([
      'Draw agents, Streaks: every bird as a short glowing line along its flight, coloured by heading (warm gold flying one way, pale blue the other), so each flock shows as one colour wheeling through the others.',
      'Try: Palette Aurora; Streak 1.5 for long trails.',
    ]),
  }, { agents: ['boids', 'agents'], over: ['bdSky', 'result'] });
  const nodes = [emit, group, deposit, trail, sky, skyCol, draw];
  if (withOutput) nodes.push(n('output', 'bdOutput', X(2100), Y(0), { ...note(['Output: the birds over the evening sky are the picture.']) }, { color: ['bdDraw', 'color'] }));
  return nodes;
}

// ── Strands ─────────────────────────────────────────────────────────────────

/** Strands: slime tuned for long filaments (far sight, small turns), drawn as ink streaks on paper. */
export function strandsNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWithTrail('stIn', [
    'Agent Inputs: this walker as the step begins. Trail is an input added to the group: the Trail field from outside, one step ago.',
  ]);
  const sense = n('agentSense', 'stSense', 420, 100, {
    angle: 15, distance: 0.06, weight: 1, width: '1',
    ...note([
      'Sense: looks far ahead (0.06, about 30 trail pixels) and only 15° to each side.',
      'Why: far, narrow sensors make walkers follow a strand for a long way before they notice anything to the side, so strands grow long and parallel.',
      'Try: Distance 0.03 for shorter, curlier hair.',
    ]),
  }, { texture: ['stIn', 'trail'] });
  const crowd = expr('stCrowd', 840, 420, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3' }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    values: { sat: 20 },
    lines: [],
    result: 'r * exp(-r / sat)',
    outputType: 'vec3',
    wires: { r: ['stSense', 'readings'] },
    note: [
      'Crowding (an Expression Block): a strand\'s pull rises with its trail up to Sat (20) and falls past it, r · e^(−r / sat).',
      'Why: without it every walker joins the strongest strand and the picture coarsens into one thick rope; with it strands stay many, fine and side by side.',
      'Try: Sat 60 for fewer, bolder strands.',
    ],
  });
  const steer = n('agentSteer', 'stSteer', 840, 100, {
    mode: 'jones', turn: 12, jitter: 0.05,
    ...note([
      'Steer (Jones rule) with a small Turn (12°) and almost no Jitter: walkers bend gently instead of turning sharply, which combs the network into flowing strands.',
      'Try: Turn 25° to see strands knot into a mesh.',
    ]),
  }, { readings: ['stCrowd', 'result'] });
  const drift = n('agentCurl', 'stDrift', 840, 760, {
    strength: 0.15, size: 0.6, evolve: 0.04,
    ...note([
      'Curl noise, used as a drift: a slow, smooth swirl of currents that carries every walker a little (Move\'s Also velocity).',
      'Why: walkers that follow each other AND the same current line up side by side, so the network combs out into long flowing strands instead of a web of straight lines.',
      'Try: 0 for a web; 0.4 for hair caught in a whirlpool; Size 1.5 for tighter waves.',
    ]),
  });
  const move = n('agentMove', 'stMove', 1260, 100, {
    speed: 0.3, edges: 'wrap',
    ...note(['Move: one step at 0.3 picture units a second along Steer\'s heading, plus the drift; Wrap at the edges.']),
  }, { heading: ['stSteer', 'heading'], also: ['stDrift', 'force'] });
  const output = n('agentOutput', 'stOut', 1680, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position, Heading and Velocity from Move (the streaks are drawn along the velocity).']),
  }, { position: ['stMove', 'position'], heading: ['stMove', 'heading'], velocity: ['stMove', 'velocity'] });

  const emit = n('agentEmit', 'stEmit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random',
    ...note(['Emit: every walker starts somewhere on the picture, facing anywhere; strands condense out of the noise within seconds.']),
  });
  let group = agentsGroup('strands', X(420), Y(0), 'stEmit', [inputs, sense, crowd, steer, drift, move, output], {
    label: 'Strands', preroll: 8,
    ...note([
      'Agents: a million walkers (1M), 2 steps a frame, running the slime rule tuned for strands (double-click to see it): Sense → Crowding → Steer → Move, with a curl-noise drift.',
      'Pre-roll 8: eight seconds simulated first, so the strands have combed out when the picture appears.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['stTrail', 'texture']);
  const deposit = n('agentDeposit', 'stDeposit', X(840), Y(0), {
    amount: 1, size: 1,
    ...note(['Deposit: every walker leaves 1 unit of trail a step: strands are where many have walked.']),
  }, { agents: ['strands', 'agents'] });
  const trail = n('trailField', 'stTrail', X(1260), Y(0), {
    resolution: '1024', diffuse: 0.6, halfLife: 0.04, edges: 'wrap', gain: 0.04,
    ...note([
      'Trail field: 1024 rows, spreading only a little (Diffuse 0.6) and fading fast (half-life 0.04 s), so strands stay thin and sharp.',
    ]),
  }, { deposit: ['stDeposit', 'deposit'] });
  const draw = n('drawAgents', 'stDraw', X(1680), Y(0), {
    style: 'ink', colorBy: 'heading', palette: 'ab', colorA: [0.05, 0.06, 0.12], colorB: [0.3, 0.08, 0.06], paper: [0.95, 0.93, 0.88],
    scaleBy: 'crowd', size: 0.6, brightness: 1.4, glow: 0.25, streak: 1.2, fade: 'off', lights: '0',
    ...note([
      'Draw agents, Ink: every walker lays a streak of ink along its motion (Streak 1.2) on warm paper; where strands crowd the ink goes dark.',
      'Colour by Heading between a blue-black and a rust: strands running one way read slightly cooler than those running the other, like combed silk.',
      'Try: Style Streaks on a dark Over for glowing fibres.',
    ]),
  }, { agents: ['strands', 'agents'] });
  const nodes = [emit, group, deposit, trail, draw];
  if (withOutput) nodes.push(n('output', 'stOutput', X(2100), Y(0), { ...note(['Output: the ink strands on paper are the picture.']) }, { color: ['stDraw', 'color'] }));
  return nodes;
}

// ── Grow toward a picture ───────────────────────────────────────────────────

/**
 * Slime feeding on a picture: the picture's bright parts are food painted into the trail every step
 * (Trail field's Add), and walkers are born on them (Emit's Field shape), so the network grows over
 * them and draws the picture in veins. A built-in moonlit picture until one is loaded.
 */
export function growPictureNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWithTrail('gpIn', [
    'Agent Inputs: this walker as the step begins. Trail is an input added to the group: the Trail field from outside, one step ago, food included.',
  ]);
  const sense = n('agentSense', 'gpSense', 420, 100, {
    angle: 30, distance: 0.025, weight: 1, width: '1',
    ...note([
      'Sense: sniffs the trail 0.025 ahead, 30° left and right. The trail holds both the slime\'s own marks and the food the picture paints in, so walkers are drawn to the bright parts.',
    ]),
  }, { texture: ['gpIn', 'trail'], channels: ['gpBoth', 'result'] });
  const both = expr('gpBoth', 0, 520, {
    label: 'Smell both',
    inputs: [],
    lines: [],
    result: 'vec4(1.0, 1.0, 0.0, 0.0)',
    outputType: 'vec4',
    note: ['Smell both (an Expression Block): Sense\'s Channels. The slime\'s own trail (channel 1) and the food (channel 2) count the same, so walkers follow each other and the picture.'],
  });
  const crowd = expr('gpCrowd', 840, 100, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3' }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    values: { sat: 15 },
    lines: [],
    result: 'r * exp(-r / sat)',
    outputType: 'vec3',
    wires: { r: ['gpSense', 'readings'] },
    note: [
      'Crowding (an Expression Block): a reading\'s pull rises up to Sat (15) and falls past it, r · e^(−r / sat), so walkers spread over a food patch as a fine labyrinth instead of piling into one blob.',
      'Try: Sat 40 and the moon fills in solid; 8 for an even finer maze.',
    ],
  });
  const steer = n('agentSteer', 'gpSteer', 1260, 100, {
    mode: 'jones', turn: 40, jitter: 0.12,
    ...note(['Steer (Jones rule): 40° toward the better smell; Jitter 0.12 keeps the veins exploring the dark between bright parts.']),
  }, { readings: ['gpCrowd', 'result'] });
  const move = n('agentMove', 'gpMove', 1680, 100, {
    speed: 0.2, edges: 'wrap',
    ...note(['Move: one step at 0.2 picture units a second; Wrap at the edges.']),
  }, { heading: ['gpSteer', 'heading'] });
  const output = n('agentOutput', 'gpOut', 2100, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position, Heading and Velocity from Move.']),
  }, { position: ['gpMove', 'position'], heading: ['gpMove', 'heading'], velocity: ['gpMove', 'velocity'] });

  // ── Outside: the picture, used three times (food, births, colour) ──
  const uv = n('uv', 'gpUv', X(0), Y(420), { ...note(['UV: where each pixel is, for the built-in picture and your Texture Input.']) });
  const moon = expr('gpMoon', X(420), Y(420), {
    label: 'Moonlit picture',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [
      ['vec2 mc', 'vec2(0.72, 0.38)'],
      ['float moon', '1.0 - smoothstep(0.25, 0.27, length(uv - mc))'],
      ['float halo', 'exp(-max(length(uv - mc) - 0.27, 0.0) * 5.0) * 0.45'],
      ['float ridge', '-0.42 + 0.22 * sin(uv.x * 2.1 + 0.6) + 0.08 * sin(uv.x * 6.3 + 1.7) + 0.03 * sin(uv.x * 17.0)'],
      ['float rim', 'exp(-abs(uv.y - ridge) * 40.0) * step(uv.y, ridge + 0.05)'],
      ['float below', 'step(uv.y, ridge)'],
      ['vec2 cell', 'floor(uv * 14.0)'],
      ['float star', 'step(0.9, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453)) * (1.0 - smoothstep(0.08, 0.16, length(fract(uv * 14.0) - 0.5)))'],
      ['vec3 sky', 'vec3(0.02, 0.03, 0.08) + vec3(0.9, 0.85, 0.7) * halo + vec3(0.85, 0.9, 1.0) * star * (1.0 - below)'],
    ],
    result: 'mix(sky + vec3(1.0, 0.94, 0.78) * moon, vec3(0.01, 0.01, 0.02), below) + vec3(1.0, 0.62, 0.3) * rim * 0.9',
    outputType: 'vec3',
    wires: { uv: ['gpUv', 'uv'] },
    note: [
      'Moonlit picture (an Expression Block): a built-in picture to feed on until you load your own: a full moon over a dark ridge, stars above.',
      'mc: where the moon is. moon: 1 on the moon\'s disc. halo: its glow, fading out from the rim.',
      'ridge: the height of the hills at this x (three waves added). rim: a thin warm line just along the ridge, as if lit from behind. below: 1 under the ridge (the dark hills).',
      'cell: which square of a 14 × 14 grid the pixel is in. star: a few cells (one in ten) hold a small round star. sky: the night sky with the halo and the stars.',
    ],
  });
  const tex = n('textureInput', 'gpTex', X(420), Y(800), {
    fit: 'cover',
    ...note([
      'Texture Input: load your own picture here (Fill crops it to the frame), then set Yours to 1 on Picture. Until then it reads black and the moon is used.',
    ]),
  }, { uv: ['gpUv', 'uv'] });
  const pic = expr('gpPic', X(840), Y(420), {
    label: 'Picture',
    inputs: [{ name: 'builtIn', type: 'vec3' }, { name: 'img', type: 'vec3' }, { name: 'yours', type: 'float', slider: { min: 0, max: 1 } }],
    values: { yours: 0 },
    lines: [],
    result: 'mix(builtIn, img, yours)',
    outputType: 'vec3',
    wires: { builtIn: ['gpMoon', 'result'], img: ['gpTex', 'color'] },
    note: [
      'Picture (an Expression Block): the picture the slime feeds on: the built-in moon (Yours 0) or your Texture Input (Yours 1).',
    ],
  });
  const food = expr('gpFood', X(1260), Y(420), {
    label: 'Food',
    inputs: [{ name: 'c', type: 'vec3' }],
    lines: [['float bright', 'dot(c, vec3(0.299, 0.587, 0.114))']],
    result: 'bright * bright * 2.0',
    outputType: 'float',
    wires: { c: ['gpPic', 'result'] },
    note: [
      'Food (an Expression Block): how much there is to eat here.',
      'bright: the picture\'s brightness. Result: bright² × 2, so the brightest parts feed far more than the mid-tones and the slime settles on the highlights.',
      'It goes into Emit\'s Where ƒ (walkers are born on the food) and, through Food to trail, into the Trail field.',
    ],
  });
  const foodTrail = expr('gpFoodTrail', X(1680), Y(420), {
    label: 'Food to trail',
    inputs: [{ name: 'f', type: 'float' }, { name: 'rate', type: 'float', slider: { min: 0, max: 200 } }],
    values: { rate: 30 },
    lines: [],
    result: 'vec4(0.0, f * rate, 0.0, 0.0)',
    outputType: 'vec4',
    wires: { f: ['gpFood', 'result'] },
    note: [
      'Food to trail (an Expression Block): paints Food × Rate (30 a second) into the trail\'s second channel at every trail pixel, every step. The slime smells both channels (Smell both); the picture shows only the first, its own marks, so the veins are drawn and not the food.',
      'Try: Rate 10 for slime that wanders more freely; 100 for a network that clings to the picture.',
    ],
  });
  const emit = n('agentEmit', 'gpEmit', X(0), Y(0), {
    mode: 'fill', shape: 'field', threshold: 0.15, heading: 'random',
    ...note([
      'Emit, Shape Field: every walker is born where Food (wired into Where ƒ) is above Threshold (0.15): on the moon, its halo, the rim and the stars.',
    ]),
  }, { where: ['gpFood', 'result'] });
  let group = agentsGroup('growPicture', X(420), Y(0), 'gpEmit', [inputs, both, sense, crowd, steer, move, output], {
    label: 'Slime on a picture', preroll: 6,
    ...note([
      'Agents: a million walkers (1M), the slime rule (Sense → Crowding → Steer → Move), 2 steps a frame.',
      'Pre-roll 6: six seconds simulated first, so the veins have found the picture when it appears.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['gpTrail', 'texture']);
  const deposit = n('agentDeposit', 'gpDeposit', X(840), Y(0), {
    amount: 1, size: 1,
    ...note(['Deposit: every walker leaves 1 unit of trail a step, on top of the food the picture paints in.']),
  }, { agents: ['growPicture', 'agents'] });
  const trail = n('trailField', 'gpTrail', X(1260), Y(0), {
    resolution: '1024', diffuse: 1, halfLife: 0.05, edges: 'wrap', gain: 0.02,
    ...note([
      'Trail field: 1024 rows; spreads (3×3) and fades (half-life 0.05 s) every step. Channel 1 is the slime\'s own marks, channel 2 the food.',
      'Add: wired from Food to trail, the picture\'s food is painted in every step, so the bright parts always smell and the network grows over them.',
    ]),
  }, { deposit: ['gpDeposit', 'deposit'], add: ['gpFoodTrail', 'result'] });
  const look = expr('gpLook', X(2100), Y(0), {
    label: 'Veins in the picture\'s colours',
    inputs: [{ name: 'a', type: 'float' }, { name: 'c', type: 'vec3' }],
    lines: [
      ['vec3 tint', 'mix(vec3(1.0, 0.85, 0.6), c / max(max(c.r, max(c.g, c.b)), 0.05), 0.65)'],
      ['float bright', 'dot(c, vec3(0.299, 0.587, 0.114))'],
      ['vec3 veins', 'tint * a * (0.3 + 2.0 * bright)'],
    ],
    result: 'veins + c * 0.05',
    outputType: 'vec3',
    wires: { a: ['gpTrail', 'amount'], c: ['gpPic', 'result'] },
    note: [
      'Veins in the picture\'s colours (an Expression Block): the slime is coloured by what it feeds on.',
      'tint: the picture\'s hue at full brightness, mixed with a warm white so dark parts still show.',
      'bright: the picture\'s brightness here. veins: the trail\'s Amount in that tint, brighter where the picture is bright, so the network draws the picture even where it wanders into the dark.',
      'Result: the veins over a faint ghost of the picture (5%).',
      'Try: c * 0.0 to see the veins alone; 0.3 to see more of the picture.',
    ],
  });
  const nodes = [emit, uv, moon, tex, pic, food, foodTrail, group, deposit, trail, look];
  if (withOutput) nodes.push(n('output', 'gpOutput', X(2520), Y(0), { ...note(['Output: the veins, coloured by the picture, are the picture.']) }, { color: ['gpLook', 'result'] }));
  return nodes;
}
