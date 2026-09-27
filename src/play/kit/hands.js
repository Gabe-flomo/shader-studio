/**
 * hands.js — what hand tracking means once the landmarks are in: the pure
 * part, shared by the app (lib/playEngine.ts, play/overlay.ts) and web
 * exports (inlined with the rest of the kit, so its top-level names stay
 * distinct: everything here starts with hd / HD_).
 *
 * A tracker (MediaPipe's Hand Landmarker, lib/handTracker.ts in the app)
 * hands in raw frames:
 *
 *   { t, w, h, hands: [{ side: 'left' | 'right', score, lm: [x, y, z] × 21 }] }
 *
 * t is when the camera frame was taken (ms, performance.now), w × h its size,
 * lm the 21 landmarks in the camera image (0..1, y down; z relative to the
 * wrist, in image widths). `side` is the performer's own hand: the tracker has
 * already undone MediaPipe's selfie convention.
 *
 * hdUpdate turns a frame into hands on the picture: placed where a camera
 * layer shows the camera (or covering the picture when there is none),
 * mirrored like a selfie view by default, smoothed with a one-euro filter,
 * held for a moment when a hand drops out, and read as values (pinch,
 * openness, palm centre, roll…) and gestures with hysteresis (a pinch fires
 * once, not on every jittery frame).
 */

/** The 21 landmarks, in MediaPipe's order. */
export const HD_POINT_NAMES = [
  'Wrist',
  'Thumb base', 'Thumb knuckle', 'Thumb joint', 'Thumb tip',
  'Index knuckle', 'Index middle joint', 'Index top joint', 'Index tip',
  'Middle knuckle', 'Middle middle joint', 'Middle top joint', 'Middle tip',
  'Ring knuckle', 'Ring middle joint', 'Ring top joint', 'Ring tip',
  'Pinky knuckle', 'Pinky middle joint', 'Pinky top joint', 'Pinky tip',
];
/** Fingertips a pinch can use (against the thumb tip), index to pinky. */
export const HD_TIPS = [8, 12, 16, 20];
/** The skeleton's bones, as landmark pairs. */
export const HD_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
export const HD_GESTURES = ['pinch', 'pinchMiddle', 'pinchRing', 'pinchPinky', 'fist', 'open', 'point', 'appear', 'leave'];
/** How long a hand that dropped out of the picture is still "there" (ms): a missed frame doesn't flicker it off. */
export const HD_HOLD_MS = 250;

// Gesture thresholds: turn on past `on`, off again only past `off` (hysteresis).
const HD_PINCH_ON = 0.28, HD_PINCH_OFF = 0.42;
const HD_FIST_ON = 0.72, HD_FIST_OFF = 0.55;
const HD_OPEN_ON = 0.8, HD_OPEN_OFF = 0.62;
const HD_POINT_ON = 0.65, HD_POINT_OFF = 0.45;

const hdClamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);

function hdHand() {
  return {
    present: false, seen: -1e12, ever: false,
    /** Smoothed landmarks on the picture: x (0..1 of its width), y (0..1, up), z (picture heights, relative to the wrist; smaller is nearer). */
    pts: new Float64Array(63),
    euro: null,
    d: { palm: 0.1, pinchRatio: [9, 9, 9, 9], pinch: [1, 1, 1, 1], curl: [0, 0, 0, 0], thumbOut: false, open: 0, roll: 0.5, size: 0, px: 0.5, py: 0.5 },
    g: { pinch: false, pinchMiddle: false, pinchRing: false, pinchPinky: false, fist: false, open: false, point: false },
  };
}

/** Tracking state for both hands. `live` turns true with the first frame. */
export function hdCreate() {
  return { live: false, t: -1, seq: 0, count: 0, aspect: 16 / 9, left: hdHand(), right: hdHand() };
}

// ── One-euro filter (Casiez et al.): steady when still, quick when moving ─────

function hdAlpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
/** Filter one value. `f` is { x, dx, t } (t < 0: not started). Times in ms. */
export function hdEuroStep(f, v, t, minCutoff, beta) {
  if (f.t < 0) { f.x = v; f.dx = 0; f.t = t; return v; }
  const dt = Math.max(0.001, (t - f.t) / 1000);
  f.t = t;
  const dx = (v - f.x) / dt;
  f.dx += hdAlpha(1, dt) * (dx - f.dx);
  f.x += hdAlpha(minCutoff + beta * Math.abs(f.dx), dt) * (v - f.x);
  return f.x;
}
/** The filter's settings for a Smoothing of 0..1 (0: raw landmarks). */
export function hdEuroParams(smoothing) {
  const s = hdClamp(smoothing);
  return { minCutoff: 0.6 + 12 * (1 - s) * (1 - s), beta: 0.4 + 8 * (1 - s) };
}

// ── Where the camera sits on the picture ─────────────────────────────────────

/**
 * The camera image's place on the picture: centre (cx, cy, y up), height as a
 * fraction of the picture's, rotation (degrees, clockwise) and mirroring.
 * A Camera layer (the first one) places it where it shows it; with none it
 * covers the picture, so a hand can reach every edge.
 */
export function hdPlacement(record, value, camAspect, picAspect, mirror) {
  const cam = record && record.layers ? record.layers.find(l => l.kind === 'camera') : null;
  if (cam) return { cx: value(cam, 'x'), cy: value(cam, 'y'), h: value(cam, 'scale'), rot: value(cam, 'rotation'), mirror: !!cam.mirror };
  return { cx: 0.5, cy: 0.5, h: camAspect > 0 && picAspect > 0 ? Math.max(1, picAspect / camAspect) : 1, rot: 0, mirror: mirror !== false };
}

/** A camera-image point (0..1, y down) on the picture: [x, y] with y up. */
export function hdToPicture(u, v, place, camAspect, picAspect) {
  const x = place.mirror ? 1 - u : u;
  const dx = (x - 0.5) * place.h * camAspect, dy = (v - 0.5) * place.h;
  const r = (place.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [place.cx + (dx * c - dy * s) / picAspect, place.cy - (dx * s + dy * c)];
}

// ── Updating ─────────────────────────────────────────────────────────────────

/**
 * Take a tracker frame. `o`: { picAspect, place (hdPlacement), smoothing }.
 * `now` is the frame's time (ms). Two detections claiming the same hand: the
 * surer one keeps it and the other is taken as the opposite hand.
 */
export function hdUpdate(st, frame, o) {
  const now = frame.t;
  st.live = true; st.seq++; st.aspect = o.picAspect;
  const camAspect = frame.w > 0 && frame.h > 0 ? frame.w / frame.h : 16 / 9;
  const place = o.place || hdPlacement(null, null, camAspect, o.picAspect, true);
  const hands = (frame.hands || []).slice(0, 2).sort((a, b) => (b.score || 0) - (a.score || 0));
  const bySide = { left: null, right: null };
  for (const h of hands) {
    const side = h.side === 'left' ? 'left' : 'right';
    if (!bySide[side]) bySide[side] = h; else if (!bySide[side === 'left' ? 'right' : 'left']) bySide[side === 'left' ? 'right' : 'left'] = h;
  }
  const ep = hdEuroParams(o.smoothing == null ? 0.5 : o.smoothing);
  const raw = o.smoothing <= 0.001;
  st.count = 0;
  for (const side of ['left', 'right']) {
    const hand = st[side], det = bySide[side];
    if (det && det.lm && det.lm.length >= 63) {
      if (!hand.present || !hand.euro) hand.euro = Array.from({ length: 63 }, () => ({ x: 0, dx: 0, t: -1 }));
      const zScale = place.h * camAspect;
      for (let i = 0; i < 21; i++) {
        const p = hdToPicture(det.lm[i * 3], det.lm[i * 3 + 1], place, camAspect, o.picAspect);
        const z = (det.lm[i * 3 + 2] || 0) * zScale;
        const vals = [p[0], p[1], z];
        for (let k = 0; k < 3; k++) {
          const j = i * 3 + k;
          hand.pts[j] = raw ? vals[k] : hdEuroStep(hand.euro[j], vals[k], now, ep.minCutoff, ep.beta);
        }
      }
      hand.present = true; hand.ever = true; hand.seen = now;
      hdDerive(hand, o.picAspect);
    } else if (hand.present && now - hand.seen > HD_HOLD_MS) {
      hdDrop(hand);
    }
    if (hand.present) st.count++;
  }
  st.t = now;
}

function hdDrop(hand) {
  hand.present = false; hand.euro = null;
  for (const k in hand.g) hand.g[k] = false;
}

/** Let a held hand go once the hold is over, when frames stop arriving (the tracker paused or stalled). */
export function hdAge(st, now) {
  let n = 0;
  for (const side of ['left', 'right']) {
    const hand = st[side];
    if (hand.present && now - hand.seen > HD_HOLD_MS + 250) hdDrop(hand);
    if (hand.present) n++;
  }
  st.count = n;
}

/** Everything a hand is read as, and its gestures, from its smoothed landmarks. */
function hdDerive(hand, A) {
  const p = hand.pts, d = hand.d, g = hand.g;
  const X = i => p[i * 3] * A, Y = i => p[i * 3 + 1], Z = i => p[i * 3 + 2];
  const dist = (i, j) => Math.hypot(X(i) - X(j), Y(i) - Y(j), Z(i) - Z(j));
  const palm = Math.max(1e-4, dist(0, 9));
  d.palm = palm;
  for (let f = 0; f < 4; f++) {
    const tip = HD_TIPS[f], mcp = tip - 3;
    const ext = dist(tip, 0) / Math.max(1e-4, dist(mcp, 0));
    d.curl[f] = hdClamp((1.8 - ext) / 0.75);
    d.pinchRatio[f] = dist(4, tip) / palm;
    d.pinch[f] = hdClamp((d.pinchRatio[f] - 0.15) / 1.05);
  }
  d.thumbOut = dist(4, 5) / palm > 0.6;
  const meanCurl = (d.curl[0] + d.curl[1] + d.curl[2] + d.curl[3]) / 4;
  d.open = 1 - meanCurl;
  d.roll = 0.5 + Math.atan2(X(9) - X(0), Y(9) - Y(0)) / (2 * Math.PI);
  d.size = hdClamp((palm - 0.06) / 0.3);
  d.px = (p[0] + p[15] + p[27] + p[39] + p[51]) / 5;
  d.py = (p[1] + p[16] + p[28] + p[40] + p[52]) / 5;
  // A fist: every finger in, not just most (pointing has three curled).
  const minCurl = Math.min(d.curl[0], d.curl[1], d.curl[2], d.curl[3]);
  g.fist = g.fist ? meanCurl >= HD_FIST_OFF && minCurl >= 0.3 : meanCurl >= HD_FIST_ON && minCurl >= 0.5;
  // Pinches: only the nearest fingertip starts one, and not in a fist (the thumb lies across the fingers there).
  let nearest = 0;
  for (let f = 1; f < 4; f++) if (d.pinchRatio[f] < d.pinchRatio[nearest]) nearest = f;
  const keys = ['pinch', 'pinchMiddle', 'pinchRing', 'pinchPinky'];
  for (let f = 0; f < 4; f++) {
    const k = keys[f];
    if (g[k]) g[k] = d.pinchRatio[f] <= HD_PINCH_OFF;
    else g[k] = f === nearest && d.pinchRatio[f] < HD_PINCH_ON && d.curl[f] < 0.8 && !g.fist;
  }
  g.open = g.open ? d.open >= HD_OPEN_OFF : d.open >= HD_OPEN_ON && d.thumbOut;
  // Pointing: the index out, the middle finger in (a V sign isn't pointing), ring and pinky mostly in.
  const pointScore = Math.min(1 - d.curl[0], d.curl[1], (d.curl[2] + d.curl[3]) / 2);
  g.point = g.point ? pointScore >= HD_POINT_OFF : pointScore >= HD_POINT_ON;
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** The hand a side means: 'any' is the right hand if it is there, else the left. */
export function hdHandFor(st, side) {
  if (side === 'left' || side === 'right') return st[side];
  return st.right.present ? st.right : st.left;
}

/**
 * A hand source's reading, 0..1, or null while there is nothing to read (the
 * tracker hasn't started, or the hand isn't in view): a mapping then leaves
 * its control where it was.
 *   point  a landmark's x, y (0..1 over the picture, y up) or z (0.5 level with the wrist, 1 nearer the camera)
 *   palm   the palm centre's x or y
 *   pinch  thumb tip to a fingertip (`point`: 8, 12, 16, 20): 0 touching, 1 spread wide
 *   open   0 a fist, 1 an open hand
 *   roll   the hand's turn in the picture: 0.5 upright, more leaning right
 *   size   how big the hand looks: 0 far, 1 close to the camera
 *   present 1 while the hand is in view
 *   spread the two palms' distance, 1 = a picture width apart (null unless both are in view)
 *   gesture 1 while `gesture` is held
 */
export function hdRead(st, side, read, point, axis, gesture) {
  if (!st.live) return null;
  if (read === 'present') return hdGate(st, side, 'appear') ? 1 : 0;
  if (read === 'gesture') return hdGate(st, side, gesture) ? 1 : 0;
  if (read === 'spread') {
    if (!st.left.present || !st.right.present) return null;
    const A = st.aspect;
    return hdClamp(Math.hypot((st.left.d.px - st.right.d.px) * A, st.left.d.py - st.right.d.py) / A);
  }
  const h = hdHandFor(st, side);
  if (!h.present) return null;
  const d = h.d;
  switch (read) {
    case 'point': {
      const i = Math.max(0, Math.min(20, point | 0));
      if (axis === 'z') return hdClamp(0.5 - (h.pts[i * 3 + 2] / d.palm) * 0.5);
      return hdClamp(h.pts[i * 3 + (axis === 'y' ? 1 : 0)]);
    }
    case 'palm': return hdClamp(axis === 'y' ? d.py : d.px);
    case 'pinch': { const f = HD_TIPS.indexOf(point); return d.pinch[f < 0 ? 0 : f]; }
    case 'open': return d.open;
    case 'roll': return hdClamp(d.roll);
    case 'size': return d.size;
    default: return null;
  }
}

/**
 * Is a gesture held? 'appear' is the hand in view; 'leave' the hand gone
 * (after it was seen once). Side 'any': either hand.
 */
export function hdGate(st, side, gesture) {
  if (side !== 'left' && side !== 'right') {
    if (gesture === 'leave') return (st.left.ever || st.right.ever) && !st.left.present && !st.right.present;
    return hdGate(st, 'left', gesture) || hdGate(st, 'right', gesture);
  }
  const h = st[side];
  if (gesture === 'appear') return h.present;
  if (gesture === 'leave') return h.ever && !h.present;
  return h.present && !!h.g[gesture];
}

/** A landmark on the picture ({ x, y }, y up), or null while that hand is out of view. */
export function hdPoint(st, side, point) {
  const h = hdHandFor(st, side);
  if (!h.present) return null;
  const i = Math.max(0, Math.min(20, point | 0));
  return { x: h.pts[i * 3], y: h.pts[i * 3 + 1] };
}

// ── Drawing the skeleton (setup aid) ─────────────────────────────────────────

/** Bones and landmark dots for every hand in view, in `rgb` (0..1), with an L / R tag at the wrist. */
export function hdDraw(ctx, st, W, H, dpr, rgb) {
  if (!st || !st.live) return;
  const c = rgb || [0.35, 1, 0.75];
  const css = a => 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a + ')';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  for (const side of ['left', 'right']) {
    const h = st[side];
    if (!h.present) continue;
    const px = i => h.pts[i * 3] * W, py = i => (1 - h.pts[i * 3 + 1]) * H;
    ctx.lineCap = 'round'; ctx.lineWidth = 2.2 * dpr; ctx.strokeStyle = css(0.8);
    ctx.beginPath();
    for (const [a, b] of HD_BONES) { ctx.moveTo(px(a), py(a)); ctx.lineTo(px(b), py(b)); }
    ctx.stroke();
    for (let i = 0; i < 21; i++) {
      const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.fillStyle = tip ? '#ffffff' : css(1);
      ctx.beginPath(); ctx.arc(px(i), py(i), (tip ? 4 : 3) * dpr, 0, Math.PI * 2); ctx.fill();
      if (tip) { ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = css(1); ctx.stroke(); }
    }
    ctx.font = '600 ' + Math.round(11 * dpr) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tx = px(0), ty = py(0) + 14 * dpr;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.arc(tx, ty, 9 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(side === 'left' ? 'L' : 'R', tx, ty + 0.5 * dpr);
  }
  ctx.restore();
}
