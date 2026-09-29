/**
 * trackSources.ts — face and pose as sources, triggers and anchors in the UI
 * (docs/tracking.md): labels, hints, pickers' options, and new sources of a
 * reading. Pure. Hands keep theirs in playSources.ts.
 */
import type { PlaySource } from '../types/play';
import type { FaceGesture, FaceRead, PoseGesture, PoseRead } from '../types/playTracking';
import { FC_BLEND_NAMES, FC_NAMED_POINTS } from './kit/face.js';
import { PS_POINT_NAMES } from './kit/pose.js';

export type FaceSourceType = `face:${FaceRead}`;
export type PoseSourceType = `pose:${PoseRead}`;

/** The source list's Face and Pose groups. */
export const TRACK_SOURCE_TYPES: { value: FaceSourceType | PoseSourceType; label: string; group: string }[] = [
  { value: 'face:point', label: 'Face point (X, Y, Z)', group: 'Face' },
  { value: 'face:mouthOpen', label: 'Mouth open', group: 'Face' },
  { value: 'face:smile', label: 'Smile', group: 'Face' },
  { value: 'face:browsUp', label: 'Brows up', group: 'Face' },
  { value: 'face:browsDown', label: 'Brows down (frown)', group: 'Face' },
  { value: 'face:blinkLeft', label: 'Blink (left eye)', group: 'Face' },
  { value: 'face:blinkRight', label: 'Blink (right eye)', group: 'Face' },
  { value: 'face:jaw', label: 'Jaw sideways', group: 'Face' },
  { value: 'face:yaw', label: 'Head turn (yaw)', group: 'Face' },
  { value: 'face:pitch', label: 'Head nod (pitch)', group: 'Face' },
  { value: 'face:roll', label: 'Head tilt (roll)', group: 'Face' },
  { value: 'face:blend', label: 'Any blendshape', group: 'Face' },
  { value: 'face:size', label: 'Nearness (how big it looks)', group: 'Face' },
  { value: 'face:present', label: 'Face in view', group: 'Face' },
  { value: 'face:gesture', label: 'Face gesture held', group: 'Face' },
  { value: 'pose:point', label: 'Body point (X, Y, Z)', group: 'Pose' },
  { value: 'pose:visibility', label: 'Point visible', group: 'Pose' },
  { value: 'pose:lean', label: 'Shoulder lean', group: 'Pose' },
  { value: 'pose:spread', label: 'Wrists apart', group: 'Pose' },
  { value: 'pose:size', label: 'Nearness (how big it looks)', group: 'Pose' },
  { value: 'pose:present', label: 'Body in view', group: 'Pose' },
  { value: 'pose:gesture', label: 'Pose gesture held', group: 'Pose' },
];

export const FACE_READ_LABELS: Record<FaceRead, string> = {
  point: 'Point', mouthOpen: 'Mouth open', smile: 'Smile', browsUp: 'Brows up', browsDown: 'Brows down', blinkLeft: 'Blink left', blinkRight: 'Blink right',
  jaw: 'Jaw sideways', yaw: 'Head turn', pitch: 'Head nod', roll: 'Head tilt', blend: 'Blendshape', size: 'Nearness', present: 'In view', gesture: 'Gesture',
};
export const POSE_READ_LABELS: Record<PoseRead, string> = { point: 'Point', visibility: 'Visible', lean: 'Lean', spread: 'Wrists apart', size: 'Nearness', present: 'In view', gesture: 'Gesture' };

export const FACE_READ_HINTS: Record<FaceRead, string> = {
  point: 'Where the point is: X across the picture, Y up it, Z toward the camera (0.5 level with the face).',
  mouthOpen: '0 closed, 1 wide open (MediaPipe’s jawOpen).',
  smile: 'Both mouth corners up: 0 none, 1 a big smile.',
  browsUp: 'The inner brows raised: surprise.',
  browsDown: 'The brows lowered: a frown.',
  blinkLeft: 'The left eye closing, as MediaPipe names it: 1 shut.',
  blinkRight: 'The right eye closing, as MediaPipe names it: 1 shut.',
  jaw: 'The jaw moved sideways: 0.5 centred.',
  yaw: 'The head turned: 0.5 facing the camera, toward 0 or 1 turned to either side (±90°), the way it looks on the picture.',
  pitch: 'The head nodded: 0.5 level, toward 0 or 1 looking down or up (±90°).',
  roll: 'The head tilted to one shoulder: 0.5 upright (±90°).',
  blend: 'Any of MediaPipe’s 52 blendshapes, 0..1.',
  size: 'How big the face looks: 0 far from the camera, 1 close to it.',
  present: '1 while a face is in view.',
  gesture: '1 while the gesture is held: a gate. For an envelope or a toggle, use Trigger with On: Face gesture.',
};
export const POSE_READ_HINTS: Record<PoseRead, string> = {
  point: 'Where the point is: X across the picture, Y up it, Z toward the camera (0.5 level with the hips).',
  visibility: 'How sure the model is that the point is in view (a hidden hand behind the back reads low).',
  lean: 'The shoulders’ tilt: 0.5 level, more with the right-hand shoulder on the picture lower.',
  spread: 'Wrist to wrist: 1 is a picture width.',
  size: 'How big the body looks (shoulder to shoulder): 0 far, 1 close.',
  present: '1 while a body is in view.',
  gesture: '1 while the gesture is held: a gate. For an envelope or a toggle, use Trigger with On: Pose gesture.',
};

export const FACE_GESTURE_OPTIONS: { value: FaceGesture; label: string; title: string }[] = [
  { value: 'mouthOpen', label: 'Mouth opens', title: 'The mouth opening wide; ends once it closes again' },
  { value: 'smile', label: 'Smile', title: 'Both mouth corners up' },
  { value: 'blink', label: 'Blink (both eyes)', title: 'Both eyes shut' },
  { value: 'blinkLeft', label: 'Wink left', title: 'The left eye shut (as MediaPipe names it)' },
  { value: 'blinkRight', label: 'Wink right', title: 'The right eye shut (as MediaPipe names it)' },
  { value: 'browsUp', label: 'Brows up', title: 'The inner brows raised' },
  { value: 'appear', label: 'Comes into view', title: 'Fires when a face appears; held while it stays' },
  { value: 'leave', label: 'Leaves view', title: 'Fires when the face goes; held while it is away' },
];
export const POSE_GESTURE_OPTIONS: { value: PoseGesture; label: string; title: string }[] = [
  { value: 'handsUp', label: 'Both hands up', title: 'Both wrists above the nose' },
  { value: 'leftHandUp', label: 'Left hand up', title: 'Your left wrist above your nose' },
  { value: 'rightHandUp', label: 'Right hand up', title: 'Your right wrist above your nose' },
  { value: 'armsOut', label: 'Arms out', title: 'Both arms stretched out to the sides' },
  { value: 'appear', label: 'Comes into view', title: 'Fires when a body appears; held while it stays' },
  { value: 'leave', label: 'Leaves view', title: 'Fires when the body goes; held while it is away' },
];
export const FACE_GESTURE_LABELS = Object.fromEntries(FACE_GESTURE_OPTIONS.map(g => [g.value, g.label])) as Record<FaceGesture, string>;
export const POSE_GESTURE_LABELS = Object.fromEntries(POSE_GESTURE_OPTIONS.map(g => [g.value, g.label])) as Record<PoseGesture, string>;

/** Face points with names, for pickers (then "Point N" for the rest of the 478, by number). */
export const FACE_POINT_OPTIONS = FC_NAMED_POINTS.map(([i, name]) => ({ value: String(i), label: name }));
export const POSE_POINT_OPTIONS = PS_POINT_NAMES.map((name, i) => ({ value: String(i), label: name }));
/** The blendshapes, for `face:blend` (the neutral one left out). */
export const BLEND_OPTIONS = FC_BLEND_NAMES.map((name, i) => ({ value: String(i), label: name })).filter(o => o.label !== '_neutral');

export function facePointName(i: number): string { return FC_NAMED_POINTS.find(p => p[0] === i)?.[1] ?? `Point ${i}`; }
export function posePointName(i: number): string { return PS_POINT_NAMES[i] ?? `Point ${i}`; }

/** A new face or pose source of a reading, keeping the point and axis of the one it replaces. */
export function trackSource(kind: 'face' | 'pose', read: string, prev: PlaySource): PlaySource {
  const p = prev.kind === kind ? prev : null;
  const axis = p?.axis ?? 'x';
  if (kind === 'face') {
    const point = read === 'blend' ? (p?.read === 'blend' ? p.point : FC_BLEND_NAMES.indexOf('jawOpen')) : p && p.read !== 'blend' ? p.point : 1;
    return { kind: 'face', read: read as FaceRead, point, axis, gesture: p?.kind === 'face' ? p.gesture : 'mouthOpen' };
  }
  return { kind: 'pose', read: read as PoseRead, point: p?.point ?? (read === 'visibility' ? 15 : 16), axis, gesture: p?.kind === 'pose' ? p.gesture : 'handsUp' };
}

/** "Face · Nose tip · X", "Face · Smile", "Pose · Right wrist · Y". */
export function trackSourceLabel(s: Extract<PlaySource, { kind: 'face' | 'pose' }>): string {
  if (s.kind === 'face') {
    switch (s.read) {
      case 'point': return `Face · ${facePointName(s.point)} · ${s.axis.toUpperCase()}`;
      case 'blend': return `Face · ${FC_BLEND_NAMES[s.point] ?? 'Blendshape'}`;
      case 'gesture': return `Face · ${FACE_GESTURE_LABELS[s.gesture]} (held)`;
      default: return `Face · ${FACE_READ_LABELS[s.read]}`;
    }
  }
  switch (s.read) {
    case 'point': return `Pose · ${posePointName(s.point)} · ${s.axis.toUpperCase()}`;
    case 'visibility': return `Pose · ${posePointName(s.point)} visible`;
    case 'gesture': return `Pose · ${POSE_GESTURE_LABELS[s.gesture]} (held)`;
    default: return `Pose · ${POSE_READ_LABELS[s.read]}`;
  }
}

/** "Face · Nose tip", "Pose · Left wrist". */
export function trackAnchorLabel(kind: 'face' | 'pose', point: number): string {
  return kind === 'face' ? `Face · ${facePointName(point)}` : `Pose · ${posePointName(point)}`;
}
