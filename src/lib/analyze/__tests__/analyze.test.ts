/** Analyze (docs/analyze-node.md): a frame measured into numbers, smoothed, packed, and the node's shader. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { analyzeFrame, packAnalysis, smoothAnalysis, analyzeGrabSize, emptyAnalysis } from '../stats';
import { analyzeSources } from '../engine';
import { compileGraph } from '../../../compiler/graphCompiler';
import type { CompilationResult } from '../../../compiler/types';
import type { GraphNode } from '../../../types/nodeGraph';
import { getNodeDefinition } from '../../../nodes/definitions';

/** w×h RGBA with a white square at [x0,x1)×[y0,y1) on black (rows bottom-up). */
function frame(w: number, h: number, sq?: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const on = sq && x >= sq[0] && x < sq[1] && y >= sq[2] && y < sq[3];
    const o = (y * w + x) * 4;
    out[o] = out[o + 1] = out[o + 2] = on ? 255 : 0; out[o + 3] = 255;
  }
  return out;
}

describe('Analyze: measuring', () => {
  it('average colour and brightness, coverage and its centre, the brightest point, contrast', () => {
    const { a } = analyzeFrame(frame(10, 10, [6, 10, 6, 10]), 10, 10, 0.5, null);
    expect(a.brightness).toBeCloseTo(0.16, 5);
    expect(a.r).toBeCloseTo(0.16, 5);
    expect(a.coverage).toBeCloseTo(0.16, 5);
    expect(a.cx).toBeCloseTo(0.8, 5);
    expect(a.cy).toBeCloseTo(0.8, 5);
    expect(a.peak).toBe(1);
    expect(a.px).toBeGreaterThan(0.6);
    expect(a.contrast).toBeCloseTo(Math.sqrt(0.16 - 0.16 * 0.16), 5);
  });

  it('nothing lit: coverage 0 and the centre in the middle', () => {
    const { a } = analyzeFrame(frame(8, 8), 8, 8, 0.5, null);
    expect(a.coverage).toBe(0);
    expect([a.cx, a.cy]).toEqual([0.5, 0.5]);
    expect(a.motion).toBe(0);
  });

  it('motion is the mean change from the last frame', () => {
    const one = analyzeFrame(frame(10, 10, [0, 5, 0, 10]), 10, 10, 0.5, null);
    const two = analyzeFrame(frame(10, 10, [5, 10, 0, 10]), 10, 10, 0.5, one.luma);
    expect(two.a.motion).toBeCloseTo(1, 5);
    const same = analyzeFrame(frame(10, 10, [5, 10, 0, 10]), 10, 10, 0.5, two.luma);
    expect(same.a.motion).toBe(0);
  });

  it('smoothing blends with the last numbers; packing puts them where the shader reads them', () => {
    const prev = { ...emptyAnalysis(), brightness: 1 };
    expect(smoothAnalysis(prev, { ...emptyAnalysis(), brightness: 0 }, 0.5).brightness).toBeCloseTo(0.5);
    expect(smoothAnalysis(null, { ...emptyAnalysis(), brightness: 0.2 }, 0.9).brightness).toBeCloseTo(0.2);
    const d = packAnalysis({ ...emptyAnalysis(), r: 0.1, brightness: 0.4, coverage: 0.3, peak: 0.9, contrast: 0.2, motion: 0.05 });
    expect([d[0], d[3], d[6], d[7], d[10], d[11]].map(x => +x.toFixed(3))).toEqual([0.1, 0.4, 0.3, 0.9, 0.2, 0.05]);
    expect(analyzeGrabSize(1920, 1080, 64)).toEqual({ w: 64, h: 36 });
  });
});

describe('Analyze: the node', () => {
  const node = (id: string, type: string, params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}): GraphNode => {
    const def = getNodeDefinition(type)!;
    const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: { nodeId: wires[k][0], outputKey: wires[k][1] } } : {}) }]));
    return { id, type, position: { x: 0, y: 0 }, outputs: { ...def.outputs }, params: { ...def.defaultParams, ...params }, inputs } as GraphNode;
  };
  const out = (from: string, key: string) => ({ id: 'out', type: 'output', position: { x: 0, y: 0 }, outputs: {}, params: {}, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: key } } } }) as unknown as GraphNode;

  it('reads its numbers texture and names the texture it measures', () => {
    const img = node('img', 'textureInput');
    const r = compileGraph({ nodes: [img, node('an', 'analyze', {}, { texture: ['img', 'texture'] }), out('an', 'color')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    const S = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'an')!;
    const I = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'img')!;
    expect(analyzeSources([r.fragmentShader]).get(S)).toBe(I);
    expect(r.fragmentShader).toContain(`texelFetch(${S}, ivec2(2, 0), 0)`);
    const lone = compileGraph({ nodes: [node('an', 'analyze'), out('an', 'color')] }) as CompilationResult;
    expect(analyzeSources([lone.fragmentShader]).values().next().value).toBe('picture');
  });
});
