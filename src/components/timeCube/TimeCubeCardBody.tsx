/**
 * The Time Cube card's own lines (docs/time-cube.md): which video, the
 * stack's size and memory, build progress with Cancel, and a strip of the
 * stacked frames. The settings below are the card's usual sliders.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { addVideoFile, isAudioType, listVideos, type LibraryVideoMeta } from '../../lib/backgroundLibrary';
import { timeCubes, timeCubePlan, timeCubeSource } from '../../lib/timeCube/volumes';
import { capText, formatBytes } from '../../lib/timeCube/plan';
import { DEMO_LABEL, probeVideo } from '../../lib/timeCube/frames';

function useStatus(nodeId: string) {
  const sub = useMemo(() => (fn: () => void) => timeCubes.onChange(fn), []);
  const snap = useRef<{ key: string; v: ReturnType<typeof timeCubes.status> }>({ key: '', v: null });
  return useSyncExternalStore(sub, () => {
    const v = timeCubes.status(nodeId);
    const key = v ? `${v.state}:${v.done}:${v.total}:${v.message ?? ''}` : '';
    if (key !== snap.current.key) snap.current = { key, v };
    return snap.current.v;
  });
}

export function TimeCubeCardBody({ node, touch = false }: { node: GraphNode; touch?: boolean }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const status = useStatus(node.id);
  const plan = timeCubePlan(node);
  const src = timeCubeSource(node);
  const [picking, setPicking] = useState(false);
  const [videos, setVideos] = useState<LibraryVideoMeta[] | null>(null);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!picking) return;
    let live = true;
    listVideos().then(l => { if (live) setVideos(l.filter(v => !isAudioType(v.type))); }).catch(() => { if (live) setVideos([]); });
    return () => { live = false; };
  }, [picking]);

  // A strip of the stack: the atlas, scaled to the card.
  const ready = status?.state === 'ready';
  useEffect(() => {
    const c = stripRef.current, atlas = timeCubes.canvas(node.id);
    if (!c || !atlas || !plan) return;
    const g = c.getContext('2d');
    if (!g) return;
    // Eight frames across the stack, side by side.
    const n = Math.min(8, plan.frames), w = c.width / n;
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < n; i++) {
      const f = Math.round((i * (plan.frames - 1)) / Math.max(1, n - 1));
      const row = Math.floor(f / plan.cols), col = f - row * plan.cols;
      g.drawImage(atlas, col * plan.tileW, row * plan.tileH, plan.tileW, plan.tileH, i * w, 0, w - 1, c.height);
    }
  }, [ready, node.id, plan?.frames, plan?.cols, plan?.tileW, plan?.tileH]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (v: { id: string; name: string; blob?: Blob; meta?: LibraryVideoMeta }) => {
    setBusy('Reading the video…');
    try {
      let meta = v.meta && v.meta.width && v.meta.height && v.meta.duration ? { width: v.meta.width, height: v.meta.height, duration: v.meta.duration } : null;
      if (!meta) {
        const blob = v.blob ?? (await (await import('../../lib/backgroundLibrary')).getVideo(v.id))?.blob;
        meta = blob ? await probeVideo(blob) : null;
      }
      if (!meta) { setBusy('That video could not be read here.'); return; }
      updateNodeParams(node.id, { source: 'library', videoId: v.id, fileName: v.name, _meta: meta, start: 0, end: 0 });
      setPicking(false); setBusy('');
    } catch (e) { setBusy(e instanceof Error ? e.message : String(e)); }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('Adding to the Library…');
    try {
      const meta = await addVideoFile(file);
      await choose({ id: meta.id, name: meta.name, blob: file, meta });
    } catch (e) { setBusy(e instanceof Error ? e.message : String(e)); }
  };

  const small = { fontSize: 11.5, lineHeight: 1.4, color: tk.text.muted } as const;
  const btn = {
    padding: touch ? '8px 10px' : '4px 9px', border: 0, borderRadius: radius.sm, cursor: 'pointer',
    background: tk.bg.field, color: tk.text.primary, font: `600 11.5px ${fontFamily.ui}`,
  } as const;
  const name = src?.kind === 'library' ? (typeof node.params.fileName === 'string' && node.params.fileName) || 'A Library video' : DEMO_LABEL;
  const building = status?.state === 'building' || status?.state === 'waiting';

  return (
    <div style={{ padding: '4px 12px 8px 16px', display: 'flex', flexDirection: 'column', gap: 6 }} onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base, font: `700 13px ${fontFamily.ui}` }}>▦</span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</b>
          <span style={small}>
            {plan ? `${plan.frames} frames · ${plan.tileW}×${plan.tileH} · ${formatBytes(plan.bytes)}` : 'Reading the video\'s size…'}
            {plan && plan.every > 0 ? ` · one every ${plan.every < 1 ? `${Math.round(plan.every * 1000)} ms` : `${plan.every.toFixed(2)} s`}` : ''}
          </span>
        </span>
        <button type="button" style={btn} onClick={() => setPicking(v => !v)} title="Use a video from the Library or a file">{picking ? 'Close' : 'Choose video'}</button>
      </div>

      {plan?.capped && <span style={{ ...small, color: tk.status.warningText }}>{capText(plan)}</span>}

      {picking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 6, borderRadius: radius.md, background: tk.bg.subtle, maxHeight: 220, overflowY: 'auto' }}>
          <button type="button" style={{ ...btn, textAlign: 'left' }} onClick={() => { updateNodeParams(node.id, { source: 'demo', videoId: '', fileName: '', _meta: undefined }); setPicking(false); }}>{DEMO_LABEL}</button>
          <button type="button" style={{ ...btn, textAlign: 'left' }} onClick={() => fileRef.current?.click()}>From a file…</button>
          <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          {videos === null && <span style={small}>Loading the Library…</span>}
          {videos?.length === 0 && <span style={small}>No videos in the Library yet.</span>}
          {videos?.map(v => (
            <button key={v.id} type="button" onClick={() => void choose({ id: v.id, name: v.name, meta: v })}
              style={{ ...btn, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', fontWeight: 500, background: v.id === node.params.videoId ? tk.bg.selected : tk.bg.field }}>
              {v.thumb ? <img src={v.thumb} alt="" style={{ width: 40, height: 24, objectFit: 'cover', borderRadius: 3 }} /> : <span style={{ width: 40, height: 24, background: '#000', borderRadius: 3 }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{v.name}</span>
              {v.duration ? <span style={{ color: tk.text.faint }}>{v.duration.toFixed(1)} s</span> : null}
            </button>
          ))}
        </div>
      )}
      {busy && <span style={small}>{busy}</span>}

      {building && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}>
            <div style={{ width: `${status && status.total ? (100 * status.done) / status.total : 0}%`, height: '100%', background: tk.accent.base, transition: 'width 80ms linear' }} />
          </div>
          <span style={small}>{status?.state === 'waiting' ? 'Waiting…' : `${status?.done ?? 0} / ${status?.total ?? 0}`}</span>
          <button type="button" style={btn} onClick={() => timeCubes.cancel(node.id)}>Cancel</button>
        </div>
      )}
      {(status?.state === 'cancelled' || status?.state === 'error' || status?.state === 'missing') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...small, flex: 1, color: status.state === 'cancelled' ? tk.text.muted : tk.status.danger }}>
            {status.state === 'cancelled' ? `Stopped at ${status.done} of ${status.total} frames.` : status.message ?? 'Could not build the stack.'}
          </span>
          <button type="button" style={btn} onClick={() => timeCubes.rebuild(node.id)}>Build</button>
        </div>
      )}
      {ready && <canvas ref={stripRef} width={320} height={plan ? Math.round(320 / Math.min(8, plan.frames) / plan.aspect) : 22} style={{ width: '100%', borderRadius: 4, imageRendering: 'auto' }} title="Eight of the stacked frames, first to last" />}
    </div>
  );
}
