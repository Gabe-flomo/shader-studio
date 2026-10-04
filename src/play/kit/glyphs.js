/**
 * glyphs.js — character sets for anything that draws the picture as text:
 * the Glyphs layer's ASCII style (layers.js klDrawGlyphs) and the Finish
 * stack's ASCII effect (finish.js). Both offer the same named sets, split a
 * typed ramp into characters the same way (emoji stay whole), and the Finish
 * effect orders them by how much of their cell they cover.
 *
 * Part of the layer kit: exportHtml inlines it into one closure with the
 * other kit files, so every top-level name starts `gy`/`GY_`.
 */

/**
 * Named character sets, darkest first (a space leaves the darkest cells
 * empty). Classic is the Glyphs layer's default ramp; Moon is the emoji ramp
 * its Characters hint suggests.
 */
export const GY_SETS = [
  { name: 'Classic', chars: ' .:-=+*#%@' },
  { name: 'Dense', chars: ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B$@' },
  { name: 'Blocks', chars: ' ░▒▓█' },
  { name: 'Binary', chars: ' 01' },
  { name: 'Dots', chars: ' ·•●' },
  { name: 'Moon', chars: '🌑🌒🌓🌔🌕' },
  { name: 'Hearts', chars: '🖤💜💙💚💛🧡❤️🤍' },
  { name: 'Weather', chars: '🌑☁️🌧️⛅🌤️☀️' },
];

/** The most characters a ramp keeps (a Finish effect's atlas holds this many cells). */
export const GY_MAX = 96;

/**
 * A ramp split into what reads as one character each: emoji (flags, skin
 * tones, ZWJ families, variation selectors) stay whole instead of splitting.
 */
export function gyList(chars) {
  const text = String(chars || '');
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), x => x.segment);
  return Array.from(text);
}

/** The fonts a glyph is drawn in: monospace for text, then the platforms' colour emoji fonts. */
export const GY_FONT = '"JetBrains Mono", Menlo, Consolas, monospace, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';

/**
 * How much of its cell each glyph covers, 0..1: the mean of alpha × brightness
 * over the cell (so white text counts its ink, and a colour emoji counts how
 * bright it looks). `data` is RGBA (straight) of an atlas `cols` cells wide,
 * each `cell` px square, glyph i at column i % cols, row floor(i / cols).
 */
export function gyCoverage(data, width, cols, cell, n) {
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const x0 = (i % cols) * cell, y0 = Math.floor(i / cols) * cell;
    let s = 0;
    for (let y = y0; y < y0 + cell; y++) for (let x = x0; x < x0 + cell; x++) {
      const k = (y * width + x) * 4;
      s += (data[k + 3] / 255) * (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255;
    }
    out[i] = s / (cell * cell);
  }
  return out;
}

/**
 * The order to use the glyphs in, darkest first: by coverage (a stable sort,
 * so equal ones keep their typed order), or as typed when `keepOrder`.
 */
export function gyOrder(coverage, keepOrder) {
  const idx = coverage.map((_, i) => i);
  if (keepOrder) return idx;
  return idx.sort((a, b) => (coverage[a] - coverage[b]) || (a - b));
}

/**
 * The glyphs of a ramp drawn into a square-celled atlas canvas (white text;
 * emoji keep their colours), measured, and laid out again darkest first
 * (unless `keepOrder`). Returns { canvas, n, cols, rows, cell, glyphs (in the
 * order used), coverage (in that order) }, or null without a document.
 * Each glyph sits in its cell with a margin, so a mipmapped atlas doesn't
 * bleed between neighbours.
 */
export function gyAtlas(chars, keepOrder, cell = 64) {
  if (typeof document === 'undefined') return null;
  let glyphs = gyList(chars).slice(0, GY_MAX);
  if (!glyphs.length) glyphs = gyList(GY_SETS[0].chars);
  const n = glyphs.length, cols = Math.min(n, 12), rows = Math.ceil(n / cols);
  const draw = list => {
    const c = document.createElement('canvas');
    c.width = cols * cell; c.height = rows * cell;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return null;
    // Each glyph fills the inner 7/8 of its cell (the margin keeps a mipmapped atlas from bleeding
    // between neighbours): narrow text characters are widened to it (so ░▒▓█ make solid tones), wide
    // ones (emoji, CJK) squeezed into it.
    const inner = cell * 0.875, m = (cell - inner) / 2;
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '600 ' + inner + 'px ' + GY_FONT;
    list.forEach((g, i) => {
      const gx = (i % cols) * cell, gy = Math.floor(i / cols) * cell;
      const w = Math.max(1, x.measureText(g).width), k = Math.max(0.4, Math.min(1.7, inner / w));
      x.save();
      x.beginPath(); x.rect(gx + m, gy + m, inner, inner); x.clip();
      x.translate(gx + cell / 2, gy + cell * 0.52); x.scale(k, Math.min(1, k)); x.fillText(g, 0, 0);
      x.restore();
    });
    return c;
  };
  const first = draw(glyphs);
  if (!first) return null;
  const cov = gyCoverage(first.getContext('2d').getImageData(0, 0, first.width, first.height).data, first.width, cols, cell, n);
  const order = gyOrder(cov, keepOrder);
  const sorted = order.map(i => glyphs[i]);
  const canvas = order.every((v, i) => v === i) ? first : draw(sorted);
  return { canvas, n, cols, rows, cell, glyphs: sorted, coverage: order.map(i => cov[i]) };
}
