/**
 * The Envelope (ADSR) card's graph (nodes/definitions/memory.ts), after Ableton's envelope view: the curve rises
 * over Attack, falls over Decay to the Sustain level, holds, and falls over Release (Trigger mode: Attack, then
 * Decay to 0). Drag the points:
 *
 *  - the peak sideways: Attack;
 *  - the decay point sideways: Decay, up / down: Sustain (Gate mode);
 *  - the end sideways: Release.
 *
 * A drag draws on the canvas and writes once on release (the settings are compile-time: one recompile, not one a
 * frame). A dot rides the curve with the node's live value while the preview runs (its state read back from the
 * GPU, lib/memoryProbe.ts). Drawn in the shared animation loop (components/audio/drawLoop.ts), only when
 * something changed: no React render per frame. Sums in envelopeGraph.ts.
 */
import { useEffect, useRef, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { addDrawer } from '../audio/drawLoop';
import { memoryProbe } from '../../lib/memoryProbe';
import {
  dragEnvelopePoint, envelopeLayout, envelopeParams, envelopePlayhead, fmtLevel, fmtTime, nearestEnvelopePoint,
  type EnvelopeParams, type EnvelopePointKey,
} from './envelopeGraph';

const PAD_X = 10, PAD_TOP = 12, PAD_BOTTOM = 8;

type Drag = { key: EnvelopePointKey; p: EnvelopeParams };

export function EnvelopeCardViz({ node, touch = false }: { node: GraphNode; touch?: boolean }) {
  const tk = useTokens();
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const live = useNodeGraphStore(s => s.nodes.find(n => n.id === node.id)) ?? node;
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const hover = useRef<EnvelopePointKey | null>(null);
  /** The readouts under the graph, written by the drawer while a point is dragged (no React render). */
  const stats = useRef<Partial<Record<keyof EnvelopeParams, HTMLSpanElement | null>>>({});
  const [dragging, setDragging] = useState<Drag | null>(null);
  const P = envelopeParams(live.params);
  const mode = P.mode;
  const latest = useRef({ P, tk });
  useEffect(() => { latest.current = { P, tk }; });
  const height = touch ? 150 : 104;

  useEffect(() => memoryProbe.watch(node.id), [node.id]);

  useEffect(() => {
    let sig = '';
    return addDrawer(() => {
      const c = ref.current;
      if (!c) return;
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      const { P: P0, tk: t } = latest.current;
      const d = drag.current;
      const p = d ? d.p : P0;
      const st = memoryProbe.get(node.id);
      const head = st ? envelopePlayhead(envelopeLayout(p, P0.mode), P0.mode, st[0], st[1]) : null;
      const next = `${w}x${h}|${p.attack},${p.decay},${p.sustain},${p.release},${P0.mode}|${d?.key ?? ''}|${hover.current ?? ''}|${head ? `${head[0].toFixed(3)},${head[1].toFixed(3)}` : '-'}|${t.accent.base}`;
      if (next === sig) return;
      sig = next;
      const S = stats.current;
      if (S.attack) S.attack.textContent = fmtTime(p.attack);
      if (S.decay) S.decay.textContent = fmtTime(p.decay);
      if (S.sustain) S.sustain.textContent = fmtLevel(p.sustain);
      if (S.release) S.release.textContent = fmtTime(p.release);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const L = envelopeLayout(p, P0.mode);
      const gw = w - PAD_X * 2, gh = h - PAD_TOP - PAD_BOTTOM;
      const X = (x: number) => PAD_X + x * gw, Y = (y: number) => PAD_TOP + (1 - y) * gh;
      g.fillStyle = t.bg.render; g.fillRect(0, 0, w, h);
      // Grid: quarter levels, and each stage's room.
      g.fillStyle = 'rgba(205,214,244,0.06)';
      for (const y of [0.25, 0.5, 0.75]) g.fillRect(PAD_X, Math.round(Y(y)), gw, 1);
      g.fillStyle = 'rgba(205,214,244,0.12)'; g.fillRect(PAD_X, Math.round(Y(0)), gw, 1);
      const pts: Array<[number, number]> = P0.mode === 'trigger' ? [L.start, L.attack, L.decay] : [L.start, L.attack, L.decay, L.hold, L.release];
      const accent = t.accent.base;
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.lineTo(X(pts[pts.length - 1][0]), Y(0)); g.closePath();
      const grad = g.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + gh);
      grad.addColorStop(0, `${accent}55`); grad.addColorStop(1, `${accent}0a`);
      g.fillStyle = grad; g.fill();
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.strokeStyle = accent; g.lineWidth = 1.75; g.lineJoin = 'round'; g.stroke();
      // The sustain level: a dashed guide across.
      if (P0.mode === 'gate') {
        g.setLineDash([3, 3]); g.strokeStyle = 'rgba(205,214,244,0.22)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(X(0), Y(L.decay[1])); g.lineTo(X(1), Y(L.decay[1])); g.stroke(); g.setLineDash([]);
      }
      // The points.
      const keys: EnvelopePointKey[] = P0.mode === 'trigger' ? ['attack', 'decay'] : ['attack', 'decay', 'release'];
      for (const k of keys) {
        const on = d?.key === k || (!d && hover.current === k);
        g.beginPath(); g.arc(X(L[k][0]), Y(L[k][1]), on ? 5.5 : 4.5, 0, Math.PI * 2);
        g.fillStyle = on ? '#ffffff' : t.bg.render; g.fill();
        g.lineWidth = 1.75; g.strokeStyle = accent; g.stroke();
      }
      // The live value riding the curve.
      if (head) {
        const hx = X(head[0]), hy = Y(head[1]);
        g.fillStyle = 'rgba(249,226,175,0.18)'; g.fillRect(Math.round(hx), PAD_TOP, 1, gh);
        g.beginPath(); g.arc(hx, hy, 7, 0, Math.PI * 2); g.fillStyle = 'rgba(249,226,175,0.25)'; g.fill();
        g.beginPath(); g.arc(hx, hy, 3.5, 0, Math.PI * 2); g.fillStyle = '#f9e2af'; g.fill();
      }
      // What the dragged (or hovered) point is set to.
      const k = d?.key ?? hover.current;
      if (k) {
        const label = k === 'attack' ? `Attack ${fmtTime(p.attack)}`
          : k === 'decay' ? `Decay ${fmtTime(p.decay)}${P0.mode === 'gate' ? ` · Sustain ${fmtLevel(p.sustain)}` : ''}`
          : `Release ${fmtTime(p.release)}`;
        g.font = `600 10.5px ${fontFamily.ui}`; g.textBaseline = 'top';
        const tw = g.measureText(label).width + 10;
        const lx = Math.max(2, Math.min(w - tw - 2, X(L[k][0]) - tw / 2));
        g.fillStyle = 'rgba(17,17,27,0.85)'; g.fillRect(lx, 2, tw, 16);
        g.fillStyle = '#cdd6f4'; g.textAlign = 'left'; g.fillText(label, lx + 5, 5);
      }
    });
  }, [node.id]);

  /** The pointer in the graph's 0–1 space (the card may be zoomed with the graph). */
  const local = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!, r = c.getBoundingClientRect();
    const s = r.width / Math.max(1, c.clientWidth);
    const gw = c.clientWidth - PAD_X * 2, gh = c.clientHeight - PAD_TOP - PAD_BOTTOM;
    return { x: ((e.clientX - r.left) / s - PAD_X) / gw, y: 1 - ((e.clientY - r.top) / s - PAD_TOP) / gh, aspect: gw / gh };
  };
  const pick = (e: React.PointerEvent<HTMLCanvasElement>, p: EnvelopeParams) => {
    const { x, y, aspect } = local(e);
    return nearestEnvelopePoint(envelopeLayout(p, mode), mode, x, y, touch ? 0.3 : 0.18, aspect);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const key = pick(e, P);
    if (!key) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { key, p: { attack: P.attack, decay: P.decay, sustain: P.sustain, release: P.release } };
    setDragging(drag.current);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) { hover.current = pick(e, P); return; }
    const { x, y } = local(e);
    d.p = { ...d.p, ...dragEnvelopePoint(d.key, x, y, d.p, mode) };
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(null);
    if (!d) return;
    const patch: Record<string, number> = {};
    for (const k of ['attack', 'decay', 'sustain', 'release'] as const) if (d.p[k] !== P[k]) patch[k] = d.p[k];
    if (Object.keys(patch).length) update(node.id, patch, { immediate: true });
  };

  const stat = (key: keyof EnvelopeParams, label: string, value: string, on: boolean) => (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, flex: 1 }}>
      <span style={{ font: `600 9.5px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase', color: on ? tk.accent.text : tk.text.faint }}>{label}</span>
      <span ref={el => { stats.current[key] = el; }} style={{ font: `500 ${touch ? 13 : 11}px ${fontFamily.mono}`, color: tk.text.primary, whiteSpace: 'nowrap' }}>{value}</span>
    </span>
  );
  const k = dragging?.key;
  return (
    <div data-envelope-viz style={{ padding: '6px 10px 8px', display: 'flex', flexDirection: 'column', gap: 5 }} onMouseDown={e => e.stopPropagation()}>
      <canvas ref={ref} data-envelope-graph
        style={{ width: '100%', height, display: 'block', borderRadius: radius.md, cursor: dragging ? 'grabbing' : 'pointer', touchAction: 'none' }}
        title={mode === 'gate'
          ? 'Drag the peak for Attack, the next point for Decay (sideways) and Sustain (up and down), the last for Release.'
          : 'Drag the peak for Attack, the end for Decay.'}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => { hover.current = null; }} />
      <div style={{ display: 'flex', gap: 4 }}>
        {stat('attack', 'Attack', fmtTime(P.attack), k === 'attack')}
        {stat('decay', 'Decay', fmtTime(P.decay), k === 'decay')}
        {mode === 'gate' && stat('sustain', 'Sustain', fmtLevel(P.sustain), k === 'decay')}
        {mode === 'gate' && stat('release', 'Release', fmtTime(P.release), k === 'release')}
      </div>
    </div>
  );
}
