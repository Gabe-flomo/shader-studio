/**
 * hands.js — what hand tracking means once the landmarks are in: the pure
 * part, shared by the app (lib/playEngine.ts, play/overlay.ts) and web
 * exports (inlined with the rest of the kit, so its top-level names stay
 * distinct: everything here starts with hd / HD_).
 *
 * A tracker (MediaPipe's Hand Landmarker, lib/trackerPump.ts in the app)
 * hands in raw frames:
 *
 *   { t, w, h, hands: [{ side: 'left' | 'right', score, lm: [x, y, z] × 21 }] }
 *
 * t is when the camera frame was taken (ms, performance.now), w × h its size,
 * lm the 21 landmarks in the camera image (0..1, y down; z relative to the
 * wrist, in image widths). `side` is MediaPipe's classifier as it comes: the
 * performer's own hand for an unmirrored camera frame (checked against photos
 * of known right hands), with its score. It is only a vote, one frame at a time.
 *
 * hdUpdate turns frames into steady hands:
 *   - it drops detections that can't be a hand (too small, or off the frame);
 *   - it follows each hand as a track, matched frame to frame by where its
 *     palm is, so a hand keeps its side even when the classifier wavers: the
 *     side changes only after the classifier disagrees, sure of itself, for
 *     HD_SIDE_SWITCH_MS;
 *   - a new hand has to be seen HD_APPEAR_FRAMES frames running before it
 *     counts (a phantom for a frame or two never appears), and a hand that
 *     drops out is held for HD_HOLD_MS;
 *   - then it places the hands where a camera layer shows the camera (or
 *     covering the picture when there is none), mirrored like a selfie view by
 *     default, smooths each landmark with a one-euro filter, and reads them as
 *     values (pinch, openness, palm centre, roll…) and gestures with
 *     hysteresis (a pinch fires once, not on every jittery frame).
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
/** Frames running a new hand has to be seen before it counts: a phantom for a frame or two never appears. */
export const HD_APPEAR_FRAMES = 3;
/** A hand's side changes only after the classifier says the other side this long (ms), at HD_SIDE_SCORE or surer. */
export const HD_SIDE_SWITCH_MS = 700;
export const HD_SIDE_SCORE = 0.8;
/** The smallest believable hand: its landmarks' extent, in camera-image heights. */
export const HD_MIN_SIZE = 0.06;

// Gesture thresholds: turn on past `on`, off again only past `off` (hysteresis).
const HD_PINCH_ON = 0.28, HD_PINCH_OFF = 0.42;
const HD_FIST_ON = 0.72, HD_FIST_OFF = 0.55;
const HD_OPEN_ON = 0.8, HD_OPEN_OFF = 0.62;
const HD_POINT_ON = 0.65, HD_POINT_OFF = 0.45;

const hdClamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);

function hdHand() {
  return {
    present: false, seen: -1e12, ever: false,
    /** The track this hand is showing (0: none), and that track's classifier score. */
    track: 0, score: 0,
    /** Smoothed landmarks on the picture: x (0..1 of its width), y (0..1, up), z (picture heights, relative to the wrist; smaller is nearer). */
    pts: new Float64Array(63),
    euro: null,
    d: { palm: 0.1, pinchRatio: [9, 9, 9, 9], pinch: [1, 1, 1, 1], curl: [0, 0, 0, 0], thumbOut: false, open: 0, roll: 0.5, size: 0, px: 0.5, py: 0.5 },
    g: { pinch: false, pinchMiddle: false, pinchRing: false, pinchPinky: false, fist: false, open: false, point: false },
  };
}

/**
 * Tracking state for both hands. `live` turns true with the first frame.
 * `tracks` are the hands being followed (a new one is `confirmed` after
 * HD_APPEAR_FRAMES); `left` and `right` are what everything reads.
 * `raw` and `rejected` count the last frame's detections (for the settings' readout).
 */
export function hdCreate() {
  return { live: false, t: -1, seq: 0, count: 0, aspect: 16 / 9, left: hdHand(), right: hdHand(), tracks: [], nextId: 1, raw: 0, rejected: 0 };
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
/**
 * The filter's settings. Smoothing (0..1) sets the cutoff when the hand is
 * still: 0 passes the landmarks through, 0.5 is 1.6 Hz, 1 is 0.3 Hz (calm,
 * and slow to follow). Responsiveness (0..1) sets how much speed opens the
 * filter up (beta): 0 never (a plain low-pass, laggy on fast moves), 0.5 a
 * fast move follows within a frame or two, 1 barely smooths while moving.
 * Positions are in picture units, so a quick hand moves 1–3 units a second.
 */
export function hdEuroParams(smoothing, responsiveness) {
  const s = hdClamp(smoothing), r = hdClamp(responsiveness == null ? 0.5 : responsiveness);
  return { minCutoff: 0.3 * Math.pow(30, 1 - s), beta: r <= 0 ? 0 : 0.5 * Math.pow(80, r) };
}

/**
 * MediaPipe's options for the setup's hand settings (PlayHands): how many
 * hands, and the three confidence thresholds, from Strictness 0..1 (0.5: a
 * notch stricter than MediaPipe's own 0.5 defaults) or as set by hand.
 */
export function hdTrackerOptions(hands) {
  const h = hands || {};
  const s = hdClamp(h.strictness == null ? 0.5 : h.strictness);
  const c = h.confidence;
  const lerp = (a, b) => Math.round((a + (b - a) * s) * 100) / 100;
  return {
    numHands: h.maxHands === 1 ? 1 : 2,
    detection: c ? c.detection : lerp(0.3, 0.9),
    presence: c ? c.presence : lerp(0.3, 0.84),
    tracking: c ? c.tracking : lerp(0.3, 0.8),
  };
}

// ── Where the camera sits on the picture ─────────────────────────────────────

/**
 * The camera image's place on the picture: centre (cx, cy, y up), height as a
 * fraction of the picture's, rotation (degrees, clockwise) and mirroring.
 * A Camera layer (the first one) places it where it shows it; with none it
 * covers the picture, so a hand can reach every edge.
 *
 * Tracking a Video layer instead (`sourceId`, docs/tracking.md), the frames
 * are that video's: they sit where the layer shows it (its position, Fit and
 * Scale, rotation and Mirror).
 */
export function hdPlacement(record, value, camAspect, picAspect, mirror, sourceId) {
  if (sourceId) {
    const vl = record && record.layers ? record.layers.find(l => l.id === sourceId && l.kind === 'video') : null;
    if (vl) return { cx: value(vl, 'x'), cy: value(vl, 'y'), h: value(vl, 'scale') * hdVideoFit(vl.fit, camAspect, picAspect), rot: value(vl, 'rotation'), mirror: !!vl.mirror };
  }
  const cam = record && record.layers ? record.layers.find(l => l.kind === 'camera') : null;
  if (cam) return { cx: value(cam, 'x'), cy: value(cam, 'y'), h: value(cam, 'scale'), rot: value(cam, 'rotation'), mirror: !!cam.mirror };
  return { cx: 0.5, cy: 0.5, h: camAspect > 0 && picAspect > 0 ? Math.max(1, picAspect / camAspect) : 1, rot: 0, mirror: mirror !== false };
}

/** A Video layer's height before its Scale (the same as layers.js klVideoFit, kept here so this file stands alone). */
function hdVideoFit(fit, va, pa) {
  if (fit !== 'contain' && fit !== 'cover') return 1;
  if (!(va > 0) || !(pa > 0)) return 1;
  return fit === 'contain' ? Math.min(1, pa / va) : Math.max(1, pa / va);
}

/** A camera-image point (0..1, y down) on the picture: [x, y] with y up. */
export function hdToPicture(u, v, place, camAspect, picAspect) {
  const x = place.mirror ? 1 - u : u;
  const dx = (x - 0.5) * place.h * camAspect, dy = (v - 0.5) * place.h;
  const r = (place.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [place.cx + (dx * c - dy * s) / picAspect, place.cy - (dx * s + dy * c)];
}

// ── Tracks: which detection is which hand ───────────────────────────────────

/** Palm centre (camera image, x in image heights so distances are square), extent, and whether it is believable. */
function hdMeasure(lm, camAspect) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, off = 0;
  for (let i = 0; i < 21; i++) {
    const u = lm[i * 3], v = lm[i * 3 + 1];
    if (u < x0) x0 = u;
    if (u > x1) x1 = u;
    if (v < y0) y0 = v;
    if (v > y1) y1 = v;
    if (u < -0.15 || u > 1.15 || v < -0.15 || v > 1.15) off++;
  }
  // The palm: the wrist and the four knuckles.
  let cu = 0, cv = 0;
  for (const i of [0, 5, 9, 13, 17]) { cu += lm[i * 3] / 5; cv += lm[i * 3 + 1] / 5; }
  const size = Math.max((x1 - x0) * camAspect, y1 - y0);
  const inFrame = cu > -0.08 && cu < 1.08 && cv > -0.08 && cv < 1.08 && off <= 10;
  return { x: cu * camAspect, y: cv, size, ok: inFrame && size >= HD_MIN_SIZE };
}

const hdOther = side => (side === 'left' ? 'right' : 'left');

/**
 * Match this frame's detections to the tracks: nearest palm first, within a
 * gate that grows with the hand's size (the classifier's side breaks a near
 * tie); then, a little further out, a detection the classifier gives the
 * same side as a track (a quick move). Returns [track, detection] pairs.
 */
function hdMatch(tracks, dets) {
  const pairs = [];
  for (const t of tracks) {
    const gate = Math.max(0.15, 0.9 * t.size);
    for (const d of dets) {
      const dist = Math.hypot(t.x - d.x, t.y - d.y);
      if (dist <= gate) pairs.push({ t, d, dist: dist + (d.side === t.side ? 0 : 0.05), pass: 0 });
      else if (dist <= 2.5 * gate && d.side === t.side) pairs.push({ t, d, dist, pass: 1 });
    }
  }
  pairs.sort((a, b) => a.pass - b.pass || a.dist - b.dist);
  const usedT = new Set(), usedD = new Set(), out = [];
  for (const p of pairs) {
    if (usedT.has(p.t) || usedD.has(p.d)) continue;
    usedT.add(p.t); usedD.add(p.d); out.push([p.t, p.d]);
  }
  return out;
}

// ── Updating ─────────────────────────────────────────────────────────────────

/**
 * Take a tracker frame. `o`: { picAspect, place (hdPlacement), smoothing,
 * responsiveness, maxHands (1 or 2), swap (swap left and right),
 * appearFrames }. The frame's time (ms) is its clock.
 */
export function hdUpdate(st, frame, o) {
  const now = frame.t;
  st.live = true; st.seq++; st.aspect = o.picAspect;
  const camAspect = frame.w > 0 && frame.h > 0 ? frame.w / frame.h : 16 / 9;
  const place = o.place || hdPlacement(null, null, camAspect, o.picAspect, true);
  const maxHands = o.maxHands === 1 ? 1 : 2;
  const appear = Math.max(1, o.appearFrames == null ? HD_APPEAR_FRAMES : o.appearFrames | 0);
  const tracks = st.tracks || (st.tracks = []);

  // 1. Believable detections, surest first, no more than maxHands.
  const dets = [];
  let rejected = 0;
  for (const h of frame.hands || []) {
    if (!h.lm || h.lm.length < 63) continue;
    const m = hdMeasure(h.lm, camAspect);
    if (!m.ok) { rejected++; continue; }
    const side = h.side === 'left' ? 'left' : 'right';
    dets.push({ side: o.swap ? hdOther(side) : side, score: h.score || 0, lm: h.lm, x: m.x, y: m.y, size: m.size });
  }
  dets.sort((a, b) => b.score - a.score);
  if (dets.length > maxHands) dets.length = maxHands;
  st.raw = dets.length; st.rejected = rejected;

  // 2. Which detection is which hand.
  const matched = hdMatch(tracks, dets);
  const seenNow = new Set();
  for (const [t, d] of matched) {
    const dt = Math.min(100, Math.max(0, now - t.seen));
    t.x = d.x; t.y = d.y; t.size = d.size; t.seen = now; t.hits++; t.det = d; t.said = d.side; t.score = d.score;
    seenNow.add(t);
    if (!t.confirmed) {
      // A new hand's side: the classifier's votes so far, weighted by how sure it was.
      t.vote += (d.side === 'right' ? 1 : -1) * Math.max(0.05, d.score);
      t.side = t.vote >= 0 ? 'right' : 'left';
    } else if (d.side !== t.side && d.score >= HD_SIDE_SCORE) t.flip += dt;
    else t.flip = Math.max(0, t.flip - 2 * dt);
  }
  // Unmatched: a new hand not yet shown is forgotten at once (a phantom); a shown one is held.
  for (let i = tracks.length - 1; i >= 0; i--) {
    const t = tracks[i];
    if (seenNow.has(t)) continue;
    t.det = null;
    if (!t.confirmed || now - t.seen > HD_HOLD_MS) tracks.splice(i, 1);
  }
  const taken = new Set(matched.map(p => p[1]));
  for (const d of dets) {
    if (taken.has(d)) continue;
    tracks.push({ id: st.nextId++, side: d.side, said: d.side, score: d.score, vote: (d.side === 'right' ? 1 : -1) * Math.max(0.05, d.score), flip: 0, hits: 1, confirmed: false, x: d.x, y: d.y, size: d.size, seen: now, det: d });
  }

  // 3. A new hand seen long enough counts, if there's room (a held hand makes way for it).
  for (const t of tracks) {
    if (t.confirmed || t.hits < appear) continue;
    let shown = tracks.filter(u => u.confirmed);
    if (shown.length >= maxHands) {
      const held = shown.filter(u => !u.det).sort((a, b) => a.seen - b.seen)[0];
      if (!held) continue;
      tracks.splice(tracks.indexOf(held), 1);
      shown = shown.filter(u => u !== held);
    }
    // Two hands can't be the same side: the newcomer takes the other one.
    if (shown.some(u => u.side === t.side)) t.side = hdOther(t.side);
    t.confirmed = true; t.flip = 0;
  }

  // 4. Side hysteresis: the classifier has disagreed, surely, for long enough.
  for (const t of tracks) {
    if (!t.confirmed || t.flip < HD_SIDE_SWITCH_MS) continue;
    const other = tracks.find(u => u !== t && u.confirmed && u.side !== t.side);
    if (!other) { t.side = hdOther(t.side); t.flip = 0; }
    else if (other.flip >= HD_SIDE_SWITCH_MS / 2) {
      // Both hands say they're the other one: swap them.
      const s = t.side; t.side = other.side; other.side = s; t.flip = 0; other.flip = 0;
    }
  }

  // 5. Onto the picture: smoothed landmarks for each hand seen this frame.
  hdSync(st);
  const ep = hdEuroParams(o.smoothing == null ? 0.5 : o.smoothing, o.responsiveness);
  const raw = o.smoothing <= 0.001;
  const zScale = place.h * camAspect;
  for (const side of ['left', 'right']) {
    const hand = st[side];
    const t = hand.present ? tracks.find(u => u.id === hand.track) : null;
    if (!t || !t.det) continue;
    const lm = t.det.lm;
    if (!hand.euro) hand.euro = Array.from({ length: 63 }, () => ({ x: 0, dx: 0, t: -1 }));
    for (let i = 0; i < 21; i++) {
      const p = hdToPicture(lm[i * 3], lm[i * 3 + 1], place, camAspect, o.picAspect);
      const vals = [p[0], p[1], (lm[i * 3 + 2] || 0) * zScale];
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k;
        hand.pts[j] = raw ? vals[k] : hdEuroStep(hand.euro[j], vals[k], now, ep.minCutoff, ep.beta);
      }
    }
    hdDerive(hand, o.picAspect);
  }
  st.t = now;
}

/** Show each confirmed track as its side's hand; a hand whose track is gone drops. */
function hdSync(st) {
  const by = { left: null, right: null };
  for (const t of st.tracks || []) if (t.confirmed && !by[t.side]) by[t.side] = t;
  st.count = 0;
  for (const side of ['left', 'right']) {
    const hand = st[side], t = by[side];
    if (!t) { if (hand.present) hdDrop(hand); hand.track = 0; continue; }
    // A different hand in this slot (a new one, or a side that changed): its filter and gestures start afresh.
    if (hand.track !== t.id) { hdDrop(hand); hand.track = t.id; }
    hand.present = true; hand.ever = true; hand.seen = t.seen; hand.score = t.score;
    st.count++;
  }
}

function hdDrop(hand) {
  hand.present = false; hand.euro = null;
  for (const k in hand.g) hand.g[k] = false;
}

/** Let a held hand go once the hold is over, when frames stop arriving (the tracker paused or stalled). */
export function hdAge(st, now) {
  const tracks = st.tracks || [];
  for (let i = tracks.length - 1; i >= 0; i--) {
    const t = tracks[i];
    if (now - t.seen > (t.confirmed ? HD_HOLD_MS + 250 : 250)) tracks.splice(i, 1);
  }
  hdSync(st);
}

/**
 * What the tracker sees, for the settings' readout: each hand followed (its
 * id, side, what the classifier said last and how sure, shown or still
 * waiting to count, held), and the last frame's detections and rejects.
 */
export function hdTracks(st) {
  return {
    raw: st.raw || 0, rejected: st.rejected || 0,
    tracks: (st.tracks || []).map(t => ({ id: t.id, side: t.side, said: t.said, score: t.score, shown: !!t.confirmed, held: !t.det })),
  };
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
