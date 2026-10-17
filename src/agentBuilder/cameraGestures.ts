/**
 * cameraGestures.ts — the Agents builder's 3D viewport gestures as Draw agents' camera settings (docs/agent-builder.md,
 * "Turning the 3D view"): what a drag, a pan, a scroll or a double-click writes, so what you see is what the graph
 * draws. The same params the Look section's Camera card sets (agentRules/space3d.ts CAMERA_CONTROLS) plus Translate
 * X / Y / Z (the point looked at, agentPlan.js agCamera3's target). The gestures' feel is the 3D Scene Builder's
 * (builders/orbitMath.ts). Pure.
 */
import { orbitDrag, panDrag, pinchZoom, unitsPerPixel, wheelZoom } from '../builders/orbitMath';
import { CAMERA_3D } from '../agentRules/space3d';
import { DRAW_CAMERA_DEFAULTS, DRAW_CAMERA_PARAMS } from '../nodes/definitions/agents';

/** The camera settings the gestures read and write. */
export interface OrbitCam { camAngle: number; camElevation: number; camDist: number; camX: number; camY: number; camZ: number }
export const ORBIT_KEYS = ['camAngle', 'camElevation', 'camDist', 'camX', 'camY', 'camZ'] as const;

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
const tidy = (v: number) => Math.round(v * 1e4) / 1e4;
/** Distance's range (Draw agents' own). */
export const DIST_MIN = DRAW_CAMERA_PARAMS.camDist.min ?? 0.3;
export const DIST_MAX = DRAW_CAMERA_PARAMS.camDist.max ?? 40;

/** Draw agents' camera as the gestures see it (its defaults where unset). */
export function readOrbitCam(params: Record<string, unknown>): OrbitCam {
  const o = {} as OrbitCam;
  for (const k of ORBIT_KEYS) o[k] = num(params[k], DRAW_CAMERA_DEFAULTS[k]);
  return o;
}

/** A drag that turns, `dx`, `dy` pixels from where it began on camera `start`: Angle and Elevation. */
export function orbitPatch(start: OrbitCam, dx: number, dy: number): Pick<OrbitCam, 'camAngle' | 'camElevation'> {
  const r = orbitDrag({ angle: start.camAngle, elev: start.camElevation }, dx, dy);
  return { camAngle: tidy(r.angle), camElevation: tidy(r.elev) };
}

/** A wheel step or a pinch on camera `cam`: Distance. */
export function zoomPatch(cam: OrbitCam, z: { deltaY: number; pinch: boolean } | { ratio: number }): Pick<OrbitCam, 'camDist'> {
  const d = 'ratio' in z ? pinchZoom(cam.camDist, z.ratio, DIST_MIN, DIST_MAX) : wheelZoom(cam.camDist, z.deltaY, DIST_MIN, DIST_MAX, z.pinch);
  return { camDist: tidy(d) };
}

/**
 * A pan of `dx`, `dy` pixels from camera `start`: Translate X / Y / Z, along the camera's screen right and up
 * (`basis`: agCamera3's at the drag's start) so the walkers follow the pointer. `lens`: the camera's Zoom; `imageH`:
 * the picture's height on screen.
 */
export function panPatch(start: OrbitCam, basis: { right: readonly number[]; up: readonly number[] }, dx: number, dy: number, lens: number, imageH: number): Pick<OrbitCam, 'camX' | 'camY' | 'camZ'> {
  const t = panDrag([start.camX, start.camY, start.camZ], basis.right, basis.up, dx, dy, unitsPerPixel(start.camDist, lens, imageH));
  return { camX: tidy(t[0]), camY: tidy(t[1]), camZ: tidy(t[2]) };
}

/** Double-click: the view a new 3D group starts with (CAMERA_3D), its Orbit speed and lens left as they are. */
export function resetViewPatch(): OrbitCam {
  const o = {} as OrbitCam;
  for (const k of ORBIT_KEYS) o[k] = CAMERA_3D[k];
  return o;
}
