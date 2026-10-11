/**
 * stepRun.ts — stepping the live agents in the Agent Builder (docs/agent-builder.md, "Stepping"):
 * pause, one step forward, one step back. The simulation is the main preview's (lib/agentRunner.ts):
 * a step is one fixed tick of every group (1/60 s of simulated time, kit/agentPlan.js), a pure
 * function of the state before it, the step number and the seed, so stepping is deterministic.
 *
 * Going back needs the state as it was: snapshots of the state textures and the schedule, kept
 * before every frame that steps (a played frame runs a few steps at once; a step forward one). One
 * step back restores the newest snapshot at or before the step wanted and runs forward the steps
 * between (the same steps again, so the same state): back is always exactly one step, even into a
 * stretch that was played. Snapshots are GPU textures as big as the state (a 512² group with its
 * trail is about 25 MB), so only the last few are kept: at most BACK_MAX, and no more than
 * BACK_BUDGET bytes together (always at least one). You can go back as far as the oldest.
 *
 * The pure part, shared by the runner and the tests: the ring of snapshots (any state type; the
 * runner's are render targets, the tests' arrays), the plan of a step back, and the queue of what
 * the buttons asked for, which the runner works through at its next frame.
 */

/** Most snapshots kept. */
export const BACK_MAX = 60;
/** Most bytes the snapshots take together (GPU memory). */
export const BACK_BUDGET = 256 * 1024 * 1024;

export interface Kept<S> { state: S; bytes: number; step: number }

/**
 * The last snapshots, oldest first. Pushing past BACK_MAX entries, or past the byte budget, drops
 * the oldest (handed to `drop`, which frees it or keeps it to reuse); the newest always stays.
 */
export class SnapshotRing<S> {
  private items: Array<Kept<S>> = [];
  readonly max: number;
  readonly budget: number;
  private drop: (s: S) => void;

  constructor(drop: (s: S) => void = () => {}, max = BACK_MAX, budget = BACK_BUDGET) {
    this.drop = drop; this.max = Math.max(1, max); this.budget = budget;
  }

  get size(): number { return this.items.length; }
  get bytes(): number { return this.items.reduce((n, k) => n + k.bytes, 0); }
  /** The step of the newest snapshot (null when none). */
  get lastStep(): number | null { return this.items.length ? this.items[this.items.length - 1].step : null; }
  /** The step of the oldest snapshot (null when none): as far back as you can go. */
  get firstStep(): number | null { return this.items.length ? this.items[0].step : null; }

  push(state: S, bytes: number, step: number): void {
    this.items.push({ state, bytes, step });
    this.trim();
  }

  /** The newest snapshot, left in place. */
  peek(): Kept<S> | undefined { return this.items[this.items.length - 1]; }

  /** The newest snapshot, taken out (the caller restores it, then frees or reuses it). */
  pop(): Kept<S> | undefined { return this.items.pop(); }

  /** A snapshot taken out with pop(), done with (freed, or kept to reuse). */
  free(s: S): void { this.drop(s); }

  /** Every snapshot dropped (the run started over, or stepping closed). */
  clear(): void { for (const k of this.items.splice(0)) this.drop(k.state); }

  private trim(): void {
    let total = this.bytes;
    while (this.items.length > 1 && (this.items.length > this.max || total > this.budget)) {
      const k = this.items.shift()!;
      total -= k.bytes;
      this.drop(k.state);
    }
  }
}

/**
 * `backs` steps back from step `now`: the snapshot to restore and how many steps to run after it.
 * The step wanted is now − backs, but no further back than the oldest snapshot. Snapshots after it
 * are dropped; the one restored is taken out when it is the step wanted itself (`popped`), else it
 * stays for the next step back. Null when there is nothing to go back to.
 */
export function planBack<S>(ring: SnapshotRing<S>, now: number, backs: number): { kept: Kept<S>; replay: number; popped: boolean } | null {
  const first = ring.firstStep;
  if (first === null || backs <= 0 || now <= first) return null;
  const target = Math.max(first, now - backs);
  while ((ring.lastStep ?? -Infinity) > target) ring.free(ring.pop()!.state);
  const kept = ring.peek();
  if (!kept) return null;
  const replay = target - kept.step;
  if (replay === 0) ring.pop();
  return { kept, replay, popped: replay === 0 };
}

/** How many snapshots of `bytes` each fit (at least 1). */
export function backReach(bytes: number, max = BACK_MAX, budget = BACK_BUDGET): number {
  if (!(bytes > 0)) return max;
  return Math.max(1, Math.min(max, Math.floor(budget / bytes)));
}

/** What a button asked for: one step back, or n steps forward. */
export type StepOp = { back: true } | { forward: number };

/**
 * The next batch a frame works through: the backs at the head of the queue (one restore for all
 * of them), or else the forward steps up to the next back (run together, one snapshot before
 * them). Whatever is left waits for the next frame.
 */
export function nextBatch(ops: readonly StepOp[]): { backs: number; forward: number; rest: StepOp[] } {
  let i = 0, backs = 0, forward = 0;
  while (i < ops.length && 'back' in ops[i]) { backs++; i++; }
  if (backs) return { backs, forward: 0, rest: ops.slice(i) };
  while (i < ops.length && 'forward' in ops[i]) { forward += Math.max(0, Math.round((ops[i] as { forward: number }).forward)); i++; }
  return { backs: 0, forward, rest: ops.slice(i) };
}

/** A simulation to step: its state copied and put back, and exactly n steps of it. */
export interface Steppable<S> {
  step(n: number): void;
  snapshot(): S;
  restore(s: S): void;
  /** Its step count now. */
  stepNow(): number;
  bytes(s: S): number;
}

/**
 * The stepper over a simulation that steps at once (the tests' CPU stand-in; the runner does the
 * same in its frame, lib/agentSnapshots.ts): forward keeps a snapshot then steps, back restores
 * and runs forward to one step before.
 */
export class Stepper<S> {
  readonly ring: SnapshotRing<S>;
  private sim: Steppable<S>;
  constructor(sim: Steppable<S>, ring = new SnapshotRing<S>()) { this.sim = sim; this.ring = ring; }

  get canBack(): boolean { const f = this.ring.firstStep; return f !== null && this.sim.stepNow() > f; }

  /** A snapshot of now, kept (as a played frame does before its steps). */
  keep(): void {
    const s = this.sim.snapshot();
    this.ring.push(s, this.sim.bytes(s), this.sim.stepNow());
  }

  /** n steps forward (a played frame, or a step by hand), kept to go back over. */
  forward(n = 1): void {
    if (n <= 0) return;
    this.keep();
    this.sim.step(n);
  }

  /** `backs` steps back (as far as the oldest snapshot); false when there is nothing to go back to. */
  back(backs = 1): boolean {
    const p = planBack(this.ring, this.sim.stepNow(), backs);
    if (!p) return false;
    this.sim.restore(p.kept.state);
    if (p.popped) this.ring.free(p.kept.state);
    this.sim.step(p.replay);
    return true;
  }

  /** Works through a queue of ops as a frame would (all of them). */
  apply(ops: readonly StepOp[]): void {
    let rest = ops.slice();
    while (rest.length) {
      const b = nextBatch(rest);
      if (b.backs) this.back(b.backs);
      this.forward(b.forward);
      rest = b.rest;
    }
  }
}
