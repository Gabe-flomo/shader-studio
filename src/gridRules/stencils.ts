/**
 * stencils.ts — the Grid Rules node's Patterns and Blocks rules (docs/grid-rules.md):
 *
 *  - **Patterns**: an ordered list of 3×3 stencils. Each cell of a stencil is "any", "not empty",
 *    or one state; the middle is "this cell is". A rule can also ask for a count ("1 or 2
 *    neighbours in state 1", as Wireworld does). The first rule that matches says what the cell
 *    becomes; none matching, it stays. Rotations (and mirrors) let one stencil cover every
 *    orientation.
 *  - **Blocks** (Margolus): the board in 2×2 blocks whose grid shifts one cell diagonally every
 *    step. A rule is a before picture and an after picture; the four cells of a block change
 *    together, so an after that rearranges the before (a grain falling, a particle moving) keeps
 *    every state's count. Chance, and the variant tried first, are rolled once per block, so the
 *    four cells always agree.
 *
 * Both are stored in the node's params as arrays (patterns / blocks): baked into the GLSL, so an
 * edit recompiles. A cell spec: -1 any, -2 not empty, k ≥ 0 that state. A Blocks after cell:
 * -1 unchanged, k ≥ 0 that state.
 */

export const ANY = -1;
export const NOT_EMPTY = -2;
export const SAME = -1;

export type PatternSymmetry = 'none' | 'rotate' | 'all';
export interface PatternRule {
  /** 9 cell specs, the top row first (index 4 is this cell). */
  cells: number[];
  becomes: number;
  symmetry: PatternSymmetry;
  /** Also: how many of the 8 neighbours are in `state` (from min to max). */
  count?: { state: number; min: number; max: number } | null;
  off?: boolean;
}

export type BlockSymmetry = 'none' | 'mirror' | 'rotate';
export interface BlockRule {
  /** Top left, top right, bottom left, bottom right. */
  before: number[];
  after: number[];
  symmetry: BlockSymmetry;
  /** The chance it fires where it matches (rolled per block). */
  chance: number;
  off?: boolean;
}

/** Neighbour offset (x right, y up) of stencil cell i. */
export const stencilOffset = (i: number): [number, number] => [(i % 3) - 1, 1 - Math.floor(i / 3)];
/** Block cell q's corner (x, y up) within its block. */
export const blockCorner = (q: number): [number, number] => [q % 2, 1 - Math.floor(q / 2)];

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' && isFinite(v) ? Math.round(v) : d;
  return Math.max(lo, Math.min(hi, n));
};

export function readPatterns(v: unknown): PatternRule[] {
  if (!Array.isArray(v)) return [];
  return v.filter(r => r && typeof r === 'object').map(r => {
    const x = r as Partial<PatternRule>;
    const cells = Array.from({ length: 9 }, (_, i) => clampInt(Array.isArray(x.cells) ? x.cells[i] : ANY, -2, 15, ANY));
    const c = x.count && typeof x.count === 'object' ? x.count : null;
    return {
      cells, becomes: clampInt(x.becomes, 0, 15, 0),
      symmetry: x.symmetry === 'rotate' || x.symmetry === 'all' ? x.symmetry : 'none',
      count: c ? { state: clampInt(c.state, 0, 15, 1), min: clampInt(c.min, 0, 8, 0), max: clampInt(c.max, 0, 8, 8) } : null,
      ...(x.off ? { off: true } : {}),
    };
  });
}

export function readBlocks(v: unknown): BlockRule[] {
  if (!Array.isArray(v)) return [];
  return v.filter(r => r && typeof r === 'object').map(r => {
    const x = r as Partial<BlockRule>;
    return {
      before: Array.from({ length: 4 }, (_, i) => clampInt(Array.isArray(x.before) ? x.before[i] : ANY, -2, 15, ANY)),
      after: Array.from({ length: 4 }, (_, i) => clampInt(Array.isArray(x.after) ? x.after[i] : SAME, -1, 15, SAME)),
      symmetry: x.symmetry === 'mirror' || x.symmetry === 'rotate' ? x.symmetry : 'none',
      chance: typeof x.chance === 'number' && isFinite(x.chance) ? Math.max(0, Math.min(1, x.chance)) : 1,
      ...(x.off ? { off: true } : {}),
    };
  });
}

// ── Symmetries ──────────────────────────────────────────────────────────────────────────────────

/** A 3×3 index turned a quarter clockwise, and mirrored left–right. */
const rot9 = (i: number) => { const r = Math.floor(i / 3), c = i % 3; return c * 3 + (2 - r); };
const mir9 = (i: number) => { const r = Math.floor(i / 3), c = i % 3; return r * 3 + (2 - c); };
const apply = (cells: number[], f: (i: number) => number) => { const out = Array(cells.length).fill(ANY); cells.forEach((v, i) => { out[f(i)] = v; }); return out; };

/** The distinct stencils a pattern rule stands for. */
export function patternVariants(r: PatternRule): number[][] {
  const out: number[][] = [];
  const add = (c: number[]) => { if (!out.some(o => o.every((v, i) => v === c[i]))) out.push(c); };
  let c = r.cells;
  const turns = r.symmetry === 'none' ? 1 : 4;
  for (let t = 0; t < turns; t++) {
    add(c);
    if (r.symmetry === 'all') add(apply(c, mir9));
    c = apply(c, rot9);
  }
  return out;
}

/** Block positions turned a quarter clockwise (TL → TR → BR → BL) and mirrored. */
const rot4 = [1, 3, 0, 2];
const mir4 = [1, 0, 3, 2];
const apply4 = (cells: number[], m: number[]) => { const out = [0, 0, 0, 0]; cells.forEach((v, i) => { out[m[i]] = v; }); return out; };

/** The distinct before → after pairs a block rule stands for. */
export function blockVariants(r: BlockRule): Array<{ before: number[]; after: number[] }> {
  const out: Array<{ before: number[]; after: number[] }> = [];
  const add = (b: number[], a: number[]) => { if (!out.some(o => o.before.every((v, i) => v === b[i]) && o.after.every((v, i) => v === a[i]))) out.push({ before: b, after: a }); };
  add(r.before, r.after);
  if (r.symmetry === 'mirror') add(apply4(r.before, mir4), apply4(r.after, mir4));
  if (r.symmetry === 'rotate') {
    let b = r.before, a = r.after;
    for (let t = 1; t < 4; t++) { b = apply4(b, rot4); a = apply4(a, rot4); add(b, a); }
  }
  return out;
}

/** Whether a value matches a spec (outside the board reads as −1: it is "not empty", nothing else). */
export const specMatches = (spec: number, v: number) => (spec === ANY ? true : spec === NOT_EMPTY ? v !== 0 : v === spec);

/** Does a Blocks rule keep every state's count (its after only rearranges its before)? */
export function blockConserves(r: BlockRule): boolean {
  return blockVariants(r).every(({ before, after }) => {
    // The cells it writes must be ones whose state it knows, and it must write back the same states.
    const written = [0, 1, 2, 3].filter(i => after[i] !== SAME);
    if (written.some(i => before[i] < 0)) return false;
    return written.map(i => before[i]).sort().join() === written.map(i => after[i]).sort().join();
  });
}

// ── Presets ─────────────────────────────────────────────────────────────────────────────────────

const _ = ANY;

type StencilPreset = { label: string; hint: string; params: Record<string, unknown>; look?: Record<string, unknown> };

/** Colours that suit the presets (state 0, 1, 2…), set with them. */
const WIRE_LOOK = { color0: [0.02, 0.02, 0.04], color1: [0.75, 0.9, 1.0], color2: [1.0, 0.45, 0.15], color3: [0.55, 0.3, 0.12], afterglow: 0, ageFade: 0, brushState: 3, brushFill: 1, brushRadius: 1 };
const DOTS_LOOK = { color0: [0.02, 0.03, 0.06], color1: [0.6, 0.85, 1.0], afterglow: 0.8, glowColor: [0.1, 0.25, 0.5], ageFade: 0, brushState: 1, brushFill: 0.3 };
const CRYSTAL_LOOK = { color0: [0.02, 0.03, 0.07], color1: [0.85, 0.95, 1.0], oldColor: [0.25, 0.5, 0.9], ageRate: 0.01, ageFade: 1, afterglow: 0, brushState: 1, brushFill: 1, brushRadius: 1.5 };
// Sand starts as a loose cloud of grains in the middle, on a finer board, so it falls and heaps up on
// the floor. Not a board full of noise: a full board would fall as one sheet. Speed 1: with Jitter on,
// grains fall about half a cell a step (a row out of step waits a step), so a step every frame.
// Jitter 1: in plain Margolus every falling grain ends a step in its block's bottom row, so a falling
// cloud shows in bands on every other row; Jitter shuffles the block rows (gridRules/dice.ts). A look
// setting, not a rule one: tuning it keeps the preset.
const SAND_LOOK = { jitter: 1, color0: [0.04, 0.04, 0.07], color1: [0.95, 0.78, 0.45], color2: [0.42, 0.4, 0.45], afterglow: 0, ageFade: 0, brushState: 1, brushFill: 0.5, start: 'centre', density: 0.35, board: '0.25', rate: 1 };
// Jitter 0: the HPP gas needs the plain Margolus grid to fly straight (with Jitter it diffuses).
const GAS_LOOK = { jitter: 0, color0: [0.02, 0.02, 0.05], color1: [1.0, 0.6, 0.3], afterglow: 0.85, glowColor: [0.5, 0.12, 0.25], ageFade: 0, brushState: 1, brushFill: 0.5 };

export const PATTERN_PRESETS: Record<string, StencilPreset> = {
  wireworld: {
    label: 'Wireworld', hint: 'Silverman\'s Wireworld: 1 head → 2 tail → 3 copper; copper → head with 1 or 2 heads round it.',
    params: {
      states: 4,
      patterns: [
        { cells: [_, _, _, _, 1, _, _, _, _], becomes: 2, symmetry: 'none' },
        { cells: [_, _, _, _, 2, _, _, _, _], becomes: 3, symmetry: 'none' },
        { cells: [_, _, _, _, 3, _, _, _, _], becomes: 1, symmetry: 'none', count: { state: 1, min: 1, max: 2 } },
      ] satisfies PatternRule[],
    },
    look: WIRE_LOOK,
  },
  fallingDots: {
    label: 'Falling dots', hint: 'An on cell with nothing below it moves down one cell: the empty cell below takes it, the cell itself empties.',
    params: {
      states: 2,
      patterns: [
        { cells: [_, _, _, _, 1, _, _, 0, _], becomes: 0, symmetry: 'none' },
        { cells: [_, 1, _, _, 0, _, _, _, _], becomes: 1, symmetry: 'none' },
      ] satisfies PatternRule[],
    },
    look: DOTS_LOOK,
  },
  crystal: {
    label: 'Crystal', hint: 'An empty cell with exactly one on cell round it turns on: arms that branch like frost.',
    params: {
      states: 2,
      patterns: [
        { cells: [_, _, _, _, 0, _, _, _, _], becomes: 1, symmetry: 'none', count: { state: 1, min: 1, max: 1 } },
      ] satisfies PatternRule[],
    },
    look: CRYSTAL_LOOK,
  },
};

export const BLOCK_PRESETS: Record<string, StencilPreset> = {
  sand: {
    label: 'Falling sand', hint: 'Grains (1) fall into empty cells (0), slide off each other down to the side, and rest on walls (2) and the floor. Jitter 1 keeps a falling cloud from showing in bands. Nothing is lost or made.',
    params: {
      // Walls: sand needs a floor to pile on. On a wrapping board it falls out of the bottom and back in at the top for ever.
      states: 3, edges: 'walls',
      blocks: [
        { before: [1, 1, 0, 0], after: [0, 0, 1, 1], symmetry: 'none', chance: 1 },
        { before: [1, _, 0, _], after: [0, SAME, 1, SAME], symmetry: 'mirror', chance: 1 },
        { before: [1, 0, NOT_EMPTY, 0], after: [0, 0, SAME, 1], symmetry: 'mirror', chance: 0.8 },
      ] satisfies BlockRule[],
    },
    look: SAND_LOOK,
  },
  gas: {
    label: 'Gas (HPP)', hint: 'Particles move diagonally, one cell a step; two meeting head-on bounce off at right angles (Toffoli and Margolus\'s HPP gas). Every particle is kept.',
    params: {
      // Wrap: the gas's rules have no wall cases, so particles would stick to a wall.
      states: 2, edges: 'wrap',
      blocks: [
        { before: [1, 0, 0, 0], after: [0, 0, 0, 1], symmetry: 'rotate', chance: 1 },
        { before: [1, 0, 0, 1], after: [0, 1, 1, 0], symmetry: 'rotate', chance: 1 },
        { before: [1, 1, 0, 0], after: [0, 0, 1, 1], symmetry: 'rotate', chance: 1 },
        { before: [1, 1, 1, 0], after: [0, 1, 1, 1], symmetry: 'rotate', chance: 1 },
      ] satisfies BlockRule[],
    },
    look: GAS_LOOK,
  },
};

/** The default rules a new Patterns / Blocks node starts with. */
export const DEFAULT_PATTERNS = PATTERN_PRESETS.wireworld.params.patterns as PatternRule[];
export const DEFAULT_BLOCKS = BLOCK_PRESETS.sand.params.blocks as BlockRule[];
