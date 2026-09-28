/**
 * tapeTake.ts — the tape as a take (docs/arrangement.md, "Takes and the
 * tape"): each audible track's notes as `ae:<rack>` pad events (on with its
 * velocity, off at its end) and each rack control's automation as a control
 * track, from the tape's 0 for its length. The render and export path plays
 * takes, so a take made this way renders the tape offline, sample-exactly:
 * the native replay for Audio Unit and sample player racks (engineRender.ts
 * jobNotes / jobParams), the kit's grain engine for a Granulator
 * (recordingAudio.ts renderGrains). The live replay's notes are the same
 * events at the same seconds (lib/tape.ts sends noteEvents).
 *
 * Pure.
 */
import type { PlayRecord, PlayTake, TakeEvent, TakeTrack } from '../types/play';
import { TAKE_MAX_EVENTS } from '../types/play';
import { audibleArrangement, audibleTracks, noteEvents, type PlayArrangement } from '../types/playArrangement';
import { RACK_ACT_PREFIX, parseAuTarget } from '../types/playAudioEngine';
import { encodeKeys } from './takePlayback';

/** The tape's notes, per event, as a take's pad events for `racks` (default: the audible ones), `loops` times round. */
export function tapeEvents(arr: PlayArrangement, racks = audibleTracks(arr), loops = 1): TakeEvent[] {
  const out: TakeEvent[] = [];
  const L = arr.length;
  if (!(L > 0)) return out;
  for (let k = 0; k < Math.max(1, loops); k++) {
    for (const id of racks) {
      const tr = arr.tracks[id];
      if (!tr) continue;
      for (const e of noteEvents(tr, -1e-9, L, L)) {
        out.push({ t: round6(k * L + e.t), do: 'pad', layerId: `${RACK_ACT_PREFIX}${id}`, amount: e.n + 1, vel: e.on ? e.v : 0 });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t || (a.vel ?? 1) - (b.vel ?? 1)).slice(0, TAKE_MAX_EVENTS);
}

/** Rack control automation as take control tracks (by the control on each target; targets without one are left out). */
export function tapeControlTracks(play: Pick<PlayRecord, 'controls'>, arr: PlayArrangement, racks = audibleTracks(arr), loops = 1): TakeTrack[] {
  const out: TakeTrack[] = [];
  const L = arr.length;
  for (const id of racks) {
    for (const [target, pts] of Object.entries(arr.tracks[id]?.auto ?? {})) {
      const c = play.controls.find(x => x.target === target);
      if (!c || !parseAuTarget(target) || pts.length < 2) continue;
      const times: number[] = [], values: number[] = [];
      for (let k = 0; k < Math.max(1, loops); k++) {
        for (let i = 0; i < pts.length; i += 2) {
          if (pts[i] > L) break;
          const t = k * L + pts[i];
          if (times.length && t <= times[times.length - 1]) continue;
          times.push(t); values.push(pts[i + 1]);
        }
      }
      out.push({ kind: 'control', id: c.id, target, label: c.label, width: 1, keys: encodeKeys(times, values, 1, false, 0.25) });
    }
  }
  return out;
}

/**
 * A take of the tape played from its top `loops` times (at most a minute),
 * starting at graph-clock time `from`. Null when the tape has nothing.
 */
export function arrangementTake(play: Pick<PlayRecord, 'controls' | 'arrangement'>, name: string, opts: { from?: number; loops?: number; id?: string } = {}): PlayTake | null {
  // Muted clips are left out, as on playback.
  const arr = play.arrangement && audibleArrangement(play.arrangement);
  if (!arr || !(arr.length > 0)) return null;
  const loops = Math.max(1, Math.min(Math.floor(60 / arr.length) || 1, Math.round(opts.loops ?? 1)));
  const length = Math.min(60, arr.length * loops);
  const events = tapeEvents(arr, undefined, loops).filter(e => e.t <= length);
  const tracks = tapeControlTracks(play, arr, undefined, loops);
  if (!events.length && !tracks.length) return null;
  return {
    id: opts.id ?? `take-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    name, from: opts.from ?? 0, length, tracks, events,
    tape: { at: 0, made: true },
  };
}

function round6(v: number): number { return Math.round(v * 1e6) / 1e6 + 0; }
