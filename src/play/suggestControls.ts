/**
 * suggestControls.ts — turning Suggest controls' picks into Play controls, and the seam for the
 * local explanation model's friendlier names (docs/suggest-controls.md).
 */
import type { PlayRecord } from '../types/play';
import { playId } from './playControls';
import type { Suggestion } from '../nodes/controlFinder';

/** What a naming model is told about a setting. */
export interface ControlNameContext {
  nodeLabel: string;
  groupLabel?: string;
  paramLabel: string;
  /** The setting's one-line docstring from its node definition, when it has one. */
  paramHint?: string;
  min: number;
  max: number;
  value: number;
}

export interface ControlName {
  /** Short panel label, e.g. "Softness". */
  label: string;
  /** One line shown under it: "how far the glow spreads". */
  hint: string;
}

/** A naming model. Return null (or throw) to keep the deterministic label. */
export type ControlNamer = (context: ControlNameContext) => ControlName | null | Promise<ControlName | null>;

let namer: ControlNamer | null = null;

/**
 * Register (or clear with null) the function that names suggested controls.
 * TODO(claude/explain-model): the local explanation model registers itself here when it loads;
 * until then nothing does and the labels are "Node · Setting".
 */
export function setControlNamer(fn: ControlNamer | null): void { namer = fn; }
export const hasControlNamer = (): boolean => namer !== null;

export const nameContextOf = (s: Pick<Suggestion, 'nodeLabel' | 'groupLabel' | 'paramLabel' | 'hint' | 'min' | 'max' | 'value'>): ControlNameContext => ({
  nodeLabel: s.nodeLabel, groupLabel: s.groupLabel, paramLabel: s.paramLabel, paramHint: s.hint, min: s.min, max: s.max, value: s.value,
});

/** The namer's answer, or null without a namer, on failure, on an empty answer, or when it takes over 2 s. */
export async function nameControl(context: ControlNameContext): Promise<ControlName | null> {
  if (!namer) return null;
  try {
    const r = await Promise.race([Promise.resolve(namer(context)), new Promise<null>(res => setTimeout(() => res(null), 2000))]);
    const label = r?.label?.trim().slice(0, 60);
    return r && label ? { label, hint: (r.hint ?? '').trim().slice(0, 140) } : null;
  } catch { return null; }
}

/**
 * Add the picks as Play controls: the usable range as min/max (the value they start at is the
 * setting's own, so nothing jumps). Settings already on Play are skipped. `labels` overrides the
 * default "Node · Setting" per target.
 */
export function addSuggestedControls(p: PlayRecord, picks: readonly Suggestion[], labels: Readonly<Record<string, string>> = {}): PlayRecord {
  const have = new Set(p.controls.map(c => c.target));
  const add = picks.filter(s => !have.has(s.target)).map(s => ({
    id: playId('ctl'), target: s.target, kind: 'float' as const, label: labels[s.target]?.trim() || s.label,
    min: s.min, max: s.max, ...(s.step ? { step: s.step } : {}),
  }));
  return add.length ? { ...p, controls: [...p.controls, ...add] } : p;
}
