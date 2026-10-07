/**
 * lib/surprise (docs/surprise.md): seeded determinism, weighted choice, interesting ranges kept
 * inside the legal range, colours in 0–1, frame stats and the degenerate check's retries.
 */
import { describe, expect, it } from 'vitest';
import {
  INTERESTING_RANGES, curatedRange, degenerateReason, deriveSeed, frameStats, harmoniousPalette, interestingRange, makeRng,
  newSeed, randomValue, rampPalette, sampleRange, seedFrom, weightedChoice, withRetries, withRetriesAsync, MAX_SEED,
} from '..';

describe('seeded random numbers', () => {
  it('the same seed gives the same sequence; another seed another', () => {
    const a = makeRng(42), b = makeRng(42), c = makeRng(43);
    const xs = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(xs);
    expect(xs.every(x => x >= 0 && x < 1)).toBe(true);
  });

  it('forks are independent streams, repeatable by label', () => {
    const a = makeRng(7);
    const f1 = a.fork('look').next();
    a.next(); a.next();
    expect(a.fork('look').next()).toBe(f1);
    expect(makeRng(7).fork('camera').next()).not.toBe(f1);
  });

  it('int, float, pick, sample and shuffle stay in bounds', () => {
    const r = makeRng(1);
    for (let i = 0; i < 500; i++) {
      const k = r.int(2, 6);
      expect(Number.isInteger(k) && k >= 2 && k <= 6).toBe(true);
      const f = r.float(-1, 3);
      expect(f >= -1 && f < 3).toBe(true);
      const l = r.logFloat(0.01, 10);
      expect(l >= 0.01 && l <= 10).toBe(true);
    }
    expect(new Set(Array.from({ length: 200 }, () => r.int(1, 3)))).toEqual(new Set([1, 2, 3]));
    expect(r.sample([1, 2, 3, 4], 3).length).toBe(3);
    expect(new Set(r.sample([1, 2, 3, 4], 4)).size).toBe(4);
    expect(r.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('weighted choice follows the weights and never picks a weight of 0', () => {
    const r = makeRng(9);
    const counts = { a: 0, b: 0, z: 0 };
    for (let i = 0; i < 4000; i++) counts[r.weighted<'a' | 'b' | 'z'>([['a', 3], ['b', 1], ['z', 0]])]++;
    expect(counts.z).toBe(0);
    expect(counts.a / counts.b).toBeGreaterThan(2.4);
    expect(counts.a / counts.b).toBeLessThan(3.7);
    expect(weightedChoice([['x', 1], ['y', 1]], 0)).toBe('x');
    expect(weightedChoice([['x', 1], ['y', 1]], 0.99)).toBe('y');
  });

  it('seeds: typed numbers are themselves, words hash, all in 1 … 999 999', () => {
    expect(seedFrom('1234')).toBe(1234);
    expect(seedFrom('  mossy ')).toBe(seedFrom('Mossy'));
    expect(seedFrom('')).toBeNull();
    for (let i = 0; i < 50; i++) { const s = newSeed(); expect(s >= 1 && s <= MAX_SEED).toBe(true); }
    expect(deriveSeed(55, 0)).toBe(55);
    expect(deriveSeed(55, 1)).toBe(deriveSeed(55, 1));
    expect(deriveSeed(55, 1)).not.toBe(deriveSeed(55, 2));
  });
});

describe('interesting ranges', () => {
  it('always fall inside the legal range, curated or not', () => {
    const r = makeRng(3);
    const keys = [...Object.keys(INTERESTING_RANGES).filter(k => !k.includes('.')), 'glowFalloff', 'offsetX', 'color2', 'mystery', 'noise_scale'];
    const legals = [{ min: 0, max: 1 }, { min: 0.01, max: 2 }, { min: -10, max: 10 }, { min: 1, max: 8, step: 1 }, { min: 0, max: 100, def: 50 }, { min: 2, max: 3 }];
    for (const key of keys) for (const legal of legals) {
      const ir = interestingRange(key, legal);
      if (!ir) continue;
      expect(ir.lo, key).toBeGreaterThanOrEqual(legal.min);
      expect(ir.hi, key).toBeLessThanOrEqual(legal.max);
      for (let i = 0; i < 20; i++) {
        const v = sampleRange(ir, r);
        expect(v, `${key} ${JSON.stringify(legal)}`).toBeGreaterThanOrEqual(legal.min);
        expect(v, `${key} ${JSON.stringify(legal)}`).toBeLessThanOrEqual(legal.max);
        if (ir.int) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it('narrow the legal range where it looks bad, by name, suffix and last word', () => {
    expect(interestingRange('frequency', { min: 0.01, max: 50 })).toMatchObject({ lo: 1, hi: 12, log: true, source: 'curated' });
    expect(interestingRange('octaves', { min: 1, max: 8, step: 1 })).toMatchObject({ lo: 3, hi: 6, int: true });
    expect(curatedRange('glowFalloff')).toBe(INTERESTING_RANGES.falloff);
    expect(curatedRange('offsetX')).toBe(INTERESTING_RANGES.offset);
    expect(curatedRange('density', 'gridRules')).toBe(INTERESTING_RANGES['gridrules.density']);
    // No entry: a band round the default.
    expect(interestingRange('wobble', { min: 0, max: 10, def: 2 })).toMatchObject({ lo: 0, hi: 5.5, source: 'default' });
    // Never: bit masks and counters.
    expect(interestingRange('bornMask', { min: 0, max: 511 })).toBeNull();
    expect(randomValue('surviveMask', { min: 0, max: 511 }, makeRng(1))).toBeNull();
  });

  it('angles and seeds use the whole legal range', () => {
    expect(interestingRange('angle', { min: -180, max: 180 })).toMatchObject({ lo: -180, hi: 180 });
  });
});

describe('colours', () => {
  it('stay in 0–1 and repeat with the seed', () => {
    const p = harmoniousPalette(makeRng(5), 6);
    expect(p).toEqual(harmoniousPalette(makeRng(5), 6));
    for (const c of [...p, ...rampPalette(makeRng(6), 5)]) for (const v of c) expect(v >= 0 && v <= 1).toBe(true);
  });
});

describe('degenerate check', () => {
  const frame = (fill: (i: number) => [number, number, number], w = 16, h = 16) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const [r, g, b] = fill(i); px.set([r, g, b, 255], i * 4); }
    return frameStats(px, w, h);
  };

  it('frame stats: black, white, flat and a real picture', () => {
    expect(degenerateReason(frame(() => [0, 0, 0]))).toBe('blank');
    expect(degenerateReason(frame(() => [255, 255, 255]))).toBe('blown out');
    expect(degenerateReason(frame(() => [90, 60, 140]))).toBe('flat');
    expect(degenerateReason(frame(i => [i % 256, (i * 7) % 256, 80]))).toBeNull();
    // A shape on a dark ground is fine.
    expect(degenerateReason(frame(i => (i % 16 > 5 && i % 16 < 10 && i > 80 && i < 170 ? [220, 140, 90] : [8, 10, 18])))).toBeNull();
  });

  it('retries with derived seeds until the judge is happy, and keeps the seed that made it', () => {
    const seen: number[] = [];
    const res = withRetries({ seed: 100, tries: 5, make: (rng, seed) => { seen.push(seed); return rng.next(); }, judge: (_v, seed) => (seen.length < 3 ? `bad ${seed}` : null) });
    expect(res.ok).toBe(true);
    expect(res.tries).toBe(3);
    expect(res.rejected.map(r => r.seed)).toEqual([100, deriveSeed(100, 1)]);
    expect(res.seed).toBe(deriveSeed(100, 2));
    // The kept seed rebuilds the value with no retry.
    expect(withRetries({ seed: res.seed, make: rng => rng.next() }).value).toBe(res.value);
  });

  it('gives up after the last try, returning the last result and ok false', () => {
    const res = withRetries({ seed: 9, tries: 3, make: rng => rng.int(0, 9), judge: () => 'blank' });
    expect(res).toMatchObject({ ok: false, tries: 3 });
    expect(res.rejected).toHaveLength(3);
    expect(res.seed).toBe(deriveSeed(9, 2));
  });

  it('awaits a slow judge the same way', async () => {
    let n = 0;
    const res = await withRetriesAsync({ seed: 4, make: rng => rng.next(), judge: async () => (n++ === 0 ? 'flat' : null) });
    expect(res).toMatchObject({ ok: true, tries: 2 });
  });
});
