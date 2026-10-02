/**
 * Implementation guide, phase 7: the new random kinds (Bell, Biased, a seed
 * new each play) and the add menu's Random sources; a Text layer that reads a
 * value, formatted.
 */
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { noiseAt } from '../triggers';
import { klReadText } from '../kit/kit.js';
import { RANDOM_SOURCES } from '../routeOps';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { defaultLayer, parsePlayRecord } from '../../types/play';

const times = Array.from({ length: 400 }, (_, i) => i * 0.137);

describe('random kinds', () => {
  it('Bell keeps to the middle more than Smooth; Biased leans the way it is told', () => {
    const spread = (xs: number[]) => xs.filter(x => x < 0.2 || x > 0.8).length / xs.length;
    const smooth = times.map(t => noiseAt('smooth', t, 1, 3, 0, 0));
    const bell = times.map(t => noiseAt('bell', t, 1, 3, 0, 0));
    expect(spread(bell)).toBeLessThan(spread(smooth) / 2);
    const mean = (b: number) => times.reduce((a, t) => a + noiseAt('biased', t, 1, 3, 0, 0, b), 0) / times.length;
    expect(mean(0.9)).toBeGreaterThan(mean(0.5) + 0.15);
    expect(mean(0.1)).toBeLessThan(mean(0.5) - 0.15);
    for (const v of [...bell, ...times.map(t => noiseAt('biased', t, 1, 3, 0, 0, 1))]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('the website computes them the same way', () => {
    const body = runtimeSource.slice(runtimeSource.indexOf('function hashNoise'), runtimeSource.indexOf('function lfo('));
    const web = new Function(`${body}; return noiseAt;`)() as (type: string, time: number, rate: number, seed: number, steps: number, frame: number, bias?: number) => number;
    for (const [type, bias] of [['bell', undefined], ['biased', 0.8], ['biased', undefined], ['smooth', undefined]] as const) {
      for (const t of times.slice(0, 50)) expect(web(type, t, 1.3, 9, 0, 0, bias)).toBeCloseTo(noiseAt(type, t, 1.3, 9, 0, 0, bias), 12);
    }
  });

  it('keeps Bias and New each play in the file; the Random sources are noise', () => {
    const rec = parsePlayRecord({ version: 1, layers: [], controls: [], mappings: [], sources: [{ id: 's', source: { kind: 'noise', type: 'biased', rate: 1, seed: 2, steps: 0, bias: 7, reseed: true }, outputs: [] }] });
    expect(rec?.sources?.[0].source).toEqual({ kind: 'noise', type: 'biased', rate: 1, seed: 2, steps: 0, bias: 1, reseed: true });
    expect(RANDOM_SOURCES.map(r => r.label)).toEqual(['Shake', 'Wander', 'Hop', 'Chaos']);
    expect(RANDOM_SOURCES.every(r => r.source.kind === 'noise')).toBe(true);
  });
});

describe('text that reads a value', () => {
  it('formats a number, a percent, on/off and a template; a missing value is a dash', () => {
    expect(klReadText(1.23456, 'number', 2)).toBe('1.23');
    expect(klReadText(0.425, 'percent', 2)).toBe('43%');
    expect(klReadText(0.425, 'percent', 3)).toBe('42.5%');
    expect(klReadText(0.7, 'onoff', 0)).toBe('ON');
    expect(klReadText(0.2, 'onoff', 0)).toBe('OFF');
    expect(klReadText(3, 'template', 1, 'Speed: {v} m/s')).toBe('Speed: 3.0 m/s');
    expect(klReadText(null, 'number', 2)).toBe('—');
  });

  it('a Text layer keeps what it reads in the file', () => {
    const t = { ...defaultLayer('text', 't', 'T'), reads: 'ctl:c', readFormat: 'percent', readDecimals: 9 };
    const rec = parsePlayRecord({ version: 1, layers: [t], controls: [], mappings: [] });
    expect(rec?.layers[0]).toMatchObject({ reads: 'ctl:c', readFormat: 'percent', readDecimals: 6 });
    expect(defaultLayer('text', 'x', 'X')).toMatchObject({ reads: '', readFormat: 'number', readDecimals: 2 });
  });
});
