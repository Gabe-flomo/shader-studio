/**
 * Orthographic and Reverse perspective for Draw agents' camera and the Splat Scene (docs/camera-projections.md).
 *
 * The March Camera's own GLSL (scene3d.ts) is run on the CPU (glslEval.ts) for its rays, and:
 *  - Draw agents' forward projection (agentPlan.js agProjection / agProject3) puts a point on one of those rays at
 *    the ray's g_uv, for Normal, Orthographic, Reverse and Flatten; a scene camera rebuilt from its probe
 *    (agSceneCamera, the shaders' agSceneCam) does too;
 *  - ortho keeps a walker's size with depth, reverse grows it;
 *  - the splat maths (lib/splats/math.ts): the camera rebuilt from the probe, the projection and its Jacobian (checked
 *    against finite differences) for each mode, and the sizes;
 *  - every shader touched still parses, defaults compile as before, and Reverse's sliders are live uniforms.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { DRAW_CAMERA_DEFAULTS, withAgentSpace } from '../../nodes/definitions/agents';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Val } from './glslEval';
import { AG_PROBE_POINTS, agCamera3, agCamW, agProject3, agProjection, agSceneCamera } from '../../play/kit/agentPlan.js';
import { AG_CAM_GLSL, AG_DRAW3_VERT, AG_SPLAT_VERT, AG_SPOT_VERT } from '../../play/kit/agentShaders.js';
import { slimeMoldNodes } from '../../store/agentExamples';
import { SPLAT_VERT, SPLAT_VERT_MOD } from '../../lib/splats/shaders';
import { cameraFromProbe, cameraRay, cameraRayOrigin, covariance3d, marchCamera, projectSplat, type MarchProjection, type Vec3 } from '../../lib/splats/math';
import { SPLAT_PROBE_PRELUDE } from '../splatGraph';
import { SplatProbeOutNode } from '../../nodes/definitions/splatScene';
import { cameraParams } from '../../splatBuilder/build';
import { readSplatRecipe, splatRecipe } from '../../splatBuilder/recipe';
import { starterSplatScene } from '../../splatBuilder/spec';
import type { GraphNode } from '../../types/nodeGraph';

const close = (a: number, b: number, d = 6) => expect(a).toBeCloseTo(b, d);
const add = (a: number[], b: number[], k = 1) => a.map((x, i) => x + k * b[i]);
const deg = (d: number) => d * Math.PI / 180;

/** The March Camera's real GLSL, run on the CPU: its ray at g_uv. */
function marchRay(params: Record<string, unknown>, uv: [number, number]): { ro: number[]; rd: number[] } {
  const node = n('marchCamera', 'mc', 0, 0, params);
  const { code, outputVars } = getNodeDefinition('marchCamera')!.generateGLSL(node, { uv: 'UV', time: 'T' });
  const cross = (a: Val, b: Val) => { const x = a as number[], y = b as number[]; return [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]; };
  const env = runGlsl(code, { UV: uv, T: 0, cross });
  return { ro: env[outputVars.ro] as number[], rd: env[outputVars.rd] as number[] };
}

/** The probe's texels for Draw agents (AG_PROBE_POINTS: origin or ray at each g_uv). */
const agProbe = (params: Record<string, unknown>) => AG_PROBE_POINTS.map(([x, y, k]) => { const r = marchRay(params, [x, y]); return k < 0.5 ? r.ro : r.rd; });

/** The same camera's settings in March Camera units (radians) and Draw agents' (degrees). */
const SHOT = { camDist: 3.4, angle: 35, elev: 22, fov: 1.6, target: [0.3, -0.2, 0.1] };
const marchParams = (extra: Record<string, unknown>) => ({ camDist: SHOT.camDist, camAngle: deg(SHOT.angle), camElevation: deg(SHOT.elev), fov: SHOT.fov, targetX: SHOT.target[0], targetY: SHOT.target[1], targetZ: SHOT.target[2], ...extra });
const agentParams = (extra: Record<string, unknown>) => ({ ...DRAW_CAMERA_DEFAULTS, camDist: SHOT.camDist, camAngle: SHOT.angle, camElevation: SHOT.elev, fov: SHOT.fov, camX: SHOT.target[0], camY: SHOT.target[1], camZ: SHOT.target[2], ...extra });
const readNum = (v: unknown, f: number) => (typeof v === 'number' ? v : f);

const MODES: Array<{ name: string; extra: Record<string, unknown> }> = [
  { name: 'Normal', extra: {} },
  { name: 'Orthographic', extra: { projection: 'orthographic' } },
  { name: 'Reverse (strength 1, converge 8)', extra: { projection: 'reverse', reverseStrength: 1, reverseDist: 8 } },
  { name: 'Reverse (strength 0.6, converge 5)', extra: { projection: 'reverse', reverseStrength: 0.6, reverseDist: 5 } },
  { name: 'Normal, Flatten 0.4', extra: { ortho: 0.4 } },
];
const UVS: Array<[number, number]> = [[0, 0], [0.4, -0.25], [-0.7, 0.5], [0.15, 0.9]];
const DEPTHS = [0.8, 2.5, 4.2];

describe('Draw agents\' Perspective: the March Camera\'s, done forward', () => {
  for (const m of MODES) {
    it(`${m.name}: a point on the March Camera's ray at g_uv lands at g_uv, through the built-in camera and through the probe`, () => {
      const cam = agCamera3({ params: agentParams(m.extra) }, readNum, 0, 720);
      const seen = agSceneCamera(agProbe(marchParams(m.extra)));
      for (const uv of UVS) {
        const { ro, rd } = marchRay(marchParams(m.extra), uv);
        for (const t of DEPTHS) {
          const p = add(ro, rd, t);
          const q = agProject3(cam, p);
          close(q.x, uv[0], 5); close(q.y, uv[1], 5);
          const s = agProject3(seen, p);
          close(s.x, uv[0], 4); close(s.y, uv[1], 4);
        }
      }
    });
  }
  it('Normal is the old projection exactly: W = mix(z, Distance, Flatten), so a saved camera is as it was', () => {
    for (const fl of [0, 0.3, 1]) {
      const cam = agCamera3({ params: agentParams({ ortho: fl }) }, readNum, 0, 720);
      expect(cam.proj).toEqual([0, 1]);
      for (const z of [0.5, 2, 7]) close(agCamW(cam, z), z + (cam.dist - z) * fl, 12);
    }
    // A camera object without proj (older callers) is Normal.
    const { proj: _p, ...old } = agCamera3({ params: agentParams({}) }, readNum, 0, 720);
    close(agProject3(old, [0.5, 0.2, -1]).x, agProject3(agCamera3({ params: agentParams({}) }, readNum, 0, 720), [0.5, 0.2, -1]).x, 12);
  });
  it('size with depth: Normal shrinks, Orthographic keeps it, Reverse grows it; the looked-at point keeps its size in all', () => {
    const scale = (extra: Record<string, unknown>, z: number) => { const c = agCamera3({ params: agentParams(extra) }, readNum, 0, 720); return c.lens / agCamW(c, z); };
    const D = SHOT.camDist;
    for (const m of MODES.slice(0, 4)) close(scale(m.extra, D), SHOT.fov / D, 9);
    expect(scale({}, 5)).toBeLessThan(scale({}, 2));
    close(scale({ projection: 'orthographic' }, 5), scale({ projection: 'orthographic' }, 2), 12);
    expect(scale({ projection: 'reverse' }, 5)).toBeGreaterThan(scale({ projection: 'reverse' }, 2));
    // Flatten blends the chosen projection toward orthographic: at 1 every one is orthographic.
    for (const m of MODES.slice(0, 4)) close(scale({ ...m.extra, ortho: 1 }, 5), scale({ ...m.extra, ortho: 1 }, 2), 12);
  });
  it('agProjection: (A / Distance, B) as documented, with the March Camera\'s clamp on m', () => {
    expect(agProjection({}, readNum, 3)).toEqual([0, 1]);
    expect(agProjection({ projection: 'normal' }, readNum, 3)).toEqual([0, 1]);
    expect(agProjection({ projection: 'orthographic' }, readNum, 3)).toEqual([1, 0]);
    const [a, b] = agProjection({ projection: 'reverse', reverseStrength: 1, reverseDist: 8 }, readNum, 3);
    close(a, 1 / (1 - 3 / 8), 12); close(b, -3 / ((1 - 3 / 8) * 8), 12);
    // Converge nearer than the target: m clamps at 0.2.
    close(agProjection({ projection: 'reverse', reverseStrength: 1, reverseDist: 2 }, readNum, 3)[0], 5, 12);
  });
  it('Reverse past where its rays cross: the picture flips, as the march\'s does; at the crossing nothing is drawn', () => {
    const extra = { projection: 'reverse', reverseStrength: 1, reverseDist: 6 };
    const cam = agCamera3({ params: agentParams(extra) }, readNum, 0, 720);
    const { ro, rd } = marchRay(marchParams(extra), [0.3, 0.2]);
    const far = add(ro, rd, 9);
    const q = agProject3(cam, far);
    close(q.x, 0.3, 5); close(q.y, 0.2, 5);
    expect(q.depth).toBeLessThan(0);
  });
  it('the shaders read u_proj through agCamW and rebuild a scene\'s camera with agSceneCam; all of them parse', () => {
    for (const src of [AG_DRAW3_VERT, AG_SPLAT_VERT, AG_SPOT_VERT]) {
      expect(src).toContain('uniform vec2 u_proj;');
      expect(src).toContain('float w = agCamW(z, cd, proj, fl);');
      expect(() => parser.parse(src, { quiet: true })).not.toThrow();
    }
    expect(AG_CAM_GLSL).toContain('void agSceneCam(');
    // The Splats look's Jacobian takes the projection's B (0 orthographic, negative reverse).
    expect(AG_SPLAT_VERT).toContain('float bz = (1.0 - fl) * proj.y;');
  });
});

describe('Draw agents\' Perspective in a graph', () => {
  // The Slime mold example in 3D, drawn by a 3D Draw agents (as agents3d.test.ts does).
  const graph = (params: Record<string, unknown>) => {
    const nodes = slimeMoldNodes(0, 0).map(x => (x.type === 'agentsGroup' ? { ...x, params: { ...x.params, space: '3d' } } : x));
    const draw = withAgentSpace(n('drawAgents', 'd3', 0, 0, params, { agents: ['slime', 'agents'] }), true, getNodeDefinition);
    return [...nodes.filter(x => x.type !== 'output'), draw, n('output', 'o2', 0, 0, {}, { color: ['d3', 'color'] })];
  };
  it('a camera that never chose one compiles as before: no Perspective or Reverse settings in its spec, no new uniforms', () => {
    const r = compileGraph({ nodes: graph({ reverseStrength: 1, reverseDist: 8 }) });
    expect(r.errors).toBeUndefined();
    const d = r.agents!.draws[0];
    for (const k of ['projection', 'reverseStrength', 'reverseDist']) expect(d.params, k).not.toHaveProperty(k);
    expect(Object.keys(r.paramUniforms ?? {}).some(k => /reverse/.test(k))).toBe(false);
  });
  it('Orthographic: the select in the spec, nothing else', () => {
    const d = compileGraph({ nodes: graph({ projection: 'orthographic' }) }).agents!.draws[0];
    expect(d.params.projection).toBe('orthographic');
    expect(d.params).not.toHaveProperty('reverseStrength');
  });
  it('Reverse: strength and Converge at are live uniforms (a drag, a Play mapping, no recompile)', () => {
    const r = compileGraph({ nodes: graph({ projection: 'reverse', reverseStrength: 0.7, reverseDist: 6 }) });
    expect(r.errors).toBeUndefined();
    const d = r.agents!.draws[0];
    expect(d.params.projection).toBe('reverse');
    expect(String(d.params.reverseStrength)).toMatch(/^u_p_/);
    expect(String(d.params.reverseDist)).toMatch(/^u_p_/);
    expect(r.paramUniforms![String(d.params.reverseStrength)]).toBe(0.7);
  });
});

describe('Splat Scene: Orthographic and Reverse', () => {
  const opts = (extra: Record<string, unknown>) => ({ camDist: SHOT.camDist, camAngle: deg(SHOT.angle), camElevation: deg(SHOT.elev), fov: SHOT.fov, target: SHOT.target as Vec3, ...extra } as Parameters<typeof marchCamera>[0]);
  const splatModes: Array<{ name: string; extra: { projection?: MarchProjection; reverseStrength?: number; reverseDist?: number; ortho?: number } }> = [
    { name: 'Normal', extra: {} },
    { name: 'Orthographic', extra: { projection: 'orthographic' } },
    { name: 'Reverse', extra: { projection: 'reverse', reverseStrength: 1, reverseDist: 8 } },
    { name: 'Reverse 0.5', extra: { projection: 'reverse', reverseStrength: 0.5, reverseDist: 4 } },
    { name: 'Flatten 0.6', extra: { ortho: 0.6 } },
  ];
  /** The probe's ten texels' camera parts, from the March Camera's real GLSL (texels 0–3, 8, 9). */
  const probeCamera = (extra: Record<string, unknown>, zc: number) => {
    const P = marchParams(extra);
    const at = (uv: [number, number]) => marchRay(P, uv);
    const c = at([0, 0]), x = at([0.5, 0]), y = at([0, 0.5]);
    return cameraFromProbe(c.ro as Vec3, c.rd as Vec3, x.rd as Vec3, y.rd as Vec3, x.ro as Vec3, y.ro as Vec3, zc);
  };
  for (const m of splatModes) {
    it(`${m.name}: marchCamera's rays are the node's, and a splat on the ray at g_uv projects to g_uv (from the sliders and from the probe)`, () => {
      const cam = marchCamera(opts(m.extra));
      const fromProbe = probeCamera(m.extra, SHOT.camDist);
      const cov = covariance3d([0.02, 0.01, 0.015], [0.9, 0.1, 0.3, 0.2].map(v => v / Math.hypot(0.9, 0.1, 0.3, 0.2)) as [number, number, number, number]);
      for (const uv of UVS) {
        const node = marchRay(marchParams(m.extra), uv);
        const o = cameraRayOrigin(cam, uv[0], uv[1]), d = cameraRay(cam, uv[0], uv[1]);
        o.forEach((v, i) => close(v, node.ro[i], 9));
        d.forEach((v, i) => close(v, node.rd[i], 9));
        for (const t of DEPTHS) {
          const p = add(node.ro, node.rd, t) as Vec3;
          for (const c of [cam, fromProbe]) {
            const q = projectSplat(p, cov, c, 720)!;
            close(q.uv[0], uv[0], 5); close(q.uv[1], uv[1], 5);
            // Distance from the ray's own origin: the March Loop's.
            close(q.dist, t, 5);
          }
        }
      }
    });
    it(`${m.name}: the Jacobian is the projection's (finite differences), so the ellipse is right`, () => {
      const cam = marchCamera(opts(m.extra));
      const S = [0.004, 0.001, -0.0007, 0.002, 0.0004, 0.003];
      const k = 360, h = 1e-5;
      const uvOf = (p: number[]) => projectSplat(p as Vec3, [0, 0, 0, 0, 0, 0], cam, 720)!.uv;
      const p0 = add(cameraRayOrigin(cam, 0.3, -0.2), cameraRay(cam, 0.3, -0.2), 2.2);
      // J (pixels per world unit), column by column.
      const J = [0, 1, 2].map(i => { const e = [0, 0, 0]; e[i] = h; const a = uvOf(add(p0, e)), b = uvOf(add(p0, e, -1)); return [k * (a[0] - b[0]) / (2 * h), k * (a[1] - b[1]) / (2 * h)]; });
      const Sm = [[S[0], S[1], S[2]], [S[1], S[3], S[4]], [S[2], S[4], S[5]]];
      const row = (r: number) => [J[0][r], J[1][r], J[2][r]];
      const q = (a: number[], b: number[]) => a.reduce((s, ai, i) => s + ai * b.reduce((t, bj, j) => t + Sm[i][j] * bj, 0), 0);
      const want = [q(row(0), row(0)) + 0.3, q(row(0), row(1)), q(row(1), row(1)) + 0.3];
      const got = projectSplat(p0 as Vec3, S, cam, 720)!.cov2;
      got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 4));
    });
  }
  it('Orthographic: no perspective divide, the Jacobian is affine: a splat is the same size near and far', () => {
    const cam = marchCamera(opts({ projection: 'orthographic' }));
    const cov = [0.003, 0, 0, 0.003, 0, 0.003];
    const at = (t: number) => projectSplat(add(cameraRayOrigin(cam, 0.2, 0.1), cameraRay(cam, 0.2, 0.1), t) as Vec3, cov, cam, 720)!;
    const near = at(1), far = at(5);
    near.cov2.forEach((v, i) => close(v, far.cov2[i], 9));
    expect(cam.bx).toBe(0);
  });
  it('Reverse: farther splats are bigger; Normal: smaller', () => {
    const cov = [0.003, 0, 0, 0.003, 0, 0.003];
    const size = (extra: Record<string, unknown>, t: number) => {
      const cam = marchCamera(opts(extra));
      return projectSplat(add(cameraRayOrigin(cam, 0, 0), cameraRay(cam, 0, 0), t) as Vec3, cov, cam, 720)!.cov2[0];
    };
    expect(size({ projection: 'reverse' }, 5)).toBeGreaterThan(size({ projection: 'reverse' }, 2));
    expect(size({}, 5)).toBeLessThan(size({}, 2));
  });
  it('a pinhole probe without origins (or with them at the eye) is the old camera', () => {
    const P = marchParams({});
    const c = marchRay(P, [0, 0]), x = marchRay(P, [0.5, 0]), y = marchRay(P, [0, 0.5]);
    const old = cameraFromProbe(c.ro as Vec3, c.rd as Vec3, x.rd as Vec3, y.rd as Vec3);
    const now = cameraFromProbe(c.ro as Vec3, c.rd as Vec3, x.rd as Vec3, y.rd as Vec3, x.ro as Vec3, y.ro as Vec3, 3);
    expect(now).toEqual(old);
    expect(old.ax).toBeUndefined();
  });
  it('the probe writes the ray origins half right and half up into texels 8 and 9; the splat shaders parse', () => {
    expect(SPLAT_PROBE_PRELUDE).toContain('splatProbeTexel == 2 || splatProbeTexel == 8 ? vec2(0.5, 0.0)');
    expect(SPLAT_PROBE_PRELUDE).toContain('splatProbeTexel == 3 || splatProbeTexel == 9 ? vec2(0.0, 0.5)');
    const node = { ...n('splatScene', 'sp', 0, 0, {}), type: 'splatProbeOut' } as GraphNode;
    const code = SplatProbeOutNode.generateGLSL(node, { ro: 'RO', rd: 'RD' }).code;
    expect(code).toContain('else if (sp_i == 7)');
    expect(code).toContain('else sp_o = vec4(RO, 1.0);');
    for (const src of [SPLAT_VERT, SPLAT_VERT_MOD]) {
      expect(src).toContain('float wx = ax + bx * z, wy = ay + by * z;');
      expect(() => parser.parse(src, { quiet: true })).not.toThrow();
    }
  });
});

describe('Splat builder: the camera\'s Perspective', () => {
  it('Normal (absent) builds the March Camera as before; Orthographic and Reverse set its Perspective', () => {
    const c = starterSplatScene().camera;
    expect(cameraParams(c)).not.toHaveProperty('projection');
    expect(cameraParams({ ...c, projection: 'orthographic' }).projection).toBe('orthographic');
    expect(cameraParams({ ...c, projection: 'reverse', reverse: 0.5, converge: 6 })).toMatchObject({ projection: 'reverse', reverseStrength: 0.5, reverseDist: 6 });
  });
  it('the recipe line keeps it, and an old line reads as Normal', () => {
    const s = starterSplatScene();
    expect(splatRecipe(s)).not.toMatch(/orthographic|reverse/);
    for (const camera of [{ ...s.camera, projection: 'orthographic' as const }, { ...s.camera, projection: 'reverse' as const, reverse: 0.4, converge: 5 }]) {
      const back = readSplatRecipe(splatRecipe({ ...s, camera }));
      expect(back.spec.camera).toMatchObject(camera);
    }
  });
});
