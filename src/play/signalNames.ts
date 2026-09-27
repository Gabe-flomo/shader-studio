/**
 * signalNames.ts — the current setup's signal names, for labels that are
 * built without the record at hand ("Env · Signal Hit" on a control's chip).
 * The Play engine keeps it up to date when its record changes, as the audio
 * reader bank does for readers' names.
 */
import type { PlaySignal } from '../types/play';

let names = new Map<string, string>();

export const signalNames = {
  set(signals: ReadonlyArray<PlaySignal> | undefined): void {
    names = new Map((signals ?? []).map(s => [s.id, s.name]));
  },
  get(id: string): string | undefined {
    return names.get(id);
  },
  list(): PlaySignal[] {
    return [...names].map(([id, name]) => ({ id, name }));
  },
};
