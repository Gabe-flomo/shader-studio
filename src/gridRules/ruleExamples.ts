/**
 * ruleExamples.ts — the before/after pictures of the Grid Rules builder (BlockPictures.tsx,
 * StencilForms.tsx): a fixed small grid that flips between two states, not an animation.
 *
 *  - blockExample: one Blocks rule alone. Its before picture, made concrete (any → empty, not empty →
 *    1), in the middle of a 4 × 4 grid; the after is what the rule writes there.
 *  - patternExample: one Patterns rule alone. Its stencil made concrete (a count rule gets the
 *    neighbours it asks for), the after is the middle cell becoming what the rule says.
 *  - comboBoard / comboStep: every rule switched on together, one real step of the CPU run
 *    (gridRules/cpu.ts, the same as the GPU's) on a small seeded board, with the blocks each rule
 *    changed, so you see rules alone and then together.
 *
 * Grids are rows top first. Pure.
 */
import { cpuBoard, cpuStep, type CpuBoard } from './cpu';
import { GRID_DEFAULTS, gridShape } from './spec';
import { ANY, NOT_EMPTY, SAME, type BlockRule, type PatternRule } from './stencils';
import { makeRng } from '../lib/surprise';

export type Grid = number[][];

/** A spec made concrete: any → empty, not empty → 1, a state → itself. */
const concrete = (spec: number) => (spec === ANY ? 0 : spec === NOT_EMPTY ? 1 : spec);

export interface BlockExample {
  before: Grid;
  after: Grid;
  /** The block's cells, [row, col]. */
  block: Array<[number, number]>;
}

/** Block corner q (TL, TR, BL, BR) in the example grid. */
const BLOCK_AT: Array<[number, number]> = [[1, 1], [1, 2], [2, 1], [2, 2]];

export function blockExample(r: BlockRule, states: number): BlockExample {
  const top = Math.max(1, states - 1);
  const before: Grid = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  r.before.forEach((spec, q) => { const [row, col] = BLOCK_AT[q]; before[row][col] = Math.min(concrete(spec), top); });
  const after = before.map(row => [...row]);
  r.after.forEach((a, q) => { const [row, col] = BLOCK_AT[q]; if (a !== SAME) after[row][col] = Math.min(a, top); });
  return { before, after, block: BLOCK_AT };
}

export interface PatternExample {
  before: Grid;
  after: Grid;
}

/** Stencil cell k's place in the 3 × 3 (rows top first): k itself. */
export function patternExample(r: PatternRule, states: number): PatternExample {
  const top = Math.max(1, states - 1);
  const cells = r.cells.map(c => Math.min(concrete(c), top));
  // A count: put the fewest neighbours it asks for on cells the stencil leaves open (or already that state).
  if (r.count) {
    const want = Math.min(r.count.min, 8);
    let have = cells.filter((v, k) => k !== 4 && v === r.count!.state).length;
    for (let k = 0; k < 9 && have < want; k++) {
      if (k === 4 || r.cells[k] !== ANY || cells[k] === r.count.state) continue;
      cells[k] = Math.min(r.count.state, top);
      have++;
    }
  }
  const before: Grid = [cells.slice(0, 3), cells.slice(3, 6), cells.slice(6, 9)];
  const after = before.map(row => [...row]);
  after[1][1] = Math.min(r.becomes, top);
  return { before, after };
}

/** Where a stencil cell sits, in words ("above left"), for a rule's sentence. */
export const STENCIL_PLACES = ['above left', 'above', 'above right', 'left', 'this cell', 'right', 'below left', 'below', 'below right'];

/**
 * A Patterns rule in one sentence: "When this cell is 1 and the one below is empty, it becomes 0."
 * `name` names a state (Wireworld: "a head").
 */
export function patternSentence(r: PatternRule, name: (state: number) => string = s => (s === 0 ? 'empty' : `${s}`)): string {
  const spec = (v: number) => (v === NOT_EMPTY ? 'not empty' : name(v));
  const self = r.cells[4] === ANY ? 'any cell' : r.cells[4] === NOT_EMPTY ? 'a cell that isn\'t empty' : `a cell that is ${name(r.cells[4])}`;
  const conds = r.cells.map((v, k) => (k === 4 || v === ANY ? null : `${STENCIL_PLACES[k]} ${spec(v)}`)).filter((x): x is string => !!x);
  if (r.count) {
    const n = r.count.min === r.count.max ? `exactly ${r.count.min}` : `${r.count.min} to ${r.count.max}`;
    conds.push(`${n} neighbour${r.count.max === 1 ? '' : 's'} ${name(r.count.state)}`);
  }
  const turned = r.symmetry === 'rotate' ? ' (turned any way)' : r.symmetry === 'all' ? ' (turned or mirrored)' : '';
  return `${self[0].toUpperCase()}${self.slice(1)}${conds.length ? ` with ${conds.join(', ')}` : ''}${turned} becomes ${name(r.becomes)}.`;
}

// ── Combinations: every rule on together ────────────────────────────────────────────────────────

/** A small seeded board to watch the rules work together (whole-number rules). */
export function comboBoard(params: Record<string, unknown>, w = 12, h = 8, seed = 7): CpuBoard {
  const P = { ...GRID_DEFAULTS, ...params };
  const top = Math.max(2, Math.round(Number(P.states))) - 1;
  const rng = makeRng(seed);
  const B = cpuBoard(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) B.a[y * w + x] = rng.next() < 0.35 ? 1 : 0;
  // Three states or more (sand's walls): a short ledge of the top state low in the middle.
  if (top >= 2) for (let x = Math.floor(w / 3); x < Math.floor((2 * w) / 3); x++) B.a[2 * w + x] = top;
  B.step = 0;
  return B;
}

export interface ComboStep {
  before: CpuBoard;
  after: CpuBoard;
  /** The blocks that changed, bottom-left cell (x, y up), and the rule (its index) that changed each. */
  fired: Array<{ x: number; y: number; rule: number }>;
}

/** One real step with only the rules in `on` (indices) switched on. */
export function comboStep(params: Record<string, unknown>, before: CpuBoard, on: ReadonlySet<number>): ComboStep {
  const s = gridShape({ ...GRID_DEFAULTS, ...params });
  const P = { ...params, blocks: s.blocks.map((r, i) => ({ ...r, off: r.off || !on.has(i) })) };
  const fired: ComboStep['fired'] = [];
  const after = cpuStep(P, before, { onBlock: (x, y, rule) => fired.push({ x, y, rule }) });
  return { before, after, fired };
}

/** A CPU board as a grid of states (rows top first). */
export const gridOfBoard = (B: CpuBoard): Grid => Array.from({ length: B.h }, (_, r) => Array.from({ length: B.w }, (_, x) => Math.round(B.a[(B.h - 1 - r) * B.w + x])));
