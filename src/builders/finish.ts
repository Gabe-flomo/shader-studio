/**
 * finish.ts — what every builder's Done does: close the builder window and go back to the graph,
 * framed on the nodes the builder made, so the result is the first thing you see.
 *
 * Shared by the 2D and 3D Scene Builders, the Grid Rules editor, the Agent Rules editor, the
 * Agent Builder (through the close handler BuilderWindowsHost gives it) and the Expression
 * Builder's Add to graph. Nothing to frame (a builder closed before it made anything) just closes.
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';

/** How long the window takes to go before the canvas is measured and framed. */
const FRAME_DELAY_MS = 80;

/** The ids among `ids` that exist at the graph's top level. */
export function topLevelIdsOf(ids: ReadonlyArray<string | null | undefined>): string[] {
  const nodes = useNodeGraphStore.getState().nodes;
  const want = new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0));
  return nodes.filter(n => want.has(n.id)).map(n => n.id);
}

/** Frame (zoom to fit) these nodes on the graph canvas, after the builder window has gone. */
export function frameNodes(ids: ReadonlyArray<string | null | undefined>): void {
  const keep = topLevelIdsOf(ids);
  if (!keep.length) return;
  const st = useNodeGraphStore.getState();
  // Builders build at the top level: show that level, not a group the user happened to be inside.
  if (st.activeGroupPath.length) st.exitToRoot();
  setTimeout(() => useNodeGraphStore.getState()._fitViewCallback?.(keep), FRAME_DELAY_MS);
}

/** A builder's Done: close it (`close`), then frame what it made (`ids`). */
export function finishBuilder(close: () => void, ids: ReadonlyArray<string | null | undefined> = []): void {
  close();
  frameNodes(ids);
}

