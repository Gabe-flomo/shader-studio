/**
 * textMask.ts — words on the Grid builder's grid (docs/grid-builder.md "Text"), in the stroke font
 * of the Agent Builder (agentBuilder/strokeFont.ts):
 *
 *  - the text stamp: the cells the letters cover, centred where you click the mini grid, each given
 *    the brush's shape (textStampGridCells, through gridRules/textCells.ts on the CPU);
 *  - the pattern's mask: the wave (and the pattern's fill) only in the cells the words reach into
 *    (textCells.ts: coverage, measured square-wise, so no stroke falls between cell middles), worked
 *    out in the shader with the font's own strokes (textMaskGlsl), and on the CPU for the mini grid
 *    (textMaskAt). Both test the same distance against the same reach.
 *
 * Cell coordinates as the rest of the builder: x right, y down, a cell's middle at +0.5. Pure.
 */
import { DEFAULT_WEIGHT } from '../agentBuilder/strokeFont';
import { cleanStartText, textCovers, textRaster, textStampCells } from '../gridRules/textCells';

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

/** Is cell (x, y) (y down) of a cols × rows grid inside the words? The CPU twin of textMaskGlsl. */
export function textMaskAt(m: TextMask, cols: number, rows: number, x: number, y: number): boolean {
  const r = textRaster(m.text, m.size, m.weight);
  if (!r.segs.length) return false;
  return textCovers(r, x + 0.5 - (cols / 2 + m.x), (rows / 2 - m.y) - (y + 0.5));
}

/**
 * The mask as a GLSL function `float <name>(vec2 id)`: 1 when cell `id` (x right, y down) is inside
 * the words, else 0. One line a straight piece of a stroke (no texture), each the square-wise
 * distance of textCells.ts segLinf. `$` is the builder's name suffix.
 */
export function textMaskGlsl(m: TextMask, cols: number, rows: number, name = 'gs_mask$'): string {
  const r = textRaster(m.text, m.size, m.weight);
  if (!r.segs.length) return `float ${name}(vec2 id) { return 0.0; }`;
  const seg = `${name}_seg`;
  const L = [
    `float ${seg}_t(float n, float d) { return abs(d) < 1e-12 ? 0.0 : clamp(n / d, 0.0, 1.0); }`,
    `float ${seg}_m(vec2 v) { return max(abs(v.x), abs(v.y)); }`,
    `// The square-wise distance from p to the piece a→b: the least of the larger x / y gap along it.`,
    `float ${seg}(vec2 p, vec2 a, vec2 b) {`,
    '  vec2 o = a - p, e = b - a;',
    `  float best = min(${seg}_m(o), ${seg}_m(o + e));`,
    `  best = min(best, ${seg}_m(o + e * ${seg}_t(-o.x, e.x)));`,
    `  best = min(best, ${seg}_m(o + e * ${seg}_t(-o.y, e.y)));`,
    `  best = min(best, ${seg}_m(o + e * ${seg}_t(o.y - o.x, e.x - e.y)));`,
    `  return min(best, ${seg}_m(o + e * ${seg}_t(-(o.x + o.y), e.x + e.y)));`,
    '}',
    `float ${name}(vec2 id) {`,
    `  vec2 q = vec2(id.x + 0.5 - ${gf(cols / 2 + m.x)}, ${gf(rows / 2 - m.y)} - (id.y + 0.5));`,
    `  if (abs(q.x) > ${gf(r.halfW + 0.5)} || abs(q.y) > ${gf(r.halfH + 0.5)}) return 0.0;`,
    '  float d = 1.0e5;',
    ...r.segs.map(([ax, ay, bx, by]) => `  d = min(d, ${seg}(q, vec2(${gf(ax)}, ${gf(ay)}), vec2(${gf(bx)}, ${gf(by)})));`),
    `  return d <= ${gf(r.reach + 1e-6)} ? 1.0 : 0.0;`,
    '}',
  ];
  return L.join('\n');
}

/** The cells a text stamp covers on the mini grid (x right, y down), centred on cell (cx, cy). */
export function textStampGridCells(text: string, size: number, cx: number, cy: number, weight = DEFAULT_WEIGHT): Array<[number, number]> {
  // textStampCells works y up: flip in and out.
  return textStampCells(text, size, weight, cx, -cy).map(([x, y]) => [x, -y] as [number, number]);
}
