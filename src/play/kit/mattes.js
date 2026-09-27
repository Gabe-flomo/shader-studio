/**
 * mattes.js — track mattes and masks (part of the layer kit, see kit.js).
 *
 * A layer can take another layer as its **track matte**: the layer is drawn
 * into a canvas of its own, then multiplied by the matte's alpha (or its
 * brightness, luma), optionally inverted, before it lands on the picture
 * with its own blend. A layer can also own **masks**: rectangles, ellipses
 * and drawn outlines that hang from the layer's position and turn, with
 * feather, expand, opacity, invert, and add / subtract / intersect when
 * there are several.
 *
 * Mask numbers live flat on the layer as `mask_<id>_<prop>` (like a Script
 * layer's `p_` keys), so a control, a mapping or a take drives them like any
 * other layer number. Everything else about a mask (shape, points, op,
 * invert) is in `l.masks`.
 *
 * Plain JS shared by the app and web exports; every kit file shares one scope
 * when inlined, so top-level names here start with `km` / `KM`.
 */
import { klCanvas, klShapePath } from './layers.js';

/** A mask's numbers, in the order the editor shows them. */
export const KM_MASK_PROPS = ['x', 'y', 'w', 'h', 'rotation', 'round', 'feather', 'expand', 'opacity'];
/** x, y: offset from the layer's centre (picture heights, y up) · w, h: size (picture heights) · feather, expand: picture heights. */
export const KM_MASK_DEFAULTS = { x: 0, y: 0, w: 0.5, h: 0.5, rotation: 0, round: 0, feather: 0, expand: 0, opacity: 1 };
/** Mask shape → the shape-layer outline it draws with. Polygon points are in its box, -0.5..0.5 each way (y up). */
const KM_SHAPES = { rect: 'box', ellipse: 'circle', polygon: 'polygon' };
/** Kinds whose rotation turns the whole layer (their masks turn with it). */
const KM_TURNS = { text: 1, image: 1, camera: 1, shape: 1 };
/** Luma mattes are read back at most this many pixels along the long side (a luma matte is soft anyway). */
const KM_LUMA_SIDE = 960;

export function kmMaskKey(id, prop) { return 'mask_' + id + '_' + prop; }

/** Where a layer's masks hang from: its centre and turn, or the picture's middle for layers without a place. */
export function kmAnchor(l, v) {
  if (typeof l.x !== 'number' || typeof l.y !== 'number' || l.kind === 'background') return { x: 0.5, y: 0.5, rot: 0 };
  return { x: v('x'), y: v('y'), rot: KM_TURNS[l.kind] ? v('rotation') : 0 };
}

/** One of a mask's numbers now (a control may drive it), or its default. */
export function kmMaskValue(m, v, prop) {
  const n = v(kmMaskKey(m.id, prop));
  return typeof n === 'number' && isFinite(n) ? n : KM_MASK_DEFAULTS[prop];
}

/**
 * A mask on the picture: centre (0..1, y up), size (picture heights), turn,
 * and its points scaled to its box, ready for klShapePath. The offset turns
 * with the layer, so the mask moves and turns with it.
 */
export function kmMaskPlacement(l, m, v, aspect) {
  const a = kmAnchor(l, v), g = p => kmMaskValue(m, v, p);
  const dx = g('x'), dy = g('y'), t = a.rot * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  // The offset on screen (picture heights, y down), turned clockwise with the layer.
  const rx = dx * c + dy * s, ry = dx * s - dy * c;
  const w = Math.max(0.001, g('w')), h = Math.max(0.001, g('h'));
  const pts = [];
  if (m.shape === 'polygon' && m.points) for (let i = 0; i + 1 < m.points.length; i += 2) pts.push(m.points[i] * w, m.points[i + 1] * h);
  return {
    x: a.x + rx / aspect, y: a.y - ry, w, h, rotation: a.rot + g('rotation'), round: g('round'),
    feather: Math.max(0, g('feather')), expand: g('expand'), opacity: Math.max(0, Math.min(1, g('opacity'))), points: pts, turn: a.rot,
  };
}

/**
 * The mask offset and turn that put a mask at picture position (x, y) with
 * turn `rotation` (the inverse of kmMaskPlacement), for dragging it.
 */
export function kmMaskLocal(l, v, aspect, x, y, rotation) {
  const a = kmAnchor(l, v), t = a.rot * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const rx = (x - a.x) * aspect, ry = -(y - a.y);
  const px = rx * c + ry * s, py = -rx * s + ry * c;
  return { x: px, y: -py, rotation: rotation - a.rot };
}

/** A mask's outline as a Path2D in device pixels. */
export function kmMaskPath(m, p, W, H) {
  const shape = { shape: KM_SHAPES[m.shape] || 'box', points: p.points };
  return klShapePath(shape, k => p[k], W, H).path;
}

// ── The maths (the canvas below does the same with composite operations) ──

/** How much of a matted pixel shows, 0..1, from its matte's pixel (0..1 each). Luma is the brightness over black. */
export function kmMatteValue(r, g, b, a, mode, invert) {
  const m = mode === 'luma' ? (0.299 * r + 0.587 * g + 0.114 * b) * a : a;
  return invert ? 1 - m : m;
}

/**
 * Masks combine one after another: Add is the union (source-over),
 * Subtract cuts (destination-out), Intersect keeps the overlap
 * (destination-in). `m` already has the mask's invert and opacity in it.
 */
export function kmMix(acc, m, op) {
  if (op === 'subtract') return acc * (1 - m);
  if (op === 'intersect') return acc * m;
  return acc + m - acc * m;
}

/** What the masks start from: nothing when the first adds, everything when it subtracts or intersects. */
export function kmMaskStart(masks) { return masks.length && masks[0].op !== 'add' ? 1 : 0; }

/** A matte's pixels (RGBA bytes) → white with alpha = the matte value, in place. */
export function kmLumaToAlpha(d, invert) {
  for (let i = 0; i < d.length; i += 4) {
    const m = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * d[i + 3] / 65025;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = Math.round((invert ? 1 - m : m) * 255);
  }
}

// ── Which layer mattes which ────────────────────────────────────────────────

/** A layer's track matte, if it has a usable one: another layer that draws something. */
export function kmTrackOf(l, byId) {
  const t = l.trackMatte;
  if (!t || !t.id || t.id === l.id || l.kind === 'null' || l.kind === 'background') return null;
  const m = byId.get(t.id);
  return m && m.kind !== 'null' ? m : null;
}

/** Would `consumerId` using `matteId` as its matte make a loop (a matte of a matte of … itself)? */
export function kmWouldCycle(layers, consumerId, matteId) {
  const byId = new Map(layers.map(l => [l.id, l]));
  let id = matteId;
  for (let guard = 0; id && guard <= layers.length; guard++) {
    if (id === consumerId) return true;
    const l = byId.get(id);
    id = l && l.trackMatte ? l.trackMatte.id : '';
  }
  return false;
}

/** Every layer that is a matte (directly or down a chain) for a layer that is drawn. */
export function kmMatteSources(layers, drawn) {
  const byId = new Map(layers.map(l => [l.id, l])), out = new Set();
  for (const l of layers) {
    if (!drawn(l)) continue;
    let cur = l;
    for (let guard = 0; guard <= layers.length; guard++) {
      const m = kmTrackOf(cur, byId);
      if (!m || out.has(m.id)) break;
      out.add(m.id);
      cur = m;
    }
  }
  return out;
}

// ── Canvas ───────────────────────────────────────────────────────────────────

function kmReset(x) {
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  x.shadowBlur = 0; x.shadowOffsetX = 0; x.shadowOffsetY = 0; x.shadowColor = 'rgba(0,0,0,0)';
}

/** Multiply what is in `o` (W×H) by the matte canvas: its alpha, or its brightness (read back at a reduced size). */
export function kmApplyTrack(pool, o, matte, t, W, H) {
  if (t.mode === 'luma') {
    const k = Math.min(1, KM_LUMA_SIDE / Math.max(W, H)), lw = Math.max(1, Math.round(W * k)), lh = Math.max(1, Math.round(H * k));
    const c = klCanvas(pool, 'kmLuma', lw, lh), x = c.getContext('2d', { willReadFrequently: true });
    kmReset(x); x.clearRect(0, 0, lw, lh); x.drawImage(matte, 0, 0, lw, lh);
    let img;
    try { img = x.getImageData(0, 0, lw, lh); } catch (e) { return; }
    kmLumaToAlpha(img.data, !!t.invert);
    x.putImageData(img, 0, 0);
    o.globalCompositeOperation = 'destination-in';
    o.drawImage(c, 0, 0, W, H);
  } else {
    o.globalCompositeOperation = t.invert ? 'destination-out' : 'destination-in';
    o.drawImage(matte, 0, 0);
  }
  o.globalCompositeOperation = 'source-over';
}

/** One mask as white-with-alpha: the shape, grown or shrunk, softened, inverted. { el, w, h }: the part of `el` that holds it (half size when feathered). */
function kmOneMask(pool, m, p, W, H) {
  const c = klCanvas(pool, 'kmOne', W, H), x = c.getContext('2d');
  kmReset(x); x.clearRect(0, 0, W, H);
  const path = kmMaskPath(m, p, W, H);
  x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineJoin = 'round';
  x.fill(path);
  const e = p.expand * H;
  if (e > 0.25) { x.lineWidth = e * 2; x.stroke(path); }
  else if (e < -0.25) { x.globalCompositeOperation = 'destination-out'; x.lineWidth = -e * 2; x.stroke(path); x.globalCompositeOperation = 'source-over'; }
  let out = { el: c, w: W, h: H };
  const f = p.feather * H;
  if (f >= 1) {
    // Soft edge: the blurred shadow of the shape, at half size. The shape goes in the right half of a canvas
    // twice as wide and its shadow lands in the left half, which is all that is used. (A canvas filter would be
    // simpler, but Safari's canvas has none; shadows blur everywhere.)
    const hw = Math.max(1, Math.ceil(W / 2)), hh = Math.max(1, Math.ceil(H / 2));
    const b = klCanvas(pool, 'kmSoft', hw * 2, hh), y = b.getContext('2d');
    kmReset(y); y.clearRect(0, 0, hw * 2, hh);
    y.shadowColor = '#fff'; y.shadowBlur = f / 2; y.shadowOffsetX = -hw;
    y.drawImage(c, hw, 0, hw, hh);
    kmReset(y);
    out = { el: b, w: hw, h: hh };
  }
  if (m.invert) {
    const i = klCanvas(pool, 'kmInv', W, H), z = i.getContext('2d');
    kmReset(z); z.fillStyle = '#fff'; z.fillRect(0, 0, W, H);
    z.globalCompositeOperation = 'destination-out'; z.drawImage(out.el, 0, 0, out.w, out.h, 0, 0, W, H); z.globalCompositeOperation = 'source-over';
    out = { el: i, w: W, h: H };
  }
  return out;
}

/**
 * All of a layer's masks combined into one canvas (alpha = how much shows),
 * drawn again only when a mask or the layer's place changes.
 */
export function kmMaskCanvas(pool, l, v, W, H) {
  const masks = l.masks, aspect = W / H;
  const places = masks.map(m => kmMaskPlacement(l, m, v, aspect));
  const key = W + 'x' + H + '|' + places.map(p => [p.x, p.y, p.w, p.h, p.rotation, p.round, p.feather, p.expand, p.opacity].join(',')).join('|');
  const acc = klCanvas(pool, 'mk:' + l.id, W, H);
  if (acc._kmKey === key && acc._kmMasks === masks) return acc;
  const a = acc.getContext('2d');
  kmReset(a); a.clearRect(0, 0, W, H);
  if (kmMaskStart(masks)) { a.fillStyle = '#fff'; a.fillRect(0, 0, W, H); }
  masks.forEach((m, i) => {
    const p = places[i];
    const one = kmOneMask(pool, m, p, W, H);
    a.globalAlpha = p.opacity;
    a.globalCompositeOperation = m.op === 'subtract' ? 'destination-out' : m.op === 'intersect' ? 'destination-in' : 'source-over';
    a.drawImage(one.el, 0, 0, one.w, one.h, 0, 0, W, H);
  });
  kmReset(a);
  acc._kmKey = key; acc._kmMasks = masks;
  return acc;
}

/** Cut `o` (a layer drawn on its own) by its masks. */
export function kmApplyMasks(pool, o, l, v, W, H) {
  const mk = kmMaskCanvas(pool, l, v, W, H);
  o.globalCompositeOperation = 'destination-in';
  o.drawImage(mk, 0, 0);
  o.globalCompositeOperation = 'source-over';
}
