/**
 * playTracking.ts — face and body tracking, and tracking a Video layer
 * instead of the camera (docs/tracking.md). Hands keep their own types in
 * types/play.ts (PlayHands, the hand source and trigger); what's here is
 * shared by all three trackers or new with face and pose.
 */
import { sgParseValueRef } from '../play/kit/signals.js';
import type { PlayRecord, PlaySource, TriggerSpec, ValueCondition, PlayPairMapping } from './play';

/** The three trackers. */
export type TrackerKind = 'hands' | 'face' | 'pose';
export const TRACKER_KINDS: readonly TrackerKind[] = ['hands', 'face', 'pose'];
export const TRACKER_NAMES: Record<TrackerKind, string> = { hands: 'Hands', face: 'Face', pose: 'Pose' };

/**
 * A baked track (a Video layer analysed once, docs/tracking.md): its frames
 * live in the browser's track store (lib/trackBakes.ts, IndexedDB) under
 * `key`; the setup keeps this note of it. `sig` is the model settings it was
 * made with (a different one is stale: Analyse again).
 */
export interface TrackBakeRef {
  key: string;
  layerId: string;
  /** The video file it was made from (the layer's library id then): another file never reads it. */
  videoId: string;
  sig: string;
  frames: number;
  /** Frames a second analysed. */
  fps: number;
  /** The video's length (s). */
  duration: number;
  /** Stored size. */
  bytes: number;
}
/** Bakes a tracker keeps notes of (the newest first); older ones drop out. */
export const TRACK_BAKES_MAX = 4;

/** Face or pose tracking's settings for a setup. Absent = the defaults (and not tracking). */
export interface PlayTracker {
  /** 0 raw … 1 very smooth (the one-euro filter's cutoff when still). */
  smoothing: number;
  /** Show it on the picture (the face outline or the body's skeleton). */
  overlay: boolean;
  colour: [number, number, number];
  /** Selfie view (with no Camera layer and no video): moving right moves right on the picture. */
  mirror: boolean;
  responsiveness?: number;
  /** 0 lenient … 1 strict: the model's confidence thresholds together. Default 0.5. */
  strictness?: number;
  /** A Video layer's id to track instead of the camera. */
  source?: string;
  bakes?: TrackBakeRef[];
}
export const DEFAULT_FACE: PlayTracker = { smoothing: 0.5, overlay: true, colour: [1, 0.75, 0.35], mirror: true };
export const DEFAULT_POSE: PlayTracker = { smoothing: 0.5, overlay: true, colour: [0.45, 0.7, 1], mirror: true };

// ── Face ─────────────────────────────────────────────────────────────────────

/**
 * What a face source reads, 0..1 (play/kit/face.js fcRead): a landmark's X, Y
 * or Z, the mouth opening, a smile, brows up or down, each eye blinking, the
 * jaw sideways, the head's yaw, pitch and roll, any blendshape, how big the
 * face looks, a face in view, a gesture held.
 */
export type FaceRead = 'point' | 'mouthOpen' | 'smile' | 'browsUp' | 'browsDown' | 'blinkLeft' | 'blinkRight' | 'jaw' | 'yaw' | 'pitch' | 'roll' | 'blend' | 'size' | 'present' | 'gesture';
export const FACE_READS: readonly FaceRead[] = ['point', 'mouthOpen', 'smile', 'browsUp', 'browsDown', 'blinkLeft', 'blinkRight', 'jaw', 'yaw', 'pitch', 'roll', 'blend', 'size', 'present', 'gesture'];
export type FaceGesture = 'mouthOpen' | 'smile' | 'blink' | 'blinkLeft' | 'blinkRight' | 'browsUp' | 'appear' | 'leave';
export const FACE_GESTURES: readonly FaceGesture[] = ['mouthOpen', 'smile', 'blink', 'blinkLeft', 'blinkRight', 'browsUp', 'appear', 'leave'];

// ── Pose ─────────────────────────────────────────────────────────────────────

/** What a pose source reads, 0..1 (play/kit/pose.js psRead). */
export type PoseRead = 'point' | 'visibility' | 'lean' | 'spread' | 'size' | 'present' | 'gesture';
export const POSE_READS: readonly PoseRead[] = ['point', 'visibility', 'lean', 'spread', 'size', 'present', 'gesture'];
export type PoseGesture = 'handsUp' | 'leftHandUp' | 'rightHandUp' | 'armsOut' | 'appear' | 'leave';
export const POSE_GESTURES: readonly PoseGesture[] = ['handsUp', 'leftHandUp', 'rightHandUp', 'armsOut', 'appear', 'leave'];

/** Landmarks per tracker (the highest point number is one less). */
export const FACE_POINT_COUNT = 478;
export const POSE_POINT_COUNT = 33;

// ── Anchors: `face:<point>`, `pose:<point>` ──────────────────────────────────

export function trackAnchor(kind: 'face' | 'pose', point: number): string { return `${kind}:${point}`; }
/** The tracker and landmark of a `face:<n>` or `pose:<n>` anchor, or null. */
export function parseTrackAnchor(ref: string): { kind: 'face' | 'pose'; point: number } | null {
  const m = /^(face|pose):(\d{1,3})$/.exec(ref);
  if (!m) return null;
  const point = Number(m[2]), kind = m[1] as 'face' | 'pose';
  return point < (kind === 'face' ? FACE_POINT_COUNT : POSE_POINT_COUNT) ? { kind, point } : null;
}

// ── Does a setup use a tracker? ──────────────────────────────────────────────

type Uses = Pick<PlayRecord, 'mappings' | 'actions' | 'layers'> & Partial<Pick<PlayRecord, 'pairMappings' | 'signals' | 'sources'>>;

function anchorOf(kind: 'face' | 'pose', ref: string | undefined): boolean { return !!ref && parseTrackAnchor(ref)?.kind === kind; }
function condUses(kind: 'face' | 'pose', c: ValueCondition | undefined): boolean {
  if (!c) return false;
  const r = sgParseValueRef(c.value);
  return r?.kind === 'distance' && (anchorOf(kind, r.a) || anchorOf(kind, r.b));
}
function triggerUses(kind: 'face' | 'pose', t: TriggerSpec): boolean {
  return t.on === kind || (t.on === 'proximity' && (anchorOf(kind, t.a) || anchorOf(kind, t.b))) || (t.on === 'value' && condUses(kind, t));
}
function sourceUses(kind: 'face' | 'pose', s: PlaySource): boolean {
  return s.kind === kind || (s.kind === 'trigger' && triggerUses(kind, s.trigger)) || (s.kind === 'sensor' && s.read === 'distance' && anchorOf(kind, s.otherId));
}
function pairUses(kind: 'face' | 'pose', m: PlayPairMapping): boolean {
  const s = m.source;
  if (s.kind === 'position' ? anchorOf(kind, s.anchor) : sourceUses(kind, s.source)) return true;
  return condUses(kind, m.a.when) || condUses(kind, m.b.when);
}

/** Does a setup read a face (or a body) anywhere: a source, a gesture trigger, a distance, a null that follows one? */
export function usesTracker(play: Uses, kind: 'face' | 'pose'): boolean {
  return play.mappings.some(m => sourceUses(kind, m.source) || (!!m.increment && ((m.increment.on === 'trigger' && triggerUses(kind, m.increment.trigger)) || (m.increment.on === 'repeat' && condUses(kind, m.increment.when)))))
    || (play.actions ?? []).some(a => triggerUses(kind, a.trigger))
    || (play.signals ?? []).some(s => s.when?.kind === 'trigger' && triggerUses(kind, s.when.trigger))
    || (play.sources ?? []).some(s => s.enabled && (sourceUses(kind, s.source) || s.outputs.some(o => o.kind === 'step' && o.step.on === 'trigger' && triggerUses(kind, o.step.trigger))))
    || (play.pairMappings ?? []).some(m => pairUses(kind, m))
    || play.layers.some(l => l.kind === 'null' && l.follow === kind);
}
export const usesFace = (play: Uses) => usesTracker(play, 'face');
export const usesPose = (play: Uses) => usesTracker(play, 'pose');

// ── Reading files ────────────────────────────────────────────────────────────

const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const unit = (x: unknown, d: number) => Math.max(0, Math.min(1, num(x, d)));
const rgb = (x: unknown, d: [number, number, number]): [number, number, number] => (Array.isArray(x) && x.length === 3 && x.every(v => typeof v === 'number' && Number.isFinite(v)) ? [unit(x[0], 0), unit(x[1], 0), unit(x[2], 0)] : [...d]);
const ID = /^[\w:.-]{1,120}$/;

export function parseBakes(v: unknown): TrackBakeRef[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TrackBakeRef[] = [];
  for (const b of v.slice(0, TRACK_BAKES_MAX)) {
    if (!b || typeof b !== 'object') continue;
    const r = b as Record<string, unknown>;
    if (typeof r.key !== 'string' || !ID.test(r.key) || typeof r.layerId !== 'string' || typeof r.videoId !== 'string') continue;
    out.push({
      key: r.key, layerId: r.layerId.slice(0, 64), videoId: r.videoId.slice(0, 120), sig: typeof r.sig === 'string' ? r.sig.slice(0, 80) : '',
      frames: Math.max(0, Math.round(num(r.frames, 0))), fps: Math.max(0, num(r.fps, 0)), duration: Math.max(0, num(r.duration, 0)), bytes: Math.max(0, Math.round(num(r.bytes, 0))),
    });
  }
  return out.length ? out : undefined;
}

/** Face or pose settings from a file, or null when it has none. */
export function parseTracker(v: unknown, d: PlayTracker): PlayTracker | null {
  if (!v || typeof v !== 'object') return null;
  const h = v as Record<string, unknown>;
  const out: PlayTracker = { smoothing: unit(h.smoothing, d.smoothing), overlay: h.overlay !== false, colour: rgb(h.colour, d.colour), mirror: h.mirror !== false };
  if (typeof h.responsiveness === 'number') out.responsiveness = unit(h.responsiveness, 0.5);
  if (typeof h.strictness === 'number') out.strictness = unit(h.strictness, 0.5);
  if (typeof h.source === 'string' && h.source) out.source = h.source.slice(0, 64);
  const bakes = parseBakes(h.bakes);
  if (bakes) out.bakes = bakes;
  return out;
}

export function faceGesture(v: unknown): FaceGesture { return typeof v === 'string' && (FACE_GESTURES as readonly string[]).includes(v) ? (v as FaceGesture) : 'mouthOpen'; }
export function poseGesture(v: unknown): PoseGesture { return typeof v === 'string' && (POSE_GESTURES as readonly string[]).includes(v) ? (v as PoseGesture) : 'handsUp'; }

/** A face or pose source from a file. */
export function parseTrackerSource(kind: 'face' | 'pose', s: Record<string, unknown>): PlaySource {
  const axis = s.axis === 'y' || s.axis === 'z' ? s.axis : 'x';
  if (kind === 'face') {
    const read = (FACE_READS as readonly string[]).includes(s.read as string) ? (s.read as FaceRead) : 'point';
    return { kind: 'face', read, point: Math.max(0, Math.min(FACE_POINT_COUNT - 1, Math.round(num(s.point, 1)))), axis, gesture: faceGesture(s.gesture) };
  }
  const read = (POSE_READS as readonly string[]).includes(s.read as string) ? (s.read as PoseRead) : 'point';
  return { kind: 'pose', read, point: Math.max(0, Math.min(POSE_POINT_COUNT - 1, Math.round(num(s.point, 0)))), axis, gesture: poseGesture(s.gesture) };
}

/** The bake a tracker would read for a Video layer's current file, and whether it matches the settings now. */
export function bakeFor(bakes: readonly TrackBakeRef[] | undefined, layerId: string, videoId: string, sig: string): { bake: TrackBakeRef; fresh: boolean } | null {
  const same = (bakes ?? []).filter(b => b.layerId === layerId && b.videoId === videoId);
  const exact = same.find(b => b.sig === sig);
  if (exact) return { bake: exact, fresh: true };
  return same[0] ? { bake: same[0], fresh: false } : null;
}

/** Keep a new bake's note (newest first), dropping one for the same layer and file, and the oldest past the cap. */
export function withBake(bakes: readonly TrackBakeRef[] | undefined, b: TrackBakeRef): TrackBakeRef[] {
  return [b, ...(bakes ?? []).filter(x => !(x.layerId === b.layerId && x.videoId === b.videoId))].slice(0, TRACK_BAKES_MAX);
}
