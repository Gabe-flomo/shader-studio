/**
 * scriptStatus — the last error of each Script layer, reported by the layer
 * kit as it compiles and runs sketches, read by the layer's editor. Kept out
 * of the graph store on purpose: it changes every frame while a script is
 * broken and is never saved.
 */
import { useSyncExternalStore } from 'react';

const errors = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

export function setScriptStatus(layerId: string, error: string | null): void {
  const prev = errors.get(layerId) ?? null;
  if (prev === error) return;
  if (error) errors.set(layerId, error); else errors.delete(layerId);
  version++;
  for (const fn of listeners) fn();
}

export function useScriptStatus(layerId: string): string | null {
  return useSyncExternalStore(
    fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => errors.get(layerId) ?? null,
  );
}

/** For tests. */
export function scriptStatusVersion(): number { return version; }
