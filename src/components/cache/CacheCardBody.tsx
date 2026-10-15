/** The Cache card's status line and Clear (docs/cache-node.md): frames filled, their size, the memory, recording or held. */
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useTokens } from '../../theme/themeStore';
import type { GraphNode } from '../../types/nodeGraph';
import { cacheEngine, type CacheStatus } from '../../lib/cache/engine';
import { Button } from '../ui/Button';

function useStatus(nodeId: string): CacheStatus {
  const sub = useMemo(() => (fn: () => void) => cacheEngine.onChange(fn), []);
  const snap = useRef<{ key: string; v: CacheStatus } | null>(null);
  return useSyncExternalStore(sub, () => {
    const v = cacheEngine.status(nodeId);
    const key = `${v.state}:${v.filled}/${v.frames}:${v.w}x${v.h}:${v.message ?? ''}`;
    if (key !== snap.current?.key) snap.current = { key, v };
    return snap.current.v;
  });
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export function CacheCardBody({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const st = useStatus(node.id);
  const text = st.state === 'recording' || st.state === 'held'
    ? `${st.state === 'held' ? 'Held' : 'Recording'} · ${st.filled} / ${st.frames} frames · ${st.w} × ${st.h} · ${mb(st.bytes)}`
    : st.message ?? 'Records while the preview plays.';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0 4px' }}>
      <div style={{ flex: 1, fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 }}>{text}</div>
      {st.filled > 0 && <Button size="sm" onClick={() => cacheEngine.clear(node.id)} title="Forget the recorded frames and start again">Clear</Button>}
    </div>
  );
}
