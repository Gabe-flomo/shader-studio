/**
 * Time Cube View's march (lib/timeCube/march.ts): the exact ray–rounded-box intersection, the next
 * highlighted frame along a ray, and where in a step the volume is read. These are what keep the
 * box's edges, the slice and the highlighted frames clean (docs/time-cube.md, "How it is drawn").
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { combNext, freeFlight, rayRoundBox, rayRoundBoxEnter } from '../march';
import { combDistance, roundBox } from '../style';
import { compileGraph } from '../../../compiler/graphCompiler';
import { n } from '../../../store/graphBuilder';

/** A slow, sure reference: walk the ray in tiny steps and bisect the first sign change. */
function bruteEnter(ro: number[], rd: number[], b: number[], r: number): number {
  const f = (t: number) => roundBox([ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t], b, r);
  const dt = 1e-3;
  let prev = f(0);
  if (prev < 0) return 0;
  for (let t = dt; t < 20; t += dt) {
    const v = f(t);
    if (v < 0) {
      let a = t - dt, c = t;
      for (let i = 0; i < 40; i++) { const m = 0.5 * (a + c); if (f(m) < 0) c = m; else a = m; }
      return c;
    }
    prev = v;
  }
  return -1;
}

let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const unit = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]); return v.map(x => x / l); };

describe('ray and rounded box', () => {
  const B = [0.8, 0.5, 1.2];
  it('meets random rays where a fine walk along them does, hits and misses alike', () => {
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      const r = rnd() * 0.5;
      const ro = unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]).map(x => x * 4);
      // Aim near the box so many rays graze it.
      const aim = [(rnd() - 0.5) * 2.2, (rnd() - 0.5) * 1.4, (rnd() - 0.5) * 3];
      const rd = unit([aim[0] - ro[0], aim[1] - ro[1], aim[2] - ro[2]]);
      const want = bruteEnter(ro, rd, B, r);
      const got = rayRoundBoxEnter(ro, rd, B, r);
      if (want < 0) { expect(got, `ray ${i}`).toBe(-1); continue; }
      hits++;
      expect(Math.abs(got - want), `ray ${i}`).toBeLessThan(2e-3);
    }
    expect(hits).toBeGreaterThan(100);
  });
  it('rays that skim a flat face still find it (sphere tracing ran out of steps there)', () => {
    // Nearly parallel to the top face, coming down onto it very slowly.
    const ro = [-3, 0.505, 0.1], rd = unit([1, -0.004, 0]);
    const want = bruteEnter(ro, rd, B, 0.2);
    expect(want).toBeGreaterThan(0);
    expect(Math.abs(rayRoundBoxEnter(ro, rd, B, 0.2) - want)).toBeLessThan(2e-3);
  });
  it('enter and exit: the exit is where the reversed ray goes in; from inside, enter is 0', () => {
    const ro = [0.1, 0.2, -4], rd = unit([0.05, -0.02, 1]);
    const [en, ex] = rayRoundBox(ro, rd, B, 0.3)!;
    const p = (t: number) => [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    expect(Math.abs(roundBox(p(en), B, 0.3))).toBeLessThan(1e-6);
    expect(Math.abs(roundBox(p(ex), B, 0.3))).toBeLessThan(1e-6);
    expect(ex).toBeGreaterThan(en);
    const [en2, ex2] = rayRoundBox([0, 0, 0], rd, B, 0.3)!;
    expect(en2).toBe(0);
    expect(Math.abs(roundBox(p(0).map((_, i) => rd[i] * ex2), B, 0.3))).toBeLessThan(1e-6);
    expect(rayRoundBox([0, 3, 0], [1, 0, 0], B, 0.3)).toBeNull();
  });
});

describe('the next highlighted frame along a ray', () => {
  it('fixed or following: the comb\'s frames in order, then none', () => {
    const hl = [0.1, 0.2, 3, 0] as const; // 0.1, 0.3, 0.5
    expect(combNext(0, 1, hl)).toBeCloseTo(0.1, 12);
    expect(combNext(0.1, 1, hl)).toBeCloseTo(0.3, 12);
    expect(combNext(0.45, 1, hl)).toBeCloseTo(0.5, 12);
    expect(combNext(0.5, 1, hl)).toBe(Infinity);
    expect(combNext(0.6, -1, hl)).toBeCloseTo(0.5, 12);
    expect(combNext(0.3, -1, hl)).toBeCloseTo(0.1, 12);
    expect(combNext(0.1, -1, hl)).toBe(-Infinity);
  });
  it('looping: the comb repeats every whole box, so a ray keeps meeting it', () => {
    const hl = [0.7, 0.2, 2, 1] as const; // 0.7, 0.9, then 1.7, 1.9 and −0.3, −0.1
    expect(combNext(0, 1, hl)).toBeCloseTo(0.7, 12);
    expect(combNext(0.95, 1, hl)).toBeCloseTo(1.7, 12);
    expect(combNext(0.5, -1, hl)).toBeCloseTo(-0.1, 12);
  });
  it('every frame it finds is one the comb\'s distance calls a centre, and it skips none', () => {
    const c = { start: 0.13, spacing: 0.11, count: 5, loop: true };
    const hl = [c.start, c.spacing, c.count, 1] as const;
    let g = -0.5;
    const seen: number[] = [];
    for (let i = 0; i < 40 && g < 1.5; i++) { g = combNext(g, 1, hl); seen.push(g); expect(Math.abs(combDistance(g, c))).toBeLessThan(1e-9); }
    // Between two found frames there is no other centre: the distance never reaches 0 in between.
    for (let i = 1; i < seen.length; i++) {
      for (let s = 1; s < 10; s++) {
        const x = seen[i - 1] + (seen[i] - seen[i - 1]) * s / 10;
        expect(Math.abs(combDistance(x, c))).toBeGreaterThan(1e-6);
      }
    }
  });
});

describe('where in a step to read', () => {
  it('thin: evenly over the step; solid: at its start; never past its end', () => {
    expect(freeFlight(0.5, 0, 0.1)).toBeCloseTo(0.05, 9);
    expect(freeFlight(0.5, 1e-3, 0.1)).toBeCloseTo(0.05, 4);
    expect(freeFlight(0.99, 1000, 0.1)).toBeLessThan(0.005);
    for (const j of [0, 0.3, 0.999]) for (const s of [0.1, 5, 300]) {
      const x = freeFlight(j, s, 0.1);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(0.1);
    }
    // Monotone in j: a finer random number never reads earlier.
    let last = -1;
    for (let j = 0; j <= 1; j += 0.05) { const x = freeFlight(j, 20, 0.1); expect(x).toBeGreaterThanOrEqual(last); last = x; }
  });
});

describe('the view draws the planes exactly', () => {
  const code = (params: Record<string, unknown>) => compileGraph({ nodes: [
    n('timeCube', 'src', 0, 0), n('timeCubeView', 'v', 300, 0, params, { volume: ['src', 'volume'] }), n('output', 'out', 600, 0, {}, { color: ['v', 'color'] }),
  ] });
  it('meets the box exactly, stops on the slice plane, and on each highlighted frame when they are on', () => {
    const plain = code({});
    expect(plain.success).toBe(true);
    expect(plain.fragmentShader).toMatch(/tcRayRoundBoxIn\(\w+_ro, \w+_rd/);
    expect(plain.fragmentShader).toMatch(/if \(!\w+_sDone && \w+_ls <= \w+_tb\)/);
    expect(plain.fragmentShader).not.toMatch(/tcCombNext\(/.source + '\\(\\w');
    const hl = code({ highlights: true, motion: true });
    expect(hl.success).toBe(true);
    expect(hl.fragmentShader).toMatch(/tcCombNext\(\w+_gf, \w+_dir, \w+_hl\)/);
    expect(hl.fragmentShader).toMatch(/tcFootprint\(/);
  });
});
