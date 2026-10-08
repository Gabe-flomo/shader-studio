/**
 * inputs.ts — what a code node's inputs ARE, described structurally (docs/explain-model.md "Narrow context").
 *
 * A small model that is told "this comes from the node called 'Moonlight'" explains moonlight. So an input is
 * described only by its type and by the upstream node's TYPE and what that output means, never by a user-given
 * node label or title:
 *
 *   uv: vec2 pixel position, from UV (centred: 0,0 is the middle of the picture, about -1..1 across)
 *   t:  float time in seconds, built in
 *   h:  float, from Fractal Noise (FBM), range about 0..1
 *
 * Ranges come from what we know for certain: the node type's documented output (a small table of the common
 * sources), a slider's own min/max, a Constant's value. Nothing is sampled or guessed; no range is better than a
 * wrong one. Pure: the node registry is injected (`NodeDescriber`).
 */
import type { GraphNode } from '../types/nodeGraph';

/** What the node registry knows about a node type (injected so this file stays pure). */
export interface TypeInfo {
  /** The type's name in the registry: "UV", "Fractal Noise (FBM)". Never the user's label. */
  label: string;
  /** The type's description from the registry. */
  description?: string;
  /** Output socket labels by key. */
  outputs?: Record<string, string>;
}
export type NodeDescriber = (type: string) => TypeInfo | undefined;

export interface InputInfo {
  name: string;
  /** GLSL type: float, vec2, … */
  type: string;
  /** The structural description, one line: "vec2 pixel position, from UV (…)". */
  text: string;
  /** Numbers the description legitimately contains (so a grounding check does not call them invented). */
  numbers: number[];
}

/** What common source outputs mean and their range, by `type.outputKey` (or `type`). Curated from their definitions. */
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

const first = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
const round = (v: number) => Math.round(v * 1000) / 1000;
const numbersIn = (s: string): number[] => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

interface InputDef { name?: string; type?: string; slider?: { min: number; max: number } | null; carry?: boolean }

/** The declared inputs of a code node (Expression Block, Custom Function). */
export function declaredInputs(node: GraphNode): Array<{ name: string; type: string; slider: { min: number; max: number } | null; carry: boolean }> {
  const raw = node.params?.inputs;
  if (!Array.isArray(raw)) return [];
  return (raw as InputDef[]).filter(i => i && typeof i.name === 'string' && i.name).map(i => ({ name: i.name!, type: i.type || 'float', slider: i.slider ?? null, carry: !!i.carry }));
}

/** The meaning of what a wired source gives, by the source's TYPE. */
function sourceText(src: GraphNode, outputKey: string, describe?: NodeDescriber): { text: string; numbers: number[] } {
  const info = describe?.(src.type);
  const name = info?.label ?? src.type;
  const meaning = OUTPUT_MEANINGS[`${src.type}.${outputKey}`] ?? OUTPUT_MEANINGS[src.type];
  if (src.type === 'constant' && typeof src.params?.value === 'number') {
    const v = round(src.params.value as number);
    return { text: `a constant, value ${v}`, numbers: [v] };
  }
  if (src.type === 'exprNode' || src.type === 'customFn') return { text: 'the result of another code node', numbers: [] };
  const sock = info?.outputs?.[outputKey];
  const gist = meaning ?? (info?.description ? first(info.description) : undefined);
  const text = `from ${name}${sock && sock !== name ? ` (output ${sock})` : ''}${gist ? `: ${gist}` : ''}`;
  return { text, numbers: numbersIn(gist ?? '') };
}

/** Every input of a code node, described by type and by the TYPE of what feeds it. */
export function describeInputs(nodes: readonly GraphNode[], nodeId: string, describe?: NodeDescriber): InputInfo[] {
  const me = nodes.find(n => n.id === nodeId);
  if (!me) return [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out: InputInfo[] = [];
  const declared = declaredInputs(me);
  for (const inp of declared) {
    const c = me.inputs?.[inp.name]?.connection;
    const src = c && byId.get(c.nodeId);
    let body: string; let numbers: number[] = [];
    if (inp.carry) body = 'carried from the previous pass of the loop';
    else if (src) {
      const s = sourceText(src, c!.outputKey, describe);
      body = s.text; numbers = s.numbers;
    } else if (inp.slider) {
      body = `a slider on the node, range ${round(inp.slider.min)}..${round(inp.slider.max)}`;
      numbers = [round(inp.slider.min), round(inp.slider.max)];
    } else body = 'not connected; 0 when nothing is wired';
    out.push({ name: inp.name, type: inp.type, text: `${inp.name}: ${inp.type}, ${body}`, numbers });
  }
  // An Expression Block always has the clock `t` unless an input takes the name
  if (me.type === 'exprNode' && !declared.some(d => d.name === 't')) {
    out.push({ name: 't', type: 'float', text: 't: float, built in: time in seconds since start; it grows without limit', numbers: [] });
  }
  return out;
}
