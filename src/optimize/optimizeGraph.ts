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
 */
import type { GraphNode, InputSocket, DataType, SubgraphData, NodeDefinition } from '../types/nodeGraph';
import { getNodeDefinitionFor } from '../nodes/definitions';
import { resolveInputVars } from '../compiler/shaderAssembler';
import { topologicalSort } from '../compiler/topoSort';
import { isParamVisible } from '../compiler/uniformPatcher';
import type { PlayRecord } from '../types/play';

export interface OptimizeOptions {
  /** Fold a run only when it has at least this many cards (default 3). */
  minChain?: number;
  /** Cards' sliders become slider inputs on the block (default); off bakes them as numbers. */
  keepSliders?: boolean;
  /** Cards that must stay as they are (Play targets, keyframed…). */
  protect?: ReadonlySet<string>;
  /** When set, only runs made entirely of these cards fold (a selection). */
  only?: ReadonlySet<string>;
}

export interface Fold { blockId: string; nodeIds: string[]; label: string; sliders: number; scope: string }
export interface OptimizeReport { folds: Fold[]; before: number; after: number }
export interface OptimizeResult { nodes: GraphNode[]; report: OptimizeReport }

const NEVER = new Set(['output', 'vec4Output', 'group', 'sceneGroup', 'spaceWarpGroup', 'marchLoopGroup', 'giLitMarchGroup', 'loopCarry', 'loopIndex', 'exprNode', 'customFn', 'constants', 'constant', 'colorPicker', 'layers', 'playLayers', 'scope', 'echo', 'prevFrame', 'textureInput', 'videoInput', 'audioInput', 'midiInput', 'particleEmitter']);
const DECL = /^\s*(float|vec[234]|mat[234]|int|bool)\s+([A-Za-z_]\w*)\s*=\s*(.+);\s*$/;
/** Names a block input can't have: GLSL functions, types and keywords, and the app's own prefixes. */
const RESERVED = new Set('sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize reflect refract faceforward texture2D texture radians degrees any all not float int bool vec2 vec3 vec4 mat2 mat3 mat4 if else for while do return const uniform varying in out inout void main discard true false struct sampler2D precision highp mediump lowp dFdx dFdy fwidth'.split(' '));
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

function optimizeList(nodes: GraphNode[], opts: OptimizeOptions & { protect: ReadonlySet<string> }, scope: string, nextId: () => string, portReaders: Map<string, Set<string>>): { nodes: GraphNode[]; folds: Fold[] } {
  const minChain = opts.minChain ?? 3;
  const keepSliders = opts.keepSliders ?? true;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const defs = new Map(nodes.map(n => [n.id, getNodeDefinitionFor(n)]));
  // readers: source id → set of "readerId:outputKey"
  const readers = new Map<string, Array<{ reader: string; outputKey: string }>>();
  for (const n of nodes) for (const s of Object.values(n.inputs)) if (s.connection && byId.has(s.connection.nodeId)) { const l = readers.get(s.connection.nodeId) ?? []; l.push({ reader: n.id, outputKey: s.connection.outputKey }); readers.set(s.connection.nodeId, l); }
  for (const [id, keys] of portReaders) { const l = readers.get(id) ?? []; for (const k of keys) l.push({ reader: '__port__', outputKey: k }); readers.set(id, l); }
  const can = new Set(nodes.filter(n => foldable(n, defs.get(n.id), opts)).map(n => n.id));

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
    folds.push({ blockId, nodeIds: c.members, label, sliders, scope });
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
  const top = optimizeList(nodes, opts, 'graph', nextId, new Map());
  folds.push(...top.folds);
  // Inside groups: the same pass, with the group's output ports as outside readers (an exit read by a port keeps working through the block).
  const result = top.nodes.map(n => {
    const sg = n.params.subgraph as SubgraphData | undefined;
    if (!sg || !sg.nodes.length) return n;
    const portReaders = new Map<string, Set<string>>();
    for (const p of sg.outputPorts ?? []) { const s = portReaders.get(p.fromNodeId) ?? new Set(); s.add(p.fromOutputKey); portReaders.set(p.fromNodeId, s); }
    const inner = optimizeList(sg.nodes, opts, (typeof n.params.label === 'string' && n.params.label) || 'group', nextId, portReaders);
    if (!inner.folds.length) return n;
    folds.push(...inner.folds);
    const blockOf = new Map<string, string>();
    for (const f of inner.folds) for (const id of f.nodeIds) blockOf.set(id, f.blockId);
    const outputPorts = (sg.outputPorts ?? []).map(p => (blockOf.has(p.fromNodeId) ? { ...p, fromNodeId: blockOf.get(p.fromNodeId)!, fromOutputKey: 'result' } : p));
    const inputPorts = (sg.inputPorts ?? []).map(p => (blockOf.has(p.toNodeId) ? { ...p, toNodeId: '', toInputKey: '' } : p));
    return { ...n, params: { ...n.params, subgraph: { ...sg, nodes: inner.nodes, outputPorts, inputPorts } } };
  });
  return { nodes: result, report: { folds, before, after: countNodes(result) } };
}

function countNodes(nodes: GraphNode[]): number {
  let c = 0;
  for (const n of nodes) { c++; const sg = n.params.subgraph as SubgraphData | undefined; if (sg) c += countNodes(sg.nodes); }
  return c;
}
