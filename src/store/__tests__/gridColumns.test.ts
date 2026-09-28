/**
 * Grid and Grid Pattern's Columns counts cells across the width (it used to
 * draw twice the count). Graphs saved before the fix are migrated on load so
 * they draw exactly what they drew before: see nodes/definitions/gridColumns.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { clearLegacyColumnsWire, LEGACY_COLUMNS_WIRE } from '../../nodes/definitions/gridColumns';
import { instantiateNode } from '../../nodes/scene3dDefaults';
import { migrateNodeParams, type GraphNode } from '../../types/nodeGraph';
import { parsePlayRecord, type PlayRecord } from '../../types/play';
import { n, out, uv } from '../graphBuilder';
import { migratePlayRecord } from '../migratePlay';
import { useNodeGraphStore } from '../useNodeGraphStore';

const ASPECT = 16 / 9;
const migrate = (node: GraphNode) => migrateNodeParams(node, getNodeDefinition);

/** A node as the app saved it before the fix: no version stamp (or version 1), the old Columns value. */
function oldNode(type: 'gridLayout' | 'gridPattern', id: string, params: Record<string, unknown>, wires: Record<string, [string, string]> = {}): GraphNode {
  const node = n(type, id, 0, 0, params, { uv: ['uv', 'uv'], ...wires });
  delete node.params._schemaVersion;
  return node;
}

function graphWith(grid: GraphNode, extra: GraphNode[] = []): GraphNode[] {
  const colourOut = grid.type === 'gridPattern' ? 'color' : 'cellUV';
  const tail = grid.type === 'gridPattern'
    ? [out([grid.id, colourOut], 0)]
    : [n('splitVec2', 'sp', 0, 0, {}, { v: [grid.id, 'cellUV'] }), n('floatToVec3', 'f3', 0, 0, {}, { input: ['sp', 'x'] }), out(['f3', 'rgb'], 0)];
  return [uv(), ...extra, grid, ...tail];
}

/**
 * Cell width in UV units, read from the compiled shader (the one grid in it)
 * for the given aspect ratio. `wiredValue`: the value of the Constant wired
 * into Columns, when it is wired.
 */
function compiledCell(nodes: GraphNode[], wiredValue?: number): number {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  const m = r.fragmentShader!.match(/(\w+)_cell = 2\.0 \* \1_asp \/ ([^;]+);/);
  expect(m, 'cell line').not.toBeNull();
  const cols = m![2].trim();
  // An unwired Columns is a live uniform (a slider drag must not recompile).
  if (wiredValue === undefined) return 2 * ASPECT / Number(r.paramUniforms[cols] ?? cols);
  // A wire into an old node is doubled: `(2.0 * <constant's output>)`.
  expect(cols).toMatch(/^\(2\.0 \* \w+_value\)$/);
  return 2 * ASPECT / (2 * wiredValue);
}

describe('Grid Columns', () => {
  it('a fresh node draws Columns cells across the width', () => {
    for (const type of ['gridLayout', 'gridPattern'] as const) {
      const node = n(type, 'g', 0, 0, { columns: 4 }, { uv: ['uv', 'uv'] });
      expect(node.params._schemaVersion).toBe(2);
      const cell = compiledCell(graphWith(node));
      // The UV spans −aspect…aspect: 2 × aspect wide.
      expect(2 * ASPECT / cell).toBeCloseTo(4, 10);
    }
  });

  it('an old graph with Columns 4 draws the same 8 cells across after migration', () => {
    for (const type of ['gridLayout', 'gridPattern'] as const) {
      const before = oldNode(type, 'g', { columns: 4 });
      const oldCell = ASPECT / 4; // the formula before the fix
      const after = migrate(before);
      expect(after.params.columns).toBe(8);
      expect(after.params._schemaVersion).toBe(2);
      expect(compiledCell(graphWith(after))).toBeCloseTo(oldCell, 12);
    }
  });

  it('a node saved at version 1 (loaded once before the fix) is migrated too', () => {
    const before = oldNode('gridLayout', 'g', { columns: 5, _schemaVersion: 1 });
    expect(migrate(before).params.columns).toBe(10);
  });

  it('runs exactly once', () => {
    const once = migrate(oldNode('gridPattern', 'g', { columns: 6 }));
    const twice = migrate(once);
    expect(twice.params.columns).toBe(12);
    expect(migrate(JSON.parse(JSON.stringify(twice)) as GraphNode).params.columns).toBe(12);
  });

  it('never touches new nodes, however they were made', () => {
    const fromBuilder = n('gridLayout', 'a', 0, 0, { columns: 7 });
    const fromDef = instantiateNode('b', 'gridPattern', getNodeDefinition('gridPattern')!, { x: 0, y: 0 }, { columns: 7 });
    for (const node of [fromBuilder, fromDef]) {
      expect(migrate(node).params.columns).toBe(7);
      expect(migrate(JSON.parse(JSON.stringify(node)) as GraphNode).params.columns).toBe(7);
    }
  });

  it('a node saved without a Columns value gets the old default, doubled', () => {
    expect(migrate(oldNode('gridLayout', 'g', {})).params.columns).toBe(20);
    const gp = oldNode('gridPattern', 'g', {});
    delete gp.params.columns;
    expect(migrate(gp).params.columns).toBe(16);
  });

  it('doubles keyframes on Columns', () => {
    const before = oldNode('gridLayout', 'g', { columns: 3, __keyframes_columns: [{ t: 0, v: 2, ease: { a: 0, b: 0, c: 1, d: 1 } }, { t: 1, v: 5, ease: { a: 0, b: 0, c: 1, d: 1 } }] });
    const kf = migrate(before).params.__keyframes_columns as Array<{ v: number }>;
    expect(kf.map(k => k.v)).toEqual([4, 10]);
  });

  it('a wired Columns keeps its picture: the compiled code doubles the wire', () => {
    const cols = n('constant', 'cols', 0, 0, { value: 6 });
    const before = oldNode('gridLayout', 'g', {}, { columns: ['cols', 'value'] });
    const after = migrate(before);
    expect(after.params[LEGACY_COLUMNS_WIRE]).toBe(true);
    expect(compiledCell(graphWith(after, [cols]), 6)).toBeCloseTo(ASPECT / 6, 12);
    // A new node wired the same way reads the wire as it is.
    const fresh = n('gridLayout', 'g', 0, 0, {}, { uv: ['uv', 'uv'], columns: ['cols', 'value'] });
    const r = compileGraph({ nodes: graphWith(fresh, [cols]) }).fragmentShader!;
    expect(r).toMatch(/(\w+)_cell = 2\.0 \* \1_asp \/ \w+;/);
    // Wiring something new into Columns clears the flag.
    expect(clearLegacyColumnsWire(after, 'columns').params[LEGACY_COLUMNS_WIRE]).toBeUndefined();
    expect(clearLegacyColumnsWire(after, 'uv').params[LEGACY_COLUMNS_WIRE]).toBe(true);
  });

  it('an unwired old node gets no wire flag', () => {
    expect(migrate(oldNode('gridLayout', 'g', { columns: 4 })).params[LEGACY_COLUMNS_WIRE]).toBeUndefined();
  });

  it('doubles a group’s overrides of an inner Grid’s Columns, nested groups included', () => {
    const inner = oldNode('gridLayout', 'g', { columns: 5 });
    const nested: GraphNode = { ...n('group', 'ig', 0, 0, { label: 'Inner' }), params: { label: 'Inner', subgraph: { nodes: [inner], inputPorts: [], outputPorts: [] }, 'g::columns': 3 } };
    const group: GraphNode = {
      ...n('group', 'og', 0, 0, { label: 'Outer' }),
      params: { label: 'Outer', subgraph: { nodes: [nested], inputPorts: [], outputPorts: [] }, 'ig::g::columns': 7, 'ig::g::other': 1 },
    };
    const m = migrate(group);
    expect(m.params['ig::g::columns']).toBe(14);
    expect(m.params['ig::g::other']).toBe(1);
    const mNested = (m.params.subgraph as { nodes: GraphNode[] }).nodes[0];
    expect(mNested.params['g::columns']).toBe(6);
    expect((mNested.params.subgraph as { nodes: GraphNode[] }).nodes[0].params.columns).toBe(10);
    // And only once.
    expect(migrate(m).params['ig::g::columns']).toBe(14);
  });
});

describe('Grid Columns: Play', () => {
  const record = (): PlayRecord => ({
    ...parsePlayRecord(null),
    controls: [
      { id: 'c1', target: 'g::columns', kind: 'float', label: 'Columns', min: 2, max: 20, step: 1 },
      { id: 'c2', target: 'g::size', kind: 'float', label: 'Size', min: 0, max: 1 },
      { id: 'c3', target: 'grp::g2::columns', kind: 'float', label: 'Inner columns', min: 1, max: 10 },
    ],
    mappings: [
      { id: 'm1', controlId: 'c1', source: { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 }, outMin: 3, outMax: 9, curve: 'linear', smoothMs: 0, enabled: true },
      { id: 'm2', controlId: 'c2', source: { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 }, outMin: 0.1, outMax: 0.4, curve: 'linear', smoothMs: 0, enabled: true },
    ],
    takes: [{ id: 't', name: 'Take', from: 0, length: 1, events: [], tracks: [
      { kind: 'control', id: 'c1', target: 'g::columns', label: 'Columns', width: 1, keys: '0,4,500,6' },
      { kind: 'control', id: 'c2', target: 'g::size', label: 'Size', width: 1, keys: '0,0.3' },
    ] }],
  } as PlayRecord);
  const saved = (stamp: boolean): GraphNode[] => {
    const g = stamp ? n('gridPattern', 'g', 0, 0, { columns: 4 }) : oldNode('gridPattern', 'g', { columns: 4 });
    const g2 = stamp ? n('gridLayout', 'g2', 0, 0, { columns: 4 }) : oldNode('gridLayout', 'g2', { columns: 4 });
    const grp: GraphNode = { ...n('group', 'grp', 0, 0, { label: 'G' }), params: { label: 'G', subgraph: { nodes: [g2], inputPorts: [], outputPorts: [] } } };
    return [g, grp];
  };

  it('doubles the range, step, mappings and takes of controls on an old Columns', () => {
    const p = migratePlayRecord(record(), saved(false), getNodeDefinition);
    expect(p.controls[0]).toMatchObject({ min: 4, max: 40, step: 2 });
    expect(p.controls[1]).toMatchObject({ min: 0, max: 1 });
    expect(p.controls[2]).toMatchObject({ min: 2, max: 20 });
    expect(p.mappings[0]).toMatchObject({ outMin: 6, outMax: 18 });
    expect(p.mappings[1]).toMatchObject({ outMin: 0.1, outMax: 0.4 });
    expect(p.takes![0].tracks[0].keys).toBe('0,8,500,12');
    expect(p.takes![0].tracks[1].keys).toBe('0,0.3');
  });

  it('leaves controls on new nodes alone', () => {
    const r = record();
    expect(migratePlayRecord(r, saved(true), getNodeDefinition)).toBe(r);
  });

  it('importing an old graph file migrates the nodes and its Play setup together', () => {
    const nodes = graphWith(oldNode('gridPattern', 'g', { columns: 4 }));
    const file = JSON.stringify({ nodes, play: { version: 1, controls: [record().controls[0]], mappings: [record().mappings[0]], layers: [] } });
    const res = useNodeGraphStore.getState().importGraph(file);
    expect(res.ok).toBe(true);
    const st = useNodeGraphStore.getState();
    expect(st.nodes.find(x => x.id === 'g')!.params.columns).toBe(8);
    expect(st.play.controls[0]).toMatchObject({ min: 4, max: 40, step: 2 });
    expect(st.play.mappings[0]).toMatchObject({ outMin: 6, outMax: 18 });
    // Saving and loading again changes nothing more.
    const again = JSON.stringify({ nodes: st.nodes, play: st.play });
    useNodeGraphStore.getState().importGraph(again);
    const st2 = useNodeGraphStore.getState();
    expect(st2.nodes.find(x => x.id === 'g')!.params.columns).toBe(8);
    expect(st2.play.controls[0]).toMatchObject({ min: 4, max: 40, step: 2 });
  });
});
