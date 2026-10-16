/**
 * The Segment card's own lines (docs/segment-node.md): the model's state and time, how much it finds; for Objects
 * the kinds as chips; for Click a Pick button (the next click on the preview sets the point); Bake (run the model once
 * over a whole video or image and keep the masks, lib/segment/bake.ts) and Use the bake / Live again.
 */
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import type { GraphNode } from '../../types/nodeGraph';
import { segmentEngine, type SegmentStatus } from '../../lib/segment/engine';
import { SEGMENT_CLASSES, segmentBakeOf, segmentClassesOf, segmentModeOf } from '../../nodes/definitions/segment';
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
  const [bake, setBake] = useState<{ done: number; total: number; abort: AbortController } | null>(null);
  const [msg, setMsg] = useState('');
  const baked = segmentBakeOf(node);
  const playsBake = node.params.update === 'baked';
  const startBake = async () => {
    const abort = new AbortController();
    setMsg('');
    setBake({ done: 0, total: 1, abort });
    try {
      const { bakeSegment } = await import('../../lib/segment/bake');
      const info = await bakeSegment(node.id, p => setBake(b => (b ? { ...b, done: p.done, total: p.total } : b)), abort.signal);
      setMsg(info.kind === 'video' ? `Baked ${info.frames} frames (${info.duration.toFixed(1)} s) into the video library.` : 'Baked into the image library.');
    } catch (e) {
      setMsg(e instanceof DOMException && e.name === 'AbortError' ? 'Bake cancelled.' : e instanceof Error ? e.message : String(e));
    } finally { setBake(null); }
  };
  const text = playsBake
    ? (!baked ? 'Baked, but nothing is baked yet: press Bake.'
      : st.state === 'missing' || st.state === 'error' ? st.message ?? 'The baked masks can’t be read.'
      : baked.kind === 'video' ? `Plays the baked masks: ${baked.frames} frames, ${baked.duration.toFixed(1)} s, ${baked.width} × ${baked.height}.` : `Shows the baked mask (${baked.width} × ${baked.height}).`)
    : st.state === 'running'
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
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {bake ? (
          <Button size="sm" onClick={() => bake.abort.abort()}>Cancel bake ({bake.done}/{bake.total})</Button>
        ) : (
          <Button size="sm" onClick={() => { void startBake(); }} title="Run the model once over the whole video (or image) and keep the masks beside it: smooth and exact for recordings and web pages, and no model running while it plays">Bake</Button>
        )}
        {baked && !playsBake && <Button size="sm" variant="ghost" onClick={() => update(node.id, { update: 'baked' })}>Use the bake</Button>}
        {playsBake && <Button size="sm" variant="ghost" onClick={() => update(node.id, { update: 'live' })}>Live again</Button>}
      </div>
      {msg && <span style={line}>{msg}</span>}
    </div>
  );
}
