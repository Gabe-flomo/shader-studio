/** The Agents builder's 3D viewport gestures as Draw agents' camera settings (agentBuilder/cameraGestures.ts, builders/orbitMath.ts). */
import { describe, expect, it } from 'vitest';
import { DIST_MAX, DIST_MIN, orbitPatch, panPatch, readOrbitCam, resetViewPatch, zoomPatch } from '../cameraGestures';
import { orbitDrag, unitsPerPixel, wheelZoom } from '../../builders/orbitMath';
import { gestureFor } from '../../components/builders/studio/useOrbitGestures';
import { CAMERA_3D } from '../../agentRules/space3d';
import { agCamera3 } from '../../play/kit/agentPlan.js';

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

describe('orbit drag → camera params', () => {
  const cam = readOrbitCam({ camAngle: 10, camElevation: 20, camDist: 4 });

  it('reads Draw agents\' camera with its defaults', () => {
    expect(cam).toEqual({ camAngle: 10, camElevation: 20, camDist: 4, camX: 0, camY: 0, camZ: 0 });
  });

  it('a drag turns Angle (sideways) and Elevation (down raises it), as the 3D Scene Builder does', () => {
    expect(orbitPatch(cam, 50, 0)).toEqual({ camAngle: -10, camElevation: 20 });
    expect(orbitPatch(cam, 0, 100)).toEqual({ camAngle: 10, camElevation: 50 });
    // Elevation stops short of straight up or down.
    expect(orbitPatch(cam, 0, 10000).camElevation).toBe(89);
    expect(orbitPatch(cam, 0, -10000).camElevation).toBe(-89);
    // The Scene Builder's own numbers.
    expect(orbitDrag({ angle: 10, elev: 20 }, 50, 100)).toEqual({ angle: -10, elev: 50 });
  });

  it('scroll and pinch change Distance within its range', () => {
    expect(zoomPatch(cam, { deltaY: 100, pinch: false }).camDist).toBeCloseTo(4 * Math.exp(0.15), 3);
    expect(zoomPatch(cam, { deltaY: -100, pinch: false }).camDist).toBeLessThan(4);
    expect(zoomPatch(cam, { deltaY: 1e6, pinch: false }).camDist).toBe(DIST_MAX);
    expect(zoomPatch(cam, { ratio: 2 }).camDist).toBe(2);
    expect(zoomPatch(cam, { ratio: 1e6 }).camDist).toBe(DIST_MIN);
    expect(wheelZoom(3, 0, 0.3, 50)).toBe(3);
  });

  it('a pan moves the point looked at along the camera\'s screen right and up, so the walkers follow the pointer', () => {
    const p = { camAngle: 0, camElevation: 0, camDist: 4, fov: 2 };
    const c = agCamera3({ params: p }, num, 0, 600);
    const start = readOrbitCam(p);
    const u = unitsPerPixel(4, 2, 600);
    expect(u).toBeCloseTo(2 / 600 * 2, 6);
    const right = panPatch(start, c, 30, 0, c.lens, 600);
    // Dragged right: the target moves against the screen right, by 30 px worth at the target.
    const moved: [number, number, number] = [right.camX, right.camY, right.camZ];
    const along = moved[0] * c.right[0] + moved[1] * c.right[1] + moved[2] * c.right[2];
    expect(along).toBeCloseTo(-30 * u, 3);
    // Dragged down: the target moves up.
    const down = panPatch(start, c, 0, 30, c.lens, 600);
    expect(down.camY).toBeCloseTo(30 * u, 3);
    // A point at the old target lands where the pointer went: 30 px to the right on the picture.
    const after = agCamera3({ params: { ...p, ...right } }, num, 0, 600);
    const d = [0 - after.eye[0], 0 - after.eye[1], 0 - after.eye[2]];
    const x = (d[0] * after.right[0] + d[1] * after.right[1] + d[2] * after.right[2]) * after.lens / 4;
    expect(x * 300).toBeCloseTo(30, 1);
  });

  it('double-click goes back to the view a new 3D group starts with', () => {
    expect(resetViewPatch()).toEqual({ camAngle: CAMERA_3D.camAngle, camElevation: CAMERA_3D.camElevation, camDist: CAMERA_3D.camDist, camX: 0, camY: 0, camZ: 0 });
  });

  it('left drag turns; right, middle or Shift drag pans', () => {
    expect(gestureFor({ button: 0, shiftKey: false })).toBe('orbit');
    expect(gestureFor({ button: 0, shiftKey: true })).toBe('pan');
    expect(gestureFor({ button: 2, shiftKey: false })).toBe('pan');
    expect(gestureFor({ button: 1, shiftKey: false })).toBe('pan');
    expect(gestureFor({ button: 3, shiftKey: false })).toBeNull();
  });
});
