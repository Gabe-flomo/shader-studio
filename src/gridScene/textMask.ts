/**
 * textMask.ts — words on the Grid builder's grid (docs/grid-builder.md "Text"), in the stroke font
 * of the Agent Builder (agentBuilder/strokeFont.ts):
 *
 *  - the text stamp: the cells the letters cover, centred where you click the mini grid, each given
 *    the brush's shape (textStampGridCells, through gridRules/textCells.ts on the CPU);
 *  - the pattern's mask: the wave (and the pattern's fill) only in the cells whose middle the words
 *    cover, worked out in the shader with the font's own strokes (textMaskGlsl), and on the CPU for
 *    the mini grid (textMaskAt). Both test the same distance against the same reach.
 *
 * Cell coordinates as the rest of the builder: x right, y down, a cell's middle at +0.5. Pure.
 */
import { DEFAULT_WEIGHT, layoutStrokes, strokeDistance, strokeGlsl } from '../agentBuilder/strokeFont';
import { cleanStartText, textStampCells } from '../gridRules/textCells';

/** A GLSL float literal (as glsl.ts gf; kept here so the two files don't import each other). */
const gf = (n: number) => { const v = Math.round((Number.isFinite(n) ? n : 0) * 1e6) / 1e6; const t = String(v); return /[.e]/.test(t) ? t : `${t}.0`; };

export interface TextMask {
  /** The words (cleaned to the font's letters). */
  text: string;
  /** How many cells tall the letters are. */
  size: number;
  /** The strokes' half-weight in the font's units (the letters are 2 tall). */
  weight: number;
  /** The words' middle, in cells from the grid's middle (x right, y up). */
  x: number;
  y: number;
}

export const DEFAULT_TEXT_MASK: TextMask = { text: 'HI', size: 7, weight: 0.22, x: 0, y: 0 };
export const MIN_MASK_SIZE = 2;
export const MAX_MASK_SIZE = 24;

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A stored mask read defensively (null: none). */
export function readTextMask(v: unknown): TextMask | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Partial<TextMask>;
  const text = cleanStartText(typeof x.text === 'string' ? x.text : '');
  return {
    text,
    size: Math.max(MIN_MASK_SIZE, Math.min(MAX_MASK_SIZE, num(x.size, DEFAULT_TEXT_MASK.size))),
    weight: Math.max(0.02, Math.min(0.8, num(x.weight, DEFAULT_TEXT_MASK.weight))),
    x: Math.max(-24, Math.min(24, num(x.x, 0))),
    y: Math.max(-24, Math.min(24, num(x.y, 0))),
  };
}

/** Cells per font unit, and how near a stroke a cell's middle must be to count as inside. */
function scaleOf(m: TextMask): { unit: number; reach: number } {
  const unit = m.size / 2;
  return { unit, reach: Math.max(m.weight, 1 / (2 * unit)) };
}

/** Is cell (x, y) (y down) of a cols × rows grid inside the words? The CPU twin of textMaskGlsl. */
export function textMaskAt(m: TextMask, cols: number, rows: number, x: number, y: number): boolean {
  const { strokes } = layoutStrokes(m.text);
  if (!strokes.length) return false;
  const { unit, reach } = scaleOf(m);
  const qx = (x + 0.5 - (cols / 2 + m.x)) / unit, qy = ((rows / 2 - m.y) - (y + 0.5)) / unit;
  let d = Infinity;
  for (const s of strokes) d = Math.min(d, strokeDistance(s, qx, qy));
  return d < reach;
}

/**
 * The mask as a GLSL function `float <name>(vec2 id)`: 1 when cell `id` (x right, y down) is inside
 * the words, else 0. One line a stroke, as the Agent Builder's text (no texture). `$` is the
 * builder's name suffix.
 */
export function textMaskGlsl(m: TextMask, cols: number, rows: number, name = 'gs_mask$'): string {
  const { strokes } = layoutStrokes(m.text);
  if (!strokes.length) return `float ${name}(vec2 id) { return 0.0; }`;
  const { unit, reach } = scaleOf(m);
  const L = [
    `float ${name}(vec2 id) {`,
    `  vec2 q = vec2(id.x + 0.5 - ${gf(cols / 2 + m.x)}, ${gf(rows / 2 - m.y)} - (id.y + 0.5)) / ${gf(unit)};`,
    '  float d = 1.0e5;',
    ...strokes.map(s => `  d = min(d, ${strokeGlsl(s)});`),
    `  return d < ${gf(reach)} ? 1.0 : 0.0;`,
    '}',
  ];
  return L.join('\n');
}

/** The cells a text stamp covers on the mini grid (x right, y down), centred on cell (cx, cy). */
export function textStampGridCells(text: string, size: number, cx: number, cy: number, weight = DEFAULT_WEIGHT): Array<[number, number]> {
  // textStampCells works y up: flip in and out.
  return textStampCells(text, size, weight, cx, -cy).map(([x, y]) => [x, -y] as [number, number]);
}
