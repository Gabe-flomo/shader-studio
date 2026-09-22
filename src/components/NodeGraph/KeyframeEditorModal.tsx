import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';
import { EASING_PRESETS, type Keyframe, type KeyframeLoopMode } from '../../compiler/keyframes';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

const MAX_KEYFRAMES = 8;

function presetNameFor(ease: Keyframe['ease']): string {
  for (const [name, val] of Object.entries(EASING_PRESETS)) {
    if (val.a === ease.a && val.b === ease.b && val.c === ease.c && val.d === ease.d) return name;
  }
  return 'ease';
}

// Mirrors kfCubicBezier in src/compiler/keyframes.ts — kept in sync by hand,
// same as BezierEditorModal's evalCubic mirrors the shader's cubicBezierShaper.
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
    return Math.max(0, Math.min(1, E * t * t * t + F * t * t + G * t));
  };
}

function evalCurveAt(keyframes: Keyframe[], mode: KeyframeLoopMode, loopBack: number, tRaw: number): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].v;
  const t0 = keyframes[0].t;
  const duration = Math.max(keyframes[keyframes.length - 1].t - t0, 0.0001);
  const loopSpan = mode === 'interpolate' ? duration + loopBack : duration;
  const lt = mode === 'once' ? Math.max(0, Math.min(tRaw - t0, duration)) : ((tRaw - t0) % loopSpan + loopSpan) % loopSpan;

  const segs: Array<{ start: number; end: number; v0: number; v1: number; ease: Keyframe['ease'] }> = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    segs.push({ start: keyframes[i].t - t0, end: keyframes[i + 1].t - t0, v0: keyframes[i].v, v1: keyframes[i + 1].v, ease: keyframes[i].ease });
  }
  if (mode === 'interpolate') {
    const last = keyframes[keyframes.length - 1];
    segs.push({ start: duration, end: duration + loopBack, v0: last.v, v1: keyframes[0].v, ease: last.ease });
  }
  for (const seg of segs) {
    if (lt < seg.end || seg === segs[segs.length - 1]) {
      const st = Math.max(0, Math.min(1, (lt - seg.start) / Math.max(seg.end - seg.start, 0.0001)));
      const fn = evalCubicBezier(seg.ease.a, seg.ease.b, seg.ease.c, seg.ease.d);
      return seg.v0 + (seg.v1 - seg.v0) * fn(st);
    }
  }
  return segs[segs.length - 1].v1;
}

// ── Preview canvas ───────────────────────────────────────────────────────────

function drawPreview(canvas: HTMLCanvasElement, keyframes: Keyframe[], mode: KeyframeLoopMode, loopBack: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height, mg = 16;
  ctx.fillStyle = '#11111b';
  ctx.fillRect(0, 0, W, H);
  if (keyframes.length === 0) return;

  const t0 = keyframes[0].t;
  const duration = Math.max(keyframes[keyframes.length - 1].t - t0, 0.0001);
  const span = mode === 'interpolate' ? duration + loopBack : duration;
  const vMin = Math.min(...keyframes.map(k => k.v));
  const vMax = Math.max(...keyframes.map(k => k.v));
  const vPad = (vMax - vMin) * 0.15 || 1;
  const lo = vMin - vPad, hi = vMax + vPad;

  const toX = (t: number) => mg + (t / Math.max(span, 0.0001)) * (W - 2 * mg);
  const toY = (v: number) => H - mg - ((v - lo) / (hi - lo)) * (H - 2 * mg);

  // grid
  ctx.strokeStyle = '#1e1e2e';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = mg + (i / 4) * (H - 2 * mg);
    ctx.beginPath(); ctx.moveTo(mg, gy); ctx.lineTo(W - mg, gy); ctx.stroke();
  }

  // curve
  ctx.strokeStyle = '#89b4fa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * span;
    const v = evalCurveAt(keyframes, mode, loopBack, t0 + t);
    const cx = toX(t), cy = toY(v);
    if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // loop-back segment, dashed, to distinguish it visually
  if (mode === 'interpolate') {
    ctx.strokeStyle = '#f9e2af';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = duration + (i / 40) * loopBack;
      const v = evalCurveAt(keyframes, mode, loopBack, t0 + t);
      const cx = toX(t), cy = toY(v);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // keyframe markers
  keyframes.forEach(k => {
    const cx = toX(k.t - t0), cy = toY(k.v);
    ctx.fillStyle = '#f38ba8';
    ctx.strokeStyle = '#11111b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  });
}

// ── KeyframeEditorModal ────────────────────────────────────────────────────

interface Props { node: GraphNode; socketKey: string; onClose: () => void }

const MODAL_W = 420;

export function KeyframeEditorModal({ node, socketKey, onClose }: Props) {
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const keyframes = useMemo(() => readKeyframes(node, socketKey), [node, socketKey]);
  const mode = readMode(node, socketKey);
  const loopBack = readLoopBack(node, socketKey);

  const writeKeyframes = useCallback((next: Keyframe[]) => {
    updateNodeParams(node.id, { [`__keyframes_${socketKey}`]: next });
  }, [node.id, socketKey, updateNodeParams]);

  useEffect(() => {
    if (canvasRef.current) drawPreview(canvasRef.current, keyframes, mode, loopBack);
  }, [keyframes, mode, loopBack]);

  const addKeyframe = useCallback(() => {
    if (keyframes.length >= MAX_KEYFRAMES) return;
    const lastT = keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 0;
    const lastV = keyframes.length > 0 ? keyframes[keyframes.length - 1].v : 0;
    writeKeyframes([...keyframes, { t: lastT + 1, v: lastV, ease: EASING_PRESETS.ease }]);
  }, [keyframes, writeKeyframes]);

  const updateKeyframe = useCallback((i: number, patch: Partial<Keyframe>) => {
    const next = keyframes.map((k, idx) => (idx === i ? { ...k, ...patch } : k));
    writeKeyframes(next);
  }, [keyframes, writeKeyframes]);

  const removeKeyframe = useCallback((i: number) => {
    writeKeyframes(keyframes.filter((_, idx) => idx !== i));
  }, [keyframes, writeKeyframes]);

  const setMode = useCallback((m: KeyframeLoopMode) => {
    updateNodeParams(node.id, { [`__kfMode_${socketKey}`]: m });
  }, [node.id, socketKey, updateNodeParams]);

  const setLoopBack = useCallback((v: number) => {
    updateNodeParams(node.id, { [`__kfLoopBack_${socketKey}`]: Math.max(0.01, v) });
  }, [node.id, socketKey, updateNodeParams]);

  const inputStyle: React.CSSProperties = {
    background: '#11111b', border: '1px solid #313244', color: '#cdd6f4',
    borderRadius: '4px', padding: '3px 6px', fontSize: '11px', width: '60px', fontFamily: 'monospace',
  };

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '10px', width: `${MODAL_W}px`, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.65)', color: '#cdd6f4', fontSize: '12px', maxHeight: '85vh', overflowY: 'auto' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#f9e2af' }}>◆ Keyframes — {socketKey}</span>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #f38ba855', color: '#f38ba8', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>✕ Close</button>
        </div>

        {/* Preview */}
        <canvas
          ref={canvasRef}
          width={MODAL_W - 40}
          height={140}
          style={{ display: 'block', width: '100%', borderRadius: '6px', border: '1px solid #31324488' }}
        />
        <div style={{ fontSize: '10px', color: '#45475a' }}>
          Time (s) across → · Value ↑ · <span style={{ color: '#f9e2af' }}>dashed = loop-back segment</span>
        </div>

        {/* Keyframe rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', gap: '6px', fontSize: '10px', color: '#6c7086', padding: '0 2px' }}>
            <span style={{ width: '60px' }}>Time (s)</span>
            <span style={{ width: '60px' }}>Value</span>
            <span style={{ flex: 1 }}>Ease out to next</span>
            <span style={{ width: '18px' }} />
          </div>
          {keyframes.map((k, i) => (
            <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input type="number" step={0.1} value={k.t} style={inputStyle}
                onChange={e => updateKeyframe(i, { t: parseFloat(e.target.value) || 0 })} />
              <input type="number" step={0.1} value={k.v} style={inputStyle}
                onChange={e => updateKeyframe(i, { v: parseFloat(e.target.value) || 0 })} />
              <select value={presetNameFor(k.ease)} style={{ ...inputStyle, width: 'auto', flex: 1 }}
                onChange={e => updateKeyframe(i, { ease: EASING_PRESETS[e.target.value] ?? EASING_PRESETS.ease })}>
                {Object.keys(EASING_PRESETS).map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <button onClick={() => removeKeyframe(i)} title="Remove keyframe"
                style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', fontSize: '13px', padding: 0, width: '18px' }}>✕</button>
            </div>
          ))}
          <button onClick={addKeyframe} disabled={keyframes.length >= MAX_KEYFRAMES}
            style={{
              marginTop: '2px', background: 'none', border: '1px dashed #45475a', color: keyframes.length >= MAX_KEYFRAMES ? '#45475a' : '#a6e3a1',
              cursor: keyframes.length >= MAX_KEYFRAMES ? 'default' : 'pointer', fontSize: '11px', padding: '4px 8px', borderRadius: '4px',
            }}>
            + Add Keyframe {keyframes.length >= MAX_KEYFRAMES ? `(max ${MAX_KEYFRAMES})` : ''}
          </button>
        </div>

        {/* Loop mode */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', borderTop: '1px solid #313244', paddingTop: '10px' }}>
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
        <div style={{ fontSize: '10px', color: '#45475a' }}>
          Once: plays from global time 0, holds the last value. Loop: hard cuts back to the first keyframe. Interpolate: eases back to the first keyframe's value over the loop-back duration instead of cutting.
        </div>
      </div>
    </div>,
    document.body,
  );
}
