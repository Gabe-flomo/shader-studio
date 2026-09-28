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

import { LINKED_PREFIX, LINKED_REF_MAX, isLinkedRef } from '../files/linkedRefs';
import { DP_CHOKES, DP_PADS, DP_PARAMS, DP_SYNTHS, dpKey, type DpMode, type DpSynth } from '../play/kit/drumPads.js';

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

/**
 * A track matte: another layer this one shows through (After Effects' track
 * matte). The layer is drawn on its own, then multiplied by the matte's
 * alpha or brightness. The matte layer still runs while it is hidden (its
 * eye is the "Show matte" switch), and can have a matte of its own.
 */
export interface TrackMatte {
  /** The matte layer's id. */
  id: string;
  /** Alpha: where the matte is solid. Luma: where it is bright. */
  mode: 'alpha' | 'luma';
  /** Show the layer where the matte is not. */
  invert: boolean;
}

export type MaskShape = 'rect' | 'ellipse' | 'polygon';
/** How a mask combines with the ones above it: Add joins, Subtract cuts out, Intersect keeps the overlap. */
export type MaskOp = 'add' | 'subtract' | 'intersect';
/**
 * A mask a layer owns: it shows the layer inside and hides it outside. Its
 * numbers (offset, size, turn, rounding, feather, expand, opacity) live on the
 * layer as `mask_<id>_<prop>`, so controls, mappings and takes drive them;
 * see MASK_PROPS. The offset hangs from the layer's centre and turns with it.
 */
export interface LayerMask {
  /** `m1`, `m2`…: unique on its layer. */
  id: string;
  shape: MaskShape;
  /** Polygon corners, flat [x0, y0, …] in the mask's own box (-0.5..0.5 each way, y up). */
  points: number[];
  op: MaskOp;
  invert: boolean;
}

interface LayerBase {
  id: string;
  label: string;
  visible: boolean;
  /** Include this layer in what the graph's Layers node sees (its colour, alpha and distance). */
  toShader: boolean;
  /** Absent: no matte. Not on nulls or the Background layer. */
  trackMatte?: TrackMatte;
  /** Absent or empty: no masks. Not on nulls or the Background layer. */
  masks?: LayerMask[];
}

/** A draggable point. Its position is a source ("Null X" / "Null Y") and can be a control. */
export interface NullLayer extends LayerBase {
  kind: 'null';
  x: number;
  y: number;
  /** Marker radius in px. 0 hides the marker but keeps the point. */
  size: number;
  color: string;
  /** Chase the mouse, another null or a point on a tracked hand on a spring instead of staying put. */
  follow: 'none' | 'mouse' | 'null' | 'hand';
  followId: string;
  /** follow: 'hand': which hand (the performer's own; 'any' is the right one when it is in view) and which landmark (0 wrist … 8 index tip … 20 pinky tip). */
  handSide: 'left' | 'right' | 'any';
  handPoint: number;
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
  /** Vortex: how far the swirl's disc leans away (degrees, 0 = flat circle, toward 85 = a thin ellipse with depth). */
  tilt: number;
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
  /** A web font: a Google Fonts link (or family name) or a .woff2/.ttf URL. Overrides Font; Font is the fallback. */
  fontUrl: string;
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
  /** 0.05..1: personal space, as a fraction of the sight radius. Neighbours closer than this are pushed away. */
  flockSpace: number;
  /** How hard a Scatter throws them (multiplies the action's amount). */
  scatter: number;
  /** Draw the field and forces while the Layers tab is open. */
  showField: boolean;
  // Attractor
  /** mouse: while the pointer is over the picture; press: only while a button is held. */
  attractor: 'none' | 'mouse' | 'press' | 'null';
  force: 'gravitate' | 'spiral' | 'repel';
  strength: number;
  /** A particle this close to the attractor (picture heights) respawns. */
  catchRadius: number;
  // Birth and death
  /**
   * stream: always alive, reborn when they leave. burst: born only by a Burst action, gone when their life ends.
   * multiply: one particle is born and keeps splitting until there are `count` (see particle-sim.js, Multiply).
   */
  emit: 'stream' | 'burst' | 'multiply';
  /** Multiply: splits per second per particle (the population doubles about every 1 / splitRate s). */
  splitRate: number;
  /** Multiply, 0..1: how uneven the time between splits is (up to ±80%). */
  splitJitter: number;
  /** Multiply, 1..4: buds per split. */
  splitChildren: number;
  /** Multiply: how hard a bud and its parent push apart (picture heights / s). */
  splitPush: number;
  /** Multiply (stay, return, annihilate): neighbours closer than this (picture heights) drift apart. 0 = off. */
  multSpread: number;
  /** Multiply: once born, drift apart and stop · follow the field and forces · spring back to the birth point · pair up and annihilate. */
  multLife: 'stay' | 'flow' | 'return' | 'annihilate';
  /** Multiply, once the count is reached: start over from one when they're gone · the dead come back at the origin · stay full. */
  multAfter: 'loop' | 'respawn' | 'hold';
  /** Multiply · return: spring strength back to the birth point. */
  returnSpring: number;
  /** Multiply · annihilate: how far a particle looks for a partner (picture heights). */
  pairRadius: number;
  /** Multiply · annihilate: how fast partners close in (picture heights / s). */
  seekSpeed: number;
  /** Multiply · loop: seconds at the full count before starting over (0 = only when they're gone). */
  loopHold: number;
  spawn: 'anywhere' | 'edges' | 'center' | 'null';
  spawnRadius: number;
  /** Leaving the picture: come in the other side, bounce, be reborn (spawn setting), or reappear anywhere at random. */
  edges: 'wrap' | 'bounce' | 'respawn' | 'random';
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
  /** Goo: draw the particles as metaballs, one smooth field that merges touching particles into blobs. */
  goo: boolean;
  /** Goo: how far each particle's field reaches, as a multiple of its size (the smooth-min radius). */
  gooBlend: number;
  /** Goo, 0..1: where the summed field becomes goo (lower = fatter blobs that merge sooner). */
  gooThreshold: number;
  /** Goo, 0..1: 0 = a hard edge; higher = a softer one. */
  gooSoft: number;
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

/**
 * How a path shape joins its nulls:
 *   fill    a polygon through them, in order (with Hull: round the outside)
 *   smooth  a closed curve through them (centripetal Catmull-Rom)
 *   circle  a circle their spread sets (see PathCircleMode)
 *   lines   a line through them, in order, left open
 *   web     every pair joined (within Reach), links fading as they stretch
 */
export type PathStyle = 'fill' | 'smooth' | 'circle' | 'lines' | 'web';
/** spread: centred on the points' middle, radius their mean distance from it. first: centred on the first point, radius the mean distance of the others (with two points, the second sets it). */
export type PathCircleMode = 'spread' | 'first';
/** A point whose null follows a hand that is out of view: left out (drop), kept where it was (hold), or the whole shape fades out until it is back (fade). */
export type PathOnLost = 'drop' | 'hold' | 'fade';

/** A shape: something to see, an invisible zone that acts on particles, or both. */
export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  /** box · circle (an ellipse when w ≠ h) · line (length w, thickness h) · polygon (points) · layer (a text or image layer's shape) · picture (the bright parts of the picture) · path (corners that are nulls: pointIds) */
  shape: 'box' | 'circle' | 'line' | 'polygon' | 'layer' | 'picture' | 'path';
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
  /** shape 'path': the null layers that are its corners, in order (missing ones are skipped). */
  pointIds: string[];
  pathStyle: PathStyle;
  /** fill · smooth: go round the outside (the convex hull), so crossing points never make a bow-tie. */
  hull: boolean;
  /** web: join only points closer than this (picture heights); 0 joins every pair. */
  webReach: number;
  circleMode: PathCircleMode;
  onLost: PathOnLost;
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
  /** vortex: how far the swirl's disc leans away (degrees). The shape's rotation turns the lean. */
  tilt: number;
  /** The particles layer it acts on; '' = all of them. */
  affects: string;
}

/** Live audio as a picture: a waveform, spectrum bars, a ring or a blob. Needs the live audio input on. */
export interface AudioLayer extends LayerBase {
  kind: 'audio';
  /** live: the live audio input. file: a song loaded into this layer (kept for the session, not saved). */
  input: 'live' | 'file';
  /** The loaded song's name, so it can be asked for again after a reload. */
  fileName: string;
  style: 'wave' | 'bars' | 'ring' | 'blob' | 'spectrogram';
  /** Spectrogram: how fast it scrolls (1 ≈ the width in 4 seconds). */
  scroll: number;
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
  /** own keeps each glyph's own colours (emoji). */
  colour: 'tint' | 'picture' | 'palette' | 'own';
  color: RGB;
  palette: number;
  invert: boolean;
  /** ascii: shifts which glyph each brightness gets, cycling through the ramp (animate it to shuffle). */
  shift: number;
  /** ascii: 0..1, how far each cell strays from its glyph (a stable random per cell). */
  spread: number;
  /** Brightness contrast before picking (1 = as is). */
  contrast: number;
  /** Fill the cells with the backdrop first (hides the picture under the grid). */
  cover: boolean;
  background: RGB;
  readFrom: 'picture' | 'camera' | 'layer';
  /** readFrom layer: the layer the grid is made from. */
  sourceId: string;
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
  fontUrl: string;
  colour: 'tint' | 'palette';
  color: RGB;
  palette: number;
  /** Bright parts of the picture are solid. */
  solidPicture: boolean;
  threshold: number;
  /** How hard a Scatter throws them (multiplies the action's amount). */
  scatter: number;
  opacity: number;
  blend: BlendMode;
}

export type RelationKind = 'chase' | 'repel' | 'attract';
export type RelationRole = 'chaser' | 'prey' | 'member';
/** What a member does at the picture's edge. */
export type RelationWall = 'bounce' | 'repel' | 'wrap' | 'respawn' | 'escape';
export type PictureChannel = 'brightness' | 'red' | 'green' | 'blue' | 'hue' | 'saturation' | 'layer';
/** A layer in a relationship, and how it reacts to the picture under it. */
export interface RelationMember {
  id: string;
  /** Chase: who hunts and who runs. Repel and attract: everyone is a member. */
  role: RelationRole;
  /** Heavier moves less under the same force. */
  mass: number;
  /** Move toward higher values of the channel (climb) or away from them (descend), on top of the relationship's forces. */
  picture: 'off' | 'climb' | 'descend';
  channel: PictureChannel;
  /** channel 'layer': whose alpha it reads. */
  layerId: string;
  /** How far around it looks, in picture heights: the gradient over that ring is what it climbs. */
  radius: number;
}
export const RELATION_MAX_MEMBERS = 24;
/** The mappable strength of member i's (0-based) reaction to the picture: `m1_picture` … */
export const relationPictureKey = (i: number): `m${number}_picture` => `m${i + 1}_picture`;

/**
 * Members (layers with a position) moved every frame by a force between them: a chase (chasers hunt the
 * closest prey in sight, prey flees, a catch fires a signal), everyone pushing apart, or everyone pulling
 * together (kept apart at a boundary, or gravity-like and orbiting). It draws nothing but a debug overlay.
 */
export interface RelationshipLayer extends LayerBase {
  kind: 'relationship';
  members: RelationMember[];
  relation: RelationKind;
  /** Chase: how fast they run (picture heights per second), how hard they accelerate, how sharply they turn (0..1). */
  speed: number;
  accel: number;
  turn: number;
  /** Chase: a chaser sees prey this close; prey runs from a chaser this close; how much they roam without one. */
  sight: number;
  flee: number;
  wander: number;
  /** Repel and attract: how hard. */
  strength: number;
  repelDistance: number;
  repelCurve: 'linear' | 'inverse';
  /** Attract: keep a minimum distance (a soft boundary), or overshoot (gravity-like, they pass through and orbit). */
  attractMode: 'keep' | 'overshoot';
  minDistance: number;
  /** Overshoot: 0 pulls evenly at any distance, 1 falls off as the inverse square. */
  falloff: number;
  /** How stiff the soft contacts are, how much of a bounce is kept, how quickly motion dies out. */
  springiness: number;
  bounciness: number;
  damping: number;
  maxSpeed: number;
  wallChaser: RelationWall;
  wallPrey: RelationWall;
  wallMember: RelationWall;
  /** Where a respawn goes, and how long an escaped member stays away. */
  respawnAt: 'random' | 'fixed' | 'far';
  respawnDelay: number;
  /** A chaser this close to a prey catches it. */
  catchRadius: number;
  onCatch: 'none' | 'respawn' | 'swap';
  /** A signal sent on every catch, or ''. */
  catchSignal: string;
  /** Draw the forces while the guides show: sight and flee radii, chaser → target lines, velocity and picture arrows. */
  debug: boolean;
  [pictureKey: `m${number}_picture`]: number;
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

/** How a video layer's frame is sized before its Scale: as tall as the picture, fitted inside it, or filling it (cropped). */
export type VideoFit = 'height' | 'contain' | 'cover';
/** A video layer's sound: none (muted), analysed for audio readers but not heard, or heard and analysed. */
export type VideoSound = 'off' | 'listen' | 'play';

/**
 * A video file over the picture, placed like an image (docs/video-layer.md).
 * The file lives in the backgrounds library (IndexedDB, lib/backgroundLibrary.ts),
 * never in the setup: the layer keeps its id there, and its name and size so
 * it can ask for the file again where the library doesn't have it.
 *
 * Playback follows the graph clock by default (frame t shows start + t × speed,
 * so takes and offline renders are frame-exact), or runs free. Muted unless
 * `sound` is on: then its sound goes through the shared audio analysis, and
 * audio readers can listen to it ("Video · <label>").
 */
export interface VideoLayer extends LayerBase {
  kind: 'video';
  /** The file's id in the backgrounds library; '' until a video is picked. */
  videoId: string;
  /** The file's name and size, to ask for it again (another browser, a cleared library). */
  fileName: string;
  bytes: number;
  fit: VideoFit;
  x: number;
  y: number;
  /** 1 = the fitted size (Fit: Height makes that the picture's height). */
  scale: number;
  rotation: number;
  opacity: number;
  /** Background for the reveal matte. */
  color: RGB;
  blend: BlendMode;
  matte: MatteMode;
  /** Pause holds the start frame (following the clock) or where it is (running free). */
  playing: boolean;
  loop: boolean;
  /** Playback rate: 1 is as recorded. */
  speed: number;
  /** Seconds into the video that the clock's 0 shows (or where a free-running video starts). */
  start: number;
  /** Follow the graph clock (pausing, ↺ and scrubbing move it; exact in takes and renders), or run on its own. */
  follow: boolean;
  sound: VideoSound;
  /** 0..1, for `sound: 'play'`. */
  volume: number;
}

/**
 * Where a video layer is at clock `time` (seconds): start + time × speed,
 * wrapped when it loops, else held just before the end.
 */
export function videoLayerTimeAt(time: number, duration: number, speed: number, loop: boolean, start: number): number {
  if (!(duration > 0) || !Number.isFinite(duration)) return Math.max(0, start);
  const t = Math.max(0, start) + Math.max(0, time) * (speed > 0 ? speed : 1);
  return loop ? t % duration : Math.min(t, Math.max(0, duration - 0.001));
}

/** The audio readers' input for a video layer's sound (types/play.ts PlayAudioReaders.input). */
export const videoReaderInput = (layerId: string) => `video:${layerId}`;
/** The video layer id an audio readers' input names, or null when it names something else. */
export function videoLayerOfInput(input: string): string | null {
  return input.startsWith('video:') && input.length > 6 ? input.slice(6) : null;
}

// ── Drum pads ───────────────────────────────────────────────────────────────

/**
 * One pad of a Drum pad layer: what it plays and how (its numbers are layer
 * properties, `pad<N>_<key>`, so each is a mapping target). The sample lives
 * in the media library (IndexedDB, lib/backgroundLibrary.ts, next to the
 * videos) and the pad keeps its id, name and size; or it plays a generated
 * drum (`synth`), which needs no file at all.
 */
export interface DrumPad {
  /** '' for an empty pad (or a generated one). */
  sampleId: string;
  fileName: string;
  bytes: number;
  /** A generated drum (kit/drumPads.js DP_SYNTHS), used when there is no sample. */
  synth: DpSynth | '';
  /** A name of its own ('' shows the file's or the drum's). */
  name: string;
  /** One-shot plays to the end; gate plays while held. */
  mode: DpMode;
  /** Gate: start to end round and round while held. */
  loop: boolean;
  reverse: boolean;
  /** 1..8: a hit cuts every voice in the same group (an open hat by a closed one). 0: none. */
  choke: number;
}

/**
 * A drum pad sampler (docs/drum-pads.md): 16 pads, each a sample played
 * Simpler-style, hit by clicks, keys, MIDI notes and grid pads, actions and
 * takes. It draws nothing: its sound goes through its effect chain
 * (`layer:<id>`) to the master bus, and audio readers can listen to it
 * (`pads:<id>`).
 */
export interface DrumPadLayer extends LayerBase {
  kind: 'drumpad';
  pads: DrumPad[];
  /** The whole kit's level, after its effect chain. */
  volume: number;
  /** Z X C V / A S D F / Q W E R / 1 2 3 4 play pads 1–16. */
  keys: boolean;
  /** MIDI notes from `baseNote` play pads 1–16 (36–51 by default, a drum rack's). */
  midi: boolean;
  /** 0: any channel. */
  channel: number;
  baseNote: number;
  /** The pad grid's lower-left 4 × 4 plays the pads. */
  grid: boolean;
  [padKey: `pad${number}_${string}`]: number;
}

export const emptyDrumPad = (): DrumPad => ({ sampleId: '', fileName: '', bytes: 0, synth: '', name: '', mode: 'oneshot', loop: false, reverse: false, choke: 0 });
/** Does the pad play anything? */
export const padHasSound = (p: DrumPad | undefined): boolean => !!p && (!!p.sampleId || !!p.synth);
/** What a pad is called: its own name, its file's, its drum's, or "Pad 3". */
export function padName(p: DrumPad | undefined, i: number): string {
  if (!p) return `Pad ${i + 1}`;
  return p.name || p.fileName.replace(/\.[a-z0-9]{2,4}$/i, '') || (p.synth ? DRUM_SYNTH_LABELS[p.synth] : '') || `Pad ${i + 1}`;
}
export const DRUM_SYNTH_LABELS: Record<DpSynth, string> = { kick: 'Kick', snare: 'Snare', hat: 'Closed hat', openhat: 'Open hat', clap: 'Clap', tom: 'Tom', rim: 'Rim', cowbell: 'Cowbell' };

/** Every pad number at its default, for a new layer. */
function drumPadNumbers(): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < DP_PADS; i++) for (const p of DP_PARAMS) out[dpKey(i, p.key)] = p.value;
  return out;
}

/** Every member's picture strength at its default (1), for a new Relationship layer. */
function relationNumbers(): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < RELATION_MAX_MEMBERS; i++) out[relationPictureKey(i)] = 1;
  return out;
}

const RELATION_ROLES = ['chaser', 'prey', 'member'] as const;
const PICTURE_CHANNELS = ['brightness', 'red', 'green', 'blue', 'hue', 'saturation', 'layer'] as const;
/** A relationship's members from a file: each a layer id with its role, mass and picture reaction; anything else is dropped. */
export function parseRelationMembers(v: unknown): RelationMember[] {
  if (!Array.isArray(v)) return [];
  const out: RelationMember[] = [], seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== 'string' || !m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const mass = typeof m.mass === 'number' && Number.isFinite(m.mass) ? Math.max(0.1, Math.min(10, m.mass)) : 1;
    const radius = typeof m.radius === 'number' && Number.isFinite(m.radius) ? Math.max(0.01, Math.min(0.5, m.radius)) : 0.06;
    out.push({
      id: m.id,
      role: (RELATION_ROLES as readonly string[]).includes(m.role as string) ? (m.role as RelationRole) : 'member',
      mass,
      picture: m.picture === 'climb' || m.picture === 'descend' ? m.picture : 'off',
      channel: (PICTURE_CHANNELS as readonly string[]).includes(m.channel as string) ? (m.channel as PictureChannel) : 'brightness',
      layerId: typeof m.layerId === 'string' ? m.layerId : '',
      radius,
    });
    if (out.length >= RELATION_MAX_MEMBERS) break;
  }
  return out;
}
/** A new member of a relationship: a plain member of mass 1 that ignores the picture. */
export const newRelationMember = (id: string, role: RelationRole = 'member'): RelationMember => ({ id, role, mass: 1, picture: 'off', channel: 'brightness', layerId: '', radius: 0.06 });

function parseDrumPads(v: unknown): DrumPad[] {
  const arr = Array.isArray(v) ? v : [];
  const out: DrumPad[] = [];
  for (let i = 0; i < DP_PADS; i++) {
    const r = arr[i] && typeof arr[i] === 'object' ? arr[i] as Record<string, unknown> : {};
    const p = emptyDrumPad();
    if (typeof r.sampleId === 'string') p.sampleId = r.sampleId.slice(0, 200);
    if (typeof r.fileName === 'string') p.fileName = r.fileName.slice(0, 120);
    if (typeof r.bytes === 'number' && Number.isFinite(r.bytes)) p.bytes = Math.max(0, Math.round(r.bytes));
    if ((DP_SYNTHS as readonly string[]).includes(r.synth as string)) p.synth = r.synth as DpSynth;
    if (typeof r.name === 'string') p.name = r.name.slice(0, 60);
    if (r.mode === 'gate') p.mode = 'gate';
    p.loop = r.loop === true;
    p.reverse = r.reverse === true;
    if (typeof r.choke === 'number' && Number.isFinite(r.choke)) p.choke = Math.max(0, Math.min(DP_CHOKES, Math.round(r.choke)));
    // A web export carries the sample in the pad itself (runtime only).
    if (typeof r.src === 'string' && r.src.startsWith('data:audio/')) (p as DrumPad & { src?: string }).src = r.src;
    out.push(p);
  }
  return out;
}

/** The audio readers' input for a Drum pad layer's sound. */
export const padsReaderInput = (layerId: string) => `pads:${layerId}`;
/** The Drum pad layer id an audio readers' input names, or null. */
export function padsLayerOfInput(input: string): string | null {
  return input.startsWith('pads:') && input.length > 5 ? input.slice(5) : null;
}

/**
 * Copies of another layer (a shape, text, image, camera or null), arranged in
 * a grid, a ring, a line, along a brush stroke or on a particles layer's
 * points. Each copy has an index; steps and seeded randomness vary the copies
 * by it, and effectors (nulls or shapes named in `effectors`) move, scale,
 * turn, fade, tint or hide the copies within their falloff.
 */
export interface ClonerLayer extends LayerBase {
  kind: 'cloner';
  /** The layer that is copied. */
  sourceId: string;
  /** Draw only the copies, not the original. */
  hideSource: boolean;
  arrange: 'grid' | 'ring' | 'line' | 'path' | 'points';
  /** ring · line · path: how many copies. */
  count: number;
  cols: number;
  rows: number;
  /** grid · ring: the centre; line: the start. */
  x: number;
  y: number;
  /** line: the end. */
  x2: number;
  y2: number;
  /** grid: spacing in picture heights. */
  spacingX: number;
  spacingY: number;
  /** ring: radius in picture heights; start angle and sweep in degrees. */
  radius: number;
  startAngle: number;
  sweep: number;
  /** ring · path: turn each copy to face along the ring or the stroke. */
  face: boolean;
  /** path: the brush layer whose stroke to follow; points: the particles layer whose particles to sit on. */
  pathId: string;
  /** path: how much of the stroke is used, 0..1. */
  spread: number;
  /** Random offset per copy, in picture heights. */
  jitter: number;
  seed: number;
  // Every copy
  scale: number;
  rotation: number;
  opacity: number;
  // Per index: copy i gets base + step × i
  stepX: number;
  stepY: number;
  stepScale: number;
  stepRotation: number;
  stepOpacity: number;
  stepHue: number;
  // Seeded randomness, ± this much
  randScale: number;
  randRotation: number;
  randOpacity: number;
  randHue: number;
  // Effectors: nulls or shapes; the falloff and what it does apply to all of them
  effectors: string[];
  /** Falloff radius from the null (or the shape's edge), picture heights. */
  effRadius: number;
  /** 0 = hard edge, 1 = fades over the whole radius. */
  effSoftness: number;
  /** Move copies away from the effector (negative pulls them in), picture heights. */
  effPush: number;
  effScale: number;
  effRotate: number;
  effOpacity: number;
  effHue: number;
  /** Hide a copy when the falloff weight reaches this; 0 = never. */
  effHide: number;
  /** Act outside the falloff instead of inside. */
  effInvert: boolean;
  blend: BlendMode;
}

/** A slider a script declares: `params = { speed: { value: 1, min: 0, max: 5, step: 0.1, label: 'Speed' } }`. Its value lives on the layer as `p_<key>`. */
/** What a declared param is on the panel: a slider (the default), an on/off toggle, or a button that presses (an action). */
export type ScriptParamKind = 'slider' | 'toggle' | 'button' | 'colour' | 'choice';
/** What a Script layer draws with: a 2D canvas, or WebGL through three.js. */
export type ScriptMode = '2d' | '3d';
export interface ScriptParamDef {
  key: string; label: string; kind?: ScriptParamKind; value: number; min: number; max: number; step?: number; hint?: string;
  /** choice: the options; the value is the chosen one's index, the sketch sees its text. */
  options?: string[];
  /** Read only in setup: changing it starts the sketch over. */
  restart?: boolean;
  /** colour: the value is 0xRRGGBB; the sketch sees '#rrggbb', or [r, g, b] ('array', with `alpha` as a fourth when it had one). */
  as?: 'array';
  alpha?: number;
}

/** A Script layer's main file: its code is the layer's `code`, and it runs after the other files. */
export const SCRIPT_MAIN_FILE = 'sketch.js';
/** One of a Script layer's other files (a tab): run before sketch.js, in order, in the same scope. */
export interface ScriptFile { name: string; code: string }
/** What a file a sketch loads is: images and fonts are data URLs, the rest text. */
export type ScriptAssetKind = 'image' | 'font' | 'json' | 'text';
/** A file an imported p5 project brought, by the path the sketch loads it with. */
export interface ScriptAsset { name: string; kind: ScriptAssetKind; mime: string; data: string; libraryId?: string }
export const SCRIPT_FILES_MAX = 24;
export const SCRIPT_ASSETS_MAX = 64;
/** Largest file a sketch keeps (data URL or text characters, about 3 MB of image). */
export const SCRIPT_ASSET_MAX = 4_200_000;
/** A file name a tab can have: letters, digits, dots, dashes, underscores and folders. */
export const SCRIPT_FILE_NAME = /^[A-Za-z0-9_][\w.\- /]{0,79}$/;

/**
 * A layer drawn by JavaScript you write: a `setup(s)` and a `draw(s)` on a 2D
 * canvas the size of the picture, p5-style, with the sliders the script
 * declares. Runs in the app and in exported websites (the kit is plain JS).
 */
export interface ScriptLayer extends LayerBase {
  kind: 'script';
  /**
   * 2d: the sketch draws on a 2D canvas (s.ctx). 3d: it draws with WebGL
   * through three.js (box, sphere, lights, camera… and s.three), into a
   * transparent canvas composited the same way. Files from before 3D have none: 2d.
   */
  mode: ScriptMode;
  /** The main file, sketch.js (SCRIPT_MAIN_FILE). Files from before tabs have only this. */
  code: string;
  /**
   * The other files (tabs), run before sketch.js in this order, all in one scope: what one
   * declares at its top level the others see, as p5 projects expect. Absent or empty: one file.
   */
  files?: ScriptFile[];
  /** Files the sketch loads by name (loadImage, loadJSON…), from an imported p5 project. */
  assets?: ScriptAsset[];
  /** Run the p5.js way: its own canvas (createCanvas), p5's defaults and events (see kit/p5.js). */
  p5?: boolean;
  /** Sliders the script declared the last time it compiled; controls target them as `p_<key>`. */
  paramDefs: ScriptParamDef[];
  /** Clear the canvas every frame; off keeps what was drawn (trails). */
  clear: boolean;
  /** Let the script read the picture's brightness (samples the shader at low resolution each frame). */
  readPicture: boolean;
  opacity: number;
  blend: string;
  /**
   * The layer kind this layer is made from (a sketch saved as a kind, see
   * types/layerKinds.ts): the kind's code and params, copied here so the
   * layer still runs as a plain Script layer when the kind is missing.
   */
  kindId?: string;
  [param: `p_${string}`]: number;
}

// ── Background (a queue of pictures under every layer) ──────────────────────

/** The longest side a background image is kept at. */
export const BACKGROUND_IMAGE_SIDE = 2048;
/** Largest background image a record keeps (data URL characters, about 3 MB of file). */
export const BACKGROUND_IMAGE_MAX = 4_200_000;
/**
 * Largest background video a record keeps (file bytes). Bigger ones play for
 * this session only: saves live in browser storage, which holds a few MB.
 */
export const BACKGROUND_VIDEO_KEEP = 2.5 * 1024 * 1024;
/** Data URL characters for BACKGROUND_VIDEO_KEEP bytes (base64 is 4/3 the size), with room for the header. */
export const BACKGROUND_VIDEO_MAX = Math.ceil((BACKGROUND_VIDEO_KEEP * 4) / 3) + 100;
export const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
export const DATA_VIDEO = /^data:video\/(mp4|webm|quicktime|ogg|x-m4v);base64,[A-Za-z0-9+/]+=*$/;
/** Sources a Background layer holds at most. */
export const BACKGROUND_QUEUE_MAX = 24;
/** Largest copy of a saved graph a source keeps (JSON characters). */
export const BACKGROUND_GRAPH_MAX = 600_000;

/**
 * What a Background source is:
 *   graph   a graph rendered live as a shader: this graph, a bundled example or a saved graph
 *   script  a JavaScript sketch (setup / draw on a 2D canvas the size of the picture)
 *   image   a still picture (a data URL)
 *   video   a video file (a data URL, or '' when too big to keep: this session only)
 *   colour  a flat colour
 */
export type BackgroundItemKind = 'graph' | 'script' | 'image' | 'video' | 'colour';
export const BACKGROUND_ITEM_KINDS: readonly BackgroundItemKind[] = ['graph', 'script', 'image', 'video', 'colour'];

/** One source in a Background layer's queue. Only the fields its kind uses are set. */
export interface BackgroundItem {
  id: string;
  kind: BackgroundItemKind;
  name: string;
  /** graph: `this` (the open graph), `example:<key>` (a bundled example) or `saved:<name>` (a saved graph, copied into `nodes`). */
  graph?: string;
  /** graph from a saved graph: its nodes as they were when it was added, so the setup carries it anywhere. */
  nodes?: unknown[];
  /** script: the sketch, and whether it draws in 2D or 3D (a 3D Script, on WebGL). */
  code?: string;
  mode?: '2d' | '3d';
  /** image, video: the file as a data URL (a video too big to keep has '' and plays this session only). */
  src?: string;
  /** image: the image background it came from (lib/backgroundLibrary.ts), kept for relinking; `src` always carries the picture. */
  libraryId?: string;
  /** video: its size in bytes, and how it plays. */
  bytes?: number;
  loop?: boolean;
  muted?: boolean;
  rate?: number;
  /** colour: the colour. */
  colour?: RGB;
}

/**
 * The picture under every other layer: a queue of sources (graphs, sketches,
 * images, videos, colours), one showing at a time. `index` picks it (a number
 * a control or any mapping can drive), `offset` rotates the queue, and the
 * Change background actions step through it. The background itself can be
 * moved, scaled and turned, and changes cut or crossfade. Only the showing
 * source runs (and the outgoing one during a crossfade). At most one per
 * setup, always first in `layers` (drawn at the bottom).
 */
export interface BackgroundLayer extends LayerBase {
  kind: 'background';
  sources: BackgroundItem[];
  /** Which source shows, 0 = the first (rounded; the Next and Previous actions count on from it). */
  index: number;
  /** Rotates the queue: index i shows source i + offset (wrapping round). */
  offset: number;
  /** Where the background's centre sits (0..1, y up), its size (1 = as fitted) and its turn in degrees. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** How an image or video meets the picture: fill (crop), fit inside, or stretch. */
  fit: 'cover' | 'contain' | 'stretch';
  /** Under everything: the bars around a fitted picture, a source still loading. */
  colour: RGB;
  transition: 'cut' | 'fade';
  /** Crossfade length in seconds. */
  duration: number;
}

/** A queue position: index + actions' steps + offset, wrapped into the queue (-1 when it is empty). */
export function queueSlot(index: number, step: number, offset: number, n: number): number {
  if (!(n > 0)) return -1;
  const k = Math.round(Number.isFinite(index) ? index : 0) + Math.round(step) + Math.round(Number.isFinite(offset) ? offset : 0);
  return ((k % n) + n) % n;
}

function parseBackgroundItem(raw: unknown): BackgroundItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id ? r.id.slice(0, 80) : null;
  const kind = BACKGROUND_ITEM_KINDS.includes(r.kind as BackgroundItemKind) ? r.kind as BackgroundItemKind : null;
  if (!id || !kind) return null;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 120) : kind === 'graph' ? 'Graph' : kind === 'script' ? 'Sketch' : kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'Colour';
  const out: BackgroundItem = { id, kind, name };
  switch (kind) {
    case 'graph': {
      const g = typeof r.graph === 'string' ? r.graph : '';
      if (g === 'this') out.graph = 'this';
      else if (/^example:[A-Za-z0-9_.-]{1,120}$/.test(g)) out.graph = g;
      else if (/^saved:.{1,200}$/.test(g) && Array.isArray(r.nodes) && r.nodes.length && JSON.stringify(r.nodes).length <= BACKGROUND_GRAPH_MAX) { out.graph = g; out.nodes = r.nodes as unknown[]; }
      else return null;
      break;
    }
    case 'script': out.code = typeof r.code === 'string' ? r.code.slice(0, 200_000) : ''; if (r.mode === '3d') out.mode = '3d'; break;
    case 'image':
      if (typeof r.src !== 'string' || r.src.length > BACKGROUND_IMAGE_MAX || !DATA_IMAGE.test(r.src)) return null;
      out.src = r.src;
      if (typeof r.libraryId === 'string' && r.libraryId) out.libraryId = keepLibraryId(r.libraryId);
      break;
    case 'video': {
      out.src = typeof r.src === 'string' && r.src.length <= BACKGROUND_VIDEO_MAX && DATA_VIDEO.test(r.src) ? r.src : '';
      out.bytes = typeof r.bytes === 'number' && Number.isFinite(r.bytes) && r.bytes > 0 ? Math.round(r.bytes) : 0;
      out.loop = r.loop !== false; out.muted = r.muted !== false;
      out.rate = typeof r.rate === 'number' && Number.isFinite(r.rate) ? Math.max(0.1, Math.min(4, r.rate)) : 1;
      // A video from a linked folder (docs/linked-folders.md): played from disk, named by its reference.
      if (isLinkedRef(r.libraryId) && r.libraryId.length <= LINKED_REF_MAX) out.libraryId = r.libraryId;
      break;
    }
    case 'colour': {
      const c = r.colour;
      out.colour = Array.isArray(c) && c.length >= 3 && c.slice(0, 3).every(n => typeof n === 'number' && Number.isFinite(n))
        ? [Math.max(0, Math.min(1, c[0])), Math.max(0, Math.min(1, c[1])), Math.max(0, Math.min(1, c[2]))] : [0, 0, 0];
      break;
    }
  }
  return out;
}

/** A queue from a file: sources that don't parse are dropped, ids stay unique, at most BACKGROUND_QUEUE_MAX. */
export function parseBackgroundItems(v: unknown): BackgroundItem[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: BackgroundItem[] = [];
  for (const raw of v) {
    const it = parseBackgroundItem(raw);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= BACKGROUND_QUEUE_MAX) break;
  }
  return out;
}


// ── Data (a dataset drawn over the picture: play/kit/data.js) ────────────────

/** How a Data layer draws a table. */
export type DataView = 'points' | 'path' | 'bars' | 'pie' | 'lines';
/** How a text dataset is cut into chunks. */
export type DataSplit = 'lines' | 'separator' | 'words' | 'letters' | 'chunks';

/**
 * A dataset (src/data/) drawn over the picture: a table as points, a path,
 * bars, a pie or lines; text one chunk (or a window of chunks) at a time in
 * a text style. Which rows show steps like the Background queue: Offset (a
 * number any control or mapping can drive) plus Next / Previous / Random /
 * Go to actions, with a cut or a crossfade. Columns are named ('' = none).
 */
export interface DataLayer extends LayerBase {
  kind: 'data';
  /** The dataset's id in the graph file ('' = none chosen yet). */
  dataset: string;
  view: DataView;
  /** Points and path: the columns across and up. */
  xCol: string;
  yCol: string;
  /** Bars, pie, lines: the name of each bar or slice (lines: one line per value), and its number. */
  categoryCol: string;
  valueCol: string;
  /** Points: size, opacity, rotation (degrees) and a label from columns. */
  sizeCol: string;
  opacityCol: string;
  rotationCol: string;
  labelCol: string;
  /** The current row's value of this column, written above the view. */
  captionCol: string;
  /** tint: one colour · rgb: three columns (0–1 or 0–255) · palette: one column (or row order) through a palette. */
  colour: 'tint' | 'rgb' | 'palette';
  colourCol: string;
  rCol: string;
  gCol: string;
  bCol: string;
  color: RGB;
  palette: number;
  /** centred: 0,0 in the middle, each axis −1…1 · corner: 0,0 bottom-left, min…max across. */
  axes: 'centred' | 'corner';
  /** centred: normalise over min…max (range), or symmetric around 0 (zero). */
  centre: 'range' | 'zero';
  /** Fill the picture, or a region (x, y its centre; w, h in picture heights) moved and sized on the picture. */
  fit: 'picture' | 'region';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Points and path: a unit across as long as a unit up (a map, a route keeps its shape). */
  equal: boolean;
  axisLine: boolean;
  grid: boolean;
  ticks: boolean;
  labels: boolean;
  mark: 'dot' | 'square' | 'triangle';
  /** Mark size in px; with a size column, from sizeMin to sizeMax. */
  size: number;
  sizeMin: number;
  sizeMax: number;
  /** Path and lines: line width in px, and how much of them is drawn (0…1). */
  lineWidth: number;
  trim: number;
  /** Mark the current row (Show all or a range). */
  highlight: boolean;
  opacity: number;
  blend: BlendMode;
  // Text datasets
  split: DataSplit;
  separator: string;
  chunkSize: number;
  /** text: as written · frequency: each chunk once, most frequent first · alphabetical: each once, A to Z. */
  order: 'text' | 'frequency' | 'alphabetical';
  /** Show how often each chunk occurs. */
  counts: boolean;
  // The text style (a Text layer's), for chunks, labels and ticks
  textSize: number;
  textColor: RGB;
  font: 'sans' | 'serif' | 'mono';
  fontUrl: string;
  weight: number;
  matte: MatteMode;
  /** Axis and point labels, in px. */
  labelSize: number;
  // Stepping
  show: 'all' | 'range' | 'window';
  /** range: rows from…to, counting from 1. */
  from: number;
  to: number;
  /** window: how many rows show from the current one. */
  count: number;
  /** window: Next and Previous move one row, or a whole window (pages). */
  stepBy: 'row' | 'window';
  /** Which row is current (the window starts there): Next and Previous count on from it. */
  offset: number;
  transition: 'cut' | 'fade';
  duration: number;
}

/**
 * How many rows (or text chunks) a Data layer's dataset has, for its Offset,
 * From and To sliders. The app sets it (play/dataLayer.ts) from the dataset
 * store; until then it is 0 and the sliders run to 100.
 */
let dataItemCount: (l: DataLayer) => number = () => 0;
export function setDataItemCount(fn: (l: DataLayer) => number): void { dataItemCount = fn; }

export type PlayLayer = NullLayer | TextLayer | ImageLayer | ParticlesLayer | ShapeLayer | AudioLayer | GlyphsLayer | ContoursLayer | LensLayer | BrushLayer | BodiesLayer | CameraLayer | ClonerLayer | ScriptLayer | BackgroundLayer | DataLayer | VideoLayer | DrumPadLayer | RelationshipLayer;
export type PlayLayerKind = PlayLayer['kind'];

export const LAYER_KINDS: readonly PlayLayerKind[] = ['null', 'text', 'image', 'particles', 'shape', 'audio', 'glyphs', 'contours', 'lens', 'brush', 'bodies', 'camera', 'cloner', 'script', 'background', 'data', 'video', 'drumpad', 'relationship'];

/** The starter sketch a new Script layer holds. */
export const DEFAULT_SCRIPT = `// A sketch: setup runs once, draw runs every frame.
// s.ctx is a 2D canvas the size of the picture (s.width × s.height, pixels).
// Sliders you declare here appear on the layer and can be Play controls.
const params = {
  count: { value: 24, min: 1, max: 200, step: 1, label: 'Dots' },
  size:  { value: 18, min: 2, max: 80, label: 'Size' },
  speed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Speed' },
};

let dots = [];

function setup(s) {
  dots = [];
  for (let i = 0; i < 200; i++) dots.push({ x: Math.random() * s.width, y: Math.random() * s.height, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120 });
}

function draw(s) {
  const { ctx, width, height, dt, params, mouse } = s;
  for (let i = 0; i < params.count; i++) {
    const d = dots[i];
    d.x += d.vx * dt * params.speed; d.y += d.vy * dt * params.speed;
    if (d.x < 0 || d.x > width) d.vx *= -1;
    if (d.y < 0 || d.y > height) d.vy *= -1;
    const near = Math.hypot(d.x - mouse.x, d.y - mouse.y) < 120;
    ctx.fillStyle = near ? '#ffd166' : 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(d.x, d.y, params.size * (near ? 1.4 : 1) * 0.5, 0, Math.PI * 2); ctx.fill();
  }
}
`;
export const DEFAULT_SCRIPT_PARAMS: ScriptParamDef[] = [
  { key: 'count', label: 'Dots', value: 24, min: 1, max: 200, step: 1 },
  { key: 'size', label: 'Size', value: 18, min: 2, max: 80 },
  { key: 'speed', label: 'Speed', value: 1, min: 0, max: 4, step: 0.05 },
];

/** The starter sketch a new 3D Script layer holds. */
export const DEFAULT_SCRIPT_3D = `// A 3D sketch: setup runs once, draw runs every frame, drawn with WebGL over the picture.
// The origin is the middle of the picture: x goes right, y down, z toward you, in pixels.
// Drag on the picture to turn the camera (orbitControl). Nothing paints the background,
// so the shader shows through; call background() for a solid one.
const params = {
  count: { value: 12, min: 1, max: 60, step: 1, label: 'Boxes' },
  size:  { value: 60, min: 10, max: 200, label: 'Size' },
  speed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Speed' },
};

function draw(s) {
  const { params, time } = s;
  orbitControl();
  ambientLight(60);
  directionalLight(255, 255, 255, -0.4, 0.6, -1);
  noStroke();
  const r = min(width, height) * 0.3;
  for (let i = 0; i < params.count; i++) {
    const a = (i / params.count) * TWO_PI + time * 0.3 * params.speed;
    push();
    translate(cos(a) * r, sin(a * 2) * r * 0.2, sin(a) * r);
    rotateX(time * params.speed + i);
    rotateY(time * params.speed * 0.7);
    fill(hsl((i / params.count) * 360, 80, 60));
    box(params.size);
    pop();
  }
}
`;
export const DEFAULT_SCRIPT_3D_PARAMS: ScriptParamDef[] = [
  { key: 'count', label: 'Boxes', value: 12, min: 1, max: 60, step: 1 },
  { key: 'size', label: 'Size', value: 60, min: 10, max: 200 },
  { key: 'speed', label: 'Speed', value: 1, min: 0, max: 4, step: 0.05 },
];

/** A 3D Script layer's starting point: the 3D starter and its controls at their declared values. */
export function script3dDefaults(): Pick<ScriptLayer, 'mode' | 'code' | 'paramDefs'> & Record<`p_${string}`, number> {
  const out: Pick<ScriptLayer, 'mode' | 'code' | 'paramDefs'> & Record<`p_${string}`, number> = { mode: '3d', code: DEFAULT_SCRIPT_3D, paramDefs: DEFAULT_SCRIPT_3D_PARAMS.map(d => ({ ...d })) };
  for (const d of DEFAULT_SCRIPT_3D_PARAMS) out[`p_${d.key}`] = d.value;
  return out;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

type Defaults<T> = Omit<T, 'id' | 'label' | 'visible' | 'kind'>;

const LAYER_DEFAULTS: { [K in PlayLayerKind]: Defaults<Extract<PlayLayer, { kind: K }>> } = {
  null: { toShader: true, x: 0.5, y: 0.5, size: 10, color: '#3a6ff7', follow: 'none', followId: '', handSide: 'right', handPoint: 8, spring: 0.5, wobble: 0.3, role: 'none', radius: 0.04, strength: 1, tilt: 0 },
  text: {
    toShader: true, text: 'PLAY', x: 0.5, y: 0.5, size: 0.25, rotation: 0, opacity: 1, color: [1, 1, 1], font: 'sans', fontUrl: '', weight: 700, blend: 'normal', matte: 'over',
    sequence: false, interval: 0, transition: 'fade',
  },
  image: { toShader: true, src: '', x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, color: [0, 0, 0], blend: 'normal', matte: 'over' },
  particles: {
    toShader: true, count: 800,
    field: 'flow', speed: 1, steer: 0.5, turns: 1, angle: 0, noiseScale: 3, noiseEvolve: 0.2, flat: 'wander', readFrom: 'picture', detail: 'coarse', collide: 0,
    flock: 0, flockRadius: 0.06, flockAlign: 1, flockCohere: 0.6, flockSeparate: 1.2, flockSpace: 0.4, scatter: 1, showField: false,
    attractor: 'none', force: 'gravitate', strength: 1, catchRadius: 0.02,
    emit: 'stream', spawn: 'anywhere', spawnRadius: 0.2, edges: 'wrap', life: 0, fade: 0, seed: 0, nullId: '',
    splitRate: 1, splitJitter: 0.3, splitChildren: 1, splitPush: 0.08, multSpread: 0.035, multLife: 'stay', multAfter: 'hold',
    returnSpring: 1, pairRadius: 0.3, seekSpeed: 0.15, loopHold: 6,
    shape: 'dot', rotate: 'heading', sprite: '', crop: false, tintSprite: false, size: 2, sizeJitter: 0.3, opacity: 0.8,
    colour: 'tint', color: [1, 1, 1], palette: 1, paletteBy: 'heading',
    sizeBy: 'none', sizeAmount: 1, opacityBy: 'none', opacityAmount: 0.5, falloff: 0.3, links: 0,
    reveal: false, trail: 0.6, goo: false, gooBlend: 2.5, gooThreshold: 0.5, gooSoft: 0.2, blend: 'normal',
  },
  shape: {
    toShader: true, shape: 'box', x: 0.5, y: 0.5, w: 0.3, h: 0.2, rotation: 0, round: 0, points: [], sourceId: '', threshold: 0.5, invert: false,
    pointIds: [], pathStyle: 'fill', hull: true, webReach: 0, circleMode: 'spread', onLost: 'fade',
    show: true, fill: [1, 1, 1], fillOpacity: 0.15, stroke: [1, 1, 1], strokeWidth: 1.5, trim: 1, blend: 'normal',
    action: 'wall', strength: 1, reach: 0.15, bounce: 0, angle: 0, targetId: '', tint: [1, 0.35, 0.3], scale: 2, tilt: 0, affects: '',
  },
  audio: { toShader: true, input: 'live', fileName: '', style: 'wave', scroll: 1, x: 0.5, y: 0.5, w: 1.2, h: 0.35, bars: 48, gain: 1.5, smooth: 0.5, thickness: 2, mirror: false, colour: 'tint', color: [1, 1, 1], palette: 1, opacity: 0.9, blend: 'screen' },
  glyphs: { toShader: true, style: 'ascii', cell: 12, chars: ' .:-=+*#%@', colour: 'picture', color: [1, 1, 1], palette: 1, invert: false, shift: 0, spread: 0, contrast: 1.2, cover: true, background: [0, 0, 0], readFrom: 'picture', sourceId: '', opacity: 1, blend: 'normal' },
  contours: { toShader: true, levels: 10, width: 1.2, flow: 0.2, detail: 'fine', colour: 'palette', color: [1, 1, 1], palette: 1, readFrom: 'picture', opacity: 0.9, blend: 'screen' },
  lens: { toShader: true, x: 0.5, y: 0.5, radius: 0.18, effect: 'magnify', amount: 2, follow: 'mouse', nullId: '', ring: 1.5, ringColor: [1, 1, 1], opacity: 1 },
  brush: { toShader: true, paint: 'drag', nullId: '', size: 14, colour: 'palette', color: [1, 1, 1], palette: 1, fade: 4, walls: false, opacity: 0.9, blend: 'screen' },
  relationship: {
    toShader: false, members: [], relation: 'chase', speed: 0.5, accel: 2, turn: 0.6, sight: 0.6, flee: 0.35, wander: 0.5,
    strength: 0.6, repelDistance: 0.3, repelCurve: 'linear', attractMode: 'overshoot', minDistance: 0.2, falloff: 0.5,
    springiness: 0.5, bounciness: 0.3, damping: 0.3, maxSpeed: 1, wallChaser: 'bounce', wallPrey: 'bounce', wallMember: 'bounce',
    respawnAt: 'random', respawnDelay: 1.5, catchRadius: 0.04, onCatch: 'respawn', catchSignal: '', debug: false,
    ...relationNumbers(),
  },
  bodies: { toShader: true, source: 'letters', text: 'PLAY', count: 24, size: 48, gravity: 1, angle: 0, bounce: 0.35, friction: 0.3, font: 'sans', fontUrl: '', colour: 'tint', color: [1, 1, 1], palette: 1, solidPicture: false, threshold: 0.6, scatter: 1, opacity: 1, blend: 'normal' },
  camera: { toShader: true, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, color: [0, 0, 0], mirror: true, blend: 'normal', matte: 'over' },
  video: {
    toShader: true, videoId: '', fileName: '', bytes: 0, fit: 'contain', x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, color: [0, 0, 0], blend: 'normal', matte: 'over',
    playing: true, loop: true, speed: 1, start: 0, follow: true, sound: 'off', volume: 0.8,
  },
  drumpad: { toShader: false, pads: Array.from({ length: DP_PADS }, emptyDrumPad), volume: 0.9, keys: true, midi: true, channel: 0, baseNote: 36, grid: true, ...drumPadNumbers() },
  cloner: {
    toShader: true, sourceId: '', hideSource: true, arrange: 'grid', count: 12, cols: 5, rows: 3, x: 0.5, y: 0.5, x2: 0.9, y2: 0.5, spacingX: 0.25, spacingY: 0.25,
    radius: 0.3, startAngle: 0, sweep: 360, face: false, pathId: '', spread: 1, jitter: 0, seed: 1,
    scale: 0.5, rotation: 0, opacity: 1, stepX: 0, stepY: 0, stepScale: 0, stepRotation: 0, stepOpacity: 0, stepHue: 0,
    randScale: 0, randRotation: 0, randOpacity: 0, randHue: 0,
    effectors: [], effRadius: 0.25, effSoftness: 0.6, effPush: 0, effScale: 1, effRotate: 0, effOpacity: 0, effHue: 0, effHide: 0, effInvert: false, blend: 'normal',
  },
  script: { toShader: true, mode: '2d', code: DEFAULT_SCRIPT, paramDefs: DEFAULT_SCRIPT_PARAMS, clear: true, readPicture: false, opacity: 1, blend: 'normal', p_count: 24, p_size: 18, p_speed: 1 },
  background: { toShader: false, sources: [], index: 0, offset: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, fit: 'cover', colour: [0, 0, 0], transition: 'fade', duration: 0.8 },  data: {
    toShader: true, dataset: '', view: 'points', xCol: '', yCol: '', categoryCol: '', valueCol: '', sizeCol: '', opacityCol: '', rotationCol: '', labelCol: '', captionCol: '',
    colour: 'tint', colourCol: '', rCol: '', gCol: '', bCol: '', color: [1, 0.82, 0.4], palette: 1,
    axes: 'corner', centre: 'range', fit: 'picture', x: 0.5, y: 0.5, w: 1.2, h: 0.7, equal: false, axisLine: true, grid: false, ticks: true, labels: true,
    mark: 'dot', size: 8, sizeMin: 3, sizeMax: 24, lineWidth: 2.5, trim: 1, highlight: true, opacity: 1, blend: 'normal',
    split: 'words', separator: ',', chunkSize: 12, order: 'text', counts: false,
    textSize: 0.14, textColor: [1, 1, 1], font: 'serif', fontUrl: '', weight: 600, matte: 'over', labelSize: 11,
    show: 'all', from: 1, to: 10, count: 1, stepBy: 'row', offset: 0, transition: 'fade', duration: 0.5,
  },
};

/** A fresh layer of a kind with sensible defaults. */
export function defaultLayer(kind: PlayLayerKind, id: string, label: string): PlayLayer {
  const d = LAYER_DEFAULTS[kind] as unknown as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) copy[k] = Array.isArray(v) ? v.map(x => (x && typeof x === 'object' && !Array.isArray(x) ? { ...x } : x)) : v;
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
  | { t: 'points' }
  | { t: 'params' }
  /** A list of layer ids. */
  | { t: 'ids' }
  /** A Background layer's queue. */
  | { t: 'queue' }
  /** A Drum pad layer's pads. */
  | { t: 'drumpads' }
  /** A Relationship layer's members. */
  | { t: 'members' };

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
    toShader: B, x: N(), y: N(), size: N(0), color: { t: 'hex' }, follow: E('none', 'mouse', 'null', 'hand'), followId: S, handSide: E('right', 'left', 'any'), handPoint: N(0, 20, true), spring: unit, wobble: unit,
    role: E('none', 'emitter', 'absorber', 'attract', 'repel', 'vortex'), radius: N(0.001), strength: N(0), tilt: N(0, 85),
  },
  text: {
    toShader: B, text: S, x: N(), y: N(), size: N(0.005), rotation: N(), opacity: unit, color: C, font: E('sans', 'serif', 'mono'), fontUrl: S, weight: N(100, 900), blend: blendF, matte: matteF,
    sequence: B, interval: N(0), transition: E('cut', 'fade', 'rise', 'type'),
  },
  image: { toShader: B, src: S, x: N(), y: N(), scale: N(0.01), rotation: N(), opacity: unit, color: C, blend: blendF, matte: matteF },
  particles: {
    toShader: B, count: N(1, 5000, true),
    field: E('flow', 'climb', 'descend', 'noise', 'none'), speed: N(0), steer: unit, turns: N(0), angle: N(), noiseScale: N(0.1), noiseEvolve: N(0),
    flat: E('wander', 'settle'), readFrom: E('picture', 'camera'), detail: E('coarse', 'fine'), collide: unit,
    flock: unit, flockRadius: N(0.005, 0.5), flockAlign: N(0, 2), flockCohere: N(0, 2), flockSeparate: N(0, 2), flockSpace: N(0.05, 1), scatter: N(0, 10), showField: B,
    attractor: E('none', 'mouse', 'press', 'null'), force: E('gravitate', 'spiral', 'repel'), strength: N(0), catchRadius: N(0),
    emit: E('stream', 'burst', 'multiply'), spawn: E('anywhere', 'edges', 'center', 'null'), spawnRadius: N(0), edges: E('wrap', 'bounce', 'respawn', 'random'), life: N(0), fade: unit, seed: N(0, 1e9, true), nullId: S,
    shape: E('dot', 'square', 'triangle', 'streak', 'ring', 'star', 'image'), rotate: E('heading', 'spin', 'none'), sprite: S, crop: B, tintSprite: B,
    size: N(0.1), sizeJitter: unit, opacity: unit, colour: E('tint', 'picture', 'palette'), color: C, palette: N(0, 9, true),
    paletteBy: E('heading', 'speed', 'age', 'brightness'), sizeBy: { t: 'enum', values: MODS }, sizeAmount: N(), opacityBy: { t: 'enum', values: MODS }, opacityAmount: N(),
    falloff: N(0.01), links: N(0, 0.5), reveal: B, trail: unit, blend: blendF,
    splitRate: N(0.01, 20), splitJitter: unit, splitChildren: N(1, 4, true), splitPush: N(0, 2), multSpread: N(0, 0.5),
    multLife: E('stay', 'flow', 'return', 'annihilate'), multAfter: E('loop', 'respawn', 'hold'), returnSpring: N(0, 10), pairRadius: N(0.02, 2), seekSpeed: N(0.005, 2), loopHold: N(0, 120),
    goo: B, gooBlend: N(1, 8), gooThreshold: N(0.01, 0.99), gooSoft: unit,
  },
  shape: {
    toShader: B, shape: E('box', 'circle', 'line', 'polygon', 'layer', 'picture', 'path'), x: N(), y: N(), w: N(0.001), h: N(0.001), rotation: N(), round: N(0, 0.5),
    points: { t: 'points' }, sourceId: S, threshold: unit, invert: B,
    pointIds: { t: 'ids' }, pathStyle: E('fill', 'smooth', 'circle', 'lines', 'web'), hull: B, webReach: N(0, 4), circleMode: E('spread', 'first'), onLost: E('drop', 'hold', 'fade'),
    show: B, fill: C, fillOpacity: unit, stroke: C, strokeWidth: N(0), trim: unit, blend: blendF,
    action: E('none', 'wall', 'container', 'attract', 'repel', 'sink', 'portal', 'emitter', 'absorber', 'wind', 'vortex', 'drag', 'tint', 'resize', 'sensor'),
    strength: N(0), reach: N(0.001), bounce: unit, angle: N(), targetId: S, tint: C, scale: N(0), tilt: N(0, 85), affects: S,
  },
  audio: {
    toShader: B, input: E('live', 'file'), fileName: S, style: E('wave', 'bars', 'ring', 'blob', 'spectrogram'), scroll: N(0), x: N(), y: N(), w: N(0.01), h: N(0.01), bars: N(4, 256, true), gain: N(0), smooth: unit, thickness: N(0.5),
    mirror: B, colour: E('tint', 'palette'), color: C, palette: N(0, 9, true), opacity: unit, blend: blendF,
  },
  glyphs: {
    toShader: B, style: E('ascii', 'dots', 'squares', 'lines', 'cross'), cell: N(3, 200), chars: S, colour: E('tint', 'picture', 'palette', 'own'), color: C, palette: N(0, 9, true),
    invert: B, shift: N(), spread: unit, contrast: N(0.1, 5), cover: B, background: C, readFrom: E('picture', 'camera', 'layer'), sourceId: S, opacity: unit, blend: blendF,
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
    font: E('sans', 'serif', 'mono'), fontUrl: S, colour: E('tint', 'palette'), color: C, palette: N(0, 9, true), solidPicture: B, threshold: unit, scatter: N(0, 10), opacity: unit, blend: blendF,
  },
  camera: { toShader: B, x: N(), y: N(), scale: N(0.01), rotation: N(), opacity: unit, color: C, mirror: B, blend: blendF, matte: matteF },
  relationship: {
    toShader: B, members: { t: 'members' }, relation: E('chase', 'repel', 'attract'), speed: N(0, 5), accel: N(0, 20), turn: unit, sight: N(0, 3), flee: N(0, 3), wander: N(0, 2),
    strength: N(0, 5), repelDistance: N(0.001, 3), repelCurve: E('linear', 'inverse'), attractMode: E('keep', 'overshoot'), minDistance: N(0, 3), falloff: unit,
    springiness: unit, bounciness: unit, damping: unit, maxSpeed: N(0.01, 10), wallChaser: E('bounce', 'repel', 'wrap', 'respawn', 'escape'), wallPrey: E('bounce', 'repel', 'wrap', 'respawn', 'escape'), wallMember: E('bounce', 'repel', 'wrap', 'respawn', 'escape'),
    respawnAt: E('random', 'fixed', 'far'), respawnDelay: N(0, 60), catchRadius: N(0, 1), onCatch: E('none', 'respawn', 'swap'), catchSignal: S, debug: B,
    ...Object.fromEntries(Array.from({ length: RELATION_MAX_MEMBERS }, (_, i) => [relationPictureKey(i), N(0, 5)] as const)),
  },
  drumpad: {
    toShader: B, pads: { t: 'drumpads' }, volume: N(0, 1.5), keys: B, midi: B, channel: N(0, 16, true), baseNote: N(0, 112, true), grid: B,
    ...Object.fromEntries(Array.from({ length: DP_PADS }, (_, i) => DP_PARAMS.map(p => [dpKey(i, p.key), N(p.min, p.max)] as const)).flat()),
  },
  video: {
    toShader: B, videoId: S, fileName: S, bytes: N(0), fit: E('height', 'contain', 'cover'), x: N(), y: N(), scale: N(0.01), rotation: N(), opacity: unit, color: C, blend: blendF, matte: matteF,
    playing: B, loop: B, speed: N(0.05, 8), start: N(0), follow: B, sound: E('off', 'listen', 'play'), volume: unit,
  },
  cloner: {
    toShader: B, sourceId: S, hideSource: B, arrange: E('grid', 'ring', 'line', 'path', 'points'), count: N(1, 400, true), cols: N(1, 40, true), rows: N(1, 40, true),
    x: N(), y: N(), x2: N(), y2: N(), spacingX: N(0), spacingY: N(0), radius: N(0), startAngle: N(), sweep: N(-360, 360), face: B, pathId: S, spread: unit, jitter: N(0), seed: N(0, 9999, true),
    scale: N(0), rotation: N(), opacity: unit, stepX: N(), stepY: N(), stepScale: N(), stepRotation: N(), stepOpacity: N(), stepHue: N(),
    randScale: N(0), randRotation: N(0), randOpacity: N(0), randHue: N(0),
    effectors: { t: 'ids' }, effRadius: N(0), effSoftness: unit, effPush: N(), effScale: N(), effRotate: N(), effOpacity: N(), effHue: N(), effHide: unit, effInvert: B, blend: blendF,
  },
  script: { toShader: B, mode: E('2d', '3d'), code: S, paramDefs: { t: 'params' }, clear: B, readPicture: B, opacity: unit, blend: blendF },
  background: {
    toShader: B, sources: { t: 'queue' }, index: N(0, 999), offset: N(-999, 999), x: N(), y: N(), scale: N(0.01, 20), rotation: N(),
    fit: E('cover', 'contain', 'stretch'), colour: C, transition: E('cut', 'fade'), duration: N(0, 30),
  },  data: {
    toShader: B, dataset: S, view: E('points', 'path', 'bars', 'pie', 'lines'), xCol: S, yCol: S, categoryCol: S, valueCol: S, sizeCol: S, opacityCol: S, rotationCol: S, labelCol: S, captionCol: S,
    colour: E('tint', 'rgb', 'palette'), colourCol: S, rCol: S, gCol: S, bCol: S, color: C, palette: N(0, 9, true),
    axes: E('centred', 'corner'), centre: E('range', 'zero'), fit: E('picture', 'region'), x: N(), y: N(), w: N(0.01, 10), h: N(0.01, 10), equal: B, axisLine: B, grid: B, ticks: B, labels: B,
    mark: E('dot', 'square', 'triangle'), size: N(0.5, 200), sizeMin: N(0, 200), sizeMax: N(0, 400), lineWidth: N(0.25, 40), trim: unit, highlight: B, opacity: unit, blend: blendF,
    split: E('lines', 'separator', 'words', 'letters', 'chunks'), separator: S, chunkSize: N(1, 10000, true), order: E('text', 'frequency', 'alphabetical'), counts: B,
    textSize: N(0.005, 2), textColor: C, font: E('sans', 'serif', 'mono'), fontUrl: S, weight: N(100, 900), matte: matteF, labelSize: N(4, 64),
    show: E('all', 'range', 'window'), from: N(1, 1e6), to: N(1, 1e6), count: N(1, 1e5), stepBy: E('row', 'window'), offset: N(-1e6, 1e6), transition: E('cut', 'fade'), duration: N(0, 30),
  },
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
    case 'ids': return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : fallback;
    case 'points':
      return Array.isArray(v) && v.length % 2 === 0 && v.length <= 2000 && v.every(n => typeof n === 'number' && Number.isFinite(n)) ? [...v] : fallback;
    case 'params':
      return Array.isArray(v) ? v.filter(isScriptParamDef).slice(0, 32).map(d => ({ ...d })) : fallback;
    case 'queue': return parseBackgroundItems(v);
    case 'drumpads': return parseDrumPads(v);
    case 'members': return parseRelationMembers(v);
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
  // A script's slider values are dynamic keys: keep every finite `p_<key>` number.
  if (kind === 'script') for (const [k, v] of Object.entries(l)) if (k.startsWith('p_') && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  if (kind === 'script') parseScriptExtras(l, out);
  // Made from a layer kind: the id (parsePlayRecord checks the file has it).
  if (kind === 'script' && typeof l.kindId === 'string' && /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]{1,80}$/.test(l.kindId)) out.kindId = l.kindId;
  if (canHaveMatte(kind)) {
    const t = parseTrackMatte(l.trackMatte, id);
    if (t) out.trackMatte = t;
    const masks = parseMasks(l.masks);
    if (masks.length) {
      out.masks = masks;
      // Each mask's numbers, clamped, or its defaults.
      for (const m of masks) for (const prop of MASK_PROP_KEYS) {
        const v = l[maskKey(m.id, prop)], d = MASK_PROPS[prop];
        out[maskKey(m.id, prop)] = typeof v === 'number' && Number.isFinite(v) ? Math.max(d.lo, Math.min(d.hi, v)) : MASK_DEFAULTS[prop];
      }
    }
  }
  return out as unknown as PlayLayer;
}

// ── Track mattes and masks ───────────────────────────────────────────────────

/** Nulls draw nothing and the Background layer is the picture: every other kind can be matted and masked. */
export function canHaveMatte(kind: PlayLayerKind): boolean { return kind !== 'null' && kind !== 'background' && kind !== 'drumpad' && kind !== 'relationship'; }
/** Anything that draws can be a matte, the Background layer (the picture) included. */
export function canBeMatte(kind: PlayLayerKind): boolean { return kind !== 'null' && kind !== 'drumpad' && kind !== 'relationship'; }

function parseTrackMatte(v: unknown, selfId: string): TrackMatte | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id || t.id === selfId) return null;
  return { id: t.id, mode: t.mode === 'luma' ? 'luma' : 'alpha', invert: t.invert === true };
}

export const MASKS_MAX = 16;
const MASK_SHAPES: readonly MaskShape[] = ['rect', 'ellipse', 'polygon'];
const MASK_OPS: readonly MaskOp[] = ['add', 'subtract', 'intersect'];

function parseMasks(v: unknown): LayerMask[] {
  if (!Array.isArray(v)) return [];
  const out: LayerMask[] = [], seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== 'object' || out.length >= MASKS_MAX) continue;
    const m = raw as Record<string, unknown>;
    const id = typeof m.id === 'string' && /^m\d{1,4}$/.test(m.id) ? m.id : '';
    if (!id || seen.has(id)) continue;
    const shape = MASK_SHAPES.includes(m.shape as MaskShape) ? m.shape as MaskShape : 'rect';
    const pts = Array.isArray(m.points) && m.points.length % 2 === 0 && m.points.length <= 2000 && m.points.every(n => typeof n === 'number' && Number.isFinite(n)) ? [...m.points as number[]] : [];
    // A polygon needs three corners; without them it is a rectangle.
    const poly = shape === 'polygon' && pts.length >= 6;
    seen.add(id);
    out.push({ id, shape: poly ? 'polygon' : shape === 'polygon' ? 'rect' : shape, points: poly ? pts : [], op: MASK_OPS.includes(m.op as MaskOp) ? m.op as MaskOp : 'add', invert: m.invert === true });
  }
  return out;
}

export type MaskProp = 'x' | 'y' | 'w' | 'h' | 'rotation' | 'round' | 'feather' | 'expand' | 'opacity';
interface MaskPropDef { label: string; min: number; max: number; step?: number; lo: number; hi: number; hint: string }
/** Same numbers as the kit's KM_MASK_DEFAULTS (play/kit/mattes.js; a test keeps them together). */
export const MASK_DEFAULTS: Readonly<Record<MaskProp, number>> = { x: 0, y: 0, w: 0.5, h: 0.5, rotation: 0, round: 0, feather: 0, expand: 0, opacity: 1 };
/** A mask's numbers: slider range (min, max), what a file may hold (lo, hi), and the tooltip. */
export const MASK_PROPS: Readonly<Record<MaskProp, MaskPropDef>> = {
  x: { label: 'X', min: -1.5, max: 1.5, lo: -4, hi: 4, hint: 'Across from the layer’s centre, in picture heights. The mask moves and turns with the layer.' },
  y: { label: 'Y', min: -1, max: 1, lo: -4, hi: 4, hint: 'Up from the layer’s centre, in picture heights.' },
  w: { label: 'Width', min: 0.01, max: 2, lo: 0.001, hi: 8, hint: 'Width in picture heights.' },
  h: { label: 'Height', min: 0.01, max: 2, lo: 0.001, hi: 8, hint: 'Height in picture heights.' },
  rotation: { label: 'Rotation', min: -180, max: 180, step: 1, lo: -3600, hi: 3600, hint: 'Degrees, clockwise, on top of the layer’s own turn.' },
  round: { label: 'Rounding', min: 0, max: 0.5, lo: 0, hi: 0.5, hint: 'Rectangle corners: 0 is square, 0.5 fully round.' },
  feather: { label: 'Feather', min: 0, max: 0.3, lo: 0, hi: 0.5, hint: 'How soft the edge is, in picture heights. 0 is a hard edge.' },
  expand: { label: 'Expand', min: -0.2, max: 0.2, lo: -0.5, hi: 0.5, hint: 'Grow the mask outward (above 0) or shrink it inward (below 0), in picture heights, before the feather.' },
  opacity: { label: 'Opacity', min: 0, max: 1, lo: 0, hi: 1, hint: 'How much the mask counts. At 0 it does nothing.' },
};
export const MASK_PROP_KEYS = Object.keys(MASK_PROPS) as MaskProp[];

export const maskKey = (id: string, prop: MaskProp | string): string => `mask_${id}_${prop}`;
/** A mask number's key split up, or null for any other key. */
export function maskKeyParts(key: string): { id: string; prop: MaskProp } | null {
  const m = /^mask_(m\d{1,4})_([a-z]+)$/.exec(key);
  return m && m[2] in MASK_PROPS ? { id: m[1], prop: m[2] as MaskProp } : null;
}
/** What a mask shows as: "Mask 2". */
export const maskLabel = (id: string): string => `Mask ${id.slice(1)}`;

/** Would `consumerId` taking `matteId` as its matte make a loop? (Also true for itself.) The same walk as the kit's kmWouldCycle. */
export function matteWouldCycle(layers: ReadonlyArray<Pick<PlayLayer, 'id' | 'trackMatte'>>, consumerId: string, matteId: string): boolean {
  const byId = new Map(layers.map(l => [l.id, l]));
  let id = matteId;
  for (let guard = 0; id && guard <= layers.length; guard++) {
    if (id === consumerId) return true;
    id = byId.get(id)?.trackMatte?.id ?? '';
  }
  return false;
}

/** The layers `consumerId` may use as its matte: anything that draws, except itself and anything that would loop back to it. */
export function matteCandidates(layers: readonly PlayLayer[], consumerId: string): PlayLayer[] {
  return layers.filter(l => canBeMatte(l.kind) && !matteWouldCycle(layers, consumerId, l.id));
}

/** The layers that use `id` as their matte. */
export function matteUsers(layers: readonly PlayLayer[], id: string): PlayLayer[] {
  return layers.filter(l => l.trackMatte?.id === id);
}

/** Mattes that point at a missing layer or a null, or round in a loop, dropped (a file loads whatever it says). */
export function repairMattes(layers: PlayLayer[]): PlayLayer[] {
  const drop = (l: PlayLayer): PlayLayer => { const c = { ...l }; delete c.trackMatte; return c; };
  // First the ones that point nowhere useful.
  let out = layers.map(l => {
    if (!l.trackMatte) return l;
    const m = layers.find(x => x.id === l.trackMatte!.id);
    return !m || !canBeMatte(m.kind) || !canHaveMatte(l.kind) ? drop(l) : l;
  });
  // Then loops: walking down each chain, the link that closes a loop goes.
  for (const l of out) {
    const t = out.find(x => x.id === l.id)?.trackMatte;
    if (t && matteWouldCycle(out, l.id, t.id)) out = out.map(x => (x.id === l.id ? drop(x) : x));
  }
  return out.every((l, i) => l === layers[i]) ? layers : out;
}

export function isScriptParamDef(d: unknown): d is ScriptParamDef {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return typeof o.key === 'string' && /^[A-Za-z_]\w{0,30}$/.test(o.key) && typeof o.label === 'string'
    && (o.kind === undefined || o.kind === 'slider' || o.kind === 'toggle' || o.kind === 'button' || o.kind === 'colour' || o.kind === 'choice')
    && [o.value, o.min, o.max].every(n => typeof n === 'number' && Number.isFinite(n)) && (o.step === undefined || typeof o.step === 'number')
    && (o.options === undefined || (Array.isArray(o.options) && o.options.length <= 64 && o.options.every(x => typeof x === 'string')))
    && (o.kind !== 'choice' || (Array.isArray(o.options) && o.options.length > 0))
    && (o.restart === undefined || typeof o.restart === 'boolean') && (o.as === undefined || o.as === 'array') && (o.alpha === undefined || (typeof o.alpha === 'number' && Number.isFinite(o.alpha)));
}


/** A Script layer's other files, its loaded files and its p5 flag, from a file; bad entries are dropped. */
function parseScriptExtras(l: Record<string, unknown>, out: Record<string, unknown>): void {
  if (Array.isArray(l.files)) {
    const seen = new Set<string>([SCRIPT_MAIN_FILE]);
    const files: ScriptFile[] = [];
    for (const f of l.files) {
      if (!f || typeof f !== 'object') continue;
      const { name, code } = f as Record<string, unknown>;
      if (typeof name !== 'string' || typeof code !== 'string' || !SCRIPT_FILE_NAME.test(name) || seen.has(name)) continue;
      seen.add(name);
      files.push({ name, code: code.slice(0, 200_000) });
      if (files.length >= SCRIPT_FILES_MAX) break;
    }
    if (files.length) out.files = files;
  }
  if (Array.isArray(l.assets)) {
    const seen = new Set<string>();
    const assets: ScriptAsset[] = [];
    for (const a of l.assets) {
      if (!a || typeof a !== 'object') continue;
      const r = a as Record<string, unknown>;
      const kind = r.kind === 'image' || r.kind === 'font' || r.kind === 'json' || r.kind === 'text' ? r.kind : null;
      if (!kind || typeof r.name !== 'string' || !r.name || r.name.length > 200 || seen.has(r.name) || typeof r.data !== 'string' || r.data.length > SCRIPT_ASSET_MAX) continue;
      // Images and fonts are data URLs; nothing else is fetched.
      if ((kind === 'image' || kind === 'font') && !/^data:[\w.+-]+\/[\w.+-]+;base64,/.test(r.data)) continue;
      seen.add(r.name);
      assets.push({ name: r.name, kind, mime: typeof r.mime === 'string' ? r.mime.slice(0, 80) : '', data: r.data, ...(typeof r.libraryId === 'string' && r.libraryId ? { libraryId: r.libraryId.slice(0, 80) } : {}) });
      if (assets.length >= SCRIPT_ASSETS_MAX) break;
    }
    if (assets.length) out.assets = assets;
  }
  if (l.p5 === true) out.p5 = true;
}

/** Files from before the particle system: `mode` was the field and `colorFromPicture` the colour; they had no size variety. */
function migrateParticles(l: Record<string, unknown>): void {
  if (l.field !== undefined) return;
  if (l.mode === 'climb' || l.mode === 'descend') { l.field = l.mode; if (l.flat === undefined) l.flat = 'settle'; }
  if (l.colour === undefined && l.colorFromPicture === true) l.colour = 'picture';
  if (l.sizeJitter === undefined) l.sizeJitter = 0;
}

// ── Numeric properties a control can drive ──────────────────────────────────

export interface LayerNumericProp {
  key: string; label: string; min: number; max: number; step?: number; hint: string;
  /** min/max are a physical limit (0–1 opacity, a pad's start in its sample): a typed value is clamped rather than widening the slider's range. */
  hard?: boolean;
}

const X = (what: string): LayerNumericProp => ({ key: 'x', label: 'X', min: 0, max: 1, hint: `${what} across the picture: 0 is the left edge, 1 the right.` });
const Y = (what: string): LayerNumericProp => ({ key: 'y', label: 'Y', min: 0, max: 1, hint: `${what} up the picture: 0 is the bottom, 1 the top.` });
const ROT: LayerNumericProp = { key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1, hint: 'Degrees, clockwise.' };
const OPACITY: LayerNumericProp = { key: 'opacity', label: 'Opacity', min: 0, max: 1, hard: true, hint: 'How solid the layer is. 0 is invisible.' };

/** Numeric layer properties a control can drive, per kind. The control's target is `layer:<layerId>::<key>`. */
export const LAYER_NUMERIC_PROPS: Record<PlayLayerKind, ReadonlyArray<LayerNumericProp>> = {
  null: [
    X('The point'), Y('The point'),
    { key: 'size', label: 'Size', min: 0, max: 60, step: 1, hint: 'Marker radius in pixels. 0 hides the marker; the null still works.' },
    { key: 'spring', label: 'Spring', min: 0, max: 1, hint: 'Following: how hard it is pulled toward what it follows. Low is lazy, high snaps.' },
    { key: 'wobble', label: 'Wobble', min: 0, max: 1, hint: 'Following: how much it overshoots and wobbles before settling. 0 glides straight in.' },
    { key: 'radius', label: 'Radius', min: 0.005, max: 0.4, hint: 'Particle role: how big its zone is (fraction of picture height). Emitters birth particles inside it; absorbers swallow them there.' },
    { key: 'strength', label: 'Strength', min: 0, max: 5, hint: 'Particle role: how hard it launches (emitter), pulls (absorber, attract), pushes (repel) or swirls (vortex).' },
    { key: 'tilt', label: 'Tilt', min: 0, max: 85, step: 1, hint: 'Vortex: lean the swirl back like a disc seen from the side. Orbits become ellipses and particles grow on the near side, shrink on the far side.' },
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
    { key: 'flockSpace', label: 'Personal space', min: 0.05, max: 1, hint: 'Flocking: how close a neighbour may come before it is pushed away, as a share of Sight. Small = tight flocks; large = loose, evenly spread ones.' },
    { key: 'flockSeparate', label: 'Separation', min: 0, max: 2, hint: 'Flocking: how strongly particles keep their distance from neighbours (no pile-ups).' },
    { key: 'strength', label: 'Pull', min: 0, max: 3, hint: 'How hard the attractor pulls (or pushes, for Repel). Stronger near it.' },
    { key: 'scatter', label: 'Scatter', min: 0, max: 5, hint: 'How hard a Scatter (the button, or an action) kicks them. Multiplies the action\'s amount.' },
    { key: 'catchRadius', label: 'Catch', min: 0, max: 0.3, hint: 'Particles this close to the attractor are caught and respawn (fraction of picture height). 0 = never caught.' },
    { key: 'spawnRadius', label: 'Spawn radius', min: 0, max: 0.8, hint: 'Spawn at centre or at a null: how wide the birth circle is (fraction of picture height).' },
    { key: 'splitRate', label: 'Split rate', min: 0.1, max: 5, hint: 'Multiply: splits per second for each particle. The population doubles about every 1 ÷ this seconds (1 = 200 particles in about 8 s).' },
    { key: 'splitJitter', label: 'Split jitter', min: 0, max: 1, hint: 'Multiply: how uneven the time between splits is, so the colony doesn\'t divide in lockstep. 0 = like clockwork.' },
    { key: 'splitChildren', label: 'Buds', min: 1, max: 4, step: 1, hint: 'Multiply: how many new particles each split adds (1 = split in two).' },
    { key: 'splitPush', label: 'Bud push', min: 0, max: 0.4, hint: 'Multiply: how hard a new bud and its parent push apart (fraction of picture height per second).' },
    { key: 'multSpread', label: 'Spread', min: 0, max: 0.15, hint: 'Multiply (Stay, Return, Annihilate): neighbours closer than this drift apart, so the colony grows outward like cells (fraction of picture height). 0 = they pile up.' },
    { key: 'returnSpring', label: 'Return spring', min: 0, max: 5, hint: 'Multiply · Return: how hard each particle is pulled back to where it was born.' },
    { key: 'pairRadius', label: 'Pair radius', min: 0.02, max: 1, hint: 'Multiply · Annihilate: how far a particle looks for a partner (fraction of picture height).' },
    { key: 'seekSpeed', label: 'Seek speed', min: 0.01, max: 1, hint: 'Multiply · Annihilate: how fast partners close in on each other (fraction of picture height per second).' },
    { key: 'loopHold', label: 'Loop hold (s)', min: 0, max: 30, hint: 'Multiply · Loop: seconds at the full count before starting over from one particle. 0 = only when they are all gone.' },
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
    { key: 'gooBlend', label: 'Goo blend', min: 1, max: 6, hint: 'Goo: how far each particle\'s field reaches, as a multiple of its size. Higher = particles merge from further apart, with longer necks.' },
    { key: 'gooThreshold', label: 'Goo threshold', min: 0.05, max: 0.95, hint: 'Goo: where the summed field becomes goo. Lower = fatter blobs that merge sooner; higher = thinner ones that part sooner.' },
    { key: 'gooSoft', label: 'Goo edge', min: 0, max: 1, hint: 'Goo: 0 = a hard edge; higher = a soft, glowing one.' },
  ],
  shape: [
    X('Centre of the shape'), Y('Centre of the shape'),
    { key: 'w', label: 'Width', min: 0.01, max: 2, hint: 'Width in picture heights (a line\'s length).' },
    { key: 'h', label: 'Height', min: 0.01, max: 2, hint: 'Height in picture heights (a line\'s thickness).' },
    ROT,
    { key: 'round', label: 'Rounding', min: 0, max: 0.5, hint: 'Box corners: 0 is square, 0.5 fully round.' },
    { key: 'threshold', label: 'Threshold', min: 0, max: 1, hint: 'Picture shapes: brightness at or above this counts as inside.' },
    { key: 'webReach', label: 'Reach', min: 0, max: 1.5, hint: 'Path web: join only points closer than this (picture heights); links fade as they stretch toward it. 0 joins every pair at full strength.' },
    { key: 'fillOpacity', label: 'Fill', min: 0, max: 1, hint: 'How solid the fill is when the shape is shown.' },
    { key: 'strokeWidth', label: 'Outline', min: 0, max: 20, step: 0.5, hint: 'Outline width in pixels. 0 = none.' },
    { key: 'trim', label: 'Trim', min: 0, max: 1, hint: 'How much of the outline is drawn. Animate it from 0 to 1 to draw the shape on.' },
    { key: 'strength', label: 'Strength', min: 0, max: 5, hint: 'How strong the action is: pull, push, wind, swirl or drag.' },
    { key: 'reach', label: 'Reach', min: 0.01, max: 0.8, hint: 'Attract, repel and vortex: how far outside the shape it acts (fraction of picture height).' },
    { key: 'bounce', label: 'Bounce', min: 0, max: 1, hint: 'Walls: 0 = particles slide along, 1 = they bounce straight back.' },
    { key: 'angle', label: 'Wind angle', min: -180, max: 180, step: 1, hint: 'Wind direction in degrees: 0 right, 90 down, 180 left, −90 up.' },
    { key: 'scale', label: 'Resize ×', min: 0, max: 5, hint: 'Resize: particle size multiplier while inside.' },
    { key: 'tilt', label: 'Tilt', min: 0, max: 85, step: 1, hint: 'Vortex: lean the swirl back like a disc seen from the side. Orbits become ellipses round the middle and particles grow on the near side, shrink on the far side. Rotation turns the lean.' },
  ],
  audio: [
    X('Centre'), Y('Centre'),
    { key: 'w', label: 'Width', min: 0.05, max: 2, hint: 'Width in picture heights.' },
    { key: 'h', label: 'Height', min: 0.02, max: 1, hint: 'Height in picture heights (how far the wave or bars reach).' },
    { key: 'gain', label: 'Gain', min: 0, max: 6, hint: 'How big the sound makes it.' },
    { key: 'smooth', label: 'Smooth', min: 0, max: 0.95, hint: 'How slowly it follows the sound. 0 is raw and jittery.' },
    { key: 'thickness', label: 'Thickness', min: 0.5, max: 12, step: 0.5, hint: 'Line width in pixels.' },
    { key: 'scroll', label: 'Scroll', min: 0, max: 4, hint: 'Spectrogram: how fast time scrolls by. 1 crosses the width in about 4 seconds; 0 freezes it.' },
    OPACITY,
  ],
  glyphs: [
    { key: 'cell', label: 'Cell', min: 4, max: 60, step: 1, hint: 'Grid cell size in pixels. Smaller = more detail, more work.' },
    { key: 'contrast', label: 'Contrast', min: 0.2, max: 4, hint: 'Pushes darks darker and lights lighter before picking a glyph.' },
    { key: 'shift', label: 'Offset', min: 0, max: 16, hint: 'ASCII: moves every cell along the character ramp, wrapping round. Map an LFO or a beat onto it and the glyphs shuffle through the set.' },
    { key: 'spread', label: 'Spread', min: 0, max: 1, hint: 'ASCII: each cell strays from its glyph by a random amount of its own, so flat areas get a mix of characters instead of one.' },
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
    { key: 'scatter', label: 'Scatter', min: 0, max: 5, hint: 'How hard a Scatter (the button, or an action) throws them. Multiplies the action\'s amount.' },
    OPACITY,
  ],
  camera: [
    X('Centre of the camera image'), Y('Centre of the camera image'),
    { key: 'scale', label: 'Scale', min: 0.05, max: 3, hint: 'Camera image height as a fraction of the picture height.' },
    ROT, OPACITY,
  ],
  drumpad: [{ key: 'volume', label: 'Volume', min: 0, max: 1.5, hint: 'The whole kit’s level, after its effect chain.' }],
  video: [
    X('Centre of the video'), Y('Centre of the video'),
    { key: 'scale', label: 'Scale', min: 0.05, max: 3, hint: 'Size against the fitted size (Fit: Height makes 1 as tall as the picture).' },
    ROT, OPACITY,
    { key: 'volume', label: 'Volume', min: 0, max: 1, hint: 'Sound: Play out loud: how loud it is heard. Readers listen at full level whatever this is.' },
  ],
  cloner: [
    X('The arrangement’s centre (a line’s start)'), Y('The arrangement’s centre (a line’s start)'),
    { key: 'x2', label: 'End X', min: 0, max: 1, hint: 'Line: where the line ends, across the picture.' },
    { key: 'y2', label: 'End Y', min: 0, max: 1, hint: 'Line: where the line ends, up the picture.' },
    { key: 'count', label: 'Count', min: 1, max: 400, step: 1, hint: 'Ring, line and path: how many copies.' },
    { key: 'cols', label: 'Columns', min: 1, max: 40, step: 1, hint: 'Grid: copies across.' },
    { key: 'rows', label: 'Rows', min: 1, max: 40, step: 1, hint: 'Grid: copies up.' },
    { key: 'spacingX', label: 'Spacing X', min: 0, max: 1, hint: 'Grid: distance between columns, in picture heights.' },
    { key: 'spacingY', label: 'Spacing Y', min: 0, max: 1, hint: 'Grid: distance between rows, in picture heights.' },
    { key: 'radius', label: 'Radius', min: 0, max: 1, hint: 'Ring: its radius in picture heights.' },
    { key: 'startAngle', label: 'Start angle', min: -180, max: 180, step: 1, hint: 'Ring: where the first copy sits, degrees (0 = right, 90 = up).' },
    { key: 'sweep', label: 'Sweep', min: -360, max: 360, step: 1, hint: 'Ring: how far round the copies go. 360 is a full circle; less is an arc.' },
    { key: 'spread', label: 'Spread', min: 0, max: 1, hint: 'Path: how much of the stroke the copies cover, from its start.' },
    { key: 'jitter', label: 'Jitter', min: 0, max: 0.5, hint: 'Random offset per copy, in picture heights. Stable for a seed.' },
    { key: 'seed', label: 'Seed', min: 0, max: 9999, step: 1, hint: 'Which random pattern the jitter and the random amounts use.' },
    { key: 'scale', label: 'Scale', min: 0, max: 3, hint: 'Every copy’s size, as a multiple of the source.' },
    ROT,
    OPACITY,
    { key: 'stepX', label: 'Step X', min: -0.2, max: 0.2, hint: 'Each copy sits this much further across than the one before (picture heights).' },
    { key: 'stepY', label: 'Step Y', min: -0.2, max: 0.2, hint: 'Each copy sits this much higher than the one before (picture heights).' },
    { key: 'stepScale', label: 'Step scale', min: -0.2, max: 0.2, hint: 'Each copy is this fraction bigger than the one before: a staircase of sizes.' },
    { key: 'stepRotation', label: 'Step turn', min: -45, max: 45, step: 0.5, hint: 'Each copy turns this many degrees more than the one before: a fan or a spiral.' },
    { key: 'stepOpacity', label: 'Step fade', min: -0.2, max: 0.2, hint: 'Each copy is this much more (or less) solid than the one before.' },
    { key: 'stepHue', label: 'Step hue', min: -60, max: 60, step: 1, hint: 'Each copy’s colour is turned this many degrees round the hue wheel more than the one before.' },
    { key: 'randScale', label: 'Random scale', min: 0, max: 1, hint: 'Sizes vary by up to this fraction, per copy, stable for a seed.' },
    { key: 'randRotation', label: 'Random turn', min: 0, max: 180, step: 1, hint: 'Turns vary by up to this many degrees, per copy.' },
    { key: 'randOpacity', label: 'Random fade', min: 0, max: 1, hint: 'Opacity varies by up to this much, per copy.' },
    { key: 'randHue', label: 'Random hue', min: 0, max: 180, step: 1, hint: 'Hue varies by up to this many degrees, per copy.' },
    { key: 'effRadius', label: 'Falloff', min: 0, max: 1, hint: 'Effectors: how far from the null (or the shape’s edge) they reach, in picture heights.' },
    { key: 'effSoftness', label: 'Softness', min: 0, max: 1, hint: 'Effectors: 0 is a hard edge at the falloff, 1 fades from the centre out.' },
    { key: 'effPush', label: 'Push', min: -0.5, max: 0.5, hint: 'Effectors: copies inside the falloff move away from it by up to this much (negative pulls them in).' },
    { key: 'effScale', label: 'Grow', min: -1, max: 4, hint: 'Effectors: copies inside the falloff grow by up to this fraction (negative shrinks; −1 vanishes).' },
    { key: 'effRotate', label: 'Turn', min: -360, max: 360, step: 1, hint: 'Effectors: copies inside the falloff turn by up to this many degrees.' },
    { key: 'effOpacity', label: 'Fade', min: -1, max: 1, hint: 'Effectors: copies inside the falloff become this much more (or less) solid.' },
    { key: 'effHue', label: 'Hue shift', min: -180, max: 180, step: 1, hint: 'Effectors: copies inside the falloff shift colour by up to this many degrees.' },
    { key: 'effHide', label: 'Hide at', min: 0, max: 1, hint: 'Effectors: a copy disappears once the falloff weight reaches this. 0 never hides.' },
  ],
  script: [OPACITY],
  background: [
    { key: 'index', label: 'Index', min: 0, max: 1, step: 1, hint: 'Which source shows: 0 is the first in the queue. Make it a control and map anything onto it (a MIDI knob, keys, an LFO, a hand). Next and Previous count on from here.' },
    { key: 'offset', label: 'Offset', min: 0, max: 1, step: 1, hint: 'Rotates the queue: with Offset 1, index 0 shows the second source, and the last wraps round to the first.' },
    X('The background’s centre'), Y('The background’s centre'),
    { key: 'scale', label: 'Scale', min: 0.1, max: 4, hint: 'Size of the background: 1 fills the picture as fitted. Over 1 zooms in; under 1 shows the colour around it.' },
    ROT,
    { key: 'duration', label: 'Fade (s)', min: 0, max: 5, step: 0.05, hint: 'Crossfade: how long one source takes to fade into the next.' },
  ],  data: [
    { key: 'offset', label: 'Offset', min: 0, max: 100, step: 1, hint: 'Which row (or chunk) is current, counting from 0: a window starts there. Make it a control and map anything onto it (a key, an LFO, a hand). Next and Previous count on from here.' },
    { key: 'count', label: 'Window', min: 1, max: 50, step: 1, hint: 'Window: how many rows (or chunks) show at once, from the current one.' },
    { key: 'from', label: 'From row', min: 1, max: 100, step: 1, hint: 'Range: the first row that shows, counting from 1.' },
    { key: 'to', label: 'To row', min: 1, max: 100, step: 1, hint: 'Range: the last row that shows, counting from 1.' },
    { key: 'duration', label: 'Fade (s)', min: 0, max: 5, step: 0.05, hint: 'Fade: how long the rows (or words) that go take to fade into the ones that come.' },
    X('The region’s centre'), Y('The region’s centre'),
    { key: 'w', label: 'Width', min: 0.05, max: 3, hint: 'Region: width in picture heights.' },
    { key: 'h', label: 'Height', min: 0.05, max: 2, hint: 'Region: height in picture heights.' },
    { key: 'size', label: 'Size', min: 1, max: 60, step: 0.5, hint: 'Points: mark size in pixels (without a size column).' },
    { key: 'sizeMin', label: 'Smallest', min: 0, max: 60, step: 0.5, hint: 'Size column: the mark size, in pixels, for its smallest value.' },
    { key: 'sizeMax', label: 'Largest', min: 1, max: 120, step: 0.5, hint: 'Size column: the mark size, in pixels, for its largest value.' },
    { key: 'lineWidth', label: 'Line', min: 0.5, max: 16, step: 0.25, hint: 'Path and lines: line width in pixels.' },
    { key: 'trim', label: 'Trim', min: 0, max: 1, hint: 'Path and lines: how much is drawn. Animate it from 0 to 1 to draw the route on.' },
    { key: 'textSize', label: 'Text size', min: 0.02, max: 0.6, hint: 'Text: letter height as a fraction of the picture height.' },
    { key: 'labelSize', label: 'Labels', min: 6, max: 32, step: 0.5, hint: 'Axis numbers and labels, in pixels.' },
    OPACITY,
  ],
  relationship: [
    { key: 'speed', label: 'Speed', min: 0, max: 2, hint: 'Chase: how fast chasers and prey run, in picture heights per second.' },
    { key: 'accel', label: 'Acceleration', min: 0, max: 8, hint: 'Chase: how quickly they get up to speed or change it.' },
    { key: 'turn', label: 'Turn rate', min: 0, max: 1, hint: 'Chase: how sharply they can turn. Low is a wide arc, 1 turns on the spot.' },
    { key: 'sight', label: 'Sight', min: 0, max: 2, hint: 'Chase: a chaser sees prey this close (picture heights) and runs at the closest; beyond it, it wanders.' },
    { key: 'flee', label: 'Flee distance', min: 0, max: 2, hint: 'Chase: prey runs from a chaser this close.' },
    { key: 'wander', label: 'Wander', min: 0, max: 2, hint: 'Chase: how much a chaser roams without prey in sight (and prey without a chaser near).' },
    { key: 'strength', label: 'Strength', min: 0, max: 3, hint: 'Repel and attract: how hard they push apart or pull together.' },
    { key: 'repelDistance', label: 'Repel within', min: 0.02, max: 1.5, hint: 'Repel: members closer than this push apart.' },
    { key: 'minDistance', label: 'Keep apart', min: 0, max: 1.5, hint: 'Attract, keep: the distance they can\'t cross. A soft spring at the boundary keeps them bouncy, not stuck.' },
    { key: 'falloff', label: 'Falloff', min: 0, max: 1, hint: 'Attract, overshoot: 0 pulls as hard from far as from near; 1 falls off as the inverse square, like gravity.' },
    { key: 'springiness', label: 'Springiness', min: 0, max: 1, hint: 'How stiff the soft contacts are: the keep-apart boundary and a Repel wall.' },
    { key: 'bounciness', label: 'Bounciness', min: 0, max: 1, hint: 'How much of a bounce is kept at a wall or the keep-apart boundary. 0 barely rebounds.' },
    { key: 'damping', label: 'Damping', min: 0, max: 1, hint: 'How quickly motion dies out. 0 keeps every push; 1 settles fast.' },
    { key: 'maxSpeed', label: 'Max speed', min: 0.05, max: 4, hint: 'A cap on any member\'s speed, in picture heights per second.' },
    { key: 'catchRadius', label: 'Catch radius', min: 0, max: 0.4, hint: 'Chase: a chaser this close to a prey catches it (plus their own small radius).' },
    { key: 'respawnDelay', label: 'Respawn after', min: 0, max: 10, step: 0.1, hint: 'Escape: how long an escaped member stays out of the picture before it respawns.' },
  ],
};

/**
 * The numeric properties a control can drive on this layer: the kind's
 * table, plus, for a Script layer, the sliders its code declares (as
 * `p_<key>`). Prefer this over LAYER_NUMERIC_PROPS[kind] wherever a layer is
 * at hand.
 */
export function layerNumericProps(l: PlayLayer): ReadonlyArray<LayerNumericProp> {
  const own = kindNumericProps(l);
  if (!l.masks?.length) return own;
  // A mask's numbers follow the layer's own: "Mask 1 · Feather".
  return [...own, ...l.masks.flatMap(m => MASK_PROP_KEYS.map(p => {
    const d = MASK_PROPS[p];
    return { key: maskKey(m.id, p), label: `${maskLabel(m.id)} · ${d.label}`, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}), hint: d.hint };
  }))];
}

function kindNumericProps(l: PlayLayer): ReadonlyArray<LayerNumericProp> {
  const base = LAYER_NUMERIC_PROPS[l.kind];
  // Index and Offset run over the queue: a slider from the first source to the last.
  if (l.kind === 'background') { const last = Math.max(1, l.sources.length - 1); return base.map(d => d.key === 'index' || d.key === 'offset' ? { ...d, max: last } : d); }
  // Offset, From, To and Window run over the dataset's rows (or chunks), once it is known.
  if (l.kind === 'data') {
    const n = dataItemCount(l);
    if (!(n > 0)) return base;
    return base.map(d => d.key === 'offset' ? { ...d, max: Math.max(1, n - 1) } : d.key === 'from' || d.key === 'to' || d.key === 'count' ? { ...d, max: Math.max(2, n) } : d);
  }
  // Each pad that plays something: its numbers, "Pad 3 · Pitch" (`pad3_pitch`).
  // A pad's numbers are the sampler's physical ranges (a start past the sample's end, a pan past the speakers), so they're hard.
  if (l.kind === 'drumpad') return [...base, ...l.pads.flatMap((p, i) => (padHasSound(p) ? DP_PARAMS.map(d => ({ key: dpKey(i, d.key), label: `Pad ${i + 1} · ${d.label}`, min: d.min, max: d.max, step: d.step, hard: true, hint: d.hint })) : []))];
  // Each member that reacts to the picture: its strength, "Member 2 · Picture strength" (`m2_picture`).
  if (l.kind === 'relationship') return [...base, ...l.members.flatMap((m, i) => (m.picture !== 'off' ? [{ key: relationPictureKey(i), label: `Member ${i + 1} · Picture strength`, min: 0, max: 3, hint: `How hard member ${i + 1} climbs or descends the picture's ${m.channel}.` }] : []))];
  if (l.kind !== 'script') return base;
  // Buttons are actions, not numbers; toggles are 0/1 numbers.
  // A colour is a packed RGB, not a number to slide; a choice slides from option to option.
  return [...l.paramDefs.filter(d => d.kind !== 'button' && d.kind !== 'colour').map(d => d.kind === 'choice'
    ? { key: `p_${d.key}`, label: d.label, min: 0, max: Math.max(1, (d.options?.length ?? 1) - 1), step: 1, hint: d.hint ?? `${d.label}: ${(d.options ?? []).join(' · ')}` }
    : d.kind === 'toggle'
    ? { key: `p_${d.key}`, label: d.label, min: 0, max: 1, step: 1, hint: d.hint ?? `${d.label}: an on/off toggle the script declares.` }
    : { key: `p_${d.key}`, label: d.label, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}), hint: d.hint ?? `${d.label}: a slider the script declares.` }), ...base];
}

/** The buttons a script declares (a function in params, or `{ kind: 'button' }`): each is an action on the layer. */
export function scriptButtons(l: PlayLayer): ScriptParamDef[] {
  return l.kind === 'script' ? l.paramDefs.filter(d => d.kind === 'button') : [];
}

/** A library id kept in a setup: a library record's (short), or a linked folder's file reference (longer). */
export function keepLibraryId(id: string): string {
  return id.startsWith(LINKED_PREFIX) ? (id.length <= LINKED_REF_MAX ? id : '') : id.slice(0, 80);
}
