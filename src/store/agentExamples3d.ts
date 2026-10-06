/**
 * agentExamples3d.ts — "Agents in 3D" (docs/agents-group.md "3D"): an Agents group with Space 3D,
 * its walkers in a box (the picture across and up, 2 deep), seen by Draw agents through a camera.
 *
 *  - 3D slime mold: Sense on a cone, a volume trail, the network grown through the depth;
 *  - 3D flock: boids reading a velocity volume, an orbiting camera;
 *  - Swarm round a torus: a ray-marched torus, the swarm colliding with it through Collide (3D
 *    scene) and drawn through the scene's own camera, hidden behind it (Depth);
 *  - Galaxy in 3D: stars on tilted orbits round a flat disc, the camera above it;
 *  - Fireflies in the dark: depth of field (a shallow focus, out-of-focus fireflies as bokeh).
 *
 * Every node, inside the group (and inside the scene and the march) too, carries a plain-language
 * note, and every Expression Block explains each named line, which examples.test.ts checks. All of
 * them run 256k walkers.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { ExampleGraph } from './exampleIndex';
import { n } from './graphBuilder';
import { agentsGroup, expr, groupInput, note, withOutputs } from './agentExampleKit';
import { DRAW_3D_INPUTS } from '../nodes/definitions/agents';

type PortType = GraphNode['inputs'][string]['type'];

/** Agent Inputs with ports added to the group (a Trail texture, a Scene). */
function inputsWith(id: string, ports: Array<{ key: string; type: PortType; label: string }>, lines: string[]): GraphNode {
  return withOutputs(n('agentInputs', id, 0, 160, {
    _groupOriginal: true,
    extraInputs: ports,
    ...note(lines),
  }), Object.fromEntries(ports.map(p => [p.key, { type: p.type, label: p.label }])));
}

/** A dark background from the picture's UV (an Expression Block): `top` and `bottom` mixed by height, a faint glow in the middle. */
function backdrop(prefix: string, x: number, y: number, label: string, bottom: [number, number, number], top: [number, number, number], glow: [number, number, number], lines: string[]): GraphNode[] {
  const f = (c: number[]) => `vec3(${c.map(v => v.toFixed(3)).join(', ')})`;
  return [
    n('uv', `${prefix}Uv`, x, y, { ...note(['UV: where each pixel is on the picture, for the backdrop behind the walkers.']) }),
    expr(`${prefix}Back`, x + 420, y, {
      label,
      inputs: [{ name: 'uv', type: 'vec2' }],
      lines: [['float h', 'uv.y * 0.5 + 0.5'], ['float halo', 'exp(-dot(uv, uv) * 1.5)']],
      result: `mix(${f(bottom)}, ${f(top)}, h) + ${f(glow)} * halo`,
      outputType: 'vec3',
      wires: { uv: [`${prefix}Uv`, 'uv'] },
      note: [
        `${label} (an Expression Block): the backdrop the walkers are drawn over.`,
        'h: 0 at the bottom of the picture, 1 at the top. halo: 1 in the middle, fading out, a faint glow behind the walkers.',
        ...lines,
      ],
    }),
  ];
}

export const AGENT_3D_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  agent3dSlime: {
    label: '3D slime mold',
    description: 'Slime mold in a volume: a quarter of a million walkers sense a cone ahead of them, turn toward the strongest smell, move and leave trail in a 3D trail field that spreads and fades. A network of tubes grows through the whole box, seen by a slowly orbiting camera.',
  },
  agent3dFlock: {
    label: '3D flock',
    description: 'Boids in 3D: every bird leaves its velocity in a blurred 3D field, then matches the flow around it, drifts toward the crowd and away from a crush. Flocks gather, wheel and stream through the box while the camera circles them.',
  },
  agent3dTorus: {
    label: 'Swarm round a torus',
    description: 'A ray-marched torus and a swarm round it: the swarm is pulled to the middle, swirls and curls, and bounces off the torus through Collide (3D scene), which reads the same Scene on a coarse grid. The walkers are drawn through the scene\'s own camera and hidden behind the torus, so they stand in the scene.',
  },
  agent3dGalaxy: {
    label: 'Galaxy in 3D',
    description: 'A spiral galaxy you can fly round: stars on their own circular orbits in a thin disc, crowding into two turning spiral arms, a puffy bulge in the middle. The camera looks down at it from above and slowly circles; a little depth of field softens the near and far stars.',
  },
  agent3dFireflies: {
    label: 'Fireflies in the dark',
    description: 'Depth of field: fireflies drifting on slow 3D currents, the camera among them with a shallow focus. Near and far ones blur into soft discs of light (bokeh) while the ones at the focus stay sharp, and the camera drifts slowly through the swarm.',
  },
};

// ── 3D slime mold ─────────────────────────────────────────────────────────────

/** 3D slime mold: Sense on a cone round the heading, Crowding, Steer, Move in the box; a volume trail; drawn as glowing dots. */
export function slime3dNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('s3In', [{ key: 'trail', type: 'texture', label: 'Trail' }], [
    'Agent Inputs: this walker as the step begins: where it is and which way it faces (in 3D, a direction).',
    'Trail is an input added to the group: the 3D Trail field from outside (a volume), as it was one step ago.',
  ]);
  const sense = n('agentSense', 's3Sense', 420, 100, {
    angle: 30, distance: 0.15, weight: 1, width: '1', cone: 'plane',
    ...note([
      'Sense: sniffs the trail volume at three points 0.15 ahead (about 7 cells of the 96-row volume): straight on, and 30° off to either side.',
      'In 3D the side sensors lie on a cone round the heading: Sensors (3D) Turning plane puts them in a plane through the heading that turns at random every step, so over a few steps they sweep the whole cone, and Steer turns in that plane.',
      'Why so far: a volume\'s cells are much bigger than a 2D trail\'s pixels, so a 3D slime has to look further ahead to see past its own trail.',
      'Try: Sensors (3D) Ring of 4 for a steadier, more even network (5 reads instead of 3); Distance 0.25 for bigger cells.',
    ]),
  }, { texture: ['s3In', 'trail'] });
  const crowd = expr('s3Crowd', 840, 420, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3' }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    values: { sat: 40 },
    lines: [],
    result: 'r * exp(-r / sat)',
    outputType: 'vec3',
    wires: { r: ['s3Sense', 'readings'] },
    note: [
      'Crowding (an Expression Block): a tube\'s pull rises with its trail up to Sat (40) and falls past it, r · e^(−r / sat), as in the 2D Slime mold.',
      'Why: without it every walker ends up in a few thick tubes; with it the network stays many, fine and branching.',
      'Try: Sat 120 to watch the network coarsen into a few cables.',
    ],
  });
  const steer = n('agentSteer', 's3Steer', 840, 100, {
    mode: 'jones', turn: 30, jitter: 0.1,
    ...note([
      'Steer (Jones rule) in 3D: straight on if the centre smells strongest, a random side if both sides beat the centre, otherwise 30° toward the stronger side, in the plane Sense read this step.',
      'Try: Turn 15° for long smooth tubes; 60° for a tight, busy foam.',
    ]),
  }, { readings: ['s3Crowd', 'result'] });
  const move = n('agentMove', 's3Move', 1260, 100, {
    speed: 1.2, edges: 'wrap', onObstacle: 'turn',
    ...note([
      'Move: one step along the new heading at 1.2 a second (about one volume cell a step). Wrap: a walker leaving the box comes back on the other side, through the depth too.',
      'Try: Speed 0.8 for slower, thicker growth.',
    ]),
  }, { heading: ['s3Steer', 'heading'] });
  const output = n('agentOutput', 's3Out', 1680, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position, Heading and Velocity from Move. In 3D the velocity carries the heading to the next step.']),
  }, { position: ['s3Move', 'position'], heading: ['s3Move', 'heading'], velocity: ['s3Move', 'velocity'] });

  const emit = n('agentEmit', 's3Emit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random', x: 0, y: 0, size: 0.6, life: 0,
    ...note([
      'Emit: every walker is born at once anywhere in the box (Whole picture: the picture across and up, and 2 deep), facing any way.',
      'Try: Shape Ball (Size 0.3) with Facing Outward to watch the network grow out from a seed.',
    ]),
  });
  let group = agentsGroup('slime3d', X(420), Y(0), 's3Emit', [inputs, sense, crowd, steer, move, output], {
    label: '3D slime mold', space: '3d', preroll: 4,
    ...note([
      'Agents with Space 3D: 262,144 walkers (256k) in a box as deep as the picture is tall, 2 steps a frame. Inside (double-click): Sense → Crowding → Steer → Move, the slime rule in 3D.',
      'Pre-roll 4: four seconds simulated first, so the network has formed when the picture appears.',
      'Try: Count 1M for a denser network (about 16 ms a frame at 1080p on an M3 Pro); Space 2D to see the same rule flat (then set Sense Distance 0.035 and Move Speed 0.22).',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['s3Trail', 'texture']);
  const deposit = n('agentDeposit', 's3Deposit', X(840), Y(0), {
    amount: 4, size: 1, what: 'trail',
    ...note([
      'Deposit: every walker drops 4 units of trail in the volume cell it stands in, every step.',
      'Why: the trail is how walkers find each other; where many walk, more trail pulls in more walkers, and tubes form.',
    ]),
  }, { agents: ['slime3d', 'agents'] });
  const trail = n('trailField', 's3Trail', X(1260), Y(0), {
    resolution: '0.5', volume: '96', diffuse: 1, halfLife: 0.1, edges: 'wrap', gain: 0.04, kernel: '3',
    ...note([
      'Trail field, filled by a 3D group: a volume, 96 rows tall and 96 slices deep (171 cells across at 16:9). Each step every cell becomes the average of itself and its 6 neighbours, and half fades in 0.1 s.',
      'Its Image goes back into the group for Sense, read in 3D. Its Amount here would be the volume seen from the front; this example shows the walkers through a camera instead.',
      'Try: Volume 128 for finer tubes (more memory and time), 64 for a fast, coarse one; Half-life 0.3 for thicker, slower tubes.',
    ]),
  }, { deposit: ['s3Deposit', 'deposit'] });
  const back = backdrop('s3', X(840), Y(380), 'Night', [0.01, 0.006, 0.012], [0.004, 0.008, 0.02], [0.03, 0.012, 0.02], ['Result: near-black, dark plum at the bottom to deep blue at the top, with the glow in the middle.']);
  const draw = n('drawAgents', 's3Draw', X(1680), Y(0), {
    style: 'glow', colorBy: 'heading', palette: 'ab', colorA: [1.0, 0.55, 0.2], colorB: [0.35, 0.65, 1.0], scaleBy: 'crowd', size: 1.4, brightness: 2.2, glow: 0.9, fade: 'off', lights: '0',
    camDist: 3.8, camAngle: 15, camElevation: 15, rotSpeed: 6, fov: 1.8, ortho: 0, camX: 0, camY: 0, camZ: 0, drift: 0, focus: 1, blur: 0.2, maxBlur: 7,
    ...note([
      'Draw agents in 3D: every walker as a soft glowing dot, coloured by heading (amber one way, blue the other), seen through a camera 3.8 from the middle that circles the box at 6° a second, 15° above it.',
      'Blur 0.2 with Focus 1: the middle of the box is sharp, the near and far walkers a little soft, which makes the depth read.',
      'Try: Flatten 1 for an isometric view; Orbit speed 0 and drag Angle to look from the side; Elevation 89 to look straight down.',
    ]),
  }, { agents: ['slime3d', 'agents'], over: ['s3Back', 'result'] });
  const nodes = [emit, group, deposit, trail, ...back, draw];
  if (withOutput) nodes.push(n('output', 's3Output', X(2100), Y(0), { ...note(['Output: the walkers, drawn through the camera over the night backdrop, are the picture.']) }, { color: ['s3Draw', 'color'] }));
  return nodes;
}

// ── 3D flock ─────────────────────────────────────────────────────────────────

/** 3D flock: field boids in a velocity volume (align, cohere / separate, cruise), a curl breeze, an orbiting camera. */
export function flock3dNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('f3In', [{ key: 'trail', type: 'texture', label: 'Trail' }], [
    'Agent Inputs: this bird as the step begins: its Velocity goes to Flock.',
    'Trail is an input added to the group: the flow volume from outside (the birds\' velocities, blurred, and how many there are), as it was one step ago.',
  ]);
  const count = expr('f3Count', 420, 460, {
    label: 'Count channel',
    inputs: [],
    lines: [],
    result: 'vec4(0.0, 0.0, 0.0, 1.0)',
    outputType: 'vec4',
    note: ['Count channel (an Expression Block): picks the volume\'s fourth channel, the count of birds (in 3D a velocity deposit fills x, y, z and counts in the fourth), so Sense measures how crowded it is.'],
  });
  const sense = n('agentSense', 'f3Sense', 840, 360, {
    angle: 30, distance: 0.2, weight: 1, width: '1', cone: 'plane',
    ...note([
      'Sense: reads the crowd (Count channel) round the bird, 0.2 away (about 6 cells of the 64-row volume). Its Gradient, which way the crowd thickens in 3D, goes to Flock; its Channels here, the flow where the bird is (summed velocities and the count), too.',
    ]),
  }, { texture: ['f3In', 'trail'], channels: ['f3Count', 'result'] });
  const flock = expr('f3Flock', 1260, 100, {
    label: 'Flock',
    inputs: [
      { name: 'flow', type: 'vec4' }, { name: 'grad', type: 'vec3' }, { name: 'v', type: 'vec3' },
      { name: 'alignW', type: 'float', slider: { min: 0, max: 10 } }, { name: 'cohereW', type: 'float', slider: { min: 0, max: 4 } },
      { name: 'packed', type: 'float', slider: { min: 1, max: 100 } }, { name: 'cruiseSpeed', type: 'float', slider: { min: 0, max: 2 } },
    ],
    values: { alignW: 4, cohereW: 2.5, packed: 30, cruiseSpeed: 0.6 },
    lines: [
      ['float crowd', 'max(flow.w, 0.0)'],
      ['vec3 avg', 'flow.xyz / max(crowd, 1e-3)'],
      ['vec3 align', '(avg - v) * alignW * crowd / (crowd + 1.0)'],
      ['vec3 cohere', 'grad / (crowd + 1.0) * cohereW * (1.0 - crowd / packed)'],
      ['float speed', 'max(length(v), 1e-4)'],
      ['vec3 cruise', 'v / speed * (cruiseSpeed - speed) * 2.5'],
    ],
    result: 'align + cohere + cruise',
    outputType: 'vec3',
    wires: { flow: ['f3Sense', 'sample'], grad: ['f3Sense', 'gradient'], v: ['f3In', 'velocity'] },
    note: [
      'Flock (an Expression Block): the three boid rules in 3D, read from the flow volume instead of from neighbours. Its Result is a force for Curl noise\'s "+ Another force". Its four sliders tune the flock.',
      'crowd: how many birds are around (the volume\'s count). avg: their average velocity.',
      'align: steer toward the average velocity (match the flock) by Align W, more where there are more birds.',
      'cohere: drift up the crowd\'s slope (toward the flock) by Cohere W while fewer than Packed are around, and down it once more are (separation).',
      'speed: this bird\'s speed. cruise: speed up or slow down toward Cruise speed.',
      'Try: Align W 8 for tight, glassy flocks; 0 for a swarm of gnats. Packed 8 for loose flocks, 60 for dense balls.',
    ],
  });
  const curl = n('agentCurl', 'f3Curl', 1680, 100, {
    strength: 0.4, size: 0.9, evolve: 0.25,
    ...note([
      'Curl noise in 3D: a swirling breeze added to Flock (its "+ Another force"), folding through the depth too, so flocks wheel, split and meet instead of all flying one way.',
      'Try: 0 and the whole flock slowly agrees on one direction; 1 for restless murmurations.',
    ]),
  }, { also: ['f3Flock', 'result'] });
  const integrate = n('agentIntegrate', 'f3Move', 2100, 100, {
    drag: 0.2, maxSpeed: 1.2, mass: 1, edges: 'wrap',
    ...note([
      'Integrate: the force moves the bird; Max speed 1.2 caps a dive, Drag 0.2 smooths it. Wrap: off one side of the box, back in at the other (through the depth too).',
    ]),
  }, { force: ['f3Curl', 'force'] });
  const output = n('agentOutput', 'f3Out', 2520, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Integrate; the heading follows the velocity (the streaks point along it).']),
  }, { position: ['f3Move', 'position'], velocity: ['f3Move', 'velocity'] });

  const emit = n('agentEmit', 'f3Emit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random', speed: 0.5, speedVar: 0.2,
    ...note(['Emit: every bird starts somewhere in the box, flying in a random direction at about 0.5. The flocks sort themselves out within seconds.']),
  });
  let group = agentsGroup('flock3d', X(420), Y(0), 'f3Emit', [inputs, count, sense, flock, curl, integrate, output], {
    label: '3D flock', space: '3d', tier: '64k', preroll: 6,
    ...note([
      'Agents with Space 3D: 65,536 birds (64k) in a box as deep as the picture is tall, 2 steps a frame. The rule inside (double-click) is Flock → Curl noise → Integrate.',
      'Pre-roll 6: six seconds simulated first, so flocks have formed when the picture appears.',
      'Try: Count 256k for a sky full of murmurations (set Deposit\'s Amount to 0.5, so the field\'s numbers stay the same).',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['f3Trail', 'texture']);
  const deposit = n('agentDeposit', 'f3Deposit', X(840), Y(0), {
    what: 'velocity', amount: 2, size: 1,
    ...note([
      'Deposit, What Velocity: every bird adds twice its velocity (x, y and z) to the volume\'s first three channels and 2 to the fourth (a count), each step (2: with 64k birds the field needs a stronger signal).',
      'Why: the blurred sum is "how the birds around here move" and "how many there are", all Flock needs.',
    ]),
  }, { agents: ['flock3d', 'agents'] });
  const trail = n('trailField', 'f3Trail', X(1260), Y(0), {
    resolution: '0.5', volume: '64', diffuse: 1, halfLife: 0.08, edges: 'wrap', gain: 0.1, kernel: '5',
    ...note([
      'Trail field, filled by a 3D group: the flow volume, 64 rows and 64 slices deep, spread by the soft 27-cell blur (Spread 5×5) every step and fading fast (half-life 0.08 s), so it is the birds\' motion right now, blurred over a few body lengths.',
      'It keeps negative numbers (velocities point both ways) because a Velocity deposit goes into it.',
      'Try: Volume 96 for smaller, twitchier flocks.',
    ]),
  }, { deposit: ['f3Deposit', 'deposit'] });
  const back = backdrop('f3', X(840), Y(380), 'Dusk', [0.17, 0.08, 0.1], [0.03, 0.05, 0.12], [0.02, 0.015, 0.01], ['Result: dusky rose at the bottom to deep blue at the top, like an evening sky.']);
  const draw = n('drawAgents', 'f3Draw', X(1680), Y(0), {
    style: 'streaks', colorBy: 'heading', palette: 'ab', colorA: [1.0, 0.72, 0.4], colorB: [0.45, 0.75, 1.0], scaleBy: 'crowd', size: 1.5, brightness: 0.6, glow: 0.35, streak: 0.35, fade: 'off', lights: '0',
    camDist: 3.6, camAngle: 0, camElevation: 20, rotSpeed: 10, fov: 1.8, ortho: 0, camX: 0, camY: 0, camZ: 0, drift: 0.05, focus: 1, blur: 0.15, maxBlur: 7,
    ...note([
      'Draw agents in 3D, Streaks: every bird as a short glowing line along its flight, coloured by heading, seen through a camera 3.6 away that orbits the box at 10° a second, 20° above it, with a little Drift.',
      'Try: Orbit speed 0 and Flatten 1 for a still, isometric view; Streak 1.2 for long trails.',
    ]),
  }, { agents: ['flock3d', 'agents'], over: ['f3Back', 'result'] });
  const nodes = [emit, group, deposit, trail, ...back, draw];
  if (withOutput) nodes.push(n('output', 'f3Output', X(2100), Y(0), { ...note(['Output: the birds, drawn through the orbiting camera over the dusk, are the picture.']) }, { color: ['f3Draw', 'color'] }));
  return nodes;
}

// ── Swarm round a torus ──────────────────────────────────────────────────────

/** A swarm round a ray-marched torus: Collide (3D scene) on the Scene's grid; drawn through the scene's camera, hidden behind the torus. */
export function torus3dNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  // ── The scene: a torus, a camera circling it, the march, its light ──
  const scene = n('sceneGroup', 'tsScene', X(0), Y(-700), {
    label: 'Torus',
    subgraph: {
      nodes: [
        n('scenePos', 'tsPos', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured: every ray step of the march, and every cell of Collide (3D scene)\'s grid.']) }),
        n('torusSDF3D', 'tsTorus', 420, 200, {
          majorR: 0.85, minorR: 0.3,
          ...note(['Torus SDF 3D: a ring 0.85 across from its middle, its tube 0.3 thick, lying flat (round the up axis). Its distance is the whole scene.', 'Try: Tube r 0.15 for a thin hoop the swarm can pour through.']),
        }, { pos: ['tsPos', 'pos'] }),
        n('sceneOutput', 'tsOut', 840, 200, { _groupOriginal: true, ...note(['Scene Output: the torus\'s distance is the scene: the March Loop draws it, Collide (3D scene) keeps the swarm out of it.']) }, { dist: ['tsTorus', 'dist'] }),
      ],
      inputPorts: [], outputPorts: [],
    },
    ...note([
      'Scene Group: the 3D shapes as one distance function, here a single torus. The same Scene goes to the March Loop (to draw it) and into the Agents group (to collide with it).',
    ]),
  });
  const time = n('time', 'tsTime', X(0), Y(-1000), { ...note(['Time: the clock, so the camera circles the torus (Rot Speed) the same way in the preview and in a recording.']) });
  const cam = n('marchCamera', 'tsCam', X(420), Y(-1000), {
    camDist: 3.6, camAngle: 0.4, camElevation: 0.42, rotSpeed: 0.12, fov: 1.6, targetX: 0, targetY: 0, targetZ: 0,
    ...note([
      'March Camera: 3.6 from the middle, 24° above it, circling at 0.12 radians a second. Its Ray Origin and Ray Dir go to the March Loop and to Draw agents (Camera from, Camera ray), so the swarm is seen through the same camera as the torus.',
    ]),
  }, { time: ['tsTime', 'time'] });
  const march = n('marchLoopGroup', 'tsMarch', X(840), Y(-1000), {
    maxSteps: 80, bg: [0.02, 0.022, 0.035],
    subgraph: {
      nodes: [
        n('marchLoopInputs', 'tsMarchIn', 0, 180, { _groupOriginal: true, ...note(['Group Inputs: where the ray has got to (March Pos) at each step of the march.']) }),
        n('marchLoopOutput', 'tsMarchOut', 440, 180, { _groupOriginal: true, ...note(['Group Output: the point measured at this step, left as it is (nothing warped).']) }, { pos: ['tsMarchIn', 'marchPos'] }),
      ],
      inputPorts: [], outputPorts: [],
    },
    ...note([
      'March Loop: for each pixel, steps along its ray until it hits the torus. Its Normal and Hit light the torus; its Distance (how far the ray went) goes to Draw agents\' Depth, so walkers behind the torus are hidden.',
    ]),
  }, { ro: ['tsCam', 'ro'], rd: ['tsCam', 'rd'], scene: ['tsScene', 'scene'] });
  const base = n('colorPicker', 'tsBase', X(840), Y(-700), { color: [0.32, 0.34, 0.4], ...note(['Color Picker: the torus\'s colour, a cool dark grey that lets the swarm\'s light stand out.']) });
  const lit = n('multiLight', 'tsLit', X(1260), Y(-1000), {
    sunDirX: 0.6, sunDirY: 0.8, sunDirZ: 0.3, skyR: 0.08, skyG: 0.1, skyB: 0.16, bounceR: 0.05, bounceG: 0.03, bounceB: 0.02,
    ...note(['Multi-Light: the torus lit by a sun from above and a faint blue sky; misses (Hit 0) stay black.']),
  }, { baseColor: ['tsBase', 'rgb'], normal: ['tsMarch', 'normal'], hit: ['tsMarch', 'hit'] });
  const tone = n('toneMap', 'tsTone', X(1680), Y(-1000), { mode: 'aces', ...note(['Tone Map: keeps the lit torus from clipping; its colour is what the swarm is drawn over.']) }, { color: ['tsLit', 'color'] });

  // ── The swarm ──
  const inputs = inputsWith('tsIn', [{ key: 'scene', type: 'scene3d', label: 'Scene' }], [
    'Agent Inputs: this walker as the step begins: its Position goes to Smoke-ring flow.',
    'Scene is an input added to the group (+ Add an input from outside, Scene): the Torus scene from outside, for Collide (3D scene).',
  ]);
  const ring = expr('tsRing', 420, 40, {
    label: 'Smoke-ring flow',
    inputs: [
      { name: 'p', type: 'vec3' },
      { name: 'ringR', type: 'float', slider: { min: 0.2, max: 2 } }, { name: 'shell', type: 'float', slider: { min: 0.2, max: 1.2 } },
      { name: 'roll', type: 'float', slider: { min: -6, max: 6 } }, { name: 'hold', type: 'float', slider: { min: 0, max: 10 } },
      { name: 'spin', type: 'float', slider: { min: -4, max: 4 } },
    ],
    values: { ringR: 0.85, shell: 0.2, roll: 2.4, hold: 6, spin: 0.7 },
    lines: [
      ['vec2 side', 'normalize(p.xz + vec2(1e-4, 0.0))'],
      ['vec3 core', 'vec3(side.x, 0.0, side.y) * ringR'],
      ['vec3 d', 'p - core'],
      ['float dist', 'max(length(d), 1e-3)'],
      ['vec3 along', 'vec3(-side.y, 0.0, side.x)'],
      ['vec3 around', 'cross(along, d) / dist'],
    ],
    result: 'around * roll - d / dist * (dist - shell) * hold + along * spin',
    outputType: 'vec3',
    wires: { p: ['tsIn', 'position'] },
    note: [
      'Smoke-ring flow (an Expression Block): a force that makes the swarm circulate round the torus\'s tube like a smoke ring, in through the hole and back round the outside, while it streams along the ring. Its sliders shape the flow.',
      'side: which way from the middle this walker is, flat (across and in depth). core: the nearest point on the ring\'s centre line (Ring R from the middle).',
      'd: from that point to the walker. dist: how far that is.',
      'along: the direction round the ring. around: round the tube, across the ring (the smoke-ring roll).',
      'Result: roll round the tube (Roll), pulled back toward a shell Shell from the ring\'s centre line (Hold), and drifting along the ring (Spin). Shell 0.2 lies inside the tube (0.3 thick), so the flow presses onto the torus and Collide (3D scene) makes it skim the surface.',
      'Try: Roll −2.4 to turn the other way; Shell 0.5 for a smoke ring that floats clear of the torus; Spin 0 for a pure smoke ring.',
    ],
  });
  const curl = n('agentCurl', 'tsCurl', 840, 40, {
    strength: 0.6, size: 1.4, evolve: 0.3,
    ...note(['Curl noise in 3D: currents added to the ring flow (its "+ Another force"), so the swarm folds into wisps and streams instead of a smooth shell.', 'Try: 0 for a clean smoke ring.']),
  }, { also: ['tsRing', 'result'] });
  const integrate = n('agentIntegrate', 'tsMove', 1680, 40, {
    drag: 1.2, maxSpeed: 3, mass: 1, edges: 'free',
    ...note(['Integrate: the forces move the walker, slowed by Drag 1.2 (so it follows the flow closely) and capped at 3 a second. Edges Free: walkers may leave the box (the flow brings them back).']),
  }, { force: ['tsCurl', 'force'] });
  const collide = n('agentCollideScene', 'tsCollide', 2100, 40, {
    reach: 1.6, x: 0, y: 0, z: 0, margin: 0.03, cushion: 0.18, bounce: 0.2, friction: 0.02,
    ...note([
      'Collide (3D scene): keeps walkers out of the torus. It reads the Scene (through the group\'s Scene port) on a coarse 48-cell grid spanning ±1.6 round the middle, filled every step, and puts a walker back on the surface with its inward speed gone (Bounce 0.2 keeps a little), parting the stream just before it touches (Cushion).',
      'Try: Bounce 1 for a hailstorm; Scene size 3 if you make the torus bigger.',
    ]),
  }, { scene: ['tsIn', 'scene'], position: ['tsMove', 'position'], velocity: ['tsMove', 'velocity'] });
  const age = n('agentAge', 'tsAge', 1680, 520, { span: 1, ...note(['Age / Life: Alive drops to 0 when the walker\'s life is up; Emit (Keep full) gives it a new one at once.']) });
  const output = n('agentOutput', 'tsOut2', 2520, 100, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity after Collide, Alive from Age / Life.']),
  }, { position: ['tsCollide', 'position'], velocity: ['tsCollide', 'velocity'], alive: ['tsAge', 'alive'] });

  const emit = n('agentEmit', 'tsEmit', X(0), Y(0), {
    mode: 'respawn', shape: 'sphere', heading: 'random', x: 0, y: 0, z: 0, size: 1.0, life: 8, lifeVar: 0.5, speed: 0.3, speedVar: 0.4, spread: 0,
    ...note([
      'Emit: walkers are born on a sphere 1.0 round the middle (Sphere: its shell), flying any way at about 0.3, each living 8 s ± half; Keep full brings each back the moment it dies, so the swarm is always fed from outside and drawn into the ring.',
    ]),
  });
  let group = agentsGroup('torus3d', X(420), Y(0), 'tsEmit', [inputs, ring, curl, integrate, collide, age, output], {
    label: 'Swarm', space: '3d', preroll: 5,
    ...note([
      'Agents with Space 3D: 262,144 walkers (256k), 2 steps a frame. Inside (double-click): Smoke-ring flow → Curl noise → Integrate → Collide (3D scene), and Age / Life.',
      'Its Scene input carries the Torus scene in, for Collide (3D scene).',
      'Pre-roll 5: five seconds simulated first, so the swarm is already streaming round the torus.',
    ]),
  });
  group = groupInput(group, 'scene', 'scene3d', 'Scene', ['tsScene', 'scene']);
  const draw = n('drawAgents', 'tsDraw', X(840), Y(0), {
    style: 'glow', colorBy: 'speedFast', palette: 'ice', scaleBy: 'crowd', size: 1.5, brightness: 2.4, glow: 1.0, fade: 'on', speedRef: 2.5, lights: '0',
    focus: 1, blur: 0.25, maxBlur: 7,
    ...note([
      'Draw agents in 3D through the scene\'s camera: Camera from and Camera ray are the March Camera\'s, so the swarm stands in the scene; Depth is the March Loop\'s Distance, so walkers behind the torus are hidden.',
      'Colour by Speed, fast first, on the Ice palette: the fast ones whipping through the hole pale, the slower ones deep blue. Blur 0.25 softens the near and far ones.',
      'Try: unwire Depth to see the walkers behind the torus too.',
    ]),
  }, { agents: ['torus3d', 'agents'], over: ['tsTone', 'color'] });
  // Its 3D sockets (a 3D group's Draw agents has them): the scene's camera and its depth.
  draw.params.agentSpace = '3d';
  draw.inputs.camOrigin = { ...DRAW_3D_INPUTS.camOrigin, connection: { nodeId: 'tsCam', outputKey: 'ro' } };
  draw.inputs.camRay = { ...DRAW_3D_INPUTS.camRay, connection: { nodeId: 'tsCam', outputKey: 'rd' } };
  draw.inputs.depth = { ...DRAW_3D_INPUTS.depth, connection: { nodeId: 'tsMarch', outputKey: 'dist' } };
  const nodes = [time, cam, scene, march, base, lit, tone, emit, group, draw];
  if (withOutput) nodes.push(n('output', 'tsOutput', X(1260), Y(0), { ...note(['Output: the swarm drawn into the lit torus scene is the picture.']) }, { color: ['tsDraw', 'color'] }));
  return nodes;
}

// ── Galaxy in 3D ──────────────────────────────────────────────────────────────

/** Galaxy in 3D: exact circular orbits in a thin disc (Memory: the radius and the height), two turning arms, seen from above. */
export function galaxy3dNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = n('agentInputs', 'g3In', 0, 160, {
    _groupOriginal: true, extraInputs: [],
    ...note(['Agent Inputs: this star as the step begins: where it is (Position, in 3D), what it remembers (Memory: its orbit\'s radius and its height above the disc, 0 on its first step) and its number (Index).']),
  });
  const time = n('time', 'g3Time', 0, 620, { ...note(['Time: the simulation\'s clock (each step\'s own time), so the spiral pattern turns at the same pace in the preview and in a recording.']) });
  const orbit = expr('g3Orbit', 420, 40, {
    label: 'Orbit and arms',
    inputs: [
      { name: 'p', type: 'vec3' }, { name: 'mem', type: 'vec2' }, { name: 't', type: 'float' },
      { name: 'spin', type: 'float', slider: { min: 0, max: 2 } }, { name: 'arms', type: 'float', slider: { min: 0, max: 0.4 } },
      { name: 'wind', type: 'float', slider: { min: 0, max: 12 } }, { name: 'thick', type: 'float', slider: { min: 0, max: 0.3 } },
    ],
    values: { spin: 0.5, arms: 0.12, wind: 6, thick: 0.08 },
    lines: [
      ['float home', 'mem.x > 0.0 ? mem.x : length(p.xz) + 1e-3'],
      ['float disc', 'smoothstep(0.08, 0.3, home)'],
      ['float lift', 'mem.x > 0.0 ? mem.y : p.y * mix(0.6, thick, disc)'],
      ['float vc', 'spin * home / (home + 0.12)'],
      ['float angle', 'atan(p.z, p.x) + vc / home / 60.0'],
      ['float phase', '2.0 * angle - wind * log(home) - 0.12 * t'],
      ['float r', 'home * (1.0 + arms * cos(phase) * disc)'],
      ['float crest', 'pow(0.5 + 0.5 * cos(phase + 0.35), 4.0) * disc'],
      ['vec3 next', 'vec3(r * cos(angle), lift, r * sin(angle))'],
      ['vec3 vel', '(next - p) * 60.0'],
      ['vec2 keep', 'vec2(home, lift)'],
    ],
    result: 'next',
    outputType: 'vec3',
    exposed: [{ name: 'vel', type: 'vec3' }, { name: 'keep', type: 'vec2' }, { name: 'crest', type: 'float' }],
    wires: { p: ['g3In', 'position'], mem: ['g3In', 'memory'], t: ['g3Time', 'time'] },
    note: [
      'Orbit and arms (an Expression Block): moves each star one step round its own circular orbit in the disc (across and in depth, round the up axis) and bends that orbit a little into two spiral arms. Its Result is the star\'s new position.',
      'home: the radius of the star\'s orbit: what it remembers (Memory), or on its first step how far from the up axis it was born.',
      'disc: 0 in the bulge, 1 out in the disc, so the arms start outside the core.',
      'lift: the star\'s height above the disc: remembered, or on its first step its birth height squashed (Thick in the disc, more in the bulge, so the bulge stays puffy).',
      'vc: the orbit speed at that radius, nearly the same at every radius (Spin), as real galaxies spin.',
      'angle: where round the orbit the star is after this step. phase: where it is against a two-armed spiral (Wind: how tightly it winds) that turns slowly with time.',
      'r: the orbit bent in and out by the spiral (Arms), so stars bunch into arms they stream through. crest: 1 where they bunch (an output for Star colour).',
      'next: the new position (the disc lies flat, the camera looks down on it). vel: the step as a velocity. keep: radius and height to remember (outputs for Agent Output).',
      'Try: Thick 0.25 for a fat, elliptical-looking galaxy; Arms 0 for a smooth disc; Wind 10 for tightly wound arms.',
    ],
  });
  const colour = expr('g3Colour', 840, 520, {
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
    wires: { i: ['g3In', 'index'], home: ['g3Orbit', 'keep'], crest: ['g3Orbit', 'crest'] },
    note: [
      'Star colour (an Expression Block): each star\'s own colour, for Draw agents\' Colour by Agent (the 2D Galaxy\'s).',
      'r: the radius of the star\'s orbit. h: a number 0–1 of the star\'s own (from its Index).',
      'core: warm old stars blazing in the bulge. young: blue, one in twenty pink, like star-forming knots. old: dim dusty stars between the arms.',
      'disc: old turning young where crest says the star is in an arm, so the arms light up as stars pass through them.',
      'Result: core in the middle turning to disc further out.',
    ],
  });
  const output = n('agentOutput', 'g3Out', 1260, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Orbit and arms, Memory its radius and height (keep), Colour from Star colour.']),
  }, { position: ['g3Orbit', 'result'], velocity: ['g3Orbit', 'vel'], memory: ['g3Orbit', 'keep'], colour: ['g3Colour', 'result'] });

  const disc = n('agentEmit', 'g3Disc', X(0), Y(160), {
    mode: 'fill', shape: 'ball', heading: 'random', x: 0, y: 0, z: 0, size: 0.95, life: 0, share: 3,
    ...note([
      'Emit (the disc): three quarters of the stars are born anywhere in a ball 0.95 round the middle; Orbit and arms flattens each into the disc at the radius it was born at.',
      'Its "+ Another Emit" chains the bulge Emit in: births are shared by Share (3 here, 1 there).',
    ]),
  }, { also: ['g3Bulge', 'emitter'] });
  const bulge = n('agentEmit', 'g3Bulge', X(0), Y(-160), {
    mode: 'fill', shape: 'ball', heading: 'random', x: 0, y: 0, z: 0, size: 0.35, life: 0, share: 1,
    ...note(['Emit (the bulge): a quarter of the stars are born in a small ball in the middle (0.35), which stays puffy: the bulge.']),
  });
  const group = agentsGroup('galaxy3d', X(420), Y(0), 'g3Disc', [inputs, time, orbit, colour, output], {
    label: 'Galaxy', space: '3d', preroll: 2,
    ...note([
      'Agents with Space 3D: 262,144 stars (256k), 2 steps a frame. Inside (double-click): Orbit and arms moves each star round its orbit in the disc, Star colour colours it.',
      'Try: Count 1M for a denser, smoother galaxy.',
    ]),
  });
  const back = backdrop('g3', X(420), Y(420), 'Deep space', [0.004, 0.006, 0.014], [0.002, 0.003, 0.008], [0.012, 0.009, 0.006], ['Result: near-black blue with a faint warm haze in the middle.']);
  const draw = n('drawAgents', 'g3Draw', X(1260), Y(0), {
    style: 'glow', colorBy: 'agent', palette: 'ab', scaleBy: 'crowd', size: 1.5, brightness: 1.8, glow: 1.3, fade: 'off', lights: '0',
    camDist: 2.7, camAngle: 30, camElevation: 38, rotSpeed: 4, fov: 1.8, ortho: 0, camX: 0, camY: 0, camZ: 0, drift: 0.08, focus: 1, blur: 0.4, maxBlur: 8,
    ...note([
      'Draw agents in 3D: every star a soft dot in its own colour (Colour by Agent), seen from 38° above the disc by a camera 2.7 away that circles at 4° a second, drifting a little. Blur 0.4 softens the near and far stars.',
      'Try: Elevation 85 to look straight down on the spiral; Elevation 3 to see the disc edge-on, a thin line with a bulge; Translate Y 0.3 to fly over it.',
    ]),
  }, { agents: ['galaxy3d', 'agents'], over: ['g3Back', 'result'] });
  const nodes = [bulge, disc, group, ...back, draw];
  if (withOutput) nodes.push(n('output', 'g3Output', X(1680), Y(0), { ...note(['Output: the stars over deep space are the picture.']) }, { color: ['g3Draw', 'color'] }));
  return nodes;
}

// ── Fireflies in the dark (depth of field) ───────────────────────────────────

/** Fireflies: slow 3D currents, a camera among them with a shallow focus, out-of-focus ones as bokeh. */
export function fireflies3dNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = n('agentInputs', 'ffIn', 0, 160, {
    _groupOriginal: true, extraInputs: [],
    ...note(['Agent Inputs: this firefly as the step begins; the forces to the right read its position from here by themselves.']),
  });
  const curl = n('agentCurl', 'ffCurl', 420, 40, {
    strength: 0.25, size: 0.7, evolve: 0.12,
    ...note(['Curl noise in 3D: slow, wide currents the fireflies drift on, changing gently (Evolve 0.12).', 'Try: Strength 0.6 for a busier swarm.']),
  });
  const home = n('agentAttract', 'ffHome', 840, 40, {
    target: 'point', x: 0, y: 0, z: 0, strength: 0.03, reach: 1, swirl: 0, falloff: 'far',
    ...note(['Attract / Repel: a faint pull back toward the middle (added to the currents), so the swarm stays round the camera instead of drifting away.']),
  }, { also: ['ffCurl', 'force'] });
  const integrate = n('agentIntegrate', 'ffMove', 1260, 40, {
    drag: 1.5, maxSpeed: 0.6, mass: 1, edges: 'wrap',
    ...note(['Integrate: high Drag (1.5) makes the fireflies follow the currents lazily, as if the air were thick. Wrap keeps them in the box.']),
  }, { force: ['ffHome', 'force'] });
  const age = n('agentAge', 'ffAge', 1260, 420, { span: 1, ...note(['Age / Life: each firefly glows for its life and fades out; Fade with age (Draw agents) uses it, and Emit brings it back.']) });
  const output = n('agentOutput', 'ffOut', 1680, 100, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Integrate, Alive from Age / Life.']),
  }, { position: ['ffMove', 'position'], velocity: ['ffMove', 'velocity'], alive: ['ffAge', 'alive'] });
  const emit = n('agentEmit', 'ffEmit', X(0), Y(0), {
    mode: 'rate', rate: 700, shape: 'screen', heading: 'random', x: 0, y: 0, z: 0, size: 1, life: 6, lifeVar: 0.6, speed: 0.05, speedVar: 0.5, spread: 1,
    ...note(['Emit, Rate: 700 fireflies light up a second anywhere in the box, each glowing for about 6 s (± 60 %), so about four thousand glow at once: few enough that each out-of-focus one reads as its own disc.', 'Try: Rate 3000 for a dense, misty swarm.']),
  });
  const group = agentsGroup('fireflies', X(420), Y(0), 'ffEmit', [inputs, curl, home, integrate, age, output], {
    label: 'Fireflies', space: '3d', tier: '64k', preroll: 4,
    ...note([
      'Agents with Space 3D: room for 65,536 fireflies (64k; Emit\'s Rate decides how many glow), 2 steps a frame. Inside: Curl noise → Attract → Integrate, and Age / Life.',
    ]),
  });
  const back = backdrop('ff', X(420), Y(420), 'Night wood', [0.006, 0.012, 0.01], [0.002, 0.004, 0.012], [0.006, 0.014, 0.01], ['Result: a black-green forest floor at the bottom to night blue at the top.']);
  const draw = n('drawAgents', 'ffDraw', X(840), Y(0), {
    style: 'glow', colorBy: 'age', palette: 'gold', scaleBy: 'walker', size: 3, brightness: 4, glow: 1.2, fade: 'on', lights: '0',
    camDist: 1.6, camAngle: 0, camElevation: 6, rotSpeed: 0, fov: 1.8, ortho: 0, camX: 0, camY: 0, camZ: 0, drift: 0.12, focus: 0.75, blur: 2, maxBlur: 24,
    ...note([
      'Draw agents in 3D with depth of field: the camera stands among the fireflies (Distance 1.6), sharp at three quarters of the way to the middle (Focus 0.75), with a strong Blur (2): out-of-focus fireflies spread into big soft discs that keep their light (bokeh), up to Max blur 24 pixels, beyond which they are thinned at random so it costs no fill rate.',
      'Drift 0.12: the camera slowly circles, bobs and breathes on its own. Colour by Age on the Gold palette: pale when a firefly lights up, deep amber as it fades.',
      'Try: Blur 0 to see them all sharp; Focus 1.3 to focus behind the swarm.',
    ]),
  }, { agents: ['fireflies', 'agents'], over: ['ffBack', 'result'] });
  const nodes = [emit, group, ...back, draw];
  if (withOutput) nodes.push(n('output', 'ffOutput', X(1260), Y(0), { ...note(['Output: the fireflies, out of focus near and far, over the night wood are the picture.']) }, { color: ['ffDraw', 'color'] }));
  return nodes;
}

export const AGENT_3D_EXAMPLE_KEYS = Object.keys(AGENT_3D_EXAMPLE_INDEX);

export function buildAgent3dExamples(): Record<string, ExampleGraph> {
  return {
    agent3dSlime: { ...AGENT_3D_EXAMPLE_INDEX.agent3dSlime, counter: 40, nodes: slime3dNodes(0, 200) },
    agent3dFlock: { ...AGENT_3D_EXAMPLE_INDEX.agent3dFlock, counter: 40, nodes: flock3dNodes(0, 200) },
    agent3dTorus: { ...AGENT_3D_EXAMPLE_INDEX.agent3dTorus, counter: 40, nodes: torus3dNodes(0, 1000) },
    agent3dGalaxy: { ...AGENT_3D_EXAMPLE_INDEX.agent3dGalaxy, counter: 40, nodes: galaxy3dNodes(0, 200) },
    agent3dFireflies: { ...AGENT_3D_EXAMPLE_INDEX.agent3dFireflies, counter: 40, nodes: fireflies3dNodes(0, 200) },
  };
}
