/**
 * glslToGraph — a fragment shader, as a node graph (EXPERIMENT, not wired
 * into the app yet; see tools/g2n-roundtrip.ts and docs/glsl-to-nodes.md).
 *
 * Deterministic: the same source always gives the same graph. Three rungs,
 * each expression taking the highest it can:
 *
 *   1. a node    `a * b` → Multiply, `sin(x)` → Sin, `vec3(r, g, b)` → Make
 *                Vec3, `p.x` → Split Vec2… A literal operand becomes that
 *                node's slider, so `uv * 4.0` is a Multiply with B = 4 you
 *                can drag.
 *   2. a block   anything rung 1 can't express (abs, pow of a signed base,
 *                a swizzle like .xyx, a ternary) becomes an Expression Block
 *                whose inputs are the live variables it reads and whose
 *                expression is the original sub-expression, verbatim.
 *   3. a region  a helper function call, or a loop the converter can't unroll,
 *                becomes a Custom Function node carrying that code.
 *
 * `report` says what landed on which rung and why, for the preview step.
 * Constructs nothing can hold (discard, textures, unknown uniforms) are
 * reported as unsupported and the caller keeps the whole-shader import.
 */
import { parser, generate } from '@shaderfrog/glsl-parser';
import type { GraphNode, InputSocket, DataType } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { groupNodesByRank, estimateNodeHeight } from '../store/graphLayout';

type T = 'float' | 'vec2' | 'vec3' | 'vec4';
interface Ref { nodeId: string; outputKey: string; type: T }
/** A value in flight: a node output, or a float literal not yet spent on a slider. */
interface Val { ref?: Ref; lit?: number; type: T; ast: Ast }
type Ast = Record<string, unknown> & { type: string };
interface UserFn { name: string; ret: string; params: { name: string; type: string }[]; source: string; body: string }

export interface ConversionOptions {
  /** Warned expressions (by `ConversionWarning.id`) to keep as Expression Blocks instead of the inexact node. */
  asBlock?: ReadonlySet<string>;
}

/** A node that isn't quite GLSL: offered with a warning, and the choice to keep the code instead. */
export interface ConversionWarning {
  /** Stable across re-conversions of the same source: the expression's text plus its occurrence. */
  id: string;
  code: string;
  why: string;
  /** The node it became (absent when kept as a block). */
  nodeId?: string;
}

export interface ConversionReport {
  notes: string[];
  warnings: ConversionWarning[];
  /** Sub-expressions that became Expression Blocks, with why. */
  blocks: { code: string; why: string }[];
  /** Statement regions that became Custom Function nodes. */
  regions: { code: string; why: string }[];
  /** Why the shader can't be a graph at all (empty when it can). */
  unsupported: string[];
  stats: { nodes: number; blocks: number; regions: number; sliders: number };
}

export interface ConversionResult { nodes: GraphNode[]; report: ConversionReport }

class Unmapped extends Error { why: string; constructor(why: string) { super(why); this.why = why; } }
class Unsupported extends Error { why: string; constructor(why: string) { super(why); this.why = why; } }

const SOURCES: Record<string, { type: string; out: string; t: T; name: string }> = {
  gl_FragCoord: { type: 'fragCoord', out: 'coord', t: 'vec2', name: 'fragCoord' },
  u_resolution: { type: 'resolution', out: 'res', t: 'vec2', name: 'resolution' },
  u_time: { type: 'time', out: 'time', t: 'float', name: 'time' },
  u_mouse: { type: 'mouse', out: 'uv', t: 'vec2', name: 'mouse' },
  // vUv (0..1 both ways) has no node of its own: it's fragCoord / resolution, built on demand (see srcRef).
  vUv: { type: 'divide', out: 'result', t: 'vec2', name: 'screenUV' },
};
const VEC_T: Record<number, T> = { 1: 'float', 2: 'vec2', 3: 'vec3', 4: 'vec4' };
const N_OF: Record<T, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
/** Built-ins that return their (widest vector) argument's type. */
const SAME_T = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'exp2', 'log', 'log2', 'sqrt', 'inversesqrt', 'abs', 'sign', 'floor', 'ceil', 'fract', 'mod', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'pow', 'normalize', 'reflect', 'refract', 'faceforward', 'dFdx', 'dFdy', 'fwidth']);
const FLOAT_T = new Set(['length', 'distance', 'dot', 'determinant']);
/** Polymorphic nodes: the sockets that take the card's chosen type (the rest stay float). */
const POLY: Record<string, string[]> = {
  add: ['a', 'b', 'result'], subtract: ['a', 'b', 'result'], multiply: ['a', 'b', 'result'], divide: ['a', 'b', 'result'],
  sin: ['input', 'output'], cos: ['input', 'output'], tan: ['input', 'output'], exp: ['input', 'output'], negate: ['input', 'output'],
  floor: ['input', 'output'], fractRaw: ['input', 'output'], clamp: ['input', 'result'], mix: ['a', 'b', 'result'],
  smoothstep: ['value', 'result'], mod: ['input', 'output'], sign: ['value', 'result'], sqrt: ['input', 'output'],
};

export function glslToGraph(source: string, options: ConversionOptions = {}): ConversionResult {
  const report: ConversionReport = { notes: [], warnings: [], blocks: [], regions: [], unsupported: [], stats: { nodes: 0, blocks: 0, regions: 0, sliders: 0 } };
  const seen = new Map<string, number>();
  /** An inexact mapping: the node with a warning, unless the user asked for the code. Returns the warning to attach, or null for "make a block". */
  const inexact = (a: Ast, why: string): ConversionWarning | null => {
    const code = generate(a as never).replace(/\s+/g, ' ').trim();
    const k = (seen.get(code) ?? 0) + 1; seen.set(code, k);
    const w: ConversionWarning = { id: `${code}#${k}`, code, why };
    report.warnings.push(w);
    if (options.asBlock?.has(w.id)) return null;
    return w;
  };
  const warned = (v: Val, w: ConversionWarning): Val => { const n = nodes.find(x => x.id === v.ref?.nodeId); if (n) { n.params.__importWarning = w.why; w.nodeId = n.id; } return v; };
  const nodes: GraphNode[] = [];
  let seq = 0;
  const id = (p: string) => `${p}_${++seq}`;

  // Shadertoy and other hosts: their entry point and uniform names become ours before parsing.
  const src = hostToOurs(source, report);
  let ast: { program: Ast[] };
  try { ast = parser.parse(src, { quiet: true }) as unknown as { program: Ast[] }; }
  catch (e) { report.unsupported.push(`Doesn't parse: ${(e as Error).message.split('\n')[0]}`); return { nodes, report }; }

  // ── The program's functions, uniforms, globals ─────────────────────────────
  const fns = new Map<string, UserFn>();
  const uniforms = new Map<string, string>();
  const globals = new Set<string>();
  for (const st of ast.program) {
    if (st.type === 'function') {
      const proto = st.prototype as Ast; const header = proto.header as Ast;
      const name = ((header.name as Ast).identifier as string);
      const ret = tokenOf((header.returnType as Ast).specifier as Ast);
      const params = ((proto.parameters as Ast[] | undefined) ?? []).map(p => ({ name: (p.identifier as Ast)?.identifier as string ?? '', type: tokenOf((p.specifier as Ast) ?? (p.declaration as Ast)) }));
      const body = generate(st.body as never).trim().replace(/^\{/, '').replace(/\}$/, '').trim();
      fns.set(name, { name, ret, params, source: generate(st as never), body });
    } else if (st.type === 'declaration_statement') {
      const decl = st.declaration as Ast;
      const quals = ((decl.specified_type as Ast)?.qualifiers as Ast[] | undefined) ?? [];
      const isUniform = quals.some(q => (q as Ast).token === 'uniform');
      const ty = tokenOf(((decl.specified_type as Ast)?.specifier as Ast) ?? decl);
      for (const d of ((decl.declarations as Ast[] | undefined) ?? [])) {
        const n = (d.identifier as Ast).identifier as string;
        if (isUniform) uniforms.set(n, ty); else globals.add(n);
      }
      if (decl.type === 'precision') continue;
    }
  }
  for (const [u, ty] of uniforms) if (!SOURCES[u] && !['sampler2D', 'samplerCube'].includes(ty)) report.unsupported.push(`Uniform ${ty} ${u} has no source node (only time, resolution, mouse, fragCoord are known)`);
  for (const [u, ty] of uniforms) if (['sampler2D', 'samplerCube'].includes(ty)) report.unsupported.push(`Texture ${u}: textures can't be imported yet`);
  if (globals.size) report.unsupported.push(`Global variables (${[...globals].join(', ')}) aren't supported yet`);
  const main = ast.program.find(st => st.type === 'function' && (((st.prototype as Ast).header as Ast).name as Ast).identifier === 'main');
  if (!main) report.unsupported.push('No main()');
  if (report.unsupported.length) return { nodes, report };

  // ── Node making ────────────────────────────────────────────────────────────
  const sourceRefs = new Map<string, Ref>();
  function mk(type: string, params: Record<string, unknown>, wires: Record<string, Ref | undefined>, sockets?: { inputs: Record<string, InputSocket>; outputs: GraphNode['outputs'] }): GraphNode {
    const def = getNodeDefinition(type);
    if (!def && !sockets) throw new Unsupported(`No node type ${type}`);
    const inputs: Record<string, InputSocket> = {};
    for (const [k, s] of Object.entries(sockets?.inputs ?? def!.inputs)) inputs[k] = { type: s.type, label: s.label, connection: wires[k] ? { nodeId: wires[k]!.nodeId, outputKey: wires[k]!.outputKey } : undefined };
    for (const [k, w] of Object.entries(wires)) if (w && !inputs[k]) inputs[k] = { type: w.type, label: k, connection: { nodeId: w.nodeId, outputKey: w.outputKey } };
    const outputs: GraphNode['outputs'] = {};
    for (const [k, s] of Object.entries(sockets?.outputs ?? def!.outputs)) outputs[k] = { type: s.type, label: s.label };
    const poly = POLY[type];
    const t = params.outputType as T | undefined;
    if (poly && t) for (const k of poly) { if (inputs[k]) inputs[k].type = t as DataType; if (outputs[k]) outputs[k].type = t as DataType; }
    const node = { id: id(type), type, position: { x: 0, y: 0 }, inputs, outputs, params: { ...(def?.defaultParams ?? {}), ...params } } as GraphNode;
    nodes.push(node);
    return node;
  }
  const ref = (n: GraphNode, out: string, t: T): Ref => ({ nodeId: n.id, outputKey: out, type: t });
  const srcRef = (name: string): Ref => {
    const s = SOURCES[name];
    let r = sourceRefs.get(name);
    if (!r) {
      r = name === 'vUv'
        ? ref(mk('divide', { outputType: 'vec2' }, { a: srcRef('gl_FragCoord'), b: srcRef('u_resolution') }), 'result', 'vec2')
        : ref(mk(s.type, {}, {}), s.out, s.t);
      sourceRefs.set(name, r);
    }
    return r;
  };
  const constant = (v: number): Ref => ref(mk('constant', { value: v, outputType: 'float' }, {}), 'value', 'float');
  /** A Val as a node output (a literal becomes a Constant node). */
  const asRef = (v: Val): Ref => v.ref ?? constant(v.lit ?? 0);

  // ── Types ──────────────────────────────────────────────────────────────────
  type Env = Map<string, Val>;
  function typeOf(a: Ast, env: Env): T {
    switch (a.type) {
      case 'float_constant': case 'int_constant': case 'bool_constant': return 'float';
      case 'identifier': {
        const n = a.identifier as string;
        if (env.has(n)) return env.get(n)!.type;
        if (SOURCES[n]) return SOURCES[n].t;
        throw new Unsupported(`Unknown identifier ${n}`);
      }
      case 'group': return typeOf(a.expression as Ast, env);
      case 'unary': return typeOf(a.expression as Ast, env);
      case 'binary': {
        const op = (a.operator as Ast).literal as string;
        if (['<', '>', '<=', '>=', '==', '!=', '&&', '||'].includes(op)) return 'float';
        const l = typeOf(a.left as Ast, env), r = typeOf(a.right as Ast, env);
        if ((l as string).startsWith('mat')) return r; // mat * vec is a vec
        if ((r as string).startsWith('mat')) return l;
        return N_OF[l] >= N_OF[r] ? l : r;
      }
      case 'ternary': return typeOf(a.right as Ast, env);
      case 'postfix': {
        const pf = a.postfix as Ast;
        if (pf.type === 'field_selection') { const sw = (pf.selection as Ast).identifier as string; return VEC_T[sw.length] ?? 'float'; }
        throw new Unmapped(`postfix ${pf.type}`);
      }
      case 'function_call': {
        const idn = a.identifier as Ast;
        const callee = calleeOf(idn);
        if (callee.ctor) { const tk = callee.name; if (tk in N_OF || tk.startsWith('mat')) return tk as T; if (tk === 'int' || tk === 'bool') return 'float'; throw new Unsupported(`Constructor ${tk}`); }
        const name = callee.name;
        const args = (a.args as Ast[] | undefined ?? []).filter(x => x.type !== 'literal');
        if (FLOAT_T.has(name)) return 'float';
        if (SAME_T.has(name)) { let t: T = 'float'; for (const x of args) { const at = typeOf(x, env); if (N_OF[at] > N_OF[t]) t = at; } return t; }
        const f = fns.get(name);
        if (f) { if (f.ret in N_OF || f.ret.startsWith('mat')) return f.ret as T; throw new Unsupported(`Function ${name} returns ${f.ret}`); }
        throw new Unmapped(`built-in ${name}`);
      }
      default: throw new Unmapped(`expression ${a.type}`);
    }
  }

  /** What a call calls: a constructor (vec3, mat2, float…) or a function by name. The parser files a user function under type_specifier too. */
  function calleeOf(idn: Ast): { name: string; ctor: boolean } {
    if (idn.type === 'identifier') return { name: idn.identifier as string, ctor: false };
    const name = tokenOf(idn);
    return { name, ctor: !fns.has(name) };
  }

  // ── Expressions → nodes ────────────────────────────────────────────────────
  const litOf = (a: Ast): number | null => {
    if (a.type === 'float_constant' || a.type === 'int_constant') return parseFloat(a.token as string);
    if (a.type === 'bool_constant') return (a.token as string) === 'true' ? 1 : 0;
    if (a.type === 'group') return litOf(a.expression as Ast);
    if (a.type === 'unary' && (a.operator as Ast).literal === '-') { const v = litOf(a.expression as Ast); return v === null ? null : -v; }
    return null;
  };
  const typed = (type: string, params: Record<string, unknown>, wires: Record<string, Ref | undefined>, out: string, t: T): Val =>
    ({ ref: ref(mk(type, { ...params, outputType: t }, wires), out, t), type: t, ast: { type: 'made' } });

  function build(a: Ast, env: Env): Val {
    const lit = litOf(a);
    if (lit !== null) return { lit, type: 'float', ast: a };
    switch (a.type) {
      case 'identifier': {
        const n = a.identifier as string;
        if (env.has(n)) return env.get(n)!;
        if (SOURCES[n]) return { ref: srcRef(n), type: SOURCES[n].t, ast: a };
        throw new Unsupported(`Unknown identifier ${n}`);
      }
      case 'group': return { ...build(a.expression as Ast, env), ast: a };
      case 'unary': {
        const op = (a.operator as Ast).literal as string;
        const x = build(a.expression as Ast, env);
        if (op === '-') { if (x.lit !== undefined) return { lit: -x.lit, type: 'float', ast: a }; return typed('negate', {}, { input: asRef(x) }, 'output', x.type); }
        if (op === '+') return x;
        throw new Unmapped(`unary ${op}`);
      }
      case 'binary': return binary(a, env);
      case 'postfix': {
        const pf = a.postfix as Ast;
        if (pf.type !== 'field_selection') throw new Unmapped(`postfix ${pf.type}`);
        const sw = (pf.selection as Ast).identifier as string;
        const v = build(a.expression as Ast, env);
        const n = N_OF[v.type];
        const comps = 'xyzw';
        if (sw.length === 1 && n > 1) {
          const i = 'xyzwrgbastpq'.indexOf(sw) % 4;
          const split = mk(`splitVec${n}`, {}, { v: asRef(v) });
          return { ref: ref(split, comps[i], 'float'), type: 'float', ast: a };
        }
        if (sw.length === n && [...sw].every((c, i) => 'xyzwrgba'.indexOf(c) % 4 === i)) return { ...v, ast: a };
        if ((n === 2 || n === 3) && sw.length === n) {
          const mode = [...sw].map(c => comps['xyzwrgba'.indexOf(c) % 4]).join('');
          return typed(`vec${n}Swizzle`, { mode }, { input: asRef(v) }, 'output', v.type);
        }
        throw new Unmapped(`swizzle .${sw} on a ${v.type}`);
      }
      case 'function_call': return call(a, env);
      case 'ternary': throw new Unmapped('ternary');
      default: throw new Unmapped(`expression ${a.type}`);
    }
  }

  function binary(a: Ast, env: Env): Val {
    const op = (a.operator as Ast).literal as string;
    const L = build(a.left as Ast, env), R = build(a.right as Ast, env);
    if (L.lit !== undefined && R.lit !== undefined) {
      const f = { '+': L.lit + R.lit, '-': L.lit - R.lit, '*': L.lit * R.lit, '/': L.lit / R.lit }[op];
      if (f !== undefined) return { lit: f, type: 'float', ast: a };
    }
    const t: T = N_OF[L.type] >= N_OF[R.type] ? L.type : R.type;
    if (t === 'vec4') throw new Unmapped('vec4 arithmetic');
    const kind = { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide' }[op];
    if (!kind) throw new Unmapped(`operator ${op}`);
    // Divide guards its divisor with max(b, 0.0001): only the same as GLSL for a positive divisor.
    // Known-positive divisors: a positive literal, the resolution, or one of its components.
    const resId = sourceRefs.get('u_resolution')?.nodeId;
    const fromRes = (r?: Ref) => !!r && (r.nodeId === resId || nodes.find(n => n.id === r.nodeId)?.inputs.v?.connection?.nodeId === resId);
    const positive = (R.lit !== undefined && R.lit > 0) || fromRes(R.ref);
    if (kind === 'divide' && !positive) {
      const w = inexact(a, 'The Divide node guards its divisor with max(b, 0.0001): the same as GLSL only while b stays positive');
      if (!w) throw new Unmapped('a / b kept as code (your choice)');
      return warned(typed(kind, {}, { a: asRef(L), b: asRef(R) }, 'result', t), w);
    }
    if (R.lit !== undefined) { report.stats.sliders++; return typed(kind, { b: R.lit }, { a: asRef(L) }, 'result', t); }
    if (L.lit !== undefined && (kind === 'add' || kind === 'multiply')) { report.stats.sliders++; return typed(kind, { b: L.lit }, { a: asRef(R) }, 'result', t); }
    return typed(kind, {}, { a: asRef(L), b: asRef(R) }, 'result', t);
  }

  function call(a: Ast, env: Env): Val {
    const idn = a.identifier as Ast;
    const args = (a.args as Ast[] | undefined ?? []).filter(x => x.type !== 'literal');
    const callee = calleeOf(idn);
    if (callee.ctor) {
      const tk = callee.name;
      const vs = args.map(x => build(x, env));
      if (tk === 'float' || tk === 'int') { if (vs.length === 1 && vs[0].type === 'float') return { ...vs[0], ast: a }; throw new Unmapped(`${tk}() of a vector`); }
      if (tk === 'vec2' && vs.length === 2 && vs.every(v => v.type === 'float')) return typed('makeVec2', {}, { x: asRef(vs[0]), y: asRef(vs[1]) }, 'xy', 'vec2');
      if (tk === 'vec3' && vs.length === 3 && vs.every(v => v.type === 'float')) return typed('makeVec3', {}, { r: asRef(vs[0]), g: asRef(vs[1]), b: asRef(vs[2]) }, 'rgb', 'vec3');
      if (tk === 'vec3' && vs.length === 1 && vs[0].type === 'float') return typed('floatToVec3', {}, { input: asRef(vs[0]) }, 'rgb', 'vec3');
      if (tk === 'vec2' && vs.length === 1 && vs[0].type === 'float') { const r = asRef(vs[0]); return typed('makeVec2', {}, { x: r, y: r }, 'xy', 'vec2'); }
      throw new Unmapped(`constructor ${tk}(${vs.map(v => v.type).join(', ')})`);
    }
    const name = callee.name;
    const user = fns.get(name);
    if (user) { if (!(user.ret in N_OF)) throw new Unmapped(`${name}() returns a ${user.ret}`); return region(a, env, `call to ${name}()`); }
    const vs = args.map(x => build(x, env));
    const t = vs.reduce<T>((m, v) => (N_OF[v.type] > N_OF[m] ? v.type : m), 'float');
    const one = (type: string, params: Record<string, unknown>, key: string, out: string) => typed(type, params, { [key]: asRef(vs[0]) }, out, t);
    const allF = vs.every(v => v.type === 'float');
    switch (name) {
      case 'sin': case 'cos': case 'tan': return one(name, { freq: 1, amp: 1 }, 'input', 'output');
      case 'exp': return one('exp', { scale: 1 }, 'input', 'output');
      case 'floor': return one('floor', {}, 'input', 'output');
      case 'ceil': if (t === 'float') return one('ceil', {}, 'input', 'output'); break;
      case 'fract': return one('fractRaw', {}, 'input', 'output');
      case 'sign': return typed('sign', {}, { value: asRef(vs[0]) }, 'result', t);
      case 'tanh': if (t === 'float') return one('tanh', {}, 'input', 'output'); break;
      case 'length': if (vs[0].type === 'vec2') return typed('length', { scale: 1 }, { input: asRef(vs[0]) }, 'output', 'float'); break;
      case 'normalize': if (vs[0].type === 'vec2') return typed('normalizeVec2', {}, { v: asRef(vs[0]) }, 'result', 'vec2'); break;
      case 'dot': if (vs.length === 2 && vs[0].type === 'vec2' && vs[1].type === 'vec2') return typed('dot', {}, { a: asRef(vs[0]), b: asRef(vs[1]) }, 'result', 'float'); break;
      case 'cross': if (vs.length === 2 && vs[0].type === 'vec3') return typed('crossProduct', {}, { a: asRef(vs[0]), b: asRef(vs[1]) }, 'result', 'vec3'); break;
      case 'min': case 'max': if (vs.length === 2 && allF) { report.stats.sliders += vs[1].lit !== undefined ? 1 : 0; return typed(name === 'min' ? 'minMath' : 'max', vs[1].lit !== undefined ? { b: vs[1].lit } : {}, { a: asRef(vs[0]), ...(vs[1].lit === undefined ? { b: asRef(vs[1]) } : {}) }, 'result', 'float'); } break;
      case 'clamp': if (vs.length === 3 && vs[1].type === 'float' && vs[2].type === 'float') return typed('clamp', { ...(vs[1].lit !== undefined ? { lo: vs[1].lit } : {}), ...(vs[2].lit !== undefined ? { hi: vs[2].lit } : {}) }, { input: asRef(vs[0]), ...(vs[1].lit === undefined ? { lo: asRef(vs[1]) } : {}), ...(vs[2].lit === undefined ? { hi: asRef(vs[2]) } : {}) }, 'result', t); break;
      case 'mix': if (vs.length === 3 && vs[2].type === 'float' && vs[0].type === vs[1].type) return typed('mix', vs[2].lit !== undefined ? { t: vs[2].lit } : {}, { a: asRef(vs[0]), b: asRef(vs[1]), ...(vs[2].lit === undefined ? { t: asRef(vs[2]) } : {}) }, 'result', vs[0].type); break;
      case 'smoothstep': if (vs.length === 3 && vs[0].type === 'float' && vs[1].type === 'float') { report.stats.sliders += (vs[0].lit !== undefined ? 1 : 0) + (vs[1].lit !== undefined ? 1 : 0); return typed('smoothstep', { ...(vs[0].lit !== undefined ? { edge0: vs[0].lit } : {}), ...(vs[1].lit !== undefined ? { edge1: vs[1].lit } : {}) }, { value: asRef(vs[2]), ...(vs[0].lit === undefined ? { edge0: asRef(vs[0]) } : {}), ...(vs[1].lit === undefined ? { edge1: asRef(vs[1]) } : {}) }, 'result', vs[2].type); } break;
      case 'step': if (vs.length === 2 && allF) return typed('step', {}, { edge: asRef(vs[0]), x: asRef(vs[1]) }, 'result', 'float'); break;
      case 'mod': if (vs.length === 2 && vs[1].type === 'float') return typed('mod', vs[1].lit !== undefined ? { period: vs[1].lit } : {}, { input: asRef(vs[0]), ...(vs[1].lit === undefined ? { period: asRef(vs[1]) } : {}) }, 'output', vs[0].type); break;
      case 'atan': if (vs.length === 2 && allF) return typed('atan2', {}, { y: asRef(vs[0]), x: asRef(vs[1]) }, 'angle', 'float'); break;
      case 'pow': if (vs.length === 2 && allF) {
        const w = inexact(a, 'The Pow node clamps its base to ≥ 0 (GLSL leaves a negative base undefined)');
        if (!w) throw new Unmapped('pow kept as code (your choice)');
        return warned(typed('pow', vs[1].lit !== undefined ? { exponent: vs[1].lit } : {}, { base: asRef(vs[0]), ...(vs[1].lit === undefined ? { exponent: asRef(vs[1]) } : {}) }, 'result', 'float'), w);
      } break;
      case 'sqrt': {
        const w = inexact(a, 'The Sqrt node clamps its input to ≥ 0 (GLSL leaves a negative input undefined)');
        if (!w) throw new Unmapped('sqrt kept as code (your choice)');
        return warned(one('sqrt', {}, 'input', 'output'), w);
      }
    }
    throw new Unmapped(`${name}(${vs.map(v => v.type).join(', ')})`);
  }

  // ── Rung 2: an Expression Block for a sub-expression ───────────────────────
  function freeNames(a: unknown, out: Set<string>, inCall = false): void {
    if (Array.isArray(a)) { for (const x of a) freeNames(x, out, inCall); return; }
    if (!a || typeof a !== 'object') return;
    const n = a as Ast;
    if (n.type === 'identifier' && typeof n.identifier === 'string' && !inCall) out.add(n.identifier);
    if (n.type === 'function_call') { freeNames(n.args, out); return; }
    if (n.type === 'postfix') { freeNames(n.expression, out, inCall); return; }
    for (const [k, v] of Object.entries(n)) if (k !== 'type' && k !== 'whitespace') freeNames(v, out, inCall);
  }
  function inputsFor(a: Ast, env: Env, extra: Record<string, Ref> = {}): { inputs: { name: string; type: T }[]; wires: Record<string, Ref>; code: string } {
    const names = new Set<string>(); freeNames(a, names);
    const inputs: { name: string; type: T }[] = []; const wires: Record<string, Ref> = {};
    let code = generate(a as never);
    for (const n of names) {
      if (env.has(n)) { const v = env.get(n)!; inputs.push({ name: n, type: v.type }); wires[n] = asRef(v); }
      else if (SOURCES[n]) { const s = SOURCES[n]; inputs.push({ name: s.name, type: s.t }); wires[s.name] = srcRef(n); code = code.replace(new RegExp(`\\b${n}\\b`, 'g'), s.name); }
      else if (fns.has(n)) { /* a call: handled by the caller (region) */ }
      else throw new Unsupported(`Unknown identifier ${n}`);
    }
    for (const [k, r] of Object.entries(extra)) { inputs.push({ name: k, type: r.type }); wires[k] = r; }
    return { inputs, wires, code };
  }
  function block(a: Ast, env: Env, why: string, extra: Record<string, Ref> = {}, codeOverride?: string, tOverride?: T): Val {
    const t = tOverride ?? typeOf(a, env);
    const { inputs, wires, code } = inputsFor(a, env, extra);
    const expr = codeOverride ?? code;
    const n = mk('exprNode', { __importedCode: 'block', inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: null })), outputType: t, lines: [], result: expr, expr }, wires,
      { inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type as DataType, label: i.name }])), outputs: { result: { type: t as DataType, label: 'Result' } } });
    report.blocks.push({ code: expr, why });
    return { ref: ref(n, 'result', t), type: t, ast: a };
  }
  /** Rung 1 with rung 2 as the net: an expression, one way or another. */
  function expr(a: Ast, env: Env): Val {
    try { return build(a, env); }
    catch (e) {
      if (!(e instanceof Unmapped)) throw e;
      // A user-function call inside: a region instead, so its code comes along.
      const names = new Set<string>(); freeNames(a, names);
      const calls = new Set<string>(); collectCalls(a, calls);
      if ([...calls].some(c => fns.has(c))) return region(a, env, e.why);
      return block(a, env, e.why);
    }
  }
  function collectCalls(a: unknown, out: Set<string>): void {
    if (Array.isArray(a)) { for (const x of a) collectCalls(x, out); return; }
    if (!a || typeof a !== 'object') return;
    const n = a as Ast;
    if (n.type === 'function_call') { const c = calleeOf(n.identifier as Ast); if (!c.ctor) out.add(c.name); }
    for (const [k, v] of Object.entries(n)) if (k !== 'type') collectCalls(v, out);
  }

  /** Every user function a piece of code reaches, transitively, in program order (GLSL wants callees declared first). */
  function helpersFor(a: unknown): string {
    const need = new Set<string>(); const queue: string[] = [];
    const seed = new Set<string>(); collectCalls(a, seed);
    for (const c of seed) if (fns.has(c)) queue.push(c);
    while (queue.length) {
      const c = queue.pop()!;
      if (need.has(c)) continue;
      need.add(c);
      const inner = new Set<string>(); collectCalls(parser.parse(fns.get(c)!.source, { quiet: true }).program, inner);
      for (const d of inner) if (fns.has(d) && !need.has(d)) queue.push(d);
    }
    return [...fns.values()].filter(f => f.name !== 'main' && need.has(f.name)).map(f => f.source).join('\n\n');
  }

  // ── Rung 3: a Custom Function node for a region ────────────────────────────
  function region(a: Ast, env: Env, why: string, stmtCode?: string, outVar?: string): Val {
    const t = typeOf(a, env);
    const { inputs, wires, code } = inputsFor(a, env);
    const helpers = helpersFor(a);
    const body = stmtCode ? `${stmtCode}\n  return ${outVar};` : `return ${code};`;
    const n = mk('customFn', { __importedCode: 'region', label: why.replace(/^call to /, '').replace(/\(\)$/, '') || 'Region', inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: null })), outputType: t, body, glslFunctions: helpers }, wires,
      { inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type as DataType, label: i.name }])), outputs: { result: { type: t as DataType, label: 'Result' } } });
    report.regions.push({ code: stmtCode ?? code, why });
    return { ref: ref(n, 'result', t), type: t, ast: a };
  }

  // ── Statements ─────────────────────────────────────────────────────────────
  let output: GraphNode | null = null;
  function withComponent(v: Val, i: number, nv: Val): Val {
    const n = N_OF[v.type];
    if (n < 2 || n > 3) throw new Unmapped(`component write on a ${v.type}`);
    const split = mk(`splitVec${n}`, {}, { v: asRef(v) });
    const comps = ['x', 'y', 'z'].slice(0, n).map((c, k) => (k === i ? asRef(nv) : ref(split, c, 'float')));
    return n === 2 ? typed('makeVec2', {}, { x: comps[0], y: comps[1] }, 'xy', 'vec2') : typed('makeVec3', {}, { r: comps[0], g: comps[1], b: comps[2] }, 'rgb', 'vec3');
  }
  const ops: Record<string, string> = { '+=': '+', '-=': '-', '*=': '*', '/=': '/' };
  function assign(left: Ast, opTok: string, right: Ast, env: Env): void {
    const rhsAst: Ast = opTok === '=' ? right : { type: 'binary', operator: { type: 'literal', literal: ops[opTok] }, left, right } as Ast;
    if (!ops[opTok] && opTok !== '=') throw new Unmapped(`assignment ${opTok}`);
    if (left.type === 'identifier') {
      const name = left.identifier as string;
      if (name === 'gl_FragColor' || name === 'fragColor') { output = finish(right, env); return; }
      env.set(name, expr(rhsAst, env));
      return;
    }
    if (left.type === 'postfix' && (left.postfix as Ast).type === 'field_selection' && (left.expression as Ast).type === 'identifier') {
      const name = (left.expression as Ast).identifier as string; const sw = ((left.postfix as Ast).selection as Ast).identifier as string;
      if (sw.length === 1 && env.has(name)) { const i = 'xyzwrgba'.indexOf(sw) % 4; env.set(name, withComponent(env.get(name)!, i, expr(rhsAst, env))); return; }
    }
    throw new Unmapped(`assignment to ${generate(left as never)}`);
  }
  function finish(right: Ast, env: Env): GraphNode {
    // gl_FragColor = vec4(rgb, 1.0) | vec4(r, g, b, 1.0) | vec4(x) → Output; anything else → Output (RGBA).
    if (right.type === 'function_call' && (right.identifier as Ast).type === 'type_specifier' && tokenOf(right.identifier as Ast) === 'vec4') {
      const args = (right.args as Ast[]).filter(x => x.type !== 'literal');
      const alpha = args.length >= 2 ? litOf(args[args.length - 1]) : null;
      if (alpha === 1) {
        const rgb = args.length === 2 ? expr(args[0], env) : args.length === 4 ? expr({ type: 'function_call', identifier: { type: 'type_specifier', specifier: { type: 'keyword', token: 'vec3' } }, args: args.slice(0, 3) } as Ast, env) : null;
        if (rgb && rgb.type === 'vec3') return mk('output', {}, { color: asRef(rgb) });
        if (rgb && rgb.type === 'float') return mk('output', {}, { color: asRef(typed('floatToVec3', {}, { input: asRef(rgb) }, 'rgb', 'vec3')) });
      }
    }
    const v = block(right, env, 'the final colour with its own alpha');
    return mk('vec4Output', {}, { color: asRef(v) });
  }
  /** A loop that can't be unrolled: a Custom Function running it, when it changes one live variable. */
  function loopRegion(s: Ast, env: Env, loopVar: string | undefined): void {
    const assigned = new Set<string>(); assignedNames(s.body, assigned);
    const live = [...assigned].filter(n => env.has(n));
    if (live.length !== 1) throw new Unsupported(`a loop the converter can't unroll that changes ${live.length ? live.join(', ') : 'nothing live'} (one variable is supported)`);
    const out = live[0]; const outT = env.get(out)!.type;
    const names = new Set<string>(); freeNames(s, names);
    const local = new Set<string>(); declaredNames(s, local);
    const inputs: { name: string; type: T }[] = []; const wires: Record<string, Ref> = {}; const prelude: string[] = [];
    let code = generate(s as never);
    for (const n of names) {
      if (n === loopVar || local.has(n)) continue;
      if (env.has(n)) { const v = env.get(n)!; inputs.push({ name: `${n}_in`, type: v.type }); wires[`${n}_in`] = asRef(v); prelude.push(`${v.type} ${n} = ${n}_in;`); }
      else if (SOURCES[n]) { const so = SOURCES[n]; inputs.push({ name: so.name, type: so.t }); wires[so.name] = srcRef(n); code = code.replace(new RegExp(`\\b${n}\\b`, 'g'), so.name); }
      else if (!fns.has(n)) throw new Unsupported(`Unknown identifier ${n}`);
    }
    const helpers = helpersFor(s);
    const body = `${prelude.join('\n')}\n${code}\nreturn ${out};`;
    const n = mk('customFn', { __importedCode: 'region', label: `loop → ${out}`, inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: null })), outputType: outT, body, glslFunctions: helpers }, wires,
      { inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type as DataType, label: i.name }])), outputs: { result: { type: outT as DataType, label: 'Result' } } });
    report.regions.push({ code, why: `a loop the converter can’t unroll (it changes ${out})` });
    env.set(out, { ref: ref(n, 'result', outT), type: outT, ast: s });
  }
  function declaredNames(a: unknown, out: Set<string>): void {
    if (Array.isArray(a)) { for (const x of a) declaredNames(x, out); return; }
    if (!a || typeof a !== 'object') return;
    const n = a as Ast;
    if (n.type === 'declaration' && (n.identifier as Ast)?.identifier) out.add((n.identifier as Ast).identifier as string);
    for (const [k, v] of Object.entries(n)) if (k !== 'type') declaredNames(v, out);
  }
  function assignedNames(a: unknown, out: Set<string>): void {
    if (Array.isArray(a)) { for (const x of a) assignedNames(x, out); return; }
    if (!a || typeof a !== 'object') return;
    const n = a as Ast;
    if (n.type === 'assignment') { const l = n.left as Ast; if (l.type === 'identifier') out.add(l.identifier as string); else if (l.type === 'postfix' && (l.expression as Ast).type === 'identifier') out.add((l.expression as Ast).identifier as string); }
    if (n.type === 'postfix' && ['++', '--'].includes((n.postfix as Ast)?.literal as string) && (n.expression as Ast).type === 'identifier') out.add((n.expression as Ast).identifier as string);
    for (const [k, v] of Object.entries(n)) if (k !== 'type') assignedNames(v, out);
  }
  function stmts(list: Ast[], env: Env): void { for (const s of list) stmt(s, env); }
  function stmt(s: Ast, env: Env): void {
    switch (s.type) {
      case 'declaration_statement': {
        const decl = s.declaration as Ast;
        const ty = tokenOf(((decl.specified_type as Ast)?.specifier as Ast) ?? decl);
        for (const d of ((decl.declarations as Ast[] | undefined) ?? [])) {
          const name = (d.identifier as Ast).identifier as string;
          if (d.quantifier) throw new Unsupported(`array ${name}`);
          if (d.initializer) env.set(name, expr(d.initializer as Ast, env));
          else env.set(name, { lit: ty === 'float' || ty === 'int' ? 0 : undefined, type: (ty in N_OF ? ty : 'float') as T, ast: { type: 'zero' } });
        }
        return;
      }
      case 'expression_statement': {
        const e = s.expression as Ast;
        if (e.type === 'assignment') { assign(e.left as Ast, (e.operator as Ast).literal as string, e.right as Ast, env); return; }
        if (e.type === 'postfix' && ['++', '--'].includes(((e.postfix as Ast).operator as Ast)?.literal as string ?? (e.postfix as Ast).type)) throw new Unmapped('increment');
        throw new Unmapped(`statement ${e.type}`);
      }
      case 'compound_statement': stmts(s.statements as Ast[], env); return;
      case 'if_statement': {
        const cond = s.condition as Ast;
        const thenEnv = new Map(env), elseEnv = new Map(env);
        stmt(s.body as Ast, thenEnv);
        const els = s.else as Ast | undefined;
        if (els && (els as Ast).type !== 'literal') stmt((els as Ast).type === 'keyword' ? (s.elseBody as Ast) : els, elseEnv);
        const changed = new Set<string>([...thenEnv.keys(), ...elseEnv.keys()].filter(k => thenEnv.get(k) !== env.get(k) || elseEnv.get(k) !== env.get(k)));
        for (const k of changed) {
          if (!env.has(k)) continue; // a temp local to the branch
          const tv = thenEnv.get(k)!, ev = elseEnv.get(k)!;
          env.set(k, block(cond, env, 'a branch (if): picked with a ternary', { thenV: asRef(tv), elseV: asRef(ev) }, `(${generate(cond as never)}) ? thenV : elseV`, tv.type));
        }
        return;
      }
      case 'for_statement': {
        const init = s.init as Ast, cond = s.condition as Ast, upd = s.operation as Ast;
        const decl = ((init?.type === 'declarator_list' ? init : init?.declaration as Ast)?.declarations) as Ast[] | undefined;
        const v = decl?.[0]; const name = (v?.identifier as Ast)?.identifier as string | undefined;
        const start = v?.initializer ? litOf(v.initializer as Ast) : null;
        const condOp = cond?.type === 'binary' ? (cond.operator as Ast).literal as string : null;
        const end = cond?.type === 'binary' ? litOf(cond.right as Ast) : null;
        const step = upd?.type === 'postfix' && ((upd.postfix as Ast)?.literal === '++') ? 1 : upd?.type === 'assignment' && (upd.operator as Ast).literal === '+=' ? litOf(upd.right as Ast) : null;
        if (name && start !== null && end !== null && step && (condOp === '<' || condOp === '<=')) {
          const count = Math.floor(((condOp === '<' ? end - 1e-9 : end) - start) / step) + 1;
          if (count >= 1 && count <= 16) {
            for (let k = 0; k < count; k++) { env.set(name, { lit: start + k * step, type: 'float', ast: { type: 'loopvar' } }); stmt(s.body as Ast, env); }
            env.delete(name);
            report.notes.push(`Loop over ${name} unrolled ${count}×`);
            return;
          }
        }
        return loopRegion(s, env, name);
      }
      case 'return_statement': case 'discard_statement': case 'break_statement': case 'continue_statement': case 'while_statement': case 'do_statement': case 'switch_statement':
        throw new Unsupported(`${s.type.replace('_statement', '')} in main()`);
      default: throw new Unmapped(`statement ${s.type}`);
    }
  }

  // ── Go ─────────────────────────────────────────────────────────────────────
  const env: Env = new Map();
  try {
    stmts(((main!.body as Ast).statements as Ast[]), env);
    if (!output) report.unsupported.push('main() never writes gl_FragColor');
  } catch (e) {
    if (e instanceof Unsupported || e instanceof Unmapped) report.unsupported.push(e.why); else throw e;
  }
  if (report.unsupported.length) return { nodes: [], report };

  layout(nodes);
  report.stats = { nodes: nodes.length, blocks: report.blocks.length, regions: report.regions.length, sliders: report.stats.sliders };
  return { nodes, report };
}

/**
 * `mainImage(out vec4 fragColor, in vec2 fragCoord)` becomes main(), iTime and
 * friends become u_time…, so a pasted Shadertoy shader converts like our own.
 */
export function normaliseHostShader(source: string): string { return hostToOurs(source, { notes: [], warnings: [], blocks: [], regions: [], unsupported: [], stats: { nodes: 0, blocks: 0, regions: 0, sliders: 0 } }); }

function hostToOurs(source: string, report: ConversionReport): string {
  let s = source;
  const renames: Array<[RegExp, string]> = [
    [/\biResolution\.xy\b/g, 'u_resolution'], [/\biResolution\b/g, 'vec3(u_resolution, 1.0)'],
    [/\biTime\b/g, 'u_time'], [/\biGlobalTime\b/g, 'u_time'], [/\biMouse\.xy\b/g, 'u_mouse'],
  ];
  for (const [re, to] of renames) s = s.replace(re, to);
  const m = /void\s+mainImage\s*\(\s*out\s+vec4\s+(\w+)\s*,\s*(?:in\s+)?vec2\s+(\w+)\s*\)\s*\{/.exec(s);
  if (m) {
    s = s.slice(0, m.index) + `void main() {\n  vec2 ${m[2]} = gl_FragCoord.xy;\n` + s.slice(m.index + m[0].length);
    s = s.replace(new RegExp(`\\b${m[1]}\\b`, 'g'), 'gl_FragColor');
    report.notes.push('Shadertoy entry point mainImage() read as main()');
  }
  s = s.replace(/^\s*#version.*$/m, '');
  // Simple object-like macros (#define PI 3.14159) are expanded; anything else the preprocessor would do is left to fail loudly.
  const macros: Array<[RegExp, string]> = [];
  s = s.replace(/^[ \t]*#define[ \t]+(\w+)[ \t]+([^\n(]+?)[ \t]*$/gm, (_m, name: string, value: string) => { macros.push([new RegExp(`\\b${name}\\b`, 'g'), `(${value.trim()})`]); return ''; });
  for (const [re, to] of macros) s = s.replace(re, to);
  if (macros.length) report.notes.push(`${macros.length} #define${macros.length === 1 ? '' : 's'} expanded`);
  // Precision and varying lines are the host's, not the shader's.
  s = s.replace(/^\s*precision\s+\w+\s+float\s*;\s*$/gm, '').replace(/^\s*varying\s+vec2\s+vUv\s*;\s*$/gm, '');
  return s;
}

function tokenOf(spec: Ast | undefined): string {
  if (!spec) return '';
  if (typeof spec.token === 'string') return spec.token;
  if (spec.specifier) return tokenOf(spec.specifier as Ast);
  if (spec.identifier && typeof (spec.identifier as Ast).identifier === 'string') return (spec.identifier as Ast).identifier as string;
  if (typeof spec.identifier === 'string') return spec.identifier;
  return '';
}

/** Columns by depth (sources left, Output right), rows in creation order. */
/**
 * Columns by data-flow depth, the same ranks the Studio's auto layout uses,
 * spaced for real cards (360 wide, heights estimated the way the Studio does,
 * plus the code a block or function shows on its card). Nodes are created in
 * program order, so a column reads top to bottom as the shader did.
 */
function layout(nodes: GraphNode[]): void {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  for (const { rank, nodes: column } of groupNodesByRank(nodes)) {
    let y = 60;
    for (const n of [...column].sort((a, b) => order.get(a.id)! - order.get(b.id)!)) {
      n.position = { x: 40 + rank * 440, y };
      const codeLines = n.type === 'exprNode' ? String(n.params.expr ?? '').split('\n').length + ((n.params.lines as string[] | undefined)?.length ?? 0)
        : n.type === 'customFn' ? String(n.params.body ?? '').split('\n').length : 0;
      y += estimateNodeHeight(n) + codeLines * 18 + 32;
    }
  }
}
