/**
 * inputs.ts — what a code node's inputs ARE, traced to what feeds them (docs/explain-model.md "Fact-only context").
 *
 * A small model that is told "this comes from the node called 'Moonlight'" explains moonlight. So an input is
 * described only by its type and by the upstream node's TYPE, the output it comes from and what that output means,
 * never by a user-given node label or title:
 *
 *   uv:  vec2, from a UV node (vec2): pixel position, centred: (0,0) is the middle of the picture, …
 *   n:   vec3, from the Normal output of a March Loop node (vec3, unit length): the direction the surface faces …
 *   col: vec3, from a Color node: the fixed value (0.8, 0.45, 0.25), the colour a light warm orange
 *   t:   float, built in: time in seconds since start
 *
 * Each input also says how the measurements (worked.ts `workedBlock`) draw it: a fixed value, a known range (a
 * slider's min/max, a source's documented output), a unit-length direction, or, when nothing says, an assumed 0..1
 * (flagged, so the prompt can say so). Pure: the node registry is injected (`NodeDescriber`).
 */
import { GROUP_PORT_SENTINEL, type GraphNode } from '../types/nodeGraph';
import type { BlockInput, Value } from '../lib/glslPatterns';

/** What the node registry knows about a node type (injected so this file stays pure). */
export interface TypeInfo {
  /** The type's name in the registry: "UV", "Fractal Noise (FBM)". Never the user's label. */
  label: string;
  /** The type's description from the registry. */
  description?: string;
  /** Output socket labels by key. */
  outputs?: Record<string, string>;
  /** Output socket GLSL types by key. */
  outputTypes?: Record<string, string>;
  /** Output socket hints by key (registry text). */
  outputHints?: Record<string, string>;
  /** Input socket labels by key (for what the block feeds). */
  inputs?: Record<string, string>;
}
export type NodeDescriber = (type: string) => TypeInfo | undefined;

/** The slice of a node definition a describer reads. */
interface DefLike {
  label: string;
  description?: string;
  outputs?: Record<string, { label?: string; type?: unknown; hint?: string }>;
  inputs?: Record<string, { label?: string }>;
}

/** A describer over the node registry (`getNodeDefinition`), passed in so this file stays free of it. */
export function describerFrom(get: (type: string) => DefLike | undefined): NodeDescriber {
  return type => {
    const d = get(type);
    if (!d) return undefined;
    const outs = Object.entries(d.outputs ?? {});
    return {
      label: d.label,
      description: d.description,
      outputs: Object.fromEntries(outs.map(([k, v]) => [k, v.label ?? k])),
      outputTypes: Object.fromEntries(outs.flatMap(([k, v]) => (typeof v.type === 'string' ? [[k, v.type]] : []))),
      outputHints: Object.fromEntries(outs.flatMap(([k, v]) => (v.hint ? [[k, v.hint]] : []))),
      inputs: Object.fromEntries(Object.entries(d.inputs ?? {}).map(([k, v]) => [k, v.label ?? k])),
    };
  };
}

export interface InputInfo {
  name: string;
  /** GLSL type: float, vec2, … */
  type: string;
  /** The structural description, one line: "uv: vec2, from a UV node (vec2): pixel position …". */
  text: string;
  /** Short words for where it comes from, for tracing later lines back to it: "the Normal output of a March Loop node". */
  source: string;
  /** Numbers the description legitimately contains (so a grounding check does not call them invented). */
  numbers: number[];
  /** How the measurements draw it. */
  sample: BlockInput;
  /** Nothing says what range it has: the measured numbers assume 0..1 for it. */
  assumed?: string;
  /** It is the clock: the measured spread of anything built from it is over time, not only across the picture. */
  clock?: boolean;
}

/** What common source outputs mean, by `type.outputKey` (or `type`). Curated from their definitions. */
export const OUTPUT_MEANINGS: Record<string, string> = {
  'uv.uv': 'pixel position, centred: (0,0) is the middle of the picture, x and y run about -1..1 (x is widened by the aspect ratio)',
  'pixelUV.uv': 'pixel position, (0,0) at the bottom-left, y runs 0..1 and x runs 0..aspect ratio',
  'fragCoord.coord': 'pixel position in pixels, 0..width by 0..height',
  'time.time': 'time in seconds since start; it grows without limit',
  'mouse.uv': 'pointer position in the same centred space as UV (about -1..1)',
  'mouse.x': 'pointer x in the centred space, about -1..1',
  'mouse.y': 'pointer y in the centred space, about -1..1',
  'resolution.res': 'canvas size in pixels (x = width, y = height)',
  'resolution.width': 'canvas width in pixels',
  'resolution.height': 'canvas height in pixels',
  fbm: 'smooth noise value, range 0..1',
  noiseFloat: 'noise value, about 0..1',
  voronoi: 'cell pattern value',
  audioInput: 'loudness of a frequency band, range 0..1',
  length: 'distance from the origin of a vector (0 or more)',
  loopIndex: 'the loop counter, 0 at the first pass',
};

/** How the measurements draw the common sources: a value at the sample pixel and a range. */
const SOURCE_SAMPLES: Record<string, { value: number[]; range: [number, number]; fixed?: boolean }> = {
  'uv.uv': { value: [0.3, 0.2], range: [-1, 1] },
  'pixelUV.uv': { value: [0.6, 0.4], range: [0, 1] },
  'fragCoord.coord': { value: [600, 400], range: [0, 1000] },
  'time.time': { value: [2], range: [0, 10] },
  'resolution.res': { value: [1200, 800], range: [800, 1200], fixed: true },
  'resolution.width': { value: [1200], range: [1200, 1200], fixed: true },
  'resolution.height': { value: [800], range: [800, 800], fixed: true },
  'mouse.uv': { value: [0.2, 0.1], range: [-1, 1] },
  'mouse.x': { value: [0.2], range: [-1, 1] },
  'mouse.y': { value: [0.1], range: [-1, 1] },
  fbm: { value: [0.5], range: [0, 1] },
  noiseFloat: { value: [0.5], range: [0, 1] },
  audioInput: { value: [0.4], range: [0, 1] },
  length: { value: [0.4], range: [0, 1.5] },
  loopIndex: { value: [2], range: [0, 8] },
};

/** Directions: drawn as unit-length vectors. */
const UNIT_KEYS = /^(normal|nor|nrm|n|dir|direction|rd|rayDir|ray_dir)$/i;
/** Colours: 0..1 per channel. */
const COLOUR_KEYS = /(colou?r|rgb|tint|albedo)/i;

const first = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
const round = (v: number) => Math.round(v * 1000) / 1000;
const numbersIn = (s: string): number[] => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const dims = (type: string) => (type === 'vec2' ? 2 : type === 'vec3' ? 3 : type === 'vec4' ? 4 : 1);
/** "an Output", "a UV", "a Unit" (a leading U is said "you"). */
const article = (w: string) => (/^[aeio]/i.test(w) ? 'an' : 'a');
const showNums = (v: number[]) => (v.length === 1 ? String(round(v[0])) : `(${v.map(round).join(', ')})`);

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

/** ", the colour a light warm orange" for an rgb triple in 0..1 that is not a grey; empty otherwise. */
const colourNote = (v: number[]): string =>
  v.length >= 3 && v.slice(0, 3).every(x => x >= 0 && x <= 1) ? `, the colour ${colourWords(v[0], v[1], v[2])}` : '';

interface InputDef { name?: string; type?: string; slider?: { min: number; max: number } | null; carry?: boolean }

/** The declared inputs of a code node (Expression Block, Custom Function). */
export function declaredInputs(node: GraphNode): Array<{ name: string; type: string; slider: { min: number; max: number } | null; carry: boolean }> {
  const raw = node.params?.inputs;
  if (!Array.isArray(raw)) return [];
  return (raw as InputDef[]).filter(i => i && typeof i.name === 'string' && i.name).map(i => ({ name: i.name!, type: i.type || 'float', slider: i.slider ?? null, carry: !!i.carry }));
}

/** A value of `type` from a list of numbers (padded with the last one). */
const valueOf = (type: string, v: number[]): Value => {
  const n = dims(type);
  return n === 1 ? v[0] ?? 0 : Array.from({ length: n }, (_, i) => v[i] ?? v[v.length - 1] ?? 0);
};
const defaultValue = (type: string): number[] => (dims(type) === 1 ? [0.5] : [0.5, 0.25, 0.75, 1]);

interface Traced { body: string; source: string; numbers: number[]; value: number[]; range: [number, number]; unit?: boolean; fixed?: boolean; assumed?: string }

/** A fixed value: the measurements never vary it. */
const fixed = (v: number[]): Pick<Traced, 'value' | 'range' | 'fixed'> => ({ value: v, range: [Math.min(...v), Math.max(...v)], fixed: true });

/** The vector a Constant node gives (its type pills pick float / vec2 / vec3 / vec4). */
function constantValue(src: GraphNode): number[] | null {
  const p = src.params ?? {};
  const t = String(src.outputs?.value?.type ?? p.outputType ?? 'float');
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  if (t === 'float') return typeof p.value === 'number' ? [p.value] : null;
  const n = dims(t);
  return [num(p.x, 0), num(p.y, 0), num(p.z, 0), num(p.w, 1)].slice(0, n);
}

/** What a wired source gives, by the source's TYPE and output; never by its label. */
function traceSource(src: GraphNode, outputKey: string, inputType: string, describe?: NodeDescriber): Traced {
  const info = describe?.(src.type);
  const name = info?.label ?? src.type;
  const node = `${article(name)} ${name} node`;
  // Fixed values: show the number itself
  if (src.type === 'constant') {
    const v = constantValue(src);
    if (v) return { body: `from ${node}: the fixed value ${showNums(v)}${colourNote(v)}`, source: `${node} (${showNums(v)})`, numbers: v.map(round), ...fixed(v) };
  }
  if (src.type === 'constants' && Array.isArray(src.params?.items)) {
    // A Constants card: each entry is an output, keyed by a code name (its label is the user's, so never shown)
    const it = (src.params.items as Array<{ key?: string; value?: unknown; slider?: boolean }>).find(x => x?.key === outputKey);
    const live = src.params[outputKey];
    const raw = it?.slider && typeof live === 'number' ? live : it?.value;
    const v = typeof raw === 'number' ? [raw] : Array.isArray(raw) && raw.every(x => typeof x === 'number') ? (raw as number[]) : null;
    if (v) return { body: `from ${node}: ${it?.slider ? 'a slider, now' : 'the fixed value'} ${showNums(v)}${colourNote(v)}`, source: `${node} (${showNums(v)})`, numbers: v.map(round), ...fixed(v) };
  }
  if (src.type === 'colorPicker' && Array.isArray(src.params?.color)) {
    const rgb = (src.params.color as number[]).slice(0, 3).map(Number);
    const v = outputKey === 'r' ? [rgb[0]] : outputKey === 'g' ? [rgb[1]] : outputKey === 'b' ? [rgb[2]] : rgb;
    return { body: `from ${node}: the fixed value ${showNums(v)}${colourNote(v)}`, source: `${node} (${showNums(v)})`, numbers: v.map(round), ...fixed(v) };
  }
  const sock = info?.outputs?.[outputKey];
  // The node's own socket type first: a vectorisable node (Multiply on vec2s) differs from its registry default
  const outType = (src.outputs?.[outputKey]?.type as string | undefined) ?? info?.outputTypes?.[outputKey];
  const many = Object.keys(info?.outputs ?? {}).length > 1;
  const from = sock && (many || sock !== name) && !['Output', 'Result', 'Out', 'Value'].includes(sock) ? `the ${sock} output of ${node}` : node;
  const isVec = /^vec[234]$/.test(outType ?? inputType);
  const unit = isVec && (UNIT_KEYS.test(outputKey) || /^normal$/i.test(sock ?? ''));
  const detail = [outType, unit ? 'unit length' : ''].filter(Boolean).join(', ');
  const meaning = OUTPUT_MEANINGS[`${src.type}.${outputKey}`] ?? OUTPUT_MEANINGS[src.type];
  const gist = src.type === 'exprNode' || src.type === 'customFn'
    ? 'what that code computes'
    : meaning ?? (info?.outputHints?.[outputKey] ? first(info.outputHints[outputKey]) : info?.description ? first(info.description) : undefined);
  const body = `from ${from}${detail ? ` (${detail})` : ''}${gist ? `: ${gist}` : ''}`;
  const known = SOURCE_SAMPLES[`${src.type}.${outputKey}`] ?? SOURCE_SAMPLES[src.type];
  const colour = COLOUR_KEYS.test(outputKey) || COLOUR_KEYS.test(sock ?? '');
  const draw = known ? { value: known.value, range: known.range, fixed: known.fixed }
    : unit ? { value: [0.3, 0.8, 0.52], range: [-1, 1] as [number, number] }
    : colour ? { value: [0.8, 0.45, 0.25, 1], range: [0, 1] as [number, number], assumed: 'a colour, 0..1' }
    : { value: defaultValue(inputType), range: [0, 1] as [number, number], assumed: 'nothing says its range' };
  return { body, source: from, numbers: numbersIn(gist ?? ''), unit, ...draw };
}

/** Every input of a code node, described by type and traced to the TYPE of what feeds it. */
export function describeInputs(nodes: readonly GraphNode[], nodeId: string, describe?: NodeDescriber): InputInfo[] {
  const me = nodes.find(n => n.id === nodeId);
  if (!me) return [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out: InputInfo[] = [];
  const declared = declaredInputs(me);
  for (const inp of declared) {
    const c = me.inputs?.[inp.name]?.connection;
    const src = c && byId.get(c.nodeId);
    const own = me.params?.[inp.name];
    let t: Traced;
    if (inp.carry) t = { body: 'carried from the previous pass of the loop', source: 'the previous pass of the loop', numbers: [], value: defaultValue(inp.type), range: [0, 1], assumed: 'nothing says its range' };
    else if (c && c.nodeId === GROUP_PORT_SENTINEL) t = { body: 'from the group’s input (what feeds the group outside)', source: 'the group’s input', numbers: [], value: defaultValue(inp.type), range: [0, 1], assumed: 'nothing says its range' };
    else if (src) t = traceSource(src, c!.outputKey, inp.type, describe);
    else if (inp.slider) {
      const lo = round(inp.slider.min), hi = round(inp.slider.max);
      const now = typeof own === 'number' ? round(own) : round((lo + hi) / 2);
      // The same at every pixel: measured at its value now (its range is in the description)
      t = { body: `a slider on the node, range ${lo}..${hi}, now ${now}`, source: 'a slider on the node', numbers: [lo, hi, now], value: [now], range: [now, now], fixed: true };
    } else if (typeof own === 'number') {
      t = { body: `a fixed value set on the node, ${round(own)}`, source: 'a fixed value on the node', numbers: [round(own)], ...fixed([own]) };
    } else t = { body: 'not connected; 0 when nothing is wired', source: 'nothing (0)', numbers: [0], ...fixed([0]) };
    out.push({
      name: inp.name, type: inp.type, text: `${inp.name}: ${inp.type}, ${t.body}`, source: t.source, numbers: t.numbers, assumed: t.assumed,
      clock: !!src && src.type === 'time' ? true : undefined,
      sample: { name: inp.name, type: inp.type, value: valueOf(inp.type, t.value), range: t.range, unit: t.unit || undefined, fixed: t.fixed || undefined },
    });
  }
  // An Expression Block always has the clock `t` unless an input takes the name
  if (me.type === 'exprNode' && !declared.some(d => d.name === 't')) out.push(clockInput());
  return out;
}

/** The Expression Block's built-in clock. */
export const clockInput = (): InputInfo => ({
  name: 't', type: 'float', text: 't: float, built in: time in seconds since start; it grows without limit', source: 'the clock', numbers: [], clock: true,
  sample: { name: 't', type: 'float', value: 2, range: [0, 10] },
});
