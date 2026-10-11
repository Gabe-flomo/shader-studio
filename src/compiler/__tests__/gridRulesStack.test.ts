/**
 * Stacked rules on a base (gridRules/stack.ts, docs/grid-rules.md "Stacked rules"): every rule card
 * run on the GPU (the board Pass's stages, stepped here by glslRun.ts with the Pass's Step uniform)
 * and on the CPU (the try board) from the same board gives the same board, step after step; the
 * order of the cards matters as designed; a stacked spec compiles into one board Pass whose Repeat
 * is 1 + cards; and each card does what it says on a small hand-laid board.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { n } from '../../store/graphBuilder';
import { COUNT_PRESETS, GRID_DEFAULTS, STAGES_PRESETS, gridShape, gridSignature, presetPatch, ruleSummary } from '../../gridRules/spec';
import { PATTERN_PRESETS } from '../../gridRules/stencils';
import { MAX_STACK, STACK_RECIPES, activeStack, describeStackRule, newStackRule, readStack, stackedSteps, type StackKind, type StackRule } from '../../gridRules/stack';
import { gridCellsId } from '../gridRulesExpand';
import { boardFrom, compileNodes, gridOf, randomGrid, rounded, type Grid } from './gridHarness';
import { compileFragment, drawPass, type Board, type Env } from './glslRun';
import { cpuBoard, cpuStep, type CpuBoard } from '../../gridRules/cpu';
import { tryBack, tryBoardOf, tryForward, tryStart } from '../../gridRules/tryRun';
import { parseGrid, printGrid } from '../../lang/dialects/grid';

const G = 'node_3';
const graph = (params: Record<string, unknown>) => [
  n('gridRules', G, 0, 0, { label: 'Test', rate: 1, steps: 1, afterglow: 0, ...params }),
  n('output', 'node_9', 0, 0, {}, { color: [G, 'color'] }),
];
const full = (p: Record<string, unknown>): Record<string, unknown> => ({ ...GRID_DEFAULTS, afterglow: 0, ...p, rate: 1, steps: 1 });
const card = (kind: StackKind, o: Partial<StackRule> = {}): StackRule => ({ ...newStackRule(kind), ...o });
const life = (stack: StackRule[], extra: Record<string, unknown> = {}) => full({ ruleType: 'count', ...presetPatch(COUNT_PRESETS.life), stack, ...extra });

/** The board Pass of a stacked node, stepped a whole frame at a time: every stage of its Repeat, each with its Step. */
function stackedStepper(P: Record<string, unknown>, w: number, h: number) {
  const r = compileNodes(graph(P));
  if (!r.success) throw new Error(`compile failed: ${(r.errors ?? []).join('; ')}`);
  const pass = r.passes!.find(p => p.nodeId === gridCellsId(G))!;
  const program = compileFragment(pass.fragmentShader);
  const repeat = pass.repeat ?? 1;
  const uniforms: Env = {
    ...(r.paramUniforms as Env), u_time: 1, u_frameDt: 1 / 60, u_resolution: [w, h], u_mouse: [-1000, -1000], u_mousebtn: 0,
    [`u_passprev_${pass.slug}_px`]: [1 / w, 1 / h], [`u_pass_${pass.slug}_px`]: [1 / w, 1 / h],
  };
  const frame = (b: Board, k: number): Board => {
    uniforms.u_time = (k + 0.5) / 60; // frame k: the dice's frame number, as the CPU's step count
    let cur = b;
    for (let i = 0; i < repeat; i++) {
      uniforms[`u_passiter_${pass.slug}`] = [i, repeat];
      cur = drawPass(program, w, h, pass.wrap === 'repeat' ? 'repeat' : 'clamp', { [`u_passprev_${pass.slug}`]: cur }, uniforms);
    }
    return cur;
  };
  return { pass, repeat, frame, uniforms };
}

function cpuFrom(a: Grid): CpuBoard {
  const h = a.length, w = a[0].length;
  const B = cpuBoard(w, h);
  for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) B.a[(h - 1 - r) * w + x] = a[r][x];
  B.step = 0;
  return B;
}
const cpuGrid = (B: CpuBoard): Grid => Array.from({ length: B.h }, (_, r) => Array.from({ length: B.w }, (_, x) => Math.round(B.a[(B.h - 1 - r) * B.w + x])));
const blank = (w: number, h: number): Grid => Array.from({ length: h }, () => Array(w).fill(0));
const live = (g: Grid) => g.flat().filter(v => v !== 0).length;

/** Runs the GPU stages and the CPU try step side by side for `steps` frames; the same states after each. */
function agree(name: string, P: Record<string, unknown>, start: Grid, steps = 8) {
  const w = start[0].length, h = start.length;
  const st = stackedStepper(P, w, h);
  let b = boardFrom(start, gridSignature(gridShape(P)), P.edges === 'walls' ? 'clamp' : 'repeat');
  let c = cpuFrom(start);
  const seen: number[] = [];
  for (let k = 0; k < steps; k++) {
    b = st.frame(b, k);
    c = cpuStep(P, c);
    const g = rounded(gridOf(b));
    expect(g, `${name}, step ${k + 1}`).toEqual(cpuGrid(c));
    seen.push(live(g));
  }
  return seen;
}

describe('stacked rules: the try board (CPU) steps exactly as the node (GPU)', { timeout: 120000 }, () => {
  const cases: Array<[string, Record<string, unknown>, number?]> = [
    ['Life + explode (8 copies, 2 away, half the time)', life([card('explode', { copies: 8, distance: 2, chance: 0.5 })])],
    ['Life + explode, walls, keep the pair, 3 copies 1 away', life([card('explode', { copies: 3, distance: 1, keep: true, chance: 1 })], { edges: 'walls' })],
    ['Life + crowd dies (4 or more)', life([card('crowd', { lo: 4, chance: 0.7 })])],
    ['Life + crowd moves away, walls', life([card('crowd', { lo: 3, move: true, chance: 1 })], { edges: 'walls' })],
    ['Life + drift right (live only)', life([card('drift', { dir: 2, chance: 0.6 })])],
    ['Brian\'s Brain + drift up-left (every cell), walls', full({ ruleType: 'stages', ...presetPatch(STAGES_PRESETS.briansBrain), edges: 'walls', stack: [card('drift', { dir: 7, any: true, chance: 1 })] }), 2],
    ['Life + cluster (radius 2, 10 or more → dies)', life([card('cluster', { radius: 2, lo: 10, becomes: 0, chance: 0.8 })])],
    ['Star Wars + cluster → dying stage 2', full({ ruleType: 'stages', ...presetPatch(STAGES_PRESETS.starWars), stack: [card('cluster', { radius: 1, lo: 4, becomes: 2 })] }), 3],
    ['Wireworld (Stencils) + drift down', full({ ruleType: 'patterns', ...presetPatch(PATTERN_PRESETS.wireworld), stack: [card('drift', { dir: 4, chance: 0.5 })] }), 3],
    ['Life + four cards at once', life([card('explode', { copies: 4, distance: 3, chance: 0.4 }), card('drift', { dir: 1, chance: 0.5 }), card('crowd', { lo: 5, move: true }), card('cluster', { radius: 3, lo: 20 })])],
  ];
  for (const [name, P, maxState] of cases) {
    it(name, () => {
      const start = randomGrid(16, 12, 7 + name.length, 0.35, maxState ?? 1);
      const seen = agree(name, P, start);
      // Something is alive on the way (the comparison isn't of empty boards).
      expect(Math.max(...seen), name).toBeGreaterThan(0);
    });
  }

  it('step-through on the try board lands on the GPU\'s boards (forward, back, forward again)', () => {
    const P = life([card('explode', { copies: 8, distance: 2, chance: 0.5 }), card('drift', { dir: 2, chance: 0.4 })]);
    const start = randomGrid(14, 10, 99, 0.35);
    const st = stackedStepper(P, 14, 10);
    let b = boardFrom(start, gridSignature(gridShape(P)));
    const gpu: Grid[] = [];
    for (let k = 0; k < 6; k++) { b = st.frame(b, k); gpu.push(rounded(gridOf(b))); }
    let run = tryStart(cpuFrom(start));
    run = tryForward(P, run, 6);
    run = tryBack(tryBack(tryBack(run)));
    expect(cpuGrid(tryBoardOf(run))).toEqual(gpu[2]);
    run = tryForward(P, run, 3);
    expect(cpuGrid(tryBoardOf(run))).toEqual(gpu[5]);
  });

  it('a frame Speed skips leaves the cards out too (the board stays as it was)', () => {
    const P = { ...life([card('drift', { dir: 2, chance: 1 })]), rate: 0.5 };
    const start = randomGrid(12, 9, 5, 0.4);
    const st = stackedStepper(P, 12, 9);
    let b = boardFrom(start, gridSignature(gridShape(P)));
    // Clock at 0: frame 1 adds 0.5 (no step), frame 2 reaches 1 (a step).
    b = st.frame(b, 0);
    expect(rounded(gridOf(b))).toEqual(start);
    b = st.frame(b, 1);
    expect(rounded(gridOf(b))).not.toEqual(start);
  });
});

describe('stacking order matters as designed', { timeout: 60000 }, () => {
  // A pair meeting in the middle of an empty board: Life alone kills it; explode turns it into copies.
  const pairBoard = (): Grid => { const g = blank(13, 11); g[5][6] = 1; g[5][7] = 1; return g; };

  it('explode after Life: the base runs first, so a pair Life is about to kill is gone before it can meet', () => {
    const P = life([card('explode', { copies: 8, distance: 2, chance: 1 })]);
    const B = cpuStep(P, cpuFrom(pairBoard()));
    expect(live(cpuGrid(B))).toBe(0);
  });

  it('on a still base (no births, everything survives), the pair explodes into 8 copies each and vanishes', () => {
    const still = full({ ruleType: 'count', bornMask: 0, surviveMask: 511, stack: [card('explode', { copies: 8, distance: 2, chance: 1 })] });
    const B = cpuStep(still, cpuFrom(pairBoard()));
    const g = cpuGrid(B);
    expect(g[5][6]).toBe(0);
    expect(g[5][7]).toBe(0);
    // Each of the two cells throws 8 copies 2 away; two of them land on the same cell? No: they are a cell apart, so 16 distinct cells.
    expect(live(g)).toBe(16);
    expect(g[3][6]).toBe(1); // 2 above the left cell
    expect(g[5][9]).toBe(1); // 2 right of the right cell
    agree('still + explode', still, pairBoard(), 3);
  });

  it('crowd then explode is not explode then crowd', () => {
    // A still base, so only the cards act. A plus of five cells: the middle has 4 live neighbours, each arm 3
    // (the middle and the two arms beside it, diagonally).
    const still = { ruleType: 'count', bornMask: 0, surviveMask: 511 };
    const plus = (): Grid => { const g = blank(15, 15); for (const [r, x] of [[7, 7], [6, 7], [8, 7], [7, 6], [7, 8]]) g[r][x] = 1; return g; };
    const crowd = card('crowd', { lo: 4, chance: 1 });
    const boom = card('explode', { lo: 2, hi: 2, copies: 4, distance: 1, chance: 1 });
    const a = cpuGrid(cpuStep(full({ ...still, stack: [crowd, boom] }), cpuFrom(plus())));
    const b = cpuGrid(cpuStep(full({ ...still, stack: [boom, crowd] }), cpuFrom(plus())));
    // Crowd first: the middle dies, leaving four arms with 2 neighbours each, which then explode into copies.
    expect(a[6][7]).toBe(0); // the top arm exploded and vanished
    expect(a[5][7]).toBe(1); // its copy above
    expect(live(a)).toBeGreaterThan(4);
    // Explode first: nothing has exactly 2 neighbours, so nothing explodes; then the middle dies of crowding.
    expect(live(b)).toBe(4);
    expect(a).not.toEqual(b);
    agree('crowd → explode', full({ ...still, stack: [crowd, boom] }), plus(), 2);
    agree('explode → crowd', full({ ...still, stack: [boom, crowd] }), plus(), 2);
  });

  it('cards run one after another: right then left comes back; right twice goes two cells', () => {
    const still = { ruleType: 'count', bornMask: 0, surviveMask: 511, edges: 'walls' };
    const g = blank(9, 5); g[2][4] = 1;
    const right = card('drift', { dir: 2, chance: 1 }), left = card('drift', { dir: 6, chance: 1 });
    expect(cpuGrid(cpuStep(full({ ...still, stack: [right, left] }), cpuFrom(g)))).toEqual(g);
    // Two rights: two cells a step.
    expect(cpuGrid(cpuStep(full({ ...still, stack: [right, right] }), cpuFrom(g)))[2][6]).toBe(1);
  });
});

describe('each card does what it says', () => {
  const still = { ruleType: 'count', bornMask: 0, surviveMask: 511 };
  it('crowd → move: a crowded cell steps away from its neighbours into an empty cell', () => {
    // An L: the corner (row 4, col 4) has neighbours right and below: it steps up-left.
    const g = blank(9, 9);
    for (const [r, x] of [[4, 4], [4, 5], [5, 4], [5, 5]]) g[r][x] = 1;
    const B = cpuGrid(cpuStep(full({ ...still, stack: [card('crowd', { lo: 3, move: true })] }), cpuFrom(g)));
    // Each cell of a 2×2 block has 3 neighbours and steps diagonally out: the block opens up.
    expect(B[3][3]).toBe(1);
    expect(B[3][6]).toBe(1);
    expect(B[6][3]).toBe(1);
    expect(B[6][6]).toBe(1);
    expect(live(B)).toBe(4);
  });
  it('cluster: only cells in a big enough clump change', () => {
    const g = blank(12, 12);
    for (let r = 2; r < 7; r++) for (let x = 2; x < 7; x++) g[r][x] = 1; // a 5×5 block
    g[10][10] = 1; // a lone cell
    const B = cpuGrid(cpuStep(full({ ...still, stack: [card('cluster', { radius: 1, lo: 8, becomes: 0 })] }), cpuFrom(g)));
    // The inner 3×3 has all 8 neighbours: it dies; the rim and the lone cell stay.
    expect(B[4][4]).toBe(0);
    expect(B[2][2]).toBe(1);
    expect(B[10][10]).toBe(1);
    expect(live(B)).toBe(25 - 9 + 1);
  });
  it('drift: blocked cells wait for the way to clear', () => {
    const g = blank(8, 3); g[1][2] = 1; g[1][3] = 1;
    const B = cpuGrid(cpuStep(full({ ...still, stack: [card('drift', { dir: 2, chance: 1 })] }), cpuFrom(g)));
    expect(B[1].slice(0, 6)).toEqual([0, 0, 1, 0, 1, 0]);
  });
});

describe('the spec → graph', () => {
  it('compiles into one board Pass whose Repeat is Steps × (1 + cards), with the Step wired in', () => {
    for (const k of [1, 2, 4]) {
      const stack = Array.from({ length: k }, (_, i) => card((['explode', 'crowd', 'drift', 'cluster'] as const)[i % 4]));
      const r = compileNodes(graph({ ruleType: 'count', ...presetPatch(COUNT_PRESETS.life), stack }));
      expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
      const boards = r.passes!.filter(p => p.nodeId === gridCellsId(G));
      expect(boards).toHaveLength(1);
      expect(boards[0].repeat).toBe(1 + k);
      expect(boards[0].fragmentShader).toContain('u_passiter_');
    }
    // Steps a frame: within the Pass's 64 draws.
    const r = compileNodes(graph({ ruleType: 'count', ...presetPatch(COUNT_PRESETS.life), steps: 16, stack: [card('drift'), card('crowd'), card('explode'), card('cluster')] }));
    expect(r.passes!.find(p => p.nodeId === gridCellsId(G))!.repeat).toBe(stackedSteps(16, 4) * 5);
    expect(stackedSteps(16, 4)).toBe(12);
  });

  it('every recipe compiles; a stack on Blocks or Smooth is kept but not run', () => {
    for (const rc of STACK_RECIPES) {
      const P = { ruleType: rc.base.ruleType, ...presetPatch(({ count: COUNT_PRESETS, stages: STAGES_PRESETS, patterns: PATTERN_PRESETS } as Record<string, Record<string, Parameters<typeof presetPatch>[0]>>)[rc.base.ruleType][rc.base.preset]), stack: readStack(rc.stack) };
      const r = compileNodes(graph(P));
      expect(r.success, `${rc.label}: ${(r.errors ?? []).join('; ')}`).toBe(true);
      expect(gridShape(P).stack.length).toBe(rc.stack.length);
    }
    for (const t of ['blocks', 'smooth']) {
      const P = { ruleType: t, stack: [card('drift')] };
      expect(gridShape(P).stack).toEqual([]);
      expect(activeStack(t, P.stack)).toEqual([]);
      const r = compileNodes(graph(P));
      expect(r.success).toBe(true);
      expect(r.passes!.find(p => p.nodeId === gridCellsId(G))!.repeat ?? 1).toBe(1);
    }
  });

  it('a switched-off card isn\'t run; at most four cards are read; the summary counts them', () => {
    const P = { ruleType: 'count', stack: [card('drift'), { ...card('crowd'), off: true }] };
    expect(gridShape(P).stack.map(r => r.kind)).toEqual(['drift']);
    expect(readStack(Array.from({ length: 6 }, () => card('drift')))).toHaveLength(MAX_STACK);
    expect(ruleSummary(P)).toBe('Count B3/S23 + 1 rule');
    expect(describeStackRule(card('explode', { copies: 8, distance: 2, chance: 0.5 }))).toBe('When two live cells meet (touching only each other), it explodes into 8 copies 2 away and vanishes (50% of the time).');
  });

  it('reads and prints as text: `then` lines after the rule', () => {
    const P = { ...GRID_DEFAULTS, ...presetPatch(COUNT_PRESETS.life), ruleType: 'count', stack: [card('explode', { copies: 8, distance: 2, chance: 0.5 }), card('drift', { dir: 1, any: true }), card('crowd', { lo: 4, move: true, off: true }), card('cluster', { radius: 3, lo: 20, becomes: 0 })] };
    const text = printGrid(P, { pretty: true });
    expect(text).toContain('then explode copies=8 distance=2 chance=0.5');
    expect(text).toContain('then drift dir=ne any');
    expect(text).toContain('then crowd at=4 move @off');
    const back = parseGrid(text);
    expect(back.errors).toEqual([]);
    expect(readStack(back.params.stack)).toEqual(readStack(P.stack));
    expect(parseGrid('life · then explode copies=12').errors.length).toBeGreaterThan(0);
    expect(parseGrid('life · then wobble').errors[0].message).toMatch(/explode, crowd, drift, cluster, move or collide/);
  });
});
