/**
 * The Graph view's model (playGraph.ts) and layout (playGraphLayout.ts): an
 * old mapping read as a source, a source with two routes, a control source as
 * a control-to-control wire, a chain of rules in columns by depth, a loop,
 * reactions on a layer; and a layout that is the same every time with no
 * boxes overlapping in a column.
 */
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { controlGroupOf, playGraph } from '../playGraph';
import { layoutPlayGraph } from '../playGraphLayout';
import { defaultLayer, emptyPlayRecord, SIGNAL_ACTION, type PlayControl, type PlayLayer, type PlayRecord, type PlayRoute } from '../../types/play';

const ctl = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });
const route = (id: string, to: string, mode: PlayRoute['mode'], over: Partial<PlayRoute> = {}): PlayRoute => ({ id, to, mode, outMin: 0, outMax: 1, curve: 'linear', enabled: true, ...over });
const above = (value: string) => ({ kind: 'trigger' as const, trigger: { on: 'value' as const, value, cmp: 'above' as const, threshold: 0.5, hysteresis: 0, tolerance: 0 } });

const record = (): PlayRecord => ({
  ...emptyPlayRecord(),
  layers: [{ ...defaultLayer('particles', 'p', 'Sparks') } as PlayLayer, { ...defaultLayer('shape', 'd', 'Dot') } as PlayLayer],
  controls: [ctl('a'), ctl('b'), ctl('x', { target: 'layer:d::x', label: 'Dot · X' }), ctl('f', { target: 'finish:grain::amount', label: 'Grain' }), ctl('idle')],
  mappings: [{ id: 'm1', controlId: 'a', source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
  sources: [
    { id: 's1', label: 'LFO', enabled: true, source: { kind: 'mouse', axis: 'y' }, outputs: [{ kind: 'value', routes: [route('r1', 'b', 'add'), route('r2', 'x', 'replace', { delayMs: 500 })] }] },
    { id: 's2', enabled: true, source: { kind: 'control', controlId: 'a' }, outputs: [{ kind: 'value', routes: [route('r3', 'f', 'replace')] }] },
  ],
  signals: [
    { id: 'hi', name: 'A high', inputs: [above('ctl:a')], do: [{ id: 'e1', do: 'burst', layerId: 'p', amount: 60, enabled: true }] },
    { id: 'next', name: 'Then', inputs: [{ kind: 'signal', signal: 'hi', as: 'fall', delay: 1 }], do: [{ id: 'e2', do: 'show', layerId: 'd', amount: 1, enabled: true }, { id: 'e3', do: 'hide', layerId: 'd', amount: 1, enabled: true }] },
    { id: 'last', name: 'Last', inputs: [{ kind: 'signal', signal: 'next', as: 'rise' }, above('src:s1')] },
    // A loop: ping takes pong's rise, pong takes ping's.
    { id: 'ping', name: 'Ping', inputs: [{ kind: 'signal', signal: 'pong', as: 'rise', delay: 0.5 }] },
    { id: 'pong', name: 'Pong', inputs: [{ kind: 'signal', signal: 'ping', as: 'rise', delay: 0.5 }], do: [{ id: 'e4', do: SIGNAL_ACTION, layerId: '', amount: 1, enabled: true, signal: 'last' }] },
  ],
});

describe('playGraph', () => {
  const g = playGraph(record());
  const edge = (from: string, to: string) => g.edges.find(e => e.from === from && e.to === to);
  const col = (id: string) => g.groups.find(x => x.nodes.includes(id))!.column;

  it('an old mapping is a source; a source with two routes wires both, labelled Set or Add', () => {
    expect(g.nodes.find(n => n.id === 'src:m1')?.label).toBe('Mouse X');
    expect(edge('src:m1', 'ctl:a')).toMatchObject({ kind: 'value', label: 'Set' });
    expect(edge('src:s1', 'ctl:b')).toMatchObject({ kind: 'value', label: 'Add' });
    expect(edge('src:s1', 'ctl:x')).toMatchObject({ kind: 'value', label: 'Set · 0.5 s' });
  });

  it('a control source is a wire from the control it reads, not a box', () => {
    expect(g.nodes.some(n => n.id === 'src:s2')).toBe(false);
    expect(edge('ctl:a', 'ctl:f')).toMatchObject({ kind: 'value' });
  });

  it('controls group by layer, then the shader graph and Finish; untouched ones are idle', () => {
    const groups = g.groups.filter(x => x.id.startsWith('grp:')).map(x => [x.id, x.label, x.nodes]);
    expect(groups).toEqual([['grp:layer:d', 'Dot', ['ctl:x']], ['grp:graph', 'Shader graph', ['ctl:a', 'ctl:b', 'ctl:idle']], ['grp:finish', 'Finish', ['ctl:f']]]);
    expect(g.nodes.find(n => n.id === 'ctl:idle')?.idle).toBe(true);
    expect(controlGroupOf('act:p::burst').id).toBe('grp:layer:p');
  });

  it('a chain of rules steps right a column at a time; inputs from controls and sources are signal wires', () => {
    expect(edge('ctl:a', 'rule:hi')).toMatchObject({ kind: 'signal' });
    expect(edge('src:s1', 'rule:last')).toMatchObject({ kind: 'signal' });
    expect(edge('rule:hi', 'rule:next')).toMatchObject({ kind: 'signal', label: 'stops +1 s' });
    expect([col('rule:hi'), col('rule:next'), col('rule:last')]).toEqual([1, 2, 3]);
    expect(col('src:m1')).toBe(0);
    expect(col('ctl:a')).toBe(4);
    expect(col('do:p')).toBe(5);
    expect(g.columns).toBe(6);
  });

  it('reactions wire a rule to the layers it acts on, one wire a layer with its verbs', () => {
    expect(edge('rule:hi', 'do:p')?.label).toBe('Burst particles');
    expect(edge('rule:next', 'do:d')?.label).toMatch(/^Show, Hide$/);
    expect(edge('rule:pong', 'rule:last')).toMatchObject({ label: 'sends' });
  });

  it('a loop: its edges are marked, its rules badged, and it does not push the columns on forever', () => {
    expect(edge('rule:ping', 'rule:pong')?.loop).toBe(true);
    expect(edge('rule:pong', 'rule:ping')?.loop).toBe(true);
    expect(edge('rule:pong', 'rule:last')?.loop).toBeFalsy();
    expect(g.nodes.find(n => n.id === 'rule:ping')?.shape).toBe('loop');
    expect(col('rule:ping')).toBe(col('rule:pong'));
  });

  it('an older record (actions, a signal\'s links) is drawn as the rules it plays as', () => {
    const p: PlayRecord = { ...record(), signals: [{ id: 'k', name: 'Key', when: { kind: 'trigger', trigger: { on: 'key', code: 'Space' } }, links: [{ to: 'k2', delay: 0.2 }] }, { id: 'k2', name: 'Key 2' }],
      actions: [{ id: 'a1', trigger: { on: 'signal', signal: 'k2' }, do: 'burst', layerId: 'p', amount: 10, enabled: true }] };
    const h = playGraph(p);
    expect(h.edges.find(e => e.from === 'rule:k' && e.to === 'rule:k2')?.label).toBe('starts +0.2 s');
    expect(h.edges.some(e => e.from === 'rule:k2' && e.to === 'do:p')).toBe(true);
  });
});

describe('layoutPlayGraph', () => {
  it('is the same every time', () => {
    const a = layoutPlayGraph(playGraph(record())), b = layoutPlayGraph(playGraph(record()));
    expect([...a.nodes]).toEqual([...b.nodes]);
    expect([...a.groups]).toEqual([...b.groups]);
  });

  it('gives every node a box, with no two groups overlapping in a column and rows inside their group', () => {
    const g = playGraph(record());
    const l = layoutPlayGraph(g);
    for (const n of g.nodes) expect(l.nodes.has(n.id)).toBe(true);
    const byX = new Map<number, Array<{ y: number; h: number }>>();
    for (const b of l.groups.values()) byX.set(b.x, [...(byX.get(b.x) ?? []), b]);
    for (const boxes of byX.values()) {
      const s = [...boxes].sort((p, q) => p.y - q.y);
      for (let i = 1; i < s.length; i++) expect(s[i].y).toBeGreaterThanOrEqual(s[i - 1].y + s[i - 1].h);
    }
    for (const grp of g.groups) {
      const gb = l.groups.get(grp.id)!;
      for (const n of grp.nodes) { const nb = l.nodes.get(n)!; expect(nb.y).toBeGreaterThanOrEqual(gb.y); expect(nb.y + nb.h).toBeLessThanOrEqual(gb.y + gb.h); }
    }
    expect(l.width).toBeGreaterThan(0);
  });

  it('orders a column by what feeds it (fewer crossings)', () => {
    // Two sources wired crosswise to two rules: the rules swap to follow them.
    const p: PlayRecord = { ...emptyPlayRecord(), controls: [], mappings: [],
      sources: [{ id: 'u', enabled: true, source: { kind: 'mouse', axis: 'x' }, outputs: [] }, { id: 'v', enabled: true, source: { kind: 'mouse', axis: 'y' }, outputs: [] }],
      signals: [{ id: 'r1', name: 'R1', inputs: [above('src:v')] }, { id: 'r2', name: 'R2', inputs: [above('src:u')] }] };
    const l = layoutPlayGraph(playGraph(p));
    expect(l.nodes.get('rule:r2')!.y).toBeLessThan(l.nodes.get('rule:r1')!.y);
  });
});
