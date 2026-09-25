/**
 * playLayers.ts — the Play layers: things drawn over the picture in
 * JavaScript by the layer kit (play/kit), in the app and in web exports.
 *
 * Every kind is described three ways that must agree, all in this file:
 *   the interface          what the code reads
 *   LAYER_DEFAULTS         a fresh layer
 *   LAYER_SCHEMA           how a file's value is checked (type, range, choices)
 * parseLayer() is generic over the schema: an unknown or out-of-range value
 * falls back to the default, so an old or hand-edited file always loads.
 *
 * Coordinates are 0..1 across and up the picture (y up). Sizes called "in
 * picture heights" are fractions of the picture's height, so shapes keep
 * their proportions on any canvas shape.
 */

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'lighten' | 'darken' | 'difference' | 'exclusion' | 'add';

/** How a text, image or camera layer meets the picture. */
export type MatteMode =
  /** Drawn over the picture with a blend mode. */
  | 'over'
  /** The picture shows only inside the layer's shape; everywhere else is the layer's colour. */
  | 'reveal'
  /** The picture's brightness is the layer's alpha: the layer shows where the picture is bright. */
  | 'luma';

type RGB = [number, number, number];

interface LayerBase {
  id: string;
  label: string;
  visible: boolean;
  /** Include this layer in what the graph's Layers node sees (its colour, alpha and distance). */
  toShader: boolean;
}

/** A draggable point. Its position is a source ("Null X" / "Null Y") and can be a control. */
export interface NullLayer extends LayerBase {
  kind: 'null';
  x: number;
  y: number;
  /** Marker radius in px. 0 hides the marker but keeps the point. */
  size: number;
  color: string;
  /** Chase the mouse or another null on a spring instead of staying put. */
  follow: 'none' | 'mouse' | 'null';
  followId: string;
  /** 0..1: how hard the spring pulls (low = lazy, high = snappy). */
  spring: number;
  /** 0..1: how much it overshoots and wobbles before settling. */
  wobble: number;
  /** What the null does to particles: nothing, births them (emitter), swallows them (absorber), pulls, pushes or swirls them. */
  role: 'none' | 'emitter' | 'absorber' | 'attract' | 'repel' | 'vortex';
  /** Radius of the null's zone (picture heights): where particles are born or swallowed. */
  radius: number;
  /** How strong its pull, push or launch is. */
  strength: number;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  x: number;
  y: number;
  /** Font size as a fraction of the picture height. */
  size: number;
  rotation: number;
  opacity: number;
  color: RGB;
  font: 'sans' | 'serif' | 'mono';
  weight: number;
  blend: BlendMode;
  matte: MatteMode;
  /** Show one line at a time: the next line on a Next action, or every `interval` seconds. */
  sequence: boolean;
  /** Seconds per line in a sequence; 0 = only on actions. */
  interval: number;
  transition: 'cut' | 'fade' | 'rise' | 'type';
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  /** A data URL; the image travels with the play file. */
  src: string;
  x: number;
  y: number;
  /** 1 = fit the picture height. */
  scale: number;
  rotation: number;
  opacity: number;
  /** Background for the reveal matte. */
  color: RGB;
  blend: BlendMode;
  matte: MatteMode;
}

export type ParticleField = 'flow' | 'climb' | 'descend' | 'noise' | 'none';
export type ParticleShape = 'dot' | 'square' | 'triangle' | 'streak' | 'ring' | 'star' | 'image';
export type ParticleModulator = 'none' | 'brightness' | 'speed' | 'age' | 'null';

/**
 * A particle system over the picture (play/particle-sim.js). Each particle
 * steers toward its field's direction, may be pulled by an attractor, is born
 * in a spawn area and respawns at the edges, when caught, or when its life
 * runs out. Shape layers with zone actions act on it too.
 */
export interface ParticlesLayer extends LayerBase {
  kind: 'particles';
  count: number;
  // Motion
  field: ParticleField;
  speed: number;
  /** 0..1: how quickly particles turn toward the field (low = floaty, high = snappy). */
  steer: number;
  /** flow: brightness 0→1 turns the heading this many full turns. */
  turns: number;
  /** Degrees added to the flow and noise headings: turns the whole field. */
  angle: number;
  /** noise field: size of the swirls (higher = smaller) and how fast it evolves. */
  noiseScale: number;
  noiseEvolve: number;
  /** climb/descend on flat parts of the picture: keep moving on noise, or slow down and collect. */
  flat: 'wander' | 'settle';
  /** Read the shader's picture, or the camera layer's image. */
  readFrom: 'picture' | 'camera';
  /** Coarse reads a 64×36 copy of the picture; fine a 128×72 one (thin detail matters, costs a little more). */
  detail: 'coarse' | 'fine';
  /** 0..1: particles push each other apart. */
  collide: number;
  /** 0..1: flocking (boids) on top of everything else. 0 = off. */
  flock: number;
  /** How far a particle sees its neighbours (picture heights). */
  flockRadius: number;
  /** 0..2: match neighbours' heading · steer toward their centre · keep your distance. */
  flockAlign: number;
  flockCohere: number;
  flockSeparate: number;
  // Attractor
  /** mouse: while the pointer is over the picture; press: only while a button is held. */
  attractor: 'none' | 'mouse' | 'press' | 'null';
  force: 'gravitate' | 'spiral' | 'repel';
  strength: number;
  /** A particle this close to the attractor (picture heights) respawns. */
  catchRadius: number;
  // Birth and death
  /** stream: always alive, reborn when they leave. burst: born only by a Burst action, gone when their life ends. */
  emit: 'stream' | 'burst';
  spawn: 'anywhere' | 'edges' | 'center' | 'null';
  spawnRadius: number;
  edges: 'wrap' | 'bounce' | 'respawn';
  /** Seconds before a particle respawns (each gets 60–140% of it); 0 = never. */
  life: number;
  /** 0..1: fade in at birth and out at death (fraction of the life). */
  fade: number;
  /** 0 = different every time; any other number repeats the same run (for recordings). */
  seed: number;
  /** The null an attractor, a null spawn or a null modulator uses. */
  nullId: string;
  // Look
  shape: ParticleShape;
  rotate: 'heading' | 'spin' | 'none';
  /** Image sprite (a data URL: PNG, JPG or SVG) for shape 'image'. */
  sprite: string;
  crop: boolean;
  /** Paint the sprite in the tint colour (keeps its transparency). */
  tintSprite: boolean;
  size: number;
  /** 0..1: random size variation between particles. */
  sizeJitter: number;
  opacity: number;
  colour: 'tint' | 'picture' | 'palette';
  color: RGB;
  palette: number;
  paletteBy: 'heading' | 'speed' | 'age' | 'brightness';
  sizeBy: ParticleModulator;
  sizeAmount: number;
  opacityBy: ParticleModulator;
  opacityAmount: number;
  /** Null modulator reach (picture heights): full effect at the null, none this far away. */
  falloff: number;
  /** Plexus: join particles closer than this (picture heights) with lines. 0 = off. */
  links: number;
  /** Show the picture through the particles instead of colouring them. */
  reveal: boolean;
  /** 0 = no trail, 1 = long trails. */
  trail: number;
  blend: BlendMode;
}

/**
 * What a shape does to particles (and physics bodies) that meet it.
 *   wall       they slide along it (or bounce, with Bounce)
 *   container  the opposite: they are kept inside
 *   attract / repel   pulled toward / pushed from it, within Reach
 *   sink       they vanish inside and are reborn where particles are born
 *   portal     they go in here and come out of the target shape
 *   emitter    new particles are born inside it and are pushed out (Strength), within Reach
 *   absorber   pulls particles straight in (no orbiting) and swallows them; they are reborn at an emitter
 *   wind       a push in one direction inside it
 *   vortex     a swirl around it
 *   drag       they slow down inside it
 *   tint / resize   they change colour / size while inside
 *   sensor     nothing moves; it only counts (every shape counts: see Sensor sources)
 */
export type ZoneAction = 'none' | 'wall' | 'container' | 'attract' | 'repel' | 'sink' | 'portal' | 'emitter' | 'absorber' | 'wind' | 'vortex' | 'drag' | 'tint' | 'resize' | 'sensor';

/** A shape: something to see, an invisible zone that acts on particles, or both. */
export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  /** box · circle (an ellipse when w ≠ h) · line (length w, thickness h) · polygon (points) · layer (a text or image layer's shape) · picture (the bright parts of the picture) */
  shape: 'box' | 'circle' | 'line' | 'polygon' | 'layer' | 'picture';
  x: number;
  y: number;
  /** Width and height in picture heights. */
  w: number;
  h: number;
  rotation: number;
  /** 0..0.5: corner rounding of a box, as a fraction of its shorter side. */
  round: number;
  /** Polygon corners, flat [x0, y0, x1, y1, …] in picture heights around (x, y). */
  points: number[];
  /** shape 'layer': the text or image layer whose shape this is. */
  sourceId: string;
  /** shape 'picture': brightness at or above this is inside. */
  threshold: number;
  /** Swap inside and outside. */
  invert: boolean;
  // Look
  /** Draw it. Off = an invisible zone (outlined only while you edit Layers). */
  show: boolean;
  fill: RGB;
  fillOpacity: number;
  stroke: RGB;
  /** Outline width in px; 0 = none. */
  strokeWidth: number;
  /** 0..1: how much of the outline is drawn (animate it to draw the shape on). */
  trim: number;
  blend: BlendMode;
  // What it does
  action: ZoneAction;
  strength: number;
  /** attract / repel / vortex: how far out it reaches (picture heights). */
  reach: number;
  /** wall: 0 = slide along, 1 = bounce straight back. */
  bounce: number;
  /** wind: direction in degrees (0 = right, 90 = down). */
  angle: number;
  /** portal: the shape particles come out of. */
  targetId: string;
  tint: RGB;
  /** resize: size multiplier inside. */
  scale: number;
  /** The particles layer it acts on; '' = all of them. */
  affects: string;
}

/** Live audio as a picture: a waveform, spectrum bars, a ring or a blob. Needs the live audio input on. */
export interface AudioLayer extends LayerBase {
  kind: 'audio';
  style: 'wave' | 'bars' | 'ring' | 'blob';
  x: number;
  y: number;
  /** Width and height in picture heights (ring and blob use the smaller as the diameter). */
  w: number;
  h: number;
  bars: number;
  gain: number;
  /** 0..1: how slowly it follows the sound (0 = raw). */
  smooth: number;
  /** Line width in px. */
  thickness: number;
  mirror: boolean;
  colour: 'tint' | 'palette';
  color: RGB;
  palette: number;
  opacity: number;
  blend: BlendMode;
}

/** The picture redrawn as characters, dots, squares or lines on a grid, sized or picked by brightness. */
export interface GlyphsLayer extends LayerBase {
  kind: 'glyphs';
  style: 'ascii' | 'dots' | 'squares' | 'lines' | 'cross';
  /** Cell size in px. */
  cell: number;
  /** ascii: characters from dark to bright. */
  chars: string;
  colour: 'tint' | 'picture' | 'palette';
  color: RGB;
  palette: number;
  invert: boolean;
  /** Brightness contrast before picking (1 = as is). */
  contrast: number;
  /** Fill the cells with the backdrop first (hides the picture under the grid). */
  cover: boolean;
  background: RGB;
  readFrom: 'picture' | 'camera';
  opacity: number;
  blend: BlendMode;
}

/** Topographic lines through the picture's brightness. */
export interface ContoursLayer extends LayerBase {
  kind: 'contours';
  levels: number;
  /** Line width in px. */
  width: number;
  /** Levels drift through the brightness this fast (levels per second). */
  flow: number;
  detail: 'coarse' | 'fine';
  colour: 'tint' | 'palette';
  color: RGB;
  palette: number;
  readFrom: 'picture' | 'camera';
  opacity: number;
  blend: BlendMode;
}

/** A circle that changes the picture under it. */
export interface LensLayer extends LayerBase {
  kind: 'lens';
  x: number;
  y: number;
  /** Radius in picture heights. */
  radius: number;
  effect: 'magnify' | 'pixelate' | 'blur' | 'invert' | 'mono' | 'mirror';
  /** magnify: zoom; pixelate: block size; blur: radius. */
  amount: number;
  follow: 'none' | 'mouse' | 'null';
  nullId: string;
  /** Rim width in px; 0 = none. */
  ring: number;
  ringColor: RGB;
  opacity: number;
}

/** Paint on the picture with the mouse (or a moving null); strokes fade and can be walls. */
export interface BrushLayer extends LayerBase {
  kind: 'brush';
  /** drag: while a button is held · hover: follows the pointer · null: follows a null · off: keeps what is there */
  paint: 'drag' | 'hover' | 'null' | 'off';
  nullId: string;
  /** Stroke width in px. */
  size: number;
  colour: 'tint' | 'picture' | 'palette';
  color: RGB;
  palette: number;
  /** Seconds before a stroke has faded; 0 = strokes stay until cleared. */
  fade: number;
  /** Particles and bodies bump into the strokes. */
  walls: boolean;
  opacity: number;
  blend: BlendMode;
}

/** Things that fall and pile up: letters, circles or boxes with gravity, bouncing off the edges, walls and (optionally) the bright parts of the picture. */
export interface BodiesLayer extends LayerBase {
  kind: 'bodies';
  source: 'letters' | 'circles' | 'boxes';
  text: string;
  count: number;
  /** Size in px. */
  size: number;
  gravity: number;
  /** Direction of gravity in degrees (0 = down). */
  angle: number;
  bounce: number;
  friction: number;
  font: 'sans' | 'serif' | 'mono';
  colour: 'tint' | 'palette';
  color: RGB;
  palette: number;
  /** Bright parts of the picture are solid. */
  solidPicture: boolean;
  threshold: number;
  opacity: number;
  blend: BlendMode;
}

/** The webcam, as a layer (like an image), a mask, or what particles, glyphs and contours read. Its motion is a sensor source. */
export interface CameraLayer extends LayerBase {
  kind: 'camera';
  x: number;
  y: number;
  /** 1 = fill the picture height. */
  scale: number;
  rotation: number;
  opacity: number;
  color: RGB;
  mirror: boolean;
  blend: BlendMode;
  matte: MatteMode;
}

export type PlayLayer = NullLayer | TextLayer | ImageLayer | ParticlesLayer | ShapeLayer | AudioLayer | GlyphsLayer | ContoursLayer | LensLayer | BrushLayer | BodiesLayer | CameraLayer;
export type PlayLayerKind = PlayLayer['kind'];

export const LAYER_KINDS: readonly PlayLayerKind[] = ['null', 'text', 'image', 'particles', 'shape', 'audio', 'glyphs', 'contours', 'lens', 'brush', 'bodies', 'camera'];

// ── Defaults ─────────────────────────────────────────────────────────────────

type Defaults<T> = Omit<T, 'id' | 'label' | 'visible' | 'kind'>;

const LAYER_DEFAULTS: { [K in PlayLayerKind]: Defaults<Extract<PlayLayer, { kind: K }>> } = {
  null: { toShader: true, x: 0.5, y: 0.5, size: 10, color: '#3a6ff7', follow: 'none', followId: '', spring: 0.5, wobble: 0.3, role: 'none', radius: 0.04, strength: 1 },
  text: {
    toShader: true, text: 'PLAY', x: 0.5, y: 0.5, size: 0.25, rotation: 0, opacity: 1, color: [1, 1, 1], font: 'sans', weight: 700, blend: 'normal', matte: 'over',
    sequence: false, interval: 0, transition: 'fade',
  },
  image: { toShader: true, src: '', x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, color: [0, 0, 0], blend: 'normal', matte: 'over' },
  particles: {
    toShader: true, count: 800,
    field: 'flow', speed: 1, steer: 0.5, turns: 1, angle: 0, noiseScale: 3, noiseEvolve: 0.2, flat: 'wander', readFrom: 'picture', detail: 'coarse', collide: 0,
    flock: 0, flockRadius: 0.06, flockAlign: 1, flockCohere: 0.6, flockSeparate: 1.2,
    attractor: 'none', force: 'gravitate', strength: 1, catchRadius: 0.02,
    emit: 'stream', spawn: 'anywhere', spawnRadius: 0.2, edges: 'wrap', life: 0, fade: 0, seed: 0, nullId: '',
    shape: 'dot', rotate: 'heading', sprite: '', crop: false, tintSprite: false, size: 2, sizeJitter: 0.3, opacity: 0.8,
    colour: 'tint', color: [1, 1, 1], palette: 1, paletteBy: 'heading',
    sizeBy: 'none', sizeAmount: 1, opacityBy: 'none', opacityAmount: 0.5, falloff: 0.3, links: 0,
    reveal: false, trail: 0.6, blend: 'normal',
  },
  shape: {
    toShader: true, shape: 'box', x: 0.5, y: 0.5, w: 0.3, h: 0.2, rotation: 0, round: 0, points: [], sourceId: '', threshold: 0.5, invert: false,
    show: true, fill: [1, 1, 1], fillOpacity: 0.15, stroke: [1, 1, 1], strokeWidth: 1.5, trim: 1, blend: 'normal',
    action: 'wall', strength: 1, reach: 0.15, bounce: 0, angle: 0, targetId: '', tint: [1, 0.35, 0.3], scale: 2, affects: '',
  },
  audio: { toShader: true, style: 'wave', x: 0.5, y: 0.5, w: 1.2, h: 0.35, bars: 48, gain: 1.5, smooth: 0.5, thickness: 2, mirror: false, colour: 'tint', color: [1, 1, 1], palette: 1, opacity: 0.9, blend: 'screen' },
  glyphs: { toShader: true, style: 'ascii', cell: 12, chars: ' .:-=+*#%@', colour: 'picture', color: [1, 1, 1], palette: 1, invert: false, contrast: 1.2, cover: true, background: [0, 0, 0], readFrom: 'picture', opacity: 1, blend: 'normal' },
  contours: { toShader: true, levels: 10, width: 1.2, flow: 0.2, detail: 'fine', colour: 'palette', color: [1, 1, 1], palette: 1, readFrom: 'picture', opacity: 0.9, blend: 'screen' },
  lens: { toShader: true, x: 0.5, y: 0.5, radius: 0.18, effect: 'magnify', amount: 2, follow: 'mouse', nullId: '', ring: 1.5, ringColor: [1, 1, 1], opacity: 1 },
  brush: { toShader: true, paint: 'drag', nullId: '', size: 14, colour: 'palette', color: [1, 1, 1], palette: 1, fade: 4, walls: false, opacity: 0.9, blend: 'screen' },
  bodies: { toShader: true, source: 'letters', text: 'PLAY', count: 24, size: 48, gravity: 1, angle: 0, bounce: 0.35, friction: 0.3, font: 'sans', colour: 'tint', color: [1, 1, 1], palette: 1, solidPicture: false, threshold: 0.6, opacity: 1, blend: 'normal' },
  camera: { toShader: true, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, color: [0, 0, 0], mirror: true, blend: 'normal', matte: 'over' },
};

/** A fresh layer of a kind with sensible defaults. */
export function defaultLayer(kind: PlayLayerKind, id: string, label: string): PlayLayer {
  const d = LAYER_DEFAULTS[kind] as unknown as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) copy[k] = Array.isArray(v) ? [...v] : v;
  return { id, kind, label, visible: true, ...copy } as unknown as PlayLayer;
}

// ── Schema (what a file may hold) ────────────────────────────────────────────

type Field =
  | { t: 'num'; min?: number; max?: number; int?: boolean }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'bool' }
  | { t: 'str' }
  | { t: 'hex' }
  | { t: 'rgb' }
  | { t: 'points' };

const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'lighten', 'darken', 'difference', 'exclusion', 'add'] as const;
const MATTES = ['over', 'reveal', 'luma'] as const;
const MODS = ['none', 'brightness', 'speed', 'age', 'null'] as const;
const N = (min?: number, max?: number, int = false): Field => ({ t: 'num', min, max, int });
const E = (...values: string[]): Field => ({ t: 'enum', values });
const B: Field = { t: 'bool' }, S: Field = { t: 'str' }, C: Field = { t: 'rgb' };
const blendF: Field = { t: 'enum', values: BLENDS }, matteF: Field = { t: 'enum', values: MATTES };
const unit = N(0, 1);

const LAYER_SCHEMA: Record<PlayLayerKind, Record<string, Field>> = {
  null: {
    toShader: B, x: N(), y: N(), size: N(0), color: { t: 'hex' }, follow: E('none', 'mouse', 'null'), followId: S, spring: unit, wobble: unit,
    role: E('none', 'emitter', 'absorber', 'attract', 'repel', 'vortex'), radius: N(0.001), strength: N(0),
  },
  text: {
    toShader: B, text: S, x: N(), y: N(), size: N(0.005), rotation: N(), opacity: unit, color: C, font: E('sans', 'serif', 'mono'), weight: N(100, 900), blend: blendF, matte: matteF,
    sequence: B, interval: N(0), transition: E('cut', 'fade', 'rise', 'type'),
  },
  image: { toShader: B, src: S, x: N(), y: N(), scale: N(0.01), rotation: N(), opacity: unit, color: C, blend: blendF, matte: matteF },
  particles: {
    toShader: B, count: N(1, 5000, true),
    field: E('flow', 'climb', 'descend', 'noise', 'none'), speed: N(0), steer: unit, turns: N(0), angle: N(), noiseScale: N(0.1), noiseEvolve: N(0),
    flat: E('wander', 'settle'), readFrom: E('picture', 'camera'), detail: E('coarse', 'fine'), collide: unit,
    flock: unit, flockRadius: N(0.005, 0.5), flockAlign: N(0, 2), flockCohere: N(0, 2), flockSeparate: N(0, 2),
    attractor: E('none', 'mouse', 'press', 'null'), force: E('gravitate', 'spiral', 'repel'), strength: N(0), catchRadius: N(0),
    emit: E('stream', 'burst'), spawn: E('anywhere', 'edges', 'center', 'null'), spawnRadius: N(0), edges: E('wrap', 'bounce', 'respawn'), life: N(0), fade: unit, seed: N(0, 1e9, true), nullId: S,
    shape: E('dot', 'square', 'triangle', 'streak', 'ring', 'star', 'image'), rotate: E('heading', 'spin', 'none'), sprite: S, crop: B, tintSprite: B,
    size: N(0.1), sizeJitter: unit, opacity: unit, colour: E('tint', 'picture', 'palette'), color: C, palette: N(0, 9, true),
    paletteBy: E('heading', 'speed', 'age', 'brightness'), sizeBy: { t: 'enum', values: MODS }, sizeAmount: N(), opacityBy: { t: 'enum', values: MODS }, opacityAmount: N(),
    falloff: N(0.01), links: N(0, 0.5), reveal: B, trail: unit, blend: blendF,
  },
  shape: {
    toShader: B, shape: E('box', 'circle', 'line', 'polygon', 'layer', 'picture'), x: N(), y: N(), w: N(0.001), h: N(0.001), rotation: N(), round: N(0, 0.5),
    points: { t: 'points' }, sourceId: S, threshold: unit, invert: B,
    show: B, fill: C, fillOpacity: unit, stroke: C, strokeWidth: N(0), trim: unit, blend: blendF,
    action: E('none', 'wall', 'container', 'attract', 'repel', 'sink', 'portal', 'emitter', 'absorber', 'wind', 'vortex', 'drag', 'tint', 'resize', 'sensor'),
    strength: N(0), reach: N(0.001), bounce: unit, angle: N(), targetId: S, tint: C, scale: N(0), affects: S,
  },
  audio: {
    toShader: B, style: E('wave', 'bars', 'ring', 'blob'), x: N(), y: N(), w: N(0.01), h: N(0.01), bars: N(4, 256, true), gain: N(0), smooth: unit, thickness: N(0.5),
    mirror: B, colour: E('tint', 'palette'), color: C, palette: N(0, 9, true), opacity: unit, blend: blendF,
  },
  glyphs: {
    toShader: B, style: E('ascii', 'dots', 'squares', 'lines', 'cross'), cell: N(3, 200), chars: S, colour: E('tint', 'picture', 'palette'), color: C, palette: N(0, 9, true),
    invert: B, contrast: N(0.1, 5), cover: B, background: C, readFrom: E('picture', 'camera'), opacity: unit, blend: blendF,
  },
  contours: {
    toShader: B, levels: N(1, 64, true), width: N(0.25), flow: N(), detail: E('coarse', 'fine'), colour: E('tint', 'palette'), color: C, palette: N(0, 9, true),
    readFrom: E('picture', 'camera'), opacity: unit, blend: blendF,
  },
  lens: {
    toShader: B, x: N(), y: N(), radius: N(0.01), effect: E('magnify', 'pixelate', 'blur', 'invert', 'mono', 'mirror'), amount: N(0), follow: E('none', 'mouse', 'null'), nullId: S,
    ring: N(0), ringColor: C, opacity: unit,
  },
  brush: {
    toShader: B, paint: E('drag', 'hover', 'null', 'off'), nullId: S, size: N(0.5), colour: E('tint', 'picture', 'palette'), color: C, palette: N(0, 9, true),
    fade: N(0), walls: B, opacity: unit, blend: blendF,
  },
  bodies: {
    toShader: B, source: E('letters', 'circles', 'boxes'), text: S, count: N(1, 400, true), size: N(4, 400), gravity: N(), angle: N(), bounce: unit, friction: unit,
    font: E('sans', 'serif', 'mono'), colour: E('tint', 'palette'), color: C, palette: N(0, 9, true), solidPicture: B, threshold: unit, opacity: unit, blend: blendF,
  },
  camera: { toShader: B, x: N(), y: N(), scale: N(0.01), rotation: N(), opacity: unit, color: C, mirror: B, blend: blendF, matte: matteF },
};

function coerce(v: unknown, f: Field, fallback: unknown): unknown {
  switch (f.t) {
    case 'num': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
      let n = f.int ? Math.round(v) : v;
      if (f.min !== undefined) n = Math.max(f.min, n);
      if (f.max !== undefined) n = Math.min(f.max, n);
      return n;
    }
    case 'enum': return typeof v === 'string' && f.values.includes(v) ? v : fallback;
    case 'bool': return typeof v === 'boolean' ? v : fallback;
    case 'str': return typeof v === 'string' ? v : fallback;
    case 'hex': return typeof v === 'string' && v.length > 0 ? v : fallback;
    case 'rgb':
      return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(n => typeof n === 'number' && Number.isFinite(n))
        ? [Math.max(0, Math.min(1, v[0])), Math.max(0, Math.min(1, v[1])), Math.max(0, Math.min(1, v[2]))]
        : fallback;
    case 'points':
      return Array.isArray(v) && v.length % 2 === 0 && v.length <= 2000 && v.every(n => typeof n === 'number' && Number.isFinite(n)) ? [...v] : fallback;
  }
}

/** A layer from a file, or null when it isn't one. Unknown fields are dropped, bad values fall back to defaults. */
export function parseLayer(raw: unknown): PlayLayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = { ...(raw as Record<string, unknown>) };
  const id = typeof l.id === 'string' && l.id ? l.id : null;
  const kind = l.kind as PlayLayerKind;
  if (!id || !LAYER_KINDS.includes(kind)) return null;
  if (kind === 'particles') migrateParticles(l);
  const d = defaultLayer(kind, id, typeof l.label === 'string' && l.label ? l.label : kind) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { id, kind, label: d.label, visible: l.visible !== false };
  for (const [key, field] of Object.entries(LAYER_SCHEMA[kind])) out[key] = coerce(l[key], field, d[key]);
  return out as unknown as PlayLayer;
}

/** Files from before the particle system: `mode` was the field and `colorFromPicture` the colour; they had no size variety. */
function migrateParticles(l: Record<string, unknown>): void {
  if (l.field !== undefined) return;
  if (l.mode === 'climb' || l.mode === 'descend') { l.field = l.mode; if (l.flat === undefined) l.flat = 'settle'; }
  if (l.colour === undefined && l.colorFromPicture === true) l.colour = 'picture';
  if (l.sizeJitter === undefined) l.sizeJitter = 0;
}

// ── Numeric properties a control can drive ──────────────────────────────────

export interface LayerNumericProp { key: string; label: string; min: number; max: number; step?: number; hint: string }

const X = (what: string): LayerNumericProp => ({ key: 'x', label: 'X', min: 0, max: 1, hint: `${what} across the picture: 0 is the left edge, 1 the right.` });
const Y = (what: string): LayerNumericProp => ({ key: 'y', label: 'Y', min: 0, max: 1, hint: `${what} up the picture: 0 is the bottom, 1 the top.` });
const ROT: LayerNumericProp = { key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1, hint: 'Degrees, clockwise.' };
const OPACITY: LayerNumericProp = { key: 'opacity', label: 'Opacity', min: 0, max: 1, hint: 'How solid the layer is. 0 is invisible.' };

/** Numeric layer properties a control can drive, per kind. The control's target is `layer:<layerId>::<key>`. */
export const LAYER_NUMERIC_PROPS: Record<PlayLayerKind, ReadonlyArray<LayerNumericProp>> = {
  null: [
    X('The point'), Y('The point'),
    { key: 'size', label: 'Size', min: 0, max: 60, step: 1, hint: 'Marker radius in pixels. 0 hides the marker; the null still works.' },
    { key: 'spring', label: 'Spring', min: 0, max: 1, hint: 'Following: how hard it is pulled toward what it follows. Low is lazy, high snaps.' },
    { key: 'wobble', label: 'Wobble', min: 0, max: 1, hint: 'Following: how much it overshoots and wobbles before settling. 0 glides straight in.' },
    { key: 'radius', label: 'Radius', min: 0.005, max: 0.4, hint: 'Particle role: how big its zone is (fraction of picture height). Emitters birth particles inside it; absorbers swallow them there.' },
    { key: 'strength', label: 'Strength', min: 0, max: 5, hint: 'Particle role: how hard it launches (emitter), pulls (absorber, attract), pushes (repel) or swirls (vortex).' },
  ],
  text: [
    X('Centre of the text'), Y('Centre of the text'),
    { key: 'size', label: 'Size', min: 0.02, max: 1, hint: 'Letter height as a fraction of the picture height.' },
    ROT, OPACITY,
    { key: 'interval', label: 'Every (s)', min: 0, max: 10, hint: 'Sequence: seconds per line. 0 = only when a Next action fires.' },
  ],
  image: [
    X('Centre of the image'), Y('Centre of the image'),
    { key: 'scale', label: 'Scale', min: 0.05, max: 3, hint: 'Image height as a fraction of the picture height (1 = as tall as the picture).' },
    ROT, OPACITY,
  ],
  particles: [
    { key: 'speed', label: 'Speed', min: 0, max: 3, hint: 'How fast particles travel. 1 crosses the picture\'s height in about 5 seconds.' },
    { key: 'steer', label: 'Steering', min: 0, max: 1, hint: 'How quickly particles turn toward where the field points. Low is floaty and drifting; high follows the field tightly.' },
    { key: 'turns', label: 'Turns', min: 0, max: 4, hint: 'Flow only: how many full turns the heading makes from black to white. 0 = everything goes one way; higher = tighter swirls. At 1, black and white point the same way and grey the opposite, which is why particles skirt bright shapes.' },
    { key: 'angle', label: 'Direction', min: -180, max: 180, step: 1, hint: 'Turns the whole flow or noise field by this many degrees. Map an LFO to it and the wind slowly rotates.' },
    { key: 'noiseScale', label: 'Swirl size', min: 0.5, max: 12, hint: 'Noise field (and wandering): how many swirls fit across the picture. Higher = smaller, busier swirls.' },
    { key: 'noiseEvolve', label: 'Evolve', min: 0, max: 2, hint: 'How fast the noise field changes over time. 0 = frozen lanes.' },
    { key: 'collide', label: 'Collide', min: 0, max: 1, hint: 'Particles push each other apart instead of passing through. Costs more with many particles.' },
    { key: 'flock', label: 'Flock', min: 0, max: 1, hint: 'Boids: particles steer by their neighbours as well as the field. 0 = off; 1 = the flock wins over the field.' },
    { key: 'flockRadius', label: 'Sight', min: 0.01, max: 0.3, hint: 'Flocking: how far a particle sees its neighbours (fraction of picture height).' },
    { key: 'flockAlign', label: 'Alignment', min: 0, max: 2, hint: 'Flocking: how strongly particles turn to fly the same way as their neighbours.' },
    { key: 'flockCohere', label: 'Cohesion', min: 0, max: 2, hint: 'Flocking: how strongly particles steer toward the middle of their neighbours (tight flocks).' },
    { key: 'flockSeparate', label: 'Separation', min: 0, max: 2, hint: 'Flocking: how strongly particles keep their distance from neighbours (no pile-ups).' },
    { key: 'strength', label: 'Pull', min: 0, max: 3, hint: 'How hard the attractor pulls (or pushes, for Repel). Stronger near it.' },
    { key: 'catchRadius', label: 'Catch', min: 0, max: 0.3, hint: 'Particles this close to the attractor are caught and respawn (fraction of picture height). 0 = never caught.' },
    { key: 'spawnRadius', label: 'Spawn radius', min: 0, max: 0.8, hint: 'Spawn at centre or at a null: how wide the birth circle is (fraction of picture height).' },
    { key: 'life', label: 'Life (s)', min: 0, max: 20, hint: 'Seconds before a particle respawns (each lives 60–140% of this). 0 = they live forever and only respawn at edges or when caught.' },
    { key: 'fade', label: 'Fade', min: 0, max: 1, hint: 'Fade in when born and out before dying, as a fraction of the life. With no life set, particles only fade in.' },
    { key: 'size', label: 'Size', min: 0.5, max: 40, step: 0.5, hint: 'Particle radius in pixels.' },
    { key: 'sizeJitter', label: 'Size variety', min: 0, max: 1, hint: 'Random size differences between particles. 0 = all the same.' },
    { key: 'sizeAmount', label: 'Size follow', min: -1, max: 3, hint: 'How much size follows the chosen reading. +1 doubles it where the reading is full; −1 shrinks particles to nothing there.' },
    { key: 'opacityAmount', label: 'Opacity follow', min: -1, max: 1, hint: 'How much opacity follows the chosen reading. Negative fades particles out where the reading is full (e.g. old age).' },
    { key: 'falloff', label: 'Null reach', min: 0.02, max: 1, hint: 'Following a null: full effect at the null, fading to none this far away (fraction of picture height).' },
    { key: 'links', label: 'Links', min: 0, max: 0.3, hint: 'Plexus: join particles closer than this with lines (fraction of picture height). 0 = off. Works best under ~1500 particles.' },
    OPACITY,
    { key: 'trail', label: 'Trail', min: 0, max: 1, hint: 'How long the streaks behind particles last. 0 = no trail; 1 = long, slow-fading trails.' },
  ],
  shape: [
    X('Centre of the shape'), Y('Centre of the shape'),
    { key: 'w', label: 'Width', min: 0.01, max: 2, hint: 'Width in picture heights (a line\'s length).' },
    { key: 'h', label: 'Height', min: 0.01, max: 2, hint: 'Height in picture heights (a line\'s thickness).' },
    ROT,
    { key: 'round', label: 'Rounding', min: 0, max: 0.5, hint: 'Box corners: 0 is square, 0.5 fully round.' },
    { key: 'threshold', label: 'Threshold', min: 0, max: 1, hint: 'Picture shapes: brightness at or above this counts as inside.' },
    { key: 'fillOpacity', label: 'Fill', min: 0, max: 1, hint: 'How solid the fill is when the shape is shown.' },
    { key: 'strokeWidth', label: 'Outline', min: 0, max: 20, step: 0.5, hint: 'Outline width in pixels. 0 = none.' },
    { key: 'trim', label: 'Trim', min: 0, max: 1, hint: 'How much of the outline is drawn. Animate it from 0 to 1 to draw the shape on.' },
    { key: 'strength', label: 'Strength', min: 0, max: 5, hint: 'How strong the action is: pull, push, wind, swirl or drag.' },
    { key: 'reach', label: 'Reach', min: 0.01, max: 0.8, hint: 'Attract, repel and vortex: how far outside the shape it acts (fraction of picture height).' },
    { key: 'bounce', label: 'Bounce', min: 0, max: 1, hint: 'Walls: 0 = particles slide along, 1 = they bounce straight back.' },
    { key: 'angle', label: 'Wind angle', min: -180, max: 180, step: 1, hint: 'Wind direction in degrees: 0 right, 90 down, 180 left, −90 up.' },
    { key: 'scale', label: 'Resize ×', min: 0, max: 5, hint: 'Resize: particle size multiplier while inside.' },
  ],
  audio: [
    X('Centre'), Y('Centre'),
    { key: 'w', label: 'Width', min: 0.05, max: 2, hint: 'Width in picture heights.' },
    { key: 'h', label: 'Height', min: 0.02, max: 1, hint: 'Height in picture heights (how far the wave or bars reach).' },
    { key: 'gain', label: 'Gain', min: 0, max: 6, hint: 'How big the sound makes it.' },
    { key: 'smooth', label: 'Smooth', min: 0, max: 0.95, hint: 'How slowly it follows the sound. 0 is raw and jittery.' },
    { key: 'thickness', label: 'Thickness', min: 0.5, max: 12, step: 0.5, hint: 'Line width in pixels.' },
    OPACITY,
  ],
  glyphs: [
    { key: 'cell', label: 'Cell', min: 4, max: 60, step: 1, hint: 'Grid cell size in pixels. Smaller = more detail, more work.' },
    { key: 'contrast', label: 'Contrast', min: 0.2, max: 4, hint: 'Pushes darks darker and lights lighter before picking a glyph.' },
    OPACITY,
  ],
  contours: [
    { key: 'levels', label: 'Levels', min: 1, max: 40, step: 1, hint: 'How many lines between black and white.' },
    { key: 'width', label: 'Width', min: 0.25, max: 6, step: 0.25, hint: 'Line width in pixels.' },
    { key: 'flow', label: 'Flow', min: -2, max: 2, hint: 'Levels drift through the brightness: lines crawl up or down the picture\'s slopes.' },
    OPACITY,
  ],
  lens: [
    X('Centre of the lens'), Y('Centre of the lens'),
    { key: 'radius', label: 'Radius', min: 0.02, max: 0.8, hint: 'Lens radius, as a fraction of the picture height.' },
    { key: 'amount', label: 'Amount', min: 0, max: 8, hint: 'Magnify: zoom. Pixelate: block size. Blur: radius.' },
    { key: 'ring', label: 'Rim', min: 0, max: 8, step: 0.5, hint: 'Rim width in pixels. 0 = none.' },
    OPACITY,
  ],
  brush: [
    { key: 'size', label: 'Size', min: 1, max: 80, step: 0.5, hint: 'Stroke width in pixels.' },
    { key: 'fade', label: 'Fade (s)', min: 0, max: 30, hint: 'Seconds before a stroke has faded. 0 = strokes stay until cleared.' },
    OPACITY,
  ],
  bodies: [
    { key: 'size', label: 'Size', min: 6, max: 200, step: 1, hint: 'Body size in pixels.' },
    { key: 'gravity', label: 'Gravity', min: -3, max: 3, hint: 'How hard they fall. Negative floats them up.' },
    { key: 'angle', label: 'Gravity angle', min: -180, max: 180, step: 1, hint: 'Which way is down, in degrees. 0 = down, 90 = left, −90 = right.' },
    { key: 'bounce', label: 'Bounce', min: 0, max: 1, hint: 'How bouncy collisions are.' },
    { key: 'friction', label: 'Friction', min: 0, max: 1, hint: 'How quickly sliding bodies stop.' },
    { key: 'threshold', label: 'Solid above', min: 0, max: 1, hint: 'Solid picture: brightness at or above this is solid ground.' },
    OPACITY,
  ],
  camera: [
    X('Centre of the camera image'), Y('Centre of the camera image'),
    { key: 'scale', label: 'Scale', min: 0.05, max: 3, hint: 'Camera image height as a fraction of the picture height.' },
    ROT, OPACITY,
  ],
};
