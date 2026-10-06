/**
 * doRefs.ts — reading a command sentence (docs/do-bar-commands.md): the lexer, clause splitting,
 * node names, and references to nodes ("it", "the circle", "the 'Glow' node", "the current
 * output", "the node before the output", "all circles").
 *
 * Pure and deterministic. References resolve against the graph level being edited plus what the
 * sentence has made so far ("it" is the last clause's result). When a name fits several nodes,
 * the selected one or the last result wins; otherwise the caller gets every candidate and the
 * preview asks which (a pick, keyed per clause and slot).
 */
import type { GraphNode } from '../types/nodeGraph';
import { NODE_REGISTRY, getNodeDefinition, getOfferedDefinitions } from '../nodes/definitions';
import { graphOutput } from '../nodes/scene3dDefaults';
import { nodeName } from '../store/historyLabels';
import { colourOf, editDistance, numberOf, PARAMS, plural, SHAPES, tokenize } from '../lang/vocabulary';

// ── Lexer ───────────────────────────────────────────────────────────────────

export interface Tok {
  /** Lower-case word, or the quoted text (as typed) when `q`. */
  w: string;
  /** A quoted name ("Glow", 'Halo'). */
  q?: boolean;
  /** A clause break (, ; .). */
  sep?: boolean;
  /** "'s" (possessive), read like "of". */
  poss?: boolean;
}

const QUOTE_RE = /"([^"]*)"|“([^”]*)”|‘([^’]*)’|(?<=^|[\s(])'([^']+)'(?=$|[\s,.;:!?)])/g;

/** Words, quoted names, possessives and clause breaks. Numbers stay whole ("0.3"). */
export function lex(text: string): Tok[] {
  const out: Tok[] = [];
  let last = 0;
  const plain = (s: string) => {
    // Break on , ; and a full stop that isn't inside a number.
    for (const part of s.split(/(,|;|\.(?!\d)(?=\s|$))/)) {
      if (part === ',' || part === ';' || part === '.') { out.push({ w: part, sep: true }); continue; }
      for (const raw of part.split(/\s+/).filter(Boolean)) {
        const m = /^(.*?)(['’]s)$/i.exec(raw);
        const word = m ? m[1] : raw;
        for (const t of tokenize(word)) out.push({ w: t });
        if (m) out.push({ w: "'s", poss: true });
      }
    }
  };
  for (const m of text.matchAll(QUOTE_RE)) {
    plain(text.slice(last, m.index));
    out.push({ w: (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim(), q: true });
    last = m.index! + m[0].length;
  }
  plain(text.slice(last));
  return out;
}

/** Tokens back to text (quoted names in quotes). */
export function untok(toks: Tok[]): string {
  return toks.map(t => (t.q ? `"${t.w}"` : t.poss ? "'s" : t.w)).join(' ').replace(/ '[s]/g, "'s").replace(/ ([,;.])/g, '$1');
}

const CLAUSE_STARTERS = new Set(['then', 'next', 'finally', 'afterwards']);
const MODIFIER_STARTS = new Set(['with', 'by', 'at', 'in', 'and', 'size', 'radius']);

/**
 * Split a sentence into clauses: at , ; . and "then" / "after that" / "next" / "finally", and
 * at "and" when a verb follows. A clause with no verb, shape or action of its own ("falloff 8")
 * stays with the clause before it, so "circle with a glow, falloff 8" is one clause.
 */
export function splitClauses(toks: Tok[], isHead: (toks: Tok[], i: number) => boolean): Tok[][] {
  const raw: Tok[][] = [[]];
  const cut = () => { if (raw[raw.length - 1].length) raw.push([]); };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.sep) { cut(); continue; }
    if (!t.q && CLAUSE_STARTERS.has(t.w)) { cut(); continue; }
    if (!t.q && t.w === 'after' && toks[i + 1]?.w === 'that') { cut(); i++; continue; }
    if (!t.q && t.w === 'and') {
      const next = toks[i + 1];
      if (next && !next.q && next.w === 'then') { cut(); i++; continue; }
      if (next && isHead(toks, i + 1)) { cut(); continue; }
    }
    raw[raw.length - 1].push(t);
  }
  const clauses = raw.filter(c => c.length);
  // Modifier-only pieces ("falloff 8", "with rings", "red") join the clause before.
  const out: Tok[][] = [];
  for (const c of clauses) {
    const hasHead = c.some((_, i) => isHead(c, i));
    const first = c[0];
    const modifier = !!first && !first.q && (numberOf(first.w) !== null || !!colourOf(first.w) || MODIFIER_STARTS.has(first.w) || Object.values(PARAMS).some(ws => ws.includes(first.w)));
    if (!hasHead && modifier && out.length) out[out.length - 1] = [...out[out.length - 1], { w: ',', sep: true }, ...c];
    else out.push(c);
  }
  return out;
}

// ── Node names ──────────────────────────────────────────────────────────────

/** Short words for node types that their labels don't say. A word can name several types. */
export const TYPE_WORDS: Readonly<Record<string, string[]>> = {
  glow: ['light'], halo: ['light'], light: ['light'],
  noise: ['fbm', 'noiseFloat', 'voronoi'], fbm: ['fbm'], clouds: ['fbm'], cells: ['voronoi'],
  palette: ['palette', 'stopPalette'], gradient: ['gradient'],
  fill: ['sdfFill'],
  uv: ['uv'], space: ['uv'], coordinates: ['uv'],
  output: ['output'],
  time: ['time'], clock: ['time'],
  length: ['length'], luminance: ['luminance'],
  'tone map': ['toneMap'], tonemap: ['toneMap'],
  mask: ['smoothstep', 'sdfMask'],
  union: ['sdfUnion'], outline: ['distanceShape'], rings: ['distanceShape'],
};

const lowerLabel = (s: string) => s.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();

/** Every name a node answers to: its own label, its type's label (with and without "SDF"), aliases, shape words, type words. */
export function namesOf(node: GraphNode): Set<string> {
  const names = new Set<string>();
  const def = getNodeDefinition(node.type);
  const add = (s: string | undefined) => { if (s) { const l = lowerLabel(s); if (l) names.add(l); } };
  if (typeof node.params?.label === 'string') add(node.params.label);
  add(def?.label);
  add(def?.label.replace(/\bsdf\b/i, ''));
  add(def?.label.replace(/\s*\(.*\)\s*/, ''));
  add(node.type);
  for (const a of def?.aliases ?? []) add(a);
  for (const sh of SHAPES) {
    if (sh.node2d?.type !== node.type) continue;
    const want = sh.node2d.params?.shape;
    if (want !== undefined && node.params?.shape !== want) continue;
    if (want === undefined && node.type === 'shapeSDF') continue;
    for (const w of sh.words) add(w);
  }
  for (const [w, types] of Object.entries(TYPE_WORDS)) if (types.includes(node.type)) add(w);
  if (def?.category === 'Noise') add('noise');
  return names;
}

/** A node type named by `words` (exact name, type word, shape): the type and its starting params. */
export function typeByName(words: string[]): { type: string; params?: Record<string, unknown>; shape?: string } | null {
  const phrase = words.join(' ');
  if (!phrase) return null;
  for (const sh of SHAPES) if (sh.node2d && (sh.words.includes(phrase) || sh.words.includes(plural(phrase)))) return { type: sh.node2d.type, params: sh.node2d.params, shape: sh.id };
  const tw = TYPE_WORDS[phrase] ?? TYPE_WORDS[plural(phrase)];
  if (tw) return { type: tw[0] };
  const defs = getOfferedDefinitions();
  const exact = (d: (typeof defs)[number]) => [d.label, d.label.replace(/\bsdf\b/i, ''), d.label.replace(/\s*\(.*\)\s*/, ''), d.type, ...(d.aliases ?? [])].map(lowerLabel);
  for (const d of defs) if (exact(d).includes(phrase) || exact(d).includes(plural(phrase))) return { type: d.type };
  return null;
}

/** Node types close to `words`, for "did you mean". */
export function typesLike(words: string[], limit = 3): string[] {
  const phrase = words.join(' ');
  if (!phrase) return [];
  const scored = getOfferedDefinitions().map(d => {
    const l = lowerLabel(d.label);
    const s = l.startsWith(phrase) ? 3 : l.includes(phrase) ? 2 : editDistance(phrase, l, 2) <= 2 ? 1 : 0;
    return { d, s };
  }).filter(x => x.s > 0 && NODE_REGISTRY[x.d.type]).sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(x => lowerLabel(x.d.label));
}

// ── References ──────────────────────────────────────────────────────────────

/** A wire end: a node and one of its outputs (when the reference names one). */
export interface Wired { id: string; key?: string }

export interface RefEnv {
  nodes: GraphNode[];
  /** The selection when the command started (ids, in order). */
  selected: string[];
  /** The last clause's result ("it"). */
  subject: Wired | null;
  /** The clause before couldn't run, so "it" is unknown. */
  broken?: boolean;
}

export type RefResult =
  | { ok: true; ids: string[]; key?: string; used: number; via?: 'output-role' | 'output-node'; many?: boolean; text: string }
  | { ok: false; used: number; text: string; error: string; suggestions: string[]; candidates?: string[] };

const PRONOUN_RESULT = ['it', 'that', 'the result', 'the last one', 'the new one', 'the previous one', 'the result of that', 'the last result', 'the new node'];
const PRONOUN_SELECTION_ONE = ['this', 'this node', 'the selected node', 'the selection'];
const PRONOUN_SELECTION_ALL = ['these', 'them', 'those', 'both', 'the selected nodes', 'these nodes', 'both of them', 'the two'];
const ROLE_OUTPUT = ['the current output', 'what the output shows', 'what feeds the output', 'whats on the output', 'what is on the output', 'the picture', 'the image', 'what is shown', 'current output'];
const ORDINALS: Record<string, number> = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4, last: -1 };

const startsWith = (toks: Tok[], i: number, phrase: string) => {
  const parts = phrase.split(' ');
  return parts.every((p, k) => toks[i + k] && !toks[i + k].q && toks[i + k].w === p) ? parts.length : 0;
};
const longest = (toks: Tok[], i: number, list: string[]) => list.reduce((best, p) => Math.max(best, startsWith(toks, i, p)), 0);

/** What the Output shows: the node wired into it. */
export function shownNode(nodes: GraphNode[]): Wired | null {
  const c = graphOutput(nodes)?.inputs.color?.connection;
  return c ? { id: c.nodeId, key: c.outputKey } : null;
}

/** Nodes in canvas order (left to right, then top to bottom), for "the first circle". */
const canvasOrder = (a: GraphNode, b: GraphNode) => a.position.x - b.position.x || a.position.y - b.position.y;

/** The source of a node's first wired input ("the node before X"). */
export function before(nodes: GraphNode[], id: string): Wired | null {
  const nd = nodes.find(x => x.id === id);
  const c = nd ? Object.values(nd.inputs).find(i => i.connection)?.connection : undefined;
  return c && nodes.some(x => x.id === c.nodeId) ? { id: c.nodeId, key: c.outputKey } : null;
}

/** The first node reading `id` ("the node after X"). */
export function after(nodes: GraphNode[], id: string): Wired | null {
  for (const nd of [...nodes].sort(canvasOrder)) if (Object.values(nd.inputs).some(i => i.connection?.nodeId === id)) return { id: nd.id };
  return null;
}

/**
 * Read a reference at toks[i]. Greedy: the longest name that fits a node here wins, and the
 * words after it are left for the caller (a setting or input name: "the glow falloff").
 */
export function readRef(toks: Tok[], i: number, env: RefEnv): RefResult {
  const start = i;
  const text = (end: number) => untok(toks.slice(start, end));
  const fail = (used: number, error: string, suggestions: string[] = [], candidates?: string[]): RefResult => ({ ok: false, used, text: text(start + used), error, suggestions, candidates });
  if (i >= toks.length) return fail(0, 'Nothing named here.');
  const byId = new Map(env.nodes.map(nd => [nd.id, nd]));
  const sel = env.selected.filter(id => byId.has(id));

  // "the 'Glow' node"
  if (toks[i].w === 'the' && !toks[i].q && toks[i + 1]?.q) {
    const r = readRef(toks, i + 1, env);
    return { ...r, used: r.used + 1, text: text(i + 1 + r.used) };
  }
  // A quoted name: a node's own label, else its type's.
  if (toks[i].q) {
    const q = lowerLabel(toks[i].w);
    let used = 1;
    if (toks[i + 1]?.w === 'node') used++;
    const own = env.nodes.filter(nd => typeof nd.params?.label === 'string' && lowerLabel(nd.params.label) === q);
    const any = own.length ? own : env.nodes.filter(nd => namesOf(nd).has(q));
    if (!any.length) return fail(used, `No node is called “${toks[i].w}”.`, nearNames(env.nodes, q));
    return { ok: true, ids: any.map(nd => nd.id), used, text: text(i + used), many: any.length > 1 };
  }

  // Pronouns and roles.
  const res = longest(toks, i, PRONOUN_RESULT);
  if (res) {
    if (env.broken) return fail(res, '“It” is what the clause before makes, and that clause can’t run yet.');
    const s = env.subject ?? (sel.length ? { id: sel[0] } : shownNode(env.nodes));
    if (!s) return fail(res, '“It” is nothing yet: select a node, or name one.');
    return { ok: true, ids: [s.id], key: s.key, used: res, text: text(i + res) };
  }
  const all = longest(toks, i, PRONOUN_SELECTION_ALL);
  if (all) {
    if (!sel.length) return fail(all, 'Nothing is selected.');
    return { ok: true, ids: sel, used: all, text: text(i + all), many: sel.length > 1 };
  }
  const one = longest(toks, i, PRONOUN_SELECTION_ONE);
  if (one) {
    const s = sel.length ? { id: sel[0] } : env.subject;
    if (!s) return fail(one, 'Nothing is selected.');
    return { ok: true, ids: [s.id], used: one, text: text(i + one) };
  }
  const role = longest(toks, i, ROLE_OUTPUT);
  if (role) {
    const s = shownNode(env.nodes);
    if (!s) return fail(role, 'The Output shows nothing yet.', ['output it']);
    return { ok: true, ids: [s.id], key: s.key, used: role, via: 'output-role', text: text(i + role) };
  }

  // "the node before / after <ref>"
  let j = i;
  if (toks[j]?.w === 'the') j++;
  if ((toks[j]?.w === 'node' || toks[j]?.w === 'one') && (toks[j + 1]?.w === 'before' || toks[j + 1]?.w === 'after')) {
    const dir = toks[j + 1].w;
    const inner = readRef(toks, j + 2, env);
    const used = j + 2 - i + inner.used;
    if (!inner.ok) return { ...inner, used, text: text(i + used) };
    const w = dir === 'before' ? before(env.nodes, inner.ids[0]) : after(env.nodes, inner.ids[0]);
    if (!w) return fail(used, `Nothing is wired ${dir === 'before' ? 'into' : 'out of'} ${nodeName(byId.get(inner.ids[0]))}.`);
    return { ok: true, ids: [w.id], key: w.key, used, text: text(i + used) };
  }

  // [the] [all|every|each] [ordinal] name [number] [node|nodes]
  let every = false;
  if (toks[j]?.w === 'all' || toks[j]?.w === 'every' || toks[j]?.w === 'each') { every = true; j++; if (toks[j]?.w === 'the') j++; }
  let ordinal: number | null = null;
  if (toks[j] && toks[j].w in ORDINALS && toks[j + 1]) { ordinal = ORDINALS[toks[j].w]; j++; }
  // The longest run of words that names some node here.
  let best: { len: number; nodes: GraphNode[] } | null = null;
  for (let len = Math.min(4, toks.length - j); len >= 1; len--) {
    const span = toks.slice(j, j + len);
    if (span.some(t => t.q || t.sep || t.poss)) continue;
    const phrase = span.map(t => t.w).join(' ');
    const folded = span.length ? [...span.slice(0, -1).map(t => t.w), plural(span[span.length - 1].w)].join(' ') : phrase;
    const hits = env.nodes.filter(nd => { const nm = namesOf(nd); return nm.has(phrase) || nm.has(folded); });
    if (hits.length) { best = { len, nodes: hits }; break; }
  }
  if (!best) {
    // A word that names a type, with none here; else nothing known.
    const span: string[] = [];
    for (let k = j; k < toks.length && k < j + 3 && !toks[k].q && !toks[k].sep && !toks[k].poss; k++) span.push(toks[k].w);
    const w = span[0] ?? '';
    const named = typeByName(span.slice(0, 2)) ?? typeByName(span.slice(0, 1));
    if (named) {
      const label = getNodeDefinition(named.type)?.label ?? named.type;
      return fail(j - i + 1, `There is no ${named.shape ?? label} here.`, [...nearNames(env.nodes, w), `create a ${w}`]);
    }
    return fail(j - i + Math.max(1, span.length ? 1 : 0), `“${w || toks[i].w}” isn’t a node here.`, nearNames(env.nodes, w));
  }
  j += best.len;
  let plural_ = toks[j - 1].w !== plural(toks[j - 1].w);
  // "circle 2"
  if (ordinal === null && toks[j] && /^\d+$/.test(toks[j].w) && Number(toks[j].w) >= 1 && Number(toks[j].w) <= best.nodes.length) { ordinal = Number(toks[j].w) - 1; j++; }
  if (toks[j]?.w === 'node') j++;
  else if (toks[j]?.w === 'nodes') { j++; plural_ = true; }
  const used = j - i;
  const sorted = [...best.nodes].sort(canvasOrder);
  if (ordinal !== null) {
    const nd = ordinal < 0 ? sorted[sorted.length - 1] : sorted[ordinal];
    if (!nd) return fail(used, `There are only ${sorted.length}.`);
    return { ok: true, ids: [nd.id], used, text: text(i + used) };
  }
  if (every || (plural_ && sorted.length > 1)) return { ok: true, ids: sorted.map(nd => nd.id), used, text: text(i + used), many: true };
  if (sorted.length === 1) {
    const via = sorted[0].type === 'output' ? 'output-node' : undefined;
    return { ok: true, ids: [sorted[0].id], used, via, text: text(i + used) };
  }
  // Several: the selected one, else the last result, wins.
  const preferred = sorted.filter(nd => sel.includes(nd.id));
  if (preferred.length === 1) return { ok: true, ids: [preferred[0].id], used, text: text(i + used) };
  if (env.subject && sorted.some(nd => nd.id === env.subject!.id)) return { ok: true, ids: [env.subject.id], key: env.subject.key, used, text: text(i + used) };
  return { ok: false, used, text: text(i + used), error: `${sorted.length} nodes fit “${text(i + used)}”: pick one.`, suggestions: [], candidates: sorted.map(nd => nd.id) };
}

/** Names of nodes here close to `word`, for "did you mean". */
export function nearNames(nodes: GraphNode[], word: string): string[] {
  if (!word) return [];
  const out = new Set<string>();
  for (const nd of nodes) {
    for (const nm of namesOf(nd)) {
      if (nm === nd.type.toLowerCase() && /[A-Z]/.test(nd.type)) continue;
      if (nm.split(' ').some(p => editDistance(p, word, 2) <= (word.length > 5 ? 2 : 1)) || nm.startsWith(word)) out.add(`the ${nm}`);
    }
  }
  return [...out].slice(0, 3);
}
