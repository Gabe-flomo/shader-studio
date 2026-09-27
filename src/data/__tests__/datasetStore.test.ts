/**
 * Datasets in the graph file: saved, versioned, exported and imported with
 * the graph, validated on load, and read by the preview's data textures
 * without a shader rebuild when their values change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const ls: Record<string, string> = {};
  const hidden = (k: string, v: unknown) => Object.defineProperty(ls, k, { value: v, enumerable: false });
  hidden('getItem', (k: string) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null));
  hidden('setItem', (k: string, v: string) => { ls[k] = String(v); });
  hidden('removeItem', (k: string) => { delete ls[k]; });
  hidden('clear', () => { for (const k of Object.keys(ls)) delete ls[k]; });
  hidden('key', (i: number) => Object.keys(ls)[i] ?? null);
  Object.defineProperty(ls, 'length', { get: () => Object.keys(ls).length, enumerable: false });
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});
import * as THREE from 'three';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { listVersions } from '../../store/graphVersions';
import { buildLibraryZip, importLibrary, readLibrary, takeSnapshot, type KV } from '../../utils/library';
import { n, out } from '../../store/graphBuilder';
import { retypeDataNode } from '../../nodes/definitions/data';
import { datasetFromText } from '../datasetActions';
import { computeDataset } from '../compute';
import { datasetStore, appendToTable } from '../datasetStore';
import { DataTextureBinder } from '../dataTextures';
import { parseDatasetsRecord, type Dataset, type TableResult } from '../types';

function sampleDataset(): Dataset {
  const d = datasetFromText({ filename: 'route.csv', text: 'x,y\n1,2\n3,4\n5,6\n' }, []);
  const out = computeDataset({ text: d.source.kind === 'file' ? d.source.text : '', format: 'csv', cells: d.cells });
  return { ...d, result: out.run!.result };
}

const graphWithData = () => [
  retypeDataNode(n('data', 'd', 0, 0, { dataset: 'route', outputs: [{ key: 'o1', columns: ['x', 'y'] }] })),
  n('makeVec3', 'm', 200, 0, {}, { r: ['d', 'count'] }),
  out(['m', 'rgb'], 400),
];

describe('datasets in the graph file', () => {
  beforeEach(() => {
    localStorage.clear();
    useNodeGraphStore.setState({ currentGraph: null, graphDirty: false, datasets: {} });
  });

  it('are saved with the graph, kept in its versions and loaded back', async () => {
    const s = useNodeGraphStore.getState();
    const d = sampleDataset();
    expect(d.id).toBe('route');
    useNodeGraphStore.setState({ nodes: graphWithData() });
    s.setDataset(d);
    await s.saveGraph('Route');
    s.updateDataset('route', { normalize: true });
    await s.saveGraph('Route');
    useNodeGraphStore.setState({ datasets: {} });
    expect(s.loadGraphVersion('Route', 1).ok).toBe(true);
    expect(useNodeGraphStore.getState().datasets.route.normalize).toBe(false);
    expect(s.loadSavedGraph('Route').ok).toBe(true);
    const back = useNodeGraphStore.getState().datasets.route;
    expect(back.normalize).toBe(true);
    expect(back.result).toEqual(d.result);
    expect(back.cells).toEqual(d.cells);
    expect(listVersions('Route').length).toBe(2);
  });

  it('a graph without datasets has no datasets key, and loading one clears the old datasets', async () => {
    const s = useNodeGraphStore.getState();
    useNodeGraphStore.setState({ nodes: [out(['x', 'y'], 0)] });
    await s.saveGraph('Plain');
    expect(JSON.parse(localStorage.getItem('shader-studio:Plain')!)).not.toHaveProperty('datasets');
    s.setDataset(sampleDataset());
    expect(s.loadSavedGraph('Plain').ok).toBe(true);
    expect(useNodeGraphStore.getState().datasets).toEqual({});
  });

  it('travel through a graph file import', () => {
    const d = sampleDataset();
    const json = JSON.stringify({ nodes: graphWithData(), datasets: { route: d } });
    expect(useNodeGraphStore.getState().importGraph(json).ok).toBe(true);
    expect(useNodeGraphStore.getState().datasets.route.result).toEqual(d.result);
    // The Data node's sockets survive the load migration as they were set up
    expect(Object.keys(useNodeGraphStore.getState().nodes.find(x => x.id === 'd')!.outputs)).toEqual(['o1', 'count']);
  });

  it('travel through the library ZIP', async () => {
    const s = useNodeGraphStore.getState();
    useNodeGraphStore.setState({ nodes: graphWithData() });
    s.setDataset(sampleDataset());
    await s.saveGraph('Zipped');
    const kv: KV = { keys: () => Object.keys(localStorage), get: k => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) };
    const zip = buildLibraryZip(takeSnapshot(kv));
    localStorage.clear();
    importLibrary(readLibrary(zip), kv);
    useNodeGraphStore.setState({ datasets: {} });
    expect(s.loadSavedGraph('Zipped').ok).toBe(true);
    expect(useNodeGraphStore.getState().datasets.route.result?.kind).toBe('table');
  });

  it('are checked on load: bad entries dropped, tables made rectangular', () => {
    const d = sampleDataset();
    const parsed = parseDatasetsRecord({
      route: { ...d, result: { kind: 'table', rows: 3, columns: [{ name: 'x', type: 'number', values: [1, 'no', null, 9] }] } },
      'Bad Id': d,
      noSource: { ...d, source: { kind: 'file', format: 'xls', text: '' } },
      later: { ...d, id: 'later', source: { kind: 'stream', transport: 'websocket', address: 'ws://x', window: 500 } },
    });
    expect(Object.keys(parsed)).toEqual(['route', 'later']);
    expect(parsed.route.result).toEqual({ kind: 'table', rows: 3, columns: [{ name: 'x', type: 'number', values: [1, null, null], min: 1, max: 1 }] });
    expect(parsed.later.source).toEqual({ kind: 'stream', transport: 'websocket', address: 'ws://x', window: 500 });
    expect(parseDatasetsRecord('nope')).toEqual({});
  });
});

describe('data textures', () => {
  beforeEach(() => useNodeGraphStore.setState({ datasets: {} }));

  it('follow a new result without a shader rebuild', () => {
    const s = useNodeGraphStore.getState();
    useNodeGraphStore.setState({ nodes: graphWithData() });
    s.setDataset(sampleDataset());
    s.compile();
    const fs = useNodeGraphStore.getState().fragmentShader;
    expect(fs).toMatch(/u_ds_route_/);

    const uniforms: Record<string, THREE.IUniform> = {};
    let renders = 0;
    const binder = new DataTextureBinder(uniforms, () => { renders++; });
    binder.bind(fs);
    const texName = Object.keys(uniforms).find(k => k.startsWith('u_ds_route_') && k !== 'u_ds_route_n')!;
    const tex = uniforms[texName].value as THREE.DataTexture;
    expect(Array.from(tex.image.data as Float32Array).filter((_, i) => i % 4 < 2)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(uniforms.u_ds_route_n.value).toBe(3);

    // Normalize on: same shader, same texture, new values
    s.updateDataset('route', { normalize: true });
    expect(useNodeGraphStore.getState().fragmentShader).toBe(fs);
    expect(uniforms[texName].value).toBe(tex);
    expect(Array.from(tex.image.data as Float32Array).filter((_, i) => i % 4 === 0)).toEqual([0, 0.5, 1]);
    expect(renders).toBe(1);

    // A live stream adds rows: the texture grows, still no rebuild
    datasetStore.appendRows('route', [{ x: 7, y: 8 }, { x: 9, y: 10 }]);
    expect(uniforms.u_ds_route_n.value).toBe(5);
    expect((uniforms[texName].value as THREE.DataTexture).image.width).toBe(5);
    expect(useNodeGraphStore.getState().fragmentShader).toBe(fs);
    binder.dispose();
  });

  it('typing in the notebook (no new result) does not re-upload', () => {
    const s = useNodeGraphStore.getState();
    s.setDataset(sampleDataset());
    const v = datasetStore.version('route');
    s.updateDataset('route', { cells: [{ id: 'z', code: 'df.head(2)' }], name: 'Renamed' });
    expect(datasetStore.version('route')).toBe(v);
    s.updateDataset('route', { normalize: true });
    expect(datasetStore.version('route')).toBeGreaterThan(v);
  });

  it('appending keeps a rolling window', () => {
    const t: TableResult = { kind: 'table', rows: 2, columns: [{ name: 'v', type: 'number', values: [1, 2], min: 1, max: 2 }] };
    const next = appendToTable(t, [{ v: 3 }, { v: 4, w: 'new' }], 3);
    expect(next.rows).toBe(3);
    expect(next.columns[0]).toEqual({ name: 'v', type: 'number', values: [2, 3, 4], min: 2, max: 4 });
    expect(next.columns[1]).toEqual({ name: 'w', type: 'category', values: [null, null, 'new'] });
  });
});
