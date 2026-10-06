/**
 * Structured explanation text: plain words with the code's names, numbers and snippets kept as
 * tokens, so the UI can show them as chips (ExplainText) and plain-text places can still read
 * unambiguously ("silent is where `a` is below 0.02", not "… where a is below …").
 *
 * The templates in explain.ts / idioms.ts build ordinary strings; a token inside one is marked
 * with private-use characters (`mark.v('uv', 'uv', 'vec2')`). `parseSegs` turns a marked string
 * into segments; `toPlainText` turns segments (or a marked string) back into prose.
 */
import type { GlslType } from './ast';

export type Seg =
  | { kind: 'text'; text: string }
  /** A name from the code. `name` is the variable it reads (`p` for `p.x`); `type` when known. */
  | { kind: 'var'; text: string; name: string; type?: GlslType }
  | { kind: 'num'; text: string }
  /** A snippet of code (`vec3(1.0)`, a step's `1.0 - step(0.02, a)`). */
  | { kind: 'code'; text: string }
  /** A function's name (`foo` in "calls foo(…)"). */
  | { kind: 'fn'; text: string };

export type SegKind = Seg['kind'];

const OPEN = '', SEP = '', CLOSE = '';
const KIND_CH: Record<Exclude<SegKind, 'text'>, string> = { var: 'v', num: 'n', code: 'c', fn: 'f' };
const CH_KIND: Record<string, Exclude<SegKind, 'text'>> = { v: 'var', n: 'num', c: 'code', f: 'fn' };
const clean = (s: string) => s.replace(/[-]/g, '');

/** Mark a token inside template text. */
export const mark = {
  v: (text: string, name = text, type?: GlslType) => `${OPEN}v${SEP}${clean(text)}${SEP}${clean(name)}${SEP}${type && type !== 'unknown' ? type : ''}${CLOSE}`,
  n: (text: string) => `${OPEN}n${SEP}${clean(text)}${CLOSE}`,
  c: (text: string) => `${OPEN}c${SEP}${clean(text)}${CLOSE}`,
  f: (text: string) => `${OPEN}f${SEP}${clean(text)}${CLOSE}`,
};

/** Does this string carry any tokens? */
export const hasMarks = (s: string) => s.includes(OPEN);

/** A marked string as segments; neighbouring text is merged. */
export function parseSegs(s: string): Seg[] {
  const out: Seg[] = [];
  const text = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += t; else out.push({ kind: 'text', text: t });
  };
  let i = 0;
  while (i < s.length) {
    const o = s.indexOf(OPEN, i);
    if (o < 0) { text(s.slice(i)); break; }
    text(s.slice(i, o));
    const c = s.indexOf(CLOSE, o);
    if (c < 0) { text(clean(s.slice(o))); break; }
    const [k, t = '', name, type] = s.slice(o + 1, c).split(SEP);
    const kind = CH_KIND[k];
    if (!kind) text(t);
    else if (kind === 'var') out.push(type ? { kind, text: t, name: name || t, type: type as GlslType } : { kind, text: t, name: name || t });
    else out.push({ kind, text: t });
    i = c + 1;
  }
  return out;
}

/** Segments back to a marked string (to compose them into a bigger sentence). */
export function segsToMarked(segs: Seg[]): string {
  return segs.map(s => (s.kind === 'text' ? s.text : s.kind === 'var' ? mark.v(s.text, s.name, s.type) : mark[KIND_CH[s.kind] as 'n' | 'c' | 'f'](s.text))).join('');
}

/**
 * Prose for places that need a plain string (tooltips, saved notes, search, tests). Names and
 * code are wrapped in backticks so they never read as words; numbers stay as they are.
 */
export function toPlainText(x: Seg[] | string): string {
  const segs = typeof x === 'string' ? parseSegs(x) : x;
  return segs.map(s => (s.kind === 'var' || s.kind === 'code' ? `\`${s.text}\`` : s.text)).join('');
}

/** The words alone, tokens unwrapped (for names made from a phrase, lengths). */
export function stripMarks(s: string): string {
  return parseSegs(s).map(x => x.text).join('');
}

/** How long a marked string reads. */
export const plainLength = (s: string) => stripMarks(s).length;

/** Every variable a set of segments mentions. */
export function varsIn(segs: Seg[]): string[] {
  return [...new Set(segs.flatMap(s => (s.kind === 'var' ? [s.name] : [])))];
}

/** What a screen reader says for a token: "variable a", "number 0.02", "code 1.0 - step(…)". */
export function spokenToken(s: Seg): string {
  switch (s.kind) {
    case 'var': return `variable ${s.text}`;
    case 'num': return s.text;
    case 'code': return `code ${s.text}`;
    case 'fn': return `function ${s.text}`;
    default: return s.text;
  }
}
