import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { CURVED_EXAMPLE_KEYS } from '../../store/curvedSpaceExampleIndex';
import { collectPlayCandidates } from '../../play/playControls';
import { n } from '../../store/graphBuilder';
import {
  antipodeDistance, cameraFrame4, curvedEnd, curvedRayPos, curvedRayPosVia4D, curvedStepFactor, geodesic4, norm4, reverseRay, type Vec3,
} from '../../lib/curvedSpace';

const compileKey = (key: string) => {
  const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);
  return { nodes, r: compileGraph({ nodes }) };
};

describe('curved space: unchanged code at k = 0 / normal perspective', () => {
  it('a March Loop without Space curvature compiles with no curved helper and the old loop', () => {
    // learn3dMarch has a plain loop: its shader is also pinned byte for byte by goldenShaders.test.ts.
    const { r } = compileKey('learn3dMarch');
    expect(r.fragmentShader).not.toMatch(/curved/);
    expect(r.fragmentShader).toMatch(/_rp_raw = \w+ \+ \w+_t \* \w+;/);
  });

  it('a camera with Perspective Normal (or unset) compiles to the same code as before', () => {
    const base = EXAMPLE_GRAPHS.learn3dMarch.nodes;
    const withNormal = base.map(nd => nd.type === 'marchCamera' ? { ...nd, params: { ...nd.params, projection: 'normal' } } : nd);
    const a = compileGraph({ nodes: resolveNodeAliases(base, getNodeDefinition) });
    const b = compileGraph({ nodes: resolveNodeAliases(withNormal, getNodeDefinition) });
    expect(b.fragmentShader).toBe(a.fragmentShader);
    expect(a.fragmentShader).not.toMatch(/_rO\b/);
  });

  it('Space curvature on a loop adds the geodesic position, the step factor and the end distance', () => {
    const { r } = compileKey('curvedSpherical');
    expect(r.fragmentShader).toMatch(/vec3 curvedRayPos\(/);
    expect(r.fragmentShader).toMatch(/_rp_raw = curvedRayPos\(/);
    expect(r.fragmentShader).toMatch(/\* curvedStep\(/);
    expect(r.fragmentShader).toMatch(/> \w+_tEnd\)/);
    expect(Object.keys(r.paramBindings).some(k => k.endsWith('::curvature'))).toBe(true);
  });

  it('the GI Lit March Group takes Space curvature too', () => {
    const nodes = EXAMPLE_GRAPHS.curvedSpherical.nodes.map(nd => nd.id === 'march'
      ? { ...n('giLitMarchGroup', 'march', 340, 220, { ...nd.params }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }) }
      : nd);
    const r = compileGraph({ nodes: resolveNodeAliases(nodes, getNodeDefinition) });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/_rp_raw = curvedRayPos\(/);
  });
});

describe('curved space: the maths on the CPU', () => {
  const rd: Vec3 = [0.6, 0, 0.8];
  const ro: Vec3 = [1, 2, 3];

  it('S³ stepping keeps unit length', () => {
    const { q, v } = cameraFrame4(rd);
    for (const k of [0.05, 0.3, 1]) {
      for (let t = 0; t < 20; t += 0.37) {
        const Q = geodesic4(q, v, t, k);
        expect(norm4(Q, k)).toBeCloseTo(1, 10);
      }
    }
  });

  it('H³ stepping stays on the hyperboloid', () => {
    const { q, v } = cameraFrame4(rd);
    for (const k of [-0.05, -0.4, -1]) {
      for (let t = 0; t < 6; t += 0.31) expect(norm4(geodesic4(q, v, t, k), k)).toBeCloseTo(1, 6);
    }
  });

  it('the antipode is π/√k away, and there every ray is back at the camera in the 3D chart', () => {
    for (const k of [0.04, 0.5, 1]) {
      const d = antipodeDistance(k);
      expect(d).toBeCloseTo(Math.PI / Math.sqrt(k), 12);
      const { q, v } = cameraFrame4(rd);
      const Q = geodesic4(q, v, d, k);
      expect(Q[0]).toBeCloseTo(-1, 10);          // −q
      const p = curvedRayPos(ro, rd, d, k);
      p.forEach((c, i) => expect(c).toBeCloseTo(ro[i], 9));
    }
  });

  it('positions at t and π/√k − t agree (the far half of the world folds back)', () => {
    const k = 0.25;
    const a = curvedRayPos(ro, rd, 1.3, k), b = curvedRayPos(ro, rd, antipodeDistance(k) - 1.3, k);
    a.forEach((c, i) => expect(c).toBeCloseTo(b[i], 9));
  });

  it('the chart position equals the spatial part of the 4D geodesic', () => {
    for (const k of [0.1, 0.7, -0.1, -0.8]) {
      for (const t of [0.2, 1.1, 2.5]) {
        const a = curvedRayPos(ro, rd, t, k), b = curvedRayPosVia4D(ro, rd, t, k);
        a.forEach((c, i) => expect(c).toBeCloseTo(b[i], 9));
      }
    }
  });

  it('k = 0 is the straight ray, and a fixed object looks κ/sin(κt) big: shrinking, then growing again past the halfway point', () => {
    expect(curvedRayPos(ro, rd, 5, 0)).toEqual([ro[0] + 3, ro[1], ro[2] + 4]);
    const k = 0.2, a = Math.sqrt(k), size = (t: number) => 1 / (Math.sin(a * t) / a);
    const half = Math.PI / (2 * a);
    expect(size(half * 0.5)).toBeGreaterThan(size(half));
    expect(size(half * 1.5)).toBeGreaterThan(size(half));
    expect(size(half * 1.98)).toBeGreaterThan(size(half * 1.5));
  });

  it('hyperbolic space: far things shrink faster than flat, the step factor is 1/cosh and the end distance is cut', () => {
    const k = -0.6, a = Math.sqrt(0.6);
    const flat = (t: number) => 1 / t, hyp = (t: number) => 1 / (Math.sinh(a * t) / a);
    expect(hyp(5) / flat(5)).toBeLessThan(hyp(1) / flat(1));
    expect(curvedStepFactor(3, k)).toBeCloseTo(1 / Math.cosh(a * 3), 12);
    expect(curvedStepFactor(3, 0.4)).toBe(1);
    expect(curvedRayPos([0, 0, 0], [0, 0, 1], curvedEnd(k, 40), k)[2]).toBeCloseTo(40, 6);
  });
});

describe('reverse perspective: ray directions converge at the focal distance', () => {
  const fwd: Vec3 = [0, 0, -1], right: Vec3 = [1, 0, 0], up: Vec3 = [0, 1, 0], ro0: Vec3 = [0, 0, 8];
  /** The ray's point at `depth` in front of the camera plane (depth measured along fwd from ro0). */
  const at = (ray: { ro: Vec3; rd: Vec3 }, depth: number): Vec3 => {
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const off: Vec3 = [ray.ro[0] - ro0[0], ray.ro[1] - ro0[1], ray.ro[2] - ro0[2]];
    const s = (depth - dot(off, fwd)) / dot(ray.rd, fwd);
    return [ray.ro[0] + s * ray.rd[0], ray.ro[1] + s * ray.rd[1], ray.ro[2] + s * ray.rd[2]];
  };

  it('at strength 1 every ray passes through the same point, Converge at in front of the camera', () => {
    const D = 12, camDist = 8;
    const pts = [[0.9, 0.2], [-0.7, 0.5], [0.1, -0.8], [0, 0]].map(([u, v]) => at(reverseRay(ro0, fwd, right, up, u, v, camDist, 1.5, D, 1), D));
    for (const p of pts) { expect(p[0]).toBeCloseTo(0, 9); expect(p[1]).toBeCloseTo(0, 9); expect(p[2]).toBeCloseTo(ro0[2] - D, 9); }
  });

  it('lateral spread shrinks with depth, so a fixed-size object covers more of the picture far away', () => {
    const r = reverseRay(ro0, fwd, right, up, 1, 0, 8, 1.5, 20, 0.7);
    const x = (d: number) => Math.abs(at(r, d)[0]);
    expect(x(16)).toBeLessThan(x(8));
    expect(x(8)).toBeLessThan(x(0.001));
  });

  it('the look-at target keeps its normal size, and strength 0 is parallel (orthographic)', () => {
    const camDist = 8, fov = 1.5, u = 0.8;
    const normal = u * camDist / fov;
    const rev = reverseRay(ro0, fwd, right, up, u, 0, camDist, fov, 20, 0.7);
    expect(Math.abs(at(rev, camDist)[0])).toBeCloseTo(normal, 9);
    const par = reverseRay(ro0, fwd, right, up, u, 0, camDist, fov, 20, 0);
    expect(par.rd[0]).toBeCloseTo(0, 12);
    expect(par.rd[2]).toBeCloseTo(-1, 12);
  });

  it('the camera shader emits it only for Perspective Reverse (and Orthographic is Flatten 1)', () => {
    const cam = (extra: Record<string, unknown>) => {
      const nodes = [n('marchCamera', 'cam', 0, 0, extra), n('normalToColor', 'c', 300, 0, {}, { v: ['cam', 'rd'] }), n('output', 'out', 600, 0, {}, { color: ['c', 'color'] })];
      return compileGraph({ nodes: resolveNodeAliases(nodes, getNodeDefinition) });
    };
    expect(cam({ projection: 'reverse' }).fragmentShader).toMatch(/_rO\b/);
    expect(cam({}).fragmentShader).not.toMatch(/_rO\b/);
    expect(cam({ projection: 'orthographic' }).fragmentShader).toMatch(/_or\s+= clamp\(1\.0/);
  });
});

describe('the Curved space examples', () => {
  it.each(CURVED_EXAMPLE_KEYS)('%s compiles and its Play controls are live', key => {
    const { nodes, r } = compileKey(key);
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    const live = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
    for (const c of EXAMPLE_GRAPHS[key].play!.controls) expect(live.has(c.target), `${c.label} → ${c.target}`).toBe(true);
  });
});
