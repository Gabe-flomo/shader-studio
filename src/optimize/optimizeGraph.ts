/**
 * Optimise graph — a graph → graph rewrite that keeps the picture identical
 * and the graph shorter to read.
 *
 * Strategy "chains into blocks": a run of plain math cards (Multiply, Add,
 * Sin, Smoothstep, Split, Make…) that flows into one place becomes one
 * Expression Block. The block's lines are the very GLSL those cards emit,
 * one line per card, so the shader is the same text in a different wrapper;
 * every slider the cards had becomes a slider input on the block (named
 * `card_param`), so nothing loses its knob. What comes into the run from
 * outside (a source, a Constants entry, another node) is a block input.
 *
 * Never folded: sources and cards with no inputs, Constants and Color cards,
 * groups, loop carries and indices, blocks and functions themselves, cards
 * with keyframes, bypass, an accumulator or carry mode, cards a Play control
 * targets, cards that need helper functions, and anything whose GLSL isn't a
 * plain list of declarations. A card two places read stays a card (a block
 * has one output).
 *
 * Strategy "absorb into input expressions": after the blocks, a short run
 * (up to `absorbMax` cards) of float→float math with one wired input each,
 * read by one float socket of one card, becomes an input expression on that
 * socket (glsl/inputExpr): `Multiply ×2 → Add +1 → Sin` before a radius
 * socket is `sin(input * 2.0 + 1.0)` on the socket, wired straight to what
 * fed the run. The run's numbers become part of the expression (there is no
 * slider on an expression), so the same protections apply, and it is off
 * when the numbers must stay knobs.
 */
import type { GraphNode, InputSocket, DataType, SubgraphData, NodeDefinition } from '../types/nodeGraph';
import { getNodeDefinitionFor } from '../nodes/definitions';
import { resolveInputVars } from '../compiler/shaderAssembler';
import { topologicalSort } from '../compiler/topoSort';
import { isParamVisible } from '../compiler/uniformPatcher';
import type { PlayRecord } from '../types/play';
import { canHaveInputExpr, getInputExpr, inputExprKey } from '../glsl/inputExpr';

export interface OptimizeOptions {
  /** Fold a run only when it has at least this many cards (default 3). */
  minChain?: number;
  /** Cards' sliders become slider inputs on the block (default); off bakes them as numbers. */
  keepSliders?: boolean;
  /** Cards that must stay as they are (Play targets, keyframed…). */
  protect?: ReadonlySet<string>;
  /** When set, only runs made entirely of these cards fold (a selection). */
  only?: ReadonlySet<string>;
  /** Short float runs become input expressions on the card that reads them (default true). */
  absorb?: boolean;
  /** The most cards one input expression absorbs (default 3). */
  absorbMax?: number;
}

export interface Fold {
  /** The block that replaced the run, or, for an expression, the card that absorbed it. */
  blockId: string;
  nodeIds: string[];
  label: string;
  sliders: number;
  scope: string;
  kind: 'block' | 'expr';
  /** For an expression: the socket it sits on. */
  inputKey?: string;
}
export interface OptimizeReport { folds: Fold[]; before: number; after: number }
export interface OptimizeResult { nodes: GraphNode[]; report: OptimizeReport }

const NEVER = new Set(['output', 'vec4Output', 'group', 'sceneGroup', 'spaceWarpGroup', 'marchLoopGroup', 'giLitMarchGroup', 'loopCarry', 'loopIndex', 'exprNode', 'customFn', 'constants', 'constant', 'colorPicker', 'layers', 'playLayers', 'scope', 'echo', 'prevFrame', 'textureInput', 'videoInput', 'audioInput', 'midiInput', 'particleEmitter']);
const DECL = /^\s*(float|vec[234]|mat[234]|int|bool)\s+([A-Za-z_]\w*)\s*=\s*(.+);\s*$/;
/** Names a block input can't have: GLSL functions, types and keywords, and the app's own prefixes. */
const RESERVED = new Set('sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize reflect refract faceforward texture2D texture radians degrees any all not float int bool vec2 vec3 vec4 mat2 mat3 mat4 if else for while do return const uniform varying in out inout void main discard true false struct sampler2D precision highp mediump lowp dFdx dFdy fwidth'.split(' '));
/** Cards an input expression can absorb: float→float math whose GLSL is one declaration. */
const ABSORB = new Set('add subtract multiply divide negate sin cos tan tanh exp pow sqrt floor ceil round fractRaw abs sign clamp smoothstep step mod minMath max mix remap quantize atan2 expEase logisticSigmoid'.split(' '));
const MAX_EXPR_LEN = 110;
const slug = (s: string) => {
  const k = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1') || 'v';
  return RESERVED.has(k) || /^(gl_|u_)/.test(k) ? `${k}_v` : k;
};

/** The card ids Play controls point at, at any depth: those keep their sliders. */
export function playProtectedIds(play: PlayRecord | undefined): Set<string> {
  const out = new Set<string>();
  for (const c of play?.controls ?? []) { const parts = c.target.split('::'); for (const p of parts.slice(0, -1)) out.add(p); }
  return out;
}

function foldable(n: GraphNode, def: NodeDefinition | undefined, opts: Required<Pick<OptimizeOptions, 'protect'>> & OptimizeOptions): boolean {
  if (!def || NEVER.has(n.type) || opts.protect.has(n.id)) return false;
  if (opts.only && !opts.only.has(n.id)) return false;
  if (n.bypassed || (n.assignOp && n.assignOp !== '=') || n.carryMode) return false;
  if (Object.keys(n.inputs).length === 0) return false;
  if (Object.keys(n.params).some(k => k.startsWith('__kf') || k.startsWith('__param'))) return false;
  if (def.glslFunction || def.glslFunctions?.length || def.glslFunctionsFor) return false;
  return true;
}

/** Run one card's generateGLSL with the given variable names; null when its code isn't plain declarations. */
function emit(n: GraphNode, def: NodeDefinition, id: string, params: Record<string, unknown>, inputVars: Record<string, string>): { lines: Array<{ lhs: string; rhs: string }>; outputs: Record<string, string> } | null {
  let r: ReturnType<NodeDefinition['generateGLSL']>;
  try { r = def.generateGLSL({ ...n, id, params }, inputVars); } catch { return null; }
  const lines: Array<{ lhs: string; rhs: string }> = [];
  for (const raw of r.code.split('\n')) {
    if (!raw.trim()) continue;
    const m = DECL.exec(raw);
    if (!m) return null;
    lines.push({ lhs: `${m[1]} ${m[2]}`, rhs: m[3] });
  }
  return { lines, outputs: r.outputVars };
}

interface Scope { portReaders: Map<string, Set<string>>; portInputs: ReadonlySet<string> }

function readerMap(nodes: GraphNode[], byId: Map<string, GraphNode>, portReaders: Map<string, Set<string>>): Map<string, Array<{ reader: string; inputKey: string; outputKey: string }>> {
  const readers = new Map<string, Array<{ reader: string; inputKey: string; outputKey: string }>>();
  for (const n of nodes) for (const [k, s] of Object.entries(n.inputs)) if (s.connection && byId.has(s.connection.nodeId)) { const l = readers.get(s.connection.nodeId) ?? []; l.push({ reader: n.id, inputKey: k, outputKey: s.connection.outputKey }); readers.set(s.connection.nodeId, l); }
  for (const [id, keys] of portReaders) { const l = readers.get(id) ?? []; for (const k of keys) l.push({ reader: '__port__', inputKey: '', outputKey: k }); readers.set(id, l); }
  return readers;
}

function optimizeList(nodes: GraphNode[], opts: OptimizeOptions & { protect: ReadonlySet<string> }, scope: string, nextId: () => string, sc: Scope): { nodes: GraphNode[]; folds: Fold[] } {
  const minChain = opts.minChain ?? 3;
  const keepSliders = opts.keepSliders ?? true;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const defs = new Map(nodes.map(n => [n.id, getNodeDefinitionFor(n)]));
  const readers = readerMap(nodes, byId, sc.portReaders);
  // A card a group input port feeds reads that port outside its own sockets: never folded (its GLSL would bake the slider instead).
  const can = new Set(nodes.filter(n => !sc.portInputs.has(n.id) && foldable(n, defs.get(n.id), opts)).map(n => n.id));

  const taken = new Set<string>();
  const clusters: Array<{ exit: string; outputKey: string; members: string[] }> = [];
  // Exits, downstream first: a foldable card read through exactly one output by at least one
  // reader that can't be in its run (a card that won't fold, a port, or a run already made).
  let order: GraphNode[];
  try { order = topologicalSort(nodes).reverse(); } catch { order = [...nodes].reverse(); }
  for (const n of order) {
    if (!can.has(n.id) || taken.has(n.id)) continue;
    const rs = readers.get(n.id) ?? [];
    if (!rs.length || !rs.some(r => !can.has(r.reader) || taken.has(r.reader))) continue;
    const keys = new Set(rs.map(r => r.outputKey));
    if (keys.size !== 1) continue;
    const members = new Set<string>([n.id]);
    // Grow upstream: a foldable card whose every reader is already in the cluster.
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of [...members]) {
        for (const s of Object.values(byId.get(m)!.inputs)) {
          const src = s.connection?.nodeId;
          if (!src || !can.has(src) || members.has(src) || taken.has(src)) continue;
          const srs = readers.get(src) ?? [];
          if (srs.length && srs.every(r => members.has(r.reader))) { members.add(src); grew = true; }
        }
      }
    }
    if (members.size < minChain) continue;
    // Exits read by a cluster member only would be swallowed later; here every exit has an outside reader by construction.
    for (const m of members) taken.add(m);
    clusters.push({ exit: n.id, outputKey: [...keys][0], members: [...members] });
  }

  const folds: Fold[] = [];
  const replaced = new Map<string, { blockId: string }>(); // member id → block
  const blocks: GraphNode[] = [];
  for (const c of clusters) {
    const memberNodes = topologicalSort(c.members.map(id => byId.get(id)!));
    const memberSet = new Set(c.members);
    const inputs: Array<{ name: string; type: DataType; slider: { min: number; max: number } | null }> = [];
    const sockets: Record<string, InputSocket> = {};
    const params: Record<string, unknown> = {};
    const usedNames = new Set<string>();
    const unique = (base: string) => { let k = base, i = 2; while (usedNames.has(k)) k = `${base}_${i++}`; usedNames.add(k); return k; };
    // External sources → block inputs, one per source socket.
    const extName = new Map<string, string>();
    const outputsFor = new Map<string, Record<string, string>>();
    const extSocketType = (conn: { nodeId: string; outputKey: string }, fallback: DataType): DataType => {
      const src = byId.get(conn.nodeId); return (src?.outputs[conn.outputKey]?.type as DataType | undefined) ?? fallback;
    };
    for (const m of memberNodes) for (const s of Object.values(m.inputs)) {
      const conn = s.connection; if (!conn || memberSet.has(conn.nodeId)) continue;
      const key = `${conn.nodeId}:${conn.outputKey}`;
      if (extName.has(key)) continue;
      const src = byId.get(conn.nodeId);
      const base = src ? (src.type === 'constants' ? conn.outputKey : slug(`${(typeof src.params.label === 'string' && src.params.label) || getNodeDefinitionFor(src)?.label || src.type}${Object.keys(src.outputs).length > 1 ? `_${conn.outputKey}` : ''}`)) : slug(conn.outputKey);
      const name = unique(base);
      const type = extSocketType(conn, s.type);
      extName.set(key, name);
      inputs.push({ name, type, slider: null });
      sockets[name] = { type, label: name, connection: { nodeId: conn.nodeId, outputKey: conn.outputKey } };
      const o = outputsFor.get(conn.nodeId) ?? {}; o[conn.outputKey] = name; outputsFor.set(conn.nodeId, o);
    }
    // Members in order: sliders become inputs, code becomes lines.
    const lines: Array<{ lhs: string; op: string; rhs: string }> = [];
    let sliders = 0; let ok = true; let seq = 0;
    for (const m of memberNodes) {
      const def = defs.get(m.id)!;
      const localId = `n${++seq}`;
      const p: Record<string, unknown> = { ...(def.defaultParams ?? {}), ...m.params };
      for (const [key, pd] of Object.entries(def.paramDefs ?? {})) {
        if (!keepSliders || pd.type !== 'float' || pd.compileTime || pd.step === 1) continue;
        if (!isParamVisible(pd, m.params, def.defaultParams)) continue;
        if (m.inputs[key]?.connection) continue; // a wire took this slider over
        const v = p[key];
        if (typeof v !== 'number') continue;
        const name = unique(slug(`${(typeof m.params.label === 'string' && m.params.label) || def.label}_${key}`));
        inputs.push({ name, type: 'float', slider: { min: pd.min ?? Math.min(0, v), max: pd.max ?? Math.max(1, v * 2) } });
        sockets[name] = { type: 'float', label: name };
        params[name] = v; p[key] = name; sliders++;
      }
      const inputVars = resolveInputVars(m, outputsFor, byId);
      const e = emit(m, def, localId, p, inputVars);
      if (!e) { ok = false; break; }
      for (const l of e.lines) lines.push({ lhs: l.lhs, op: '=', rhs: l.rhs });
      outputsFor.set(m.id, e.outputs);
    }
    if (!ok) { for (const m of c.members) taken.delete(m); continue; }
    const exit = byId.get(c.exit)!;
    const resultVar = outputsFor.get(c.exit)![c.outputKey];
    const outType = (exit.outputs[c.outputKey]?.type ?? 'float') as DataType;
    if (!resultVar) { for (const m of c.members) taken.delete(m); continue; }
    const blockId = nextId();
    const label = memberNodes.map(m => (typeof m.params.label === 'string' && m.params.label) || defs.get(m.id)?.label || m.type).join(' → ');
    blocks.push({
      id: blockId, type: 'exprNode', position: { ...exit.position },
      inputs: sockets, outputs: { result: { type: outType, label: `Result (${outType})` } },
      params: { inputs, outputType: outType, lines, result: resultVar, expr: resultVar, __foldedFrom: c.members, __foldedLabel: label, ...params },
    });
    for (const m of c.members) replaced.set(m, { blockId });
    folds.push({ blockId, nodeIds: c.members, label, sliders, scope, kind: 'block' });
  }
  if (!folds.length) return { nodes, folds };
  // Rewire readers of each exit to its block, drop the members.
  const exitBlock = new Map(clusters.filter(c => replaced.has(c.exit)).map(c => [c.exit, replaced.get(c.exit)!.blockId]));
  const out: GraphNode[] = [];
  for (const n of nodes) {
    if (replaced.has(n.id)) continue;
    let changed = false; const inputs = { ...n.inputs };
    for (const [k, s] of Object.entries(inputs)) {
      const b = s.connection && exitBlock.get(s.connection.nodeId);
      if (b) { inputs[k] = { ...s, connection: { nodeId: b, outputKey: 'result' } }; changed = true; }
    }
    out.push(changed ? { ...n, inputs } : n);
  }
  // A block reading another run's exit reads that run's block.
  for (const b of blocks) {
    for (const [k, s] of Object.entries(b.inputs)) {
      const eb = s.connection && exitBlock.get(s.connection.nodeId);
      if (eb) b.inputs[k] = { ...s, connection: { nodeId: eb, outputKey: 'result' } };
    }
    out.push(b);
  }
  return { nodes: out, folds };
}

const fmtNum = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

const PREC: Record<string, number> = { '?': 1, ':': 1, '||': 2, '^^': 3, '&&': 4, '==': 5, '!=': 5, '<': 6, '>': 6, '<=': 6, '>=': 6, '+': 7, '-': 7, '*': 8, '/': 8 };
const OP_RE = /^(\|\||&&|\^\^|==|!=|<=|>=|[+\-*/<>?:])/;
/** The binary operators at depth 0 of an expression (unary signs and exponents skipped). */
function topOps(e: string): string[] {
  const ops: string[] = [];
  let depth = 0, prev = '';
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '(') { depth++; prev = '('; continue; }
    if (c === ')') { depth--; prev = ')'; continue; }
    if (/\s/.test(c)) continue;
    if (depth === 0) {
      const m = OP_RE.exec(e.slice(i));
      if (m) {
        const op = m[0];
        const unary = (op === '-' || op === '+') && (prev === '' || prev === '(' || prev === ',' || /^\d[eE]$/.test(prev) || OP_RE.test(prev));
        if (!unary) ops.push(op);
        prev = op; i += op.length - 1; continue;
      }
    }
    prev = /[\w.]/.test(c) ? (prev + c).slice(-2) : c;
  }
  return ops;
}
const topLevelComma = (e: string): boolean => { let d = 0; for (const c of e) { if (c === '(') d++; else if (c === ')') d--; else if (c === ',' && d === 0) return true; } return false; };
const matchParen = (e: string, i: number): number => { let d = 0; for (let j = i; j < e.length; j++) { if (e[j] === '(') d++; else if (e[j] === ')' && --d === 0) return j; } return -1; };
/** Drop the parentheses precedence makes redundant: `((a * 3.0) + 0.5)` is `a * 3.0 + 0.5`. */
function simplifyParens(e: string): string {
  for (let guard = 0; guard < 200; guard++) {
    let changed = false;
    for (let i = 0; i < e.length && !changed; i++) {
      if (e[i] !== '(') continue;
      const before = e.slice(0, i).replace(/\s+$/, '');
      if (/[\w.]$/.test(before)) continue; // a call's own parentheses
      const j = matchParen(e, i); if (j < 0) return e;
      const inner = e.slice(i + 1, j).trim();
      if (!inner || topLevelComma(inner)) continue;
      const ops = topOps(inner);
      const innerPrec = ops.length ? Math.min(...ops.map(o => PREC[o] ?? 0)) : 99;
      if (innerPrec === 0) continue;
      const after = e.slice(j + 1).replace(/^\s+/, '');
      let ok = true;
      // Left neighbour: an operator we're the right operand of, or a unary sign, or nothing.
      const lm = /(\|\||&&|\^\^|==|!=|<=|>=|[+\-*/<>?:])$/.exec(before);
      if (lm) {
        const op = lm[1];
        const rest = before.slice(0, -op.length).replace(/\s+$/, '');
        const unary = (op === '-' || op === '+') && (rest === '' || /[(,]$/.test(rest) || /(\|\||&&|\^\^|==|!=|<=|>=|[+\-*/<>?:])$/.test(rest));
        if (unary) ok = innerPrec === 99;
        else ok = innerPrec > PREC[op] || (innerPrec === PREC[op] && (op === '+' || op === '*') && ops.every(o => o === op));
      } else if (before && !/[(,]$/.test(before)) continue;
      // Right neighbour: an operator we're the left operand of (left-assoc), a swizzle, or nothing.
      const rm = OP_RE.exec(after);
      if (ok && rm) ok = innerPrec >= PREC[rm[0]];
      else if (ok && after.startsWith('.')) ok = innerPrec === 99 && /^[A-Za-z_]/.test(inner);
      else if (ok && after && !/^[),]/.test(after)) ok = false;
      if (!ok) continue;
      e = e.slice(0, i) + inner + e.slice(j + 1);
      changed = true;
    }
    if (!changed) break;
  }
  return e;
}
/** A card's GLSL as something a person would write: no `1.0 *`, no redundant parens, `+ -x` as `- x`. */
function tidyExpr(e: string): string {
  let prev = '';
  while (prev !== e) {
    prev = e;
    e = e.replace(/^1\.0 \* (?=[A-Za-z_(])/, '').replace(/\(1\.0 \* (?=[A-Za-z_(])/g, '(').replace(/\) \* 1\.0(?=[)\s,]|$)/g, ')').replace(/\b([A-Za-z_]\w*) \* 1\.0(?=[)\s,]|$)/g, '$1');
  }
  return simplifyParens(e).replace(/\+ -(\d)/g, '- $1').trim();
}

/**
 * One card's GLSL as an expression of its single wired input `__X__`, with
 * its sliders baked as numbers; null when the card isn't a plain one-line
 * float declaration of its output.
 */
function cardExpr(n: GraphNode, def: NodeDefinition, wiredKey: string, outputKey: string): string | null {
  const p: Record<string, unknown> = { ...(def.defaultParams ?? {}), ...n.params };
  for (const [key, pd] of Object.entries(def.paramDefs ?? {})) if (pd.type === 'float' && typeof p[key] === 'number') p[key] = fmtNum(p[key] as number);
  const e = emit(n, def, 'x', p, { [wiredKey]: '__X__' });
  if (!e || e.lines.length !== 1) return null;
  const [line] = e.lines;
  if (!line.lhs.startsWith('float ') || line.lhs.slice(6) !== e.outputs[outputKey]) return null;
  if (/\b(u_|g_|gl_)\w*/.test(line.rhs)) return null; // reads the environment: not an expression of its input alone
  return tidyExpr(line.rhs);
}

/**
 * Strategy "absorb": short float runs into input expressions on the card that reads them.
 * Runs over a list once, after the block pass, so only what blocks left is considered.
 */
function absorbList(nodes: GraphNode[], opts: OptimizeOptions & { protect: ReadonlySet<string> }, scope: string, sc: Scope): { nodes: GraphNode[]; folds: Fold[] } {
  const absorbMax = Math.max(1, opts.absorbMax ?? 3);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const defs = new Map(nodes.map(n => [n.id, getNodeDefinitionFor(n)]));
  const readers = readerMap(nodes, byId, sc.portReaders);
  const outType = (id: string, key: string): string | undefined => { const n = byId.get(id); return n?.outputs[key]?.type ?? defs.get(id)?.outputs[key]?.type; };
  const can = new Set(nodes.filter(n => ABSORB.has(n.type) && !sc.portInputs.has(n.id) && foldable(n, defs.get(n.id), opts) && (n.params.outputType === undefined || n.params.outputType === 'float')).map(n => n.id));
  /** The one wired float input of a card, when it has exactly one and its source emits a float. */
  const through = (n: GraphNode): { key: string; conn: { nodeId: string; outputKey: string } } | null => {
    const wired = Object.entries(n.inputs).filter(([, s]) => s.connection);
    if (wired.length !== 1) return null;
    const [key, s] = wired[0];
    if (s.type !== 'float' || !byId.has(s.connection!.nodeId) || outType(s.connection!.nodeId, s.connection!.outputKey) !== 'float') return null;
    return { key, conn: s.connection! };
  };
  const taken = new Set<string>();
  const patches = new Map<string, { params: Record<string, unknown>; inputs: Record<string, InputSocket> }>();
  const folds: Fold[] = [];
  let order: GraphNode[];
  try { order = topologicalSort(nodes).reverse(); } catch { order = [...nodes].reverse(); }
  for (const c of order) {
    if (taken.has(c.id)) continue;
    for (const [k, s] of Object.entries(c.inputs)) {
      const conn = s.connection;
      if (!conn || !can.has(conn.nodeId) || taken.has(conn.nodeId) || !canHaveInputExpr(c, k)) continue;
      if (outType(conn.nodeId, conn.outputKey) !== 'float') continue;
      // Walk upstream while each card is read only here and passes one float through.
      const chain: Array<{ node: GraphNode; expr: string; up: { nodeId: string; outputKey: string } }> = [];
      let cur = conn; let reader = { id: c.id, key: k };
      let composed = 'input';
      while (chain.length < absorbMax && can.has(cur.nodeId) && !taken.has(cur.nodeId)) {
        const n = byId.get(cur.nodeId)!;
        const rs = readers.get(n.id) ?? [];
        if (rs.length !== 1 || rs[0].reader !== reader.id || rs[0].inputKey !== reader.key || rs[0].outputKey !== cur.outputKey) break;
        const t = through(n); if (!t) break;
        const ex = cardExpr(n, defs.get(n.id)!, t.key, cur.outputKey); if (!ex) break;
        // The new card is upstream: it becomes the `input` of what we have so far.
        const next = composed.replace(/\binput\b/g, `(${ex})`);
        const shown = tidyExpr(next.replace(/__X__/g, 'input'));
        if (chain.length && shown.length > MAX_EXPR_LEN) break;
        chain.push({ node: n, expr: shown, up: t.conn });
        composed = next.replace(/__X__/g, 'input');
        reader = { id: n.id, key: t.key };
        cur = t.conn;
      }
      if (!chain.length) continue;
      const last = chain[chain.length - 1];
      const existing = getInputExpr(c, k);
      const expr = tidyExpr(existing ? existing.replace(/\binput\b/g, `(${last.expr})`) : last.expr);
      for (const m of chain) taken.add(m.node.id);
      const patch = patches.get(c.id) ?? { params: {}, inputs: {} };
      patch.params[inputExprKey(k)] = expr;
      patch.inputs[k] = { ...s, connection: { nodeId: last.up.nodeId, outputKey: last.up.outputKey } };
      patches.set(c.id, patch);
      const consumerLabel = (typeof c.params.label === 'string' && c.params.label) || defs.get(c.id)?.label || c.type;
      folds.push({ blockId: c.id, nodeIds: chain.map(m => m.node.id), label: `${consumerLabel} · ${s.label || k} = ${expr}`, sliders: 0, scope, kind: 'expr', inputKey: k });
    }
  }
  if (!folds.length) return { nodes, folds };
  const out: GraphNode[] = [];
  for (const n of nodes) {
    if (taken.has(n.id)) continue;
    const p = patches.get(n.id);
    out.push(p ? { ...n, params: { ...n.params, ...p.params }, inputs: { ...n.inputs, ...p.inputs } } : n);
  }
  return { nodes: out, folds };
}

function passes(nodes: GraphNode[], opts: OptimizeOptions & { protect: ReadonlySet<string> }, scope: string, nextId: () => string, sc: Scope): { nodes: GraphNode[]; folds: Fold[] } {
  const a = optimizeList(nodes, opts, scope, nextId, sc);
  if (opts.absorb === false) return a;
  const b = absorbList(a.nodes, opts, scope, sc);
  return { nodes: b.nodes, folds: [...a.folds, ...b.folds] };
}

export function optimizeGraph(nodes: GraphNode[], options: OptimizeOptions = {}): OptimizeResult {
  const protect = options.protect ?? new Set<string>();
  let seq = 0;
  const used = new Set<string>();
  const collect = (list: GraphNode[]) => { for (const n of list) { used.add(n.id); const sg = n.params.subgraph as SubgraphData | undefined; if (sg) collect(sg.nodes); } };
  collect(nodes);
  const nextId = () => { let id = `block_${++seq}`; while (used.has(id)) id = `block_${++seq}`; used.add(id); return id; };
  const opts = { ...options, protect };
  const before = countNodes(nodes);
  const folds: Fold[] = [];
  const top = passes(nodes, opts, 'graph', nextId, { portReaders: new Map(), portInputs: new Set() });
  folds.push(...top.folds);
  // Inside groups: the same pass, with the group's output ports as outside readers (an exit read by a port keeps working through the block).
  const result = top.nodes.map(n => {
    const sg = n.params.subgraph as SubgraphData | undefined;
    if (!sg || !sg.nodes.length) return n;
    const portReaders = new Map<string, Set<string>>();
    for (const p of sg.outputPorts ?? []) { const s = portReaders.get(p.fromNodeId) ?? new Set(); s.add(p.fromOutputKey); portReaders.set(p.fromNodeId, s); }
    const portInputs = new Set((sg.inputPorts ?? []).map(p => p.toNodeId).filter(Boolean));
    const inner = passes(sg.nodes, opts, (typeof n.params.label === 'string' && n.params.label) || 'group', nextId, { portReaders, portInputs });
    if (!inner.folds.length) return n;
    folds.push(...inner.folds);
    // A port that read a run's exit reads its block (an absorbed run is never read by a port: ports count as readers).
    const blockOf = new Map<string, string>();
    for (const f of inner.folds) if (f.kind === 'block') for (const id of f.nodeIds) blockOf.set(id, f.blockId);
    const outputPorts = (sg.outputPorts ?? []).map(p => (blockOf.has(p.fromNodeId) ? { ...p, fromNodeId: blockOf.get(p.fromNodeId)!, fromOutputKey: 'result' } : p));
    return { ...n, params: { ...n.params, subgraph: { ...sg, nodes: inner.nodes, outputPorts } } };
  });
  return { nodes: result, report: { folds, before, after: countNodes(result) } };
}

function countNodes(nodes: GraphNode[]): number {
  let c = 0;
  for (const n of nodes) { c++; const sg = n.params.subgraph as SubgraphData | undefined; if (sg) c += countNodes(sg.nodes); }
  return c;
}
