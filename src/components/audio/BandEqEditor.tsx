/**
 * The Audio Source window's bands as an equaliser (after FabFilter Pro-Q, for isolating rather than boosting):
 *
 * - **The analyser**: the live spectrum, grey, on a log frequency axis (20 Hz – 20 kHz, labelled), with a falling
 *   peak-hold line. Hover shows the frequency and the nearest note ("440 Hz · A4").
 * - **Each band's response**: a 0 dB line near the top, a dB scale on the right (down to −48), and each band drawn
 *   as the exact magnitude response of the biquads Solo / Hear hovered play it through (lib/audioTools/bandFilter.ts),
 *   worked out per pixel: a Band peaks at 0 dB and is −3 dB at its lo / hi (so a Q 14 band is a narrow spike), a cut
 *   is flat at 0 dB and rolls off at its true slope past its corner (−3 dB). Filled under it in its colour (the
 *   selected brighter); the bands together (the most any lets through: each is its own output) are the bright line.
 * - **Each band is a handle** on its curve (a Band's peak, a cut's corner). Drag a handle sideways for its
 *   frequency, up / down (or scroll over it) for a Band's width; scrolling over a cut steps its slope.
 * - **Double-click** empty spectrum to add a band there. Click a handle (or right-click it) for its panel, floating
 *   by the handle: name, Frequency and Width (type, or drag on the label), Shape, Slope, colour, Solo, Delete.
 * - **Keys**: Delete removes the selected band (anywhere in the window: AudioSourceWindow.tsx); the view focused, ← → move it a semitone (Shift: a third of an
 *   octave), ↑ ↓ narrow / widen it (a cut: its slope), Esc lets go.
 * - **Hear hovered** (the window's switch): only the frequencies under the pointer play, the band under it, else a
 *   third of an octave. **Solo** plays just the selected band until switched off. Both through engine.auditionBand.
 *
 * The band's lo / hi (lib/audioTools/bands.ts) stay what its Value and Trigger measure; moving one is live (no
 * recompile). Sums in bandEq.ts. Drawn in the shared audio animation loop (drawLoop.ts): no React render per frame.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { audioToolsEngine } from '../../lib/audioTools/engine';
import { BAND_SHAPES, BAND_SLOPES, type AudioBandShape, type AudioBandSlope, type AudioBandSpec } from '../../lib/audioTools/bands';
import { NumberInput } from '../NodeGraph/NumberInput';
import { Segmented } from '../ui/Choice';
import { Button } from '../ui/Button';
import { addDrawer } from './drawLoop';
import {
  DEFAULT_SAMPLE_RATE, FREQ_LABELS, FREQ_MINOR, MAX_WIDTH_OCT, MIN_WIDTH_OCT, SHAPE_HINTS, SHAPE_LABELS, bandGains, bandRange, bandResponse,
  bandView, dragWidth, fmtFreq, hzToX, newBandAt, noteName, responseDb, wheelSlope, wheelWidth, widthToQ, withFreq, withShape, withWidth, xToHz,
} from './bandEq';

/** The spectrum's dB range (analyser dB, about what AnalyserNode gives a loud mix), drawn over the whole height. */
const DB_TOP = -10, DB_BOTTOM = -100;
/**
 * The bands' scale (labelled on the right): the filters' gain, 0 dB near the top (a band passes there) down to
 * EQ_BOTTOM_DB at the bottom. Nothing boosts, so above 0 dB is only a little headroom.
 */
const EQ_TOP_DB = 9, EQ_BOTTOM_DB = -48;
const EQ_LINES = [0, -12, -24, -36];
const AXIS = 18, TOP = 8;
const POINTS = 240;
const HANDLE_R = 8, HIT = 14;
const PANEL_W = 300;

export type Hearing = { lo: number; hi: number; name?: string } | null;

/** Size a canvas to its box at the device pixel ratio; the 2D context in CSS pixels. */
function fit(c: HTMLCanvasElement | null): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  if (!c) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

/** Where a band's gain (dB) sits in a view `h` tall; far below the scale it sits just under the bottom (clipped). */
const eqY = (db: number, h: number) => TOP + ((EQ_TOP_DB - Math.max(EQ_BOTTOM_DB - 6, Math.min(EQ_TOP_DB, db))) / (EQ_TOP_DB - EQ_BOTTOM_DB)) * (h - AXIS - TOP);
/** A band's handle sits on its curve: a Band's peak (0 dB), a cut's corner (−3 dB). */
const handleY = (b: AudioBandSpec, h: number, sr: number) => eqY(responseDb(bandResponse(b, bandView(b).freq, sr)), h);
/** "Freq" across the view for each CSS pixel (the curves are worked out per pixel, so a Q-14 band keeps its shape). */
function pixelFreqs(w: number): Float64Array {
  const n = Math.max(2, Math.round(w) + 1), f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = xToHz(i / (n - 1));
  return f;
}
/** `#rrggbb` + an alpha 0–1 as `#rrggbbaa`. */
const withAlpha = (hex: string, a: number) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;

type Drag = { id: string; dx: number; y0: number; width0: number; moved: boolean };

export function BandEqEditor({
  nodeId, bands, selected, onSelect, patchBand, setBands, onAdd, hearHover, onHearing, height = 240,
}: {
  nodeId: string;
  bands: AudioBandSpec[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  patchBand: (id: string, p: Partial<AudioBandSpec>, structural?: boolean) => void;
  setBands: (next: AudioBandSpec[], structural: boolean) => void;
  /** Add a Band over lo–hi (the window names and colours it), selected. */
  onAdd: (range: { lo: number; hi: number }) => void;
  hearHover: boolean;
  /** What is playing through Hear hovered or Solo, for the window's label. */
  onHearing: (h: Hearing) => void;
  height?: number;
}) {
  const tk = useTokens();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const [solo, setSolo] = useState<string | null>(null);
  const [boxW, setBoxW] = useState(800);
  /** The sample rate the bands are heard at (their curves' shape near the top depends on it). */
  const srRef = useRef(DEFAULT_SAMPLE_RATE);
  const latest = useRef({ bands, selected, solo, tk });
  useEffect(() => { latest.current = { bands, selected, solo, tk }; });
  const selBand = bands.find(b => b.id === selected) ?? null;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── The drawing, every frame ──
  useEffect(() => {
    const cur = new Float32Array(POINTS), peak = new Float32Array(POINTS).fill(DB_BOTTOM);
    cur.fill(DB_BOTTOM);
    // Each band's gain per pixel, worked out again only when the band or the view's width changes.
    let freqs: Float64Array | null = null;
    const curves = new Map<string, { key: string; gains: Float32Array }>();
    let seen = -1;
    return addDrawer(() => {
      const sp = fit(canvasRef.current);
      if (!sp) return;
      const { g, w, h } = sp;
      const L = latest.current, t = L.tk;
      const v = audioToolsEngine.sourceView(nodeId);
      const sh = h - AXIS;
      const dbY = (db: number) => TOP + ((DB_TOP - db) / (DB_TOP - DB_BOTTOM)) * (sh - TOP);
      g.fillStyle = t.bg.render; g.fillRect(0, 0, w, h);
      // Grid: minor and labelled frequencies, dB lines.
      g.fillStyle = 'rgba(205,214,244,0.05)';
      for (const hz of FREQ_MINOR) g.fillRect(Math.round(hzToX(hz) * w), TOP, 1, sh - TOP);
      g.font = `10px ${fontFamily.ui}`; g.textBaseline = 'top';
      for (const [hz, label] of FREQ_LABELS) {
        const x = Math.round(hzToX(hz) * w);
        g.fillStyle = 'rgba(205,214,244,0.11)'; g.fillRect(x, TOP, 1, sh - TOP);
        g.fillStyle = 'rgba(205,214,244,0.55)';
        g.textAlign = hz === 20 ? 'left' : hz === 20000 ? 'right' : 'center';
        g.fillText(label, hz === 20 ? x + 3 : hz === 20000 ? x - 3 : x, sh + 4);
      }
      // The bands' dB scale on the right; 0 dB is drawn after the analyser, over it.
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const db of EQ_LINES) {
        const y = Math.round(eqY(db, h));
        if (db !== 0) { g.fillStyle = 'rgba(205,214,244,0.06)'; g.fillRect(0, y, w, 1); }
        g.fillStyle = 'rgba(205,214,244,0.45)'; g.fillText(db === 0 ? '0 dB' : `${db}`, w - 4, y - 7);
      }
      // ── The analyser ──
      if (v && audioToolsEngine.frame !== seen) {
        seen = audioToolsEngine.frame;
        const nb = v.freq.length, binHz = v.sampleRate / 2 / Math.max(1, nb);
        for (let i = 0; i < POINTS; i++) {
          const f0 = xToHz(i / POINTS) / binHz, f1 = xToHz((i + 1) / POINTS) / binHz;
          let db: number;
          if (f1 - f0 >= 1) {
            db = -Infinity;
            for (let k = Math.floor(f0); k <= Math.min(nb - 1, Math.ceil(f1) - 1); k++) db = Math.max(db, v.freq[k]);
          } else {
            const c = (f0 + f1) / 2, k = Math.min(nb - 2, Math.floor(c)), u = c - k;
            db = v.freq[Math.max(0, k)] * (1 - u) + v.freq[Math.max(0, k + 1)] * u;
          }
          if (!Number.isFinite(db)) db = DB_BOTTOM;
          db = Math.max(DB_BOTTOM, Math.min(DB_TOP + 6, db));
          // Fast up, slower down, like an analyser's ballistics.
          cur[i] = db > cur[i] ? cur[i] * 0.35 + db * 0.65 : cur[i] * 0.8 + db * 0.2;
          peak[i] = Math.max(cur[i], peak[i] - 0.35);
        }
      }
      const path = (vals: Float32Array) => {
        g.beginPath();
        for (let i = 0; i < POINTS; i++) { const x = ((i + 0.5) / POINTS) * w, y = dbY(vals[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      };
      // The analyser: grey, behind everything.
      path(cur); g.lineTo(w, sh); g.lineTo(0, sh); g.closePath(); g.fillStyle = 'rgba(205,214,244,0.13)'; g.fill();
      path(cur); g.strokeStyle = 'rgba(205,214,244,0.4)'; g.lineWidth = 1; g.stroke();
      path(peak); g.strokeStyle = 'rgba(205,214,244,0.18)'; g.lineWidth = 1; g.stroke();
      // The 0 dB line: what a band lets through untouched.
      const y0 = eqY(0, h);
      g.fillStyle = 'rgba(205,214,244,0.32)'; g.fillRect(0, Math.round(y0), w, 1);
      // ── The bands: each band's response (the filters Solo plays), filled under it, then their union, then handles ──
      const sr = v?.sampleRate || DEFAULT_SAMPLE_RATE;
      srRef.current = sr;
      if (!freqs || freqs.length !== Math.max(2, Math.round(w) + 1)) { freqs = pixelFreqs(w); curves.clear(); }
      const fx = freqs, n = fx.length, xs = (i: number) => (i / (n - 1)) * w;
      const live = new Set<string>();
      const curveOf = (b: AudioBandSpec): Float32Array => {
        live.add(b.id);
        const key = `${b.lo}|${b.hi}|${b.shape}|${b.slope}|${sr}`;
        let c = curves.get(b.id);
        if (!c || c.key !== key) { c = { key, gains: bandGains(b, fx, sr) }; curves.set(b.id, c); }
        return c.gains;
      };
      const trace = (gains: Float32Array) => {
        g.beginPath();
        for (let i = 0; i < n; i++) { const y = eqY(responseDb(gains[i]), h); if (i) g.lineTo(xs(i), y); else g.moveTo(xs(i), y); }
      };
      const now = performance.now();
      // Inside the plot only: a curve far below the scale runs off its bottom rather than along it.
      g.save(); g.beginPath(); g.rect(0, TOP, w, sh - TOP); g.clip();
      for (const b of L.bands) {
        const sel = b.id === L.selected, lv = v?.bands.get(b.id), gains = curveOf(b);
        const flash = lv && b.trigger ? Math.max(0, 1 - (now - lv.hitAt) / 250) : 0;
        trace(gains); g.lineTo(w, sh + 8); g.lineTo(0, sh + 8); g.closePath();
        const fill = g.createLinearGradient(0, y0, 0, sh);
        const a = (sel ? 0.34 : 0.17) + flash * 0.3;
        fill.addColorStop(0, withAlpha(b.color, a)); fill.addColorStop(1, withAlpha(b.color, a * 0.06));
        g.fillStyle = fill; g.fill();
        if (!sel) { trace(gains); g.strokeStyle = withAlpha(b.color, 0.7); g.lineWidth = 1.25; g.stroke(); }
      }
      for (const id of [...curves.keys()]) if (!live.has(id)) curves.delete(id);
      // The bands together: each is its own output, so what any of them passes (the most any lets through).
      if (L.bands.length > 1) {
        const all = L.bands.map(curveOf), sum = new Float32Array(n);
        for (let i = 0; i < n; i++) { let m = 0; for (const c of all) if (c[i] > m) m = c[i]; sum[i] = m; }
        trace(sum); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.5; g.stroke();
      }
      // The selected band's own curve on top.
      const selB = L.bands.find(b => b.id === L.selected);
      if (selB) { trace(curveOf(selB)); g.strokeStyle = selB.color; g.lineWidth = 2; g.stroke(); }
      g.restore();
      // Each band's level: a bar under its range (its −3 dB points), as long as the level.
      for (const b of L.bands) {
        const lv = v?.bands.get(b.id);
        if (!lv) continue;
        const x0 = hzToX(b.lo) * w, x1 = hzToX(b.hi) * w;
        g.fillStyle = withAlpha(b.color, 0.8); g.fillRect(x0, sh - 3, Math.max(2, x1 - x0) * Math.min(1, lv.level), 3);
      }
      L.bands.forEach((b, i) => {
        const sel = b.id === L.selected, x = hzToX(bandView(b).freq) * w, y = handleY(b, h, sr);
        const lv = v?.bands.get(b.id);
        const flash = lv && b.trigger ? Math.max(0, 1 - (now - lv.hitAt) / 250) : 0;
        if (sel || flash > 0) { g.beginPath(); g.arc(x, y, HANDLE_R + 5, 0, Math.PI * 2); g.fillStyle = `${b.color}${sel ? '33' : Math.round(flash * 200).toString(16).padStart(2, '0')}`; g.fill(); }
        g.beginPath(); g.arc(x, y, HANDLE_R, 0, Math.PI * 2);
        g.fillStyle = sel ? b.color : t.bg.render; g.fill();
        g.lineWidth = 2; g.strokeStyle = b.color; g.stroke();
        g.fillStyle = sel ? t.bg.render : b.color; g.font = `700 10px ${fontFamily.ui}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(i + 1), x, y + 0.5);
        g.font = `600 10.5px ${fontFamily.ui}`; g.textBaseline = 'bottom'; g.fillStyle = b.color;
        g.fillText(b.name + (L.solo === b.id ? ' · Solo' : ''), Math.max(30, Math.min(w - 30, x)), y - HANDLE_R - 4 < 10 ? y + HANDLE_R + 16 : y - HANDLE_R - 3);
      });
      // ── The pointer: a hairline and its frequency and note ──
      const hv = hover.current;
      if (hv && !drag.current) {
        const hz = xToHz(hv.x / w);
        g.fillStyle = 'rgba(205,214,244,0.35)'; g.fillRect(Math.round(hv.x), TOP, 1, sh - TOP);
        const label = `${fmtFreq(hz)} · ${noteName(hz)}`;
        g.font = `600 11px ${fontFamily.mono}`; g.textBaseline = 'top';
        const tw = g.measureText(label).width + 10, lx = Math.max(2, Math.min(w - tw - 2, hv.x + 8));
        g.fillStyle = 'rgba(17,17,27,0.85)'; g.fillRect(lx, TOP + 2, tw, 18);
        g.fillStyle = '#cdd6f4'; g.textAlign = 'left'; g.fillText(label, lx + 5, TOP + 6);
      }
      if (!L.bands.length) {
        g.fillStyle = 'rgba(205,214,244,0.5)'; g.font = `12px ${fontFamily.ui}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('Double-click the spectrum to add a band', w / 2, sh / 2);
      }
    });
  }, [nodeId]);

  // ── Hearing: Solo plays the soloed band; Hear hovered the band (or third of an octave) under the pointer ──
  const hearBand = (b: AudioBandSpec) => {
    if (audioToolsEngine.auditionBand(nodeId, b.lo, b.hi, { shape: b.shape, slope: b.slope })) onHearing({ lo: b.lo, hi: b.hi, name: b.name });
    else onHearing(null);
  };
  const soloBand = bands.find(b => b.id === solo);
  useEffect(() => {
    if (!soloBand) return;
    hearBand(soloBand);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloBand?.lo, soloBand?.hi, soloBand?.shape, soloBand?.slope, solo]);
  useEffect(() => {
    if (solo && !soloBand) setSolo(null);
  }, [solo, soloBand]);
  const stopHearing = () => { audioToolsEngine.stopAudition(); onHearing(null); };
  useEffect(() => { if (!solo && !hearHover) stopHearing(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [solo]);
  useEffect(() => () => audioToolsEngine.stopAudition(), []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top, w: r.width, h: r.height };
  };
  /** The band whose handle is under (px, py), top-most first. */
  const handleAt = (px: number, py: number, w: number, h: number, reach = HIT): AudioBandSpec | null => {
    let best: AudioBandSpec | null = null, bd = reach;
    for (const b of bands) {
      const d = Math.hypot(hzToX(bandView(b).freq) * w - px, handleY(b, h, srRef.current) - py);
      if (d <= bd) { bd = d; best = b; }
    }
    return best;
  };
  /** The band whose curve covers x the most (lets through more than half), else none. */
  const bandUnder = (x: number): AudioBandSpec | null => {
    const hz = xToHz(x);
    let best: AudioBandSpec | null = null, br = 0.5;
    for (const b of bands) { const r = bandResponse(b, hz, srRef.current); if (r > br || (r >= br && b.id === selected)) { br = r; best = b; } }
    return best;
  };
  const hearAt = (x: number) => {
    if (solo) return;
    const b = bandUnder(x);
    if (b) { hearBand(b); return; }
    const hz = xToHz(x), lo = Math.round(hz / 2 ** (1 / 6)), hi = Math.round(hz * 2 ** (1 / 6));
    if (audioToolsEngine.auditionBand(nodeId, lo, hi)) onHearing({ lo, hi });
    else onHearing(null);
  };

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    wrapRef.current?.focus({ preventScroll: true });
    if (e.button !== 0 && e.button !== 2) return;
    const { px, py, w, h } = local(e);
    const b = handleAt(px, py, w, h);
    if (!b) {
      if (e.button === 0) {
        // A press inside a band's curve picks it; empty space lets go (double-click adds).
        const under = bandUnder(px / w);
        onSelect(under?.id ?? null);
      }
      return;
    }
    onSelect(b.id);
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: b.id, dx: px - hzToX(bandView(b).freq) * w, y0: py, width0: bandView(b).width, moved: false };
  };
  const pending = useRef<{ id: string; p: Partial<AudioBandSpec> } | null>(null);
  const raf = useRef(0);
  const write = (id: string, p: Partial<AudioBandSpec>) => {
    pending.current = { id, p };
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; const q = pending.current; pending.current = null; if (q) patchBand(q.id, q.p); });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const { px, py, w } = local(e);
    hover.current = { x: px, y: py };
    const d = drag.current;
    if (!d) { if (hearHover) hearAt(px / w); return; }
    const b = bands.find(q => q.id === d.id);
    if (!b) return;
    d.moved = true;
    const freq = xToHz((px - d.dx) / w);
    const width = b.shape === 'band' ? dragWidth(d.width0, py - d.y0) : bandView(b).width;
    const next = bandRange(b.shape, freq, width);
    write(b.id, next);
    if (hearHover && !solo) hearBand({ ...b, ...next });
  };
  const onUp = () => { drag.current = null; };
  const onLeave = () => { hover.current = null; if (hearHover && !solo) stopHearing(); };
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py, w, h } = local(e);
    if (handleAt(px, py, w, h)) return;
    onAdd(newBandAt(xToHz(px / w)));
  };
  const onContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py, w, h } = local(e);
    const b = handleAt(px, py, w, h) ?? bandUnder(px / w);
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    onSelect(b.id);
  };

  // The wheel over a band (its handle, else the curve under the pointer): a Band's width, a cut's slope.
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    const { px, py, w, h } = local(e);
    const b = handleAt(px, py, w, h, 28) ?? bandUnder(px / w);
    if (!b) return;
    e.preventDefault();
    onSelect(b.id);
    if (b.shape === 'band') patchBand(b.id, withWidth(b, wheelWidth(bandView(b).width, e.deltaY)));
    else if (Math.abs(e.deltaY) >= 4) patchBand(b.id, { slope: wheelSlope(b.slope, e.deltaY) });
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const on = (e: WheelEvent) => wheelRef.current(e);
    c.addEventListener('wheel', on, { passive: false });
    return () => c.removeEventListener('wheel', on);
  }, []);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== wrapRef.current) return;
    if (e.key === 'Escape') { if (selected) { e.stopPropagation(); onSelect(null); } return; }
    if (!selBand) return;
    const v = bandView(selBand);
    let p: Partial<AudioBandSpec> | null = null;
    // Delete / Backspace: the window's (AudioSourceWindow.tsx), wherever the focus is, so the graph never gets it.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') p = withFreq(selBand, v.freq * 2 ** ((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 4 : 1) / 12));
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const up = e.key === 'ArrowUp';
      p = selBand.shape === 'band' ? withWidth(selBand, v.width * 2 ** ((up ? -1 : 1) / 6)) : { slope: wheelSlope(selBand.slope, up ? -1 : 1) };
    } else return;
    e.preventDefault(); e.stopPropagation();
    if (p) patchBand(selBand.id, p);
  };

  // ── The floating panel ──
  const handleX = selBand ? hzToX(bandView(selBand).freq) * boxW : 0;
  // Beside the handle (on the roomier side), just under it: the band's curve stays in sight.
  const panelW = Math.min(PANEL_W, boxW - 8);
  const panelLeft = Math.max(4, Math.min(boxW - panelW - 4, handleX > boxW / 2 ? handleX - HANDLE_R - 16 - panelW : handleX + HANDLE_R + 16));
  const selY = selBand ? handleY(selBand, height, srRef.current) : 0;
  const panelBelow = selY < height / 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div ref={wrapRef} data-band-eq tabIndex={0} onKeyDown={onKey}
        style={{ position: 'relative', outline: 'none', borderRadius: radius.md }}
        aria-label="Bands: double-click to add one; drag a handle to move it; scroll over it to change its width">
        <canvas ref={canvasRef} data-audio-spectrum onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onPointerLeave={onLeave} onDoubleClick={onDouble} onContextMenu={onContext}
          style={{ width: '100%', height, borderRadius: radius.md, display: 'block', cursor: 'crosshair', touchAction: 'none' }} />
        {selBand && (
          <BandPanel key={selBand.id} band={selBand} index={bands.indexOf(selBand)} solo={solo === selBand.id}
            style={{ position: 'absolute', left: panelLeft, width: panelW, ...(panelBelow ? { top: selY + 4 } : { bottom: height - selY + 4 }) }}
            patch={(p, structural) => patchBand(selBand.id, p, structural)}
            onSolo={() => setSolo(solo === selBand.id ? null : selBand.id)}
            onDelete={() => { setBands(bands.filter(b => b.id !== selBand.id), true); onSelect(null); }}
            onClose={() => onSelect(null)} tk={tk} />
        )}
      </div>
    </div>
  );
}

/** A number with a label you can drag sideways to change it (`scrub`: the value after dragging dx px). */
function ScrubField({ label, value, unit, format, scrub, onCommit, title, tk, width = 58 }: {
  label: string; value: number; unit?: string; format: (n: number) => string; scrub: (v0: number, dx: number) => number;
  onCommit: (n: number) => void; title: string; tk: ReturnType<typeof useTokens>; width?: number;
}) {
  const start = useRef<{ x: number; v: number } | null>(null);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, font: `500 11px ${fontFamily.ui}`, color: tk.text.muted }} title={title}>
      <span style={{ cursor: 'ew-resize', userSelect: 'none', touchAction: 'none' }}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, v: value }; }}
        onPointerMove={e => { const s = start.current; if (s) onCommit(scrub(s.v, e.clientX - s.x)); }}
        onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}>{label}</span>
      <NumberInput value={value} format={format} onCommit={onCommit}
        style={{ width, font: `500 11.5px ${fontFamily.mono}`, color: tk.text.primary, background: tk.bg.panel, border: `1px solid ${tk.border.default}`, borderRadius: radius.sm, padding: '2px 5px', boxSizing: 'border-box' }} />
      {unit && <span>{unit}</span>}
    </label>
  );
}

function BandPanel({ band: b, index, solo, style, patch, onSolo, onDelete, onClose, tk }: {
  band: AudioBandSpec; index: number; solo: boolean; style: CSSProperties;
  patch: (p: Partial<AudioBandSpec>, structural?: boolean) => void; onSolo: () => void; onDelete: () => void; onClose: () => void;
  tk: ReturnType<typeof useTokens>;
}) {
  const v = bandView(b);
  const chip = (on: boolean): CSSProperties => ({
    padding: '2px 8px', borderRadius: radius.sm, border: `1px solid ${on ? b.color : tk.border.default}`, cursor: 'pointer',
    background: on ? `${b.color}33` : tk.bg.field, color: tk.text.primary, font: `600 11px ${fontFamily.ui}`,
  });
  return (
    <div data-band-panel={b.id} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
      style={{
        ...style, zIndex: 2, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 6, padding: 8,
        background: tk.bg.panel, border: `1px solid ${b.color}`, borderRadius: radius.md, boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 18, height: 18, borderRadius: 9, background: b.color, color: tk.bg.render, font: `700 10px ${fontFamily.ui}`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{index + 1}</span>
        <input defaultValue={b.name} key={`${b.id}:${b.name}`} aria-label="Band name" title="The band's name: its outputs take it"
          onBlur={e => { const n = e.target.value.trim(); if (n && n !== b.name) patch({ name: n }, true); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          style={{ flex: 1, minWidth: 0, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, background: 'transparent', border: `1px solid ${tk.border.default}`, borderRadius: radius.sm, padding: '2px 5px' }} />
        <input type="color" value={b.color} onChange={e => patch({ color: e.target.value })} title="The band's colour" style={{ width: 22, height: 22, border: 0, padding: 0, background: 'none', cursor: 'pointer' }} />
        <button type="button" aria-label="Close" title="Let go of the band (Esc)" onClick={onClose}
          style={{ border: 0, background: 'none', color: tk.text.faint, cursor: 'pointer', font: `600 13px ${fontFamily.ui}`, padding: '0 2px' }}>×</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <ScrubField label="Freq" unit="Hz" value={Math.round(v.freq)} format={n => String(Math.round(n))} tk={tk} width={62}
          title={`${b.shape === 'band' ? 'Its centre' : 'Its corner'}, in Hz (${noteName(v.freq)}). Drag the label sideways, or type.`}
          scrub={(v0, dx) => v0 * 2 ** (dx / 120)} onCommit={n => patch(withFreq(b, n))} />
        {b.shape === 'band' && (
          <ScrubField label="Width" unit={`oct · Q ${widthToQ(v.width).toFixed(2)}`} value={+v.width.toFixed(2)} format={n => n.toFixed(2)} tk={tk} width={48}
            title={`How wide, in octaves (${MIN_WIDTH_OCT}–${MAX_WIDTH_OCT}): ${b.lo}–${b.hi} Hz. Drag the label sideways, scroll over the handle, or type.`}
            scrub={(v0, dx) => v0 * 2 ** (dx / 120)} onCommit={n => patch(withWidth(b, n))} />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 170px', minWidth: 0 }}>
          <Segmented<AudioBandShape> size="sm" fill ariaLabel="Shape" value={b.shape} onChange={s => patch(withShape(b, s))}
            options={BAND_SHAPES.map(s => ({ value: s, label: SHAPE_LABELS[s], title: SHAPE_HINTS[s] }))} />
        </div>
        <div style={{ flex: '0 1 110px', minWidth: 0 }}>
          <Segmented<string> size="sm" fill ariaLabel="Slope (dB per octave)" value={String(b.slope)} onChange={s => patch({ slope: Number(s) as AudioBandSlope })}
            options={BAND_SLOPES.map(s => ({ value: String(s), label: String(s), title: `${s} dB per octave` }))} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" aria-pressed={solo} data-band-solo style={chip(solo)} title="Hear just this band (File) until you switch Solo off" onClick={onSolo}>Solo</button>
        <span style={{ font: `500 11px ${fontFamily.ui}`, color: tk.text.faint }}>{b.lo}–{b.hi} Hz · {b.slope} dB/oct</span>
        <span style={{ marginLeft: 'auto' }} />
        <Button size="sm" variant="ghost" onClick={onDelete} title="Remove the band (and its outputs' wires). Delete key">Delete</Button>
      </div>
    </div>
  );
}
