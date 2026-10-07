/**
 * Grid Rules, Patterns and Blocks (gridRules/stencils.ts): the variants a symmetry stands for,
 * spec → GLSL, the compiled board against a CPU reference (pattern matching with rotations and
 * counts, Wireworld; Margolus gas), Margolus conservation (sand and gas, wrapping and walled, with
 * the dice on), and the presets.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { n } from '../../store/graphBuilder';
import { GRID_DEFAULTS, gridShape, gridSignature } from '../../gridRules/spec';
import {
  ANY, BLOCK_PRESETS, NOT_EMPTY, PATTERN_PRESETS, SAME, blockConserves, blockVariants, patternVariants, readBlocks, readPatterns,
  type BlockRule, type PatternRule,
} from '../../gridRules/stencils';
import { gridCellsId } from '../gridRulesExpand';
import { boardFrom, compileNodes, gridOf, margolusRef, patternsRef, randomGrid, rounded, stepperFor, type Grid } from './gridHarness';
import { makeBoard, texel } from './glslRun';
import { cpuBoard, cpuStep } from '../../gridRules/cpu';

const G = 'node_3';
const _ = ANY;
const graph = (params: Record<string, unknown>) => [
  n('gridRules', G, 0, 0, { label: 'Test', rate: 1, afterglow: 0, ...params }),
  n('output', 'node_9', 0, 0, {}, { color: [G, 'color'] }),
];
const shapeOf = (p: Record<string, unknown>) => gridShape({ ...GRID_DEFAULTS, ...p });
const stepper = (p: Record<string, unknown>, w: number, h: number) => stepperFor(compileNodes(graph(p)), gridCellsId(G), w, h);
const counts = (g: Grid) => g.flat().reduce<Record<number, number>>((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {});

describe('the variants a symmetry stands for', () => {
  it('a stencil turned four ways, and mirrored too; symmetric ones only once', () => {
    const above: PatternRule = { cells: [_, 1, _, _, 0, _, _, _, _], becomes: 1, symmetry: 'rotate' };
    const v = patternVariants(above);
    expect(v).toHaveLength(4);
    // Above, right, below, left of the middle.
    expect(v.map(c => c.indexOf(1)).sort()).toEqual([1, 3, 5, 7]);
    const corner: PatternRule = { cells: [1, 1, _, _, 0, _, _, _, _], becomes: 1, symmetry: 'all' };
    expect(patternVariants(corner)).toHaveLength(8);
    expect(patternVariants({ ...above, cells: [_, _, _, _, 0, _, _, _, _] })).toHaveLength(1);
  });

  it('a block mirrored, or turned four ways, after following before', () => {
    const fall: BlockRule = { before: [1, _, 0, _], after: [0, SAME, 1, SAME], symmetry: 'mirror', chance: 1 };
    expect(blockVariants(fall)).toEqual([fall, { before: [_, 1, _, 0], after: [SAME, 0, SAME, 1] }].map(x => ({ before: x.before, after: x.after })));
    const move: BlockRule = { before: [1, 0, 0, 0], after: [0, 0, 0, 1], symmetry: 'rotate', chance: 1 };
    const v = blockVariants(move);
    expect(v).toHaveLength(4);
    for (const { before, after } of v) expect(after.indexOf(1)).toBe(3 - before.indexOf(1)); // the opposite corner
  });

  it('knows which block rules conserve', () => {
    for (const pr of Object.values(BLOCK_PRESETS)) for (const r of readBlocks(pr.params.blocks)) expect(blockConserves(r), JSON.stringify(r)).toBe(true);
    expect(blockConserves({ before: [1, 0, 0, 0], after: [1, 1, 0, 0], symmetry: 'none', chance: 1 })).toBe(false);
    expect(blockConserves({ before: [NOT_EMPTY, 0, 0, 0], after: [0, 1, SAME, SAME], symmetry: 'none', chance: 1 })).toBe(false);
  });

  it('reads stored rules defensively', () => {
    expect(readPatterns([{ cells: [1, 2], becomes: 99 }])[0]).toMatchObject({ cells: [1, 2, _, _, _, _, _, _, _], becomes: 15, symmetry: 'none', count: null });
    expect(readBlocks([{ before: [1], chance: 7 }])[0]).toMatchObject({ before: [1, _, _, _], after: [SAME, SAME, SAME, SAME], chance: 1 });
    expect(readPatterns('nope')).toEqual([]);
  });
});

describe('Patterns', { timeout: 60000 }, () => {
  it('compile to one chain of tests, first match first, with the counts it needs', () => {
    const r = compileNodes(graph({ ruleType: 'patterns', ...PATTERN_PRESETS.wireworld.params }));
    expect(r.errors).toBeUndefined();
    const fs = r.passes!.find(p => p.nodeId === gridCellsId(G))!.fragmentShader;
    expect(fs).toMatch(/_k1 = /);
    expect((fs.match(/else if \(/g) ?? []).length).toBe(2);
  });

  it('match with rotations, against a reference', () => {
    const rules: PatternRule[] = [
      { cells: [_, 1, _, _, 0, _, _, _, _], becomes: 2, symmetry: 'rotate' },
      { cells: [1, _, _, _, 0, _, _, _, 1], becomes: 3, symmetry: 'all' },
      { cells: [_, _, _, _, 2, _, _, _, _], becomes: 0, symmetry: 'none' },
    ];
    const P = { ruleType: 'patterns', states: 4, patterns: rules };
    const start = randomGrid(9, 8, 4, 0.35, 3);
    const st = stepper(P, 9, 8);
    let b = boardFrom(start, gridSignature(shapeOf(P)));
    let want = start;
    for (let k = 0; k < 4; k++) {
      b = st.step(b); want = patternsRef(want, rules);
      expect(rounded(gridOf(b)), `step ${k + 1}`).toEqual(want);
    }
  });

  it('Wireworld: an electron runs along a wire, against a reference, with walls', () => {
    const rules = PATTERN_PRESETS.wireworld.params.patterns as PatternRule[];
    const P = { ruleType: 'patterns', edges: 'walls', ...PATTERN_PRESETS.wireworld.params };
    // A straight wire with an electron (head 1, tail 2) heading right.
    const start: Grid = Array.from({ length: 5 }, (_, r) => Array.from({ length: 12 }, (_, x) => (r === 2 && x >= 1 && x <= 10 ? (x === 3 ? 1 : x === 2 ? 2 : 3) : 0)));
    const st = stepper(P, 12, 5);
    let b = boardFrom(start, gridSignature(shapeOf(P)), 'clamp');
    let want = start;
    for (let k = 0; k < 5; k++) { b = st.step(b); want = patternsRef(want, rules, false); }
    expect(rounded(gridOf(b))).toEqual(want);
    expect(rounded(gridOf(b))[2].indexOf(1)).toBe(8); // moved five cells
  });
});

describe('Blocks (Margolus)', { timeout: 60000 }, () => {
  it('compile with the step\'s parity in blue, flipping every step', () => {
    const P = { ruleType: 'blocks', ...BLOCK_PRESETS.gas.params };
    const st = stepper(P, 8, 6);
    const b1 = st.step(boardFrom(randomGrid(8, 6, 1, 0.3), gridSignature(shapeOf(P))));
    expect(texel(b1, 0, 0)[2]).toBe(2);
    expect(texel(st.step(b1), 0, 0)[2]).toBe(0);
  });

  it('the gas against a reference, wrapping and walled', () => {
    const rules = BLOCK_PRESETS.gas.params.blocks as BlockRule[];
    for (const wrap of [true, false]) {
      const P = { ruleType: 'blocks', ...BLOCK_PRESETS.gas.params, edges: wrap ? 'wrap' : 'walls' };
      const start = randomGrid(10, 8, 7, 0.3);
      const st = stepper(P, 10, 8);
      let b = boardFrom(start, gridSignature(shapeOf(P)), wrap ? 'repeat' : 'clamp');
      let want = start;
      for (let k = 0; k < 6; k++) {
        b = st.step(b); want = margolusRef(want, rules, k % 2, wrap);
        expect(rounded(gridOf(b)), `wrap ${wrap}, step ${k + 1}`).toEqual(want);
      }
    }
  });

  it('conserve: sand and gas keep every state\'s count, odd boards and dice included', () => {
    for (const [name, pr] of Object.entries(BLOCK_PRESETS)) for (const edges of ['wrap', 'walls']) for (const [w, h] of [[10, 8], [11, 9]]) {
      const P = { ruleType: 'blocks', ...pr.params, edges };
      const states = Number(pr.params.states) - 1;
      // An odd last row or column has no block and is kept empty: start it empty.
      const start = randomGrid(w, h, 3 + w, 0.45, states).map((row, r) => row.map((v, x) => ((h % 2 && r === 0) || (w % 2 && x === w - 1) ? 0 : v)));
      const st = stepper(P, w, h);
      let b = boardFrom(start, gridSignature(shapeOf(P)), edges === 'wrap' ? 'repeat' : 'clamp');
      for (let k = 0; k < 8; k++) { st.uniforms.u_time = 1 + k / 60; b = st.step(b); }
      expect(counts(rounded(gridOf(b))), `${name}, ${edges}, ${w} × ${h}`).toEqual(counts(start));
    }
  });

  it('sand falls and piles on the floor', () => {
    const P = { ruleType: 'blocks', ...BLOCK_PRESETS.sand.params, edges: 'walls' };
    const start: Grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, x) => (r < 3 && x >= 2 && x <= 5 ? 1 : 0)));
    const st = stepper(P, 8, 8);
    let b = boardFrom(start, gridSignature(shapeOf(P)), 'clamp');
    // Jitter (on in the preset) makes grains fall about half a cell a step: 40 steps, not 20.
    for (let k = 0; k < 40; k++) { st.uniforms.u_time = 1 + k / 60; b = st.step(b); }
    const g = rounded(gridOf(b));
    expect(g.slice(0, 5).flat().every(v => v === 0)).toBe(true); // nothing left in the air
    expect(g[7].filter(v => v === 1).length).toBeGreaterThanOrEqual(4); // the floor row is covered
  });

  it('the CPU preview gives the same board as the GPU, step after step, Jitter and dice included', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['sand, jitter 1', { ...BLOCK_PRESETS.sand.params }],
      ['sand, jitter 0.4, seed 7', { ...BLOCK_PRESETS.sand.params, jitter: 0.4, seed: 7 }],
      ['sand, jitter 0', { ...BLOCK_PRESETS.sand.params, jitter: 0 }],
      ['gas, jitter 0.7', { ...BLOCK_PRESETS.gas.params, jitter: 0.7 }],
    ];
    for (const [name, params] of cases) for (const edges of ['walls', 'wrap']) for (const [w, h] of [[12, 10], [11, 9]]) {
      const P = { ruleType: 'blocks', rate: 1, afterglow: 0, ...params, edges };
      const states = Number(params.states) - 1;
      const start = randomGrid(w, h, 5 + w + h, 0.4, states).map((row, r) => row.map((v, x) => ((h % 2 && r === 0) || (w % 2 && x === w - 1) ? 0 : v)));
      const st = stepper(P, w, h);
      let b = boardFrom(start, gridSignature(shapeOf(P)), edges === 'wrap' ? 'repeat' : 'clamp');
      let c = cpuBoard(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.a[y * w + x] = start[h - 1 - y][x];
      c.step = 3;
      for (let k = 3; k < 15; k++) {
        // The GPU's dice use the frame number; the CPU's its step count: frame k on both.
        st.uniforms.u_time = (k + 0.5) / 60;
        b = st.step(b);
        c = cpuStep(P, c);
        const cpu: Grid = Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, x) => c.a[(h - 1 - r) * w + x]));
        expect(rounded(gridOf(b)), `${name}, ${edges}, ${w} × ${h}, frame ${k}`).toEqual(cpu);
      }
    }
  });
});

describe('presets and starts', { timeout: 60000 }, () => {
  it('every Patterns and Blocks preset compiles and steps from an empty Pass', () => {
    for (const [type, table] of [['patterns', PATTERN_PRESETS], ['blocks', BLOCK_PRESETS]] as const) for (const pr of Object.values(table)) {
      const P = { ruleType: type, ...pr.params };
      const st = stepper(P, 8, 6);
      const b = st.step(st.step(makeBoard(8, 6)));
      expect(texel(b, 1, 1)[3]).toBe(gridSignature(shapeOf(P)));
    }
  });

  it('an image start picks the state by brightness (0 dark … the last state white)', () => {
    const P = { ruleType: 'patterns', states: 4, start: 'image', patterns: [] };
    const [grid, out] = graph(P);
    const r = compileNodes([
      n('constant', 'node_5', 0, 0, { value: 0.68 }),
      n('floatToVec3', 'node_6', 0, 0, {}, { input: ['node_5', 'value'] }),
      n('pass', 'node_7', 0, 0, { scale: '0.125' }, { color: ['node_6', 'rgb'] }),
      { ...grid, inputs: { ...grid.inputs, image: { type: 'texture', label: 'Start image', connection: { nodeId: 'node_7', outputKey: 'texture' } } } },
      out,
    ]);
    expect(r.errors).toBeUndefined();
    const pic = r.passes!.find(p => p.nodeId === 'node_7')!;
    const grey = makeBoard(6, 4);
    for (let k = 0; k < 24; k++) grey.data.set([0.68, 0.68, 0.68, 1], k * 4);
    const st = stepperFor(r, gridCellsId(G), 6, 4, { [`u_pass_${pic.slug}_px`]: [0.125 / 6, 0.125 / 4] });
    st.samplers[`u_pass_${pic.slug}`] = grey;
    // 0.68 × 3 = 2.04: state 2.
    expect(gridOf(st.step(makeBoard(6, 4))).flat().every(v => v === 2)).toBe(true);
  });
});
