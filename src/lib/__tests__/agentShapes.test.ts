/**
 * Draw agents' Shapes (docs/particle-shapes.md, lib/agentShapes.ts): every shape × shading variant
 * preprocesses and parses as GLSL ES 3.00 (the browser sweep, dev/shapesBench.ts compileAll, links
 * them on the GPU); Dot leaves the spec and the picture's GLSL as they were; the cost note's numbers
 * and thresholds; the voxel snap and dedupe grid maths; and a true reset.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import * as THREE from 'three';
import { parser } from '@shaderfrog/glsl-parser';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import {
  AG_SHAPE_CLAIM_FRAG, AG_SHAPE_CLAIM_VERT, SHADINGS, SHAPES, SHAPE_ONLY, allShapeVariants, shapeCost, shapeShaders, shapeStride, shapeVertices,
  voxelCell, voxelGrid, voxelSnap, voxelTexel,
} from '../agentShapes';
import { compileGraph } from '../../compiler/graphCompiler';
import type { CompilationResult } from '../../compiler/types';
import { buildAgent3dExamples, slime3dNodes, voxelSlime3dNodes } from '../../store/agentExamples3d';
import { DrawAgentsNode, agentDrawUniform } from '../../nodes/definitions/agents';
import { AgentRunner, AgentTargets } from '../agentRunner';
import { AgentShapeRenderer } from '../agentShapeRenderer';
import type { GraphNode } from '../../types/nodeGraph';

const parses = (src: string) => {
  try { parser.parse(preprocess(src, { preserveComments: false }), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; }
};

describe('Shapes: the shaders', () => {
  const variants = allShapeVariants();
  it('covers every geometry × shading (spheres at both mesh details): 25 variants', () => {
    expect(variants).toHaveLength(4 * SHADINGS.length + SHADINGS.length);
  });
  it.each(variants.map(v => [`${v.cls} ${v.shading} ${v.detail}`, v] as const))('%s preprocesses and parses', (_name, v) => {
    const { vertex, fragment } = shapeShaders(v);
    expect(parses(vertex)).toBeNull();
    expect(parses(fragment)).toBeNull();
  });
  it('the claim pass parses', () => {
    expect(parses(AG_SHAPE_CLAIM_VERT)).toBeNull();
    expect(parses(AG_SHAPE_CLAIM_FRAG)).toBeNull();
  });
  it('each shader\'s vertex count is the one the renderer draws (V × shapes)', () => {
    for (const shape of SHAPES.filter(s => s !== 'dot')) for (const detail of ['impostor', 'low', 'smooth'] as const) {
      const cls = shape === 'tile' ? 'tile' : shape === 'sphere' ? (detail === 'impostor' ? 'impostor' : 'sphere') : 'box';
      const { vertex } = shapeShaders({ cls, shading: 'flat', detail });
      expect(Number(/#define V (\d+)/.exec(vertex)![1])).toBe(shapeVertices(shape, detail));
    }
    expect([shapeVertices('cube'), shapeVertices('tile'), shapeVertices('sphere', 'impostor'), shapeVertices('sphere', 'low'), shapeVertices('sphere', 'smooth')]).toEqual([18, 6, 6, 144, 576]);
  });
  it('boxes shade per vertex (no lighting per pixel); edges only on boxes and tiles; the impostor shades and writes its depth per pixel', () => {
    const pre = (src: string) => preprocess(src, { preserveComments: false });
    const f = (cls: 'box' | 'impostor' | 'sphere', shading: typeof SHADINGS[number]) => pre(shapeShaders({ cls, shading, detail: 'low' }).fragment);
    const main = (src: string) => src.slice(src.indexOf('void main()'));
    expect(main(f('box', 'lit'))).not.toMatch(/agShade|fwidth/);
    expect(main(f('box', 'litEdges'))).toMatch(/fwidth/);
    expect(main(f('sphere', 'litEdges'))).not.toMatch(/fwidth/);
    expect(main(f('impostor', 'lit'))).toMatch(/agShade/);
    expect(f('impostor', 'flat')).toMatch(/gl_FragDepth/);
    expect(f('box', 'lit')).not.toMatch(/gl_FragDepth/);
    expect(pre(shapeShaders({ cls: 'box', shading: 'flat', detail: 'impostor' }).vertex)).toMatch(/agShade\(vec3 c[^}]*return c;\s*\}/);
  });
});

const compile = (nodes: GraphNode[]) => compileGraph({ nodes }) as CompilationResult;

describe('Shapes: Dot is unchanged', () => {
  it('a 3D Draw agents at Dot: no shape, none of the shape settings in its spec', () => {
    const r = compile(slime3dNodes(0, 0));
    const d = r.agents!.draws[0];
    expect(d.space3d).toBe(true);
    expect(d.shape).toBeUndefined();
    expect(Object.keys(d.params).filter(k => SHAPE_ONLY.has(k))).toEqual([]);
  });
  it('a 2D Draw agents set to a shape stays dots (shapes are 3D only)', () => {
    const nodes = slime3dNodes(0, 0).map(n => (n.type === 'agentsGroup' ? { ...n, params: { ...n.params, space: '2d' } } : n.type === 'drawAgents' ? { ...n, params: { ...n.params, shape: 'cube' } } : n));
    const r = compile(nodes);
    expect(r.agents!.draws[0].shape).toBeUndefined();
    expect(Object.keys(r.agents!.draws[0].params).filter(k => SHAPE_ONLY.has(k))).toEqual([]);
  });
  it('the picture adds dots and covers with shapes', () => {
    const gl = (shape: string) => DrawAgentsNode.generateGLSL({ id: 'd', type: 'drawAgents', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { ...DrawAgentsNode.defaultParams, agentSpace: '3d', shape } } as GraphNode, { over: 'bg' }).code;
    expect(gl('dot')).toMatch(/d_color = bg \+ max\(d_s\.rgb/);
    expect(gl('cube')).toMatch(/d_color = bg \* \(1\.0 - clamp\(d_s\.a/);
  });
});

describe('Shapes: a shape\'s spec', () => {
  it('Voxel slime: shape voxel, its settings live sliders (uniforms) or choices', () => {
    const r = compile(voxelSlime3dNodes(0, 0));
    expect(r.errors).toBeUndefined();
    const d = r.agents!.draws[0];
    expect(d.shape).toBe('voxel');
    expect(d.params.shading).toBe('facesEdges');
    expect(d.params.voxelDedupe).toBe('on');
    // A float setting is the uniform its slider writes (live, no recompile).
    expect(typeof d.params.voxelGrid).toBe('string');
    expect(r.paramUniforms[d.params.voxelGrid as string]).toBeCloseTo(0.03);
  });
  it('the three Shape examples compile', () => {
    const ex = buildAgent3dExamples();
    for (const k of ['agent3dVoxelSlime', 'agent3dRodSwarm', 'agent3dCubeStorm']) {
      const r = compile(ex[k].nodes);
      expect(r.errors, k).toBeUndefined();
      expect(r.agents!.draws[0].shape, k).toBeDefined();
    }
  });
});

describe('Shapes: the cost note', () => {
  it('counts what Draw every and Max shapes leave, spread over all the walkers', () => {
    expect(shapeStride(262144, 1, 0)).toEqual({ stride: 1, drawn: 262144 });
    expect(shapeStride(262144, 4, 0)).toEqual({ stride: 4, drawn: 65536 });
    expect(shapeStride(1048576, 1, 100000)).toEqual({ stride: 11, drawn: 95326 });
    expect(shapeStride(1048576, 16, 100000).stride).toBe(16);
  });
  it('nothing for Dot; amber past about half a 60 fps frame (~800k boxes, fewer with edges)', () => {
    expect(shapeCost({ count: 262144, shape: 'dot', shading: 'lit' })).toBeNull();
    const at = (count: number, shading: typeof SHADINGS[number], shape: typeof SHAPES[number] = 'cube', sphereDetail?: 'impostor' | 'low' | 'smooth') => shapeCost({ count, shape, shading, sphereDetail })!.level;
    expect(at(262144, 'lit')).toBe('ok');
    expect(at(1048576, 'lit')).toBe('high');
    expect(at(1048576, 'litEdges')).toBe('high');
    expect(at(262144, 'flat')).toBe('ok');
    expect(at(1048576, 'faces')).toBe('high');
    expect(at(700000, 'flat')).toBe('ok');
    expect(at(600000, 'facesEdges')).toBe('high');
    expect(at(4194304, 'flat')).toBe('high');
    expect(at(262144, 'faces', 'tile')).toBe('ok');
    expect(at(1048576, 'flat', 'tile')).toBe('ok');
    // Heavy spheres: a smooth one is 32 boxes of vertices, about 14 times the time.
    expect(at(32768, 'lit', 'sphere', 'smooth')).toBe('ok');
    expect(at(262144, 'lit', 'sphere', 'smooth')).toBe('high');
    expect(at(262144, 'lit', 'sphere', 'impostor')).toBe('ok');
  });
  it('a cap brings it back under', () => {
    expect(shapeCost({ count: 1048576, shape: 'cube', shading: 'lit', maxShapes: 200000 })!.level).toBe('ok');
    const c = shapeCost({ count: 1048576, shape: 'cube', shading: 'lit' })!;
    expect(c.text).toMatch(/^Up to 1\.0M cubes \(18 vertices each, 19M in all\): about \d+ ms a frame on an M3 Pro at 1080p\. This could be expensive\.$/);
  });
});

describe('Shapes: voxels', () => {
  const aspect = 16 / 9;
  it('snaps to the centre of its cell, the grid anchored at the box\'s corner', () => {
    const g = 0.1;
    const p = [0.123, -0.456, 0.789];
    const s = voxelSnap(p, g, aspect);
    for (let i = 0; i < 3; i++) expect(Math.abs(s[i] - p[i])).toBeLessThanOrEqual(g / 2 + 1e-9);
    // The box's corner is a cell's corner: its first cell's centre is half a cell in.
    expect(voxelSnap([-aspect + 1e-6, -1 + 1e-6, -1 + 1e-6], g, aspect).map(v => Math.round(v * 1e6) / 1e6)).toEqual([Math.round((-aspect + 0.05) * 1e6) / 1e6, -0.95, -0.95]);
    // Everything in one cell snaps to the same place.
    const c = voxelSnap([0.1, 0.1, 0.1], g, aspect);
    expect(voxelSnap(c.map(v => v + 0.04), g, aspect)).toEqual(c);
    expect(voxelSnap(c.map(v => v - 0.04), g, aspect)).toEqual(c);
    expect(voxelCell([0, 0, 0], 0.5, 1)).toEqual([2, 2, 2]);
  });
  it('the dedupe grid fits a 4096-wide atlas down to the smallest cell, one texel a cell', () => {
    for (const g of [0.01, 0.02, 0.03, 0.1, 0.25]) {
      const grid = voxelGrid(g, aspect);
      expect(grid.w).toBeLessThanOrEqual(4096);
      expect(grid.h).toBeLessThanOrEqual(4096);
      expect(grid.tiles * Math.ceil(grid.nz / grid.tiles)).toBeGreaterThanOrEqual(grid.nz);
    }
    const grid = voxelGrid(0.25, 1);
    const seen = new Set<string>();
    for (let z = 0; z < grid.nz; z++) for (let y = 0; y < grid.ny; y++) for (let x = 0; x < grid.nx; x++) {
      const t = voxelTexel([x, y, z], grid)!;
      expect(t[0]).toBeLessThan(grid.w); expect(t[1]).toBeLessThan(grid.h);
      seen.add(t.join(','));
    }
    expect(seen.size).toBe(grid.nx * grid.ny * grid.nz);
    expect(voxelTexel([-1, 0, 0], grid)).toBeNull();
    expect(voxelTexel([0, grid.ny, 0], grid)).toBeNull();
  });
  it('one per cell: the highest index in a cell owns it, and exactly one walker draws in each filled cell', () => {
    // The claim pass on the CPU: points in index order, the last write stays.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const g = 0.2, grid = voxelGrid(g, aspect);
    const walkers = Array.from({ length: 4000 }, () => [(rnd() * 2 - 1) * aspect, rnd() * 2 - 1, rnd() * 2 - 1]);
    const owner = new Map<string, number>();
    walkers.forEach((p, i) => { const t = voxelTexel(voxelCell(p, g, aspect), grid); if (t) owner.set(t.join(','), i); });
    const drawn = walkers.filter((p, i) => owner.get(voxelTexel(voxelCell(p, g, aspect), grid)!.join(',')) === i);
    const filled = new Set(walkers.map(p => voxelCell(p, g, aspect).join(',')));
    expect(drawn).toHaveLength(filled.size);
    expect(drawn.length).toBeLessThan(walkers.length);
  });
});

// ── A true reset with shapes ─────────────────────────────────────────────────────────────────────

const hash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
/** A recording renderer (as trueReset.test.ts's): every target holds a hash of what was drawn into it, from what. */
function hashRenderer() {
  const content = new Map<THREE.WebGLRenderTarget, string>();
  const byTexture = new Map<THREE.Texture, THREE.WebGLRenderTarget>();
  const ids = new Map<string, number>();
  let target: THREE.WebGLRenderTarget | null = null;
  const seen = (rt: THREE.WebGLRenderTarget) => { for (const t of rt.textures) byTexture.set(t, rt); if (!content.has(rt)) content.set(rt, 'new'); };
  const read = (v: unknown) => (v instanceof THREE.Texture && byTexture.has(v) ? content.get(byTexture.get(v)!) : undefined);
  const renderer = {
    compileAsync: () => Promise.resolve(),
    getContext: () => ({ getProgramParameter: () => true, LINK_STATUS: 0, flush: () => {} }),
    properties: { get: () => ({}) },
    autoClear: true,
    getClearColor: (c: THREE.Color) => c, getClearAlpha: () => 0, setClearColor: () => {},
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t; if (t) seen(t); },
    clear: () => { if (target) content.set(target, '0'); },
    render: (scene: THREE.Scene) => {
      if (!target) return;
      const obj = scene.children[0] as THREE.Mesh;
      const m = obj.material as THREE.ShaderMaterial;
      let id = ids.get(m.fragmentShader);
      if (id === undefined) { id = ids.size; ids.set(m.fragmentShader, id); }
      const parts: string[] = [`p${id}`, `n${(obj.geometry as THREE.BufferGeometry).drawRange.count}`];
      for (const [k, u] of Object.entries(m.uniforms ?? {})) {
        const v = u.value as unknown;
        const c = read(v);
        if (c !== undefined) parts.push(`${k}=${c}`);
        else if (typeof v === 'number') parts.push(`${k}=${Math.round(v * 1e6) / 1e6}`);
      }
      content.set(target, hash(`${content.get(target)}|${parts.join('|')}`));
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, contentOf: (rt: THREE.WebGLRenderTarget) => content.get(rt) ?? 'none' };
}

/**
 * The shapes keep nothing from frame to frame (the dedupe grid is cleared before every claim), so a
 * reset of the walkers (trueReset.test.ts) is a reset of what they draw: the same state at the same
 * time draws the same picture, whatever was drawn before.
 */
function shapeDraws() {
  const { renderer, contentOf } = hashRenderer();
  const shapes = new AgentShapeRenderer(new THREE.BufferGeometry());
  const into = new THREE.WebGLRenderTarget(64, 36, { depthBuffer: true });
  const stateRt = [0, 1].map(() => new THREE.WebGLRenderTarget(8, 8, { count: 2 }));
  // Two different walker states: something different drawn into each.
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ fragmentShader: 'state', uniforms: { k: { value: 0 } } });
  scene.add(new THREE.Mesh(new THREE.BufferGeometry(), mat));
  stateRt.forEach((rt, i) => { mat.uniforms.k.value = i + 1; renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, new THREE.Camera()); });
  const cam = { eye: [0, 0, 3], fwd: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0], lens: 1.8, ortho: 0, dist: 3 };
  const look = {
    shape: 'voxel' as const, shading: 'facesEdges' as const, facing: 'motion' as const, detail: 'impostor' as const, size: 0.01, sizeBy: 0, rodLength: 4, rodStretch: 0, spin: 1,
    grid: 0.05, dedupe: true, every: 1, maxShapes: 0, farDots: 0, ambient: 0.3, rim: 0.3, edgeWidth: 0.1,
    colorBy: 3, bright: 1, speedRef: 0.5, fade: false, usePal: false, rainbow: false, pal: null, colA: [1, 1, 1], colB: [0, 0, 0],
  };
  return (state: 0 | 1, time: number, over?: Partial<typeof look>) => {
    const t = stateRt[state].textures;
    shapes.draw(renderer, into, { a: t[0], b: t[1], c: null, e: null, side: 8, species: 1 }, { ...look, ...over }, cam, 16 / 9, time, null);
    return contentOf(into);
  };
}

describe('Shapes: a true reset', () => {
  it('the same walkers at the same time draw the same voxels, whatever was drawn before (nothing kept)', () => {
    const fresh = shapeDraws();
    const want = [fresh(0, 0), fresh(0, 1 / 60)];
    const run = shapeDraws();
    for (let k = 0; k < 30; k++) run((k % 2) as 0 | 1, k / 60, { grid: 0.05 + k * 0.001 });
    expect([run(0, 0), run(0, 1 / 60)]).toEqual(want);
    // Control: other walkers draw something else.
    expect(run(1, 0)).not.toEqual(want[0]);
  });
  it('the Voxel slime example runs, resets and draws again through the app\'s runner', async () => {
    const r = compile(voxelSlime3dNodes(0, 0));
    const uniforms: Record<string, THREE.IUniform> = { u_time: { value: 0 } };
    for (const [k, v] of Object.entries(r.paramUniforms)) uniforms[k] = { value: v };
    const { renderer, contentOf } = hashRenderer();
    const runner = new AgentRunner({ renderer, geometry: new THREE.PlaneGeometry(2, 2), camera: new THREE.Camera(), uniforms: () => uniforms, onReady: () => {}, onLinkFailed: () => {} });
    runner.update(r.agents!, 'void main() {}');
    await new Promise(res => setTimeout(res, 0));
    const targets = new AgentTargets(renderer, true);
    const d = r.agents!.draws[0];
    const frame = (t: number) => { runner.run(targets, { width: 320, height: 180, time: t, live: true, frameMs: 16.7 }); return targets.draws.get(d.slug)!; };
    for (let k = 0; k < 10; k++) frame(k / 60);
    targets.resetAll(); runner.resetRuntime();
    const ds = frame(0);
    expect(ds.acc.depthBuffer).toBe(true);
    expect(contentOf(ds.acc)).not.toBe('0');
    expect(uniforms[agentDrawUniform(d.slug)].value).toBe(ds.acc.texture);
  });
});

describe('voxel Glide', () => {
  it('is a shape setting, 0.5 by default, read live and in every voxel-capable shader', () => {
    expect(SHAPE_ONLY.has('voxelGlide')).toBe(true);
    expect(DrawAgentsNode.paramDefs!.voxelGlide).toMatchObject({ min: 0, max: 1 });
    const boxes = allShapeVariants().filter(v => shapeShaders(v).vertex.includes('u_voxel == 1'));
    expect(boxes.length).toBeGreaterThan(0);
    for (const v of boxes) expect(shapeShaders(v).vertex).toContain('smoothstep(vec3(1.0 - u_glide), vec3(1.0), fract(q))');
  });

  it('moves continuously across a cell edge (the JS mirror of the shader)', () => {
    const glide = (x: number, w: number) => {
      const f = x - Math.floor(x);
      const e = w > 0 ? Math.min(1, Math.max(0, (f - (1 - w)) / w)) : 0;
      return Math.floor(x) + 0.5 + e * e * (3 - 2 * e);
    };
    // Just below and just above the edge between cells 2 and 3 land at the same place.
    expect(glide(2.9999, 0.5)).toBeCloseTo(glide(3.0001, 0.5), 2);
    // Glide 0 snaps: the middle of the cell until the edge.
    expect(glide(2.9, 0)).toBe(2.5);
    // In the held part of the cell it sits at the centre.
    expect(glide(2.3, 0.5)).toBe(2.5);
  });
});
