/**
 * Compare (docs/depth-node.md, with experimental depth models on): every depth model side by side on the frame the Depth node last sent to its
 * model, each with its time per frame (the median of three runs after a warm-up, at the node's resolution).
 * Only downloaded models run; the others offer their download here.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { depthEngine } from '../../lib/depth/engine';
import { depthSideOf } from '../../nodes/definitions/depth';
import { DEPTH_MODELS, formatDepthBytes, licenceLine, type DepthModelSpec } from '../../depthModel/config';
import { depthOfferBytes, downloadDepthModel, estimateDepth, useDepthModels } from '../../depthModel/client';

interface Result { ms: number; w: number; h: number; depth: Float32Array; backend: string | null; range?: [number, number] }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function DepthCanvas({ depth, w, h }: { depth: Float32Array; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext('2d');
    if (!c || !g) return;
    c.width = w; c.height = h;
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = Math.round(depth[i] * 255); img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, [depth, w, h]);
  return <canvas ref={ref} style={{ width: '100%', borderRadius: radius.sm, display: 'block', background: '#000' }} />;
}

function FrameCanvas({ frame }: { frame: { rgba: Uint8Array; w: number; h: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext('2d');
    if (!c || !g) return;
    c.width = frame.w; c.height = frame.h;
    g.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.w, frame.h), 0, 0);
  }, [frame]);
  return <canvas ref={ref} style={{ width: '100%', borderRadius: radius.sm, display: 'block', background: '#000' }} />;
}

export function DepthCompare({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const tk = useTokens();
  const node = useNodeGraphStore(s => s.nodes.find(n => n.id === nodeId));
  const models = useDepthModels(s => s.models);
  const [frame] = useState(() => depthEngine.lastFrame(nodeId));
  const [results, setResults] = useState<Record<string, Result | 'running' | 'failed'>>({});
  const side = node ? depthSideOf(node) : 384;
  const running = useRef(false);

  const runAll = async () => {
    if (!frame || running.current) return;
    running.current = true;
    for (const m of DEPTH_MODELS) {
      if (!useDepthModels.getState().models[m.id]?.downloaded) continue;
      setResults(r => ({ ...r, [m.id]: 'running' }));
      const one = () => estimateDepth(m.id, { rgba: frame.rgba.slice(), w: frame.w, h: frame.h, flipY: false }, side);
      const warm = await one();
      if (!warm) { setResults(r => ({ ...r, [m.id]: 'failed' })); continue; }
      const times: number[] = [];
      let last = warm;
      for (let i = 0; i < 3; i++) { const r = await one(); if (r) { times.push(r.ms); last = r; } }
      setResults(r => ({ ...r, [m.id]: { ms: times.length ? median(times) : warm.ms, w: last.w, h: last.h, depth: last.depth, backend: useDepthModels.getState().models[m.id]?.backend ?? null, range: last.range } }));
    }
    running.current = false;
  };

  // Runs once on open, and again when a model finishes downloading here.
  const downloadedKey = DEPTH_MODELS.map(m => (models[m.id]?.downloaded && models[m.id]?.status !== 'loading' ? '1' : '0')).join('');
  useEffect(() => { void runAll(); }, [downloadedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = (m: DepthModelSpec) => {
    const e = models[m.id];
    const r = results[m.id];
    const pct = e?.progress && e.progress.total ? Math.round((e.progress.loaded / e.progress.total) * 100) : null;
    return (
      <div key={m.id} data-testid={`depth-compare-${m.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: radius.md, background: tk.bg.subtle, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: tk.text.primary }}>{m.name}</div>
        {!e?.downloaded ? (
          <>
            <span style={{ fontSize: 11.5, color: tk.text.muted }}>{m.note}</span>
            {e?.status === 'loading' && pct !== null
              ? <span style={{ fontSize: 11.5, color: tk.text.muted }}>Downloading… {pct}%</span>
              : <Button size="sm" onClick={() => { void downloadDepthModel(m.id); }}>Download ({formatDepthBytes(depthOfferBytes(m.id))})</Button>}
          </>
        ) : r === 'running' || r === undefined ? (
          <span style={{ fontSize: 11.5, color: tk.text.muted }}>{e.status === 'loading' ? 'Loading…' : 'Running…'}</span>
        ) : r === 'failed' ? (
          <span style={{ fontSize: 11.5, color: tk.status.danger }}>It failed{e.error ? `: ${e.error}` : ''}.</span>
        ) : (
          <>
            <DepthCanvas depth={r.depth} w={r.w} h={r.h} />
            <span style={{ fontSize: 12, color: tk.text.primary, fontVariantNumeric: 'tabular-nums' }}>{Math.round(r.ms)} ms a frame</span>
            <span style={{ fontSize: 11, color: tk.text.muted }}>{r.w}×{r.h}{r.backend ? ` · ${r.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}` : ''}</span>
            {r.range && <span style={{ fontSize: 11, color: tk.text.muted }}>Metric: {r.range[0].toFixed(2)}–{r.range[1].toFixed(2)} m</span>}
          </>
        )}
        <span style={{ fontSize: 11, color: m.commercial ? tk.text.muted : tk.status.warning }}>{licenceLine(m)}</span>
      </div>
    );
  };

  return (
    <Modal title="Compare depth models" subtitle={`The same frame at ${side} px, on this device`} icon="layers" onClose={onClose} width={920}>
      {!frame ? (
        <div style={{ fontSize: 12.5, color: tk.text.muted, lineHeight: 1.5 }}>
          Compare needs a frame the node has already sent to a model. Download a model on the card (or below), let it run once, then open Compare again.
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>{DEPTH_MODELS.map(card)}</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: radius.md, background: tk.bg.subtle, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: tk.text.primary }}>The frame</div>
            <FrameCanvas frame={frame} />
            <span style={{ fontSize: 11, color: tk.text.muted }}>{frame.w}×{frame.h} sent to each model</span>
          </div>
          {DEPTH_MODELS.map(card)}
        </div>
      )}
    </Modal>
  );
}
