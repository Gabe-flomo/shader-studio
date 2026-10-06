/**
 * outputRules.ts — suggestions from what the node's preview actually shows (docs/suggestions.md).
 *
 * The eye preview reads the node's value back from the GPU (lib/nodePreview: a small float field,
 * about 256 × 144). From that field: how much clips to white, how much is black, whether it is
 * one flat value, whether a mask is a hard 0/1 step (aliased), and whether a smooth gradient is
 * stair-stepped (banding). Each finding maps to fixes (moves.ts), and only a confident finding
 * is offered: enough finite pixels, a clear threshold, and a node the finding means something for.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { FieldStats, ValueField } from '../lib/nodePreview/valueField';
import { displayStats } from '../lib/nodePreview/valueField';
import { socketKind, type ValueKind } from './kinds';
import { intensityParam } from './moves';

export interface OutputMeasurement {
  nodeId: string;
  outputKey: string;
  type: ValueField['type'];
  /** Share of texels with a finite value. */
  finite: number;
  /** Share clipping to white, share black (as the picture shows the value). */
  clipped: number;
  black: number;
  /** The same value everywhere. */
  flat: boolean;
  /** A 0/1 mask with hard steps: share of texels at an edge that have no in-between value. */
  hardEdge: number;
  /** Stair-steps in a smooth gradient: 0…1 confidence. */
  banding: number;
  min: number;
  max: number;
}

const pct = (x: number) => `${Math.max(1, Math.round(x * 100))}%`;

/** The measurements of one preview readback. */
export function measureField(nodeId: string, outputKey: string, field: ValueField, stats: FieldStats): OutputMeasurement {
  const d = displayStats(field);
  const { data, w, h } = field;
  const ch = field.type === 'float' ? 1 : field.type === 'vec2' ? 2 : 3;
  let hard = 0, edge = 0, between = 0;
  // Banding: adjacent steps along rows, in units of the smallest non-zero step.
  const steps = new Map<number, number>();
  let zeroSteps = 0, allSteps = 0;
  const lum = (i: number) => {
    const o = i * 4;
    let s = 0;
    for (let c = 0; c < ch; c++) s += data[o + c];
    return s / ch;
  };
  const range = stats.max - stats.min;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const a = lum(i), b = lum(i + 1);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      // Mask edges: neighbours on opposite sides of 0.5.
      if (field.type === 'float' && (a < 0.5) !== (b < 0.5)) {
        edge++;
        const binary = (v: number) => Math.abs(v) < 1e-4 || Math.abs(v - 1) < 1e-4;
        if (binary(a) && binary(b)) hard++;
      }
      if (field.type === 'float' && a > 0.02 && a < 0.98) between++;
      if (range > 0) {
        const q = Math.round(((b - a) / range) * 4096);
        allSteps++;
        if (q === 0) zeroSteps++;
        else steps.set(Math.abs(q), (steps.get(Math.abs(q)) ?? 0) + 1);
      }
    }
  }
  const hardEdge = edge >= Math.max(8, w * 0.1) && between / Math.max(1, w * h) < 0.03 ? hard / edge : 0;
  // A gradient that bands: most neighbours are equal, the rest jump by one same small step, and
  // there are several levels (not a two-tone mask).
  let banding = 0;
  if (allSteps > 0 && steps.size > 0) {
    const [[unit, unitCount]] = [...steps.entries()].sort((a, b) => b[1] - a[1]);
    const levels = range > 0 ? Math.round(4096 / unit) : 0;
    const flatShare = zeroSteps / allSteps;
    const unitShare = unitCount / (allSteps - zeroSteps);
    if (levels >= 4 && levels <= 64 && flatShare > 0.8 && unitShare > 0.6) banding = Math.min(1, (flatShare - 0.8) * 5 * unitShare);
  }
  return {
    nodeId, outputKey, type: field.type,
    finite: stats.total ? stats.finite / stats.total : 0,
    clipped: d.clipped, black: d.black, flat: stats.constant || (field.type !== 'float' && field.type !== 'vec2' && d.flat && stats.max - stats.min < 1e-3),
    hardEdge, banding, min: stats.min, max: stats.max,
  };
}

export interface OutputSuggestion {
  moveId: string;
  /** The output it is for. */
  key: string;
  /** The one-line reason, with the number ("clips 6%"). */
  why: string;
  /** 0…1: how strong the finding is. */
  severity: number;
  args?: Record<string, unknown>;
}

/** Nodes that are meant to be flat, stepped or clipped: no fixes for them. */
const INTENDED = new Set(['posterize', 'quantize', 'floor', 'ceil', 'round', 'step', 'compare', 'cellFilter', 'colorPicker', 'constant', 'vec2Const', 'time', 'mouse', 'output', 'cmykHalftone', 'pixelate', 'scanlines']);
const MARCH_TYPES = new Set(['marchLoopGroup', 'giLitMarchGroup']);

/** Fixes the measurement calls for, strongest first. Empty when nothing is confident. */
export function outputSuggestions(node: GraphNode, m: OutputMeasurement | null): OutputSuggestion[] {
  if (!m || m.nodeId !== node.id || m.finite < 0.95 || INTENDED.has(node.type)) return [];
  const s = node.outputs[m.outputKey];
  if (!s) return [];
  const kind: ValueKind | null = socketKind(node.type, m.outputKey, s, 'out');
  const out: OutputSuggestion[] = [];
  const key = m.outputKey;
  const colour = kind === 'colour';

  if (m.flat) {
    if (Object.entries(node.inputs).some(([k, i]) => i.type === 'vec2' && !i.connection && /uv|position|^p$|input/i.test(k))) {
      out.push({ moveId: 'feed-uv', key, why: 'flat: the same value everywhere, nothing position-dependent reaches it', severity: 0.9 });
    } else if (colour) out.push({ moveId: 'add-gradient', key, why: 'flat: one colour everywhere', severity: 0.7 });
    else if (kind === 'scalar' || kind === 'mask') out.push({ moveId: 'add-noise', key, why: 'flat: one value everywhere', severity: 0.7 });
    return out;
  }

  // Clipping: only for colours and light (a mask is meant to reach 1).
  if (m.clipped > 0.05 && (colour || node.type === 'light' || node.type === 'glowLayer' || node.type === 'deepGlow')) {
    const sev = Math.min(1, m.clipped * 3);
    if (colour) out.push({ moveId: 'tone-map', key, why: `clips ${pct(m.clipped)} to white: Tone Map keeps the highlights`, severity: sev });
    const p = intensityParam(node);
    if (p) out.push({ moveId: 'dimmer', key, why: `clips ${pct(m.clipped)}: ${p.brighterUp ? `lower ${p.key}` : 'a higher Falloff'} brings it back`, severity: sev * 0.9 });
  }

  // Mostly black: not for distances (black inside is how they look) or masks.
  if (m.black > 0.85 && (colour || kind === 'scalar')) {
    const p = intensityParam(node);
    if (p) out.push({ moveId: 'brighter-param', key, why: `${pct(m.black)} black: ${node.type === 'light' ? 'check the Falloff (lower is wider)' : `raise ${p.key}`}`, severity: 0.6 });
    if (colour) out.push({ moveId: 'brighten', key, why: `${pct(m.black)} black: lift the brightness`, severity: 0.5 });
    else if (m.max > m.min) out.push({ moveId: 'remap', key, why: `${pct(m.black)} black: remap ${round(m.min)}…${round(m.max)} to 0…1`, severity: 0.55, args: { inMin: round(m.min), inMax: round(m.max) } });
  }

  // A hard 0/1 edge: aliased.
  if (m.hardEdge > 0.9 && (kind === 'mask' || kind === 'scalar')) {
    out.push({ moveId: 'soft-edge', key, why: 'hard 0/1 edge: aliased, a soft edge smooths it', severity: 0.6 });
  }

  // Banding: stair-steps in a smooth gradient.
  if (m.banding > 0.3) {
    if (MARCH_TYPES.has(node.type) && typeof node.params.jitter === 'number' && (node.params.jitter as number) < 0.5) {
      out.push({ moveId: 'jitter', key, why: 'banding: rings from the march steps, Jitter staggers them', severity: m.banding });
    } else if (colour) out.push({ moveId: 'grain', key, why: 'banding: stair-steps in the gradient, a little grain dithers them', severity: m.banding * 0.8 });
    else if (kind === 'scalar' || kind === 'distance') out.push({ moveId: 'dither', key, why: 'banding: stair-steps in the gradient', severity: m.banding * 0.8 });
  }
  return out.sort((a, b) => b.severity - a.severity);
}

const round = (x: number) => Math.round(x * 1000) / 1000;
