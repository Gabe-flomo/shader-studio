/**
 * The tape running (lib/tape.ts) against fakes: a hand-moved clock, a record,
 * the notes it sends into racks. Recording a first loop sets the length;
 * playback loops and wraps; overdub keeps untouched spans; a punch-in waits
 * for its count-in; re-recording one track leaves the others; the 60 s cap
 * stops with a notice; each recording is one undo step; touched rack
 * controls; and the live replay sends the same notes at the same seconds as
 * the take made from the tape (which is what an offline render plays).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  const store = new Map<string, string>();
  g.localStorage = { get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() };
});

import { tape, useTape, type TapeDeps } from '../tape';
import { padHitsOf } from '../recordingAudio';
import { arrangementTake, tapeEvents } from '../tapeTake';
import { jobNotes } from '../engineRender';
import { newRack, auTarget, auPropId, type AeRack } from '../../types/playAudioEngine';
import { emptyArrangement, type PlayArrangement } from '../../types/playArrangement';
import { addRackControl, moveRackControl, rackControlsOf, regroupRackControls, removeRackControl, renameRackControl, touchRackControl } from '../../play/rackControls';
import type { PlayRecord } from '../../types/play';

const rack = (id: string, name: string): AeRack => ({ ...newRack(id, []), name, instrument: { id: 'inst', kind: 'granulator', sample: { synth: 'pad', name: 'Pad' } } });

let clock = 0;
let play: PlayRecord;
let sent: Array<{ at: number; rack: string; bytes: number[] }>;
let commits: string[];
let notices: string[];
let clicks: number[];
let overrides: Map<string, number>;
let driven: Map<string, number>;
let input: ((rack: string, bytes: number[]) => void) | null;
let timePlaying: boolean[];

const deps: TapeDeps = {
  now: () => clock,
  play: () => play,
  commit: (fn, label) => { play = fn(play); commits.push(label); },
  send: (r, bytes) => sent.push({ at: clock / 1000, rack: r, bytes }),
  override: (id, key, v) => { const k = `${id}::${key}`; if (v === null) overrides.delete(k); else overrides.set(k, v); },
  driven: (id, key) => driven.get(`${id}::${key}`),
  click: () => clicks.push(clock / 1000),
  setTimePlaying: playing => timePlaying.push(playing),
  notice: t => notices.push(t),
  every: () => () => {},
  onInput: fn => { input = fn; return () => { input = null; }; },
};

/** Move the clock to `s` seconds in `step` ms ticks. */
function runTo(s: number, step = 10): void {
  while (clock < s * 1000 - 1e-6) { clock = Math.min(s * 1000, clock + step); tape.tick(); }
}
const noteOn = (r: string, n: number, v = 100) => input?.(r, [0x90, n, v]);
const noteOff = (r: string, n: number) => input?.(r, [0x80, n, 0]);
const arr = () => play.arrangement!;

beforeEach(() => {
  tape.resetForTests();
  tape.configure(deps);
  clock = 0; sent = []; commits = []; notices = []; clicks = []; overrides = new Map(); driven = new Map(); input = null; timePlaying = [];
  play = { version: 1, controls: [], mappings: [], layers: [], audioEngine: { racks: [rack('rk1', 'Rack 1'), rack('rk2', 'Rack 2')] } };
});

describe('recording', () => {
  it('the first recording sets the tape’s length and loops on', () => {
    tape.record();
    expect(useTape.getState().phase).toBe('recording');
    runTo(0.5); noteOn('rk1', 60);
    runTo(1); noteOff('rk1', 60);
    runTo(2);
    tape.stop();
    expect(arr().length).toBe(2);
    expect(arr().loop).toBe(true);
    expect(arr().tracks.rk1.notes).toEqual([{ t: 0.5, n: 60, v: 100 / 127, d: 0.5 }]);
    expect(commits).toEqual(['Recorded Rack 1 on the tape']);
  });

  it('a note still held at the stop ends there', () => {
    tape.record(); runTo(0.2); noteOn('rk1', 62); runTo(1); tape.stop();
    expect(arr().tracks.rk1.notes[0]).toMatchObject({ t: 0.2, d: 0.8 });
  });

  it('nothing played: nothing kept, a notice', () => {
    tape.record(); runTo(1); tape.stop();
    expect(play.arrangement).toBeUndefined();
    expect(notices).toEqual(['Nothing was recorded']);
  });

  it('recording past the end extends the tape, and stops at 60 s with a notice', () => {
    play = { ...play, arrangement: { ...emptyArrangement(), length: 2, tracks: { rk1: { notes: [{ t: 0.5, n: 60, v: 1, d: 0.2 }], auto: {}, arm: true } } } };
    tape.record(); runTo(3); noteOn('rk2', 40); runTo(3.5); noteOff('rk2', 40); runTo(4); tape.stop();
    expect(arr().length).toBe(4);
    tape.record(); runTo(65);
    expect(useTape.getState().phase).toBe('stopped');
    expect(notices).toContain('The tape is full at 60 s for now');
    expect(arr().length).toBe(60);
  });
});

describe('playback', () => {
  beforeEach(() => {
    play = { ...play, arrangement: { ...emptyArrangement(), length: 2, tracks: { rk1: { notes: [{ t: 0.5, n: 60, v: 1, d: 0.25 }, { t: 1.9, n: 64, v: 0.5, d: 0.5 }], auto: {}, arm: true } } } };
  });

  it('plays each note on and off at its time, and wraps at the end (letting held notes go)', () => {
    tape.play(); runTo(4.6);
    const ons = sent.filter(s => s.bytes[0] === 0x90).map(s => [Math.round(s.at * 100) / 100, s.bytes[1]]);
    expect(ons).toEqual([[0.5, 60], [1.9, 64], [2.5, 60], [3.9, 64], [4.5, 60]]);
    // The note held over the loop point is let go at the wrap.
    const off64 = sent.filter(s => s.bytes[0] === 0x80 && s.bytes[1] === 64).map(s => Math.round(s.at * 100) / 100);
    expect(off64).toEqual([2, 4]);
  });

  it('without a loop it stops at the end', () => {
    play = { ...play, arrangement: { ...arr(), loop: false } };
    tape.play(); runTo(3);
    expect(useTape.getState().phase).toBe('stopped');
    expect(sent.filter(s => s.bytes[0] === 0x90)).toHaveLength(2);
  });

  it('mute and solo', () => {
    play = { ...play, arrangement: { ...arr(), tracks: { ...arr().tracks, rk1: { ...arr().tracks.rk1, mute: true } } } };
    tape.play(); runTo(1.9);
    expect(sent).toHaveLength(0);
  });

  it('automation holds the rack control while it plays and lets go on stop', () => {
    const target = auTarget('rk1', 'inst', '1');
    play = { ...play, arrangement: { ...arr(), tracks: { rk1: { notes: [], auto: { [target]: [0, 0, 2, 1] }, arm: true } } } };
    tape.play(); runTo(1);
    expect(overrides.get(`${auPropId('rk1', 'inst')}::1`)).toBeCloseTo(0.5, 1);
    tape.stop();
    expect(overrides.size).toBe(0);
  });

  it('replays the same notes at the same seconds as the take a render plays', () => {
    tape.play(); runTo(2);
    const live = sent.map(s => ({ t: Math.round(s.at * 100) / 100, bytes: s.bytes }));
    const take = arrangementTake(play, 'Tape')!;
    const rendered = jobNotes(play.audioEngine!.racks, take, 0, 2).map(n => ({ t: Math.round(n.t * 100) / 100, bytes: n.bytes }));
    // The render ends at 2 s; live, the note held over the end is let go there.
    expect(live.filter(n => n.t < 2)).toEqual(rendered);
    expect(live[live.length - 1]).toEqual({ t: 2, bytes: [0x80, 64, 0] });
    expect(tapeEvents(arr())).toHaveLength(4);
  });

  it('a browser instrument (the Granulator) renders the same notes offline as it hears live', () => {
    tape.play(); runTo(2);
    const liveOns = sent.filter(s => s.bytes[0] === 0x90).map(s => [Math.round(s.at * 100) / 100, s.bytes[1], Math.round(s.bytes[2])]);
    // recordingAudio.renderGrains plays a take's `ae:<rack>` pad hits (pad = note, at their exact seconds).
    const hits = padHitsOf(arrangementTake(play, 'Tape')!, 0, 2).filter(h => h.layerId === 'ae:rk1' && h.vel > 0);
    expect(hits.map(h => [Math.round(h.t * 100) / 100, h.pad, Math.round(h.vel * 127)])).toEqual(liveOns);
  });
});

describe('overdub and punch-in', () => {
  const base = (): PlayArrangement => ({ ...emptyArrangement(), length: 4, tracks: { rk1: { notes: [0.5, 1.5, 2.5, 3.5].map((t, i) => ({ t, n: 60 + i, v: 1, d: 0.2 })), auto: {}, arm: true } } });

  it('Record while playing punches in: only where notes are played is replaced', () => {
    play = { ...play, arrangement: base() };
    tape.play(); runTo(1.2);
    tape.record();
    expect(useTape.getState().phase).toBe('recording');
    runTo(1.4); noteOn('rk1', 72); runTo(1.8); noteOff('rk1', 72); runTo(3); tape.stop();
    expect(arr().tracks.rk1.notes.map(n => n.n)).toEqual([60, 72, 62, 63]);
    expect(arr().length).toBe(4);
  });

  it('a count-in pre-rolls the tape and recording starts at the point', () => {
    play = { ...play, arrangement: { ...base(), countIn: 1, bpm: 120, metronome: true } };
    useTape.setState({ point: 3 });
    tape.record();
    expect(useTape.getState()).toMatchObject({ phase: 'counting', count: 4 });
    runTo(0.7);
    expect(useTape.getState().count).toBe(2);
    noteOn('rk1', 90); // during the count-in: not recorded
    runTo(2.01);
    expect(useTape.getState().phase).toBe('recording');
    // The pre-roll played the tape from 1 s: the note at 1.5 (at clock 0.5) and 2.5 (at clock 1.5).
    expect(sent.filter(s => s.bytes[0] === 0x90).map(s => s.bytes[1])).toEqual([61, 62]);
    // Four clicks, one a beat.
    expect(clicks.map(c => Math.round(c * 100) / 100)).toEqual([0.01, 0.5, 1, 1.5, 2]);
    noteOff('rk1', 90);
    runTo(2.2); noteOn('rk1', 80); runTo(2.4); noteOff('rk1', 80); runTo(2.6); tape.stop();
    const notes = arr().tracks.rk1.notes;
    expect(notes.map(n => n.n)).toEqual([60, 61, 62, 80, 63]);
    expect(notes[3].t).toBeCloseTo(3.2, 5);
  });

  it('re-recording a selected track replaces just it from the point; the others keep playing', () => {
    play = { ...play, arrangement: { ...base(), tracks: { ...base().tracks, rk2: { notes: [{ t: 3, n: 40, v: 1, d: 0.2 }], auto: {}, arm: true } } } };
    useTape.setState({ point: 2, selected: 'rk1', mode: 'replace' });
    tape.record(); runTo(0.5); noteOn('rk1', 50); runTo(0.6); noteOff('rk1', 50); runTo(1.5); tape.stop();
    expect(arr().tracks.rk1.notes.map(n => n.n)).toEqual([60, 61, 50, 63]);
    expect(arr().tracks.rk2.notes.map(n => n.n)).toEqual([40]);
    // rk1's old note at 2.5 wasn't heard (being replaced); rk2's at 3 was.
    expect(sent.filter(s => s.bytes[0] === 0x90).map(s => `${s.rack}:${s.bytes[1]}`)).toEqual(['rk2:40']);
    expect(commits).toEqual(['Recorded Rack 1 on the tape']);
  });

  it('only armed tracks record', () => {
    play = { ...play, arrangement: { ...base(), tracks: { ...base().tracks, rk2: { notes: [], auto: {}, arm: false } } } };
    expect(tape.recordingRacks(play)).toEqual(['rk1']);
    tape.record(); runTo(0.1); noteOn('rk2', 40); runTo(0.3); noteOff('rk2', 40); runTo(0.5); tape.stop();
    expect(arr().tracks.rk2.notes).toEqual([]);
  });

  it('a rack control moved while recording replaces its automation only where it moved', () => {
    play = addRackControl(play, 'rk1', 'inst', { address: '1', name: 'Position', min: 0, max: 1, value: 0.3 });
    const target = auTarget('rk1', 'inst', '1');
    play = { ...play, arrangement: { ...base(), tracks: { rk1: { ...base().tracks.rk1, auto: { [target]: [0, 0.2, 4, 0.2] } } } } };
    tape.play(); runTo(0.5);
    tape.record();
    runTo(1);
    driven.set(`${auPropId('rk1', 'inst')}::1`, 0.8); // a mapped knob moves
    runTo(1.3);
    // Touched: the tape lets go so the knob is heard.
    expect(overrides.has(`${auPropId('rk1', 'inst')}::1`)).toBe(false);
    runTo(3); tape.stop();
    const pts = arr().tracks.rk1.auto[target];
    const at = (t: number) => { let v = pts[1]; for (let i = 0; i < pts.length; i += 2) if (pts[i] <= t) v = pts[i + 1]; return v; };
    expect(at(0.8)).toBeCloseTo(0.2);
    expect(at(1.1)).toBeCloseTo(0.8);
    expect(at(2.5)).toBeCloseTo(0.2);
  });
});

describe('rack controls', () => {
  it('add (up to 8, grouped), rename, reorder, regroup, remove', () => {
    let p = play;
    for (let i = 0; i < 10; i++) p = addRackControl(p, 'rk1', 'inst', { address: String(i), name: `P${i}`, min: 0, max: 1, value: 0.5 });
    const r = p.audioEngine!.racks[0];
    expect(rackControlsOf(p, r, r.instrument!).map(x => x.address)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    expect(p.controls.every(c => c.group === 'Rack 1 · Granulator')).toBe(true);
    p = renameRackControl(p, 'rk1', 'inst', '0', 'Grain spot');
    expect(p.controls[0].label).toBe('Grain spot');
    p = moveRackControl(p, 'rk1', 'inst', '0', 1);
    expect(p.audioEngine!.racks[0].instrument!.controls!.slice(0, 2)).toEqual(['1', '0']);
    expect(p.controls.slice(0, 2).map(c => c.label)).toEqual(['P1', 'Grain spot']);
    p = { ...p, audioEngine: { racks: [{ ...p.audioEngine!.racks[0], name: 'Pads' }, p.audioEngine!.racks[1]] } };
    p = regroupRackControls(p);
    expect(p.controls[0].group).toBe('Pads · Granulator');
    p = removeRackControl(p, 'rk1', 'inst', '0');
    expect(p.controls).toHaveLength(7);
    expect(p.audioEngine!.racks[0].instrument!.controls).not.toContain('0');
  });

  it('touching a parameter in the plug-in window adds it; when full the first on the strip makes room', () => {
    const param = (i: number) => ({ address: String(i), name: `P${i}`, min: 0, max: 1, value: i / 10 });
    let p = play;
    let r = touchRackControl(p, 'rk1', 'inst', param(0));
    expect(r.added).toBe(true);
    expect(r.replaced).toBeUndefined();
    p = r.record;
    // Touching it again changes nothing.
    r = touchRackControl(p, 'rk1', 'inst', param(0));
    expect(r.added).toBe(false);
    expect(r.record).toBe(p);
    for (let i = 1; i < 8; i++) p = touchRackControl(p, 'rk1', 'inst', param(i)).record;
    const addrs = () => rackControlsOf(p, p.audioEngine!.racks[0], p.audioEngine!.racks[0].instrument!).map(x => x.address);
    expect(addrs()).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    // A mapping on the one that goes, goes with it.
    const first = p.controls.find(c => c.target === auTarget('rk1', 'inst', '0'))!;
    p = { ...p, mappings: [...p.mappings, { id: 'm1', controlId: first.id } as unknown as PlayRecord['mappings'][number]] };
    r = touchRackControl(p, 'rk1', 'inst', param(8));
    expect(r.added).toBe(true);
    expect(r.replaced).toEqual({ address: '0', label: 'P0' });
    p = r.record;
    expect(addrs()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(p.controls.some(c => c.target === auTarget('rk1', 'inst', '0'))).toBe(false);
    expect(p.mappings.some(m => m.controlId === first.id)).toBe(false);
    // Its value is where it was touched; an unknown slot changes nothing.
    expect(p.audioEngine!.racks[0].instrument!.params?.['8']).toBeCloseTo(0.8);
    expect(touchRackControl(p, 'rk1', 'nope', param(9)).record).toBe(p);
  });
});

describe('undo', () => {
  it('each recording is one commit (one undo step)', () => {
    tape.record(); runTo(0.2); noteOn('rk1', 60); runTo(0.4); noteOff('rk1', 60); runTo(1); tape.stop();
    tape.record(); runTo(1.2); noteOn('rk2', 61); runTo(1.4); noteOff('rk2', 61); runTo(1.6); tape.stop();
    expect(commits).toHaveLength(2);
  });
});

describe('the Arrangement view’s transport: one Play/Pause, a separate Stop', () => {
  beforeEach(() => {
    play = { ...play, arrangement: { ...emptyArrangement(), length: 4, loop: false, tracks: { rk1: { notes: [{ t: 0.5, n: 60, v: 1, d: 0.25 }, { t: 2.5, n: 64, v: 1, d: 0.25 }], auto: {}, arm: true } } } };
  });

  it('Play/Pause pauses where the tape is and carries on from there', () => {
    tape.togglePlay();
    expect(useTape.getState().phase).toBe('playing');
    runTo(1.5);
    tape.togglePlay();
    expect(useTape.getState()).toMatchObject({ phase: 'stopped', point: 1.5 });
    sent = [];
    tape.togglePlay();
    runTo(3);
    // From 1.5: the note at 0.5 isn't played again, the one at 2.5 is.
    expect(sent.filter(s => s.bytes[0] === 0x90).map(s => s.bytes[1])).toEqual([64]);
  });

  it('Stop goes back to the start from any state', () => {
    tape.togglePlay(); runTo(1.2);
    tape.stopToStart();
    expect(useTape.getState()).toMatchObject({ phase: 'stopped', point: 0 });
    tape.setPoint(2); tape.stopToStart();
    expect(useTape.getState().point).toBe(0);
  });

  it('Play/Pause is authoritative over the page’s time transport (owner: it should override the Studio settings and play/pause the track)', () => {
    tape.togglePlay(); // starts the tape and the time transport together
    expect(timePlaying).toEqual([true]);
    runTo(1.5);
    tape.togglePlay(); // pauses both, wherever the tape is
    expect(timePlaying).toEqual([true, false]);
    tape.togglePlay();
    expect(timePlaying).toEqual([true, false, true]);
  });

  it('Stop leaves the time transport paused', () => {
    tape.togglePlay(); runTo(1.2);
    timePlaying = [];
    tape.stopToStart();
    expect(timePlaying).toEqual([false]);
    // Stop while already stopped still leaves it paused.
    tape.stopToStart();
    expect(timePlaying).toEqual([false, false]);
  });

  it('Play/Pause doesn’t touch the time transport when the tape has nothing to play', () => {
    play = { ...play, arrangement: undefined };
    timePlaying = [];
    tape.togglePlay();
    expect(useTape.getState().phase).toBe('stopped');
    expect(timePlaying).toEqual([]);
    expect(notices).toContain('Nothing on the tape yet');
  });

  it('Play/Pause while recording keeps the recording and pauses there', () => {
    tape.setPoint(1); tape.record();
    runTo(0.3); noteOn('rk2', 50); runTo(0.6); noteOff('rk2', 50); runTo(1);
    tape.togglePlay();
    expect(useTape.getState()).toMatchObject({ phase: 'stopped', point: 2 });
    expect(commits).toEqual(['Recorded Rack 2 on the tape']);
    expect(arr().tracks.rk2.clips).toEqual([{ t: 1, d: 1 }]);
  });

  it('Play/Pause during a count-in cancels it, nothing recorded, the point kept', () => {
    play = { ...play, arrangement: { ...arr(), countIn: 1 } };
    tape.setPoint(2); tape.record();
    expect(useTape.getState().phase).toBe('counting');
    runTo(0.5);
    tape.togglePlay();
    expect(useTape.getState()).toMatchObject({ phase: 'stopped', point: 2 });
    expect(commits).toEqual([]);
  });

  it('a muted clip doesn’t play', () => {
    play = { ...play, arrangement: { ...arr(), tracks: { rk1: { ...arr().tracks.rk1, clips: [{ t: 0, d: 1, mute: true }, { t: 2, d: 1 }] } } } };
    tape.togglePlay(); runTo(3.5);
    expect(sent.filter(s => s.bytes[0] === 0x90).map(s => s.bytes[1])).toEqual([64]);
  });
});
