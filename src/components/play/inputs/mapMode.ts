/**
 * mapMode — the Inputs board's Map mode: a source is picked (its card's Map
 * button), every control becomes a target, a click on one routes the source
 * there; Esc or Done ends it. UI state only.
 */
import { create } from 'zustand';

interface MapModeState {
  /** The source being mapped (a record source's or an old mapping's id), or null. */
  sourceId: string | null;
  label: string;
  start: (sourceId: string, label: string) => void;
  stop: () => void;
}

export const useMapMode = create<MapModeState>(set => ({
  sourceId: null,
  label: '',
  start: (sourceId, label) => set({ sourceId, label }),
  stop: () => set({ sourceId: null, label: '' }),
}));
