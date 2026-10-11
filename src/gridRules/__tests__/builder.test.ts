/**
 * The Grid Rules builder's pure parts: the try board's step-through (tryRun.ts), a drawn start
 * (startCells.ts), the before/after pictures (ruleExamples.ts), Smooth in plain words
 * (smoothWords.ts), the Waves template's pace, Surprise me's determinism, and the entry other
 * builders open Grid Rules with (builders/open.ts gridSeedParams).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { cpuBoard, cpuStep } from '../cpu';
import { BLOCK_PRESETS, PATTERN_PRESETS, readBlocks, readPatterns } from '../stencils';
import { GRID_DEFAULTS, LOOKS, SMOOTH_PRESETS, gridTypeDefaults, presetPatch, stepsPerSecond } from '../spec';
import { MAX_FRAMES, blockRects, changesBetween, clearedBoard, liveNeighbours, paintCell, patternMatches, tryBack, tryBoardOf, tryEdit, tryForward, tryGeneration, tryRewind, tryStart } from '../tryRun';
import { MAX_START, drawnCount, readStartCells, stampedAt, startCellAt, startCellsFromBoard, startCellsFromGrid, startCellsHash } from '../startCells';
import { blockExample, comboBoard, comboStep, gridOfBoard, patternExample, patternSentence } from '../ruleExamples';
import { SMOOTH_WORDS, halfLifeSteps, smoothDemo } from '../smoothWords';
import { surpriseGrid } from '../surprise';
import { gridSeedParams } from '../../builders/open';

const LIFE = { ...GRID_DEFAULTS, ruleType: 'count' };
/** A board from rows (top first) of states. */
function boardOf(rows: number[][]) {
  const h = rows.length, w = rows[0].length;
  const B = cpuBoard(w, h);
  rows.forEach((row, r) => row.forEach((v, x) => { B.a[(h - 1 - r) * w + x] = v; }));
  return B;
}

describe('stepping through', () => {
  const blinker = () => boardOf([
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);

  it('forward steps the rule; back shows the frame before; forward again reuses it', () => {
    let run = tryStart(blinker());
    run = tryForward(LIFE, run);
    expect(tryGeneration(run)).toBe(1);
    expect(gridOfBoard(tryBoardOf(run)).map(r => r.join(''))).toEqual(['00000', '00100', '00100', '00100', '00000']);
    const one = tryBoardOf(run);
    run = tryForward(LIFE, run, 3);
    expect(tryGeneration(run)).toBe(4);
    run = tryBack(tryBack(tryBack(run)));
    expect(tryBoardOf(run)).toBe(one); // the same frame, not a new step
    run = tryRewind(run);
    expect(tryGeneration(run)).toBe(0);
    expect(tryBack(run)).toBe(run); // the start stays the start
  });

  it('drawing changes the frame shown and drops the frames after it', () => {
    let run = tryForward(LIFE, tryStart(blinker()), 5);
    run = tryBack(tryBack(run));
    const drawn = paintCell(tryBoardOf(run), 0, 0, 1);
    run = tryEdit(run, drawn);
    expect(run.frames.length).toBe(run.at + 1);
    expect(tryBoardOf(run).a[0]).toBe(1);
    // Painting copies: the frame it came from is untouched.
    expect(run.frames[run.at - 1].a[0]).toBe(0);
  });

  it('keeps the last MAX_FRAMES, counting generations on', () => {
    const run = tryForward(LIFE, tryStart(blinker()), MAX_FRAMES + 25);
    expect(run.frames.length).toBe(MAX_FRAMES);
    expect(tryGeneration(run)).toBe(MAX_FRAMES + 25);
  });

  it('what the next step does, and what a cell counts', () => {
    const B = blinker();
    const next = cpuStep(LIFE, B);
    const ch = changesBetween(B, next);
    expect([...ch.values()].filter(k => k === 'born')).toHaveLength(2);
    expect([...ch.values()].filter(k => k === 'dies')).toHaveLength(2);
    expect(liveNeighbours(LIFE, B, 2, 3)).toBe(3); // above the middle: born
    expect(liveNeighbours({ ...LIFE, neighbourhood: 'vonNeumann' }, B, 2, 3)).toBe(1);
    expect(gridOfBoard(clearedBoard(B)).flat().every(v => v === 0)).toBe(true);
  });

  it('a stencil rule lights the cells it matches; blocks lie where the next step cuts them', () => {
    const P = { ...GRID_DEFAULTS, ruleType: 'patterns', ...presetPatch(PATTERN_PRESETS.fallingDots) };
    const B = boardOf([[0, 0, 0], [0, 1, 0], [0, 0, 0]]);
    expect([...patternMatches(P, B, 0)]).toEqual([4]); // the dot, with nothing below it
    expect([...patternMatches(P, B, 1)]).toEqual([1]); // rule 2: the empty cell with the dot above it
    const S = { ...GRID_DEFAULTS, ruleType: 'blocks', ...presetPatch(BLOCK_PRESETS.sand), jitter: 0 };
    const rects = blockRects(S, cpuBoard(6, 4));
    expect(rects.length).toBeGreaterThan(0);
    for (const [x, y] of rects) { expect(Math.abs(x % 2)).toBe(0); expect(((y % 2) + 2) % 2).toBe(0); }
  });
});

describe('a drawn start', () => {
  it('crops to its cells and reads back; too big keeps the middle', () => {
    const sc = startCellsFromGrid([[0, 0, 0], [0, 3, 1], [0, 0, 0]])!;
    expect(sc).toEqual({ w: 2, h: 1, rows: ['31'] });
    expect(startCellAt(sc, 0, 0)).toBe(3);
    expect(startCellAt(sc, 5, 5)).toBe(0);
    expect(readStartCells(sc)).toEqual(sc);
    expect(readStartCells({ rows: [] })).toBeNull();
    expect(readStartCells('junk')).toBeNull();
    expect(startCellsFromGrid([[0, 0]])).toBeNull();
    const big = startCellsFromGrid(Array.from({ length: 80 }, () => Array(90).fill(1)))!;
    expect([big.w, big.h]).toEqual([MAX_START, MAX_START]);
    expect(drawnCount(sc)).toBe(2);
  });

  it('is stamped in the middle of a board, and a board reads back as the same drawing', () => {
    const sc = startCellsFromGrid([[1, 0, 1], [0, 1, 0]])!;
    const B = cpuBoard(9, 6);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 9; x++) B.a[y * 9 + x] = stampedAt(sc, 9, 6, x, y);
    expect(startCellsFromBoard(B)).toEqual(sc);
    expect(startCellsHash(sc)).toBe(startCellsHash(startCellsFromGrid([[1, 0, 1], [0, 1, 0]])));
    expect(startCellsHash(sc)).toBeGreaterThanOrEqual(0);
  });
});

describe('before and after pictures', () => {
  it('a Blocks rule alone: sand\'s first rule drops a pair of grains a row', () => {
    const [fall] = readBlocks(BLOCK_PRESETS.sand.params.blocks);
    const ex = blockExample(fall, 3);
    expect(ex.before.map(r => r.join(''))).toEqual(['0000', '0110', '0000', '0000']);
    expect(ex.after.map(r => r.join(''))).toEqual(['0000', '0000', '0110', '0000']);
  });

  it('a Stencils rule alone: a count rule gets the neighbours it asks for, the middle changes', () => {
    const [, , copper] = readPatterns(PATTERN_PRESETS.wireworld.params.patterns);
    const ex = patternExample(copper, 4);
    expect(ex.before[1][1]).toBe(3);
    expect(ex.before.flat().filter(v => v === 1)).toHaveLength(1);
    expect(ex.after[1][1]).toBe(1);
    expect(patternSentence(copper)).toBe('A cell that is 3 with 1 to 2 neighbours 1 becomes 1.');
    const [fall] = readPatterns(PATTERN_PRESETS.fallingDots.params.patterns);
    expect(patternSentence(fall)).toBe('A cell that is 1 with below empty becomes empty.');
  });

  it('rules together: one real step, each fired block named by its rule; sand keeps every grain', () => {
    const P = { ...GRID_DEFAULTS, ruleType: 'blocks', ...presetPatch(BLOCK_PRESETS.sand) };
    const B = comboBoard(P, 12, 8, 7);
    const all = new Set([0, 1, 2]);
    const s = comboStep(P, B, all);
    const count = (b: typeof B, k: number) => gridOfBoard(b).flat().filter(v => v === k).length;
    expect(count(s.after, 1)).toBe(count(B, 1));
    expect(count(s.after, 2)).toBe(count(B, 2));
    expect(s.fired.length).toBeGreaterThan(0);
    // Only rule 1 on: every block that fired is rule 1's.
    const alone = comboStep(P, B, new Set([0]));
    expect(alone.fired.every(f => f.rule === 0)).toBe(true);
    // The same board and seed: the same step.
    expect(gridOfBoard(comboStep(P, B, all).after)).toEqual(gridOfBoard(s.after));
  });
});

describe('Smooth in plain words', () => {
  it('every template has a plain name and a line; every setting a line', () => {
    for (const w of Object.values(SMOOTH_WORDS)) {
      expect(w.title.length).toBeGreaterThan(3);
      expect(w.line.length).toBeGreaterThan(40);
      for (const x of w.settings) expect(x.line.length, x.key).toBeGreaterThan(30);
    }
    expect(SMOOTH_WORDS.diffusion.settings.map(x => x.label)).toEqual(['Spreads', 'Cools']);
    expect(SMOOTH_WORDS.waves.settings.map(x => x.label)).toEqual(['Ripple speed', 'Ripples last']);
  });

  it('a feel for the numbers: half-lives in steps', () => {
    expect(Math.round(halfLifeSteps(0.995))).toBe(138);
    expect(halfLifeSteps(1)).toBe(Infinity);
    expect(SMOOTH_WORDS.waves.settings[1].feel!({ damping: 0.995 })).toBe('half gone after about 138 steps');
    expect(SMOOTH_WORDS.diffusion.settings[1].feel!({ decay: 0 })).toBe('never fades');
  });

  it('the before/after demo follows its setting', () => {
    const slow = smoothDemo({ ...presetPatch(SMOOTH_PRESETS.heat), spread: 0.1 }, 'diffusion', 16);
    const fast = smoothDemo({ ...presetPatch(SMOOTH_PRESETS.heat), spread: 1 }, 'diffusion', 16);
    const peak = (b: typeof slow.after) => Math.max(...b.a);
    expect(peak(fast.after)).toBeLessThan(peak(slow.after)); // spreads faster: the hot spot is lower
    expect(peak(slow.before)).toBe(1);
  });
});

describe('the Waves template\'s pace', () => {
  it('picking Waves, the Ripples preset and a Waves surprise run at 30 steps a second at most, ripples at a followable speed', () => {
    const template = { ...GRID_DEFAULTS, ruleType: 'smooth', template: 'waves', ...LOOKS.ripples };
    const preset = { ...GRID_DEFAULTS, ruleType: 'smooth', ...presetPatch(SMOOTH_PRESETS.ripples) };
    for (const p of [template, preset] as Array<Record<string, unknown>>) {
      expect(stepsPerSecond(p)).toBeLessThanOrEqual(30);
      expect(Number(p.waveSpeed)).toBeLessThanOrEqual(0.6);
    }
    expect(Number(GRID_DEFAULTS.waveSpeed)).toBeLessThanOrEqual(0.6);
    let waves = 0;
    for (let seed = 1; seed < 400 && waves < 5; seed++) {
      const r = surpriseGrid(seed, { type: 'smooth' }).value.patch;
      if (r.template !== 'waves') continue;
      waves++;
      expect(stepsPerSecond({ ...GRID_DEFAULTS, ...r })).toBeLessThanOrEqual(30);
      expect(Number(r.waveSpeed)).toBeLessThanOrEqual(0.7);
    }
    expect(waves).toBeGreaterThan(0);
  });

  it('Life and the other types keep their pace', () => {
    expect(stepsPerSecond({ ...GRID_DEFAULTS, ...gridTypeDefaults('count') })).toBe(30);
    expect(stepsPerSecond({ ...GRID_DEFAULTS, ...presetPatch(SMOOTH_PRESETS.mitosis) })).toBe(480);
  });
});

describe('Surprise me', () => {
  it('the same seed gives the same rule for every kind kept', () => {
    for (const type of ['count', 'stages', 'patterns', 'blocks', 'smooth'] as const) {
      const a = surpriseGrid(9001, { type }), b = surpriseGrid(9001, { type });
      expect(a.value.patch, type).toEqual(b.value.patch);
      expect(a.value.patch.ruleType, type).toBe(type);
    }
  });
});

describe('opening Grid Rules from another builder', () => {
  it('a drawn start (rows of states) sets the start to the drawing; params pass through; an empty drawing is left out', () => {
    expect(gridSeedParams({ params: { ruleType: 'count' }, startCells: [[0, 1], [1, 1]] })).toEqual({
      ruleType: 'count', start: 'cells', startCells: { w: 2, h: 2, rows: ['.1', '11'] },
    });
    expect(gridSeedParams({ startCells: { w: 1, h: 1, rows: ['2'] } })).toEqual({ start: 'cells', startCells: { w: 1, h: 1, rows: ['2'] } });
    expect(gridSeedParams({ startCells: [[0, 0]] })).toEqual({});
    expect(gridSeedParams()).toEqual({});
  });
});
