/**
 * previewExplain — a plain-language line about what the isolated preview of a
 * node is showing, from a few numbers read back from the frame.
 *
 * Stepping through a graph, a Multiply often shows a white screen and a
 * distance field shows a black one; neither is broken, but neither explains
 * itself. The frame stats say how much of the picture clips to white, how much
 * is black, and whether it is one flat colour; the node's output type and
 * parameters turn that into a sentence with the likely fix.
 */
import type { GraphNode, NodeDefinition } from '../types/nodeGraph';

export interface PreviewStats {
  /** Share of pixels with a channel at or above white, 0–1 */
  clipped: number;
  /** Share of pixels that are black (all channels near 0), 0–1 */
  black: number;
  /** Every sampled pixel is the same colour */
  flat: boolean;
  /** Mean brightness 0–1 */
  mean: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const numParam = (node: GraphNode, key: string) => (typeof node.params[key] === 'number' ? (node.params[key] as number) : null);

function primaryOutputType(node: GraphNode, def: NodeDefinition | undefined): string | null {
  const first = Object.values(node.outputs)[0] ?? Object.values(def?.outputs ?? {})[0];
  return first?.type ?? null;
}

/** How the preview draws this output type — the legend. */
export function previewLegend(node: GraphNode, def: NodeDefinition | undefined): string | null {
  switch (primaryOutputType(node, def)) {
    case 'float': return 'A float shown as grey: black is 0 or below, white is 1 or above.';
    case 'vec2':  return 'A vec2 shown as colour: red is x, green is y; negative parts show black.';
    case 'vec4':  return 'A vec4 shown without its alpha.';
    default:      return null;
  }
}

/** One or two sentences on what the frame stats mean for this node, with the likely fix. */
export function explainPreview(node: GraphNode, def: NodeDefinition | undefined, stats: PreviewStats | null): string | null {
  if (!stats) return null;
  const type = primaryOutputType(node, def);
  const isDistance = /sdf|dist/i.test(node.type) || Object.keys(node.outputs)[0] === 'distance' || Object.keys(node.outputs)[0] === 'dist';

  if (stats.flat) {
    if (stats.black > 0.95) return 'Black everywhere: the value is 0 or below at every pixel and nothing here changes with position. Check that UV reaches this node.';
    if (stats.clipped > 0.95) return 'White everywhere: the value is 1 or more at every pixel and nothing here changes with position. Check that UV reaches this node, or lower what multiplies it.';
    return 'One flat colour: this value is the same at every pixel, so nothing position-dependent (UV, a shape, noise) reaches it yet.';
  }
  if (stats.black > 0.9) {
    if (type === 'float' && isDistance) return 'Almost all black: a distance is 0 at the shape\'s edge and negative inside, so it only lights up far outside. Feed it to SDF Glow, SDF Fill or SDF Colorize to see the shape.';
    if (type === 'float') return 'Almost all black: this value is 0 or below across most of the frame. Remap it or check its inputs.';
    return 'Almost all black: nothing lights up here yet.';
  }
  if (stats.clipped > 0.3) {
    const where = `${pct(stats.clipped)} of the picture clips to white because the value runs past 1.`;
    if (node.type === 'multiply') { const b = numParam(node, 'b'); return `${where} Multiply${b !== null ? ` by ${b}` : ''} pushes it over — lower B, or add Tone Map after it.`; }
    if (node.type === 'add') return `${where} Add pushes it over — a smaller B, or Tone Map after it, brings it back.`;
    if (node.type === 'light' || node.type === 'glowLayer' || node.type === 'deepGlow') return `${where} Inside the shape the glow exceeds 1; raise Falloff or add Tone Map.`;
    if (node.type === 'pow' || node.type === 'exp') return `${where} Powers and exponentials grow fast — clamp or Tone Map after them.`;
    return `${where} Tone Map, or a Multiply below 1, brings it back into range.`;
  }
  if (stats.clipped > 0.05) return `Some bright areas clip to white (${pct(stats.clipped)}); Tone Map would keep their detail.`;
  if (type === 'float' && isDistance) return 'Grey ramp: 0 (black) at the shape\'s edge growing outward. Inside the shape the distance is negative and shows black.';
  return 'Values stay within 0–1 across the frame.';
}
