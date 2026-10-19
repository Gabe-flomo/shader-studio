/**
 * exampleNodeIndexBuild.ts — builds the example ↔ node-type index (exampleNodes.json) from the
 * example graphs. Run at test time, never in the app: the app reads the JSON (exampleNodeIndex.ts)
 * and never loads the examples chunk to answer "which examples use X".
 *
 * Regenerate with `WRITE_EXAMPLE_NODES=1 npx vitest run src/store/__tests__/exampleNodeIndex.test.ts`;
 * the same test fails when the shipped JSON is stale.
 *
 * Which examples go in (docs/node-browser.md, "Examples using a node"):
 *  - every example listed in a showcase folder (tier 0, the curated keeps),
 *  - every course step under Learn (tier 1),
 *  - a retired example (tier 2) only for the node types no listed example uses, and only with those types.
 * Hidden examples (Pieces) never.
 *
 * Each (example, type) pair gets a 0…100 score for how central the node is there: near the Output
 * (hops upstream from it, into groups through their output ports) and in a small graph (few distinct
 * types) scores high; a node off to the side of a big graph scores low.
 */
import { NODE_ALIASES } from '../nodes/definitions/aliases';

export interface ExampleNodeEntry {
  /** 0 a curated keep (showcase folder), 1 a course step, 2 retired (kept only for types nothing listed uses). */
  tier: 0 | 1 | 2;
  /** Its node types, most central first. */
  t: string[];
  /** Each type's centrality, 0…100, parallel to `t`. */
  s: number[];
}

export interface ExampleNodeTable {
  v: 1;
  examples: Record<string, ExampleNodeEntry>;
}

/** Types that say nothing about an example: every graph has an Output. */
export const SKIPPED_TYPES = new Set(['output']);

/**
 * The new-graph starter's nodes (UV → Circle SDF → Glow, maybe a Tone Map). An example whose graph is
 * only these is a placeholder (a Play, data or p5 example doing its work elsewhere): it doesn't show
 * them off, so it is listed with no types rather than as a Circle SDF example.
 */
export const STARTER_TYPES = new Set(['uv', 'circleSDF', 'light', 'toneMap', 'time']);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

const canonical = (type: string) => NODE_ALIASES[type]?.to ?? type;

/** Upstream ids of a node at its own scope: what its inputs are wired from. */
function upstream(n: Obj): string[] {
  const out: string[] = [];
  for (const inp of Object.values(obj(n.inputs) ?? {})) {
    const id = str(obj(obj(inp)?.connection)?.nodeId);
    if (id) out.push(id);
  }
  return out;
}

/**
 * Each node type's smallest distance (hops upstream) from the picture: the top level's Output is 0;
 * inside a group, its output ports' nodes are the group's distance + 1. Unreached nodes are absent.
 */
export function typeDistances(nodes: unknown): Map<string, number> {
  const best = new Map<string, number>();
  const visitScope = (list: Obj[], seeds: Array<[string, number]>) => {
    const byId = new Map(list.map(n => [str(n.id) ?? '', n] as const));
    const dist = new Map<string, number>();
    const queue = [...seeds];
    for (const [id, d] of seeds) dist.set(id, d);
    while (queue.length) {
      const [id, d] = queue.shift()!;
      const n = byId.get(id);
      if (!n) continue;
      for (const up of upstream(n)) {
        if (dist.has(up) || !byId.has(up)) continue;
        dist.set(up, d + 1);
        queue.push([up, d + 1]);
      }
    }
    for (const n of list) {
      const id = str(n.id) ?? '';
      const d = dist.get(id);
      const type = str(n.type);
      if (d === undefined || !type) continue;
      const t = canonical(type);
      if (!best.has(t) || best.get(t)! > d) best.set(t, d);
      const sub = obj(obj(n.params)?.subgraph);
      if (sub) {
        const inner = arr(sub.nodes).map(obj).filter((x): x is Obj => !!x);
        const ports = arr(sub.outputPorts).map(obj).map(p => str(p?.fromNodeId)).filter((x): x is string => !!x);
        visitScope(inner, ports.map(p => [p, d + 1] as [string, number]));
      }
    }
  };
  const top = arr(nodes).map(obj).filter((x): x is Obj => !!x);
  const outs = top.filter(n => n.type === 'output').map(n => [str(n.id) ?? '', 0] as [string, number]);
  visitScope(top, outs);
  return best;
}

/** Every node type in a graph, groups walked at any depth, aliases resolved. */
export function typesIn(nodes: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (list: unknown) => {
    for (const n of arr(list).map(obj)) {
      if (!n) continue;
      const type = str(n.type);
      if (type) out.add(canonical(type));
      const sub = obj(obj(n.params)?.subgraph);
      if (sub) walk(sub.nodes);
    }
  };
  walk(nodes);
  for (const t of SKIPPED_TYPES) out.delete(t);
  return out;
}

/** One example's types with their centrality, most central first. */
export function scoreTypes(nodes: unknown): Array<[string, number]> {
  const types = typesIn(nodes);
  if ([...types].every(t => STARTER_TYPES.has(t))) return [];
  const dist = typeDistances(nodes);
  const reached = dist.size > 1; // an Output with something wired into it
  const size = 1 / Math.sqrt(Math.max(1, types.size));
  const rows: Array<[string, number]> = [...types].map(t => {
    const d = dist.get(t);
    // Not wired to the picture: incidental (a Play-only graph with no Output path counts everything the same).
    const near = d !== undefined ? 1 / (1 + d) : reached ? 0 : 0.3;
    return [t, Math.round(100 * (0.55 * near + 0.45 * size))];
  });
  return rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export interface BuildInput {
  graphs: Record<string, { nodes: unknown }>;
  /** Showcase folders' keys (curated keeps). */
  showcase: readonly string[];
  /** Course steps' keys (under Learn). */
  courses: readonly string[];
  retired: readonly string[];
}

export function buildExampleNodeTable({ graphs, showcase, courses, retired }: BuildInput): ExampleNodeTable {
  const examples: Record<string, ExampleNodeEntry> = {};
  const listedTypes = new Set<string>();
  const add = (key: string, tier: 0 | 1) => {
    if (examples[key] || !graphs[key]) return;
    const rows = scoreTypes(graphs[key].nodes);
    for (const [t] of rows) listedTypes.add(t);
    examples[key] = { tier, t: rows.map(r => r[0]), s: rows.map(r => r[1]) };
  };
  for (const k of showcase) add(k, 0);
  for (const k of courses) add(k, 1);
  for (const key of retired) {
    if (examples[key] || !graphs[key]) continue;
    const rows = scoreTypes(graphs[key].nodes).filter(([t]) => !listedTypes.has(t));
    if (rows.length) examples[key] = { tier: 2, t: rows.map(r => r[0]), s: rows.map(r => r[1]) };
  }
  // Stable order: by key, so the JSON diffs cleanly.
  const sorted: Record<string, ExampleNodeEntry> = {};
  for (const k of Object.keys(examples).sort()) sorted[k] = examples[k];
  return { v: 1, examples: sorted };
}
