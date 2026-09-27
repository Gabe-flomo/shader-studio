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
    case 'path': {
      // A shape made from nulls (geoPathBuild): closed outlines are polygons, lines and webs thick strokes.
      const g = shape.pathGeo;
      if (g && g.closed && g.pts.length >= 6) d = (x, y) => sdfPolygon(x * aspect, y, g.pts);
      else if (g && g.segs.length) d = (x, y) => sdfSegments(x * aspect, y, g.segs);
      else d = () => 1;
      break;
    }
    default: d = (x, y) => { const p = local(x, y); return sdfBox(p[0], p[1], hw, hh, round); };
  }
  const dist = inv < 0 ? (x, y) => -d(x, y) : d;
  const z = {
    id: shape.id, action: shape.action || 'none', dist,
    x: cx, y: cy, w: shape.w, h: shape.h, rot, aspect,
    strength: shape.strength == null ? 1 : shape.strength, reach: Math.max(0.001, shape.reach == null ? 0.15 : shape.reach),
    bounce: shape.bounce || 0, angle: (shape.angle || 0) * Math.PI / 180, tilt: Math.max(0, Math.min(85, shape.tilt || 0)) * Math.PI / 180,
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

/**
 * A field from partial coverage (`cover` 0..1 per cell), for things smaller
 * than a cell like particles. A cell counts as a disc of its covered area
 * (radius √(a/π) cells), so a dot moving between cells, or fading, shrinks
 * and grows smoothly instead of popping in and out as a threshold would. A
 * cell at least half covered is inside, measured like geoFieldFromMask.
 */
export function geoFieldFromCoverage(cover, gw, gh, minCover) {
  const INF = 1e9, n = gw * gh;
  const outD = new Float32Array(n), inD = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = cover[i];
    // A half-covered cell or more is solid: its edge half a cell out, as geoFieldFromMask has it.
    outD[i] = a >= 0.5 ? -0.5 : a > minCover ? -Math.sqrt(a / Math.PI) : INF;
    inD[i] = a >= 0.5 ? INF : 0;
  }
  geoChamfer(outD, gw, gh); geoChamfer(inD, gw, gh);
  const d = new Float32Array(n), cell = 1 / gh;
  for (let i = 0; i < n; i++) d[i] = (cover[i] >= 0.5 ? -(inD[i] - 0.5) : outD[i]) * cell;
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

/**
 * A layer's anchor: the point proximity triggers and distance sensors measure
 * from, 0..1 across and up the picture. Always the layer's centre:
 *   null, text, image, camera, lens, audio   its position (text and images are drawn centred on it)
 *   shape      box, circle and line: its position; a polygon: its bounds' centre after rotation; a path: its points' centre (reported);
 *              a layer's shape: that layer's anchor; the picture's bright parts: their centroid (reported)
 *   cloner     grid and ring: the centre; line: its middle; path and points: the copies' centroid (reported)
 *   particles, bodies, brush   the centroid of what is alive (reported), none until something is
 *   script     where the sketch sets s.anchor (reported), else the picture's centre
 * `value(key)` reads the layer's property now (a mapping may drive it),
 * `reported(key)` a number the kit reported (`<id>::ax`, `<id>::ay`), and
 * `lookup(id)` another layer. Null when the layer has no anchor yet.
 */
export function geoAnchor(layer, value, aspect, reported, lookup, depth) {
  if (!layer) return null;
  const at = () => ({ x: value('x'), y: value('y') });
  const rep = () => { const x = reported(layer.id + '::ax'), y = reported(layer.id + '::ay'); return typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y) ? { x, y } : null; };
  switch (layer.kind) {
    case 'null': case 'text': case 'image': case 'camera': case 'video': case 'lens': case 'audio':
      return at();
    case 'shape': {
      if (layer.shape === 'layer') {
        const src = (depth || 0) < 3 && layer.sourceId ? lookup(layer.sourceId) : null;
        return src ? geoAnchor(src.layer, src.value, aspect, reported, lookup, (depth || 0) + 1) : at();
      }
      if (layer.shape === 'picture') return rep() || { x: 0.5, y: 0.5 };
      if (layer.shape === 'path') return rep() || at();
      const pts = layer.points || [];
      if (layer.shape !== 'polygon' || pts.length < 6) return at();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i + 1 < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
      // The polygon's frame back to the picture (the inverse of geoCompile's `local`).
      const lx = (x0 + x1) / 2, ly = (y0 + y1) / 2, rot = (value('rotation') || 0) * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
      return { x: value('x') + (lx * c + ly * s) / aspect, y: value('y') + (-lx * s + ly * c) };
    }
    case 'cloner':
      if (layer.arrange === 'line') return { x: (value('x') + value('x2')) / 2, y: (value('y') + value('y2')) / 2 };
      if (layer.arrange === 'path' || layer.arrange === 'points') return rep() || at();
      return at();
    // A Data layer: its current row where it is drawn (a path: its head).
    case 'particles': case 'bodies': case 'brush': case 'data':
      return rep();
    case 'script':
      return rep() || { x: 0.5, y: 0.5 };
    default:
      return null;
  }
}

// ── Paths: shapes made from nulls (a quad between two hands, a web between fingertips) ──
//
// A path shape takes its corners from nulls, in order, every frame. The
// points arrive as { x, y, lost } (0..1 across and up; `lost`: the null
// follows a hand that is out of view) and the geometry is built in picture
// heights (x × aspect, y), like every distance here.

export const GEO_PATH_STYLES = ['fill', 'smooth', 'circle', 'lines', 'web'];
/** Seconds a path with On lost: Fade takes to fade out (and back in). */
export const GEO_PATH_FADE_S = 0.35;
const GEO_SMOOTH_STEPS = 10, GEO_CIRCLE_STEPS = 72;

/** The convex hull of [[x, y], …], anticlockwise with y up, without collinear points. Fewer than 3 distinct points (or all in a line): the ends. */
export function geoHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq = [];
  for (const q of p) { const l = uniq[uniq.length - 1]; if (!l || Math.abs(l[0] - q[0]) > 1e-9 || Math.abs(l[1] - q[1]) > 1e-9) uniq.push(q); }
  if (uniq.length < 3) return uniq;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of uniq) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop(); lower.push(q); }
  for (let i = uniq.length - 1; i >= 0; i--) { const q = uniq[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop(); upper.push(q); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  // All in a line: its two ends.
  return hull.length >= 3 ? hull : [uniq[0], uniq[uniq.length - 1]];
}

/**
 * A closed centripetal Catmull-Rom curve through [[x, y], …]: `steps` samples
 * per span, starting on each point, so the curve passes through every one and
 * never loops or cusps between close points. Returns [[x, y], …].
 */
export function geoCatmullRom(points, steps) {
  const n = points.length;
  if (n < 3) return points.slice();
  const k = Math.max(1, steps | 0), out = [];
  const knot = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    for (let s = 0; s < k; s++) {
      const t = t1 + (t2 - t1) * (s / k);
      const mix = (a, b, ta, tb) => { const u = (t - ta) / (tb - ta); return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; };
      const a1 = mix(p0, p1, t0, t1), a2 = mix(p1, p2, t1, t2), a3 = mix(p2, p3, t2, t3);
      const b1 = mix(a1, a2, t0, t2), b2 = mix(a2, a3, t1, t3);
      out.push(mix(b1, b2, t1, t2));
    }
  }
  return out;
}

/** Area of a closed outline (flat [x0, y0, …]), whichever way round it goes. */
export function geoPolyArea(pts) {
  const n = pts.length >> 1;
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) s += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1];
  return Math.abs(s) / 2;
}

/** Length of a line through flat [x0, y0, …], back to the start when `closed`. */
export function geoPolyLength(pts, closed) {
  const n = pts.length >> 1;
  let s = 0;
  for (let i = 1; i < n; i++) s += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  if (closed && n > 2) s += Math.hypot(pts[0] - pts[n * 2 - 2], pts[1] - pts[n * 2 - 1]);
  return s;
}

/**
 * Which points a path uses now, and where its fade is heading.
 *   drop  a lost point is left out (four corners become a triangle, then a line)
 *   hold  a lost point stays where it was last seen (its null waits there)
 *   fade  every point stays; the whole shape fades out while any is lost
 * Returns { pts: [{ x, y }], target: 0 | 1 }.
 */
export function geoPathNodes(nodes, onLost) {
  const anyLost = nodes.some(n => n.lost);
  const pts = (onLost === 'drop' ? nodes.filter(n => !n.lost) : nodes).map(n => ({ x: n.x, y: n.y }));
  return { pts, target: onLost === 'fade' && anyLost ? 0 : 1 };
}

/** A fade one frame on: from `prev` toward `target` (0 or 1), a full fade taking GEO_PATH_FADE_S. No `prev` yet: already there. */
export function geoPathFade(prev, target, dt) {
  const a = typeof prev === 'number' && isFinite(prev) ? prev : target, step = Math.max(0, dt) / GEO_PATH_FADE_S;
  return target > a ? Math.min(target, a + step) : Math.max(target, a - step);
}

/**
 * A path shape's geometry from its points (0..1, y up), in picture heights:
 *   o.style      fill (a polygon through the points) · smooth (a closed curve through them) ·
 *                circle · lines (joined in order, open) · web (every pair joined)
 *   o.hull       fill and smooth: go round the outside (the convex hull), so points that cross don't make a bow-tie
 *   o.circleMode spread: centre the points' middle, radius their mean distance from it ·
 *                first: centre the first point, radius the mean distance of the others (two points: the second sets it)
 *   o.webReach   web: join only points closer than this (picture heights); 0 joins all. Links fade as they stretch toward it
 *   o.lineR      lines and web: half the stroke's thickness (picture heights), for particle walls
 * Returns { style, closed, pts (flat outline), segs ([x0, y0, x1, y1, r, …]: lines, webs and two-point
 * paths), alphas (per web link), cx, cy (its centre, 0..1), x0, y0, x1, y1 (bounds, picture
 * heights), area, perimeter, spread } — the last three raw, in picture heights (geoPathReadings
 * makes them 0..1).
 */
export function geoPathBuild(points, aspect, o) {
  const P = points.map(p => [p.x * aspect, p.y]);
  const n = P.length;
  const style = GEO_PATH_STYLES.includes(o.style) ? o.style : 'fill';
  const out = { style, closed: false, pts: [], segs: [], alphas: [], cx: 0.5, cy: 0.5, x0: 0, y0: 0, x1: 0, y1: 0, area: 0, perimeter: 0, spread: 0 };
  if (!n) return out;
  let mx = 0, my = 0;
  for (const p of P) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  out.cx = mx / aspect; out.cy = my;
  let sd = 0;
  for (const p of P) sd += Math.hypot(p[0] - mx, p[1] - my);
  out.spread = sd / n;
  const r = Math.max(0, o.lineR || 0);
  const flat = list => { const f = []; for (const p of list) f.push(p[0], p[1]); return f; };
  const chain = list => { const s = []; for (let i = 0; i + 1 < list.length; i++) s.push(list[i][0], list[i][1], list[i + 1][0], list[i + 1][1], r); return s; };
  if (style === 'circle') {
    let c, R = 0;
    if (o.circleMode === 'first') {
      c = P[0];
      for (let i = 1; i < n; i++) R += Math.hypot(P[i][0] - c[0], P[i][1] - c[1]);
      R = n > 1 ? R / (n - 1) : 0;
    } else { c = [mx, my]; R = out.spread; }
    if (R > 1e-6) {
      const ring = [];
      for (let i = 0; i < GEO_CIRCLE_STEPS; i++) { const t = (i / GEO_CIRCLE_STEPS) * Math.PI * 2; ring.push([c[0] + Math.cos(t) * R, c[1] + Math.sin(t) * R]); }
      out.closed = true; out.pts = flat(ring);
      out.area = Math.PI * R * R; out.perimeter = 2 * Math.PI * R;
    }
    out.cx = c[0] / aspect; out.cy = c[1];
  } else if (style === 'web') {
    const reach = Math.max(0, o.webReach || 0);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1]);
      if (reach > 0 && d > reach) continue;
      out.segs.push(P[i][0], P[i][1], P[j][0], P[j][1], r);
      out.alphas.push(reach > 0 ? Math.max(0, 1 - d / reach) : 1);
      out.perimeter += d;
    }
    const h = geoHull(P);
    if (h.length >= 3) out.area = geoPolyArea(flat(h));
    out.pts = flat(P);
  } else if (style === 'lines') {
    out.pts = flat(P);
    out.segs = chain(P);
    out.perimeter = geoPolyLength(out.pts, false);
    const h = geoHull(P);
    if (h.length >= 3) out.area = geoPolyArea(flat(h));
  } else {
    // fill · smooth
    let list = o.hull ? geoHull(P) : P;
    if (list.length >= 3) {
      if (style === 'smooth') list = geoCatmullRom(list, GEO_SMOOTH_STEPS);
      out.closed = true; out.pts = flat(list);
      out.area = geoPolyArea(out.pts); out.perimeter = geoPolyLength(out.pts, true);
    } else if (list.length === 2) {
      // Two points: a line between them.
      out.pts = flat(list); out.segs = chain(list); out.perimeter = geoPolyLength(out.pts, false);
    }
  }
  if (out.pts.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < out.pts.length; i += 2) { x0 = Math.min(x0, out.pts[i]); x1 = Math.max(x1, out.pts[i]); y0 = Math.min(y0, out.pts[i + 1]); y1 = Math.max(y1, out.pts[i + 1]); }
    out.x0 = x0; out.y0 = y0; out.x1 = x1; out.y1 = y1;
  }
  return out;
}

/**
 * A path's readings, 0..1, for mappings:
 *   area       the share of the picture it covers (lines and webs: the area their points span)
 *   perimeter  its outline's length (a web: all its links) against the picture's own edge
 *   spread     the points' mean distance from their centre; 1 is half a picture height or more
 */
export function geoPathReadings(geo, aspect) {
  const c = v => Math.max(0, Math.min(1, isFinite(v) ? v : 0));
  return { area: c(geo.area / Math.max(1e-6, aspect)), perimeter: c(geo.perimeter / (2 * (aspect + 1))), spread: c(geo.spread / 0.5) };
}
