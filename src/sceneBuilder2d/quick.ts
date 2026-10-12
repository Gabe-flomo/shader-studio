/**
 * quick.ts — Quick controls in the 2D Scene Builder (docs/scene-builder-2d.md, "Quick controls"): builder sliders
 * pinned to a short list under the preview, each a mini slider that changes the value live and, once built, a Play
 * control on the node param the value builds (the same lookup the slider's right-click Play menu uses).
 *
 * A pin is kept on the scene (`scene.quick`), so it is saved with the build and comes back when the scene is edited
 * again. It names the value by where it lives in the scene (a path, with items, space blocks and stack cards picked
 * by id) and a straight-line map from the slider's number to the stored one (most are the same number; a few store
 * it scaled). The path and map are found when the pin is made, by running the slider's own change on a copy of the
 * scene (store.ts `probeEdit`) with two test numbers and seeing what moved.
 *
 * Pure: no React; the store is passed in.
 */
import type { Scene2D } from './spec';

/** One step into the scene: a key, an index, or the element of a list with this id. */
export type PathSeg = string | number | { id: string };

export interface QuickPin {
  /** Unique in the list (the path, written out). */
  id: string;
  label: string;
  path: PathSeg[];
  /** Stored = scale × slider + offset. */
  scale: number;
  offset: number;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  /** The built node param, by its role in the build and the param's possible names (the right-click Play lookup). */
  play?: { role: string; keys: string[] } | null;
}

export const pathId = (path: readonly PathSeg[]) => path.map(s => (typeof s === 'object' ? `#${s.id}` : String(s))).join('/');

function step(v: unknown, s: PathSeg): unknown {
  if (v == null) return undefined;
  if (typeof s === 'object') return Array.isArray(v) ? v.find(x => x && typeof x === 'object' && (x as { id?: unknown }).id === s.id) : undefined;
  return (v as Record<string | number, unknown>)[s];
}

/** The number at `path`, or null when it is gone (its item deleted). */
export function getAt(scene: unknown, path: readonly PathSeg[]): number | null {
  let v: unknown = scene;
  for (const s of path) { v = step(v, s); if (v === undefined) return null; }
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Writes `value` at `path` (in place, on a draft); false when the path is gone. */
export function setAt(scene: unknown, path: readonly PathSeg[], value: number): boolean {
  if (!path.length) return false;
  let v: unknown = scene;
  for (const s of path.slice(0, -1)) { v = step(v, s); if (v == null || typeof v !== 'object') return false; }
  const last = path[path.length - 1];
  if (typeof last === 'object' || typeof (v as Record<string, unknown>)[last as string] !== 'number') return false;
  (v as Record<string | number, unknown>)[last] = value;
  return true;
}

/** Every number that differs between `a` and `b`, with its path (list elements with an id picked by it). */
export function changedNumbers(a: unknown, b: unknown, at: PathSeg[] = [], out: Array<{ path: PathSeg[]; value: number }> = []): Array<{ path: PathSeg[]; value: number }> {
  if (typeof b === 'number') { if (a !== b) out.push({ path: at, value: b }); return out; }
  if (!b || typeof b !== 'object') return out;
  if (Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : [];
    b.forEach((x, i) => {
      const id = x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : null;
      const was = id ? aa.find(y => y && typeof y === 'object' && (y as { id?: unknown }).id === id) : aa[i];
      changedNumbers(was, x, [...at, id ? { id } : i], out);
    });
    return out;
  }
  for (const [k, x] of Object.entries(b)) changedNumbers(a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined, x, [...at, k], out);
  return out;
}

/**
 * Where a slider's change lands: `probe(v)` runs the slider's onChange with v on a copy of `scene` and returns the
 * copy (or null when nothing was edited). Two test numbers inside the range find the one number that follows the
 * slider and the straight line between them. Null when no single number does (a slider that writes several things,
 * or none).
 */
export function findTarget(scene: Scene2D, probe: (v: number) => Scene2D | null, range: { min: number; max: number; integer?: boolean }): { path: PathSeg[]; scale: number; offset: number } | null {
  const span = range.max - range.min || 1;
  let t = [range.min + span * 0.3137, range.min + span * 0.7071];
  if (range.integer) { t = t.map(Math.round); if (t[0] === t[1]) t[1] += 1; }
  const runs = t.map(v => probe(v));
  if (runs.some(r => !r)) return null;
  const [c0, c1] = runs.map(r => changedNumbers(scene, r));
  // The number that moved with the slider: changed in a run and different between the two.
  const byId = new Map<string, { path: PathSeg[]; v: [number | null, number | null] }>();
  for (const [k, list] of [c0, c1].entries()) for (const c of list) {
    const id = pathId(c.path);
    const e = byId.get(id) ?? { path: c.path, v: [null, null] as [number | null, number | null] };
    e.v[k] = c.value;
    byId.set(id, e);
  }
  const before = (p: PathSeg[]) => getAt(scene, p);
  const moving = [...byId.values()]
    .map(e => ({ path: e.path, a: e.v[0] ?? before(e.path), b: e.v[1] ?? before(e.path) }))
    .filter((e): e is { path: PathSeg[]; a: number; b: number } => e.a !== null && e.b !== null && e.a !== e.b);
  if (moving.length !== 1) return null;
  const { path, a, b } = moving[0];
  const scale = (b - a) / (t[1] - t[0]);
  const offset = a - scale * t[0];
  const tidy = (x: number) => Math.round(x * 1e9) / 1e9;
  return { path, scale: tidy(scale), offset: tidy(offset) };
}

/** The slider's number for a pin, read from the scene (null when its value is gone). */
export function pinValue(scene: Scene2D, pin: QuickPin): number | null {
  const v = getAt(scene, pin.path);
  if (v === null) return null;
  const x = (v - pin.offset) / (pin.scale || 1);
  return pin.integer ? Math.round(x) : Math.round(x * 1e9) / 1e9;
}

/** Sets a pin's value on a draft of the scene. */
export function setPinValue(draft: Scene2D, pin: QuickPin, x: number): boolean {
  return setAt(draft, pin.path, pin.scale * (pin.integer ? Math.round(x) : x) + pin.offset);
}

// ── The list ─────────────────────────────────────────────────────────────────

export function addPin(list: readonly QuickPin[] | undefined, pin: QuickPin): QuickPin[] {
  const l = list ?? [];
  return l.some(p => p.id === pin.id) ? [...l] : [...l, pin];
}
export const removePin = (list: readonly QuickPin[] | undefined, id: string): QuickPin[] => (list ?? []).filter(p => p.id !== id);
/** Moves a pin up (−1) or down (+1). */
export function movePin(list: readonly QuickPin[] | undefined, id: string, by: -1 | 1): QuickPin[] {
  const l = [...(list ?? [])];
  const i = l.findIndex(p => p.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= l.length) return l;
  [l[i], l[j]] = [l[j], l[i]];
  return l;
}
