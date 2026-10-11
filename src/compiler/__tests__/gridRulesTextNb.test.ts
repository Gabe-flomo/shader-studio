/**
 * Grid Rules: text as a start, neighbourhoods you draw, and Open as nodes with a drawn start
 * (docs/grid-rules.md "A text start", "Your own neighbourhood", "Open as nodes").
 *
 *  - words rasterise to the cells the stroke font covers, and a text start deals them on the GPU
 *    where the CPU try board stamps them;
 *  - a custom (weighted) neighbourhood steps the same on the CPU and the GPU, step after step;
 *  - the Moore and von Neumann stencils give exactly the built-in neighbourhoods' boards;
 *  - Open as nodes with a drawn or a text start compiles, deals the drawing, and steps as the node.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { n } from '../../store/graphBuilder';
import { COUNT_PRESETS, GRID_DEFAULTS, SMOOTH_PRESETS, STAGES_PRESETS, gridShape, gridSignature, presetPatch } from '../../gridRules/spec';
import { STENCIL_PRESETS, readStencil, stencilFromRows, stencilMax, stencilWeights } from '../../gridRules/neighbourhoods';
import { textCellGrid, textStampCells, textStartCells, readStartText } from '../../gridRules/textCells';
import { startCellsFromGrid, stampedAt } from '../../gridRules/startCells';
import { gridCellsId } from '../gridRulesExpand';
import { boardFrom, compileNodes, gridOf, randomGrid, rounded, stepperFor, type Grid } from './gridHarness';
import { makeBoard } from './glslRun';
import { cpuBoard, cpuSeed, cpuStep, type CpuBoard } from '../../gridRules/cpu';
import { liveNeighbours } from '../../gridRules/tryRun';
import { gridAsNodesProblem, gridRulesAsNodes } from '../../store/gridRulesAsNodes';
import type { GraphNode } from '../../types/nodeGraph';
import { parseGrid, printGrid } from '../../lang/dialects/grid';

const G = 'node_3';
const graph = (params: Record<string, unknown>) => [
  n('gridRules', G, 0, 0, { label: 'Test', rate: 1, steps: 1, afterglow: 0, ...params }),
  n('output', 'node_9', 0, 0, {}, { color: [G, 'color'] }),
];
const full = (p: Record<string, unknown>): Record<string, unknown> => ({ ...GRID_DEFAULTS, afterglow: 0, ...p, rate: 1, steps: 1 });
const stepper = (p: Record<string, unknown>, w: number, h: number) => stepperFor(compileNodes(graph(p)), gridCellsId(G), w, h);

function cpuFrom(a: Grid): CpuBoard {
  const h = a.length, w = a[0].length;
  const B = cpuBoard(w, h);
  for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) B.a[(h - 1 - r) * w + x] = a[r][x];
  return B;
}
const cpuGrid = (B: CpuBoard): Grid => Array.from({ length: B.h }, (_, r) => Array.from({ length: B.w }, (_, x) => Math.round(B.a[(B.h - 1 - r) * B.w + x])));
const art = (g: number[][]) => g.map(r => r.map(v => (v ? '#' : '.')).join(''));

describe('text rasterises to cells', () => {
  it('a letter is the cells its strokes cover: an L is a column and a foot', () => {
    const g = art(textCellGrid('L', 10, 0.16));
    const rows = g.filter(r => r.includes('#'));
    // Ten-ish rows tall, the left column on all of them, a full-width foot.
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.length).toBeLessThanOrEqual(12);
    const left = rows.map(r => r.indexOf('#'));
    expect(new Set(left).size).toBe(1);
    const foot = rows[rows.length - 1];
    expect(foot.split('').filter(c => c === '#').length).toBeGreaterThanOrEqual(6);
    // Above the foot, only the column: no cells to the right of it.
    for (const r of rows.slice(0, -2)) expect(r.slice(left[0] + 3).includes('#')).toBe(false);
  });

  it('an I is symmetric, an O is a closed ring, a T is a bar and a stem', () => {
    const I = art(textCellGrid('I', 12));
    for (const r of I) expect(r).toBe([...r].reverse().join(''));
    const O = textCellGrid('O', 14);
    // The middle cell of an O is empty, and a row through the middle crosses two strokes.
    const mid = O[Math.floor(O.length / 2)];
    expect(mid[Math.floor(mid.length / 2)]).toBe(0);
    const runs = art([mid])[0].split('.').filter(Boolean).length;
    expect(runs).toBe(2);
    const T = art(textCellGrid('T', 12)).filter(r => r.includes('#'));
    expect(T[0].split('').filter(c => c === '#').length).toBeGreaterThan(T[4].split('').filter(c => c === '#').length);
  });

  it('thin strokes stay joined (no gaps), the same words always give the same cells, unknown characters are dropped', () => {
    for (const ch of 'AEKMNSVWXZ') {
      const g = textCellGrid(ch, 6, 0.02);
      // Flood the on cells from one of them: every on cell is reached (8-connected).
      const on = new Set<string>();
      g.forEach((r, y) => r.forEach((v, x) => { if (v) on.add(`${x},${y}`); }));
      const first = [...on][0];
      const seen = new Set([first]);
      const todo = [first];
      while (todo.length) {
        const [x, y] = todo.pop()!.split(',').map(Number);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = `${x + dx},${y + dy}`; if (on.has(k) && !seen.has(k)) { seen.add(k); todo.push(k); } }
      }
      expect(seen.size, ch).toBe(on.size);
    }
    expect(textCellGrid('HI', 9)).toEqual(textCellGrid('hi', 9));
    expect(textCellGrid('H~I', 9)).toEqual(textCellGrid('HI', 9));
    expect(textCellGrid('~~', 9)).toEqual([]);
  });

  it('a text start is a drawn start: cropped, centred, moved by x and y, in the chosen state', () => {
    const st = readStartText({ text: 'HI', size: 8, weight: 0.2, x: 0, y: 0, state: 2 });
    const sc = textStartCells(st)!;
    expect(sc.rows.join('').replace(/\./g, '').split('').every(c => c === '2')).toBe(true);
    // Stamped on a 40 × 20 board, the letters' middle is the board's middle (within a cell).
    const cells: Array<[number, number]> = [];
    for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) if (stampedAt(sc, 40, 20, x, y)) cells.push([x, y]);
    const mx = (Math.min(...cells.map(c => c[0])) + Math.max(...cells.map(c => c[0]))) / 2;
    const my = (Math.min(...cells.map(c => c[1])) + Math.max(...cells.map(c => c[1]))) / 2;
    expect(Math.abs(mx - 19.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(my - 9.5)).toBeLessThanOrEqual(1);
    // Moved 5 right and 3 up.
    const moved = textStartCells({ ...st, x: 5, y: 3 })!;
    for (const [x, y] of cells) expect(stampedAt(moved, 40, 20, x + 5, y + 3)).toBe(2);
    // The stamp tool puts the same letters round the pointer.
    const stamp = textStampCells('HI', 8, 0.2, 20, 10);
    expect(stamp.length).toBe(cells.length);
  });
});

describe('as text (the Recipe tab and the Do… bar)', () => {
  it('reads and prints start=text text="…" text-size=, and neighbours=custom', () => {
    const r = parseGrid('life start=text text="GO" text-size=9');
    expect(r.errors).toEqual([]);
    expect(r.params.start).toBe('text');
    expect(readStartText(r.params.startText)).toMatchObject({ text: 'GO', size: 9 });
    const printed = printGrid(r.params);
    expect(printed).toMatch(/start=text/);
    expect(printed).toMatch(/text="GO"/);
    expect(printed).toMatch(/text-size=9/);
    expect(parseGrid(printed).params.startText).toEqual(r.params.startText);
    const c = parseGrid('count neighbours=custom', { base: { stencil: STENCIL_PRESETS.ring.stencil } });
    expect(c.errors).toEqual([]);
    expect(c.params.neighbourhood).toBe('custom');
    expect(printGrid(c.params)).toMatch(/neighbours=custom/);
  });
});

describe('a text start on the GPU', { timeout: 60000 }, () => {
  it('compiles for every kind of rule, and deals the letters where the CPU stamps them (then Life runs on them alike)', () => {
    const startText = { text: 'GO', size: 9, weight: 0.18, x: 2, y: -1 };
    for (const [type, pr] of [['count', COUNT_PRESETS.life], ['stages', STAGES_PRESETS.briansBrain], ['smooth', SMOOTH_PRESETS.heat]] as const) {
      const P = full({ ruleType: type, ...presetPatch(pr), start: 'text', startText, steps: 1 });
      const w = 36, h = 21;
      const st = stepper(P, w, h);
      let b = st.step(makeBoard(w, h));
      let c = cpuSeed(P, w, h);
      expect(gridSignature(gridShape(P))).toBeGreaterThanOrEqual(100);
      if (type === 'smooth') { expect(rounded(gridOf(b))).toEqual(cpuGrid(c)); continue; }
      expect(rounded(gridOf(b))).toEqual(cpuGrid(c));
      expect(cpuGrid(c).flat().filter(v => v === 1).length).toBeGreaterThan(20);
      if (type !== 'count') continue;
      for (let k = 0; k < 6; k++) {
        b = st.step(b);
        c = cpuStep(P, c);
        expect(rounded(gridOf(b)), `step ${k + 1}`).toEqual(cpuGrid(c));
      }
    }
  });
});

describe('a neighbourhood you draw', { timeout: 60000 }, () => {
  it('stencils read back defensively; weights and the most they count', () => {
    const st = stencilFromRows(['.2.', '1.1', '.3.']);
    expect(stencilWeights(st)).toEqual([[0, 1, 2], [-1, 0, 1], [1, 0, 1], [0, -1, 3]]);
    expect(stencilMax(st)).toBe(7);
    expect(readStencil({ size: 9, cells: [1, 1] }).size).toBe(3);
    expect(readStencil(null)).toEqual(STENCIL_PRESETS.moore.stencil);
    // The middle is never counted.
    expect(stencilWeights(readStencil({ size: 3, cells: [0, 0, 0, 0, 5, 0, 0, 0, 0] }))).toEqual([]);
  });

  it('the Moore and von Neumann presets are the built-in neighbourhoods, board for board (CPU and GPU)', () => {
    for (const [name, preset, builtIn] of [
      ['Life', STENCIL_PRESETS.moore, COUNT_PRESETS.life],
      ['HighLife', STENCIL_PRESETS.moore, COUNT_PRESETS.highLife],
      ['Diamonds', STENCIL_PRESETS.vonNeumann, COUNT_PRESETS.diamonds],
    ] as const) {
      const P = full({ ruleType: 'count', ...presetPatch(builtIn) });
      const C = full({ ruleType: 'count', ...presetPatch(builtIn), neighbourhood: 'custom', stencil: preset.stencil });
      const w = 14, h = 11;
      const start = randomGrid(w, h, 29, 0.38);
      let a = cpuFrom(start), b = cpuFrom(start);
      const ga = stepper(P, w, h), gb = stepper(C, w, h);
      let A = boardFrom(start, gridSignature(gridShape(P))), Bd = boardFrom(start, gridSignature(gridShape(C)));
      for (let k = 0; k < 8; k++) {
        a = cpuStep(P, a); b = cpuStep(C, b);
        A = ga.step(A); Bd = gb.step(Bd);
        expect(cpuGrid(b), `${name} CPU step ${k + 1}`).toEqual(cpuGrid(a));
        expect(rounded(gridOf(Bd)), `${name} GPU step ${k + 1}`).toEqual(rounded(gridOf(A)));
      }
    }
    // A 5 × 5 stencil of ones is radius 2 (a box).
    const box5 = stencilFromRows(['11111', '11111', '11.11', '11111', '11111']);
    const R = full({ ruleType: 'count', neighbourhood: 'radius', radius: 2, shape: 'box', bornLo: 6, bornHi: 9, surviveLo: 5, surviveHi: 11 });
    // 24 counts: past the switches' 23, so Born and Survive are ranges, as the radius rule's.
    const S = full({ ...R, neighbourhood: 'custom', stencil: box5 });
    let a = cpuFrom(randomGrid(13, 12, 5, 0.4)), b = cpuFrom(randomGrid(13, 12, 5, 0.4));
    for (let k = 0; k < 6; k++) { a = cpuStep(R, a); b = cpuStep(S, b); expect(cpuGrid(b)).toEqual(cpuGrid(a)); }
  });

  for (const [name, params] of [
    ['a weighted cross, wrap', { ruleType: 'count', neighbourhood: 'custom', stencil: stencilFromRows(['..1..', '..2..', '12.21', '..2..', '..1..']), bornMask: (1 << 3) | (1 << 5), surviveMask: (1 << 2) | (1 << 3) | (1 << 4) | (1 << 6) }],
    ['the ring, walls', { ruleType: 'count', neighbourhood: 'custom', stencil: STENCIL_PRESETS.ring.stencil, bornMask: (1 << 4) | (1 << 5), surviveMask: (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6), edges: 'walls' }],
    ['hex-ish, Stages', { ruleType: 'stages', neighbourhood: 'custom', stencil: STENCIL_PRESETS.hex.stencil, bornMask: 1 << 2, surviveMask: (1 << 3) | (1 << 4), states: 4 }],
    ['a 7 × 7 weighted blob counted as ranges', { ruleType: 'count', neighbourhood: 'custom', stencil: { size: 7, cells: Array.from({ length: 49 }, (_, i) => ((i % 7) + Math.floor(i / 7)) % 3 + 1) }, bornLo: 40, bornHi: 60, surviveLo: 35, surviveHi: 70 }],
  ] as const) {
    it(`${name}: the CPU and the GPU agree after each of 8 steps`, () => {
      const P = full(params);
      const w = 15, h = 12;
      const max = Number((params as unknown as { states?: number }).states ?? 2) - 1;
      const start = randomGrid(w, h, 41, 0.42, max);
      const st = stepper(P, w, h);
      let b = boardFrom(start, gridSignature(gridShape(P)), P.edges === 'walls' ? 'clamp' : 'repeat');
      let c = cpuFrom(start);
      const seen = new Set<string>();
      for (let k = 0; k < 8; k++) {
        b = st.step(b);
        c = cpuStep(P, c);
        expect(rounded(gridOf(b)), `${name}, step ${k + 1}`).toEqual(cpuGrid(c));
        seen.add(JSON.stringify(cpuGrid(c)));
      }
      expect(seen.size, 'the board changes').toBeGreaterThan(1);
    });
  }

  it('the try board counts the weights (what the pointer says is what the rule counts)', () => {
    const P = full({ ruleType: 'count', neighbourhood: 'custom', stencil: stencilFromRows(['.3.', '...', '...']) });
    const B = cpuFrom([[0, 1, 0], [0, 0, 0], [0, 0, 0]]);
    expect(liveNeighbours(P, B, 1, 1)).toBe(3);
  });
});

describe('Open as nodes with a drawn or text start', { timeout: 60000 }, () => {
  const drawing = startCellsFromGrid([[0, 1, 0], [0, 0, 1], [1, 1, 1]])!;
  for (const [name, params] of [
    ['Life from a drawing', { start: 'cells', startCells: drawing }],
    ['Life from text', { start: 'text', startText: { text: 'HI', size: 6 } }],
    ['Brian\'s Brain from a drawing', { ruleType: 'stages', ...STAGES_PRESETS.briansBrain.params, start: 'cells', startCells: startCellsFromGrid([[1, 2], [2, 1]]) }],
    ['Heat from text', { ruleType: 'smooth', ...SMOOTH_PRESETS.heat.params, start: 'text', startText: { text: 'O', size: 6 } }],
    ['a custom neighbourhood from a drawing', { neighbourhood: 'custom', stencil: STENCIL_PRESETS.hex.stencil, bornMask: 1 << 2, surviveMask: (1 << 2) | (1 << 3), start: 'cells', startCells: drawing }],
  ] as const) {
    it(`${name}: compiles, deals the drawing on a new board and steps as the node`, () => {
      const src = n('gridRules', G, 0, 0, { label: 'Test', rate: 1, afterglow: 0, ...params });
      expect(gridAsNodesProblem(src)).toBeNull();
      let k = 100;
      const opened = gridRulesAsNodes(src, () => `node_${k++}`, { x: 0, y: 600 }, new Set(['color']));
      const nodes: GraphNode[] = [src, ...opened.nodes, n('output', 'node_9', 0, 0, {}, { color: [opened.outputs.color!.nodeId, opened.outputs.color!.outputKey] })];
      const r = compileNodes(nodes);
      expect(r.errors, name).toBeUndefined();
      for (const nd of opened.nodes) expect(String(nd.params.__comment ?? '').length, `${nd.id} note`).toBeGreaterThan(20);
      const W = 17, H = 12;
      const compact = stepperFor(r, gridCellsId(G), W, H);
      const graphS = stepperFor(r, opened.boardId, W, H);
      // A new board (Alpha 0): both deal the drawing.
      let a = compact.step(makeBoard(W, H));
      let b = graphS.step(makeBoard(W, H));
      const P = full(params);
      expect(rounded(gridOf(b))).toEqual(rounded(gridOf(a)));
      expect(rounded(gridOf(a))).toEqual(cpuGrid(cpuSeed(P, W, H)));
      expect(gridOf(a).flat().some(v => v > 0.5)).toBe(true);
      for (let s = 1; s <= 5; s++) {
        compact.uniforms.u_time = graphS.uniforms.u_time = 1 + s / 60;
        a = compact.step(a);
        b = graphS.step(b);
        const [ra, rb] = [gridOf(a).flat(), gridOf(b).flat()];
        ra.forEach((v, i) => expect(rb[i], `${name}, step ${s}, red ${i}`).toBeCloseTo(v, 4));
      }
    });
  }

  it('a custom neighbourhood of more than 24 cells opens too (counted in one block)', () => {
    const src = n('gridRules', 'x', 0, 0, { neighbourhood: 'custom', stencil: { size: 7, cells: Array(49).fill(1) } });
    expect(gridAsNodesProblem(src)).toBeNull();
  });
});
