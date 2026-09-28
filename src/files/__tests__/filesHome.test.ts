/** The Files home's other models: most-used counting, the poster cache's keying, and which picture a node type gets. */
import { describe, it, expect } from 'vitest';
import { graphsUsingNode, mostUsed } from '../mostUsed';
import { memoryPosterStore, PosterCache, posterId } from '../posterCache';
import { nodeSnippet, nodeVisualKind } from '../nodeVisual';
import { analyzeSnippet } from '../../present/snippetHarness';
import { buildInventory } from '../inventory';
import { memoryKV } from '../mutate';
import { copyName, duplicateNode } from '../duplicate';

const g = (nodes: unknown[], play?: unknown) => ({ nodes, ...(play ? { play } : {}) });

describe('most used', () => {
  it('counts node types across graphs and into groups, functions by name, layer kinds and Play sources', () => {
    const graphs = [
      g([{ type: 'uv' }, { type: 'circleSDF' }, { type: 'circleSDF' }, { type: 'customFn', params: { label: 'Stripes' } },
        { type: 'group', params: { subgraph: { nodes: [{ type: 'circleSDF' }, { type: 'group', params: { subgraph: { nodes: [{ type: 'noise' }] } } }] } } }],
        { layers: [{ kind: 'image' }, { kind: 'script', kindId: 'k1' }, { kind: 'script', kindId: 'k1' }], layerKinds: [{ id: 'k1', name: 'Rain drops' }], mappings: [{ source: { kind: 'lfo' } }, { source: { kind: 'midi' } }, { source: { kind: 'lfo' } }] }),
      g([{ type: 'uv' }, { type: 'noise' }, { type: 'customFn', params: { label: 'Stripes' } }, { type: 'customFn', params: {} }]),
      null, 'junk',
    ];
    const m = mostUsed(graphs, { nodeLabel: t => (t === 'circleSDF' ? 'Circle SDF' : undefined) });
    expect(m.nodes.slice(0, 3)).toEqual([
      { id: 'customFn', label: 'Custom Fn', count: 3, graphs: 2 }, // a tie goes to the one in more graphs
      { id: 'circleSDF', label: 'Circle SDF', count: 3, graphs: 1 },
      { id: 'noise', label: 'Noise', count: 2, graphs: 2 },
    ]);
    expect(m.nodes.find(n => n.id === 'uv')).toEqual({ id: 'uv', label: 'Uv', count: 2, graphs: 2 });
    expect(m.functions).toEqual([{ id: 'Stripes', label: 'Stripes', count: 2, graphs: 2 }, { id: 'Custom Function', label: 'Custom Function', count: 1, graphs: 1 }]);
    expect(m.layerKinds).toEqual([{ id: 'kind:k1', label: 'Rain drops', count: 2, graphs: 1 }, { id: 'image', label: 'Image', count: 1, graphs: 1 }]);
    expect(m.sources).toEqual([{ id: 'lfo', label: 'LFO', count: 2, graphs: 1 }, { id: 'midi', label: 'MIDI', count: 1, graphs: 1 }]);
    expect(mostUsed(graphs, { limit: 1 }).nodes).toHaveLength(1);
    expect(graphsUsingNode(graphs, 'noise')).toEqual([{ index: 0, count: 1 }, { index: 1, count: 1 }]);
    expect(graphsUsingNode(graphs, 'circleSDF')).toEqual([{ index: 0, count: 3 }]);
  });

  it('is empty for nothing', () => {
    expect(mostUsed([])).toEqual({ nodes: [], functions: [], layerKinds: [], sources: [] });
  });
});

describe('poster cache', () => {
  it('keys posters by item and by example', () => {
    expect(posterId('item', 'graph:Sunset')).toBe('graph:Sunset');
    expect(posterId('example', 'fractalRings')).toBe('example:fractalRings');
  });

  it('serves a poster only for the hash it was drawn from, and prunes what is gone', async () => {
    const store = memoryPosterStore();
    const cache = new PosterCache(store);
    expect(await cache.get('graph:Sunset', 'aaaa')).toBeNull();
    await cache.put('graph:Sunset', 'aaaa', 'data:image/jpeg;base64,x', 5);
    expect(await cache.get('graph:Sunset', 'aaaa')).toBe('data:image/jpeg;base64,x');
    expect(await cache.get('graph:Sunset', 'bbbb')).toBeNull(); // the graph changed: draw again
    expect(store.data.get('graph:Sunset')).toEqual({ id: 'graph:Sunset', hash: 'aaaa', url: 'data:image/jpeg;base64,x', at: 5 });
    // A second cache over the same store reads what the first wrote.
    expect(await new PosterCache(store).get('graph:Sunset', 'aaaa')).toBe('data:image/jpeg;base64,x');
    await cache.put('glsl:g1', 'cccc', 'data:image/png;base64,y');
    expect(await cache.prune(new Set(['glsl:g1']))).toBe(1);
    expect(await cache.get('graph:Sunset', 'aaaa')).toBeNull();
    expect(await cache.get('glsl:g1', 'cccc')).toBe('data:image/png;base64,y');
  });

  it('keeps working in memory when the store fails', async () => {
    const cache = new PosterCache({ get: async () => { throw new Error('no idb'); }, put: async () => { throw new Error('no idb'); }, delete: async () => undefined, list: async () => [] });
    await cache.put('a', 'h', 'u');
    expect(await cache.get('a', 'h')).toBe('u');
    expect(await cache.get('b', 'h')).toBeNull();
  });
});

describe('node visuals', () => {
  it('picks the picture by output type and whether the node reads the position', () => {
    expect(nodeVisualKind({ outputType: 'float', hasPosition: false })).toBe('plot');
    expect(nodeVisualKind({ outputType: 'float', hasPosition: true })).toBe('field');
    expect(nodeVisualKind({ outputType: 'vec2', hasPosition: true })).toBe('field');
    expect(nodeVisualKind({ outputType: 'vec2', hasPosition: false })).toBe('field');
    expect(nodeVisualKind({ outputType: 'vec3', outputLabel: 'Color', hasPosition: true })).toBe('colour');
    expect(nodeVisualKind({ outputType: 'vec3', outputLabel: 'Colour', hasPosition: false })).toBe('colour');
    expect(nodeVisualKind({ outputType: 'vec3', outputLabel: 'Result', hasPosition: true, category: 'Color' })).toBe('colour');
    expect(nodeVisualKind({ outputType: 'vec3', outputLabel: 'Normal', hasPosition: true, category: '3D' })).toBe('field');
    expect(nodeVisualKind({ outputType: 'vec4', outputLabel: 'Out', hasPosition: true })).toBe('colour');
    expect(nodeVisualKind({ outputType: 'mat2', hasPosition: false })).toBe('none');
    expect(nodeVisualKind({ outputType: 'scene3d', hasPosition: false })).toBe('none');
  });

  it('builds a snippet the harness can draw for a position node, with its numbers as sliders', () => {
    const s = nodeSnippet('circleSDF');
    expect(s).not.toBeNull();
    expect(s!.kind).toBe('field');
    expect(s!.show).toBe('fn:node_circleSDF');
    expect(s!.code).toContain('float in_radius = 0.3;');
    expect(s!.code).toContain('float node_circleSDF(vec2 uv)');
    const a = analyzeSnippet(s!.code);
    expect(a.options.some(o => o.id === 'fn:node_circleSDF')).toBe(true);
    expect(a.sliders.some(sl => sl.label === 'in_radius')).toBe(true);
  });

  it('gives nothing for types with no picture of their own', () => {
    expect(nodeSnippet('no-such-node')).toBeNull();
    expect(nodeSnippet('output')).toBeNull();
  });
});

describe('duplicate', () => {
  it('copies a graph to a new key, a preset to a new id, and a list item onto its list, with undo', async () => {
    const kv = memoryKV({
      'shader-studio:Sunset': JSON.stringify({ nodes: [{ id: 'n1', type: 'output', params: {} }], version: 4, savedAt: 1 }),
      'shader-studio:Sunset copy': JSON.stringify({ nodes: [], version: 1, savedAt: 1 }),
      'shader-studio:cfp:cfp_1': JSON.stringify({ id: 'cfp_1', label: 'Stripes', inputs: [], outputType: 'float', body: '0.0', glslFunctions: '', savedAt: 1 }),
      'shader-studio:glsl-shaders': JSON.stringify([{ id: 'g1', name: 'Plasma', code: 'x' }, { id: 'g2', name: 'Other', code: 'y' }]),
    });
    const inv = await buildInventory(kv);
    expect(copyName('Sunset', () => false)).toBe('Sunset copy');
    expect(copyName('Sunset copy', n => n === 'Sunset copy')).toBe('Sunset copy 2');
    const g = duplicateNode(kv, inv.byId.get('graph:Sunset')!, 99)!;
    expect(g.label).toBe('Sunset copy 2');
    expect(JSON.parse(kv.get('shader-studio:Sunset copy 2')!)).toMatchObject({ version: 1, savedAt: 99, nodes: [{ id: 'n1' }] });
    const f = duplicateNode(kv, inv.byId.get('fn:cfp:cfp_1')!, 99)!;
    expect(f.label).toBe('Stripes copy');
    expect(JSON.parse(kv.get('shader-studio:cfp:cfp_1_copy_99')!)).toMatchObject({ id: 'cfp_1_copy_99', label: 'Stripes copy', body: '0.0' });
    const s = duplicateNode(kv, inv.byId.get('glsl:g1')!, 99)!;
    expect(s.label).toBe('Plasma copy');
    expect(JSON.parse(kv.get('shader-studio:glsl-shaders')!).map((x: { name: string }) => x.name)).toEqual(['Plasma', 'Plasma copy', 'Other']);
    g.undo(); f.undo(); s.undo();
    expect(kv.get('shader-studio:Sunset copy 2')).toBeNull();
    expect(kv.get('shader-studio:cfp:cfp_1_copy_99')).toBeNull();
    expect(JSON.parse(kv.get('shader-studio:glsl-shaders')!)).toHaveLength(2);
    expect(duplicateNode(kv, inv.byId.get('section:graphs')!)).toBeNull();
  });
});
