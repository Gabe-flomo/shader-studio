import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';
import { EASING_PRESETS, isKeyframeBypassed, type Keyframe, type KeyframeLoopMode } from '../../compiler/keyframes';
import { TimeControlsStrip } from '../TimeControlsStrip';

const MAX_KEYFRAMES = 8;
const HANDLE_R = 6;
const KF_R = 6;
const HIT_R = 9;

type ToolMode = 'select' | 'add' | 'delete';
const TOOL_MODES: { id: ToolMode; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: '↖' },
  { id: 'add', label: 'Add', key: 'C', icon: '✏' },
  { id: 'delete', label: 'Delete', key: 'X', icon: '✕' },
];

// ── Data read/write helpers ──────────────────────────────────────────────────

function readKeyframes(node: GraphNode, socketKey: string): Keyframe[] {
  const raw = node.params[`__keyframes_${socketKey}`];
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
  | { kind: 'handle'; segIndex: number; which: 'p1' | 'p2' };

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

  // grid
  ctx.strokeStyle = '#1e1e2e';
  ctx.lineWidth = 1;
  const tStart = Math.floor(viewT0 / gridT) * gridT;
  const tEnd = viewT0 + W / pxPerSec;
  for (let t = tStart; t <= tEnd; t += gridT) {
    const x = toX(t);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  const vTop = fromY(0), vBot = fromY(H);
  const vStart = Math.floor(Math.min(vTop, vBot) / gridV) * gridV;
  const vEnd = Math.max(vTop, vBot);
  for (let v = vStart; v <= vEnd; v += gridV) {
    const y = toY(v);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
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

  if (keyframes.length === 0) {
    ctx.fillStyle = '#45475a';
    ctx.font = '11px monospace';
    ctx.fillText('click to place a keyframe', 12, 20);
    return;
  }

  const segs = buildSegments(keyframes, mode, loopBack);
  const firstT = keyframes[0].t;
  const lastT = keyframes[keyframes.length - 1].t;

  // curve — drawn (and evaluated) entirely in absolute time, same as the
  // keyframe markers below, so the line always passes exactly through them.
  if (segs.length > 0) {
    ctx.lineWidth = 2;
    const steps = Math.max(2, Math.round(W / 3));
    const drawRange = (fromT: number, toT: number, dashed: boolean) => {
      ctx.strokeStyle = dashed ? '#f9e2af' : '#89b4fa';
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
    ctx.strokeStyle = '#89b4fa';
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
    ctx.fillStyle = isHover ? '#ffffff' : '#f9e2af';
    ctx.strokeStyle = '#11111b';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, isHover ? KF_R + 1.5 : KF_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (isSelected) {
      ctx.strokeStyle = '#89b4fa';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, KF_R + 4, 0, Math.PI * 2); ctx.stroke();
    }
  });
}

// ── KeyframeEditorModal ─────────────────────────────────────────────────────

interface Props { node: GraphNode; socketKey: string; onClose: () => void }
interface AnchorRect { left: number; top: number; width: number; height: number }

export function KeyframeEditorModal({ node, socketKey, onClose }: Props) {
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const setTimePlaying = useNodeGraphStore(s => s.setTimePlaying);

  // Jump the render preview to a specific moment and pause there — so
  // selecting/dragging/placing a keyframe shows exactly what it produces,
  // instead of the live time immediately drifting past it.
  const seekToTime = useCallback((t: number) => {
    setTimePlaying(false);
    window.dispatchEvent(new CustomEvent('seek-time', { detail: { time: t } }));
  }, [setTimePlaying]);
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

  const keyframes = useMemo(() => readKeyframes(node, socketKey), [node, socketKey]);
  const mode = readMode(node, socketKey);
  const loopBack = readLoopBack(node, socketKey);
  const bypassed = isKeyframeBypassed(node, socketKey);
  const keyframesRef = useRef(keyframes);
  keyframesRef.current = keyframes;

  const writeKeyframes = useCallback((next: Keyframe[]) => {
    updateNodeParams(node.id, { [`__keyframes_${socketKey}`]: next });
  }, [node.id, socketKey, updateNodeParams]);
  const setMode = useCallback((m: KeyframeLoopMode) => updateNodeParams(node.id, { [`__kfMode_${socketKey}`]: m }), [node.id, socketKey, updateNodeParams]);
  const setLoopBack = useCallback((v: number) => updateNodeParams(node.id, { [`__kfLoopBack_${socketKey}`]: Math.max(0.01, v) }), [node.id, socketKey, updateNodeParams]);
  const setBypassed = useCallback((b: boolean) => updateNodeParams(node.id, { [`__kfBypass_${socketKey}`]: b }), [node.id, socketKey, updateNodeParams]);

  // ── Tool mode (select / add / delete) ──
  const [toolMode, setToolModeState] = useState<ToolMode>('select');
  const toolModeRef = useRef(toolMode);
  toolModeRef.current = toolMode;
  const [selectedKf, setSelectedKf] = useState<number | null>(null);
  const setToolMode = useCallback((m: ToolMode) => { setToolModeState(m); setSelectedKf(null); }, []);

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
    if (canvas) draw(canvas, keyframesRef.current, mode, loopBack, viewRef.current, easeEditSeg, hoverKf, selectedKf);
  }, [mode, loopBack, easeEditSeg, hoverKf, selectedKf]);

  useEffect(() => { redraw(); }, [keyframes, view, redraw]);

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

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const xy = getLocalXY(e);
    if (!xy) return;
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
  }, [getLocalXY, hitTestKeyframe, hitTestHandle, easeEditSeg, removeKeyframeAt]);

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

  // ── Tool-mode hotkeys (V/C/X) — scoped to while this modal is mounted,
  // ignored while typing in one of the grid/loop-back number inputs. ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'v') setToolMode('select');
      else if (key === 'c') setToolMode('add');
      else if (key === 'x') setToolMode('delete');
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

  const cursorForMode = toolMode === 'add' ? 'crosshair' : toolMode === 'delete' ? 'not-allowed' : 'default';

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
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#f9e2af' }}>◆ Keyframes — {socketKey}</span>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '10px', color: '#6c7086' }}>
            <TimeControlsStrip />
            <span>{keyframes.length}/{MAX_KEYFRAMES}</span>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid #f38ba855', color: '#f38ba8', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>✕ Close</button>
          </div>
        </div>

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
          </div>
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
          style={{ display: 'block', width: '100%', height: `${canvasH}px`, borderRadius: '6px', border: '1px solid #31324488', cursor: cursorForMode, opacity: bypassed ? 0.5 : 1 }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#45475a' }}>
          <span>
            {toolMode === 'add' && 'click empty space: add keyframe · drag point: move'}
            {toolMode === 'delete' && 'click a point: delete it'}
            {toolMode === 'select' && 'click point: select (shows ease handles) · drag: move · dbl-click: delete · scroll: pan · pinch/ctrl+scroll: zoom value · hold shift while dragging to invert snap'}
          </span>
          <span style={{ color: '#89b4fa', fontFamily: 'monospace' }}>{hoverInfo ? `t=${fmt(hoverInfo.t)}  v=${fmt(hoverInfo.v)}` : ''}</span>
        </div>

        {/* Grid + snap controls */}
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', borderTop: '1px solid #313244', paddingTop: '10px', flexWrap: 'wrap' }}>
          <span style={{ color: '#6c7086' }}>Grid</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: '#6c7086', fontSize: '10px' }}>Time</span>
            <input type="number" step={0.05} min={0.05} value={view.gridT} style={inputStyle}
              onChange={e => setView(v => ({ ...v, gridT: Math.max(0.01, parseFloat(e.target.value) || 0.5) }))} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: '#6c7086', fontSize: '10px' }}>Value</span>
            <input type="number" step={0.1} min={0.01} value={view.gridV} style={inputStyle}
              onChange={e => setView(v => ({ ...v, gridV: Math.max(0.01, parseFloat(e.target.value) || 1) }))} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={view.snap} onChange={e => setView(v => ({ ...v, snap: e.target.checked }))} />
            <span style={{ color: '#6c7086', fontSize: '10px' }}>Always snap (hold ⇧ to invert)</span>
          </label>
        </div>

        {/* Loop mode */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ color: '#6c7086', fontSize: '11px' }}>End behavior</span>
          <select value={mode} style={{ ...inputStyle, width: 'auto' }} onChange={e => setMode(e.target.value as KeyframeLoopMode)}>
            <option value="once">Play Once</option>
            <option value="loop">Loop</option>
            <option value="interpolate">Interpolate (smooth loop back)</option>
          </select>
          {mode === 'interpolate' && (
            <>
              <span style={{ color: '#6c7086', fontSize: '11px' }}>Loop-back (s)</span>
              <input type="number" step={0.1} min={0.01} value={loopBack} style={inputStyle}
                onChange={e => setLoopBack(parseFloat(e.target.value) || 1)} />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
