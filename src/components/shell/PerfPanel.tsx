import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { getPerfSnapshot, subscribePerf, getShaderCostMeasurer, type PerfSnapshot } from '../../lib/perfStats';
import { shaderShape } from '../../lib/shaderShape';
import { measureNodeCosts, type NodeCostReport } from '../../lib/nodeCost';
import { SKIP_UNIFORM_TYPES } from '../../compiler/uniformPatcher';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';

/** 60 fps frame budget in ms */
const BUDGET_MS = 1000 / 60;

const fmt = (ms: number | null, digits = 1) => (ms === null ? '—' : ms.toFixed(digits));

function usePerfSnapshot(): PerfSnapshot {
  const [snap, setSnap] = useState(getPerfSnapshot);
  useEffect(() => subscribePerf(() => setSnap(getPerfSnapshot())), []);
  return snap;
}

/** Live "4.2 ms" for the toolbar button; GPU time when available, CPU frame time otherwise. */
export function PerfBadge() {
  const snap = usePerfSnapshot();
  const ms = snap.gpuTimer === 'supported' ? snap.gpu.avg : snap.cpu.avg;
  return <span style={{ font: `600 11px ${fontFamily.mono}`, minWidth: 46, textAlign: 'right' }}>{ms === null ? 'perf' : `${fmt(ms)} ms`}</span>;
}

/** Frame-time history with the 60 fps budget line, drawn at device resolution. */
function Sparkline({ values, budget, color, warn }: { values: readonly number[]; budget: number; color: string; warn: string }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth, h = el.clientHeight;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); }
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(budget * 1.25, ...values) * 1.05;
    const y = (v: number) => h - 1 - (v / max) * (h - 2);
    // budget line
    ctx.strokeStyle = tk.border.default; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y(budget)); ctx.lineTo(w, y(budget)); ctx.stroke(); ctx.setLineDash([]);
    if (values.length < 2) return;
    const n = values.length, step = w / Math.max(1, 119);
    const x0 = w - (n - 1) * step;
    // fill
    ctx.beginPath(); ctx.moveTo(x0, h);
    values.forEach((v, i) => ctx.lineTo(x0 + i * step, y(v)));
    ctx.lineTo(x0 + (n - 1) * step, h); ctx.closePath();
    ctx.fillStyle = color; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
    // line, red where it breaks the budget
    ctx.lineWidth = 1.5;
    for (let i = 1; i < n; i++) {
      ctx.strokeStyle = values[i] > budget ? warn : color;
      ctx.beginPath(); ctx.moveTo(x0 + (i - 1) * step, y(values[i - 1])); ctx.lineTo(x0 + i * step, y(values[i])); ctx.stroke();
    }
  }, [values, budget, color, warn, tk]);
  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: 56 }} />;
}

function Bar({ label, value, max, unit, color, sub }: { label: string; value: number; max: number; unit: string; color: string; sub?: string }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '112px 1fr 64px', alignItems: 'center', gap: 10, fontSize: 12 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}{sub && <span style={{ color: tk.text.faint }}> · {sub}</span>}</span>
      <span style={{ height: 8, borderRadius: 4, background: tk.bg.field, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.min(100, (value / Math.max(max, 1e-6)) * 100)}%`, borderRadius: 4, background: color }} />
      </span>
      <span style={{ textAlign: 'right', font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>{value.toFixed(value >= 10 ? 1 : 2)} {unit}</span>
    </div>
  );
}

function recompileTriggers(nodes: GraphNode[]): string[] {
  const out = new Map<string, number>();
  const visit = (list: GraphNode[]) => {
    for (const n of list) {
      const def = getNodeDefinitionFor(n);
      const forces = SKIP_UNIFORM_TYPES.has(n.type) || Object.values(def?.paramDefs ?? {}).some(pd => pd.compileTime);
      if (forces && def) out.set(def.label, (out.get(def.label) ?? 0) + 1);
      const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes) visit(sg.nodes);
    }
  };
  visit(nodes);
  return [...out.entries()].map(([l, c]) => (c > 1 ? `${l} ×${c}` : l));
}

export function PerfPanel({ onClose }: { onClose: () => void }) {
  const tk = useTokens();
  const snap = usePerfSnapshot();
  const nodes = useNodeGraphStore(s => s.nodes);
  const activeGroupPath = useNodeGraphStore(s => s.activeGroupPath);
  const fragmentShader = useNodeGraphStore(s => s.fragmentShader);
  const selectNodes = useNodeGraphStore(s => s.selectNodes);
  const revealNode = useNodeGraphStore(s => s.revealNode);
  const shape = useMemo(() => shaderShape(fragmentShader ?? ''), [fragmentShader]);
  const triggers = useMemo(() => recompileTriggers(nodes), [nodes]);

  const gpuOk = snap.gpuTimer === 'supported';
  const frame = gpuOk ? snap.gpu : snap.cpu;
  const frameAvg = frame.avg;
  const over = frameAvg !== null && frameAvg > BUDGET_MS;
  const accent = over ? tk.status.warning : tk.accent.base;

  // ── Node costs ────────────────────────────────────────────────────────────
  const [report, setReport] = useState<NodeCostReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const measurer = getShaderCostMeasurer();
  const startMeasure = async () => {
    if (!measurer || progress) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setReport(null);
    setProgress({ done: 0, total: 1, label: 'Whole graph' });
    const r = await measureNodeCosts({
      nodes, scopePath: activeGroupPath, measure: measurer, signal: ctrl.signal,
      size: { width: snap.width, height: snap.height },
      onProgress: (done, total, label) => setProgress({ done, total, label }),
    });
    if (!ctrl.signal.aborted) { setReport(r); setProgress(null); }
  };
  const cancelMeasure = () => { abortRef.current?.abort(); setProgress(null); };
  const maxCost = report ? Math.max(1e-6, ...report.costs.map(c => c.ms)) : 1;

  const caps = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' as const };
  const section = { padding: '12px 16px', borderBottom: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column' as const, gap: 6 };
  const note = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 };
  const btn = { border: 0, borderRadius: radius.md, padding: '6px 10px', cursor: 'pointer', font: `600 12px ${fontFamily.ui}`, background: tk.accent.base, color: '#fff' };

  const kpis: [string, string, string][] = [
    [gpuOk ? 'GPU frame' : 'Frame', `${fmt(frameAvg)} ms`, over ? `over the ${BUDGET_MS.toFixed(1)} ms budget` : `of ${BUDGET_MS.toFixed(1)} ms budget`],
    ['Worst', `${fmt(frame.p95)} ms`, 'slowest 5% of frames'],
    ['FPS', `${snap.fps || '—'}`, 'display-capped'],
    ['Pixels', snap.width ? `${snap.width}×${snap.height}` : '—', `${((snap.width * snap.height) / 1e6).toFixed(2)} Mpx`],
  ];

  return (
    <div style={{ color: tk.text.secondary }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 10px 16px', borderBottom: `1px solid ${tk.border.subtle}` }}>
        <b style={{ fontSize: 14, fontWeight: 650, color: tk.text.primary, marginRight: 'auto' }}>Performance</b>
        <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.hover, borderRadius: 6, padding: '2px 6px' }}>
          {gpuOk ? 'GPU timer' : snap.gpuTimer === 'unsupported' ? 'CPU timing only' : 'waiting for a frame'}
        </span>
        <IconButton icon="close" label="Close" size="sm" tooltip={false} onClick={onClose} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: `1px solid ${tk.border.subtle}` }}>
        {kpis.map(([l, v, s], i) => (
          <div key={l} style={{ padding: '12px 12px', borderLeft: i ? `1px solid ${tk.border.subtle}` : 'none', minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: tk.text.muted }}>{l}</div>
            <div style={{ font: `650 18px ${fontFamily.ui}`, color: i === 0 && over ? tk.status.warning : tk.text.primary, whiteSpace: 'nowrap' }}>{v}</div>
            <div style={{ fontSize: 10.5, color: tk.text.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s}</div>
          </div>
        ))}
      </div>

      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={caps}>Last 120 frames</span><span style={{ ...caps, textTransform: 'none' }}>dashed = 60 fps</span></div>
        <Sparkline values={frame.history} budget={BUDGET_MS} color={accent} warn={tk.status.danger} />
        {!gpuOk && snap.gpuTimer === 'unsupported' && (
          <div style={note}>This browser has no GPU timer, so these are CPU frame times: the work of issuing the frame, not the GPU's. Chrome or Edge on desktop give real GPU numbers.</div>
        )}
      </div>

      {(snap.passes.length > 0 || snap.probeMs !== null) && (
        <div style={section}>
          <div style={caps}>Where the frame goes</div>
          {snap.passes.map(p => (
            <Bar key={p.name} label={p.name === 'main' ? 'Shader' : p.name === 'particles' ? 'Particles' : p.name} value={p.avg} max={Math.max(frameAvg ?? 0, ...snap.passes.map(q => q.avg))} unit="ms" color={tk.accent.base} sub="GPU" />
          ))}
          {snap.probeMs !== null && (
            <Bar label="Probes and readouts" value={snap.probeMs} max={Math.max(frameAvg ?? 0, snap.probeMs)} unit="ms" color={tk.text.faint} sub={`CPU · ${Math.round(snap.readbacks ?? 0)} readbacks`} />
          )}
          {(snap.readbacks ?? 0) >= 3 && <div style={note}>Each readback waits for the GPU. Close eye previews and scopes you are not watching.</div>}
        </div>
      )}

      <div style={section}>
        <div style={caps}>Compiles</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 12 }}>
          <div><div style={{ font: `600 13px ${fontFamily.mono}`, color: tk.text.primary }}>{fmt(snap.graphCompileMs)} ms</div><div style={note}>graph → GLSL</div></div>
          <div><div style={{ font: `600 13px ${fontFamily.mono}`, color: tk.text.primary }}>{fmt(snap.gpuCompileMs, 0)} ms</div><div style={note}>GPU compile + link</div></div>
          <div><div style={{ font: `600 13px ${fontFamily.mono}`, color: snap.compilesPerMinute > 10 ? tk.status.warning : tk.text.primary }}>{snap.compilesPerMinute}</div><div style={note}>in the last minute</div></div>
        </div>
        {triggers.length > 0 && (
          <div style={note}>Sliders on {triggers.join(', ')} rebuild the shader on every change instead of updating a uniform.</div>
        )}
      </div>

      <div style={section}>
        <div style={caps}>Shader shape</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 16px', fontSize: 12 }}>
          <Row k="Lines in main()" v={String(shape.mainLines)} />
          <Row k="Helper functions" v={String(Math.max(0, shape.functions))} />
          <Row k="Loops" v={shape.loops ? `${shape.loops}${shape.loopBounds.length ? ` · up to ${Math.max(...shape.loopBounds)}×` : ''}${shape.maxLoopDepth > 1 ? ` · nested ${shape.maxLoopDepth}` : ''}` : '0'} warn={shape.maxLoopDepth > 1} />
          <Row k="Texture reads" v={String(shape.textureSamples)} />
          <Row k="sin/cos/pow/exp…" v={String(shape.transcendentals)} />
          <Row k="Branches" v={String(shape.branches)} />
        </div>
        {shape.maxLoopDepth > 1 && <div style={note}>Nested loops multiply: a 64-step march inside a 4× loop is 256 evaluations per pixel.</div>}
      </div>

      <div style={{ ...section, borderBottom: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...caps, marginRight: 'auto' }}>Cost by node{activeGroupPath.length ? ' · this group' : ''}</span>
          {progress
            ? <button type="button" style={{ ...btn, background: tk.bg.field, color: tk.text.primary }} onClick={cancelMeasure}>Cancel</button>
            : <button type="button" style={{ ...btn, opacity: measurer ? 1 : 0.5 }} disabled={!measurer} onClick={startMeasure}>{report ? 'Measure again' : 'Measure'}</button>}
        </div>
        {progress && (
          <div style={note}>
            <span style={{ display: 'block', height: 4, borderRadius: 2, background: tk.bg.field, overflow: 'hidden', marginBottom: 6 }}>
              <span style={{ display: 'block', height: '100%', width: `${(progress.done / Math.max(1, progress.total)) * 100}%`, background: tk.accent.base, transition: 'width .2s' }} />
            </span>
            Measuring {progress.label}… {progress.done} / {progress.total}
          </div>
        )}
        {!progress && !report && (
          <div style={note}>Renders the graph once without each node and reports the frame time saved: the node's own work plus anything only it needed. Takes a few seconds.</div>
        )}
        {report && report.costs.length === 0 && <div style={note}>Nothing to measure here.</div>}
        {report && report.costs.length > 0 && (
          <>
            <div style={note}>Whole frame {report.baselineMs.toFixed(2)} ms at {report.width}×{report.height}. Click a node to select it.</div>
            {report.costs.slice(0, 12).map(c => (
              <button
                key={c.nodeId}
                type="button"
                onClick={() => { selectNodes([c.nodeId]); revealNode(activeGroupPath, c.nodeId); }}
                style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit' }}
              >
                {c.status === 'failed'
                  ? <div style={{ display: 'flex', gap: 8, fontSize: 12, color: tk.text.faint }}><Icon name="alert" size={12} />{c.label} — could not compile without it</div>
                  : <Bar label={c.label} value={c.ms} max={maxCost} unit="ms" color={c.share > 0.5 ? tk.status.warning : tk.accent.base} sub={`${Math.round(c.share * 100)}%`} />}
              </button>
            ))}
            {report.costs.length > 12 && <div style={note}>and {report.costs.length - 12} more under {report.costs[12].ms.toFixed(2)} ms</div>}
            <div style={note}>Costs overlap when nodes share upstream work, so they need not add up to the whole frame.</div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: tk.text.muted }}>{k}</span>
      <span style={{ font: `600 11.5px ${fontFamily.mono}`, color: warn ? tk.status.warning : tk.text.primary }}>{v}</span>
    </div>
  );
}
