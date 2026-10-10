/**
 * The Depth card's own lines (docs/depth-node.md): the model's download offer (its size and licence) or its
 * state and time per frame, Bake depth with progress, and what web pages get. A folded "Experimental models"
 * section turns on the experimental depth models (depthModel/experimental.ts): then a model picker and Compare
 * (every model on the same frame) show. The settings below are the card's usual controls.
 */
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { depthEngine, type DepthStatus } from '../../lib/depth/engine';
import { depthBakeOf, depthUpdateOf } from '../../nodes/definitions/depth';
import { formatDepthBytes, isMetricModel, licenceLine } from '../../depthModel/config';
import { depthModelOptions, effectiveDepthModel, setDepthExperimental, useDepthExperimental } from '../../depthModel/experimental';
import { depthOfferBytes, downloadDepthModel, probeLikelyBackend, useDepthModels } from '../../depthModel/client';
import { Button } from '../ui/Button';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { DepthCompare as DepthCompareT } from './DepthCompare';

// The compare view loads on demand, in its own chunk.
const DepthCompare = lazyWithSuspense<PropsOf<typeof DepthCompareT>>(() => import('./DepthCompare').then(m => ({ default: m.DepthCompare })));

// The folded "Experimental models" section stays as it was left (per node) when the card re-renders.
const openSections = new Map<string, boolean>();

function useStatus(nodeId: string): DepthStatus {
  const sub = useMemo(() => (fn: () => void) => depthEngine.onChange(fn), []);
  const snap = useRef<{ key: string; v: DepthStatus } | null>(null);
  return useSyncExternalStore(sub, () => {
    const v = depthEngine.status(nodeId);
    const key = `${v.state}:${v.runs}:${v.ms == null ? '' : Math.round(v.ms / 5)}:${v.w}x${v.h}:${v.message ?? ''}`;
    if (key !== snap.current?.key) snap.current = { key, v };
    return snap.current.v;
  });
}

export function DepthCardBody({ node }: { node: GraphNode; touch?: boolean }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const experimental = useDepthExperimental(s => s.on);
  const spec = effectiveDepthModel(node.params.model);
  const [openExp, setOpenExpState] = useState(() => openSections.get(node.id) ?? experimental);
  const setOpenExp = (f: (o: boolean) => boolean) => setOpenExpState(o => { const v = f(o); openSections.set(node.id, v); return v; });
  const entry = useDepthModels(s => s.models[spec.id]);
  const likely = useDepthModels(s => s.likely);
  const status = useStatus(node.id);
  const [comparing, setComparing] = useState(false);
  const [bake, setBake] = useState<{ done: number; total: number; abort: AbortController } | null>(null);
  const [msg, setMsg] = useState('');
  if (!likely) void probeLikelyBackend();

  const update = depthUpdateOf(node);
  const baked = depthBakeOf(node);
  const line = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  const warn = { ...line, color: tk.status.warning } as const;

  const startBake = async () => {
    const abort = new AbortController();
    setMsg('');
    setBake({ done: 0, total: 1, abort });
    try {
      const { bakeDepth } = await import('../../lib/depth/bake');
      const info = await bakeDepth(node.id, p => setBake(b => (b ? { ...b, done: p.done, total: p.total } : b)), abort.signal);
      setMsg(info.kind === 'video' ? `Baked ${info.frames} frames (${info.duration.toFixed(1)} s) into the video library.` : 'Baked into the image library.');
    } catch (e) {
      setMsg(e instanceof DOMException && e.name === 'AbortError' ? 'Bake cancelled.' : e instanceof Error ? e.message : String(e));
    } finally { setBake(null); }
  };

  const stateLine = (): string => {
    if (update === 'baked') {
      if (!baked) return 'Baked, but nothing is baked yet: press Bake depth.';
      if (status.state === 'missing' || status.state === 'error') return status.message ?? 'The baked depth can’t be read.';
      return baked.kind === 'video' ? `Plays the baked depth: ${baked.frames} frames, ${baked.duration.toFixed(1)} s, ${baked.width}×${baked.height}.` : `Shows the baked depth (${baked.width}×${baked.height}).`;
    }
    switch (status.state) {
      case 'running': return 'Working out the first depth…';
      case 'ready': {
        const range = isMetricModel(spec) ? depthEngine.metricRange(node.id) : null;
        return `${status.ms != null ? `${Math.round(status.ms)} ms a frame` : 'Ready'} · ${status.w}×${status.h}${entry?.backend ? ` · ${entry.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}` : ''}${range ? ` · ${range[0].toFixed(1)}–${range[1].toFixed(1)} m` : ''}`;
      }
      case 'no-source': return status.message ?? 'Waiting for a picture.';
      case 'needs-bake': return 'A video\'s depth is baked first, so it plays smoothly: press Bake depth.';
      case 'error': return status.message ?? 'The model failed.';
      default: return entry?.status === 'loading' ? 'Loading the model…' : 'Waiting for the first frame.';
    }
  };

  const needsDownload = update !== 'baked' && !entry?.downloaded;
  const loading = entry?.status === 'loading';
  const pct = entry?.progress && entry.progress.total ? Math.round((entry.progress.loaded / entry.progress.total) * 100) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 12px 8px' }} onMouseDown={e => e.stopPropagation()}>
      {needsDownload || (loading && pct !== null) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: radius.md, background: tk.bg.subtle }}>
          <span style={{ ...line, color: tk.text.primary }}>{spec.name} runs on this device and is downloaded once ({formatDepthBytes(depthOfferBytes(spec.id))}). Nothing is sent anywhere.</span>
          <span style={spec.commercial ? line : warn}>{licenceLine(spec)}</span>
          {loading && pct !== null ? (
            <div style={{ height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }} aria-label={`Downloading ${pct}%`}>
              <div style={{ width: `${pct}%`, height: '100%', background: tk.accent.base }} />
            </div>
          ) : (
            <Button size="sm" variant="primary" onClick={() => { void downloadDepthModel(spec.id); }}>Download {spec.short} ({formatDepthBytes(depthOfferBytes(spec.id))})</Button>
          )}
          {entry?.status === 'error' && <span style={warn}>{entry.error}</span>}
        </div>
      ) : (
        <>
          <span style={line} data-testid="depth-status">{stateLine()}</span>
          {!spec.commercial && <span style={warn}>{spec.name}: {licenceLine(spec).replace(/^Licence: /, '')}</span>}
        </>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {experimental && <Button size="sm" onClick={() => setComparing(true)} title="The models side by side on the current frame, with their time per frame">Compare models</Button>}
        {bake ? (
          <Button size="sm" onClick={() => bake.abort.abort()}>Cancel bake ({bake.done}/{bake.total})</Button>
        ) : (
          <Button size="sm" onClick={() => { void startBake(); }} disabled={!entry?.downloaded} title="Run the model once over the whole video (or image) and keep the depth beside it: smooth and exact for recordings and web pages">Bake depth</Button>
        )}
        {baked && update !== 'baked' && <Button size="sm" variant="ghost" onClick={() => updateNodeParams(node.id, { update: 'baked' })}>Use the bake</Button>}
        {update === 'baked' && <Button size="sm" variant="ghost" onClick={() => updateNodeParams(node.id, { update: 'live' })}>Live again</Button>}
      </div>
      {msg && <span style={line}>{msg}</span>}
      {isMetricModel(spec) && update !== 'baked' && <span style={line}>{spec.short} gives real distances: wire Distance into Depth Composite's or Depth Light's Picture distance, and Nearest / Farthest are skipped.</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button type="button" onClick={() => setOpenExp(o => !o)} aria-expanded={openExp}
          style={{ all: 'unset', cursor: 'pointer', fontSize: 11.5, color: tk.text.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ display: 'inline-block', transform: openExp ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>▸</span>
          Experimental models{experimental ? `: on (${spec.short})` : ''}
        </button>
        {openExp && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: radius.md, background: tk.bg.subtle }}>
            <label style={{ ...line, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={experimental} data-testid="depth-experimental"
                onChange={e => { setDepthExperimental(e.target.checked); useNodeGraphStore.getState().compile(); }} style={{ margin: 0, accentColor: tk.accent.base }} />
              Experimental depth models (every Depth node, this browser)
            </label>
            {experimental ? (
              <>
                <select value={spec.id} data-testid="depth-model-picker" aria-label="Depth model" onChange={e => updateNodeParams(node.id, { model: e.target.value })}
                  style={{ font: 'inherit', fontSize: 12, padding: '4px 6px', borderRadius: radius.control, background: tk.bg.field, color: tk.text.primary, border: `1px solid ${tk.border.default}` }}>
                  {depthModelOptions(true).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span style={line}>{spec.note}</span>
                <span style={spec.commercial ? line : warn}>{licenceLine(spec)}</span>
              </>
            ) : (
              <span style={line}>Off: every Depth node runs Depth Anything V2 Small. On: pick Base, MiDaS, Depth Anything V3, or the metric Depth Pro and ZoeDepth, and compare them.</span>
            )}
          </div>
        )}
      </div>
      <span style={{ ...line, fontSize: 11 }}>{update === 'baked' && baked ? 'Web pages play this baked depth.' : 'Web pages: only a baked depth goes in a page (live depth on pages comes later).'}</span>
      {comparing && <DepthCompare nodeId={node.id} onClose={() => setComparing(false)} />}
    </div>
  );
}
