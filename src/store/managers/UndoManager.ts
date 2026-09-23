import type { GraphNode } from '../../types/nodeGraph';

/** Undo/redo history stacks, kept outside Zustand state so pushing snapshots never triggers a re-render. */
export class UndoManager {
  private readonly maxDepth = 50;
  private history: GraphNode[][] = [];
  private redoStack: GraphNode[][] = [];

  /** Push a deep-clone of the current node list onto the undo stack — called
   *  before every mutating action, so it also invalidates the redo stack:
   *  a fresh edit abandons whatever branch redo would have replayed. */
  push(nodes: GraphNode[]): void {
    this.pushOnto(this.history, nodes);
    this.redoStack.length = 0;
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
