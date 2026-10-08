/**
 * patternIndex.ts — technique → graphs/nodes and graph → techniques (pattern discovery, step 3).
 *
 * A pure function over graphs, so it runs on the bundled examples, the user's saved graphs, Plays and
 * the open graph alike. Each graph's analysis is cached by a hash of its nodes: re-indexing after one
 * graph changed redoes that graph only.
 *
 * Queryable on purpose (a future "show graphs using wave interference", and Do-bar techniques): see
 * `graphsUsing`, `techniquesIn`, `techniquesAtNode` and `findTechniques`.
 */
import type { GraphNode } from '../types/nodeGraph';
import { toDataflow, viewOf, type DfNode } from './dataflow';
import { FAMILIES, TECHNIQUES, TECHNIQUE_BY_ID, type FamilyId, type Technique } from './catalogue';
import { hashText } from '../codeExplorer/extract';

export type GraphOrigin = 'example' | 'saved' | 'open';

export interface GraphInput {
  /** `example:<key>`, `saved:<name>`, `open:` (the same ids as the Code Explorer's docs). */
  id: string;
  label: string;
  origin: GraphOrigin;
  /** The Examples folder, or "Saved graphs". */
  folder?: string;
  nodes: readonly GraphNode[];
}

/** A node taking part in a hit, where the Studio can find it. */
export interface HitNode { id: string; path: string[]; type: string; /** The dataflow uid (dataflow.ts). */ uid: string }

export interface TechniqueHit {
  technique: string;
  variant: string;
  nodes: HitNode[];
  line?: string;
}

export interface GraphPatterns {
  graphId: string;
  label: string;
  origin: GraphOrigin;
  folder?: string;
  hash: string;
  hits: TechniqueHit[];
  /** Technique ids found, sorted. */
  techniques: string[];
}

export interface PatternIndex {
  graphs: GraphPatterns[];
  byGraph: Map<string, GraphPatterns>;
  /** technique id → the graphs using it, with their hits. */
  byTechnique: Map<string, Array<{ graph: GraphPatterns; hits: TechniqueHit[] }>>;
  ms: number;
}

const cache = new Map<string, GraphPatterns>();

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Find every technique in one graph. */
export function analyseGraph(g: GraphInput, techniques: readonly Technique[] = TECHNIQUES): GraphPatterns {
  const hash = hashText(JSON.stringify(g.nodes));
  const key = `${g.id}\u0001${hash}`;
  const hit = techniques === TECHNIQUES ? cache.get(key) : undefined;
  if (hit) return hit.label === g.label && hit.folder === g.folder ? hit : { ...hit, label: g.label, folder: g.folder };
  const v = viewOf(toDataflow(g.nodes));
  const toHitNode = (n: DfNode): HitNode => ({ id: n.id, path: n.path, type: n.type, uid: n.uid });
  const hits: TechniqueHit[] = [];
  for (const t of techniques) {
    for (const variant of t.variants) {
      let found;
      try { found = variant.match(v); } catch (e) { console.warn(`[patterns] ${t.id}/${variant.id}`, e); continue; }
      const seen = new Set<string>();
      for (const h of found) {
        const ns = [...new Set(h.nodes)].map(u => v.node(u)).filter((n): n is DfNode => !!n);
        if (!ns.length) continue;
        const k = ns.map(n => n.uid).sort().join(',');
        if (seen.has(k)) continue;
        seen.add(k);
        hits.push({ technique: t.id, variant: variant.id, nodes: ns.map(toHitNode), ...(h.line ? { line: h.line } : {}) });
      }
    }
  }
  const out: GraphPatterns = { graphId: g.id, label: g.label, origin: g.origin, folder: g.folder, hash, hits, techniques: [...new Set(hits.map(h => h.technique))].sort() };
  if (techniques === TECHNIQUES) {
    for (const k of cache.keys()) if (k.startsWith(`${g.id}\u0001`)) cache.delete(k);
    cache.set(key, out);
  }
  return out;
}

export function buildPatternIndex(graphs: readonly GraphInput[]): PatternIndex {
  const t0 = now();
  const list = graphs.map(g => analyseGraph(g));
  const byTechnique = new Map<string, Array<{ graph: GraphPatterns; hits: TechniqueHit[] }>>();
  for (const t of TECHNIQUES) byTechnique.set(t.id, []);
  for (const gp of list) {
    const per = new Map<string, TechniqueHit[]>();
    for (const h of gp.hits) per.set(h.technique, [...(per.get(h.technique) ?? []), h]);
    for (const [tid, hs] of per) byTechnique.get(tid)!.push({ graph: gp, hits: hs });
  }
  return { graphs: list, byGraph: new Map(list.map(g => [g.graphId, g])), byTechnique, ms: now() - t0 };
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Graphs using a technique (or any technique of a family), optionally one variant. */
export function graphsUsing(ix: PatternIndex, what: { technique?: string; family?: FamilyId; variant?: string }): GraphPatterns[] {
  const ids = what.technique ? [what.technique] : TECHNIQUES.filter(t => t.family === what.family).map(t => t.id);
  const out = new Map<string, GraphPatterns>();
  for (const id of ids) for (const e of ix.byTechnique.get(id) ?? []) {
    if (what.variant && !e.hits.some(h => h.variant === what.variant)) continue;
    out.set(e.graph.graphId, e.graph);
  }
  return [...out.values()];
}

/** The techniques a graph uses, with their hits. */
export function techniquesIn(gp: GraphPatterns): Array<{ technique: Technique; hits: TechniqueHit[] }> {
  return gp.techniques.map(id => ({ technique: TECHNIQUE_BY_ID.get(id)!, hits: gp.hits.filter(h => h.technique === id) }));
}

/** The techniques a node takes part in ("Patterns this is part of"). */
export function techniquesAtNode(gp: GraphPatterns, nodeId: string): Array<{ technique: Technique; hits: TechniqueHit[] }> {
  return techniquesIn(gp).map(x => ({ ...x, hits: x.hits.filter(h => h.nodes.some(n => n.id === nodeId || n.path.includes(nodeId))) })).filter(x => x.hits.length);
}

/** Techniques whose name, family or words contain the query's words ("wave interference"). */
export function findTechniques(query: string): Technique[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const famName = new Map(FAMILIES.map(f => [f.id, `${f.name} ${f.ways}`.toLowerCase()]));
  return TECHNIQUES.map(t => {
    const hay = [t.name, t.explain, famName.get(t.family) ?? '', ...(t.words ?? [])].join(' ').toLowerCase();
    return { t, score: words.filter(w => hay.includes(w)).length };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.t);
}

/** Per family: techniques with graph counts (for the UI and the report). */
export function familySummary(ix: PatternIndex) {
  return FAMILIES.map(f => {
    const ts = TECHNIQUES.filter(t => t.family === f.id).map(t => {
      const users = ix.byTechnique.get(t.id) ?? [];
      const variants = t.variants.map(v => ({ variant: v, graphs: users.filter(u => u.hits.some(h => h.variant === v.id)).length }));
      return { technique: t, graphs: users.length, variants };
    });
    return { family: f, techniques: ts, graphs: new Set(ts.flatMap(t => (ix.byTechnique.get(t.technique.id) ?? []).map(u => u.graph.graphId))).size };
  });
}
