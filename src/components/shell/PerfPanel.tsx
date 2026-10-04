import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { getPerfSnapshot, getPlayPerfSnapshot, subscribePerf, getShaderCostMeasurer, type PerfSnapshot, type PlayPerfSnapshot, type PlayStage } from '../../lib/perfStats';
import { SG_DEPTH } from '../../play/kit/signals.js';
import { shaderShape } from '../../lib/shaderShape';
import { measureNodeCosts, type NodeCostReport } from '../../lib/nodeCost';
import { SKIP_UNIFORM_TYPES } from '../../compiler/uniformPatcher';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import type { PassProgram } from '../../compiler/types';
import { programTintColour } from '../../lib/programTints';

const SCALE_MARK: Record<number, string> = { 0.5: ' (½)', 0.25: ' (¼)', 0.125: ' (⅛)' };

/**
 * A GPU timer's row: the picture ('main'), the particles, an Agents engine step, or one row per
 * Pass (`pass:<slug>`, docs/pass-node-plan.md phase 3): its label and Scale, in its Show passes
 * colour. Null for a pass no longer in the graph (its timer's last average lingers).
 */
function gpuRow(name: string, passes: readonly PassProgram[] | null): { label: string; sub: string; tint: string | null } | null {
  if (name === 'main') return { label: passes?.length ? 'Picture' : 'Shader', sub: 'GPU', tint: null };
  if (name === 'particles') return { label: 'Particles', sub: 'GPU', tint: null };
  if (name.startsWith('pass:')) {
    const i = passes ? passes.findIndex(p => p.slug === name.slice(5)) : -1;
    if (i < 0) return null;
    const p = passes![i];
    return { label: `${p.label}${SCALE_MARK[p.scale] ?? ''}${p.repeat && p.repeat > 1 ? ` ×${p.repeat}` : ''}`, sub: 'GPU', tint: programTintColour({ kind: 'pass', label: p.label, index: i }) };
  }
  if (name.startsWith('agents:')) return { label: name.slice(7), sub: 'GPU', tint: null };
  return { label: name, sub: 'GPU', tint: null };
}

/** 60 fps frame budget in ms */
const BUDGET_MS = 1000 / 60;

const fmt = (ms: number | null, digits = 1) => (ms === null ? '—' : ms.toFixed(digits));

function usePerfSnapshot(): PerfSnapshot {
  const [snap, setSnap] = useState(getPerfSnapshot);
  useEffect(() => subscribePerf(() => setSnap(getPerfSnapshot())), []);
  return snap;
}

function usePlayPerfSnapshot(): PlayPerfSnapshot {
  const [snap, setSnap] = useState(getPlayPerfSnapshot);
  useEffect(() => subscribePerf(() => setSnap(getPlayPerfSnapshot())), []);
  return snap;
}

const STAGE_LABEL: Record<PlayStage, string> = {
  inputs: 'Inputs', conditions: 'Conditions', actions: 'Actions', mappings: 'Mappings', overlay: 'Layers',
};

/**
 * Play's share of the frame: the engine's stages (inputs, conditions,
 * actions, mappings), the layers' drawing, and each layer's cost, against the
 * frame budget. Counted only while this panel is open.
 */
function PlaySection({ section, caps, note }: { section: React.CSSProperties; caps: React.CSSProperties; note: React.CSSProperties }) {
  const tk = useTokens();
  const snap = usePlayPerfSnapshot();
  const layers = useNodeGraphStore(s => s.play.layers);
  const timed = snap.stages.filter(s => s.avg !== null);
  if (!timed.length) return null;
  const total = timed.reduce((a, s) => a + (s.avg ?? 0), 0);
  const nameOf = (id: string) => layers.find(l => l.id === id)?.label ?? id;
  const colours: Record<PlayStage, string> = { inputs: tk.text.faint, conditions: tk.status.warning, actions: tk.status.danger, mappings: tk.accent.base, overlay: tk.text.muted };
  const nearGuard = snap.maxDepth >= SG_DEPTH - 1;
  return (
    <div style={section}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={caps}>Play</span>
        <span style={{ ...caps, textTransform: 'none' }}>{total.toFixed(2)} ms · {Math.round((total / BUDGET_MS) * 100)}% of the frame</span>
      </div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: tk.bg.field }} aria-label="Play stages against the frame budget">
        {timed.map(s => (
          <span key={s.stage} title={`${STAGE_LABEL[s.stage]} ${(s.avg ?? 0).toFixed(2)} ms`} style={{ width: `${Math.min(100, ((s.avg ?? 0) / BUDGET_MS) * 100)}%`, background: colours[s.stage] }} />
        ))}
      </div>
      {timed.map(s => <Bar key={s.stage} label={STAGE_LABEL[s.stage]} value={s.avg ?? 0} max={Math.max(total, 1e-3)} unit="ms" color={colours[s.stage]} />)}
      {snap.layers.slice(0, 8).map(l => <Bar key={l.id} label={nameOf(l.id)} value={l.avg} max={Math.max(snap.layers[0].avg, 1e-3)} unit="ms" color={tk.text.muted} sub="layer" />)}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 12 }}>
        <div><div style={{ font: `600 13px ${fontFamily.mono}`, color: tk.text.primary }}>{snap.conditions === null ? '—' : Math.round(snap.conditions)}</div><div style={note}>conditions a frame</div></div>
        <div><div style={{ font: `600 13px ${fontFamily.mono}`, color: tk.text.primary }}>{snap.signals === null ? '—' : snap.signals.toFixed(snap.signals < 10 ? 2 : 0)}</div><div style={note}>signals a frame</div></div>
        <div><div style={{ font: `600 13px ${fontFamily.mono}`, color: nearGuard ? tk.status.warning : tk.text.primary }}>{snap.maxDepth} / {SG_DEPTH}</div><div style={note}>deepest chain</div></div>
      </div>
      {snap.guardTrips > 0 && <div style={{ ...note, color: tk.status.warning }}>A signal chain hit the depth limit {snap.guardTrips} time{snap.guardTrips === 1 ? '' : 's'}: signals that fire each other in a loop stop after {SG_DEPTH} links a frame.</div>}
    </div>
  );
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
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 64px', alignItems: 'center', gap: 10, fontSize: 12 }}>
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
  const graphPasses = useNodeGraphStore(s => s.passes);
  const gpuRows = snap.passes.flatMap(p => { const r = gpuRow(p.name, graphPasses); return r ? [{ ...r, name: p.name, avg: p.avg }] : []; });

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

      {(gpuRows.length > 0 || snap.probeMs !== null) && (
        <div style={section}>
          <div style={caps}>Where the frame goes</div>
          {gpuRows.map(p => (
            <Bar key={p.name} label={p.label} value={p.avg} max={Math.max(frameAvg ?? 0, ...gpuRows.map(q => q.avg))} unit="ms" color={p.tint ?? tk.accent.base} sub={p.sub} />
          ))}
          {gpuRows.some(p => p.name.startsWith('pass:')) && (
            <div style={note}>Each Pass draws its program into its texture first, at its Scale (½ is a quarter of the pixels). A slow pass with a wide Blur or Glow after it: set it to ½ or ¼.</div>
          )}
          {snap.probeMs !== null && (
            <Bar label="Probes and readouts" value={snap.probeMs} max={Math.max(frameAvg ?? 0, snap.probeMs)} unit="ms" color={tk.text.faint} sub={`CPU · ${Math.round(snap.readbacks ?? 0)} readbacks`} />
          )}
          {(snap.readbacks ?? 0) >= 3 && <div style={note}>Each readback waits for the GPU. Close eye previews and scopes you are not watching.</div>}
        </div>
      )}

      <PlaySection section={section} caps={caps} note={note} />

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
