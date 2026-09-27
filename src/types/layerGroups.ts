/**
 * layerGroups.ts — groups in the Play page's layer list, like Ableton's group
 * tracks. They organise; they don't change the picture. The draw order is
 * still the flat `layers` array, and hiding a group is the one thing that
 * reaches the render: every layer inside is hidden while it is off (each
 * keeps its own switch underneath).
 *
 * A group lists its direct member layers and, when nested, the group it sits
 * in. Where it shows in the list is where its members are: they are kept
 * next to each other (tidyGroups), at the place of the first of them. A group
 * with no layers left in it goes away. The Background layer is never in one.
 */
import type { PlayLayer } from './playLayers';
import { LAYER_KIND_COLOURS, type LayerKindColour } from './layerKinds';

/** A group's colour: an accent name, in the theme's shade (the same set saved layer kinds use). */
export const GROUP_COLOURS = LAYER_KIND_COLOURS;
export type GroupColour = LayerKindColour;

export interface LayerGroup {
  id: string;
  label: string;
  colour: GroupColour;
  /** Its direct member layers (a nested group's layers are listed on that group). */
  layers: string[];
  /** The group it sits in. Absent: the top of the list. */
  parent?: string;
  /** Every layer inside is hidden. Absent: shown. */
  hidden?: true;
}

/** The part of a Play record groups work on. */
export interface Grouped { layers: PlayLayer[]; groups?: LayerGroup[] }

/** One row of the list: a layer, or a group with its rows inside. */
export type TreeNode = { kind: 'layer'; layer: PlayLayer } | { kind: 'group'; group: LayerGroup; children: TreeNode[] };

/** Something that can be picked, moved and grouped in the list. */
export interface ItemRef { kind: 'layer' | 'group'; id: string }

const ID = /^[A-Za-z0-9_.:-]{1,80}$/;

/** Groups from a file: bad entries dropped, members that aren't layers (or are claimed twice) dropped, loops cut, empty groups gone. */
export function parseLayerGroups(raw: unknown, layers: readonly PlayLayer[]): LayerGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: LayerGroup[] = [];
  const ids = new Set<string>(layers.map(l => l.id));
  for (const g of raw.slice(0, 200)) {
    if (!g || typeof g !== 'object') continue;
    const r = g as Record<string, unknown>;
    if (typeof r.id !== 'string' || !ID.test(r.id) || ids.has(r.id)) continue;
    ids.add(r.id);
    const group: LayerGroup = {
      id: r.id,
      label: typeof r.label === 'string' && r.label.trim() ? r.label.slice(0, 80) : 'Group',
      colour: (GROUP_COLOURS as readonly string[]).includes(r.colour as string) ? r.colour as GroupColour : 'mauve',
      layers: Array.isArray(r.layers) ? r.layers.filter((x): x is string => typeof x === 'string') : [],
    };
    if (typeof r.parent === 'string' && r.parent) group.parent = r.parent;
    if (r.hidden === true) group.hidden = true;
    out.push(group);
  }
  return pruneGroups(out, layers);
}

/**
 * Groups that still make sense for these layers: members that are gone (or
 * the Background layer, or already in another group) dropped, a parent that
 * is gone or loops dropped, and groups with no layers anywhere inside gone.
 * The same array back when nothing changed.
 */
export function pruneGroups(groups: readonly LayerGroup[], layers: readonly PlayLayer[]): LayerGroup[] {
  const layerIds = new Set(layers.filter(l => l.kind !== 'background').map(l => l.id));
  const claimed = new Set<string>();
  let changed = false;
  let out = groups.map(g => {
    const kept = g.layers.filter(id => { if (!layerIds.has(id) || claimed.has(id)) return false; claimed.add(id); return true; });
    if (kept.length === g.layers.length) return g;
    changed = true;
    return { ...g, layers: kept };
  });
  // Parents: one that exists, without going round in a circle.
  const byId = new Map(out.map(g => [g.id, g]));
  // In order: the first group of a loop keeps its place, the next one's link is cut.
  out = out.map(g => {
    if (!g.parent) return g;
    let ok = byId.has(g.parent);
    const seen = new Set([g.id]);
    for (let p = g.parent; ok && p; p = byId.get(p)?.parent ?? '') { if (seen.has(p)) ok = false; seen.add(p); }
    if (ok) return g;
    changed = true;
    const c = { ...g }; delete c.parent;
    byId.set(c.id, c);
    return c;
  });
  // Empty groups (no layers anywhere inside) go; their children, if any, move up.
  for (;;) {
    const holds = new Set<string>();
    for (const g of out) if (g.layers.length) for (let p: string | undefined = g.id; p && !holds.has(p); p = byIdOf(out, p)?.parent) holds.add(p);
    const empty = out.filter(g => !holds.has(g.id));
    if (!empty.length) break;
    changed = true;
    const gone = new Set(empty.map(g => g.id));
    out = out.filter(g => !gone.has(g.id)).map(g => (g.parent && gone.has(g.parent) ? withParent(g, undefined) : g));
  }
  return changed ? out : (groups as LayerGroup[]);
}

function byIdOf(groups: readonly LayerGroup[], id: string): LayerGroup | undefined { return groups.find(g => g.id === id); }
function withParent(g: LayerGroup, parent: string | undefined): LayerGroup { const c = { ...g }; if (parent) c.parent = parent; else delete c.parent; return c; }

/** The group each grouped layer sits directly in. */
export function groupOfLayer(groups: readonly LayerGroup[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of groups ?? []) for (const id of g.layers) m.set(id, g.id);
  return m;
}

/** The container an item sits in: a group's id, or '' for the top of the list. */
export function containerOf(p: Grouped, item: ItemRef): string {
  if (item.kind === 'group') return p.groups?.find(g => g.id === item.id)?.parent ?? '';
  return groupOfLayer(p.groups).get(item.id) ?? '';
}

/** The groups from the top of the list down to `groupId` (itself last). */
export function groupPath(groups: readonly LayerGroup[] | undefined, groupId: string): LayerGroup[] {
  const out: LayerGroup[] = [];
  const seen = new Set<string>();
  for (let g = groups?.find(x => x.id === groupId); g && !seen.has(g.id); g = g.parent ? groups?.find(x => x.id === g!.parent) : undefined) { seen.add(g.id); out.unshift(g); }
  return out;
}

/** Every layer inside a group, nested groups' too, in draw order. */
export function groupLayerIds(p: Grouped, groupId: string): string[] {
  const inside = new Set<string>();
  const groups = p.groups ?? [];
  const within = (gid: string): boolean => { for (let g = groups.find(x => x.id === gid), n = 0; g && n < 64; g = g.parent ? groups.find(x => x.id === g!.parent) : undefined, n++) if (g.id === groupId) return true; return false; };
  for (const g of groups) if (within(g.id)) for (const id of g.layers) inside.add(id);
  return p.layers.filter(l => inside.has(l.id)).map(l => l.id);
}

/** The group's nested groups, all the way down. */
export function subgroupIds(groups: readonly LayerGroup[] | undefined, groupId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => { for (const g of groups ?? []) if (g.parent === id && !out.includes(g.id)) { out.push(g.id); walk(g.id); } };
  walk(groupId);
  return out;
}

/**
 * The list as rows: layers and groups, each group with its rows inside. A
 * group sits where the first of its layers is; within a container, rows keep
 * the draw order.
 */
export function buildTree(p: Grouped): TreeNode[] {
  const groups = p.groups ?? [];
  const index = new Map(p.layers.map((l, i) => [l.id, i]));
  const groupOf = groupOfLayer(groups);
  const byId = new Map(groups.map(g => [g.id, g]));
  // A group's place: its first layer, nested groups' included.
  const anchor = new Map<string, number>();
  for (const [lid, gid] of groupOf) {
    const i = index.get(lid);
    if (i === undefined) continue;
    for (let g = byId.get(gid), n = 0; g && n < 64; g = g.parent ? byId.get(g.parent) : undefined, n++) anchor.set(g.id, Math.min(anchor.get(g.id) ?? Infinity, i));
  }
  const kids = new Map<string, Array<{ at: number; node: () => TreeNode }>>();
  const put = (container: string, at: number, node: () => TreeNode) => { const k = kids.get(container); if (k) k.push({ at, node }); else kids.set(container, [{ at, node }]); };
  p.layers.forEach((l, i) => put(groupOf.get(l.id) ?? '', i, () => ({ kind: 'layer', layer: l })));
  for (const g of groups) {
    const at = anchor.get(g.id);
    if (at !== undefined) put(g.parent && byId.has(g.parent) ? g.parent : '', at, () => ({ kind: 'group', group: g, children: rows(g.id) }));
  }
  const rows = (container: string): TreeNode[] => (kids.get(container) ?? []).sort((a, b) => a.at - b.at).map(k => k.node());
  return rows('');
}

/** The rows inside a container ('' = the top of the list). */
export function childrenOf(tree: readonly TreeNode[], container: string): TreeNode[] {
  if (!container) return tree as TreeNode[];
  const find = (nodes: readonly TreeNode[]): TreeNode[] | null => {
    for (const n of nodes) if (n.kind === 'group') { if (n.group.id === container) return n.children; const f = find(n.children); if (f) return f; }
    return null;
  };
  return find(tree) ?? [];
}

/** The layers in the order the rows show them. */
export function flattenTree(nodes: readonly TreeNode[]): PlayLayer[] {
  const out: PlayLayer[] = [];
  const walk = (ns: readonly TreeNode[]) => { for (const n of ns) if (n.kind === 'layer') out.push(n.layer); else walk(n.children); };
  walk(nodes);
  return out;
}

/**
 * Groups pruned and their members next to each other (each group where its
 * first layer is). The same record when nothing changed, and at once when
 * there are no groups: this runs on every edit.
 */
export function tidyGroups<T extends Grouped>(p: T): T {
  if (!p.groups) return p;
  const groups = pruneGroups(p.groups, p.layers);
  if (!groups.length) { const c = { ...p }; delete c.groups; return c; }
  const ordered = flattenTree(buildTree({ layers: p.layers, groups }));
  const moved = ordered.some((l, i) => l !== p.layers[i]);
  if (!moved && groups === p.groups) return p;
  return { ...p, groups, ...(moved ? { layers: ordered } : {}) };
}

/** The layers inside hidden groups. */
export function groupHiddenLayers(p: Grouped): Set<string> {
  const out = new Set<string>();
  for (const g of p.groups ?? []) if (g.hidden) for (const id of groupLayerIds(p, g.id)) out.add(id);
  return out;
}

/**
 * The record as it draws: layers inside a hidden group are hidden. The same
 * record when no group is hidden. The runtime and exported pages get this,
 * so they never need to know about groups.
 */
export function applyGroupVisibility<T extends Grouped>(p: T): T {
  if (!p.groups?.some(g => g.hidden)) return p;
  const off = groupHiddenLayers(p);
  return { ...p, layers: p.layers.map(l => (off.has(l.id) && l.visible ? { ...l, visible: false } as PlayLayer : l)) };
}
