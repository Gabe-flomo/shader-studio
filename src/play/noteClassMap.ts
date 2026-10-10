/**
 * noteClassMap.ts — "Map 12 notes → 12 targets" (docs/midi.md, Note classes):
 * the twelve pitch classes, C to B, each onto one control or layer in the
 * order they were picked, with octaves wrapped, so C in any octave hits the
 * first target, C# the second… A source of the record each: a trigger on the
 * note class (an envelope, harder hits peak higher) with one Set route. A
 * layer is driven through how solid it is (its opacity, or a shape's fill; a
 * control on it is made when the panel doesn't have one), resting faint and
 * lighting up on its note. Pure.
 */
import { kmClassName } from './kit/midi.js';
import { layerNumericProps, layerTarget, type PlayControl, type PlayRecord, type PlayRoute, type PlayLayer, type PlaySourceDef, type TriggerSpec } from '../types/play';

/** One pick: a control on the panel or a layer, by id. */
export type NoteTarget = { kind: 'control'; id: string } | { kind: 'layer'; id: string };

/** At most this many targets: one per pitch class. */
export const NOTE_CLASSES = 12;
/** What lights a layer, first found: its opacity, else a shape's fill. */
const LIGHT_KEYS = ['opacity', 'fillOpacity'] as const;

/** The number that lights a layer (layerNumericProps), or undefined when it has none. */
export function lightProp(layer: PlayLayer) {
  const props = layerNumericProps(layer);
  for (const k of LIGHT_KEYS) { const d = props.find(x => x.key === k); if (d) return d; }
  return undefined;
}

/** A layer rests at this opacity between its notes (still visible), and lights to full on its note. */
export const LAYER_REST = 0.15;

export interface NoteMapOptions {
  /** MIDI channel, 0 all. */
  channel?: number;
  /** The pitch class the first target gets (0 C … 11 B); the rest follow up the scale, wrapping. */
  first?: number;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_n${(++seq).toString(36)}`;

/** The pitch class (0..11) the i-th pick gets. */
export function classOf(i: number, first = 0): number {
  return (((first + i) % NOTE_CLASSES) + NOTE_CLASSES) % NOTE_CLASSES;
}

/**
 * Map the picks (at most twelve, in order) to the twelve note classes from
 * `first`. Returns the record with a source per pick (and any opacity
 * controls made for layers), the new sources' ids, and the picks skipped
 * (a missing control, a colour or a button, a layer with no opacity).
 */
export function mapNoteClasses(p: PlayRecord, picks: readonly NoteTarget[], opts: NoteMapOptions = {}): { play: PlayRecord; sourceIds: string[]; skipped: NoteTarget[] } {
  const channel = Math.max(0, Math.min(16, Math.round(opts.channel ?? 0)));
  const first = classOf(0, opts.first ?? 0);
  const controls = [...p.controls];
  const sources: PlaySourceDef[] = [...(p.sources ?? [])];
  const sourceIds: string[] = [];
  const skipped: NoteTarget[] = [];
  picks.slice(0, NOTE_CLASSES).forEach((pick, i) => {
    let control: PlayControl | undefined;
    let rest: number | undefined;
    if (pick.kind === 'control') {
      control = controls.find(c => c.id === pick.id);
      if (control && control.kind !== 'float') control = undefined;
    } else {
      const layer = p.layers.find(l => l.id === pick.id);
      const prop = layer && lightProp(layer);
      if (layer && prop) {
        const target = layerTarget(layer.id, prop.key);
        control = controls.find(c => c.target === target && c.kind === 'float');
        if (!control) {
          control = { id: nextId('ctl'), target, kind: 'float', label: `${layer.label} · ${prop.label}`, min: prop.min, max: prop.max };
          controls.push(control);
        }
        rest = LAYER_REST;
      }
    }
    if (!control) { skipped.push(pick); return; }
    const pc = classOf(i, first);
    const route: PlayRoute = { id: nextId('rt'), to: control.id, mode: 'replace', outMin: rest ?? control.min, outMax: control.max, curve: 'linear', enabled: true };
    const id = nextId('src');
    sources.push({
      id, enabled: true, label: `Note ${kmClassName(pc)} (any octave)`,
      // A short hit that holds while the key is down and fades after: the target lights on its note.
      source: { kind: 'trigger', trigger: { on: 'note', channel, note: pc, wrap: true }, mode: 'envelope', attack: 5, decay: 180, sustain: 0.6, release: 450, steps: 4, velocity: true },
      outputs: [{ kind: 'value', routes: [route] }],
    });
    sourceIds.push(id);
  });
  return { play: { ...p, controls, sources }, sourceIds, skipped };
}

/**
 * Wrap a note trigger's octaves or stop wrapping: wrapping keeps the note's
 * name (C4 becomes C); unwrapping puts the class in the middle octave (C becomes C4).
 */
export function withNoteWrap<T extends Extract<TriggerSpec, { on: 'note' }>>(t: T, on: boolean): T {
  if (on) return { ...t, wrap: true, note: t.note < 0 ? -1 : t.note % 12 };
  const { wrap: _w, ...rest } = t;
  void _w;
  return { ...rest, note: t.note < 0 ? -1 : 60 + (t.note % 12) } as T;
}
