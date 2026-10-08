/**
 * prompt.ts — what the explanation model is told (docs/explain-model.md "How the grounding works").
 *
 * The model is small, so it is never asked to work things out alone, and it is never told anything a user typed
 * as a label: a node called "Moonlight" made it explain moonlight. A code explanation (a line, a block) carries ONLY:
 *   - the code (the lines up to and including the one asked about; later lines invited guessing),
 *   - its inputs: name, type and what each really is, described by TYPE ("from UV", "range 0..1"), see inputs.ts,
 *   - FACTS our rule-based explainer derives from the code itself: the plain reading, the idioms in it, what each
 *     function it calls does, colour literals named in words,
 *   - the line, with its number.
 * No node label or title, no graph name, no neighbour labels, no technique names (those can come from labels).
 * The answer is a small JSON object per line (structured.ts) so each claim can be checked (confidence.ts).
 *
 * Pure: no DOM, no model, no store. The same graph and line always give the same prompt.
 */
import type { GraphNode } from '../types/nodeGraph';
import { explainLine, explainExpression, functionsIn, functionInfo, parseLine, splitStatements, typesFromCode, type ExplainContext } from '../lib/glslPatterns';
import { analyseGraph, techniquesAtNode } from '../patterns/patternIndex';
import { hashText } from './cache';
import { MAX_BLOCK_LINES, MAX_TOKENS, blockTokens } from './config';
import { describeInputs, type InputInfo, type NodeDescriber } from './inputs';
import type { GroundingContext } from './confidence';
import type { ChatMessage } from './worker';

// ── Where the code lives ──────────────────────────────────────────────────────

export interface Neighbour {
  /** The node TYPE's name ("Distance"), never what the user called it. */
  name: string;
  type: string;
  /** The socket on the code's own node that this one is wired to. */
  socket: string;
}

export interface NodeContext {
  /** "Expression Block", "Custom Function", "GLSL page"… */
  kind: string;
  upstream: Neighbour[];
  downstream: Neighbour[];
  /** Techniques the pattern catalogue finds on this node, with their one-line reasons. */
  techniques: Array<{ name: string; explain: string; /** Code lines (normalised) the technique was found in; empty when it spans nodes. */ lines: string[] }>;
}

const MAX_NEIGHBOURS = 6;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Names for a node type: the registry's label. Injected so this file stays free of the node registry. */
export type NodeNamer = (type: string) => string | undefined;

/** A node's TYPE name. User labels are deliberately never used: they steer a small model into explaining the label. */
const nameOf = (n: GraphNode, namer?: NodeNamer): string =>
  namer?.(n.type) ?? (n.type === 'exprNode' ? 'Expression Block' : n.type === 'customFn' ? 'Custom Function' : n.type);

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

/** The node context for a node in a graph: neighbours (by type) plus the techniques found on it. */
export function nodeContextFor(nodes: readonly GraphNode[], nodeId: string, namer?: NodeNamer): NodeContext | undefined {
  const me = nodes.find(n => n.id === nodeId);
  if (!me) return undefined;
  let techniques: NodeContext['techniques'] = [];
  try {
    const gp = analyseGraph({ id: 'open:', label: 'open graph', origin: 'open', nodes });
    techniques = techniquesAtNode(gp, nodeId).map(t => ({ name: t.technique.name, explain: t.technique.explain, lines: t.hits.flatMap(h => (h.line ? [squash(h.line)] : [])) }));
  } catch (e) { console.warn('[explain model] patterns', e); }
  return { kind: nameOf(me, namer), ...neighboursOf(nodes, nodeId, namer), techniques };
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
  /** Techniques found on the node: "name: why". Not used by code explanations (see the header). */
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

/**
 * Everything the rule-based explainer knows about one line: plain strings, ready for a prompt (and the UI's "facts used").
 * `skipNames`: names whose meaning the caller states better (a node's inputs), so the generic guess ("t is the clock") is left out.
 */
export function gatherFacts(lineText: string, ctx: ExplainContext = {}, node?: NodeContext, skipNames?: ReadonlySet<string>): Facts {
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
    if (m && !skipNames?.has(n)) f.names.push(m);
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
  /** Where the line is, if the number can't be found in the code: "line 3 of the block". */
  where?: string;
  /** "Expression Block", "Custom Function", "GLSL page". Never a user label. */
  kind?: string;
  /** What each input is, by type (inputs.ts). */
  inputs?: InputInfo[];
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
  /** What the answer is checked against (confidence.ts). Absent for node explanations. */
  check?: GroundingContext;
  /** The line asked about, 1-based (line scope). */
  lineNo?: number;
}

export const SYSTEM_PROMPT =
  'You explain one line of shader code (GLSL) to a visual artist who is learning it. ' +
  'Reply with ONE JSON object and nothing else: {"line": <number>, "what": "<what the line computes, in plain words>", "effect": "<what it does to the picture>", "sure": "high|medium|low", "unsure_about": "<what you are unsure about, or empty>"}. ' +
  'Be short: "what" and "effect" are one short sentence each. Do not repeat the code. ' +
  'Use only the inputs, code and FACTS you are given: never invent names, numbers, colours or purposes, and never contradict the FACTS. ' +
  'Say "high" only when the facts make the effect clear, "low" when you are guessing. "unsure_about" must be empty unless something in the line really cannot be told from the facts.';

/** Worked examples, as earlier turns of the chat: the small model copies their length, tone and shape. */
export const EXAMPLES: ChatMessage[] = [
  {
    role: 'user',
    content: 'Kind: Expression Block\nInputs:\n- d: float, from Length (output Output): distance from the origin of a vector (0 or more)\n\nCode:\n1: float g = exp(-d * 4.0)\n\nFACTS about line 1 (reliable):\n- Idiom: Exponential glow: 1 right at the edge, fading quickly and smoothly to 0 further away\n\nExplain line 1 only.',
  },
  {
    role: 'assistant',
    content: '{"line":1,"what":"Turns the distance d into a value that is 1 at distance 0 and drops smoothly towards 0.","effect":"A soft glow: brightest at the shape and fading away from it; the 4.0 sets how tightly it hugs the shape.","sure":"high","unsure_about":""}',
  },
  {
    role: 'user',
    content: 'Kind: Expression Block\nInputs:\n- uv: vec2, from UV: pixel position, centred: (0,0) is the middle of the picture, x and y run about -1..1 (x is widened by the aspect ratio)\n- t: float, built in: time in seconds since start; it grows without limit\n\nCode:\n1: float a = uv.x * 6.0\n2: float w = sin(a - t * 2.0)\n\nFACTS about line 2 (reliable):\n- Function sin: gives the sine wave of an angle, repeating every 6.28\n\nExplain line 2 only.',
  },
  {
    role: 'assistant',
    content: '{"line":2,"what":"A sine wave of the horizontal position a, shifted by the clock t.","effect":"Vertical stripes that slide sideways over time, with values between -1 and 1.","sure":"medium","unsure_about":"how w is used on the next line"}',
  },
  {
    role: 'user',
    content: 'Kind: Custom Function\nInputs:\n- h: float, from Fractal Noise (FBM): smooth noise value, range 0..1\n\nCode:\n1: float m = step(0.6, h)\n\nFACTS about line 1 (reliable):\n- Function step: gives a hard switch: 0 while x is below edge, 1 from edge on\n- Types: h: float\n\nExplain line 1 only.',
  },
  {
    role: 'assistant',
    content: '{"line":1,"what":"1 where the noise value h is 0.6 or more, and 0 below that.","effect":"A hard-edged on/off mask that keeps only the brightest patches of the noise.","sure":"high","unsure_about":""}',
  },
];

export const BLOCK_SYSTEM_PROMPT =
  'You explain shader code (GLSL) to a visual artist who is learning it. ' +
  'Reply with JSON objects, one per line, and nothing else. First {"summary": "<two short sentences: what the whole piece does to the picture>"}, then one object for each code line, in order: ' +
  '{"line": <number>, "what": "<what the line computes, in plain words>", "effect": "<what it does to the picture>", "sure": "high|medium|low", "unsure_about": "<what you are unsure about, or empty>"}. ' +
  'Be short: one short sentence per field. Do not repeat the code. ' +
  'Use only the inputs, code and FACTS you are given: never invent names, numbers, colours or purposes, and never contradict the FACTS. ' +
  'Say "high" only when the facts make the effect clear, "low" when you are guessing. "unsure_about" must be empty unless something in the line really cannot be told from the facts.';

function inputLines(inputs: readonly InputInfo[] | undefined): string[] {
  if (!inputs?.length) return ['Inputs: none'];
  return ['Inputs:', ...inputs.map(i => `- ${i.text}`)];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…` : s);
const rawLines = (code: string) => code.trim().split('\n').filter(l => l.trim());
const numbered = (lines: readonly string[], from = 1) => lines.map((l, i) => `${from + i}: ${l.trim()}`).join('\n');

/** Which line of `enclosing` is `lineText` (1-based): by text, else from the "line N" in `where`, else 1. */
export function lineNumberOf(lineText: string, enclosing: string | undefined, where?: string): number {
  const want = squash(lineText);
  if (enclosing?.trim()) {
    const lines = rawLines(enclosing).map(squash);
    let at = lines.findIndex(l => l === want);
    if (at < 0) at = lines.findIndex(l => want && l.includes(want));
    if (at >= 0) return at + 1;
  }
  const m = /line (\d+)/i.exec(where ?? '');
  return m ? Math.max(1, Number(m[1])) : 1;
}

/** Build the chat messages for a line or a block. */
export function buildExplainPrompt(p: PromptInput): BuiltPrompt {
  const inputInfo = p.inputs ?? [];
  const used = [...inputInfo.map(i => `Input ${i.text}`), ...factLines(p.facts)];
  const kind = p.kind ?? 'GLSL';
  const factBlock = factLines(p.facts);
  const lines = rawLines(p.scope === 'block' ? p.code : p.enclosing?.trim() ? p.enclosing : p.code);
  const check: GroundingContext = {
    lines,
    code: lines.join('\n'),
    inputs: inputInfo.map(i => ({ name: i.name, type: i.type, numbers: i.numbers })),
    inputText: inputInfo.map(i => i.text).join('\n'),
    factsText: factBlock.join('\n'),
    colourFacts: p.facts.colours,
  };

  if (p.scope === 'line') {
    const lineNo = lineNumberOf(p.code, p.enclosing, p.where);
    // The code: only up to and including the line (the rest invites guessing); the line itself is the one we were given
    const before = rawLines(p.enclosing ?? '').slice(0, Math.max(0, lineNo - 1));
    const upTo = [...before, p.code.trim()].slice(-14);
    const first = lineNo - (upTo.length - 1);
    const head = [`Kind: ${kind}`, ...inputLines(inputInfo)].join('\n');
    const facts = factBlock.length ? `\n\nFACTS about line ${lineNo} (reliable, from a rule-based explainer; its wording can be clumsy):\n${factBlock.map(u => `- ${u}`).join('\n')}` : '';
    const context = `${head}\n\nCode:\n${numbered(upTo.slice(0, -1), first)}${facts}`;
    const body = `${head}\n\nCode:\n${numbered(upTo, first)}${facts}\n\nExplain line ${lineNo} only.`;
    return {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...EXAMPLES, { role: 'user', content: body }],
      maxTokens: MAX_TOKENS.line, context, used, check, lineNo,
    };
  }

  const n = Math.min(lines.length, MAX_BLOCK_LINES);
  const head = [`Kind: ${kind}`, ...inputLines(inputInfo)].join('\n');
  const parts = [head];
  if (factBlock.length) parts.push(`FACTS (reliable, from a rule-based explainer; its wording can be clumsy):\n${factBlock.map(u => `- ${u}`).join('\n')}`);
  if (p.lineReadings?.length) parts.push(`Rule-based reading of each statement:\n${p.lineReadings.map(l => `- ${l.text} => ${l.reading}`).join('\n')}`);
  const context = parts.join('\n\n');
  const task = `Reply with the summary object, then ${n === 1 ? 'one object for line 1' : `one object for each of lines 1 to ${n}`}, one per row.`;
  return {
    messages: [{ role: 'system', content: BLOCK_SYSTEM_PROMPT }, { role: 'user', content: `${context}\n\nCode:\n${clip(numbered(lines), 2400)}\n\n${task}` }],
    maxTokens: blockTokens(lines.length), context, used, check,
  };
}

// ── Building from a place in the app ──────────────────────────────────────────

export interface ExplainScope {
  /** Node the code belongs to (Expression Block, Custom Function), when it belongs to one. */
  nodeId?: string;
  /** The graph level that node is in (for its inputs). */
  nodes?: readonly GraphNode[];
  /** Node type → its name; node type → its registry description (for the inputs' meaning). Registry-owned, never user labels. */
  namer?: NodeNamer;
  describe?: NodeDescriber;
  /** The whole enclosing code (all lines of the block; the function body), for the line's surroundings. */
  enclosing?: string;
  /** "Expression Block" / "Custom Function" / "GLSL page" when there is no node. */
  kind?: string;
  /** Words for where the line is. */
  where?: string;
  ctx?: ExplainContext;
}

/** The kind of code a scope holds, by node type, never by label. */
export function scopeKind(s: ExplainScope): string | undefined {
  const me = s.nodeId && s.nodes?.find(n => n.id === s.nodeId);
  if (me) return nameOf(me, s.namer);
  return s.kind;
}

/** The inputs of the node a scope belongs to (none for the GLSL page). */
export function scopeInputs(s: ExplainScope): InputInfo[] {
  return s.nodeId && s.nodes ? describeInputs(s.nodes, s.nodeId, s.describe) : [];
}

/** A line's prompt, built from a scope. */
export function promptForLine(lineText: string, s: ExplainScope): BuiltPrompt {
  const inputs = scopeInputs(s);
  const ctx: ExplainContext = { ...(s.ctx ?? {}), types: { ...typesFromCode(s.enclosing ?? lineText), ...(s.ctx?.types ?? {}) } };
  const skip = new Set(inputs.map(i => i.name));
  return buildExplainPrompt({ scope: 'line', code: lineText, enclosing: s.enclosing, where: s.where, kind: scopeKind(s), inputs, facts: gatherFacts(lineText, ctx, undefined, skip) });
}

/** The statements of some code: split at `;` (a function body), or a line each when it has none (an Expression Block's lines). */
export function statementsOf(code: string): Array<{ text: string }> {
  if (code.includes(';')) return splitStatements(code);
  return code.split('\n').map(l => l.trim()).filter(Boolean).map(text => ({ text }));
}

/** A whole block's prompt: its lines, each with the rule-based reading. */
export function promptForBlock(code: string, s: ExplainScope): BuiltPrompt {
  const inputs = scopeInputs(s);
  const ctx: ExplainContext = { ...(s.ctx ?? {}), types: { ...typesFromCode(code), ...(s.ctx?.types ?? {}) } };
  const skip = new Set(inputs.map(i => i.name));
  const lineReadings: NonNullable<PromptInput['lineReadings']> = [];
  const facts = noFacts();
  for (const st of statementsOf(code).slice(0, 24)) {
    const ex = explainLine(st.text, ctx);
    if (!ex.ok) continue;
    lineReadings.push({ text: st.text.replace(/\s+/g, ' ').trim(), reading: ex.lead });
    const f = gatherFacts(st.text, ctx, undefined, skip);
    facts.idioms.push(...f.idioms); facts.functions.push(...f.functions); facts.names.push(...f.names); facts.colours.push(...f.colours);
  }
  facts.idioms = uniq(facts.idioms).filter(i => !i.startsWith('usually')); facts.functions = uniq(facts.functions); facts.names = uniq(facts.names); facts.colours = uniq(facts.colours);
  // The block's readings are listed per line; the facts here are the shared ones
  return buildExplainPrompt({ scope: 'block', code, kind: scopeKind(s), inputs, facts, lineReadings });
}

/** A short stable id for a prompt's context (the cache's second half). */
export const contextHash = (b: BuiltPrompt): string => hashText(b.context);

/** Not used by the prompt, but handy for callers that only have an expression. */
export const readingOf = (expr: string, ctx: ExplainContext = {}): string | undefined => {
  const r = explainExpression(expr, ctx);
  return r.ok ? r.meaning ?? r.sentence : undefined;
};
