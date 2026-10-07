/**
 * parse.ts — the one parser's shared machinery (docs/playfield-language-plan.md §3, §8.3): a
 * cursor over lex.ts tokens that reads values, settings, modifiers, combine items and references
 * the same way for every dialect. Each dialect (src/lang/dialects/, sceneBuilder/recipe.ts) reads
 * its clauses with it, so `key=value`, vectors, colours, lists, ranges, units, `{code}`,
 * `random(…)` and `@modifier(…)` mean the same everywhere.
 *
 * Errors are collected, never thrown: a mistake is reported at its line and column and the rest
 * of the line still reads (the recipe's rule, kept).
 */
import { lex, lineCol, type LexError, type Tok } from './lex';
import type { Arg, AssignOp, Diagnostic, Item, Modifier, Ref, Span, Value } from './ast';

type TT = Tok['t'];

export class Cursor {
  i = 0;
  toks: Tok[];
  readonly src: string;
  diagnostics: Diagnostic[] = [];

  constructor(src: string, toks?: Tok[], lexErrors: LexError[] = []) {
    this.src = src;
    if (toks) this.toks = toks;
    else {
      const r = lex(src);
      this.toks = r.toks;
      lexErrors = r.errors;
    }
    for (const e of lexErrors) this.error(e, e.message);
  }

  peek(o = 0): Tok { return this.toks[Math.min(this.i + o, this.toks.length - 1)]; }
  next(): Tok { return this.toks[Math.min(this.i++, this.toks.length - 1)]; }
  text(s: Span): string { return this.src.slice(s.at, s.end); }

  diag(s: Span, message: string, severity: 'error' | 'hint' = 'error', fixes?: string[]): Diagnostic {
    const { line, col } = lineCol(this.src, s.at);
    const d: Diagnostic = { message, at: s.at, end: Math.max(s.end, s.at + 1), line, col, severity, ...(fixes?.length ? { fixes } : {}) };
    this.diagnostics.push(d);
    return d;
  }
  error(s: Span, message: string, fixes?: string[]) { return this.diag(s, message, 'error', fixes); }
  hint(s: Span, message: string, fixes?: string[]) { return this.diag(s, message, 'hint', fixes); }
  get errors(): Diagnostic[] { return this.diagnostics.filter(d => d.severity === 'error'); }

  /** At the end of a clause: a separator or the end. */
  atClauseEnd(): boolean { const t = this.peek().t; return t === 'sep' || t === 'eof'; }
  /** Skip to the end of this clause (after an error). */
  skipClause() { while (!this.atClauseEnd()) this.next(); }
  /** Is the next token a word (case-insensitive) in `words`? */
  isWord(...words: string[]): boolean { const t = this.peek(); return t.t === 'word' && words.includes(t.v.toLowerCase()); }
  /** Take the word if it is one of `words`. */
  takeWord(...words: string[]): Extract<Tok, { t: 'word' }> | null { return this.isWord(...words) ? this.next() as Extract<Tok, { t: 'word' }> : null; }
  atEnd(stop: readonly TT[]) { return stop.includes(this.peek().t) || this.atClauseEnd(); }

  // ── Values ──

  /** One value at the cursor, or null (nothing taken). */
  value(): Value | null {
    const t = this.peek();
    switch (t.t) {
      case 'num': this.next(); return { k: 'num', v: t.v, unit: t.unit, text: t.text };
      case 'hex': this.next(); return { k: 'colour', v: t.v, text: t.text };
      case 'str': this.next(); return { k: 'str', v: t.v };
      case 'code': this.next(); return { k: 'code', v: t.v };
      case 'range': this.next(); return { k: 'range', lo: t.lo, hi: t.hi };
      case 'word': {
        if (t.v.toLowerCase() === 'random') { this.next(); return this.randomBody(t); }
        this.next();
        return { k: 'word', v: t.v };
      }
      case '(': return this.vector();
      default: return null;
    }
  }

  /** After `random`: nothing, `(lo..hi)` or `(a, b, c)`. */
  private randomBody(at: Span): Value {
    if (this.peek().t !== '(' || this.peek().at !== at.end) return { k: 'random' };
    const open = this.next();
    const r = this.peek();
    if (r.t === 'range') {
      this.next();
      if (this.peek().t === ')') this.next(); else this.error(open, 'This ( is never closed: random(0.2..2).');
      return { k: 'random', range: [Math.min(r.lo, r.hi), Math.max(r.lo, r.hi)] };
    }
    const choices: Value[] = [];
    while (this.peek().t !== ')' && !this.atClauseEnd()) {
      if (this.peek().t === ',') { this.next(); continue; }
      const v = this.value();
      if (!v) { this.error(this.next(), 'random( ) takes a range (0.2..2) or choices (red, teal, gold).'); continue; }
      choices.push(v);
    }
    if (this.peek().t === ')') this.next(); else this.error(open, 'This ( is never closed.');
    if (!choices.length) { this.error(open, 'random( ) is empty: random(0.2..2) or random(red, teal).'); return { k: 'random' }; }
    return { k: 'random', choices };
  }

  /** `(x, y, z)`: one to four numbers (a vector; a colour in a colour slot). */
  vector(): Value | null {
    const open = this.next();
    const nums: number[] = [];
    while (this.peek().t !== ')' && !this.atClauseEnd()) {
      const n = this.next();
      if (n.t === 'num') nums.push(n.unit === 'rad' ? n.v * 180 / Math.PI : n.v);
      else if (n.t !== ',') this.error(n, 'A vector holds numbers: (x, y, z).');
    }
    if (this.peek().t === ')') this.next(); else this.error(open, 'This ( is never closed.');
    if (!nums.length) { this.error(open, 'An empty vector: write (x, y, z).'); return null; }
    if (nums.length > 4) this.error(open, 'A vector has at most four numbers.');
    return { k: 'vec', v: nums.slice(0, 4) };
  }

  /** The value after `key=`: one value, a list (`2,3,4`), or nothing (`survive=` then another key). */
  keyValue(stop: readonly TT[]): Value | null {
    const t = this.peek();
    if (this.atEnd(stop) || (t.t === 'word' && this.peek(1).t === '=')) return { k: 'list', v: [] };
    const first = this.value();
    if (!first) return null;
    if (this.peek().t !== ',' || stop.includes(',')) return first;
    const list = [first];
    while (this.peek().t === ',' && !stop.includes(',')) {
      const after = this.peek(1);
      // A list ends at what can't be a value, or at the next key=.
      if (!['num', 'word', 'str', 'hex', 'range'].includes(after.t) || (after.t === 'word' && this.peek(2).t === '=')) break;
      this.next();
      const v = this.value();
      if (v) list.push(v);
    }
    return { k: 'list', v: list };
  }

  /**
   * Settings up to the end of the clause (or a token in `stop`). `commas`: a `,` between them is
   * allowed and marked on the one before it (inside a call's brackets).
   */
  args(stop: readonly TT[] = [',', ')', '@'], commas = false): Arg[] {
    const out: Arg[] = [];
    while (!this.atEnd(stop)) {
      const t = this.peek();
      if (commas && t.t === ',') { this.next(); if (out.length) out[out.length - 1].comma = true; continue; }
      if (t.t === 'word' && (this.peek(1).t === '=' || this.peek(1).t === 'opeq')) {
        this.next();
        const eq = this.next();
        const op: AssignOp = eq.t === 'opeq' ? eq.v : '=';
        const v = this.keyValue(stop);
        if (!v) { this.error(t, `${t.v}${op} needs a value.`); continue; }
        out.push({ key: t.v, op, value: v, at: t.at, end: this.toks[this.i - 1].end });
        continue;
      }
      if (t.t === '=') { this.next(); this.error(t, 'An = with no name before it.'); continue; }
      const v = this.value();
      if (!v) { this.next(); this.error(t, `Unexpected “${this.text(t)}”.`); continue; }
      out.push({ key: null, op: '=', value: v, at: t.at, end: this.toks[this.i - 1].end });
    }
    return out;
  }

  /** `@name(args)` modifiers after an item. */
  mods(): Modifier[] {
    const out: Modifier[] = [];
    while (this.peek().t === '@') {
      const at = this.next();
      const w = this.peek();
      if (w.t !== 'word') { this.error(at, '@ is followed by a name: @twist(2).'); continue; }
      this.next();
      let args: Arg[] = [];
      if (this.peek().t === '(') {
        const open = this.next();
        args = this.args([')'], true);
        if (this.peek().t === ')') this.next(); else this.error(open, 'This ( is never closed.');
      }
      out.push({ name: w.v, args, at: at.at, end: this.toks[this.i - 1].end });
    }
    return out;
  }

  /** The raw text between ( and ), for custom(…). */
  parenText(t: Span): string | null {
    if (this.peek().t !== '(') return null;
    const open = this.next();
    let depth = 1;
    const start = open.end;
    let end = start;
    while (this.peek().t !== 'eof') {
      const x = this.next();
      if (x.t === '(') depth++;
      if (x.t === ')' && --depth === 0) { end = x.at; break; }
      end = x.end;
    }
    if (depth) this.error(t, 'This ( is never closed.');
    return this.src.slice(start, end).trim();
  }

  /**
   * An item: `isItem(word)` says whether a word can start one (a maker or a combine); a combine
   * (`isCombine`) takes `(item, item…)`. Unknown words are reported with `unknown(word)`.
   */
  item(isItem: (w: string) => boolean, isCombine: (w: string) => boolean): Item | null {
    const t = this.next();
    if (t.t !== 'word') { this.error(t, 'Expected a name.'); return null; }
    const head = t.v;
    const it: Item = { head, headSpan: { at: t.at, end: t.end }, args: [], mods: [], at: t.at, end: t.end };
    if (isCombine(head.toLowerCase())) {
      if (this.peek().t !== '(') { this.error(t, `${head} needs its items in brackets: ${head.toLowerCase()}(sphere, box).`); this.skipClause(); return null; }
      const open = this.next();
      it.items = [];
      while (this.peek().t !== ')' && !this.atClauseEnd()) {
        if (this.peek().t === ',') { this.next(); continue; }
        const c = this.peek();
        if (c.t === 'word' && (isItem(c.v.toLowerCase()) || isCombine(c.v.toLowerCase()))) {
          const child = this.item(isItem, isCombine);
          if (child) it.items.push(child);
        } else {
          this.error(c, `Inside ${head.toLowerCase()}( ) go its items.`);
          while (![',', ')', 'sep', 'eof'].includes(this.peek().t)) this.next();
        }
      }
      if (this.peek().t === ')') this.next(); else this.error(open, 'This ( is never closed.');
    }
    it.args = this.args([',', ')', '@']);
    it.mods = this.mods();
    it.end = this.toks[this.i - 1].end;
    return it;
  }

  // ── References ──

  /**
   * A reference (§3.8): `it`, `this`, `these`, `picture`, `"Label"`, `[the] circle[#2][.socket]`,
   * `before X`, `after X`, `all circles`, `X and Y`. Null when the token can't start one.
   */
  ref(opts: { and?: boolean } = {}): Ref | null {
    const one = this.refOne();
    if (!one || !opts.and) return one;
    const refs = [one];
    while (this.isWord('and') && this.peek(1).t !== 'eof') {
      const save = this.i;
      this.next();
      const r = this.refOne();
      if (!r) { this.i = save; break; }
      refs.push(r);
    }
    return refs.length === 1 ? one : { r: 'and', refs };
  }

  private refOne(): Ref | null {
    const t = this.peek();
    if (t.t === 'str') { this.next(); return { r: 'label', label: t.v }; }
    if (t.t !== 'word') return null;
    const w = t.v.toLowerCase();
    if (['it', 'this', 'these', 'picture', 'scene'].includes(w) && this.peek(1).t !== '(') { this.next(); return { r: w as 'it' }; }
    if (w === 'before' || w === 'after') {
      this.next();
      const of = this.refOne();
      if (!of) { this.error(t, `${w} needs what it is ${w}: ${w} output.`); return null; }
      return { r: w, of };
    }
    if (w === 'all' || w === 'every') {
      this.next();
      const x = this.peek();
      if (x.t !== 'word') { this.error(t, 'all needs a type: all circles.'); return null; }
      this.next();
      return { r: 'all', word: x.v.toLowerCase() };
    }
    let the = false;
    if (w === 'the') {
      const x = this.peek(1);
      if (x.t === 'str') { this.next(); this.next(); return { r: 'label', label: x.v }; }
      if (x.t !== 'word') return null;
      if (x.v.toLowerCase() === 'picture' || x.v.toLowerCase() === 'scene') { this.next(); this.next(); return { r: x.v.toLowerCase() as 'picture' }; }
      this.next();
      the = true;
    }
    const nm = this.next() as Extract<Tok, { t: 'word' }>;
    const ref: Extract<Ref, { r: 'type' }> = { r: 'type', word: nm.v.toLowerCase(), ...(the ? { the } : {}) };
    if (this.peek().t === 'ord') ref.ord = (this.next() as Extract<Tok, { t: 'ord' }>).v;
    if (this.peek().t === '.' && this.peek(1).t === 'word' && this.peek(1).at === this.peek().end) { this.next(); ref.socket = (this.next() as Extract<Tok, { t: 'word' }>).v; }
    return ref;
  }
}
