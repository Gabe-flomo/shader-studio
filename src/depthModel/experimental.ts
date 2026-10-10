/**
 * experimental.ts — the "Experimental depth models" setting (docs/depth-node.md "Experimental models").
 *
 * Off (the default): the Depth node runs Depth Anything V2 Small and shows no model picker; a saved graph that
 * picked an experimental model plays with Small. On: the node's Model section gets a picker of every model in
 * config.ts and Compare comes back. One setting for the whole app (this browser), switched on the Depth card's
 * folded Model section or in App settings.
 */
import { create } from 'zustand';
import { DEPTH_MODELS, depthModelById, type DepthModelSpec } from './config';

/** localStorage key (App settings lists and resets it). */
export const DEPTH_EXPERIMENTAL_KEY = 'shader-studio:settings:depthExperimental';

function read(): boolean {
  try { return localStorage.getItem(DEPTH_EXPERIMENTAL_KEY) === '1'; } catch { return false; }
}

export const useDepthExperimental = create<{ on: boolean }>(() => ({ on: read() }));

export const depthExperimentalOn = (): boolean => useDepthExperimental.getState().on;

export function setDepthExperimental(on: boolean): void {
  try { if (on) localStorage.setItem(DEPTH_EXPERIMENTAL_KEY, '1'); else localStorage.removeItem(DEPTH_EXPERIMENTAL_KEY); } catch { /* private window: this session only */ }
  useDepthExperimental.setState({ on });
}

/** The model a Depth node runs now: its pick, or the default when that pick is experimental and the setting is off. */
export const effectiveDepthModel = (picked: unknown): DepthModelSpec => depthModelById(picked, depthExperimentalOn());

/** The Model picker's options: none (no picker) unless experimental models are on. */
export function depthModelOptions(on = depthExperimentalOn()): Array<{ value: string; label: string }> {
  if (!on) return [];
  return DEPTH_MODELS.map(m => ({ value: m.id, label: `${m.name}${m.experimental ? ' (experimental)' : ''}${m.commercial ? '' : ', testing only'}` }));
}
