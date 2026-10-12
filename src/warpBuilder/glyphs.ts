/**
 * glyphs.ts — the palette's pictures, drawn once at module load: a static plot of y = f(x) for each
 * function tile, and a step or symbol for If and the comparisons. No GL, no timers, no store reads:
 * the palette renders nothing live (docs/warp-builder.md, "The palette").
 */
import { FN_TILES } from './tiles';

export const GLYPH_SIZE = 40;
const PAD = 4;

/** The x and y range each function is plotted over (default: −π…π by −3…3). */
const RANGE: Record<string, [number, number, number, number]> = {
  sin: [-Math.PI, Math.PI, -1.4, 1.4],
  cos: [-Math.PI, Math.PI, -1.4, 1.4],
  tan: [-1.4, 1.4, -3, 3],
  fract: [-1, 2, -0.2, 1.2],
  floor: [-2, 2, -2.5, 2.5],
  mod: [-1, 2, -0.2, 1.2],
  pow: [-1.6, 1.6, -0.5, 3],
  exp: [-3, 1, -0.3, 3],
  log: [0.05, 4, -3, 2],
  sqrt: [-0.5, 4, -0.5, 2.5],
  sign: [-2, 2, -1.6, 1.6],
  smoothstep: [-0.4, 1.4, -0.2, 1.2],
  min: [-2, 2, -1.5, 1.5],
  max: [-2, 2, -1.5, 1.5],
  mix: [-2, 2, -2, 2],
  length: [-2, 2, -0.5, 2.5],
  atan: [-6, 6, -2, 2],
  valueNoise: [0, 6, -1.2, 1.2],
  abs: [-2, 2, -0.5, 2.5],
};

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** The curve of one function as an SVG path (a jump of the curve lifts the pen). */
function curvePath(curve: (x: number) => number, [x0, x1, y0, y1]: [number, number, number, number]): string {
  const w = GLYPH_SIZE - 2 * PAD;
  const N = 60;
  let d = '';
  let prev: number | null = null;
  for (let i = 0; i <= N; i++) {
    const x = x0 + (i / N) * (x1 - x0);
    const v = curve(x);
    const y = Math.max(y0, Math.min(y1, v));
    const py = GLYPH_SIZE - PAD - ((y - y0) / (y1 - y0)) * w;
    const px = PAD + (i / N) * w;
    const jump = prev !== null && Math.abs(py - prev) > w * 0.45;
    d += `${i === 0 || jump ? 'M' : 'L'}${f1(px)} ${f1(py)}`;
    prev = py;
  }
  return d;
}

/** Where the axes cross, in glyph coordinates (clamped inside the plot). */
function axes([x0, x1, y0, y1]: [number, number, number, number]): { x: number; y: number } {
  const w = GLYPH_SIZE - 2 * PAD;
  const ax = x0 <= 0 && x1 >= 0 ? PAD + ((0 - x0) / (x1 - x0)) * w : PAD;
  const ay = y0 <= 0 && y1 >= 0 ? GLYPH_SIZE - PAD - ((0 - y0) / (y1 - y0)) * w : GLYPH_SIZE - PAD;
  return { x: ax, y: ay };
}

export interface Glyph { path: string; axisX: number; axisY: number; rotate?: boolean }

const DEFAULT_RANGE: [number, number, number, number] = [-Math.PI, Math.PI, -3, 3];

/** fn name → its static plot. */
export const FN_GLYPHS: Record<string, Glyph> = Object.fromEntries(FN_TILES.map(f => {
  if (f.fn === 'rotate') {
    // A turn: an arc with an arrow head.
    const c = GLYPH_SIZE / 2, r = 11;
    const a0 = -0.4 * Math.PI, a1 = 1.2 * Math.PI;
    const pt = (a: number) => `${f1(c + r * Math.cos(a))} ${f1(c - r * Math.sin(a))}`;
    const head = `M${f1(c + r * Math.cos(a1) + 5)} ${f1(c - r * Math.sin(a1) - 1)}L${pt(a1)}L${f1(c + r * Math.cos(a1) - 1)} ${f1(c - r * Math.sin(a1) - 5)}`;
    return [f.fn, { path: `M${pt(a0)}A${r} ${r} 0 1 0 ${pt(a1)}${head}`, axisX: c, axisY: c, rotate: true }];
  }
  const range = RANGE[f.fn] ?? DEFAULT_RANGE;
  const a = axes(range);
  return [f.fn, { path: curvePath(f.curve, range), axisX: a.x, axisY: a.y }];
}));

/** An If or comparison's glyph: a step at a threshold (the lit side is the one that holds). */
export type CondGlyph = 'if' | '>' | '<' | '>=' | '<=' | '==' | '!=' | '&&' | '||' | '!';
const S = GLYPH_SIZE, M = S / 2;
export const COND_GLYPHS: Record<CondGlyph, string> = {
  if: `M${PAD} ${S - PAD - 4}H${M}V${PAD + 4}H${S - PAD}`,
  '>': `M${PAD} ${S - PAD - 4}H${M}V${PAD + 4}H${S - PAD}`,
  '>=': `M${PAD} ${S - PAD - 4}H${M - 1}V${PAD + 4}H${S - PAD}`,
  '<': `M${PAD} ${PAD + 4}H${M}V${S - PAD - 4}H${S - PAD}`,
  '<=': `M${PAD} ${PAD + 4}H${M + 1}V${S - PAD - 4}H${S - PAD}`,
  '==': `M${PAD} ${S - PAD - 4}H${M - 4}V${PAD + 4}H${M + 4}V${S - PAD - 4}H${S - PAD}`,
  '!=': `M${PAD} ${PAD + 4}H${M - 4}V${S - PAD - 4}H${M + 4}V${PAD + 4}H${S - PAD}`,
  '&&': `M${PAD} ${S - PAD - 4}H${M - 6}V${PAD + 4}H${M + 6}V${S - PAD - 4}H${S - PAD}`,
  '||': `M${PAD} ${S - PAD - 4}H${M - 6}V${PAD + 4}H${S - PAD}`,
  '!': `M${PAD} ${PAD + 4}H${M}V${S - PAD - 4}H${S - PAD}`,
};
