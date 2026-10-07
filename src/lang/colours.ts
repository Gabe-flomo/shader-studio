/**
 * colours.ts — the one colour table (docs/playfield-language-plan.md, D3 and §13 decision 3).
 *
 * The Do… bar and the Scene Builder recipe each had a table, with different values for the same
 * name (the bar's red was (1, 0.15, 0.12), the recipe's (0.9, 0.15, 0.12)). This is the union,
 * with the recipe's values where both had a name, because recipe text is what people copy and
 * keep. Every surface reads it: the bar, every recipe, Grid Rules and Agent Rules text, the
 * type-ahead's swatches. The small shift for new bar graphs is accepted (decision 3).
 */
export type RGB = [number, number, number];

export const COLOUR_TABLE: Readonly<Record<string, RGB>> = {
  white: [1, 1, 1], black: [0, 0, 0], grey: [0.5, 0.5, 0.5], gray: [0.5, 0.5, 0.5], silver: [0.75, 0.75, 0.78],
  red: [0.9, 0.15, 0.12], orange: [1, 0.55, 0.15], yellow: [1, 0.85, 0.2], gold: [1, 0.75, 0.3], green: [0.25, 0.75, 0.35],
  lime: [0.6, 1, 0.2], teal: [0.15, 0.65, 0.6], cyan: [0.2, 0.8, 0.95], blue: [0.2, 0.4, 0.95], navy: [0.05, 0.08, 0.25],
  purple: [0.55, 0.3, 0.85], violet: [0.6, 0.4, 1], pink: [1, 0.5, 0.7], magenta: [0.9, 0.2, 0.75], brown: [0.45, 0.28, 0.15],
  cream: [0.95, 0.9, 0.8], sky: [0.45, 0.65, 0.9], night: [0.03, 0.035, 0.07],
  warm: [1, 0.6, 0.3], cool: [0.35, 0.6, 1], neon: [1, 0.3, 0.9], fire: [1, 0.45, 0.1], ice: [0.6, 0.85, 1],
};

/** The colour names, in table order. */
export const COLOUR_NAMES: readonly string[] = Object.keys(COLOUR_TABLE);

/** A colour word, or #rgb / #rrggbb, as 0–1 numbers (3 decimals); else null. */
export function colourOf(token: string): RGB | null {
  const t = token.toLowerCase();
  if (COLOUR_TABLE[t]) return [...COLOUR_TABLE[t]] as RGB;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return [0, 2, 4].map(k => Math.round(parseInt(h.slice(k, k + 2), 16) / 255 * 10000) / 10000) as RGB;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => round4(x) === round4(b[i]));

/** A colour as text: its name when one matches exactly, else #rrggbb when that round-trips, else (r,g,b). */
export function colourText(v: readonly number[]): string {
  const name = Object.entries(COLOUR_TABLE).find(([, c]) => same(c, v))?.[0];
  if (name) return name;
  const hex = v.map(x => Math.round(x * 255));
  if (v.every((x, i) => round4(hex[i] / 255) === round4(x) && hex[i] >= 0 && hex[i] <= 255)) return `#${hex.map(h => h.toString(16).padStart(2, '0')).join('')}`;
  const f = (n: number) => { const r = round4(n); return Object.is(r, -0) ? '0' : String(r); };
  return `(${v.map(f).join(',')})`;
}
