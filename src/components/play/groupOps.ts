/**
 * groupOps.ts — edits to layer groups (types/layerGroups.ts): group what is
 * picked, ungroup, move a row among its neighbours, take a layer out,
 * duplicate a group (its layers alone, or with the controls, mappings and
 * actions that drive them), delete one with its layers, and what a group's
 * card shows (the kinds inside, the live parameters).
 *
 * All pure: they take a record and give one back (tidyGroups keeps members
 * together afterwards).
 */
import { layerNumericProps, layerTarget, parseActionTarget, parseLayerTarget, actionTarget, type PlayAction, type PlayControl, type PlayLayer, type PlayMapping, type PlayRecord, type PlaySignal, type PlaySource, type TriggerSpec } from '../../types/play';
import {
  buildTree, childrenOf, containerOf, groupLayerIds, groupOfLayer, groupPath, newLayerHome, subgroupIds, tidyGroups, flattenTree,
  type GroupColour, type ItemRef, type LayerGroup, type TreeNode,
} from '../../types/layerGroups';
import { playId } from '../../play/playControls';
import { removeLayer } from './layerOps';

export const groupId = () => playId('layer').replace(/^layer_/, 'grp_');

const same = (a: ItemRef, b: ItemRef) => a.kind === b.kind && a.id === b.id;
const key = (i: ItemRef) => `${i.kind}:${i.id}`;

/** The order new groups take colours in: well apart, and blue (the selection colour) last. */
const COLOUR_ORDER: readonly GroupColour[] = ['peach', 'teal', 'mauve', 'yellow', 'pink', 'green', 'sky', 'red', 'lavender', 'blue'];

/** A colour no group uses yet (the next in line when all are taken). */
export function nextGroupColour(groups: readonly LayerGroup[] | undefined): GroupColour {
  const used = new Set((groups ?? []).map(g => g.colour));
  return COLOUR_ORDER.find(c => !used.has(c)) ?? COLOUR_ORDER[(groups?.length ?? 0) % COLOUR_ORDER.length];
}

/** "Group", "Group 2"…: a name no group has. */
function freshGroupName(groups: readonly LayerGroup[] | undefined, base = 'Group'): string {
  const taken = new Set((groups ?? []).map(g => g.label));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** "Fireflies (2)", "(3)"…: the first that isn't taken. A name already ending in (n) counts on from its base. */
export function copyName(label: string, taken: ReadonlySet<string>): string {
  const base = label.replace(/\s*\(\d+\)$/, '');
  for (let n = 2; ; n++) { const name = `${base} (${n})`; if (!taken.has(name)) return name; }
}

/**
 * Layers that have to travel together: a layer and its matte, and a matte
 * and the layers using it. The Background layer never joins a group.
 */
export function withMattes(p: PlayRecord, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  for (let grew = true; grew;) {
    grew = false;
    for (const l of p.layers) {
      if (l.kind === 'background') continue;
      const m = l.trackMatte?.id;
      if (out.has(l.id) && m && !out.has(m)) { out.add(m); grew = true; }
      if (!out.has(l.id) && m && out.has(m)) { out.add(l.id); grew = true; }
    }
  }
  for (const l of p.layers) if (l.kind === 'background') out.delete(l.id);
  return out;
}

/** Drop picked items that sit inside another picked group (the outer one carries them). */
function outermost(p: PlayRecord, items: readonly ItemRef[]): ItemRef[] {
  const picked = new Set(items.filter(i => i.kind === 'group').map(i => i.id));
  return items.filter(i => {
    const start = containerOf(p, i);
    return !groupPath(p.groups, start).some(g => picked.has(g.id));
  });
}

/** The deepest container holding every item ('' = the top of the list). */
function commonContainer(p: PlayRecord, items: readonly ItemRef[]): string {
  const paths = items.map(i => { const c = containerOf(p, i); return c ? groupPath(p.groups, c).map(g => g.id) : []; });
  let common = paths[0] ?? [];
  for (const path of paths.slice(1)) { let n = 0; while (n < common.length && n < path.length && common[n] === path[n]) n++; common = common.slice(0, n); }
  return common[common.length - 1] ?? '';
}

/**
 * Put the items in a new group, where the first of them is. Items from
 * different groups come out of those into the new one, which sits in the
 * deepest group holding them all. A layer's matte comes with it. Returns the
 * new group's id ('' when there was nothing to group).
 */
export function createGroup(p: PlayRecord, items: readonly ItemRef[], opts: { id?: string; label?: string; colour?: GroupColour } = {}): { play: PlayRecord; id: string } {
  const valid = items.filter(i => (i.kind === 'layer' ? p.layers.some(l => l.id === i.id && l.kind !== 'background') : p.groups?.some(g => g.id === i.id)));
  const top = outermost(p, valid);
  if (!top.length) return { play: p, id: '' };
  const parent = commonContainer(p, top);
  // Mattes join too, unless they are already inside a picked group.
  const pickedGroups = top.filter(i => i.kind === 'group').map(i => i.id);
  const insidePicked = new Set(pickedGroups.flatMap(g => groupLayerIds(p, g)));
  const layerIds = [...withMattes(p, top.filter(i => i.kind === 'layer').map(i => i.id))].filter(id => !insidePicked.has(id));
  const id = opts.id ?? groupId();
  const move = new Set(layerIds), movedGroups = new Set(pickedGroups);
  const groups = (p.groups ?? []).map(g => {
    const kept = g.layers.filter(l => !move.has(l));
    const next = kept.length === g.layers.length ? g : { ...g, layers: kept };
    return movedGroups.has(g.id) ? { ...next, parent: id } : next;
  });
  const group: LayerGroup = {
    id, label: opts.label ?? freshGroupName(p.groups), colour: opts.colour ?? nextGroupColour(p.groups),
    layers: p.layers.filter(l => move.has(l.id)).map(l => l.id),
    ...(parent ? { parent } : {}),
  };
  return { play: tidyGroups({ ...p, groups: [...groups, group] }), id };
}

/** The group goes; what was in it stays where it is, in the group around it (or the top of the list). */
export function ungroup(p: PlayRecord, id: string): PlayRecord {
  const g = p.groups?.find(x => x.id === id);
  if (!g) return p;
  const groups = p.groups!.filter(x => x.id !== id).map(x => {
    if (x.parent === id) { const c = { ...x }; if (g.parent) c.parent = g.parent; else delete c.parent; return c; }
    if (x.id === g.parent) return { ...x, layers: [...x.layers, ...g.layers] };
    return x;
  });
  return tidyGroups({ ...p, groups });
}

/** A layer (with its matte) taken out of its group, into the group around it; it lands just before or after the group. */
export function takeOutOfGroup(p: PlayRecord, layerId: string): PlayRecord {
  const gid = groupOfLayer(p.groups).get(layerId);
  if (!gid) return p;
  const g = p.groups!.find(x => x.id === gid)!;
  const move = new Set([...withMattes(p, [layerId])].filter(id => groupOfLayer(p.groups).get(id) === gid));
  const groups = p.groups!.map(x => {
    if (x.id === gid) return { ...x, layers: x.layers.filter(l => !move.has(l)) };
    if (x.id === g.parent) return { ...x, layers: [...x.layers, ...move] };
    return x;
  });
  // After the group (drawn on top of it), unless it was the group's first.
  const block = groupLayerIds(p, gid);
  const first = block[0] === layerId;
  const rest = p.layers.filter(l => !move.has(l.id));
  const moved = p.layers.filter(l => move.has(l.id));
  const edge = first ? rest.findIndex(l => block.includes(l.id)) : rest.map(l => block.includes(l.id)).lastIndexOf(true) + 1;
  const layers = edge < 0 ? p.layers : [...rest.slice(0, edge), ...moved, ...rest.slice(edge)];
  return tidyGroups({ ...p, layers, groups });
}

export function patchGroup(p: PlayRecord, id: string, patch: Partial<Pick<LayerGroup, 'label' | 'colour'>> & { hidden?: boolean }): PlayRecord {
  if (!p.groups?.some(g => g.id === id)) return p;
  return {
    ...p,
    groups: p.groups.map(g => {
      if (g.id !== id) return g;
      const { hidden, ...rest } = patch;
      const c: LayerGroup = { ...g, ...rest };
      if (hidden === true) c.hidden = true; else if (hidden === false) delete c.hidden;
      return c;
    }),
  };
}

// ── Moving rows ─────────────────────────────────────────────────────────────

const nodeRef = (n: TreeNode): ItemRef => (n.kind === 'layer' ? { kind: 'layer', id: n.layer.id } : { kind: 'group', id: n.group.id });

/** The rows around an item: its container's rows and where it is among them. */
export function siblingsOf(p: PlayRecord, item: ItemRef): { rows: TreeNode[]; at: number } {
  const rows = childrenOf(buildTree(p), containerOf(p, item));
  return { rows, at: rows.findIndex(n => same(nodeRef(n), item)) };
}

/** Can the row move up (-1) or down (1) among its neighbours? The Background layer stays first. */
export function canMove(p: PlayRecord, item: ItemRef, dir: -1 | 1): boolean {
  const { rows, at } = siblingsOf(p, item);
  const j = at + dir;
  if (at < 0 || j < 0 || j >= rows.length) return false;
  const isBg = (n: TreeNode) => n.kind === 'layer' && n.layer.kind === 'background';
  return !isBg(rows[at]) && !isBg(rows[j]);
}

/** Rebuild the layer order from a container's rows in a new order. */
function reorder(p: PlayRecord, container: string, rows: TreeNode[]): PlayRecord {
  const tree = buildTree(p);
  const swap = (nodes: TreeNode[]): TreeNode[] => (!container ? rows : nodes.map(n => (n.kind === 'group' ? (n.group.id === container ? { ...n, children: rows } : { ...n, children: swap(n.children) }) : n)));
  const layers = flattenTree(container ? swap(tree) : rows);
  return layers.every((l, i) => l === p.layers[i]) ? p : { ...p, layers };
}

/** Move a layer or a whole group one row up or down among its neighbours (a group moves past a neighbour group whole). */
export function moveItem(p: PlayRecord, item: ItemRef, dir: -1 | 1): PlayRecord {
  if (!canMove(p, item, dir)) return p;
  const { rows, at } = siblingsOf(p, item);
  const next = [...rows];
  [next[at], next[at + dir]] = [next[at + dir], next[at]];
  return reorder(p, containerOf(p, item), next);
}

/** Drop a row before or after another row in the same container (dragging in the list). */
export function moveItemTo(p: PlayRecord, item: ItemRef, target: ItemRef, where: 'before' | 'after'): PlayRecord {
  if (same(item, target)) return p;
  const container = containerOf(p, item);
  if (containerOf(p, target) !== container) return p;
  const { rows, at } = siblingsOf(p, item);
  if (at < 0) return p;
  const moving = rows[at];
  if (moving.kind === 'layer' && moving.layer.kind === 'background') return p;
  const rest = rows.filter((_, i) => i !== at);
  let j = rest.findIndex(n => same(nodeRef(n), target));
  if (j < 0) return p;
  if (where === 'after') j += 1;
  // Nothing goes under the Background layer.
  if (j === 0 && rest[0]?.kind === 'layer' && rest[0].layer.kind === 'background') j = 1;
  return reorder(p, container, [...rest.slice(0, j), moving, ...rest.slice(j)]);
}

// ── Duplicate, delete ──────────────────────────────────────────────────────

/** A layer's references to other layers pointed at their copies (nulls it follows, its matte, a cloner's source…). */
function retargetLayer(l: PlayLayer, ids: ReadonlyMap<string, string>): PlayLayer {
  const out = { ...(l as unknown as Record<string, unknown>) };
  for (const [k, v] of Object.entries(out)) {
    if (k === 'id' || k === 'kind') continue;
    if (typeof v === 'string' && ids.has(v)) out[k] = ids.get(v);
    else if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string')) out[k] = (v as string[]).map(x => ids.get(x) ?? x);
  }
  if (l.trackMatte && ids.has(l.trackMatte.id)) out.trackMatte = { ...l.trackMatte, id: ids.get(l.trackMatte.id) };
  return out as unknown as PlayLayer;
}

const mapId = (id: string, ids: ReadonlyMap<string, string>) => ids.get(id) ?? id;

function retargetTrigger(t: TriggerSpec, ids: ReadonlyMap<string, string>): TriggerSpec {
  if (t.on === 'zone') return { ...t, layerId: mapId(t.layerId, ids) };
  if (t.on === 'proximity') return { ...t, a: mapId(t.a, ids), b: mapId(t.b, ids) };
  return t;
}

function retargetSource(s: PlaySource, ids: ReadonlyMap<string, string>, controls: ReadonlyMap<string, string>): PlaySource {
  switch (s.kind) {
    case 'null': return { ...s, layerId: mapId(s.layerId, ids) };
    case 'sensor': return { ...s, layerId: mapId(s.layerId, ids), otherId: mapId(s.otherId, ids) };
    case 'trigger': return { ...s, trigger: retargetTrigger(s.trigger, ids) };
    case 'control': return { ...s, controlId: controls.get(s.controlId) ?? s.controlId };
    default: return s;
  }
}

function triggerReads(t: TriggerSpec, ids: ReadonlySet<string> | ReadonlyMap<string, string>): boolean {
  return (t.on === 'zone' && ids.has(t.layerId)) || (t.on === 'proximity' && (ids.has(t.a) || ids.has(t.b)));
}

/**
 * A copy of the group (and the groups inside it) right after it, drawn on
 * top. Its layers keep their settings, and links between them (a matte, a
 * null they follow) point at the copies. `withControls` also copies the
 * controls on those layers, their mappings and the actions on them (or fired
 * from them), pointed at the copies; otherwise the copy has none, to hook up
 * yourself. Names get "(2)", "(3)"…
 */
export function duplicateGroup(p: PlayRecord, id: string, withControls: boolean): { play: PlayRecord; id: string } {
  const g = p.groups?.find(x => x.id === id);
  if (!g) return { play: p, id: '' };
  const layerIds = groupLayerIds(p, id);
  const subIds = subgroupIds(p.groups, id);
  const ids = new Map<string, string>(layerIds.map(l => [l, playId('layer')]));
  const gids = new Map<string, string>([[id, groupId()], ...subIds.map(s => [s, groupId()] as [string, string])]);
  const layerNames = new Set(p.layers.map(l => l.label));
  const groupNames = new Set((p.groups ?? []).map(x => x.label));
  const labels = new Map<string, string>();
  const copies = p.layers.filter(l => ids.has(l.id)).map(l => {
    const label = copyName(l.label, layerNames);
    layerNames.add(label);
    labels.set(l.id, label);
    const c = retargetLayer(structuredClone(l), ids) as unknown as Record<string, unknown>;
    c.id = ids.get(l.id); c.label = label;
    return c as unknown as PlayLayer;
  });
  const newGroups: LayerGroup[] = [id, ...subIds].map(gid => {
    const src = p.groups!.find(x => x.id === gid)!;
    const label = copyName(src.label, groupNames);
    groupNames.add(label);
    const c: LayerGroup = { ...src, id: gids.get(gid)!, label, layers: src.layers.map(l => ids.get(l)!).filter(Boolean) };
    if (gid === id) { if (src.parent) c.parent = src.parent; } else c.parent = gids.get(src.parent!)!;
    return c;
  });
  // Right after the group, in the group around it.
  const last = Math.max(...layerIds.map(l => p.layers.findIndex(x => x.id === l)));
  const layers = [...p.layers.slice(0, last + 1), ...copies, ...p.layers.slice(last + 1)];
  let out: PlayRecord = { ...p, layers, groups: [...(p.groups ?? []), ...newGroups] };

  if (withControls) {
    const controlIds = new Map<string, string>();
    const controls: PlayControl[] = [];
    for (const c of p.controls) {
      const lt = parseLayerTarget(c.target), at = parseActionTarget(c.target);
      const from = lt?.layerId ?? at?.layerId;
      if (!from || !ids.has(from)) continue;
      const nid = playId('ctl');
      controlIds.set(c.id, nid);
      const oldLabel = p.layers.find(l => l.id === from)?.label ?? '';
      const label = oldLabel && c.label.startsWith(`${oldLabel} · `) ? labels.get(from)! + c.label.slice(oldLabel.length) : c.label;
      controls.push({ ...c, id: nid, label, target: lt ? layerTarget(ids.get(from)!, lt.key) : actionTarget(ids.get(from)!, at!.do) });
    }
    const mappings: PlayMapping[] = p.mappings.filter(m => controlIds.has(m.controlId)).map(m => ({
      ...structuredClone(m), id: playId('map'), controlId: controlIds.get(m.controlId)!, source: retargetSource(structuredClone(m.source), ids, controlIds),
    }));
    const actions: PlayAction[] = (p.actions ?? []).filter(a => ids.has(a.layerId) || triggerReads(a.trigger, ids)).map(a => ({
      ...structuredClone(a), id: playId('act'), layerId: mapId(a.layerId, ids), trigger: retargetTrigger(structuredClone(a.trigger), ids),
    }));
    // Rules acting on the group's layers, or watching them, copied onto the copies (fresh ids, reactions included).
    const rules: PlaySignal[] = (p.signals ?? []).filter(s => (s.do ?? []).some(r => ids.has(r.layerId)) || (s.inputs ?? []).some(x => x.kind === 'trigger' && triggerReads(x.trigger, ids))).map(s => ({
      ...structuredClone(s), id: playId('sig'), name: `${s.name} (copy)`,
      ...(s.inputs ? { inputs: s.inputs.map(x => (x.kind === 'trigger' ? { kind: 'trigger' as const, trigger: retargetTrigger(structuredClone(x.trigger), ids) } : { ...x })) } : {}),
      ...(s.do ? { do: s.do.map(r => ({ ...structuredClone(r), id: playId('act'), layerId: mapId(r.layerId, ids) })) } : {}),
    }));
    out = { ...out, controls: [...p.controls, ...controls], mappings: [...p.mappings, ...mappings] };
    if (actions.length) out.actions = [...(p.actions ?? []), ...actions];
    if (rules.length) out.signals = [...(p.signals ?? []), ...rules];
  }
  return { play: tidyGroups(out), id: gids.get(id)! };
}

/** Delete a group and every layer in it (with the controls, mappings and actions that use them). */
export function removeGroup(p: PlayRecord, id: string): PlayRecord {
  let out = p;
  for (const l of groupLayerIds(p, id)) out = removeLayer(out, l);
  return tidyGroups(out);
}

// ── What a group's card shows ───────────────────────────────────────────────

/**
 * A live parameter of a layer in a group: a number that is a control (so it
 * can be mapped, recorded in a take, driven by a trigger), a button a
 * control presses, a null that drives mappings, or a setting that follows a
 * null.
 */
export type LiveParam =
  | { kind: 'prop'; layerId: string; key: string; label: string; min: number; max: number; step?: number; controlId?: string }
  | { kind: 'action'; layerId: string; controlId: string; label: string }
  | { kind: 'follow'; layerId: string; label: string; nullLabel: string };

const FOLLOW_KEYS: Record<string, string> = { followId: 'Follows', nullId: 'Null' };

export function liveParams(p: PlayRecord, id: string): LiveParam[] {
  const inside = groupLayerIds(p, id);
  const byId = new Map(p.layers.map(l => [l.id, l]));
  const out: LiveParam[] = [];
  const seen = new Set<string>();
  // Nulls that a mapping reads.
  const readNull = new Set(p.mappings.flatMap(m => (m.source.kind === 'null' ? [m.source.layerId] : [])));
  for (const lid of inside) {
    const l = byId.get(lid)!;
    const props = layerNumericProps(l);
    for (const c of p.controls) {
      const lt = parseLayerTarget(c.target);
      if (lt?.layerId === lid) {
        const d = props.find(x => x.key === lt.key);
        if (!d || seen.has(`${lid}:${lt.key}`)) continue;
        seen.add(`${lid}:${lt.key}`);
        out.push({ kind: 'prop', layerId: lid, key: lt.key, label: `${l.label} · ${d.label}`, min: c.min, max: c.max, ...(c.step ?? d.step ? { step: c.step ?? d.step } : {}), controlId: c.id });
        continue;
      }
      const at = parseActionTarget(c.target);
      if (at?.layerId === lid) out.push({ kind: 'action', layerId: lid, controlId: c.id, label: c.label.startsWith(`${l.label} · `) ? c.label : `${l.label} · ${c.label}` });
    }
    if (l.kind === 'null' && readNull.has(lid)) {
      for (const k of ['x', 'y']) {
        const d = props.find(x => x.key === k);
        if (!d || seen.has(`${lid}:${k}`)) continue;
        seen.add(`${lid}:${k}`);
        out.push({ kind: 'prop', layerId: lid, key: k, label: `${l.label} · ${d.label}`, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) });
      }
    }
    const rec = l as unknown as Record<string, unknown>;
    const usesNull = Object.values(rec).includes('null');
    for (const [k, name] of Object.entries(FOLLOW_KEYS)) {
      const target = typeof rec[k] === 'string' ? byId.get(rec[k] as string) : undefined;
      if (target?.kind === 'null' && usesNull) out.push({ kind: 'follow', layerId: lid, label: `${l.label} · ${name}`, nullLabel: target.label });
    }
  }
  return out;
}

/** The kinds of layer inside a group, with how many of each, in draw order of first appearance. */
export function groupKinds(p: PlayRecord, id: string): Array<{ layer: PlayLayer; count: number }> {
  const out = new Map<string, { layer: PlayLayer; count: number }>();
  for (const lid of groupLayerIds(p, id)) {
    const l = p.layers.find(x => x.id === lid)!;
    const k = l.kind === 'script' ? (l.kindId ? `kind:${l.kindId}` : l.mode === '3d' ? 'script3d' : 'script') : l.kind;
    const e = out.get(k);
    if (e) e.count++; else out.set(k, { layer: l, count: 1 });
  }
  return [...out.values()];
}

/** The picked items in the list's order (a range pick walks this). */
export function orderedItems(rows: readonly TreeNode[]): ItemRef[] {
  return rows.map(nodeRef);
}

export { key as itemKey };

/**
 * A new layer placed while the list shows `entered`: in that group, at its
 * end, unless it is sealed (a grains group): then in the nearest open group
 * around it, or left at the top level.
 */
export function placeNewLayer(p: PlayRecord, layerId: string, entered: string): PlayRecord {
  const home = entered ? newLayerHome(p.groups, entered) : '';
  return home ? addToGroup(p, layerId, home) : p;
}

/** A new layer put in a group (the one the list is showing), at its end. */
export function addToGroup(p: PlayRecord, layerId: string, id: string): PlayRecord {
  if (!p.groups?.some(g => g.id === id) || !p.layers.some(l => l.id === layerId && l.kind !== 'background')) return p;
  return tidyGroups({ ...p, groups: p.groups.map(g => (g.id === id ? { ...g, layers: [...g.layers.filter(x => x !== layerId), layerId] } : { ...g, layers: g.layers.filter(x => x !== layerId) })) });
}
