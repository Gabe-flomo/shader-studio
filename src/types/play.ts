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

/** float and color are sliders and colour pads; action is a button that fires a layer action (Drop again, Burst…). */
export type PlayControlKind = 'float' | 'color' | 'action';

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
  /** Action controls: the action's amount (particles for Burst, strength for Scatter). */
  amount?: number;
}

// ── Sources (what drives a control) ─────────────────────────────────────────

export type MidiSignal = 'note' | 'velocity' | 'gate' | 'bend' | 'cc';

/** What fires a trigger source. `note: -1` is any note. */
export type LiveAudioBand = 'level' | 'bass' | 'lowmid' | 'highmid' | 'treble';

/**
 * When a trigger fires, for triggers that are held (a key down, a hand
 * gesture, two things close together). Absent = `once`, the behaviour every
 * trigger had before modes existed.
 *   once     on the edge: the key goes down, the gesture starts, A comes close to B
 *   held     every frame while it is held or true
 *   every    while held: at the start, then every `every` frames or seconds
 *   release  when it lets go: the key comes up, the gesture ends, A moves away again
 */
export type FireMode = 'once' | 'held' | 'every' | 'release';
export interface FireSpec { mode: FireMode; every: number; unit: 'frames' | 'seconds' }
export const DEFAULT_FIRE: FireSpec = { mode: 'once', every: 3, unit: 'frames' };

/**
 * A point on the picture a proximity trigger or a distance sensor measures
 * from: a layer's id (its centre, see geoAnchor in play/kit/geometry.js) or a
 * tracked hand's landmark, `hand:<side>:<point>`.
 */
export type AnchorRef = string;
export const HAND_ANCHOR_PREFIX = 'hand:';
export function handAnchor(side: HandSide, point: number): AnchorRef { return `${HAND_ANCHOR_PREFIX}${side}:${point}`; }
/** The hand and landmark of a `hand:<side>:<point>` anchor, or null for a layer anchor. */
export function parseHandAnchor(ref: string): { side: HandSide; point: number } | null {
  const m = /^hand:(left|right|any):(\d{1,2})$/.exec(ref);
  return m && Number(m[2]) <= 20 ? { side: m[1] as HandSide, point: Number(m[2]) } : null;
}

export type TriggerSpec = TriggerOn & { fire?: FireSpec };
export type TriggerOn =
  /** A live-audio band crossing `threshold` (0..1) upward: a kick, a snare, a loud moment. */
  | { on: 'audio'; band: LiveAudioBand; threshold: number }
  | { on: 'key'; code: string }
  | { on: 'note'; channel: number; note: number }
  | { on: 'mouse' }
  | { on: 'osc'; address: string }
  | { on: 'beat'; bpm: number; beats: number }
  /**
   * A shape layer: `click` a press on it, `enter` the pointer moving onto it,
   * `fill` particles filling it past `threshold` (0..1, see the sensor source).
   */
  | { on: 'zone'; layerId: string; event: 'click' | 'enter' | 'fill'; threshold: number }
  /** A hand gesture seen by hand tracking (docs/hand-tracking.md): fires when it starts, held while it lasts. */
  | { on: 'hand'; side: HandSide; gesture: HandGesture }
  /**
   * Two things on the picture closer than (or farther than) `distance`, in
   * picture heights between their centres. Once open, it closes only past
   * `distance ± margin`, so a hand hovering at the edge doesn't flicker.
   */
  | { on: 'proximity'; a: AnchorRef; b: AnchorRef; when: 'closer' | 'farther'; distance: number; margin: number };

// ── Hands (hand tracking, docs/hand-tracking.md) ────────────────────────────

/** The performer's own hand. `any`: the right hand when it is in view, else the left (for gestures: either). */
export type HandSide = 'left' | 'right' | 'any';
/**
 * What a hand source reads, 0..1:
 *   point    a landmark's X, Y or Z (`point` 0..20, `axis`)
 *   palm     the palm centre's X or Y
 *   pinch    thumb tip to a fingertip (`point` 8, 12, 16 or 20): 0 touching, 1 spread
 *   open     0 a fist, 1 an open hand
 *   roll     the hand's turn: 0.5 upright
 *   size     how big the hand looks (near the camera = 1)
 *   present  1 while the hand is in view
 *   spread   the distance between the two hands (1 = a picture width)
 *   gesture  1 while `gesture` is held (a gate)
 */
export type HandRead = 'point' | 'palm' | 'pinch' | 'open' | 'roll' | 'size' | 'present' | 'spread' | 'gesture';
/** Pinches (each finger against the thumb), a fist, an open palm, pointing, and the hand coming into or leaving view. */
export type HandGesture = 'pinch' | 'pinchMiddle' | 'pinchRing' | 'pinchPinky' | 'fist' | 'open' | 'point' | 'appear' | 'leave';
export const HAND_GESTURES: readonly HandGesture[] = ['pinch', 'pinchMiddle', 'pinchRing', 'pinchPinky', 'fist', 'open', 'point', 'appear', 'leave'];

/** Hand tracking's settings for a setup. Absent = the defaults. */
export interface PlayHands {
  /** 0 raw landmarks … 1 very smooth (and a little late). */
  smoothing: number;
  /** Draw the hands' skeleton over the picture while guides are showing. */
  overlay: boolean;
  colour: [number, number, number];
  /** Selfie view: your right hand moves right on the picture. A Camera layer's own Mirror wins when there is one. */
  mirror: boolean;
}
export const DEFAULT_HANDS: PlayHands = { smoothing: 0.5, overlay: true, colour: [0.35, 1, 0.75], mirror: true };

/** Does a setup read hands anywhere: a hand source, a gesture trigger (mapping or action), or a null following a hand? */
export function usesHands(play: Pick<PlayRecord, 'mappings' | 'actions' | 'layers'>): boolean {
  return play.mappings.some(m => m.source.kind === 'hand' || (m.source.kind === 'trigger' && triggerUsesHands(m.source.trigger))
    || (m.source.kind === 'sensor' && m.source.read === 'distance' && !!parseHandAnchor(m.source.otherId)))
    || (play.actions ?? []).some(a => triggerUsesHands(a.trigger))
    || play.layers.some(l => l.kind === 'null' && l.follow === 'hand');
}

/** A gesture trigger, or a proximity trigger measuring from a hand. */
export function triggerUsesHands(t: TriggerSpec): boolean {
  return t.on === 'hand' || (t.on === 'proximity' && (!!parseHandAnchor(t.a) || !!parseHandAnchor(t.b)));
}

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
  | { kind: 'trigger'; trigger: TriggerSpec; mode: TriggerMode; attack: number; decay: number; sustain: number; release: number; steps: number; velocity: boolean }
  /**
   * Something a layer measures, 0..1:
   *   fill      shape: how full of particles it is (0.5 = as dense as average, 1 = twice that or more)
   *   hover     shape: 1 while the pointer is over it
   *   speed     particles: how fast they move on average (vs their Speed)
   *   spread    particles: how spread out they are (0 = in a clump, 1 = everywhere)
   *   motion    camera: how much is moving in front of it
   *   distance  any positioned layer: how far its centre is from another anchor (`otherId`: a layer or a hand point), 1 = a picture height or more
   */
  | { kind: 'sensor'; layerId: string; read: SensorRead; otherId: string }
  /** A tracked hand (see HandRead). Every field is always present; the ones a read doesn't use are ignored. */
  | { kind: 'hand'; side: HandSide; read: HandRead; point: number; axis: 'x' | 'y' | 'z'; gesture: HandGesture };

/** Layer kinds with a centre on the picture: what proximity triggers and distance sensors can measure from. */
export const ANCHOR_KINDS: readonly string[] = ['null', 'shape', 'text', 'image', 'camera', 'lens', 'audio', 'particles', 'bodies', 'brush', 'script', 'cloner'];

export type SensorRead = 'fill' | 'hover' | 'speed' | 'spread' | 'motion' | 'distance' | 'level' | 'bass' | 'lowmid' | 'highmid' | 'treble';
export const SENSOR_READS_FOR: Record<string, readonly SensorRead[]> = {
  shape: ['fill', 'hover', 'distance'],
  particles: ['speed', 'spread', 'distance'],
  camera: ['motion', 'distance'],
  null: ['distance'],
  audio: ['level', 'bass', 'lowmid', 'highmid', 'treble', 'distance'],
  text: ['distance'], image: ['distance'], lens: ['distance'], bodies: ['distance'], brush: ['distance'], script: ['distance'], cloner: ['distance'],
};

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

// ── Layers (drawn over the picture in JavaScript: types/playLayers.ts) ─────

export type {
  BlendMode, MatteMode, NullLayer, TextLayer, ImageLayer, ParticlesLayer, ParticleField, ParticleShape, ParticleModulator,
  ShapeLayer, ZoneAction, AudioLayer, GlyphsLayer, ContoursLayer, LensLayer, BrushLayer, BodiesLayer, CameraLayer,
  PlayLayer, PlayLayerKind, LayerNumericProp, BackgroundLayer, BackgroundItem, BackgroundItemKind,
} from './playLayers';
export { LAYER_KINDS, LAYER_NUMERIC_PROPS, layerNumericProps, defaultLayer, parseLayer, queueSlot } from './playLayers';
import { parseTakeDataFeeds, type TakeDataFeed } from '../data/streams/takeDataTypes';
import { parseLayer, BACKGROUND_IMAGE_MAX, BACKGROUND_VIDEO_MAX, DATA_IMAGE, DATA_VIDEO, type BackgroundLayer, type PlayLayer } from './playLayers';
import { parseLayerKinds, syncLayerKinds, type LayerKindDef } from './layerKinds';
import { parseSourceCredit, type SourceCredit } from './credit';

// ── Actions (a trigger does something to a layer) ─────────────────────────────

/**
 * What an action does when its trigger fires.
 *   burst    particles: `amount` are born at once, flying out (best with Emit: burst)
 *   scatter  particles or bodies: a random kick
 *   reset    particles reborn · bodies back at the top · brush cleared · text back to its first line
 *   freeze   particles or bodies stop or start again
 *   next / prev / shuffle   text sequence: another line
 *   toggle / show / hide    any layer's visibility
 *   drop     bodies: drop them again from the top
 *   clear    brush: wipe the strokes
 *   next / prev / shuffle / goto   background: another source (goto: the `amount`th, 1 = the first)
 */
export type BuiltinActionKind = 'burst' | 'scatter' | 'reset' | 'freeze' | 'next' | 'prev' | 'shuffle' | 'toggle' | 'show' | 'hide' | 'drop' | 'clear' | 'goto';
/** A built-in action, or a button a Script layer declares (`script:<key>`). */
export type ActionKind = BuiltinActionKind | `script:${string}`;

/** The param key behind a script action kind, or null for a built-in one. */
export function scriptActionKey(kind: string): string | null {
  return kind.startsWith('script:') && /^[A-Za-z_]\w{0,30}$/.test(kind.slice(7)) ? kind.slice(7) : null;
}

export interface PlayAction {
  id: string;
  trigger: TriggerSpec;
  do: ActionKind;
  layerId: string;
  /** burst: how many particles; scatter: how hard. */
  amount: number;
  enabled: boolean;
}

export const ACTION_KINDS: readonly BuiltinActionKind[] = ['burst', 'scatter', 'reset', 'freeze', 'next', 'prev', 'shuffle', 'toggle', 'show', 'hide', 'drop', 'clear', 'goto'];

/** Which actions make sense for which layer kinds. */
export const ACTIONS_FOR: Record<string, readonly BuiltinActionKind[]> = {
  particles: ['burst', 'scatter', 'reset', 'freeze', 'toggle', 'show', 'hide'],
  bodies: ['drop', 'scatter', 'reset', 'freeze', 'toggle', 'show', 'hide'],
  text: ['next', 'prev', 'shuffle', 'reset', 'toggle', 'show', 'hide'],
  brush: ['clear', 'toggle', 'show', 'hide'],
  // Change background: the next, previous, a random or the Nth source; Reset goes back to what Index says.
  background: ['next', 'prev', 'shuffle', 'goto', 'reset', 'toggle', 'show', 'hide'],
  other: ['toggle', 'show', 'hide'],
};

/** The Background layer, when the setup has one (it is always the first layer). */
export function backgroundLayerOf(play: Pick<PlayRecord, 'layers'> | undefined): BackgroundLayer | undefined {
  const l = play?.layers[0];
  return l && l.kind === 'background' ? l : undefined;
}

/**
 * At most one Background layer, and first (drawn at the bottom): the first
 * one found moves to the front, any others are dropped.
 */
export function normaliseBackgroundLayer(layers: PlayLayer[]): PlayLayer[] {
  const i = layers.findIndex(l => l.kind === 'background');
  if (i < 0) return layers;
  const bg = layers[i];
  const rest = layers.filter(l => l.kind !== 'background');
  return i === 0 && rest.length === layers.length - 1 ? layers : [bg, ...rest];
}

/** The actions a layer offers: its kind's built-ins, plus the buttons a script declares. */
export function actionsForLayer(l: PlayLayer | undefined): ActionKind[] {
  const base: ActionKind[] = [...(l ? ACTIONS_FOR[l.kind] ?? ACTIONS_FOR.other : ACTIONS_FOR.other)];
  if (l?.kind === 'script') return [...l.paramDefs.filter(d => d.kind === 'button').map(d => `script:${d.key}` as const), ...base];
  return base;
}

export const ACTION_TARGET_PREFIX = 'act:';

/** Control target for an action on a layer: pressing the control (or a mapping crossing 0.5) fires it. */
export function actionTarget(layerId: string, kind: ActionKind): string {
  return `${ACTION_TARGET_PREFIX}${layerId}::${kind}`;
}

export function parseActionTarget(target: string): { layerId: string; do: ActionKind } | null {
  if (!target.startsWith(ACTION_TARGET_PREFIX)) return null;
  const rest = target.slice(ACTION_TARGET_PREFIX.length);
  const i = rest.lastIndexOf('::');
  const kind = rest.slice(i + 2);
  if (i <= 0 || !((ACTION_KINDS as readonly string[]).includes(kind) || scriptActionKey(kind))) return null;
  return { layerId: rest.slice(0, i), do: kind as ActionKind };
}

/** A new action's default amount: Burst throws a handful, everything else is 1 (Go to: the first source). */
export const defaultActionAmount = (kind: ActionKind) => (kind === 'burst' ? 60 : 1);

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

/**
 * What the Play picture is, under the layers:
 *   shader  the graph (the default)
 *   image   a still picture (a data URL in the record)
 *   video   a video file (a data URL when small enough to keep, else this session only)
 *   colour  the backdrop colour alone: no picture at all, a CPU-only sketch
 * With any source but the shader, the graph doesn't run on the Play page.
 */
export type BackgroundSource = 'shader' | 'image' | 'video' | 'colour';
/** How an image or video meets the canvas: fill it (cropping), fit inside it (bars in the backdrop colour), or stretch to it. */
export type BackgroundFit = 'cover' | 'contain' | 'stretch';

export interface BackgroundImage {
  name: string;
  /** A data URL (PNG, JPEG or WebP), scaled to BACKGROUND_IMAGE_SIDE at most. */
  src: string;
}

export interface BackgroundVideo {
  name: string;
  /** The file as a data URL; '' when it is over BACKGROUND_VIDEO_KEEP (it plays this session only). */
  src: string;
  /** The file's size in bytes. */
  bytes: number;
  loop: boolean;
  muted: boolean;
  /** Playback rate: 1 = as recorded. */
  rate: number;
}

/**
 * How the Play picture is shown. `picture: false` (Layers only) covers the
 * source with the backdrop colour; the source still runs underneath, so
 * mattes and particles can still read it. `source` absent = the shader.
 */
export interface PlayDisplay {
  picture: boolean;
  backdrop: [number, number, number];
  source?: BackgroundSource;
  fit?: BackgroundFit;
  image?: BackgroundImage;
  video?: BackgroundVideo;
}

export interface PlayRecord {
  version: 1;
  controls: PlayControl[];
  mappings: PlayMapping[];
  layers: PlayLayer[];
  /**
   * Sketches saved as layer kinds (types/layerKinds.ts): what Add layer offers
   * beside the built-in kinds, and what layers with a `kindId` are made from.
   * Absent = none.
   */
  layerKinds?: LayerKindDef[];
  /** Triggers that do something to a layer (burst, next line, drop…). Absent = none. */
  actions?: PlayAction[];
  /**
   * Notes shown on the Play page above the controls: what the setup does and
   * what to try. Plain text; blank lines separate paragraphs, lines starting
   * "• " are bullets, **bold** is bold. Travels with the play file.
   */
  notes?: string;
  /**
   * Where the setup comes from (a book chapter, an article), shown linked on
   * the Notes card and under a presentation's canvas. Absent = our own.
   */
  source?: SourceCredit;
  /** Absent means the defaults (picture shown). */
  display?: PlayDisplay;
  /** A MIDI file that plays on the graph clock as if a controller sent it. Absent = none. */
  midiFile?: PlayMidiFile;
  /** Recorded performances (see lib/takes.ts), oldest first. Absent = none. */
  takes?: PlayTake[];
  /** Hand tracking settings (smoothing, the skeleton overlay). Absent = DEFAULT_HANDS. */
  hands?: PlayHands;
}

// ── Takes: a performance recorded as keyframes ──────────────────────────────

/**
 * What a take track plays back into:
 *   control  a Play control (a slider, a colour, a layer property, a null's x/y)
 *   bus      a live node output the input bus writes (MIDI Input's note, gate, CCs…)
 *   audio    an Audio Input node's amplitude uniform
 *   mouse    the shader's u_mouse (the Mouse node), 0..1 of the picture
 *   pointer  the pointer over the layers (x, y, over, down), which Script layers,
 *            particles and brushes read
 */
export type TakeTrackKind = 'control' | 'bus' | 'audio' | 'mouse' | 'pointer';

export interface TakeTrack {
  kind: TakeTrackKind;
  /** control: the control id; bus: the channel key; audio: the uniform name; mouse / pointer: x, y, over or down. */
  id: string;
  /** control only: what it drives (a param path or a layer property). */
  target?: string;
  label: string;
  /** Values per key: 1, or 3 for a colour. */
  width: 1 | 3;
  /** Held from key to key (a press, a hover) instead of blended. */
  step?: boolean;
  /**
   * The keyframes as text, `gap,value[,g,b]` repeated: the gap is whole
   * milliseconds since the previous key (the first from the take's start).
   * Text, not a number array, so a pretty-printed file stays one line per track.
   */
  keys: string;
}

/** An action that fired (a burst, Next line, a script button…), `t` seconds into the take. */
export interface TakeEvent { t: number; do: ActionKind; layerId: string; amount: number }

/**
 * What an audio layer's sound looked like during a take (see lib/takeAudio.ts):
 * analyser frames, about 30 a second, only while an audio layer was showing.
 */
export interface TakeAudioTrack {
  /** 'live' (the audio input) or the id of an audio layer playing its own song. */
  source: string;
  /** The frames hold the waveform, the spectrum (log bands), or both. */
  wave: boolean;
  freq: boolean;
  /** Points / bands per frame. */
  bins: number;
  /** Frame times: whole milliseconds since the previous frame, comma separated. */
  times: string;
  /** The frames, base64: 1 + bins × (wave + freq) bytes each (the first is 1 while the input was on). */
  data: string;
}

export interface PlayTake {
  id: string;
  name: string;
  /** Graph-clock time the take starts at, and how long it runs (s). */
  from: number;
  length: number;
  tracks: TakeTrack[];
  events: TakeEvent[];
  /**
   * The layers' random seed while it was played: unseeded particles, Script
   * layers' random(), bodies' scatter. Playing it back and rendering it start
   * the layers over with it, so they come out the same every time.
   */
  seed?: number;
  /** Audio layers' sound, frame by frame (absent: none was showing). */
  audioFrames?: TakeAudioTrack[];
  /** Live datasets' rows as they came (absent: no stream was connected). Replay feeds these instead of the stream. */
  dataFeeds?: TakeDataFeed[];
}

/** A performance runs up to a minute. */
export const TAKE_MAX_SECONDS = 60;
/** Events a take keeps: an action firing every frame at 120 fps for the whole minute. */
export const TAKE_MAX_EVENTS = 7200;
/** Takes a record keeps; recording another drops the oldest. */
export const TAKES_MAX = 12;
/** Largest take a record keeps, in characters of keyframe text (a busy minute is well under this). */
export const TAKE_MAX_CHARS = 600_000;

/** A .mid file carried in the record (base64), so it saves with the graph and in play files. */
export interface PlayMidiFile {
  name: string;
  data: string;
  /** Start over at the end. */
  loop: boolean;
  /** Seconds of graph clock before the file starts (negative starts partway in), to line up with a song. */
  offset: number;
}

/** Largest .mid a record keeps (base64 characters, about 1.5 MB of file). */
export const MIDI_FILE_MAX = 2_000_000;

export const DEFAULT_DISPLAY: PlayDisplay = { picture: true, backdrop: [0, 0, 0] };

export { BACKGROUND_IMAGE_SIDE, BACKGROUND_IMAGE_MAX, BACKGROUND_VIDEO_KEEP } from './playLayers';
export const BACKGROUND_RATES = [0.25, 0.5, 1, 1.5, 2] as const;

/** What is under the layers: the display's source, the shader when there is no display. */
export function backgroundSource(display: PlayDisplay | undefined): BackgroundSource {
  return display?.source ?? 'shader';
}

/** Does the Play page draw something other than the graph (so the graph doesn't run there)? */
export function replacesShader(display: PlayDisplay | undefined): boolean {
  return backgroundSource(display) !== 'shader';
}

/** Is the picture (whatever its source) covered by the backdrop? A colour background is the backdrop, so never. */
export function pictureHidden(display: PlayDisplay | undefined): boolean {
  return display?.picture === false && backgroundSource(display) !== 'colour';
}

/** Where a video background is at `time` seconds of the graph clock. */
export function videoTimeAt(time: number, duration: number, rate: number, loop: boolean): number {
  if (!(duration > 0) || !Number.isFinite(duration)) return 0;
  const t = Math.max(0, time) * (rate > 0 ? rate : 1);
  // Stop a hair before the end: a video element at its exact duration can show nothing.
  return loop ? t % duration : Math.min(t, Math.max(0, duration - 0.001));
}


/**
 * The display settings from a file, or undefined when they are the defaults.
 * Old files (picture + backdrop only) read as the shader, so their
 * "Layers only" keeps the shader running underneath as it always did.
 */
export function parseDisplay(raw: unknown): PlayDisplay | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;
  const out: PlayDisplay = { picture: d.picture !== false, backdrop: rgb(d.backdrop, DEFAULT_DISPLAY.backdrop) };
  const im = d.image as Record<string, unknown> | undefined;
  if (im && typeof im === 'object' && typeof im.src === 'string' && im.src.length <= BACKGROUND_IMAGE_MAX && DATA_IMAGE.test(im.src)) {
    out.image = { name: typeof im.name === 'string' && im.name.trim() ? im.name.slice(0, 120) : 'Image', src: im.src };
  }
  const vi = d.video as Record<string, unknown> | undefined;
  if (vi && typeof vi === 'object' && typeof vi.name === 'string' && vi.name) {
    const src = typeof vi.src === 'string' && vi.src.length <= BACKGROUND_VIDEO_MAX && DATA_VIDEO.test(vi.src) ? vi.src : '';
    const bytes = typeof vi.bytes === 'number' && Number.isFinite(vi.bytes) && vi.bytes > 0 ? Math.round(vi.bytes) : 0;
    const rate = typeof vi.rate === 'number' && Number.isFinite(vi.rate) ? Math.max(0.1, Math.min(4, vi.rate)) : 1;
    out.video = { name: vi.name.slice(0, 120), src, bytes, loop: vi.loop !== false, muted: vi.muted !== false, rate };
  }
  if (d.fit === 'contain' || d.fit === 'stretch') out.fit = d.fit;
  if (d.source === 'image' || d.source === 'video' || d.source === 'colour') out.source = d.source;
  return isDefaultDisplay(out) ? undefined : out;
}

/** Nothing to save: the shader, shown, on black, with no media kept. */
export function isDefaultDisplay(d: PlayDisplay): boolean {
  return d.picture && !d.source && !d.image && !d.video && !d.fit && d.backdrop.every((v, i) => v === DEFAULT_DISPLAY.backdrop[i]);
}

export const PLAY_VERSION = 1 as const;

export function emptyPlayRecord(): PlayRecord {
  return { version: PLAY_VERSION, controls: [], mappings: [], layers: [] };
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

function parseTriggerOn(raw: unknown): TriggerOn | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  switch (t.on) {
    case 'key': { const code = str(t.code); return code ? { on: 'key', code } : null; }
    case 'note': return { on: 'note', channel: Math.max(0, Math.min(16, Math.round(num(t.channel, 0)))), note: Math.max(-1, Math.min(127, Math.round(num(t.note, -1)))) };
    case 'mouse': return { on: 'mouse' };
    case 'osc': { const address = str(t.address); return address && address.startsWith('/') ? { on: 'osc', address } : null; }
    case 'beat': return { on: 'beat', bpm: Math.max(1, num(t.bpm, 120)), beats: Math.max(0.0625, num(t.beats, 1)) };
    case 'audio': return { on: 'audio', band: LIVE_BANDS_SET.has(t.band as string) ? (t.band as LiveAudioBand) : 'bass', threshold: Math.max(0.01, Math.min(0.99, num(t.threshold, 0.6))) };
    case 'zone': {
      const layerId = str(t.layerId);
      const event = t.event === 'enter' || t.event === 'fill' ? t.event : 'click';
      return layerId ? { on: 'zone', layerId, event, threshold: Math.max(0.01, Math.min(0.99, num(t.threshold, 0.5))) } : null;
    }
    case 'hand': return { on: 'hand', side: handSide(t.side), gesture: handGesture(t.gesture) };
    case 'proximity': {
      const a = str(t.a), b = str(t.b);
      if (!a || !b) return null;
      return {
        on: 'proximity', a, b, when: t.when === 'farther' ? 'farther' : 'closer',
        distance: Math.max(0, Math.min(4, num(t.distance, 0.15))), margin: Math.max(0, Math.min(1, num(t.margin, 0.03))),
      };
    }
    default: return null;
  }
}

/** A trigger with its firing mode: the mode is kept only when it isn't the default (so old files save unchanged). */
function parseTrigger(raw: unknown): TriggerSpec | null {
  const t = parseTriggerOn(raw);
  if (!t) return null;
  const fire = parseFire((raw as Record<string, unknown>).fire);
  return fire ? { ...t, fire } : t;
}

function parseFire(v: unknown): FireSpec | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Record<string, unknown>;
  const mode = f.mode === 'held' || f.mode === 'every' || f.mode === 'release' ? f.mode : null;
  if (!mode) return null;
  const unit = f.unit === 'seconds' ? 'seconds' : 'frames';
  const every = unit === 'frames' ? Math.max(1, Math.min(600, Math.round(num(f.every, 3)))) : Math.max(0.01, Math.min(60, num(f.every, 0.25)));
  return { mode, every, unit };
}

const HAND_READS: ReadonlySet<string> = new Set<HandRead>(['point', 'palm', 'pinch', 'open', 'roll', 'size', 'present', 'spread', 'gesture']);
function handSide(v: unknown): HandSide { return v === 'left' || v === 'any' ? v : 'right'; }
function handGesture(v: unknown): HandGesture { return typeof v === 'string' && (HAND_GESTURES as readonly string[]).includes(v) ? (v as HandGesture) : 'pinch'; }

function parseHands(v: unknown): PlayHands | null {
  if (!v || typeof v !== 'object') return null;
  const h = v as Record<string, unknown>;
  return {
    smoothing: Math.max(0, Math.min(1, num(h.smoothing, DEFAULT_HANDS.smoothing))),
    overlay: h.overlay !== false,
    colour: rgb(h.colour, DEFAULT_HANDS.colour),
    mirror: h.mirror !== false,
  };
}

const SENSOR_READS: ReadonlySet<string> = new Set<SensorRead>(['fill', 'hover', 'speed', 'spread', 'motion', 'distance', 'level', 'bass', 'lowmid', 'highmid', 'treble']);

function parseAction(raw: unknown): PlayAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const id = str(a.id), layerId = str(a.layerId);
  const trigger = parseTrigger(a.trigger);
  // A built-in action, or a button a Script layer declares (`script:<key>`).
  const kind = typeof a.do === 'string' && ((ACTION_KINDS as readonly string[]).includes(a.do) || scriptActionKey(a.do)) ? (a.do as ActionKind) : null;
  if (!id || !layerId || !trigger || !kind) return null;
  return { id, trigger, do: kind, layerId, amount: Math.max(0, num(a.amount, kind === 'burst' ? 60 : 1)), enabled: a.enabled !== false };
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
    case 'sensor': {
      const layerId = str(s.layerId);
      const read = SENSOR_READS.has(s.read as string) ? (s.read as SensorRead) : null;
      return layerId && read ? { kind: 'sensor', layerId, read, otherId: str(s.otherId) ?? '' } : null;
    }
    case 'hand': {
      const read = HAND_READS.has(s.read as string) ? (s.read as HandRead) : 'point';
      return {
        kind: 'hand', side: handSide(s.side), read,
        point: Math.max(0, Math.min(20, Math.round(num(s.point, 8)))),
        axis: s.axis === 'y' || s.axis === 'z' ? s.axis : 'x',
        gesture: handGesture(s.gesture),
      };
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
  const act = parseActionTarget(target);
  const kind: PlayControlKind = act ? 'action' : c.kind === 'color' ? 'color' : 'float';
  const min = num(c.min, 0);
  const max = num(c.max, 1);
  const out: PlayControl = {
    id, target, kind,
    label: str(c.label) ?? target,
    min: Math.min(min, max),
    max: Math.max(min, max),
  };
  if (typeof c.step === 'number' && c.step > 0) out.step = c.step;
  if (act) out.amount = num(c.amount, defaultActionAmount(act.do));
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
  let layers: PlayLayer[] = [];
  const seenL = new Set<string>();
  if (Array.isArray(r.layers)) {
    for (const l of r.layers) {
      const parsed = parseLayer(l);
      if (parsed && !seenL.has(parsed.id)) { seenL.add(parsed.id); layers.push(parsed); }
    }
  }
  // Layers made from a kind take its code; a kind the file lacks leaves a plain Script layer with the code it kept.
  const layerKinds = parseLayerKinds(r.layerKinds);
  layers = normaliseBackgroundLayer(syncLayerKinds(layers, layerKinds));
  // Controls on a layer property need that layer; mappings reading a null need that null.
  const layerIds = new Set(layers.map(l => l.id));
  const keptControls = controls.filter(c => { const lt = parseLayerTarget(c.target) ?? parseActionTarget(c.target); return !lt || layerIds.has(lt.layerId); });
  const keptIds = new Set(keptControls.map(c => c.id));
  // A trigger or sensor on a layer needs that layer too.
  const layerOk = (src: PlaySource) => (src.kind !== 'null' && src.kind !== 'sensor') || layerIds.has(src.layerId);
  const anchorOk = (ref: string) => layerIds.has(ref) || !!parseHandAnchor(ref);
  const triggerOk = (t: TriggerSpec) => t.on === 'zone' ? layerIds.has(t.layerId) : t.on === 'proximity' ? anchorOk(t.a) && anchorOk(t.b) : true;
  const keptMappings = mappings.filter(m => keptIds.has(m.controlId)
    && (m.source.kind !== 'control' || keptIds.has(m.source.controlId))
    && layerOk(m.source)
    && (m.source.kind !== 'trigger' || triggerOk(m.source.trigger)));
  const out: PlayRecord = { version: PLAY_VERSION, controls: keptControls, mappings: keptMappings, layers };
  if (layerKinds.length) out.layerKinds = layerKinds;
  if (Array.isArray(r.actions)) {
    const seenA = new Set<string>();
    const actions: PlayAction[] = [];
    for (const a of r.actions) {
      const parsed = parseAction(a);
      if (parsed && !seenA.has(parsed.id) && layerIds.has(parsed.layerId) && triggerOk(parsed.trigger)) { seenA.add(parsed.id); actions.push(parsed); }
    }
    if (actions.length) out.actions = actions;
  }
  if (typeof r.notes === 'string' && r.notes.trim()) out.notes = r.notes.slice(0, 8000);
  const credit = parseSourceCredit(r.source);
  if (credit) out.source = credit;
  const mf = r.midiFile as Partial<PlayMidiFile> | undefined;
  if (mf && typeof mf === 'object' && typeof mf.data === 'string' && mf.data.length > 0 && mf.data.length <= MIDI_FILE_MAX && /^[A-Za-z0-9+/=]+$/.test(mf.data)) {
    out.midiFile = {
      name: typeof mf.name === 'string' && mf.name.trim() ? mf.name.slice(0, 120) : 'MIDI file',
      data: mf.data,
      loop: mf.loop === true,
      offset: typeof mf.offset === 'number' && Number.isFinite(mf.offset) ? Math.max(-3600, Math.min(3600, mf.offset)) : 0,
    };
  }
  const disp = parseDisplay(r.display);
  if (disp) out.display = disp;
  const hands = parseHands(r.hands);
  if (hands) out.hands = hands;
  if (Array.isArray(r.takes)) {
    const seenT = new Set<string>();
    const takes: PlayTake[] = [];
    for (const t of r.takes.slice(-TAKES_MAX)) {
      const parsed = parseTake(t);
      if (parsed && !seenT.has(parsed.id)) { seenT.add(parsed.id); takes.push(parsed); }
    }
    if (takes.length) out.takes = takes;
  }
  return out;
}

const TAKE_TRACK_KINDS: ReadonlySet<string> = new Set<TakeTrackKind>(['control', 'bus', 'audio', 'mouse', 'pointer']);
const KEYS_TEXT = /^-?[0-9.e+-]*(,-?[0-9.e+-]+)*$/;

/** One take, or null when it is malformed or too big. Tracks and events that don't parse are dropped. */
export function parseTake(raw: unknown): PlayTake | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const from = num(t.from), length = num(t.length);
  if (typeof t.id !== 'string' || !t.id || from === null || length === null || length <= 0 || length > TAKE_MAX_SECONDS + 1) return null;
  const tracks: TakeTrack[] = [];
  let chars = 0;
  for (const k of Array.isArray(t.tracks) ? t.tracks.slice(0, 400) : []) {
    if (!k || typeof k !== 'object') continue;
    const x = k as Record<string, unknown>;
    if (typeof x.kind !== 'string' || !TAKE_TRACK_KINDS.has(x.kind) || typeof x.id !== 'string' || !x.id || typeof x.keys !== 'string' || !KEYS_TEXT.test(x.keys)) continue;
    const width = x.width === 3 ? 3 : 1;
    if (x.keys.split(',').length % (width + 1) !== 0) continue;
    chars += x.keys.length;
    const track: TakeTrack = { kind: x.kind as TakeTrackKind, id: x.id.slice(0, 200), label: typeof x.label === 'string' ? x.label.slice(0, 120) : x.id.slice(0, 120), width, keys: x.keys };
    if (x.kind === 'control') { if (typeof x.target !== 'string' || !x.target) continue; track.target = x.target.slice(0, 400); }
    if (x.step === true) track.step = true;
    tracks.push(track);
  }
  const audioFrames: TakeAudioTrack[] = [];
  for (const a of Array.isArray(t.audioFrames) ? t.audioFrames.slice(0, 16) : []) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Record<string, unknown>;
    const bins = num(x.bins);
    if (typeof x.source !== 'string' || !x.source || bins === null || bins < 1 || bins > 256 || bins !== Math.round(bins)) continue;
    if (typeof x.times !== 'string' || !/^\d*(,\d+)*$/.test(x.times) || typeof x.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(x.data)) continue;
    const wave = x.wave === true, freq = x.freq === true;
    if (!wave && !freq) continue;
    // Every frame has its bytes: base64 of frames × (1 + bins × parts).
    const frames = x.times ? x.times.split(',').length : 0;
    const bytes = Math.floor((x.data.length * 3) / 4) - (x.data.endsWith('==') ? 2 : x.data.endsWith('=') ? 1 : 0);
    if (bytes !== frames * (1 + bins * ((wave ? 1 : 0) + (freq ? 1 : 0)))) continue;
    chars += x.times.length + x.data.length;
    audioFrames.push({ source: x.source.slice(0, 80), wave, freq, bins, times: x.times, data: x.data });
  }
  if (chars > TAKE_MAX_CHARS) return null;
  const events: TakeEvent[] = [];
  // Repeating actions (every few frames while held) can fire thousands of times in a minute.
  for (const e of Array.isArray(t.events) ? t.events.slice(0, TAKE_MAX_EVENTS) : []) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    const at = num(x.t), amount = num(x.amount);
    if (at === null || at < 0 || at > length + 1 || typeof x.do !== 'string' || typeof x.layerId !== 'string') continue;
    if (!(ACTION_KINDS as readonly string[]).includes(x.do) && !scriptActionKey(x.do)) continue;
    events.push({ t: at, do: x.do as ActionKind, layerId: x.layerId, amount: amount ?? 1 });
  }
  events.sort((a, b) => a.t - b.t);
  const dataFeeds = parseTakeDataFeeds(t.dataFeeds, length);
  return {
    id: t.id.slice(0, 80),
    name: typeof t.name === 'string' && t.name.trim() ? t.name.slice(0, 80) : 'Take',
    from, length, tracks, events,
    ...(num(t.seed) !== null && (t.seed as number) > 0 ? { seed: Math.round(t.seed as number) } : {}),
    ...(audioFrames.length ? { audioFrames } : {}),
    ...(dataFeeds.length ? { dataFeeds } : {}),
  };
}


function rgb(v: unknown, fallback: [number, number, number]): [number, number, number] {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(n => typeof n === 'number' && Number.isFinite(n))
    ? [Math.max(0, Math.min(1, v[0])), Math.max(0, Math.min(1, v[1])), Math.max(0, Math.min(1, v[2]))]
    : fallback;
}

/** True when there is nothing to save (the key is then left out of the file). */
export function isPlayRecordEmpty(play: PlayRecord | undefined): boolean {
  return !play || (play.controls.length === 0 && play.mappings.length === 0 && play.layers.length === 0 && !play.layerKinds?.length && !play.actions?.length && !play.notes && !play.midiFile && !play.takes?.length && !play.hands && (!play.display || isDefaultDisplay(play.display)));
}
