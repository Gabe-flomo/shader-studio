import type { GraphNode } from '../../types/nodeGraph';

/** What a step was, for the History panel: "Added Circle SDF", and the nodes it touched. */
export interface UndoMeta {
  /** Plain words for the step. Left out, the History panel describes it from the snapshots. */
  label?: string;
  /** Nodes the step was about (the History panel also finds the ones the snapshots differ in). */
  nodeIds?: string[];
}

/**
 * One step of history. On the undo stack `nodes` is the graph before the step; on the redo stack
 * it is the graph after it. The label and ids travel with the step between the two stacks.
 */
export interface UndoEntry extends UndoMeta {
  id: number;
  nodes: GraphNode[];
  /** When the step was made (ms since epoch). */
  at: number;
}

/** Where the history begins: a loaded example or file, or the first change kept. */
export interface UndoOrigin { label: string; at: number }

let nextEntryId = 1;

/** Undo/redo history stacks, kept outside Zustand state so pushing snapshots never triggers a re-render. */
export class UndoManager {
  readonly maxDepth = 50;
  private history: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private suspended = 0;
  private origin: UndoOrigin | null = null;
  /** The oldest steps were dropped to stay under maxDepth. */
  private trimmed = false;
  private version = 0;
  private listeners = new Set<() => void>();

  /** Push a deep-clone of the current node list onto the undo stack — called
   *  before every mutating action, so it also invalidates the redo stack:
   *  a fresh edit abandons whatever branch redo would have replayed. */
  push(nodes: GraphNode[], meta?: UndoMeta): void {
    if (this.suspended > 0) return;
    this.pushOnto(this.history, { id: nextEntryId++, nodes: structuredClone(nodes), at: Date.now(), ...meta });
    this.redoStack.length = 0;
    this.changed();
  }

  /** Run several mutating actions as a single undo step: one snapshot of `nodes`, then the
   *  pushes the actions make themselves are ignored. */
  batch(nodes: GraphNode[], run: () => void, meta?: UndoMeta): void {
    this.push(nodes, meta);
    this.suspended++;
    try { run(); } finally { this.suspended--; }
  }

  /** Name the newest step after the fact (an action that only knows what it did once it ran). */
  labelTop(meta: UndoMeta): void {
    const top = this.history[this.history.length - 1];
    if (!top) return;
    Object.assign(top, meta);
    this.changed();
  }

  /** Step back: the graph before the newest step, with `current` kept for redo. */
  undo(current: GraphNode[]): GraphNode[] | undefined {
    const e = this.history.pop();
    if (!e) return undefined;
    this.pushOnto(this.redoStack, { ...e, nodes: structuredClone(current) });
    this.changed();
    return e.nodes;
  }

  /** Step forward again: the graph after the step, with `current` kept for undo. */
  redo(current: GraphNode[]): GraphNode[] | undefined {
    const e = this.redoStack.pop();
    if (!e) return undefined;
    this.pushOnto(this.history, { ...e, nodes: structuredClone(current) });
    this.changed();
    return e.nodes;
  }

  get canUndo(): number { return this.history.length; }
  get canRedo(): number { return this.redoStack.length; }

  /** Done steps, oldest first (each one's `nodes` is the graph before it). */
  done(): readonly UndoEntry[] { return this.history; }
  /** Undone steps, the next one to redo last (each one's `nodes` is the graph after it). */
  undone(): readonly UndoEntry[] { return this.redoStack; }
  getOrigin(): UndoOrigin | null { return this.origin; }
  /** True once the oldest steps have been dropped to stay within maxDepth. */
  isTrimmed(): boolean { return this.trimmed; }

  private pushOnto(stack: UndoEntry[], entry: UndoEntry): void {
    stack.push(entry);
    if (stack.length > this.maxDepth) {
      stack.shift();
      if (stack === this.history) this.trimmed = true;
    }
  }

  /** Forget everything. `origin` names what the history now starts from ("Loaded example: Neon Glow"). */
  clear(origin?: string): void {
    this.history.length = 0;
    this.redoStack.length = 0;
    this.trimmed = false;
    this.origin = origin ? { label: origin, at: Date.now() } : null;
    this.changed();
  }

  // ── Change notification (History panel) ────────────────────────────────────
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getVersion = (): number => this.version;
  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
