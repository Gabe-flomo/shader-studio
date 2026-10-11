/**
 * A small GLSL interpreter on the CPU, for checking that two fragment shaders compute the same colour
 * (Guided Convert's staged shader against the original, in the tests: docs/guided-convert.md, "How the
 * remainder stays compilable"). Whole programs: functions with in / out / inout parameters, for / while
 * loops, if, return, break, continue, discard, swizzles read and written, arrays with a fixed size,
 * float, int (as numbers), vec2–vec4 and mat2. Built-ins are glslPatterns/evaluate's. Not a GLSL
 * implementation: no textures, mat3/mat4 or structs, and int division is float division.
 */
import { parser } from '@shaderfrog/glsl-parser';
import { callBuiltin, mulValues, type Value } from '../glslPatterns/evaluate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ast = Record<string, any> & { type: string };
type V = Value | Value[] | boolean;

class Return { value: V | undefined; constructor(value: V | undefined) { this.value = value; } }
class Break {}
class Continue {}
class Discard {}

const SWZ = 'xyzwrgbastpq';
const swz = (c: string) => SWZ.indexOf(c) % 4;
const isArr = (v: V): v is number[] => Array.isArray(v);
const num = (v: V): number => (typeof v === 'boolean' ? Number(v) : (v as number));

function tokenOf(n: Ast | undefined): string {
  if (!n) return '';
  if (n.type === 'keyword') return n.token as string;
  if (n.type === 'type_specifier') return tokenOf(n.specifier as Ast);
  if (n.type === 'type_name') return n.identifier as string;
  return (n.token ?? n.identifier ?? '') as string;
}
function calleeName(call: Ast): string {
  const id = call.identifier as Ast;
  if (id.type === 'type_specifier') { const s = id.specifier as Ast; return (s?.identifier ?? s?.token ?? '') as string; }
  return id.identifier as string;
}
const zeroOf = (t: string): Value => (t === 'vec2' ? [0, 0] : t === 'vec3' ? [0, 0, 0] : t === 'vec4' ? [0, 0, 0, 0] : t === 'mat2' ? [NaN, 1, 0, 0, 1] : 0);
const copy = (v: V): V => (Array.isArray(v) ? (v as Value[]).map(x => copy(x as V)) as V : v);

interface Fn { name: string; params: { name: string; type: string; qual: string }[]; body: Ast; ret: string }

export interface CpuInputs { resolution: [number, number]; time: number; mouse?: [number, number]; uniforms?: Record<string, Value> }

/** A parsed program, run once per pixel with `run`. */
export class CpuShader {
  private fns = new Map<string, Fn[]>();
  private globalsAst: Ast[] = [];
  constructor(source: string) {
    const ast = parser.parse(source, { quiet: true }) as unknown as { program: Ast[] };
    for (const st of ast.program) {
      if (st.type === 'function') {
        const h = (st.prototype as Ast).header as Ast;
        const name = (h.name as Ast).identifier as string;
        const params = (((st.prototype as Ast).parameters as Ast[] | undefined) ?? []).filter(p => p.type !== 'literal').map(p => {
          const qual = ((p.qualifier as Ast[] | undefined) ?? []).map(q => q.token as string).find(q => q === 'out' || q === 'inout') ?? 'in';
          const decl = (p.declaration ?? p) as Ast;
          const type = tokenOf((decl.specifier ?? p.specifier) as Ast);
          const id = (decl.identifier as Ast)?.identifier as string;
          return { name: id, type, qual };
        }).filter(p => p.type !== 'void');
        const fn: Fn = { name, params, body: st.body as Ast, ret: tokenOf((h.returnType as Ast).specifier as Ast) };
        this.fns.set(name, [...(this.fns.get(name) ?? []), fn]);
      } else if (st.type === 'declaration_statement') this.globalsAst.push(st);
    }
  }

  /** gl_FragColor at a pixel (null where the shader discards). */
  run(fragCoord: [number, number], inputs: CpuInputs): number[] | null {
    const scopes: Map<string, V>[] = [new Map()];
    const g = scopes[0];
    g.set('gl_FragCoord', [fragCoord[0], fragCoord[1], 0.5, 1]);
    g.set('gl_FragColor', [0, 0, 0, 0]);
    g.set('u_resolution', [...inputs.resolution]);
    g.set('u_time', inputs.time);
    g.set('u_mouse', [...(inputs.mouse ?? [0, 0])]);
    g.set('vUv', [fragCoord[0] / inputs.resolution[0], fragCoord[1] / inputs.resolution[1]]);
    g.set('PI', Math.PI); g.set('TAU', Math.PI * 2);
    for (const [k, v] of Object.entries(inputs.uniforms ?? {})) g.set(k, v);
    const ctx = new Exec(this.fns, scopes);
    for (const st of this.globalsAst) {
      const decl = st.declaration as Ast;
      if (decl.type === 'precision' || !decl.declarations) continue;
      const quals = ((decl.specified_type as Ast)?.qualifiers as Ast[] | undefined) ?? [];
      if (quals.some(q => q.token === 'uniform' || q.token === 'varying' || q.token === 'in' || q.token === 'out')) {
        for (const d of decl.declarations as Ast[]) { const n = (d.identifier as Ast).identifier as string; if (!g.has(n)) g.set(n, zeroOf(tokenOf((decl.specified_type as Ast).specifier as Ast))); }
        continue;
      }
      ctx.stmt(st);
    }
    const main = this.fns.get('main')?.[0];
    if (!main) throw new Error('cpuGlsl: no main()');
    try { ctx.block(main.body); }
    catch (e) { if (e instanceof Discard) return null; if (!(e instanceof Return)) throw e; }
    return [...(g.get('gl_FragColor') as number[])];
  }
}

class Exec {
  private fns: Map<string, Fn[]>;
  private scopes: Map<string, V>[];
  constructor(fns: Map<string, Fn[]>, scopes: Map<string, V>[]) { this.fns = fns; this.scopes = scopes; }
  private find(name: string): Map<string, V> {
    for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return this.scopes[i];
    throw new Error(`cpuGlsl: ${name} is not declared`);
  }
  get(name: string): V { return this.find(name).get(name)!; }
  block(b: Ast): void {
    this.scopes.push(new Map());
    try { for (const s of (b.statements as Ast[]) ?? []) this.stmt(s); } finally { this.scopes.pop(); }
  }
  stmt(s: Ast): void {
    switch (s.type) {
      case 'compound_statement': this.block(s); return;
      case 'declaration_statement': {
        const decl = s.declaration as Ast;
        if (decl.type === 'precision') return;
        const t = tokenOf((decl.specified_type as Ast).specifier as Ast);
        const arr = ((decl.specified_type as Ast).specifier as Ast)?.quantifier as Ast[] | undefined;
        for (const d of (decl.declarations as Ast[]) ?? []) {
          const name = (d.identifier as Ast).identifier as string;
          const q = (d.quantifier as Ast[] | undefined) ?? arr;
          let v: V;
          if (q?.length) {
            const n = num(this.expr((q[0].expression as Ast)) as V);
            v = d.initializer ? copy(this.expr(d.initializer as Ast)) : Array.from({ length: n }, () => zeroOf(t)) as V;
          } else v = d.initializer ? this.conv(t, copy(this.expr(d.initializer as Ast))) : zeroOf(t);
          const top = this.scopes[this.scopes.length - 1];
          if (top.has(name) && this.scopes.length > 1) throw new Error(`cpuGlsl: ${name} is declared twice in one scope`);
          top.set(name, v);
        }
        return;
      }
      case 'expression_statement': if (s.expression) this.expr(s.expression as Ast); return;
      case 'if_statement': {
        if (num(this.expr(s.condition as Ast))) this.stmt(s.body as Ast);
        else {
          const raw = s.else as Ast | Ast[] | undefined;
          const els = Array.isArray(raw) ? raw.filter(x => x.type !== 'keyword' && x.type !== 'literal').pop() : raw;
          if (els && els.type !== 'literal' && els.type !== 'keyword') this.stmt(els);
          else if (s.elseBody) this.stmt(s.elseBody as Ast);
        }
        return;
      }
      case 'for_statement': {
        this.scopes.push(new Map());
        try {
          if (s.init) { if (s.init.type === 'declaration_statement' || s.init.type === 'expression_statement') this.stmt(s.init as Ast); else if (s.init.type === 'declarator_list') this.stmt({ type: 'declaration_statement', declaration: s.init } as Ast); else this.expr(s.init as Ast); }
          for (let guard = 0; ; guard++) {
            if (guard > 100000) throw new Error('cpuGlsl: loop runs away');
            if (s.condition && !num(this.cond(s.condition as Ast))) break;
            try { this.stmt(s.body as Ast); } catch (e) { if (e instanceof Break) break; if (!(e instanceof Continue)) throw e; }
            if (s.operation) this.expr(s.operation as Ast);
          }
        } finally { this.scopes.pop(); }
        return;
      }
      case 'while_statement': {
        for (let guard = 0; ; guard++) {
          if (guard > 100000) throw new Error('cpuGlsl: loop runs away');
          if (!num(this.cond(s.condition as Ast))) break;
          try { this.stmt(s.body as Ast); } catch (e) { if (e instanceof Break) break; if (!(e instanceof Continue)) throw e; }
        }
        return;
      }
      case 'return_statement': throw new Return(s.expression ? this.expr(s.expression as Ast) : undefined);
      case 'break_statement': throw new Break();
      case 'continue_statement': throw new Continue();
      case 'discard_statement': throw new Discard();
      default: throw new Error(`cpuGlsl: statement ${s.type}`);
    }
  }
  /** A loop condition: an expression, or a declaration `bool b = …` (rare). */
  private cond(c: Ast): V { return c.type === 'condition_expression' ? this.expr(c.expression as Ast) : this.expr(c); }
  private conv(t: string, v: V): V { return t === 'int' && typeof v === 'number' ? Math.trunc(v) : v; }

  /** Write `v` to an lvalue. */
  private assign(l: Ast, v: V): void {
    if (l.type === 'group') return this.assign(l.expression as Ast, v);
    if (l.type === 'identifier') { const sc = this.find(l.identifier as string); sc.set(l.identifier as string, v); return; }
    if (l.type === 'postfix') {
      const pf = l.postfix as Ast;
      const base = copy(this.expr(l.expression as Ast));
      if (pf.type === 'field_selection') {
        const sel = (pf.selection as Ast).identifier as string;
        const arr = base as number[];
        if (sel.length === 1) arr[swz(sel)] = num(v); else [...sel].forEach((c, i) => { arr[swz(c)] = (v as number[])[i]; });
        return this.assign(l.expression as Ast, arr);
      }
      if (pf.type === 'quantifier') {
        const i = num(this.expr((pf.expression as Ast)));
        (base as V[])[i] = v as never;
        return this.assign(l.expression as Ast, base);
      }
    }
    throw new Error(`cpuGlsl: can't assign to ${l.type}`);
  }

  expr(e: Ast): V {
    switch (e.type) {
      case 'float_constant': return Number(String(e.token).replace(/[fF]$/, ''));
      case 'int_constant': return Number.parseInt(String(e.token), /^0x/i.test(String(e.token)) ? 16 : 10);
      case 'bool_constant': return e.token === 'true';
      case 'identifier': return this.get(e.identifier as string);
      case 'group': return this.expr(e.expression as Ast);
      case 'ternary': return num(this.expr(e.expression as Ast)) ? this.expr(e.left as Ast) : this.expr(e.right as Ast);
      case 'unary': {
        const op = (e.operator as Ast).literal as string;
        if (op === '++' || op === '--') { const v = this.inc(e.expression as Ast, op === '++' ? 1 : -1); return v; }
        const v = this.expr(e.expression as Ast);
        if (op === '-') return (isArr(v) ? v.map(x => -x) : -num(v)) as V;
        if (op === '!') return !num(v);
        return v;
      }
      case 'postfix': {
        const pf = e.postfix as Ast;
        const lit = pf.literal ?? (pf.operator as Ast)?.literal;
        if (lit === '++' || lit === '--') { const before = this.expr(e.expression as Ast); this.inc(e.expression as Ast, lit === '++' ? 1 : -1); return before; }
        const base = this.expr(e.expression as Ast);
        if (pf.type === 'field_selection') {
          const sel = (pf.selection as Ast).identifier as string;
          const comps = [...sel].map(c => (isArr(base) ? (base as number[])[swz(c)] : num(base)));
          return comps.length === 1 ? comps[0] : comps;
        }
        if (pf.type === 'quantifier') return (base as V[])[num(this.expr(pf.expression as Ast))] as V;
        throw new Error(`cpuGlsl: postfix ${pf.type}`);
      }
      case 'assignment': {
        const op = (e.operator as Ast).literal as string;
        const r = this.expr(e.right as Ast);
        const v = op === '=' ? copy(r) : this.bin(op.slice(0, -1), this.expr(e.left as Ast), r);
        this.assign(e.left as Ast, v);
        return v;
      }
      case 'binary': {
        const op = (e.operator as Ast).literal as string;
        if (op === ',') { this.expr(e.left as Ast); return this.expr(e.right as Ast); }
        if (op === '&&') return !!num(this.expr(e.left as Ast)) && !!num(this.expr(e.right as Ast));
        if (op === '||') return !!num(this.expr(e.left as Ast)) || !!num(this.expr(e.right as Ast));
        return this.bin(op, this.expr(e.left as Ast), this.expr(e.right as Ast));
      }
      case 'function_call': return this.call(e);
      default: throw new Error(`cpuGlsl: expression ${e.type}`);
    }
  }
  private inc(target: Ast, d: number): V {
    const v = this.expr(target);
    const nv = (isArr(v) ? v.map(x => x + d) : num(v) + d) as V;
    this.assign(target, nv);
    return nv;
  }
  private bin(op: string, a: V, b: V): V {
    const m = (f: (x: number, y: number) => number): V => {
      if (isArr(a) && isArr(b)) return a.map((x, i) => f(x, (b as number[])[i]));
      if (isArr(a)) return a.map(x => f(x, num(b)));
      if (isArr(b)) return (b as number[]).map(y => f(num(a), y));
      return f(num(a), num(b));
    };
    switch (op) {
      case '+': return m((x, y) => x + y);
      case '-': return m((x, y) => x - y);
      case '*': return mulValues(a as Value, b as Value) as V;
      case '/': return m((x, y) => x / y);
      case '<': return num(a) < num(b); case '>': return num(a) > num(b);
      case '<=': return num(a) <= num(b); case '>=': return num(a) >= num(b);
      case '==': return isArr(a) ? a.every((x, i) => x === (b as number[])[i]) : num(a) === num(b);
      case '!=': return isArr(a) ? a.some((x, i) => x !== (b as number[])[i]) : num(a) !== num(b);
      case '%': return m((x, y) => x % y);
      default: throw new Error(`cpuGlsl: operator ${op}`);
    }
  }
  private call(e: Ast): V {
    const name = calleeName(e);
    const argAsts = ((e.args as Ast[] | undefined) ?? []).filter(a => a.type !== 'literal');
    const user = this.fns.get(name)?.find(f => f.params.length === argAsts.length);
    if (user) {
      const vals = argAsts.map((a, i) => (user.params[i].qual === 'out' ? zeroOf(user.params[i].type) : copy(this.expr(a))));
      const frame = new Map<string, V>();
      user.params.forEach((p, i) => frame.set(p.name, this.conv(p.type, vals[i] as V)));
      // A function sees globals and its own frame only.
      const saved = this.scopes.splice(1);
      this.scopes.push(frame);
      let ret: V | undefined;
      // The body shares the parameters' scope (GLSL: redeclaring a parameter there is an error).
      try { for (const st of (user.body.statements as Ast[]) ?? []) this.stmt(st); } catch (x) { if (x instanceof Return) ret = x.value; else { this.scopes.splice(1); this.scopes.push(...saved); throw x; } }
      const outs = user.params.map(p => frame.get(p.name)!);
      this.scopes.splice(1); this.scopes.push(...saved);
      user.params.forEach((p, i) => { if (p.qual !== 'in') this.assign(argAsts[i], outs[i]); });
      return ret === undefined ? 0 : this.conv(user.ret, ret);
    }
    const args = argAsts.map(a => this.expr(a));
    if (name === 'int') return Math.trunc(num(args[0]));
    if (name === 'bool') return !!num(args[0]);
    if (name === 'float') return num(Array.isArray(args[0]) ? (args[0] as number[])[0] : args[0]);
    return callBuiltin(name, args.map(a => (typeof a === 'boolean' ? Number(a) : a)) as Value[]) as V;
  }
}

/** Sample both shaders on a grid; the largest difference of any colour component (Infinity when only one discards). */
export function maxDifference(a: string, b: string, inputs: CpuInputs, grid: [number, number] = [6, 5]): number {
  const A = new CpuShader(a), B = new CpuShader(b);
  let max = 0;
  for (let j = 0; j < grid[1]; j++) for (let i = 0; i < grid[0]; i++) {
    const p: [number, number] = [(i + 0.5) * inputs.resolution[0] / grid[0], (j + 0.5) * inputs.resolution[1] / grid[1]];
    const ca = A.run(p, inputs), cb = B.run(p, inputs);
    if (!ca || !cb) { if (ca !== cb) return Infinity; continue; }
    for (let k = 0; k < 4; k++) {
      if (Number.isNaN(ca[k]) || Number.isNaN(cb[k])) { if (Number.isNaN(ca[k]) !== Number.isNaN(cb[k])) return Infinity; continue; }
      max = Math.max(max, Math.abs(ca[k] - cb[k]));
    }
  }
  return max;
}
