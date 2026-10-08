/**
 * fragments.ts — the pieces an "Inspired by" surprise is made of (docs/surprise.md).
 *
 * A *source* is a graph (an example, a saved graph) or a piece of GLSL (a GLSL-page shader, a Convert
 * example, a Custom Function preset). A *fragment* is one stage's worth of a source, typed by what it
 * takes and gives:
 *
 *   vec2 → vec2   space      (bend, tile, spin the coordinates)
 *   vec2 → float  field      (a shape, a noise, waves)
 *   float → float light      (falloff, shaping)
 *   float → vec3  colour     (a palette, a ramp)
 *   vec3 → vec3   post       (grade, tone)
 *   vec2 → vec3   picture    (field, light and colour in one)
 *
 * Fragments come from the technique hits of pattern discovery (src/patterns: the matched nodes, copied
 * with their settings and the constant nodes feeding them), from Expression Blocks and Custom Functions
 * (copied whole; a Custom Function's helpers renamed), and from GLSL functions lifted into a Custom
 * Function (lift.ts). Pure: sources in, fragments out, cached per source.
 */
import type { DataType, GraphNode } from '../../types/nodeGraph';
import { analyseGraph } from '../../patterns/patternIndex';
import { TECHNIQUE_BY_ID, type FamilyId } from '../../patterns/catalogue';
import { CONVERSION_TYPES } from '../../patterns/dataflow';
import { getNodeDefinition } from '../../nodes/definitions';
import { glslFunctions, liftFunction, namespaceFor, renameIdents } from './lift';

export type Stage = 'space' | 'field' | 'light' | 'colour' | 'post' | 'picture';
export type VType = 'float' | 'vec2' | 'vec3';

export interface InspSource {
  /** `example:<key>`, `saved:<name>`, `shader:<id>`, `example-convert:<key>`, `preset:<key>` (the Code Explorer's ids). */
  id: string;
  label: string;
  kind: 'graph' | 'glsl';
  nodes?: readonly GraphNode[];
  code?: string;
}

export interface Port { nodeId: string; key: string }

export interface Fragment {
  key: string;
  sourceId: string;
  sourceLabel: string;
  /** A technique family, or 'code' for lifted/copied code that isn't a named technique. */
  family: FamilyId | 'code';
  /** The technique's name, or the function's. */
  what: string;
  stage: Stage;
  inType: VType;
  outType: VType;
  how: 'nodes' | 'code';
  /** Template nodes (the source's ids; renamed when placed). */
  nodes: GraphNode[];
  entry: Port[];
  time: Port[];
  exit: { nodeId: string; key: string };
  /** The source's nodes, to show where it came from. */
  at: Array<{ id: string; path: string[] }>;
  /** For GLSL: the function's line in the source. */
  line?: number;
}

const BASIC = new Set(['float', 'vec2', 'vec3', 'vec4']);
/** Node types that read the frame, a file, a device, other frames or other passes: never copied. */
const DENY = /prev|texture|video|audio|midi|webcam|camera|image|pass|echo|bake|frameStack|timeCube|particle|agent|data|group|output|loop|march|scene|trail|deposit|grid|feedback|keyboard|sample|font|text|bloom|blur/i;
const COORD = new Set(['uv', 'pixelUV', 'fragCoord']);
const TIME = new Set(['time']);
const POSITION_KEY = /^(uv|p|pos|position|point|coord|coords|st|q)$/i;

export function stageOf(inType: string, outType: string): Stage | null {
  const k = `${inType}>${outType}`;
  return ({ 'vec2>vec2': 'space', 'vec2>float': 'field', 'float>float': 'light', 'float>vec3': 'colour', 'vec3>vec3': 'post', 'vec2>vec3': 'picture' } as Record<string, Stage>)[k] ?? null;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Every socket of a node is a plain value and its type is one a surprise may copy. */
function copyable(n: GraphNode): boolean {
  if (DENY.test(n.type) || n.params?.subgraph) return false;
  const def = getNodeDefinition(n.type);
  if (!def) return false;
  return [...Object.values(n.inputs ?? {}), ...Object.values(n.outputs ?? {})].every(s => BASIC.has(s.type) || s.type === 'mat2');
}

/** A node with nothing wired into it (a slider, a constant). */
const isLeaf = (n: GraphNode) => !Object.values(n.inputs ?? {}).some(s => s.connection);

/** Rename a Custom Function's helper functions into their own namespace (body and helpers alike). */
function namespaceCustomFn(n: GraphNode, ns: string): GraphNode {
  const fnText = typeof n.params.glslFunctions === 'string' ? n.params.glslFunctions : '';
  if (!fnText.trim()) return n;
  const map: Record<string, string> = {};
  for (const f of glslFunctions(fnText)) map[f.name] = `${ns}_${f.name}`;
  for (const m of fnText.matchAll(/(^|\n)[ \t]*(?:#define[ \t]+|const\s+\w+\s+)([A-Za-z_]\w*)/g)) map[m[2]] = `${ns}_${m[2]}`;
  return { ...n, params: { ...n.params, glslFunctions: renameIdents(fnText, map), body: renameIdents(String(n.params.body ?? ''), map) } };
}

/**
 * One fragment from a set of a graph's top-level nodes (a technique hit, or one code node).
 * Null when it can't stand alone or its types make no stage.
 */
export function fragmentFromNodes(src: InspSource, ids: string[], meta: { family: Fragment['family']; what: string; key: string }): Fragment | null {
  const all = src.nodes ?? [];
  const byId = new Map(all.map(n => [n.id, n]));
  const H = new Set(ids.filter(id => byId.has(id) && !COORD.has(byId.get(id)!.type) && !TIME.has(byId.get(id)!.type)));
  if (!H.size) return null;
  // Conversion nodes between two of its nodes (the dataflow skips them) come along.
  for (let pass = 0; pass < 2; pass++) for (const id of [...H]) for (const s of Object.values(byId.get(id)!.inputs ?? {})) {
    const x = s.connection && byId.get(s.connection.nodeId);
    if (x && !H.has(x.id) && CONVERSION_TYPES.has(x.type) && Object.values(x.inputs).some(i => i.connection && H.has(i.connection.nodeId))) H.add(x.id);
  }
  if ([...H].some(id => !copyable(byId.get(id)!))) return null;
  // Constant nodes feeding it come along too (their values are part of the look).
  for (const id of [...H]) for (const s of Object.values(byId.get(id)!.inputs ?? {})) {
    const x = s.connection && byId.get(s.connection.nodeId);
    if (x && !H.has(x.id) && !COORD.has(x.type) && !TIME.has(x.type) && isLeaf(x) && copyable(x) && Object.keys(x.outputs).length) H.add(x.id);
  }
  // External inputs: time, the coordinates, or the value coming in.
  const ext: Array<{ port: Port; type: string; from: GraphNode }> = [];
  const time: Port[] = [];
  for (const id of H) for (const [key, s] of Object.entries(byId.get(id)!.inputs ?? {})) {
    const c = s.connection;
    if (!c || H.has(c.nodeId)) continue;
    const from = byId.get(c.nodeId);
    if (!from) continue;
    if (TIME.has(from.type)) time.push({ nodeId: id, key });
    else ext.push({ port: { nodeId: id, key }, type: s.type, from });
  }
  const coordIn = ext.filter(e => COORD.has(e.from.type) && e.type === 'vec2');
  let inType: string | undefined = coordIn.length ? 'vec2' : ext.find(e => BASIC.has(e.type) && e.type !== 'vec4')?.type;
  let entry: Port[] = inType ? ext.filter(e => e.type === inType && (inType !== 'vec2' || coordIn.length === 0 || COORD.has(e.from.type))).map(e => e.port) : [];
  if (!entry.length) {
    // Nothing wired in: a position socket left at its default reads the coordinates.
    for (const id of H) for (const [key, s] of Object.entries(byId.get(id)!.inputs ?? {})) {
      if (!s.connection && s.type === 'vec2' && POSITION_KEY.test(key)) entry.push({ nodeId: id, key });
    }
    inType = entry.length ? 'vec2' : undefined;
  }
  if (!inType || !entry.length) return null;
  // The way out: an output something outside it read, the last one in the graph's order.
  const outs: Array<{ nodeId: string; key: string; type: string }> = [];
  for (const n of all) {
    if (H.has(n.id)) continue;
    for (const s of Object.values(n.inputs ?? {})) {
      const c = s.connection;
      if (c && H.has(c.nodeId)) {
        const t = byId.get(c.nodeId)!.outputs?.[c.outputKey]?.type;
        if (t) outs.push({ nodeId: c.nodeId, key: c.outputKey, type: t });
      }
    }
  }
  const exit = [...outs].reverse().find(o => stageOf(inType!, o.type));
  if (!exit) return null;
  const stage = stageOf(inType, exit.type)!;
  const nodes = [...H].map(id => {
    let n = clone(byId.get(id)!) as GraphNode;
    // Wires from outside are dropped here; placing it wires the entry, time and nothing else.
    for (const s of Object.values(n.inputs ?? {})) if (s.connection && !H.has(s.connection.nodeId)) delete s.connection;
    if (n.type === 'customFn') n = namespaceCustomFn(n, namespaceFor(`${src.id}/${id}`));
    return n;
  });
  return {
    key: `${src.id}#${meta.key}`, sourceId: src.id, sourceLabel: src.label, family: meta.family, what: meta.what,
    stage, inType: inType as VType, outType: exit.type as VType, how: nodes.some(n => n.type === 'exprNode' || n.type === 'customFn') ? 'code' : 'nodes',
    nodes, entry, time, exit: { nodeId: exit.nodeId, key: exit.key },
    at: nodes.map(n => ({ id: n.id, path: [] })),
  };
}

/**
 * What fills a stage, in words a person would use for "you usually put an Expression Block in the space
 * stage": the technique's name, or for copied code what it is (Expression Block, Custom Function).
 */
export function stageChoice(f: Pick<Fragment, 'family' | 'what' | 'nodes'>): string {
  if (f.family !== 'code') return f.what;
  if (f.nodes.some(n => n.type === 'exprNode')) return 'Expression Block';
  if (f.nodes.some(n => n.type === 'customFn')) return 'Custom Function';
  return f.what;
}

const ARG_TYPES = new Set(['float', 'vec2', 'vec3']);
const TIME_ARG = /^(t|time|tm|iTime|u_time|T)$/;

/** Fragments lifted from the GLSL functions in a text: one Custom Function each. */
export function fragmentsFromCode(src: InspSource, code: string, field = 'code'): Fragment[] {
  const out: Fragment[] = [];
  for (const f of glslFunctions(code)) {
    if (!ARG_TYPES.has(f.ret) || !f.params.length || f.params.some(p => p.qual && /out/.test(p.qual) || p.name.includes('['))) continue;
    const first = f.params[0];
    if (!ARG_TYPES.has(first.type)) continue;
    const stage = stageOf(first.type, f.ret);
    if (!stage) continue;
    // The other arguments: time, or a float set to 1.
    const rest = f.params.slice(1);
    if (rest.some(p => p.type !== 'float')) continue;
    const ns = namespaceFor(`${src.id}/${field}/${f.name}`);
    const lifted = liftFunction(code, f.name, ns);
    if (!lifted) continue;
    const usesTime = rest.some(p => TIME_ARG.test(p.name));
    const args = ['p', ...rest.map(p => (TIME_ARG.test(p.name) ? 'time' : '1.0'))];
    const id = 'fn';
    const node: GraphNode = {
      id, type: 'customFn', position: { x: 0, y: 0 },
      inputs: { p: { type: first.type as DataType, label: 'p' }, ...(usesTime ? { time: { type: 'float' as DataType, label: 'time' } } : {}) },
      outputs: { result: { type: f.ret as DataType, label: 'Result' } },
      params: {
        label: f.name,
        inputs: [{ name: 'p', type: first.type, slider: null }, ...(usesTime ? [{ name: 'time', type: 'float', slider: null }] : [])],
        outputType: f.ret, body: `return ${lifted.fn}(${args.join(', ')});`, glslFunctions: lifted.code,
      },
    };
    out.push({
      key: `${src.id}#${field}:${f.name}`, sourceId: src.id, sourceLabel: src.label, family: 'code', what: `${f.name}()`,
      stage, inType: first.type as VType, outType: f.ret as VType, how: 'code', nodes: [node],
      entry: [{ nodeId: id, key: 'p' }], time: usesTime ? [{ nodeId: id, key: 'time' }] : [], exit: { nodeId: id, key: 'result' },
      at: [], line: code.slice(0, f.start).split('\n').length,
    });
  }
  return out;
}

/** Families that need more than a picture: never a stage of a surprise. */
const SKIP_FAMILIES = new Set<FamilyId>(['march3d', 'agents', 'feedback']);

const cache = new Map<string, Fragment[]>();

/** Every fragment of a source (cached by its id and content). */
export function fragmentsOf(src: InspSource): Fragment[] {
  const ck = `${src.id}\u0001${src.kind === 'glsl' ? src.code : JSON.stringify(src.nodes)}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const out: Fragment[] = [];
  const seen = new Set<string>();
  const push = (f: Fragment | null) => {
    if (!f) return;
    const sig = `${f.stage}:${f.nodes.map(n => n.id).sort().join(',')}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(f);
  };
  if (src.kind === 'glsl') out.push(...fragmentsFromCode(src, src.code ?? ''));
  else {
    const nodes = src.nodes ?? [];
    let gp;
    try { gp = analyseGraph({ id: src.id, label: src.label, origin: src.id.startsWith('saved:') ? 'saved' : 'example', nodes }); } catch { gp = null; }
    for (const [i, h] of (gp?.hits ?? []).entries()) {
      const t = TECHNIQUE_BY_ID.get(h.technique);
      if (!t || SKIP_FAMILIES.has(t.family) || h.nodes.some(n => n.path.length)) continue;
      try { push(fragmentFromNodes(src, h.nodes.map(n => n.id), { family: t.family, what: t.name, key: `${h.technique}:${i}` })); } catch { /* not a fragment */ }
    }
    for (const n of nodes) {
      if (n.type === 'exprNode' || n.type === 'customFn') {
        try { push(fragmentFromNodes(src, [n.id], { family: 'code', what: String(n.params.label ?? (n.type === 'exprNode' ? 'Expression Block' : 'Custom Function')), key: `node:${n.id}` })); } catch { /* not a fragment */ }
        if (n.type === 'customFn' && typeof n.params.glslFunctions === 'string') out.push(...fragmentsFromCode(src, n.params.glslFunctions, `node:${n.id}`).map(f => ({ ...f, at: [{ id: n.id, path: [] }] })));
      }
    }
  }
  if (cache.size > 2000) cache.clear();
  cache.set(ck, out);
  return out;
}
