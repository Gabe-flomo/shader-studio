/**
 * prompt.ts — what the explanation model is told (docs/explain-model.md "Fact-only context").
 *
 * The model is small, so it is never asked to work things out alone, and it is never told anything a user typed
 * as a label: a node called "Moonlight" made it explain moonlight. Nor is it told the rule-based explainer's
 * readings: they mostly restate the line, and the model then just repackaged them. A code explanation carries
 * only facts:
 *   - the code (the lines up to and including the one asked about; later lines invited guessing),
 *   - its inputs, each traced to what feeds it by node TYPE and output ("from the Normal output of a March Loop
 *     node (vec3, unit length)", "from a Color node: the fixed value (0.8, 0.45, 0.25)"), see inputs.ts,
 *   - what each name a line reads is built from, traced through earlier lines of the block back to the inputs,
 *   - measured numbers: each line's value at a sample pixel and its range across the picture (worked.ts),
 *   - what the block's result feeds, by node type and input,
 *   - what each built-in function it calls does, and colour literals named in words.
 * No node label or title, no graph name, no technique names (those can come from labels).
 * The answer is a small JSON object per line (structured.ts) so each claim can be checked (confidence.ts).
 *
 * Pure: no DOM, no model, no store. The same graph and line always give the same prompt.
 */
import type { GraphNode } from '../types/nodeGraph';
import { allNodes, functionsIn, functionInfo, parseLine, showValue, splitStatements, workedBlock, type BlockInput, type BlockLineNumbers, type ExplainContext } from '../lib/glslPatterns';
import { analyseGraph, techniquesAtNode } from '../patterns/patternIndex';
import { hashText } from './cache';
import { MAX_BLOCK_LINES, MAX_TOKENS, blockTokens } from './config';
import { colourWords, describeInputs, type InputInfo, type NodeDescriber } from './inputs';
import type { GroundingContext } from './confidence';
import type { ChatMessage } from './worker';

export { colourWords } from './inputs';

// ── Where the code lives ──────────────────────────────────────────────────────

export interface Neighbour {
  /** The node TYPE's name ("Distance"), never what the user called it. */
  name: string;
  type: string;
  /** The socket on the code's own node that this one is wired to. */
  socket: string;
  /** Downstream only: the input on the other node that takes it. */
  input?: string;
}

export interface NodeContext {
  /** "Expression Block", "Custom Function", "GLSL page"… */
  kind: string;
  upstream: Neighbour[];
  downstream: Neighbour[];
  /** Techniques the pattern catalogue finds on this node, with their one-line reasons (node explanations only). */
  techniques: Array<{ name: string; explain: string; /** Code lines (normalised) the technique was found in; empty when it spans nodes. */ lines: string[] }>;
}

const MAX_NEIGHBOURS = 6;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

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
    for (const [key, sock] of Object.entries(n.inputs ?? {})) {
      if (sock.connection?.nodeId === nodeId) {
        downstream.push({ name: nameOf(n, namer), type: n.type, socket: sock.connection.outputKey, input: key });
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

const article = (w: string) => (/^[aeio]/i.test(w) ? 'an' : 'a');
const DEFAULT_OUTPUTS = new Set(['result', 'out', 'output', 'value']);

/** What a code node's result feeds, by node TYPE and input: "the Color input of an Output node". */
export function feedsOf(nodes: readonly GraphNode[], nodeId: string, namer?: NodeNamer, describe?: NodeDescriber): string[] {
  return neighboursOf(nodes, nodeId, namer).downstream.map(d => {
    const label = d.input ? describe?.(d.type)?.inputs?.[d.input] ?? d.input : undefined;
    const target = label ? `the ${label} input of ${article(d.name)} ${d.name} node` : `${article(d.name)} ${d.name} node`;
    return DEFAULT_OUTPUTS.has(d.socket) ? target : `its ${d.socket} output goes to ${target}`;
  });
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

/** How the measurements draw the shader-wide names when nothing else says (the GLSL page has no node inputs). */
const GLOBAL_SAMPLES: Record<string, BlockInput> = {
  u_time: { name: 'u_time', type: 'float', value: 2, range: [0, 10] },
  iTime: { name: 'iTime', type: 'float', value: 2, range: [0, 10] },
  vUv: { name: 'vUv', type: 'vec2', value: [0.6, 0.4], range: [0, 1] },
  u_resolution: { name: 'u_resolution', type: 'vec2', value: [1200, 800], range: [800, 1200], fixed: true },
  iResolution: { name: 'iResolution', type: 'vec2', value: [1200, 800], range: [800, 1200], fixed: true },
};

export interface Facts {
  /** The functions it calls: "name: gives …" (functionInfo). */
  functions: string[];
  /** What the shader-wide names it reads are (not the node's inputs, which are described on their own). */
  names: string[];
  /** Colour literals in it, named. */
  colours: string[];
  /** What each name it reads from an earlier line is built from, traced back to the inputs. */
  trace: string[];
  /** Measured numbers: each line's value at the sample pixel and its range across the picture. */
  measured: string[];
}

export const noFacts = (): Facts => ({ functions: [], names: [], colours: [], trace: [], measured: [] });

const ident = /[A-Za-z_]\w*/g;

/** The part of a line after `=` (or the whole line when it has none). */
function exprPart(lineText: string): string {
  const parsed = parseLine(lineText);
  return parsed.ok ? lineText.slice(parsed.line.exprStart) : lineText;
}

const CONSTRUCTORS = /^(float|int|bool|[biu]?vec[234]|mat[234](x[234])?)$/;

/** The functions a piece of code calls, with what each gives. */
export function functionFacts(code: string): string[] {
  const out: string[] = [];
  for (const hit of functionsIn(code)) {
    // Constructors (vec3(…), float(…)) only build a value: saying so is noise
    if (hit.declaration || CONSTRUCTORS.test(hit.name)) continue;
    const info = functionInfo(hit.name);
    if (info) out.push(`${hit.name}: gives ${info.meaning}`);
  }
  return uniq(out);
}

/** The `vec3(r, g, b)` literals in some code, named: "vec3(1.0, 0.8, 0.55) is the colour a light warm orange". */
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

/**
 * The facts of one line that need no block around it: the functions it calls, the shader-wide names it reads and
 * the colours it names. `skipNames`: names the caller describes better (a node's inputs, the block's own variables).
 */
export function gatherFacts(lineText: string, skipNames?: ReadonlySet<string>): Facts {
  const f = noFacts();
  const exprText = exprPart(lineText);
  f.functions = functionFacts(exprText);
  for (const n of uniq(exprText.match(ident) ?? [])) {
    const m = NAME_MEANINGS[n];
    if (m && !skipNames?.has(n)) f.names.push(m);
  }
  f.colours = colourFacts(exprText);
  return f;
}

/** The facts as the list the prompt (and the UI's "facts it was given") shows. */
export function factLines(f: Facts): string[] {
  return [
    ...f.trace.map(s => `Built from: ${s}`),
    ...f.functions.map(s => `Function ${s}`),
    ...f.names.map(s => `Name: ${s}`),
    ...f.colours.map(c => `Colour: ${c}`),
    ...f.measured.map(s => `Measured: ${s}`),
  ];
}

// ── A block, traced and measured ──────────────────────────────────────────────

export interface BlockLine {
  /** The statement as written (squashed). */
  text: string;
  /** The variable it writes (`p` for `p.xy`); undefined for `return` / a bare expression. */
  target?: string;
  /** The names it reads (the target too, for `+=`), in reading order. */
  reads: string[];
  /** Its numbers; null when the code isn't straight-line or the CPU can't evaluate it. */
  numbers: BlockLineNumbers | null;
}

export interface BlockFacts {
  lines: BlockLine[];
  /** For a variable read on line i (0-based), the line that last wrote it before (0-based), else undefined. */
  writerOf: (name: string, before: number) => number | undefined;
  /** How the inputs were drawn for the measurements ("uv = (0.3, 0.2) across -1..1"); empty when nothing was measured. */
  drawn: string[];
}

/** The names an expression reads (not function names, not named constants). */
function readsOf(lineText: string): { target?: string; reads: string[] } {
  const p = parseLine(lineText);
  if (!p.ok) return { reads: uniq(exprPart(lineText).match(ident) ?? []) };
  const names = allNodes(p.line.expr).flatMap(n => (n.kind === 'ident' ? [n.name] : []));
  const target = p.line.target?.split(/[.[]/)[0];
  const compound = !!(target && p.line.op && p.line.op !== '=');
  return { target, reads: uniq([...(compound ? [target!] : []), ...names]).filter(n => n !== 'PI' && n !== 'TAU') };
}

/** How many times the measurements draw the inputs. */
const SAMPLES = 400;

/** Straight-line code only: a loop or a branch makes one pass's numbers meaningless. */
const straightLine = (lines: readonly string[]) => !lines.some(l => /[{}]|^\s*(for|if|else|while|do)\b/.test(l));

const numbersText = (v: BlockLineNumbers): string | null => {
  if (!v.ranges && v.value === null) return null;
  const parts: string[] = [];
  if (v.value !== null) parts.push(`${showValue(v.value)} at the sample pixel`);
  if (v.ranges) {
    const comps = 'xyzw';
    const r = v.ranges.length === 1
      ? `${showValue(v.ranges[0][0])}..${showValue(v.ranges[0][1])}`
      : v.ranges.map(([a, b], i) => `${comps[i]} ${showValue(a)}..${showValue(b)}`).join(', ');
    parts.push(v.ranges.every(([a, b]) => a === b) ? 'the same everywhere' : `across the picture ${r}`);
  }
  return parts.join('; ');
};

/** Trace and measure every line of some code, given its inputs. */
export function analyseBlock(lines: readonly string[], inputs: readonly InputInfo[]): BlockFacts {
  const clean = lines.map(l => l.trim().replace(/;\s*$/, ''));
  const parsed = clean.map(readsOf);
  const inputNames = new Set(inputs.map(i => i.name));
  const draws: BlockInput[] = inputs.map(i => i.sample);
  // Shader-wide names the code reads that no input or line gives
  for (const p of parsed) for (const n of p.reads) if (!inputNames.has(n) && GLOBAL_SAMPLES[n] && !draws.some(d => d.name === n)) draws.push(GLOBAL_SAMPLES[n]);
  const measured = straightLine(clean) ? workedBlock(clean, draws, SAMPLES) : null;
  const writerOf = (name: string, before: number) => {
    for (let j = before - 1; j >= 0; j--) if (parsed[j].target === name) return j;
    return undefined;
  };
  const used = new Set(parsed.flatMap(p => p.reads));
  const drawn = measured
    ? draws.filter(d => used.has(d.name)).map(d => {
      const inp = inputs.find(i => i.name === d.name);
      const fixedValue = d.fixed || d.range[0] === d.range[1];
      if (fixedValue) return `${d.name} = ${showValue(d.value)} (fixed)`;
      const how = d.unit ? 'random unit-length directions' : `${showValue(d.range[0])}..${showValue(d.range[1])}${Array.isArray(d.value) ? ' per component' : ''}${inp?.assumed ? ` (assumed: ${inp.assumed})` : ''}`;
      return `${d.name} = ${showValue(d.value)} at the sample pixel, drawn over ${how}`;
    })
    : [];
  return {
    lines: clean.map((text, i) => ({ text: squash(text), target: parsed[i].target, reads: parsed[i].reads, numbers: measured?.[i] ?? null })),
    writerOf,
    drawn,
  };
}

/** What `name`, read on line `at` (0-based), is built from: the inputs it traces back to, through earlier lines. */
function rootsOf(b: BlockFacts, name: string, at: number, inputNames: ReadonlySet<string>, seen = new Set<string>()): string[] {
  const key = `${name}@${at}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const j = b.writerOf(name, at);
  if (j === undefined) return inputNames.has(name) ? [name] : [];
  return uniq(b.lines[j].reads.flatMap(r => rootsOf(b, r, j, inputNames, seen)));
}

/** "sky: made on line 1 (float sky = 0.5 + 0.5 * n.y), from the input n (the Normal output of a March Loop node)". */
export function traceFacts(b: BlockFacts, at: number, inputs: readonly InputInfo[]): string[] {
  const names = new Set(inputs.map(i => i.name));
  const out: string[] = [];
  for (const r of b.lines[at]?.reads ?? []) {
    const j = b.writerOf(r, at);
    if (j === undefined) continue;
    const roots = rootsOf(b, r, at, names);
    const from = roots.length
      ? `from the input${roots.length > 1 ? 's' : ''} ${roots.map(n => `${n} (${inputs.find(i => i.name === n)?.source ?? 'an input'})`).join(' and ')}`
      : 'from numbers in the code only';
    out.push(`${r}: made on line ${j + 1} (${b.lines[j].text}), ${from}`);
  }
  return out;
}

/** The inputs line `at` (0-based) depends on, directly or through earlier lines. */
function inputsOfLine(b: BlockFacts, at: number, inputNames: ReadonlySet<string>): string[] {
  return uniq((b.lines[at]?.reads ?? []).flatMap(r => rootsOf(b, r, at, inputNames)));
}

/**
 * "line 2, halo: 0.82 at the sample pixel; across the picture 0.05..1". A line built from an input whose range is a
 * guess says so, and never claims to be "the same everywhere" (that would only be true of the guess).
 */
export function measuredFacts(b: BlockFacts, upTo: number, from = 0, inputs: readonly InputInfo[] = []): string[] {
  const out: string[] = [];
  const names = new Set(inputs.map(i => i.name));
  for (let i = from; i <= upTo && i < b.lines.length; i++) {
    const l = b.lines[i];
    if (!l.numbers) continue;
    const roots = inputsOfLine(b, i, names);
    const guessed = roots.filter(n => inputs.find(x => x.name === n)?.assumed);
    let t = numbersText(l.numbers);
    if (!t) continue;
    if (roots.some(n => inputs.find(x => x.name === n)?.clock)) t = t.replace('across the picture', 'across the picture and over time');
    // Only fixed inputs (or none) make it truly the same everywhere; otherwise the samples may have missed a small area
    if (!guessed.length && roots.some(n => !inputs.find(x => x.name === n)?.sample.fixed)) {
      t = t.replace('the same everywhere', `the same at every one of ${SAMPLES} sampled points (a small area could still differ)`);
    }
    if (guessed.length) t = `${t.replace('the same everywhere', 'no change over the guessed range')} (a guess: ${guessed.join(', ')} assumed to run 0..1)`;
    out.push(`line ${i + 1}${l.target ? `, ${l.target}` : /^return\b/.test(l.text) ? ', the result' : ''}: ${t}`);
  }
  return out;
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
  /** What each input is, traced by type (inputs.ts). */
  inputs?: InputInfo[];
  /** What the block's result feeds, by node type. */
  feeds?: string[];
  facts: Facts;
  /** For a block: each line's own facts (trace and measured numbers), by line number. */
  perLine?: Array<{ line: number; facts: string[] }>;
  /** How the inputs were drawn for the measured numbers. */
  drawn?: string[];
  /** Each code line's measured spread (for the grounding check), 1-based line n at n-1. */
  ranges?: GroundingContext['ranges'];
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
  'Be short: "what" and "effect" are one short sentence each. Do not repeat the code, and do not read it out symbol by symbol: say what the numbers mean for the picture. ' +
  'Use only the inputs, code and FACTS you are given (where each value comes from, the measured numbers, what functions do): never invent names, numbers, colours or purposes, and never contradict the FACTS. ' +
  'Say "high" only when the facts make the effect clear, "low" when you are guessing. "unsure_about" must be empty unless something in the line really cannot be told from the facts.';

/** Worked examples, as earlier turns of the chat: the small model copies their length, tone and shape. */
export const EXAMPLES: ChatMessage[] = [
  {
    role: 'user',
    content: 'Kind: Expression Block\nInputs (each traced to what feeds it):\n- d: float, from a Length node: distance from the origin of a vector (0 or more)\n\nCode:\n1: float g = exp(-d * 4.0)\n\nFACTS about line 1 (looked up or measured, reliable):\n- Function exp: gives eˣ: 1 at 0, dying away toward 0 below\n- Measured: line 1, g: 0.2 at the sample pixel; across the picture 0.0025..1\n\nExplain line 1 only.',
  },
  {
    role: 'assistant',
    content: '{"line":1,"what":"Turns the distance d into a value that is 1 at distance 0 and drops quickly towards 0.","effect":"A soft glow: brightest at the shape and fading away from it; the 4.0 sets how tightly it hugs the shape.","sure":"high","unsure_about":""}',
  },
  {
    role: 'user',
    content: 'Kind: Expression Block\nInputs (each traced to what feeds it):\n- n: vec3, from the Normal output of a March Loop node (vec3, unit length): the direction the surface faces where the ray hit\n- t: float, built in: time in seconds since start; it grows without limit\n\nCode:\n1: float sky = 0.5 + 0.5 * n.y\n2: vec3 col = mix(vec3(0.2, 0.15, 0.1), vec3(0.6, 0.8, 1.0), sky)\n\nFACTS about line 2 (looked up or measured, reliable):\n- Built from: sky: made on line 1 (float sky = 0.5 + 0.5 * n.y), from the input n (the Normal output of a March Loop node)\n- Function mix: gives a blend from x (at a = 0) to y (at a = 1)\n- Colour: vec3(0.2, 0.15, 0.1) is the colour a dark warm orange (red, green, blue)\n- Colour: vec3(0.6, 0.8, 1.0) is the colour a light cool blue (red, green, blue)\n- Measured: line 1, sky: 0.9 at the sample pixel; across the picture 0..1\n\nExplain line 2 only.',
  },
  {
    role: 'assistant',
    content: '{"line":2,"what":"Blends from a dark warm brown to a light blue by sky, which is 1 where the surface faces up and 0 where it faces down.","effect":"Upward-facing parts of the surface take the sky blue and downward-facing parts the dark ground colour, like light from above.","sure":"high","unsure_about":""}',
  },
  {
    role: 'user',
    content: 'Kind: Custom Function\nInputs (each traced to what feeds it):\n- h: float, from a Fractal Noise (FBM) node: smooth noise value, range 0..1\n\nCode:\n1: float m = step(0.6, h)\n\nFACTS about line 1 (looked up or measured, reliable):\n- Function step: gives a hard switch: 0 while x is below edge, 1 from edge on\n- Measured: line 1, m: 0 at the sample pixel; across the picture 0..1\n\nExplain line 1 only.',
  },
  {
    role: 'assistant',
    content: '{"line":1,"what":"1 where the noise value h is 0.6 or more, and 0 below that.","effect":"A hard-edged on/off mask that keeps only the brightest patches of the noise.","sure":"high","unsure_about":""}',
  },
];

export const BLOCK_SYSTEM_PROMPT =
  'You explain shader code (GLSL) to a visual artist who is learning it. ' +
  'Reply with JSON objects, one per row, and nothing else. First one object for each code line, in order: ' +
  '{"line": <number>, "what": "<what the line computes, in plain words>", "effect": "<what it does to the picture>", "sure": "high|medium|low", "unsure_about": "<what you are unsure about, or empty>"}. ' +
  'Then, last, {"summary": "<two short sentences: what the whole block is for: what it makes from its inputs, and what that does to the picture>"}. ' +
  'Be short: one short sentence per field. Do not repeat the code, and do not read it out symbol by symbol. ' +
  'Use only the inputs, code and FACTS you are given (where each value comes from, the measured numbers, what functions do): never invent names, numbers, colours or purposes, and never contradict the FACTS. ' +
  'Say "high" only when the facts make the effect clear, "low" when you are guessing. "unsure_about" must be empty unless something in the line really cannot be told from the facts.';

function inputLines(inputs: readonly InputInfo[] | undefined): string[] {
  if (!inputs?.length) return ['Inputs: none'];
  return ['Inputs (each traced to what feeds it):', ...inputs.map(i => `- ${i.text}`)];
}

function feedLines(feeds: readonly string[] | undefined): string[] {
  return feeds?.length ? [`The block's result feeds: ${feeds.join('; ')}`] : [];
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

const FACTS_NOTE = 'looked up or measured, reliable';

/** Build the chat messages for a line or a block. */
export function buildExplainPrompt(p: PromptInput): BuiltPrompt {
  const inputInfo = p.inputs ?? [];
  const kind = p.kind ?? 'GLSL';
  const factBlock = factLines(p.facts);
  const perLine = (p.perLine ?? []).flatMap(l => l.facts.map(f => `Line ${l.line}: ${f}`));
  const drawn = p.drawn?.length ? [`Sample pixel and ranges used for the measured numbers: ${p.drawn.join('; ')}`] : [];
  const used = [...inputInfo.map(i => `Input ${i.text}`), ...feedLines(p.feeds), ...factBlock, ...perLine, ...drawn];
  const lines = rawLines(p.scope === 'block' ? p.code : p.enclosing?.trim() ? p.enclosing : p.code);
  const check: GroundingContext = {
    lines,
    code: lines.join('\n'),
    inputs: inputInfo.map(i => ({ name: i.name, type: i.type, numbers: i.numbers })),
    inputText: [...inputInfo.map(i => i.text), ...feedLines(p.feeds)].join('\n'),
    factsText: [...factBlock, ...perLine, ...drawn].join('\n'),
    colourFacts: p.facts.colours,
    ranges: p.ranges,
  };
  const head = [`Kind: ${kind}`, ...inputLines(inputInfo), ...feedLines(p.feeds)].join('\n');

  if (p.scope === 'line') {
    const lineNo = lineNumberOf(p.code, p.enclosing, p.where);
    // The code: only up to and including the line (the rest invites guessing); the line itself is the one we were given
    const before = rawLines(p.enclosing ?? '').slice(0, Math.max(0, lineNo - 1));
    const upTo = [...before, p.code.trim()].slice(-14);
    const first = lineNo - (upTo.length - 1);
    const all = [...factBlock, ...drawn];
    const facts = all.length ? `\n\nFACTS about line ${lineNo} (${FACTS_NOTE}):\n${all.map(u => `- ${u}`).join('\n')}` : '';
    const context = `${head}\n\nCode:\n${numbered(upTo.slice(0, -1), first)}${facts}`;
    const body = `${head}\n\nCode:\n${numbered(upTo, first)}${facts}\n\nExplain line ${lineNo} only.`;
    return {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...EXAMPLES, { role: 'user', content: body }],
      maxTokens: MAX_TOKENS.line, context, used, check, lineNo,
    };
  }

  const n = Math.min(lines.length, MAX_BLOCK_LINES);
  const parts = [head];
  const shared = [...factBlock, ...drawn];
  if (shared.length) parts.push(`FACTS (${FACTS_NOTE}):\n${shared.map(u => `- ${u}`).join('\n')}`);
  if (perLine.length) parts.push(`FACTS about each line (${FACTS_NOTE}):\n${perLine.map(u => `- ${u}`).join('\n')}`);
  const context = parts.join('\n\n');
  const task = `Reply with ${n === 1 ? 'one object for line 1' : `one object for each of lines 1 to ${n}`}, one per row, then the summary object last.`;
  return {
    messages: [{ role: 'system', content: BLOCK_SYSTEM_PROMPT }, { role: 'user', content: `${clip(context, 4200)}\n\nCode:\n${clip(numbered(lines), 2400)}\n\n${task}` }],
    maxTokens: blockTokens(lines.length), context, used, check,
  };
}

// ── Building from a place in the app ──────────────────────────────────────────

export interface ExplainScope {
  /** Node the code belongs to (Expression Block, Custom Function), when it belongs to one. */
  nodeId?: string;
  /** The graph level that node is in (for its inputs). */
  nodes?: readonly GraphNode[];
  /** Node type → its name; node type → what the registry says about it. Registry-owned, never user labels. */
  namer?: NodeNamer;
  describe?: NodeDescriber;
  /** The whole enclosing code (all lines of the block; the function body), for the line's surroundings. */
  enclosing?: string;
  /** "Expression Block" / "Custom Function" / "GLSL page" when there is no node. */
  kind?: string;
  /** Words for where the line is. */
  where?: string;
  /** Kept for callers that pass it; the prompt no longer uses the rule-based explainer's context. */
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

/** What the scope's node feeds (none for the GLSL page). */
export function scopeFeeds(s: ExplainScope): string[] {
  return s.nodeId && s.nodes ? feedsOf(s.nodes, s.nodeId, s.namer, s.describe) : [];
}

/** Names the prompt describes better than the generic guess: the inputs and the code's own variables. */
function describedNames(inputs: readonly InputInfo[], b: BlockFacts): Set<string> {
  return new Set([...inputs.map(i => i.name), ...b.lines.flatMap(l => (l.target ? [l.target] : []))]);
}

const rangesOf = (b: BlockFacts): GroundingContext['ranges'] => b.lines.map(l => l.numbers?.ranges ?? null);

/** A line's prompt, built from a scope. */
export function promptForLine(lineText: string, s: ExplainScope): BuiltPrompt {
  const inputs = scopeInputs(s);
  const enclosing = s.enclosing?.trim() ? s.enclosing : lineText;
  const all = rawLines(enclosing);
  const lineNo = lineNumberOf(lineText, s.enclosing, s.where);
  // The code up to the line, with the line as given (the block may have changed since `enclosing` was read)
  const upTo = [...all.slice(0, lineNo - 1), lineText.trim()];
  const b = analyseBlock(upTo, inputs);
  const at = upTo.length - 1;
  const facts = gatherFacts(lineText, describedNames(inputs, b));
  facts.trace = traceFacts(b, at, inputs);
  facts.measured = measuredFacts(b, at, 0, inputs);
  return buildExplainPrompt({
    scope: 'line', code: lineText, enclosing: s.enclosing, where: s.where, kind: scopeKind(s), inputs, feeds: scopeFeeds(s),
    facts, drawn: facts.measured.length ? b.drawn : [], ranges: rangesOf(b),
  });
}

/** The statements of some code: split at `;` (a function body), or a line each when it has none (an Expression Block's lines). */
export function statementsOf(code: string): Array<{ text: string }> {
  if (code.includes(';')) return splitStatements(code);
  return code.split('\n').map(l => l.trim()).filter(Boolean).map(text => ({ text }));
}

/** A whole block's prompt: shared facts (functions, colours), and each line's trace and measured numbers. */
export function promptForBlock(code: string, s: ExplainScope): BuiltPrompt {
  const inputs = scopeInputs(s);
  const lines = rawLines(code);
  const b = analyseBlock(lines, inputs);
  const skip = describedNames(inputs, b);
  const facts = noFacts();
  for (const l of lines.slice(0, 24)) {
    const f = gatherFacts(l, skip);
    facts.functions.push(...f.functions); facts.names.push(...f.names); facts.colours.push(...f.colours);
  }
  facts.functions = uniq(facts.functions); facts.names = uniq(facts.names); facts.colours = uniq(facts.colours);
  const perLine: NonNullable<PromptInput['perLine']> = [];
  for (let i = 0; i < Math.min(lines.length, MAX_BLOCK_LINES); i++) {
    const own = [...traceFacts(b, i, inputs).map(t => `built from ${t}`), ...measuredFacts(b, i, i, inputs).map(m => `measured ${m.replace(/^line \d+, /, '').replace(/^line \d+: /, '')}`)];
    if (own.length) perLine.push({ line: i + 1, facts: own });
  }
  const measuredAny = b.lines.some(l => l.numbers?.value != null || l.numbers?.ranges);
  return buildExplainPrompt({ scope: 'block', code, kind: scopeKind(s), inputs, feeds: scopeFeeds(s), facts, perLine, drawn: measuredAny ? b.drawn : [], ranges: rangesOf(b) });
}

/** A short stable id for a prompt's context (the cache's second half). */
export const contextHash = (b: BuiltPrompt): string => hashText(b.context);
