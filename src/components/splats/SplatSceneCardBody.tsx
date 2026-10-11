/**
 * The Splat Scene card's own lines (docs/splat-scene.md): the scan's picture and facts (splats, size, format, SH,
 * bounds), Load / Replace (a drop on the picture, the file picker, or a scan already in the library or the
 * workspace), "Add to scene" (wired into the graph's March Loop), "Fit to the scene", and what web pages get.
 * The settings below (Place, Look, Quality, Compositing) are the card's usual controls.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { splatEngine, type SplatStatus } from '../../lib/splats/engine';
import { SPLAT_ACCEPT, addSplatFile, isSplatFileName, listSplats } from '../../lib/splats/library';
import { fitParams } from '../../lib/splats/fit';
import { splatFileOf } from '../../nodes/definitions/splatScene';
import { hasMarchLoop, wireSplatIntoScene } from '../../nodes/recipes';
import { subscribe as onLibraryChange, type LibraryVideoMeta } from '../../lib/backgroundLibrary';
import { Button } from '../ui/Button';

function useStatus(nodeId: string): SplatStatus {
  const sub = useMemo(() => (fn: () => void) => splatEngine.onChange(fn), []);
  const snap = useRef<{ key: string; v: SplatStatus } | null>(null);
  return useSyncExternalStore(sub, () => {
    const v = splatEngine.status(nodeId);
    const key = `${v.state}:${v.drawn}:${v.shDegree}:${v.sorts}:${v.message ?? ''}:${v.thumb ? 1 : 0}:${v.fileName ?? ''}`;
    if (key !== snap.current?.key) snap.current = { key, v };
    return snap.current.v;
  });
}

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmt = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(2));

export function SplatSceneCardBody({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const status = useStatus(node.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<LibraryVideoMeta[] | null>(null);
  const [picking, setPicking] = useState(false);
  const loopThere = useNodeGraphStore(s => hasMarchLoop(s.nodes));
  const line = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  const warn = { ...line, color: tk.status.warning } as const;
  const has = !!splatFileOf(node) || node.params.demo === 'rings';

  useEffect(() => {
    if (!picking) return;
    let live = true;
    const load = () => { listSplats().then(l => { if (live) setLibrary(l); }).catch(() => { if (live) setLibrary([]); }); };
    load();
    const off = onLibraryChange(load);
    return () => { live = false; off(); };
  }, [picking]);

  const take = async (file: File) => {
    setMsg('');
    if (!isSplatFileName(file.name)) { setMsg(`“${file.name}” isn’t a splat scan (.ply, .splat or .spz).`); return; }
    setBusy(true);
    try {
      const meta = await addSplatFile(file);
      updateNodeParams(node.id, { videoId: meta.id, fileName: meta.name, bytes: meta.bytes });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const f = e.dataTransfer.files[0];
    if (f) void take(f);
  };

  const info = status.info;
  const facts = (): string => {
    switch (status.state) {
      case 'loading': return status.message ?? 'Reading the scan…';
      case 'missing': case 'error': case 'nested': return status.message ?? 'The scan can’t be read.';
      case 'ready': {
        if (!info) return 'Ready';
        const parts = [
          `${info.count.toLocaleString()} splats${status.drawn < info.count ? ` (drawing ${status.drawn.toLocaleString()})` : ''}`,
          status.bytes ? mb(status.bytes) : '',
          `.${info.format}`,
          `SH ${status.shDegree}${info.shDegree > status.shDegree ? ` of ${info.shDegree}` : ''}`,
        ].filter(Boolean);
        return parts.join(' · ');
      }
      default: return 'No scan yet: drop a .ply, .splat or .spz here, or Load….';
    }
  };
  const size = info ? info.coreMax.map((v, i) => v - info.coreMin[i]) : null;

  const addToScene = () => {
    const ok = useNodeGraphStore.getState().rewriteTopLevel((nodes, nextId) => wireSplatIntoScene(nodes, node.id, nextId), 'Added the scan to the scene');
    setMsg(ok ? 'Wired to the March Loop: its camera, and the scene by distance. It is on the Output.' : 'There is no March Loop to put it in.');
  };

  const fit = () => {
    if (!info) return;
    updateNodeParams(node.id, fitParams(node, info.center, info.radius));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 12px 8px' }} onMouseDown={e => e.stopPropagation()}>
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onClick={() => fileRef.current?.click()}
        title="Click: pick a scan · drop a .ply, .splat or .spz"
        data-splat-drop
        style={{ border: `1px dashed ${tk.border.default}`, borderRadius: radius.md, background: tk.bg.field, minHeight: 64, aspectRatio: status.thumb ? '16 / 9' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }}
      >
        {status.thumb
          ? <img src={status.thumb} alt="The scan, seen from the front" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <span style={{ ...line, padding: 8, textAlign: 'center' }}>{busy || status.state === 'loading' ? 'Reading the scan…' : 'Drop a splat scan here (.ply, .splat, .spz), or click to pick one'}</span>}
      </div>
      <input ref={fileRef} type="file" accept={SPLAT_ACCEPT} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void take(f); }} />
      <span style={status.state === 'error' || status.state === 'missing' || status.state === 'nested' ? warn : line} data-testid="splat-status">
        {status.fileName && status.state !== 'empty' ? <><span style={{ color: tk.text.primary }}>{status.fileName}</span>{' · '}</> : null}{facts()}
      </span>
      {size && info && status.state === 'ready' && (
        <span style={line}>About {fmt(size[0])} × {fmt(size[1])} × {fmt(size[2])} units, centred at ({fmt(info.center[0])}, {fmt(info.center[1])}, {fmt(info.center[2])}){status.sortMs != null ? ` · sorted in ${Math.round(status.sortMs)} ms` : ''}</span>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>{has ? 'Replace…' : 'Load…'}</Button>
        <Button size="sm" variant="ghost" onClick={() => setPicking(p => !p)} title="A scan already in the library (or the workspace folder)">From the library</Button>
        {loopThere && <Button size="sm" onClick={addToScene} title="Wire it to the March Loop: the same camera, and the scene put together by distance, on the Output">Add to scene</Button>}
        {info && <Button size="sm" variant="ghost" onClick={fit} title="Set Position and Scale so the scan sits at the scene's centre, about 3 units across">Fit to the scene</Button>}
      </div>
      {picking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: radius.md, background: tk.bg.subtle, maxHeight: 180, overflowY: 'auto' }}>
          {library === null ? <span style={line}>Looking…</span>
            : library.length === 0 ? <span style={line}>No scans in the library yet.</span>
            : library.map(v => (
              <button key={v.id} type="button" onClick={() => { updateNodeParams(node.id, { videoId: v.id, fileName: v.name, bytes: v.bytes }); setPicking(false); }}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: v.id === splatFileOf(node) ? tk.accent.base : tk.text.primary }}>
                {v.thumb ? <img src={v.thumb} alt="" style={{ width: 48, height: 27, objectFit: 'cover', borderRadius: 3 }} /> : <span style={{ width: 48, height: 27, borderRadius: 3, background: tk.bg.field, display: 'inline-block' }} />}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                <span style={{ color: tk.text.muted }}>{mb(v.bytes)}</span>
              </button>
            ))}
        </div>
      )}
      {msg && <span style={line}>{msg}</span>}
      {!node.inputs.ro?.connection && <span style={line}>Wire a March Camera’s Ray Origin and Ray Dir to see it through the scene’s camera (unwired: a camera 3 back, looking at the middle).</span>}
      <span style={line}>Web pages: not yet. The scan reads empty on an exported page.</span>
    </div>
  );
}
