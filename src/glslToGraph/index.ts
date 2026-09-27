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
 *   2. a block   anything rung 1 can't express (a ternary, fwidth, a matrix
 *                that isn't a rotation) becomes an Expression Block
 *                whose inputs are the live variables it reads and whose
 *                expression is the original sub-expression, verbatim.
 *   3. a region  a helper function call, or a loop the converter can't unroll,
 *                becomes a Custom Function node carrying that code.
 *
 * `report` says what landed on which rung and why, for the preview step.
 * Constructs nothing can hold (textures, a uniform a helper reads, uint) are
 * reported as unsupported and the caller keeps the whole-shader import.
 * `discard` is alpha 0 through an RGBA Output; a uniform no node stands for
 * is a live Constants entry and a Play control (`controls`).
 */
import { parser, generate } from '@shaderfrog/glsl-parser';
import { GROUP_PORT_SENTINEL, type GraphNode, type InputSocket, type DataType, type GroupInputPort, type GroupOutputPort } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { swizzleIndices } from '../nodes/definitions/math';
import { layoutByRank } from '../store/graphLayout';
import { translateToStudio, dialectLabel } from '../glsl/dialects';
import { threadGlobals } from './threadGlobals';
import { stripComments } from '../glsl/comments';
import { ES3_INTEGER, ES3_INTEGER_NOTE } from '../glsl/dialects';
import type { ConstantsItem } from '../nodes/definitions/constants';
import type { PlayControl } from '../types/play';
import { ALWAYS_HELPERS_GLSL } from '../compiler/shaderAssembler';

type T = 'float' | 'vec2' | 'vec3' | 'vec4';
interface Ref { nodeId: string; outputKey: string; type: T; /** A literal's value and, when it initialised a variable, that name. */ lit?: number; name?: string }
/** A value in flight: a node output, or a float literal not yet spent on a slider. */
interface Val {
  ref?: Ref; lit?: number; type: T; ast: Ast;
  /** The variable a literal initialised, so its slider can carry the name. */ name?: string;
  /** An `int` in the shader. The graph carries it as a float (the same number); code kept as text gets it back as an int. */ int?: boolean;
  /**
   * A mat2 that is a rotation by `angle`: `dir` 1 when m * v turns v by +angle (mat2(c, s, -s, c)), -1 when
   * by -angle (mat2(c, -s, s, c)). Times a vec2 it is a Rotate 2D node; `ref` is the matrix as code, for anything else.
   */
  rot?: { angle: Val; dir: 1 | -1 };
}
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
  blocks: { code: string; why: string; nodeId?: string }[];
  /** Statement regions that became Custom Function nodes. */
  regions: { code: string; why: string; nodeId?: string }[];
  /** Why the shader can't be a graph at all (empty when it can). */
  unsupported: string[];
  /** When the shader doesn't parse: the line of the paste the parser stopped at. */
  errorLine?: number;
  stats: { nodes: number; blocks: number; regions: number; sliders: number; loops: number };
  /** Uniforms that became Play controls, with their starting values. */
  uniforms?: ConvertedUniform[];
}

export interface ConversionResult {
  nodes: GraphNode[]; report: ConversionReport;
  /** A Play control for each uniform the shader declared that no node stands for (see `ConversionReport.uniforms`). */
  controls?: PlayControl[];
}
/** A uniform no node stands for, now a live entry on the Constants card; `value` is what it starts at (the check sets the original's uniform to it). */
export interface ConvertedUniform { name: string; type: 'float' | 'int' | 'vec2' | 'vec3'; value: number | number[]; min: number; max: number; step: number; colour: boolean }

class Unmapped extends Error { why: string; constructor(why: string) { super(why); this.why = why; } }
class Unsupported extends Error { why: string; constructor(why: string) { super(why); this.why = why; } }

const SOURCES: Record<string, { type: string; out: string; t: T; name: string }> = {
  gl_FragCoord: { type: 'fragCoord', out: 'coord', t: 'vec2', name: 'fragCoord' },
  u_resolution: { type: 'resolution', out: 'res', t: 'vec2', name: 'resolution' },
  u_time: { type: 'time', out: 'time', t: 'float', name: 'time' },
  // u_mouse is in pixels, like gl_FragCoord: the Mouse node's Pixels output, not its centred UV.
  u_mouse: { type: 'mouse', out: 'px', t: 'vec2', name: 'mouse' },
  // vUv (0..1 both ways) has no node of its own: it's fragCoord / resolution, built on demand (see srcRef).
  vUv: { type: 'divide', out: 'result', t: 'vec2', name: 'screenUV' },
};
const VEC_T: Record<number, T> = { 1: 'float', 2: 'vec2', 3: 'vec3', 4: 'vec4' };
const N_OF: Record<T, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
/** Built-ins that return their (widest vector) argument's type. */
const SAME_T = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'exp', 'exp2', 'log', 'log2', 'sqrt', 'inversesqrt', 'abs', 'sign', 'floor', 'ceil', 'fract', 'round', 'roundEven', 'trunc', 'mod', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'pow', 'normalize', 'reflect', 'refract', 'faceforward', 'dFdx', 'dFdy', 'fwidth', 'radians', 'degrees']);
/** Built-ins that give back an int when every argument is one (GLSL ES 3.00 has int overloads). */
const INT_SAME = new Set(['abs', 'sign', 'min', 'max', 'clamp']);
const FLOAT_T = new Set(['length', 'distance', 'dot', 'determinant']);
/** Polymorphic nodes: the sockets that take the card's chosen type (the rest stay float). */
const POLY: Record<string, string[]> = {
  add: ['a', 'b', 'result'], subtract: ['a', 'b', 'result'], multiply: ['a', 'b', 'result'], divide: ['a', 'b', 'result'],
  sin: ['input', 'output'], cos: ['input', 'output'], tan: ['input', 'output'], exp: ['input', 'output'], negate: ['input', 'output'],
  floor: ['input', 'output'], fractRaw: ['input', 'output'], clamp: ['input', 'result'], mix: ['a', 'b', 'result'],
  smoothstep: ['value', 'result'], mod: ['input', 'output'], sign: ['value', 'result'], sqrt: ['input', 'output'],
  abs: ['input', 'output'], ceil: ['input', 'output'], tanh: ['input', 'output'], pow: ['base', 'result'],
  // B (min/max), the edge (step) and the exponent (pow) stay float unless the shader gives a vector: see `retype`.
  minMath: ['a', 'result'], max: ['a', 'result'], step: ['x', 'result'],
  // Any vector in, a float out: outputType is the input's type.
  length: ['input'], dot: ['a', 'b'], normalizeVec2: ['v', 'result'],
};
/** The converter's Divide, Pow and Square Root are the plain GLSL call (their Exact switch on), so the picture is the code's. */
const EXACT = new Set(['divide', 'pow', 'sqrt']);
/** Whether the pixel is kept so far (1) or has been discarded (0): a value like any other, merged by if/else. */
const KEPT = 'kept_';
/** The patterns the Vec2 / Vec3 Swizzle cards offer; anything else is a general Swizzle card. */
const SWIZZLE_MODES: Record<number, string[]> = { 2: ['yx', 'xx', 'yy'], 3: ['yzx', 'zxy', 'xxy', 'xyy', 'xxx', 'yyy', 'zzz', 'zyx'] };

export function glslToGraph(source: string, options: ConversionOptions = {}): ConversionResult {
  const report: ConversionReport = { notes: [], warnings: [], blocks: [], regions: [], unsupported: [], stats: { nodes: 0, blocks: 0, regions: 0, sliders: 0, loops: 0 } };
  // Divide, Pow and Square Root come out with their Exact switch on (the plain GLSL call), so no
  // expression is offered as an inexact node any more; `warnings` and `options.asBlock` stay for the page.
  void options;
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
        else if (isConst) {
          // An array keeps its brackets (`const vec3 nbs[] = vec3[8](…)`); it is text for regions only.
          const dims = ((d.quantifier as Ast[] | undefined) ?? []).map(q => `[${q.expression ? generate(q.expression as never).trim() : ''}]`).join('');
          consts.push({ name: n, type: ty, init: dims ? undefined : d.initializer as Ast | undefined, text: `const ${ty} ${n}${dims} = ${generate(d.initializer as never)};` });
        }
        else globals.add(n);
      }
      if (decl.type === 'precision') continue;
    }
  }
  /** The program's const declarations, as text every region carries (the assembler emits repeats once). */
  const constText = consts.map(c => c.text).join('\n');
  const withConsts = (helpers: string) => [constText, helpers].filter(Boolean).join('\n\n');
  // A uniform no node stands for is a slider: a live entry on the Constants card, and a Play control.
  // Only main() can read it that way; a helper function would need it passed along.
  const live: ConvertedUniform[] = [];
  for (const [u, ty] of uniforms) {
    if (SOURCES[u] || ['sampler2D', 'samplerCube'].includes(ty)) continue;
    if (!['float', 'int', 'vec2', 'vec3'].includes(ty)) { report.unsupported.push(`Uniform ${ty} ${u} has no source node (only time, resolution, mouse, fragCoord are known; a float, int, vec2 or vec3 uniform becomes a Play control)`); continue; }
    const reader = [...fns.values()].find(f => f.name !== 'main' && f.overloads.some(o => new RegExp(`\\b${u}\\b`).test(o.source)));
    if (reader) { report.unsupported.push(`Uniform ${ty} ${u} is read inside ${reader.name}(), which can’t reach a Play control; pass it to the function as a parameter, or make it a constant`); continue; }
    live.push(uniformDefault(u, ty as ConvertedUniform['type']));
  }
  for (const [u, ty] of uniforms) if (['sampler2D', 'samplerCube'].includes(ty)) report.unsupported.push(`Texture ${u}: textures can't be imported yet`);
  if (globals.size) report.unsupported.push(`Global ${[...globals].join(', ')}: a global array (or struct) that a function reads can't be passed along yet. Give the function what it needs as a parameter, or keep the shader as one node.`);
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
    const node = { id: id(type), type, position: { x: 0, y: 0 }, inputs, outputs, params: { ...(def?.defaultParams ?? {}), ...params, ...(EXACT.has(type) ? { exact: true } : {}) } } as GraphNode;
    sink.push(node);
    return node;
  }
  const ref = (n: GraphNode, out: string, t: T): Ref => ({ nodeId: n.id, outputKey: out, type: t });
  /** Component i of a vector, through one shared Split card per vector per scope (p.x + p.y reads the same card twice). */
  function component(v: Val, i: number): Ref {
    const n = N_OF[v.type];
    const src = asRef(v); const key = `${src.nodeId}:${src.outputKey}`;
    let scope = splits.get(sink); if (!scope) { scope = new Map(); splits.set(sink, scope); }
    let split = scope.get(key); if (!split) { split = mk(`splitVec${n}`, {}, { v: src }); scope.set(key, split); }
    return ref(split, 'xyzw'[i], 'float');
  }
  /** Make Vec2/3/4 from components (a literal one becomes that card's slider). */
  function makeVec(n: number, parts: Ref[]): Val {
    if (n === 2) return typed('makeVec2', {}, { x: parts[0], y: parts[1] }, 'xy', 'vec2');
    if (n === 3) return typed('makeVec3', {}, { r: parts[0], g: parts[1], b: parts[2] }, 'rgb', 'vec3');
    return typed('makeVec4', {}, { x: parts[0], y: parts[1], z: parts[2], w: parts[3] }, 'xyzw', 'vec4');
  }
  /**
   * Is mat2(a, b, c, d) a rotation: cos and sin of one angle, as mat2(c, -s, s, c) or mat2(c, s, -s, c)?
   * The trig was just built as Cos / Sin cards (freq 1, amp 1), so "one angle" is one wire into them.
   */
  function rotationOf(vs: Val[]): Val['rot'] | null {
    const trig = (v: Val) => {
      let n = sink.find(x => x.id === v.ref?.nodeId); let neg = false;
      if (n?.type === 'negate' && (n.params.outputType ?? 'float') === 'float') { const c = n.inputs.input?.connection; neg = true; n = c ? sink.find(x => x.id === c.nodeId) : undefined; }
      if (!n || (n.type !== 'sin' && n.type !== 'cos') || n.params.freq !== 1 || n.params.amp !== 1 || (n.params.outputType ?? 'float') !== 'float') return null;
      const c = n.inputs.input?.connection;
      const angle: Val = c ? { ref: { nodeId: c.nodeId, outputKey: c.outputKey, type: 'float' }, type: 'float', ast: { type: 'made' } } : { lit: Number(n.params.input ?? 0), type: 'float', ast: { type: 'made' } };
      return { fn: n.type, neg, key: c ? `${c.nodeId}:${c.outputKey}` : `=${angle.lit}`, angle };
    };
    const t = vs.map(v => (v.type === 'float' ? trig(v) : null));
    if (t.some(x => !x) || new Set(t.map(x => x!.key)).size !== 1) return null;
    const sig = t.map(x => `${x!.neg ? '-' : ''}${x!.fn}`).join(',');
    if (sig === 'cos,-sin,sin,cos') return { angle: t[0]!.angle, dir: -1 };
    if (sig === 'cos,sin,-sin,cos') return { angle: t[0]!.angle, dir: 1 };
    return null;
  }
  /** v turned by the rotation (`sign` 1 for m * v, -1 for v * m, which is the transpose): a Rotate 2D node. */
  function rotate2d(v: Val, rot: NonNullable<Val['rot']>, sign: 1 | -1): Val {
    const a = rot.angle;
    const angle: Val = sign * rot.dir === 1 ? a : anon(a) ? { lit: -a.lit, type: 'float', ast: a.ast } : typed('negate', {}, { input: asRef(a) }, 'output', 'float');
    if (anon(angle)) report.stats.sliders++;
    return { ref: ref(mk('rotate2d', {}, { input: asRef(v), angle: asRef(angle) }), 'output', 'vec2'), type: 'vec2', ast: { type: 'made' } };
  }
  /**
   * A helper that does nothing but build a rotation from its one float parameter: -1 or 1 as in
   * `rotationOf`, else null. Its body is `return mat2(…)` of cos(p) / sin(p), or of floats first set to them.
   */
  function rotationFn(f: UserFn): 1 | -1 | null {
    if (f.ret !== 'mat2' || f.overloads.length > 1 || f.params.length !== 1 || f.params[0].type !== 'float' || f.params[0].qual !== 'in') return null;
    const P = f.params[0].name;
    let fnAst: Ast;
    try { fnAst = parser.parse(f.source, { quiet: true }).program[0] as unknown as Ast; } catch { return null; }
    const body = ((fnAst.body as Ast)?.statements as Ast[] | undefined) ?? [];
    const named = new Map<string, string>();
    const trigOfP = (e: Ast): string | null => {
      while (e.type === 'group') e = e.expression as Ast;
      if (e.type !== 'function_call') return null;
      const c = calleeOf(e.identifier as Ast); const args = ((e.args as Ast[] | undefined) ?? []).filter(x => x.type !== 'literal');
      return !c.ctor && (c.name === 'sin' || c.name === 'cos') && args.length === 1 && args[0].type === 'identifier' && args[0].identifier === P ? c.name : null;
    };
    for (const st of body.slice(0, -1)) {
      if (st.type !== 'declaration_statement') return null;
      for (const d of (((st.declaration as Ast).declarations as Ast[] | undefined) ?? [])) {
        const fn = d.initializer ? trigOfP(d.initializer as Ast) : null;
        if (!fn) return null;
        named.set((d.identifier as Ast).identifier as string, fn);
      }
    }
    const ret = body[body.length - 1];
    let m = ret?.type === 'return_statement' ? ret.expression as Ast : null;
    while (m?.type === 'group') m = m.expression as Ast;
    if (!m || m.type !== 'function_call' || tokenOf(m.identifier as Ast) !== 'mat2') return null;
    const sig = ((m.args as Ast[]) ?? []).filter(x => x.type !== 'literal').map(x0 => {
      let x = x0, neg = '';
      while (x.type === 'group') x = x.expression as Ast;
      if (x.type === 'unary' && (x.operator as Ast).literal === '-') { neg = '-'; x = x.expression as Ast; while (x.type === 'group') x = x.expression as Ast; }
      const fn = x.type === 'identifier' ? named.get(x.identifier as string) : trigOfP(x);
      return fn ? `${neg}${fn}` : '?';
    }).join(',');
    return sig === 'cos,-sin,sin,cos' ? -1 : sig === 'cos,sin,-sin,cos' ? 1 : null;
  }
  /** A socket the shader feeds with a vector where the card's is a float (pow's exponent, min's B, step's edge): typed to match. */
  function retype(v: Val, key: string, t: T): Val {
    const n = sink.find(x => x.id === v.ref?.nodeId);
    if (n?.inputs[key] && t !== 'float') n.inputs[key].type = t as DataType;
    return v;
  }
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
  /** `name[k]` with a known k (a literal, or a loop counter the unroller pinned) reads as the plain name `name#k`; the rest of a postfix chain is kept. */
  function deArray(a: Ast, env: Env): Ast {
    if (a.type !== 'postfix' || (a.expression as Ast).type !== 'identifier') return a;
    const name = (a.expression as Ast).identifier as string;
    let pf = a.postfix as Ast, rest: Ast | null = null;
    if (pf.type === 'postfix' && (pf.expression as Ast).type === 'quantifier') { rest = pf.postfix as Ast; pf = pf.expression as Ast; }
    if (pf.type !== 'quantifier') return a;
    const idx = pf.expression as Ast;
    let k = litOf(idx);
    if (k === null && idx.type === 'identifier') { const v = env.get(idx.identifier as string); if (v && v.lit !== undefined && v.ref === undefined) k = v.lit; }
    if (k === null || !Number.isInteger(k)) throw new Unmapped(`${name}[…] indexed by a value (only a fixed index, or a loop counter, is known)`);
    const elem: Ast = { type: 'identifier', identifier: `${name}_${k}` };
    if (!env.has(`${name}_${k}`)) throw new Unsupported(`${name}[${k}] is outside the array`);
    return rest ? { type: 'postfix', expression: elem, postfix: rest } : elem;
  }
  /** The same, everywhere in a tree: what a code block or region needs, since its text is generated from the tree. */
  function deArrayDeep(a: unknown, env: Env): unknown {
    if (Array.isArray(a)) return a.map(x => deArrayDeep(x, env));
    if (!a || typeof a !== 'object') return a;
    let n = a as Ast;
    if (n.type === 'postfix') { try { n = deArray(n, env); } catch (e) { if (e instanceof Unsupported) throw e; /* an index that is a value stays as written */ } }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) out[k] = k === 'type' ? v : deArrayDeep(v, env);
    return out;
  }
  function typeOf(a0: Ast, env: Env): T {
    const a = deArray(a0, env);
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
        if (op === ',') return typeOf(a.right as Ast, env);
        const l = typeOf(a.left as Ast, env), r = typeOf(a.right as Ast, env);
        if ((l as string).startsWith('mat')) return r; // mat * vec is a vec
        if ((r as string).startsWith('mat')) return l;
        return N_OF[l] >= N_OF[r] ? l : r;
      }
      case 'ternary': return typeOf(a.right as Ast, env);
      case 'assignment': return typeOf(a.left as Ast, env);
      case 'postfix': {
        const pf = a.postfix as Ast;
        if (pf.type === 'field_selection') { const sw = (pf.selection as Ast).identifier as string; return VEC_T[sw.length] ?? 'float'; }
        if (incLit(pf) === '++' || incLit(pf) === '--') return typeOf(a.expression as Ast, env);
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
        if (f) { const o = overloadFor(f, args, env); if (o.ret in N_OF || o.ret.startsWith('mat')) return o.ret as T; if (o.ret === 'int' || o.ret === 'bool') return 'float'; throw new Unsupported(`Function ${name} returns ${o.ret}`); }
        throw new Unmapped(`built-in ${name}`);
      }
      default: throw new Unmapped(`expression ${a.type}`);
    }
  }
  /** Is this expression an `int` in the shader (so code kept as text has to say float(…) to hand it on)? */
  function isIntExpr(a: Ast, env: Env): boolean {
    switch (a.type) {
      case 'int_constant': return true;
      case 'identifier': return !!env.get(a.identifier as string)?.int;
      case 'group': case 'unary': return isIntExpr(a.expression as Ast, env);
      case 'binary': {
        const op = (a.operator as Ast).literal as string;
        return ['+', '-', '*', '/', '%'].includes(op) && isIntExpr(a.left as Ast, env) && isIntExpr(a.right as Ast, env);
      }
      case 'ternary': return isIntExpr(a.right as Ast, env);
      case 'assignment': return isIntExpr(a.left as Ast, env);
      case 'postfix': { const pf = a.postfix as Ast; return pf.type !== 'field_selection' && pf.type !== 'quantifier' && isIntExpr(a.expression as Ast, env); }
      case 'function_call': {
        const c = calleeOf(a.identifier as Ast);
        if (c.ctor) return c.name === 'int';
        const f = fns.get(c.name);
        const args = (a.args as Ast[] | undefined ?? []).filter(x => x.type !== 'literal');
        if (f) return overloadFor(f, args, env).ret === 'int';
        return INT_SAME.has(c.name) && args.length > 0 && args.every(x => isIntExpr(x, env));
      }
      default: return false;
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

  function build(a0: Ast, env: Env): Val {
    const a = deArray(a0, env);
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
        const idx = swizzleIndices(sw);
        if (!n || n < 2 || !idx || idx.some(i => i >= n)) throw new Unmapped(`swizzle .${sw} on a ${v.type}`);
        if (sw.length === 1) return { ref: component(v, idx[0]), type: 'float', ast: a };
        if (sw.length === n && idx.every((c, i) => c === i)) return { ...v, ast: a };
        const mode = idx.map(i => comps[i]).join('');
        // The swap and the cyclic patterns keep their own cards (they say what they do); any other pattern is a Swizzle.
        if (sw.length === n && SWIZZLE_MODES[n]?.includes(mode)) return typed(`vec${n}Swizzle`, { mode }, { input: asRef(v) }, 'output', v.type);
        const outT = VEC_T[sw.length];
        return { ref: ref(mk('swizzle', { inputType: v.type, pattern: mode }, { input: asRef(v) }, { inputs: { input: { type: v.type as DataType, label: 'Input' } }, outputs: { output: { type: outT as DataType, label: 'Output' } } }), 'output', outT), type: outT, ast: a };
      }
      case 'function_call': return call(a, env);
      case 'ternary': throw new Unmapped('ternary');
      default: throw new Unmapped(`expression ${a.type}`);
    }
  }

  function binary(a: Ast, env: Env): Val {
    const op = (a.operator as Ast).literal as string;
    // `a, b` is b; the left side only counts for what it writes, which is code's business.
    if (op === ',') { const w: string[] = []; writesIn(a.left, w); if (!w.length) return { ...build(a.right as Ast, env), ast: a }; throw new Unmapped('the comma operator'); }
    // `7 / 2` between ints is 3: a Divide node would give 3.5.
    if (op === '/' && isIntExpr(a, env)) throw new Unmapped('integer division');
    const L = build(a.left as Ast, env), R = build(a.right as Ast, env);
    // A rotation matrix times a vec2 (either side) is a Rotate 2D node; any other matrix product is code.
    if (op === '*' && L.rot && R.type === 'vec2') return rotate2d(R, L.rot, 1);
    if (op === '*' && R.rot && L.type === 'vec2') return rotate2d(L, R.rot, -1);
    if (!(L.type in N_OF) || !(R.type in N_OF)) throw new Unmapped('matrix arithmetic');
    if (anon(L) && anon(R)) {
      const f = { '+': L.lit + R.lit, '-': L.lit - R.lit, '*': L.lit * R.lit, '/': L.lit / R.lit }[op];
      if (f !== undefined) return { lit: f, type: 'float', ast: a };
    }
    const t: T = N_OF[L.type] >= N_OF[R.type] ? L.type : R.type;
    const kind = { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide' }[op];
    if (!kind) throw new Unmapped(`operator ${op}`);
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
      if (tk === 'float' || tk === 'bool') { if (vs.length === 1 && vs[0].type === 'float') return { ...vs[0], int: undefined, ast: a }; throw new Unmapped(`${tk}() of a vector`); }
      if (tk === 'int') {
        if (vs.length !== 1 || vs[0].type !== 'float') throw new Unmapped('int() of a vector');
        if (anon(vs[0])) return { lit: Math.trunc(vs[0].lit), type: 'float', int: true, ast: a };
        // int() drops the fraction: the same number only when there is none (an int already, floor, ceil…).
        const whole = isIntExpr(args[0], env) || (args[0].type === 'function_call' && ['floor', 'ceil', 'round', 'trunc', 'roundEven'].includes(calleeOf(args[0].identifier as Ast).name));
        if (!whole) throw new Unmapped('int() drops the fraction');
        return { ...vs[0], int: true, ast: a };
      }
      if (tk === 'mat2' && vs.length === 4) { const r = rotationOf(vs); if (r) return { ...block(a, env, 'a rotation matrix, kept as code where it isn’t turning a vec2'), rot: r }; }
      if (tk !== 'vec2' && tk !== 'vec3' && tk !== 'vec4') throw new Unmapped(`constructor ${tk}(${vs.map(v => v.type).join(', ')})`);
      const n = N_OF[tk];
      // Three numbers in 0..1 are a colour: the picker card, not three sliders.
      if (tk === 'vec3' && vs.length === 3 && vs.every(v => v.lit !== undefined && v.lit >= 0 && v.lit <= 1)) return { ref: ref(mk('colorPicker', { color: vs.map(v => v.lit) }, {}), 'rgb', 'vec3'), type: 'vec3', ast: a };
      if (tk === 'vec3' && vs.length === 1 && vs[0].type === 'float') return typed('floatToVec3', {}, { input: asRef(vs[0]) }, 'rgb', 'vec3');
      if (vs.length === 1 && vs[0].type === 'float') { const r = asRef(vs[0]); return makeVec(n, Array(n).fill(r)); }
      if (vs.length === 1 && vs[0].type === tk) return { ...vs[0], ast: a };
      // Narrowing: vec2(vec3), vec3(vec4)… are the leading components; anything else is the parts in order.
      const parts = vs.length === 1 ? Array.from({ length: n }, (_, i) => component(vs[0], i)) : vs.flatMap(v => (v.type === 'float' ? [asRef(v)] : Array.from({ length: N_OF[v.type] }, (_, i) => component(v, i))));
      if (parts.length !== n || vs.some(v => !(v.type in N_OF))) throw new Unmapped(`constructor ${tk}(${vs.map(v => v.type).join(', ')})`);
      return makeVec(n, parts);
    }
    const name = callee.name;
    const user = fns.get(name);
    if (user) {
      const o = overloadFor(user, args, env);
      if (o.params.some(p => p.qual !== 'in')) return outCall(a, env, o) ?? (() => { throw new Unmapped(`${name}() returns nothing`); })();
      // A helper that only builds a rotation (`mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }`).
      const dir = rotationFn(o);
      if (dir && args.length === 1) {
        const angle = build(args[0], env);
        if (angle.type === 'float') {
          const code = dir === -1 ? 'mat2(cos(a), -sin(a), sin(a), cos(a))' : 'mat2(cos(a), sin(a), -sin(a), cos(a))';
          return { ...codeNode([{ name: 'a', val: angle }], 'mat2' as T, code, `${name}() builds a rotation matrix, kept as code where it isn’t turning a vec2`), ast: a, rot: { angle, dir } };
        }
      }
      if (!(o.ret in N_OF)) throw new Unmapped(`${name}() returns a ${o.ret}`);
      return region(a, env, `call to ${name}()`);
    }
    const vs = args.map(x => build(x, env));
    const t = vs.reduce<T>((m, v) => (N_OF[v.type] > N_OF[m] ? v.type : m), 'float');
    const one = (type: string, params: Record<string, unknown>, key: string, out: string) => typed(type, params, { [key]: asRef(vs[0]) }, out, t);
    const allF = vs.every(v => v.type === 'float');
    /** A second argument that is a float or the first's own type (GLSL's min(vec3, float), pow(vec3, vec3)…). */
    const second = vs.length === 2 && vs[0].type === t && (vs[1].type === 'float' || vs[1].type === t);
    switch (name) {
      case 'sin': case 'cos': case 'tan': return one(name, { freq: 1, amp: 1 }, 'input', 'output');
      case 'exp': return one('exp', { scale: 1 }, 'input', 'output');
      case 'floor': return one('floor', {}, 'input', 'output');
      case 'ceil': return one('ceil', {}, 'input', 'output');
      case 'abs': return one('abs', {}, 'input', 'output');
      case 'fract': return one('fractRaw', {}, 'input', 'output');
      case 'sign': return typed('sign', {}, { value: asRef(vs[0]) }, 'result', t);
      case 'tanh': return one('tanh', {}, 'input', 'output');
      // Length, Normalize and Dot take any vector: the card's type is the input's.
      case 'length': return { ref: ref(mk('length', { scale: 1, outputType: vs[0].type }, { input: asRef(vs[0]) }), 'output', 'float'), type: 'float', ast: a };
      case 'normalize': return typed('normalizeVec2', {}, { v: asRef(vs[0]) }, 'result', vs[0].type);
      case 'dot': if (vs.length === 2 && vs[0].type === vs[1].type) return { ref: ref(mk('dot', { outputType: vs[0].type }, { a: asRef(vs[0]), b: asRef(vs[1]) }), 'result', 'float'), type: 'float', ast: a }; break;
      case 'cross': if (vs.length === 2 && vs[0].type === 'vec3') return typed('crossProduct', {}, { a: asRef(vs[0]), b: asRef(vs[1]) }, 'result', 'vec3'); break;
      case 'min': case 'max': if (second) { report.stats.sliders += anon(vs[1]) ? 1 : 0; return retype(typed(name === 'min' ? 'minMath' : 'max', anon(vs[1]) ? { b: vs[1].lit } : {}, { a: asRef(vs[0]), ...(!anon(vs[1]) ? { b: asRef(vs[1]) } : {}) }, 'result', t), 'b', vs[1].type); } break;
      case 'clamp': if (vs.length === 3 && vs[1].type === 'float' && vs[2].type === 'float') return typed('clamp', { ...(anon(vs[1]) ? { lo: vs[1].lit } : {}), ...(anon(vs[2]) ? { hi: vs[2].lit } : {}) }, { input: asRef(vs[0]), ...(!anon(vs[1]) ? { lo: asRef(vs[1]) } : {}), ...(!anon(vs[2]) ? { hi: asRef(vs[2]) } : {}) }, 'result', t); break;
      case 'mix': if (vs.length === 3 && vs[2].type === 'float' && vs[0].type === vs[1].type) return typed('mix', anon(vs[2]) ? { t: vs[2].lit } : {}, { a: asRef(vs[0]), b: asRef(vs[1]), ...(!anon(vs[2]) ? { t: asRef(vs[2]) } : {}) }, 'result', vs[0].type); break;
      case 'smoothstep': if (vs.length === 3 && vs[0].type === 'float' && vs[1].type === 'float') { report.stats.sliders += (anon(vs[0]) ? 1 : 0) + (anon(vs[1]) ? 1 : 0); return typed('smoothstep', { ...(anon(vs[0]) ? { edge0: vs[0].lit } : {}), ...(anon(vs[1]) ? { edge1: vs[1].lit } : {}) }, { value: asRef(vs[2]), ...(!anon(vs[0]) ? { edge0: asRef(vs[0]) } : {}), ...(!anon(vs[1]) ? { edge1: asRef(vs[1]) } : {}) }, 'result', vs[2].type); } break;
      case 'step': if (vs.length === 2 && vs[1].type === t && (vs[0].type === 'float' || vs[0].type === t)) return retype(typed('step', {}, { edge: asRef(vs[0]), x: asRef(vs[1]) }, 'result', t), 'edge', vs[0].type); break;
      case 'mod': if (vs.length === 2 && vs[1].type === 'float') return typed('mod', anon(vs[1]) ? { period: vs[1].lit } : {}, { input: asRef(vs[0]), ...(!anon(vs[1]) ? { period: asRef(vs[1]) } : {}) }, 'output', vs[0].type); break;
      case 'atan': if (vs.length === 2 && allF) return typed('atan2', {}, { y: asRef(vs[0]), x: asRef(vs[1]) }, 'angle', 'float'); break;
      // pow(vec, float) isn't GLSL, so a vector base comes with a vector exponent.
      case 'pow': if (second && (vs[1].type === t || t === 'float')) return retype(typed('pow', anon(vs[1]) ? { exponent: vs[1].lit } : {}, { base: asRef(vs[0]), ...(!anon(vs[1]) ? { exponent: asRef(vs[1]) } : {}) }, 'result', t), 'exponent', vs[1].type); break;
      case 'sqrt': return one('sqrt', {}, 'input', 'output');
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
  /**
   * What code kept as text reads: an input per live variable and source. An `int` travels
   * as a float input (`n_in`) and `ints` declares it back (`int n = int(n_in);`) for the code.
   */
  function inputsFor(a0: Ast, env: Env, extra: Record<string, Ref> = {}): { inputs: { name: string; type: T }[]; wires: Record<string, Ref>; code: string; ints: { name: string; from: string }[] } {
    const a = deArrayDeep(a0, env) as Ast; // `p[0]` is the name p_0 in code that is kept as text
    const names = new Set<string>(); freeNames(a, names);
    const inputs: { name: string; type: T }[] = []; const wires: Record<string, Ref> = {}; const ints: { name: string; from: string }[] = [];
    let code = generate(a as never);
    for (const n of names) {
      if (env.has(n) && env.get(n)!.int) { const v = env.get(n)!; inputs.push({ name: `${n}_in`, type: v.type }); wires[`${n}_in`] = asRef(v); ints.push({ name: n, from: `${n}_in` }); }
      else if (env.has(n)) { const v = env.get(n)!; inputs.push({ name: n, type: v.type }); wires[n] = asRef(v); }
      else if (SOURCES[n]) { const s = SOURCES[n]; inputs.push({ name: s.name, type: s.t }); wires[s.name] = srcRef(n); code = code.replace(new RegExp(`\\b${n}\\b`, 'g'), s.name); }
      else if (fns.has(n)) { /* a call: handled by the caller (region) */ }
      else throw new Unsupported(`Unknown identifier ${n}`);
    }
    for (const [k, r] of Object.entries(extra)) { inputs.push({ name: k, type: r.type }); wires[k] = r; }
    return { inputs, wires, code, ints };
  }
  /** The type a kept expression gives: its own, or (a built-in the table doesn't know) the type its statement declares. */
  function typeOrHint(a: Ast, env: Env, hint?: T): T {
    try { return typeOf(a, env); } catch (e) { if (e instanceof Unmapped && hint) return hint; throw e; }
  }
  function block(a: Ast, env: Env, why: string, extra: Record<string, Ref> = {}, codeOverride?: string, tOverride?: T, hint?: T): Val {
    refuseLiveWrites(a, env);
    const t = tOverride ?? typeOrHint(a, env, hint);
    const { inputs, wires, code, ints } = inputsFor(a, env, extra);
    const comma = a.type === 'binary' && (a.operator as Ast).literal === ',';
    const expr = codeOverride ?? (isIntExpr(a, env) ? `float(${code})` : comma ? `(${code})` : code);
    const lines = ints.map(i => ({ lhs: `int ${i.name}`, op: '=', rhs: `int(${i.from})` }));
    const n = mk('exprNode', { __importedCode: 'block', inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: null })), outputType: t, lines, result: expr, expr }, wires,
      { inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type as DataType, label: i.name }])), outputs: { result: { type: t as DataType, label: 'Result' } } });
    report.blocks.push({ code: expr, why, nodeId: n.id });
    return { ref: ref(n, 'result', t), type: t, ast: a };
  }
  /** Rung 1 with rung 2 as the net: an expression, one way or another. `hint` is the type its statement declares. */
  function expr(a0: Ast, env: Env, hint?: T): Val {
    try { return build(a0, env); }
    catch (e) {
      if (!(e instanceof Unmapped)) throw e;
      // Array elements with known indices are plain names for the code that follows (`p[0]` → `p_0`).
      const a = deArrayDeep(a0, env) as Ast;
      if ((globalThis as { __g2nDebug?: boolean }).__g2nDebug) report.notes.push(`[debug] ${generate(a as never)} → ${e.why}`);
      // A user-function call inside: a region instead, so its code comes along.
      const calls = new Set<string>(); collectCalls(a, calls);
      if ([...calls].some(c => fns.has(c))) return region(a, env, e.why, undefined, undefined, hint);
      return block(a, env, e.why, {}, undefined, undefined, hint);
    }
  }

  // ── Writes inside an expression (`O += P - O` where P holds `U += T`, `O = ++h`) ──
  /**
   * Code kept as text gets its inputs by value, so a write inside it stays inside it. That is
   * only the shader's meaning when nothing reads the variable afterwards; otherwise the
   * picture would silently differ, so the shader is refused with the reason instead.
   */
  const frames: { rest: Ast[]; loop?: Ast }[] = [];
  let current: Ast | null = null;
  /** The variables written inside a tree, each with the write's text (for the reason given when it can't stay). */
  function writesIn(a: unknown, out: string[], texts?: Map<string, string>): void {
    if (Array.isArray(a)) { for (const x of a) writesIn(x, out, texts); return; }
    if (!a || typeof a !== 'object') return;
    const n = a as Ast;
    const base = (t: Ast): string => (t.type === 'identifier' ? t.identifier as string : t.type === 'postfix' ? base(t.expression as Ast) : '?');
    const add = (name: string) => { out.push(name); if (texts && !texts.has(name)) texts.set(name, generate(n as never).replace(/\s+/g, ' ').trim()); };
    if (n.type === 'assignment') add(base(n.left as Ast));
    if (n.type === 'unary' && ['++', '--'].includes((n.operator as Ast)?.literal as string)) add(base(n.expression as Ast));
    if (n.type === 'postfix' && ['++', '--'].includes(incLit(n.postfix as Ast))) add(base(n.expression as Ast));
    for (const [k, v] of Object.entries(n)) if (k !== 'type') writesIn(v, out, texts);
  }
  function countOf(a: unknown, name: string): number {
    if (Array.isArray(a)) return a.reduce((s: number, x) => s + countOf(x, name), 0);
    if (!a || typeof a !== 'object') return 0;
    const n = a as Ast;
    return (n.type === 'identifier' && n.identifier === name ? 1 : 0) + Object.entries(n).reduce((s, [k, v]) => s + (k === 'type' ? 0 : countOf(v, name)), 0);
  }
  function contains(a: unknown, node: unknown): boolean {
    if (a === node) return true;
    if (!a || typeof a !== 'object') return false;
    return Object.entries(a as Ast).some(([k, v]) => k !== 'type' && v && typeof v === 'object' && contains(v, node));
  }
  /** `x = …` that doesn't read x: whatever x held before is gone. */
  const overwrites = (st: Ast, x: string): boolean => {
    const e = st.type === 'expression_statement' ? st.expression as Ast : null;
    return !!e && e.type === 'assignment' && (e.operator as Ast).literal === '=' && (e.left as Ast).type === 'identifier' && (e.left as Ast).identifier === x && !mentions(e.right, x);
  };
  /** In evaluation order, is x first written whole (`x = …` not reading x) or first read? */
  function firstUse(a: unknown, x: string): 'write' | 'read' | null {
    if (Array.isArray(a)) { for (const y of a) { const r = firstUse(y, x); if (r) return r; } return null; }
    if (!a || typeof a !== 'object') return null;
    const n = a as Ast;
    if (n.type === 'identifier') return n.identifier === x ? 'read' : null;
    if (n.type === 'assignment') {
      const r = firstUse(n.right, x); if (r) return r;
      const l = n.left as Ast;
      if (l.type === 'identifier' && l.identifier === x) return (n.operator as Ast).literal === '=' ? 'write' : 'read';
      return firstUse(l, x);
    }
    for (const [k, v] of Object.entries(n)) { if (k === 'type') continue; const r = firstUse(v, x); if (r) return r; }
    return null;
  }
  /** Nothing reads x after the statement being converted (before writing it whole). */
  function deadAfter(x: string, a: Ast, env: Env): boolean {
    if (!env.has(x) || !current) return false;
    if (countOf(current, x) > countOf(a, x)) return false; // read elsewhere in the same statement
    for (let k = frames.length - 1; k >= 0; k--) {
      const f = frames[k];
      if (f.loop) {
        // The next time round: the header, then the body from the top.
        const L = f.loop;
        if (mentions([L.condition, L.operation], x)) return false;
        const body = (L.body as Ast).type === 'compound_statement' ? (L.body as Ast).statements as Ast[] : [L.body as Ast];
        for (const st of body) {
          if (contains(st, current)) { if (countOf(st, x) > countOf(current, x) || firstUse(a, x) !== 'write') return false; break; }
          if (overwrites(st, x)) break;
          if (mentions(st, x)) return false;
        }
        continue;
      }
      for (const st of f.rest) { if (overwrites(st, x)) return true; if (mentions(st, x)) return false; }
    }
    return true;
  }
  function refuseLiveWrites(a: Ast, env: Env): void {
    const targets: string[] = []; const texts = new Map<string, string>(); writesIn(a, targets, texts);
    for (const x of new Set(targets)) {
      if (!deadAfter(x, a, env)) {
        const w = texts.get(x) ?? ''; const shown = w.length > 40 ? `${w.slice(0, 39)}…` : w;
        throw new Unsupported(`${x === '?' ? 'A variable' : x} changes inside an expression (${shown}) and is read afterwards; a graph can’t carry that write. Give the change a line of its own.`);
      }
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
    const products: Product[] = [];
    if (fn.ret !== 'void') { if (!(fn.ret in N_OF)) throw new Unmapped(`${fn.name}() returns a ${fn.ret}`); products.push({ name: 'ret_', type: fn.ret as T }); }
    for (const o of outs) { if (!(o.p.type in N_OF)) throw new Unmapped(`${fn.name}(): ${o.p.qual} ${o.p.type} ${o.p.name}`); products.push({ name: o.arg.identifier as string, type: o.p.type as T }); }
    // Inputs: what the call reads (out arguments excluded; inout ones and ints come in under another name).
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
      else if (env.has(n) && env.get(n)!.int) { const v = env.get(n)!; inputs.push({ name: `${n}_in`, type: v.type }); wires[`${n}_in`] = asRef(v); prelude.push(`int ${n} = int(${n}_in);`); }
      else if (env.has(n)) { const v = env.get(n)!; inputs.push({ name: n, type: v.type }); wires[n] = asRef(v); }
      else if (SOURCES[n]) { const s = SOURCES[n]; inputs.push({ name: s.name, type: s.t }); wires[s.name] = srcRef(n); code = code.replace(new RegExp(`\\b${n}\\b`, 'g'), s.name); }
      else if (!fns.has(n)) throw new Unsupported(`Unknown identifier ${n}`);
    }
    const callLine = fn.ret === 'void' ? `${code};` : `${fn.ret} ret_ = ${code};`;
    const results = packed(products, ret => `${prelude.join('\n')}\n${callLine}\nreturn ${ret};`, inputs, wires, helpersFor(a), fn.name, a);
    report.regions.push({ code: generate(a as never), why: `call to ${fn.name}() with ${[...outNames].join(', ')} as out argument${outNames.size === 1 ? '' : 's'}` });
    for (const o of outs) env.set(o.arg.identifier as string, { ...results.get(o.arg.identifier as string)!, name: o.arg.identifier as string });
    return results.get('ret_') ?? null;
  }

  // ── Rung 3: a Custom Function node for a region ────────────────────────────
  function region(a: Ast, env: Env, why: string, stmtCode?: string, outVar?: string, hint?: T): Val {
    refuseLiveWrites(a, env);
    const t = typeOrHint(a, env, hint);
    const { inputs, wires, code, ints } = inputsFor(a, env);
    const helpers = helpersFor(a);
    const prelude = ints.map(i => `int ${i.name} = int(${i.from});\n`).join('');
    const body = prelude + (stmtCode ? `${stmtCode}\n  return ${outVar};` : `return ${isIntExpr(a, env) ? `float(${code})` : code};`);
    const n = mk('customFn', { __importedCode: 'region', label: why.replace(/^call to /, '').replace(/\(\)$/, '') || 'Region', inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: null })), outputType: t, body, glslFunctions: helpers }, { ...wires },
      { inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type as DataType, label: i.name }])), outputs: { result: { type: t as DataType, label: 'Result' } } });
    report.regions.push({ code: stmtCode ?? code, why, nodeId: n.id });
    return { ref: ref(n, 'result', t), type: t, ast: a };
  }

  // ── Statements ─────────────────────────────────────────────────────────────
  let output: GraphNode | null = null;
  /** A small block over values already made (no source expression of its own): `expr` reads the inputs by name. */
  function codeNode(ins: { name: string; val: Val }[], t: T, code: string, why: string): Val {
    const n = mk('exprNode', { __importedCode: 'block', inputs: ins.map(i => ({ name: i.name, type: i.val.type, slider: null })), outputType: t, lines: [], result: code, expr: code }, Object.fromEntries(ins.map(i => [i.name, asRef(i.val)])),
      { inputs: Object.fromEntries(ins.map(i => [i.name, { type: i.val.type as DataType, label: i.name }])), outputs: { result: { type: t as DataType, label: 'Result' } } });
    report.blocks.push({ code, why, nodeId: n.id });
    return { ref: ref(n, 'result', t), type: t, ast: { type: 'made' } };
  }
  /** `v.<mask> = nv`: v with those components replaced, split and made again. */
  function withMask(v: Val, sw: string, nv: Val): Val {
    const n = N_OF[v.type];
    const idx = [...sw].map(c => 'xyzwrgbastpq'.indexOf(c) % 4);
    if (!n || n < 2 || idx.some(i => i < 0 || i >= n) || new Set(idx).size !== idx.length || N_OF[nv.type] !== idx.length) throw new Unmapped(`component write .${sw} on a ${v.type}`);
    const parts = Array.from({ length: n }, (_, k) => { const j = idx.indexOf(k); return j < 0 ? component(v, k) : idx.length > 1 ? component(nv, j) : asRef(nv); });
    return makeVec(n, parts);
  }
  /** Is this name the shader's output (gl_FragColor, or the out parameter when it isn't kept as a local)? */
  const isOutput = (name: string, env: Env) => name === 'gl_FragColor' || (name === 'fragColor' && !env.has('fragColor'));
  /** The colour written so far, as a vec4 (for `gl_FragColor.a = …` or `gl_FragColor *= …` after it). */
  function outputValue(): Val {
    const c = output?.inputs.color?.connection;
    if (!output || !c) throw new Unsupported('gl_FragColor is read before it is written');
    const t = (output.type === 'output' ? 'vec3' : 'vec4') as T;
    const v: Val = { ref: { nodeId: c.nodeId, outputKey: c.outputKey, type: t }, type: t, ast: { type: 'made' } };
    return t === 'vec4' ? v : makeVec(4, [component(v, 0), component(v, 1), component(v, 2), asRef({ lit: 1, type: 'float', ast: { type: 'made' } })]);
  }
  /** The last write wins: a second write replaces the Output node. */
  function setOutput(n: GraphNode): void {
    if (output) { const i = nodes.indexOf(output); if (i >= 0) nodes.splice(i, 1); }
    output = n;
  }
  const ops: Record<string, string> = { '+=': '+', '-=': '-', '*=': '*', '/=': '/' };
  function assign(left0: Ast, opTok: string, right: Ast, env: Env): void {
    const left = deArray(left0, env);
    // `x *= a - b` is `x * (a - b)`: the right side keeps its own parentheses when it is text again.
    const rhsAst: Ast = opTok === '=' ? right : { type: 'binary', operator: { type: 'literal', literal: ops[opTok], whitespace: '' }, left, right: { type: 'group', lp: { type: 'literal', literal: '(', whitespace: '' }, expression: right, rp: { type: 'literal', literal: ')', whitespace: '' } } } as Ast;
    if (!ops[opTok] && opTok !== '=') throw new Unmapped(`assignment ${opTok}`);
    if (loopCtx && writesOutput(left, env)) throw new Unsupported('gl_FragColor written inside a loop');
    if (left.type === 'identifier') {
      const name = left.identifier as string;
      if (isOutput(name, env)) {
        if (opTok === '=') { setOutput(finish(right, env)); return; }
        // `gl_FragColor *= x`: the colour so far, as a value for the expression (under a name code may declare).
        const inner: Env = new Map(env); inner.set('fragColor_', outputValue());
        setOutput(mk('vec4Output', {}, { color: asRef(expr(renameId(rhsAst, name, 'fragColor_'), inner, 'vec4')) }));
        return;
      }
      const prev = env.get(name);
      { const v = expr(rhsAst, env, prev?.type); const w = prev?.int ? { ...v, int: true } : v; env.set(name, w.lit !== undefined ? { ...w, name: w.name ?? name } : w); }
      return;
    }
    if (left.type === 'postfix' && (left.postfix as Ast).type === 'field_selection' && (left.expression as Ast).type === 'identifier') {
      const name = (left.expression as Ast).identifier as string; const sw = ((left.postfix as Ast).selection as Ast).identifier as string;
      if (env.has(name) && !isOutput(name, env)) { env.set(name, withMask(env.get(name)!, sw, expr(rhsAst, env, VEC_T[sw.length]))); return; }
      if (isOutput(name, env)) {
        const inner: Env = new Map(env); inner.set('fragColor_', outputValue());
        setOutput(mk('vec4Output', {}, { color: asRef(withMask(inner.get('fragColor_')!, sw, expr(renameId(rhsAst, name, 'fragColor_'), inner, VEC_T[sw.length]))) }));
        return;
      }
    }
    throw new Unmapped(`assignment to ${generate(left as never)}`);
  }
  const writesOutput = (left: Ast, env: Env): boolean => left.type === 'identifier' ? isOutput(left.identifier as string, env) : left.type === 'postfix' ? writesOutput(left.expression as Ast, env) : false;
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
    const v = expr(right, env, 'vec4');
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
  function loopGroup(s: Ast, env: Env, name: string, start: number, step: number, count: number, intCounter: boolean): void {
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
        innerEnv.set(v, { ref: ref(c, 'value', t), type: t, ast: { type: 'carry' }, int: env.get(v)!.int });
      }
      // Outer variables the body only reads: through ports (a literal travels as itself).
      const used = new Set<string>(); freeNames(s.body, used);
      for (const [k, v] of env) {
        if (carries.has(k) || !used.has(k)) continue;
        innerEnv.set(k, v.ref ? { ref: portRef(ctx, v.ref, k), type: v.type, ast: v.ast, int: v.int } : v);
      }
      // The loop variable: the group's index, scaled and offset when the loop doesn't count 0, 1, 2…
      const idx = mk('loopIndex', {}, {});
      let iv: Val = { ref: ref(idx, 'i', 'float'), type: 'float', ast: { type: 'loopvar' } };
      if (step !== 1) iv = typed('multiply', { b: step }, { a: asRef(iv) }, 'result', 'float');
      if (start !== 0) iv = typed('add', { b: start }, { a: asRef(iv) }, 'result', 'float');
      innerEnv.set(name, { ...iv, int: intCounter });
      inLoop(s, () => stmt(s.body as Ast, innerEnv));
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
  /** Does the tree read or write some `arr[…]` whose index mentions `name`? */
  function indexesBy(a: unknown, name: string): boolean {
    if (!a || typeof a !== 'object') return false;
    if (Array.isArray(a)) return a.some(x => indexesBy(x, name));
    const n = a as Ast;
    if (n.type === 'quantifier' && mentions(n.expression, name)) return true;
    return Object.values(n).some(v => v && typeof v === 'object' && indexesBy(v, name));
  }
  function mentions(a: unknown, name: string): boolean {
    if (!a || typeof a !== 'object') return false;
    if (Array.isArray(a)) return a.some(x => mentions(x, name));
    const n = a as Ast;
    if (n.type === 'identifier' && n.identifier === name) return true;
    return Object.values(n).some(v => v && typeof v === 'object' && mentions(v, name));
  }
  function hasAny(a: unknown, types: string[]): boolean {
    if (Array.isArray(a)) return a.some(x => hasAny(x, types));
    if (!a || typeof a !== 'object') return false;
    const n = a as Ast;
    if (types.includes(n.type)) return true;
    return Object.entries(n).some(([k, v]) => k !== 'type' && hasAny(v, types));
  }
  /**
   * Code that produces several values (a call's out arguments, the variables a loop changes)
   * as Custom Function nodes: the values packed into one vector when they fit in four
   * components, else into several regions that each run the code again, and a block per
   * value pulling it back out. An `int` comes back as a float (the same number).
   */
  type Product = { name: string; type: T; int?: boolean };
  function packed(products: Product[], bodyFor: (ret: string) => string, inputs: { name: string; type: T }[], wires: Record<string, Ref>, helpers: string, label: string, a: Ast): Map<string, Val> {
    const groups: Product[][] = []; let cur: Product[] = []; let sum = 0;
    for (const p of products) { if (sum + N_OF[p.type] > 4) { groups.push(cur); cur = []; sum = 0; } cur.push(p); sum += N_OF[p.type]; }
    if (cur.length) groups.push(cur);
    const results = new Map<string, Val>();
    groups.forEach((g, gi) => {
      const total = g.reduce((s, p) => s + N_OF[p.type], 0);
      const outT = VEC_T[total];
      const val = (p: Product) => (p.int ? `float(${p.name})` : p.name);
      const ret = g.length === 1 ? val(g[0]) : `${outT}(${g.map(val).join(', ')})`;
      const n = mk('customFn', { __importedCode: 'region', label: `${label}${groups.length > 1 ? ` (${gi + 1}/${groups.length})` : ''}`, inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: null })), outputType: outT, body: bodyFor(ret), glslFunctions: helpers }, { ...wires },
        { inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type as DataType, label: i.name }])), outputs: { result: { type: outT as DataType, label: 'Result' } } });
      const whole: Val = { ref: ref(n, 'result', outT), type: outT, ast: a };
      if (g.length === 1) { results.set(g[0].name, { ...whole, int: g[0].int }); return; }
      let off = 0;
      for (const p of g) {
        const sw = 'xyzw'.slice(off, off + N_OF[p.type]); off += N_OF[p.type];
        const ex = mk('exprNode', { __importedCode: 'block', inputs: [{ name: 'v', type: outT, slider: null }], outputType: p.type, lines: [], result: `v.${sw}`, expr: `v.${sw}` }, { v: whole.ref },
          { inputs: { v: { type: outT as DataType, label: 'v' } }, outputs: { result: { type: p.type as DataType, label: 'Result' } } });
        results.set(p.name, { ref: ref(ex, 'result', p.type), type: p.type, ast: a, int: p.int });
      }
    });
    return results;
  }
  /**
   * A loop that can't be a group: Custom Function nodes running it, returning the
   * variables it changes (packed, see `packed`). Its header counts: golf loops write
   * in their update clause (`for (…; …; O = mix(…))`).
   */
  function loopRegion(s: Ast, env: Env, loopVar: string | undefined): void {
    const assigned = new Set<string>(); assignedNames([s.body, s.operation, s.condition], assigned);
    const live = [...assigned].filter(n => env.has(n) && n !== loopVar);
    const kind = s.type === 'while_statement' ? 'while loop' : 'loop';
    const local0 = new Set<string>(); declaredNames(s, local0);
    const elsewhere = [...assigned].filter(n => !env.has(n) && !local0.has(n) && n !== loopVar);
    if (elsewhere.length) throw new Unsupported(`a ${kind} the converter can’t unroll that writes ${elsewhere.join(', ')}`);
    if (!live.length) { report.notes.push(`A ${kind} that changes nothing outside itself was left out`); return; }
    for (const n of live) if (!(env.get(n)!.type in N_OF)) throw new Unsupported(`a ${kind} the converter can’t unroll that changes the matrix ${n}`);
    const names = new Set<string>(); freeNames(s, names);
    const local = new Set<string>(); declaredNames(s, local);
    const inputs: { name: string; type: T }[] = []; const wires: Record<string, Ref> = {}; const prelude: string[] = [];
    let code = generate(s as never);
    for (const n of names) {
      if (n === loopVar || local.has(n)) continue;
      if (env.has(n)) {
        const v = env.get(n)!; inputs.push({ name: `${n}_in`, type: v.type }); wires[`${n}_in`] = asRef(v);
        prelude.push(v.int ? `int ${n} = int(${n}_in);` : `${v.type} ${n} = ${n}_in;`);
      }
      else if (SOURCES[n]) { const so = SOURCES[n]; inputs.push({ name: so.name, type: so.t }); wires[so.name] = srcRef(n); code = code.replace(new RegExp(`\\b${n}\\b`, 'g'), so.name); }
      else if (!fns.has(n)) throw new Unsupported(`Unknown identifier ${n}`);
    }
    const results = packed(live.map(n => ({ name: n, type: env.get(n)!.type, int: env.get(n)!.int })), ret => `${prelude.join('\n')}\n${code}\nreturn ${ret};`, inputs, wires, helpersFor(s), `loop → ${live.join(', ')}`, s);
    report.regions.push({ code, why: `a ${kind} the converter can’t unroll (it changes ${live.join(', ')})` });
    for (const n of live) env.set(n, results.get(n)!);
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
    if (n.type === 'postfix' && ['++', '--'].includes(incLit(n.postfix as Ast)) && (n.expression as Ast).type === 'identifier') out.add((n.expression as Ast).identifier as string);
    if (n.type === 'unary' && ['++', '--'].includes((n.operator as Ast)?.literal as string) && (n.expression as Ast).type === 'identifier') out.add((n.expression as Ast).identifier as string);
    for (const [k, v] of Object.entries(n)) if (k !== 'type') assignedNames(v, out);
  }
  /** Statements in order, each knowing what follows it (for `deadAfter`). */
  function stmts(list: Ast[], env: Env): void {
    list.forEach((s, i) => {
      const saved = current; frames.push({ rest: list.slice(i + 1) }); current = s;
      try { stmt(s, env); } finally { frames.pop(); current = saved; }
    });
  }
  /** The body of a loop, run with the loop on the frame stack (its next round reads what the body wrote). */
  function inLoop<R>(s: Ast, run: () => R): R {
    const body = s.body as Ast, saved = current;
    frames.push({ rest: [], loop: s });
    if (body.type !== 'compound_statement') current = body; // a one-statement body: that statement is what's being converted
    try { return run(); } finally { frames.pop(); current = saved; }
  }
  function stmt(s: Ast, env: Env): void {
    switch (s.type) {
      case 'declaration_statement': {
        const decl = s.declaration as Ast;
        const ty = tokenOf(((decl.specified_type as Ast)?.specifier as Ast) ?? decl);
        for (const d of ((decl.declarations as Ast[] | undefined) ?? [])) {
          const name = (d.identifier as Ast).identifier as string;
          if (d.quantifier) {
            // `vec3 planet[3];` is three named slots, planet#0..2, each zero until assigned.
            const q = (d.quantifier as Ast[])[0];
            const sizeAst = q?.expression as Ast | undefined;
            let size = sizeAst ? litOf(sizeAst) : null;
            if (size === null && sizeAst?.type === 'identifier') { const v = env.get(sizeAst.identifier as string); if (v?.lit !== undefined) size = v.lit; }
            if (size === null || !Number.isInteger(size) || size < 1 || size > 64) throw new Unsupported(`array ${name}: its size must be a number up to 64`);
            if (d.initializer) throw new Unsupported(`array ${name}: an initialiser list isn't supported yet (assign the entries one by one)`);
            for (let k = 0; k < size; k++) env.set(`${name}_${k}`, { lit: ty === 'float' || ty === 'int' ? 0 : undefined, type: (ty in N_OF ? ty : 'float') as T, ast: { type: 'zero' }, int: ty === 'int' || undefined });
            continue;
          }
          const isInt = ty === 'int' || undefined;
          // A number keeps the first name it was given: `float k = SIZE;` reads SIZE's constant, not a second one.
          if (d.initializer) { const v = { ...expr(d.initializer as Ast, env, (ty in N_OF ? ty : undefined) as T | undefined), int: isInt }; env.set(name, v.lit !== undefined ? { ...v, name: v.name ?? name } : v); }
          else env.set(name, { lit: ty === 'float' || ty === 'int' ? 0 : undefined, type: (ty in N_OF ? ty : 'float') as T, ast: { type: 'zero' }, int: isInt });
        }
        return;
      }
      case 'expression_statement': {
        const e = s.expression as Ast;
        if (!e) return; // `;` on its own (a macro that already ended in one, or `;;`)
        // `a = x, b += y;` is two statements.
        if (e.type === 'binary' && (e.operator as Ast).literal === ',') {
          stmt({ type: 'expression_statement', expression: e.left } as Ast, env);
          stmt({ type: 'expression_statement', expression: e.right } as Ast, env);
          return;
        }
        if (e.type === 'group') { stmt({ type: 'expression_statement', expression: e.expression } as Ast, env); return; }
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
        if (inc) {
          const intTarget = inc.target.type === 'identifier' && !!env.get(inc.target.identifier as string)?.int;
          assign(inc.target, inc.op === '++' ? '+=' : '-=', (intTarget ? { type: 'int_constant', token: '1', whitespace: '' } : { type: 'float_constant', token: '1.0', whitespace: '' }) as Ast, env);
          return;
        }
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
        const intCounter = tokenOf((((init?.type === 'declarator_list' ? init : init?.declaration as Ast)?.specified_type as Ast)?.specifier as Ast)) === 'int';
        // A bound may be a number or a name holding one (`i < STEPS` with `const int STEPS = 8`).
        const known = (x: Ast | undefined): number | null => {
          if (!x) return null;
          const l = litOf(x); if (l !== null) return l;
          if (x.type === 'identifier') { const w = env.get(x.identifier as string); if (w && w.lit !== undefined && w.ref === undefined) return w.lit; }
          if (x.type === 'group') return known(x.expression as Ast);
          return null;
        };
        const start = v?.initializer ? known(v.initializer as Ast) : null;
        const condOp = cond?.type === 'binary' ? (cond.operator as Ast).literal as string : null;
        const end = cond?.type === 'binary' && (cond.left as Ast).type === 'identifier' && (cond.left as Ast).identifier === name ? known(cond.right as Ast) : null;
        const inc = (upd?.type === 'postfix' && incLit(upd.postfix as Ast) === '++') || (upd?.type === 'unary' && (upd.operator as Ast)?.literal === '++');
        const incTarget = inc ? (upd.expression as Ast) : upd?.type === 'assignment' ? (upd.left as Ast) : null;
        const step = !incTarget || incTarget.type !== 'identifier' || incTarget.identifier !== name ? null : inc ? 1 : (upd.operator as Ast).literal === '+=' ? known(upd.right as Ast) : null;
        // The body mustn't change the counter itself.
        const bodyWrites = new Set<string>(); if (name) assignedNames(s.body, bodyWrites);
        if (name && start !== null && end !== null && step && step > 0 && (condOp === '<' || condOp === '<=') && !bodyWrites.has(name)) {
          const count = Math.floor(((condOp === '<' ? end - 1e-9 : end) - start) / step) + 1;
          // A body that reads `arr[i]` needs i as a number: run the body once per value instead of an iterated group.
          if (count >= 1 && count <= 16 && indexesBy(s.body, name)) {
            inLoop(s, () => {
              for (let k = 0; k < count; k++) {
                const val = start + k * step;
                env.set(name, { lit: val, type: 'float', ast: { type: 'float_constant', token: `${val}.0` }, int: intCounter || undefined });
                stmt(s.body as Ast, env);
              }
            });
            env.delete(name);
            report.notes.push(`Loop over ${name} (${count}×) unrolled: it indexes an array by ${name}`);
            report.stats.loops++;
            return;
          }
          // An iterated group runs up to 16 times and has no early exit; a loop inside a loop stays code.
          const exits = hasAny(s.body, ['break_statement', 'continue_statement', 'return_statement', 'discard_statement']);
          if (count >= 1 && count <= 16 && !exits && !loopCtx) { loopGroup(s, env, name, start, step, count, intCounter); return; }
        }
        return loopRegion(s, env, name);
      }
      case 'while_statement': {
        if (hasAny(s.body, ['return_statement', 'discard_statement'])) throw new Unsupported('while in main() with a return or discard inside');
        return loopRegion(s, env, undefined);
      }
      // `discard` is a value: kept_ is 0 from here on. if/else merges it like any variable; at the end the colour
      // is multiplied by it, so a discarded pixel is transparent black, what a cleared canvas shows there.
      case 'discard_statement':
        if (loopCtx || !env.has(KEPT)) throw new Unsupported('discard inside a loop');
        env.set(KEPT, { lit: 0, type: 'float', ast: s });
        return;
      case 'return_statement': case 'break_statement': case 'continue_statement': case 'do_statement': case 'switch_statement':
        throw new Unsupported(`${s.type.replace('_statement', '')} in main()`);
      default: throw new Unmapped(`statement ${s.type ?? JSON.stringify(s).slice(0, 120)}`);
    }
  }

  // ── Go ─────────────────────────────────────────────────────────────────────
  const env: Env = new Map();
  // Uniforms no node stands for: live entries on the Constants card, each a Play control.
  const uniformCard = live.length ? mk('constants', { items: [] }, {}, { inputs: {}, outputs: {} }) : null;
  if (uniformCard) constantsCards.set(nodes, uniformCard);
  for (const u of live) {
    const items = uniformCard!.params.items as ConstantsItem[];
    const type = u.colour ? 'color' : u.type === 'int' ? 'float' : u.type;
    items.push({ key: u.name, label: u.name, type, value: u.value, slider: true, min: u.min, max: u.max, step: u.step });
    if (Array.isArray(u.value) && !u.colour) u.value.forEach((x, i) => { uniformCard!.params[`${u.name}_${'xyz'[i]}`] = x; });
    else uniformCard!.params[u.name] = u.value;
    const t = (u.type === 'int' ? 'float' : u.type) as T;
    uniformCard!.outputs[u.name] = { type: t as DataType, label: u.name };
    env.set(u.name, { ref: { nodeId: uniformCard!.id, outputKey: u.name, type: t }, type: t, ast: { type: 'uniform' }, int: u.type === 'int' || undefined });
    report.notes.push(`Uniform ${u.type} ${u.name} is a Play control on the Constants card: starts at ${Array.isArray(u.value) ? `(${u.value.join(', ')})` : u.value}, ${u.min} to ${u.max}`);
  }
  if (live.length) report.uniforms = live;
  const discards = hasAny(((main!.body as Ast).statements as Ast[]), ['discard_statement']);
  if (discards) env.set(KEPT, { lit: 1, type: 'float', ast: { type: 'zero' } });
  try {
    // Global consts are the shader's dials: values in the environment, so main() and blocks read them
    // (regions also get their text). One a graph can't hold (a matrix) stays text-only.
    for (const c of consts) {
      if (!c.init) continue;
      try { const v = { ...expr(c.init, env), int: c.type === 'int' || undefined }; env.set(c.name, v.lit !== undefined ? { ...v, name: v.name ?? c.name } : v); }
      catch (e) { if (!(e instanceof Unsupported || e instanceof Unmapped)) throw e; }
    }
    stmts(((main!.body as Ast).statements as Ast[]), env);
    if (!output) report.unsupported.push('main() never writes gl_FragColor');
    const keep = env.get(KEPT);
    if (output && keep && !(keep.lit === 1 && !keep.ref)) {
      // Kept where nothing discarded (× 1), transparent black where something did (× 0): an RGBA Output.
      const colour = outputValue();
      setOutput(mk('vec4Output', {}, { color: asRef(typed('multiply', anon(keep) ? { b: keep.lit } : {}, { a: asRef(colour), ...(anon(keep) ? {} : { b: asRef(keep) }) }, 'result', 'vec4')) }));
      report.notes.push('discard: the colour is multiplied by 0 where the shader discards, so those pixels are transparent black');
    }
  } catch (e) {
    if (e instanceof Unsupported || e instanceof Unmapped) report.unsupported.push(e.why); else throw e;
  }
  if (report.unsupported.length) return { nodes: [], report };

  // Nodes nothing reads (a const the shader never used, a split only half read) go.
  for (const g of nodes) if (g.type === 'group') { const sg = g.params.subgraph as { nodes: GraphNode[]; outputPorts: { fromNodeId: string }[] }; prune(sg.nodes, new Set(sg.outputPorts.map(p => p.fromNodeId))); }
  prune(nodes, new Set());
  // Code that became unused (a rotation matrix a Rotate 2D node took the place of) isn't reported either.
  const kept = new Set<string>();
  const walk = (list: GraphNode[]) => { for (const n of list) { kept.add(n.id); if (n.type === 'group') walk((n.params.subgraph as { nodes: GraphNode[] }).nodes); } };
  walk(nodes);
  report.blocks = report.blocks.filter(b => !b.nodeId || kept.has(b.nodeId));
  report.regions = report.regions.filter(r => !r.nodeId || kept.has(r.nodeId));
  // One Play control per value a uniform holds (a colour is one control; a vec2 or vec3, one per component).
  const controls: PlayControl[] = [];
  if (uniformCard && kept.has(uniformCard.id)) for (const u of live) {
    const at = (k: string) => `${uniformCard.id}::${k}`;
    if (u.colour) controls.push({ id: `ctl_${u.name}`, target: at(u.name), kind: 'color', label: u.name, min: 0, max: 1 });
    else if (Array.isArray(u.value)) u.value.forEach((_, i) => controls.push({ id: `ctl_${u.name}_${'xyz'[i]}`, target: at(`${u.name}_${'xyz'[i]}`), kind: 'float', label: `${u.name} ${'XYZ'[i]}`, min: u.min, max: u.max, step: u.step }));
    else controls.push({ id: `ctl_${u.name}`, target: at(u.name), kind: 'float', label: u.name, min: u.min, max: u.max, step: u.step });
  }
  layout(nodes);
  for (const sg of subgraphs) layout(sg);
  report.stats = { nodes: nodes.length, blocks: report.blocks.length, regions: report.regions.length, sliders: report.stats.sliders, loops: report.stats.loops };
  return { nodes, report, ...(controls.length ? { controls } : {}) };
}

/**
 * A uniform's starting value and range, from its name: a scale-like name starts at 1, a colour at
 * mid grey, anything else at 0 (what WebGL gives a uniform nobody sets). Deterministic.
 */
export function uniformDefault(name: string, type: ConvertedUniform['type']): ConvertedUniform {
  const base = name.replace(/^(u_|i(?=[A-Z]))/, '');
  const scaleLike = /speed|scale|zoom|size|intensity|amount|strength|gain|freq|density|bright|contrast|radius|width|thick|count|steps|iter|octave|mult|factor|amp|power|exposure|gamma/i.test(base);
  if (type === 'vec3' && /col|rgb|tint|hue/i.test(base)) return { name, type, value: [0.5, 0.5, 0.5], min: 0, max: 1, step: 0.01, colour: true };
  if (type === 'int') return { name, type, value: scaleLike ? 4 : 0, min: 0, max: scaleLike ? 16 : 10, step: 1, colour: false };
  const v = scaleLike ? 1 : 0;
  const range = scaleLike ? { min: 0, max: 2 } : { min: -1, max: 1 };
  if (type === 'float') return { name, type, value: v, ...range, step: 0.01, colour: false };
  return { name, type, value: Array(type === 'vec2' ? 2 : 3).fill(v), ...range, step: 0.01, colour: false };
}

/**
 * `mainImage(out vec4 fragColor, in vec2 fragCoord)` becomes main(), iTime and
 * friends become u_time…, so a pasted Shadertoy shader converts like our own.
 */
interface MacroDef { name: string; params: string[] | null; body: string }
const MACRO_LINE = /^[ \t]*#define[ \t]+(\w+)(\(([^)]*)\))?(?:[ \t]+([^\n]*?))?[ \t]*$/gm;
/** The #defines, taken out of the text (their lines blanked). A bare flag is a define with an empty body, as in the preprocessor; `flags` counts those. */
function collectMacros(src: string): { stripped: string; defs: MacroDef[]; flags: number } {
  const defs: MacroDef[] = []; let flags = 0;
  const stripped = src.replace(MACRO_LINE, (_whole, name: string, paren: string | undefined, params: string | undefined, raw: string | undefined) => {
    const body = (raw ?? '').replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim();
    if (!body && !paren) flags++;
    defs.push({ name, params: paren ? params!.split(',').map(p => p.trim()).filter(Boolean) : null, body });
    return '';
  });
  return { stripped, defs, flags };
}
/**
 * `#ifdef` / `#ifndef` / `#if 0|1` / `#if defined(X)` / `#elif` / `#else` / `#endif`, decided
 * the way the preprocessor would: a name counts as defined from its #define line on (until
 * an #undef), and only in a branch that is on. The directive lines and the lines of
 * branches that are off are blanked, so line numbers still point into the paste.
 */
export function resolveConditionals(src: string): string {
  if (!/^[ \t]*#[ \t]*(if|ifdef|ifndef)\b/m.test(src)) return src;
  const defined = new Set<string>();
  const lines = src.split('\n');
  // Each open #if: is its current branch on, has one of its branches been on, was the #if itself in an on branch.
  const stack: { on: boolean; taken: boolean; outer: boolean }[] = [];
  const active = () => stack.every(f => f.on);
  const test = (expr: string): boolean => {
    const e = expr.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_m, a: string | undefined, b: string | undefined) => (defined.has((a ?? b)!) ? '1' : '0')).trim();
    if (/^!\s*[01]$/.test(e)) return e.endsWith('0');
    const n = Number(e);
    return Number.isFinite(n) ? n !== 0 : false;
  };
  const word = (rest: string) => rest.trim().split(/\s+/)[0];
  for (let k = 0; k < lines.length; k++) {
    const L = lines[k]; let m: RegExpExecArray | null;
    if ((m = /^[ \t]*#[ \t]*(ifdef|ifndef|if)\b(.*)$/.exec(L))) {
      const outer = active();
      const on = outer && (m[1] === 'ifdef' ? defined.has(word(m[2])) : m[1] === 'ifndef' ? !defined.has(word(m[2])) : test(m[2]));
      stack.push({ on, taken: on, outer }); lines[k] = ''; continue;
    }
    if ((m = /^[ \t]*#[ \t]*elif\b(.*)$/.exec(L)) && stack.length) {
      const f = stack[stack.length - 1]; f.on = f.outer && !f.taken && test(m[1]); f.taken ||= f.on; lines[k] = ''; continue;
    }
    if (/^[ \t]*#[ \t]*else\b/.test(L) && stack.length) { const f = stack[stack.length - 1]; f.on = f.outer && !f.taken; f.taken = true; lines[k] = ''; continue; }
    if (/^[ \t]*#[ \t]*endif\b/.test(L) && stack.length) { stack.pop(); lines[k] = ''; continue; }
    if (!active()) { lines[k] = ''; continue; }
    if ((m = /^[ \t]*#[ \t]*define[ \t]+(\w+)/.exec(L))) defined.add(m[1]);
    else if ((m = /^[ \t]*#[ \t]*undef[ \t]+(\w+)/.exec(L))) { defined.delete(m[1]); lines[k] = ''; }
  }
  return lines.join('\n');
}
/**
 * Expand macros until nothing changes (bounded); a call's arguments split at top-level commas.
 * No parentheses are added, as in the C preprocessor: a statement macro (`#define S col += x;`)
 * has to stay a statement. A space goes in where the text would otherwise run into its
 * neighbour and make another token (`-N` with N = -1. is `- -1.`, not `--1.`).
 */
function expandMacros(src: string, defs: MacroDef[]): string {
  const byName = new Map(defs.map(d => [d.name, d]));
  const subst = (body: string, params: string[], args: string[]) => body.replace(/\b([A-Za-z_]\w*)\b/g, (w, id: string) => { const i = params.indexOf(id); return i >= 0 ? (args[i] ?? '') : w; });
  const glue = (a: string, b: string) => !!a && !!b && ((/[\w.]/.test(a) && /[\w.]/.test(b)) || (/[-+*/=<>&|!^%]/.test(a) && /[-+*/=<>&|!^%]/.test(b)));
  const put = (out: string, text: string, next: string) => `${glue(out.slice(-1), text[0] ?? '') ? ' ' : ''}${text}${glue(text.slice(-1), next) ? ' ' : ''}`;
  let s = src;
  for (let pass = 0; pass < 24; pass++) {
    let out = '', changed = false, i = 0;
    while (i < s.length) {
      const c = s[i];
      if (!/[A-Za-z_]/.test(c) || (i > 0 && /[\w.]/.test(s[i - 1]))) { out += c; i++; continue; }
      let j = i + 1; while (j < s.length && /\w/.test(s[j])) j++;
      const id = s.slice(i, j); const d = byName.get(id);
      if (!d) { out += id; i = j; continue; }
      if (!d.params) { out += put(out, d.body, s[j] ?? ''); i = j; changed = true; continue; }
      let k = j; while (k < s.length && /\s/.test(s[k])) k++;
      if (s[k] !== '(') { out += id; i = j; continue; }
      // Arguments to the matching `)`, split at depth 0.
      let depth = 1, p = k + 1; const args: string[] = []; let cur = '';
      for (; p < s.length && depth > 0; p++) { const ch = s[p]; if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth === 0) break; } if (ch === ',' && depth === 1) { args.push(cur); cur = ''; continue; } cur += ch; }
      if (depth !== 0) { out += id; i = j; continue; }
      args.push(cur);
      out += put(out, subst(d.body, d.params, args.map(a => a.trim())), s[p + 1] ?? '');
      i = p + 1; changed = true;
    }
    s = out;
    if (!changed) break;
  }
  return s;
}

export function normaliseHostShader(source: string): { code: string; toSourceLine: (line: number) => number } { return hostToOurs(source, { notes: [], warnings: [], blocks: [], regions: [], unsupported: [], stats: { nodes: 0, blocks: 0, regions: 0, sliders: 0, loops: 0 } }); }

function hostToOurs(source: string, report: ConversionReport): { code: string; toSourceLine: (line: number) => number } {
  // A #define continued with `\` over several lines is one line to the preprocessor (the lines it took
  // stay, empty, after it). First, before the translator adds lines of its own.
  const joined = source.replace(/^[ \t]*#[ \t]*define[^\n]*\\\r?\n(?:[^\n]*\\\r?\n)*[^\n]*/gm, m => { const n = m.split('\n').length - 1; return m.replace(/\\\r?\n/g, ' ') + '\n'.repeat(n); });
  // Another host's names (Shadertoy, GLSL Sandbox, twigl, ES 3.00) become ours first.
  const tr = translateToStudio(joined, { lowerReturns: true });
  if (tr.dialect !== 'studio') report.notes.push(`Read as ${dialectLabel(tr.dialect)}: ${tr.notes.join('; ')}`);
  for (const u of tr.unsupported) report.notes.push(u);
  let s = tr.code;
  // The compiled shader defines PI and TAU as macros; a shader's own constant of that name would be a macro clash.
  for (const name of ['PI', 'TAU']) if (new RegExp(`\\b(?:const\\s+)?(?:float|int)\\s+${name}\\s*=`).test(s)) s = s.replace(new RegExp(`(?<![\\w.])${name}\\b`, 'g'), `${name}_`);
  // A function named like one of the app's always-included helpers (smin, fbm, rot2d…) would lose to it: rename ours.
  const own = new Set<string>();
  for (const m of s.matchAll(/\b(?:float|vec[234]|mat[234]|int|bool|void)\s+([A-Za-z_]\w*)\s*\(/g)) if (m[1] !== 'main') own.add(m[1]);
  const clashes = [...own].filter(n => BUILTIN_HELPER_NAMES.has(n));
  for (const n of clashes) s = s.replace(new RegExp(`\\b${n}\\b`, 'g'), `${n}_`);
  if (clashes.length) report.notes.push(`Renamed ${clashes.join(', ')}: the app has a built-in helper of that name`);
  // #ifdef and friends are decided first, then object-like (`#define PI 3.14`) and function-like
  // (`#define K(U) smoothstep(.2, .0, length(U))`) macros are expanded the way the preprocessor would:
  // arguments substituted, the result rescanned, so a macro may use another, and no parentheses added.
  // A comment after the value is a comment, not part of it; a bare flag expands to nothing.
  // Comments go (newlines kept, so lines still map): a commented-out #define or a name in prose is not code.
  s = stripComments(s);
  // Integer features of GLSL ES 3.00 (uint, uvec, bit shifts, `U` and hex literals) have no ES 1.00 form:
  // the shader can't run here at all, so say so instead of failing on a stray token.
  if (ES3_INTEGER.test(s)) report.unsupported.push(ES3_INTEGER_NOTE);
  s = resolveConditionals(s);
  const macros = collectMacros(s);
  s = macros.stripped;
  if (macros.defs.length) s = expandMacros(s, macros.defs);
  const expanded = macros.defs.length - macros.flags;
  if (expanded) report.notes.push(`${expanded} #define${expanded === 1 ? '' : 's'} expanded`);
  // A global that main() assigns and helpers read travels as a parameter instead (threadGlobals.ts).
  const th = threadGlobals(s);
  s = th.code;
  report.notes.push(...th.notes);
  // Precision, uniform and varying lines are the host's, not the shader's (the translator adds the ones a paste lacks).
  // Lines are blanked, not removed, so an error's line number still points into the paste.
  s = s.replace(/^[ \t]*precision\s+\w+\s+float\s*;[ \t]*$/gm, '').replace(/^[ \t]*varying\s+vec2\s+vUv\s*;[ \t]*$/gm, '');
  return { code: s, toSourceLine: tr.toSourceLine };
}

/** The functions the compiled shader always defines; a user function of the same name is renamed on the way in. */
const BUILTIN_HELPER_NAMES = new Set([...ALWAYS_HELPERS_GLSL().matchAll(/\b(?:float|vec[234]|mat[234]|int|bool|void)\s+([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]));

/** A copy of the tree with one identifier renamed. */
function renameId(a: Ast, from: string, to: string): Ast {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== 'object') return x;
    const n = x as Ast;
    if (n.type === 'identifier' && n.identifier === from) return { ...n, identifier: to };
    return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, k === 'type' ? v : walk(v)]));
  };
  return walk(a) as Ast;
}

/** A postfix's `++` / `--` (the parser files it a few ways), or ''. */
function incLit(pf: Ast | undefined): string {
  if (!pf) return '';
  return ((pf.operator as Ast | undefined)?.literal as string | undefined) ?? (pf.literal as string | undefined) ?? '';
}

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

/**
 * Columns by data-flow depth, the same ranks the Studio's auto layout uses,
 * spaced for real cards (360 wide, heights estimated the way the Studio does,
 * code cards included). The Convert page re-spaces them once the cards have
 * been measured. Nodes are created in
 * program order, so a column reads top to bottom as the shader did.
 */
function layout(nodes: GraphNode[]): void {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const at = layoutByRank(nodes, { order: (a, b) => order.get(a.id)! - order.get(b.id)! });
  for (const n of nodes) n.position = at.get(n.id) ?? n.position;
}
