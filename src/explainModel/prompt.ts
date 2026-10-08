/**
 * prompt.ts — what the explanation model is told (docs/explain-model.md "How the grounding works").
 *
 * The model is small, so it is never asked to work things out alone. Every prompt carries:
 *   - the line (or the whole block / function) and the code around it,
 *   - the node it belongs to and its neighbours in the graph (what feeds it, what it feeds),
 *   - FACTS our rule-based explainer already knows for certain: the plain reading of the line, the
 *     idioms in it, what each function it calls does, the techniques the pattern catalogue finds on this
 *     node ("exponential falloff"), and what the names it reads mean (time, resolution, uv).
 * and is told to say what the line does to the picture and why, in plain words, without restating the code.
 *
 * Pure: no DOM, no model, no store. The same graph and line always give the same prompt.
 */
import type { GraphNode } from '../types/nodeGraph';
import { explainLine, explainExpression, functionsIn, functionInfo, parseLine, splitStatements, typesFromCode, type ExplainContext } from '../lib/glslPatterns';
import { analyseGraph, techniquesAtNode } from '../patterns/patternIndex';
import { hashText } from './cache';
import { MAX_BLOCK_LINES, MAX_TOKENS, blockTokens } from './config';
import type { ChatMessage } from './worker';

// ── Where the code lives ──────────────────────────────────────────────────────

export interface Neighbour {
  /** The node's name (its label, else its type's name). */
  name: string;
  type: string;
  /** The socket on the code's own node that this one is wired to. */
  socket: string;
}

export interface NodeContext {
  /** "Expression Block", "Custom Function", "GLSL page"… */
  kind: string;
  /** What the user called it, if anything. */
  label?: string;
  upstream: Neighbour[];
  downstream: Neighbour[];
  /** Techniques the pattern catalogue finds on this node, with their one-line reasons. */
  techniques: Array<{ name: string; explain: string; /** Code lines (normalised) the technique was found in; empty when it spans nodes. */ lines: string[] }>;
}

const MAX_NEIGHBOURS = 6;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Names for a node type: the registry's label. Injected so this file stays free of the node registry. */
export type NodeNamer = (type: string) => string | undefined;

const nameOf = (n: GraphNode, namer?: NodeNamer): string => {
  const own = typeof n.params?.label === 'string' ? n.params.label.trim() : '';
  const type = namer?.(n.type) ?? (n.type === 'exprNode' ? 'Expression Block' : n.type === 'customFn' ? 'Custom Function' : n.type);
  return own ? `${own} (${type})` : type;
};

/** What feeds a node and what it feeds, from the graph's wires (one level: the nodes beside it). */
export function neighboursOf(nodes: readonly GraphNode[], nodeId: string, namer?: NodeNamer): Pick<NodeContext, 'upstream' | 'downstream'> {
  const me = nodes.find(n => n.id === nodeId);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const upstream: Neighbour[] = [];
  const downstream: Neighbour[] = [];
  if (me) {
    for (const [key, sock] of Object.entries(me.inputs ?? {})) {
      const c = sock.connection;
      const src = c && byId.get(c.nodeId);
      if (src) upstream.push({ name: nameOf(src, namer), type: src.type, socket: key });
    }
  }
  for (const n of nodes) {
    if (n.id === nodeId) continue;
    for (const sock of Object.values(n.inputs ?? {})) {
      if (sock.connection?.nodeId === nodeId) {
        const outKey = sock.connection.outputKey;
        downstream.push({ name: nameOf(n, namer), type: n.type, socket: outKey });
        break;
      }
    }
  }
  return { upstream: upstream.slice(0, MAX_NEIGHBOURS), downstream: downstream.slice(0, MAX_NEIGHBOURS) };
}

/** The node context for a node in a graph: neighbours plus the techniques found on it. */
export function nodeContextFor(nodes: readonly GraphNode[], nodeId: string, namer?: NodeNamer): NodeContext | undefined {
  const me = nodes.find(n => n.id === nodeId);
  if (!me) return undefined;
  const label = typeof me.params?.label === 'string' && me.params.label.trim() ? me.params.label.trim() : undefined;
  let techniques: NodeContext['techniques'] = [];
  try {
    const gp = analyseGraph({ id: 'open:', label: 'open graph', origin: 'open', nodes });
    techniques = techniquesAtNode(gp, nodeId).map(t => ({ name: t.technique.name, explain: t.technique.explain, lines: t.hits.flatMap(h => (h.line ? [squash(h.line)] : [])) }));
  } catch (e) { console.warn('[explain model] patterns', e); }
  return { kind: me.type === 'exprNode' ? 'Expression Block' : me.type === 'customFn' ? 'Custom Function' : nameOf(me, namer), label, ...neighboursOf(nodes, nodeId, namer), techniques };
}

// ── Facts ─────────────────────────────────────────────────────────────────────

/** What the names every Playfield shader has mean, said in the picture's terms. */
export const NAME_MEANINGS: Record<string, string> = {
  u_time: 'u_time is the clock in seconds since start, so anything using it animates',
  iTime: 'iTime is the clock in seconds since start, so anything using it animates',
  t: 't is the clock in seconds (animates anything it feeds)',
  u_resolution: 'u_resolution is the canvas size in pixels (x = width, y = height)',
  iResolution: 'iResolution is the canvas size in pixels',
  u_mouse: 'u_mouse is the pointer position over the canvas',
  iMouse: 'iMouse is the pointer position over the canvas',
  vUv: 'vUv is where this pixel is on the canvas, 0..1 from corner to corner',
  uv: 'uv is the pixel’s position as a vec2 (often centred so 0,0 is the middle)',
  p: 'p is a point in space (a vec2 position)',
  gl_FragCoord: 'gl_FragCoord is the pixel’s position in pixels',
  PI: 'PI is 3.14159', TAU: 'TAU is 6.28318, one full turn in radians',
};

export interface Facts {
  /** The rule-based reading of the line, plain text. */
  reading?: string;
  /** Idioms recognised in it: "name: what it means". */
  idioms: string[];
  /** The functions it calls: "name(...): what it gives". */
  functions: string[];
  /** Techniques found on the node: "name: why". */
  techniques: string[];
  /** What the names it reads are. */
  names: string[];
  /** Types of the names it reads. */
  types: string[];
  /** Colour literals in it, named. */
  colours: string[];
}

export const noFacts = (): Facts => ({ idioms: [], functions: [], techniques: [], names: [], types: [], colours: [] });

const ident = /[A-Za-z_]\w*/g;
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** Everything the rule-based explainer knows about one line: plain strings, ready for a prompt (and the UI's "facts used"). */
export function gatherFacts(lineText: string, ctx: ExplainContext = {}, node?: NodeContext): Facts {
  const f = noFacts();
  const ex = explainLine(lineText, ctx);
  if (ex.ok) {
    f.reading = ex.lead;
    for (const h of ex.idioms) {
      const d = ex.descs.get(h.node.id);
      f.idioms.push(d?.meaning ? `${h.idiom.name}: ${d.meaning}` : h.idiom.name);
    }
    if (ex.use) f.idioms.push(`usually used for: ${ex.use}`);
  }
  const parsed = parseLine(lineText);
  const exprText = parsed.ok ? lineText.slice(parsed.line.exprStart) : lineText;
  for (const hit of functionsIn(exprText)) {
    if (hit.declaration) continue;
    const info = functionInfo(hit.name);
    if (info) f.functions.push(`${hit.name}: gives ${info.meaning}`);
  }
  const names = uniq(exprText.match(ident) ?? []);
  for (const n of names) {
    const m = NAME_MEANINGS[n];
    if (m) f.names.push(m);
  }
  for (const [n, t] of Object.entries(ctx.types ?? {})) if (t && names.includes(n)) f.types.push(`${n}: ${t}`);
  // Only techniques found in this very line: ones found elsewhere on the node would colour the answer with things this line doesn't do
  if (node) f.techniques = node.techniques.filter(t => t.lines.includes(squash(lineText))).map(t => `${t.name}: ${t.explain}`);
  f.functions = uniq(f.functions);
  f.idioms = uniq(f.idioms);
  f.colours = colourFacts(exprText);
  return f;
}
/** A colour in words, from red/green/blue in 0..1: "a light warm orange", "a dark blue", "a mid grey". */
export function colourWords(r: number, g: number, b: number): string {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const light = (mx + mn) / 2;
  const tone = mx < 0.15 ? 'very dark' : light < 0.3 ? 'dark' : light > 0.85 ? 'very light' : light > 0.65 ? 'light' : 'mid';
  if (d < 0.08) return mx < 0.08 ? 'black' : mx > 0.92 ? 'white' : `a ${tone} grey`;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const hue = h < 15 || h >= 345 ? 'red' : h < 40 ? 'orange' : h < 65 ? 'yellow' : h < 160 ? 'green' : h < 195 ? 'cyan' : h < 255 ? 'blue' : h < 290 ? 'purple' : 'pink';
  const warm = hue === 'orange' || hue === 'yellow' || hue === 'red' ? 'warm ' : hue === 'blue' || hue === 'cyan' ? 'cool ' : '';
  return `${/^[aeiou]/.test(tone) ? 'an' : 'a'} ${tone} ${warm}${hue}`;
}

/** The `vec3(r, g, b)` literals in some code, named: "vec3(1.0, 0.8, 0.55) is a light warm orange". */
export function colourFacts(code: string): string[] {
  const out: string[] = [];
  const re = /vec3\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if ([r, g, b].every(v => v >= 0 && v <= 1) && !(r === g && g === b)) out.push(`${m[0].replace(/\s+/g, ' ')} is the colour ${colourWords(r, g, b)} (red, green, blue)`);
  }
  return uniq(out);
}

/** The facts as the list the prompt (and the UI) shows. */
export function factLines(f: Facts): string[] {
  return [
    ...(f.reading ? [`What the line computes, literally (correct): ${f.reading}`] : []),
    ...f.idioms.map(s => `Idiom: ${s}`),
    ...f.functions.map(s => `Function ${s}`),
    ...f.techniques.map(s => `Technique on this node: ${s}`),
    ...f.names.map(s => `Name: ${s}`),
    ...f.colours.map(c => `Colour: ${c}`),
    ...(f.types.length ? [`Types: ${f.types.join(', ')}`] : []),
  ];
}

// ── The prompt ────────────────────────────────────────────────────────────────

export interface PromptInput {
  /** 'line': one statement. 'block': a whole Expression Block / function / selection. */
  scope: 'line' | 'block';
  /** The line (scope 'line') or the whole code (scope 'block'). */
  code: string;
  /** The code around the line: the enclosing block or function. */
  enclosing?: string;
  /** Where the line is: "line 3 of the block", "the Return line". */
  where?: string;
  node?: NodeContext;
  facts: Facts;
  /** For a block: the facts of each of its lines' readings (statement text → reading). */
  lineReadings?: Array<{ text: string; reading: string }>;
}

export interface BuiltPrompt {
  messages: ChatMessage[];
  maxTokens: number;
  /** Everything except the code, as text: with the code, the cache key. */
  context: string;
  /** The grounding facts the model was given (for the UI to show). */
  used: string[];
}

export const SYSTEM_PROMPT =
  'You explain shader code (GLSL) to a visual artist who is learning it. ' +
  'Say what the line does to the picture and why it is there, in plain words. ' +
  'Answer in at most 2 short sentences (under 50 words). Start straight away with the effect on the picture. ' +
  'Do not explain syntax, do not say how a function works in general, do not repeat the code. ' +
  'Only mention names that appear in the code or the lines before it. Trust the FACTS: never contradict them. ' +
  'If the purpose is not clear from the facts and the other lines, say "Not sure why, but" and give only what it does.';

/** Worked examples, as earlier turns of the chat: the small model copies their length and tone. */
export const EXAMPLES: ChatMessage[] = [
  { role: 'user', content: 'Node: Expression Block\nFed by: Distance -> d\n\nFACTS:\n- Idiom: Exponential glow: 1 right at the edge, fading quickly and smoothly to 0 further away\n\nLine:\nfloat g = exp(-d * 4.0)\n\nExplain this line.' },
  { role: 'assistant', content: 'Turns the distance d into a soft glow: full brightness at the shape, fading smoothly away from it. The 4.0 sets how tight the glow hugs the shape; a bigger number makes it tighter.' },
  { role: 'user', content: 'Node: Expression Block\nFed by: Time -> t\n\nEarlier lines:\nfloat a = uv.x * 6.0\n\nLine:\nfloat w = sin(a - t * 2.0)\n\nExplain this line.' },
  { role: 'assistant', content: 'Makes vertical bands that drift sideways over time: sin repeats across the picture, and subtracting the clock slides the pattern along. Not sure how w is used next, but it is a moving stripe pattern between -1 and 1.' },
];

export const BLOCK_SYSTEM_PROMPT =
  'You explain shader code (GLSL) to a visual artist who is learning it. ' +
  'Say what the code does to the picture and why, in plain words, never repeating the code. ' +
  'Follow the answer format you are given exactly: a two-sentence summary, then one short sentence per code line. ' +
  'Only mention names that appear in the code. Trust the FACTS: never contradict them. If a line\'s purpose is unclear, say "not sure why" for that line.';

/** The reply's shape, spelled out for a small model: a summary, then one numbered line per statement. */
export function blockFormat(lines: number): string {
  const n = Math.max(1, Math.min(lines, MAX_BLOCK_LINES));
  return ['Answer in exactly this format, nothing else:', 'Summary: <two short sentences: what the whole piece does to the picture, and why>',
    ...Array.from({ length: n }, (_, i) => `${i + 1}: <one short sentence: what line ${i + 1} does to the picture>`)].join('\n');
}

function nodeLines(n: NodeContext): string[] {
  const out = [`Node: ${n.kind}${n.label ? ` called "${n.label}"` : ''}`];
  if (n.upstream.length) out.push(`Fed by: ${n.upstream.map(u => `${u.name} -> ${u.socket}`).join('; ')}`);
  else out.push('Fed by: nothing wired (it only uses its own values)');
  if (n.downstream.length) out.push(`Feeds: ${n.downstream.map(d => `${d.name} (from ${d.socket})`).join('; ')}`);
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…` : s);

/** Build the chat messages for a line or a block. */
export function buildExplainPrompt(p: PromptInput): BuiltPrompt {
  const used = factLines(p.facts);
  const ctxParts: string[] = [];
  if (p.node) ctxParts.push(nodeLines(p.node).join('\n'));
  if (p.scope === 'line' && p.enclosing && p.enclosing.trim() !== p.code.trim()) {
    // Only what comes before the line: it tells what the names are. Later lines invite guessing.
    const at = p.enclosing.indexOf(p.code.trim());
    const before = (at >= 0 ? p.enclosing.slice(0, at) : p.enclosing).trim();
    if (before) ctxParts.push(`Earlier lines:\n${before.length > 700 ? `…${before.slice(-700)}` : before}`);
  }
  if (used.length) ctxParts.push(`FACTS (reliable, from a rule-based explainer; its wording can be clumsy):\n${used.map(u => `- ${u}`).join('\n')}`);
  if (p.lineReadings?.length) ctxParts.push(`Rule-based reading of each line:\n${p.lineReadings.map(l => `- ${l.text} => ${l.reading}`).join('\n')}`);
  const context = ctxParts.join('\n\n');

  const task = p.scope === 'line'
    ? 'Explain this line.'
    : blockFormat(codeLines(p.code));
  const body = p.scope === 'line'
    ? `${context}\n\nLine${p.where ? ` (${p.where})` : ''}:\n${p.code.trim()}\n\n${task}`
    : `${context}\n\nCode:\n${numbered(p.code)}\n\n${task}`;
  return {
    messages: p.scope === 'line'
      ? [{ role: 'system', content: SYSTEM_PROMPT }, ...EXAMPLES, { role: 'user', content: body }]
      : [{ role: 'system', content: BLOCK_SYSTEM_PROMPT }, { role: 'user', content: body }],
    maxTokens: p.scope === 'line' ? MAX_TOKENS.line : blockTokens(codeLines(p.code)),
    context,
    used,
  };
}

const codeLines = (code: string) => code.trim().split('\n').filter(l => l.trim()).length;
const numbered = (code: string) => clip(code.trim().split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'), 2400);

// ── Building from a place in the app ──────────────────────────────────────────

export interface ExplainScope {
  /** Node the code belongs to (Expression Block, Custom Function), when it belongs to one. */
  nodeId?: string;
  /** The graph level that node is in (for its neighbours). */
  nodes?: readonly GraphNode[];
  namer?: NodeNamer;
  /** The whole enclosing code (all lines of the block; the function body), for the line's surroundings. */
  enclosing?: string;
  /** "Expression Block" / "Custom Function" / "GLSL page" when there is no node. */
  kind?: string;
  /** Words for where the line is. */
  where?: string;
  ctx?: ExplainContext;
}

/** The node context for a scope (none for the GLSL page or when no graph is known). */
export function scopeNode(s: ExplainScope): NodeContext | undefined {
  if (s.nodeId && s.nodes) return nodeContextFor(s.nodes, s.nodeId, s.namer);
  if (s.kind) return { kind: s.kind, upstream: [], downstream: [], techniques: [] };
  return undefined;
}

/** A line's prompt, built from a scope. */
export function promptForLine(lineText: string, s: ExplainScope): BuiltPrompt {
  const node = scopeNode(s);
  const ctx: ExplainContext = { ...(s.ctx ?? {}), types: { ...typesFromCode(s.enclosing ?? lineText), ...(s.ctx?.types ?? {}) } };
  return buildExplainPrompt({ scope: 'line', code: lineText, enclosing: s.enclosing, where: s.where, node, facts: gatherFacts(lineText, ctx, node) });
}

/** The statements of some code: split at `;` (a function body), or a line each when it has none (an Expression Block's lines). */
export function statementsOf(code: string): Array<{ text: string }> {
  if (code.includes(';')) return splitStatements(code);
  return code.split('\n').map(l => l.trim()).filter(Boolean).map(text => ({ text }));
}

/** A whole block's prompt: its statements, each with the rule-based reading. */
export function promptForBlock(code: string, s: ExplainScope): BuiltPrompt {
  const node = scopeNode(s);
  const ctx: ExplainContext = { ...(s.ctx ?? {}), types: { ...typesFromCode(code), ...(s.ctx?.types ?? {}) } };
  const lineReadings: NonNullable<PromptInput['lineReadings']> = [];
  const facts = noFacts();
  for (const st of statementsOf(code).slice(0, 24)) {
    const ex = explainLine(st.text, ctx);
    if (!ex.ok) continue;
    lineReadings.push({ text: st.text.replace(/\s+/g, ' ').trim(), reading: ex.lead });
    const f = gatherFacts(st.text, ctx);
    facts.idioms.push(...f.idioms); facts.functions.push(...f.functions); facts.names.push(...f.names); facts.colours.push(...f.colours);
  }
  facts.idioms = uniq(facts.idioms).filter(i => !i.startsWith('usually')); facts.functions = uniq(facts.functions); facts.names = uniq(facts.names); facts.colours = uniq(facts.colours);
  if (node) facts.techniques = node.techniques.map(t => `${t.name}: ${t.explain}`);
  // The block's readings are listed per line; the facts here are the shared ones
  return buildExplainPrompt({ scope: 'block', code, node, facts, lineReadings });
}

/** A short stable id for a prompt's context (the cache's second half). */
export const contextHash = (b: BuiltPrompt): string => hashText(b.context);

/** Not used by the prompt, but handy for callers that only have an expression. */
export const readingOf = (expr: string, ctx: ExplainContext = {}): string | undefined => {
  const r = explainExpression(expr, ctx);
  return r.ok ? r.meaning ?? r.sentence : undefined;
};
