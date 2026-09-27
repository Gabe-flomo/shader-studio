/**
 * finishLibrary.ts — the Finish stack's own library on this device, beside
 * the saved looks (savedLooks.ts):
 *
 *   Stack presets   a whole stack (its effects, their order and every
 *                   setting, curves and looks included), loaded as Replace
 *                   stack or Add to stack
 *   Your effects    custom effects (effect code), listed under
 *                   "+ Add effect → Your effects"
 *
 * Both are lists in localStorage (like the palette presets), so they travel
 * in library ZIPs, `.playfile` library items, profile ZIPs and the workspace
 * folder, and show on the Files page (Presets). Pure functions over a KV so
 * the tests and the importers can use them without a browser.
 */
import { safeSetItem, type FileResult } from '../utils/fileIO';
import {
  FINISH_CUSTOM_MAX_CODE, finishEffectId, finishHostLabel, isSealedBlob, parseFinish, type FinishEffect, type PlayFinish,
} from '../types/playFinish';
import type { SealedBlob } from '../types/userNode';

export const FINISH_PRESETS_KEY = 'shader-studio:finish-presets';
export const FINISH_EFFECTS_KEY = 'shader-studio:finish-effects';
/** Fired on window when either list changes, so every open panel refreshes. */
export const FINISH_LIBRARY_CHANGED = 'finish-library-changed';

export interface StackPreset {
  id: string;
  name: string;
  savedAt: number;
  /** The stack as saved (effects in order, every setting). Loading gives the effects new ids. */
  finish: PlayFinish;
}

export interface SavedEffect {
  id: string;
  name: string;
  savedAt: number;
  /** Its GLSL ('' when sealed). */
  code: string;
  /** From a sealed node pack: the code, encrypted (see types/playFinish.ts finishCustomCode). */
  sealed?: SealedBlob;
  description?: string;
  /** The node pack it came with. */
  pack?: string;
}

/** Where the lists are kept: localStorage in the app, a map in tests. */
export interface ListKV { get(key: string): string | null; set(key: string, value: string): FileResult | void }
const localList: ListKV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => safeSetItem(k, v, k === FINISH_PRESETS_KEY ? 'stack presets' : 'custom effects'),
};

const newId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`;
const readList = (kv: ListKV, key: string): unknown[] => { try { const a = JSON.parse(kv.get(key) ?? '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
function writeList(kv: ListKV, key: string, list: unknown[]): FileResult {
  const r = kv.set(key, JSON.stringify(list)) ?? { ok: true as const };
  if (r.ok && typeof window !== 'undefined' && kv === localList) window.dispatchEvent(new Event(FINISH_LIBRARY_CHANGED));
  return r;
}

// ── Stack presets ───────────────────────────────────────────────────────────

/** A preset from storage or a file: checked like a record's stack (parseFinish); null when it holds nothing. */
export function parseStackPreset(raw: unknown): StackPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const finish = parseFinish(r.finish);
  if (!finish || !finish.effects.length || typeof r.id !== 'string' || !r.id) return null;
  const { compare: _c, ...rest } = finish;
  void _c;
  return { id: r.id.slice(0, 80), name: (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Stack preset').slice(0, 60), savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0, finish: { ...rest, on: true } };
}

export function loadStackPresets(kv: ListKV = localList): StackPreset[] {
  return readList(kv, FINISH_PRESETS_KEY).flatMap(x => { const p = parseStackPreset(x); return p ? [p] : []; });
}

/** Save the stack as a preset (its effects and settings; the wipe stays with the Play). One with the same name is replaced. */
export function saveStackPreset(name: string, finish: PlayFinish, kv: ListKV = localList): { result: FileResult; preset: StackPreset | null } {
  const preset = parseStackPreset({ id: newId('stack'), name, savedAt: Date.now(), finish: { on: true, effects: finish.effects } });
  if (!preset) return { result: { ok: false, error: 'The stack has no effects to save.' }, preset: null };
  const list = loadStackPresets(kv).filter(p => p.name !== preset.name);
  return { result: writeList(kv, FINISH_PRESETS_KEY, [...list, preset]), preset };
}

export function renameStackPreset(id: string, name: string, kv: ListKV = localList): FileResult {
  const n = name.trim().slice(0, 60);
  if (!n) return { ok: false, error: 'A preset needs a name.' };
  return writeList(kv, FINISH_PRESETS_KEY, loadStackPresets(kv).map(p => (p.id === id ? { ...p, name: n } : p)));
}

export function deleteStackPreset(id: string, kv: ListKV = localList): FileResult {
  return writeList(kv, FINISH_PRESETS_KEY, loadStackPresets(kv).filter(p => p.id !== id));
}

/**
 * The stack after loading a preset. Replace: the preset's effects, and
 * nothing else. Add: the preset's effects after the stack's own, except a
 * built-in kind the stack already has (one of each), which is skipped and
 * named in `skipped`. Loaded effects get new ids, so they never collide with
 * the stack's (or its controls').
 */
export function applyStackPreset(current: PlayFinish | undefined, preset: StackPreset, mode: 'replace' | 'add'): { finish: PlayFinish; skipped: string[] } {
  const fresh = preset.finish.effects.map(e => ({ ...structuredCloneSafe(e), id: finishEffectId(e.kind) }) as FinishEffect);
  if (mode === 'replace' || !current) return { finish: { ...(current ?? {}), on: true, effects: fresh }, skipped: [] };
  const have = new Set(current.effects.filter(e => e.kind !== 'custom').map(e => e.kind));
  const skipped: string[] = [];
  const add = fresh.filter(e => { if (e.kind !== 'custom' && have.has(e.kind)) { skipped.push(finishHostLabel(e)); return false; } return true; });
  return { finish: { ...current, on: true, effects: [...current.effects, ...add] }, skipped };
}

function structuredCloneSafe<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }

// ── Your effects ────────────────────────────────────────────────────────────

export function parseSavedEffect(raw: unknown): SavedEffect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sealed = isSealedBlob(r.sealed) ? r.sealed : undefined;
  const code = typeof r.code === 'string' ? r.code.slice(0, FINISH_CUSTOM_MAX_CODE) : '';
  if (typeof r.id !== 'string' || !r.id || (!sealed && !code.trim())) return null;
  return {
    id: r.id.slice(0, 80), name: (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Custom effect').slice(0, 60),
    savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0, code: sealed ? '' : code,
    ...(sealed ? { sealed } : {}),
    ...(typeof r.description === 'string' && r.description.trim() ? { description: r.description.trim().slice(0, 200) } : {}),
    ...(typeof r.pack === 'string' && r.pack ? { pack: r.pack.slice(0, 80) } : {}),
  };
}

export function loadSavedEffects(kv: ListKV = localList): SavedEffect[] {
  return readList(kv, FINISH_EFFECTS_KEY).flatMap(x => { const e = parseSavedEffect(x); return e ? [e] : []; });
}

/**
 * Save an effect's code to Your effects. With `id`, that effect is updated
 * (a sealed one is never overwritten with code); otherwise one with the same
 * name is replaced, or a new one made.
 */
export function saveEffect(e: { name: string; code: string; description?: string; id?: string }, kv: ListKV = localList): { result: FileResult; saved: SavedEffect | null } {
  const list = loadSavedEffects(kv);
  const same = e.id ? list.find(x => x.id === e.id) : list.find(x => x.name === e.name.trim() && !x.sealed);
  if (same?.sealed) return { result: { ok: false, error: 'A sealed effect can’t be changed.' }, saved: null };
  const saved = parseSavedEffect({ id: same?.id ?? newId('fx'), name: e.name, code: e.code, description: e.description ?? same?.description, savedAt: Date.now() });
  if (!saved) return { result: { ok: false, error: 'The effect has no code.' }, saved: null };
  const next = same ? list.map(x => (x.id === same.id ? saved : x)) : [...list, saved];
  return { result: writeList(kv, FINISH_EFFECTS_KEY, next), saved };
}

/** Add effects that arrived with a node pack: one with the same id is updated, others added. */
export function installEffects(effects: readonly SavedEffect[], kv: ListKV = localList): FileResult {
  const list = loadSavedEffects(kv);
  const byId = new Map(list.map(x => [x.id, x]));
  for (const e of effects) byId.set(e.id, e);
  return writeList(kv, FINISH_EFFECTS_KEY, [...byId.values()]);
}

export function renameEffect(id: string, name: string, kv: ListKV = localList): FileResult {
  const n = name.trim().slice(0, 60);
  if (!n) return { ok: false, error: 'An effect needs a name.' };
  return writeList(kv, FINISH_EFFECTS_KEY, loadSavedEffects(kv).map(x => (x.id === id ? { ...x, name: n } : x)));
}

export function deleteEffect(id: string, kv: ListKV = localList): FileResult {
  return writeList(kv, FINISH_EFFECTS_KEY, loadSavedEffects(kv).filter(x => x.id !== id));
}

/** A starting point for new effect code: posterize, with a `levels` slider. */
export const EFFECT_TEMPLATE = `// A Finish effect: runs on every pixel of the finished picture.
// uv: the point on the picture (0..1). color: the colour so far.
// picture(uv) reads the picture as it came in; px is one pixel; time is the clock.
uniform float levels; // 2..16 = 5 Levels
uniform float amount; // 0..1 = 1 Amount

vec3 effect(vec2 uv, vec3 color) {
  vec3 steps = floor(color * levels + 0.5) / levels;
  return mix(color, steps, amount);
}
`;
