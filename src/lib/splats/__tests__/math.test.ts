import { describe, expect, it } from 'vitest';
import { applyModel, cameraFromProbe, cameraRay, covariance3d, ellipseAxes, eyeInModel, marchCamera, modelMatrix, projectSplat, sortAxis, splatWeight, transformCov, type SplatCamera } from '../math';

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const nearAll = (a: readonly number[], b: readonly number[], eps = 1e-6) => { expect(a.length).toBe(b.length); a.forEach((v, i) => near(v, b[i], eps)); };

/** The eye at the origin looking down +z, lens 1.5 (the March Camera's default FOV). */
const straight: SplatCamera = { eye: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], fx: 1.5, fy: 1.5 };

describe('3D covariance Σ = R S Sᵀ Rᵀ', () => {
  it('is diag(s²) without rotation', () => {
    nearAll(covariance3d([0.2, 0.1, 0.3], [1, 0, 0, 0]), [0.04, 0, 0, 0.01, 0, 0.09]);
  });
  it('swaps x and y under a quarter turn about z', () => {
    const h = Math.SQRT1_2;
    nearAll(covariance3d([0.2, 0.1, 0.1], [h, 0, 0, h]), [0.01, 0, 0, 0.04, 0, 0.01]);
  });
  it('a 45° turn about z mixes x and y: xy = (a² − b²)/2', () => {
    const c = Math.cos(Math.PI / 8), s = Math.sin(Math.PI / 8);
    // scales a = 0.2, b = 0.1 → xx = yy = (0.04 + 0.01)/2, xy = (0.04 − 0.01)/2
    nearAll(covariance3d([0.2, 0.1, 0.1], [c, 0, 0, s]), [0.025, 0.015, 0, 0.025, 0, 0.01]);
  });
});

describe('projection (EWA, in pixels of a 400-high picture)', () => {
  it('an isotropic splat straight ahead at 5: k·f/z = 200 · 1.5 / 5 = 60 px per unit', () => {
    const p = projectSplat([0, 0, 5], [0.01, 0, 0, 0.01, 0, 0.01], straight, 400)!;
    nearAll(p.uv, [0, 0]);
    near(p.dist, 5);
    // 60² · 0.01 + 0.3 = 36.3 each way
    nearAll(p.cov2, [36.3, 0, 36.3], 1e-9);
    near(Math.hypot(...p.major), Math.sqrt(2 * 36.3), 1e-9);
  });

  it('off to the side, the Jacobian’s −x/z² term widens it: a = 0.01 · (60² + 12²) + 0.3', () => {
    const p = projectSplat([1, 0, 5], [0.01, 0, 0, 0.01, 0, 0.01], straight, 400)!;
    nearAll(p.uv, [0.3, 0]);
    near(p.cov2[0], 37.74, 1e-9);
    near(p.cov2[1], 0, 1e-12);
    near(p.cov2[2], 36.3, 1e-9);
    near(p.dist, Math.hypot(1, 5));
  });

  it('a tall splat stands up: the major axis is vertical', () => {
    const p = projectSplat([0, 0, 5], [0.01, 0, 0, 0.04, 0, 0.01], straight, 400)!;
    nearAll(p.major, [0, Math.sqrt(2 * 144.3)], 1e-9);
    nearAll(p.minor.map(Math.abs), [Math.sqrt(2 * 36.3), 0], 1e-9);
  });

  it('behind the camera is nothing', () => {
    expect(projectSplat([0, 0, -1], [0.01, 0, 0, 0.01, 0, 0.01], straight, 400)).toBeNull();
  });

  it('ellipse axes of a tilted covariance are its eigenvectors', () => {
    // [[5, 2], [2, 2]]: λ = 6, 1; eigenvector of 6 is (2, 1)/√5.
    const e = ellipseAxes(5, 2, 2);
    near(e.l1, 6); near(e.l2, 1);
    nearAll(e.major, [2 / Math.sqrt(5) * Math.sqrt(12), 1 / Math.sqrt(5) * Math.sqrt(12)]);
    near(e.major[0] * e.minor[0] + e.major[1] * e.minor[1], 0);
  });

  it('the weight is exp(−|v|²): 1 at the centre, e⁻¹ one √λ/√2… out, 0 past the quad', () => {
    const p = projectSplat([0, 0, 5], [0.01, 0, 0, 0.01, 0, 0.01], straight, 400)!;
    near(splatWeight(p, [0, 0]), 1);
    // One σ (√36.3 px) out: exp(−½).
    near(splatWeight(p, [Math.sqrt(36.3), 0]), Math.exp(-0.5), 1e-9);
    expect(splatWeight(p, [Math.sqrt(36.3) * 3, 0])).toBe(0);
  });
});

describe('the camera from the probe', () => {
  it('rebuilds a March Camera from its rays at (0,0), (0.5,0), (0,0.5)', () => {
    const cam = marchCamera({ camDist: 4, camAngle: 0.9, camElevation: 0.35, fov: 1.8, target: [0.2, -0.1, 0.5] });
    const got = cameraFromProbe(cam.eye, cameraRay(cam, 0, 0), cameraRay(cam, 0.5, 0), cameraRay(cam, 0, 0.5));
    nearAll(got.forward, cam.forward); nearAll(got.right, cam.right); nearAll(got.up, cam.up);
    near(got.fx, 1.8); near(got.fy, 1.8);
  });

  it('a point projects to the pixel whose ray passes through it', () => {
    const cam = marchCamera({ camDist: 3, camAngle: 0.6, camElevation: 0.3, fov: 1.5 });
    const ray = cameraRay(cam, 0.31, -0.22);
    const pt: [number, number, number] = [0, 1, 2].map(k => cam.eye[k] + ray[k] * 2.7) as [number, number, number];
    const p = projectSplat(pt, [1e-4, 0, 0, 1e-4, 0, 1e-4], cam, 400)!;
    nearAll(p.uv, [0.31, -0.22], 1e-9);
    // The distance is the March Loop's: along the normalised ray.
    near(p.dist, 2.7, 1e-9);
  });
});

describe('the model transform', () => {
  it('turns X, then Y, then Z (degrees), scales, then moves', () => {
    const m = modelMatrix({ position: [1, 2, 3], rotation: [0, 90, 0], scale: 2 });
    // +x turned 90° about y goes to −z; ×2; + (1, 2, 3).
    nearAll(applyModel(m, [1, 0, 0]), [1, 2, 1]);
  });

  it('upside down flips y and z (a 180° turn about x)', () => {
    nearAll(applyModel(modelMatrix({ flip: true }), [1, 2, 3]), [1, -2, -3]);
  });

  it('carries the covariance: M Σ Mᵀ', () => {
    nearAll(transformCov(modelMatrix({ rotation: [0, 0, 90] }), [0.04, 0, 0, 0.01, 0, 0.01]), [0.01, 0, 0, 0.04, 0, 0.01]);
    nearAll(transformCov(modelMatrix({ scale: 3 }), [0.01, 0, 0, 0.01, 0, 0.01]), [0.09, 0, 0, 0.09, 0, 0.09]);
  });

  it('sorts in the scan’s own space: dot(p, Mᵀ f) differs from the world depth by a constant', () => {
    const m = modelMatrix({ position: [0.3, -1, 2], rotation: [20, 40, -10], scale: 1.7, flip: true });
    const f = [0.2, -0.3, 0.93];
    const ax = sortAxis(m, f);
    const depth = (p: number[]) => { const w = applyModel(m, p); return w[0] * f[0] + w[1] * f[1] + w[2] * f[2]; };
    const local = (p: number[]) => p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2];
    const c = depth([0, 0, 0]) - local([0, 0, 0]);
    for (const p of [[1, 2, 3], [-4, 0.5, 2], [0.1, -0.2, -9]]) near(depth(p) - local(p), c, 1e-9);
  });

  it('puts the eye in the scan’s own space', () => {
    const m = modelMatrix({ position: [1, 0, 0], rotation: [0, 90, 0], scale: 2 });
    nearAll(applyModel(m, eyeInModel(m, [5, 4, 3])), [5, 4, 3], 1e-9);
  });
});
