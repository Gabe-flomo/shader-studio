/**
 * graphDigest.ts — a graph level in a form two runs can be compared by (the language goldens,
 * docs/playfield-language-plan.md §11): every node as its type, its settings (numbers rounded,
 * comments and positions left out) and what feeds each input, named by structure rather than by
 * id. Two runs that make the same nodes and wires in a different order, or with other ids, give
 * the same digest.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { GRID_DEFAULTS } from '../../gridRules/spec';

const SKIP = new Set(['__comment', 'subgraph']);

function norm(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : String(v);
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SKIP.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]));
  return v;
}

/** One line per node, sorted: `type {params} ← key:<feeder>.out …`, where a feeder is named by its own line (three rounds deep). */
export function graphDigest(nodes: GraphNode[]): string[] {
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  // A Grid Rules node reads its params over GRID_DEFAULTS: the same rule whether a key is stored or defaulted.
  const params = (nd: GraphNode) => (nd.type === 'gridRules' ? { ...GRID_DEFAULTS, ...nd.params } : nd.params ?? {});
  const own = new Map(nodes.map(nd => [nd.id, `${nd.type} ${JSON.stringify(norm(params(nd)))}`]));
  let names = new Map(own);
  for (let round = 0; round < 3; round++) {
    const next = new Map<string, string>();
    for (const nd of nodes) {
      const ins = Object.entries(nd.inputs ?? {}).filter(([, i]) => i.connection).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, i]) => `${k}:${byId.has(i.connection!.nodeId) ? `[${names.get(i.connection!.nodeId)}]` : '?'}.${i.connection!.outputKey}`);
      next.set(nd.id, `${own.get(nd.id)}${ins.length ? ` ← ${ins.join(' ')}` : ''}`);
    }
    names = next;
  }
  return nodes.map(nd => names.get(nd.id)!).sort();
}
