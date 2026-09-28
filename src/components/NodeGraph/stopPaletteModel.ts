/**
 * stopPaletteModel.ts — the Stops Palette node's colours as the gradient bar
 * sees them, and back. The node keeps `stops` (how many) and `color0`…`color31`
 * (each stop's colour), evenly spaced: the bar's positions come from the order
 * alone, so nothing about the saved shape changes. Pure, so the GLSL parity
 * test can build a node from a stop list exactly as the card does.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { STOP_PALETTE_MAX } from '../../nodes/definitions/color';
import { getNodeDefinition } from '../../nodes/definitions';
import { colourAt, evenPositions, evenStops, sortStops, type GradientStop, type GradientStyle, type RGB } from '../ui/gradientStops';

/** The stop colours a Stops Palette node currently has, in order (2 … 32). */
export function stopColoursOf(params: Record<string, unknown>): RGB[] {
  const count = Math.max(2, Math.min(STOP_PALETTE_MAX, Math.round(Number(params.stops) || 5)));
  const defaults = getNodeDefinition('stopPalette')?.defaultParams ?? {};
  return Array.from({ length: count }, (_, i) => {
    const v = params[`color${i}`] ?? defaults[`color${i}`];
    return Array.isArray(v) && v.length >= 3 ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0] as RGB : [0.5, 0.5, 0.5] as RGB;
  });
}

/** The node's colours as evenly spaced stops for the bar. */
export function stopsOfNode(node: Pick<GraphNode, 'params'>): GradientStop[] {
  return evenStops(stopColoursOf(node.params));
}

/**
 * The params that give a node these stops: the count and one colour per stop,
 * as the Stops select and its swatches always wrote them. Colours past the count
 * are left as they were (the shader never reads them), like before.
 */
export function stopParamsOf(stops: readonly GradientStop[]): Record<string, unknown> {
  const n = Math.max(2, Math.min(STOP_PALETTE_MAX, stops.length));
  const out: Record<string, unknown> = { stops: String(n) };
  for (let i = 0; i < n; i++) { const c = stops[i].color; out[`color${i}`] = [c[0], c[1], c[2]]; }
  return out;
}

/**
 * A Library palette's colours (a Play or Present background, with a place per
 * stop) as a Stops Palette's evenly spaced stops: one per stop, sampled where
 * they sit, so an evenly spaced palette comes over exactly.
 */
export function libraryPaletteColours(p: { stops: readonly GradientStop[]; style: GradientStyle }): RGB[] {
  const sorted = sortStops(p.stops);
  const n = Math.max(2, Math.min(STOP_PALETTE_MAX, sorted.length));
  return evenPositions(n).map(t => colourAt(sorted, t, p.style));
}
