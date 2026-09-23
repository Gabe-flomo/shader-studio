import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore, saveKeyframePreset, loadKeyframePresets } from '../../store/useNodeGraphStore';
import type { KeyframePreset } from '../../types/keyframePreset';
import type { GraphNode } from '../../types/nodeGraph';
import { EASING_PRESETS, isKeyframeBypassed, VECTOR_AXES, type Keyframe, type KeyframeLoopMode } from '../../compiler/keyframes';
import { TimeControlsStrip } from '../TimeControlsStrip';
import { NumberInput } from './NumberInput';

const MAX_KEYFRAMES = 8;
const HANDLE_R = 6;
const KF_R = 6;
const HIT_R = 9;

type ToolMode = 'select' | 'add' | 'delete' | 'draw';
const TOOL_MODES: { id: ToolMode; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: '↖' },
  { id: 'add', label: 'Add', key: 'C', icon: '✏' },
  { id: 'delete', label: 'Delete', key: 'X', icon: '✕' },
  { id: 'draw', label: 'Draw', key: 'D', icon: '∿' },
];

// Per-axis color, matching the classic X/Y/Z = red/green/blue convention.
const AXIS_COLORS: Record<string, string> = { x: '#f38ba8', y: '#a6e3a1', z: '#89b4fa' };
const DEFAULT_AXIS_COLOR = '#89b4fa'; // plain float sockets (single axis, no letter)
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
  | { kind: 'keyframe'; index: number; moved: boolean }
  | { kind: 'handle'; segIndex: number; which: 'p1' | 'p2' }
  | { kind: 'draw'; moved: boolean }
  | { kind: 'scrub' };

interface OtherAxisTrack { label: string; color: string; keyframes: Keyframe[] }

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
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const { viewT0, valueCenter, pxPerSec, pxPerUnit, gridT, gridV } = view;

  const toX = (t: number) => (t - viewT0) * pxPerSec;
  const toY = (v: number) => H / 2 - (v - valueCenter) * pxPerUnit;
  const fromY = (py: number) => valueCenter - (py - H / 2) / pxPerUnit;

  ctx.fillStyle = '#0d0d14';
  ctx.fillRect(0, 0, W, H);

  // grid, with small tick labels so you can read off where you are in the
  // timeline/value range without needing a live hover.
  ctx.strokeStyle = '#1e1e2e';
  ctx.lineWidth = 1;
  ctx.font = '9px monospace';
  const tStart = Math.floor(viewT0 / gridT) * gridT;
  const tEnd = viewT0 + W / pxPerSec;
  for (let t = tStart; t <= tEnd; t += gridT) {
    const x = toX(t);
    ctx.strokeStyle = '#1e1e2e';
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillStyle = '#585b70';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fmt(t), x + 3, H - 4);
  }
  const vTop = fromY(0), vBot = fromY(H);
  const vStart = Math.floor(Math.min(vTop, vBot) / gridV) * gridV;
  const vEnd = Math.max(vTop, vBot);
  for (let v = vStart; v <= vEnd; v += gridV) {
    const y = toY(v);
    ctx.strokeStyle = '#1e1e2e';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = '#585b70';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fmt(v), 3, y - 3);
  }

  // axes (t=0, v=0) — brighter
  ctx.strokeStyle = '#45475a';
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
    ctx.strokeStyle = '#f9e2af';
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
    ctx.fillStyle = '#45475a';
    ctx.font = '11px monospace';
    ctx.fillText('click to place a keyframe', 12, 20);
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
      ctx.strokeStyle = dashed ? '#f9e2af' : activeColor;
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
    ctx.strokeStyle = '#f38ba888'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.stroke();
    ctx.strokeStyle = '#89b4fa88';
    ctx.beginPath(); ctx.moveTo(p3x, p3y); ctx.lineTo(p2x, p2y); ctx.stroke();
    [[p1x, p1y, '#f38ba8'], [p2x, p2y, '#89b4fa']].forEach(([hx, hy, color]) => {
      ctx.fillStyle = color as string;
      ctx.strokeStyle = '#11111b'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx as number, hy as number, HANDLE_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }

  // keyframe markers
  keyframes.forEach((k, i) => {
    const cx = toX(k.t), cy = toY(k.v);
    const isHover = hoverKf === i;
    const isSelected = selectedKf === i;
    ctx.fillStyle = isHover ? '#ffffff' : activeColor;
    ctx.strokeStyle = '#11111b';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, isHover ? KF_R + 1.5 : KF_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
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
      ctx.strokeStyle = '#f9e2af';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      ctx.fillStyle = '#f9e2af';
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
    ctx.font = '10px monospace';
    const textW = ctx.measureText(label).width;
    const padX = 6, boxH = 16;
    const boxW = textW + padX * 2;
    const boxX = Math.max(2, Math.min(W - boxW - 2, hx - boxW / 2));
    const boxY = Math.max(2, hy - KF_R - boxH - 8);
    ctx.fillStyle = '#1e1e2edd';
    ctx.strokeStyle = '#45475a';
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
interface AnchorRect { left: number; top: number; width: number; height: number }

export function KeyframeEditorModal({ node, socketKey, onClose }: Props) {
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

  // Position/dim over the node-graph canvas only, not the whole viewport, so
  // the render preview (and the rest of the app chrome) stays visible while
  // editing — computed once on open.
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  useEffect(() => {
    const el = document.querySelector('[data-node-canvas="true"]');
    if (el) {
      const r = el.getBoundingClientRect();
      setAnchor({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
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
  const activeColor = isVector ? (AXIS_COLORS[activeAxis] ?? DEFAULT_AXIS_COLOR) : DEFAULT_AXIS_COLOR;

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
      .map(a => ({ label: a.toUpperCase(), color: AXIS_COLORS[a] ?? DEFAULT_AXIS_COLOR, keyframes: readKeyframes(node, `${socketKey}_${a}`) }));
  }, [isVector, axisLetters, activeAxis, node, socketKey]);

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

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) draw(canvas, keyframesRef.current, mode, loopBack, viewRef.current, easeEditSeg, hoverKf, selectedKf, activeColor, otherAxes, hoverInfo, drawPreview, playheadT);
  }, [mode, loopBack, easeEditSeg, hoverKf, selectedKf, activeColor, otherAxes, hoverInfo, drawPreview, playheadT]);

  // `anchor` is in the deps because it drives canvasW/canvasH below: a canvas
  // element clears its drawn content the instant its width/height attributes
  // change (a plain browser behavior, nothing React-specific), and anchor
  // resolves one render after mount (its own effect fires after first paint)
  // — without this, that resize silently wipes the canvas and nothing
  // schedules a repaint, so the editor opens blank until some other state
  // change (e.g. a hover) happens to trigger one.
  useEffect(() => { redraw(); }, [keyframes, view, redraw, anchor]);

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
      dragRef.current = { kind: 'keyframe', index: kfHit, moved: false };
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

  const modalW = anchor ? Math.min(anchor.width * 0.88, 920) : 760;
  const modalH = anchor ? Math.min(anchor.height * 0.88, 640) : 560;
  const canvasW = Math.round(modalW - 40);
  const canvasH = Math.round(modalH - 220);
  canvasSizeRef.current = { w: canvasW, h: canvasH };

  const inputStyle: React.CSSProperties = {
    background: '#11111b', border: '1px solid #313244', color: '#cdd6f4',
    borderRadius: '4px', padding: '3px 6px', fontSize: '11px', width: '52px', fontFamily: 'monospace',
  };

  const overlayStyle: React.CSSProperties = anchor
    ? { position: 'fixed', left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height, zIndex: 1000, background: 'rgba(0,0,0,0.6)' }
    : { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' };

  const cursorForMode = toolMode === 'add' || toolMode === 'draw' ? 'crosshair' : toolMode === 'delete' ? 'not-allowed' : 'default';

  return createPortal(
    <div style={overlayStyle} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        style={{
          position: anchor ? 'absolute' : 'static',
          left: anchor ? (anchor.width - modalW) / 2 : undefined,
          top: anchor ? (anchor.height - modalH) / 2 : undefined,
          background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '10px',
          width: `${modalW}px`, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)', color: '#cdd6f4', fontSize: '12px',
          // Belt-and-suspenders alongside preventDefault() on the drag
          // handlers: a fast drag shouldn't be able to select nearby text
          // (header, button labels, hint row) and trigger a native
          // text-drag instead of our own canvas/scrubber drag.
          userSelect: 'none', WebkitUserSelect: 'none',
        }}
        onMouseDown={e => {
          e.stopPropagation();
          if (showLoadDropdown && loadDropdownRef.current && !loadDropdownRef.current.contains(e.target as Node)) {
            setShowLoadDropdown(false);
          }
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: activeColor }}>
            ◆ Keyframes — {socketKey}{isVector && <span style={{ opacity: 0.7 }}>.{activeAxis}</span>}
          </span>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '10px', color: '#6c7086' }}>
            <TimeControlsStrip />
            <span>{keyframes.length}/{MAX_KEYFRAMES}</span>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid #f38ba855', color: '#f38ba8', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>✕ Close</button>
          </div>
        </div>

        {/* Axis selector — vec2/vec3 sockets only */}
        {isVector && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#6c7086', fontSize: '11px' }}>Axis</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {axisLetters.map(a => (
                <button
                  key={a}
                  onClick={() => changeAxis(a)}
                  title={`Edit the ${a.toUpperCase()} axis`}
                  style={{
                    background: activeAxis === a ? `${AXIS_COLORS[a]}22` : 'none',
                    border: `1px solid ${activeAxis === a ? AXIS_COLORS[a] : '#45475a'}`,
                    color: activeAxis === a ? AXIS_COLORS[a] : '#a6adc8',
                    cursor: 'pointer', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '4px',
                  }}
                >{a.toUpperCase()}</button>
              ))}
            </div>
            {keyframes.length > 0 && axisLetters.length > 1 && (
              <>
                <span style={{ color: '#45475a', fontSize: '10px' }}>copy to</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {axisLetters.filter(a => a !== activeAxis).map(a => (
                    <button
                      key={a}
                      onClick={() => copyActiveAxisTo(a)}
                      title={`Copy the ${activeAxis.toUpperCase()} axis's keyframes onto ${a.toUpperCase()} (overwrites it)`}
                      style={{ background: 'none', border: `1px solid ${AXIS_COLORS[a]}55`, color: AXIS_COLORS[a], cursor: 'pointer', fontSize: '10px', padding: '2px 7px', borderRadius: '4px' }}
                    >→ {a.toUpperCase()}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Tool modes + bypass */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            {TOOL_MODES.map(tm => (
              <button
                key={tm.id}
                onClick={() => setToolMode(tm.id)}
                title={`${tm.label} (${tm.key})`}
                style={{
                  background: toolMode === tm.id ? '#89b4fa22' : 'none',
                  border: `1px solid ${toolMode === tm.id ? '#89b4fa' : '#45475a'}`,
                  color: toolMode === tm.id ? '#89b4fa' : '#a6adc8',
                  cursor: 'pointer', fontSize: '11px', padding: '3px 9px', borderRadius: '4px',
                  display: 'flex', alignItems: 'center', gap: '5px',
                }}
              >
                <span>{tm.icon}</span>{tm.label}
                <span style={{ opacity: 0.6, fontSize: '9px' }}>{tm.key}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={centerOnKeyframes}
              disabled={keyframes.length === 0}
              title="Fit view to all keyframes"
              style={{
                background: 'none', border: '1px solid #45475a', color: keyframes.length === 0 ? '#45475a' : '#a6adc8',
                cursor: keyframes.length === 0 ? 'default' : 'pointer', fontSize: '11px', padding: '3px 9px', borderRadius: '4px',
              }}
            >⊡ Fit</button>
            <button
              onClick={() => setBypassed(!bypassed)}
              title={bypassed ? 'Bypassed — using the static value instead of these keyframes' : 'Bypass these keyframes (keeps the data, ignores it when rendering)'}
              style={{
                background: bypassed ? '#f38ba822' : 'none',
                border: `1px solid ${bypassed ? '#f38ba8' : '#45475a'}`,
                color: bypassed ? '#f38ba8' : '#a6adc8',
                cursor: 'pointer', fontSize: '11px', padding: '3px 9px', borderRadius: '4px',
              }}
            >⏭ {bypassed ? 'Bypassed' : 'Bypass'}</button>
            {showSaveInput ? (
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input
                  autoFocus
                  type="text"
                  placeholder={`${socketKey}${isVector ? `.${activeAxis}` : ''}`}
                  value={savePresetName}
                  onChange={e => setSavePresetName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSavePreset(savePresetName);
                    if (e.key === 'Escape') { setShowSaveInput(false); setSavePresetName(''); }
                  }}
                  style={{ width: '110px', padding: '3px 6px', fontSize: '11px', background: '#11111b', color: '#cdd6f4', border: '1px solid #a6e3a1', borderRadius: '4px', outline: 'none' }}
                />
                <button onClick={() => handleSavePreset(savePresetName)} style={{ background: '#a6e3a111', border: '1px solid #a6e3a155', color: '#a6e3a1', cursor: 'pointer', fontSize: '11px', padding: '3px 8px', borderRadius: '4px' }}>↑</button>
                <button onClick={() => { setShowSaveInput(false); setSavePresetName(''); }} style={{ background: 'none', border: '1px solid #6c708655', color: '#6c7086', cursor: 'pointer', fontSize: '11px', padding: '3px 6px', borderRadius: '4px' }}>✕</button>
              </div>
            ) : (
              <button
                onClick={() => { setSavePresetName(''); setShowSaveInput(true); }}
                disabled={keyframes.length === 0}
                title="Save this curve as a reusable preset in the Saved Keyframes palette tab"
                style={{
                  background: 'none', border: `1px solid ${keyframes.length === 0 ? '#45475a' : '#a6e3a155'}`, color: keyframes.length === 0 ? '#45475a' : '#a6e3a1',
                  cursor: keyframes.length === 0 ? 'default' : 'pointer', fontSize: '11px', padding: '3px 9px', borderRadius: '4px',
                }}
              >↑ Save Preset</button>
            )}
            <div ref={loadDropdownRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowLoadDropdown(v => !v)}
                title="Load a saved preset onto this axis"
                style={{
                  background: showLoadDropdown ? '#89b4fa22' : 'none',
                  border: `1px solid ${showLoadDropdown ? '#89b4fa' : '#45475a'}`,
                  color: showLoadDropdown ? '#89b4fa' : '#a6adc8',
                  cursor: 'pointer', fontSize: '11px', padding: '3px 9px', borderRadius: '4px',
                }}
              >↓ Load Preset</button>
              {showLoadDropdown && (
                <div
                  style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: '4px', zIndex: 20,
                    background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '6px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.5)', minWidth: '160px', maxHeight: '220px', overflowY: 'auto',
                    padding: '4px',
                  }}
                >
                  {keyframePresets.length === 0 ? (
                    <div style={{ fontSize: '10px', color: '#45475a', padding: '6px 8px', fontStyle: 'italic' }}>No saved presets yet</div>
                  ) : (
                    keyframePresets.map(p => (
                      <button
                        key={p.id}
                        onClick={() => handleLoadPreset(p)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
                          color: '#cdd6f4', fontSize: '11px', padding: '5px 8px', cursor: 'pointer', borderRadius: '4px',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#313244'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                      >◆ {p.label} <span style={{ opacity: 0.5 }}>({p.keyframes.length})</span></button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Scrubber — drag to seek global time live, After-Effects style */}
        <div
          onMouseDown={handleScrubberMouseDown}
          title="Drag to scrub global time"
          style={{
            height: '16px', background: '#11111b', borderRadius: '6px 6px 0 0',
            border: '1px solid #31324488', borderBottom: 'none', position: 'relative', cursor: 'ew-resize',
          }}
        >
          {playheadT !== null && toX(playheadT) >= 0 && toX(playheadT) <= canvasW && (
            <div style={{ position: 'absolute', left: `${toX(playheadT) - 5}px`, top: '2px', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '8px solid #f9e2af' }} />
          )}
        </div>

        {/* Timeline canvas */}
        <canvas
          ref={canvasRef}
          width={canvasW}
          height={canvasH}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
          onMouseLeave={() => { setHoverKf(null); setHoverInfo(null); }}
          style={{ display: 'block', width: '100%', height: `${canvasH}px`, borderRadius: '0 0 6px 6px', border: '1px solid #31324488', borderTop: 'none', cursor: cursorForMode, opacity: bypassed ? 0.5 : 1 }}
        />
        <div style={{ fontSize: '10px', color: '#45475a' }}>
          {toolMode === 'add' && 'click empty space: add keyframe · drag point: move'}
          {toolMode === 'delete' && 'click a point: delete it'}
          {toolMode === 'draw' && `drag to freehand-draw a curve (replaces this axis's keyframes, sampled down to ${MAX_KEYFRAMES} points) · click: drop one point`}
          {toolMode === 'select' && 'click point: select (shows ease handles) · drag: move · dbl-click: delete · scroll: pan · pinch/ctrl+scroll: zoom value · hold shift while dragging to invert snap'}
        </div>

        {/* Grid + snap controls */}
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', borderTop: '1px solid #313244', paddingTop: '10px', flexWrap: 'wrap' }}>
          <span style={{ color: '#6c7086' }}>Grid</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: '#6c7086', fontSize: '10px' }}>Time</span>
            <NumberInput step={0.05} min={0.05} value={view.gridT} style={inputStyle}
              onCommit={n => setView(v => ({ ...v, gridT: Math.max(0.01, n) }))} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: '#6c7086', fontSize: '10px' }}>Value</span>
            <NumberInput step={0.1} min={0.01} value={view.gridV} style={inputStyle}
              onCommit={n => setView(v => ({ ...v, gridV: Math.max(0.01, n) }))} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={view.snap} onChange={e => setView(v => ({ ...v, snap: e.target.checked }))} />
            <span style={{ color: '#6c7086', fontSize: '10px' }}>Always snap (hold ⇧ to invert)</span>
          </label>
        </div>

        {/* Loop mode */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#6c7086', fontSize: '11px' }}>End behavior</span>
          <select value={mode} style={{ ...inputStyle, width: 'auto' }} onChange={e => setMode(e.target.value as KeyframeLoopMode)}>
            <option value="once">Play Once</option>
            <option value="loop">Loop</option>
            <option value="interpolate">Interpolate (smooth loop back)</option>
          </select>
          {mode === 'interpolate' && (
            <>
              <span style={{ color: '#6c7086', fontSize: '11px' }}>Loop-back (s)</span>
              <NumberInput step={0.1} min={0.01} value={loopBack} style={inputStyle}
                onCommit={n => setLoopBack(Math.max(0.01, n))} />
            </>
          )}
          {(mode === 'loop' || mode === 'interpolate') && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input type="checkbox" checked={loopCount === null} onChange={e => setLoopCount(e.target.checked ? null : 3)} />
              <span style={{ color: '#6c7086', fontSize: '10px' }}>Loop forever</span>
            </label>
          )}
          {(mode === 'loop' || mode === 'interpolate') && loopCount !== null && (
            <>
              <span style={{ color: '#6c7086', fontSize: '11px' }}>× times</span>
              <NumberInput step={1} min={1} value={loopCount} style={inputStyle}
                onCommit={n => setLoopCount(Math.max(1, Math.round(n)))} />
            </>
          )}
          <span style={{ color: '#6c7086', fontSize: '11px' }}>Offset (s)</span>
          <NumberInput step={0.1} value={offset} style={inputStyle}
            title="Delay before this track starts playing, in global time — shifts the whole track without moving any keyframe"
            onCommit={n => setOffset(n)} />
          <button
            onClick={() => (kfPlaying ? stopKfPlayback() : startKfPlayback())}
            disabled={keyframes.length === 0}
            title={kfPlaying ? 'Stop' : "Play this track's curve, respecting its End behavior"}
            style={{
              background: kfPlaying ? '#f38ba822' : 'none',
              border: `1px solid ${keyframes.length === 0 ? '#45475a' : kfPlaying ? '#f38ba8' : '#a6e3a155'}`,
              color: keyframes.length === 0 ? '#45475a' : kfPlaying ? '#f38ba8' : '#a6e3a1',
              cursor: keyframes.length === 0 ? 'default' : 'pointer', fontSize: '11px', padding: '3px 9px', borderRadius: '4px', marginLeft: 'auto',
            }}
          >{kfPlaying ? '⏸ Stop' : '▶ Play'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
