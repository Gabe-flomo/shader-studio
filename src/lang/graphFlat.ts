/**
 * graphFlat.ts — a graph seen without its plain groups, for printing it as Do… bar lines
 * (fromGraph.ts) and for comparing two graphs (the language pressure test).
 *
 * The Do… bar edits one level: it makes nodes and wires at the top and folds them into a group
 * with `group(…)`. So a plain Group (type `group`) is read as its members, wired straight through
 * its ports, plus a note of which nodes it holds. Every other container (Scene Group, March Loop
 * Group, Agents group…) stays one node: the bar can make it but can't open it, so its insides are
 * compared as a whole.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';

export interface FlatWire { from: string; out: string; to: string; in: string }

export interface FlatGroup {
  /** The group node's id. */
  id: string;
  label: string | null;
  /** The members, by id (nested plain groups appear as their own FlatGroup, not here). */
  members: string[];
  /** Nested plain groups inside this one. */
  groups: string[];
  /** The group node's own params (iterations, carry…), without its subgraph. */
  params: Record<string, unknown>;
  /** The plain group this one sits in, if any. */
  parent: string | null;
}

export interface FlatGraph {
  /** Every node outside plain groups and every plain group's members (containers stay whole). */
  nodes: GraphNode[];
  wires: FlatWire[];
  /** Plain groups, innermost first. */
  groups: FlatGroup[];
}

export const subgraphOf = (nd: GraphNode): SubgraphData | null => {
  const sg = nd.params?.subgraph as SubgraphData | undefined;
  return sg && Array.isArray(sg.nodes) ? sg : null;
};

/** A plain Group (the one `group(…)` makes); every other container stays one node. */
export const isPlainGroup = (nd: GraphNode) => nd.type === 'group' && !!subgraphOf(nd);

/**
 * Flatten plain groups: their members join the level and every wire through a port is resolved
 * to the node that really feeds it. Wires into a port nothing feeds are dropped (as the compiler
 * reads them: unwired).
 */
export function flattenGraph(top: GraphNode[]): FlatGraph {
  const nodes: GraphNode[] = [];
  const groups: FlatGroup[] = [];
  const wires: FlatWire[] = [];
  // Where an output really comes from: a group's output port → its inner source (recursively).
  const groupById = new Map<string, GraphNode>();
  const collect = (level: GraphNode[]) => {
    for (const nd of level) {
      if (isPlainGroup(nd)) { groupById.set(nd.id, nd); collect(subgraphOf(nd)!.nodes); }
    }
  };
  collect(top);
  const resolveOut = (id: string, out: string, depth = 0): { id: string; out: string } | null => {
    const g = groupById.get(id);
    if (!g || depth > 8) return { id, out };
    const p = subgraphOf(g)!.outputPorts?.find(x => x.key === out);
    if (!p) return null;
    return resolveOut(p.fromNodeId, p.fromOutputKey, depth + 1);
  };
  /**
   * The source of input `key` on `nd`, inside `owner` (the plain group whose level holds nd; null
   * at the top). A port wire goes up to the group's own input, and on outward.
   */
  const resolveIn = (nd: GraphNode, key: string, owner: GraphNode | null, ownerOf: Map<string, GraphNode | null>, depth = 0): { id: string; out: string } | null => {
    const c = nd.inputs?.[key]?.connection;
    const sg = owner ? subgraphOf(owner) : null;
    let portKey: string | null = null;
    if (c && c.nodeId === GROUP_PORT_SENTINEL) portKey = c.outputKey;
    else if (!c && sg) portKey = sg.inputPorts?.find(p => p.toNodeId === nd.id && p.toInputKey === key)?.key ?? null;
    if (portKey !== null) {
      if (!owner || depth > 8) return null;
      return resolveIn(owner, portKey, ownerOf.get(owner.id) ?? null, ownerOf, depth + 1);
    }
    if (!c) return null;
    return resolveOut(c.nodeId, c.outputKey);
  };
  const ownerOf = new Map<string, GraphNode | null>();
  const visit = (level: GraphNode[], owner: GraphNode | null) => {
    for (const nd of level) {
      ownerOf.set(nd.id, owner);
      if (isPlainGroup(nd)) visit(subgraphOf(nd)!.nodes, nd);
    }
  };
  visit(top, null);
  const walk = (level: GraphNode[], owner: GraphNode | null) => {
    for (const nd of level) {
      if (isPlainGroup(nd)) {
        walk(subgraphOf(nd)!.nodes, nd);
        const inner = subgraphOf(nd)!.nodes;
        const { subgraph: _s, ...params } = nd.params;
        void _s;
        groups.push({
          id: nd.id, label: typeof nd.params.label === 'string' ? nd.params.label : null,
          members: inner.filter(x => !isPlainGroup(x)).map(x => x.id), groups: inner.filter(isPlainGroup).map(x => x.id),
          params, parent: owner?.id ?? null,
        });
        continue;
      }
      nodes.push(nd);
      for (const key of Object.keys(nd.inputs ?? {})) {
        const src = resolveIn(nd, key, owner, ownerOf);
        if (src) wires.push({ from: src.id, out: src.out, to: nd.id, in: key });
      }
    }
  };
  walk(top, null);
  const ids = new Set(nodes.map(nd => nd.id));
  return { nodes, wires: wires.filter(w => ids.has(w.from)), groups };
}

// ── Digest (a container's insides, compared as a whole) ─────────────────────

const DIGEST_SKIP = new Set(['__comment', 'subgraph', '_groupOriginal', '_schemaVersion', '_sbBuild']);

function norm(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : String(v);
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !DIGEST_SKIP.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]));
  return v;
}

/** One line per node (type, settings, what feeds each input, named by structure), sorted; containers include their insides. */
export function levelDigest(nodes: GraphNode[], depth = 0): string[] {
  return [...digestById(nodes, depth).values()].sort();
}

/**
 * Pair the nodes of two levels that read the same (same digest line), recursing into paired
 * containers: inner ids of a container the bar rebuilt, matched to the original's.
 */
export function pairInside(a: GraphNode[], b: GraphNode[], out = new Map<string, string>(), depth = 0): Map<string, string> {
  const da = digestById(a), db = digestById(b);
  const free = new Map<string, string[]>();
  for (const [id, line] of db) free.set(line, [...(free.get(line) ?? []), id]);
  for (const [id, line] of da) {
    const list = free.get(line);
    if (!list?.length) continue;
    const other = list.shift()!;
    out.set(id, other);
    const na = a.find(x => x.id === id), nb = b.find(x => x.id === other);
    const sa = na ? subgraphOf(na) : null, sb = nb ? subgraphOf(nb) : null;
    if (sa && sb && depth < 4) pairInside(sa.nodes, sb.nodes, out, depth + 1);
  }
  // What differs: by type, in order.
  const taken = new Set(out.values());
  for (const na of a) {
    if (out.has(na.id)) continue;
    const nb = b.find(x => x.type === na.type && !taken.has(x.id));
    if (!nb) continue;
    taken.add(nb.id);
    out.set(na.id, nb.id);
    const sa = subgraphOf(na), sb = subgraphOf(nb);
    if (sa && sb && depth < 4) pairInside(sa.nodes, sb.nodes, out, depth + 1);
  }
  return out;
}

function digestById(nodes: GraphNode[], depth = 0): Map<string, string> {
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  const own = new Map(nodes.map(nd => {
    const sg = subgraphOf(nd);
    const inner = sg && depth < 4 ? ` {${levelDigest(sg.nodes, depth + 1).join('; ')}}` : '';
    return [nd.id, `${nd.type} ${JSON.stringify(norm(nd.params ?? {}))}${inner}`];
  }));
  let names = new Map(own);
  for (let round = 0; round < 3; round++) {
    const next = new Map<string, string>();
    for (const nd of nodes) {
      const ins = Object.entries(nd.inputs ?? {}).filter(([, i]) => i.connection).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, i]) => `${k}:${i.connection!.nodeId === GROUP_PORT_SENTINEL ? `port.${i.connection!.outputKey}` : byId.has(i.connection!.nodeId) ? `[${names.get(i.connection!.nodeId)}]` : '?'}.${i.connection!.outputKey}`);
      next.set(nd.id, `${own.get(nd.id)}${ins.length ? ` ← ${ins.join(' ')}` : ''}`);
    }
    names = next;
  }
  return names;
}

/** How many of `a`'s digest lines `b` also has (a multiset match). */
export function digestOverlap(a: string[], b: string[]): number {
  const left = new Map<string, number>();
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
  let k = 0;
  for (const x of a) { const c = left.get(x) ?? 0; if (c > 0) { k++; left.set(x, c - 1); } }
  return k;
}
