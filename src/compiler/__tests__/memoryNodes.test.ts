/**
 * Memory nodes (docs/memory-nodes.md): Lag, Spring, Envelope, Timer, Counter, Sample & Hold and Speed open into
 * one shared full-float Pass, a texel each; the node reads its texel back, and a read inside what feeds them is
 * last frame's.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import type { CompilationResult } from '../types';
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { MEMORY_KINDS, lagStep } from '../../nodes/definitions/memory';
import { MEMORY_PASS_ID, expandMemory, memoryPrevId } from '../memoryExpand';

const node = (id: string, type: string, params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: { nodeId: wires[k][0], outputKey: wires[k][1] } } : {}) }]));
  return { id, type, position: { x: 0, y: 0 }, outputs: { ...def.outputs }, params: { ...def.defaultParams, ...params }, inputs } as GraphNode;
};
const toColor = (from: string, key: string): GraphNode[] => [
  node('rgb', 'floatToVec3', {}, { input: [from, key] }),
  { id: 'out', type: 'output', position: { x: 0, y: 0 }, outputs: {}, params: {}, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'rgb', outputKey: 'rgb' } } } } as unknown as GraphNode,
];
const firstIn = (type: string) => Object.keys(getNodeDefinition(type)!.inputs)[0];
const firstOut = (type: string) => Object.keys(getNodeDefinition(type)!.outputs)[0];

describe('Memory nodes', () => {
  it('every kind compiles into the shared memory Pass, and its output reads its texel', () => {
    for (const kind of MEMORY_KINDS) {
      const r = compileGraph({ nodes: [node('lfo', 'lfo'), node('m', kind, {}, { [firstIn(kind)]: ['lfo', 'value'] }), ...toColor('m', firstOut(kind))] }) as CompilationResult;
      expect(r.errors ?? [], kind).toEqual([]);
      expect(r.passes?.length, kind).toBe(1);
      expect(r.passes![0].fragmentShader, kind).toContain('int(floor(gl_FragCoord.x))');
      expect(r.passes![0].fragmentShader, kind).toContain('u_frameDt');
      expect(r.fragmentShader, kind).toMatch(/texelFetch\(u_pass_\w+, ivec2\(0, 0\), 0\)/);
    }
  });

  it('many memory nodes share one Pass (one texel each), sized to how many', () => {
    const nodes = [node('lfo', 'lfo'), ...MEMORY_KINDS.map((k, i) => node(`m${i}`, k, {}, { [firstIn(k)]: ['lfo', 'value'] }))];
    const out = expandMemory(nodes);
    const passes = out.filter(n => n.type === 'pass');
    expect(passes).toHaveLength(1);
    expect(passes[0].params.__size).toBe(MEMORY_KINDS.length);
    expect(passes[0].params.format).toBe('float');
    expect(out.find(n => n.id === 'm3')!.type).toBe('memoryRead');
    expect(out.find(n => n.id === 'm3')!.params.index).toBe(3);
  });

  it('a memory node fed by another reads it a frame late (no cycle)', () => {
    const nodes = [node('lfo', 'lfo'), node('a', 'lag', {}, { input: ['lfo', 'value'] }), node('b', 'spring', {}, { input: ['a', 'value'] }), ...toColor('b', 'value')];
    const out = expandMemory(nodes);
    const pack = out.find(n => n.type === 'memoryPack')!;
    expect(pack.inputs.m1_input.connection).toEqual({ nodeId: memoryPrevId('a'), outputKey: 'value' });
    expect(out.find(n => n.id === memoryPrevId('a'))!.inputs.state.connection).toEqual({ nodeId: MEMORY_PASS_ID, outputKey: 'previous' });
    const r = compileGraph({ nodes }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
  });

  it('Lag glides: 63% of the way after Rise seconds, separate rise and fall', () => {
    let y = 0;
    for (let i = 0; i < 60; i++) y = lagStep(y, 1, 1 / 60, 1, 0.1);
    expect(y).toBeCloseTo(1 - Math.exp(-1), 3);
    let z = 1;
    for (let i = 0; i < 6; i++) z = lagStep(z, 0, 1 / 60, 1, 0.1);
    expect(z).toBeCloseTo(Math.exp(-1), 3);
    expect(lagStep(0.2, 1, 1 / 60, 0, 0)).toBe(1);
  });

  it('Sample & Hold: with Trigger wired it takes on edges; unwired, every Every seconds', () => {
    const wired = compileGraph({ nodes: [node('lfo', 'lfo'), node('t', 'lfo'), node('h', 'sampleHold', {}, { value: ['lfo', 'value'], trigger: ['t', 'value'] }), ...toColor('h', 'value')] }) as CompilationResult;
    expect(wired.passes![0].fragmentShader).toMatch(/> 0\.5 && s\.y < 0\.5\) s\.x =/);
    const timed = compileGraph({ nodes: [node('lfo', 'lfo'), node('h', 'sampleHold', { every: 0.25 }, { value: ['lfo', 'value'] }), ...toColor('h', 'value')] }) as CompilationResult;
    expect(timed.passes![0].fragmentShader).toContain('s.z += dt; if (s.z >= 0.25)');
  });
});
