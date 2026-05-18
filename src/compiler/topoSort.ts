import type { GraphNode } from '../types/nodeGraph';

/**
 * Kahn's algorithm topological sort.
 * Throws on cyclic graphs.
 *
 * Uses an index-pointer queue (O(1) dequeue) instead of Array.shift() to
 * avoid O(n²) behaviour on large graphs.
 */
export function topologicalSort(nodes: GraphNode[]): GraphNode[] {
  const nodeMap  = new Map(nodes.map(n => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const node of nodes) {
    for (const input of Object.values(node.inputs)) {
      if (input.connection) {
        const srcId = input.connection.nodeId;
        if (nodeMap.has(srcId)) {
          adjacency.get(srcId)!.push(node.id);
          inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
        }
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const sorted: GraphNode[] = [];
  let head = 0;
  while (head < queue.length) {
    const nodeId = queue[head++];
    sorted.push(nodeMap.get(nodeId)!);
    for (const depId of adjacency.get(nodeId) ?? []) {
      const newDeg = (inDegree.get(depId) ?? 0) - 1;
      inDegree.set(depId, newDeg);
      if (newDeg === 0) queue.push(depId);
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('Circular dependency detected in node graph');
  }
  return sorted;
}
