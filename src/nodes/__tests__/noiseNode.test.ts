/**
 * The Noise node (nodes/definitions/noiseNode.ts, docs/noise-node.md) and Voronoi's cell features
 * (nodes/definitions/noise.ts): the helpers each Kind and Dimensions pulls in, live sliders, every combination
 * compiling with every output wired, and Voronoi writing exactly the shader it wrote before when only its old
 * outputs are read.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { createHash } from 'crypto';
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../definitions';
import { NOISE_DIMS, NOISE_KINDS, baseNoiseFn, noiseFn, noiseHelpers } from '../definitions/noiseNode';
import { n, nv } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';

const DIM: Record<string, 2 | 3 | 4> = { '2d': 2, '3d': 3, '4d': 4 };
const PREFIX = '#version 300 es\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n';
const parses = (fs: string) => { try { parser.parse(PREFIX + fs, { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

/** A Noise with every output wired into the picture. */
function noiseGraph(params: Record<string, unknown>): GraphNode[] {
  return [
    n('noise', 'nz', 0, 0, params),
    n('splitVec2', 'sl', 300, 0, {}, { v: ['nz', 'slope'] }),
    n('makeVec3', 'mk', 600, 0, {}, { r: ['nz', 'value'], g: ['sl', 'x'], b: ['nz', 'signed'] }),
    nv('vec3', 'add', 'sum', 900, 0, {}, { a: ['mk', 'rgb'], b: ['nz', 'colour'] }),
    n('output', 'out', 1200, 0, {}, { color: ['sum', 'result'] }),
  ];
}

describe('Noise node', () => {
  it('is registered in the Noise category with its outputs', () => {
    const def = getNodeDefinition('noise')!;
    expect(def.category).toBe('Noise');
    expect(Object.keys(def.outputs)).toEqual(['value', 'signed', 'colour', 'slope']);
    expect(def.outputs.colour.type).toBe('vec3');
    expect(def.outputs.slope.type).toBe('vec2');
  });

  it('pulls in the helpers of its Kind and Dimensions only', () => {
    for (const kind of NOISE_KINDS) for (const dims of NOISE_DIMS) {
      const d = DIM[dims];
      const text = noiseHelpers(kind, dims).join('\n');
      expect(text).toContain(`float ${baseNoiseFn(kind, d)}(vec${d} `);
      expect(text).toContain(`float ${noiseFn(kind, d, false)}(vec${d} p, float detail, float roughness, float lacunarity)`);
      expect(text).toContain(`float ${noiseFn(kind, d, true)}(vec${d} p, float detail, float roughness, float lacunarity, float distortion)`);
      for (const other of NOISE_KINDS) if (other !== kind) expect(text).not.toContain(`float ${baseNoiseFn(other, d)}(`);
      // A constant loop bound with an early break, as GLSL ES needs.
      expect(text).toMatch(/for \(int i = 0; i <= 8; i\+\+\) \{\n\s+if \(float\(i\) > whole\) break;/);
      // No bit operators: the helpers stay valid GLSL ES 1.00 too.
      expect(text).not.toMatch(/[^&]&[^&]|>>|<</);
      const def = getNodeDefinition('noise')!;
      expect(def.glslFunctionsFor!(n('noise', 'nz', 0, 0, { kind, dims }))).toEqual(noiseHelpers(kind, dims));
    }
  });

  it('reads its sliders as uniforms, and leaves Distortion out at 0', () => {
    const r = compileGraph({ nodes: noiseGraph({ kind: 'simplex', dims: '3d' }) });
    expect(r.errors ?? []).toEqual([]);
    const fs = r.fragmentShader;
    for (const k of ['scale', 'detail', 'roughness', 'lacunarity', 'speed', 'offsetX', 'offsetY']) {
      expect(Object.values(r.paramBindings ?? {}).some(b => JSON.stringify(b).includes(`"${k}"`)) || new RegExp(`u_p_\\w*_${k}\\b`).test(fs), k).toBe(true);
    }
    expect(fs).toMatch(/nzNoiseSimplex3\(\w+_P, u_p_\w+_detail, u_p_\w+_roughness, u_p_\w+_lacunarity\)/);
    expect(fs).not.toContain('nzNoiseSimplex3D(');
    expect(fs).not.toMatch(/u_p_\w+_distortion/);
    const on = compileGraph({ nodes: noiseGraph({ kind: 'simplex', dims: '3d', distortion: 0.8 }) });
    expect(on.fragmentShader).toMatch(/nzNoiseSimplex3D\(\w+_P, u_p_\w+_detail, u_p_\w+_roughness, u_p_\w+_lacunarity, u_p_\w+_distortion\)/);
  });

  it('3D and 4D put time on the extra axes; 2D slides', () => {
    const code = (dims: string) => getNodeDefinition('noise')!.generateGLSL(n('noise', 'nz', 0, 0, { dims }), { uv: 'g_uv', time: 'u_time' }).code;
    expect(code('2d')).toMatch(/vec2 nz_P = \(g_uv \+ vec2\(0\.0, 0\.0\)\) \* \(4\.0\) \+ \(u_time\) \* \(0\.0\) \* vec2/);
    expect(code('3d')).toContain('vec3 nz_P = vec3((g_uv + vec2(0.0, 0.0)) * (4.0), (u_time) * (0.0));');
    expect(code('4d')).toContain('cos((u_time) * (0.0)), sin((u_time) * (0.0))');
  });

  it('a wired slider replaces its uniform', () => {
    const g = noiseGraph({ kind: 'perlin', dims: '2d' });
    g.unshift(n('constant', 'k', 0, 0, { value: 3 }));
    g[1] = n('noise', 'nz', 0, 0, { kind: 'perlin', dims: '2d' }, { detail: ['k', 'value'] });
    const r = compileGraph({ nodes: g });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/nzNoisePerlin2\(\w+_P, cst_\w*value, u_p_\w+_roughness/);
  });

  it('compiles every Kind × Dimensions (with and without Distortion), every output wired, as GLSL that parses', () => {
    const bad: string[] = [];
    for (const kind of NOISE_KINDS) for (const dims of NOISE_DIMS) for (const distortion of [0, 0.6]) {
      const r = compileGraph({ nodes: noiseGraph({ kind, dims, distortion, speed: 0.3, detail: 3.5 }) });
      const tag = `${kind} ${dims} distortion ${distortion}`;
      if (!r.success || r.errors?.length) { bad.push(`${tag}: ${r.errors?.join('; ')}`); continue; }
      const fs = r.fragmentShader;
      if (!fs.includes(`${noiseFn(kind, DIM[dims], distortion !== 0)}(`)) bad.push(`${tag}: no call`);
      const err = parses(fs);
      if (err) bad.push(`${tag}: ${err}`);
    }
    expect(bad).toEqual([]);
  });

  it('two Noise nodes of the same Kind share one copy of the helpers', () => {
    const g = [
      n('noise', 'a', 0, 0, { kind: 'perlin', dims: '3d' }),
      n('noise', 'b', 0, 0, { kind: 'perlin', dims: '3d', scale: 9 }),
      n('add', 'sum', 0, 0, {}, { a: ['a', 'value'], b: ['b', 'value'] }),
      n('floatToVec3', 'f', 0, 0, {}, { input: ['sum', 'result'] }),
      n('output', 'out', 0, 0, {}, { color: ['f', 'rgb'] }),
    ];
    const r = compileGraph({ nodes: g });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader.match(/float nzPerlin3\(vec3 P\)/g)).toHaveLength(1);
  });
});

/** Shader hashes of Voronoi graphs compiled before the cell features existed (sha256 of the fragment shader). */
const VORONOI_BEFORE: Record<string, string> = {
  plain: '7efd17eb31d84e5b059874132ec40e5768601ba7be7c3df07c8249f1cb86da04',
  timed: 'c11b62057b26c482de663c894a9102b60890fe70c6a8bbd5f6b853af4aa6c49f',
  bothOut: '448c83419692c36f760a6e5f89683416e35acfec5d080109cf33b4fb12307d03',
};

function voronoiGraphs(): Record<string, GraphNode[]> {
  return {
    plain: [n('uv', 'uv', 0, 0), n('voronoi', 'v', 0, 0, {}, { uv: ['uv', 'uv'] }), n('floatToVec3', 'f', 0, 0, {}, { input: ['v', 'dist'] }), n('output', 'out', 0, 0, {}, { color: ['f', 'rgb'] })],
    timed: [n('uv', 'uv', 0, 0), n('time', 'clk', 0, 0), n('voronoi', 'v', 0, 0, { time_scale: 0.5, scale: 7, jitter: 0.6 }, { uv: ['uv', 'uv'], time: ['clk', 'time'] }), n('floatToVec3', 'f', 0, 0, {}, { input: ['v', 'dist'] }), n('output', 'out', 0, 0, {}, { color: ['f', 'rgb'] })],
    bothOut: [n('voronoi', 'v', 0, 0, {}), n('length', 'l', 0, 0, {}, { input: ['v', 'uv'] }), n('add', 'a', 0, 0, {}, { a: ['v', 'dist'], b: ['l', 'output'] }), n('floatToVec3', 'f', 0, 0, {}, { input: ['a', 'result'] }), n('output', 'out', 0, 0, {}, { color: ['f', 'rgb'] })],
  };
}

describe('Voronoi cell features', () => {
  it('a graph that reads only Distance and UV compiles to exactly the shader it did before', () => {
    for (const [k, g] of Object.entries(voronoiGraphs())) {
      // A node saved before the features (only its old outputs on the card) and a fresh one compile the same.
      const old = g.map(nd => (nd.type === 'voronoi' ? { ...nd, outputs: { dist: nd.outputs.dist, uv: nd.outputs.uv }, params: { scale: nd.params.scale, jitter: nd.params.jitter, time_scale: nd.params.time_scale } } : nd));
      for (const graph of [g, old]) {
        const r = compileGraph({ nodes: graph });
        expect(r.success, k).toBe(true);
        expect(createHash('sha256').update(r.fragmentShader).digest('hex'), k).toBe(VORONOI_BEFORE[k]);
      }
    }
  });

  it('writes the line it always wrote for Distance', () => {
    const def = getNodeDefinition('voronoi')!;
    expect(def.generateGLSL(n('voronoi', 'v', 0, 0, { time_scale: 0.5 }), { uv: 'g_uv', time: 'u_time' }).code)
      .toBe('    float v_dist = voronoi((g_uv + u_time * 0.5 * vec2(0.13, 0.27)) * 5.0, 1.0);\n');
    expect(def.generateGLSL(n('voronoi', 'v', 0, 0, { scale: 'u_p_v_scale', jitter: 'u_p_v_jitter', time_scale: 'u_p_v_time_scale' }), { uv: 'g_uv', time: 'u_time' }).code)
      .toBe('    float v_dist = voronoi((g_uv + u_time * u_p_v_time_scale * vec2(0.13, 0.27)) * u_p_v_scale, u_p_v_jitter);\n');
  });

  it('declares the new outputs, and an old card gains them on load', () => {
    const def = getNodeDefinition('voronoi')!;
    expect(Object.fromEntries(Object.entries(def.outputs).map(([k, v]) => [k, v.type]))).toEqual({
      dist: 'float', uv: 'vec2', f2: 'float', edge: 'float', edgeDist: 'float', cellId: 'vec2', cellColour: 'vec3', cellPos: 'vec2',
    });
    const saved = { ...n('voronoi', 'v', 0, 0), outputs: { dist: { type: 'float' as const, label: 'Distance' }, uv: { type: 'vec2' as const, label: 'UV (pass-through)' } } };
    expect(Object.keys(def.syncSockets!(saved).outputs)).toEqual(['dist', 'uv', 'f2', 'edge', 'edgeDist', 'cellId', 'cellColour', 'cellPos']);
  });

  it('every feature output compiles, under each Metric, and only pulls in what it reads', () => {
    for (const metric of ['euclidean', 'manhattan', 'chebyshev']) {
      const g = [
        n('time', 'clk', 0, 0),
        n('voronoi', 'v', 0, 0, { metric, time_scale: 0.3 }, { time: ['clk', 'time'] }),
        n('makeVec3', 'mk', 0, 0, {}, { r: ['v', 'f2'], g: ['v', 'edge'], b: ['v', 'edgeDist'] }),
        n('splitVec2', 'id', 0, 0, {}, { v: ['v', 'cellId'] }),
        n('splitVec2', 'pos', 0, 0, {}, { v: ['v', 'cellPos'] }),
        n('makeVec3', 'mk2', 0, 0, {}, { r: ['id', 'x'], g: ['pos', 'y'], b: ['v', 'dist'] }),
        nv('vec3', 'add', 'a1', 0, 0, {}, { a: ['mk', 'rgb'], b: ['v', 'cellColour'] }),
        nv('vec3', 'add', 'a2', 0, 0, {}, { a: ['a1', 'result'], b: ['mk2', 'rgb'] }),
        n('output', 'out', 0, 0, {}, { color: ['a2', 'result'] }),
      ];
      const r = compileGraph({ nodes: g });
      expect(r.errors ?? [], metric).toEqual([]);
      const fs = r.fragmentShader;
      expect(parses(fs), metric).toBeNull();
      for (const fn of ['voroF2', 'voroEdge', 'voroBorder', 'voroCellId', 'voroCellColour', 'voroNearestPoint']) expect(fs, `${metric} ${fn}`).toContain(`${fn}(`);
      if (metric === 'euclidean') expect(fs).toMatch(/float \w+_dist = voronoi\(/);
      else expect(fs).toMatch(new RegExp(`dist = voroCells\\(.*, ${metric === 'manhattan' ? 1 : 2}\\)\\.x;`));
    }
    // Reading only Cell colour leaves the border search out.
    const one = compileGraph({ nodes: [n('voronoi', 'v', 0, 0), n('output', 'out', 0, 0, {}, { color: ['v', 'cellColour'] })] });
    expect(one.errors ?? []).toEqual([]);
    expect(one.fragmentShader).toContain('voroCellColour(');
    expect(one.fragmentShader).not.toContain('voroBorder');
  });
});
