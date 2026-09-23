/**
 * MobileGraphBrowser — touch-first alternative to the spatial node-graph
 * canvas. Instead of panning/zooming/dragging connections, you drill into
 * one node at a time: Home shows the graph's Source nodes (no inputs, e.g.
 * UV) and the Output node; tapping a node focuses it and lists its inputs
 * and outputs as rows. Tapping a connected row drills into whatever it's
 * wired to; tapping an unconnected input (or "+ add consumer" on an output)
 * lets you either add a brand-new node or wire up an existing one already
 * in the graph — never by dragging, always by picking from a list.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { TYPE_COLORS } from './typeColors';
import { NodeSearchPalette } from './NodeSearchPalette';
import { typesCompatible } from '../../lib/typesCompatible';
import { groupNodesByRank } from '../../store/graphLayout';
import { moveItem } from '../../lib/reorder';
import { GLSL_PALETTE } from '../../lib/glslPalette';
import { compileNodePreviewShader } from '../../lib/compileNodePreviewShader';
import { nodePreviewRenderer } from '../../lib/nodePreviewRenderer';
import {
  VECTOR_AXES, EASING_PRESETS, socketHasKeyframes, socketHasVectorKeyframes,
  getKeyframeConfig, getAxisKeyframeConfig,
} from '../../compiler/keyframes';
import type { Keyframe, KeyframeEasing, KeyframeLoopMode } from '../../compiler/keyframes';

function nodeDotColor(n: GraphNode): string {
  if (n.type === 'output') return '#a6e3a1';
  const outType = Object.values(n.outputs)[0]?.type;
  return TYPE_COLORS[outType ?? 'float'] ?? '#888';
}

// ── Inline param sliders (unconnected float/int inputs only) ──────────────────
// Mirrors the desktop card's paramDefs-driven slider: same key convention
// (a scalar input socket's key matches its paramDef key 1:1, e.g. Simple
// SDF's `r` input <-> `r` paramDef), same min/max/step, same showWhen
// conditional visibility — just without desktop's bidirectional-range /
// custom-max power-user controls.
function paramVisible(node: GraphNode, paramDef: { showWhen?: { param: string; value: string | string[] } }): boolean {
  if (!paramDef.showWhen) return true;
  const val = node.params[paramDef.showWhen.param];
  const want = paramDef.showWhen.value;
  return Array.isArray(want) ? want.includes(val as string) : val === want;
}
function sliderableParam(node: GraphNode, key: string) {
  const def = getNodeDefinition(node.type);
  const pd = def?.paramDefs?.[key];
  if (!pd || (pd.type !== 'float' && pd.type !== 'int')) return undefined;
  if (!paramVisible(node, pd)) return undefined;
  return pd;
}
function currentSliderValue(node: GraphNode, key: string, pd: { min?: number }): number {
  if (typeof node.params[key] === 'number') return node.params[key] as number;
  const def = getNodeDefinition(node.type);
  const dv = def?.defaultParams?.[key];
  return typeof dv === 'number' ? dv : (pd.min ?? 0);
}
function formatSliderValue(v: number, step?: number): string {
  if (!step || step >= 1) return v.toFixed(0);
  if (step >= 0.1) return v.toFixed(1);
  if (step >= 0.01) return v.toFixed(2);
  return v.toFixed(3);
}

// ── Cycle safety ──────────────────────────────────────────────────────────────
// Adding a connection sourceId.output -> targetId.input is only valid if
// sourceId isn't already downstream of targetId (i.e. targetId doesn't
// already, directly or indirectly, feed into sourceId) — otherwise the new
// edge closes a loop.
function wouldCreateCycle(nodes: GraphNode[], sourceId: string, targetId: string): boolean {
  if (sourceId === targetId) return true;
  const visited = new Set<string>();
  const stack = [targetId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const n of nodes) {
      for (const inp of Object.values(n.inputs)) {
        if (inp.connection?.nodeId === cur) stack.push(n.id);
      }
    }
  }
  return false;
}

// `sourceType` finds a compatible INPUT on `node` — node.inputs are the sink,
// so the wire runs sourceType -> inp.type.
function firstCompatibleInputKey(node: GraphNode, sourceType: string): string | undefined {
  return Object.entries(node.inputs).find(([, inp]) => typesCompatible(sourceType, inp.type))?.[0];
}
// `targetType` finds a compatible OUTPUT on `node` — node.outputs are the
// source, so the wire runs out.type -> targetType.
function firstCompatibleOutputKey(node: GraphNode, targetType: string): string | undefined {
  return Object.entries(node.outputs).find(([, out]) => typesCompatible(out.type, targetType))?.[0];
}

type PendingSocket =
  | { dir: 'input'; nodeId: string; key: string; type: string }
  | { dir: 'output'; nodeId: string; key: string; type: string };

// ── Shared graph-diagram layout ─────────────────────────────────────────────
// Positions every node by (rank, index-within-rank) and collects the bezier
// edges for its existing connections. Used by both the read-only Home graph
// view and the "tap a node to connect" picker, so they always agree on where
// a node sits.
const GRAPH_ROW_H = 68, GRAPH_CELL_W = 104, GRAPH_NODE_W = 88, GRAPH_NODE_H = 34, GRAPH_PAD = 16;
function computeGraphLayout(nodes: GraphNode[], rankedRows: Array<{ rank: number; nodes: GraphNode[] }>) {
  const pos = new Map<string, { x: number; y: number }>();
  let maxCols = 1;
  rankedRows.forEach(({ nodes: rowNodes }, rowIdx) => {
    maxCols = Math.max(maxCols, rowNodes.length);
    rowNodes.forEach((n, i) => pos.set(n.id, { x: GRAPH_PAD + i * GRAPH_CELL_W, y: GRAPH_PAD + rowIdx * GRAPH_ROW_H }));
  });
  const width = GRAPH_PAD * 2 + maxCols * GRAPH_CELL_W;
  const height = GRAPH_PAD * 2 + rankedRows.length * GRAPH_ROW_H;

  const edges: Array<{ x1: number; y1: number; x2: number; y2: number; key: string }> = [];
  for (const n of nodes) {
    const to = pos.get(n.id);
    if (!to) continue;
    for (const [key, inp] of Object.entries(n.inputs)) {
      if (!inp.connection) continue;
      const from = pos.get(inp.connection.nodeId);
      if (!from) continue;
      edges.push({
        x1: from.x + GRAPH_NODE_W / 2, y1: from.y + GRAPH_NODE_H,
        x2: to.x + GRAPH_NODE_W / 2, y2: to.y,
        key: `${inp.connection.nodeId}:${inp.connection.outputKey}->${n.id}:${key}`,
      });
    }
  }
  return { pos, width, height, edges };
}
function GraphEdges({ edges }: { edges: ReturnType<typeof computeGraphLayout>['edges'] }) {
  return (
    <>
      {edges.map(e => {
        const midY = (e.y1 + e.y2) / 2;
        return (
          <path
            key={e.key}
            d={`M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${midY}, ${e.x2} ${e.y2}`}
            stroke="#585b70" strokeWidth={1.5} fill="none"
          />
        );
      })}
    </>
  );
}

const dotStyle = (color: string): React.CSSProperties => ({
  width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0,
});
const chipStyle: React.CSSProperties = {
  background: '#313244', border: '1px solid #45475a', borderRadius: '999px',
  padding: '4px 10px', fontSize: '12px', color: '#cdd6f4', cursor: 'pointer', touchAction: 'manipulation',
};
const addBtnStyle: React.CSSProperties = {
  marginLeft: 'auto', flexShrink: 0, background: '#313244', border: '1px solid #89b4fa66', color: '#89b4fa',
  borderRadius: '6px', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '18px', lineHeight: 1, cursor: 'pointer', touchAction: 'manipulation',
};
// Compact square icon button for tight rows (e.g. "+" / "✕" sitting side by
// side on an Expr Block input row) — smaller than addBtnStyle so a pair of
// them doesn't force the row taller than the text field next to them.
const smallIconBtnStyle = (color: string): React.CSSProperties => ({
  flexShrink: 0, background: 'none', border: 'none', color,
  width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '15px', lineHeight: 1, cursor: 'pointer', touchAction: 'manipulation',
});
// Back/forward buttons in the node header — dims and becomes inert (but
// stays in the layout, so the header doesn't jump) when there's nowhere to go.
const navBtnStyle = (enabled: boolean): React.CSSProperties => ({
  flexShrink: 0, background: 'none', border: 'none', color: enabled ? '#89b4fa' : '#3a3a52',
  width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '17px', lineHeight: 1, cursor: enabled ? 'pointer' : 'default', touchAction: 'manipulation',
});

// ── Socket type icon ─────────────────────────────────────────────────────────
// Used in the node detail view's Inputs/Outputs cards in place of a plain
// color dot: floats get a "#", vectors get their component letters in
// brackets ("[XY]", "[XYZ]", "[XYZW]") with each letter in its own axis
// color, so a socket's shape is readable at a glance instead of just its
// color. Anything else (bool, sampler2D, mat3, …) falls back to the dot.
const AXIS_COLORS: Record<string, string> = { x: '#f38ba8', y: '#a6e3a1', z: '#89b4fa', w: '#cba6f7' };
const ICON_VECTOR_AXES: Record<string, string[]> = { vec2: ['x', 'y'], vec3: ['x', 'y', 'z'], vec4: ['x', 'y', 'z', 'w'] };
function TypeIcon({ type }: { type: string }) {
  if (type === 'float' || type === 'int') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', flexShrink: 0, fontFamily: 'monospace', fontWeight: 700, fontSize: '12px', color: TYPE_COLORS[type] ?? '#888' }}>
        #
      </span>
    );
  }
  const axes = ICON_VECTOR_AXES[type];
  if (axes) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, fontFamily: 'monospace', fontWeight: 700, fontSize: '10px', whiteSpace: 'nowrap' }}>
        <span style={{ color: '#585b70' }}>[</span>
        {axes.map(a => <span key={a} style={{ color: AXIS_COLORS[a] }}>{a.toUpperCase()}</span>)}
        <span style={{ color: '#585b70' }}>]</span>
      </span>
    );
  }
  return <div style={dotStyle(TYPE_COLORS[type] ?? '#888')} />;
}
// Tappable, collapsible column header ("▾ INPUTS" / "▸ OUTPUTS").
const sectionHeaderBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px', width: '100%',
  background: 'none', border: 'none', padding: '4px 2px',
  fontSize: '11px', fontWeight: 700, color: '#7d8296', letterSpacing: '0.05em',
  cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left',
};
// Small pill tab, e.g. the Info/Comment toggle under a node's cards.
const smallTabBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
  background: active ? '#313244' : 'none',
  border: active ? '1px solid #89b4fa' : '1px solid #45475a',
  color: active ? '#89b4fa' : '#6c7086',
  cursor: 'pointer', touchAction: 'manipulation',
});

// ── Node preview thumbnail ──────────────────────────────────────────────────
// Reuses desktop's preview pipeline (compileNodePreviewShader walks the
// node's upstream ancestors into a self-contained shader; nodePreviewRenderer
// is a shared offscreen-WebGL singleton, not tied to the desktop canvas) to
// render a small static snapshot next to the Remove button. Recomputed only
// when the focused node changes, not on every param edit — same "snapshot,
// not live" behavior as desktop's 👁 toggle. Callers must pass `key={nodeId}`
// so switching nodes remounts this fresh (clears the stale thumbnail) rather
// than reusing state across nodes.
function NodePreviewThumb({ nodeId, nodeType }: { nodeId: string; nodeType: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const nodes = useNodeGraphStore.getState().nodes;
    const fs = compileNodePreviewShader(nodeId, nodes);
    if (!fs) return;
    let cancelled = false;
    const time = useNodeGraphStore.getState().currentTime ?? 0;
    nodePreviewRenderer.renderNodePreview(nodeId, fs, { u_time: { value: time } }, 88)
      .then(dataUrl => { if (!cancelled) setUrl(dataUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [nodeId, nodeType]);

  if (!url) return null;
  return (
    <div style={{ width: '36px', height: '36px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #313244', flexShrink: 0, background: '#11111b' }}>
      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  );
}

// ── Keyframe canvas editor ──────────────────────────────────────────────────
// Mirrors desktop's Select/Add/Delete/Draw mode toolbar (KeyframeEditorModal.
// tsx) on a plain <canvas> with pointer events instead of mouse-only drag.
// Two simplifications versus desktop, both deliberate for a first mobile
// pass: the view always auto-fits the current keyframes (no manual pan/
// zoom), and easing is chosen from EASING_PRESETS per keyframe instead of
// dragging bezier handles — same underlying Keyframe.ease data either way,
// so desktop can still fine-tune a curve mobile only roughed in.

// Same segment construction + local-time formula as generateKeyframeGLSL
// (compiler/keyframes.ts), evaluated in JS instead of emitted as GLSL, purely
// to draw the preview curve here — the real shader evaluation is fully
// GPU-side and untouched. Kept in lockstep by hand since there's no shared
// source between the two; if that GLSL codegen changes, update this too.
function kfCubicBezierJS(x: number, a: number, b: number, c: number, d: number): number {
  const A = 1 - 3 * c + 3 * a, B = 3 * c - 6 * a, C = 3 * a;
  let t = Math.max(0, Math.min(1, x));
  for (let i = 0; i < 5; i++) {
    const cx = A * t * t * t + B * t * t + C * t;
    const slope = 1 / (3 * A * t * t + 2 * B * t + C);
    t -= (cx - x) * slope;
    t = Math.max(0, Math.min(1, t));
  }
  const E = 1 - 3 * d + 3 * b, F = 3 * d - 6 * b, G = 3 * b;
  return E * t * t * t + F * t * t + G * t;
}
function evalKeyframeCurve(
  keyframes: Keyframe[], mode: KeyframeLoopMode, loopBack: number, offset: number, loopCount: number | null, t: number,
): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].v;
  const t0 = keyframes[0].t + offset;
  const duration = Math.max(keyframes[keyframes.length - 1].t - keyframes[0].t, 0.0001);
  type Seg = { start: number; end: number; v0: number; v1: number; ease: KeyframeEasing };
  const segs: Seg[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i], b = keyframes[i + 1];
    segs.push({ start: a.t - keyframes[0].t, end: b.t - keyframes[0].t, v0: a.v, v1: b.v, ease: a.ease });
  }
  if (mode === 'interpolate') {
    const last = keyframes[keyframes.length - 1];
    segs.push({ start: duration, end: duration + loopBack, v0: last.v, v1: keyframes[0].v, ease: last.ease });
  }
  const loopSpan = mode === 'interpolate' ? duration + loopBack : duration;
  let lt: number;
  if (mode === 'once') {
    lt = Math.max(0, Math.min(t - t0, duration));
  } else if (loopCount != null) {
    lt = (t - t0) >= loopCount * loopSpan ? loopSpan : (((t - t0) % loopSpan) + loopSpan) % loopSpan;
  } else {
    lt = (((t - t0) % loopSpan) + loopSpan) % loopSpan;
  }
  for (const seg of segs) {
    if (lt < seg.end) {
      const segDur = Math.max(seg.end - seg.start, 0.0001);
      const st = Math.max(0, Math.min(1, (lt - seg.start) / segDur));
      return seg.v0 + (seg.v1 - seg.v0) * kfCubicBezierJS(st, seg.ease.a, seg.ease.b, seg.ease.c, seg.ease.d);
    }
  }
  return segs[segs.length - 1]?.v1 ?? keyframes[keyframes.length - 1].v;
}
// Draw mode: the recorded path (many samples) is reduced to at most 8
// evenly-spaced points with linear easing, same cap and approach desktop's
// downsamplePath uses — GLSL codegen unrolls one if/else branch per segment,
// so an unbounded point count isn't just a UI concern.
function downsampleDrawPath(path: Array<{ t: number; v: number }>): Keyframe[] {
  if (path.length === 0) return [];
  const MAX_POINTS = 8;
  const picked = path.length <= MAX_POINTS
    ? path
    : Array.from({ length: MAX_POINTS }, (_, i) => path[Math.round((i / (MAX_POINTS - 1)) * (path.length - 1))]);
  const out: Keyframe[] = [];
  for (const p of picked) {
    const t = out.length > 0 && p.t <= out[out.length - 1].t ? out[out.length - 1].t + 0.001 : p.t;
    out.push({ t, v: p.v, ease: EASING_PRESETS.linear });
  }
  return out;
}

const KF_PAD = { l: 34, r: 10, t: 10, b: 20 };
const KF_HIT_PX = 20;
type KfTool = 'select' | 'add' | 'delete' | 'draw';
type KfDrag = { kind: 'move'; index: number } | { kind: 'draw'; path: Array<{ t: number; v: number }> };

function KeyframeCanvasEditor({ keyframes, mode, loopBack, offset, loopCount, valueMin, valueMax, tool, onChange, selectedIndex, onSelect }: {
  keyframes: Keyframe[];
  mode: KeyframeLoopMode;
  loopBack: number;
  offset: number;
  loopCount: number | null;
  valueMin: number;
  valueMax: number;
  tool: KfTool;
  onChange: (next: Keyframe[]) => void;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 220 });
  const dragRef = useRef<KfDrag | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0) setSize({ width: box.width, height: 220 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxT = Math.max(5, ...keyframes.map(k => k.t)) + 1;
  const minT = 0;
  const vSpan = valueMax - valueMin || 1;

  const toX = (t: number) => KF_PAD.l + ((t - minT) / (maxT - minT)) * (size.width - KF_PAD.l - KF_PAD.r);
  const toY = (v: number) => KF_PAD.t + (1 - (v - valueMin) / vSpan) * (size.height - KF_PAD.t - KF_PAD.b);
  const fromX = (x: number) => minT + ((x - KF_PAD.l) / (size.width - KF_PAD.l - KF_PAD.r)) * (maxT - minT);
  const fromY = (y: number) => valueMax - ((y - KF_PAD.t) / (size.height - KF_PAD.t - KF_PAD.b)) * vSpan;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    ctx.strokeStyle = '#24243a';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#585b70';
    ctx.font = '9px monospace';
    const gridStep = Math.max(1, Math.round(maxT / 8));
    for (let gt = 0; gt <= maxT; gt += gridStep) {
      const x = toX(gt);
      ctx.beginPath(); ctx.moveTo(x, KF_PAD.t); ctx.lineTo(x, size.height - KF_PAD.b); ctx.stroke();
      ctx.fillText(`${gt}s`, x - 6, size.height - 6);
    }
    ctx.fillText(valueMax.toFixed(1), 2, toY(valueMax) + 8);
    ctx.fillText(valueMin.toFixed(1), 2, toY(valueMin));

    if (keyframes.length > 0) {
      ctx.strokeStyle = '#89b4fa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const t = minT + (i / steps) * (maxT - minT);
        const v = Math.max(valueMin, Math.min(valueMax, evalKeyframeCurve(keyframes, mode, loopBack, offset, loopCount, t)));
        const x = toX(t), y = toY(v);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    keyframes.forEach((kf, i) => {
      const x = toX(kf.t), y = toY(kf.v);
      const isSelected = i === selectedIndex;
      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#f9e2af' : '#fab387';
      ctx.fill();
      ctx.strokeStyle = '#181825';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyframes, mode, loopBack, offset, loopCount, valueMin, valueMax, selectedIndex, size, maxT]);

  const hitTest = (x: number, y: number): number | null => {
    let best: number | null = null, bestDist = KF_HIT_PX;
    keyframes.forEach((kf, i) => {
      const d = Math.hypot(toX(kf.t) - x, toY(kf.v) - y);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  };
  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const clampV = (v: number) => Math.max(valueMin, Math.min(valueMax, v));
  const clampT = (t: number) => Math.max(0, t);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = pointerPos(e);
    const hit = hitTest(x, y);
    if (tool === 'delete') {
      if (hit != null) { onChange(keyframes.filter((_, i) => i !== hit)); onSelect(null); }
      return;
    }
    if (tool === 'draw') {
      dragRef.current = { kind: 'draw', path: [{ t: clampT(fromX(x)), v: clampV(fromY(y)) }] };
      return;
    }
    if (hit != null) {
      onSelect(hit);
      dragRef.current = { kind: 'move', index: hit };
      return;
    }
    if (tool === 'add') {
      const t = clampT(fromX(x)), v = clampV(fromY(y));
      const fresh = { t, v, ease: EASING_PRESETS.ease };
      const next = [...keyframes, fresh].sort((a, b) => a.t - b.t);
      onChange(next);
      onSelect(next.indexOf(fresh));
      dragRef.current = { kind: 'move', index: next.indexOf(fresh) };
    } else {
      onSelect(null);
    }
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = pointerPos(e);
    if (drag.kind === 'draw') {
      const t = clampT(fromX(x)), v = clampV(fromY(y));
      const last = drag.path[drag.path.length - 1];
      if (!last || Math.hypot(toX(t) - toX(last.t), toY(v) - toY(last.v)) > 4) drag.path.push({ t, v });
      return;
    }
    const next = keyframes.map((k, i) => i === drag.index ? { ...k, t: clampT(fromX(x)), v: clampV(fromY(y)) } : k);
    onChange(next);
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.kind === 'draw') {
      onChange(downsampleDrawPath(drag.path));
      onSelect(null);
      return;
    }
    const moved = keyframes[drag.index];
    if (!moved) return;
    const sorted = [...keyframes].sort((a, b) => a.t - b.t);
    onChange(sorted);
    onSelect(sorted.indexOf(moved));
  };

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ display: 'block', borderRadius: '8px', background: '#11111b', border: '1px solid #313244', touchAction: 'none' }}
      />
    </div>
  );
}

// ── Expr Block editor (mobile) ──────────────────────────────────────────────
const EXPR_TYPE_OPTIONS: DataType[] = ['float', 'vec2', 'vec3', 'vec4'];
const EXPR_OPS = ['=', '+=', '-=', '*=', '/='];
const exprTextInputStyle: React.CSSProperties = {
  background: '#11111b', border: '1px solid #45475a', color: '#cdd6f4',
  borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontFamily: 'monospace', outline: 'none', minWidth: 0,
};
const exprSelectStyle: React.CSSProperties = {
  background: '#11111b', border: '1px solid #45475a', color: '#89b4fa',
  borderRadius: '6px', padding: '8px 6px', fontSize: '13px', cursor: 'pointer', outline: 'none',
};
// Thin highlight stroke around whichever input/line card currently has focus
// — makes it obvious which element you're editing on a small screen.
const exprCardStyle = (focused: boolean): React.CSSProperties => ({
  background: '#1e1e2e', borderRadius: '8px', padding: '7px 8px',
  border: focused ? '1px solid #89b4fa' : '1px solid #313244',
  display: 'flex', flexDirection: 'column', gap: '6px',
});
type ExprInputDef = { name: string; type: DataType; slider: { min: number; max: number } | null; carry?: boolean };
type ExprLine = { lhs: string; op: string; rhs: string };

// The identifier-ish token immediately before `cursor` in `str` — e.g. for
// "sin(a) + cl|" with the cursor at "|", returns { start: 10, word: "cl" }.
function wordBeforeCursor(str: string, cursor: number): { start: number; word: string } {
  let start = cursor;
  while (start > 0 && /[A-Za-z0-9_]/.test(str[start - 1])) start--;
  return { start, word: str.slice(start, cursor) };
}

// The only global uniforms every compiled shader (and every Expr Block's
// scope) can always reference, regardless of what the node declares —
// suggested after local variables but before builtin functions.
const GLSL_GLOBALS = ['u_time', 'u_resolution'];

type ExprSuggestion = { label: string; insert: string; kind: 'variable' | 'global' | 'function' };

// ── GLSL expression input with inline autocomplete ─────────────────────────
// Used for any freeform GLSL expression field (a line's RHS, the result
// expression) — not the LHS, which is normally just a variable/component
// name. As you type an identifier, matching suggestions appear as a chip row
// below the field, ranked local variables first (this block's declared
// inputs), then the couple of always-available globals, then builtin
// functions from GLSL_PALETTE; tapping one replaces the partial word with
// the full snippet and drops the cursor inside its parens (functions) or
// right after (variables/globals), ready to keep typing.
function GlslExprInput({ value, onChange, placeholder, style, variables = [] }: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  style: React.CSSProperties;
  variables?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo<ExprSuggestion[]>(() => {
    if (query.length === 0) return [];
    const q = query.toLowerCase();
    const varMatches: ExprSuggestion[] = variables
      .filter(v => v.toLowerCase().startsWith(q))
      .map(v => ({ label: v, insert: v, kind: 'variable' }));
    const globalMatches: ExprSuggestion[] = GLSL_GLOBALS
      .filter(v => v.toLowerCase().startsWith(q))
      .map(v => ({ label: v, insert: v, kind: 'global' }));
    // GLSL_PALETTE's Constants group also lists u_time (for desktop's insert
    // palette) — skip it here since GLSL_GLOBALS already covers it, ranked
    // higher, and we don't want the same chip appearing twice.
    const fnMatches: ExprSuggestion[] = GLSL_PALETTE
      .filter(e => e.label.toLowerCase().startsWith(q) && !GLSL_GLOBALS.includes(e.label))
      .map(e => ({ label: e.label, insert: e.insert, kind: 'function' }));
    return [...varMatches, ...globalMatches, ...fnMatches].slice(0, 8);
  }, [query, variables]);

  const syncQueryFromCaret = (el: HTMLInputElement) => {
    const cursor = el.selectionStart ?? el.value.length;
    setQuery(wordBeforeCursor(el.value, cursor).word);
  };

  const applySuggestion = (insert: string) => {
    const el = inputRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const { start } = wordBeforeCursor(value, cursor);
    const before = value.slice(0, start);
    const after = value.slice(cursor);
    const next = before + insert + after;
    onChange(next);
    setOpen(false);
    setQuery('');
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const parenIdx = insert.indexOf('(');
      const caret = before.length + (parenIdx >= 0 ? parenIdx + 1 : insert.length);
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div style={{ position: 'relative', flex: (style as { flex?: number | string }).flex, minWidth: 0 }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={e => { onChange(e.target.value); syncQueryFromCaret(e.target); }}
        onFocus={e => { syncQueryFromCaret(e.target); setOpen(true); }}
        onKeyUp={e => syncQueryFromCaret(e.currentTarget)}
        onClick={e => syncQueryFromCaret(e.currentTarget)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ ...style, width: '100%' }}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', zIndex: 30,
          display: 'flex', gap: '4px', overflowX: 'auto', background: '#11111b',
          border: '1px solid #45475a', borderRadius: '6px', padding: '4px',
        }}>
          {matches.map(m => (
            <button
              key={`${m.kind}:${m.label}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => applySuggestion(m.insert)}
              style={{
                flexShrink: 0, background: '#313244', border: '1px solid #45475a', borderRadius: '4px',
                padding: '4px 8px', fontSize: '11px', fontFamily: 'monospace',
                color: m.kind === 'variable' ? '#89b4fa' : m.kind === 'global' ? '#cba6f7' : '#a6e3a1',
                cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reorderable GLSL line list (drag handle, press-and-drag) ───────────────
// A dedicated component (not a helper function) so its drag-state hooks obey
// the rules of hooks regardless of how the parent conditionally renders it.
// Dragging works by pointer capture on the handle: as the pointer crosses a
// neighboring row's midpoint, that row swaps position in the array (and the
// drag continues from there) — the row you're holding is translateY'd to
// visually track the pointer between swaps.
function ExprLinesList({ lines, onReorder, onUpdateLine, onRemoveLine, variables }: {
  lines: ExprLine[];
  onReorder: (next: ExprLine[]) => void;
  onUpdateLine: (idx: number, field: keyof ExprLine, value: string) => void;
  onRemoveLine: (idx: number) => void;
  variables: string[];
}) {
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [drag, setDrag] = useState<{ index: number; startY: number; currentY: number } | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  const handlePointerDown = (index: number, e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ index, startY: e.clientY, currentY: e.clientY });
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const currentY = e.clientY;
    const rows = rowRefs.current;
    let targetIndex = drag.index;
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (currentY < rect.top + rect.height / 2) { targetIndex = i; break; }
      targetIndex = i;
    }
    if (targetIndex !== drag.index) {
      onReorder(moveItem(lines, drag.index, targetIndex));
      setDrag({ index: targetIndex, startY: currentY, currentY });
    } else {
      setDrag(d => (d ? { ...d, currentY } : d));
    }
  };
  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {lines.map((line, i) => {
        const isDragging = drag?.index === i;
        return (
          <div
            key={i}
            ref={el => { rowRefs.current[i] = el; }}
            onFocus={() => setFocusedIdx(i)}
            onBlur={() => setFocusedIdx(null)}
            style={{
              ...exprCardStyle(focusedIdx === i),
              position: 'relative',
              transform: isDragging ? `translateY(${drag!.currentY - drag!.startY}px)` : undefined,
              zIndex: isDragging ? 10 : undefined,
              boxShadow: isDragging ? '0 6px 16px rgba(0,0,0,0.5)' : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onPointerDown={e => handlePointerDown(i, e)}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ background: 'none', border: 'none', color: '#6c7086', fontSize: '16px', lineHeight: 1, cursor: 'grab', padding: '4px', touchAction: 'none' }}
                title="Drag to reorder"
              >☰</button>
              <span style={{ fontSize: '10px', color: '#585b70', flex: 1 }}>Line {i + 1}</span>
              <button
                onClick={() => onRemoveLine(i)}
                style={{ background: 'none', border: 'none', color: '#f38ba8', fontSize: '16px', cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
                title="Remove line"
              >✕</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="text" value={line.lhs} onChange={e => onUpdateLine(i, 'lhs', e.target.value)} placeholder="p.xy" style={{ ...exprTextInputStyle, width: '64px' }} />
              <select value={line.op} onChange={e => onUpdateLine(i, 'op', e.target.value)} style={exprSelectStyle}>
                {EXPR_OPS.map(op => <option key={op} value={op}>{op}</option>)}
              </select>
              <GlslExprInput
                value={line.rhs}
                onChange={v => onUpdateLine(i, 'rhs', v)}
                placeholder="expression…"
                style={{ ...exprTextInputStyle, flex: 1, color: '#a6e3a1' }}
                variables={variables}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MobileGraphBrowser() {
  const nodes = useNodeGraphStore(s => s.nodes);
  const connectNodes = useNodeGraphStore(s => s.connectNodes);
  const disconnectInput = useNodeGraphStore(s => s.disconnectInput);
  const removeNode = useNodeGraphStore(s => s.removeNode);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const updateNodeSockets = useNodeGraphStore(s => s.updateNodeSockets);
  // Cross-cutting with App.tsx's bottom action bar — see the store field's
  // own comment. mobileKeyframeTool is read here to drive the canvas editor
  // and written from the bottom bar's mode buttons, not from this file.
  const mobileKeyframeEditor = useNodeGraphStore(s => s.mobileKeyframeEditor);
  const setMobileKeyframeEditor = useNodeGraphStore(s => s.setMobileKeyframeEditor);
  const mobileKeyframeTool = useNodeGraphStore(s => s.mobileKeyframeTool);
  const setMobileKeyframeTool = useNodeGraphStore(s => s.setMobileKeyframeTool);

  const [focusStack, setFocusStack] = useState<string[]>([]);
  // Redo history for the ‹/› back/forward buttons in the node header — only
  // populated by goBack (what you stepped away from); any fresh navigation
  // (drilling into a new node, jumping via breadcrumb, going Home) discards
  // it, same as a browser tab's forward history after you follow a new link.
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingSocket | null>(null);
  const [connectPicker, setConnectPicker] = useState<PendingSocket | null>(null);
  const [homeGraphView, setHomeGraphView] = useState(false);
  // The graph diagram is reachable from anywhere (not just Home) via the
  // breadcrumb's "⋈ Graph" button — at Home it toggles the list/graph view
  // in place (homeGraphView above); inside a node it opens this overlay
  // instead, highlighting the current node, so you can jump straight to any
  // other node without walking back up the drill-down stack.
  const [showGraphOverlay, setShowGraphOverlay] = useState(false);
  // Expr Block nodes have their own two-mode editor (Inputs / Output); it
  // always opens on Inputs, the same as a freshly-added block would. Reset
  // during render (not an effect) when focus moves to a different node —
  // React's documented pattern for "adjust state when a prop changes".
  const [exprMode, setExprMode] = useState<'inputs' | 'output'>('inputs');
  const [exprModeFor, setExprModeFor] = useState<string | undefined>(undefined);
  // Which Expr Block input card currently has focus, for the thin highlight
  // stroke — cleared naturally by the row's onBlur, not reset elsewhere.
  const [focusedInputIdx, setFocusedInputIdx] = useState<number | null>(null);
  // Generic node detail: whether the Inputs/Outputs column is expanded —
  // each collapses independently by tapping its own header. Reset open on
  // every node change (below), same as exprMode.
  const [nodeSectionsOpen, setNodeSectionsOpen] = useState({ inputs: true, outputs: true });
  // Info/Comment toggle under a generic node's cards — defaults to Info,
  // reset alongside the other per-node view state below.
  const [infoTab, setInfoTab] = useState<'info' | 'comment'>('info');
  // Which keyframe point is selected (for the easing-preset picker) — reset
  // whenever the editor's target (node/socket/axis) changes, below.
  const [kfSelectedIndex, setKfSelectedIndex] = useState<number | null>(null);
  const [kfSelectedFor, setKfSelectedFor] = useState<string | undefined>(undefined);
  // Which float input card is expanded — tapping a card's value opens its
  // full controls (numeric entry, custom max, bidirectional) and collapses
  // any other expanded card, since this is a single shared key rather than
  // a per-card boolean. Same __scMax_<key>/__scBidir_<key> node.params keys
  // desktop's own slider config panel uses (NodeComponent.tsx), so a range
  // customized on one platform carries over to the other.
  const [openSliderConfig, setOpenSliderConfig] = useState<string | null>(null);

  const focusedId = focusStack[focusStack.length - 1];
  const focusedNode = focusedId ? nodes.find(n => n.id === focusedId) : undefined;

  if (exprModeFor !== focusedId) {
    setExprModeFor(focusedId);
    setExprMode('inputs');
    setNodeSectionsOpen({ inputs: true, outputs: true });
    setInfoTab('info');
    setOpenSliderConfig(null);
  }
  const kfTargetKey = mobileKeyframeEditor
    ? `${mobileKeyframeEditor.nodeId}:${mobileKeyframeEditor.socketKey}:${mobileKeyframeEditor.axis ?? ''}`
    : undefined;
  if (kfSelectedFor !== kfTargetKey) {
    setKfSelectedFor(kfTargetKey);
    setKfSelectedIndex(null);
  }

  // Same rank assignment the desktop "Auto Layout" button uses for spatial
  // x position — reused here as row index, so a node's row in this grid
  // always matches the column it would land in on the canvas.
  const rankedRows = useMemo(() => groupNodesByRank(nodes), [nodes]);

  const pushFocus = (id: string) => { setFocusStack(stack => [...stack, id]); setForwardStack([]); };
  const jumpTo = (index: number) => { setFocusStack(stack => stack.slice(0, index + 1)); setForwardStack([]); };
  const goHome = () => { setFocusStack([]); setForwardStack([]); };
  const goBack = () => {
    if (focusStack.length === 0) return;
    setForwardStack(f => [focusStack[focusStack.length - 1], ...f]);
    setFocusStack(stack => stack.slice(0, -1));
  };
  const goForward = () => {
    if (forwardStack.length === 0) return;
    setFocusStack(stack => [...stack, forwardStack[0]]);
    setForwardStack(f => f.slice(1));
  };
  // Jump forward multiple steps at once by tapping a dimmed breadcrumb item
  // (index within forwardStack) — restores everything up to and including
  // that node, keeping whatever's beyond it as the remaining redo history.
  const goForwardTo = (index: number) => {
    setFocusStack(stack => [...stack, ...forwardStack.slice(0, index + 1)]);
    setForwardStack(f => f.slice(index + 1));
  };

  const downstreamConsumers = (nodeId: string, outputKey: string) =>
    nodes.filter(n => Object.values(n.inputs).some(inp => inp.connection?.nodeId === nodeId && inp.connection.outputKey === outputKey));

  const labelFor = (n: GraphNode) => getNodeDefinition(n.type)?.label ?? n.type;

  const handleNodePlacedForInput = (newId: string, socket: Extract<PendingSocket, { dir: 'input' }>) => {
    const newNode = useNodeGraphStore.getState().nodes.find(n => n.id === newId);
    if (!newNode) return;
    const outKey = firstCompatibleOutputKey(newNode, socket.type);
    if (outKey) connectNodes(newId, outKey, socket.nodeId, socket.key);
    pushFocus(newId);
  };

  const handleNodePlacedForOutput = (newId: string, socket: Extract<PendingSocket, { dir: 'output' }>) => {
    const newNode = useNodeGraphStore.getState().nodes.find(n => n.id === newId);
    if (!newNode) return;
    const inKey = firstCompatibleInputKey(newNode, socket.type);
    if (inKey) connectNodes(socket.nodeId, socket.key, newId, inKey);
    pushFocus(newId);
  };

  // ── Connect-existing candidate list ──────────────────────────────────────
  const connectCandidates = useMemo(() => {
    if (!connectPicker) return [];
    if (connectPicker.dir === 'input') {
      // picking a node whose OUTPUT will feed this input
      return nodes.filter(n =>
        n.id !== connectPicker.nodeId &&
        Object.values(n.outputs).some(o => typesCompatible(o.type, connectPicker.type)) &&
        !wouldCreateCycle(nodes, n.id, connectPicker.nodeId),
      );
    }
    // picking a node whose INPUT will consume this output
    return nodes.filter(n =>
      n.id !== connectPicker.nodeId &&
      Object.values(n.inputs).some(i => typesCompatible(connectPicker.type, i.type)) &&
      !wouldCreateCycle(nodes, connectPicker.nodeId, n.id),
    );
  }, [connectPicker, nodes]);

  const commitConnectExisting = (otherId: string) => {
    if (!connectPicker) return;
    const other = nodes.find(n => n.id === otherId);
    if (!other) return;
    if (connectPicker.dir === 'input') {
      const outKey = firstCompatibleOutputKey(other, connectPicker.type);
      if (outKey) connectNodes(otherId, outKey, connectPicker.nodeId, connectPicker.key);
    } else {
      const inKey = firstCompatibleInputKey(other, connectPicker.type);
      if (inKey) connectNodes(connectPicker.nodeId, connectPicker.key, otherId, inKey);
    }
    setConnectPicker(null);
    pushFocus(otherId);
  };

  // ── Shared node-detail header ────────────────────────────────────────────
  // Used by every "inside a node" view (generic, Expr Block, keyframe
  // editor) — the one fixed element as you scroll/edit below it, styled
  // brighter than everything else to anchor "what node am I in" at a
  // glance. Back/forward step through the drill-down history; Remove is
  // hidden only for the Output node (which can't be removed) or at Home
  // (unreachable here anyway, since this only renders once focused).
  function renderNodeHeader(node: GraphNode) {
    return (
      <div style={{ padding: '12px', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', gap: '4px', background: '#242438' }}>
        <button style={navBtnStyle(focusStack.length > 0)} disabled={focusStack.length === 0} title="Back" onClick={goBack}>‹</button>
        <button style={navBtnStyle(forwardStack.length > 0)} disabled={forwardStack.length === 0} title="Forward" onClick={goForward}>›</button>
        <div style={{ ...dotStyle(nodeDotColor(node)), marginLeft: '4px' }} />
        <div style={{ fontWeight: 700, fontSize: '16px', color: '#ffffff', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(node)}</div>
        <NodePreviewThumb key={node.id} nodeId={node.id} nodeType={node.type} />
        {node.type !== 'output' && focusStack.length > 0 && (
          <button
            onClick={() => { removeNode(node.id); setFocusStack(stack => stack.slice(0, -1)); }}
            style={{ background: 'none', border: '1px solid #f38ba866', color: '#f38ba8', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
          >
            Remove
          </button>
        )}
      </div>
    );
  }

  // ── Node detail (focused) view ───────────────────────────────────────────
  function renderNodeDetail(node: GraphNode) {
    const def = getNodeDefinition(node.type);
    const hasInputs = Object.keys(node.inputs).length > 0;
    const hasOutputs = Object.keys(node.outputs).length > 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {renderNodeHeader(node)}

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            {hasInputs && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <button style={sectionHeaderBtnStyle} onClick={() => setNodeSectionsOpen(s => ({ ...s, inputs: !s.inputs }))}>
                  <span>{nodeSectionsOpen.inputs ? '▾' : '▸'} INPUTS</span>
                </button>
                {nodeSectionsOpen.inputs && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    {Object.entries(node.inputs).map(([key, inp]) => {
                      const upstream = inp.connection ? nodes.find(n => n.id === inp.connection!.nodeId) : undefined;
                      // Keyframes are a third input mode alongside "wired"
                      // and "static value" — same eligibility rule desktop
                      // uses (NodeComponent.tsx): an unwired float socket, or
                      // an unwired vec2/vec3 socket that declares which
                      // static params back each axis (most vec2/vec3 sockets
                      // are meant to be wired — UV, positions — and don't
                      // declare this, so they stay ineligible).
                      const isVectorKfType = inp.type === 'vec2' || inp.type === 'vec3';
                      const kfAxes = isVectorKfType ? VECTOR_AXES[inp.type as 'vec2' | 'vec3'] : null;
                      const kfEligible = !upstream && (inp.type === 'float' || (isVectorKfType && !!inp.axisParams));
                      const isKeyframed = kfEligible && (
                        inp.type === 'float' ? socketHasKeyframes(node, key) : socketHasVectorKeyframes(node, key, kfAxes ?? [])
                      );
                      const pd = upstream || isKeyframed ? undefined : sliderableParam(node, key);
                      const val = pd ? currentSliderValue(node, key, pd) : 0;
                      return (
                        <div key={key} style={{ background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <TypeIcon type={inp.type} />
                            <div style={{ flex: 1, minWidth: 0, fontSize: '12px', color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inp.label}</div>
                            {!upstream && kfEligible && (
                              <button
                                style={smallIconBtnStyle(isKeyframed ? '#f9e2af' : '#a6adc8')}
                                title={isKeyframed ? 'Edit Keyframes' : 'Add Keyframes'}
                                onClick={() => {
                                  const axis = kfAxes ? kfAxes[0] : undefined;
                                  setMobileKeyframeEditor({ nodeId: node.id, socketKey: key, axis });
                                  setMobileKeyframeTool(isKeyframed ? 'select' : 'add');
                                }}
                              >◆</button>
                            )}
                            {!upstream && (
                              <button style={smallIconBtnStyle('#89b4fa')} title="Wire this input" onClick={() => setPending({ dir: 'input', nodeId: node.id, key, type: inp.type })}>+</button>
                            )}
                          </div>
                          {upstream && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <button style={{ ...chipStyle, fontSize: '10px', padding: '3px 8px' }} onClick={() => pushFocus(upstream.id)}>{labelFor(upstream)} ›</button>
                              <button
                                onClick={() => disconnectInput(node.id, key)}
                                style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '12px', cursor: 'pointer', padding: '2px', touchAction: 'manipulation' }}
                                title="Disconnect"
                              >✕</button>
                            </div>
                          )}
                          {pd && (() => {
                            const bidir = node.params[`__scBidir_${key}`] === true;
                            const customMax = typeof node.params[`__scMax_${key}`] === 'number' ? node.params[`__scMax_${key}`] as number : null;
                            const baseMax = pd.max ?? 1;
                            const effMax = customMax ?? baseMax;
                            const effMin = bidir ? -effMax : (customMax != null ? 0 : (pd.min ?? 0));
                            // Accordion: tapping the value opens this card's full
                            // controls and collapses whichever other card was open,
                            // since openSliderConfig holds a single key, not a
                            // per-card flag.
                            const isExpanded = openSliderConfig === key;
                            const setCustomMax = (n: number) => {
                              const absN = Math.abs(n);
                              if (absN > 0) updateNodeParams(node.id, { [`__scMax_${key}`]: absN });
                            };
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <input
                                    type="range"
                                    min={effMin}
                                    max={effMax}
                                    step={pd.step ?? 0.01}
                                    value={Math.max(effMin, Math.min(effMax, val))}
                                    onChange={e => updateNodeParams(node.id, { [key]: parseFloat(e.target.value) }, { immediate: true })}
                                    onDoubleClick={() => {
                                      const defVal = getNodeDefinition(node.type)?.defaultParams?.[key];
                                      updateNodeParams(node.id, { [key]: typeof defVal === 'number' ? defVal : (effMin + effMax) / 2 }, { immediate: true });
                                    }}
                                    title="Double-tap to reset to default"
                                    style={{ flex: 1 }}
                                  />
                                  <button
                                    onClick={() => setOpenSliderConfig(o => o === key ? null : key)}
                                    title="Tap for range, bidirectional & keyframe controls"
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: '3px',
                                      background: isExpanded ? '#313244' : 'none',
                                      border: isExpanded ? '1px solid #45475a' : '1px solid transparent',
                                      borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', touchAction: 'manipulation',
                                      color: isExpanded ? '#cdd6f4' : '#a6adc8',
                                    }}
                                  >
                                    <span style={{ fontSize: '10px', minWidth: '32px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                      {formatSliderValue(val, pd.step)}
                                    </span>
                                    <span style={{ fontSize: '8px', color: '#585b70' }}>{isExpanded ? '▾' : '▸'}</span>
                                  </button>
                                </div>
                                {isExpanded && (
                                  <div style={{ background: '#181825', border: '1px solid #313244', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '10px', color: '#6c7086', width: '32px' }}>Value</span>
                                      <input
                                        type="number"
                                        step={pd.step ?? 0.01}
                                        value={val}
                                        onChange={e => {
                                          const n = parseFloat(e.target.value);
                                          if (isNaN(n)) return;
                                          if (Math.abs(n) > effMax) setCustomMax(n);
                                          updateNodeParams(node.id, { [key]: n }, { immediate: true });
                                        }}
                                        style={{ ...exprTextInputStyle, flex: 1, padding: '4px 6px', fontSize: '11px' }}
                                      />
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', touchAction: 'manipulation' }}>
                                      <input
                                        type="checkbox"
                                        checked={bidir}
                                        onChange={e => updateNodeParams(node.id, { [`__scBidir_${key}`]: e.target.checked }, { immediate: true })}
                                        style={{ accentColor: '#cba6f7' }}
                                      />
                                      <span style={{ fontSize: '10px', color: '#a6adc8' }}>Bidirectional</span>
                                    </label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '10px', color: '#6c7086', width: '32px' }}>Max</span>
                                      <input
                                        type="number"
                                        step={pd.step ?? 0.01}
                                        value={effMax}
                                        onChange={e => {
                                          const n = parseFloat(e.target.value);
                                          if (!isNaN(n) && n > 0) setCustomMax(n);
                                        }}
                                        style={{ ...exprTextInputStyle, flex: 1, padding: '4px 6px', fontSize: '11px' }}
                                      />
                                      {customMax != null && (
                                        <button
                                          onClick={() => updateNodeParams(node.id, { [`__scMax_${key}`]: null }, { immediate: true })}
                                          style={{ fontSize: '9px', color: '#585b70', background: 'none', border: '1px solid #313244', borderRadius: '4px', cursor: 'pointer', padding: '4px 6px', touchAction: 'manipulation' }}
                                        >Reset</button>
                                      )}
                                    </div>
                                    <span style={{ fontSize: '9px', color: '#585b70' }}>
                                      Range: {formatSliderValue(effMin, pd.step)} → {formatSliderValue(effMax, pd.step)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {hasOutputs && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <button style={sectionHeaderBtnStyle} onClick={() => setNodeSectionsOpen(s => ({ ...s, outputs: !s.outputs }))}>
                  <span>{nodeSectionsOpen.outputs ? '▾' : '▸'} OUTPUTS</span>
                </button>
                {nodeSectionsOpen.outputs && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    {Object.entries(node.outputs).map(([key, out]) => {
                      const consumers = downstreamConsumers(node.id, key);
                      return (
                        <div key={key} style={{ background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <TypeIcon type={out.type} />
                            <div style={{ flex: 1, minWidth: 0, fontSize: '12px', color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{out.label}</div>
                            <button style={smallIconBtnStyle('#89b4fa')} title="Add a consumer for this output" onClick={() => setPending({ dir: 'output', nodeId: node.id, key, type: out.type })}>+</button>
                          </div>
                          {consumers.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                              {consumers.map(c => (
                                <button key={c.id} style={{ ...chipStyle, fontSize: '10px', padding: '3px 8px' }} onClick={() => pushFocus(c.id)}>{labelFor(c)} ›</button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <button style={smallTabBtnStyle(infoTab === 'info')} onClick={() => setInfoTab('info')}>ℹ Info</button>
              <button style={smallTabBtnStyle(infoTab === 'comment')} onClick={() => setInfoTab('comment')}>✎ Comment</button>
            </div>
            {infoTab === 'info' ? (
              <div style={{ fontSize: '11px', color: '#585b70', lineHeight: 1.5 }}>
                {def?.description ?? 'No info for this node.'}
              </div>
            ) : (
              <textarea
                // Same node.params.__comment key desktop's own comment editor
                // uses (NodeComponent.tsx) — a "__"-prefixed metadata field,
                // not a regular node param — so a comment written on either
                // platform shows up on the other for the same node.
                value={(node.params.__comment as string | undefined) ?? ''}
                onChange={e => updateNodeParams(node.id, { __comment: e.target.value }, { immediate: true })}
                placeholder="Add a note…"
                style={{
                  width: '100%', minHeight: '64px', background: '#1e1e2e', border: '1px solid #313244',
                  borderRadius: '8px', padding: '8px', fontSize: '12px', color: '#cdd6f4',
                  fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                }}
              />
            )}
          </div>
        </div>

        {renderSocketOverlays(node)}
      </div>
    );
  }

  // ── Keyframe editor view ─────────────────────────────────────────────────
  // Replaces the node detail's card content (not the header) while a socket
  // is being keyframed. The Select/Add/Delete/Draw tool buttons live in
  // App.tsx's bottom action bar (mobileKeyframeTool, read above) since
  // there's no keyboard here for desktop's V/C/X/D shortcuts.
  function renderKeyframeEditorView(node: GraphNode) {
    const target = mobileKeyframeEditor;
    const input = target ? node.inputs[target.socketKey] : undefined;
    if (!target || !input) {
      // Socket vanished from under us (e.g. node type changed) — bail out
      // to the normal detail view instead of rendering a broken editor.
      if (target) setMobileKeyframeEditor(null);
      return renderNodeDetail(node);
    }
    const isVector = input.type === 'vec2' || input.type === 'vec3';
    const axes = isVector ? VECTOR_AXES[input.type as 'vec2' | 'vec3'] : null;
    const axis = target.axis;
    const cfg = axis ? getAxisKeyframeConfig(node, target.socketKey, axis) : getKeyframeConfig(node, target.socketKey);
    const keyframes = cfg?.keyframes ?? [];
    const mode = cfg?.mode ?? 'once';
    const loopBack = cfg?.loopBack ?? 1;
    const offset = cfg?.offset ?? 0;
    const loopCount = cfg?.loopCount ?? null;

    const paramDefKey = axis ? input.axisParams?.[axes!.indexOf(axis)] : target.socketKey;
    const pd = paramDefKey ? getNodeDefinition(node.type)?.paramDefs?.[paramDefKey] : undefined;
    const kfVals = keyframes.map(k => k.v);
    const autoMin = kfVals.length ? Math.min(...kfVals) : 0;
    const autoMax = kfVals.length ? Math.max(...kfVals) : 1;
    const baseMin = pd?.min ?? (autoMin === autoMax ? autoMin - 1 : autoMin);
    const baseMax = pd?.max ?? (autoMin === autoMax ? autoMax + 1 : autoMax);
    // A keyframe's value can be typed in directly (below) and land outside
    // the socket's normal slider range — expand the graph to fit it rather
    // than silently clipping the point off the top/bottom of the canvas.
    const valueMin = Math.min(baseMin, autoMin);
    const valueMax = Math.max(baseMax, autoMax);

    const kfParamName = `__keyframes_${target.socketKey}${axis ? `_${axis}` : ''}`;
    const writeKeyframes = (next: Keyframe[]) => updateNodeParams(node.id, { [kfParamName]: next }, { immediate: true });
    const setMode = (m: KeyframeLoopMode) => updateNodeParams(node.id, { [`__kfMode_${target.socketKey}`]: m }, { immediate: true });
    const setLoopBack = (v: number) => updateNodeParams(node.id, { [`__kfLoopBack_${target.socketKey}`]: v }, { immediate: true });

    const selected = kfSelectedIndex != null ? keyframes[kfSelectedIndex] : undefined;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {renderNodeHeader(node)}

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 700, color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {input.label}{axis ? ` · ${axis.toUpperCase()}` : ''}
            </div>
            {keyframes.length > 0 && (
              <button
                onClick={() => writeKeyframes([])}
                style={{ background: 'none', border: '1px solid #f38ba866', color: '#f38ba8', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
              >Clear</button>
            )}
            <button
              onClick={() => setMobileKeyframeEditor(null)}
              style={{ background: 'none', border: '1px solid #45475a', color: '#89b4fa', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
            >Done</button>
          </div>

          {axes && (
            <div style={{ display: 'flex', gap: '6px' }}>
              {axes.map(a => (
                <button key={a} style={smallTabBtnStyle(axis === a)} onClick={() => setMobileKeyframeEditor({ ...target, axis: a })}>
                  {a.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <KeyframeCanvasEditor
            keyframes={keyframes}
            mode={mode}
            loopBack={loopBack}
            offset={offset}
            loopCount={loopCount}
            valueMin={valueMin}
            valueMax={valueMax}
            tool={mobileKeyframeTool}
            onChange={writeKeyframes}
            selectedIndex={kfSelectedIndex}
            onSelect={setKfSelectedIndex}
          />

          {keyframes.length === 0 && (
            <div style={{ fontSize: '11px', color: '#585b70' }}>
              Pick "Add" below, then tap in the canvas to place a keyframe — or "Draw" to sketch a curve freehand.
            </div>
          )}

          {selected && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: '#6c7086' }}>Time</span>
                  <input
                    type="number"
                    step={0.1}
                    value={selected.t}
                    onChange={e => {
                      const n = parseFloat(e.target.value);
                      if (isNaN(n)) return;
                      const moved = { ...selected, t: Math.max(0, n) };
                      const next = keyframes.map((k, i) => i === kfSelectedIndex ? moved : k).sort((a, b) => a.t - b.t);
                      writeKeyframes(next);
                      setKfSelectedIndex(next.indexOf(moved));
                    }}
                    style={{ ...exprTextInputStyle, width: '64px' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: '#6c7086' }}>Value</span>
                  <input
                    type="number"
                    step={pd?.step ?? 0.01}
                    value={selected.v}
                    onChange={e => {
                      const n = parseFloat(e.target.value);
                      if (isNaN(n)) return;
                      writeKeyframes(keyframes.map((k, i) => i === kfSelectedIndex ? { ...k, v: n } : k));
                    }}
                    style={{ ...exprTextInputStyle, width: '72px' }}
                  />
                </div>
              </div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>
                EASING (this keyframe → next)
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {Object.entries(EASING_PRESETS).map(([name, ease]) => {
                  const isActive = selected.ease.a === ease.a && selected.ease.b === ease.b && selected.ease.c === ease.c && selected.ease.d === ease.d;
                  return (
                    <button
                      key={name}
                      style={smallTabBtnStyle(isActive)}
                      onClick={() => writeKeyframes(keyframes.map((k, i) => i === kfSelectedIndex ? { ...k, ease } : k))}
                    >{name}</button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>PLAYBACK</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['once', 'loop', 'interpolate'] as const).map(m => (
                <button key={m} style={smallTabBtnStyle(mode === m)} onClick={() => setMode(m)}>{m}</button>
              ))}
            </div>
            {mode === 'interpolate' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                <span style={{ fontSize: '11px', color: '#6c7086' }}>Loop back over</span>
                <input
                  type="number" min={0.01} step={0.1} value={loopBack}
                  onChange={e => setLoopBack(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                  style={{ ...exprTextInputStyle, width: '64px' }}
                />
                <span style={{ fontSize: '11px', color: '#6c7086' }}>sec</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Socket-wiring overlays shared by every node detail view (generic and
  // Expr Block alike) — the "feed this input / consume this output" action
  // sheet, the "Add New Node" search palette, and the tap-to-connect graph
  // picker. Each is keyed off `pending`/`connectPicker.nodeId === node.id`.
  function renderSocketOverlays(node: GraphNode) {
    return (
      <>
        {/* Add New / Connect Existing action sheet */}
        {pending && pending.nodeId === node.id && (
          <div
            onClick={() => setPending(null)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40, display: 'flex', alignItems: 'flex-end' }}
          >
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: '#1e1e2e', borderRadius: '16px 16px 0 0', border: '1px solid #45475a', padding: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#89b4fa', marginBottom: '12px' }}>
                {pending.dir === 'input' ? 'Feed this input' : 'Consume this output'}
              </div>
              <button
                style={{ width: '100%', padding: '12px', marginBottom: '8px', background: '#313244', border: '1px solid #45475a', borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation' }}
                onClick={() => { setConnectPicker(pending); setPending(null); }}
              >
                Connect Existing Node
              </button>
              <button
                style={{ width: '100%', padding: '12px', background: '#313244', border: '1px solid #45475a', borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation' }}
                onClick={() => {
                  const socket = pending;
                  setPending({ ...socket, key: `__search__${socket.key}` });
                }}
              >
                Add New Node
              </button>
            </div>
          </div>
        )}

        {/* NodeSearchPalette for "Add New Node" */}
        {pending && pending.nodeId === node.id && pending.key.startsWith('__search__') && (
          <NodeSearchPalette
            open
            onClose={() => setPending(null)}
            filterOutputType={pending.dir === 'input' ? pending.type : undefined}
            filterInputType={pending.dir === 'output' ? pending.type : undefined}
            onNodePlaced={(newId) => {
              const socket = { ...pending, key: pending.key.replace('__search__', '') } as PendingSocket;
              if (socket.dir === 'input') handleNodePlacedForInput(newId, socket as Extract<PendingSocket, { dir: 'input' }>);
              else handleNodePlacedForOutput(newId, socket as Extract<PendingSocket, { dir: 'output' }>);
              setPending(null);
            }}
          />
        )}

        {/* Connect Existing picker — the graph diagram with the current node
            highlighted; tap any highlighted (compatible) node to wire it up. */}
        {connectPicker && connectPicker.nodeId === node.id && (
          <div style={{ position: 'absolute', inset: 0, background: '#181825', zIndex: 40, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#89b4fa' }}>Tap a node to connect</div>
                {connectCandidates.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#585b70', marginTop: '2px' }}>No compatible nodes yet — try "Add New Node" instead.</div>
                )}
              </div>
              <button
                onClick={() => setConnectPicker(null)}
                style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '18px', lineHeight: 1, cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
                title="Cancel"
              >✕</button>
            </div>
            {renderConnectGraphPicker()}
          </div>
        )}
      </>
    );
  }

  // ── Expr Block detail view ───────────────────────────────────────────────
  // Two modes instead of the generic input/output list: "Inputs" (add/remove
  // inputs and wire them — no inline sliders, connections only) and "Output"
  // (the GLSL line editor, reorderable, plus the result expression and the
  // node's single `result` output socket). A freshly-added block opens on
  // Inputs, matching how you'd build one up: declare what feeds in, then
  // write the code that uses it.
  function renderExprBlockDetail(node: GraphNode) {
    const customInputs = (node.params.inputs as ExprInputDef[] | undefined) ?? [];
    const lines = (node.params.lines as ExprLine[] | undefined) ?? [];
    const result = (node.params.result as string | undefined) ?? 'p';
    const outputType = (node.params.outputType as DataType | undefined) ?? 'float';
    const outSocket = node.outputs.result;
    const outType: DataType = outSocket?.type ?? outputType;
    const consumers = downstreamConsumers(node.id, 'result');

    const setInputs = (next: ExprInputDef[]) => {
      updateNodeParams(node.id, { inputs: next });
      updateNodeSockets(node.id, next, outputType);
    };
    const addInput = () => setInputs([...customInputs, { name: `in${customInputs.length}`, type: 'float', slider: null }]);
    const removeInput = (idx: number) => setInputs(customInputs.filter((_, i) => i !== idx));
    const renameInput = (idx: number, name: string) => setInputs(customInputs.map((c, i) => i === idx ? { ...c, name } : c));
    const retypeInput = (idx: number, type: DataType) => setInputs(customInputs.map((c, i) => i === idx ? { ...c, type } : c));
    const changeOutputType = (type: DataType) => {
      updateNodeParams(node.id, { outputType: type });
      updateNodeSockets(node.id, customInputs, type);
    };

    const addLine = () => updateNodeParams(node.id, { lines: [...lines, { lhs: 'p', op: '=', rhs: '' }] });
    const removeLine = (idx: number) => updateNodeParams(node.id, { lines: lines.filter((_, i) => i !== idx) });
    const updateLine = (idx: number, field: keyof ExprLine, value: string) =>
      updateNodeParams(node.id, { lines: lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) });
    const setLines = (next: ExprLine[]) => updateNodeParams(node.id, { lines: next });
    const updateResult = (value: string) => updateNodeParams(node.id, { result: value });

    return (
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {renderNodeHeader(node)}

        <div style={{ display: 'flex', gap: '6px', padding: '8px 12px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
          {(['inputs', 'output'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setExprMode(mode)}
              style={{
                flex: 1, padding: '8px', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                background: exprMode === mode ? '#313244' : 'none',
                border: exprMode === mode ? '1px solid #89b4fa' : '1px solid #45475a',
                color: exprMode === mode ? '#89b4fa' : '#6c7086',
                cursor: 'pointer', touchAction: 'manipulation',
              }}
            >
              {mode === 'inputs' ? 'Inputs' : 'Output'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {exprMode === 'inputs' ? (
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {customInputs.length === 0 && (
                <div style={{ fontSize: '12px', color: '#585b70' }}>No inputs yet — add one below.</div>
              )}
              {customInputs.map((inp, idx) => {
                const socket = node.inputs[inp.name];
                const upstream = socket?.connection ? nodes.find(n => n.id === socket.connection!.nodeId) : undefined;
                return (
                  <div
                    key={idx}
                    onFocus={() => setFocusedInputIdx(idx)}
                    onBlur={() => setFocusedInputIdx(null)}
                    style={exprCardStyle(focusedInputIdx === idx)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={dotStyle(TYPE_COLORS[inp.type] ?? '#888')} />
                      <input
                        type="text"
                        value={inp.name}
                        onChange={e => renameInput(idx, e.target.value)}
                        placeholder="name"
                        style={{ ...exprTextInputStyle, width: '92px', flexShrink: 0 }}
                      />
                      <select value={inp.type} onChange={e => retypeInput(idx, e.target.value as DataType)} style={exprSelectStyle}>
                        {EXPR_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' }}>
                        {!upstream && (
                          <button style={smallIconBtnStyle('#89b4fa')} title="Wire this input" onClick={() => setPending({ dir: 'input', nodeId: node.id, key: inp.name, type: inp.type })}>+</button>
                        )}
                        <button style={smallIconBtnStyle('#f38ba8')} title="Remove input" onClick={() => removeInput(idx)}>✕</button>
                      </div>
                    </div>
                    {upstream && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '18px' }}>
                        <button style={chipStyle} onClick={() => pushFocus(upstream.id)}>{labelFor(upstream)} ›</button>
                        <button
                          onClick={() => disconnectInput(node.id, inp.name)}
                          style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '14px', cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
                          title="Disconnect"
                        >✕</button>
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                onClick={addInput}
                style={{ alignSelf: 'flex-start', background: '#a6e3a111', border: '1px solid #a6e3a133', color: '#a6e3a1', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation' }}
              >
                + Add Input
              </button>
            </div>
          ) : (
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>OUTPUT TYPE</div>
                <select value={outputType} onChange={e => changeOutputType(e.target.value as DataType)} style={{ ...exprSelectStyle, width: '100%' }}>
                  {EXPR_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>LINES</div>
                {lines.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#45475a', fontFamily: 'monospace', marginBottom: '8px' }}>No lines yet.</div>
                )}
                <ExprLinesList lines={lines} onReorder={setLines} onUpdateLine={updateLine} onRemoveLine={removeLine} variables={customInputs.map(i => i.name)} />
                <button
                  onClick={addLine}
                  style={{ marginTop: '8px', background: '#a6e3a111', border: '1px solid #a6e3a133', color: '#a6e3a1', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation' }}
                >
                  + Add Line
                </button>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>RESULT</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#6c7086', fontFamily: 'monospace' }}>return</span>
                  <GlslExprInput value={result} onChange={updateResult} placeholder="p" style={{ ...exprTextInputStyle, flex: 1, color: '#89b4fa' }} variables={customInputs.map(i => i.name)} />
                </div>
              </div>

              <div style={{ borderTop: '1px solid #313244', paddingTop: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>OUTPUT</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={dotStyle(TYPE_COLORS[outType] ?? '#888')} />
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: '#cdd6f4' }}>Result</div>
                    <div style={{ fontSize: '10px', color: '#585b70' }}>{outType}</div>
                  </div>
                  <button style={addBtnStyle} title="Add a consumer for this output" onClick={() => setPending({ dir: 'output', nodeId: node.id, key: 'result', type: outType })}>+</button>
                  {consumers.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', width: '100%', paddingLeft: '18px' }}>
                      {consumers.map(c => (
                        <button key={c.id} style={chipStyle} onClick={() => pushFocus(c.id)}>{labelFor(c)} ›</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {renderSocketOverlays(node)}
      </div>
    );
  }

  // ── Connect-existing graph picker ────────────────────────────────────────
  // Same node positions as the Home graph view, but every node is shown (not
  // just candidates) so the current node's highlight makes sense in context;
  // compatible nodes are tappable and outlined, everything else is dimmed.
  function renderConnectGraphPicker() {
    if (!connectPicker) return null;
    const layout = computeGraphLayout(nodes, rankedRows);
    const candidateIds = new Set(connectCandidates.map(c => c.id));
    return (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
            <GraphEdges edges={layout.edges} />
          </svg>
          {nodes.map(n => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const isCurrent = n.id === connectPicker.nodeId;
            const isCandidate = candidateIds.has(n.id);
            return (
              <button
                key={n.id}
                disabled={!isCandidate}
                onClick={() => commitConnectExisting(n.id)}
                style={{
                  position: 'absolute', left: p.x, top: p.y, width: GRAPH_NODE_W, height: GRAPH_NODE_H,
                  display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden',
                  background: isCurrent ? '#313244' : '#1e1e2e',
                  border: isCurrent ? '2px solid #89b4fa' : isCandidate ? '1px solid #a6e3a1' : '1px solid #313244',
                  borderRadius: '6px', padding: '0 8px', fontSize: '11px',
                  color: isCandidate || isCurrent ? '#cdd6f4' : '#45475a',
                  opacity: isCandidate || isCurrent ? 1 : 0.4,
                  cursor: isCandidate ? 'pointer' : 'default', touchAction: 'manipulation',
                }}
              >
                <div style={dotStyle(nodeDotColor(n))} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(n)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Graph navigator overlay ───────────────────────────────────────────────
  // Reachable from the breadcrumb's "⋈ Graph" button while inside any node
  // (not just Home) — same diagram as the Home graph view, but the currently
  // focused node is highlighted, and tapping any node teleports straight to
  // it (resets the drill-down stack to just that node) rather than requiring
  // you to walk back up through Home first.
  function renderGraphNavigatorOverlay() {
    if (!showGraphOverlay) return null;
    const layout = computeGraphLayout(nodes, rankedRows);
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#181825', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: '#89b4fa' }}>Tap a node to jump there</div>
          <button
            onClick={() => setShowGraphOverlay(false)}
            style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '18px', lineHeight: 1, cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
            title="Close"
          >✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
            <svg width={layout.width} height={layout.height} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
              <GraphEdges edges={layout.edges} />
            </svg>
            {nodes.map(n => {
              const p = layout.pos.get(n.id);
              if (!p) return null;
              const isCurrent = n.id === focusedId;
              return (
                <button
                  key={n.id}
                  onClick={() => { setFocusStack([n.id]); setShowGraphOverlay(false); }}
                  style={{
                    position: 'absolute', left: p.x, top: p.y, width: GRAPH_NODE_W, height: GRAPH_NODE_H,
                    display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden',
                    background: isCurrent ? '#313244' : '#1e1e2e',
                    border: isCurrent ? '2px solid #89b4fa' : '1px solid #313244',
                    borderRadius: '6px', padding: '0 8px', fontSize: '11px', color: '#cdd6f4',
                    cursor: 'pointer', touchAction: 'manipulation',
                  }}
                >
                  <div style={dotStyle(nodeDotColor(n))} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(n)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Home view: graph-shape grid ──────────────────────────────────────────
  // Rows = rank (left-to-right depth in the node editor, top-to-bottom
  // here); cells within a row = sibling nodes at that same depth. Same
  // ranking the desktop "Auto Layout" button uses, so this grid always
  // matches that arrangement.
  function renderHome() {
    if (nodes.length === 0) {
      return <div style={{ flex: 1, padding: '16px 12px', fontSize: '12px', color: '#585b70' }}>No nodes yet.</div>;
    }
    return (
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {rankedRows.map(({ rank, nodes: rowNodes }) => (
          <div key={rank} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 12px', borderBottom: '1px solid #24243a' }}>
            <div style={{ width: '14px', flexShrink: 0, fontSize: '10px', color: '#45475a', paddingTop: '9px', textAlign: 'right' }}>{rank}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
              {rowNodes.map(n => (
                <button
                  key={n.id}
                  onClick={() => pushFocus(n.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px',
                    padding: '8px 10px', fontSize: '12px', color: '#cdd6f4', cursor: 'pointer', touchAction: 'manipulation',
                  }}
                >
                  <div style={dotStyle(nodeDotColor(n))} />
                  {labelFor(n)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Home view: graph diagram ─────────────────────────────────────────────
  // Same rank/row data as the grid above, laid out as fixed-position chips
  // with actual connector lines drawn between them — a read-only "see the
  // flow" view, not a spatial editor (tap a chip to drill in, same as the
  // grid; no dragging). Source rank is always strictly less than target rank
  // (that's what the BFS rank assignment guarantees), so every edge flows
  // top-to-bottom or skips rows entirely — never sideways or backwards.
  function renderHomeGraph() {
    if (nodes.length === 0) {
      return <div style={{ flex: 1, padding: '16px 12px', fontSize: '12px', color: '#585b70' }}>No nodes yet.</div>;
    }
    const layout = computeGraphLayout(nodes, rankedRows);
    return (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
            <GraphEdges edges={layout.edges} />
          </svg>
          {nodes.map(n => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            return (
              <button
                key={n.id}
                onClick={() => pushFocus(n.id)}
                style={{
                  position: 'absolute', left: p.x, top: p.y, width: GRAPH_NODE_W, height: GRAPH_NODE_H,
                  display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden',
                  background: '#1e1e2e', border: '1px solid #313244', borderRadius: '6px',
                  padding: '0 8px', fontSize: '11px', color: '#cdd6f4', cursor: 'pointer', touchAction: 'manipulation',
                }}
              >
                <div style={dotStyle(nodeDotColor(n))} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(n)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: '#181825', color: '#cdd6f4', fontFamily: 'system-ui, sans-serif' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px', borderBottom: '1px solid #313244', overflowX: 'auto', flexShrink: 0 }}>
        <button onClick={goHome} style={{ background: 'none', border: 'none', color: focusStack.length === 0 ? '#89b4fa' : '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}>
          Home
        </button>
        {focusStack.map((id, i) => {
          const n = nodes.find(nn => nn.id === id);
          if (!n) return null;
          return (
            <span key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <span style={{ color: '#585b70', fontSize: '12px' }}>›</span>
              <button
                onClick={() => jumpTo(i)}
                style={{ background: 'none', border: 'none', color: i === focusStack.length - 1 ? '#89b4fa' : '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}
              >
                {labelFor(n)}
              </button>
            </span>
          );
        })}
        {/* Redo path — where you'd land if you kept tapping ›. Dimmed since
            it's not where you are, but still tappable to fast-forward back
            onto it (any OTHER navigation clears this, same as goForward). */}
        {forwardStack.map((id, i) => {
          const n = nodes.find(nn => nn.id === id);
          if (!n) return null;
          return (
            <span key={`fwd-${id}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, opacity: 0.4 }}>
              <span style={{ color: '#585b70', fontSize: '12px' }}>›</span>
              <button
                onClick={() => goForwardTo(i)}
                style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}
                title="Go forward to here"
              >
                {labelFor(n)}
              </button>
            </span>
          );
        })}
        <button
          onClick={() => (focusedNode ? setShowGraphOverlay(true) : setHomeGraphView(v => !v))}
          style={{
            marginLeft: 'auto', flexShrink: 0,
            background: !focusedNode && homeGraphView ? '#313244' : 'none', border: '1px solid #45475a', color: '#89b4fa',
            borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation',
          }}
          title="See the flow as a connected graph"
        >
          {!focusedNode && homeGraphView ? '☰ List' : '⋈ Graph'}
        </button>
      </div>

      {focusedNode
        ? (mobileKeyframeEditor && mobileKeyframeEditor.nodeId === focusedNode.id
            ? renderKeyframeEditorView(focusedNode)
            : (focusedNode.type === 'exprNode' ? renderExprBlockDetail(focusedNode) : renderNodeDetail(focusedNode)))
        : (homeGraphView ? renderHomeGraph() : renderHome())}

      {renderGraphNavigatorOverlay()}
    </div>
  );
}
