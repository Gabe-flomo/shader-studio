/**
 * place.ts — where the scan sits (docs/splat-builder.md, "Place"): its middle in the world, Fit to view, Centre,
 * Stand it on the floor, and turns and sizes that keep its middle where it is. The Splat Scene's own model matrix
 * (lib/splats/math.ts), so what the gizmo shows is where the scan is drawn.
 *
 * Pure: no DOM, no store. `info` is what the engine learned about the file (lib/splats/pack.ts SplatInfo); without
 * it (not loaded yet), the scan's own middle is taken as its origin.
 */
import { applyModel, modelMatrix } from '../lib/splats/math';
import type { PlaceSpec, Vec3 } from './spec';

export interface ScanBox { center: Vec3; radius: number; coreMin: Vec3; coreMax: Vec3 }

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r3v = (v: readonly number[]): Vec3 => [r3(v[0]), r3(v[1]), r3(v[2])];

/** The model's linear part applied to `p` (no position). */
function linear(place: PlaceSpec, p: readonly number[], over: Partial<PlaceSpec> = {}): Vec3 {
  const q = { ...place, ...over };
  return applyModel(modelMatrix({ rotation: q.rotation, scale: q.scale, flip: q.up !== 'y' }), p);
}

/** Where the scan's middle is in the world. */
export function scanCenter(place: PlaceSpec, box?: ScanBox | null): Vec3 {
  const c = linear(place, box?.center ?? [0, 0, 0]);
  return [c[0] + place.position[0], c[1] + place.position[1], c[2] + place.position[2]];
}

/** About how far the scan reaches from its middle, in the world (for the gizmo's ring). */
export const scanReach = (place: PlaceSpec, box?: ScanBox | null) => (box?.radius ?? 0.85) * place.scale;

/** Position that puts the scan's middle at `at`, with the rest of `place` as it is. */
function positionFor(place: PlaceSpec, box: ScanBox | null | undefined, at: Vec3, over: Partial<PlaceSpec> = {}): Vec3 {
  const c = linear(place, box?.center ?? [0, 0, 0], over);
  return r3v([at[0] - c[0], at[1] - c[1], at[2] - c[2]]);
}

/** Fit to view: the scan's middle at the centre, about 3 units across (the card's "Fit to the scene"). */
export function fitPlace(place: PlaceSpec, box: ScanBox): PlaceSpec {
  const scale = box.radius > 1e-6 ? r3(1.5 / box.radius) : 1;
  return { ...place, scale, position: positionFor(place, box, [0, 0, 0], { scale }) };
}

/** Centre: the scan's middle at the world's centre, its size as it is. */
export const centrePlace = (place: PlaceSpec, box?: ScanBox | null): PlaceSpec => ({ ...place, position: positionFor(place, box, [0, 0, 0]) });

/** Turn (or size) the scan keeping its middle where it is. */
export function keepMiddle(place: PlaceSpec, box: ScanBox | null | undefined, next: Partial<PlaceSpec>): PlaceSpec {
  const at = scanCenter(place, box);
  return { ...place, ...next, position: positionFor(place, box, at, next) };
}

/** The lowest point of the scan's core box in the world. */
export function scanBottom(place: PlaceSpec, box: ScanBox): number {
  let low = Infinity;
  for (let i = 0; i < 8; i++) {
    const p = [i & 1 ? box.coreMax[0] : box.coreMin[0], i & 2 ? box.coreMax[1] : box.coreMin[1], i & 4 ? box.coreMax[2] : box.coreMin[2]];
    low = Math.min(low, linear(place, p)[1] + place.position[1]);
  }
  return low;
}

/** Stand it on the floor: moved up or down so its lowest point (the core box's) touches `floorY`. */
export function onFloorPlace(place: PlaceSpec, box: ScanBox, floorY: number): PlaceSpec {
  const dy = floorY - scanBottom(place, box);
  return { ...place, position: [place.position[0], r3(place.position[1] + dy), place.position[2]] };
}

/** Quarter turns for a scan that comes in lying down (Z up) or facing away. */
export function quarterTurn(place: PlaceSpec, box: ScanBox | null | undefined, axis: 0 | 1 | 2, deg: number): PlaceSpec {
  const rotation = [...place.rotation] as Vec3;
  rotation[axis] = ((((rotation[axis] + deg) % 360) + 540) % 360) - 180;
  return keepMiddle(place, box, { rotation });
}
