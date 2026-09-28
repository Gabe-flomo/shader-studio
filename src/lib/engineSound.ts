/**
 * engineSound.ts — where the audio readers find an Audio engine rack's sound
 * (`engine:<rackId>`). The engine host (lib/audioEngineHost.ts) registers
 * itself here, so the readers need not load it.
 */
import type { EngineSpectrum } from './audioEngineProtocol';

export interface EngineSoundHost {
  /** The rack's latest spectrum, or null while it's silent, stale or missing. */
  spectrum(rackId: string): EngineSpectrum | null;
  /** Is there such a rack running now? */
  has(rackId: string): boolean;
}

let host: EngineSoundHost | null = null;

/** The audio readers' input for an engine rack. */
export const engineReaderInput = (rackId: string) => `engine:${rackId}`;
export function engineRackOfInput(input: string): string | null {
  return input.startsWith('engine:') && input.length > 7 ? input.slice(7) : null;
}

export const engineSound = {
  setHost(h: EngineSoundHost | null): void { host = h; },
  spectrum: (rackId: string): EngineSpectrum | null => host?.spectrum(rackId) ?? null,
  has: (rackId: string): boolean => host?.has(rackId) ?? false,
};
