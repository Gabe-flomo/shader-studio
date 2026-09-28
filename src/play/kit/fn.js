/**
 * fn.js — the Function mapping source: a one-line formula over time, compiled
 * to a closure without `eval`/`new Function` (docs/play-v1-plan.md, "Sources").
 * The logic both the Play engine (lib/playEngine.ts) and the web runtime
 * (runtime/play-runtime.js, through the inlined kit as SSKit.fn) run, so a
 * setup reads the same in the app, in a take and on a website: same `t`
 * (and so the same `b`) in, same number out, every time.
 *
 *   fnCompile   parses an expression once into an AST, then into a closure
 *               (vars) => number; memoised by expression text, so a mapping
 *               that isn't being edited compiles once and just calls the
 *               closure every frame
 *   fnEval      fnCompile then call, with a sane 0 for a parse or runtime
 *               problem (NaN, Infinity) instead of breaking the picture
 *
 * Variables: `t` seconds since play start (the timeline's time), `b` beats
 * at a fixed 120 BPM (quarter notes per second, so `b = t * 2`), `pi`, `tau`.
 * Operators `+ - * / % ^` (right-associative `^`), unary minus, parentheses,
 * and the functions in FN1/FN2/FN3 below, plus `noise(x)` (smoothed 1D value
 * noise) and `rand(x)` (a hash): both pure functions of `x` alone, so two
 * calls with the same `x` always agree, in the editor and in a take.
 *
 * Top-level names start with `fn` (the kit's files share one scope in exports).
 */

// ── The vocabulary (also read by the mapping row's hint and its "new name" check) ──

/** Names an expression may use besides its own knobs-that-never-were: just these four. */
export const FN_VAR_NAMES = ['t', 'b', 'pi', 'tau'];

const FN1 = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  fract: x => x - Math.floor(x),
  sqrt: Math.sqrt, exp: Math.exp, log: Math.log, sign: Math.sign,
  noise: fnNoise, rand: fnRand,
};
const FN2 = {
  atan2: Math.atan2, pow: Math.pow, min: Math.min, max: Math.max,
  mod: (x, y) => x - y * Math.floor(x / y),
  step: (edge, x) => (x < edge ? 0 : 1),
};
const FN3 = {
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  mix: (a, b, u) => a + (b - a) * u,
  smoothstep: (e0, e1, x) => { const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-9))); return u * u * (3 - 2 * u); },
};
const FN_ARITY = new Map([
  ...Object.keys(FN1).map(k => [k, 1]),
  ...Object.keys(FN2).map(k => [k, 2]),
  ...Object.keys(FN3).map(k => [k, 3]),
]);
/** Every function name an expression may call, for the hint line. */
export const FN_FUNC_NAMES = [...FN_ARITY.keys()];

function fnHash(n) { const x = Math.sin(n * 12.9898) * 43758.5453123; return x - Math.floor(x); }
/** A new random value at `x` (no interpolation): a hash, not noise. */
function fnRand(x) { return fnHash(x * 0.6180339887498949 + 7.137); }
/** Smoothed 1D value noise at `x`: eased between the hashes of the two lattice points around it. */
function fnNoise(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const a = fnHash(i), b = fnHash(i + 1);
  return a + (b - a) * u;
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

const PUNCT = new Set(['(', ')', ',', '+', '-', '*', '/', '%', '^']);

function fnTokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c >= '0' && c <= '9' || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i, sawDot = false;
      while (j < n && (src[j] >= '0' && src[j] <= '9' || (src[j] === '.' && !sawDot && (sawDot = true)))) j++;
      toks.push({ type: 'num', value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[a-zA-Z0-9_]/.test(src[j])) j++;
      toks.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (PUNCT.has(c)) { toks.push({ type: c }); i++; continue; }
    throw new Error(`Can't use "${c}" here`);
  }
  toks.push({ type: 'eof' });
  return toks;
}

// ── Parser: recursive descent → a plain AST ─────────────────────────────────
// expr  := add
// add   := mul (('+' | '-') mul)*
// mul   := unary (('*' | '/' | '%') unary)*
// unary := '-' unary | pow
// pow   := primary ('^' unary)?              (right-associative)
// primary := number | ident | ident '(' (expr (',' expr)*)? ')' | '(' expr ')'

function fnParse(src) {
  const toks = fnTokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const at = type => toks[p].type === type;
  const eat = type => { if (!at(type)) throw new Error(`Expected "${type}"`); return toks[p++]; };

  function parseExpr() { return parseAdd(); }
  function parseAdd() {
    let node = parseMul();
    while (at('+') || at('-')) { const op = toks[p++].type; node = { type: 'bin', op, a: node, b: parseMul() }; }
    return node;
  }
  function parseMul() {
    let node = parseUnary();
    while (at('*') || at('/') || at('%')) { const op = toks[p++].type; node = { type: 'bin', op, a: node, b: parseUnary() }; }
    return node;
  }
  function parseUnary() {
    if (at('-')) { p++; return { type: 'neg', a: parseUnary() }; }
    if (at('+')) { p++; return parseUnary(); }
    return parsePow();
  }
  function parsePow() {
    const node = parsePrimary();
    if (at('^')) { p++; return { type: 'bin', op: '^', a: node, b: parseUnary() }; }
    return node;
  }
  function parsePrimary() {
    const t = peek();
    if (t.type === 'num') { p++; return { type: 'num', value: t.value }; }
    if (t.type === '(') { p++; const node = parseExpr(); eat(')'); return node; }
    if (t.type === 'ident') {
      p++;
      if (at('(')) {
        p++;
        const args = [];
        if (!at(')')) { args.push(parseExpr()); while (at(',')) { p++; args.push(parseExpr()); } }
        eat(')');
        return { type: 'call', name: t.value, args };
      }
      return { type: 'var', name: t.value };
    }
    throw new Error(t.type === 'eof' ? 'Expression ends too soon' : `Unexpected "${t.type}"`);
  }

  const node = parseExpr();
  if (!at('eof')) throw new Error(`Unexpected "${peek().type === 'eof' ? '' : peek().value ?? peek().type}"`);
  return node;
}

// ── Compile: AST → closure, no eval/new Function ────────────────────────────

function fnCompileNode(node) {
  switch (node.type) {
    case 'num': { const v = node.value; return () => v; }
    case 'var': {
      const name = node.name;
      if (name === 't') return vars => vars.t;
      if (name === 'b') return vars => vars.b;
      if (name === 'pi') return () => Math.PI;
      if (name === 'tau') return () => Math.PI * 2;
      throw new Error(`"${name}" isn't a name this can use`);
    }
    case 'neg': { const a = fnCompileNode(node.a); return vars => -a(vars); }
    case 'bin': {
      const a = fnCompileNode(node.a), b = fnCompileNode(node.b);
      switch (node.op) {
        case '+': return vars => a(vars) + b(vars);
        case '-': return vars => a(vars) - b(vars);
        case '*': return vars => a(vars) * b(vars);
        case '/': return vars => a(vars) / b(vars);
        case '%': return vars => a(vars) % b(vars);
        case '^': return vars => Math.pow(a(vars), b(vars));
        default: throw new Error(`Unknown operator "${node.op}"`);
      }
    }
    case 'call': {
      const arity = FN_ARITY.get(node.name);
      if (arity === undefined) throw new Error(`"${node.name}" isn't a function this can use`);
      if (node.args.length !== arity) throw new Error(`${node.name}(…) takes ${arity} argument${arity === 1 ? '' : 's'}`);
      const fn = FN1[node.name] || FN2[node.name] || FN3[node.name];
      const args = node.args.map(fnCompileNode);
      if (arity === 1) { const [x] = args; return vars => fn(x(vars)); }
      if (arity === 2) { const [x, y] = args; return vars => fn(x(vars), y(vars)); }
      const [x, y, z] = args; return vars => fn(x(vars), y(vars), z(vars));
    }
    default: throw new Error('Bad expression');
  }
}

const fnCache = new Map();

/**
 * `expr` compiled to a closure `(vars) => number` (`vars.t`, `vars.b`), once
 * per distinct expression text. `error` is a short message for the row when
 * `expr` doesn't parse; `fn` is then a stand-in that always returns 0.
 */
export function fnCompile(expr) {
  const src = typeof expr === 'string' ? expr.trim() : '';
  const cached = fnCache.get(src);
  if (cached) return cached;
  let out;
  if (!src) {
    out = { fn: () => 0, error: null };
  } else {
    try {
      out = { fn: fnCompileNode(fnParse(src)), error: null };
    } catch (e) {
      out = { fn: () => 0, error: e && e.message ? e.message : 'Bad expression' };
    }
  }
  // A steady cache would grow forever if callers built expr strings per frame;
  // every real caller here passes what's stored on the mapping, so a handful
  // of distinct strings is the normal case, and clearing at a round number
  // costs one recompile if the same odd shape keeps getting built live.
  if (fnCache.size > 500) fnCache.clear();
  fnCache.set(src, out);
  return out;
}

/**
 * `expr` evaluated at `vars` (`{ t, b }`): `value` is always a finite number
 * (a parse error, or a runtime one like `1/0`'s Infinity, reads as 0), and
 * `error` is set exactly when `value` isn't what the line asked for.
 */
export function fnEval(expr, vars) {
  const { fn, error } = fnCompile(expr);
  if (error) return { value: 0, error };
  try {
    const v = fn(vars);
    return Number.isFinite(v) ? { value: v, error: null } : { value: 0, error: null };
  } catch (e) {
    return { value: 0, error: e && e.message ? e.message : 'Bad expression' };
  }
}
