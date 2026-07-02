import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

/** Generates collision-free `node_N` IDs and re-syncs its counter after a graph load. */
export class IdGenerator {
  private counter = 0;

  next(): string {
    return `node_${this.counter++}`;
  }

  /** Advance the counter past the highest node_N index in a loaded node list
   *  so newly-added nodes never collide with existing IDs. Recursively scans
   *  all nested subgraphs so IDs inside groups are also accounted for. */
  syncFromGraph(nodes: GraphNode[]): void {
    for (const node of nodes) {
      const m = node.id.match(/^node_(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10) + 1;
        if (n > this.counter) this.counter = n;
      }
      const subgraph = node.params?.subgraph as SubgraphData | undefined;
      if (subgraph?.nodes?.length) this.syncFromGraph(subgraph.nodes);
    }
  }
}
