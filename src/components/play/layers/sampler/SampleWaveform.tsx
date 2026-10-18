/**
 * SampleWaveform — the Sampler's sample view (docs/sampler.md), after
 * Simpler's: a dark surface with the sample's waveform, the region that plays
 * lit and the rest dimmed, and markers to drag:
 *
 *   S / E      the start and end flags (top corners of the region)
 *   the brace  the loop (Classic with Loop on), its ends draggable, its
 *              crossfade drawn as a ramp into the loop end
 *   slices     Slice mode's lines: drag to move, double-click the waveform to
 *              add one, double-click a line to remove it
 *
 * Snap (on by default) puts every marker on the nearest zero crossing, so a
 * cut never clicks. ⌘/Ctrl + wheel (or a trackpad pinch) zooms around the
 * pointer; Shift + wheel or a sideways swipe scrolls; the strip underneath is
 * the whole sample with the view's window, drag it to scroll; double-click
 * the strip to see everything. Dragging the empty waveform scrolls too.
 *
 * Drawn on a canvas from the decoded buffer (min/max per pixel column, so a
 * zoomed view shows the real wave), redrawn only when something changed.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTokens } from '../../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../../theme/tokens';
import { IconButton } from '../../../ui/Button';
import { smMinMax, smSnap } from '../../../../play/kit/sampler.js';

export interface WaveMarkers { start: number; end: number; loopStart: number; loopEnd: number }
type MarkerKey = keyof WaveMarkers;
type Hit = { kind: 'marker'; key: MarkerKey } | { kind: 'slice'; index: number } | { kind: 'pan' };

const OVERVIEW_H = 14;
const FLAG_H = 14;

export function SampleWaveform({
  buffer, peaks, markers, loop, xfade = 0, reverse = false, slices, snap, onSnap, onChange, onSlices, height = 96, compact = false, label,
}: {
  buffer: AudioBuffer | null;
  /** A coarse waveform while the buffer isn't decoded here (the library's peaks). */
  peaks?: Float32Array | null;
  markers: WaveMarkers;
  /** Show the loop brace (Classic with Loop on). */
  loop: boolean;
  /** The loop crossfade, seconds. */
  xfade?: number;
  reverse?: boolean;
  /** Slice mode: each slice's start (0..1). */
  slices?: number[] | null;
  snap: boolean;
  onSnap?: (on: boolean) => void;
  onChange: (patch: Partial<WaveMarkers>) => void;
  onSlices?: (next: number[]) => void;
  height?: number;
  compact?: boolean;
  label?: string;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  /** The view: the part of the sample shown, 0..1. */
  const [view, setView] = useState<[number, number]>([0, 1]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ hit: Hit; x0: number; v0: [number, number]; moved: boolean; overview?: boolean } | null>(null);
  const [hover, setHover] = useState<Hit | null>(null);
  const [width, setWidth] = useState(0);
  const data = buffer ? buffer.getChannelData(0) : null;
  const duration = buffer?.duration ?? 0;

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // A new sample: show all of it.
  useEffect(() => { setView([0, 1]); }, [buffer]);

  const waveH = height;
  const total = waveH + (compact ? 0 : OVERVIEW_H + 4);

  // ── Drawing ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr); c.height = Math.round(total * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [v0, v1] = view;
    const span = Math.max(1e-6, v1 - v0);
    const X = (u: number) => ((u - v0) / span) * width;
    const bg = tk.bg.render;
    g.fillStyle = bg; g.fillRect(0, 0, width, total);
    const mid = FLAG_H + (waveH - FLAG_H) / 2, amp = (waveH - FLAG_H) / 2 - 3;
    const lo = Math.min(markers.start, markers.end), hi = Math.max(markers.start, markers.end);
    // The region that plays, lit.
    g.fillStyle = alpha(tk.accent.base, 0.1);
    g.fillRect(X(lo), FLAG_H, X(hi) - X(lo), waveH - FLAG_H);
    // The centre line.
    g.fillStyle = 'rgba(205,214,244,0.10)'; g.fillRect(0, Math.round(mid), width, 1);
    // The wave: min/max per column from the buffer, or the coarse peaks.
    const n = Math.max(1, Math.floor(width));
    const accent = tk.accent.base, dim = 'rgba(205,214,244,0.28)';
    if (data && data.length) {
      const mm = smMinMax(data, v0 * data.length, v1 * data.length, n);
      for (let i = 0; i < n; i++) {
        const u = v0 + (i / n) * span;
        const a = mm[i * 2], b = mm[i * 2 + 1];
        g.fillStyle = u >= lo && u <= hi ? accent : dim;
        const y0 = mid - b * amp, y1 = mid - a * amp;
        g.fillRect(i, y0, 1, Math.max(1, y1 - y0));
      }
    } else if (peaks && peaks.length) {
      for (let i = 0; i < n; i++) {
        const u = v0 + (i / n) * span, p = peaks[Math.min(peaks.length - 1, Math.floor(u * peaks.length))] * amp;
        g.fillStyle = u >= lo && u <= hi ? accent : dim;
        g.fillRect(i, mid - p, 1, Math.max(1, p * 2));
      }
    }
    // Dim what doesn't play.
    g.fillStyle = alpha(bg, 0.45);
    if (X(lo) > 0) g.fillRect(0, FLAG_H, X(lo), waveH - FLAG_H);
    if (X(hi) < width) g.fillRect(X(hi), FLAG_H, width - X(hi), waveH - FLAG_H);
    // Time ticks along the top band.
    if (duration > 0) {
      const secs = span * duration;
      const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60];
      const step = steps.find(s => (s / secs) * width >= 70) ?? 60;
      g.font = `500 9px ${fontFamily.mono}`; g.textBaseline = 'top'; g.textAlign = 'left';
      for (let t = Math.ceil((v0 * duration) / step) * step; t <= v1 * duration + 1e-9; t += step) {
        const x = Math.round(X(t / duration)) + 0.5;
        g.fillStyle = 'rgba(205,214,244,0.18)'; g.fillRect(x, FLAG_H - 4, 1, 4);
        g.fillStyle = 'rgba(205,214,244,0.42)';
        g.fillText(step < 1 ? `${+(t * 1000).toFixed(0)} ms` : `${+t.toFixed(step < 10 ? 1 : 0)} s`, x + 3, 2);
      }
    }
    // The loop brace and its crossfade.
    if (loop) {
      const ls = Math.max(lo, Math.min(hi, markers.loopStart)), le = Math.min(hi, Math.max(lo, markers.loopEnd));
      const on = (k: MarkerKey) => (drag.current?.hit.kind === 'marker' && drag.current.hit.key === k) || (hover?.kind === 'marker' && hover.key === k);
      if (le > ls) {
        const xa = X(ls), xb = X(le);
        g.fillStyle = alpha(tk.status.warning, 0.08); g.fillRect(xa, FLAG_H, xb - xa, waveH - FLAG_H);
        if (xfade > 0 && duration > 0) {
          const xf = X(Math.max(ls, le - xfade / duration));
          g.beginPath(); g.moveTo(xf, waveH); g.lineTo(xb, FLAG_H + 2); g.lineTo(xb, waveH); g.closePath();
          g.fillStyle = alpha(tk.status.warning, 0.16); g.fill();
          g.beginPath(); g.moveTo(xf, waveH); g.lineTo(xb, FLAG_H + 2);
          g.strokeStyle = alpha(tk.status.warning, 0.7); g.lineWidth = 1; g.stroke();
        }
        g.fillStyle = tk.status.warning;
        g.fillRect(xa, FLAG_H - 3, xb - xa, 2);
        for (const [k, x] of [['loopStart', xa], ['loopEnd', xb]] as const) {
          g.fillStyle = on(k) ? '#ffffff' : tk.status.warning;
          g.fillRect(Math.round(x) - (on(k) ? 1.5 : 1), FLAG_H - 6, on(k) ? 3 : 2, waveH - FLAG_H + 6);
        }
      }
    }
    // Slices.
    if (slices) {
      slices.forEach((s, i) => {
        const x = Math.round(X(s)) + 0.5;
        if (x < -2 || x > width + 2) return;
        const act = (drag.current?.hit.kind === 'slice' && drag.current.hit.index === i) || (hover?.kind === 'slice' && hover.index === i);
        g.fillStyle = act ? '#ffffff' : 'rgba(249,226,175,0.75)';
        g.fillRect(x - 0.5, FLAG_H, act ? 2 : 1, waveH - FLAG_H);
        g.font = `600 9px ${fontFamily.mono}`; g.textBaseline = 'bottom'; g.textAlign = 'left';
        g.fillText(String(i + 1), x + 3, waveH - 2);
      });
    }
    // Start and end flags.
    const flag = (k: 'start' | 'end', u: number, text: string) => {
      const x = Math.round(X(u));
      const act = (drag.current?.hit.kind === 'marker' && drag.current.hit.key === k) || (hover?.kind === 'marker' && hover.key === k);
      g.fillStyle = act ? '#ffffff' : tk.text.primary;
      g.fillRect(x - 1, 0, 2, waveH);
      const w = 13;
      const left = k === 'start' ? x : x - w;
      g.fillRect(left, 0, w, FLAG_H - 2);
      g.fillStyle = bg; g.font = `700 9px ${fontFamily.ui}`; g.textBaseline = 'top'; g.textAlign = 'center';
      g.fillText(text, left + w / 2, 2);
    };
    flag('start', markers.start <= markers.end ? markers.start : markers.end, reverse ? 'E' : 'S');
    flag('end', markers.start <= markers.end ? markers.end : markers.start, reverse ? 'S' : 'E');
    // The overview strip: the whole sample, the view's window.
    if (!compact) {
      const oy = waveH + 4;
      g.fillStyle = 'rgba(205,214,244,0.05)'; g.fillRect(0, oy, width, OVERVIEW_H);
      const pk = peaks && peaks.length ? peaks : null;
      if (data || pk) {
        const cols = Math.max(1, Math.floor(width / 2));
        const mm = data ? smMinMax(data, 0, data.length, cols) : null;
        for (let i = 0; i < cols; i++) {
          const a = mm ? Math.max(-mm[i * 2], mm[i * 2 + 1]) : pk![Math.floor((i / cols) * pk!.length)];
          const u = i / cols;
          g.fillStyle = u >= lo && u <= hi ? alpha(tk.accent.base, 0.6) : 'rgba(205,214,244,0.25)';
          const h = Math.max(1, a * (OVERVIEW_H - 2));
          g.fillRect(i * 2, oy + (OVERVIEW_H - h) / 2, 1.5, h);
        }
      }
      if (v1 - v0 < 0.999) {
        g.strokeStyle = 'rgba(205,214,244,0.6)'; g.lineWidth = 1;
        g.strokeRect(v0 * width + 0.5, oy + 0.5, Math.max(3, (v1 - v0) * width - 1), OVERVIEW_H - 1);
      }
    }
  }, [width, total, waveH, view, data, peaks, markers.start, markers.end, markers.loopStart, markers.loopEnd, loop, xfade, slices, hover, tk, duration, reverse, compact]);

  // ── Pointer ────────────────────────────────────────────────────────────────
  const uAt = useCallback((clientX: number) => {
    const c = ref.current!, r = c.getBoundingClientRect();
    const [v0, v1] = viewRef.current;
    return v0 + ((clientX - r.left) / Math.max(1, r.width)) * (v1 - v0);
  }, []);
  const pick = (e: { clientX: number; clientY: number }): Hit => {
    const c = ref.current!, r = c.getBoundingClientRect();
    const [v0, v1] = viewRef.current;
    const px = (u: number) => r.left + ((u - v0) / Math.max(1e-6, v1 - v0)) * r.width;
    const y = e.clientY - r.top;
    const reach = 7;
    let best: Hit = { kind: 'pan' }, bd = reach;
    const lo = Math.min(markers.start, markers.end), hi = Math.max(markers.start, markers.end);
    const keys: Array<[MarkerKey, number]> = [['start', lo], ['end', hi]];
    if (loop) keys.push(['loopStart', Math.max(lo, Math.min(hi, markers.loopStart))], ['loopEnd', Math.min(hi, Math.max(lo, markers.loopEnd))]);
    // Flags (the top band) win over loop handles and slices.
    for (const [k, u] of keys) {
      const d = Math.abs(px(u) - e.clientX) - (y < FLAG_H && (k === 'start' || k === 'end') ? 4 : 0);
      if (d < bd) { bd = d; best = { kind: 'marker', key: k }; }
    }
    slices?.forEach((s, i) => { const d = Math.abs(px(s) - e.clientX); if (d < bd) { bd = d; best = { kind: 'slice', index: i }; } });
    return best;
  };
  const snapTo = (u: number) => {
    const x = Math.max(0, Math.min(1, u));
    return snap && data ? smSnap(data, x) : x;
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    // The overview strip: jump the window there and drag it.
    if (!compact && e.clientY - r.top > waveH) {
      const u = (e.clientX - r.left) / r.width;
      const [v0, v1] = viewRef.current, w = v1 - v0;
      const nv: [number, number] = [Math.max(0, Math.min(1 - w, u - w / 2)), 0];
      nv[1] = nv[0] + w;
      setView(nv);
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { hit: { kind: 'pan' }, x0: e.clientX, v0: nv, moved: true, overview: true };
      return;
    }
    const hit = pick(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { hit, x0: e.clientX, v0: viewRef.current, moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) { setHover(h => { const n = pick(e); return h && n.kind === h.kind && (n.kind !== 'marker' || (h.kind === 'marker' && h.key === n.key)) && (n.kind !== 'slice' || (h.kind === 'slice' && h.index === n.index)) ? h : n; }); return; }
    d.moved = d.moved || Math.abs(e.clientX - d.x0) > 2;
    if (!d.moved) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (d.hit.kind === 'pan') {
      const overview = d.overview;
      const w = d.v0[1] - d.v0[0];
      if (w >= 0.999 && !overview) return;
      const du = ((e.clientX - d.x0) / r.width) * (overview ? 1 : -w);
      const a = Math.max(0, Math.min(1 - w, d.v0[0] + du));
      setView([a, a + w]);
      return;
    }
    const u = snapTo(uAt(e.clientX));
    if (d.hit.kind === 'slice' && slices && onSlices) {
      const i = d.hit.index;
      const next = [...slices];
      const prev = i > 0 ? next[i - 1] + 0.0005 : 0, after = i + 1 < next.length ? next[i + 1] - 0.0005 : 0.9995;
      next[i] = i === 0 && next[0] === 0 ? 0 : Math.max(prev, Math.min(after, u));
      onSlices(next);
      return;
    }
    if (d.hit.kind !== 'marker') return;
    const k = d.hit.key;
    const lo = Math.min(markers.start, markers.end), hi = Math.max(markers.start, markers.end);
    if (k === 'start') onChange({ start: Math.min(u, hi - 0.0005) });
    else if (k === 'end') onChange({ end: Math.max(u, lo + 0.0005) });
    else if (k === 'loopStart') onChange({ loopStart: Math.max(lo, Math.min(u, Math.min(hi, markers.loopEnd) - 0.0005)) });
    else onChange({ loopEnd: Math.min(hi, Math.max(u, Math.max(lo, markers.loopStart) + 0.0005)) });
  };
  const onUp = () => { drag.current = null; };
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!compact && e.clientY - r.top > waveH) { setView([0, 1]); return; }
    if (!slices || !onSlices) return;
    const hit = pick(e);
    if (hit.kind === 'slice') { if (hit.index > 0 || slices.length > 1) onSlices(slices.filter((_, i) => i !== hit.index)); return; }
    const u = snapTo(uAt(e.clientX));
    onSlices([...slices, u].sort((a, b) => a - b));
  };

  // Zoom around the pointer (⌘/Ctrl + wheel, or a pinch), scroll with Shift or a sideways swipe.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      const [v0, v1] = viewRef.current, w = v1 - v0;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const at = v0 + ((e.clientX - r.left) / r.width) * w;
        const minW = data ? Math.min(1, 64 / data.length) : 0.002;
        const nw = Math.max(minW, Math.min(1, w * Math.exp(e.deltaY * 0.01)));
        const a = Math.max(0, Math.min(1 - nw, at - ((at - v0) / w) * nw));
        setView([a, a + nw]);
        return;
      }
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      if (!dx || w >= 0.999) return;
      e.preventDefault();
      const a = Math.max(0, Math.min(1 - w, v0 + (dx / c.clientWidth) * w));
      setView([a, a + w]);
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, [data]);

  const zoom = (f: number) => {
    const [v0, v1] = view, w = v1 - v0, c = (v0 + v1) / 2;
    const minW = data ? Math.min(1, 64 / data.length) : 0.002;
    const nw = Math.max(minW, Math.min(1, w * f));
    const a = Math.max(0, Math.min(1 - nw, c - nw / 2));
    setView([a, a + nw]);
  };
  const zoomTo = () => {
    const lo = Math.min(markers.start, markers.end), hi = Math.max(markers.start, markers.end), pad = (hi - lo) * 0.06;
    const a = Math.max(0, lo - pad), b = Math.min(1, hi + pad);
    setView([a, b]);
  };
  const cursor = hover?.kind === 'marker' || hover?.kind === 'slice' ? 'ew-resize' : view[1] - view[0] < 0.999 ? 'grab' : 'default';
  const secs = (u: number) => (duration ? `${(u * duration).toFixed(duration < 2 ? 3 : 2)} s` : `${(u * 100).toFixed(1)}%`);
  const lo = Math.min(markers.start, markers.end), hi = Math.max(markers.start, markers.end);
  return (
    <div data-sampler-wave style={{ marginTop: 6 }}>
      <div ref={wrap} style={{ position: 'relative', borderRadius: radius.md, overflow: 'hidden', background: tk.bg.render }}>
        <canvas
          ref={ref}
          aria-label={label ?? 'Sample: drag S and E to set the region, the loop brace for the loop'}
          title={`Drag S / E${loop ? ', the loop ends' : ''}${slices ? ', the slices (double-click adds or removes one)' : ''}. ⌘/Ctrl + scroll zooms, Shift + scroll moves. ${snap ? 'Snapping to zero crossings.' : ''}`}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { if (!drag.current) setHover(null); }}
          onDoubleClick={onDouble}
          style={{ display: 'block', width: '100%', height: total, cursor, touchAction: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, color: tk.text.faint, font: `500 10px ${fontFamily.mono}` }}>
        <span title="Start">S {secs(lo)}</span>
        <span style={{ flex: 1, textAlign: 'center', color: tk.text.muted }}>{duration ? `${(duration * (hi - lo)).toFixed(3)} s` : ''}{loop ? ` · loop ${secs(Math.max(lo, markers.loopStart))}–${secs(Math.min(hi, markers.loopEnd))}` : ''}</span>
        <span title="End">E {secs(hi)}</span>
        {onSnap && (
          <button type="button" aria-pressed={snap} onClick={() => onSnap(!snap)} title="Snap markers to zero crossings, so a cut never clicks"
            style={{ border: 0, borderRadius: 4, padding: '1px 5px', marginLeft: 4, cursor: 'pointer', font: `600 9.5px ${fontFamily.ui}`, letterSpacing: '0.04em', background: snap ? alpha(tk.accent.base, 0.22) : 'transparent', color: snap ? tk.accent.text : tk.text.faint }}>
            SNAP
          </button>
        )}
        {!compact && (
          <>
            <IconButton icon="minus" label="Zoom out" size="sm" onClick={() => zoom(1.6)} />
            <IconButton icon="plus" label="Zoom in" size="sm" onClick={() => zoom(1 / 1.6)} />
            <IconButton icon="fit" label="Zoom to the region (double-click the strip below to see all)" size="sm" onClick={zoomTo} />
          </>
        )}
      </div>
    </div>
  );
}
