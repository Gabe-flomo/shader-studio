/**
 * The detail window (implementation guide, phase 5): its history, and what it
 * says about a control, a source and a signal.
 */
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { useDetail } from '../../components/play/detail/detailStore';
import { comesFrom, doOn, goesTo, listenedBy, listensTo, signalsOn } from '../detailModel';
import { routeToControl } from '../routeOps';
import { defaultLayer, emptyPlayRecord, type PlayControl, type PlayLayer, type PlayRecord } from '../../types/play';

const ctl = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });

describe('the history', () => {
  it('goes back and forward; opening something new drops what was ahead; the same thing twice is one step', () => {
    const d = useDetail.getState();
    d.close();
    d.open({ kind: 'control', id: 'a' });
    d.open({ kind: 'source', id: 's' });
    d.open({ kind: 'source', id: 's' });
    d.open({ kind: 'signal', id: 'r' });
    expect(useDetail.getState().stack.length).toBe(3);
    useDetail.getState().back();
    useDetail.getState().back();
    expect(useDetail.getState().stack[useDetail.getState().at]).toEqual({ kind: 'control', id: 'a' });
    useDetail.getState().forward();
    useDetail.getState().open({ kind: 'control', id: 'b' });
    expect(useDetail.getState().stack.map(r => r.id)).toEqual(['a', 's', 'b']);
    useDetail.getState().close();
    expect(useDetail.getState().at).toBe(-1);
  });
});

describe('what it says', () => {
  const dot = { ...defaultLayer('shape', 'l1', 'Dot') } as PlayLayer;
  const base = (): PlayRecord => ({
    ...emptyPlayRecord(), layers: [dot],
    controls: [ctl('a'), ctl('b'), ctl('x', { target: 'layer:l1::x', label: 'Dot · X' })],
    mappings: [
      { id: 'm1', controlId: 'a', source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      { id: 'm2', controlId: 'b', source: { kind: 'control', controlId: 'a' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
    ],
    signals: [
      { id: 'hi', name: 'When a is high', inputs: [{ kind: 'trigger', trigger: { on: 'value', value: 'ctl:a', cmp: 'above', threshold: 0.5, hysteresis: 0, tolerance: 0 } }], do: [{ id: 'r1', do: 'show', layerId: 'l1', amount: 1, enabled: true }] },
      { id: 'xr', name: 'Dot right', inputs: [{ kind: 'trigger', trigger: { on: 'value', value: 'layer:l1::x', cmp: 'above', threshold: 0.5, hysteresis: 0, tolerance: 0 } }] },
      { id: 'late', name: 'Later', inputs: [{ kind: 'signal', signal: 'hi', as: 'fall', delay: 1 }] },
      { id: 'cap', name: 'Capture', inputs: [{ kind: 'signal', signal: 'hi', as: 'mirror' }] },
    ],
  });

  it('a control: what drives it, the rules watching it, the rules on its layer, where it goes', () => {
    const p = routeToControl(base(), 'm1', 'b').play;
    expect(comesFrom(p, 'b')[1].label).toMatch(/ · adds$/);
    expect(comesFrom(p, 'b').map(l => l.ref?.id)).toEqual(['m2', 'm1']);
    expect(signalsOn(p, 'a').map(l => l.ref?.id)).toEqual(['hi']);
    expect(signalsOn(p, 'x').map(l => l.ref?.id)).toEqual(['xr']);
    expect(doOn(p, 'x').map(l => l.ref?.id)).toEqual(['hi']);
    expect(goesTo(p, 'a')).toEqual([{ label: 'b', ref: { kind: 'control', id: 'b' } }]);
  });

  it('a signal: the rules and sources that take it', () => {
    const p: PlayRecord = { ...base(), mappings: [...base().mappings, { id: 'm3', controlId: 'x', source: { kind: 'trigger', trigger: { on: 'signal', signal: 'hi' }, mode: 'toggle', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }] };
    expect(listenedBy(p, 'hi').map(l => l.ref?.id)).toEqual(['late', 'cap', 'm3']);
    expect(listensTo(p, 'hi').map(l => l.ref?.id)).toEqual(['a']);
    expect(listensTo(p, 'xr').map(l => l.ref?.id)).toEqual(['x']);
    expect(listensTo(p, 'late')).toEqual([{ label: 'When a is high · stops', ref: { kind: 'signal', id: 'hi' } }]);
  });
});
