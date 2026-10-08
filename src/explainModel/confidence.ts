/**
 * confidence.ts — how far to trust an explanation, measured (docs/explain-model.md "Confidence").
 *
 * A 1.5B model's "sure: high" means little: it says high about wrong answers. So the level shown is the lowest of
 * several independent signals, and the tooltip says which one pulled it down:
 *
 *   1. what the model said about itself (`sure`, `unsure_about`);
 *   2. token probabilities of the answer's own words (mean and weakest), measured from the model's logits;
 *   3. a grounding check: names, numbers and colours in the answer that the code, the inputs and the facts do not
 *      have, or that contradict the facts (it says "sin" but the line has no sin);
 *   4. optionally, a double-check: ask twice more at temperature 0.7 and see whether the answers agree.
 *
 * Pure: no model here. Thresholds are the constants below, set from the trial in docs/reports/explain-model-trial.md.
 */
import { BUILTIN_FUNCTION_NAMES } from '../lib/glslPatterns/functions';
import type { ExplainItem, Sure } from './structured';

export type Level = 'high' | 'medium' | 'low';

// ── Token probabilities ───────────────────────────────────────────────────────

export interface TokenLp { t: string; lp: number }
export interface LogprobStats {
  /** Mean natural-log probability of the tokens (0 = certain; -0.5 ≈ 60% on average). */
  mean: number;
  /** The weakest token's log-probability. */
  min: number;
  n: number;
}

/** Thresholds, in nats. Set from the trial (docs/reports/explain-model-trial.md). */
export const THRESHOLDS = {
  /** Mean log-prob of the answer's own words (not the JSON scaffolding): at or above this is "steady" (about 55% per word); below `meanLow` (about 37%) is "guessing". */
  meanMedium: -0.6,
  meanLow: -1.0,
  /** One very unlikely token (a coin-flip in a key place) caps the level at medium. */
  minMedium: -3.5,
  /** Two samples' agreement (0..1): below this they disagree. */
  agreeLow: 0.3,
  agreeMedium: 0.45,
} as const;

/** Mean / weakest log-prob of the tokens inside `spans` of `text` (all tokens when the pieces don't line up). */
export function logprobStats(tokens: readonly TokenLp[] | undefined, text: string, spans?: ReadonlyArray<readonly [number, number]>): LogprobStats | null {
  if (!tokens?.length) return null;
  let chosen = tokens;
  if (spans?.length && tokens.map(x => x.t).join('') === text) {
    let pos = 0;
    const inside: TokenLp[] = [];
    for (const tk of tokens) {
      const a = pos, b = pos + tk.t.length;
      pos = b;
      if (spans.some(([s, e]) => a < e && b > s)) inside.push(tk);
    }
    if (inside.length) chosen = inside;
  }
  const finite = chosen.filter(x => Number.isFinite(x.lp));
  if (!finite.length) return null;
  return { mean: finite.reduce((s, x) => s + x.lp, 0) / finite.length, min: Math.min(...finite.map(x => x.lp)), n: finite.length };
}

// ── Grounding ─────────────────────────────────────────────────────────────────

export interface GroundingContext {
  /** The code, one entry per non-empty line (1-based line n is `lines[n-1]`). */
  lines: string[];
  code: string;
  inputs: Array<{ name: string; type: string; numbers: number[] }>;
  inputText: string;
  factsText: string;
  /** Colour facts: "vec3(1.0, 0.8, 0.55) is the colour a light warm orange (red, green, blue)". */
  colourFacts: string[];
}

export interface GroundingIssue {
  kind: 'identifier' | 'number' | 'function' | 'colour' | 'line';
  /** Plain words for the tooltip. */
  detail: string;
  /** A contradiction of the code or the facts, not just something that isn't there. */
  contradiction: boolean;
}

const WORD = /[A-Za-z_]\w*/g;
const BUILTINS = new Set<string>(BUILTIN_FUNCTION_NAMES);
const SWIZZLE = /^[xyzwrgbastpq]{1,4}$/;
const GLSL_WORDS = new Set(['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4', 'int', 'bool', 'return', 'if', 'else', 'for', 'while', 'true', 'false', 'const', 'uniform', 'in', 'out', 'void', 'PI', 'TAU', 'u_time', 'u_resolution', 'u_mouse', 'gl_FragCoord', 'vUv']);

/** Function names a person would say as plain words: a bare mention must be in the code. (Ambiguous English words like mix, step, length are not checked bare.) */
const SAYABLE: Record<string, string> = {
  sin: 'sin', sine: 'sin', cos: 'cos', cosine: 'cos', tan: 'tan', tanh: 'tanh', exp: 'exp', exponential: 'exp', pow: 'pow', sqrt: 'sqrt',
  smoothstep: 'smoothstep', fract: 'fract', clamp: 'clamp', normalize: 'normalize', atan: 'atan', abs: 'abs',
};
/** Spoken forms that are also fine when a related call is there (an exponential glow can be written exp or pow). */
const RELATED: Record<string, string[]> = { exp: ['exp', 'pow', 'exp2'], sin: ['sin', 'cos'], cos: ['cos', 'sin'], tanh: ['tanh', 'smoothstep'], tan: ['tan', 'sin', 'cos'] };

const COLOUR_WORDS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'violet', 'pink', 'magenta', 'brown', 'gold', 'golden', 'teal'];
const colourOf = (w: string) => (w === 'golden' ? 'gold' : w === 'violet' ? 'purple' : w === 'magenta' ? 'pink' : w);

const numberRe = /(?<![\w.])-?\d+(?:\.\d+)?(?!\w)/g;
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 + 1e-3 * Math.max(Math.abs(a), Math.abs(b));
/** Numbers a sentence may say without it being an invention: small counts and the ends of a range. */
const FREE_NUMBERS = [0, 1, 2];

const codeIdents = (s: string) => new Set(s.match(WORD) ?? []);
const codeNumbers = (s: string): number[] => (s.match(numberRe) ?? []).map(Number);

/** Everything in `text` that the code, the inputs and the facts do not back. */
export function groundingCheck(item: Pick<ExplainItem, 'line' | 'what' | 'effect'>, g: GroundingContext, askedLine?: number): GroundingIssue[] {
  const issues: GroundingIssue[] = [];
  const said = [item.what, item.effect].filter(Boolean).join(' . ');
  if (!said.trim()) return issues;

  if (askedLine !== undefined && item.line !== undefined && item.line !== askedLine) {
    issues.push({ kind: 'line', detail: `answered about line ${item.line}, not line ${askedLine}`, contradiction: true });
  }
  const lineText = (item.line !== undefined ? g.lines[item.line - 1] : undefined) ?? (askedLine !== undefined ? g.lines[askedLine - 1] : undefined) ?? g.code;

  const known = new Set<string>([...codeIdents(g.code), ...g.inputs.map(i => i.name), ...codeIdents(g.inputText), ...codeIdents(g.factsText)]);
  const inLine = codeIdents(lineText);

  // 1. Identifiers: anything in `backticks`, or code-shaped (u_time, sp2, camelCase), that nothing here has
  const mentioned = new Set<string>();
  for (const m of said.matchAll(/`([^`]+)`/g)) for (const w of m[1].match(WORD) ?? []) mentioned.add(w);
  for (const w of said.match(WORD) ?? []) if (/_|\d|[a-z][A-Z]/.test(w)) mentioned.add(w);
  const invented: string[] = [];
  for (const w of mentioned) {
    if (known.has(w) || BUILTINS.has(w) || GLSL_WORDS.has(w) || SWIZZLE.test(w)) continue;
    invented.push(w);
  }
  if (invented.length) issues.push({ kind: 'identifier', detail: `mentions ${invented.slice(0, 3).map(w => `\`${w}\``).join(', ')}, which is not in the code or its inputs`, contradiction: false });

  // 2. Functions said as words: "sine wave" when nothing in the code is a sine
  const spoken = new Set<string>();
  for (const w of (said.toLowerCase().match(/[a-z]+/g) ?? [])) if (SAYABLE[w]) spoken.add(SAYABLE[w]);
  for (const fn of spoken) {
    const ok = RELATED[fn] ?? [fn];
    if (ok.some(f => inLine.has(f))) continue;
    if (ok.some(f => codeIdents(g.code).has(f))) {
      issues.push({ kind: 'function', detail: `talks about ${fn}, which this line does not use (an earlier line does)`, contradiction: false });
    } else {
      issues.push({ kind: 'function', detail: `talks about ${fn}, but there is no ${fn} in the code`, contradiction: true });
    }
  }

  // 3. Numbers: every number said must be in the code, an input's range, or a free small one
  const allowed = [...codeNumbers(g.code), ...codeNumbers(g.inputText), ...g.inputs.flatMap(i => i.numbers), ...codeNumbers(g.factsText), ...FREE_NUMBERS];
  const strangers: number[] = [];
  const nums = (said.match(numberRe) ?? []).map(Number);
  for (const n of nums) if (!allowed.some(a => near(a, n) || near(-a, n))) strangers.push(n);
  if (strangers.length) issues.push({ kind: 'number', detail: `says ${[...new Set(strangers)].slice(0, 3).join(', ')}, which is not in the code or its inputs`, contradiction: false });

  // 4. Colours: a named colour must be the one the facts name (or one the code names)
  const factColours = new Set<string>();
  for (const f of g.colourFacts) for (const w of f.replace(/\([^)]*\)/g, ' ').toLowerCase().match(/[a-z]+/g) ?? []) if (COLOUR_WORDS.includes(w)) factColours.add(colourOf(w));
  const codeLower = `${g.code}\n${g.inputText}`.toLowerCase();
  const saidColours = new Set<string>();
  for (const w of said.toLowerCase().match(/[a-z]+/g) ?? []) if (COLOUR_WORDS.includes(w)) saidColours.add(colourOf(w));
  const wrongColours = [...saidColours].filter(c => !factColours.has(c) && !new RegExp(`\\b${c}\\b`).test(codeLower));
  if (wrongColours.length) {
    issues.push({
      kind: 'colour',
      detail: factColours.size
        ? `calls it ${wrongColours.join('/')}, but the code's colour is ${[...factColours].join('/')}`
        : `names a colour (${wrongColours.join('/')}) that nothing in the code has`,
      contradiction: factColours.size > 0,
    });
  }
  return issues;
}

// ── Agreement between samples ─────────────────────────────────────────────────

const STOP = new Set('a an the of to in on at is are be as it its this that and or for with by from into so then than which while each every one more less over under up down very just also not no can will makes make gives give turns turn line picture value values result sets set uses use used using'.split(' '));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');
const bag = (it: Pick<ExplainItem, 'what' | 'effect'>): Set<string> =>
  new Set([`${it.what ?? ''} ${it.effect ?? ''}`.toLowerCase().match(/[a-z][a-z0-9_]*/g) ?? []].flat().filter(w => !STOP.has(w) && w.length > 1).map(stem));

/** How much two answers say the same thing, 0..1: overlap of their content words (the smaller answer's share). */
export function agreement(a: Pick<ExplainItem, 'what' | 'effect'>, b: Pick<ExplainItem, 'what' | 'effect'>): number {
  const A = bag(a), B = bag(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size);
}

/**
 * How well the main answer (first) and its re-asked samples agree, 0..1: the lower of (the main answer against
 * each sample, on average) and (the samples against each other).
 */
export function consistency(answers: ReadonlyArray<Pick<ExplainItem, 'what' | 'effect'>>): number | null {
  if (answers.length < 2) return null;
  const [main, ...samples] = answers;
  const vsMain = samples.reduce((s, x) => s + agreement(main, x), 0) / samples.length;
  if (samples.length < 2) return vsMain;
  let sum = 0, n = 0;
  for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) { sum += agreement(samples[i], samples[j]); n++; }
  return Math.min(vsMain, sum / n);
}

// ── Putting it together ───────────────────────────────────────────────────────

export interface ConfidenceInput {
  noSelfReport?: boolean;
  sure?: Sure;
  unsureAbout?: string;
  logprob?: LogprobStats | null;
  grounding?: GroundingIssue[];
  /** Agreement of the double-check, when it ran. */
  consistency?: number | null;
}

export interface Confidence {
  level: Level;
  /** Why, in plain words, strongest first. For the tooltip. */
  reasons: string[];
  /** The "not sure" tag's text, when it must be shown: the model said so, or the level is low. */
  notSure: string | null;
}

const RANK: Record<Level, number> = { high: 2, medium: 1, low: 0 };
const worst = (a: Level, b: Level): Level => (RANK[a] <= RANK[b] ? a : b);
const pct = (lp: number) => `${Math.round(Math.exp(lp) * 100)}%`;

/** One level and the reasons, from every signal there is. */
export function combineConfidence(c: ConfidenceInput): Confidence {
  let level = 'high' as Level;
  const down: string[] = [];
  const good: string[] = [];
  const cap = (to: Level, why: string) => { level = worst(level, to); down.push(why); };

  // 1. The model's own word (a node explanation is prose and has none)
  if (c.noSelfReport) { /* nothing to read */ } else if (c.sure === 'low') cap('low', 'the model says it is guessing');
  else if (c.sure === 'medium') cap('medium', 'the model is only fairly sure');
  else if (c.sure === undefined) cap('medium', 'the model did not say how sure it is');
  if (c.unsureAbout?.trim()) cap('medium', `the model is unsure about: ${c.unsureAbout.trim()}`);

  // 2. Token probabilities
  const lp = c.logprob;
  if (lp) {
    if (lp.mean < THRESHOLDS.meanLow) cap('low', `its words were low-probability (average ${pct(lp.mean)} per word)`);
    else if (lp.mean < THRESHOLDS.meanMedium) cap('medium', `its words were only moderately likely (average ${pct(lp.mean)} per word)`);
    else good.push(`its wording was steady (average ${pct(lp.mean)} per word)`);
    if (lp.min < THRESHOLDS.minMedium) cap('medium', `one word was a long shot (${pct(lp.min)})`);
  }

  // 3. Grounding
  const issues = c.grounding ?? [];
  if (issues.length) {
    // A contradiction, or two things that are not backed, is a low; one invented name or number is a medium
    for (const i of issues) cap(i.contradiction || issues.length > 1 ? 'low' : 'medium', i.detail);
  } else if (c.grounding) good.push('every name and number it used is in the code, the inputs or the facts');

  // 4. Double-check
  if (c.consistency !== undefined && c.consistency !== null) {
    if (c.consistency < THRESHOLDS.agreeLow) cap('low', 'asked again, it gave a different answer');
    else if (c.consistency < THRESHOLDS.agreeMedium) cap('medium', 'asked again, the answers only partly matched');
    else good.push('asked again, it said the same thing');
  }

  const reasons = down.length ? down : good;
  const unsure = c.unsureAbout?.trim();
  const notSure = level === 'low' || c.sure === 'low' || unsure
    ? (unsure || down.find(d => /guessing|low-probability|different answer|not in|no \w+ in|colour|line/.test(d)) || down[0] || 'low confidence')
    : null;
  return { level, reasons: reasons.length ? reasons : ['no checks were available'], notSure };
}

/** The confidence of a streamed item given everything we measured. */
export function assessItem(item: ExplainItem, o: { g?: GroundingContext; askedLine?: number; tokens?: readonly TokenLp[]; raw: string; consistency?: number | null }): Confidence {
  return combineConfidence({
    sure: item.sure,
    unsureAbout: item.unsureAbout,
    logprob: logprobStats(o.tokens, o.raw, item.spans),
    grounding: o.g ? groundingCheck(item, o.g, o.askedLine) : undefined,
    consistency: o.consistency,
  });
}

/** A plain answer (no JSON): no self-report, no spans. It is never shown without its tag. */
export function assessPlain(text: string, o: { tokens?: readonly TokenLp[]; raw: string }): Confidence {
  const base = combineConfidence({ sure: 'low', unsureAbout: 'the answer was not in the expected format', logprob: logprobStats(o.tokens, o.raw) });
  void text;
  return { ...base, level: 'low', notSure: base.notSure ?? 'the answer was not in the expected format' };
}

/** A whole-node explanation (prose): only the measured token probabilities apply. */
export function assessNode(o: { tokens?: readonly TokenLp[]; raw: string }): Confidence {
  const lp = logprobStats(o.tokens, o.raw);
  const c = combineConfidence({ noSelfReport: true, logprob: lp });
  return lp ? c : { level: 'medium', reasons: ['no token probabilities were available'], notSure: null };
}
