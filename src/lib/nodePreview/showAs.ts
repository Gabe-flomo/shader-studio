/**
 * "Show as": how a node preview draws a vec2 or a float (docs/node-previews.md).
 *
 * The eye preview (the picture panel) and the node card's thumbnail draw the node's real computed
 * value, read back from the GPU, in one of these modes. The choice is remembered per node; a node
 * nobody picked for gets a default from its output type and family.
 *
 * Pure: no React, no three.js. The store at the bottom keeps the choices (localStorage, not the
 * graph, so picking a mode never recompiles or lands on the undo stack).
 */
import { create } from 'zustand';
import type { GraphNode } from '../../types/nodeGraph';

export type Vec2Mode = 'grid' | 'arrows' | 'wheel' | 'raw';
export type FloatMode = 'auto' | 'slice' | 'contours' | 'raw';
export type ShowAsMode = Vec2Mode | FloatMode;
/** The output types a "Show as" applies to; vec3 / vec4 colours draw as they always have. */
export type ValueType = 'float' | 'vec2';

export const VEC2_MODES: ReadonlyArray<{ value: Vec2Mode; label: string; hint: string }> = [
  { value: 'grid', label: 'Grid', hint: 'A checker and line grid looked up at the vec2, as if it were UV: see how space is stretched, twisted and repeated. The red line is where y = 0, the green line where x = 0.' },
  { value: 'arrows', label: 'Arrows', hint: 'An arrow per cell pointing along the vec2. Length is strength: the strongest vector in view fills its cell, weaker ones are shorter (a dot below 3%), and brighter means stronger. The key gives the full-arrow value.' },
  { value: 'wheel', label: 'Wheel', hint: 'Colour is the direction (hue around the wheel), brightness the length; black is zero.' },
  { value: 'raw', label: 'Raw', hint: 'Red is x, green is y; negative parts show black, past 1 clips.' },
];
export const FLOAT_MODES: ReadonlyArray<{ value: FloatMode; label: string; hint: string }> = [
  { value: 'auto', label: 'Range', hint: 'The lowest value in view is dark and the highest bright. With negatives: blue below 0, grey at 0, warm above. The key gives the range.' },
  { value: 'slice', label: 'Slice', hint: 'A graph of the value along the dashed line (drag to move it). Grey is the node\'s input on the same axes: before and after.' },
  { value: 'contours', label: 'Contours', hint: 'The range picture with thin lines at regular values, like a height map.' },
  { value: 'raw', label: 'Raw', hint: 'Grey clipped to 0–1: black is 0 or below, white 1 or above.' },
];

// ── Detail ───────────────────────────────────────────────────────────────────

/** How fine the Grid checker / the Arrows grid is (Show as → Detail). Changes uniforms only, never a compile. */
export type Detail = 'coarse' | 'medium' | 'fine' | 'veryfine';
export const DETAIL_LEVELS: ReadonlyArray<{ value: Detail; label: string }> = [
  { value: 'coarse', label: 'Coarse' },
  { value: 'medium', label: 'Medium' },
  { value: 'fine', label: 'Fine' },
  { value: 'veryfine', label: 'Very fine' },
];
export const DEFAULT_DETAIL: Detail = 'medium';
/** The modes Detail applies to. */
export const DETAIL_MODES: ReadonlySet<ShowAsMode> = new Set<ShowAsMode>(['grid', 'arrows']);

/**
 * Grid density at a Detail level: checker squares and grid lines per unit of the vec2. Medium is a
 * little finer than the first version (8 squares, a line every ½); lines always fall on square edges.
 */
export function gridDensity(d: Detail): { checks: number; lines: number } {
  switch (d) {
    case 'coarse': return { checks: 4, lines: 1 };
    case 'fine': return { checks: 16, lines: 4 };
    case 'veryfine': return { checks: 24, lines: 4 };
    default: return { checks: 10, lines: 2 };
  }
}

/**
 * Arrow cell size in CSS pixels at a Detail level, for the eye preview and the (smaller) node card.
 * Medium is a little denser than the first version (36 / 22 px) and still readable on the card.
 */
export function arrowCellPx(d: Detail, where: 'eye' | 'card'): number {
  const eye = { coarse: 48, medium: 30, fine: 22, veryfine: 16 }[d] ?? 30;
  const card = { coarse: 32, medium: 20, fine: 15, veryfine: 11 }[d] ?? 20;
  return where === 'eye' ? eye : card;
}

export function modesFor(type: ValueType): ReadonlyArray<{ value: ShowAsMode; label: string; hint: string }> {
  return type === 'vec2' ? VEC2_MODES : FLOAT_MODES;
}
export function modeHint(type: ValueType, mode: ShowAsMode): string {
  return modesFor(type).find(m => m.value === mode)?.hint ?? '';
}

// ── Which output a preview shows ─────────────────────────────────────────────

type OutputMap = Record<string, { type: string; label?: string }>;
const PREVIEW_ORDER = ['vec3', 'vec4', 'vec2', 'float'];

/** An output that only hands its input on (FBM's "UV (pass-through)") is never the default view. */
const PASS_THROUGH = /pass-?\s?through/i;

/**
 * The output a preview of `node` draws: the remembered pick when that output still exists and has
 * a type a preview can draw; else a colour (the first vec3, then vec4), else the node's first
 * float or vec2 output in its own order (its main value: FBM's noise, not its pass-through UV).
 */
export function pickPreviewOutput(node: Pick<GraphNode, 'id' | 'type' | 'outputs'>, preferred?: string | null): [string, string] | null {
  const entries = Object.entries(node.outputs as OutputMap);
  if (preferred) {
    const hit = entries.find(([k]) => k === preferred);
    if (hit && PREVIEW_ORDER.includes(hit[1].type)) return [hit[0], hit[1].type];
  }
  for (const t of ['vec3', 'vec4']) {
    const e = entries.find(([, s]) => s.type === t);
    if (e) return [e[0], t];
  }
  const values = entries.filter(([, s]) => s.type === 'float' || s.type === 'vec2');
  const main = values.find(([, s]) => !PASS_THROUGH.test(s.label ?? '')) ?? values[0];
  if (main) return [main[0], main[1].type];
  const first = entries[0];
  return first ? [first[0], first[1].type] : null;
}

/** Outputs a preview could show, for the output picker (only offered when there are two or more). */
export function previewableOutputs(node: Pick<GraphNode, 'outputs'>): Array<{ key: string; label: string; type: string }> {
  return Object.entries(node.outputs as OutputMap)
    .filter(([, s]) => PREVIEW_ORDER.includes(s.type))
    .map(([key, s]) => ({ key, label: s.label || key, type: s.type }));
}

// ── Defaults ─────────────────────────────────────────────────────────────────

/** A vec2 that is a direction, flow, gradient or force reads best as arrows; everything else is space. */
const ARROW_NAME = /(^|[^a-z])(dir|direction|flow|force|vel|velocity|grad|gradient|curl|normal|wind|heading|push|pull|steer|motion)([^a-z]|$)/i;
const ARROW_TYPES = new Set(['angleToVec2', 'normalizeVec2', 'vectorField', 'gravityField', 'spiralField', 'edgesTexture']);

export function defaultShowAs(
  node: Pick<GraphNode, 'type'> & { outputs?: OutputMap },
  type: ValueType,
  outputKey?: string,
): ShowAsMode {
  if (type === 'float') return 'auto';
  const sock = outputKey && node.outputs ? node.outputs[outputKey] : undefined;
  const names = [outputKey ?? '', sock?.label ?? ''].join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  if (ARROW_NAME.test(names)) return 'arrows';
  // A node of the family whose main output is a direction, previewed on that output (or its only vec2).
  if (ARROW_TYPES.has(node.type) && (!outputKey || node.type !== 'edgesTexture' || outputKey === 'direction')) return 'arrows';
  return 'grid';
}

// ── Single-input transforms: the slice plot overlays the input ───────────────

/**
 * Nodes that take one value and reshape it: the slice plot draws their main input in grey under
 * the output, so you see before and after on the same axes.
 */
export const SINGLE_INPUT_TRANSFORMS: ReadonlySet<string> = new Set([
  'multiply', 'add', 'subtract', 'divide', 'sin', 'cos', 'tan', 'smoothstep', 'pow', 'remap', 'abs',
  'fract', 'fractRaw', 'exp', 'sqrt', 'floor', 'ceil', 'negate', 'sign', 'mod', 'tanh', 'round', 'step',
  'clamp', 'quantize', 'minMath', 'max',
  'expEase', 'doubleExpSeat', 'doubleExpSigmoid', 'logisticSigmoid', 'circularEaseIn', 'circularEaseOut',
  'doubleCircleSeat', 'doubleCircleSigmoid', 'doubleEllipticSigmoid', 'quadBezierShaper', 'cubicBezierShaper',
]);

/**
 * The input to overlay on a float node's slice plot, as the wire feeding it: for a known
 * single-input transform its first wired float input; for any other node, its input when exactly
 * one input is wired and that one is a float. Null when there is nothing to compare against.
 */
export function primaryInput(node: Pick<GraphNode, 'type' | 'inputs'>): { key: string; nodeId: string; outputKey: string } | null {
  const wired = Object.entries(node.inputs).filter(([, s]) => s.connection);
  const floatWired = wired.filter(([, s]) => s.type === 'float');
  if (SINGLE_INPUT_TRANSFORMS.has(node.type)) {
    const first = floatWired[0];
    return first ? { key: first[0], nodeId: first[1].connection!.nodeId, outputKey: first[1].connection!.outputKey } : null;
  }
  if (wired.length === 1 && floatWired.length === 1) {
    const [key, s] = floatWired[0];
    return { key, nodeId: s.connection!.nodeId, outputKey: s.connection!.outputKey };
  }
  return null;
}

// ── Per-node choices ─────────────────────────────────────────────────────────

export interface NodePreviewPref {
  /** The output shown (multi-output nodes). */
  output?: string;
  vec2?: Vec2Mode;
  float?: FloatMode;
  /** The slice plot's line, 0 (bottom) … 1 (top). */
  sliceY?: number;
  /** The node card shows the node's own diagram instead (nodes that have one). */
  diagram?: boolean;
  /** Grid / Arrows density. */
  detail?: Detail;
}

const STORAGE_KEY = 'playfield.nodePreviewPrefs.v1';
/** Choices kept; the oldest go past this. */
export const MAX_PREFS = 400;

/**
 * Prefs are keyed by node id and type: ids restart at node_0 in every graph, and a node of another
 * type under a reused id should start from its own default, not inherit a stranger's pick.
 */
export const prefKey = (node: Pick<GraphNode, 'id' | 'type'>) => `${node.id}|${node.type}`;

function load(): Record<string, NodePreviewPref> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, NodePreviewPref> : {};
  } catch { return {}; }
}
function save(prefs: Record<string, NodePreviewPref>) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* private mode, full: the choice lasts this session */ }
}

/** Merge a patch into one node's prefs, newest last, trimmed to MAX_PREFS. Pure (tested). */
export function withPref(prefs: Record<string, NodePreviewPref>, key: string, patch: NodePreviewPref): Record<string, NodePreviewPref> {
  const next: Record<string, NodePreviewPref> = {};
  for (const [k, v] of Object.entries(prefs)) if (k !== key) next[k] = v;
  next[key] = { ...prefs[key], ...patch };
  const keys = Object.keys(next);
  for (let i = 0; i < keys.length - MAX_PREFS; i++) delete next[keys[i]];
  return next;
}

export const useNodePreviewPrefs = create<{
  prefs: Record<string, NodePreviewPref>;
  set: (node: Pick<GraphNode, 'id' | 'type'>, patch: NodePreviewPref) => void;
}>(set => ({
  prefs: load(),
  set: (node, patch) => set(s => {
    const prefs = withPref(s.prefs, prefKey(node), patch);
    save(prefs);
    return { prefs };
  }),
}));

export function prefOf(node: Pick<GraphNode, 'id' | 'type'>, prefs = useNodePreviewPrefs.getState().prefs): NodePreviewPref {
  return prefs[prefKey(node)] ?? {};
}

/** The node's Detail: its remembered pick, else Medium. */
export function detailFor(node: Pick<GraphNode, 'id' | 'type'>, prefs = useNodePreviewPrefs.getState().prefs): Detail {
  const d = prefs[prefKey(node)]?.detail;
  return d && DETAIL_LEVELS.some(l => l.value === d) ? d : DEFAULT_DETAIL;
}

/** The mode a node's preview of `type` uses: its remembered pick, else the default. */
export function showAsFor(
  node: Pick<GraphNode, 'id' | 'type'> & { outputs?: OutputMap },
  type: ValueType,
  outputKey?: string,
  prefs = useNodePreviewPrefs.getState().prefs,
): ShowAsMode {
  const p = prefs[prefKey(node)];
  const picked = type === 'vec2' ? p?.vec2 : p?.float;
  return picked ?? defaultShowAs(node, type, outputKey);
}
