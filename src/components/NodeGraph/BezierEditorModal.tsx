import React, { useRef, useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';

// ── Helpers ──────────────────────────────────────────────────────────────────

function np(v: unknown, def: number): number {
  return typeof v === 'number' ? v : def;
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

interface Handle { key: string; x: number; y: number; color: string }

function getHandles(node: GraphNode): Handle[] {
  if (node.type === 'cubicBezierShaper') {
    return [
      { key: 'ab', x: np(node.params.a, 0.25), y: np(node.params.b, 0.1),  color: '#f38ba8' },
      { key: 'cd', x: np(node.params.c, 0.75), y: np(node.params.d, 1.0),  color: '#89b4fa' },
    ];
  }
  // quadBezierShaper
  return [
    { key: 'ab', x: np(node.params.a, 0.5), y: np(node.params.b, 0.5), color: '#f38ba8' },
  ];
}

// Cubic bezier curve evaluation matching evalShaper in NodeInlineViz
function evalCubic(x1: number, y1: number, x2: number, y2: number) {
  const A = 1 - 3*x2 + 3*x1, B = 3*x2 - 6*x1, C = 3*x1;
  const E = 1 - 3*y2 + 3*y1, F = 3*y2 - 6*y1, G = 3*y1;
  return (x: number): number => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const cx = A*t*t*t + B*t*t + C*t;
      const sl = 1 / Math.max(1e-6, 3*A*t*t + 2*B*t + C);
      t -= (cx - x) * sl;
      t = clamp01(t);
    }
    return clamp01(E*t*t*t + F*t*t + G*t);
  };
}

function evalQuad(a: number, b: number) {
  return (x: number): number => {
    let ac = a; if (Math.abs(ac - 0.5) < 1e-5) ac += 1e-5;
    const om2a = 1 - 2 * ac;
    const t = (Math.sqrt(Math.max(0, ac*ac + om2a*x)) - ac) / om2a;
    return clamp01((1 - 2*b)*t*t + 2*b*t);
  };
}

function evalCurve(node: GraphNode) {
  if (node.type === 'cubicBezierShaper') {
    return evalCubic(np(node.params.a, 0.25), np(node.params.b, 0.1), np(node.params.c, 0.75), np(node.params.d, 1.0));
  }
  return evalQuad(np(node.params.a, 0.5), np(node.params.b, 0.5));
}

// ── Canvas drawing ────────────────────────────────────────────────────────────

const HANDLE_R = 6;

function drawEditor(
  canvas: HTMLCanvasElement,
  node: GraphNode,
  dragKey: string | null,
  cursorPos: { x: number; y: number } | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const mg = 20; // inner margin so handles at 0/1 are visible

  const toCanvasX = (v: number) => mg + v * (W - 2 * mg);
  const toCanvasY = (v: number) => H - mg - v * (H - 2 * mg);
  const fromCanvas = (px: number, py: number) => ({
    x: clamp01((px - mg) / (W - 2 * mg)),
    y: clamp01((H - mg - py) / (H - 2 * mg)),
  });
  void fromCanvas; // used externally

  // Background
  ctx.fillStyle = '#11111b';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#1e1e2e';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const gx = mg + (i / 4) * (W - 2 * mg);
    const gy = mg + (i / 4) * (H - 2 * mg);
    ctx.beginPath(); ctx.moveTo(gx, mg); ctx.lineTo(gx, H - mg); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mg, gy); ctx.lineTo(W - mg, gy); ctx.stroke();
  }

  // Identity diagonal
  ctx.strokeStyle = '#2a2a3a';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(mg, H - mg); ctx.lineTo(W - mg, mg); ctx.stroke();
  ctx.setLineDash([]);

  const handles = getHandles(node);
  const fn = evalCurve(node);

  // Control point guide lines
  if (node.type === 'cubicBezierShaper') {
    const [h1, h2] = handles;
    ctx.strokeStyle = '#f38ba830';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mg, H - mg); ctx.lineTo(toCanvasX(h1.x), toCanvasY(h1.y)); ctx.stroke();
    ctx.strokeStyle = '#89b4fa30';
    ctx.beginPath(); ctx.moveTo(W - mg, mg); ctx.lineTo(toCanvasX(h2.x), toCanvasY(h2.y)); ctx.stroke();
  } else {
    const [h] = handles;
    ctx.strokeStyle = '#f38ba830';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mg, H - mg); ctx.lineTo(toCanvasX(h.x), toCanvasY(h.y)); ctx.lineTo(W - mg, mg); ctx.stroke();
  }

  // Curve
  ctx.strokeStyle = '#89b4fa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let px = 0; px <= W - 2 * mg; px++) {
    const xn = px / (W - 2 * mg);
    const yn = fn(xn);
    const cx = mg + xn * (W - 2 * mg);
    const cy = toCanvasY(yn);
    px === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Hover readout
  if (cursorPos) {
    const yn = fn(cursorPos.x);
    const cx = toCanvasX(cursorPos.x);
    const cy = toCanvasY(yn);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(cx, mg); ctx.lineTo(cx, H - mg); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mg, cy); ctx.lineTo(W - mg, cy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#11111b';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Label
    ctx.font = '10px monospace';
    ctx.textAlign = cx > W / 2 ? 'right' : 'left';
    ctx.fillStyle = '#cdd6f4';
    const lx = cx > W / 2 ? cx - 8 : cx + 8;
    ctx.fillText(`(${cursorPos.x.toFixed(3)}, ${yn.toFixed(3)})`, lx, cy - 8);
  }

  // Control point handles
  handles.forEach(h => {
    const hx = toCanvasX(h.x), hy = toCanvasY(h.y);
    const isActive = dragKey === h.key;
    ctx.fillStyle = isActive ? '#ffffff' : h.color;
    ctx.strokeStyle = '#11111b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, isActive ? HANDLE_R + 1 : HANDLE_R, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Label
    ctx.font = '9px monospace';
    ctx.textAlign = hx > W / 2 ? 'right' : 'left';
    ctx.fillStyle = '#6c7086';
    const lx2 = hx > W / 2 ? hx - HANDLE_R - 4 : hx + HANDLE_R + 4;
    ctx.fillText(`(${h.x.toFixed(2)}, ${h.y.toFixed(2)})`, lx2, hy);
  });

  return { toCanvasX, toCanvasY, fromCanvas };
}

// ── BezierEditorModal ─────────────────────────────────────────────────────────

interface Props { node: GraphNode; onClose: () => void }

const MODAL_W = 360;

export function BezierEditorModal({ node, onClose }: Props) {
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const nodeRef    = useRef(node);
  const dragRef    = useRef<{ key: string; offsetX: number; offsetY: number } | null>(null);
  const [dragKey, setDragKey]     = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  nodeRef.current = node;

  const getCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mg = 20;
    const W = canvas.width, H = canvas.height;
    const px = (e.clientX - rect.left) * (W / rect.width);
    const py = (e.clientY - rect.top)  * (H / rect.height);
    return {
      x: clamp01((px - mg) / (W - 2 * mg)),
      y: clamp01((H - mg - py) / (H - 2 * mg)),
      px, py,
    };
  }, []);

  const redraw = useCallback((dk: string | null, cp: { x: number; y: number } | null) => {
    const canvas = canvasRef.current;
    if (canvas) drawEditor(canvas, nodeRef.current, dk, cp);
  }, []);

  // Redraw when params change
  useEffect(() => {
    redraw(dragKey, cursorPos);
  }, [node.params, dragKey, cursorPos, redraw]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const coords = getCoords(e);
    if (!coords) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mg = 20;
    const W = canvas.width, H = canvas.height;
    const toCanvasX = (v: number) => mg + v * (W - 2 * mg);
    const toCanvasY = (v: number) => H - mg - v * (H - 2 * mg);

    const handles = getHandles(nodeRef.current);
    for (const h of handles) {
      const dx = coords.px - toCanvasX(h.x);
      const dy = coords.py - toCanvasY(h.y);
      if (Math.sqrt(dx*dx + dy*dy) <= HANDLE_R + 4) {
        dragRef.current = { key: h.key, offsetX: 0, offsetY: 0 };
        setDragKey(h.key);
        return;
      }
    }
  }, [getCoords]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const coords = getCoords(e);
    if (!coords) return;

    if (dragRef.current) {
      const { key } = dragRef.current;
      const n = nodeRef.current;
      let params: Record<string, number> = {};
      if (n.type === 'cubicBezierShaper') {
        if (key === 'ab') params = { a: coords.x, b: coords.y };
        else               params = { c: coords.x, d: coords.y };
      } else {
        params = { a: coords.x, b: coords.y };
      }
      updateNodeParams(n.id, params);
    } else {
      setCursorPos({ x: coords.x, y: coords.y });
      redraw(null, { x: coords.x, y: coords.y });
    }
  }, [getCoords, updateNodeParams, redraw]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    setDragKey(null);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleMouseLeave = useCallback(() => {
    if (!dragRef.current) {
      setCursorPos(null);
      redraw(dragKey, null);
    }
  }, [dragKey, redraw]);

  const title = node.type === 'cubicBezierShaper' ? 'Cubic Bezier' : 'Quad Bezier';

  const resetDefaults = useCallback(() => {
    if (node.type === 'cubicBezierShaper') {
      updateNodeParams(node.id, { a: 0.25, b: 0.1, c: 0.75, d: 1.0 });
    } else {
      updateNodeParams(node.id, { a: 0.5, b: 0.5 });
    }
  }, [node.id, node.type, updateNodeParams]);

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '10px', width: `${MODAL_W}px`, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.65)', color: '#cdd6f4', fontSize: '12px' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#f38ba8' }}>⬡ {title} Editor</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={resetDefaults} style={{ background: 'none', border: '1px solid #45475a55', color: '#6c7086', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>Reset</button>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid #f38ba855', color: '#f38ba8', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>✕ Close</button>
          </div>
        </div>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={MODAL_W - 40}
          height={MODAL_W - 40}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseLeave}
          style={{ display: 'block', width: '100%', cursor: dragKey ? 'grabbing' : 'crosshair', borderRadius: '6px', border: '1px solid #31324488' }}
        />

        {/* Param values */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '10px', color: '#6c7086', fontFamily: 'monospace' }}>
          {getHandles(node).map(h => (
            <span key={h.key} style={{ color: h.color }}>
              ({h.x.toFixed(3)}, {h.y.toFixed(3)})
            </span>
          ))}
          <span style={{ marginLeft: 'auto', color: '#45475a' }}>drag handles to edit · hover to read</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
