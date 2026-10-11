/** "Fit to the scene" on the Splat Scene card (docs/splat-scene.md "Settings"). */
import type { GraphNode } from '../../types/nodeGraph';
import type { Vec3 } from './math';

/** Fit sizes the scan's radius (half its core box's diagonal) to this: about 3 units across. */
export const FIT_RADIUS = 1.5;

/**
 * Position, Scale and pivot that put the scan's middle at the scene's centre, about 3 units across. Fit always turns
 * the scan about its middle (an older node, turning about the file's origin, is moved over), so a Rotation wired to
 * Time, or a slider, turns it in place instead of swinging it out of the picture.
 */
export function fitParams(_node: GraphNode, _center: Vec3, radiusOf: number): { position: Vec3; scale: number; pivot: 'middle' } {
  const scale = radiusOf > 1e-6 ? Math.round((FIT_RADIUS / radiusOf) * 1000) / 1000 : 1;
  return { position: [0, 0, 0], scale, pivot: 'middle' };
}
