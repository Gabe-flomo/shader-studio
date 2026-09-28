/**
 * face.js — face tracking once the landmarks are in (docs/tracking.md): the
 * pure part, shared by the app and web exports (top-level names start with
 * fc / FC_).
 *
 * MediaPipe's Face Landmarker gives 478 landmarks (468 on the face, then 5 per
 * iris), 52 blendshapes (how open the jaw is, how much each eye blinks, a
 * smile…) and the head's pose as a matrix. A tracker frame carries one face:
 *
 *   { t, w, h, items: [{ meta: [yaw, pitch, roll, ...blendshapes], lm: [x, y, z] × 478 }] }
 *
 * yaw, pitch and roll are the head's angles over π (from the matrix, see
 * fcHeadAngles); the blendshapes are in FC_BLEND_NAMES order. The face is
 * placed on the picture like a hand (a Camera layer, a Video layer being
 * tracked, or covering the picture), smoothed, held a moment when it drops
 * out, and read as values and gestures with hysteresis.
 */
import { tkHyst, tkSubjectCreate, tkSubjectPoint, tkSubjectUpdate } from './tracks.js';

/** MediaPipe's blendshapes, in its order (categoryName). */
export const FC_BLEND_NAMES = [
  '_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft',
  'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower',
  'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight',
];
/** Meta values before the blendshapes: yaw, pitch, roll. */
export const FC_ANGLES = 3;
export const FC_POINTS = 478;

/**
 * Landmarks with names, for the pickers (MediaPipe's face mesh numbering).
 * "Your left" is the performer's own left, as MediaPipe names it for an
 * unmirrored camera frame.
 */
export const FC_NAMED_POINTS = [
  [1, 'Nose tip'], [168, 'Between the eyes'], [10, 'Forehead'], [152, 'Chin'],
  [13, 'Upper lip'], [14, 'Lower lip'], [61, 'Mouth corner (your right)'], [291, 'Mouth corner (your left)'],
  [468, 'Right iris (yours)'], [473, 'Left iris (yours)'],
  [33, 'Right eye, outer corner'], [133, 'Right eye, inner corner'], [263, 'Left eye, outer corner'], [362, 'Left eye, inner corner'],
  [159, 'Right upper eyelid'], [145, 'Right lower eyelid'], [386, 'Left upper eyelid'], [374, 'Left lower eyelid'],
  [105, 'Right eyebrow'], [334, 'Left eyebrow'], [234, 'Right cheek edge'], [454, 'Left cheek edge'],
];
/** The outline, lips, eyes and brows as closed or open landmark paths (for drawing the face on the picture). */
export const FC_OUTLINES = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61],
  [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78],
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
  [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263],
  [70, 63, 105, 66, 107], [300, 293, 334, 296, 336],
];
export const FC_GESTURES = ['mouthOpen', 'smile', 'blink', 'blinkLeft', 'blinkRight', 'browsUp', 'appear', 'leave'];

const fcClamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const FC_B = name => FC_ANGLES + FC_BLEND_NAMES.indexOf(name);

export function fcCreate() { return tkSubjectCreate(FC_POINTS, FC_ANGLES + FC_BLEND_NAMES.length); }

/**
 * The head's yaw, pitch and roll over π from MediaPipe's facial transformation
 * matrix (4 × 4, column-major): 0 facing the camera.
 */
export function fcHeadAngles(m) {
  if (!m || m.length < 16) return [0, 0, 0];
  const r = (row, col) => m[col * 4 + row];
  const pitch = Math.atan2(r(2, 1), r(2, 2));
  const yaw = Math.atan2(-r(2, 0), Math.hypot(r(2, 1), r(2, 2)));
  const roll = Math.atan2(r(1, 0), r(0, 0));
  return [yaw / Math.PI, pitch / Math.PI, roll / Math.PI];
}

/** Take a tracker frame. `o` as tkSubjectUpdate: { picAspect, place, smoothing, responsiveness }. */
export function fcUpdate(st, frame, o) {
  if (!tkSubjectUpdate(st, frame, Object.assign({}, o, { ch: 3 }))) return;
  const g = st.g;
  g.mouthOpen = tkHyst(g.mouthOpen, fcBlend(st, 'jawOpen'), 0.35, 0.2);
  const smile = (fcBlend(st, 'mouthSmileLeft') + fcBlend(st, 'mouthSmileRight')) / 2;
  g.smile = tkHyst(g.smile, smile, 0.5, 0.3);
  g.blinkLeft = tkHyst(g.blinkLeft, fcBlend(st, 'eyeBlinkLeft'), 0.55, 0.35);
  g.blinkRight = tkHyst(g.blinkRight, fcBlend(st, 'eyeBlinkRight'), 0.55, 0.35);
  g.blink = tkHyst(g.blink, Math.min(fcBlend(st, 'eyeBlinkLeft'), fcBlend(st, 'eyeBlinkRight')), 0.55, 0.35);
  g.browsUp = tkHyst(g.browsUp, fcBlend(st, 'browInnerUp'), 0.5, 0.3);
}

/** A blendshape's value (0..1) by name. */
export function fcBlend(st, name) {
  const i = FC_B(name);
  return i < FC_ANGLES ? 0 : fcClamp(st.meta[i]);
}

/** The face's width on the picture (cheek edge to cheek edge, picture heights): depth readings are measured against it. */
function fcWidth(st) {
  const A = st.aspect, p = st.pts;
  return Math.max(1e-3, Math.hypot((p[234 * 3] - p[454 * 3]) * A, p[234 * 3 + 1] - p[454 * 3 + 1]));
}

/**
 * A face source's reading, 0..1, or null while there is nothing to read:
 *   point      a landmark's x, y (0..1 over the picture, y up) or z (0.5 level with the face, 1 nearer)
 *   mouthOpen  the jaw's opening        smile       both mouth corners up
 *   browsUp    the inner brows raised   browsDown   the brows lowered (a frown)
 *   blinkLeft / blinkRight  each eye closing (as MediaPipe names them)
 *   jaw        the jaw sideways: 0.5 centred
 *   yaw, pitch, roll  the head turned, nodded, tilted: 0.5 facing the camera, ±90° at the ends
 *   blend      any blendshape (`point`: its number in FC_BLEND_NAMES)
 *   size       how big the face looks: 0 far, 1 close
 *   present    1 while a face is in view      gesture  1 while `gesture` is held
 */
export function fcRead(st, read, point, axis, gesture) {
  if (!st || !st.live) return null;
  if (read === 'present') return st.present ? 1 : 0;
  if (read === 'gesture') return fcGate(st, gesture) ? 1 : 0;
  if (!st.present) return null;
  const m = st.meta;
  // Mirrored, the head turns and tilts the way it looks on the picture.
  const sgn = st.mirror ? -1 : 1;
  switch (read) {
    case 'point': {
      const i = Math.max(0, Math.min(FC_POINTS - 1, point | 0));
      if (axis === 'z') return fcClamp(0.5 - st.pts[i * 3 + 2] / fcWidth(st));
      return fcClamp(st.pts[i * 3 + (axis === 'y' ? 1 : 0)]);
    }
    case 'mouthOpen': return fcBlend(st, 'jawOpen');
    case 'smile': return (fcBlend(st, 'mouthSmileLeft') + fcBlend(st, 'mouthSmileRight')) / 2;
    case 'browsUp': return fcBlend(st, 'browInnerUp');
    case 'browsDown': return (fcBlend(st, 'browDownLeft') + fcBlend(st, 'browDownRight')) / 2;
    case 'blinkLeft': return fcBlend(st, 'eyeBlinkLeft');
    case 'blinkRight': return fcBlend(st, 'eyeBlinkRight');
    case 'jaw': return fcClamp(0.5 + (fcBlend(st, 'jawLeft') - fcBlend(st, 'jawRight')) / 2);
    case 'yaw': return fcClamp(0.5 + sgn * m[0]);
    case 'pitch': return fcClamp(0.5 + m[1]);
    case 'roll': return fcClamp(0.5 + sgn * m[2]);
    case 'blend': { const i = Math.max(0, Math.min(FC_BLEND_NAMES.length - 1, point | 0)); return fcClamp(m[FC_ANGLES + i]); }
    case 'size': return fcClamp((fcWidth(st) - 0.08) / 0.5);
    default: return null;
  }
}

/** Is a face gesture held? 'appear': a face in view; 'leave': gone after one was seen. */
export function fcGate(st, gesture) {
  if (!st) return false;
  if (gesture === 'appear') return st.present;
  if (gesture === 'leave') return st.ever && !st.present;
  return st.present && !!st.g[gesture];
}

/** A landmark on the picture, or null while no face is in view. */
export function fcPoint(st, i) { return tkSubjectPoint(st, i); }

/** The face on the picture: its outline, eyes, brows and lips, and the irises (a setup aid). */
export function fcDraw(ctx, st, W, H, dpr, rgb) {
  if (!st || !st.live || !st.present) return;
  const c = rgb || [1, 0.75, 0.35];
  const css = a => 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a + ')';
  const px = i => st.pts[i * 3] * W, py = i => (1 - st.pts[i * 3 + 1]) * H;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = css(0.35);
  for (let i = 0; i < 468; i += 2) { ctx.beginPath(); ctx.arc(px(i), py(i), 0.9 * dpr, 0, Math.PI * 2); ctx.fill(); }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 1.6 * dpr; ctx.strokeStyle = css(0.9);
  ctx.beginPath();
  for (const path of FC_OUTLINES) { ctx.moveTo(px(path[0]), py(path[0])); for (let k = 1; k < path.length; k++) ctx.lineTo(px(path[k]), py(path[k])); }
  ctx.stroke();
  for (const i of [468, 473]) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(px(i), py(i), 3 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = css(1); ctx.stroke(); }
  ctx.restore();
}
