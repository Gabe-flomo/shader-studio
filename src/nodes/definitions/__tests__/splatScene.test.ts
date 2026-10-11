/**
 * Splat Scene (nodes/definitions/splatScene.ts, compiler/splatGraph.ts): compiling into a ray-marched scene, its probe
 * program, and compositing against an SDF at known depths (the GLSL's plain-JS mirror, fed by a CPU splat render).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../../compiler/graphCompiler';
import { SPLAT_PROBE_PRELUDE } from '../../../compiler/splatGraph';
import { n } from '../../../store/graphBuilder';
import { EXAMPLE_GRAPHS } from '../../../store/exampleGraphs';
import { getNodeDefinition, resolveNodeAliases } from '..';
import { SPLAT_FAR, splatComposite } from '../splatScene';
import { cameraRay, covariance3d, marchCamera, projectSplat, splatWeight, type Vec3 } from '../../../lib/splats/math';
import type { GraphNode } from '../../../types/nodeGraph';

function sceneWithSplats(extra: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}): GraphNode[] {
  const base = resolveNodeAliases(EXAMPLE_GRAPHS.shapesAndGround3D.nodes, getNodeDefinition).filter(x => x.type !== 'output');
  const loop = base.find(x => x.type === 'marchLoopGroup')!;
  const cam = base.find(x => x.type === 'marchCamera')!;
  return [
    ...base,
    n('splatScene', 'scan', 0, 0, extra, { ro: [cam.id, 'ro'], rd: [cam.id, 'rd'], scene: [loop.id, 'color'], dist: [loop.id, 'dist'], hit: [loop.id, 'hit'], ...wires }),
    n('output', 'out', 0, 0, {}, { color: ['scan', 'color'] }),
  ];
}

describe('Splat Scene: compiling', () => {
  it('compiles into a March Loop scene, sampling its two textures', () => {
    const r = compileGraph({ nodes: sceneWithSplats() });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    const color = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'scan::color');
    const depth = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'scan::depth');
    expect(color).toBeTruthy();
    expect(depth).toBeTruthy();
    expect(r.fragmentShader).toContain(`uniform sampler2D ${color};`);
    expect(r.fragmentShader).toContain(`texture2D(${depth}, vUv)`);
    // Its placement sliders are live uniforms (a drag never recompiles), bound by the node's id.
    expect(r.paramBindings['scan::position']).toBeTruthy();
    expect(r.paramBindings['scan::rotation']).toBeTruthy();
    expect(r.paramBindings['scan::scale']).toBeTruthy();
    expect(r.paramBindings['scan::splatSize']).toBeTruthy();
  });

  it('makes a probe program: the camera chain and the node as its end, over 8 texels, uniforms named as the picture’s', () => {
    const r = compileGraph({ nodes: sceneWithSplats() });
    expect(r.splats).toHaveLength(1);
    const pr = r.splats![0];
    expect(pr.nodeId).toBe('scan');
    expect(pr.fragmentShader).toContain(SPLAT_PROBE_PRELUDE);
    expect(pr.fragmentShader).toMatch(/gl_FragColor = \w+_o;/);
    // The March Camera is in it; the March Loop is not (the probe needs only the camera).
    expect(pr.fragmentShader).toMatch(/_rd0\s+=/);
    expect(pr.fragmentShader).not.toMatch(/sceneSDF|for \(int/);
    // Every uniform the probe reads is one the picture has (so it draws with the picture's uniforms).
    for (const name of Object.keys(pr.paramUniforms)) expect(r.paramUniforms[name]).toBeDefined();
    expect(pr.paramUniforms[r.paramBindings['scan::position']]).toEqual([0, 0, 0]);
  });

  it('wired Position / Scale go into the probe', () => {
    const nodes = sceneWithSplats({}, { scale: ['k', 'value'] });
    nodes.push(n('constant', 'k', 0, 0, { value: 2.5 }));
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    expect(r.splats![0].fragmentShader).toMatch(/\* \(\w+\);/);
  });

  it('“Up is: +Y” leaves the scan unturned; −Y flips y and z', () => {
    const up = compileGraph({ nodes: sceneWithSplats({ up: 'y' }) }).splats![0].fragmentShader;
    const down = compileGraph({ nodes: sceneWithSplats() }).splats![0].fragmentShader;
    expect(up).toContain('* mat3(1.0) *');
    expect(down).toContain('mat3(1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, -1.0)');
  });

  it('with no Scene wired it is the splats over black, and compiles alone', () => {
    const r = compileGraph({ nodes: [n('splatScene', 'scan', 0, 0), n('output', 'out', 0, 0, {}, { color: ['scan', 'color'] })] });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(r.splats![0].fragmentShader).toContain('normalize(vec3(g_uv, -1.5))');
  });

  it('a graph without one has no probes', () => {
    const r = compileGraph({ nodes: [n('output', 'out', 0, 0)] });
    expect(r.splats).toBeUndefined();
  });
});

// ── Compositing at known depths ─────────────────────────────────────────────

/**
 * The raster pass on the CPU for one pixel: every splat's weight there, blended far to near (over), with the same
 * distance weighting the depth target gets (Σ αᵢ Tᵢ dᵢ, and the alpha).
 */
function splatPixel(splats: Array<{ p: Vec3; s: number; rgb: [number, number, number]; o: number }>, cam: ReturnType<typeof marchCamera>, u: number, v: number, H = 400) {
  const proj = splats.map(s => ({ s, pr: projectSplat(s.p, covariance3d([s.s, s.s, s.s], [1, 0, 0, 0]), cam, H)! })).filter(x => x.pr);
  proj.sort((a, b) => b.pr.z - a.pr.z);
  let rgb: [number, number, number] = [0, 0, 0], alpha = 0, dsum = 0;
  for (const { s, pr } of proj) {
    const d: [number, number] = [(u - pr.uv[0]) * H / 2, (v - pr.uv[1]) * H / 2];
    const a = Math.min(0.99, splatWeight(pr, d) * s.o);
    rgb = rgb.map((c, i) => a * s.rgb[i] + (1 - a) * c) as [number, number, number];
    dsum = a * pr.dist + (1 - a) * dsum;
    alpha = a + (1 - a) * alpha;
  }
  return { rgb, alpha, dist: alpha > 1e-4 ? dsum / alpha : SPLAT_FAR };
}

/** A sphere's distance along the camera's ray at g_uv (the March Loop's Distance), or a miss. */
function sphereAlong(cam: ReturnType<typeof marchCamera>, u: number, v: number, c: Vec3, r: number): { dist: number; hit: number } {
  const d = cameraRay(cam, u, v), o = cam.eye.map((x, i) => x - c[i]);
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], cc = o[0] ** 2 + o[1] ** 2 + o[2] ** 2 - r * r;
  const disc = b * b - cc;
  if (disc < 0) return { dist: 20, hit: 0 };
  return { dist: -b - Math.sqrt(disc), hit: 1 };
}

describe('Splat Scene: compositing with an SDF at known depths', () => {
  const cam = marchCamera({ camDist: 5, camAngle: 0, camElevation: 0, fov: 1.5 });
  // The camera is at z = 5 looking at the origin: distance from it is 5 − z on the axis.
  const red: [number, number, number] = [1, 0, 0];
  const wall = (z: number) => {
    const out: Array<{ p: Vec3; s: number; rgb: [number, number, number]; o: number }> = [];
    for (let x = -1; x <= 1.001; x += 0.1) for (let y = -1; y <= 1.001; y += 0.1) out.push({ p: [x, y, z], s: 0.06, rgb: red, o: 0.95 });
    return out;
  };

  it('a wall of splats at distance 4 reads distance 4 and is solid', () => {
    const px = splatPixel(wall(1), cam, 0, 0);
    expect(px.alpha).toBeGreaterThan(0.95);
    expect(px.dist).toBeCloseTo(4, 2);
  });

  it('a sphere in front of the wall hides it; the wall hides a sphere behind it', () => {
    const splats = wall(1);
    const px = splatPixel(splats, cam, 0, 0);
    const premul = px.rgb;
    // Sphere at z = 2.5, radius 0.5: its surface 2 from the eye, in front of the wall (4).
    const near = sphereAlong(cam, 0, 0, [0, 0, 2.5], 0.5);
    expect(near.dist).toBeCloseTo(2, 6);
    const a = splatComposite({ rgb: premul, alpha: px.alpha, dist: px.dist }, { rgb: [0, 0, 1], dist: near.dist, hit: near.hit });
    expect(a.front).toBe(1);
    expect(a.rgb).toEqual([0, 0, 1]);
    // Sphere at z = −1: its surface 5.5 away, behind the wall.
    const far = sphereAlong(cam, 0, 0, [0, 0, -1], 0.5);
    const b = splatComposite({ rgb: premul, alpha: px.alpha, dist: px.dist }, { rgb: [0, 0, 1], dist: far.dist, hit: far.hit });
    expect(b.front).toBe(0);
    expect(b.rgb[0]).toBeGreaterThan(0.9);
    expect(b.rgb[2]).toBeLessThan(0.05);
  });

  it('a sphere crossing the wall: in front at its middle, hidden at its rim', () => {
    const splats = wall(1);
    // Sphere just behind the wall (z = 0.5), radius 0.6: its front cap pokes 0.1 out of the wall's middle.
    const centre: Vec3 = [0, 0, 0.5];
    const mid = splatPixel(splats, cam, 0, 0);
    const s0 = sphereAlong(cam, 0, 0, centre, 0.6);
    expect(splatComposite({ rgb: mid.rgb, alpha: mid.alpha, dist: mid.dist }, { rgb: [0, 0, 1], dist: s0.dist, hit: s0.hit }).front).toBe(1);
    // 0.45 across (g_uv = 1.5 · 0.45 / 4) the sphere's surface has fallen behind the wall's splats.
    const u = 1.5 * 0.45 / 4;
    const rim = splatPixel(splats, cam, u, 0);
    const s1 = sphereAlong(cam, u, 0, centre, 0.6);
    expect(s1.hit).toBe(1);
    expect(s1.dist).toBeGreaterThan(rim.dist + 0.05);
    expect(splatComposite({ rgb: rim.rgb, alpha: rim.alpha, dist: rim.dist }, { rgb: [0, 0, 1], dist: s1.dist, hit: s1.hit }).front).toBe(0);
  });

  it('where the scene misses, the splats lie over its background', () => {
    const r = splatComposite({ rgb: [0.25, 0, 0], alpha: 0.5, dist: 3 }, { rgb: [0, 0, 1], dist: 20, hit: 0 });
    expect(r.front).toBe(0);
    expect(r.rgb).toEqual([0.25, 0, 0.5]);
  });
});
