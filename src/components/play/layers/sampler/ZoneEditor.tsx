/**
 * ZoneEditor — the Keys view's zones, after Ableton Sampler's Zone editor:
 * the keyboard across the top (click a key to hear it), one bar per zone
 * underneath spanning its keys. Drag a bar's ends to resize it, its middle to
 * move it, the small triangle to move its root key. The Velocity tab shows
 * the same bars against velocity (1–127). Click a bar to select its zone
 * (edited below the editor).
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTokens } from '../../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../../theme/tokens';
import type { SamplerZone } from '../../../../types/playLayers';
import { zoneName } from '../../../../types/playLayers';
import { smNoteName } from '../../../../play/kit/sampler.js';

export type ZoneAxis = 'key' | 'vel';
type Part = 'lo' | 'hi' | 'move' | 'root';
const ROW = 20, KEYS_H = 26, BLACK = new Set([1, 3, 6, 8, 10]);

export function ZoneEditor({ zones, sel, onSelect, onChange, axis, onPlay, onRelease, held, height }: {
  zones: SamplerZone[];
  sel: number;
  onSelect: (i: number) => void;
  onChange: (i: number, patch: Partial<SamplerZone>) => void;
  axis: ZoneAxis;
  /** A key clicked on the strip: play it (and let go). */
  onPlay?: (note: number, vel: number) => void;
  onRelease?: (note: number) => void;
  /** Notes sounding now (lit on the strip). */
  held?: ReadonlySet<number>;
  height?: number;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef<{ i: number; part: Part; x0: number; z0: SamplerZone } | null>(null);
  const [hover, setHover] = useState<{ i: number; part: Part } | null>(null);
  const playing = useRef<number | null>(null);
  const lo = axis === 'key' ? 0 : 1, hi = 127, n = hi - lo + 1;
  const rows = Math.max(3, zones.length);
  const h = height ?? KEYS_H + 4 + rows * ROW + 4;

  useEffect(() => {
    const c = ref.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(c.clientWidth));
    ro.observe(c);
    setWidth(c.clientWidth);
    return () => ro.disconnect();
  }, []);

  const X = (v: number) => ((v - lo) / n) * width;
  const valAt = (px: number) => Math.max(lo, Math.min(hi, lo + Math.floor((px / Math.max(1, width)) * n)));
  const span = (z: SamplerZone): [number, number] => (axis === 'key' ? [z.lo, z.hi] : [z.vlo, z.vhi]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = tk.bg.render; g.fillRect(0, 0, width, h);
    const kw = width / n;
    // The top strip: a keyboard (Key) or a velocity ruler (Velocity).
    if (axis === 'key') {
      for (let k = lo; k <= hi; k++) {
        const black = BLACK.has(k % 12);
        const lit = held?.has(k);
        g.fillStyle = lit ? tk.accent.base : black ? '#1e1e2e' : '#bac2de';
        const x = X(k);
        g.fillRect(x + (black ? 0 : 0.25), black ? 0 : 0, Math.max(1, kw - 0.5), black ? KEYS_H * 0.62 : KEYS_H);
        if (!black && !lit) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + kw - 0.5, 0, 0.5, KEYS_H); }
      }
      g.font = `600 8.5px ${fontFamily.mono}`; g.textBaseline = 'bottom'; g.textAlign = 'left';
      for (let k = 0; k <= 127; k += 12) { g.fillStyle = '#45475a'; g.fillText(smNoteName(k), X(k) + 1, KEYS_H - 1); }
    } else {
      const grad = g.createLinearGradient(0, 0, width, 0);
      grad.addColorStop(0, 'rgba(205,214,244,0.06)'); grad.addColorStop(1, 'rgba(205,214,244,0.3)');
      g.fillStyle = grad; g.fillRect(0, 4, width, KEYS_H - 8);
      g.font = `500 9px ${fontFamily.mono}`; g.textBaseline = 'middle'; g.fillStyle = 'rgba(205,214,244,0.6)';
      for (const v of [1, 32, 64, 96, 127]) { g.textAlign = v === 127 ? 'right' : 'left'; g.fillText(String(v), v === 127 ? width - 3 : X(v) + 2, KEYS_H / 2); }
    }
    // Octave guides down the rows.
    g.fillStyle = 'rgba(205,214,244,0.05)';
    if (axis === 'key') for (let k = 0; k <= 127; k += 12) g.fillRect(Math.round(X(k)), KEYS_H, 1, h - KEYS_H);
    else for (const v of [32, 64, 96]) g.fillRect(Math.round(X(v)), KEYS_H, 1, h - KEYS_H);
    if (!zones.length) {
      g.font = `500 11px ${fontFamily.ui}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(205,214,244,0.45)';
      g.fillText('Drop sound files here: each becomes a zone, its root key from its name', width / 2, KEYS_H + (h - KEYS_H) / 2);
    }
    zones.forEach((z, i) => {
      const [a, b] = span(z);
      const y = KEYS_H + 4 + i * ROW;
      const selected = i === sel;
      const xa = X(a), xb = X(b + 1);
      const hv = hover?.i === i ? hover.part : drag.current?.i === i ? drag.current.part : null;
      g.fillStyle = selected ? alpha(tk.accent.base, 0.55) : 'rgba(205,214,244,0.18)';
      g.fillRect(xa, y + 2, Math.max(2, xb - xa), ROW - 5);
      if (selected) { g.strokeStyle = tk.accent.base; g.lineWidth = 1; g.strokeRect(xa + 0.5, y + 2.5, Math.max(2, xb - xa) - 1, ROW - 6); }
      // Resize grips.
      g.fillStyle = hv === 'lo' ? '#ffffff' : selected ? tk.accent.base : 'rgba(205,214,244,0.45)';
      g.fillRect(xa, y + 2, 3, ROW - 5);
      g.fillStyle = hv === 'hi' ? '#ffffff' : selected ? tk.accent.base : 'rgba(205,214,244,0.45)';
      g.fillRect(xb - 3, y + 2, 3, ROW - 5);
      // The root key (Key view).
      if (axis === 'key') {
        const rx = X(z.root) + kw / 2;
        g.beginPath(); g.moveTo(rx, y + ROW - 3); g.lineTo(rx - 4, y + ROW - 3 - 6); g.lineTo(rx + 4, y + ROW - 3 - 6); g.closePath();
        g.fillStyle = hv === 'root' ? '#ffffff' : tk.status.warning; g.fill();
      }
      // The name, inside the bar when it fits, else after it.
      g.font = `600 10px ${fontFamily.ui}`; g.textBaseline = 'middle';
      const name = `${zoneName(z, i)}${axis === 'key' ? ` · ${smNoteName(z.lo)}–${smNoteName(z.hi)} · root ${smNoteName(z.root)}` : ` · vel ${z.vlo}–${z.vhi}`}`;
      const tw = g.measureText(name).width;
      g.fillStyle = selected ? '#ffffff' : 'rgba(205,214,244,0.85)'; g.textAlign = 'left';
      const inside = xb - xa > tw + 12;
      const tx = inside ? xa + 6 : xb + 6 + tw < width ? xb + 6 : Math.max(2, xa - tw - 6);
      g.fillText(name, tx, y + ROW / 2);
    });
  });

  const hitAt = (e: { clientX: number; clientY: number }): { i: number; part: Part } | null => {
    const c = ref.current!, r = c.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const i = Math.floor((y - KEYS_H - 4) / ROW);
    if (y < KEYS_H || i < 0 || i >= zones.length) return null;
    const z = zones[i];
    const [a, b] = span(z);
    const xa = X(a), xb = X(b + 1);
    if (axis === 'key' && Math.abs(x - (X(z.root) + width / n / 2)) < 5 && y - (KEYS_H + 4 + i * ROW) > ROW / 2 - 2) return { i, part: 'root' };
    if (Math.abs(x - xa) < 6) return { i, part: 'lo' };
    if (Math.abs(x - xb) < 6) return { i, part: 'hi' };
    if (x > xa && x < xb) return { i, part: 'move' };
    return null;
  };
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (y < KEYS_H) {
      if (axis !== 'key' || !onPlay) return;
      const note = valAt(e.clientX - r.left);
      // Lower on the key is harder, like a real one.
      playing.current = note;
      onPlay(note, Math.max(0.2, Math.min(1, 0.3 + (y / KEYS_H) * 0.7)));
      return;
    }
    const hit = hitAt(e);
    if (!hit) return;
    onSelect(hit.i);
    drag.current = { i: hit.i, part: hit.part, x0: e.clientX, z0: { ...zones[hit.i] } };
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (playing.current !== null && axis === 'key') {
      // Glissando across the strip.
      const note = valAt(e.clientX - r.left);
      if (note !== playing.current && e.buttons) { onRelease?.(playing.current); playing.current = note; onPlay?.(note, 0.8); }
      return;
    }
    const d = drag.current;
    if (!d) { const hh = hitAt(e); setHover(p => (p?.i === hh?.i && p?.part === hh?.part ? p : hh)); return; }
    const v = valAt(e.clientX - r.left);
    const dv = Math.round(((e.clientX - d.x0) / Math.max(1, width)) * n);
    const z = d.z0;
    if (axis === 'key') {
      if (d.part === 'lo') onChange(d.i, { lo: Math.min(v, z.hi) });
      else if (d.part === 'hi') onChange(d.i, { hi: Math.max(v, z.lo) });
      else if (d.part === 'root') onChange(d.i, { root: v });
      else { const s = Math.max(-z.lo, Math.min(127 - z.hi, dv)); onChange(d.i, { lo: z.lo + s, hi: z.hi + s, root: Math.max(0, Math.min(127, z.root + s)) }); }
    } else {
      if (d.part === 'lo') onChange(d.i, { vlo: Math.min(Math.max(1, v), z.vhi) });
      else if (d.part === 'hi') onChange(d.i, { vhi: Math.max(v, z.vlo) });
      else if (d.part === 'move') { const s = Math.max(1 - z.vlo, Math.min(127 - z.vhi, dv)); onChange(d.i, { vlo: z.vlo + s, vhi: z.vhi + s }); }
    }
  };
  const onUp = () => {
    if (playing.current !== null) { onRelease?.(playing.current); playing.current = null; }
    drag.current = null;
  };
  const cursor = hover ? (hover.part === 'move' ? 'grab' : 'ew-resize') : 'default';
  return (
    <canvas ref={ref} data-sampler-zones aria-label={`Zones by ${axis === 'key' ? 'key' : 'velocity'}: drag a bar's ends or middle; click a key to hear it`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)}
      style={{ display: 'block', width: '100%', height: h, borderRadius: radius.md, cursor, touchAction: 'none', marginTop: 6 }} />
  );
}
