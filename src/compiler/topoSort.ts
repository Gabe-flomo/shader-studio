import type { GraphNode } from '../types/nodeGraph';

// ── Loop-internal ID collection ───────────────────────────────────────────────

/**
 * Walks backwards from each loopEnd's carry input to discover the ordered body
 * node chain (from loopStart output → loopEnd input).
 *
 * Returns Map<loopEndId → orderedBodyNodeIds>.
 */
export function collectLoopPairChains(nodes: GraphNode[]): Map<string, string[]> {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const chains = new Map<string, string[]>();

  for (const endNode of nodes.filter(n => n.type === 'loopEnd')) {
    const bodyIds: string[] = [];
    let currentInput = endNode.inputs['carry']?.connection;
    while (currentInput) {
      const srcNode = nodeMap.get(currentInput.nodeId);
      if (!srcNode) break;
      if (srcNode.type === 'loopStart') break;
      bodyIds.unshift(srcNode.id);
      const nextConn = Object.values(srcNode.inputs).find(i => i.connection)?.connection;
      currentInput = nextConn ?? undefined;
    }
    chains.set(endNode.id, bodyIds);
  }
  return chains;
}

/** Flatten all body node IDs from loop-pair chains into a single exclusion set. */
export function collectLoopPairInternalIds(chains: Map<string, string[]>): Set<string> {
  const ids = new Set<string>();
  for (const bodyIds of chains.values()) {
    for (const id of bodyIds) ids.add(id);
  }
  return ids;
}

// ── Topological sort ──────────────────────────────────────────────────────────

/**
 * Kahn's algorithm topological sort.
 * Excludes loop-internal nodes (compiled separately inside loop bodies).
 * Throws on cyclic graphs.
 */
export function topologicalSort(
  nodes: GraphNode[],
  loopInternalIds = new Set<string>(),
): GraphNode[] {
  const visibleNodes = nodes.filter(n => !loopInternalIds.has(n.id));
  const nodeMap = new Map(visibleNodes.map(n => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of visibleNodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const node of visibleNodes) {
    for (const input of Object.values(node.inputs)) {
      if (input.connection) {
        const srcId = input.connection.nodeId;
        if (nodeMap.has(srcId)) {
          adjacency.get(srcId)?.push(node.id);
          inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
        }
      }
    }
  }

  const queue: string[] = [];
  const sorted: GraphNode[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    sorted.push(nodeMap.get(nodeId)!);
    for (const depId of adjacency.get(nodeId) ?? []) {
      const newDeg = (inDegree.get(depId) ?? 0) - 1;
      inDegree.set(depId, newDeg);
      if (newDeg === 0) queue.push(depId);
    }
  }

  if (sorted.length !== visibleNodes.length) {
    throw new Error('Circular dependency detected in node graph');
  }
  return sorted;
}
