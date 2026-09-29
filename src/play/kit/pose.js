/**
 * pose.js — body tracking once the landmarks are in (docs/tracking.md): the
 * pure part, shared by the app and web exports (top-level names start with
 * ps / PS_).
 *
 * MediaPipe's Pose Landmarker gives 33 body landmarks with how visible each
 * is. A tracker frame carries one body:
 *
 *   { t, w, h, items: [{ meta: [], lm: [x, y, z, visibility] × 33 }] }
 *
 * Left and right are the performer's own (MediaPipe's left_wrist is the
 * person's left wrist; camera frames reach it unmirrored). The body is placed
 * on the picture like a hand, smoothed, held a moment when it drops out, and
 * read as values and gestures with hysteresis.
 */
import { tkHyst, tkSubjectCreate, tkSubjectPoint, tkSubjectUpdate } from './tracks.js';

/** The 33 landmarks, in MediaPipe's order. */
export const PS_POINT_NAMES = [
  'Nose', 'Left eye (inner)', 'Left eye', 'Left eye (outer)', 'Right eye (inner)', 'Right eye', 'Right eye (outer)', 'Left ear', 'Right ear',
  'Mouth (left)', 'Mouth (right)', 'Left shoulder', 'Right shoulder', 'Left elbow', 'Right elbow', 'Left wrist', 'Right wrist',
  'Left pinky', 'Right pinky', 'Left index', 'Right index', 'Left thumb', 'Right thumb', 'Left hip', 'Right hip',
  'Left knee', 'Right knee', 'Left ankle', 'Right ankle', 'Left heel', 'Right heel', 'Left foot', 'Right foot',
];
export const PS_POINTS = 33;
/** The skeleton's bones, as landmark pairs. */
export const PS_BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
  [15, 17], [15, 19], [15, 21], [17, 19], [16, 18], [16, 20], [16, 22], [18, 20],
  [0, 2], [2, 7], [0, 5], [5, 8], [9, 10],
];
export const PS_GESTURES = ['handsUp', 'leftHandUp', 'rightHandUp', 'armsOut', 'appear', 'leave'];
/** Below this visibility a landmark doesn't count for a gesture. */
const PS_SEEN = 0.5;

const psClamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);

export function psCreate() { return tkSubjectCreate(PS_POINTS, 0); }

/** Take a tracker frame. `o` as tkSubjectUpdate: { picAspect, place, smoothing, responsiveness }. */
export function psUpdate(st, frame, o) {
  if (!tkSubjectUpdate(st, frame, Object.assign({}, o, { ch: 4 }))) return;
  const g = st.g, p = st.pts, v = st.vis;
  const Y = i => p[i * 3 + 1];
  const shoulder = Math.max(0.02, psShoulderWidth(st));
  // A hand is up once its wrist is above the nose (a little above, to start; back at the nose to stop).
  const up = (w, was) => v[w] >= PS_SEEN && v[0] >= PS_SEEN && tkHyst(was, (Y(w) - Y(0)) / shoulder, 0.25, 0);
  g.leftHandUp = up(15, g.leftHandUp);
  g.rightHandUp = up(16, g.rightHandUp);
  g.handsUp = g.leftHandUp && g.rightHandUp;
  // Arms out: both wrists well out past the shoulders, at about shoulder height.
  const A = st.aspect, X = i => p[i * 3] * A;
  const outBy = (w, s) => Math.abs(X(w) - X(s)) / shoulder - Math.abs(Y(w) - Y(s)) / shoulder;
  const out = Math.min(outBy(15, 11), outBy(16, 12));
  g.armsOut = v[15] >= PS_SEEN && v[16] >= PS_SEEN && tkHyst(g.armsOut, out, 1.1, 0.8);
}

/** Shoulder to shoulder on the picture (picture heights). */
function psShoulderWidth(st) {
  const p = st.pts, A = st.aspect;
  return Math.hypot((p[33] - p[36]) * A, p[34] - p[37]);
}

/**
 * A pose source's reading, 0..1, or null while there is nothing to read:
 *   point       a landmark's x, y (0..1 over the picture, y up) or z (0.5 level with the hips, 1 nearer)
 *   visibility  how sure the model is that the landmark is in view
 *   lean        the shoulders' tilt: 0.5 level, more with the picture's right shoulder lower
 *   spread      wrist to wrist, 1 = a picture width
 *   size        how big the body looks (shoulder width): 0 far, 1 close
 *   present     1 while a body is in view       gesture  1 while `gesture` is held
 */
export function psRead(st, read, point, axis, gesture) {
  if (!st || !st.live) return null;
  if (read === 'present') return st.present ? 1 : 0;
  if (read === 'gesture') return psGate(st, gesture) ? 1 : 0;
  if (!st.present) return null;
  const p = st.pts, A = st.aspect;
  switch (read) {
    case 'point': {
      const i = Math.max(0, Math.min(PS_POINTS - 1, point | 0));
      if (axis === 'z') return psClamp(0.5 - p[i * 3 + 2] / Math.max(0.05, 2 * psShoulderWidth(st)));
      return psClamp(p[i * 3 + (axis === 'y' ? 1 : 0)]);
    }
    case 'visibility': return psClamp(st.vis[Math.max(0, Math.min(PS_POINTS - 1, point | 0))]);
    case 'lean': {
      // Screen left and right shoulders, whichever way the picture is mirrored.
      const a = p[33] <= p[36] ? 11 : 12, b = a === 11 ? 12 : 11;
      return psClamp(0.5 + Math.atan2(p[a * 3 + 1] - p[b * 3 + 1], Math.max(1e-4, (p[b * 3] - p[a * 3]) * A)) / Math.PI);
    }
    case 'spread': return psClamp(Math.hypot((p[45] - p[48]) * A, p[46] - p[49]) / A);
    case 'size': return psClamp((psShoulderWidth(st) - 0.05) / 0.45);
    default: return null;
  }
}

/** Is a pose gesture held? 'appear': a body in view; 'leave': gone after one was seen. */
export function psGate(st, gesture) {
  if (!st) return false;
  if (gesture === 'appear') return st.present;
  if (gesture === 'leave') return st.ever && !st.present;
  return st.present && !!st.g[gesture];
}

/** A landmark on the picture, or null while no body is in view. */
export function psPoint(st, i) { return tkSubjectPoint(st, i); }

/** The body's skeleton on the picture (a setup aid); faint where the model isn't sure. */
export function psDraw(ctx, st, W, H, dpr, rgb) {
  if (!st || !st.live || !st.present) return;
  const c = rgb || [0.45, 0.7, 1];
  const css = a => 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a + ')';
  const px = i => st.pts[i * 3] * W, py = i => (1 - st.pts[i * 3 + 1]) * H;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round'; ctx.lineWidth = 3 * dpr;
  for (const [a, b] of PS_BONES) {
    const vis = Math.min(st.vis[a], st.vis[b]);
    ctx.strokeStyle = css(vis >= PS_SEEN ? 0.85 : 0.25);
    ctx.beginPath(); ctx.moveTo(px(a), py(a)); ctx.lineTo(px(b), py(b)); ctx.stroke();
  }
  for (let i = 0; i < PS_POINTS; i++) {
    ctx.fillStyle = st.vis[i] >= PS_SEEN ? (i === 15 || i === 16 || i === 0 ? '#ffffff' : css(1)) : css(0.3);
    ctx.beginPath(); ctx.arc(px(i), py(i), (i === 15 || i === 16 || i === 0 ? 4.5 : 3) * dpr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
