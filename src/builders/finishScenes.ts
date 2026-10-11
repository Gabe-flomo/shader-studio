/**
 * finishScenes.ts — which nodes the Scene Builders' Done frames (builders/finish.ts). Kept apart
 * from finish.ts so the always-loaded builder host doesn't pull in the scene builders' code.
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { find2dBuild } from '../sceneBuilder2d/apply';
import { findBuild } from '../sceneBuilder/apply';

/** The top-level nodes a 2D Scene Builder build is made of (its UV node's id is `sceneId`). */
export function scene2dBuildIds(sceneId: string | null | undefined): string[] {
  if (!sceneId) return [];
  const b = find2dBuild(useNodeGraphStore.getState().nodes, sceneId);
  return b ? [b.scene.id, ...[...b.byRole.values()].map(n => n.id)] : [];
}

/** The top-level nodes a 3D Scene Builder build is made of (its scene's id is `sceneId`). */
export function scene3dBuildIds(sceneId: string | null | undefined): string[] {
  if (!sceneId) return [];
  const b = findBuild(useNodeGraphStore.getState().nodes, sceneId);
  return b ? [b.scene.id, ...b.all.filter(l => !l.parent).map(l => l.node.id)] : [sceneId];
}
