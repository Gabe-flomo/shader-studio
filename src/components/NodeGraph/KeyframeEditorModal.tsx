import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useNodeGraphStore, saveKeyframePreset, loadKeyframePresets } from '../../store/useNodeGraphStore';
import type { KeyframePreset } from '../../types/keyframePreset';
import type { GraphNode } from '../../types/nodeGraph';
import { EASING_PRESETS, isKeyframeBypassed, VECTOR_AXES, type Keyframe, type KeyframeLoopMode } from '../../compiler/keyframes';
import { getNodeDefinition } from '../../nodes/definitions';
import { NumberInput } from './NumberInput';
import { useCtp } from '../../theme/nodePalette';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Modal } from '../ui/Modal';
import { RulerSlider } from '../ui/RulerSlider';

const MAX_KEYFRAMES = 8;
const HANDLE_R = 6;
const KF_R = 6;
const HIT_R = 9;

type ToolMode = 'select' | 'add' | 'delete' | 'draw';
const TOOL_MODES: { id: ToolMode; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'add', label: 'Add', key: 'C' },
  { id: 'delete', label: 'Delete', key: 'X' },
  { id: 'draw', label: 'Draw', key: 'D' },
];

const FLOAT_AXIS: readonly string[] = ['']; // stable reference — a fresh [''] literal every render would churn useMemo deps below

// ── Data read/write helpers ──────────────────────────────────────────────────
// `storageKey` is the socket key for a plain float socket, or `${socketKey}_x`
// / `_y` / `_z` for one axis of a vec2/vec3 socket — see VECTOR_AXES.

function readKeyframes(node: GraphNode, storageKey: string): Keyframe[] {
  const raw = node.params[`__keyframes_${storageKey}`];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((k): k is Keyframe => k && typeof k === 'object' && typeof (k as Keyframe).t === 'number' && typeof (k as Keyframe).v === 'number')
    .map(k => ({ t: k.t, v: k.v, ease: k.ease ?? EASING_PRESETS.ease }))
    .sort((a, b) => a.t - b.t);
}
function readMode(node: GraphNode, socketKey: string): KeyframeLoopMode {
  const raw = node.params[`__kfMode_${socketKey}`];
  return raw === 'loop' || raw === 'interpolate' ? raw : 'once';
}
function readLoopBack(node: GraphNode, socketKey: string): number {
  const raw = node.params[`__kfLoopBack_${socketKey}`];
  return typeof raw === 'number' && raw > 0 ? raw : 1.0;
}
function readOffset(node: GraphNode, socketKey: string): number {
  const raw = node.params[`__kfOffset_${socketKey}`];
  return typeof raw === 'number' ? raw : 0;
}
function readLoopCount(node: GraphNode, socketKey: string): number | null {
  const raw = node.params[`__kfLoopCount_${socketKey}`];
  return typeof raw === 'number' && raw > 0 ? raw : null;
}

// Mirrors kfCubicBezier in src/compiler/keyframes.ts.
function evalCubicBezier(a: number, b: number, c: number, d: number) {
  const A = 1 - 3 * c + 3 * a, B = 3 * c - 6 * a, C = 3 * a;
  const E = 1 - 3 * d + 3 * b, F = 3 * d - 6 * b, G = 3 * b;
  return (x: number): number => {
    let t = Math.max(0, Math.min(1, x));
    for (let i = 0; i < 6; i++) {
      const cx = A * t * t * t + B * t * t + C * t;
      const sl = 1 / Math.max(1e-6, 3 * A * t * t + 2 * B * t + C);
      t -= (cx - x) * sl;
      t = Math.max(0, Math.min(1, t));
    }
    return E * t * t * t + F * t * t + G * t;
  };
}

interface Segment { start: number; end: number; v0: number; v1: number; ease: Keyframe['ease']; kfIndex: number }

/** Every segment the curve is made of, including the synthetic loop-back
 *  segment in 'interpolate' mode. kfIndex is the keyframe that "owns" this
 *  segment's easing (its "ease out to next"), used for selection-driven handle editing. */
// NOTE: uses each keyframe's absolute .t directly — no shifting relative to
// the first keyframe. That "start playback at global time 0" behavior is a
// GLSL-runtime-only concern (see generateKeyframeGLSL in compiler/keyframes.ts);
// the editor always draws/hit-tests/stores literal clicked-at time values, so
// what you see is exactly where clicks land — mixing the two conventions here
// was the bug that made keyframes render away from where they were clicked.
function buildSegments(keyframes: Keyframe[], mode: KeyframeLoopMode, loopBack: number): Segment[] {
  if (keyframes.length < 2) return [];
  const segs: Segment[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    segs.push({ start: keyframes[i].t, end: keyframes[i + 1].t, v0: keyframes[i].v, v1: keyframes[i + 1].v, ease: keyframes[i].ease, kfIndex: i });
  }
  if (mode === 'interpolate') {
    const last = keyframes[keyframes.length - 1];
    segs.push({ start: last.t, end: last.t + loopBack, v0: last.v, v1: keyframes[0].v, ease: last.ease, kfIndex: keyframes.length - 1 });
  }
  return segs;
}

function evalCurveAt(keyframes: Keyframe[], mode: KeyframeLoopMode, loopBack: number, tRaw: number): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].v;
  const t0 = keyframes[0].t;
  const duration = Math.max(keyframes[keyframes.length - 1].t - t0, 0.0001);
  const loopSpan = mode === 'interpolate' ? duration + loopBack : duration;
  const lt = mode === 'once' ? Math.max(t0, Math.min(tRaw, t0 + duration)) : (((tRaw - t0) % loopSpan + loopSpan) % loopSpan) + t0;
  const segs = buildSegments(keyframes, mode, loopBack);
  for (const seg of segs) {
    if (lt < seg.end || seg === segs[segs.length - 1]) {
      const st = Math.max(0, Math.min(1, (lt - seg.start) / Math.max(seg.end - seg.start, 0.0001)));
      const fn = evalCubicBezier(seg.ease.a, seg.ease.b, seg.ease.c, seg.ease.d);
      return seg.v0 + (seg.v1 - seg.v0) * fn(st);
    }
  }
  return segs[segs.length - 1].v1;
}

function snapVal(v: number, step: number, enabled: boolean): number {
  if (!enabled || step <= 0) return v;
  return Math.round(v / step) * step;
}
function fmt(v: number): string { return Math.round(v * 100) / 100 + ''; }

/**
 * Serum-style freehand draw: reduces a raw, continuously-recorded mouse path
 * down to at most maxPoints keyframes, evenly spaced in time across the
 * path's span, taking each one's value by linearly interpolating the
 * recorded path at that time. Linear easing between them keeps the result
 * close to the literal drawn shape rather than warping it with a curve.
 * Assumes path is already sorted by ascending t (drawPathRef is built that
 * way — see handleMouseMove's 'draw' branch).
 */
function downsamplePath(path: { t: number; v: number }[], maxPoints: number): Keyframe[] {
  if (path.length === 0) return [];
  const tMin = path[0].t, tMax = path[path.length - 1].t;
  if (tMax - tMin < 1e-6) {
    return [{ t: Math.max(0, tMin), v: path[path.length - 1].v, ease: EASING_PRESETS.linear }];
  }
  const n = Math.min(maxPoints, path.length);
  const result: Keyframe[] = [];
  for (let i = 0; i < n; i++) {
    const targetT = tMin + (i / (n - 1)) * (tMax - tMin);
    let v = path[path.length - 1].v;
    for (let j = 0; j < path.length - 1; j++) {
      if (path[j].t <= targetT && path[j + 1].t >= targetT) {
        const span = path[j + 1].t - path[j].t;
        const frac = span > 1e-9 ? (targetT - path[j].t) / span : 0;
        v = path[j].v + (path[j + 1].v - path[j].v) * frac;
        break;
      }
    }
    result.push({ t: Math.max(0, targetT), v, ease: EASING_PRESETS.linear });
  }
  return result;
}

// ── View / drag state ────────────────────────────────────────────────────────

interface ViewState {
  viewT0: number;     // time at the left edge of the canvas
  valueCenter: number; // value at the vertical center
  pxPerSec: number;
  pxPerUnit: number;
  gridT: number;
  gridV: number;
  snap: boolean;
}

type DragState =
  | { kind: 'pan'; startX: number; startY: number; startViewT0: number; startValueCenter: number; moved: boolean }
  | { kind: 'keyframe'; index: number; moved: boolean; startX: number; startY: number }
  | { kind: 'handle'; segIndex: number; which: 'p1' | 'p2' }
  | { kind: 'draw'; moved: boolean }
  | { kind: 'scrub' };

interface OtherAxisTrack { label: string; color: string; keyframes: Keyframe[] }

/** Colours for the graph canvas, from the app theme. */
interface KfPalette {
  bg: string; grid: string; axis: string; label: string; ghost: string; playhead: string;
  handleIn: string; handleOut: string; ring: string; readoutBg: string; readoutBorder: string; empty: string;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function draw(
  canvas: HTMLCanvasElement,
  keyframes: Keyframe[],
  mode: KeyframeLoopMode,
  loopBack: number,
  view: ViewState,
  easeEditSeg: number | null,
  hoverKf: number | null,
  selectedKf: number | null,
  activeColor: string,
  otherAxes: OtherAxisTrack[],
  hoverInfo: { t: number; v: number } | null,
  drawPreview: { t: number; v: number }[] | null,
  playheadT: number | null,
  pal: KfPalette,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const { viewT0, valueCenter, pxPerSec, pxPerUnit, gridT, gridV } = view;

  const toX = (t: number) => (t - viewT0) * pxPerSec;
  const toY = (v: number) => H / 2 - (v - valueCenter) * pxPerUnit;
  const fromY = (py: number) => valueCenter - (py - H / 2) / pxPerUnit;

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  // grid, with small tick labels so you can read off where you are in the
  // timeline/value range without needing a live hover.
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, Menlo, monospace';
  const tStart = Math.floor(viewT0 / gridT) * gridT;
  const tEnd = viewT0 + W / pxPerSec;
  for (let t = tStart; t <= tEnd; t += gridT) {
    const x = toX(t);
    ctx.strokeStyle = pal.grid;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillStyle = pal.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fmt(t), x + 3, H - 4);
  }
  const vTop = fromY(0), vBot = fromY(H);
  const vStart = Math.floor(Math.min(vTop, vBot) / gridV) * gridV;
  const vEnd = Math.max(vTop, vBot);
  for (let v = vStart; v <= vEnd; v += gridV) {
    const y = toY(v);
    ctx.strokeStyle = pal.grid;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = pal.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fmt(v), 3, y - 3);
  }

  // axes (t=0, v=0) — brighter
  ctx.strokeStyle = pal.axis;
  ctx.lineWidth = 1.5;
  if (viewT0 <= 0.0001) {
    const x0 = toX(0);
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, H); ctx.stroke();
  }
  const y0 = toY(0);
  if (y0 >= 0 && y0 <= H) {
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
  }

  // Reference curves for the other axes of a vec2/vec3 socket — thin, dimmed,
  // no markers, purely for visual context while editing the active axis.
  const steps = Math.max(2, Math.round(W / 3));
  for (const other of otherAxes) {
    if (other.keyframes.length === 0) continue;
    ctx.strokeStyle = other.color + '55';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    const oFirstT = other.keyframes[0].t, oLastT = other.keyframes[other.keyframes.length - 1].t;
    for (let i = 0; i <= steps; i++) {
      const t = oFirstT + (i / steps) * (oLastT - oFirstT);
      const v = evalCurveAt(other.keyframes, mode, loopBack, t);
      const cx = toX(t), cy = toY(v);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Live freehand-draw preview — the raw recorded path, before it gets
  // downsampled to keyframes on mouseup.
  if (drawPreview && drawPreview.length > 1) {
    ctx.strokeStyle = pal.ghost;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    drawPreview.forEach((p, i) => {
      const cx = toX(p.t), cy = toY(p.v);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
  }

  if (keyframes.length === 0 && !drawPreview) {
    ctx.fillStyle = pal.empty;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Add mode (C) or Draw (D), then click the graph to place keys', 14, 24);
    return;
  }
  if (keyframes.length === 0) return;

  const segs = buildSegments(keyframes, mode, loopBack);
  const firstT = keyframes[0].t;
  const lastT = keyframes[keyframes.length - 1].t;

  // curve — drawn (and evaluated) entirely in absolute time, same as the
  // keyframe markers below, so the line always passes exactly through them.
  if (segs.length > 0) {
    ctx.lineWidth = 2;
    const drawRange = (fromT: number, toT: number, dashed: boolean) => {
      ctx.strokeStyle = dashed ? pal.ghost : activeColor;
      if (dashed) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = fromT + (i / steps) * (toT - fromT);
        const v = evalCurveAt(keyframes, mode, loopBack, t);
        const cx = toX(t), cy = toY(v);
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    drawRange(firstT, lastT, false);
    if (mode === 'interpolate') drawRange(lastT, lastT + loopBack, true);
  } else {
    // single keyframe: flat line at its value
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, toY(keyframes[0].v)); ctx.lineTo(W, toY(keyframes[0].v)); ctx.stroke();
  }

  // bezier handles for the selected keyframe's outgoing segment
  if (easeEditSeg !== null && segs[easeEditSeg]) {
    const seg = segs[easeEditSeg];
    const segToX = (localT: number) => toX(seg.start + localT * (seg.end - seg.start));
    const segToY = (localV01: number) => toY(seg.v0 + localV01 * (seg.v1 - seg.v0));
    const p0x = segToX(0), p0y = segToY(0), p3x = segToX(1), p3y = segToY(1);
    const p1x = segToX(seg.ease.a), p1y = segToY(seg.ease.b);
    const p2x = segToX(seg.ease.c), p2y = segToY(seg.ease.d);
    ctx.strokeStyle = `${pal.handleIn}88`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.stroke();
    ctx.strokeStyle = `${pal.handleOut}88`;
    ctx.beginPath(); ctx.moveTo(p3x, p3y); ctx.lineTo(p2x, p2y); ctx.stroke();
    [[p1x, p1y, pal.handleIn], [p2x, p2y, pal.handleOut]].forEach(([hx, hy, color]) => {
      ctx.fillStyle = color as string;
      ctx.strokeStyle = pal.bg; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx as number, hy as number, HANDLE_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }

  // keyframe markers
  keyframes.forEach((k, i) => {
    const cx = toX(k.t), cy = toY(k.v);
    const isHover = hoverKf === i;
    const isSelected = selectedKf === i;
    ctx.fillStyle = activeColor;
    ctx.strokeStyle = pal.bg;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, isHover ? KF_R + 1.5 : KF_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (isSelected) {
      ctx.strokeStyle = pal.ring;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, KF_R + 4, 0, Math.PI * 2); ctx.stroke();
    }
  });

  // Playhead — where global time (minus this track's offset) currently sits,
  // kept live via the 'time-tick' broadcast from ShaderCanvas. Drawn on top
  // of everything else so it's always visible.
  if (playheadT !== null) {
    const px = toX(playheadT);
    if (px >= -2 && px <= W + 2) {
      ctx.strokeStyle = pal.playhead;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      ctx.fillStyle = pal.playhead;
      ctx.beginPath();
      ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8); ctx.closePath();
      ctx.fill();
    }
  }

  // Floating t/v readout above whichever point is live right now — the
  // hovered one, or the one currently being dragged (hoverInfo tracks
  // both cases; see handleMouseMove).
  if (hoverInfo) {
    const hx = toX(hoverInfo.t), hy = toY(hoverInfo.v);
    const label = `t=${fmt(hoverInfo.t)}  v=${fmt(hoverInfo.v)}`;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    const textW = ctx.measureText(label).width;
    const padX = 7, boxH = 20;
    const boxW = textW + padX * 2;
    const boxX = Math.max(2, Math.min(W - boxW - 2, hx - boxW / 2));
    const boxY = Math.max(2, hy - KF_R - boxH - 8);
    ctx.fillStyle = pal.readoutBg;
    ctx.strokeStyle = pal.readoutBorder;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(boxX, boxY, boxW, boxH); ctx.fill(); ctx.stroke();
    ctx.fillStyle = activeColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, boxX + padX, boxY + boxH / 2 + 1);
  }
}

// ── KeyframeEditorModal ─────────────────────────────────────────────────────

interface Props { node: GraphNode; socketKey: string; onClose: () => void }

export function KeyframeEditorModal({ node, socketKey, onClose }: Props) {
  const tk = useTokens();
  const tc = useCtp();
  // Per-axis colour, matching the classic X/Y/Z = red/green/blue convention; a float track uses the accent.
  const axisColors = useMemo<Record<string, string>>(() => ({ x: tc.red, y: tc.green, z: tc.blue }), [tc]);
  const defaultAxisColor = tk.accent.base;
  const pal = useMemo<KfPalette>(() => ({
    bg: tk.bg.panel, grid: tk.border.subtle, axis: tk.border.strong, label: tk.text.faint, ghost: tk.status.warning,
    playhead: tk.status.danger, handleIn: tc.red, handleOut: tc.blue, ring: tk.text.primary,
    readoutBg: tk.bg.panel, readoutBorder: tk.border.default, empty: tk.text.muted,
  }), [tk, tc]);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const setTimePlaying = useNodeGraphStore(s => s.setTimePlaying);

  const offset = readOffset(node, socketKey);
  const loopCount = readLoopCount(node, socketKey);
  const setOffset = useCallback((v: number) => updateNodeParams(node.id, { [`__kfOffset_${socketKey}`]: v }), [node.id, socketKey, updateNodeParams]);
  const setLoopCount = useCallback((v: number | null) => updateNodeParams(node.id, { [`__kfLoopCount_${socketKey}`]: v }), [node.id, socketKey, updateNodeParams]);

  // Jump the render preview to a specific moment and pause there — so
  // selecting/dragging/placing a keyframe shows exactly what it produces,
  // instead of the live time immediately drifting past it. `editorT` is in
  // this editor's own time space (what you see on the canvas); offset shifts
  // it into the global time the curve actually plays at.
  //
  // Guarded on the *current* store value (read directly, not subscribed —
  // this fires on every mousemove during a drag and every rAF tick during
  // scoped Play, and an unconditional setTimePlaying(false) would re-dispatch
  // an identical value to Zustand dozens of times a second, cascading a
  // React re-render through every TimeControlsStrip instance each time and
  // showing up as visible frame jank during playback/dragging.
  const seekToTime = useCallback((editorT: number) => {
    if (useNodeGraphStore.getState().timePlaying) setTimePlaying(false);
    window.dispatchEvent(new CustomEvent('seek-time', { detail: { time: editorT + offset } }));
  }, [setTimePlaying, offset]);

  // Live global time, tracked purely for the playhead — a lightweight DOM
  // event (see ShaderCanvas's 'time-tick' dispatch) rather than the store,
  // so this doesn't add a re-render dependency for every other component.
  const [currentGlobalTime, setCurrentGlobalTime] = useState<number | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const t = (e as CustomEvent<{ time: number }>).detail?.time;
      if (typeof t === 'number') setCurrentGlobalTime(t);
    };
    window.addEventListener('time-tick', handler);
    return () => window.removeEventListener('time-tick', handler);
  }, []);
  const playheadT = currentGlobalTime !== null ? currentGlobalTime - offset : null;

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The graph fills the space left in the modal; its drawing buffer follows that size.
  const graphWrapRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ w: 680, h: 440, measured: false });
  useEffect(() => {
    const el = graphWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setGraphSize(prev => (prev.measured && Math.round(width) === prev.w && Math.round(height) === prev.h
        ? prev : { w: Math.round(width), h: Math.round(height), measured: true }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Vector (vec2/vec3) axis support ──
  // A plain float socket has one axis (''), meaning storageKey === socketKey,
  // preserving every existing __keyframes_<socketKey> key exactly as-is.
  const inputType = node.inputs[socketKey]?.type;
  const axisLetters = inputType === 'vec3' ? VECTOR_AXES.vec3 : inputType === 'vec2' ? VECTOR_AXES.vec2 : FLOAT_AXIS;
  const isVector = axisLetters[0] !== '';
  const [activeAxis, setActiveAxis] = useState<string>(axisLetters[0]);
  useEffect(() => { setActiveAxis(axisLetters[0]); }, [socketKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const storageKey = activeAxis ? `${socketKey}_${activeAxis}` : socketKey;
  const activeColor = isVector ? (axisColors[activeAxis] ?? defaultAxisColor) : defaultAxisColor;

  const keyframes = useMemo(() => readKeyframes(node, storageKey), [node, storageKey]);
  const mode = readMode(node, socketKey);
  const loopBack = readLoopBack(node, socketKey);
  const bypassed = isKeyframeBypassed(node, socketKey);
  const keyframesRef = useRef(keyframes);
  keyframesRef.current = keyframes;

  // Other axes' keyframes, drawn as dim reference curves behind the active one.
  const otherAxes = useMemo<OtherAxisTrack[]>(() => {
    if (!isVector) return [];
    return axisLetters
      .filter(a => a !== activeAxis)
      .map(a => ({ label: a.toUpperCase(), color: axisColors[a] ?? defaultAxisColor, keyframes: readKeyframes(node, `${socketKey}_${a}`) }));
  }, [isVector, axisLetters, activeAxis, node, socketKey, axisColors, defaultAxisColor]);

  // Invariant: the earliest keyframe always sits at t=0 — any "start later"
  // intent goes through Offset instead, so there's exactly one way to shift
  // a track in time, not two competing ones (moving keyframe 0 vs. Offset).
  // Enforced here, centrally, for every mutation path (add/drag/delete/draw/
  // load-preset all funnel through writeKeyframes): if the write would leave
  // the first keyframe off zero, shift the whole set back to zero and add
  // that same amount onto Offset instead — so the curve doesn't move at all,
  // only its representation does.
  const writeKeyframes = useCallback((next: Keyframe[]) => {
    const shift = next.length > 0 ? next[0].t : 0;
    if (Math.abs(shift) < 1e-9) {
      updateNodeParams(node.id, { [`__keyframes_${storageKey}`]: next });
    } else {
      updateNodeParams(node.id, {
        [`__keyframes_${storageKey}`]: next.map(k => ({ ...k, t: k.t - shift })),
        [`__kfOffset_${socketKey}`]: offset + shift,
      });
    }
  }, [node.id, storageKey, socketKey, offset, updateNodeParams]);
  // Migrate data saved before this invariant existed (or loaded from an old
  // preset/import) — re-running it through writeKeyframes normalizes it and
  // folds the difference into Offset, exactly like any other write, so a
  // graph someone already had open keeps rendering identically.
  useEffect(() => {
    if (keyframes.length > 0 && Math.abs(keyframes[0].t) > 1e-9) writeKeyframes(keyframes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyframes, storageKey]);

  const setMode = useCallback((m: KeyframeLoopMode) => updateNodeParams(node.id, { [`__kfMode_${socketKey}`]: m }), [node.id, socketKey, updateNodeParams]);
  const setLoopBack = useCallback((v: number) => updateNodeParams(node.id, { [`__kfLoopBack_${socketKey}`]: Math.max(0.01, v) }), [node.id, socketKey, updateNodeParams]);
  const setBypassed = useCallback((b: boolean) => updateNodeParams(node.id, { [`__kfBypass_${socketKey}`]: b }), [node.id, socketKey, updateNodeParams]);
  const copyActiveAxisTo = useCallback((targetAxis: string) => {
    updateNodeParams(node.id, { [`__keyframes_${socketKey}_${targetAxis}`]: keyframesRef.current.map(k => ({ ...k, ease: { ...k.ease } })) });
  }, [node.id, socketKey, updateNodeParams]);

  // ── Saved keyframe presets — save the active axis's curve to the palette's
  // "Saved Keyframes" tab, or apply one back onto this axis. Applying is a
  // window CustomEvent (mirroring reset-time/seek-time) so the sidebar tab
  // can reach whichever editor happens to be open without holding a direct
  // reference to it. ──
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [savePresetName, setSavePresetName] = useState('');
  const handleSavePreset = useCallback((name: string) => {
    if (keyframesRef.current.length === 0) return;
    saveKeyframePreset({
      label: name.trim() || `${socketKey}${isVector ? `.${activeAxis}` : ''}`,
      keyframes: keyframesRef.current.map(k => ({ ...k, ease: { ...k.ease } })),
    });
    setShowSaveInput(false);
    setSavePresetName('');
  }, [socketKey, isVector, activeAxis]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ keyframes: Keyframe[] }>).detail;
      if (!detail?.keyframes) return;
      writeKeyframes(detail.keyframes.slice(0, MAX_KEYFRAMES).map(k => ({ ...k, ease: { ...k.ease } })));
      setSelectedKf(null);
    };
    window.addEventListener('apply-keyframe-preset', handler);
    return () => window.removeEventListener('apply-keyframe-preset', handler);
  }, [writeKeyframes]);

  // Loading a preset right here — not just from the sidebar tab — so you
  // don't have to leave the modal (switch the palette away from whatever
  // it's showing) just to apply a saved curve.
  const [showLoadDropdown, setShowLoadDropdown] = useState(false);
  const [keyframePresets, setKeyframePresets] = useState<KeyframePreset[]>(() => loadKeyframePresets());
  useEffect(() => {
    const refresh = () => setKeyframePresets(loadKeyframePresets());
    window.addEventListener('keyframepreset-changed', refresh);
    return () => window.removeEventListener('keyframepreset-changed', refresh);
  }, []);
  const handleLoadPreset = useCallback((preset: KeyframePreset) => {
    writeKeyframes(preset.keyframes.slice(0, MAX_KEYFRAMES).map(k => ({ ...k, ease: { ...k.ease } })));
    setSelectedKf(null);
    setShowLoadDropdown(false);
  }, [writeKeyframes]);
  const loadDropdownRef = useRef<HTMLDivElement>(null);

  // ── Tool mode (select / add / delete) ──
  const [toolMode, setToolModeState] = useState<ToolMode>('select');
  const toolModeRef = useRef(toolMode);
  toolModeRef.current = toolMode;
  const [selectedKf, setSelectedKf] = useState<number | null>(null);
  const setToolMode = useCallback((m: ToolMode) => {
    setToolModeState(m);
    setSelectedKf(null);
    drawPathRef.current = [];
    setDrawPreview(null);
  }, []);
  const changeAxis = useCallback((a: string) => { setActiveAxis(a); setSelectedKf(null); }, []);

  // Derived: which segment (if any) the current selection's bezier handles belong to.
  const easeEditSeg = useMemo(() => {
    if (selectedKf === null) return null;
    const segs = buildSegments(keyframes, mode, loopBack);
    const idx = segs.findIndex(s => s.kfIndex === selectedKf);
    return idx === -1 ? null : idx;
  }, [selectedKf, keyframes, mode, loopBack]);

  // ── View state ──
  const initialView = useMemo<ViewState>(() => {
    const vals = keyframes.map(k => k.v);
    const vc = vals.length ? (Math.min(...vals) + Math.max(...vals)) / 2 : 0;
    // Smooth (unsnapped) dragging by default — hold Shift to snap to the grid.
    return { viewT0: 0, valueCenter: vc, pxPerSec: 150, pxPerUnit: 40, gridT: 0.5, gridV: 1, snap: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [view, setView] = useState<ViewState>(initialView);
  const viewRef = useRef(view);
  viewRef.current = view;

  const [hoverKf, setHoverKf] = useState<number | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ t: number; v: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const drawPathRef = useRef<{ t: number; v: number }[]>([]);
  const [drawPreview, setDrawPreview] = useState<{ t: number; v: number }[] | null>(null);

  const canvasSizeRef = useRef({ w: 800, h: 420 });

  // Fit the view to show every current keyframe, with some breathing room —
  // mirrors the main node graph's own "Fit" button.
  const centerOnKeyframes = useCallback(() => {
    const kfs = keyframesRef.current;
    if (kfs.length === 0) return;
    const ts = kfs.map(k => k.t), vs = kfs.map(k => k.v);
    const tMin = Math.min(...ts), tMax = Math.max(...ts);
    const vMin = Math.min(...vs), vMax = Math.max(...vs);
    const tPad = Math.max((tMax - tMin) * 0.15, 0.3);
    const vPad = Math.max((vMax - vMin) * 0.25, 0.5);
    const tSpan = Math.max(tMax - tMin + tPad * 2, 0.0001);
    const vSpan = Math.max(vMax - vMin + vPad * 2, 0.0001);
    const newPxPerSec = Math.max(4, Math.min(800, canvasSizeRef.current.w / tSpan));
    const newPxPerUnit = Math.max(4, Math.min(800, canvasSizeRef.current.h / vSpan));
    setView(v => ({ ...v, viewT0: Math.max(0, tMin - tPad), valueCenter: (vMin + vMax) / 2, pxPerSec: newPxPerSec, pxPerUnit: newPxPerUnit }));
  }, []);

  // Open framed on the keys: fit once, after the graph has been measured.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current || !graphSize.measured || keyframesRef.current.length === 0) return;
    canvasSizeRef.current = { w: graphSize.w, h: graphSize.h };
    fittedRef.current = true;
    centerOnKeyframes();
  }, [graphSize, centerOnKeyframes]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) draw(canvas, keyframesRef.current, mode, loopBack, viewRef.current, easeEditSeg, hoverKf, selectedKf, activeColor, otherAxes, hoverInfo, drawPreview, playheadT, pal);
  }, [mode, loopBack, easeEditSeg, hoverKf, selectedKf, activeColor, otherAxes, hoverInfo, drawPreview, playheadT, pal]);

  // `graphSize` is in the deps because it drives the canvas width/height attributes: a canvas
  // clears its drawn content the instant those change, and nothing else would schedule a
  // repaint after a resize.
  useEffect(() => { redraw(); }, [keyframes, view, redraw, graphSize]);

  const getLocalXY = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { px: (e.clientX - rect.left) * (canvas.width / rect.width), py: (e.clientY - rect.top) * (canvas.height / rect.height) };
  }, []);

  const toX = useCallback((t: number) => (t - viewRef.current.viewT0) * viewRef.current.pxPerSec, []);
  const toY = useCallback((v: number) => canvasSizeRef.current.h / 2 - (v - viewRef.current.valueCenter) * viewRef.current.pxPerUnit, []);
  const fromX = useCallback((px: number) => px / viewRef.current.pxPerSec + viewRef.current.viewT0, []);
  const fromY = useCallback((py: number) => viewRef.current.valueCenter - (py - canvasSizeRef.current.h / 2) / viewRef.current.pxPerUnit, []);

  const hitTestKeyframe = useCallback((px: number, py: number): number | null => {
    for (let i = 0; i < keyframesRef.current.length; i++) {
      const k = keyframesRef.current[i];
      const dx = px - toX(k.t), dy = py - toY(k.v);
      if (Math.sqrt(dx * dx + dy * dy) <= HIT_R) return i;
    }
    return null;
  }, [toX, toY]);

  const hitTestHandle = useCallback((px: number, py: number, segIndex: number): 'p1' | 'p2' | null => {
    const segs = buildSegments(keyframesRef.current, mode, loopBack);
    const seg = segs[segIndex];
    if (!seg) return null;
    const segToX = (localT: number) => toX(seg.start + localT * (seg.end - seg.start));
    const segToY = (localV01: number) => toY(seg.v0 + localV01 * (seg.v1 - seg.v0));
    const p1 = { x: segToX(seg.ease.a), y: segToY(seg.ease.b) };
    const p2 = { x: segToX(seg.ease.c), y: segToY(seg.ease.d) };
    if (Math.hypot(px - p1.x, py - p1.y) <= HANDLE_R + 4) return 'p1';
    if (Math.hypot(px - p2.x, py - p2.y) <= HANDLE_R + 4) return 'p2';
    return null;
  }, [mode, loopBack, toX, toY]);

  // effectiveSnap: default is smooth/unsnapped; holding Shift temporarily
  // flips whatever the "Snap to grid" checkbox says (so checking it makes
  // snap the default and Shift becomes the temporary *un*-snap instead).
  const effectiveSnap = useCallback((shiftKey: boolean) => viewRef.current.snap !== shiftKey, []);

  const addKeyframeAt = useCallback((t: number, v: number, shiftKey: boolean) => {
    if (keyframesRef.current.length >= MAX_KEYFRAMES) return;
    const snap = effectiveSnap(shiftKey);
    const snapped = { t: Math.max(0, snapVal(t, viewRef.current.gridT, snap)), v: snapVal(v, viewRef.current.gridV, snap), ease: EASING_PRESETS.ease };
    const sorted = [...keyframesRef.current, snapped].sort((a, b) => a.t - b.t);
    writeKeyframes(sorted);
    setSelectedKf(sorted.indexOf(snapped));
    seekToTime(snapped.t);
  }, [writeKeyframes, effectiveSnap, seekToTime]);

  const removeKeyframeAt = useCallback((index: number) => {
    writeKeyframes(keyframesRef.current.filter((_, i) => i !== index));
    setSelectedKf(null);
  }, [writeKeyframes]);

  // ── Scrubber — a ruler strip above the canvas; dragging it seeks global
  // time live, exactly like an After Effects/video-editor scrubber. ──
  const handleScrubberMouseDown = useCallback((e: React.MouseEvent) => {
    // Without this, a fast drag can get hijacked into the browser's native
    // text-selection/drag-and-drop (it shows its own drag cursor and stops
    // delivering mousemove/mouseup here at all until a fresh click resets
    // the gesture) instead of driving our own drag state.
    e.preventDefault();
    stopKfPlaybackRef.current();
    const xy = getLocalXY(e);
    if (!xy) return;
    dragRef.current = { kind: 'scrub' };
    seekToTime(Math.max(0, fromX(xy.px)));
  }, [getLocalXY, fromX, seekToTime]);

  // ── Scoped "Play" — pressing Play from inside the editor plays *this*
  // track according to its own end behavior (Once/Loop/Interpolate),
  // instead of the global clock running free. Implemented as a local rAF
  // loop that repeatedly calls seekToTime — it never touches the global
  // play/pause flag, so it can't fight the free-running clock. ──
  const [kfPlaying, setKfPlaying] = useState(false);
  const kfPlayRafRef = useRef<number | null>(null);
  const stopKfPlayback = useCallback(() => {
    if (kfPlayRafRef.current != null) cancelAnimationFrame(kfPlayRafRef.current);
    kfPlayRafRef.current = null;
    setKfPlaying(false);
  }, []);
  const stopKfPlaybackRef = useRef(stopKfPlayback);
  stopKfPlaybackRef.current = stopKfPlayback;

  const startKfPlayback = useCallback(() => {
    const kfs = keyframesRef.current;
    if (kfs.length === 0) return;
    if (kfs.length === 1) { seekToTime(kfs[0].t); return; }
    const localT0 = kfs[0].t;
    const duration = Math.max(kfs[kfs.length - 1].t - localT0, 0.0001);
    const loopSpan = mode === 'interpolate' ? duration + loopBack : duration;
    const startWall = performance.now();
    setKfPlaying(true);
    const tick = (now: number) => {
      const elapsed = (now - startWall) / 1000;
      let lt: number, done: boolean;
      if (mode === 'once') {
        lt = Math.min(elapsed, duration);
        done = elapsed >= duration;
      } else if (loopCount != null) {
        const total = loopCount * loopSpan;
        done = elapsed >= total;
        lt = done ? loopSpan : elapsed % loopSpan;
      } else {
        lt = elapsed % loopSpan;
        done = false;
      }
      seekToTime(localT0 + lt);
      if (done) { kfPlayRafRef.current = null; setKfPlaying(false); return; }
      kfPlayRafRef.current = requestAnimationFrame(tick);
    };
    kfPlayRafRef.current = requestAnimationFrame(tick);
  }, [mode, loopBack, loopCount, seekToTime]);

  useEffect(() => () => stopKfPlaybackRef.current(), []);
  // Stop scoped playback if the user switches axis/mode/tool while it's running.
  useEffect(() => { stopKfPlayback(); }, [activeAxis, mode, toolMode, stopKfPlayback]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Same as the scrubber — stop the browser from hijacking a fast drag
    // into native text-selection/drag-and-drop.
    e.preventDefault();
    stopKfPlaybackRef.current();
    const xy = getLocalXY(e);
    if (!xy) return;
    if (toolModeRef.current === 'draw') {
      drawPathRef.current = [{ t: Math.max(0, fromX(xy.px)), v: fromY(xy.py) }];
      dragRef.current = { kind: 'draw', moved: false };
      return;
    }
    if (easeEditSeg !== null) {
      const h = hitTestHandle(xy.px, xy.py, easeEditSeg);
      if (h) { dragRef.current = { kind: 'handle', segIndex: easeEditSeg, which: h }; return; }
    }
    const kfHit = hitTestKeyframe(xy.px, xy.py);
    if (toolModeRef.current === 'delete') {
      if (kfHit !== null) removeKeyframeAt(kfHit);
      return; // delete mode: no drag/pan, deletion happens immediately on the hit
    }
    if (kfHit !== null) {
      dragRef.current = { kind: 'keyframe', index: kfHit, moved: false, startX: xy.px, startY: xy.py };
      return;
    }
    dragRef.current = { kind: 'pan', startX: xy.px, startY: xy.py, startViewT0: viewRef.current.viewT0, startValueCenter: viewRef.current.valueCenter, moved: false };
  }, [getLocalXY, hitTestKeyframe, hitTestHandle, easeEditSeg, removeKeyframeAt, fromX, fromY]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const xy = getLocalXY(e);
    if (!xy) return;
    const drag = dragRef.current;
    if (!drag) {
      const kfHit = hitTestKeyframe(xy.px, xy.py);
      setHoverKf(kfHit);
      if (kfHit !== null) {
        const k = keyframesRef.current[kfHit];
        setHoverInfo({ t: k.t, v: k.v });
      } else setHoverInfo(null);
      return;
    }
    if (drag.kind === 'pan') {
      const dx = xy.px - drag.startX, dy = xy.py - drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      setView(v => ({ ...v, viewT0: Math.max(0, drag.startViewT0 - dx / v.pxPerSec), valueCenter: drag.startValueCenter + dy / v.pxPerUnit }));
    } else if (drag.kind === 'keyframe') {
      // A few pixels of jitter during a click shouldn't turn it into a move
      if (!drag.moved && Math.hypot(xy.px - drag.startX, xy.py - drag.startY) < 3) return;
      drag.moved = true;
      const snap = effectiveSnap(e.shiftKey);
      const newT = Math.max(0, snapVal(fromX(xy.px), viewRef.current.gridT, snap));
      const newV = snapVal(fromY(xy.py), viewRef.current.gridV, snap);
      const next = keyframesRef.current.map((k, i) => (i === drag.index ? { ...k, t: newT, v: newV } : k));
      setHoverInfo({ t: newT, v: newV });
      writeKeyframes(next);
      seekToTime(newT);
    } else if (drag.kind === 'handle') {
      const segs = buildSegments(keyframesRef.current, mode, loopBack);
      const seg = segs[drag.segIndex];
      if (!seg) return;
      const localT = Math.max(-0.5, Math.min(1.5, (fromX(xy.px) - seg.start) / Math.max(seg.end - seg.start, 0.0001)));
      const vRange = seg.v1 - seg.v0;
      const localV = (fromY(xy.py) - seg.v0) / (Math.abs(vRange) > 1e-6 ? vRange : 1);
      const next = keyframesRef.current.map((k, i) => {
        if (i !== seg.kfIndex) return k;
        const ease = { ...k.ease };
        if (drag.which === 'p1') { ease.a = localT; ease.b = localV; } else { ease.c = localT; ease.d = localV; }
        return { ...k, ease };
      });
      writeKeyframes(next);
    } else if (drag.kind === 'draw') {
      drag.moved = true;
      const t = Math.max(0, fromX(xy.px)), v = fromY(xy.py);
      drawPathRef.current = [...drawPathRef.current, { t, v }].sort((a, b) => a.t - b.t);
      setDrawPreview(drawPathRef.current);
      setHoverInfo({ t, v });
    } else if (drag.kind === 'scrub') {
      seekToTime(Math.max(0, fromX(xy.px)));
    }
  }, [getLocalXY, hitTestKeyframe, fromX, fromY, writeKeyframes, mode, loopBack, effectiveSnap, seekToTime]);

  // A plain click on empty canvas (mousedown+mouseup with no drag in between)
  // adds a keyframe there while in 'add' mode, or just deselects in 'select'
  // mode; any real drag (pan/move-keyframe/move-handle) does neither. One
  // consolidated mouseup handler so there's no ordering ambiguity between
  // "check for a click" and "clear the drag state".
  const handleMouseUp = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (drag?.kind === 'pan' && !drag.moved) {
      if (toolModeRef.current === 'add') {
        addKeyframeAt(fromX(drag.startX), fromY(drag.startY), e.shiftKey);
      } else if (toolModeRef.current === 'select') {
        setSelectedKf(null);
      }
    } else if (drag?.kind === 'keyframe') {
      if (!drag.moved) {
        if (toolModeRef.current === 'select') {
          setSelectedKf(drag.index);
          seekToTime(keyframesRef.current[drag.index].t);
        }
      } else {
        // Re-sort only now the drag is finished, not on every mousemove —
        // sorting mid-drag would invalidate drag.index (it's fixed for the
        // whole gesture) and start updating the wrong point the instant a
        // dragged keyframe crossed a neighbor. Track the dragged object by
        // reference so selection follows it to its new sorted position.
        const draggedObj = keyframesRef.current[drag.index];
        const sorted = [...keyframesRef.current].sort((a, b) => a.t - b.t);
        writeKeyframes(sorted);
        if (toolModeRef.current === 'select') setSelectedKf(sorted.indexOf(draggedObj));
      }
    } else if (drag?.kind === 'draw') {
      if (!drag.moved) {
        // A plain click with no drag in draw mode just drops a single point,
        // same as Add mode — there's no "shape" to sample from one sample.
        addKeyframeAt(drawPathRef.current[0].t, drawPathRef.current[0].v, e.shiftKey);
      } else {
        writeKeyframes(downsamplePath(drawPathRef.current, MAX_KEYFRAMES));
      }
      drawPathRef.current = [];
      setDrawPreview(null);
    }
    dragRef.current = null;
  }, [addKeyframeAt, fromX, fromY, writeKeyframes, seekToTime]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (toolModeRef.current !== 'select') return;
    const xy = getLocalXY(e);
    if (!xy) return;
    const hit = hitTestKeyframe(xy.px, xy.py);
    if (hit !== null) removeKeyframeAt(hit);
  }, [getLocalXY, hitTestKeyframe, removeKeyframeAt]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (toolModeRef.current !== 'select') return;
    const xy = getLocalXY(e);
    if (!xy) return;
    const kfHit = hitTestKeyframe(xy.px, xy.py);
    if (kfHit !== null) {
      setSelectedKf(prev => (prev === kfHit ? null : kfHit));
      seekToTime(keyframesRef.current[kfHit].t);
    }
  }, [getLocalXY, hitTestKeyframe, seekToTime]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    // This modal is a React portal — its events still bubble through the
    // React *component* tree (NodeGraph is a logical ancestor), not the DOM
    // tree, so without stopPropagation() a wheel gesture here also reaches
    // NodeGraph's own onWheel and pans/zooms the graph canvas underneath.
    e.stopPropagation();
    const xy = getLocalXY(e);
    if (e.ctrlKey) {
      // Pinch-to-zoom (trackpad) or ctrl+scroll (mouse wheel) — zoom the
      // value axis, matching the main node graph's own pinch-to-zoom.
      if (xy) {
        const cursorValue = fromY(xy.py);
        const delta = -e.deltaY * (e.deltaMode === 0 ? 0.008 : 0.3);
        setView(v => {
          const newP = Math.max(4, Math.min(800, v.pxPerUnit * (1 + delta)));
          const newCenter = cursorValue - (canvasSizeRef.current.h / 2 - xy.py) / newP;
          return { ...v, pxPerUnit: newP, valueCenter: newCenter };
        });
      }
    } else {
      // Plain scroll (no modifier) → pan both axes, matching the main node
      // graph's convention where scrolling never zooms on its own.
      setView(v => ({
        ...v,
        viewT0: Math.max(0, v.viewT0 + e.deltaX / v.pxPerSec),
        valueCenter: v.valueCenter - e.deltaY / v.pxPerUnit,
      }));
    }
  }, [getLocalXY, fromY]);

  // ── Tool-mode hotkeys (V/C/X/D) — scoped to while this modal is mounted,
  // ignored while typing in one of the grid/loop-back number inputs. ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'v') setToolMode('select');
      else if (key === 'c') setToolMode('add');
      else if (key === 'x') setToolMode('delete');
      else if (key === 'd') setToolMode('draw');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setToolMode]);

  const canvasW = graphSize.w;
  const canvasH = graphSize.h;
  canvasSizeRef.current = { w: canvasW, h: canvasH };

  const cursorForMode = toolMode === 'add' || toolMode === 'draw' ? 'crosshair' : toolMode === 'delete' ? 'not-allowed' : 'default';

  // ── Inspector edits on the selected key ──
  const selKey = selectedKf !== null ? keyframes[selectedKf] : null;
  const updateSelected = (patch: Partial<Keyframe>) => {
    if (selectedKf === null) return;
    const target = { ...keyframes[selectedKf], ...patch };
    const next = keyframes.map((k, i) => (i === selectedKf ? target : k)).sort((a, b) => a.t - b.t);
    writeKeyframes(next);
    setSelectedKf(next.indexOf(target));
    if (patch.t !== undefined) seekToTime(target.t);
  };
  const easingEntries: { id: keyof typeof EASING_PRESETS; label: string }[] = [
    { id: 'linear', label: 'Linear' }, { id: 'ease', label: 'Ease' }, { id: 'easeIn', label: 'In' }, { id: 'easeOut', label: 'Out' }, { id: 'easeInOut', label: 'In-out' },
  ];
  const sameEase = (a: Keyframe['ease'], b: Keyframe['ease']) =>
    Math.abs(a.a - b.a) < 1e-3 && Math.abs(a.b - b.b) < 1e-3 && Math.abs(a.c - b.c) < 1e-3 && Math.abs(a.d - b.d) < 1e-3;
  const hasNextSegment = selectedKf !== null && (selectedKf < keyframes.length - 1 || mode === 'interpolate');

  const nodeLabel = typeof node.params.label === 'string' && node.params.label ? node.params.label : (getNodeDefinition(node.type)?.label ?? node.type);
  const socketLabel = node.inputs[socketKey]?.label ?? socketKey;
  const hint =
    toolMode === 'add' ? 'Click empty space to add a key · drag a key to move it'
    : toolMode === 'delete' ? 'Click a key to delete it'
    : toolMode === 'draw' ? `Drag to draw a curve (sampled down to ${MAX_KEYFRAMES} keys) · click to drop one key`
    : 'Click a key to edit its easing · drag to move · double-click to delete · scroll to pan · ⌃-scroll to zoom';

  const fieldStyle: React.CSSProperties = {
    width: '100%', height: 34, boxSizing: 'border-box', padding: '0 10px', border: 0, outline: 'none', borderRadius: radius.control,
    background: tk.bg.field, color: tk.text.primary, font: `500 12.5px ${fontFamily.mono}`,
  };

  return (
    <Modal
      title="Keyframes"
      subtitle={`${nodeLabel} · ${socketLabel} (${inputType ?? 'float'})`}
      icon="kf"
      iconColor={tk.status.warning}
      width={1040}
      height={700}
      onClose={onClose}
      headerActions={<TimeCluster />}
      footer={
        <>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hint}</span>
          <Button icon={kfPlaying ? 'pause' : 'play'} disabled={keyframes.length === 0}
            title={kfPlaying ? 'Stop' : 'Play this track, following its end behaviour'}
            onClick={() => (kfPlaying ? stopKfPlayback() : startKfPlayback())}>
            {kfPlaying ? 'Stop' : 'Play track'}
          </Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </>
      }
    >
      <div
        style={{ display: 'flex', height: '100%', minHeight: 0, userSelect: 'none', WebkitUserSelect: 'none' }}
        onMouseDown={e => {
          if (showLoadDropdown && loadDropdownRef.current && !loadDropdownRef.current.contains(e.target as Node)) setShowLoadDropdown(false);
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Tool bar */}
          <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 0 16px', borderBottom: `1px solid ${tk.border.subtle}` }}>
            <Segmented
              ariaLabel="Tool"
              value={toolMode}
              onChange={setToolMode}
              options={TOOL_MODES.map(tm => ({ value: tm.id, label: tm.label, shortcut: tm.key.toLowerCase() }))}
            />
            <span style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.field, borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap' }}>
              {keyframes.length} / {MAX_KEYFRAMES} keys
            </span>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" icon="fit" disabled={keyframes.length === 0} onClick={centerOnKeyframes} title="Fit the view to the keys">Fit</Button>
            <span title={bypassed ? 'Bypassed: the static value is used instead of these keys' : 'Bypass these keys (keeps them, ignores them when rendering)'}>
              <Toggle checked={bypassed} onChange={setBypassed} label="Bypass" />
            </span>
            <span style={{ width: 1, height: 20, background: tk.border.default, margin: '0 4px' }} />
            <div ref={loadDropdownRef} style={{ position: 'relative' }}>
              <Button size="sm" variant="ghost" icon="kf" onClick={() => setShowLoadDropdown(v => !v)}>
                Presets <Icon name="chevD" size={13} />
              </Button>
              {showLoadDropdown && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20, width: 240, padding: 4,
                  background: tk.bg.panel, borderRadius: radius.lg, boxShadow: tk.shadow.popover,
                }}>
                  {showSaveInput ? (
                    <div style={{ display: 'flex', gap: 6, padding: 4 }}>
                      <input
                        autoFocus
                        aria-label="Preset name"
                        placeholder={`${socketKey}${isVector ? `.${activeAxis}` : ''}`}
                        value={savePresetName}
                        onChange={e => setSavePresetName(e.target.value)}
                        onKeyDown={e => {
                          e.stopPropagation();
                          if (e.key === 'Enter') { handleSavePreset(savePresetName); setShowLoadDropdown(false); }
                          if (e.key === 'Escape') { setShowSaveInput(false); setSavePresetName(''); }
                        }}
                        style={{ ...fieldStyle, height: 30, font: `500 12.5px ${fontFamily.ui}` }}
                      />
                      <Button size="sm" onClick={() => { handleSavePreset(savePresetName); setShowLoadDropdown(false); }}>Save</Button>
                    </div>
                  ) : (
                    <MenuRow icon="save" disabled={keyframes.length === 0} onClick={() => { setSavePresetName(''); setShowSaveInput(true); }}>
                      Save this curve as a preset…
                    </MenuRow>
                  )}
                  <div style={{ height: 1, background: tk.border.subtle, margin: '4px 0' }} />
                  {keyframePresets.length === 0
                    ? <div style={{ fontSize: 12, color: tk.text.muted, padding: '6px 10px' }}>No saved presets yet</div>
                    : keyframePresets.map(p => (
                      <MenuRow key={p.id} icon="kf" onClick={() => handleLoadPreset(p)}>
                        {p.label} <span style={{ color: tk.text.faint }}>· {p.keyframes.length} keys</span>
                      </MenuRow>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Axis picker — vec2/vec3 sockets */}
          {isVector && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: `1px solid ${tk.border.subtle}` }}>
              <span style={{ fontSize: 12, color: tk.text.muted }}>Axis</span>
              <Segmented
                size="sm"
                ariaLabel="Axis"
                value={activeAxis}
                onChange={changeAxis}
                options={axisLetters.map(a => ({ value: a, label: <span style={{ color: axisColors[a] }}>{a.toUpperCase()}</span> }))}
              />
              {keyframes.length > 0 && axisLetters.length > 1 && (
                <>
                  <span style={{ fontSize: 12, color: tk.text.faint, marginLeft: 6 }}>Copy to</span>
                  {axisLetters.filter(a => a !== activeAxis).map(a => (
                    <Button key={a} size="sm" variant="ghost" style={{ height: 26, color: axisColors[a] }}
                      title={`Copy ${activeAxis.toUpperCase()}'s keys onto ${a.toUpperCase()} (replaces them)`}
                      onClick={() => copyActiveAxisTo(a)}>{a.toUpperCase()}</Button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Scrubber — drag to seek global time live */}
          <div
            onMouseDown={handleScrubberMouseDown}
            title="Drag to scrub time"
            style={{ height: 22, flexShrink: 0, position: 'relative', cursor: 'ew-resize', background: tk.bg.subtle, borderBottom: `1px solid ${tk.border.subtle}` }}
          >
            {playheadT !== null && toX(playheadT) >= 0 && toX(playheadT) <= canvasW && (
              <div style={{
                position: 'absolute', left: toX(playheadT) - 5, bottom: 2, width: 0, height: 0,
                borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `8px solid ${tk.status.danger}`,
              }} />
            )}
          </div>

          {/* Graph */}
          <div ref={graphWrapRef} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              onMouseDown={handleMouseDown}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              onWheel={handleWheel}
              onMouseLeave={() => { setHoverKf(null); setHoverInfo(null); }}
              style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', cursor: cursorForMode, opacity: bypassed ? 0.5 : 1 }}
            />
          </div>
        </div>

        {/* Inspector */}
        <div style={{
          width: 280, flexShrink: 0, boxSizing: 'border-box', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18,
          background: tk.bg.subtle, borderLeft: `1px solid ${tk.border.subtle}`,
        }}>
          <InspectorSection label="Selected key" meta={selKey ? `${selectedKf! + 1} of ${keyframes.length}` : undefined}>
            {selKey ? (
              <>
                <InspectorRow label="Time">
                  <RulerSlider value={selKey.t} min={0} max={Math.max(10, selKey.t + 2)} step={0.01} onChange={t => updateSelected({ t })} ariaLabel="Key time" />
                </InspectorRow>
                <InspectorRow label="Value">
                  <RulerSlider value={selKey.v} min={Math.min(-5, selKey.v - 1)} max={Math.max(5, selKey.v + 1)} step={0.01} onChange={v => updateSelected({ v })} ariaLabel="Key value" />
                </InspectorRow>
              </>
            ) : (
              <InspectorNote>{toolMode === 'select' ? 'Click a key on the graph to edit it.' : 'Switch to Select (V) and click a key to edit it.'}</InspectorNote>
            )}
          </InspectorSection>

          <InspectorSection label="Easing to next key">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, opacity: hasNextSegment ? 1 : 0.45 }}>
              {easingEntries.map(e => {
                const preset = EASING_PRESETS[e.id];
                const on = !!selKey && sameEase(selKey.ease, preset);
                return (
                  <button
                    key={e.id}
                    type="button"
                    disabled={!hasNextSegment}
                    aria-pressed={on}
                    title={hasNextSegment ? `${e.label} easing` : 'Select a key that has a key after it'}
                    onClick={() => updateSelected({ ease: { ...preset } })}
                    style={{
                      height: 46, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, border: 0,
                      borderRadius: radius.md, cursor: hasNextSegment ? 'pointer' : 'default',
                      background: on ? tk.bg.selected : tk.bg.panel, boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.default}`,
                      color: on ? tk.accent.text : tk.text.muted, font: `${on ? 600 : 500} 10px ${fontFamily.ui}`,
                    }}
                  >
                    <EaseGlyph e={preset} color={on ? tk.accent.base : tk.text.faint} />
                    {e.label}
                  </button>
                );
              })}
            </div>
            {selKey && hasNextSegment && !easingEntries.some(e => sameEase(selKey.ease, EASING_PRESETS[e.id])) && (
              <InspectorNote>Custom curve: drag the handles on the graph.</InspectorNote>
            )}
          </InspectorSection>

          <InspectorSection label="Snap grid">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, color: tk.text.muted }}>
                Time (s)
                <NumberInput step={0.05} min={0.05} value={view.gridT} style={fieldStyle} onCommit={n => setView(v => ({ ...v, gridT: Math.max(0.01, n) }))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, color: tk.text.muted }}>
                Value
                <NumberInput step={0.1} min={0.01} value={view.gridV} style={fieldStyle} onCommit={n => setView(v => ({ ...v, gridV: Math.max(0.01, n) }))} />
              </label>
            </div>
            <Toggle checked={view.snap} onChange={on => setView(v => ({ ...v, snap: on }))} label="Always snap" />
            <InspectorNote>Hold ⇧ while dragging to invert.</InspectorNote>
          </InspectorSection>

          <InspectorSection label="When the last key ends">
            <Segmented
              fill
              ariaLabel="End behaviour"
              value={mode}
              onChange={setMode}
              options={[{ value: 'once', label: 'Play once' }, { value: 'loop', label: 'Loop' }, { value: 'interpolate', label: 'Smooth loop' }]}
            />
            {mode === 'interpolate' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, color: tk.text.muted }}>
                Loop-back time (s)
                <NumberInput step={0.1} min={0.01} value={loopBack} style={fieldStyle} onCommit={n => setLoopBack(Math.max(0.01, n))} />
              </label>
            )}
            {(mode === 'loop' || mode === 'interpolate') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Toggle checked={loopCount === null} onChange={on => setLoopCount(on ? null : 3)} label="Forever" />
                {loopCount !== null && (
                  <>
                    <NumberInput step={1} min={1} value={loopCount} style={{ ...fieldStyle, width: 64 }} onCommit={n => setLoopCount(Math.max(1, Math.round(n)))} />
                    <span style={{ fontSize: 12, color: tk.text.muted }}>times</span>
                  </>
                )}
              </div>
            )}
            <label title="Delay before this track starts, in global time; shifts the whole track without moving any key"
              style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, color: tk.text.muted }}>
              Start offset (s)
              <NumberInput step={0.1} value={offset} style={fieldStyle} onCommit={n => setOffset(n)} />
            </label>
          </InspectorSection>
        </div>
      </div>
    </Modal>
  );
}

/** Play/pause, reset and the live time — the global clock, from inside the editor. */
function TimeCluster() {
  const tk = useTokens();
  const timePlaying = useNodeGraphStore(s => s.timePlaying);
  const setTimePlaying = useNodeGraphStore(s => s.setTimePlaying);
  const [time, setTime] = useState(0);
  useEffect(() => {
    const onTick = (e: Event) => setTime((e as CustomEvent<{ time: number }>).detail.time);
    window.addEventListener('time-tick', onTick);
    return () => window.removeEventListener('time-tick', onTick);
  }, []);
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 2, background: tk.bg.field, borderRadius: 10, padding: '3px 10px 3px 3px', marginRight: 6 }}>
      <IconButton icon={timePlaying ? 'pause' : 'play'} label={timePlaying ? 'Pause' : 'Play'} size="sm" onClick={() => setTimePlaying(!timePlaying)} />
      <IconButton icon="reset" label="Reset time to 0" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('reset-time'))} />
      <span style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary, marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{time.toFixed(2)}s</span>
    </span>
  );
}

function InspectorSection({ label, meta, children }: { label: string; meta?: string; children: React.ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>
        <span style={{ flex: 1 }}>{label}</span>
        {meta && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 12 }}>{meta}</span>}
      </span>
      {children}
    </div>
  );
}

function InspectorRow({ label, children }: { label: string; children: React.ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 42, flexShrink: 0, fontSize: 12.5, color: tk.text.secondary }}>{label}</span>
      {children}
    </div>
  );
}

function InspectorNote({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <span style={{ fontSize: 12, lineHeight: 1.45, color: tk.text.muted }}>{children}</span>;
}

function MenuRow({ icon, onClick, disabled = false, children }: { icon: IconName; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', height: 32, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', border: 0, borderRadius: radius.md,
        background: hover && !disabled ? tk.bg.hover : 'none', color: disabled ? tk.text.disabled : tk.text.primary,
        font: `500 12.5px ${fontFamily.ui}`, textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <Icon name={icon} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
    </button>
  );
}

/** Small cubic-bezier drawing for an easing preset tile. */
function EaseGlyph({ e, color }: { e: Keyframe['ease']; color: string }) {
  const W = 26, H = 16;
  const x = (u: number) => 1 + u * (W - 2);
  const y = (u: number) => H - 1 - u * (H - 2);
  return (
    <svg width={W} height={H} aria-hidden>
      <path d={`M${x(0)} ${y(0)} C${x(e.a)} ${y(e.b)} ${x(e.c)} ${y(e.d)} ${x(1)} ${y(1)}`} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}
