/**
 * edit.ts — changes to a spec's tree, for the builder's form: add, remove,
 * duplicate, move and nest items, and stack warps. Each mutates the draft it
 * is given (the store hands it a copy) and keeps ids unique.
 */
import {
  findItem, newGroup, newShape, newWarp, nextId, walkItems,
  type GroupSpec, type SceneItem, type SceneSpec, type ShapeSpec,
} from './spec';

/** Where a new item goes: into the selected group, or beside the selected shape, else at the root. */
function parentFor(spec: SceneSpec, selectedId: string | null): { group: GroupSpec; index: number } {
  const hit = selectedId ? findItem(spec, selectedId) : null;
  if (hit?.item.type === 'group') return { group: hit.item, index: hit.item.children.length };
  if (hit?.parent) return { group: hit.parent, index: hit.parent.children.indexOf(hit.item) + 1 };
  return { group: spec.root, index: spec.root.children.length };
}

const OFFSETS: Array<[number, number, number]> = [[0, 0, 0], [0.9, 0, 0], [-0.9, 0, 0], [0, 0.9, 0], [0, 0, 0.9], [0, 0, -0.9], [0.9, 0.9, 0], [-0.9, 0.9, 0]];

export function addShape(spec: SceneSpec, kind: string, selectedId: string | null): ShapeSpec {
  const { group, index } = parentFor(spec, selectedId);
  const count = group.children.length;
  // A new shape steps aside from the ones already there, so it doesn't hide inside them; a floor goes below.
  const at = kind === 'plane' ? [0, 0, 0] as [number, number, number] : [...OFFSETS[count % OFFSETS.length]] as [number, number, number];
  const sh = newShape(kind, nextId(spec, 's'), { at, color: PALETTE[count % PALETTE.length] });
  group.children.splice(index, 0, sh);
  return sh;
}

const PALETTE: Array<[number, number, number]> = [[0.85, 0.55, 0.35], [0.4, 0.62, 0.85], [0.55, 0.75, 0.45], [0.8, 0.45, 0.65], [0.85, 0.75, 0.4], [0.6, 0.6, 0.65]];

/** A new combine group: around the selected item, or empty at the root. */
export function addGroup(spec: SceneSpec, selectedId: string | null, op: GroupSpec['op'] = 'union', k = 0): GroupSpec {
  const g = newGroup(nextId(spec, 'g'), { op, k });
  const hit = selectedId ? findItem(spec, selectedId) : null;
  if (hit?.parent) {
    const i = hit.parent.children.indexOf(hit.item);
    hit.parent.children.splice(i, 1, g);
    g.children.push(hit.item);
  } else spec.root.children.push(g);
  return g;
}

export function removeItem(spec: SceneSpec, id: string): void {
  const hit = findItem(spec, id);
  if (!hit?.parent) return;
  hit.parent.children.splice(hit.parent.children.indexOf(hit.item), 1);
}

/** A group's children take its place (its warps go onto each of them). */
export function ungroup(spec: SceneSpec, id: string): void {
  const hit = findItem(spec, id);
  if (!hit?.parent || hit.item.type !== 'group') return;
  const g = hit.item;
  const kids = g.children.map(c => ({ ...c, warps: [...g.warps.map(w => ({ ...w, id: nextId(spec, 'w') })), ...c.warps] }) as SceneItem);
  hit.parent.children.splice(hit.parent.children.indexOf(g), 1, ...kids);
}

export function duplicateItem(spec: SceneSpec, id: string): SceneItem | null {
  const hit = findItem(spec, id);
  if (!hit?.parent) return null;
  const copy = structuredClone(hit.item);
  // Fresh ids, one at a time so each is unique.
  walkItems(copy, it => {
    it.id = '';
    for (const w of it.warps) w.id = '';
  });
  hit.parent.children.splice(hit.parent.children.indexOf(hit.item) + 1, 0, copy);
  walkItems(copy, it => {
    it.id = nextId(spec, it.type === 'group' ? 'g' : 's');
    for (const w of it.warps) w.id = nextId(spec, 'w');
  });
  if (copy.type === 'shape') copy.at = [copy.at[0] + 0.6, copy.at[1], copy.at[2]];
  if (copy.name) copy.name = `${copy.name} copy`;
  return copy;
}

/** Is `id` inside (or is) the item `ancestorId`? */
export function isWithin(spec: SceneSpec, id: string, ancestorId: string): boolean {
  const anc = findItem(spec, ancestorId)?.item;
  let inside = false;
  if (anc) walkItems(anc, it => { if (it.id === id) inside = true; });
  return inside;
}

/**
 * Move an item next to another (`before` / `after`) or into a group (`into`,
 * as its last child). Refused (false) when it would go inside itself.
 */
export function moveItem(spec: SceneSpec, id: string, targetId: string, where: 'before' | 'after' | 'into'): boolean {
  if (id === targetId || id === spec.root.id || isWithin(spec, targetId, id)) return false;
  const src = findItem(spec, id);
  const dst = findItem(spec, targetId);
  if (!src?.parent || !dst) return false;
  if (where === 'into' && dst.item.type !== 'group') return false;
  if (where !== 'into' && !dst.parent) return false;
  src.parent.children.splice(src.parent.children.indexOf(src.item), 1);
  if (where === 'into') (dst.item as GroupSpec).children.push(src.item);
  else {
    const list = dst.parent!.children;
    const i = list.indexOf(dst.item);
    list.splice(where === 'before' ? i : i + 1, 0, src.item);
  }
  return true;
}

export function addWarp(spec: SceneSpec, itemId: string, kind: string): void {
  const hit = findItem(spec, itemId);
  if (!hit) return;
  hit.item.warps.push(newWarp(kind, nextId(spec, 'w')));
}

export function removeWarp(spec: SceneSpec, itemId: string, warpId: string): void {
  const it = findItem(spec, itemId)?.item;
  if (it) it.warps = it.warps.filter(w => w.id !== warpId);
}

export function moveWarp(spec: SceneSpec, itemId: string, warpId: string, by: -1 | 1): void {
  const it = findItem(spec, itemId)?.item;
  if (!it) return;
  const i = it.warps.findIndex(w => w.id === warpId);
  const j = i + by;
  if (i < 0 || j < 0 || j >= it.warps.length) return;
  [it.warps[i], it.warps[j]] = [it.warps[j], it.warps[i]];
}

// ── The tree by buttons (touch screens have no drag) and the gallery's drops ─

/** ▲ / ▼: step an item one place among its siblings. False at either end. */
export function moveBy(spec: SceneSpec, id: string, by: -1 | 1): boolean {
  const hit = findItem(spec, id);
  if (!hit?.parent) return false;
  const list = hit.parent.children;
  const i = list.indexOf(hit.item);
  const j = i + by;
  if (j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
}

/** The group just above an item among its siblings, which Move into would put it in. */
function groupAbove(spec: SceneSpec, id: string): GroupSpec | null {
  const hit = findItem(spec, id);
  if (!hit?.parent) return null;
  const prev = hit.parent.children[hit.parent.children.indexOf(hit.item) - 1];
  return prev?.type === 'group' ? prev : null;
}

export const canMoveInto = (spec: SceneSpec, id: string): boolean => !!groupAbove(spec, id);

/** Move into: the item becomes the last child of the group just above it. */
export function moveIntoPrevious(spec: SceneSpec, id: string): boolean {
  const g = groupAbove(spec, id);
  return !!g && moveItem(spec, id, g.id, 'into');
}

export const canMoveOut = (spec: SceneSpec, id: string): boolean => {
  const hit = findItem(spec, id);
  return !!hit?.parent && hit.parent.id !== spec.root.id;
};

/** Move out: the item leaves its group and goes right after it. */
export function moveOut(spec: SceneSpec, id: string): boolean {
  if (!canMoveOut(spec, id)) return false;
  return moveItem(spec, id, findItem(spec, id)!.parent!.id, 'after');
}

/** The ids of `spec`'s items in tree order (the root first). */
function treeOrder(spec: SceneSpec): string[] {
  const out: string[] = [];
  walkItems(spec.root, it => out.push(it.id));
  return out;
}

/**
 * Wrap in…: a new group (`op`, blend `k`) around the selected items, at the place of the first of
 * them (in tree order), holding them in tree order. An item inside another selected one goes
 * with it. Null when nothing can be wrapped (only the root).
 */
export function wrapItems(spec: SceneSpec, ids: string[], op: GroupSpec['op'], k = 0): GroupSpec | null {
  const order = treeOrder(spec);
  const chosen = [...new Set(ids)].filter(id => id !== spec.root.id && findItem(spec, id))
    .filter((id, _i, all) => !all.some(o => o !== id && isWithin(spec, id, o)))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!chosen.length) return null;
  const first = findItem(spec, chosen[0])!;
  const g = newGroup(nextId(spec, 'g'), { op, k });
  first.parent!.children.splice(first.parent!.children.indexOf(first.item), 0, g);
  for (const id of chosen) {
    const hit = findItem(spec, id)!;
    hit.parent!.children.splice(hit.parent!.children.indexOf(hit.item), 1);
    g.children.push(hit.item);
  }
  return g;
}

/** A shape from the gallery dropped on a row: before or after it, or into it (a group; the root takes it last). */
export function insertShape(spec: SceneSpec, kind: string, targetId: string | null, where: 'before' | 'after' | 'into'): ShapeSpec {
  const target = targetId ? findItem(spec, targetId) : null;
  // Dropped onto the middle of a shape: beside it.
  const at = where === 'into' && target?.item.type !== 'group' ? 'after' : where;
  if (!target || at === 'into' || !target.parent) return addShape(spec, kind, target?.item.type === 'group' ? target.item.id : null);
  const sh = addShape(spec, kind, target.parent.id);
  moveItem(spec, sh.id, target.item.id, at);
  return sh;
}

/** A modifier chip added at the end of an item's stack. Returns its id. */
export function addModifier(spec: SceneSpec, itemId: string, kind: string): string {
  const it = findItem(spec, itemId)?.item;
  if (!it) return '';
  const w = newWarp(kind, nextId(spec, 'w'));
  it.warps.push(w);
  return w.id;
}

/** A chip dragged to place `index` in its item's stack. */
export function moveModifierTo(spec: SceneSpec, itemId: string, warpId: string, index: number): void {
  const it = findItem(spec, itemId)?.item;
  if (!it) return;
  const i = it.warps.findIndex(w => w.id === warpId);
  if (i < 0) return;
  const [w] = it.warps.splice(i, 1);
  it.warps.splice(Math.max(0, Math.min(it.warps.length, index)), 0, w);
}
