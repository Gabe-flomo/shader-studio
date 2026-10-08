/**
 * dataflow.ts — a graph as typed dataflow, the form pattern discovery reads (docs/reports/pattern-discovery.md).
 *
 *   - Plain groups are flattened (lang/graphFlat.ts): their members join the level, wires go straight through.
 *   - Every other container (Scene Group, March Loop Group, Agents…) stays one node, and its insides are
 *     read as their own level, each inner node remembering the container it sits in (`container`).
 *   - Conversion nodes (Split / Make vectors, Float → Color) are collapsed: their sources wire straight on.
 *   - Expression Blocks and Custom Functions carry their GLSL, a line at a time, with the idioms
 *     (lib/glslPatterns) each line contains, so matchers can read code and wires alike.
 *
 * Pure: graph in, dataflow out. Node `uid`s are unique per graph (container path + id); `id` + `path`
 * say where to find the node in the Studio (the group path, top level first).
 */
import type { GraphNode } from '../types/nodeGraph';
import { flattenGraph, subgraphOf, isPlainGroup } from '../lang/graphFlat';
import { codeLines } from '../lib/glslPatterns/findUses';
import { parseLine } from '../lib/glslPatterns/parse';
import { explainTree } from '../lib/glslPatterns/explain';
import type { GlslType } from '../lib/glslPatterns/ast';
import type { TypeEnv } from '../lib/glslPatterns/types';
import { stageOfType } from '../structure/stages';
import type { StageOf } from '../structure/stages';

export interface CodeLine {
  /** The line as written (`float g = exp(-d * 4.0)`, `return col`). */
  text: string;
  /** Ids of the glslPatterns idioms found in it. */
  idioms: string[];
}

export interface DfNode {
  /** Unique within the dataflow: the container path and the node id. */
  uid: string;
  id: string;
  type: string;
  /** Group path in the Studio (plain groups and containers), top level first; the node's own id not included. */
  path: string[];
  /** The uid of the container whose insides this node is (not plain groups), or null at the top level. */
  container: string | null;
  params: Record<string, unknown>;
  stage: StageOf;
  /** A label the user gave it, if any. */
  label?: string;
  /** Written GLSL (Expression Blocks, Custom Functions, input expressions), a line at a time. */
  code?: CodeLine[];
}

export interface DfEdge { from: string; out: string; to: string; in: string; type: string }

/** A plain group run more than once (Iterated Groups): its members, flattened, as uids. */
export interface DfLoop { uid: string; iterations: number; members: string[] }

export interface Dataflow {
  nodes: DfNode[];
  edges: DfEdge[];
  loops: DfLoop[];
}

/** Nodes that only change a value's shape: collapsed, their sources wired straight on. */
export const CONVERSION_TYPES: ReadonlySet<string> = new Set(['splitVec2', 'splitVec3', 'splitVec4', 'makeVec2', 'makeVec3', 'makeVec4', 'floatToVec3', 'vec3ToFloat', 'swizzle']);

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function idiomsOf(text: string, env: TypeEnv): string[] {
  const r = parseLine(text);
  if (!r.ok) return [];
  try {
    const types = { ...env, ...(r.line.declType && r.line.target ? { [r.line.target]: r.line.declType as GlslType } : {}) };
    const ex = explainTree(r.line.expr, text, { types });
    return [...new Set(ex.idioms.map(h => h.idiom.id))].sort();
  } catch { return []; }
}

function codeOf(nd: GraphNode): CodeLine[] | undefined {
  const out: CodeLine[] = [];
  if (nd.type === 'exprNode' || nd.type === 'customFn') {
    for (const c of codeLines([{ ...nd, params: { ...nd.params, subgraph: undefined } }])) {
      const text = c.text.replace(/\s+/g, ' ').trim();
      if (text) out.push({ text, idioms: idiomsOf(text, c.env) });
    }
  }
  for (const [k, v] of Object.entries(nd.params ?? {})) {
    if (k.startsWith('__inExpr_') && typeof v === 'string' && v.trim()) out.push({ text: v.trim(), idioms: idiomsOf(v.trim(), {}) });
  }
  return out.length ? out : undefined;
}

/** Group path of every node inside plain groups and containers, by node id, for one level. */
function pathsOf(level: GraphNode[], base: string[], into: Map<string, string[]>) {
  for (const nd of level) {
    into.set(nd.id, base);
    if (isPlainGroup(nd)) pathsOf(subgraphOf(nd)!.nodes, [...base, nd.id], into);
  }
}

export function toDataflow(top: readonly GraphNode[]): Dataflow {
  const nodes: DfNode[] = [];
  const edges: DfEdge[] = [];
  const loops: DfLoop[] = [];
  const readLevel = (level: GraphNode[], base: string[], container: string | null) => {
    const prefix = base.length ? `${base.join('/')}/` : '';
    const uid = (id: string) => `${prefix}${id}`;
    const flat = flattenGraph(level);
    const paths = new Map<string, string[]>();
    pathsOf(level, base, paths);
    const byId = new Map(flat.nodes.map(n => [n.id, n]));
    for (const nd of flat.nodes) {
      nodes.push({
        uid: uid(nd.id), id: nd.id, type: nd.type, path: paths.get(nd.id) ?? base, container, params: nd.params ?? {},
        stage: stageOfType(nd.type), label: str(nd.params?.label)?.trim() || undefined, code: codeOf(nd),
      });
    }
    for (const w of flat.wires) {
      const src = byId.get(w.from);
      const type = src?.outputs?.[w.out]?.type ?? byId.get(w.to)?.inputs?.[w.in]?.type ?? 'float';
      edges.push({ from: uid(w.from), out: w.out, to: uid(w.to), in: w.in, type });
    }
    for (const g of flat.groups) {
      const it = Number(g.params.iterations ?? 1);
      if (it > 1) loops.push({ uid: uid(g.id), iterations: it, members: g.members.map(uid) });
    }
    // Containers: their insides are a level of their own.
    for (const nd of flat.nodes) {
      const sg = subgraphOf(nd);
      if (sg && !isPlainGroup(nd)) readLevel(sg.nodes, [...(paths.get(nd.id) ?? base), nd.id], uid(nd.id));
    }
  };
  readLevel(top as GraphNode[], [], null);
  return collapseConversions({ nodes, edges, loops });
}

/** Drop conversion nodes, wiring each source straight to each consumer (the consumer's port and type kept). */
export function collapseConversions(df: Dataflow): Dataflow {
  const drop = new Set(df.nodes.filter(n => CONVERSION_TYPES.has(n.type)).map(n => n.uid));
  if (!drop.size) return df;
  const into = new Map<string, DfEdge[]>();
  for (const e of df.edges) if (drop.has(e.to)) into.set(e.to, [...(into.get(e.to) ?? []), e]);
  // The real sources behind a dropped node (through chains of them).
  const sources = (uid: string, depth = 0): DfEdge[] => {
    if (depth > 6) return [];
    return (into.get(uid) ?? []).flatMap(e => (drop.has(e.from) ? sources(e.from, depth + 1) : [e]));
  };
  const edges: DfEdge[] = [];
  const seen = new Set<string>();
  for (const e of df.edges) {
    if (drop.has(e.to)) continue;
    const list = drop.has(e.from) ? sources(e.from).map(s => ({ from: s.from, out: s.out, to: e.to, in: e.in, type: e.type })) : [e];
    for (const x of list) {
      const k = `${x.from}.${x.out}>${x.to}.${x.in}`;
      if (!seen.has(k)) { seen.add(k); edges.push(x); }
    }
  }
  return { nodes: df.nodes.filter(n => !drop.has(n.uid)), edges, loops: df.loops.map(l => ({ ...l, members: l.members.filter(m => !drop.has(m)) })) };
}

/** Lookups over a dataflow, built once per graph for the matchers. */
export interface DfView {
  df: Dataflow;
  node(uid: string): DfNode | undefined;
  /** Wires into / out of a node. */
  ins(uid: string): DfEdge[];
  outs(uid: string): DfEdge[];
  ofType(...types: string[]): DfNode[];
  /** Nodes upstream of `uid` within `depth` wires (not including it). */
  upstream(uid: string, depth?: number): DfNode[];
  downstream(uid: string, depth?: number): DfNode[];
  /** Nodes inside a container (any depth). */
  inside(containerUid: string): DfNode[];
  codeNodes: DfNode[];
}

export function viewOf(df: Dataflow): DfView {
  const byUid = new Map(df.nodes.map(n => [n.uid, n]));
  const ins = new Map<string, DfEdge[]>(), outs = new Map<string, DfEdge[]>();
  for (const e of df.edges) {
    ins.set(e.to, [...(ins.get(e.to) ?? []), e]);
    outs.set(e.from, [...(outs.get(e.from) ?? []), e]);
  }
  const byType = new Map<string, DfNode[]>();
  for (const n of df.nodes) byType.set(n.type, [...(byType.get(n.type) ?? []), n]);
  const walk = (start: string, depth: number, next: (u: string) => string[]) => {
    const seen = new Set<string>([start]);
    let frontier = [start];
    const out: DfNode[] = [];
    for (let d = 0; d < depth && frontier.length; d++) {
      const nf: string[] = [];
      for (const u of frontier) for (const v of next(u)) if (!seen.has(v)) { seen.add(v); nf.push(v); const n = byUid.get(v); if (n) out.push(n); }
      frontier = nf;
    }
    return out;
  };
  const insideCache = new Map<string, DfNode[]>();
  return {
    df,
    node: u => byUid.get(u),
    ins: u => ins.get(u) ?? [],
    outs: u => outs.get(u) ?? [],
    ofType: (...types) => types.flatMap(t => byType.get(t) ?? []),
    upstream: (u, depth = 3) => walk(u, depth, x => (ins.get(x) ?? []).map(e => e.from)),
    downstream: (u, depth = 3) => walk(u, depth, x => (outs.get(x) ?? []).map(e => e.to)),
    inside: c => {
      let hit = insideCache.get(c);
      if (!hit) {
        hit = df.nodes.filter(n => { let k = n.container; while (k) { if (k === c) return true; k = byUid.get(k)?.container ?? null; } return false; });
        insideCache.set(c, hit);
      }
      return hit;
    },
    codeNodes: df.nodes.filter(n => n.code?.length),
  };
}
