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
