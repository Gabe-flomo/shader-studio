/**
 * FreezeBehindBuilder — the part of the app behind a mirroring builder window (the Splat builder, the Agent Builder)
 * stops re-rendering while it is open (builders/builderFocus.ts). Without it every slider tick, which the builder
 * writes into the graph at once, re-rendered the node cards, the wires, the minimap and the node browser under the
 * window, where nobody can see them.
 *
 * The usual Suspense freeze: while frozen the gate suspends on a promise that only settles when the builder closes,
 * so React keeps the subtree (its state and DOM, hidden with display: none) and doesn't render it; store updates
 * meanwhile are applied when it thaws. Layout effects inside are cleaned up while frozen and run again on thaw.
 *
 * Also frozen for the whole of a Scene builder session (builders/sceneDraft.ts): the graph in the store is the
 * builder's draft then, so the cards behind the window keep showing your graph, and closing without Done never
 * flashes the draft.
 */
import { Suspense, useState, type ReactNode } from 'react';
import { useBuilderFocus } from '../../builders/builderFocus';
import { useSceneDraftActive } from '../../builders/sceneDraftFlag';

/** The promise a frozen gate waits on: one per freeze, settled when it thaws. */
class Wait {
  private promise: Promise<void> | null = null;
  private resolve: () => void = () => {};
  /** The promise to suspend on (the same one for the whole freeze). */
  hold(): Promise<void> {
    if (!this.promise) this.promise = new Promise<void>(r => { this.resolve = r; });
    return this.promise;
  }
  /** Thawed: settle it. */
  release(): void {
    if (!this.promise) return;
    this.resolve();
    this.promise = null;
  }
}

function Gate({ frozen, children }: { frozen: boolean; children: ReactNode }) {
  // Kept for the gate's life (useState, not a ref: it is used while rendering).
  const [wait] = useState(() => new Wait());
  if (frozen) throw wait.hold();
  wait.release();
  return <>{children}</>;
}

/** `children`, frozen while a mirroring builder or a Scene builder session is open (or while `frozen`, for tests and callers that know better). */
export function FreezeBehindBuilder({ children, frozen }: { children: ReactNode; frozen?: boolean }) {
  const focus = useBuilderFocus();
  const draft = useSceneDraftActive();
  return (
    <Suspense fallback={null}>
      <Gate frozen={frozen ?? (focus || draft)}>{children}</Gate>
    </Suspense>
  );
}
