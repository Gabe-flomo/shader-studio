/**
 * Runs whole fragment shaders on the CPU (test helper only), for the Grid Rules tests: the
 * compiled board programs are stepped cell by cell on small boards and compared with a CPU
 * reference, so the tests check the GLSL itself.
 *
 * The subset is glslEval.ts's (declarations, assignments, if / else, blocks, ?:, swizzles,
 * float / vec arithmetic with broadcasting) plus what a whole program needs: top-level function
 * definitions with `return`, `for` loops, `++`, `const` globals, and the preprocessor, precision,
 * uniform and varying lines skipped. Ints are numbers. texture2D reads a CPU board, nearest.
 */
export type Val = number | number[] | boolean | string;
type Fn = (...a: Val[]) => Val;
export type Env = Record<string, Val | Fn>;
type Tok = { t: 'num' | 'id' | 'op'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\d+\.\d*(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?|\d+(?:e[-+]?\d+)?u?|0x[0-9a-fA-F]+u?)|([A-Za-z_]\w*)|(\+\+|--|\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||[-+*/%<>=!?:;,.(){}[\]]))/gy;
  let m: RegExpExecArray | null;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1]) continue;
    if (m[2]) out.push({ t: 'num', v: m[2].replace(/u$/, '') });
    else if (m[3]) out.push({ t: 'id', v: m[3] });
    else if (m[4]) out.push({ t: 'op', v: m[4] });
    else if (/^\s*$/.test(src.slice(re.lastIndex))) break;
  }
  return out;
}

const TYPES = new Set(['float', 'vec2', 'vec3', 'vec4', 'bool', 'int', 'void', 'mat2', 'sampler2D']);
const COMP: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };

const map2 = (a: Val, b: Val, f: (x: number, y: number) => number): Val => {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => f(x, b[i]));
  if (Array.isArray(a)) return a.map(x => f(x, b as number));
  if (Array.isArray(b)) return b.map(y => f(a as number, y));
  return f(a as number, b as number);
};
const map1 = (a: Val, f: (x: number) => number): Val => (Array.isArray(a) ? a.map(f) : f(a as number));
const map3 = (a: Val, b: Val, c: Val, f: (x: number, y: number, z: number) => number): Val => {
  const n = [a, b, c].find(Array.isArray) as number[] | undefined;
  if (!n) return f(a as number, b as number, c as number);
  const at = (v: Val, i: number) => (Array.isArray(v) ? v[i] : v as number);
  return n.map((_, i) => f(at(a, i), at(b, i), at(c, i)));
};
function ctor(n: number, a: Val[]): number[] {
  const flat = a.flatMap(v => (Array.isArray(v) ? v : [Number(v)]));
  return flat.length === 1 ? Array(n).fill(flat[0]) : flat.slice(0, n);
}
const fract = (x: number) => x - Math.floor(x);
const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export const BUILTINS: Env = {
  vec2: (...a: Val[]) => ctor(2, a), vec3: (...a: Val[]) => ctor(3, a), vec4: (...a: Val[]) => ctor(4, a),
  float: (a: Val) => Number(a), int: (a: Val) => Math.trunc(Number(a)), bool: (a: Val) => !!a,
  sin: (a: Val) => map1(a, Math.sin), cos: (a: Val) => map1(a, Math.cos), tan: (a: Val) => map1(a, Math.tan),
  abs: (a: Val) => map1(a, Math.abs), sign: (a: Val) => map1(a, Math.sign), sqrt: (a: Val) => map1(a, Math.sqrt),
  fract: (a: Val) => map1(a, fract), floor: (a: Val) => map1(a, Math.floor), ceil: (a: Val) => map1(a, Math.ceil),
  exp: (a: Val) => map1(a, Math.exp), exp2: (a: Val) => map1(a, x => 2 ** x), log: (a: Val) => map1(a, Math.log),
  pow: (a: Val, b: Val) => map2(a, b, Math.pow),
  mod: (a: Val, b: Val) => map2(a, b, (x, y) => x - y * Math.floor(x / y)),
  min: (a: Val, b: Val) => map2(a, b, Math.min), max: (a: Val, b: Val) => map2(a, b, Math.max),
  clamp: (a: Val, lo: Val, hi: Val) => map2(map2(a, lo, Math.max), hi, Math.min),
  mix: (a: Val, b: Val, t: Val) => map3(a, b, t, (x, y, k) => x + (y - x) * k),
  step: (e: Val, x: Val) => map2(e, x, (ee, xx) => (xx < ee ? 0 : 1)),
  smoothstep: (e0: Val, e1: Val, x: Val) => map3(e0, e1, x, sstep),
  dot: (a: Val, b: Val) => (a as number[]).reduce((s, x, i) => s + x * (b as number[])[i], 0),
  length: (a: Val) => (Array.isArray(a) ? Math.hypot(...a) : Math.abs(a as number)),
  distance: (a: Val, b: Val) => Math.hypot(...(a as number[]).map((x, i) => x - (b as number[])[i])),
  normalize: (a: Val) => { const l = Math.hypot(...(a as number[])); return (a as number[]).map(x => x / l); },
  atan: (y: Val, x?: Val) => (x === undefined ? map1(y, Math.atan) : map2(y, x, Math.atan2)),
};

class Return { v: Val; constructor(v: Val) { this.v = v; } }
interface FnDef { params: string[]; start: number; end: number }

class Machine {
  i = 0;
  toks: Tok[];
  env: Env;
  fns: Map<string, FnDef>;
  constructor(toks: Tok[], env: Env, fns: Map<string, FnDef>) { this.toks = toks; this.env = env; this.fns = fns; }
  peek(o = 0) { return this.toks[this.i + o]; }
  next() { return this.toks[this.i++]; }
  eat(v: string) { const t = this.next(); if (!t || t.v !== v) throw new Error(`expected ${v}, got ${t?.v} at ${this.i}`); }
  is(v: string) { return this.peek()?.v === v; }

  stmt(run: boolean): void {
    const t = this.peek();
    if (t.v === ';') { this.next(); return; }
    if (t.v === '{') { this.next(); while (!this.is('}')) this.stmt(run); this.next(); return; }
    if (t.v === 'if') {
      this.next(); this.eat('(');
      const c = this.expr(run); this.eat(')');
      const take = run && !!c;
      this.stmt(take);
      if (this.is('else')) { this.next(); this.stmt(run && !take); }
      return;
    }
    if (t.v === 'for') { this.forLoop(run); return; }
    if (t.v === 'return') {
      this.next();
      const v = this.is(';') ? 0 : this.expr(run);
      this.eat(';');
      if (run) throw new Return(v);
      return;
    }
    if (t.v === 'const') this.next();
    if (t.t === 'id' && TYPES.has(this.peek().v) && this.peek(1)?.t === 'id') { this.decl(run); this.eat(';'); return; }
    this.simple(run);
    this.eat(';');
  }
  decl(run: boolean): void {
    this.next();
    for (;;) {
      const name = this.next().v;
      let v: Val = 0;
      if (this.is('=')) { this.next(); v = this.expr(run); }
      if (run) this.env[name] = v;
      if (this.is(',')) { this.next(); continue; }
      break;
    }
  }
  /** An assignment or ++ / -- (no trailing ;). */
  simple(run: boolean): void {
    const name = this.next().v;
    let comp: string | null = null;
    if (this.is('.')) { this.next(); comp = this.next().v; }
    const op = this.next().v;
    if (op === '++' || op === '--') { if (run) this.env[name] = (this.env[name] as number) + (op === '++' ? 1 : -1); return; }
    const rhs = this.expr(run);
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
  forLoop(run: boolean): void {
    this.next(); this.eat('(');
    if (TYPES.has(this.peek().v)) this.decl(run); else this.simple(run);
    this.eat(';');
    const condAt = this.i;
    let guard = 0;
    for (;;) {
      this.i = condAt;
      const c = this.expr(run);
      this.eat(';');
      const incAt = this.i;
      this.simple(false);
      this.eat(')');
      const go = run && !!c;
      this.stmt(go);
      const end = this.i;
      if (!go) { this.i = end; return; }
      this.i = incAt;
      this.simple(true);
      if (++guard > 100000) throw new Error('runaway loop');
      this.i = end;
    }
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
      const p = op !== undefined ? Machine.PREC[op] : undefined;
      if (p === undefined || p <= min) return a;
      this.next();
      // && and || don't evaluate their right side when the left decides (GLSL short-circuits).
      const skip = (op === '&&' && !a) || (op === '||' && !!a);
      const b = this.binary(p, run && !skip);
      a = Machine.op(op, a, b);
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
    if (this.is('-')) { this.next(); return map1(this.unary(run) as number, x => -x); }
    if (this.is('+')) { this.next(); return this.unary(run); }
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
      const user = this.fns.get(t.v);
      if (user) return this.call(user, args);
      const f = this.env[t.v] ?? BUILTINS[t.v];
      if (typeof f !== 'function') throw new Error(`no function ${t.v}`);
      return f(...args);
    }
    if (!run) return 0;
    const v = this.env[t.v] ?? BUILTINS[t.v];
    if (v === undefined) throw new Error(`undefined ${t.v}`);
    return v as Val;
  }
  call(fn: FnDef, args: Val[]): Val {
    const local: Env = Object.create(this.env);
    fn.params.forEach((p, k) => { local[p] = args[k]; });
    const m = new Machine(this.toks, local, this.fns);
    m.i = fn.start;
    try { while (m.i < fn.end) m.stmt(true); } catch (e) { if (e instanceof Return) return e.v; throw e; }
    return 0;
  }
}

export interface Program { run: (env: Env) => Env }

/** Parse a fragment shader once; `run` executes main() in `env` (uniforms, vUv, gl_FragCoord, texture2D…) and returns it. */
export function compileFragment(src: string): Program {
  const body = src.split('\n').filter(l => !/^\s*(#|precision\b|uniform\b|varying\b|attribute\b|out\s+vec4)/.test(l)).join('\n');
  const toks = lex(body);
  const fns = new Map<string, FnDef>();
  const globals: Array<[number, number]> = [];
  let i = 0;
  while (i < toks.length) {
    const isFn = TYPES.has(toks[i].v) && toks[i + 1]?.t === 'id' && toks[i + 2]?.v === '(';
    if (isFn) {
      const name = toks[i + 1].v;
      let j = i + 3;
      const params: string[] = [];
      while (toks[j].v !== ')') {
        if (toks[j].v === ',') { j++; continue; }
        while (['in', 'out', 'inout', 'highp', 'mediump', 'lowp', 'const'].includes(toks[j].v)) j++;
        j++; // type
        params.push(toks[j].v); j++;
      }
      j++; // )
      if (toks[j].v === ';') { i = j + 1; continue; } // a prototype
      let depth = 0;
      const start = j + 1;
      for (; j < toks.length; j++) { if (toks[j].v === '{') depth++; else if (toks[j].v === '}' && --depth === 0) break; }
      fns.set(name, { params, start, end: j });
      i = j + 1;
      continue;
    }
    const s = i;
    while (toks[i].v !== ';') i++;
    globals.push([s, i + 1]);
    i++;
  }
  const main = fns.get('main');
  if (!main) throw new Error('no main()');
  return {
    run(env: Env) {
      const m = new Machine(toks, env, fns);
      for (const [s, e] of globals) { m.i = s; while (m.i < e) m.stmt(true); }
      m.i = main.start;
      try { while (m.i < main.end) m.stmt(true); } catch (e) { if (!(e instanceof Return)) throw e; }
      return env;
    },
  };
}

// ── Boards: textures on the CPU ──────────────────────────────────────────────────────────────────

export interface Board { w: number; h: number; data: Float32Array; wrap: 'repeat' | 'clamp' }
export const makeBoard = (w: number, h: number, wrap: Board['wrap'] = 'repeat'): Board => ({ w, h, data: new Float32Array(w * h * 4), wrap });
export function texel(b: Board, x: number, y: number): number[] {
  const wx = b.wrap === 'repeat' ? ((x % b.w) + b.w) % b.w : Math.min(b.w - 1, Math.max(0, x));
  const wy = b.wrap === 'repeat' ? ((y % b.h) + b.h) % b.h : Math.min(b.h - 1, Math.max(0, y));
  const k = (wy * b.w + wx) * 4;
  return [b.data[k], b.data[k + 1], b.data[k + 2], b.data[k + 3]];
}
export function setTexel(b: Board, x: number, y: number, v: number[]): void {
  const k = (y * b.w + x) * 4;
  for (let c = 0; c < 4; c++) b.data[k + c] = v[c] ?? 0;
}
/** Nearest sampling at 0–1 coordinates, as a Nearest Pass texture. */
export const sampleNearest = (b: Board, uv: number[]) => texel(b, Math.floor(uv[0] * b.w), Math.floor(uv[1] * b.h));

/**
 * Draw one program over a board-sized target, as a pass: every cell runs main() with vUv and
 * gl_FragCoord at its centre; `samplers` maps sampler uniform names to boards. Returns the new board.
 */
export function drawPass(prog: Program, w: number, h: number, wrap: Board['wrap'], samplers: Record<string, Board>, uniforms: Env): Board {
  const out = makeBoard(w, h, wrap);
  const tex = (s: Val, uv: Val) => {
    const b = samplers[s as string];
    if (!b) throw new Error(`no board for sampler ${String(s)}`);
    return sampleNearest(b, uv as number[]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const env: Env = { ...uniforms, texture2D: tex, texture: tex, vUv: [(x + 0.5) / w, (y + 0.5) / h], gl_FragCoord: [x + 0.5, y + 0.5, 0, 1], gl_FragColor: [0, 0, 0, 0] };
    for (const k of Object.keys(samplers)) env[k] = k;
    prog.run(env);
    setTexel(out, x, y, env.gl_FragColor as number[]);
  }
  return out;
}
