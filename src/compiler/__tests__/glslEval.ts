/**
 * A tiny evaluator for the GLSL the Agents nodes emit (test helper only): the
 * statement and expression subset their generateGLSL writes (declarations,
 * assignments, if / else chains, blocks; float / vec / bool arithmetic with
 * broadcasting, swizzles, comparisons, ?:, and the built-ins they call).
 * It runs a node's real emitted code on the CPU, so the tests check the GLSL
 * itself rather than a copy of its maths.
 */
export type Val = number | number[] | boolean;
export type Env = Record<string, Val | ((...a: Val[]) => Val)>;

type Tok = { t: 'num' | 'id' | 'op'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\/\/[^\n]*)|(\d+\.\d*(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?|\d+(?:e[-+]?\d+)?u?|0x[0-9a-fA-F]+u?)|([A-Za-z_]\w*)|(\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||[-+*/%<>=!?:;,.(){}\[\]]))/gy;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1]) continue;
    if (m[2]) out.push({ t: 'num', v: m[2].replace(/u$/, '') });
    else if (m[3]) out.push({ t: 'id', v: m[3] });
    else if (m[4]) out.push({ t: 'op', v: m[4] });
    else if (/^\s*$/.test(src.slice(re.lastIndex))) break;
  }
  return out;
}

const TYPES = new Set(['float', 'vec2', 'vec3', 'vec4', 'bool', 'int', 'uint']);
const COMP: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };

const map2 = (a: Val, b: Val, f: (x: number, y: number) => number): Val => {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => f(x, b[i]));
  if (Array.isArray(a)) return a.map(x => f(x, b as number));
  if (Array.isArray(b)) return b.map(y => f(a as number, y));
  return f(a as number, b as number);
};
const map1 = (a: Val, f: (x: number) => number): Val => (Array.isArray(a) ? a.map(f) : f(a as number));

export const BUILTINS: Env = {
  vec2: (...a: Val[]) => ctor(2, a), vec3: (...a: Val[]) => ctor(3, a), vec4: (...a: Val[]) => ctor(4, a),
  float: (a: Val) => Number(a), int: (a: Val) => Math.trunc(Number(a)), bool: (a: Val) => !!a,
  radians: (a: Val) => map1(a, x => x * Math.PI / 180), cos: (a: Val) => map1(a, Math.cos), sin: (a: Val) => map1(a, Math.sin),
  abs: (a: Val) => map1(a, Math.abs), sign: (a: Val) => map1(a, Math.sign), sqrt: (a: Val) => map1(a, Math.sqrt),
  fract: (a: Val) => map1(a, x => x - Math.floor(x)), floor: (a: Val) => map1(a, Math.floor),
  exp: (a: Val) => map1(a, Math.exp),
  mod: (a: Val, b: Val) => map2(a, b, (x, y) => x - y * Math.floor(x / y)),
  min: (a: Val, b: Val) => map2(a, b, Math.min), max: (a: Val, b: Val) => map2(a, b, Math.max),
  clamp: (a: Val, lo: Val, hi: Val) => map2(map2(a, lo, Math.max), hi, Math.min),
  mix: (a: Val, b: Val, t: Val) => add(a, map2(map2(a, b, (x, y) => y - x), t, (d, k) => d * k)),
  dot: (a: Val, b: Val) => (a as number[]).reduce((s, x, i) => s + x * (b as number[])[i], 0),
  length: (a: Val) => (Array.isArray(a) ? Math.hypot(...a) : Math.abs(a as number)),
  normalize: (a: Val) => { const l = Math.hypot(...(a as number[])); return (a as number[]).map(x => x / l); },
  atan: (y: Val, x?: Val) => (x === undefined ? Math.atan(y as number) : Math.atan2(y as number, x as number)),
  greaterThan: (a: Val, b: Val) => (a as number[]).map((x, i) => x > (b as number[])[i]) as unknown as Val,
  lessThan: (a: Val, b: Val) => (a as number[]).map((x, i) => x < (b as number[])[i]) as unknown as Val,
  any: (a: Val) => (a as unknown as boolean[]).some(Boolean), isnan: (a: Val) => (a as number[]).map(Number.isNaN) as unknown as Val,
  isinf: (a: Val) => (a as number[]).map(x => !Number.isFinite(x) && !Number.isNaN(x)) as unknown as Val,
  agDir: (a: Val) => [Math.cos(a as number), Math.sin(a as number)],
};
function add(a: Val, b: Val): Val { return map2(a, b, (x, y) => x + y); }
function ctor(n: number, a: Val[]): number[] {
  const flat = a.flatMap(v => (Array.isArray(v) ? v : [Number(v)]));
  return flat.length === 1 ? Array(n).fill(flat[0]) : flat.slice(0, n);
}

class Parser {
  i = 0;
  private toks: Tok[];
  private env: Env;
  constructor(toks: Tok[], env: Env) { this.toks = toks; this.env = env; }
  peek(o = 0) { return this.toks[this.i + o]; }
  next() { return this.toks[this.i++]; }
  eat(v: string) { const t = this.next(); if (!t || t.v !== v) throw new Error(`expected ${v}, got ${t?.v}`); }
  is(v: string) { return this.peek()?.v === v; }

  // Statements run as they parse; `run` false skips (the untaken branch of an if).
  stmt(run: boolean): void {
    const t = this.peek();
    if (t.v === '{') { this.next(); while (!this.is('}')) this.stmt(run); this.next(); return; }
    if (t.v === 'if') {
      this.next(); this.eat('(');
      const c = this.expr(run); this.eat(')');
      const take = run && !!c;
      this.stmt(take);
      if (this.is('else')) { this.next(); this.stmt(run && !take); }
      return;
    }
    if (t.t === 'id' && TYPES.has(t.v)) {
      this.next();
      for (;;) {
        const name = this.next().v;
        let v: Val = 0;
        if (this.is('=')) { this.next(); v = this.expr(run); }
        if (run) this.env[name] = v;
        if (this.is(',')) { this.next(); continue; }
        break;
      }
      this.eat(';');
      return;
    }
    // Assignment: name[.swizzle] op expr
    const name = this.next().v;
    let comp: string | null = null;
    if (this.is('.')) { this.next(); comp = this.next().v; }
    const op = this.next().v;
    const rhs = this.expr(run);
    this.eat(';');
    if (!run) return;
    const cur = this.env[name] as Val;
    const apply = (a: Val, b: Val): Val => op === '=' ? b : op === '+=' ? map2(a, b, (x, y) => x + y) : op === '-=' ? map2(a, b, (x, y) => x - y) : op === '*=' ? map2(a, b, (x, y) => x * y) : map2(a, b, (x, y) => x / y);
    if (comp) {
      const arr = [...(cur as number[])];
      const idx = [...comp].map(c => COMP[c]);
      const vals = Array.isArray(rhs) ? rhs : idx.map(() => rhs as number);
      idx.forEach((k, j) => { arr[k] = apply(arr[k], vals[j]) as number; });
      this.env[name] = arr;
    } else this.env[name] = apply(cur, rhs);
  }

  expr(run: boolean): Val { return this.ternary(run); }
  ternary(run: boolean): Val {
    const c = this.binary(0, run);
    if (!this.is('?')) return c;
    this.next();
    const a = this.ternary(run && !!c); this.eat(':');
    const b = this.ternary(run && !c);
    return c ? a : b;
  }
  static PREC: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6 };
  binary(min: number, run: boolean): Val {
    let a = this.unary(run);
    for (;;) {
      const op = this.peek()?.v;
      const p = op !== undefined ? Parser.PREC[op] : undefined;
      if (p === undefined || p <= min) return a;
      this.next();
      const b = this.binary(p, run);
      a = Parser.op(op, a, b);
    }
  }
  static op(op: string, a: Val, b: Val): Val {
    switch (op) {
      case '+': return map2(a, b, (x, y) => x + y);
      case '-': return map2(a, b, (x, y) => x - y);
      case '*': return map2(a, b, (x, y) => x * y);
      case '/': return map2(a, b, (x, y) => x / y);
      case '<': return (a as number) < (b as number);
      case '>': return (a as number) > (b as number);
      case '<=': return (a as number) <= (b as number);
      case '>=': return (a as number) >= (b as number);
      case '==': return a === b;
      case '!=': return a !== b;
      case '&&': return !!a && !!b;
      case '||': return !!a || !!b;
    }
    throw new Error(op);
  }
  unary(run: boolean): Val {
    if (this.is('-')) { this.next(); return map1(this.unary(run), x => -x); }
    if (this.is('!')) { this.next(); return !this.unary(run); }
    return this.postfix(run);
  }
  postfix(run: boolean): Val {
    let v = this.primary(run);
    while (this.is('.')) {
      this.next();
      const sw = this.next().v;
      const arr = v as number[];
      v = sw.length === 1 ? (run ? arr?.[COMP[sw]] : 0) : (run ? [...sw].map(c => arr[COMP[c]]) : [0]);
    }
    return v;
  }
  primary(run: boolean): Val {
    const t = this.next();
    if (t.v === '(') { const v = this.expr(run); this.eat(')'); return v; }
    if (t.t === 'num') return t.v.startsWith('0x') ? parseInt(t.v, 16) : parseFloat(t.v);
    if (t.v === 'true') return true;
    if (t.v === 'false') return false;
    if (this.is('(')) {
      this.next();
      const args: Val[] = [];
      while (!this.is(')')) { args.push(this.expr(run)); if (this.is(',')) this.next(); }
      this.next();
      if (!run) return 0;
      const f = this.env[t.v] ?? BUILTINS[t.v];
      if (typeof f !== 'function') throw new Error(`no function ${t.v}`);
      return f(...args);
    }
    if (!run) return 0;
    const v = this.env[t.v] ?? BUILTINS[t.v];
    if (v === undefined) throw new Error(`undefined ${t.v}`);
    return v as Val;
  }
}

/** Run GLSL statements in `env` (variables and functions); returns env with what they declared. */
const lexed = new Map<string, Tok[]>();
export function runGlsl(code: string, env: Env): Env {
  // The same code run many times (a simulation's steps) is lexed once.
  let toks = lexed.get(code);
  if (!toks) { toks = lex(code); if (lexed.size > 200) lexed.clear(); lexed.set(code, toks); }
  const p = new Parser(toks, env);
  while (p.peek()) p.stmt(true);
  return env;
}
