/**
 * actions.ts — the Splat builder joined to the graph (docs/splat-builder.md).
 *
 * The scan is drawn by the main preview's raster pass, so the builder's picture is the main preview, mirrored, and
 * every change is built into the graph at once:
 *
 *   - opening on a new scene builds it (one undo step, "Splat builder: built a splat scene");
 *   - each change after that is synced quietly: a change of settings only writes the nodes' params (live uniforms,
 *     no recompile); a change of what is wired (an effect added, the world turned on) rebuilds, keeping ids by role;
 *   - closing (Done, ×, back to the kinds) folds the session's changes into one undo step.
 */
import type { GraphNode } from '../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../store/useNodeGraphStore';
import { intoView } from '../components/NodeGraph/spawnPoint';
import { finishBuilder } from '../builders/finish';
import { paramBindingKey } from '../compiler/uniformPatcher';
import { useSplatBuilder } from './store';
import { adoptCustomChains, applySplatScene, findSplatBuild, paramDiff, splatSceneOfBuild } from './apply';
import { normalizeSpec, starterSplatScene, type SplatBuilderSpec, type SplatSection } from './spec';

/** The graph as the session started (after the first build), and the spec then: what closing compares with. */
let session: { base: GraphNode[]; spec: string } | null = null;
/** The spec last built into the graph (closing builds a change that hasn't been yet). */
let lastSynced: SplatBuilderSpec | null = null;

const startSession = () => { session = { base: useNodeGraphStore.getState().nodes, spec: JSON.stringify(useSplatBuilder.getState().spec) }; };

/** Open the builder on a new splat scene, built into the graph at once. */
export function openNewSplatScene(at?: { x: number; y: number }, spec: SplatBuilderSpec = starterSplatScene()): string | null {
  useSplatBuilder.getState().openWith(spec, { at: at ?? null });
  const id = syncSplatBuilder({ first: true });
  startSession();
  return id;
}

/** Open the builder on the splat scene `nodeId` belongs to, as it was built. False when it isn't one. */
export function editSplatSceneInBuilder(nodeId: string, section?: SplatSection): boolean {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const scanId = splatSceneOfBuild(nodes, nodeId);
  const found = scanId ? findSplatBuild(nodes, scanId) : null;
  if (!found) return false;
  // Nodes you added on the card since (Splat Attributes → … → Set Splat) join the stack as "Your nodes", in their place.
  useSplatBuilder.getState().openWith(adoptCustomChains(nodes, scanId!, normalizeSpec(found.meta.spec)), { targetId: scanId, section });
  lastSynced = useSplatBuilder.getState().spec;
  startSession();
  return true;
}

/** The Splat Scene a top-level node's build belongs to (right-click → Edit in Splat builder), or null. */
export const builderSplatSceneOf = (nodeId: string): string | null => splatSceneOfBuild(useNodeGraphStore.getState().nodes, nodeId);

/** The top-level nodes a build is made of. */
export function splatBuildIds(scanId: string | null | undefined): string[] {
  if (!scanId) return [];
  const b = findSplatBuild(useNodeGraphStore.getState().nodes, scanId);
  return b ? [...b.byRole.values()].map(x => x.id) : [];
}

/**
 * A change of settings only: every changed param of every node, and the picture's uniforms for them, in ONE store
 * write (a slider tick changes the node it sets and the spec saved on the Splat Scene), so the graph and the preview
 * see one update a tick. Nothing is rebuilt or recompiled: same nodes, same wires, new uniform values, as a node card's
 * slider does. Before this the params went in without their uniforms and asked for a full compile 500 ms after the
 * last tick, so the picture stood still while a slider moved and caught up half a second after it stopped.
 *
 * A param the picture has no uniform for (a mode, a string) compiles at once. Groups (the world's materials) take
 * theirs through updateNodeParams, which passes a group's `inner::param` keys on to its inside.
 */
function writeParams(diff: NonNullable<ReturnType<typeof paramDiff>>): void {
  const st = useNodeGraphStore.getState();
  const groups = new Set(st.nodes.filter(n => n.type === 'group' || n.type === 'agentsGroup').map(n => n.id));
  const by = new Map<string, Record<string, unknown>>();
  const viaGroup: typeof diff = [];
  const uniforms: Record<string, number | number[]> = {};
  let allUniforms = true;
  for (const d of diff) {
    if (groups.has(d.id) && Object.keys(d.live).length) {
      viaGroup.push(d);
      if (Object.keys(d.silent).length) by.set(d.id, d.silent);
      continue;
    }
    by.set(d.id, { ...d.silent, ...d.live });
    for (const [k, v] of Object.entries(d.live)) {
      const name = uniformOf(st, d.id, k, v);
      if (name) uniforms[name] = v as number | number[]; else allUniforms = false;
    }
  }
  const push = allUniforms && Object.keys(uniforms).length > 0;
  if (by.size) {
    useNodeGraphStore.setState(s => ({
      nodes: s.nodes.map(n => (by.has(n.id) ? { ...n, params: { ...n.params, ...by.get(n.id) } } : n)),
      ...(push ? { paramUniforms: { ...s.paramUniforms, ...uniforms } } : {}),
    }));
  }
  if (!allUniforms) useNodeGraphStore.getState().compile();
  if (viaGroup.length) undoManager.quietly(() => { for (const d of viaGroup) useNodeGraphStore.getState().updateNodeParams(d.id, d.live, { immediate: true }); });
}

/** The picture's uniform for a node's param, when the value can go straight into it (a number, a vec3), else null. */
function uniformOf(st: ReturnType<typeof useNodeGraphStore.getState>, nodeId: string, key: string, value: unknown): string | null {
  const ok = typeof value === 'number' || (Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number'));
  if (!ok) return null;
  const name = st.paramBindings[paramBindingKey(nodeId, key)];
  return name && name in st.paramUniforms ? name : null;
}

/**
 * Build the builder's scene into the graph: the first time as an undo step of its own, afterwards quietly (params
 * only when nothing is rewired). Returns the Splat Scene's id.
 */
export function syncSplatBuilder(o: { first?: boolean } = {}): string | null {
  const sb = useSplatBuilder.getState();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const target = sb.targetId && findSplatBuild(nodes, sb.targetId) ? sb.targetId : null;
  const result = applySplatScene(nodes, sb.spec, { nextId: () => useNodeGraphStore.getState().newNodeId(), scanId: target, asNew: !target, at: sb.at ?? undefined });
  if (!target) {
    const placed = intoView(nodes, result.nodes, sb.at ? 'ifOutOfView' : 'centre');
    if (o.first) useNodeGraphStore.getState().setNodesRewritten(placed, 'Splat builder: built a splat scene');
    else undoManager.quietly(() => useNodeGraphStore.getState().setNodesRewritten(placed));
  } else {
    const diff = paramDiff(nodes, result.nodes);
    if (!diff) undoManager.quietly(() => useNodeGraphStore.getState().setNodesRewritten(result.nodes));
    else if (diff.length) writeParams(diff);
  }
  lastSynced = useSplatBuilder.getState().spec;
  if (sb.targetId !== result.scanId) useSplatBuilder.getState().setTarget(result.scanId);
  if (JSON.stringify(result.spec.textures ?? []) !== JSON.stringify(sb.spec.textures ?? [])) useSplatBuilder.setState(s => ({ spec: { ...s.spec, textures: result.spec.textures } }));
  return result.scanId;
}

/** Close the window: the session's changes become one undo step. */
export function closeSplatBuilder(): void {
  if (useSplatBuilder.getState().open && lastSynced !== useSplatBuilder.getState().spec) syncSplatBuilder();
  const sb = useSplatBuilder.getState();
  if (session && JSON.stringify(sb.spec) !== session.spec) undoManager.push(session.base, { label: 'Splat builder: changed the splat scene', nodeIds: splatBuildIds(sb.targetId) });
  session = null;
  sb.close();
}

/** Done: close, and frame the scene on the graph. */
export function finishSplatBuilder(): void {
  const id = useSplatBuilder.getState().targetId;
  finishBuilder(closeSplatBuilder, splatBuildIds(id));
}

/** Open as nodes: Done, with the Splat Scene selected (its card shows the scan and its modifier chain). */
export function openSplatAsNodes(): void {
  const id = useSplatBuilder.getState().targetId;
  finishSplatBuilder();
  if (id && useNodeGraphStore.getState().nodes.some(n => n.id === id)) useNodeGraphStore.getState().focusNode(id);
}
