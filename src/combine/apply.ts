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
 *
 * Collide with and Follow the shape add nodes inside a product's Agents group (`build.inner`): those carry the build
 * key too, the group gains a port, and its Agent Output's motion wires go to them. What was there is kept in the meta
 * (`inner`) and put back before every rebuild and when the build goes, as the top-level patches are.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { estimateNodeHeight } from '../store/graphLayout';
import { buildCombine, type CombineBuild, type InnerEdit } from './build';
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

// ── Inside products' Agents groups ───────────────────────────────────────────

type InnerMeta = NonNullable<CombineMeta['inner']>;
const subOf = (g: GraphNode): SubgraphData | null => (g.params.subgraph as SubgraphData | undefined) ?? null;

/** The nodes build `key` added inside groups, by role (their ids kept on a rebuild). */
export function innerGlue(graph: readonly GraphNode[], key: string): Map<string, GraphNode> {
  const out = new Map<string, GraphNode>();
  for (const g of graph) {
    if (g.type !== 'agentsGroup') continue;
    for (const n of subOf(g)?.nodes ?? []) if (n.params[CB_BUILD] === key && cbRoleOf(n)) out.set(cbRoleOf(n), n);
  }
  return out;
}

/**
 * The graph with build `key`'s inside edits taken out: its nodes gone from the groups, the ports it added gone (from
 * Agent Inputs and the group's sockets), Agent Output's wires put back as they were (only those still on its nodes: a
 * group its builder rebuilt in the meantime keeps its own).
 */
function uninner(graph: GraphNode[], key: string | undefined, inner: InnerMeta | undefined, dropWrites = false): GraphNode[] {
  if (!key) return graph;
  return graph.map(g => {
    if (g.type !== 'agentsGroup') return g;
    const sg = subOf(g);
    if (!sg) return g;
    const mine = new Set(sg.nodes.filter(n => n.params[CB_BUILD] === key).map(n => n.id));
    const rec = inner?.[g.id];
    if (!mine.size && !rec) return g;
    const ports = new Set(rec?.ports ?? []);
    const insId = sg.nodes.find(x => x.type === 'agentInputs')?.id;
    const nodes = sg.nodes.filter(n => !mine.has(n.id)).map(n => {
      let inputs = n.inputs, params = n.params, outputs = n.outputs;
      for (const [k, s] of Object.entries(n.inputs)) {
        const c = s.connection;
        if (!c) continue;
        const ours = mine.has(c.nodeId) || (c.nodeId === insId && ports.has(c.outputKey));
        if (!ours) continue;
        const was = n.type === 'agentOutput' ? rec?.out[k] : null;
        const back = was && sg.nodes.some(x => x.id === was.nodeId && !mine.has(x.id)) ? { ...was } : undefined;
        if (inputs === n.inputs) inputs = { ...inputs };
        inputs[k] = { ...s, connection: back };
      }
      if (n.type === 'agentInputs' && ports.size) {
        const extra = ((n.params.extraInputs ?? []) as Array<{ key: string }>);
        if (extra.some(e => ports.has(e.key))) params = { ...params, extraInputs: extra.filter(e => !ports.has(e.key)) };
        if (Object.keys(outputs).some(k => ports.has(k))) outputs = Object.fromEntries(Object.entries(outputs).filter(([k]) => !ports.has(k)));
      }
      return inputs === n.inputs && params === n.params && outputs === n.outputs ? n : { ...n, inputs, params, outputs };
    });
    const inputs = Object.fromEntries(Object.entries(g.inputs).filter(([k]) => !ports.has(k)));
    // Live writes to its nodes went through the group ("inner::key"): when the build goes, those go with them.
    const params = dropWrites ? Object.fromEntries(Object.entries(g.params).filter(([k]) => !(k.includes('::') && mine.has(k.slice(0, k.indexOf('::')))))) : g.params;
    return { ...g, inputs, params: { ...params, subgraph: { ...sg, nodes } } };
  });
}

/** The graph with `edits` put in their groups; returns what Agent Output had (to put back) and the ports added. */
function putInner(graph: GraphNode[], edits: readonly InnerEdit[]): { graph: GraphNode[]; meta: InnerMeta } {
  const meta: InnerMeta = {};
  if (!edits.length) return { graph, meta };
  const byGroup = new Map<string, InnerEdit[]>();
  for (const e of edits) byGroup.set(e.groupId, [...(byGroup.get(e.groupId) ?? []), e]);
  const out = graph.map(g => {
    const list = byGroup.get(g.id);
    const sg = list ? subOf(g) : null;
    if (!list || !sg) return g;
    const rec = (meta[g.id] = { ports: [] as string[], out: {} as Record<string, NodeRef | null> });
    let nodes = [...sg.nodes];
    const inputs = { ...g.inputs };
    for (const e of list) {
      const ins = nodes.find(n => n.type === 'agentInputs');
      const outNode = nodes.find(n => n.type === 'agentOutput');
      if (!ins || !outNode) continue;
      // The ports: Agent Inputs' extra inputs (an output each inside) and the group's sockets, wired from outside.
      if (e.ports.length) {
        const extra = [...((ins.params.extraInputs ?? []) as Array<{ key: string; type: string; label: string }>)];
        const outs = { ...ins.outputs };
        for (const pt of e.ports) {
          if (!extra.some(x => x.key === pt.key)) extra.push({ key: pt.key, type: pt.type, label: pt.label });
          outs[pt.key] = { type: pt.type, label: pt.label };
          inputs[pt.key] = { type: pt.type, label: pt.label, connection: { ...pt.from } };
          rec.ports.push(pt.key);
        }
        nodes = nodes.map(n => (n.id === ins.id ? { ...n, params: { ...n.params, extraInputs: extra }, outputs: outs } : n));
      }
      // Agent Output's motion: from the new nodes (what was there, kept to put back).
      const oi = { ...outNode.inputs };
      const def = getNodeDefinition('agentOutput');
      for (const [k, from] of Object.entries(e.out)) {
        if (!(k in rec.out)) rec.out[k] = oi[k]?.connection ? { ...oi[k].connection! } : null;
        const sock = oi[k] ?? (def?.inputs[k] ? { type: g.params.space === '3d' && k !== 'speed' ? 'vec3' as const : def.inputs[k].type, label: def.inputs[k].label } : null);
        if (sock) oi[k] = { ...sock, connection: from ? { ...from } : undefined };
      }
      // Under Agent Output, so the group's own layout stays as its builder made it (a node kept from the last build stays put).
      const base = { x: outNode.position.x - 300 * Math.max(0, e.nodes.length - 1), y: outNode.position.y + 520 };
      const placed = e.nodes.map(n => (n.params._cbPlaced ? n : { ...n, position: { x: base.x + n.position.x, y: base.y }, params: { ...n.params, _cbPlaced: true } }));
      nodes = [...nodes.map(n => (n.id === outNode.id ? { ...n, inputs: oi } : n)), ...placed];
    }
    return { ...g, inputs, params: { ...g.params, subgraph: { ...sg, nodes } } };
  });
  return { graph: out, meta };
}

/** The graph with the Combine build of `anchorId` taken away: its glue gone, its patches put back. Pure. */
export function removeCombine(graph: readonly GraphNode[], anchorId: string): GraphNode[] {
  const found = findCombineBuild(graph, anchorId);
  if (!found) return [...graph];
  const glue = new Set([...found.byRole.values()].map(n => n.id));
  const rest = uninner(unpatch(graph.filter(n => !glue.has(n.id)), found.meta.patched), found.meta.build, found.meta.inner, true);
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
  const oldTop = found?.byRole ?? new Map<string, GraphNode>();
  const oldIds = new Set([...oldTop.values()].map(n => n.id));
  // The glue inside groups too (found by the build's key), so a rebuild keeps its ids and your edits on it.
  const oldInner = found ? innerGlue(graph0, found.meta.build) : new Map<string, GraphNode>();
  const oldByRole = new Map([...oldTop, ...oldInner]);
  // The products as their builders left them, without the old glue.
  let graph = uninner(unpatch(graph0.filter(n => !oldIds.has(n.id)), found?.meta.patched), found?.meta.build, found?.meta.inner);
  const taken = new Set(graph0.map(n => n.id));
  for (const g of graph0) if (g.type === 'agentsGroup') for (const n of subOf(g)?.nodes ?? []) taken.add(n.id);
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
  const innerNodes = build.inner.flatMap(e => e.nodes);
  const roleById = new Map([...build.glue, ...innerNodes].map(n => [n.id, cbRoleOf(n)]));
  const oldRoleById = new Map([...oldByRole.values()].map(n => [n.id, cbRoleOf(n)]));
  const built: Record<string, string> = {};
  const insideIds = graph.flatMap(g => (g.type === 'agentsGroup' ? (subOf(g)?.nodes ?? []).map(n => n.id) : []));
  const present = new Set([...graph.map(n => n.id), ...build.glue.map(n => n.id), ...innerNodes.map(n => n.id), ...insideIds]);
  for (const node of [...build.glue, ...innerNodes]) {
    const role = cbRoleOf(node);
    const fresh = snapshot(node, roleById);
    built[role] = JSON.stringify(fresh);
    const old = oldByRole.get(role);
    const was = found?.meta.built?.[role] ? JSON.parse(found.meta.built[role]) as Snap : null;
    if (old) { node.position = { ...old.position }; if (old.params._cbPlaced) node.params._cbPlaced = true; }
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

  // Inside products' Agents groups: the nodes, the ports, Agent Output's wires (what was there kept to put back).
  for (const n of innerNodes) n.params[CB_BUILD] = key;
  const put = putInner(graph, build.inner);
  graph = put.graph;

  // The anchor: the glue node the stack's picture comes out of (else the last glue made).
  const glueIds = new Set(build.glue.map(n => n.id));
  const anchor = (build.result && glueIds.has(build.result.nodeId) ? build.glue.find(n => n.id === build.result!.nodeId) : undefined) ?? build.glue[build.glue.length - 1];
  for (const n of build.glue) {
    n.params[CB_BUILD] = key;
    delete n.params[COMBINE_META];
  }
  if (anchor) anchor.params[COMBINE_META] = { v: 1, spec: structuredClone(spec), build: key, built, patched, ...(Object.keys(put.meta).length ? { inner: put.meta } : {}) } satisfies CombineMeta;

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
