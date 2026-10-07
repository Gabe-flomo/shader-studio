/**
 * Blocks (Margolus) on the CPU (gridRules/cpu.ts): the Falling sand preset behaves like sand —
 * a grain falls to the floor, a stack topples sideways, nothing is lost or made — and the Gas
 * preset keeps its particles. Jitter (gridRules/dice.ts) breaks up the rows falling grains line up
 * on, keeps every grain, and is reproducible: the same board and seed give the same run. The CPU
 * run is the editor's preview, and gives the GLSL's boards (compiler/__tests__/gridRulesStencils.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { cpuBoard, cpuSeed, cpuStep, type CpuBoard } from '../cpu';
import { presetPatch } from '../spec';
import { BLOCK_PRESETS, type BlockRule } from '../stencils';

const SAND: Record<string, unknown> = { ruleType: 'blocks', ...presetPatch(BLOCK_PRESETS.sand) };
/** Plain Margolus sand (Jitter 0), every slide taken: one cell a step, exactly. */
const CLASSIC: Record<string, unknown> = { ...SAND, jitter: 0, blocks: (SAND.blocks as BlockRule[]).map(r => ({ ...r, chance: 1 })) };
const GAS: Record<string, unknown> = { ruleType: 'blocks', ...presetPatch(BLOCK_PRESETS.gas) };

/** A board with grains (state 1) at the given cells (x right, y up). */
function board(w: number, h: number, cells: Array<[number, number]>, state = 1): CpuBoard {
  const B = cpuBoard(w, h);
  for (const [x, y] of cells) B.a[y * w + x] = state;
  return B;
}
const run = (P: Record<string, unknown>, B: CpuBoard, n: number) => { for (let i = 0; i < n; i++) B = cpuStep(P, B); return B; };
const cellsOf = (B: CpuBoard, state = 1) => [...B.a.keys()].filter(i => B.a[i] === state).map(i => [i % B.w, Math.floor(i / B.w)] as [number, number]);
const count = (B: CpuBoard, state: number) => B.a.reduce((k, v) => k + (v === state ? 1 : 0), 0);
/** A seeded random generator, so a start board repeats. */
const mulberry = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe('Falling sand preset', () => {
  it('has walls: sand needs a floor (wrapping, it falls out of the bottom for ever)', () => {
    expect(SAND.edges).toBe('walls');
    expect(GAS.edges).toBe('wrap');
  });

  it('has Jitter on (bands), the gas off (it flies straight)', () => {
    expect(SAND.jitter).toBe(1);
    expect(GAS.jitter).toBe(0);
  });

  it('a single grain above empty space falls straight down to the floor and stays', () => {
    for (const x of [0, 3, 4, 7]) {
      let B = board(8, 10, [[x, 9]]);
      B = run(CLASSIC, B, 12);
      expect(cellsOf(B)).toEqual([[x, 0]]);
      // Settled: more steps change nothing.
      B = run(CLASSIC, B, 5);
      expect(cellsOf(B)).toEqual([[x, 0]]);
    }
  });

  it('with Jitter too, a grain falls straight down to the floor and stays', () => {
    for (const x of [0, 3, 4, 7]) for (const seed of [1, 2, 3]) {
      let B = board(8, 10, [[x, 9]]);
      B = run({ ...SAND, seed }, B, 40);
      expect(cellsOf(B)).toEqual([[x, 0]]);
      B = run({ ...SAND, seed }, B, 10);
      expect(cellsOf(B)).toEqual([[x, 0]]);
    }
  });

  it('falls one cell a step (from the top row of its first block), Jitter 0', () => {
    let B = board(8, 10, [[3, 9]]);
    for (let y = 8; y >= 0; y--) {
      B = cpuStep(CLASSIC, B);
      expect(cellsOf(B)).toEqual([[3, y]]);
    }
  });

  it('a 2-grain stack next to empty space topples diagonally onto the floor', () => {
    // Every slide taken (CLASSIC): the top grain slides down to the side.
    let B = board(8, 6, [[2, 0], [2, 1]]);
    B = run(CLASSIC, B, 4);
    const cells = cellsOf(B);
    expect(cells).toHaveLength(2);
    expect(cells.every(([, y]) => y === 0)).toBe(true);
    expect(cells.some(([x]) => x === 2)).toBe(true);
    expect(cells.some(([x]) => x === 1 || x === 3)).toBe(true);
  });

  it('a stack on a wall cell keeps the wall and slides off it', () => {
    let B = board(8, 6, [[2, 1]]);
    B.a[0 * 8 + 2] = 2; // a wall under the grain
    B = run(CLASSIC, B, 4);
    expect(B.a[2]).toBe(2);
    expect(cellsOf(B)).toHaveLength(1);
    expect(cellsOf(B)[0][1]).toBe(0);
  });

  it('a dropped clump settles into a heap with sloping sides, the space above it empty', () => {
    // A solid 6 × 6 block of sand high up in a 32 × 24 box.
    const cells: Array<[number, number]> = [];
    for (let y = 16; y < 22; y++) for (let x = 13; x < 19; x++) cells.push([x, y]);
    let B = board(32, 24, cells);
    B = run(SAND, B, 200);
    expect(count(B, 1)).toBe(36);
    const height = (x: number) => { let k = 0; while (k < B.h && B.a[k * B.w + x] === 1) k++; return k; };
    // Every grain rests on the floor or on another grain (no floating grains, no gaps in a column).
    for (const [x, y] of cellsOf(B)) expect(y).toBeLessThan(height(x));
    // A heap: lower at the sides than in the middle, and wider than the clump was.
    const hs = Array.from({ length: 32 }, (_, x) => height(x));
    const peak = Math.max(...hs);
    expect(peak).toBeLessThan(6);
    expect(hs.filter(k => k > 0).length).toBeGreaterThan(6);
    // Neighbouring columns differ by at most a few cells (the slide keeps slopes near 45°).
    for (let x = 1; x < 32; x++) expect(Math.abs(hs[x] - hs[x - 1])).toBeLessThanOrEqual(3);
  });

  it('keeps every grain and wall over many steps (walls and wrap, odd sizes too)', () => {
    for (const [w, h, edges] of [[64, 48, 'walls'], [63, 47, 'walls'], [64, 48, 'wrap']] as const) {
      const P = { ...SAND, edges, start: 'noise', density: 0.35 };
      let B = cpuSeed(P, w, h);
      // Odd boards: the last row / column has no block and is kept empty, so start it empty.
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x >= Math.floor(w / 2) * 2 || y >= Math.floor(h / 2) * 2) B.a[y * w + x] = 0;
      for (let i = 0; i < 40; i++) B.a[(5 + i % 3) * w + 10 + i] = 2; // a shelf of walls
      const sand = count(B, 1), walls = count(B, 2);
      expect(sand).toBeGreaterThan(100);
      for (let i = 0; i < 150; i++) {
        B = cpuStep(P, B);
        expect(count(B, 1)).toBe(sand);
      }
      expect(count(B, 2)).toBe(walls);
    }
  });
});

describe('Jitter', () => {
  /** A falling cloud: how far its grains are from half on even rows, half on odd (0 even, 1 all on one parity). */
  const banding = (P: Record<string, unknown>) => {
    const w = 96, h = 96;
    let B = cpuSeed({ ...P, start: 'centre', density: 0.35 }, w, h, mulberry(5));
    // Lift the cloud to the top half so it is still falling while it is measured.
    const lifted = cpuBoard(w, h);
    for (let y = 0; y < h - 30; y++) lifted.a.set(B.a.subarray(y * w, y * w + w), (y + 30) * w);
    B = lifted;
    let sum = 0, n = 0;
    for (let k = 0; k < 40; k++) {
      B = cpuStep(P, B);
      if (k < 6) continue;
      let even = 0, odd = 0;
      for (let y = 20; y < h; y++) for (let x = 0; x < w; x++) if (B.a[y * w + x] === 1) { if (y % 2) odd++; else even++; }
      sum += Math.abs(even - odd) / Math.max(1, even + odd); n++;
    }
    return sum / n;
  };

  it('breaks up the bands a falling cloud makes in plain Margolus', () => {
    // Plain Margolus: every falling grain ends each step on the same row parity.
    expect(banding({ ...SAND, jitter: 0 })).toBeGreaterThan(0.85);
    // Jitter 1: the two parities even out.
    expect(banding(SAND)).toBeLessThan(0.25);
  });

  it('keeps every grain and wall over many steps (walls and wrap, odd sizes, several amounts)', () => {
    for (const jitter of [0.3, 1]) for (const [w, h, edges] of [[64, 48, 'walls'], [63, 47, 'walls'], [64, 48, 'wrap'], [63, 47, 'wrap']] as const) {
      const P = { ...SAND, jitter, edges, start: 'noise', density: 0.35, seed: 3 };
      let B = cpuSeed(P, w, h, mulberry(w + h));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x >= Math.floor(w / 2) * 2 || y >= Math.floor(h / 2) * 2) B.a[y * w + x] = 0;
      for (let i = 0; i < 40; i++) B.a[(5 + i % 3) * w + 10 + i] = 2;
      const sand = count(B, 1), walls = count(B, 2);
      for (let i = 0; i < 300; i++) B = cpuStep(P, B);
      expect(count(B, 1), `${jitter} ${w}×${h} ${edges}`).toBe(sand);
      expect(count(B, 2)).toBe(walls);
    }
    // The gas with Jitter: a random walk, but every particle kept.
    let N = cpuSeed({ ...GAS, start: 'noise', density: 0.3 }, 48, 32, mulberry(9));
    const n = count(N, 1);
    N = run({ ...GAS, jitter: 0.8 }, N, 200);
    expect(count(N, 1)).toBe(n);
  });

  it('is reproducible: the same board and seed give the same run; another seed, another run', () => {
    const start = cpuSeed({ ...SAND, start: 'noise', density: 0.3 }, 40, 30, mulberry(2));
    const copy = (B: CpuBoard) => ({ ...B, a: B.a.slice(), b: B.b.slice() });
    const a = run(SAND, copy(start), 80), b = run(SAND, copy(start), 80);
    expect([...a.a]).toEqual([...b.a]);
    const c = run({ ...SAND, seed: 2 }, copy(start), 80);
    expect([...c.a]).not.toEqual([...a.a]);
  });

  it('a falling cloud still settles into a heap on the floor', () => {
    const w = 64, h = 48;
    let B = cpuSeed({ ...SAND, start: 'centre', density: 0.5 }, w, h, mulberry(4));
    const grains = count(B, 1);
    B = run(SAND, B, 400);
    expect(count(B, 1)).toBe(grains);
    const height = (x: number) => { let k = 0; while (k < h && B.a[k * w + x] === 1) k++; return k; };
    // Nothing in the air: every grain rests on the floor or on another grain.
    for (const [x, y] of cellsOf(B)) expect(y).toBeLessThan(height(x));
    const hs = Array.from({ length: w }, (_, x) => height(x));
    const peak = Math.max(...hs), at = hs.indexOf(peak);
    // A heap: highest near the middle, lower towards both sides.
    expect(Math.abs(at - w / 2)).toBeLessThan(10);
    expect(hs[at - 12]).toBeLessThan(peak);
    expect(hs[at + 12]).toBeLessThan(peak);
    for (let x = 1; x < w; x++) expect(Math.abs(hs[x] - hs[x - 1])).toBeLessThanOrEqual(3);
  });
});

describe('Gas (HPP) preset', () => {
  it('moves a lone particle one cell diagonally a step and keeps every particle', () => {
    let B = board(16, 16, [[6, 6]]);
    B = cpuStep(GAS, B);
    const [[x, y]] = cellsOf(B);
    expect(Math.abs(x - 6)).toBe(1);
    expect(Math.abs(y - 6)).toBe(1);
    let N = cpuSeed({ ...GAS, start: 'noise', density: 0.3 }, 48, 32);
    const n = count(N, 1);
    N = run(GAS, N, 100);
    expect(count(N, 1)).toBe(n);
  });
});
