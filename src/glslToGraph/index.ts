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
import { GROUP_PORT_SENTINEL, type GraphNode, type InputSocket, type DataType, type GroupInputPort, type GroupOutputPort } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { groupNodesByRank, estimateNodeHeight } from '../store/graphLayout';
import { translateToStudio, dialectLabel } from '../glsl/dialects';
import { threadGlobals } from './threadGlobals';
import type { ConstantsItem } from '../nodes/definitions/constants';
import { ALWAYS_HELPERS_GLSL } from '../compiler/shaderAssembler';

type T = 'float' | 'vec2' | 'vec3' | 'vec4';
interface Ref { nodeId: string; outputKey: string; type: T; /** A literal's value and, when it initialised a variable, that name. */ lit?: number; name?: string }
/** A value in flight: a node output, or a float literal not yet spent on a slider. */
interface Val { ref?: Ref; lit?: number; type: T; ast: Ast; /** The variable a literal initialised, so its slider can carry the name. */ name?: string }
type Ast = Record<string, unknown> & { type: string };
interface UserFn { name: string; ret: string; params: { name: string; type: string; qual: 'in' | 'out' | 'inout' }[]; source: string; body: string; /** Every definition under this name (overloads), this one included. */ overloads: UserFn[] }
interface ConstDecl { name: string; type: string; init: Ast | undefined; text: string }
/** A literal on its way to a socket: `mk` folds it into the socket's slider or makes a node for it. */
const LIT = '__lit__';

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
  /** When the shader doesn't parse: the line of the paste the parser stopped at. */
  errorLine?: number;
  stats: { nodes: number; blocks: number; regions: number; sliders: number; loops: number };
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
  const report: ConversionReport = { notes: [], warnings: [], blocks: [], regions: [], unsupported: [], stats: { nodes: 0, blocks: 0, regions: 0, sliders: 0, loops: 0 } };
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
  const warned = (v: Val, w: ConversionWarning): Val => { const n = sink.find(x => x.id === v.ref?.nodeId); if (n) { n.params.__importWarning = w.why; w.nodeId = n.id; } return v; };
  const nodes: GraphNode[] = [];
  /** Where new nodes go: the graph, or the subgraph of the loop group being built. */
  let sink: GraphNode[] = nodes;
  /** The subgraphs made along the way, laid out at the end like the graph itself. */
  const subgraphs: GraphNode[][] = [];
  /** Split nodes already made, per scope, by the vector they split. */
  const splits = new WeakMap<GraphNode[], Map<string, GraphNode>>();
  let seq = 0;
  const id = (p: string) => `${p}_${++seq}`;

  // Shadertoy and other hosts: their entry point and uniform names become ours before parsing.
  const { code: src, toSourceLine } = hostToOurs(source, report);
  let ast: { program: Ast[] };
  try { ast = parser.parse(src, { quiet: true }) as unknown as { program: Ast[] }; }
  catch (e) {
    const loc = (e as { location?: { start?: { line?: number } } }).location?.start?.line;
    if (loc) report.errorLine = toSourceLine(loc);
    report.unsupported.push(`Doesn't parse${loc ? ` (line ${report.errorLine})` : ''}: ${(e as Error).message.split('\n')[0]}`);
    return { nodes, report };
  }

  // ── The program's functions, uniforms, globals ─────────────────────────────
  const fns = new Map<string, UserFn>();
  const uniforms = new Map<string, string>();
  const globals = new Set<string>();
  const consts: ConstDecl[] = [];
  for (const st of ast.program) {
    if (st.type === 'function') {
      const proto = st.prototype as Ast; const header = proto.header as Ast;
      const name = ((header.name as Ast).identifier as string);
      const ret = tokenOf((header.returnType as Ast).specifier as Ast);
      const params = ((proto.parameters as Ast[] | undefined) ?? []).map(p => ({
        name: (p.identifier as Ast)?.identifier as string ?? '', type: tokenOf((p.specifier as Ast) ?? (p.declaration as Ast)),
        qual: ((((p.qualifier as Ast[] | undefined) ?? []).map(q => q.token as string).find(q => q === 'out' || q === 'inout') ?? 'in') as 'in' | 'out' | 'inout'),
      }));
      const body = generate(st.body as never).trim().replace(/^\{/, '').replace(/\}$/, '').trim();
      const f: UserFn = { name, ret, params, source: generate(st as never), body, overloads: [] };
      const prev = fns.get(name);
      if (prev) { prev.overloads.push(f); f.overloads = prev.overloads; } else { f.overloads.push(f); fns.set(name, f); }
    } else if (st.type === 'declaration_statement') {
      const decl = st.declaration as Ast;
      const quals = ((decl.specified_type as Ast)?.qualifiers as Ast[] | undefined) ?? [];
      const isUniform = quals.some(q => (q as Ast).token === 'uniform');
      const isConst = quals.some(q => (q as Ast).token === 'const');
      const ty = tokenOf(((decl.specified_type as Ast)?.specifier as Ast) ?? decl);
      for (const d of ((decl.declarations as Ast[] | undefined) ?? [])) {
        const n = (d.identifier as Ast).identifier as string;
        if (isUniform) uniforms.set(n, ty);
        else if (isConst) consts.push({ name: n, type: ty, init: d.initializer as Ast | undefined, text: `const ${ty} ${n} = ${generate(d.initializer as never)};` });
        else globals.add(n);
      }
      if (decl.type === 'precision') continue;
    }
  }
  /** The program's const declarations, as text every region carries (the assembler emits repeats once). */
  const constText = consts.map(c => c.text).join('\n');
  const withConsts = (helpers: string) => [constText, helpers].filter(Boolean).join('\n\n');
  for (const [u, ty] of uniforms) if (!SOURCES[u] && !['sampler2D', 'samplerCube'].includes(ty)) report.unsupported.push(`Uniform ${ty} ${u} has no source node (only time, resolution, mouse, fragCoord are known)`);
  for (const [u, ty] of uniforms) if (['sampler2D', 'samplerCube'].includes(ty)) report.unsupported.push(`Texture ${u}: textures can't be imported yet`);
  if (globals.size) report.unsupported.push(`Global variables (${[...globals].join(', ')}) aren't supported yet`);
  const main = ast.program.find(st => st.type === 'function' && (((st.prototype as Ast).header as Ast).name as Ast).identifier === 'main');
  if (!main) report.unsupported.push('No main()');
  if (report.unsupported.length) return { nodes, report };

  // ── Node making ────────────────────────────────────────────────────────────
  const sourceRefs = new Map<string, Ref>();
  function mk(type: string, params: Record<string, unknown>, rawWires: Record<string, Ref | undefined>, sockets?: { inputs: Record<string, InputSocket>; outputs: GraphNode['outputs'] }): GraphNode {
    const def = getNodeDefinition(type);
    if (!def && !sockets) throw new Unsupported(`No node type ${type}`);
    // An anonymous number wired to a socket that has its own slider is that slider's value: a
    // separate card for the `0.5` next to a Multiply that already has a B slider is noise. Blocks
    // and functions take one as a slider input the same way. A number the shader named
    // (`float ang = 5.0`, a `const`) is a constant: it goes on the scope's Constants card, fixed,
    // where it reads like the shader and can be freed into a slider on purpose.
    const wires: Record<string, Ref | undefined> = {};
    const dyn = (params.inputs as Array<{ name: string; type: string; slider: unknown }> | undefined);
    for (const [k, w] of Object.entries(rawWires)) {
      if (!isLit(w)) { wires[k] = w; continue; }
      if (w.name) { wires[k] = materialize(w); continue; }
      const pd = def?.paramDefs?.[k];
      const socketT = sockets?.inputs[k]?.type ?? def?.inputs[k]?.type;
      const polyT = POLY[type]?.includes(k) ? (params.outputType as string | undefined) : undefined;
      if (pd?.type === 'float' && (polyT ?? socketT) === 'float') { params[k] = w.lit; report.stats.sliders++; continue; }
      const di = dyn?.find(i => i.name === k);
      // The socket stays (unwired): the compiler reads a slider input's value off the params only for a socket it can see.
      if ((type === 'exprNode' || type === 'customFn') && di && di.type === 'float') { di.slider = sliderRange(w.lit); params[k] = w.lit; report.stats.sliders++; continue; }
      wires[k] = materialize(w);
    }
    const inputs: Record<string, InputSocket> = {};
    for (const [k, s] of Object.entries(sockets?.inputs ?? def!.inputs)) inputs[k] = { type: s.type, label: s.label, connection: wires[k] ? { nodeId: wires[k]!.nodeId, outputKey: wires[k]!.outputKey } : undefined };
    for (const [k, w] of Object.entries(wires)) if (w && !inputs[k]) inputs[k] = { type: w.type, label: k, connection: { nodeId: w.nodeId, outputKey: w.outputKey } };
    const outputs: GraphNode['outputs'] = {};
    for (const [k, s] of Object.entries(sockets?.outputs ?? def!.outputs)) outputs[k] = { type: s.type, label: s.label };
    const poly = POLY[type];
    const t = params.outputType as T | undefined;
    if (poly && t) for (const k of poly) { if (inputs[k]) inputs[k].type = t as DataType; if (outputs[k]) outputs[k].type = t as DataType; }
    const node = { id: id(type), type, position: { x: 0, y: 0 }, inputs, outputs, params: { ...(def?.defaultParams ?? {}), ...params } } as GraphNode;
    sink.push(node);
    return node;
  }
  const ref = (n: GraphNode, out: string, t: T): Ref => ({ nodeId: n.id, outputKey: out, type: t });
  const isLit = (r: Ref | undefined): r is Ref & { lit: number } => !!r && r.nodeId === LIT;
  /**
   * A literal as a real output: an entry on the scope's one Constants card,
   * fixed (the shader's number, changed in the card's editor; its slider can
   * be turned on there). Named after the variable it initialised when it had
   * one; the same named value is one entry however often it's read.
   */
  const constantsCards = new WeakMap<GraphNode[], GraphNode>();
  function materialize(r: Ref): Ref {
    if (!isLit(r)) return r;
    let card = constantsCards.get(sink);
    if (!card) { card = mk('constants', { items: [] }, {}, { inputs: {}, outputs: {} }); constantsCards.set(sink, card); }
    const items = card.params.items as ConstantsItem[];
    const taken = new Set(items.map(i => i.key));
    if (r.name && taken.has(r.name)) { const same = items.find(i => i.key === r.name && i.value === r.lit); if (same) return { nodeId: card.id, outputKey: same.key, type: 'float' }; }
    let key = r.name ?? `k${items.length + 1}`; const base = key; let k = 2;
    while (taken.has(key)) key = `${base}_${k++}`;
    items.push({ key, label: key, type: 'float', value: r.lit, slider: false });
    card.params[key] = r.lit;
    card.outputs[key] = { type: 'float', label: key };
    return { nodeId: card.id, outputKey: key, type: 'float' };
  }

  // ── Loop scope: a for loop being built as an iterated group ────────────────
  /**
   * Inside a loop group, anything from outside (a variable, a source) comes in
   * through an input port: the group node gets a socket wired to the outer
   * value, and the body's nodes wire to the port sentinel. One port per outer
   * value, however often it's read.
   */
  interface LoopCtx { ports: Map<string, Ref>; inputPorts: GroupInputPort[]; wires: Record<string, Ref>; sockets: Record<string, InputSocket>; outerSink: GraphNode[] }
  let loopCtx: LoopCtx | null = null;
  function portRef(ctx: LoopCtx, outerRef: Ref, label: string): Ref {
    let outer = outerRef;
    if (isLit(outer)) { const saved = sink; sink = ctx.outerSink; try { outer = materialize(outer); } finally { sink = saved; } }
    const k = `${outer.nodeId}:${outer.outputKey}`;
    let r = ctx.ports.get(k);
    if (!r) {
      const key = `in${ctx.inputPorts.length}`;
      ctx.inputPorts.push({ key, type: outer.type as DataType, label, toNodeId: '', toInputKey: '' });
      ctx.wires[key] = outer;
      ctx.sockets[key] = { type: outer.type as DataType, label };
      r = { nodeId: GROUP_PORT_SENTINEL, outputKey: key, type: outer.type };
      ctx.ports.set(k, r);
    }
    return r;
  }
  const srcRef = (name: string): Ref => {
    // Inside a loop group the source node lives outside and comes in through a port.
    if (loopCtx) {
      const ctx = loopCtx, saved = sink;
      loopCtx = null; sink = ctx.outerSink;
      try { return portRef(ctx, srcRef(name), SOURCES[name].name); } finally { loopCtx = ctx; sink = saved; }
    }
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
  /** A number the shader didn't name: free to fold into a slider or another number. A named one is a constant (see mk). */
  const anon = (v: Val): v is Val & { lit: number } => v.lit !== undefined && !v.name;
  /** A Val as a node output. A literal is a pending Ref: `mk` folds it into a slider or makes it a node. */
  const asRef = (v: Val): Ref => v.ref ?? { nodeId: LIT, outputKey: 'value', type: 'float', lit: v.lit ?? 0, ...(v.name ? { name: v.name } : {}) };

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
        if (f) { const o = overloadFor(f, args, env); if (o.ret in N_OF || o.ret.startsWith('mat')) return o.ret as T; throw new Unsupported(`Function ${name} returns ${o.ret}`); }
        throw new Unmapped(`built-in ${name}`);
      }
      default: throw new Unmapped(`expression ${a.type}`);
    }
  }

  /** The overload a call reaches: by argument count, then by the first argument's type; else the first definition. */
  function overloadFor(f: UserFn, args: Ast[], env: Env): UserFn {
    if (f.overloads.length < 2) return f;
    const byCount = f.overloads.filter(o => o.params.length === args.length);
    if (byCount.length < 2) return byCount[0] ?? f;
    try { const t0 = typeOf(args[0], env); return byCount.find(o => o.params[0]?.type === t0) ?? byCount[0]; } catch { return byCount[0]; }
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
          // One Split per vector per scope: p.x + p.y reads the same card twice.
          const src = asRef(v); const key = `${src.nodeId}:${src.outputKey}`;
          let scope = splits.get(sink); if (!scope) { scope = new Map(); splits.set(sink, scope); }
          let split = scope.get(key); if (!split) { split = mk(`splitVec${n}`, {}, { v: src }); scope.set(key, split); }
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
    if (anon(L) && anon(R)) {
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
    const fromRes = (r?: Ref) => !!r && (r.nodeId === resId || sink.find(n => n.id === r.nodeId)?.inputs.v?.connection?.nodeId === resId);
    const positive = (R.lit !== undefined && R.lit > 0) || fromRes(R.ref);
    if (kind === 'divide' && !positive) {
      const w = inexact(a, 'The Divide node guards its divisor with max(b, 0.0001): the same as GLSL only while b stays positive');
      if (!w) throw new Unmapped('a / b kept as code (your choice)');
      return warned(typed(kind, {}, { a: asRef(L), b: asRef(R) }, 'result', t), w);
    }
    if (anon(R)) { report.stats.sliders++; return typed(kind, { b: R.lit }, { a: asRef(L) }, 'result', t); }
    if (anon(L) && (kind === 'add' || kind === 'multiply')) { report.stats.sliders++; return typed(kind, { b: L.lit }, { a: asRef(R) }, 'result', t); }
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
      // Three numbers in 0..1 are a colour: the picker card, not three sliders.
      if (tk === 'vec3' && vs.length === 3 && vs.every(v => v.lit !== undefined && v.lit >= 0 && v.lit <= 1)) return { ref: ref(mk('colorPicker', { color: vs.map(v => v.lit) }, {}), 'rgb', 'vec3'), type: 'vec3', ast: a };
      if (tk === 'vec3' && vs.length === 3 && vs.every(v => v.type === 'float')) return typed('makeVec3', {}, { r: asRef(vs[0]), g: asRef(vs[1]), b: asRef(vs[2]) }, 'rgb', 'vec3');
      if (tk === 'vec3' && vs.length === 1 && vs[0].type === 'float') return typed('floatToVec3', {}, { input: asRef(vs[0]) }, 'rgb', 'vec3');
      if (tk === 'vec2' && vs.length === 1 && vs[0].type === 'float') { const r = asRef(vs[0]); return typed('makeVec2', {}, { x: r, y: r }, 'xy', 'vec2'); }
      throw new Unmapped(`constructor ${tk}(${vs.map(v => v.type).join(', ')})`);
    }
    const name = callee.name;
    const user = fns.get(name);
    if (user) {
      const o = overloadFor(user, args, env);
      if (o.params.some(p => p.qual !== 'in')) return outCall(a, env, o) ?? (() => { throw new Unmapped(`${name}() returns nothing`); })();
      if (!(o.ret in N_OF)) throw new Unmapped(`${name}() returns a ${o.ret}`);
      return region(a, env, `call to ${name}()`);
    }
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
      case 'min': case 'max': if (vs.length === 2 && allF) { report.stats.sliders += anon(vs[1]) ? 1 : 0; return typed(name === 'min' ? 'minMath' : 'max', anon(vs[1]) ? { b: vs[1].lit } : {}, { a: asRef(vs[0]), ...(!anon(vs[1]) ? { b: asRef(vs[1]) } : {}) }, 'result', 'float'); } break;
      case 'clamp': if (vs.length === 3 && vs[1].type === 'float' && vs[2].type === 'float') return typed('clamp', { ...(anon(vs[1]) ? { lo: vs[1].lit } : {}), ...(anon(vs[2]) ? { hi: vs[2].lit } : {}) }, { input: asRef(vs[0]), ...(!anon(vs[1]) ? { lo: asRef(vs[1]) } : {}), ...(!anon(vs[2]) ? { hi: asRef(vs[2]) } : {}) }, 'result', t); break;
      case 'mix': if (vs.length === 3 && vs[2].type === 'float' && vs[0].type === vs[1].type) return typed('mix', anon(vs[2]) ? { t: vs[2].lit } : {}, { a: asRef(vs[0]), b: asRef(vs[1]), ...(!anon(vs[2]) ? { t: asRef(vs[2]) } : {}) }, 'result', vs[0].type); break;
      case 'smoothstep': if (vs.length === 3 && vs[0].type === 'float' && vs[1].type === 'float') { report.stats.sliders += (anon(vs[0]) ? 1 : 0) + (anon(vs[1]) ? 1 : 0); return typed('smoothstep', { ...(anon(vs[0]) ? { edge0: vs[0].lit } : {}), ...(anon(vs[1]) ? { edge1: vs[1].lit } : {}) }, { value: asRef(vs[2]), ...(!anon(vs[0]) ? { edge0: asRef(vs[0]) } : {}), ...(!anon(vs[1]) ? { edge1: asRef(vs[1]) } : {}) }, 'result', vs[2].type); } break;
      case 'step': if (vs.length === 2 && allF) return typed('step', {}, { edge: asRef(vs[0]), x: asRef(vs[1]) }, 'result', 'float'); break;
      case 'mod': if (vs.length === 2 && vs[1].type === 'float') return typed('mod', anon(vs[1]) ? { period: vs[1].lit } : {}, { input: asRef(vs[0]), ...(!anon(vs[1]) ? { period: asRef(vs[1]) } : {}) }, 'output', vs[0].type); break;
      case 'atan': if (vs.length === 2 && allF) return typed('atan2', {}, { y: asRef(vs[0]), x: asRef(vs[1]) }, 'angle', 'float'); break;
      case 'pow': if (vs.length === 2 && allF) {
        const w = inexact(a, 'The Pow node clamps its base to ≥ 0 (GLSL leaves a negative base undefined)');
        if (!w) throw new Unmapped('pow kept as code (your choice)');
        return warned(typed('pow', anon(vs[1]) ? { exponent: vs[1].lit } : {}, { base: asRef(vs[0]), ...(!anon(vs[1]) ? { exponent: asRef(vs[1]) } : {}) }, 'result', 'float'), w);
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
      const inner = new Set<string>(); for (const o of fns.get(c)!.overloads) collectCalls(parser.parse(o.source, { quiet: true }).program, inner);
      for (const d of inner) if (fns.has(d) && !need.has(d)) queue.push(d);
    }
    return withConsts([...fns.values()].filter(f => f.name !== 'main' && need.has(f.name)).flatMap(f => f.overloads.map(o => o.source)).join('\n\n'));
  }

  /**
   * A call to a function with `out` / `inout` parameters. GLSL wants variables
   * there, and a region's inputs are values, so the region declares locals for
   * them, makes the call, and returns everything the call produced (the return
   * value and each out argument) packed into one vector when they fit in four
   * components, else in several regions that each make the call again. Blocks
   * then pull each value back out and the out variables take the new values.
   * Returns the call's value, or null for a void function.
   */
  function outCall(a: Ast, env: Env, fn: UserFn): Val | null {
    const args = (a.args as Ast[] | undefined ?? []).filter(x => x.type !== 'literal');
    const outs = fn.params.map((p, i) => ({ p, arg: args[i] })).filter(x => x.p.qual !== 'in');
    for (const o of outs) if (!o.arg || o.arg.type !== 'identifier' || !env.has(o.arg.identifier as string)) throw new Unsupported(`${fn.name}(): the ${o.p.qual} argument ${o.arg ? generate(o.arg as never) : '?'} must be a variable`);
    const outNames = new Set(outs.map(o => o.arg.identifier as string));
    type Product = { name: string; type: T };
    const products: Product[] = [];
    if (fn.ret !== 'void') { if (!(fn.ret in N_OF)) throw new Unmapped(`${fn.name}() returns a ${fn.ret}`); products.push({ name: 'ret_', type: fn.ret as T }); }
    for (const o of outs) { if (!(o.p.type in N_OF)) throw new Unmapped(`${fn.name}(): ${o.p.qual} ${o.p.type} ${o.p.name}`); products.push({ name: o.arg.identifier as string, type: o.p.type as T }); }
    // Pack into groups of at most four components, in order.
    const groups: Product[][] = []; let cur: Product[] = []; let sum = 0;
    for (const p of products) { if (sum + N_OF[p.type] > 4) { groups.push(cur); cur = []; sum = 0; } cur.push(p); sum += N_OF[p.type]; }
    if (cur.length) groups.push(cur);
    // Inputs: what the call reads (out arguments excluded; inout ones come in under another name).
    const names = new Set<string>(); freeNames(a, names);
    const inputs: { name: string; type: T }[] = []; const wires: Record<string, Ref> = {}; const prelude: string[] = [];
    let code = generate(a as never);
    for (const n of names) {
      const o = outs.find(x => x.arg.identifier === n);
      if (o) {
        const t = o.p.type as T;
        if (o.p.qual === 'inout') { const v = env.get(n)!; inputs.push({ name: `${n}_in`, type: v.type }); wires[`${n}_in`] = asRef(v); prelude.push(`${t} ${n} = ${n}_in;`); }
        else prelude.push(`${t} ${n} = ${t === 'float' ? '0.0' : `${t}(0.0)`};`);
      }
      else if (env.has(n)) { const v = env.get(n)!; inputs.push({ name: n, type: v.type }); wires[n] = asRef(v); }
      else if (SOURCES[n]) { const s = SOURCES[n]; inputs.push({ name: s.name, type: s.t }); wires[s.name] = srcRef(n); code = code.replace(new RegExp(`\\b${n}\\b`, 'g'), s.name); }
      else if (!fns.has(n)) throw new Unsupported(`Unknown identifier ${n}`);
    }
    const helpers = helpersFor(a);
    const callLine = fn.ret === 'void' ? `${code};` : `${fn.ret} ret_ = ${code};`;
    const results = new Map<string, Val>();
    groups.forEach((g, gi) => {
      const total = g.reduce((s, p) => s + N_OF[p.type], 0);
      const outT = VEC_T[total];
      const ret = g.length === 1 ? g[0].name : `${outT}(${g.map(p => p.name).join(', ')})`;
      const body = `${prelude.join('\n')}\n${callLine}\nreturn ${ret};`;
      const label = `${fn.name}${groups.length > 1 ? ` (${gi + 1}/${groups.length})` : ''}`;
      const n = mk('customFn', { __importedCode: 'region', label, inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: null })), outputType: outT, body, glslFunctions: helpers }, { ...wires },
        { inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type as DataType, label: i.name }])), outputs: { result: { type: outT as DataType, label: 'Result' } } });
      const packed: Val = { ref: ref(n, 'result', outT), type: outT, ast: a };
      if (g.length === 1) { results.set(g[0].name, packed); return; }
      let off = 0;
      for (const p of g) {
        const sw = 'xyzw'.slice(off, off + N_OF[p.type]); off += N_OF[p.type];
        const ex = mk('exprNode', { __importedCode: 'block', inputs: [{ name: 'v', type: outT, slider: null }], outputType: p.type, lines: [], result: `v.${sw}`, expr: `v.${sw}` }, { v: packed.ref },
          { inputs: { v: { type: outT as DataType, label: 'v' } }, outputs: { result: { type: p.type as DataType, label: 'Result' } } });
        results.set(p.name, { ref: ref(ex, 'result', p.type), type: p.type, ast: a });
      }
    });
    report.regions.push({ code: generate(a as never), why: `call to ${fn.name}() with ${[...outNames].join(', ')} as out argument${outNames.size === 1 ? '' : 's'}` });
    for (const o of outs) env.set(o.arg.identifier as string, { ...results.get(o.arg.identifier as string)!, name: o.arg.identifier as string });
    return results.get('ret_') ?? null;
  }

  // ── Rung 3: a Custom Function node for a region ────────────────────────────
  function region(a: Ast, env: Env, why: string, stmtCode?: string, outVar?: string): Val {
    const t = typeOf(a, env);
    const { inputs, wires, code } = inputsFor(a, env);
    const helpers = helpersFor(a);
    const body = stmtCode ? `${stmtCode}\n  return ${outVar};` : `return ${code};`;
    const n = mk('customFn', { __importedCode: 'region', label: why.replace(/^call to /, '').replace(/\(\)$/, '') || 'Region', inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: null })), outputType: t, body, glslFunctions: helpers }, { ...wires },
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
      { const v = expr(rhsAst, env); env.set(name, v.lit !== undefined ? { ...v, name: v.name ?? name } : v); }
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
  /**
   * A for loop as an iterated group: the body's nodes inside a group that runs
   * `count` times, a Loop Index for the loop variable, and a Loop Carry for
   * each outer variable the body changes (init from outside, next from the
   * body's last value, the final value on an output port). Other outer values
   * the body reads come in through ports. The compiler pairs input and output
   * ports by position as carries, so the carry init ports go first, in the
   * output ports' order: that pairing then names the same carries.
   */
  function loopGroup(s: Ast, env: Env, name: string, start: number, step: number, count: number): void {
    const assigned = new Set<string>(); assignedNames(s.body, assigned);
    const carried = [...assigned].filter(n => env.has(n) && n !== name);
    // The carries' starting values, as nodes in the scope outside the loop.
    const inits = new Map(carried.map(v => [v, asRef(env.get(v)!)]));
    const ctx: LoopCtx = { ports: new Map(), inputPorts: [], wires: {}, sockets: {}, outerSink: sink };
    const inner: GraphNode[] = [];
    const savedSink = sink, savedCtx = loopCtx;
    sink = inner; loopCtx = ctx;
    const carries = new Map<string, GraphNode>();
    const innerEnv: Env = new Map();
    try {
      for (const v of carried) {
        const t = env.get(v)!.type;
        const c = mk('loopCarry', { dataType: t }, { init: portRef(ctx, inits.get(v)!, v) },
          { inputs: { init: { type: t as DataType, label: 'Init' }, next: { type: t as DataType, label: 'Next' } }, outputs: { value: { type: t as DataType, label: 'Value' } } });
        carries.set(v, c);
        innerEnv.set(v, { ref: ref(c, 'value', t), type: t, ast: { type: 'carry' } });
      }
      // Outer variables the body only reads: through ports (a literal travels as itself).
      const used = new Set<string>(); freeNames(s.body, used);
      for (const [k, v] of env) {
        if (carries.has(k) || !used.has(k)) continue;
        innerEnv.set(k, v.ref ? { ref: portRef(ctx, v.ref, k), type: v.type, ast: v.ast } : v);
      }
      // The loop variable: the group's index, scaled and offset when the loop doesn't count 0, 1, 2…
      const idx = mk('loopIndex', {}, {});
      let iv: Val = { ref: ref(idx, 'i', 'float'), type: 'float', ast: { type: 'loopvar' } };
      if (step !== 1) iv = typed('multiply', { b: step }, { a: asRef(iv) }, 'result', 'float');
      if (start !== 0) iv = typed('add', { b: start }, { a: asRef(iv) }, 'result', 'float');
      innerEnv.set(name, iv);
      stmt(s.body as Ast, innerEnv);
      for (const [v, c] of carries) { const nx = asRef(innerEnv.get(v)!); c.inputs.next.connection = { nodeId: nx.nodeId, outputKey: nx.outputKey }; }
    } finally { sink = savedSink; loopCtx = savedCtx; }
    // The group's terminals draw a wire to a port's first reader.
    for (const p of ctx.inputPorts) {
      const reader = inner.find(n => Object.values(n.inputs).some(i => i.connection?.nodeId === GROUP_PORT_SENTINEL && i.connection.outputKey === p.key));
      if (reader) { p.toNodeId = reader.id; p.toInputKey = Object.entries(reader.inputs).find(([, i]) => i.connection?.nodeId === GROUP_PORT_SENTINEL && i.connection.outputKey === p.key)![0]; }
    }
    const outputPorts: GroupOutputPort[] = []; const outSockets: GraphNode['outputs'] = {};
    carried.forEach((v, k) => {
      const c = carries.get(v)!; const t = c.outputs.value.type;
      outputPorts.push({ key: `out${k}`, type: t, label: v, fromNodeId: c.id, fromOutputKey: 'value' });
      outSockets[`out${k}`] = { type: t, label: v };
    });
    const label = `for ${name}: ${count}×`;
    const g = mk('group', { label, iterations: count, subgraph: { nodes: inner, inputPorts: ctx.inputPorts, outputPorts } }, ctx.wires, { inputs: ctx.sockets, outputs: outSockets });
    carried.forEach((v, k) => { const t = env.get(v)!.type; env.set(v, { ref: ref(g, `out${k}`, t), type: t, ast: s }); });
    subgraphs.push(inner);
    report.stats.loops++;
    report.notes.push(`Loop over ${name} (${count}×) is an iterated group${carried.length ? ` carrying ${carried.join(', ')}` : ''}`);
  }
  function hasAny(a: unknown, types: string[]): boolean {
    if (Array.isArray(a)) return a.some(x => hasAny(x, types));
    if (!a || typeof a !== 'object') return false;
    const n = a as Ast;
    if (types.includes(n.type)) return true;
    return Object.entries(n).some(([k, v]) => k !== 'type' && hasAny(v, types));
  }
  /** A loop that can't be a group: a Custom Function running it, when it changes one live variable. */
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
          // A number keeps the first name it was given: `float k = SIZE;` reads SIZE's constant, not a second one.
          if (d.initializer) { const v = expr(d.initializer as Ast, env); env.set(name, v.lit !== undefined ? { ...v, name: v.name ?? name } : v); }
          else env.set(name, { lit: ty === 'float' || ty === 'int' ? 0 : undefined, type: (ty in N_OF ? ty : 'float') as T, ast: { type: 'zero' } });
        }
        return;
      }
      case 'expression_statement': {
        const e = s.expression as Ast;
        if (e.type === 'assignment') { assign(e.left as Ast, (e.operator as Ast).literal as string, e.right as Ast, env); return; }
        if (e.type === 'function_call') {
          const c = calleeOf(e.identifier as Ast); const u = c.ctor ? undefined : fns.get(c.name);
          if (u) { const o = overloadFor(u, (e.args as Ast[] | undefined ?? []).filter(x => x.type !== 'literal'), env); if (o.params.some(p => p.qual !== 'in')) { outCall(e, env, o); return; } }
        }
        // x++ / x-- / ++x / --x on a named value: x += 1.0 (a float or a vector, Add broadcasts).
        const incOf = (n: Ast): { target: Ast; op: string } | null => {
          if (n.type === 'postfix') { const pf = n.postfix as Ast; const lit = ((pf.operator as Ast)?.literal as string | undefined) ?? (pf.literal as string | undefined) ?? pf.type; if (lit === '++' || lit === '--') return { target: n.expression as Ast, op: lit }; }
          if (n.type === 'unary') { const lit = (n.operator as Ast)?.literal as string | undefined; if (lit === '++' || lit === '--') return { target: n.expression as Ast, op: lit }; }
          return null;
        };
        const inc = incOf(e);
        if (inc) { assign(inc.target, inc.op === '++' ? '+=' : '-=', { type: 'float_constant', token: '1.0' } as Ast, env); return; }
        throw new Unmapped(`statement ${e.type}`);
      }
      case 'compound_statement': stmts(s.statements as Ast[], env); return;
      case 'if_statement': {
        const cond = s.condition as Ast;
        const thenEnv = new Map(env), elseEnv = new Map(env);
        stmt(s.body as Ast, thenEnv);
        // The parser gives `else` as a node, or as [keyword, statement] on some shapes.
        const rawElse = s.else as Ast | Ast[] | undefined;
        const els = Array.isArray(rawElse) ? rawElse.filter(x => x.type !== 'keyword' && x.type !== 'literal').pop() : rawElse;
        if (els && els.type !== 'literal') stmt(els.type === 'keyword' ? (s.elseBody as Ast) : els, elseEnv);
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
          // An iterated group runs up to 16 times and has no early exit; a loop inside a loop stays code.
          const exits = hasAny(s.body, ['break_statement', 'continue_statement', 'return_statement', 'discard_statement']);
          if (count >= 1 && count <= 16 && !exits && !loopCtx) { loopGroup(s, env, name, start, step, count); return; }
        }
        return loopRegion(s, env, name);
      }
      case 'return_statement': case 'discard_statement': case 'break_statement': case 'continue_statement': case 'while_statement': case 'do_statement': case 'switch_statement':
        throw new Unsupported(`${s.type.replace('_statement', '')} in main()`);
      default: throw new Unmapped(`statement ${s.type ?? JSON.stringify(s).slice(0, 120)}`);
    }
  }

  // ── Go ─────────────────────────────────────────────────────────────────────
  const env: Env = new Map();
  try {
    // Global consts are the shader's dials: values in the environment, so main() and blocks read them
    // (regions also get their text). One a graph can't hold (a matrix) stays text-only.
    for (const c of consts) {
      if (!c.init) continue;
      try { const v = expr(c.init, env); env.set(c.name, v.lit !== undefined ? { ...v, name: v.name ?? c.name } : v); }
      catch (e) { if (!(e instanceof Unsupported || e instanceof Unmapped)) throw e; }
    }
    stmts(((main!.body as Ast).statements as Ast[]), env);
    if (!output) report.unsupported.push('main() never writes gl_FragColor');
  } catch (e) {
    if (e instanceof Unsupported || e instanceof Unmapped) report.unsupported.push(e.why); else throw e;
  }
  if (report.unsupported.length) return { nodes: [], report };

  // Nodes nothing reads (a const the shader never used, a split only half read) go.
  for (const g of nodes) if (g.type === 'group') { const sg = g.params.subgraph as { nodes: GraphNode[]; outputPorts: { fromNodeId: string }[] }; prune(sg.nodes, new Set(sg.outputPorts.map(p => p.fromNodeId))); }
  prune(nodes, new Set());
  layout(nodes);
  for (const sg of subgraphs) layout(sg);
  report.stats = { nodes: nodes.length, blocks: report.blocks.length, regions: report.regions.length, sliders: report.stats.sliders, loops: report.stats.loops };
  return { nodes, report };
}

/**
 * `mainImage(out vec4 fragColor, in vec2 fragCoord)` becomes main(), iTime and
 * friends become u_time…, so a pasted Shadertoy shader converts like our own.
 */
interface MacroDef { name: string; params: string[] | null; body: string }
const MACRO_LINE = /^[ \t]*#define[ \t]+(\w+)(\(([^)]*)\))?(?:[ \t]+([^\n]*?))?[ \t]*$/gm;
function collectMacros(src: string): { stripped: string; defs: MacroDef[] } {
  const defs: MacroDef[] = [];
  const stripped = src.replace(MACRO_LINE, (whole, name: string, paren: string | undefined, params: string | undefined, raw: string | undefined) => {
    const body = (raw ?? '').replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim();
    if (!body && !paren) return whole; // a flag for #ifdef: the preprocessor's business
    defs.push({ name, params: paren ? params!.split(',').map(p => p.trim()).filter(Boolean) : null, body });
    return '';
  });
  return { stripped, defs };
}
/** Expand macros until nothing changes (bounded); a call's arguments split at top-level commas. */
function expandMacros(src: string, defs: MacroDef[]): string {
  const byName = new Map(defs.map(d => [d.name, d]));
  const subst = (body: string, params: string[], args: string[]) => body.replace(/\b([A-Za-z_]\w*)\b/g, (w, id: string) => { const i = params.indexOf(id); return i >= 0 ? (args[i] ?? '') : w; });
  let s = src;
  for (let pass = 0; pass < 24; pass++) {
    let out = '', changed = false, i = 0;
    while (i < s.length) {
      const c = s[i];
      if (!/[A-Za-z_]/.test(c) || (i > 0 && /[\w.]/.test(s[i - 1]))) { out += c; i++; continue; }
      let j = i + 1; while (j < s.length && /\w/.test(s[j])) j++;
      const id = s.slice(i, j); const d = byName.get(id);
      if (!d) { out += id; i = j; continue; }
      if (!d.params) { out += `(${d.body})`; i = j; changed = true; continue; }
      let k = j; while (k < s.length && /\s/.test(s[k])) k++;
      if (s[k] !== '(') { out += id; i = j; continue; }
      // Arguments to the matching `)`, split at depth 0.
      let depth = 1, p = k + 1; const args: string[] = []; let cur = '';
      for (; p < s.length && depth > 0; p++) { const ch = s[p]; if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth === 0) break; } if (ch === ',' && depth === 1) { args.push(cur); cur = ''; continue; } cur += ch; }
      if (depth !== 0) { out += id; i = j; continue; }
      args.push(cur);
      out += `(${subst(d.body, d.params, args.map(a => a.trim()))})`;
      i = p + 1; changed = true;
    }
    s = out;
    if (!changed) break;
  }
  return s;
}

export function normaliseHostShader(source: string): { code: string; toSourceLine: (line: number) => number } { return hostToOurs(source, { notes: [], warnings: [], blocks: [], regions: [], unsupported: [], stats: { nodes: 0, blocks: 0, regions: 0, sliders: 0, loops: 0 } }); }

function hostToOurs(source: string, report: ConversionReport): { code: string; toSourceLine: (line: number) => number } {
  // Another host's names (Shadertoy, GLSL Sandbox, twigl, ES 3.00) become ours first.
  const tr = translateToStudio(source, { lowerReturns: true });
  if (tr.dialect !== 'studio') report.notes.push(`Read as ${dialectLabel(tr.dialect)}: ${tr.notes.join('; ')}`);
  for (const u of tr.unsupported) report.notes.push(u);
  // A global that main() assigns and helpers read travels as a parameter instead (threadGlobals.ts).
  const th = threadGlobals(tr.code);
  let s = th.code;
  report.notes.push(...th.notes);
  // The compiled shader defines PI and TAU as macros; a shader's own constant of that name would be a macro clash.
  for (const name of ['PI', 'TAU']) if (new RegExp(`\\b(?:const\\s+)?(?:float|int)\\s+${name}\\s*=`).test(s)) s = s.replace(new RegExp(`(?<![\\w.])${name}\\b`, 'g'), `${name}_`);
  // A function named like one of the app's always-included helpers (smin, fbm, rot2d…) would lose to it: rename ours.
  const own = new Set<string>();
  for (const m of s.matchAll(/\b(?:float|vec[234]|mat[234]|int|bool|void)\s+([A-Za-z_]\w*)\s*\(/g)) if (m[1] !== 'main') own.add(m[1]);
  const clashes = [...own].filter(n => BUILTIN_HELPER_NAMES.has(n));
  for (const n of clashes) s = s.replace(new RegExp(`\\b${n}\\b`, 'g'), `${n}_`);
  if (clashes.length) report.notes.push(`Renamed ${clashes.join(', ')}: the app has a built-in helper of that name`);
  // Simple object-like macros (#define PI 3.14159) are expanded; anything else the preprocessor would do is left to fail loudly.
  // Object-like (`#define PI 3.14`) and function-like (`#define K(U) smoothstep(.2, .0, length(U))`) macros
  // are expanded the way the preprocessor would: arguments substituted, the result rescanned, so a macro
  // may use another. A comment after the value is a comment, not part of it; a bare flag stays for #ifdef.
  // Comments go (newlines kept, so lines still map): a commented-out #define or a name in prose is not code.
  s = s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
  const macros = collectMacros(s);
  s = macros.stripped;
  if (macros.defs.length) s = expandMacros(s, macros.defs);
  if (macros.defs.length) report.notes.push(`${macros.defs.length} #define${macros.defs.length === 1 ? '' : 's'} expanded`);
  // Precision, uniform and varying lines are the host's, not the shader's (the translator adds the ones a paste lacks).
  // Lines are blanked, not removed, so an error's line number still points into the paste.
  s = s.replace(/^[ \t]*precision\s+\w+\s+float\s*;[ \t]*$/gm, '').replace(/^[ \t]*varying\s+vec2\s+vUv\s*;[ \t]*$/gm, '');
  return { code: s, toSourceLine: tr.toSourceLine };
}

/** The functions the compiled shader always defines; a user function of the same name is renamed on the way in. */
const BUILTIN_HELPER_NAMES = new Set([...ALWAYS_HELPERS_GLSL().matchAll(/\b(?:float|vec[234]|mat[234]|int|bool|void)\s+([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]));

function tokenOf(spec: Ast | undefined): string {
  if (!spec) return '';
  if (typeof spec.token === 'string') return spec.token;
  if (spec.specifier) return tokenOf(spec.specifier as Ast);
  if (spec.identifier && typeof (spec.identifier as Ast).identifier === 'string') return (spec.identifier as Ast).identifier as string;
  if (typeof spec.identifier === 'string') return spec.identifier;
  return '';
}

/** A slider range that shows a literal comfortably: symmetric around zero for small values, 0..2× for larger ones. */
function sliderRange(v: number): { min: number; max: number } {
  const a = Math.abs(v);
  if (a <= 1) return { min: v < 0 ? -1 : 0, max: 1 };
  const top = Math.pow(10, Math.ceil(Math.log10(a * 2)));
  return { min: v < 0 ? -top : 0, max: top };
}

/** Drop nodes nothing reads, repeatedly, keeping outputs and `keep`. */
function prune(list: GraphNode[], keep: Set<string>): void {
  for (;;) {
    const used = new Set(keep);
    for (const n of list) for (const s of Object.values(n.inputs)) if (s.connection) used.add(s.connection.nodeId);
    const before = list.length;
    for (let i = list.length - 1; i >= 0; i--) { const n = list[i]; if (n.type === 'output' || n.type === 'vec4Output' || used.has(n.id)) continue; list.splice(i, 1); }
    if (list.length === before) return;
  }
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
