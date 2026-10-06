/**
 * actions.ts — the Scene Builder and the node graph together: open the builder
 * on a scene it made (Edit in Scene Builder), describe the graph on screen,
 * and build or rebuild into it.
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { askChoice } from '../components/ui/dialogStore';
import { toast } from '../components/ui/toastStore';
import { spawnPoint } from '../components/NodeGraph/spawnPoint';
import { META_KEY, type SceneBuilderMeta } from './build';
import { applyScene, checkEdits, sceneOfBuild } from './apply';
import { describeGraph } from './recognize';
import { useSceneBuilder } from './store';

/** The builder scene a node belongs to (its Scene Group's id), if any. */
export function builderSceneOf(nodeId: string): string | null {
  return sceneOfBuild(useNodeGraphStore.getState().nodes, nodeId);
}

/** Open the builder on the scene `nodeId` belongs to. False when the builder didn't make it. */
export function editSceneInBuilder(nodeId: string): boolean {
  const nodes = useNodeGraphStore.getState().nodes;
  const sceneId = sceneOfBuild(nodes, nodeId);
  const scene = sceneId ? nodes.find(n => n.id === sceneId) : null;
  const meta = scene?.params[META_KEY] as SceneBuilderMeta | undefined;
  if (!sceneId || !meta) return false;
  useSceneBuilder.getState().openWith(meta.spec, { targetSceneId: sceneId, tab: 'shapes' });
  return true;
}

/** Describe the graph's 3D scene and show it on the builder's Describe tab. */
export function describeIntoBuilder(): boolean {
  const d = describeGraph(useNodeGraphStore.getState().nodes);
  const sb = useSceneBuilder.getState();
  if (!d) {
    if (sb.open) sb.setDescribe(null);
    toast.info('No 3D scene to describe', { message: 'Describe reads a graph with a March Loop (or GI Lit March, or Glass Scene) wired to a Scene Group.' });
    return false;
  }
  if (sb.open) { sb.setDescribe(d); sb.setTab('describe'); }
  else sb.openWith(d.spec, { tab: 'describe', describe: d, targetSceneId: null });
  return true;
}

/** Build the builder's spec into the graph: a rebuild of its target, or a new scene. */
export async function buildFromBuilder(asNew = false): Promise<boolean> {
  const sb = useSceneBuilder.getState();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const target = sb.targetSceneId && nodes.some(n => n.id === sb.targetSceneId) ? sb.targetSceneId : null;
  let rebuildAsNew = asNew || !target;
  if (target && !asNew) {
    const report = checkEdits(nodes, target, sb.spec);
    if (report.lost.length) {
      const list = report.lost.slice(0, 4).join(' ') + (report.lost.length > 4 ? ` And ${report.lost.length - 4} more.` : '');
      const choice = await askChoice('Rebuild this scene?', [
        { id: 'new', label: 'Build a new copy' },
        { id: 'replace', label: 'Rebuild anyway', variant: 'danger' },
      ], { message: `You changed the built graph in ways a rebuild can't keep. ${list}${report.kept.length ? ` (${report.kept.length} other setting${report.kept.length === 1 ? '' : 's'} you changed will be kept.)` : ''}` });
      if (!choice || choice === 'cancel') return false;
      rebuildAsNew = choice === 'new';
    }
  }
  const result = applyScene(nodes, sb.spec, {
    nextId: () => useNodeGraphStore.getState().newNodeId(),
    sceneId: rebuildAsNew ? null : target, asNew: rebuildAsNew, at: sb.at ?? spawnPoint(),
  });
  useNodeGraphStore.getState().setNodesRewritten(result.nodes, rebuildAsNew ? 'Built a 3D scene' : 'Rebuilt the 3D scene');
  useNodeGraphStore.getState().focusNode(result.focusId);
  sb.setTarget(result.sceneId);
  sb.markBuilt();
  const notes = [
    ...(result.kept.length ? [`Kept ${result.kept.length} setting${result.kept.length === 1 ? '' : 's'} you changed on the nodes.`] : []),
    ...result.warnings,
  ];
  (result.warnings.length ? toast.warning : toast.success)(rebuildAsNew ? '3D scene built' : '3D scene rebuilt', {
    message: notes.length ? notes.join(' ') : 'Every node has a note. Right-click the Scene Group → Edit in Scene Builder to change it here again.',
  });
  return true;
}
