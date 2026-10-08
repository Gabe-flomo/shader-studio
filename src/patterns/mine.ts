/**
 * mine.ts — frequent connected subgraphs across many dataflows (pattern discovery, step 1).
 *
 * Level-wise growth (Apriori-style): start from single node types seen in ≥ minSupport graphs, grow each
 * embedding by one neighbouring node (wires read both ways for connectivity), label the induced subgraph
 * canonically, count the graphs it appears in, keep the frequent ones, repeat up to `maxSize` nodes.
 *
 * Node labels are node types; edge labels are `outPort>inPort`. The canonical label is exact for these
 * small sizes: colour refinement first, then every ordering within tied colours (capped), smallest string wins.
 *
 * Trivial nodes (UV, Time, constants, Output…) are left out of the mining graph, so UV → X and X → Output
 * never count as patterns. Deterministic: graphs, nodes and neighbours are visited in sorted order and caps
 * cut sorted lists.
 */
import type { Dataflow } from './dataflow';

/** Sources and sinks every graph has: never part of a mined pattern. */
export const TRIVIAL_TYPES: ReadonlySet<string> = new Set([
  'output', 'vec4Output', 'uv', 'time', 'constant', 'constants', 'resolution', 'fragCoord', 'mouse', 'colorPicker', 'vec2Const',
  'marchLoopInputs', 'marchLoopOutput', 'agentInputs', 'agentOutput', 'sceneOutput', 'loopIndex', 'scenePos',
]);

export interface MineInput { graphId: string; df: Dataflow }

export interface Embedding { graphId: string; nodes: string[] }

export interface MinedPattern {
  /** Canonical label: the pattern's identity. */
  key: string;
  size: number;
  /** Node types, in canonical order. */
  types: string[];
  /** Wires as [fromIndex, toIndex, 'out>in'] over `types`. */
  wires: Array<[number, number, string]>;
  /** Graphs it appears in. */
  support: number;
  /** Embeddings found (capped per graph). */
  count: number;
  /** Where: per graph, the node uids (capped). */
  embeddings: Embedding[];
  /** No one-node-larger pattern has the same support. */
  closed: boolean;
  /** One line: `circleSDF -distance>distance-> light`. */
  text: string;
}

export interface MineOptions {
  minSupport?: number;
  maxSize?: number;
  minSize?: number;
  /** Embeddings kept per pattern per graph. */
  perGraphCap?: number;
  /** Patterns kept per level (by support). */
  levelCap?: number;
  trivial?: ReadonlySet<string>;
}

type LevelPattern = MinedPattern & { byGraph: Map<string, string[][]> };
type Level = Map<string, LevelPattern>;

interface G { id: string; types: Map<string, string>; adj: Map<string, string[]>; wires: Map<string, Array<[string, string]>> }

function prepare(inputs: MineInput[], trivial: ReadonlySet<string>): G[] {
  return [...inputs].sort((a, b) => (a.graphId < b.graphId ? -1 : a.graphId > b.graphId ? 1 : 0)).map(({ graphId, df }) => {
    const types = new Map(df.nodes.filter(n => !trivial.has(n.type)).map(n => [n.uid, n.type]));
    const adj = new Map<string, Set<string>>();
    const wires = new Map<string, Array<[string, string]>>();
    for (const e of df.edges) {
      if (!types.has(e.from) || !types.has(e.to) || e.from === e.to) continue;
      adj.set(e.from, (adj.get(e.from) ?? new Set()).add(e.to));
      adj.set(e.to, (adj.get(e.to) ?? new Set()).add(e.from));
      wires.set(e.from, [...(wires.get(e.from) ?? []), [e.to, `${e.out}>${e.in}`]]);
    }
    const sorted = new Map([...adj].map(([k, v]) => [k, [...v].sort()]));
    return { id: graphId, types, adj: sorted, wires };
  });
}

/** Canonical label of the induced subgraph on `set` (≤ ~7 nodes). */
export function canonical(set: string[], typeOf: (u: string) => string, wiresOf: (u: string) => Array<[string, string]>): { key: string; order: string[]; wires: Array<[number, number, string]> } {
  const inSet = new Set(set);
  const local: Array<[string, string, string]> = [];
  for (const u of set) for (const [v, l] of wiresOf(u)) if (inSet.has(v)) local.push([u, v, l]);
  // Colour refinement.
  let colour = new Map(set.map(u => [u, typeOf(u)]));
  for (let r = 0; r < 3; r++) {
    const next = new Map<string, string>();
    for (const u of set) {
      const o = local.filter(w => w[0] === u).map(w => `>${w[2]}:${colour.get(w[1])}`).sort();
      const i = local.filter(w => w[1] === u).map(w => `<${w[2]}:${colour.get(w[0])}`).sort();
      next.set(u, `${colour.get(u)}(${o.join(',')}|${i.join(',')})`);
    }
    colour = next;
  }
  const classes = new Map<string, string[]>();
  for (const u of [...set].sort()) classes.set(colour.get(u)!, [...(classes.get(colour.get(u)!) ?? []), u]);
  const ordered = [...classes.keys()].sort().map(k => classes.get(k)!);
  const perms = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p])));
  let orders: string[][] = [[]];
  for (const cls of ordered) {
    const ps = perms(cls);
    const next: string[][] = [];
    for (const o of orders) for (const p of ps) { next.push([...o, ...p]); if (next.length > 720) break; }
    orders = next.slice(0, 720);
  }
  let best: { key: string; order: string[]; wires: Array<[number, number, string]> } | null = null;
  for (const order of orders) {
    const idx = new Map(order.map((u, i) => [u, i]));
    const ws = local.map(([a, b, l]) => [idx.get(a)!, idx.get(b)!, l] as [number, number, string]).sort((x, y) => x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0));
    const key = `${order.map(typeOf).join(',')}|${ws.map(w => `${w[0]}-${w[2]}-${w[1]}`).join(',')}`;
    if (!best || key < best.key) best = { key, order, wires: ws };
  }
  return best!;
}

export function patternText(types: string[], wires: Array<[number, number, string]>): string {
  // Repeated types get a number (colorize#1, colorize#2) so two wires between look-alikes stay apart.
  const many = new Set(types.filter((t, i) => types.indexOf(t) !== i));
  const seen = new Map<string, number>();
  const names = types.map(t => { if (!many.has(t)) return t; const k = (seen.get(t) ?? 0) + 1; seen.set(t, k); return `${t}#${k}`; });
  if (!wires.length) return names.join(' · ');
  return wires.map(([a, b, l]) => `${names[a]}.${l.split('>')[0]} → ${names[b]}.${l.split('>')[1]}`).join(', ');
}

export function minePatterns(inputs: MineInput[], opts: MineOptions = {}): MinedPattern[] {
  const minSupport = opts.minSupport ?? 3, maxSize = opts.maxSize ?? 6, minSize = opts.minSize ?? 2;
  const perGraphCap = opts.perGraphCap ?? 24, levelCap = opts.levelCap ?? 300;
  const graphs = prepare(inputs, opts.trivial ?? TRIVIAL_TYPES);

  // Level 1: single nodes.
  let level: Level = new Map();
  for (const g of graphs) {
    for (const [u, t] of [...g.types].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!g.adj.has(u)) continue;
      const key = `${t}|`;
      let p = level.get(key);
      if (!p) { p = { key, size: 1, types: [t], wires: [], support: 0, count: 0, embeddings: [], closed: true, text: t, byGraph: new Map() }; level.set(key, p); }
      const list = p.byGraph.get(g.id) ?? [];
      if (list.length < perGraphCap) list.push([u]);
      p.byGraph.set(g.id, list);
    }
  }
  const finish = (lv: Level) => {
    for (const p of lv.values()) {
      p.support = p.byGraph.size;
      p.count = [...p.byGraph.values()].reduce((s, l) => s + l.length, 0);
    }
    const kept = [...lv.values()].filter(p => p.support >= minSupport)
      .sort((a, b) => b.support - a.support || b.count - a.count || (a.key < b.key ? -1 : 1)).slice(0, levelCap);
    return new Map(kept.map(p => [p.key, p]));
  };
  level = finish(level);
  const out: LevelPattern[] = [];
  const gById = new Map(graphs.map(g => [g.id, g]));
  for (let size = 2; size <= maxSize && level.size; size++) {
    const next: Level = new Map();
    const parentOf = new Map<string, Set<string>>();
    for (const parent of level.values()) {
      for (const [gid, embs] of parent.byGraph) {
        const g = gById.get(gid)!;
        const seen = new Set<string>();
        for (const emb of embs) {
          const inEmb = new Set(emb);
          const cand = new Set<string>();
          for (const u of emb) for (const v of g.adj.get(u) ?? []) if (!inEmb.has(v)) cand.add(v);
          for (const v of [...cand].sort()) {
            const set = [...emb, v].sort();
            const sk = set.join('\u0001');
            if (seen.has(sk)) continue;
            seen.add(sk);
            const c = canonical(set, u => g.types.get(u)!, u => g.wires.get(u) ?? []);
            let p = next.get(c.key);
            if (!p) {
              const types = c.order.map(u => g.types.get(u)!);
              p = { key: c.key, size, types, wires: c.wires, support: 0, count: 0, embeddings: [], closed: true, text: patternText(types, c.wires), byGraph: new Map() };
              next.set(c.key, p);
            }
            const list = p.byGraph.get(gid) ?? [];
            if (list.length < perGraphCap && !list.some(l => l.join('\u0001') === sk)) list.push(set);
            p.byGraph.set(gid, list);
            parentOf.set(c.key, (parentOf.get(c.key) ?? new Set()).add(parent.key));
          }
        }
      }
    }
    const kept = finish(next);
    // A parent is not closed when a child keeps its whole support.
    for (const child of kept.values()) for (const pk of parentOf.get(child.key) ?? []) {
      const parent = level.get(pk);
      if (parent && parent.support === child.support) parent.closed = false;
    }
    if (size - 1 >= minSize) out.push(...level.values());
    level = kept;
  }
  if (level.size) out.push(...level.values());
  return out.filter(p => p.size >= minSize).map(({ byGraph, ...p }) => ({
    ...p,
    embeddings: [...byGraph].flatMap(([graphId, embs]) => embs.map(nodes => ({ graphId, nodes }))),
  })).sort((a, b) => b.support - a.support || b.size - a.size || (a.key < b.key ? -1 : 1));
}
