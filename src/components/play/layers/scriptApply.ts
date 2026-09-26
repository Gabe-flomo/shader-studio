/**
 * Applying a sketch to its layer: compile once for the params it declares,
 * store the code and the defs, and give each control a starting value.
 */
import type { ScriptLayer, ScriptParamDef } from '../../../types/playLayers';
import { extractScriptParams } from './scriptExamples';

export interface ApplyOptions {
  /** Layer settings a starter expects; when given, every control resets to its declared value. */
  settings?: { clear: boolean; readPicture: boolean };
  /** Starting values by key (a variable turned into a control keeps its own value). */
  startAt?: Record<string, number>;
}

/** The patch to store, or the compile error. */
export function scriptPatch(l: ScriptLayer, code: string, opts: ApplyOptions = {}): { ok: true; patch: Record<string, unknown>; defs: ScriptParamDef[] } | { ok: false; error: string } {
  const r = extractScriptParams(code);
  if (!r.ok) return r;
  const patch: Record<string, unknown> = { code, paramDefs: r.defs, ...(opts.settings ?? {}) };
  const have = l as unknown as Record<string, unknown>;
  for (const d of r.defs) {
    if (opts.startAt && d.key in opts.startAt) patch[`p_${d.key}`] = opts.startAt[d.key];
    else if (opts.settings || typeof have[`p_${d.key}`] !== 'number') patch[`p_${d.key}`] = d.value;
  }
  return { ok: true, patch, defs: r.defs };
}
