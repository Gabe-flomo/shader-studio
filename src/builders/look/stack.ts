/**
 * stack.ts — the scene builders' ordered stacks of cards (docs/builder-look.md): the Look's colour
 * GRADE (Levels, Saturation, Lift / Gamma / Gain…) and the Effects page (Displace, Pixelate, CRT
 * mask, Chromatic aberration…). Both are lists of items, each a kind and its settings, built as real
 * nodes after the scene in the order shown (grade.ts and effects.ts say which nodes).
 *
 * The settings are the builder's own (`LookParam`), with friendly names for the recipe; each says
 * which node param it sets, so right-click on its slider offers that param's Play menu.
 */
import type { Vec3 } from './palette';

export type StackValue = number | string | Vec3;

export interface StackItem {
  id: string;
  kind: string;
  /** Off: kept in the stack, not built. */
  on: boolean;
  params: Record<string, StackValue>;
  /** A picture the item reads (Displace by a picture): a name in the scene's textures. */
  tex?: string | null;
}

export interface LookParam {
  key: string;
  label: string;
  hint: string;
  type: 'num' | 'colour' | 'select' | 'rgb';
  def: StackValue;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  /** Degrees in the builder; the node takes radians. */
  deg?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** Other words the recipe takes for it. */
  aliases?: string[];
  /** The bare value in a recipe (`grade saturation 1.3`). */
  primary?: boolean;
  /** Shown only while another setting has one of these values. */
  showWhen?: { key: string; is: string[] };
  /** The node it sets: the item's role plus this suffix ('' the item's main node) and the node param key. */
  node?: string;
  param?: string;
}

export interface StackKindDef {
  kind: string;
  label: string;
  /** One line for the card and the recipe help. */
  blurb: string;
  /** The recipe word (first) and other words for it. */
  words: string[];
  params: LookParam[];
  /** The node types it builds (for the docs and the help). */
  nodes: string[];
  /** Reads a picture (the shared texture picker). */
  picture?: { showWhen?: { key: string; is: string[] } };
  /**
   * Retired: no longer offered (no Add button), but a scene that has it keeps it and builds it as
   * before; its card offers to swap it for `by` (a kind in the same stack) with these settings.
   */
  retired?: { by: string; label: string; params: (it: StackItem) => Record<string, StackValue> };
}

/** The kinds a stack offers: every one but the retired. */
export function stackOffered(defs: readonly StackKindDef[]): StackKindDef[] {
  return defs.filter(d => !d.retired);
}

/** A retired item swapped for its replacement (same id, place and on/off), or null when it isn't retired. */
export function stackUpgrade(it: StackItem, byKind: Readonly<Record<string, StackKindDef>>): StackItem | null {
  const r = byKind[it.kind]?.retired;
  const to = r ? byKind[r.by] : undefined;
  if (!r || !to) return null;
  return { ...newStackItem(to, it.id, r.params(it)), on: it.on };
}

/** A new item's settings: every param's default. */
export function stackDefaults(def: StackKindDef): Record<string, StackValue> {
  return Object.fromEntries(def.params.map(p => [p.key, Array.isArray(p.def) ? [...p.def] as Vec3 : p.def]));
}

/** The next free id in a stack (`g1`, `g2`… or `f1`…). */
export function nextStackId(items: readonly StackItem[] | undefined, prefix: string): string {
  let n = 0;
  for (const it of items ?? []) { const m = new RegExp(`^${prefix}(\\d+)$`).exec(it.id); if (m) n = Math.max(n, +m[1]); }
  return `${prefix}${n + 1}`;
}

export function newStackItem(def: StackKindDef, id: string, params: Record<string, StackValue> = {}): StackItem {
  return { id, kind: def.kind, on: true, params: { ...stackDefaults(def), ...params } };
}

/** A setting's value, its default when unset or of the wrong kind. */
export function stackValue(it: StackItem, p: LookParam): StackValue {
  const v = it.params[p.key];
  if (p.type === 'num') return typeof v === 'number' && isFinite(v) ? v : p.def;
  if (p.type === 'select') return typeof v === 'string' && (p.options ?? []).some(o => o.value === v) ? v : p.def;
  return Array.isArray(v) && v.length === 3 ? v : p.def;
}

export const numOf = (it: StackItem, p: LookParam): number => stackValue(it, p) as number;

/** Is a setting shown (its showWhen holds)? */
export function paramShown(it: StackItem, p: LookParam, def: StackKindDef): boolean {
  if (!p.showWhen) return true;
  const other = def.params.find(q => q.key === p.showWhen!.key);
  return !!other && p.showWhen.is.includes(String(stackValue(it, other)));
}

/** Move an item `by` places (±1 for the arrows). */
export function moveStackItem(items: StackItem[], id: string, by: number): StackItem[] {
  const i = items.findIndex(x => x.id === id);
  const j = Math.max(0, Math.min(items.length - 1, i + by));
  if (i < 0 || i === j) return items;
  const out = [...items];
  const [x] = out.splice(i, 1);
  out.splice(j, 0, x);
  return out;
}

/** Put an item before another (null: at the end): drag and drop. */
export function placeStackItem(items: StackItem[], id: string, beforeId: string | null): StackItem[] {
  if (id === beforeId) return items;
  const x = items.find(i => i.id === id);
  if (!x) return items;
  const rest = items.filter(i => i.id !== id);
  const at = beforeId ? rest.findIndex(i => i.id === beforeId) : -1;
  if (at < 0) rest.push(x); else rest.splice(at, 0, x);
  return rest;
}

const r = (n: number) => Math.round(n * 1000) / 1000;

/** The card's one-line summary: the settings that differ from the defaults (or the primary one). */
export function stackSummary(it: StackItem, def: StackKindDef): string {
  const parts: string[] = [];
  for (const p of def.params) {
    if (!paramShown(it, p, def)) continue;
    const v = stackValue(it, p);
    if (p.type === 'num' && (p.primary || v !== p.def)) parts.push(`${p.label.toLowerCase()} ${r(v as number)}${p.deg ? '°' : ''}`);
    else if (p.type === 'select' && (p.primary || v !== p.def)) parts.push(p.options?.find(o => o.value === v)?.label.toLowerCase() ?? String(v));
  }
  if (def.picture && it.tex && (!def.picture.showWhen || def.picture.showWhen.is.includes(String(it.params[def.picture.showWhen.key])))) parts.push(`by ${it.tex}`);
  return (it.on ? '' : 'off · ') + (parts.slice(0, 3).join(' · ') || def.blurb);
}

/** Copy a stack (specs are cloned when edited). */
export const cloneStack = (items: readonly StackItem[] | undefined): StackItem[] => (items ?? []).map(i => ({ ...i, params: { ...i.params } }));

/** A stack read from a saved spec: unknown kinds dropped, settings kept as they are. */
export function sanitiseStack(raw: unknown, defs: Record<string, StackKindDef>): StackItem[] {
  if (!Array.isArray(raw)) return [];
  const out: StackItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const it = x as Partial<StackItem>;
    if (typeof it.kind !== 'string' || !defs[it.kind] || typeof it.id !== 'string') continue;
    out.push({ id: it.id, kind: it.kind, on: it.on !== false, params: { ...stackDefaults(defs[it.kind]), ...(it.params ?? {}) }, ...(it.tex ? { tex: it.tex } : {}) });
  }
  return out;
}
