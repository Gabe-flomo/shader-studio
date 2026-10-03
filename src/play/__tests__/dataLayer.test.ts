/**
 * The Data layer (types/playLayers.ts DataLayer, play/kit/data.js): the
 * layout maths (axes modes, normalisation, the views), text splitting,
 * counting and sorting, stepping and its actions, what s.data() returns, the
 * data mapping source following dataset changes, and the datasets an export
 * carries.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  kdAct, kdBarsLayout, kdChunkText, kdCurrent, kdEqualFrame, kdFrac, kdFrame, kdKey, kdLinesLayout, kdNorm, kdOrder, kdPathLayout, kdPathPoint, kdPieLayout, kdPlan,
  kdPointsLayout, kdScriptView, kdShown, kdSplit, kdState, kdTextItems, kdTicks, kdUnit, kdColumn, kdZero,
} from '../kit/data.js';
import { createLayerKit } from '../kit/kit.js';
import { defaultLayer, parseLayer, layerNumericProps, type DataLayer } from '../../types/playLayers';
import { actionsForLayer, emptyPlayRecord, parsePlayRecord, type PlayRecord } from '../../types/play';
import { datasetStore } from '../../data/datasetStore';
import { parseSourceText } from '../../data/parse';
import type { Dataset, DatasetResult, DatasetsRecord, TableResult } from '../../data/types';
import { dataItemCount, dataSourceValue, findDataset, kitDataset, readDataSource, suggestDataColumns } from '../dataLayer';
import { datasetsForWeb, datasetsUsed } from '../dataExport';
import { buildPlayHtml, leftBehind, mediaCarried, playBundle, unsupportedFeatures } from '../exportHtml';
import { webInputFrom, type CompiledForWeb } from '../webInput';
import { inputBus } from '../../lib/inputBus';
import { actionLabel } from '../../components/play/layers/help';
import { sourceLabel } from '../playSources';
import { SCRIPT_REFERENCE, referenceFor } from '../../components/play/layers/scriptReference';

const table = (csv: string): TableResult => parseSourceText(csv, 'csv').result as TableResult;
const CITIES = table('city,month,temp\nOslo,1,-4\nRome,1,8\nCairo,1,14\nOslo,2,-2\nRome,2,9\nCairo,2,15\n');
const layer = (over: Partial<DataLayer> = {}): DataLayer => ({ ...(defaultLayer('data', 'd1', 'Data') as DataLayer), ...over });
const values = (l: DataLayer, over: Record<string, number> = {}) => (k: string) => over[k] ?? (l as unknown as Record<string, number>)[k];
const frame = { left: 0, top: 0, w: 100, h: 50 };

describe('axes and normalisation', () => {
  it('corner runs 0 to 1 from min to max; centred runs −1 to 1, over the range or symmetric around 0', () => {
    expect(kdNorm(-4, -4, 16, 'corner', 'range')).toBe(0);
    expect(kdNorm(16, -4, 16, 'corner', 'range')).toBe(1);
    expect(kdNorm(6, -4, 16, 'corner', 'range')).toBeCloseTo(0.5);
    expect(kdNorm(-4, -4, 16, 'centred', 'range')).toBe(-1);
    expect(kdNorm(16, -4, 16, 'centred', 'range')).toBe(1);
    expect(kdNorm(6, -4, 16, 'centred', 'range')).toBeCloseTo(0);
    // Symmetric: 0 in the middle, the largest |value| at ±1.
    expect(kdNorm(0, -4, 16, 'centred', 'zero')).toBe(0);
    expect(kdNorm(16, -4, 16, 'centred', 'zero')).toBe(1);
    expect(kdNorm(-4, -4, 16, 'centred', 'zero')).toBeCloseTo(-0.25);
    // A flat axis sits in the middle (centred) or at the start (corner).
    expect(kdNorm(3, 3, 3, 'centred', 'range')).toBe(0);
    expect(kdNorm(3, 3, 3, 'corner', 'range')).toBe(0);
  });

  it('turns normalised coordinates into fractions across the frame, and finds where 0 sits for bars', () => {
    expect(kdFrac(-1, 'centred')).toBe(0);
    expect(kdFrac(0, 'centred')).toBe(0.5);
    expect(kdFrac(0.25, 'corner')).toBe(0.25);
    expect(kdZero(-5, 15, 'corner', 'range')).toBeCloseTo(0.25);
    expect(kdZero(2, 10, 'corner', 'range')).toBe(0);
    expect(kdZero(-5, 15, 'centred', 'zero')).toBeCloseTo(0.5);
  });

  it('fills the picture with a margin, or the region (centre 0..1 y up, size in picture heights)', () => {
    const l = layer();
    const f = kdFrame(l, values(l), 1000, 500, 1, false);
    expect(f.left).toBeCloseTo(40); expect(f.w).toBeCloseTo(920); expect(f.h).toBeCloseTo(420);
    const r = layer({ fit: 'region', x: 0.25, y: 0.75, w: 0.5, h: 0.4 });
    expect(kdFrame(r, values(r), 1000, 500, 1, true)).toEqual({ left: 125, top: 25, w: 250, h: 200 });
  });

  it('Same scale shrinks the frame so a unit across is a unit up', () => {
    const f = kdEqualFrame({ left: 0, top: 0, w: 200, h: 100 }, { min: -1, max: 1 }, { min: -1, max: 1 }, 'centred', 'zero');
    expect(f).toEqual({ left: 50, top: 0, w: 100, h: 100 });
  });

  it('picks round tick values', () => {
    expect(kdTicks(-4.3, 28.3, 5)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(kdTicks(-40, 90, 3)).toEqual([0, 50]);
    expect(kdTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe('views', () => {
  it('points: x and y columns over their ranges; y up; size from a column', () => {
    const t = table('x,y,s\n0,0,0\n10,5,1\n5,2.5,0.5\n');
    const l = layer({ view: 'points', xCol: 'x', yCol: 'y', sizeCol: 's', sizeMin: 2, sizeMax: 10 });
    const pts = kdPointsLayout(t, l, values(l), frame, [0, 1, 2], 1);
    expect(pts.map(p => [p.x, p.y])).toEqual([[0, 50], [100, 0], [50, 25]]);
    expect(pts.map(p => p.r)).toEqual([1, 5, 3]);
    // Centred on zero: 0,0 in the middle.
    const c = layer({ ...l, axes: 'centred', centre: 'zero' });
    expect(kdPointsLayout(t, c, values(c), frame, [0], 1)[0]).toMatchObject({ x: 50, y: 25 });
  });

  it('path: the rows in order with their length so far; Trim finds a point along it', () => {
    const t = table('x,y\n0,0\n10,0\n10,5\n');
    const l = layer({ view: 'path', xCol: 'x', yCol: 'y' });
    const p = kdPathLayout(t, l, values(l), frame, [0, 1, 2], 1);
    expect(p.length).toBeCloseTo(150);
    expect(kdPathPoint(p, 0.5)).toMatchObject({ x: 75, y: 50, i: 0 });
    expect(kdPathPoint(p, 1)).toMatchObject({ x: 100, y: 0 });
  });

  it('bars grow from 0 over the whole column (so a window keeps its scale), named by the category', () => {
    const l = layer({ view: 'bars', categoryCol: 'city', valueCol: 'temp' });
    const bars = kdBarsLayout(CITIES, l, frame, [0, 1, 2]);
    expect(bars.map(b => b.label)).toEqual(['Oslo', 'Rome', 'Cairo']);
    // temp runs −4…15, so 0 sits 4/19 up the frame; Oslo hangs below it.
    const base = 50 - (4 / 19) * 50;
    expect(bars[0].base).toBeCloseTo(base);
    expect(bars[0].y).toBeCloseTo(base);
    expect(bars[0].h).toBeCloseTo((4 / 19) * 50);
    expect(bars[2].y).toBeCloseTo(50 - 50 * (18 / 19));
    // The same rows' bars in a later window keep their heights.
    expect(kdBarsLayout(CITIES, l, frame, [3, 4, 5])[2].h).toBeCloseTo((15 / 19) * 50);
  });

  it('pie slices share the circle by |value|; lines make one series per category', () => {
    const l = layer({ view: 'pie', categoryCol: 'city', valueCol: 'temp', labels: false });
    const pie = kdPieLayout(CITIES, l, frame, [0, 1, 2]);
    expect(pie.slices.map(s => Math.round(s.share * 100))).toEqual([15, 31, 54]);
    expect(pie.slices[2].a1).toBeCloseTo(-Math.PI / 2 + Math.PI * 2);
    const lines = kdLinesLayout(CITIES, layer({ view: 'lines', categoryCol: 'city', valueCol: 'temp' }), frame, [0, 1, 2, 3, 4, 5]);
    expect(lines.map(s => [s.name, s.pts.map(p => p.row)])).toEqual([['Oslo', [0, 3]], ['Rome', [1, 4]], ['Cairo', [2, 5]]]);
    expect(lines[0].pts.map(p => p.x)).toEqual([0, 100]);
  });

  it('reads category columns as their place among the values', () => {
    expect(kdUnit(kdColumn(CITIES, 'city'), 2)).toBe(1);
    expect(kdUnit(kdColumn(CITIES, 'city'), 3)).toBe(0);
  });
});

describe('text', () => {
  const POEM = 'The sea, the sea\nkeeps light.\n\nThe END';
  it('splits by lines, a separator, words, letters or fixed-size chunks', () => {
    expect(kdSplit(POEM, 'lines')).toEqual(['The sea, the sea', 'keeps light.', 'The END']);
    expect(kdSplit('a; b;;c', 'separator', ';')).toEqual(['a', 'b', 'c']);
    expect(kdSplit('one\ntwo', 'separator', '\\n')).toEqual(['one', 'two']);
    expect(kdSplit(POEM, 'words')).toEqual(['The', 'sea,', 'the', 'sea', 'keeps', 'light.', 'The', 'END']);
    expect(kdSplit('a b', 'letters')).toEqual(['a', 'b']);
    expect(kdSplit('abcdefg', 'chunks', '', 3)).toEqual(['abc', 'def', 'g']);
  });

  it('counts words without case or the punctuation around them, and sorts by frequency or A to Z', () => {
    expect(kdKey('Sea,')).toBe('sea');
    const words = kdSplit(POEM, 'words');
    expect(kdOrder(words, 'frequency')).toEqual({ items: ['The', 'sea,', 'keeps', 'light.', 'END'], counts: [3, 2, 1, 1, 1] });
    expect(kdOrder(words, 'alphabetical').items).toEqual(['END', 'keeps', 'light.', 'sea,', 'The']);
    expect(kdOrder(words, 'text').counts).toEqual([3, 2, 3, 2, 1, 1, 3, 1]);
  });

  it('caches the chunks per result and settings, and joins a window the way it was split', () => {
    const r: DatasetResult = { kind: 'text', text: POEM };
    const l = layer({ split: 'words', order: 'text' });
    expect(kdTextItems(r, l)).toBe(kdTextItems(r, l));
    const t = kdTextItems(r, l);
    expect(kdChunkText(l, t.items, t.counts, [0, 1])).toBe('The sea,');
    expect(kdChunkText({ ...l, counts: true }, t.items, t.counts, [0, 1])).toBe('The · 3\nsea, · 2');
    expect(kdChunkText({ ...l, split: 'lines' }, ['a', 'b'], [1, 1], [0, 1])).toBe('a\nb');
  });
});

describe('stepping and actions', () => {
  it('Offset plus the actions’ steps, wrapped; Next and Previous; Go to N counts from 1', () => {
    const st = kdState();
    const l = layer();
    expect(kdCurrent(st, 2, 6)).toBe(2);
    kdAct(st, l, 2, 1, 6, { do: 'next' }, Math.random);
    expect(kdCurrent(st, 2, 6)).toBe(3);
    for (let i = 0; i < 4; i++) kdAct(st, l, 2, 1, 6, { do: 'prev' }, Math.random);
    // 3 back four: wraps round to the last row.
    expect(kdCurrent(st, 2, 6)).toBe(5);
    kdAct(st, l, 2, 1, 6, { do: 'goto', amount: 1 }, Math.random);
    expect(kdCurrent(st, 2, 6)).toBe(0);
    // Offset still moves it after an action.
    expect(kdCurrent(st, 3, 6)).toBe(1);
    kdAct(st, l, 2, 1, 6, { do: 'reset' }, Math.random);
    expect(kdCurrent(st, 2, 6)).toBe(2);
    expect(kdAct(st, l, 2, 1, 6, { do: 'toggle' }, Math.random)).toBe(false);
  });

  it('Random picks another row; a window stepping by windows pages (and Random picks another page)', () => {
    const st = kdState();
    const l = layer({ show: 'window', stepBy: 'window' });
    kdAct(st, l, 0, 3, 9, { do: 'next' }, Math.random);
    expect(kdCurrent(st, 0, 9)).toBe(3);
    kdAct(st, l, 0, 3, 9, { do: 'shuffle' }, () => 0);
    expect(kdCurrent(st, 0, 9)).toBe(0);
    const one = kdState();
    kdAct(one, layer(), 0, 1, 5, { do: 'shuffle' }, () => 0);
    expect(kdCurrent(one, 0, 5)).toBe(1);
  });

  it('shows all rows, a range (from 1, either way round) or a window wrapping round the end', () => {
    expect(kdShown(4, 'all', 1, 1, 0, 1)).toEqual([0, 1, 2, 3]);
    expect(kdShown(10, 'range', 7, 3, 0, 1)).toEqual([2, 3, 4, 5, 6]);
    expect(kdShown(5, 'window', 1, 1, 3, 3)).toEqual([3, 4, 0]);
  });

  it('crossfades from the rows that go to the ones that come when the layer fades; cuts otherwise', () => {
    const st = kdState();
    const l = layer({ show: 'window', count: 1, transition: 'fade', duration: 1 });
    const v = (off: number) => values(l, { offset: off });
    expect(kdPlan(st, l, v(0), 5, 0).sets).toEqual([{ current: 0, rows: [0], alpha: 1 }]);
    const mid = kdPlan(st, l, v(1), 5, 10);
    expect(mid.fading).toBe(true);
    expect(kdPlan(st, l, v(1), 5, 10.5).sets).toEqual([{ current: 0, rows: [0], alpha: 0.5 }, { current: 1, rows: [1], alpha: 0.5 }]);
    expect(kdPlan(st, l, v(1), 5, 11.2).sets).toEqual([{ current: 1, rows: [1], alpha: 1 }]);
    const cut = kdState(), lc = { ...l, transition: 'cut' as const };
    kdPlan(cut, lc, v(0), 5, 0);
    expect(kdPlan(cut, lc, v(2), 5, 1).sets.length).toBe(1);
    // Show all: stepping moves the current row, but what shows doesn't change, so nothing fades.
    const all = kdState(), la = { ...l, show: 'all' as const };
    kdPlan(all, la, v(0), 5, 0);
    expect(kdPlan(all, la, v(3), 5, 1)).toMatchObject({ current: 3, fading: false });
  });

  it('offers Next, Previous, Random and Go to row as actions, with their own labels', () => {
    const l = layer();
    expect(actionsForLayer(l)).toEqual(['next', 'prev', 'shuffle', 'goto', 'reset', 'toggle', 'show', 'hide']);
    expect(actionLabel('next', l)).toBe('Next row');
    expect(actionLabel('goto', l)).toBe('Go to row');
  });
});

describe('the layer in a file', () => {
  it('round-trips through the schema, dropping bad values', () => {
    const l = parseLayer({ ...layer({ view: 'bars', valueCol: 'temp', show: 'window', count: 5 }), view: 'donut', count: -3, extra: 1 }) as DataLayer;
    expect(l.kind).toBe('data');
    expect(l.view).toBe('points');
    expect(l.count).toBe(1);
    expect(l.valueCol).toBe('temp');
    expect((l as unknown as Record<string, unknown>).extra).toBeUndefined();
    const rec = parsePlayRecord({ version: 1, controls: [{ id: 'c', target: 'glow::brightness', kind: 'float', label: 'Glow', min: 0, max: 1 }], mappings: [{ id: 'm', controlId: 'c', source: { kind: 'data', dataset: 'temps', column: 'temp' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }], layers: [l] });
    expect(rec.mappings[0]?.source).toEqual({ kind: 'data', dataset: 'temps', column: 'temp', layerId: '' });
  });
});

// ── With datasets in the store ─────────────────────────────────────────────

const ds = (id: string, name: string, result: DatasetResult | null, normalize = false): Dataset => ({ id, name, source: { kind: 'file', format: 'csv', filename: `${id}.csv`, text: 'secret,source\n1,2\n' }, cells: [{ id: 'c1', code: '// a notebook\ndf' }], normalize, result });

afterEach(() => { datasetStore.sync({}); });

describe('datasets for the layer, sliders and s.data()', () => {
  it('finds a dataset by id or name, sizes the Offset slider by its rows (or chunks), and suggests columns', () => {
    datasetStore.sync({ temps: ds('temps', 'City temps', CITIES), poem: ds('poem', 'Poem', { kind: 'text', text: 'a b c d' }) });
    expect(findDataset('city temps')?.id).toBe('temps');
    expect(kitDataset('temps')?.name).toBe('City temps');
    expect(dataItemCount(layer({ dataset: 'temps' }))).toBe(6);
    expect(dataItemCount(layer({ dataset: 'poem', split: 'words' }))).toBe(4);
    expect(layerNumericProps(layer({ dataset: 'temps' })).find(d => d.key === 'offset')?.max).toBe(5);
    expect(suggestDataColumns(CITIES, layer())).toEqual({ xCol: 'temp', yCol: 'month', categoryCol: 'city', valueCol: 'temp' });
  });

  it('s.data() returns rows, columns, col(), min(), max() (and text chunks, JSON values)', () => {
    const v = kdScriptView({ id: 'temps', name: 'City temps', result: CITIES }, null);
    expect(v.columns).toEqual(['city', 'month', 'temp']);
    expect(v.rows[1]).toEqual({ city: 'Rome', month: 1, temp: 8 });
    expect(v.length).toBe(6);
    expect(v.col('temp')).toEqual([-4, 8, 14, -2, 9, 15]);
    expect([v.min('temp'), v.max('temp')]).toEqual([-4, 15]);
    expect(kdScriptView({ id: 'temps', name: 'City temps', result: CITIES }, null)).toBe(v);
    const t = kdScriptView({ id: 'p', name: 'P', result: { kind: 'text', text: 'one\ntwo' } }, null);
    expect(t.rows).toEqual(['one', 'two']);
    expect(t.col('text')).toEqual(['one', 'two']);
    expect(kdScriptView({ id: 'j', name: 'J', result: { kind: 'json', value: { a: 1 } } }, null).value).toEqual({ a: 1 });
  });
});

describe('the layer kit draws it and reports where it is', () => {
  // A canvas that draws nothing: enough for the kit to run a frame without a DOM.
  const fakeCtx = () => new Proxy({ measureText: (t: string) => ({ width: String(t).length * 8 }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : k === 'canvas' ? {} : () => undefined), set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const run = (rec: PlayRecord, frames: number, act?: (kit: ReturnType<typeof createLayerKit>, f: number) => void) => {
    const g = globalThis as unknown as { document?: unknown };
    const had = g.document;
    g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }) };
    const kit = createLayerKit();
    const sensors = new Map<string, number>();
    const env = {
      gl: {} as HTMLCanvasElement, W: 1000, H: 500, dpr: 1, time: 0, dt: 1 / 60, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0] as [number, number, number],
      value: (l: unknown, k: string) => (l as Record<string, number>)[k], pointer: { x: 0.5, y: 0.5, over: false, down: false },
      audio: null, camera: null, image: () => null, sensor: (k: string, v: number) => sensors.set(k, v), override: () => {},
      data: (ref: string) => kitDataset(ref),
    };
    try {
      for (let f = 0; f < frames; f++) { act?.(kit, f); kit.frame(fakeCtx(), rec, { ...env, time: f / 60 }); }
    } finally { g.document = had; }
    return sensors;
  };

  it('steps with actions, reports the current row, and hands it to s.data() in a sketch', () => {
    datasetStore.sync({ temps: ds('temps', 'City temps', CITIES) });
    const rec = emptyPlayRecord();
    const script = { ...defaultLayer('script', 'sk', 'Sketch'), code: "function draw(s) { const d = s.data('City temps'); s.anchor = { x: d.index * 100, y: d.length * 10 + (d.current.temp === 14 ? 1 : 0) }; }", paramDefs: [] };
    rec.layers = [layer({ id: 'bars', dataset: 'temps', view: 'bars', categoryCol: 'city', valueCol: 'temp', show: 'window', count: 3, stepBy: 'window' }), script as never];
    const sensors = run(rec, 4, (kit, f) => { if (f === 1) kit.act({ do: 'next', layerId: 'bars', amount: 1 }); if (f === 2) kit.act({ do: 'goto', layerId: 'bars', amount: 3 }); });
    expect(sensors.get('bars::row')).toBe(2);
    expect(sensors.get('bars::rows')).toBe(6);
    expect(sensors.get('ds:temps::row')).toBe(2);
    // The sketch read index 2 and row 3 (Cairo, 14°) of the six.
    expect(sensors.get('sk::ax')).toBeCloseTo(0.2);
    expect(sensors.get('sk::ay')).toBeCloseTo(1 - 61 / 500);
    // The bar layer's anchor: the current bar's top.
    expect(sensors.get('bars::ax')).toBeGreaterThan(0);
  });

  it('draws a text dataset a chunk at a time', () => {
    datasetStore.sync({ poem: ds('poem', 'Poem', { kind: 'text', text: 'sea light keeps' }) });
    const rec = emptyPlayRecord();
    rec.layers = [layer({ id: 'w', dataset: 'poem', split: 'words', show: 'window', count: 1, transition: 'cut' })];
    const sensors = run(rec, 3, (kit, f) => { if (f === 1) kit.act({ do: 'prev', layerId: 'w', amount: 1 }); });
    expect(sensors.get('w::rows')).toBe(3);
    expect(sensors.get('w::row')).toBe(2);
    expect(sensors.get('w::ax')).toBeCloseTo(0.5);
  });
});

describe('the data mapping source', () => {
  it('reads the current row’s column 0..1 and follows the dataset when it changes', () => {
    datasetStore.sync({ temps: ds('temps', 'City temps', CITIES) });
    const sensors = new Map<string, number>([['ds:temps::row', 2], ['ds:temps::rows', 6]]);
    const read = (column: string, layerId = '') => readDataSource({ kind: 'data', dataset: 'temps', column, layerId }, k => sensors.get(k));
    expect(read('temp')).toBeCloseTo(18 / 19);
    expect(read('#row')).toBeCloseTo(0.4);
    let woke = 0;
    const off = inputBus.onWake(() => { woke++; });
    // A live replacement (a stream, a new notebook run): the same row reads the new value, and the frame loop wakes.
    datasetStore.replaceResult('temps', table('city,month,temp\nA,1,0\nB,1,10\nC,1,5\n'));
    expect(read('temp')).toBeCloseTo(0.5);
    expect(woke).toBeGreaterThan(0);
    off();
    // A Data layer's own row.
    sensors.set('bars::row', 1);
    expect(read('temp', 'bars')).toBeCloseTo(1);
    expect(dataSourceValue(null, 'temp', 0)).toBeNull();
    expect(sourceLabel({ kind: 'data', dataset: 'temps', column: 'temp', layerId: '' })).toBe('Data · City temps · current · temp');
  });
});

describe('exports and Present carry the frozen results', () => {
  const datasets: DatasetsRecord = {
    temps: ds('temps', 'City temps', CITIES, true),
    unused: ds('unused', 'Unused', CITIES),
    named: ds('named', 'Sales', CITIES),
    notrun: ds('notrun', 'Not run', null),
  };
  const play: PlayRecord = { ...emptyPlayRecord(), layers: [layer({ dataset: 'temps' }), layer({ id: 'd2', dataset: 'notrun' }), { ...defaultLayer('script', 's', 'S'), code: "const d = s.data('Sales');" } as never] };
  const fs = 'uniform sampler2D u_ds_unused_abc; // data-columns unused temp\nuniform float u_ds_unused_n; // data-count unused\nvoid main(){}';

  it('carries the datasets something reads: a Data layer, a Data node, a sketch naming it', () => {
    expect(datasetsUsed(datasets, play, [fs])).toEqual(['named', 'notrun', 'temps', 'unused']);
    expect(datasetsUsed(datasets, play, [])).toEqual(['named', 'notrun', 'temps']);
  });

  it('puts results (Normalize applied) and names in the bundle, never the notebook or the file', () => {
    const compiled: CompiledForWeb = { fragmentShader: fs, paramUniforms: {}, paramBindings: {}, textureUniforms: {}, videoUniforms: {}, audioUniforms: {}, liveUniforms: {}, isStateful: false };
    const { input, missing } = webInputFrom(compiled, play, { title: 'T', aspect: 'free', datasets });
    expect(missing).toEqual([]);
    expect(Object.keys(input.datasets ?? {}).sort()).toEqual(['named', 'notrun', 'temps', 'unused']);
    const temps = input.datasets!.temps.result as TableResult;
    expect(temps.columns.find(c => c.name === 'temp')).toMatchObject({ min: 0, max: 1 });
    const bundle = playBundle(input) as { datasets?: Record<string, unknown> };
    expect(Object.keys(bundle.datasets ?? {})).toContain('temps');
    const html = buildPlayHtml(input);
    expect(html).toContain('"City temps"');
    expect(html).not.toContain('secret,source');
    expect(html).not.toContain('// a notebook');
    expect(html).toContain('function kdPlan');
    // What the dialogs list: no "Data node values" any more; the notebooks, and a dataset never run.
    expect(unsupportedFeatures({ liveUniforms: {}, usesData: true })).toEqual([]);
    const left = leftBehind(input.play, input.media, { datasets: input.datasets }).map(x => x.what);
    expect(left).toContain('The dataset “Not run”');
    expect(left).toContain('The notebooks and files of 4 datasets');
    expect(mediaCarried(undefined, undefined, input.play, input.datasets).map(x => x.what)).toContain('Dataset “City temps” (its result)');
    expect(datasetsForWeb(datasets, { ...emptyPlayRecord() }, [])).toEqual({});
  });
});

describe('the Script reference', () => {
  it('documents s.data in 2D and 3D sketches', () => {
    expect(SCRIPT_REFERENCE.flatMap(g => g.items).some(it => it.name === 's.data')).toBe(true);
    expect(referenceFor('3d').flatMap(g => g.items).some(it => it.name === 's.data')).toBe(true);
  });
});
