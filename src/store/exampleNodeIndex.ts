/**
 * exampleNodeIndex.ts — which examples use which nodes, answered from a small prebuilt table
 * (exampleNodes.json, built by exampleNodeIndexBuild.ts at test time) so the node search, the node
 * list's categories and a node's preview can show "Examples using …" without loading the examples
 * chunk. See docs/node-browser.md, "Examples using a node".
 *
 * Ranking: curated keeps first, then course steps, then (only when nothing listed uses the node)
 * retired examples; within a tier, the examples where the node is central (near the Output, in a
 * small graph) before the ones that use it in passing.
 */
import table from './exampleNodes.json';
import type { ExampleNodeTable } from './exampleNodeIndexBuild';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from './exampleIndex';

export const EXAMPLE_NODE_TABLE = table as ExampleNodeTable;

export interface ExampleHit {
  key: string;
  label: string;
  /** The asked-about types this example uses, most central first. */
  types: string[];
  tier: 0 | 1 | 2;
  /** Ranking score within the tier (higher first). */
  score: number;
  /** Its folder's name and colour (a course step's course), for the card. */
  folder?: string;
  color?: string;
}

const FOLDER_OF = new Map<string, { label: string; color: string }>();
for (const f of EXAMPLE_FOLDERS) for (const k of f.keys) if (!FOLDER_OF.has(k)) FOLDER_OF.set(k, { label: f.label, color: f.color });

/** Per type: [example key, centrality] for every example that uses it. */
let byType: Map<string, Array<[string, number]>> | null = null;
function typeMap(): Map<string, Array<[string, number]>> {
  if (byType) return byType;
  byType = new Map();
  for (const [key, e] of Object.entries(EXAMPLE_NODE_TABLE.examples)) {
    e.t.forEach((t, i) => {
      let list = byType!.get(t);
      if (!list) byType!.set(t, list = []);
      list.push([key, e.s[i] ?? 0]);
    });
  }
  return byType;
}

/** How many examples use a type (any tier). */
export const exampleCountFor = (type: string): number => typeMap().get(type)?.length ?? 0;

const hit = (key: string, types: string[], score: number): ExampleHit | null => {
  const e = EXAMPLE_NODE_TABLE.examples[key];
  const idx = EXAMPLE_INDEX[key];
  if (!e || !idx) return null;
  const f = FOLDER_OF.get(key);
  return { key, label: idx.label, types, tier: e.tier, score, folder: f?.label, color: f?.color };
};

const byRank = (a: ExampleHit, b: ExampleHit) => a.tier - b.tier || b.score - a.score || a.label.localeCompare(b.label);

/** Retired examples only when nothing listed is in the list. */
const dropRetired = (list: ExampleHit[]) => (list.some(h => h.tier < 2) ? list.filter(h => h.tier < 2) : list);

/** The examples that use one node type, best first. */
export function examplesForType(type: string, limit = 4): ExampleHit[] {
  const list = (typeMap().get(type) ?? []).map(([k, s]) => hit(k, [type], s)).filter((h): h is ExampleHit => !!h);
  return dropRetired(list).sort(byRank).slice(0, limit);
}

/**
 * The examples that use any of a few node types (a search's focus), best first: the first type
 * weighs most, an example using more of them ranks higher, and curation leads.
 */
export function examplesForTypes(types: readonly string[], limit = 4): ExampleHit[] {
  const acc = new Map<string, { types: string[]; score: number }>();
  types.forEach((t, rank) => {
    const weight = 1 / (1 + rank * 0.5);
    for (const [k, s] of typeMap().get(t) ?? []) {
      const a = acc.get(k) ?? { types: [], score: 0 };
      a.types.push(t);
      a.score += weight * (s + 40);
      acc.set(k, a);
    }
  });
  const list = [...acc].map(([k, a]) => hit(k, a.types, a.score)).filter((h): h is ExampleHit => !!h);
  return dropRetired(list).sort(byRank).slice(0, limit);
}

/**
 * The examples that best show a category: ranked by curation, then how many of the category's
 * node types they use, then how central those are.
 */
export function examplesForCategory(types: readonly string[], limit = 5): ExampleHit[] {
  const set = new Set(types);
  const list: ExampleHit[] = [];
  for (const [key, e] of Object.entries(EXAMPLE_NODE_TABLE.examples)) {
    const used: string[] = [];
    let sum = 0;
    e.t.forEach((t, i) => { if (set.has(t)) { used.push(t); sum += e.s[i] ?? 0; } });
    if (!used.length) continue;
    const h = hit(key, used, used.length * 1000 + sum);
    if (h) list.push(h);
  }
  return dropRetired(list).sort(byRank).slice(0, limit);
}
