/**
 * relevance.ts — what the node library should offer right now (docs/structure-hints.md).
 *
 *   1. Graph context: which flow the level being edited follows (2D picture, 3D scene, passes,
 *      agents). Inside a Scene / March Loop / Agents group it is that group's flow; elsewhere it is
 *      the graph's (structure/flow.ts). Categories that only make sense in 3D are "not for this graph"
 *      in the others (folded away, never removed).
 *   2. Fits here: given the selected node's (or the dragged wire's) output type, the nodes whose inputs
 *      accept it, ranked by how often they follow that node type in the bundled examples.
 *
 * Pure: graphs and definitions in, answers out. The example corpus is counted lazily and cached.
 */
import type { GraphNode, NodeDefinition } from '../types/nodeGraph';
import { toDataflow } from '../patterns/dataflow';
import { typesCompatible } from '../lib/typesCompatible';
import { FLOW_MARKERS, stageOfType, type FlowId } from './stages';
import { detectFlow } from './flow';

// ── Graph context ───────────────────────────────────────────────────────────

/** Categories whose nodes only work in a 3D scene. */
export const THREE_D_CATEGORIES: ReadonlySet<string> = new Set(['3D Primitives', '3D Boolean Ops', '3D Transforms', '3D Scene', '3D Lighting', '4D', '4D Shapes', '4D Space', '4D Projection']);

export interface LibraryContext {
  flow: FlowId;
  /** The container the level sits in that decided the flow ('sceneGroup', 'agentsGroup'…), or null when the graph decided. */
  inside: string | null;
}

const subNodes = (n: GraphNode): GraphNode[] | null => {
  const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
  return sg && Array.isArray(sg.nodes) ? sg.nodes : null;
};

/**
 * The flow the library should serve: the innermost container on `path` that marks a flow (a Scene
 * Group is 3D, an Agents group agents, a Pass passes), else the flow of the whole graph.
 */
export function libraryContext(topNodes: readonly GraphNode[], path: readonly string[] = []): LibraryContext {
  const chain: GraphNode[] = [];
  let level: readonly GraphNode[] = topNodes;
  for (const id of path) {
    const g = level.find(n => n.id === id);
    const sub = g && subNodes(g);
    if (!g || !sub) break;
    chain.push(g);
    level = sub;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const s = stageOfType(chain[i].type);
    if (s === 'any') continue;
    for (const f of ['agents', 'pass', '3d'] as const) if (FLOW_MARKERS[f].has(s)) return { flow: f, inside: chain[i].type };
  }
  return { flow: detectFlow(topNodes), inside: null };
}

/** Whether a category belongs in a graph of this flow. */
export function categoryFits(category: string, flow: FlowId): boolean {
  return flow === '3d' || !THREE_D_CATEGORIES.has(category);
}

/** The badge a search result carries when it does not fit the graph, or null. */
export function misfitBadge(category: string, flow: FlowId): string | null {
  return categoryFits(category, flow) ? null : '3D only';
}

/** Categories to list first in a flow (3D ones inside a 3D scene). */
export function categoryRank(category: string, flow: FlowId): number {
  return flow === '3d' && THREE_D_CATEGORIES.has(category) ? 0 : 1;
}

/** Split categories into those for this graph (the flow's own first) and those not. */
export function splitCategories(categories: readonly string[], flow: FlowId): { fit: string[]; other: string[] } {
  const fit = categories.filter(c => categoryFits(c, flow));
  const other = categories.filter(c => !categoryFits(c, flow));
  return { fit: [...fit].sort((a, b) => categoryRank(a, flow) - categoryRank(b, flow)), other };
}

// ── Fits here ────────────────────────────────────────────────────────────────

/** from type → to type → how many example wires go from one to the other. */
export type FollowCounts = Map<string, Map<string, number>>;

/** Count the wires between node types over a set of graphs (plain groups flattened, conversions collapsed). */
export function buildFollowCounts(graphs: ReadonlyArray<{ nodes: GraphNode[] }>, into: FollowCounts = new Map()): FollowCounts {
  for (const g of graphs) addGraph(g.nodes, into);
  return into;
}

export function addGraph(nodes: GraphNode[], into: FollowCounts): void {
  let df;
  try { df = toDataflow(nodes); } catch { return; }
  const typeOf = new Map(df.nodes.map(n => [n.uid, n.type]));
  for (const e of df.edges) {
    const a = typeOf.get(e.from), b = typeOf.get(e.to);
    if (!a || !b || a === b) continue;
    let row = into.get(a);
    if (!row) into.set(a, (row = new Map()));
    row.set(b, (row.get(b) ?? 0) + 1);
  }
}

let corpus: Promise<FollowCounts> | null = null;
/** The follow counts over the bundled examples: computed once (in slices, so the UI stays responsive) and cached. */
export function exampleFollowCounts(): Promise<FollowCounts> {
  if (!corpus) {
    corpus = (async () => {
      const { loadExampleGraphs } = await import('../store/exampleIndex');
      const all = Object.values(await loadExampleGraphs());
      const counts: FollowCounts = new Map();
      for (let i = 0; i < all.length; i += 12) {
        for (const g of all.slice(i, i + 12)) addGraph(g.nodes, counts);
        await new Promise(r => setTimeout(r, 0));
      }
      return counts;
    })().catch(() => { corpus = null; return new Map() as FollowCounts; });
  }
  return corpus;
}

/**
 * The nodes that fit after a `fromType` node whose output is `outType`: their inputs accept that
 * type, ranked by how often the examples wire them after it (never-seen ones are left out).
 */
export function rankFits(
  fromType: string, outType: string, defs: readonly NodeDefinition[], counts: FollowCounts, limit = 8, hidden: ReadonlySet<string> = new Set(),
): NodeDefinition[] {
  const row = counts.get(fromType);
  if (!row) return [];
  const out: Array<{ def: NodeDefinition; n: number }> = [];
  for (const def of defs) {
    const n = row.get(def.type);
    if (!n || hidden.has(def.type)) continue;
    if (!Object.values(def.inputs ?? {}).some(i => typesCompatible(outType, i.type))) continue;
    out.push({ def, n });
  }
  return out.sort((a, b) => b.n - a.n || a.def.label.localeCompare(b.def.label)).slice(0, limit).map(x => x.def);
}

/** The first output's type of a node type, if it has one. */
export function mainOutputType(def: NodeDefinition | undefined): string | null {
  const first = def && Object.values(def.outputs ?? {})[0];
  return first ? first.type : null;
}
