/**
 * The Signals page's flow (signalFlow.ts) and Create signal from a slider's +
 * (play/createSignal.ts, miniMapperCore.ts): signals with their When and
 * Then, reactions that stand alone, and a new signal that really fires when
 * the watched value crosses the middle of its range.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { addThen, addWhen, signalFlow } from '../signalFlow';
import { createSignalFrom } from '../../../play/createSignal';
import { CREATE_SIGNAL, miniMapperSections, signalSourceFor, wireCreateSignal } from '../miniMapperCore';
import { playEngine } from '../../../lib/playEngine';
import { inputBus } from '../../../lib/inputBus';
import { defaultLayer, emptyPlayRecord, SIGNAL_ACTION, type PlayAction, type PlayControl, type PlayLayer, type PlayRecord } from '../../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); });

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 10, ...over });
const sparks = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const act = (id: string, over: Partial<PlayAction>): PlayAction => ({ id, trigger: { on: 'key', code: 'Space' }, do: 'burst', layerId: 'p', amount: 1, enabled: true, ...over });

describe('the flow', () => {
  it('puts each action under the signal it sends or fires on, a relay under both, and the rest apart', () => {
    const play: PlayRecord = {
      ...emptyPlayRecord(), layers: [sparks()], signals: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      actions: [
        act('send', { do: SIGNAL_ACTION, layerId: '', signal: 'a' }),
        act('relay', { trigger: { on: 'signal', signal: 'a' }, do: SIGNAL_ACTION, layerId: '', signal: 'b' }),
        act('burst', { trigger: { on: 'signal', signal: 'b' } }),
        act('alone', {}),
      ],
    };
    const f = signalFlow(play);
    const ids = (xs: PlayAction[]) => xs.map(a => a.id);
    expect(f.groups.map(g => [g.signal.id, ids(g.when), ids(g.then)])).toEqual([['a', ['send'], ['relay']], ['b', ['relay'], ['burst']]]);
    expect(ids(f.others)).toEqual(['alone']);
  });

  it('adds a When that sends the signal, and a Then that fires on it', () => {
    const base: PlayRecord = { ...emptyPlayRecord(), layers: [sparks()], signals: [{ id: 's', name: 'S' }] };
    const w = addWhen(base, 's');
    expect(w.play.actions!.find(a => a.id === w.id)).toMatchObject({ do: SIGNAL_ACTION, signal: 's', layerId: '' });
    const t = addThen(w.play, 's');
    expect(t.play.actions!.find(a => a.id === t.id)).toMatchObject({ trigger: { on: 'signal', signal: 's' }, layerId: 'p' });
    const g = signalFlow(t.play).groups[0];
    expect([g.when.length, g.then.length]).toEqual([1, 1]);
  });
});

describe('Create signal', () => {
  it('watches the middle of the range with a small hysteresis, and is named for what it watches', () => {
    const r = createSignalFrom(emptyPlayRecord(), { value: 'ctl:c', label: 'Radius', min: 2, max: 12 });
    expect(r.play.signals).toEqual([{ id: r.signalId, name: 'Radius rises' }]);
    expect(r.play.actions).toEqual([expect.objectContaining({ id: r.actionId, do: SIGNAL_ACTION, signal: r.signalId, trigger: expect.objectContaining({ on: 'value', value: 'ctl:c', cmp: 'crossUp', threshold: 7, hysteresis: 0.5 }) })]);
  });

  it('a layer property is watched straight from the layer, with no control made', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), layers: [sparks()] };
    const { play: after, src } = signalSourceFor(play, { layerId: 'p', key: 'speed' });
    expect(after).toBe(play);
    expect(src).toMatchObject({ value: 'layer:p::speed' });
  });

  it('a graph slider gets its control first; a colour can’t be watched', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), controls: [control('c'), control('col', { kind: 'color', min: 0, max: 1 })] };
    const r = wireCreateSignal(play, { control: 'c' });
    expect(r?.play.actions?.[0].trigger).toMatchObject({ on: 'value', value: 'ctl:c', threshold: 5 });
    expect(wireCreateSignal(play, { control: 'col' })).toBeNull();
  });

  it('is offered in the + menu right after Control only', () => {
    const s = miniMapperSections({ play: emptyPlayRecord(), midiDevices: [], hasCamera: false });
    expect(s[1]).toMatchObject({ heading: 'Signal', items: [expect.objectContaining({ value: CREATE_SIGNAL })] });
  });

  it('fires in the engine each time the value crosses the middle', () => {
    const r = wireCreateSignal({ ...emptyPlayRecord(), controls: [control('c')] }, { control: 'c' })!;
    playEngine.setRecord(r.play);
    const heard: string[] = [];
    const off = playEngine.onSignal(id => heard.push(id));
    let t = 1;
    for (const v of [1, 8, 9, 2, 7]) { playEngine.setBaseValues(new Map([['c', v]])); inputBus.tick(1 / 60, (t += 1 / 60)); }
    off();
    expect(heard).toEqual([r.signalId, r.signalId]);
  });
});
