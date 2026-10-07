/**
 * ast.ts — the shapes the one parser makes (docs/playfield-language-plan.md §8.3). Every node
 * keeps its span (`at`, `end`: offsets into the text), so errors, hints and highlighting point at
 * the right place.
 */
import type { Unit } from './lex';

export interface Span { at: number; end: number }

export type Value =
  | { k: 'num'; v: number; unit: Unit | null; text?: string }
  | { k: 'vec'; v: number[] }
  | { k: 'colour'; v: [number, number, number]; text: string }
  | { k: 'word'; v: string }
  | { k: 'str'; v: string }
  | { k: 'list'; v: Value[] }
  | { k: 'range'; lo: number; hi: number }
  | { k: 'code'; v: string }
  /** `random`, `random(0.2..2)`, `random(red, teal, gold)`: resolved by random.ts. */
  | { k: 'random'; range?: [number, number]; choices?: Value[] }
  | { k: 'ref'; ref: Ref };

export type AssignOp = '=' | '*=' | '/=' | '+=' | '-=';

/** A setting: `key=value`, `key*=1.25`, a bare value (positional) or a flag word. */
export interface Arg extends Span {
  key: string | null;
  op: AssignOp;
  value: Value;
  /** A `,` followed it inside a call's brackets (`@move(1, 2, 3)` is one vector). */
  comma?: boolean;
}

export interface Modifier extends Span { name: string; args: Arg[] }

/** A reference to something that is already there (§3.8). */
export type Ref =
  | { r: 'it' | 'this' | 'these' | 'picture' | 'scene' }
  | { r: 'label'; label: string }
  | { r: 'type'; word: string; ord?: number; socket?: string; the?: boolean }
  | { r: 'before' | 'after'; of: Ref }
  | { r: 'all'; word: string }
  | { r: 'and'; refs: Ref[] };

export interface Item extends Span {
  /** A maker (`sphere r=1`), a combine (`union(…)`) or a reference. */
  head: string;
  headSpan: Span;
  items?: Item[];
  args: Arg[];
  mods: Modifier[];
  ref?: Ref;
}

export type Clause =
  /** A head word with settings and modifiers: a maker, a step, a setting, a header. */
  | (Span & { t: 'head'; head: string; headSpan: Span; args: Arg[]; mods: Modifier[] })
  /** `op(item, item…) args @mods`. */
  | (Span & { t: 'combine'; op: string; headSpan: Span; items: Item[]; args: Arg[]; mods: Modifier[] })
  /** Values joined by + - * / (§3.6). */
  | (Span & { t: 'expr'; left: Ref; ops: Array<{ op: '+' | '-' | '*' | '/'; right: Ref | number }> })
  /** Just a reference: it becomes the subject. */
  | (Span & { t: 'ref'; ref: Ref })
  /** An edit verb with its slots (§3.9). */
  | (Span & { t: 'edit'; verb: string; headSpan: Span; slots: Record<string, Ref | string | Value | Item | undefined>; args: Arg[] });

export interface Diagnostic extends Span {
  message: string;
  line: number;
  col: number;
  /** Replacements that fix it ("did you mean"). */
  fixes?: string[];
  severity: 'error' | 'hint';
}
