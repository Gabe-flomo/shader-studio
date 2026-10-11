/**
 * Guided Convert, the analysis (docs/guided-convert.md): a shader read as ours, its main() cut into
 * units (top-level statements), each with the lines it came from in the pasted text, the names it
 * declares, reads and writes, the helpers it calls and the numbers in it. Pure; no store, no UI.
 */
import { parser, generate } from '@shaderfrog/glsl-parser';
import { normaliseHostShader } from '../../glslToGraph';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ast = Record<string, any> & { type: string };

/** A number in a unit, offered as a chip (slider / input / fixed). */
export interface LiteralSite {
  /** `${unit}:${k}` in main(), `${fn}/${unit}:${k}` in a helper, k counting the unit's chippable numbers in source order. */
  id: string;
  unit: number;
  value: number;
  raw: string;
  /** Offset of the number in the normalised text. */
  at: number;
  /** A name for it from where it sits (edge0, scale…), unique in the shader. */
  name: string;
  /** Starts fixed when converted as one function (0, 1, a colour's parts), as "Make a node" does. */
  fixedByDefault: boolean;
  /** Line in the pasted text. */
  line: number;
}

export interface Unit {
  index: number;
  /** Offsets in the normalised text (end exclusive, no trailing blanks). */
  start: number; end: number;
  text: string;
  /** Lines in the pasted text (1-based, inclusive). */
  lines: [number, number];
  /** Top-level names it declares, with their types. */
  decls: { name: string; type: string; array: boolean }[];
  /** Names it reads (a name only assigned with `=` isn't read). */
  uses: Set<string>;
  writes: Set<string>;
  /** User functions it calls, directly or through other helpers. */
  calls: Set<string>;
  literals: LiteralSite[];
  /** Added by the reading (Shadertoy's fragCoord line, an alpha of 1): always converted, not counted. */
  setup: boolean;
  hasDiscard: boolean;
  hasReturn: boolean;
  /** Top-level statements it stands for: more than 1 only for a return's merged tail. */
  parts: number;
  ast: Ast;
  /** The helper whose body it is a statement of (absent: main()). */
  fn?: string;
}

export interface HelperParam { name: string; type: string; qual: 'in' | 'out' | 'inout' }

export interface HelperFn {
  name: string;
  lines: [number, number];
  calls: Set<string>;
  outParams: Set<number>;
  params: HelperParam[];
  /** Its return type. */
  ret: string;
  /** Offsets of its definition in `norm`: from its return type to after its closing brace. */
  start: number; end: number;
  /** Its text up to the body's `{` (the header), as written. */
  header: string;
  /** Its body's top-level statements, as units (the last is its `return`). */
  units: Unit[];
  /** Types of its parameters and top-level locals. */
  localTypes: Map<string, string>;
  /** Whether it can open as a group of its own: true, or why not. */
  openable: true | string;
  /** Statements of main() that call it by name. */
  callers: number[];
}

export interface Analysis {
  ok: true;
  source: string;
  /** The shader as the converter reads it (dialect translated, comments blanked, macros expanded). */
  norm: string;
  toSourceLine: (line: number) => number;
  units: Unit[];
  helpers: HelperFn[];
  /** Offsets of main()'s definition in `norm`: from its return type to after its closing brace. */
  mainStart: number; mainEnd: number;
  /** Types of main()'s top-level locals. */
  localTypes: Map<string, string>;
  /** Uniforms (name → type), ours (u_time…) included. */
  uniforms: Map<string, string>;
  /** Every identifier in the program, for making new names that don't clash. */
  names: Set<string>;
  /** Global variables (not uniforms, not consts): a statement that writes one has an effect beyond its locals. */
  globals: Set<string>;
}
export type AnalysisResult = Analysis | { ok: false; error: string; line?: number };

const lineAt = (text: string, offset: number) => { let n = 1; for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };

/** Every child node of an AST node. */
function children(n: Ast): Ast[] {
  const out: Ast[] = [];
  for (const [k, v] of Object.entries(n)) {
    if (k === 'location' || k === 'whitespace' || k === 'scope') continue;
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x === 'object' && typeof x.type === 'string') out.push(x as Ast); }
    else if (v && typeof v === 'object' && typeof (v as Ast).type === 'string') out.push(v as Ast);
  }
  return out;
}

/** The name a call calls (`length`, `vec3`, a helper's name). */
export function calleeName(call: Ast): string {
  const id = call.identifier as Ast;
  if (!id) return '';
  if (id.type === 'type_specifier') { const s = id.specifier as Ast; return (s?.identifier ?? s?.token ?? '') as string; }
  return (id.identifier ?? '') as string;
}

/** The variable an lvalue writes (`uv` for `uv.x`, `a[i]`, `(p)`). */
function lvalueRoot(n: Ast | undefined): string | null {
  while (n) {
    if (n.type === 'identifier') return n.identifier as string;
    if (n.type === 'postfix' || n.type === 'group') { n = n.expression as Ast; continue; }
    return null;
  }
  return null;
}

/** Names read, written and functions called anywhere under `n`. */
function scan(n: Ast, outParams: Map<string, Set<number>>, acc: { uses: Set<string>; writes: Set<string>; calls: Set<string>; discard: boolean; ret: boolean }): void {
  switch (n.type) {
    case 'identifier': acc.uses.add(n.identifier as string); return;
    case 'field_selection': return; // `.xy`
    case 'function_call': {
      const name = calleeName(n);
      if (name) acc.calls.add(name);
      const args = ((n.args as Ast[] | undefined) ?? []).filter(a => a.type !== 'literal');
      const outs = outParams.get(name);
      args.forEach((a, i) => { if (outs?.has(i)) { const r = lvalueRoot(a); if (r) acc.writes.add(r); } scan(a, outParams, acc); });
      return;
    }
    case 'declaration': {
      // The declared name isn't a read; its initialiser and array size are.
      for (const c of children(n)) if (c !== n.identifier) scan(c, outParams, acc);
      return;
    }
    case 'assignment': {
      const r = lvalueRoot(n.left as Ast); if (r) acc.writes.add(r);
      // `x = …` only writes x; `x += …`, `x.y = …` read it too.
      if ((n.operator as Ast)?.literal === '=' && (n.left as Ast)?.type === 'identifier') { scan(n.right as Ast, outParams, acc); return; }
      break;
    }
    case 'postfix': {
      const pf = n.postfix as Ast; const lit = pf?.literal ?? (pf?.operator as Ast)?.literal;
      if (lit === '++' || lit === '--') { const r = lvalueRoot(n.expression as Ast); if (r) acc.writes.add(r); }
      break;
    }
    case 'unary': {
      const lit = (n.operator as Ast)?.literal;
      if (lit === '++' || lit === '--') { const r = lvalueRoot(n.expression as Ast); if (r) acc.writes.add(r); }
      break;
    }
    case 'discard_statement': acc.discard = true; break;
    case 'return_statement': acc.ret = true; break;
  }
  for (const c of children(n)) scan(c, outParams, acc);
}

const PARAM_NAMES: Record<string, string[]> = {
  smoothstep: ['edge0', 'edge1', 'x'], step: ['edge', 'x'], mix: ['a', 'b', 'amount'], clamp: ['x', 'lo', 'hi'], pow: ['x', 'exponent'],
  mod: ['x', 'period'], min: ['a', 'b'], max: ['a', 'floor'], atan: ['y', 'x'], vec2: ['x', 'y'], vec3: ['x', 'y', 'z'], vec4: ['x', 'y', 'z', 'w'],
  sin: ['phase'], cos: ['phase'], fract: ['x'], exp: ['x'],
};
const RESERVED = new Set('float int bool vec2 vec3 vec4 mat2 mat3 mat4 void return if else for while do in out inout const uniform varying true false discard break continue struct precision highp mediump lowp main sin cos tan asin acos atan exp exp2 log log2 sqrt inversesqrt abs sign floor ceil fract round trunc mod min max clamp mix step smoothstep length distance dot cross normalize reflect refract pow radians degrees texture texture2D fwidth dFdx dFdy x y z w a b'.split(' '));

/** `want` as a name nothing in the shader uses yet (added to `taken`). */
export function freshName(want: string, taken: Set<string>): string {
  let base = want.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, 'n$1').replace(/__+/g, '_') || 'value';
  if (RESERVED.has(base) || /^gl_/.test(base)) base = `${base}In`;
  let name = base, i = 2;
  while (taken.has(name)) name = `${base}${i++}`;
  taken.add(name);
  return name;
}

/** Numbers in a unit worth a chip, in source order: float constants outside loop headers and array sizes. */
function literalsOf(unit: Ast, unitIndex: number, norm: string, toSourceLine: (l: number) => number, taken: Set<string>, prefix = ''): LiteralSite[] {
  const out: LiteralSite[] = [];
  const visit = (n: Ast, parents: Ast[]) => {
    if (n.type === 'for_statement') { if (n.body) visit(n.body as Ast, [...parents, n]); return; }
    if (n.type === 'float_constant') {
      const raw = String(n.token);
      const value = Number(raw.replace(/[fF]$/, ''));
      const at = (n.location as { start: { offset: number } } | undefined)?.start.offset;
      if (at === undefined || !Number.isFinite(value)) return;
      const parent = parents[parents.length - 1];
      const gp = parents[parents.length - 2];
      let name = 'k';
      let colour = false;
      // Inside a call: the parameter it is (smoothstep's edge0…); a vec3/vec4 of numbers only is a colour.
      const call = parent?.type === 'function_call' ? parent : parent?.type === 'unary' && gp?.type === 'function_call' ? gp : null;
      if (call) {
        const callee = calleeName(call);
        const args = ((call.args as Ast[] | undefined) ?? []).filter(a => a.type !== 'literal');
        const i = args.findIndex(a => a === n || (a.type === 'unary' && a.expression === n));
        if (/^vec[34]$/.test(callee) && args.every(a => a.type === 'float_constant' || a.type === 'int_constant' || (a.type === 'unary' && /constant$/.test((a.expression as Ast).type)))) { colour = true; name = ['red', 'green', 'blue', 'alpha'][i] ?? 'value'; }
        else name = PARAM_NAMES[callee]?.[i] ?? (callee && i >= 0 ? `${callee}Arg` : 'k');
      } else if (parent?.type === 'binary') {
        const other = parent.left === n ? parent.right : parent.left;
        const otherName = lvalueRoot(other as Ast)?.replace(/^u_/, '');
        const op = (parent.operator as Ast).literal as string;
        if (otherName) name = `${otherName}${op === '*' ? 'Scale' : op === '/' ? 'Div' : op === '+' || op === '-' ? 'Offset' : 'K'}`;
      } else if (parent?.type === 'declaration') name = (parent.identifier as Ast).identifier as string;
      else if (parent?.type === 'assignment') name = lvalueRoot(parent.left as Ast) ?? 'k';
      if (name === 'k') {
        // Named after the value it helps make: `float glow = 0.03 / abs(rings)` gives glowK.
        const owner = [...parents].reverse().find(p => p.type === 'declaration' || p.type === 'assignment');
        const v = owner?.type === 'declaration' ? (owner.identifier as Ast).identifier as string : owner ? lvalueRoot(owner.left as Ast) : null;
        if (v) name = `${v}K`;
      }
      if (name.startsWith('gl_')) name = name.slice(3);
      out.push({ id: `${prefix}${unitIndex}:${out.length}`, unit: unitIndex, value, raw, at, name: freshName(name, taken), fixedByDefault: colour || value === 0 || value === 1, line: toSourceLine(lineAt(norm, at)) });
      return;
    }
    for (const c of children(n)) visit(c, [...parents, n]);
  };
  visit(unit, []);
  return out;
}

const tokenOf = (n: Ast | undefined): string => {
  if (!n) return '';
  if (n.type === 'keyword') return n.token as string;
  if (n.type === 'type_specifier') return tokenOf(n.specifier as Ast);
  if (n.type === 'type_name') return n.identifier as string;
  return (n.token ?? n.identifier ?? '') as string;
};

/** Read a shader for Guided Convert. */
export function analyse(source: string): AnalysisResult {
  if (!source.trim()) return { ok: false, error: 'No shader yet: paste one, or pick an example.' };
  const { code: norm, toSourceLine } = normaliseHostShader(source);
  let ast: { program: Ast[] };
  try { ast = parser.parse(norm, { quiet: true, includeLocation: true }) as unknown as { program: Ast[] }; }
  catch (e) {
    const loc = (e as { location?: { start?: { line?: number } } }).location?.start?.line;
    return { ok: false, error: `Doesn’t parse: ${(e as Error).message.split('\n')[0]}`, ...(loc ? { line: toSourceLine(loc) } : {}) };
  }
  const names = new Set<string>();
  const collect = (n: Ast) => { if (n.type === 'identifier') names.add(n.identifier as string); if (n.type === 'type_name') names.add(n.identifier as string); for (const c of children(n)) collect(c); };
  for (const st of ast.program) collect(st);

  // Helpers: their out / inout parameters (by position) and what they call.
  const outParams = new Map<string, Set<number>>();
  const fnAsts: Ast[] = [];
  const uniforms = new Map<string, string>();
  const globals = new Set<string>();
  let main: Ast | null = null;
  for (const st of ast.program) {
    if (st.type === 'function') {
      const name = ((st.prototype as Ast).header as Ast).name.identifier as string;
      if (name === 'main') { main = st; continue; }
      fnAsts.push(st);
      const params = (((st.prototype as Ast).parameters as Ast[] | undefined) ?? []).filter(p => p.type !== 'literal');
      const set = outParams.get(name) ?? new Set<number>();
      params.forEach((p, i) => { if (/\b(out|inout)\b/.test(generate(p as never))) set.add(i); });
      outParams.set(name, set);
    } else if (st.type === 'declaration_statement') {
      const decl = st.declaration as Ast;
      const quals = ((decl.specified_type as Ast)?.qualifiers as Ast[] | undefined) ?? [];
      if (quals.some(q => (q as Ast).token === 'uniform')) {
        const ty = tokenOf((decl.specified_type as Ast)?.specifier as Ast);
        for (const d of ((decl.declarations as Ast[] | undefined) ?? [])) uniforms.set((d.identifier as Ast).identifier as string, ty);
      } else if (!quals.some(q => ['const', 'varying', 'in', 'out', 'attribute'].includes((q as Ast).token as string))) {
        for (const d of ((decl.declarations as Ast[] | undefined) ?? [])) if (d.identifier) globals.add((d.identifier as Ast).identifier as string);
      }
    }
  }
  if (!main) return { ok: false, error: 'No main() in this shader.' };
  const helperInfo = fnAsts.map(f => {
    const acc = { uses: new Set<string>(), writes: new Set<string>(), calls: new Set<string>(), discard: false, ret: false };
    scan(f.body as Ast, outParams, acc);
    return { f, acc, name: ((f.prototype as Ast).header as Ast).name.identifier as string };
  });
  // Calls through helpers count (fbm() calls noise()).
  const callsOf = new Map(helperInfo.map(h => [h.name, new Set([...h.acc.calls].filter(c => outParams.has(c)))]));
  const reach = (fn: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(fn)) return seen; seen.add(fn);
    for (const c of callsOf.get(fn) ?? []) reach(c, seen);
    return seen;
  };
  const taken = new Set(names);

  /** A body's top-level statements as units: names declared, read and written, calls, numbers. */
  const unitsOf = (statements: Ast[], localTypes: Map<string, string>, isSetup: (lines: [number, number]) => boolean, fn?: string): Unit[] => statements.map((s, index) => {
    const loc = s.location as { start: { offset: number }; end: { offset: number } };
    const start = loc.start.offset, end = trimEnd(norm, loc.end.offset);
    const acc = { uses: new Set<string>(), writes: new Set<string>(), calls: new Set<string>(), discard: false, ret: false };
    scan(s, outParams, acc);
    const decls: Unit['decls'] = [];
    if (s.type === 'declaration_statement') {
      const decl = s.declaration as Ast;
      const ty = tokenOf((decl.specified_type as Ast)?.specifier as Ast);
      for (const d of ((decl.declarations as Ast[] | undefined) ?? [])) {
        const name = (d.identifier as Ast).identifier as string;
        decls.push({ name, type: ty, array: !!(d.quantifier as unknown[] | null)?.length || !!((decl.specified_type as Ast)?.specifier as Ast)?.quantifier });
        localTypes.set(name, ty);
      }
    }
    const calls = new Set<string>();
    for (const c of acc.calls) if (outParams.has(c)) for (const r of reach(c)) calls.add(r);
    const lines: [number, number] = [toSourceLine(lineAt(norm, start)), toSourceLine(lineAt(norm, end))];
    return { index, start, end, text: norm.slice(start, end), lines, decls, uses: acc.uses, writes: acc.writes, calls, literals: [], setup: isSetup(lines), hasDiscard: acc.discard, hasReturn: acc.ret, parts: 1, ast: s, ...(fn ? { fn } : {}) };
  });

  const mainLoc = (main as Ast).location as { start: { offset: number }; end: { offset: number } };
  const mainHeaderLine = toSourceLine(lineAt(norm, mainLoc.start.offset));
  const mainCloseLine = toSourceLine(lineAt(norm, trimEnd(norm, mainLoc.end.offset)));
  const srcLines = source.split('\n');
  // Setup lines: on main's header or closing line, where the paste itself has no statement.
  const headerHasCode = /;/.test((srcLines[mainHeaderLine - 1] ?? '').replace(/^[^{]*\{/, ''));
  const closeHasCode = /;/.test((srcLines[mainCloseLine - 1] ?? '').replace(/\}[^}]*$/, ''));

  const statements = ((((main as Ast).body as Ast).statements as Ast[]) ?? []);
  const localTypes = new Map<string, string>();
  let units = unitsOf(statements, localTypes, lines => (lines[0] === mainHeaderLine && !headerHasCode) || (lines[0] === mainCloseLine && !closeHasCode));
  // A return in main() (the reading lowers them; a hand-written one may stay): everything from it on is one unit,
  // so no cut separates a return from the lines it skips.
  const firstRet = units.findIndex(u => u.hasReturn);
  if (firstRet >= 0 && firstRet < units.length - 1) {
    const tail = units.slice(firstRet);
    const merged: Unit = {
      ...tail[0], end: tail[tail.length - 1].end, text: norm.slice(tail[0].start, tail[tail.length - 1].end),
      lines: [tail[0].lines[0], Math.max(...tail.map(u => u.lines[1]))],
      decls: tail.flatMap(u => u.decls), uses: new Set(tail.flatMap(u => [...u.uses])), writes: new Set(tail.flatMap(u => [...u.writes])),
      calls: new Set(tail.flatMap(u => [...u.calls])), setup: false, hasDiscard: tail.some(u => u.hasDiscard), parts: tail.length,
      ast: { type: 'compound_statement', statements: tail.map(u => u.ast) } as Ast,
    };
    units = [...units.slice(0, firstRet), merged];
  }
  units.forEach((u, i) => { u.index = i; u.literals = u.setup ? [] : literalsOf(u.ast, i, norm, toSourceLine, taken); });

  // Helpers: their body as units too, so one can be opened as a group and converted step by step.
  const overloads = new Map<string, number>();
  for (const h of helperInfo) overloads.set(h.name, (overloads.get(h.name) ?? 0) + 1);
  const helpers: HelperFn[] = helperInfo.map(({ f, acc, name }) => {
    const loc = f.location as { start: { offset: number }; end: { offset: number } };
    const proto = f.prototype as Ast;
    const params: HelperParam[] = (((proto.parameters as Ast[] | undefined) ?? []).filter(p => p.type !== 'literal')).map(p => ({
      name: ((p.identifier as Ast | undefined)?.identifier ?? '') as string,
      type: tokenOf(p.specifier as Ast),
      qual: ((((p.qualifier as Ast[] | undefined) ?? []).map(q => q.token as string).find(q => q === 'out' || q === 'inout')) ?? 'in') as HelperParam['qual'],
    })).filter(p => p.type !== 'void');
    const ret = tokenOf((((proto.header as Ast).returnType as Ast)?.specifier ?? (proto.header as Ast).returnType) as Ast);
    const body = f.body as Ast;
    const bodyStart = (body.location as { start: { offset: number } }).start.offset;
    const types = new Map<string, string>(params.map(p => [p.name, p.type]));
    const hUnits = overloads.get(name)! > 1 ? [] : unitsOf((body.statements as Ast[] | undefined) ?? [], types, () => false, name);
    hUnits.forEach((u, i) => { u.literals = literalsOf(u.ast, i, norm, toSourceLine, taken, `${name}/`); });
    const lines: [number, number] = [toSourceLine(lineAt(norm, loc.start.offset)), toSourceLine(lineAt(norm, trimEnd(norm, loc.end.offset)))];
    const earlyReturn = hUnits.slice(0, -1).find(u => u.hasReturn) ?? (hUnits.length && hUnits[hUnits.length - 1].ast.type !== 'return_statement' && hUnits[hUnits.length - 1].hasReturn ? hUnits[hUnits.length - 1] : undefined);
    const openable: true | string =
      overloads.get(name)! > 1 ? `${name}() has several versions (overloads)`
      : !['float', 'vec2', 'vec3', 'vec4'].includes(ret) ? `${name}() returns ${ret === 'void' ? 'nothing' : `a ${ret}`}`
      : params.some(p => p.qual !== 'in') ? `${name}() gives values back through out parameters`
      : params.some(p => !['float', 'int', 'vec2', 'vec3', 'vec4'].includes(p.type)) ? `${name}() takes a ${params.find(p => !['float', 'int', 'vec2', 'vec3', 'vec4'].includes(p.type))!.type}`
      : !hUnits.length || hUnits[hUnits.length - 1].ast.type !== 'return_statement' ? `${name}() doesn’t end with a return`
      : earlyReturn ? `${name}() returns early (line ${earlyReturn.lines[0]})`
      : acc.discard ? `${name}() discards pixels`
      : acc.uses.has('gl_FragColor') || acc.writes.has('gl_FragColor') ? `${name}() writes the colour itself`
      : [...acc.writes].some(w => globals.has(w)) ? `${name}() changes a global variable`
      : true;
    const direct = new RegExp(`\\b${name}\\s*\\(`);
    return {
      name, lines, calls: callsOf.get(name) ?? new Set(), outParams: outParams.get(name) ?? new Set(), params, ret,
      start: loc.start.offset, end: trimEnd(norm, loc.end.offset), header: norm.slice(loc.start.offset, bodyStart), units: hUnits, localTypes: types, openable,
      callers: units.filter(u => !u.setup && direct.test(u.text)).map(u => u.index),
    };
  });
  return { ok: true, source, norm, toSourceLine, units, helpers, mainStart: mainLoc.start.offset, mainEnd: trimEnd(norm, mainLoc.end.offset), localTypes, uniforms, names, globals };
}

/** `end` moved back over trailing blanks. */
function trimEnd(text: string, end: number): number { let e = end; while (e > 0 && /\s/.test(text[e - 1])) e--; return e; }

/**
 * The units a selection of pasted lines [from, to] takes: the statements of main() it overlaps that
 * no step has yet. A selection inside a helper opened as a group (`open`) takes the statements of its
 * body (`fn` names it); inside any other helper, the statements of main() that call it (`via` names it).
 */
export function unitsForLines(
  a: Analysis, from: number, to: number, taken: ReadonlySet<number>,
  open?: { has(fn: string): boolean; taken(fn: string): ReadonlySet<number> },
): { units: number[]; via?: string; fn?: string } {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const free = (u: Unit) => !u.setup && !taken.has(u.index);
  const direct = a.units.filter(u => free(u) && u.lines[1] >= lo && u.lines[0] <= hi).map(u => u.index);
  if (direct.length) return { units: direct };
  const helper = a.helpers.find(h => h.lines[0] <= lo && h.lines[1] >= hi) ?? a.helpers.find(h => h.lines[1] >= lo && h.lines[0] <= hi);
  if (!helper) return { units: [] };
  if (open?.has(helper.name)) {
    const mine = open.taken(helper.name);
    return { units: helper.units.filter(u => !mine.has(u.index) && u.lines[1] >= lo && u.lines[0] <= hi).map(u => u.index), fn: helper.name };
  }
  return { units: a.units.filter(u => free(u) && u.calls.has(helper.name)).map(u => u.index), via: helper.name };
}

/** The statements of a scope: main() (no `fn`) or a helper's body. */
export function scopeUnits(a: Analysis, fn?: string): Unit[] {
  return fn ? a.helpers.find(h => h.name === fn)?.units ?? [] : a.units;
}

/** How many of the shader's lines (in main(), setup excluded) the given units cover, out of all. */
export function lineShare(a: Analysis, units: Iterable<number>): { done: number; total: number } {
  const count = (u: Unit) => u.lines[1] - u.lines[0] + 1;
  const counted = a.units.filter(u => !u.setup);
  const set = new Set(units);
  return { done: counted.filter(u => set.has(u.index)).reduce((s, u) => s + count(u), 0), total: counted.reduce((s, u) => s + count(u), 0) };
}
