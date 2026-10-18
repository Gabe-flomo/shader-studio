/**
 * actions.ts — the 2D Scene Builder joined to the graph: open it on a new scene or on a build
 * that is already there, and Build / Rebuild into the graph (apply.ts does the work).
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { intoView } from '../components/NodeGraph/spawnPoint';
import { toast } from '../components/ui/toastStore';
import { useSceneBuilder2D } from './store';
import { applyScene2D, find2dBuild, scene2dOfBuild } from './apply';
import { allShapes, starterScene } from './spec';
import { clearDraft, hasUnbuiltEdits, reopenDraft } from '../builders/drafts';
import type { BuildingBuilder } from '../builders/finish';
import { beginSceneDraft, sceneDraftOpen } from '../builders/sceneDraft';
import { attachQuickControls } from './quickPlay';
import { can } from '../lib/plan';
import { paletteSwatches } from '../builders/look/palette';
import { addMovedToPlay, hasMovableLook, lookToFinish, withoutMovedLook, type LookMove } from '../builders/look/toFinish';
import type { Scene2D } from './spec';

/**
 * The Look's older whole-picture settings (Grade cards, vignette, grain) as a move into the graph's
 * one Finish (builders/look/toFinish.ts): the same maths as Finish effects, controls on their nodes
 * moved with them. Only where the Finish plays (Pro); on Free they stay nodes. Null when nothing moves.
 * Nothing changes until the build that uses it has worked (buildFromBuilder2D).
 */
function lookMoveFor(scene: Scene2D, found: ReturnType<typeof find2dBuild>): LookMove | null {
  if (!can('play.finish') || !hasMovableLook(scene.look)) return null;
  const move = lookToFinish(scene.look, { swatches: paletteSwatches(scene.look.colour.palette, scene.look.custom), byRole: found?.byRole });
  return move.effects.length ? move : null;
}

/** Open the builder on a new scene (Build adds it beside what is on the canvas). */
export function openNewSceneBuilder2D(at?: { x: number; y: number }): void {
  // A Scene builder session (builders/sceneDraft.ts): Apply builds into a draft, Done puts it in the graph.
  beginSceneDraft();
  const fresh = () => useSceneBuilder2D.getState().openWith(starterScene(), { at: at ?? null });
  // A new scene left unbuilt last time comes back (builders/drafts.ts).
  if (reopenDraft({ kind: '2d', store: useSceneBuilder2D, target: null, original: starterScene(), label: '2D scene', startFresh: fresh,
    open: (scene, was) => useSceneBuilder2D.getState().openWith(scene, { at: at ?? was }) })) return;
  fresh();
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
  beginSceneDraft();
  const asBuilt = () => useSceneBuilder2D.getState().openWith(found.meta.spec, { targetSceneId: sceneId });
  // Edits to this scene left unbuilt last time come back (builders/drafts.ts).
  if (!reopenDraft({ kind: '2d', store: useSceneBuilder2D, target: sceneId, original: found.meta.spec, label: '2D scene', startFresh: asBuilt,
    open: scene => useSceneBuilder2D.getState().openWith(scene, { targetSceneId: sceneId }) })) asBuilt();
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
  // Grade, vignette and grain go to the graph's Finish (Pro), so the build no longer makes them as nodes.
  const move = lookMoveFor(sb.scene, fresh || !target ? null : find2dBuild(nodes, target));
  const scene = move ? { ...sb.scene, look: withoutMovedLook(sb.scene.look) } : sb.scene;
  const result = applyScene2D(nodes, scene, {
    nextId: () => useNodeGraphStore.getState().newNodeId(),
    sceneId: fresh ? null : target, asNew: fresh, at: sb.at ?? undefined,
  });
  // The build worked: the Finish gets the moved effects, tagged with this scene, replacing what an earlier move of it made.
  if (move) {
    useNodeGraphStore.getState().setPlay(p => addMovedToPlay(p, move, result.sceneId));
    sb.edit(d => { d.look = withoutMovedLook(d.look); });
  }
  const moved = move?.names ?? [];
  // A new scene lands in the visible canvas (where the builder was opened from, when it was).
  const placed = fresh ? intoView(nodes, result.nodes, sb.at ? 'ifOutOfView' : 'centre') : result.nodes;
  useNodeGraphStore.getState().setNodesRewritten(placed, fresh ? 'Built a 2D scene' : 'Rebuilt the 2D scene');
  useNodeGraphStore.getState().focusNode(result.focusId);
  sb.setTarget(result.sceneId);
  // Pictures that had no node got one: the builder reads them from now on.
  if (JSON.stringify(result.spec.textures ?? []) !== JSON.stringify(sb.scene.textures ?? [])) useSceneBuilder2D.setState(s => ({ scene: { ...s.scene, textures: result.spec.textures } }));
  sb.markBuilt();
  // Quick controls waiting for a build become Play controls now (quickPlay.ts).
  attachQuickControls(useSceneBuilder2D.getState().scene.quick);
  const notes = [
    ...(moved.length ? [`Moved ${moved.join(', ')} to the Finish (the whole picture's stack: the builder's Finish card, Play → Finish).`] : []),
    ...(result.kept.length ? [`Kept ${result.kept.length} setting${result.kept.length === 1 ? '' : 's'} you changed on the nodes.`] : []),
    ...result.warnings,
  ];
  // In the Scene builder this is Apply (or Done's last step): nothing to announce unless there is something to say.
  if (sceneDraftOpen()) {
    if (notes.length) (result.warnings.length ? toast.warning : toast.info)('Applied', { message: notes.join(' ') });
    return true;
  }
  (result.warnings.length ? toast.warning : toast.success)(fresh ? '2D scene built' : '2D scene rebuilt', {
    message: notes.length ? notes.join(' ') : 'Every node has a note. Open the 2D Scene Builder from its UV node to change it here again.',
  });
  return true;
}

/** Whether the scene has to be built: not built yet (or its build is gone), or changed since. Nothing to build without shapes or a grid. */
function needsBuild2D(): boolean {
  const sb = useSceneBuilder2D.getState();
  if (!allShapes(sb.scene).length && !sb.scene.grid) return false;
  const built = !!sb.targetSceneId && !!find2dBuild(useNodeGraphStore.getState().nodes, sb.targetSceneId);
  return !built || sb.dirty;
}

/** The top-level nodes of the builder's build (what Done frames). */
function builtIds2D(): string[] {
  const id = useSceneBuilder2D.getState().targetSceneId;
  const b = id ? find2dBuild(useNodeGraphStore.getState().nodes, id) : null;
  return b ? [b.scene.id, ...[...b.byRole.values()].map(n => n.id)] : [];
}

/**
 * The 2D builder as builders/finish.ts drives it: Done builds (or rebuilds, same ids) and then closes,
 * a failed build stays open; ✕ and Esc ask about unbuilt edits.
 */
export const scene2dBuilder: BuildingBuilder = {
  label: '2D scene',
  needsBuild: needsBuild2D,
  unbuiltEdits: () => hasUnbuiltEdits(useSceneBuilder2D.getState()) && needsBuild2D(),
  build: () => buildFromBuilder2D(false),
  close: () => useSceneBuilder2D.getState().close(),
  ids: builtIds2D,
  discard: () => clearDraft('2d', useSceneBuilder2D.getState().targetSceneId),
};
