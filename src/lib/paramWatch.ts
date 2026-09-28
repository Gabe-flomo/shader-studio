/**
 * paramWatch.ts — Configure's "touch to configure" (docs/arrangement.md):
 * while Configure is on for an Audio Unit, the desktop engine watches its
 * parameters (src-tauri/src/audio_engine/touch.rs) and sends each one the
 * person moves in the plug-in's own window as `audio-engine:param-touched`.
 * Configure adds it as a rack control (rackControls.ts, `touchRackControl`).
 *
 * Pure: the event's payload in, a checked touch out.
 */
import { parseParamList, type AuParam } from './audioEngineProtocol';

export const TOUCH_EVENT = 'audio-engine:param-touched';

/** With nothing touched this long (ms) after Configure opened, it says the plug-in may not report its window's moves. */
export const WATCH_QUIET_MS = 20000;

/** A parameter the person touched in a slot's window: its description, `value` the newest. */
export interface TouchedParam { rack: string; slot: string; param: AuParam; first: boolean }

export function parseTouched(raw: unknown): TouchedParam | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.rack !== 'string' || typeof o.slot !== 'string') return null;
  const [param] = parseParamList([o.param]);
  return param ? { rack: o.rack, slot: o.slot, param, first: o.first === true } : null;
}
