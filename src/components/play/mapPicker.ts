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
 * Room for later kinds: the MIDI file and the pad grid move in here as source
 * kinds in a later round (audit P10): add them to MAP_KIND_ENTRIES' MIDI entry
 * and handle their pick in PlayPage's MappingsDrawer.
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
const TYPE = 'type:';
const RANDOM = 'random:';

/** The kinds, in the order the picker shows them (audit P6), then the rest. */
export const MAP_KINDS = ['Learn', 'MIDI', 'Keys', 'Mouse', 'Audio', 'Hands', 'LFO / Beat', 'Random', 'Behaviours'] as const;

export type MapPick =
  | { kind: 'learn' }
  | { kind: 'behaviours' }
  | { kind: 'notes12' }
  | { kind: 'readers' }
  | { kind: 'random'; index: number }
  | { kind: 'signal'; id: string }
  | { kind: 'type'; type: SourceType };

export function parseMapPick(v: string): MapPick | null {
  if (v === MAP_LEARN) return { kind: 'learn' };
  if (v === MAP_BEHAVIOURS) return { kind: 'behaviours' };
  if (v === MAP_NOTES12) return { kind: 'notes12' };
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
  if (p.kind === 'learn' || p.kind === 'notes12') return true;
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

/**
 * The picker's sections. `locked` (Free) marks Pro on the kinds the plan lacks;
 * picking one opens the Pro sheet instead.
 */
export function mapPickerSections(readers: ReadonlyArray<{ id: string; name: string }>, locked: boolean, signals: ReadonlyArray<{ id: string; name: string }> = []): PickerSection[] {
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
      // Later (audit P10): the MIDI file and the pad grid as kinds here.
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
  // Everything else, under the source types' own headings (devices, the setup, face, pose).
  for (const s of typed) {
    const rest = s.items.filter(it => !used.has(it.value));
    if (rest.length) out.push({ heading: s.heading === 'Devices' ? 'More devices' : s.heading, items: rest.map(it => ({ ...it, value: `${TYPE}${it.value}` })) });
  }
  return out;
}
