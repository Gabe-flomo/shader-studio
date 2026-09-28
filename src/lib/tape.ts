/**
 * tape.ts — the Audio engine's tape running (docs/arrangement.md): the
 * transport (play, stop, record, punch-in with a count-in, loop), playback of
 * each rack's track through its instrument, the rack controls' automation,
 * and recording what's played into the racks.
 *
 * Playback sends each track's notes into its rack the way a controller would
 * (audioEngineHost.input, marked as the tape's so it isn't recorded again),
 * so the sound, the readers, the picture's pad actions, mappings and a take
 * recording meanwhile all see it. Automation sets the rack controls' values
 * as the Play engine's overrides (like a take playing back).
 *
 * Recording listens to the host's live input (MIDI, the computer keyboard,
 * the card's keys) and samples the rack controls every tick. A control counts
 * as touched while its value moves (by hand on the strip, or a mapped knob)
 * and TOUCH_HOLD after; only touched spans (and, overdubbing, the spans where
 * notes were played) replace what was on the tape (playArrangement.ts
 * mergePass). While recording, the tape doesn't loop: it runs on past the
 * end, extending the tape, until TAPE_MAX_SECONDS.
 *
 * Each recording is one undo step. Transport ticks never touch React: the
 * store changes only on phase and count changes; lanes read `position()` on
 * their own animation frame while the tape runs.
 */
import { create } from 'zustand';
import type { PlayRecord } from '../types/play';
import {
  TAPE_MAX_SECONDS, TOUCH_HOLD, NOTE_MIN, applyPasses, audibleTracks, autoAt, beatsIn, emptyArrangement, noteEvents, punchIn, recordBpm, tapePosition, tapeSpans,
  type ArrNote, type ArrPass, type PlayArrangement,
} from '../types/playArrangement';
import { aeRack, auPropId, parseAuTarget, readAuValue } from '../types/playAudioEngine';
import { rackControlTargets } from '../play/rackControls';
import { keepIndices } from './takePlayback';

export type TapePhase = 'stopped' | 'playing' | 'counting' | 'recording';
export type RecordMode = 'overdub' | 'replace';

export interface TapeUi {
  phase: TapePhase;
  /** Beats left to count in (shown big), 0 when not counting. */
  count: number;
  /** Where Play and Record start (tape seconds): "Record from here". */
  point: number;
  /** A track to re-record on its own (a rack id), or ''. */
  selected: string;
  /** How recording onto the selected track works. */
  mode: RecordMode;
}

export const useTape = create<TapeUi>(() => ({ phase: 'stopped', count: 0, point: 0, selected: '', mode: 'overdub' }));

/** What the tape needs from the app (tests give fakes). */
export interface TapeDeps {
  /** ms. */
  now(): number;
  play(): PlayRecord;
  /** An undoable edit with this label. */
  commit(fn: (p: PlayRecord) => PlayRecord, label: string): void;
  /** A note (or all notes off) into a rack, as the tape's. */
  send(rack: string, bytes: number[]): void;
  /** A rack control's value from the tape (null lets go). */
  override(propId: string, key: string, value: number | null): void;
  /** What a mapping drives a rack control to right now, without the tape (undefined: not driven). */
  driven(propId: string, key: string): number | undefined;
  /** The metronome's click (only called when the metronome is on). */
  click(accent: boolean): void;
  notice(title: string, message?: string): void;
  /** Run `fn` every few ms until the returned stop is called. */
  every(fn: () => void): () => void;
  /** Live notes into racks. */
  onInput(fn: (rack: string, bytes: number[]) => void): () => void;
  /** Tracks that changed (their previews redraw). */
  recorded?(racks: string[]): void;
}

interface AutoCapture { rack: string; pts: number[]; prev: number | undefined; touched: Array<[number, number]>; until: number }

interface Capture {
  point: number;
  racks: string[];
  mode: RecordMode;
  /** Count-in beats not clicked yet (tape seconds). */
  beats: number[];
  started: boolean;
  notes: Map<string, ArrNote[]>;
  open: Map<string, Map<number, { t: number; v: number }>>;
  auto: Map<string, AutoCapture>;
  lastSample: number;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** A control's samples with only the points its shape needs (within 0.2% of its range), as takes keep theirs. */
function thin(flat: number[]): number[] {
  const times: number[] = [], values: number[] = [];
  for (let i = 0; i < flat.length; i += 2) { times.push(flat[i]); values.push(flat[i + 1]); }
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const keep = keepIndices(times, values, 1, Math.max(1e-6, (hi - lo) * 0.002));
  return keep.flatMap(i => [times[i], values[i]]);
}

export class Tape {
  private deps: TapeDeps | null = null;
  private startWall = 0;
  private startPos = 0;
  private last = 0;
  private stopLoop: (() => void) | null = null;
  private offInput: (() => void) | null = null;
  /** Notes the tape has sounding, per rack. */
  private held = new Map<string, Set<number>>();
  /** Rack controls the tape holds (`propId\0key`). */
  private overridden = new Set<string>();
  private rec: Capture | null = null;
  /** The transport runs for a take's recording (lib/takes.ts): it stops with the take. */
  forTake = false;

  configure(deps: TapeDeps): void { this.deps = deps; }

  private get d(): TapeDeps {
    if (!this.deps) throw new Error('The tape isn’t wired');
    return this.deps;
  }

  private arr(p = this.d.play()): PlayArrangement {
    return p.arrangement ?? emptyArrangement(recordBpm(p.mappings));
  }

  /** Transport time: tape seconds, unwrapped (negative during a pre-roll). */
  private pos(): number { return this.startPos + (this.d.now() - this.startWall) / 1000; }

  private looping(a: PlayArrangement): boolean { return a.loop && a.length > 0 && !this.rec; }

  running(): boolean { return this.stopLoop !== null; }

  /** Where the tape is now (tape seconds; past the end while a recording extends it). */
  position(): number {
    if (!this.running()) return useTape.getState().point;
    const a = this.arr();
    return tapePosition(this.pos(), a.length, this.looping(a));
  }

  /** The tape's length as the ruler shows it: a recording running past the end stretches it. */
  shownLength(): number {
    const a = this.arr();
    return this.rec && this.running() ? Math.max(a.length, Math.min(TAPE_MAX_SECONDS, this.pos())) : a.length;
  }

  private start(from: number): void {
    this.startWall = this.d.now();
    this.startPos = from;
    // Due is (last, now]: a note right at the start plays on the first tick.
    this.last = from - 1e-9;
    if (!this.stopLoop) this.stopLoop = this.d.every(() => this.tick());
    if (!this.offInput) this.offInput = this.d.onInput((rack, bytes) => this.onInput(rack, bytes));
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  /** Play from the record point (from the top when it's at the end). */
  play(): void {
    const st = useTape.getState();
    if (st.phase !== 'stopped') return;
    const a = this.arr();
    if (!(a.length > 0)) { this.d.notice('Nothing on the tape yet', 'Press Record and play a rack: the first recording sets the tape’s length.'); return; }
    this.start(st.point >= a.length - 0.01 ? 0 : Math.max(0, st.point));
    useTape.setState({ phase: 'playing' });
  }

  /** Play from `at` (a take recording along with the tape). */
  playFrom(at: number): void {
    if (useTape.getState().phase !== 'stopped') this.stop();
    useTape.setState({ point: Math.max(0, at) });
    this.play();
  }

  /**
   * Record: stopped, a count-in (if set) pre-rolls to the record point and
   * recording starts there; playing, it punches in where the tape is. While
   * recording (or counting), it stops.
   */
  record(): void {
    const st = useTape.getState();
    if (st.phase === 'recording' || st.phase === 'counting') { this.stop(); return; }
    const p = this.d.play();
    const a = this.arr(p);
    const racks = this.recordingRacks(p, st.selected);
    if (!racks.length) {
      this.d.notice(p.audioEngine?.racks.length ? 'No track is armed' : 'Add a rack first', p.audioEngine?.racks.length ? 'Arm a track (the circle on its lane), or select one to record it on its own.' : 'The tape records what you play into the racks.');
      return;
    }
    const mode: RecordMode = st.selected ? st.mode : 'overdub';
    if (st.phase === 'playing') {
      // Punch in where the tape is: the transport carries on from here without looping.
      const at = this.position();
      this.startWall = this.d.now();
      this.startPos = at;
      this.last = at;
      this.rec = this.capture(p, at, racks, mode, [], true);
      useTape.setState({ phase: 'recording', count: 0 });
      return;
    }
    const point = a.length > 0 ? Math.max(0, Math.min(a.length, st.point)) : 0;
    const { start, beats } = punchIn(point, a.countIn, a.bpm);
    this.rec = this.capture(p, point, racks, mode, beats, beats.length === 0);
    this.start(start);
    useTape.setState({ phase: beats.length ? 'counting' : 'recording', count: beats.length, point });
  }

  /** Stop (keeping a recording in progress as one undo step). */
  stop(): void {
    const st = useTape.getState();
    if (st.phase === 'stopped' && !this.running()) return;
    const at = this.running() ? this.pos() : 0;
    const rec = this.rec;
    this.rec = null;
    this.stopLoop?.(); this.stopLoop = null;
    this.offInput?.(); this.offInput = null;
    this.releaseAll();
    this.releaseOverrides(new Set());
    this.forTake = false;
    useTape.setState({ phase: 'stopped', count: 0 });
    if (rec?.started) this.finish(rec, Math.min(TAPE_MAX_SECONDS, at));
  }

  /** Move the record point (and the playback there, if playing). */
  setPoint(t: number): void {
    const a = this.arr();
    const point = Math.max(0, Math.min(a.length || 0, t));
    useTape.setState({ point });
    if (useTape.getState().phase === 'playing') {
      this.releaseAll();
      this.startWall = this.d.now();
      this.startPos = point;
      this.last = point - 1e-9;
    }
  }

  /** The racks a recording writes: the selected track alone, else every armed rack that exists. */
  recordingRacks(p: PlayRecord, selected = useTape.getState().selected): string[] {
    const racks = (p.audioEngine?.racks ?? []).filter(r => r.instrument || r.source);
    if (selected) return racks.some(r => r.id === selected) ? [selected] : [];
    return racks.filter(r => p.arrangement?.tracks[r.id]?.arm !== false).map(r => r.id);
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  private capture(p: PlayRecord, point: number, racks: string[], mode: RecordMode, beats: number[], started: boolean): Capture {
    const auto = new Map<string, AutoCapture>();
    for (const id of racks) {
      const rack = aeRack(p.audioEngine, id);
      if (!rack) continue;
      for (const target of rackControlTargets(p, rack)) auto.set(target, { rack: id, pts: [], prev: undefined, touched: [], until: -Infinity });
    }
    return { point, racks, mode, beats: [...beats], started, notes: new Map(racks.map(r => [r, []])), open: new Map(racks.map(r => [r, new Map()])), auto, lastSample: point };
  }

  private onInput(rack: string, bytes: number[]): void {
    const rec = this.rec;
    if (!rec?.started || !rec.racks.includes(rack)) return;
    const kind = bytes[0] & 0xf0;
    if (kind !== 0x90 && kind !== 0x80) return;
    const t = this.pos();
    if (t < rec.point) return;
    const open = rec.open.get(rack)!;
    const n = bytes[1] ?? 0;
    const close = () => {
      const o = open.get(n);
      if (!o) return;
      open.delete(n);
      rec.notes.get(rack)!.push({ t: round6(o.t), n, v: o.v, d: round6(Math.max(NOTE_MIN, t - o.t)) });
    };
    if (kind === 0x90 && (bytes[2] ?? 0) > 0) { close(); open.set(n, { t, v: Math.max(0.01, Math.min(1, (bytes[2] ?? 100) / 127)) }); }
    else close();
  }

  /** Each rack control's value as the performer sets it (by hand, or a mapped knob), without the tape. */
  private userValue(p: PlayRecord, target: string): number | undefined {
    const t = parseAuTarget(target);
    if (!t) return undefined;
    return this.d.driven(auPropId(t.rackId, t.slotId), t.address) ?? readAuValue(p.audioEngine, target);
  }

  private sample(now: number, p: PlayRecord): void {
    const rec = this.rec!;
    for (const [target, c] of rec.auto) {
      const v = this.userValue(p, target);
      if (v === undefined) continue;
      if (c.prev !== undefined && Math.abs(v - c.prev) > 1e-9) {
        const last = c.touched[c.touched.length - 1];
        if (last && c.until >= rec.lastSample) last[1] = now + TOUCH_HOLD;
        else c.touched.push([Math.max(rec.point, rec.lastSample), now + TOUCH_HOLD]);
        c.until = now + TOUCH_HOLD;
      }
      c.prev = v;
      // Kept at up to 60 a second (a move's first sample always), thinned again on stop.
      const n = c.pts.length;
      if (n >= 2 && now - c.pts[n - 2] < 1 / 60 && c.until < now) continue;
      c.pts.push(round6(now), v);
    }
    rec.lastSample = now;
  }

  private finish(rec: Capture, stoppedAt: number): void {
    const p = this.d.play();
    const to = Math.max(rec.point, stoppedAt);
    const passes: ArrPass[] = [];
    for (const rack of rec.racks) {
      const notes = [...rec.notes.get(rack)!];
      for (const [n, o] of rec.open.get(rack)!) notes.push({ t: round6(o.t), n, v: o.v, d: round6(Math.max(NOTE_MIN, to - o.t)) });
      notes.sort((x, y) => x.t - y.t);
      const auto: Record<string, number[]> = {}, touched: Record<string, Array<[number, number]>> = {};
      for (const [target, c] of rec.auto) {
        if (c.rack !== rack || !c.pts.length) continue;
        auto[target] = thin(c.pts);
        if (c.touched.length) touched[target] = c.touched.map(([a, b]) => [a, Math.min(b, to)] as [number, number]);
      }
      if (rec.mode === 'overdub' && !notes.length && !Object.keys(touched).length) continue;
      passes.push({ rack, from: rec.point, to, notes, auto, touched, mode: rec.mode });
    }
    const a = this.arr(p);
    const grows = to > a.length + 0.01;
    if (!passes.length && !(grows && a.length > 0)) {
      this.d.notice('Nothing was recorded', 'Play notes into a rack (MIDI, the computer keyboard, its keys) or move a rack control while recording.');
      return;
    }
    const names = passes.map(x => aeRack(p.audioEngine, x.rack)?.name ?? 'a rack');
    const label = passes.length === 1 ? `Recorded ${names[0]} on the tape` : passes.length ? 'Recorded on the tape' : 'Extended the tape';
    this.d.commit(q => ({ ...q, arrangement: applyPasses(q.arrangement ?? emptyArrangement(recordBpm(q.mappings)), passes, { stoppedAt: to }) }), label);
    this.d.recorded?.(passes.map(x => x.rack));
  }

  // ── Every tick ────────────────────────────────────────────────────────────

  /** One transport step (the loop calls it every few ms; tests call it by hand). */
  tick(): void {
    if (!this.running()) return;
    const p = this.d.play();
    const a = this.arr(p);
    const now = this.pos();
    const rec = this.rec;
    if (rec && now >= TAPE_MAX_SECONDS) {
      this.stop();
      this.d.notice(`The tape is full at ${TAPE_MAX_SECONDS} s for now`, 'The recording stopped there and was kept.');
      return;
    }
    const looping = this.looping(a);
    const { spans, wrapped } = tapeSpans(this.last, now, a.length, looping);
    if (wrapped) this.releaseAll();
    const racks = new Set((p.audioEngine?.racks ?? []).map(r => r.id));
    const ids = audibleTracks(a).filter(id => racks.has(id));
    if (rec && !rec.started && now >= rec.point) {
      rec.started = true;
      rec.lastSample = rec.point;
      useTape.setState({ phase: 'recording', count: 0 });
    }
    const beat = 60 / a.bpm;
    for (const [s, e] of spans) {
      if (rec?.beats.length) {
        // The count-in: its beats click (with the metronome on) and count down on screen.
        const due = rec.beats.filter(b => b > s && b <= e + 1e-9);
        if (due.length) {
          rec.beats = rec.beats.filter(b => !due.includes(b));
          if (a.metronome) for (const b of due) this.d.click(Math.round((rec.point - b) / beat) % 4 === 0);
          if (!rec.started) useTape.setState({ count: rec.beats.length });
        }
      }
      if (a.metronome) {
        // The metronome on the tempo's grid (during a count-in, from the record point on).
        for (const b of beatsIn(s, e, a.bpm)) if (!rec || b >= rec.point - 1e-6) this.d.click(Math.round(b / beat) % 4 === 0);
      }
      if (e <= 0) continue;
      for (const id of ids) {
        if (this.replacing(id, Math.max(0, s))) { this.releaseRack(id); continue; }
        for (const ev of noteEvents(a.tracks[id], s, e, looping ? a.length : Infinity)) this.sendNote(id, ev.n, ev.on ? ev.v : 0);
      }
    }
    this.applyAuto(a, ids, tapePosition(now, a.length, looping), now);
    if (this.rec?.started) this.sample(now, p);
    this.last = now;
    // Played to the end without a loop: stop there.
    if (!this.rec && !looping && a.length > 0 && now >= a.length) {
      this.stop();
      useTape.setState({ point: 0 });
    }
  }

  /** Is this rack's old material being replaced at tape time `t` (re-recording it on its own)? */
  private replacing(rack: string, t: number): boolean {
    const rec = this.rec;
    return !!rec && rec.mode === 'replace' && rec.racks.includes(rack) && t >= rec.point - 1e-9;
  }

  private applyAuto(a: PlayArrangement, ids: readonly string[], at: number, now: number): void {
    const set = new Set<string>();
    for (const id of ids) {
      if (this.replacing(id, at)) continue;
      for (const [target, pts] of Object.entries(a.tracks[id].auto)) {
        // Touched while recording: the performer's value goes through.
        if ((this.rec?.auto.get(target)?.until ?? -Infinity) >= now) continue;
        const t = parseAuTarget(target), v = autoAt(pts, at);
        if (!t || v === undefined) continue;
        const key = `${auPropId(t.rackId, t.slotId)}\u0000${t.address}`;
        this.d.override(auPropId(t.rackId, t.slotId), t.address, v);
        set.add(key);
      }
    }
    this.releaseOverrides(set);
  }

  private releaseOverrides(keep: Set<string>): void {
    for (const k of this.overridden) {
      if (keep.has(k)) continue;
      const [id, key] = k.split('\u0000');
      this.d.override(id, key, null);
    }
    this.overridden = keep;
  }

  private sendNote(rack: string, n: number, v: number): void {
    const held = this.held.get(rack) ?? new Set<number>();
    if (v > 0) { held.add(n); this.d.send(rack, [0x90, n, Math.max(1, Math.min(127, Math.round(v * 127)))]); }
    else if (held.has(n)) { held.delete(n); this.d.send(rack, [0x80, n, 0]); }
    this.held.set(rack, held);
  }

  private releaseRack(rack: string): void {
    const held = this.held.get(rack);
    if (!held?.size) return;
    for (const n of held) this.d.send(rack, [0x80, n, 0]);
    held.clear();
  }

  private releaseAll(): void { for (const r of this.held.keys()) this.releaseRack(r); }

  // ── Track settings (not undo steps: they're how it plays, like a mixer) ───

  /** For tests: forget everything. */
  resetForTests(): void {
    this.stopLoop?.(); this.stopLoop = null;
    this.offInput?.(); this.offInput = null;
    this.rec = null; this.held.clear(); this.overridden.clear(); this.forTake = false;
    useTape.setState({ phase: 'stopped', count: 0, point: 0, selected: '', mode: 'overdub' });
  }
}

export const tape = new Tape();
