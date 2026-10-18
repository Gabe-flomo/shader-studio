/**
 * SamplerEnvelope — an ADSR picture you edit by dragging (docs/sampler.md),
 * like Ableton's envelope views and the app's Envelope card
 * (NodeGraph/EnvelopeCardViz.tsx, whose layout sums in envelopeGraph.ts it
 * shares: each stage has its own share of the width on a log-like time
 * scale, so short times still have room and the view never rescales under
 * the pointer).
 *
 *   the peak            sideways: Attack
 *   the decay point     sideways: Decay; up / down: Sustain
 *   the release's end   sideways: Release
 *   a stage's middle    up / down: that stage's slope (amp envelope only)
 *
 * Double-click a slope handle to straighten it. Writes as it drags (the
 * numbers are sound, not shader code), and the readouts follow.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTokens } from '../../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../../theme/tokens';
import { dragEnvelopePoint, envelopeLayout, fmtLevel, fmtTime, nearestEnvelopePoint, type EnvelopeParams, type EnvelopePointKey } from '../../../NodeGraph/envelopeGraph';
import { smShape } from '../../../../play/kit/sampler.js';

export interface EnvValues extends EnvelopeParams { aSlope: number; dSlope: number; rSlope: number }
/** The layer keys behind each stage (`attack` → 'pad3_attack', or 'k_fA'). */
export interface EnvKeys { attack: string; decay: string; sustain: string; release: string; aSlope?: string; dSlope?: string; rSlope?: string }
type SlopeKey = 'aSlope' | 'dSlope' | 'rSlope';
type Grab = { kind: 'point'; key: EnvelopePointKey } | { kind: 'slope'; key: SlopeKey; y0: number; s0: number };

const PAD_X = 10, PAD_TOP = 14, PAD_BOTTOM = 8;

export function SamplerEnvelope({ values, keys, onChange, released = true, height = 96, touch = false, colour, title }: {
  values: EnvValues;
  keys: EnvKeys;
  onChange: (patch: Record<string, number>) => void;
  /** False for a one-shot: Release never happens, so it's drawn faint. */
  released?: boolean;
  height?: number;
  touch?: boolean;
  /** The curve's colour (the amp envelope uses the accent). */
  colour?: string;
  title?: string;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [grab, setGrab] = useState<Grab | null>(null);
  const [hover, setHover] = useState<Grab | null>(null);
  const slopes = !!(keys.aSlope && keys.dSlope && keys.rSlope);
  const col = colour ?? tk.accent.base;
  const L = envelopeLayout(values, 'gate');

  useEffect(() => {
    const c = ref.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(c.clientWidth));
    ro.observe(c);
    setWidth(c.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Where each stage's slope handle sits (0–1 space): halfway along it, on the curve.
  const handles = (): Array<[SlopeKey, number, number]> => {
    const at = (a: [number, number], b: [number, number], s: number): [number, number] => [a[0] + (b[0] - a[0]) * 0.5, a[1] + (b[1] - a[1]) * smShape(0.5, s)];
    return [
      ['aSlope', ...at(L.start, L.attack, values.aSlope)],
      ['dSlope', ...at(L.attack, L.decay, values.dSlope)],
      ['rSlope', ...at(L.hold, L.release, values.rSlope)],
    ];
  };

  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const h = height, dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gw = width - PAD_X * 2, gh = h - PAD_TOP - PAD_BOTTOM;
    const X = (x: number) => PAD_X + x * gw, Y = (y: number) => PAD_TOP + (1 - y) * gh;
    g.fillStyle = tk.bg.render; g.fillRect(0, 0, width, h);
    g.fillStyle = 'rgba(205,214,244,0.06)';
    for (const y of [0.25, 0.5, 0.75]) g.fillRect(PAD_X, Math.round(Y(y)), gw, 1);
    g.fillStyle = 'rgba(205,214,244,0.12)'; g.fillRect(PAD_X, Math.round(Y(0)), gw, 1);
    // The curve: each stage shaped by its slope.
    const seg = (a: [number, number], b: [number, number], s: number, first: boolean) => {
      const n = 28;
      for (let i = first ? 0 : 1; i <= n; i++) {
        const u = i / n, x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * smShape(u, s);
        if (i === 0) g.moveTo(X(x), Y(y)); else g.lineTo(X(x), Y(y));
      }
    };
    const path = (withRelease: boolean) => {
      g.beginPath();
      seg(L.start, L.attack, values.aSlope, true);
      seg(L.attack, L.decay, values.dSlope, false);
      g.lineTo(X(L.hold[0]), Y(L.hold[1]));
      if (withRelease) seg(L.hold, L.release, values.rSlope, false);
    };
    path(true);
    g.lineTo(X(L.release[0]), Y(0)); g.lineTo(X(0), Y(0)); g.closePath();
    const grad = g.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + gh);
    grad.addColorStop(0, alpha(col, 0.33)); grad.addColorStop(1, alpha(col, 0.04));
    g.fillStyle = grad; g.fill();
    path(released);
    g.strokeStyle = col; g.lineWidth = 1.75; g.lineJoin = 'round'; g.stroke();
    if (!released) {
      g.beginPath(); seg(L.hold, L.release, values.rSlope, true);
      g.setLineDash([3, 3]); g.strokeStyle = alpha(col, 0.4); g.stroke(); g.setLineDash([]);
    }
    // Sustain guide.
    g.setLineDash([3, 3]); g.strokeStyle = 'rgba(205,214,244,0.22)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(0), Y(L.decay[1])); g.lineTo(X(1), Y(L.decay[1])); g.stroke(); g.setLineDash([]);
    const active = grab ?? hover;
    // Corner points.
    for (const k of ['attack', 'decay', 'release'] as const) {
      const on = active?.kind === 'point' && active.key === k;
      g.beginPath(); g.arc(X(L[k][0]), Y(L[k][1]), on ? 5.5 : 4.5, 0, Math.PI * 2);
      g.fillStyle = on ? '#ffffff' : tk.bg.render; g.fill();
      g.lineWidth = 1.75; g.strokeStyle = col; g.stroke();
    }
    // Slope handles: small diamonds.
    if (slopes) for (const [k, x, y] of handles()) {
      const on = active?.kind === 'slope' && active.key === k;
      const r = on ? 4.5 : 3.5;
      g.beginPath(); g.moveTo(X(x), Y(y) - r); g.lineTo(X(x) + r, Y(y)); g.lineTo(X(x), Y(y) + r); g.lineTo(X(x) - r, Y(y)); g.closePath();
      g.fillStyle = on ? '#ffffff' : alpha(col, 0.55); g.fill();
    }
    // What the active handle is set to.
    if (active) {
      const label = active.kind === 'slope'
        ? `${active.key === 'aSlope' ? 'Attack' : active.key === 'dSlope' ? 'Decay' : 'Release'} slope ${values[active.key] >= 0 ? '+' : '−'}${Math.abs(values[active.key]).toFixed(2)}`
        : active.key === 'attack' ? `Attack ${fmtTime(values.attack)}`
        : active.key === 'decay' ? `Decay ${fmtTime(values.decay)} · Sustain ${fmtLevel(values.sustain)}`
        : `Release ${fmtTime(values.release)}`;
      g.font = `600 10.5px ${fontFamily.ui}`; g.textBaseline = 'top';
      const tw = g.measureText(label).width + 10;
      const ax = active.kind === 'point' ? X(L[active.key][0]) : X(handles().find(hh => hh[0] === active.key)![1]);
      const lx = Math.max(2, Math.min(width - tw - 2, ax - tw / 2));
      g.fillStyle = 'rgba(17,17,27,0.85)'; g.fillRect(lx, 1, tw, 15);
      g.fillStyle = '#cdd6f4'; g.textAlign = 'left'; g.fillText(label, lx + 5, 3);
    } else if (title) {
      // Top right: the corner points sit top left.
      g.font = `600 9.5px ${fontFamily.ui}`; g.textBaseline = 'top'; g.textAlign = 'right';
      g.fillStyle = 'rgba(205,214,244,0.4)'; g.fillText(title.toUpperCase(), width - PAD_X, 2);
    }
  });

  const local = (e: { clientX: number; clientY: number }) => {
    const c = ref.current!, r = c.getBoundingClientRect();
    const gw = r.width - PAD_X * 2, gh = r.height - PAD_TOP - PAD_BOTTOM;
    return { x: (e.clientX - r.left - PAD_X) / gw, y: 1 - (e.clientY - r.top - PAD_TOP) / gh, aspect: gw / gh };
  };
  const pick = (e: { clientX: number; clientY: number }): Grab | null => {
    const { x, y, aspect } = local(e);
    const reach = touch ? 0.3 : 0.16;
    const pt = nearestEnvelopePoint(L, 'gate', x, y, reach, aspect);
    if (pt) return { kind: 'point', key: pt };
    if (!slopes) return null;
    let best: Grab | null = null, bd = reach;
    for (const [k, hx, hy] of handles()) { const d = Math.hypot((hx - x) * aspect, hy - y); if (d < bd) { bd = d; best = { kind: 'slope', key: k, y0: e.clientY, s0: values[k] }; } }
    return best;
  };
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = pick(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setGrab(p);
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!grab) { const p = pick(e); setHover(h => (h?.kind === p?.kind && h?.key === p?.key ? h : p)); return; }
    if (grab.kind === 'slope') {
      const s = Math.max(-1, Math.min(1, grab.s0 + (grab.y0 - e.clientY) / 60 * (grab.key === 'aSlope' ? 1 : -1)));
      onChange({ [keys[grab.key]!]: Math.round(s * 100) / 100 });
      return;
    }
    const { x, y } = local(e);
    const patch = dragEnvelopePoint(grab.key, x, y, values, 'gate');
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(patch)) out[keys[k as keyof EnvelopeParams]] = v as number;
    // An attack of 0 still ramps over a millisecond (no click).
    onChange(out);
  };
  const onUp = () => setGrab(null);
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = pick(e);
    if (p?.kind === 'slope') onChange({ [keys[p.key]!]: 0 });
  };
  const stat = (label: string, value: string, on: boolean) => (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, flex: 1 }}>
      <span style={{ font: `600 9px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase', color: on ? tk.accent.text : tk.text.faint }}>{label}</span>
      <span style={{ font: `500 ${touch ? 12.5 : 10.5}px ${fontFamily.mono}`, color: tk.text.primary, whiteSpace: 'nowrap' }}>{value}</span>
    </span>
  );
  const a = grab ?? hover;
  return (
    <div data-sampler-envelope style={{ marginTop: 6 }}>
      <canvas ref={ref} aria-label={`${title ?? 'Envelope'}: drag the points for times and sustain${slopes ? ', the diamonds for each stage’s curve' : ''}`}
        title={`Drag the peak for Attack, the next point for Decay (sideways) and Sustain (up and down), the last for Release.${slopes ? ' Drag a diamond up or down to bend that stage; double-click it to straighten.' : ''}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)} onDoubleClick={onDouble}
        style={{ display: 'block', width: '100%', height, borderRadius: radius.md, cursor: grab ? 'grabbing' : a ? 'pointer' : 'default', touchAction: 'none' }} />
      <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
        {stat('Attack', fmtTime(values.attack), a?.kind === 'point' && a.key === 'attack')}
        {stat('Decay', fmtTime(values.decay), a?.kind === 'point' && a.key === 'decay')}
        {stat('Sustain', fmtLevel(values.sustain).split(' · ')[0], a?.kind === 'point' && a.key === 'decay')}
        {stat('Release', released ? fmtTime(values.release) : '—', a?.kind === 'point' && a.key === 'release')}
      </div>
    </div>
  );
}
