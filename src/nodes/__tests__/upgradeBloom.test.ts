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
/** Graphs with a wired Bloom: the examples had them until the 2026-10-17 sweep moved them to Glow (texture); old graphs still do. */
const bloomGraph = (params: Record<string, unknown>): GraphNode[] => [
  n('uv', 'uv', 0, 0), n('circleSDF', 'c', 0, 0, { radius: 0.3 }, { position: ['uv', 'uv'] }),
  n('light', 'l', 0, 0, { mode: 'glow', brightness: 20 }, { distance: ['c', 'distance'] }),
  n('bloom', 'b', 0, 0, params, { color: ['l', 'tinted'], uv: ['uv', 'uv'] }),
  n('toneMap', 't', 0, 0, {}, { color: ['b', 'result'] }), n('output', 'out', 0, 0, {}, { color: ['t', 'color'] }),
];
const withBloom: Array<[string, { nodes: GraphNode[] }]> = [
  ['spiral', { nodes: bloomGraph({ threshold: 0.4, intensity: 2, radius: 40 }) }],
  ['layered luma', { nodes: bloomGraph({ threshold: 0.45, intensity: 2.5, radius: 40, select: 'luma', softness: 0.25, kernel: 'layered' }) }],
];
const GRAPHS = Object.fromEntries(withBloom);
void EXAMPLE_GRAPHS;

const allPrograms = (r: ReturnType<typeof compileGraph>) => [r.fragmentShader, ...((r as { passes?: Array<{ fragmentShader?: string }> }).passes ?? []).map(p => p.fragmentShader ?? '')].join('\n');

describe('upgrade Bloom', () => {
  it('no example uses the old Bloom any more', () => expect(Object.values(EXAMPLE_GRAPHS).some(g => g.nodes.some(nd => nd.type === 'bloom'))).toBe(false));

  it.each(withBloom.map(([key]) => key))('%s compiles after the upgrade', key => {
    const nodes = resolveNodeAliases(GRAPHS[key].nodes, getNodeDefinition);
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
