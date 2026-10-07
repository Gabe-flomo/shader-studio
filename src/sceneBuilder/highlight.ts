/**
 * highlight.ts — the recipe language coloured, and cut into rows (docs/scene-builder.md, "Recipe").
 *
 *  - `recipeTokens`: every run of a recipe with its kind (a mode, a shape, a combine, a warp, a
 *    setting, a parameter key, a number, a vector, a name, a colour, punctuation, a comment), the
 *    colour a vector or hex or colour name stands for (for a swatch), and the parser's mistakes
 *    over the runs they cover (with the parser's own message and "did you mean").
 *  - `splitClauses`: the recipe's clauses, as the parser reads them (`·`, `;`, `|` or a new line;
 *    a new line inside brackets that is indented, or closes the bracket, goes on with the clause).
 *  - `clauseTree`: a combine clause as its head, one part per item (nested combines too) and its
 *    closing part with `k=`, for the Recipe tab's rows.
 *
 * Uses the parser's own words (recipe.ts RECIPE_WORDS), so a word the parser knows is coloured.
 * Pure.
 */
import { continuesClause, parseRecipe, RECIPE_WORDS, type RecipeError } from './recipe';
import type { Vec3 } from './spec';
import { lex as sharedLex } from '../lang/lex';

export type RecipeKind = 'mode' | 'shape' | 'op' | 'warp' | 'setting' | 'key' | 'number' | 'vector' | 'name' | 'colour' | 'punct' | 'comment' | 'plain';

export interface RecipeToken {
  from: number;
  to: number;
  kind: RecipeKind;
  /** The colour this stands for: a hex, a colour name, or a colour vector (`color=(r,g,b)`, `sky (r,g,b)`). On a vector, the whole `( … )` run. */
  swatch?: Vec3;
  /** A mistake the parser found here (its message, with "did you mean" when it has one). */
  error?: string;
}

/** Keys and settings whose `(r,g,b)` is a colour. */
const COLOUR_KEYS = new Set(['color', 'colour', 'tint', 'top', 'bottom']);
const COLOUR_SETTINGS = new Set(['sky', 'bounce', 'background', 'bg']);

type Raw = { from: number; to: number; t: 'word' | 'num' | 'hex' | 'str' | 'p' | 'sep' | 'comment'; v: string };

/** The shared lexer's tokens (lang/lex.ts, one lexer for every surface: D1) in the highlighter's terms. */
function lex(src: string): Raw[] {
  return sharedLex(src, { comments: true }).toks.filter(t => t.t !== 'eof').map((t): Raw => {
    const v = src.slice(t.at, t.end);
    const r = { from: t.at, to: t.end };
    switch (t.t) {
      case 'word': return { ...r, t: 'word', v };
      case 'num': case 'range': return { ...r, t: 'num', v };
      case 'hex': return { ...r, t: 'hex', v: v.slice(1) };
      case 'str': case 'code': return { ...r, t: 'str', v };
      case 'sep': return { ...r, t: 'sep', v };
      case 'comment': return { ...r, t: 'comment', v };
      default: return { ...r, t: 'p', v };
    }
  });
}

const hexRgb = (h: string): Vec3 => {
  const x = h.length === 3 ? h.split('').map(k => k + k).join('') : h;
  return [0, 2, 4].map(k => parseInt(x.slice(k, k + 2), 16) / 255) as Vec3;
};

/** A recipe's coloured runs, with swatches and the parser's mistakes. `errors` defaults to parsing it. */
/**
 * How another dialect names its words (lang/highlight.ts wordKindFor): a word's kind, or null to
 * fall back to the recipe's own words.
 */
export type WordKind = (word: string) => RecipeKind | null;

export function recipeTokens(src: string, errors: RecipeError[] = parseRecipe(src).errors, wordKind?: WordKind): RecipeToken[] {
  const raw = lex(src);
  const out: RecipeToken[] = [];
  const colours = RECIPE_WORDS.colours as Record<string, Vec3>;
  const prevSig = (k: number) => { for (let j = k - 1; j >= 0; j--) if (raw[j].t !== 'comment') return raw[j]; return undefined; };
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k];
    const prev = prevSig(k), next = raw[k + 1];
    let kind: RecipeKind = 'plain';
    let swatch: Vec3 | undefined;
    if (r.t === 'comment') kind = 'comment';
    else if (r.t === 'num') kind = 'number';
    else if (r.t === 'str') kind = 'name';
    else if (r.t === 'hex') { kind = 'colour'; swatch = hexRgb(r.v); }
    else if (r.t === 'sep') kind = 'punct';
    else if (r.t === 'p') {
      kind = 'punct';
      // A vector: "(" of numbers and commas, after "=" or a colour setting. Its swatch when it is a colour.
      if (r.v === '(') {
        let j = k + 1; const nums: number[] = [];
        while (j < raw.length && (raw[j].t === 'num' || (raw[j].t === 'p' && raw[j].v === ','))) { if (raw[j].t === 'num') nums.push(parseFloat(raw[j].v.replace('−', '-'))); j++; }
        if (j < raw.length && raw[j].t === 'p' && raw[j].v === ')' && nums.length >= 2 && prev && (prev.v === '=' || (prev.t === 'word' && COLOUR_SETTINGS.has(prev.v.toLowerCase())))) {
          const key = prev.v === '=' ? prevSig(k - 1) : prev;
          const isColour = nums.length === 3 && !!key && key.t === 'word' && (COLOUR_KEYS.has(key.v.toLowerCase()) || COLOUR_SETTINGS.has(key.v.toLowerCase()));
          for (let m = k; m <= j; m++) {
            const t = raw[m];
            out.push({ from: t.from, to: t.to, kind: t.t === 'num' ? 'number' : 'vector', ...(m === k && isColour ? { swatch: nums.map(n => Math.max(0, Math.min(1, n))) as Vec3 } : {}) });
          }
          k = j;
          continue;
        }
      }
    } else {
      const w = r.v.toLowerCase();
      if (next?.t === 'p' && next.v === '=') kind = 'key';
      else if (prev?.t === 'p' && prev.v === '=') { kind = colours[w] ? 'colour' : 'name'; if (colours[w]) swatch = colours[w]; }
      else if (prev?.t === 'p' && prev.v === '@') kind = 'warp';
      else if (wordKind && wordKind(w)) kind = wordKind(w)!;
      else if (wordKind && colours[w]) { kind = 'colour'; swatch = colours[w]; }
      else if (wordKind) kind = 'plain';
      else if (w in RECIPE_WORDS.modes) kind = 'mode';
      else if (w in RECIPE_WORDS.ops) kind = 'op';
      else if (w in RECIPE_WORDS.shapes) kind = 'shape';
      else if (w in RECIPE_WORDS.warps) kind = 'warp';
      else if ((RECIPE_WORDS.settings as readonly string[]).includes(w)) kind = 'setting';
      else if (colours[w]) { kind = 'colour'; swatch = colours[w]; }
    }
    out.push({ from: r.from, to: r.to, kind, ...(swatch ? { swatch } : {}) });
  }
  // The parser's mistakes, on the runs they cover (a mistake past the end, on the last run).
  for (const e of errors) {
    const hit = out.filter(t => t.from < Math.max(e.to, e.from + 1) && t.to > e.from);
    const on = hit.length ? hit : out.length ? [out[out.length - 1]] : [];
    for (const t of on) t.error = t.error ? `${t.error} ${e.message}` : e.message;
  }
  return out;
}

/** The text cut into runs (the gaps as plain runs), for drawing. */
export function recipeRuns(src: string, tokens: RecipeToken[] = recipeTokens(src)): Array<{ text: string } & Omit<RecipeToken, 'from' | 'to'>> {
  const runs: Array<{ text: string } & Omit<RecipeToken, 'from' | 'to'>> = [];
  let at = 0;
  for (const t of tokens) {
    if (t.from > at) runs.push({ text: src.slice(at, t.from), kind: 'plain' });
    const { from, to, ...rest } = t;
    runs.push({ text: src.slice(from, to), ...rest });
    at = to;
  }
  if (at < src.length) runs.push({ text: src.slice(at), kind: 'plain' });
  return runs;
}

// ── Clauses ─────────────────────────────────────────────────────────────────

export interface Clause { text: string; from: number; to: number }

/** The recipe's clauses, as the parser cuts them (empty ones left out). */
export function splitClauses(src: string): Clause[] {
  const out: Clause[] = [];
  let depth = 0, start = 0;
  const push = (end: number) => {
    const piece = src.slice(start, end);
    const lead = piece.length - piece.trimStart().length;
    const text = piece.trim();
    if (text) out.push({ text, from: start + lead, to: start + lead + text.length });
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i + 1] !== '\n') i++; continue; }
    if (c === '"' || c === '“' || c === '\'') { const close = c === '“' ? '”' : c; const j = src.indexOf(close, i + 1); if (j > 0) i = j; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === '\n' && depth > 0 && continuesClause(src, i + 1)) continue;
    else if (c === '\n' || c === '·' || c === '•' || c === '|' || c === ';') { push(i); start = i + 1; depth = 0; }
  }
  push(src.length);
  return out;
}

export interface ClauseNode {
  /** A shape or another clause on its own: its text. For a combine: `smooth-union(`. */
  head: string;
  /** A combine's items. */
  children?: ClauseNode[];
  /** A combine's closing part: `) k=0.35 name=Sculpture`. */
  tail?: string;
}

/** Where the bracket opened at `open` closes (or -1). */
function closing(s: string, open: number): number {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === '“') { const j = s.indexOf(c === '“' ? '”' : '"', i + 1); if (j > 0) { i = j; continue; } }
    if (c === '(') d++;
    else if (c === ')') { d--; if (d === 0) return i; }
  }
  return -1;
}

/** Split at commas outside brackets. */
function topCommas(s: string): string[] {
  const parts: string[] = [];
  let d = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') d++;
    else if (c === ')') d--;
    else if (c === ',' && d === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts.map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** A clause as a tree: a combine's items under it (nested combines too), its `k=` on the closing part. */
export function clauseTree(text: string): ClauseNode {
  const m = /^\s*([A-Za-z][\w-]*)\s*\(/.exec(text);
  if (m && m[1].toLowerCase() in RECIPE_WORDS.ops) {
    const open = m[0].length - 1;
    const close = closing(text, open);
    if (close > 0) {
      return {
        head: `${m[1]}(`,
        children: topCommas(text.slice(open + 1, close)).map(clauseTree),
        tail: `)${text.slice(close + 1).replace(/\s+/g, ' ').trimEnd()}`,
      };
    }
  }
  return { head: text.replace(/\s+/g, ' ').trim() };
}
