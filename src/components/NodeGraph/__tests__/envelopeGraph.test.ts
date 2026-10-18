import { describe, expect, it } from 'vitest';
import {
  ENV_MAX, dragEnvelopePoint, envelopeLayout, envelopeParams, envelopePlayhead, fmtLevel, fmtTime, nearestEnvelopePoint, timeToU, uToTime,
} from '../envelopeGraph';

const P = { attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.6 };

describe('Envelope graph', () => {
  it('reads the node params with memory.ts defaults', () => {
    expect(envelopeParams({})).toEqual({ mode: 'gate', ...P });
    expect(envelopeParams({ mode: 'trigger', attack: 99, sustain: -1 })).toMatchObject({ mode: 'trigger', attack: ENV_MAX.attack, sustain: 0 });
  });
  it('time ↔ position on a log-like scale, short times getting most of the room', () => {
    expect(timeToU(ENV_MAX.attack, ENV_MAX.attack)).toBe(1);
    expect(timeToU(0, 5)).toBe(0);
    for (const t of [0, 0.01, 0.3, 2, 5]) expect(uToTime(timeToU(t, 5), 5)).toBeCloseTo(t, 9);
    expect(timeToU(0.25, 5)).toBeGreaterThan(0.35);
  });
  it('lays out attack up to 1, decay to Sustain, a plateau, release to 0', () => {
    const L = envelopeLayout(P, 'gate');
    expect(L.attack[1]).toBe(1);
    expect(L.decay[1]).toBe(0.6);
    expect(L.hold[1]).toBe(0.6);
    expect(L.release[1]).toBe(0);
    expect(L.start[0]).toBeLessThan(L.attack[0]);
    expect(L.attack[0]).toBeLessThan(L.decay[0]);
    expect(L.decay[0]).toBeLessThan(L.hold[0]);
    expect(L.hold[0]).toBeLessThan(L.release[0]);
    expect(envelopeLayout({ attack: 5, decay: 5, sustain: 1, release: 10 }, 'gate').release[0]).toBeCloseTo(1, 9);
  });
  it('Trigger mode decays to 0 with no sustain or release', () => {
    const L = envelopeLayout(P, 'trigger');
    expect(L.decay[1]).toBe(0);
    expect(L.release[0]).toBe(L.decay[0]);
  });
  it('dragging each point sets its params, and the layout puts the point back under the pointer', () => {
    for (const mode of ['gate', 'trigger'] as const) {
      const L = envelopeLayout(P, mode);
      // Each point dragged to where it already is: the same params.
      expect(dragEnvelopePoint('attack', L.attack[0], 1, P, mode).attack).toBeCloseTo(P.attack, 3);
      const d = dragEnvelopePoint('decay', L.decay[0], L.decay[1], P, mode);
      expect(d.decay).toBeCloseTo(P.decay, 3);
      if (mode === 'gate') {
        expect(d.sustain).toBeCloseTo(P.sustain, 3);
        expect(dragEnvelopePoint('release', L.release[0], 0, P, mode).release).toBeCloseTo(P.release, 3);
      } else expect(d.sustain).toBeUndefined();
    }
    // A drag right lengthens, left shortens; up raises Sustain; past the ends clamps.
    const L = envelopeLayout(P, 'gate');
    expect(dragEnvelopePoint('attack', L.attack[0] + 0.05, 1, P, 'gate').attack!).toBeGreaterThan(P.attack);
    expect(dragEnvelopePoint('attack', -1, 1, P, 'gate').attack).toBe(0);
    expect(dragEnvelopePoint('attack', 5, 1, P, 'gate').attack).toBe(ENV_MAX.attack);
    expect(dragEnvelopePoint('decay', L.decay[0], 0.9, P, 'gate').sustain).toBeCloseTo(0.9, 6);
    expect(dragEnvelopePoint('decay', L.decay[0], 2, P, 'gate').sustain).toBe(1);
    expect(dragEnvelopePoint('release', L.release[0] - 0.05, 0, P, 'gate').release!).toBeLessThan(P.release);
    // A moved point lands under the pointer.
    const next = { ...P, ...dragEnvelopePoint('release', 0.4, 0, P, 'gate') };
    expect(envelopeLayout(next, 'gate').release[0]).toBeCloseTo(0.4, 2);
  });
  it('finds the point under the pointer', () => {
    const L = envelopeLayout(P, 'gate');
    expect(nearestEnvelopePoint(L, 'gate', L.attack[0], 0.98, 0.1)).toBe('attack');
    expect(nearestEnvelopePoint(L, 'gate', L.release[0], 0.02, 0.1)).toBe('release');
    expect(nearestEnvelopePoint(L, 'gate', 0.5, 0.2, 0.01)).toBeNull();
  });
  it('places the live value along the curve by stage', () => {
    const L = envelopeLayout(P, 'gate');
    expect(envelopePlayhead(L, 'gate', 0, 0)).toBeNull();
    expect(envelopePlayhead(L, 'gate', 0.5, 1)![0]).toBeCloseTo(L.attack[0] / 2, 6);
    expect(envelopePlayhead(L, 'gate', 1, 2)![0]).toBeCloseTo(L.attack[0], 6);
    const sus = envelopePlayhead(L, 'gate', 0.6, 2)!;
    expect(sus[0]).toBeGreaterThan(L.decay[0]);
    expect(sus[0]).toBeLessThan(L.hold[0]);
    expect(envelopePlayhead(L, 'gate', 0, 3)![0]).toBeCloseTo(L.release[0], 6);
    expect(envelopePlayhead(L, 'gate', 0.3, 3)![0]).toBeCloseTo((L.hold[0] + L.release[0]) / 2, 6);
  });
  it('labels times and levels', () => {
    expect(fmtTime(0.332)).toBe('332 ms');
    expect(fmtTime(1.25)).toBe('1.25 s');
    expect(fmtLevel(0.6)).toBe('60% · −4.4 dB');
    expect(fmtLevel(1)).toBe('100% · 0 dB');
    expect(fmtLevel(0)).toBe('0% · −∞ dB');
  });
});
