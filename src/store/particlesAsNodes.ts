/**
 * particlesAsNodes.ts — "Open as nodes" on the Particles node (docs/agents-plan.md §11, P6).
 *
 * Builds an Agents-group copy of one Particles node's current settings: Emit, the group
 * (its rule: the node's forces as force nodes chained through Also, Integrate, Age / Life,
 * Collide and Chladni after it, Sound kicks for its sound), and Draw agents with its look
 * and lights. Every node carries a plain-language note saying which of the Particles node's
 * settings it carries. Wired sockets come along: Over goes into Draw agents, the Emitter
 * position into Emit, and wired settings (Turbulence, Gravity, a hand…) into the group
 * through ports on Agent Inputs.
 *
 * Pure: the store adds the nodes, rewires what read the Particles node to Draw agents and
 * leaves the original as it was. Anything the group can't express yet is listed in
 * `missing` (the 3D camera, depth of field, Gust, Jet…) rather than dropped silently.
 */
import type { DataType, GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';
import { agentsGroup, expr, note, withOutputs } from './agentExampleKit';
import { GP_DEFAULTS, GP_SOCKET_FLOATS } from '../play/kit/gpuParticles.js';

export interface ParticlesAsNodes {
  /** The new top-level nodes (the group's inside is in its subgraph). */
  nodes: GraphNode[];
  groupId: string;
  drawId: string;
  /** The Texture Input made for an Image emitter: the store copies the node's picture into it. */
  imageId?: string;
  /** Which of the Particles node's outputs go to which output of the copy (null: none fits). */
  outputs: Record<'color' | 'particles' | 'density', { nodeId: string; outputKey: string } | null>;
  /** What the group can't express yet, one plain sentence each. */
  missing: string[];
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
const LABELS: Record<string, string> = {
  emitSize: 'Emitter size', life: 'Life', speed: 'Speed', spread: 'Spread', release: 'Release', burst: 'Burst',
  gravity: 'Gravity', wind: 'Wind', turbulence: 'Turbulence', scale: 'Turbulence size', swirl: 'Swirl', attract: 'Attract', drag: 'Drag',
  size: 'Size', thread: 'Thread', brightness: 'Brightness', glow: 'Glow', camAngle: 'Camera angle', camDistance: 'Camera distance', focus: 'Focus', blur: 'Blur',
  sound: 'Sound level', wave: 'Wave', vibrate: 'Vibrate', shock: 'Shockwave', crunch: 'Crunch', gust: 'Gust', jet: 'Jet',
  handForce: 'Hand pull', handSwirl: 'Hand swirl', flowForce: 'Flow force',
  modeN: 'N', modeM: 'M', plateFreq: 'Frequency', plateWeights: 'Weights', settle: 'Settle speed', shake: 'Shake',
};

/**
 * The copy of Particles node `src` (top level), its nodes placed from `at`, ids from `nextId`.
 */
export function particlesAsNodes(src: GraphNode, nextId: () => string, at: { x: number; y: number }): ParticlesAsNodes {
  const P = src.params;
  const num = (k: string): number => {
    const v = P[k];
    return typeof v === 'number' && isFinite(v) ? v : (GP_DEFAULTS as unknown as Record<string, unknown>)[k] as number;
  };
  const str = (k: string): string => (typeof P[k] === 'string' ? P[k] as string : String((GP_DEFAULTS as unknown as Record<string, unknown>)[k]));
  const colour = (k: string): number[] => {
    const v = P[k];
    return Array.isArray(v) && v.length >= 3 && v.every(x => typeof x === 'number') ? (v as number[]).slice(0, 3) : [...((GP_DEFAULTS as unknown as Record<string, unknown>)[k] as number[])];
  };
  const wire = (k: string) => src.inputs[k]?.connection ?? null;
  const ids = new Map<string, string>();
  const id = (local: string) => { let v = ids.get(local); if (!v) { v = nextId(); ids.set(local, v); } return v; };
  const missing: string[] = [];
  const X = (dx: number) => at.x + dx, Y = (dy: number) => at.y + dy;

  // ── Where things are: the emitter, wired or under the mouse ──
  const follow = str('follow');
  const emitWire = wire('emitAt');
  const outerNodes: GraphNode[] = [];
  let centre: { nodeId: string; outputKey: string } | null = emitWire;
  if (!centre && follow === 'emitter') {
    outerNodes.push(n('mouse', id('mouse'), X(0), Y(-300), {
      ...note(['Mouse: where the pointer is. The Particles node\'s Mouse moves was Emitter, so the emitter (and the swirl and sound round it) follows it here too.']),
    }));
    centre = { nodeId: id('mouse'), outputKey: 'uv' };
  }
  if (follow === 'lights') missing.push('Mouse moves: A light (the first light under the pointer): the lights orbit or stand still.');

  // ── The group's ports: wired values from outside, read inside through Agent Inputs ──
  const ports: Array<{ key: string; type: DataType; label: string; from: { nodeId: string; outputKey: string } }> = [];
  const port = (key: string, type: DataType, label: string, from: { nodeId: string; outputKey: string }): [string, string] => {
    if (!ports.some(p => p.key === key)) ports.push({ key, type, label, from });
    return [id('in'), key];
  };
  /** A wired float setting as a port, or null when unwired. */
  const floatIn = (k: string): [string, string] | null => {
    const c = wire(k);
    return c ? port(`p_${k}`, 'float', LABELS[k] ?? k, c) : null;
  };
  const centreIn = centre ? port('emitter', 'vec2', 'Emitter', centre) : null;
  const cx = 0, cy = 0;

  // ── Inside: the forces, chained through Also ──
  const inside: GraphNode[] = [];
  let chain: [string, string] | null = null;
  let col = 420;
  const addForce = (node: GraphNode) => {
    if (chain) node.inputs.also = { ...node.inputs.also, connection: { nodeId: chain[0], outputKey: chain[1] } };
    node.position = { x: col, y: 40 };
    col += 420;
    inside.push(node);
    chain = [node.id, 'force'];
  };
  const wireIn = (node: GraphNode, key: string, from: [string, string] | null) => {
    if (from) node.inputs[key] = { ...node.inputs[key], connection: { nodeId: from[0], outputKey: from[1] } };
    return node;
  };
  const used = (k: string) => num(k) !== 0 || !!wire(k);

  if (used('gravity')) {
    addForce(wireIn(n('agentGravity', id('gravity'), 0, 0, {
      strength: num('gravity'), angle: -90,
      ...note([`Gravity: the Particles node's Gravity (${fmt(num('gravity'))}): a steady pull down (negative: up, like sparks and smoke).`, 'Try: Angle 0 to make it pull sideways.']),
    }), 'strength', floatIn('gravity')));
  }
  if (used('turbulence')) {
    addForce(wireIn(n('agentCurl', id('curl'), 0, 0, {
      strength: num('turbulence'), size: num('scale'), evolve: 0.15,
      ...note([
        `Curl noise: the Particles node's Turbulence (${fmt(num('turbulence'))}) at its Turbulence size (${fmt(num('scale'))}): currents that carry the particles in wisps and threads, drifting as the Particles node's do (Evolve 0.15).`,
        'Try: Size 3 for small tight eddies; Strength 0 for still air.',
      ]),
    }), 'strength', floatIn('turbulence')));
  }
  if (wire('scale')) missing.push('Turbulence size wired: Curl noise\'s Size is a slider (the value it had is set on it).');
  if (used('wind')) {
    addForce(wireIn(n('agentWind', id('wind'), 0, 0, {
      strength: num('wind'), angle: 0, gust: 1, size: num('scale'), evolve: 0.15,
      ...note([`Wind: the Particles node's Wind (${fmt(num('wind'))}): a breeze to the right (negative: left), gusting with the same noise as the turbulence.`]),
    }), 'strength', floatIn('wind')));
  }
  if (used('swirl')) {
    const v = n('agentVortex', id('swirl'), 0, 0, {
      at: 'point', x: cx, y: cy, strength: num('swirl'), reach: 0.5,
      ...note([`Vortex: the Particles node's Swirl (${fmt(num('swirl'))}): a spin round the emitter${centreIn ? ' (its centre comes in through the Emitter port)' : ''}, strongest half a picture-height out.`, 'Try: a negative Strength to turn the other way.']),
    });
    wireIn(v, 'strength', floatIn('swirl'));
    addForce(wireIn(v, 'centre', centreIn));
  }
  if (used('attract')) {
    const toMouse = follow === 'attractor';
    addForce(wireIn(n('agentAttract', id('attract'), 0, 0, {
      target: toMouse ? 'mouse' : 'point', x: 0, y: 0, strength: num('attract'), reach: 0.35, swirl: 0, falloff: 'far',
      ...note([`Attract / Repel: the Particles node's Attract (${fmt(num('attract'))}), everywhere (Falloff Everywhere), toward ${toMouse ? 'the mouse (its Mouse moves was Attractor)' : 'the centre'}; negative pushes away.`]),
    }), 'strength', floatIn('attract')));
  }
  // Hands: one Attract (within reach) per hand, at Hand X / Y or a wired position.
  const hands = str('hands') === '2' ? 2 : str('hands') === '1' ? 1 : 0;
  const handPull = floatIn('handForce');
  if (wire('handSwirl')) missing.push('Hand swirl wired: Attract / Repel\'s Swirl is a slider (the value it had is set on it).');
  for (let h = 0; h < 2; h++) {
    const sock = h === 0 ? 'hand' : 'hand2';
    if (h >= hands && !wire(sock)) continue;
    const a = n('agentAttract', id(`hand${h}`), 0, 0, {
      target: 'hand', handX: num(h === 0 ? 'handX' : 'hand2X'), handY: num(h === 0 ? 'handY' : 'hand2Y'),
      strength: num('handForce'), reach: num('handReach'), swirl: num('handSwirl'), falloff: 'reach',
      ...note([
        `Attract / Repel: the Particles node's ${h === 0 ? 'first' : 'second'} hand: Hand pull ${fmt(num('handForce'))}, Hand swirl ${fmt(num('handSwirl'))}, within Hand reach ${fmt(num('handReach'))}${wire(sock) ? ', at the position wired into its Hand socket (the Hand port)' : ', at Hand X / Y'}.`,
        'Try: right-click Hand X → Follow a hand in Play.',
      ]),
    });
    if (wire(sock)) wireIn(a, 'target', port(sock, 'vec2', h === 0 ? 'Hand' : 'Hand 2', wire(sock)!));
    addForce(wireIn(a, 'strength', handPull));
  }
  if (wire('flow')) {
    const f = n('agentFlow', id('flow'), 0, 0, {
      mode: str('flowMode') === 'around' ? 'around' : 'slope', strength: num('flowForce'), step: 0.01,
      ...note([`Flow: the Particles node's Flow socket (through the Flow port), Flow force ${fmt(num('flowForce'))}, ${str('flowMode') === 'around' ? 'round its contours' : 'up its slopes'}. Read where each particle is, every step, with no lag.`]),
    });
    wireIn(f, 'field', port('flow', 'float', 'Flow', wire('flow')!));
    addForce(wireIn(f, 'strength', floatIn('flowForce')));
  }
  // Sound: a Sound kick for each of the node's sound forces that is on.
  const kicks: Array<[string, string, string]> = [['shock', 'shock', 'Shockwave'], ['wave', 'wave', 'Wave'], ['vibrate', 'vibrate', 'Vibrate'], ['crunch', 'shake', 'Crunch']];
  let listening = false;
  for (const [k, mode, label] of kicks) {
    if (!used(k)) continue;
    listening = true;
    const kick = n('agentSoundKick', id(`kick_${k}`), 0, 0, {
      mode, x: cx, y: cy, strength: num(k), speed: k === 'shock' ? 1.4 : num('waveSpeed'), soundFrom: 'graph', level: 0, beat: 0,
      ...note([
        `Sound kick, ${mode === 'shake' ? 'Shake' : label}: the Particles node's ${label} (${fmt(num(k))})${k === 'wave' || k === 'vibrate' ? `, rings travelling at its Wave speed (${fmt(num('waveSpeed'))})` : ''}. It hears what the group's Sound from hears.`,
      ]),
    });
    wireIn(kick, 'strength', floatIn(k));
    addForce(wireIn(kick, 'centre', centreIn));
  }
  if (used('gust')) missing.push(`Gust (${fmt(num('gust'))}): the currents surging with the sound. Curl noise doesn't listen yet; map a level to its Strength in Play.`);
  if (used('jet')) missing.push(`Jet (${fmt(num('jet'))}): the rocket exhaust from the emitter.`);

  // ── Moving ──
  const integrate = n('agentIntegrate', id('move'), col, 80, {
    drag: num('drag'), maxSpeed: 0, mass: 1, edges: 'free',
    ...note([
      `Integrate: the total force moves the particle, slowed by the Particles node's Drag (${fmt(num('drag'))}), with no speed limit (Max speed 0), as the Particles node does. Edges Free: particles may drift off the picture and are born again when their life is up.`,
    ]),
  });
  if (chain) integrate.inputs.force = { ...integrate.inputs.force, connection: { nodeId: chain[0], outputKey: chain[1] } };
  wireIn(integrate, 'drag', floatIn('drag'));
  inside.push(integrate);
  col += 420;
  let pos: [string, string] = [integrate.id, 'position'];
  let vel: [string, string] = [integrate.id, 'velocity'];
  if (wire('obstacle')) {
    const mask = str('obstacleMode') === 'mask';
    let shape: [string, string] = port('obstacle', 'float', 'Obstacle', wire('obstacle')!);
    if (mask) {
      const m = expr(id('mask'), col - 420, 520, {
        label: 'Mask to distance',
        inputs: [{ name: 'm', type: 'float' }],
        lines: [],
        result: '(0.5 - m) * 0.1',
        outputType: 'float',
        wires: { m: shape },
        note: [
          'Mask to distance (an Expression Block): the Particles node\'s Obstacle is a Mask (inside where it is brighter than a half); Collide wants a distance (inside below 0).',
          'Result: (0.5 − m) × 0.1, the Particles node\'s own rough distance for a mask.',
        ],
      });
      inside.push(m);
      shape = [m.id, 'result'];
    }
    const c = n('agentCollide', id('collide'), col, 80, {
      margin: 0.012, cushion: 0.08, bounce: 0, friction: 0.03,
      ...note([`Collide: the Particles node's Obstacle socket (through the Obstacle port${mask ? ', as a mask' : ''}): particles slide round the shape and part just before it, with its margin, cushion and friction.`]),
    });
    wireIn(c, 'shape', shape);
    wireIn(c, 'position', pos);
    wireIn(c, 'velocity', vel);
    inside.push(c);
    col += 420;
    pos = [c.id, 'position']; vel = [c.id, 'velocity'];
  }
  const pattern = str('pattern');
  if (pattern === 'square' || pattern === 'circle') {
    listening = true;
    const pl = n('agentChladni', id('plate'), col, 80, {
      shape: pattern, symmetry: str('symmetry') === 'plus' ? 'plus' : 'minus', modeFrom: str('modeFrom') === 'manual' ? 'manual' : 'sound',
      modeN: num('modeN'), modeM: num('modeM'), modes: num('modes'), plateFreq: num('plateFreq'), plateWeights: num('plateWeights'),
      size: Math.max(0.02, num('emitSize')), x: cx, y: cy, settle: num('settle'), shake: num('shake'), soundFrom: 'graph', level: 0, beat: 0,
      ...note([
        `Chladni: the Particles node's Pattern (${pattern === 'circle' ? 'round' : 'square'} plate, the emitter's size), Mode from ${str('modeFrom') === 'manual' ? `N and M (${fmt(num('modeN'))}, ${fmt(num('modeM'))})` : 'Sound'}, Modes ${fmt(num('modes'))}, Settle ${fmt(num('settle'))}, Shake ${fmt(num('shake'))}: the sand runs to the plate's still lines.`,
      ]),
    });
    wireIn(pl, 'position', pos);
    wireIn(pl, 'velocity', vel);
    inside.push(pl);
    col += 420;
    pos = [pl.id, 'position']; vel = [pl.id, 'velocity'];
    if (centreIn) missing.push('A moving emitter with a Pattern: the plate stays at the centre.');
    for (const k of ['modeN', 'modeM', 'plateFreq', 'plateWeights', 'settle', 'shake']) if (wire(k)) missing.push(`${LABELS[k]} wired: Chladni's ${LABELS[k]} is a slider (the value it had is set on it).`);
  }
  const age = n('agentAge', id('age'), integrate.position.x, 660, {
    span: 1,
    ...note([`Age / Life: how old the particle is against the Life Emit gave it (the Particles node's ${fmt(num('life'))} s, up to half as much again either way). Alive drops to 0 when it is up, and Emit gives it a new life.`]),
  });
  inside.push(age);
  const output = n('agentOutput', id('out'), col, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: the particle at the end of the step: Position and Velocity from the last node that moved it, Alive from Age / Life. Heading and Speed follow from the Velocity.']),
  }, {});
  wireIn(output, 'position', pos);
  wireIn(output, 'velocity', vel);
  wireIn(output, 'alive', [age.id, 'alive']);
  inside.push(output);
  const inputs = withOutputs(n('agentInputs', id('in'), 0, 160, {
    _groupOriginal: true,
    extraInputs: ports.map(p => ({ key: p.key, type: p.type, label: p.label })),
    ...note([
      'Agent Inputs: this particle as the step begins. Every force to the right reads its own position from here when its Position socket is left unwired.',
      ...(ports.length ? [`Ports added to the group, carrying what was wired into the Particles node: ${ports.map(p => p.label).join(', ')}.`] : []),
    ]),
  }), Object.fromEntries(ports.map(p => [p.key, { type: p.type, label: p.label }])));
  inside.unshift(inputs);

  // ── Outside: Emit, the group, Draw agents ──
  const shapeOf: Record<string, string> = { point: 'point', line: 'line', ring: 'ring', disk: 'disc', sphere: 'disc', ball: 'disc', box: 'box', image: 'field' };
  const gpShape = str('emitter');
  const shape = shapeOf[gpShape] ?? 'ring';
  const facing = gpShape === 'point' || gpShape === 'line' ? 'up' : gpShape === 'box' || gpShape === 'image' ? 'random' : 'outward';
  if (gpShape === 'sphere' || gpShape === 'ball') missing.push(`Emitter ${gpShape === 'sphere' ? 'Sphere' : 'Ball'}: a 3D shape; the copy is born in a flat Disc of the same size.`);
  if (str('emit') === 'burst') missing.push('Emit Burst (all born together, again every Life): the copy keeps the stream full (Keep full); route a beat to Emit\'s Burst for a burst on cue.');
  const image = gpShape === 'image';
  const ink = str('look') === 'ink';
  if (image) {
    missing.push('Image emitter: the copy is born on the picture\'s bright parts (dark parts with Ink), but the particles don\'t hold it: no homes, no Release, not the picture\'s own colours.');
    outerNodes.push(n('textureInput', id('image'), X(0), Y(-560), {
      fit: 'contain',
      ...note(['Texture Input: the Particles node\'s picture (its Image), copied. Load another one here to be born on it instead.']),
    }));
    outerNodes.push(expr(id('bright'), X(420), Y(-560), {
      label: ink ? 'Darkness' : 'Brightness',
      inputs: [{ name: 'c', type: 'vec3' }],
      lines: [['float luma', 'dot(c, vec3(0.299, 0.587, 0.114))']],
      result: ink ? '1.0 - luma' : 'luma',
      outputType: 'float',
      wires: { c: [id('image'), 'color'] },
      note: [
        `${ink ? 'Darkness' : 'Brightness'} (an Expression Block): where on the picture particles may be born, for Emit's Where ƒ.`,
        `luma: the picture's brightness here. Result: ${ink ? '1 − luma (the Ink look takes the dark parts)' : 'luma'}.`,
      ],
    }));
  }
  if (num('release') !== 0 || wire('release')) missing.push('Release: an Image emitter letting its picture go.');
  for (const k of ['emitSize', 'life', 'speed', 'spread', 'burst']) if (wire(k)) missing.push(`${LABELS[k]} wired: Emit's ${LABELS[k]} is a slider (the value it had is set on it).`);
  const lifeV = num('life');
  const emit = n('agentEmit', id('emit'), X(0), Y(0), {
    mode: 'respawn', shape, heading: facing, x: cx, y: cy, size: num('emitSize'), life: lifeV, lifeVar: 0.5,
    speed: num('speed'), speedVar: 0.45, spread: num('spread'), burst: num('burst'),
    ...(image ? { threshold: num('threshold'), miss: 'skip' } : {}),
    ...note([
      `Emit: the Particles node's emitter: ${image ? 'its picture' : `a ${shape === 'disc' ? 'disc' : shape}`} of size ${fmt(num('emitSize'))}${centre ? ' that moves with the Emitter position' : ' in the middle'}, each particle living its Life (${fmt(lifeV)} s, up to half as much again either way), leaving at its Speed (${fmt(num('speed'))}) ${facing === 'up' ? 'upward' : facing === 'outward' ? 'outward' : 'in any direction'}, Spread ${fmt(num('spread'))}.`,
      'Keep full: every particle is born at once at a random age and born again the moment it dies, so the stream never runs dry. Burst (a trigger) sends everyone out again at once.',
      ...(image ? ['Shape Field: born where the picture (Where ƒ) is above Threshold; No place found: Not born this time, so none appear off the picture.'] : []),
    ]),
  }, image ? { where: [id('bright'), 'result'] } : {});
  if (centre) emit.inputs.position = { ...emit.inputs.position, connection: centre };
  const preroll = Math.round(Math.min(6, lifeV * 1.5) * 2) / 2;
  const tier = ['64k', '256k', '1m', '4m'].includes(str('count')) ? str('count') : '256k';
  let group = agentsGroup(id('group'), X(420), Y(0), id('emit'), inside, {
    label: `${typeof P.label === 'string' && P.label.trim() ? P.label.trim() : 'Particles'} (nodes)`, tier, stepsPerFrame: 1, seed: 1, preroll,
    ...(listening ? { soundFrom: str('soundFrom'), level: num('sound'), beat: 0 } : {}),
    ...note([
      `Agents: the Particles node's ${tier === '1m' ? 'million' : tier === '4m' ? 'four million' : tier === '64k' ? '65,536' : '262,144'} particles, built from nodes you can open and rewire (double-click). Inside: its forces added up through their Also inputs, then Integrate${wire('obstacle') ? ', Collide' : ''}${pattern !== 'off' ? ', Chladni' : ''} and Age / Life.`,
      'Steps per frame 1: the Particles node\'s own pace (one step is 1/60 s). 2 runs twice as lively.',
      `Pre-roll ${fmt(preroll)}: simulated before the first frame, as the Particles node does, so the stream is already flowing when it appears.`,
      ...(listening ? [`Sound from: the Particles node's (${str('soundFrom')}), with its Sound level (${fmt(num('sound'))}) as Level.`] : []),
      'Settings the Particles node had at 0 aren\'t here as nodes: add Gravity, Wind or Vortex from Simulation inside the group.',
    ]),
  });
  for (const p of ports) group = { ...group, inputs: { ...group.inputs, [p.key]: { type: p.type, label: p.label, connection: p.from } } };
  if (wire('sound')) missing.push('Sound level wired: the group\'s Level is a slider (map the level to it in Play).');
  if (listening && str('soundFrom') === 'graph') missing.push('Sound from Graph: the copy hears its Level slider, not an Audio input node in the graph (map that node\'s level to the group\'s Level in Play).');

  // The look.
  const thread = num('thread');
  const style = ink ? 'ink' : thread > 0 ? 'streaks' : 'glow';
  const colorBy = ink ? 'single' : ({ life: 'age', speed: 'speedFast', heading: 'headingRound' } as Record<string, string>)[str('colorBy')] ?? 'age';
  const lights = ['0', '1', '2', '3', '4'].includes(str('lights')) ? str('lights') : '0';
  const orbit = Math.min(1.2, 0.2 + Math.min(num('emitSize'), 1.5) * 0.7);
  const draw = n('drawAgents', id('draw'), X(840), Y(0), {
    style, colorBy, palette: ink ? 'ab' : str('palette'), colorA: ink ? colour('ink') : [1, 0.75, 0.35], paper: colour('paper'),
    speedRef: Math.max(0.05, 2.5 * Math.abs(num('speed')) + 0.25), scaleBy: 'crowd', size: num('size'), brightness: Math.round(num('brightness') * 0.7 * 1000) / 1000,
    glow: num('glow'), streak: thread, fade: 'on',
    lights, lightColor: colour('lightColor'), lightPower: num('lightPower'), lightReach: num('lightReach'), halo: num('halo'),
    lightMotion: str('lightMotion') === 'still' ? 'still' : 'orbit', lightOrbit: Math.round(orbit * 1000) / 1000, lightX: cx, lightY: cy,
    ...note([
      `Draw agents: the Particles node's ${ink ? 'Ink look: dark ink on Paper' : 'Light look'}${style === 'streaks' ? ', drawn as streaks along the motion (its Thread)' : ink && thread > 0 ? ', in streaks (its Thread)' : ', soft dots with its glow'}, Size ${fmt(num('size'))}, Glow ${fmt(num('glow'))}${ink ? '' : `, the ${str('palette')} palette by ${({ age: 'age', speedFast: 'speed (fast ones first)', headingRound: 'heading' } as Record<string, string>)[colorBy]}`}.`,
      `Brightness of The crowd: the Particles node's rule, so the cloud looks as bright at any count. Brightness ${fmt(num('brightness'))} × 0.7: here every particle is alive at once, where the Particles node keeps about two in three.`,
      ...(lights !== '0' ? [`Lights: its ${lights} light${lights === '1' ? '' : 's'}, ${str('lightMotion') === 'still' ? 'standing' : 'orbiting'} round the emitter, power ${fmt(num('lightPower'))}, reach ${fmt(num('lightReach'))}, halo ${fmt(num('halo'))}.`] : []),
    ]),
  });
  draw.inputs.agents = { ...draw.inputs.agents, connection: { nodeId: id('group'), outputKey: 'agents' } };
  if (wire('over')) draw.inputs.over = { ...draw.inputs.over, connection: wire('over')! };
  if (centre && lights !== '0') missing.push('A moving emitter with Lights: the lights circle the centre (Draw agents\' Centre X / Y).');
  for (const k of ['size', 'thread', 'brightness', 'glow']) if (wire(k)) missing.push(`${LABELS[k]} wired: Draw agents' ${LABELS[k]} is a slider (the value it had is set on it).`);
  if (wire('uv')) missing.push('UV (reading the particles through a warp): Draw agents draws them where they are.');

  // 3D.
  if (str('space') === '3d') missing.push('3D: the camera, its drift and depth of field (Space, Camera angle, tilt, distance, Drift, Focus, Blur): the copy is flat, in the picture\'s plane.');
  if (wire('camOrigin') || wire('camRay') || wire('depth') || wire('scene')) missing.push('A scene\'s camera, Depth or Scene: the 3D sockets aren\'t carried (the copy is 2D).');
  for (const k of ['camAngle', 'camDistance', 'focus', 'blur']) if (wire(k) && str('space') !== '3d') missing.push(`${LABELS[k]} wired: 3D only.`);
  for (const k of GP_SOCKET_FLOATS) if (wire(k) && !LABELS[k]) missing.push(`${k} wired.`);

  const left = [...new Set(missing)];
  // The group's note keeps the list, so it is still there after the toast has gone.
  if (left.length) group = { ...group, params: { ...group.params, __comment: `${group.params.__comment}\nNot carried over from the Particles node yet: ${left.join(' ')}` } };
  const nodes = [...outerNodes, emit, group, draw];
  // The original's Particles output (the particles alone) has no match on the copy when Over is wired.
  const out = { nodeId: draw.id, outputKey: 'color' };
  return {
    nodes,
    groupId: group.id,
    drawId: draw.id,
    ...(image ? { imageId: id('image') } : {}),
    outputs: { color: out, particles: wire('over') ? null : out, density: { nodeId: draw.id, outputKey: 'density' } },
    missing: left,
  };
}
