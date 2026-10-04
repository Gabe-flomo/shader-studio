/**
 * agentExamples.ts — the Agents group's presets and examples (docs/agents-plan.md §12),
 * built from the node definitions (graphBuilder.ts).
 *
 * Every node a preset adds carries a plain-language note (params.__comment):
 * what it does in this setup, why it is there, and what to try. The notes show
 * on the card's Comment tab and, as // lines, in the generated code.
 * examples.test.ts checks that no node of an Agents example goes without one.
 *
 * The same builder makes the example (fixed ids) and the Slime mold starter in
 * the node browser (fresh ids, placed next to the Output: store addNode).
 */
import type { GraphNode } from '../types/nodeGraph';
import type { ExampleGraph } from './exampleIndex';
import { n } from './graphBuilder';
import { agentsGroup, expr, note, withOutputs } from './agentExampleKit';
import { antsNodes, boidsNodes, growPictureNodes, multiSlimeNodes, strandsNodes } from './agentExamplesP3';

export const AGENT_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  slimeMold: {
    label: 'Slime mold',
    description: 'A million walkers on the GPU, built from nodes: each one senses the trail ahead (left, centre, right), turns toward the strongest smell, moves and leaves more trail, which spreads and fades. Veins form, join, thicken and pulse by themselves (Jones 2010, Physarum polycephalum). Double-click the Agents group to open the rule.',
  },
  agentParticles: {
    label: 'Particles from nodes',
    description: 'The Particles node\'s default look built from nodes you can open and rewire: a million embers born on a ring, carried by curl noise and a gentle swirl, pulled and stirred by the mouse, slowed by drag and fading over their life, drawn with glow and four orbiting lights. Double-click the Agents group to see the chain of forces.',
  },
  agentCurlSmoke: {
    label: 'Curl smoke',
    description: 'Smoke built from nodes: a million particles rise from a small source, warm air (an Expression Block) lifting them less as they cool, while curl noise folds them into threads and a gusty breeze leans the plume over, drawn as ink streaks on paper.',
  },
  agentMultiSlime: {
    label: 'Multi-species slime',
    description: 'Three slime colonies, coral, teal and violet, grow out of three discs toward each other. Each walker follows its own kind\'s trail and avoids the others\', so the picture is carved into living territories whose borders keep shifting. Species and a different speed for each come from one rule (By species).',
  },
  agentAnts: {
    label: 'Ants',
    description: 'An ant colony built from nodes: ants leave the nest, wander until they find food, pick it up and follow the home smell back, marking a food trail as they go. Busy roads form between the nest and three food piles and bend round the rocks. Each ant remembers whether it carries food (Memory) and leaves a smell of its own (Deposit).',
  },
  agentBoids: {
    label: 'Boids',
    description: 'Flocking without neighbour lists: every bird leaves its velocity in a blurred flow field (Deposit Velocity, a 5×5 Trail), then matches the flow around it, drifts toward the crowd and away from a crush. Flocks gather, turn together and stream through each other, coloured by heading.',
  },
  agentStrands: {
    label: 'Strands',
    description: 'Slime tuned for long flowing filaments: walkers look far ahead and turn only a little, so the network combs itself into strands like hair or silk, drawn as dark ink streaks on warm paper.',
  },
  agentGrowPicture: {
    label: 'Grow toward a picture',
    description: 'Slime feeding on a picture: its bright parts are food painted into the trail every step (Trail field Add) and walkers are born on them (Emit Field), so the network maps the picture in veins coloured by what they feed on. A built-in moonlit picture; load your own into the Texture Input.',
  },
  agentSoundBurst: {
    label: 'Sound burst',
    description: 'Particles that answer sound: a disc of glowing streaks that a shockwave blasts outward on every beat and a spring pulls back together. A silent stand-in beat (120 a minute) drives it; set Sound from to the mic or the Audio engine for real music.',
  },
};

/** The same rules by hand (agentSketchExamples.ts): Script layers that run on web pages and the Present page, where the group doesn't yet. */
export const AGENT_RULE_INDEX: Record<string, { label: string; description: string }> = {
  agentRuleSlime: {
    label: 'Slime rule, by hand (JS)',
    description: 'The Slime mold rule written again as a small JavaScript sketch, so it runs on web pages and the Present page: Sense, Crowding, Steer, Move, Deposit, then the trail spreads and fades. Every setting is a slider; Show the sensors draws what a few walkers smell. Species 3 gives three competing colonies.',
  },
  agentRuleParticles: {
    label: 'Particles rule, by hand (JS)',
    description: 'The Particles preset\'s chain of forces as a small JavaScript sketch: gravity, curl noise, a vortex, the mouse and a shockwave on a silent beat add up, then Integrate and Age / Life. Set a force to 0 to take it out of the chain.',
  },
  agentRuleAnts: {
    label: 'Ants rule, by hand (JS)',
    description: 'The Ants preset\'s rule as a small JavaScript sketch: each ant remembers whether it carries food, follows one smell and lays the other, weaker the further it walked. Roads form between the nest and the food and bend round the rock.',
  },
};

export const AGENT_EXAMPLE_KEYS = [...Object.keys(AGENT_EXAMPLE_INDEX), ...Object.keys(AGENT_RULE_INDEX)];


/**
 * The Slime mold graph, ids as given, its top-left at (x, y). `outputId` is
 * the Output node the trail's colour goes into (made here when `withOutput`).
 */
export function slimeMoldNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;

  // ── Inside the Agents group: the rule one walker follows every step ──
  const inputs = withOutputs(n('agentInputs', 'slimeIn', 0, 160, {
    _groupOriginal: true,
    extraInputs: [{ key: 'trail', type: 'texture', label: 'Trail' }],
    ...note([
      'Agent Inputs: this walker as the step begins (where it is, which way it faces, a fresh random number).',
      'Trail is an input added to the group: the Trail field from outside, as it was one step ago.',
      'Every socket on the nodes to the right that is left unwired reads this walker\'s own value.',
    ]),
  }), { trail: { type: 'texture', label: 'Trail' } });
  const sense = n('agentSense', 'slimeSense', 420, 100, {
    angle: 22.5, distance: 0.035, weight: 1, width: '1',
    ...note([
      'Sense: sniffs the trail at three points 0.035 ahead (about 18 trail pixels): 22.5° to the left, straight on, and 22.5° to the right.',
      'Why: the walker can only turn toward what it can smell. Readings go through Crowding to Steer.',
      'A sensor angle smaller than Steer\'s turn (22.5° against 45°) keeps the network restless: veins branch, merge and pulse instead of settling.',
      'Try: Angle 45° for calmer, rounder cells; a longer Distance for coarser, bigger cells; a shorter one for fine lace.',
    ]),
  }, { texture: ['slimeIn', 'trail'] });
  // An ordinary node inside the rule: an Expression Block that makes very crowded trail less attractive.
  const crowd = n('exprNode', 'slimeCrowd', 840, 100, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3', slider: null }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    sat: 60,
    outputType: 'vec3',
    lines: [],
    result: 'r * exp(-r / sat)',
    expr: 'r * exp(-r / sat)',
    ...note([
      'Crowding (an ordinary Expression Block inside the rule): the trail\'s pull rises with the amount up to Sat (60) and falls off past it, as r · e^(−r / sat).',
      'Why: real slime mold can\'t pack its tubes without limit. Without this, every walker ends up in a few huge veins and the network coarsens into a handful of loops; with it, the network keeps reorganising at a living size.',
      'Try: Sat 30 for a finer, more even mesh; 150 (or unwire it and wire Sense straight into Steer) to watch the network coarsen.',
    ]),
  });
  crowd.inputs = {
    r: { type: 'vec3', label: 'r', connection: { nodeId: 'slimeSense', outputKey: 'readings' } },
    sat: { type: 'float', label: 'sat' },
  };
  crowd.outputs = { result: { type: 'vec3', label: 'Result' } };
  const steer = n('agentSteer', 'slimeSteer', 1260, 100, {
    mode: 'jones', turn: 45, jitter: 0.15,
    ...note([
      'Steer (Jones rule): straight on if the centre smells strongest; a random side if both sides beat the centre; otherwise turn 45° toward the stronger side.',
      'Jitter 0.15 adds a small random wobble every step, which keeps the network exploring and pulsing instead of freezing.',
      'Try: Turn 20° for long smooth veins, 70° for a tight busy mesh; Jitter 0 for crisp still lines.',
    ]),
  }, { readings: ['slimeCrowd', 'result'] });
  const move = n('agentMove', 'slimeMove', 1680, 100, {
    speed: 0.22, edges: 'wrap',
    ...note([
      'Move: one step forward along the new heading, 0.22 picture units a second (about two trail pixels a step).',
      'Wrap: a walker leaving one edge comes back on the opposite one, so the network has no border.',
      'Try: Speed 0.5 for faster, looser growth.',
    ]),
  }, { heading: ['slimeSteer', 'heading'] });
  const output = n('agentOutput', 'slimeOut', 2100, 140, {
    _groupOriginal: true,
    ...note([
      'Agent Output: the walker at the end of the step. Position and Heading come from Move; Speed and Velocity follow from Move\'s Velocity.',
      'Anything left unwired here keeps the walker\'s old value.',
    ]),
  }, { position: ['slimeMove', 'position'], heading: ['slimeMove', 'heading'], velocity: ['slimeMove', 'velocity'] });

  // ── Outside ──
  const emit = n('agentEmit', 'slimeEmit', X(0), Y(0), {
    mode: 'fill', shape: 'disc', heading: 'outward', x: 0, y: 0, size: 0.15, life: 0,
    ...note([
      'Emit: where the walkers start. Fill: all of them are born at once when the simulation starts, in a small disc in the middle (radius 0.15), each facing outward.',
      'Why: like a real slime mold placed on agar, they spread out as a fan of branching veins, then join up into a network behind the front.',
      'Try: Shape Whole picture and Facing Random for a network everywhere at once; Ring with Facing Inward for a web that closes in.',
    ]),
  });
  const group: GraphNode = {
    ...n('agentsGroup', 'slime', X(420), Y(0), {
      label: 'Slime mold',
      tier: '1m', species: '1', stepsPerFrame: 2, seed: 1, preroll: 0,
      subgraph: { nodes: [inputs, sense, crowd, steer, move, output], inputPorts: [], outputPorts: [] },
      ...note([
        'Agents: a million walkers (1M) that each run the rule inside this group (double-click it) every step, 2 steps a frame (about 7 ms a frame on an M3 Pro).',
        'Emit says where they are born; their Agents output goes to Deposit, so they leave trail.',
        'Its Trail input is the Trail field below, read back one step late: that loop is what makes the walkers follow each other.',
        'Try: Count 256k on a slower GPU, Steps per frame 4 for faster growth, a new Seed for a different run, then Start over.',
      ]),
    }, { emit: ['slimeEmit', 'emitter'] }),
  };
  group.inputs = { ...group.inputs, trail: { type: 'texture', label: 'Trail', connection: { nodeId: 'slimeTrail', outputKey: 'texture' } } };
  const deposit = n('agentDeposit', 'slimeDeposit', X(840), Y(0), {
    amount: 1, size: 1,
    ...note([
      'Deposit: every walker drops 1 unit of trail on the pixel it stands on, every step.',
      'Why: the trail is the only way walkers know about each other. More walkers on a path leave more trail, which pulls in more walkers: that feedback builds the veins.',
    ]),
  }, { agents: ['slime', 'agents'] });
  const trail = n('trailField', 'slimeTrail', X(1260), Y(0), {
    resolution: '1024', diffuse: 1, halfLife: 0.05, edges: 'wrap', gain: 0.04,
    ...note([
      'Trail field: 1024 rows tall (the width follows the picture), so the network looks the same in a small preview and a 4K export. Each step it spreads (Diffuse 1: every pixel becomes the 3×3 average) and fades (half gone in 0.05 simulated seconds, about 3 steps).',
      'Its Texture goes back into the Agents group for Sense; its Amount (0–1) colours the picture.',
      'Try: a longer Half-life for thick, slow rivers; a shorter one for fine lace. ½ picture is cheaper but packs the walkers tighter (thicker veins). Gain makes the picture brighter or darker without changing the simulation.',
    ]),
  }, { deposit: ['slimeDeposit', 'deposit'] });
  const colour = n('stopPalette', 'slimeColour', X(1680), Y(0), {
    stops: '5', wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
    color0: [0.0, 0.0, 0.0], color1: [0.16, 0.05, 0.01], color2: [0.75, 0.38, 0.05], color3: [1.0, 0.82, 0.32], color4: [1.0, 0.98, 0.85],
    ...note([
      'Stops Palette: turns the trail\'s Amount into colour: black where there is none, through deep amber and gold, to pale yellow in the thickest veins.',
      'Try other stops for a different look (black to cyan to white reads as a glowing circuit).',
    ]),
  }, { value: ['slimeTrail', 'amount'] });
  const nodes = [emit, group, deposit, trail, colour];
  if (withOutput) {
    nodes.push(n('output', 'slimeOutput', X(2100), Y(0), {
      ...note(['Output: the coloured trail is the picture.']),
    }, { color: ['slimeColour', 'color'] }));
  }
  return nodes;
}

export function buildAgentExamples(): Record<string, ExampleGraph> {
  return {
    slimeMold: { ...AGENT_EXAMPLE_INDEX.slimeMold, counter: 40, nodes: slimeMoldNodes(0, 200) },
    agentParticles: { ...AGENT_EXAMPLE_INDEX.agentParticles, counter: 40, nodes: particlesNodes(0, 200) },
    agentCurlSmoke: { ...AGENT_EXAMPLE_INDEX.agentCurlSmoke, counter: 40, nodes: curlSmokeNodes(0, 200) },
    agentSoundBurst: { ...AGENT_EXAMPLE_INDEX.agentSoundBurst, counter: 40, nodes: soundBurstNodes(0, 200) },
    agentMultiSlime: { ...AGENT_EXAMPLE_INDEX.agentMultiSlime, counter: 40, nodes: multiSlimeNodes(0, 200) },
    agentAnts: { ...AGENT_EXAMPLE_INDEX.agentAnts, counter: 40, nodes: antsNodes(0, 200) },
    agentBoids: { ...AGENT_EXAMPLE_INDEX.agentBoids, counter: 40, nodes: boidsNodes(0, 200) },
    agentStrands: { ...AGENT_EXAMPLE_INDEX.agentStrands, counter: 40, nodes: strandsNodes(0, 200) },
    agentGrowPicture: { ...AGENT_EXAMPLE_INDEX.agentGrowPicture, counter: 40, nodes: growPictureNodes(0, 200) },
  };
}

/**
 * The Slime mold preset with fresh ids (`nextId`), for adding to a graph:
 * the same nodes as the example, minus its Output. Returns the nodes and the
 * id of the colour node to wire into the graph's Output.
 */
export function slimeMoldPreset(nextId: () => string, at: { x: number; y: number }): { nodes: GraphNode[]; colourId: string } {
  const r = agentPreset('slimeMoldPreset', nextId, at)!;
  return { nodes: r.nodes, colourId: r.out.nodeId };
}

// ── Particles built from nodes (P2): forces chained through Also, Integrate, Age / Life ──


/**
 * Particles: the Particles node's default look built from nodes. Embers are
 * born on a ring and carried by curl noise and a gentle swirl, the mouse
 * pulls and stirs them, drag slows them, and they fade over their life,
 * drawn with glow and four orbiting lights.
 */
export function particlesNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  // ── Inside: the rule every particle follows, every step ──
  const inputs = n('agentInputs', 'ptIn', 0, 160, {
    _groupOriginal: true, extraInputs: [],
    ...note([
      'Agent Inputs: this particle as the step begins: where it is, how fast it moves, how old it is.',
      'Every force to the right reads its own position from here when its Position socket is left unwired, so nothing needs wiring from this card.',
    ]),
  });
  const curl = n('agentCurl', 'ptCurl', 420, 40, {
    strength: 0.4, size: 1, evolve: 0.15,
    ...note([
      'Curl noise: swirling currents that never bunch up (the Particles node\'s Turbulence, 0.4). It is the main motion: particles fold into streams and eddies.',
      'Evolve 0.15 lets the currents drift slowly, so the streams keep changing.',
      'Try: Strength 1.5 for a storm; Size 3 for small, tight eddies; Evolve 0 for a still river.',
    ]),
  });
  const swirl = n('agentVortex', 'ptSwirl', 840, 40, {
    x: 0, y: 0, strength: 0.3, reach: 0.5,
    ...note([
      'Vortex: a gentle swirl round the middle, counter-clockwise, strongest half a picture-height out (the Particles node\'s Swirl, 0.3).',
      'Why: it turns the ring\'s outward spray into a slowly turning wheel. Its Also input adds the curl noise in, so its Force is curl + swirl.',
      'Try: −0.6 to spin the other way; 0 to let the curl alone carry them.',
    ]),
  }, { also: ['ptCurl', 'force'] });
  const mouse = n('agentAttract', 'ptMouse', 1260, 40, {
    target: 'mouse', strength: 0.8, reach: 0.35, swirl: 0.6, falloff: 'reach',
    ...note([
      'Attract / Repel: the mouse pulls nearby particles in and stirs them round it (within 0.35), like the Particles node\'s hands.',
      'Its Also adds the chain so far, so this Force is the total: curl + swirl + mouse.',
      'Try: Strength −2 to blow them away from the pointer; wire a hand or a null from Play into Target instead of the mouse.',
    ]),
  }, { also: ['ptSwirl', 'force'] });
  const integrate = n('agentIntegrate', 'ptMove', 1680, 80, {
    drag: 1, maxSpeed: 4, mass: 1, edges: 'free',
    ...note([
      'Integrate: turns the total force into motion. Velocity gains Force × one step, Drag 1 bleeds a little speed away every step (the Particles node\'s), and position moves by velocity × one step.',
      'Edges Free: particles may drift off the picture; they live out their Life there and are born again on the ring.',
      'Try: Drag 0.2 for long, loose flights; 4 for syrup.',
    ]),
  }, { force: ['ptMouse', 'force'] });
  const age = n('agentAge', 'ptAge', 1680, 660, {
    span: 1,
    ...note([
      'Age / Life: how old the particle is against the Life Emit gave it (4 s ± half). Alive drops to 0 when its time is up.',
      'Why: dead particles are what Emit (Keep full) gives a new life on the ring, so the stream never runs dry.',
      'Try: Live for 0.5 to halve every life (a tighter ring of embers).',
    ]),
  });
  const output = n('agentOutput', 'ptOut', 2100, 140, {
    _groupOriginal: true,
    ...note([
      'Agent Output: the particle at the end of the step: Position and Velocity from Integrate, Alive from Age / Life.',
      'Heading and Speed are left unwired, so they follow from the Velocity.',
    ]),
  }, { position: ['ptMove', 'position'], velocity: ['ptMove', 'velocity'], alive: ['ptAge', 'alive'] });

  // ── Outside ──
  const emit = n('agentEmit', 'ptEmit', X(0), Y(0), {
    mode: 'respawn', shape: 'ring', heading: 'outward', x: 0, y: 0, size: 0.4, life: 4, lifeVar: 0.5, speed: 0.08, speedVar: 0.45, spread: 0.4,
    ...note([
      'Emit: particles are born on a ring (radius 0.4) moving outward at about 0.08, each direction straying a little (Spread 0.4), each living 4 s ± half: the Particles node\'s defaults.',
      'Births Keep full: every particle is born at once at a random age, and each is born again the moment it dies, so the ring always streams.',
      'Try: Shape Point for a fountain; Speed 0.4 for a burst of sparks; route a beat to Burst to send everyone out again at once.',
    ]),
  });
  const group = agentsGroup('particles', X(420), Y(0), 'ptEmit', [inputs, curl, swirl, mouse, integrate, age, output], {
    label: 'Particles',
    preroll: 4,
    ...note([
      'Agents: a million particles (1M), each running the rule inside (double-click to open it) every step, 2 steps a frame (about 7 ms a frame at 1080p on an M3 Pro, drawing included).',
      'The rule is a chain of forces (Curl noise → Vortex → Attract), added up through their Also inputs, then Integrate moves the particle and Age / Life ends it.',
      'Pre-roll 4: four seconds are simulated before the first frame, so the ring is already streaming when it appears.',
      'Try: Count 256k on a slower GPU; Steps per frame 1 to move at the Particles node\'s own pace (2 is twice as lively).',
    ]),
  });
  const bg = n('uv', 'ptUv', X(420), Y(380), { ...note(['UV: where each pixel is, for the background glow (y −1 at the bottom to 1 at the top).']) });
  const glow = expr('ptBg', X(840), Y(380), {
    label: 'Ember glow',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [['float r', 'length(uv)'], ['float halo', 'exp(-r * r * 2.5)']],
    result: 'vec3(0.012, 0.008, 0.01) + vec3(1.0, 0.32, 0.06) * 0.05 * halo',
    outputType: 'vec3',
    wires: { uv: ['ptUv', 'uv'] },
    note: [
      'Ember glow (an Expression Block): the dark background the particles are drawn over.',
      'r: how far this pixel is from the middle. halo: 1 in the middle, fading out with distance (e^(−2.5·r²)).',
      'Result: near-black, warmed with a faint orange where halo is high, as if the embers lit the air.',
    ],
  });
  const draw = n('drawAgents', 'ptDraw', X(1260), Y(0), {
    style: 'glow', colorBy: 'age', palette: 'ember', scaleBy: 'crowd', size: 2, brightness: 0.7, glow: 0.45, fade: 'on',
    lights: '4', lightColor: [1, 0.55, 0.25], lightPower: 1.6, lightReach: 0.3, halo: 0.5, lightMotion: 'orbit', lightOrbit: 0.48,
    ...note([
      'Draw agents: every particle as a soft dot with the Particles node\'s glow, coloured along the Ember palette by age (pale yellow when born, deep red as it dies) and fading in and out over its life.',
      'Four lights orbit the ring: particles near one shine brighter and larger, and each light has a halo. Brightness of The crowd keeps the cloud as bright at any count (0.7: every particle here is alive at once, where the Particles node keeps about two in three).',
      'Try: Style Streaks; Palette Ice or Aurora; Lights None for plain embers.',
    ]),
  }, { agents: ['particles', 'agents'], over: ['ptBg', 'result'] });
  const nodes = [emit, group, bg, glow, draw];
  if (withOutput) nodes.push(n('output', 'ptOutput', X(1680), Y(0), { ...note(['Output: the drawn particles over the glow are the picture.']) }, { color: ['ptDraw', 'color'] }));
  return nodes;
}

/**
 * Curl smoke: particles rise from a small source, warm air lifting them less
 * as they cool, curl noise folding them into threads and a gusty breeze
 * leaning them over, drawn as ink streaks on paper.
 */
export function curlSmokeNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = n('agentInputs', 'csIn', 0, 160, {
    _groupOriginal: true, extraInputs: [],
    ...note([
      'Agent Inputs: this bit of smoke as the step begins. Its Age (seconds since it left the source) goes to Rising heat.',
      'The forces read its position from here by themselves.',
    ]),
  });
  const heat = expr('csHeat', 420, 40, {
    label: 'Rising heat',
    inputs: [{ name: 'age', type: 'float' }],
    lines: [['float heat', 'exp(-age * 0.5)']],
    result: 'vec2(0.0, 0.75 * heat + 0.06)',
    outputType: 'vec2',
    wires: { age: ['csIn', 'age'] },
    note: [
      'Rising heat (an Expression Block, used as a force): warm smoke rises, and rises less as it cools.',
      'heat: 1 when the smoke leaves the source, halving about every 1.4 s (e^(−age / 2)).',
      'Result: an upward push of 0.75 × heat, plus a little lift that never fades (0.06), so old smoke still drifts up.',
    ],
  });
  const curl = n('agentCurl', 'csCurl', 840, 40, {
    strength: 0.45, size: 1.4, evolve: 0.3,
    ...note([
      'Curl noise: eddies that fold the rising column into curls and threads. Near the source Rising heat is stronger, so the column holds; higher up the heat fades and the eddies take over.',
      'Its Also adds Rising heat in.',
      'Try: Size 3 for finer, busier turbulence; Strength 1.5 to tear the column apart.',
    ]),
  }, { also: ['csHeat', 'result'] });
  const wind = n('agentWind', 'csWind', 1260, 40, {
    strength: 0.12, angle: 0, gust: 1, size: 0.6, evolve: 0.2,
    ...note([
      'Wind: a light breeze to the right with gusts, so the column leans and sways instead of standing straight. Its Also adds heat and curl: this Force is the total.',
      'Try: Angle 180 to blow it left; Strength 0 for still air.',
    ]),
  }, { also: ['csCurl', 'force'] });
  const integrate = n('agentIntegrate', 'csMove', 1680, 80, {
    drag: 1.4, maxSpeed: 3, mass: 1, edges: 'free',
    ...note([
      'Integrate: the total force moves the smoke. Drag 1.4 keeps it slow and floaty, like smoke in still air.',
      'Try: Drag 0.5 for a fast, thin plume.',
    ]),
  }, { force: ['csWind', 'force'] });
  const age = n('agentAge', 'csAge', 1680, 660, {
    span: 1,
    ...note([
      'Age / Life: each bit of smoke lives about 7 s; Alive goes to 0 at the end and Emit sends it up from the source again.',
    ]),
  });
  const output = n('agentOutput', 'csOut', 2100, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Integrate, Alive from Age / Life. Heading follows the velocity (Draw uses it for the streaks).']),
  }, { position: ['csMove', 'position'], velocity: ['csMove', 'velocity'], alive: ['csAge', 'alive'] });

  const emit = n('agentEmit', 'csEmit', X(0), Y(0), {
    mode: 'respawn', shape: 'disc', heading: 'random', x: 0, y: -0.8, size: 0.08, life: 7, lifeVar: 0.4, speed: 0.05, speedVar: 0.5, spread: 1,
    ...note([
      'Emit: the source, a small disc (radius 0.08) near the bottom (y −0.8). Each bit of smoke starts almost still in a random direction and lives 7 s ± 40%.',
      'Keep full: smoke that dies is sent up from the source again at once.',
      'Try: Shape Ring with Size 0.3 for a smoke ring; X −1 to move the source left.',
    ]),
  });
  const group = agentsGroup('smoke', X(420), Y(0), 'csEmit', [inputs, heat, curl, wind, integrate, age, output], {
    label: 'Curl smoke',
    preroll: 6,
    ...note([
      'Agents: a million bits of smoke (1M), 2 steps a frame. Inside (double-click): Rising heat → Curl noise → Wind, added through Also, then Integrate and Age / Life.',
      'Pre-roll 6: six seconds are simulated before the first frame, so the plume has already risen when it appears.',
    ]),
  });
  const draw = n('drawAgents', 'csDraw', X(840), Y(0), {
    style: 'ink', colorBy: 'single', palette: 'ab', colorA: [0.03, 0.03, 0.04], paper: [0.95, 0.95, 0.94],
    scaleBy: 'crowd', size: 0.6, brightness: 1.6, glow: 0.35, streak: 0.25, fade: 'on', lights: '0',
    ...note([
      'Draw agents, Ink: each bit of smoke lays a short streak of dark ink (Streak 0.25, along its motion) on pale paper; where many overlap the ink goes dark, and a little bleeds round it (Glow).',
      'Brightness of The crowd: the ink is shared out so the plume looks the same at any count. Fade with age thins the smoke as it gets old.',
      'Try: Style Glow with Palette Mono on a dark Over for white smoke.',
    ]),
  }, { agents: ['smoke', 'agents'] });
  const nodes = [emit, group, draw];
  if (withOutput) nodes.push(n('output', 'csOutput', X(1260), Y(0), { ...note(['Output: the smoke on paper is the picture.']) }, { color: ['csDraw', 'color'] }));
  return nodes;
}

/**
 * Sound burst: a disc of glowing streaks that a ring of pressure blasts
 * outward on every beat and a spring pulls back together. A silent
 * stand-in beat (120 a minute) drives it until real sound does.
 */
export function soundBurstNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = n('agentInputs', 'sbIn', 0, 160, {
    _groupOriginal: true, extraInputs: [],
    ...note([
      'Agent Inputs: this particle as the step begins. Its Position goes to Spring back; the other nodes read it by themselves.',
    ]),
  });
  const spring = expr('sbSpring', 420, 40, {
    label: 'Spring back',
    inputs: [{ name: 'p', type: 'vec2' }],
    lines: [['float r', 'length(p)'], ['float over', 'max(r - 0.55, 0.0)']],
    result: '-p / max(r, 1e-4) * over * 6.0',
    outputType: 'vec2',
    wires: { p: ['sbIn', 'position'] },
    note: [
      'Spring back (an Expression Block, used as a force): pulls particles that a beat threw out back toward the disc.',
      'r: how far the particle is from the middle. over: how far past the disc\'s edge (0.55) it is; 0 inside.',
      'Result: a pull toward the middle, 6 × over, so inside the disc nothing pulls and outside it pulls harder the further out.',
    ],
  });
  const kick = n('agentSoundKick', 'sbKick', 840, 40, {
    mode: 'shock', x: 0, y: 0, strength: 0.6, speed: 1.4, soundFrom: 'graph', level: 0, beat: 120,
    ...note([
      'Sound kick, Shockwave: every beat sends a ring of pressure out from the middle at 1.4 picture-heights a second, pushing particles out as it arrives and back behind it (the Particles node\'s Shock).',
      'Beat 120 is a silent stand-in: 120 kicks a minute, part of the simulation, so a recording matches the preview. Its Also adds Spring back.',
      'Try: Beat 0 and Sound from Mic or Audio engine (or map Level to an audio track in Play); Kick Wave or Vibrate for other answers to the sound.',
    ]),
  }, { also: ['sbSpring', 'result'] });
  const curl = n('agentCurl', 'sbCurl', 1260, 40, {
    strength: 0.25, size: 1.3, evolve: 0.2,
    ...note([
      'Curl noise: a soft drift so the disc is never still between beats. Its Also adds the kick and the spring: this Force is the total.',
    ]),
  }, { also: ['sbKick', 'force'] });
  const integrate = n('agentIntegrate', 'sbMove', 1680, 80, {
    drag: 2.5, maxSpeed: 6, mass: 1, edges: 'bounce',
    ...note([
      'Integrate: the force moves the particles; Drag 2.5 stops a blast quickly, so every beat reads as a sharp burst that settles.',
      'Edges Bounce keeps particles thrown far on the picture.',
      'Try: Drag 0.8 for long, floaty blasts.',
    ]),
  }, { force: ['sbCurl', 'force'] });
  const age = n('agentAge', 'sbAge', 1680, 660, {
    span: 1,
    ...note(['Age / Life: each particle lives about 6 s, then Emit gives it a new place in the disc.']),
  });
  const output = n('agentOutput', 'sbOut', 2100, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Integrate, Alive from Age / Life.']),
  }, { position: ['sbMove', 'position'], velocity: ['sbMove', 'velocity'], alive: ['sbAge', 'alive'] });

  const emit = n('agentEmit', 'sbEmit', X(0), Y(0), {
    mode: 'respawn', shape: 'disc', heading: 'random', x: 0, y: 0, size: 0.55, life: 6, lifeVar: 0.5, speed: 0,
    ...note([
      'Emit: particles are born anywhere in a disc (radius 0.55), still, each living 6 s ± half; Keep full gives each a new place when it dies.',
    ]),
  });
  const group = agentsGroup('burst', X(420), Y(0), 'sbEmit', [inputs, spring, kick, curl, integrate, age, output], {
    label: 'Sound burst',
    ...note([
      'Agents: a million particles (1M), 2 steps a frame. Inside (double-click): Spring back → Sound kick → Curl noise, added through Also, then Integrate and Age / Life.',
    ]),
  });
  const draw = n('drawAgents', 'sbDraw', X(840), Y(0), {
    style: 'streaks', colorBy: 'speed', palette: 'neon', speedRef: 0.6, scaleBy: 'crowd', size: 2, brightness: 0.8, glow: 0.6, streak: 0.35, fade: 'on', lights: '0',
    ...note([
      'Draw agents, Streaks: each particle is a short glowing line along its motion, coloured by speed on the Neon palette (Fast is 0.6): resting particles are violet, and a ring passing through shows as a bright cyan front.',
      'Try: Streak 1 for long trails after each beat; Colour by Age for calmer colours.',
    ]),
  }, { agents: ['burst', 'agents'] });
  const nodes = [emit, group, draw];
  if (withOutput) nodes.push(n('output', 'sbOutput', X(1260), Y(0), { ...note(['Output: the streaks are the picture.']) }, { color: ['sbDraw', 'color'] }));
  return nodes;
}

/** The starters in the node browser: each builds its example's nodes (minus the Output) and names the node to wire into the Output. */
const PRESET_BUILDERS: Record<string, { build: (x: number, y: number) => GraphNode[]; out: [string, string]; label: string }> = {
  slimeMoldPreset: { build: (x, y) => slimeMoldNodes(x, y, false), out: ['slimeColour', 'color'], label: 'Slime mold' },
  particlesPreset: { build: (x, y) => particlesNodes(x, y, false), out: ['ptDraw', 'color'], label: 'Particles' },
  curlSmokePreset: { build: (x, y) => curlSmokeNodes(x, y, false), out: ['csDraw', 'color'], label: 'Curl smoke' },
  soundBurstPreset: { build: (x, y) => soundBurstNodes(x, y, false), out: ['sbDraw', 'color'], label: 'Sound burst' },
  multiSlimePreset: { build: (x, y) => multiSlimeNodes(x, y, false), out: ['msColour', 'result'], label: 'Multi-species slime' },
  antsPreset: { build: (x, y) => antsNodes(x, y, false), out: ['antDraw', 'color'], label: 'Ants' },
  boidsPreset: { build: (x, y) => boidsNodes(x, y, false), out: ['bdDraw', 'color'], label: 'Boids' },
  strandsPreset: { build: (x, y) => strandsNodes(x, y, false), out: ['stDraw', 'color'], label: 'Strands' },
  growPicturePreset: { build: (x, y) => growPictureNodes(x, y, false), out: ['gpLook', 'result'], label: 'Grow toward a picture' },
};

/**
 * A preset (the node browser's starter `type`) with fresh ids (`nextId`), for adding to a graph:
 * the same nodes as its example, minus the Output. Returns the nodes and the socket to wire into
 * the graph's Output.
 */
export function agentPreset(type: string, nextId: () => string, at: { x: number; y: number }): { nodes: GraphNode[]; out: { nodeId: string; outputKey: string }; label: string } | null {
  const b = PRESET_BUILDERS[type];
  if (!b) return null;
  const nodes = b.build(at.x, at.y);
  const ids = new Map<string, string>();
  const collect = (list: GraphNode[]) => {
    for (const nd of list) {
      ids.set(nd.id, nextId());
      const sg = nd.params.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes) collect(sg.nodes);
    }
  };
  collect(nodes);
  const remap = (nd: GraphNode): GraphNode => {
    const inputs = Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection && ids.has(i.connection.nodeId)
      ? { ...i, connection: { ...i.connection, nodeId: ids.get(i.connection.nodeId)! } } : i]));
    const sg = nd.params.subgraph as { nodes?: GraphNode[] } | undefined;
    const params = sg?.nodes ? { ...nd.params, subgraph: { ...sg, nodes: sg.nodes.map(remap) } } : nd.params;
    return { ...nd, id: ids.get(nd.id)!, inputs, params };
  };
  return { nodes: nodes.map(remap), out: { nodeId: ids.get(b.out[0])!, outputKey: b.out[1] }, label: b.label };
}
