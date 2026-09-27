/**
 * SpectrumView — the live spectrum on a log frequency axis (20 Hz – 20 kHz)
 * and a dB scale, with the setup's audio readers on it.
 *
 * Each reader is a dot at its frequency and at the level where it reads 1;
 * the shaded column under it is its band (its width in octaves) and fills
 * with its level, 40 dB from empty to full. Click an empty spot to add a
 * reader there; drag a dot sideways to retune it, up and down for its gain.
 * With the view focused, the arrow keys move the selected reader.
 *
 * Drawn on a canvas that stays dark in both themes, like the other render
 * surfaces. It reads audioReaderBank itself, every frame, while it shows.
 */
import { useEffect, useRef } from 'react';
import type { AudioReader } from '../../types/play';
import { THEMES, alpha, fontFamily, radius } from '../../theme/tokens';
import {
  PLOT_DB_MAX, PLOT_DB_MIN, READER_RANGE_DB, SPEC_TICKS, bandDb, formatHz, gainForTopDb, hzToUnit, placeLabels, readerBand, readerTopDb, unitToHz,
} from '../../play/audioReaders';
import { audioReaderBank } from '../../lib/audioReaderBank';

const DARK = THEMES.dark;
/** Minor gridlines between the labelled ticks. */
const MINOR_HZ = [30, 40, 60, 70, 80, 90, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000];
const DB_LINES = [-20, -40, -60, -80];
type Pad = { l: number; r: number; t: number; b: number };
const PAD_FULL: Pad = { l: 30, r: 10, t: 20, b: 20 };
/** The compact view (a layer card's mini spectrum): no dB scale, labels tucked under the plot. */
const PAD_COMPACT: Pad = { l: 6, r: 6, t: 8, b: 14 };
/** How near a dot a press has to land to take it: 16 px for a mouse, 22 px for a finger (a 44 px target). */
const HIT = { mouse: 16, touch: 22 };

/** Is (x, y) on the plot (or just above it, where the dots' labels go)? */
const inPlot = (x: number, y: number, W: number, H: number, PAD: Pad) => x >= PAD.l && x <= W - PAD.r && y >= PAD.t - 6 && y <= H - PAD.b;

/** The reader whose dot is nearest (x, y), within `slop` px. */
function readerAt(readers: readonly AudioReader[], W: number, H: number, x: number, y: number, slop: number, PAD: Pad): AudioReader | null {
  const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
  let best: AudioReader | null = null, bd = slop;
  for (const r of readers) {
    const rx = PAD.l + hzToUnit(r.hz) * pw;
    const top = Math.max(PLOT_DB_MIN, Math.min(PLOT_DB_MAX, readerTopDb(r.gain)));
    const ry = PAD.t + ((PLOT_DB_MAX - top) / (PLOT_DB_MAX - PLOT_DB_MIN)) * ph;
    const d = Math.hypot(x - rx, y - ry);
    if (d <= bd) { bd = d; best = r; }
  }
  return best;
}

const css = (c: readonly number[], a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

export interface SpectrumViewProps {
  readers: readonly AudioReader[];
  selected: string;
  peakHold: boolean;
  height: number;
  /** Adding is off at the limit (the hint says so). */
  canAdd: boolean;
  onSelect: (id: string) => void;
  onAdd: (hz: number, topDb: number) => void;
  onMove: (id: string, hz: number, gain: number) => void;
  /** A small version for a layer card: no dB scale, fewer labels. */
  compact?: boolean;
  /** Draw this spectrum instead of the readers' input's (a Video layer's own sound). Null: silent. */
  spectrum?: () => { freq: Float32Array; sampleRate: number } | null;
  /** What it says while there is no sound. */
  emptyText?: string;
}

export function SpectrumView(props: SpectrumViewProps) {
  const { height } = props;
  const PAD = props.compact ? PAD_COMPACT : PAD_FULL;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  useEffect(() => { live.current = props; });
  const st = useRef({
    w: 0, h: 0, dpr: 1,
    disp: null as Float32Array | null, peak: null as Float32Array | null, peakAge: null as Float32Array | null,
    hover: null as { x: number; y: number } | null,
    drag: null as { id: string; pointer: number } | null,
    /** A press on an empty spot: it adds a reader when it lifts without moving (so a swipe doesn't). */
    tap: null as { x: number; y: number; pointer: number } | null,
    last: 0,
  });

  // Size the canvas to its box (and the screen's pixel density).
  useEffect(() => {
    const el = wrap.current, cv = canvas.current;
    if (!el || !cv) return;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth, h = height;
      st.current.w = w; st.current.h = h; st.current.dpr = dpr;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
      st.current.disp = null; st.current.peak = null; st.current.peakAge = null;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // Draw every frame while showing.
  useEffect(() => {
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      draw(now);
    };
    const draw = (now: number) => {
      const cv = canvas.current, s = st.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx || s.w <= 0) return;
      const dt = s.last ? Math.min(0.1, (now - s.last) / 1000) : 1 / 60;
      s.last = now;
      const { readers, selected, peakHold, canAdd, compact } = live.current;
      const PAD = compact ? PAD_COMPACT : PAD_FULL;
      const W = s.w, H = s.h;
      const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
      const xOf = (hz: number) => PAD.l + hzToUnit(hz) * pw;
      const yOf = (db: number) => PAD.t + ((PLOT_DB_MAX - Math.max(PLOT_DB_MIN, Math.min(PLOT_DB_MAX, db))) / (PLOT_DB_MAX - PLOT_DB_MIN)) * ph;
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = DARK.bg.render;
      roundRect(ctx, 0, 0, W, H, radius.md);
      ctx.fill();

      // Grid: minor frequencies, the labelled ones, and dB lines.
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.beginPath();
      for (const hz of MINOR_HZ) { const x = Math.round(xOf(hz)) + 0.5; ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      for (const t of SPEC_TICKS) { const x = Math.round(xOf(t.hz)) + 0.5; ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); }
      for (const db of DB_LINES) { const y = Math.round(yOf(db)) + 0.5; ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); }
      ctx.stroke();
      ctx.font = `500 ${compact ? 8.5 : 9.5}px ${fontFamily.ui}`;
      ctx.fillStyle = DARK.text.faint;
      ctx.textBaseline = 'top';
      for (const t of SPEC_TICKS) {
        const x = xOf(t.hz);
        ctx.textAlign = t.hz === 20 ? 'left' : t.hz === 20000 ? 'right' : 'center';
        // Narrow views keep every other label.
        if (pw < 360 && (t.hz === 50 || t.hz === 500 || t.hz === 5000)) continue;
        if (compact && pw < 240 && (t.hz === 20 || t.hz === 200 || t.hz === 2000 || t.hz === 20000)) continue;
        ctx.fillText(t.label, x, PAD.t + ph + (compact ? 3 : 5));
      }
      if (!compact) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const db of DB_LINES) ctx.fillText(`${db}`, PAD.l - 5, yOf(db));
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('dB', 6, 5);
      ctx.textAlign = 'right';
      ctx.fillText('Hz', W - PAD.r, 5);
      }

      // Reader bands, behind the curve.
      for (const r of readers) {
        const { lo, hi } = readerBand(r.hz, r.width);
        const x0 = xOf(lo), x1 = Math.max(x0 + 4, xOf(hi));
        ctx.fillStyle = css(r.colour, r.id === selected ? 0.13 : 0.07);
        ctx.fillRect(x0, PAD.t, x1 - x0, ph);
      }

      // The spectrum: one point every 2 px, each the mean power over its slice of the log axis.
      audioReaderBank.update();
      const spec = live.current.spectrum ? live.current.spectrum() : audioReaderBank.spectrum();
      const n = Math.max(16, Math.floor(pw / 2));
      if (!s.disp || s.disp.length !== n) { s.disp = new Float32Array(n).fill(PLOT_DB_MIN); s.peak = new Float32Array(n).fill(PLOT_DB_MIN); s.peakAge = new Float32Array(n); }
      const disp = s.disp, peak = s.peak!, age = s.peakAge!;
      const octPer = Math.log2(20000 / 20) / (n - 1);
      const k = 1 - Math.exp(-dt / 0.06);
      for (let i = 0; i < n; i++) {
        const hz = unitToHz(i / (n - 1));
        const half = Math.pow(2, Math.max(octPer, 1 / 48) / 2);
        const db = spec ? bandDb(spec.freq, spec.sampleRate, hz / half, hz * half) : PLOT_DB_MIN - 10;
        disp[i] += (Math.max(PLOT_DB_MIN - 10, db) - disp[i]) * k;
        // Peaks hold for a second, then fall 20 dB a second.
        if (disp[i] >= peak[i]) { peak[i] = disp[i]; age[i] = 0; }
        else { age[i] += dt; if (age[i] > 1) peak[i] = Math.max(disp[i], peak[i] - 20 * dt); }
      }
      const px = (i: number) => PAD.l + (i / (n - 1)) * pw;
      const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ph);
      grad.addColorStop(0, alpha(DARK.accent.base, 0.42));
      grad.addColorStop(1, alpha(DARK.accent.base, 0.04));
      ctx.beginPath();
      ctx.moveTo(px(0), PAD.t + ph);
      for (let i = 0; i < n; i++) ctx.lineTo(px(i), yOf(disp[i]));
      ctx.lineTo(px(n - 1), PAD.t + ph);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const y = yOf(disp[i]); if (i === 0) ctx.moveTo(px(i), y); else ctx.lineTo(px(i), y); }
      ctx.strokeStyle = DARK.accent.base;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
      if (peakHold && spec) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) { const y = yOf(peak[i]); if (i === 0) ctx.moveTo(px(i), y); else ctx.lineTo(px(i), y); }
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Readers: the level filling the band column, the full line, the dot and the name.
      for (const r of readers) {
        const { lo, hi } = readerBand(r.hz, r.width);
        const x0 = xOf(lo), x1 = Math.max(x0 + 4, xOf(hi));
        const top = readerTopDb(r.gain);
        const yTop = yOf(top), yFloor = yOf(top - READER_RANGE_DB);
        const lv = audioReaderBank.value(r.id) ?? 0;
        const yLv = yFloor - lv * (yFloor - yTop);
        ctx.fillStyle = css(r.colour, 0.5);
        ctx.fillRect(x0, yLv, x1 - x0, yFloor - yLv);
        ctx.strokeStyle = css(r.colour, 0.8);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x0, Math.round(yTop) + 0.5); ctx.lineTo(x1, Math.round(yTop) + 0.5); ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(x0, Math.round(yFloor) + 0.5); ctx.lineTo(x1, Math.round(yFloor) + 0.5); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }
      // Dots, then their name tags: the selected one's first, none over another tag or dot.
      const order = [...readers].sort((a, b) => (a.id === selected ? -1 : b.id === selected ? 1 : 0));
      ctx.font = `600 10px ${fontFamily.ui}`;
      const tags = placeLabels(order.map(r => ({ x: xOf(r.hz), y: yOf(readerTopDb(r.gain)), w: ctx.measureText(r.name).width + 8 })), W, H);
      for (const r of order) {
        const x = xOf(r.hz), y = yOf(readerTopDb(r.gain));
        const sel = r.id === selected;
        ctx.beginPath();
        ctx.arc(x, y, sel ? 7.5 : 6, 0, Math.PI * 2);
        ctx.fillStyle = css(r.colour);
        ctx.fill();
        ctx.lineWidth = sel ? 2.5 : 2;
        ctx.strokeStyle = sel ? '#ffffff' : DARK.bg.render;
        ctx.stroke();
      }
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      order.forEach((r, i) => {
        const b = tags[i];
        if (!b) return;
        ctx.fillStyle = 'rgba(13,13,18,0.78)';
        roundRect(ctx, b.x, b.y, b.w, b.h, 4);
        ctx.fill();
        ctx.fillStyle = r.id === selected ? '#ffffff' : DARK.text.secondary;
        ctx.fillText(r.name, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      });

      // Where the pointer is, and what a click there does.
      if (s.hover && !s.drag && inPlot(s.hover.x, s.hover.y, W, H, PAD)) {
        const hz = unitToHz((s.hover.x - PAD.l) / pw);
        const db = PLOT_DB_MAX - ((s.hover.y - PAD.t) / ph) * (PLOT_DB_MAX - PLOT_DB_MIN);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(s.hover.x) + 0.5, PAD.t); ctx.lineTo(Math.round(s.hover.x) + 0.5, PAD.t + ph); ctx.stroke();
        ctx.font = `500 10px ${fontFamily.mono}`;
        ctx.fillStyle = DARK.text.muted;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right';
        const over = readerAt(readers, W, H, s.hover.x, s.hover.y, HIT.mouse, PAD);
        ctx.fillText(compact ? formatHz(hz) : `${formatHz(hz)} · ${Math.round(db)} dB${over ? '' : canAdd ? '  ·  click to add a reader' : '  ·  16 readers at most'}`, W - PAD.r - (compact ? 2 : 22), compact ? 2 : 5);
      }
      if (!spec) {
        ctx.font = `500 ${compact ? 11 : 12}px ${fontFamily.ui}`;
        ctx.fillStyle = DARK.text.faint;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(live.current.emptyText ?? 'No sound coming in', PAD.l + pw / 2, PAD.t + ph / 2);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hitReader = (x: number, y: number, slop: number) => readerAt(live.current.readers, st.current.w, st.current.h, x, y, slop, PAD);
  const local = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const at = (x: number, y: number) => {
    const s = st.current, pw = s.w - PAD.l - PAD.r, ph = s.h - PAD.t - PAD.b;
    const hz = unitToHz((x - PAD.l) / pw);
    const db = PLOT_DB_MAX - (Math.max(0, Math.min(ph, y - PAD.t)) / ph) * (PLOT_DB_MAX - PLOT_DB_MIN);
    return { hz, db };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = local(e);
    const hit = hitReader(p.x, p.y, e.pointerType === 'touch' ? HIT.touch : HIT.mouse);
    if (hit) {
      e.preventDefault();
      live.current.onSelect(hit.id);
      st.current.drag = { id: hit.id, pointer: e.pointerId };
      try { canvas.current?.setPointerCapture(e.pointerId); } catch { /* moves still arrive while over the canvas */ }
      return;
    }
    if (!inPlot(p.x, p.y, st.current.w, st.current.h, PAD) || !live.current.canAdd) return;
    st.current.tap = { x: p.x, y: p.y, pointer: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    st.current.hover = e.pointerType === 'touch' ? null : p;
    const t = st.current.tap;
    if (t && t.pointer === e.pointerId && Math.hypot(p.x - t.x, p.y - t.y) > 8) st.current.tap = null;
    const d = st.current.drag;
    if (!d || d.pointer !== e.pointerId) return;
    const { hz, db } = at(p.x, p.y);
    live.current.onMove(d.id, hz, gainForTopDb(db));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (st.current.drag?.pointer === e.pointerId) st.current.drag = null;
    const t = st.current.tap;
    st.current.tap = null;
    if (e.type !== 'pointerup' || !t || t.pointer !== e.pointerId || !live.current.canAdd) return;
    const { hz, db } = at(t.x, t.y);
    live.current.onAdd(hz, db);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = live.current.readers.find(x => x.id === live.current.selected);
    if (!r) return;
    const big = e.shiftKey;
    let hz = r.hz, gain = r.gain;
    if (e.key === 'ArrowLeft') hz = r.hz / Math.pow(2, big ? 1 / 3 : 1 / 24);
    else if (e.key === 'ArrowRight') hz = r.hz * Math.pow(2, big ? 1 / 3 : 1 / 24);
    else if (e.key === 'ArrowUp') gain = r.gain - (big ? 6 : 1);
    else if (e.key === 'ArrowDown') gain = r.gain + (big ? 6 : 1);
    else return;
    e.preventDefault();
    live.current.onMove(r.id, Math.max(20, Math.min(20000, hz)), gain);
  };

  return (
    <div ref={wrap} style={{ position: 'relative', width: '100%', height }}>
      <canvas
        ref={canvas}
        tabIndex={0}
        role="img"
        aria-label="Live spectrum with audio readers. Click to add a reader; drag a dot to move it; arrow keys move the selected one."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { st.current.hover = null; }}
        onKeyDown={onKeyDown}
        style={{ display: 'block', borderRadius: radius.md, cursor: 'crosshair', touchAction: 'none', outline: 'none' }}
      />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
