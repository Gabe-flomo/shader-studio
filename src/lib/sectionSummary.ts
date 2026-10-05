/**
 * sectionSummary.ts — what a folded param section on a node card says about itself
 * (ParamDef.section; NodeComponent's section headers).
 *
 * It counts only the controls you would actually see on opening the section (showWhen
 * respected, the second half of a pair row folded into its owner), and how many of those
 * differ from the node's defaults. A feature section — one led by an on/off switch (a bool,
 * or a select with an 'off' choice) that hides the rest of the section while off — reads
 * "Off", or "On · N controls" once switched on.
 *
 *   "4 controls"   "4 controls · 1 changed"   "Off"   "On · 12 controls · 2 changed"
 */
import type { ParamDef } from '../types/nodeGraph';
import { isParamVisible } from '../compiler/uniformPatcher';

export interface SectionSummary {
  /** Controls visible when the section is open (a pair row counts once). */
  controls: number;
  /** Visible controls whose value differs from the default (the feature switch itself excluded). */
  changed: number;
  /** For a feature section, whether its switch is on; undefined for an ordinary section. */
  on?: boolean;
  /** The one-line text shown on the folded header. */
  text: string;
}

/** A param's value as the card reads it: a setting an older save never had is its default. */
const valueOf = (key: string, params: Record<string, unknown>, defaults?: Record<string, unknown>) =>
  params[key] ?? defaults?.[key];

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The switch that turns a feature section on: the section's first param, when it is a bool or a
 * select with an 'off' option and every other param in the section is shown only by it.
 */
export function sectionSwitchKey(keys: string[], paramDefs: Record<string, ParamDef>): string | undefined {
  const [first, ...rest] = keys;
  const pd = first ? paramDefs[first] : undefined;
  if (!pd || rest.length === 0) return undefined;
  const isSwitch = pd.type === 'bool' || (pd.type === 'select' && !!pd.options?.some(o => o.value === 'off'));
  if (!isSwitch) return undefined;
  return rest.every(k => paramDefs[k]?.showWhen?.param === first) ? first : undefined;
}

/** Whether a feature switch reads as on. */
function switchOn(pd: ParamDef, value: unknown): boolean {
  if (pd.type === 'bool') return value === true || value === 'true';
  return value != null && String(value) !== 'off';
}

export function summarizeSection(
  keys: string[],
  paramDefs: Record<string, ParamDef>,
  params: Record<string, unknown>,
  defaults?: Record<string, unknown>,
): SectionSummary {
  const pairSecondary = new Set(keys.map(k => paramDefs[k]?.pair?.with).filter((v): v is string => !!v));
  const visible = keys.filter(k => {
    const pd = paramDefs[k];
    return pd && !pairSecondary.has(k) && isParamVisible(pd, params, defaults);
  });
  const switchKey = sectionSwitchKey(keys, paramDefs);
  // A pair row is changed when either half is.
  const isChanged = (k: string) => {
    const other = paramDefs[k]?.pair?.with;
    return !sameValue(valueOf(k, params, defaults), defaults?.[k])
      || (!!other && !sameValue(valueOf(other, params, defaults), defaults?.[other]));
  };
  const changed = visible.filter(k => k !== switchKey && isChanged(k)).length;
  const controls = visible.length;
  const changedText = changed ? ` · ${changed} changed` : '';
  if (switchKey) {
    const on = switchOn(paramDefs[switchKey], valueOf(switchKey, params, defaults));
    return { controls, changed, on, text: on ? `On · ${plural(controls, 'control')}${changedText}` : `Off${changedText}` };
  }
  return { controls, changed, text: `${plural(controls, 'control')}${changedText}` };
}

/**
 * The params to write when a bool switch is turned on: the switch itself, plus its `whenOn`
 * starting values for any control still at its default (a value you chose is left alone).
 */
export function switchOnPatch(
  key: string,
  pd: ParamDef,
  params: Record<string, unknown>,
  defaults?: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { [key]: true };
  for (const [k, v] of Object.entries(pd.whenOn ?? {})) {
    if (sameValue(valueOf(k, params, defaults), defaults?.[k])) patch[k] = v;
  }
  return patch;
}
