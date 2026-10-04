/**
 * agentShaderExamples.ts — "Agents with shaders": how the Agents group plugs into
 * ordinary Shader Studio nodes and your own shaders (docs/agents-group.md,
 * "Using Agents with your shaders"). Each example teaches one pattern:
 *
 *  - a chain read at the walker (Sense's Field ƒ, Flow's Field ƒ, Move's Obstacle ƒ),
 *  - a chain painted into the trail (Trail field Add / Block),
 *  - a picture as a birthplace and a colour (Emit Picture, Sample (texture) inside),
 *  - the trail as a texture in a normal shader (Blur / Edges (texture)),
 *  - a Pass's edges as something to smell.
 *
 * Every node, inside the group too, carries a plain-language note, and every
 * Expression Block explains each named line ("name: …"), which examples.test.ts checks.
 * All of them run 256k walkers.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { ExampleGraph } from './exampleIndex';
import { n } from './graphBuilder';
import { agentsGroup, expr, groupInput, note, withOutputs } from './agentExampleKit';

type PortType = GraphNode['inputs'][string]['type'];

/** Agent Inputs with ports added to the group (a Trail texture, a field, a picture). */
function inputsWith(id: string, ports: Array<{ key: string; type: PortType; label: string }>, lines: string[]): GraphNode {
  return withOutputs(n('agentInputs', id, 0, 160, {
    _groupOriginal: true,
    extraInputs: ports,
    ...note(lines),
  }), Object.fromEntries(ports.map(p => [p.key, { type: p.type, label: p.label }])));
}

const TRAIL_PORT = { key: 'trail', type: 'texture' as const, label: 'Trail' };

export const AGENT_SHADER_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  agentShaderRings: {
    label: 'Slime on SDF rings',
    description: 'Concentric rings made from a Circle SDF and a repeat, used as food: the rings are painted into the trail every step (Trail field Add), so the slime settles on them, runs round them and keeps throwing bridges between them. Swap the rings for any SDF chain.',
  },
  agentShaderWalls: {
    label: 'Shapes as walls',
    description: 'Shape SDFs as walls: a heart, a star and a circle, joined with min(), go into Move\'s Obstacle ƒ (walkers slide round them), the Trail\'s Block (no smell inside) and a second Sense whose Gradient bends a slow wind round them. The slime mesh streams round the shapes and leaves a wake behind each.',
  },
  agentShaderNoiseFlow: {
    label: 'Ink along a noise field',
    description: 'A Fractal Noise (FBM) chain as a flow field: Flow in Around mode pushes each particle along the noise\'s contour lines (its curl), so a quarter of a million particles draw ink strands that follow the noise and slowly drift as it evolves.',
  },
  agentShaderPolar: {
    label: 'Spirals from polar UV',
    description: 'A UV chain steering walkers: Polar Space\'s angle and radius make a turning spiral field, read by Sense\'s Field ƒ next to the trail. The slime grows into spiral arms that wind round the middle, coloured by angle.',
  },
  agentShaderEmitter: {
    label: 'Born from your shader',
    description: 'Your own shader as the emitter: a colourful pattern is drawn into a Pass, Emit Picture gives birth on its bright parts, and inside the group Sample (texture) gives each particle the colour of the place it was born (remembered in Memory). Sparks lift off the pattern, drawn over a dimmed copy of it.',
  },
  agentShaderFeedback: {
    label: 'Trails reshape a shader',
    description: 'The trail used by a normal shader: its Edges (texture) bend the shader\'s UV like glass, and its Blur (texture) is a mask that reveals a hot second picture wherever the slime has been. The slime grows out of the middle and the picture changes with it.',
  },
  agentShaderOutlines: {
    label: 'Slime traces outlines',
    description: 'A picture → Pass → Edges (texture) → a second Pass: the outlines become a texture the walkers smell (a second Sense chained through Also) and are born on (Emit Picture). The slime draws the picture\'s outlines in its own colours. Load your own picture into the Texture Input.',
  },
  agentShaderSoundRings: {
    label: 'Rings that pulse to sound',
    description: 'One SDF chain that both draws and pulls: rings ride outward from the middle, thicker and brighter on every beat, and Flow pulls particles down onto them, harder on the beat. A silent stand-in beat (120 a minute) drives it; load a track into Audio Input and set Bpm to 0 on Loudness.',
  },
};

export const AGENT_SHADER_EXAMPLE_KEYS = Object.keys(AGENT_SHADER_EXAMPLE_INDEX);

// ── 1. SDF rings as food ─────────────────────────────────────────────────────

/**
 * Concentric rings from a Circle SDF and a repeat (an Expression Block), as food:
 * painted into the trail's second channel every step (Trail field Add). The slime
 * settles on them, runs round them and bridges them.
 */
export function shaderRingsNodes(x = 0, y = 0): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('srIn', [TRAIL_PORT], [
    'Agent Inputs: this walker as the step begins. Trail is an input added to the group: the Trail field from outside, one step ago. It holds the slime\'s own marks (channel 1) and the rings\' food (channel 2).',
  ]);
  const both = expr('srBoth', 0, 520, {
    label: 'Smell both',
    inputs: [],
    lines: [],
    result: 'vec4(1.0, 1.0, 0.0, 0.0)',
    outputType: 'vec4',
    note: ['Smell both (an Expression Block): Sense\'s Channels. The slime\'s own trail (channel 1) and the rings\' food (channel 2) count the same, so walkers follow each other and the rings.'],
  });
  const sense = n('agentSense', 'srSense', 420, 100, {
    angle: 30, distance: 0.03, weight: 1, width: '1',
    ...note([
      'Sense: sniffs the trail 0.03 ahead, 30° to the left, straight on and 30° to the right, in both channels (Smell both).',
      'Why the rings work: they are food in the trail, so a walker that strays off a ring smells it to one side and turns back.',
    ]),
  }, { texture: ['srIn', 'trail'], channels: ['srBoth', 'result'] });
  const crowd = expr('srCrowd', 840, 100, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3' }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    values: { sat: 20 },
    lines: [],
    result: 'r * exp(-r / sat)',
    outputType: 'vec3',
    wires: { r: ['srSense', 'readings'] },
    note: [
      'Crowding (an Expression Block): a reading\'s pull rises up to Sat (20) and falls past it, r · e^(−r / sat). A ring that is already full stops pulling, so the extra walkers wander off and build bridges to the next ring.',
      'Try: Sat 8 for a finer web between the rings.',
    ],
  });
  const steer = n('agentSteer', 'srSteer', 1260, 100, {
    mode: 'jones', turn: 35, jitter: 0.2,
    ...note(['Steer (Jones rule): 35° toward the better smell, with some Jitter (0.2) so the bridges keep moving.']),
  }, { readings: ['srCrowd', 'result'] });
  const move = n('agentMove', 'srMove', 1680, 100, {
    speed: 0.2, edges: 'wrap',
    ...note(['Move: one step at 0.2 picture units a second; Wrap at the edges.']),
  }, { heading: ['srSteer', 'heading'] });
  const output = n('agentOutput', 'srOut', 2100, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position, Heading and Velocity from Move.']),
  }, { position: ['srMove', 'position'], heading: ['srMove', 'heading'], velocity: ['srMove', 'velocity'] });

  // ── Outside: the rings, an ordinary SDF chain ──
  const uv = n('uv', 'srUv', X(0), Y(420), { ...note(['UV: where each pixel is. Wherever this chain is read (a trail pixel for Add, a birthplace for Emit, a pixel for the picture) UV is that place.']) });
  const centre = n('circleSDF', 'srCentre', X(420), Y(420), {
    radius: 0.02, posX: 0, posY: 0,
    ...note([
      'Circle SDF: the distance from a tiny circle in the middle: in effect, how far each point is from the centre.',
      'Why a circle: repeat a circle\'s distance and you get rings. Try: move its Center for off-centre rings, or swap it for any SDF (a Box SDF gives nested squares).',
    ]),
  }, { position: ['srUv', 'uv'] });
  const rings = expr('srRings', X(840), Y(420), {
    label: 'Repeat into rings',
    inputs: [{ name: 'd', type: 'float' }, { name: 'spacing', type: 'float', slider: { min: 0.05, max: 0.5 } }, { name: 'width', type: 'float', slider: { min: 0.002, max: 0.08 } }],
    values: { spacing: 0.22, width: 0.03 },
    lines: [
      ['float local', 'mod(d + spacing * 0.5, spacing) - spacing * 0.5'],
      ['float index', 'floor((d + spacing * 0.5) / spacing)'],
    ],
    result: 'abs(local) - width',
    outputType: 'float',
    exposed: [{ name: 'index', type: 'float' }],
    wires: { d: ['srCentre', 'distance'] },
    note: [
      'Repeat into rings (an Expression Block): turns one distance into concentric rings, the classic SDF repeat.',
      'local: the distance folded into one Spacing (0.22), so every ring sees the same −spacing/2…spacing/2. index: which ring this is (0 in the middle, counting out), for the colours.',
      'Result: a ring SDF: below 0 within Width (0.03) of a ring, rising away from it. It is an ordinary signed distance, so it can go anywhere a shape can.',
      'Try: Spacing 0.35 for fewer rings further apart; Width 0.01 for thin rings the slime traces exactly.',
    ],
  });
  const food = expr('srFood', X(1260), Y(420), {
    label: 'Rings to food',
    inputs: [{ name: 'ring', type: 'float' }, { name: 'rate', type: 'float', slider: { min: 0, max: 200 } }],
    values: { rate: 20 },
    lines: [['float on', '1.0 - smoothstep(0.0, 0.012, ring)']],
    result: 'vec4(0.0, on * rate, 0.0, 0.0)',
    outputType: 'vec4',
    exposed: [{ name: 'on', type: 'float' }],
    wires: { ring: ['srRings', 'result'] },
    note: [
      'Rings to food (an Expression Block): the bridge from a shape to the simulation.',
      'on: 1 on a ring, fading to 0 just outside it (a soft inside of the SDF). It is also drawn, faintly, in the picture.',
      'Result: on × Rate (20 a second) in the trail\'s second channel, for the Trail\'s Add. The slime smells channel 2 (Smell both) but the picture shows only channel 1, so you see the veins, not the food.',
      'Try: Rate 5 and the slime mostly ignores the rings; 60 and it clings to them, one vein per ring.',
    ],
  });
  const emit = n('agentEmit', 'srEmit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random',
    ...note([
      'Emit: every walker is born at once anywhere on the picture, facing any way; the rings\' food gathers them.',
      'Try: Shape Field with Rings to food\'s on wired into Where ƒ (Threshold 0.5): every walker is born on a ring, and the rings are traced at once.',
    ]),
  });
  let group = agentsGroup('srSlime', X(420), Y(0), 'srEmit', [inputs, both, sense, crowd, steer, move, output], {
    label: 'Slime on rings', tier: '256k', preroll: 4,
    ...note([
      'Agents: 262,144 walkers (256k), the slime rule inside (Sense → Crowding → Steer → Move), 2 steps a frame.',
      'Pre-roll 4: four seconds simulated before the first frame, so the rings are already alive.',
      'Try: Count 1M for thicker rings; Start over to watch them being found.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['srTrail', 'texture']);
  const deposit = n('agentDeposit', 'srDeposit', X(840), Y(0), {
    amount: 1, size: 1,
    ...note(['Deposit: every walker leaves 1 unit of trail a step in channel 1, on top of the food the rings paint into channel 2.']),
  }, { agents: ['srSlime', 'agents'] });
  const trail = n('trailField', 'srTrail', X(1260), Y(0), {
    resolution: '512', diffuse: 1, halfLife: 0.06, edges: 'wrap', gain: 0.05,
    ...note([
      'Trail field: 512 rows (coarse enough for 256k walkers to make thick veins); spreads (3×3) and fades (half-life 0.06 s) every step.',
      'Add: wired from Rings to food. Any chain of nodes can go here: it is read at each trail pixel, every step, so the rings are always fresh food. That is the whole trick: an SDF becomes something to eat.',
    ]),
  }, { deposit: ['srDeposit', 'deposit'], add: ['srFood', 'result'] });
  const look = expr('srLook', X(1680), Y(0), {
    label: 'Veins by ring',
    inputs: [{ name: 'a', type: 'float' }, { name: 'index', type: 'float' }, { name: 'on', type: 'float' }],
    lines: [
      ['vec3 hue', '0.55 + 0.45 * cos(6.2831853 * (index * 0.085 + vec3(0.0, 0.33, 0.67)))'],
      ['vec3 veins', 'hue * a * 1.5'],
      ['vec3 guide', 'vec3(0.6, 0.7, 1.0) * on * 0.05'],
    ],
    result: 'veins + guide + vec3(0.008, 0.006, 0.018)',
    outputType: 'vec3',
    wires: { a: ['srTrail', 'amount'], index: ['srRings', 'index'], on: ['srFood', 'on'] },
    note: [
      'Veins by ring (an Expression Block): the picture.',
      'hue: a colour for each ring (index), walking round the colour wheel from the middle out. veins: the trail\'s Amount in that colour.',
      'guide: the rings themselves, very faint, so you can see where the food is.',
      'Result: the veins and the faint rings over near-black.',
    ],
  });
  const output2 = n('output', 'srOutput', X(2100), Y(0), { ...note(['Output: the veins, coloured ring by ring, are the picture.']) }, { color: ['srLook', 'result'] });
  return [emit, uv, centre, rings, food, group, deposit, trail, look, output2];
}

// ── 2. SDF walls ─────────────────────────────────────────────────────────────

/**
 * Shape SDFs as walls: Move's Obstacle ƒ keeps walkers out (they slide round),
 * the Trail's Block wipes the smell inside, and a slow wind, bent round them by a
 * second Sense's Gradient, streams the mesh past them with a wake behind each.
 */
export function shaderWallsNodes(x = 0, y = 0): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('swIn', [TRAIL_PORT, { key: 'walls', type: 'float', label: 'Walls' }], [
    'Agent Inputs: this walker as the step begins.',
    'Trail and Walls are inputs added to the group: the Trail field (one step ago) and the shapes\' distance from outside. Walls is a chain, not a number: wherever it is wired inside, it is read at the walker\'s own position.',
  ]);
  const sense = n('agentSense', 'swSense', 420, 100, {
    angle: 25, distance: 0.045, weight: 1, width: '1',
    ...note(['Sense: looks well ahead (0.045) at a narrow angle (25°), so the veins come out long and smooth.']),
  }, { texture: ['swIn', 'trail'] });
  const crowd = expr('swCrowd', 840, 100, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3' }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    values: { sat: 8 },
    lines: [],
    result: 'r * exp(-r / sat)',
    outputType: 'vec3',
    wires: { r: ['swSense', 'readings'] },
    note: [
      'Crowding (an Expression Block): a vein\'s pull rises up to Sat (8) and falls past it, r · e^(−r / sat), so the network stays a fine mesh that fills every gap between the shapes instead of merging into a few ropes.',
    ],
  });
  const steer = n('agentSteer', 'swSteer', 1260, 100, {
    mode: 'jones', turn: 14, jitter: 0.06,
    ...note(['Steer (Jones rule): small turns (14°) and little jitter, so the veins bend gently round the shapes instead of kinking.']),
  }, { readings: ['swCrowd', 'result'] });
  const feel = n('agentSense', 'swFeel', 420, 520, {
    angle: 30, distance: 0.02, weight: 1, width: '1',
    ...note([
      'Sense (the walls): a second Sense with only Field ƒ wired, from the Walls input. Its Here output is how far the walker is from the nearest wall; its Gradient, which way is away from the wall. Both go to Drift.',
      'Why: a Sense can read any chain, not just a trail, and its Gradient is the shape\'s slope at the walker, worked out for you.',
    ]),
  }, { field: ['swIn', 'walls'] });
  const drift = expr('swDrift', 1260, 520, {
    label: 'Drift round the walls',
    inputs: [{ name: 'away', type: 'vec2' }, { name: 'd', type: 'float' }, { name: 'wind', type: 'float', slider: { min: -0.5, max: 0.5 } }],
    values: { wind: 0.05 },
    lines: [
      ['vec2 w', 'vec2(wind, 0.0)'],
      ['vec2 outward', 'length(away) > 1e-6 ? normalize(away) : vec2(0.0)'],
      ['vec2 along', 'vec2(-outward.y, outward.x) * sign(dot(vec2(-outward.y, outward.x), w) + 1e-4)'],
      ['float near', 'exp(-max(d, 0.0) * 12.0)'],
    ],
    result: 'mix(w, along * abs(wind), near)',
    outputType: 'vec2',
    wires: { away: ['swFeel', 'gradient'], d: ['swFeel', 'here'] },
    note: [
      'Drift round the walls (an Expression Block): a gentle wind to the right (Wind 0.05 picture units a second) that bends round the shapes, added to every step through Move\'s Also velocity.',
      'w: the wind. outward: the way out of the nearest wall (Sense\'s Gradient). along: the wall\'s own direction, the one that goes with the wind.',
      'near: 1 at a wall, fading out within about 0.1 of it.',
      'Result: the wind far from the shapes, turning to run along their edges close to them, so the mesh streams round a shape and leaves a wake behind it instead of piling up against its front.',
      'Try: Wind 0 for a still network hugging the shapes; −0.05 to blow it left; 0.15 and the slime is swept out of the shapes\' row altogether.',
    ],
  });
  const move = n('agentMove', 'swMove', 1680, 100, {
    speed: 0.16, edges: 'wrap', onObstacle: 'slide',
    ...note([
      'Move: one step along the heading plus the Drift. Obstacle ƒ is the Walls chain from outside: a step that would land where it is below 0 (inside a shape) is not taken.',
      'On obstacle Slide: the walker moves along the shape\'s edge instead, so streams wrap round the shapes. Try Turn back for walkers that bounce off them.',
    ]),
  }, { heading: ['swSteer', 'heading'], also: ['swDrift', 'result'], obstacle: ['swIn', 'walls'] });
  const output = n('agentOutput', 'swOut', 2100, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position, Heading and Velocity from Move.']),
  }, { position: ['swMove', 'position'], heading: ['swMove', 'heading'], velocity: ['swMove', 'velocity'] });

  // ── Outside: three ordinary shape nodes, joined into one distance ──
  const uv = n('uv', 'swUv', X(0), Y(420), { ...note(['UV: where each pixel (or, read inside the group, each walker) is.']) });
  const place = expr('swPlace', X(420), Y(420), {
    label: 'Where the shapes sit',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [
      ['vec2 heartAt', '(uv - vec2(-0.95, -0.5)) / 0.8'],
      ['vec2 starAt', 'uv - vec2(0.05, 0.12)'],
    ],
    result: 'starAt',
    outputType: 'vec2',
    exposed: [{ name: 'heartAt', type: 'vec2' }],
    wires: { uv: ['swUv', 'uv'] },
    note: [
      'Where the shapes sit (an Expression Block): moves the picture\'s coordinates so each Shape SDF lands in its place (Shape SDF draws round 0, 0).',
      'heartAt: the coordinates around the heart, on the left, made 1/0.8 bigger so the heart comes out 0.8 high. starAt: the coordinates around the star, a little right of the middle (the Result).',
      'Try: other offsets to move the shapes; the walkers find the new walls at once.',
    ],
  });
  const heart = n('shapeSDF', 'swHeart', X(840), Y(300), {
    shape: 'heart',
    ...note(['Shape SDF, Heart: the distance to a heart (below 0 inside), read at Where the shapes sit\'s heartAt.']),
  }, { p: ['swPlace', 'heartAt'] });
  const star = n('shapeSDF', 'swStar', X(840), Y(600), {
    shape: 'starN', r: 0.34, n_pts: 5, m_pts: 3,
    ...note(['Shape SDF, Star (N-pt): a five-pointed star 0.34 across its points, in the middle.']),
  }, { p: ['swPlace', 'result'] });
  const circle = n('circleSDF', 'swCircle', X(840), Y(900), {
    radius: 0.26, posX: 0.95, posY: -0.3,
    ...note(['Circle SDF: a round stone on the right (radius 0.26).']),
  }, { position: ['swUv', 'uv'] });
  const walls = expr('swWalls', X(1260), Y(420), {
    label: 'All the walls',
    inputs: [{ name: 'heart', type: 'float' }, { name: 'star', type: 'float' }, { name: 'circle', type: 'float' }],
    lines: [['float heartD', 'heart * 0.8']],
    result: 'min(heartD, min(star, circle))',
    outputType: 'float',
    wires: { heart: ['swHeart', 'distance'], star: ['swStar', 'distance'], circle: ['swCircle', 'distance'] },
    note: [
      'All the walls (an Expression Block): the three shapes as one distance, the union of SDFs (min).',
      'heartD: the heart\'s distance scaled back by 0.8 (its coordinates were stretched), so all three are in picture units.',
      'It goes three places: into the group (Move\'s Obstacle ƒ, read at each walker), into Inside a wall (the Trail\'s Block) and into the picture. One chain, read wherever it is needed.',
    ],
  });
  const block = expr('swBlock', X(1680), Y(420), {
    label: 'Inside a wall',
    inputs: [{ name: 'd', type: 'float' }],
    lines: [],
    result: 'step(d, 0.0)',
    outputType: 'float',
    wires: { d: ['swWalls', 'result'] },
    note: ['Inside a wall (an Expression Block): 1 inside a shape, 0 outside, for the Trail\'s Block, so no smell leaks through a wall and walkers on one side don\'t pull those on the other.'],
  });
  const emit = n('agentEmit', 'swEmit', X(0), Y(0), {
    mode: 'fill', shape: 'field', threshold: 0.02, heading: 'random',
    ...note(['Emit, Shape Field: walkers are born anywhere the walls\' distance is above 0.02, so never inside a shape. Where ƒ takes any chain, like Obstacle ƒ.']),
  }, { where: ['swWalls', 'result'] });
  let group = agentsGroup('swSlime', X(420), Y(0), 'swEmit', [inputs, sense, crowd, steer, feel, drift, move, output], {
    label: 'Slime round shapes', tier: '256k', preroll: 5,
    ...note([
      'Agents: 262,144 walkers (256k), 2 steps a frame: slime drifting slowly right.',
      'Its Walls input is the shapes\' distance from outside. Pre-roll 5: the network has formed round the shapes when the picture appears.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['swTrail', 'texture']);
  group = groupInput(group, 'walls', 'float', 'Walls', ['swWalls', 'result']);
  const deposit = n('agentDeposit', 'swDeposit', X(840), Y(0), {
    amount: 1, size: 1,
    ...note(['Deposit: every walker leaves 1 unit of trail a step.']),
  }, { agents: ['swSlime', 'agents'] });
  const trail = n('trailField', 'swTrail', X(1260), Y(0), {
    resolution: '512', diffuse: 0.6, halfLife: 0.08, edges: 'wrap', gain: 0.04,
    ...note([
      'Trail field: 512 rows; spreads a little (Diffuse 0.6) and fades fast (half-life 0.08 s), so the veins follow the walkers closely.',
      'Block: wired from Inside a wall: the trail is wiped inside the shapes every step.',
    ]),
  }, { deposit: ['swDeposit', 'deposit'], block: ['swBlock', 'result'] });
  const look = expr('swLook', X(1680), Y(0), {
    label: 'Night and stones',
    inputs: [{ name: 'a', type: 'float' }, { name: 'd', type: 'float' }, { name: 'uv', type: 'vec2' }],
    lines: [
      ['vec3 night', 'mix(vec3(0.01, 0.015, 0.035), vec3(0.03, 0.02, 0.06), uv.y * 0.5 + 0.5)'],
      ['vec3 haze', 'vec3(0.1, 0.35, 0.6) * a * 0.35'],
      ['float inside', '1.0 - smoothstep(0.0, 0.004, d)'],
      ['float rim', 'exp(-abs(d) * 70.0)'],
      ['vec3 stone', 'vec3(0.9, 0.32, 0.38) * (0.25 + 0.5 * smoothstep(-0.25, 0.0, d))'],
    ],
    result: 'mix(night + haze, stone, inside) + vec3(1.0, 0.55, 0.5) * rim * 0.6',
    outputType: 'vec3',
    wires: { a: ['swTrail', 'amount'], d: ['swWalls', 'result'], uv: ['swUv', 'uv'] },
    note: [
      'Night and stones (an Expression Block): the picture under the walkers, drawn from the same distance the walkers obey.',
      'night: a dark blue sky, a little lighter at the top. haze: the trail\'s Amount as a faint blue glow along the veins.',
      'inside: 1 inside a shape. rim: a thin glow along every shape\'s edge (e^(−70·|d|)). stone: the shapes\' coral fill, darker toward their middles (the distance inside is negative).',
      'Result: the night and haze, the shapes on top, and their glowing rims.',
    ],
  });
  const draw = n('drawAgents', 'swDraw', X(2100), Y(0), {
    style: 'streaks', colorBy: 'speed', palette: 'ice', speedRef: 0.35, scaleBy: 'crowd', size: 1, brightness: 0.8, glow: 0.4, streak: 0.5, fade: 'off', lights: '0',
    ...note([
      'Draw agents, Streaks: every walker as a short glowing line along its motion, so the veins sparkle as the walkers run along them. Coloured by speed on the Ice palette: pale where they race past, deep blue where they slow against a shape.',
      'Try: Style Points to see the walkers themselves; Brightness 0 to see only the trail\'s haze.',
    ]),
  }, { agents: ['swSlime', 'agents'], over: ['swLook', 'result'] });
  const output2 = n('output', 'swOutput', X(2520), Y(0), { ...note(['Output: the slime streaming round the shapes is the picture.']) }, { color: ['swDraw', 'color'] });
  return [emit, uv, place, heart, star, circle, walls, block, group, deposit, trail, look, draw, output2];
}

// ── 3. FBM noise as a flow field ─────────────────────────────────────────────

/**
 * A Fractal Noise (FBM) chain as a flow field: Flow, Around mode, pushes each
 * particle along the noise's contours (its curl), drawn as ink streaks on paper.
 */
export function shaderNoiseFlowNodes(x = 0, y = 0): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('nfIn', [{ key: 'noise', type: 'float', label: 'Noise' }], [
    'Agent Inputs: this particle as the step begins. Noise is an input added to the group: the FBM chain from outside, read wherever a node inside asks for it (here, around the particle, by Flow).',
  ]);
  const flow = n('agentFlow', 'nfFlow', 420, 40, {
    mode: 'around', strength: 2.2, step: 0.01,
    ...note([
      'Flow, Around: pushes the particle along the noise\'s contour lines, at right angles to its slope (the curl of the noise). Flow reads the chain a little either side of the particle (Detail 0.01) to find the slope.',
      'Why Around: contour lines never cross or end, so the particles stream in long, parallel strands round the noise\'s hills and hollows, like ink in marbling.',
      'Try: Mode Slope with Strength −2 and they pile into the noise\'s valleys instead; Detail 0.05 smooths out the fine wiggles.',
    ]),
  }, { field: ['nfIn', 'noise'] });
  const integrate = n('agentIntegrate', 'nfMove', 840, 80, {
    drag: 3, maxSpeed: 2, mass: 1, edges: 'wrap',
    ...note([
      'Integrate: the force becomes motion. Drag 3 is high, so a particle\'s velocity is almost the flow itself: it follows the lines instead of overshooting them.',
      'Edges Wrap: a particle leaving one side comes back on the other.',
    ]),
  }, { force: ['nfFlow', 'force'] });
  const age = n('agentAge', 'nfAge', 840, 560, {
    span: 1,
    ...note(['Age / Life: each particle lives about 6 s, then Emit gives it a new place: fresh strands keep starting everywhere.']),
  });
  const output = n('agentOutput', 'nfOut', 1260, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Integrate, Alive from Age / Life. Heading follows the velocity, for the streaks.']),
  }, { position: ['nfMove', 'position'], velocity: ['nfMove', 'velocity'], alive: ['nfAge', 'alive'] });

  // ── Outside: an ordinary noise chain ──
  const uv = n('uv', 'nfUv', X(0), Y(420), { ...note(['UV: where each pixel (or, read inside the group, each particle) is.']) });
  const time = n('time', 'nfTime', X(0), Y(700), { ...note(['Time: makes the noise drift. Inside the group it is the simulation\'s own clock, so the field moves the same in the preview and in a recording.']) });
  const noise = n('fbm', 'nfNoise', X(420), Y(420), {
    octaves: 4, lacunarity: 2, gain: 0.5, scale: 1.3, time_scale: 0.08,
    ...note([
      'Fractal Noise (FBM): four layers of noise, Frequency 1.3, drifting slowly (Speed 0.08). This is the field the particles follow.',
      'It goes into the group\'s Noise (Flow reads it at each particle) and into Paper (the picture reads it at each pixel): one chain, two readers.',
      'Try: Octaves 6 for finer, frizzier strands; Frequency 3 for small whorls; any other float chain (a Voronoi, a shape\'s distance, your own Expression Block) in its place.',
    ]),
  }, { uv: ['nfUv', 'uv'], time: ['nfTime', 'time'] });
  const emit = n('agentEmit', 'nfEmit', X(0), Y(0), {
    mode: 'respawn', shape: 'screen', heading: 'random', life: 6, lifeVar: 0.5, speed: 0,
    ...note(['Emit: particles are born anywhere on the picture (Whole picture), still, each living 6 s ± half; Keep full gives each a new place when it dies.']),
  });
  let group = agentsGroup('nfInk', X(420), Y(0), 'nfEmit', [inputs, flow, integrate, age, output], {
    label: 'Ink along noise', tier: '256k', preroll: 4,
    ...note([
      'Agents: 262,144 particles (256k), 2 steps a frame. Inside: Flow (Around the Noise) → Integrate, and Age / Life.',
      'Its Noise input is wired from the FBM chain outside. Pre-roll 4: the strands are drawn when the picture appears.',
    ]),
  });
  group = groupInput(group, 'noise', 'float', 'Noise', ['nfNoise', 'value']);
  const paper = expr('nfPaper', X(840), Y(420), {
    label: 'Paper',
    inputs: [{ name: 'v', type: 'float' }, { name: 'uv', type: 'vec2' }],
    lines: [
      ['vec3 cream', 'vec3(0.95, 0.92, 0.85)'],
      ['vec3 wash', 'mix(vec3(0.62, 0.78, 0.92), vec3(0.98, 0.72, 0.62), smoothstep(0.3, 0.7, v))'],
      ['float edge', '1.0 - 0.18 * dot(uv * vec2(0.45, 0.8), uv * vec2(0.45, 0.8))'],
    ],
    result: 'mix(cream, wash, 0.28) * edge',
    outputType: 'vec3',
    wires: { v: ['nfNoise', 'value'], uv: ['nfUv', 'uv'] },
    note: [
      'Paper (an Expression Block): the paper the ink lands on, faintly washed with the same noise the particles follow.',
      'cream: the paper. wash: a watercolour tint, blue in the noise\'s low parts and rose in its high parts. edge: a soft darkening toward the corners.',
      'Result: the paper with 28% of the wash. Try: 0 for plain paper.',
    ],
  });
  const draw = n('drawAgents', 'nfDraw', X(1260), Y(0), {
    style: 'ink', colorBy: 'heading', palette: 'ab', colorA: [0.05, 0.12, 0.35], colorB: [0.4, 0.06, 0.18],
    scaleBy: 'crowd', size: 0.6, brightness: 2.2, glow: 0.3, streak: 0.6, fade: 'on', lights: '0',
    ...note([
      'Draw agents, Ink: each particle lays a short streak of ink (Streak 0.6) along its motion over the Paper, darker where many overlap.',
      'Colour by Heading between Colour A (indigo) and B (madder red): strands going one way are blue, the other way red, so the noise\'s eddies show as two-tone swirls.',
      'Try: Colour by One colour for plain indigo ink; Style Glow on a dark Over for light trails.',
    ]),
  }, { agents: ['nfInk', 'agents'], over: ['nfPaper', 'result'] });
  const output2 = n('output', 'nfOutput', X(1680), Y(0), { ...note(['Output: the ink strands on the washed paper are the picture.']) }, { color: ['nfDraw', 'color'] });
  return [emit, uv, time, noise, group, paper, draw, output2];
}

// ── 4. A UV field: polar spirals ─────────────────────────────────────────────

/**
 * Polar Space's angle and radius make a turning spiral field; Sense's Field ƒ
 * adds it to the trail's reading, so the slime grows into spiral arms.
 */
export function shaderPolarNodes(x = 0, y = 0): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('plIn', [TRAIL_PORT, { key: 'spiral', type: 'float', label: 'Spiral' }], [
    'Agent Inputs: this walker as the step begins. Trail and Spiral are inputs added to the group: the Trail field (one step ago) and the spiral chain from outside, read at the walker.',
  ]);
  const sense = n('agentSense', 'plSense', 420, 100, {
    angle: 30, distance: 0.03, weight: 1, width: '1',
    ...note([
      'Sense: reads two things at its three sensors and adds them: the trail (Texture) and the spiral (Field ƒ, the chain from outside, read at each sensor\'s own position).',
      'Why both: the trail alone makes a network anywhere; the field tilts every choice toward the spiral\'s ridges, so the network grows along them.',
      'Try: unwire Field ƒ and the spiral is gone; raise Pull on Spiral field for walkers that ignore each other.',
    ]),
  }, { texture: ['plIn', 'trail'], field: ['plIn', 'spiral'] });
  const crowd = expr('plCrowd', 840, 100, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3' }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    values: { sat: 12 },
    lines: [],
    result: 'r * exp(-r / sat)',
    outputType: 'vec3',
    wires: { r: ['plSense', 'readings'] },
    note: ['Crowding (an Expression Block): a reading\'s pull rises up to Sat (12) and falls past it, r · e^(−r / sat), so the walkers spread across an arm as a woven mesh instead of one thin rope along its crest.'],
  });
  const steer = n('agentSteer', 'plSteer', 1260, 100, {
    mode: 'jones', turn: 30, jitter: 0.1,
    ...note(['Steer (Jones rule): 30° toward the better reading.']),
  }, { readings: ['plCrowd', 'result'] });
  const move = n('agentMove', 'plMove', 1680, 100, {
    speed: 0.2, edges: 'wrap',
    ...note(['Move: one step at 0.2 picture units a second; Wrap at the edges.']),
  }, { heading: ['plSteer', 'heading'] });
  const output = n('agentOutput', 'plOut', 2100, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position, Heading and Velocity from Move.']),
  }, { position: ['plMove', 'position'], heading: ['plMove', 'heading'], velocity: ['plMove', 'velocity'] });

  // ── Outside: UV → Polar Space → a spiral ──
  const uv = n('uv', 'plUv', X(0), Y(420), { ...note(['UV: where each pixel (or, read inside the group, each sensor) is, centred on the middle of the picture.']) });
  const polar = n('polarSpace', 'plPolar', X(420), Y(420), {
    twist: 0, radialScale: 1,
    ...note(['Polar Space: turns UV into an Angle (0–1 once round) and a Radius (the distance from the middle). Any UV node works the same way: it is just a chain that the walkers read at their own position.']),
  }, { input: ['plUv', 'uv'] });
  const time = n('time', 'plTime', X(420), Y(760), { ...note(['Time: turns the spiral slowly (the simulation\'s own clock inside the group).']) });
  const spiral = expr('plSpiral', X(840), Y(420), {
    label: 'Spiral field',
    inputs: [
      { name: 'angle', type: 'float' }, { name: 'radius', type: 'float' }, { name: 't', type: 'float' },
      { name: 'arms', type: 'float', slider: { min: 1, max: 12 } }, { name: 'wind', type: 'float', slider: { min: -10, max: 10 } },
      { name: 'spin', type: 'float', slider: { min: -1, max: 1 } }, { name: 'pull', type: 'float', slider: { min: 0, max: 40 } },
    ],
    values: { arms: 5, wind: 4, spin: 0.05, pull: 12 },
    lines: [
      ['float phase', 'angle * 6.2831853 * floor(arms) + log(radius + 0.03) * wind - t * spin * 6.2831853'],
      ['float ridge', 'cos(phase)'],
    ],
    result: 'ridge * pull',
    outputType: 'float',
    exposed: [{ name: 'ridge', type: 'float' }],
    wires: { angle: ['plPolar', 'angle'], radius: ['plPolar', 'radius'], t: ['plTime', 'time'] },
    note: [
      'Spiral field (an Expression Block): a logarithmic spiral with Arms arms, made from the angle and the radius.',
      'phase: how far round the spiral this point is: the angle times Arms (whole arms, so there is no seam), plus log(radius) times Wind (how tightly the arms wind), turning by Spin turns a second.',
      'ridge: 1 on an arm, −1 between arms.',
      'Result: ridge × Pull (12): how much the spiral counts against the trail in Sense. It is a field: Sense reads it at three points round every walker, every step.',
      'Try: Arms 2 for a galaxy; Wind −4 to wind the other way; Spin 0.2 to see the slime chase the turning arms.',
    ],
  });
  const emit = n('agentEmit', 'plEmit', X(0), Y(0), {
    mode: 'fill', shape: 'screen', heading: 'random',
    ...note(['Emit: every walker is born at once anywhere on the picture, facing any way; the spiral gathers them.']),
  });
  let group = agentsGroup('plSlime', X(420), Y(0), 'plEmit', [inputs, sense, crowd, steer, move, output], {
    label: 'Spiral slime', tier: '256k', preroll: 5,
    ...note([
      'Agents: 262,144 walkers (256k), 2 steps a frame. Its Spiral input is wired from the spiral chain outside.',
      'Pre-roll 5: the arms have formed when the picture appears.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['plTrail', 'texture']);
  group = groupInput(group, 'spiral', 'float', 'Spiral', ['plSpiral', 'result']);
  const deposit = n('agentDeposit', 'plDeposit', X(840), Y(0), {
    amount: 1, size: 1,
    ...note(['Deposit: every walker leaves 1 unit of trail a step.']),
  }, { agents: ['plSlime', 'agents'] });
  const trail = n('trailField', 'plTrail', X(1260), Y(0), {
    resolution: '512', diffuse: 1, halfLife: 0.07, edges: 'wrap', gain: 0.05,
    ...note(['Trail field: 512 rows; spreads (3×3) and fades (half-life 0.07 s) every step. The spiral is not in it: Sense adds the spiral itself.']),
  }, { deposit: ['plDeposit', 'deposit'] });
  const look = expr('plLook', X(1680), Y(0), {
    label: 'Colour wheel',
    inputs: [{ name: 'a', type: 'float' }, { name: 'angle', type: 'float' }, { name: 'radius', type: 'float' }, { name: 'ridge', type: 'float' }],
    lines: [
      ['vec3 hue', '0.55 + 0.45 * cos(6.2831853 * (angle + radius * 0.25 + vec3(0.0, 0.33, 0.67)))'],
      ['float core', 'exp(-radius * radius * 12.0)'],
      ['vec3 arms', 'vec3(0.25, 0.2, 0.45) * max(ridge, 0.0) * 0.06'],
    ],
    result: 'hue * a * 1.6 + vec3(1.0, 0.9, 0.8) * core * a * 0.6 + arms + vec3(0.006, 0.005, 0.014)',
    outputType: 'vec3',
    wires: { a: ['plTrail', 'amount'], angle: ['plPolar', 'angle'], radius: ['plPolar', 'radius'], ridge: ['plSpiral', 'ridge'] },
    note: [
      'Colour wheel (an Expression Block): the veins coloured by where they are round the middle, from the same Polar Space the walkers read.',
      'hue: a colour for each angle (once round the wheel), shifting a little with the radius so each arm changes colour as it winds out. core: a white-hot middle.',
      'arms: the spiral\'s ridges, very faint, so you can see the field the slime is following.',
    ],
  });
  const output2 = n('output', 'plOutput', X(2100), Y(0), { ...note(['Output: the spiral veins on the colour wheel are the picture.']) }, { color: ['plLook', 'result'] });
  return [emit, uv, polar, time, spiral, group, deposit, trail, look, output2];
}

// ── 5. Your shader as the emitter ────────────────────────────────────────────

/**
 * A colourful pattern drawn into a Pass: Emit Picture gives birth on its bright
 * parts and Sample (texture) inside the group colours each particle by its
 * birthplace (kept in Memory). Drawn over a dimmed copy of the pattern.
 */
export function shaderEmitterNodes(x = 0, y = 0): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('emIn', [{ key: 'picture', type: 'texture', label: 'Picture' }], [
    'Agent Inputs: this particle as the step begins. Memory is what it carried from last step (0, 0 when it is born). Picture is an input added to the group: your shader, as the Pass outside drew it.',
  ]);
  const pick = n('sampleTexture', 'emPick', 420, 420, {
    offsetX: 0, offsetY: 0,
    ...note([
      'Sample (texture): your shader\'s colour where the particle is. Its UV is left unwired, and inside the group an unwired UV is the particle\'s own position.',
    ]),
  }, { texture: ['emIn', 'picture'] });
  const keep = expr('emKeep', 840, 420, {
    label: 'Birth colour',
    inputs: [{ name: 'picked', type: 'vec3' }, { name: 'own', type: 'vec3' }, { name: 'mem', type: 'vec2' }],
    lines: [
      ['float coloured', 'step(0.5, mem.x)'],
      ['vec3 vivid', 'picked / max(max(picked.r, max(picked.g, picked.b)), 0.08)'],
      ['vec2 remember', 'vec2(1.0, 0.0)'],
    ],
    result: 'mix(vivid, own, coloured)',
    outputType: 'vec3',
    exposed: [{ name: 'remember', type: 'vec2' }],
    wires: { picked: ['emPick', 'color'], own: ['emIn', 'colour'], mem: ['emIn', 'memory'] },
    note: [
      'Birth colour (an Expression Block): gives each particle the colour of the place it was born, and keeps it.',
      'coloured: 1 once the particle has taken its colour (Memory.x), 0 on its first step after a birth (Memory starts at 0).',
      'vivid: the shader\'s colour there, at full brightness, so a particle born on a dim edge still shines.',
      'remember: 1 into Memory, so next step coloured is 1 and the colour is kept (Agent Output\'s Colour holds it from step to step).',
      'Result: the picked colour on the first step, the particle\'s own colour after. Try: own → vivid alone (Result vivid) and the particles change colour as they cross the pattern.',
    ],
  });
  const curl = n('agentCurl', 'emCurl', 420, 40, {
    strength: 0.15, size: 1.6, evolve: 0.25,
    ...note(['Curl noise: soft swirling currents (Strength 0.15) that carry the sparks off the pattern in wisps.', 'Try: 0.5 to scatter them in a gale; 0 and they rise straight up.']),
  });
  const lift = n('agentGravity', 'emLift', 840, 40, {
    strength: 0.12, angle: 90,
    ...note(['Gravity, pointing up (Angle 90): a gentle lift, so the sparks rise off the pattern like embers. Its Also adds the curl in.']),
  }, { also: ['emCurl', 'force'] });
  const integrate = n('agentIntegrate', 'emMove', 1260, 80, {
    drag: 1.2, maxSpeed: 3, mass: 1, edges: 'free',
    ...note(['Integrate: the force moves the particles; Drag 1.2 keeps them floaty. Edges Free: they may drift off the picture before they die.']),
  }, { force: ['emLift', 'force'] });
  const age = n('agentAge', 'emAge', 1260, 560, {
    span: 1,
    ...note(['Age / Life: each spark lives about 1.6 s, then Emit gives it a new birthplace on the pattern (and Memory starts at 0 again, so it takes a new colour).']),
  });
  const output = n('agentOutput', 'emOut', 1680, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Integrate, Alive from Age / Life, Colour and Memory from Birth colour.']),
  }, { position: ['emMove', 'position'], velocity: ['emMove', 'velocity'], alive: ['emAge', 'alive'], colour: ['emKeep', 'result'], memory: ['emKeep', 'remember'] });

  // ── Outside: your shader, as a Pass ──
  const uv = n('uv', 'emUv', X(0), Y(420), { ...note(['UV: where each pixel is, for your shader.']) });
  const time = n('time', 'emTime', X(0), Y(700), { ...note(['Time: animates your shader.']) });
  const shader = expr('emShader', X(420), Y(420), {
    label: 'Your shader',
    inputs: [{ name: 'uv', type: 'vec2' }, { name: 't', type: 'float' }],
    lines: [
      ['float r', 'length(uv)'],
      ['float a', 'atan(uv.y, uv.x)'],
      ['float wave', 'sin(r * 11.0 - t * 1.6 + sin(a * 5.0 + t * 0.7) * 1.4)'],
      ['float bands', 'smoothstep(0.35, 0.95, wave)'],
      ['vec3 col', '0.55 + 0.45 * cos(6.2831853 * (r * 0.35 + a / 6.2831853 + vec3(0.0, 0.33, 0.67)) + t * 0.4)'],
    ],
    result: 'col * bands * exp(-r * 0.7) * 1.3',
    outputType: 'vec3',
    wires: { uv: ['emUv', 'uv'], t: ['emTime', 'time'] },
    note: [
      'Your shader (an Expression Block): stands in for any shader you have made: a ring of petal-shaped ripples in rainbow colours. Replace it with your own chain; everything after it follows.',
      'r: distance from the middle. a: angle round it. wave: rings moving outward, bent into five petals by a.',
      'bands: only the crests of the waves are bright, so there is dark between them for the particles to fly into. col: a rainbow that turns with the angle and drifts with time.',
      'Result: the coloured crests, fading toward the edges.',
    ],
  });
  const pass = n('pass', 'emPass', X(840), Y(420), {
    scale: '0.5', format: 'half', filter: 'linear', wrap: 'clamp',
    ...note([
      'Pass: draws your shader into a texture of its own (at half size: births and colours don\'t need more).',
      'Why a Pass: Emit Picture and the group need a picture they can read anywhere, not just at the current pixel. Its Texture goes to Emit (where to be born) and into the group (what colour to be).',
    ]),
  }, { color: ['emShader', 'result'] });
  const emit = n('agentEmit', 'emEmit', X(0), Y(0), {
    mode: 'respawn', shape: 'picture', threshold: 0.3, miss: 'skip', heading: 'random', life: 1.6, lifeVar: 0.5, speed: 0.05, speedVar: 0.5,
    ...note([
      'Emit, Shape Picture: particles are born where your shader (the Pass\'s Texture, wired into Picture) is brighter than Threshold 0.3, more where brighter.',
      'Not born this time: a particle that finds no bright place waits for the next step, so they only ever appear on the pattern. Keep full, Life 1.6 s ± half: the pattern keeps shedding sparks, and they die before they stray far from it.',
      'Try: Threshold 0.6 for sparks only from the brightest crests.',
    ]),
  }, { picture: ['emPass', 'texture'] });
  let group = agentsGroup('emSparks', X(420), Y(0), 'emEmit', [inputs, pick, keep, curl, lift, integrate, age, output], {
    label: 'Sparks from your shader', tier: '256k', preroll: 3,
    ...note([
      'Agents: 262,144 particles (256k), 2 steps a frame. Its Picture input is your shader\'s Pass texture.',
      'Inside: Curl noise → Gravity (up) → Integrate moves them; Sample (texture) → Birth colour colours them.',
    ]),
  });
  group = groupInput(group, 'picture', 'texture', 'Picture', ['emPass', 'texture']);
  const dim = expr('emDim', X(840), Y(800), {
    label: 'Dimmed shader',
    inputs: [{ name: 'c', type: 'vec3' }, { name: 'keep', type: 'float', slider: { min: 0, max: 1 } }],
    values: { keep: 0.35 },
    lines: [],
    result: 'c * keep + vec3(0.006, 0.004, 0.012)',
    outputType: 'vec3',
    wires: { c: ['emPass', 'color'] },
    note: ['Dimmed shader (an Expression Block): your shader at Keep (35%) brightness, for the sparks to be drawn over. Keep 1 shows it at full strength; 0 shows only the sparks.'],
  });
  const draw = n('drawAgents', 'emDraw', X(1260), Y(0), {
    style: 'streaks', colorBy: 'agent', palette: 'ab', scaleBy: 'walker', size: 0.75, brightness: 0.3, glow: 0.3, streak: 0.3, fade: 'on', lights: '0',
    ...note([
      'Draw agents, Streaks: every spark a short glowing line along its motion in its own colour (Colour by Agent: Birth colour inside), fading in at birth and out at the end of its life, over the dimmed shader.',
      'Brightness of Each walker (0.3): where many sparks cross, they add up to a blaze; lone ones stay faint.',
      'Try: Style Glow for soft dust; Brightness 1 for a firestorm.',
    ]),
  }, { agents: ['emSparks', 'agents'], over: ['emDim', 'result'] });
  const output2 = n('output', 'emOutput', X(1680), Y(0), { ...note(['Output: the sparks over your shader are the picture.']) }, { color: ['emDraw', 'color'] });
  return [emit, uv, time, shader, pass, group, dim, draw, output2];
}

// ── 6. The trail as a texture in a normal shader ─────────────────────────────

/**
 * Slime, whose trail texture drives an ordinary shader: Edges (texture) bend its
 * UV like glass and Blur (texture) masks in a second, hot version of it.
 */
export function shaderFeedbackNodes(x = 0, y = 0): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('fbIn', [TRAIL_PORT], [
    'Agent Inputs: this walker as the step begins. Trail is an input added to the group: the Trail field from outside, one step ago.',
  ]);
  const sense = n('agentSense', 'fbSense', 420, 100, {
    angle: 22.5, distance: 0.035, weight: 1, width: '1',
    ...note(['Sense: the Slime mold preset\'s: three sensors 0.035 ahead, 22.5° apart.']),
  }, { texture: ['fbIn', 'trail'] });
  const crowd = expr('fbCrowd', 840, 100, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3' }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    values: { sat: 20 },
    lines: [],
    result: 'r * exp(-r / sat)',
    outputType: 'vec3',
    wires: { r: ['fbSense', 'readings'] },
    note: ['Crowding (an Expression Block): a reading\'s pull rises up to Sat (20) and falls past it, r · e^(−r / sat), so the network keeps reorganising.'],
  });
  const steer = n('agentSteer', 'fbSteer', 1260, 100, {
    mode: 'jones', turn: 45, jitter: 0.15,
    ...note(['Steer (Jones rule): 45° toward the stronger side, Jitter 0.15.']),
  }, { readings: ['fbCrowd', 'result'] });
  const move = n('agentMove', 'fbMove', 1680, 100, {
    speed: 0.22, edges: 'wrap',
    ...note(['Move: one step at 0.22 picture units a second; Wrap at the edges.']),
  }, { heading: ['fbSteer', 'heading'] });
  const output = n('agentOutput', 'fbOut', 2100, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position, Heading and Velocity from Move.']),
  }, { position: ['fbMove', 'position'], heading: ['fbMove', 'heading'], velocity: ['fbMove', 'velocity'] });

  const emit = n('agentEmit', 'fbEmit', X(0), Y(0), {
    mode: 'fill', shape: 'disc', heading: 'outward', x: 0, y: 0, size: 0.12,
    ...note(['Emit: every walker starts in a small disc in the middle, facing outward, so the slime spreads out across the picture as you watch.']),
  });
  let group = agentsGroup('fbSlime', X(420), Y(0), 'fbEmit', [inputs, sense, crowd, steer, move, output], {
    label: 'Slime', tier: '256k', preroll: 2,
    ...note([
      'Agents: 262,144 walkers (256k), the Slime mold rule, 2 steps a frame. Pre-roll 2: the first veins are out when the picture appears; they keep spreading for about 10 s.',
      'Try: Start over to watch the picture change as the slime grows.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['fbTrail', 'texture']);
  const deposit = n('agentDeposit', 'fbDeposit', X(840), Y(0), {
    amount: 1, size: 1,
    ...note(['Deposit: every walker leaves 1 unit of trail a step.']),
  }, { agents: ['fbSlime', 'agents'] });
  const trail = n('trailField', 'fbTrail', X(1260), Y(0), {
    resolution: '512', diffuse: 1, halfLife: 0.08, edges: 'wrap', gain: 0.05,
    ...note([
      'Trail field: 512 rows (thick veins from 256k walkers); spreads and fades every step.',
      'Its Texture goes three places: back into the group (Sense), and into Edges (texture) and Blur (texture), which any shader can use, exactly as they use a Pass.',
    ]),
  }, { deposit: ['fbDeposit', 'deposit'] });

  // ── Outside: a normal shader, driven by the trail ──
  const uv = n('uv', 'fbUv', X(1260), Y(420), { ...note(['UV: where each pixel is, for the shader.']) });
  const time = n('time', 'fbTime', X(1260), Y(700), { ...note(['Time: animates the shader\'s stripes.']) });
  const edges = n('edgesTexture', 'fbEdges', X(1680), Y(300), {
    strength: 0.08, width: 3,
    ...note([
      'Edges (texture): reads the trail texture around each pixel and says which way it rises (Direction) and how steeply (Edges). On the trail, that is the sides of every vein.',
      'Strength 0.08: the trail\'s raw numbers are large, so a low gain keeps Edges below 1 except on the thickest veins. Width 3: reads 3 pixels apart, for a soft, glassy bend.',
    ]),
  }, { texture: ['fbTrail', 'texture'] });
  const blur = n('blurTexture', 'fbBlur', X(1680), Y(620), {
    radius: 18, quality: '24',
    ...note(['Blur (texture): the trail blurred by 18 pixels: a soft mask that is high wherever the slime has been, for Reveal.']),
  }, { texture: ['fbTrail', 'texture'] });
  const warp = expr('fbWarp', X(2100), Y(300), {
    label: 'Bend the UV',
    inputs: [{ name: 'uv', type: 'vec2' }, { name: 'dir', type: 'vec2' }, { name: 'e', type: 'float' }, { name: 'amount', type: 'float', slider: { min: 0, max: 0.3 } }],
    values: { amount: 0.15 },
    lines: [],
    result: 'uv - dir * e * amount',
    outputType: 'vec2',
    wires: { uv: ['fbUv', 'uv'], dir: ['fbEdges', 'direction'], e: ['fbEdges', 'edges'] },
    note: [
      'Bend the UV (an Expression Block): pushes each pixel\'s UV down the trail\'s slope by Edges × Amount (0.15), like light through a glass vein. The shader after it reads the bent UV, so its stripes kink round every vein.',
      'Try: Amount 0.2 for a molten look; 0 to see the shader straight.',
    ],
  });
  const shader = expr('fbShader', X(2520), Y(300), {
    label: 'A normal shader',
    inputs: [{ name: 'uv', type: 'vec2' }, { name: 't', type: 'float' }],
    lines: [
      ['float stripes', '0.5 + 0.5 * sin(uv.y * 26.0 + sin(uv.x * 2.0 + t * 0.4) * 2.0 - t * 0.8)'],
      ['vec3 cold', 'mix(vec3(0.02, 0.04, 0.12), vec3(0.1, 0.3, 0.55), stripes * stripes)'],
      ['vec3 hot', 'mix(vec3(0.3, 0.02, 0.22), vec3(1.0, 0.55, 0.12), stripes)'],
    ],
    result: 'cold',
    outputType: 'vec3',
    exposed: [{ name: 'hot', type: 'vec3' }],
    wires: { uv: ['fbWarp', 'result'], t: ['fbTime', 'time'] },
    note: [
      'A normal shader (an Expression Block): stands in for any shader of yours: wavy horizontal stripes that drift up. It knows nothing about the slime; it just reads a UV.',
      'stripes: 0–1 bands, wavering sideways with time. cold: the stripes in deep night blues (the Result). hot: the same stripes in plum and orange (an output), for Reveal.',
    ],
  });
  const reveal = expr('fbReveal', X(2940), Y(300), {
    label: 'Reveal',
    inputs: [{ name: 'cold', type: 'vec3' }, { name: 'hot', type: 'vec3' }, { name: 'm', type: 'vec3' }, { name: 'a', type: 'float' }, { name: 'reveal', type: 'float', slider: { min: 0, max: 1 } }],
    values: { reveal: 0.04 },
    lines: [
      ['float mask', '1.0 - exp(-m.r * reveal)'],
      ['vec3 picture', 'mix(cold, hot, mask)'],
    ],
    result: 'picture + vec3(1.0, 0.9, 0.7) * a * a * 0.2',
    outputType: 'vec3',
    wires: { cold: ['fbShader', 'result'], hot: ['fbShader', 'hot'], m: ['fbBlur', 'color'], a: ['fbTrail', 'amount'] },
    note: [
      'Reveal (an Expression Block): mixes the two versions of the shader through the slime.',
      'mask: the blurred trail (its first channel), softly scaled to 0–1 by Reveal (0.04): 1 where the slime is thick, 0 where it has never been. Try Reveal 0.2 for a wide, molten mask.',
      'picture: the cold stripes, turning hot inside the mask.',
      'Result: the picture with the thickest veins lit a little on top (the trail\'s Amount, squared so only the cores show).',
    ],
  });
  const output2 = n('output', 'fbOutput', X(3360), Y(0), { ...note(['Output: the shader, bent and lit by the slime, is the picture.']) }, { color: ['fbReveal', 'result'] });
  return [emit, group, deposit, trail, uv, time, edges, blur, warp, shader, reveal, output2];
}

// ── 7. A Pass's edges as something to smell ──────────────────────────────────

/**
 * A picture → Pass → Edges (texture) → a second Pass: the outlines are a texture
 * the walkers smell (a second Sense through Also) and are born on.
 */
export function shaderOutlinesNodes(x = 0, y = 0): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('olIn', [TRAIL_PORT, { key: 'outlines', type: 'texture', label: 'Outlines' }], [
    'Agent Inputs: this walker as the step begins. Trail and Outlines are inputs added to the group: the Trail field (one step ago) and the picture\'s outlines (the second Pass outside).',
  ]);
  const senseLines = n('agentSense', 'olSenseLines', 420, 420, {
    angle: 30, distance: 0.02, weight: 25, width: '1',
    ...note([
      'Sense (the outlines): reads the Outlines texture at three sensors. Weight 25: an outline reads 0–1 and the trail reads in the tens, so the outlines are scaled up to count as much.',
      'Its Readings go into the other Sense\'s Also: one Sense per thing smelt, added together.',
      'Try: Weight 60 for walkers that never leave the lines; 5 for a network that only leans toward them.',
    ]),
  }, { texture: ['olIn', 'outlines'] });
  const senseTrail = n('agentSense', 'olSense', 420, 100, {
    angle: 30, distance: 0.02, weight: 1, width: '1',
    ...note(['Sense (the trail): the walkers\' own trail at the same three sensors, plus the outlines\' readings (Also).']),
  }, { texture: ['olIn', 'trail'], also: ['olSenseLines', 'readings'] });
  const crowd = expr('olCrowd', 840, 100, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3' }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    values: { sat: 25 },
    lines: [],
    result: 'r * exp(-r / sat)',
    outputType: 'vec3',
    wires: { r: ['olSense', 'readings'] },
    note: ['Crowding (an Expression Block): a reading\'s pull rises up to Sat (25) and falls past it, r · e^(−r / sat), so walkers spread along a line instead of bunching on one spot.'],
  });
  const steer = n('agentSteer', 'olSteer', 1260, 100, {
    mode: 'jones', turn: 40, jitter: 0.1,
    ...note(['Steer (Jones rule): 40° toward the better reading.']),
  }, { readings: ['olCrowd', 'result'] });
  const move = n('agentMove', 'olMove', 1680, 100, {
    speed: 0.18, edges: 'wrap',
    ...note(['Move: one step at 0.18 picture units a second; Wrap at the edges.']),
  }, { heading: ['olSteer', 'heading'] });
  const output = n('agentOutput', 'olOut', 2100, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position, Heading and Velocity from Move.']),
  }, { position: ['olMove', 'position'], heading: ['olMove', 'heading'], velocity: ['olMove', 'velocity'] });

  // ── Outside: a picture, its edges, as textures ──
  const uv = n('uv', 'olUv', X(0), Y(420), { ...note(['UV: where each pixel is, for the built-in picture and your Texture Input.']) });
  const poster = expr('olPoster', X(420), Y(420), {
    label: 'Built-in picture',
    inputs: [{ name: 'uv', type: 'vec2' }],
    lines: [
      ['vec3 sky', 'mix(vec3(0.98, 0.62, 0.35), vec3(0.35, 0.2, 0.5), uv.y * 0.5 + 0.5)'],
      ['float sun', '1.0 - step(0.3, length(uv - vec2(0.55, 0.25)))'],
      ['float far', 'step(uv.y, 0.05 + 0.18 * sin(uv.x * 2.2 + 0.4))'],
      ['float near', 'step(uv.y, -0.3 + 0.22 * sin(uv.x * 1.4 - 1.1) + 0.06 * sin(uv.x * 5.0))'],
      ['float lake', 'step(uv.y, -0.72)'],
    ],
    result: 'mix(mix(mix(mix(sky, vec3(1.0, 0.92, 0.6), sun), vec3(0.45, 0.25, 0.45), far), vec3(0.16, 0.1, 0.25), near), vec3(0.2, 0.35, 0.6), lake)',
    outputType: 'vec3',
    wires: { uv: ['olUv', 'uv'] },
    note: [
      'Built-in picture (an Expression Block): a flat-colour poster to trace until you load your own: a sun over two ranges of hills and a lake.',
      'sky: orange at the bottom to violet at the top. sun: 1 inside the sun\'s disc. far: 1 below the far hills\' line. near: 1 below the near hills\' line. lake: 1 in the lake along the bottom.',
      'Result: each shape painted over the one behind it. Flat colours have sharp edges, which is what Edges finds.',
    ],
  });
  const tex = n('textureInput', 'olTex', X(420), Y(800), {
    fit: 'cover',
    ...note(['Texture Input: load your own picture here, then set Yours to 1 on Picture. Until then it reads black and the poster is used.']),
  }, { uv: ['olUv', 'uv'] });
  const pic = expr('olPic', X(840), Y(420), {
    label: 'Picture',
    inputs: [{ name: 'builtIn', type: 'vec3' }, { name: 'img', type: 'vec3' }, { name: 'yours', type: 'float', slider: { min: 0, max: 1 } }],
    values: { yours: 0 },
    lines: [],
    result: 'mix(builtIn, img, yours)',
    outputType: 'vec3',
    wires: { builtIn: ['olPoster', 'result'], img: ['olTex', 'color'] },
    note: ['Picture (an Expression Block): the picture to trace: the built-in poster (Yours 0) or your Texture Input (Yours 1).'],
  });
  const pass = n('pass', 'olPass', X(1260), Y(420), {
    scale: '1', format: 'half', filter: 'linear', wrap: 'clamp',
    ...note(['Pass: draws the picture into a texture, so Edges (texture) can read the pixels around each one. Its Color also colours the veins (Veins in the picture\'s colours).']),
  }, { color: ['olPic', 'result'] });
  const edges = n('edgesTexture', 'olEdges', X(1680), Y(420), {
    strength: 3, width: 1.5,
    ...note([
      'Edges (texture): where the picture\'s brightness changes sharply: the outline of every shape, 0–1.',
      'Try: Width 3 for bolder outlines the walkers find more easily; Strength 6 for faint edges in a photo.',
    ]),
  }, { texture: ['olPass', 'texture'] });
  const lines = expr('olLines', X(2100), Y(420), {
    label: 'Outlines to grey',
    inputs: [{ name: 'e', type: 'float' }],
    lines: [['float line', 'smoothstep(0.1, 0.5, e)']],
    result: 'vec3(line)',
    outputType: 'vec3',
    wires: { e: ['olEdges', 'edges'] },
    note: [
      'Outlines to grey (an Expression Block): turns the edge strength into a grey picture for the second Pass.',
      'line: 1 on a clear edge, 0 off it (the faint ones dropped), so photo noise isn\'t mistaken for an outline.',
    ],
  });
  const linesPass = n('pass', 'olOutlines', X(2520), Y(420), {
    scale: '1', format: 'half', filter: 'linear', wrap: 'clamp',
    ...note([
      'Pass (the outlines): the outlines as a texture of their own. Edges only gives a number at the current pixel; a Pass lets the walkers read it anywhere (Sense) and Emit choose places on it (Picture).',
    ]),
  }, { color: ['olLines', 'result'] });
  const emit = n('agentEmit', 'olEmit', X(0), Y(0), {
    mode: 'fill', shape: 'picture', threshold: 0.5, heading: 'random',
    ...note(['Emit, Shape Picture: every walker is born on an outline (the outlines Pass\'s Texture, wired into Picture, above Threshold 0.5).']),
  }, { picture: ['olOutlines', 'texture'] });
  let group = agentsGroup('olSlime', X(420), Y(0), 'olEmit', [inputs, senseLines, senseTrail, crowd, steer, move, output], {
    label: 'Slime on outlines', tier: '256k', preroll: 4,
    ...note([
      'Agents: 262,144 walkers (256k), 2 steps a frame. Two added inputs: the Trail and the Outlines texture.',
      'Pre-roll 4: the outlines are traced when the picture appears.',
    ]),
  });
  group = groupInput(group, 'trail', 'texture', 'Trail', ['olTrail', 'texture']);
  group = groupInput(group, 'outlines', 'texture', 'Outlines', ['olOutlines', 'texture']);
  const deposit = n('agentDeposit', 'olDeposit', X(840), Y(0), {
    amount: 1, size: 1,
    ...note(['Deposit: every walker leaves 1 unit of trail a step.']),
  }, { agents: ['olSlime', 'agents'] });
  const trail = n('trailField', 'olTrail', X(1260), Y(0), {
    resolution: '1024', diffuse: 1, halfLife: 0.06, edges: 'wrap', gain: 0.05,
    ...note(['Trail field: 1024 rows; spreads and fades every step. Its Texture goes back into the group; its Amount draws the veins.']),
  }, { deposit: ['olDeposit', 'deposit'] });
  const look = expr('olLook', X(1680), Y(0), {
    label: 'Veins in the picture\'s colours',
    inputs: [{ name: 'a', type: 'float' }, { name: 'c', type: 'vec3' }],
    lines: [
      ['vec3 tint', 'mix(vec3(1.0, 0.92, 0.8), c / max(max(c.r, max(c.g, c.b)), 0.05), 0.7)'],
      ['vec3 veins', 'tint * a * 2.2'],
    ],
    result: 'veins + c * 0.2',
    outputType: 'vec3',
    wires: { a: ['olTrail', 'amount'], c: ['olPass', 'color'] },
    note: [
      'Veins in the picture\'s colours (an Expression Block): the slime coloured by the picture under it.',
      'tint: the picture\'s hue at full brightness, mixed with warm white. veins: the trail\'s Amount in that tint.',
      'Result: the veins over a ghost of the picture (20%). Try: c * 0.0 for the outlines alone.',
    ],
  });
  const output2 = n('output', 'olOutput', X(2100), Y(0), { ...note(['Output: the picture\'s outlines, drawn by slime, are the picture.']) }, { color: ['olLook', 'result'] });
  return [emit, uv, poster, tex, pic, pass, edges, lines, linesPass, group, deposit, trail, look, output2];
}

// ── 8. Sound rings that draw and pull ────────────────────────────────────────

/**
 * One SDF chain both drawn and obeyed: rings ride outward, pulsing with the
 * sound (a silent stand-in beat until a track is loaded), and Flow pulls
 * particles down onto them, harder on each beat.
 */
export function shaderSoundRingsNodes(x = 0, y = 0): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;
  const inputs = inputsWith('sdIn', [{ key: 'rings', type: 'float', label: 'Rings' }, { key: 'loud', type: 'float', label: 'Loudness' }], [
    'Agent Inputs: this particle as the step begins. Rings and Loudness are inputs added to the group: the rings\' distance and how loud it is, both chains from outside.',
  ]);
  const pull = expr('sdPull', 420, 420, {
    label: 'Pull with the beat',
    inputs: [{ name: 'loud', type: 'float' }, { name: 'base', type: 'float', slider: { min: 0, max: 4 } }, { name: 'kick', type: 'float', slider: { min: 0, max: 20 } }],
    values: { base: 0.4, kick: 8 },
    lines: [],
    result: '-(base + kick * loud)',
    outputType: 'float',
    wires: { loud: ['sdIn', 'loud'] },
    note: [
      'Pull with the beat (an Expression Block): Flow\'s Strength. Base (0.4) always, plus Kick (8) × the loudness, negative so Flow pulls down the distance: onto the rings.',
      'Try: Kick 16 for a harder snap on every beat; Base 0 for rings that only pull on the beat.',
    ],
  });
  const flow = n('agentFlow', 'sdFlow', 840, 40, {
    mode: 'slope', strength: -1, step: 0.01,
    ...note([
      'Flow, Slope: pushes the particle along the slope of the Rings chain; its Strength (from Pull with the beat) is negative, so they slide downhill, onto the nearest ring, where the distance is lowest.',
      'Its Also adds the curl noise in.',
    ]),
  }, { field: ['sdIn', 'rings'], strength: ['sdPull', 'result'], also: ['sdCurl', 'force'] });
  const curl = n('agentCurl', 'sdCurl', 420, 40, {
    strength: 0.6, size: 1.5, evolve: 0.3,
    ...note(['Curl noise (Strength 0.6): a swirl that loosens the particles between beats, so the rings fray into wavy threads and snap back on the next beat.', 'Try: 0 for perfect circles; 1.5 for rings that only just hold together.']),
  });
  const integrate = n('agentIntegrate', 'sdMove', 1260, 80, {
    drag: 2.5, maxSpeed: 3, mass: 1, edges: 'wrap',
    ...note(['Integrate: Drag 2.5 settles each pull quickly, so every beat reads as a snap. Edges Wrap.']),
  }, { force: ['sdFlow', 'force'] });
  const age = n('agentAge', 'sdAge', 1260, 560, {
    span: 1,
    ...note(['Age / Life: each particle lives about 5 s, then Emit gives it a new place anywhere.']),
  });
  const output = n('agentOutput', 'sdOut', 1680, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Integrate, Alive from Age / Life.']),
  }, { position: ['sdMove', 'position'], velocity: ['sdMove', 'velocity'], alive: ['sdAge', 'alive'] });

  // ── Outside: sound → rings, one chain drawn and obeyed ──
  const uv = n('uv', 'sdUv', X(0), Y(420), { ...note(['UV: where each pixel (or, read inside the group, each particle) is.']) });
  const time = n('time', 'sdTime', X(0), Y(700), { ...note(['Time: moves the rings outward and keeps the stand-in beat. Inside the group it is the simulation\'s own clock, so the beat lands on the same steps every run.']) });
  const audio = n('audioInput', 'sdAudio', X(0), Y(980), {
    mode: 'full', freq_range: 200,
    ...note(['Audio Input, Full Spectrum: how loud a loaded track is (0–1). Silent until you load one; then set Beat to 0 on Loudness.']),
  });
  const loud = expr('sdLoud', X(420), Y(700), {
    label: 'Loudness',
    inputs: [{ name: 'audio', type: 'float' }, { name: 't', type: 'float' }, { name: 'bpm', type: 'float', slider: { min: 0, max: 200 } }],
    values: { bpm: 120 },
    lines: [['float beat', 'bpm > 0.0 ? exp(-fract(t * bpm / 60.0) * 5.0) : 0.0']],
    result: 'max(audio, beat)',
    outputType: 'float',
    wires: { audio: ['sdAudio', 'amplitude_0'], t: ['sdTime', 'time'] },
    note: [
      'Loudness (an Expression Block): how loud it is now, 0–1.',
      'beat: a silent stand-in kick, Bpm (120) times a minute: jumps to 1 on each beat and dies away. Set Bpm to 0 when a track drives Audio Input.',
      'Result: the louder of the track and the stand-in. It goes into the rings (they swell) and into the group (the pull).',
    ],
  });
  const centre = n('circleSDF', 'sdCentre', X(420), Y(420), {
    radius: 0.02, posX: 0, posY: 0,
    ...note(['Circle SDF: the distance from the middle, to repeat into rings.']),
  }, { position: ['sdUv', 'uv'] });
  const rings = expr('sdRings', X(840), Y(420), {
    label: 'Rings that ride out',
    inputs: [
      { name: 'd', type: 'float' }, { name: 't', type: 'float' }, { name: 'loud', type: 'float' },
      { name: 'spacing', type: 'float', slider: { min: 0.05, max: 0.6 } }, { name: 'speed', type: 'float', slider: { min: -0.5, max: 0.5 } },
    ],
    values: { spacing: 0.24, speed: 0.08 },
    lines: [
      ['float travel', 'd - t * speed'],
      ['float local', 'mod(travel + spacing * 0.5, spacing) - spacing * 0.5'],
      ['float width', '0.004 + 0.03 * loud'],
    ],
    result: 'abs(local) - width',
    outputType: 'float',
    wires: { d: ['sdCentre', 'distance'], t: ['sdTime', 'time'], loud: ['sdLoud', 'result'] },
    note: [
      'Rings that ride out (an Expression Block): concentric rings, Spacing (0.24) apart, moving outward at Speed (0.08 a second), swelling with the sound.',
      'travel: the distance from the middle, shifted by time, so the rings move. local: folded into one Spacing (the SDF repeat).',
      'width: how thick the rings are: thin when quiet, fat on a beat.',
      'Result: the rings\' signed distance. The same chain is drawn (Glow rings) and obeyed (the group\'s Rings, into Flow).',
    ],
  });
  const emit = n('agentEmit', 'sdEmit', X(0), Y(0), {
    mode: 'respawn', shape: 'screen', heading: 'random', life: 5, lifeVar: 0.5, speed: 0,
    ...note(['Emit: particles are born anywhere on the picture, each living 5 s ± half; Keep full gives each a new place when it dies, so some are always on their way to a ring.']),
  });
  let group = agentsGroup('sdDust', X(420), Y(0), 'sdEmit', [inputs, pull, curl, flow, integrate, age, output], {
    label: 'Dust on sound rings', tier: '256k', preroll: 3,
    ...note([
      'Agents: 262,144 particles (256k), 2 steps a frame. Its Rings and Loudness inputs are wired from the chains outside.',
      'Inside: Curl noise → Flow (down the rings\' slope, harder with the loudness) → Integrate, and Age / Life.',
    ]),
  });
  group = groupInput(group, 'rings', 'float', 'Rings', ['sdRings', 'result']);
  group = groupInput(group, 'loud', 'float', 'Loudness', ['sdLoud', 'result']);
  const glow = expr('sdGlow', X(1260), Y(420), {
    label: 'Glow rings',
    inputs: [{ name: 'ring', type: 'float' }, { name: 'loud', type: 'float' }, { name: 'd', type: 'float' }],
    lines: [
      ['float line', 'exp(-abs(ring) * 90.0)'],
      ['float fade', 'exp(-d * 0.9)'],
      ['vec3 ink', 'mix(vec3(0.15, 0.35, 1.0), vec3(1.0, 0.35, 0.75), loud)'],
    ],
    result: 'vec3(0.006, 0.006, 0.016) + ink * line * fade * (0.04 + 0.25 * loud)',
    outputType: 'vec3',
    wires: { ring: ['sdRings', 'result'], loud: ['sdLoud', 'result'], d: ['sdCentre', 'distance'] },
    note: [
      'Glow rings (an Expression Block): the rings drawn from the same chain the particles follow.',
      'line: 1 on a ring\'s edges, glowing out from them (e^(−90·|ring|)), so a fat ring on the beat shows as a double line. fade: dimmer toward the edges. ink: blue when quiet, pink on a beat.',
      'Result: the glowing rings over near-black, brighter on the beat.',
    ],
  });
  const draw = n('drawAgents', 'sdDraw', X(1680), Y(0), {
    style: 'streaks', colorBy: 'speed', palette: 'neon', speedRef: 0.25, scaleBy: 'walker', size: 1, brightness: 0.6, glow: 0.5, streak: 0.4, fade: 'on', lights: '0',
    ...note([
      'Draw agents, Streaks: every particle a short glowing line along its motion, coloured by speed on the Neon palette (Fast is 0.25): violet and pink while drifting, cyan and green as a beat yanks them onto a ring, when the streaks also stretch out.',
      'Brightness of Each walker (0.6): the rings, where the particles crowd, blaze; the gaps stay dark.',
    ]),
  }, { agents: ['sdDust', 'agents'], over: ['sdGlow', 'result'] });
  const output2 = n('output', 'sdOutput', X(2100), Y(0), { ...note(['Output: the dust on the glowing rings is the picture.']) }, { color: ['sdDraw', 'color'] });
  return [emit, uv, time, audio, loud, centre, rings, group, glow, draw, output2];
}

export function buildAgentShaderExamples(): Record<string, ExampleGraph> {
  const at = (k: string, nodes: GraphNode[]) => ({ ...AGENT_SHADER_EXAMPLE_INDEX[k], counter: 40, nodes });
  return {
    agentShaderRings: at('agentShaderRings', shaderRingsNodes(0, 200)),
    agentShaderWalls: at('agentShaderWalls', shaderWallsNodes(0, 200)),
    agentShaderNoiseFlow: at('agentShaderNoiseFlow', shaderNoiseFlowNodes(0, 200)),
    agentShaderPolar: at('agentShaderPolar', shaderPolarNodes(0, 200)),
    agentShaderEmitter: at('agentShaderEmitter', shaderEmitterNodes(0, 200)),
    agentShaderFeedback: at('agentShaderFeedback', shaderFeedbackNodes(0, 200)),
    agentShaderOutlines: at('agentShaderOutlines', shaderOutlinesNodes(0, 200)),
    agentShaderSoundRings: at('agentShaderSoundRings', shaderSoundRingsNodes(0, 200)),
  };
}
