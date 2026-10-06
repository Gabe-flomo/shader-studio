/**
 * doCommands.ts — the Do… bar's command language (docs/do-bar-commands.md): sentences of clauses
 * that build and edit a graph. "create a ring with falloff 0.3, colour it with a palette by the
 * length of the space, multiply it by the circle, then output it"; "disconnect the current
 * output, add it to the noise, and output the result"; "switch the noise to voronoi".
 *
 * No AI. The words come from lang/commands.ts (verbs, connectors, references) and
 * lang/vocabulary.ts (shapes, actions, values); references resolve in doRefs.ts.
 *
 *  - A sentence splits into clauses (doRefs.ts `splitClauses`). Each clause is a verb with its
 *    slots, or a build phrase (a shape and actions), which the phrase language (doBar.ts) plans
 *    and runs on the graph as it stands after the clauses before.
 *  - "It" is the last clause's result, so clauses build on each other.
 *  - Every clause runs on a working copy, so the preview shows each step's exact nodes, wires and
 *    values (a diff). A clause that can't be read, a reference that fits nothing, or a wire whose
 *    types don't fit is marked with why and "did you mean"; the clauses after it still preview.
 *  - When a name fits several nodes the clause waits for a pick (`picks`, by clause and slot).
 *  - `execCommand` is pure: the store runs it again with real ids and applies the result as one
 *    undo step (a group, if asked for, inside the same step).
 *
 * A sentence of build phrases only ("circle with a glow, falloff 8") goes to the phrase language
 * whole, exactly as before.
 */
import type { DataType, GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { cardHeight } from '../store/agentSetup';
import { nodeName } from '../store/historyLabels';
import { graphOutput } from '../nodes/scene3dDefaults';
import { placeNear } from '../nodes/recipes';
import { getNodeDefinition, getNodeDefinitionFor } from '../nodes/definitions';
import { VECTORIZABLE_NODES } from '../nodes/definitions/math';
import { planSwitch, applySwitchToList, switchOptions, type SwitchContext } from '../nodes/switchNode';
import { typesCompatible } from '../lib/typesCompatible';
import { ACTIONS, COLOURS, PARAMS, SHAPES, TARGETS, PLACES, colourOf, editDistance, matchAt, numberOf, plural } from '../lang/vocabulary';
import { COMMAND_VERBS, RELATIVE_STEP, RELATIVE_WORDS } from '../lang/commands';
import { parseDo, runDoPlan } from './doBar';
import { matchTaught } from './taught';
import { exprBlock } from './moves';
import { socketKind, spaceInputs } from './kinds';
import { lex, namesOf, readRef, shownNode, splitClauses, typeByName, typesLike, untok, type RefEnv, type RefResult, type Tok, type Wired } from './doRefs';

// ── Results ─────────────────────────────────────────────────────────────────

export interface CmdStep {
  clause: number;
  label: string;
  adds: string[];
  removes: string[];
  wires: string[];
  unwires: string[];
  params: string[];
  notes: string[];
  /** Node ids this step made or changed (for highlighting). */
  touched: string[];
}

export interface CmdPick {
  key: string;
  /** What is being picked ("the circle"). */
  label: string;
  options: Array<{ id: string; label: string }>;
}

export interface CmdClause {
  index: number;
  text: string;
  /** The verb id (lang/commands.ts), or 'build' for a phrase. */
  verb: string;
  status: 'ok' | 'error' | 'pick';
  message?: string;
  /** Replacements for this clause's text ("did you mean"). */
  suggestions?: string[];
  pick?: CmdPick;
  steps: CmdStep[];
}

export interface CommandPlan {
  text: string;
  clauses: CmdClause[];
  steps: CmdStep[];
  /** The graph level after every clause that could run. */
  nodes: GraphNode[];
  /** What to select afterwards. */
  select: string[];
  /** Nodes to put in a group afterwards (the last clause was "group …"). */
  group?: { ids: string[]; label?: string };
  /** Every clause read and resolved, and something changes. */
  ok: boolean;
  changed: boolean;
  /** Not a command: "is this typical?" or "teach …" (the bar handles those). */
  intent?: 'check' | 'teach';
  /** The whole sentence went to the phrase language (build phrases only). */
  phrase?: boolean;
}

export interface CommandOptions {
  /** Selected node ids, in order. */
  selected: string[];
  picks?: Record<string, string>;
  nextId?: () => string;
  topLevel?: boolean;
  heightOf?: (nd: GraphNode) => number;
}

// ── Words ───────────────────────────────────────────────────────────────────

const VERB_PHRASES: Array<{ id: string; parts: string[] }> = COMMAND_VERBS
  .flatMap(v => v.words.map(w => ({ id: v.id, parts: w.split(' ') })))
  .sort((a, b) => b.parts.length - a.parts.length);

const LEAD_FILLER = new Set(['please', 'now', 'also', 'just', 'and', 'then', 'next', 'finally', 'lets', 'can', 'you']);
const TARGET_PHRASES = Object.values(TARGETS).flat();
const PLACE_WORDS = Object.keys(PLACES);

/** The verb a clause starts with (by its words), and how many tokens it used. */
function verbAt(toks: Tok[], i: number): { id: string; used: number; word: string } | null {
  for (const v of VERB_PHRASES) {
    if (v.parts.every((p, k) => toks[i + k] && !toks[i + k].q && toks[i + k].w === p)) return { id: v.id, used: v.parts.length, word: v.parts.join(' ') };
  }
  return null;
}

/** Whether a verb, an action or a shape starts at toks[i] (for splitting clauses). */
function headAt(toks: Tok[], i: number): boolean {
  const t = toks[i];
  if (!t || t.q || t.sep) return false;
  if (verbAt(toks, i)) return true;
  const words = toks.map(x => x.w);
  const a = matchAt(words, i, ACTIONS);
  if (a && !a.fuzzy) return true;
  const s = matchAt(words, i, SHAPES);
  return !!(s && !s.fuzzy);
}

/** Whether an editing verb starts at toks[i] ("and" splits a clause only before one). */
function editVerbAt(toks: Tok[], i: number): boolean {
  const v = verbAt(toks, i);
  if (!v) return false;
  return classify(toks.slice(i)).verb !== 'build';
}

const has = (toks: Tok[], from: number, words: string[]) => toks.findIndex((t, k) => k >= from && !t.q && words.includes(t.w));
const isRefStart = (t: Tok | undefined) => !!t && (t.q || ['it', 'that', 'this', 'these', 'them', 'those', 'the', 'both', 'what', 'all', 'every', 'each'].includes(t.w));
const isNumberTok = (t: Tok | undefined) => !!t && !t.q && numberOf(t.w) !== null;

/** What kind of clause this is: an editing verb (with the tokens after it), or a build phrase. */
export function classify(toks: Tok[]): { verb: string; word?: string; rest: Tok[] } {
  let i = 0;
  while (i < toks.length - 1 && !toks[i].q && LEAD_FILLER.has(toks[i].w)) i++;
  const v = verbAt(toks, i);
  const words = toks.map(t => t.w);
  if (!v) return { verb: 'build', rest: toks };
  const rest = toks.slice(i + v.used);
  const word = v.word;
  // A longer build-action phrase at the start wins ("cut between", "screen blend", "colour it" alone).
  const act = matchAt(words, i, ACTIONS);
  const actLonger = act && !act.fuzzy && act.length > v.used;
  const build = { verb: 'build', rest: toks };
  const refThen = (seps: string[]) => { const k = has(rest, 0, seps); return k >= 0 && isRefStart(rest[k + 1]) ? k : -1; };
  switch (v.id) {
    case 'create': {
      // "add a glow" / "make a ring" with an action word → the phrase language.
      const a = matchAt(rest.map(t => t.w), 0, ACTIONS);
      if (a && !a.fuzzy && !matchAt(rest.map(t => t.w), 0, SHAPES)) return build;
      return { verb: 'create', word, rest };
    }
    case 'combine': {
      if (actLonger) return build;
      if (word === 'add') {
        const a = matchAt(rest.map(t => t.w), rest[0]?.w === 'a' || rest[0]?.w === 'an' || rest[0]?.w === 'some' ? 1 : 0, ACTIONS);
        if (a && !a.fuzzy) return build;
        if (!isRefStart(rest[0])) return word === 'add' && (rest[0]?.w === 'a' || rest[0]?.w === 'an') ? { verb: 'create', word, rest: rest.slice(1) } : build;
        return refThen(['to', 'and', 'with', 'onto']) >= 0 ? { verb: 'combine', word, rest } : build;
      }
      if (['mix', 'blend', 'merge', 'screen', 'overlay', 'cut'].includes(word)) {
        if (!isRefStart(rest[0])) return build;
        return refThen(['with', 'and', 'into', 'over', 'onto', 'on', 'from']) >= 0 ? { verb: 'combine', word, rest } : build;
      }
      if (word === 'times' && !isRefStart(rest[0])) return build;
      return { verb: 'combine', word, rest };
    }
    case 'duplicate':
      if (!isRefStart(rest[0]) || rest.some(t => isNumberTok(t) || t.w === 'times')) return build;
      return { verb: 'duplicate', word, rest };
    case 'colour':
      if (has(rest, 0, ['by', 'palette']) < 0) return build;
      return { verb: 'colour', word, rest };
    case 'replace':
      if (word === 'turn' && (has(rest, 0, ['into']) < 0 && !(has(rest, 0, ['to']) >= 0 && !isNumberTok(rest[has(rest, 0, ['to']) + 1])))) return build;
      if (word === 'change') {
        const k = has(rest, 0, ['to', 'into']);
        if (k < 0) return build;
        const after = rest.slice(k + 1);
        const val = after[0];
        if (isNumberTok(val) || (val && colourOf(val.w)) || (val && ['on', 'off', 'true', 'false'].includes(val.w))) return { verb: 'set', word, rest };
        const tn = after.filter(t => !['a', 'an', 'the'].includes(t.w)).map(t => t.w);
        if (!typeByName(tn) && !typeByName(tn.slice(0, 1))) return { verb: 'set', word, rest };
      }
      return { verb: 'replace', word, rest };
    case 'insert':
      if (has(rest, 0, ['between', 'after', 'before']) < 0) return build;
      return { verb: 'insert', word, rest };
    case 'connect':
      if (has(rest, 0, ['to', 'into', 'onto', 'with']) < 0) return build;
      return { verb: 'connect', word, rest };
    case 'adjust': {
      if (word === 'make') {
        const rel = rest.findIndex(t => !t.q && t.w in RELATIVE_WORDS);
        if (rel < 0 || !isRefStart(rest[0])) return build;
      }
      return { verb: 'adjust', word, rest };
    }
    case 'output':
      if (!rest.length) return build;
      return { verb: 'output', word, rest };
    case 'rename':
      if (!rest.length || (word === 'name' && !isRefStart(rest[0]))) return build;
      return { verb: 'rename', word, rest };
    case 'select':
      if (!rest.length) return build;
      return { verb: 'select', word, rest };
    default:
      if (actLonger) return build;
      return { verb: v.id, word, rest };
  }
}

// ── Graph helpers ───────────────────────────────────────────────────────────

const TYPE_RANK: Record<string, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
const TYPE_WORD: Record<string, string> = { float: 'a number (float)', vec2: 'a position (vec2)', vec3: 'a colour (vec3)', vec4: 'a colour with alpha (vec4)', mat2: 'a 2×2 matrix', mat3: 'a 3×3 matrix', scene3d: 'a 3D scene', spacewarp3d: 'a 3D space warp', texture: 'a texture (a Pass)' };
const typeWord = (t: string) => TYPE_WORD[t] ?? t;

/** Everything `id` reads, directly or not. */
function upstream(nodes: GraphNode[], id: string): Set<string> {
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = byId.get(stack.pop()!);
    if (!cur) continue;
    for (const i of Object.values(cur.inputs)) {
      const c = i.connection?.nodeId;
      if (c && !seen.has(c)) { seen.add(c); stack.push(c); }
    }
  }
  return seen;
}

/** Whether wiring `from` into `to` would make a loop. */
const makesLoop = (nodes: GraphNode[], from: string, to: string) => from === to || upstream(nodes, from).has(to);

function setWire(nodes: GraphNode[], to: string, key: string, from: Wired | null): GraphNode[] {
  return nodes.map(nd => (nd.id === to
    ? { ...nd, inputs: { ...nd.inputs, [key]: { ...nd.inputs[key], connection: from ? { nodeId: from.id, outputKey: from.key! } : undefined } } }
    : nd));
}

/** Who reads `id` (optionally only its output `key`): [node id, input key]. */
function consumers(nodes: GraphNode[], id: string, key?: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const nd of nodes) for (const [k, i] of Object.entries(nd.inputs)) if (i.connection?.nodeId === id && (key === undefined || i.connection.outputKey === key)) out.push([nd.id, k]);
  return out;
}

/** An output of `node`: the named one, else the first of a wanted type, else one that fits, else the first. */
function pickOut(node: GraphNode, key?: string, want?: string[]): { key: string; type: string } | null {
  if (key && node.outputs[key]) return { key, type: node.outputs[key].type };
  const outs = Object.entries(node.outputs);
  if (want) {
    for (const t of want) { const e = outs.find(([, o]) => o.type === t); if (e) return { key: e[0], type: e[1].type }; }
    const e = outs.find(([, o]) => want.some(t => typesCompatible(o.type, t)));
    if (e) return { key: e[0], type: e[1].type };
  }
  return outs[0] ? { key: outs[0][0], type: outs[0][1].type } : null;
}

const lowerLabel = (s: string) => s.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();

/** An input of `node` named by `words` (its key or label), or null. */
function inputByName(node: GraphNode, words: string[]): string | null {
  const w = words.filter(x => !['the', 'input', 'socket', 'slot', 'its'].includes(x)).join(' ');
  if (!w) return null;
  const entries = Object.entries(node.inputs);
  return entries.find(([k, s]) => k.toLowerCase() === w || lowerLabel(s.label) === w)?.[0]
    ?? entries.find(([k, s]) => k.toLowerCase().startsWith(w) || lowerLabel(s.label).startsWith(w))?.[0] ?? null;
}

/** An output of `node` named by `words`. */
function outputByName(node: GraphNode, words: string[]): string | null {
  const w = words.filter(x => !['the', 'output', 'its'].includes(x)).join(' ');
  if (!w) return null;
  return Object.entries(node.outputs).find(([k, s]) => k.toLowerCase() === w || lowerLabel(s.label) === w)?.[0] ?? null;
}

/**
 * The input a wire goes to: a free one of the same kind (a distance into a distance), then a
 * wired one of that kind (not for plain numbers), then free and the same type, then free and
 * fitting, then any that fits.
 */
function pickIn(node: GraphNode, t: string, from?: { type: string; key: string; node: GraphNode }): string | null {
  const entries = Object.entries(node.inputs);
  const kind = from ? socketKind(from.node.type, from.key, from.node.outputs[from.key] ?? { type: t }, 'out') : null;
  const kindOf = (k: string, s: { type: string; label?: string }) => socketKind(node.type, k, s, 'in');
  if (kind) {
    const same = entries.find(([k, s]) => !s.connection && kindOf(k, s) === kind && typesCompatible(t, s.type))?.[0];
    if (same) return same;
    if (kind !== 'scalar') { const wired = entries.find(([k, s]) => kindOf(k, s) === kind && typesCompatible(t, s.type))?.[0]; if (wired) return wired; }
  }
  return entries.find(([, s]) => !s.connection && s.type === t)?.[0]
    ?? entries.find(([, s]) => !s.connection && typesCompatible(t, s.type))?.[0]
    ?? entries.find(([, s]) => typesCompatible(t, s.type))?.[0] ?? null;
}

/** A vectorizable math node (Add, Multiply…) of type `t`. */
function mathNode(type: string, id: string, x: number, y: number, t: string, params: Record<string, unknown> = {}): GraphNode {
  const nd = n(type, id, x, y, { ...(t !== 'float' ? { outputType: t } : {}), ...params });
  const v = VECTORIZABLE_NODES[type];
  if (t !== 'float' && v) {
    for (const k of [v.primaryInput, ...(v.alsoInputs ?? [])]) if (nd.inputs[k]) nd.inputs[k] = { ...nd.inputs[k], type: t as DataType };
    if (v.primaryOutput && nd.outputs[v.primaryOutput]) nd.outputs[v.primaryOutput] = { ...nd.outputs[v.primaryOutput], type: t as DataType };
  }
  return nd;
}

/** A phrase that names `node` again ("the circle", "the second circle", "Halo"), for suggestions. */
export function refText(node: GraphNode, nodes: GraphNode[]): string {
  if (typeof node.params?.label === 'string' && node.params.label.trim()) return `"${node.params.label.trim()}"`;
  const def = getNodeDefinition(node.type);
  const shape = SHAPES.find(s => s.node2d?.type === node.type && (s.node2d.params?.shape === undefined || s.node2d.params.shape === node.params.shape));
  const name = shape && node.type !== 'shapeSDF' ? shape.words[0] : shape ? shape.words[0] : lowerLabel(def?.label.replace(/\bsdf\b/i, '') ?? node.type);
  const same = nodes.filter(x => namesOf(x).has(name)).sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  if (same.length <= 1) return `the ${name}`;
  const k = same.findIndex(x => x.id === node.id);
  return `the ${['first', 'second', 'third', 'fourth', 'fifth'][k] ?? `${name} ${k + 1}`} ${name}`.replace(/the (\w+ \d+) .*/, 'the $1');
}

// ── Diffs ───────────────────────────────────────────────────────────────────

const fmtValue = (v: unknown): string => {
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (Array.isArray(v) && v.length <= 4 && v.every(x => typeof x === 'number')) return v.length === 3 ? `rgb(${v.map(x => Math.round(Number(x) * 255)).join(', ')})` : `(${v.map(fmtValue).join(', ')})`;
  if (typeof v === 'string') return `“${v.length > 24 ? `${v.slice(0, 24)}…` : v}”`;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (v === undefined) return '—';
  return '…';
};
const SKIP_PARAMS = new Set(['__comment', 'subgraph', 'lines', 'inputs', 'expr', 'result']);

/** What changed between two versions of a level: nodes, wires and settings, in words. */
export function diffNodes(before: GraphNode[], after: GraphNode[]): Omit<CmdStep, 'clause' | 'label' | 'notes'> {
  const b = new Map(before.map(nd => [nd.id, nd]));
  const a = new Map(after.map(nd => [nd.id, nd]));
  const name = (id: string) => nodeName(a.get(id) ?? b.get(id));
  const outLabel = (id: string, key: string) => (a.get(id) ?? b.get(id))?.outputs[key]?.label ?? key;
  const inLabel = (id: string, key: string) => (a.get(id) ?? b.get(id))?.inputs[key]?.label ?? key;
  const adds: string[] = [], removes: string[] = [], wires: string[] = [], unwires: string[] = [], params: string[] = [];
  const touched = new Set<string>();
  for (const nd of after) if (!b.has(nd.id)) { adds.push(nodeName(nd)); touched.add(nd.id); }
  for (const nd of before) if (!a.has(nd.id)) removes.push(nodeName(nd));
  const wireText = (from: string, out: string, to: string, inp: string) => `${name(from)} · ${outLabel(from, out)} → ${name(to)} · ${inLabel(to, inp)}`;
  for (const nd of after) {
    const old = b.get(nd.id);
    for (const [k, i] of Object.entries(nd.inputs)) {
      const c = i.connection, oc = old?.inputs[k]?.connection;
      if (c && (!oc || oc.nodeId !== c.nodeId || oc.outputKey !== c.outputKey)) { wires.push(wireText(c.nodeId, c.outputKey, nd.id, k)); touched.add(nd.id); touched.add(c.nodeId); }
      if (oc && a.has(oc.nodeId) && (!c || c.nodeId !== oc.nodeId || c.outputKey !== oc.outputKey)) { unwires.push(wireText(oc.nodeId, oc.outputKey, nd.id, k)); touched.add(nd.id); }
    }
    if (old) for (const [k, i] of Object.entries(old.inputs)) {
      if (nd.inputs[k] || !i.connection || !a.has(i.connection.nodeId)) continue;
      unwires.push(wireText(i.connection.nodeId, i.connection.outputKey, nd.id, k));
    }
    if (!old) continue;
    if (old.type !== nd.type) { params.push(`${nodeName(old)} switched to ${getNodeDefinition(nd.type)?.label ?? nd.type}`); touched.add(nd.id); continue; }
    const def = getNodeDefinitionFor(nd);
    for (const k of new Set([...Object.keys(old.params), ...Object.keys(nd.params)])) {
      if (SKIP_PARAMS.has(k) || k.startsWith('__')) continue;
      const x = old.params[k], y = nd.params[k];
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      const label = k === 'label' ? 'Name' : def?.paramDefs?.[k]?.label ?? k;
      params.push(`${nodeName(k === 'label' ? old : nd)} · ${label} ${fmtValue(x)} → ${fmtValue(y)}`);
      touched.add(nd.id);
    }
  }
  return { adds, removes, wires, unwires, params, touched: [...touched] };
}

// ── Clause errors ───────────────────────────────────────────────────────────

class ClauseError {
  message: string;
  suggestions: string[];
  pick?: CmdPick;
  constructor(message: string, suggestions: string[] = [], pick?: CmdPick) { this.message = message; this.suggestions = suggestions; this.pick = pick; }
}

const fail = (message: string, suggestions: string[] = []): never => { throw new ClauseError(message, suggestions); };

/** Words that might have been meant for a word nothing knows. */
export function didYouMean(word: string): string[] {
  const out: Array<{ w: string; d: number }> = [];
  const consider = (w: string) => {
    if (w.includes(' ')) return;
    const d = editDistance(word, w, 2);
    if (d <= (word.length > 5 ? 2 : 1)) out.push({ w, d });
  };
  for (const v of COMMAND_VERBS) v.words.forEach(consider);
  // A verb that fits wins over shapes and actions ("conect" is connect, not cone).
  if (out.length) return [...new Set(out.sort((a, b) => a.d - b.d).map(x => x.w))].slice(0, 3);
  for (const a of ACTIONS) a.words.forEach(consider);
  for (const s of SHAPES) s.words.forEach(consider);
  for (const ws of Object.values(PARAMS)) ws.forEach(consider);
  Object.keys(COLOURS).forEach(consider);
  Object.keys(RELATIVE_WORDS).forEach(consider);
  return [...new Set(out.sort((a, b) => a.d - b.d).map(x => x.w))].slice(0, 3);
}

// ── Settings ────────────────────────────────────────────────────────────────

/** Setting words a node type means by another name ("falloff" on SDF Glow is Brightness). */
const PARAM_ALIASES: Record<string, Record<string, string>> = {
  light: { falloff: 'brightness', tightness: 'brightness', sharpness: 'brightness', colour: 'tint', color: 'tint' },
  distanceShape: { colour: 'tint', color: 'tint', thickness: 'width' },
  sdfFill: { colour: 'fillColor', color: 'fillColor', fill: 'fillColor', stroke: 'strokeColor' },
  fbm: { size: 'scale', zoom: 'scale', speed: 'time_scale' },
  voronoi: { size: 'scale', zoom: 'scale', speed: 'time_scale' },
  noiseFloat: { size: 'scale', zoom: 'scale' },
  palette: { speed: 'speed', bands: 'scale' },
  shapeSDF: { radius: 'r', size: 'r' },
  boxSDF: { size: 'width', radius: 'width' },
};

const ROLE_PARAMS: Record<string, string[]> = {
  size: ['radius', 'r', 'width', 'size', 'scale', 'thickness', 'spacing', 'amount'],
  intensity: ['intensity', 'brightness', 'amount', 'strength', 'opacity', 'gain', 'exposure', 'scale'],
  speed: ['speed', 'time_scale', 'rate'],
  softness: ['softness', 'antialias', 'smoothness', 'k', 'blur', 'innerFalloff'],
  count: ['count', 'octaves', 'copies', 'ringFreq', 'scale'],
};
/** Types whose role setting goes the other way (SDF Glow's Brightness is a falloff: higher is tighter). */
const ROLE_OVERRIDES: Record<string, Partial<Record<string, { key: string; invert?: boolean }>>> = {
  light: { size: { key: 'brightness', invert: true }, intensity: { key: 'brightness', invert: true }, softness: { key: 'brightness', invert: true } },
  fbm: { size: { key: 'scale', invert: true }, count: { key: 'octaves' } },
  voronoi: { size: { key: 'scale', invert: true }, count: { key: 'scale' } },
};

interface ParamHit { key: string; label: string; kind: 'number' | 'colour' | 'select' | 'bool' | 'string'; options?: Array<{ value: string; label: string }>; integer?: boolean }

function paramInfo(node: GraphNode, key: string): ParamHit | null {
  const def = getNodeDefinitionFor(node);
  const pd = def?.paramDefs?.[key];
  const cur = node.params[key] ?? def?.defaultParams?.[key];
  if (!pd && cur === undefined) return null;
  const label = pd?.label ?? key;
  if (pd?.type === 'select') return { key, label, kind: 'select', options: pd.options };
  if (pd?.type === 'bool' || typeof cur === 'boolean') return { key, label, kind: 'bool' };
  if (pd?.type === 'vec3color' || pd?.type === 'vec3' || (Array.isArray(cur) && cur.length === 3)) return { key, label, kind: 'colour' };
  if (pd?.type === 'string' || typeof cur === 'string') return { key, label, kind: 'string' };
  if (pd?.type === 'float' || pd?.type === 'int' || typeof cur === 'number') return { key, label, kind: 'number', integer: pd?.type === 'int' || (pd?.step === 1 && Number.isInteger(cur)) };
  return null;
}

/** The setting of `node` named by `words` (its key, label, a vocabulary word or the type's own alias). */
function findParam(node: GraphNode, words: string[]): ParamHit | null {
  const w = words.filter(x => !['the', 'its', 'setting', 'value', 'amount of'].includes(x)).join(' ');
  if (!w) return null;
  const def = getNodeDefinitionFor(node);
  const keys = [...new Set([...Object.keys(def?.paramDefs ?? {}), ...Object.keys(def?.defaultParams ?? {}), ...Object.keys(node.params)])].filter(k => !k.startsWith('__') && !SKIP_PARAMS.has(k));
  const label = (k: string) => lowerLabel(def?.paramDefs?.[k]?.label ?? k);
  const squash = (s: string) => s.replace(/[\s_-]+/g, '');
  const direct = keys.find(k => k.toLowerCase() === w || label(k) === w || squash(k.toLowerCase()) === squash(w) || squash(label(k)) === squash(w));
  if (direct) return paramInfo(node, direct);
  const alias = PARAM_ALIASES[node.type]?.[w] ?? PARAM_ALIASES[node.type]?.[plural(w)];
  if (alias && keys.includes(alias)) return paramInfo(node, alias);
  // A vocabulary word: its slot, then the slot's role.
  const slot = Object.entries(PARAMS).find(([, ws]) => ws.includes(w))?.[0];
  if (slot) {
    const a = PARAM_ALIASES[node.type]?.[slot];
    if (a && keys.includes(a)) return paramInfo(node, a);
    if (keys.includes(slot)) return paramInfo(node, slot);
    const role = slot === 'radius' ? 'size' : slot === 'amount' ? 'intensity' : slot === 'smoothness' ? 'softness' : slot === 'count' ? 'count' : slot === 'speed' ? 'speed' : null;
    if (role) { const r = roleParam(node, role); if (r) return paramInfo(node, r.key); }
  }
  if (w === 'size' || w === 'scale') { const r = roleParam(node, 'size'); if (r) return paramInfo(node, r.key); }
  const starts = keys.find(k => label(k).startsWith(w));
  return starts ? paramInfo(node, starts) : null;
}

/** The number setting a role ("size") moves on this node. */
function roleParam(node: GraphNode, role: string): { key: string; invert: boolean } | null {
  const o = ROLE_OVERRIDES[node.type]?.[role];
  if (o && paramInfo(node, o.key)) return { key: o.key, invert: !!o.invert };
  const shape = SHAPES.find(s => s.node2d?.type === node.type)?.node2d?.size;
  if (role === 'size' && shape && paramInfo(node, shape)?.kind === 'number') return { key: shape, invert: false };
  for (const k of ROLE_PARAMS[role] ?? []) if (paramInfo(node, k)?.kind === 'number') return { key: k, invert: false };
  return null;
}

const currentParam = (node: GraphNode, key: string) => node.params[key] ?? getNodeDefinitionFor(node)?.defaultParams?.[key];

/** A value for a setting from words: a number, a colour, a choice, on / off, or text. */
function valueFor(p: ParamHit, toks: Tok[]): unknown {
  const words = toks.filter(t => !['the', 'a', 'an'].includes(t.w));
  if (!words.length) fail(`What should ${p.label} be?`);
  const first = words[0];
  if (p.kind === 'number') {
    const v = numberOf(first.w);
    if (v === null) fail(`${p.label} takes a number; “${untok(words)}” isn’t one.`);
    return p.integer ? Math.round(v!) : v;
  }
  if (p.kind === 'colour') {
    const c = colourOf(first.w);
    if (c) return c;
    const nums = words.map(t => numberOf(t.w));
    if (nums.length >= 3 && nums.slice(0, 3).every(x => x !== null)) return nums.slice(0, 3);
    return fail(`${p.label} is a colour: a colour word or #rrggbb.`, Object.keys(COLOURS).filter(c2 => editDistance(c2, first.w, 2) <= 2).slice(0, 3));
  }
  if (p.kind === 'bool') {
    if (['on', 'true', 'yes', '1'].includes(first.w)) return true;
    if (['off', 'false', 'no', '0'].includes(first.w)) return false;
    return fail(`${p.label} is on or off.`);
  }
  if (p.kind === 'select') {
    const w = words.map(t => t.w).join(' ');
    const o = p.options?.find(x => x.value.toLowerCase() === w || lowerLabel(x.label) === w)
      ?? p.options?.find(x => lowerLabel(x.label).startsWith(w) || x.value.toLowerCase().startsWith(w));
    if (!o) return fail(`${p.label} is one of: ${p.options?.map(x => x.label).join(', ')}.`);
    return o.value;
  }
  return words.map(t => t.w).join(' ');
}

// ── Running clauses ─────────────────────────────────────────────────────────

interface Run {
  nodes: GraphNode[];
  subject: Wired | null;
  selected: string[];
  select: string[] | null;
  group?: { ids: string[]; label?: string };
  nextId: () => string;
  topLevel: boolean;
  heightOf: (nd: GraphNode) => number;
  picks: Record<string, string>;
  /** The initial selection (for "this", "these"). */
  initial: string[];
  /** The last clause couldn't run ("it" is unknown). */
  broken?: boolean;
}

interface ClauseCtx { run: Run; index: number; last: boolean; steps: CmdStep[]; text: string; /** A later clause wires something to the Output itself. */ outputLater?: boolean }

function env(r: Run): RefEnv {
  return { nodes: r.nodes, selected: r.selected, subject: r.subject, broken: r.broken };
}

/** readRef with this clause's pick applied (no throw). */
function readPicked(c: ClauseCtx, slot: string, toks: Tok[], i = 0): RefResult {
  const r = readRef(toks, i, env(c.run));
  const p = c.run.picks[`${c.index}:${slot}`];
  if (!r.ok && r.candidates && p && r.candidates.includes(p)) return { ok: true, ids: [p], used: r.used, text: r.text };
  return r;
}

/** Resolve a reference for slot `slot`, using a pick when several fit. */
function ref(c: ClauseCtx, slot: string, toks: Tok[], i = 0): Extract<RefResult, { ok: true }> {
  const r = readRef(toks, i, env(c.run));
  if (r.ok) return r;
  if (r.candidates) {
    const p = c.run.picks[`${c.index}:${slot}`];
    if (p && r.candidates.includes(p)) return { ok: true, ids: [p], used: r.used, text: r.text };
    const byId = new Map(c.run.nodes.map(nd => [nd.id, nd]));
    const describe = (id: string) => {
      const nd = byId.get(id)!;
      const into = consumers(c.run.nodes, id).map(([cid]) => nodeName(byId.get(cid)));
      const from = Object.values(nd.inputs).find(i2 => i2.connection)?.connection;
      return `${nodeName(nd)}${from ? ` · from ${nodeName(byId.get(from.nodeId))}` : ''}${into.length ? ` · into ${[...new Set(into)].slice(0, 2).join(', ')}` : ' · feeds nothing'}`;
    };
    throw new ClauseError(r.error, [], { key: `${c.index}:${slot}`, label: r.text, options: r.candidates.map(id => ({ id, label: describe(id) })) });
  }
  const it = c.text.replace(r.text, 'it');
  throw new ClauseError(r.error, r.suggestions.map(s => (s.startsWith('create ') ? `${s}, then ${it}` : c.text.replace(r.text, s))).filter(s => s !== c.text));
}

const one = (_c: ClauseCtx, r: Extract<RefResult, { ok: true }>, what: string) => {
  if (r.ids.length !== 1) fail(`${what} names ${r.ids.length} nodes; this needs one.`);
  return r.ids[0];
};

/** "the circle and the glow" → every node named, in order. */
function refs(c: ClauseCtx, slot: string, toks: Tok[]): string[] {
  const out: string[] = [];
  let i = 0, k = 0;
  while (i < toks.length) {
    if (['and', 'plus', 'also'].includes(toks[i].w) && !toks[i].q) { i++; continue; }
    if (toks[i].w === 'as') break;
    const r = ref(c, `${slot}${k++}`, toks, i);
    out.push(...r.ids);
    i += Math.max(1, r.used);
  }
  return [...new Set(out)];
}

/** Put new nodes into the level near (x, y), never on a card; returns the level. */
function place(c: ClauseCtx, added: GraphNode[]): GraphNode[] {
  const placed = placeNear(c.run.nodes, added, c.run.heightOf);
  return [...c.run.nodes, ...placed];
}

/** Where a new node goes: right of `id`, else below the graph. */
function spot(nodes: GraphNode[], id?: string, dx = 420): { x: number; y: number } {
  const nd = id ? nodes.find(x => x.id === id) : undefined;
  if (nd) return { x: nd.position.x + dx, y: nd.position.y };
  const xs = nodes.map(x => x.position.x), ys = nodes.map(x => x.position.y + 300);
  return { x: xs.length ? Math.min(...xs) : 0, y: ys.length ? Math.max(...ys) + 120 : 0 };
}

/** Check a wire's types, failing with why and fixes (command text) when they don't fit. */
function typeCheck(c: ClauseCtx, from: GraphNode, outKey: string, to: GraphNode, inKey: string) {
  const ft = from.outputs[outKey]?.type, tt = to.inputs[inKey]?.type;
  if (!ft || !tt || typesCompatible(ft, tt)) return;
  const a = refText(from, c.run.nodes), b = refText(to, c.run.nodes);
  const fixes: string[] = [];
  if (tt === 'float' && (ft === 'vec3' || ft === 'vec4')) fixes.push(`create a luminance, connect ${a} to it, then connect it to ${b}`);
  if (tt === 'float' && ft === 'vec2') fixes.push(`create a length, connect ${a} to it, then connect it to ${b}`);
  if (tt === 'texture') fixes.push(`create a pass, connect ${a} to it, then connect it to ${b}`);
  if (tt === 'vec2' && ft === 'vec4') fixes.push(`switch ${a} to a node with a vec3 or vec2 output`);
  fail(`Type check: ${nodeName(from)} · ${from.outputs[outKey].label} is ${typeWord(ft)}; ${nodeName(to)} · ${to.inputs[inKey].label} takes ${typeWord(tt)}.`, fixes);
}

function step(c: ClauseCtx, label: string, before: GraphNode[], notes: string[] = []) {
  c.steps.push({ clause: c.index, label, notes, ...diffNodes(before, c.run.nodes) });
}

/** The node a reference names, as a wire end (the Output by name means what it shows, for values). */
function valueEnd(c: ClauseCtx, r: Extract<RefResult, { ok: true }>, what: string, want?: string[]): { node: GraphNode; key: string; type: string } {
  let id = one(c, r, what);
  let key = r.key;
  if (r.via === 'output-node') {
    const s = shownNode(c.run.nodes);
    if (!s) fail('The Output shows nothing yet.');
    id = s!.id; key = s!.key;
  }
  const node = c.run.nodes.find(x => x.id === id)!;
  const o = pickOut(node, key, want);
  if (!o) fail(`${nodeName(node)} has no output.`);
  return { node, key: o!.key, type: o!.type };
}

/** Re-point what read `base` (its output `key`) to `result`, where the types fit and no loop forms. */
function takeOver(c: ClauseCtx, base: { id: string; key: string }, result: { id: string; key: string; type: string }): number {
  let moved = 0;
  const loopy = upstream(c.run.nodes, result.id);
  for (const [cid, ck] of consumers(c.run.nodes, base.id, base.key)) {
    if (cid === result.id || loopy.has(cid)) continue;
    const t = c.run.nodes.find(x => x.id === cid)!.inputs[ck].type;
    if (!typesCompatible(result.type, t)) continue;
    c.run.nodes = setWire(c.run.nodes, cid, ck, { id: result.id, key: result.key });
    moved++;
  }
  return moved;
}

/** Show `w` on the Output when it shows nothing (a clause at the end of a sentence that makes something). */
function showIfEmpty(c: ClauseCtx, w: { id: string; key: string; type: string }) {
  if (!c.last) return;
  const out = graphOutput(c.run.nodes);
  if (out && out.inputs.color?.connection) return;
  if (!typesCompatible(w.type, 'vec3')) return;
  if (out) c.run.nodes = setWire(c.run.nodes, out.id, 'color', { id: w.id, key: w.key });
  else if (c.run.topLevel) {
    const p = spot(c.run.nodes, w.id);
    c.run.nodes = place(c, [n('output', c.run.nextId(), p.x, p.y, { __comment: 'Output: what the canvas shows. Added by the Do… bar.' }, { color: [w.id, w.key] })]);
  }
}

// ── Verbs ───────────────────────────────────────────────────────────────────

/** A build phrase on the graph so far, through the phrase language. */
function execBuild(c: ClauseCtx, toks: Tok[]) {
  const r = c.run;
  // A node named with "the" ("glow the circle", "add rings to the circle") is what it works on.
  let target: string | null = null;
  const kept: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const words = toks.map(x => x.w);
    const isTarget = TARGET_PHRASES.some(p => p.split(' ').every((w, k) => words[i + k] === w));
    const isPlace = PLACE_WORDS.some(p => `the ${p}` === words.slice(i, i + 1 + p.split(' ').length).join(' ') || p === words.slice(i, i + p.split(' ').length).join(' '));
    if (!target && (t.q || t.w === 'the') && !isTarget && !isPlace) {
      const rr = readPicked(c, 'target', toks, i);
      if (rr.ok && rr.ids.length === 1) {
        target = rr.via === 'output-node' ? shownNode(r.nodes)?.id ?? rr.ids[0] : rr.ids[0];
        if (kept.length && ['to', 'on', 'onto', 'of', 'for'].includes(kept[kept.length - 1].w)) kept.pop();
        i += rr.used - 1;
        continue;
      }
      if (!rr.ok && rr.candidates) { ref(c, 'target', toks, i); }
    }
    kept.push(t);
  }
  // "create a ring with falloff 0.3": a value only a move has adds that move.
  const words = kept.filter(t => !t.sep).map(t => t.w);
  const hasAction = words.some((_, i) => { const a = matchAt(words, i, ACTIONS); return !!a && !a.fuzzy; });
  const falloffAt = words.findIndex(w => PARAMS.falloff.includes(w));
  if (!hasAction && falloffAt >= 0 && words.some((_, i) => !!matchAt(words, i, SHAPES))) words.splice(falloffAt, 0, 'glow');
  const text = words.join(' ').trim();
  if (!text) fail('Nothing to do here.');
  const usesSelection = words.some(w => ['these', 'them', 'both', 'this'].includes(w));
  const selected = target ? [target] : usesSelection ? r.initial : r.subject ? [r.subject.id] : r.selected;
  const plan = parseDo(text, { nodes: r.nodes, selected });
  const unknown = plan.unknown.filter(w => !['create', 'new', 'draw', 'place'].includes(w));
  if (plan.intent) fail('“Is this typical?” and “teach …” go on their own.');
  if (!plan.steps.length) {
    const sug = unknown.flatMap(w => didYouMean(w).map(m => c.text.replace(w, m)));
    fail(unknown.length ? `Didn’t understand “${unknown.join(' ')}”.` : plan.problem ?? 'No shape, action or verb in this part.', sug);
  }
  if (plan.problem) fail(plan.problem);
  const notes = unknown.length ? [`Skipped “${unknown.join(' ')}”${didYouMean(unknown[0]).length ? ` (did you mean ${didYouMean(unknown[0]).map(w => `“${w}”`).join(' or ')}?)` : ''}.`] : [];
  const res = runDoPlan(r.nodes, plan, r.nextId, {
    topLevel: r.topLevel, heightOf: r.heightOf, show: !c.outputLater, paintShapes: c.last,
    onStep: (k, label, before, after) => c.steps.push({ clause: c.index, label, notes: k === 0 ? notes : [], ...diffNodes(before, after) }),
  });
  r.nodes = res.nodes;
  // "It" afterwards: the node a space move went in front of (warp it → the noise), else what the move made.
  const lastStep = plan.steps[plan.steps.length - 1];
  const id = lastStep?.kind === 'move' && lastStep.side === 'in' ? (res.made[lastStep.node] ?? lastStep.node) : res.select;
  r.subject = id ? { id } : r.subject;
}

function execCreate(c: ClauseCtx, rest: Tok[]) {
  const words = rest.filter(t => !t.sep).map(t => t.w);
  let i = 0;
  while (['a', 'an', 'the', 'new', 'some'].includes(words[i])) i++;
  // A shape (or an action phrase) goes through the phrase language.
  const s = matchAt(words, i, SHAPES);
  if (s && !s.fuzzy) { execBuild(c, rest); return; }
  let named: ReturnType<typeof typeByName> = null, len = 0;
  for (let k = Math.min(4, words.length - i); k >= 1 && !named; k--) { named = typeByName(words.slice(i, i + k)); len = k; }
  if (!named) {
    const w = words.slice(i, i + 2);
    const like = typesLike(w);
    if (s) { execBuild(c, rest); return; }
    fail(`“${w.join(' ')}” isn’t a node or shape.`, [...like.map(l => c.text.replace(w.join(' '), l)), ...didYouMean(w[0] ?? '').map(m => c.text.replace(w[0], m))]);
  }
  const def = getNodeDefinition(named!.type)!;
  const before = c.run.nodes;
  const id = c.run.nextId();
  const at = spot(c.run.nodes);
  const nd = n(named!.type, id, at.x + 420, at.y, { ...(named!.params ?? {}), __comment: `${def.label}: added by the Do… bar (“${c.text}”).` });
  // "with radius 0.3", "speed 2": settings by name.
  const tail = rest.slice(rest.findIndex((_, k) => k >= i + len) >= 0 ? i + len : rest.length);
  const notes: string[] = [];
  for (let k = 0; k < tail.length; k++) {
    const v = numberOf(tail[k + 1]?.w ?? '');
    if (v === null) continue;
    const p = findParam(nd, [tail[k].w]);
    if (p?.kind === 'number') { nd.params[p.key] = p.integer ? Math.round(v) : v; k++; }
  }
  const added: GraphNode[] = [nd];
  // A node that reads a position gets a UV, so it shows something.
  for (const sp of spaceInputs(nd)) {
    const uv = n('uv', c.run.nextId(), at.x, at.y, { __comment: 'UV: the position of each pixel.\nWhy: the space the new node reads (added by the Do… bar).' });
    nd.inputs[sp.key] = { ...nd.inputs[sp.key], connection: { nodeId: uv.id, outputKey: 'uv' } };
    added.unshift(uv);
    break;
  }
  c.run.nodes = place(c, added);
  const o = pickOut(nd, undefined, ['vec3', 'float']);
  if (o) showIfEmpty(c, { id, key: o.key, type: o.type });
  c.run.subject = { id, key: o?.key };
  step(c, `Add ${def.label}`, before, notes);
}

function execConnect(c: ClauseCtx, rest: Tok[], opts: { reconnect?: boolean } = {}) {
  const k = has(rest, 0, ['to', 'into', 'onto', 'with']);
  if (k < 0) fail('Connect what to what? “connect A to B”.');
  const left = rest.slice(0, k), right = rest.slice(k + 1);
  const a = ref(c, 'from', left);
  const fromId = one(c, a, a.text);
  let outName: string[] = left.slice(a.used).map(t => t.w).filter(w => w !== 'output');
  // The input: "the tint of the glow", "the glow's tint", "the glow tint".
  let toRef: Extract<RefResult, { ok: true }>, inWords: string[] = [];
  const of = has(right, 0, ['of']);
  const poss = right.findIndex(t => t.poss);
  if (of >= 0) { inWords = right.slice(0, of).map(t => t.w); toRef = ref(c, 'to', right, of + 1); }
  else if (poss >= 0) { toRef = ref(c, 'to', right.slice(0, poss)); inWords = right.slice(poss + 1).map(t => t.w); }
  else { toRef = ref(c, 'to', right); inWords = right.slice(toRef.used).map(t => t.w); }
  const toId = toRef.via === 'output-role' ? graphOutput(c.run.nodes)?.id ?? one(c, toRef, toRef.text) : one(c, toRef, toRef.text);
  const before = c.run.nodes;
  const from = c.run.nodes.find(x => x.id === fromId)!;
  if (from.type === 'output') fail('The Output has no output to connect.');
  const notes: string[] = [];
  if (opts.reconnect) {
    const outs = consumers(c.run.nodes, fromId);
    if (!outs.length) notes.push(`${nodeName(from)} fed nothing before.`);
    for (const [cid, ck] of outs) c.run.nodes = setWire(c.run.nodes, cid, ck, null);
  }
  const to = c.run.nodes.find(x => x.id === toId)!;
  let inKey = inputByName(to, inWords);
  if (inWords.filter(w => !['the', 'input'].includes(w)).length && !inKey) {
    fail(`${nodeName(to)} has no input “${inWords.join(' ')}”. Its inputs: ${Object.values(to.inputs).map(s => s.label).join(', ')}.`, Object.values(to.inputs).slice(0, 3).map(s => c.text.replace(inWords.join(' '), s.label.toLowerCase())));
  }
  const named = outputByName(from, outName);
  if (outName.length && !named) outName = [];
  const out = pickOut(from, named ?? a.key, inKey ? [to.inputs[inKey].type] : to.type === 'output' ? ['vec3', 'float'] : undefined);
  if (!out) fail(`${nodeName(from)} has no output.`);
  if (!inKey) inKey = to.type === 'output' ? 'color' : pickIn(to, out!.type, { type: out!.type, key: out!.key, node: from });
  if (!inKey) {
    const first = Object.keys(to.inputs)[0];
    if (!first) fail(`${nodeName(to)} has no inputs.`);
    typeCheck(c, from, out!.key, to, first);
  }
  typeCheck(c, from, out!.key, to, inKey!);
  if (makesLoop(c.run.nodes, fromId, toId)) fail(`That would make a loop: ${nodeName(to)} already feeds ${nodeName(from)}.`);
  const prev = to.inputs[inKey!].connection;
  if (prev && prev.nodeId === fromId && prev.outputKey === out!.key && !opts.reconnect) fail(`${nodeName(from)} is already wired to ${nodeName(to)} · ${to.inputs[inKey!].label}.`);
  if (prev && (prev.nodeId !== fromId || prev.outputKey !== out!.key)) notes.push(`Replaces the wire from ${nodeName(c.run.nodes.find(x => x.id === prev.nodeId))}.`);
  if (to.inputs[inKey!].type !== out!.type) notes.push(`${typeWord(out!.type)} → ${typeWord(to.inputs[inKey!].type)} (converted on the wire).`);
  c.run.nodes = setWire(c.run.nodes, toId, inKey!, { id: fromId, key: out!.key });
  c.run.subject = { id: toId };
  step(c, `${opts.reconnect ? 'Reconnect' : 'Connect'} ${nodeName(from)} → ${nodeName(to)} · ${to.inputs[inKey!].label}`, before, notes);
}

function execDisconnect(c: ClauseCtx, rest: Tok[]) {
  const before = c.run.nodes;
  const fromAt = has(rest, 0, ['from']);
  const of = has(rest, 0, ['of']);
  const poss = rest.findIndex(t => t.poss);
  let removed = 0;
  const byId = () => new Map(c.run.nodes.map(nd => [nd.id, nd]));
  if (of >= 0 || poss >= 0) {
    // One input: "the position of the circle", "the circle's position".
    const r = of >= 0 ? ref(c, 'node', rest, of + 1) : ref(c, 'node', rest.slice(0, poss));
    const id = one(c, r, r.text);
    const words = (of >= 0 ? rest.slice(0, of) : rest.slice(poss + 1)).map(t => t.w);
    const nd = byId().get(id)!;
    const key = inputByName(nd, words);
    if (!key) fail(`${nodeName(nd)} has no input “${words.join(' ')}”.`);
    if (!nd.inputs[key!].connection) fail(`${nodeName(nd)} · ${nd.inputs[key!].label} isn’t wired.`);
    c.run.nodes = setWire(c.run.nodes, id, key!, null);
    c.run.subject = { id };
    step(c, `Disconnect ${nodeName(nd)} · ${nd.inputs[key!].label}`, before);
    return;
  }
  const a = ref(c, 'what', fromAt >= 0 ? rest.slice(0, fromAt) : rest);
  if (fromAt >= 0) {
    const b = ref(c, 'from', rest, fromAt + 1);
    const bid = one(c, b, b.text);
    for (const id of a.ids) {
      for (const [k, i] of Object.entries(byId().get(bid)!.inputs)) if (i.connection?.nodeId === id) { c.run.nodes = setWire(c.run.nodes, bid, k, null); removed++; }
    }
    if (!removed) fail(`${a.text} isn’t wired into ${b.text}.`);
    c.run.subject = { id: a.ids[0] };
    step(c, `Disconnect ${a.ids.map(id => nodeName(byId().get(id))).join(', ')} from ${nodeName(byId().get(bid))}`, before);
    return;
  }
  const out = graphOutput(c.run.nodes);
  for (const id of a.ids) {
    const nd = byId().get(id)!;
    if (nd.type === 'output') {
      for (const [k, i] of Object.entries(nd.inputs)) if (i.connection) { c.run.nodes = setWire(c.run.nodes, id, k, null); removed++; }
      continue;
    }
    // The current output: only its wire into the Output. Anything else: every wire out of it.
    const list = a.via === 'output-role' && out ? consumers(c.run.nodes, id).filter(([cid]) => cid === out.id) : consumers(c.run.nodes, id);
    for (const [cid, ck] of list) { c.run.nodes = setWire(c.run.nodes, cid, ck, null); removed++; }
  }
  if (!removed) fail(`Nothing is wired out of ${a.text}.`);
  const first = byId().get(a.ids[0])!;
  c.run.subject = first.type === 'output' ? null : { id: a.ids[0], key: a.key };
  step(c, `Disconnect ${a.via === 'output-role' ? `the current output (${nodeName(first)})` : a.ids.map(id => nodeName(byId().get(id))).join(', ')}`, before);
}

function execInsert(c: ClauseCtx, rest: Tok[]) {
  const k = has(rest, 0, ['between', 'after', 'before']);
  const how = rest[k].w;
  const what = rest.slice(0, k).map(t => t.w).filter(w => !['a', 'an', 'the', 'new', 'some'].includes(w));
  const named = typeByName(what);
  if (!named) fail(`“${what.join(' ')}” isn’t a node.`, typesLike(what).map(l => c.text.replace(what.join(' '), l)));
  const tail = rest.slice(k + 1);
  // The wires it goes on: [source, consumers].
  let src: { id: string; key: string } | null = null;
  let targets: Array<[string, string]> = [];
  const byId = () => new Map(c.run.nodes.map(nd => [nd.id, nd]));
  if (how === 'between') {
    const andAt = has(tail, 0, ['and']);
    if (andAt < 0) fail('Between what and what? “insert X between A and B”.');
    const a = ref(c, 'a', tail.slice(0, andAt));
    const b = ref(c, 'b', tail, andAt + 1);
    let aid = one(c, a, a.text), bid = one(c, b, b.text);
    let wires = Object.entries(byId().get(bid)!.inputs).filter(([, i]) => i.connection?.nodeId === aid);
    if (!wires.length) {
      // Said the other way round ("between the output and the palette").
      const back = Object.entries(byId().get(aid)!.inputs).filter(([, i]) => i.connection?.nodeId === bid);
      if (!back.length) fail(`${a.text} isn’t wired to ${b.text}.`, [`connect ${a.text} to ${b.text}`]);
      [aid, bid] = [bid, aid]; wires = back;
    }
    src = { id: aid, key: wires[0][1].connection!.outputKey };
    targets = wires.filter(([, i]) => i.connection!.outputKey === src!.key).map(([key]) => [bid, key]);
  } else if (how === 'after') {
    const a = ref(c, 'a', tail);
    const aid = one(c, a, a.text);
    const nd = byId().get(aid)!;
    const firstUse = c.run.nodes.flatMap(x => Object.values(x.inputs)).find(i => i.connection?.nodeId === aid)?.connection?.outputKey;
    const o = pickOut(nd, a.key ?? firstUse);
    if (!o) fail(`${nodeName(nd)} has no output.`);
    src = { id: aid, key: o!.key };
    targets = consumers(c.run.nodes, aid, o!.key);
  } else {
    const b = ref(c, 'b', tail);
    const bid = one(c, b, b.text);
    const entry = Object.entries(byId().get(bid)!.inputs).find(([, i]) => i.connection);
    if (!entry) fail(`Nothing is wired into ${b.text}.`, [`connect something to ${b.text}`]);
    src = { id: entry![1].connection!.nodeId, key: entry![1].connection!.outputKey };
    targets = [[bid, entry![0]]];
  }
  const before = c.run.nodes;
  const source = byId().get(src!.id)!;
  const srcType = source.outputs[src!.key]?.type ?? 'float';
  const id = c.run.nextId();
  const def = getNodeDefinition(named!.type)!;
  const at = spot(c.run.nodes, src!.id);
  const nd = n(named!.type, id, at.x, at.y + 60, { ...(named!.params ?? {}), __comment: `${def.label}: inserted by the Do… bar (“${c.text}”).` });
  const inKey = pickIn(nd, srcType, { type: srcType, key: src!.key, node: source });
  if (!inKey) {
    const first = Object.keys(nd.inputs)[0];
    if (!first) fail(`${def.label} has no inputs.`);
    typeCheck(c, source, src!.key, nd, first);
  }
  nd.inputs[inKey!] = { ...nd.inputs[inKey!], connection: { nodeId: src!.id, outputKey: src!.key } };
  const need = targets.map(([tid, tk]) => byId().get(tid)!.inputs[tk].type);
  const out = pickOut(nd, undefined, need.length ? [need[0]] : undefined);
  if (!out) fail(`${def.label} has no output.`);
  for (const [tid, tk] of targets) {
    const t = byId().get(tid)!;
    if (!typesCompatible(out!.type, t.inputs[tk].type)) typeCheck(c, nd, out!.key, t, tk);
  }
  c.run.nodes = place(c, [nd]);
  for (const [tid, tk] of targets) c.run.nodes = setWire(c.run.nodes, tid, tk, { id, key: out!.key });
  c.run.subject = { id, key: out!.key };
  const label = how === 'between' ? `Insert ${def.label} between ${nodeName(source)} and ${nodeName(byId().get(targets[0]?.[0] ?? ''))}`
    : `Insert ${def.label} ${how} ${how === 'after' ? nodeName(source) : nodeName(byId().get(targets[0][0]))}`;
  step(c, label, before, targets.length ? [] : [`${nodeName(source)} fed nothing: ${def.label} reads it, and feeds nothing yet.`]);
}

const COMBINE_OPS: Record<string, { op: string; label: string }> = {
  multiply: { op: 'multiply', label: 'Multiply' }, times: { op: 'multiply', label: 'Multiply' }, add: { op: 'add', label: 'Add' },
  subtract: { op: 'subtract', label: 'Subtract' }, divide: { op: 'divide', label: 'Divide' }, mix: { op: 'mix', label: 'Mix' }, blend: { op: 'mix', label: 'Mix' },
  screen: { op: 'screen', label: 'Screen' }, overlay: { op: 'overlay', label: 'Overlay' }, union: { op: 'sdfUnion', label: 'Union' }, merge: { op: 'sdfUnion', label: 'Union' },
  intersect: { op: 'sdfIntersect', label: 'Intersect' }, cut: { op: 'sdfSubtract', label: 'Subtract (SDF)' },
};

function execCombine(c: ClauseCtx, word: string, rest: Tok[]) {
  const spec = COMBINE_OPS[word] ?? COMBINE_OPS.multiply;
  // Split into the two operands; the base is the one the result replaces.
  const seps = word === 'add' ? ['to', 'with', 'and', 'onto'] : word === 'subtract' || word === 'cut' ? ['from', 'and', 'with'] : word === 'screen' || word === 'overlay' ? ['over', 'onto', 'on', 'with', 'and'] : ['by', 'with', 'and', 'into'];
  const k = has(rest, 0, seps);
  if (k < 0) fail(`${spec.label} what with what? “${word} A ${seps[0]} B”.`);
  const sep = rest[k].w;
  const left = rest.slice(0, k);
  let right = rest.slice(k + 1);
  // "mix A with B by 0.3": the amount.
  let amount: number | null = null;
  const byAt = has(right, 0, ['by']);
  if (spec.op === 'mix' && byAt >= 0 && isNumberTok(right[byAt + 1])) { amount = numberOf(right[byAt + 1].w); right = right.slice(0, byAt); }
  const a = valueEnd(c, ref(c, 'a', left), 'The first value');
  // A number or colour as the second value.
  const lit = right.filter(t => !['the', 'a', 'an'].includes(t.w));
  const litNum = lit.length === 1 ? numberOf(lit[0].w) : null;
  const litCol = lit.length === 1 && !litNum ? colourOf(lit[0].w) : null;
  const before = c.run.nodes;
  const id = c.run.nextId();
  const at = spot(c.run.nodes, a.node.id);
  if (litNum !== null || litCol) {
    if (!['multiply', 'add', 'subtract', 'divide'].includes(spec.op)) fail(`${spec.label} needs two values, not a number.`);
    const sym = { multiply: '*', add: '+', subtract: '-', divide: '/' }[spec.op as 'multiply'];
    const t = (litCol && a.type === 'float' ? 'vec3' : a.type) as 'float' | 'vec2' | 'vec3';
    if (!['float', 'vec2', 'vec3'].includes(t)) fail(`${nodeName(a.node)} gives ${typeWord(a.type)}; numbers combine with floats, vec2 and vec3.`);
    const lv = litCol ? `vec3(${litCol.map(x => x.toFixed(3)).join(', ')})` : Number.isInteger(litNum) ? `${litNum}.0` : String(litNum);
    const e = exprBlock(id, at.x, at.y, {
      label: `${spec.label} by ${litCol ? lit[0].w : litNum}`, inputs: [{ name: 'a', type: a.type as 'float' }], result: `a ${sym} ${lv}`, outputType: t, wires: { a: [a.node.id, a.key] },
      comment: `${spec.label} (Expression Block): ${nodeName(a.node)} ${sym} ${litCol ? lit[0].w : litNum}.\nWhy: the Do… bar (“${c.text}”).`,
    });
    c.run.nodes = place(c, [e]);
    takeOver(c, { id: a.node.id, key: a.key }, { id, key: 'result', type: t });
    c.run.subject = { id, key: 'result' };
    showIfEmpty(c, { id, key: 'result', type: t });
    step(c, `${spec.label} ${nodeName(a.node)} by ${litCol ? lit[0].w : litNum}`, before);
    return;
  }
  const b = valueEnd(c, ref(c, 'b', right), 'The second value', ['add', 'mix', 'screen', 'overlay', 'subtract'].includes(spec.op) && a.type !== 'float' ? [a.type] : undefined);
  if (a.node.id === b.node.id && a.key === b.key) fail(`That is ${nodeName(a.node)} with itself.`);
  // "add A to B", "subtract A from B", "screen A over B": B is the base.
  const swap = (word === 'add' && (sep === 'to' || sep === 'onto')) || ((word === 'subtract' || word === 'cut') && sep === 'from') || ((word === 'screen' || word === 'overlay') && ['over', 'onto', 'on'].includes(sep));
  const [base, other] = swap ? [b, a] : [a, b];
  const rank = (t: string) => TYPE_RANK[t] ?? 0;
  let node: GraphNode, inA: string, inB: string, outKey: string, outType: string;
  if (spec.op === 'sdfUnion' || spec.op === 'sdfIntersect' || spec.op === 'sdfSubtract') {
    for (const v of [base, other]) if (v.type !== 'float') fail(`Type check: ${spec.label} takes two distances (floats); ${nodeName(v.node)} gives ${typeWord(v.type)}.`, [c.text.replace(word, 'multiply')]);
    node = n(spec.op, id, at.x, at.y, word === 'blend' ? { k: 0.1 } : {});
    inA = 'a'; inB = 'b'; outKey = 'dist'; outType = 'float';
  } else if (spec.op === 'screen' || spec.op === 'overlay') {
    for (const v of [base, other]) if (!typesCompatible(v.type, 'vec3')) fail(`Type check: ${spec.label} blends colours; ${nodeName(v.node)} gives ${typeWord(v.type)}.`);
    node = n('blendModes', id, at.x, at.y, { mode: spec.op });
    inA = 'base'; inB = 'blend'; outKey = 'result'; outType = 'vec3';
  } else {
    // Two distances to "blend" make a smooth union; else the wider of the two types.
    if (word === 'blend' && base.type === 'float' && other.type === 'float') { execCombine(c, 'union', rest); c.steps[c.steps.length - 1].label = c.steps[c.steps.length - 1].label.replace('Union', 'Smooth union'); return; }
    const t = rank(base.type) >= rank(other.type) ? base.type : other.type;
    if (!(t in TYPE_RANK)) fail(`Type check: ${nodeName(base.node)} gives ${typeWord(base.type)}, which doesn’t combine with numbers or colours.`);
    for (const v of [base, other]) if (!typesCompatible(v.type, t)) fail(`Type check: ${nodeName(v.node)} gives ${typeWord(v.type)}, which can’t become ${typeWord(t)}.`, v.type === 'vec2' ? [`create a length, connect ${refText(v.node, c.run.nodes)} to it, then ${c.text.replace(refText(v.node, c.run.nodes).replace(/^the /, ''), 'length')}`] : []);
    node = mathNode(spec.op, id, at.x, at.y, t, spec.op === 'mix' ? { t: amount ?? 0.5 } : {});
    inA = 'a'; inB = 'b'; outKey = VECTORIZABLE_NODES[spec.op]?.primaryOutput || 'result'; outType = t;
  }
  if (spec.op === 'mix' && amount !== null && node.type !== 'mix') node.params.t = amount;
  node.params.__comment = `${spec.label}: ${nodeName(base.node)} ${spec.label.toLowerCase()} ${nodeName(other.node)}.\nWhy: the Do… bar (“${c.text}”); it takes the place of ${nodeName(base.node)}.`;
  node.inputs[inA] = { ...node.inputs[inA], connection: { nodeId: base.node.id, outputKey: base.key } };
  node.inputs[inB] = { ...node.inputs[inB], connection: { nodeId: other.node.id, outputKey: other.key } };
  c.run.nodes = place(c, [node]);
  const moved = takeOver(c, { id: base.node.id, key: base.key }, { id, key: outKey, type: outType });
  c.run.subject = { id, key: outKey };
  showIfEmpty(c, { id, key: outKey, type: outType });
  step(c, `${spec.label} ${nodeName(base.node)} with ${nodeName(other.node)}`, before, moved ? [`What read ${nodeName(base.node)} now reads the ${spec.label.toLowerCase()}.`] : []);
}

function execOutput(c: ClauseCtx, rest: Tok[]) {
  const r = ref(c, 'what', rest.filter(t => !(t.w === 'to' || t.w === 'on')).filter((t, i, arr) => !(t.w === 'the' && arr[i + 1]?.w === 'output' && i > 0)));
  if (r.via === 'output-node') fail('That is the Output itself: name what to show.', ['output it']);
  const id = one(c, r, r.text);
  const before = c.run.nodes;
  const nd = c.run.nodes.find(x => x.id === id)!;
  let out = graphOutput(c.run.nodes);
  if (!out) {
    if (!c.run.topLevel) fail('There is no Output inside a group: wire it to a group output.');
    const p = spot(c.run.nodes, id);
    const o = n('output', c.run.nextId(), p.x, p.y, { __comment: 'Output: what the canvas shows. Added by the Do… bar.' });
    c.run.nodes = place(c, [o]);
    out = c.run.nodes.find(x => x.id === o.id)!;
  }
  const o = pickOut(nd, r.key, ['vec3', 'float', 'vec2', 'vec4']);
  if (!o) fail(`${nodeName(nd)} has no output to show.`);
  typeCheck(c, nd, o!.key, out!, 'color');
  c.run.nodes = setWire(c.run.nodes, out!.id, 'color', { id, key: o!.key });
  c.run.subject = { id, key: o!.key };
  step(c, `Output ${nodeName(nd)} · ${nd.outputs[o!.key].label}`, before);
}

function switchCtx(nodes: GraphNode[]): SwitchContext {
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  return { sourceType: conn => byId.get(conn.nodeId)?.outputs[conn.outputKey]?.type };
}

function execReplace(c: ClauseCtx, rest: Tok[]) {
  const k = has(rest, 0, ['with', 'to', 'into', 'for', 'by']);
  if (k < 0) fail('Switch it to what? “switch the noise to voronoi”.');
  const r = ref(c, 'what', rest.slice(0, k));
  const what = rest.slice(k + 1).map(t => t.w).filter(w => !['a', 'an', 'the', 'one', 'node'].includes(w));
  const named = typeByName(what) ?? typeByName(what.slice(0, 1));
  const ids = r.ids;
  if (!named) fail(`“${what.join(' ')}” isn’t a node.`, typesLike(what).map(l => c.text.replace(what.join(' '), l)));
  const before = c.run.nodes;
  for (const id of ids) {
    const old = c.run.nodes.find(x => x.id === id)!;
    if (old.type === named!.type && JSON.stringify(named!.params ?? {}) === JSON.stringify(Object.fromEntries(Object.keys(named!.params ?? {}).map(p => [p, old.params[p]])))) fail(`${nodeName(old)} is already a ${getNodeDefinition(named!.type)?.label}.`);
    const plan = old.type === named!.type ? null : planSwitch(c.run.nodes, old, named!.type, switchCtx(c.run.nodes));
    if (old.type !== named!.type) {
      if (!plan) fail(`Can’t switch ${nodeName(old)} to that.`);
      if (!plan!.ok) {
        const opts = switchOptions(c.run.nodes, old, switchCtx(c.run.nodes)).flatMap(g => g.options).filter(o => o.ok).slice(0, 3);
        fail(`Can’t switch ${nodeName(old)} to ${plan!.label}: ${plan!.reason}.`, opts.map(o => `switch ${refText(old, c.run.nodes)} to ${o.label.toLowerCase()}`));
      }
      c.run.nodes = applySwitchToList(c.run.nodes, plan!);
    }
    if (named!.params) c.run.nodes = c.run.nodes.map(x => (x.id === id ? { ...x, params: { ...x.params, ...named!.params } } : x));
  }
  c.run.subject = { id: ids[0] };
  step(c, `Switch ${ids.map(id => nodeName(before.find(x => x.id === id))).join(', ')} to ${getNodeDefinition(named!.type)?.label ?? named!.type}${named!.shape && named!.params ? ` (${named!.shape})` : ''}`, before);
}

function execDelete(c: ClauseCtx, rest: Tok[]) {
  const ids = refs(c, 'what', rest);
  const before = c.run.nodes;
  const gone = new Set(ids);
  c.run.nodes = c.run.nodes.filter(nd => !gone.has(nd.id)).map(nd => {
    if (!Object.values(nd.inputs).some(i => i.connection && gone.has(i.connection.nodeId))) return nd;
    return { ...nd, inputs: Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection && gone.has(i.connection.nodeId) ? { ...i, connection: undefined } : i])) };
  });
  if (c.run.subject && gone.has(c.run.subject.id)) c.run.subject = null;
  c.run.selected = c.run.selected.filter(id => !gone.has(id));
  step(c, `Delete ${ids.map(id => nodeName(before.find(x => x.id === id))).join(', ')}`, before);
}

function execRename(c: ClauseCtx, rest: Tok[]) {
  const k = has(rest, 0, ['to', 'as']);
  const quoted = rest.findIndex(t => t.q);
  const end = k >= 0 ? k : quoted >= 0 ? quoted : -1;
  if (end < 0) fail('Rename it to what? “rename the glow to "Halo"”.');
  const r = ref(c, 'what', rest.slice(0, end));
  const id = one(c, r, r.text);
  const nameToks = rest.slice(k >= 0 ? k + 1 : quoted);
  const name = nameToks.find(t => t.q)?.w ?? nameToks.map(t => t.w).join(' ').replace(/^\w/, ch => ch.toUpperCase());
  if (!name.trim()) fail('The new name is empty.');
  const before = c.run.nodes;
  c.run.nodes = c.run.nodes.map(nd => (nd.id === id ? { ...nd, params: { ...nd.params, label: name.trim() } } : nd));
  c.run.subject = { id };
  step(c, `Rename ${nodeName(before.find(x => x.id === id))} to “${name.trim()}”`, before);
}

function execDuplicate(c: ClauseCtx, rest: Tok[]) {
  const ids = refs(c, 'what', rest);
  const before = c.run.nodes;
  let last: string | null = null;
  for (const id of ids) {
    const nd = c.run.nodes.find(x => x.id === id)!;
    if (nd.type === 'output') fail('The Output can’t be duplicated.');
    const copy: GraphNode = { ...JSON.parse(JSON.stringify(nd)), id: c.run.nextId(), position: { x: nd.position.x + 40, y: nd.position.y + c.run.heightOf(nd) + 60 } };
    if (typeof copy.params.label === 'string') copy.params.label = `${copy.params.label} copy`;
    c.run.nodes = place(c, [copy]);
    last = copy.id;
  }
  c.run.subject = last ? { id: last } : c.run.subject;
  step(c, `Duplicate ${ids.map(id => nodeName(before.find(x => x.id === id))).join(', ')}`, before, ['The copy reads the same inputs; nothing reads it yet.']);
}

/** "the glow falloff", "falloff of the glow", "the glow's falloff", "the falloff" → node and setting words. */
function paramTarget(c: ClauseCtx, toks: Tok[]): { id: string; words: string[] } {
  const of = has(toks, 0, ['of']);
  const poss = toks.findIndex(t => t.poss);
  if (of >= 0) { const r = ref(c, 'node', toks, of + 1); return { id: one(c, r, r.text), words: toks.slice(0, of).map(t => t.w) }; }
  if (poss >= 0) { const r = ref(c, 'node', toks.slice(0, poss)); return { id: one(c, r, r.text), words: toks.slice(poss + 1).map(t => t.w) }; }
  const r = readPicked(c, 'node', toks);
  if (r.ok && r.used < toks.length) {
    const id = r.via === 'output-node' ? shownNode(c.run.nodes)?.id ?? r.ids[0] : one(c, r, r.text);
    return { id, words: toks.slice(r.used).map(t => t.w) };
  }
  if (r.ok) return { id: one(c, r, r.text), words: [] };
  if (!r.ok && r.candidates) ref(c, 'node', toks);
  // Not a node: the words are a setting of "it" or the selection, if it has one; else the reference was wrong.
  const fallbackId = c.run.subject?.id ?? c.run.selected[0];
  const fallbackNode = fallbackId ? c.run.nodes.find(x => x.id === fallbackId) : undefined;
  if (!fallbackNode || !findParam(fallbackNode, toks.map(t => t.w))) ref(c, 'node', toks);
  // Just a setting: on "it", else the selection.
  const id = c.run.subject?.id ?? c.run.selected[0];
  if (!id) fail('Which node? Name it (“set the glow falloff to 8”) or select one.');
  return { id: id!, words: toks.map(t => t.w) };
}

function execSet(c: ClauseCtx, rest: Tok[]) {
  // The value comes after the last "to" / "=" / "at".
  let k = -1;
  for (let i = rest.length - 1; i >= 0; i--) if (!rest[i].q && ['to', '=', 'at', 'into'].includes(rest[i].w)) { k = i; break; }
  if (k < 0) fail('Set it to what? “set the glow falloff to 8”.');
  const t = paramTarget(c, rest.slice(0, k));
  const nd = c.run.nodes.find(x => x.id === t.id)!;
  let p = findParam(nd, t.words);
  if (!t.words.length) { const rp = roleParam(nd, 'size'); p = rp ? paramInfo(nd, rp.key) : null; }
  if (!p) {
    const def = getNodeDefinitionFor(nd);
    const labels = Object.values(def?.paramDefs ?? {}).filter(pd => pd.type === 'float' || pd.type === 'int').slice(0, 3).map(pd => pd.label.toLowerCase());
    fail(`${nodeName(nd)} has no setting “${t.words.join(' ')}”.`, labels.map(l => c.text.replace(t.words.join(' ') || 'to', t.words.length ? l : `${l} to`)));
  }
  const value = valueFor(p!, rest.slice(k + 1));
  const before = c.run.nodes;
  c.run.nodes = c.run.nodes.map(x => (x.id === t.id ? { ...x, params: { ...x.params, [p!.key]: value } } : x));
  const notes: string[] = [];
  const wired = nd.inputs[p!.key]?.connection;
  if (wired) notes.push(`${p!.label} is wired from ${nodeName(c.run.nodes.find(x => x.id === wired.nodeId))}, so the wire still sets it.`);
  c.run.subject = { id: t.id };
  step(c, `Set ${nodeName(nd)} · ${p!.label} to ${fmtValue(value)}`, before, notes);
}

function execAdjust(c: ClauseCtx, word: string, rest: Tok[]) {
  const before = c.run.nodes;
  let id: string, key: string, invert = false, label: string;
  let factor: number | null = null, delta: number | null = null;
  let dir: 1 | -1 = 1;
  if (word === 'make') {
    // make <ref> [setting] [much | a bit] <relative word> [by <n>]
    const relAt = rest.findIndex(t => !t.q && t.w in RELATIVE_WORDS);
    const rel = RELATIVE_WORDS[rest[relAt].w];
    dir = rel.dir;
    const head = rest.slice(0, relAt).filter(t => !['much', 'a', 'bit', 'little', 'slightly', 'lot', 'far', 'even', 'way'].includes(t.w));
    const mods = rest.slice(0, relAt).map(t => t.w);
    const step_ = mods.includes('much') || mods.includes('lot') || mods.includes('far') || mods.includes('way') ? RELATIVE_STEP.much : mods.includes('bit') || mods.includes('slightly') || mods.includes('little') ? RELATIVE_STEP.bit : RELATIVE_STEP.normal;
    const t = paramTarget(c, head);
    id = t.id;
    const nd = c.run.nodes.find(x => x.id === id)!;
    if (t.words.length) {
      const p = findParam(nd, t.words);
      if (!p || p.kind !== 'number') fail(`${nodeName(nd)} has no number setting “${t.words.join(' ')}”.`);
      key = p!.key;
    } else {
      const rp = roleParam(nd, rel.role);
      if (!rp) fail(`${nodeName(nd)} has nothing to make ${rest[relAt].w}: name the setting (“increase the … of ${refText(nd, c.run.nodes)}”).`);
      key = rp!.key; invert = rp!.invert;
    }
    const by = has(rest, relAt, ['by']);
    if (by >= 0 && isNumberTok(rest[by + 1])) delta = numberOf(rest[by + 1].w)! * (invert ? -dir : dir);
    else factor = (dir === 1) !== invert ? step_ : 1 / step_;
  } else {
    dir = ['increase', 'raise'].includes(word) ? 1 : -1;
    const by = has(rest, 0, ['by']);
    const head = by >= 0 ? rest.slice(0, by) : rest;
    const t = paramTarget(c, head);
    id = t.id;
    const nd = c.run.nodes.find(x => x.id === id)!;
    const p = t.words.length ? findParam(nd, t.words) : (() => { const rp = roleParam(nd, 'size'); return rp ? paramInfo(nd, rp.key) : null; })();
    if (!p || p.kind !== 'number') fail(`${nodeName(nd)} has no number setting “${t.words.join(' ')}”.`);
    key = p!.key;
    if (word === 'double') factor = 2; else if (word === 'halve') factor = 0.5; else if (word === 'triple') factor = 3;
    else if (by >= 0 && isNumberTok(rest[by + 1])) delta = numberOf(rest[by + 1].w)! * dir;
    else factor = dir === 1 ? RELATIVE_STEP.normal : 1 / RELATIVE_STEP.normal;
  }
  const nd = c.run.nodes.find(x => x.id === id)!;
  const info = paramInfo(nd, key)!;
  label = info.label;
  const cur = Number(currentParam(nd, key) ?? 0);
  let next = delta !== null ? cur + delta : cur === 0 ? 0.1 * Math.sign(factor! - 1 || 1) : cur * factor!;
  if (info.integer) next = Math.max(1, Math.round(next === cur ? cur + Math.sign(next - cur || dir) : next));
  next = Math.round(next * 10000) / 10000;
  c.run.nodes = c.run.nodes.map(x => (x.id === id ? { ...x, params: { ...x.params, [key]: next } } : x));
  c.run.subject = { id };
  const wired = nd.inputs[key]?.connection;
  step(c, `${next > cur ? 'Raise' : 'Lower'} ${nodeName(nd)} · ${label} ${fmtValue(cur)} → ${fmtValue(next)}`, before,
    [...(invert ? [`${label} works the other way on ${nodeName(nd)}: lower is ${dir === 1 ? 'wider' : 'tighter'}.`] : []), ...(wired ? [`${label} is wired, so the wire still sets it.`] : [])]);
}

function execGroup(c: ClauseCtx, rest: Tok[]) {
  if (!c.last) fail('Group goes last in a sentence.', [c.text]);
  const asAt = has(rest, 0, ['as', 'called', 'named']);
  const ids = refs(c, 'what', asAt >= 0 ? rest.slice(0, asAt) : rest);
  const byId = new Map(c.run.nodes.map(nd => [nd.id, nd]));
  if (ids.some(id => byId.get(id)?.type === 'output')) fail('The Output can’t go in a group.');
  const name = asAt >= 0 ? (rest.slice(asAt + 1).find(t => t.q)?.w ?? rest.slice(asAt + 1).map(t => t.w).join(' ')) : undefined;
  c.run.group = { ids, label: name || undefined };
  c.steps.push({ clause: c.index, label: `Group ${ids.map(id => nodeName(byId.get(id))).join(', ')}${name ? ` as “${name}”` : ''}`, adds: ['Group'], removes: [], wires: [], unwires: [], params: [], notes: ['Wires into and out of them become the group’s inputs and outputs.'], touched: ids });
}

function execSelect(c: ClauseCtx, rest: Tok[]) {
  const ids = refs(c, 'what', rest);
  const byId = new Map(c.run.nodes.map(nd => [nd.id, nd]));
  c.run.select = ids;
  c.run.selected = ids;
  c.run.subject = { id: ids[0] };
  c.steps.push({ clause: c.index, label: `Select ${ids.map(id => nodeName(byId.get(id))).join(', ')}`, adds: [], removes: [], wires: [], unwires: [], params: [], notes: [], touched: ids });
}

/** "the length of the space", "the angle", "time", "noise", "<ref>": a float to run a palette along. */
function driver(c: ClauseCtx, toks: Tok[], near: { x: number; y: number }): { added: GraphNode[]; wire: [string, string]; label: string } {
  const words = toks.map(t => t.w).filter(w => !['the', 'a', 'an'].includes(w));
  const uv = () => n('uv', c.run.nextId(), near.x - 840, near.y + 200, { __comment: 'UV: the position of each pixel, (0, 0) in the middle.\nWhy: the palette runs along it (Do… bar).' });
  const w0 = words[0] ?? '';
  const spaceWords = ['space', 'uv', 'uvs', 'coordinates', 'centre', 'center', 'middle'];
  if (['length', 'distance', 'radius'].includes(w0) && (words.length === 1 || words.slice(1).some(w => spaceWords.includes(w)))) {
    const u = uv();
    const len = n('length', c.run.nextId(), near.x - 420, near.y + 200, { __comment: 'Length: how far each pixel is from the centre.\nWhy: the palette runs along the distance (Do… bar).' }, { input: [u.id, 'uv'] });
    return { added: [u, len], wire: [len.id, 'output'], label: 'the length of the space' };
  }
  if (w0 === 'angle' || w0 === 'direction') {
    const u = uv();
    const e = exprBlock(c.run.nextId(), near.x - 420, near.y + 200, { label: 'Angle', inputs: [{ name: 'p', type: 'vec2' }], result: 'atan(p.y, p.x) / 6.28318 + 0.5', outputType: 'float', wires: { p: [u.id, 'uv'] }, comment: 'Angle (Expression Block): the angle round the centre, 0…1.\nWhy: the palette runs round the circle (Do… bar).' });
    return { added: [u, e], wire: [e.id, 'result'], label: 'the angle' };
  }
  if ((w0 === 'x' || w0 === 'y' || w0 === 'height' || w0 === 'width') && words.slice(1).every(w => ['of', ...spaceWords].includes(w))) {
    const axis = w0 === 'y' || w0 === 'height' ? 'y' : 'x';
    const u = uv();
    const e = exprBlock(c.run.nextId(), near.x - 420, near.y + 200, { label: `${axis.toUpperCase()} of the space`, inputs: [{ name: 'p', type: 'vec2' }], result: `p.${axis} + 0.5`, outputType: 'float', wires: { p: [u.id, 'uv'] }, comment: `${axis.toUpperCase()} (Expression Block): the ${axis === 'x' ? 'horizontal' : 'vertical'} position.\nWhy: the palette runs along it (Do… bar).` });
    return { added: [u, e], wire: [e.id, 'result'], label: `the ${axis} of the space` };
  }
  if (w0 === 'time' && words.length === 1) {
    const t = n('time', c.run.nextId(), near.x - 420, near.y + 200, { __comment: 'Time: seconds since start.\nWhy: the palette cycles with time (Do… bar).' });
    return { added: [t], wire: [t.id, 'time'], label: 'time' };
  }
  if (w0 === 'noise' && words.length === 1 && toks[0]?.w !== 'the') {
    const u = uv();
    const f = n('fbm', c.run.nextId(), near.x - 420, near.y + 200, { __comment: 'Fractal Noise: soft clouds.\nWhy: the palette runs along the noise (Do… bar).' }, { uv: [u.id, 'uv'] });
    return { added: [u, f], wire: [f.id, 'value'], label: 'noise' };
  }
  const r = valueEnd(c, ref(c, 'by', toks), 'The driver', ['float']);
  if (r.type === 'float') return { added: [], wire: [r.node.id, r.key], label: nodeName(r.node) };
  if (r.type === 'vec2') {
    const len = n('length', c.run.nextId(), near.x - 420, near.y + 200, {}, { input: [r.node.id, r.key] });
    return { added: [len], wire: [len.id, 'output'], label: `the length of ${nodeName(r.node)}` };
  }
  if (r.type === 'vec3') {
    const lum = n('luminance', c.run.nextId(), near.x - 420, near.y + 200, {}, { color: [r.node.id, r.key] });
    return { added: [lum], wire: [lum.id, 'result'], label: `the brightness of ${nodeName(r.node)}` };
  }
  return fail(`Type check: a palette runs along a number; ${nodeName(r.node)} gives ${typeWord(r.type)}.`);
}

function execColour(c: ClauseCtx, rest: Tok[]) {
  // colour <ref> [with a palette] [by <driver>]
  const withAt = has(rest, 0, ['with', 'using', 'through']);
  const byAt = has(rest, 0, ['by', 'along']);
  const refEnd = [withAt, byAt].filter(k => k >= 0).reduce((m, k) => Math.min(m, k), rest.length);
  const refToks = rest.slice(0, refEnd);
  const target = refToks.length ? valueEnd(c, ref(c, 'what', refToks), 'What to colour') : c.run.subject ? valueEnd(c, { ok: true, ids: [c.run.subject.id], key: c.run.subject.key, used: 0, text: 'it' }, 'it') : fail('Colour what? “colour it with a palette”.');
  const before = c.run.nodes;
  const at = spot(c.run.nodes, target.node.id);
  const pal = n('palette', c.run.nextId(), at.x, at.y + 200, { preset: '0' });
  const added: GraphNode[] = [];
  let driverLabel: string;
  let result: { id: string; key: string; type: string };
  if (byAt >= 0) {
    const d = driver(c, rest.slice(byAt + 1), { x: at.x, y: at.y });
    added.push(...d.added);
    driverLabel = d.label;
    pal.inputs.value = { ...pal.inputs.value, connection: { nodeId: d.wire[0], outputKey: d.wire[1] } };
    pal.params.__comment = `Palette: colour along ${d.label}.\nWhy: the Do… bar (“${c.text}”).`;
    added.push(pal);
    if (!typesCompatible(target.type, 'vec3')) fail(`Type check: ${nodeName(target.node)} gives ${typeWord(target.type)}; it multiplies a colour.`);
    const m = mathNode('multiply', c.run.nextId(), at.x + 420, at.y, 'vec3', { __comment: `Multiply: the palette × ${nodeName(target.node)}, so the colour shows where it is bright.\nWhy: the Do… bar (“${c.text}”).` });
    m.inputs.a = { ...m.inputs.a, connection: { nodeId: pal.id, outputKey: 'color' } };
    m.inputs.b = { ...m.inputs.b, connection: { nodeId: target.node.id, outputKey: target.key } };
    added.push(m);
    result = { id: m.id, key: 'result', type: 'vec3' };
  } else {
    let src: [string, string] = [target.node.id, target.key];
    if (target.type === 'vec3' || target.type === 'vec4') {
      const lum = n('luminance', c.run.nextId(), at.x, at.y + 200, { __comment: 'Luminance: the brightness of the colour.\nWhy: the palette recolours by brightness (Do… bar).' }, { color: src });
      added.push(lum); src = [lum.id, 'result'];
    } else if (target.type === 'vec2') {
      const len = n('length', c.run.nextId(), at.x, at.y + 200, {}, { input: src });
      added.push(len); src = [len.id, 'output'];
    } else if (target.type !== 'float') fail(`Type check: a palette runs along a number; ${nodeName(target.node)} gives ${typeWord(target.type)}.`);
    driverLabel = nodeName(target.node);
    pal.inputs.value = { ...pal.inputs.value, connection: { nodeId: src[0], outputKey: src[1] } };
    pal.params.__comment = `Palette: ${nodeName(target.node)} as colour.\nWhy: the Do… bar (“${c.text}”).`;
    added.push(pal);
    result = { id: pal.id, key: 'color', type: 'vec3' };
  }
  c.run.nodes = place(c, added);
  const moved = takeOver(c, { id: target.node.id, key: target.key }, result);
  c.run.subject = { id: result.id, key: result.key };
  showIfEmpty(c, result);
  step(c, byAt >= 0 ? `Colour ${nodeName(target.node)} with a palette by ${driverLabel}` : `Colour ${driverLabel} with a palette`, before, moved ? [`What read ${nodeName(target.node)} now reads the colour.`] : []);
}

function execClause(c: ClauseCtx, toks: Tok[]): string {
  const k = classify(toks);
  switch (k.verb) {
    case 'build': execBuild(c, toks); break;
    case 'create': execCreate(c, k.rest); break;
    case 'connect': execConnect(c, k.rest); break;
    case 'reconnect': execConnect(c, k.rest, { reconnect: true }); break;
    case 'disconnect': execDisconnect(c, k.rest); break;
    case 'insert': execInsert(c, k.rest); break;
    case 'combine': execCombine(c, k.word!, k.rest); break;
    case 'output': execOutput(c, k.rest); break;
    case 'replace': execReplace(c, k.rest); break;
    case 'delete': execDelete(c, k.rest); break;
    case 'rename': execRename(c, k.rest); break;
    case 'duplicate': execDuplicate(c, k.rest); break;
    case 'set': execSet(c, k.rest); break;
    case 'adjust': execAdjust(c, k.word!, k.rest); break;
    case 'group': execGroup(c, k.rest); break;
    case 'select': execSelect(c, k.rest); break;
    case 'colour': execColour(c, k.rest); break;
    default: fail(`“${k.word}” isn’t handled yet.`);
  }
  return k.verb;
}

// ── The sentence ────────────────────────────────────────────────────────────

/** Split a sentence into its clauses' tokens. */
export function clausesOf(text: string): Tok[][] {
  const toks = lex(text);
  const isHead = (ts: Tok[], i: number) => headAt(ts, i);
  return splitClauses(toks, (ts, i) => (ts[i - 1]?.w === 'and' ? editVerbAt(ts, i) : isHead(ts, i)));
}

/**
 * Read and run a sentence on the level `nodes` (pure). The preview calls it with stand-in ids;
 * the store calls it again with real ones and applies `nodes` (and `group`) as one undo step.
 */
export function execCommand(text: string, nodes: GraphNode[], opts: CommandOptions): CommandPlan {
  const trimmed = text.trim();
  let k = 0;
  const run: Run = {
    nodes, subject: null, selected: [...opts.selected], initial: [...opts.selected], select: null,
    nextId: opts.nextId ?? (() => `do-preview-${++k}`), topLevel: opts.topLevel ?? true, heightOf: opts.heightOf ?? cardHeight, picks: opts.picks ?? {},
  };
  const plan: CommandPlan = { text: trimmed, clauses: [], steps: [], nodes, select: [], ok: false, changed: false };
  if (!trimmed) return plan;
  const whole = parseDo(trimmed, { nodes, selected: opts.selected });
  if (whole.intent) return { ...plan, intent: whole.intent };
  const clauseToks = clausesOf(trimmed);
  // Build phrases only (or a taught phrase): the phrase language, whole, as before.
  const hasDefiniteRef = (ts: Tok[]) => ts.some((t, i) => (t.q || t.w === 'the') && !TARGET_PHRASES.some(p => p.split(' ').every((w, j) => ts[i + j]?.w === w))
    && !PLACE_WORDS.some(p => p.split(' ').every((w, j) => ts[i + 1 + j]?.w === w)) && readRef(ts, i, { nodes, selected: opts.selected, subject: null }).ok);
  const allBuild = clauseToks.every(ts => classify(ts).verb === 'build' && !hasDefiniteRef(ts));
  if (matchTaught(trimmed) || allBuild) {
    plan.phrase = true;
    const c: ClauseCtx = { run, index: 0, last: true, steps: [], text: trimmed };
    const clause: CmdClause = { index: 0, text: trimmed, verb: 'build', status: 'ok', steps: c.steps };
    try {
      if (whole.problem && whole.steps.length) fail(whole.problem);
      if (!whole.steps.length) {
        const sug = whole.unknown.flatMap(w => didYouMean(w).map(m => trimmed.replace(w, m)));
        fail(whole.unknown.length ? `Didn’t understand “${whole.unknown.join(' ')}”.` : whole.problem ?? 'No shape, action or verb in that.', sug);
      }
      const notes = whole.unknown.length ? [`Skipped “${whole.unknown.join(' ')}”.`] : [];
      const res = runDoPlan(nodes, whole, run.nextId, { topLevel: run.topLevel, heightOf: run.heightOf, onStep: (i, label, b, a) => c.steps.push({ clause: 0, label, notes: i === 0 ? notes : [], ...diffNodes(b, a) }) });
      run.nodes = res.nodes;
      if (res.select) run.select = [res.select];
    } catch (e) {
      if (!(e instanceof ClauseError)) throw e;
      Object.assign(clause, { status: 'error', message: e.message, suggestions: e.suggestions });
    }
    plan.clauses = [clause];
  } else {
    clauseToks.forEach((ts, index) => {
      const ctext = untok(ts);
      const outputLater = clauseToks.slice(index + 1).some(t2 => ['output', 'connect', 'reconnect'].includes(classify(t2).verb));
      const c: ClauseCtx = { run, index, last: index === clauseToks.length - 1, steps: [], text: ctext, outputLater };
      const clause: CmdClause = { index, text: ctext, verb: classify(ts).verb, status: 'ok', steps: c.steps };
      const saved = { nodes: run.nodes, subject: run.subject, selected: run.selected, select: run.select, group: run.group };
      try {
        clause.verb = execClause(c, ts);
        run.broken = false;
      } catch (e) {
        if (!(e instanceof ClauseError)) throw e;
        Object.assign(run, saved);
        run.broken = true;
        c.steps.length = 0;
        Object.assign(clause, { status: e.pick ? 'pick' : 'error', message: e.message, suggestions: e.suggestions.filter((s, i, a) => s && a.indexOf(s) === i).slice(0, 4), pick: e.pick });
      }
      plan.clauses.push(clause);
    });
  }
  plan.steps = plan.clauses.flatMap(cl => cl.steps);
  plan.nodes = run.nodes;
  plan.group = run.group;
  plan.select = run.select ?? (run.subject && run.nodes.some(nd => nd.id === run.subject!.id) ? [run.subject.id] : []);
  plan.changed = run.nodes !== nodes || !!run.group || !!run.select;
  plan.ok = plan.clauses.length > 0 && plan.clauses.every(cl => cl.status === 'ok') && plan.changed;
  return plan;
}
