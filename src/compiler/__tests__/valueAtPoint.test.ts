/**
 * Value at point (docs/value-at-point.md): a per-pixel value read once, at a point, through one shared tiny Pass
 * whose program pins g_uv to each point; Text reads a wired Value this way unless Value at is Each pixel.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import type { CompilationResult } from '../types';
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { PROBE_PASS_ID, expandProbes, expandTextProbes, pinUvGlsl } from '../probeExpand';

const node = (id: string, type: string, params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: { nodeId: wires[k][0], outputKey: wires[k][1] } } : {}) }]));
  return { id, type, position: { x: 0, y: 0 }, outputs: { ...def.outputs }, params: { ...def.defaultParams, ...params }, inputs } as GraphNode;
};
const out = (from: string, key: string) => ({ id: 'out', type: 'output', position: { x: 0, y: 0 }, outputs: {}, params: {}, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: key } } } }) as unknown as GraphNode;
const sdf = () => [node('uv', 'uv'), node('circ', 'circleSDF', { radius: 0.3 }, { position: ['uv', 'uv'] })];

describe('Value at point', () => {
  it('every probe shares one Pass; its program pins g_uv per texel and reads the picture\'s size', () => {
    const nodes = [...sdf(), node('p1', 'probe', { pointX: 0.5, pointY: 0 }, { value: ['circ', 'distance'] }), node('p2', 'probe', { pointX: -0.5 }, { value: ['circ', 'distance'] }), node('add', 'add', {}, { a: ['p1', 'value'], b: ['p2', 'value'] }), node('rgb', 'floatToVec3', {}, { input: ['add', 'result'] }), out('rgb', 'rgb')];
    const x = expandProbes(nodes);
    expect(x.filter(n => n.type === 'pass')).toHaveLength(1);
    expect(x.find(n => n.id === PROBE_PASS_ID)!.params.__pinUv).toEqual([[0.5, 0], [-0.5, 0]]);
    expect(x.find(n => n.id === 'p2')!.type).toBe('probeRead');
    const r = compileGraph({ nodes }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    expect(r.passes).toHaveLength(1);
    const fs = r.passes![0].fragmentShader;
    expect(fs).toContain('#define u_resolution u_pictureRes');
    expect(fs).toContain('pin_i == 0 ? vec2(0.50000, 0.00000)');
    expect(r.fragmentShader).toMatch(/texelFetch\(u_pass_\w+, ivec2\(1, 0\), 0\)\.r/);
  });

  it('Text with a wired Value reads it at its position; Each pixel keeps it per pixel', () => {
    const t = node('t', 'text', { posX: 0.2, posY: 0.3, size: 0.2 }, { value: ['circ', 'distance'] });
    const x = expandTextProbes([...sdf(), t]);
    const probe = x.find(n => n.id === 't__value')!;
    expect(probe.params.pointX).toBe(0.2);
    expect(probe.params.pointY).toBeCloseTo(0.2, 9);
    expect(x.find(n => n.id === 't')!.inputs.value.connection).toEqual({ nodeId: 't__value', outputKey: 'value' });
    expect(expandTextProbes([...sdf(), { ...t, params: { ...t.params, valueAt: 'pixel' } }]).some(n => n.id === 't__value')).toBe(false);
    const r = compileGraph({ nodes: [...sdf(), t, out('t', 'color')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    expect(r.passes).toHaveLength(1);
  });

  it('pinUvGlsl picks each texel\'s point', () => {
    expect(pinUvGlsl([[1, 2]])).toContain('g_uv = (pin_i == 0 ? vec2(1.00000, 2.00000) : g_uv);');
  });
});
