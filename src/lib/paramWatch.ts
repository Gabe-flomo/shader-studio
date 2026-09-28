/**
 * paramWatch.ts — Configure's "click a control in the plug-in's window"
 * (docs/arrangement.md): while Configure is open on an Audio Unit, its
 * parameter list is read a few times a second and compared; a parameter
 * whose value moved in the last WATCH_RECENT_MS is offered as "Add <name>".
 * (A plug-in that doesn't report its window's moves to the host shows
 * nothing here; the parameter list is always there to pick from.)
 *
 * Pure: snapshots in, moved addresses out.
 */

/** How often Configure reads the parameters (ms). */
export const WATCH_EVERY_MS = 150;
/** A parameter moved this recently is the one being touched (ms). */
export const WATCH_RECENT_MS = 500;
/** An offer stays up this long after the move, so there's time to click it (ms). */
export const WATCH_OFFER_MS = 4000;

export type ParamSnapshot = ReadonlyMap<string, number>;

/** Addresses whose value changed between two snapshots (new ones don't count: they weren't moved). */
export function movedParams(prev: ParamSnapshot | null, next: ParamSnapshot, eps = 1e-6): string[] {
  if (!prev) return [];
  const out: string[] = [];
  for (const [a, v] of next) {
    const was = prev.get(a);
    if (was !== undefined && Math.abs(v - was) > eps * Math.max(1, Math.abs(was))) out.push(a);
  }
  return out;
}

/**
 * Keeps when each parameter last moved and says which to offer: the ones
 * moved within WATCH_OFFER_MS, most recent first (at most `max`), marking
 * the ones moving right now (within WATCH_RECENT_MS).
 */
export class ParamWatch {
  private last: ParamSnapshot | null = null;
  private moved = new Map<string, number>();

  /** A new reading at `now` (ms). */
  push(snapshot: ParamSnapshot, now: number): void {
    for (const a of movedParams(this.last, snapshot)) this.moved.set(a, now);
    this.last = snapshot;
  }

  offers(now: number, max = 3): Array<{ address: string; live: boolean }> {
    return [...this.moved.entries()]
      .filter(([, at]) => now - at <= WATCH_OFFER_MS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([address, at]) => ({ address, live: now - at <= WATCH_RECENT_MS }));
  }

  /** Did anything move since watching began? */
  heard(): boolean { return this.moved.size > 0; }

  forget(address: string): void { this.moved.delete(address); }
}
