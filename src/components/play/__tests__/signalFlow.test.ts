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
import { ruleWhenFrom } from '../../../play/createSignal';
import { addRule, defaultReaction, inputOf } from '../../../play/rules';
import { CREATE_SIGNAL, miniMapperSections, signalSourceFor, wireRuleWhen } from '../miniMapperCore';
import { playEngine } from '../../../lib/playEngine';
import { inputBus } from '../../../lib/inputBus';
import { defaultLayer, emptyPlayRecord, type PlayControl, type PlayLayer, type PlayRecord } from '../../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); });

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 10, ...over });
const sparks = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;

describe('Create signal', () => {
  it('watches the middle of the range with a small hysteresis, and is named for what it watches', () => {
    expect(ruleWhenFrom({ value: 'ctl:c', label: 'Radius', min: 2, max: 12 })).toMatchObject({ on: 'value', value: 'ctl:c', cmp: 'above', threshold: 7, hysteresis: 0.5 });
  });

  it('a layer property is watched straight from the layer, with no control made', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), layers: [sparks()] };
    const { play: after, src } = signalSourceFor(play, { layerId: 'p', key: 'speed' });
    expect(after).toBe(play);
    expect(src).toMatchObject({ value: 'layer:p::speed' });
  });

  it('a graph slider gets its control first; a colour can’t be watched', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), controls: [control('c'), control('col', { kind: 'color', min: 0, max: 1 })] };
    const r = wireRuleWhen(play, { control: 'c' });
    expect(r?.when).toMatchObject({ on: 'value', value: 'ctl:c', threshold: 5 });
    expect(wireRuleWhen(play, { control: 'col' })).toBeNull();
  });

  it('is offered in the + menu right after Control only', () => {
    const s = miniMapperSections({ play: emptyPlayRecord(), midiDevices: [], hasCamera: false });
    expect(s[1]).toMatchObject({ heading: 'Signal', items: [expect.objectContaining({ value: CREATE_SIGNAL })] });
  });

  it('makes a rule whose reactions fire each time the value goes above the middle', () => {
    const base: PlayRecord = { ...emptyPlayRecord(), controls: [control('c')], layers: [sparks()] };
    const w = wireRuleWhen(base, { control: 'c' })!;
    const r = addRule(w.play, [inputOf(w.when)], [defaultReaction(w.play)]);
    expect(r.play.signals?.[0].name).toBe('When c goes above 5');
    playEngine.setRecord(r.play);
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(a.layerId));
    let t = 1;
    for (const v of [1, 8, 9, 2, 7]) { playEngine.setBaseValues(new Map([['c', v]])); inputBus.tick(1 / 60, (t += 1 / 60)); }
    off();
    expect(fired).toEqual(['p', 'p']);
  });
});
