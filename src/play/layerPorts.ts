/**
 * layerPorts.ts — a layer's contract (the simplification plan's "a layer is
 * a contract"), in one description instead of four tables:
 *
 *   props     its numbers (LAYER_NUMERIC_PROPS): each is an input (a mapping
 *             can drive it) and an output (a signal can watch it)
 *   buttons   what can press it (ACTIONS_FOR, a script's own buttons)
 *   readings  what it measures (SENSOR_READS_FOR): hover, fill, speed…
 *   events    signals it can send (particles' Born, a relationship's Catch…),
 *             with the field that names the signal
 *   position  whether it has a centre on the picture (an anchor)
 *
 * Derived from the tables, so nothing new is stored. The pickers, the Signals
 * page and each layer's "Accepts and emits" view read it.
 */
import { ANCHOR_KINDS, actionsForLayer, layerNumericProps, sensorReadsFor, type ActionKind, type PlayLayer, type SensorRead } from '../types/play';
import type { LayerNumericProp } from '../types/playLayers';

export interface LayerEvent {
  /** Short name ("born", "catch"). */
  key: string;
  /** The layer field holding the signal it sends ('' = none). */
  field: string;
  label: string;
  hint: string;
}

export interface LayerPorts {
  props: ReadonlyArray<LayerNumericProp>;
  buttons: ActionKind[];
  readings: SensorRead[];
  events: LayerEvent[];
  position: boolean;
}

const EVENTS: Record<string, LayerEvent> = {
  born: { key: 'born', field: 'bornSignal', label: 'Born', hint: 'Some were born this step (a burst, a respawn, a bud): once a step, however many.' },
  died: { key: 'died', field: 'diedSignal', label: 'Died', hint: 'Some died this step (age, a boundary, an annihilation, a cull, a catch).' },
  split: { key: 'split', field: 'splitSignal', label: 'Split', hint: 'Multiply: a bud split off.' },
  full: { key: 'full', field: 'fullSignal', label: 'Full', hint: 'Multiply: the layer reached its count.' },
  annihilate: { key: 'annihilate', field: 'annihilateSignal', label: 'Annihilate', hint: 'Multiply: two groups met and vanished.' },
  cleared: { key: 'cleared', field: 'clearedSignal', label: 'Cleared', hint: 'Multiply: none left.' },
  catch: { key: 'catch', field: 'catchSignal', label: 'Catch', hint: 'A chaser caught its prey.' },
};

/** The signals a layer can send, by kind (what lib/playEngine.ts's tick…Signals watch). */
export function layerEvents(l: PlayLayer): LayerEvent[] {
  if (l.kind === 'particles') return l.emit === 'multiply'
    ? [EVENTS.born, EVENTS.died, EVENTS.split, EVENTS.full, EVENTS.annihilate, EVENTS.cleared]
    : [EVENTS.born, EVENTS.died];
  if (l.kind === 'agents') return [EVENTS.born, EVENTS.died];
  if (l.kind === 'relationship') return [EVENTS.catch];
  return [];
}

export function layerPorts(l: PlayLayer): LayerPorts {
  return {
    props: layerNumericProps(l),
    buttons: actionsForLayer(l),
    // Distance needs a second thing to measure to: conditions reach it as a distance (dist:A|B), not a reading.
    readings: sensorReadsFor(l as { kind: string; shape?: string }).filter(r => r !== 'distance'),
    events: layerEvents(l),
    position: ANCHOR_KINDS.includes(l.kind),
  };
}

/** Readings that count things (not 0..1): a percent condition on one uses the range seen so far. */
const COUNT_READS: ReadonlySet<SensorRead> = new Set(['born', 'died']);

/** The range a reading moves in: 0..1 for most, none for the counts. */
export function readingRange(read: SensorRead): readonly [number, number] | null {
  return COUNT_READS.has(read) ? null : [0, 1];
}

/** The signal a layer sends for an event ('' when none is picked). */
export function eventSignal(l: PlayLayer, e: LayerEvent): string {
  const v = (l as unknown as Record<string, unknown>)[e.field];
  return typeof v === 'string' ? v : '';
}
