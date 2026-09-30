/**
 * miniMapper.ts — the "+"'s mini mapper: picking a source wires it onto a
 * target at once (the target's control made first if it isn't on the panel
 * yet), the same "Control only" / MapToMenu / Add control paths already
 * offer (layerOps.ts's resolveTargetControl and mapSourceTo), just grouped
 * the way the owner asked for: Control only, MIDI, Mouse & keys, Hands,
 * Audio, Layers, Generators, Controls, Increment. Pure: no React, unit-
 * tested directly. MiniMapper.tsx renders the sections this builds and
 * calls `wireMiniMapperPick` with the row's value; "Learn" (MIDI or any
 * input) is the one case a component drives itself, through
 * lib/playEngine.ts's startLearn, since it waits for the next input.
 */
import type { IconName } from '../ui/iconPaths';
import type { PickerItem, PickerSection } from '../ui/groupedPickerModel';
import { SENSOR_LABELS, sourceFromType, type SourceType } from '../../play/playSources';
import { defaultIncrement, layerNumericProps, layerTarget, type PlayControl, type PlayLayer, type PlayMapping, type PlayRecord, type PlaySource, type SensorRead } from '../../types/play';
import { mapSourceTo, resolveTargetControl, type MapTarget } from './layerOps';
import { createSignalFrom, type SignalSource } from '../../play/createSignal';
import { layerPorts } from '../../play/layerPorts';

export type MiniMapperTarget = MapTarget;

/**
 * The Random front door (the plan's Shake, Wander, Hop, Chaos): the Noise
 * source's four kinds with rates that feel like their names. Seeded, so the
 * same timeline plays the same way; a new seed each time one is made.
 */
export const RANDOM_PRESETS = [
  { id: 'shake', label: 'Shake', description: 'Quick, smooth jitter around the middle', type: 'smooth', rate: 6 },
  { id: 'wander', label: 'Wander', description: 'Drifts slowly, each step from the last', type: 'drift', rate: 0.5 },
  { id: 'hop', label: 'Hop', description: 'Holds a random value, then jumps to another, once a second', type: 'stepped', rate: 1 },
  { id: 'chaos', label: 'Chaos', description: 'A new random value every moment', type: 'random', rate: 30 },
] as const;

export function randomSource(id: (typeof RANDOM_PRESETS)[number]['id'], seed = Math.floor(Math.random() * 1000)): PlaySource {
  const r = RANDOM_PRESETS.find(x => x.id === id)!;
  return { kind: 'noise', type: r.type, rate: r.rate, seed, steps: 0 };
}

/** The picker's value for "no source": the control alone, mappable later. */
export const CONTROL_ONLY = 'controlOnly';
/** The picker's value for Increment: wires a placeholder source with defaults to tune in Mappings. */
export const INCREMENT = 'increment';
/** The picker's value for Learn: MiniMapper.tsx drives this one itself (it waits for an input). */
export const MIDI_LEARN = 'midi:learn';
/** The picker's value for Create signal: a signal that watches the target (signalFlow.ts createSignalFrom). */
export const CREATE_SIGNAL = 'signal:create';

const HAND_ENTRIES: { value: SourceType; label: string; icon: IconName; description: string }[] = [
  { value: 'hand:point', label: 'Fingertip or joint', icon: 'hand', description: 'X, Y or Z of one point on the hand' },
  { value: 'hand:pinch', label: 'Pinch', icon: 'hand', description: 'Thumb to a fingertip' },
  { value: 'hand:open', label: 'Openness', icon: 'hand', description: 'Fist to open hand' },
  { value: 'hand:palm', label: 'Palm centre', icon: 'hand', description: 'Where the palm is, X or Y' },
  { value: 'hand:roll', label: 'Roll', icon: 'hand', description: 'The turn of the hand' },
  { value: 'hand:size', label: 'Nearness', icon: 'hand', description: 'How big the hand looks' },
  { value: 'hand:present', label: 'Hand in view', icon: 'hand', description: 'On while the hand is seen' },
  { value: 'hand:gesture', label: 'Gesture held', icon: 'hand', description: 'Fist, pinch, point…' },
  { value: 'hand:spread', label: 'Distance between the hands', icon: 'hand', description: 'Palm to palm' },
];

/** What the sections need to know about the setup: MIDI devices seen, and a Camera layer (hands need one). */
export interface MiniMapperContext {
  play: PlayRecord;
  midiDevices: readonly string[];
  hasCamera: boolean;
  /** Audio readers already made for this setup, for the Audio section (audioReaderBank.list()). */
  readers?: ReadonlyArray<{ id: string; name: string }>;
}

const sensorItem = (l: PlayLayer, read: SensorRead): PickerItem => ({ value: `sensor:${l.id}:${read}`, label: `${l.label} · ${SENSOR_LABELS[read]}`, icon: 'eye' });

/** The mini mapper's categories, in the owner's order, gated on what the setup has. */
export function miniMapperSections(ctx: MiniMapperContext): PickerSection[] {
  const { play, midiDevices, hasCamera, readers = [] } = ctx;
  const sections: PickerSection[] = [];
  sections.push({ heading: 'Control only', items: [
    { value: CONTROL_ONLY, label: 'Add as a control', icon: 'plus', description: 'No source — map anything onto it from Mappings later' },
  ] });
  sections.push({ heading: 'Signal', items: [
    { value: CREATE_SIGNAL, label: 'Create a signal from it', icon: 'bolt', description: 'Watch it: a signal when it crosses the middle of its range, tuned on the Signals page' },
  ] });
  if (midiDevices.length) {
    sections.push({ heading: 'MIDI', items: [
      { value: MIDI_LEARN, label: 'Learn…', icon: 'piano', description: `Move a control on ${midiDevices.join(', ')}` },
      { value: 'midi:note', label: 'MIDI note', icon: 'piano', description: 'The note number, 0–1' },
      { value: 'midi:velocity', label: 'MIDI velocity', icon: 'piano', description: 'How hard the last note was hit' },
      { value: 'midi:gate', label: 'MIDI gate', icon: 'piano', description: 'On while a note is held' },
      { value: 'midi:bend', label: 'Pitch bend', icon: 'piano', description: 'The bend wheel' },
    ] });
  }
  sections.push({ heading: 'Mouse & keys', items: [
    { value: 'mouse:x', label: 'Mouse X', icon: 'mouse', description: 'Across the picture' },
    { value: 'mouse:y', label: 'Mouse Y', icon: 'mouse', description: 'Up and down the picture' },
    { value: 'mouse:down', label: 'Mouse button', icon: 'mouse', description: 'Pressed or not' },
    { value: 'key', label: 'Keyboard key', icon: 'keyboard', description: 'Held or not' },
  ] });
  if (hasCamera) sections.push({ heading: 'Hands', items: HAND_ENTRIES });
  const audioItems: PickerItem[] = [{ value: 'live', label: 'Band (bass, treble…)', icon: 'live', description: 'A band of the live input' }];
  for (const r of readers) audioItems.push({ value: `reader:${r.id}`, label: `Reader · ${r.name}`, icon: 'curve' });
  audioItems.push({ value: 'audio', label: 'Audio Input node band', icon: 'nodes', description: 'A band of an Audio Input node in the graph' });
  sections.push({ heading: 'Audio', items: audioItems });
  const layerItems: PickerItem[] = [];
  for (const l of play.layers) {
    for (const r of layerPorts(l).readings) layerItems.push(sensorItem(l, r));
  }
  if (layerItems.length) sections.push({ heading: 'Layers', items: layerItems });
  // Random, by feel (the Noise source underneath): shake, wander, hop, chaos.
  sections.push({ heading: 'Random', items: RANDOM_PRESETS.map(r => ({ value: `random:${r.id}`, label: r.label, icon: 'dice' as const, description: r.description })) });
  sections.push({ heading: 'Generators', items: [
    { value: 'lfo', label: 'LFO', icon: 'wave', description: 'Sine, triangle, saw or square' },
    { value: 'noise', label: 'Noise', icon: 'dice', description: 'Smooth, drifting, random or stepped' },
    { value: 'clock', label: 'Clock', icon: 'clock', description: 'A shape in time with a BPM' },
    { value: 'fn', label: 'Function', icon: 'fn', description: 'A formula over time' },
  ] });
  if (play.controls.length) sections.push({ heading: 'Controls', items: play.controls.map(c => ({ value: `control:${c.id}`, label: c.label, icon: 'sliders' as const })) });
  sections.push({ heading: 'Increment', items: [
    { value: INCREMENT, label: 'Step on a beat, a signal…', icon: 'bolt', description: 'Moves in steps instead of following; tune it in Mappings' },
  ] });
  return sections;
}

export interface WireResult { play: PlayRecord; control?: PlayControl; mapping?: PlayMapping }

/** "Control only": the control alone, no mapping. */
export function wireControlOnly(p: PlayRecord, target: MiniMapperTarget): WireResult {
  return resolveTargetControl(p, target);
}

/** A source picked (or Learned): the control (made first if needed) and a mapping across its whole range. */
export function wireSource(p: PlayRecord, source: PlaySource, target: MiniMapperTarget, smoothMs = 60): WireResult {
  const { play, control } = mapSourceTo(p, source, target, smoothMs);
  const mapping = control && play.mappings.length > p.mappings.length ? play.mappings[play.mappings.length - 1] : undefined;
  return { play, control, mapping };
}

/** Increment: the control, and a mapping with a harmless placeholder source (unused except by a threshold) and Increment's defaults, ready to tune in Mappings. */
export function wireIncrement(p: PlayRecord, target: MiniMapperTarget): WireResult {
  const r = wireSource(p, { kind: 'clock', shape: 'saw', bpm: 120, beats: 4 }, target, 0);
  if (!r.mapping) return r;
  const span = Math.abs(r.mapping.outMax - r.mapping.outMin);
  const step = span > 0 ? Math.round((span / 8) * 1000) / 1000 : 0.1;
  const mappings = r.play.mappings.map(m => (m.id === r.mapping!.id ? { ...m, increment: defaultIncrement(step, 120) } : m));
  return { play: { ...r.play, mappings }, control: r.control, mapping: mappings.find(m => m.id === r.mapping!.id) };
}

/** Every row's value except Learn (MiniMapper.tsx drives that one, since it waits for an input) wires here. */
export function wireMiniMapperPick(p: PlayRecord, value: string, target: MiniMapperTarget): WireResult {
  if (value === CONTROL_ONLY) return wireControlOnly(p, target);
  if (value === INCREMENT) return wireIncrement(p, target);
  if (value.startsWith('sensor:')) {
    const [, layerId, read] = value.split(':');
    return wireSource(p, { kind: 'sensor', layerId, read: read as SensorRead, otherId: '' }, target);
  }
  if (value.startsWith('control:')) return wireSource(p, { kind: 'control', controlId: value.slice('control:'.length) }, target);
  if (value.startsWith('reader:')) return wireSource(p, { kind: 'reader', readerId: value.slice('reader:'.length) }, target);
  if (value.startsWith('random:')) { const r = RANDOM_PRESETS.find(x => x.id === value.slice('random:'.length)); if (r) return wireSource(p, randomSource(r.id), target, 0); }
  return wireSource(p, sourceFromType(value as SourceType, { kind: 'mouse', axis: 'x' }), target);
}

/**
 * What a signal made from `target` watches: a layer property straight from
 * the layer (no control needed), anything else through its control (made
 * first if it isn't on the panel yet).
 */
export function signalSourceFor(p: PlayRecord, target: MiniMapperTarget): { play: PlayRecord; src: SignalSource | null } {
  if ('layerId' in target && 'key' in target) {
    const l = p.layers.find(x => x.id === target.layerId);
    const def = l && layerNumericProps(l).find(d => d.key === target.key);
    if (l && def) return { play: p, src: { value: layerTarget(l.id, def.key), label: `${l.label} ${def.label.toLowerCase()}`, min: def.min, max: def.max } };
  }
  const { play, control } = resolveTargetControl(p, target);
  if (!control || control.kind === 'color') return { play: p, src: null };
  return { play, src: { value: `ctl:${control.id}`, label: control.label, min: control.kind === 'action' ? 0 : control.min, max: control.kind === 'action' ? 1 : control.max } };
}

/** Create signal: a signal watching the target and the action that sends it. Null when nothing can be watched (a colour) or the setup is full of signals. */
export function wireCreateSignal(p: PlayRecord, target: MiniMapperTarget): { play: PlayRecord; signalId: string } | null {
  const { play, src } = signalSourceFor(p, target);
  if (!src) return null;
  const r = createSignalFrom(play, src);
  return r.signalId ? { play: r.play, signalId: r.signalId } : null;
}
