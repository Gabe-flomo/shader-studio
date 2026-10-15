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
