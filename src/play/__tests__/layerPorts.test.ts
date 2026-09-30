/**
 * A layer's contract (play/layerPorts.ts): one description of what every
 * kind accepts and emits, built from the tables it replaces for the pickers;
 * readings watched straight from the layer (`read:<id>::<read>`), in the app,
 * on a website, and through the reference walker.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { eventSignal, layerEvents, layerPorts, readingRange } from '../layerPorts';
import { layerSignalSenders } from '../pairs';
import { mapValueRef } from '../playRefs';
import { valueRange } from '../conditionRange';
import { valueRefLabel } from '../playSources';
import { sgParseValueRef } from '../kit/signals.js';
import { valueSections } from '../../components/play/ConditionFields';
import { playEngine } from '../../lib/playEngine';
import { ACTIONS_FOR, LAYER_KINDS, SENSOR_READS_FOR, defaultLayer, emptyPlayRecord, layerNumericProps, type PlayLayer, type PlayRecord } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); });

describe('every kind has a contract', () => {
  it('agrees with the tables it combines', () => {
    for (const kind of LAYER_KINDS) {
      const l = defaultLayer(kind, `id_${kind}`, kind);
      const p = layerPorts(l);
      expect(p.props, kind).toEqual(layerNumericProps(l));
      expect(p.buttons.length, kind).toBeGreaterThan(0);
      for (const b of ACTIONS_FOR[kind] ?? ACTIONS_FOR.other) expect(p.buttons, kind).toContain(b);
      expect(p.readings, kind).toEqual((SENSOR_READS_FOR[kind] ?? []).filter(r => r !== 'distance'));
    }
  });

  it('lists the signals particles, agents and relationships send, with the field that names each', () => {
    const multiply = { ...defaultLayer('particles', 'p', 'P'), emit: 'multiply' } as PlayLayer;
    expect(layerEvents(multiply).map(e => e.key)).toEqual(['born', 'died', 'split', 'full', 'annihilate', 'cleared']);
    expect(layerEvents(defaultLayer('particles', 'p', 'P')).map(e => e.key)).toEqual(['born', 'died']);
    expect(layerEvents(defaultLayer('agents', 'a', 'A')).map(e => e.field)).toEqual(['bornSignal', 'diedSignal']);
    expect(layerEvents(defaultLayer('relationship', 'r', 'R')).map(e => e.field)).toEqual(['catchSignal']);
    expect(layerEvents(defaultLayer('text', 't', 'T'))).toEqual([]);
    expect(layerPorts(defaultLayer('null', 'n', 'N')).position).toBe(true);
    expect(layerPorts(defaultLayer('drumpad', 'd', 'D')).position).toBe(false);
  });

  it('the Signals page hears Born and Died now (they were left out of the senders)', () => {
    const l = { ...defaultLayer('particles', 'p', 'Sparks'), bornSignal: 's1', diedSignal: 's2' } as PlayLayer;
    expect(eventSignal(l, layerEvents(l)[0])).toBe('s1');
    const play: PlayRecord = { ...emptyPlayRecord(), layers: [l], signals: [{ id: 's1', name: 'B' }, { id: 's2', name: 'D' }] };
    expect(layerSignalSenders(play)).toEqual([{ id: 's1', label: 'Sparks: Born' }, { id: 's2', label: 'Sparks: Died' }]);
  });
});

describe('readings as values', () => {
  it('parse, name, range and rename like any value path', () => {
    expect(sgParseValueRef('read:shape1::hover')).toEqual({ kind: 'reading', layerId: 'shape1', read: 'hover' });
    expect(sgParseValueRef('read:::hover')).toBeNull();
    const play: PlayRecord = { ...emptyPlayRecord(), layers: [defaultLayer('shape', 'shape1', 'Box')] };
    expect(valueRefLabel('read:shape1::hover', { layers: play.layers })).toBe('Box · Hover');
    expect(valueRange(play, 'read:shape1::hover')).toEqual([0, 1]);
    expect(readingRange('born')).toBeNull();
    expect(mapValueRef('read:shape1::hover', (_k, id) => (id === 'shape1' ? 'shape2' : id))).toBe('read:shape2::hover');
  });

  it('are offered in the condition’s value picker', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), layers: [defaultLayer('shape', 'shape1', 'Box')] };
    const s = valueSections(play).find(x => x.heading === 'Layer readings');
    expect(s?.items.map(i => i.value)).toEqual(['read:shape1::fill', 'read:shape1::hover', 'read:shape1::picture']);
  });

  it('the engine reads them from the layer’s sensors', () => {
    playEngine.setRecord({ ...emptyPlayRecord(), layers: [defaultLayer('shape', 'shape1', 'Box')] });
    expect(playEngine.readValue('read:shape1::hover')).toBeNull();
    playEngine.setSensor('shape1::hover', 1);
    expect(playEngine.readValue('read:shape1::hover')).toBe(1);
  });
});
