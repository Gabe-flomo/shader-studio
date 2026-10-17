/**
 * orbitMath.ts — the builders' 3D viewport camera gestures as plain numbers, shared by the 3D Scene Builder
 * (SceneViewport.tsx) and the Agents builder's 3D viewport (useOrbitGestures.ts): drag to turn round the point
 * looked at (Angle and Elevation), pan to move that point, scroll or pinch to come closer (Distance). Every
 * camera here is the same orbit (agentPlan.js agCamera3, sceneBuilder/viewMath.ts cameraBasis), so a drag
 * feels the same in both. Pure.
 */

/** Degrees of Angle a pixel of sideways drag turns, and of Elevation a pixel down. */
export const ORBIT_DEG_PER_PX = 0.4;
export const ELEV_DEG_PER_PX = 0.3;
/** How hard a wheel notch (deltaY) zooms: Distance × e^(deltaY × this). A trackpad pinch (ctrl + wheel) is finer-grained, so stronger. */
export const WHEEL_ZOOM = 0.0015;
export const PINCH_WHEEL_ZOOM = 0.01;

type Vec3 = [number, number, number];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Angle and Elevation after a drag of (dx, dy) pixels from where it started (Elevation kept within ±limit). */
export function orbitDrag(start: { angle: number; elev: number }, dx: number, dy: number, limit = 89): { angle: number; elev: number } {
  return { angle: start.angle - dx * ORBIT_DEG_PER_PX, elev: clamp(start.elev + dy * ELEV_DEG_PER_PX, -limit, limit) };
}

/** Distance after a wheel step (deltaY > 0: further), within [min, max]. `pinch`: a trackpad pinch (the wheel with ctrl). */
export function wheelZoom(dist: number, deltaY: number, min: number, max: number, pinch = false): number {
  return clamp(dist * Math.exp(deltaY * (pinch ? PINCH_WHEEL_ZOOM : WHEEL_ZOOM)), min, max);
}

/** Distance after a two-finger pinch whose spread grew by `ratio` (now / then: > 1 comes closer). */
export function pinchZoom(dist: number, ratio: number, min: number, max: number): number {
  return clamp(dist / Math.max(ratio, 1e-3), min, max);
}

/**
 * The point looked at after a pan of (dx, dy) pixels (y down): the picture follows the pointer, so the point moves
 * against the camera's screen right and with its up. `unitsPerPx`: world units a pixel is at the point looked at.
 */
export function panDrag(start: Vec3, right: readonly number[], up: readonly number[], dx: number, dy: number, unitsPerPx: number): Vec3 {
  const a = -dx * unitsPerPx, b = dy * unitsPerPx;
  return [start[0] + right[0] * a + up[0] * b, start[1] + right[1] * a + up[1] * b, start[2] + right[2] * a + up[2] * b];
}

/**
 * World units a pixel is at the point looked at, `dist` away through a lens of `lens` (g_uv = x · lens / dist), in a
 * picture drawn `imageH` pixels tall (g_uv's y runs −1 … 1).
 */
export function unitsPerPixel(dist: number, lens: number, imageH: number): number {
  return (2 / Math.max(imageH, 1)) * (dist / Math.max(lens, 0.05));
}
