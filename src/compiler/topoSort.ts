import type { GraphNode, DataType } from '../types/nodeGraph';

// ── Loop-pair chain data ──────────────────────────────────────────────────────

export interface LoopPairChain {
  bodyIds:     string[];       // ordered body node IDs (loopStart output → loopEnd input)
  startNodeId: string | null;  // ID of the paired loopStart node
  carryType:   DataType;       // resolved from what's wired into loopStart.carry
  iterations:  number;         // from loopStart.params.iterations, clamped 1–32
}

/**
 * Walks backwards from each loopEnd's carry input to discover the ordered body
 * node chain (from loopStart output → loopEnd input).
 *
 * Returns Map<loopEndId → LoopPairChain>.
 */
export function collectLoopPairChains(nodes: GraphNode[]): Map<string, LoopPairChain> {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const chains  = new Map<string, LoopPairChain>();

  for (const endNode of nodes.filter(n => n.type === 'loopEnd')) {
    const bodyIds: string[] = [];
    let currentInput = endNode.inputs['carry']?.connection;
    let startNode: GraphNode | undefined;

    while (currentInput) {
      const srcNode = nodeMap.get(currentInput.nodeId);
      if (!srcNode) break;
      if (srcNode.type === 'loopStart') {
        startNode = srcNode;
        break;
      }
      bodyIds.unshift(srcNode.id);

      // Fixed walk: prefer a connection that leads back to an already-discovered
      // chain node or to a loopStart. Falls back to first connected input so
      // simple single-input nodes still work.
      const nextConn = (
        Object.values(srcNode.inputs).find(i =>
          i.connection && (
            nodeMap.get(i.connection.nodeId)?.type === 'loopStart' ||
            bodyIds.includes(i.connection.nodeId)
          ),
        ) ?? Object.values(srcNode.inputs).find(i => i.connection)
      )?.connection;

      currentInput = nextConn ?? undefined;
    }

    // Resolve carryType from what's wired INTO loopStart.carry, or from its
    // explicit carryType param when nothing is connected.
    let carryType: DataType = 'vec2';
    if (startNode) {
      const conn = startNode.inputs['carry']?.connection;
      if (conn) {
        const srcNode = nodeMap.get(conn.nodeId);
        const t = srcNode?.outputs[conn.outputKey]?.type;
        if (t === 'float' || t === 'vec2' || t === 'vec3' || t === 'vec4') {
          carryType = t as DataType;
        }
      } else {
        const cp = startNode.params['carryType'];
        if (cp === 'float' || cp === 'vec2' || cp === 'vec3' || cp === 'vec4') {
          carryType = cp as DataType;
        }
      }
    }

    const iterations = startNode
      ? Math.max(1, Math.min(32, Math.round(
          typeof startNode.params.iterations === 'number' ? startNode.params.iterations : 4,
        )))
      : 4;

    chains.set(endNode.id, {
      bodyIds,
      startNodeId: startNode?.id ?? null,
      carryType,
      iterations,
    });
  }

  return chains;
}

/** Flatten all body node IDs from loop-pair chains into a single exclusion set. */
export function collectLoopPairInternalIds(chains: Map<string, LoopPairChain>): Set<string> {
  const ids = new Set<string>();
  for (const chain of chains.values()) {
    for (const id of chain.bodyIds) ids.add(id);
  }
  return ids;
}

// ── Topological sort ──────────────────────────────────────────────────────────

/**
 * Kahn's algorithm topological sort.
 * Excludes loop-internal nodes (compiled separately inside loop bodies).
 * Throws on cyclic graphs.
 *
 * `loopPairChains` is used to add artificial loopStart → loopEnd edges so the
 * sort always processes loopStart before its paired loopEnd, even though the
 * only graph path between them passes through excluded body nodes.
 */
export function topologicalSort(
  nodes: GraphNode[],
  loopInternalIds = new Set<string>(),
  loopPairChains?: Map<string, LoopPairChain>,
): GraphNode[] {
  const visibleNodes = nodes.filter(n => !loopInternalIds.has(n.id));
  const nodeMap = new Map(visibleNodes.map(n => [n.id, n]));
  const inDegree  = new Map<string, number>();
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

  // Add artificial loopStart → loopEnd edges so the loopStart is always
  // processed before its paired loopEnd.  Without this, the only graph path
  // between them passes through excluded body nodes, so the sort has no
  // ordering constraint and may schedule loopEnd first.
  //
  // Also add externalSource → loopEnd edges for any external connections used
  // by body nodes (e.g. a body node in Loop2 reading the result of Loop1's end
  // node).  Without this, two independent loops could be ordered arbitrarily
  // even when one loop's body depends on the other loop's output.
  if (loopPairChains) {
    const allNodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const [endId, chain] of loopPairChains.entries()) {
      const { startNodeId, bodyIds } = chain;
      if (startNodeId && nodeMap.has(endId) && nodeMap.has(startNodeId)) {
        adjacency.get(startNodeId)?.push(endId);
        inDegree.set(endId, (inDegree.get(endId) ?? 0) + 1);
      }
      // Build the set of all IDs internal to this chain (body + start)
      const chainIds = new Set(bodyIds);
      if (startNodeId) chainIds.add(startNodeId);
      // Scan body nodes for external connections
      for (const bodyId of bodyIds) {
        const bodyNode = allNodeMap.get(bodyId);
        if (!bodyNode) continue;
        for (const input of Object.values(bodyNode.inputs)) {
          if (!input.connection) continue;
          const srcId = input.connection.nodeId;
          // External = not in this chain AND visible in the main sort
          if (!chainIds.has(srcId) && nodeMap.has(srcId) && nodeMap.has(endId)) {
            adjacency.get(srcId)?.push(endId);
            inDegree.set(endId, (inDegree.get(endId) ?? 0) + 1);
          }
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
