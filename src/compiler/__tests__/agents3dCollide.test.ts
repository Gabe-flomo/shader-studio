/**
 * Collide (3D scene) and the 3D examples (docs/agents-plan.md "3D", part 2): the scene grid is the
 * Particles node's (its sampler function is one shared generator, GP_SIM's text unchanged; its cells
 * map to the world as gpVolPoint says); sampling it trilinearly gives the scene's distance; the
 * node's response puts a walker back on the surface; the compile reads the Scene only in the grid
 * program, never in the update shader; and the "Agents in 3D" examples compile, every group 3D.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { sceneGridUniforms } from '../../nodes/definitions/agentForces';
import { withAgentSpace } from '../../nodes/definitions/agents';
import { GP_DEFAULTS, GP_SHADERS, GP_VOL, GP_VOL_TILES, gpVolAtGlsl, gpVolPoint } from '../../play/kit/gpuParticles.js';
import { AGENT_3D_EXAMPLE_KEYS, buildAgent3dExamples, torus3dNodes } from '../../store/agentExamples3d';
import { particlesAsNodes } from '../../store/particlesAsNodes';
import { webAgents } from '../../play/webInput';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Val } from './glslEval';

const close = (a: number, b: number, d = 6) => expect(a).toBeCloseTo(b, d);

/** The grid program's texel → cell (gpVolCellGlsl), in JS. */
const cellOf = (x: number, y: number) => [x % GP_VOL, y % GP_VOL, Math.floor(y / GP_VOL) * GP_VOL_TILES[0] + Math.floor(x / GP_VOL)];
/** A grid texture of the scene's distance, as the grid program writes it (R only), and its JS trilinear read (gpVolAtGlsl). */
function gridOf(sdf: (p: number[]) => number, centre: number[], half: number) {
  const W = GP_VOL * GP_VOL_TILES[0], H = GP_VOL * GP_VOL_TILES[1];
  const tex = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tex[y * W + x] = sdf(gpVolPoint(cellOf(x, y), centre, half));
  // texture(): bilinear at a normalised coordinate (texel centres at +0.5), clamped at the edges.
  const bilinear = (u: number, v: number) => {
    const fx = u * W - 0.5, fy = v * H - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const at = (x: number, y: number) => tex[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
  // gpVolAtGlsl's maths: bilinear inside a slice, then between two slices.
  const volAt = (q: number[]) => {
    const N = GP_VOL;
    const g = q.map(c => Math.min(N - 0.5, Math.max(0.5, c)));
    const z = g[2] - 0.5, z0 = Math.floor(z);
    const t0 = z0, t1 = Math.min(t0 + 1, GP_VOL - 1);
    const a = [((t0 % GP_VOL_TILES[0]) * N + g[0]) / W, (Math.floor(t0 / GP_VOL_TILES[0]) * N + g[1]) / H];
    const b = [((t1 % GP_VOL_TILES[0]) * N + g[0]) / W, (Math.floor(t1 / GP_VOL_TILES[0]) * N + g[1]) / H];
    return bilinear(a[0], a[1]) * (1 - (z - z0)) + bilinear(b[0], b[1]) * (z - z0);
  };
  /** A world point → grid cells, as Collide (3D scene) maps it. */
  const toCells = (p: number[]) => p.map((c, i) => ((c - centre[i]) / half * 0.5 + 0.5) * GP_VOL);
  return { volAt, toCells };
}

describe('the scene grid: the Particles node\'s, shared', () => {
  it('its sampler is one generator: the Particles engine\'s text is unchanged, the agents\' takes the grid as an argument', () => {
    expect(GP_SHADERS.GP_SIM).toContain(gpVolAtGlsl('gpVolAt', 'u_vol'));
    const ag = gpVolAtGlsl('agSceneAt', 's', 'highp sampler2D s, ');
    expect(ag.startsWith('float agSceneAt(highp sampler2D s, vec3 q) {')).toBe(true);
    expect(ag).toContain('texture(s, a).r');
    expect(getNodeDefinition('agentCollideScene')!.glslFunctions).toContain(ag);
  });
  it('the grid program writes each texel\'s cell centre the Particles node\'s way (gpVolPoint)', () => {
    const code = getNodeDefinition('agentGridOut')!.generateGLSL({ id: 'G', type: 'agentGridOut', position: { x: 0, y: 0 }, params: { slug: 'c' }, inputs: {}, outputs: {} }, { scene: 'scene_fn' }).code;
    expect(code).toContain(`vec3 agGridP = u_agVolC_c.xyz + ((vec3(float(agGridQ.x % ${GP_VOL}), float(agGridQ.y % ${GP_VOL}), float((agGridQ.y / ${GP_VOL}) * ${GP_VOL_TILES[0]} + agGridQ.x / ${GP_VOL})) + 0.5) / ${GP_VOL}.0 * 2.0 - 1.0) * u_agVolC_c.w;`);
    expect(code).toContain('gl_FragColor = vec4(scene_fn(agGridP), 0.0, 0.0, 1.0);');
    // The texel at (49, 50) is cell (1, 2, slice 1 * 8 + 1 = 9).
    expect(cellOf(49, 50)).toEqual([1, 2, 9]);
  });
  it('sampling it gives the scene\'s distance near its surfaces (to well under a cell)', () => {
    const torus = (p: number[]) => Math.hypot(Math.hypot(p[0], p[2]) - 0.85, p[1]) - 0.3;
    const { volAt, toCells } = gridOf(torus, [0, 0, 0], 1.6);
    const cell = 2 * 1.6 / GP_VOL;
    // Near its surfaces, where collisions happen (deep inside the tube the distance has a crease a grid can't hold).
    for (const p of [[0.85, 0.32, 0], [1.17, 0, 0], [0, 0, 0.53], [0.6, 0.25, 0.6], [-0.3, 0.1, -0.9], [0.5, -0.4, 0.4]]) {
      expect(Math.abs(volAt(toCells(p)) - torus(p)), String(p)).toBeLessThan(0.3 * cell);
    }
  });
});

describe('Collide (3D scene): the response', () => {
  const run = (p: number[], v: number[], dist: (q: number[]) => number) => {
    const node = withAgentSpace(n('agentCollideScene', 'C', 0, 0, { reach: 2, margin: 0.015, cushion: 0.15, bounce: 0, friction: 0.03 }), true, getNodeDefinition);
    const { code, outputVars } = getNodeDefinition('agentCollideScene')!.generateGLSL(node, {});
    const env = runGlsl(code, {
      a_pos: p, a_vel: v, a_dt: 1 / 60, u_agVolC_C: [0, 0, 0, 2],
      all: ((b: Val) => (b as unknown as boolean[]).every(Boolean)) as unknown as Val,
      agSceneAt: ((_s: Val, q: Val) => dist((q as number[]).map(c => (c / GP_VOL * 2 - 1) * 2))) as unknown as Val,
      u_agVol_C: 0,
    });
    return { p: env[outputVars.position] as number[], v: env[outputVars.velocity] as number[], hit: env[outputVars.hit] as number, d: env[outputVars.distance] as number };
  };
  // The floor y = 0 (its distance is y; inside below it).
  const floor = (q: number[]) => q[1];
  it('a walker inside a surface goes back onto it (Margin out) and loses its inward speed', () => {
    const r = run([0.1, -0.02, 0.3], [0.5, -2, 0], floor);
    close(r.p[1], 0.015, 4);
    close(r.v[1], 0, 6);
    close(r.v[0], 0.5 * 0.97, 6);
    expect(r.hit).toBe(1);
  });
  it('just outside, the cushion parts it; far away, nothing changes; outside the grid, no scene', () => {
    const near = run([0, 0.05, 0], [0, -1, 0], floor);
    expect(near.v[1]).toBeGreaterThan(-1); expect(near.hit).toBe(0);
    const far = run([0, 0.5, 0], [0, -1, 0], floor);
    expect(far.v).toEqual([0, -1, 0]);
    const off = run([0, 3, 0], [0, -1, 0], floor);
    close(off.d, 1000);
  });
});

describe('the compile: a Scene is read only by the grid program', () => {
  it('the torus example: one grid, its program evaluates the Torus scene; the update shader samples the grid and never the scene', () => {
    const r = compileGraph({ nodes: torus3dNodes(0, 0) });
    expect(r.errors).toBeUndefined();
    const g = r.agents!.groups[0];
    expect(g.space3d).toBe(true);
    expect(g.grids).toHaveLength(1);
    const gr = g.grids![0];
    const u = sceneGridUniforms(gr.slug);
    expect(gr.shader).toContain(`uniform vec4 ${u.at};`);
    expect(gr.shader).toMatch(/gl_FragColor = vec4\(\w+\(agGridP\), 0\.0, 0\.0, 1\.0\);/);
    expect(gr.shader).toContain('sdf3d_torus(');
    expect(g.fragmentShader).toContain(`uniform highp sampler2D ${u.grid};`);
    expect(g.fragmentShader).not.toContain('sdf3d_torus(');
    expect(gr.at).toHaveLength(4);
    // The page gets the grid's program and its uniform names.
    const web = webAgents(r.agents!);
    expect(web.groups[0].grids![0].u).toEqual(u);
    // Draw agents looks through the March Camera and hides behind the torus.
    expect(r.agents!.draws[0].probe?.depth).toBeDefined();
  });
  it('in a 2D group it says it needs Space 3D', () => {
    const nodes = torus3dNodes(0, 0).map(x => (x.type === 'agentsGroup' ? { ...x, params: { ...x.params, space: '2d' } } : x));
    expect(compileGraph({ nodes }).errors?.join(' ')).toMatch(/Collide \(3D scene\) works in a 3D group/);
  });
  it('Open as nodes carries a Particles node\'s Scene in 3D as Collide (3D scene), its Scene size as the grid\'s reach', () => {
    let k = 0;
    const src = n('gpuParticles', 'gp', 0, 0, { ...GP_DEFAULTS, space: '3d', sceneReach: 2.5 }, { scene: ['sc', 'scene'] });
    const r = particlesAsNodes(src, () => `n${k++}`, { x: 0, y: 0 });
    const g = r.nodes.find(x => x.type === 'agentsGroup')!;
    const inner = (g.params.subgraph as { nodes: Array<{ type: string; params: Record<string, unknown> }> }).nodes;
    expect(inner.find(x => x.type === 'agentCollideScene')!.params.reach).toBe(2.5);
    expect(g.inputs.scene.connection).toEqual({ nodeId: 'sc', outputKey: 'scene' });
    expect(r.missing.join(' ')).not.toMatch(/Scene/);
  });
});

describe('the "Agents in 3D" examples', () => {
  const graphs = buildAgent3dExamples();
  it('five of them: slime, flock, a torus, a galaxy, depth of field', () => {
    expect(AGENT_3D_EXAMPLE_KEYS).toEqual(['agent3dSlime', 'agent3dFlock', 'agent3dTorus', 'agent3dGalaxy', 'agent3dFireflies']);
  });
  it.each(AGENT_3D_EXAMPLE_KEYS)('%s compiles; its group is 3D; it draws through a camera', key => {
    const r = compileGraph({ nodes: graphs[key].nodes });
    expect(r.errors).toBeUndefined();
    expect(r.agents!.groups.every(g => g.space3d && g.live)).toBe(true);
    expect(r.agents!.draws.every(d => d.space3d && d.live)).toBe(true);
  });
  it('the slime and the flock read a volume trail in 3D', () => {
    for (const key of ['agent3dSlime', 'agent3dFlock']) {
      const r = compileGraph({ nodes: graphs[key].nodes });
      expect(r.agents!.trails[0].volume, key).toBeGreaterThan(0);
      expect(r.agents!.groups[0].fragmentShader, key).toContain('agVolAt(');
    }
  });
  it('the fireflies use depth of field: a strong Blur, a near Focus, a wide Max blur', () => {
    const d = graphs.agent3dFireflies.nodes.find(x => x.type === 'drawAgents')!;
    expect(d.params).toMatchObject({ blur: 2, focus: 0.75, maxBlur: 24 });
  });
});
