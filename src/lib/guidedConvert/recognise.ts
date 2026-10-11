/**
 * Guided Convert, recognised patterns (docs/guided-convert.md, "Recognised patterns"): the idioms in a
 * statement that a library node draws, found with the Explain panel's matcher (glslPatterns). Each is
 * cut out of the statement as a call to a one-line function of its parts (`rc_circle(p, 0.3)`, whose
 * body is the matched code with the parts as parameters), so the staged shader still computes exactly
 * what the original does; the converter then makes that call the recipe's nodes (recipes.ts).
 *
 * A call to a helper is recognised too when the helper's body, inlined, is one of the idioms (a
 * `palette(t)` returning `a + b * cos(…)`), or is fractal noise (`fbm()`, offered as the FBM node only
 * when the pixel check says the picture stays the same, which it rarely does: the noise differs).
 */
import {
  allNodes, canonicalKey, formatNumber, idiomById, inferTypes, matchPattern, normalize, parseExpr, parseLine, printExpr, splitStatements, typesFromCode,
  type Bindings, type Expr, type GlslType, type IdiomText, type Role, type TypeEnv,
} from '../glslPatterns';
import type { Analysis, HelperFn, Unit } from './analyse';
import { FBM_RECIPE, RECIPES, type FbmShape, type Recipe } from './recipes';

type Ty = 'float' | 'vec2' | 'vec3' | 'vec4';
const TYS = new Set<string>(['float', 'vec2', 'vec3', 'vec4']);

/** Where an argument of the cut-out call comes from: a span of the shader's text (number chips apply inside), or text. */
export type ArgSource = { from: number; to: number } | { text: string };

export interface Recognition {
  /** Stable while the shader's text is: the scope, the statement, where in it, what. */
  id: string;
  /** The recipe (recipes.ts), or `fbm`. */
  kind: string;
  /** Which spelling matched (the recipe's own meaning; see recipes.ts). */
  variant: number;
  unit: number;
  /** The helper whose body the statement is in (absent: main()). */
  fn?: string;
  /** In words: "a soft disc", "palette() is a cosine palette". */
  what: string;
  /** The library node(s): "Circle SDF + SDF Mask". */
  node: string;
  exact: boolean;
  /** The text replaced by the call, in `Analysis.norm` (end exclusive). */
  start: number; end: number;
  /** Line in the pasted text. */
  line: number;
  /** The code matched, as written (one line, trimmed). */
  code: string;
  /** The one-line function: its type, parameters and body. */
  ret: Ty;
  params: { name: string; type: Ty }[];
  body: string;
  /** Each parameter's argument at the call, in order. */
  args: ArgSource[];
  /** `x *= M` rewritten as `x = f(x, …)`: the variable. */
  assign?: string;
  /** A whole helper call recognised: the helper. */
  helper?: string;
  /** For fbm: the octaves, gain and lacunarity read off the helper. */
  fbm?: FbmShape;
  /** Number chips inside the cut that no argument carries: the node takes their place. */
  swallowed: string[];
}

const SIDE_EFFECT = /(^|[^=!<>+\-*/])=(?!=)|\+\+|--|[+\-*/]=/;

/** Names a one-line function body may read besides its parameters. */
function allowedNames(a: Analysis): Set<string> {
  return new Set(['gl_FragCoord', ...a.uniforms.keys()]);
}

/** Identifiers an expression reads (callees aside). */
function identsIn(text: string): Set<string> | null {
  const r = parseExpr(text);
  if (!r.ok) return null;
  const out = new Set<string>();
  for (const n of allNodes(r.expr)) if (n.kind === 'ident') out.add(n.name);
  return out;
}

/** The type environment of a scope: its locals over the uniforms over what the whole shader declares. */
function envFor(a: Analysis, scope?: HelperFn): TypeEnv {
  const env: TypeEnv = { ...typesFromCode(a.norm) };
  for (const [k, t] of a.uniforms) env[k] = t as GlslType;
  for (const [k, t] of (scope?.localTypes ?? a.localTypes)) env[k] = t as GlslType;
  return env;
}

interface Hit { recipe: Recipe | null; variant: number; b: Bindings; holes: string[]; what?: string; node?: string; fbm?: FbmShape }

/** Bindings of `pattern` that also name the parts of a nested idiom (a saturate around an inverse mix). */
function nestedRemap(b: Bindings): Bindings | null {
  const x = b.x?.expr;
  if (!x) return null;
  return matchPattern(idiomById('inverse-lerp')!.patterns[0], x);
}

/** A box SDF's `q` must be `abs(p) - b` for the Box SDF node to be it. */
function boxQ(b: Bindings): boolean {
  const q = b.q?.expr;
  if (!q || !b.p || !b.b) return !q;
  const inner = matchPattern('abs($p) - $b', q);
  return !!inner && inner.p.key === b.p.key && inner.b.key === b.b.key;
}

/** Enough of an idiom's words for its `where` condition: the numbers and code its holes bound. */
function wordsFor(b: Bindings, types: Map<number, GlslType>): IdiomText {
  const code = (h: string) => (b[h] ? printExpr(b[h].expr) : '');
  return { h: code, n: h => String(b[h]?.value ?? ''), v: h => b[h]?.value, code, role: () => 'unknown' as Role, type: h => (b[h] ? types.get(b[h].expr.id) ?? 'unknown' : 'unknown') };
}

/** Which recipe (if any) matches this node, with its bindings. */
function matchAt(node: Expr, types: Map<number, GlslType>): Hit | null {
  for (const r of RECIPES) {
    if (r.kind === 'rotate') continue; // by hand below: matrix products aren't commutative
    const idiom = idiomById(r.idiom);
    if (!idiom) continue;
    for (const [i, pat] of idiom.patterns.entries()) {
      if (r.patterns && !r.patterns.includes(i)) continue;
      let b = matchPattern(pat, node);
      if (!b) continue;
      if (r.kind === 'saturateRemap') { const inner = nestedRemap(b); if (!inner) continue; b = inner; }
      if (r.kind === 'box' && !boxQ(b)) continue;
      if (idiom.where && !idiom.where(wordsFor(b, types))) continue; // `smoothstep(r + w, r, …)` with w < 0 is the other circle
      const holes = Object.keys(r.holes).filter(h => b![h]);
      if (Object.keys(b).some(h => h !== 'q' && !r.holes[h])) continue;
      const ret = types.get(node.id);
      if (!ret || !r.ret.includes(ret as Ty)) continue;
      return { recipe: r, variant: i, b, holes };
    }
  }
  // A rotation: mat2(c, -s, s, c) or mat2(c, s, -s, c) of one angle, times a vec2 on either side.
  if (node.kind === 'binary' && node.op === '*') {
    for (const [mat, p, side] of [[node.left, node.right, 1], [node.right, node.left, -1]] as const) {
      if (mat.kind !== 'call' || mat.callee !== 'mat2') continue;
      const rot = idiomById('rotation-matrix')!;
      for (const [form, pat] of rot.patterns.entries()) {
        const b = matchPattern(pat, mat);
        if (!b || types.get(p.id) !== 'vec2') continue;
        // M * p turns p by -a for mat2(c, -s, s, c) (form 0), by +a for form 1; p * M the other way.
        const turn = (form === 0 ? -1 : 1) * side;
        return { recipe: RECIPES.find(r => r.kind === 'rotate')!, variant: turn, b: { ...b, p: { expr: p, key: canonicalKey(normalize(p)) } }, holes: ['p', 'a'] };
      }
    }
  }
  return null;
}

/** The parameters, body and arguments of the cut-out call for a hit at `root`; null when it can't stand alone. */
function cutOut(a: Analysis, root: Expr, hit: Hit, types: Map<number, GlslType>, inTree: ReadonlySet<number>, argText: (e: Expr) => ArgSource): Pick<Recognition, 'params' | 'body' | 'args' | 'ret'> | null {
  const params: Recognition['params'] = [];
  const args: ArgSource[] = [];
  const subst = new Map<number, string>();
  const nodes = allNodes(root);
  const keyOf = new Map(nodes.map(n => [n.id, canonicalKey(normalize(n))]));
  for (const h of hit.holes) {
    const bind = hit.b[h];
    const t: string | undefined = bind.value !== undefined && !inTree.has(bind.expr.id) ? 'float' : types.get(bind.expr.id);
    if (!t || !TYS.has(t)) return null;
    if (hit.recipe && !hit.recipe.holes[h]?.includes(t as Ty)) return null;
    params.push({ name: h, type: t as Ty });
    if (inTree.has(bind.expr.id)) {
      const src = argText(bind.expr);
      if (SIDE_EFFECT.test('text' in src ? src.text : a.norm.slice(src.from, src.to))) return null;
      args.push(src);
      if (bind.value !== undefined) subst.set(bind.expr.id, h);
      else for (const n of nodes) if (keyOf.get(n.id) === bind.key) subst.set(n.id, h);
    } else if (bind.value !== undefined) args.push({ text: formatNumber(bind.value) });
    else return null; // a run of terms the matcher gathered: no one node to cut
  }
  const body = printExpr(root, subst);
  const names = identsIn(body);
  const ok = allowedNames(a);
  if (!names || [...names].some(n => !params.some(p => p.name === n) && !ok.has(n))) return null;
  const ret = types.get(root.id);
  if (!ret || !TYS.has(ret)) return null;
  return { params, body, args, ret: ret as Ty };
}

/** The statements of a helper's body that are a straight run of declarations and one return, inlined into one expression; else null. */
function inlineHelper(h: HelperFn, argTexts: string[]): Expr | null {
  if (h.openable !== true) return null;
  const local = new Map<string, string>();
  h.params.forEach((p, i) => local.set(p.name, argTexts[i]));
  const subst = (text: string): string | null => {
    const r = parseExpr(text);
    if (!r.ok) return null;
    const m = new Map<number, string>();
    for (const n of allNodes(r.expr)) if (n.kind === 'ident' && local.has(n.name)) m.set(n.id, local.get(n.name)!);
    return printExpr(r.expr, m);
  };
  for (const u of h.units) {
    const st = parseLine(u.text);
    if (!st.ok) return null;
    const l = st.line;
    if (l.isReturn) {
      if (u !== h.units[h.units.length - 1]) return null;
      const t = subst(u.text.slice(l.exprStart, l.exprEnd));
      if (t === null) return null;
      const r = parseExpr(t);
      return r.ok ? r.expr : null;
    }
    if (!l.declType || !l.target || l.op !== '=' || !/^\w+$/.test(l.target) || u.ast.type !== 'declaration_statement' || u.decls.length !== 1) return null;
    const t = subst(u.text.slice(l.exprStart, l.exprEnd));
    if (t === null) return null;
    local.set(l.target, `(${t})`);
  }
  return null;
}

/** fbm(): one vec2 in, a float out, a counted loop adding up octaves. Its shape for the FBM node, else null. */
export function fbmShape(h: HelperFn, norm: string): FbmShape | null {
  if (!h.units.length) return null;
  if (h.ret !== 'float' || h.params.length !== 1 || h.params[0].type !== 'vec2') return null;
  const text = norm.slice(h.start, h.end);
  const loop = /for\s*\(\s*int\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*(\d+)\s*;/.exec(text);
  const named = /fbm|fractal|turb/i.test(h.name);
  const ampVar = /\+=\s*(\w+)\s*\*/.exec(text)?.[1];
  const amp = ampVar ? new RegExp(`\\b(${ampVar})\\s*\\*=\\s*(0?\\.\\d+|\\d+\\.\\d*)`).exec(text) : /(\w+)\s*\*=\s*(0?\.\d+)/.exec(text);
  if (!loop || (!named && !(amp && /\+=\s*\w+\s*\*\s*\w+\s*\(|\+=\s*\w+\s*\([^;]*\)\s*\*\s*\w+\s*;/.test(text)))) return null;
  const P = h.params[0].name;
  const lac = new RegExp(`\\b${P}\\s*\\*=\\s*(\\d+\\.?\\d*)|\\b${P}\\s*=\\s*${P}\\s*\\*\\s*(\\d+\\.?\\d*)`).exec(text);
  return { octaves: Math.min(8, Math.max(1, Number(loop[1]))), gain: amp ? Number(amp[2]) : 0.5, lacunarity: lac ? Number(lac[1] ?? lac[2]) : 2 };
}

/**
 * The recognised patterns in a unit (a statement of main(), or of the body of the helper `fn`).
 * `opened`: helpers opened as groups, whose calls aren't recognised as patterns (they are groups).
 */
export function recognise(a: Analysis, unit: Unit, opened: ReadonlySet<string> = new Set()): Recognition[] {
  const scope = unit.fn ? a.helpers.find(h => h.name === unit.fn) : undefined;
  if (unit.setup) return [];
  const env = envFor(a, scope);
  const out: Recognition[] = [];
  const lineOf = (off: number) => { let n = 1; for (let i = 0; i < off; i++) if (a.norm.charCodeAt(i) === 10) n++; return a.toSourceLine(n); };
  const idBase = `${unit.fn ? `${unit.fn}/` : ''}${unit.index}@`;
  const swallowed = (start: number, end: number, args: ArgSource[]) => unit.literals
    .filter(l => l.at >= start && l.at < end && !args.some(s => 'from' in s && l.at >= s.from && l.at < s.to)).map(l => l.id);
  const push = (r: Omit<Recognition, 'id' | 'unit' | 'line' | 'swallowed' | 'fn'>) => {
    out.push({ ...r, id: `${idBase}${r.start - unit.start}:${r.kind}`, unit: unit.index, ...(unit.fn ? { fn: unit.fn } : {}), line: lineOf(r.start), swallowed: swallowed(r.start, r.end, r.args) });
  };

  for (const st of splitStatements(unit.text)) {
    const at = unit.start + st.start;
    const parsed = parseLine(st.text, at);
    if (!parsed.ok) continue;
    const line = parsed.line;
    const root = line.expr;
    const types = inferTypes(root, env);
    const inTree = new Set(allNodes(root).map(n => n.id));
    const span = (e: Expr): ArgSource => ({ from: e.start, to: e.end });

    // `uv *= mat2(cos(a), -sin(a), sin(a), cos(a))`: uv turned by a rotation, the whole statement as `uv = f(uv, a)`.
    if (line.op === '*=' && line.target && /^\w+$/.test(line.target) && root.kind === 'call' && root.callee === 'mat2' && env[line.target] === 'vec2') {
      const rot = idiomById('rotation-matrix')!;
      const form = rot.patterns.findIndex(p => matchPattern(p, root));
      const b = form >= 0 ? matchPattern(rot.patterns[form], root)! : null;
      if (b && inTree.has(b.a.expr.id)) {
        const recipe = RECIPES.find(r => r.kind === 'rotate')!;
        const subst = new Map<number, string>();
        const keyOf = new Map(allNodes(root).map(n => [n.id, canonicalKey(normalize(n))]));
        for (const n of allNodes(root)) if (keyOf.get(n.id) === b.a.key) subst.set(n.id, 'a');
        const aType = types.get(b.a.expr.id);
        if (aType === 'float') {
          push({
            kind: 'rotate', variant: form === 0 ? 1 : -1, what: recipe.what, node: recipe.node, exact: recipe.exact,
            start: at, end: line.exprEnd, code: st.text.replace(/\s+/g, ' ').trim(), ret: 'vec2',
            params: [{ name: 'p', type: 'vec2' }, { name: 'a', type: 'float' }], body: `p * ${printExpr(root, subst)}`,
            args: [{ text: line.target }, span(b.a.expr)], assign: line.target,
          });
          continue;
        }
      }
    }

    const visit = (n: Expr): void => {
      // A call to a helper: recognised whole, when its body is a pattern (or fractal noise).
      if (n.kind === 'call' && !opened.has(n.callee)) {
        const h = a.helpers.find(x => x.name === n.callee);
        if (h && n.args.length === h.params.length && h.params.every(p => p.qual === 'in')) {
          const shape = h.params.length === 1 ? fbmShape(h, a.norm) : null;
          if (shape && types.get(n.args[0].id) === 'vec2') {
            push({
              kind: 'fbm', variant: 0, what: `${h.name}() is ${FBM_RECIPE.what}`, node: FBM_RECIPE.node, exact: false,
              start: n.start, end: n.end, code: a.norm.slice(n.start, n.end).replace(/\s+/g, ' '), ret: 'float',
              params: [{ name: 'p', type: 'vec2' }], body: `${h.name}(p)`, args: [span(n.args[0])], helper: h.name, fbm: shape,
            });
            return;
          }
          const argTexts = n.args.map(x => a.norm.slice(x.start, x.end));
          // Inlined over placeholders for its parameters, so a part the pattern binds is the helper's own; the argument goes in after.
          const holders = h.params.map((_, i) => `__a${i}`);
          const inl = argTexts.some(t => SIDE_EFFECT.test(t)) ? null : inlineHelper(h, holders);
          const back = (text: string) => text.replace(/__a(\d+)/g, (_m, i: string) => `(${argTexts[Number(i)]})`);
          if (inl) {
            const itypes = inferTypes(inl, { ...env, ...Object.fromEntries(h.params.map((p, i) => [`__a${i}`, p.type as GlslType])) });
            const hit = matchAt(inl, itypes);
            if (hit?.recipe) {
              const itree = new Set(allNodes(inl).map(x => x.id));
              const cut = cutOut(a, inl, hit, itypes, itree, e => ({ text: back(printExpr(e)) }));
              if (cut) {
                push({ kind: hit.recipe.kind, variant: hit.variant, what: `${h.name}() is ${hit.recipe.what}`, node: hit.recipe.node, exact: hit.recipe.exact, start: n.start, end: n.end, code: a.norm.slice(n.start, n.end).replace(/\s+/g, ' '), ...cut, helper: h.name });
                return;
              }
            }
          }
        }
      }
      const hit = matchAt(n, types);
      if (hit?.recipe) {
        const cut = cutOut(a, n, hit, types, inTree, span);
        if (cut) {
          push({ kind: hit.recipe.kind, variant: hit.variant, what: hit.recipe.what, node: hit.recipe.node, exact: hit.recipe.exact, start: n.start, end: n.end, code: a.norm.slice(n.start, n.end).replace(/\s+/g, ' ').trim(), ...cut });
          return;
        }
      }
      for (const c of n.kind === 'call' ? n.args : n.kind === 'binary' ? [n.left, n.right] : n.kind === 'unary' ? [n.arg] : n.kind === 'member' ? [n.object] : n.kind === 'index' ? [n.object, n.index] : n.kind === 'ternary' ? [n.test, n.then, n.else] : []) visit(c);
    };
    visit(root);
  }
  return out;
}

/** The recognitions of several units, in order. */
export function recogniseAll(a: Analysis, units: readonly Unit[], opened: ReadonlySet<string> = new Set()): Recognition[] {
  return units.flatMap(u => recognise(a, u, opened));
}
