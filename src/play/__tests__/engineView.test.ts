/**
 * The Arrangement view as data (play/engineView.ts) and the clips on the tape
 * (types/playArrangement.ts): tracks follow racks one to one (order, lead,
 * mute, colour); clips come from recordings (and from an older tape's
 * material), delete, mute and trim; a clip draws a waveform (the rendered
 * sound, or an envelope from the notes: never bars); the device chain's order
 * with the Listener among the effects; the ruler in bars and beats; and the
 * transport's play/pause/stop rules.
 */
import { describe, expect, it } from 'vitest';
import {
  CLIP_COLUMNS, LISTENER, TRACK_COLORS, applyChainOrder, barsBeats, chainOrder, clipWave, deviceChain, engineTracks, listenerExact, moveTrack, reorderChain, rulerTicks, transportPlan, type Device,
} from '../engineView';
import {
  applyPasses, audibleArrangement, clipBounds, clipsWithPass, deleteClip, emptyArrangement, parseArrangement, setClipMute, trackClips, trimClip, type ArrTrack, type PlayArrangement,
} from '../../types/playArrangement';
import { newRack, parseAudioEngine, type AeRack, type AeSlot, type PlayAudioEngine } from '../../types/playAudioEngine';
import { arrangementTake } from '../../lib/tapeTake';
import { readerGroupName } from '../readerControls';
import { readerInputOptions } from '../../components/play/readersPanelUi';
import type { PlayRecord } from '../../types/play';

const au = (id: string, bypass = false): AeSlot => ({ id, kind: 'au', unit: { type: 1635083896, subtype: 1, manufacturer: 1, name: `FX ${id}`, vendor: 'Apple' }, ...(bypass ? { bypass } : {}) });
const synth: AeSlot = { id: 'inst', kind: 'au', unit: { type: 1635085685, subtype: 2, manufacturer: 1, name: 'DLSMusicDevice', vendor: 'Apple' } };
const grain: AeSlot = { id: 'inst', kind: 'granulator', sample: { synth: 'pad', name: 'Pad' } };
const rack = (id: string, over: Partial<AeRack> = {}): AeRack => ({ ...newRack(id, []), name: id.toUpperCase(), ...over });
const track = (over: Partial<ArrTrack> = {}): ArrTrack => ({ notes: [], auto: {}, arm: true, ...over });

describe('tracks are racks', () => {
  const ae: PlayAudioEngine = { racks: [rack('rk1', { instrument: synth }), rack('rk2', { instrument: grain, mute: true }), rack('rk3', { source: 'master', color: '#123456' })], lock: 'rk2' };

  it('one track per rack, in order, with what plays on it', () => {
    const rows = engineTracks(ae, undefined, '');
    expect(rows.map(r => r.id)).toEqual(['rk1', 'rk2', 'rk3']);
    expect(rows.map(r => r.instrument)).toEqual(['au', 'granulator', 'send']);
    expect(rows[0].instrumentName).toBe('DLSMusicDevice');
    expect(rows[2].instrumentName).toBe('A send');
  });

  it('the lead follows the lock (else the selection, else the first); the selected track is outlined', () => {
    const rows = engineTracks(ae, undefined, 'rk3');
    expect(rows.find(r => r.lead)?.id).toBe('rk2');
    expect(rows.find(r => r.locked)?.id).toBe('rk2');
    expect(rows.find(r => r.selected)?.id).toBe('rk3');
    expect(engineTracks({ racks: ae.racks }, undefined, '').find(r => r.lead)?.id).toBe('rk1');
  });

  it('colours come from the palette by position unless the rack has its own; mute is the rack’s or the track’s', () => {
    const arr: PlayArrangement = { ...emptyArrangement(), length: 4, tracks: { rk1: track({ mute: true, solo: true, arm: false }) } };
    const rows = engineTracks(ae, arr, '', 'engine:rk1');
    expect(rows.map(r => r.color)).toEqual([TRACK_COLORS[0], TRACK_COLORS[1], '#123456']);
    expect(rows.map(r => r.mute)).toEqual([true, true, false]);
    expect(rows[0]).toMatchObject({ solo: true, arm: false, listening: true });
    expect(rows[1]).toMatchObject({ arm: true, listening: false });
  });

  it('tracks reorder by moving their rack', () => {
    expect(moveTrack(ae, 'rk3', 0).racks.map(r => r.id)).toEqual(['rk3', 'rk1', 'rk2']);
    expect(moveTrack(ae, 'rk1', 3).racks.map(r => r.id)).toEqual(['rk2', 'rk3', 'rk1']);
    expect(moveTrack(ae, 'rk2', 2)).toBe(ae); // dropped where it is
  });

  it('a rack’s colour and the Listener’s place survive a file', () => {
    const back = parseAudioEngine(JSON.parse(JSON.stringify({ ...ae, listenAt: 1 })))!;
    expect(back.racks[2].color).toBe('#123456');
    expect(back.listenAt).toBe(1);
    expect(parseAudioEngine({ racks: [{ id: 'rk1', color: 'red' }], listenAt: -1 })).toEqual({ racks: [expect.not.objectContaining({ color: expect.anything() })] });
  });
});

describe('clips', () => {
  const pass = (from: number, to: number, notes: Array<[number, number]> = [[from + 0.1, 0.2]]) => ({ rack: 'rk1', from, to, notes: notes.map(([t, d]) => ({ t, n: 60, v: 0.8, d })), auto: {}, touched: {}, mode: 'overdub' as const });

  it('each recording makes a clip over the span it recorded; one over another joins them', () => {
    let a = applyPasses(emptyArrangement(), [pass(0, 2)], { stoppedAt: 2 });
    expect(a.tracks.rk1.clips).toEqual([{ t: 0, d: 2 }]);
    a = applyPasses({ ...a, length: 8 }, [pass(4, 6)], { stoppedAt: 6 });
    expect(trackClips(a.tracks.rk1, a.length)).toEqual([{ t: 0, d: 2 }, { t: 4, d: 2 }]);
    a = applyPasses(a, [pass(1.5, 4.5, [[1.6, 0.1]])], { stoppedAt: 4.5 });
    expect(trackClips(a.tracks.rk1, a.length)).toEqual([{ t: 0, d: 6 }]);
  });

  it('recording over a muted clip plays it again; untouched muted clips stay muted', () => {
    expect(clipsWithPass([{ t: 0, d: 1, mute: true }, { t: 3, d: 1, mute: true }], 0.5, 2)).toEqual([{ t: 0, d: 2 }, { t: 3, d: 1, mute: true }]);
  });

  it('an older tape (no clips kept) shows its material as clips, runs closer than a second joined', () => {
    const t = track({ notes: [{ t: 0.2, n: 60, v: 1, d: 0.3 }, { t: 1, n: 62, v: 1, d: 0.2 }, { t: 5, n: 64, v: 1, d: 0.5 }], auto: { 'au:rk1:inst::1': [7, 0, 8, 1] } });
    expect(trackClips(t, 10)).toEqual([{ t: 0.2, d: 1 }, { t: 5, d: 0.5 }, { t: 7, d: 1 }]);
    expect(trackClips(undefined, 10)).toEqual([]);
    expect(trackClips(t, 5.2)).toEqual([{ t: 0.2, d: 1 }, { t: 5, d: 0.2 }]);
  });

  const tape = (): PlayArrangement => ({
    ...emptyArrangement(), length: 8,
    tracks: { rk1: track({ notes: [{ t: 0.5, n: 60, v: 1, d: 0.5 }, { t: 1.5, n: 62, v: 1, d: 1 }, { t: 5, n: 64, v: 1, d: 0.5 }], auto: { 'au:rk1:inst::1': [0.5, 0, 2, 1, 5.5, 0.5] }, clips: [{ t: 0, d: 3 }, { t: 4, d: 2 }] }) },
  });

  it('deleting a clip takes its notes and moves off the tape, and only its', () => {
    const a = deleteClip(tape(), 'rk1', 0);
    expect(a.tracks.rk1.notes.map(n => n.t)).toEqual([5]);
    expect(a.tracks.rk1.auto['au:rk1:inst::1']).toEqual([5.5, 0.5]);
    expect(a.tracks.rk1.clips).toEqual([{ t: 4, d: 2 }]);
    expect(deleteClip(tape(), 'rk1', 9)).toEqual(tape());
  });

  it('a muted clip is left out of playback and of the take made from the tape', () => {
    const a = setClipMute(tape(), 'rk1', 0, true);
    expect(a.tracks.rk1.clips![0]).toEqual({ t: 0, d: 3, mute: true });
    const heard = audibleArrangement(a);
    expect(heard.tracks.rk1.notes.map(n => n.t)).toEqual([5]);
    expect(heard.tracks.rk1.auto['au:rk1:inst::1']).toEqual([5.5, 0.5]);
    expect(audibleArrangement(a)).toBe(heard); // cached per tape
    expect(audibleArrangement(tape())).toEqual(tape());
    const take = arrangementTake({ controls: [], arrangement: a }, 'T')!;
    expect(take.events.filter(e => (e.vel ?? 0) > 0).map(e => e.t)).toEqual([5]);
    expect(setClipMute(a, 'rk1', 0, false).tracks.rk1.clips![0]).toEqual({ t: 0, d: 3 });
  });

  it('trimming a clip’s ends drops what falls outside and cuts a note sounding past the new end', () => {
    const a = trimClip(tape(), 'rk1', 0, 1, 2);
    expect(a.tracks.rk1.clips![0]).toEqual({ t: 1, d: 1 });
    expect(a.tracks.rk1.notes).toEqual([{ t: 1.5, n: 62, v: 1, d: 0.5 }, { t: 5, n: 64, v: 1, d: 0.5 }]);
    expect(a.tracks.rk1.auto['au:rk1:inst::1']).toEqual([2, 1, 5.5, 0.5]);
  });

  it('a trim stays between its neighbours and the tape’s ends, and never shorter than a sliver', () => {
    expect(clipBounds(tape(), 'rk1', 1)).toEqual({ min: 3, max: 8 });
    expect(trimClip(tape(), 'rk1', 1, 2, 10).tracks.rk1.clips![1]).toEqual({ t: 3, d: 5 });
    const tiny = trimClip(tape(), 'rk1', 0, 1, 1).tracks.rk1.clips![0];
    expect(tiny.d).toBeCloseTo(0.05);
  });

  it('clips and their mute survive a file; overlapping ones are cut', () => {
    const back = parseArrangement(JSON.parse(JSON.stringify(setClipMute(tape(), 'rk1', 1, true))))!;
    expect(back.tracks.rk1.clips).toEqual([{ t: 0, d: 3 }, { t: 4, d: 2, mute: true }]);
    const bad = parseArrangement({ length: 4, tracks: { rk1: { notes: [], auto: {}, clips: [{ t: 1, d: 2 }, { t: 0, d: 2 }, { t: 'x', d: 1 }] } } })!;
    expect(bad.tracks.rk1.clips).toEqual([{ t: 0, d: 1 }, { t: 1, d: 2 }]);
  });
});

describe('a clip looks like audio', () => {
  const clip = { t: 1, d: 2 };

  it('with the rendered sound: the waveform over the clip’s own span', () => {
    const peaks = new Float32Array(40);
    peaks.fill(0.1); peaks[15] = 0.9; // 1.5 s of a 4 s preview
    const w = clipWave(undefined, clip, 20, { peaks, length: 4 });
    expect(w.kind).toBe('audio');
    expect(w.peaks.length).toBe(20);
    expect(Math.max(...w.peaks)).toBeCloseTo(0.9);
    expect(w.peaks.indexOf(Math.max(...w.peaks))).toBe(5);
  });

  it('without it: an envelope from the notes (attack, decay, release), louder for harder notes, silent between', () => {
    const notes = [{ t: 1.2, n: 60, v: 1, d: 0.2 }, { t: 2.4, n: 60, v: 0.3, d: 0.2 }];
    const w = clipWave({ notes }, clip, CLIP_COLUMNS);
    expect(w.kind).toBe('envelope');
    const at = (t: number) => w.peaks[Math.floor(((t - clip.t) / clip.d) * CLIP_COLUMNS)];
    expect(at(1.1)).toBe(0);
    expect(at(1.22)).toBeGreaterThan(0.5);
    expect(at(2.42)).toBeGreaterThan(0);
    expect(at(2.42)).toBeLessThan(at(1.22));
    expect(at(2.0)).toBeLessThan(0.05);
    // It has grain, like a sound: neighbouring columns in a held note differ.
    const held = [at(1.25), at(1.26), at(1.27), at(1.28)];
    expect(new Set(held.map(v => v.toFixed(4))).size).toBeGreaterThan(1);
    expect(Math.max(...w.peaks)).toBeLessThanOrEqual(0.92 + 1e-6);
  });

  it('an empty clip draws nothing', () => {
    expect(Math.max(...clipWave(track(), clip, 10).peaks)).toBe(0);
  });
});

describe('the device chain', () => {
  const r = rack('rk1', { instrument: synth, effects: [au('fxA'), au('fxB', true), au('fxC')] });
  const keys = (d: Device[]) => d.map(x => x.key);

  it('input, instrument, then the effects in order; the Listener where it sits, at the end by default', () => {
    expect(keys(deviceChain(r, { listening: false, native: true }))).toEqual(['input', 'inst', 'fxA', 'fxB', 'fxC']);
    expect(keys(deviceChain(r, { listening: true, native: true }))).toEqual(['input', 'inst', 'fxA', 'fxB', 'fxC', LISTENER]);
    expect(keys(deviceChain(r, { listening: true, listenAt: 0, native: true }))).toEqual(['input', 'inst', LISTENER, 'fxA', 'fxB', 'fxC']);
    expect(keys(deviceChain(r, { listening: true, listenAt: 2, native: true }))).toEqual(['input', 'inst', 'fxA', 'fxB', LISTENER, 'fxC']);
    expect(keys(deviceChain(r, { listening: true, listenAt: 99, native: true })).at(-1)).toBe(LISTENER);
  });

  it('a send replaces the instrument; a Granulator brings its Sound chain', () => {
    expect(keys(deviceChain(rack('a', { source: 'master', instrument: synth }), { listening: false, native: true }))).toEqual(['input', 'send']);
    expect(keys(deviceChain(rack('a', { instrument: grain, effects: [au('fx')] }), { listening: false, native: true }))).toEqual(['input', 'inst', 'soundfx', 'fx']);
  });

  it('which effects are heard: Audio Units on the desktop, not bypassed, not after a Granulator', () => {
    const d = deviceChain(r, { listening: false, native: true }).filter(x => x.kind === 'effect');
    expect(d.map(x => x.kind === 'effect' && x.heard)).toEqual([true, false, true]);
    expect(deviceChain(r, { listening: false, native: false }).some(x => x.kind === 'effect' && x.heard)).toBe(false);
    expect(deviceChain(rack('a', { instrument: grain, effects: [au('fx')] }), { listening: false, native: true }).some(x => x.kind === 'effect' && x.heard)).toBe(false);
  });

  it('a Listener reads where it sits when nothing heard comes after it, else after the chain (for now)', () => {
    expect(listenerExact(r, 3, true)).toBe(true);
    expect(listenerExact(r, 2, true)).toBe(false); // fxC is heard after it
    expect(listenerExact({ ...r, effects: [au('fxA'), au('fxB', true)] }, 1, true)).toBe(true); // only a bypassed one after
    expect(listenerExact(r, 0, false)).toBe(true); // a browser: Audio Units aren't heard
    const l = deviceChain(r, { listening: true, listenAt: 1, native: true }).find(x => x.kind === 'listener');
    expect(l).toMatchObject({ at: 1, exact: false });
  });

  it('dragging reorders effects and moves the Listener between them', () => {
    const ae: PlayAudioEngine = { racks: [r] };
    const order = chainOrder(deviceChain(r, { listening: true, native: true }));
    expect(order).toEqual(['fxA', 'fxB', 'fxC', LISTENER]);
    // The Listener dropped before fxB.
    let next = applyChainOrder(ae, 'rk1', reorderChain(order, LISTENER, 1));
    expect(next.listenAt).toBe(1);
    expect(next.racks[0].effects.map(e => e.id)).toEqual(['fxA', 'fxB', 'fxC']);
    // fxC dragged to the front.
    next = applyChainOrder(next, 'rk1', reorderChain(chainOrder(deviceChain(next.racks[0], { listening: true, listenAt: next.listenAt, native: true })), 'fxC', 0));
    expect(next.racks[0].effects.map(e => e.id)).toEqual(['fxC', 'fxA', 'fxB']);
    expect(next.listenAt).toBe(2);
    // Back to the end: no position kept.
    next = applyChainOrder(next, 'rk1', reorderChain(['fxC', 'fxA', LISTENER, 'fxB'], LISTENER, 4));
    expect(next.listenAt).toBeUndefined();
    // Without the Listener in the order, its place isn't touched.
    expect(applyChainOrder({ ...ae, listenAt: 1 }, 'rk1', ['fxB', 'fxA', 'fxC']).listenAt).toBe(1);
    expect(reorderChain(order, 'nope', 0)).toEqual(order);
  });

  it('a Listener on the master: its readers are grouped as the Master’s, and the panel offers it', () => {
    const p = { version: 1, controls: [], mappings: [], layers: [], audioEngine: { racks: [rack('rk1')] }, audioReaders: { input: 'engine:master', readers: [] } } as unknown as PlayRecord;
    expect(readerGroupName(p)).toBe('Audio readers · Master');
    expect(readerInputOptions('', [], [], [{ id: 'rk1', name: 'Rack 1' }]).map(o => o.value)).toContain('engine:master');
    expect(readerInputOptions('', [], [], []).map(o => o.value)).not.toContain('engine:master');
  });
});

describe('the ruler', () => {
  it('bars at the tempo, beats between them when there’s room', () => {
    const t = rulerTicks(8, 120, 800); // 4 bars of 2 s, 200 px a bar
    expect(t.filter(x => x.label).map(x => x.label)).toEqual(['1', '2', '3', '4', '5']);
    expect(t.filter(x => !x.label).length).toBe(12);
    expect(t[1]).toMatchObject({ t: 0.5, bar: 1, beat: 2 });
  });

  it('thins labels when bars are narrow', () => {
    const t = rulerTicks(60, 120, 300); // 30 bars, 10 px each
    const labels = t.filter(x => x.label).map(x => Number(x.label));
    expect(labels[1] - labels[0]).toBe(4);
    expect(t.every(x => x.label)).toBe(true);
  });

  it('positions read as bars.beats.sixteenths', () => {
    expect(barsBeats(0, 120)).toBe('1.1.1');
    expect(barsBeats(0.5, 120)).toBe('1.2.1');
    expect(barsBeats(2.125, 120)).toBe('2.1.2');
    expect(barsBeats(-0.5, 120)).toBe('-1.4.1');
  });
});

describe('the transport', () => {
  const plan = (cmd: 'toggle' | 'stop' | 'record', phase: 'stopped' | 'playing' | 'counting' | 'recording', position = 3.25) => transportPlan(cmd, { phase, position });

  it('Play/Pause is one toggle from any state', () => {
    expect(plan('toggle', 'stopped')).toEqual({ stop: false, play: true, record: false, point: null });
    expect(plan('toggle', 'playing')).toEqual({ stop: true, play: false, record: false, point: 3.25 });
    expect(plan('toggle', 'recording')).toEqual({ stop: true, play: false, record: false, point: 3.25 });
    expect(plan('toggle', 'counting')).toEqual({ stop: true, play: false, record: false, point: null });
    expect(plan('toggle', 'playing', -0.4).point).toBe(0);
  });

  it('Stop stops whatever runs and goes back to the start', () => {
    for (const ph of ['playing', 'recording', 'counting'] as const) expect(plan('stop', ph)).toEqual({ stop: true, play: false, record: false, point: 0 });
    expect(plan('stop', 'stopped')).toEqual({ stop: false, play: false, record: false, point: 0 });
  });

  it('Record keeps its own rules (record, punch in, stop recording)', () => {
    expect(plan('record', 'playing')).toEqual({ stop: false, play: false, record: true, point: null });
  });
});
