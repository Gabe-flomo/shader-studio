/**
 * The Emit card's scan, when its Shape is Splat scan (docs/splat-scene.md "Agents as splats"): which scan the walkers
 * are born from (a drop, the file picker, the library or a generated ball), and how it read. The scan is kept like a
 * Splat Scene's (videoId, so .playfile bundles carry it).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { SPLAT_ACCEPT, addSplatFile, isSplatFileName, listSplats } from '../../lib/splats/library';
import { agentScanStatusOf, onAgentScan } from '../../lib/agentScans';
import { emitScanSource } from '../../nodes/definitions/agents';
import type { LibraryVideoMeta } from '../../lib/backgroundLibrary';
import { Button } from '../ui/Button';

export function EmitScanCardBody({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const source = emitScanSource(node.params);
  const status = useSyncExternalStore(onAgentScan, () => agentScanStatusOf(source));
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [library, setLibrary] = useState<LibraryVideoMeta[] | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (picking) listSplats().then(setLibrary, () => setLibrary([])); }, [picking]);
  const line = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  const take = async (f: File) => {
    if (!isSplatFileName(f.name)) { setMsg(`“${f.name}” isn’t a splat scan (.ply, .splat or .spz).`); return; }
    try {
      const m = await addSplatFile(f);
      update(node.id, { videoId: m.id, fileName: m.name, bytes: m.bytes });
      setMsg('');
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const name = node.params.videoId && typeof node.params.fileName === 'string' ? node.params.fileName
    : node.params.demo ? `Generated ${node.params.demo === 'rings' ? 'rings' : 'ball'}` : 'No scan yet';
  const said = !status ? '' : status.state === 'ready' ? `${status.count.toLocaleString()} walkers from ${status.total.toLocaleString()} splats` : status.message ?? status.state;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 12px 8px' }} onMouseDown={e => e.stopPropagation()} data-emit-scan
      onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) void take(f); }} onDragOver={e => e.preventDefault()}>
      <span style={line}><span style={{ color: tk.text.primary }}>{name}</span>{said ? ` · ${said}` : ''}</span>
      <input ref={fileRef} type="file" accept={SPLAT_ACCEPT} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void take(f); }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" onClick={() => fileRef.current?.click()}>Load…</Button>
        <Button size="sm" variant="ghost" onClick={() => setPicking(p => !p)}>From the library</Button>
        <Button size="sm" variant="ghost" onClick={() => update(node.id, { videoId: '', fileName: '', bytes: 0, demo: 'blob', demoCount: Number(node.params.demoCount) || 250000 })}>Generated ball</Button>
      </div>
      {picking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: radius.md, background: tk.bg.subtle, maxHeight: 160, overflowY: 'auto' }}>
          {library === null ? <span style={line}>Looking…</span> : library.length === 0 ? <span style={line}>No scans in the library yet.</span>
            : library.map(v => (
              <button key={v.id} type="button" onClick={() => { update(node.id, { videoId: v.id, fileName: v.name, bytes: v.bytes }); setPicking(false); }}
                style={{ all: 'unset', cursor: 'pointer', fontSize: 11.5, color: v.id === node.params.videoId ? tk.accent.base : tk.text.primary }}>{v.name}</button>
            ))}
        </div>
      )}
      {msg && <span style={{ ...line, color: tk.status.warning }}>{msg}</span>}
      <span style={line}>Each splat is born as a walker at its place and in its colour, up to the group’s count; its home (x, y, z) and size (w) go in its More memory.</span>
    </div>
  );
}
