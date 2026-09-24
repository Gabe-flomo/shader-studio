import type { GraphNode } from '../../types/nodeGraph';

/** Undo/redo history stacks, kept outside Zustand state so pushing snapshots never triggers a re-render. */
export class UndoManager {
  private readonly maxDepth = 50;
  private history: GraphNode[][] = [];
  private redoStack: GraphNode[][] = [];
  private suspended = 0;

  /** Push a deep-clone of the current node list onto the undo stack — called
   *  before every mutating action, so it also invalidates the redo stack:
   *  a fresh edit abandons whatever branch redo would have replayed. */
  push(nodes: GraphNode[]): void {
    if (this.suspended > 0) return;
    this.pushOnto(this.history, nodes);
    this.redoStack.length = 0;
  }

  /** Run several mutating actions as a single undo step: one snapshot of `nodes`, then the
   *  pushes the actions make themselves are ignored. */
  batch(nodes: GraphNode[], run: () => void): void {
    this.push(nodes);
    this.suspended++;
    try { run(); } finally { this.suspended--; }
  }

  pop(): GraphNode[] | undefined {
    return this.history.pop();
  }

  /** undo()/redo() themselves move a snapshot from one stack to the other —
   *  unlike push(), neither should clear the opposite stack. */
  pushRedo(nodes: GraphNode[]): void {
    this.pushOnto(this.redoStack, nodes);
  }

  popRedo(): GraphNode[] | undefined {
    return this.redoStack.pop();
  }

  pushUndo(nodes: GraphNode[]): void {
    this.pushOnto(this.history, nodes);
  }

  private pushOnto(stack: GraphNode[][], nodes: GraphNode[]): void {
    stack.push(structuredClone(nodes));
    if (stack.length > this.maxDepth) stack.shift();
  }

  clear(): void {
    this.history.length = 0;
    this.redoStack.length = 0;
  }
}
