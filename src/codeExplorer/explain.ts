/**
 * explain.ts — names and phrases for patterns (docs/code-explorer-plan.md §8.1).
 *
 * The shared pattern library (`src/lib/glslPatterns/`, built with the
 * Expression explainer on its own branch) owns names, phrases and "Make a
 * node from this". The Explorer only *reads* it, through this adapter:
 * `registerPatternExplainer` plugs the library in, and until then a small
 * built-in table names the commonest shapes in the examples (§9's phrases).
 * Nothing here is generated: every phrase is written by hand.
 */

export interface PatternQuery {
  callee: string;
  /** L2 argument shape: `smoothstep(#, #, length(…))`. */
  l2: string;
  /** L1 exact shape, when asking about one variant. */
  l1?: string;
  /** A real instance's code, for matchers that read the code itself. */
  sample?: string;
}

export interface PatternInfo {
  /** The library entry's id, when it came from the library. */
  id?: string;
  /** A short name: "soft disc edge". */
  name: string;
  /** One sentence on what it does. */
  phrase?: string;
  from: 'library' | 'builtin';
}

/** What the pattern library offers the Explorer. */
export interface PatternExplainer {
  explain(q: PatternQuery): PatternInfo | null;
  /** "Make a node from this" (phase 2 wires the button to it). */
  makeNode?(q: PatternQuery & { instances: string[] }): void;
}

type Row = { match: RegExp | string; name: string; phrase?: string };

/** A minimal built-in table, matched against L1 first, then L2. Kept small on purpose: the library replaces it. */
const BUILTIN: Row[] = [
  { match: /^fract\(sin\(dot\(_\w*, vec[23]\(#, #(?:, #)?\)\)\) \* #\)$/, name: 'classic hash', phrase: 'A random-looking number per cell from a sine of a dot product.' },
  { match: 'fract(sin(…) * #)', name: 'classic hash', phrase: 'A random-looking number from the fractional part of a big sine.' },
  { match: 'smoothstep(#, #, length(…))', name: 'soft disc edge', phrase: 'Fades across a ring of distances from a point: a circle with a soft rim.' },
  { match: 'smoothstep(#, #, _)', name: 'edge on a value', phrase: 'Goes from 0 to 1 as the value crosses between two fixed edges.' },
  { match: 'smoothstep(_, _ + #, _)', name: 'threshold plus width', phrase: 'An edge that starts at a threshold and is a fixed width wide.' },
  { match: /^smoothstep\(#, #, _\.[xyzw]\)$/, name: 'edge on one channel', phrase: 'A soft edge along one axis or channel.' },
  { match: 'smoothstep(#, #, min(…))', name: 'soft edge of the nearer of two', phrase: 'A soft edge on whichever of two distances is smaller.' },
  { match: 'smoothstep(#, #, abs(…))', name: 'soft band', phrase: 'A soft edge on a distance either side of zero: a band or outline.' },
  { match: 'mix(vec3(…), vec3(…), _)', name: 'two-colour gradient', phrase: 'Blends from one fixed colour to another by a value.' },
  { match: 'mix(vec3(…), vec3(…), smoothstep(…))', name: 'soft two-colour blend', phrase: 'Two colours, blended across a soft edge.' },
  { match: /^mix\(vec3\(…\), vec3\(…\), _\.y \* # \+ #\)$/, name: 'vertical gradient', phrase: 'A sky-like gradient up the picture.' },
  { match: 'mix(mix(…), vec3(…), _)', name: 'layered colour', phrase: 'Paints one more colour over an earlier blend.' },
  { match: 'mix(_, _, _)', name: 'blend two values', phrase: 'Linear blend: the first value at 0, the second at 1.' },
  { match: 'mix(vec4(…), vec4(…), _)', name: 'choose between two vec4', phrase: 'Picks or blends between two four-component values.' },
  { match: 'fract(_ * #)', name: 'repeat, or sawtooth over time', phrase: 'Wraps a scaled value into 0–1 over and over: tiles in space, a ramp in time.' },
  { match: 'fract(_ / #)', name: 'slow sawtooth', phrase: 'A 0–1 ramp that repeats every so many units.' },
  { match: /^fract\(_\.[xy]\)$/, name: 'position inside a cell, one axis', phrase: 'Where you are inside the current cell along one axis.' },
  { match: 'fract(_)', name: 'position inside a cell', phrase: 'The fractional part: where you are inside the current cell.' },
  { match: 'length(_)', name: 'distance from the origin', phrase: 'How far a point is from the centre: a circle’s distance field.' },
  { match: 'length(_ - vec2(…))', name: 'distance from a fixed point', phrase: 'How far a point is from a fixed position.' },
  { match: 'length(_ - _)', name: 'distance between two points', phrase: 'How far apart two positions are.' },
  { match: 'length(fract(…) - #)', name: 'distance inside each tile', phrase: 'A grid of dots: the distance from the centre of every cell.' },
  { match: 'length(max(…))', name: 'box SDF, outside part', phrase: 'The outside distance of a box.' },
  { match: /^dot\(_\w*, vec3\(#, #, #\)\)$/, name: 'weighted sum (luma)', phrase: 'Adds the channels with weights, as brightness does.' },
  { match: 'step(#, _)', name: 'hard threshold', phrase: '0 below the edge, 1 above it.' },
  { match: /^exp\(-_\w* \* #\)$/, name: 'exponential falloff', phrase: 'Fades fast near zero and slowly further out.' },
  { match: 'abs(_)', name: 'mirror', phrase: 'Folds negative values over to positive.' },
  { match: 'sin(_ * # + _)', name: 'moving wave', phrase: 'A wave that travels as the second term changes.' },
  { match: 'pow(# - fract(…), #)', name: 'beat pulse', phrase: 'A sharp hit that fades before the next one.' },
];

const matches = (m: RegExp | string, s: string | undefined) => !!s && (typeof m === 'string' ? m === s : m.test(s));

export const builtinExplainer: PatternExplainer = {
  explain(q) {
    for (const r of BUILTIN) if (matches(r.match, q.l1)) return { name: r.name, phrase: r.phrase, from: 'builtin' };
    for (const r of BUILTIN) if (matches(r.match, q.l2)) return { name: r.name, phrase: r.phrase, from: 'builtin' };
    return null;
  },
};

let current: PatternExplainer | null = null;

/** Plug the shared pattern library in (it replaces the built-in table; the table still answers what it doesn't know). */
export function registerPatternExplainer(e: PatternExplainer | null): void { current = e; }

export function explainPattern(q: PatternQuery): PatternInfo | null {
  return current?.explain(q) ?? builtinExplainer.explain(q);
}

export const patternMaker = (): PatternExplainer['makeNode'] => current?.makeNode;
