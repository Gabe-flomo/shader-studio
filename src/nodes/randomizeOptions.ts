/**
 * randomizeOptions.ts — the options behind Randomize (the canvas dice and every node card's dice).
 * Kept per user in local storage. The pure functions in randomizeParams.ts take them as an argument.
 */
import { create } from 'zustand';

export interface RandomizeOptions {
  /** 0–1. 0: small nudges round the current value; 1: anywhere in the interesting range. */
  strength: number;
  /** Also change choice settings (menus, switches). Off: they stay as they are. */
  includeChoices: boolean;
  /** Also change colours. */
  colours: boolean;
  /** Change the values on a group's face. */
  groupFace: boolean;
  /** Go inside groups and randomize their nodes (recursively). */
  insideGroups: boolean;
  /** Weight each setting by how much it changes the picture (measured). */
  focus: boolean;
}

export const DEFAULT_RANDOMIZE_OPTIONS: RandomizeOptions = {
  strength: 0.5, includeChoices: false, colours: true, groupFace: false, insideGroups: false, focus: false,
};

const KEY = 'shader-studio:randomizeOptions';

export function sanitizeOptions(raw: unknown): RandomizeOptions {
  const d = DEFAULT_RANDOMIZE_OPTIONS;
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof RandomizeOptions): boolean => (typeof o[k] === 'boolean' ? o[k] as boolean : d[k] as boolean);
  const s = typeof o.strength === 'number' && Number.isFinite(o.strength) ? Math.min(1, Math.max(0, o.strength)) : d.strength;
  return { strength: s, includeChoices: bool('includeChoices'), colours: bool('colours'), groupFace: bool('groupFace'), insideGroups: bool('insideGroups'), focus: bool('focus') };
}

function load(): RandomizeOptions {
  try { const t = localStorage.getItem(KEY); return sanitizeOptions(t ? JSON.parse(t) : null); } catch { return { ...DEFAULT_RANDOMIZE_OPTIONS }; }
}

export const useRandomizeOptions = create<RandomizeOptions>(() => load());

export function setRandomizeOptions(patch: Partial<RandomizeOptions>): void {
  useRandomizeOptions.setState(patch);
  try { localStorage.setItem(KEY, JSON.stringify(sanitizeOptions(useRandomizeOptions.getState()))); } catch { /* private window */ }
}

export const getRandomizeOptions = (): RandomizeOptions => sanitizeOptions(useRandomizeOptions.getState());

/** One line for a tooltip: "strength 0.5 · 3 locked · groups off". */
export function optionsSummary(o: RandomizeOptions, locked: number): string {
  const groups = o.insideGroups ? 'groups inside' : o.groupFace ? 'group faces' : 'groups off';
  return [`strength ${+o.strength.toFixed(2)}`, `${locked} locked`, groups, ...(o.focus ? ['focus on'] : [])].join(' · ');
}

/** Progress of a Focus measurement, for the dice popover (the measuring code is loaded on demand). */
export const useRandomizeProgress = create<{ busy: boolean; done: number; total: number }>(() => ({ busy: false, done: 0, total: 0 }));
