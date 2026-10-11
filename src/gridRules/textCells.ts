/**
 * textCells.ts — words as grid cells (docs/grid-rules.md "A text start", docs/grid-builder.md
 * "Text"): the Agent Builder's stroke font (agentBuilder/strokeFont.ts) rasterised on the CPU, so
 * live cells form the letters.
 *
 * A cell is on when a stroke reaches into it (coverage, not its middle point): the stroke's line
 * passes through the cell's square, or a heavy stroke's half-weight reaches its middle. Measured
 * square-wise (the largest of the x and y distances), so a stroke lying on the line between two
 * cells marks both rather than neither, and a thin stroke at a small size never falls between
 * cell middles and drops out. Arcs are measured as short straight pieces. The letters are spaced at
 * least two cells apart (more than twice the reach and a cell), so neighbours never run together,
 * and the grid is sized from the strokes' own extent plus that reach, so nothing is cut off. The
 * letters are `size` cells tall (the font's two units), centred on the grid's middle.
 *
 * Used by:
 *  - Grid Rules' Start → Text (`start: 'text'`, the node's `startText`): the cells become the
 *    board's drawn start (startCells.ts), with an offset, so the GLSL and the CPU deal them alike;
 *  - the try board's Text stamp, and the Grid builder's text stamp onto the mini grid.
 * The shader version of the same letters (for the Grid builder's pattern mask) is strokeGlsl. Pure.
 */
import { DEFAULT_WEIGHT, LETTER_GAP, layoutStrokes, strokeChars, type Stroke } from '../agentBuilder/strokeFont';
import { startCellsFromGrid, type StartCells } from './startCells';

/** Most characters a text start holds. */
export const MAX_TEXT_CHARS = 16;
/** Letters' height in cells: the smallest and largest. */
export const MIN_TEXT_SIZE = 3;
export const MAX_TEXT_SIZE = 60;

export interface StartText {
  /** The words (A–Z, 0–9 and a few signs: the stroke font's). */
  text: string;
  /** How many cells tall the letters are. */
  size: number;
  /** The strokes' half-weight, in the font's units (the letters are 2 tall). */
  weight: number;
  /** Where the words' middle sits, in cells from the board's middle (x right, y up). */
  x: number;
  y: number;
  /** The state the letters' cells start in (rules with several states). */
  state: number;
}

export const DEFAULT_START_TEXT: StartText = { text: 'LIFE', size: 12, weight: DEFAULT_WEIGHT, x: 0, y: 0, state: 1 };

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The words as the font can draw them: upper case, known characters, up to MAX_TEXT_CHARS. */
export const cleanStartText = (t: string) => strokeChars(String(t ?? '')).slice(0, MAX_TEXT_CHARS);

/** A stored text start read defensively. */
export function readStartText(v: unknown): StartText {
  const x = (v && typeof v === 'object' ? v : {}) as Partial<StartText>;
  const text = typeof x.text === 'string' ? cleanStartText(x.text) : DEFAULT_START_TEXT.text;
  return {
    text,
    size: Math.max(MIN_TEXT_SIZE, Math.min(MAX_TEXT_SIZE, num(x.size, DEFAULT_START_TEXT.size))),
    weight: Math.max(0.02, Math.min(0.8, num(x.weight, DEFAULT_START_TEXT.weight))),
    x: Math.round(num(x.x, 0)),
    y: Math.round(num(x.y, 0)),
    state: Math.max(1, Math.min(15, Math.round(num(x.state, 1)))),
  };
}

/** A straight piece of a letter, in cells from the words' middle (x right, y up). */
export type CellSeg = [number, number, number, number];

/** The words laid out in cells: their strokes as straight pieces, how far a stroke reaches, and the extent. */
export interface TextRaster {
  segs: CellSeg[];
  /** A cell is on when a stroke is within this of its middle, square-wise (cells): at least half a cell. */
  reach: number;
  /** The strokes' extent either side of the middle, reach included (cells). */
  halfW: number;
  halfH: number;
}

const DEG = Math.PI / 180;

function strokeSegs(st: Stroke, unit: number): CellSeg[] {
  if (st.k === 'L') return [[st.a[0] * unit, st.a[1] * unit, st.b[0] * unit, st.b[1] * unit]];
  if (st.k === 'P') return [[st.p[0] * unit, st.p[1] * unit, st.p[0] * unit, st.p[1] * unit]];
  // An arc as straight pieces: about 10° each, fine enough that no piece strays a tenth of a cell at 60 cells.
  const n = Math.max(2, Math.ceil(Math.abs(st.a1 - st.a0) / 10));
  const pt = (k: number) => {
    const a = (st.a0 + (st.a1 - st.a0) * k / n) * DEG;
    return [(st.c[0] + Math.cos(a) * st.r) * unit, (st.c[1] + Math.sin(a) * st.r) * unit];
  };
  const out: CellSeg[] = [];
  for (let k = 0; k < n; k++) { const [ax, ay] = pt(k), [bx, by] = pt(k + 1); out.push([ax, ay, bx, by]); }
  return out;
}

/**
 * The words in cells: `size` cells tall, strokes of half-weight `weight` (font units). The gap
 * between letters is widened at small sizes so two letters' cells never touch.
 */
export function textRaster(text: string, size: number, weight = DEFAULT_WEIGHT): TextRaster {
  const unit = size / 2; // cells per font unit
  const reach = Math.max(0.5, weight * unit);
  const gap = Math.max(LETTER_GAP, (2 * reach + 1.01) / unit);
  const { strokes } = layoutStrokes(cleanStartText(text), gap);
  const segs = strokes.flatMap(st => strokeSegs(st, unit));
  let mx = 0, my = 0;
  for (const [ax, ay, bx, by] of segs) mx = Math.max(mx, Math.abs(ax), Math.abs(bx)), my = Math.max(my, Math.abs(ay), Math.abs(by));
  return { segs, reach, halfW: mx + reach, halfH: my + reach };
}

const linf = (x: number, y: number) => Math.max(Math.abs(x), Math.abs(y));
const tAt = (num: number, den: number) => (Math.abs(den) < 1e-12 ? 0 : Math.max(0, Math.min(1, num / den)));

/**
 * The square-wise distance from (px, py) to a straight piece: the smallest, along the piece, of the
 * larger of the x and y gaps. It bends only where a gap is 0 or the two gaps are equal, so the least
 * is at one of those points or an end. The GLSL in textMask.ts does the same sums.
 */
export function segLinf(px: number, py: number, s: CellSeg): number {
  const ox = s[0] - px, oy = s[1] - py, dx = s[2] - s[0], dy = s[3] - s[1];
  let best = Math.min(linf(ox, oy), linf(ox + dx, oy + dy));
  for (const t of [tAt(-ox, dx), tAt(-oy, dy), tAt(oy - ox, dx - dy), tAt(-(ox + oy), dx + dy)]) best = Math.min(best, linf(ox + dx * t, oy + dy * t));
  return best;
}

/** Does the cell whose middle is (x, y) (cells from the words' middle, y up) hold part of a letter? */
export function textCovers(r: TextRaster, x: number, y: number): boolean {
  if (Math.abs(x) > r.halfW + 0.5 || Math.abs(y) > r.halfH + 0.5) return false;
  for (const s of r.segs) if (segLinf(x, y, s) <= r.reach + 1e-9) return true;
  return false;
}

/**
 * The words as a grid of cells, rows top first: 1 (or `state`) on the letters, 0 elsewhere, not
 * cropped; the words' middle is the grid's middle (a half cell off on an even side).
 */
export function textCellGrid(text: string, size: number, weight = DEFAULT_WEIGHT, state = 1): number[][] {
  const r = textRaster(text, Math.max(MIN_TEXT_SIZE, size), weight);
  if (!r.segs.length) return [];
  // Sized from the strokes' own extent, reach included, and a spare cell each side: nothing is cut off.
  const w = Math.ceil(2 * r.halfW) + 2;
  const h = Math.ceil(2 * r.halfH) + 2;
  const grid: number[][] = [];
  for (let row = 0; row < h; row++) {
    const gy = h / 2 - row - 0.5;
    const line: number[] = [];
    for (let c = 0; c < w; c++) line.push(textCovers(r, c + 0.5 - w / 2, gy) ? state : 0);
    grid.push(line);
  }
  return grid;
}

/**
 * A text start as a drawn start (startCells.ts): the letters' cells, cropped, placed with their
 * middle `x`, `y` cells from the board's middle. Null when nothing is drawn (no known letters).
 */
export function textStartCells(st: StartText): StartCells | null {
  const grid = textCellGrid(st.text, st.size, st.weight, st.state);
  if (!grid.length) return null;
  const sc = startCellsFromGrid(grid);
  if (!sc) return null;
  // Cropping moves the middle: keep the letters' own middle where the uncropped grid's was.
  const H = grid.length, W = grid[0].length;
  let x0 = W, x1 = -1, r0 = H, r1 = -1;
  grid.forEach((row, r) => row.forEach((v, c) => { if (v > 0) { x0 = Math.min(x0, c); x1 = Math.max(x1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); } }));
  // Where the cropped drawing's bottom-left lands, relative to where startOrigin would put it.
  const dx = Math.round(x0 + sc.w / 2 - W / 2);
  const dy = Math.round((H - 1 - r1) + sc.h / 2 - H / 2);
  return { ...sc, ox: st.x + dx, oy: st.y + dy };
}

/** The cells a text stamp covers, centred on (cx, cy) (x right, y up), as [x, y] pairs. */
export function textStampCells(text: string, size: number, weight: number, cx: number, cy: number): Array<[number, number]> {
  const grid = textCellGrid(text, size, weight);
  const H = grid.length;
  if (!H) return [];
  const W = grid[0].length;
  const ox = cx - Math.floor(W / 2), oy = cy - Math.floor(H / 2);
  const out: Array<[number, number]> = [];
  grid.forEach((row, r) => row.forEach((v, c) => { if (v > 0) out.push([ox + c, oy + (H - 1 - r)]); }));
  return out;
}
