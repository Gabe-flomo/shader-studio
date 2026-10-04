/**
 * gpuParticles.js — the Particles node's engine: up to 4M particles simulated
 * and drawn on the GPU, lit by point lights, with a built-in glow, in the
 * graph's picture space (a picture height is 2, x runs ±aspect) or, with
 * Space set to 3D, seen through an orbiting camera with depth of field. See
 * docs/gpu-particles-plan.md.
 *
 * How it works, per frame:
 *   1. Simulate: the state lives in two pairs of float textures, one texel a
 *      particle (pos.xyz + age, vel.xyz + life). One fullscreen pass with two
 *      render targets moves every particle (gravity, wind, curl-noise
 *      turbulence, swirl, an attractor, drag, up to two hands, a sound wave,
 *      a Chladni plate whose nodal lines gather the sand)
 *      and gives birth to the texels in the emission window: a ring
 *      [head, head + n) that walks round the pool, so emitting is a uniform,
 *      not a search. A frame's dt is split into equal substeps of at most
 *      1/60 s; randomness is hashed from the particle's index and the substep
 *      count, so a render is the same every time. The Image emitter gives each
 *      texel a home on the node's picture (a third texture, rebuilt each
 *      frame) that it springs back to until Release lets it go.
 *   2. Draw: one draw call of N points (and, for Thread, N short lines along
 *      the velocity), each reading its state with texelFetch(gl_VertexID),
 *      into a half-float target. Light adds their colour; Ink adds their
 *      absorbance, so dense places go dark on the paper. In 3D a point grows
 *      with its circle of confusion and keeps its total ink, and big ones are
 *      thinned at random (each survivor heavier), so blur costs no fill rate.
 *   3. Glow: the drawn particles at 1/4 and 1/16 size, blurred, added back
 *      (Ink: the ink bleeding into the paper), with each light's halo. The
 *      result is the texture the graph samples, before the picture is
 *      dithered: Light (rgb light, density), Ink (ink colour × cover, cover).
 *
 * Hosts: the app runs it on ShaderCanvas's three.js context (then resets
 * three's state) and binds the result as a THREE.ExternalTexture
 * (play/gpuParticlesTexture.ts); the web runtime runs it on its own WebGL2
 * context. Both find the nodes in the compiled shader (gpBindings) and read
 * the nodes' numbers from their uniforms, so sliders, Play controls and
 * mappings drive it in both. Needs WebGL2 and float or half-float render
 * targets (gpSupport); without them the node passes its picture through.
 *
 * Part of the layer kit: exportHtml.ts inlines it into web exports, so every
 * top-level name keeps the `gp`/`GP_` prefix.
 */

/** Particle counts: the state texture's side for each. */
export const GP_TIERS = { '64k': 256, '256k': 512, '1m': 1024, '4m': 2048 };
/** Emitter shapes, in the order the simulation shader numbers them (image: the node's picture). */
export const GP_SHAPES = ['point', 'line', 'ring', 'disk', 'sphere', 'ball', 'box', 'image'];
/** Colour gradients over 0…1 (life, speed or heading): four stops each, linear light. */
export const GP_PALETTES = {
  ember: [[1.0, 0.86, 0.55], [1.0, 0.45, 0.1], [0.75, 0.12, 0.04], [0.22, 0.02, 0.08]],
  ice: [[0.85, 0.96, 1.0], [0.35, 0.72, 1.0], [0.12, 0.28, 0.95], [0.12, 0.04, 0.4]],
  aurora: [[0.65, 1.0, 0.75], [0.1, 0.9, 0.6], [0.15, 0.4, 1.0], [0.6, 0.15, 0.9]],
  neon: [[1.0, 0.3, 0.85], [0.55, 0.25, 1.0], [0.1, 0.75, 1.0], [0.2, 1.0, 0.6]],
  gold: [[1.0, 0.95, 0.8], [1.0, 0.78, 0.38], [0.85, 0.5, 0.16], [0.35, 0.16, 0.05]],
  mono: [[1.0, 1.0, 1.0], [0.8, 0.82, 0.88], [0.5, 0.52, 0.58], [0.2, 0.2, 0.25]],
  rainbow: null,
};
/**
 * Every setting and its default: the node's defaults (nodes/definitions/gpuParticles.ts).
 * Numbers are clamped to [min, max] when read (gpParams).
 */
export const GP_DEFAULTS = {
  count: '256k', emitter: 'ring', emit: 'stream', follow: 'none',
  emitSize: 0.4, life: 4, speed: 0.08, spread: 0.4, burst: 0, threshold: 0.1, release: 0,
  gravity: 0, wind: 0, turbulence: 0.4, scale: 1, swirl: 0.3, attract: 0, drag: 1.0,
  look: 'light', paper: [0.95, 0.95, 0.94], ink: [0.03, 0.03, 0.04],
  size: 2, thread: 0, brightness: 1, palette: 'ember', colorBy: 'life', glow: 0.45,
  space: '2d', camAngle: 0, camTilt: 12, camDistance: 3, drift: 0.15, focus: 1, blur: 0.35,
  lights: '4', lightColor: [1, 0.55, 0.25], lightPower: 1.6, lightReach: 0.3, halo: 0.5, lightMotion: 'orbit',
  soundFrom: 'graph', sound: 0, wave: 0, waveSpeed: 0.8, vibrate: 0, shock: 0, crunch: 0, gust: 0, jet: 0,
  obstacleMode: 'sdf', flowForce: 1, flowMode: 'slope', sceneReach: 2,
  pattern: 'off', modeFrom: 'sound', symmetry: 'minus', modes: 3, modeN: 3, modeM: 5, plateFreq: 1, plateWeights: 0.5, settle: 1, shake: 0.6,
  hands: 'off', handX: 0.35, handY: 0.5, hand2X: 0.65, hand2Y: 0.5, handForce: 0.8, handSwirl: 0.6, handReach: 0.35,
};
/** The number settings' ranges (physical limits, not the sliders'). */
export const GP_LIMITS = {
  emitSize: [0, 4], life: [0.05, 60], speed: [-10, 10], spread: [0, 1], burst: [0, 1], threshold: [0, 1], release: [0, 1],
  gravity: [-20, 20], wind: [-20, 20], turbulence: [0, 20], scale: [0.05, 20], swirl: [-20, 20], attract: [-20, 20], drag: [0, 20],
  size: [0.1, 32], thread: [0, 4], brightness: [0, 50], glow: [0, 10],
  camAngle: [-1080, 1080], camTilt: [-85, 85], camDistance: [0.3, 40], drift: [-10, 10], focus: [0.05, 10], blur: [0, 4],
  lightPower: [0, 50], lightReach: [0.01, 10], halo: [0, 10],
  sound: [0, 10], wave: [0, 20], waveSpeed: [0.05, 10], vibrate: [0, 20], shock: [0, 20], crunch: [0, 20], gust: [0, 20], jet: [0, 20],
  flowForce: [-20, 20], sceneReach: [0.2, 50],
  modes: [1, 8], modeN: [0, 15], modeM: [0, 15], plateFreq: [0.25, 4], plateWeights: [0, 1], settle: [0, 10], shake: [0, 10],
  handX: [-2, 3], handY: [-2, 3], hand2X: [-2, 3], hand2Y: [-2, 3], handForce: [-20, 20], handSwirl: [-20, 20], handReach: [0.02, 4],
};
const GP_CHOICES = {
  count: Object.keys(GP_TIERS), emitter: GP_SHAPES, emit: ['stream', 'burst'], follow: ['none', 'emitter', 'attractor', 'lights'],
  look: ['light', 'ink'], palette: Object.keys(GP_PALETTES), colorBy: ['life', 'speed', 'heading'], space: ['2d', '3d'],
  lights: ['0', '1', '2', '3', '4'], lightMotion: ['orbit', 'still'], hands: ['off', '1', '2'],
  soundFrom: ['graph', 'live', 'master', 'track1', 'track2', 'track3', 'track4', 'track5', 'track6', 'track7', 'track8'],
  obstacleMode: ['sdf', 'mask'], flowMode: ['slope', 'around'],
  pattern: ['off', 'square', 'circle'], modeFrom: ['sound', 'manual'], symmetry: ['minus', 'plus'],
};

/**
 * One-click looks: each sets every setting (the defaults, then its own), so
 * a preset always looks the same; the hands' positions and the sound level
 * are inputs, left as they are.
 */
export const GP_PRESETS = {
  ink: {
    label: 'Ink in water', hint: 'Dark threads curling through clear water, a drifting camera with a shallow focus.',
    set: {
      count: '1m', emitter: 'ball', emitSize: 0.05, life: 10, speed: 0.04, spread: 1,
      turbulence: 1, scale: 0.55, swirl: 0, attract: 0.08, drag: 2.5, look: 'ink', size: 0.6, thread: 0.25, brightness: 3.5, glow: 0.35,
      space: '3d', camTilt: 10, camDistance: 2.4, drift: 0.12, focus: 1, blur: 0.6, lights: '0',
    },
  },
  embers: {
    label: 'Embers', hint: 'Sparks rising from a ring, lit by orbiting lights.',
    set: { gravity: -0.12, turbulence: 0.55, swirl: 0.2, speed: 0.1, life: 4, size: 2, glow: 0.6, palette: 'ember' },
  },
  dust: {
    label: 'Dust in air', hint: 'Motes floating in a light shaft: slow, weightless, drifting on a breeze, soft out of focus.',
    set: {
      count: '64k', emitter: 'box', emitSize: 1, life: 16, speed: 0.01, spread: 1,
      gravity: 0.01, wind: 0.05, turbulence: 0.22, scale: 0.45, swirl: 0, drag: 2.2,
      size: 2, brightness: 2.2, palette: 'mono', colorBy: 'life', glow: 0.4,
      space: '3d', camTilt: 4, camDistance: 2.2, drift: 0.05, focus: 0.9, blur: 0.9,
      lights: '1', lightColor: [1, 0.82, 0.55], lightPower: 2.5, lightReach: 0.8, halo: 0.25, lightMotion: 'still',
    },
  },
  dissolve: {
    label: 'Image dissolve', hint: 'Load a picture: the particles hold it, then Release blows them away on the wind (back to 0 reforms it).',
    set: {
      count: '256k', emitter: 'image', emitSize: 0.85, threshold: 0.08, release: 0, life: 6, speed: 0, spread: 1,
      gravity: 0.12, wind: 0.35, turbulence: 0.7, scale: 0.8, swirl: 0, drag: 0.9,
      size: 1.6, brightness: 1, glow: 0.15, lights: '0',
    },
  },
  sound: {
    label: 'Sound field', hint: 'A still field of particles that sound ripples through from the centre. Wire an Audio input or map Sound level.',
    set: {
      count: '256k', emitter: 'disk', emitSize: 1.2, life: 4, speed: 0, spread: 1,
      turbulence: 0.04, swirl: 0, drag: 4, size: 1.4, palette: 'aurora', colorBy: 'speed', brightness: 4, glow: 0.45,
      lights: '0', wave: 1.2, waveSpeed: 0.8, vibrate: 0.6, shock: 0.8,
    },
  },
  launch: {
    label: 'Launch', hint: 'A rocket\'s exhaust: a roaring jet that sheds vortices, the air crunching and shock rings on every hit. Pick Sound from (an engine track, the mic) and play.',
    set: {
      count: '1m', emitter: 'box', emitSize: 1.4, life: 12, speed: 0.01, spread: 1,
      gravity: 0, turbulence: 0.35, scale: 0.8, swirl: 0, drag: 1.6, size: 1, brightness: 1.3,
      palette: 'ember', colorBy: 'speed', glow: 0.6, lights: '1', lightColor: [1, 0.6, 0.3], lightPower: 2, lightReach: 0.5, halo: 0.6, lightMotion: 'still',
      soundFrom: 'master', wave: 0.4, vibrate: 0.3, shock: 1.2, crunch: 0.5, gust: 0.6, jet: 1.2,
    },
  },
  chladni: {
    label: 'Chladni sand', hint: 'Sand on a square metal plate: the sound picks the plate\'s modes and the sand gathers on the still lines between them. Pick Sound from, or set Mode from to Manual and turn N and M.',
    set: {
      count: '256k', emitter: 'box', emitSize: 0.85, life: 30, speed: 0, spread: 1,
      turbulence: 0, swirl: 0, drag: 6, size: 1.2, brightness: 1.6, palette: 'gold', colorBy: 'life', glow: 0.25, lights: '0',
      pattern: 'square', modeFrom: 'sound', symmetry: 'minus', modes: 3, modeN: 3, modeM: 5, plateFreq: 1, plateWeights: 0.45, settle: 1.2, shake: 0.7,
    },
  },
  singing: {
    label: 'Singing plate', hint: 'A round plate that sings: its rings and spokes follow the pitch, morphing as the notes change.',
    set: {
      count: '256k', emitter: 'disk', emitSize: 0.88, life: 30, speed: 0, spread: 1,
      turbulence: 0, swirl: 0, drag: 6, size: 1.2, brightness: 1.5, palette: 'ice', colorBy: 'life', glow: 0.5, lights: '0',
      pattern: 'circle', modeFrom: 'sound', symmetry: 'minus', modes: 2, modeN: 4, modeM: 3, plateFreq: 1.5, plateWeights: 0.35, settle: 1.2, shake: 0.6,
    },
  },
  cymatics: {
    label: 'Cymatics bloom', hint: 'Many modes at once on a round plate, high and evenly weighted: lace-like figures that bloom and morph with the music.',
    set: {
      count: '1m', emitter: 'disk', emitSize: 0.88, life: 30, speed: 0, spread: 1,
      turbulence: 0, swirl: 0, drag: 6, size: 0.8, brightness: 2.4, palette: 'neon', colorBy: 'life', glow: 0.9, lights: '0',
      pattern: 'circle', modeFrom: 'sound', symmetry: 'plus', modes: 5, modeN: 6, modeM: 4, plateFreq: 2, plateWeights: 0.85, settle: 2.2, shake: 0.45,
    },
  },
  hands: {
    label: 'Hand swirl', hint: 'Two hands stir the cloud: map Hand X/Y to a hand (Play: Add as position with Y).',
    set: {
      count: '1m', emitter: 'disk', emitSize: 1.2, life: 8, speed: 0.02, spread: 1,
      turbulence: 0.3, swirl: 0, drag: 1.4, size: 1, palette: 'aurora', colorBy: 'speed', glow: 0.45, lights: '2', lightPower: 1.2,
      hands: '2', handForce: 0.9, handSwirl: 1.2, handReach: 0.35,
    },
  },
};
/** Settings a preset leaves alone: they are inputs (a hand, a sound), not a look. */
const GP_PRESET_KEEP = ['handX', 'handY', 'hand2X', 'hand2Y', 'sound'];
/** Presets that pick where they listen; the others keep the node's Sound from. */
const GP_PRESET_SOUND = ['launch'];

/** Every setting a preset gives (the defaults, then the preset's own); null for an unknown name. */
export function gpPreset(name) {
  const pr = GP_PRESETS[name];
  if (!pr) return null;
  const out = {};
  for (const k in GP_DEFAULTS) {
    if (GP_PRESET_KEEP.indexOf(k) >= 0) continue;
    if (k === 'soundFrom' && GP_PRESET_SOUND.indexOf(name) < 0) continue;
    const v = k in pr.set ? pr.set[k] : GP_DEFAULTS[k];
    out[k] = Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

/** Longest a frame's step may be (a stall doesn't fling the particles), and the substep. */
export const GP_MAX_DT = 0.1;
export const GP_SUBSTEP = 1 / 60;
/** Pre-roll on a reset: this much simulated time at most, at 1/30 s steps, so the cloud starts full. */
export const GP_PREROLL = 6;
/** The sound's history: this many levels, one every 1/60 s (about 4 s), so a wave carries the past outwards. */
export const GP_LEVELS = 256;
/** The 3D camera's vertical field of view, in radians. */
export const GP_FOV = 0.8;
/** In 3D, points bigger than this (pixels) are thinned at random, each survivor heavier: blur costs no fill rate. */
export const GP_BLUR_CAP = 7;

/** The marker the node writes in the compiled shader, before its JSON. */
export const GP_MARK = '// gpu-particles ';

/** Side of the state texture for a count tier (256k when unknown). */
export function gpTierSide(tier) {
  return GP_TIERS[tier] || GP_TIERS['256k'];
}

/**
 * The Particles nodes a compiled shader declares: each one's sampler uniform,
 * its settings as the node wrote them (a number, a uniform's name, or a
 * choice) and its picture's sampler. Read from the
 * `uniform sampler2D u_gpup_…; // gpu-particles {…}` lines; each sampler once.
 * `audio` is the graph's first Audio input level, which drives Sound level too.
 */
export function gpBindings(fragmentShader) {
  const out = [], seen = new Set();
  const fs = fragmentShader || '';
  const re = /uniform\s+sampler2D\s+(\w+)\s*;\s*\/\/ gpu-particles (\{[^\n]*\})/g;
  const am = /uniform\s+float\s+(u_audio_\w+)\s*;/.exec(fs);
  // Every band of that same Audio Input (u_audio_<slug>_<band>), low to high as its bands are listed.
  const bands = [];
  if (am) {
    const stem = am[1].replace(/_\d+$/, '');
    const rb = /uniform\s+float\s+(u_audio_\w+?)_(\d+)\s*;/g;
    let mb;
    while ((mb = rb.exec(fs))) if (mb[1] === stem && !bands.some(b => b[1] === +mb[2])) bands.push([mb[1] + '_' + mb[2], +mb[2]]);
    bands.sort((a, b) => a[1] - b[1]);
  }
  let m;
  while ((m = re.exec(fs))) {
    if (seen.has(m[1])) continue;
    let cfg;
    try { cfg = JSON.parse(m[2]); } catch (e) { continue; }
    if (!cfg || typeof cfg !== 'object') continue;
    seen.add(m[1]);
    const pr = cfg.probe && typeof cfg.probe === 'object' ? cfg.probe : null;
    out.push({
      uniform: m[1], params: cfg.p && typeof cfg.p === 'object' ? cfg.p : {},
      image: typeof cfg.img === 'string' ? cfg.img : null, audio: am ? am[1] : null, audioBands: bands.map(b => b[0]),
      probe: pr && typeof pr.m === 'string' && typeof pr.s === 'string' ? gpProbeSpec(pr) : null,
    });
  }
  return out;
}

const gpNum = v => (typeof v === 'number' && isFinite(v) ? v : null);
/** A uniform's value as a number or [r, g, b] (three.js vectors and colours too). */
function gpValue(v) {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    if (typeof v.r === 'number') return [v.r, v.g, v.b];
    if (typeof v.x === 'number') return [v.x, v.y, v.z || 0];
  }
  return null;
}

/**
 * The settings for this frame: each one from the node (a number as it is, a
 * uniform's name through `read`, a choice checked against the list), its
 * default when missing or unreadable (a keyframed number), numbers clamped.
 */
export function gpParams(raw, read) {
  const p = {};
  for (const key in GP_DEFAULTS) {
    const def = GP_DEFAULTS[key];
    let v = raw ? raw[key] : undefined;
    if (GP_CHOICES[key]) {
      p[key] = GP_CHOICES[key].indexOf(String(v)) >= 0 ? String(v) : def;
      continue;
    }
    if (typeof v === 'string' && read && /^u_\w+$/.test(v)) v = gpValue(read(v));
    if (Array.isArray(def)) {
      p[key] = Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(x => gpNum(x) !== null) ? [v[0], v[1], v[2]] : def.slice();
      continue;
    }
    const n = gpNum(v);
    const lim = GP_LIMITS[key];
    p[key] = n === null ? def : lim ? Math.min(lim[1], Math.max(lim[0], n)) : n;
  }
  return p;
}

/**
 * Settings that can come from a wire (a socket of the same name): the value at the centre of the
 * picture, read back once a frame (a frame or two late), so audio, hands, LFOs or any node can
 * drive them. Each is clamped like its slider.
 */
export const GP_SOCKET_FLOATS = [
  'emitSize', 'life', 'speed', 'spread', 'release', 'burst',
  'gravity', 'wind', 'turbulence', 'scale', 'swirl', 'attract', 'drag',
  'size', 'thread', 'brightness', 'glow',
  'camAngle', 'camDistance', 'focus', 'blur',
  'sound', 'wave', 'vibrate', 'shock', 'crunch', 'gust', 'jet', 'handForce', 'handSwirl', 'flowForce',
  'modeN', 'modeM', 'plateFreq', 'plateWeights', 'settle', 'shake',
];
/** Position sockets (the graph's centred coordinates: y ±1, x ±aspect): the two hands and the emitter. */
export const GP_SOCKET_POINTS = ['hand', 'hand2', 'emitAt'];

/** A probe as the node declared it, tidied: which sockets are wired and the uniforms that steer it. */
export function gpProbeSpec(pr) {
  const list = (v, allowed) => (Array.isArray(v) ? v.filter(k => allowed.indexOf(k) >= 0) : []);
  const fl = pr.field && typeof pr.field === 'object' ? pr.field : {};
  return {
    m: pr.m, s: pr.s, c: typeof pr.c === 'string' ? pr.c : null,
    f: list(pr.f, GP_SOCKET_FLOATS), v2: list(pr.v2, GP_SOCKET_POINTS), cam: !!pr.cam,
    field: { obstacle: !!fl.obstacle, flow: !!fl.flow, depth: !!fl.depth, scene: !!fl.scene && typeof pr.c === 'string' },
  };
}

/**
 * The probe's pixels, in order: each says what it holds and where in the picture it is read
 * (dx, dy: 0 at the centre, 1 half a picture right / up: how the camera's rays are measured).
 * Floats go four to a pixel; a point, the camera's origin and each of its three rays one each.
 */
export function gpProbeSlots(spec) {
  const out = [];
  if (!spec) return out;
  for (let i = 0; i < spec.f.length; i += 4) out.push({ kind: 'f', keys: spec.f.slice(i, i + 4), dx: 0, dy: 0 });
  for (const k of spec.v2) out.push({ kind: 'v2', key: k, dx: 0, dy: 0 });
  if (spec.cam) {
    out.push({ kind: 'ro', dx: 0, dy: 0 });
    out.push({ kind: 'rd', dx: 0, dy: 0 }, { kind: 'rd', dx: 1, dy: 0 }, { kind: 'rd', dx: 0, dy: 1 });
  }
  return out;
}

/**
 * A scene's distance on a grid round the emitter (the Scene socket): GP_VOL³ cells, laid out as
 * GP_VOL_TILES[0] × GP_VOL_TILES[1] slices of GP_VOL² in one texture. The simulation reads it
 * (trilinear, by hand) so particles slide off the scene's surfaces everywhere, seen or not.
 */
export const GP_VOL = 48;
export const GP_VOL_TILES = [8, 6];
/** Where a grid cell (x, y, slice) is in the world: the probe's mapping, for the tests. */
export function gpVolPoint(cell, centre, half) {
  return [0, 1, 2].map(i => centre[i] + ((cell[i] + 0.5) / GP_VOL * 2 - 1) * half);
}

/** Does the probe draw a field (obstacle, flow or depth over the picture)? */
export function gpProbeField(spec) {
  return !!spec && (spec.field.obstacle || spec.field.flow || spec.field.depth);
}

/**
 * This frame's settings with the wired ones put in: `values` is the probe's pixels read back
 * (4 floats each, gpProbeSlots order) or null before the first read. Points become the hands
 * (turning Hands on for each one wired) or the emitter; the camera's origin and rays come back
 * as `cam` for gpSceneCamera.
 */
export function gpApplyProbe(P, spec, values, aspect) {
  if (!spec || !values) return { params: P, cam: null, emitAt: null };
  const out = Object.assign({}, P);
  const slots = gpProbeSlots(spec);
  const rays = [];
  let ro = null, emitAt = null, handsWired = 0;
  const to01 = (x, y) => [(x / Math.max(1e-6, aspect) + 1) / 2, (y + 1) / 2];
  slots.forEach((sl, i) => {
    const v = [values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]];
    if (!v.every(x => typeof x === 'number' && isFinite(x))) return;
    if (sl.kind === 'f') sl.keys.forEach((k, j) => { const lim = GP_LIMITS[k]; out[k] = lim ? Math.min(lim[1], Math.max(lim[0], v[j])) : v[j]; });
    else if (sl.kind === 'v2') {
      if (sl.key === 'emitAt') emitAt = [v[0], v[1]];
      else {
        const h = to01(v[0], v[1]);
        if (sl.key === 'hand') { out.handX = h[0]; out.handY = h[1]; handsWired = Math.max(handsWired, 1); }
        else { out.hand2X = h[0]; out.hand2Y = h[1]; handsWired = 2; }
      }
    } else if (sl.kind === 'ro') ro = [v[0], v[1], v[2]];
    else rays.push([v[0], v[1], v[2]]);
  });
  if (handsWired && out.hands === 'off') out.hands = String(handsWired);
  return { params: out, cam: ro && rays.length === 3 ? { ro, rays } : null, emitAt };
}

/**
 * A camera from its eye, its forward / right / up axes and its lens (the picture's half height
 * over the focal length, as 1 / tan(fov / 2)): viewProj column-major, for uniformMatrix4fv.
 */
export function gpCameraFrom(eye, f, r, u, lens, aspect, focusDist) {
  const near = 0.05, far = 100;
  // view (rows r, u, -f; translation -R·eye), then a perspective projection.
  const tx = -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]);
  const ty = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
  const tz = (f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]);
  const V = [r[0], r[1], r[2], tx, u[0], u[1], u[2], ty, -f[0], -f[1], -f[2], tz, 0, 0, 0, 1];
  const A = (far + near) / (near - far), B = 2 * far * near / (near - far);
  const Pm = [lens / aspect, 0, 0, 0, 0, lens, 0, 0, 0, 0, A, B, 0, 0, -1, 0];
  const M = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) M[i * 4 + j] += Pm[i * 4 + k] * V[k * 4 + j];
  const viewProj = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) viewProj[j * 4 + i] = M[i * 4 + j];
  return { viewProj, eye, dist: focusDist, focus: focusDist, lens };
}

const gpNorm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const gpDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The camera of a raymarched scene, from its ray origin and three of its rays (at the centre,
 * half a picture right and half up, in the graph's coordinates): any pinhole camera
 * (rd = normalize(x·right + y·up + focal·forward)) comes back exactly, so the particles stand
 * in the scene. `target` is where the focus and the sizes are measured (the emitter); `focus`
 * is Focus (1: there). Null when the rays make no camera.
 */
export function gpSceneCamera(ro, rays, aspect, target, focus) {
  const f = gpNorm(rays[0]), rx = gpNorm(rays[1]), ry = gpNorm(rays[2]);
  const cx = gpDot(rx, f), cy = gpDot(ry, f);
  if (!(cx > 0.05 && cx < 0.9999) || !(cy > 0.05 && cy < 0.9999)) return null;
  // The up ray is normalize(0.5·up + focal·forward): its slant gives the focal length (graph units).
  const focal = 0.5 / Math.tan(Math.acos(cy));
  const r = gpNorm([rx[0] - cx * f[0], rx[1] - cx * f[1], rx[2] - cx * f[2]]);
  let u = gpNorm([ry[0] - cy * f[0], ry[1] - cy * f[1], ry[2] - cy * f[2]]);
  // Keep the axes square (the up ray may carry a little of the right).
  const ru = gpDot(r, u);
  u = gpNorm([u[0] - ru * r[0], u[1] - ru * r[1], u[2] - ru * r[2]]);
  const to = [target[0] - ro[0], target[1] - ro[1], target[2] - ro[2]];
  const d = Math.max(0.1, gpDot(to, f));
  const cam = gpCameraFrom(ro, f, r, u, focal, aspect, Math.max(0.05, focus * d));
  cam.dist = d;
  return cam;
}

/** A listener: the bands as they are now (smoothed), their slow averages, and the last onset. */
export function gpSoundState() {
  return { level: 0, bass: 0, mid: 0, treble: 0, avg: 0, avgBass: 0, since: 10, onset: 0, hit: 0 };
}

/** dBFS → 0…1 (−80 dB silence, −10 dB loud): the live source's scale (lib/liveAudio.ts). */
function gpDbUnit(db) { return Math.max(0, Math.min(1, (db + 80) / 70)); }
function gpBand(freq, sampleRate, lo, hi) {
  const binHz = sampleRate / 2 / freq.length;
  const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(freq.length - 1, Math.ceil(hi / binHz));
  if (b < a) return 0;
  let sum = 0;
  for (let i = a; i <= b; i++) sum += Math.max(-100, freq[i]);
  return gpDbUnit(sum / (b - a + 1));
}

/**
 * One frame of listening: `input` is a spectrum ({ freq: dB per bin, sampleRate, wave? }), a
 * level ({ level }) or null (silence). Gives level, bass, mid, treble (0…1, quick to rise, slower
 * to fall) and `hit`: 1 on the frame a beat or onset lands (a jump in the bass or the level
 * above its running average, at most ~8 a second), else 0; `onset` is how hard it hit.
 */
export function gpSoundStep(st, input, dt) {
  let level = 0, bass = 0, mid = 0, treble = 0;
  if (input && input.freq && input.sampleRate > 0) {
    const f = input.freq, sr = input.sampleRate;
    bass = gpBand(f, sr, 25, 150);
    mid = (gpBand(f, sr, 150, 600) + gpBand(f, sr, 600, 3000)) / 2;
    treble = gpBand(f, sr, 3000, 12000);
    if (input.wave && input.wave.length) {
      let s2 = 0;
      for (let i = 0; i < input.wave.length; i++) s2 += input.wave[i] * input.wave[i];
      level = gpDbUnit(20 * Math.log10(Math.max(1e-6, Math.sqrt(s2 / input.wave.length))));
    } else level = Math.max(bass, mid, treble);
  } else if (input && typeof input.level === 'number' && isFinite(input.level)) {
    level = bass = mid = treble = Math.max(0, input.level);
  }
  const h = Math.max(0, Math.min(0.25, +dt || 0));
  const follow = (cur, v) => cur + (v - cur) * (1 - Math.exp(-h * (v > cur ? 40 : 8)));
  st.level = follow(st.level, level); st.bass = follow(st.bass, bass); st.mid = follow(st.mid, mid); st.treble = follow(st.treble, treble);
  const flux = Math.max(0, bass - st.avgBass) + 0.6 * Math.max(0, level - st.avg);
  st.avg += (level - st.avg) * (1 - Math.exp(-h * 2.5));
  st.avgBass += (bass - st.avgBass) * (1 - Math.exp(-h * 2.5));
  st.since += h;
  st.hit = 0;
  if (h > 0 && flux > 0.06 && st.since > 0.12) { st.hit = 1; st.onset = Math.min(1, flux * 4); st.since = 0; }
  else st.onset *= Math.exp(-h * 6);
  return st;
}

/**
 * Equal substeps of at most GP_SUBSTEP covering dt (clamped to GP_MAX_DT): { n, h }; n = 0 for no
 * time. At most `max` of them (a big pool takes longer steps rather than more: a slow frame must not
 * make the next one slower still).
 */
export function gpSubsteps(dt, max) {
  const t = Math.min(GP_MAX_DT, Math.max(0, +dt || 0));
  if (t <= 0) return { n: 0, h: 0 };
  const n = Math.min(Math.max(1, max || Infinity), Math.max(1, Math.ceil(t / GP_SUBSTEP - 1e-6)));
  return { n, h: t / n };
}

/** How many substeps a frame may take for a pool of n: fewer for the big ones. */
export function gpMaxSubsteps(n) {
  return n > 1100000 ? 1 : n > 300000 ? 2 : 4;
}

/** A fresh emitter: the ring's head, the fractional births carried over, the burst clock. */
export function gpEmitterState() {
  return { head: 0, carry: 0, clock: 0, burst: -1 };
}

/**
 * This substep's births: the window [start, start + count) of the ring (it
 * wraps), advancing `st`. Stream: the pool turns over once a longest life
 * (count / (life · (1 + lifeVar))), so no particle is reborn while it lives.
 * Burst: the whole pool at once, every longest life.
 */
export function gpEmit(st, mode, n, life, lifeVar, h) {
  const span = Math.max(0.05, life * (1 + lifeVar));
  st.clock += h;
  if (mode === 'burst') {
    // (The clock is a sum of substeps: a hair of slack keeps float error off the boundaries.)
    const k = Math.floor((st.clock - h) / span + 1e-6);
    if (k !== st.burst) { st.burst = k; return { start: 0, count: n }; }
    return { start: 0, count: 0 };
  }
  st.carry += n / span * h;
  const count = Math.min(n, Math.floor(st.carry));
  st.carry -= count;
  const start = st.head;
  st.head = (st.head + count) % n;
  return { start, count };
}

/**
 * Where on the picture particle `i` of a pool of 2^bits lives (Image emitter): a scramble of the index,
 * one to one, so the ring's births (a run of consecutive indices) land all over the picture instead of
 * sweeping it row by row. Odd multipliers and xor-shifts are each invertible mod 2^bits. GP_SCATTER is
 * the same in GLSL.
 */
export function gpScatter(i, bits) {
  const m = bits >= 32 ? 0xffffffff : (2 ** bits) - 1, h = (bits + 1) >> 1;
  let x = (i >>> 0) & m;
  x = (Math.imul(x, 0x9e3779b1) + 0x7f4a7c15) & m;
  x ^= x >>> h;
  x = Math.imul(x, 0x85ebca77) & m;
  x ^= x >>> h;
  x = Math.imul(x, 0xc2b2ae3d) & m;
  x ^= x >>> h;
  return x >>> 0;
}

/** Is particle `i` in the window? (The simulation shader's test, for the tests.) */
export function gpInWindow(i, start, count, n) {
  return ((i - start) % n + n) % n < count;
}

/**
 * A trigger setting (Burst): true once each time it rises through 0.5, so a
 * Play trigger, a key or a beat routed to it fires it. `st` keeps the last value.
 */
export function gpRising(st, key, v) {
  const was = st[key] === undefined ? 0 : st[key];
  st[key] = v;
  return was < 0.5 && v >= 0.5;
}

/** A fresh sound history: the levels, newest first, and the part of a sample carried over. */
export function gpLevelsState() {
  return { levels: new Float32Array(GP_LEVELS), carry: 0 };
}

/**
 * Push this frame's level into the history at 60 a second (newest at 0): a
 * wave samples it by how far it has travelled, so what was heard a moment
 * ago is further out. Returns how many samples went in.
 */
export function gpLevelsPush(st, level, dt) {
  st.carry += Math.max(0, +dt || 0) * 60;
  const k = Math.min(GP_LEVELS, Math.floor(st.carry));
  st.carry -= k;
  if (k > 0) {
    st.levels.copyWithin(k, 0, GP_LEVELS - k);
    st.levels.fill(Math.max(0, +level || 0), 0, k);
  }
  return k;
}

/*
 * Chladni plates (Pattern): sand on a vibrating plate gathers on its nodal lines, where the plate
 * stands still. The plate's displacement is a weighted sum of modes, u = Σ w·φ(n, m), each
 * particle is pushed down |u| towards u = 0 and shaken by how much the plate moves where it is.
 *   Square plate:  φ = cos(nπX)·cos(mπY) ∓ cos(mπX)·cos(nπY), X and Y 0…1 across the plate.
 *   Round plate:   φ = J_n(k·r)·cos(nθ), k putting m still rings inside a free rim (gpPlateWave).
 * The sound picks the modes: its spectrum in GP_PLATE_BANDS bands, low to high; each band names a
 * mode a step further up the plate's modes (ordered by pitch), the loudest weighs most, and the
 * weights glide (gpPlateSmooth) so one figure morphs into the next. Both shapes are the same in GLSL.
 */
/** How many modes the plate sums at most (the shader's array). */
export const GP_PLATE_MAX = 8;
/** The shortest time a figure holds before the sound may change it (seconds): the sand has to settle. */
export const GP_PLATE_HOLD = 2;
/** How many bands the sound is heard in for the plate. */
export const GP_PLATE_BANDS = 8;
/** The Bessel table: J_n for n < GP_BESSEL_N, x in [0, GP_BESSEL_X] at GP_BESSEL_W samples. */
export const GP_BESSEL_N = 16;
export const GP_BESSEL_X = 64;
export const GP_BESSEL_W = 1024;

/**
 * J_n(x), the Bessel function of the first kind, from its integral (1/π)∫₀^π cos(nτ − x·sinτ) dτ.
 * The midpoint rule is exact here to float precision while n + x < 2 × samples (the integrand is a
 * smooth periodic function), so 200 samples cover the table.
 */
export function gpBessel(n, x) {
  const S = 200;
  let sum = 0;
  for (let i = 0; i < S; i++) {
    const t = (i + 0.5) / S * Math.PI;
    sum += Math.cos(n * t - x * Math.sin(t));
  }
  return sum / S;
}

let gpBesselCache = null;
/** The table the shader reads (row n, GP_BESSEL_W samples over [0, GP_BESSEL_X]), built once. */
export function gpBesselTable() {
  if (gpBesselCache) return gpBesselCache;
  const t = new Float32Array(GP_BESSEL_N * GP_BESSEL_W);
  for (let n = 0; n < GP_BESSEL_N; n++) {
    for (let i = 0; i < GP_BESSEL_W; i++) t[n * GP_BESSEL_W + i] = gpBessel(n, i / (GP_BESSEL_W - 1) * GP_BESSEL_X);
  }
  gpBesselCache = t;
  return t;
}

const gpZeroCache = new Map();
/** The m-th positive zero of J_n (m ≥ 1): a round plate's wave number with m rings (its rim one of them). */
export function gpBesselZero(n, m) {
  const key = n * 100 + m;
  if (gpZeroCache.has(key)) return gpZeroCache.get(key);
  let found = 0, x = n === 0 ? 0.05 : n * 0.5 + 0.05, f = gpBessel(n, x), z = NaN;
  while (x < 200) {
    const x2 = x + 0.05, f2 = gpBessel(n, x2);
    if (f * f2 < 0) {
      let a = x, b = x2, fa = f;
      for (let i = 0; i < 40; i++) { const c = (a + b) / 2, fc = gpBessel(n, c); if (fa * fc <= 0) b = c; else { a = c; fa = fc; } }
      if (++found === m) { z = (a + b) / 2; break; }
    }
    x = x2; f = f2;
  }
  gpZeroCache.set(key, z);
  return z;
}

const gpWaveCache = new Map();
/**
 * A round plate's wave number with m rings inside a free rim (n spokes): the first zero of J_n′
 * past the m-th zero of J_n, so J_n(k·r) has m still circles for r < 1 and the rim moves (a real
 * Chladni disc, free at its edge, doesn't hold its sand at the rim). m = 0: spokes only (n ≥ 1).
 */
export function gpPlateWave(n, m) {
  const key = n * 100 + m;
  if (gpWaveCache.has(key)) return gpWaveCache.get(key);
  const dJ = x => (n === 0 ? -gpBessel(1, x) : (gpBessel(n - 1, x) - gpBessel(n + 1, x)) / 2);
  // (J_n′'s first zero is above n: start there, clear of the flat start where J_n′ is ~0.)
  let x = m > 0 ? gpBesselZero(n, m) + 1e-3 : Math.max(0.05, n), f = dJ(x), k = NaN;
  while (x < 200) {
    const x2 = x + 0.05, f2 = dJ(x2);
    if (f * f2 < 0) {
      let a = x, b = x2, fa = f;
      for (let i = 0; i < 40; i++) { const c = (a + b) / 2, fc = dJ(c); if (fa * fc <= 0) b = c; else { a = c; fa = fc; } }
      k = (a + b) / 2;
      break;
    }
    x = x2; f = f2;
  }
  gpWaveCache.set(key, k);
  return k;
}

const gpPeakCache = new Map();
/** The biggest |J_n| up to x = k: a round mode's peak, so every mode weighs what its weight says. */
function gpBesselPeak(n, k) {
  const key = n + ':' + k;
  if (gpPeakCache.has(key)) return gpPeakCache.get(key);
  let pk = 0;
  for (let i = 0; i <= 64; i++) pk = Math.max(pk, Math.abs(gpBessel(n, i / 64 * k)));
  gpPeakCache.set(key, pk || 1);
  return pk || 1;
}

/** A square plate's mode at (x, y) in −1…1 across it: the Chladni formula (sign −1 or +1; n = m adds). */
export function gpChladniSquare(n, m, sign, x, y) {
  const X = (x + 1) / 2 * Math.PI, Y = (y + 1) / 2 * Math.PI;
  const s = n === m ? 1 : sign;
  return Math.cos(n * X) * Math.cos(m * Y) + s * Math.cos(m * X) * Math.cos(n * Y);
}

/** A round plate's mode at (x, y), the rim at radius 1: J_n(k·r)·cos(nθ + turn), m rings inside a free rim (gpPlateWave). */
export function gpChladniCircle(n, m, x, y, turn) {
  return gpBessel(n, gpPlateWave(n, m) * Math.hypot(x, y)) * Math.cos(n * Math.atan2(y, x) + (turn || 0));
}

/**
 * The sound in GP_PLATE_BANDS bands (log-spaced, 80 Hz…5 kHz) from a spectrum ({ freq: dB per bin,
 * sampleRate }): each band's loudest bin, 0…1 above the noise floor, tilted up a little as music is
 * loudest in the bass.
 */
export function gpPlateBands(input) {
  const out = new Array(GP_PLATE_BANDS).fill(0);
  if (!input || !input.freq || !(input.sampleRate > 0)) return out;
  const lo = 80, hi = 5000;
  for (let b = 0; b < GP_PLATE_BANDS; b++) {
    const a = lo * Math.pow(hi / lo, b / GP_PLATE_BANDS), z = lo * Math.pow(hi / lo, (b + 1) / GP_PLATE_BANDS);
    // The band's loudest bin, not its average: a note (one pitch) shows as loud as it is.
    const f = input.freq, binHz = input.sampleRate / 2 / f.length;
    const i0 = Math.max(1, Math.floor(a / binHz)), i1 = Math.min(f.length - 1, Math.max(i0, Math.ceil(z / binHz) - 1));
    let peak = -100;
    for (let i = i0; i <= i1; i++) peak = Math.max(peak, f[i]);
    out[b] = Math.max(0, gpDbUnit(peak) - 0.2) / 0.8 * (1 + 0.08 * b);
  }
  return out;
}

const gpTables = {};
/**
 * The plate's modes ordered by pitch (each a figure), lowest first. Square: (n, m) with n < m and
 * n + m even (the figures symmetric across both centre lines, as on a plate held at its centre), by
 * n² + m² (how a square plate's frequencies go). Round: (n spokes, m rings), by wave number.
 */
export function gpPlateTable(shape) {
  if (gpTables[shape]) return gpTables[shape];
  const out = [];
  if (shape === 'circle') {
    for (let n = 0; n <= 12; n++) for (let m = n === 0 ? 1 : 0; m <= 8; m++) { const k = gpPlateWave(n, m); if (k < 40 && !(n <= 1 && m === 0)) out.push({ n, m, f: k }); }
  } else {
    for (let n = 0; n <= 15; n++) for (let m = n + 2; m <= 15; m += 2) out.push({ n, m, f: n * n + m * m });
  }
  out.sort((a, b) => a.f - b.f || a.n - b.n);
  gpTables[shape] = out;
  return out;
}

/** Where a mode is in the table (square: either order, which has the same lines), or −1. */
function gpPlateIndex(table, shape, n, m) {
  const a = shape === 'circle' ? n : Math.min(n, m), b = shape === 'circle' ? m : Math.max(n, m);
  return table.findIndex(e => e.n === a && e.m === b);
}

/**
 * Can mode `e` join the figure so far without breaking its symmetry? Square: the same parity as the
 * main mode (every term then mirrors the same way across both centre lines). Round: its spokes a
 * multiple of the figure's (rings, n = 0, go with anything), so the figure keeps its n-fold symmetry.
 */
export function gpPlateFits(shape, chosen, e) {
  if (!chosen.length) return true;
  if (shape !== 'circle') return e.n % 2 === chosen[0].n % 2;
  const g = chosen.reduce((acc, c) => (c.n > 0 && (acc === 0 || c.n < acc) ? c.n : acc), 0);
  return e.n === 0 || g === 0 || e.n % g === 0;
}

/** The mode in the table nearest position `at` that fits the figure and isn't in it yet (null: none). */
function gpPlateNear(table, shape, chosen, at) {
  for (let d = 0; d < table.length; d++) {
    for (const i of d ? [at + d, at - d] : [at]) {
      const e = table[i];
      if (e && gpPlateFits(shape, chosen, e) && !chosen.some(c => c.n === e.n && c.m === e.m)) return e;
    }
  }
  return null;
}

/**
 * The modes the plate should sum now: [{ n, m, w }] (weights 0…1, the strongest 1).
 * Manual: N and M (times Frequency), then the next modes up the table that keep its symmetry, each
 * weighing Weights less. Sound (`bands`, low to high): the loudest band picks the main mode (higher
 * bands, higher modes: Frequency spreads them further up), the next loudest add theirs (the nearest
 * modes that keep the symmetry) weighing Weights × how loud they are next to it; a low Weights keeps
 * only the loudest. Modes is how many at most. Null when the sound is silent (the plate keeps its figure).
 */
export function gpPlateTargets(P, shape, bands) {
  const table = gpPlateTable(shape), last = table.length - 1;
  const count = Math.max(1, Math.min(GP_PLATE_MAX, Math.round(P.modes)));
  const out = [];
  if (P.modeFrom === 'manual' || !bands) {
    let n = Math.max(0, Math.round(P.modeN * P.plateFreq)), m = Math.max(0, Math.round(P.modeM * P.plateFreq));
    if (shape === 'circle') { n = Math.min(n, 12); m = Math.max(n === 0 ? 1 : 0, Math.min(m, 8)); }
    else { n = Math.min(n, 15); m = Math.min(m, 15); if (n === m) { if (m < 15) m++; else n--; } }
    out.push({ n, m, w: 1 });
    let at = gpPlateIndex(table, shape, n, m);
    if (at < 0) at = table.findIndex(e => e.f >= (shape === 'circle' ? gpPlateWave(n, m) : n * n + m * m));
    if (at < 0) at = last;
    for (let k = 1; k < count; k++) {
      const e = gpPlateNear(table, shape, out, Math.min(last, at + k));
      if (e) out.push({ n: e.n, m: e.m, w: P.plateWeights * Math.pow(0.8, k - 1) });
    }
    return out;
  }
  const order = bands.map((e, b) => [e, b]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]);
  if (!order.length || order[0][0] < 0.02) return null;
  const top = order[0][0];
  const step = 1.6 * Math.max(0.25, P.plateFreq);
  const sharp = 1 + (1 - P.plateWeights) * 5;
  for (const [e, b] of order) {
    if (out.length >= count) break;
    const w = out.length ? P.plateWeights * Math.pow(e / top, sharp) : 1;
    if (w <= 0.01) break;
    const at = Math.max(0, Math.min(last, Math.round(1 + b * step + (P.plateFreq - 1) * 4)));
    const md = gpPlateNear(table, shape, out, at);
    if (md) out.push({ n: md.n, m: md.m, w });
  }
  return out;
}

/** A plate's figure as it glides: the modes it sums (each with its weight now), the bands heard, the hit count. */
export function gpPlateState() {
  return { modes: [], bands: new Array(GP_PLATE_BANDS).fill(0), step: 0, since: 10, lead: -1, leadSince: 10 };
}

/**
 * One frame of the figure gliding to `targets` (null: hold): each weight follows its target over
 * about half a second, a new mode grows from 0 and an old one fades out, so the figure morphs.
 * `snap` jumps straight there (a fresh start). Keeps the GP_PLATE_MAX heaviest.
 */
export function gpPlateSmooth(st, targets, dt, snap) {
  if (!targets) return st.modes;
  if (snap || !st.modes.length) {
    st.modes = targets.map(t => ({ n: t.n, m: t.m, w: t.w }));
    return st.modes;
  }
  const a = 1 - Math.exp(-Math.max(0, dt) * 2.2);
  for (const md of st.modes) {
    const t = targets.find(x => x.n === md.n && x.m === md.m);
    md.w += ((t ? t.w : 0) - md.w) * a;
  }
  for (const t of targets) if (!st.modes.some(x => x.n === t.n && x.m === t.m)) st.modes.push({ n: t.n, m: t.m, w: t.w * a });
  st.modes = st.modes.filter(md => md.w > 0.004 || targets.some(x => x.n === md.n && x.m === md.m));
  st.modes.sort((x, y) => y.w - x.w);
  if (st.modes.length > GP_PLATE_MAX) st.modes.length = GP_PLATE_MAX;
  return st.modes;
}

/**
 * The bands the plate hears this frame, smoothed (quick to rise, slower to fall), from a spectrum, the
 * graph's Audio Input bands (low to high), or a plain level: with only a level, each hit steps the
 * figure on (a melody of modes) and louder reaches higher, so a beat still makes figures change.
 */
export function gpPlateListen(st, o) {
  let raw;
  if (o.spectrum) raw = gpPlateBands(o.spectrum);
  else if (o.graphBands && o.graphBands.length > 1 && Math.max(...o.graphBands) > 0.02) {
    raw = new Array(GP_PLATE_BANDS).fill(0);
    const g = o.graphBands;
    g.forEach((v, i) => { const b = Math.min(GP_PLATE_BANDS - 1, Math.floor(i * GP_PLATE_BANDS / g.length)); raw[b] = Math.max(raw[b], Math.max(0, +v || 0)); });
  } else {
    // A hit steps the figure on, but not more often than GP_PLATE_HOLD: the sand needs time to settle.
    if (o.hit && st.since >= GP_PLATE_HOLD) { st.step++; st.since = 0; }
    const lv = Math.max(0, +o.level || 0);
    raw = new Array(GP_PLATE_BANDS).fill(0);
    const b = (st.step * 3) % GP_PLATE_BANDS;
    [1, 0, 0.3, 0.75, 0, 0.55, 0.4].forEach((k, j) => { if (k) raw[(b + j) % GP_PLATE_BANDS] = lv * k; });
  }
  const h = Math.max(0, Math.min(0.25, +o.dt || 0));
  st.since += h; st.leadSince += h;
  for (let b = 0; b < GP_PLATE_BANDS; b++) {
    const cur = st.bands[b], v = raw[b];
    st.bands[b] = cur + (v - cur) * (1 - Math.exp(-h * (v > cur ? 12 : 3)));
  }
  // The loudest band leads until another is clearly louder (a fifth more), and not for less than
  // GP_PLATE_HOLD, so two near-equal bands don't flip the figure back and forth.
  let top = 0;
  for (let b = 1; b < GP_PLATE_BANDS; b++) if (st.bands[b] > st.bands[top]) top = b;
  if (st.lead < 0) st.lead = top;
  else if (top !== st.lead && st.bands[top] > st.bands[st.lead] * 1.2 && st.leadSince >= GP_PLATE_HOLD) { st.lead = top; st.leadSince = 0; }
  const out = st.bands.slice();
  out[st.lead] = Math.max(out[st.lead], out[top] * 1.0001);
  return out;
}

/**
 * The modes as the shader takes them: vec4(n, m, k, w) each, w normalised so the sum swings about
 * ±1 (a round mode by its own peak), and k a round mode's wave number.
 */
export function gpPlateUniforms(modes, shape) {
  const v = new Float32Array(GP_PLATE_MAX * 4);
  const total = modes.reduce((s, md) => s + Math.abs(md.w), 0) || 1;
  modes.slice(0, GP_PLATE_MAX).forEach((md, i) => {
    let k = 0, peak = 2;
    if (shape === 'circle') { k = gpPlateWave(md.n, md.n === 0 ? Math.max(1, md.m) : md.m); peak = gpBesselPeak(md.n, k); }
    v.set([md.n, md.m, k, md.w / total / peak], i * 4);
  });
  return { values: v, count: Math.min(GP_PLATE_MAX, modes.length) };
}

/** `rgb` turned round the hue circle by `turns` (luma kept, as a YIQ rotation). */
export function gpHueRotate(rgb, turns) {
  const a = turns * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
  const y = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const i = 0.596 * rgb[0] - 0.274 * rgb[1] - 0.322 * rgb[2];
  const q = 0.211 * rgb[0] - 0.523 * rgb[1] + 0.312 * rgb[2];
  const i2 = i * c - q * s, q2 = i * s + q * c;
  return [
    Math.max(0, y + 0.956 * i2 + 0.621 * q2),
    Math.max(0, y - 0.272 * i2 - 0.647 * q2),
    Math.max(0, y - 1.106 * i2 + 1.703 * q2),
  ];
}

/**
 * Where the emitter, the attractor, the lights and the hands are at `time`,
 * in picture space (3D: on the plane z = 0, the lights bobbing out of it).
 * `mouse` is the pointer in 0…1 of the picture (y up), or null. The lights
 * orbit the emitter (or stand still round it), each the light colour's
 * neighbour on the hue circle (alternately either side, so they stay near
 * it). "Mouse moves" puts one of them (or the emitter, or the attractor)
 * under the pointer. Hands are in 0…1 of the picture too (what a hand
 * tracker gives).
 */
export function gpPlace(p, time, mouse, aspect) {
  const toPic = (x, y) => [(x * 2 - 1) * aspect, y * 2 - 1];
  const m = mouse ? toPic(mouse[0], mouse[1]) : null;
  const emitAt = p.follow === 'emitter' && m ? m : [0, 0];
  const attractAt = p.follow === 'attractor' && m ? m : [0, 0];
  const n = +p.lights || 0, lights = [];
  const R = Math.min(1.2, 0.2 + Math.min(p.emitSize, 1.5) * 0.7);
  const centre = p.follow === 'lights' && m ? m : emitAt;
  const deep = p.space === '3d';
  for (let k = 0; k < n; k++) {
    let x, y, z = 0;
    if (p.follow === 'lights' && m && k === 0) { x = m[0]; y = m[1]; }
    else if (p.lightMotion === 'still') {
      const a = k / n * Math.PI * 2 + Math.PI / 4;
      x = centre[0] + Math.cos(a) * R * 0.8; y = centre[1] + Math.sin(a) * R * 0.8;
    } else {
      const dir = k % 2 ? -1 : 1;
      const a = k / n * Math.PI * 2 + dir * time * (0.32 + 0.09 * k);
      const r = R * (0.75 + 0.3 * Math.sin(time * 0.37 + k * 1.9));
      x = centre[0] + Math.cos(a) * r; y = centre[1] + Math.sin(a) * r * 0.8;
      if (deep) z = Math.sin(a * 1.3 + k) * r * 0.6;
    }
    lights.push({ x, y, z, reach: p.lightReach, power: p.lightPower, colour: gpHueRotate(p.lightColor, (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.05) });
  }
  const nh = p.hands === '2' ? 2 : p.hands === '1' ? 1 : 0;
  const hands = [];
  if (nh > 0) hands.push(toPic(p.handX, p.handY));
  if (nh > 1) hands.push(toPic(p.hand2X, p.hand2Y));
  return { emitAt, attractAt, lights, hands };
}

/**
 * The 3D camera at `time`: it orbits the emitter (Camera angle, plus Drift
 * turning it slowly, with a gentle bob and breathing in and out) at Camera
 * distance, looking at it. Focus is where the picture is sharp, as a share of
 * the distance (1: the emitter). viewProj is column-major, for uniformMatrix4fv.
 */
export function gpCamera(p, time, aspect) {
  const yaw = p.camAngle * Math.PI / 180 + time * p.drift * 0.35;
  const pitch = Math.max(-1.5, Math.min(1.5, p.camTilt * Math.PI / 180 + 0.12 * Math.sin(time * p.drift * 0.23)));
  const dist = p.camDistance * (1 + 0.06 * Math.sin(time * p.drift * 0.17));
  const eye = [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)];
  // A look-at basis: forward to the origin, right, up.
  const f = eye.map(v => -v / dist);
  let r = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r = r.map(v => v / rl);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const cam = gpCameraFrom(eye, f, r, u, 1 / Math.tan(GP_FOV / 2), aspect, Math.max(0.05, p.focus * dist));
  cam.dist = dist;
  return cam;
}

/** Where a point lands: picture space (x ±aspect, y ±1) and its depth from the camera (≤ 0: behind it). */
export function gpProject(cam, xyz, aspect) {
  const m = cam.viewProj, x = xyz[0], y = xyz[1], z = xyz[2];
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 1e-4) return { x: 0, y: 0, depth: cw };
  return { x: cx / cw * aspect, y: cy / cw, depth: cw };
}

/** How bright one particle is, so the cloud looks about as bright at every count and size. */
export function gpUnitBrightness(n, size) {
  const area = Math.max(1, 0.2 * size * size);
  // A little steeper than 1/√n: a big pool piles up more where it is dense.
  return 0.1 * Math.pow(262144 / Math.max(1, n), 0.65) / Math.sqrt(area);
}

/**
 * How much ink one particle lays down (Ink look), so a thread is as dark at
 * every count: an absorbance (the paper shows through as e^−Σ).
 */
export function gpUnitInk(n, size) {
  const area = Math.max(1, 0.25 * size * size);
  return 0.09 * Math.pow(262144 / Math.max(1, n), 0.75) / area;
}

/** Why the engine can't run on `gl` (a sentence for the person), or null when it can. */
export function gpUnsupported(gl) {
  if (!gl || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
    return 'Particles need WebGL2, which this browser does not offer here.';
  }
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
    return 'Particles need float render targets (EXT_color_buffer_float), which this GPU does not offer.';
  }
  return null;
}

/*
 * Shared GLSL pieces (docs/agents-plan.md §11): the engine's forces, sound, plate and look, as
 * small generators that GP_SIM and GP_DRAW_VERT below are written with, and that the Agents
 * group's force and draw nodes (nodes/definitions/agentForces.ts, kit/agentShaders.js) call with
 * their own names. Called with this engine's names they give back its text exactly, which
 * gpEngineShaders.test.ts proves byte for byte: the Particles node never changes because of them.
 */
/** The curl noise's position in noise space: p scaled (2.4 a unit at Size 1) and moved through time. */
export const gpCurlAt = (p, scale, time) => `${p} * 2.4 * ${scale} + vec3(0.0, 0.0, ${time})`;
/** The curl's second octave, read at q (a gpNoised value with its derivatives). */
export const gpCurlOctave2 = q => `gpNoised(${q} * 2.03 + vec3(17.1, 5.3, 31.4))`;
/** Curl in the picture's plane from two octaves a and b (with a little depth in z). */
export const gpCurlPlane = (a, b) => `vec3(${a}.z, -${a}.y, ${a}.w * 0.4) + 0.5 * vec3(${b}.z, -${b}.y, ${b}.w * 0.4)`;
/** The wind's gusts from the first octave: 0.15…1.35 round 0.75. */
export const gpGust = a => `0.75 + 0.6 * ${a}.x`;
/** Swirl round a point: s · the perpendicular of d, strongest at radius √r2 (d from the centre, r its length). */
export const gpSwirl = (s, d, r, r2) => `${s} * vec2(-${d}.y, ${d}.x) / ${r} * (${r} / (${r2} + ${r} * ${r}))`;
/** The attractor's pull: a · g (to it) / r / (0.2 + r): strong near it, falling off far away. */
export const gpAttractPull = (a, g, r) => `${a} * ${g} / ${r} / (0.2 + ${r})`;
/** A hand's reach: a Gaussian of the distance r over Reach. */
export const gpHandFall = (r, reach) => `exp(-${r} * ${r} / (${reach} * ${reach}))`;
/** A hand's push and stir (vec3): Force toward it (less in its core), Swirl round it, times its fall. */
export const gpHandPush = (force, swirl, hd, hr, reach, fall) =>
  `(${force} * ${hd} / ${hr} * min(${hr} / (0.25 * ${reach}), 1.0) * 3.0 + ${swirl} * vec3(-${hd}.y, ${hd}.x, 0.0) / ${hr} * 3.0) * ${fall}`;
/** Flow along a field: the direction dir (its length gl, the slope), the slope's pull capped at 3. */
export const gpFlowPush = (dir, gl, force) => `${dir} / ${gl} * min(${gl}, 3.0) * ${force} * 0.8`;
/** The sound wave's phase at distance r: rings a quarter of a picture apart moving out at speed. */
export const gpWavePhase = (r, time, speed) => `6.2831853 * (${r} * 4.0 - ${time} * ${speed} * 4.0)`;
/** The wave's push along dir (vec3), as loud as the sound was when it set off (lv). */
export const gpWavePush = (dir, wave, lv, ph) => `${dir} * (${wave} * ${lv} * sin(${ph}) * 3.0)`;
/** Vibrate (vec3): a shiver along and across dir, strongest where the wave is. s is a gpRnd state. */
export const gpVibrate = (dir, s, amount, lv, ph) => `(${dir} * (gpRnd(${s}) * 2.0 - 1.0) + 0.5 * gpUnit(${s})) * (${amount} * ${lv} * (0.6 + 0.4 * cos(${ph})) * 14.0)`;
/** Crunch (vec3): the air shaking at random, as hard as amount. */
export const gpCrunch = (s, amount) => `gpUnit(${s}) * (${amount} * 26.0)`;
/** A shock ring's front at distance r, age seconds after the hit: 0 on the front, in ring widths. */
export const gpShockRing = (r, age, speed) => `(${r} - ${age} * ${speed}) / 0.07`;
/** The shock's pressure pulse: out as the front arrives, back behind it, fading with age. */
export const gpShockPush = (d, r, strength, ring, age) => `${d} / ${r} * (${strength} * 16.0 * ${ring} * exp(-${ring} * ${ring}) * exp(-${age} * 1.5))`;
/** The sound heard `ago` seconds back, from a GP_LEVELS × 1 history (60 a second, newest first). `args` adds leading parameters (the history as a sampler). */
export const gpLevelGlsl = (fn, levels, args = '') => `float ${fn}(${args}float ago) {
  float x = clamp(ago * 60.0, 0.0, ${GP_LEVELS - 2}.0);
  int i = int(x);
  return mix(texelFetch(${levels}, ivec2(i, 0), 0).r, texelFetch(${levels}, ivec2(i + 1, 0), 0).r, x - float(i));
}`;
/** J_n(x) from the Bessel table (gpBesselTable), linear between samples. */
export const gpBesselGlsl = (fn, table) => `float ${fn}(float n, float x) {
  float fx = clamp(x / ${GP_BESSEL_X}.0 * ${GP_BESSEL_W - 1}.0, 0.0, ${GP_BESSEL_W - 1}.0 - 0.001);
  int i = int(fx), r = int(n + 0.5);
  return mix(texelFetch(${table}, ivec2(i, r), 0).r, texelFetch(${table}, ivec2(i + 1, r), 0).r, fract(fx));
}`;
/**
 * A Chladni plate's displacement at q (−1…1 across it): the weighted sum of its modes vec4(n, m, k, w).
 * `o` names the shape (1 square, 2 round), the symmetry (1 plus), the mode count and array, and J_n;
 * `o.args` adds parameters after q (the count and the modes, passed in).
 */
export const gpPlateGlsl = (fn, o) => `float ${fn}(vec2 q${o.args ?? ''}) {
  float u = 0.0;
  for (int j = 0; j < ${GP_PLATE_MAX}; j++) {
    if (j >= ${o.count}) break;
    vec4 md = ${o.modes}[j];
    if (${o.shape} == 1) {
      vec2 X = (q * 0.5 + 0.5) * 3.14159265;
      float sg = (${o.sym} == 1 || md.x == md.y) ? 1.0 : -1.0;
      u += md.w * (cos(md.x * X.x) * cos(md.y * X.y) + sg * cos(md.y * X.x) * cos(md.x * X.y));
    } else {
      // Plus turns every other mode by half a lobe, so their spokes interleave.
      float turn = (${o.sym} == 1 && (j & 1) == 1) ? 1.5707963 : 0.0;
      u += md.w * ${o.J}(md.x, md.z * length(q)) * cos(md.x * atan(q.y, q.x + 1e-7) + turn);
    }
  }
  return u;
}`;
/**
 * The sand's step on a plate, as statements (`i` the indent): c (vec2, from the plate's centre) moves
 * down |u| to the nearest still line, never past it, and is shaken by how much the plate moves there;
 * the rim puts it back on. `o` names the plate function (and `o.args`, more arguments after q), its
 * half-size, Settle, Shake, the step, the shape (1 square), the random state.
 */
export const gpPlateStep = (i, o) => `${i}vec2 q = c / ${o.half};
${i}float e = 0.003;
${i}float a0 = ${o.plate}(q${o.args ?? ''});
${i}vec2 gr = vec2(${o.plate}(q + vec2(e, 0.0)${o.args ?? ''}) - a0, ${o.plate}(q + vec2(0.0, e)${o.args ?? ''}) - a0) / e;
${i}float gl = length(gr), aa = abs(a0);
${i}// How far the nearest still line is (plate units), roughly.
${i}float dist = aa / max(gl, 1e-3);
${i}vec2 mv = vec2(0.0);
${i}if (gl > 1e-4) {
${i}  // Down the slope of |u|, never past the line (at most half the way there in a step).
${i}  float sp = min(${o.settle} * 0.9 * min(aa * 10.0, 1.0), 0.5 * dist / max(${o.dt}, 1e-4));
${i}  mv = -sign(a0) * gr / gl * sp * ${o.dt};
${i}}
${i}// The shaking: a random kick as big as the plate moves here, fading to a grain on the lines.
${i}float kick = ${o.shake} * (0.12 * min(dist * 8.0, 1.0) * (0.4 + 0.6 * min(aa * 2.0, 1.0)) + 0.03);
${i}mv += (gpUnit(${o.s}).xy) * kick * sqrt(${o.dt});
${i}q += mv;
${i}// The rim: back onto the plate.
${i}if (${o.shape} == 1) q = clamp(q, -1.0, 1.0) - 2.0 * max(abs(q) - 1.0, 0.0) * sign(q);
${i}else { float rq = length(q); if (rq > 1.0) q *= max(0.0, 2.0 - rq) / rq; }
${i}c = q * ${o.half};`;
/** The colour gradient (four stops, or a rainbow) over 0…1. */
export const gpPaletteGlsl = (fn, rainbow, pal) => `vec3 ${fn}(float t) {
  if (${rainbow} == 1) return clamp(abs(fract(t + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  t = clamp(t, 0.0, 1.0) * 3.0;
  int k = int(min(floor(t), 2.0));
  return mix(${pal}[k], ${pal}[k + 1], t - float(k));
}`;
/** A particle's fade in and out over its life (a = age / life). */
export const gpFade = a => `smoothstep(0.0, 0.06, ${a}) * (1.0 - smoothstep(0.5, 1.0, ${a}))`;
/**
 * The lights on one particle, as statements: L (its light, a dim ambient when there are lights) and
 * near (how close to them it is). Reads P.xyz, u_lights, u_light[4] (x, y, reach, power), u_lightZ,
 * u_lightCol[4] and u_deep (0: flat, the depth ignored).
 */
export const GP_LIGHTS = `  vec3 L = vec3(u_lights > 0 ? 0.22 : 1.0);
  float near = 0.0;
  for (int j = 0; j < 4; j++) {
    if (j >= u_lights) break;
    vec3 d = P.xyz - vec3(u_light[j].xy, u_lightZ[j]);
    if (u_deep == 0) d.z = 0.0;
    float q = dot(d, d) / (u_light[j].z * u_light[j].z);
    float e = u_light[j].w / (1.0 + q);
    L += u_lightCol[j] * e;
    near += e;
  }`;

const GP_QUAD_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const GP_HASH = `
uint gpHash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float gpRnd(inout uint s) { s = gpHash(s); return float(s >> 8) / 16777216.0; }
vec3 gpUnit(inout uint s) { float z = gpRnd(s) * 2.0 - 1.0, a = gpRnd(s) * 6.2831853, r = sqrt(max(0.0, 1.0 - z * z)); return vec3(r * cos(a), r * sin(a), z); }
`;

// Gradient noise with its derivatives (after Inigo Quilez): .x the value, .yzw d/dx, d/dy, d/dz.
const GP_NOISE = `
vec3 gpGrad(vec3 p) {
  uvec3 q = uvec3(ivec3(p) + 32768);
  // One hash, three bytes: a gradient in the unit cube (no trigonometry; this runs 16 times a particle).
  uint h = gpHash(q.x * 73856093u ^ q.y * 19349663u ^ q.z * 83492791u);
  return vec3(uvec3(h, h >> 8, h >> 16) & 255u) / 127.5 - 1.0;
}
vec4 gpNoised(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec3 ga = gpGrad(i), gb = gpGrad(i + vec3(1, 0, 0)), gc = gpGrad(i + vec3(0, 1, 0)), gd = gpGrad(i + vec3(1, 1, 0));
  vec3 ge = gpGrad(i + vec3(0, 0, 1)), gf = gpGrad(i + vec3(1, 0, 1)), gg = gpGrad(i + vec3(0, 1, 1)), gh = gpGrad(i + vec3(1, 1, 1));
  float va = dot(ga, f), vb = dot(gb, f - vec3(1, 0, 0)), vc = dot(gc, f - vec3(0, 1, 0)), vd = dot(gd, f - vec3(1, 1, 0));
  float ve = dot(ge, f - vec3(0, 0, 1)), vf = dot(gf, f - vec3(1, 0, 1)), vg = dot(gg, f - vec3(0, 1, 1)), vh = dot(gh, f - vec3(1, 1, 1));
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va) + u.x * u.y * (va - vb - vc + vd)
    + u.y * u.z * (va - vc - ve + vg) + u.z * u.x * (va - vb - ve + vf) + u.x * u.y * u.z * (-va + vb + vc - vd + ve - vf - vg + vh);
  vec3 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga) + u.x * u.y * (ga - gb - gc + gd)
    + u.y * u.z * (ga - gc - ge + gg) + u.z * u.x * (ga - gb - ge + gf) + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
    + du * (vec3(vb - va, vc - va, ve - va) + u.yzx * vec3(va - vb - vc + vd, va - vc - ve + vg, va - vb - ve + vf)
    + u.zxy * vec3(va - vb - ve + vf, va - vb - vc + vd, va - vc - ve + vg) + u.yzx * u.zxy * (-va + vb + vc - vd + ve - vf - vg + vh));
  return vec4(v, d);
}
`;

// gpScatter in GLSL (the tests check the JS one).
const GP_SCATTER = `
uint gpScatter(uint i, int bits) {
  uint m = (1u << uint(bits)) - 1u, h = uint((bits + 1) >> 1);
  uint x = i & m;
  x = (x * 0x9e3779b1u + 0x7f4a7c15u) & m;
  x ^= x >> h;
  x = (x * 0x85ebca77u) & m;
  x ^= x >> h;
  x = (x * 0xc2b2ae3du) & m;
  x ^= x >> h;
  return x;
}
`;

// Each particle's home on the picture (Image emitter): .xy where on it (0…1), .z 1 when it has one,
// .w when it lets go as Release rises (patches of the picture together, with a little grain).
const GP_HOME = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_img;
uniform int u_side, u_ink, u_bits;
uniform float u_threshold;
out vec4 o;
${GP_HASH}
${GP_NOISE}
${GP_SCATTER}
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  uint s = gpHash(uint(t.y * u_side + t.x) * 2654435761u ^ 0x5bd1e995u);
  // A cell of a grid over the picture, jittered; where that is blank, a few random tries elsewhere.
  // The cell is the particle's index scrambled (one particle a cell still), so the ring's births, a run
  // of indices, scatter over the whole picture rather than sweeping up it row by row.
  uint c = gpScatter(uint(t.y * u_side + t.x), u_bits);
  ivec2 cell = ivec2(int(c % uint(u_side)), int(c / uint(u_side)));
  vec2 uv = (vec2(cell) + vec2(gpRnd(s), gpRnd(s))) / float(u_side);
  float ok = 0.0;
  for (int k = 0; k < 6; k++) {
    vec4 c = textureLod(u_img, uv, 0.0);
    float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    float amount = (u_ink == 1 ? 1.0 - l : l) * c.a;
    if (amount >= u_threshold) { ok = 1.0; break; }
    uv = vec2(gpRnd(s), gpRnd(s));
  }
  float n = gpNoised(vec3(uv * 5.0, 3.7)).x;
  float order = clamp(0.62 * clamp(0.5 + 1.1 * n, 0.0, 1.0) + 0.38 * gpRnd(s), 0.002, 0.998);
  o = vec4(uv, ok, order);
}`;

// How much of the picture gets particles (the Image threshold's test on a 64 × 64 grid), averaged down
// to one texel by GP_DOWN: the particles share that area, so each is as bright as its share.
const GP_COVER = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_img;
uniform int u_ink;
uniform float u_threshold;
out vec4 o;
void main() {
  vec4 c = textureLod(u_img, gl_FragCoord.xy / 64.0, 0.0);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float amount = (u_ink == 1 ? 1.0 - l : l) * c.a;
  o = vec4(amount >= u_threshold ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}`;

const GP_SIM = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_pos;
uniform highp sampler2D u_vel;
uniform highp sampler2D u_home;
uniform highp sampler2D u_levels;
uniform int u_side, u_shape, u_deep, u_image, u_hands;
uniform float u_n, u_start, u_count, u_dt, u_time;
uniform uint u_seed;
uniform vec2 u_emitAt, u_attractAt, u_imgHalf;
uniform float u_emitSize, u_life, u_lifeVar, u_speed, u_spread;
uniform float u_gravity, u_wind, u_turb, u_scale, u_swirl, u_attract, u_drag;
uniform float u_release, u_kick;
uniform vec4 u_hand[2];
uniform float u_handForce, u_handSwirl, u_handReach;
uniform float u_wave, u_waveSpeed, u_vibrate;
uniform float u_noiseTime, u_crunch, u_jet, u_shockSpeed;
uniform vec4 u_shock[4];
// The probe's field over the picture (Obstacle in .r, Flow in .g): 1 sdf / 2 mask, flow 1 slope / 2 around.
uniform highp sampler2D u_field;
uniform int u_obstacle, u_flow;
uniform float u_flowForce, u_aspect;
uniform vec2 u_fieldTexel;
// A scene's distance on a grid (the Scene socket): GP_VOL³ cells in slices, centred on u_volC.xyz, ±u_volC.w.
uniform highp sampler2D u_vol;
uniform int u_volOn;
uniform vec4 u_volC;
// A Chladni plate (Pattern): 1 square, 2 round; its modes vec4(n, m, k, weight); Symmetry 1 is plus.
uniform highp sampler2D u_bessel;
uniform int u_plate, u_plateSym, u_plateN;
uniform float u_plateHalf, u_settle, u_shake;
uniform vec4 u_plateMode[${GP_PLATE_MAX}];
layout(location = 0) out vec4 o_pos;
layout(location = 1) out vec4 o_vel;
${GP_HASH}
${GP_NOISE}
vec3 gpHomeAt(vec2 uv) { return vec3(u_emitAt + (uv * 2.0 - 1.0) * u_imgHalf, 0.0); }
// The scene's distance at a point in grid cells (trilinear: bilinear in a slice, then between two).
float gpVolAt(vec3 q) {
  const float N = ${GP_VOL}.0;
  vec3 g = clamp(q, vec3(0.5), vec3(N - 0.5));
  float z = g.z - 0.5, z0 = floor(z);
  int t0 = int(z0), t1 = min(t0 + 1, ${GP_VOL - 1});
  vec2 size = vec2(${GP_VOL * GP_VOL_TILES[0]}.0, ${GP_VOL * GP_VOL_TILES[1]}.0);
  vec2 a = (vec2(float(t0 % ${GP_VOL_TILES[0]}), float(t0 / ${GP_VOL_TILES[0]})) * N + g.xy) / size;
  vec2 b = (vec2(float(t1 % ${GP_VOL_TILES[0]}), float(t1 / ${GP_VOL_TILES[0]})) * N + g.xy) / size;
  return mix(texture(u_vol, a).r, texture(u_vol, b).r, z - z0);
}
// The sound heard 'ago' seconds back (the history is 60 a second, newest first).
${gpLevelGlsl('gpLevel', 'u_levels')}
// J_n(x) from the table (row n, x over 0…${GP_BESSEL_X}), linear between samples.
${gpBesselGlsl('gpJ', 'u_bessel')}
// The plate's displacement at q (−1…1 across it): the weighted sum of its modes. 0 on the nodal lines.
${gpPlateGlsl('gpPlate', { count: 'u_plateN', modes: 'u_plateMode', shape: 'u_plate', sym: 'u_plateSym', J: 'gpJ' })}
void gpSpawn(float i, vec4 H, out vec4 P, out vec4 V) {
  uint s = gpHash(uint(i) * 1664525u ^ gpHash(u_seed + 1013904223u));
  float life = max(0.05, u_life * (1.0 + u_lifeVar * (gpRnd(s) * 2.0 - 1.0)));
  if (u_shape == 7) {
    // The picture: born at home, still (a picture without a place for this one leaves it unborn).
    P = vec4(gpHomeAt(H.xy) + (gpUnit(s) * 0.002) * vec3(1.0, 1.0, float(u_deep)), 0.0);
    V = vec4(gpUnit(s) * u_speed * 0.3, H.z > 0.5 ? life : 0.0);
    return;
  }
  vec3 p = vec3(0.0), n = vec3(0.0, 1.0, 0.0);
  float a = gpRnd(s) * 6.2831853;
  if (u_shape == 1) { p = vec3(gpRnd(s) * 2.0 - 1.0, 0.0, 0.0); }
  else if (u_shape == 2) { n = vec3(cos(a), sin(a), 0.0); p = n * (1.0 + (gpRnd(s) - 0.5) * 0.04); }
  else if (u_shape == 3) { n = vec3(cos(a), sin(a), 0.0); p = n * sqrt(gpRnd(s)); }
  else if (u_shape == 4) { n = gpUnit(s); p = n; }
  else if (u_shape == 5) { n = gpUnit(s); p = n * pow(gpRnd(s), 1.0 / 3.0); }
  else if (u_shape == 6) { p = vec3(gpRnd(s), gpRnd(s), gpRnd(s)) * 2.0 - 1.0; n = gpUnit(s); }
  // A plate in 3D lies flat (x, z): a disc or a line is born lying on it.
  if (u_plate > 0 && u_deep == 1) { p = p.xzy; n = n.xzy; }
  vec3 dir = normalize(mix(n, gpUnit(s), u_spread) + vec3(0.0, 1e-4, 0.0));
  float sp = u_speed * (0.55 + 0.9 * gpRnd(s));
  // Born at a random point of this substep, so a stream has no stripes.
  float lead = gpRnd(s) * u_dt;
  P = vec4(vec3(u_emitAt, 0.0) + p * u_emitSize + dir * sp * lead, lead);
  V = vec4(dir * sp, life);
}
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  float i = float(t.y * u_side + t.x);
  vec4 P = texelFetch(u_pos, t, 0), V = texelFetch(u_vel, t, 0);
  vec4 H = u_image == 1 ? texelFetch(u_home, t, 0) : vec4(0.0);
  // Held: on the picture, and Release hasn't reached this one yet.
  bool held = u_image == 1 && H.z > 0.5 && H.w >= u_release;
  bool alive = V.w > 0.0 && P.w < V.w;
  if (mod(i - u_start + u_n, u_n) < u_count && !(held && alive)) { gpSpawn(i, H, P, V); o_pos = P; o_vel = V; return; }
  if (!alive) { o_pos = P; o_vel = vec4(0.0); return; }
  uint s = gpHash(uint(i) * 747796405u ^ gpHash(u_seed * 2891336453u + 7u));
  vec3 p = P.xyz, v = V.xyz;
  // The world: gravity, wind, turbulence, swirl, the attractor.
  vec3 f = vec3(0.0, -u_gravity, 0.0);
  float gust = 1.0;
  if (u_turb != 0.0 || u_wind != 0.0) {
    vec3 q = ${gpCurlAt('p', 'u_scale', 'u_noiseTime')};
    vec4 a = gpNoised(q), b = ${gpCurlOctave2('q')};
    vec3 c;
    if (u_deep == 1) {
      // Curl noise in 3D: the cross product of two gradients is divergence-free, so streams fold into
      // sheets and threads instead of bunching up.
      c = cross(a.yzw, b.yzw) * 1.6 + 0.35 * vec3(a.z, -a.y, 0.0);
    } else {
      // In the picture's plane (with a little depth, so it isn't flat).
      c = ${gpCurlPlane('a', 'b')};
    }
    f += c * u_turb;
    gust = ${gpGust('a')};
  }
  f.x += u_wind * gust;
  vec2 d = p.xy - u_emitAt;
  float r = length(d) + 1e-4;
  f.xy += ${gpSwirl('u_swirl', 'd', 'r', '0.25')};
  vec3 g = vec3(u_attractAt, 0.0) - p;
  float ra = length(g) + 1e-4;
  f += ${gpAttractPull('u_attract', 'g', 'ra')};
  // What the person does: hands pull (or push) and stir; a sound wave travels out and shakes them.
  vec3 fx = vec3(0.0);
  for (int j = 0; j < 2; j++) {
    if (j >= u_hands) break;
    vec3 hd = vec3(u_hand[j].xy, 0.0) - p;
    if (u_deep == 0) hd.z = 0.0;
    float hr = length(hd) + 1e-4;
    float fall = ${gpHandFall('hr', 'u_handReach')};
    fx += ${gpHandPush('u_handForce', 'u_handSwirl', 'hd', 'hr', 'u_handReach', 'fall')};
  }
  if (u_wave != 0.0 || u_vibrate != 0.0) {
    vec3 sd = p - vec3(u_emitAt, 0.0);
    float sr = length(sd) + 1e-4;
    vec3 sdir = sd / sr;
    float lv = gpLevel(sr / u_waveSpeed);
    // Rings a quarter of a picture apart, moving out at Wave speed, as loud as the sound was when they set off.
    float ph = ${gpWavePhase('sr', 'u_time', 'u_waveSpeed')};
    fx += ${gpWavePush('sdir', 'u_wave', 'lv', 'ph')};
    // Vibrate: a shiver, strongest where the wave is.
    fx += ${gpVibrate('sdir', 's', 'u_vibrate', 'lv', 'ph')};
  }
  // Shockwaves: a ring of pressure leaves the emitter on each hit and pushes everything it passes.
  for (int j = 0; j < 4; j++) {
    float age = u_time - u_shock[j].z;
    if (u_shock[j].w <= 0.0 || age < 0.0 || age > 3.0) continue;
    vec3 kd = p - vec3(u_shock[j].xy, 0.0);
    if (u_deep == 0) kd.z = 0.0;
    float kr = length(kd) + 1e-4;
    float ring = ${gpShockRing('kr', 'age', 'u_shockSpeed')};
    // A pressure pulse: pushed out as the front arrives, pulled back behind it, so the ring shows and passes
    // on without clearing the middle.
    fx += ${gpShockPush('kd', 'kr', 'u_shock[j].w', 'ring', 'age')};
  }
  // Crunch: the air shakes, harder the louder and brighter the sound.
  if (u_crunch > 0.0) fx += ${gpCrunch('s', 'u_crunch')};
  if (u_jet > 0.0) {
    // A jet (a rocket's exhaust) down from the emitter: fast at its core, widening, shedding vortices
    // side to side as it goes, and drawing the air round it in.
    vec3 jd = p - vec3(u_emitAt, 0.0);
    float along = -jd.y;
    if (along > -0.05) {
      float wdt = 0.04 + max(along, 0.0) * 0.32;
      vec2 side = u_deep == 1 ? jd.xz : vec2(jd.x, 0.0);
      float core = exp(-dot(side, side) / (wdt * wdt)) * exp(-max(along, 0.0) * 0.7);
      float shed = sin(along * 13.0 - u_time * 17.0);
      fx += u_jet * core * vec3(shed * 5.0 - jd.x * 6.0, -9.0, u_deep == 1 ? cos(along * 11.0 - u_time * 15.0) * 5.0 - jd.z * 6.0 : 0.0);
      fx += gpUnit(s) * (u_jet * core * 8.0);
    }
  }
  if (u_kick > 0.0) {
    // Burst on a picture: everything jumps out from the centre (held ones spring back).
    vec3 kd = p - vec3(u_emitAt, 0.0);
    v += (normalize(kd + 1e-4) * (0.4 + gpRnd(s)) + 0.6 * gpUnit(s)) * u_kick;
  }
  float age = P.w + u_dt;
  if (held) {
    // A critically damped spring to its home; the world only shimmers it, the person still moves it.
    vec3 home = gpHomeAt(H.xy);
    float k = 90.0;
    v += ((home - p) * k - v * (2.0 * sqrt(k)) + f * 0.04 + fx) * u_dt;
    // A held particle doesn't age (one coming back to the picture grows young again, so it shows).
    age = mix(P.w, 0.25 * V.w, 1.0 - exp(-2.0 * u_dt));
  } else {
    v += (f + fx) * u_dt;
    v *= exp(-u_drag * u_dt);
  }
  // A picture's field (the probe): flow along (or round) its slopes; an obstacle the particles slide off.
  if (u_obstacle > 0 || u_flow > 0) {
    vec2 fuv = vec2(p.x / u_aspect, p.y) * 0.5 + 0.5;
    if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
      vec2 tx = vec2(u_fieldTexel.x, 0.0), ty = vec2(0.0, u_fieldTexel.y);
      vec4 c = texture(u_field, fuv);
      vec4 gx = texture(u_field, fuv + tx) - texture(u_field, fuv - tx);
      vec4 gy = texture(u_field, fuv + ty) - texture(u_field, fuv - ty);
      // Slopes per picture unit (a texel is u_fieldTexel·2 units across in y, ·2·aspect in x).
      vec2 k = 1.0 / (4.0 * u_fieldTexel * vec2(u_aspect, 1.0));
      if (u_flow > 0) {
        vec2 gr = vec2(gx.g, gy.g) * k;
        float gl = length(gr);
        if (gl > 1e-5) {
          vec2 dir = u_flow == 2 ? vec2(-gr.y, gr.x) : gr;
          v.xy += ${gpFlowPush('dir', 'gl', 'u_flowForce')} * u_dt;
        }
      }
      if (u_obstacle > 0) {
        // Signed distance: an SDF as it is (inside < 0); a mask (inside > 0.5) as a rough one.
        float dd = u_obstacle == 1 ? c.r : (0.5 - c.r) * 0.1;
        vec2 gr = (u_obstacle == 1 ? vec2(gx.r, gy.r) : -vec2(gx.r, gy.r) * 0.1) * k;
        float gl = length(gr);
        vec2 n = gl > 1e-6 ? gr / gl : vec2(0.0);
        float margin = 0.012;
        if (dd < margin && gl > 1e-6) {
          // Out to the surface, the inward part of the velocity gone, a little friction: they slide round it.
          p.xy += n * (margin - dd);
          float vn = dot(v.xy, n);
          if (vn < 0.0) v.xy -= vn * n;
          v.xy *= 0.97;
        } else if (dd < 0.08 && gl > 1e-6) {
          // A cushion just outside, so a stream parts before it touches.
          v.xy += n * (0.08 - dd) * 6.0 * u_dt;
        }
      }
    }
  }
  // A scene (the Scene socket): out of its surfaces, sliding along them, parting just before them.
  if (u_volOn == 1) {
    vec3 q = ((p - u_volC.xyz) / u_volC.w * 0.5 + 0.5) * ${GP_VOL}.0;
    if (all(greaterThan(q, vec3(0.0))) && all(lessThan(q, vec3(${GP_VOL}.0)))) {
      float dd = gpVolAt(q);
      if (dd < 0.15) {
        vec3 gr = vec3(gpVolAt(q + vec3(1, 0, 0)) - gpVolAt(q - vec3(1, 0, 0)), gpVolAt(q + vec3(0, 1, 0)) - gpVolAt(q - vec3(0, 1, 0)),
          gpVolAt(q + vec3(0, 0, 1)) - gpVolAt(q - vec3(0, 0, 1)));
        float gl = length(gr);
        if (gl > 1e-6) {
          vec3 n = gr / gl;
          float margin = 0.015;
          if (dd < margin) {
            p += n * (margin - dd);
            float vn = dot(v, n);
            if (vn < 0.0) v -= vn * n;
            v *= 0.97;
          } else v += n * (0.15 - dd) * 5.0 * u_dt;
        }
      }
    }
  }
  p += v * u_dt;
  if (u_plate > 0) {
    // A Chladni plate: sand slides down |u| to the nodal lines (u = 0), where the plate stands still, and
    // is shaken by how much the plate moves where it lies, so it can't rest anywhere else. In 3D the plate
    // lies flat (x, z) at the emitter's height and the sand settles onto it.
    vec2 c = u_deep == 1 ? vec2(p.x - u_emitAt.x, p.z) : p.xy - u_emitAt;
${gpPlateStep('    ', { half: 'u_plateHalf', plate: 'gpPlate', settle: 'u_settle', shake: 'u_shake', dt: 'u_dt', shape: 'u_plate', s: 's' })}
    // The sand's own flight dies away fast on the plate.
    v *= exp(-6.0 * u_dt);
    if (u_deep == 1) { p.x = u_emitAt.x + c.x; p.z = c.y; p.y += (u_emitAt.y - p.y) * (1.0 - exp(-8.0 * u_dt)); }
    else { p.xy = u_emitAt + c; p.z *= exp(-4.0 * u_dt); }
  }
  o_pos = vec4(p, age);
  o_vel = vec4(v, V.w);
}`;

const GP_DRAW_VERT = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_pos;
uniform highp sampler2D u_vel;
uniform highp sampler2D u_home;
uniform highp sampler2D u_img;
uniform highp sampler2D u_cover;
uniform int u_side, u_prim, u_deep, u_ink, u_image;
uniform float u_aspect, u_size, u_bright, u_px, u_speed, u_thread, u_part;
uniform mat4 u_viewProj;
uniform vec3 u_eye;
uniform float u_camDist, u_focus, u_coc, u_cap;
uniform vec2 u_emitAt;
uniform vec3 u_inkCol;
uniform vec3 u_pal[4];
uniform int u_rainbow, u_colorBy, u_lights;
uniform vec4 u_light[4];
uniform vec4 u_lightZ;
uniform vec3 u_lightCol[4];
out vec4 v_col;
out float v_dist;
${GP_HASH}
${gpPaletteGlsl('gpPalette', 'u_rainbow', 'u_pal')}
void gpCull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_col = vec4(0.0); v_dist = 0.0; }
void main() {
  // Points: one vertex a particle. Thread: two, its head and a tail back along its velocity.
  int id = u_prim == 1 ? gl_VertexID >> 1 : gl_VertexID;
  int end = u_prim == 1 ? (gl_VertexID & 1) : 0;
  ivec2 t = ivec2(id % u_side, id / u_side);
  vec4 P = texelFetch(u_pos, t, 0), V = texelFetch(u_vel, t, 0);
  if (V.w <= 0.0 || P.w >= V.w) { gpCull(); return; }
  float a = P.w / V.w;
  float fade = ${gpFade('a')};
  vec3 c;
  if (u_image == 1) c = textureLod(u_img, texelFetch(u_home, t, 0).xy, 0.0).rgb;
  else if (u_ink == 1) c = u_inkCol;
  else {
    float k = a;
    if (u_colorBy == 1) k = 1.0 - clamp(length(V.xyz) / max(0.05, 2.5 * abs(u_speed) + 0.25), 0.0, 1.0);
    else if (u_colorBy == 2) k = fract(atan(V.y, V.x) / 6.2831853 + 0.5);
    c = gpPalette(k);
  }
${GP_LIGHTS}
  vec3 pos = P.xyz - V.xyz * (u_thread * float(end));
  float s = u_size * u_px * (1.0 + 0.35 * min(near, 4.0));
  float w = fade * u_bright * u_part;
  // On a picture, each particle's share of it: the area that gets particles, over how many there are.
  if (u_image == 1) w *= max(texelFetch(u_cover, ivec2(0), 0).r, 0.01);
  vec4 clip;
  v_dist = 0.0;
  if (u_deep == 1) {
    v_dist = length(pos - u_eye);
    clip = u_viewProj * vec4(pos, 1.0);
    float z = clip.w;
    if (z < 0.06) { gpCull(); return; }
    s *= u_camDist / z;
    // Depth of field: the circle of confusion. The point grows to it and keeps its ink, so out of focus is haze.
    float coc = u_coc * abs(z - u_focus) / z;
    float se = max(s, coc);
    float sharp = 1.0 / (1.0 + coc * coc * 0.25);
    // Thread draws the sharp share as lines and this (the points pass) the blurred share.
    // (A share too small to see isn't drawn at all: each pass skips what the other one carries.)
    float share = u_prim == 1 ? sharp : u_thread > 0.0 ? 1.0 - sharp : 1.0;
    if (share < 0.04) { gpCull(); return; }
    w *= share;
    w *= max(s * s, 1.0) / max(se * se, 1.0);
    if (u_prim == 0 && se > u_cap) {
      float keep = (u_cap * u_cap) / (se * se);
      uint hs = gpHash(uint(id) * 2246822519u + 3266489917u);
      if (float(hs >> 8) / 16777216.0 > keep) { gpCull(); return; }
      w /= keep;
    }
    // Very near the lens a particle fades rather than filling the screen.
    w *= smoothstep(0.06, 0.4, z);
    s = se;
  } else {
    clip = vec4(pos.x / u_aspect, pos.y, 0.0, 1.0);
    s *= clamp(1.0 + 0.3 * pos.z, 0.5, 1.8);
  }
  gl_PointSize = clamp(s, 1.0, 64.0);
  // A point smaller than a pixel still covers one: its light (ink) goes down with its area instead.
  w *= u_prim == 1 ? 1.0 : min(1.0, s * s);
  v_col = u_ink == 1 ? vec4(c * L * w, w * (L.r + L.g + L.b) / 3.0) : vec4(c * L * w, 0.06);
  gl_Position = clip;
}`;

const GP_DRAW_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform int u_prim, u_depth;
uniform highp sampler2D u_field;
uniform vec2 u_viewSize;
in vec4 v_col;
in float v_dist;
out vec4 o;
void main() {
  // A scene's depth (the probe's .b, the distance along each pixel's ray): behind it, hidden.
  if (u_depth == 1 && v_dist > texture(u_field, gl_FragCoord.xy / u_viewSize).b) discard;
  float g = 1.0;
  if (u_prim == 0) {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    g = exp(-r2 * 3.0);
  }
  o = v_col * g;
}`;

// A 4× smaller copy (each texel the mean of a 4×4 block, from four bilinear taps).
const GP_DOWN = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_texel;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * 4.0 * u_texel;
  o = 0.25 * (texture(u_src, uv + u_texel * vec2(-1.0, -1.0)) + texture(u_src, uv + u_texel * vec2(1.0, -1.0))
    + texture(u_src, uv + u_texel * vec2(-1.0, 1.0)) + texture(u_src, uv + u_texel * vec2(1.0, 1.0)));
}`;

// A 9-tap Gaussian along u_dir, in five bilinear fetches.
const GP_BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_dir;
uniform vec2 u_size;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_size, s = u_dir / u_size;
  o = texture(u_src, uv) * 0.2270270270
    + (texture(u_src, uv + s * 1.3846153846) + texture(u_src, uv - s * 1.3846153846)) * 0.3162162162
    + (texture(u_src, uv + s * 3.2307692308) + texture(u_src, uv - s * 3.2307692308)) * 0.0702702703;
}`;

const GP_COMPOSE = `#version 300 es
precision highp float;
uniform sampler2D u_acc;
uniform sampler2D u_g1;
uniform sampler2D u_g2;
uniform vec2 u_size;
uniform float u_aspect, u_glow, u_halo;
uniform int u_lights, u_ink;
uniform vec4 u_light[4];
uniform vec3 u_lightCol[4];
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec4 acc = texture(u_acc, uv);
  if (u_ink == 1) {
    // Ink: the absorbance (and the bleed round it) dims the paper as e^-Σ, and what shows is the ink's
    // own colour, weighted by how much of each lies here. Premultiplied: (ink · cover, cover).
    vec4 a = acc + u_glow * (0.35 * texture(u_g1, uv) + 0.5 * texture(u_g2, uv));
    float cover = 1.0 - exp(-max(a.a, 0.0));
    vec3 ink = a.rgb / max(a.a, 1e-5);
    o = vec4(ink * cover, cover);
    return;
  }
  vec3 c = acc.rgb + u_glow * (0.6 * texture(u_g1, uv).rgb + 1.1 * texture(u_g2, uv).rgb);
  vec2 q = (uv * 2.0 - 1.0) * vec2(u_aspect, 1.0);
  for (int j = 0; j < 4; j++) {
    if (j >= u_lights) break;
    vec2 d = q - u_light[j].xy;
    float r = u_light[j].z * 0.22;
    float e = dot(d, d) / (r * r);
    c += u_lightCol[j] * u_light[j].w * u_halo * (0.08 / (1.0 + e) + 0.6 * exp(-e * 2.0));
  }
  o = vec4(c, acc.a);
}`;

/**
 * The engine's GLSL, as the shared chunks other engines reuse (the Agents
 * group's Draw agents: docs/agents-plan.md). Exported as they are: the strings
 * above are never edited for a second user, and gpEngineShaders.test.ts
 * snapshots every one, so a change to any of them shows up as a failing test.
 */
export const GP_SHADERS = {
  GP_QUAD_VERT, GP_HASH, GP_NOISE, GP_SCATTER, GP_HOME, GP_COVER, GP_SIM,
  GP_DRAW_VERT, GP_DRAW_FRAG, GP_DOWN, GP_BLUR, GP_COMPOSE,
};

/**
 * One particle system on `gl`, or null where it can't run (gpUnsupported says
 * why, or a shader didn't compile). `frame` steps it by dt and draws it at
 * width × height; it returns the texture to sample (RGBA16F, linear, row 0
 * at the bottom), or null. It leaves the context's bindings as it found
 * them, except that a three.js host must still call renderer.resetState().
 */
/**
 * The blend function and equation, clear colour and colour mask of a context,
 * without asking GL. Chromium answers those getParameter calls with a round
 * trip to the GPU process (about 40 µs each, eight of them a frame here), so
 * their setters on this context are wrapped once to remember what was set,
 * starting from one real read. Read again after a lost context comes back.
 */
const gpShadows = new WeakMap();
export function gpStateShadow(gl) {
  let s = gpShadows.get(gl);
  if (s) return s;
  s = {};
  const read = () => {
    s.bsrc = gl.getParameter(gl.BLEND_SRC_RGB); s.bdst = gl.getParameter(gl.BLEND_DST_RGB);
    s.basrc = gl.getParameter(gl.BLEND_SRC_ALPHA); s.badst = gl.getParameter(gl.BLEND_DST_ALPHA);
    s.beq = gl.getParameter(gl.BLEND_EQUATION_RGB); s.beqa = gl.getParameter(gl.BLEND_EQUATION_ALPHA);
    const c = gl.getParameter(gl.COLOR_CLEAR_VALUE), m = gl.getParameter(gl.COLOR_WRITEMASK);
    s.clear = c ? [c[0], c[1], c[2], c[3]] : [0, 0, 0, 0];
    s.mask = m ? [m[0], m[1], m[2], m[3]] : [true, true, true, true];
  };
  read();
  const wrap = (name, after) => {
    const f = gl[name];
    if (typeof f !== 'function') return;
    gl[name] = function () { const r = f.apply(gl, arguments); after.apply(null, arguments); return r; };
  };
  wrap('blendFunc', (a, b) => { s.bsrc = s.basrc = a; s.bdst = s.badst = b; });
  wrap('blendFuncSeparate', (a, b, c, d) => { s.bsrc = a; s.bdst = b; s.basrc = c; s.badst = d; });
  wrap('blendEquation', m => { s.beq = s.beqa = m; });
  wrap('blendEquationSeparate', (a, b) => { s.beq = a; s.beqa = b; });
  wrap('clearColor', (r, g, b, a) => { s.clear = [r, g, b, a]; });
  wrap('colorMask', (r, g, b, a) => { s.mask = [!!r, !!g, !!b, !!a]; });
  try { if (gl.canvas && gl.canvas.addEventListener) gl.canvas.addEventListener('webglcontextrestored', read); } catch (e) { /* no events */ }
  gpShadows.set(gl, s);
  return s;
}

export function gpCreate(gl) {
  if (gpUnsupported(gl)) return null;
  const f32 = !!gl.getExtension('EXT_color_buffer_float');
  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      if (typeof console !== 'undefined') console.warn('[gpuParticles] shader did not compile', gl.getShaderInfoLog(s));
      gl.deleteShader(s); return null;
    }
    return s;
  };
  const link = (vsSrc, fsSrc) => {
    const vs = compile(gl.VERTEX_SHADER, vsSrc), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) { if (vs) gl.deleteShader(vs); if (fs) gl.deleteShader(fs); return null; }
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      if (typeof console !== 'undefined') console.warn('[gpuParticles] program did not link', gl.getProgramInfoLog(p));
      gl.deleteProgram(p); return null;
    }
    const u = {}, count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };
  const progs = {
    sim: link(GP_QUAD_VERT, GP_SIM), draw: link(GP_DRAW_VERT, GP_DRAW_FRAG), down: link(GP_QUAD_VERT, GP_DOWN),
    blur: link(GP_QUAD_VERT, GP_BLUR), compose: link(GP_QUAD_VERT, GP_COMPOSE), home: link(GP_QUAD_VERT, GP_HOME),
    cover: link(GP_QUAD_VERT, GP_COVER),
  };
  if (Object.values(progs).some(x => !x)) { for (const x of Object.values(progs)) if (x) gl.deleteProgram(x.p); return null; }
  const vao = gl.createVertexArray();
  const fbo = gl.createFramebuffer();
  const stateFormat = f32 ? [gl.RGBA32F, gl.FLOAT] : [gl.RGBA16F, gl.HALF_FLOAT];

  const tex = (internal, type, filter, w, h, format) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format || gl.RGBA, type, null);
    return t;
  };
  const attach = (a, b) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b || null, 0);
    gl.drawBuffers(b ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0]);
  };
  const clear = () => { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); };

  // The state: [pos, vel] read, [pos, vel] written, swapped each substep; the homes on the picture.
  let side = 0, state = null, home = null, broken = false;
  // The look: the drawn particles, two glow levels (each with a scratch for the blur), the result.
  let W = 0, H = 0, look = null;
  let emitter = gpEmitterState(), seed = 0, lastTime = NaN, needPreroll = true, pendingReset = false;
  // The sound's history (a 256 × 1 float texture, newest first), and the triggers' last values.
  const levelsTex = tex(gl.R32F, gl.FLOAT, gl.NEAREST, GP_LEVELS, 1, gl.RED);
  let levels = gpLevelsState();
  const edges = {};
  let kick = 0, burstNow = false;
  // Listening (gpSoundStep), the shock rings in flight, and the currents' own clock (gusts speed it up).
  let sound = gpSoundState(), shocks = [], noiseClock = 0;
  // A 1 × 1 stand-in for a missing picture.
  const blankTex = tex(gl.RGBA8, gl.UNSIGNED_BYTE, gl.NEAREST, 1, 1);
  // The plate (Pattern): its figure gliding between modes, and J_n for the round plate (filled when first needed).
  let plate = gpPlateState(), plateShape = '', besselTex = null;
  // The picture's cover, 64² → 16² → 4² → 1².
  const coverTex = [64, 16, 4, 1].map(n => ({ t: tex(gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR, n, n), w: n, h: n }));

  const freeState = () => { if (state) for (const t of state.flat()) gl.deleteTexture(t); if (home) gl.deleteTexture(home); state = null; home = null; side = 0; };
  const freeLook = () => { if (look) for (const k in look) gl.deleteTexture(look[k].t); look = null; W = H = 0; };

  const ensureState = s => {
    if (s === side && state) return true;
    freeState();
    const mk = () => tex(stateFormat[0], stateFormat[1], gl.NEAREST, s, s);
    state = [[mk(), mk()], [mk(), mk()]];
    home = mk();
    side = s;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (const pair of state) {
      attach(pair[0], pair[1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { freeState(); return false; }
      gl.viewport(0, 0, s, s); clear();
    }
    emitter = gpEmitterState(); seed = 0; needPreroll = true;
    return true;
  };
  const ensureLook = (w, h) => {
    if (look && w === W && h === H) return true;
    freeLook();
    const q1 = [Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4))];
    const q2 = [Math.max(1, Math.ceil(q1[0] / 4)), Math.max(1, Math.ceil(q1[1] / 4))];
    const mk = (sz) => ({ t: tex(gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR, sz[0], sz[1]), w: sz[0], h: sz[1] });
    look = { acc: mk([w, h]), g1: mk(q1), s1: mk(q1), g2: mk(q2), s2: mk(q2), out: mk([w, h]) };
    W = w; H = h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    attach(look.acc.t);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { freeLook(); return false; }
    return true;
  };

  const shapeIndex = name => Math.max(0, GP_SHAPES.indexOf(name));

  /** The homes on the picture, for this frame (the picture may be a video, or just loaded). */
  function buildHomes(P, img) {
    const hp = progs.home;
    gl.useProgram(hp.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, img);
    gl.uniform1i(hp.u.u_img, 0); gl.uniform1i(hp.u.u_side, side); gl.uniform1i(hp.u.u_bits, Math.round(Math.log2(side * side)));
    gl.uniform1i(hp.u.u_ink, P.look === 'ink' ? 1 : 0); gl.uniform1f(hp.u.u_threshold, P.threshold);
    attach(home);
    gl.viewport(0, 0, side, side);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const cp = progs.cover;
    gl.useProgram(cp.p);
    gl.uniform1i(cp.u.u_img, 0); gl.uniform1i(cp.u.u_ink, P.look === 'ink' ? 1 : 0); gl.uniform1f(cp.u.u_threshold, P.threshold);
    quad(cp, coverTex[0].t, 64, 64);
    for (let k = 1; k < coverTex.length; k++) {
      const src = coverTex[k - 1], dst = coverTex[k];
      gl.useProgram(progs.down.p);
      gl.bindTexture(gl.TEXTURE_2D, src.t);
      gl.uniform1i(progs.down.u.u_src, 0); gl.uniform2f(progs.down.u.u_texel, 1 / src.w, 1 / src.h);
      quad(progs.down, dst.t, dst.w, dst.h);
    }
  }

  function substep(P, n, h, time, place, ctx) {
    let win = gpEmit(emitter, P.emit, n, P.life, 0.5, h);
    if (burstNow && !ctx.image) { win = { start: 0, count: n }; burstNow = false; }
    const sim = progs.sim, u = sim.u;
    gl.useProgram(sim.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state[0][0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, state[0][1]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, home);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, levelsTex);
    gl.uniform1i(u.u_pos, 0); gl.uniform1i(u.u_vel, 1); gl.uniform1i(u.u_home, 2); gl.uniform1i(u.u_levels, 3);
    gl.uniform1i(u.u_side, side); gl.uniform1f(u.u_n, n);
    gl.uniform1f(u.u_start, win.start); gl.uniform1f(u.u_count, win.count);
    gl.uniform1f(u.u_dt, h); gl.uniform1f(u.u_time, time); gl.uniform1ui(u.u_seed, seed >>> 0);
    gl.uniform1i(u.u_shape, ctx.image ? 7 : Math.min(6, shapeIndex(P.emitter)));
    gl.uniform1i(u.u_image, ctx.image ? 1 : 0); gl.uniform1i(u.u_deep, ctx.deep ? 1 : 0);
    gl.uniform2f(u.u_emitAt, place.emitAt[0], place.emitAt[1]); gl.uniform2f(u.u_attractAt, place.attractAt[0], place.attractAt[1]);
    gl.uniform2f(u.u_imgHalf, ctx.imgHalf[0], ctx.imgHalf[1]);
    gl.uniform1f(u.u_emitSize, P.emitSize); gl.uniform1f(u.u_life, P.life); gl.uniform1f(u.u_lifeVar, 0.5);
    gl.uniform1f(u.u_speed, P.speed); gl.uniform1f(u.u_spread, P.spread);
    gl.uniform1f(u.u_gravity, P.gravity); gl.uniform1f(u.u_wind, P.wind); gl.uniform1f(u.u_turb, P.turbulence); gl.uniform1f(u.u_scale, P.scale);
    gl.uniform1f(u.u_swirl, P.swirl); gl.uniform1f(u.u_attract, P.attract); gl.uniform1f(u.u_drag, P.drag);
    gl.uniform1f(u.u_release, ctx.image ? P.release : 0); gl.uniform1f(u.u_kick, kick); kick = 0;
    const hv = new Float32Array(8);
    place.hands.forEach((hp, k) => hv.set([hp[0], hp[1], 0, 1], k * 4));
    gl.uniform1i(u.u_hands, place.hands.length);
    if (u.u_hand) gl.uniform4fv(u.u_hand, hv);
    gl.uniform1f(u.u_handForce, P.handForce); gl.uniform1f(u.u_handSwirl, P.handSwirl); gl.uniform1f(u.u_handReach, P.handReach);
    gl.uniform1f(u.u_wave, P.wave); gl.uniform1f(u.u_waveSpeed, P.waveSpeed); gl.uniform1f(u.u_vibrate, P.vibrate);
    // Sound: the gusts speed the currents up as well as strengthening them.
    const au = ctx.audio;
    gl.uniform1f(u.u_turb, P.turbulence * (1 + P.gust * au.level * 2.5));
    noiseClock += h * 0.15 * (1 + P.gust * au.level * 6);
    gl.uniform1f(u.u_noiseTime, noiseClock);
    gl.uniform1f(u.u_crunch, P.crunch * (0.5 * au.level + 0.7 * au.treble));
    gl.uniform1f(u.u_jet, P.jet * (0.25 + 1.5 * au.bass));
    gl.uniform1f(u.u_shockSpeed, 1.4);
    const sv = new Float32Array(16);
    shocks.forEach((k, i) => sv.set([k.x, k.y, k.t0, k.s], i * 4));
    if (u.u_shock) gl.uniform4fv(u.u_shock, sv);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, ctx.field ? ctx.field.texture : blankTex);
    gl.uniform1i(u.u_field, 4);
    gl.uniform1i(u.u_obstacle, ctx.field ? ctx.obstacle : 0); gl.uniform1i(u.u_flow, ctx.field ? ctx.flow : 0);
    gl.uniform1f(u.u_flowForce, P.flowForce); gl.uniform1f(u.u_aspect, ctx.aspect);
    gl.uniform2f(u.u_fieldTexel, ctx.field ? 1 / ctx.field.w : 0, ctx.field ? 1 / ctx.field.h : 0);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, ctx.volume ? ctx.volume.texture : blankTex);
    gl.uniform1i(u.u_vol, 5); gl.uniform1i(u.u_volOn, ctx.volume ? 1 : 0);
    gl.uniform4f(u.u_volC, 0, 0, 0, P.sceneReach);
    const pl = ctx.plate;
    gl.uniform1i(u.u_plate, pl ? pl.shape : 0);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, besselTex || blankTex);
    gl.uniform1i(u.u_bessel, 6);
    if (pl) {
      gl.uniform1i(u.u_plateSym, P.symmetry === 'plus' ? 1 : 0); gl.uniform1i(u.u_plateN, pl.count);
      gl.uniform1f(u.u_plateHalf, Math.max(0.02, P.emitSize)); gl.uniform1f(u.u_settle, P.settle); gl.uniform1f(u.u_shake, pl.shake);
      if (u.u_plateMode) gl.uniform4fv(u.u_plateMode, pl.values);
    }
    attach(state[1][0], state[1][1]);
    gl.viewport(0, 0, side, side);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    state.reverse();
    seed++;
  }

  const lightUniforms = (u, lights) => {
    const L = new Float32Array(16), C = new Float32Array(12);
    lights.forEach((l, k) => { L.set([l.x, l.y, l.reach, l.power], k * 4); C.set(l.colour, k * 3); });
    gl.uniform1i(u.u_lights, lights.length);
    if (u.u_light) gl.uniform4fv(u.u_light, L);
    if (u.u_lightCol) gl.uniform3fv(u.u_lightCol, C);
  };

  function quad(prog, target, w, h) {
    gl.useProgram(prog.p);
    attach(target);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function render(P, n, aspect, place, ctx, time) {
    const ink = P.look === 'ink';
    // 1. The particles, added into the half-float target (Light: their light; Ink: their absorbance).
    const d = progs.draw, u = d.u;
    gl.useProgram(d.p);
    attach(look.acc.t);
    gl.viewport(0, 0, W, H); clear();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state[0][0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, state[0][1]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, home);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, ctx.img || blankTex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, coverTex[3].t);
    gl.uniform1i(u.u_pos, 0); gl.uniform1i(u.u_vel, 1); gl.uniform1i(u.u_home, 2); gl.uniform1i(u.u_img, 3); gl.uniform1i(u.u_cover, 4);
    gl.uniform1i(u.u_side, side);
    gl.uniform1f(u.u_aspect, aspect);
    // Sizes are in pixels of a 720-pixel-high picture, and sprites shrink as the count grows (fill rate).
    const maxSize = n > 1100000 ? 3 : n > 300000 ? 8 : 32;
    const size = Math.min(P.size, maxSize);
    const px = Math.max(0.5, H / 720);
    gl.uniform1f(u.u_size, size); gl.uniform1f(u.u_px, px); gl.uniform1f(u.u_speed, P.speed);
    let unit = ink ? gpUnitInk(n, size) : gpUnitBrightness(n, size);
    if (ctx.image) {
      // On a picture the particles tile it: each covers its share, so held they show the picture as it is.
      const imgPx = (2 * ctx.imgHalf[0]) * (2 * ctx.imgHalf[1]) * (H / 2) * (H / 2);
      const area = Math.max(1, 0.25 * size * px * size * px);
      unit = (ink ? 2.5 : 0.9) * imgPx / (n * area);
    }
    gl.uniform1f(u.u_bright, P.brightness * unit);
    const pal = GP_PALETTES[P.palette];
    gl.uniform1i(u.u_rainbow, pal ? 0 : 1);
    if (pal && u.u_pal) gl.uniform3fv(u.u_pal, new Float32Array(pal.flat()));
    gl.uniform1i(u.u_colorBy, ['life', 'speed', 'heading'].indexOf(P.colorBy));
    gl.uniform1i(u.u_ink, ink ? 1 : 0); gl.uniform1i(u.u_image, ctx.image ? 1 : 0);
    gl.uniform3f(u.u_inkCol, P.ink[0], P.ink[1], P.ink[2]);
    gl.uniform1i(u.u_deep, ctx.deep ? 1 : 0);
    gl.uniform2f(u.u_emitAt, place.emitAt[0], place.emitAt[1]);
    let cam = null;
    if (ctx.deep) {
      cam = ctx.cam || gpCamera(P, time, aspect);
      gl.uniformMatrix4fv(u.u_viewProj, false, cam.viewProj);
      gl.uniform3f(u.u_eye, cam.eye[0], cam.eye[1], cam.eye[2]);
      gl.uniform1f(u.u_camDist, cam.dist); gl.uniform1f(u.u_focus, cam.focus);
      // Blur 1 makes a point twice the focus distance away about 26 pixels (of 720) across.
      gl.uniform1f(u.u_coc, P.blur * 52 * px); gl.uniform1f(u.u_cap, GP_BLUR_CAP * px);
    }
    lightUniforms(u, place.lights);
    const lz = place.lights.map(l => l.z || 0);
    gl.uniform4f(u.u_lightZ, lz[0] || 0, lz[1] || 0, lz[2] || 0, lz[3] || 0);
    const depthOn = !!(ctx.deep && ctx.field && ctx.depth);
    gl.uniform1i(u.u_depth, depthOn ? 1 : 0); gl.uniform2f(u.u_viewSize, W, H);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, ctx.field ? ctx.field.texture : blankTex);
    gl.uniform1i(u.u_field, 5);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    const threads = P.thread > 0;
    // Thread length: seconds of travel, scaled so 1 trails a typical particle by a few percent of the picture.
    gl.uniform1f(u.u_thread, threads ? P.thread * 0.12 : 0);
    // Points: everything in 2D without threads; in 3D with threads, only the blurred share.
    if (!threads || ctx.deep) {
      gl.uniform1i(u.u_prim, 0); gl.uniform1f(u.u_part, 1);
      gl.drawArrays(gl.POINTS, 0, n);
    }
    if (threads) {
      gl.uniform1i(u.u_prim, 1); gl.uniform1f(u.u_part, 1);
      gl.drawArrays(gl.LINES, 0, 2 * n);
    }
    gl.disable(gl.BLEND);
    // 2. Glow: 1/4 and 1/16 size, each blurred across and down.
    const levelsList = [[look.acc, look.g1, look.s1], [look.g1, look.g2, look.s2]];
    for (const [src, dst, tmp] of levelsList) {
      gl.useProgram(progs.down.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.t);
      gl.uniform1i(progs.down.u.u_src, 0); gl.uniform2f(progs.down.u.u_texel, 1 / src.w, 1 / src.h);
      quad(progs.down, dst.t, dst.w, dst.h);
      const b = progs.blur;
      gl.useProgram(b.p);
      gl.uniform1i(b.u.u_src, 0); gl.uniform2f(b.u.u_size, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, dst.t); gl.uniform2f(b.u.u_dir, 1, 0); quad(b, tmp.t, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, tmp.t); gl.uniform2f(b.u.u_dir, 0, 1); quad(b, dst.t, dst.w, dst.h);
    }
    // 3. The particles, their glow and the lights' halos (seen through the camera in 3D).
    const c = progs.compose;
    gl.useProgram(c.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, look.acc.t);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, look.g1.t);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, look.g2.t);
    gl.uniform1i(c.u.u_acc, 0); gl.uniform1i(c.u.u_g1, 1); gl.uniform1i(c.u.u_g2, 2);
    gl.uniform2f(c.u.u_size, W, H); gl.uniform1f(c.u.u_aspect, aspect);
    gl.uniform1f(c.u.u_glow, P.glow); gl.uniform1f(c.u.u_halo, P.halo);
    gl.uniform1i(c.u.u_ink, ink ? 1 : 0);
    const seen = cam ? place.lights.map(l => {
      const q = gpProject(cam, [l.x, l.y, l.z || 0], aspect);
      return q.depth <= 0.05 ? { ...l, power: 0 } : { ...l, x: q.x, y: q.y, reach: l.reach * cam.dist / q.depth };
    }) : place.lights;
    lightUniforms(c.u, seen);
    quad(c, look.out.t, W, H);
  }

  /**
   * Step by `dt` (0 holds still) and draw at width × height. `time` is the
   * setup's clock: going back (a rewind, a seek, a new render) starts over,
   * with a pre-roll so the cloud is already full. `image` is the node's
   * picture (a WebGLTexture) for the Image emitter; `level` the sound level.
   */
  function frame(o) {
    if (broken) return null;
    const w = Math.max(1, Math.round(o.width)), h = Math.max(1, Math.round(o.height));
    const aspect = w / h, time = +o.time || 0;
    // Wired settings (the probe, read back a frame or two late) over the sliders.
    const pr = o.probe || null;
    const ap = gpApplyProbe(o.params, pr && pr.spec, pr && pr.values, aspect);
    const P = ap.params, s = gpTierSide(P.count), n = s * s;
    const placeAt = t => { const pl = gpPlace(P, t, o.mouse, aspect); if (ap.emitAt) pl.emitAt = ap.emitAt; return pl; };
    // The caller's state, put back afterwards. Blend, clear colour and mask come from the shadow (gpStateShadow): no GPU round trips.
    const sh = gpStateShadow(gl);
    const saved = {
      fb: gl.getParameter(gl.FRAMEBUFFER_BINDING), vp: gl.getParameter(gl.VIEWPORT), prog: gl.getParameter(gl.CURRENT_PROGRAM),
      vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), active: gl.getParameter(gl.ACTIVE_TEXTURE),
      blend: gl.isEnabled(gl.BLEND), depth: gl.isEnabled(gl.DEPTH_TEST), scissor: gl.isEnabled(gl.SCISSOR_TEST), cull: gl.isEnabled(gl.CULL_FACE),
      bsrc: sh.bsrc, bdst: sh.bdst, basrc: sh.basrc, badst: sh.badst,
      beq: sh.beq, beqa: sh.beqa, clear: sh.clear,
      mask: sh.mask, unpack: gl.getParameter(gl.UNPACK_ALIGNMENT),
    };
    const units = [0, 1, 2, 3, 4, 5, 6].map(i => { gl.activeTexture(gl.TEXTURE0 + i); return gl.getParameter(gl.TEXTURE_BINDING_2D); });
    let result = null;
    try {
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      gl.bindVertexArray(vao);
      if (!ensureState(s) || !ensureLook(w, h)) { broken = true; return null; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      if (o.reset || pendingReset || (isFinite(lastTime) && time < lastTime - 1e-4)) {
        pendingReset = false;
        gl.viewport(0, 0, side, side);
        for (const pair of state) { attach(pair[0], pair[1]); clear(); }
        emitter = gpEmitterState(); seed = 0; needPreroll = true; levels = gpLevelsState();
        sound = gpSoundState(); shocks = []; plate = gpPlateState();
      }
      lastTime = time;
      // The picture, when the emitter is Image and one is loaded (else it falls back to a disc).
      const img = P.emitter === 'image' && o.image ? o.image : null;
      const imgAspect = img && o.imageAspect > 0 ? o.imageAspect : 1;
      const spec = pr && pr.spec;
      const field = pr && pr.field && pr.field.texture ? pr.field : null;
      const ctx = {
        image: !!img, img, deep: P.space === '3d', imgHalf: [P.emitSize * imgAspect, P.emitSize], aspect,
        field, obstacle: spec && spec.field.obstacle ? (P.obstacleMode === 'mask' ? 2 : 1) : 0,
        flow: spec && spec.field.flow ? (P.flowMode === 'around' ? 2 : 1) : 0, depth: !!(spec && spec.field.depth),
        cam: null, audio: sound, volume: pr && pr.volume && pr.volume.texture ? pr.volume : null, plate: null,
      };
      const p2 = img || P.emitter !== 'image' ? P : { ...P, emitter: 'disk' };
      if (img) buildHomes(P, img);
      // The sound: what's heard now (Sound from: a spectrum from the mic or the Audio engine, else the
      // graph's level), its history moving on with the clock, and a shock ring on each hit.
      if (+o.dt > 0) {
        // Sound level (the slider or its socket) is heard with the graph's level, so a beat wired into it hits too.
        gpSoundStep(sound, o.sound || { level: Math.min(2, (+o.level || 0) + P.sound) }, o.dt);
        if (o.sound) sound.level = Math.min(2, sound.level + P.sound);
        if (!o.sound) { sound.bass = sound.mid = sound.treble = sound.level; }
        if (sound.hit && P.shock > 0) {
          const at = placeAt(time).emitAt;
          shocks.unshift({ x: at[0], y: at[1], t0: time, s: P.shock * (0.4 + sound.onset) });
          shocks.length = Math.min(shocks.length, 4);
        }
        gpLevelsPush(levels, sound.level, o.dt);
        gl.bindTexture(gl.TEXTURE_2D, levelsTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GP_LEVELS, 1, gl.RED, gl.FLOAT, levels.levels);
      }
      // The plate (Pattern): which modes it sums this frame, from the sound or from N and M, gliding.
      if (P.pattern === 'off') plateShape = '';
      else {
        // A plate just switched on (or changed shape): a fresh figure, and all the sand poured on again.
        if (plateShape !== P.pattern) { plate = gpPlateState(); plateShape = P.pattern; if (!img) burstNow = true; }
        if (P.pattern === 'circle' && !besselTex) {
          besselTex = tex(gl.R32F, gl.FLOAT, gl.NEAREST, GP_BESSEL_W, GP_BESSEL_N, gl.RED);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GP_BESSEL_W, GP_BESSEL_N, gl.RED, gl.FLOAT, gpBesselTable());
        }
        let targets = null;
        if (P.modeFrom === 'manual') targets = gpPlateTargets(P, P.pattern, null);
        else {
          const heard = gpPlateListen(plate, {
            spectrum: o.sound && o.sound.freq ? o.sound : null, graphBands: o.bands, level: sound.level,
            hit: +o.dt > 0 && sound.hit, dt: o.dt,
          });
          targets = gpPlateTargets(P, P.pattern, heard);
          // Silent from the start: N and M's figure until the sound comes.
          if (!targets && !plate.modes.length) targets = gpPlateTargets(P, P.pattern, null);
        }
        gpPlateSmooth(plate, targets, +o.dt || 0, needPreroll);
        const pu = gpPlateUniforms(plate.modes, P.pattern);
        ctx.plate = {
          shape: P.pattern === 'circle' ? 2 : 1, values: pu.values, count: pu.count,
          // Shake: the slider, harder with the level and on every hit (the sand jumps, then settles again).
          shake: P.shake * (0.6 + 0.8 * Math.min(sound.level, 1.5) + 1.2 * sound.onset),
        };
      }
      // Burst (a trigger): a picture jumps apart; otherwise the whole pool is born again at once.
      if (gpRising(edges, 'burst', P.burst)) { if (ctx.image) kick = 1.2; else burstNow = true; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      if (needPreroll) {
        needPreroll = false;
        // A plate starts with all its sand poured on at once (a stream would take a whole life to fill it).
        if (ctx.plate && !ctx.image) burstNow = true;
        // Coarser for the big pools: the pre-roll is one frame's work.
        const span = Math.min(GP_PREROLL, P.life * 1.5), rate = n > 1100000 ? 10 : n > 300000 ? 20 : 30;
        const steps = Math.ceil(span * rate);
        noiseClock = (time - span) * 0.15;
        for (let k = 0; k < steps; k++) {
          const t = time - span + k / rate;
          substep(p2, n, 1 / rate, t, placeAt(t), ctx);
        }
      }
      const st = gpSubsteps(o.dt, gpMaxSubsteps(n));
      for (let k = 0; k < st.n; k++) {
        const t = time - (st.n - 1 - k) * st.h;
        substep(p2, n, st.h, t, placeAt(t), ctx);
      }
      const place = placeAt(time);
      // In 3D with a scene's camera wired (its ray origin and direction), the particles stand in that scene.
      if (ctx.deep && ap.cam) ctx.cam = gpSceneCamera(ap.cam.ro, ap.cam.rays, aspect, [place.emitAt[0], place.emitAt[1], 0], P.focus);
      render(p2, n, aspect, place, ctx, time);
      result = look.out.t;
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[gpuParticles] frame failed', e);
      broken = true;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, saved.fb);
      gl.viewport(saved.vp[0], saved.vp[1], saved.vp[2], saved.vp[3]);
      gl.useProgram(saved.prog); gl.bindVertexArray(saved.vao);
      for (let i = 6; i >= 0; i--) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, units[i]); }
      gl.activeTexture(saved.active);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, saved.unpack);
      gl.blendFuncSeparate(saved.bsrc, saved.bdst, saved.basrc, saved.badst);
      gl.blendEquationSeparate(saved.beq, saved.beqa);
      gl.clearColor(saved.clear[0], saved.clear[1], saved.clear[2], saved.clear[3]);
      gl.colorMask(saved.mask[0], saved.mask[1], saved.mask[2], saved.mask[3]);
      for (const [cap, on] of [[gl.BLEND, saved.blend], [gl.DEPTH_TEST, saved.depth], [gl.SCISSOR_TEST, saved.scissor], [gl.CULL_FACE, saved.cull]]) if (on) gl.enable(cap); else gl.disable(cap);
    }
    return result;
  }

  function dispose() {
    freeState(); freeLook();
    gl.deleteTexture(levelsTex); gl.deleteTexture(blankTex); if (besselTex) gl.deleteTexture(besselTex); for (const c of coverTex) gl.deleteTexture(c.t);
    for (const x of Object.values(progs)) gl.deleteProgram(x.p);
    gl.deleteVertexArray(vao); gl.deleteFramebuffer(fbo);
    broken = true;
  }

  /** Start over on the next frame (with its pre-roll). */
  function reset() { pendingReset = true; }

  return { frame, dispose, reset, precision: f32 ? 'float' : 'half' };
}

/**
 * Reading a few float pixels back without stalling: `request(framebuffer, w, h)` copies them into a
 * pixel buffer and fences it (one read in flight at a time); `poll()` gives the last values that
 * arrived (a frame or two later), or null before the first. The pixel buffer is unbound at once, so
 * the host's own readPixels (exports, scopes) are never caught by it. RGBA float pixels.
 */
export function gpReadback(gl) {
  let pbo = null, sync = null, bytes = 0, buf = null, latest = null;
  return {
    request(fb, w, h) {
      if (sync || !gl.fenceSync) return false;
      const n = w * h * 4;
      if (!pbo || bytes !== n * 4) {
        if (pbo) gl.deleteBuffer(pbo);
        pbo = gl.createBuffer(); bytes = n * 4; buf = new Float32Array(n);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
      } else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, 0);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      return true;
    },
    poll() {
      if (sync && gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED) {
        gl.deleteSync(sync); sync = null;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        latest = buf.slice();
      }
      return latest;
    },
    dispose() { if (sync) gl.deleteSync(sync); if (pbo) gl.deleteBuffer(pbo); sync = null; pbo = null; latest = null; },
  };
}

/**
 * Every Particles node of a shader on one context. `bind(fragmentShader)`
 * after each compile finds them (gpBindings) and keeps an engine per node;
 * `frame` runs them all and returns each sampler's texture (null where the
 * engine can't run: the node then reads nothing and passes its picture
 * through). `unsupported` is why, for the host to say once.
 */
export function gpHost(gl) {
  const reason = gpUnsupported(gl);
  let bindings = [];
  const engines = new Map();
  return {
    unsupported: reason,
    bind(fragmentShader) {
      bindings = gpBindings(fragmentShader);
      const want = new Set(bindings.map(b => b.uniform));
      for (const [k, e] of engines) if (!want.has(k)) { if (e) e.dispose(); engines.delete(k); }
      return bindings;
    },
    get bindings() { return bindings; },
    active() { return bindings.length > 0; },
    /**
     * o: { width, height, dt, time, mouse: [x, y] in 0…1 (y up) | null, read: uniform name → value,
     * texture?: sampler name → { texture: WebGLTexture, aspect } | null (the node's picture), reset? }
     */
    frame(o) {
      const out = [];
      for (const b of bindings) {
        let e = engines.get(b.uniform);
        if (e === undefined) { e = reason ? null : gpCreate(gl); engines.set(b.uniform, e); }
        const params = gpParams(b.params, o.read);
        const pic = e && b.image && params.emitter === 'image' && o.texture ? o.texture(b.image) : null;
        const lv = b.audio && o.read ? gpNum(o.read(b.audio)) : null;
        const bands = b.audioBands && b.audioBands.length > 1 && o.read ? b.audioBands.map(k => gpNum(o.read(k)) || 0) : null;
        const pv = b.probe && o.probe ? o.probe(b, { centre: [0, 0, 0], half: params.sceneReach }) : null;
        const snd = params.soundFrom !== 'graph' && o.sound ? o.sound(params.soundFrom) : null;
        const texture = e ? e.frame({
          params, width: o.width, height: o.height, dt: o.dt, time: o.time, mouse: o.mouse, reset: o.reset,
          image: pic ? pic.texture : null, imageAspect: pic ? pic.aspect : 1, level: lv || 0, sound: snd, bands,
          probe: b.probe ? { spec: b.probe, values: pv ? pv.values : null, field: pv ? pv.field : null, volume: pv ? pv.volume : null } : null,
        }) : null;
        out.push({ uniform: b.uniform, texture, look: params.look });
      }
      return out;
    },
    reset() { for (const e of engines.values()) if (e) e.reset(); },
    dispose() { for (const e of engines.values()) if (e) e.dispose(); engines.clear(); bindings = []; },
  };
}
