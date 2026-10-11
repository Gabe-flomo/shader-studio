/**
 * Movers on the grid (gridRules/stack.ts: headings, the Move and Collide cards, docs/grid-rules.md
 * "Movers"): the GPU stages and the try board's CPU step make the same board, value for value
 * (state and heading in red, age in green), step after step; a still base keeps every mover; each
 * collision does what it says on a hand-laid board; drawn headings are dealt alike.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { n } from '../../store/graphBuilder';
import { COUNT_PRESETS, GRID_DEFAULTS, STAGES_PRESETS, gridShape, gridSignature, presetPatch } from '../../gridRules/spec';
import { STACK_RECIPES, headingOfValue, newStackRule, readStack, withHeading, type StackKind, type StackRule } from '../../gridRules/stack';
import { gridCellsId } from '../gridRulesExpand';
import { compileNodes, gridOf } from './gridHarness';
import { compileFragment, drawPass, makeBoard, setTexel, type Board, type Env } from './glslRun';
import { cpuBoard, cpuSeed, cpuStep, type CpuBoard } from '../../gridRules/cpu';
import { tryBack, tryBoardOf, tryForward, tryStart } from '../../gridRules/tryRun';
import { startCellsFromBoard, readStartCells } from '../../gridRules/startCells';
import { stackRecipePatch } from '../../gridRules/stackRecipes';
import { parseGrid, printGrid } from '../../lang/dialects/grid';

const G = 'node_3';
type Vals = number[][];
const graph = (params: Record<string, unknown>) => [
  n('gridRules', G, 0, 0, { label: 'Test', rate: 1, steps: 1, afterglow: 0, ...params }),
  n('output', 'node_9', 0, 0, {}, { color: [G, 'color'] }),
];
const full = (p: Record<string, unknown>): Record<string, unknown> => ({ ...GRID_DEFAULTS, afterglow: 0, ...p, rate: 1, steps: 1 });
const card = (kind: StackKind, o: Partial<StackRule> = {}): StackRule => ({ ...newStackRule(kind), ...o });
/** A still base: nothing born, everything survives, so only the cards change the board. */
const still = (stack: StackRule[], extra: Record<string, unknown> = {}) => full({ ruleType: 'count', bornMask: 0, surviveMask: 511, stack, ...extra });
const life = (stack: StackRule[], extra: Record<string, unknown> = {}) => full({ ruleType: 'count', ...presetPatch(COUNT_PRESETS.life), stack, ...extra });

/** The board Pass stepped a whole frame (every stage of its Repeat). */
function stepper(P: Record<string, unknown>, w: number, h: number) {
  const r = compileNodes(graph(P));
  if (!r.success) throw new Error(`compile failed: ${(r.errors ?? []).join('; ')}`);
  const pass = r.passes!.find(p => p.nodeId === gridCellsId(G))!;
  const program = compileFragment(pass.fragmentShader);
  const repeat = pass.repeat ?? 1;
  const uniforms: Env = {
    ...(r.paramUniforms as Env), u_time: 1, u_frameDt: 1 / 60, u_resolution: [w, h], u_mouse: [-1000, -1000], u_mousebtn: 0,
    [`u_passprev_${pass.slug}_px`]: [1 / w, 1 / h], [`u_pass_${pass.slug}_px`]: [1 / w, 1 / h],
  };
  return (b: Board, k: number): Board => {
    uniforms.u_time = (k + 0.5) / 60;
    let cur = b;
    for (let i = 0; i < repeat; i++) {
      uniforms[`u_passiter_${pass.slug}`] = [i, repeat];
      cur = drawPass(program, w, h, pass.wrap === 'repeat' ? 'repeat' : 'clamp', { [`u_passprev_${pass.slug}`]: cur }, uniforms);
    }
    return cur;
  };
}

/** A seeded board of values: state 1 (or 1…maxState) with a random heading (or none) on a share of cells. */
function randomVals(w: number, h: number, seed: number, pOn: number, maxState = 1, pHead = 0.8, walls = false): Vals {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, x) => {
    if (walls && (r === 0 || x === 0 || r === h - 1 || x === w - 1)) return 0;
    if (rnd() >= pOn) return 0;
    const st = 1 + Math.floor(rnd() * maxState);
    return withHeading(st, rnd() < pHead ? 1 + Math.floor(rnd() * 8) : 0);
  }));
}
function boardOf(vals: Vals, sig: number, wrap: Board['wrap']): Board {
  const h = vals.length, w = vals[0].length;
  const b = makeBoard(w, h, wrap);
  for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) setTexel(b, x, h - 1 - r, [vals[r][x], 0, 0, sig]);
  return b;
}
function cpuOf(vals: Vals): CpuBoard {
  const h = vals.length, w = vals[0].length;
  const B = cpuBoard(w, h);
  for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) B.a[(h - 1 - r) * w + x] = vals[r][x];
  B.step = 0;
  return B;
}
const cpuVals = (B: CpuBoard, ch: 'a' | 'b' = 'a'): Vals => Array.from({ length: B.h }, (_, r) => Array.from({ length: B.w }, (_, x) => B[ch][(B.h - 1 - r) * B.w + x]));
const f32 = (g: Vals) => g.map(r => r.map(v => Math.fround(v)));
const occupied = (g: Vals) => g.flat().filter(v => Math.round(v) !== 0).length;
const headed = (g: Vals) => g.flat().filter(v => headingOfValue(v) > 0).length;

/** GPU and CPU side by side: the same red (state + heading) and green every step. */
function agree(name: string, P: Record<string, unknown>, start: Vals, steps = 10) {
  const w = start[0].length, h = start.length;
  const frame = stepper(P, w, h);
  let b = boardOf(start, gridSignature(gridShape(P)), P.edges === 'walls' ? 'clamp' : 'repeat');
  let c = cpuOf(start);
  const seen: Array<{ occupied: number; headed: number }> = [];
  for (let k = 0; k < steps; k++) {
    b = frame(b, k);
    c = cpuStep(P, c);
    const red = gridOf(b);
    expect(f32(red), `${name}, step ${k + 1} (red)`).toEqual(f32(cpuVals(c)));
    expect(f32(gridOf(b, 1)), `${name}, step ${k + 1} (green)`).toEqual(f32(cpuVals(c, 'b')));
    seen.push({ occupied: occupied(red), headed: headed(red) });
  }
  return seen;
}

describe('movers: the try board (CPU) steps exactly as the node (GPU), headings included', { timeout: 180000 }, () => {
  const cases: Array<[string, Record<string, unknown>, number?]> = [
    ['move (random headings), wrap', still([card('move', { assign: 0 })])],
    ['move, blocked ones bounce, walls', still([card('move', { assign: 0, act: 'bounce' })], { edges: 'walls' })],
    ['move, blocked ones turn, half the time', still([card('move', { assign: -1, act: 'turn', chance: 0.5 })])],
    ['move only cells heading right (who), others still', still([card('move', { assign: -1, who: 3 })])],
    ['collide bounce → move', still([card('collide', { act: 'bounce' }), card('move', { assign: -1 })])],
    ['collide turn → move, walls', still([card('collide', { act: 'turn' }), card('move', { assign: 0, act: 'bounce' })], { edges: 'walls' })],
    ['collide stop (60%) → move', still([card('collide', { act: 'stop', chance: 0.6 }), card('move', { assign: -1 })])],
    ['collide merge → move', still([card('collide', { act: 'merge' }), card('move', { assign: 0, act: 'turn' })])],
    ['collide explode (8 copies flying, 2 away) → move, walls', still([card('collide', { act: 'explode', copies: 8, distance: 2, fly: true }), card('move', { assign: -1, act: 'bounce' })], { edges: 'walls' })],
    ['collide explode (4 still copies, 4 away), wrap', still([card('collide', { act: 'explode', copies: 4, distance: 4, fly: false, chance: 0.7 }), card('move', { assign: -1 })])],
    ['Life → move (newborns pick a heading)', life([card('move', { assign: 0, chance: 0.8 })])],
    ['Brian\'s Brain → collide bounce (any) → move (any)', full({ ruleType: 'stages', ...presetPatch(STAGES_PRESETS.briansBrain), stack: [card('collide', { act: 'bounce', any: true }), card('move', { any: true, assign: 0 })] }), 2],
    ['drift carries headings; explode copies fly; cluster only cells heading up', still([card('drift', { dir: 6, chance: 0.5 }), card('explode', { copies: 8, distance: 2, fly: true, chance: 0.3 }), card('cluster', { radius: 1, lo: 3, becomes: 0, who: 1 })])],
    ['crowd moves away carrying headings, walls', still([card('crowd', { lo: 3, move: true }), card('move', { assign: -1 })], { edges: 'walls' })],
  ];
  for (const [name, P, maxState] of cases) {
    it(name, () => {
      const walls = P.edges === 'walls';
      const start = randomVals(14, 11, 11 + name.length, 0.3, maxState ?? 1, 0.8, walls);
      const seen = agree(name, P, start);
      expect(Math.max(...seen.map(x => x.occupied)), name).toBeGreaterThan(0);
    });
  }

  it('every recipe of movers steps the same on both', () => {
    for (const rc of STACK_RECIPES.filter(x => x.stack.some(c => c.kind === 'move' || c.kind === 'collide'))) {
      const P = full({ ...stackRecipePatch(rc.key)!, afterglow: 0 });
      const start = randomVals(10, 9, rc.key.length * 7, 0.3, 1, 0.5, P.edges === 'walls');
      agree(rc.label, P, start, 4);
    }
  }, 600000);

  it('step-through with headings lands on the GPU\'s boards (forward, back, forward again)', () => {
    const P = still([card('collide', { act: 'bounce' }), card('move', { assign: 0, act: 'bounce' })], { edges: 'walls' });
    const start = randomVals(13, 10, 5, 0.3, 1, 0.8, true);
    const frame = stepper(P, 13, 10);
    let b = boardOf(start, gridSignature(gridShape(P)), 'clamp');
    const gpu: Vals[] = [];
    for (let k = 0; k < 6; k++) { b = frame(b, k); gpu.push(f32(gridOf(b))); }
    let run = tryForward(P, tryStart(cpuOf(start)), 6);
    run = tryBack(tryBack(tryBack(run)));
    expect(f32(cpuVals(tryBoardOf(run)))).toEqual(gpu[2]);
    run = tryForward(P, run, 3);
    expect(f32(cpuVals(tryBoardOf(run)))).toEqual(gpu[5]);
  });
});

describe('movers on a still base: what each card does', { timeout: 60000 }, () => {
  const blank = (w: number, h: number): Vals => Array.from({ length: h }, () => Array(w).fill(0));
  /** Cells as [row, col, heading] (rows go down). */
  const lay = (w: number, h: number, cells: Array<[number, number, number]>) => { const g = blank(w, h); for (const [r, c, hd] of cells) g[r][c] = withHeading(1, hd); return g; };
  const step = (P: Record<string, unknown>, g: Vals, k = 1) => { let c = cpuOf(g); for (let i = 0; i < k; i++) c = cpuStep(P, c); return cpuVals(c); };
  const cellsOf = (g: Vals) => g.flatMap((row, r) => row.flatMap((v, c) => (Math.round(v) ? [[r, c, headingOfValue(v)]] : [])));
  // Headings: 1 up, 3 right, 5 down, 7 left.

  it('a mover steps one cell a step along its heading, and keeps it', () => {
    const P = still([card('move', { assign: -1 })]);
    expect(cellsOf(step(P, lay(9, 7, [[3, 2, 3]]), 2))).toEqual([[3, 4, 3]]);
    expect(cellsOf(step(P, lay(9, 7, [[3, 2, 2]]), 2))).toEqual([[1, 4, 2]]);
  });

  it('cells with no heading stay still, or take one (a set direction)', () => {
    expect(cellsOf(step(still([card('move', { assign: -1 })]), lay(9, 7, [[3, 3, 0]]), 3))).toEqual([[3, 3, 0]]);
    expect(cellsOf(step(still([card('move', { assign: 5 })]), lay(9, 7, [[1, 3, 0]]), 2))).toEqual([[3, 3, 5]]);
  });

  it('two movers aiming at one cell both wait (no conflict) when nothing resolves it', () => {
    const P = still([card('move', { assign: -1 })]);
    const g = lay(9, 7, [[3, 2, 3], [3, 4, 7]]);
    expect(cellsOf(step(P, g, 3))).toEqual(cellsOf(g));
  });

  it('collide bounce: a pair arriving at one cell turns round and flies apart; head-on too', () => {
    const P = still([card('collide', { act: 'bounce' }), card('move', { assign: -1 })]);
    expect(cellsOf(step(P, lay(11, 7, [[3, 3, 3], [3, 5, 7]]), 1))).toEqual([[3, 2, 7], [3, 6, 3]]);
    expect(cellsOf(step(P, lay(11, 7, [[3, 4, 3], [3, 5, 7]]), 1))).toEqual([[3, 3, 7], [3, 6, 3]]);
  });

  it('collide turn: both turn right a quarter and go on', () => {
    const P = still([card('collide', { act: 'turn' }), card('move', { assign: -1 })]);
    // Right-heading turns down; left-heading turns up.
    expect(cellsOf(step(P, lay(11, 7, [[3, 3, 3], [3, 5, 7]]), 1))).toEqual([[2, 5, 1], [4, 3, 5]]);
  });

  it('collide merge: two arriving at one cell become one there, heading as they add up; head-on pairs stop as one', () => {
    const P = still([card('collide', { act: 'merge' })]);
    // From the left (heading right) and from below (heading up) into (3, 4): one cell heading up right.
    expect(cellsOf(step(P, lay(11, 8, [[3, 3, 3], [4, 4, 1]])))).toEqual([[3, 4, 2]]);
    expect(cellsOf(step(P, lay(11, 7, [[3, 3, 3], [3, 5, 7]])))).toEqual([[3, 4, 0]]);
    expect(cellsOf(step(P, lay(11, 7, [[3, 4, 3], [3, 5, 7]])))).toEqual([[3, 4, 0]]);
  });

  it('collide explode: the pair vanishes, 8 copies land 2 from the meeting cell, flying outward', () => {
    const P = still([card('collide', { act: 'explode', copies: 8, distance: 2, fly: true })]);
    const out = cellsOf(step(P, lay(13, 11, [[5, 5, 3], [5, 7, 7]])));
    expect(out).toHaveLength(8);
    // The meeting cell is (5, 6): the copy above it heads up, the one to its right heads right.
    expect(out).toContainEqual([3, 6, 1]);
    expect(out).toContainEqual([5, 8, 3]);
    expect(out).toContainEqual([7, 4, 6]);
  });

  it('walls turn a bouncing mover round', () => {
    const P = still([card('move', { assign: -1, act: 'bounce' })], { edges: 'walls' });
    // Next to the right wall (column 7 of 9 is the last inside), heading right: it turns round.
    expect(cellsOf(step(P, lay(9, 7, [[3, 7, 3]]), 1))).toEqual([[3, 7, 7]]);
    expect(cellsOf(step(P, lay(9, 7, [[3, 7, 3]]), 2))).toEqual([[3, 6, 7]]);
  });

  it('moving, bouncing, turning and stopping keep every cell (300 steps, walls and wrap)', () => {
    for (const act of ['bounce', 'turn', 'stop'] as const) for (const edges of ['walls', 'wrap']) {
      const P = still([card('collide', { act }), card('move', { assign: 0, act: act === 'stop' ? 'wait' : act })], { edges });
      const g = randomVals(24, 18, 3, 0.2, 1, 0.9, edges === 'walls');
      let c = cpuOf(g);
      for (let k = 0; k < 300; k++) c = cpuStep(P, c);
      expect(occupied(cpuVals(c)), `${act}, ${edges}`).toBe(occupied(g));
    }
  });

  it('traffic (rule 184): a jam moves backwards and every car is kept', () => {
    const P = full({ ...stackRecipePatch('traffic')!, afterglow: 0 });
    const g = blank(20, 3);
    for (const c of [5, 6, 7, 8]) g[1][c] = withHeading(1, 3);
    const out = step(P, g, 1);
    // Only the front car moves; the jam's back is now one cell further on.
    expect(cellsOf(out)).toEqual([[1, 5, 3], [1, 6, 3], [1, 7, 3], [1, 9, 3]]);
  });
});

describe('headings in a drawn start, as text, in the recipes', { timeout: 60000 }, () => {
  it('a drawing with headings keeps them (Use as the start) and both the CPU and GPU deal them', () => {
    const B = cpuOf([[0, 0, 0, 0, 0], [0, withHeading(1, 3), 0, withHeading(1, 6), 0], [0, 0, 1, 0, 0]]);
    const sc = startCellsFromBoard(B)!;
    expect(sc.rows).toEqual(['1.1', '.1.']);
    expect(sc.heads).toEqual(['3.6', '...']);
    expect(readStartCells(JSON.parse(JSON.stringify(sc)))).toEqual(sc);
    const P = still([card('move', { assign: -1 })], { start: 'cells', startCells: sc });
    const c = cpuSeed(P, 9, 7);
    const gpu = (() => {
      const r = compileNodes(graph(P));
      const pass = r.passes!.find(p => p.nodeId === gridCellsId(G))!;
      const program = compileFragment(pass.fragmentShader);
      const uniforms: Env = { ...(r.paramUniforms as Env), u_time: 0.5 / 60, u_resolution: [9, 7], u_mouse: [-1000, -1000], u_mousebtn: 0, [`u_passiter_${pass.slug}`]: [0, pass.repeat ?? 1] };
      return drawPass(program, 9, 7, 'repeat', { [`u_passprev_${pass.slug}`]: makeBoard(9, 7) }, uniforms);
    })();
    expect(f32(gridOf(gpu))).toEqual(f32(cpuVals(c)));
    expect(cpuVals(c).flat().filter(v => headingOfValue(v) === 3)).toHaveLength(1);
    // A new set of arrows is a new board (the signature changes).
    const other = { ...sc, heads: ['7.6', '...'] };
    expect(gridSignature(gridShape({ ...P, startCells: other }))).not.toBe(gridSignature(gridShape(P)));
  });

  it('then lines read and print back for the new cards and settings', () => {
    const P = parseGrid('grid life\n  then collide explode copies=8 distance=2 fly chance=0.5\n  then move assign=random blocked=bounce any\n  then drift dir=e heading=n').params as Record<string, unknown>;
    const st = readStack(P.stack);
    expect(st.map(r => r.kind)).toEqual(['collide', 'move', 'drift']);
    expect(st[0]).toMatchObject({ act: 'explode', copies: 8, distance: 2, fly: true, chance: 0.5 });
    expect(st[1]).toMatchObject({ assign: 0, act: 'bounce', any: true });
    expect(st[2]).toMatchObject({ who: 1 });
    const back = parseGrid(printGrid(P)).params as Record<string, unknown>;
    expect(readStack(back.stack)).toEqual(st);
  });

  it('the movers recipes keep moving on the try board for 200 steps', () => {
    for (const rc of STACK_RECIPES.filter(x => x.stack.some(c => c.kind === 'move'))) {
      const P = { ...GRID_DEFAULTS, ...stackRecipePatch(rc.key)! };
      let s = 9;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      let c = cpuSeed(P, 64, 40, rnd);
      c.step = 0;
      let moved = 0;
      for (let k = 0; k < 200; k++) {
        const nx = cpuStep(P, c);
        if (k > 180) moved += Array.from(nx.a).filter((v, i) => v !== c.a[i]).length;
        c = nx;
      }
      expect(moved, rc.label).toBeGreaterThan(0);
      expect(occupied(cpuVals(c)), rc.label).toBeGreaterThan(0);
    }
  });
});
