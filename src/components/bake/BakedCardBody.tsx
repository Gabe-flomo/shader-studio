/**
 * The middle of a Baked node's card (docs/bake.md): the video's poster, what
 * it is (length, frame rate, size, file size, loop), what stopped moving when
 * it was frozen, the live nodes kept with it (folded), and Unbake / Re-bake.
 * The header and sockets are NodeComponent's, as for the other special cards.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { bakedInfo } from '../../nodes/definitions/baked';
import { bakedVideos } from '../../lib/bakedVideos';
import { stashOf } from '../../lib/bake/graphOps';
import { addBakeAsVideoLayer, nodeLabel, unbakeNode } from '../../lib/bake/runner';
import { useLibraryVideos } from '../backgrounds/useBackgrounds';
import { useBakeDialog } from './bakeDialogStore';
import { toast } from '../ui/toastStore';

interface Colors { mauve: string; subtext0: string; surface0: string; surface1: string; surface2: string; mantle: string; text: string; yellow: string; red: string; green: string }

const mb = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export function BakedCardBody({ node, tc }: { node: GraphNode; tc: Colors }) {
  const info = bakedInfo(node);
  const stash = stashOf(node);
  const status = useSyncExternalStore(fn => bakedVideos.onChange(fn), () => bakedVideos.status(node.id));
  const { videos } = useLibraryVideos();
  const meta = videos?.find(v => v.id === node.params.videoId);
  const [open, setOpen] = useState(false);
  // Folded by default; remembered per card for the session.
  useEffect(() => { const k = `bake-open:${node.id}`; try { setOpen(sessionStorage.getItem(k) === '1'); } catch { /* none */ } }, [node.id]);
  const toggle = () => { const next = !open; setOpen(next); try { sessionStorage.setItem(`bake-open:${node.id}`, next ? '1' : '0'); } catch { /* none */ } };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const btn: React.CSSProperties = { flex: 1, background: tc.surface0, border: `1px solid ${tc.surface1}`, borderRadius: 4, color: tc.text, cursor: 'pointer', fontSize: 10.5, padding: '4px 6px' };
  const line = (text: string, color = tc.subtext0) => <div style={{ fontSize: 10, color, lineHeight: 1.45 }}>{text}</div>;
  if (!info) return <div style={{ padding: '6px 10px', fontSize: 10, color: tc.red }}>This Baked node lost its settings.</div>;
  const loop = info.loop === 'seamless' ? 'loops' : 'holds its last frame';
  return (
    <div onMouseDown={stop} style={{ padding: '4px 10px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ borderRadius: 4, overflow: 'hidden', background: tc.mantle, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {meta?.thumb ? <img src={meta.thumb} alt="" style={{ width: '100%', maxHeight: 110, objectFit: 'cover', display: 'block' }} /> : <span style={{ fontSize: 10, color: tc.surface2, padding: 10 }}>{status === 'missing' ? 'Video missing' : 'Baked video'}</span>}
        {status === 'loading' && <span style={{ position: 'absolute', right: 6, bottom: 4, fontSize: 9, color: tc.text, background: 'rgba(0,0,0,0.5)', padding: '1px 4px', borderRadius: 3 }}>loading…</span>}
      </div>
      {line(`${+info.duration.toFixed(2)} s from ${+info.start.toFixed(2)} s · ${info.fps} fps · ${info.width}×${info.height} · ${loop}${info.alpha ? ' · alpha' : ''}`)}
      {line(`${mb(meta?.bytes ?? info.bytes)} · ${info.codec === 'h264' ? 'H.264' : info.codec.toUpperCase()} · in the Library’s Videos`)}
      {info.frozen.length > 0
        ? line(`Frozen: ${info.frozen.join(', ')} no longer ${info.frozen.length === 1 ? 'moves' : 'move'} it.`, tc.yellow)
        : line('Nothing live was frozen: it plays exactly as the nodes did.')}
      {status === 'missing' && line('This browser’s Library doesn’t have the video. Re-bake renders it again.', tc.red)}
      {status === 'error' && line('The video couldn’t be played here. Re-bake renders it again.', tc.red)}
      {stash && (
        <div>
          <button onClick={toggle} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: tc.mauve, fontSize: 10 }}>
            {open ? '▾' : '▸'} Baked: {stash.nodes.length} live {stash.nodes.length === 1 ? 'node' : 'nodes'} kept, muted
          </button>
          {open && <div style={{ fontSize: 10, color: tc.subtext0, padding: '2px 0 0 10px', lineHeight: 1.45 }}>{stash.nodes.map(n => nodeLabel(n)).join(', ')}</div>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <button style={btn} disabled={!stash} title="Put the live nodes and their wires back (Undo works too)" onClick={() => unbakeNode(node.id)}>Unbake</button>
        <button style={btn} disabled={!stash} title="Render the live nodes again with the same settings" onClick={() => useBakeDialog.getState().open({ kind: 'rebake', nodeId: node.id })}>Re-bake</button>
        <button style={btn} title="Add the video to Play as a Video layer as well" onClick={() => { if (addBakeAsVideoLayer(node.id)) toast.success('Added as a Video layer', { message: 'It follows the clock on the Play page.' }); }}>Video layer</button>
      </div>
    </div>
  );
}
