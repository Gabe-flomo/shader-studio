/** "Fit to the scene" on the Splat Scene card (docs/splat-scene.md "Settings"). */
import type { GraphNode } from '../../types/nodeGraph';
import { applyModel, modelMatrix, type Vec3 } from './math';
import { splatFlipOf } from '../../nodes/definitions/splatScene';

/** Position and Scale that put the scan's middle at the scene's centre, about 3 units across. */
export function fitParams(node: GraphNode, center: Vec3, radiusOf: number): { position: Vec3; scale: number } {
  const scale = radiusOf > 1e-6 ? Math.round((1.5 / radiusOf) * 1000) / 1000 : 1;
  const rot = Array.isArray(node.params.rotation) ? (node.params.rotation as number[]) : [0, 0, 0];
  const m = modelMatrix({ rotation: [rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0], scale, flip: splatFlipOf(node) });
  const c = applyModel(m, center);
  return { position: [-c[0], -c[1], -c[2]].map(v => Math.round(v * 1000) / 1000) as Vec3, scale };
}
