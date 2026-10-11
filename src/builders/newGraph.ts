/**
 * newGraph.ts — starting a new graph on a phone (docs/scene-builder.md, "On a phone"): a new graph
 * starts from the Scene builder's kind page; "Start from an empty graph" stays one tap away. Once
 * the graph exists it is edited like any other; this is only how you get started.
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { openSceneBuilderShell } from './sceneKinds';

/** A blank graph (just the Output), then, unless `empty`, the Scene builder's kind page on it. */
export async function startNewGraph(o: { empty?: boolean } = {}): Promise<void> {
  await useNodeGraphStore.getState().loadExampleGraph('blank');
  if (!o.empty) openSceneBuilderShell();
}
