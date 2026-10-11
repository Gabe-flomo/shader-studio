/**
 * strokeFont.ts — the Agent Builder's text in the shader's own style (docs/agent-builder.md "Text as
 * a shape or a wall"). Pure.
 *
 * A monoline font drawn as a signed distance: each letter is a few strokes (straight segments,
 * circular arcs and dots) on a grid two units tall (y −1 … 1), and the text's distance is the
 * nearest stroke's, less the stroke's half-weight. So the letters are smooth at any size, round at
 * the ends and joins, the same on the CPU and the GPU, and they compile to one line per stroke of an
 * Expression Block: no texture, so they work as food, a wall, a birth place or a mask, inside a
 * group and on an exported page.
 *
 * The older 5 × 7 pixel font (madeShapes.ts, `font: 'blocky'`) still loads and draws as before.
 */

/** A stroke in glyph units: a segment, an arc (degrees, counter-clockwise from a0 to a1) or a dot. */
export type Stroke =
  | { k: 'L'; a: [number, number]; b: [number, number] }
  | { k: 'A'; c: [number, number]; r: number; a0: number; a1: number }
  | { k: 'P'; p: [number, number] };

const L = (ax: number, ay: number, bx: number, by: number): Stroke => ({ k: 'L', a: [ax, ay], b: [bx, by] });
const A = (cx: number, cy: number, r: number, a0: number, a1: number): Stroke => ({ k: 'A', c: [cx, cy], r, a0, a1 });
const P = (x: number, y: number): Stroke => ({ k: 'P', p: [x, y] });

// A stadium (an O): two half circles joined by straight sides.
const O: Stroke[] = [A(0, 0.4, 0.6, 0, 180), L(-0.6, 0.4, -0.6, -0.4), A(0, -0.4, 0.6, 180, 360), L(0.6, -0.4, 0.6, 0.4)];
const PBOWL: Stroke[] = [L(-0.6, -1, -0.6, 1), L(-0.6, 1, 0.1, 1), A(0.1, 0.5, 0.5, -90, 90), L(0.1, 0, -0.6, 0)];

/** The glyphs (upper case; lower case is drawn upper case). */
export const STROKE_GLYPHS: Record<string, Stroke[]> = {
  ' ': [],
  A: [L(-0.6, -1, 0, 1), L(0, 1, 0.6, -1), L(-0.39, -0.3, 0.39, -0.3)],
  B: [L(-0.6, -1, -0.6, 1), L(-0.6, 1, 0.05, 1), A(0.05, 0.5, 0.5, -90, 90), L(-0.6, 0, 0.1, 0), A(0.1, -0.5, 0.5, -90, 90), L(0.1, -1, -0.6, -1)],
  C: [A(0, 0.4, 0.6, 20, 180), L(-0.6, 0.4, -0.6, -0.4), A(0, -0.4, 0.6, 180, 340)],
  D: [L(-0.6, -1, -0.6, 1), L(-0.6, 1, 0, 1), A(0, 0.4, 0.6, 0, 90), L(0.6, 0.4, 0.6, -0.4), A(0, -0.4, 0.6, -90, 0), L(0, -1, -0.6, -1)],
  E: [L(-0.6, -1, -0.6, 1), L(-0.6, 1, 0.6, 1), L(-0.6, 0, 0.35, 0), L(-0.6, -1, 0.6, -1)],
  F: [L(-0.6, -1, -0.6, 1), L(-0.6, 1, 0.6, 1), L(-0.6, 0, 0.35, 0)],
  G: [A(0, 0.4, 0.6, 20, 180), L(-0.6, 0.4, -0.6, -0.4), A(0, -0.4, 0.6, 180, 360), L(0.6, -0.4, 0.6, -0.05), L(0.6, -0.05, 0.05, -0.05)],
  H: [L(-0.6, -1, -0.6, 1), L(0.6, -1, 0.6, 1), L(-0.6, 0, 0.6, 0)],
  I: [L(0, -1, 0, 1), L(-0.35, 1, 0.35, 1), L(-0.35, -1, 0.35, -1)],
  J: [L(0.4, 1, 0.4, -0.45), A(-0.1, -0.45, 0.5, 180, 360)],
  K: [L(-0.6, -1, -0.6, 1), L(0.6, 1, -0.6, -0.1), L(-0.2, 0.27, 0.6, -1)],
  L: [L(-0.6, 1, -0.6, -1), L(-0.6, -1, 0.6, -1)],
  M: [L(-0.6, -1, -0.6, 1), L(-0.6, 1, 0, -0.1), L(0, -0.1, 0.6, 1), L(0.6, 1, 0.6, -1)],
  N: [L(-0.6, -1, -0.6, 1), L(-0.6, 1, 0.6, -1), L(0.6, -1, 0.6, 1)],
  O,
  P: PBOWL,
  Q: [...O, L(0.15, -0.55, 0.65, -1.05)],
  R: [...PBOWL, L(0.05, 0, 0.6, -1)],
  S: [A(0, 0.5, 0.5, 20, 270), A(0, -0.5, 0.5, -200, 90)],
  T: [L(-0.6, 1, 0.6, 1), L(0, 1, 0, -1)],
  U: [L(-0.6, 1, -0.6, -0.4), A(0, -0.4, 0.6, 180, 360), L(0.6, -0.4, 0.6, 1)],
  V: [L(-0.6, 1, 0, -1), L(0, -1, 0.6, 1)],
  W: [L(-0.6, 1, -0.3, -1), L(-0.3, -1, 0, 0.2), L(0, 0.2, 0.3, -1), L(0.3, -1, 0.6, 1)],
  X: [L(-0.6, 1, 0.6, -1), L(-0.6, -1, 0.6, 1)],
  Y: [L(-0.6, 1, 0, 0), L(0.6, 1, 0, 0), L(0, 0, 0, -1)],
  Z: [L(-0.6, 1, 0.6, 1), L(0.6, 1, -0.6, -1), L(-0.6, -1, 0.6, -1)],
  0: [...O, L(0.4, 0.6, -0.4, -0.6)],
  1: [L(0, -1, 0, 1), L(0, 1, -0.35, 0.65), L(-0.35, -1, 0.35, -1)],
  2: [A(0, 0.4, 0.6, -35, 170), L(0.49, 0.056, -0.6, -1), L(-0.6, -1, 0.6, -1)],
  3: [A(0, 0.5, 0.5, -90, 160), A(0, -0.5, 0.5, -160, 90)],
  4: [L(0.25, -1, 0.25, 1), L(0.25, 1, -0.6, -0.35), L(-0.6, -0.35, 0.6, -0.35)],
  5: [L(0.55, 1, -0.5, 1), L(-0.5, 1, -0.5, 0.2), L(-0.5, 0.2, 0, 0.2), A(0, -0.4, 0.6, -150, 90)],
  6: [A(0, -0.4, 0.6, 0, 360), L(-0.6, -0.4, -0.6, 0.4), A(0, 0.4, 0.6, 30, 180)],
  7: [L(-0.6, 1, 0.6, 1), L(0.6, 1, -0.1, -1)],
  8: [A(0, 0.55, 0.45, 0, 360), A(0, -0.45, 0.55, 0, 360)],
  9: [A(0, 0.4, 0.6, 0, 360), L(0.6, 0.4, 0.6, -0.4), A(0, -0.4, 0.6, 200, 360)],
  '!': [L(0, 1, 0, -0.35), P(0, -1)],
  '?': [A(0, 0.45, 0.55, -90, 180), L(0, -0.1, 0, -0.35), P(0, -1)],
  '.': [P(0, -1)],
  ',': [L(0.1, -0.85, -0.15, -1.25)],
  ':': [P(0, 0.35), P(0, -0.85)],
  "'": [L(0, 1, 0, 0.55)],
  '-': [L(-0.4, 0, 0.4, 0)],
  '+': [L(-0.45, 0, 0.45, 0), L(0, -0.45, 0, 0.45)],
  '*': [L(0, -0.5, 0, 0.5), L(-0.43, -0.25, 0.43, 0.25), L(-0.43, 0.25, 0.43, -0.25)],
  '/': [L(-0.5, -1, 0.5, 1)],
  '=': [L(-0.45, 0.3, 0.45, 0.3), L(-0.45, -0.3, 0.45, -0.3)],
  '#': [L(-0.25, 1, -0.35, -1), L(0.35, 1, 0.25, -1), L(-0.6, 0.35, 0.6, 0.35), L(-0.6, -0.35, 0.6, -0.35)],
};

/** The gap between letters (glyph units), on top of their own widths. */
export const LETTER_GAP = 0.6;
/** A stroke's default half-weight (glyph units: the letters are 2 tall). */
export const DEFAULT_WEIGHT = 0.16;

const DEG = Math.PI / 180;
const arcPoint = (s: Extract<Stroke, { k: 'A' }>, deg: number): [number, number] => [s.c[0] + Math.cos(deg * DEG) * s.r, s.c[1] + Math.sin(deg * DEG) * s.r];

/** A letter's half-width: how far its strokes reach left or right of its middle. */
function halfWidth(ch: string): number {
  const g = STROKE_GLYPHS[ch] ?? [];
  if (!g.length) return 0.35;
  let m = 0;
  for (const s of g) {
    if (s.k === 'L') m = Math.max(m, Math.abs(s.a[0]), Math.abs(s.b[0]));
    else if (s.k === 'P') m = Math.max(m, Math.abs(s.p[0]));
    else for (let i = 0; i <= 24; i++) m = Math.max(m, Math.abs(arcPoint(s, s.a0 + (s.a1 - s.a0) * i / 24)[0]));
  }
  return Math.max(m, 0.15);
}

/** The characters the font draws, from what was typed (upper case; unknown characters dropped). */
export const strokeChars = (t: string) => t.toUpperCase().split('').filter(c => c in STROKE_GLYPHS).join('');

/** The text's strokes laid out along a line, centred on 0 (glyph units), and its half-width. */
export function layoutStrokes(text: string): { strokes: Stroke[]; halfWidth: number } {
  const chars = strokeChars(text).split('');
  const widths = chars.map(halfWidth);
  const total = widths.reduce((s, w) => s + 2 * w, 0) + Math.max(0, chars.length - 1) * LETTER_GAP;
  let pen = -total / 2;
  const out: Stroke[] = [];
  chars.forEach((ch, i) => {
    const ox = pen + widths[i];
    for (const s of STROKE_GLYPHS[ch]) {
      if (s.k === 'L') out.push({ k: 'L', a: [s.a[0] + ox, s.a[1]], b: [s.b[0] + ox, s.b[1]] });
      else if (s.k === 'A') out.push({ ...s, c: [s.c[0] + ox, s.c[1]] });
      else out.push({ k: 'P', p: [s.p[0] + ox, s.p[1]] });
    }
    pen += 2 * widths[i] + LETTER_GAP;
  });
  return { strokes: out, halfWidth: total / 2 };
}

/** The distance from (x, y) to one stroke (glyph units). */
export function strokeDistance(s: Stroke, x: number, y: number): number {
  if (s.k === 'P') return Math.hypot(x - s.p[0], y - s.p[1]);
  if (s.k === 'L') {
    const bx = s.b[0] - s.a[0], by = s.b[1] - s.a[1], px = x - s.a[0], py = y - s.a[1];
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / Math.max(bx * bx + by * by, 1e-12)));
    return Math.hypot(px - bx * t, py - by * t);
  }
  const px = x - s.c[0], py = y - s.c[1], len = Math.hypot(px, py);
  const half = (s.a1 - s.a0) / 2, mid = (s.a0 + s.a1) / 2;
  if (half >= 180 || px * Math.cos(mid * DEG) + py * Math.sin(mid * DEG) >= Math.cos(half * DEG) * len) return Math.abs(len - s.r);
  const e0 = arcPoint(s, s.a0), e1 = arcPoint(s, s.a1);
  return Math.min(Math.hypot(x - e0[0], y - e0[1]), Math.hypot(x - e1[0], y - e1[1]));
}

/** The text's signed distance at (x, y), glyph units: below 0 on the letters. */
export function textDistance(text: string, x: number, y: number, weight = DEFAULT_WEIGHT): number {
  const { strokes } = layoutStrokes(text);
  let d = 1e5;
  for (const s of strokes) d = Math.min(d, strokeDistance(s, x, y));
  return d - weight;
}

const glf = (v: number) => { const s = String(Math.round(v * 1e5) / 1e5); return /[.e]/.test(s) ? s : `${s}.0`; };
const v2 = (p: [number, number]) => `vec2(${glf(p[0])}, ${glf(p[1])})`;

/** One stroke's distance as GLSL, in `q` (glyph units). */
export function strokeGlsl(s: Stroke): string {
  if (s.k === 'P') return `length(q - ${v2(s.p)})`;
  if (s.k === 'L') {
    const ba: [number, number] = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
    const l2 = Math.max(ba[0] * ba[0] + ba[1] * ba[1], 1e-9);
    return `length(q - ${v2(s.a)} - ${v2(ba)} * clamp(dot(q - ${v2(s.a)}, ${v2(ba)}) / ${glf(l2)}, 0.0, 1.0))`;
  }
  const half = (s.a1 - s.a0) / 2, mid = (s.a0 + s.a1) / 2;
  if (half >= 180) return `abs(length(q - ${v2(s.c)}) - ${glf(s.r)})`;
  const m: [number, number] = [Math.cos(mid * DEG), Math.sin(mid * DEG)];
  return `(dot(q - ${v2(s.c)}, ${v2(m)}) >= ${glf(Math.cos(half * DEG))} * length(q - ${v2(s.c)}) ? abs(length(q - ${v2(s.c)}) - ${glf(s.r)}) : min(length(q - ${v2(arcPoint(s, s.a0))}), length(q - ${v2(arcPoint(s, s.a1))})))`;
}

/**
 * The text's strokes as SVG path data in picture space through `toView` (each stroke its own
 * subpath), to be drawn with a round-capped line as wide as the strokes.
 */
export function strokesPath(text: string, toView: (x: number, y: number) => { x: number; y: number }): string {
  const parts: string[] = [];
  const f = (p: { x: number; y: number }) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  for (const s of layoutStrokes(text).strokes) {
    if (s.k === 'P') { const p = toView(s.p[0], s.p[1]); parts.push(`M ${f(p)} L ${f({ x: p.x + 0.01, y: p.y })}`); continue; }
    if (s.k === 'L') { parts.push(`M ${f(toView(s.a[0], s.a[1]))} L ${f(toView(s.b[0], s.b[1]))}`); continue; }
    const n = Math.max(4, Math.ceil(Math.abs(s.a1 - s.a0) / 10));
    const pts = Array.from({ length: n + 1 }, (_, i) => { const q = arcPoint(s, s.a0 + (s.a1 - s.a0) * i / n); return toView(q[0], q[1]); });
    parts.push(pts.map((p, i) => `${i ? 'L' : 'M'} ${f(p)}`).join(' '));
  }
  return parts.join(' ');
}
