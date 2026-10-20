/**
 * actions.ts — Combine joined to the graph and to the other builders (docs/combine.md).
 *
 * Combine is a kind of the one Scene builder, so it works on the session's draft (builders/sceneDraft.ts): every
 * change of the stack is built into the draft graph at once (the picture is the main preview's), and only Done puts it
 * in your graph, as one undo step. A change of settings only writes params (live uniforms, no recompile); a change
 * of what is wired rebuilds the glue, ids kept by role.
 *
 * Two ways in (docs/combine-plan.md §3.1):
 *  - Combine on the Scene builder's kind page (openNewCombine), or a graph Combine made, reopened (editCombine);
 *  - "Add to this…" next to Done in every builder (addToThis): that builder's Done builds as usual, then instead of
 *    ending the session the build becomes layer 1 and Combine opens with "+ Add a layer" open.
 *
 * From Combine, "New…" in the picker and "Edit product" on a layer open that kind's builder inside the same session;
 * its Done comes back here with the build (a new layer, or the layer rebuilt), and its × comes back here with the
 * graph as it was. finish.ts and sceneDraft.ts ask here through their hooks.
 */
import type { GraphNode } from '../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../store/useNodeGraphStore';
import { finishBuilder, setBuilderDoneHook } from '../builders/finish';
import {
  beginSceneDraft, confirmDiscardScene, discardingWhile, markSceneDraft, openKindCount, openSceneKind, sceneDraftChanged, sceneDraftGeneration, sceneDraftOpen, setSceneCloseHook,
} from '../builders/sceneDraft';
import { selectedBuiltScene, type SceneKind } from '../builders/sceneKinds';
import { editBuiltScene, startSceneKind } from '../builders/open';
import { writeParams } from '../splatBuilder/actions';
import { useBuilderWindows } from '../builders/windows';
import { useCombine } from './store';
import { applyCombine, checkCombineEdits } from './apply';
import { CB_BUILD, findCombineBuild } from './meta';
import { emptyCombine, nextLayerId, normalizeCombine, removeLayer, type CombineLayer, type CombineSpec, type NodeRef, type ProductRef, type VerbId } from './spec';

// ── Coming back to Combine ───────────────────────────────────────────────────

interface Return {
  mode: 'addToThis' | 'new' | 'edit';
  /** The session it belongs to (a new session, or back to the kinds, forgets it). */
  gen: number;
  spec: CombineSpec;
  anchorId: string | null;
  /** New…: the layer the new one goes on (null: it is the base). */
  on: string | null;
  /** Edit product: the layer. */
  layerId?: string;
  /** The graph when Combine handed over (× on the builder puts it back). */
  before: GraphNode[] | null;
  at: number;
}
let ret: Return | null = null;

const isOutput = (n: GraphNode) => n.type === 'output' || n.type === 'vec4Output';

/** What fed the Output: a build's picture as its builder wired it. */
function outputWire(nodes: readonly GraphNode[]): NodeRef | null {
  const c = nodes.find(n => isOutput(n) && n.inputs.color?.connection)?.inputs.color.connection;
  return c && !nodes.find(n => n.id === c.nodeId)?.params[CB_BUILD] ? { nodeId: c.nodeId, outputKey: c.outputKey } : null;
}

/** The product a builder's Done made (its nodes `ids`): the build they belong to, or the node it wired to the Output. */
export function productOfFinished(nodes: readonly GraphNode[], ids: ReadonlyArray<string | null | undefined>): ProductRef | null {
  const out = outputWire(nodes);
  const b = selectedBuiltScene(nodes, ids.filter((x): x is string => typeof x === 'string'));
  if (b && b.kind !== 'combine') return { kind: 'build', scene: b.kind, id: b.id, ...(out ? { out } : {}) };
  return out ? { kind: 'node', nodeId: out.nodeId, output: out.outputKey } : null;
}

function onBuilderDone(close: () => void, ids: ReadonlyArray<string | null | undefined>): boolean {
  const r = ret;
  if (!r || useCombine.getState().open || !sceneDraftOpen() || r.gen !== sceneDraftGeneration()) return false;
  // Add to this… is a moment: its Done follows at once (or fails and stays open: then a later Done is a plain one).
  if (r.mode === 'addToThis' && Date.now() - r.at > 60_000) { ret = null; return false; }
  ret = null;
  close();
  const product = productOfFinished(useNodeGraphStore.getState().nodes, ids);
  const c = useCombine.getState();
  if (r.mode === 'addToThis') {
    const spec: CombineSpec = { v: 1, layers: product ? [{ id: 'L1', product, verb: 'base', settings: {} }] : [] };
    c.openWith(spec, { picker: { on: product ? 'L1' : null, product: null }, selected: product ? 'L1' : null });
  } else if (r.mode === 'new') {
    if (product && r.on === null) {
      const spec = structuredClone(r.spec);
      const id = nextLayerId(spec);
      spec.layers.unshift({ id, product, verb: 'base', settings: {} });
      c.openWith(spec, { anchorId: r.anchorId, selected: id });
    } else c.openWith(r.spec, { anchorId: r.anchorId, picker: product ? { on: r.on, product } : null });
  } else c.openWith(r.spec, { anchorId: r.anchorId, selected: r.layerId ?? null });
  syncCombine();
  return true;
}

async function onSceneClose(close: () => void): Promise<boolean> {
  const r = ret;
  if (!r || r.mode === 'addToThis' || useCombine.getState().open || r.gen !== sceneDraftGeneration()) return false;
  if (sceneDraftChanged() && !(await confirmDiscardScene())) return true;
  ret = null;
  discardingWhile(close);
  if (r.before) undoManager.quietly(() => useNodeGraphStore.getState().setNodesRewritten(r.before!));
  useCombine.getState().openWith(r.spec, { anchorId: r.anchorId, selected: r.layerId ?? null });
  syncCombine();
  markSceneDraft();
  return true;
}

let hooked = false;
function hook(): void {
  if (hooked) return;
  hooked = true;
  setBuilderDoneHook(onBuilderDone);
  setSceneCloseHook(onSceneClose);
}

/** Whether "Add to this…" belongs next to this builder's Done: one kind's window open in a session, not Combine's. */
export function addToThisOffered(): boolean {
  if (!sceneDraftOpen()) return false;
  // A builder Combine opened (New…, Edit product): its Done already goes back to Combine.
  if (ret && ret.mode !== 'addToThis' && ret.gen === sceneDraftGeneration()) return false;
  const kind = openSceneKind();
  if (!kind || kind === 'combine') return false;
  // A window over another kind's (the Warp Builder on the 2D builder's blocks): its Done goes back there.
  return openKindCount() === 1 && !useBuilderWindows.getState().agentRules;
}

/**
 * "Add to this…": the builder's own Done (`done`), and then, rather than closing the session, its build becomes
 * layer 1 of a new Combine stack with "+ Add a layer" open.
 */
export function addToThis(done: () => void | Promise<void>): void {
  hook();
  ret = { mode: 'addToThis', gen: sceneDraftGeneration(), spec: emptyCombine(), anchorId: null, on: null, before: null, at: Date.now() };
  void done();
}

// ── Opening ──────────────────────────────────────────────────────────────────

/** Combine on a new stack (the kind page's Combine): "+ Add a layer" open on its base. */
export function openNewCombine(): void {
  hook();
  beginSceneDraft();
  useCombine.getState().openWith(emptyCombine(), { picker: { on: null, product: null } });
  markSceneDraft();
}

/** Combine on the build anchored at (or with a glue node) `anyId`, as it was built. False when there is none. */
export function editCombine(anchorId: string): boolean {
  hook();
  beginSceneDraft();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const found = findCombineBuild(nodes, anchorId);
  const spec = found ? normalizeCombine(found.meta.spec) : null;
  if (!found || !spec) return false;
  const edits = checkCombineEdits(nodes, anchorId);
  useCombine.getState().openWith(spec, { anchorId });
  if (edits.params.length || edits.wires.length) useCombine.getState().setEdits(edits);
  syncCombine();
  markSceneDraft();
  return true;
}

// ── Building into the draft ──────────────────────────────────────────────────

const silent = (k: string) => k === '__comment' || k.startsWith('_') || k === 'combine';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** How `next` differs from `prev`: null when the wiring or the nodes changed (a rebuild), else the params per node. */
function paramDiff(prev: readonly GraphNode[], next: readonly GraphNode[]): Array<{ id: string; live: Record<string, unknown>; silent: Record<string, unknown> }> | null {
  if (prev.length !== next.length) return null;
  const old = new Map(prev.map(n => [n.id, n]));
  const out: Array<{ id: string; live: Record<string, unknown>; silent: Record<string, unknown> }> = [];
  const wires = (x: GraphNode) => JSON.stringify(Object.entries(x.inputs).map(([k, s]) => [k, s.connection?.nodeId ?? '', s.connection?.outputKey ?? '']));
  for (const n of next) {
    const o = old.get(n.id);
    if (!o || o.type !== n.type) return null;
    if (wires(o) !== wires(n) || JSON.stringify(Object.keys(o.outputs)) !== JSON.stringify(Object.keys(n.outputs))) return null;
    if (o.params === n.params) continue;
    const live: Record<string, unknown> = {}, quiet: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(o.params), ...Object.keys(n.params)])) {
      if (same(o.params[k], n.params[k])) continue;
      if (!(k in n.params) || k === 'subgraph') return null;
      (silent(k) ? quiet : live)[k] = n.params[k];
    }
    if (Object.keys(live).length || Object.keys(quiet).length) out.push({ id: n.id, live, silent: quiet });
  }
  return out;
}

/**
 * Build the stack into the draft graph, quietly (the session's Done is the undo step). Only params changed: written as
 * live uniforms, no recompile. `restore`: drop your hand edits on the glue (Rebuild it).
 */
export function syncCombine(o: { restore?: boolean } = {}): void {
  const c = useCombine.getState();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const anchor = c.anchorId && nodes.some(n => n.id === c.anchorId) ? c.anchorId : null;
  const r = applyCombine(nodes, c.spec, { nextId: () => useNodeGraphStore.getState().newNodeId(), anchorId: anchor, isolate: c.isolate, restore: o.restore });
  const diff = paramDiff(nodes, r.nodes);
  if (!diff) undoManager.quietly(() => useNodeGraphStore.getState().setNodesRewritten(r.nodes));
  else if (diff.length) writeParams(diff);
  const info: Record<string, { problem?: string; passes: number }> = {};
  for (const [id, l] of Object.entries(r.build.layers)) info[id] = { problem: l.problem, passes: l.passes };
  useCombine.getState().setAnchor(r.anchorId);
  useCombine.getState().setBuilt(r.build.warnings, info);
}

/** Change the stack (one step of Combine's own undo) and build it. */
export function editCombineSpec(fn: (s: CombineSpec) => void): void {
  useCombine.getState().edit(fn);
  syncCombine();
}

/** A layer's settings (a slider, a picker). */
export function setLayerSetting(layerId: string, key: string, value: number | string | boolean): void {
  editCombineSpec(s => { const l = s.layers.find(x => x.id === layerId); if (l) l.settings[key] = value; });
}

export function updateLayer(layerId: string, fn: (l: CombineLayer) => void): void {
  editCombineSpec(s => { const l = s.layers.find(x => x.id === layerId); if (l) fn(l); });
}

/** Add a layer: `product` joined to layer `on` by `verb` (no `on`: the base). Selects it and closes the picker. */
export function addLayer(product: ProductRef, verb: VerbId | 'base', on: string | null, settings: CombineLayer['settings'] = {}): string {
  const id = nextLayerId(useCombine.getState().spec);
  editCombineSpec(s => {
    const layer: CombineLayer = { id, product, verb: on === null ? 'base' : verb, settings: { ...settings } };
    if (on !== null) {
      const below = s.layers[s.layers.length - 1];
      if (!below || below.id !== on) layer.on = on;
    }
    if (on === null) s.layers.unshift(layer); else s.layers.push(layer);
  });
  const c = useCombine.getState();
  c.setPicker(null);
  c.select(id);
  return id;
}

export function deleteLayer(layerId: string): void {
  const c = useCombine.getState();
  if (c.isolate === layerId) c.setIsolate(null);
  c.replace(removeLayer(c.spec, layerId));
  syncCombine();
  const left = useCombine.getState().spec.layers;
  if (!left.some(l => l.id === useCombine.getState().selected)) useCombine.getState().select(left[left.length - 1]?.id ?? null);
}

export function toggleLayerMute(layerId: string): void {
  updateLayer(layerId, l => { l.muted = !l.muted; });
}

/** Click a layer: select it and show the stack up to it alone; click it again (or Esc): the whole stack. */
export function isolateLayer(layerId: string | null): void {
  const c = useCombine.getState();
  const top = c.spec.layers[c.spec.layers.length - 1]?.id;
  c.setIsolate(layerId && layerId !== top && c.isolate !== layerId ? layerId : null);
  if (layerId) c.select(layerId);
  syncCombine();
}

export function undoCombine(): void { useCombine.getState().undo(); syncCombine(); }
export function redoCombine(): void { useCombine.getState().redo(); syncCombine(); }

/** Keep my edits (the default: they are kept) / Rebuild it (the glue as the spec makes it). */
export function answerEdits(rebuild: boolean): void {
  useCombine.getState().setEdits(null);
  if (rebuild) syncCombine({ restore: true });
}

// ── Other builders, inside the session ──────────────────────────────────────

/** "New…" in the picker: that kind's builder, coming back here with its build as a new layer on `on`. */
export function newProductIn(kind: SceneKind, on: string | null): void {
  hook();
  const c = useCombine.getState();
  ret = { mode: 'new', gen: sceneDraftGeneration(), spec: structuredClone(c.spec), anchorId: c.anchorId, on, before: useNodeGraphStore.getState().nodes, at: Date.now() };
  c.close();
  startSceneKind(kind);
}

/** "Edit product": the layer's build in its own builder, coming back here (rebuilt) when it is done. */
export function editLayerProduct(layerId: string): boolean {
  const c = useCombine.getState();
  const layer = c.spec.layers.find(l => l.id === layerId);
  if (!layer || layer.product.kind !== 'build') return false;
  hook();
  const p = layer.product;
  ret = { mode: 'edit', gen: sceneDraftGeneration(), spec: structuredClone(c.spec), anchorId: c.anchorId, on: null, layerId, before: useNodeGraphStore.getState().nodes, at: Date.now() };
  c.setIsolate(null);
  c.close();
  return editBuiltScene({ kind: p.scene, id: p.id });
}

/** Add a node to the draft graph beside the products (a Texture Input picked in the picker). Returns its id. */
export function addProductNode(node: GraphNode): string {
  const nodes = useNodeGraphStore.getState().nodes;
  const xs = nodes.filter(n => !isOutput(n) && !n.params[CB_BUILD]).map(n => n.position);
  const at = xs.length ? { x: Math.min(...xs.map(p => p.x)) - 380, y: Math.max(...xs.map(p => p.y)) + 220 } : { x: 0, y: 0 };
  const placed = { ...node, position: at };
  undoManager.quietly(() => useNodeGraphStore.getState().setNodesRewritten([...nodes, placed]));
  return placed.id;
}

// ── Done ─────────────────────────────────────────────────────────────────────

/** The glue (and the products) to frame once the window is gone. */
function frameIds(): string[] {
  const c = useCombine.getState();
  const nodes = useNodeGraphStore.getState().nodes;
  const found = c.anchorId ? findCombineBuild(nodes, c.anchorId) : null;
  return found ? [...found.byRole.values()].map(n => n.id) : [];
}

/** Done: the whole stack shown (no layer isolated), then into the graph as one undo step. */
export function finishCombine(): void {
  const c = useCombine.getState();
  if (c.isolate) { c.setIsolate(null); syncCombine(); }
  ret = null;
  finishBuilder(() => useCombine.getState().close(), frameIds());
}

/** ×: closes (the session asks first when there are changes, and puts the graph back). */
export function closeCombine(): void {
  ret = null;
  useCombine.getState().close();
}
