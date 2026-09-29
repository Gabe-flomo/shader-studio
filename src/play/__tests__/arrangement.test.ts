/**
 * The Audio engine's tape (types/playArrangement.ts, docs/arrangement.md):
 * the merge rules (overdub replaces only where new material was made, replace
 * the whole span), the tape's length (set by the first recording, extended
 * up to 60 s), punch-in count-in timing, loop wrap, the scheduling maths,
 * and parsing.
 */
import { describe, expect, it } from 'vitest';
import {
  TAPE_MAX_SECONDS, applyPasses, audibleTracks, autoAt, beatsIn, clearTrack, countInSeconds, emptyArrangement, fadeNotes, isArrangementEmpty,
  mergeAuto, mergeNotes, mergePass, noteEvents, noteSpans, parseArrangement, punchIn, recordBpm, tapePosition, tapeSpans, unionSpans,
  type ArrNote, type ArrPass, type ArrTrack, type PlayArrangement,
} from '../../types/playArrangement';
import { emptyPlayRecord, parsePlayRecord, parseTake, type PlayRecord } from '../../types/play';
import { withEngine } from '../../components/play/engine/engineOps';
import { playableForPlan } from '../planGates';
import { arrangementTake } from '../../lib/tapeTake';
import { trackAt } from '../../lib/takePlayback';
import { parseTouched } from '../../lib/paramWatch';

const T = 'au:rk1:inst::3';
const note = (t: number, n: number, d = 0.2, v = 0.8): ArrNote => ({ t, n, v, d });
const pass = (over: Partial<ArrPass>): ArrPass => ({ rack: 'rk1', from: 0, to: 4, notes: [], auto: {}, touched: {}, mode: 'overdub', ...over });
const track = (notes: ArrNote[], auto: Record<string, number[]> = {}): ArrTrack => ({ notes, auto, arm: true });

describe('overdub: only where new material was made', () => {
  it('keeps old notes outside the spans new notes cover, replaces inside', () => {
    const old = track([note(0.5, 60), note(1.5, 62), note(2.5, 64), note(3.5, 65)]);
    const out = mergePass(old, pass({ notes: [note(1.4, 70, 0.4)] }));
    // 1.5 starts inside [1.4, 1.8): replaced. The rest kept exactly.
    expect(out.notes.map(n => [n.t, n.n])).toEqual([[0.5, 60], [1.4, 70], [2.5, 64], [3.5, 65]]);
  });

  it('cuts an old note sounding into a new span where the span starts', () => {
    const out = mergeNotes([note(1, 60, 2)], [note(2, 72, 0.5)], noteSpans([note(2, 72, 0.5)]));
    expect(out).toEqual([{ t: 1, n: 60, v: 0.8, d: 1 }, note(2, 72, 0.5)]);
  });

  it('a pass with no notes leaves every note alone', () => {
    const old = track([note(0.5, 60), note(1.5, 62)]);
    expect(mergePass(old, pass({})).notes).toEqual(old.notes);
  });

  it('automation: only the touched spans change, the curve is pinned around them', () => {
    const old = track([], { [T]: [0, 0.2, 4, 0.2] });
    const out = mergePass(old, pass({ auto: { [T]: [0, 0.5, 1, 0.9, 1.5, 0.9, 2, 0.1, 3, 0.1] }, touched: { [T]: [[1, 2]] } }));
    const pts = out.auto[T];
    expect(autoAt(pts, 0.5)).toBeCloseTo(0.2);
    expect(autoAt(pts, 1)).toBeCloseTo(0.9);
    expect(autoAt(pts, 1.5)).toBeCloseTo(0.9);
    expect(autoAt(pts, 2)).toBeCloseTo(0.1);
    expect(autoAt(pts, 3)).toBeCloseTo(0.2);
    expect(autoAt(pts, 3.9)).toBeCloseTo(0.2);
  });

  it('an untouched control keeps its old automation (values sampled but not moved)', () => {
    const old = track([], { [T]: [0, 0.3, 4, 0.7] });
    const out = mergePass(old, pass({ auto: { [T]: [0, 0.5, 4, 0.5] }, touched: {} }));
    expect(out.auto[T]).toEqual([0, 0.3, 4, 0.7]);
  });

  it('a first automation pass takes the touched span only', () => {
    const out = mergeAuto(undefined, [0, 0.1, 1, 0.4, 2, 0.8, 3, 0.8], [[1, 2]]);
    expect(out).toEqual([1, 0.4, 2, 0.8]);
  });
});

describe('replace: the whole span from the record point', () => {
  it('replaces every note in [from, to] and keeps the rest', () => {
    const old = track([note(0.5, 60), note(1.5, 62), note(2.5, 64), note(3.5, 65)]);
    const out = mergePass(old, pass({ from: 1, to: 3, mode: 'replace', notes: [note(2, 50)] }));
    expect(out.notes.map(n => n.t)).toEqual([0.5, 2, 3.5]);
  });

  it('replaces automation over the span even where nothing moved', () => {
    const old = track([], { [T]: [0, 0.2, 4, 0.2] });
    const out = mergePass(old, pass({ from: 1, to: 3, mode: 'replace', auto: { [T]: [1, 0.6, 3, 0.6] } }));
    expect(autoAt(out.auto[T], 2)).toBeCloseTo(0.6);
    expect(autoAt(out.auto[T], 0.5)).toBeCloseTo(0.2);
    expect(autoAt(out.auto[T], 3.5)).toBeCloseTo(0.2);
  });

  it('per-track replace leaves other tracks as they were', () => {
    const arr: PlayArrangement = { ...emptyArrangement(), length: 4, tracks: { rk1: track([note(1, 60)]), rk2: track([note(1, 40)]) } };
    const out = applyPasses(arr, [pass({ rack: 'rk1', from: 0, to: 4, mode: 'replace', notes: [note(2, 61)] })], { stoppedAt: 4 });
    expect(out.tracks.rk1.notes.map(n => n.n)).toEqual([61]);
    expect(out.tracks.rk2).toBe(arr.tracks.rk2);
  });
});

describe('the tape length', () => {
  it('the first recording sets it', () => {
    const out = applyPasses(emptyArrangement(), [pass({ from: 0, to: 3.2, notes: [note(1, 60)] })], { stoppedAt: 3.2 });
    expect(out.length).toBe(3.2);
    expect(out.loop).toBe(true);
  });

  it('recording past the end extends it, up to 60 s', () => {
    const arr = { ...emptyArrangement(), length: 4 };
    expect(applyPasses(arr, [], { stoppedAt: 6.5 }).length).toBe(6.5);
    expect(applyPasses(arr, [], { stoppedAt: 3 }).length).toBe(4);
    expect(applyPasses(arr, [], { stoppedAt: 75 }).length).toBe(TAPE_MAX_SECONDS);
  });

  it('keeps loop off when it was turned off', () => {
    expect(applyPasses({ ...emptyArrangement(), length: 4, loop: false }, [], { stoppedAt: 5 }).loop).toBe(false);
  });
});

describe('count-in and metronome timing', () => {
  it('a 1-bar count-in at 120 bpm starts 2 s before the point, one beat every 0.5 s', () => {
    expect(countInSeconds(1, 120)).toBe(2);
    const p = punchIn(3, 1, 120);
    expect(p.start).toBe(1);
    expect(p.beats).toEqual([1, 1.5, 2, 2.5]);
  });

  it('2 and 4 bars; before the tape the pre-roll is negative (silence)', () => {
    expect(punchIn(1, 2, 120).start).toBe(-3);
    expect(punchIn(1, 2, 120).beats).toHaveLength(8);
    expect(punchIn(0, 4, 60).start).toBe(-16);
    expect(punchIn(2, 0, 120)).toEqual({ start: 2, beats: [] });
  });

  it('metronome beats sit on the tempo grid from the tape’s 0', () => {
    expect(beatsIn(-0.01, 1.5, 120)).toEqual([0, 0.5, 1, 1.5]);
    expect(beatsIn(0.1, 1.1, 90)).toEqual([0.666667]);
    expect(beatsIn(0.5, 0.9, 120)).toEqual([]);
  });
});

describe('loop wrap and scheduling', () => {
  it('a tick across the end wraps to the start', () => {
    expect(tapeSpans(3.9, 4.1, 4, true)).toEqual({ spans: [[3.9, 4], [-1e-9, expect.closeTo(0.1, 6)]], wrapped: true });
    expect(tapePosition(9, 4, true)).toBe(1);
  });

  it('without a loop the span runs past the end', () => {
    expect(tapeSpans(3.9, 4.1, 4, false)).toEqual({ spans: [[3.9, 4.1]], wrapped: false });
    expect(tapePosition(9, 4, false)).toBe(9);
  });

  it('a pre-roll counts down to 0 before playing', () => {
    expect(tapeSpans(-0.1, 0.1, 4, true).spans).toEqual([[-0.1, 0], [-1e-9, 0.1]]);
  });

  it('note ons and offs in a span; offs cut at the tape’s end', () => {
    const t = { notes: [note(0.5, 60, 0.3), note(3.9, 62, 0.5)] };
    expect(noteEvents(t, 0, 1)).toEqual([{ t: 0.5, n: 60, v: 0.8, on: true }, { t: 0.8, n: 60, v: 0, on: false }]);
    expect(noteEvents(t, 3.8, 4, 4).map(e => [e.t, e.on])).toEqual([[3.9, true], [4, false]]);
    expect(noteEvents(t, 0.5, 0.8)).toEqual([{ t: 0.8, n: 60, v: 0, on: false }]);
  });

  it('mute and solo', () => {
    const arr = { tracks: { a: track([]), b: { ...track([]), mute: true }, c: track([]) } };
    expect(audibleTracks(arr)).toEqual(['a', 'c']);
    expect(audibleTracks({ tracks: { ...arr.tracks, c: { ...track([]), solo: true } } })).toEqual(['c']);
  });
});

describe('fade in', () => {
  it('scales new notes’ velocity over the attack from the record point', () => {
    const out = fadeNotes([note(1, 60, 0.2, 1), note(1.1, 61, 0.2, 1), note(1.5, 62, 0.2, 1)], 1, 200);
    expect(out.map(n => n.v)).toEqual([0.01, 0.5, 1]);
    expect(fadeNotes([note(1, 60)], 1, 0)[0].v).toBe(0.8);
  });
});

describe('parsing', () => {
  it('round-trips a tape and drops what doesn’t parse', () => {
    const arr: PlayArrangement = { length: 4, loop: false, bpm: 96, metronome: true, countIn: 2, fade: 50, tracks: { rk1: { notes: [note(1, 60)], auto: { [T]: [0, 0.5, 1, 0.6] }, arm: false, mute: true } } };
    expect(parseArrangement(JSON.parse(JSON.stringify(arr)))).toEqual(arr);
    const bad = parseArrangement({ length: 999, countIn: 3, bpm: 'x', tracks: { 'no good!': {}, rk2: { notes: [{ t: -1, n: 60 }, { t: 1, n: 200 }], auto: { nope: [0, 1] } } } })!;
    expect(bad.length).toBe(TAPE_MAX_SECONDS);
    expect(bad.countIn).toBe(0);
    expect(bad.bpm).toBe(120);
    expect(Object.keys(bad.tracks)).toEqual(['rk2']);
    expect(bad.tracks.rk2.notes).toEqual([{ t: 1, n: 127, v: 1, d: 0.25 }]);
    expect(bad.tracks.rk2.auto).toEqual({});
    expect(bad.tracks.rk2.arm).toBe(true);
  });

  it('an old file without a length gets it from its material', () => {
    expect(parseArrangement({ tracks: { rk1: { notes: [{ t: 2, n: 60, d: 0.5 }] } } })!.length).toBe(2.5);
  });

  it('empty and cleared', () => {
    expect(isArrangementEmpty(undefined)).toBe(true);
    expect(isArrangementEmpty(emptyArrangement())).toBe(true);
    const arr = { ...emptyArrangement(), length: 2, tracks: { rk1: track([note(1, 60)]) } };
    expect(isArrangementEmpty(arr)).toBe(false);
    expect(clearTrack(arr, 'rk1').tracks.rk1.notes).toEqual([]);
  });

  it('the Clock source’s tempo', () => {
    expect(recordBpm([{ source: { kind: 'lfo' } }, { source: { kind: 'clock', bpm: 90 } }])).toBe(90);
    expect(recordBpm([])).toBe(120);
  });

  it('unionSpans joins overlaps', () => {
    expect(unionSpans([[2, 3], [0, 1], [0.5, 1.5]])).toEqual([[0, 1.5], [2, 3]]);
  });
});

describe('in the Play record', () => {
  const rack = (id: string) => ({ id, name: id, instrument: { id: 'inst', kind: 'granulator', sample: { synth: 'pad', name: 'Pad' } }, effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false });
  const tape = { length: 2, loop: true, bpm: 120, metronome: false, countIn: 0, fade: 0, tracks: { rk1: { notes: [{ t: 0.5, n: 60, v: 1, d: 0.2 }], auto: {}, arm: true }, rk2: { notes: [{ t: 1, n: 40, v: 1, d: 0.2 }], auto: {}, arm: true } } };

  it('parses with the record; a track for a rack the file lacks goes', () => {
    const p = parsePlayRecord({ ...emptyPlayRecord(), audioEngine: { racks: [rack('rk1')] }, arrangement: tape });
    expect(Object.keys(p.arrangement!.tracks)).toEqual(['rk1']);
    expect(p.arrangement!.length).toBe(2);
    expect(parsePlayRecord({ ...emptyPlayRecord(), arrangement: { tracks: {} } }).arrangement).toBeUndefined();
  });

  it('removing a rack takes its track; Free plays no tape', () => {
    const p = parsePlayRecord({ ...emptyPlayRecord(), audioEngine: { racks: [rack('rk1'), rack('rk2')] }, arrangement: tape });
    const out = withEngine(p, { racks: p.audioEngine!.racks.filter(r => r.id !== 'rk2') });
    expect(Object.keys(out.arrangement!.tracks)).toEqual(['rk1']);
    expect(playableForPlan(p, 'free').arrangement).toBeUndefined();
    expect(playableForPlan(p, 'pro').arrangement).toBe(p.arrangement);
  });

  it('a take keeps that the tape played along', () => {
    const take = { id: 't1', name: 'Take 1', from: 0, length: 2, tracks: [], events: [], tape: { at: 0, made: true } };
    expect(parseTake(take)!.tape).toEqual({ at: 0, made: true });
    expect(parseTake({ ...take, tape: { at: 'x' } })!.tape).toBeUndefined();
  });

  it('the tape as a take: its notes as pad events, its automation as control tracks', () => {
    const p = { controls: [{ id: 'c1', target: 'au:rk1:inst::1', kind: 'float', label: 'Position', min: 0, max: 1 }], arrangement: { ...tape, tracks: { ...tape.tracks, rk1: { ...tape.tracks.rk1, auto: { 'au:rk1:inst::1': [0, 0.2, 2, 0.8] } } } } } as unknown as PlayRecord;
    const take = arrangementTake(p, 'Tape 1', { loops: 2 })!;
    expect(take.length).toBe(4);
    expect(take.events.filter(e => (e.vel ?? 1) > 0).map(e => [e.t, e.layerId, e.amount])).toEqual([[0.5, 'ae:rk1', 61], [1, 'ae:rk2', 41], [2.5, 'ae:rk1', 61], [3, 'ae:rk2', 41]]);
    expect(take.tracks).toHaveLength(1);
    expect(trackAt(take.tracks[0], 1)).toBeCloseTo(0.5, 2);
    expect(parseTake(JSON.parse(JSON.stringify(take)))).toBeTruthy();
    expect(arrangementTake({ controls: [], arrangement: undefined }, 'x')).toBeNull();
  });
});

describe('touch to configure (Configure)', () => {
  it('reads the engine’s touched-parameter event', () => {
    const t = parseTouched({ rack: 'rk_1', slot: 'fx_2', first: true, param: { address: '12', identifier: 'cutoff', name: 'Cutoff', min: 10, max: 20000, value: 440, unit: 'Hz', kind: 'number', step: 0, log: true } });
    expect(t).toMatchObject({ rack: 'rk_1', slot: 'fx_2', first: true, param: { address: '12', name: 'Cutoff', value: 440, log: true } });
    expect(parseTouched({ rack: 'rk_1', slot: 'fx_2', param: { address: 'x', min: 0, max: 1, value: 0 } })).toBeNull();
    expect(parseTouched({ slot: 'fx_2', param: {} })).toBeNull();
    expect(parseTouched(null)).toBeNull();
  });
});


describe('how a track shows its tape', () => {
  it('reads and keeps show: audio; midi is the default and survives a clear', async () => {
    const { parseArrangement, clearTrack, emptyArrangement, patchTrack } = await import('../../types/playArrangement');
    const arr = patchTrack({ ...emptyArrangement(), tracks: { r1: { notes: [{ t: 0, n: 60, v: 1, d: 0.5 }], auto: {}, arm: true } } }, 'r1', { show: 'audio' });
    const back = parseArrangement(JSON.parse(JSON.stringify(arr)));
    expect(back!.tracks.r1.show).toBe('audio');
    expect(parseArrangement(JSON.parse(JSON.stringify(patchTrack(arr, 'r1', { show: 'midi' }))))!.tracks.r1.show).toBeUndefined();
    expect(clearTrack(arr, 'r1').tracks.r1.show).toBe('audio');
  });
});
