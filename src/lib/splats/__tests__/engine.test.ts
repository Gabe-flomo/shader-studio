/**
 * The splat engine's decisions (lib/splats/engine.ts): the sort axis from the probe's numbers, when to sort again,
 * the generated scan's key, "Fit to the scene", and the generated rings.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { axisFromReading, demoKeyOf, needsResort, splatNodesIn } from '../engine';
import { applyModel, cameraRay, marchCamera, modelMatrix, sortAxis } from '../math';
import { demoRings } from '../demo';
import { splatInfo } from '../pack';
import { fitParams } from '../fit';
import { n } from '../../../store/graphBuilder';

/** A probe reading as the GPU writes it: eye, rays at (0,0), (0.5,0), (0,0.5), model columns (w: size, opacity), offset. */
function reading(cam = marchCamera({ camDist: 4, camAngle: 0.7, camElevation: 0.2 }), m = modelMatrix({ rotation: [10, 30, 0], scale: 2, flip: true, position: [1, 0, 0] })): Float32Array {
  const r = [cam.eye, cameraRay(cam, 0, 0), cameraRay(cam, 0.5, 0), cameraRay(cam, 0, 0.5)].flatMap(v => [...v, 1]);
  return new Float32Array([...r, m[0], m[1], m[2], 1, m[4], m[5], m[6], 1, m[8], m[9], m[10], 0, m[12], m[13], m[14], 1]);
}

describe('splat engine', () => {
  it('sorts along Mᵀ · forward, in the scan’s own space', () => {
    const cam = marchCamera({ camDist: 4, camAngle: 0.7, camElevation: 0.2 });
    const m = modelMatrix({ rotation: [10, 30, 0], scale: 2, flip: true, position: [1, 0, 0] });
    const a = axisFromReading(reading(cam, m))!;
    const want = sortAxis(m, cam.forward);
    const l = Math.hypot(...want);
    a.forEach((v, i) => expect(v).toBeCloseTo(want[i] / l, 5));
  });

  it('sorts again once the view has turned a quarter of a degree, or at any turn when sorted every frame', () => {
    const a: [number, number, number] = [0, 0, 1];
    const small: [number, number, number] = [Math.sin(0.001), 0, Math.cos(0.001)];
    const big: [number, number, number] = [Math.sin(0.01), 0, Math.cos(0.01)];
    expect(needsResort(null, a, false)).toBe(true);
    expect(needsResort(a, small, false)).toBe(false);
    expect(needsResort(a, big, false)).toBe(true);
    expect(needsResort(a, small, true)).toBe(true);
    expect(needsResort(null, a, true)).toBe(true);
  });

  it('a still camera is never sorted again, even sorted every frame (the order would be the same)', () => {
    const a: [number, number, number] = [0.3, 0.2, Math.sqrt(1 - 0.13)];
    expect(needsResort(a, [...a], true)).toBe(false);
    expect(needsResort(a, [...a], false)).toBe(false);
  });

  it('a broken reading sorts nothing', () => {
    const r = reading(); r[4] = NaN;
    expect(axisFromReading(r)).toBeNull();
  });

  it('a generated scan has its own key; a file’s id wins', () => {
    expect(demoKeyOf(n('splatScene', 's', 0, 0, { demo: 'rings', demoCount: 1000 }))).toBe('demo:rings:1000');
    expect(demoKeyOf(n('splatScene', 's', 0, 0))).toBe('');
  });

  it('only top-level nodes draw; nested ones are named', () => {
    const top = n('splatScene', 'a', 0, 0);
    const group = n('group', 'g', 0, 0, { subgraph: { nodes: [n('splatScene', 'b', 0, 0)] } });
    const { top: t, nested } = splatNodesIn([top, group]);
    expect(t.map(x => x.id)).toEqual(['a']);
    expect(nested.map(x => x.id)).toEqual(['b']);
  });

  it('Fit to the scene puts the scan’s middle at the centre, about 3 units across', () => {
    const node = n('splatScene', 's', 0, 0, { rotation: [0, 45, 0] });
    const center: [number, number, number] = [3, -2, 7];
    const fit = fitParams(node, center, 6);
    expect(fit.scale).toBeCloseTo(0.25, 3);
    const m = modelMatrix({ position: fit.position, rotation: [0, 45, 0], scale: fit.scale, flip: true });
    applyModel(m, center).forEach(v => expect(Math.abs(v)).toBeLessThan(2e-3));
  });

  it('the generated rings: the count asked for, unit quaternions, on two tori', () => {
    const d = demoRings(2000);
    expect(d.count).toBe(2000);
    for (let i = 0; i < d.count; i++) expect(Math.hypot(d.rotations[i * 4], d.rotations[i * 4 + 1], d.rotations[i * 4 + 2], d.rotations[i * 4 + 3])).toBeCloseTo(1, 5);
    const info = splatInfo(d);
    expect(info.max[0]).toBeGreaterThan(1.5);
    expect(info.min[0]).toBeLessThan(-0.8);
  });
});
