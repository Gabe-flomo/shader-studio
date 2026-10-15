/** The Blob Track card's status line (docs/blob-track.md): how many blobs, at what size, how long it takes. */
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useTokens } from '../../theme/themeStore';
import type { GraphNode } from '../../types/nodeGraph';
import { blobEngine, type BlobStatus } from '../../lib/blobs/engine';

function useStatus(nodeId: string): BlobStatus {
  const sub = useMemo(() => (fn: () => void) => blobEngine.onChange(fn), []);
  const snap = useRef<{ key: string; v: BlobStatus } | null>(null);
  return useSyncExternalStore(sub, () => {
    const v = blobEngine.status(nodeId);
    const key = `${v.state}:${v.count}:${v.w}x${v.h}:${v.message ?? ''}`;
    if (key !== snap.current?.key) snap.current = { key, v };
    return snap.current.v;
  });
}

export function BlobTrackCardBody({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const st = useStatus(node.id);
  const text = st.state === 'running'
    ? `${st.count} blob${st.count === 1 ? '' : 's'} · read at ${st.w} × ${st.h}${st.ms != null ? ` · ${st.ms.toFixed(1)} ms` : ''}`
    : st.state === 'no-source' || st.state === 'error' ? st.message ?? 'No picture yet.'
    : 'Finds blobs while the preview plays.';
  return <div style={{ fontSize: 11.5, color: st.state === 'error' ? tk.status.danger : tk.text.muted, lineHeight: 1.45, padding: '2px 0 4px' }}>{text}</div>;
}
