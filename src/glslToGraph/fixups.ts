/**
 * Fix-ups: rewrites of the pasted source for shapes the converter refuses but
 * a person would happily write another way. The Convert page offers each one
 * with an "Apply fix" button; applying it replaces the editor's text, and the
 * check then compares the graph with the shader as it was *before* the fix,
 * so a rewrite that changed the picture shows up as Differs.
 *
 * Each fix-up is offered only when it applies cleanly and takes away the
 * refusal it is for (the rewritten source is converted again to see). They are
 * text in, text out; none of them guesses: a shape they don't fully recognise
 * is left alone.
 *
 *   hoist writes    `O = ++h`, `mod(U += T, T)`, `(O.xy = R)`: each write gets
 *                   a statement of its own, before the one it was in, with
 *                   whatever it would have changed under the old value kept
 *                   in a temporary. The shader is rewritten in Playfield GLSL
 *                   (the dialect translated, #defines expanded) since the
 *                   writes often come from a macro.
 *   array → function  a global array a helper reads, filled in main() from
 *                   numbers only (`palette[3] = vec3(…)`), becomes a function
 *                   of the index (`palette(3)`).
 *   uniforms        a uniform with no source node becomes a const holding 0,
 *                   the value WebGL gives an unset uniform (so the picture is
 *                   the same); a sampler reads as black.
 *   uint hash       a float function whose body uses uint / bit operations
 *                   becomes a float hash. This one changes the pattern (a
 *                   different random), and says so.
 */
import { parser, generate } from '@shaderfrog/glsl-parser';
import { normaliseHostShader, glslToGraph, type ConversionReport } from '.';
import { reindent } from '../glsl/format';
import { blackTextures, ES3_INTEGER } from '../glsl/dialects';
import { blankComments } from './threadGlobals';

type Ast = Record<string, unknown> & { type: string };

export interface Fixup {
  id: 'hoist-writes' | 'array-function' | 'uniform-consts' | 'float-hash';
  title: string;
  /** What it does and why, in a sentence or two. */
  why: string;
  /** The rewritten shader. */
  code: string;
  /** False when the fix changes the picture on purpose (the check will say Differs). */
  samePicture: boolean;
}

/** The fix-ups that apply to this source and each take away a refusal the converter gives it. */
export function suggestFixups(source: string, report?: ConversionReport): Fixup[] {
  const r = report ?? glslToGraph(source).report;
  if (!r.unsupported.length) return [];
  const out: Fixup[] = [];
  const refusedFor = (re: RegExp) => r.unsupported.some(u => re.test(u));
  const clears = (code: string, re: RegExp) => !glslToGraph(code).report.unsupported.some(u => re.test(u));
  const tryFix = (re: RegExp, make: () => Omit<Fixup, 'code'> & { code: string | null }) => {
    if (!refusedFor(re)) return;
    let f: (Omit<Fixup, 'code'> & { code: string | null }) | null = null;
    try { f = make(); } catch { f = null; }
    if (f?.code && f.code !== source && clears(f.code, re)) out.push(f as Fixup);
  };
  tryFix(/changes inside an expression/, () => ({ id: 'hoist-writes', title: 'Give each write a line of its own', why: 'A variable changes in the middle of an expression (golf style) and a later line reads it. Moving each write to its own statement, in the order the shader runs them, keeps the meaning. The shader is rewritten in Playfield GLSL, its #defines expanded (comments don’t come along).', samePicture: true, code: hoistWrites(source) }));
  tryFix(/a global array \(or struct\) that a function reads/, () => { const a = arrayToFunction(source); return { id: 'array-function', title: a ? `Make ${a.names.join(', ')} a function` : 'Make the array a function', why: 'A global array that helpers read and main() fills with fixed values. A function of the index returns the same values and needs nothing passed along.', samePicture: true, code: a?.code ?? null }; });
  tryFix(/has no source node|can’t reach a Play control|Texture \w+: textures can't be imported/, () => { const u = uniformsToConsts(source); return { id: 'uniform-consts', title: u ? `Make ${u.names.join(', ')} ${u.names.length === 1 ? 'a constant' : 'constants'}` : 'Make the uniforms constants', why: 'A uniform the graph has no node for. As a const holding 0 (what WebGL gives a uniform nobody sets, so the picture stays the same) it lands on the Constants card, where you can give it the value you meant; a texture reads as black.', samePicture: true, code: u?.code ?? null }; });
  tryFix(/uint \/ bit operations/, () => { const h = floatHash(source); return { id: 'float-hash', title: h ? `Use a float hash in ${h.names.join(', ')}` : 'Use a float hash', why: 'uint and bit operations are GLSL ES 3.00 only; Play runs ES 1.00. A float hash (Dave Hoskins’ hash without sine) takes their place. The noise is a different random pattern, so the check will say Differs; the look is the same kind.', samePicture: false, code: h?.code ?? null }; });
  return out;
}

// ── Hoisting writes out of expressions ───────────────────────────────────────

const VEC_N: Record<string, number> = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4, ivec2: 2, ivec3: 3, ivec4: 4, bvec2: 2, bvec3: 3, bvec4: 4 };
const FLOAT_OF = new Set(['length', 'distance', 'dot', 'determinant']);
const SAME_OF = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'exp2', 'log', 'log2', 'sqrt', 'inversesqrt', 'abs', 'sign', 'floor', 'ceil', 'fract', 'round', 'trunc', 'mod', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'pow', 'normalize', 'reflect', 'refract', 'faceforward', 'dFdx', 'dFdy', 'fwidth', 'radians', 'degrees']);

function tokenOf(spec: Ast | undefined): string {
  if (!spec) return '';
  if (typeof spec.token === 'string') return spec.token;
  if (spec.specifier) return tokenOf(spec.specifier as Ast);
  if (spec.identifier && typeof (spec.identifier as Ast).identifier === 'string') return (spec.identifier as Ast).identifier as string;
  if (typeof spec.identifier === 'string') return spec.identifier;
  return '';
}
const walk = (a: unknown, f: (n: Ast) => void): void => {
  if (Array.isArray(a)) { for (const x of a) walk(x, f); return; }
  if (!a || typeof a !== 'object') return;
  f(a as Ast);
  for (const [k, v] of Object.entries(a as Ast)) if (k !== 'type') walk(v, f);
};
const mentions = (a: unknown, name: string): boolean => { let hit = false; walk(a, n => { if (n.type === 'identifier' && n.identifier === name) hit = true; }); return hit; };
const incOf = (n: Ast): string => {
  if (n.type === 'unary') { const l = (n.operator as Ast)?.literal as string; return l === '++' || l === '--' ? l : ''; }
  if (n.type === 'postfix') { const pf = n.postfix as Ast; const l = ((pf?.operator as Ast | undefined)?.literal as string | undefined) ?? (pf?.literal as string | undefined); return l === '++' || l === '--' ? l : ''; }
  return '';
};
const isWrite = (n: Ast) => n.type === 'assignment' || !!incOf(n);
const hasWrite = (a: unknown) => { let hit = false; walk(a, n => { if (isWrite(n)) hit = true; }); return hit; };
const baseName = (t: Ast): string | null => (t.type === 'identifier' ? t.identifier as string : t.type === 'postfix' || t.type === 'group' ? baseName(t.expression as Ast) : null);
const ident = (name: string): Ast => ({ type: 'identifier', identifier: name, whitespace: '' });

class NoFix extends Error {}

/** Types of the names a function sees (its parameters, its locals, the globals), and what user functions return. */
function typer(program: Ast[], fnNode: Ast) {
  const types = new Map<string, string>(); const returns = new Map<string, string>();
  const declare = (a: unknown) => walk(a, n => {
    if (n.type === 'declarator_list') { const t = tokenOf((n.specified_type as Ast)?.specifier as Ast); for (const d of (n.declarations as Ast[] | undefined) ?? []) { const id = (d.identifier as Ast)?.identifier as string | undefined; if (id && t) types.set(id, t); } }
    if (n.type === 'parameter_declaration') { const id = (n.identifier as Ast)?.identifier as string | undefined; const t = tokenOf((n.specifier as Ast) ?? (n.declaration as Ast)); if (id && t) types.set(id, t); }
  });
  for (const st of program) {
    if (st.type === 'function') returns.set(((st.prototype as Ast).header as Ast).name ? (((st.prototype as Ast).header as Ast).name as Ast).identifier as string : '', tokenOf(((st.prototype as Ast).header as Ast).returnType as Ast));
    else declare(st);
  }
  declare(fnNode);
  const typeOf = (a: Ast): string => {
    switch (a.type) {
      case 'float_constant': return 'float';
      case 'int_constant': return 'int';
      case 'bool_constant': return 'bool';
      case 'identifier': { const t = types.get(a.identifier as string); if (!t) throw new NoFix(); return t; }
      case 'group': case 'unary': return typeOf(a.expression as Ast);
      case 'assignment': return typeOf(a.left as Ast);
      case 'ternary': return typeOf(a.right as Ast);
      case 'binary': {
        const op = (a.operator as Ast).literal as string;
        if (['<', '>', '<=', '>=', '==', '!=', '&&', '||', '^^'].includes(op)) return 'bool';
        if (op === ',') return typeOf(a.right as Ast);
        const l = typeOf(a.left as Ast), r = typeOf(a.right as Ast);
        if (l.startsWith('mat') && r.startsWith('mat')) return l;
        if (l.startsWith('mat')) return r === 'float' ? l : r;
        if (r.startsWith('mat')) return l === 'float' ? r : l;
        return (VEC_N[l] ?? 0) >= (VEC_N[r] ?? 0) ? l : r;
      }
      case 'postfix': {
        const pf = a.postfix as Ast;
        if (pf.type === 'field_selection') { const n = ((pf.selection as Ast).identifier as string).length; return n === 1 ? 'float' : `vec${n}`; }
        if (pf.type === 'quantifier') { const t = typeOf(a.expression as Ast); return t.startsWith('vec') ? 'float' : t.startsWith('mat') ? `vec${t[3]}` : t; }
        return typeOf(a.expression as Ast);
      }
      case 'function_call': {
        const idn = a.identifier as Ast;
        const name = idn.type === 'identifier' ? idn.identifier as string : tokenOf(idn);
        if (returns.has(name)) return returns.get(name)!;
        if (idn.type !== 'identifier' && (VEC_N[name] || name.startsWith('mat'))) return name;
        const args = ((a.args as Ast[] | undefined) ?? []).filter(x => x.type !== 'literal');
        if (FLOAT_OF.has(name)) return 'float';
        if (name === 'texture' || name === 'texture2D') return 'vec4';
        if (name === 'cross') return 'vec3';
        if (SAME_OF.has(name)) return args.map(typeOf).reduce((m, t) => ((VEC_N[t] ?? 0) > (VEC_N[m] ?? 0) ? t : m), 'float');
        throw new NoFix();
      }
      default: throw new NoFix();
    }
  };
  return typeOf;
}

/**
 * One statement's expression with its writes lifted out, in evaluation order:
 * the statements to run first, and the expression that is left. A value that
 * was already worked out and reads a variable about to change is kept in a
 * temporary first (`min(D(U += t), D(U += t))` needs the first D before the
 * second write).
 */
function liftWrites(e: Ast, typeOf: (a: Ast) => string, fresh: () => string): { before: string[]; rest: Ast } {
  const before: string[] = [];
  const done: { get: () => Ast; set: (a: Ast) => void }[] = [];
  const capture = (x: string) => {
    for (const d of done) {
      const v = d.get();
      if (v.type === 'identifier' && (v.identifier as string).startsWith('_w')) continue;
      if (!mentions(v, x)) continue;
      const t = typeOf(v), name = fresh();
      before.push(`${t} ${name} = ${generate(v as never).trim()};`);
      d.set(ident(name));
    }
  };
  const lift = (n: Ast): Ast => {
    if (!n || typeof n !== 'object' || !hasWrite(n)) return n;
    const child = (obj: Ast, key: string) => {
      const mark = done.length;
      const v = lift(obj[key] as Ast);
      obj[key] = v;
      done.length = mark;
      done.push({ get: () => obj[key] as Ast, set: a => { obj[key] = a; } });
    };
    const c: Ast = { ...n };
    switch (n.type) {
      case 'assignment': {
        const x = baseName(n.left as Ast); if (!x || hasWrite(n.left)) throw new NoFix();
        const mark = done.length;
        c.right = lift(n.right as Ast);
        done.length = mark;
        capture(x);
        before.push(`${generate(n.left as never).trim()} ${(n.operator as Ast).literal as string} ${generate(c.right as never).trim()};`);
        return { ...(n.left as Ast) };
      }
      case 'unary': case 'postfix': {
        const op = incOf(n);
        if (!op) { child(c, 'expression'); return c; }
        const target = n.expression as Ast; const x = baseName(target); if (!x || hasWrite(target)) throw new NoFix();
        capture(x);
        if (n.type === 'unary') { before.push(`${op}${generate(target as never).trim()};`); return { ...target }; }
        const t = typeOf(target), name = fresh();
        before.push(`${t} ${name} = ${generate(target as never).trim()};`, `${generate(target as never).trim()}${op};`);
        return ident(name);
      }
      case 'binary': {
        const op = (n.operator as Ast).literal as string;
        if ((op === '&&' || op === '||') && hasWrite(n.right)) throw new NoFix(); // only runs sometimes
        child(c, 'left'); child(c, 'right'); return c;
      }
      case 'ternary': if (hasWrite(n.left) || hasWrite(n.right)) throw new NoFix(); child(c, 'expression'); return c; // only the condition always runs
      case 'group': child(c, 'expression'); return c;
      case 'function_call': { const args = [...((n.args as Ast[] | undefined) ?? [])]; c.args = args; for (let i = 0; i < args.length; i++) if (args[i].type !== 'literal') child(args as unknown as Ast, String(i)); return c; }
      default: throw new NoFix();
    }
  };
  const rest = lift(e);
  if (hasWrite(rest)) throw new NoFix(); // a shape the walk doesn't know: leave the shader alone
  return { before, rest };
}

/** Rewrites main() so no write sits inside an expression. Returns null when there is nothing to do or a write can't be moved safely. */
export function hoistWrites(source: string): string | null {
  const code = normaliseHostShader(source).code;
  let ast: { program: Ast[] };
  try { ast = parser.parse(code, { quiet: true }) as unknown as { program: Ast[] }; } catch { return null; }
  const main = ast.program.find(st => st.type === 'function' && (((st.prototype as Ast).header as Ast).name as Ast)?.identifier === 'main');
  if (!main) return null;
  let k = 0;
  const taken = new Set<string>(); walk(ast.program, n => { if (n.type === 'identifier') taken.add(n.identifier as string); });
  const fresh = () => { let s: string; do s = `_w${++k}`; while (taken.has(s)); return s; };
  let typeOf: (a: Ast) => string;
  try { typeOf = typer(ast.program, main); } catch { return null; }

  /** A statement as text, its writes lifted; null when it had none. */
  const rewrite = (st: Ast): string | null => {
    if (st.type === 'expression_statement' && st.expression) {
      const e = st.expression as Ast;
      // A write that is the statement itself stays; its right side may hold more.
      if (e.type === 'assignment') {
        if (!hasWrite(e.right)) return null;
        const { before, rest } = liftWrites(e.right as Ast, typeOf, fresh);
        return [...before, `${generate(e.left as never).trim()} ${(e.operator as Ast).literal as string} ${generate(rest as never).trim()};`].join('\n');
      }
      if (incOf(e) || !hasWrite(e)) return null;
      if (e.type === 'binary' && (e.operator as Ast).literal === ',') {
        const parts: Ast[] = []; const flat = (x: Ast) => { if (x.type === 'binary' && (x.operator as Ast).literal === ',') { flat(x.left as Ast); flat(x.right as Ast); } else parts.push(x); };
        flat(e);
        return parts.map(p => rewrite({ type: 'expression_statement', expression: p } as Ast) ?? `${generate(p as never).trim()};`).join('\n');
      }
      const { before, rest } = liftWrites(e, typeOf, fresh);
      return [...before, `${generate(rest as never).trim()};`].join('\n');
    }
    if (st.type === 'declaration_statement') {
      const decl = st.declaration as Ast;
      const ds = (decl.declarations as Ast[] | undefined) ?? [];
      if (!ds.some(d => hasWrite(d.initializer))) return null;
      const ty = generate((decl.specified_type as Ast) as never).trim();
      return ds.map(d => {
        const name = generate(d.identifier as never).trim() + (d.quantifier ? generate(d.quantifier as never).trim() : '');
        if (!d.initializer) return `${ty} ${name};`;
        const { before, rest } = liftWrites(d.initializer as Ast, typeOf, fresh);
        return [...before, `${ty} ${name} = ${generate(rest as never).trim()};`].join('\n');
      }).join('\n');
    }
    return null;
  };
  /** A block's statements, rewritten where they need it (bodies of if / for / while too). */
  const visitList = (list: Ast[]): string[] | null => {
    let any = false;
    const out = list.map(st => { const t = visit(st); if (t !== null) any = true; return (t ?? generate(st as never)).trim(); }).filter(Boolean);
    return any ? out : null;
  };
  const visit = (st: Ast): string | null => {
    if (st.type === 'compound_statement') { const inner = visitList(st.statements as Ast[]); return inner ? `{\n${inner.join('\n')}\n}` : null; }
    const body = (key: string): boolean => {
      const b = st[key] as Ast | undefined; if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
      const t = visit(b); if (t === null) return false;
      const parsed = parseStatement(b.type === 'compound_statement' ? t : `{\n${t}\n}`); if (!parsed) throw new NoFix();
      st[key] = parsed; return true;
    };
    if (st.type === 'if_statement' || st.type === 'for_statement' || st.type === 'while_statement') {
      // Headers stay as written: a loop kept as code carries its own writes.
      const a = body('body');
      let b = false;
      const els = st.else as Ast | Ast[] | undefined;
      if (Array.isArray(els)) { for (let i = 0; i < els.length; i++) if (els[i] && els[i].type !== 'keyword' && els[i].type !== 'literal') { const t = visit(els[i]); if (t !== null) { const p = parseStatement(els[i].type === 'compound_statement' ? t : `{\n${t}\n}`); if (!p) throw new NoFix(); els[i] = p; b = true; } } }
      else if (els && typeof els === 'object' && els.type !== 'keyword' && els.type !== 'literal') b = body('else');
      return a || b ? generate(st as never) : null;
    }
    return rewrite(st);
  };
  let bodyText: string[] | null;
  try { bodyText = visitList(((main.body as Ast).statements as Ast[])); } catch (e) { if (e instanceof NoFix) return null; throw e; }
  if (!bodyText) return null;
  const mainText = `${generate((main.prototype as Ast) as never).trim()} {\n${bodyText.join('\n')}\n}`;
  const parts = ast.program.map(st => (st === main ? mainText : generate(st as never).trim())).filter(Boolean);
  return `${reindent(parts.join('\n\n').replace(/\n[ \t]*(\n[ \t]*)+\n/g, '\n\n'))}\n`;
}

function parseStatement(text: string): Ast | null {
  try {
    const p = parser.parse(`void f_() ${text.startsWith('{') ? text : `{\n${text}\n}`}`, { quiet: true }) as unknown as { program: Ast[] };
    return p.program[0]?.body as Ast ?? null;
  } catch { return null; }
}

// ── A global array filled with numbers → a function ─────────────────────────

/**
 * `vec3 palette[7];` read by helpers and filled in main() with fixed values
 * (`palette[6] = vec3(255, 0, 0) / 255.;`): the array becomes
 * `vec3 palette(int i) { if (i == 0) return …; … }`, every `palette[x]` a call,
 * and the filling lines go. Only when every write is main()'s, at a literal
 * index, with a right side of numbers alone.
 */
export function arrayToFunction(source: string): { code: string; names: string[] } | null {
  const plain = blankComments(source);
  const names: string[] = [];
  let code = source;
  const declRe = /(^|[;}\n])([ \t]*)(float|vec[234]|int)[ \t]+([A-Za-z_]\w*)[ \t]*\[[ \t]*(\d+)[ \t]*\][ \t]*;/g;
  const edits: { at: number; del: number; text: string }[] = [];
  // main()'s body (or mainImage's): where the filling has to be.
  const mm = /\bvoid\s+(?:main|mainImage)\s*\([^)]*\)\s*\{/.exec(plain);
  if (!mm) return null;
  const mainOpen = mm.index + mm[0].length - 1;
  let mainClose = mainOpen; for (let d = 0; mainClose < plain.length; mainClose++) { if (plain[mainClose] === '{') d++; else if (plain[mainClose] === '}' && --d === 0) break; }
  /** Numbers, operators, parentheses and vector constructors only. */
  const fixed = (rhs: string) => !/[A-Za-z_]/.test(rhs.replace(/\b(?:vec[234]|float|int)\s*\(/g, '(').replace(/(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g, ''));
  for (const m of plain.matchAll(declRe)) {
    const at = m.index! + m[1].length + m[2].length;
    if (braceDepth(plain, at) !== 0) continue; // a global
    const [whole, , , type, name, sizeText] = m; const size = Number(sizeText);
    const declEnd = m.index! + whole.length;
    // Every write: `name[k] = <numbers>;` directly in main's body.
    const writeRe = new RegExp(`(?<![\\w.])${name}\\s*\\[([^\\]]*)\\]\\s*(\\.[xyzwrgba]+)?\\s*([-+*/]?=)(?!=)\\s*([^;]*);`, 'g');
    const writes = [...plain.matchAll(writeRe)];
    if (!writes.length || new RegExp(`(?<![\\w.])(?:\\+\\+|--)\\s*${name}\\b|(?<![\\w.])${name}\\s*\\[[^\\]]*\\][^;=]*(?:\\+\\+|--)`).test(plain)) continue;
    const values = new Map<number, string>(); const writeEdits: typeof edits = [];
    let okay = true;
    for (const w of writes) {
      const k = Number(w[1].trim());
      const inMain = w.index! > mainOpen && w.index! < mainClose && braceDepth(plain, w.index!) === braceDepth(plain, mainOpen + 1);
      const rhsAt = w.index! + w[0].lastIndexOf(w[4]);
      if (!/^\d+$/.test(w[1].trim()) || k >= size || w[2] || w[3] !== '=' || !inMain || values.has(k) || !fixed(w[4])) { okay = false; break; }
      values.set(k, source.slice(rhsAt, rhsAt + w[4].length).trim());
      writeEdits.push({ at: w.index!, del: w[0].length, text: '' });
    }
    if (!okay) continue;
    const zero = type === 'float' ? '0.0' : type === 'int' ? '0' : `${type}(0.0)`;
    const body = [...Array(size).keys()].map(k => `    if (i == ${k}) return ${values.get(k) ?? zero};`).join('\n');
    edits.push({ at, del: declEnd - at, text: `${type} ${name}(int i) {\n${body}\n    return ${zero};\n}` });
    edits.push(...writeEdits);
    // Reads: name[expr] → name(expr), brackets balanced.
    for (const r of plain.matchAll(new RegExp(`(?<![\\w.])${name}\\s*\\[`, 'g'))) {
      if (r.index! >= at && r.index! < declEnd) continue;
      if (writeEdits.some(w => r.index! >= w.at && r.index! < w.at + w.del)) continue;
      const open = r.index! + r[0].length - 1; let d = 0, close = open;
      for (; close < plain.length; close++) { if (plain[close] === '[') d++; else if (plain[close] === ']' && --d === 0) break; }
      edits.push({ at: open, del: 1, text: '(' }, { at: close, del: 1, text: ')' });
    }
    names.push(name);
  }
  if (!names.length) return null;
  edits.sort((a, b) => b.at - a.at);
  for (const e of edits) code = code.slice(0, e.at) + e.text + code.slice(e.at + e.del);
  return { code, names };
}
const braceDepth = (s: string, at: number) => { let d = 0; for (let i = 0; i < at; i++) { if (s[i] === '{') d++; else if (s[i] === '}') d--; } return d; };

// ── Uniforms with no source → consts ────────────────────────────────────────

const SOURCE_UNIFORMS = new Set(['u_time', 'u_resolution', 'u_mouse', 'iTime', 'iResolution', 'iMouse', 'iFrame', 'iTimeDelta', 'iDate', 'time', 'resolution', 'mouse']);
export function uniformsToConsts(source: string): { code: string; names: string[] } | null {
  const plain = blankComments(source);
  const names: string[] = []; const samplers: string[] = [];
  const edits: { at: number; del: number; text: string }[] = [];
  for (const m of plain.matchAll(/(^|[;}\n])([ \t]*)uniform[ \t]+(?:(?:highp|mediump|lowp)[ \t]+)?(float|int|bool|vec[234]|sampler2D|samplerCube)[ \t]+([A-Za-z_]\w*)[ \t]*;/g)) {
    const [, lead, , type, name] = m;
    if (SOURCE_UNIFORMS.has(name) || /^iChannel/.test(name)) continue;
    const at = m.index! + lead.length;
    if (type.startsWith('sampler')) { samplers.push(name); edits.push({ at, del: m[0].length - lead.length, text: '' }); continue; }
    const zero = type === 'float' ? '0.0' : type === 'int' ? '0' : type === 'bool' ? 'false' : `${type}(0.0)`;
    edits.push({ at, del: m[0].length - lead.length, text: `${m[2]}const ${type} ${name} = ${zero}; // was a uniform: set the value you want` });
    names.push(name);
  }
  if (!names.length && !samplers.length) return null;
  edits.sort((a, b) => b.at - a.at);
  let code = source;
  for (const e of edits) code = code.slice(0, e.at) + e.text + code.slice(e.at + e.del);
  for (const s of samplers) code = blackTextures(code, s);
  return { code, names: [...names, ...samplers] };
}

// ── A uint hash → a float hash ──────────────────────────────────────────────

const FLOAT_HASH: Record<string, (p: string) => string> = {
  float: p => `vec3 p3 = fract(vec3(${p}) * 0.1031);\n    p3 += dot(p3, p3.zyx + 31.32);\n    return fract((p3.x + p3.y) * p3.z);`,
  vec2: p => `vec3 p3 = fract(vec3(${p}.xyx) * 0.1031);\n    p3 += dot(p3, p3.yzx + 33.33);\n    return fract((p3.x + p3.y) * p3.z);`,
  vec3: p => `vec3 p3 = fract(${p} * 0.1031);\n    p3 += dot(p3, p3.zyx + 31.32);\n    return fract((p3.x + p3.y) * p3.z);`,
};
/**
 * A function returning a float from one float / vec2 / vec3 whose body uses
 * uint or bit operations gets a float hash for a body; functions only those
 * called (the uint helpers) go. Anything else using uint: no fix.
 */
export function floatHash(source: string): { code: string; names: string[] } | null {
  const plain = blankComments(source);
  type F = { name: string; ret: string; start: number; end: number; bodyOpen: number; params: string; body: string };
  const fns: F[] = [];
  for (const m of plain.matchAll(/(^|[;}\n])[ \t]*(float|int|uint|vec[234]|uvec[234]|ivec[234]|void|bool)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g)) {
    const start = m.index! + m[1].length; const bodyOpen = m.index! + m[0].length - 1;
    let d = 0, end = bodyOpen; for (; end < plain.length; end++) { if (plain[end] === '{') d++; else if (plain[end] === '}' && --d === 0) break; }
    fns.push({ name: m[3], ret: m[2], start, end: end + 1, bodyOpen, params: m[4].trim(), body: plain.slice(bodyOpen, end + 1) });
  }
  const uses = (f: F) => ES3_INTEGER.test(f.body) || ES3_INTEGER.test(f.params) || /^u/.test(f.ret);
  const bad = fns.filter(uses);
  if (!bad.length) return null;
  const outside = plain.split('').map((c, i) => (fns.some(f => i >= f.start && i < f.end) ? ' ' : c)).join('');
  if (ES3_INTEGER.test(outside)) return null;
  const replaced: F[] = []; const dropped: F[] = [];
  for (const f of bad) {
    const pm = /^(?:in\s+)?(float|vec2|vec3)\s+(\w+)$/.exec(f.params);
    if (f.ret === 'float' && pm && FLOAT_HASH[pm[1]]) replaced.push(f);
    else dropped.push(f);
  }
  if (!replaced.length) return null;
  // A dropped helper may only be called from the functions being replaced (or other dropped ones).
  for (const f of dropped) {
    const callers = fns.filter(g => g !== f && new RegExp(`(?<![\\w.])${f.name}\\s*\\(`).test(g.body));
    if (callers.some(g => !bad.includes(g))) return null;
    if (new RegExp(`(?<![\\w.])${f.name}\\s*\\(`).test(outside)) return null;
  }
  const edits = [
    ...replaced.map(f => { const pm = /(float|vec2|vec3)\s+(\w+)$/.exec(f.params)!; return { at: f.bodyOpen, del: f.end - f.bodyOpen, text: `{\n    ${FLOAT_HASH[pm[1]](pm[2])}\n}` }; }),
    ...dropped.map(f => ({ at: f.start, del: f.end - f.start, text: '' })),
  ].sort((a, b) => b.at - a.at);
  let code = source;
  for (const e of edits) code = code.slice(0, e.at) + e.text + code.slice(e.at + e.del);
  return { code: code.replace(/^\s*\n/, ''), names: replaced.map(f => f.name) };
}
