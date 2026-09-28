/**
 * nodeVisual.ts — the live picture on a node page: which kind of picture a
 * node type gets (a plot over x for a float of a number, a field for anything
 * over the position, a colour swatch for a colour) and the GLSL snippet the
 * Present code-preview harness (present/snippetHarness.ts) draws it from:
 * the node's helpers, its inputs as top-level numbers (sliders, at the node's
 * defaults) and one function that runs its lines and returns its output.
 */
import { getNodeDefinition } from '../nodes/definitions';
import { instantiateNode } from '../nodes/scene3dDefaults';
import type { NodeDefinition } from '../types/nodeGraph';

export type NodeVisualKind = 'plot' | 'field' | 'colour' | 'none';

export interface NodeVisualFacts {
  /** The output's socket type: float, vec2, vec3, vec4, mat2… */
  outputType: string;
  outputLabel?: string;
  /** Reads the position (a UV input): its picture is over the picture, not over x. */
  hasPosition: boolean;
  category?: string;
}

const COLOUR_WORD = /colou?r|rgb|hue|tint|palette|gradient|swatch/i;

/** Which picture suits a node's output: a plot for a number of a number, a field for anything over the position, a colour for colours. */
export function nodeVisualKind(f: NodeVisualFacts): NodeVisualKind {
  const t = f.outputType;
  if (t === 'float') return f.hasPosition ? 'field' : 'plot';
  if (t === 'vec2') return 'field';
  if (t === 'vec3' || t === 'vec4') return COLOUR_WORD.test(f.outputLabel ?? '') || COLOUR_WORD.test(f.category ?? '') || t === 'vec4' ? 'colour' : 'field';
  return 'none';
}

const POSITION_KEY = /^(uv|p|pos|position|point|coord|coords|st)$/;
const POSITION_LABEL = /^uv\b|position/;
const isPositionInput = (key: string, s: { type: string; label: string }) => s.type === 'vec2' && (POSITION_KEY.test(key.toLowerCase()) || POSITION_LABEL.test(s.label.toLowerCase()));
const isTimeInput = (key: string, s: { type: string; label: string }) => s.type === 'float' && (key.toLowerCase() === 'time' || s.label.toLowerCase() === 'time');

const ident = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const lit = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(Math.round(v * 1e4) / 1e4));

export interface NodeSnippet {
  code: string;
  /** The function to show: `fn:<name>`. */
  show: string;
  kind: NodeVisualKind;
  outputType: string;
}

/** Facts about a definition's first drawable output, for `nodeVisualKind`. */
export function nodeVisualFacts(def: NodeDefinition): NodeVisualFacts | null {
  const outs = Object.entries(def.outputs);
  const out = outs.find(([, s]) => /^(float|vec[234])$/.test(s.type)) ?? outs[0];
  if (!out) return null;
  return { outputType: out[1].type, outputLabel: out[1].label, hasPosition: Object.entries(def.inputs).some(([k, s]) => !s.field && isPositionInput(k, s)), category: def.category };
}

/**
 * The snippet for a node type, or null when it can't be drawn on its own
 * (groups, scenes, the output, anything that reads a texture or a field).
 */
export function nodeSnippet(type: string): NodeSnippet | null {
  const def = getNodeDefinition(type);
  if (!def) return null;
  const facts = nodeVisualFacts(def);
  if (!facts) return null;
  const kind = nodeVisualKind(facts);
  if (kind === 'none') return null;
  if (Object.values(def.inputs).some(s => s.field) || def.textureSlots) return null;
  const outKey = Object.entries(def.outputs).find(([, s]) => s.type === facts.outputType)?.[0];
  if (!outKey) return null;

  // Inputs: the position from the picture, the time from the clock, numbers as sliders (one number is the x of a plot), the rest at the node's defaults.
  const inputVars: Record<string, string> = {};
  const globals: string[] = [];
  const params: string[] = [];
  let xParam: string | null = null;
  for (const [key, s] of Object.entries(def.inputs)) {
    if (isPositionInput(key, s)) { inputVars[key] = 'g_uv'; continue; }
    if (isTimeInput(key, s)) { inputVars[key] = 'u_time'; continue; }
    if (s.type !== 'float') continue;
    const name = ident(`in_${key}`);
    const value = num(def.defaultParams?.[key], num(s.defaultValue, 0.5));
    if (kind === 'plot' && !xParam) { xParam = name; params.push(`float ${name}`); }
    else globals.push(`float ${name} = ${lit(value)};`);
    inputVars[key] = name;
  }
  if (kind === 'plot' && !xParam) return null; // a number of nothing: no x to plot over

  let body = '';
  let outVar = '';
  const helpers: string[] = [def.glslFunction ?? '', ...(def.glslFunctions ?? [])].map(s => s.trim()).filter(Boolean);
  try {
    const node = instantiateNode('node', def.type, def, { x: 0, y: 0 });
    const r = def.generateGLSL(node, inputVars);
    body = (r.code ?? '').replace(/\r/g, '').split('\n').filter(l => l.trim()).map(l => `  ${l.trim()}`).join('\n');
    outVar = r.outputVars?.[outKey] ?? '';
    for (const f of def.glslFunctionsFor?.(node) ?? []) if (f.trim() && !helpers.includes(f.trim())) helpers.push(f.trim());
  } catch { return null; }
  if (!outVar) return null;
  // Anything a graph provides beyond the position and time (a texture, another node's field) can't be stood in for.
  if (/\bu_tex|texture2D\s*\(\s*u_|\bu_mouse\b/.test(body)) return null;

  const fn = ident(`node_${def.type}`);
  const args = [...(facts.hasPosition ? ['vec2 uv'] : []), ...params].join(', ');
  const code = [
    ...(helpers.length ? [helpers.join('\n\n'), ''] : []),
    ...(globals.length ? [globals.join('\n'), ''] : []),
    `${facts.outputType} ${fn}(${args}) {`,
    ...(facts.hasPosition ? ['  vec2 g_uv = uv;'] : []),
    body,
    `  return ${outVar};`,
    '}',
  ].join('\n');
  return { code, show: `fn:${fn}`, kind, outputType: facts.outputType };
}
