/**
 * Takes: a performance recorded as keyframes, played back into the live
 * preview and into offline frames, saved with the graph within a size budget.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// The graph store reads saved presets on load.
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { decodeKeys, encodeKeys, keepIndices, takeEventsBetween, takeMouseAt, takePointerAt, takeSize, takeValuesAt, trackAt } from '../../lib/takePlayback';
import { TAKE_BUDGET, TakeCapture, takeApplier, useTakes } from '../../lib/takes';
import { inputBus, paramChannelKey, type InputSource } from '../../lib/inputBus';
import { audioEngine } from '../../lib/audioEngine';
import { playEngine } from '../../lib/playEngine';
import { playOverlay } from '../../play/overlay';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { emptyPlayRecord, parsePlayRecord, TAKE_MAX_SECONDS, TAKES_MAX, type PlayRecord, type PlayTake, type TakeTrack } from '../../types/play';

const track = (over: Partial<TakeTrack> & Pick<TakeTrack, 'keys'>): TakeTrack => ({ kind: 'control', id: 'speed', target: 'n::speed', label: 'Speed', width: 1, ...over });

const TAKE: PlayTake = {
  id: 't', name: 'Take 1', from: 1, length: 2,
  tracks: [
    track({ keys: '0,0,1000,1,1000,0.5' }),
    track({ id: 'tint', target: 'n::tint', label: 'Tint', width: 3, keys: '0,0,0,0,1000,1,1,1,1000,1,0,0' }),
    track({ kind: 'pointer', id: 'x', target: undefined, label: 'Pointer x', keys: '0,0,1000,1,1000,0.5' }),
    track({ kind: 'pointer', id: 'y', target: undefined, label: 'Pointer y', keys: '0,0,2000,0.5' }),
    track({ kind: 'pointer', id: 'down', target: undefined, label: 'Pointer down', step: true, keys: '0,0,1000,1,1000,0' }),
    track({ kind: 'mouse', id: 'x', target: undefined, label: 'Mouse x', keys: '0,0.25' }),
    track({ kind: 'mouse', id: 'y', target: undefined, label: 'Mouse y', keys: '0,0.75' }),
  ],
  events: [{ t: 0, do: 'burst', layerId: 'p', amount: 60 }, { t: 1.2, do: 'next', layerId: 'txt', amount: 1 }],
};

describe('keys', () => {
  it('read back between keys, and hold the ends', () => {
    expect(takeValuesAt(TAKE, 1.5).get('speed')).toBeCloseTo(0.5);
    expect(takeValuesAt(TAKE, 2.5).get('speed')).toBeCloseTo(0.75);
    expect(takeValuesAt(TAKE, 0).get('speed')).toBe(0);
    expect(takeValuesAt(TAKE, 9).get('speed')).toBe(0.5);
    expect(takeValuesAt(TAKE, 2.5).get('tint')).toEqual([1, 0.5, 0.5]);
  });

  it('move the pointer smoothly and hold a press until it lets go', () => {
    expect(takePointerAt(TAKE, 1.5)!.x).toBeCloseTo(0.5);
    expect(takePointerAt(TAKE, 2.1)!.down).toBe(true);
    expect(takePointerAt(TAKE, 1.9)!.down).toBe(false);
    expect(takePointerAt(TAKE, 3)!.down).toBe(false);
    expect(takeMouseAt(TAKE, 2)).toEqual([0.25, 0.75]);
  });

  it('fire each action once, on the first frame at or after it', () => {
    expect(takeEventsBetween(TAKE, -Infinity, 1).map(e => e.do)).toEqual(['burst']);
    expect(takeEventsBetween(TAKE, 1, 2.19)).toEqual([]);
    expect(takeEventsBetween(TAKE, 2.19, 2.21).map(e => e.do)).toEqual(['next']);
  });

  it('keep only what the shape needs: a held knob is two keys, a ramp two, a sweep stays within tolerance', () => {
    const times = Array.from({ length: 600 }, (_, i) => i / 60);
    expect(keepIndices(times, times.map(() => 0.4), 1, 1e-3)).toEqual([0, 599]);
    expect(keepIndices(times, times.map(t => t * 2), 1, 1e-3)).toEqual([0, 599]);
    const sine = times.map(t => Math.sin(t * 3));
    const keys = encodeKeys(times, sine, 1);
    const tr = track({ keys });
    expect(decodeKeys(tr).t.length).toBeLessThan(300);
    for (let i = 0; i < times.length; i += 7) expect(Math.abs((trackAt(tr, times[i]) as number) - sine[i])).toBeLessThan(0.01);
    // A press keeps only its changes.
    const down = times.map(t => (t > 3 && t < 4 ? 1 : 0));
    expect(keepIndices(times, down, 1, 0, true).length).toBe(4);
  });
});

// ── Recording, playing back, rendering ──────────────────────────────────────

const PLAY: PlayRecord = {
  ...emptyPlayRecord(),
  controls: [
    { id: 'speed', target: 'n::speed', kind: 'float', label: 'Speed', min: 0, max: 1, step: 0.01 },
    { id: 'tint', target: 'n::tint', kind: 'color', label: 'Tint', min: 0, max: 1, step: 0.01 },
  ],
};

/** A MIDI Input node's note output, written like the MIDI engine does. */
function midiSource(value: () => number): InputSource {
  return { tickInputs: (_dt, _t, write) => write('midi1::note', value()) };
}

afterEach(() => {
  useTakes.getState().endReplay();
  useTakes.getState().cancel();
  useNodeGraphStore.getState().setPlay(emptyPlayRecord());
  inputBus.setBindings({});
  inputBus.setParamBindings({});
  vi.restoreAllMocks();
});

describe('a performance', () => {
  it('records controls, the MIDI node, audio, the mouse, the pointer and actions, and plays them all back', async () => {
    useNodeGraphStore.getState().setPlay(PLAY);
    playEngine.setRecord(PLAY);
    let clock = 0;
    const off = inputBus.addSource(midiSource(() => clock / 2));
    vi.spyOn(playEngine, 'liveValue').mockImplementation(id => (id === 'speed' ? clock / 2 : id === 'tint' ? [clock / 2, 0, 1] : undefined));
    const amps = new Map<string, number>();
    vi.spyOn(audioEngine, 'lastAmps').mockReturnValue(amps);
    vi.spyOn(playOverlay, 'pointerNow').mockImplementation(() => ({ x: clock / 2, y: 0.5, over: true, down: clock > 1 }));

    useTakes.getState().setSettings({ countIn: false, manual: true });
    useTakes.getState().begin();
    expect(useTakes.getState().phase).toBe('recording');
    for (let i = 0; i <= 120; i++) {
      clock = 10 + i / 60 - 10; // the clock from 10 s, values from 0
      amps.set('u_audio_bass', clock / 4);
      inputBus.setMouse(clock / 2, 1 - clock / 2);
      if (i === 30) playOverlay.act({ do: 'burst', layerId: 'p', amount: 40 });
      inputBus.tick(1 / 60, 10 + i / 60);
    }
    useTakes.getState().stop();
    off();
    await Promise.resolve();

    const take = useNodeGraphStore.getState().play.takes![0];
    expect(take.name).toBe('Take 1');
    expect(take.from).toBeCloseTo(10);
    expect(take.length).toBeCloseTo(2);
    const kinds = new Set(take.tracks.map(t => `${t.kind}:${t.id}`));
    for (const k of ['control:speed', 'control:tint', 'bus:midi1::note', 'audio:u_audio_bass', 'mouse:x', 'mouse:y', 'pointer:x', 'pointer:down']) expect(kinds).toContain(k);
    expect(take.events).toEqual([{ t: expect.closeTo(0.5, 2), do: 'burst', layerId: 'p', amount: 40 }]);
    // A straight ramp needs two keys, however many frames it ran.
    expect(decodeKeys(take.tracks.find(t => t.id === 'speed')!).t.length).toBe(2);

    // Stopping plays it back: live input is muted and the take writes every value.
    expect(useTakes.getState().phase).toBe('replay');
    inputBus.setParamBindings({ 'n::speed': 'u_speed', 'n::tint': 'u_tint' });
    inputBus.setBindings({ u_midi_note: 'midi1::note' });
    const acted = vi.spyOn(playOverlay, 'replayAct');
    const out = inputBus.tick(1 / 60, 11);
    expect(out.get('u_speed')).toBeCloseTo(0.5, 3);
    expect(out.get('u_tint')).toEqual([expect.closeTo(0.5, 3), 0, 1]);
    expect(out.get('u_midi_note')).toBeCloseTo(0.5, 3);
    expect(out.get('u_audio_bass')).toBeCloseTo(0.25, 3);
    expect(inputBus.mouseOverride()![0]).toBeCloseTo(0.5, 3);
    expect(acted).toHaveBeenCalledTimes(1);
    // Done: live input comes back.
    useTakes.getState().endReplay();
    expect(inputBus.mouseOverride()).toBeNull();
  });

  it('renders offline with the same values, the mouse in pixels, and each action once', () => {
    inputBus.setParamBindings({ 'n::speed': 'u_speed', 'n::tint': 'u_tint' });
    const set = vi.fn();
    const applier = takeApplier(TAKE, { setUniform: set, width: 200, height: 100 });
    expect(applier.apply(1).map(a => a.do)).toEqual(['burst']);
    expect(set).toHaveBeenCalledWith('u_speed', 0);
    expect(set).toHaveBeenCalledWith('u_mouse', [50, 75]);
    set.mockClear();
    expect(applier.apply(1.5)).toEqual([]);
    expect(set).toHaveBeenCalledWith('u_speed', expect.closeTo(0.5, 5));
    expect(set).toHaveBeenCalledWith('u_tint', [0.5, 0.5, 0.5]);
    expect(applier.apply(2.25).map(a => a.do)).toEqual(['next']);
    expect(applier.pointer(2.1)!.down).toBe(true);
  });

  it('stops by itself at the length set, and never past a minute', async () => {
    useNodeGraphStore.getState().setPlay(PLAY);
    useTakes.getState().setSettings({ countIn: false, manual: false, seconds: 1 });
    useTakes.getState().begin();
    for (let i = 0; i <= 90 && useTakes.getState().phase === 'recording'; i++) { inputBus.tick(1 / 60, i / 60); await Promise.resolve(); }
    expect(useNodeGraphStore.getState().play.takes![0].length).toBeCloseTo(1, 1);
    useTakes.getState().endReplay();
    useTakes.getState().setSettings({ seconds: 500 });
    expect(useTakes.getState().settings.seconds).toBe(TAKE_MAX_SECONDS);
  });

  it('keeps only the last minute in the rolling buffer', () => {
    const c = new TakeCapture(PLAY, TAKE_MAX_SECONDS + 1);
    for (let i = 0; i <= 90 * 30; i++) c.sample(i / 30);
    const take = c.toTake('Rolling', TAKE_MAX_SECONDS)!;
    expect(take.length).toBeCloseTo(60);
    expect(take.from).toBeCloseTo(30);
    c.dispose();
  });
});

// ── Saved with the graph ────────────────────────────────────────────────────

describe('saving takes', () => {
  it('round-trips through a pretty-printed graph file', () => {
    const record: PlayRecord = { ...emptyPlayRecord(), takes: [TAKE] };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(record, null, 2)));
    expect(back.takes).toEqual([TAKE]);
    // And plays back the same.
    expect(takeValuesAt(back.takes![0], 2.5).get('tint')).toEqual([1, 0.5, 0.5]);
  });

  it('drops malformed tracks, events and takes, and keeps the last few', () => {
    const bad = {
      ...TAKE,
      tracks: [...TAKE.tracks, { kind: 'control', id: 'x', label: 'x', width: 1, keys: '0,1' }, { kind: 'bus', id: 'b', width: 1, keys: '0,1,2' }, { kind: 'nope', id: 'q', width: 1, keys: '0,1' }, { kind: 'bus', id: 'c', width: 1, keys: 'alert(1)' }],
      events: [...TAKE.events, { t: 1, do: 'explode', layerId: 'p', amount: 1 }, { t: 'soon', do: 'burst', layerId: 'p' }],
    };
    const back = parsePlayRecord({ takes: [bad, { id: 'x', from: 0, length: 999, tracks: [], events: [] }, 'junk'] });
    expect(back.takes).toHaveLength(1);
    expect(back.takes![0].tracks).toHaveLength(TAKE.tracks.length);
    expect(back.takes![0].events).toHaveLength(2);
    const many = parsePlayRecord({ takes: Array.from({ length: TAKES_MAX + 3 }, (_, i) => ({ ...TAKE, id: `t${i}` })) });
    expect(many.takes).toHaveLength(TAKES_MAX);
    expect(many.takes![0].id).toBe('t3');
    const huge = { ...TAKE, tracks: [track({ keys: Array.from({ length: 400_000 }, () => '16,0.12345').join(',') })] };
    expect(parsePlayRecord({ takes: [huge] }).takes).toBeUndefined();
  });

  it('a busy minute fits the budget: sweeps, knobs, a colour, an LFO, MIDI, the pointer', () => {
    const times = Array.from({ length: 60 * 60 + 1 }, (_, i) => i / 60);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // The mouse: a smoothed random walk (hands move smoothly, and never stop for a minute).
    const walk = () => { let v = 0.5, vel = 0; return times.map(() => { vel = vel * 0.95 + (rnd() - 0.5) * 0.004; v = Math.max(0, Math.min(1, v + vel)); return v; }); };
    // A knob: turned now and then, held between.
    const knob = () => { let v = rnd(); return times.map((_, i) => { if (i % 240 < 30) v = Math.max(0, Math.min(1, v + (rnd() - 0.5) * 0.05)); return v; }); };
    const lfo = times.map(t => 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.5));
    const gate = times.map((_, i) => (i % 45 < 10 ? 1 : 0));
    const mk = (kind: TakeTrack['kind'], id: string, values: number[], width: 1 | 3 = 1, step = false): TakeTrack =>
      ({ kind, id, label: id, width, ...(kind === 'control' ? { target: `n::${id}` } : {}), ...(step ? { step } : {}), keys: encodeKeys(times, values, width, step) });
    const mx = walk(), my = walk();
    const colour = times.flatMap((_, i) => [mx[i], my[i], 0.5]);
    const take: PlayTake = {
      id: 'big', name: 'Busy minute', from: 0, length: 60,
      tracks: [
        mk('control', 'a', mx), mk('control', 'b', my), mk('control', 'c', knob()), mk('control', 'd', knob()), mk('control', 'e', knob()),
        mk('control', 'lfo', lfo), mk('control', 'tint', colour, 3),
        mk('bus', 'midi::note', knob()), mk('bus', 'midi::gate', gate, 1, true), mk('bus', 'midi::cc1', knob()),
        mk('mouse', 'x', mx), mk('mouse', 'y', my),
        mk('pointer', 'x', mx), mk('pointer', 'y', my), mk('pointer', 'over', times.map(() => 1), 1, true), mk('pointer', 'down', gate, 1, true),
      ],
      events: Array.from({ length: 120 }, (_, i) => ({ t: i / 2, do: 'burst' as const, layerId: 'p', amount: 60 })),
    };
    const saved = JSON.stringify({ play: { ...emptyPlayRecord(), takes: [take] } }, null, 2).length;
    expect(takeSize(take)).toBeLessThan(TAKE_BUDGET);
    expect(saved).toBeLessThan(250_000);
  });

  it('loosens a noisy take until it fits the budget', () => {
    const controls = Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, target: `n${i}::v`, kind: 'float' as const, label: `C${i}`, min: 0, max: 1, step: 0.01 }));
    const play = { ...emptyPlayRecord(), controls };
    vi.spyOn(playEngine, 'liveValue').mockImplementation(() => Math.random());
    const c = new TakeCapture(play);
    for (let i = 0; i <= 60 * 60; i++) c.sample(i / 60);
    const take = c.toTake('Noise')!;
    expect(take.length).toBeCloseTo(60);
    expect(takeSize(take)).toBeLessThanOrEqual(TAKE_BUDGET);
    c.dispose();
  });
});

describe('the input bus', () => {
  it('passes param writes through for a take playing back', () => {
    inputBus.setParamBindings({ 'n::speed': 'u_speed' });
    const off = inputBus.addSource({ tickInputs: (_d, _t, w) => w(paramChannelKey('n::speed'), 0.3) });
    expect(inputBus.tick(0, 0).get('u_speed')).toBe(0.3);
    off();
  });
});
