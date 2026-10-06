/**
 * The shared blur maths (play/kit/blur.js, docs/blur-and-glow.md): Gaussian
 * weights, the linear-sampling taps, and the Smooth and Bloom-chain plans.
 */
import { describe, expect, it } from 'vitest';
import {
  BL_BASE_GLSL, BL_GLSL2, BL_MAX_LEVELS, BL_MAX_PAIRS, BL_PREV_GLSL, BL_SIGMA_PER_RADIUS, BL_SIGMA_TARGET,
  blBloomPlan, blBloomWeight, blChainSizes, blGaussianWeights, blGlsl, blLinearTaps, blSmoothPlan,
} from '../kit/blur.js';

const sumKernel = (w: number[]) => w.reduce((a, x, i) => a + (i ? 2 * x : x), 0);

/** What a 1D bilinear read at x returns from a row of texels (texel i's centre at i). */
const bilinear = (row: (i: number) => number, x: number) => {
  const i = Math.floor(x), f = x - i;
  return row(i) * (1 - f) + row(i + 1) * f;
};

describe('Gaussian weights', () => {
  it('sum to 1 (centre once, each side twice) and fall off as exp(-x²/2σ²)', () => {
    for (const sigma of [0.5, 1, 2.5, 4, 9.3]) {
      const w = blGaussianWeights(sigma);
      expect(w.length).toBe(Math.ceil(3 * sigma) + 1);
      expect(sumKernel(w)).toBeCloseTo(1, 12);
      for (let i = 1; i < w.length; i++) expect(w[i] / w[0]).toBeCloseTo(Math.exp(-0.5 * i * i / (sigma * sigma)), 12);
    }
  });

  it('is a single tap at σ = 0', () => {
    expect(blGaussianWeights(0)).toEqual([1]);
  });
});

describe('linear-sampling taps (RasterGrid)', () => {
  it('sum to 1 and use about half the reads', () => {
    for (const sigma of [0.8, 1.5, 3, 4, 7.5]) {
      const discrete = blGaussianWeights(sigma);
      const { offsets, weights } = blLinearTaps(sigma);
      expect(sumKernel(weights)).toBeCloseTo(1, 12);
      expect(offsets.length).toBe(1 + Math.ceil((discrete.length - 1) / 2));
      // Every pair's read sits between its two texels.
      for (let k = 1; k < offsets.length; k++) {
        expect(offsets[k]).toBeGreaterThanOrEqual(2 * k - 1);
        expect(offsets[k]).toBeLessThanOrEqual(2 * k);
      }
    }
  });

  it('reproduce the discrete kernel exactly through bilinear reads (no texel skipped)', () => {
    for (const sigma of [1, 2.2, 4]) {
      const discrete = blGaussianWeights(sigma);
      const { offsets, weights } = blLinearTaps(sigma);
      // The response to one bright texel at m: what the blurred texel 0 reads from it.
      for (let m = -discrete.length + 1; m < discrete.length; m++) {
        const row = (i: number) => (i === m ? 1 : 0);
        let got = weights[0] * row(0);
        for (let k = 1; k < offsets.length; k++) got += weights[k] * (bilinear(row, offsets[k]) + bilinear(row, -offsets[k]));
        expect(got, `σ ${sigma}, texel ${m}`).toBeCloseTo(discrete[Math.abs(m)], 12);
      }
    }
  });

  it('cover σ up to BL_MAX_PAIRS × 2 / 3 texels without a stride', () => {
    const sigma = (2 * BL_MAX_PAIRS) / 3;
    expect(blLinearTaps(sigma).offsets.length - 1).toBeLessThanOrEqual(BL_MAX_PAIRS);
  });
});

describe('Smooth plan', () => {
  it('blurs at the source size while σ stays small, and halves first past it', () => {
    expect(blSmoothPlan(8, 1)).toMatchObject({ downs: 0, scale: 1, cubic: false });
    // σ = 0.45 × Radius; each halving keeps σ in texels at or under the target.
    for (const [radius, src] of [[16, 1], [24, 1], [48, 0.5], [64, 1], [200, 1]] as const) {
      const p = blSmoothPlan(radius, src);
      expect(p.sigma).toBeCloseTo(radius * BL_SIGMA_PER_RADIUS);
      expect(p.scale).toBeCloseTo(src / 2 ** p.downs);
      if (p.downs < 4) expect(p.sigma * p.scale).toBeLessThanOrEqual(BL_SIGMA_TARGET);
      if (p.downs > 0) expect(p.sigma * p.scale * 2).toBeGreaterThan(BL_SIGMA_TARGET);
    }
    expect(blSmoothPlan(64, 1)).toMatchObject({ downs: 3, scale: 0.125, cubic: true });
  });

  it('subtracts what the downsamples and the cubic read already blur', () => {
    const one = blSmoothPlan(24, 1), two = blSmoothPlan(64, 1);
    expect(one.downs).toBe(2);
    // (1.75 / 4) per halving, the earlier one counted at a quarter in the smaller texels, plus the B-spline's 1/3.
    expect(one.variance).toBeCloseTo(1.75 / 4 / 4 + 1.75 / 4 + 1 / 3);
    expect(two.variance).toBeGreaterThan(one.variance);
    expect(two.variance).toBeLessThan(1);
  });
});

describe('bloom chain plan', () => {
  it('keeps one level past what Radius reaches, at least 2, at most BL_MAX_LEVELS', () => {
    expect(blBloomPlan(2, 1).levels).toBe(2);
    expect(blBloomPlan(12, 1).levels).toBe(4);
    expect(blBloomPlan(24, 1).levels).toBe(5);
    expect(blBloomPlan(64, 1).levels).toBe(6);
    expect(blBloomPlan(200, 1).levels).toBe(BL_MAX_LEVELS);
    expect(blBloomPlan(1000, 1).levels).toBe(BL_MAX_LEVELS);
    // A ½ source reaches the same picture distance one level sooner.
    expect(blBloomPlan(24, 0.5).levels).toBe(4);
  });

  it('halves each level, and draws levels × 2 − 1 passes', () => {
    const p = blBloomPlan(24, 1);
    expect(p.scales).toEqual([0.5, 0.25, 0.125, 0.0625, 0.03125]);
    expect(p.passes).toBe(9);
    expect(blChainSizes(1920, 1080, p.scales)).toEqual([[960, 540], [480, 270], [240, 135], [120, 68], [60, 34]]);
  });

  it('never goes below 1/128 of the picture', () => {
    const p = blBloomPlan(1000, 0.125);
    expect(Math.min(...p.scales)).toBeGreaterThanOrEqual(1 / 128);
  });

  it('weighs level 1 fully and fades the far levels in as Radius grows', () => {
    for (const r of [1, 4, 12, 64]) expect(blBloomWeight(r, 1, 1)).toBe(1);
    expect(blBloomWeight(8, 1, 2)).toBe(1);
    expect(blBloomWeight(8, 1, 3)).toBe(0);
    expect(blBloomWeight(12, 1, 3)).toBeCloseTo(Math.log2(3) - 1);
    for (let k = 2; k <= 6; k++) expect(blBloomWeight(32, 1, k)).toBeGreaterThanOrEqual(blBloomWeight(16, 1, k));
  });
});

describe('shared GLSL', () => {
  it('is one string per variant, so programs that hold several blur nodes declare each function once', () => {
    expect(BL_GLSL2).toBe(blGlsl('texture2D'));
    expect(BL_BASE_GLSL.match(/float blIGN\(/g)).toHaveLength(1);
    expect(BL_GLSL2).not.toContain('blIGN(vec2 p)');
  });

  it('the frame-before variant reads u_prevFrame written out, with no sampler argument (the Look rewrites it)', () => {
    expect(BL_PREV_GLSL).toContain('texture2D(u_prevFrame, clamp(');
    expect(BL_PREV_GLSL).not.toMatch(/sampler2D/);
    expect(BL_PREV_GLSL).toMatch(/vec4 blGaussPrev\(vec2 uv/);
  });

  it('the GLSL ES 3.00 variant reads with texture()', () => {
    const g3 = blGlsl('texture');
    expect(g3).not.toContain('texture2D');
    expect(g3).toContain('vec4 blDown13(sampler2D s');
  });

  it('loops have literal bounds (GLSL ES 1.00)', () => {
    for (const m of BL_GLSL2.matchAll(/for \(int \w+ = [^;]+; \w+ <=? ([^;]+);/g)) expect(m[1]).toMatch(/^-?\d+$/);
    expect(BL_MAX_LEVELS).toBeLessThanOrEqual(8);
  });
});
