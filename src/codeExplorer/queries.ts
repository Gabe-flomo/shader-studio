/**
 * queries.ts — what the Explorer asks of the index (docs/code-explorer-plan.md §5).
 *
 *   functionReport  a function → ranked patterns (L2) with their exact
 *                   variants (L1), merged patterns (L3) and real instances;
 *                   the chains it sits in, the producer → it → consumer flow,
 *                   statement kinds, and the functions used alongside it
 *   searchPatterns  plain words → patterns, BM25 with the synonym table
 *   summary         what is indexed, and the most-called functions
 *
 * Results carry raw shapes; names and phrases come from explain.ts.
 */
import type { CodeIndex, SiteRef } from './codeIndex';
import { mergeVariants, type MergedPattern } from './antiUnify';
import { explainPattern } from './explain';
import { matchesInLine, typesFromCode, type UseQuery } from '../lib/glslPatterns';
import { expandQuery } from './synonyms';
import { proseWords, splitIdentifier } from './words';
import type { DocRecord, Origin, Provenance, Site, SourceKind } from './types';

export interface QueryScope {
  /** Only docs from these places. */
  origins?: Origin[];
  /** Only this doc (the open graph). */
  docId?: string;
  /** Only these source kinds. */
  kinds?: SourceKind[];
}

export interface Instance {
  prov: Provenance;
  /** The statement's line, and the call's span in it. */
  text: string;
  hs: number;
  he: number;
  l1: string;
  group: string;
  lits: Array<number | null>;
  flip?: boolean;
}

export interface Count { key: string; count: number; lift?: number }

export interface LiteralSpread { arg: number; n: number; median: number; min: number; max: number }

export interface VariantCard { l1: string; count: number; docs: number; instances: Instance[] }

export interface PatternCard {
  callee: string;
  l2: string;
  count: number;
  docs: number;
  /** Instances per bucket (the report's `buckets`), for the sparkline. */
  spark: number[];
  variants: VariantCard[];
  /** L3: variants merged with holes (only merges of two or more variants). */
  merged: MergedPattern[];
  /** Written as `1.0 - call(…)`. */
  flipped: number;
  literals: LiteralSpread[];
  sample: string;
}

export interface FunctionReport {
  fn: string;
  calls: number;
  docs: number;
  buckets: string[];
  patterns: PatternCard[];
  /** Enclosing chains (`mix › smoothstep`); just the function = standalone. */
  chains: Count[];
  /** `producer → fn → consumer`. */
  flows: Count[];
  producers: Count[];
  consumers: Count[];
  statements: Count[];
  /** Functions called in the same statement. */
  sameLine: Count[];
  /** Functions called in the same node or function, with lift (P(a,b) / P(a)P(b)). */
  sameFn: Count[];
  /** Narrowed to statements that also call this. */
  withFn?: string;
}

export const MAX_INSTANCES = 60;

const inScope = (d: DocRecord, site: Site, s: QueryScope = {}) =>
  (!s.origins || s.origins.includes(d.origin)) && (!s.docId || d.docId === s.docId) && (!s.kinds || s.kinds.includes(d.sources[site.src]?.sourceKind));

export function provenanceOf(doc: DocRecord, site: Site): Provenance {
  const src = doc.sources[site.src];
  const p: Provenance = { sourceKind: src.sourceKind, origin: doc.origin, docId: doc.docId, docLabel: doc.label, field: site.field, line: site.line, column: site.col };
  if (src.nodeId) p.nodeId = src.nodeId;
  if (src.nodePath) p.nodePath = src.nodePath;
  if (src.nodeLabel) p.nodeLabel = src.nodeLabel;
  if (src.nodeType) p.nodeType = src.nodeType;
  return p;
}

export function instanceOf(r: SiteRef): Instance {
  const { doc, site } = r;
  const i: Instance = { prov: provenanceOf(doc, site), text: site.text, hs: site.hs, he: site.he, l1: site.l1, group: doc.group, lits: site.lits };
  if (site.flip) i.flip = true;
  return i;
}

const counts = (keys: Iterable<string>, limit = 12): Count[] => {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, limit);
};

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The sparkline buckets of an index: doc groups in the order they first appear. */
export function bucketsOf(index: CodeIndex): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of index.all()) if (!seen.has(d.group)) { seen.add(d.group); out.push(d.group); }
  return out;
}

/** Ranked patterns, chains, flow and co-occurrence for one function. */
export function functionReport(index: CodeIndex, fn: string, scope: QueryScope = {}, withFn?: string): FunctionReport {
  let refs = index.sitesOf(fn).filter(r => inScope(r.doc, r.site, scope));
  if (withFn) refs = refs.filter(r => r.site.same.includes(withFn));
  const buckets = bucketsOf(index);
  const bucketAt = new Map(buckets.map((b, i) => [b, i]));

  const byL2 = new Map<string, SiteRef[]>();
  for (const r of refs) { let l = byL2.get(r.site.l2); if (!l) byL2.set(r.site.l2, l = []); l.push(r); }

  const patterns: PatternCard[] = [...byL2].map(([l2, rs]) => {
    const byL1 = new Map<string, SiteRef[]>();
    for (const r of rs) { let l = byL1.get(r.site.l1); if (!l) byL1.set(r.site.l1, l = []); l.push(r); }
    const variants: VariantCard[] = [...byL1]
      .map(([l1, v]) => ({ l1, count: v.length, docs: new Set(v.map(x => x.doc.docId)).size, instances: v.slice(0, MAX_INSTANCES).map(instanceOf) }))
      .sort((a, b) => b.count - a.count || a.l1.localeCompare(b.l1));
    const spark = buckets.map(() => 0);
    for (const r of rs) spark[bucketAt.get(r.doc.group) ?? 0]++;
    const nArgs = Math.max(0, ...rs.map(r => r.site.lits.length));
    const literals: LiteralSpread[] = [];
    for (let a = 0; a < nArgs; a++) {
      const xs = rs.map(r => r.site.lits[a]).filter((x): x is number => typeof x === 'number');
      if (xs.length >= Math.max(2, rs.length / 2)) literals.push({ arg: a, n: xs.length, median: median(xs), min: Math.min(...xs), max: Math.max(...xs) });
    }
    return {
      callee: fn, l2, count: rs.length, docs: new Set(rs.map(r => r.doc.docId)).size, spark, variants,
      merged: mergeVariants(variants.map(v => ({ l1: v.l1, count: v.count }))).filter(m => m.variants.length > 1),
      flipped: rs.filter(r => r.site.flip).length,
      literals,
      sample: rs[0].site.text.slice(rs[0].site.hs, rs[0].site.he),
    };
  }).sort((a, b) => b.count - a.count || b.docs - a.docs || a.l2.localeCompare(b.l2));

  // Co-occurrence in the same node or function: containers = (doc, source, function).
  const containerKey = (d: DocRecord, s: Site) => `${d.docId}\u0000${s.src}\u0000${s.fn ?? ''}`;
  const containers = new Map<string, Set<string>>();
  const allContainers = new Map<string, Set<string>>();
  for (const d of index.all()) {
    for (const s of d.sites) {
      if (s.ctor || !inScope(d, s, scope)) continue;
      const k = containerKey(d, s);
      let set = allContainers.get(k); if (!set) allContainers.set(k, set = new Set()); set.add(s.callee);
    }
  }
  for (const r of refs) containers.set(containerKey(r.doc, r.site), allContainers.get(containerKey(r.doc, r.site)) ?? new Set());
  const nAll = allContainers.size || 1;
  const withCount = new Map<string, number>();
  for (const set of allContainers.values()) for (const c of set) withCount.set(c, (withCount.get(c) ?? 0) + 1);
  const pairs = new Map<string, number>();
  for (const set of containers.values()) for (const c of set) if (c !== fn) pairs.set(c, (pairs.get(c) ?? 0) + 1);
  const nFn = containers.size || 1;
  const sameFn: Count[] = [...pairs].map(([key, count]) => ({ key, count, lift: (count * nAll) / (nFn * (withCount.get(key) ?? 1)) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 16);

  return {
    fn,
    calls: refs.length,
    docs: new Set(refs.map(r => r.doc.docId)).size,
    buckets,
    patterns,
    chains: counts(refs.map(r => r.site.chain.join(' › '))),
    flows: counts(refs.map(r => `${r.site.prod} → ${fn} → ${r.site.cons}`)),
    producers: counts(refs.map(r => r.site.prod)),
    consumers: counts(refs.map(r => r.site.cons)),
    statements: counts(refs.map(r => r.site.sk)),
    sameLine: counts(refs.flatMap(r => r.site.same), 16),
    sameFn,
    ...(withFn ? { withFn } : {}),
  };
}

// ── Free text ──────────────────────────────────────────────────────────────

export interface SearchHit {
  callee: string;
  l2: string;
  count: number;
  docs: number;
  score: number;
  name?: string;
  phrase?: string;
  /** The query terms it matched (typed and from synonyms). */
  matched: string[];
  sample: Instance;
}

interface PatternDoc { callee: string; l2: string; refs: SiteRef[]; tf: Map<string, number>; len: number; name?: string; phrase?: string }

const docCache = new WeakMap<CodeIndex, { revision: number; key: string; docs: PatternDoc[]; df: Map<string, number>; avg: number }>();

function addTerms(tf: Map<string, number>, words: Iterable<string>, w = 1) { for (const x of words) tf.set(x, (tf.get(x) ?? 0) + w); }

/** One search document per (function, L2 pattern): its name and phrase, the functions in its shape, and the words around its instances. */
function patternDocs(index: CodeIndex, scope: QueryScope) {
  const key = JSON.stringify(scope);
  const hit = docCache.get(index);
  if (hit && hit.revision === index.revision && hit.key === key) return hit;
  const docs: PatternDoc[] = [];
  for (const [callee, all] of index.callees()) {
    const refs = all.filter(r => !r.site.ctor && inScope(r.doc, r.site, scope));
    if (!refs.length) continue;
    const byL2 = new Map<string, SiteRef[]>();
    for (const r of refs) { let l = byL2.get(r.site.l2); if (!l) byL2.set(r.site.l2, l = []); l.push(r); }
    for (const [l2, rs] of byL2) {
      const tf = new Map<string, number>();
      const s0 = rs[0].site;
      const info = explainPattern({ callee, l2, l1: s0.l1, sample: s0.text.slice(s0.hs, s0.he) });
      // The pattern itself counts most: its name, its phrase, the functions in its shape.
      addTerms(tf, splitIdentifier(callee), 3);
      for (const m of l2.matchAll(/[A-Za-z_]\w*/g)) addTerms(tf, splitIdentifier(m[0]), 2);
      if (info) {
        addTerms(tf, proseWords(info.name ?? ''), 4);
        addTerms(tf, (info.words ?? []).flatMap(w => proseWords(w)), 2);
        addTerms(tf, proseWords(info.phrase ?? ''), 0.5);
      }
      // The words around its instances (capped, so a pattern used everywhere doesn't win on volume alone).
      for (const r of rs.slice(0, 40)) {
        addTerms(tf, r.site.ids, 0.25);
        addTerms(tf, r.doc.sources[r.site.src]?.words ?? [], 0.25);
      }
      let len = 0;
      for (const v of tf.values()) len += v;
      docs.push({ callee, l2, refs: rs, tf, len, name: info?.name, phrase: info?.phrase });
    }
  }
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = docs.reduce((a, d) => a + d.len, 0) / (docs.length || 1);
  const out = { revision: index.revision, key, docs, df, avg };
  docCache.set(index, out);
  return out;
}

/** Plain words → patterns (BM25 over pattern documents; synonyms at half weight). */
export function searchPatterns(index: CodeIndex, text: string, scope: QueryScope = {}, limit = 20): SearchHit[] {
  const typed = [...new Set([
    ...proseWords(text),
    ...[...text.matchAll(/[A-Za-z_]\w*/g)].flatMap(m => splitIdentifier(m[0])),
  ])];
  if (!typed.length) return [];
  const extra = expandQuery(typed);
  const terms: Array<[string, number]> = [...typed.map(t => [t, 1] as [string, number]), ...extra.map(t => [t, 0.5] as [string, number])];
  const { docs, df, avg } = patternDocs(index, scope);
  const N = docs.length;
  const k1 = 1.2, b = 0.75;
  const hits: SearchHit[] = [];
  for (const d of docs) {
    let score = 0;
    const matched: string[] = [];
    for (const [t, w] of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += w * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg));
      matched.push(t);
    }
    if (score <= 0) continue;
    // Prefer patterns that are actually used, gently.
    score *= 1 + Math.log10(d.refs.length);
    hits.push({ callee: d.callee, l2: d.l2, count: d.refs.length, docs: new Set(d.refs.map(r => r.doc.docId)).size, score, name: d.name, phrase: d.phrase, matched, sample: instanceOf(d.refs[0]) });
  }
  return hits.sort((a, b2) => b2.score - a.score || b2.count - a.count).slice(0, limit);
}

// ── Find uses (the explainer's "Where else is this used?") ──────────────────

/**
 * The library's idiom or pattern match, run over the indexed statements (each distinct line
 * once), so "Where else is this used?" reaches saved graphs, presets, shaders, linked files
 * and presentations. The match's span is the instance's highlight.
 */
export function findIndexedUses(index: CodeIndex, query: UseQuery, scope: QueryScope = {}, limit = 200): Instance[] {
  const out: Instance[] = [];
  for (const d of index.all()) {
    const seen = new Set<string>();
    for (const s of d.sites) {
      if (!inScope(d, s, scope)) continue;
      const key = `${s.src}\u0000${s.field}\u0000${s.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let matches;
      try { matches = matchesInLine(s.text, query, typesFromCode(s.text)); } catch { continue; }
      for (const m of matches) {
        const inst = instanceOf({ doc: d, site: s });
        inst.hs = m.start; inst.he = m.end;
        out.push(inst);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

// ── Summary ────────────────────────────────────────────────────────────────

export interface IndexSummary {
  docs: number;
  sites: number;
  byOrigin: Partial<Record<Origin, number>>;
  byKind: Partial<Record<SourceKind, number>>;
  /** Most-called functions (constructors left out). */
  top: Count[];
  buckets: string[];
}

export function summarise(index: CodeIndex, scope: QueryScope = {}, limit = 24): IndexSummary {
  const byOrigin: IndexSummary['byOrigin'] = {};
  const byKind: IndexSummary['byKind'] = {};
  const fnCounts = new Map<string, number>();
  let docs = 0, sites = 0;
  for (const d of index.all()) {
    let any = false;
    for (const s of d.sites) {
      if (!inScope(d, s, scope)) continue;
      any = true; sites++;
      const k = d.sources[s.src]?.sourceKind;
      if (k) byKind[k] = (byKind[k] ?? 0) + 1;
      if (!s.ctor) fnCounts.set(s.callee, (fnCounts.get(s.callee) ?? 0) + 1);
    }
    if (any) { docs++; byOrigin[d.origin] = (byOrigin[d.origin] ?? 0) + 1; }
  }
  const top = [...fnCounts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, limit);
  return { docs, sites, byOrigin, byKind, top, buckets: bucketsOf(index) };
}

/** Function names in the index starting with (or containing) some text, most called first. */
export function suggestFunctions(index: CodeIndex, prefix: string, limit = 8): Count[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  const out: Count[] = [];
  for (const [callee, refs] of index.callees()) {
    const c = callee.toLowerCase();
    if (c.includes(p)) out.push({ key: callee, count: refs.length });
  }
  return out.sort((a, b) => Number(b.key.toLowerCase().startsWith(p)) - Number(a.key.toLowerCase().startsWith(p)) || b.count - a.count).slice(0, limit);
}
