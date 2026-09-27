/**
 * Live datasets: messages → rows, the rolling window, reconnect backoff,
 * the stream runtime feeding readers without a rebuild, takes recording and
 * replaying streamed rows, and the website export plan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { csvLinesToRows, flatRows, jsonToRows, messageToRows, newLineState, oscMatches, oscToRow } from '../streams/messages';
import { applyRows, csvToTable, emptyTable, tableToCsv, trimTable } from '../streams/window';
import { backoffDelay, demoRow, RateMeter } from '../streams/backoff';
import { isPassThrough, sourceChange, streamHub, type StreamSource } from '../streams/streamHub';
import { DataFeedCapture, DataFeedPlayer, feedTableAt } from '../streams/takeData';
import { parseTakeDataFeeds } from '../streams/takeDataTypes';
import { streamExportPlan } from '../streams/exportPlan';
import { datasetStore } from '../datasetStore';
import { datasetFromStream } from '../datasetActions';
import { parseDatasetsRecord, type Dataset, type TableResult } from '../types';

const col = (t: TableResult, name: string) => t.columns.find(c => c.name === name)?.values;

describe('messages → rows', () => {
  it('JSON: an object, an array of objects, a wrapped list, numbers; nested objects flattened', () => {
    expect(jsonToRows({ t: 1, pos: { x: 0.5, y: 0.25 } })).toEqual([{ t: 1, 'pos.x': 0.5, 'pos.y': 0.25 }]);
    expect(jsonToRows([{ a: 1 }, { a: 2 }, 'skip'])).toEqual([{ a: 1 }, { a: 2 }]);
    expect(jsonToRows({ status: 'ok', rows: [{ a: 1 }, { a: 2 }] })).toEqual([{ a: 1 }, { a: 2 }]);
    expect(jsonToRows({ meta: 1, readings: [{ v: 3 }] })).toEqual([{ v: 3 }]);
    expect(jsonToRows({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { mag: 4.2 } }] })).toEqual([{ mag: 4.2 }]);
    expect(jsonToRows([0.1, 0.2, 0.3])).toEqual([{ c1: 0.1, c2: 0.2, c3: 0.3 }]);
    expect(jsonToRows(7)).toEqual([{ value: 7 }]);
  });

  it('text messages: JSON when it parses, ndjson, else CSV lines with a header remembered', () => {
    const st = newLineState();
    expect(messageToRows('{"a":1}', st).rows).toEqual([{ a: 1 }]);
    expect(messageToRows('{"a":1}\n{"a":2}', st).rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect(messageToRows('x,y,label', st).rows).toEqual([]);
    expect(st.header).toEqual(['x', 'y', 'label']);
    expect(messageToRows('1,2,up\n3,4,down', st).rows).toEqual([{ x: 1, y: 2, label: 'up' }, { x: 3, y: 4, label: 'down' }]);
    // A polled CSV repeats its header each time: skipped.
    expect(messageToRows('x,y,label\n5,6,up', st).rows).toEqual([{ x: 5, y: 6, label: 'up' }]);
    // No header seen: c1, c2…
    expect(csvLinesToRows('1;2', newLineState())).toEqual([{ c1: 1, c2: 2 }]);
    expect(messageToRows('a\nb', newLineState(), 'text').rows).toEqual([{ text: 'a' }, { text: 'b' }]);
    expect(messageToRows('nope{', newLineState(), 'json').error).toMatch(/wasn’t JSON/);
    expect(messageToRows('  ', newLineState()).rows).toEqual([]);
    expect(messageToRows([{ ready: 1 }], newLineState()).rows).toEqual([{ ready: 1 }]); // already parsed (the demo, OSC)
  });

  it('OSC: address, value, value2…; address filters', () => {
    expect(oscToRow('/accel', [0.1, 0.2, true])).toEqual({ address: '/accel', value: 0.1, value2: 0.2, value3: true });
    expect(oscMatches('', '/a')).toBe(true);
    expect(oscMatches('/*', '/a/b')).toBe(true);
    expect(oscMatches('/sensor/*', '/sensor/x')).toBe(true);
    expect(oscMatches('/sensor', '/sensor/x')).toBe(true);
    expect(oscMatches('/sensor', '/sensors')).toBe(false);
    expect(oscMatches('/a/b', '/a/b')).toBe(true);
  });

  it('nested values become their JSON text', () => {
    expect(flatRows([{ a: 1, b: [1, 2], c: { d: 1 } }])).toEqual([{ a: 1, b: '[1,2]', c: '{"d":1}' }]);
  });
});

describe('the rolling window', () => {
  it('appends and keeps the newest N rows; replace swaps the table', () => {
    let t = emptyTable();
    t = applyRows(t, [{ v: 1 }, { v: 2 }], 'append', 3);
    t = applyRows(t, [{ v: 3 }, { v: 4, w: 'x' }], 'append', 3);
    expect(t.rows).toBe(3);
    expect(col(t, 'v')).toEqual([2, 3, 4]);
    expect(col(t, 'w')).toEqual([null, null, 'x']);
    const v = t.columns.find(c => c.name === 'v');
    expect(v?.type === 'number' && [v.min, v.max]).toEqual([2, 4]);
    t = applyRows(t, [{ z: 9 }], 'replace', 3);
    expect(t.rows).toBe(1);
    expect(t.columns.map(c => c.name)).toEqual(['z']);
    expect(applyRows(t, [], 'replace', 3)).toBe(t); // an empty message changes nothing
    expect(trimTable(applyRows(emptyTable(), [{ a: 1 }, { a: 2 }, { a: 3 }], 'append', 10), 2).rows).toBe(2);
  });

  it('is saved as CSV and read back', () => {
    const t = applyRows(emptyTable(), [{ x: 1, name: 'a, b' }, { x: 2.5, name: 'c' }], 'append', 10);
    const csv = tableToCsv(t);
    expect(csv).toBe('x,name\n1,"a, b"\n2.5,c\n');
    const back = csvToTable(csv);
    expect(back.rows).toBe(2);
    expect(col(back, 'x')).toEqual([1, 2.5]);
    expect(csvToTable('').rows).toBe(0);
  });
});

describe('reconnecting', () => {
  it('backs off exponentially up to a cap, with jitter', () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 6].map(a => backoffDelay(a, { rand: mid }))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(backoffDelay(0, { rand: () => 0 })).toBe(800);
    expect(backoffDelay(0, { rand: () => 1 })).toBe(1200);
    expect(backoffDelay(10, { rand: () => 1 })).toBe(30000);
    expect(backoffDelay(1, { base: 500, max: 5000, jitter: 0, rand: mid })).toBe(1000);
  });

  it('measures rows per second over the last few seconds', () => {
    const m = new RateMeter(5000);
    m.add(0, 10);
    m.add(1000, 10);
    expect(m.rate(1000)).toBeCloseTo(10, 5);
    expect(m.rate(20_000)).toBe(0);
  });
});

describe('the stream runtime', () => {
  const put = (d: Dataset) => { const next = { ...datasetStore.all(), [d.id]: d }; datasetStore.sync(next); };
  beforeEach(() => { vi.useFakeTimers(); datasetStore.sync({}); });
  afterEach(() => { for (const id of Object.keys(datasetStore.all())) streamHub.drop(id); datasetStore.sync({}); vi.useRealTimers(); });

  it('the demo feed fills a window that readers see without a rebuild, and stops on disconnect', () => {
    const d = datasetFromStream('demo', []);
    expect(d.source).toMatchObject({ kind: 'stream', transport: 'demo', autoConnect: true, mode: 'append' });
    const seen: number[] = [];
    const off = datasetStore.subscribe(d.id, () => { const r = datasetStore.result(d.id); if (r?.kind === 'table') seen.push(r.rows); });
    put(d); // auto-connect
    vi.advanceTimersByTime(1050);
    expect(streamHub.status(d.id).state).toBe('live');
    const r = datasetStore.result(d.id);
    expect(r?.kind).toBe('table');
    if (r?.kind !== 'table') return;
    expect(r.rows).toBeGreaterThanOrEqual(9);
    expect(r.columns.map(c => c.name)).toEqual(['t', 'x', 'y', 'level', 'kind']);
    expect(seen.length).toBeGreaterThan(1);
    vi.advanceTimersByTime(30_000);
    expect((datasetStore.result(d.id) as TableResult).rows).toBe(200); // the window
    streamHub.pause(d.id);
    const before = streamHub.window(d.id)!.rows;
    vi.advanceTimersByTime(2000);
    expect(streamHub.window(d.id)!.rows).toBe(before);
    streamHub.disconnect(d.id);
    expect(streamHub.status(d.id).state).toBe('off');
    off();
  });

  it('a WebSocket that drops reconnects with backoff; rows go through the notebook', async () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      onopen: (() => void) | null = null; onmessage: ((e: { data: unknown }) => void) | null = null; onclose: ((e: { reason: string }) => void) | null = null; onerror: (() => void) | null = null;
      url: string;
      constructor(url: string) { this.url = url; sockets.push(this); }
      close() { /* closed */ }
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    try {
      const d: Dataset = { ...datasetFromStream('websocket', [], { address: 'wss://feed.example/x' }), cells: [{ id: 'c', code: 'df.assign({ double: r => r.v * 2 })' }] };
      put(d);
      streamHub.connect(d.id);
      expect(sockets).toHaveLength(1);
      expect(streamHub.status(d.id).state).toBe('connecting');
      sockets[0].onopen!();
      expect(streamHub.status(d.id).state).toBe('live');
      sockets[0].onmessage!({ data: '{"v": 2}' });
      // The notebook runs in place here (no workers in tests).
      await vi.waitFor(() => expect(col(datasetStore.result(d.id) as TableResult, 'double')).toEqual([4]));
      sockets[0].onclose!({ reason: '' });
      expect(streamHub.status(d.id).state).toBe('retrying');
      expect(streamHub.status(d.id).error).toMatch(/closed/);
      vi.advanceTimersByTime(1300);
      expect(sockets).toHaveLength(2);
      sockets[1].onopen!();
      sockets[1].onmessage!({ data: '[{"v": 3}, {"v": 4}]' });
      await vi.waitFor(() => expect(col(datasetStore.result(d.id) as TableResult, 'double')).toEqual([4, 6, 8]));
    } finally { vi.unstubAllGlobals(); }
  });

  it('knows when a notebook only shows the data, and what a source change needs', () => {
    expect(isPassThrough([{ id: 'a', code: 'df' }, { id: 'b', code: '// just look\n' }])).toBe(true);
    expect(isPassThrough([{ id: 'a', code: 'df.head(3)' }])).toBe(false);
    const s = datasetFromStream('poll', [], { address: 'https://x.org/a.json' }).source as StreamSource;
    expect(sourceChange(s, { ...s, text: 'a\n1\n' })).toBe('same');
    expect(sourceChange(s, { ...s, window: 10 })).toBe('settings');
    expect(sourceChange(s, { ...s, interval: 30 })).toBe('reconnect');
    expect(sourceChange(s, { ...s, address: 'https://x.org/b.json' })).toBe('reconnect');
  });

  it('stream settings are saved and checked on load', () => {
    const parsed = parseDatasetsRecord({
      live: { name: 'L', source: { kind: 'stream', transport: 'demo', address: 'demo', window: 50, mode: 'replace', interval: 99, autoConnect: true, onExport: 'freeze', text: 'a\n1\n' }, cells: [], result: null },
      bad: { name: 'B', source: { kind: 'stream', transport: 'carrier-pigeon', address: 'x', window: 5 }, cells: [], result: null },
    });
    expect(parsed.live.source).toEqual({ kind: 'stream', transport: 'demo', address: 'demo', window: 50, mode: 'replace', interval: 99, autoConnect: true, onExport: 'freeze', text: 'a\n1\n' });
    expect(parsed.bad).toBeUndefined();
  });
});

describe('takes with streamed rows', () => {
  type Listener = Parameters<ConstructorParameters<typeof DataFeedCapture>[0]>[0];
  const src = (mode: 'append' | 'replace' = 'append', window = 3) => ({ ...(datasetFromStream('websocket', []).source as StreamSource), mode, window });

  it('records rows with the frame they arrived before, from the window at the start', () => {
    let emit: Listener = () => {};
    const cap = new DataFeedCapture(fn => { emit = fn; return () => {}; });
    const start = applyRows(emptyTable(), [{ v: 0 }], 'append', 3);
    cap.sample(10);
    emit('live', [{ v: 1 }], src(), start);
    cap.sample(10.5);
    emit('live', [{ v: 2 }, { v: 3, w: 'x' }], src(), start);
    cap.sample(11);
    cap.sample(12);
    const feeds = cap.toFeeds(10, 2);
    expect(feeds).toHaveLength(1);
    const f = feeds[0];
    expect(f).toMatchObject({ dataset: 'live', mode: 'append', window: 3, columns: ['v', 'w'] });
    expect(f.start).toEqual([[0, null]]);
    expect(f.batches).toEqual([{ t: 0.5, rows: [[1, null]] }, { t: 1, rows: [[2, null], [3, 'x']] }]);
    // What readers would see at each moment.
    expect(col(feedTableAt(f, 0), 'v')).toEqual([0]);
    expect(col(feedTableAt(f, 0.7), 'v')).toEqual([0, 1]);
    expect(col(feedTableAt(f, 2), 'v')).toEqual([1, 2, 3]);
    // It survives saving.
    expect(parseTakeDataFeeds(JSON.parse(JSON.stringify(feeds)), 2)).toEqual(feeds);
  });

  it('a take from the middle of a recording starts from the window at that point (the rolling buffer)', () => {
    let emit: Listener = () => {};
    const cap = new DataFeedCapture(fn => { emit = fn; return () => {}; });
    for (let i = 0; i < 6; i++) { emit('live', [{ v: i }], src('append', 3), emptyTable()); cap.sample(i); }
    cap.trim(2); // the rolling buffer drops what's before clock 2
    const [f] = cap.toFeeds(3, 2);
    // Rows 0 and 1 were folded in by the trim, row 2 comes before the take: the window of 3 at clock 3.
    expect(f.start).toEqual([[0], [1], [2]]);
    expect(f.batches).toEqual([{ t: 0, rows: [[3]] }, { t: 1, rows: [[4]] }, { t: 2, rows: [[5]] }]);
  });

  it('replay feeds the recorded rows as the clock moves, forward and back', () => {
    const feeds = parseTakeDataFeeds([{ dataset: 'live', mode: 'replace', window: 10, columns: ['v'], start: [[0]], batches: [{ t: 1, rows: [[1]] }, { t: 2, rows: [[2]] }] }], 3);
    const puts: Array<number[]> = [];
    const player = new DataFeedPlayer(feeds, (_id, t) => puts.push(col(t, 'v') as number[]));
    expect(player.active).toBe(true);
    player.apply(0);
    player.apply(0.5); // nothing new: no put
    player.apply(1.2);
    player.apply(2.5);
    player.apply(0.2); // scrubbed back
    expect(puts).toEqual([[0], [1], [2], [0]]);
    expect(new DataFeedPlayer([], () => {}).active).toBe(false);
  });

  it('muting the hub (replay) stops live rows reaching readers; unmuting shows the live window again', () => {
    vi.useFakeTimers();
    try {
      datasetStore.sync({});
      const d = datasetFromStream('demo', []);
      datasetStore.sync({ [d.id]: d });
      vi.advanceTimersByTime(500);
      streamHub.setMuted(true);
      streamHub.feed(d.id, applyRows(emptyTable(), [{ recorded: 1 }], 'append', 5));
      vi.advanceTimersByTime(1000);
      expect((datasetStore.result(d.id) as TableResult).columns.map(c => c.name)).toEqual(['recorded']);
      streamHub.setMuted(false);
      expect((datasetStore.result(d.id) as TableResult).columns.map(c => c.name)).toContain('level');
      streamHub.drop(d.id);
      datasetStore.sync({});
    } finally { vi.useRealTimers(); }
  });

  it('drops malformed feeds on load', () => {
    expect(parseTakeDataFeeds([{ dataset: 'Bad Id', columns: [], start: [], batches: [] }, { dataset: 'ok', columns: ['a'], start: [[1, 2]], batches: [{ t: 99, rows: [[1]] }, { t: 1, rows: [[{ nested: 1 }]] }] }], 5))
      .toEqual([{ dataset: 'ok', mode: 'append', window: 1000, columns: ['a'], start: [], batches: [{ t: 1, rows: [[null]] }] }]);
    expect(parseTakeDataFeeds('nope', 5)).toEqual([]);
  });
});

describe('website export', () => {
  const table = applyRows(emptyTable(), [{ v: 1 }, { v: 2 }], 'append', 10);
  const make = (patch: Partial<StreamSource>): Dataset => {
    const d = datasetFromStream('websocket', [], { address: 'wss://feed.example/x', name: 'Feed' });
    return { ...d, source: { ...(d.source as StreamSource), ...patch } };
  };

  it('freezes the last window, or reconnects (needs the network)', () => {
    const frozen = streamExportPlan(make({ onExport: 'freeze' }), table)!;
    expect(frozen.connect).toBeUndefined();
    expect(frozen.result).toBe(table);
    expect(frozen.note.what).toBe('“Feed” is frozen at its last 2 rows');
    const again = streamExportPlan(make({ onExport: 'reconnect' }), table)!;
    expect(again.connect).toEqual({ transport: 'websocket', address: 'wss://feed.example/x', interval: 5, mode: 'append', window: 500 });
    expect(again.note.why).toMatch(/Needs the network/);
  });

  it('OSC and the demo can’t reconnect from a page: frozen, and it says why', () => {
    const osc = streamExportPlan(make({ transport: 'osc', onExport: 'reconnect' }), table)!;
    expect(osc.connect).toBeUndefined();
    expect(osc.note.why).toMatch(/bridge/);
    expect(streamExportPlan(make({ transport: 'demo', onExport: 'reconnect' }), null)!.note.why).toMatch(/inside the app/);
    expect(streamExportPlan({ ...make({}), source: { kind: 'manual', columns: [], rows: [] } }, null)).toBeNull();
  });
});

describe('the demo feed', () => {
  it('is the same every time (takes replay it the same)', () => {
    expect(demoRow(12, 10)).toEqual(demoRow(12, 10));
    const r = demoRow(0, 10);
    expect(Object.keys(r)).toEqual(['t', 'x', 'y', 'level', 'kind']);
    expect(['calm', 'busy', 'peak']).toContain(r.kind);
  });
});
