// ─── Socket position registry ────────────────────────────────────────────────
// NodeComponent registers DOM elements for each socket dot here so NodeGraph
// can read actual pixel positions instead of computing from layout constants.
//
// Kept in its own file so NodeGraph.tsx only exports React components —
// required for Vite Fast Refresh (HMR) to work correctly.

type SocketRegistry = Map<string, HTMLElement>;

export const socketRegistry: SocketRegistry = new Map();

export function registerSocket(nodeId: string, dir: 'in' | 'out', key: string, el: HTMLElement | null) {
  const k = `${nodeId}:${dir}:${key}`;
  if (el) {
    socketRegistry.set(k, el);
  } else {
    socketRegistry.delete(k);
  }
}
