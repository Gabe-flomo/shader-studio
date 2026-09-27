/**
 * The mapping Source picker's sections: every source type from
 * play/playSources.ts, grouped (pointer and keys, the setup, generators, live
 * audio, devices, hands) with an icon and a one-line description, the setup's
 * audio readers under Live audio, and Pro marked where the plan lacks it.
 * Also the trigger-kind and hand-point pickers' sections. Pure.
 */
import type { PickerItem, PickerSection } from '../ui/groupedPickerModel';
import type { IconName } from '../ui/iconPaths';
import type { TriggerSpec } from '../../types/play';
import { HAND_POINT_OPTIONS, OPEN_READERS, sourceOptions, type SourceType } from '../../play/playSources';
import { FREE_TRIGGER_ONS, sourceTypeNeedsPro } from '../../play/planGates';

/** The picker's value for a signal: a trigger source on it. */
export const SIGNAL_SOURCE = 'signal:';

interface Entry { value: SourceType; label: string; icon: IconName; description?: string; keywords?: string }

/** The short face label, icon and description of each source type, in the picker's order. */
const SOURCE_GROUPS: { heading: string; entries: Entry[] }[] = [
  { heading: 'Pointer & keys', entries: [
    { value: 'mouse:x', label: 'Mouse X', icon: 'mouse', description: 'Across the picture', keywords: 'pointer touch' },
    { value: 'mouse:y', label: 'Mouse Y', icon: 'mouse', description: 'Up and down the picture', keywords: 'pointer touch' },
    { value: 'mouse:down', label: 'Mouse button', icon: 'mouse', description: 'Pressed or not', keywords: 'click pointer touch' },
    { value: 'key', label: 'Keyboard key', icon: 'keyboard', description: 'Held or not · Learn picks the key' },
  ] },
  { heading: 'From the setup', entries: [
    { value: 'trigger', label: 'Trigger', icon: 'bolt', description: 'Envelope, toggle or counter fired by an event' },
    { value: 'control', label: 'Another control', icon: 'sliders', description: 'Follows a slider on the panel' },
    { value: 'null', label: 'Null position', icon: 'target', description: 'Where a Null layer sits, X or Y' },
    { value: 'sensor', label: 'Layer sensor', icon: 'eye', description: 'Zone fill, speed, spread, distance…' },
    { value: 'data', label: 'Data', icon: 'table', description: 'A column of a dataset’s current row' },
  ] },
  { heading: 'Generators', entries: [
    { value: 'lfo', label: 'LFO', icon: 'wave', description: 'Sine, triangle, saw or square', keywords: 'oscillator' },
    { value: 'noise', label: 'Noise', icon: 'dice', description: 'Smooth, drifting, random or stepped', keywords: 'random perlin' },
    { value: 'clock', label: 'Clock', icon: 'clock', description: 'A shape in time with a BPM', keywords: 'bpm tempo beat' },
  ] },
  { heading: 'Live audio', entries: [
    { value: 'live', label: 'Audio band', icon: 'live', description: 'Level, bass, mids or treble of the live input', keywords: 'microphone mic' },
  ] },
  { heading: 'Devices', entries: [
    { value: 'midi:cc', label: 'MIDI CC', icon: 'piano', description: 'A knob or fader', keywords: 'controller' },
    { value: 'midi:note', label: 'MIDI note', icon: 'piano', description: 'The note number, 0–1' },
    { value: 'midi:velocity', label: 'MIDI velocity', icon: 'piano', description: 'How hard the last note was hit' },
    { value: 'midi:gate', label: 'MIDI gate', icon: 'piano', description: 'On while a note is held' },
    { value: 'midi:bend', label: 'Pitch bend', icon: 'piano', description: 'The bend wheel', keywords: 'midi' },
    { value: 'pad', label: 'Pad grid', icon: 'grid', description: 'Push, Launchpad: the last pad, or one cell', keywords: 'midi launchpad push pads' },
    { value: 'osc', label: 'OSC', icon: 'antenna', description: 'Ableton, TouchOSC…', keywords: 'network' },
    { value: 'gamepad', label: 'Gamepad', icon: 'gamepad', description: 'A stick axis or a button', keywords: 'controller joystick' },
    { value: 'tilt', label: 'Phone tilt', icon: 'phone', description: 'Tip the phone forward or sideways', keywords: 'gyro orientation' },
  ] },
  { heading: 'Hands', entries: [
    { value: 'hand:point', label: 'Fingertip or joint', icon: 'hand', description: 'X, Y or Z of one point on the hand', keywords: 'finger' },
    { value: 'hand:pinch', label: 'Pinch', icon: 'hand', description: 'Thumb to a fingertip' },
    { value: 'hand:open', label: 'Openness', icon: 'hand', description: 'Fist to open hand' },
    { value: 'hand:palm', label: 'Palm centre', icon: 'hand', description: 'Where the palm is, X or Y' },
    { value: 'hand:roll', label: 'Roll', icon: 'hand', description: 'The turn of the hand' },
    { value: 'hand:size', label: 'Nearness', icon: 'hand', description: 'How big the hand looks' },
    { value: 'hand:present', label: 'Hand in view', icon: 'hand', description: 'On while the hand is seen' },
    { value: 'hand:gesture', label: 'Gesture held', icon: 'hand', description: 'Fist, pinch, point…' },
    { value: 'hand:spread', label: 'Distance between the hands', icon: 'hand', description: 'Palm to palm' },
  ] },
];

/**
 * The Source picker's sections for a setup's readers. `locked` marks Pro on
 * the types the plan lacks (Free passes true).
 */
export function sourcePickerSections(readers: ReadonlyArray<{ id: string; name: string }>, locked: boolean, signals: ReadonlyArray<{ id: string; name: string }> = []): PickerSection[] {
  // The live-audio run of the flat list: the band, the readers, then the way to the panel.
  const live = sourceOptions(readers).filter(o => o.group === 'Live audio' && o.value !== 'live');
  const item = (e: Entry): PickerItem => ({ value: e.value, label: e.label, icon: e.icon, description: e.description, keywords: e.keywords, pro: locked && sourceTypeNeedsPro(e.value) });
  return SOURCE_GROUPS.map(g => {
    const items = g.entries.map(item);
    // Each signal is a trigger on it (an envelope each time it fires).
    if (g.heading === 'From the setup') for (const s of signals) items.push({ value: `${SIGNAL_SOURCE}${s.id}`, label: `Signal · ${s.name}`, icon: 'spark', description: 'Fires when it is sent', keywords: 'signal event', pro: locked });
    if (g.heading === 'Live audio') {
      for (const o of live) {
        items.push(o.value === OPEN_READERS
          ? { value: o.value, label: 'Spectrum readers…', icon: 'popout', description: 'Make readers for a kick, a snare…', keywords: 'reader' }
          : { value: o.value, label: o.label, icon: 'curve', description: 'A slice of the spectrum', keywords: 'reader' });
      }
      items.push(item({ value: 'audio', label: 'Audio Input node band', icon: 'nodes', description: 'A band of an Audio Input node in the graph' }));
    }
    return { heading: g.heading, items };
  });
}

// ── Trigger kinds ─────────────────────────────────────────────────────────────

const TRIGGER_GROUPS: { heading: string; kinds: { on: TriggerSpec['on']; label: string; icon: IconName; description: string }[] }[] = [
  { heading: 'Pointer & keys', kinds: [
    { on: 'key', label: 'Key', icon: 'keyboard', description: 'A key goes down' },
    { on: 'mouse', label: 'Click on the picture', icon: 'mouse', description: 'A press anywhere on the picture' },
  ] },
  { heading: 'Time & audio', kinds: [
    { on: 'beat', label: 'Beat', icon: 'clock', description: 'Every few beats at a BPM' },
    { on: 'audio', label: 'Audio hit', icon: 'live', description: 'A band of the live input gets loud' },
    { on: 'reader', label: 'Audio reader crosses', icon: 'curve', description: 'A spectrum reader goes over its level' },
  ] },
  { heading: 'Devices', kinds: [
    { on: 'note', label: 'MIDI note', icon: 'piano', description: 'A MIDI note is played' },
    { on: 'osc', label: 'OSC message', icon: 'antenna', description: 'An OSC address arrives' },
  ] },
  { heading: 'Layers & hands', kinds: [
    { on: 'zone', label: 'Shape', icon: 'layoutCanvas', description: 'A shape is clicked, entered or filled' },
    { on: 'hand', label: 'Hand gesture', icon: 'hand', description: 'Pinch, fist, point, open palm…' },
    { on: 'proximity', label: 'Proximity', icon: 'bidir', description: 'Two layers or hands come close' },
  ] },
  { heading: 'Conditions & signals', kinds: [
    { on: 'value', label: 'When a value…', icon: 'curve', description: 'A control, a layer, a source or a distance goes below, above or crosses a number' },
    { on: 'signal', label: 'When a signal fires', icon: 'spark', description: 'Sent by a Send a signal action or an axis swap' },
  ] },
];

/** What can fire a trigger (every TRIGGER_KINDS value), grouped, with shorter labels than the old list's since a line under each says more. `locked` marks Pro on what Free can't fire from. */
export function triggerKindSections(locked: boolean): PickerSection[] {
  return TRIGGER_GROUPS.map(g => ({
    heading: g.heading,
    items: g.kinds.map(k => ({ value: k.on, label: k.label, icon: k.icon, description: k.description, pro: locked && !FREE_TRIGGER_ONS.has(k.on) })),
  }));
}

// ── Points on the hand ────────────────────────────────────────────────────────

const TIPS = new Set(['4', '8', '12', '16', '20']);
const KNUCKLES = new Set(['0', '5', '9', '13', '17']);

/** The 21 hand landmarks as fingertips, wrist and knuckles, then the joints between. */
export const HAND_POINT_SECTIONS: PickerSection[] = [
  { heading: 'Fingertips', items: HAND_POINT_OPTIONS.filter(o => TIPS.has(o.value)) },
  { heading: 'Wrist & knuckles', items: HAND_POINT_OPTIONS.filter(o => KNUCKLES.has(o.value)) },
  { heading: 'Joints', items: HAND_POINT_OPTIONS.filter(o => !TIPS.has(o.value) && !KNUCKLES.has(o.value)) },
];
