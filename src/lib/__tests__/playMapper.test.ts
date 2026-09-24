import { describe, it, expect, afterEach } from 'vitest';
import { shapeValue, playMapper } from '../playMapper';
import { inputBus } from '../inputBus';
import { midiEngine } from '../midiEngine';
import { sanitizePlay, EMPTY_PLAY, describeSource, type PlayMapping } from '../../types/play';

const base: PlayMapping = {
  id: 'm1', source: { kind: 'midi', channel: 'velocity' }, target: { nodeId: 'n1', paramKey: 'radius' },
  inMin: 0, inMax: 1, outMin: 0.2, outMax: 0.8, curve: 'linear', smoothMs: 0, enabled: true,
};

afterEach(() => {
  playMapper.setInstrument(EMPTY_PLAY);
  inputBus.setParamBindings({});
  inputBus.setBindings({});
  for (let ch = 0; ch < 16; ch++) midiEngine.handleBytes(0x80 | ch, 60, 0);
});

describe('shapeValue', () => {
  it('maps and clamps the input range onto the output range', () => {
    expect(shapeValue(0.5, base)).toBeCloseTo(0.5);
    expect(shapeValue(-1, base)).toBeCloseTo(0.2);
    expect(shapeValue(9, base)).toBeCloseTo(0.8);
  });
  it('applies exp and log curves and inverted ranges', () => {
    expect(shapeValue(0.5, { ...base, curve: 'exp', outMin: 0, outMax: 1 })).toBeCloseTo(0.25);
    expect(shapeValue(0.25, { ...base, curve: 'log', outMin: 0, outMax: 1 })).toBeCloseTo(0.5);
    expect(shapeValue(1, { ...base, outMin: 1, outMax: 0 })).toBeCloseTo(0);
  });
  it('handles a zero-width input range without NaN', () => {
    expect(shapeValue(0.3, { ...base, inMin: 0.5, inMax: 0.5 })).toBeCloseTo(0.2);
  });
});

describe('playMapper through the bus', () => {
  it('drives a param uniform from MIDI velocity via paramBindings', () => {
    inputBus.setParamBindings({ 'n1::radius': 'u_p_circle_1_radius' });
    playMapper.setInstrument({ version: 1, controls: [], mappings: [base] });
    const off = inputBus.addSource(playMapper);
    try {
      midiEngine.handleBytes(0x90, 60, 127);
      const v = inputBus.tick(1 / 60, 0);
      expect(v.get('u_p_circle_1_radius')).toBeCloseTo(0.8);
    } finally { off(); }
  });
  it('ignores disabled mappings and unknown targets', () => {
    inputBus.setParamBindings({ 'n1::radius': 'u_p_circle_1_radius' });
    playMapper.setInstrument({ version: 1, controls: [], mappings: [{ ...base, enabled: false }, { ...base, id: 'm2', target: { nodeId: 'gone', paramKey: 'x' } }] });
    const off = inputBus.addSource(playMapper);
    try {
      expect(inputBus.tick(1 / 60, 0).size).toBe(0);
    } finally { off(); }
  });
});

describe('sanitizePlay', () => {
  it('round-trips a valid instrument and drops junk', () => {
    const raw = {
      version: 1,
      controls: [{ id: 'c1', target: { nodeId: 'n1', paramKey: 'radius' }, min: 0, max: 2 }, { id: 'bad' }],
      mappings: [base, { id: 'x', source: { kind: 'nope' }, target: base.target }, { ...base, id: 'k', source: { kind: 'key', code: 'Space' }, curve: 'weird', enabled: undefined }],
    };
    const p = sanitizePlay(JSON.parse(JSON.stringify(raw)));
    expect(p.controls).toHaveLength(1);
    expect(p.mappings.map(m => m.id)).toEqual(['m1', 'k']);
    expect(p.mappings[1].curve).toBe('linear');
    expect(p.mappings[1].enabled).toBe(true);
    expect(sanitizePlay(null)).toEqual(EMPTY_PLAY);
    expect(sanitizePlay('garbage')).toEqual(EMPTY_PLAY);
  });
  it('defaults pitch-bend input range to -1..1', () => {
    const p = sanitizePlay({ mappings: [{ id: 'b', source: { kind: 'midi', channel: 'bend' }, target: base.target }] });
    expect([p.mappings[0].inMin, p.mappings[0].inMax]).toEqual([-1, 1]);
    expect(describeSource(p.mappings[0].source)).toBe('Pitch bend');
  });
});
