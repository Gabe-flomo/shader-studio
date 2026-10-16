/** Segment (docs/segment-node.md): settings read from the node, mask helpers, and the node's shader. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { maskCentre, segmentGrabSize, segmentSources, smoothMask } from '../engine';
import { segmentClassesOf, segmentModeOf, segmentSideOf } from '../../../nodes/definitions/segment';
import { compileGraph } from '../../../compiler/graphCompiler';
import type { CompilationResult } from '../../../compiler/types';
import type { GraphNode } from '../../../types/nodeGraph';
import { getNodeDefinition } from '../../../nodes/definitions';

const node = (id: string, type: string, params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: { nodeId: wires[k][0], outputKey: wires[k][1] } } : {}) }]));
  return { id, type, position: { x: 0, y: 0 }, outputs: { ...def.outputs }, params: { ...def.defaultParams, ...params }, inputs } as GraphNode;
};
const out = (from: string, key: string) => ({ id: 'out', type: 'output', position: { x: 0, y: 0 }, outputs: {}, params: {}, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: key } } } }) as unknown as GraphNode;

describe('Segment: settings', () => {
  it('mode, kinds (only known ones) and the size each mode reads at', () => {
    expect(segmentModeOf(node('s', 'segment'))).toBe('people');
    expect(segmentClassesOf(node('s', 'segment', { classes: 'Cat, dog, unicorn,tv' }))).toEqual(['cat', 'dog', 'tv']);
    expect(segmentSideOf(node('s', 'segment', { mode: 'click' }))).toBe(512);
    expect(segmentSideOf(node('s', 'segment'))).toBe(256);
    expect(segmentSideOf(node('s', 'segment', { resolution: '384' }))).toBe(384);
    expect(segmentGrabSize(1920, 1080, 256)).toEqual({ w: 256, h: 144 });
  });
});

describe('Segment: masks', () => {
  it("the mask's middle and how much it covers; nothing found is null", () => {
    const w = 10, h = 10, m = new Float32Array(100);
    for (let y = 6; y < 10; y++) for (let x = 0; x < 4; x++) m[y * w + x] = 1;
    const c = maskCentre(m, w, h)!;
    expect(c.x).toBeCloseTo(0.2, 5);
    expect(c.y).toBeCloseTo(0.8, 5);
    expect(c.cover).toBeCloseTo(0.16, 5);
    expect(maskCentre(new Float32Array(100), w, h)).toBeNull();
  });
  it('smoothing blends with the last mask of the same size', () => {
    expect([...smoothMask(new Float32Array([1, 0]), new Float32Array([0, 1]), 0.25)]).toEqual([0.25, 0.75]);
    const fresh = new Float32Array([0.3]);
    expect(smoothMask(new Float32Array([1, 1]), fresh, 0.5)).toBe(fresh);
  });
});

describe('Segment: the node', () => {
  it('reads its mask texture, names its source, grows and inverts in the shader, cuts the source out', () => {
    const img = node('img', 'textureInput');
    const r = compileGraph({ nodes: [img, node('sg', 'segment', { invert: true }, { texture: ['img', 'texture'] }), out('sg', 'cutout')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    const S = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'sg')!;
    const I = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'img')!;
    expect(segmentSources([r.fragmentShader]).get(S)).toBe(I);
    expect(r.fragmentShader).toMatch(/for \(int i = 0; i < 8; i\+\+\)/);
    expect(r.fragmentShader).toMatch(/\w+_m = 1\.0 - \w+_m;/);
    expect(r.fragmentShader).toContain(`texture2D(${I},`);
    expect(r.paramBindings['sg::threshold']).toBeTruthy();
  });
});

describe('Segment: Edge refine and Bake', () => {
  const seg = (params: Record<string, unknown>, inputs: Record<string, string> = {}) =>
    getNodeDefinition('segment')!.generateGLSL({ id: 'sg', type: 'segment', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { ...getNodeDefinition('segment')!.defaultParams, ...params } } as GraphNode, inputs).code;
  it('Edge refine weighs the mask by how alike the picture is round each pixel, only with a Texture wired', () => {
    const on = seg({ refine: 'on' }, { texture: 'u_vid_v' });
    expect(on).toContain('textureSize(u_tex_sg, 0)');
    expect(on).toMatch(/exp\(-dot\(dc, dc\)/);
    expect(seg({ refine: 'off' }, { texture: 'u_vid_v' })).not.toContain('dot(dc, dc)');
    expect(seg({ refine: 'on' })).not.toContain('dot(dc, dc)');
  });
  it('a baked video plays through the video path (u_vid_), a still or live mask through the node texture', async () => {
    const { segmentSampler } = await import('../../../nodes/definitions/segment');
    const node = (params: Record<string, unknown>) => ({ id: 'sg', type: 'segment', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params } as GraphNode);
    const info = { kind: 'video', videoId: 'v1', mode: 'people', side: 256, width: 256, height: 144, fps: 30, frames: 30, duration: 1, smoothing: 0, bytes: 1, bakedAt: 0, source: 'x' };
    expect(segmentSampler('sg', node({ update: 'baked', segmentBake: info }))).toBe('u_vid_sg');
    expect(segmentSampler('sg', node({ update: 'live', segmentBake: info }))).toBe('u_tex_sg');
    expect(segmentSampler('sg', node({ update: 'baked', segmentBake: { ...info, kind: 'image', libraryId: 'i1' } }))).toBe('u_tex_sg');
    expect(segmentSampler('sg', node({ update: 'baked' }))).toBe('u_tex_sg');
    const r = compileGraph({ nodes: [
      { id: 'vid', type: 'videoInput', position: { x: 0, y: 0 }, inputs: {}, outputs: { texture: { type: 'texture', label: 'Texture' }, color: { type: 'vec3', label: 'Color' } }, params: {} } as GraphNode,
      { ...node({ ...getNodeDefinition('segment')!.defaultParams, update: 'baked', segmentBake: info }), inputs: { texture: { type: 'texture', label: 'Texture', connection: { nodeId: 'vid', outputKey: 'texture' } } }, outputs: { mask: { type: 'float', label: 'Mask' } } } as GraphNode,
      { id: 'o', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sg', outputKey: 'mask' } } }, outputs: {}, params: {} } as GraphNode,
    ] });
    expect(Object.entries(r.videoUniforms).some(([k, v]) => v === 'sg' && k.startsWith('u_vid_'))).toBe(true);
    expect(Object.values(r.textureUniforms)).not.toContain('sg');
  });
  it('bakes from an Image, a Video or a Baked node wired straight in; not the picture or a webcam', async () => {
    const { segmentBakeSource, segmentBakeFileName } = await import('../bake');
    const n = (id: string, type: string, params: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params } as GraphNode);
    const sg = (from?: string) => ({ ...n('sg', 'segment'), inputs: from ? { texture: { type: 'texture', label: 'Texture', connection: { nodeId: from, outputKey: 'texture' } } } : {} } as GraphNode);
    expect(segmentBakeSource(sg(), []).kind).toBeNull();
    expect(segmentBakeSource(sg('img'), [n('img', 'textureInput')]).kind).toBe('image');
    expect(segmentBakeSource(sg('v'), [n('v', 'videoInput')]).kind).toBe('video');
    expect(segmentBakeSource(sg('b'), [n('b', 'baked')]).kind).toBe('video');
    expect(segmentBakeSource(sg('v'), [n('v', 'videoInput', { source: 'webcam' })]).kind).toBeNull();
    expect(segmentBakeSource(sg('p'), [n('p', 'pass')]).kind).toBeNull();
    expect(segmentBakeFileName('Dancer', 'webm', new Date(2026, 9, 15, 9, 5, 7))).toBe('Mask of Dancer 2026-10-15 09.05.07.webm');
  });
});
