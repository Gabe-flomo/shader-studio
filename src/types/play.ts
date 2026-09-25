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
  | { kind: 'null'; layerId: string; axis: 'x' | 'y' };

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

export interface ParticlesLayer extends LayerBase {
  kind: 'particles';
  count: number;
  speed: number;
  size: number;
  opacity: number;
  color: [number, number, number];
  /** Take each particle's colour from the picture under it instead of `color`. */
  colorFromPicture: boolean;
  /** flow: brightness is the heading (turns × 360°). climb: move toward brighter. descend: toward darker. */
  mode: 'flow' | 'climb' | 'descend';
  turns: number;
  /** 0 = no trail, 1 = long trails. */
  trail: number;
  blend: BlendMode;
}

export type PlayLayer = NullLayer | TextLayer | ImageLayer | ParticlesLayer;
export type PlayLayerKind = PlayLayer['kind'];

/** Numeric layer properties a control can drive, per kind. The control's target is `layer:<layerId>::<key>`. */
export const LAYER_NUMERIC_PROPS: Record<PlayLayerKind, ReadonlyArray<{ key: string; label: string; min: number; max: number; step?: number }>> = {
  null: [
    { key: 'x', label: 'X', min: 0, max: 1 },
    { key: 'y', label: 'Y', min: 0, max: 1 },
    { key: 'size', label: 'Size', min: 0, max: 60, step: 1 },
  ],
  text: [
    { key: 'x', label: 'X', min: 0, max: 1 },
    { key: 'y', label: 'Y', min: 0, max: 1 },
    { key: 'size', label: 'Size', min: 0.02, max: 1 },
    { key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1 },
    { key: 'opacity', label: 'Opacity', min: 0, max: 1 },
  ],
  image: [
    { key: 'x', label: 'X', min: 0, max: 1 },
    { key: 'y', label: 'Y', min: 0, max: 1 },
    { key: 'scale', label: 'Scale', min: 0.05, max: 3 },
    { key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1 },
    { key: 'opacity', label: 'Opacity', min: 0, max: 1 },
  ],
  particles: [
    { key: 'speed', label: 'Speed', min: 0, max: 3 },
    { key: 'size', label: 'Size', min: 0.5, max: 12, step: 0.5 },
    { key: 'opacity', label: 'Opacity', min: 0, max: 1 },
    { key: 'turns', label: 'Turns', min: 0, max: 4 },
    { key: 'trail', label: 'Trail', min: 0, max: 1 },
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

export interface PlayRecord {
  version: 1;
  controls: PlayControl[];
  mappings: PlayMapping[];
  layers: PlayLayer[];
}

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
    case 'particles': return { id, kind, label, visible: true, count: 600, speed: 1, size: 2, opacity: 0.8, color: [1, 1, 1], colorFromPicture: false, mode: 'flow', turns: 1, trail: 0.6, blend: 'normal' };
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
  return { version: PLAY_VERSION, controls: keptControls, mappings: keptMappings, layers };
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
    case 'particles':
      return {
        ...d, visible, count: Math.max(1, Math.min(5000, Math.round(num(l.count, d.count)))), speed: Math.max(0, num(l.speed, d.speed)), size: Math.max(0.1, num(l.size, d.size)),
        opacity: Math.max(0, Math.min(1, num(l.opacity, d.opacity))), color: rgb(l.color, d.color), colorFromPicture: l.colorFromPicture === true,
        mode: l.mode === 'climb' || l.mode === 'descend' ? l.mode : 'flow', turns: Math.max(0, num(l.turns, d.turns)), trail: Math.max(0, Math.min(1, num(l.trail, d.trail))), blend: blend(l.blend, d.blend),
      };
  }
}

/** True when there is nothing to save (the key is then left out of the file). */
export function isPlayRecordEmpty(play: PlayRecord | undefined): boolean {
  return !play || (play.controls.length === 0 && play.mappings.length === 0 && play.layers.length === 0);
}
