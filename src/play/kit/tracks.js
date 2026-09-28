/**
 * tracks.js — baked tracking (docs/tracking.md): a tracker's landmarks for a
 * whole video, analysed once, stored compactly and read back by video time.
 * Shared by the app (lib/trackBakes.ts, lib/playEngine.ts) and web exports
 * (inlined with the rest of the kit: every top-level name starts with tk / TK_).
 *
 * A video repeats, so tracking it live would give slightly different
 * landmarks every time it plays (the model runs on whatever frame the
 * browser happens to show). Baking runs the model once over the clip at a
 * fixed step, and playback, scrubbing, takes, offline renders and web pages
 * read the stored frames by the video's own time (interpolating between
 * them): exact and repeatable, no model at run time.
 *
 * The format (little-endian):
 *
 *   0   'TKB1'
 *   4   u8 version (1), u8 kind (0 hands, 1 face, 2 pose), u8 items per frame, u8 channels per point
 *   8   u16 points, u16 meta values per item
 *   12  u32 frames
 *   16  u16 frame width, u16 frame height (the video's, for its shape)
 *   20  f32 duration (s), f32 frames a second analysed
 *   28  u32 reserved
 *   32  f32 × frames: each frame's video time (s)
 *   ..  u8 × frames: items found in each frame (padded to 4 bytes)
 *   ..  i16 × frames × items × (meta + points × channels): values quantised over ±TK_RANGE
 *
 * Items are hands (meta: side +1 right / -1 left, score), a face (meta: head
 * yaw, pitch and roll over π, then the blendshapes in FC_BLEND_NAMES order)
 * or a body (channels: x, y, z and visibility; meta: none). Landmarks are as
 * the model gives them: x, y 0..1 in the frame (y down), z relative.
 */

import { hdEuroParams, hdEuroStep, hdToPicture } from './hands.js';

export const TK_KINDS = ['hands', 'face', 'pose'];
/** Each kind's frame layout: items per frame, landmarks, channels per landmark, meta values per item. */
export const TK_LAYOUT = {
  hands: { items: 2, points: 21, ch: 3, meta: 2 },
  face: { items: 1, points: 478, ch: 3, meta: 55 },
  pose: { items: 1, points: 33, ch: 4, meta: 0 },
};
/** Values are stored as int16 over ±TK_RANGE (a step of 0.00012: a tenth of a pixel in a 480 px frame). */
export const TK_RANGE = 4;
const TK_HEADER = 32;
/** Frames further apart than this many steps are a gap (nothing found in between): no interpolating across it. */
const TK_GAP_STEPS = 1.6;
/** A jump in video time bigger than this (s), or any step back, starts the tracker state afresh (tkDrive). */
export const TK_JUMP_S = 0.35;
/** How much of the video before a jump is replayed into the fresh state (s), so it lands settled. */
export const TK_PRIME_S = 0.6;

const tkClampQ = v => (v < -TK_RANGE ? -TK_RANGE : v > TK_RANGE ? TK_RANGE : v);
const tkQ = v => Math.round(tkClampQ(Number.isFinite(v) ? v : 0) / TK_RANGE * 32767);
const tkDQ = q => q / 32767 * TK_RANGE;

/**
 * Encode an analysis: { kind, w, h, duration, fps, frames: [{ t, items: [{ meta, lm }] }] }
 * (meta and lm as arrays of numbers, lm flattened points × channels). Returns bytes.
 */
export function tkEncode(track) {
  const L = TK_LAYOUT[track.kind];
  if (!L) throw new Error('Unknown tracker kind: ' + track.kind);
  const n = track.frames.length, itemSize = L.meta + L.points * L.ch;
  const countsAt = TK_HEADER + n * 4, dataAt = countsAt + ((n + 3) & ~3);
  const bytes = new Uint8Array(dataAt + n * L.items * itemSize * 2);
  const dv = new DataView(bytes.buffer);
  bytes[0] = 84; bytes[1] = 75; bytes[2] = 66; bytes[3] = 49; // TKB1
  dv.setUint8(4, 1); dv.setUint8(5, TK_KINDS.indexOf(track.kind)); dv.setUint8(6, L.items); dv.setUint8(7, L.ch);
  dv.setUint16(8, L.points, true); dv.setUint16(10, L.meta, true);
  dv.setUint32(12, n, true);
  dv.setUint16(16, Math.max(0, Math.min(65535, Math.round(track.w || 0))), true);
  dv.setUint16(18, Math.max(0, Math.min(65535, Math.round(track.h || 0))), true);
  dv.setFloat32(20, track.duration || 0, true); dv.setFloat32(24, track.fps || 0, true);
  const data = new Int16Array(bytes.buffer, dataAt, n * L.items * itemSize);
  for (let f = 0; f < n; f++) {
    const fr = track.frames[f], items = (fr.items || []).slice(0, L.items);
    dv.setFloat32(TK_HEADER + f * 4, fr.t, true);
    bytes[countsAt + f] = items.length;
    for (let i = 0; i < items.length; i++) {
      const base = (f * L.items + i) * itemSize, it = items[i];
      for (let k = 0; k < L.meta; k++) data[base + k] = tkQ(it.meta ? it.meta[k] : 0);
      const m = L.points * L.ch;
      for (let k = 0; k < m; k++) data[base + L.meta + k] = tkQ(it.lm[k]);
    }
  }
  return bytes;
}

/** Read encoded bytes back (a view on them, nothing copied), or null when they aren't a track. */
export function tkDecode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < TK_HEADER || u8[0] !== 84 || u8[1] !== 75 || u8[2] !== 66 || u8[3] !== 49) return null;
  // The Int16 view needs an even offset: copy when the bytes sit at an odd one.
  const b = u8.byteOffset % 4 ? u8.slice() : u8;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const kind = TK_KINDS[dv.getUint8(5)];
  if (!kind) return null;
  const items = dv.getUint8(6), ch = dv.getUint8(7), points = dv.getUint16(8, true), meta = dv.getUint16(10, true);
  const frames = dv.getUint32(12, true), itemSize = meta + points * ch;
  const countsAt = TK_HEADER + frames * 4, dataAt = countsAt + ((frames + 3) & ~3);
  if (b.byteLength < dataAt + frames * items * itemSize * 2) return null;
  return {
    kind, items, ch, points, meta, itemSize, frames,
    w: dv.getUint16(16, true), h: dv.getUint16(18, true),
    duration: dv.getFloat32(20, true), fps: dv.getFloat32(24, true),
    times: new Float32Array(b.buffer, b.byteOffset + TK_HEADER, frames),
    counts: new Uint8Array(b.buffer, b.byteOffset + countsAt, frames),
    data: new Int16Array(b.buffer, b.byteOffset + dataAt, frames * items * itemSize),
    bytes: b.byteLength,
  };
}

/**
 * The frames either side of video time `t` (s): { i, j, a } with frame i at or
 * before t, j the next one (or i again at the ends and across a gap), and `a`
 * how far t is from i to j (0..1). -1 for i when there are no frames.
 */
export function tkFrameAt(track, t) {
  const n = track.frames, ts = track.times;
  if (!n) return { i: -1, j: -1, a: 0 };
  if (t <= ts[0]) return { i: 0, j: 0, a: 0 };
  if (t >= ts[n - 1]) return { i: n - 1, j: n - 1, a: 0 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) lo = mid; else hi = mid; }
  const span = ts[hi] - ts[lo], step = track.fps > 0 ? 1 / track.fps : span;
  if (!(span > 0)) return { i: lo, j: lo, a: 0 };
  const a = (t - ts[lo]) / span;
  // A gap (frames skipped): hold the nearer frame.
  if (span > step * TK_GAP_STEPS) return a < 0.5 ? { i: lo, j: lo, a: 0 } : { i: hi, j: hi, a: 0 };
  return { i: lo, j: hi, a };
}

/** One item of frame f, dequantised: { meta, lm } (Float32Arrays). */
export function tkItem(track, f, item) {
  const base = (f * track.items + item) * track.itemSize, d = track.data;
  const meta = new Float32Array(track.meta), lm = new Float32Array(track.points * track.ch);
  for (let k = 0; k < meta.length; k++) meta[k] = tkDQ(d[base + k]);
  for (let k = 0; k < lm.length; k++) lm[k] = tkDQ(d[base + track.meta + k]);
  return { meta, lm };
}

/** Where item `it` of a frame is: its first landmark (the wrist, the nose). */
function tkAnchor(track, f, it) {
  const base = (f * track.items + it) * track.itemSize + track.meta;
  return [tkDQ(track.data[base]), tkDQ(track.data[base + 1])];
}

/**
 * The tracker frame at video time `t` (s): { t (ms), w, h, items: [{ meta, lm }] },
 * each item interpolated between the frames either side when both have it
 * (items are matched by where their first landmark is), else the nearer frame's.
 */
export function tkSample(track, t) {
  const out = { t: t * 1000, w: track.w, h: track.h, items: [] };
  const { i, j, a } = tkFrameAt(track, t);
  if (i < 0) return out;
  const ci = track.counts[i], cj = track.counts[j];
  if (i === j || a <= 0 || ci !== cj) {
    const f = i === j || a < 0.5 ? i : j;
    for (let k = 0; k < track.counts[f]; k++) out.items.push(tkItem(track, f, k));
    return out;
  }
  // Match j's items to i's: nearest first landmark (two hands can swap order between frames).
  const order = [];
  if (ci === 2) {
    const p0 = tkAnchor(track, i, 0), q0 = tkAnchor(track, j, 0), q1 = tkAnchor(track, j, 1);
    const straight = Math.hypot(p0[0] - q0[0], p0[1] - q0[1]), crossed = Math.hypot(p0[0] - q1[0], p0[1] - q1[1]);
    order.push(straight <= crossed ? 0 : 1, straight <= crossed ? 1 : 0);
  } else for (let k = 0; k < ci; k++) order.push(k);
  for (let k = 0; k < ci; k++) {
    const A = tkItem(track, i, k), B = tkItem(track, j, order[k]);
    // Hands keep the nearer frame's side (a side is a vote, not a number to blend).
    const nearMeta = a < 0.5 ? A.meta : B.meta;
    for (let m = 0; m < A.meta.length; m++) A.meta[m] = track.kind === 'hands' && m === 0 ? nearMeta[m] : A.meta[m] + (B.meta[m] - A.meta[m]) * a;
    for (let m = 0; m < A.lm.length; m++) A.lm[m] += (B.lm[m] - A.lm[m]) * a;
    out.items.push(A);
  }
  return out;
}

/** A hands sample as the hand tracker's frame (play/kit/hands.js hdUpdate). */
export function tkHandsFrame(s) {
  return { t: s.t, w: s.w, h: s.h, hands: s.items.map(it => ({ side: it.meta[0] >= 0 ? 'right' : 'left', score: it.meta[1], lm: it.lm })) };
}

/** A driver: where a baked track was last read. */
export function tkDriver() { return { last: 0, has: false }; }

/**
 * Feed a tracker the baked frames up to video time `vt` (s). Playing on, it
 * gets the frame at `vt`; after a jump (a seek, a loop, scrubbing back) the
 * state starts afresh (`reset()`) and the TK_PRIME_S before `vt` is replayed
 * at the analysis rate, so where it lands depends on the time only, not on
 * how it got there. The same time twice feeds nothing. Returns true when it fed a frame.
 */
export function tkDrive(drv, track, vt, reset, update) {
  if (drv.has && Math.abs(vt - drv.last) < 1e-6) return false;
  const jump = !drv.has || vt < drv.last - 1e-4 || vt - drv.last > TK_JUMP_S;
  if (jump) {
    reset();
    const step = 1 / Math.max(1, track.fps || 30);
    const from = vt - TK_PRIME_S;
    // Near the start there is less video before: the first frame stands in for it (so a hand there still appears).
    for (let k = 0; from + k * step < vt - 1e-6; k++) {
      const t = from + k * step, s = tkSample(track, Math.max(0, t));
      s.t = t * 1000;
      update(s);
    }
  }
  update(tkSample(track, vt));
  drv.last = vt; drv.has = true;
  return true;
}

/**
 * Where a Video layer is (s) at clock time `clock`: following the clock,
 * start + clock × speed (looped or held before the end, types/playLayers.ts
 * videoLayerTimeAt); running free, where its element is (`elTime`).
 */
export function tkVideoTime(layer, clock, duration, elTime) {
  if (layer.follow === false && typeof elTime === 'number' && Number.isFinite(elTime)) return elTime;
  const start = Math.max(0, layer.start || 0);
  if (!(duration > 0) || !Number.isFinite(duration)) return start;
  const t = start + Math.max(0, layer.playing === false ? 0 : clock) * (layer.speed > 0 ? layer.speed : 1);
  return layer.loop ? t % duration : Math.min(t, Math.max(0, duration - 0.001));
}

// ── Base64 (web exports carry tracks as text) ────────────────────────────────

export function tkToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function tkFromBase64(text) {
  const s = atob(text), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ── One tracked subject (a face, a body): placed, smoothed, held ─────────────

/** How long a face or body that dropped out is still "there" (ms), and frames running a new one needs. */
export const TK_HOLD_MS = 250;
export const TK_APPEAR_FRAMES = 2;

/** A face's or body's state: `n` landmarks on the picture, `meta` values (smoothed), in view or not. */
export function tkSubjectCreate(n, metaN) {
  return {
    live: false, present: false, ever: false, seen: -1e12, hits: 0, t: -1, seq: 0, aspect: 16 / 9,
    n, pts: new Float64Array(n * 3), vis: new Float32Array(n), meta: new Float64Array(metaN || 0),
    /** Picture heights per unit of the model's z (for readings that need depth). */
    zScale: 1, mirror: false,
    euro: null, g: {},
  };
}

/**
 * Take a frame ({ t, w, h, items: [{ meta, lm }] }, the first item is the
 * subject). `o`: { picAspect, place (hands.js hdPlacement), smoothing,
 * responsiveness, ch (channels per landmark: 4 carries visibility) }.
 * Returns true while the subject is in view.
 */
export function tkSubjectUpdate(st, frame, o) {
  const now = frame.t;
  st.live = true; st.seq++; st.aspect = o.picAspect; st.t = now;
  const it = frame.items && frame.items[0];
  if (!it) {
    st.hits = 0;
    if (st.present && now - st.seen > TK_HOLD_MS) tkSubjectDrop(st);
    return st.present;
  }
  st.hits++;
  if (!st.present && st.hits < (o.appearFrames || TK_APPEAR_FRAMES)) return false;
  if (!st.present) { st.euro = null; st.g = {}; }
  st.present = true; st.ever = true; st.seen = now;
  const camAspect = frame.w > 0 && frame.h > 0 ? frame.w / frame.h : 16 / 9;
  const place = o.place || { cx: 0.5, cy: 0.5, h: Math.max(1, o.picAspect / camAspect), rot: 0, mirror: true };
  st.mirror = !!place.mirror;
  st.zScale = place.h * camAspect;
  const ch = o.ch || 3, n = st.n;
  const s = o.smoothing == null ? 0.5 : o.smoothing;
  const ep = hdEuroParams(s, o.responsiveness);
  const raw = s <= 0.001;
  if (!st.euro) st.euro = { p: Array.from({ length: n * 3 }, () => ({ x: 0, dx: 0, t: -1 })), m: Array.from({ length: st.meta.length }, () => ({ x: 0, dx: 0, t: -1 })) };
  const lm = it.lm;
  for (let i = 0; i < n; i++) {
    const p = hdToPicture(lm[i * ch], lm[i * ch + 1], place, camAspect, o.picAspect);
    const vals = [p[0], p[1], (lm[i * ch + 2] || 0) * st.zScale];
    for (let k = 0; k < 3; k++) {
      const j = i * 3 + k;
      st.pts[j] = raw ? vals[k] : hdEuroStep(st.euro.p[j], vals[k], now, ep.minCutoff, ep.beta);
    }
    st.vis[i] = ch >= 4 ? lm[i * ch + 3] : 1;
  }
  // Meta values (blendshapes, head angles) are 0..1-ish: smoothed more lightly, so a blink still reads as one.
  const mp = hdEuroParams(s * 0.6, 0.8);
  for (let k = 0; k < st.meta.length; k++) {
    const v = it.meta ? it.meta[k] || 0 : 0;
    st.meta[k] = raw ? v : hdEuroStep(st.euro.m[k], v, now, mp.minCutoff, mp.beta);
  }
  return true;
}

/** Let a held subject go once the hold is over, when frames stop arriving. */
export function tkSubjectAge(st, now) {
  if (st.present && now - st.seen > TK_HOLD_MS + 250) tkSubjectDrop(st);
}

function tkSubjectDrop(st) {
  st.present = false; st.euro = null; st.hits = 0;
  for (const k in st.g) st.g[k] = false;
}

/** A landmark on the picture ({ x, y }, y up), or null while the subject is out of view. */
export function tkSubjectPoint(st, i) {
  if (!st || !st.present) return null;
  const k = Math.max(0, Math.min(st.n - 1, i | 0));
  return { x: st.pts[k * 3], y: st.pts[k * 3 + 1] };
}

/** Hysteresis: on past `on`, off again only below `off`. */
export function tkHyst(was, v, on, off) { return was ? v >= off : v >= on; }
