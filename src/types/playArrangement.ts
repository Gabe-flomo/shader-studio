/**
 * playArrangement.ts — the Audio engine's tape (`play.arrangement`,
 * docs/arrangement.md): an OP-1-style multitrack of what was played into the
 * racks. One track per rack (keyed by rack id): the notes played (MIDI, the
 * computer keyboard, the card's keys) and the rack controls' automation.
 *
 * The tape is MIDI, not audio: playing it back sends the notes through each
 * rack's instrument, so sound, readers, controls and mappings all happen for
 * real. The first recording sets the tape's length; recording past the end
 * extends it up to TAPE_MAX_SECONDS.
 *
 * Recording onto a tape that has material ("overdub") replaces only where
 * new material was made: the spans where notes were played (per track) and
 * the spans where a rack control was moved (per control). Everything else
 * keeps the old material. "Replace" (re-recording one rack) replaces the
 * whole span from the record point to where recording stopped.
 *
 * Pure: types, parsing, the merge rules, and the scheduling maths the
 * runtime (lib/tape.ts) and the tests share.
 */

/** The tape runs up to a minute for now. */
export const TAPE_MAX_SECONDS = 60;
/** Rack controls per instrument or effect (docs/arrangement.md, Configure). */
export const RACK_CONTROLS_MAX = 8;
/** Notes a track keeps. */
export const ARR_NOTES_MAX = 4000;
/** Automation points a control keeps. */
export const ARR_POINTS_MAX = 3000;
/** Count-in lengths, in bars of 4/4 (0: none). */
export const COUNT_INS = [0, 1, 2, 4] as const;
export type CountIn = (typeof COUNT_INS)[number];
/** Longest fade-in attack (ms). */
export const FADE_MAX_MS = 2000;
/** A control moved and let go is still "touched" this long after its last move (s). */
export const TOUCH_HOLD = 0.5;
/** Notes shorter than this are stretched to it (a tap still sounds). */
export const NOTE_MIN = 0.01;

/**
 * A note on the tape: `t` seconds from the tape's start, MIDI note `n`,
 * velocity `v` 0..1, `d` seconds long. `off`: deactivated in the piano roll
 * (kept and drawn, not played).
 */
export interface ArrNote { t: number; n: number; v: number; d: number; off?: boolean }

export interface ArrTrack {
  notes: ArrNote[];
  /** Rack control target (`au:<rack>:<slot>::<address>`) → points, flat `[t, v, t, v…]`, sorted by t. */
  auto: Record<string, number[]>;
  mute?: boolean;
  solo?: boolean;
  /** Records when Record is pressed (default on). */
  arm: boolean;
  /**
   * How the lane shows what it recorded (docs/arrangement.md, "Clips"): 'midi'
   * (the default) draws the notes, 'audio' draws the track's rendered sound or an
   * envelope from the notes. The tape is MIDI either way.
   */
  show?: 'midi' | 'audio';
  /**
   * The clips on the lane (docs/arrangement.md, "Clips"): the spans recordings
   * covered, sorted, not overlapping. A muted clip's notes and moves don't
   * play. Absent on a tape recorded before clips: they're worked out from the
   * material (trackClips).
   */
  clips?: ArrClip[];
}

/** A clip on a lane: `t` seconds from the tape's start, `d` long; `mute` leaves it out of playback. */
export interface ArrClip { t: number; d: number; mute?: boolean }

export interface PlayArrangement {
  /** Seconds; 0 until the first recording. */
  length: number;
  /** Playback starts over at the end (on by default once a length exists). */
  loop: boolean;
  /** The metronome's and count-in's tempo. */
  bpm: number;
  /** A click on every beat while the tape runs (off by default: silent). */
  metronome: boolean;
  /** Bars counted in before a punch-in (0: none). */
  countIn: CountIn;
  /** New material's level fades in over this many ms from the record point (0: none). */
  fade: number;
  /** By rack id. */
  tracks: Record<string, ArrTrack>;
  /**
   * The tape's scale (Live's current scale, docs/piano-roll-plan.md): racks
   * with Snap to scale put live notes in it while it's on; the piano roll
   * highlights its notes. Absent: off.
   */
  scale?: ArrScale;
}

/** The tape's scale: on or off, its root (0 = C … 11 = B) and which scale (play/scales.ts id). */
export interface ArrScale { on: boolean; root: number; name: string }

export function emptyArrangement(bpm = 120): PlayArrangement {
  return { length: 0, loop: true, bpm, metronome: false, countIn: 0, fade: 0, tracks: {} };
}

export const emptyTrack = (): ArrTrack => ({ notes: [], auto: {}, arm: true });

export function isArrangementEmpty(a: PlayArrangement | undefined): boolean {
  return !a || (a.length <= 0 && Object.values(a.tracks).every(t => !t.notes.length && !Object.keys(t.auto).length));
}

/** Does this track have anything on it? */
export const trackHasMaterial = (t: ArrTrack | undefined): boolean => !!t && (t.notes.length > 0 || Object.values(t.auto).some(p => p.length > 0));

// ── Timing ──────────────────────────────────────────────────────────────────

export const beatSeconds = (bpm: number) => 60 / Math.max(20, Math.min(300, bpm || 120));
/** Seconds a count-in of `bars` bars of 4/4 takes. */
export const countInSeconds = (bars: number, bpm: number) => Math.max(0, bars) * 4 * beatSeconds(bpm);

/**
 * A punch-in at `point` with a count-in: where the transport starts (it
 * pre-rolls the tape before the point; negative is silence before the tape),
 * and the beats counted in (tape seconds, the last one a beat before `point`).
 */
export function punchIn(point: number, bars: number, bpm: number): { start: number; beats: number[] } {
  const b = beatSeconds(bpm);
  const n = Math.max(0, Math.round(bars)) * 4;
  const beats: number[] = [];
  for (let i = n; i >= 1; i--) beats.push(round6(point - i * b));
  return { start: round6(point - n * b), beats };
}

/** Metronome beats (tape seconds) in (a, b]: on the tempo's grid from the tape's 0. */
export function beatsIn(a: number, b: number, bpm: number): number[] {
  const s = beatSeconds(bpm), out: number[] = [];
  for (let k = Math.floor(a / s + 1e-9) + 1; k * s <= b + 1e-9; k++) out.push(round6(k * s));
  return out;
}

/**
 * The tape spans a transport tick covers, from tape time `prev` to `now`
 * (both unwrapped: seconds since the transport started, offset by its start
 * position), each as (a, b]: what's due after the last tick, up to this one.
 * Looping wraps at `length` (a lap after the wrap starts just before 0, so a
 * note at 0 plays); without a loop, or with no length, the span runs on.
 * `wrapped`: the tape went round (the runtime lets held notes go there).
 */
export function tapeSpans(prev: number, now: number, length: number, loop: boolean): { spans: Array<[number, number]>; wrapped: boolean } {
  if (!(now > prev)) return { spans: [], wrapped: false };
  if (!loop || !(length > 0)) return { spans: [[prev, now]], wrapped: false };
  const spans: Array<[number, number]> = [];
  let wrapped = false;
  let a = prev;
  // Positions before 0 (a pre-roll) play nothing but still count down to 0.
  if (a < 0) { spans.push([a, Math.min(0, now)]); if (now <= 0) return { spans, wrapped }; a = -1e-9; }
  const lapB = Math.floor((now - 1e-9) / length);
  let lapA = Math.floor(Math.max(0, a) / length);
  if (lapB - lapA > 4) lapA = lapB - 4; // a long stall: only the last few laps
  for (let lap = lapA; lap <= lapB; lap++) {
    const s = lap === lapA ? a - lap * length : -1e-9, e = Math.min(now, (lap + 1) * length) - lap * length;
    if (e > s) spans.push([s, e]);
    if (lap > lapA) wrapped = true;
  }
  return { spans, wrapped };
}

/** The tape position of an unwrapped transport time. */
export function tapePosition(t: number, length: number, loop: boolean): number {
  if (t < 0 || !loop || !(length > 0)) return t;
  return t % length;
}

export interface NoteEvent { t: number; n: number; v: number; on: boolean }

/** A track's note ons and offs in (a, b] (offs at t + d, never past `end`). Sorted; an off before an on at the same time. */
export function noteEvents(track: Pick<ArrTrack, 'notes'>, a: number, b: number, end = Infinity): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const x of track.notes) {
    if (x.t > a && x.t <= b) out.push({ t: x.t, n: x.n, v: x.v, on: true });
    const off = Math.min(end, x.t + x.d);
    if (off > a && off <= b) out.push({ t: off, n: x.n, v: 0, on: false });
  }
  return out.sort((p, q) => p.t - q.t || (p.on === q.on ? 0 : p.on ? 1 : -1));
}

/** An automation lane's value at `t` (straight between points, held past the ends), or undefined when it has none. */
export function autoAt(points: readonly number[] | undefined, t: number): number | undefined {
  if (!points || points.length < 2) return undefined;
  const n = points.length / 2;
  if (t <= points[0]) return points[1];
  if (t >= points[(n - 1) * 2]) return points[(n - 1) * 2 + 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (points[m * 2] <= t) lo = m; else hi = m; }
  const t0 = points[lo * 2], t1 = points[hi * 2], v0 = points[lo * 2 + 1], v1 = points[hi * 2 + 1];
  return t1 > t0 ? v0 + (v1 - v0) * (t - t0) / (t1 - t0) : v1;
}

/** Which tracks sound: not muted, and the soloed ones when any is soloed. */
export function audibleTracks(a: Pick<PlayArrangement, 'tracks'>): string[] {
  const ids = Object.keys(a.tracks);
  const solo = ids.some(id => a.tracks[id].solo);
  return ids.filter(id => !a.tracks[id].mute && (!solo || a.tracks[id].solo));
}

// ── Recording: a pass and how it merges ─────────────────────────────────────

/** What one recording pass captured for one rack. */
export interface ArrPass {
  rack: string;
  /** Tape seconds the capture ran over (the punch-in point, and where it stopped). */
  from: number;
  to: number;
  /** Notes played (tape seconds; a note still held at the stop ends there). */
  notes: ArrNote[];
  /** Each rack control's values over the pass, flat `[t, v…]`. */
  auto: Record<string, number[]>;
  /** Each control's touched spans (moved by hand or by a mapped knob). */
  touched: Record<string, Array<[number, number]>>;
  /** Overdub: replace where new material was made. Replace: the whole span. */
  mode: 'overdub' | 'replace';
}

/** Overlapping (or touching within `join` s) spans merged, sorted. */
export function unionSpans(spans: ReadonlyArray<[number, number]>, join = 0): Array<[number, number]> {
  const s = spans.filter(([a, b]) => b >= a).map(([a, b]) => [a, b] as [number, number]).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + join) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const inSpans = (t: number, spans: ReadonlyArray<[number, number]>) => spans.some(([a, b]) => t >= a && t < b);

/** The spans new notes cover (each from its start to its end). */
export function noteSpans(notes: readonly ArrNote[]): Array<[number, number]> {
  return unionSpans(notes.map(n => [n.t, n.t + Math.max(NOTE_MIN, n.d)] as [number, number]));
}

/**
 * Old notes with new ones in `spans`: an old note starting inside a span goes;
 * one sounding into a span is cut where the span starts.
 */
export function mergeNotes(old: readonly ArrNote[], fresh: readonly ArrNote[], spans: ReadonlyArray<[number, number]>): ArrNote[] {
  const kept: ArrNote[] = [];
  for (const n of old) {
    if (inSpans(n.t, spans)) continue;
    let d = n.d;
    for (const [a] of spans) if (a > n.t && a < n.t + d) d = a - n.t;
    kept.push(d === n.d ? n : { ...n, d: round6(Math.max(NOTE_MIN, d)) });
  }
  return [...kept, ...fresh].sort((a, b) => a.t - b.t || a.n - b.n).slice(0, ARR_NOTES_MAX);
}

/**
 * An automation lane with new points in `spans`: old points inside go, the
 * old curve is pinned just outside each span (so what's around keeps its
 * shape), and the new points inside are put in.
 */
export function mergeAuto(old: readonly number[] | undefined, fresh: readonly number[], spans: ReadonlyArray<[number, number]>): number[] {
  const pts: Array<[number, number]> = [];
  const had = !!old && old.length >= 2;
  if (had) for (let i = 0; i < old!.length; i += 2) if (!spans.some(([a, b]) => old![i] >= a && old![i] <= b)) pts.push([old![i], old![i + 1]]);
  for (const [a, b] of spans) {
    if (had) {
      const pa = round6(a - 0.001), pb = round6(b + 0.001);
      if (pa >= 0) pts.push([pa, autoAt(old, pa)!]);
      pts.push([pb, autoAt(old, pb)!]);
    }
    for (let i = 0; i < fresh.length; i += 2) if (fresh[i] >= a && fresh[i] <= b) pts.push([fresh[i], fresh[i + 1]]);
  }
  pts.sort((x, y) => x[0] - y[0]);
  const flat: number[] = [];
  for (const [t, v] of pts) {
    // Same moment twice: the later (new) one wins.
    if (flat.length && Math.abs(flat[flat.length - 2] - t) < 1e-9) { flat[flat.length - 1] = v; continue; }
    flat.push(t, v);
  }
  return flat.length / 2 > ARR_POINTS_MAX ? thinPoints(flat, ARR_POINTS_MAX) : flat;
}

function thinPoints(flat: number[], max: number): number[] {
  const n = flat.length / 2, step = n / max, out: number[] = [];
  for (let k = 0; k < max; k++) { const i = Math.min(n - 1, Math.floor(k * step)); out.push(flat[i * 2], flat[i * 2 + 1]); }
  if (out[out.length - 2] !== flat[flat.length - 2]) { out.push(flat[flat.length - 2], flat[flat.length - 1]); }
  return out;
}

/** Fade-in: a new note's velocity scaled by how far it is into `ms` from `from`. */
export function fadeNotes(notes: readonly ArrNote[], from: number, ms: number): ArrNote[] {
  if (!(ms > 0)) return [...notes];
  const span = ms / 1000;
  return notes.map(n => (n.t - from >= span ? n : { ...n, v: round6(Math.max(0.01, n.v * Math.max(0, n.t - from) / span)) }));
}

/** One pass merged into its track (a missing track starts empty). */
export function mergePass(track: ArrTrack | undefined, pass: ArrPass, fadeMs = 0): ArrTrack {
  const base = track ?? emptyTrack();
  const fresh = fadeNotes(pass.notes, pass.from, fadeMs);
  const whole: Array<[number, number]> = [[pass.from, Math.max(pass.from, pass.to)]];
  const spans = pass.mode === 'replace' ? whole : noteSpans(fresh);
  const notes = mergeNotes(base.notes, fresh, spans);
  const auto: Record<string, number[]> = { ...base.auto };
  for (const [target, pts] of Object.entries(pass.auto)) {
    const touched = pass.mode === 'replace' ? whole : unionSpans((pass.touched[target] ?? []).map(([a, b]) => [a, Math.min(pass.to, b)] as [number, number]));
    if (!touched.length) continue;
    const merged = mergeAuto(base.auto[target], pts, touched);
    if (merged.length) auto[target] = merged;
  }
  return { ...base, notes, auto };
}

/**
 * The tape after a recording: every pass merged into its rack's track, and
 * the length set by the first recording or extended by one that ran past
 * the end (capped at TAPE_MAX_SECONDS).
 */
export function applyPasses(arr: PlayArrangement, passes: readonly ArrPass[], opts: { stoppedAt: number }): PlayArrangement {
  const tracks = { ...arr.tracks };
  for (const p of passes) {
    const before = tracks[p.rack];
    const merged = mergePass(before, p, arr.fade);
    tracks[p.rack] = { ...merged, clips: clipsWithPass(before ? trackClips(before, TAPE_MAX_SECONDS) : [], p.from, Math.max(p.from, p.to)) };
  }
  const reached = Math.min(TAPE_MAX_SECONDS, Math.max(0, opts.stoppedAt));
  const length = round3(Math.max(arr.length, reached));
  return { ...arr, tracks, length, loop: arr.length > 0 ? arr.loop : true };
}

/** A track cleared (its notes, automation and clips; mute, solo, arm and how it shows kept). */
export function clearTrack(arr: PlayArrangement, rack: string): PlayArrangement {
  const t = arr.tracks[rack];
  if (!t) return arr;
  const out: ArrTrack = { ...t, notes: [], auto: {} };
  delete out.clips;
  return { ...arr, tracks: { ...arr.tracks, [rack]: out } };
}

export function patchTrack(arr: PlayArrangement, rack: string, over: Partial<ArrTrack>): PlayArrangement {
  return { ...arr, tracks: { ...arr.tracks, [rack]: { ...(arr.tracks[rack] ?? emptyTrack()), ...over } } };
}

/** Tracks only for racks that exist (a removed rack's track goes with it). */
export function arrangementFor(arr: PlayArrangement | undefined, rackIds: readonly string[]): PlayArrangement | undefined {
  if (!arr) return arr;
  const ids = new Set(rackIds);
  const gone = Object.keys(arr.tracks).filter(id => !ids.has(id));
  if (!gone.length) return arr;
  const tracks = { ...arr.tracks };
  for (const id of gone) delete tracks[id];
  return { ...arr, tracks };
}

// ── Clips ───────────────────────────────────────────────────────────────────

/** Material closer than this (s) is one clip when a tape's clips are worked out from its material. */
export const CLIP_JOIN = 1;
/** The shortest clip a trim leaves (s). */
export const CLIP_MIN = 0.05;

/** Where a track has notes or automation, as spans (a note from its start to its end; automation from its first point to its last). */
function materialSpans(track: ArrTrack): Array<[number, number]> {
  const spans: Array<[number, number]> = track.notes.map(n => [n.t, n.t + Math.max(NOTE_MIN, n.d)] as [number, number]);
  for (const pts of Object.values(track.auto)) if (pts.length >= 2) spans.push([pts[0], Math.max(pts[0] + NOTE_MIN, pts[pts.length - 2])]);
  return spans;
}

/**
 * A lane's clips, sorted, within the tape's `length`: the track's own when it
 * has them, else worked out from its material (runs of notes and moves closer
 * than CLIP_JOIN are one clip), so an older tape shows clips too.
 */
export function trackClips(track: ArrTrack | undefined, length: number): ArrClip[] {
  if (!track) return [];
  const end = length > 0 ? length : TAPE_MAX_SECONDS;
  if (track.clips) {
    return track.clips
      .map(c => ({ ...c, d: round6(Math.min(c.d, end - c.t)) }))
      .filter(c => c.t < end && c.d > 1e-6)
      .sort((a, b) => a.t - b.t);
  }
  return unionSpans(materialSpans(track), CLIP_JOIN)
    .map(([a, b]) => ({ t: round6(Math.max(0, a)), d: round6(Math.min(end, b) - Math.max(0, a)) }))
    .filter(c => c.d > 1e-6);
}

/** Clips after a recording over [from, to]: the pass's span joined with any clip it overlaps (a muted clip recorded over plays again). */
export function clipsWithPass(clips: readonly ArrClip[], from: number, to: number): ArrClip[] {
  const union = unionSpans([...clips.map(c => [c.t, c.t + c.d] as [number, number]), [from, to]]);
  return union.map(([a, b]) => {
    const same = clips.find(c => Math.abs(c.t - a) < 1e-6 && Math.abs(c.t + c.d - b) < 1e-6);
    const clip: ArrClip = { t: round6(a), d: round6(b - a) };
    if (same?.mute) clip.mute = true;
    return clip;
  }).filter(c => c.d > 1e-6);
}

const inClip = (t: number, c: ArrClip, closed = false) => t >= c.t - 1e-9 && (closed ? t <= c.t + c.d + 1e-9 : t < c.t + c.d - 1e-9);

/** A track with its clips written down (so an edit to one clip doesn't change how the others are worked out). */
function withClips(arr: PlayArrangement, rack: string): (ArrTrack & { clips: ArrClip[] }) | undefined {
  const t = arr.tracks[rack];
  return t ? { ...t, clips: trackClips(t, arr.length) } : undefined;
}

/** A clip deleted: the notes that start in it and the moves inside it come off the tape. */
export function deleteClip(arr: PlayArrangement, rack: string, index: number): PlayArrangement {
  const t = withClips(arr, rack);
  const c = t?.clips[index];
  if (!t || !c) return arr;
  const auto: Record<string, number[]> = {};
  for (const [k, pts] of Object.entries(t.auto)) {
    const kept: number[] = [];
    for (let i = 0; i < pts.length; i += 2) if (!inClip(pts[i], c, true)) kept.push(pts[i], pts[i + 1]);
    if (kept.length) auto[k] = kept;
  }
  const notes = t.notes.filter(n => !inClip(n.t, c));
  return { ...arr, tracks: { ...arr.tracks, [rack]: { ...t, notes, auto, clips: t.clips.filter((_, i) => i !== index) } } };
}

/** A clip muted (left out of playback, takes and renders) or back on. */
// ── Editing notes on a MIDI clip (docs/arrangement.md, "Editing notes") ─────

/** Notes sorted by time, then pitch: the order the tape plays them. */
function sortNotes(notes: readonly ArrNote[]): ArrNote[] {
  return [...notes].sort((a, b) => a.t - b.t || a.n - b.n);
}

/** A note kept inside the tape and MIDI's range: t ≥ 0, d ≥ NOTE_MIN, n 0..127, v 0.01..1, ends by `length` when the tape has one. */
export function clampNote(n: ArrNote, length: number): ArrNote {
  const max = length > 0 ? length : Infinity;
  const t = Math.max(0, Math.min(Number.isFinite(max) ? Math.max(0, max - NOTE_MIN) : n.t, n.t));
  const d = Math.max(NOTE_MIN, Math.min(Number.isFinite(max) ? max - t : n.d, n.d));
  const out: ArrNote = { t: Math.round(t * 1e4) / 1e4, n: Math.max(0, Math.min(127, Math.round(n.n))), v: Math.max(0.01, Math.min(1, n.v)), d: Math.round(d * 1e4) / 1e4 };
  if (n.off) out.off = true;
  return out;
}

/** The track with its clips extended to cover [t, t+d] (a note moved or added outside every clip would be silent). */
function coverNote(track: ArrTrack, note: ArrNote, length: number): ArrTrack {
  const clips = trackClips(track, length);
  if (clips.some(c => note.t >= c.t - 1e-6 && note.t + note.d <= c.t + c.d + 1e-6)) return track;
  return { ...track, clips: clipsWithPass(clips, note.t, note.t + note.d) };
}

/** Add a note (sorted in; the clip grows to cover it). Returns the arrangement and the note's index. */
/** The tape grown to hold a note (edits never squash a note against the tape's end; the tape's cap still holds). */
function lengthFor(arr: PlayArrangement, n: ArrNote): number {
  return Math.min(TAPE_MAX_SECONDS, Math.max(arr.length, n.t + n.d));
}

export function addNote(arr: PlayArrangement, rack: string, note: ArrNote): { arr: PlayArrangement; index: number } {
  const t = arr.tracks[rack] ?? emptyTrack();
  const n = clampNote(note, TAPE_MAX_SECONDS);
  const length = lengthFor(arr, n);
  const notes = sortNotes([...t.notes, n]);
  const track = coverNote({ ...t, notes }, n, length);
  return { arr: { ...arr, length, tracks: { ...arr.tracks, [rack]: track } }, index: notes.indexOf(n) };
}

/** Change a note (time, pitch, length, velocity). Returns the arrangement and the note's new index (notes stay sorted). */
export function patchNote(arr: PlayArrangement, rack: string, index: number, over: Partial<ArrNote>): { arr: PlayArrangement; index: number } {
  const t = arr.tracks[rack];
  const old = t?.notes[index];
  if (!t || !old) return { arr, index };
  const n = clampNote({ ...old, ...over }, TAPE_MAX_SECONDS);
  const length = lengthFor(arr, n);
  const notes = sortNotes(t.notes.map((x, i) => (i === index ? n : x)));
  const track = coverNote({ ...t, notes }, n, length);
  return { arr: { ...arr, length, tracks: { ...arr.tracks, [rack]: track } }, index: notes.indexOf(n) };
}

/**
 * A track's notes replaced (the piano roll's operations, play/pianoRoll.ts):
 * each kept in range, sorted, and the tape grown to hold them. A note outside
 * every clip grows clip `grow` to cover it (the clip open in the piano roll,
 * joining any clip it reaches), or without one gets a clip of its own.
 * `index[i]` is where `notes[i]` went.
 */
export function setTrackNotes(arr: PlayArrangement, rack: string, notes: readonly ArrNote[], grow?: number): { arr: PlayArrangement; index: number[] } {
  const t = arr.tracks[rack] ?? emptyTrack();
  const clamped = notes.slice(0, ARR_NOTES_MAX).map(n => clampNote(n, TAPE_MAX_SECONDS));
  const order = clamped.map((_, i) => i).sort((a, b) => clamped[a].t - clamped[b].t || clamped[a].n - clamped[b].n || a - b);
  const index: number[] = new Array(notes.length).fill(-1);
  order.forEach((from, to) => { index[from] = to; });
  const sorted = order.map(i => clamped[i]);
  let length = arr.length;
  for (const n of sorted) length = Math.min(TAPE_MAX_SECONDS, Math.max(length, n.t + n.d));
  // The clips as they were, written down, so an edit doesn't change how they're worked out.
  let clips = trackClips(t, arr.length);
  const covered = (n: ArrNote) => clips.some(c => n.t >= c.t - 1e-6 && n.t + n.d <= c.t + c.d + 1e-6);
  const open = grow !== undefined ? clips[grow] : undefined;
  if (open) {
    let a = open.t, b = open.t + open.d;
    for (const n of sorted) if (!covered(n)) { a = Math.min(a, n.t); b = Math.max(b, n.t + n.d); }
    if (a < open.t || b > open.t + open.d) clips = clipsWithPass(clips, round6(a), round6(b));
  }
  let track: ArrTrack = { ...t, clips, notes: sorted };
  for (const n of sorted) track = coverNote(track, n, length);
  return { arr: { ...arr, length, tracks: { ...arr.tracks, [rack]: track } }, index };
}

/** Remove a note. */
export function deleteNote(arr: PlayArrangement, rack: string, index: number): PlayArrangement {
  const t = arr.tracks[rack];
  if (!t || !t.notes[index]) return arr;
  return { ...arr, tracks: { ...arr.tracks, [rack]: { ...t, notes: t.notes.filter((_, i) => i !== index) } } };
}

/** The pitch range a lane draws: the track's own notes, at least an octave, centred when narrow. */
export function notePitchRange(notes: readonly ArrNote[]): { lo: number; hi: number } {
  let lo = 127, hi = 0;
  for (const n of notes) { if (n.n < lo) lo = n.n; if (n.n > hi) hi = n.n; }
  if (lo > hi) return { lo: 48, hi: 72 };
  if (hi - lo < 12) { const c = (lo + hi) / 2; lo = Math.max(0, Math.min(115, Math.round(c - 6))); hi = lo + 12; }
  return { lo, hi };
}

export function setClipMute(arr: PlayArrangement, rack: string, index: number, mute: boolean): PlayArrangement {
  const t = withClips(arr, rack);
  if (!t || !t.clips[index]) return arr;
  const clips = t.clips.map((x, i) => {
    if (i !== index) return x;
    const y: ArrClip = { t: x.t, d: x.d };
    if (mute) y.mute = true;
    return y;
  });
  return { ...arr, tracks: { ...arr.tracks, [rack]: { ...t, clips } } };
}

/** How far a clip's ends can go: from the clip before it (or 0) to the one after it (or the tape's end). */
export function clipBounds(arr: PlayArrangement, rack: string, index: number): { min: number; max: number } | null {
  const clips = trackClips(arr.tracks[rack], arr.length);
  const c = clips[index];
  if (!c) return null;
  const prev = clips[index - 1], next = clips[index + 1];
  return { min: prev ? prev.t + prev.d : 0, max: next ? next.t : Math.max(arr.length, c.t + c.d) };
}

/**
 * A clip's ends moved to [from, to] (kept inside clipBounds, at least
 * CLIP_MIN long). What the trim leaves outside goes: notes starting there,
 * moves there; a note sounding past the new end is cut at it.
 */
export function trimClip(arr: PlayArrangement, rack: string, index: number, from: number, to: number): PlayArrangement {
  const t = withClips(arr, rack);
  const c = t?.clips[index];
  const b = clipBounds(arr, rack, index);
  if (!t || !c || !b) return arr;
  const e = round6(Math.min(b.max, Math.max(to, Math.min(b.max, from + CLIP_MIN))));
  const a = round6(Math.max(b.min, Math.min(from, e - CLIP_MIN)));
  const next: ArrClip = { ...c, t: a, d: round6(e - a) };
  const cut = (x: number, closed = false) => inClip(x, c, closed) && !inClip(x, next, closed);
  const notes: ArrNote[] = [];
  for (const n of t.notes) {
    if (cut(n.t)) continue;
    notes.push(inClip(n.t, next) && n.t + n.d > e ? { ...n, d: round6(Math.max(NOTE_MIN, e - n.t)) } : n);
  }
  const auto: Record<string, number[]> = {};
  for (const [k, pts] of Object.entries(t.auto)) {
    const kept: number[] = [];
    for (let i = 0; i < pts.length; i += 2) if (!cut(pts[i], true)) kept.push(pts[i], pts[i + 1]);
    if (kept.length) auto[k] = kept;
  }
  return { ...arr, tracks: { ...arr.tracks, [rack]: { ...t, notes, auto, clips: t.clips.map((x, i) => (i === index ? next : x)) } } };
}

const audibleCache = new WeakMap<PlayArrangement, PlayArrangement>();

/** The tape as it plays: each track without what its muted clips hold (the same object when no clip is muted). */
export function audibleArrangement(arr: PlayArrangement): PlayArrangement {
  const hit = audibleCache.get(arr);
  if (hit) return hit;
  let tracks: Record<string, ArrTrack> | null = null;
  for (const [id, t] of Object.entries(arr.tracks)) {
    const muted = (t.clips ?? []).filter(c => c.mute);
    // Deactivated notes (the piano roll's 0) don't play either.
    if (!muted.length && !t.notes.some(n => n.off)) continue;
    const off = (x: number, closed = false) => muted.some(c => inClip(x, c, closed));
    const auto: Record<string, number[]> = {};
    for (const [k, pts] of Object.entries(t.auto)) {
      const kept: number[] = [];
      for (let i = 0; i < pts.length; i += 2) if (!off(pts[i], true)) kept.push(pts[i], pts[i + 1]);
      if (kept.length) auto[k] = kept;
    }
    tracks ??= { ...arr.tracks };
    tracks[id] = { ...t, notes: t.notes.filter(n => !n.off && !off(n.t)), auto };
  }
  const out = tracks ? { ...arr, tracks } : arr;
  audibleCache.set(arr, out);
  return out;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const AU_TARGET = /^(au:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}::\d{1,20}|macro:[A-Za-z0-9_-]{1,64}::[1-8])$/;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function round6(v: number): number { return Math.round(v * 1e6) / 1e6 + 0; }
function round3(v: number): number { return Math.round(v * 1e3) / 1e3; }

function parseNotes(raw: unknown): ArrNote[] {
  const out: ArrNote[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= ARR_NOTES_MAX) break;
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (!fin(o.t) || !fin(o.n) || o.t < 0 || o.t > TAPE_MAX_SECONDS + 1) continue;
    const note: ArrNote = { t: o.t, n: Math.round(clamp(o.n, 0, 127)), v: fin(o.v) ? clamp(o.v, 0.01, 1) : 1, d: fin(o.d) ? clamp(o.d, NOTE_MIN, TAPE_MAX_SECONDS + 1) : 0.25 };
    if (o.off === true) note.off = true;
    out.push(note);
  }
  return out.sort((a, b) => a.t - b.t);
}

function parseAuto(raw: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 64 || !AU_TARGET.test(k) || !Array.isArray(v)) continue;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < v.length && pts.length < ARR_POINTS_MAX; i += 2) {
      const t = v[i], x = v[i + 1];
      if (fin(t) && fin(x) && t >= 0 && t <= TAPE_MAX_SECONDS + 1) pts.push([t, x]);
    }
    if (!pts.length) continue;
    pts.sort((a, b) => a[0] - b[0]);
    out[k] = pts.flat();
    n++;
  }
  return out;
}

function parseClips(raw: unknown): ArrClip[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const spans: ArrClip[] = [];
  for (const x of raw) {
    if (spans.length >= 256 || !x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (!fin(o.t) || !fin(o.d) || o.t < 0 || o.d <= 0 || o.t > TAPE_MAX_SECONDS) continue;
    const c: ArrClip = { t: o.t, d: Math.min(o.d, TAPE_MAX_SECONDS + 1 - o.t) };
    if (o.mute === true) c.mute = true;
    spans.push(c);
  }
  spans.sort((a, b) => a.t - b.t);
  // Overlapping clips (a hand-edited file) are cut where the next one starts.
  const out: ArrClip[] = [];
  for (const c of spans) {
    const last = out[out.length - 1];
    if (last && last.t + last.d > c.t) { if (c.t - last.t < 1e-6) continue; last.d = c.t - last.t; }
    out.push(c);
  }
  return out;
}

/** The tape from a file, or undefined when it has nothing (no length, no material). */
export function parseArrangement(raw: unknown): PlayArrangement | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const tracks: Record<string, ArrTrack> = {};
  if (o.tracks && typeof o.tracks === 'object') {
    let n = 0;
    for (const [id, t] of Object.entries(o.tracks as Record<string, unknown>)) {
      if (n >= 16 || !ID.test(id) || !t || typeof t !== 'object') continue;
      const x = t as Record<string, unknown>;
      const track: ArrTrack = { notes: parseNotes(x.notes), auto: parseAuto(x.auto), arm: x.arm !== false };
      if (x.mute === true) track.mute = true;
      if (x.solo === true) track.solo = true;
      if (x.show === 'audio') track.show = 'audio';
      const clips = parseClips(x.clips);
      if (clips) track.clips = clips;
      tracks[id] = track;
      n++;
    }
  }
  const countIn = (COUNT_INS as readonly number[]).includes(o.countIn as number) ? o.countIn as CountIn : 0;
  const out: PlayArrangement = {
    length: fin(o.length) ? round3(clamp(o.length, 0, TAPE_MAX_SECONDS)) : 0,
    loop: o.loop !== false,
    bpm: fin(o.bpm) ? clamp(o.bpm, 20, 300) : 120,
    metronome: o.metronome === true,
    countIn,
    fade: fin(o.fade) ? Math.round(clamp(o.fade, 0, FADE_MAX_MS)) : 0,
    tracks,
  };
  if (o.scale && typeof o.scale === 'object') {
    const sc = o.scale as Record<string, unknown>;
    out.scale = { on: sc.on === true, root: fin(sc.root) ? Math.round(clamp(sc.root, 0, 11)) : 0, name: typeof sc.name === 'string' && /^[A-Za-z0-9]{1,24}$/.test(sc.name) ? sc.name : 'major' };
  }
  // A tape recorded before a length existed (an old file): the length follows its material.
  if (!out.length) {
    let end = 0;
    for (const t of Object.values(tracks)) {
      for (const n of t.notes) end = Math.max(end, n.t + n.d);
      for (const p of Object.values(t.auto)) end = Math.max(end, p[p.length - 2] ?? 0);
    }
    out.length = round3(Math.min(TAPE_MAX_SECONDS, end));
  }
  return out;
}

/** A clock source's tempo in the record's mappings (the Clock (BPM) source), else 120. */
export function recordBpm(mappings: ReadonlyArray<{ source: { kind: string; bpm?: unknown } }>): number {
  for (const m of mappings) if (m.source.kind === 'clock' && fin(m.source.bpm)) return clamp(m.source.bpm, 20, 300);
  return 120;
}
