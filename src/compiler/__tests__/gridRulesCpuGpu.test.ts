/**
 * The Grid Rules builder's try board steps on the CPU (gridRules/cpu.ts, gridRules/tryRun.ts); the
 * node steps on the GPU (gridRules/glsl.ts). Here they are run side by side from the same board for
 * every kind of rule (Life-like counts, a radius, Stages, Stencils, Blocks, Smooth's three
 * templates) and must give the same board after every step, so what you try is what you build.
 * Also the drawn start: the GPU deals the drawing where the CPU stamps it, and the step-through
 * (forward, back, forward again) lands on the same boards.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { n } from '../../store/graphBuilder';
import { COUNT_PRESETS, GRID_DEFAULTS, LOOKS, SMOOTH_PRESETS, STAGES_PRESETS, gridShape, gridSignature, presetPatch } from '../../gridRules/spec';
import { BLOCK_PRESETS, PATTERN_PRESETS } from '../../gridRules/stencils';
import { gridCellsId } from '../gridRulesExpand';
import { boardFrom, compileNodes, gridOf, randomGrid, rounded, stepperFor, type Grid } from './gridHarness';
import { makeBoard, texel, type Board } from './glslRun';
import { cpuBoard, cpuSeed, cpuStep, type CpuBoard } from '../../gridRules/cpu';
import { startCellsFromGrid } from '../../gridRules/startCells';
import { tryBack, tryBoardOf, tryForward, tryStart } from '../../gridRules/tryRun';

const G = 'node_3';
const graph = (params: Record<string, unknown>) => [
  n('gridRules', G, 0, 0, { label: 'Test', rate: 1, steps: 1, afterglow: 0, ...params }),
  n('output', 'node_9', 0, 0, {}, { color: [G, 'color'] }),
];
// A step every frame (the CPU steps once a call), one step a frame.
const full = (p: Record<string, unknown>): Record<string, unknown> => ({ ...GRID_DEFAULTS, afterglow: 0, ...p, rate: 1, steps: 1 });
const stepper = (p: Record<string, unknown>, w: number, h: number) => stepperFor(compileNodes(graph(p)), gridCellsId(G), w, h);

/** A CPU board from grids of the two channels (rows top first). */
function cpuFrom(a: Grid, b?: Grid): CpuBoard {
  const h = a.length, w = a[0].length;
  const B = cpuBoard(w, h);
  for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) { B.a[(h - 1 - r) * w + x] = a[r][x]; if (b) B.b[(h - 1 - r) * w + x] = b[r][x]; }
  return B;
}
const cpuGrid = (B: CpuBoard, ch: 'a' | 'b' = 'a'): Grid => Array.from({ length: B.h }, (_, r) => Array.from({ length: B.w }, (_, x) => B[ch][(B.h - 1 - r) * B.w + x]));
const smoothGrid = (w: number, h: number, seed: number, scale = 1): Grid => randomGrid(w, h, seed, 0.25).map(row => row.map((v, x) => v * scale * (0.5 + ((x * 7 + seed) % 5) / 10)));

describe('the try board (CPU) steps exactly as the node (GPU)', { timeout: 60000 }, () => {
  const whole: Array<[string, Record<string, unknown>, number]> = [
    ['Life, wrap', { ruleType: 'count', ...presetPatch(COUNT_PRESETS.life) }, 1],
    ['HighLife, walls', { ruleType: 'count', ...presetPatch(COUNT_PRESETS.highLife), edges: 'walls' }, 1],
    ['Diamonds (von Neumann)', { ruleType: 'count', ...presetPatch(COUNT_PRESETS.diamonds) }, 1],
    ['radius 2 circle, walls', { ruleType: 'count', neighbourhood: 'radius', radius: 2, shape: 'circle', bornLo: 4, bornHi: 6, surviveLo: 3, surviveHi: 8, edges: 'walls' }, 1],
    ['Brian\'s Brain (Stages)', { ruleType: 'stages', ...presetPatch(STAGES_PRESETS.briansBrain) }, 2],
    ['Star Wars (Stages), walls', { ruleType: 'stages', ...presetPatch(STAGES_PRESETS.starWars), edges: 'walls' }, 3],
    ['Wireworld (Stencils)', { ruleType: 'patterns', ...presetPatch(PATTERN_PRESETS.wireworld) }, 3],
    ['Falling dots (Stencils), walls', { ruleType: 'patterns', ...presetPatch(PATTERN_PRESETS.fallingDots), edges: 'walls' }, 1],
    ['Crystal (Stencils, a count)', { ruleType: 'patterns', ...presetPatch(PATTERN_PRESETS.crystal) }, 1],
  ];
  for (const [name, params, maxState] of whole) {
    it(`${name}: the same states after each of 8 steps`, () => {
      const P = full(params);
      const w = 14, h = 11;
      const start = randomGrid(w, h, 11 + w, 0.35, maxState);
      const st = stepper(P, w, h);
      let b = boardFrom(start, gridSignature(gridShape(P)), P.edges === 'walls' ? 'clamp' : 'repeat');
      let c = cpuFrom(start);
      // Walls keep the outer ring empty: the first step clears it on both.
      for (let k = 0; k < 8; k++) {
        b = st.step(b);
        c = cpuStep(P, c);
        expect(rounded(gridOf(b)), `${name}, step ${k + 1}`).toEqual(cpuGrid(c).map(r => r.map(v => Math.round(v))));
      }
    });
  }

  it('Blocks (falling sand, gas): the same states, dice and Jitter included', () => {
    for (const [name, params] of [['sand', { ...BLOCK_PRESETS.sand.params, jitter: 0.5 }], ['gas', BLOCK_PRESETS.gas.params]] as const) {
      const P = full({ ruleType: 'blocks', ...params });
      const w = 12, h = 10;
      const start = randomGrid(w, h, 3, 0.4, Number(P.states) - 1);
      const st = stepper(P, w, h);
      let b = boardFrom(start, gridSignature(gridShape(P)), P.edges === 'walls' ? 'clamp' : 'repeat');
      let c = cpuFrom(start);
      c.step = 0;
      for (let k = 0; k < 10; k++) {
        st.uniforms.u_time = (k + 0.5) / 60; // frame k, as the CPU's step count
        b = st.step(b);
        c = cpuStep(P, c);
        expect(rounded(gridOf(b)), `${name}, step ${k + 1}`).toEqual(cpuGrid(c).map(r => r.map(v => Math.round(v))));
      }
    }
  });

  const smooth: Array<[string, Record<string, unknown>]> = [
    ['Heat (diffusion)', { ruleType: 'smooth', ...presetPatch(SMOOTH_PRESETS.heat) }],
    ['Ripples (waves), walls', { ruleType: 'smooth', ...presetPatch(SMOOTH_PRESETS.ripples), edges: 'walls' }],
    ['Mitosis (reaction–diffusion)', { ruleType: 'smooth', ...presetPatch(SMOOTH_PRESETS.mitosis) }],
  ];
  for (const [name, params] of smooth) {
    it(`${name}: the same values (to 1e-4) after each of 12 steps`, () => {
      const P = full({ ...params, steps: 1 });
      const s = gridShape(P);
      const w = 12, h = 10;
      const u = smoothGrid(w, h, 5), v = s.template === 'waves' ? smoothGrid(w, h, 9) : s.template === 'reaction' ? smoothGrid(w, h, 9, 1) : Array.from({ length: h }, () => Array(w).fill(0));
      // Reaction–diffusion: the GPU keeps 1 − A in red, the CPU A.
      const gpuU = u.map(r => r.map(x => (s.template === 'reaction' ? x * 0.3 : x)));
      const cpuA = s.template === 'reaction' ? gpuU.map(r => r.map(x => 1 - x)) : gpuU;
      const st = stepper(P, w, h);
      let b = boardFrom(gpuU, gridSignature(s), P.edges === 'walls' ? 'clamp' : 'repeat', v);
      let c = cpuFrom(cpuA, v);
      for (let k = 0; k < 12; k++) {
        b = st.step(b);
        c = cpuStep(P, c);
        const g = gridOf(b), gg = gridOf(b, 1), ca = cpuGrid(c), cb = cpuGrid(c, 'b');
        for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) {
          const gu = s.template === 'reaction' ? 1 - g[r][x] : g[r][x];
          expect(Math.abs(gu - ca[r][x]), `${name}, step ${k + 1}, u at ${x},${r}`).toBeLessThan(1e-4);
          expect(Math.abs(gg[r][x] - cb[r][x]), `${name}, step ${k + 1}, v at ${x},${r}`).toBeLessThan(1e-4);
        }
      }
    });
  }
});

describe('a drawn start', { timeout: 60000 }, () => {
  const drawing = startCellsFromGrid([
    [0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 2],
  ])!;

  it('is cropped to its cells, and every kind of rule compiles with it', () => {
    expect(drawing).toEqual({ w: 5, h: 5, rows: ['.1...', '..1..', '111..', '.....', '....2'] });
    for (const [type, pr] of [['count', COUNT_PRESETS.life], ['stages', STAGES_PRESETS.briansBrain], ['patterns', PATTERN_PRESETS.wireworld], ['blocks', BLOCK_PRESETS.sand], ['smooth', SMOOTH_PRESETS.heat], ['smooth', SMOOTH_PRESETS.ripples], ['smooth', SMOOTH_PRESETS.mitosis]] as const) {
      const r = compileNodes(graph({ ruleType: type, ...presetPatch(pr), start: 'cells', startCells: drawing }));
      expect(r.success, `${type} ${pr.label}: ${(r.errors ?? []).join('; ')}`).toBe(true);
    }
  });

  for (const [name, params] of [
    ['Life', { ruleType: 'count', ...presetPatch(COUNT_PRESETS.life) }],
    ['Wireworld', { ruleType: 'patterns', ...presetPatch(PATTERN_PRESETS.wireworld) }],
    ['Ripples', { ruleType: 'smooth', ...presetPatch(SMOOTH_PRESETS.ripples) }],
  ] as const) {
    it(`${name}: the GPU deals the drawing where the CPU stamps it, on even and odd boards`, () => {
      for (const [w, h] of [[16, 12], [15, 9]]) {
        const P = full({ ...params, start: 'cells', startCells: drawing, steps: 1 });
        const st = stepper(P, w, h);
        const fresh: Board = makeBoard(w, h); // a new Pass: Alpha 0, so the step deals the start
        const b = st.step(fresh);
        const c = cpuSeed(P, w, h);
        expect(texel(b, 0, 0)[3]).toBe(gridSignature(gridShape(P)));
        const g = gridOf(b), ca = cpuGrid(c);
        if (params.ruleType === 'smooth') expect(g.map(r => r.map(v => Math.round(v * 1000) / 1000))).toEqual(ca.map(r => r.map(v => Math.round(v * 1000) / 1000)));
        else expect(rounded(g)).toEqual(ca.map(r => r.map(v => Math.round(v))));
        expect(ca.flat().filter(v => v > 0).length, `${w} × ${h}`).toBeGreaterThan(0);
      }
    });
  }

  it('a new drawing is a new signature (so the board is dealt again); the drawing is clamped to the rule\'s states', () => {
    const P = full({ ruleType: 'count', start: 'cells', startCells: drawing });
    const other = full({ ruleType: 'count', start: 'cells', startCells: startCellsFromGrid([[1, 1, 1]]) });
    expect(gridSignature(gridShape(P))).not.toBe(gridSignature(gridShape(other)));
    expect(gridSignature(gridShape(P))).toBeGreaterThanOrEqual(100);
    // Count has two states: the drawn 2 becomes 1.
    const c = cpuSeed(P, 9, 9);
    expect(Math.max(...c.a)).toBe(1);
  });
});

describe('stepping through on the try board', { timeout: 60000 }, () => {
  it('forward, back and forward again land on the GPU\'s boards', () => {
    const P = full({ ruleType: 'count', ...presetPatch(COUNT_PRESETS.life), ...LOOKS.count, afterglow: 0 });
    const w = 12, h = 12;
    const start = randomGrid(w, h, 21, 0.4);
    const st = stepper(P, w, h);
    const gpu: Grid[] = [start];
    let b = boardFrom(start, gridSignature(gridShape(P)));
    for (let k = 0; k < 6; k++) { b = st.step(b); gpu.push(rounded(gridOf(b))); }
    let run = tryStart(cpuFrom(start));
    const at = () => cpuGrid(tryBoardOf(run)).map(r => r.map(v => Math.round(v)));
    run = tryForward(P, run, 4);
    expect(at()).toEqual(gpu[4]);
    run = tryBack(tryBack(run));
    expect(at()).toEqual(gpu[2]);
    run = tryForward(P, run, 4);
    expect(at()).toEqual(gpu[6]);
  });
});
