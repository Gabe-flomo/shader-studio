/**
 * Where a wire comes from, in words ("Agent Inputs · random"), for an input's hover note, so a wire whose other
 * end is far off-screen still says what feeds it. Looks through groups too (a node inside an Agents group).
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinitionFor } from '../nodes/definitions';

function find(nodes: readonly GraphNode[], id: string): GraphNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const sg = n.params?.subgraph as SubgraphData | undefined;
    const inner = sg?.nodes?.length ? find(sg.nodes, id) : null;
    if (inner) return inner;
  }
  return null;
}

export function wireSourceLabel(nodes: readonly GraphNode[], nodeId: string, outputKey: string): string | null {
  const n = find(nodes, nodeId);
  if (!n) return null;
  const def = getNodeDefinitionFor(n);
  const name = (typeof n.params.label === 'string' && n.params.label.trim()) || def?.label || n.type;
  const out = n.outputs?.[outputKey]?.label || def?.outputs?.[outputKey]?.label || outputKey;
  return `${name} · ${out}`;
}
