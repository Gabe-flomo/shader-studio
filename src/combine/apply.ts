/**
 * apply.ts — a Combine spec into the graph, and again after every change (docs/combine-plan.md §4, "Rebuild").
 *
 * The glue is rebuilt whole each time, ids kept by role (`_cbRole`), so wires from your own nodes and Play controls
 * stay on it. Before building, the wires the last build set on products' own nodes (`patched`) are put back, so a
 * product is always rebuilt from as its builder left it. A glue node you edited by hand keeps your edits (a setting
 * the new spec doesn't change, a wire you moved) unless the rebuild is asked to restore (Rebuild it).
 *
 * The spec goes on the top glue node (the anchor, `params.combine`); every glue node carries the build key. The
 * Output shows the stack (or one layer of it, isolated). Pure: ids come from `nextId`.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { estimateNodeHeight } from '../store/graphLayout';
import { buildCombine, type CombineBuild } from './build';
import { CB_BUILD, CB_ROLE, COMBINE_META, cbRoleOf, findCombineBuild, type CombineMeta } from './meta';
import type { CombineSpec, NodeRef } from './spec';

const ignored = (k: string) => k.startsWith('_') || k === COMBINE_META || k === 'subgraph' || k.includes('::');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isOutput = (n: GraphNode) => n.type === 'output' || n.type === 'vec4Output';

interface Snap { type: string; params: Record<string, unknown>; wires: Record<string, string> }

/** A glue node as built: its settings and where its wires come from (by role, or node id for a product's). */
function snapshot(n: GraphNode, roleById: ReadonlyMap<string, string>): Snap {
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.params)) if (!ignored(k)) params[k] = v;
  const wires: Record<string, string> = {};
  for (const [k, s] of Object.entries(n.inputs)) if (s.connection) wires[k] = `${roleById.get(s.connection.nodeId) ?? s.connection.nodeId}.${s.connection.outputKey}`;
  return { type: n.type, params, wires };
}

/** Did you change setting `k` since the build? A key the build didn't write counts only when it isn't the default. */
function userChanged(n: GraphNode, k: string, v: unknown, built: Record<string, unknown>): boolean {
  if (k in built) return !same(v, built[k]);
  const def = getNodeDefinition(n.type)?.defaultParams?.[k];
  return def === undefined ? v !== undefined : !same(v, def);
}

export interface CombineEdits {
  /** "Mix · Blend": settings you changed on glue nodes (kept on a rebuild unless Rebuild it). */
  params: string[];
  /** Glue inputs you rewired. */
  wires: string[];
}

const nameOf = (n: GraphNode) => (typeof n.params.label === 'string' && n.params.label) || getNodeDefinition(n.type)?.label || n.type;

/** What you changed by hand on a Combine build's glue since it was built. */
export function checkCombineEdits(graph: readonly GraphNode[], anchorId: string): CombineEdits {
  const found = findCombineBuild(graph, anchorId);
  const out: CombineEdits = { params: [], wires: [] };
  if (!found?.meta.built) return out;
  const roleById = new Map([...found.byRole.values()].map(n => [n.id, cbRoleOf(n)]));
  for (const [role, json] of Object.entries(found.meta.built)) {
    const here = found.byRole.get(role);
    if (!here) continue;
    const was = JSON.parse(json) as Snap;
    const now = snapshot(here, roleById);
    for (const [k, v] of Object.entries(now.params)) if (userChanged(here, k, v, was.params)) out.params.push(`${nameOf(here)} · ${getNodeDefinition(here.type)?.paramDefs?.[k]?.label ?? k}`);
    for (const k of new Set([...Object.keys(now.wires), ...Object.keys(was.wires)])) if (now.wires[k] !== was.wires[k]) out.wires.push(`${nameOf(here)} · ${here.inputs[k]?.label ?? k}`);
  }
  return out;
}

export interface ApplyCombineResult {
  nodes: GraphNode[];
  /** The node holding the spec (null: nothing to glue yet, one layer or none). */
  anchorId: string | null;
  build: CombineBuild;
  /** Your edits kept on the glue. */
  kept: string[];
}

/** The graph with the wires `patched` put back (the products as their builders left them). */
function unpatch(graph: GraphNode[], patched: CombineMeta['patched']): GraphNode[] {
  if (!patched || !Object.keys(patched).length) return graph;
  const by = new Map<string, Array<[string, NodeRef | null]>>();
  for (const [key, was] of Object.entries(patched)) {
    const dot = key.lastIndexOf('.');
    const id = key.slice(0, dot), input = key.slice(dot + 1);
    by.set(id, [...(by.get(id) ?? []), [input, was]]);
  }
  return graph.map(n => {
    const list = by.get(n.id);
    if (!list) return n;
    const inputs = { ...n.inputs };
    for (const [k, was] of list) {
      if (!inputs[k]) continue;
      inputs[k] = { ...inputs[k], connection: was ? { ...was } : undefined };
    }
    return { ...n, inputs };
  });
}

/** The graph with the Combine build of `anchorId` taken away: its glue gone, its patches put back. Pure. */
export function removeCombine(graph: readonly GraphNode[], anchorId: string): GraphNode[] {
  const found = findCombineBuild(graph, anchorId);
  if (!found) return [...graph];
  const glue = new Set([...found.byRole.values()].map(n => n.id));
  const rest = unpatch(graph.filter(n => !glue.has(n.id)), found.meta.patched);
  return rest.map(n => {
    let changed = false;
    const inputs = { ...n.inputs };
    for (const [k, s] of Object.entries(inputs)) if (s.connection && glue.has(s.connection.nodeId)) { inputs[k] = { ...s, connection: undefined }; changed = true; }
    return changed ? { ...n, inputs } : n;
  });
}

/**
 * The graph with `spec` built into it: the glue of the build at `anchorId` rebuilt (or a new build), the Output on
 * the stack's picture (or on layer `isolate`'s). `restore`: drop your hand edits on the glue.
 */
export function applyCombine(graph0: readonly GraphNode[], spec: CombineSpec, opts: { nextId: () => string; anchorId?: string | null; isolate?: string | null; restore?: boolean }): ApplyCombineResult {
  const found = opts.anchorId ? findCombineBuild(graph0, opts.anchorId) : null;
  const oldByRole = found?.byRole ?? new Map<string, GraphNode>();
  const oldIds = new Set([...oldByRole.values()].map(n => n.id));
  // The products as their builders left them, without the old glue.
  let graph = unpatch(graph0.filter(n => !oldIds.has(n.id)), found?.meta.patched);
  const taken = new Set(graph0.map(n => n.id));
  const nextId = () => { let id = opts.nextId(); while (taken.has(id)) id = opts.nextId(); taken.add(id); return id; };
  const idOfRole = new Map<string, string>();
  const idFor = (role: string) => {
    if (!idOfRole.has(role)) idOfRole.set(role, oldByRole.get(role)?.id ?? nextId());
    return idOfRole.get(role)!;
  };
  const build = buildCombine(spec, graph, idFor);
  const key = found?.meta.build ?? `c${nextId()}`;

  // Your edits on the glue: settings the new spec leaves as the last build made them, and wires you moved.
  const kept: string[] = [];
  const roleById = new Map(build.glue.map(n => [n.id, cbRoleOf(n)]));
  const oldRoleById = new Map([...oldByRole.values()].map(n => [n.id, cbRoleOf(n)]));
  const built: Record<string, string> = {};
  const present = new Set([...graph.map(n => n.id), ...build.glue.map(n => n.id)]);
  for (const node of build.glue) {
    const role = cbRoleOf(node);
    const fresh = snapshot(node, roleById);
    built[role] = JSON.stringify(fresh);
    const old = oldByRole.get(role);
    const was = found?.meta.built?.[role] ? JSON.parse(found.meta.built[role]) as Snap : null;
    if (old) node.position = { ...old.position };
    if (!old || !was || old.type !== node.type || opts.restore) continue;
    for (const [k, v] of Object.entries(old.params)) {
      if (ignored(k)) continue;
      if (userChanged(old, k, v, was.params) && same(fresh.params[k], was.params[k])) { node.params[k] = v; kept.push(`${nameOf(node)} · ${getNodeDefinition(node.type)?.paramDefs?.[k]?.label ?? k}`); }
    }
    const now = snapshot(old, oldRoleById);
    for (const [k, s] of Object.entries(old.inputs)) {
      if (now.wires[k] === was.wires[k] || !node.inputs[k]) continue;
      // Rewired by hand (or unwired): keep yours, while what it reads is still there.
      if (s.connection && !present.has(s.connection.nodeId)) continue;
      node.inputs[k] = { ...node.inputs[k], connection: s.connection ? { ...s.connection } : undefined };
      kept.push(`${nameOf(node)} · ${node.inputs[k].label ?? k} (rewired)`);
    }
    for (const [k, v] of Object.entries(old.params)) if (k.includes('::') || k.startsWith('_fold')) node.params[k] = v;
  }

  // New glue goes to the right of what is there, a column per layer.
  const fixed = graph.filter(n => !isOutput(n));
  const right = fixed.length ? Math.max(...fixed.map(n => n.position.x)) : 0;
  const top = fixed.length ? Math.min(...fixed.map(n => n.position.y)) : 0;
  let col = 0;
  for (const layer of spec.layers) {
    const ids = build.layers[layer.id]?.glue ?? [];
    const fresh = build.glue.filter(n => ids.includes(n.id) && !oldByRole.has(cbRoleOf(n)));
    if (!fresh.length) continue;
    col++;
    let y = top;
    for (const n of fresh) { n.position = { x: right + 400 * col, y }; y += estimateNodeHeight(n) + 48; }
  }

  // The products' own wires the build sets, with what was there before (put back next time).
  const patched: Record<string, NodeRef | null> = {};
  if (build.patches.length) {
    const byId = new Map(graph.map(n => [n.id, n]));
    const edits = new Map<string, Record<string, NodeRef | null>>();
    for (const pt of build.patches) {
      const n = byId.get(pt.nodeId);
      if (!n) continue;
      const k = `${pt.nodeId}.${pt.input}`;
      if (!(k in patched)) patched[k] = n.inputs[pt.input]?.connection ? { ...n.inputs[pt.input].connection! } : null;
      edits.set(pt.nodeId, { ...(edits.get(pt.nodeId) ?? {}), [pt.input]: pt.from });
    }
    graph = graph.map(n => {
      const e = edits.get(n.id);
      if (!e) return n;
      const inputs = { ...n.inputs };
      const def = getNodeDefinition(n.type);
      for (const [k, from] of Object.entries(e)) {
        const sock = inputs[k] ?? (def?.inputs[k] ? { type: def.inputs[k].type, label: def.inputs[k].label } : null);
        if (!sock) continue;
        inputs[k] = { ...sock, connection: from ? { ...from } : undefined };
      }
      return { ...n, inputs };
    });
  }

  // The anchor: the glue node the stack's picture comes out of (else the last glue made).
  const glueIds = new Set(build.glue.map(n => n.id));
  const anchor = (build.result && glueIds.has(build.result.nodeId) ? build.glue.find(n => n.id === build.result!.nodeId) : undefined) ?? build.glue[build.glue.length - 1];
  for (const n of build.glue) {
    n.params[CB_BUILD] = key;
    delete n.params[COMBINE_META];
  }
  if (anchor) anchor.params[COMBINE_META] = { v: 1, spec: structuredClone(spec), build: key, built, patched } satisfies CombineMeta;

  // Wires from your own nodes into old glue that is gone: dropped.
  graph = graph.map(n => {
    let changed = false;
    const inputs = { ...n.inputs };
    for (const [k, s] of Object.entries(inputs)) {
      const c = s.connection;
      if (!c || !oldIds.has(c.nodeId) || glueIds.has(c.nodeId) || isOutput(n)) continue;
      inputs[k] = { ...s, connection: undefined };
      changed = true;
    }
    return changed ? { ...n, inputs } : n;
  });

  // The Output shows the stack (or the isolated layer).
  const shown = (opts.isolate ? build.layers[opts.isolate]?.out?.colour : null) ?? build.result;
  let output = graph.find(n => isOutput(n) && n.inputs.color);
  if (!output && shown) {
    const def = getNodeDefinition('output')!;
    output = { id: nextId(), type: 'output', position: { x: right + 380 * (col + 1), y: top }, inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label } }, outputs: {}, params: {} };
    graph = [...graph, output];
  }
  if (output && shown) {
    const outId = output.id;
    graph = graph.map(n => (n.id === outId ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: { ...shown } } } } : n));
  }
  return { nodes: [...graph, ...build.glue], anchorId: anchor?.id ?? null, build, kept };
}

/** Whether a node is Combine glue (any build). */
export const isCombineGlue = (n: GraphNode): boolean => typeof n.params[CB_BUILD] === 'string' && typeof n.params[CB_ROLE] === 'string';
