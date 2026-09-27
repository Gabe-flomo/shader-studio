/**
 * Rebuild: recompile the shader and reset the GPU from scratch.
 *
 * The store's `rebuild()` recompiles the graph with every cache bypassed, then asks each live
 * preview that registered here (the main preview, the Convert page's side-by-side pair) to throw
 * its GPU state away and build it again: programs, render targets, feedback and echo history,
 * particles, textures. A handler resolves to the plain-language names of what it reset, so the
 * toast can say so. Nothing here touches the graph, the clock, the Play setup or its layers.
 */

/** Resolves to what it reset, e.g. ['the shader program', 'feedback history']. */
export type RebuildHandler = () => string[] | Promise<string[]>;

const handlers = new Set<RebuildHandler>();

/** Register a preview's GPU reset; returns the unregister function. */
export function onRebuild(handler: RebuildHandler): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

/** Run every registered GPU reset (in parallel) and return what they reset, without duplicates. */
export async function runRebuildHandlers(): Promise<string[]> {
  const results = await Promise.all([...handlers].map(async h => {
    try { return await h(); } catch (e) { console.error('[rebuild] a preview failed to reset', e); return []; }
  }));
  return [...new Set(results.flat())];
}

/** How many previews are listening (tests). */
export function rebuildHandlerCount(): number {
  return handlers.size;
}

/** The toast's list of what was reset, e.g. "the shader program, render targets and feedback history". */
export function describeReset(parts: string[]): string {
  if (parts.length === 0) return 'the shader program';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
