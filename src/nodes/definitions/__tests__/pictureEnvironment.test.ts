/**
 * Picture Environment (nodes/definitions/depthScene.ts, docs/depth-node.md "The picture as the environment"): the
 * projection maths (a direction → where the camera saw it, mirrored past the frame and behind the camera), its
 * compile into a ray-marched scene with the March Camera's axes, and metric Picture distance on the depth nodes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../../compiler/graphCompiler';
import { n } from '../../../store/graphBuilder';
import { EXAMPLE_GRAPHS } from '../../../store/exampleGraphs';
import { getNodeDefinition, resolveNodeAliases } from '..';
import { pictureEnvUv } from '../depthScene';

const F = [0, 0, 1], R = [1, 0, 0], U = [0, 1, 0];

describe('Picture Environment: the projection', () => {
  it('straight ahead is the centre, and a pixel\'s own ray lands on that pixel', () => {
    expect(pictureEnvUv([0, 0, 1], F, R, U, 1.5, 16 / 9)).toEqual([0.5, 0.5]);
    // The ray through screen point (x, y) (g_uv units) is normalize(x, y, fov)
    const [x, y, fov, aspect] = [0.6, -0.4, 1.5, 16 / 9];
    const [s, t] = pictureEnvUv([x, y, fov], F, R, U, fov, aspect);
    expect(s).toBeCloseTo((x / aspect) * 0.5 + 0.5, 6);
    expect(t).toBeCloseTo(y * 0.5 + 0.5, 6);
    // The frame's right edge is u = 1
    expect(pictureEnvUv([aspect, 0, fov], F, R, U, fov, aspect)[0]).toBeCloseTo(1, 6);
  });

  it('carries on past the frame mirrored, continuously, and never leaves 0–1', () => {
    const fov = 1.5, aspect = 1;
    const past = pictureEnvUv([1.2, 0, fov], F, R, U, fov, aspect)[0];
    expect(past).toBeLessThan(1);
    expect(past).toBeGreaterThan(0.8);
    for (const d of [[1, 0, 0], [0, 1, 0], [-1, -1, -1], [0.3, 0.2, -1], [5, -3, 0.01]] as Array<[number, number, number]>) {
      for (const v of pictureEnvUv(d, F, R, U, fov, aspect)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
    const h = Math.atan(aspect / fov);
    const a = pictureEnvUv([Math.tan(h - 1e-4), 0, 1], F, R, U, fov, aspect)[0];
    const b = pictureEnvUv([Math.tan(h + 1e-4), 0, 1], F, R, U, fov, aspect)[0];
    expect(Math.abs(a - b)).toBeLessThan(1e-3);
  });

  it('behind the camera is the mirror image of in front', () => {
    expect(pictureEnvUv([0.3, 0.2, -1], F, R, U, 1.5, 1)).toEqual(pictureEnvUv([0.3, 0.2, 1], F, R, U, 1.5, 1));
  });

  it('follows the camera\'s axes (a turned camera)', () => {
    expect(pictureEnvUv([1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 1, 0], 1.5, 1)).toEqual([0.5, 0.5]);
  });
});

describe('Picture Environment: the node', () => {
  it('compiles into a ray-marched scene with the March Camera\'s axes; unwired it reads black', () => {
    const base = resolveNodeAliases(EXAMPLE_GRAPHS.shapesAndGround3D.nodes, getNodeDefinition).filter(x => x.type !== 'output');
    const loop = base.find(x => x.type === 'marchLoopGroup')!;
    const cam = base.find(x => x.type === 'marchCamera')!;
    const nodes = [
      ...base,
      n('textureInput', 'pic', 0, 0),
      n('pictureEnvironment', 'env', 0, 0, { blur: 0.02 }, { picture: ['pic', 'texture'], dir: [loop.id, 'normal'], forward: [cam.id, 'forward'], right: [cam.id, 'right'], up: [cam.id, 'up'] }),
      n('output', 'out', 0, 0, {}, { color: ['env', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/vec2 pictureEnvUv\(/);
    expect(r.fragmentShader).toMatch(/pictureEnvUv\([^;]*_fwd, [^;]*_rgt, [^;]*_up2/);
    const def = getNodeDefinition('pictureEnvironment')!;
    expect(def.generateGLSL(n('pictureEnvironment', 'e', 0, 0), {}).outputVars.color).toBe('vec3(0.0)');
    for (const [k, s] of [...Object.entries(def.inputs), ...Object.entries(def.outputs)]) expect(s.hint?.length ?? 0, k).toBeGreaterThan(10);
  });

  it('the March Camera gives its axes; a camera saved before them gets the outputs', () => {
    const def = getNodeDefinition('marchCamera')!;
    expect(Object.keys(def.outputs)).toEqual(['ro', 'rd', 'forward', 'right', 'up']);
    const old = n('marchCamera', 'c', 0, 0);
    old.outputs = { ro: old.outputs.ro, rd: old.outputs.rd };
    expect(Object.keys(def.syncSockets!(old).outputs)).toEqual(['ro', 'rd', 'forward', 'right', 'up']);
  });
});

describe('metric Picture distance', () => {
  it('when wired it is used as it is (Nearest / Farthest skipped where it is above 0)', () => {
    for (const type of ['depthComposite', 'depthLight']) {
      const g = getNodeDefinition(type)!.generateGLSL(n(type, 'c', 0, 0), { picture: 'P', nearness: 'N', distance: 'M' } as Record<string, string>);
      expect(g.code).toMatch(/c_pd = \(\(M\) > 0\.0 \? \(M\) : depthSceneDist\(N,/);
      const plain = getNodeDefinition(type)!.generateGLSL(n(type, 'c', 0, 0), { picture: 'P', nearness: 'N' } as Record<string, string>);
      expect(plain.code).toMatch(/c_pd = depthSceneDist\(N,/);
    }
  });
});
