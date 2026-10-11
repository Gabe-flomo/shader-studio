/**
 * startCells.ts — a drawn start for a Grid Rules board (docs/grid-rules.md, "A drawn start"): the
 * cells you placed on the builder's try board (or that another builder hands over, e.g. the Grid
 * scene builder's "Make it a simulation"), stamped in the middle of a new board.
 *
 * Stored in the node's `startCells` param, used when `start` is 'cells':
 *   { w, h, rows } — rows top first, one character a cell: '.' empty, '1'…'9' and 'a'…'f' a state.
 * Cropped to the drawn cells' bounds, at most MAX_START cells each way.
 *
 * The GLSL (gridRules/glsl.ts) and the CPU (gridRules/cpu.ts) place it the same way: its bottom-left
 * cell at floor((board − drawing) / 2), so the CPU try board and the GPU board start alike. Pure.
 */
import type { CpuBoard } from './cpu';

export interface StartCells {
  w: number;
  h: number;
  /** Top row first; '.' is empty, a digit (or a…f) the state. */
  rows: string[];
  /** Moved this many cells from the middle (x right, y up): a text start's position. */
  ox?: number;
  oy?: number;
  /**
   * Headings (stacked Move and Collide cards, gridRules/stack.ts), when any cell has one: rows as
   * `rows`, '.' none and '1'…'8' a heading (up, up right, right… clockwise).
   */
  heads?: string[];
}

/** Largest drawing, in cells each way (the GLSL bakes a test per drawn row, state and 16 cells). A text start is wide and short. */
export const MAX_START = 128;
/** Bits per mask in the GLSL (whole numbers below 2^16 stay exact in any float). */
const CHUNK = 16;

const CHARS = '.123456789abcdef';
const charOf = (state: number) => CHARS[Math.max(0, Math.min(15, Math.round(state)))] ?? '.';
const stateOf = (ch: string | undefined) => Math.max(0, CHARS.indexOf((ch ?? '.').toLowerCase()));

/** A stored drawing read defensively (null: none, or nothing drawn). */
export function readStartCells(v: unknown): StartCells | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Partial<StartCells>;
  if (!Array.isArray(x.rows) || !x.rows.length) return null;
  const rows = x.rows.slice(0, MAX_START).map(r => (typeof r === 'string' ? r : '').slice(0, MAX_START));
  const w = Math.max(1, ...rows.map(r => r.length));
  const heads = Array.isArray(x.heads) ? x.heads.slice(0, rows.length).map(r => (typeof r === 'string' ? r : '')) : null;
  const sc = fromGrid(rows.map(r => Array.from({ length: w }, (_, i) => stateOf(r[i]))), heads ? rows.map((_, k) => Array.from({ length: w }, (_, i) => headOf(heads[k]?.[i]))) : undefined);
  const off = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.max(-4096, Math.min(4096, n))) : 0);
  if (sc && (off(x.ox) || off(x.oy))) { sc.ox = off(x.ox); sc.oy = off(x.oy); }
  return sc;
}

/** The state of a drawing's cell, x right, y up from its bottom row (0 outside). */
export function startCellAt(sc: StartCells, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= sc.w || y >= sc.h) return 0;
  return stateOf(sc.rows[sc.h - 1 - y][x]);
}

/** A cell's heading in a drawing (0 none, 1…8). */
const headOf = (ch: string | undefined) => { const k = '.12345678'.indexOf(ch ?? '.'); return k > 0 ? k : 0; };

/** The heading of a drawing's cell, x right, y up from its bottom row (0 outside or none). */
export function startHeadingAt(sc: StartCells, x: number, y: number): number {
  if (!sc.heads || x < 0 || y < 0 || x >= sc.w || y >= sc.h) return 0;
  return headOf(sc.heads[sc.h - 1 - y]?.[x]);
}

/** A drawing from a grid of states (rows top first), and optionally their headings, cropped to its cells; null when it is empty. */
export function startCellsFromGrid(grid: number[][], heads?: number[][]): StartCells | null {
  return fromGrid(grid.map(r => r.map(v => Math.max(0, Math.min(15, Math.round(Number(v) || 0))))), heads);
}

function fromGrid(grid: number[][], heads?: number[][]): StartCells | null {
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  grid.forEach((row, r) => row.forEach((v, c) => {
    if (v > 0) { x0 = Math.min(x0, c); x1 = Math.max(x1, c); y0 = Math.min(y0, r); y1 = Math.max(y1, r); }
  }));
  if (x1 < 0) return null;
  // Too big: keep the middle MAX_START × MAX_START.
  if (x1 - x0 + 1 > MAX_START) { const mid = Math.floor((x0 + x1) / 2); x0 = mid - MAX_START / 2; x1 = x0 + MAX_START - 1; }
  if (y1 - y0 + 1 > MAX_START) { const mid = Math.floor((y0 + y1) / 2); y0 = mid - MAX_START / 2; y1 = y0 + MAX_START - 1; }
  const rows: string[] = [], hr: string[] = [];
  let anyHead = false;
  for (let r = y0; r <= y1; r++) {
    let s = '', t = '';
    for (let c = x0; c <= x1; c++) {
      const st = grid[r]?.[c] ?? 0;
      s += charOf(st);
      const hd = st > 0 ? Math.round(heads?.[r]?.[c] ?? 0) : 0;
      if (hd >= 1 && hd <= 8) { t += String(hd); anyHead = true; } else t += '.';
    }
    rows.push(s); hr.push(t);
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, rows, ...(anyHead ? { heads: hr } : {}) };
}

/** A drawing from a CPU board's states (its cells, rounded) and headings (red's fraction: gridRules/stack.ts), cropped; null when the board is empty. */
export function startCellsFromBoard(B: CpuBoard): StartCells | null {
  const val = (r: number, x: number) => B.a[(B.h - 1 - r) * B.w + x];
  const grid = Array.from({ length: B.h }, (_, r) => Array.from({ length: B.w }, (_, x) => Math.round(val(r, x))));
  const heads = Array.from({ length: B.h }, (_, r) => Array.from({ length: B.w }, (_, x) => { const v = val(r, x); const h = Math.round((v - Math.round(v)) * 32); return h >= 1 && h <= 8 ? h : 0; }));
  return startCellsFromGrid(grid, heads);
}

/** Where a drawing's bottom-left cell lands on a w × h board (the same on the GPU). */
export const startOrigin = (sc: StartCells, w: number, h: number): [number, number] => [Math.floor((w - sc.w) / 2) + (sc.ox ?? 0), Math.floor((h - sc.h) / 2) + (sc.oy ?? 0)];

/** The drawing's state at board cell (x, y up), placed in the middle of a w × h board. */
export function stampedAt(sc: StartCells, w: number, h: number, x: number, y: number): number {
  const [ox, oy] = startOrigin(sc, w, h);
  return startCellAt(sc, x - ox, y - oy);
}

/** The drawing's heading at board cell (x, y up), placed as stampedAt places it. */
export function stampedHeadingAt(sc: StartCells, w: number, h: number, x: number, y: number): number {
  const [ox, oy] = startOrigin(sc, w, h);
  return startHeadingAt(sc, x - ox, y - oy);
}

/** How many cells are drawn (any state but empty). */
export const drawnCount = (sc: StartCells | null) => (sc ? sc.rows.join('').split('').filter(c => c !== '.').length : 0);

/** A small whole number (0–15) that changes with the drawing: part of the board's signature, so a new drawing deals a new board. */
export function startCellsHash(sc: StartCells | null): number {
  if (!sc) return 0;
  let h = 7;
  for (const ch of `${sc.w}x${sc.h}:${sc.rows.join('/')}${sc.ox || sc.oy ? `@${sc.ox ?? 0},${sc.oy ?? 0}` : ''}${sc.heads ? `>${sc.heads.join('/')}` : ''}`) h = (h * 31 + ch.charCodeAt(0)) % 65521;
  return h % 16;
}

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/**
 * GLSL statements that set `<drawn>` to the drawing's state at this cell (0 off it): per drawn row,
 * state and 16-cell chunk, one test of a bit of a whole-number mask. `cell` / `res` are the board
 * cell and size variables.
 */
export function startCellsGLSL(sc: StartCells | null, drawn: string, cell: string, res: string, prefix: string): string[] {
  const L = [`float ${drawn} = 0.0;`];
  if (!sc) return L;
  const sx = `${prefix}_sx`, sy = `${prefix}_sy`;
  L.push(
    `float ${sx} = ${cell}.x - floor((${res}.x - ${f(sc.w)}) * 0.5)${sc.ox ? ` - ${f(sc.ox)}` : ''};`,
    `float ${sy} = ${cell}.y - floor((${res}.y - ${f(sc.h)}) * 0.5)${sc.oy ? ` - ${f(sc.oy)}` : ''};`,
  );
  for (let r = 0; r < sc.h; r++) {
    const y = sc.h - 1 - r;
    const row = sc.rows[r];
    const states = [...new Set(row.split('').map(stateOf).filter(s => s > 0))];
    for (const st of states) {
      for (let x0 = 0; x0 < sc.w; x0 += CHUNK) {
        let mask = 0;
        for (let k = 0; k < CHUNK && x0 + k < sc.w; k++) if (stateOf(row[x0 + k]) === st) mask += 2 ** k;
        if (!mask) continue;
        L.push(`if (abs(${sy} - ${f(y)}) < 0.5 && ${sx} > ${f(x0 - 0.5)} && ${sx} < ${f(x0 + CHUNK - 0.5)} && mod(floor((${f(mask)} + 0.5) / exp2(${sx} - ${f(x0)})), 2.0) > 0.5) ${drawn} = ${f(st)};`);
      }
    }
  }
  return L;
}

/**
 * GLSL statements that set `<drawn>` to the drawing's heading at this cell (0 none or off it), as
 * startCellsGLSL sets the state (the headings baked the same way). Nothing but the 0 when the
 * drawing has no headings.
 */
export function startHeadingsGLSL(sc: StartCells | null, drawn: string, cell: string, res: string, prefix: string): string[] {
  if (!sc?.heads) return [`float ${drawn} = 0.0;`];
  return startCellsGLSL({ ...sc, rows: sc.heads }, drawn, cell, res, prefix);
}
