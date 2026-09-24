import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../../types/nodeGraph';
import { suggestConnections } from '../smartConnect';

const node = (id: string, x: number, inputs: GraphNode['inputs'], outputs: GraphNode['outputs']): GraphNode =>
  ({ id, type: id, position: { x, y: 0 }, inputs, outputs, params: {} });

const run = (nodes: GraphNode[], from: { nodeId: string; key: string; dir: 'in' | 'out' }) =>
  suggestConnections({ nodes, from, socketPos: () => null, labelOf: n => n.id });

describe('suggestConnections', () => {
  const time = node('time', 0, {}, { t: { type: 'float', label: 't' } });

  it('ranks exact types before conversions, then distance, capped at three', () => {
    const near = node('near', 100, { col: { type: 'vec3', label: 'Col' }, a: { type: 'float', label: 'A' } }, {});
    const far = node('far', 400, { b: { type: 'float', label: 'B' }, c: { type: 'float', label: 'C' } }, {});
    const got = run([time, near, far], { nodeId: 'time', key: 't', dir: 'out' });
    expect(got.map(s => `${s.nodeId}.${s.key}`)).toEqual(['near.a', 'far.b', 'far.c']);
  });

  it('skips wired inputs, incompatible types and nodes behind the output', () => {
    const behind = node('behind', -200, { a: { type: 'float', label: 'A' } }, {});
    const wired = node('wired', 100, { a: { type: 'float', label: 'A', connection: { nodeId: 'x', outputKey: 'y' } } }, {});
    const mat = node('mat', 100, { m: { type: 'mat2', label: 'M' } }, {});
    expect(run([time, behind, wired, mat], { nodeId: 'time', key: 't', dir: 'out' })).toEqual([]);
  });

  it('never offers a wire that would close a loop', () => {
    const a = node('a', 0, { i: { type: 'float', label: 'I' } }, { o: { type: 'float', label: 'O' } });
    const b = node('b', 200, { i: { type: 'float', label: 'I', connection: { nodeId: 'a', outputKey: 'o' } } }, { o: { type: 'float', label: 'O' } });
    // Feeding a's input from b would loop a → b → a
    expect(run([a, b], { nodeId: 'a', key: 'i', dir: 'in' })).toEqual([]);
  });

  it('from an input, offers outputs to its left', () => {
    const target = node('target', 300, { g: { type: 'float', label: 'Glow' } }, {});
    expect(run([time, target], { nodeId: 'target', key: 'g', dir: 'in' }).map(s => s.nodeId)).toEqual(['time']);
  });

  it('from an output, always offers the Output node as well, pinned after the three', () => {
    const near = node('near', 100, { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' }, c: { type: 'float', label: 'C' } }, {});
    // Behind the origin and already fed by something else: still offered
    const output = { ...node('out1', -300, { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'x', outputKey: 'y' } } }, {}), type: 'output' };
    const got = run([time, near, output], { nodeId: 'time', key: 't', dir: 'out' });
    expect(got.map(s => s.nodeId)).toEqual(['near', 'near', 'near', 'out1']);
    expect(got[3].pinned).toBe(true);
    expect(got[3].key).toBe('color');
  });

  it('does not repeat the Output node when it is already ranked, or when this socket already feeds it', () => {
    const output = { ...node('out1', 300, { color: { type: 'vec3', label: 'Color' } }, {}), type: 'output' };
    const ranked = run([time, output], { nodeId: 'time', key: 't', dir: 'out' });
    expect(ranked.map(s => s.nodeId)).toEqual(['out1']);
    expect(ranked[0].pinned).toBeUndefined();
    const fed: GraphNode = { ...output, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'time', outputKey: 't' } } } };
    expect(run([time, fed], { nodeId: 'time', key: 't', dir: 'out' })).toEqual([]);
  });
});
