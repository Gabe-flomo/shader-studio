import { describe, it, expect } from 'vitest';
import { driveKey, pauseDrive, playDrivenMap, removeFromPlay } from '../playDriven';
import { emptyPlayRecord, type PlayRecord } from '../../types/play';

const play = (): PlayRecord => ({
  ...emptyPlayRecord(),
  controls: [
    { id: 'c1', target: 'fx::speed', kind: 'float', label: 'Speed', min: 0, max: 2 },
    { id: 'c2', target: 'g1::ring::radius', kind: 'float', label: 'Radius', min: 0, max: 1 },
    { id: 'c3', target: 'fx::glow', kind: 'float', label: 'Glow', min: 0, max: 1 },
  ],
  mappings: [
    { id: 'm1', controlId: 'c1', enabled: true, source: { kind: 'lfo', shape: 'sine', rate: 0.5, phase: 0 } },
    { id: 'm2', controlId: 'c2', enabled: true, source: { kind: 'mouse', axis: 'x' } },
    { id: 'm3', controlId: 'c3', enabled: false, source: { kind: 'mouse', axis: 'y' } },
  ],
} as unknown as PlayRecord);

describe('graph sliders driven from Play', () => {
  it('lists controls an enabled mapping drives, by node and param', () => {
    const d = playDrivenMap(play());
    expect(d.get('fx::speed')?.sources[0]).toMatch(/LFO/);
    expect(d.get('ring::radius')?.controlLabel).toBe('Radius'); // inside a group: the inner node's slider
    expect(d.has('fx::glow')).toBe(false); // its only mapping is off, so the slider still works
    expect(driveKey('a::b::c::d')).toBe('c::d');
  });

  it('pausing hands the slider back; removing takes the control and its mappings away', () => {
    const p = play();
    expect(playDrivenMap(pauseDrive(p, 'c1')).has('fx::speed')).toBe(false);
    const r = removeFromPlay(p, 'c1');
    expect(r.controls.map(c => c.id)).toEqual(['c2', 'c3']);
    expect(r.mappings.some(m => m.controlId === 'c1')).toBe(false);
  });
});
