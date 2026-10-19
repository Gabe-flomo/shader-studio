/**
 * selectOptions.ts — the choices a select param's card shows: its offered `options`, plus the one it
 * is set to when that is a retired choice (`retiredOptions`), labelled "… (retired)" so a saved graph
 * still reads what it draws. Retired choices are never offered otherwise.
 */
import type { ParamDef } from '../types/nodeGraph';

export interface ShownOption { value: string; label: string; hint?: string }

/** A retired choice of this select, or undefined. */
export function retiredOption(pd: Pick<ParamDef, 'retiredOptions'> | undefined, value: unknown): ShownOption | undefined {
  return pd?.retiredOptions?.find(o => o.value === String(value));
}

/** The label a select's value reads as: its option's, "… (retired)" for a retired one, else the raw value. */
export function optionLabel(pd: Pick<ParamDef, 'options' | 'retiredOptions'> | undefined, value: unknown): string {
  const v = String(value);
  const o = pd?.options?.find(x => x.value === v);
  if (o) return o.label;
  const r = retiredOption(pd, v);
  return r ? `${r.label} (retired)` : v;
}

/** The options a card lists for a select set to `value`: the offered ones, and the retired one it holds (last). */
export function optionsShown(pd: Pick<ParamDef, 'retiredOptions'> | undefined, options: readonly ShownOption[], value: unknown): ShownOption[] {
  const r = retiredOption(pd, value);
  if (!r || options.some(o => o.value === r.value)) return [...options];
  return [...options, { ...r, label: `${r.label} (retired)` }];
}
