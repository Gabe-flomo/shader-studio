/**
 * Grid Rules test harness: compiles a graph, finds a board Pass's program, and steps it on the CPU
 * (glslRun.ts) from a board the test lays out. Also the CPU references the GLSL is checked against:
 * Life-like (B/S) and Generations (S/B/C) steps written plainly, from the rules' definitions.
 */
import { compileGraph } from '../graphCompiler';
import type { CompilationResult, PassProgram } from '../types';
import type { GraphNode } from '../../types/nodeGraph';
import { SAME, blockVariants, patternVariants, specMatches, type BlockRule, type PatternRule } from '../../gridRules/stencils';
import { compileFragment, drawPass, makeBoard, setTexel, texel, type Board, type Env, type Program } from './glslRun';

export interface Stepper {
  pass: PassProgram;
  program: Program;
  /** The uniforms (the compile's param values, the clock and the pointer), changeable per test. */
  uniforms: Env;
  /** Other textures the program reads (a start image's pass), by sampler name. */
  samplers: Record<string, Board>;
  /** One frame: the board's program drawn over the board as it was (its Previous); `times` frames. */
  step: (b: Board, times?: number) => Board;
}

/** The program that draws the Pass `passNodeId` (a Grid Rules board is `<id>__cells`), ready to step on a w × h board. */
export function stepperFor(r: CompilationResult, passNodeId: string, w: number, h: number, extra: Env = {}): Stepper {
  if (!r.success) throw new Error(`compile failed: ${(r.errors ?? []).join('; ')}`);
  const pass = r.passes?.find(p => p.nodeId === passNodeId);
  if (!pass) throw new Error(`no pass ${passNodeId}: ${(r.passes ?? []).map(p => p.nodeId).join(', ')}`);
  const program = compileFragment(pass.fragmentShader);
  const scale = pass.scale;
  const uniforms: Env = {
    ...(r.paramUniforms as Env),
    u_time: 1, u_frameDt: 1 / 60, u_resolution: [w, h], u_mouse: [-1000, -1000], u_mousebtn: 0,
    // One picture pixel in the textures' coordinates: the picture is the board / its scale.
    [`u_passprev_${pass.slug}_px`]: [scale / w, scale / h], [`u_pass_${pass.slug}_px`]: [scale / w, scale / h],
    ...extra,
  };
  const prevName = `u_passprev_${pass.slug}`;
  const s: Stepper = {
    pass, program, uniforms, samplers: {},
    step: (b, times = 1) => {
      let cur = b;
      for (let k = 0; k < times; k++) cur = drawPass(program, w, h, pass.wrap === 'repeat' ? 'repeat' : 'clamp', { ...s.samplers, [prevName]: cur }, s.uniforms);
      return cur;
    },
  };
  return s;
}

export const compileNodes = (nodes: GraphNode[]) => compileGraph({ nodes });

// ── Boards as grids of states ────────────────────────────────────────────────────────────────────

/** Rows top to bottom, as the board is drawn (row 0 is the top, y = h − 1). */
export type Grid = number[][];

/** A board from a grid of states (R), with Alpha = the rule's signature (so it isn't reseeded). */
export function boardFrom(grid: Grid, sig: number, wrap: Board['wrap'] = 'repeat', g: Grid | null = null): Board {
  const h = grid.length, w = grid[0].length;
  const b = makeBoard(w, h, wrap);
  for (let row = 0; row < h; row++) for (let x = 0; x < w; x++) setTexel(b, x, h - 1 - row, [grid[row][x], g ? g[row][x] : 0, 0, sig]);
  return b;
}
export function gridOf(b: Board, ch = 0): Grid {
  return Array.from({ length: b.h }, (_, row) => Array.from({ length: b.w }, (_, x) => texel(b, x, b.h - 1 - row)[ch]));
}
export const rounded = (g: Grid) => g.map(r => r.map(v => Math.round(v)));

/** A random grid of states 0…max (inclusive), with a seeded generator so a failure repeats. */
export function randomGrid(w: number, h: number, seed: number, pOn = 0.4, max = 1): Grid {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return Array.from({ length: h }, () => Array.from({ length: w }, () => (rnd() < pOn ? 1 + Math.floor(rnd() * max) : 0)));
}

// ── CPU references ───────────────────────────────────────────────────────────────────────────────

type Offsets = Array<[number, number]>;

/** Live neighbours (state 1) of each cell. Offsets are (x right, y up); grid rows go down. Walls: outside counts as empty. */
function counts(grid: Grid, offsets: Offsets, wrap: boolean): Grid {
  const h = grid.length, w = grid[0].length;
  return grid.map((row, r) => row.map((_, x) => {
    let c = 0;
    for (const [dx, dy] of offsets) {
      let xx = x + dx, rr = r - dy;
      if (wrap) { xx = (xx + w) % w; rr = (rr + h) % h; } else if (xx < 0 || rr < 0 || xx >= w || rr >= h) continue;
      if (grid[rr][xx] === 1) c++;
    }
    return c;
  }));
}

/** Walls: the outer ring is kept empty. */
const walls = (g: Grid): Grid => g.map((row, r) => row.map((v, x) => (r === 0 || x === 0 || r === g.length - 1 || x === row.length - 1 ? 0 : v)));

/** One Life-like step: born / survive are predicates on the live-neighbour count. */
export function lifeLikeRef(grid: Grid, born: (c: number) => boolean, survive: (c: number) => boolean, offsets: Offsets, wrap = true): Grid {
  const c = counts(grid, offsets, wrap);
  const next = grid.map((row, r) => row.map((v, x) => (v === 1 ? (survive(c[r][x]) ? 1 : 0) : (born(c[r][x]) ? 1 : 0))));
  return wrap ? next : walls(next);
}

/** One Generations step with `states` states: 0 empty, 1 on, 2… dying. */
export function generationsRef(grid: Grid, born: (c: number) => boolean, survive: (c: number) => boolean, states: number, offsets: Offsets, wrap = true): Grid {
  const c = counts(grid, offsets, wrap);
  const next = grid.map((row, r) => row.map((v, x) => {
    if (v === 0) return born(c[r][x]) ? 1 : 0;
    if (v === 1) return survive(c[r][x]) ? 1 : (states > 2 ? 2 : 0);
    return v + 1 >= states ? 0 : v + 1;
  }));
  return wrap ? next : walls(next);
}

export const inMask = (mask: number) => (c: number) => ((mask >> c) & 1) === 1;

// ── Patterns and Blocks references ───────────────────────────────────────────────────────────────

/** One Patterns step: the first rule whose stencil (any variant) and count match says what the cell becomes. */
export function patternsRef(grid: Grid, rules: PatternRule[], wrap = true): Grid {
  const h = grid.length, w = grid[0].length;
  const at = (r: number, x: number) => {
    if (wrap) return grid[(r + h) % h][(x + w) % w];
    return r < 0 || x < 0 || r >= h || x >= w ? grid[Math.min(h - 1, Math.max(0, r))][Math.min(w - 1, Math.max(0, x))] : grid[r][x];
  };
  const next = grid.map((row, r) => row.map((v, x) => {
    // Stencil cell i: row i / 3 from the top, column i % 3 from the left.
    const c = Array.from({ length: 9 }, (_, i) => at(r - 1 + Math.floor(i / 3), x - 1 + (i % 3)));
    for (const rule of rules) {
      const hit = patternVariants(rule).some(vr => vr.every((spec, i) => specMatches(spec, c[i])));
      const n = rule.count ? c.filter((q, i) => i !== 4 && q === rule.count!.state).length : 0;
      if (hit && (!rule.count || (n >= rule.count.min && n <= rule.count.max))) return rule.becomes;
    }
    return v;
  }));
  return wrap ? next : next.map((row, r) => row.map((v, x) => (r === 0 || x === 0 || r === h - 1 || x === w - 1 ? 0 : v)));
}

/**
 * One Margolus step for rules where at most one variant of a rule can match a block and every
 * chance is 1 (so no dice): blocks offset by `par` (0 or 1) on both axes, the board's even part
 * wrapping, or (walls) outside reading −1.
 */
export function margolusRef(grid: Grid, rules: BlockRule[], par: number, wrap = true): Grid {
  const h = grid.length, w = grid[0].length, W = Math.floor(w / 2) * 2, H = Math.floor(h / 2) * 2;
  const out = grid.map(r => [...r]);
  // Board coordinates y up: row = h − 1 − y.
  const get = (x: number, y: number) => {
    if (wrap) { x = ((x % W) + W) % W; y = ((y % H) + H) % H; } else if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    return grid[h - 1 - y][x];
  };
  for (let oy = par; oy < H + par; oy += 2) for (let ox = par; ox < W + par; ox += 2) {
    const pos: Array<[number, number]> = [[ox, oy + 1], [ox + 1, oy + 1], [ox, oy], [ox + 1, oy]];
    const b = pos.map(([x, y]) => get(x, y));
    for (const rule of rules) {
      const v = blockVariants(rule).find(vr => vr.before.every((spec, q) => specMatches(spec, b[q])));
      if (!v) continue;
      pos.forEach(([x, y], q) => {
        if (v.after[q] === SAME || b[q] < 0) return;
        const xx = wrap ? ((x % W) + W) % W : x, yy = wrap ? ((y % H) + H) % H : y;
        out[h - 1 - yy][xx] = v.after[q];
      });
      break;
    }
  }
  return out;
}
