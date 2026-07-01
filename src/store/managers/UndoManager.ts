import type { GraphNode } from '../../types/nodeGraph';

/** Undo history stack, kept outside Zustand state so pushing snapshots never triggers a re-render. */
export class UndoManager {
  private readonly maxDepth = 50;
  private history: GraphNode[][] = [];

  /** Push a deep-clone of the current node list onto the undo stack. */
  push(nodes: GraphNode[]): void {
    this.history.push(structuredClone(nodes));
    if (this.history.length > this.maxDepth) this.history.shift();
  }

  pop(): GraphNode[] | undefined {
    return this.history.pop();
  }

  clear(): void {
    this.history.length = 0;
  }
}
