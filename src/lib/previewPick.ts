/**
 * previewPick — "click a point on the preview" for a node (Segment's Pick, docs/segment-node.md). A card arms it
 * with a callback; the next left press inside the picture is taken (it doesn't reach the shader as a mouse press),
 * given to the callback as texture coordinates (0–1, y up), and the pick ends. Escape or a second arm cancels.
 */
type Pick = (st: [number, number]) => void;

let pending: { cb: Pick; owner: string } | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const fn of listeners) fn(); };

export function armPreviewPick(owner: string, cb: Pick): void { pending = { cb, owner }; changed(); }
export function cancelPreviewPick(): void { if (pending) { pending = null; changed(); } }
/** Who is picking now (a node id), or null. */
export const previewPickOwner = (): string | null => pending?.owner ?? null;
export function onPreviewPickChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** The preview's press: true when a pick took it. */
export function consumePreviewPick(st: [number, number]): boolean {
  if (!pending) return false;
  const { cb } = pending;
  pending = null;
  changed();
  cb(st);
  return true;
}

if (typeof window !== 'undefined') window.addEventListener('keydown', e => { if (e.key === 'Escape') cancelPreviewPick(); });
