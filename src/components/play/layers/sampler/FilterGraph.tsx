/**
 * FilterGraph — the Sampler filter's response, drawn and dragged like
 * Simpler's filter display: the curve is the filter's real response (the same
 * biquads the engine builds, kit/sampler.js), on a log frequency axis.
 * Drag the dot sideways for Frequency, up and down for Resonance;
 * double-click to open it fully.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTokens } from '../../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../../theme/tokens';

const F_MIN = 20, F_MAX = 20000, SR = 48000;
const fToX = (f: number) => Math.log(Math.max(F_MIN, Math.min(F_MAX, f)) / F_MIN) / Math.log(F_MAX / F_MIN);
const xToF = (x: number) => F_MIN * Math.pow(F_MAX / F_MIN, Math.max(0, Math.min(1, x)));

/** The filter's gain at `f` Hz (the engine's biquads, Web Audio's formulas: Q in dB for low/high-pass). */
export function filterGain(type: string, f: number, cutoff: number, res: number): number {
  if (!type || type === 'off') return 1;
  const kind = type.slice(0, 2), n = type.slice(2) === '24' ? 2 : 1;
  const r = Math.max(0, Math.min(1, res));
  const qDb = -3 + r * (n === 2 ? 15 : 24), qBp = 0.7 + r * 14;
  const w0 = 2 * Math.PI * Math.min(cutoff, SR / 2 - 100) / SR;
  const alphaQ = kind === 'bp' ? Math.sin(w0) / (2 * qBp) : Math.sin(w0) / (2 * Math.pow(10, qDb / 20));
  const cw = Math.cos(w0);
  let b0, b1, b2;
  if (kind === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
  else if (kind === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
  else { b0 = alphaQ; b1 = 0; b2 = -alphaQ; }
  const a0 = 1 + alphaQ, a1 = -2 * cw, a2 = 1 - alphaQ;
  const w = 2 * Math.PI * f / SR;
  // |B(e^jw)| / |A(e^jw)|
  const re = (c0: number, c1: number, c2: number) => c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w);
  const im = (c1: number, c2: number) => -(c1 * Math.sin(w) + c2 * Math.sin(2 * w));
  const nb = Math.hypot(re(b0, b1, b2), im(b1, b2)), na = Math.hypot(re(a0, a1, a2), im(a1, a2));
  return Math.pow(nb / Math.max(1e-12, na), n);
}

export function FilterGraph({ type, cutoff, res, onChange, height = 72, envAmount = 0 }: {
  type: string;
  cutoff: number;
  res: number;
  onChange: (patch: { cutoff?: number; res?: number }) => void;
  height?: number;
  /** The filter envelope's reach in semitones: drawn as a faint band the cutoff sweeps. */
  envAmount?: number;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef<{ x0: number; y0: number; c0: number; r0: number } | null>(null);
  const [active, setActive] = useState(false);
  const off = !type || type === 'off';

  useEffect(() => {
    const c = ref.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(c.clientWidth));
    ro.observe(c);
    setWidth(c.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const h = height, dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = tk.bg.render; g.fillRect(0, 0, width, h);
    // dB axis: +18 at the top, −36 at the bottom; 0 dB a faint line.
    const Y = (db: number) => 6 + (18 - Math.max(-36, Math.min(18, db))) / 54 * (h - 12);
    g.fillStyle = 'rgba(205,214,244,0.08)';
    for (const f of [100, 1000, 10000]) g.fillRect(Math.round(fToX(f) * width), 0, 1, h);
    g.fillStyle = 'rgba(205,214,244,0.14)'; g.fillRect(0, Math.round(Y(0)), width, 1);
    g.font = `500 9px ${fontFamily.mono}`; g.fillStyle = 'rgba(205,214,244,0.35)'; g.textBaseline = 'bottom';
    for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']] as const) g.fillText(t, fToX(f) * width + 3, h - 2);
    const col = off ? 'rgba(205,214,244,0.35)' : tk.accent.base;
    if (!off && envAmount) {
      const c2 = cutoff * Math.pow(2, envAmount / 12);
      const xa = fToX(Math.min(cutoff, c2)) * width, xb = fToX(Math.max(cutoff, c2)) * width;
      g.fillStyle = alpha(tk.status.warning, 0.1); g.fillRect(xa, 0, Math.max(1, xb - xa), h);
    }
    g.beginPath();
    for (let i = 0; i <= width; i += 2) {
      const db = 20 * Math.log10(Math.max(1e-6, filterGain(type, xToF(i / width), cutoff, res)));
      if (i === 0) g.moveTo(i, Y(db)); else g.lineTo(i, Y(db));
    }
    g.strokeStyle = col; g.lineWidth = 1.75; g.stroke();
    g.lineTo(width, h); g.lineTo(0, h); g.closePath();
    g.fillStyle = alpha(off ? '#cdd6f4' : tk.accent.base, 0.08); g.fill();
    if (!off) {
      const x = fToX(cutoff) * width, y = Y(20 * Math.log10(Math.max(1e-6, filterGain(type, cutoff, cutoff, res))));
      g.beginPath(); g.arc(x, y, active ? 5.5 : 4.5, 0, Math.PI * 2);
      g.fillStyle = active ? '#ffffff' : tk.bg.render; g.fill(); g.lineWidth = 1.75; g.strokeStyle = col; g.stroke();
      const label = `${cutoff >= 1000 ? `${(cutoff / 1000).toFixed(cutoff >= 10000 ? 1 : 2)} kHz` : `${Math.round(cutoff)} Hz`} · Res ${Math.round(res * 100)}%`;
      g.font = `600 10px ${fontFamily.ui}`; g.textBaseline = 'top';
      const tw = g.measureText(label).width + 10;
      const lx = Math.max(2, Math.min(width - tw - 2, x - tw / 2));
      g.fillStyle = 'rgba(17,17,27,0.8)'; g.fillRect(lx, 2, tw, 15);
      g.fillStyle = '#cdd6f4'; g.textAlign = 'left'; g.fillText(label, lx + 5, 4);
    } else {
      g.font = `600 10px ${fontFamily.ui}`; g.textBaseline = 'top'; g.textAlign = 'left';
      g.fillStyle = 'rgba(205,214,244,0.45)'; g.fillText('Filter off', 8, 6);
    }
  });

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (off || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x0: e.clientX, y0: e.clientY, c0: cutoff, r0: res };
    setActive(true);
    // A click away from the dot jumps the cutoff there.
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (Math.abs(x - fToX(cutoff)) * r.width > 10) { const f = Math.round(xToF(x)); drag.current.c0 = f; onChange({ cutoff: f }); }
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    const fine = e.shiftKey ? 0.2 : 1;
    const x = fToX(d.c0) + ((e.clientX - d.x0) / r.width) * fine;
    const res2 = Math.max(0, Math.min(1, d.r0 + ((d.y0 - e.clientY) / (r.height * 1.2)) * fine));
    onChange({ cutoff: Math.round(xToF(x)), res: Math.round(res2 * 100) / 100 });
  };
  const onUp = () => { drag.current = null; setActive(false); };
  return (
    <canvas ref={ref} data-sampler-filter aria-label="Filter: drag sideways for Frequency, up and down for Resonance"
      title={off ? 'Pick a filter type to use it' : 'Drag sideways for Frequency, up and down for Resonance (Shift: finer). Double-click opens it fully.'}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onDoubleClick={() => { if (!off) onChange({ cutoff: type.startsWith('hp') ? 20 : 20000, res: 0 }); }}
      style={{ display: 'block', width: '100%', height, marginTop: 6, borderRadius: radius.md, cursor: off ? 'default' : 'ew-resize', touchAction: 'none' }} />
  );
}
