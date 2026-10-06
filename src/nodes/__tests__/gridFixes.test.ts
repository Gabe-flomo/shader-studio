import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../definitions';
import { migrateNodeParams, type GraphNode } from '../../types/nodeGraph';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';

const uvNode: GraphNode = { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} };
const out = (nodeId: string, outputKey: string): GraphNode => ({
  id: 'out', type: 'output', position: { x: 0, y: 0 },
  inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId, outputKey } } }, outputs: {}, params: {},
});

describe('Grid: Breathing example', () => {
  const nodes = EXAMPLE_GRAPHS.gridBreathing.nodes;
  const byId = (id: string) => nodes.find(n => n.id === id)!;

  it('measures the dot from Grid Pos, with Animated Cell Center in the same (cell) units', () => {
    const circ = byId('circ');
    expect(circ.inputs.position.connection).toEqual({ nodeId: 'grid', outputKey: 'grid_pos' });
    expect(circ.inputs.offset.connection).toEqual({ nodeId: 'acc', outputKey: 'center' });
    // Grid Size 1: Center = Cell ID + 0.5 + wobble, i.e. Grid Pos units.
    expect(byId('acc').params.gridSize).toBe(1);
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/circleSDF\(gridlayout_\d+_gp - animatedce_\d+_center, /);
  });

  it('keeps every dot (wobble plus its largest radius) inside its own cell', () => {
    const acc = byId('acc').params, wave = byId('wave').params;
    // The wobble is (sin, cos) × Amplitude ÷ Grid Size; the radius peaks at Base + Amp.
    const wobble = Math.SQRT2 * (acc.amplitude as number) / (acc.gridSize as number);
    const radius = (wave.base as number) + (wave.amp as number);
    expect(wobble + radius).toBeLessThan(0.5);
    expect((wave.base as number) - (wave.amp as number)).toBeGreaterThan(0);
  });

  it('explains itself on every node but the plumbing', () => {
    for (const n of nodes.filter(n => n.type !== 'uv' && n.type !== 'output'))
      expect(typeof n.params.__comment, n.id).toBe('string');
  });
});

describe('Neighbor Dist: Neighbours control', () => {
  const graph = (size: unknown): GraphNode[] => [
    uvNode,
    { id: 'g', type: 'gridLayout', position: { x: 0, y: 0 }, inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } } }, outputs: { cellUV: { type: 'vec2', label: 'Cell UV' }, cellID: { type: 'vec2', label: 'Cell ID' } }, params: { columns: 10, _schemaVersion: 2 } },
    {
      id: 'nd', type: 'neighborDist', position: { x: 0, y: 0 },
      inputs: {
        uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'g', outputKey: 'cellUV' } },
        cellID: { type: 'vec2', label: 'Cell ID', connection: { nodeId: 'g', outputKey: 'cellID' } },
      },
      outputs: { minDist: { type: 'float', label: 'Min Dist' } }, params: { neighborhood_size: size, dispScale: 0.35 },
    },
    { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'float', label: 'Color', connection: { nodeId: 'nd', outputKey: 'minDist' } } }, outputs: {}, params: {} },
  ];
  const calls = (size: unknown) => {
    const r = compileGraph({ nodes: graph(size) });
    expect(r.errors ?? []).toEqual([]);
    return (r.fragmentShader.match(/gridHash22\(\w+_nc\)/g) ?? []).length;
  };

  it('is a 3×3 / 5×5 select on the card', () => {
    const def = getNodeDefinition('neighborDist')!;
    const pd = def.paramDefs!.neighborhood_size;
    expect(pd.type).toBe('select');
    expect(pd.options!.map(o => o.value)).toEqual(['1', '2']);
  });
  it('searches 9 cells on 3×3 and 25 on 5×5, and reads the old numeric value', () => {
    expect(calls('1')).toBe(9);
    expect(calls('2')).toBe(25);
    expect(calls(1)).toBe(9);
    expect(calls(2)).toBe(25);
    expect(calls(undefined)).toBe(9);
  });
});

describe('Grid Pattern: Pull/Push stay inside what Overflow can draw', () => {
  const graph = (overflow: string): GraphNode[] => [
    uvNode,
    { id: 'gp', type: 'gridPattern', position: { x: 0, y: 0 }, inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } } }, outputs: { color: { type: 'vec3', label: 'Color' } }, params: { affect: 'push', overflow, affectAmount: 2 } },
    out('gp', 'color'),
  ];
  it.each([['none', '0.45', '0.45'], ['neighbours', '1.0', '1.0'], ['far', '1.0', '2.0']])('%s: Influence × %s, capped at %s cells', (overflow, k, cap) => {
    const fs = compileGraph({ nodes: graph(overflow) }).fragmentShader;
    const esc = (s: string) => s.replace('.', '\\.');
    expect(fs).toMatch(new RegExp(`_q -= -\\w+dir \\* min\\(\\w+inf \\* ${esc(k)}, ${esc(cap)}\\);`));
  });
  it('says so in the hints', () => {
    const pd = getNodeDefinition('gridPattern')!.paramDefs!;
    expect(pd.affect.hint).toMatch(/0\.45/);
    expect(pd.affect.hint).toMatch(/Clip/);
    expect(pd.overflow.hint).toMatch(/2\.5 cells/);
  });
});

describe('Tile: Cell ID', () => {
  it('outputs floor(uv × count) next to the unchanged tile output', () => {
    const tile: GraphNode = {
      id: 't', type: 'fract', position: { x: 0, y: 0 },
      inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv', outputKey: 'uv' } }, scale: { type: 'float', label: 'Tile count' } },
      outputs: { output: { type: 'vec2', label: 'Output' }, cellID: { type: 'vec2', label: 'Cell ID' } }, params: { scale: 4 },
    };
    const def = getNodeDefinition('fract')!;
    const g = def.generateGLSL(tile, { input: 'uv_uv' });
    expect(g.outputVars).toEqual({ output: 't_output', cellID: 't_cid' });
    expect(g.code).toMatch(/vec2 t_cid = floor\(uv_uv \* [^;]+\);/);
    expect(g.code).toMatch(/vec2 t_output = fract\(uv_uv \* [^;]+\) - 0\.5;/);
    // Wired on, the ID compiles (the output is a real vec2).
    const r = compileGraph({ nodes: [uvNode, tile, { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 't', outputKey: 'cellID' } } }, outputs: {}, params: {} }] });
    expect(r.errors ?? []).toEqual([]);
  });
  it('gives a Tile saved before Cell ID existed the new output on load', () => {
    const old: GraphNode = { id: 't', type: 'fract', position: { x: 0, y: 0 }, inputs: {}, outputs: { output: { type: 'vec2', label: 'Output' } }, params: { scale: 3 } };
    const n = migrateNodeParams(old, getNodeDefinition);
    expect(Object.keys(n.outputs)).toEqual(['output', 'cellID']);
    expect(migrateNodeParams(n, getNodeDefinition).outputs).toEqual(n.outputs);
  });
});

describe('Grid hashes are sine-free', () => {
  it('Grid Pattern and Neighbor Dist hash with gridHash12/22, with one copy when both are in a graph', () => {
    const nodes: GraphNode[] = [
      uvNode,
      { id: 'gp', type: 'gridPattern', position: { x: 0, y: 0 }, inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } } }, outputs: { color: { type: 'vec3', label: 'Color' }, cellUV: { type: 'vec2', label: 'Cell UV' }, cellID: { type: 'vec2', label: 'Cell ID' } }, params: { jitter: 0.3, pattern: 'random' } },
      {
        id: 'nd', type: 'neighborDist', position: { x: 0, y: 0 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'gp', outputKey: 'cellUV' } }, cellID: { type: 'vec2', label: 'Cell ID', connection: { nodeId: 'gp', outputKey: 'cellID' } } },
        outputs: { minDist: { type: 'float', label: 'Min Dist' } }, params: {},
      },
      { id: 'mix', type: 'multiplyVec3', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gp', outputKey: 'color' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'nd', outputKey: 'minDist' } } }, outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      out('mix', 'result'),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const fs = r.fragmentShader;
    expect(fs.match(/vec2 gridHash22\(vec2 p\)/g)).toHaveLength(1);
    expect(fs.match(/float gridHash12\(vec2 p\)/g)).toHaveLength(1);
    expect(fs).toContain('float gpHash(vec2 c) { return gridHash12(c); }');
    expect(fs).toContain('vec2 gpHash2(vec2 c) { return gridHash22(c); }');
    expect(fs).not.toMatch(/sin\(vec2\(dot\(\w+_nc/);
  });
});
