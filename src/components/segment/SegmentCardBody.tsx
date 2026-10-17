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
import { SEGMENT_CLASSES, SEGMENT_CLASS_GROUPS, segmentBakeOf, segmentClassesOf, segmentModeOf } from '../../nodes/definitions/segment';
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
  const [adding, setAdding] = useState(false);
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
        // The kinds it finds as chips (× takes one off), and + Add opening the rest, grouped: not all twenty at once
        <div data-segment-kinds style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            {[...chosen].map(k => {
              const c = SEGMENT_CLASSES.find(x => x.key === k)!;
              return (
                <span key={k} data-segment-kind={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, padding: '1px 3px 1px 8px', borderRadius: 999, background: tk.ink.base, color: tk.ink.text }}>
                  {c.label}
                  <button type="button" aria-label={`Stop finding ${c.label}`} onClick={() => toggle(k)}
                    style={{ width: 16, height: 16, padding: 0, border: 0, borderRadius: 999, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, lineHeight: '16px' }}>×</button>
                </span>
              );
            })}
            {!chosen.size && <span style={line}>Nothing chosen: add a kind.</span>}
            <button type="button" data-segment-add aria-expanded={adding} onClick={() => setAdding(a => !a)}
              style={{ font: 'inherit', fontSize: 11, padding: '1px 8px', borderRadius: 999, cursor: 'pointer', border: `1px dashed ${tk.border.default}`, background: 'transparent', color: tk.text.secondary }}>
              {adding ? 'Done' : '+ Add'}
            </button>
          </div>
          {adding && (
            <div data-segment-add-list style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', borderRadius: 6, border: `1px solid ${tk.border.subtle}` }}>
              {SEGMENT_CLASS_GROUPS.map(g => (
                <div key={g.label} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 10.5, color: tk.text.faint, width: '100%' }}>{g.label}</span>
                  {g.keys.map(k => {
                    const c = SEGMENT_CLASSES.find(x => x.key === k)!;
                    const on = chosen.has(k);
                    return (
                      <button key={k} type="button" aria-pressed={on} onClick={() => toggle(k)}
                        style={{ font: 'inherit', fontSize: 11.5, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: on ? tk.ink.base : tk.text.primary, fontWeight: on ? 650 : 400 }}>
                        {on ? '✓ ' : ''}{c.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
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
