/**
 * Blocks (Margolus) on the CPU (gridRules/cpu.ts): the Falling sand preset behaves like sand —
 * a grain falls to the floor, a stack topples sideways, nothing is lost or made — and the Gas
 * preset keeps its particles. The CPU run is the editor's preview, and mirrors the GLSL's blocks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpuBoard, cpuSeed, cpuStep, type CpuBoard } from '../cpu';
import { presetPatch } from '../spec';
import { BLOCK_PRESETS } from '../stencils';

const SAND: Record<string, unknown> = { ruleType: 'blocks', ...presetPatch(BLOCK_PRESETS.sand) };
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

afterEach(() => vi.restoreAllMocks());

describe('Falling sand preset', () => {
  it('has walls: sand needs a floor (wrapping, it falls out of the bottom for ever)', () => {
    expect(SAND.edges).toBe('walls');
    expect(GAS.edges).toBe('wrap');
  });

  it('a single grain above empty space falls straight down to the floor and stays', () => {
    for (const x of [0, 3, 4, 7]) {
      let B = board(8, 10, [[x, 9]]);
      B = run(SAND, B, 12);
      expect(cellsOf(B)).toEqual([[x, 0]]);
      // Settled: more steps change nothing.
      B = run(SAND, B, 5);
      expect(cellsOf(B)).toEqual([[x, 0]]);
    }
  });

  it('falls one cell a step (from the top row of its first block)', () => {
    let B = board(8, 10, [[3, 9]]);
    for (let y = 8; y >= 0; y--) {
      B = cpuStep(SAND, B);
      expect(cellsOf(B)).toEqual([[3, y]]);
    }
  });

  it('a 2-grain stack next to empty space topples diagonally onto the floor', () => {
    // Every roll passes (the slide's chance is 0.8): the top grain slides down to the side.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let B = board(8, 6, [[2, 0], [2, 1]]);
    B = run(SAND, B, 4);
    const cells = cellsOf(B);
    expect(cells).toHaveLength(2);
    expect(cells.every(([, y]) => y === 0)).toBe(true);
    expect(cells.some(([x]) => x === 2)).toBe(true);
    expect(cells.some(([x]) => x === 1 || x === 3)).toBe(true);
  });

  it('a stack on a wall cell keeps the wall and slides off it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let B = board(8, 6, [[2, 1]]);
    B.a[0 * 8 + 2] = 2; // a wall under the grain
    B = run(SAND, B, 4);
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
