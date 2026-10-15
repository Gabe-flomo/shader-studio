/**
 * The Segment card's own lines (docs/segment-node.md): the model's state and time, how much it finds; for Objects
 * the kinds as chips; for Click a Pick button (the next click on the preview sets the point).
 */
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import type { GraphNode } from '../../types/nodeGraph';
import { segmentEngine, type SegmentStatus } from '../../lib/segment/engine';
import { SEGMENT_CLASSES, segmentClassesOf, segmentModeOf } from '../../nodes/definitions/segment';
import { armPreviewPick, cancelPreviewPick, onPreviewPickChange, previewPickOwner } from '../../lib/previewPick';
import { Button } from '../ui/Button';

function useStatus(nodeId: string): SegmentStatus {
  const sub = useMemo(() => (fn: () => void) => segmentEngine.onChange(fn), []);
  const snap = useRef<{ key: string; v: SegmentStatus } | null>(null);
  return useSyncExternalStore(sub, () => {
    const v = segmentEngine.status(nodeId);
    const key = `${v.state}:${v.w}x${v.h}:${v.delegate}:${v.message ?? ''}:${v.ms == null ? '' : Math.round(v.ms / 4)}:${v.cover.toFixed(2)}`;
    if (key !== snap.current?.key) snap.current = { key, v };
    return snap.current.v;
  });
}

const usePicking = (nodeId: string) => useSyncExternalStore(onPreviewPickChange, () => previewPickOwner() === nodeId);

export function SegmentCardBody({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const st = useStatus(node.id);
  const picking = usePicking(node.id);
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const mode = segmentModeOf(node);
  const chosen = new Set(segmentClassesOf(node));
  const line = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  const text = st.state === 'running'
    ? `${st.delegate ?? ''} · ${st.ms != null ? `${st.ms.toFixed(0)} ms` : ''} · ${st.w} × ${st.h} · finds ${(st.cover * 100).toFixed(0)}% of the frame`
    : st.state === 'loading' ? 'Loading the model…'
    : st.message ?? 'Segments while the preview shows it.';
  const toggle = (k: string) => {
    const next = new Set(chosen);
    if (next.has(k)) next.delete(k); else next.add(k);
    update(node.id, { classes: [...next].join(', ') });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 0 4px' }}>
      <div style={{ ...line, color: st.state === 'error' ? tk.status.danger : tk.text.muted }}>{text}</div>
      {mode === 'objects' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {SEGMENT_CLASSES.map(c => {
            const on = chosen.has(c.key);
            return (
              <button key={c.key} type="button" onClick={() => toggle(c.key)} aria-pressed={on}
                style={{ font: 'inherit', fontSize: 11, padding: '2px 7px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? tk.ink.base : tk.border.default}`, background: on ? tk.ink.base : 'transparent', color: on ? tk.ink.text : tk.text.primary }}>
                {c.label}
              </button>
            );
          })}
        </div>
      )}
      {mode === 'click' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button size="sm" variant={picking ? 'primary' : 'secondary'} onClick={() => {
            if (picking) { cancelPreviewPick(); return; }
            armPreviewPick(node.id, ([x, y]) => update(node.id, { pointX: +x.toFixed(4), pointY: +y.toFixed(4) }));
          }}>{picking ? 'Click the preview… (Esc)' : 'Pick on preview'}</Button>
          <span style={line}>at {Number(node.params.pointX ?? 0.5).toFixed(2)}, {Number(node.params.pointY ?? 0.5).toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
