/**
 * play.ts — the per-graph Play record (docs/play-v1-plan.md, step 3).
 *
 * Play never edits the graph. It only turns knobs: every control here points
 * at a float or colour param that the compiler already turns into a live
 * uniform, and every mapping is `source → range/curve/smoothing → control`.
 *
 * Stored under the graph file's top-level `play` key. Save, load, export and
 * import carry it verbatim; `parsePlayRecord` is the one gate that turns
 * unknown JSON back into a well-formed record.
 */

// ── Controls (the panel) ────────────────────────────────────────────────────

export type PlayControlKind = 'float' | 'color';

export interface PlayControl {
  /** Stable id mappings point at (a control keeps its mappings when re-labelled). */
  id: string;
  /**
   * Which param: `nodeId::paramKey` for a top-level node, or
   * `groupId::innerNodeId::paramKey` for a slider one level inside a group —
   * the same path the publish dialog's candidate list uses.
   */
  target: string;
  kind: PlayControlKind;
  /** Author-chosen label; defaults to "Node · Param" when added. */
  label: string;
  /** Slider range shown in the panel (floats only). */
  min: number;
  max: number;
  step?: number;
}

// ── Sources (what drives a control) ─────────────────────────────────────────

export type MidiSignal = 'note' | 'velocity' | 'gate' | 'bend' | 'cc';

/** What fires a trigger source. `note: -1` is any note. */
export type LiveAudioBand = 'level' | 'bass' | 'lowmid' | 'highmid' | 'treble';

export type TriggerSpec =
  /** A live-audio band crossing `threshold` (0..1) upward: a kick, a snare, a loud moment. */
  | { on: 'audio'; band: LiveAudioBand; threshold: number }
  | { on: 'key'; code: string }
  | { on: 'note'; channel: number; note: number }
  | { on: 'mouse' }
  | { on: 'osc'; address: string }
  | { on: 'beat'; bpm: number; beats: number };

/**
 * What a trigger does each time it fires.
 *   envelope  attack → decay → sustain while held → release (ms; sustain 0..1)
 *   toggle    flips between 0 and 1
 *   step      walks 0 → 1 in `steps` even steps, then wraps
 *   random    a new random value
 */
export type TriggerMode = 'envelope' | 'toggle' | 'step' | 'random';

/**
 * Noise shapes, all 0..1 on the graph clock:
 *   smooth   gradient-free value noise, eased between random points (`rate` points a second)
 *   drift    three octaves of smooth noise: slow wandering with finer wobble on top
 *   random   a new random value every frame (jitter)
 *   stepped  a random value held for 1/`rate` s, snapped to `steps` levels (posterised time)
 */
export type NoiseType = 'smooth' | 'drift' | 'random' | 'stepped';
export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'random';

export type PlaySource =
  /** A MIDI stream: `channel` 0 = all, `cc` only for the `cc` signal. Outputs 0..1 (bend −1..1). */
  | { kind: 'midi'; signal: MidiSignal; channel: number; cc?: number }
  /** Pointer position over the window (0..1, `y` up) or 1 while a button is held. Active on the Play page. */
  | { kind: 'mouse'; axis: 'x' | 'y' | 'down' }
  /** 1 while a keyboard key (KeyboardEvent.code) is held. Active on the Play page. */
  | { kind: 'key'; code: string }
  /**
   * Another control on the panel, read as 0..1 across its range (a colour
   * reads its brightness). Drag one slider and the mapped one follows, so
   * controls can cross-modulate each other.
   */
  | { kind: 'control'; controlId: string }
  /** A free-running oscillator on the graph clock, 0..1. `phase` offsets the cycle (0..1). */
  | { kind: 'lfo'; shape: LfoShape; rate: number; phase: number }
  /** An oscillator locked to a tempo: one cycle every `beats` beats at `bpm`. */
  | { kind: 'clock'; shape: LfoShape; bpm: number; beats: number }
  /** One band of an Audio Input node in the graph (amplitude 0..1). */
  | { kind: 'audio'; nodeId: string; band: number }
  /** Phone orientation: `beta` front/back, `gamma` left/right, `alpha` compass. Active on the Play page. */
  | { kind: 'tilt'; axis: 'beta' | 'gamma' | 'alpha' }
  /** A gamepad stick axis (−1..1 → 0..1) or a button (0..1). `pad` is the slot, `index` the axis or button number. */
  | { kind: 'gamepad'; pad: number; control: 'axis' | 'button'; index: number }
  /** A null layer's position on the picture (0..1). */
  | { kind: 'null'; layerId: string; axis: 'x' | 'y' }
  /** An OSC message's argument (via the OSC bridge), scaled from `min..max` to 0..1. */
  | { kind: 'osc'; address: string; arg: number; min: number; max: number }
  /** A band of the live audio input (a mic, an interface, or Ableton through a virtual cable), times `gain`. */
  | { kind: 'live'; band: LiveAudioBand; gain: number }
  /** Random motion on the graph clock. `seed` makes two noise rows differ. `steps` (stepped only) posterises the value, 0 = no snapping. */
  | { kind: 'noise'; type: NoiseType; rate: number; seed: number; steps: number }
  /** A trigger (key, note, click, OSC message, beat) driving an envelope, toggle, step or random value. */
  | { kind: 'trigger'; trigger: TriggerSpec; mode: TriggerMode; attack: number; decay: number; sustain: number; release: number; steps: number; velocity: boolean };

export type PlayCurve = 'linear' | 'exp' | 'log' | 'custom';

/** Samples in a drawn remap curve: y values on a uniform 0..1 grid. */
export const CURVE_POINTS = 25;

export interface PlayMapping {
  id: string;
  controlId: string;
  source: PlaySource;
  /** Output range in param units: source 0 → `outMin`, source 1 → `outMax`. Can be inverted. */
  outMin: number;
  outMax: number;
  curve: PlayCurve;
  /** `curve: 'custom'`: the drawn remap, CURVE_POINTS y values (0..1) on a uniform x grid. */
  curveY?: number[];
  /** Exponential smoothing time constant in ms (0 = snap). */
  smoothMs: number;
  /** Colour controls only: which channel the mapping writes (all three when unset). */
  channel?: 0 | 1 | 2;
  enabled: boolean;
}

// ── Layers (drawn over the picture in JavaScript) ───────────────────────────

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'lighten' | 'darken' | 'difference' | 'exclusion' | 'add';

/** How a text or image layer meets the picture. */
export type MatteMode =
  /** Drawn over the picture with a blend mode. */
  | 'over'
  /** The picture shows only inside the layer's shape; everywhere else is the layer's colour. */
  | 'reveal'
  /** The picture's brightness is the layer's alpha: the layer shows where the picture is bright. */
  | 'luma';

interface LayerBase {
  id: string;
  label: string;
  visible: boolean;
}

/** A draggable point. Its position is a source ("Null X" / "Null Y") and can be a control. Coordinates 0..1, y up. */
export interface NullLayer extends LayerBase {
  kind: 'null';
  x: number;
  y: number;
  /** Marker radius in px. 0 hides the marker but keeps the point. */
  size: number;
  color: string;
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
  color: [number, number, number];
  font: 'sans' | 'serif' | 'mono';
  weight: number;
  blend: BlendMode;
  matte: MatteMode;
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
  /** Background for the reveal and cut mattes. */
  color: [number, number, number];
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
 * runs out. Size and opacity can follow brightness, speed, age or a null.
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
  /** noise field: size of the swirls (higher = smaller) and how fast it evolves. */
  noiseScale: number;
  noiseEvolve: number;
  /** climb/descend on flat parts of the picture: keep moving on noise, or slow down and collect. */
  flat: 'wander' | 'settle';
  // Attractor
  attractor: 'none' | 'mouse' | 'null';
  force: 'gravitate' | 'spiral' | 'repel';
  strength: number;
  /** A particle this close to the attractor (picture heights) respawns. */
  catchRadius: number;
  // Birth and death
  spawn: 'anywhere' | 'edges' | 'center' | 'null';
  spawnRadius: number;
  edges: 'wrap' | 'bounce' | 'respawn';
  /** Seconds before a particle respawns (each gets 60–140% of it); 0 = never. */
  life: number;
  /** The null an attractor, a null spawn or a null modulator uses. */
  nullId: string;
  // Look
  shape: ParticleShape;
  rotate: 'heading' | 'spin' | 'none';
  /** Image sprite (a data URL: PNG, JPG or SVG) for shape 'image'. */
  sprite: string;
  crop: boolean;
  size: number;
  /** 0..1: random size variation between particles. */
  sizeJitter: number;
  opacity: number;
  colour: 'tint' | 'picture' | 'palette';
  color: [number, number, number];
  palette: number;
  paletteBy: 'heading' | 'speed' | 'age' | 'brightness';
  sizeBy: ParticleModulator;
  sizeAmount: number;
  opacityBy: ParticleModulator;
  opacityAmount: number;
  /** Null modulator reach (picture heights): full effect at the null, none this far away. */
  falloff: number;
  /** Show the picture through the particles instead of colouring them. */
  reveal: boolean;
  /** 0 = no trail, 1 = long trails. */
  trail: number;
  blend: BlendMode;
}

export type PlayLayer = NullLayer | TextLayer | ImageLayer | ParticlesLayer;
export type PlayLayerKind = PlayLayer['kind'];

/** Numeric layer properties a control can drive, per kind. The control's target is `layer:<layerId>::<key>`. */
export const LAYER_NUMERIC_PROPS: Record<PlayLayerKind, ReadonlyArray<{ key: string; label: string; min: number; max: number; step?: number; hint: string }>> = {
  null: [
    { key: 'x', label: 'X', min: 0, max: 1, hint: 'Across the picture: 0 is the left edge, 1 the right.' },
    { key: 'y', label: 'Y', min: 0, max: 1, hint: 'Up the picture: 0 is the bottom, 1 the top.' },
    { key: 'size', label: 'Size', min: 0, max: 60, step: 1, hint: 'Marker radius in pixels. 0 hides the marker; the null still works.' },
  ],
  text: [
    { key: 'x', label: 'X', min: 0, max: 1, hint: 'Centre of the text across the picture (0 left, 1 right).' },
    { key: 'y', label: 'Y', min: 0, max: 1, hint: 'Centre of the text up the picture (0 bottom, 1 top).' },
    { key: 'size', label: 'Size', min: 0.02, max: 1, hint: 'Letter height as a fraction of the picture height.' },
    { key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1, hint: 'Degrees, clockwise.' },
    { key: 'opacity', label: 'Opacity', min: 0, max: 1, hint: 'How solid the layer is. 0 is invisible.' },
  ],
  image: [
    { key: 'x', label: 'X', min: 0, max: 1, hint: 'Centre of the image across the picture (0 left, 1 right).' },
    { key: 'y', label: 'Y', min: 0, max: 1, hint: 'Centre of the image up the picture (0 bottom, 1 top).' },
    { key: 'scale', label: 'Scale', min: 0.05, max: 3, hint: 'Image height as a fraction of the picture height (1 = as tall as the picture).' },
    { key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1, hint: 'Degrees, clockwise.' },
    { key: 'opacity', label: 'Opacity', min: 0, max: 1, hint: 'How solid the layer is. 0 is invisible.' },
  ],
  particles: [
    { key: 'speed', label: 'Speed', min: 0, max: 3, hint: 'How fast particles travel. 1 crosses the picture\'s height in about 5 seconds.' },
    { key: 'steer', label: 'Steering', min: 0, max: 1, hint: 'How quickly particles turn toward where the field points. Low is floaty and drifting; high follows the field tightly.' },
    { key: 'turns', label: 'Turns', min: 0, max: 4, hint: 'Flow only: how many full turns the heading makes from black to white. 0 = everything goes right; higher = tighter swirls.' },
    { key: 'noiseScale', label: 'Swirl size', min: 0.5, max: 12, hint: 'Noise field (and wandering): how many swirls fit across the picture. Higher = smaller, busier swirls.' },
    { key: 'noiseEvolve', label: 'Evolve', min: 0, max: 2, hint: 'How fast the noise field changes over time. 0 = frozen lanes.' },
    { key: 'strength', label: 'Pull', min: 0, max: 3, hint: 'How hard the attractor pulls (or pushes, for Repel). Stronger near it.' },
    { key: 'catchRadius', label: 'Catch', min: 0, max: 0.3, hint: 'Particles this close to the attractor are caught and respawn (fraction of picture height). 0 = never caught.' },
    { key: 'spawnRadius', label: 'Spawn radius', min: 0, max: 0.8, hint: 'Spawn at centre or at a null: how wide the birth circle is (fraction of picture height).' },
    { key: 'life', label: 'Life (s)', min: 0, max: 20, hint: 'Seconds before a particle respawns (each lives 60–140% of this). 0 = they live forever and only respawn at edges or when caught.' },
    { key: 'size', label: 'Size', min: 0.5, max: 40, step: 0.5, hint: 'Particle radius in pixels.' },
    { key: 'sizeJitter', label: 'Size variety', min: 0, max: 1, hint: 'Random size differences between particles. 0 = all the same.' },
    { key: 'sizeAmount', label: 'Size follow', min: -1, max: 3, hint: 'How much size follows the chosen reading. +1 doubles it where the reading is full; −1 shrinks particles to nothing there.' },
    { key: 'opacityAmount', label: 'Opacity follow', min: -1, max: 1, hint: 'How much opacity follows the chosen reading. Negative fades particles out where the reading is full (e.g. old age).' },
    { key: 'falloff', label: 'Null reach', min: 0.02, max: 1, hint: 'Following a null: full effect at the null, fading to none this far away (fraction of picture height).' },
    { key: 'opacity', label: 'Opacity', min: 0, max: 1, hint: 'How solid the whole layer is.' },
    { key: 'trail', label: 'Trail', min: 0, max: 1, hint: 'How long the streaks behind particles last. 0 = no trail; 1 = long, slow-fading trails.' },
  ],
};

export const LAYER_TARGET_PREFIX = 'layer:';

/** Control target for a layer property. */
export function layerTarget(layerId: string, key: string): string {
  return `${LAYER_TARGET_PREFIX}${layerId}::${key}`;
}

/** Split a layer target; null for a graph target. */
export function parseLayerTarget(target: string): { layerId: string; key: string } | null {
  if (!target.startsWith(LAYER_TARGET_PREFIX)) return null;
  const rest = target.slice(LAYER_TARGET_PREFIX.length);
  const i = rest.lastIndexOf('::');
  if (i <= 0) return null;
  return { layerId: rest.slice(0, i), key: rest.slice(i + 2) };
}

/** How the Play picture is shown. Hiding it leaves only the layers on the backdrop; the shader still runs, so mattes and particles can still read it. */
export interface PlayDisplay {
  picture: boolean;
  backdrop: [number, number, number];
}

export interface PlayRecord {
  version: 1;
  controls: PlayControl[];
  mappings: PlayMapping[];
  layers: PlayLayer[];
  /** Absent means the defaults (picture shown). */
  display?: PlayDisplay;
}

export const DEFAULT_DISPLAY: PlayDisplay = { picture: true, backdrop: [0, 0, 0] };

export const PLAY_VERSION = 1 as const;

export function emptyPlayRecord(): PlayRecord {
  return { version: PLAY_VERSION, controls: [], mappings: [], layers: [] };
}

/** A fresh layer of a kind with sensible defaults. */
export function defaultLayer(kind: PlayLayerKind, id: string, label: string): PlayLayer {
  switch (kind) {
    case 'null': return { id, kind, label, visible: true, x: 0.5, y: 0.5, size: 10, color: '#3a6ff7' };
    case 'text': return { id, kind, label, visible: true, text: 'PLAY', x: 0.5, y: 0.5, size: 0.25, rotation: 0, opacity: 1, color: [1, 1, 1], font: 'sans', weight: 700, blend: 'normal', matte: 'over' };
    case 'image': return { id, kind, label, visible: true, src: '', x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, color: [0, 0, 0], blend: 'normal', matte: 'over' };
    case 'particles': return {
      id, kind, label, visible: true, count: 800,
      field: 'flow', speed: 1, steer: 0.5, turns: 1, noiseScale: 3, noiseEvolve: 0.2, flat: 'wander',
      attractor: 'none', force: 'gravitate', strength: 1, catchRadius: 0.02,
      spawn: 'anywhere', spawnRadius: 0.2, edges: 'wrap', life: 0, nullId: '',
      shape: 'dot', rotate: 'heading', sprite: '', crop: false, size: 2, sizeJitter: 0.3, opacity: 0.8,
      colour: 'tint', color: [1, 1, 1], palette: 1, paletteBy: 'heading',
      sizeBy: 'none', sizeAmount: 1, opacityBy: 'none', opacityAmount: 0.5, falloff: 0.3,
      reveal: false, trail: 0.6, blend: 'normal',
    };
  }
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const CURVES: ReadonlySet<string> = new Set<PlayCurve>(['linear', 'exp', 'log', 'custom']);

function curveY(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const out: number[] = [];
  for (const y of v) {
    if (typeof y !== 'number' || !Number.isFinite(y)) return null;
    out.push(Math.max(0, Math.min(1, y)));
  }
  return out;
}
const MIDI_SIGNALS: ReadonlySet<string> = new Set<MidiSignal>(['note', 'velocity', 'gate', 'bend', 'cc']);
const LFO_SHAPES: ReadonlySet<string> = new Set<LfoShape>(['sine', 'triangle', 'saw', 'square', 'random']);

function shape(v: unknown): LfoShape {
  return typeof v === 'string' && LFO_SHAPES.has(v) ? (v as LfoShape) : 'sine';
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const LIVE_BANDS_SET: ReadonlySet<string> = new Set<LiveAudioBand>(['level', 'bass', 'lowmid', 'highmid', 'treble']);

function parseTrigger(raw: unknown): TriggerSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  switch (t.on) {
    case 'key': { const code = str(t.code); return code ? { on: 'key', code } : null; }
    case 'note': return { on: 'note', channel: Math.max(0, Math.min(16, Math.round(num(t.channel, 0)))), note: Math.max(-1, Math.min(127, Math.round(num(t.note, -1)))) };
    case 'mouse': return { on: 'mouse' };
    case 'osc': { const address = str(t.address); return address && address.startsWith('/') ? { on: 'osc', address } : null; }
    case 'beat': return { on: 'beat', bpm: Math.max(1, num(t.bpm, 120)), beats: Math.max(0.0625, num(t.beats, 1)) };
    case 'audio': return { on: 'audio', band: LIVE_BANDS_SET.has(t.band as string) ? (t.band as LiveAudioBand) : 'bass', threshold: Math.max(0.01, Math.min(0.99, num(t.threshold, 0.6))) };
    default: return null;
  }
}

function parseSource(raw: unknown): PlaySource | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  switch (s.kind) {
    case 'midi': {
      const signal = str(s.signal);
      if (!signal || !MIDI_SIGNALS.has(signal)) return null;
      const channel = Math.max(0, Math.min(16, Math.round(num(s.channel, 0))));
      const out: PlaySource = { kind: 'midi', signal: signal as MidiSignal, channel };
      if (signal === 'cc') out.cc = Math.max(0, Math.min(127, Math.round(num(s.cc, 1))));
      return out;
    }
    case 'mouse': {
      const axis = s.axis;
      return axis === 'x' || axis === 'y' || axis === 'down' ? { kind: 'mouse', axis } : null;
    }
    case 'key': {
      const code = str(s.code);
      return code ? { kind: 'key', code } : null;
    }
    case 'control': {
      const controlId = str(s.controlId);
      return controlId ? { kind: 'control', controlId } : null;
    }
    case 'lfo':
      return { kind: 'lfo', shape: shape(s.shape), rate: Math.max(0.001, num(s.rate, 0.5)), phase: num(s.phase, 0) };
    case 'clock':
      return { kind: 'clock', shape: shape(s.shape), bpm: Math.max(1, num(s.bpm, 120)), beats: Math.max(0.0625, num(s.beats, 4)) };
    case 'audio': {
      const nodeId = str(s.nodeId);
      return nodeId ? { kind: 'audio', nodeId, band: Math.max(0, Math.round(num(s.band, 0))) } : null;
    }
    case 'tilt': {
      const axis = s.axis;
      return axis === 'beta' || axis === 'gamma' || axis === 'alpha' ? { kind: 'tilt', axis } : null;
    }
    case 'gamepad': {
      const control = s.control === 'button' ? 'button' : 'axis';
      return { kind: 'gamepad', pad: Math.max(0, Math.round(num(s.pad, 0))), control, index: Math.max(0, Math.round(num(s.index, 0))) };
    }
    case 'null': {
      const layerId = str(s.layerId);
      return layerId && (s.axis === 'x' || s.axis === 'y') ? { kind: 'null', layerId, axis: s.axis } : null;
    }
    case 'osc': {
      const address = str(s.address);
      if (!address || !address.startsWith('/')) return null;
      const min = num(s.min, 0), max = num(s.max, 1);
      return { kind: 'osc', address, arg: Math.max(0, Math.round(num(s.arg, 0))), min, max: max === min ? min + 1 : max };
    }
    case 'live': {
      const band = LIVE_BANDS_SET.has(s.band as string) ? (s.band as LiveAudioBand) : 'level';
      return { kind: 'live', band, gain: Math.max(0.1, Math.min(10, num(s.gain, 1))) };
    }
    case 'noise': {
      const type = s.type === 'drift' || s.type === 'random' || s.type === 'stepped' ? s.type : 'smooth';
      return { kind: 'noise', type, rate: Math.max(0.01, num(s.rate, 1)), seed: Math.round(num(s.seed, 1)), steps: Math.max(0, Math.min(64, Math.round(num(s.steps, 0)))) };
    }
    case 'trigger': {
      const trigger = parseTrigger(s.trigger);
      if (!trigger) return null;
      const mode = s.mode === 'toggle' || s.mode === 'step' || s.mode === 'random' ? s.mode : 'envelope';
      return {
        kind: 'trigger', trigger, mode,
        attack: Math.max(0, num(s.attack, 10)), decay: Math.max(0, num(s.decay, 200)),
        sustain: Math.max(0, Math.min(1, num(s.sustain, 0.6))), release: Math.max(0, num(s.release, 400)),
        steps: Math.max(2, Math.min(64, Math.round(num(s.steps, 4)))), velocity: s.velocity === true,
      };
    }
    default:
      return null;
  }
}

function parseControl(raw: unknown): PlayControl | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const id = str(c.id);
  const target = str(c.target);
  if (!id || !target || !target.includes('::')) return null;
  const kind: PlayControlKind = c.kind === 'color' ? 'color' : 'float';
  const min = num(c.min, 0);
  const max = num(c.max, 1);
  const out: PlayControl = {
    id, target, kind,
    label: str(c.label) ?? target,
    min: Math.min(min, max),
    max: Math.max(min, max),
  };
  if (typeof c.step === 'number' && c.step > 0) out.step = c.step;
  return out;
}

function parseMapping(raw: unknown, controlIds: Set<string>): PlayMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id);
  const controlId = str(m.controlId);
  const source = parseSource(m.source);
  if (!id || !controlId || !source || !controlIds.has(controlId)) return null;
  // A control source has to point at a control that exists (and not at its own target).
  if (source.kind === 'control' && (!controlIds.has(source.controlId) || source.controlId === controlId)) return null;
  const curve = str(m.curve);
  const out: PlayMapping = {
    id, controlId, source,
    outMin: num(m.outMin, 0),
    outMax: num(m.outMax, 1),
    curve: curve && CURVES.has(curve) ? (curve as PlayCurve) : 'linear',
    smoothMs: Math.max(0, num(m.smoothMs, 0)),
    enabled: m.enabled !== false,
  };
  if (m.channel === 0 || m.channel === 1 || m.channel === 2) out.channel = m.channel;
  if (out.curve === 'custom') {
    const ys = curveY(m.curveY);
    if (ys) out.curveY = ys; else out.curve = 'linear';
  }
  return out;
}

/**
 * Turn whatever a graph file holds under `play` into a record. Anything
 * malformed is dropped (a control without a target, a mapping whose control is
 * gone) rather than failing the whole load; a missing key is an empty record.
 */
export function parsePlayRecord(raw: unknown): PlayRecord {
  const empty = emptyPlayRecord();
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Record<string, unknown>;
  const controls: PlayControl[] = [];
  const seen = new Set<string>();
  if (Array.isArray(r.controls)) {
    for (const c of r.controls) {
      const parsed = parseControl(c);
      if (parsed && !seen.has(parsed.id)) { seen.add(parsed.id); controls.push(parsed); }
    }
  }
  const mappings: PlayMapping[] = [];
  const seenM = new Set<string>();
  if (Array.isArray(r.mappings)) {
    for (const m of r.mappings) {
      const parsed = parseMapping(m, seen);
      if (parsed && !seenM.has(parsed.id)) { seenM.add(parsed.id); mappings.push(parsed); }
    }
  }
  const layers: PlayLayer[] = [];
  const seenL = new Set<string>();
  if (Array.isArray(r.layers)) {
    for (const l of r.layers) {
      const parsed = parseLayer(l);
      if (parsed && !seenL.has(parsed.id)) { seenL.add(parsed.id); layers.push(parsed); }
    }
  }
  // Controls on a layer property need that layer; mappings reading a null need that null.
  const layerIds = new Set(layers.map(l => l.id));
  const keptControls = controls.filter(c => { const lt = parseLayerTarget(c.target); return !lt || layerIds.has(lt.layerId); });
  const keptIds = new Set(keptControls.map(c => c.id));
  const keptMappings = mappings.filter(m => keptIds.has(m.controlId)
    && (m.source.kind !== 'control' || keptIds.has(m.source.controlId))
    && (m.source.kind !== 'null' || layerIds.has(m.source.layerId)));
  const out: PlayRecord = { version: PLAY_VERSION, controls: keptControls, mappings: keptMappings, layers };
  const disp = r.display as Record<string, unknown> | undefined;
  if (disp && typeof disp === 'object' && (disp.picture === false || disp.backdrop !== undefined)) {
    out.display = { picture: disp.picture !== false, backdrop: rgb(disp.backdrop, DEFAULT_DISPLAY.backdrop) };
  }
  return out;
}

const BLENDS: ReadonlySet<string> = new Set<BlendMode>(['normal', 'multiply', 'screen', 'overlay', 'lighten', 'darken', 'difference', 'exclusion', 'add']);
const MATTES: ReadonlySet<string> = new Set<MatteMode>(['over', 'reveal', 'luma']);

function rgb(v: unknown, fallback: [number, number, number]): [number, number, number] {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(n => typeof n === 'number' && Number.isFinite(n))
    ? [Math.max(0, Math.min(1, v[0])), Math.max(0, Math.min(1, v[1])), Math.max(0, Math.min(1, v[2]))]
    : fallback;
}

function parseLayer(raw: unknown): PlayLayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  const id = str(l.id);
  const kind = l.kind;
  if (!id || (kind !== 'null' && kind !== 'text' && kind !== 'image' && kind !== 'particles')) return null;
  const d = defaultLayer(kind, id, str(l.label) ?? kind);
  const visible = l.visible !== false;
  const blend = (v: unknown, f: BlendMode) => (typeof v === 'string' && BLENDS.has(v) ? (v as BlendMode) : f);
  const matte = (v: unknown, f: MatteMode) => (typeof v === 'string' && MATTES.has(v) ? (v as MatteMode) : f);
  switch (d.kind) {
    case 'null':
      return { ...d, visible, x: num(l.x, d.x), y: num(l.y, d.y), size: Math.max(0, num(l.size, d.size)), color: str(l.color) ?? d.color };
    case 'text':
      return {
        ...d, visible, text: typeof l.text === 'string' ? l.text : d.text, x: num(l.x, d.x), y: num(l.y, d.y), size: Math.max(0.005, num(l.size, d.size)),
        rotation: num(l.rotation, 0), opacity: Math.max(0, Math.min(1, num(l.opacity, 1))), color: rgb(l.color, d.color),
        font: l.font === 'serif' || l.font === 'mono' ? l.font : 'sans', weight: num(l.weight, d.weight), blend: blend(l.blend, d.blend), matte: matte(l.matte, d.matte),
      };
    case 'image':
      return {
        ...d, visible, src: typeof l.src === 'string' ? l.src : '', x: num(l.x, d.x), y: num(l.y, d.y), scale: Math.max(0.01, num(l.scale, 1)),
        rotation: num(l.rotation, 0), opacity: Math.max(0, Math.min(1, num(l.opacity, 1))), color: rgb(l.color, d.color), blend: blend(l.blend, d.blend), matte: matte(l.matte, d.matte),
      };
    case 'particles': {
      const pick = <T extends string>(v: unknown, allowed: readonly T[], f: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : f);
      const unit = (v: unknown, f: number) => Math.max(0, Math.min(1, num(v, f)));
      const mods = ['none', 'brightness', 'speed', 'age', 'null'] as const;
      // Files from before the particle system: `mode` was the field and `colorFromPicture` the colour.
      const legacyField = l.field === undefined && (l.mode === 'climb' || l.mode === 'descend') ? l.mode : undefined;
      return {
        ...d, visible,
        count: Math.max(1, Math.min(5000, Math.round(num(l.count, d.count)))),
        field: pick(l.field ?? legacyField, ['flow', 'climb', 'descend', 'noise', 'none'] as const, d.field),
        speed: Math.max(0, num(l.speed, d.speed)), steer: unit(l.steer, d.steer), turns: Math.max(0, num(l.turns, d.turns)),
        noiseScale: Math.max(0.1, num(l.noiseScale, d.noiseScale)), noiseEvolve: Math.max(0, num(l.noiseEvolve, d.noiseEvolve)),
        flat: pick(l.flat, ['wander', 'settle'] as const, l.field === undefined && legacyField ? 'settle' : d.flat),
        attractor: pick(l.attractor, ['none', 'mouse', 'null'] as const, d.attractor), force: pick(l.force, ['gravitate', 'spiral', 'repel'] as const, d.force),
        strength: Math.max(0, num(l.strength, d.strength)), catchRadius: Math.max(0, num(l.catchRadius, d.catchRadius)),
        spawn: pick(l.spawn, ['anywhere', 'edges', 'center', 'null'] as const, d.spawn), spawnRadius: Math.max(0, num(l.spawnRadius, d.spawnRadius)),
        edges: pick(l.edges, ['wrap', 'bounce', 'respawn'] as const, d.edges), life: Math.max(0, num(l.life, d.life)),
        nullId: typeof l.nullId === 'string' ? l.nullId : '',
        shape: pick(l.shape, ['dot', 'square', 'triangle', 'streak', 'ring', 'star', 'image'] as const, d.shape),
        rotate: pick(l.rotate, ['heading', 'spin', 'none'] as const, d.rotate),
        sprite: typeof l.sprite === 'string' ? l.sprite : '', crop: l.crop === true,
        size: Math.max(0.1, num(l.size, d.size)), sizeJitter: unit(l.sizeJitter, l.sizeJitter === undefined && l.field === undefined ? 0 : d.sizeJitter),
        opacity: unit(l.opacity, d.opacity),
        colour: pick(l.colour, ['tint', 'picture', 'palette'] as const, l.colorFromPicture === true ? 'picture' : d.colour),
        color: rgb(l.color, d.color), palette: Math.max(0, Math.min(9, Math.round(num(l.palette, d.palette)))),
        paletteBy: pick(l.paletteBy, ['heading', 'speed', 'age', 'brightness'] as const, d.paletteBy),
        sizeBy: pick(l.sizeBy, mods, d.sizeBy), sizeAmount: num(l.sizeAmount, d.sizeAmount),
        opacityBy: pick(l.opacityBy, mods, d.opacityBy), opacityAmount: num(l.opacityAmount, d.opacityAmount),
        falloff: Math.max(0.01, num(l.falloff, d.falloff)), reveal: l.reveal === true,
        trail: unit(l.trail, d.trail), blend: blend(l.blend, d.blend),
      };
    }
  }
}

/** True when there is nothing to save (the key is then left out of the file). */
export function isPlayRecordEmpty(play: PlayRecord | undefined): boolean {
  return !play || (play.controls.length === 0 && play.mappings.length === 0 && play.layers.length === 0 && (play.display?.picture ?? true));
}
