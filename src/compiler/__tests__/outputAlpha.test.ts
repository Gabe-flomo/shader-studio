import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../graphCompiler';
import { n } from '../../store/graphBuilder';
import { frameIsOpaque, graphOwnAlpha } from '../../lib/graphAlpha';
import { forceOpaque, proresNotes } from '../../utils/prores';
import { lumaKey } from '../../play/overlay';

const colour = () => n('colorPicker', 'c', 0, 0, { color: [1, 0.5, 0.2] });
const fragOf = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes });
  expect(r.success, r.errors?.join()).toBe(true);
  return r;
};

describe('Output alpha and opacity', () => {
  it('a saved Output (no Opacity, no Alpha) compiles exactly as before', () => {
    const saved: GraphNode = {
      id: 'out', type: 'output', position: { x: 0, y: 0 }, outputs: {}, params: {},
      inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'c', outputKey: 'rgb' } } },
    };
    const r = fragOf([colour(), saved]);
    expect(r.fragmentShader).toMatch(/gl_FragColor = vec4\([^;]+, 1\.0\);/);
    expect(Object.keys(r.paramUniforms).some(u => u.endsWith('_opacity'))).toBe(false);
  });

  it('a new Output at Opacity 1 is the same shader; below 1 its alpha is a live uniform', () => {
    const at1 = fragOf([colour(), n('output', 'out', 300, 0, {}, { color: ['c', 'rgb'] })]);
    expect(at1.fragmentShader).toMatch(/gl_FragColor = vec4\([^;]+, 1\.0\);/);
    const half = fragOf([colour(), n('output', 'out', 300, 0, { opacity: 0.5 }, { color: ['c', 'rgb'] })]);
    const u = Object.keys(half.paramUniforms).find(k => k.endsWith('_opacity'))!;
    expect(u).toBeTruthy();
    expect(half.paramUniforms[u]).toBe(0.5);
    expect(half.fragmentShader).toContain(`clamp(${u}, 0.0, 1.0));`);
  });

  it('the Alpha input sets the alpha, times Opacity', () => {
    const nodes = [colour(), n('constant', 'a', 0, 200, { value: 0.25 }),
      n('output', 'out', 300, 0, { opacity: 0.5 }, { color: ['c', 'rgb'], alpha: ['a', 'value'] })];
    const r = fragOf(nodes);
    expect(r.fragmentShader).toMatch(/gl_FragColor = vec4\([^;]+, clamp\([^;]+, 0\.0, 1\.0\) \* clamp\(u_p_\w+_opacity, 0\.0, 1\.0\)\);/);
  });

  it('Output (RGBA) takes Opacity too', () => {
    const v4 = n('vec4Output', 'out', 300, 0, { opacity: 0.3 });
    const r = fragOf([v4]);
    expect(r.fragmentShader).toMatch(/gl_FragColor\.a \*= clamp\(u_p_\w+_opacity, 0\.0, 1\.0\);/);
  });
});

describe('a transparent export keeps the graph\'s own alpha', () => {
  it('knows which graphs have an alpha of their own', () => {
    const out = (params: Record<string, unknown>, wires = {}) => [colour(), n('output', 'out', 300, 0, params, { color: ['c', 'rgb'], ...wires })];
    expect(graphOwnAlpha(out({}))).toBe(false);
    expect(graphOwnAlpha(out({ opacity: 1 }))).toBe(false);
    expect(graphOwnAlpha(out({ opacity: 0.4 }))).toBe(true);
    expect(graphOwnAlpha([...out({}), n('constant', 'a', 0, 0)].map(x => x.id === 'out' ? { ...x, inputs: { ...x.inputs, alpha: { ...x.inputs.alpha, connection: { nodeId: 'a', outputKey: 'value' } } } } : x))).toBe(true);
    expect(graphOwnAlpha([n('vec4Output', 'out', 0, 0)])).toBe(true);
  });

  it('a frame with alpha below 1 reaches the PNG / ProRes encoder with it (Its own alpha)', () => {
    // A read-back frame of a graph at Opacity 0.4: straight RGBA, alpha 102.
    const frame = new Uint8Array([255, 128, 51, 102, 0, 0, 0, 102]);
    const notes = proresNotes({ profile: '4444', transparent: true, ownAlpha: true, picture: 'own', wasm: true, hasSound: false, estimateBytes: 1 });
    expect(notes.keepsAlpha).toBe(true);
    expect(notes.warnings).toEqual([]);
    // As ExportModal's settleAlpha: only a file that doesn't keep alpha is forced opaque.
    const settled = frame.slice();
    if (!notes.keepsAlpha) forceOpaque(settled);
    expect([...settled]).toEqual([...frame]);
    expect(frameIsOpaque(settled)).toBe(false);
    // Black turns clear is a different picture: it keys alpha from brightness instead.
    const keyed = frame.slice(); lumaKey(keyed);
    expect(keyed[7]).toBe(0);
  });

  it('warns when Its own alpha is picked on a graph with no alpha, and spots a solid frame', () => {
    const n2 = proresNotes({ profile: '4444', transparent: true, ownAlpha: false, picture: 'own', wasm: true, hasSound: false, estimateBytes: 1 });
    expect(n2.warnings.map(w => w.title)).toEqual(['The graph has no alpha']);
    expect(frameIsOpaque(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(true);
  });
});
