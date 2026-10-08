/**
 * actions.ts — the 2D Scene Builder joined to the graph: open it on a new scene or on a build
 * that is already there, and Build / Rebuild into the graph (apply.ts does the work).
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { toast } from '../components/ui/toastStore';
import { useSceneBuilder2D } from './store';
import { applyScene2D, find2dBuild, scene2dOfBuild } from './apply';
import { starterScene } from './spec';

/** Open the builder on a new scene (Build adds it beside what is on the canvas). */
export function openNewSceneBuilder2D(at?: { x: number; y: number }): void {
  useSceneBuilder2D.getState().openWith(starterScene(), { at: at ?? null });
}

/** The 2D build a node belongs to (its UV node's id), if the 2D builder made it. */
export function builder2dSceneOf(nodeId: string): string | null {
  return scene2dOfBuild(useNodeGraphStore.getState().nodes, nodeId);
}

/** Open the builder on the build `nodeId` belongs to. False when it isn't a 2D build. */
export function editScene2DInBuilder(nodeId: string): boolean {
  const nodes = useNodeGraphStore.getState().nodes;
  const sceneId = scene2dOfBuild(nodes, nodeId);
  const found = sceneId ? find2dBuild(nodes, sceneId) : null;
  if (!found) return false;
  useSceneBuilder2D.getState().openWith(found.meta.spec, { targetSceneId: sceneId });
  return true;
}

/** Rebuild a 2D scene from its recipe, dropping changes made on its nodes by hand. */
export function rebuildScene2DFromRecipe(sceneId: string): boolean {
  const nodes = useNodeGraphStore.getState().nodes;
  const found = find2dBuild(nodes, sceneId);
  if (!found) return false;
  const result = applyScene2D(nodes, found.meta.spec, { nextId: () => useNodeGraphStore.getState().newNodeId(), sceneId, restore: true });
  useNodeGraphStore.getState().setNodesRewritten(result.nodes, 'Rebuilt the 2D scene from its recipe');
  toast.success('Rebuilt from the recipe', { message: 'Changes made on its nodes by hand are gone. Undo brings them back.' });
  return true;
}

/** Build (or rebuild) the builder's scene into the graph. */
export function buildFromBuilder2D(asNew = false): boolean {
  const sb = useSceneBuilder2D.getState();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const target = sb.targetSceneId && nodes.some(n => n.id === sb.targetSceneId) ? sb.targetSceneId : null;
  const fresh = asNew || !target;
  const result = applyScene2D(nodes, sb.scene, {
    nextId: () => useNodeGraphStore.getState().newNodeId(),
    sceneId: fresh ? null : target, asNew: fresh, at: sb.at ?? undefined,
  });
  useNodeGraphStore.getState().setNodesRewritten(result.nodes, fresh ? 'Built a 2D scene' : 'Rebuilt the 2D scene');
  useNodeGraphStore.getState().focusNode(result.focusId);
  sb.setTarget(result.sceneId);
  sb.markBuilt();
  const notes = [
    ...(result.kept.length ? [`Kept ${result.kept.length} setting${result.kept.length === 1 ? '' : 's'} you changed on the nodes.`] : []),
    ...result.warnings,
  ];
  (result.warnings.length ? toast.warning : toast.success)(fresh ? '2D scene built' : '2D scene rebuilt', {
    message: notes.length ? notes.join(' ') : 'Every node has a note. Open the 2D Scene Builder from its UV node to change it here again.',
  });
  return true;
}
