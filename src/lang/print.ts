/**
 * print.ts — the one printer's shared rules (docs/playfield-language-plan.md §8.5): numbers,
 * vectors, colours, names, references, settings and modifiers written the same way in every
 * dialect. The dialects (sceneBuilder/recipe.ts printRecipe, lang/dialects/*) build their lines
 * from these.
 *
 * The rules: the canonical word; the primary setting bare and the rest `key=value`; defaults left
 * out (by the caller); colour words or hex when they round-trip exactly; references in edit slots
 * without "the" (§13 decision 2).
 */
import { colourText } from './colours';
import type { Arg, Clause, Item, Modifier, Ref, Value } from './ast';

export const round = (n: number) => Math.round(n * 10000) / 10000;

/** A number: at most four decimals, never -0. */
export const fmtNum = (n: number): string => {
  const r = round(n);
  return Object.is(r, -0) ? '0' : String(r);
};

/** A vector: one number when every part is the same, else (x,y,z). */
export const fmtVec = (v: readonly number[]): string => (v.every(x => round(x) === round(v[0])) ? fmtNum(v[0]) : `(${v.map(fmtNum).join(',')})`);

/** A name: bare when it is a word, else quoted. */
export const fmtName = (s: string) => (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) ? s : `"${s.replace(/"/g, '\'')}"`);

export const fmtColour = (v: readonly number[]) => colourText(v);

export function printValue(v: Value): string {
  switch (v.k) {
    case 'num': return v.text ?? `${fmtNum(v.v)}${v.unit ?? ''}`;
    case 'vec': return `(${v.v.map(fmtNum).join(',')})`;
    case 'colour': return v.text.startsWith('#') ? v.text.toLowerCase() : fmtColour(v.v);
    case 'word': return v.v;
    case 'str': return `"${v.v}"`;
    case 'list': return v.v.map(printValue).join(',');
    case 'range': return `${fmtNum(v.lo)}..${fmtNum(v.hi)}`;
    case 'code': return `{${v.v}}`;
    case 'random': return v.range ? `random(${fmtNum(v.range[0])}..${fmtNum(v.range[1])})` : v.choices ? `random(${v.choices.map(printValue).join(', ')})` : 'random';
    case 'ref': return printRef(v.ref);
  }
}

/** A reference. `the`: write "the" before a type word (reference clauses); edit slots leave it out. */
export function printRef(r: Ref, opts: { the?: boolean } = {}): string {
  switch (r.r) {
    case 'it': case 'this': case 'these': return r.r;
    case 'picture': case 'scene': return opts.the ? `the ${r.r}` : r.r;
    case 'label': return `"${r.label}"`;
    case 'type': return `${opts.the ? 'the ' : ''}${r.word}${r.ord !== undefined ? `#${r.ord < 0 ? 'last' : r.ord}` : ''}${r.socket ? `.${r.socket}` : ''}`;
    case 'before': case 'after': return `${r.r} ${printRef(r.of)}`;
    case 'all': return `all ${r.word}`;
    case 'and': return r.refs.map(x => printRef(x, opts)).join(' and ');
  }
}

export function printArg(a: Arg): string {
  return a.key === null ? printValue(a.value) : `${a.key}${a.op}${printValue(a.value)}`;
}

export function printMods(mods: readonly Modifier[]): string[] {
  return mods.map(m => `@${m.name}${m.args.length ? `(${m.args.map(printArg).join(' ')})` : ''}`);
}

export function printItem(it: Item): string {
  if (it.ref) return printRef(it.ref, { the: true });
  const head = it.items ? `${it.head}(${it.items.map(printItem).join(', ')})` : it.head;
  return [head, ...it.args.map(printArg), ...printMods(it.mods)].join(' ');
}

/** A clause in its parsed form (the dialects normalise words and settings before this). */
export function printClause(c: Clause): string {
  switch (c.t) {
    case 'head': return [c.head, ...c.args.map(printArg), ...printMods(c.mods)].join(' ');
    case 'combine': return [`${c.op}(${c.items.map(printItem).join(', ')})`, ...c.args.map(printArg), ...printMods(c.mods)].join(' ');
    case 'expr': return [printRef(c.left), ...c.ops.flatMap(o => [o.op, typeof o.right === 'number' ? fmtNum(o.right) : printRef(o.right)])].join(' ');
    case 'ref': return printRef(c.ref, { the: true });
    case 'edit': return [c.verb, ...Object.values(c.slots).filter((x): x is string => typeof x === 'string'), ...c.args.map(printArg)].join(' ');
  }
}
