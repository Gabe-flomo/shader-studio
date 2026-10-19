/**
 * mapPicker.ts — the Sources column's one "+ Map" button (Play audit P6): a
 * picker grouped by kind — Learn, MIDI, Keys, Mouse, Audio, Hands, LFO / Beat,
 * Random, Behaviours — then the rest of the source types (devices, the setup,
 * face, pose) under their own headings. It replaces "Learn", "Add" (which
 * silently made a MIDI CC mapping on the first control and asked for MIDI
 * access) and "+ Source" (Random only).
 *
 * Picking a type makes a source of the record and starts Map mode (click the
 * controls it should drive); Learn starts Learn mode (inputs/learnMode.ts).
 * Only MIDI kinds and Learn ask for the browser's MIDI access (mapPickAsksMidi).
 *
 * The MIDI file and the pad grid are kinds here too, under MIDI (audit P10):
 * picking one adds it to the record (a .mid from the file picker; the pad grid
 * with its defaults) and opens its card in the Sources column, where it is
 * edited like the other sources (inputs/FileSources.tsx). There is one of
 * each, so once the setup has it the item says so and picking it opens it.
 *
 * Ableton Live (the Live connector, docs/live-connector-plan.md) has its own section after
 * the kinds: Learn from Live, the "Playfield" rack's macros, the selected device's parameters,
 * any parameter (picked on its card), Live's beat, bar and playing, and clip and scene launches.
 *
 * Pure: the page and its tests share it.
 */
import type { PickerItem, PickerSection } from '../ui/groupedPickerModel';
import { OPEN_READERS, type SourceType } from '../../play/playSources';
import { RANDOM_SOURCES } from '../../play/routeOps';
import { sourceTypeNeedsPro } from '../../play/planGates';
import { SIGNAL_SOURCE, sourcePickerSections } from './sourcePickerSections';

export const MAP_LEARN = 'learn';
export const MAP_BEHAVIOURS = 'behaviours';
/** "12 notes → 12 targets…" (NoteClassMapDialog). */
export const MAP_NOTES12 = 'notes12';
/** A .mid played as if from a controller (the record's one `midiFile`). */
export const MAP_MIDI_FILE = 'midiFile';
/** A Push or Launchpad's pads as a grid shader's cells (the record's one `padGrid`). */
export const MAP_PAD_GRID = 'padGrid';
const TYPE = 'type:';
/** Ableton Live: Learn (click a parameter in Live), a parameter by key, clip and scene triggers, how to connect. */
export const MAP_LIVE_LEARN = 'live:learn';
export const MAP_LIVE_CLIP = 'live:clip';
export const MAP_LIVE_SCENE = 'live:scene';
export const MAP_LIVE_CONNECT = 'live:connect';
const LIVE_KEY = 'live:key:';
export const LIVE_HEADING = 'Ableton Live';
const RANDOM = 'random:';

/** The kinds, in the order the picker shows them (audit P6), then the rest. */
export const MAP_KINDS = ['Learn', 'MIDI', 'Keys', 'Mouse', 'Audio', 'Hands', 'LFO / Beat', 'Random', 'Behaviours'] as const;

export type MapPick =
  | { kind: 'learn' }
  | { kind: 'behaviours' }
  | { kind: 'notes12' }
  | { kind: 'midiFile' }
  | { kind: 'padGrid' }
  | { kind: 'readers' }
  | { kind: 'random'; index: number }
  | { kind: 'signal'; id: string }
  | { kind: 'type'; type: SourceType }
  | { kind: 'liveLearn' }
  | { kind: 'liveKey'; key: string }
  | { kind: 'liveClip' }
  | { kind: 'liveScene' }
  | { kind: 'liveConnect' };

export function parseMapPick(v: string): MapPick | null {
  if (v === MAP_LEARN) return { kind: 'learn' };
  if (v === MAP_BEHAVIOURS) return { kind: 'behaviours' };
  if (v === MAP_NOTES12) return { kind: 'notes12' };
  if (v === MAP_MIDI_FILE) return { kind: 'midiFile' };
  if (v === MAP_PAD_GRID) return { kind: 'padGrid' };
  if (v === MAP_LIVE_LEARN) return { kind: 'liveLearn' };
  if (v === MAP_LIVE_CLIP) return { kind: 'liveClip' };
  if (v === MAP_LIVE_SCENE) return { kind: 'liveScene' };
  if (v === MAP_LIVE_CONNECT) return { kind: 'liveConnect' };
  if (v.startsWith(LIVE_KEY)) return v.length > LIVE_KEY.length ? { kind: 'liveKey', key: v.slice(LIVE_KEY.length) } : null;
  if (v.startsWith(RANDOM)) { const i = Number(v.slice(RANDOM.length)); return Number.isInteger(i) && RANDOM_SOURCES[i] ? { kind: 'random', index: i } : null; }
  if (!v.startsWith(TYPE)) return null;
  const t = v.slice(TYPE.length);
  if (t === OPEN_READERS) return { kind: 'readers' };
  if (t.startsWith(SIGNAL_SOURCE)) return { kind: 'signal', id: t.slice(SIGNAL_SOURCE.length) };
  return { kind: 'type', type: t as SourceType };
}

/** Does this pick need the browser's MIDI access? Nothing else asks for it (no prompt, no red error). */
export function mapPickAsksMidi(v: string): boolean {
  const p = parseMapPick(v);
  if (!p) return false;
  // A MIDI file plays inside the app: it needs no MIDI access. The pad grid listens to a controller.
  if (p.kind === 'learn' || p.kind === 'notes12' || p.kind === 'padGrid') return true;
  return p.kind === 'type' && (p.type.startsWith('midi:') || p.type === 'pad');
}

/** Values in the source-type sections that the kinds above take (so "More" lists only the rest). */
const KIND_TYPES: Record<string, readonly string[]> = {
  MIDI: ['midi:cc', 'midi:note', 'midi:velocity', 'midi:gate', 'midi:bend'],
  Keys: ['key'],
  Mouse: ['mouse:x', 'mouse:y', 'mouse:down'],
  'LFO / Beat': ['lfo', 'clock', 'fn'],
};
/** Face labels in the picker where the source type's own reads oddly out of context. */
const RELABEL: Record<string, { label: string; description?: string }> = {
  'midi:cc': { label: 'Knob or fader (CC)', description: 'The first knob you turn becomes it' },
  key: { label: 'Keyboard key', description: 'Held or not · pick the key on its card' },
  clock: { label: 'Beat', description: 'A shape in time with a BPM' },
};

/** What the picker needs to know about the setup's one MIDI file and one pad grid. */
export interface MapPickerFiles {
  /** The setup has a MIDI file (its name), or not. */
  midiFile?: string | null;
  /** The setup has a pad grid. */
  padGrid?: boolean;
  /** Playing a MIDI file is Pro (`play.midiFile`) and the plan lacks it. */
  midiFileLocked?: boolean;
}

/** What the picker shows of Ableton Live (from lib/liveClient.ts): the connection, the rack's macros, the selected device. */
export interface MapPickerLive {
  connected: boolean;
  /** "Fake Set · 120 BPM" when connected; else why not ("Waiting for Live…"). */
  status: string;
  /** The "Playfield" rack's macros. */
  rack: ReadonlyArray<{ key: string; name: string; track: string }>;
  /** The selected device (Live's blue hand) and its first parameters. */
  selected?: { track: string; device: string; params: ReadonlyArray<{ key: string; name: string }> };
}

/** How many of the selected device's parameters the picker lists (the rest: on the card's picker). */
export const LIVE_SELECTED_MAX = 8;

/** The Ableton Live section. */
export function liveSection(live: MapPickerLive, locked: boolean): PickerSection {
  const items: PickerItem[] = [];
  if (!live.connected) items.push({ value: MAP_LIVE_CONNECT, label: 'Connect Ableton Live…', icon: 'link', description: `${live.status}. Install the Live connector, then pick it in Live’s settings`, keywords: 'ableton live connector install' });
  items.push({ value: MAP_LIVE_LEARN, label: 'Learn from Live', icon: 'spark', description: 'Click a parameter in Live: it’s mapped', keywords: 'ableton live map listen', pro: locked });
  for (const m of live.rack) items.push({ value: `${LIVE_KEY}${m.key}`, label: m.name, icon: 'sliders', description: `Playfield rack · ${m.track}`, keywords: `ableton macro rack ${m.key}`, pro: locked });
  if (live.selected) {
    for (const p of live.selected.params.slice(0, LIVE_SELECTED_MAX)) items.push({ value: `${LIVE_KEY}${p.key}`, label: p.name, icon: 'sliders', description: `Selected device · ${live.selected.device} on ${live.selected.track}`, keywords: `ableton device ${p.key}`, pro: locked });
  }
  items.push(
    { value: `${TYPE}ableton:param`, label: 'Any parameter…', icon: 'link', description: 'Pick any track, device and parameter on its card', keywords: 'ableton browse device knob', pro: locked },
    { value: `${TYPE}ableton:beat`, label: 'Live beat', icon: 'clock', description: '0 → 1 on each of Live’s beats', keywords: 'ableton tempo bpm', pro: locked },
    { value: `${TYPE}ableton:bar`, label: 'Live bar', icon: 'clock', description: '0 → 1 on each bar', keywords: 'ableton measure', pro: locked },
    { value: `${TYPE}ableton:playing`, label: 'Live playing', icon: 'play', description: '1 while Live plays', keywords: 'ableton transport', pro: locked },
    { value: MAP_LIVE_CLIP, label: 'Clip launches', icon: 'bolt', description: 'An envelope when a clip in Live launches', keywords: 'ableton clip trigger', pro: locked },
    { value: MAP_LIVE_SCENE, label: 'Scene launches', icon: 'bolt', description: 'An envelope when a scene in Live launches', keywords: 'ableton scene trigger section', pro: locked },
  );
  return { heading: `${LIVE_HEADING} · ${live.connected ? live.status : 'not connected'}`, items };
}

/** The MIDI file and the pad grid as picker items: add one, or open the one the setup has. */
export function fileKindItems(files: MapPickerFiles, locked: boolean): PickerItem[] {
  return [
    files.midiFile
      ? { value: MAP_MIDI_FILE, label: 'MIDI file', icon: 'wave', description: `“${files.midiFile}” is playing: open its card`, keywords: 'mid song sequence file' }
      : { value: MAP_MIDI_FILE, label: 'MIDI file…', icon: 'wave', description: 'A .mid plays in time, as if from a controller', keywords: 'mid song sequence file', pro: !!files.midiFileLocked },
    files.padGrid
      ? { value: MAP_PAD_GRID, label: 'Pad grid', icon: 'grid', description: 'Set up: open its card', keywords: 'push launchpad mpc pads cells' }
      : { value: MAP_PAD_GRID, label: 'Pad grid', icon: 'grid', description: 'Push, Launchpad or on-screen pads as grid cells', keywords: 'push launchpad mpc pads cells', pro: locked },
  ];
}

/**
 * The picker's sections. `locked` (Free) marks Pro on the kinds the plan lacks;
 * picking one opens the Pro sheet instead.
 */
export function mapPickerSections(readers: ReadonlyArray<{ id: string; name: string }>, locked: boolean, signals: ReadonlyArray<{ id: string; name: string }> = [], files: MapPickerFiles = {}, live?: MapPickerLive): PickerSection[] {
  const typed = sourcePickerSections(readers, locked, signals);
  const byValue = new Map<string, PickerItem>();
  for (const s of typed) for (const it of s.items) byValue.set(it.value, it);
  const used = new Set<string>();
  const typeItem = (value: string): PickerItem | null => {
    const it = byValue.get(value);
    if (!it) return null;
    used.add(value);
    return { ...it, ...RELABEL[value], value: `${TYPE}${value}` };
  };
  const types = (values: readonly string[]) => values.map(typeItem).filter((x): x is PickerItem => !!x);
  const audio = typed.find(s => s.heading === 'Live audio')?.items.map(it => it.value) ?? [];
  const hands = typed.find(s => s.heading === 'Hands')?.items.map(it => it.value) ?? [];

  const out: PickerSection[] = [
    { heading: 'Learn', items: [{ value: MAP_LEARN, label: 'Learn', icon: 'spark', description: 'Click a control, then move a knob, hit a note or press a key', keywords: 'midi map listen ableton' }] },
    { heading: 'MIDI', items: [
      ...types(KIND_TYPES.MIDI),
      { value: MAP_NOTES12, label: '12 notes → 12 targets…', icon: 'piano', description: 'C to B onto controls or layers, in order', keywords: 'note class octave', pro: locked },
      ...fileKindItems(files, locked),
    ] },
    { heading: 'Keys', items: types(KIND_TYPES.Keys) },
    { heading: 'Mouse', items: types(KIND_TYPES.Mouse) },
    { heading: 'Audio', items: types(audio) },
    { heading: 'Hands', items: types(hands) },
    { heading: 'LFO / Beat', items: types(KIND_TYPES['LFO / Beat']) },
    { heading: 'Random', items: [
      ...RANDOM_SOURCES.map((r, i): PickerItem => ({ value: `${RANDOM}${i}`, label: r.label, icon: 'dice', description: r.hint, keywords: 'noise random', pro: locked && sourceTypeNeedsPro('noise') })),
      ...types(['noise']),
    ] },
    { heading: 'Behaviours', items: [{ value: MAP_BEHAVIOURS, label: 'Behaviours…', icon: 'star', description: 'Ready-made: pulse to the beat, bass shakes it, pinch to burst…', keywords: 'preset ready made rule' }] },
  ];
  // Ableton Live: its own section (it takes the source types' Live entries).
  if (live) {
    out.push(liveSection(live, locked));
    for (const t of ['ableton:param', 'ableton:beat', 'ableton:bar', 'ableton:playing']) used.add(t);
  }
  // Everything else, under the source types' own headings (devices, the setup, face, pose).
  for (const s of typed) {
    const rest = s.items.filter(it => !used.has(it.value));
    if (rest.length) out.push({ heading: s.heading === 'Devices' ? 'More devices' : s.heading, items: rest.map(it => ({ ...it, value: `${TYPE}${it.value}` })) });
  }
  return out;
}
