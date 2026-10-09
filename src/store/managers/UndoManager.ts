import type { GraphNode } from '../../types/nodeGraph';
import type { PlayRecord } from '../../types/play';

/** What a step was, for the History panel: "Added Circle SDF", and the nodes it touched. */
export interface UndoMeta {
  /** Plain words for the step. Left out, the History panel describes it from the snapshots. */
  label?: string;
  /** Nodes the step was about (the History panel also finds the ones the snapshots differ in). */
  nodeIds?: string[];
}

/** What undo and redo move between: the graph and the Play setup. */
export interface UndoState { nodes: GraphNode[]; play: PlayRecord }

/**
 * One step of history. On the undo stack the snapshots are the state before the step; on the
 * redo stack they are the state after it. A step carries only what it changed: `nodes` for a
 * graph edit, `play` for a Play edit (both for an action that replaced everything). The label
 * and ids travel with the step between the two stacks.
 *
 * Graph snapshots are deep clones (node params are edited in place in a few spots). Play
 * snapshots are the records themselves: every Play edit makes a new record and keeps the
 * unchanged parts, so fifty steps share most of their memory.
 */
export interface UndoEntry extends UndoMeta {
  id: number;
  nodes?: GraphNode[];
  play?: PlayRecord;
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
   *  a fresh edit abandons whatever branch redo would have replayed.
   *  With `play`, the step restores the Play setup too (an action that replaces both). */
  push(nodes: GraphNode[], meta?: UndoMeta, play?: PlayRecord): void {
    if (this.suspended > 0) return;
    this.pushOnto(this.history, { id: nextEntryId++, nodes: structuredClone(nodes), ...(play ? { play } : {}), at: Date.now(), ...meta });
    this.redoStack.length = 0;
    this.changed();
  }

  /** A Play edit: the record before it, kept by reference (see UndoEntry). */
  pushPlay(play: PlayRecord, meta?: UndoMeta): void {
    if (this.suspended > 0) return;
    this.pushOnto(this.history, { id: nextEntryId++, play, at: Date.now(), ...meta });
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

  /** Run a mutating action as part of the step already on top (a burst that has its step): its own pushes are ignored. */
  quietly(run: () => void): void {
    this.suspended++;
    try { run(); } finally { this.suspended--; }
  }

  /** Fold every step made after the step with id `afterId` (0 for all of them) into one: the first
   *  of them already holds the state from before the whole gesture, so dropping the rest makes the
   *  gesture a single undo. Named by `meta`. (A drop that adds a node and wires it in.) */
  collapseSince(afterId: number, meta?: UndoMeta): void {
    const first = this.history.findIndex(e => e.id > afterId);
    if (first < 0) return;
    this.history.length = first + 1;
    if (meta) Object.assign(this.history[first], meta);
    this.changed();
  }

  /** Name the newest step after the fact (an action that only knows what it did once it ran). */
  labelTop(meta: UndoMeta): void {
    const top = this.history[this.history.length - 1];
    if (!top) return;
    Object.assign(top, meta);
    this.changed();
  }

  /** The newest done step, if any. */
  top(): UndoEntry | undefined { return this.history[this.history.length - 1]; }

  /** Step back: the parts of the state the newest step changed, as they were before it; `current` is kept for redo. */
  undo(current: UndoState): Partial<UndoState> | undefined {
    const e = this.history.pop();
    if (!e) return undefined;
    this.pushOnto(this.redoStack, swapSnapshots(e, current));
    this.changed();
    return snapshotOf(e);
  }

  /** Step forward again: the parts of the state the step changed, as they were after it; `current` is kept for undo. */
  redo(current: UndoState): Partial<UndoState> | undefined {
    const e = this.redoStack.pop();
    if (!e) return undefined;
    this.pushOnto(this.history, swapSnapshots(e, current));
    this.changed();
    return snapshotOf(e);
  }

  get canUndo(): number { return this.history.length; }
  get canRedo(): number { return this.redoStack.length; }

  /** Done steps, oldest first (each one's snapshots are the state before it). */
  done(): readonly UndoEntry[] { return this.history; }
  /** Undone steps, the next one to redo last (each one's snapshots are the state after it). */
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

/** The entry moved to the other stack: the same step, its snapshots replaced by the current state of the parts it carries. */
function swapSnapshots(e: UndoEntry, current: UndoState): UndoEntry {
  const out: UndoEntry = { ...e };
  if (e.nodes) out.nodes = structuredClone(current.nodes);
  if (e.play) out.play = current.play;
  return out;
}

function snapshotOf(e: UndoEntry): Partial<UndoState> {
  const out: Partial<UndoState> = {};
  if (e.nodes) out.nodes = e.nodes;
  if (e.play) out.play = e.play;
  return out;
}
