/**
 * barAssist.ts — the Do… bar's type-ahead and signature help for the language (§8.7, §13
 * "Autocomplete everywhere"), aware of the graph:
 *
 *  - at the start of a clause: every head (shapes, nodes made by name, steps, verbs, combines,
 *    colour by), with its signature;
 *  - after `create`: everything that can be made, grouped (shapes, then node categories);
 *  - after `connect`: wires that would type-check on this graph, "uv → circle.position", ranked by
 *    how often people make them (the usage table); after `connect A →`, the inputs A fits;
 *  - after `set <node>`: that node's settings, with their values; after `set <node> key=`: its
 *    choices or colours;
 *  - after a verb that takes a node (delete, select, output…): the nodes here, by their names;
 *  - after a step or maker: its settings; after `key=`: choices, colours and `random`.
 *
 * The sugar's own type-ahead (complete.ts doBarAssist) still runs for plain English. Pure.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition, getNodeDefinitionFor, getOfferedDefinitions } from '../nodes/definitions';
import { typesCompatible } from '../lib/typesCompatible';
import { namesOf } from '../suggestions/doRefs';
import { SHAPES as WORD_SHAPES } from './vocabulary';
import { COLOUR_TABLE } from './colours';
import { entriesFor, lookupHead, paramOf, type Entry } from './registry';
import { rankCompletions, type Assist, type Completion, type CompletionKind, type Signature } from './complete';
import { EDIT_SYNTAX } from './registry';

export interface BarAssistCtx {
  nodes: GraphNode[];
  /** How often a wire from (type, out) to (type, in) is made: 0…1 (the usage table). */
  rank?: (fromType: string, outKey: string, toType: string, inKey: string) => number;
}

const slug = (s: string) => s.toLowerCase().replace(/[()]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const canvasOrder = (a: GraphNode, b: GraphNode) => a.position.x - b.position.x || a.position.y - b.position.y;

/** The short canonical name a node answers to here: its own label quoted, else its shape or type word, with #n when several share it. */
export function refFor(node: GraphNode, nodes: GraphNode[]): string {
  if (typeof node.params?.label === 'string' && node.params.label.trim()) return `"${node.params.label.trim()}"`;
  const names = [...namesOf(node)];
  const shape = WORD_SHAPES.find(s => s.node2d?.type === node.type && (s.node2d.params?.shape === undefined || s.node2d.params.shape === node.params?.shape) && names.includes(s.words[0]));
  const def = getNodeDefinition(node.type);
  const word = shape?.words[0] ?? (node.type === 'output' ? 'output' : node.type === 'light' ? 'glow' : node.type === 'fbm' ? 'noise' : node.type === 'uv' ? 'uv' : slug(def?.label?.replace(/\s*\(.*\)\s*/, '') ?? node.type));
  const same = nodes.filter(n => namesOf(n).has(word.replace(/-/g, ' ')) || namesOf(n).has(word)).sort(canvasOrder);
  if (same.length <= 1) return word;
  return `${word}#${same.findIndex(n => n.id === node.id) + 1}`;
}

/** The node a canonical reference names here (first match), for the settings list. */
function nodeOf(ref: string, nodes: GraphNode[]): GraphNode | null {
  const q = /^"(.*)"$/.exec(ref);
  if (q) return nodes.find(n => n.params?.label === q[1]) ?? null;
  const m = /^([a-z0-9-]+)(?:#(\d+|last))?$/.exec(ref.replace(/^the-/, ''));
  if (!m) return null;
  const name = m[1].replace(/-/g, ' ');
  const hits = nodes.filter(n => namesOf(n).has(name) || namesOf(n).has(m[1])).sort(canvasOrder);
  if (!hits.length) return null;
  if (!m[2]) return hits[0];
  return m[2] === 'last' ? hits[hits.length - 1] : hits[Number(m[2]) - 1] ?? null;
}

const headKind = (e: Entry): CompletionKind => (e.kind === 'maker' ? 'shape' : e.kind === 'combine' ? 'combine' : e.kind === 'step' ? 'action' : e.kind === 'output' ? 'output' : 'setting');
const sig = (e: Entry) => [e.kind === 'combine' ? `${e.words[0]}(a, b)` : e.words[0], ...e.params.slice(0, 4).map(p => (p.primary ? `${p.label ?? p.key}` : `${p.key}=…`))].join(' ');

/** Every head a clause can start with in the bar. */
function heads(nodes: GraphNode[]): Completion[] {
  const out: Completion[] = [];
  const seen = new Set<string>();
  for (const e of [...entriesFor('picture'), ...entriesFor('edit')]) {
    const label = e.kind === 'output' && e.id === 'picture:colour-by' ? 'colour by' : e.words[0];
    if (seen.has(label) || e.id.startsWith('scene:')) continue;
    seen.add(label);
    out.push({ label, insert: e.kind === 'combine' ? `${label}(` : label === 'colour by' ? 'colour by ' : `${label} `, kind: headKind(e), detail: e.summary, signature: EDIT_SYNTAX[e.id.replace(/^edit:/, '')]?.[0] ?? sig(e), words: e.words.slice(1) });
  }
  out.push({ label: 'output', insert: 'output', kind: 'output', detail: 'Wire it (or a node) to the Output; a 3D scene: output depth, normal…', signature: 'output [<node> | depth | normal…]' });
  out.push({ label: 'surprise me', insert: 'surprise me', kind: 'action', detail: 'A random line: surprise me small | medium | large, 2d | 3d', signature: 'surprise me [small|medium|large] [2d|3d]' });
  for (const n of nodes) {
    if (n.type === 'output') continue;
    const r = refFor(n, nodes);
    const label = r.startsWith('"') ? r : `the ${r}`;
    out.push({ label, insert: `${label} `, kind: 'value', detail: `${getNodeDefinition(n.type)?.label ?? n.type} here: the next step works on it` });
  }
  return out;
}

/** Everything `create` can make, grouped: shapes first, then nodes by category. */
export function creatable(): Completion[] {
  const out: Completion[] = [];
  for (const s of WORD_SHAPES.filter(x => x.node2d)) out.push({ label: s.words[0], insert: s.words[0], kind: 'shape', detail: getNodeDefinition(s.node2d!.type)?.label ?? s.id, words: s.words.slice(1), group: 'Shapes' });
  const defs = getOfferedDefinitions().filter(d => !d.deprecated && d.type !== 'output').sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  for (const d of defs) out.push({ label: slug(d.label), insert: slug(d.label), kind: 'value', detail: d.label, words: [d.type, ...(d.aliases ?? [])], group: d.category });
  return out;
}

/** Wires that would type-check here, best first: "uv → circle.position". `from`: only from this node. */
export function wiresHere(ctx: BarAssistCtx, from?: GraphNode): Completion[] {
  const out: Array<Completion & { score: number }> = [];
  const upstream = (id: string): Set<string> => {
    const seen = new Set<string>(); const stack = [id];
    while (stack.length) { const cur = stack.pop()!; const nd = ctx.nodes.find(n => n.id === cur); for (const i of Object.values(nd?.inputs ?? {})) { const c = i.connection?.nodeId; if (c && !seen.has(c)) { seen.add(c); stack.push(c); } } }
    return seen;
  };
  for (const a of from ? [from] : ctx.nodes) {
    if (a.type === 'output') continue;
    const ups = upstream(a.id);
    for (const [outKey, o] of Object.entries(a.outputs ?? {})) {
      for (const b of ctx.nodes) {
        if (b.id === a.id || ups.has(b.id)) continue; // a wire back up the chain would loop
        for (const [inKey, i] of Object.entries(b.inputs ?? {})) {
          if (i.connection?.nodeId === a.id && i.connection.outputKey === outKey) continue;
          if (!typesCompatible(o.type, i.type)) continue;
          const exact = o.type === i.type ? 0.3 : 0;
          const used = ctx.rank?.(a.type, outKey, b.type, inKey) ?? 0;
          const free = i.connection ? 0 : 0.2;
          const sock = slug(inKey);
          const label = `${refFor(a, ctx.nodes)} → ${b.type === 'output' ? 'output' : `${refFor(b, ctx.nodes)}.${sock}`}`;
          out.push({ label, insert: label, kind: 'value', detail: `${getNodeDefinition(a.type)?.label} · ${o.label ?? outKey} → ${getNodeDefinition(b.type)?.label} · ${i.label ?? inKey}${i.connection ? ' (replaces its wire)' : ''}`, score: used * 2 + exact + free });
        }
      }
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 40).map(({ score: _s, ...c }) => c);
}

/** A node's settings for `set`: key=, with the value it has. */
export function settingsOf(node: GraphNode): Completion[] {
  const def = getNodeDefinitionFor(node);
  return Object.entries(def?.paramDefs ?? {}).filter(([, p]) => p.type !== 'string' || (p as { options?: unknown }).options).map(([key, p]) => {
    const cur = node.params?.[key] ?? def?.defaultParams?.[key];
    const label = slug(p.label ?? key);
    return { label, insert: `${label}=`, kind: 'param' as const, detail: `${p.label ?? key}: ${Array.isArray(cur) ? `(${cur.map(x => Math.round(Number(x) * 1000) / 1000).join(', ')})` : String(cur ?? '')}`, words: [key] };
  });
}

/** The Do… bar's type-ahead for a line of the language at `caret`. */
export function barAssist(text: string, caret: number, ctx: BarAssistCtx): Assist {
  const before = text.slice(0, caret);
  const wordM = /[A-Za-z_][A-Za-z0-9_#-]*$/.exec(before);
  const word = wordM ? wordM[0] : '';
  let from = caret - word.length;
  let to = caret;
  while (to < text.length && /[A-Za-z0-9_#-]/.test(text[to])) to++;
  const clauseStart = Math.max(before.lastIndexOf('·'), before.lastIndexOf('\n'), before.lastIndexOf(';')) + 1;
  const clause = before.slice(clauseStart, from);
  const words = clause.trim().split(/\s+/).filter(Boolean);
  const verb = words[0]?.toLowerCase() ?? '';
  let items: Completion[] = [];
  let signature: Signature | null = null;
  const nodeRefs = () => ctx.nodes.filter(n => n.type !== 'output').map(n => ({ label: refFor(n, ctx.nodes), insert: refFor(n, ctx.nodes), kind: 'value' as const, detail: getNodeDefinition(n.type)?.label ?? n.type }));
  const verbSig = (v: string): Signature | null => {
    const syn = EDIT_SYNTAX[v === 'switch' ? 'replace' : v];
    return syn ? { head: v, detail: syn.join(' · '), params: syn.map(s => ({ key: '', label: s, hint: '', text: s.replace(/^\S+\s*/, '') })), active: 0 } : null;
  };

  if (verb === 'create' && words.length === 1) {
    items = word ? rankCompletions(word, creatable(), 40) : creatable();
    signature = verbSig('create');
  } else if (verb === 'connect' || verb === 'reconnect') {
    const arrow = /(→|->)\s*$/.test(clause) || words.includes('→') || words.includes('->');
    const fromRef = words[1];
    if (!arrow && words.length === 1) {
      // Whole wires that fit, "uv → circle.position": they replace the rest of the clause.
      const all = wiresHere(ctx);
      items = word ? rankCompletions(word, all.map(c => ({ ...c, words: [c.label.split(' → ')[0]] })), 12) : all.slice(0, 12);
      to = Math.max(to, caret + (text.slice(caret).split('·')[0].length));
    } else if (arrow && fromRef) {
      const a = nodeOf(fromRef, ctx.nodes);
      const all = a ? wiresHere(ctx, a).map(c => ({ ...c, label: c.label.split(' → ')[1], insert: c.label.split(' → ')[1] })) : nodeRefs();
      items = word ? rankCompletions(word, all, 12) : all.slice(0, 12);
    }
    signature = verbSig(verb);
  } else if (verb === 'set' && words.length >= 2) {
    const node = nodeOf(words[1], ctx.nodes);
    const keyM = /([A-Za-z_][\w-]*)=\s*$/.exec(clause);
    if (node && keyM) {
      const def = getNodeDefinitionFor(node);
      const pd = Object.entries(def?.paramDefs ?? {}).find(([k, p]) => slug(p.label ?? k) === keyM[1].toLowerCase() || k === keyM[1]);
      const opts = (pd?.[1] as { options?: Array<{ value: string; label: string }> } | undefined)?.options ?? [];
      const choices: Completion[] = opts.map(o => ({ label: slug(o.label), insert: slug(o.label), kind: 'value', detail: o.label }));
      if (pd && (pd[1].type === 'vec3color' || pd[1].type === 'vec3')) for (const [nm, c] of Object.entries(COLOUR_TABLE)) choices.push({ label: nm, insert: nm, kind: 'colour', detail: `(${c.join(', ')})` });
      items = rankCompletions(word, choices, 12);
    } else if (node) {
      const all = settingsOf(node);
      items = word ? rankCompletions(word, all, 14) : all.slice(0, 14);
    } else if (words.length === 1 || (words.length === 2 && word)) {
      items = rankCompletions(word, nodeRefs(), 12);
    }
    signature = verbSig('set');
  } else if (['delete', 'duplicate', 'select', 'rename', 'disconnect', 'output', 'set'].includes(verb) && words.length === 1) {
    items = rankCompletions(word, nodeRefs(), 12);
    if (!word) items = nodeRefs().slice(0, 12);
    signature = verbSig(verb);
  } else if (verb === 'switch' && words.length >= 2 && (words[2] === 'to' || /\bto\s*$/.test(clause))) {
    items = rankCompletions(word, creatable().filter(c => c.group !== 'Shapes'), 12);
    signature = verbSig('switch');
  } else if (verb === 'switch' && words.length === 1) {
    items = rankCompletions(word, nodeRefs(), 12);
    signature = verbSig('switch');
  } else if (verb === 'insert') {
    if (words.length === 1) items = rankCompletions(word, creatable().filter(c => c.group !== 'Shapes'), 16);
    else if (['between', 'after', 'before', 'and'].includes(words[words.length - 1])) items = rankCompletions(word, nodeRefs(), 12);
    else if (words.length === 2 && !word) items = ['between', 'after', 'before'].map(w => ({ label: w, insert: `${w} `, kind: 'param' as const, detail: `insert … ${w} …` }));
    signature = verbSig('insert');
  } else if (!words.length) {
    // Nothing typed yet: no list (the bar's own hint shows); a word: the heads it starts.
    items = word ? rankCompletions(word, heads(ctx.nodes), 12) : [];
    const hit = word ? lookupHead(word, 'picture') : null;
    if (hit) signature = entrySig(hit.entry, '', word);
  } else {
    // After a head: its settings, or after key= its values.
    const head = lookupHead(verb.replace(/\($/, ''), 'picture') ?? lookupHead(verb, 'edit');
    if (head) {
      const keyM = /([A-Za-z_][\w-]*)=\s*$/.exec(clause);
      if (keyM) {
        const p = paramOf(head.entry, keyM[1]);
        const choices: Completion[] = [...(p?.options ?? []).map(o => ({ label: o, insert: o, kind: 'value' as const, detail: `${p!.key}: a choice` }))];
        if (p?.type === 'colour') for (const [nm, c] of Object.entries(COLOUR_TABLE)) choices.push({ label: nm, insert: nm, kind: 'colour', detail: `(${c.join(', ')})` });
        if (p?.rand) choices.push({ label: 'random', insert: 'random', kind: 'value', detail: 'from its interesting range; random(0.2..2) or random(red, teal) for your own' });
        items = rankCompletions(word, choices, 12);
        if (!word) items = choices.slice(0, 12);
      } else {
        const given = new Set([...clause.matchAll(/([A-Za-z_][\w-]*)=/g)].map(m => m[1].toLowerCase()));
        const keys = head.entry.params.filter(p => !given.has(p.key)).map(p => ({ label: p.key, insert: `${p.key}=`, kind: 'param' as const, detail: `${p.label ?? p.key}${p.def !== undefined && !Array.isArray(p.def) ? ` (default ${p.def})` : ''}`, words: p.aliases }));
        items = word ? rankCompletions(word, keys, 10) : [];
      }
      signature = entrySig(head.entry, clause, word);
    }
  }
  if (items.length === 1 && items[0].label === word) items = [];
  from = Math.min(from, caret);
  return { items, from, to, signature };
}

function entrySig(e: Entry, clause: string, word: string): Signature {
  const given = new Set([...clause.matchAll(/([A-Za-z_][\w-]*)=/g)].map(m => m[1].toLowerCase()));
  const params = e.params.map(p => ({ key: p.key, label: p.label ?? p.key, hint: p.hint ?? (p.options ? p.options.join(', ') : p.type), text: p.primary ? `${p.def ?? p.key}` : `${p.key}=${p.def !== undefined && typeof p.def !== 'object' ? String(p.def) : '…'}` }));
  let active = params.findIndex(p => p.key === word.toLowerCase());
  if (active < 0) active = params.findIndex(p => !given.has(p.key));
  return { head: e.kind === 'combine' ? `${e.words[0]}(a, b)` : e.words[0], detail: e.summary, params, active };
}
