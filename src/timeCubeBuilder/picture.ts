/**
 * picture.ts — a small CPU drawing of a Time Cube builder scene (docs/timecube-builder.md), for the presets strip and
 * the Scene builder's kind page, so neither costs the GPU anything: the test clip's street (sky, road, the red car
 * crossing) on a few frames, stacked as a box of time or laid out as cards, in the scene's own colours, with the
 * slice (or the scan) at `t`.
 */
import type { Params, TimeCubeSpec } from './spec';

type C3 = [number, number, number];
const col = (v: unknown, fb: C3): C3 => (Array.isArray(v) && v.length >= 3 ? [Number(v[0]), Number(v[1]), Number(v[2])] : fb);
const css = (c: C3, a = 1) => `rgba(${c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255)).join(',')},${a})`;
const mix = (a: C3, b: C3, k: number): C3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

/** One frame of the street at time `u` (0–1), in a w × h box at the origin. */
function frame(g: CanvasRenderingContext2D, w: number, h: number, u: number, o: { tint: C3; tintK: number; key: boolean; alpha: number; grey: number }) {
  const sky = mix(mix([0.55, 0.72, 0.9], [0.5, 0.5, 0.5], o.grey), o.tint, o.tintK);
  const road = mix([0.32, 0.33, 0.36], o.tint, o.tintK);
  const a = o.alpha;
  if (!o.key) {
    g.fillStyle = css(sky, a); g.fillRect(0, 0, w, h * 0.62);
    g.fillStyle = css(road, a); g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = css(mix([1, 0.85, 0.4], [0.7, 0.7, 0.7], o.grey), a); g.beginPath(); g.arc(w * (0.2 + 0.6 * u), h * 0.25, h * 0.09, 0, Math.PI * 2); g.fill();
  } else {
    g.fillStyle = css([0.4, 0.4, 0.42], a * 0.25); g.fillRect(0, 0, w, h);
  }
  g.fillStyle = css([0.86, 0.13, 0.12], o.key ? Math.min(1, a * 2 + 0.3) : a);
  g.fillRect(w * (0.05 + 0.7 * u), h * 0.55, w * 0.22, h * 0.14);
}

function cube(g: CanvasRenderingContext2D, W: number, H: number, v: Params, slice: number) {
  const N = 16;
  const fh = H * 0.42, fw = fh * 1.6;
  const depth = Math.min(2.5, num(v.depth, 1.2));
  const dx = (W * 0.32 * depth) / 2 / N, dy = (-H * 0.2 * depth) / 2 / N;
  const x0 = W / 2 - fw / 2 - (dx * N) / 2, y0 = H / 2 - fh / 2 - (dy * N) / 2;
  const tintK = num(v.tintAmount, 0) * 0.6, from = col(v.tintFrom, [1, 0.8, 0.6]), to = col(v.tintTo, [0.8, 0.95, 0.7]);
  const key = typeof v.keyMode === 'string' && v.keyMode !== 'off';
  const rim = col(v.rimColor, [0.8, 0.7, 1]), rimK = num(v.rimStrength, 0.3);
  const hl = v.highlights === true, hlEvery = Math.max(2, Math.round(num(v.hlSpacing, 12) / 8)), hlColor = col(v.hlColor, [1, 0.78, 0.4]);
  const s = Math.round(slice * (N - 1));
  // Back (last frame) to front (first).
  for (let i = N - 1; i >= 0; i--) {
    const u = i / (N - 1);
    const before = i < s;
    const alpha = i === s ? 1 : before ? 0.12 + 0.5 * num(v.before, 0.25) : 0.25 + 0.6 * num(v.after, 1);
    g.save();
    g.translate(x0 + dx * i, y0 + dy * i);
    if (rimK > 0 && (i === 0 || i === N - 1)) { g.shadowColor = css(rim, Math.min(1, rimK)); g.shadowBlur = 14 * rimK; }
    frame(g, fw, fh, u, { tint: mix(from, to, u), tintK: i === s ? 0 : tintK, key, alpha: key ? alpha * 0.5 : alpha * (i === s ? 1 : 0.55), grey: key ? 1 : 0 });
    g.shadowBlur = 0;
    if (i === s) { g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5; g.strokeRect(0, 0, fw, fh); }
    if (hl && i > s && (i - s) % hlEvery === 0) { g.strokeStyle = css(hlColor, 0.95); g.lineWidth = 1.5; g.strokeRect(0, -4, fw, fh); }
    g.restore();
  }
}

function cards(g: CanvasRenderingContext2D, W: number, H: number, st: Params, scan: number) {
  const N = 14;
  const layout = String(st.layout ?? 'stack');
  const ch = H * (layout === 'grid' ? 0.17 : layout === 'ring' || layout === 'helix' ? 0.2 : 0.3), cw = ch * 1.6;
  const border = num(st.border, 0), bcol = col(st.borderColor, [1, 1, 1]);
  const hlN = Math.round(num(st.hlCount, 0)), hlColor = col(st.hlColor, [1, 0.78, 0.4]);
  const scanI = Math.round(scan * (N - 1));
  const spread = num(st.spread, 0);
  const place = (i: number): { x: number; y: number; r: number; z: number } => {
    const u = i / (N - 1);
    const jitter = spread * 18 * Math.sin(i * 12.9898 + 1.3);
    switch (layout) {
      case 'ring': { const a = u * Math.PI * 2; return { x: W / 2 + Math.cos(a) * W * 0.3, y: H / 2 + Math.sin(a) * H * 0.22 + jitter, r: 0, z: Math.sin(a) }; }
      case 'helix': { const a = u * Math.PI * 4; return { x: W / 2 + Math.cos(a) * W * 0.25, y: H * 0.75 - u * H * 0.5 + jitter, r: 0, z: Math.sin(a) }; }
      case 'fan': return { x: W / 2, y: H * 0.62, r: (u - 0.5) * 1.6, z: u };
      case 'grid': { const c = 5, r = Math.floor(i / c), k = i % c; return { x: W * 0.14 + k * W * 0.18, y: H * 0.22 + r * H * 0.27 + jitter, r: 0, z: 0 }; }
      default: return { x: W * 0.22 + u * W * 0.56, y: H * 0.68 - u * H * 0.36 + jitter, r: 0, z: -u };
    }
  };
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => place(a).z - place(b).z);
  for (const i of order) {
    const p = place(i);
    const lift = i === scanI ? H * 0.1 * (0.5 + num(st.lift, 0.3)) : 0;
    const lit = hlN > 0 && i > scanI && (i - scanI) % Math.max(2, Math.round(num(st.hlEvery, 8) / 2)) === 0 && (i - scanI) / Math.max(2, Math.round(num(st.hlEvery, 8) / 2)) <= hlN;
    g.save();
    g.translate(p.x, p.y - lift);
    g.rotate(p.r);
    g.translate(layout === 'fan' ? -cw / 2 : -cw / 2, layout === 'fan' ? -ch * 1.6 : -ch / 2);
    if (border > 0) { g.fillStyle = css(bcol); g.fillRect(-3, -3, cw + 6, ch + 6); }
    frame(g, cw, ch, i / (N - 1), { tint: [1, 1, 1], tintK: 0, key: false, alpha: 1, grey: 0 });
    g.fillStyle = `rgba(0,0,0,${0.25 * num(st.shading, 0.2) * (1 - Math.abs(p.z))})`; g.fillRect(0, 0, cw, ch);
    if (lit || i === scanI) { g.strokeStyle = lit ? css(hlColor) : 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5; g.strokeRect(0, 0, cw, ch); }
    g.restore();
  }
}

/** Draw `spec` into `g` (w × h), the slice or scan at `t` (0–1; null: the scene's own). */
export function drawTimeCube(g: CanvasRenderingContext2D, w: number, h: number, spec: TimeCubeSpec, t: number | null = null): void {
  const p = spec.display === 'cube' ? spec.view : spec.stack;
  g.clearRect(0, 0, w, h);
  g.fillStyle = css(col(p.background, [0.05, 0.05, 0.07]));
  g.fillRect(0, 0, w, h);
  const own = spec.drive.on ? spec.drive.offset : num(spec.display === 'cube' ? p.slice : p.scan, 0.5);
  const at = Math.max(0, Math.min(1, t ?? own));
  if (spec.display === 'cube') cube(g, w, h, p, at); else cards(g, w, h, p, at);
}

/** A picture of `spec` as a data URL (null where there is no 2D canvas, as in tests). */
export function timeCubePicture(spec: TimeCubeSpec, w = 264, h = 152): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    drawTimeCube(g, w, h, spec);
    return c.toDataURL('image/png');
  } catch { return null; }
}
