/** The Analyze card's live numbers (docs/analyze-node.md): a swatch of the average colour and the main readings. */
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useTokens } from '../../theme/themeStore';
import type { GraphNode } from '../../types/nodeGraph';
import { analyzeEngine, type AnalyzeStatus } from '../../lib/analyze/engine';

function useStatus(nodeId: string): AnalyzeStatus {
  const sub = useMemo(() => (fn: () => void) => analyzeEngine.onChange(fn), []);
  const snap = useRef<{ key: string; v: AnalyzeStatus } | null>(null);
  return useSyncExternalStore(sub, () => {
    const v = analyzeEngine.status(nodeId);
    const a = v.last;
    const key = `${v.state}:${v.w}x${v.h}:${v.message ?? ''}:${a ? [a.brightness, a.coverage, a.motion, a.r, a.g, a.b].map(x => x.toFixed(2)).join(',') : ''}`;
    if (key !== snap.current?.key) snap.current = { key, v };
    return snap.current.v;
  });
}

export function AnalyzeCardBody({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const st = useStatus(node.id);
  const a = st.last;
  const gain = typeof node.params.motionGain === 'number' ? node.params.motionGain : 10;
  if (st.state !== 'running' || !a) {
    return <div style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45, padding: '2px 0 4px' }}>{st.message ?? 'Measures while the preview plays.'}</div>;
  }
  const c = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0 4px', fontSize: 11.5, color: tk.text.muted, fontVariantNumeric: 'tabular-nums' }}>
      <span title="Average colour" style={{ width: 14, height: 14, borderRadius: 3, flex: 'none', border: `1px solid ${tk.border.default}`, background: `rgb(${c(a.r)}, ${c(a.g)}, ${c(a.b)})` }} />
      <span>Bright {a.brightness.toFixed(2)} · Lit {a.coverage.toFixed(2)} · Motion {(a.motion * gain).toFixed(2)}</span>
    </div>
  );
}
