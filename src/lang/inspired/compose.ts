/**
 * compose.ts — "Inspired by": the Do bar's Surprise as a new graph made from 2–3 sources (docs/surprise.md).
 *
 *   1. Pick sources: 2–3 graphs or GLSL files from the pool, each bringing a fragment (fragments.ts) for a
 *      stage not yet filled, techniques of one family at most once.
 *   2. The stage plan: space → field → light → colour → post, or space → picture → post.
 *   3. Realise: copy each fragment's nodes (renamed, with a note saying where it came from), wire them
 *      stage to stage (uv → space → field → light → colour → post → Output), conversions where types
 *      differ. A required stage nobody filled takes Playfield's own piece (Circle SDF, Palette).
 *   4. Validate: the real compiler (and the caller's check: a GLSL parse in tests, a GPU compile and the
 *      degenerate frame check in the app); a failure tries the next seed, up to `tries`, then the old
 *      line generator.
 *
 * A pure function of (seed, pool): the same seed and the same sources make the same graph. Recent rolls
 * steer which fresh seed is used (`steerSeed`), never what a seed makes, so a typed seed reproduces.
 */
import type { DataType, GraphNode } from '../../types/nodeGraph';
import { makeRng, deriveSeed, harmoniousPalette, type Rng } from '../../lib/surprise';
import { n } from '../../store/graphBuilder';
import { compileGraph } from '../../compiler/graphCompiler';
import { execCommand } from '../../suggestions/doCommands';
import { surpriseLine } from '../surprise';
import { readLine } from '../run';
import { fragmentsOf, type Fragment, type InspSource, type Stage, type VType } from './fragments';

export interface InspPool {
  sources: InspSource[];
  /** Fragments by source id (sources in id order). */
  bySource: Map<string, Fragment[]>;
  /** stage → family → technique (or function) → fragments, in pool order. */
  byStage: Map<Stage, Map<string, Map<string, Fragment[]>>>;
}

/** The pool: sources in a fixed order, so a seed means the same thing on every run. */
export function makePool(sources: readonly InspSource[]): InspPool {
  const sorted = [...sources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bySource = new Map<string, Fragment[]>();
  for (const s of sorted) {
    const fs = fragmentsOf(s);
    if (fs.length) bySource.set(s.id, fs);
  }
  const byStage: InspPool['byStage'] = new Map();
  for (const fs of bySource.values()) for (const f of fs) {
    const fams = byStage.get(f.stage) ?? new Map<string, Map<string, Fragment[]>>();
    byStage.set(f.stage, fams);
    const whats = fams.get(f.family) ?? new Map<string, Fragment[]>();
    fams.set(f.family, whats);
    // Copied code is grouped by what it is (its in/out), not its label, so a hundred blocks aren't a hundred techniques.
    const w = f.family === 'code' ? `${f.how}:${f.nodes.length > 1 ? 'chain' : f.nodes[0]?.type}` : f.what;
    whats.set(w, [...(whats.get(w) ?? []), f]);
  }
  return { sources: sorted.filter(s => bySource.has(s.id)), bySource, byStage };
}

export interface Inspiration { id: string; label: string; what: string[]; at: Array<{ id: string; path: string[] }>; line?: number }

export interface Composition {
  nodes: GraphNode[];
  seed: number;
  inspirations: Inspiration[];
  /** Per stage: where it came from (a fragment key, or 'playfield'). */
  stages: Array<{ stage: Stage; from: string; family: string; what: string }>;
  /** The technique families used (sources only), sorted. */
  families: string[];
}

export interface InspireResult extends Composition {
  /** True when every try failed and the old line generator made it. */
  fallback: boolean;
  rejected: Array<{ seed: number; why: string }>;
  line?: string;
}

const CHAIN: Stage[] = ['space', 'field', 'light', 'colour', 'post'];
const PICTURE: Stage[] = ['space', 'picture', 'post'];
const REQUIRED = new Set<Stage>(['field', 'colour', 'picture']);

const fmt = (x: number) => Math.round(x * 1000) / 1000;

/** Playfield's own piece for a stage nobody filled. */
function templateFragment(stage: Stage, rng: Rng): Fragment | null {
  const base = { sourceId: 'playfield', sourceLabel: 'Playfield', family: 'code' as const, how: 'nodes' as const, at: [] };
  if (stage === 'field') {
    return { ...base, key: 'playfield#circle', what: 'Circle SDF', stage, inType: 'vec2', outType: 'float',
      nodes: [n('circleSDF', 'c', 0, 0, { radius: fmt(rng.float(0.15, 0.5)) })], entry: [{ nodeId: 'c', key: 'position' }], time: [], exit: { nodeId: 'c', key: 'distance' } };
  }
  if (stage === 'colour') {
    const [a, b] = harmoniousPalette(rng, 2);
    return { ...base, key: 'playfield#palette', what: 'Palette', stage, inType: 'float', outType: 'vec3',
      nodes: [n('palette', 'p', 0, 0, { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [fmt(a[0]), fmt(a[1]), fmt(b[2])], scale: fmt(rng.float(0.6, 3)) })],
      entry: [{ nodeId: 'p', key: 'value' }], time: [{ nodeId: 'p', key: 'anim' }], exit: { nodeId: 'p', key: 'color' } };
  }
  if (stage === 'picture') return null;
  return null;
}

/** A Custom Function converting one type to another (length, luminance, splat). */
function conversion(id: string, from: VType, to: VType): GraphNode {
  const expr: Record<string, string> = {
    'vec2>float': 'length(v)', 'float>vec2': 'vec2(v)', 'vec3>float': 'dot(v, vec3(0.299, 0.587, 0.114))',
    'float>vec3': 'vec3(v)', 'vec2>vec3': 'vec3(v, 0.0)', 'vec3>vec2': 'v.xy',
  };
  return {
    id, type: 'customFn', position: { x: 0, y: 0 },
    inputs: { v: { type: from as DataType, label: 'v' } }, outputs: { result: { type: to as DataType, label: 'Result' } },
    params: { label: `${from} → ${to}`, inputs: [{ name: 'v', type: from, slider: null }], outputType: to, body: expr[`${from}>${to}`] ?? 'v', glslFunctions: '', __comment: `Turns the ${from} coming in into the ${to} the next piece takes.` },
  };
}

interface Plan { stages: Stage[]; assign: Map<Stage, Fragment>; sources: string[] }

/** Steps 1–2: which sources, which fragment for which stage. */
export function planFor(pool: InspPool, seed: number): Plan {
  const rng = makeRng(seed);
  const hasPicture = [...pool.bySource.values()].some(fs => fs.some(f => f.stage === 'picture'));
  const stages = hasPicture && rng.chance(0.3) ? PICTURE : CHAIN;
  const assign = new Map<Stage, Fragment>();
  const chosen: string[] = [];
  const families = new Set<string>();
  const want = rng.int(2, 3);
  // Fill in a random order, so no stage always goes first.
  const order = rng.shuffle([...stages]);
  const open = () => order.filter(s => !assign.has(s));
  // Stage first, then a family (each family as likely as another, one not used yet), then a technique of
  // it, then one graph using it: a technique found in a hundred examples is no likelier than a rare one.
  for (let i = 0; i < want + 3 && chosen.length < want; i++) {
    const stageW = open().filter(s => pool.byStage.get(s)?.size).map(s => [s, REQUIRED.has(s) ? 3 : 1] as const);
    if (!stageW.length) break;
    const st = rng.weighted(stageW);
    const fams = [...pool.byStage.get(st)!.entries()]
      .map(([fam, whats]) => [fam, [...whats.entries()].map(([w, fs]) => [w, fs.filter(f => !chosen.includes(f.sourceId))] as const).filter(([, fs]) => fs.length)] as const)
      .filter(([, whats]) => whats.length);
    if (!fams.length) { order.splice(order.indexOf(st), 1); continue; }
    const [fam, whats] = rng.weighted(fams.map(x => [x, families.has(x[0]) ? 0.05 : 1] as const));
    const [, inst] = rng.pick(whats);
    const f = rng.pick(inst);
    assign.set(st, f);
    chosen.push(f.sourceId);
    families.add(fam);
  }
  // Still open: a chosen source may give a second stage (a second technique of its own).
  for (const st of open()) {
    if (rng.chance(st === 'space' || st === 'post' ? 0.5 : 0.85)) {
      const frags = chosen.flatMap(id => pool.bySource.get(id)!.filter(f => f.stage === st && !(families.has(f.family) && f.family !== 'code')));
      if (frags.length) { const f = rng.pick(frags); assign.set(st, f); families.add(f.family); }
    }
  }
  // A picture nobody brought: Playfield's field and colour stand in for it.
  if (stages === PICTURE && !assign.has('picture')) return { stages: CHAIN, assign, sources: chosen };
  return { stages, assign, sources: chosen };
}

/** Step 3: the graph. `nextId` names the new nodes. */
export function realise(pool: InspPool, seed: number, nextId: () => string): Composition | null {
  const plan = planFor(pool, seed);
  const rng = makeRng(seed).fork('realise');
  const out: GraphNode[] = [];
  const uv = n('uv', nextId(), 0, 0);
  const time = n('time', nextId(), 0, 260);
  uv.params.__comment = 'Where each pixel is: the coordinates the first piece reads.';
  time.params.__comment = 'Seconds since start, for the pieces that move.';
  out.push(uv, time);
  let cur = { nodeId: uv.id, key: 'uv', type: 'vec2' as VType };
  let x = 380;
  const stagesUsed: Composition['stages'] = [];
  let lightOut: { nodeId: string; key: string } | null = null;
  let fieldOut: typeof cur | null = null;
  const insp = new Map<string, Inspiration>();
  for (const st of plan.stages) {
    let f = plan.assign.get(st) ?? null;
    if (!f && REQUIRED.has(st)) f = templateFragment(st, rng);
    if (!f) continue;
    const ids = new Map<string, string>();
    for (const nd of f.nodes) ids.set(nd.id, nextId());
    const minX = Math.min(...f.nodes.map(nd => nd.position?.x ?? 0)), minY = Math.min(...f.nodes.map(nd => nd.position?.y ?? 0));
    const maxX = Math.max(...f.nodes.map(nd => nd.position?.x ?? 0));
    // The colour stage reads the field or the light (then it's lit by the light below).
    let into = cur;
    if (st === 'colour' && lightOut && fieldOut && rng.chance(0.5)) into = fieldOut;
    if (into.type !== f.inType) {
      const c = conversion(nextId(), into.type, f.inType);
      c.position = { x: x - 200, y: 120 };
      c.inputs.v.connection = { nodeId: into.nodeId, outputKey: into.key };
      out.push(c);
      into = { nodeId: c.id, key: 'result', type: f.inType };
    }
    const from = f.sourceId === 'playfield' ? 'Playfield default' : `Inspired by “${f.sourceLabel}”`;
    for (const tmpl of f.nodes) {
      const nd = JSON.parse(JSON.stringify(tmpl)) as GraphNode;
      nd.id = ids.get(tmpl.id)!;
      nd.position = { x: x + ((tmpl.position?.x ?? 0) - minX), y: (tmpl.position?.y ?? 0) - minY };
      for (const s of Object.values(nd.inputs ?? {})) if (s.connection) {
        const to = ids.get(s.connection.nodeId);
        if (to) s.connection = { nodeId: to, outputKey: s.connection.outputKey }; else delete s.connection;
      }
      for (const p of f.entry) if (p.nodeId === tmpl.id && nd.inputs[p.key]) nd.inputs[p.key].connection = { nodeId: into.nodeId, outputKey: into.key };
      for (const p of f.time) if (p.nodeId === tmpl.id && nd.inputs[p.key]) nd.inputs[p.key].connection = { nodeId: time.id, outputKey: 'time' };
      const old = typeof nd.params.__comment === 'string' && nd.params.__comment.trim() ? ` ${nd.params.__comment.trim()}` : '';
      nd.params = { ...nd.params, __comment: `${from}: ${f.what} (the ${st} stage).${old}` };
      out.push(nd);
    }
    x += (maxX - minX) + 420;
    cur = { nodeId: ids.get(f.exit.nodeId)!, key: f.exit.key, type: f.outType };
    if (st === 'field') fieldOut = cur;
    if (st === 'light') lightOut = cur;
    if (st === 'colour' && lightOut) {
      // Lit: the colour times the light.
      const m: GraphNode = {
        id: nextId(), type: 'customFn', position: { x: x - 120, y: 0 },
        inputs: { col: { type: 'vec3', label: 'col', connection: { nodeId: cur.nodeId, outputKey: cur.key } }, glow: { type: 'float', label: 'glow', connection: { nodeId: lightOut.nodeId, outputKey: lightOut.key } } },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { label: 'Colour × light', inputs: [{ name: 'col', type: 'vec3', slider: null }, { name: 'glow', type: 'float', slider: null }], outputType: 'vec3', body: 'col * glow', glslFunctions: '', __comment: 'The colour, lit by the light stage: bright where the light is, dark away from it.' },
      };
      out.push(m);
      x += 300;
      cur = { nodeId: m.id, key: 'result', type: 'vec3' };
    }
    stagesUsed.push({ stage: st, from: f.key, family: f.sourceId === 'playfield' ? 'playfield' : f.family, what: f.what });
    if (f.sourceId !== 'playfield') {
      const e = insp.get(f.sourceId) ?? { id: f.sourceId, label: f.sourceLabel, what: [], at: [], ...(f.line ? { line: f.line } : {}) };
      e.what.push(f.what);
      e.at.push(...f.at);
      insp.set(f.sourceId, e);
    }
  }
  if (cur.type !== 'vec3') {
    const c = conversion(nextId(), cur.type, 'vec3');
    c.position = { x, y: 0 };
    c.inputs.v.connection = { nodeId: cur.nodeId, outputKey: cur.key };
    out.push(c);
    x += 300;
    cur = { nodeId: c.id, key: 'result', type: 'vec3' };
  }
  if (!insp.size) return null;
  const o = n('output', nextId(), x, 0);
  o.inputs.color.connection = { nodeId: cur.nodeId, outputKey: cur.key };
  const names = [...insp.values()].map(i => `“${i.label}”`);
  o.params.__comment = `A surprise inspired by ${names.join(', ')} (seed ${seed}). Each node's note says where it came from.`;
  out.push(o);
  return {
    nodes: out, seed, inspirations: [...insp.values()], stages: stagesUsed,
    families: [...new Set(stagesUsed.filter(s => s.family !== 'playfield').map(s => s.family))].sort(),
  };
}

/** Why the graph doesn't compile, or null. */
export function compileProblem(nodes: GraphNode[]): string | null {
  try {
    const r = compileGraph({ nodes });
    return r.success && !r.errors?.length ? null : (r.errors ?? ['did not compile']).join('; ');
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** The old generator: a random line of the language, run on a clean graph. */
export function lineGraph(seed: number, nextId: () => string): { nodes: GraphNode[]; line: string } | null {
  const { line } = surpriseLine({ seed });
  const r = readLine(line, { seed });
  const sentence = r.picture?.sentence;
  if (!sentence) return null;
  const p = execCommand(sentence, [n('output', nextId(), 1260, 0)], { selected: [], nextId });
  return p.ok ? { nodes: p.nodes, line } : null;
}

export interface InspireOptions {
  pool: InspPool;
  seed: number;
  /** How many seeds to try before the old generator (default 6). */
  tries?: number;
  /** Why a graph isn't worth showing (a GLSL parse, a GPU compile, a blank frame), or null. */
  check?: (nodes: GraphNode[]) => string | null;
  nextId?: () => string;
  /** The seed for try `attempt` (default: derived from `seed`). The app steers each retry too. */
  seedFor?: (attempt: number) => number;
}

function counter(seed: number): () => string {
  let k = 0;
  return () => `insp${seed}_${++k}`;
}

/** Steps 1–4: the surprise for `seed`, retried on later seeds, then the old generator. */
export function inspire(o: InspireOptions): InspireResult {
  const tries = o.tries ?? 6;
  const rejected: InspireResult['rejected'] = [];
  for (let a = 0; a < tries; a++) {
    const s = a === 0 ? o.seed : o.seedFor ? o.seedFor(a) : deriveSeed(o.seed, a);
    const next = o.nextId ?? counter(s);
    let made: Composition | null = null;
    try { made = realise(o.pool, s, next); } catch (e) { rejected.push({ seed: s, why: e instanceof Error ? e.message : String(e) }); continue; }
    if (!made) { rejected.push({ seed: s, why: 'no sources' }); continue; }
    const why = compileProblem(made.nodes) ?? o.check?.(made.nodes) ?? null;
    if (why) { rejected.push({ seed: s, why }); continue; }
    return { ...made, fallback: false, rejected };
  }
  const old = lineGraph(o.seed, o.nextId ?? counter(o.seed));
  return { nodes: old?.nodes ?? [n('output', 'out', 0, 0)], seed: o.seed, inspirations: [], stages: [], families: [], fallback: true, rejected, line: old?.line };
}

// ── History steering ─────────────────────────────────────────────────────────

export interface RollMemory { sources: string[]; families: string[] }

/** How much a seed's plan repeats the last rolls: shared sources count double, shared families once. */
export function repetition(pool: InspPool, seed: number, history: readonly RollMemory[]): number {
  const plan = planFor(pool, seed);
  const srcs = new Set(history.flatMap(h => h.sources));
  const fams = new Map<string, number>();
  for (const h of history) for (const f of h.families) fams.set(f, (fams.get(f) ?? 0) + 1);
  let score = 0;
  for (const s of plan.sources) if (srcs.has(s)) score += 2;
  for (const f of new Set([...plan.assign.values()].map(x => x.family))) if (f !== 'code') score += fams.get(f) ?? 0;
  return score;
}

/** Of a few fresh seeds, the one whose plan repeats the last ~5 rolls least (the first on a tie). */
export function steerSeed(pool: InspPool, candidates: readonly number[], history: readonly RollMemory[]): number {
  if (!history.length) return candidates[0];
  let best = candidates[0], bestScore = Infinity;
  for (const c of candidates) {
    const sc = repetition(pool, c, history);
    if (sc < bestScore) { best = c; bestScore = sc; }
  }
  return best;
}

/** The history kept: the last five rolls. */
export const HISTORY_LENGTH = 5;
export function remember(history: readonly RollMemory[], r: Composition): RollMemory[] {
  return [...history, { sources: r.inspirations.map(i => i.id), families: r.families }].slice(-HISTORY_LENGTH);
}
