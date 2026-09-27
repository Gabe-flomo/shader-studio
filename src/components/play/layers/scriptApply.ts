/**
 * Applying a sketch to its layer: compile once for the params it declares,
 * store the code (the main file, sketch.js) and its other files, the defs,
 * and give each control a starting value.
 */
import { SCRIPT_MAIN_FILE, type ScriptFile, type ScriptLayer, type ScriptParamDef } from '../../../types/playLayers';
import { extractScriptParams } from './scriptExamples';

export interface ApplyOptions {
  /** Layer settings a starter expects; when given, every control resets to its declared value. */
  settings?: { clear: boolean; readPicture: boolean; mode?: '2d' | '3d' };
  /** Starting values by key (a variable turned into a control keeps its own value). */
  startAt?: Record<string, number>;
}

/** A layer's files as the editor shows them: sketch.js first, then its other tabs. */
export function layerFiles(l: Pick<ScriptLayer, 'code' | 'files'>): ScriptFile[] {
  return [{ name: SCRIPT_MAIN_FILE, code: l.code }, ...(l.files ?? []).map(f => ({ ...f }))];
}
/** Do two file lists hold the same names and code? */
export function sameFiles(a: readonly ScriptFile[], b: readonly ScriptFile[]): boolean {
  return a.length === b.length && a.every((f, i) => f.name === b[i].name && f.code === b[i].code);
}

/**
 * The patch to store, or the compile error. `code` is the main file, or the
 * whole list (sketch.js first, as layerFiles gives it).
 */
export function scriptPatch(l: ScriptLayer, code: string | readonly ScriptFile[], opts: ApplyOptions = {}): { ok: true; patch: Record<string, unknown>; defs: ScriptParamDef[] } | { ok: false; error: string } {
  const list = typeof code === 'string' ? null : code;
  const main = list ? list[0]?.code ?? '' : code as string;
  const files = list ? list.slice(1).map(f => ({ name: f.name, code: f.code })) : l.files ?? [];
  const r = extractScriptParams(main, files);
  if (!r.ok) return r;
  const patch: Record<string, unknown> = { code: main, paramDefs: r.defs, ...(opts.settings ?? {}) };
  if (list) patch.files = files.length ? files : undefined;
  const have = l as unknown as Record<string, unknown>;
  for (const d of r.defs) {
    if (opts.startAt && d.key in opts.startAt) patch[`p_${d.key}`] = opts.startAt[d.key];
    else if (opts.settings || typeof have[`p_${d.key}`] !== 'number') patch[`p_${d.key}`] = d.value;
  }
  return { ok: true, patch, defs: r.defs };
}
