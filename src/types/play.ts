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

export type TriggerSpec =
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
  | { on: 'zone'; layerId: string; event: 'click' | 'enter' | 'fill'; threshold: number };

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
   *   distance  null: how far it is from another null (`otherId`), 1 = a picture height or more
   */
  | { kind: 'sensor'; layerId: string; read: SensorRead; otherId: string };

export type SensorRead = 'fill' | 'hover' | 'speed' | 'spread' | 'motion' | 'distance' | 'level' | 'bass' | 'lowmid' | 'highmid' | 'treble';
export const SENSOR_READS_FOR: Record<string, readonly SensorRead[]> = {
  shape: ['fill', 'hover'],
  particles: ['speed', 'spread'],
  camera: ['motion'],
  null: ['distance'],
  audio: ['level', 'bass', 'lowmid', 'highmid', 'treble'],
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
  PlayLayer, PlayLayerKind, LayerNumericProp,
} from './playLayers';
export { LAYER_KINDS, LAYER_NUMERIC_PROPS, layerNumericProps, defaultLayer, parseLayer } from './playLayers';
import { parseLayer, type PlayLayer } from './playLayers';

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
 */
export type BuiltinActionKind = 'burst' | 'scatter' | 'reset' | 'freeze' | 'next' | 'prev' | 'shuffle' | 'toggle' | 'show' | 'hide' | 'drop' | 'clear';
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

export const ACTION_KINDS: readonly BuiltinActionKind[] = ['burst', 'scatter', 'reset', 'freeze', 'next', 'prev', 'shuffle', 'toggle', 'show', 'hide', 'drop', 'clear'];

/** Which actions make sense for which layer kinds. */
export const ACTIONS_FOR: Record<string, readonly BuiltinActionKind[]> = {
  particles: ['burst', 'scatter', 'reset', 'freeze', 'toggle', 'show', 'hide'],
  bodies: ['drop', 'scatter', 'reset', 'freeze', 'toggle', 'show', 'hide'],
  text: ['next', 'prev', 'shuffle', 'reset', 'toggle', 'show', 'hide'],
  brush: ['clear', 'toggle', 'show', 'hide'],
  other: ['toggle', 'show', 'hide'],
};

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

/** A new action's default amount: Burst throws a handful, everything else is 1. */
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
  /** Triggers that do something to a layer (burst, next line, drop…). Absent = none. */
  actions?: PlayAction[];
  /**
   * Notes shown on the Play page above the controls: what the setup does and
   * what to try. Plain text; blank lines separate paragraphs, lines starting
   * "• " are bullets, **bold** is bold. Travels with the play file.
   */
  notes?: string;
  /** Absent means the defaults (picture shown). */
  display?: PlayDisplay;
  /** A MIDI file that plays on the graph clock as if a controller sent it. Absent = none. */
  midiFile?: PlayMidiFile;
}

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
    case 'zone': {
      const layerId = str(t.layerId);
      const event = t.event === 'enter' || t.event === 'fill' ? t.event : 'click';
      return layerId ? { on: 'zone', layerId, event, threshold: Math.max(0.01, Math.min(0.99, num(t.threshold, 0.5))) } : null;
    }
    default: return null;
  }
}

const SENSOR_READS: ReadonlySet<string> = new Set<SensorRead>(['fill', 'hover', 'speed', 'spread', 'motion', 'distance', 'level', 'bass', 'lowmid', 'highmid', 'treble']);

function parseAction(raw: unknown): PlayAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const id = str(a.id), layerId = str(a.layerId);
  const trigger = parseTrigger(a.trigger);
  const kind = typeof a.do === 'string' && (ACTION_KINDS as readonly string[]).includes(a.do) ? (a.do as ActionKind) : null;
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
  const keptControls = controls.filter(c => { const lt = parseLayerTarget(c.target) ?? parseActionTarget(c.target); return !lt || layerIds.has(lt.layerId); });
  const keptIds = new Set(keptControls.map(c => c.id));
  // A trigger or sensor on a layer needs that layer too.
  const layerOk = (src: PlaySource) => (src.kind !== 'null' && src.kind !== 'sensor') || layerIds.has(src.layerId);
  const triggerOk = (t: TriggerSpec) => t.on !== 'zone' || layerIds.has(t.layerId);
  const keptMappings = mappings.filter(m => keptIds.has(m.controlId)
    && (m.source.kind !== 'control' || keptIds.has(m.source.controlId))
    && layerOk(m.source)
    && (m.source.kind !== 'trigger' || triggerOk(m.source.trigger)));
  const out: PlayRecord = { version: PLAY_VERSION, controls: keptControls, mappings: keptMappings, layers };
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
  const mf = r.midiFile as Partial<PlayMidiFile> | undefined;
  if (mf && typeof mf === 'object' && typeof mf.data === 'string' && mf.data.length > 0 && mf.data.length <= MIDI_FILE_MAX && /^[A-Za-z0-9+/=]+$/.test(mf.data)) {
    out.midiFile = {
      name: typeof mf.name === 'string' && mf.name.trim() ? mf.name.slice(0, 120) : 'MIDI file',
      data: mf.data,
      loop: mf.loop === true,
      offset: typeof mf.offset === 'number' && Number.isFinite(mf.offset) ? Math.max(-3600, Math.min(3600, mf.offset)) : 0,
    };
  }
  const disp = r.display as Record<string, unknown> | undefined;
  if (disp && typeof disp === 'object' && (disp.picture === false || disp.backdrop !== undefined)) {
    out.display = { picture: disp.picture !== false, backdrop: rgb(disp.backdrop, DEFAULT_DISPLAY.backdrop) };
  }
  return out;
}


function rgb(v: unknown, fallback: [number, number, number]): [number, number, number] {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(n => typeof n === 'number' && Number.isFinite(n))
    ? [Math.max(0, Math.min(1, v[0])), Math.max(0, Math.min(1, v[1])), Math.max(0, Math.min(1, v[2]))]
    : fallback;
}

/** True when there is nothing to save (the key is then left out of the file). */
export function isPlayRecordEmpty(play: PlayRecord | undefined): boolean {
  return !play || (play.controls.length === 0 && play.mappings.length === 0 && play.layers.length === 0 && !play.actions?.length && !play.notes && !play.midiFile && (play.display?.picture ?? true));
}
