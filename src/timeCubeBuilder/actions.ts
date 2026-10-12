/**
 * actions.ts — the Time Cube builder joined to the graph (docs/timecube-builder.md), as the Splat builder is:
 *
 *   - opening on a new scene builds it at once (one undo step, "Time Cube builder: built a time cube"), since the
 *     builder's picture is the main preview's;
 *   - each change after that is synced quietly, once a frame at most: a change of settings only writes the nodes'
 *     params and their uniforms (no recompile; a mode or a switch compiles once); Cube ⇄ Stack or the LFO on or off
 *     rewires, keeping each node's id by role;
 *   - a built node changed elsewhere (its card, the clip editor, Choose video) is taken back into the builder;
 *   - closing (Done, ×, back to the kinds) makes the session one undo step. Nothing is ever left unbuilt, so there is
 *     no draft to keep: the graph has every edit.
 */
import type { GraphNode } from '../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../store/useNodeGraphStore';
import { intoView } from '../components/NodeGraph/spawnPoint';
import { finishBuilder } from '../builders/finish';
import { paramDiff } from '../splatBuilder/apply';
import { writeParams } from '../splatBuilder/actions';
import { useTimeCubeBuilder } from './store';
import { applyTimeCube, findTcBuild, specOfBuild, tcBuildIds, timeCubeOfBuild } from './apply';
import { presetSpec } from './presets';
import type { TcSection, TimeCubeSpec } from './spec';

let session: { base: GraphNode[]; spec: string } | null = null;
let lastSynced: TimeCubeSpec | null = null;

const startSession = () => { session = { base: useNodeGraphStore.getState().nodes, spec: JSON.stringify(useTimeCubeBuilder.getState().spec) }; };

/** Open the builder on a new scene (the Box of time preset), built into the graph at once. */
export function openNewTimeCube(at?: { x: number; y: number }, spec: TimeCubeSpec = presetSpec('box')): string | null {
  useTimeCubeBuilder.getState().openWith(spec, { at: at ?? null });
  const id = syncTimeCubeBuilder({ first: true });
  startSession();
  return id;
}

/** Open the builder on the build `nodeId` belongs to, as it is now. False when it isn't one. */
export function editTimeCubeInBuilder(nodeId: string, section?: TcSection): boolean {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const id = timeCubeOfBuild(nodes, nodeId);
  const spec = id ? specOfBuild(nodes, id) : null;
  if (!id || !spec) return false;
  useTimeCubeBuilder.getState().openWith(spec, { targetId: id, section });
  lastSynced = useTimeCubeBuilder.getState().spec;
  startSession();
  return true;
}

/** The Time Cube a top-level node's build belongs to (right-click → Edit in Time Cube builder), or null. */
export const builderTimeCubeOf = (nodeId: string): string | null => timeCubeOfBuild(useNodeGraphStore.getState().nodes, nodeId);

/**
 * Build the builder's scene into the graph: the first time as an undo step of its own, afterwards quietly (params
 * only when nothing is rewired). Returns the Time Cube's id.
 */
export function syncTimeCubeBuilder(o: { first?: boolean } = {}): string | null {
  const tb = useTimeCubeBuilder.getState();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const target = tb.targetId && findTcBuild(nodes, tb.targetId) ? tb.targetId : null;
  const result = applyTimeCube(nodes, tb.spec, { nextId: () => useNodeGraphStore.getState().newNodeId(), sourceId: target, at: tb.at ?? undefined });
  if (!target) {
    const placed = intoView(nodes, result.nodes, tb.at ? 'ifOutOfView' : 'centre');
    if (o.first) useNodeGraphStore.getState().setNodesRewritten(placed, 'Time Cube builder: built a time cube');
    else undoManager.quietly(() => useNodeGraphStore.getState().setNodesRewritten(placed));
  } else {
    const diff = paramDiff(nodes, result.nodes);
    if (!diff) undoManager.quietly(() => useNodeGraphStore.getState().setNodesRewritten(result.nodes));
    else if (diff.length) writeParams(diff);
  }
  lastSynced = useTimeCubeBuilder.getState().spec;
  if (tb.targetId !== result.sourceId) useTimeCubeBuilder.getState().setTarget(result.sourceId);
  return result.sourceId;
}

/**
 * A built node changed outside the builder (its card's Choose video or Edit clip…, a slider on the card): the builder
 * takes the graph's settings, so it shows them and its next sync keeps them. No undo step of the builder's own.
 */
export function adoptFromGraph(): boolean {
  const tb = useTimeCubeBuilder.getState();
  // An edit of the builder's not built yet wins (the next sync writes it).
  if (!tb.open || !tb.targetId || tb.spec !== lastSynced) return false;
  const now = specOfBuild(useNodeGraphStore.getState().nodes, tb.targetId);
  if (!now) return false;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const role = tb.spec.display === 'cube' ? 'view' : 'stack';
  // Only the built parts: the display shown and the LFO on or off are the builder's to say.
  if (now.display !== tb.spec.display) return false;
  if (same(now.source, tb.spec.source) && same(now[role], tb.spec[role]) && (!tb.spec.drive.on || !now.drive.on || same(now.drive, tb.spec.drive))) return false;
  const next: TimeCubeSpec = { ...tb.spec, source: now.source, [role]: now[role], drive: tb.spec.drive.on && now.drive.on ? now.drive : tb.spec.drive };
  lastSynced = next;
  tb.adopt(next);
  return true;
}

/** Close the window: the session's changes become one undo step. */
export function closeTimeCubeBuilder(): void {
  if (useTimeCubeBuilder.getState().open && lastSynced !== useTimeCubeBuilder.getState().spec) syncTimeCubeBuilder();
  const tb = useTimeCubeBuilder.getState();
  if (session && JSON.stringify(tb.spec) !== session.spec) undoManager.push(session.base, { label: 'Time Cube builder: changed the time cube', nodeIds: tcBuildIds(useNodeGraphStore.getState().nodes, tb.targetId) });
  session = null;
  tb.close();
}

/** Done: build what isn't yet, close, and frame the scene on the graph. */
export function finishTimeCubeBuilder(): void {
  const id = useTimeCubeBuilder.getState().targetId;
  finishBuilder(closeTimeCubeBuilder, tcBuildIds(useNodeGraphStore.getState().nodes, id));
}

/** Open as nodes: Done, with the display node selected. */
export function openTimeCubeAsNodes(): void {
  const id = useTimeCubeBuilder.getState().targetId;
  const b = id ? findTcBuild(useNodeGraphStore.getState().nodes, id) : null;
  const show = b?.byRole.get('view') ?? b?.byRole.get('stack');
  finishTimeCubeBuilder();
  if (show && useNodeGraphStore.getState().nodes.some(n => n.id === show.id)) useNodeGraphStore.getState().focusNode(show.id);
}
