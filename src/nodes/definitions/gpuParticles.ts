/**
 * Particles — up to 4 million particles simulated on the GPU, lit by point
 * lights and glowing, in the picture's own space or in 3D through a drifting
 * camera with depth of field (TouchDesigner style). Wire a picture into Over
 * and Color comes out with the particles added, before the picture is
 * dithered, so it stays smooth and Finish's bloom sees it; Particles is the
 * particles alone and Density how many there are.
 *
 * Two looks: Light adds the particles' light; Ink lays them down as ink on
 * paper (or on Over), dark where they crowd. The Image emitter builds them
 * into the node's own picture, and Release lets them go. Sound (the graph's
 * Audio input, the mic or a Play Audio engine track) sends waves, shocks,
 * crunch, gusts and a jet through them; two hand positions pull and stir them.
 *
 * The node writes no simulation itself: it declares a sampler and, in a
 * comment on it, its settings (a number, or the uniform a slider drives). The
 * engine (play/kit/gpuParticles.js) finds that in the compiled shader in the
 * app (play/gpuParticlesTexture.ts → ShaderCanvas) and in the web runtime,
 * steps and draws the particles before each frame, and binds the result.
 * Sliders stay uniforms, so moving one (or mapping it in Play) never
 * recompiles; the settings fold into sections on the card only (no showWhen),
 * so every one can always be mapped.
 *
 * Sockets: most settings have a socket of the same name, and Obstacle, Flow,
 * Depth and the scene camera take the graph's own values. Those live only in
 * the shader, so the node also writes a probe (#ifdef GPP_PROBE): the hosts
 * compile the graph a second time with it, draw a few pixels (the wired
 * values, read back a frame late) and a small field over the picture (the
 * obstacle, the flow and a scene's depth, sampled on the GPU). See
 * docs/gpu-particles-plan.md.
 */
import type { GraphNode, InputSocket, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { GP_DEFAULTS, GP_MARK, GP_SOCKET_FLOATS, GP_VOL, GP_VOL_TILES, gpProbeSlots, gpProbeSpec } from '../../play/kit/gpuParticles.js';

/** The node's sampler, named by its slug (as its param uniforms are). */
export function gpuParticlesUniform(slug: string): string {
  return `u_gpup_${slug.replace(/_/g, 'x')}`;
}

/** The node's picture (its Image slot): the assembler names it from the slug. */
export function gpuParticlesImageUniform(slug: string): string {
  return `u_tex_${slug}_image`;
}

/** The probe's two steering uniforms: its mode (0 off, 1 values, 2 field) and which value pixel. */
export function gpuParticlesProbeUniforms(slug: string): { m: string; s: string; c: string } {
  const safe = slug.replace(/_/g, 'x');
  return { m: `gpp_m_${safe}`, s: `gpp_s_${safe}`, c: `gpp_c_${safe}` };
}

const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
type Def = Omit<ParamDef, 'section'>;
const sec = (section: string, defs: Record<string, Def>): Record<string, ParamDef> =>
  Object.fromEntries(Object.entries(defs).map(([k, d]) => [k, { ...d, section }]));

const defaults = (): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(GP_DEFAULTS)) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
};

/** A colour param as GLSL: its uniform's name, or the colour itself (baked, a keyframed or odd value). */
function glslColour(v: unknown, fallback: readonly number[]): string {
  if (typeof v === 'string' && /^u_\w+$/.test(v)) return v;
  const c = Array.isArray(v) && v.length >= 3 && v.every(x => typeof x === 'number') ? v as number[] : fallback;
  return `vec3(${c.slice(0, 3).map(x => (+x).toFixed(4)).join(', ')})`;
}

const PARAMS: Record<string, ParamDef> = {
  ...sec('Emit', {
    count: { label: 'Count', type: 'select', hint: 'How many particles.', help: 'How many particles there are. More is denser and finer: 1 million makes threads and haze read; 4 million needs a fast GPU. Sizes shrink a little as the count grows so the cost stays down.', options: opts([['64k', '64 thousand'], ['256k', '256 thousand'], ['1m', '1 million'], ['4m', '4 million']]) },
    emitter: { label: 'Emitter', type: 'select', hint: 'Where particles are born.', help: 'Where particles are born: a point, a line, a ring, a disc, a sphere\'s shell, a ball, a box — or Image: the picture loaded above, every particle given a place on it (see Image threshold and Release). Pairs with Emitter size, Speed and Spread.', options: opts([['point', 'Point'], ['line', 'Line'], ['ring', 'Ring'], ['disk', 'Disc'], ['sphere', 'Sphere'], ['ball', 'Ball'], ['box', 'Box'], ['image', 'Image']]) },
    emit: { label: 'Emit', type: 'select', hint: 'Stream or burst.', help: 'Stream: a steady flow, each particle reborn once it has lived its Life. Burst: all of them at once, again every Life (for fireworks and pops). Burst below fires one by hand.', options: opts([['stream', 'Stream'], ['burst', 'Burst']]) },
    emitSize: { label: 'Emitter size', type: 'float', min: 0, max: 1.5, step: 0.01, hint: 'How big the emitter is.', help: 'How big the emitter is, in half picture heights: 1 reaches the top and bottom. For Image, 1 makes the picture fill the height. Small (0.05) with a stream makes one thread that the currents fold; large fills the frame with dust.' },
    life: { label: 'Life', type: 'float', min: 0.2, max: 20, step: 0.1, hint: 'Seconds a particle lives.', help: 'How long a particle lives, in seconds (each one up to half as much again). Long lives (8–15 s) let the currents draw long threads; short ones (1–3 s) make sparks. With Image, how long a released particle lasts before it comes back to the picture.' },
    speed: { label: 'Speed', type: 'float', min: 0, max: 1, step: 0.005, hint: 'Launch speed.', help: 'How fast particles leave the emitter. Keep it low (0–0.05) with high Drag and Turbulence for smooth ink and smoke; raise it (0.2–1) for sprays and sparks. Negative sends them inwards.' },
    spread: { label: 'Spread', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How varied their directions are.', help: '0: every particle leaves straight out of the emitter (up from a point or line). 1: any direction. A narrow spread with speed makes a fountain or a jet.' },
    threshold: { label: 'Image threshold', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Image: which parts get particles.', help: 'Image emitter: only where the picture is at least this bright (Ink look: at least this dark) gets particles, so a logo on black keeps only the logo. 0: the whole picture, background too.' },
    release: { label: 'Release', type: 'float', min: 0, max: 1, step: 0.005, hint: 'Image: let the particles go.', help: 'Image emitter: 0 holds the picture. Raising it lets the particles go patch by patch, to Gravity, Wind and Turbulence (0.5: half of them). Back to 0 and they fly home and the picture reforms. Map it to a slider, a hand or the sound for a dissolve on cue.' },
    burst: { label: 'Burst', type: 'float', min: 0, max: 1, step: 0.01, hint: 'A trigger: rebirth all at once.', help: 'A trigger. Each time it rises past 0.5 every particle is born again at once (Image: the picture jumps apart and springs back). In Play, route a trigger source (a key, a beat, a pad, an audio hit) to it, or wire a pulse.' },
  }),
  ...sec('Motion', {
    gravity: { label: 'Gravity', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Pulls particles down.', help: 'Pulls particles down (0.1–0.3 for falling dust and a dissolving picture). Negative makes them rise, like sparks or smoke.' },
    wind: { label: 'Wind', type: 'float', min: -1, max: 1, step: 0.01, hint: 'A gusting breeze.', help: 'A breeze to the right (negative: left) that gusts with the turbulence. With high Drag particles drift at the wind\'s speed, like dust in air; 0.2–0.4 blows a released picture away.' },
    turbulence: { label: 'Turbulence', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Curling currents.', help: 'Curling currents (curl noise) that carry the particles in wisps, sheets and threads. Pairs with Turbulence size and Drag: high Drag makes particles follow the currents exactly, which is what draws threads.' },
    scale: { label: 'Turbulence size', type: 'float', min: 0.1, max: 4, step: 0.01, hint: 'How fine the currents are.', help: 'How fine the currents are: below 1 big slow folds (0.5 for ink in water), above 1 small eddies and busy detail.' },
    swirl: { label: 'Swirl', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Spin round the emitter.', help: 'Spins particles round the emitter, strongest near it: a whirlpool or a galaxy. Negative turns the other way.' },
    attract: { label: 'Attract', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Pull to the centre.', help: 'Pulls particles towards the attractor (the centre, or the mouse with Mouse moves). A little (0.05–0.1) keeps a cloud together and makes dark cores; a lot collapses it. Negative pushes them away.' },
    drag: { label: 'Drag', type: 'float', min: 0, max: 4, step: 0.01, hint: 'Air resistance.', help: 'Air resistance. High (2–3) slows particles so they float and follow the currents, like dust or ink; low (0–0.5) lets them fly and overshoot, like sparks.' },
    follow: { label: 'Mouse moves', type: 'select', hint: 'What the mouse moves.', help: 'What the mouse (or a finger) moves: nothing, the emitter, the attractor or the first light. For hands, use the Hands section; for any position, wire the Emitter socket.', options: opts([['none', 'Nothing'], ['emitter', 'Emitter'], ['attractor', 'Attractor'], ['lights', 'A light']]) },
    obstacleMode: { label: 'Obstacle is', type: 'select', hint: 'How to read the Obstacle wire.', help: 'How the Obstacle socket is read. SDF: a shape\'s distance (inside below 0), as the shape nodes give. Mask: a picture, inside where it is brighter than half. Particles slide round the inside and part before they reach it.', options: opts([['sdf', 'SDF (inside < 0)'], ['mask', 'Mask (bright inside)']]) },
    flowForce: { label: 'Flow force', type: 'float', min: -2, max: 2, step: 0.01, hint: 'How hard the Flow wire steers.', help: 'How strongly the Flow socket steers the particles: they climb its slopes (negative: slide down), or with Flow along: round its contours, so a noise or a shape becomes a current.' },
    flowMode: { label: 'Flow along', type: 'select', hint: 'Up the slopes or round them.', help: 'Slope: particles move uphill on the Flow value (towards bright). Around: they circle along its contours, flowing round shapes.', options: opts([['slope', 'Slope'], ['around', 'Around']]) },
    sceneReach: { label: 'Scene size', type: 'float', min: 0.5, max: 10, step: 0.05, hint: 'How far round the centre the Scene is felt.', help: 'With a Scene wired: how far from the centre (in scene units) the particles feel its surfaces. The scene is sampled on a 48-cell grid across twice this, so keep it just big enough to hold the objects: smaller is more precise.' },
  }),
  ...sec('Look', {
    look: { label: 'Look', type: 'select', hint: 'Light or Ink.', help: 'Light: particles glow and their light is added to the picture (black backgrounds). Ink: they are dark ink laid on paper (or on Over), darkest where they crowd: the ink-in-water look.', options: opts([['light', 'Light'], ['ink', 'Ink']]) },
    paper: { label: 'Paper', type: 'vec3color', hint: 'Ink: the background.', help: 'Ink look: the paper behind the ink when Over is unwired.' },
    ink: { label: 'Ink', type: 'vec3color', hint: 'Ink: the ink colour.', help: 'Ink look: the colour of the ink. With the Image emitter the particles take the picture\'s own colours instead.' },
    size: { label: 'Size', type: 'float', min: 0.25, max: 8, step: 0.05, hint: 'Particle size in pixels.', help: 'Particle size in pixels of a 720-pixel-high picture. Fine (0.5–1) for threads and ink; 2–4 for sparks and motes. Capped at 8 for 1M and 3 for 4M.' },
    thread: { label: 'Thread', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Streaks along the motion.', help: 'Draws each particle as a fine streak back along its path, so the flow reads as hair-fine threads. 0: dots. 0.2–0.5 is subtle; more for speed lines.' },
    brightness: { label: 'Brightness', type: 'float', min: 0, max: 4, step: 0.01, hint: 'Light (or ink) per particle.', help: 'How much light (Ink: how much ink) each particle gives. The cloud looks about the same at every count, so change this for the look, not for the count.' },
    palette: { label: 'Colours', type: 'select', hint: 'Light: the colour gradient.', help: 'Light look: the colours a particle runs through, picked by Colour by.', options: opts([['ember', 'Ember'], ['ice', 'Ice'], ['aurora', 'Aurora'], ['neon', 'Neon'], ['gold', 'Gold'], ['mono', 'Mono'], ['rainbow', 'Rainbow']]) },
    colorBy: { label: 'Colour by', type: 'select', hint: 'Light: what picks the colour.', help: 'Light look: what picks a particle\'s colour: its age, its speed (fast ones take the first colour, so a wave or a shock flashes) or its heading.', options: opts([['life', 'Life'], ['speed', 'Speed'], ['heading', 'Heading']]) },
    glow: { label: 'Glow', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Soft bloom (Ink: bleed).', help: 'A soft bloom round the particles, built in (Finish\'s bloom adds to it). In the Ink look it is the ink bleeding into the paper.' },
  }),
  ...sec('Camera', {
    space: { label: 'Space', type: 'select', hint: '2D or 3D.', help: '2D: the particles lie flat on the picture. 3D: they fill space and a camera circles them with depth of field. Wire a March Camera\'s ray origin and direction into Camera from / Camera ray to look through a raymarched scene\'s camera instead.', options: opts([['2d', '2D'], ['3d', '3D']]) },
    camAngle: { label: 'Camera angle', type: 'float', min: -180, max: 180, step: 1, hint: '3D: around the emitter.', help: '3D: where the camera stands round the emitter, in degrees. Drift turns it slowly on top of this.' },
    camTilt: { label: 'Camera tilt', type: 'float', min: -80, max: 80, step: 1, hint: '3D: above or below.', help: '3D: how far above (or below) the emitter the camera looks from, in degrees.' },
    camDistance: { label: 'Camera distance', type: 'float', min: 0.5, max: 8, step: 0.01, hint: '3D: how far away.', help: '3D: how far the camera is from the emitter. Closer (1.5–2.5) puts you inside the cloud, with the near particles blurred into haze.' },
    drift: { label: 'Drift', type: 'float', min: -1, max: 1, step: 0.01, hint: '3D: slow automatic orbit.', help: '3D: the camera slowly circles, bobs and breathes in and out on its own. 0: still. 0.05–0.2 is a gentle drift.' },
    focus: { label: 'Focus', type: 'float', min: 0.2, max: 3, step: 0.01, hint: '3D: where it is sharp.', help: '3D: where the picture is sharp, as a share of the distance to the emitter: 1 the emitter, 0.6 nearer the camera, 1.5 beyond. Pairs with Blur.' },
    blur: { label: 'Blur', type: 'float', min: 0, max: 2, step: 0.01, hint: '3D: depth of field.', help: '3D: depth of field. Out of focus, particles spread into soft discs that keep their light (or ink), so far and near ones become haze or bokeh. It costs no extra fill rate.' },
  }),
  ...sec('Lights', {
    lights: { label: 'Lights', type: 'select', hint: 'Point lights among them.', help: 'Up to four point lights among the particles: particles near one brighten and grow. Off lights them all evenly.', options: opts([['0', 'Off'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]) },
    lightColor: { label: 'Light colour', type: 'vec3color', hint: 'The first light\'s colour.', help: 'The first light\'s colour; the others are its neighbours on the colour wheel.' },
    lightPower: { label: 'Light power', type: 'float', min: 0, max: 6, step: 0.01, hint: 'How bright the lights are.', help: 'How bright the lights are.' },
    lightReach: { label: 'Light reach', type: 'float', min: 0.02, max: 1.5, step: 0.01, hint: 'How far they reach.', help: 'How far a light reaches before it falls to half.' },
    halo: { label: 'Halo', type: 'float', min: 0, max: 3, step: 0.01, hint: 'A glow round each light.', help: 'A glow drawn round each light itself. 0: the lights show only on the particles.' },
    lightMotion: { label: 'Light motion', type: 'select', hint: 'Orbit or still.', help: 'Orbit: the lights circle the emitter. Still: they stand round it.', options: opts([['orbit', 'Orbit'], ['still', 'Still']]) },
  }),
  ...sec('Sound', {
    soundFrom: { label: 'Sound from', type: 'select', hint: 'What the particles listen to.', help: 'What the particles listen to. Graph: the Sound level (and its socket) plus any Audio input node. Mic: the live input (enable it in Play). Audio engine: the Play page\'s engine (its master, or one track), so playing the arrangement drives them with no wiring. Shock, Crunch, Gust and Jet use its bass, treble and hits.', options: opts([['graph', 'Graph (Audio input)'], ['live', 'Mic'], ['master', 'Audio engine'], ['track1', 'Engine track 1'], ['track2', 'Engine track 2'], ['track3', 'Engine track 3'], ['track4', 'Engine track 4'], ['track5', 'Engine track 5'], ['track6', 'Engine track 6'], ['track7', 'Engine track 7'], ['track8', 'Engine track 8']]) },
    sound: { label: 'Sound level', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How loud it is now.', help: 'How loud it is now, added to what Sound from hears. Wire an Audio input\'s amplitude into its socket (one wire), or map it to Live audio in Play.' },
    wave: { label: 'Wave', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Rings travel out with the sound.', help: 'Rings travel out from the emitter, as loud as the sound was when they set off, pushing the particles as they pass: you see the sound travel. Pairs with Wave speed.' },
    waveSpeed: { label: 'Wave speed', type: 'float', min: 0.1, max: 3, step: 0.01, hint: 'How fast the sound travels.', help: 'How fast the rings travel through the particles (picture heights a second, roughly).' },
    vibrate: { label: 'Vibrate', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Shiver where the sound is.', help: 'Particles shiver where the travelling sound reaches them.' },
    shock: { label: 'Shockwave', type: 'float', min: 0, max: 3, step: 0.01, hint: 'A ring on every hit.', help: 'On every beat or hit (a jump in the bass or the level) a ring of pressure blasts out from the emitter and shoves everything it passes. 0.5–1.5 for kicks.' },
    crunch: { label: 'Crunch', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Shake with the sound.', help: 'The air shakes: a fast jitter that follows the level and the treble, like the rumble round a rocket launch. 0.2–0.6 is a buzz; more is violent.' },
    gust: { label: 'Gust', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Currents surge with the level.', help: 'Turbulence surges with the level: louder makes the currents stronger and faster, so the cloud churns on loud passages and settles in quiet ones.' },
    jet: { label: 'Jet', type: 'float', min: 0, max: 3, step: 0.01, hint: 'A rocket exhaust from the emitter.', help: 'A jet roars down out of the emitter, widening and shedding vortices side to side, drawing the air in round it: a rocket\'s exhaust. It always runs a little and roars with the bass.' },
  }),
  ...sec('Hands', {
    hands: { label: 'Hands', type: 'select', hint: 'Points that pull and stir.', help: 'Up to two points that pull and stir the particles: hand tracking, the mouse or anything. Map Hand X / Y in Play (Add as position with Y, then pick a hand), or wire a position into the Hand sockets.', options: opts([['off', 'Off'], ['1', 'One'], ['2', 'Two']]) },
    handX: { label: 'Hand X', type: 'float', min: 0, max: 1, step: 0.001, hint: 'First hand, across.', help: 'The first hand across the picture (0 left, 1 right). In Play: right-click → Add as position with Y, then choose a hand as the source.' },
    handY: { label: 'Hand Y', type: 'float', min: 0, max: 1, step: 0.001, hint: 'First hand, up.', help: 'The first hand up the picture (0 bottom, 1 top).' },
    hand2X: { label: 'Hand 2 X', type: 'float', min: 0, max: 1, step: 0.001, hint: 'Second hand, across.', help: 'The second hand across the picture.' },
    hand2Y: { label: 'Hand 2 Y', type: 'float', min: 0, max: 1, step: 0.001, hint: 'Second hand, up.', help: 'The second hand up the picture.' },
    handForce: { label: 'Hand pull', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Pull (or push).', help: 'Pulls particles to the hands. Negative pushes them away, clearing a hole round each hand.' },
    handSwirl: { label: 'Hand swirl', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Stir round the hands.', help: 'Stirs particles round the hands like a spoon in water. Negative turns the other way.' },
    handReach: { label: 'Hand reach', type: 'float', min: 0.05, max: 1.5, step: 0.01, hint: 'How far a hand reaches.', help: 'How far round a hand its pull and swirl reach.' },
  }),
};

/** Sockets: a float socket for each wireable setting (same key, so the card shows it on the slider), then the rest. */
const INPUTS: Record<string, InputSocket> = {
  over: { type: 'vec3', label: 'Over', hint: 'The picture under the particles. Unwired: black (Light) or the paper (Ink).' },
  uv: { type: 'vec2', label: 'UV', hint: 'Where to read the particles (centred coordinates). Unwired: this pixel. Warp it to bend them.' },
  obstacle: { type: 'float', label: 'Obstacle', hint: 'A shape the particles flow round (an SDF, or a mask: see Obstacle is).' },
  flow: { type: 'float', label: 'Flow', hint: 'A value whose slopes (or contours) steer the particles: a noise, a shape, a picture.' },
  emitAt: { type: 'vec2', label: 'Emitter', hint: 'Where the emitter is (centred coordinates). Unwired: the centre.' },
  hand: { type: 'vec2', label: 'Hand', hint: 'A first hand\'s position (centred coordinates): turns Hands on.' },
  hand2: { type: 'vec2', label: 'Hand 2', hint: 'A second hand\'s position.' },
  camOrigin: { type: 'vec3', label: 'Camera from', hint: '3D: a scene camera\'s ray origin (March Camera ro). With Camera ray, the particles stand in that scene.' },
  camRay: { type: 'vec3', label: 'Camera ray', hint: '3D: the scene camera\'s ray direction (March Camera rd).' },
  depth: { type: 'float', label: 'Depth', hint: '3D: the scene\'s distance along each ray (March Loop dist): particles behind it are hidden.' },
  scene: { type: 'scene3d', label: 'Scene', hint: '3D: the scene the particles collide with: wire the same Scene the March Loop draws, and they slide off its surfaces.' },
  ...Object.fromEntries(GP_SOCKET_FLOATS.map(k => [k, { type: 'float' as const, label: PARAMS[k]?.label ?? k }])),
};

/** Which of the node's sockets are wired, as the engine's probe spec (null: none). */
function probeOf(node: GraphNode) {
  const wired = (k: string) => !!node.inputs[k]?.connection;
  const pu = gpuParticlesProbeUniforms(node.id);
  const spec = gpProbeSpec({
    m: pu.m, s: pu.s,
    f: GP_SOCKET_FLOATS.filter(wired), v2: ['hand', 'hand2', 'emitAt'].filter(wired),
    cam: wired('camOrigin') && wired('camRay'), c: pu.c,
    field: { obstacle: wired('obstacle'), flow: wired('flow'), depth: wired('depth'), scene: wired('scene') },
  });
  const any = spec.f.length || spec.v2.length || spec.cam || spec.field.obstacle || spec.field.flow || spec.field.depth || spec.field.scene;
  return any ? spec : null;
}

export const GpuParticlesNode: NodeDefinition = {
  type: 'gpuParticles',
  label: 'Particles',
  category: 'Particles',
  aliases: ['GPU particles', 'Particle system', 'Glow particles', 'TouchDesigner particles', 'Lights', 'Fireflies', 'Sparks', 'Ink', 'Ink in water', 'Dust', 'Image particles', 'Dissolve', 'Sound particles', 'Rocket', 'Exhaust'],
  description: 'Up to 4 million particles on the GPU, glowing (Light) or laid down as ink (Ink), in 2D or through a drifting 3D camera with depth of field. They can hold a picture and blow away, react to sound and hands, and flow round shapes or stand inside a raymarched scene.',
  brief: {
    summary: 'Up to 4 million particles on the GPU: glowing light or ink on paper, in 2D or 3D with depth of field. They can hold a picture and blow away, react to sound and hands, flow round shapes and stand inside a raymarched scene.',
    start: [
      'Wire Color into the Output (and a picture into Over, if you like).',
      'Pick a preset at the top of the card: Ink in water, Embers, Dust in air, Image dissolve, Sound field, Launch, Hand swirl.',
      'Unfold a section and hover a setting\'s ? for what it does. Most settings have a socket too.',
    ],
  },
  version: 2,
  migrateParams: (params) => {
    // v2 (creative controls): every new setting at its default; the old ones as they were.
    const d = defaults();
    for (const k of Object.keys(d)) if (params[k] === undefined) params[k] = d[k];
    return params;
  },
  inputs: INPUTS,
  // Shown by default: Over, UV, the scene's camera, Depth, Scene, Obstacle and Emitter. Every setting's own
  // socket, the hands and Flow come out from their slider (right-click → Control from outside).
  socketsOnDemand: {
    ...Object.fromEntries(GP_SOCKET_FLOATS.map(k => [k, [k]])),
    hand: ['handX', 'handY'], hand2: ['hand2X', 'hand2Y'], flow: ['flowForce'],
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'Over with the particles on it: their light added (Light), or their ink laid over it (Ink).' },
    particles: { type: 'vec3', label: 'Particles', hint: 'The particles alone: their light with its glow (Light), or their ink on the paper (Ink).' },
    density: { type: 'float', label: 'Density', hint: 'How much the particles cover this pixel (0 where there are none; Ink: 0…1).' },
  },
  textureSlots: ['image'],
  defaultParams: defaults(),
  paramDefs: PARAMS,
  glslFunction: `vec2 gpp_screen(vec2 uv) { return vec2(uv.x * u_resolution.y / u_resolution.x, uv.y) * 0.5 + 0.5; }`,
  declarationsFor: (node: GraphNode) => {
    // node.id is the slug, and a slider's param is the name of its uniform (patchNodeParamsForUniforms).
    const p: Record<string, unknown> = {};
    for (const key of Object.keys(GP_DEFAULTS)) if (node.params[key] !== undefined) p[key] = node.params[key];
    const probe = probeOf(node);
    const cfg: Record<string, unknown> = { p, img: gpuParticlesImageUniform(node.id) };
    const out: string[] = [];
    if (probe) {
      cfg.probe = { m: probe.m, s: probe.s, c: probe.field.scene ? probe.c : undefined, f: probe.f, v2: probe.v2, cam: probe.cam, field: probe.field };
      out.push(`uniform float ${probe.m};`, `uniform float ${probe.s};`);
      if (probe.field.scene) out.push(`uniform vec4 ${probe.c};`);
    }
    out.unshift(`uniform sampler2D ${gpuParticlesUniform(node.id)}; ${GP_MARK}${JSON.stringify(cfg)}`);
    return out;
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv = inputVars.uv ?? 'g_uv';
    const ink = node.params.look === 'ink';
    const lines = [
      `    vec4 ${id}_s = texture2D(${gpuParticlesUniform(id)}, clamp(gpp_screen(${uv}), 0.0, 1.0));\n`,
    ];
    if (ink) {
      // Ink: (ink colour × cover, cover), laid over the picture (or the paper) like ink on a page.
      const paper = glslColour(node.params.paper, GP_DEFAULTS.paper);
      const over = inputVars.over ?? paper;
      lines.push(
        `    float ${id}_density = clamp(${id}_s.a, 0.0, 1.0);\n`,
        `    vec3 ${id}_particles = ${paper} * (1.0 - ${id}_density) + max(${id}_s.rgb, vec3(0.0));\n`,
        `    vec3 ${id}_color = (${over}) * (1.0 - ${id}_density) + max(${id}_s.rgb, vec3(0.0));\n`,
      );
    } else {
      const over = inputVars.over ?? 'vec3(0.0)';
      lines.push(
        `    vec3 ${id}_particles = max(${id}_s.rgb, vec3(0.0));\n`,
        `    float ${id}_density = max(${id}_s.a, 0.0);\n`,
        `    vec3 ${id}_color = ${over} + ${id}_particles;\n`,
      );
    }
    // The probe: compiled only into the hosts' second copy of the shader (GPP_PROBE). Mode 1 writes
    // the wired values a pixel at a time; mode 2 the field over the picture (obstacle, flow, depth).
    const probe = probeOf(node);
    if (probe) {
      const f = (k: string, fb: string) => (inputVars[k] ? `float(${inputVars[k]})` : fb);
      const slots = gpProbeSlots(probe).map(sl => {
        if (sl.kind === 'f') return `vec4(${[0, 1, 2, 3].map(j => (sl.keys && sl.keys[j] ? f(sl.keys[j], '0.0') : '0.0')).join(', ')})`;
        if (sl.kind === 'v2') return `vec4(vec2(${inputVars[sl.key!]}), 0.0, 0.0)`;
        if (sl.kind === 'ro') return `vec4(vec3(${inputVars.camOrigin}), 0.0)`;
        return `vec4(vec3(${inputVars.camRay}), 0.0)`;
      });
      const pick = slots.map((v, i) => `${i === 0 ? '' : 'else '}if (${probe.s} < ${i}.5) gpp_v = ${v};`).join('\n        ');
      // Mode 3: the Scene's distance at each cell of a grid round the centre (slices side by side).
      const sceneFn = inputVars.scene && !/MISSING/.test(inputVars.scene) ? inputVars.scene : null;
      const vol = probe.field.scene && sceneFn ? [
        `      if (${probe.m} > 2.5) {\n`,
        `        ivec2 gpp_q = ivec2(gl_FragCoord.xy);\n`,
        `        vec3 gpp_cell = vec3(float(gpp_q.x % ${GP_VOL}), float(gpp_q.y % ${GP_VOL}), float((gpp_q.y / ${GP_VOL}) * ${GP_VOL_TILES[0]} + gpp_q.x / ${GP_VOL}));\n`,
        `        gpp_v = vec4(${sceneFn}(${probe.c}.xyz + ((gpp_cell + 0.5) / ${GP_VOL}.0 * 2.0 - 1.0) * ${probe.c}.w), 0.0, 0.0, 1.0);\n`,
        `      } else `,
      ].join('') : '      ';
      lines.push(
        '#ifdef GPP_PROBE\n',
        `    if (${probe.m} > 0.5) {\n`,
        `      vec4 gpp_v = vec4(0.0);\n`,
        `${vol}if (${probe.m} > 1.5) gpp_v = vec4(${f('obstacle', '1000.0')}, ${f('flow', '0.0')}, ${f('depth', '1.0e6')}, 1.0);\n`,
        slots.length ? `      else {\n        ${pick}\n      }\n` : '',
        `      gl_FragColor = gpp_v;\n`,
        `      return;\n`,
        `    }\n`,
        '#endif\n',
      );
    }
    return { code: lines.join(''), outputVars: { color: `${id}_color`, particles: `${id}_particles`, density: `${id}_density` } };
  },
};
