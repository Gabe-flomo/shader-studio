/**
 * Canvas 2D drawing shared by the eye preview's overlay and the node card's thumbnail
 * (docs/node-previews.md): arrows, the slice plot and the colour keys. Everything is in CSS pixels;
 * callers scale the context for the device pixel ratio.
 */
import {
  arrowLength, arrowSamples, arrowStrength, ARROW_DOT_BELOW, formatValue, rangeColor, sliceAxis, sliceRow, wheelColor,
  type FieldStats, type ValueField,
} from './valueField';

export interface Rect { x: number; y: number; w: number; h: number }

const css = (c: [number, number, number], a = 1) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

/** The "cover" mapping from field UV (0…1, y up) to the drawing rect, as valueField.resample. */
export function coverMap(field: { w: number; h: number }, r: Rect): { toX: (u: number) => number; toY: (v: number) => number; fromY: (y: number) => number; scale: number } {
  const s = Math.max(r.w / field.w, r.h / field.h);
  const ox = (field.w * s - r.w) / 2, oy = (field.h * s - r.h) / 2;
  return {
    scale: s,
    toX: u => r.x + u * field.w * s - ox,
    toY: v => r.y + (1 - v) * field.h * s - oy,
    fromY: y => 1 - (y - r.y + oy) / (field.h * s),
  };
}

/** Draw one arrow from (x0, y0) to (x1, y1) with a dark outline. */
export function drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, head: number, color: string) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.moveTo(x1 - head * Math.cos(ang - 0.45), y1 - head * Math.sin(ang - 0.45));
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(ang + 0.45), y1 - head * Math.sin(ang + 0.45));
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  path(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3.2; ctx.stroke();
  path(); ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
}

/**
 * An arrow per grid cell (`cellCss` pixels: showAs.arrowCellPx). Length and brightness are the
 * strength, magnitude / the largest magnitude in view; below ARROW_DOT_BELOW a dot. Returns that
 * largest magnitude and how long a full arrow is drawn (the key's reference arrow).
 */
export function drawArrows(ctx: CanvasRenderingContext2D, field: ValueField, r: Rect, cellCss = 34): { maxMag: number; fullLen: number } {
  const m = coverMap(field, r);
  // Cells across the whole field (part of it may be cropped by the cover fit)
  const cols = Math.max(4, Math.min(64, Math.round((field.w * m.scale) / cellCss)));
  const a = arrowSamples(field, cols);
  const cellPx = (field.w * m.scale) / a.cols;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  a.centers.forEach(([u, v], i) => {
    const x = a.vecs[i * 2], y = a.vecs[i * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const mag = Math.hypot(x, y);
    const strength = arrowStrength(mag, a.maxMag);
    const len = arrowLength(mag, a.maxMag, cellPx);
    const cx = m.toX(u), cy = m.toY(v);
    if (strength < ARROW_DOT_BELOW || len < 1.5) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, Math.min(1.6, cellPx * 0.06)), 0, Math.PI * 2); ctx.fill();
      return;
    }
    const dx = (x / mag) * len, dy = -(y / mag) * len; // vec2 y is up, canvas y is down
    const head = Math.min(len * 0.38, Math.max(4, cellPx * 0.22));
    drawArrow(ctx, cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2, head, css(wheelColor(x, y, a.maxMag).map(c => 0.45 + c * 0.55) as [number, number, number]));
  });
  ctx.restore();
  return { maxMag: a.maxMag, fullLen: arrowLength(a.maxMag, a.maxMag, cellPx) };
}

export interface SliceStyle {
  font: string;
  text: string;
  faint: string;
  out: string;
  input: string;
  panel: string;
}
export const SLICE_STYLE: SliceStyle = {
  font: '10.5px ui-monospace, SFMono-Regular, Menlo, monospace',
  text: 'rgba(235,237,245,0.95)', faint: 'rgba(235,237,245,0.45)',
  out: '#ffb454', input: 'rgba(200,204,214,0.85)', panel: 'rgba(14,15,20,0.78)',
};

/**
 * The slice plot: the dashed slice line across the picture at `sliceY`, and a graph of the value
 * along it in `plot` (the primary input, when the field carries one, in grey on the same axes).
 */
export function drawSlice(ctx: CanvasRenderingContext2D, field: ValueField, picture: Rect, plot: Rect, sliceY: number, st: SliceStyle = SLICE_STYLE): void {
  const m = coverMap(field, picture);
  // The line through the picture
  const ly = Math.round(m.toY((Math.round(sliceY * (field.h - 1)) + 0.5) / field.h)) + 0.5;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(picture.x, ly); ctx.lineTo(picture.x + picture.w, ly); ctx.stroke();
  ctx.setLineDash([]);
  // Handle
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.moveTo(picture.x, ly - 5); ctx.lineTo(picture.x + 7, ly); ctx.lineTo(picture.x, ly + 5); ctx.fill();

  const out = sliceRow(field, sliceY, 0);
  const inp = field.hasInput ? sliceRow(field, sliceY, 1) : null;
  const { lo, hi } = inp ? sliceAxis(out, inp) : sliceAxis(out);

  ctx.fillStyle = st.panel;
  ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
  ctx.font = st.font;
  const labelW = Math.max(ctx.measureText(formatValue(hi)).width, ctx.measureText(formatValue(lo)).width) + 10;
  const g: Rect = { x: plot.x + labelW, y: plot.y + 8, w: plot.w - labelW - 8, h: plot.h - 22 };
  const toPy = (v: number) => g.y + (1 - (v - lo) / (hi - lo)) * g.h;
  // Axes, the zero line when it's in range
  ctx.strokeStyle = st.faint; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(g.x + 0.5, g.y); ctx.lineTo(g.x + 0.5, g.y + g.h); ctx.lineTo(g.x + g.w, g.y + g.h + 0.5); ctx.stroke();
  if (lo < 0 && hi > 0) {
    const zy = Math.round(toPy(0)) + 0.5;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(g.x, zy); ctx.lineTo(g.x + g.w, zy); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = st.text;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(formatValue(hi), g.x - 4, g.y + 4);
  ctx.fillText(formatValue(lo), g.x - 4, g.y + g.h - 2);
  if (lo < 0 && hi > 0 && Math.abs(toPy(0) - g.y) > 12 && Math.abs(toPy(0) - g.y - g.h) > 12) ctx.fillText('0', g.x - 4, toPy(0));
  // x: the slice runs across the field's width (the cover crop shows part of it)
  const x0 = m.toX(0), x1 = m.toX(1);
  const series = (vals: Float32Array, color: string, width: number) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      const px = g.x + (((x0 + ((i + 0.5) / vals.length) * (x1 - x0)) - picture.x) / picture.w) * g.w;
      if (!Number.isFinite(v) || px < g.x - 1 || px > g.x + g.w + 1) { pen = false; continue; }
      const py = toPy(v);
      if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
    }
    ctx.stroke();
  };
  ctx.save();
  ctx.beginPath(); ctx.rect(g.x, g.y - 2, g.w, g.h + 4); ctx.clip();
  if (inp) series(inp, st.input, 1.25);
  series(out, st.out, 1.8);
  ctx.restore();
  // Legend
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const ly2 = plot.y + plot.h - 4;
  ctx.fillStyle = st.out; ctx.fillRect(g.x, ly2 - 6, 10, 2);
  ctx.fillStyle = st.text; ctx.fillText('output', g.x + 14, ly2);
  if (inp) {
    const ox = g.x + 14 + ctx.measureText('output').width + 12;
    ctx.fillStyle = st.input; ctx.fillRect(ox, ly2 - 6, 10, 2);
    ctx.fillStyle = st.text; ctx.fillText('input', ox + 14, ly2);
  }
  ctx.restore();
}

/** A horizontal colour bar of the auto-range map over min…max. */
export function drawRangeBar(ctx: CanvasRenderingContext2D, r: Rect, s: FieldStats): void {
  const grad = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    grad.addColorStop(t, css(rangeColor(s.min + (s.max - s.min) * t, s.min, s.max)));
  }
  ctx.fillStyle = grad;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  if (s.min < 0 && s.max > 0) {
    // Where 0 falls
    const zx = r.x + (-s.min / (s.max - s.min)) * r.w;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(Math.round(zx) - 0.5, r.y - 2, 1, r.h + 4);
  }
}

/** A small colour wheel key (hue = direction, brightness = length). */
const wheelCache = new Map<number, HTMLCanvasElement>();
export function drawWheelKey(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  const n = 64;
  let img = wheelCache.get(n);
  if (!img) {
    img = document.createElement('canvas');
    img.width = n; img.height = n;
    const c2 = img.getContext('2d')!;
    const data = c2.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x + 0.5 - n / 2) / (n / 2), dy = -(y + 0.5 - n / 2) / (n / 2);
      const d = Math.hypot(dx, dy);
      const o = (y * n + x) * 4;
      if (d > 1) continue;
      const c = wheelColor(dx, dy, 1);
      data.data[o] = c[0] * 255; data.data[o + 1] = c[1] * 255; data.data[o + 2] = c[2] * 255;
      data.data[o + 3] = 255 * Math.min(1, (1 - d) * n / 2);
    }
    c2.putImageData(data, 0, 0);
    wheelCache.set(n, img);
  }
  // Drawn as an image so it follows the context's transform (putImageData wouldn't).
  ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
}
