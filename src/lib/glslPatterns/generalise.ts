/**
 * "Make a node from this": turn an expression (or a recognised idiom, or any sub-expression)
 * into a reusable function. Its free variables and its literals become inputs; the person can
 * rename them and say which literals stay constant.
 *
 *  - An idiom gives the body (its pattern), the input names (`holes[x].input`: radius, width…)
 *    and the function's name. Numbers that are part of the idiom's identity (the 0.5s of
 *    `x * 0.5 + 0.5`) stay in the body.
 *  - Otherwise the body is the expression itself: every name that isn't a global becomes an
 *    input, keeping its name, and every literal is offered as a slider named after where it
 *    sits (the edge of a smoothstep is `edge0`, a factor on space is `zoom`…).
 *  - Literal defaults become slider defaults; 0 and 1, and the numbers inside an all-literal
 *    `vec3(…)`, start as constants.
 *  - Types come from the host's environment, else from how the name is used (`p.y` needs at least
 *    a vec2), else its name (uv → vec2, col → vec3), else float; guesses are flagged.
 */
import { allNodes, childrenOf, formatNumber, printExpr, type Expr, type GlslType } from './ast';
import { compilePattern } from './match';
import { parseExpr } from './parse';
import { inferTypes, GLOBAL_TYPES, type TypeEnv } from './types';
import { inferRoles, roleFromName, type Role } from './roles';
import { explainTree, fmt, type ExplainContext, type Explanation, type IdiomHit } from './explain';
import { rangeForValue } from '../rangeMath';
import type { Idiom } from './idioms';

export interface GenInput {
  /** Proposed name: a valid, unique GLSL identifier. */
  name: string;
  type: GlslType;
  /** free: a name the expression reads; literal: a number in it; hole: what an idiom's hole matched. */
  kind: 'free' | 'literal' | 'hole';
  /** The code it stands for in the original (what a call passes for it). */
  source: string;
  /** A number's value (a literal, or a hole that matched a number). */
  default?: number;
  /** A vector constant's components (`vec3(0.5)` matched by an idiom hole). */
  defaultVec?: number[];
  /** Kept in the body as written instead of being an input. Only literals and constant holes can be. */
  constant: boolean;
  /** Can the person toggle `constant`? */
  canBeConstant: boolean;
  /** A suggested slider range for a float literal. */
  slider?: { min: number; max: number };
  /** The type is a guess (from the name, or a default). */
  typeGuessed?: boolean;
  role?: Role;
}

export interface Generalised {
  fnName: string;
  label: string;
  /** From the explanation: the sentence, plus an idiom's own words. */
  description: string;
  inputs: GenInput[];
  outputType: GlslType;
  outputTypeGuessed: boolean;
  idiom?: Idiom;
  /** The expression it came from, as written. */
  original: string;
  /** Internal: how to rebuild the body. */
  plan: BodyPlan;
}

type BodyPlan =
  | { kind: 'idiom'; pattern: string; holeInput: Record<string, number> }
  | { kind: 'expr'; src: string; /** input index → the node ids it replaces */ nodes: Record<number, number[]>; root: Expr };

export interface GeneraliseContext extends ExplainContext {
  /** Names that stay as they are (globals of the place it will run: `t` in an Expression Block). */
  globals?: string[];
  /** Turn idioms off and generalise the expression as written. */
  plain?: boolean;
}

const GLSL_WORDS = new Set(['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4', 'void', 'return', 'if', 'else', 'for', 'while', 'in', 'out', 'inout', 'const', 'uniform', 'varying', 'attribute', 'true', 'false', 'discard', 'break', 'continue', 'struct', 'precision', 'highp', 'mediump', 'lowp', 'sampler2D',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'exp2', 'log', 'log2', 'sqrt', 'inversesqrt', 'abs', 'sign', 'floor', 'ceil', 'fract', 'round', 'trunc', 'mod', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'length', 'distance', 'dot', 'cross', 'normalize', 'reflect', 'refract', 'pow', 'radians', 'degrees', 'texture', 'texture2D', 'fwidth', 'dFdx', 'dFdy']);

/** A valid identifier from free text: "soft circle" → softCircle. */
export function toIdentifier(text: string, fallback = 'value'): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return text;
  const words = text.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let id = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  if (!id) id = fallback;
  if (/^\d/.test(id)) id = `v${id}`;
  return id;
}

function uniqueName(want: string, taken: Set<string>, reserved = GLSL_WORDS): string {
  let base = toIdentifier(want);
  if (reserved.has(base)) base = `${base}In`;
  let n = base, i = 2;
  while (taken.has(n) || /__/.test(n)) n = `${base}${i++}`;
  taken.add(n);
  return n;
}

/** Parameter names of built-ins, for naming a literal by where it sits. */
const PARAM_NAMES: Record<string, string[]> = {
  smoothstep: ['edge0', 'edge1', 'x'], step: ['edge', 'x'], mix: ['a', 'b', 'amount'], clamp: ['x', 'lo', 'hi'], pow: ['x', 'exponent'],
  mod: ['x', 'period'], min: ['a', 'b'], max: ['a', 'floor'], atan: ['y', 'x'], vec2: ['x', 'y'], vec3: ['x', 'y', 'z'], vec4: ['x', 'y', 'z', 'w'],
  rotate: ['p', 'angle'], palette: ['t', 'bias', 'amp', 'freq', 'phase'], sdBox: ['p', 'halfSize'], opRepeat: ['p', 'period'], exp: ['x'],
};

function literalName(node: Expr, parent: Expr | null, roles: Map<number, { role: Role }>, types: Map<number, GlslType>): string {
  if (!parent) return 'value';
  if (parent.kind === 'call') {
    const i = parent.args.indexOf(node);
    if (/^vec[34]$/.test(parent.callee) && roles.get(parent.id)?.role === 'colour') return ['red', 'green', 'blue', 'alpha'][i] ?? 'value';
    const names = PARAM_NAMES[parent.callee];
    if (names?.[i]) return names[i];
    if (parent.callee === 'sin' || parent.callee === 'cos') return 'phase';
    return 'value';
  }
  if (parent.kind === 'unary') return literalName(parent, null, roles, types);
  if (parent.kind === 'binary') {
    const other = parent.left === node ? parent.right : parent.left;
    const role = roles.get(other.id)?.role ?? 'value';
    switch (parent.op) {
      case '*': return role === 'space' ? 'zoom' : role === 'colour' ? 'brightness' : role === 'time' ? 'speed' : role === 'distance' ? 'falloff' : role === 'angle' ? 'turns' : 'scale';
      case '/': return parent.right === node ? (role === 'space' ? 'size' : 'divisor') : 'numerator';
      case '+': case '-': return role === 'space' ? 'offset' : role === 'colour' ? 'lift' : role === 'time' ? 'timeOffset' : role === 'distance' ? (parent.op === '-' ? 'radius' : 'offset') : 'offset';
      default: return 'threshold';
    }
  }
  return 'value';
}

/** A number or a negated number literal: `-2.0` is one literal. */
function literalValue(e: Expr): number | undefined {
  if (e.kind === 'num') return e.value;
  if (e.kind === 'unary' && e.op === '-' && e.arg.kind === 'num') return -e.arg.value;
  return undefined;
}

function guessType(name: string, uses: Expr[], parents: Map<number, Expr | null>): { type: GlslType; guessed: boolean } {
  let need = 0;
  for (const u of uses) {
    const par = parents.get(u.id);
    if (par?.kind === 'member' && par.object === u) for (const ch of par.field) need = Math.max(need, ('xyzw'.indexOf(ch) + 1) || ('rgba'.indexOf(ch) + 1) || ('stpq'.indexOf(ch) + 1));
  }
  const byName = roleFromName(name);
  if (need >= 2) return { type: need === 2 && byName !== 'colour' ? 'vec2' : need === 3 || (need === 2 && byName === 'colour') ? 'vec3' : 'vec4', guessed: true };
  if (byName === 'space' || byName === 'direction' || byName === 'cell') return { type: 'vec2', guessed: true };
  if (byName === 'colour') return { type: 'vec3', guessed: true };
  return { type: 'float', guessed: true };
}

function constantVector(e: Expr): number[] | undefined {
  if (e.kind !== 'call' || !/^vec[234]$/.test(e.callee)) return undefined;
  const vals = e.args.map(literalValue);
  if (vals.some(v => v === undefined)) return undefined;
  const n = Number(e.callee[3]);
  return vals.length === 1 ? Array(n).fill(vals[0]) : (vals as number[]);
}

/**
 * Generalise `root` (spans in `src`). With an idiom at the root (and not `plain`), the idiom
 * decides the body and the names; otherwise the expression does.
 */
export function generalise(root: Expr, src: string, ctx: GeneraliseContext = {}): Generalised {
  const ex: Explanation = explainTree(root, src, ctx);
  const hit: IdiomHit | undefined = !ctx.plain ? ex.idioms.find(h => h.node === root || (h.node.start === root.start && h.node.end === root.end)) : undefined;
  const env: TypeEnv = ctx.types ?? {};
  const types = inferTypes(root, env);
  const roles = inferRoles(root, types, ctx.roles ?? {});
  const original = src.slice(root.start, root.end).trim();
  let outputType = types.get(root.id) ?? 'unknown';
  const outputTypeGuessed = outputType === 'unknown';
  if (outputType === 'unknown' || outputType === 'int') outputType = 'float';
  const taken = new Set<string>();
  const inputs: GenInput[] = [];

  if (hit) {
    const idiom = hit.idiom;
    const holeInput: Record<string, number> = {};
    // In the order the holes appear in the pattern
    const order: string[] = [];
    const pat = parseExpr(hit.pattern);
    if (pat.ok) for (const n of allNodes(pat.expr)) if (n.kind === 'ident' && /^[$#]/.test(n.name) && !order.includes(n.name.slice(1))) order.push(n.name.slice(1));
    for (const name of order) {
      const b = hit.bindings[name];
      if (!b) continue;
      const exprType = types.get(b.expr.id) ?? inferTypes(b.expr, env).get(b.expr.id) ?? 'unknown';
      const vec = constantVector(b.expr);
      const isNum = b.value !== undefined;
      const want = idiom.holes?.[name]?.input ?? name;
      const source = b.expr.id >= 0 ? src.slice(b.expr.start, b.expr.end).trim() : b.value !== undefined ? formatNumber(b.value) : printExpr(b.expr);
      const t: GlslType = isNum ? 'float' : exprType === 'unknown' ? guessType(want, [], new Map()).type : exprType === 'int' ? 'float' : exprType;
      inputs.push({
        name: uniqueName(want, taken), type: t, kind: isNum ? 'literal' : 'hole', source: isNum ? formatNumber(b.value!) : source,
        default: b.value, defaultVec: vec, constant: !!vec, canBeConstant: isNum || !!vec,
        slider: isNum ? rangeForValue(b.value!) : undefined, typeGuessed: !isNum && exprType === 'unknown', role: roles.get(b.expr.id)?.role,
      });
      holeInput[name] = inputs.length - 1;
    }
    const g: Generalised = {
      fnName: uniqueName(idiom.fnName, new Set(), GLSL_WORDS), label: idiom.name.replace(/\s*\(.*\)$/, ''),
      description: '',
      inputs, outputType, outputTypeGuessed, idiom, original, plan: { kind: 'idiom', pattern: hit.pattern, holeInput },
    };
    g.description = descriptionFor(g);
    return g;
  }

  // ── As written ────────────────────────────────────────────────────────────
  const parents = new Map<number, Expr | null>();
  const visit = (n: Expr, p: Expr | null) => { parents.set(n.id, p); childrenOf(n).forEach(c => visit(c, n)); };
  visit(root, null);
  const globals = new Set([...Object.keys(GLOBAL_TYPES), ...(ctx.globals ?? [])]);
  const nodes: Record<number, number[]> = {};
  const free = new Map<string, Expr[]>();
  const literals: Expr[] = [];
  const walkFree = (n: Expr) => {
    const par = parents.get(n.id) ?? null;
    if (n.kind === 'ident' && !globals.has(n.name)) { const l = free.get(n.name) ?? []; l.push(n); free.set(n.name, l); return; }
    if (literalValue(n) !== undefined && !(par && par.kind === 'unary' && par.op === '-' && n.kind === 'num')) { literals.push(n); return; }
    childrenOf(n).forEach(walkFree);
  };
  walkFree(root);
  // Free names first (they keep their names), then literals in source order
  for (const [name, uses] of free) {
    const known = env[name] ?? types.get(uses[0].id);
    const g = known && known !== 'unknown' ? { type: known === 'int' ? 'float' as GlslType : known, guessed: false } : guessType(name, uses, parents);
    taken.add(name);
    inputs.push({ name, type: g.type, kind: 'free', source: name, constant: false, canBeConstant: false, typeGuessed: g.guessed, role: roles.get(uses[0].id)?.role });
    nodes[inputs.length - 1] = uses.map(u => u.id);
  }
  for (const lit of literals.sort((a, b) => a.start - b.start)) {
    const v = literalValue(lit)!;
    const par = parents.get(lit.id) ?? null;
    const inConstVec = !!par && par.kind === 'call' && /^vec[234]$/.test(par.callee) && par.args.every(a => literalValue(a) !== undefined);
    const constant = v === 0 || v === 1 || inConstVec;
    inputs.push({
      name: uniqueName(literalName(lit, par, roles, types), taken), type: 'float', kind: 'literal', source: src.slice(lit.start, lit.end).trim(),
      default: v, constant, canBeConstant: true, slider: rangeForValue(v), role: 'value',
    });
    nodes[inputs.length - 1] = [lit.id];
  }
  const rootDesc = ex.descs.get(root.id);
  const short = rootDesc && !rootDesc.leaf ? rootDesc.short.replace(/^the /, '') : 'expression';
  const label = short.replace(/^./, ch => ch.toUpperCase());
  return {
    fnName: uniqueName(short, new Set()), label, description: ex.sentence,
    inputs, outputType, outputTypeGuessed, original, plan: { kind: 'expr', src, nodes, root },
  };
}

/**
 * The node's description: an idiom's own words, read the way the made node works.
 *  - A hole kept as a constant reads as its value ("of radius 0.3").
 *  - A hole that became an input with a default reads as the default, marked adjustable
 *    ("of radius 0.3 (adjustable)"), not as the input's name, which would give "radius radius".
 *  - An input with no default (it stands for an expression, like `p`) reads as its name, except
 *    where the template's own word already says it: "of radius radius" becomes "of the given radius".
 * Else (no idiom) the explanation's sentence, which only ever quotes the original code.
 */
export function descriptionFor(g: Generalised, choices: GenChoices = {}): string {
  if (g.plan.kind !== 'idiom' || !g.idiom) return g.description;
  const plan = g.plan;
  const at = (hole: string) => {
    const idx = plan.holeInput[hole];
    const inp = g.inputs[idx];
    if (!inp) return undefined;
    const constant = inp.canBeConstant ? (choices.constant?.[idx] ?? inp.constant) : false;
    return { inp, constant, name: (choices.names?.[idx] ?? inp.name).trim() };
  };
  // Names without a default go in as markers, resolved once the sentence is written.
  const OPEN = '\u0001', CLOSE = '\u0002';
  // "(adjustable)" goes on a hole's first mention only: "a 4 (adjustable) × 4 grid".
  const marked = new Set<string>();
  const adjustable = (hole: string, value: string) => (marked.has(hole) ? value : (marked.add(hole), `${value} (adjustable)`));
  const text = (hole: string) => {
    const a = at(hole);
    if (!a) return '';
    if (a.constant) return a.inp.default !== undefined ? fmt(a.inp.default) : a.inp.source;
    if (a.inp.default !== undefined) return adjustable(hole, fmt(a.inp.default));
    if (a.inp.defaultVec) return adjustable(hole, a.inp.source);
    return `${OPEN}${a.name}${CLOSE}`;
  };
  const how = g.idiom.how({
    h: text, n: text,
    // What the code would say: tested by templates (`c.code('w') ? …`), not worded, so it marks nothing
    code: hole => { const a = at(hole); return !a ? '' : a.inp.default !== undefined ? fmt(a.inp.default) : a.constant || a.inp.defaultVec ? a.inp.source : a.name; },
    v: hole => at(hole)?.inp.default,
    role: hole => at(hole)?.inp.role ?? 'unknown', type: hole => at(hole)?.inp.type ?? 'unknown',
  });
  const words = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const same = (said: string, name: string) => said.toLowerCase().replace(/-/g, ' ') === words(name) || said.toLowerCase() === name.toLowerCase();
  const NAME = `${OPEN}([^${CLOSE}]+)${CLOSE}`;
  const resolved = how
    // "an angle of ⟨angle⟩" → "the given angle"
    .replace(new RegExp(`\\b(an?|the) ([\\w-]+) of ${NAME}`, 'g'), (m, _art: string, said: string, name: string) => (same(said, name) ? `the given ${words(name)}` : m))
    // "(the) radius ⟨radius⟩" → "the given radius"
    .replace(new RegExp(`\\b(?:(?:the|an?) )?([\\w-]+) ${NAME}`, 'g'), (m, said: string, name: string) => (same(said, name) ? `the given ${said}` : m))
    // "⟨steps⟩ steps" → "the given steps"
    .replace(new RegExp(`${NAME} ([\\w-]+)`, 'g'), (m, name: string, said: string) => (same(said, name) ? `the given ${said}` : m))
    .replace(new RegExp(NAME, 'g'), '$1');
  return `${resolved[0].toUpperCase()}${resolved.slice(1)}.`;
}

/** What the person chose in the dialog. Keyed by input index. */
export interface GenChoices {
  names?: Record<number, string>;
  constant?: Record<number, boolean>;
  types?: Record<number, GlslType>;
  fnName?: string;
}

export interface BuiltFunction {
  fnName: string;
  /** The inputs that are parameters (constants left out), with their final names. */
  params: Array<GenInput & { index: number }>;
  outputType: GlslType;
  /** The return expression. */
  body: string;
  /** `float softCircle(vec2 p, float radius) {\n    return …;\n}` */
  code: string;
  /** The call that stands for the original: `softCircle(uv, 0.3)`. */
  call: string;
  /** The body with every parameter as a `$hole`: a pattern that finds other uses. */
  pattern: string;
  /** Problems with the choices (a bad or repeated name). */
  errors: string[];
}

const IDENT = /^[A-Za-z_]\w*$/;

/** Apply the choices: names, constants, types. */
export function buildFunction(g: Generalised, choices: GenChoices = {}): BuiltFunction {
  const errors: string[] = [];
  const fnName = (choices.fnName ?? g.fnName).trim();
  if (!IDENT.test(fnName)) errors.push(`“${fnName}” isn’t a valid function name.`);
  else if (GLSL_WORDS.has(fnName) && fnName !== 'p' && fnName !== 't') errors.push(`“${fnName}” is a GLSL word; pick another name.`);
  const final = g.inputs.map((inp, index) => ({
    ...inp, index,
    name: (choices.names?.[index] ?? inp.name).trim(),
    constant: inp.canBeConstant ? (choices.constant?.[index] ?? inp.constant) : false,
    type: choices.types?.[index] ?? inp.type,
  }));
  const params = final.filter(i => !i.constant);
  const seen = new Set<string>();
  for (const p of params) {
    if (!IDENT.test(p.name)) errors.push(`“${p.name}” isn’t a valid input name.`);
    else if (/__/.test(p.name)) errors.push(`“${p.name}”: GLSL reserves names with two underscores in a row.`);
    else if (GLSL_WORDS.has(p.name) && p.name !== 'p' && p.name !== 't') errors.push(`“${p.name}” is a GLSL word; pick another name.`);
    if (seen.has(p.name)) errors.push(`Two inputs are called “${p.name}”.`);
    seen.add(p.name);
  }
  const constText = (i: (typeof final)[number]) => (i.defaultVec ? i.source : i.default !== undefined ? formatNumber(i.default) : i.source);
  let body: string;
  let pattern: string;
  if (g.plan.kind === 'idiom') {
    const pe = parseExpr(g.plan.pattern);
    if (!pe.ok) throw new Error(pe.error);
    const subst = new Map<number, string>();
    const patSubst = new Map<number, string>();
    for (const n of allNodes(pe.expr)) {
      if (n.kind !== 'ident' || !/^[$#]/.test(n.name)) continue;
      const idx = g.plan.holeInput[n.name.slice(1)];
      const inp = final[idx];
      if (!inp) continue;
      subst.set(n.id, inp.constant ? constText(inp) : inp.name);
      patSubst.set(n.id, inp.constant ? constText(inp) : `$${inp.name}`);
    }
    body = printExpr(pe.expr, subst);
    pattern = printExpr(pe.expr, patSubst);
  } else {
    const subst = new Map<number, string>();
    const patSubst = new Map<number, string>();
    for (const inp of final) {
      const ids = g.plan.nodes[inp.index] ?? [];
      for (const id of ids) {
        if (inp.constant) continue;
        subst.set(id, inp.name);
        patSubst.set(id, `$${inp.name}`);
      }
    }
    body = printExpr(g.plan.root, subst);
    pattern = printExpr(g.plan.root, patSubst);
  }
  const outputType = g.outputType;
  const sig = params.map(p => `${p.type} ${p.name}`).join(', ');
  const code = `${outputType} ${fnName}(${sig}) {\n    return ${body};\n}`;
  const call = `${fnName}(${params.map(p => p.source).join(', ')})`;
  return { fnName, params, outputType, body, code, call, pattern, errors };
}

/** Generalise a piece of text: an expression, or a span of a longer text. */
export function generaliseText(text: string, ctx: GeneraliseContext = {}, span?: { start: number; end: number }): Generalised | { error: string } {
  const slice = span ? text.slice(span.start, span.end) : text;
  const r = parseExpr(slice, span?.start ?? 0);
  if (!r.ok) return { error: r.error };
  return generalise(r.expr, text, ctx);
}

/** Check a pattern built by `buildFunction` parses (and so can be matched). */
export function patternIsUsable(pattern: string): boolean {
  try { compilePattern(pattern); return true; } catch { return false; }
}
