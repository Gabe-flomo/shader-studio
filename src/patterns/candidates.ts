/**
 * candidates.ts — mined frequent subgraphs the catalogue doesn't name yet (pattern discovery).
 *
 * A mined pattern is "covered" in an embedding when every node of the embedding is part of some named
 * technique's hit in that graph. Patterns covered in most of their embeddings are already named; the
 * rest, ranked by support × size, are candidates for the user to name.
 */
import type { MinedPattern } from './mine';
import type { PatternIndex } from './patternIndex';

export interface Candidate extends MinedPattern {
  /** Share of embeddings whose nodes are all inside named techniques' hits. */
  covered: number;
  /** Graph ids, the first few, for examples. */
  graphs: string[];
  /** Smaller or overlapping mined patterns folded into this one (same cluster). */
  alike: number;
}

/** Share of types in common (multisets). */
function typeOverlap(a: string[], b: string[]): number {
  const left = [...b];
  let k = 0;
  for (const t of a) { const i = left.indexOf(t); if (i >= 0) { k++; left.splice(i, 1); } }
  return k / Math.max(1, Math.min(a.length, b.length));
}

export function rankCandidates(mined: readonly MinedPattern[], ix: PatternIndex, opts: { maxCovered?: number; limit?: number; closedOnly?: boolean } = {}): Candidate[] {
  const maxCovered = opts.maxCovered ?? 0.5;
  const named = new Map<string, Set<string>>();
  for (const g of ix.graphs) named.set(g.graphId, new Set(g.hits.flatMap(h => h.nodes.map(n => n.uid))));
  const out: Candidate[] = [];
  for (const p of mined) {
    if (opts.closedOnly !== false && !p.closed) continue;
    const cov = p.embeddings.filter(e => { const s = named.get(e.graphId); return !!s && e.nodes.every(u => s.has(u)); }).length / Math.max(1, p.embeddings.length);
    if (cov > maxCovered) continue;
    out.push({ ...p, covered: cov, graphs: [...new Set(p.embeddings.map(e => e.graphId))], alike: 0 });
  }
  out.sort((a, b) => b.support * b.size - a.support * a.size || (a.key < b.key ? -1 : 1));
  // One per cluster: a pattern seen in the same graphs as a chosen one, with mostly the same nodes, folds into it.
  const chosen: Candidate[] = [];
  for (const c of out) {
    const home = chosen.find(d => typeOverlap(c.types, d.types) >= 0.6 && c.graphs.filter(g => d.graphs.includes(g)).length >= 0.7 * c.graphs.length);
    if (home) { home.alike++; continue; }
    chosen.push(c);
    if (chosen.length >= (opts.limit ?? 40)) break;
  }
  return chosen;
}
