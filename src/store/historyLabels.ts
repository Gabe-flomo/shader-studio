/**
 * Words for the History panel: what one undo step changed, found by comparing the graph before
 * and after it. Steps pushed with a label keep theirs ("Grouped 4 nodes"); the rest are named
 * from this diff ("Changed Radius 0.3 → 0.42", "Connected UV → Circle SDF").
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { getNodeDefinitionFor } from '../nodes/definitions';

/** A node's name as its card shows it. */
export function nodeName(node: GraphNode | undefined): string {
  if (!node) return 'a node';
  return (typeof node.params?.label === 'string' && node.params.label.trim()) || getNodeDefinitionFor(node)?.label || node.type;
}

/** "Circle SDF" for one node, "3 nodes" for more. */
export function nodesPhrase(nodes: GraphNode[]): string {
  return nodes.length === 1 ? nodeName(nodes[0]) : `${nodes.length} nodes`;
}

export interface NodeRef { key: string; id: string; topId: string; name: string }
export interface ParamChange extends NodeRef {
  param: string;
  label: string;
  /** Short text for each side, or null when the value doesn't read as text (code, curves). */
  from: string | null;
  to: string | null;
  /** Colour values (0–1 RGB) when the param is a colour, for swatches. */
  fromColor?: number[];
  toColor?: number[];
}
export interface WireChange { kind: 'added' | 'removed'; fromName: string; toName: string; fromPort: string; toPort: string; toTopId: string; fromTopId: string }
export interface OtherChange extends NodeRef { what: string }

export interface StepDiff {
  added: NodeRef[];
  removed: NodeRef[];
  params: ParamChange[];
  wires: WireChange[];
  moved: NodeRef[];
  other: OtherChange[];
  /** Top-level nodes the step touched (added, edited, rewired, moved), for "show on canvas". */
  touchedTopIds: string[];
  /** How many distinct nodes changed in any way. */
  changedCount: number;
}

interface Flat { node: GraphNode; key: string; topId: string; scope: string }

function subgraphOf(n: GraphNode): SubgraphData | undefined {
  const sg = n.params?.subgraph as SubgraphData | undefined;
  return sg && Array.isArray(sg.nodes) ? sg : undefined;
}

/** Every node, groups' insides included, keyed by its path ("g1/n4"). */
function flatten(nodes: GraphNode[]): Map<string, Flat> {
  const out = new Map<string, Flat>();
  const walk = (list: GraphNode[], scope: string, topId: string | null) => {
    for (const n of list) {
      const key = scope ? `${scope}/${n.id}` : n.id;
      const top = topId ?? n.id;
      out.set(key, { node: n, key, topId: top, scope });
      const sg = subgraphOf(n);
      if (sg) walk(sg.nodes, key, top);
    }
  };
  walk(nodes, '', null);
  return out;
}

const round = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

function isColorParam(node: GraphNode, key: string): boolean {
  const pd = getNodeDefinitionFor(node)?.paramDefs?.[key];
  return pd?.type === 'vec3color';
}

/** A value as short text, or null when it doesn't read as one (code, keyframes, objects). */
export function valueText(node: GraphNode, key: string, v: unknown): string | null {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? String(round(v)) : String(v);
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') {
    const opt = getNodeDefinitionFor(node)?.paramDefs?.[key]?.options?.find(o => o.value === v);
    if (opt) return opt.label;
    if (v.includes('\n')) return null;
    const t = v.trim();
    return t.length > 28 ? `“${t.slice(0, 26)}…”` : `“${t}”`;
  }
  if (Array.isArray(v) && v.length <= 4 && v.every(x => typeof x === 'number')) return `(${v.map(x => round(x as number)).join(', ')})`;
  return null;
}

function paramLabel(node: GraphNode, key: string): string {
  if (key === '__comment') return 'Comment';
  if (key === 'label') return 'Name';
  const pd = getNodeDefinitionFor(node)?.paramDefs?.[key];
  if (pd?.label) return pd.label;
  const inp = node.inputs?.[key];
  if (inp?.label) return inp.label;
  // camelCase / snake_case → words
  const words = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

const cache = new WeakMap<GraphNode[], WeakMap<GraphNode[], StepDiff>>();

/** What changed between two snapshots of the graph. Cached per pair of snapshots. */
export function diffGraphs(before: GraphNode[], after: GraphNode[]): StepDiff {
  let inner = cache.get(before);
  const hit = inner?.get(after);
  if (hit) return hit;
  const d = computeDiff(before, after);
  if (!inner) { inner = new WeakMap(); cache.set(before, inner); }
  inner.set(after, d);
  return d;
}

function computeDiff(before: GraphNode[], after: GraphNode[]): StepDiff {
  const a = flatten(before), b = flatten(after);
  const ref = (f: Flat): NodeRef => ({ key: f.key, id: f.node.id, topId: f.topId, name: nodeName(f.node) });
  const added: NodeRef[] = [], removed: NodeRef[] = [], moved: NodeRef[] = [];
  const params: ParamChange[] = [], wires: WireChange[] = [], other: OtherChange[] = [];
  const changed = new Set<string>();

  const nameIn = (map: Map<string, Flat>, scope: string, id: string) => {
    if (id === GROUP_PORT_SENTINEL) return 'Group input';
    const f = map.get(scope ? `${scope}/${id}` : id);
    return f ? nodeName(f.node) : 'a node';
  };
  const outLabel = (map: Map<string, Flat>, scope: string, id: string, key: string) => {
    const f = map.get(scope ? `${scope}/${id}` : id);
    return f?.node.outputs?.[key]?.label ?? key;
  };
  const wireOf = (map: Map<string, Flat>, f: Flat, inputKey: string, conn: { nodeId: string; outputKey: string }, kind: WireChange['kind']): WireChange => {
    const src = map.get(f.scope ? `${f.scope}/${conn.nodeId}` : conn.nodeId);
    return {
      kind,
      fromName: nameIn(map, f.scope, conn.nodeId), fromPort: outLabel(map, f.scope, conn.nodeId, conn.outputKey), fromTopId: src?.topId ?? f.topId,
      toName: nodeName(f.node), toPort: f.node.inputs?.[inputKey]?.label ?? inputKey, toTopId: f.topId,
    };
  };

  for (const [key, fb] of b) {
    const fa = a.get(key);
    if (!fa) {
      added.push(ref(fb)); changed.add(key);
      // Wires into a new node count as part of adding it, except where it was wired to an existing one
      for (const [ik, s] of Object.entries(fb.node.inputs ?? {})) {
        if (!s.connection) continue;
        const srcKey = fb.scope ? `${fb.scope}/${s.connection.nodeId}` : s.connection.nodeId;
        if (a.has(srcKey)) wires.push(wireOf(b, fb, ik, s.connection, 'added'));
      }
      continue;
    }
    const na = fa.node, nb = fb.node;
    if (na === nb) continue;
    let touched = false;
    if (na.type !== nb.type) {
      other.push({ ...ref(fb), what: `Became ${nodeName(nb)} (was ${nodeName(na)})` }); touched = true;
    }
    if (!!na.bypassed !== !!nb.bypassed) { other.push({ ...ref(fb), what: nb.bypassed ? 'Bypassed' : 'No longer bypassed' }); touched = true; }
    // Params (a group's inside is compared node by node, not as one blob)
    const keys = new Set([...Object.keys(na.params ?? {}), ...Object.keys(nb.params ?? {})]);
    for (const k of keys) {
      if (k === 'subgraph' || (k.startsWith('_') && k !== '__comment')) continue;
      const va = na.params?.[k], vb = nb.params?.[k];
      if (same(va, vb)) continue;
      const color = isColorParam(nb, k) && Array.isArray(va) && Array.isArray(vb);
      params.push({
        ...ref(fb), param: k, label: paramLabel(nb, k),
        from: valueText(na, k, va), to: valueText(nb, k, vb),
        ...(color ? { fromColor: va as number[], toColor: vb as number[] } : {}),
      });
      touched = true;
    }
    // Inputs: wires and typed-in defaults
    const iks = new Set([...Object.keys(na.inputs ?? {}), ...Object.keys(nb.inputs ?? {})]);
    let socketsChanged = false;
    for (const ik of iks) {
      const sa = na.inputs?.[ik], sb = nb.inputs?.[ik];
      if (!sa || !sb) { socketsChanged = true; }
      const ca = sa?.connection, cb = sb?.connection;
      if (!same(ca, cb)) {
        // A wire whose source node went is part of removing that node, not listed on its own
        if (ca && sa && (ca.nodeId === GROUP_PORT_SENTINEL || b.has(fa.scope ? `${fa.scope}/${ca.nodeId}` : ca.nodeId))) {
          wires.push(wireOf(a, fa, ik, ca, 'removed'));
        }
        if (cb && sb) wires.push(wireOf(b, fb, ik, cb, 'added'));
        touched = true;
      }
      if (sa && sb && !same(sa.defaultValue, sb.defaultValue)) {
        params.push({ ...ref(fb), param: ik, label: sb.label ?? ik, from: valueText(na, ik, sa.defaultValue), to: valueText(nb, ik, sb.defaultValue) });
        touched = true;
      }
    }
    if (!socketsChanged && !same(Object.keys(na.outputs ?? {}), Object.keys(nb.outputs ?? {}))) socketsChanged = true;
    if (socketsChanged && na.type === nb.type) { other.push({ ...ref(fb), what: 'Inputs or outputs changed' }); touched = true; }
    if (na.position.x !== nb.position.x || na.position.y !== nb.position.y) { moved.push(ref(fb)); touched = true; }
    const sgA = subgraphOf(na), sgB = subgraphOf(nb);
    if (sgA && sgB && (!same(sgA.inputPorts, sgB.inputPorts) || !same(sgA.outputPorts, sgB.outputPorts))) {
      other.push({ ...ref(fb), what: 'Group ports changed' }); touched = true;
    }
    if (!touched && !same({ ...na, params: undefined, position: undefined }, { ...nb, params: undefined, position: undefined })) {
      other.push({ ...ref(fb), what: 'Settings changed' }); touched = true;
    }
    if (touched) changed.add(key);
  }
  for (const [key, fa] of a) if (!b.has(key)) { removed.push(ref(fa)); changed.add(key); }
  const liveWires = wires;
  // What's inside a group that came or went with it is part of that group, not listed on its own
  const within = (key: string, outer: Set<string>) => {
    for (let i = key.lastIndexOf('/'); i > 0; i = key.lastIndexOf('/', i - 1)) if (outer.has(key.slice(0, i))) return true;
    return false;
  };
  const addedKeys = new Set(added.map(r => r.key)), removedKeys = new Set(removed.map(r => r.key));
  const addedOuter = added.filter(r => !within(r.key, addedKeys));
  const removedOuter = removed.filter(r => !within(r.key, removedKeys));

  const touchedTop = new Set<string>();
  for (const r of [...added, ...moved, ...other, ...params]) touchedTop.add(r.topId);
  for (const w of liveWires) touchedTop.add(w.toTopId);
  const topAfter = new Set(after.map(n => n.id));
  return {
    added: addedOuter, removed: removedOuter, params, wires: liveWires, moved, other,
    touchedTopIds: [...touchedTop].filter(id => topAfter.has(id)),
    changedCount: changed.size,
  };
}

const wireText = (w: WireChange) => `${w.fromName} → ${w.toName}`;

/** One line for a step that was pushed without a label. */
export function describeDiff(d: StepDiff): string {
  const { added, removed, params, wires, moved, other } = d;
  // Nodes inside a group that came or went with it aren't the headline
  const topAdded = added.filter(r => r.key === r.id), topRemoved = removed.filter(r => r.key === r.id);
  const ad = topAdded.length ? topAdded : added, rm = topRemoved.length ? topRemoved : removed;
  if (ad.length && !rm.length) return ad.length === 1 ? `Added ${ad[0].name}` : `Added ${ad.length} nodes`;
  if (rm.length && !ad.length) return rm.length === 1 ? `Removed ${rm[0].name}` : `Removed ${rm.length} nodes`;
  if (ad.length === 1 && rm.length === 1 && !params.length && !moved.length && !other.length) return `Replaced ${rm[0].name} with ${ad[0].name}`;
  if (ad.length || rm.length) return `Edited the graph · ${d.changedCount} nodes changed`;

  const onlyWires = wires.length > 0 && !params.length && !other.length && !moved.length;
  if (onlyWires) {
    const add = wires.filter(w => w.kind === 'added'), rem = wires.filter(w => w.kind === 'removed');
    if (add.length === 1 && rem.length <= 1) return `Connected ${wireText(add[0])}`;
    if (rem.length === 1 && !add.length) return `Disconnected ${wireText(rem[0])}`;
    if (!add.length) return `Disconnected ${rem.length} wires`;
    return `Rewired ${wires.length} connections`;
  }
  const paramNodes = new Set(params.map(p => p.key));
  if (params.length && !wires.length && !other.length && paramNodes.size === d.changedCount) {
    const nodes = paramNodes;
    if (params.length === 1) {
      const p = params[0];
      if (p.param === 'label') return `Renamed ${p.from ?? 'a node'} to ${p.to ?? ''}`.trim();
      if (p.fromColor) return `Changed ${p.label} on ${p.name}`;
      if (p.from !== null && p.to !== null) return `Changed ${p.label} ${p.from} → ${p.to}`;
      return `Edited ${p.label} on ${p.name}`;
    }
    if (nodes.size === 1) return `Changed ${params.length} settings on ${params[0].name}`;
    return `Changed settings on ${nodes.size} nodes`;
  }
  if (other.length === 1 && !params.length && !wires.length && d.changedCount === 1) {
    const o = other[0];
    if (o.what === 'Bypassed') return `Bypassed ${o.name}`;
    if (o.what === 'No longer bypassed') return `Turned ${o.name} back on`;
    if (o.what.startsWith('Became')) return `Swapped ${o.name}`;
    return `Edited ${o.name}`;
  }
  if (moved.length && !params.length && !wires.length && !other.length) return moved.length === 1 ? `Moved ${moved[0].name}` : `Moved ${moved.length} nodes`;
  if (d.changedCount === 0) return 'No visible change';
  return `Edited the graph · ${d.changedCount} ${d.changedCount === 1 ? 'node' : 'nodes'} changed`;
}

// ── Timeline (the History panel's Changes list) ───────────────────────────────

export interface TimelineStep {
  id: number;
  /** The step's own label, or one read from what it changed. */
  label: string;
  at: number;
  status: 'done' | 'current' | 'undone';
  before: GraphNode[];
  after: GraphNode[];
  nodeIds: string[];
  /** Undos that bring the graph back to just after this step (0 for the current one). */
  undoToHere: number;
  /** Redos that bring the graph forward to just after this step (0 unless undone). */
  redoToHere: number;
}

interface EntryLike { id: number; nodes: GraphNode[]; at: number; label?: string; nodeIds?: string[] }

/**
 * Every step the undo history holds, oldest first: the done ones (the last is where the graph is
 * now), then the undone ones in the order redo would replay them.
 */
export function buildTimeline(done: readonly EntryLike[], undone: readonly EntryLike[], current: GraphNode[]): TimelineStep[] {
  const out: TimelineStep[] = [];
  done.forEach((e, i) => {
    const after = done[i + 1]?.nodes ?? current;
    out.push({
      id: e.id, at: e.at, nodeIds: e.nodeIds ?? [], before: e.nodes, after,
      label: e.label ?? describeDiff(diffGraphs(e.nodes, after)),
      status: i === done.length - 1 ? 'current' : 'done',
      undoToHere: done.length - 1 - i, redoToHere: 0,
    });
  });
  for (let j = undone.length - 1; j >= 0; j--) {
    const e = undone[j];
    const before = j === undone.length - 1 ? current : undone[j + 1].nodes;
    out.push({
      id: e.id, at: e.at, nodeIds: e.nodeIds ?? [], before, after: e.nodes,
      label: e.label ?? describeDiff(diffGraphs(before, e.nodes)),
      status: 'undone', undoToHere: 0, redoToHere: undone.length - j,
    });
  }
  return out;
}
