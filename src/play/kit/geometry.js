/**
 * geometry.js — the shapes zones are made of, as signed distance functions.
 *
 * Part of the layer kit (play/kit): plain JS with no imports of its own, run
 * by the app (play/overlay.ts) and inlined into web exports. Every file in
 * the kit shares one scope when inlined, so top-level names are unique
 * across the kit (this file's start with `geo` or `sdf`).
 *
 * Units: positions are 0..1 across and up the picture (y up); distances are
 * in picture heights, so a circle stays round on a wide picture. A distance
 * is negative inside a shape, 0 on its edge and positive outside, and the
 * normal (the distance's slope) points straight out.
 */

/** A zone ready for the particle step: the shape's distance function plus what it does. */
export function geoCompile(shape, aspect) {
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  const hw = Math.max(1e-4, shape.w / 2), hh = Math.max(1e-4, shape.h / 2);
  const round = Math.max(0, Math.min(0.5, shape.round || 0)) * Math.min(shape.w, shape.h);
  const cx = shape.x, cy = shape.y;
  const inv = shape.invert ? -1 : 1;
  // World (0..1, y up) → the shape's own frame, in picture heights. The shape
  // turns clockwise on screen, which is a negative angle with y up.
  const local = (x, y) => { const dx = (x - cx) * aspect, dy = y - cy; return [dx * c - dy * s, dx * s + dy * c]; };
  let d;
  switch (shape.shape) {
    case 'circle': d = (x, y) => { const p = local(x, y); return sdfEllipse(p[0], p[1], hw, hh); }; break;
    case 'line': d = (x, y) => { const p = local(x, y); return sdfCapsule(p[0], p[1], hw, hh); }; break;
    case 'polygon': {
      const pts = shape.points || [];
      d = pts.length >= 6 ? (x, y) => { const p = local(x, y); return sdfPolygon(p[0], p[1], pts); } : () => 1;
      break;
    }
    case 'field': d = shape.field ? (x, y) => geoFieldAt(shape.field, x, y) : () => 1; break;
    default: d = (x, y) => { const p = local(x, y); return sdfBox(p[0], p[1], hw, hh, round); };
  }
  const dist = inv < 0 ? (x, y) => -d(x, y) : d;
  const z = {
    id: shape.id, action: shape.action || 'none', dist,
    x: cx, y: cy, w: shape.w, h: shape.h, rot, aspect,
    strength: shape.strength == null ? 1 : shape.strength, reach: Math.max(0.001, shape.reach == null ? 0.15 : shape.reach),
    bounce: shape.bounce || 0, angle: (shape.angle || 0) * Math.PI / 180,
    targetId: shape.targetId || '', tint: shape.tint || [1, 1, 1], scale: shape.scale == null ? 1.5 : shape.scale,
    affects: shape.affects || '',
    inside: 0, total: 0,
  };
  /** Outward normal at (x, y) in picture-height units, from the distance's slope. */
  z.normal = (x, y) => {
    const e = 0.002, ex = e / aspect;
    const gx = dist(x + ex, y) - dist(x - ex, y), gy = dist(x, y + e) - dist(x, y - e);
    const m = Math.hypot(gx, gy) || 1;
    return [gx / m, gy / m];
  };
  /** A random point inside (for emitters); falls back to the centre. */
  z.randomPoint = rand => {
    const r = Math.hypot(hw, hh);
    for (let k = 0; k < 12; k++) {
      const px = cx + (rand() * 2 - 1) * r / aspect, py = cy + (rand() * 2 - 1) * r;
      if (dist(px, py) < 0) return [px, py];
    }
    return [cx, cy];
  };
  return z;
}

export function sdfBox(px, py, hw, hh, r) {
  const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** An ellipse's distance, approximated by scaling (exact for circles). */
export function sdfEllipse(px, py, a, b) {
  const k = Math.hypot(px / a, py / b);
  return (k - 1) * Math.min(a, b);
}

/** A line of length 2·hw with rounded ends, hh thick on each side. */
export function sdfCapsule(px, py, hw, hh) {
  const r = Math.min(hh, hw);
  const L = Math.max(0, hw - r);
  const qx = px - Math.max(-L, Math.min(L, px));
  return Math.hypot(qx, py) - r;
}

/** A polygon given as a flat [x0, y0, x1, y1, …] list in the shape's frame (even-odd inside). */
export function sdfPolygon(px, py, pts) {
  const n = pts.length >> 1;
  let best = Infinity, inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = pts[j * 2], ay = pts[j * 2 + 1], bx = pts[i * 2], by = pts[i * 2 + 1];
    const ex = bx - ax, ey = by - ay, wx = px - ax, wy = py - ay;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    const dx = wx - ex * t, dy = wy - ey * t;
    best = Math.min(best, dx * dx + dy * dy);
    if ((ay > py) !== (by > py) && px < ax + (py - ay) * (bx - ax) / (by - ay)) inside = !inside;
  }
  return (inside ? -1 : 1) * Math.sqrt(best);
}

/** Distance to the nearest of many capsules (brush strokes as walls). `segs` is [x0, y0, x1, y1, r, …] in picture-height units. */
export function sdfSegments(px, py, segs) {
  let best = Infinity;
  for (let i = 0; i < segs.length; i += 5) {
    const ax = segs[i], ay = segs[i + 1], ex = segs[i + 2] - ax, ey = segs[i + 3] - ay;
    const wx = px - ax, wy = py - ay;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    const d = Math.hypot(wx - ex * t, wy - ey * t) - segs[i + 4];
    if (d < best) best = d;
  }
  return best;
}

// ── Raster fields: any mask (text, an image, the bright parts of the picture) as a distance grid ──

/**
 * A signed distance grid from an inside/outside mask (`gw` × `gh`, row 0 at
 * the top). Two chamfer passes give distances within a few percent, plenty
 * for particles. Distances are in picture heights.
 */
export function geoFieldFromMask(mask, gw, gh) {
  const INF = 1e9, n = gw * gh;
  const outD = new Float32Array(n), inD = new Float32Array(n);
  for (let i = 0; i < n; i++) { outD[i] = mask[i] ? 0 : INF; inD[i] = mask[i] ? INF : 0; }
  geoChamfer(outD, gw, gh); geoChamfer(inD, gw, gh);
  const d = new Float32Array(n), cell = 1 / gh;
  // Half a cell either side of the edge so the zero crossing sits on it.
  for (let i = 0; i < n; i++) d[i] = (mask[i] ? -(inD[i] - 0.5) : outD[i] - 0.5) * cell;
  return { d, gw, gh };
}

function geoChamfer(g, w, h) {
  const A = 1, B = 1.4142;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = g[i];
    if (x > 0) v = Math.min(v, g[i - 1] + A);
    if (y > 0) { v = Math.min(v, g[i - w] + A); if (x > 0) v = Math.min(v, g[i - w - 1] + B); if (x < w - 1) v = Math.min(v, g[i - w + 1] + B); }
    g[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let v = g[i];
    if (x < w - 1) v = Math.min(v, g[i + 1] + A);
    if (y < h - 1) { v = Math.min(v, g[i + w] + A); if (x < w - 1) v = Math.min(v, g[i + w + 1] + B); if (x > 0) v = Math.min(v, g[i + w - 1] + B); }
    g[i] = v;
  }
}

/** Bilinear lookup in a field at (x, y) in 0..1, y up. Outside the grid counts as outside the shape. */
export function geoFieldAt(f, x, y) {
  const fx = x * f.gw - 0.5, fy = (1 - y) * f.gh - 0.5;
  if (fx < -1 || fy < -1 || fx > f.gw || fy > f.gh) return 1;
  const cx = Math.max(0, Math.min(f.gw - 1, fx)), cy = Math.max(0, Math.min(f.gh - 1, fy));
  const x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.min(f.gw - 1, x0 + 1), y1 = Math.min(f.gh - 1, y0 + 1);
  const tx = cx - x0, ty = cy - y0, d = f.d, w = f.gw;
  const a = d[y0 * w + x0], b = d[y0 * w + x1], c = d[y1 * w + x0], e = d[y1 * w + x1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty;
}

/** A field from the picture's brightness: at or above `threshold` is inside. `sample` is RGBA, sw × sh. */
export function geoFieldFromBrightness(sample, sw, sh, threshold) {
  const mask = new Uint8Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    const k = i * 4;
    mask[i] = (sample[k] * 0.299 + sample[k + 1] * 0.587 + sample[k + 2] * 0.114) / 255 >= threshold ? 1 : 0;
  }
  return geoFieldFromMask(mask, sw, sh);
}

/** A field from a canvas's alpha channel (a text or image layer painted into a small canvas). */
export function geoFieldFromAlpha(data, gw, gh) {
  const mask = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) mask[i] = data[i * 4 + 3] > 110 ? 1 : 0;
  return geoFieldFromMask(mask, gw, gh);
}
