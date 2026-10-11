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
}

/** Largest drawing, in cells each way (the GLSL bakes a test per drawn row and state). */
export const MAX_START = 64;
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
  return fromGrid(rows.map(r => Array.from({ length: w }, (_, i) => stateOf(r[i]))));
}

/** The state of a drawing's cell, x right, y up from its bottom row (0 outside). */
export function startCellAt(sc: StartCells, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= sc.w || y >= sc.h) return 0;
  return stateOf(sc.rows[sc.h - 1 - y][x]);
}

/** A drawing from a grid of states (rows top first), cropped to its cells; null when it is empty. */
export function startCellsFromGrid(grid: number[][]): StartCells | null {
  return fromGrid(grid.map(r => r.map(v => Math.max(0, Math.min(15, Math.round(Number(v) || 0))))));
}

function fromGrid(grid: number[][]): StartCells | null {
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  grid.forEach((row, r) => row.forEach((v, c) => {
    if (v > 0) { x0 = Math.min(x0, c); x1 = Math.max(x1, c); y0 = Math.min(y0, r); y1 = Math.max(y1, r); }
  }));
  if (x1 < 0) return null;
  // Too big: keep the middle MAX_START × MAX_START.
  if (x1 - x0 + 1 > MAX_START) { const mid = Math.floor((x0 + x1) / 2); x0 = mid - MAX_START / 2; x1 = x0 + MAX_START - 1; }
  if (y1 - y0 + 1 > MAX_START) { const mid = Math.floor((y0 + y1) / 2); y0 = mid - MAX_START / 2; y1 = y0 + MAX_START - 1; }
  const rows: string[] = [];
  for (let r = y0; r <= y1; r++) {
    let s = '';
    for (let c = x0; c <= x1; c++) s += charOf(grid[r]?.[c] ?? 0);
    rows.push(s);
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, rows };
}

/** A drawing from a CPU board's states (its cells, rounded), cropped; null when the board is empty. */
export function startCellsFromBoard(B: CpuBoard): StartCells | null {
  const grid = Array.from({ length: B.h }, (_, r) => Array.from({ length: B.w }, (_, x) => Math.round(B.a[(B.h - 1 - r) * B.w + x])));
  return startCellsFromGrid(grid);
}

/** Where a drawing's bottom-left cell lands on a w × h board (the same on the GPU). */
export const startOrigin = (sc: StartCells, w: number, h: number): [number, number] => [Math.floor((w - sc.w) / 2), Math.floor((h - sc.h) / 2)];

/** The drawing's state at board cell (x, y up), placed in the middle of a w × h board. */
export function stampedAt(sc: StartCells, w: number, h: number, x: number, y: number): number {
  const [ox, oy] = startOrigin(sc, w, h);
  return startCellAt(sc, x - ox, y - oy);
}

/** How many cells are drawn (any state but empty). */
export const drawnCount = (sc: StartCells | null) => (sc ? sc.rows.join('').split('').filter(c => c !== '.').length : 0);

/** A small whole number (0–15) that changes with the drawing: part of the board's signature, so a new drawing deals a new board. */
export function startCellsHash(sc: StartCells | null): number {
  if (!sc) return 0;
  let h = 7;
  for (const ch of `${sc.w}x${sc.h}:${sc.rows.join('/')}`) h = (h * 31 + ch.charCodeAt(0)) % 65521;
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
    `float ${sx} = ${cell}.x - floor((${res}.x - ${f(sc.w)}) * 0.5);`,
    `float ${sy} = ${cell}.y - floor((${res}.y - ${f(sc.h)}) * 0.5);`,
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
