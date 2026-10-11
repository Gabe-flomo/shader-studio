/**
 * apply.ts — putting a Splat builder scene into the user's graph and rebuilding it later (the Grid builder's
 * scheme, gridScene/apply.ts, with the Splat builder's keys):
 *
 *   - every top-level node carries its role (`_spRole`) and its build (`_spBuild`); the Splat Scene keeps the
 *     spec (`splatBuilder`) and, per role, a fingerprint of what was built;
 *   - a rebuild keeps each node's id per role (Play controls and the user's wires stay), its place on the canvas,
 *     and a setting the user changed by hand that the new spec doesn't change.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { placeInFreeSpace } from '../store/agentSetup';
import { ensureSources } from '../builders/textures';
import { SP_BUILD, SP_META, SP_ROLE, buildSplatGraph, splatMetaOf, type SplatBuilderMeta } from './build';
import type { SplatBuilderSpec } from './spec';

export { splatMetaOf } from './build';

const ignored = (k: string) => k === '__comment' || k.startsWith('_') || k.includes('::') || k === SP_META || k === 'subgraph';
const roleOf = (n: GraphNode) => (typeof n.params[SP_ROLE] === 'string' ? n.params[SP_ROLE] as string : '');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Snapshot { type: string; params: Record<string, unknown> }
const snapshot = (n: GraphNode): Snapshot => ({ type: n.type, params: Object.fromEntries(Object.entries(n.params).filter(([k]) => !ignored(k))) });

/** The Splat Scene (its id) a node belongs to, from any of the build's nodes. */
export function splatSceneOfBuild(graph: readonly GraphNode[], anyId: string): string | null {
  const hit = graph.find(n => n.id === anyId);
  if (!hit) return null;
  if (splatMetaOf(hit)) return hit.id;
  const build = hit.params[SP_BUILD];
  if (!build) return null;
  return graph.find(n => splatMetaOf(n)?.build === build)?.id ?? null;
}

/** The nodes of one build, by role. */
export function findSplatBuild(graph: readonly GraphNode[], scanId: string): { scan: GraphNode; meta: SplatBuilderMeta; byRole: Map<string, GraphNode> } | null {
  const scan = graph.find(n => n.id === scanId);
  const meta = splatMetaOf(scan);
  if (!scan || !meta) return null;
  const mine = graph.filter(n => (meta.build ? n.params[SP_BUILD] === meta.build : n.id === scan.id) && roleOf(n));
  return { scan, meta, byRole: new Map(mine.map(n => [roleOf(n), n])) };
}

export interface ApplySplatResult {
  nodes: GraphNode[];
  scanId: string;
  finalId: string;
  warnings: string[];
  kept: number;
  /** The spec as built: its pictures each with their node. */
  spec: SplatBuilderSpec;
}

/**
 * The graph with `spec` built into it: new beside what is there (`asNew`, or nothing to rebuild), or replacing the
 * build of `scanId`. The graph's Output shows it (unless `keepOutput`). Pure.
 */
export function applySplatScene(graph: GraphNode[], spec0: SplatBuilderSpec, opts: { nextId: () => string; scanId?: string | null; asNew?: boolean; at?: { x: number; y: number }; keepOutput?: boolean }): ApplySplatResult {
  const found = !opts.asNew && opts.scanId ? findSplatBuild(graph, opts.scanId) : null;
  const taken = new Set(graph.map(n => n.id));
  const nextId = () => { let id = opts.nextId(); while (taken.has(id)) id = opts.nextId(); taken.add(id); return id; };
  const ensured = ensureSources(graph, spec0.textures, nextId, found?.scan.position ?? opts.at ?? { x: 0, y: 0 });
  const spec: SplatBuilderSpec = spec0.textures?.length ? { ...spec0, textures: ensured.sources } : spec0;
  graph = [...graph, ...ensured.added];
  const buildKey = found?.meta.build ?? `sp${nextId()}`;
  const idOfRole = new Map<string, string>();
  const idFor = (role: string) => {
    if (!idOfRole.has(role)) idOfRole.set(role, found?.byRole.get(role)?.id ?? nextId());
    return idOfRole.get(role)!;
  };
  const built = buildSplatGraph(spec, idFor, { existing: new Set(graph.map(n => n.id)) });
  const prints: Record<string, string> = {};
  let kept = 0;
  for (const node of built.nodes) {
    const role = roleOf(node);
    const fresh = snapshot(node);
    prints[role] = JSON.stringify(fresh);
    const old = found?.byRole.get(role);
    const was = found?.meta.built?.[role] ? JSON.parse(found.meta.built[role]) as Snapshot : null;
    if (old && was && old.type === node.type) {
      // A setting changed on the node by hand, which the new spec leaves as it was built: keep it.
      for (const [k, v] of Object.entries(old.params)) {
        if (ignored(k)) { if (k.includes('::') || k.startsWith('_fold') || k === 'splatInfo') node.params[k] = v; continue; }
        if (k in was.params && !same(v, was.params[k]) && same(fresh.params[k], was.params[k])) { node.params[k] = v; kept++; }
      }
      // What the card learned about the scan (its facts) stays while the file does.
      if (old.type === 'splatScene' && 'splatInfo' in old.params && same(old.params.videoId, node.params.videoId)) node.params.splatInfo = old.params.splatInfo;
    }
    node.params[SP_BUILD] = buildKey;
  }
  const scan = built.nodes.find(n => n.id === built.scanId)!;
  scan.params[SP_META] = { v: 1, spec: structuredClone(spec), build: buildKey, built: prints } satisfies SplatBuilderMeta;

  let top = built.nodes;
  let rest = graph;
  if (found) {
    const oldIds = new Set([...found.byRole.values()].map(n => n.id));
    const anchorOld = found.scan.position;
    const anchorNew = scan.position;
    const dx = anchorOld.x - anchorNew.x, dy = anchorOld.y - anchorNew.y;
    top = built.nodes.map(n => {
      const o = found.byRole.get(roleOf(n));
      return { ...n, position: o ? { ...o.position } : { x: n.position.x + dx, y: n.position.y + dy } };
    });
    rest = graph.filter(n => !oldIds.has(n.id));
    // Wires from the user's nodes into a node the rebuild no longer makes: dropped.
    const now = new Set(top.map(n => n.id));
    rest = rest.map(n => {
      let changed = false;
      const inputs = { ...n.inputs };
      for (const [k, s] of Object.entries(inputs)) {
        if (s.connection && oldIds.has(s.connection.nodeId) && !now.has(s.connection.nodeId)) { inputs[k] = { ...s, connection: undefined }; changed = true; }
      }
      return changed ? { ...n, inputs } : n;
    });
  } else {
    top = placeInFreeSpace(graph, built.nodes, opts.at ?? { x: 0, y: 0 });
  }
  // Your nodes: each run's start reads from what now comes before it in the stack.
  if (built.customs.length) {
    const builderIds = new Set([...(found ? [...found.byRole.values()].map(n => n.id) : []), ...top.map(n => n.id)]);
    for (const c of built.customs) rest = wireRunStart(rest, c.tail, c.from, builderIds);
  }
  if (!opts.keepOutput) {
    let output = rest.find(n => (n.type === 'output' || n.type === 'vec4Output') && n.inputs.color);
    if (!output) {
      const def = getNodeDefinition('output')!;
      const last = top.find(n => n.id === built.final.nodeId)!;
      output = { id: nextId(), type: 'output', position: { x: last.position.x + 440, y: last.position.y }, inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label } }, outputs: {}, params: {} };
      rest = [...rest, output];
    }
    const outId = output.id;
    rest = rest.map(n => (n.id === outId ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: { ...built.final } } } } : n));
  }
  return { nodes: [...rest, ...top], scanId: built.scanId, finalId: built.final.nodeId, warnings: built.warnings, kept, spec };
}

// ── Live edits: what changed between two graphs ─────────────────────────────

/** A param that never reaches the shader as a uniform (notes, roles, the spec): written without a compile. */
export const silentParam = (k: string) => k === '__comment' || k.startsWith('_') || k === SP_META;

/**
 * How `next` differs from `prev`: null when the wiring or the node set changed (a recompile), else per node the
 * params that changed, split into what the shader reads (`live`) and what it doesn't (`silent`). Pure.
 */
export function paramDiff(prev: readonly GraphNode[], next: readonly GraphNode[]): Array<{ id: string; live: Record<string, unknown>; silent: Record<string, unknown> }> | null {
  if (prev.length !== next.length) return null;
  const old = new Map(prev.map(n => [n.id, n]));
  const out: Array<{ id: string; live: Record<string, unknown>; silent: Record<string, unknown> }> = [];
  for (const n of next) {
    const o = old.get(n.id);
    if (!o || o.type !== n.type) return null;
    const wires = (x: GraphNode) => JSON.stringify(Object.entries(x.inputs).map(([k, s]) => [k, s.connection?.nodeId ?? '', s.connection?.outputKey ?? '']));
    if (wires(o) !== wires(n) || JSON.stringify(Object.keys(o.outputs)) !== JSON.stringify(Object.keys(n.outputs))) return null;
    if (o.params === n.params) continue;
    const live: Record<string, unknown> = {}, silent: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(o.params), ...Object.keys(n.params)])) {
      if (same(o.params[k], n.params[k])) continue;
      // A param that goes away (or a subgraph that changes) can't be patched: rebuild.
      if (!(k in n.params) || k === 'subgraph') return null;
      (silentParam(k) ? silent : live)[k] = n.params[k];
    }
    if (Object.keys(live).length || Object.keys(silent).length) out.push({ id: n.id, live, silent });
  }
  return out;
}

// ── Your nodes: runs of the chain the builder didn't make ───────────────────

/**
 * The nodes a run ending in `tail` is made of: `tail` and everything upstream of it that isn't the builder's (it stops
 * at the builder's nodes). Pure.
 */
export function runNodes(graph: readonly GraphNode[], tail: string, builderIds: ReadonlySet<string>): Set<string> {
  const byId = new Map(graph.map(n => [n.id, n]));
  const seen = new Set<string>();
  const stack = [tail];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || builderIds.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const s of Object.values(byId.get(id)!.inputs)) if (s.connection) stack.push(s.connection.nodeId);
  }
  // Side nodes that read the same splat as the run's start and feed only the run (or nothing yet): the Splat
  // Attributes the card's "Your own nodes" adds beside Set Splat, before you wire it in.
  const froms = new Set<string>();
  for (const id of seen) { const c = byId.get(id)!.inputs.splat?.connection; if (c && !seen.has(c.nodeId)) froms.add(`${c.nodeId}:${c.outputKey}`); }
  for (const n of graph) {
    if (seen.has(n.id) || builderIds.has(n.id) || !n.type.startsWith('splat') || n.type === 'splatScene') continue;
    const c = n.inputs.splat?.connection;
    if (!c || !froms.has(`${c.nodeId}:${c.outputKey}`)) continue;
    const readers = graph.filter(m => Object.values(m.inputs).some(i => i.connection?.nodeId === n.id));
    if (readers.every(m => seen.has(m.id))) seen.add(n.id);
  }
  return seen;
}

/**
 * The run ending in `tail` read from `from` (null: the splat as loaded): every Splat input in the run that came from
 * outside it (a builder node, or nothing) is wired to `from`. The run's own wiring stays. Pure.
 */
export function wireRunStart(graph: GraphNode[], tail: string, from: { nodeId: string; outputKey: string } | null, builderIds: ReadonlySet<string>): GraphNode[] {
  const run = runNodes(graph, tail, builderIds);
  return graph.map(n => {
    const s = n.inputs.splat;
    if (!run.has(n.id) || !s || s.type !== 'splat') return n;
    if (s.connection && run.has(s.connection.nodeId)) return n;
    const same = from ? s.connection?.nodeId === from.nodeId && s.connection.outputKey === from.outputKey : !s.connection;
    if (same) return n;
    return { ...n, inputs: { ...n.inputs, splat: { ...s, connection: from ? { ...from } : undefined } } };
  });
}

const nodeName = (n: GraphNode) => (typeof n.params.label === 'string' && n.params.label) || getNodeDefinition(n.type)?.label || n.type;

/**
 * The spec with the runs of nodes you added on the Splat Scene card (anything on the Modifier chain the builder didn't
 * make) as "Your nodes" cards, each after the effect it follows on the chain. Cards for runs that are gone are dropped.
 * What Edit this one opens with, so a rebuild keeps them wired in their place. Pure.
 */
export function adoptCustomChains(graph: readonly GraphNode[], scanId: string, spec: SplatBuilderSpec): SplatBuilderSpec {
  const build = findSplatBuild(graph, scanId);
  const mine = new Set(build ? [...build.byRole.values()].map(n => n.id) : []);
  const roleOf = (n: GraphNode) => String(n.params[SP_ROLE] ?? '');
  // The chain, first applied first: builder effects and runs of your nodes between them.
  const chain = splatModifierChainOf(graph, scanId).reverse();
  const runs: Array<{ after: string | null; tail: string; nodes: GraphNode[] }> = [];
  let after: string | null = null;
  let cur: GraphNode[] = [];
  const close = () => { if (cur.length) runs.push({ after, tail: cur[cur.length - 1].id, nodes: cur }); cur = []; };
  for (const n of chain) {
    if (mine.has(n.id) && roleOf(n).startsWith('fx:')) { close(); after = roleOf(n).slice(3); continue; }
    cur.push(n);
  }
  close();
  const tails = new Set(runs.map(r => r.tail));
  const effects = spec.effects.filter(e => e.kind !== 'custom' || (e.tail && tails.has(e.tail)));
  const used = new Set(effects.map(e => e.id));
  const freshId = () => { for (let i = 1; ; i++) if (!used.has(`c${i}`)) { used.add(`c${i}`); return `c${i}`; } };
  for (const r of runs) {
    // Splat Attributes and other side nodes of the run (upstream of its line) name it too.
    const names = [...runNodes(graph as GraphNode[], r.tail, mine)].map(id => graph.find(n => n.id === id)!).filter(n => n.type.startsWith('splat'));
    const label = (names.length ? names : r.nodes).reverse().map(nodeName).join(' → ');
    const have = effects.find(e => e.kind === 'custom' && e.tail === r.tail);
    if (have) { have.label = label; continue; }
    const card = { id: freshId(), kind: 'custom' as const, on: true, params: {}, animate: null, tail: r.tail, label };
    // After the effect it follows (and after your nodes already placed there), or first.
    let at = r.after ? effects.findIndex(e => e.id === r.after) + 1 : 0;
    while (at < effects.length && effects[at].kind === 'custom' && at > 0) at++;
    effects.splice(Math.max(0, at), 0, card);
  }
  return { ...spec, effects };
}

/** The nodes along a Splat Scene's Modifier chain, from the scan back (the card's walk, nodes/recipes/splatModifierRecipes.ts). */
function splatModifierChainOf(graph: readonly GraphNode[], scanId: string): GraphNode[] {
  const out: GraphNode[] = [];
  let at = graph.find(x => x.id === scanId)?.inputs.modifier?.connection?.nodeId;
  while (at && out.length < 64) {
    const node = graph.find(x => x.id === at);
    if (!node || out.includes(node)) break;
    out.push(node);
    at = node.inputs.splat?.connection?.nodeId;
  }
  return out;
}
