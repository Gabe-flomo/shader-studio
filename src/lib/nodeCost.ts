/**
 * nodeCost — how many milliseconds of a frame each node costs.
 *
 * There is no way to time one node inside a fragment shader, so the cost is
 * measured by absence: the whole graph is rendered as a baseline, then once
 * per node with that node bypassed (its first input passed straight through,
 * exactly as the bypass button does). The frame time saved is the node's
 * cost — its own work plus any upstream work only it needed, since the GPU
 * compiler drops code whose result is unused.
 *
 * The measurer (registered by ShaderCanvas, see perfStats.ts) compiles each
 * variant off to the side and returns median GPU milliseconds per frame, so
 * the on-screen preview is not disturbed beyond the extra GPU load. Nodes
 * inside groups are measured when that group is the open scope.
 */
import type { GraphNode } from '../types/nodeGraph';
import { compileGraph } from '../compiler/graphCompiler';
import { getNodeDefinitionFor } from '../nodes/definitions';
import { getActiveNodes, setActiveNodes } from '../store/useNodeGraphStore';
import type { ShaderCostMeasurer } from './perfStats';

export interface CostVariant {
  nodeId: string;
  label: string;
  /** The whole top-level node list with this one node bypassed */
  nodes: GraphNode[];
}

export interface NodeCost {
  nodeId: string;
  label: string;
  /** Milliseconds per frame this node costs (baseline − without it), never below 0 */
  ms: number;
  /** Share of the baseline frame, 0–1 */
  share: number;
  status: 'ok' | 'failed';
}

export interface NodeCostReport {
  baselineMs: number;
  width: number;
  height: number;
  costs: NodeCost[];
  /** Nodes that were not measured (outputs, already bypassed) */
  skipped: string[];
}

const OUTPUT_TYPES = new Set(['output', 'vec4Output']);
const SOURCE_TYPES = new Set(['uv', 'pixelUV', 'time', 'mouse', 'fragCoord', 'resolution', 'loopIndex', 'scenePos', 'marchPos', 'marchDist', 'marchLoopInputs']);

function labelOf(node: GraphNode): string {
  return (typeof node.params.label === 'string' && node.params.label.trim()) || getNodeDefinitionFor(node)?.label || node.type;
}

/** One variant per measurable node in `scopePath`; the returned lists are full top-level graphs. */
export function buildCostVariants(nodes: GraphNode[], scopePath: string[]): { variants: CostVariant[]; skipped: string[] } {
  const scope = scopePath.length ? getActiveNodes(nodes, scopePath) : nodes;
  const variants: CostVariant[] = [];
  const skipped: string[] = [];
  if (!scope) return { variants, skipped };
  for (const node of scope) {
    if (OUTPUT_TYPES.has(node.type) || SOURCE_TYPES.has(node.type) || node.bypassed || node.type.startsWith('__')) { skipped.push(node.id); continue; }
    const swapped = scope.map(n => n.id === node.id ? { ...n, bypassed: true } : n);
    const full = scopePath.length ? setActiveNodes(nodes, scopePath, swapped) : swapped;
    if (!full) { skipped.push(node.id); continue; }
    variants.push({ nodeId: node.id, label: labelOf(node), nodes: full });
  }
  return { variants, skipped };
}

export async function measureNodeCosts(opts: {
  nodes: GraphNode[];
  scopePath: string[];
  measure: ShaderCostMeasurer;
  size: { width: number; height: number };
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, label: string) => void;
}): Promise<NodeCostReport | null> {
  const { nodes, scopePath, measure, signal, onProgress } = opts;
  const { variants, skipped } = buildCostVariants(nodes, scopePath);
  const base = compileGraph({ nodes });
  if (!base.success) return null;

  onProgress?.(0, variants.length + 1, 'Whole graph');
  const baselineA = await measure(base.fragmentShader, base.vertexShader, signal);
  if (baselineA === null || signal?.aborted) return null;

  const raw: { v: CostVariant; ms: number | null }[] = [];
  for (let i = 0; i < variants.length; i++) {
    if (signal?.aborted) return null;
    const v = variants[i];
    onProgress?.(i + 1, variants.length + 1, v.label);
    const r = compileGraph({ nodes: v.nodes });
    raw.push({ v, ms: r.success ? await measure(r.fragmentShader, r.vertexShader, signal) : null });
  }
  // The GPU clock drifts while measuring; a second baseline at the end averages it out.
  const baselineB = await measure(base.fragmentShader, base.vertexShader, signal);
  const baselineMs = baselineB === null ? baselineA : (baselineA + baselineB) / 2;

  const costs: NodeCost[] = raw.map(({ v, ms }) => ms === null
    ? { nodeId: v.nodeId, label: v.label, ms: 0, share: 0, status: 'failed' }
    : { nodeId: v.nodeId, label: v.label, ms: Math.max(0, baselineMs - ms), share: baselineMs > 0 ? Math.max(0, baselineMs - ms) / baselineMs : 0, status: 'ok' });
  costs.sort((a, b) => b.ms - a.ms);
  return { baselineMs, width: opts.size.width, height: opts.size.height, costs, skipped };
}
