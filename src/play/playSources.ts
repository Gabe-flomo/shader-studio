/**
 * playSources.ts — the mappings drawer's source vocabulary: the flat list a
 * <select> offers, conversion to and from the record's PlaySource shape, and
 * short labels. Pure; shared by the Play page and the control rows.
 */
import type { ActionKind, CondCmp, FireMode, FireSpec, HandGesture, HandRead, HandSide, LfoShape, LiveAudioBand, NoiseType, PlayCurve, PlaySignal, PlaySource, SensorRead, TriggerMode, TriggerSpec, ValueCondition } from '../types/play';
import type { PlayFinish } from '../types/playFinish';
import { finishTargetLabel } from '../types/playFinish';
import { audioFxChainLabel, audioFxTargetLabel, parseAudioFxTarget, type PlayAudioFx } from '../types/playAudioFx';
import { sgParseValueRef, sgScreenPoint } from './kit/signals.js';
import { proximityCondition, pulseHz } from './triggers';
import { signalNames } from './signalNames';
import { ANCHOR_KINDS, DEFAULT_FIRE, HAND_PINCH_POINT, PAD_ANCHOR, handAnchor, layerNumericProps, parseEventAnchor, parseHandAnchor, parseSignalAnchor, type PlayLayer } from '../types/play';
import { HD_POINT_NAMES } from './kit/hands.js';
import { datasetStore } from '../data/datasetStore';
import { DATA_ROW_COLUMN } from '../types/play';
import { audioReaderBank } from '../lib/audioReaderBank';
import { readerLabel } from './audioReaders';
import type { PadGridRead } from '../types/playMidi';
import { kmNoteName } from './kit/midi.js';
import { FACE_GESTURE_LABELS, POSE_GESTURE_LABELS, TRACK_SOURCE_TYPES, trackAnchorLabel, trackSource, trackSourceLabel, type FaceSourceType, type PoseSourceType } from './trackSources';
import { parseTrackAnchor } from '../types/playTracking';

export type HandSourceType = `hand:${HandRead}`;
/** `reader:<id>`: one audio reader. */
export type ReaderSourceType = `reader:${string}`;
export type SourceType = FaceSourceType | PoseSourceType | 'mouse:x' | 'mouse:y' | 'mouse:down' | 'key' | 'trigger' | 'control' | 'null' | 'sensor' | 'lfo' | 'noise' | 'clock' | 'fn' | 'live' | 'audio' | 'tilt' | 'gamepad' | 'osc' | 'midi:cc' | 'midi:note' | 'midi:velocity' | 'midi:gate' | 'midi:bend' | 'pad' | 'data' | 'captured' | HandSourceType | ReaderSourceType;
/** Not a source: the picker's entry that opens the Audio readers panel. */
export const OPEN_READERS = 'readers:open';

/**
 * The drop-down's list for a setup: the fixed list, with the setup's audio
 * readers ("Reader · Kick") and "Spectrum readers…" (which opens the panel)
 * under Live audio, after its bands.
 */
export function sourceOptions(readers: ReadonlyArray<{ id: string; name: string }>): { value: string; label: string; group?: string }[] {
  const out: { value: string; label: string; group?: string }[] = [];
  for (const o of SOURCE_TYPES) {
    out.push(o);
    if (o.value === 'live') {
      for (const r of readers) out.push({ value: `reader:${r.id}`, label: readerLabel(r.name), group: 'Live audio' });
      out.push({ value: OPEN_READERS, label: 'Spectrum readers…', group: 'Live audio' });
    }
  }
  return out;
}

/** In the order the drop-down shows them: what everyone has first, MIDI hardware last, then hand tracking under its own heading. */
export const SOURCE_TYPES: { value: SourceType; label: string; group?: string }[] = [
  { value: 'mouse:x', label: 'Mouse X' },
  { value: 'mouse:y', label: 'Mouse Y' },
  { value: 'mouse:down', label: 'Mouse button' },
  { value: 'key', label: 'Keyboard key' },
  { value: 'trigger', label: 'Trigger (envelope, toggle…)' },
  { value: 'control', label: 'Another control' },
  { value: 'null', label: 'Null position' },
  { value: 'sensor', label: 'Layer sensor (zone fill, speed…)' },
  { value: 'data', label: 'Data (the current row of a dataset)' },
  { value: 'captured', label: 'Set from a signal (its captured value)' },
  { value: 'lfo', label: 'LFO' },
  { value: 'noise', label: 'Noise' },
  { value: 'clock', label: 'Clock (BPM)' },
  { value: 'fn', label: 'Function' },
  { value: 'live', label: 'Band (bass, treble…)', group: 'Live audio' },
  { value: 'audio', label: 'Audio Input node band' },
  { value: 'tilt', label: 'Phone tilt' },
  { value: 'gamepad', label: 'Gamepad' },
  { value: 'osc', label: 'OSC (Ableton, TouchOSC…)' },
  { value: 'midi:cc', label: 'MIDI CC' },
  { value: 'midi:note', label: 'MIDI note' },
  { value: 'midi:velocity', label: 'MIDI velocity' },
  { value: 'midi:gate', label: 'MIDI gate' },
  { value: 'midi:bend', label: 'Pitch bend' },
  { value: 'pad', label: 'Pad grid (Push, Launchpad)' },
  { value: 'hand:point', label: 'Fingertip or joint (X, Y, Z)', group: 'Hands' },
  { value: 'hand:pinch', label: 'Pinch (thumb to a finger)', group: 'Hands' },
  { value: 'hand:open', label: 'Openness (fist to open hand)', group: 'Hands' },
  { value: 'hand:palm', label: 'Palm centre', group: 'Hands' },
  { value: 'hand:roll', label: 'Roll (turn of the hand)', group: 'Hands' },
  { value: 'hand:size', label: 'Nearness (how big it looks)', group: 'Hands' },
  { value: 'hand:present', label: 'Hand in view', group: 'Hands' },
  { value: 'hand:gesture', label: 'Gesture held (fist, pinch…)', group: 'Hands' },
  { value: 'hand:spread', label: 'Distance between the hands', group: 'Hands' },
  ...TRACK_SOURCE_TYPES,
];

// ── Hands ────────────────────────────────────────────────────────────────────

export const HAND_SIDES: { value: HandSide; label: string; title: string }[] = [
  { value: 'right', label: 'Right', title: 'Your right hand' },
  { value: 'left', label: 'Left', title: 'Your left hand' },
  { value: 'any', label: 'Either', title: 'Your right hand when it is in view, else your left (gestures: either hand)' },
];
const SIDE_NAMES: Record<HandSide, string> = { right: 'Right', left: 'Left', any: 'Either hand' };

/** The 21 landmarks, fingertips first (what people reach for), for a picker. */
export const HAND_POINT_OPTIONS: { value: string; label: string }[] = [8, 4, 12, 16, 20, 0, 5, 9, 13, 17, 1, 2, 3, 6, 7, 10, 11, 14, 15, 18, 19]
  .map(i => ({ value: `${i}`, label: HD_POINT_NAMES[i] }));
export const PINCH_FINGERS: { value: string; label: string }[] = [
  { value: '8', label: 'Index' }, { value: '12', label: 'Middle' }, { value: '16', label: 'Ring' }, { value: '20', label: 'Pinky' },
];
export const HAND_GESTURE_OPTIONS: { value: HandGesture; label: string; title: string }[] = [
  { value: 'pinch', label: 'Pinch', title: 'Thumb and index fingertips together' },
  { value: 'pinchMiddle', label: 'Middle pinch', title: 'Thumb and middle fingertips together' },
  { value: 'pinchRing', label: 'Ring pinch', title: 'Thumb and ring fingertips together' },
  { value: 'pinchPinky', label: 'Pinky pinch', title: 'Thumb and little fingertips together' },
  { value: 'fist', label: 'Fist', title: 'All four fingers curled in' },
  { value: 'open', label: 'Open palm', title: 'All fingers and the thumb stretched out' },
  { value: 'point', label: 'Point', title: 'Index finger out, the others curled' },
  { value: 'appear', label: 'Comes into view', title: 'Fires when the hand appears; held while it stays' },
  { value: 'leave', label: 'Leaves view', title: 'Fires when the hand goes out of view; held while it is away' },
];
export const HAND_GESTURE_LABELS = Object.fromEntries(HAND_GESTURE_OPTIONS.map(g => [g.value, g.label])) as Record<HandGesture, string>;

/** What each hand reading means, for the row's hint. */
export const HAND_READ_HINTS: Record<HandRead, string> = {
  point: 'X and Y run 0 to 1 across the picture (Y up), with the camera image placed as the Camera layer shows it. Z is 0.5 level with the wrist and grows toward the camera.',
  palm: 'The middle of the palm, 0 to 1 across the picture.',
  pinch: '0 when the fingertips touch, 1 when they are spread wide. Measured against the size of the hand, so it reads the same near and far.',
  open: '0 for a fist, 1 for an open hand.',
  roll: '0.5 with the fingers up; more as the hand leans right, less as it leans left.',
  size: 'How big the hand looks: 0 far from the camera, 1 close to it.',
  present: '1 while the hand is in view, 0 when it is not (a short hold hides dropped frames).',
  gesture: '1 while the gesture is held, 0 otherwise: a gate. For an envelope or a toggle, use Trigger with On: Hand gesture.',
  spread: 'How far apart your two palms are: 1 is a picture width. Reads only while both hands are in view.',
};

/** A new hand source of a reading, keeping the side (and the point, where it still makes sense) of the one it replaces. */
export function handSource(read: HandRead, prev: PlaySource): PlaySource {
  const p = prev.kind === 'hand' ? prev : null;
  const side = p?.side ?? 'right';
  const tips = [8, 12, 16, 20];
  const point = read === 'pinch' ? (p && tips.includes(p.point) ? p.point : 8) : (p?.point ?? 8);
  const axis = read === 'palm' ? (p?.axis === 'y' ? 'y' : 'x') : (p?.axis ?? 'x');
  return { kind: 'hand', side, read, point, axis, gesture: p?.gesture && read === 'gesture' ? p.gesture : 'fist' };
}

/** "Right · Index tip · X", "Left · Pinch", "Hands apart". */
export function handSourceLabel(s: Extract<PlaySource, { kind: 'hand' }>): string {
  const side = SIDE_NAMES[s.side];
  switch (s.read) {
    case 'point': return `${side} · ${HD_POINT_NAMES[s.point] ?? 'Point'} · ${s.axis.toUpperCase()}`;
    case 'palm': return `${side} · Palm ${s.axis === 'y' ? 'Y' : 'X'}`;
    case 'pinch': { const f = PINCH_FINGERS.find(x => x.value === `${s.point}`)?.label ?? 'Index'; return `${side} · ${f === 'Index' ? 'Pinch' : `${f} pinch`}`; }
    case 'open': return `${side} · Openness`;
    case 'roll': return `${side} · Roll`;
    case 'size': return `${side} · Nearness`;
    case 'present': return `${side} · In view`;
    case 'gesture': return `${side} · ${HAND_GESTURE_LABELS[s.gesture]} (held)`;
    case 'spread': return 'Hands apart';
  }
}

export const CHANNELS = [{ value: '0', label: 'All' }, ...Array.from({ length: 16 }, (_, i) => ({ value: `${i + 1}`, label: `${i + 1}` }))];

export const CURVES: { value: PlayCurve; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'exp', label: 'Exp' },
  { value: 'log', label: 'Log' },
  { value: 'custom', label: 'Draw' },
];

export const COLOUR_CHANNELS = [
  { value: 'all', label: 'Brightness' },
  { value: '0', label: 'Red' },
  { value: '1', label: 'Green' },
  { value: '2', label: 'Blue' },
];

export function sourceType(s: PlaySource): SourceType {
  if (s.kind === 'midi') return `midi:${s.signal}` as SourceType;
  if (s.kind === 'mouse') return `mouse:${s.axis}` as SourceType;
  if (s.kind === 'hand') return `hand:${s.read}`;
  if (s.kind === 'face') return `face:${s.read}`;
  if (s.kind === 'pose') return `pose:${s.read}`;
  if (s.kind === 'reader') return `reader:${s.readerId}`;
  return s.kind;
}

/** `otherControlId` is the first control a new control source may point at (not the mapping's own target); `nullId` the first null layer; `sensor` the first layer that measures something. */
export function sourceFromType(t: SourceType, prev: PlaySource, otherControlId = '', nullId = '', sensor: { layerId: string; read: SensorRead } | null = null, dataset = ''): PlaySource {
  if (t.startsWith('hand:')) return handSource(t.slice(5) as HandRead, prev);
  if (t.startsWith('face:')) return trackSource('face', t.slice(5), prev);
  if (t.startsWith('pose:')) return trackSource('pose', t.slice(5), prev);
  if (t.startsWith('reader:')) return { kind: 'reader', readerId: t.slice(7) };
  const channel = prev.kind === 'midi' ? prev.channel : 0;
  // A note range carries over between note, velocity and gate; locks stay with a CC.
  const range = prev.kind === 'midi' && prev.range ? { range: prev.range } : {};
  switch (t) {
    // A CC row starts without a knob: the first CC that moves becomes its CC (lib/midiAutoLearn.ts).
    case 'midi:cc': return { kind: 'midi', signal: 'cc', channel, ...(prev.kind === 'midi' && prev.cc !== undefined ? { cc: prev.cc } : {}), ...(prev.kind === 'midi' && prev.locks ? { locks: prev.locks } : {}) };
    case 'midi:note': return { kind: 'midi', signal: 'note', channel, ...range };
    case 'midi:velocity': return { kind: 'midi', signal: 'velocity', channel, ...range };
    case 'midi:gate': return { kind: 'midi', signal: 'gate', channel, ...range };
    case 'pad': return prev.kind === 'pad' ? prev : { kind: 'pad', read: 'x', col: 0, row: 0 };
    case 'midi:bend': return { kind: 'midi', signal: 'bend', channel };
    case 'mouse:x': return { kind: 'mouse', axis: 'x' };
    case 'mouse:y': return { kind: 'mouse', axis: 'y' };
    case 'mouse:down': return { kind: 'mouse', axis: 'down' };
    case 'key': return { kind: 'key', code: prev.kind === 'key' ? prev.code : 'Space' };
    case 'control': return { kind: 'control', controlId: prev.kind === 'control' ? prev.controlId : otherControlId };
    case 'null': return { kind: 'null', layerId: prev.kind === 'null' ? prev.layerId : nullId, axis: 'x' };
    case 'sensor': return prev.kind === 'sensor' ? prev : { kind: 'sensor', layerId: sensor?.layerId ?? '', read: sensor?.read ?? 'fill', otherId: '' };
    case 'lfo': return { kind: 'lfo', shape: 'sine', rate: 0.5, phase: 0 };
    case 'live': return { kind: 'live', band: 'bass', gain: 1 };
    case 'noise': return { kind: 'noise', type: 'smooth', rate: 1, seed: Math.floor(Math.random() * 1000), steps: 0 };
    case 'osc': return { kind: 'osc', address: prev.kind === 'osc' ? prev.address : '/1/fader1', arg: 0, min: 0, max: 1 };
    case 'trigger': return { kind: 'trigger', trigger: prev.kind === 'key' ? { on: 'key', code: prev.code } : { on: 'key', code: 'Space' }, mode: 'envelope', attack: 10, decay: 200, sustain: 0.5, release: 400, steps: 4, velocity: false };
    case 'clock': return { kind: 'clock', shape: 'saw', bpm: 120, beats: 4 };
    case 'fn': return prev.kind === 'fn' ? prev : { kind: 'fn', expr: '', min: -1, max: 1 };
    case 'audio': return { kind: 'audio', nodeId: prev.kind === 'audio' ? prev.nodeId : '', band: 0 };
    case 'tilt': return { kind: 'tilt', axis: 'gamma' };
    case 'gamepad': return { kind: 'gamepad', pad: 0, control: 'axis', index: 0 };
    case 'data': return prev.kind === 'data' ? prev : { kind: 'data', dataset, column: DATA_ROW_COLUMN, layerId: '' };
    case 'captured': return prev.kind === 'captured' ? prev : { kind: 'captured', signal: '', release: 'stay' };
    default: return prev;
  }
}

/** Short human name for a source ("CC 74 · ch. 1", "Key D", "Mouse X", "← Amount"). */
export function sourceLabel(s: PlaySource, controls: ReadonlyArray<{ id: string; label: string }> = [], layers: ReadonlyArray<{ id: string; label: string }> = []): string {
  if (s.kind === 'mouse') return s.axis === 'down' ? 'Mouse button' : `Mouse ${s.axis.toUpperCase()}`;
  if (s.kind === 'null') return `${layers.find(l => l.id === s.layerId)?.label ?? 'Null'} ${s.axis.toUpperCase()}`;
  if (s.kind === 'sensor') return `${layers.find(l => l.id === s.layerId)?.label ?? 'Layer'} ${SENSOR_LABELS[s.read].toLowerCase()}${s.read === 'distance' && s.otherId ? ` to ${anchorLabel(s.otherId, layers)}` : ''}`;
  if (s.kind === 'data') return dataSourceLabel(s);
  if (s.kind === 'key') return `Key ${keyName(s.code)}`;
  if (s.kind === 'control') return `← ${controls.find(c => c.id === s.controlId)?.label ?? 'control'}`;
  if (s.kind === 'lfo') return `LFO ${s.shape} ${s.rate} Hz`;
  if (s.kind === 'noise') return `Noise ${s.type}${s.type === 'random' ? '' : ` ${s.rate}/s`}`;
  if (s.kind === 'osc') return `OSC ${s.address}`;
  if (s.kind === 'live') return `Live ${LIVE_BAND_LABELS[s.band]}`;
  if (s.kind === 'reader') return readerLabel(audioReaderBank.name(s.readerId));
  if (s.kind === 'trigger') return `${s.mode === 'envelope' ? 'Env' : s.mode === 'toggle' ? 'Toggle' : s.mode === 'step' ? 'Step' : 'Random'} · ${triggerLabel(s.trigger, layers)}`;
  if (s.kind === 'clock') return `${s.bpm} bpm · ${s.beats} beat${s.beats === 1 ? '' : 's'}`;
  if (s.kind === 'fn') return s.expr ? `ƒ ${s.expr}` : 'Function';
  if (s.kind === 'audio') return `Audio band ${s.band + 1}`;
  if (s.kind === 'tilt') return `Tilt ${s.axis === 'beta' ? 'front/back' : s.axis === 'gamma' ? 'left/right' : 'compass'}`;
  if (s.kind === 'gamepad') return `Pad ${s.pad + 1} ${s.control} ${s.index}`;
  if (s.kind === 'hand') return handSourceLabel(s);
  if (s.kind === 'face' || s.kind === 'pose') return trackSourceLabel(s);
  if (s.kind === 'pad') return padSourceLabel(s);
  if (s.kind === 'captured') return `Set · ${signalName(s.signal)}’s value${s.release === 'back' ? ', then back' : s.release === 'value' ? `, then ${s.rest ?? 0}` : ''}`;
  const ch = s.channel === 0 ? '' : ` · ch. ${s.channel}`;
  const range = s.range ? ` ${kmNoteName(s.range[0])}–${kmNoteName(s.range[1])}` : '';
  switch (s.signal) {
    case 'cc': return s.locks?.length ? `CC ${s.locks.map(l => l.cc).join(', ')} · locked` : s.cc === undefined ? 'MIDI CC · turn a knob' : `CC ${s.cc}${ch}`;
    case 'note': return `Note${range}${ch}`;
    case 'velocity': return `Velocity${range}${ch}`;
    case 'gate': return `Gate${range}${ch}`;
    case 'bend': return `Bend${ch}`;
  }
}

const PAD_LABELS: Record<PadGridRead, string> = { x: 'Pad X', y: 'Pad Y', velocity: 'Pad velocity', pressure: 'Pad pressure', gate: 'Pad gate', cell: 'Pad cell' };
/** "Pad X", "Pad cell 3, 5". */
export function padSourceLabel(s: Extract<PlaySource, { kind: 'pad' }>): string {
  if (s.read === 'cell') return `Pad cell ${s.col + 1}, ${s.row + 1}`;
  return PAD_LABELS[s.read];
}

/** "Data · City climate · current · temp_c" (the row position reads "row"). */
export function dataSourceLabel(s: Extract<PlaySource, { kind: 'data' }>): string {
  const name = datasetStore.get(s.dataset)?.name ?? (s.dataset || 'no dataset');
  return `Data · ${name} · current · ${s.column === DATA_ROW_COLUMN ? 'row' : s.column}`;
}

export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}


export const LFO_SHAPES: { value: LfoShape; label: string }[] = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'saw', label: 'Saw' },
  { value: 'square', label: 'Square' },
  { value: 'random', label: 'Random' },
];

export const TILT_AXES = [
  { value: 'gamma', label: 'Left / right' },
  { value: 'beta', label: 'Front / back' },
  { value: 'alpha', label: 'Compass' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** "Key Space", "C4 · ch. 2", "Any note", "Click", "OSC /1/push1", "Every beat", "Dot near Box". */
export function triggerLabel(t: TriggerSpec, layers: ReadonlyArray<{ id: string; label: string }> = [], ctx: LabelContext = {}): string {
  switch (t.on) {
    case 'key': return `Key ${keyName(t.code)}`;
    case 'note': return `${t.note < 0 ? 'Any note' : `${NOTE_NAMES[t.note % 12]}${Math.floor(t.note / 12) - 1}`}${t.channel ? ` · ch. ${t.channel}` : ''}`;
    case 'mouse': return 'Click';
    case 'osc': return `OSC ${t.address}`;
    case 'beat': return t.unit === 'hz' ? `Pulse @ ${Math.round(pulseHz(t) * 1000) / 1000} Hz` : t.beats === 1 ? `Every beat @ ${t.bpm}` : `Every ${t.beats} beats @ ${t.bpm}`;
    case 'audio': return `${LIVE_BAND_LABELS[t.band]} hit`;
    case 'zone': return t.event === 'click' ? 'Click on shape' : t.event === 'enter' ? 'Pointer enters shape' : `Shape fills to ${Math.round(t.threshold * 100)}%`;
    case 'hand': return `${SIDE_NAMES[t.side]} · ${HAND_GESTURE_LABELS[t.gesture]}`;
    case 'face': return `Face · ${FACE_GESTURE_LABELS[t.gesture]}`;
    case 'pose': return `Pose · ${POSE_GESTURE_LABELS[t.gesture]}`;
    case 'proximity': return `${anchorLabel(t.a, layers)} ${t.when === 'closer' ? 'near' : 'away from'} ${anchorLabel(t.b, layers)}`;
    case 'reader': return `${audioReaderBank.name(t.readerId) ?? 'Reader'} crosses ${Math.round(t.threshold * 100)}%`;
    case 'value': return conditionLabel(t, { layers, ...ctx });
    case 'signal': return `Signal ${signalName(t.signal, ctx.signals)}`;
  }
}

// ── Conditions and signals ──────────────────────────────────────────────────

/** What names a condition's value path and a signal need: the setup's parts, as far as the caller has them. */
export interface LabelContext {
  layers?: ReadonlyArray<{ id: string; label: string }>;
  controls?: ReadonlyArray<{ id: string; label: string }>;
  signals?: ReadonlyArray<PlaySignal>;
  mappings?: ReadonlyArray<{ id: string; source: PlaySource }>;
  finish?: PlayFinish;
  audioFx?: PlayAudioFx;
}

/** A signal's name ("Missing signal" when it was deleted). */
export function signalName(id: string, signals?: ReadonlyArray<PlaySignal>): string {
  return (signals ? signals.find(x => x.id === id)?.name : signalNames.get(id)) ?? (id ? 'Missing signal' : 'Pick one');
}

export const COND_LABELS: Record<CondCmp, { label: string; word: string; title: string }> = {
  below: { label: 'Below', word: 'below', title: 'While it is under the threshold' },
  above: { label: 'Above', word: 'above', title: 'While it is over the threshold' },
  crossUp: { label: 'Crosses ↑', word: 'crosses up', title: 'The moment it passes the threshold going up' },
  crossDown: { label: 'Crosses ↓', word: 'crosses down', title: 'The moment it passes the threshold going down' },
  equals: { label: 'Equals', word: 'equals', title: 'While it is within the tolerance of the threshold' },
  not: { label: 'Is not', word: 'is not', title: 'While it is further than the tolerance from the threshold' },
  between: { label: 'Between', word: 'between', title: 'While it is inside a band: between the two edges' },
  outside: { label: 'Outside', word: 'outside', title: 'While it is outside a band: under the low edge or over the high one' },
  neverAbove: { label: 'Never reached', word: 'has never reached', title: 'While the highest it has been is still under the threshold (starts over on a rewind)' },
  neverBelow: { label: 'Never dropped to', word: 'has never dropped to', title: 'While the lowest it has been is still over the threshold (starts over on a rewind)' },
  rising: { label: 'Rising', word: 'is rising', title: 'While it is going up: its recent average is over its longer one by more than the dead-band' },
  falling: { label: 'Falling', word: 'is falling', title: 'While it is going down: its recent average is under its longer one by more than the dead-band' },
  changing: { label: 'Changing', word: 'is changing', title: 'While it is moving either way (its start is when a change begins, its end when it settles)' },
  steady: { label: 'Steady', word: 'is steady', title: 'While it is not moving more than the dead-band' },
};

const round = (n: number) => `${Math.round(n * 1000) / 1000}`;

/** "Radius above 0.5", "Dot ↔ Box below 0.1", "Mouse X crosses up 0.8". */
export function conditionLabel(c: ValueCondition, ctx: LabelContext = {}): string {
  const pct = c.unit === 'pct';
  const n = (x: number) => (pct ? `${round(x * 100)}%` : round(x));
  if (c.cmp === 'rising' || c.cmp === 'falling' || c.cmp === 'changing' || c.cmp === 'steady') return `${valueRefLabel(c.value, ctx)} ${COND_LABELS[c.cmp].word}`;
  const band = (c.cmp === 'between' || c.cmp === 'outside') && typeof c.hi === 'number';
  const what = band ? `${n(Math.min(c.threshold, c.hi!))} and ${n(Math.max(c.threshold, c.hi!))}` : n(c.threshold);
  const tol = c.cmp === 'equals' || c.cmp === 'not' ? ` ± ${n(c.tolerance)}` : '';
  return `${valueRefLabel(c.value, ctx)} ${COND_LABELS[c.cmp].word} ${what}${tol}`;
}

/** A condition's value in words: "Amount", "Dot · x", "Grade · Exposure", "Mouse X", "Dot ↔ Mouse". */
export function valueRefLabel(ref: string, ctx: LabelContext = {}): string {
  const r = sgParseValueRef(ref);
  if (!r) return 'Pick a value';
  switch (r.kind) {
    case 'control': return ctx.controls?.find(c => c.id === r.id)?.label ?? 'Missing control';
    case 'mapping': { const m = ctx.mappings?.find(x => x.id === r.id); return m ? `${sourceLabel(m.source, ctx.controls, ctx.layers)} (source)` : 'Missing mapping'; }
    case 'mouse': return `Mouse ${r.axis.toUpperCase()}`;
    case 'distance': return `${anchorLabel(r.a, ctx.layers)} ↔ ${anchorLabel(r.b, ctx.layers)}`;
    case 'reading': return `${ctx.layers?.find(l => l.id === r.layerId)?.label ?? 'Missing layer'} · ${SENSOR_LABELS[r.read as SensorRead] ?? r.read}`;
    case 'axis': return `${anchorLabel(r.anchor, ctx.layers)} ${r.axis.toUpperCase()}`;
    case 'picture': return `${r.ch === 'lum' ? 'Brightness' : r.ch === 'r' ? 'Red' : r.ch === 'g' ? 'Green' : 'Blue'} ${r.region === 'all' ? 'of the picture' : `under ${anchorLabel(r.region, ctx.layers)}`}`;
    case 'prop': {
      if (r.layerId.startsWith('finish:')) {
        const f = finishTargetLabel(ctx.finish, `finish:${r.layerId.slice(7)}::${r.key}`);
        return f ? `${f.effect} · ${f.param}` : `Finish · ${r.key}`;
      }
      if (r.layerId.startsWith('audiofx:')) {
        const target = `${r.layerId}::${r.key}`;
        const f = audioFxTargetLabel(ctx.audioFx, target), t = parseAudioFxTarget(target);
        return f && t ? `${audioFxChainLabel(t.chainId, ctx.layers)} · ${f.effect} · ${f.param}` : `Sound · ${r.key}`;
      }
      // Given whole layers (not just ids and labels), the property's own name: "Sparks · Spawn radius", not "spawnRadius".
      const l = ctx.layers?.find(x => x.id === r.layerId);
      const def = l && 'kind' in l ? layerNumericProps(l as unknown as PlayLayer).find(d => d.key === r.key) : undefined;
      return `${l?.label ?? 'Missing layer'} · ${def?.label ?? r.key}`;
    }
  }
}

// ── Anchors (what proximity and distance measure between) ───────────────────

/** "Right · Index tip", "Mouse", "Point 0.5, 0.5", or the layer's name. */
export function anchorLabel(ref: string, layers: ReadonlyArray<{ id: string; label: string }> = []): string {
  if (ref === 'mouse') return 'Mouse';
  if (ref === 'pointer') return 'Pointer on the picture';
  if (ref === PAD_ANCHOR) return 'Pad grid · last pad';
  const pt = sgScreenPoint(ref);
  if (pt) return `Point ${round(pt.x)}, ${round(pt.y)}`;
  const h = parseHandAnchor(ref);
  if (h) return `${SIDE_NAMES[h.side]} · ${h.point === HAND_PINCH_POINT ? 'Pinch point' : HD_POINT_NAMES[h.point] ?? 'Point'}`;
  const sa = parseSignalAnchor(ref);
  if (sa) return `${signalName(sa.id)}’s position${sa.held ? ' (while true)' : ''}`;
  const ev = parseEventAnchor(ref);
  if (ev) return `${layers.find(l => l.id === ev.layerId)?.label ?? 'Missing layer'} · latest ${ev.event === 'born' ? 'birth' : ev.event === 'died' ? 'death' : 'annihilation'}`;
  const tr = parseTrackAnchor(ref);
  if (tr) return trackAnchorLabel(tr.kind, tr.point);
  return layers.find(l => l.id === ref)?.label ?? (ref ? 'Missing layer' : 'Pick one');
}

/** Layers with a centre on the picture, for an anchor picker. */
export function anchorLayers<L extends { id: string; kind: string }>(layers: ReadonlyArray<L>): L[] {
  return layers.filter(l => ANCHOR_KINDS.includes(l.kind));
}

/**
 * The first picker of an anchor: every positioned layer, then the three
 * hands (the landmark is picked beside it). A hand anchor's value here is
 * `hand:<side>`; anchorChoice() turns a pick back into a ref.
 */
export function anchorOptions(layers: ReadonlyArray<{ id: string; label: string; kind: string }>, exclude = ''): { value: string; label: string; group?: string }[] {
  return [
    ...anchorLayers(layers).filter(l => l.id !== exclude).map(l => ({ value: l.id, label: l.label, group: 'Layers' })),
    { value: 'hand:right', label: 'Right hand', group: 'Hands' },
    { value: 'hand:left', label: 'Left hand', group: 'Hands' },
    { value: 'hand:any', label: 'Either hand', group: 'Hands' },
  ];
}
/** The first picker's value for a ref. */
export function anchorPick(ref: string): string {
  const h = parseHandAnchor(ref);
  return h ? `hand:${h.side}` : ref;
}
/** A ref from the first picker's value, keeping the landmark of a hand ref it replaces (the index tip for a new one). */
export function anchorChoice(pick: string, prev: string): string {
  if (!pick.startsWith('hand:')) return pick;
  return handAnchor(pick.slice(5) as HandSide, parseHandAnchor(prev)?.point ?? 8);
}

// ── Firing modes ────────────────────────────────────────────────────────────

/** "On release" for a key, "On exit" for things that come and go (a shape, proximity, a hand). */
export function releaseLabel(t: TriggerSpec): string {
  return t.on === 'value' ? 'When it stops' : t.on === 'proximity' || t.on === 'zone' || ((t.on === 'hand' || t.on === 'face' || t.on === 'pose') && (t.gesture === 'appear' || t.gesture === 'leave')) ? 'On exit' : 'On release';
}

export function fireModes(t: TriggerSpec): { value: FireMode; label: string; title: string }[] {
  const held = t.on === 'value' ? 'while the condition holds' : t.on === 'proximity' ? 'while close' : t.on === 'beat' ? 'on each beat’s first quarter' : t.on === 'reader' || t.on === 'audio' ? 'while it stays above the threshold' : 'while held';
  return [
    { value: 'once', label: 'Once', title: t.on === 'proximity' ? 'When A comes close to B (or goes far, for Farther than)' : t.on === 'reader' || t.on === 'audio' ? 'When the level goes above the threshold' : 'When it starts: the key goes down, the gesture begins' },
    { value: 'held', label: 'Continuously', title: `Every frame ${held}` },
    { value: 'every', label: 'Every N', title: `At the start, then every few frames or seconds ${held}` },
    { value: 'release', label: releaseLabel(t), title: t.on === 'proximity' ? 'When A moves away again' : t.on === 'reader' || t.on === 'audio' ? 'When the level falls back below the threshold (less the hysteresis)' : 'When it lets go: the key comes up, the gesture ends' },
    { value: 'nth', label: 'Every Nth', title: 'Counts: fires on every Nth time it happens (the 4th, the 8th…)' },
    { value: 'within', label: 'N within T', title: 'Counts: fires when it happens N times within a few seconds (a double tap, three hits in a second)' },
  ];
}

/** The same trigger with a firing mode (the default mode leaves the field off, so files stay as they were). */
export function withFire(t: TriggerSpec, fire: FireSpec | undefined): TriggerSpec {
  const { fire: _drop, ...rest } = t;
  void _drop;
  return fire && fire.mode !== 'once' ? { ...rest, fire } : (rest as TriggerSpec);
}

/** A trigger's firing mode, filled in. */
export function fireOf(t: TriggerSpec): FireSpec {
  return t.fire ?? DEFAULT_FIRE;
}

/** "Once", "Every frame", "Every 3 frames", "Every 0.25 s", "On release". */
export function fireLabel(t: TriggerSpec): string {
  const f = fireOf(t);
  switch (f.mode) {
    case 'once': return 'Once';
    case 'held': return 'Every frame';
    case 'every': return f.unit === 'frames' ? `Every ${f.every} frame${f.every === 1 ? '' : 's'}` : `Every ${f.every} s`;
    case 'release': return releaseLabel(t);
    case 'nth': return `Every ${ordinal(f.every)} time`;
    case 'within': return `${f.every} times within ${f.window ?? 1} s`;
  }
}

/** 2 → "2nd", 3 → "3rd", 11 → "11th". */
export function ordinal(n: number): string {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

/**
 * What goes wrong when something fires over and over, or null when that is
 * fine (a burst every 3 frames is a stream of sparks). Keyed by what fires:
 * an action kind, or a trigger mapping's mode (`mode:toggle`). A new action
 * that shouldn't repeat adds a line here.
 */
const REPEAT_HINTS: Record<string, string> = {
  toggle: 'A toggle fired every frame flickers on and off. Use Once, or Every N with a longer gap.',
  freeze: 'Freeze flips between frozen and moving each time it fires, so repeating it stutters. Use Once.',
  next: 'Each fire moves on (another line, row or background), so repeating it races through them and cuts crossfades short. Every N seconds reads better.',
  prev: 'Each fire moves back (another line, row or background), so repeating it races through them and cuts crossfades short. Every N seconds reads better.',
  shuffle: 'Each fire picks another line, row or background, so repeating it flickers. Every N seconds reads better.',
  // goto: repeating Go to N shows the same source again, which changes nothing.
  drop: 'Each fire drops the bodies from the top again, so repeating it keeps them in the air.',
  reset: 'Each fire starts the layer over, so repeating it holds it at the start.',
  'mode:toggle': 'A toggle fired every frame flickers between its two values. Use Once, or Every N with a longer gap.',
  'mode:step': 'A step fired every frame races through its steps. Every N reads better.',
  'mode:random': 'A new random value every frame is jitter. That may be what you want; Noise → Random does the same.',
};

/** The hint for firing `what` (an action kind, or `mode:<trigger mode>`) with this firing mode, or null. */
export function repeatHint(what: ActionKind | `mode:${TriggerMode}`, fire: FireSpec | undefined): string | null {
  if (!fire || fire.mode === 'once' || fire.mode === 'release') return null;
  // Every N slower than about a fifth of a second is a rhythm, not a flicker.
  if (fire.mode === 'every' && (fire.unit === 'seconds' ? fire.every >= 0.2 : fire.every >= 12)) return null;
  return REPEAT_HINTS[what] ?? null;
}

export const SENSOR_LABELS: Record<SensorRead, string> = {
  fill: 'Fill', hover: 'Hover', speed: 'Speed', spread: 'Spread', motion: 'Motion', distance: 'Distance', level: 'Level', bass: 'Bass', lowmid: 'Low-mid', highmid: 'High-mid', treble: 'Treble', area: 'Area', perimeter: 'Perimeter',
  alive: 'Alive', centroidX: 'Centre X', centroidY: 'Centre Y', group1: 'Group 1 alive', group2: 'Group 2 alive', group3: 'Group 3 alive', group4: 'Group 4 alive',
  born: 'Born this step', died: 'Died this step',
  gap: 'Gap', closing: 'Closing', chaseSpeed: 'Chase speed', sight: 'In sight', catch: 'Catch', sinceCatch: 'Since catch', catches: 'Catches', picture: 'Picture',
  grains: 'Grain count', grainMean: 'Grain position', grainSpread: 'Grain spread', grainLevel: 'Grain level', grainPitch: 'Grain pitch', grainPos: 'One grain’s position', grainAmp: 'One grain’s level',
  grainBandMean: 'Grain band (mean)', grainEnergySum: 'Grain energy', grainBand: 'One grain’s band', grainEnergy: 'One grain’s energy', grainRow: 'One grain’s row',
};
export const SENSOR_HINTS: Record<SensorRead, string> = {
  fill: 'How full of particles the shape is: 0.5 is as dense as average, 1 is twice that or more.',
  hover: '1 while the pointer is over the shape, else 0.',
  speed: 'How fast the particles (or agents) are moving on average, against their Speed setting (agents: against the Max speed rule, else a picture height per second).',
  spread: 'Particles: how spread out they are, near 0 in a clump, near 1 everywhere. A path shape: its points’ mean distance from their centre, 1 at half a picture height or more.',
  area: 'A path shape: the share of the picture it covers, 0 to 1 (lines and webs: the area their points span). Fades with the shape.',
  perimeter: 'A path shape: its outline’s length (a web: all its links), 1 as long as the picture’s own edge.',
  motion: 'How much is moving in front of the camera.',
  distance: 'How far this layer’s centre is from another layer or a point on a hand: 0 touching, 1 a picture height or more.',
  level: 'How loud the layer’s sound is overall (its Gain scales it).',
  bass: 'Bass, 25–150 Hz: kicks and bass lines.',
  lowmid: 'Low-mids, 150–600 Hz: body, warmth, most voices.',
  highmid: 'High-mids, 600 Hz–3 kHz: snares, leads, presence.',
  treble: 'Treble, 3–12 kHz: hi-hats, cymbals, air.',
  alive: 'Agents: the share of the layer’s agents alive, 0 none, 1 all of them. Particles: the same, of Count.',
  centroidX: 'Agents: where the live agents’ centre is across the picture, 0 the left edge, 1 the right.',
  centroidY: 'Agents: where the live agents’ centre is up the picture, 0 the bottom, 1 the top.',
  group1: 'Agents: the share of group 1 alive (its count is 1).', group2: 'Agents: the share of group 2 alive.', group3: 'Agents: the share of group 3 alive.', group4: 'Agents: the share of group 4 alive.',
  born: 'How many were born this step: a burst, a stream respawn, a Multiply bud, an Agents respawn. 0 most steps.',
  died: 'How many died this step: age, a kill boundary, an annihilation, a Cull action, a catch or an energy drain. 0 most steps.',
  gap: 'Relationship: how far apart its closest pair is (a chase: the closest chaser and prey), 0 touching, 1 a picture height or more.',
  closing: 'Relationship: how fast the closest pair is closing in. 0.5 is neither; 1 is closing at full speed, 0 parting at full speed.',
  chaseSpeed: 'Relationship: how fast the chasers move (repel and attract: everyone), against the Max speed.',
  sight: 'Relationship: 1 while a chaser has prey in sight, else 0.',
  catch: 'Relationship: 1 on the frame a chaser catches its prey, fading out over a quarter of a second. Agents: the same for a Catch rule.',
  sinceCatch: 'Relationship: how long since the last catch, 1 at ten seconds or more (and before the first).',
  catches: 'Relationship (or an Agents layer’s Catch rules): how many catches so far, 1 at twenty or more.',
  grains: 'Granulator: how many grains are sounding, 1 at 64.',
  grainMean: 'Granulator: where in the sample the grains read on average, 0 the start, 1 the end.',
  grainSpread: 'Granulator: how scattered the grains are through the sample, 0 all at one spot.',
  grainLevel: 'Granulator: how loud the grains are on average.',
  grainPitch: 'Granulator: the grains’ mean pitch, 0.5 as sampled, 0 four octaves down, 1 four up.',
  grainPos: 'Granulator: where one grain (its number) reads in the sample, 0 to 1; 0 when there is no such grain.',
  grainAmp: 'Granulator: one grain’s level now; 0 when there is no such grain.',
  grainBandMean: 'Granulator, Spectral mode: the sounding grains’ mean band centre, 0 the bottom of the spectrum (20 Hz), 1 the top (log scale).',
  grainEnergySum: 'Granulator, Spectral mode: how much energy the spectral grains carry together, 1 when loud.',
  grainBand: 'Granulator, Spectral mode: one grain’s band centre (its number), 0 the bottom of the spectrum, 1 the top; 0 when there is no such grain.',
  grainEnergy: 'Granulator, Spectral mode: one grain’s energy now (its band’s peaks, through its window); 0 when there is no such grain.',
  grainRow: 'Granulator: where the grain draws on the card (docs/granulator.md), 0 to 1 — pan-based when Pan random is on, else a stable hash of its slot; 0 when there is no such grain.',
  picture: 'The picture under this layer, in its Picture channel (brightness unless its relationship says otherwise). Reads while the layer is a member of a Relationship; on the relationship itself, the mean under its members.',
};

export const LIVE_BAND_LABELS: Record<LiveAudioBand, string> = { level: 'Level', bass: 'Bass', lowmid: 'Low-mid', highmid: 'High-mid', treble: 'Treble' };
export const LIVE_BAND_OPTIONS = (Object.keys(LIVE_BAND_LABELS) as LiveAudioBand[]).map(b => ({ value: b, label: LIVE_BAND_LABELS[b] }));

export const TRIGGER_KINDS: { value: TriggerSpec['on']; label: string }[] = [
  { value: 'key', label: 'Key' },
  { value: 'mouse', label: 'Click on the picture' },
  { value: 'beat', label: 'Beat or pulse (BPM, Hz)' },
  { value: 'audio', label: 'Audio hit (live input)' },
  { value: 'reader', label: 'Audio reader crosses' },
  { value: 'note', label: 'MIDI note' },
  { value: 'osc', label: 'OSC message' },
  { value: 'zone', label: 'Shape (click, enter, fill)' },
  { value: 'hand', label: 'Hand gesture (pinch, fist…)' },
  { value: 'face', label: 'Face gesture (mouth open, blink…)' },
  { value: 'pose', label: 'Pose gesture (hands up, arms out…)' },
  { value: 'proximity', label: 'Proximity (two things close)' },
  { value: 'value', label: 'When a value… (below, above, crosses)' },
  { value: 'signal', label: 'When a signal fires' },
];

/**
 * A new trigger of a kind, keeping what still makes sense of the one it
 * replaces (its firing mode always). `layers` supplies a new shape trigger's
 * shape and a new proximity trigger's two layers.
 */
export function triggerFromKind(on: TriggerSpec['on'], prev: TriggerSpec, layers: ReadonlyArray<{ id: string; kind: string }> = [], readerId = '', signalId = ''): TriggerSpec {
  return withFire(triggerOnFromKind(on, prev, layers, readerId, signalId), prev.fire);
}

function triggerOnFromKind(on: TriggerSpec['on'], prev: TriggerSpec, layers: ReadonlyArray<{ id: string; kind: string }>, readerId: string, signalId: string): TriggerSpec {
  const shapeId = layers.find(l => l.kind === 'shape')?.id ?? '';
  switch (on) {
    case 'key': return { on: 'key', code: prev.on === 'key' ? prev.code : 'Space' };
    case 'mouse': return { on: 'mouse' };
    case 'beat': return { on: 'beat', bpm: prev.on === 'beat' ? prev.bpm : 120, beats: prev.on === 'beat' ? prev.beats : 1 };
    case 'note': return { on: 'note', channel: 0, note: -1 };
    case 'osc': return { on: 'osc', address: prev.on === 'osc' ? prev.address : '/1/push1' };
    case 'audio': return { on: 'audio', band: prev.on === 'audio' ? prev.band : 'bass', threshold: prev.on === 'audio' ? prev.threshold : 0.6 };
    case 'zone': return { on: 'zone', layerId: prev.on === 'zone' ? prev.layerId : shapeId, event: prev.on === 'zone' ? prev.event : 'click', threshold: prev.on === 'zone' ? prev.threshold : 0.5 };
    case 'hand': return { on: 'hand', side: prev.on === 'hand' ? prev.side : 'right', gesture: prev.on === 'hand' ? prev.gesture : 'pinch' };
    case 'face': return { on: 'face', gesture: prev.on === 'face' ? prev.gesture : 'mouthOpen' };
    case 'pose': return { on: 'pose', gesture: prev.on === 'pose' ? prev.gesture : 'handsUp' };
    case 'reader': return prev.on === 'reader' ? prev : { on: 'reader', readerId, threshold: prev.on === 'audio' ? prev.threshold : 0.6, hysteresis: 0.1 };
    case 'proximity': {
      if (prev.on === 'proximity') return prev;
      // Nulls first (the usual pair), then anything with a centre; a hand when there is only one layer.
      const pos = anchorLayers(layers).sort((x, y) => (x.kind === 'null' ? 0 : 1) - (y.kind === 'null' ? 0 : 1));
      const a = pos[0]?.id ?? handAnchor('right', 8);
      const b = pos.find(l => l.id !== a)?.id ?? (a.startsWith('hand:') ? '' : handAnchor('right', 8));
      return { on: 'proximity', a, b, when: 'closer', distance: 0.15, margin: 0.03 };
    }
    case 'value': {
      if (prev.on === 'value') return prev;
      // A proximity trigger becomes its distance condition; otherwise the mouse, which everyone has.
      if (prev.on === 'proximity') return { on: 'value', ...proximityCondition(prev) };
      return { on: 'value', value: 'mouse:x', cmp: 'crossUp', threshold: 0.5, hysteresis: 0.05, tolerance: 0.01 };
    }
    case 'signal': return prev.on === 'signal' ? prev : { on: 'signal', signal: signalId };
  }
}

export const TRIGGER_MODES: { value: TriggerMode; label: string; title: string }[] = [
  { value: 'envelope', label: 'Envelope', title: 'Attack, decay, sustain while held, release' },
  { value: 'toggle', label: 'Toggle', title: 'Flips between 0 and 1' },
  { value: 'step', label: 'Step', title: 'Walks through even steps, then wraps' },
  { value: 'random', label: 'Random', title: 'A new random value each time' },
];

export const NOISE_TYPES: { value: NoiseType; label: string; title: string }[] = [
  { value: 'smooth', label: 'Smooth', title: 'Glides between random points' },
  { value: 'drift', label: 'Drift', title: 'Slow wandering with finer wobble on top' },
  { value: 'random', label: 'Random', title: 'A new random value every frame' },
  { value: 'stepped', label: 'Stepped', title: 'Holds a random value, then jumps: posterised time' },
];
