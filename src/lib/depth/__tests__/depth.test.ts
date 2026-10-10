/**
 * The Depth node (docs/depth-node.md): it compiles with each output wired and each source, names its source for
 * the engine, binds its sampler (live: a node texture; baked video: a video texture); the near mask, normals and
 * parallax maths on synthetic depth; when it runs; and a bake's bookkeeping.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../../compiler/graphCompiler';
import { n } from '../../../store/graphBuilder';
import { getNodeDefinition } from '../../../nodes/definitions';
import {
  DEPTH_SOURCE_MARK, depthBakeOf, depthNearMask, depthNormal, depthOut, depthParallax, depthSampler, type DepthBakeInfo,
} from '../../../nodes/definitions/depth';
import { depthNodesIn, depthSources } from '../engine';
import {
  DEPTH_BAKE_MAX_SECONDS, bakedParams, blendDepth, depthBakeFileName, depthRowsUp, depthToGreyRgba, followSource, grabSize, planDepthBake, shouldRun, type RunCheck,
} from '../plan';
import { countVideoRefs } from '../../videoUsage';
import type { GraphNode } from '../../../types/nodeGraph';

type Wire = [string, string];

const SOURCES: Record<string, () => { nodes: GraphNode[]; tex: Wire | null; sampler: string | RegExp }> = {
  textureInput: () => ({ nodes: [n('textureInput', 'src', 0, 0)], tex: ['src', 'texture'], sampler: /u_tex_\w+/ }),
  videoInput: () => ({ nodes: [n('videoInput', 'src', 0, 0)], tex: ['src', 'texture'], sampler: /u_vid_\w+/ }),
  baked: () => ({ nodes: [n('baked', 'src', 0, 0)], tex: ['src', 'texture'], sampler: /u_vid_\w+/ }),
  pass: () => ({
    nodes: [n('uv', 'u', 0, 0), n('fbm', 'pic', 0, 0, {}, { uv: ['u', 'uv'] }), n('pass', 'src', 0, 0, {}, { color: ['pic', 'value'] })],
    tex: ['src', 'texture'], sampler: /u_pass_\w+/,
  }),
  picture: () => ({ nodes: [], tex: null, sampler: 'picture' }),
};

/** Each output, into the Output's colour (a texture through Sample). */
const OUTPUTS: Record<string, (nodes: GraphNode[]) => GraphNode[]> = {
  depth: ns => [...ns, n('output', 'out', 0, 0, {}, { color: ['d', 'depth'] })],
  nearMask: ns => [...ns, n('output', 'out', 0, 0, {}, { color: ['d', 'nearMask'] })],
  normal: ns => [...ns, n('output', 'out', 0, 0, {}, { color: ['d', 'normal'] })],
  parallaxUv: ns => [...ns, n('textureInput', 'pic2', 0, 0, {}, { uv: ['d', 'parallaxUv'] }), n('output', 'out', 0, 0, {}, { color: ['pic2', 'color'] })],
  texture: ns => [...ns, n('textureMask', 'm', 0, 0, {}, { texture: ['d', 'texture'] }), n('output', 'out', 0, 0, {}, { color: ['m', 'mask'] })],
};

function depthGraph(source: string, output: string, params: Record<string, unknown> = {}): GraphNode[] {
  const s = SOURCES[source]();
  return OUTPUTS[output]([...s.nodes, n('depth', 'd', 0, 0, params, s.tex ? { texture: s.tex } : {})]);
}

describe('Depth node compiles', () => {
  it('is registered with notes on every socket and setting, Small the default model', () => {
    const def = getNodeDefinition('depth')!;
    expect(def.category).toBe('Texture tools');
    for (const [k, s] of [...Object.entries(def.inputs), ...Object.entries(def.outputs)]) expect(s.hint?.length ?? 0, k).toBeGreaterThan(10);
    for (const [k, pd] of Object.entries(def.paramDefs ?? {})) expect(pd.hint?.length ?? 0, k).toBeGreaterThan(10);
    expect(def.defaultParams?.model).toBe('depth-anything-v2-small');
    expect(def.paramDefs!.model).toBeUndefined(); // one model now: no picker
    expect(Object.keys(def.outputs)).toEqual(['depth', 'texture', 'nearMask', 'normal', 'parallaxUv']);
  });

  for (const output of Object.keys(OUTPUTS)) {
    it(`compiles with ${output} wired, from every source, and names that source for the engine`, () => {
      for (const source of Object.keys(SOURCES)) {
        const r = compileGraph({ nodes: depthGraph(source, output) });
        expect(r.errors, `${output} from ${source}`).toBeUndefined();
        expect(r.success).toBe(true);
        const shaders = [r.fragmentShader, ...(r.passes ?? []).map(p => p.fragmentShader)];
        const marks = depthSources(shaders);
        expect(marks.size, `${output} from ${source}`).toBe(1);
        const [own, src] = [...marks][0];
        expect(own).toMatch(/^u_tex_/);
        if (typeof SOURCES[source]().sampler === 'string') expect(src).toBe('picture'); else expect(src).toMatch(SOURCES[source]().sampler);
        // Its sampler is bound from the node's texture (the engine fills it), declared once.
        expect(r.textureUniforms[own]).toBe('d');
        expect(r.fragmentShader.match(new RegExp(`uniform sampler2D ${own};`, 'g'))?.length ?? 0).toBe(r.fragmentShader.includes(own) ? 1 : 0);
      }
    });
  }

  it('every setting compiles; Near is dark turns the Depth output over', () => {
    const def = getNodeDefinition('depth')!;
    for (const [k, pd] of Object.entries(def.paramDefs ?? {})) {
      for (const o of pd.options ?? []) expect(compileGraph({ nodes: depthGraph('textureInput', 'depth', { [k]: o.value }) }).errors, `${k}=${o.value}`).toBeUndefined();
    }
    expect(compileGraph({ nodes: depthGraph('textureInput', 'depth', { nearIs: 'dark' }) }).fragmentShader).toMatch(/float \w+_depth = 1\.0 - \w+_near;/);
  });

  it('a baked video plays through the video path (u_vid_), bound like a Video Input', () => {
    const depthBake: DepthBakeInfo = { kind: 'video', videoId: 'vid-1', model: 'depth-anything-v2-small', side: 384, width: 384, height: 216, fps: 30, frames: 90, duration: 3, smoothing: 0.5, bytes: 1000, bakedAt: 1, source: 'Video Input' };
    const r = compileGraph({ nodes: depthGraph('videoInput', 'normal', { update: 'baked', depthBake }) });
    expect(r.errors).toBeUndefined();
    const [own] = [...depthSources([r.fragmentShader])][0];
    expect(own).toMatch(/^u_vid_/);
    expect(r.videoUniforms[own]).toBe('d');
    expect(Object.values(r.textureUniforms)).not.toContain('d');
    // A baked image stays a node texture; Update: Baked with nothing baked yet too.
    expect(depthSampler(n('depth', 'x', 0, 0, { update: 'baked', depthBake: { ...depthBake, kind: 'image', videoId: undefined, libraryId: 'img-1' } }))).toBe('u_tex_x');
    expect(depthSampler(n('depth', 'x', 0, 0, { update: 'baked' }))).toBe('u_tex_x');
  });

  it('the engine finds Depth nodes inside groups too, and reads the marks', () => {
    const inner = n('depth', 'inner', 0, 0);
    const group = { ...n('group', 'g', 0, 0), params: { subgraph: { nodes: [inner], edges: [] } } } as unknown as GraphNode;
    expect(depthNodesIn([n('depth', 'top', 0, 0), group]).map(x => x.id)).toEqual(['top', 'inner']);
    expect([...depthSources([`  ${DEPTH_SOURCE_MARK}u_tex_d u_pass_p\n  ${DEPTH_SOURCE_MARK}u_tex_e picture\n`])]).toEqual([['u_tex_d', 'u_pass_p'], ['u_tex_e', 'picture']]);
  });
});

// ── The maths ────────────────────────────────────────────────────────────────

describe('near mask, normals and parallax on synthetic depth', () => {
  it('near mask is 1 nearer than the cut-off, fading over the softness below it', () => {
    expect(depthNearMask(0.9, 0.6, 0.1)).toBe(1);
    expect(depthNearMask(0.6, 0.6, 0.1)).toBe(1);
    expect(depthNearMask(0.5, 0.6, 0.1)).toBe(0);
    expect(depthNearMask(0.55, 0.6, 0.1)).toBeCloseTo(0.5, 5);
    expect(depthNearMask(0.2, 0.6, 0)).toBe(0);
    expect(depthNearMask(0.61, 0.6, 0)).toBe(1);
  });

  it('Depth: near is bright, or turned over', () => {
    expect(depthOut(0.8, 'bright')).toBe(0.8);
    expect(depthOut(0.8, 'dark')).toBeCloseTo(0.2, 6);
  });

  it('a flat depth faces the viewer; a ramp tilts away from where it rises', () => {
    expect(depthNormal(() => 0.5, 0.5, 0.5, 0.01, 1).map(v => v + 0)).toEqual([0, 0, 1]);
    // Nearness rising to the right: the surface faces left (−x), and more with more Relief.
    const ramp = (u: number) => u;
    const a = depthNormal(ramp, 0.5, 0.5, 0.01, 0.5);
    const b = depthNormal(ramp, 0.5, 0.5, 0.01, 2);
    expect(a[0]).toBeLessThan(0); expect(a[1]).toBeCloseTo(0, 9);
    expect(b[0]).toBeLessThan(a[0]);
    expect(Math.hypot(...b)).toBeCloseTo(1, 9);
    // Slope per picture unit: x spans 2 × aspect, so a wide picture's ramp is gentler.
    expect(Math.abs(depthNormal(ramp, 0.5, 0.5, 0.01, 1, 2)[0])).toBeLessThan(Math.abs(depthNormal(ramp, 0.5, 0.5, 0.01, 1, 1)[0]));
  });

  it('a near bump’s normals point outward from its middle', () => {
    const bump = (u: number, v: number) => Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 4);
    const right = depthNormal(bump, 0.6, 0.5, 0.01, 0.5), up = depthNormal(bump, 0.5, 0.6, 0.01, 0.5), left = depthNormal(bump, 0.4, 0.5, 0.01, 0.5);
    expect(right[0]).toBeGreaterThan(0);
    expect(left[0]).toBeLessThan(0);
    expect(up[1]).toBeGreaterThan(0);
    expect(right[2]).toBeGreaterThan(0);
  });

  it('parallax moves near things along the direction, far ones the other way, the focus still', () => {
    expect(depthParallax([0, 0], 1, [1, 0], 0.04, 0.5)).toEqual([0.02, 0]);
    expect(depthParallax([0, 0], 0, [1, 0], 0.04, 0.5)).toEqual([-0.02, 0]);
    expect(depthParallax([0.3, -0.2], 0.5, [0.6, 0.8], 0.04, 0.5)).toEqual([0.3, -0.2]);
  });

  it('the GLSL does the same sums', () => {
    const fs = compileGraph({ nodes: depthGraph('textureInput', 'normal') }).fragmentShader;
    expect(fs).toMatch(/smoothstep\([^;]* - max\([^;]*, 0\.0001\), [^;]*, d\w*_near\);/);
    expect(fs).toMatch(/\/ \(4\.0 \* \w+_e\.x \* \(u_resolution\.x \/ u_resolution\.y\)\)/);
    expect(fs).toMatch(/normalize\(vec3\(-\w+_dx \* [^,]+, -\w+_dy \* [^,]+, 1\.0\)\)/);
    const par = compileGraph({ nodes: depthGraph('textureInput', 'parallaxUv') }).fragmentShader;
    expect(par).toMatch(/_par = g_uv \+ vec2\(1\.0, 0\.0\) \* [^;]+ \* \(\w+_near - [^;]+\);/);
  });
});

// ── When it runs ─────────────────────────────────────────────────────────────

const run = (o: Partial<RunCheck> = {}): boolean => shouldRun({
  update: 'live', every: 4, framesSince: 1, busy: false, usable: true, hasSource: true, stillKey: null, lastKey: null, runKey: null, playing: true, ranSinceProgram: false, ...o,
});

describe('when a Depth node runs its model', () => {
  it('never for a video (its depth is baked first)', () => {
    expect(run({ video: true })).toBe(false);
    expect(run({ video: false })).toBe(true);
  });

  it('never before the model is downloaded, without a picture, while busy, or when baked', () => {
    expect(run()).toBe(true);
    expect(run({ usable: false })).toBe(false);
    expect(run({ hasSource: false })).toBe(false);
    expect(run({ busy: true })).toBe(false);
    expect(run({ update: 'baked' })).toBe(false);
  });
  it('a still runs once per picture, model and size', () => {
    expect(run({ stillKey: 'a:1', runKey: 'a:1|m|384', lastKey: null })).toBe(true);
    expect(run({ stillKey: 'a:1', runKey: 'a:1|m|384', lastKey: 'a:1|m|384' })).toBe(false);
    expect(run({ stillKey: 'a:2', runKey: 'a:2|m|384', lastKey: 'a:1|m|384' })).toBe(true);
  });
  it('every Nth frame waits N frames; paused, a moving source runs once per program', () => {
    expect(run({ update: 'every', every: 4, framesSince: 3 })).toBe(false);
    expect(run({ update: 'every', every: 4, framesSince: 4 })).toBe(true);
    expect(run({ playing: false, ranSinceProgram: false })).toBe(true);
    expect(run({ playing: false, ranSinceProgram: true })).toBe(false);
  });
  it('grabs at the model’s side, in the source’s shape', () => {
    expect(grabSize(1920, 1080, 384)).toEqual({ w: 384, h: 216 });
    expect(grabSize(1080, 1920, 518)).toEqual({ w: 291, h: 518 });
    expect(grabSize(4000, 10, 256).h).toBe(16);
  });
  it('smooths over time only between frames of the same size', () => {
    const prev = new Float32Array([0, 1]);
    expect([...blendDepth(prev, new Float32Array([1, 0]), 0.5)]).toEqual([0.5, 0.5]);
    const next = new Float32Array([1, 1, 1]);
    expect(blendDepth(prev, next, 0.5)).toBe(next);
    expect(blendDepth(null, next, 0.5)).toBe(next);
  });
  it('uploads rows bottom-up (as a texture’s v runs), grey with alpha 1', () => {
    const out = depthRowsUp([0.25, 0.75], 1, 2, new Float32Array(8), v => v, 1);
    expect([...out]).toEqual([0.75, 0.75, 0.75, 1, 0.25, 0.25, 0.25, 1]);
  });
});

// ── Bake bookkeeping ─────────────────────────────────────────────────────────

describe('bake depth bookkeeping', () => {
  it('plans every frame at 30 fps, in the middle of each, up to a minute', () => {
    const p = planDepthBake(2);
    expect(p).toMatchObject({ fps: 30, frames: 60, duration: 2, clipped: false });
    expect(p.times[0]).toBeCloseTo(1 / 60, 9);
    expect(p.times[59]).toBeCloseTo(59.5 / 30, 9);
    const long = planDepthBake(600);
    expect(long.frames).toBe(DEPTH_BAKE_MAX_SECONDS * 30);
    expect(long.clipped).toBe(true);
    expect(planDepthBake(NaN).frames).toBe(1);
    expect(planDepthBake(1, 24).frames).toBe(24);
  });
  it('writes grey frames cropped to even sides (the video encoder needs them)', () => {
    const g = depthToGreyRgba(new Float32Array([0, 0.5, 1, 1, 1, 1, 0, 0, 0]), 3, 3);
    expect(g.length).toBe(2 * 2 * 4);
    expect([...g.slice(0, 8)]).toEqual([0, 0, 0, 255, 128, 128, 128, 255]);
    expect([...g.slice(8, 12)]).toEqual([255, 255, 255, 255]);
  });
  it('names the file after its source and time', () => {
    expect(depthBakeFileName('Beach / clip', 'webm', new Date(2026, 9, 9, 15, 57, 1))).toBe('Depth of Beach clip 2026-10-09 15.57.01.webm');
  });
  it('the node keeps where its bake is and switches to Baked; the video counts as used in the library', () => {
    const info: DepthBakeInfo = { kind: 'video', videoId: 'vid-abc', model: 'depth-anything-v2-small', side: 384, width: 384, height: 216, fps: 30, frames: 60, duration: 2, smoothing: 0.5, bytes: 123, bakedAt: 1, source: 'Video Input' };
    const params = bakedParams(info);
    expect(params.update).toBe('baked');
    const node = n('depth', 'd', 0, 0, params);
    expect(depthBakeOf(node)).toEqual(info);
    expect(depthBakeOf(n('depth', 'd', 0, 0, { depthBake: { ...info, videoId: '' } }))).toBeNull();
    expect(countVideoRefs(JSON.stringify({ nodes: [node] }), 'vid-abc')).toBe(1);
  });
  it('a baked depth video follows its source: plays with it, jumps past a quarter second (paused: half a frame)', () => {
    expect(followSource({ time: 1, paused: false, rate: 1 }, { time: 1.1, paused: true }, 30, 10)).toEqual({ seek: null, play: true, rate: 1 });
    expect(followSource({ time: 1, paused: false, rate: 1 }, { time: 1.5, paused: false }, 30, 10).seek).toBe(1);
    expect(followSource({ time: 1, paused: true, rate: 1 }, { time: 1.02, paused: true }, 30, 10)).toEqual({ seek: 1, play: false, rate: 1 });
    expect(followSource({ time: 12, paused: false, rate: 2 }, { time: 0, paused: false }, 30, 10)).toMatchObject({ rate: 2, seek: 10 - 0.5 / 30 });
  });
});
