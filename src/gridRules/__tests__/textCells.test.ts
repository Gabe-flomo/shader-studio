/**
 * Text on grids keeps every stroke (gridRules/textCells.ts, gridScene/textMask.ts): the stroke font
 * rasterised to cells by coverage, so at every size each letter and digit is all there (no column or
 * row of it dropped, not broken in pieces), neighbours never run together, and the Grid builder's
 * "Only in words" mask covers the same cells. "HI" at 6 cells used to lose half the I.
 */
import { describe, expect, it } from 'vitest';
import { STROKE_GLYPHS } from '../../agentBuilder/strokeFont';
import { segLinf, textCellGrid, textRaster, textStampCells } from '../textCells';
import { textMaskAt, textMaskGlsl } from '../../gridScene/textMask';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';

const GLYPHS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
const SIZES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 24];
const WEIGHTS = [0.16, 0.05, 0.3];

/** Groups of on cells touching (sides or corners). */
function parts(grid: number[][]): number {
  const H = grid.length, W = H ? grid[0].length : 0;
  const seen = grid.map(r => r.map(() => false));
  let n = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!grid[r][c] || seen[r][c]) continue;
    n++;
    const stack = [[r, c]];
    seen[r][c] = true;
    while (stack.length) {
      const [y, x] = stack.pop()!;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < H && xx >= 0 && xx < W && grid[yy][xx] && !seen[yy][xx]) { seen[yy][xx] = true; stack.push([yy, xx]); }
      }
    }
  }
  return n;
}

/** How many pieces a glyph is in the font itself (strokes that meet are one). */
function fontParts(ch: string): number {
  const segs = textRaster(ch, 2, 0.001).segs; // font units
  const parent = segs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const meet = (a: number[], b: number[]) => [[a[0], a[1]], [a[2], a[3]]].some(([x, y]) => segLinf(x, y, b as never) < 1e-3)
    || [[b[0], b[1]], [b[2], b[3]]].some(([x, y]) => segLinf(x, y, a as never) < 1e-3);
  segs.forEach((a, i) => segs.forEach((b, j) => { if (j > i && meet(a, b)) parent[find(i)] = find(j); }));
  return new Set(segs.map((_, i) => find(i))).size;
}

describe('text rasterised to cells keeps every stroke', () => {
  it('every letter and digit, at every size from 3 to 24 cells and several weights: all its columns and rows, in one piece', () => {
    const problems: string[] = [];
    for (const ch of GLYPHS) {
      expect(STROKE_GLYPHS[ch], ch).toBeTruthy();
      const want = fontParts(ch);
      for (const size of SIZES) for (const weight of WEIGHTS) {
        const g = textCellGrid(ch, size, weight);
        const H = g.length, W = g[0]?.length ?? 0;
        const at = `${ch} at ${size} (weight ${weight})`;
        if (!g.flat().some(v => v)) { problems.push(`${at}: empty`); continue; }
        // The grid holds the whole glyph: nothing on its edge.
        if (g[0].some(v => v) || g[H - 1].some(v => v) || g.some(r => r[0] || r[W - 1])) problems.push(`${at}: touches the grid's edge`);
        // Every column and row the strokes pass through has a cell of the glyph.
        const { segs } = textRaster(ch, size, weight);
        const xs = segs.flatMap(s => [s[0], s[2]]), ys = segs.flatMap(s => [s[1], s[3]]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        for (let c = 0; c < W; c++) {
          const cx = c + 0.5 - W / 2;
          if (cx >= x0 - 1e-9 && cx <= x1 + 1e-9 && !g.some(r => r[c])) problems.push(`${at}: column ${c} dropped`);
        }
        for (let r = 0; r < H; r++) {
          const cy = H / 2 - r - 0.5;
          if (cy >= y0 - 1e-9 && cy <= y1 + 1e-9 && !g[r].some(v => v)) problems.push(`${at}: row ${r} dropped`);
        }
        // Connected as the font draws it: a stroke never falls between cells and breaks the letter.
        const n = parts(g);
        if (n > want) problems.push(`${at}: ${n} pieces, the font has ${want}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('“HI” at 6 cells keeps the whole I (the reported case) and its crossbar', () => {
    const g = textCellGrid('HI', 6);
    expect(parts(g)).toBe(2);
    const rows = g.map(r => r.join(''));
    // The H's crossbar: a row where the H is solid from side to side.
    expect(rows.some(r => /1{5}/.test(r))).toBe(true);
    // The I: a stem with serifs top and bottom (three wide at both ends).
    const cols = g[0].map((_, c) => g.map(r => r[c]));
    const firstI = cols.findIndex((col, c) => c > 0 && col.some(v => v) && !cols[c - 1].some(v => v) && c > cols.findIndex(k => k.some(v => v)) + 1);
    const top = rows.findIndex(r => r.includes('1')), bottom = rows.length - 1 - [...rows].reverse().findIndex(r => r.includes('1'));
    expect(g[top].slice(firstI).filter(v => v).length).toBeGreaterThanOrEqual(3);
    expect(g[bottom].slice(firstI).filter(v => v).length).toBeGreaterThanOrEqual(3);
  });

  it('neighbouring letters never run together or clip each other, at every size', () => {
    const problems: string[] = [];
    for (let i = 0; i + 1 < GLYPHS.length; i++) {
      const a = GLYPHS[i], b = GLYPHS[i + 1];
      for (const size of SIZES.slice(0, 10)) {
        const n = parts(textCellGrid(a + b, size));
        const want = parts(textCellGrid(a, size)) + parts(textCellGrid(b, size));
        if (n !== want) problems.push(`${a}${b} at ${size}: ${n} pieces, alone ${want}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the stamp covers the grid’s cells; the “Only in words” mask drops no column, and its GLSL agrees with the CPU', () => {
    for (const size of [3, 6, 7, 12]) {
      const on = textCellGrid('HI', size, 0.22).flat().filter(v => v).length;
      expect(textStampCells('HI', size, 0.22, 0, 0).length).toBe(on);
    }
    for (const text of ['H', 'I', 'M', 'Q', '8']) for (const size of [2, 3, 4, 5, 6, 7, 9, 12]) for (const cols of [30, 31]) {
      const rows = 20;
      const m = { text, size, weight: 0.22, x: 0, y: 0 };
      const sh = new CpuShader(`uniform vec2 u_resolution;\n${textMaskGlsl(m, cols, rows).replace(/\$/g, '_t')}\nvoid main() { vec2 id = floor(gl_FragCoord.xy); gl_FragColor = vec4(gs_mask_t(vec2(id.x, float(${rows - 1}) - id.y)), 0.0, 0.0, 1.0); }`);
      const { segs } = textRaster(text, size, 0.22);
      const xs = segs.flatMap(sg => [sg[0], sg[2]]);
      for (let x = 0; x < cols; x++) {
        let any = false;
        for (let y = 0; y < rows; y++) {
          const cpu = textMaskAt(m, cols, rows, x, y);
          const gpu = sh.run([x + 0.5, rows - 1 - y + 0.5], { resolution: [cols, rows], time: 0 })![0] > 0.5;
          expect(gpu, `${text} at ${size}, ${cols} cols, cell ${x},${y}`).toBe(cpu);
          any ||= cpu;
        }
        const cx = x + 0.5 - cols / 2;
        if (cx >= Math.min(...xs) && cx <= Math.max(...xs)) expect(any, `${text} at ${size}, ${cols} cols: column ${x} dropped`).toBe(true);
      }
    }
  });
});
