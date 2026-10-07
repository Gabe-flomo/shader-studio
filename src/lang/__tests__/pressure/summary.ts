/**
 * summary.ts — the pressure test's numbers: counts per class and per example folder, gaps
 * grouped by category (with the node types and examples they hit), and a ranking of gaps by how
 * many examples fixing them would unlock.
 */
import type { ExampleResult, Klass } from './harness';
import type { GapCategory } from '../../fromGraph';

/** Gaps that don't change what the graph draws: not counted when ranking. */
export const COSMETIC = new Set<GapCategory>(['layout', 'notes', 'sugar-output-socket', 'reserved-word']);
/** Gaps outside the node graph (the example's Play setup, media): listed, but they don't block a class. */
export const OUTSIDE = new Set<GapCategory>(['play', 'media']);

export interface GapRow {
  category: GapCategory;
  occurrences: number;
  examples: number;
  exampleKeys: string[];
  /** Node types (or type · setting) most often behind it. */
  top: Array<[string, number]>;
  /** Examples for which this is the only blocking category. */
  soleBlocker: number;
  /** Of the occurrences, how many follow from another gap (and which). */
  derived: number;
  causes: Array<[string, number]>;
}

export interface Summary {
  total: number;
  byClass: Record<Klass, number>;
  byCategory: Array<{ category: string; total: number } & Record<Klass, number>>;
  nodes: number; nodesMade: number;
  wires: number; wiresMade: number;
  params: number; paramsSet: number;
  shaderSame: number; compiledBoth: number;
  gaps: GapRow[];
  /** Greedy: fix the next category that unlocks the most examples (to Full or Near). */
  unlockOrder: Array<{ category: GapCategory; unlocks: number; cumulative: number }>;
  ugly: { sugarLines: number; deleteUv: number; disconnects: number; linesPerNode: number; ordinalRefs: number; longest: Array<{ key: string; lines: number; nodes: number }> };
  runFailures: number;
  ms: number;
}

/** The gap categories that keep an example from Full. */
export function blockers(r: ExampleResult): Set<GapCategory> {
  if (r.klass === 'Full') return new Set();
  // A gap that follows from another (a wire whose node isn't made) counts as its cause.
  return new Set(r.gaps.map(g => g.cause ?? g.category).filter(c => !COSMETIC.has(c) && !OUTSIDE.has(c)));
}

export function summarise(results: ExampleResult[]): Summary {
  const byClass: Record<Klass, number> = { Full: 0, Near: 0, Partial: 0, None: 0 };
  for (const r of results) byClass[r.klass]++;
  const cats = [...new Set(results.map(r => r.category))];
  const byCategory = cats.map(category => {
    const rs = results.filter(r => r.category === category);
    const row = { category, total: rs.length, Full: 0, Near: 0, Partial: 0, None: 0 };
    for (const r of rs) row[r.klass]++;
    return row;
  }).sort((a, b) => b.total - a.total);
  const sum = (f: (r: ExampleResult) => number) => results.reduce((k, r) => k + f(r), 0);
  const gapMap = new Map<GapCategory, { occ: number; ex: Set<string>; top: Map<string, number>; causes: Map<string, number> }>();
  for (const r of results) {
    for (const g of r.gaps) {
      const e = gapMap.get(g.category) ?? { occ: 0, ex: new Set<string>(), top: new Map<string, number>(), causes: new Map<string, number>() };
      if (g.cause) e.causes.set(g.cause, (e.causes.get(g.cause) ?? 0) + 1);
      e.occ++;
      e.ex.add(r.key);
      const what = g.param ? `${g.nodeType ?? '?'} · ${g.param}` : g.nodeType ?? '—';
      e.top.set(what, (e.top.get(what) ?? 0) + 1);
      gapMap.set(g.category, e);
    }
  }
  const bl = new Map(results.map(r => [r.key, blockers(r)]));
  const gaps: GapRow[] = [...gapMap].map(([category, e]) => ({
    category, occurrences: e.occ, examples: e.ex.size, exampleKeys: [...e.ex],
    top: [...e.top].sort((a, b) => b[1] - a[1]).slice(0, 8),
    soleBlocker: [...bl.values()].filter(s => s.size === 1 && s.has(category)).length,
    derived: [...e.causes.values()].reduce((a, b) => a + b, 0), causes: [...e.causes].sort((a, b) => b[1] - a[1]),
  })).sort((a, b) => b.examples - a.examples);
  // Greedy unlock order.
  const remaining = new Map([...bl].filter(([, s]) => s.size > 0).map(([k, s]) => [k, new Set(s)]));
  const fixed = new Set<GapCategory>();
  const unlockOrder: Summary['unlockOrder'] = [];
  let cumulative = 0;
  const all = new Set([...remaining.values()].flatMap(s => [...s]));
  while (fixed.size < all.size) {
    let best: GapCategory | null = null, bestN = -1, bestTouch = -1;
    for (const c of all) {
      if (fixed.has(c)) continue;
      const n = [...remaining.values()].filter(s => [...s].every(x => x === c || fixed.has(x))).length;
      const touch = [...remaining.values()].filter(s => s.has(c)).length;
      if (n > bestN || (n === bestN && touch > bestTouch)) { best = c; bestN = n; bestTouch = touch; }
    }
    if (!best) break;
    fixed.add(best);
    for (const [k, s] of remaining) if ([...s].every(x => fixed.has(x))) { remaining.delete(k); }
    cumulative += bestN;
    unlockOrder.push({ category: best, unlocks: bestN, cumulative });
  }
  const scriptLines = (r: ExampleResult) => r.script.split('\n');
  return {
    total: results.length, byClass, byCategory,
    nodes: sum(r => r.nodes), nodesMade: sum(r => r.nodesMade),
    wires: sum(r => r.wires), wiresMade: sum(r => r.wiresMade),
    params: sum(r => r.params), paramsSet: sum(r => r.paramsSet),
    shaderSame: results.filter(r => r.shaderSame).length, compiledBoth: results.filter(r => r.shaderSame !== null).length,
    gaps, unlockOrder,
    ugly: {
      sugarLines: sum(r => r.sugarLines),
      deleteUv: sum(r => scriptLines(r).filter(l => /^delete before /.test(l) || /^delete uv/.test(l)).length),
      disconnects: sum(r => scriptLines(r).filter(l => l.startsWith('disconnect ')).length),
      linesPerNode: Math.round(100 * sum(r => r.lines - r.gapLines) / Math.max(1, sum(r => r.nodesMade))) / 100,
      ordinalRefs: sum(r => (r.script.match(/#\d+/g) ?? []).length),
      longest: [...results].sort((a, b) => b.lines - a.lines).slice(0, 5).map(r => ({ key: r.key, lines: r.lines, nodes: r.nodes })),
    },
    runFailures: sum(r => r.runFailures.length),
    ms: sum(r => r.ms),
  };
}

const pct = (a: number, b: number) => (b ? `${Math.round(100 * a / b)}%` : '—');
const esc = (s: string) => s.replace(/\|/g, '\\|');

export function tablesMarkdown(results: ExampleResult[], s: Summary): string {
  const out: string[] = [];
  out.push(`## Totals\n\n${s.total} examples · Full ${s.byClass.Full} · Near ${s.byClass.Near} · Partial ${s.byClass.Partial} · None ${s.byClass.None}`);
  out.push(`\nNodes made ${s.nodesMade}/${s.nodes} (${pct(s.nodesMade, s.nodes)}) · wires ${s.wiresMade}/${s.wires} (${pct(s.wiresMade, s.wires)}) · settings ${s.paramsSet}/${s.params} (${pct(s.paramsSet, s.params)}) · same shader ${s.shaderSame}/${s.compiledBoth} that compiled both ways · lines that failed on the store ${s.runFailures}`);
  out.push('\n## By folder\n\n| Folder | Examples | Full | Near | Partial | None |\n|---|---:|---:|---:|---:|---:|');
  for (const c of s.byCategory) out.push(`| ${esc(c.category)} | ${c.total} | ${c.Full} | ${c.Near} | ${c.Partial} | ${c.None} |`);
  out.push('\n## Gaps\n\n| Gap | Examples | Times | Follows from another | Sole blocker | Most often |\n|---|---:|---:|---|---:|---|');
  for (const g of s.gaps) out.push(`| ${g.category} | ${g.examples} | ${g.occurrences} | ${g.derived ? g.causes.map(([c, n]) => `${c} ${n}`).join(', ') : '—'} | ${g.soleBlocker} | ${esc(g.top.slice(0, 5).map(([w, n]) => `${w} (${n})`).join(', '))} |`);
  out.push('\n## Unlock order (greedy)\n\n| # | Fix | Examples unlocked | Cumulative |\n|---:|---|---:|---:|');
  s.unlockOrder.forEach((u, i) => out.push(`| ${i + 1} | ${u.category} | ${u.unlocks} | ${u.cumulative} |`));
  out.push('\n## Per example\n\n| Example | Folder | Class | Nodes | Made | Lines | Main gaps |\n|---|---|---|---:|---:|---:|---|');
  const order: Record<Klass, number> = { Full: 0, Near: 1, Partial: 2, None: 3 };
  for (const r of [...results].sort((a, b) => a.category.localeCompare(b.category) || order[a.klass] - order[b.klass] || a.label.localeCompare(b.label))) {
    const counts = new Map<string, number>();
    for (const g of r.gaps) if (!COSMETIC.has(g.category)) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
    const main = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c}${n > 1 ? ` ×${n}` : ''}`).join(', ');
    out.push(`| ${esc(r.label)} | ${esc(r.category)} | ${r.klass} | ${r.nodes} | ${r.pctNodes}% | ${r.lines} | ${esc(main || '—')} |`);
  }
  return out.join('\n');
}
