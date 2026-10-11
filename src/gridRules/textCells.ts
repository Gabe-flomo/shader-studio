/**
 * textCells.ts — words as grid cells (docs/grid-rules.md "A text start", docs/grid-builder.md
 * "Text"): the Agent Builder's stroke font (agentBuilder/strokeFont.ts) rasterised on the CPU, so
 * live cells form the letters.
 *
 * A cell is on when the letters cover its middle: the nearest stroke is closer than the stroke's
 * half-weight, or (so thin strokes stay joined) closer than half a cell. The letters are `size`
 * cells tall (the font's two units), centred on the grid's middle.
 *
 * Used by:
 *  - Grid Rules' Start → Text (`start: 'text'`, the node's `startText`): the cells become the
 *    board's drawn start (startCells.ts), with an offset, so the GLSL and the CPU deal them alike;
 *  - the try board's Text stamp, and the Grid builder's text stamp onto the mini grid.
 * The shader version of the same letters (for the Grid builder's pattern mask) is strokeGlsl. Pure.
 */
import { DEFAULT_WEIGHT, layoutStrokes, strokeChars, strokeDistance } from '../agentBuilder/strokeFont';
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

/**
 * The words as a grid of cells, rows top first: 1 (or `state`) on the letters, 0 elsewhere, not
 * cropped; the words' middle is the grid's middle (a half cell off on an even side).
 */
export function textCellGrid(text: string, size: number, weight = DEFAULT_WEIGHT, state = 1): number[][] {
  const words = cleanStartText(text);
  const { strokes, halfWidth } = layoutStrokes(words);
  if (!strokes.length) return [];
  const unit = Math.max(MIN_TEXT_SIZE, size) / 2; // cells per font unit
  const reach = Math.max(weight, 1 / (2 * unit)); // a cell is on within this of a stroke (font units)
  const w = Math.ceil(2 * (halfWidth + reach) * unit) + 1;
  const h = Math.ceil(2 * (1.3 + reach) * unit) + 1; // commas and Q's tail reach below −1
  const grid: number[][] = [];
  for (let r = 0; r < h; r++) {
    const gy = (h / 2 - r - 0.5) / unit;
    const row: number[] = [];
    for (let c = 0; c < w; c++) {
      const gx = (c + 0.5 - w / 2) / unit;
      let d = Infinity;
      for (const s of strokes) { d = Math.min(d, strokeDistance(s, gx, gy)); if (d < reach) break; }
      row.push(d < reach ? state : 0);
    }
    grid.push(row);
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
