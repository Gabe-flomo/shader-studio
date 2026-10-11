/**
 * The Grid builder's text (docs/grid-builder.md "Text"): the text stamp fills the cells the words
 * cover with the brush's shape; the pattern's mask limits the wave and the fill to the words, in the
 * shader (the stroke font, one line a stroke) and on the mini grid alike.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { compileFragment, drawPass } from '../../compiler/__tests__/glslRun';
import { buildStandaloneGrid } from '../build';
import { gridProgram } from '../glsl';
import { emptyGridScene, newShape, placeCell } from '../spec';
import { textMaskAt, textMaskGlsl, textStampGridCells, type TextMask } from '../textMask';
import { textStampCells } from '../../gridRules/textCells';

describe('text on the Grid builder', { timeout: 60000 }, () => {
  it('the stamp covers the letters\' cells round the click, as the try board\'s stamp does (y flipped)', () => {
    const down = textStampGridCells('HI', 5, 10, 8);
    const up = textStampCells('HI', 5, 0.16, 10, -8);
    expect(down).toEqual(up.map(([x, y]) => [x, -y]));
    // Centred on the click: the middle of the cells is within a cell of it.
    const xs = down.map(c => c[0]), ys = down.map(c => c[1]);
    expect(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 8)).toBeLessThanOrEqual(1);
    // Stamped on a spec, every covered cell holds the shape.
    const s = emptyGridScene();
    s.cols = 20; s.rows = 12;
    for (const [x, y] of down) placeCell(s, x, y, 'A');
    expect(s.cells.length).toBe(down.filter(([x, y]) => x >= 0 && y >= 0 && x < 20 && y < 12).length);
    expect(s.cells.length).toBeGreaterThan(10);
  });

  it('the mask in the shader is the mask on the mini grid, cell for cell', () => {
    const m: TextMask = { text: 'OK', size: 8, weight: 0.2, x: 1, y: -1 };
    const cols = 22, rows = 14;
    const src = `precision highp float;\n${textMaskGlsl(m, cols, rows, 'gs_mask')}\nvoid main() {\n  vec2 id = vec2(floor(gl_FragCoord.x), ${rows - 1}.0 - floor(gl_FragCoord.y));\n  gl_FragColor = vec4(gs_mask(id), 0.0, 0.0, 1.0);\n}`;
    const out = drawPass(compileFragment(src), cols, rows, 'clamp', {}, {});
    let inside = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const gpu = out.data[((rows - 1 - y) * cols + x) * 4] > 0.5;
      expect(gpu, `cell ${x}, ${y}`).toBe(textMaskAt(m, cols, rows, x, y));
      if (gpu) inside++;
    }
    expect(inside).toBeGreaterThan(15);
    expect(inside).toBeLessThan(cols * rows / 2);
  });

  it('a pattern with a mask compiles, masks the wave and limits the fill to the words', () => {
    const s = emptyGridScene();
    s.cols = 16; s.rows = 10;
    s.shapes = [newShape('A'), newShape('B')];
    placeCell(s, 1, 1, 'A');
    s.pattern = { ...s.pattern, kind: 'ripple', fill: 'B', mask: { text: 'HI', size: 6, weight: 0.2, x: 0, y: 0 } };
    const prog = gridProgram(s);
    expect(prog.functions).toMatch(/float gs_mask_\w+\(vec2 id\)/);
    expect(prog.functions).toMatch(/w \*= gs_mask_\w+\(floor\(P\)\)/);
    expect(prog.functions).toMatch(/gs_drawn_\w+\(id\) < 0\.5 && gs_mask_\w+\(id\) > 0\.5/);
    const g = buildStandaloneGrid(s);
    expect(g.warnings).toEqual([]);
    const r = compileGraph({ nodes: g.nodes });
    expect(r.success, String(r.errors)).toBe(true);
    // No words, or no pattern: no mask code.
    expect(gridProgram({ ...s, pattern: { ...s.pattern, mask: { ...s.pattern.mask!, text: '' } } }).functions).not.toMatch(/gs_mask/);
    expect(gridProgram({ ...s, pattern: { ...s.pattern, kind: 'none' } }).functions).not.toMatch(/gs_mask/);
  });
});
