/**
 * The Expression Block side of the Explain panel's build-up view (BuildUpView.tsx): which names
 * vary across the screen (from the wiring and the lines above), what a picture per row would
 * cost, the small renders themselves, and showing a row on the big ▶ preview.
 *
 * Rendering a row means compiling the block's upstream graph and the lines above the row's
 * line, then the row's expression as an output. All the rows of a line share one compile: the
 * copy of the block declares every row as its own variable (`pv_s0`, `pv_s1`…), and one program
 * picks which one to write with a uniform (u_pvSel), so N rows are one compile and N tiny draws
 * (lib/nodePreviewRenderer.renderValues). Results are cached by the shader and its uniform
 * values; a graph that costs too much (lib/glslPatterns/buildUp.pictureBudget) gets strips.
 *
 * Store reads happen here, on demand (getState), never as subscriptions in the rows.
 */
import * as THREE from 'three';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { compileNodePreviewGraph } from '../../lib/compileNodePreviewShader';
import { nodePreviewRenderer } from '../../lib/nodePreviewRenderer';
import { inject } from '../../lib/nodePreview/previewGlsl';
import { startLineProbe } from '../code/LinePreview';
import { HEAVY_TYPE, parseExpr, allNodes, type BuildUpRow, type GraphCost } from '../../lib/glslPatterns';
import { scopeNodes } from './hosts';

/** A row's rendered values: RGBA floats, w × h, row 0 at the bottom. */
export interface RowField { data: Float32Array; w: number; h: number }

export type PictureShape = 'square' | 'strip';

export interface BuildUpHost {
  /** Whether a name the line reads can differ from pixel to pixel. */
  varies: (name: string) => boolean;
  /** Small renders of the rows; absent where nothing can be rendered (CPU pictures only). */
  pictures?: {
    /** What a render per row would cost (null: can't render here). */
    cost: () => GraphCost | null;
    /** Render these rows (their `expr` and `type`), keyed by row key. Null when it doesn't compile. */
    render: (rows: BuildUpRow[], shape: PictureShape) => Promise<Map<string, RowField> | null>;
  };
  /** Show a row on the big ▶ preview; null shows the whole line again. */
  show?: (row: BuildUpRow | null) => void;
}

/** Pixels on a side of a row's square picture, and across a strip. */
export const SQUARE_PX = 64;
export const STRIP_PX = 96;

type Line = { lhs?: string; op?: string; rhs?: string; off?: boolean };
type InputDef = { name: string; type: string; slider?: unknown };

/** Graph node types whose output is the same at every pixel. */
const CONSTANT_SOURCES = /^(time|clock|constant|constants|float|int|colorPicker|color|constColor|mouse|mouseButton|lfo|audioInput|midiInput|slider|knob|bpm|beat)$/;

const readsAny = (src: string, names: ReadonlySet<string>): boolean => {
  const r = parseExpr(src);
  if (!r.ok) return [...names].some(n => new RegExp(`\\b${n}\\b`).test(src));
  return allNodes(r.expr).some(n => n.kind === 'ident' && names.has(n.name));
};

/**
 * The names that vary across the screen before line `at` of the block runs (`'return'`: after
 * every line): an input wired from anything but a constant source (a slider, the clock, a
 * colour…), then each line's variable when its expression reads one that varies.
 */
export function exprBlockVarying(node: GraphNode, at: number | 'return', nodes: readonly GraphNode[]): Set<string> {
  const out = new Set<string>();
  for (const inp of (node.params.inputs as InputDef[] | undefined) ?? []) {
    const c = node.inputs?.[inp.name]?.connection;
    if (!c) continue; // a slider or a fallback: one value
    const src = nodes.find(n => n.id === c.nodeId);
    if (!src || !CONSTANT_SOURCES.test(src.type)) out.add(inp.name);
  }
  const lines = (node.params.lines as Line[] | undefined) ?? [];
  const upTo = at === 'return' ? lines.length : at;
  for (let i = 0; i < upTo; i++) {
    const l = lines[i];
    if (!l || l.off || !l.lhs || !l.rhs) continue;
    const name = /([A-Za-z_]\w*)\s*(?:[.[][^=]*)?$/.exec(l.lhs.trim())?.[1];
    if (!name) continue;
    const compound = !!l.op && l.op !== '=';
    const swizzle = /[.[]/.test(l.lhs);
    const v = readsAny(l.rhs, out) || ((compound || swizzle) && out.has(name));
    if (v) out.add(name); else if (!compound && !swizzle) out.delete(name);
  }
  return out;
}

/** The block's upstream: its nodes and the heavy ones among them. */
function upstream(node: GraphNode, nodes: readonly GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  const queue = Object.values(node.inputs ?? {}).flatMap(s => (s.connection ? [s.connection.nodeId] : []));
  const out: GraphNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = nodes.find(x => x.id === id);
    if (!n) continue;
    out.push(n);
    for (const s of Object.values(n.inputs ?? {})) if (s.connection) queue.push(s.connection.nodeId);
  }
  return out;
}

/** Measured cost per block (ms of the last render of its pictures), so the next update can fall back. */
const measured = new Map<string, number>();

/** What rendering a picture per row would cost for this block. */
export function exprBlockCost(node: GraphNode, nodes: readonly GraphNode[]): GraphCost {
  const up = upstream(node, nodes);
  return {
    nodes: up.length,
    heavyTypes: [...new Set(up.filter(n => HEAVY_TYPE.test(n.type)).map(n => n.type))],
    textures: up.filter(n => /texture|video|image|webcam|camera|data/i.test(n.type)).length,
    lastMs: measured.get(node.id) ?? 0,
  };
}

// Rendered rows, by shader + uniforms + shape (a small LRU: each entry is a few KB)
const cache = new Map<string, Map<string, RowField>>();
const MAX_CACHED = 40;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}

/** The copy of the block whose extra variables are the rows (pv_s0…), after the lines above `at`. */
export function rowsCopy(node: GraphNode, at: number | 'return', exprs: Array<{ expr: string; type: string }>): GraphNode {
  const lines = (node.params.lines as Line[] | undefined) ?? [];
  const above = at === 'return' ? lines : lines.slice(0, at);
  const extra = exprs.map((e, i) => ({ lhs: `${e.type} pv_s${i}`, op: '=', rhs: e.expr }));
  return {
    ...node,
    params: { ...node.params, lines: [...above, ...extra], result: '', outputs: extra.map((_, i) => `pv_s${i}`) },
    // Only the result stays a socket: the preview graph draws it; the rows are read by name
    outputs: { result: node.outputs?.result ?? { type: ((node.params.outputType as string) || 'float') as never, label: 'Result' } } as GraphNode['outputs'],
  };
}

/** A row's value packed for the float target: float → R, vec2 → RG, vec3 / vec4 → RGB. */
const pack = (v: string, type: string) =>
  type === 'vec2' ? `vec4(${v}, 0.0, 1.0)` : type === 'vec3' ? `vec4(${v}, 1.0)` : type === 'vec4' ? `vec4((${v}).rgb, 1.0)` : `vec4(float(${v}), 0.0, 0.0, 1.0)`;

/** Uniform values from a compile, as three.js uniforms. */
function uniformsOf(values: Record<string, number | number[]>): Record<string, THREE.IUniform> {
  const out: Record<string, THREE.IUniform> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = { value: Array.isArray(v) ? (v.length === 2 ? new THREE.Vector2(v[0], v[1]) : v.length === 3 ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector4(v[0], v[1], v[2] ?? 0, v[3] ?? 0)) : v };
  }
  return out;
}

/** Render the rows of one line of an Expression Block (one compile, a draw per distinct row). */
export async function renderExprBlockRows(nodeId: string, at: number | 'return', rows: BuildUpRow[], shape: PictureShape): Promise<Map<string, RowField> | null> {
  const nodes = scopeNodes();
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;
  return renderBlockRows(node, nodes, at, rows, shape);
}

/** A row to render: its key, its expression (in the block's names after line `at`) and its type. */
export type RenderRow = Pick<BuildUpRow, 'key' | 'expr' | 'type'>;

/**
 * Render rows as extra variables of an Expression Block in any graph (`nodes`, which holds the
 * block): the Explain panel's build-up (the open graph) and the Expression Builder's tiles (its
 * own small graph). `size` overrides a square's pixels (a bigger picture for a preview).
 */
export async function renderBlockRows(node: GraphNode, nodes: readonly GraphNode[], at: number | 'return', rows: readonly RenderRow[], shape: PictureShape, size?: number): Promise<Map<string, RowField> | null> {
  const nodeId = node.id;
  // Rows with the same expression share a draw (the result is usually the last step)
  const distinct: Array<{ expr: string; type: string }> = [];
  const slot = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.type}|${r.expr}`;
    if (!slot.has(k)) { slot.set(k, distinct.length); distinct.push({ expr: r.expr, type: r.type }); }
  }
  if (!distinct.length) return new Map();
  const copy = rowsCopy(node, at, distinct);
  const compiled = compileNodePreviewGraph(copy.id, nodes.map(n => (n.id === copy.id ? copy : n)));
  if (!compiled) return null;
  const vars = compiled.nodeOutputVars.get(copy.id) ?? {};
  const names = distinct.map((_, i) => vars[`pv_s${i}`]);
  if (names.some(n => !n)) return null;
  const tail = names.map((v, i) => `  ${i ? 'else ' : ''}if (u_pvSel < ${i}.5) gl_FragColor = ${pack(v!, distinct[i].type)};`).join('\n');
  const fs = inject(compiled.fragmentShader, 'uniform float u_pvSel;\n', tail);
  if (!fs) return null;
  const [w, h] = shape === 'square' ? [size ?? SQUARE_PX, size ?? SQUARE_PX] : [STRIP_PX, 1];
  // u_time stays out of the key: a picture is a snapshot, like the node thumbnails
  const key = `${djb2(fs)}|${shape}|${w}|${JSON.stringify(compiled.paramUniforms)}`;
  let fields = cache.get(key);
  if (!fields) {
    const uniforms = { ...uniformsOf(compiled.paramUniforms), u_time: { value: useNodeGraphStore.getState().currentTime ?? 0 } };
    const r = await nodePreviewRenderer.renderValues(fs, uniforms, w, h, distinct.length);
    if (!r) return null;
    measured.set(nodeId, r.ms);
    fields = new Map(r.fields.map((data, i) => [String(i), { data, w, h }]));
    cache.set(key, fields);
    while (cache.size > MAX_CACHED) { const oldest = cache.keys().next().value; if (oldest === undefined) break; cache.delete(oldest); }
  }
  const out = new Map<string, RowField>();
  for (const r of rows) { const f = fields.get(String(slot.get(`${r.type}|${r.expr}`))); if (f) out.set(r.key, f); }
  return out;
}

/** The build-up host of one Expression Block line (`at`: its index, or 'return'). */
export function exprBlockBuildUp(node: GraphNode, at: number | 'return'): BuildUpHost {
  const nodes = scopeNodes();
  const varying = exprBlockVarying(node, at, nodes);
  // Pictures need the block at the top level: inside a group its inputs come from the group's
  // sockets, which a preview of the inner level can't feed (the strips still work there)
  const topLevel = useNodeGraphStore.getState().activeGroupPath.length === 0;
  const inputs = new Set(((node.params.inputs as InputDef[] | undefined) ?? []).map(i => i.name));
  return {
    // `t` is the clock; `p` the block's scratch (one value until a line sets it from one that varies)
    varies: name => varying.has(name),
    pictures: {
      cost: () => (topLevel ? exprBlockCost(node, scopeNodes()) : null),
      render: (rows, shape) => renderExprBlockRows(node.id, at, rows, shape),
    },
    show: row => {
      const whole = at === 'return' ? { kind: 'return' as const } : { kind: 'line' as const, index: at };
      if (!row || row.kind === 'result') { startLineProbe(node, whole); return; }
      if (row.kind === 'input' && inputs.has(row.label) && !varyingLines(node, at).has(row.label)) { startLineProbe(node, { kind: 'input', name: row.label }); return; }
      startLineProbe(node, { kind: 'expr', line: at, code: row.expr, type: row.type, step: row.label });
    },
  };
}

/** Names a line above `at` assigns (an input reassigned by a line isn't the input any more). */
function varyingLines(node: GraphNode, at: number | 'return'): Set<string> {
  const lines = (node.params.lines as Line[] | undefined) ?? [];
  const out = new Set<string>();
  for (const l of at === 'return' ? lines : lines.slice(0, at)) {
    const name = l.lhs && !l.off ? /([A-Za-z_]\w*)\s*(?:[.[][^=]*)?$/.exec(l.lhs.trim())?.[1] : undefined;
    if (name) out.add(name);
  }
  return out;
}
