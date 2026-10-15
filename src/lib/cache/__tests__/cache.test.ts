/** Cache and Cache Read (docs/cache-node.md): the atlas layout, the ring, reading by delay, and the nodes' shaders. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { cacheAdvance, cacheFrameSize, cacheSources, CACHE_MAX_SIDE } from '../engine';
import { cacheGrid, cacheTiles } from '../../../nodes/definitions/cache';
import { compileGraph } from '../../../compiler/graphCompiler';
import type { CompilationResult } from '../../../compiler/types';
import type { GraphNode } from '../../../types/nodeGraph';
import { getNodeDefinition } from '../../../nodes/definitions';

describe('Cache: layout and ring', () => {
  it('lays the frames out in an about-square grid', () => {
    expect(cacheGrid(8)).toEqual({ cols: 3, rows: 3 });
    expect(cacheGrid(32)).toEqual({ cols: 6, rows: 6 });
    expect(cacheGrid(128)).toEqual({ cols: 12, rows: 11 });
  });

  it('a frame keeps the source\'s shape and the atlas fits 4096', () => {
    expect(cacheFrameSize(1920, 1080, 256, 32)).toEqual({ w: 256, h: 144 });
    const big = cacheFrameSize(1920, 1080, 512, 128);
    const { cols, rows } = cacheGrid(128);
    expect(big.w * cols).toBeLessThanOrEqual(CACHE_MAX_SIDE);
    expect(big.h * rows).toBeLessThanOrEqual(CACHE_MAX_SIDE);
    const tall = cacheFrameSize(1080, 1920, 512, 128);
    expect(tall.h * rows).toBeLessThanOrEqual(CACHE_MAX_SIDE);
    expect(tall.h).toBeGreaterThan(tall.w);
  });

  it('records round the ring, newest at head, filling up to Frames', () => {
    let st = { head: 7, filled: 0 };
    for (let i = 0; i < 10; i++) st = cacheAdvance(st.head, st.filled, 8);
    expect(st).toEqual({ head: 1, filled: 8 });
  });

  it('reads by delay: newest at 0, wrapping, never past what is filled, blending when Smooth', () => {
    expect(cacheTiles(0, 5, 8, 8, false)).toEqual({ a: 5, b: 5, t: 0 });
    expect(cacheTiles(7, 5, 8, 8, false)!.a).toBe(6);
    expect(cacheTiles(20, 5, 3, 8, false)!.a).toBe(3);
    expect(cacheTiles(1.25, 5, 8, 8, true)).toEqual({ a: 4, b: 3, t: 0.25 });
    expect(cacheTiles(1.6, 5, 8, 8, false)!.a).toBe(3);
    expect(cacheTiles(0, 5, 0, 8, true)).toBeNull();
  });
});

describe('Cache: the nodes', () => {
  const node = (id: string, type: string, params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}): GraphNode => {
    const def = getNodeDefinition(type)!;
    const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: { nodeId: wires[k][0], outputKey: wires[k][1] } } : {}) }]));
    return { id, type, position: { x: 0, y: 0 }, outputs: { ...def.outputs }, params: { ...def.defaultParams, ...params }, inputs } as GraphNode;
  };
  const out = (from: string, key: string) => ({ id: 'out', type: 'output', position: { x: 0, y: 0 }, outputs: {}, params: {}, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: key } } } }) as unknown as GraphNode;

  it('Cache: an atlas sampler, its head and filled floats, its grid, and the source it records', () => {
    const img = node('img', 'textureInput');
    const c = node('ca', 'cache', { frames: '16' }, { texture: ['img', 'texture'] });
    const r = compileGraph({ nodes: [img, c, out('ca', 'color')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    const S = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'ca')!;
    expect(S).toMatch(/^u_cache_/);
    expect(r.liveUniforms[`${S}_head`]).toBe('ca::cacheHead');
    expect(r.liveUniforms[`${S}_filled`]).toBe('ca::cacheFilled');
    expect(r.fragmentShader).toContain(`#define ${S}_grid vec2(4.0, 4.0)`);
    expect(r.fragmentShader).toContain(`#define ${S}_frames 16.0`);
    const img0 = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'img')!;
    expect(cacheSources([r.fragmentShader]).get(S)).toBe(img0);
    expect(r.fragmentShader).toContain(`cache_read(${S},`);
  });

  it('Time Machine: a Delay map adds map × reach × frames to the delay', () => {
    const img = node('img', 'textureInput');
    const uv = node('uv', 'uv');
    const len = node('len', 'length', {}, { input: ['uv', 'uv'] });
    const c = node('ca', 'cache', {}, { texture: ['img', 'texture'], delayMap: ['len', 'output'] });
    const r = compileGraph({ nodes: [img, uv, len, c, out('ca', 'color')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/_d = .* \+ clamp\(.*, 0\.0, 1\.0\) \* .* \* \(u_cache_\w+_frames - 1\.0\);/);
  });

  it('Cache Read reads the same frames at its own delay; without a Cache it is black', () => {
    const img = node('img', 'textureInput');
    const c = node('ca', 'cache', {}, { texture: ['img', 'texture'] });
    const rd = node('rd', 'cacheRead', { delay: 6 }, { cache: ['ca', 'cache'] });
    const r = compileGraph({ nodes: [img, c, rd, out('rd', 'color')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    const S = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'ca')!;
    // The Cache's own read and the Cache Read's, from the same atlas.
    expect((r.fragmentShader.match(new RegExp(`cache_read\\(${S},`, 'g')) ?? []).length).toBe(2);
    const lone = compileGraph({ nodes: [img, node('rd', 'cacheRead', {}, { cache: ['img', 'texture'] }), out('rd', 'color')] }) as CompilationResult;
    expect(lone.errors ?? []).toEqual([]);
    expect(lone.fragmentShader).not.toContain('cache_read(');
  });
});
