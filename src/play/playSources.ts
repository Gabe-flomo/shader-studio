/**
 * playSources.ts — the mappings drawer's source vocabulary: the flat list a
 * <select> offers, conversion to and from the record's PlaySource shape, and
 * short labels. Pure; shared by the Play page and the control rows.
 */
import type { HandGesture, HandRead, HandSide, LfoShape, LiveAudioBand, NoiseType, PlayCurve, PlaySource, SensorRead, TriggerMode, TriggerSpec } from '../types/play';
import { HD_POINT_NAMES } from './kit/hands.js';

export type HandSourceType = `hand:${HandRead}`;
export type SourceType = 'mouse:x' | 'mouse:y' | 'mouse:down' | 'key' | 'trigger' | 'control' | 'null' | 'sensor' | 'lfo' | 'noise' | 'clock' | 'live' | 'audio' | 'tilt' | 'gamepad' | 'osc' | 'midi:cc' | 'midi:note' | 'midi:velocity' | 'midi:gate' | 'midi:bend' | HandSourceType;

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
  { value: 'lfo', label: 'LFO' },
  { value: 'noise', label: 'Noise' },
  { value: 'clock', label: 'Clock (BPM)' },
  { value: 'live', label: 'Live audio in (mic, Ableton…)' },
  { value: 'audio', label: 'Audio Input node band' },
  { value: 'tilt', label: 'Phone tilt' },
  { value: 'gamepad', label: 'Gamepad' },
  { value: 'osc', label: 'OSC (Ableton, TouchOSC…)' },
  { value: 'midi:cc', label: 'MIDI CC' },
  { value: 'midi:note', label: 'MIDI note' },
  { value: 'midi:velocity', label: 'MIDI velocity' },
  { value: 'midi:gate', label: 'MIDI gate' },
  { value: 'midi:bend', label: 'Pitch bend' },
  { value: 'hand:point', label: 'Fingertip or joint (X, Y, Z)', group: 'Hands' },
  { value: 'hand:pinch', label: 'Pinch (thumb to a finger)', group: 'Hands' },
  { value: 'hand:open', label: 'Openness (fist to open hand)', group: 'Hands' },
  { value: 'hand:palm', label: 'Palm centre', group: 'Hands' },
  { value: 'hand:roll', label: 'Roll (turn of the hand)', group: 'Hands' },
  { value: 'hand:size', label: 'Nearness (how big it looks)', group: 'Hands' },
  { value: 'hand:present', label: 'Hand in view', group: 'Hands' },
  { value: 'hand:gesture', label: 'Gesture held (fist, pinch…)', group: 'Hands' },
  { value: 'hand:spread', label: 'Distance between the hands', group: 'Hands' },
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
  return s.kind;
}

/** `otherControlId` is the first control a new control source may point at (not the mapping's own target); `nullId` the first null layer; `sensor` the first layer that measures something. */
export function sourceFromType(t: SourceType, prev: PlaySource, otherControlId = '', nullId = '', sensor: { layerId: string; read: SensorRead } | null = null): PlaySource {
  if (t.startsWith('hand:')) return handSource(t.slice(5) as HandRead, prev);
  const channel = prev.kind === 'midi' ? prev.channel : 0;
  switch (t) {
    case 'midi:cc': return { kind: 'midi', signal: 'cc', channel, cc: prev.kind === 'midi' && prev.cc !== undefined ? prev.cc : 1 };
    case 'midi:note': return { kind: 'midi', signal: 'note', channel };
    case 'midi:velocity': return { kind: 'midi', signal: 'velocity', channel };
    case 'midi:gate': return { kind: 'midi', signal: 'gate', channel };
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
    case 'audio': return { kind: 'audio', nodeId: prev.kind === 'audio' ? prev.nodeId : '', band: 0 };
    case 'tilt': return { kind: 'tilt', axis: 'gamma' };
    case 'gamepad': return { kind: 'gamepad', pad: 0, control: 'axis', index: 0 };
    default: return prev;
  }
}

/** Short human name for a source ("CC 74 · ch. 1", "Key D", "Mouse X", "← Amount"). */
export function sourceLabel(s: PlaySource, controls: ReadonlyArray<{ id: string; label: string }> = [], layers: ReadonlyArray<{ id: string; label: string }> = []): string {
  if (s.kind === 'mouse') return s.axis === 'down' ? 'Mouse button' : `Mouse ${s.axis.toUpperCase()}`;
  if (s.kind === 'null') return `${layers.find(l => l.id === s.layerId)?.label ?? 'Null'} ${s.axis.toUpperCase()}`;
  if (s.kind === 'sensor') return `${layers.find(l => l.id === s.layerId)?.label ?? 'Layer'} ${SENSOR_LABELS[s.read].toLowerCase()}`;
  if (s.kind === 'key') return `Key ${keyName(s.code)}`;
  if (s.kind === 'control') return `← ${controls.find(c => c.id === s.controlId)?.label ?? 'control'}`;
  if (s.kind === 'lfo') return `LFO ${s.shape} ${s.rate} Hz`;
  if (s.kind === 'noise') return `Noise ${s.type}${s.type === 'random' ? '' : ` ${s.rate}/s`}`;
  if (s.kind === 'osc') return `OSC ${s.address}`;
  if (s.kind === 'live') return `Live ${LIVE_BAND_LABELS[s.band]}`;
  if (s.kind === 'trigger') return `${s.mode === 'envelope' ? 'Env' : s.mode === 'toggle' ? 'Toggle' : s.mode === 'step' ? 'Step' : 'Random'} · ${triggerLabel(s.trigger)}`;
  if (s.kind === 'clock') return `${s.bpm} bpm · ${s.beats} beat${s.beats === 1 ? '' : 's'}`;
  if (s.kind === 'audio') return `Audio band ${s.band + 1}`;
  if (s.kind === 'tilt') return `Tilt ${s.axis === 'beta' ? 'front/back' : s.axis === 'gamma' ? 'left/right' : 'compass'}`;
  if (s.kind === 'gamepad') return `Pad ${s.pad + 1} ${s.control} ${s.index}`;
  if (s.kind === 'hand') return handSourceLabel(s);
  const ch = s.channel === 0 ? '' : ` · ch. ${s.channel}`;
  switch (s.signal) {
    case 'cc': return `CC ${s.cc ?? 1}${ch}`;
    case 'note': return `Note${ch}`;
    case 'velocity': return `Velocity${ch}`;
    case 'gate': return `Gate${ch}`;
    case 'bend': return `Bend${ch}`;
  }
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

/** "Key Space", "C4 · ch. 2", "Any note", "Click", "OSC /1/push1", "Every beat". */
export function triggerLabel(t: TriggerSpec): string {
  switch (t.on) {
    case 'key': return `Key ${keyName(t.code)}`;
    case 'note': return `${t.note < 0 ? 'Any note' : `${NOTE_NAMES[t.note % 12]}${Math.floor(t.note / 12) - 1}`}${t.channel ? ` · ch. ${t.channel}` : ''}`;
    case 'mouse': return 'Click';
    case 'osc': return `OSC ${t.address}`;
    case 'beat': return t.beats === 1 ? `Every beat @ ${t.bpm}` : `Every ${t.beats} beats @ ${t.bpm}`;
    case 'audio': return `${LIVE_BAND_LABELS[t.band]} hit`;
    case 'zone': return t.event === 'click' ? 'Click on shape' : t.event === 'enter' ? 'Pointer enters shape' : `Shape fills to ${Math.round(t.threshold * 100)}%`;
    case 'hand': return `${SIDE_NAMES[t.side]} · ${HAND_GESTURE_LABELS[t.gesture]}`;
  }
}

export const SENSOR_LABELS: Record<SensorRead, string> = { fill: 'Fill', hover: 'Hover', speed: 'Speed', spread: 'Spread', motion: 'Motion', distance: 'Distance', level: 'Level', bass: 'Bass', lowmid: 'Low-mid', highmid: 'High-mid', treble: 'Treble' };
export const SENSOR_HINTS: Record<SensorRead, string> = {
  fill: 'How full of particles the shape is: 0.5 is as dense as average, 1 is twice that or more.',
  hover: '1 while the pointer is over the shape, else 0.',
  speed: 'How fast the particles are moving on average, against their Speed setting.',
  spread: 'How spread out the particles are: near 0 in a clump, near 1 everywhere.',
  motion: 'How much is moving in front of the camera.',
  distance: 'How far this null is from another one: 1 is a picture height or more.',
  level: 'How loud the layer’s sound is overall (its Gain scales it).',
  bass: 'Bass, 25–150 Hz: kicks and bass lines.',
  lowmid: 'Low-mids, 150–600 Hz: body, warmth, most voices.',
  highmid: 'High-mids, 600 Hz–3 kHz: snares, leads, presence.',
  treble: 'Treble, 3–12 kHz: hi-hats, cymbals, air.',
};

export const LIVE_BAND_LABELS: Record<LiveAudioBand, string> = { level: 'Level', bass: 'Bass', lowmid: 'Low-mid', highmid: 'High-mid', treble: 'Treble' };
export const LIVE_BAND_OPTIONS = (Object.keys(LIVE_BAND_LABELS) as LiveAudioBand[]).map(b => ({ value: b, label: LIVE_BAND_LABELS[b] }));

export const TRIGGER_KINDS: { value: TriggerSpec['on']; label: string }[] = [
  { value: 'key', label: 'Key' },
  { value: 'mouse', label: 'Click on the picture' },
  { value: 'beat', label: 'Beat' },
  { value: 'audio', label: 'Audio hit (live input)' },
  { value: 'note', label: 'MIDI note' },
  { value: 'osc', label: 'OSC message' },
  { value: 'zone', label: 'Shape (click, enter, fill)' },
  { value: 'hand', label: 'Hand gesture (pinch, fist…)' },
];

/** `shapeId` is the first shape layer, for a new shape trigger. */
export function triggerFromKind(on: TriggerSpec['on'], prev: TriggerSpec, shapeId = ''): TriggerSpec {
  switch (on) {
    case 'key': return { on: 'key', code: prev.on === 'key' ? prev.code : 'Space' };
    case 'mouse': return { on: 'mouse' };
    case 'beat': return { on: 'beat', bpm: prev.on === 'beat' ? prev.bpm : 120, beats: prev.on === 'beat' ? prev.beats : 1 };
    case 'note': return { on: 'note', channel: 0, note: -1 };
    case 'osc': return { on: 'osc', address: prev.on === 'osc' ? prev.address : '/1/push1' };
    case 'audio': return { on: 'audio', band: prev.on === 'audio' ? prev.band : 'bass', threshold: prev.on === 'audio' ? prev.threshold : 0.6 };
    case 'zone': return { on: 'zone', layerId: prev.on === 'zone' ? prev.layerId : shapeId, event: prev.on === 'zone' ? prev.event : 'click', threshold: prev.on === 'zone' ? prev.threshold : 0.5 };
    case 'hand': return { on: 'hand', side: prev.on === 'hand' ? prev.side : 'right', gesture: prev.on === 'hand' ? prev.gesture : 'pinch' };
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
