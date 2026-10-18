/**
 * actions.ts — the Warp Builder joined to the rest (docs/warp-builder.md):
 *
 *  - open it new (the Scene builder's Warp kind), or on the 2D Scene Builder's space blocks (one
 *    block's "Open in Warp Builder", or the whole stack's);
 *  - Send to 2D Scene Builder: the stack into the open 2D scene's Space (in place of the blocks it
 *    came from), or a new 2D scene's;
 *  - Done: opened from the 2D builder, back to it with the blocks written in; opened new, a small
 *    graph (UV → the warp → the chosen preview look → Output), built by the 2D builder's own build
 *    so it reopens in the 2D builder too.
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { intoView } from '../components/NodeGraph/spawnPoint';
import { toast } from '../components/ui/toastStore';
import { finishBuilder } from '../builders/finish';
import { beginSceneDraft } from '../builders/sceneDraft';
import { useSceneBuilder2D } from '../sceneBuilder2d/store';
import { openNewSceneBuilder2D } from '../sceneBuilder2d/actions';
import { applyScene2D } from '../sceneBuilder2d/apply';
import { nextId, starterScene, type Scene2D, type SpaceOp } from '../sceneBuilder2d/spec';
import { starterWarp, spaceWithWarp, warpFromSpace, type PreviewMode, type WarpSpec } from './spec';
import { useWarpBuilder } from './store';

/** The Scene builder's Warp kind: a new warp. */
export function openNewWarpBuilder(): void {
  beginSceneDraft();
  useWarpBuilder.getState().openWith(starterWarp(), { kind: 'new' });
}

/**
 * Open on the 2D builder's space blocks: `ids` (one block, or several), or every block of the stack
 * (null). Done writes them back in place.
 */
export function openWarpFrom2D(ids: string[] | null): boolean {
  const space = useSceneBuilder2D.getState().scene.space;
  const warp = warpFromSpace(space, ids ?? undefined);
  const from = ids ?? space.filter(op => op.kind === 'block').map(op => op.id);
  useWarpBuilder.getState().openWith(warp.blocks.length ? warp : starterWarp(), { kind: '2d', ids: from.length ? from : null });
  return true;
}

/** A fresh space op id for the 2D scene `d`, not in `taken`. */
const idMaker = (d: Scene2D) => (taken: Set<string>) => {
  const probe = structuredClone(d);
  probe.space.push(...[...taken].map(id => ({ id, kind: 'zoom', values: {} }) as SpaceOp));
  return nextId(probe, 'p');
};

/** Write the warp into a 2D scene's space: in place of `ids`, else at the end. Pure on the scene. */
export function writeWarpInto(d: Scene2D, warp: WarpSpec, ids: string[] | null): void {
  d.space = spaceWithWarp(d.space, warp, ids, idMaker(d));
}

/** Send the stack to the 2D Scene Builder (open, or a new scene), and close. */
export function sendWarpTo2D(): void {
  const w = useWarpBuilder.getState();
  const ids = w.origin.kind === '2d' ? w.origin.ids : null;
  if (!useSceneBuilder2D.getState().open) openNewSceneBuilder2D();
  useSceneBuilder2D.getState().edit(d => writeWarpInto(d, w.spec, ids));
  useSceneBuilder2D.getState().setTab('space');
  w.close();
  toast.success(ids ? 'Back in the 2D Scene Builder' : 'Sent to the 2D Scene Builder', {
    message: `${w.spec.blocks.length} warp block${w.spec.blocks.length === 1 ? '' : 's'} in its Space. Build there to see them in the graph.`,
  });
}

/** The 2D scene a standalone Done builds: the warp as its Space, and a look showing the chosen preview. Pure. */
export function sceneForWarp(warp: WarpSpec, mode: PreviewMode): Scene2D {
  const s = starterScene();
  const ring = s.layers[0];
  if (ring && ring.type === 'shape') { ring.color = [1, 1, 1]; ring.size = { r: 0.5, th: 0.024 }; }
  writeWarpInto(s, warp, null);
  // Checkerboard, Vectors and Heat show the space itself (the 2D builder's Output → Space); Ring, the picture.
  if (mode !== 'ring') s.output = { show: 'space' };
  return s;
}

/** Done: back to the 2D builder, or build the small graph and show it. */
export function finishWarpBuilder(): void {
  const w = useWarpBuilder.getState();
  if (w.origin.kind === '2d') { sendWarpTo2D(); return; }
  if (!w.spec.blocks.length) { finishBuilder(w.close); return; }
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const result = applyScene2D(nodes, sceneForWarp(w.spec, w.mode), { nextId: () => useNodeGraphStore.getState().newNodeId(), asNew: true });
  useNodeGraphStore.getState().setNodesRewritten(intoView(nodes, result.nodes, 'centre'), 'Built a warp');
  const before = new Set(nodes.map(n => n.id));
  const made = result.nodes.filter(n => !before.has(n.id)).map(n => n.id);
  toast.success('Warp built', { message: 'A UV, the warp blocks (Expression Blocks, sliders live) and the preview look. Open it in the 2D Scene Builder from its UV node.' });
  finishBuilder(w.close, made);
}
