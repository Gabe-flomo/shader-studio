/**
 * clipPlay.js — a video's clip settings as playback (docs/clip-editor.md), in
 * one place for the app (lib/media/clip.ts re-exports it; the Video Input
 * node, Video layers, Baked nodes and the Background follow it) and web
 * exports (play/exportHtml.ts inlines it into the kit's closure; the runtime
 * reads it as SSKit.clip).
 *
 * A saved clip (`clip` on a node's params or a layer) is
 *
 *   { segments: [{ in, out, reverse? }], crop: { x, y, w, h }, rotate, flipX, flipY, speed?, loop? }
 *
 * seconds into the video; an out at or before its in runs to the end. The
 * segments play one after another as a playlist (a reversed one backwards),
 * at `speed`, round and round when `loop`. With no clip a host plays as it
 * always did: nothing here runs.
 *
 * Clock time t (seconds since the clip started) shows source time
 * cpAt(segments, t, speed, loop).time. A host keeps its <video> on that with
 * cpFollow: forward stretches play at the speed (a seek only on a jump or a
 * drift), reversed ones are paused and seeked frame by frame (browsers play
 * forwards only).
 */

export const CP_MAX_SEGMENTS = 16;
/** Shorter than this, a segment is dropped. */
export const CP_MIN_SEGMENT = 1e-4;
export const CP_MIN_CROP = 0.05;

const cpNum = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const cpClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A crop, cleaned: inside the frame, no side under CP_MIN_CROP. */
export function cpCleanCrop(c) {
  const o = c && typeof c === 'object' ? c : {};
  const w = cpClamp(cpNum(o.w, 1), CP_MIN_CROP, 1), h = cpClamp(cpNum(o.h, 1), CP_MIN_CROP, 1);
  return { x: cpClamp(cpNum(o.x, 0), 0, 1 - w), y: cpClamp(cpNum(o.y, 0), 0, 1 - h), w, h };
}

/** Crop, rotate and flip from anything (a saved clip, hand-edited). */
export function cpCleanTransform(v) {
  const o = v && typeof v === 'object' ? v : {};
  const r = Math.round(cpNum(o.rotate, 0) / 90) * 90;
  return { crop: cpCleanCrop(o.crop), rotate: ((r % 360) + 360) % 360, flipX: o.flipX === true, flipY: o.flipY === true };
}

export function cpIsIdentity(xf) {
  return !xf || (xf.rotate === 0 && !xf.flipX && !xf.flipY && xf.crop.x === 0 && xf.crop.y === 0 && xf.crop.w === 1 && xf.crop.h === 1);
}

/** Raw segments as a clean list (at most CP_MAX_SEGMENTS); none: the whole video. */
export function cpCleanSegments(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const seg = { in: Math.max(0, cpNum(s.in, 0)), out: cpNum(s.out, 0) };
    if (s.reverse === true) seg.reverse = true;
    out.push(seg);
    if (out.length >= CP_MAX_SEGMENTS) break;
  }
  return out.length ? out : [{ in: 0, out: 0 }];
}

/**
 * A saved clip from anything, or null when there is none (an old graph, a
 * layer that never had one). Speed and loop are kept only when present.
 */
export function cpParse(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const xf = cpCleanTransform(raw);
  const out = { segments: cpCleanSegments(raw.segments), crop: xf.crop, rotate: xf.rotate, flipX: xf.flipX, flipY: xf.flipY };
  if (typeof raw.speed === 'number' && isFinite(raw.speed) && raw.speed > 0) out.speed = cpClamp(raw.speed, 0.05, 8);
  if (typeof raw.loop === 'boolean') out.loop = raw.loop;
  return out;
}

/** Does a saved clip change anything: more than the whole video once, forwards, uncropped, at its own speed? */
export function cpIsPlain(c) {
  if (!c) return true;
  const s = c.segments || [];
  const whole = s.length === 1 && s[0].in <= 1e-3 && !(s[0].out > s[0].in) && !s[0].reverse;
  return whole && cpIsIdentity(cpCleanTransform(c)) && (c.speed === undefined || c.speed === 1) && c.loop === undefined;
}

/**
 * Segments placed in a video `duration` seconds long: an out at or before its in runs to the end,
 * everything is clamped into the video, empty stretches are dropped (none left: the whole video).
 * With the length unknown (0), an out at or before its in leaves the segment empty.
 */
export function cpResolve(segs, duration) {
  const d = Math.max(0, cpNum(duration, 0));
  const out = [];
  for (const s of segs || []) {
    const a = d > 0 ? cpClamp(s.in, 0, Math.max(0, d - 1e-3)) : Math.max(0, s.in);
    let b = s.out > a ? s.out : d;
    if (d > 0) b = Math.min(b, d);
    if (b - a >= CP_MIN_SEGMENT) out.push({ in: a, out: b, reverse: !!s.reverse });
  }
  return out.length || d <= 0 ? out : [{ in: 0, out: d, reverse: false }];
}

/** Seconds of video the segments keep, together. */
export function cpSpan(segs) {
  let n = 0;
  for (const s of segs) n += s.out - s.in;
  return n;
}

/** How long the clip plays once (seconds of clock): what it keeps over its speed. */
export const cpLength = (segs, speed) => cpSpan(segs) / (speed > 0 ? speed : 1);

/**
 * Where the playlist is at clock time `t`: the source time, which segment (k) and
 * whether it plays backwards. Looping, it wraps; otherwise it holds the last frame
 * (`done`). A reversed segment runs from its out down to its in.
 */
export function cpAt(segs, t, speed, loop) {
  if (!segs || !segs.length) return { time: 0, k: -1, reverse: false, done: false };
  const span = cpSpan(segs);
  let u = Math.max(0, cpNum(t, 0)) * (speed > 0 ? speed : 1), done = false;
  if (span <= 0) u = 0;
  else if (loop) u = u % span;
  else if (u >= span) { u = span; done = true; }
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k], len = s.out - s.in;
    if (u < len || k === segs.length - 1) {
      const local = Math.min(Math.max(0, u), len);
      // Held just inside the segment, so the frame shown is one of its own.
      const time = s.reverse ? Math.min(Math.max(s.in, s.out - local), s.out - 1e-3) : Math.max(s.in, Math.min(s.in + local, s.out - 1e-3));
      return { time, k, reverse: !!s.reverse, done };
    }
    u -= len;
  }
  return { time: segs[0].in, k: 0, reverse: !!segs[0].reverse, done };
}

/**
 * The frames a playback host shows from clock 0 at `fps`, once through (looping or not):
 * the source time of each. What the editor's Result preview steps through.
 */
export function cpFrames(segs, speed, loop, fps) {
  const f = fps > 0 ? fps : 30;
  const n = Math.max(1, Math.ceil(cpLength(segs, speed) * f - 1e-6));
  const out = [];
  for (let i = 0; i < n && i < 100000; i++) out.push(cpAt(segs, i / f, speed, loop).time);
  return out;
}

/**
 * Keep a <video> on the playlist: `at` is cpAt's answer for now, `run` whether the
 * clock is running. Forwards it plays at `rate` and is seeked only when it left the
 * segment or drifted; backwards (or stopped) it is paused and seeked to the frame.
 */
export function cpFollow(el, at, seg, rate, run) {
  if (!el || el.readyState < 1 || !seg) return;
  const r = rate > 0 ? rate : 1, t = at.time, cur = el.currentTime;
  if (run && !at.reverse && !at.done) {
    if (Math.abs(el.playbackRate - r) > 1e-3) el.playbackRate = r;
    if (el.paused) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
    const outside = cur < seg.in - 0.05 || cur > seg.out + 0.02;
    if ((outside || Math.abs(cur - t) > 0.3) && !el.seeking) el.currentTime = t;
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(cur - t) > 0.02 && !el.seeking) el.currentTime = t;
  }
}

/** A saved clip resolved for a video `duration` long, with a host's speed and loop when the clip has none. */
export function cpPlaylist(c, duration, speed, loop) {
  return {
    segs: cpResolve(c.segments, duration),
    speed: c.speed !== undefined ? c.speed : speed > 0 ? speed : 1,
    loop: c.loop !== undefined ? c.loop : loop !== false,
  };
}

// ── Crop, rotate, flip ───────────────────────────────────────────────────────

/** Output (u, v) (0–1, top-left origin) to the source frame (0–1): the inverse of the clip's draw. */
export function cpOutputToSource(xf, u, v) {
  const x = xf.flipX ? 1 - u : u, y = xf.flipY ? 1 - v : v;
  let a, b;
  switch (xf.rotate) {
    case 90: a = y; b = 1 - x; break;
    case 180: a = 1 - x; b = 1 - y; break;
    case 270: a = 1 - y; b = x; break;
    default: a = x; b = y;
  }
  return [xf.crop.x + a * xf.crop.w, xf.crop.y + b * xf.crop.h];
}

/**
 * The same map as an affine for a shader that reads a video texture with its rows flipped
 * (three.js VideoTexture, the web page's upload: st.y = 1 at the top): st' = (c0 + c1 st.x + c2 st.y,
 * c3 + c4 st.x + c5 st.y).
 */
export function cpTextureAffine(xf) {
  const f = (s, t) => { const p = cpOutputToSource(xf, s, 1 - t); return [p[0], 1 - p[1]]; };
  const o = f(0, 0), sx = f(1, 0), sy = f(0, 1);
  return [o[0], sx[0] - o[0], sy[0] - o[0], o[1], sx[1] - o[1], sy[1] - o[1]];
}

function cpForward(xf) {
  let p, q;
  switch (xf.rotate) {
    case 90: p = [1, 0, -1]; q = [0, 1, 0]; break;
    case 180: p = [1, -1, 0]; q = [1, 0, -1]; break;
    case 270: p = [0, 0, 1]; q = [1, -1, 0]; break;
    default: p = [0, 1, 0]; q = [0, 0, 1];
  }
  if (xf.flipX) p = [1 - p[0], -p[1], -p[2]];
  if (xf.flipY) q = [1 - q[0], -q[1], -q[2]];
  return { p, q };
}

/** Source (x, y) (0–1) to the output (0–1): the inverse of cpOutputToSource. */
export function cpSourceToOutput(xf, x, y) {
  const a = (x - xf.crop.x) / xf.crop.w, b = (y - xf.crop.y) / xf.crop.h;
  const { p, q } = cpForward(xf);
  return [p[0] + p[1] * a + p[2] * b, q[0] + q[1] * a + q[2] * b];
}

/** The size of a w × h frame after the crop and rotation. */
export function cpOutputSize(w, h, xf) {
  const cw = w * xf.crop.w, ch = h * xf.crop.h;
  return xf.rotate === 90 || xf.rotate === 270 ? [ch, cw] : [cw, ch];
}

/** How to draw a frame (sw × sh) cropped, rotated and flipped into the box (x, y, w, h). */
export function cpDrawParams(xf, sw, sh, x, y, w, h) {
  const rot = xf.rotate === 90 || xf.rotate === 270;
  const dw = rot ? h : w, dh = rot ? w : h;
  const { p, q } = cpForward(xf);
  return {
    src: [xf.crop.x * sw, xf.crop.y * sh, xf.crop.w * sw, xf.crop.h * sh],
    dw, dh,
    matrix: [(w * p[1]) / dw, (h * q[1]) / dw, (w * p[2]) / dh, (h * q[2]) / dh, x + w * p[0], y + h * q[0]],
  };
}

/** Draw `src` (sw × sh) into the box with the crop, rotation and flips. */
export function cpDrawFrame(g, src, sw, sh, xf, x, y, w, h) {
  if (cpIsIdentity(xf)) { g.drawImage(src, x, y, w, h); return; }
  const d = cpDrawParams(xf, sw, sh, x, y, w, h);
  g.save();
  g.transform(d.matrix[0], d.matrix[1], d.matrix[2], d.matrix[3], d.matrix[4], d.matrix[5]);
  g.drawImage(src, d.src[0], d.src[1], d.src[2], d.src[3], 0, 0, d.dw, d.dh);
  g.restore();
}

/**
 * A video's frame through a clip's crop / rotate / flip, on a canvas of its own (`cache`
 * holds it between frames): the element itself when the clip changes nothing. Redrawn
 * only when the video moved on.
 */
export function cpFrameOf(el, xf, cache) {
  if (!el || cpIsIdentity(xf)) return el;
  const vw = el.videoWidth, vh = el.videoHeight;
  if (!vw || !vh) return null;
  const size = cpOutputSize(vw, vh, xf), W = Math.max(1, Math.round(size[0])), H = Math.max(1, Math.round(size[1]));
  if (!cache.c) cache.c = document.createElement('canvas');
  const c = cache.c, key = el.currentTime + '|' + W + 'x' + H + '|' + xf.rotate + (xf.flipX ? 'h' : '') + (xf.flipY ? 'v' : '') + xf.crop.x + ',' + xf.crop.y;
  if (cache.key === key && !el.seeking) return c;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  if (!g) return el;
  g.clearRect(0, 0, W, H);
  cpDrawFrame(g, el, vw, vh, xf, 0, 0, W, H);
  cache.key = key;
  return c;
}
