/**
 * fromGraph.ts — any graph as Do… bar lines: the commands that would build it, one per line,
 * in the Playfield language's canonical form (docs/playfield-language.md). Builder-made nodes
 * print as their builder's recipe (a 3D scene, Grid Rules, Agent Rules); everything else as
 * `create` / `set` / `rename` / `connect` / `disconnect` / `delete` / `group(…)`.
 *
 * The printer checks itself as it goes: it runs every line through the bar's own readers and
 * executors (lang/run.ts readLine, suggestions/doCommands.ts execCommand) on a working copy, the
 * way the Do… bar runs a line, and keeps a line only when it did what was meant. So references
 * are the ones that resolve on the graph as it will be (`circle#2`, `"Halo"`), the auto-added UV
 * of `create` is adopted or deleted, and a setting the bar can't reach is caught.
 *
 * What can't be said becomes a comment, `# cannot express: <what> (<why>)`, and a Gap with a
 * category, so the pressure test can count them (docs/reports/language-pressure-test.md).
 * Pure: no store.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition, getNodeDefinitionFor } from '../nodes/definitions';
import { execCommand } from '../suggestions/doCommands';
import { runDoPlan } from '../suggestions/doBar';
import { lex as sugarLex, namesOf, readRef } from '../suggestions/doRefs';
import { readLine, readsCanonically, gridPlan, sceneNodes, agentsNodes } from './run';
import { sugarRef } from './dialects/picture';
import { printRef, fmtNum } from './print';
import type { Ref } from './ast';
import { builderRecipeOf } from '../builders/recipe';
import { groupRules } from '../agentRules/apply';
import { printAgents } from './dialects/agents';
import { flattenGraph, isPlainGroup, levelDigest, digestOverlap, subgraphOf, pairInside, type FlatGraph } from './graphFlat';

// ── Results ─────────────────────────────────────────────────────────────────

export type GapCategory =
  | 'no-create-word' | 'create-failed'
  | 'param-name' | 'param-vector' | 'param-structured' | 'param-code' | 'param-string' | 'param-media' | 'param-keyframes' | 'param-inline-expr' | 'param-colour-range' | 'param-set-failed'
  | 'output-socket' | 'sugar-output-socket' | 'input-socket' | 'wire-type' | 'wire-failed' | 'wire-missing-node'
  | 'runner-crash' | 'dialect-clash' | 'reserved-word' | 'socket-default'
  | 'ref-ambiguous'
  | 'group-ports' | 'group-settings' | 'group-loop-index' | 'container-contents' | 'container-socket'
  | 'builder-recipe'
  | 'play' | 'media' | 'notes' | 'layout' | 'extra-node' | 'other';

export interface Gap {
  category: GapCategory;
  detail: string;
  nodeType?: string;
  /** The original node it is about. */
  node?: string;
  /** The setting it is about. */
  param?: string;
  /** The node at the wire's other end. */
  other?: string;
  /** The gap this one follows from (a wire whose node isn't made, a socket a setting would make). */
  cause?: GapCategory;
}

/** What a runner error says about the language: a crash, a line read as another dialect, or nothing special. */
export function errorCategory(error: string | undefined, fallback: GapCategory): GapCategory {
  if (!error) return fallback;
  if (/^the runner threw/.test(error)) return 'runner-crash';
  if (/mixes a 3D scene|isn't a shape, combine, warp or setting|isn't a 3D|scene/.test(error)) return 'dialect-clash';
  return fallback;
}

export type LineForm = 'canonical' | 'sugar' | 'recipe' | 'comment';

export interface PrintedLine {
  text: string;
  form: LineForm;
  section: 'recipe' | 'build' | 'wire' | 'cleanup' | 'group' | 'gap';
  /** Original nodes this line makes, with their types (in the order the run adds them). */
  makes?: Array<{ orig: string; type: string }>;
  gap?: Gap;
}

export interface PrintStats {
  nodes: number; nodesMade: number;
  wires: number; wiresMade: number;
  params: number; paramsSet: number;
  groups: number; groupsMade: number;
}

export interface PrintResult {
  lines: PrintedLine[];
  /** The script: one line each, comments included. */
  script: string;
  gaps: Gap[];
  stats: PrintStats;
  /** Original id → id in the printer's own run (for tests). */
  map: Record<string, string>;
}

export interface PrintExtras {
  play?: unknown;
  datasets?: unknown;
  images?: Record<string, string>;
}

// ── Running a line (as the Do… bar does) ───────────────────────────────────

export interface Sim { nodes: GraphNode[]; selected: string[]; k: number }

export interface SimRun { ok: boolean; error?: string; sim: Sim; added: GraphNode[] }

const SIM_PREFIX = 'p';

/** A stand-in for the store's groupNodes (the bar's `group(…)` runs that after the command). */
function standInGroup(nodes: GraphNode[], ids: string[], label: string | undefined, id: string): GraphNode[] {
  const set = new Set(ids);
  const members = nodes.filter(nd => set.has(nd.id));
  const def = getNodeDefinition('group');
  const g: GraphNode = {
    id, type: 'group', position: { x: Math.min(...members.map(m => m.position.x)), y: Math.min(...members.map(m => m.position.y)) },
    inputs: {}, outputs: {}, params: { ...(def?.defaultParams ?? {}), label: label ?? 'Group', subgraph: { nodes: members, inputPorts: [], outputPorts: [] } },
  };
  return [...nodes.filter(nd => !set.has(nd.id)), g];
}

/**
 * Run one Do… bar line on a level, as the bar does (components/NodeGraph/DoBar.tsx `run`): a
 * line in another dialect (a 3D scene, Grid Rules, Agent Rules) runs its builder; a picture or
 * edit line runs its canonical sentence, else the text as plain English, through execCommand.
 */
export function simRun(sim: Sim, text: string): SimRun {
  let k = sim.k;
  const nextId = () => `${SIM_PREFIX}${++k}`;
  const fail = (error: string): SimRun => ({ ok: false, error, sim, added: [] });
  try {
    const r = readLine(text, { seed: 1 });
    const canon = readsCanonically(r);
    let nodes = sim.nodes, selected = sim.selected;
    if (canon && r.dialect !== 'picture') {
      if (r.dialect === 'grid') {
        const res = runDoPlan(nodes, gridPlan(r.grid!, selected[0]), nextId, { topLevel: true });
        if (!res.ran.length) return fail('Grid Rules: nothing ran');
        nodes = res.nodes;
        if (res.select) selected = [res.select];
      } else if (r.dialect === 'scene') nodes = sceneNodes(nodes, r.scene!, nextId).nodes;
      else nodes = agentsNodes(nodes, r.agents!, nextId).nodes;
    } else {
      if (r.dialect !== 'picture') return fail(r.errors[0]?.message ?? 'does not read');
      const sentence = canon ? r.picture!.sentence! : text;
      const p = execCommand(sentence, nodes, { selected, nextId, topLevel: true });
      if (p.intent) return fail('reads as a question, not a command');
      if (!p.ok) return fail(p.clauses.find(c => c.status !== 'ok')?.message ?? (r.picture?.why ?? 'nothing changed'));
      nodes = p.nodes;
      if (p.group) nodes = standInGroup(nodes, p.group.ids, p.group.label, nextId());
      else if (p.select.length) selected = p.select;
    }
    const was = new Set(sim.nodes.map(nd => nd.id));
    return { ok: true, sim: { nodes, selected, k }, added: nodes.filter(nd => !was.has(nd.id)) };
  } catch (e) {
    return fail(`the runner threw: ${(e as Error).message}`);
  }
}

/** The empty graph a script starts on: just an Output (the Commands reference's "empty"). */
export const emptySim = (): Sim => ({ nodes: [emptyOutput()], selected: [], k: 0 });
export function emptyOutput(): GraphNode {
  const def = getNodeDefinition('output')!;
  return {
    id: 'out', type: 'output', position: { x: 1260, y: 0 }, params: { ...(def.defaultParams ?? {}) },
    inputs: Object.fromEntries(Object.entries(def.inputs ?? {}).map(([k, v]) => [k, { type: v.type, label: v.label }])),
    outputs: Object.fromEntries(Object.entries(def.outputs ?? {}).map(([k, v]) => [k, { type: v.type, label: v.label }])),
  };
}

// ── Values ──────────────────────────────────────────────────────────────────

const numLike = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Equal within the printer's rounding (four decimals) and 8-bit colours. */
export function sameValue(a: unknown, b: unknown, tol = 2.5e-3): boolean {
  if (a === b) return true;
  const na = numLike(a), nb = numLike(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) <= tol * Math.max(1, Math.abs(na));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i], tol));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).filter(k => k !== '__comment'), kb = Object.keys(b as object).filter(k => k !== '__comment');
    return ka.length === kb.length && ka.every(k => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol));
  }
  return false;
}

/** Settings the printer never compares: notes, the label (renamed), insides, bookkeeping. */
export const PARAM_SKIP = new Set(['__comment', 'label', 'subgraph', '_groupOriginal', '_schemaVersion', '_sbBuild', '_sbRole', '_sbName', 'sceneBuilder', '__foldedFrom', '__foldedLabel', 'surfacedParams']);
const MEDIA_KEYS = /^(_fileName|_hasFile|_imageAspect|_isPlaying|_loop|_speed|_bands|_soloedBand|_ccs)$|image|video|audio|file|dataset|media|url|src$/i;
const CODE_KEYS = /^(code|glsl|expr|result|lines|body|source|fn|func|script)$/i;
const CODE_TYPES = new Set(['exprNode', 'customFunction', 'customNode', 'glslNode']);

/** Why a setting can't be written as a Do… bar value, or null when it can (and how). */
function valueText(nd: GraphNode, key: string, v: unknown): { text: string; alt?: string } | { gap: GapCategory; why: string } {
  const pd = getNodeDefinitionFor(nd)?.paramDefs?.[key];
  if (key.startsWith('__keyframes_')) return { gap: 'param-keyframes', why: 'keyframe tracks have no words' };
  if (key.startsWith('__inExpr_') || key.startsWith('__inKnobs_')) return { gap: 'param-inline-expr', why: 'an input expression on a setting has no words' };
  if (MEDIA_KEYS.test(key)) return { gap: 'param-media', why: 'media (a file, an image, audio state) has no words' };
  if (CODE_TYPES.has(nd.type) && (CODE_KEYS.test(key) || key === 'inputs' || key === 'outputType')) {
    if (typeof v === 'string' && /^[^"\n]*$/.test(v) && v.length < 120 && !(Array.isArray(v))) return { text: `"${v}"` };
    return { gap: 'param-code', why: 'code (an Expression or custom GLSL) has no words' };
  }
  if (typeof v === 'number') return Number.isFinite(v) ? { text: fmtNum(v) } : { gap: 'param-set-failed', why: 'not a finite number' };
  if (typeof v === 'boolean') return { text: v ? 'on' : 'off' };
  if (typeof v === 'string') {
    if (CODE_KEYS.test(key)) return /^[^"\n]*$/.test(v) ? { text: `"${v}"` } : { gap: 'param-code', why: 'code over several lines (or with quotes) has no words' };
    if (/\n/.test(v) || v.includes('"')) return { gap: 'param-string', why: 'text over several lines (or with quotes) has no words' };
    if (numLike(v) !== null) return { text: fmtNum(Number(v)) };
    if (pd?.type === 'select' && /^[A-Za-z][A-Za-z0-9_]*$/.test(v)) return { text: v, alt: `"${v}"` };
    return { text: `"${v}"` };
  }
  if (Array.isArray(v)) {
    if (v.length === 3 && v.every(x => typeof x === 'number')) {
      if (v.some(x => x < 0 || x > 1)) return { gap: 'param-colour-range', why: 'a vec3 outside 0–1 (a colour is written in 0–1; vectors have no `set` form)' };
      return { text: `(${v.map(x => fmtNum(x as number)).join(',')})` };
    }
    if (v.every(x => typeof x === 'number')) return { gap: 'param-vector', why: `a ${v.length}-number vector has no \`set\` form` };
    return { gap: 'param-structured', why: 'a list (stops, points, curve, inputs) has no words' };
  }
  if (v && typeof v === 'object') return { gap: 'param-structured', why: 'a structured value (curve, gradient, table) has no words' };
  return { gap: 'param-set-failed', why: `a ${typeof v} value` };
}

// ── Names ───────────────────────────────────────────────────────────────────

const lowerLabel = (s: string) => s.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
const slug = (s: string) => s.replace(/ /g, '-');
const WORDY = /^[a-z][a-z0-9 ]*$/;

/** Does the canonical reference `r` name exactly `id` on this level (with and without the selection)? */
function resolves(sim: Sim, r: Ref, id: string): boolean {
  const toks = sugarLex(sugarRef(r));
  for (const selected of [sim.selected, []]) {
    const got = readRef(toks, 0, { nodes: sim.nodes, selected, subject: null });
    if (!got.ok || got.ids.length !== 1 || got.ids[0] !== id || got.used !== toks.length) return false;
  }
  return true;
}

/** The shortest reference that names `id` and nothing else: its own label, a type word, or word#n. */
function refFor(sim: Sim, id: string, opts: { socket?: string } = {}): Ref | null {
  const nd = sim.nodes.find(x => x.id === id);
  if (!nd) return null;
  if (!opts.socket && typeof nd.params.label === 'string' && nd.params.label.trim() && !nd.params.label.includes('"')) {
    const r: Ref = { r: 'label', label: nd.params.label };
    if (resolves(sim, r, id)) return r;
  }
  // Names that don't hang on its settings (a Shape SDF answers to “heart” only while it is one).
  const names = [...namesOf({ ...nd, params: {} })].filter(nm => WORDY.test(nm) && !/^\d/.test(nm.split(' ').pop()!)).sort((a, b) => a.length - b.length || a.localeCompare(b));
  for (const nm of names) {
    const r: Ref = { r: 'type', word: slug(nm), ...(opts.socket ? { socket: opts.socket } : {}) };
    if (resolves(sim, { r: 'type', word: slug(nm) }, id)) return r;
  }
  for (const nm of names) {
    const hits = sim.nodes.filter(x => namesOf(x).has(nm)).length;
    if (hits > 12) continue;
    for (let ord = 1; ord <= hits; ord++) {
      if (resolves(sim, { r: 'type', word: slug(nm), ord }, id)) return { r: 'type', word: slug(nm), ord, ...(opts.socket ? { socket: opts.socket } : {}) };
    }
  }
  return null;
}

const refText = (r: Ref) => printRef(r);

/** A create word per node type that makes that type (and at most a UV): cached, found by trying. */
const CREATE_WORDS = new Map<string, string | null>();
/** Why no word made the type: what each word made instead. */
export const CREATE_WHY = new Map<string, string>();
export function createWordFor(type: string): string | null {
  if (CREATE_WORDS.has(type)) return CREATE_WORDS.get(type)!;
  const def = getNodeDefinition(type);
  let found: string | null = null;
  if (def && !def.deprecated) {
    const cands = [def.label.replace(/\s*\(.*\)\s*/, ''), def.label, ...(def.aliases ?? []), type].map(lowerLabel).filter(w => WORDY.test(w));
    const why: string[] = [];
    for (const w of [...new Set(cands)]) {
      const r = simRun(emptySim(), `create ${slug(w)}`);
      if (!r.ok) { why.push(`“${slug(w)}”: ${r.error}`); continue; }
      why.push(`“${slug(w)}” makes ${r.added.filter(a => a.type !== 'uv').map(a => getNodeDefinition(a.type)?.label ?? a.type).join(' + ') || 'nothing'}`);
      const mine = r.added.filter(nd => nd.type === type);
      if (mine.length === 1 && r.added.every(nd => nd.type === type || nd.type === 'uv')) { found = slug(w); break; }
    }
    if (!found) CREATE_WHY.set(type, why.join('; '));
  } else CREATE_WHY.set(type, def ? 'deprecated: not offered' : 'unknown type');
  CREATE_WORDS.set(type, found);
  return found;
}

/** The input words a `connect …→ node.<socket>` can use for input `key`. */
function socketWords(nd: GraphNode, key: string): string[] {
  const label = nd.inputs[key]?.label ? lowerLabel(nd.inputs[key].label) : '';
  return [...new Set([key.toLowerCase(), slug(label)].filter(w => /^[a-z][a-z0-9_-]*$/.test(w)))];
}

// ── The printer ─────────────────────────────────────────────────────────────

const isOutputType = (t: string) => t === 'output';

/** Topological order (sources first; ties keep the graph's order); a loop is broken where found. */
function topoOrder(flat: FlatGraph): GraphNode[] {
  const byId = new Map(flat.nodes.map(nd => [nd.id, nd]));
  const deps = new Map<string, string[]>();
  for (const w of flat.wires) if (byId.has(w.from)) deps.set(w.to, [...(deps.get(w.to) ?? []), w.from]);
  const out: GraphNode[] = [];
  const state = new Map<string, number>();
  const visit = (id: string) => {
    if (state.get(id) === 2 || state.get(id) === 1) return;
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) visit(d);
    state.set(id, 2);
    out.push(byId.get(id)!);
  };
  for (const nd of flat.nodes) visit(nd.id);
  return out;
}

export function graphToScript(original: GraphNode[], extras: PrintExtras = {}): PrintResult {
  let sim = emptySim();
  const lines: PrintedLine[] = [];
  const gaps: Gap[] = [];
  const map = new Map<string, string>();
  const stats: PrintStats = { nodes: 0, nodesMade: 0, wires: 0, wiresMade: 0, params: 0, paramsSet: 0, groups: 0, groupsMade: 0 };
  const flat = flattenGraph(original);
  const byOrig = new Map(flat.nodes.map(nd => [nd.id, nd]));
  const gap = (g: Gap, opts: { line?: boolean } = {}) => {
    gaps.push(g);
    if (opts.line !== false) lines.push({ text: `# cannot express: ${g.detail}`, form: 'comment', section: 'gap', gap: g });
  };
  const simNode = (simId: string) => sim.nodes.find(x => x.id === simId);
  const allSim = (): GraphNode[] => { const walk = (ns: GraphNode[]): GraphNode[] => ns.flatMap(nd => [nd, ...(subgraphOf(nd) ? walk(subgraphOf(nd)!.nodes) : [])]); return walk(sim.nodes); };
  /** Run a line and keep it when `check` says it did what was meant. */
  const attempt = (text: string, form: LineForm, section: PrintedLine['section'], check?: (r: SimRun) => boolean, makes?: PrintedLine['makes']): SimRun => {
    const r = simRun(sim, text);
    if (r.ok && (!check || check(r))) {
      sim = r.sim;
      lines.push({ text, form, section, ...(makes ? { makes } : {}) });
    }
    return r;
  };
  const describe = (nd: GraphNode) => `${getNodeDefinition(nd.type)?.label ?? nd.type}${typeof nd.params.label === 'string' ? ` “${nd.params.label}”` : ''}`;

  // Counting: every node, inside containers too.
  const countAll = (ns: GraphNode[]): number => ns.reduce((k, nd) => k + (isPlainGroup(nd) ? countAll(subgraphOf(nd)!.nodes) : 1 + (subgraphOf(nd) ? countAll(subgraphOf(nd)!.nodes) : 0)), 0);
  stats.nodes = countAll(original);
  stats.wires = flat.wires.length;
  stats.groups = flat.groups.length;

  // The Output: the script's empty graph has one.
  const outputs = flat.nodes.filter(nd => isOutputType(nd.type));
  if (outputs[0]) { map.set(outputs[0].id, 'out'); stats.nodesMade++; }

  // Plain groups' auto Loop Index: `group(…)` adds one, so the original's is not made by hand.
  const groupLoopIndex = new Set<string>();
  for (const g of flat.groups) for (const m of g.members) if (byOrig.get(m)?.type === 'loopIndex') groupLoopIndex.add(m);

  // ── 1. Builder recipes ──
  for (const nd of flat.nodes) {
    const rec = builderRecipeOf(nd, original);
    if (!rec) continue;
    const text = rec.kind === 'scene' ? rec.text : rec.kind === 'grid' ? rec.text : printAgents(groupRules(nd));
    const r = simRun(sim, text);
    if (!r.ok) { gap({ category: 'builder-recipe', detail: `${describe(nd)} from its recipe (${r.error})`, nodeType: nd.type, node: nd.id }); continue; }
    // Pair what the builder made with the original's unmapped nodes: the same node first, then by type
    // (plain groups it made, and their members, too).
    const pairs = pairInside(original.filter(o => !map.has(o.id) && !isOutputType(o.type)), r.added);
    const flatIds = new Set([...flat.nodes.map(x => x.id), ...flat.groups.map(g => g.id)]);
    const makes: Array<{ orig: string; type: string }> = [];
    for (const [o, s2] of pairs) {
      if (!flatIds.has(o)) continue;
      map.set(o, s2);
      makes.push({ orig: o, type: byOrig.get(o)?.type ?? 'group' });
      if (!byOrig.has(o)) stats.groupsMade++;
    }
    sim = r.sim;
    lines.push({ text, form: 'recipe', section: 'recipe', makes });
  }

  // ── 2. Nodes: create, set, rename ──
  const pendingDelete: Array<{ simId: string; before: string }> = [];
  const extras_: string[] = [];
  const order = topoOrder(flat).filter(nd => !map.has(nd.id) && !groupLoopIndex.has(nd.id));
  // UVs are made by the `create` of what reads them where possible.
  const lateUv = new Set(order.filter(nd => nd.type === 'uv' && flat.wires.some(w => w.from === nd.id)).map(nd => nd.id));
  const setParams = (o: GraphNode) => {
    const simId = map.get(o.id)!;
    const cur = () => simNode(simId)!;
    const def = getNodeDefinitionFor(o);
    const keys = [...new Set([...Object.keys(o.params ?? {}), ...Object.keys(cur().params)])].filter(k => !PARAM_SKIP.has(k));
    const want = (k: string) => (k in o.params ? o.params[k] : def?.defaultParams?.[k]);
    const diffs = keys.filter(k => want(k) !== undefined && !sameValue(want(k), cur().params[k]));
    const ok: string[] = [];
    // The line is written with the reference as it stands before any of its settings change.
    const lineRef = refFor(sim, simId);
    for (const k of diffs) {
      stats.params++;
      const v = valueText(o, k, want(k));
      if ('gap' in v) { gap({ category: v.gap, detail: `${describe(o)} · ${k} (${v.why})`, nodeType: o.type, node: o.id, param: k }); continue; }
      if (!lineRef) { gap({ category: 'ref-ambiguous', detail: `${describe(o)} · ${k} (no reference names this node alone)`, nodeType: o.type, node: o.id, param: k }); continue; }
      const label = def?.paramDefs?.[k]?.label;
      const keyWords = [k, ...(label && WORDY.test(lowerLabel(label)) ? [slug(lowerLabel(label))] : [])];
      const values = [v.text, ...(v.alt ? [v.alt] : [])];
      let done = false, why = '', usedAlt = false;
      for (const kw of [...new Set(keyWords)]) {
        for (const vt of values) {
          const r = simRun(sim, `set ${refText(lineRef)} ${[...ok, `${kw}=${vt}`].join(' ')}`);
          if (r.ok && sameValue(r.sim.nodes.find(x => x.id === simId)!.params[k], want(k))) { ok.push(`${kw}=${vt}`); done = true; usedAlt = vt !== v.text; break; }
          why = r.ok ? `set ran but ${k} became ${JSON.stringify(r.sim.nodes.find(x => x.id === simId)!.params[k])}` : r.error ?? '';
        }
        if (done) break;
      }
      if (done) {
        stats.paramsSet++;
        if (usedAlt) gaps.push({ category: 'reserved-word', detail: `${describe(o)} · ${k}=${v.text} (the bare word reads as something else: written quoted)`, nodeType: o.type, node: o.id, param: k });
        continue;
      }
      const code = CODE_TYPES.has(o.type) && (CODE_KEYS.test(k) || k === 'inputs');
      const cat: GapCategory = code ? 'param-code' : errorCategory(why, /no setting|isn’t a setting|has no/.test(why) ? 'param-name' : 'param-set-failed');
      gap({ category: cat, detail: `${describe(o)} · ${k}=${v.text} (${why})`, nodeType: o.type, node: o.id, param: k });
    }
    if (ok.length && lineRef) {
      const r = simRun(sim, `set ${refText(lineRef)} ${ok.join(' ')}`);
      if (r.ok) { sim = r.sim; lines.push({ text: `set ${refText(lineRef)} ${ok.join(' ')}`, form: 'canonical', section: 'build' }); }
    }
    // A value kept on an unwired input socket (its default): no words reach it.
    for (const [k, inp] of Object.entries(o.inputs ?? {})) {
      const mine = cur().inputs[k] as { defaultValue?: unknown } | undefined;
      const theirs = (inp as { defaultValue?: unknown }).defaultValue;
      if (theirs !== undefined && !inp.connection && !sameValue(theirs, mine?.defaultValue)) gap({ category: 'socket-default', detail: `${describe(o)} · input ${k} keeps ${JSON.stringify(theirs)} (an unwired input's own value has no words)`, nodeType: o.type, node: o.id, param: k });
    }
    const label = typeof o.params.label === 'string' ? o.params.label : null;
    if (label !== null && cur().params.label !== label && !isPlainGroup(o)) {
      const ref = refFor(sim, simId);
      const text = `rename ${ref ? refText(ref) : '?'} "${label.replace(/"/g, '\'')}"`;
      const r = ref ? attempt(text, 'canonical', 'build', x => x.sim.nodes.find(y => y.id === simId)?.params.label === label) : null;
      if (!r || !r.ok) gap({ category: 'param-set-failed', detail: `${describe(o)} · its name (${r?.error ?? 'no reference'})`, nodeType: o.type, node: o.id });
    }
  };

  const make = (o: GraphNode) => {
    const word = createWordFor(o.type);
    if (!word) { gap({ category: 'no-create-word', detail: `${describe(o)} (no create word makes a ${o.type}: ${CREATE_WHY.get(o.type) ?? '?'})`, nodeType: o.type, node: o.id }); return; }
    const r = simRun(sim, `create ${word}`);
    const mine = r.ok ? r.added.filter(a => a.type === o.type) : [];
    if (!r.ok || mine.length !== 1) { gap({ category: errorCategory(r.error, 'create-failed'), detail: `${describe(o)} (create ${word}: ${r.error ?? 'made something else'})`, nodeType: o.type, node: o.id }); return; }
    sim = r.sim;
    const made = mine[0];
    const makes = [{ orig: o.id, type: o.type }];
    map.set(o.id, made.id);
    // The UV `create` adds: the original's own UV for that input, else it goes.
    for (const uv of r.added.filter(a => a.type === 'uv' && a.id !== made.id)) {
      const into = Object.entries(made.inputs).find(([, i]) => i.connection?.nodeId === uv.id)?.[0];
      const w = into ? flat.wires.find(x => x.to === o.id && x.in === into) : undefined;
      const src = w ? byOrig.get(w.from) : undefined;
      if (src && src.type === 'uv' && !map.has(src.id) && lateUv.has(src.id)) {
        map.set(src.id, uv.id);
        makes.push({ orig: src.id, type: 'uv' });
        continue;
      }
      pendingDelete.push({ simId: uv.id, before: made.id });
    }
    lines.push({ text: `create ${word}`, form: 'canonical', section: 'build', makes });
    // A UV that must go: right away, while "before" the new node is that UV and nothing else.
    for (const d of pendingDelete.splice(0)) {
      const ref = refFor(sim, d.before);
      const rr = ref ? attempt(`delete before ${refText(ref)}`, 'canonical', 'build', x => !x.sim.nodes.some(y => y.id === d.simId)) : null;
      if (!rr?.ok) extras_.push(d.simId);
    }
    stats.nodesMade++;
    for (const m of makes.slice(1)) { void m; stats.nodesMade++; }
    setParams(o);
    for (const m of makes.slice(1)) setParams(byOrig.get(m.orig)!);
    // A container: the bar makes it with its default insides and can't open it.
    const sg = subgraphOf(o);
    if (sg) {
      const madeSg = subgraphOf(simNode(made.id)!);
      const a = levelDigest(sg.nodes), b = madeSg ? levelDigest(madeSg.nodes) : [];
      const same = digestOverlap(a, b);
      stats.nodesMade += same;
      if (same < a.length || b.length !== a.length) gap({ category: 'container-contents', detail: `${describe(o)}: ${a.length - same} of ${a.length} inner nodes differ from a new one's (the bar can't edit inside a ${getNodeDefinition(o.type)?.label ?? o.type})`, nodeType: o.type, node: o.id });
    }
  };
  // Builder-made nodes: settings (the recipe made them; hand edits since show here).
  for (const [orig] of [...map]) {
    const o = byOrig.get(orig);
    if (!o || orig === outputs[0]?.id) continue;
    stats.nodesMade++;
    if (!simNode(map.get(orig)!)) {
      // Inside a group the builder made: the bar can't reach in to change it.
      const inner = allSim().find(x => x.id === map.get(orig));
      const def = getNodeDefinitionFor(o);
      const off = Object.keys(o.params).filter(k => !PARAM_SKIP.has(k) && !sameValue(o.params[k], inner?.params[k] ?? def?.defaultParams?.[k]));
      if (off.length) gap({ category: 'builder-recipe', detail: `${describe(o)} · ${off.join(', ')} (inside a group the recipe made, where the bar can't edit)`, nodeType: o.type, node: o.id });
      continue;
    }
    setParams(o);
    const sg = subgraphOf(o);
    const madeSg = subgraphOf(simNode(map.get(orig)!)!);
    if (sg) {
      const a = levelDigest(sg.nodes), b = madeSg ? levelDigest(madeSg.nodes) : [];
      const same = digestOverlap(a, b);
      stats.nodesMade += same;
      if (same < a.length) gap({ category: 'builder-recipe', detail: `${describe(o)}: ${a.length - same} of ${a.length} inner nodes differ from what its recipe builds (edited since it was built)`, nodeType: o.type, node: o.id });
    }
  }
  if (outputs[0]) setParams(outputs[0]);
  for (const o of outputs.slice(1)) gap({ category: 'extra-node', detail: `a second Output (${describe(o)})`, nodeType: o.type, node: o.id });

  for (const o of order) {
    if (isOutputType(o.type) || map.has(o.id) || lateUv.has(o.id)) continue;
    make(o);
  }
  // UVs no `create` brought along.
  for (const o of order) if (lateUv.has(o.id) && !map.has(o.id)) make(o);
  for (const o of flat.nodes.filter(x => groupLoopIndex.has(x.id))) { void o; }

  // ── 3. Wires ──
  for (const w of flat.wires) {
    const to = byOrig.get(w.to)!;
    if (groupLoopIndex.has(w.from) || groupLoopIndex.has(w.to)) {
      gap({ category: 'group-loop-index', detail: `${describe(byOrig.get(w.from)!)} → ${describe(to)} · ${w.in} (a group's Loop Index is wired inside the group, where the bar can't reach)`, nodeType: 'loopIndex', node: w.from });
      continue;
    }
    const fromSim = map.get(w.from), toSim = map.get(w.to);
    if (!fromSim || !toSim) { gap({ category: 'wire-missing-node', detail: `${describe(byOrig.get(w.from) ?? to)} → ${describe(to)} · ${w.in} (a node it joins isn't made)`, nodeType: (fromSim ? to : byOrig.get(w.from) ?? to).type, node: fromSim ? w.to : w.from }, { line: false }); continue; }
    if (!simNode(toSim) || !simNode(fromSim)) {
      // Inside a group a builder made: there already, or out of the bar's reach.
      if (flattenGraph(sim.nodes).wires.some(x => x.from === fromSim && x.out === w.out && x.to === toSim && x.in === w.in)) stats.wiresMade++;
      else gap({ category: 'builder-recipe', detail: `${describe(byOrig.get(w.from)!)} · ${w.out} → ${describe(to)} · ${w.in} (inside a group the recipe made, where the bar can't wire)`, nodeType: to.type, node: w.to });
      continue;
    }
    const tnode = simNode(toSim)!;
    if (flattenGraph(sim.nodes).wires.some(x => x.from === fromSim && x.out === w.out && x.to === toSim && x.in === w.in)) { stats.wiresMade++; continue; }
    if (!tnode.inputs[w.in]) { gap({ category: 'container-socket', detail: `${describe(to)} has no input “${w.in}” when made by the bar (a socket that comes from its settings or insides)`, nodeType: to.type, node: w.to }); continue; }
    const fromRef = refFor(sim, fromSim);
    const isOut = tnode.type === 'output' && w.in === 'color';
    const ok = (r: SimRun) => { const c = r.sim.nodes.find(x => x.id === toSim)?.inputs[w.in]?.connection; return !!c && c.nodeId === fromSim && c.outputKey === w.out; };
    let done = false, why = '', category: GapCategory = 'wire-failed';
    const candidates: Array<{ text: string; form: LineForm }> = [];
    if (fromRef) {
      if (isOut) candidates.push({ text: `connect ${refText(fromRef)} → ${refText(refFor(sim, toSim) ?? { r: 'type', word: 'output' })}`, form: 'canonical' });
      for (const sw of socketWords(tnode, w.in)) {
        const toRef = refFor(sim, toSim, { socket: sw });
        if (toRef) candidates.push({ text: `connect ${refText(fromRef)} → ${refText(toRef)}`, form: 'canonical' });
      }
    }
    for (const c of candidates) {
      const r = simRun(sim, c.text);
      if (r.ok && ok(r)) { sim = r.sim; lines.push({ text: c.text, form: c.form, section: 'wire' }); done = true; break; }
      if (r.ok) { why = `it took output “${r.sim.nodes.find(x => x.id === toSim)?.inputs[w.in]?.connection?.outputKey ?? '?'}”, not “${w.out}”`; category = 'output-socket'; }
      else { why = r.error ?? ''; category = errorCategory(why, /Type check/.test(why) ? 'wire-type' : /no input/.test(why) ? 'input-socket' : category); }
    }
    // The output by name: only plain English says it ("connect the light inner to …").
    if (!done && fromRef) {
      const fnode = simNode(fromSim)!;
      const outWords = [w.out.toLowerCase(), lowerLabel(fnode.outputs[w.out]?.label ?? '')].filter(x => x && /^[a-z][a-z0-9 ]*$/.test(x));
      for (const ow of [...new Set(outWords)]) {
        for (const sw of isOut ? [''] : socketWords(tnode, w.in)) {
          const toRef = isOut ? refFor(sim, toSim) : refFor(sim, toSim, { socket: sw });
          if (!toRef) continue;
          const text = `connect ${sugarRef(fromRef)} ${ow} to ${sugarRef(toRef)}`;
          const r = simRun(sim, text);
          if (r.ok && ok(r)) { sim = r.sim; lines.push({ text, form: 'sugar', section: 'wire' }); done = true; break; }
        }
        if (done) break;
      }
      if (done) gaps.push({ category: 'sugar-output-socket', detail: `${describe(byOrig.get(w.from)!)} · ${w.out} → ${describe(to)} (only plain English names an output: canonical \`connect\` has no output socket)`, nodeType: byOrig.get(w.from)!.type, node: w.from });
    }
    if (done) { stats.wiresMade++; continue; }
    if (!fromRef) { category = 'ref-ambiguous'; why = 'no reference names the source alone'; }
    gap({ category, detail: `${describe(byOrig.get(w.from)!)} · ${w.out} → ${describe(to)} · ${w.in} (${why || 'no form reached it'})`, nodeType: to.type, node: w.to, other: w.from });
  }

  // ── 4. Clean up: wires the bar added on its own (a new node on an empty Output, UVs), nodes left over ──
  const desired = new Map(flat.wires.map(w => [`${w.to}|${w.in}`, w]));
  for (const [orig, simId] of map) {
    const nd = simNode(simId);
    if (!nd || !byOrig.has(orig)) continue;
    for (const [key, inp] of Object.entries(nd.inputs)) {
      if (!inp.connection) continue;
      const d = desired.get(`${orig}|${key}`);
      const real = flattenGraph(sim.nodes).wires.find(x => x.to === simId && x.in === key);
      if (d && real && map.get(d.from) === real.from && d.out === real.out) continue;
      const sw = socketWords(nd, key)[0] ?? key;
      const ref = nd.type === 'output' ? refFor(sim, simId) : refFor(sim, simId, { socket: sw });
      const text = `disconnect ${ref ? refText(ref) : '?'}`;
      const r = ref ? attempt(text, 'canonical', 'cleanup', x => !x.sim.nodes.find(y => y.id === simId)?.inputs[key]?.connection) : null;
      if (!r?.ok) gap({ category: 'wire-failed', detail: `remove the extra wire into ${describe(byOrig.get(orig)!)} · ${key} (${r?.error ?? 'no reference'})`, nodeType: nd.type, node: orig });
    }
  }
  for (const id of extras_) {
    const ref = refFor(sim, id);
    const r = ref ? attempt(`delete ${refText(ref)}`, 'canonical', 'cleanup', x => !x.sim.nodes.some(y => y.id === id)) : null;
    if (!r?.ok) gap({ category: 'extra-node', detail: `a UV the bar added (${r?.error ?? 'no reference names it'})`, nodeType: 'uv' });
  }

  // ── 5. Groups, innermost first ──
  const groupSim = new Map<string, string>();
  for (const g of flat.groups) {
    if (map.has(g.id)) { groupSim.set(g.id, map.get(g.id)!); continue; }
    const memberSims = [...g.members.filter(m => !groupLoopIndex.has(m)).map(m => map.get(m)), ...g.groups.map(x => groupSim.get(x))];
    if (memberSims.some(x => !x) || !memberSims.length) { gap({ category: 'group-ports', detail: `group “${g.label ?? 'Group'}” (some of its nodes aren't made)`, nodeType: 'group', node: g.id }); continue; }
    const refs = memberSims.map(id => refFor(sim, id!));
    if (refs.some(r => !r)) { gap({ category: 'ref-ambiguous', detail: `group “${g.label ?? 'Group'}” (a member has no reference of its own)`, nodeType: 'group', node: g.id }); continue; }
    const text = `group(${refs.map(r => refText(r!)).join(', ')})${g.label && g.label !== 'Group' ? ` name="${g.label.replace(/"/g, '\'')}"` : ''}`;
    const r = simRun(sim, text);
    if (!r.ok) { gap({ category: 'group-ports', detail: `group “${g.label ?? 'Group'}” (${r.error})`, nodeType: 'group', node: g.id }); continue; }
    const made = r.added.find(a => a.type === 'group')!;
    sim = r.sim;
    lines.push({ text, form: 'canonical', section: 'group', makes: [{ orig: g.id, type: 'group' }] });
    groupSim.set(g.id, made.id);
    map.set(g.id, made.id);
    if (!g.members.some(m => byOrig.get(m)?.type === 'loopIndex')) gap({ category: 'group-ports', detail: `group “${g.label ?? 'Group'}”: group(…) adds a Loop Index the original doesn't have`, nodeType: 'group', node: g.id });
    stats.groupsMade++;
    // The group's own settings (iterations, carry…).
    const okArgs: string[] = [];
    const gdef = getNodeDefinition('group');
    for (const [k, v] of Object.entries(g.params)) {
      if (PARAM_SKIP.has(k) || sameValue(v, gdef?.defaultParams?.[k]) || (k === 'iterations' && v === 1)) continue;
      if (sameValue(v, made.params[k])) continue;
      stats.params++;
      const t = valueText(made, k, v);
      if ('gap' in t) { gap({ category: 'group-settings', detail: `group “${g.label ?? 'Group'}” · ${k} (${t.why})`, nodeType: 'group', node: g.id }); continue; }
      const ref = refFor(sim, made.id);
      const rr = ref ? simRun(sim, `set ${refText(ref)} ${k}=${t.text}`) : null;
      if (rr?.ok && sameValue(rr.sim.nodes.find(x => x.id === made.id)?.params[k], v)) { sim = rr.sim; okArgs.push(`${k}=${t.text}`); stats.paramsSet++; }
      else gap({ category: 'group-settings', detail: `group “${g.label ?? 'Group'}” · ${k}=${t.text} (${rr?.error ?? 'no reference'})`, nodeType: 'group', node: g.id });
    }
    if (okArgs.length) lines.push({ text: `set ${refText(refFor(sim, made.id)!)} ${okArgs.join(' ')}`, form: 'canonical', section: 'group' });
  }

  // ── Causes: a gap that follows from another ──
  const NODE_GAPS = new Set<GapCategory>(['no-create-word', 'create-failed', 'runner-crash', 'dialect-clash']);
  const SHAPE_PARAMS = new Set(['outputType', 'inputs', 'outputs', 'inputType', 'type', 'count', 'items']);
  const nodeCause = (id?: string) => (id ? gaps.find(g => g.node === id && NODE_GAPS.has(g.category) && !g.param)?.category : undefined);
  const shapeCause = (id?: string) => (id ? gaps.find(g => g.node === id && g.param && SHAPE_PARAMS.has(g.param))?.category : undefined);
  for (const g of gaps) {
    if (g.category === 'wire-missing-node') g.cause = nodeCause(g.node) ?? 'other';
    else if (g.category === 'container-socket') g.cause = shapeCause(g.node) ?? (g.nodeType && CODE_TYPES.has(g.nodeType) ? 'param-code' : g.node && subgraphOf(byOrig.get(g.node) ?? ({ params: {} } as GraphNode)) ? 'container-contents' : undefined);
    else if (['wire-type', 'output-socket', 'input-socket'].includes(g.category)) g.cause = shapeCause(g.node) ?? shapeCause(g.other);
  }

  // ── 6. What isn't in the nodes ──
  const play = extras.play as { controls?: unknown[]; mappings?: unknown[]; layers?: unknown[] } | undefined;
  if (play) {
    const parts = [play.controls ? `${play.controls.length} controls` : '', play.mappings ? `${play.mappings.length} mappings` : '', play.layers ? `${play.layers.length} layers` : ''].filter(Boolean);
    gap({ category: 'play', detail: `the Play setup${parts.length ? ` (${parts.join(', ')})` : ''}: controls, live params and MIDI mappings have no words` });
  }
  if (extras.datasets) gap({ category: 'media', detail: 'the datasets the Data nodes read' });
  if (extras.images && Object.keys(extras.images).length) gap({ category: 'media', detail: `${Object.keys(extras.images).length} picture(s) loaded into image slots` });
  const notes = flat.nodes.filter(nd => typeof nd.params.__comment === 'string' && nd.params.__comment.trim()).length;
  if (notes) gaps.push({ category: 'notes', detail: `${notes} node notes (comments) have no words` });
  gaps.push({ category: 'layout', detail: 'node positions are the bar\'s own placement' });

  return {
    lines, gaps, stats, map: Object.fromEntries(map),
    script: lines.map(l => l.text).join('\n'),
  };
}
