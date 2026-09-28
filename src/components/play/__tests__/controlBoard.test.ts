/**
 * The Controls board's pieces: the trace buffer (a ring of recent values with
 * the lowest and highest seen), the shared sampler loop (runs only while
 * something draws), and grouping controls by where they come from. And the
 * Mappings workspace's grouping by source.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});
import { TraceBuffer, addTraceDrawer, normalise, sampleTraces, setTraceSource, traceBuffer, traceLoopState } from '../controlTrace';
import { boardGroupList, controlOrigin, groupControls, isMapped } from '../controlGroups';
import { groupCounts, groupMappings, mappingGroupOf } from '../mappingGroups';
import { emptyPlayRecord, type PlayControl, type PlayMapping, type PlayRecord } from '../../../types/play';
import { defaultLayer } from '../../../types/playLayers';

describe('trace buffer', () => {
  it('keeps the last N samples, oldest first', () => {
    const b = new TraceBuffer(4);
    expect(b.length).toBe(0);
    expect(b.last()).toBeNaN();
    for (const v of [1, 2, 3]) b.push(v);
    expect([b.at(0), b.at(1), b.at(2)]).toEqual([1, 2, 3]);
    for (const v of [4, 5, 6]) b.push(v);
    expect(b.length).toBe(4);
    expect([0, 1, 2, 3].map(i => b.at(i))).toEqual([3, 4, 5, 6]);
    expect(b.last()).toBe(6);
    expect(b.at(4)).toBeNaN();
    expect(b.at(-1)).toBeNaN();
  });

  it('knows the range in the window and everything seen since a reset', () => {
    const b = new TraceBuffer(3);
    for (const v of [-2, 9, 1, 2, 3]) b.push(v);
    expect(b.windowRange()).toEqual([1, 3]);
    expect(b.seenRange()).toEqual([-2, 9]);
    expect([b.seenMin, b.seenMax]).toEqual([-2, 9]);
    b.resetSeen();
    expect(b.seenRange()).toEqual([NaN, NaN]);
    b.push(4);
    expect(b.seenRange()).toEqual([4, 4]);
    b.clear();
    expect(b.length).toBe(0);
    expect(b.windowRange()).toEqual([NaN, NaN]);
  });

  it('holds several channels (a pair, a colour), and turns junk into 0', () => {
    const b = new TraceBuffer(2, 3);
    b.push([0.1, 0.2, 0.3]);
    b.push([1, NaN, Infinity]);
    expect([b.last(0), b.last(1), b.last(2)]).toEqual([1, 0, 0]);
    expect(b.at(0, 2)).toBeCloseTo(0.3);
    expect(b.seenRange(2)).toEqual([0, expect.closeTo(0.3)]);
    const one = new TraceBuffer(2, 2);
    one.push(5);
    expect([one.last(0), one.last(1)]).toEqual([5, 0]);
  });

  it('normalises into 0..1', () => {
    expect(normalise(5, 0, 10)).toBe(0.5);
    expect(normalise(-5, 0, 10)).toBe(0);
    expect(normalise(50, 0, 10)).toBe(1);
    expect(normalise(3, 2, 2)).toBe(0.5);
    expect(normalise(NaN, 0, 1)).toBe(0);
  });
});

describe('the shared sampler', () => {
  afterEach(() => setTraceSource(null));

  it('samples its source into each trace’s buffer', () => {
    let v = 0;
    setTraceSource(() => [['t:a', ++v, 1], ['t:xy', [v, -v], 2]]);
    sampleTraces();
    sampleTraces();
    expect(traceBuffer('t:a').length).toBe(2);
    expect(traceBuffer('t:a').last()).toBe(2);
    expect(traceBuffer('t:xy', 2).last(1)).toBe(-2);
  });

  it('runs only while something draws', () => {
    const raf = vi.fn(() => 7);
    const caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
    expect(traceLoopState()).toEqual({ drawers: 0, running: false });
    const stopA = addTraceDrawer(() => {});
    const stopB = addTraceDrawer(() => {});
    expect(raf).toHaveBeenCalledTimes(1);
    expect(traceLoopState()).toEqual({ drawers: 2, running: true });
    stopA();
    expect(traceLoopState().running).toBe(true);
    stopB();
    expect(caf).toHaveBeenCalledWith(7);
    expect(traceLoopState()).toEqual({ drawers: 0, running: false });
    vi.unstubAllGlobals();
  });
});

function boardPlay(): PlayRecord {
  const box = defaultLayer('shape', 'l1', 'Box');
  const c = (id: string, target: string, extra: Partial<PlayControl> = {}): PlayControl => ({ id, target, kind: 'float', label: id, min: 0, max: 1, ...extra });
  return {
    ...emptyPlayRecord(),
    layers: [box],
    audioEngine: { racks: [{ id: 'rk1', name: 'Rack 1', instrument: { id: 'inst', kind: 'sampler', params: {}, bypass: false }, effects: [], keyboard: false, midi: '', channel: 0, volume: 1 }] } as unknown as PlayRecord['audioEngine'],
    controls: [
      c('speed', 'n1::speed'),
      c('boxX', 'layer:l1::x'),
      c('cutoff', 'au:rk1:inst::1'),
      c('boxBurst', 'act:l1::burst', { kind: 'action' }),
      c('level', 'reader:r1::level', { group: 'Audio readers · Live' }),
      c('tint', 'n1::tint', { kind: 'color' }),
      c('mine', 'n1::zoom', { group: 'Camera' }),
      c('px', 'n1::px'),
      c('py', 'n1::py'),
    ],
    pairs: [{ id: 'p1', label: 'Point', a: 'px', b: 'py', position: true }],
    mappings: [{ id: 'm1', controlId: 'speed', source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    pairMappings: [{ id: 'pm1', pairId: 'p1' } as unknown as NonNullable<PlayRecord['pairMappings']>[number]],
  };
}

describe('the board’s groups', () => {
  it('puts each control under where it comes from', () => {
    const play = boardPlay();
    const origin = (id: string) => controlOrigin(play.controls.find(c => c.id === id)!, play);
    expect(origin('speed')).toEqual({ id: 'graph', label: 'Controls', kind: 'graph' });
    expect(origin('boxX')).toEqual({ id: 'layer:l1', label: 'Box', kind: 'layer' });
    expect(origin('boxBurst').id).toBe('layer:l1');
    expect(origin('cutoff')).toEqual({ id: 'rack:rk1', label: 'Rack 1 · Sample player', kind: 'rack' });
    expect(origin('level')).toEqual({ id: 'group:Audio readers · Live', label: 'Audio readers · Live', kind: 'readers' });
    expect(origin('mine')).toEqual({ id: 'group:Camera', label: 'Camera', kind: 'group' });
  });

  it('keeps the panel’s order, and shows a pair once', () => {
    const groups = groupControls(boardPlay());
    expect(groups.map(g => g.origin.id)).toEqual(['graph', 'layer:l1', 'rack:rk1', 'group:Audio readers · Live', 'group:Camera']);
    expect(groups[0].items.map(i => i.control.id)).toEqual(['speed', 'tint', 'px']);
    expect(groups[1].items.map(i => i.index)).toEqual([1, 3]);
    expect(boardGroupList(boardPlay()).find(g => g.id === 'graph')?.count).toBe(3);
  });

  it('filters by search, group, mapped and kind', () => {
    const play = boardPlay();
    const ids = (f: Parameters<typeof groupControls>[1]) => groupControls(play, f).flatMap(g => g.items.map(i => i.control.id));
    expect(ids({ query: 'box' })).toEqual(['boxX', 'boxBurst']);
    expect(ids({ query: 'PY' })).toEqual(['px']);
    expect(ids({ group: 'layer:l1' })).toEqual(['boxX', 'boxBurst']);
    expect(ids({ mapped: 'mapped' })).toEqual(['speed', 'px']);
    expect(ids({ mapped: 'unmapped' })).not.toContain('speed');
    expect(ids({ kind: 'color' })).toEqual(['tint']);
    expect(ids({ kind: 'action', group: 'graph' })).toEqual([]);
    expect(isMapped(play.controls.find(c => c.id === 'py')!, play)).toBe(true);
  });
});

describe('the Mappings workspace’s groups', () => {
  const m = (id: string, source: PlayMapping['source'], controlId = 'c'): PlayMapping => ({ id, controlId, source, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true });
  const rows = [
    m('a', { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 }),
    m('b', { kind: 'midi', signal: 'cc', channel: 0, cc: 7 }),
    m('c', { kind: 'key', code: 'KeyA' }, 'd'),
    m('d', { kind: 'control', controlId: 'x' }),
    m('e', { kind: 'mouse', axis: 'x' }),
  ];
  const label = (x: PlayMapping) => ({ source: x.source.kind, control: x.controlId === 'd' ? 'Zoom' : 'Speed' });

  it('groups by the kind of source, in a fixed order, keeping the setup’s order within', () => {
    expect(mappingGroupOf(rows[0].source)).toBe('motion');
    expect(mappingGroupOf(rows[3].source)).toBe('other');
    expect(groupMappings(rows, label).map(g => [g.id, g.rows.map(r => r.id)])).toEqual([
      ['midi', ['b']], ['keys', ['c', 'e']], ['motion', ['a']], ['other', ['d']],
    ]);
  });

  it('filters by source or control, and by group', () => {
    expect(groupMappings(rows, label, 'zoom').flatMap(g => g.rows.map(r => r.id))).toEqual(['c']);
    expect(groupMappings(rows, label, 'MOUSE').flatMap(g => g.rows.map(r => r.id))).toEqual(['e']);
    expect(groupMappings(rows, label, '', 'keys').map(g => g.id)).toEqual(['keys']);
    expect(groupCounts(rows)).toEqual([
      { id: 'midi', label: 'MIDI and OSC', count: 1 }, { id: 'keys', label: 'Keys, mouse and gamepad', count: 2 },
      { id: 'motion', label: 'LFOs, clocks and noise', count: 1 }, { id: 'other', label: 'Controls and data', count: 1 },
    ]);
  });
});
