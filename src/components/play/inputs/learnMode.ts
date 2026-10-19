/**
 * learnMode — Learn on the Inputs board, Ableton style (Play audit P6): while
 * it's on, every control card wears a blue overlay; a click picks the control,
 * and the next knob, note, key, sound or hand move becomes a mapping onto it.
 * It stays on (pick another control, or move another knob to replace the one
 * just learned) until Esc or Stop. Map mode (mapMode.ts) and Learn don't run
 * together. UI state, plus the pure write (learnOnto).
 */
import { create } from 'zustand';
import type { PlayMapping, PlayRecord, PlaySource } from '../../../types/play';
import { useMapMode } from './mapMode';

interface LearnModeState {
  on: boolean;
  /** The control picked to learn onto, or null (waiting for a click). */
  controlId: string | null;
  /** The mapping this Learn made onto it: another input replaces its source rather than adding a row. */
  mappingId: string | null;
  /** Bumped on each input heard: Learn listens again after each one. */
  heard: number;
  start: (controlId?: string | null) => void;
  stop: () => void;
  pick: (controlId: string) => void;
  learned: (mappingId: string | null) => void;
}

export const useLearnMode = create<LearnModeState>(set => ({
  on: false,
  controlId: null,
  mappingId: null,
  heard: 0,
  start: (controlId = null) => { useMapMode.getState().stop(); set({ on: true, controlId, mappingId: null }); },
  stop: () => set({ on: false, controlId: null, mappingId: null }),
  pick: controlId => set(s => (s.controlId === controlId ? s : { controlId, mappingId: null })),
  learned: mappingId => set(s => ({ mappingId, heard: s.heard + 1 })),
}));

// Map mode starting ends Learn (and Learn starting ends Map mode, above).
useMapMode.subscribe(s => { if (s.sourceId && useLearnMode.getState().on) useLearnMode.getState().stop(); });

const sameSource = (a: PlaySource, b: PlaySource) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The record with a learned input on this control: the mapping this Learn
 * already made there gets the new source (a second knob replaces the first),
 * else a new mapping onto the control across its whole range. Unchanged (the
 * same `play`) when the control is gone or the source is the one it has.
 */
export function learnOnto(play: PlayRecord, controlId: string, mappingId: string | null, source: PlaySource, newId: string): { play: PlayRecord; mappingId: string | null } {
  const control = play.controls.find(c => c.id === controlId);
  if (!control) return { play, mappingId: null };
  const was = mappingId ? play.mappings.find(m => m.id === mappingId && m.controlId === controlId) : undefined;
  if (was) {
    if (sameSource(was.source, source)) return { play, mappingId: was.id };
    return { play: { ...play, mappings: play.mappings.map(m => (m.id === was.id ? { ...m, source, enabled: true } : m)) }, mappingId: was.id };
  }
  const m: PlayMapping = { id: newId, controlId, source, outMin: control.min, outMax: control.max, curve: 'linear', smoothMs: 30, enabled: true };
  return { play: { ...play, mappings: [...play.mappings, m] }, mappingId: newId };
}
