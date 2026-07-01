/**
 * Debounce/cancel bookkeeping for shader recompilation.
 *
 * The actual compile step (reading previewNodeId/activeGroupId, patching
 * MLG dynamic outputs, writing ~10 state fields) stays in the store's
 * `compile` action — it's irreducibly coupled to Zustand get()/set() and
 * isn't a pure function of `nodes`, so it doesn't belong in a
 * no-Zustand-dependency manager. This service only owns the timer.
 */
export class CompilationService {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Cancel any pending debounced compile. */
  cancelPending(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /** Schedule fn to run after delayMs, replacing any previously scheduled call. */
  scheduleCompile(fn: () => void, delayMs: number): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(fn, delayMs);
  }
}
