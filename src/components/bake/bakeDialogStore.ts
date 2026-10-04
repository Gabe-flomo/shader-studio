import { create } from 'zustand';

/** What the Bake dialog was opened for (docs/bake.md): a node, the whole picture, or a Re-bake. */
export type BakeRequest = { kind: 'node'; nodeId: string } | { kind: 'picture' } | { kind: 'rebake'; nodeId: string };

/** Who's asking for the dialog: a node's menu, the toolbar, a Baked card. NodeGraph mounts it (lazily) while a request is open. */
export const useBakeDialog = create<{ request: BakeRequest | null; open: (r: BakeRequest) => void; close: () => void }>(set => ({
  request: null,
  open: request => set({ request }),
  close: () => set({ request: null }),
}));
