/**
 * Bloom upgrade (nodes/upgradeBloom.ts) and the bloom chain's Tail: every example with a Bloom
 * compiles after the upgrade, the Glow keeps the Bloom's id and settings, Tail only appears when set,
 * and Tone Map's Jodie Reinhard compiles.
 */
import { describe, expect, it, vi } from 'vitest';
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { upgradeBloom } from '../upgradeBloom';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';

let k = 0;
const nextId = () => `ub${k++}`;
const withBloom = Object.entries(EXAMPLE_GRAPHS).filter(([, g]) => g.nodes.some(nd => nd.type === 'bloom' && nd.inputs.color?.connection)).slice(0, 12);

const allPrograms = (r: ReturnType<typeof compileGraph>) => [r.fragmentShader, ...((r as { passes?: Array<{ fragmentShader?: string }> }).passes ?? []).map(p => p.fragmentShader ?? '')].join('\n');

describe('upgrade Bloom', () => {
  it('there are examples with a wired Bloom', () => expect(withBloom.length).toBeGreaterThan(0));

  it.each(withBloom.map(([key]) => key))('%s compiles after the upgrade', key => {
    const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);
    const bloom = nodes.find(nd => nd.type === 'bloom' && nd.inputs.color?.connection)!;
    const r = upgradeBloom(nodes, bloom.id, nextId)!;
    expect(r).not.toBeNull();
    const glow = r.nodes.find(nd => nd.id === bloom.id)!;
    expect(glow.type).toBe('glowTexture');
    expect(glow.params.intensity).toBe(bloom.params.intensity ?? 1.5);
    expect(r.nodes.some(nd => Object.values(nd.inputs).some(i => i.connection?.nodeId === bloom.id && i.connection.outputKey === 'result'))).toBe(false);
    const res = compileGraph({ nodes: r.nodes });
    expect(res.errors ?? []).toEqual([]);
  });

  it('a Bloom with nothing wired into Color is left alone', () => {
    expect(upgradeBloom([n('bloom', 'b', 0, 0)], 'b', nextId)).toBeNull();
  });
});

describe('Glow (texture) Tail', () => {
  const graph = (tail?: number): GraphNode[] => {
    const glow = n('glowTexture', 'g', 400, 0, { method: 'bloom', radius: 24 }, { texture: ['p', 'texture'] });
    if (tail === undefined) delete glow.params.tail; else glow.params.tail = tail;
    return [
      n('circleSDF', 'c', -800, 0),
      n('floatToVec3', 'v', -400, 0, {}, { input: ['c', 'distance'] }),
      n('pass', 'p', 0, 0, {}, { color: ['v', 'rgb'] }),
      glow,
      n('output', 'out', 800, 0, {}, { color: ['g', 'glow'] }),
    ];
  };
  it('uses the weighted levels only when Tail is set', () => {
    const withTail = compileGraph({ nodes: graph(0.6) });
    expect(withTail.errors ?? []).toEqual([]);
    expect(allPrograms(withTail)).toMatch(/blBloomSumT\(/);
    const old = compileGraph({ nodes: graph() });
    expect(old.errors ?? []).toEqual([]);
    expect(allPrograms(old)).not.toMatch(/blBloomSumT\(|blBloomWt\(/);
  });
});

describe('Tone Map: Jodie Reinhard', () => {
  it('compiles', () => {
    const r = compileGraph({ nodes: [n('circleSDF', 'c', 0, 0), n('floatToVec3', 'v', 300, 0, {}, { input: ['c', 'distance'] }), n('toneMap', 't', 600, 0, { mode: 'jodie' }, { color: ['v', 'rgb'] }), n('output', 'out', 900, 0, {}, { color: ['t', 'color'] })] });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toContain('toneJodie(');
  });
});
