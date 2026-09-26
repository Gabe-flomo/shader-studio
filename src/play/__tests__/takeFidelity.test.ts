/**
 * A rendered take (and any offline render) looks like what was played:
 * feedback and echo step as the live preview steps them, the layers' random
 * choices repeat under a take's seed, audio layers get the sound they drew,
 * and scrubbing back runs the layers up to the new place.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { LIVE_RATE, OfflineHistory, type HistoryGpu } from '../../lib/offlineHistory';
import { AUDIO_BINS, AudioFrameBuffer, packAudioFrame, takeAudioAt, unpackAudioFrame } from '../../lib/takeAudio';
import { TAKE_BUDGET, TakeCapture, takeApplier, useTakes } from '../../lib/takes';
import { takeSize } from '../../lib/takePlayback';
import { inputBus } from '../../lib/inputBus';
import { liveAudio } from '../../lib/liveAudio';
import { playOverlay } from '../../play/overlay';
import { createLayerKit, type KitEnv } from '../kit/kit.js';
import { klSketchCompile, klSketchStep } from '../kit/layers.js';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { emptyPlayRecord, parsePlayRecord, type PlayLayer, type PlayRecord, type PlayTake } from '../../types/play';
import { defaultLayer } from '../../types/playLayers';

afterEach(() => {
  useTakes.getState().endReplay();
  useTakes.getState().cancel();
  useNodeGraphStore.getState().setPlay(emptyPlayRecord());
  vi.restoreAllMocks();
});

// ── Feedback and echo, offline ───────────────────────────────────────────────

/** A stand-in GPU: a "picture" is one number; the graph smears the last one and adds its echoes. */
function numberGpu(): HistoryGpu<{ v: number }> & { draws: number } {
  const gpu = {
    draws: 0,
    create: () => ({ v: 0 }),
    dispose: () => {},
    draw: (t: number, into: { v: number }, prev: { v: number } | null, echoes: readonly { v: number }[]) => {
      gpu.draws++;
      into.v = (prev?.v ?? 0) * 0.9 + Math.sin(t * 3) + 0.05 * echoes.reduce((a, e) => a + e.v, 0);
    },
    copy: (from: { v: number }, into: { v: number }) => { into.v = from.v; },
  };
  return gpu;
}

/** Frames of a graph with feedback and an echo ring, from clock `from`, `n` frames at `fps`. */
function render(fps: number, n: number, from = 0): number[] {
  const h = new OfflineHistory(numberGpu());
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(h.frame(from + i / fps, { dt: 1 / fps, first: i === 0, feedback: true, echo: { copies: 3, delay: 4 } }).v);
  return out;
}

describe('an offline render with feedback and echo', () => {
  it('matches the live preview stepped at 60 Hz, at 30 fps as at 60', () => {
    const live = render(LIVE_RATE, 121);
    const at30 = render(30, 61);
    for (let j = 0; j < at30.length; j++) expect(at30[j]).toBeCloseTo(live[j * 2], 9);
    // Animated, not a still picture.
    expect(new Set(at30.map(v => v.toFixed(4))).size).toBeGreaterThan(50);
  });

  it('comes out the same on every run', () => {
    expect(render(24, 48)).toEqual(render(24, 48));
  });

  it('warms up before a render that starts after 0, so the trails are already there', () => {
    const h = new OfflineHistory(numberGpu());
    h.frame(5, { dt: 1 / 30, first: true, feedback: true, echo: null });
    expect(h.lastPasses.length).toBe(2 * LIVE_RATE + 1);
    expect(h.lastPasses[h.lastPasses.length - 1]).toBe(5);
    // The same picture the live preview had after running from 3 s.
    const live = new OfflineHistory(numberGpu());
    let v = 0;
    for (let k = 0; k <= 120; k++) v = live.frame(3 + k / 60, { dt: 1 / 60, first: k === 0, feedback: true, echo: null }).v;
    const again = new OfflineHistory(numberGpu());
    expect(again.frame(5, { dt: 1 / 30, first: true, feedback: true, echo: null }).v).toBeCloseTo(v, 3);
  });

  it('draws once a frame when nothing remembers the last one', () => {
    const gpu = numberGpu();
    const h = new OfflineHistory(gpu);
    for (let i = 0; i < 10; i++) h.frame(i / 30, { dt: 1 / 30, first: i === 0, feedback: false, echo: null });
    expect(gpu.draws).toBe(10);
  });
});

// ── The layers under a seed ──────────────────────────────────────────────────

/** A 2D context that remembers what it drew (numbers rounded), enough for the kit. */
function fakeCanvas(log: string[] | null) {
  const canvas = { width: 160, height: 90, getContext: () => ctx } as unknown as HTMLCanvasElement & { width: number; height: number };
  const target: Record<string, unknown> = {
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    measureText: (s: string) => ({ width: String(s).length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    canvas: null,
  };
  const ctx: unknown = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...a: unknown[]) => { log?.push(`${k}(${a.map(x => (typeof x === 'number' ? x.toFixed(3) : typeof x === 'string' ? x : '·')).join(',')})`); };
    },
    set(t, k: string, v) { t[k] = v; return true; },
  });
  return canvas;
}

function withDocument<T>(fn: () => T): T {
  const g = globalThis as { document?: unknown };
  const had = g.document;
  g.document = { createElement: () => fakeCanvas(null) };
  try { return fn(); } finally { g.document = had; }
}

function envFor(time: number, sensors: Map<string, number>): KitEnv {
  return {
    gl: fakeCanvas(null), W: 160, H: 90, dpr: 1, time, dt: 1 / 30,
    value: (l, k) => (l as unknown as Record<string, number>)[k],
    pointer: { x: 0.5, y: 0.5, over: false, down: false },
    markers: false, editing: false, hidden: false, backdrop: [0, 0, 0],
    audio: null, camera: null, image: () => null,
    sensor: (k, v) => sensors.set(k, v), override: () => {},
  };
}

/** Run a record for a second with a burst and a script button; what it drew and measured. */
function runLayers(record: PlayRecord, seed: number): { drawn: string[]; sensors: Map<string, number> } {
  return withDocument(() => {
    const kit = createLayerKit();
    kit.reset(seed);
    const drawn: string[] = [], sensors = new Map<string, number>();
    const out = fakeCanvas(drawn).getContext('2d')!;
    for (let i = 0; i < 30; i++) {
      if (i === 3) kit.act({ do: 'burst', layerId: 'p', amount: 80 });
      if (i === 5) kit.act({ do: 'scatter', layerId: 'b', amount: 1 });
      kit.frame(out, record, envFor(i / 30, sensors));
    }
    return { drawn, sensors };
  });
}

describe('a take’s seed', () => {
  const particles = { ...defaultLayer('particles', 'p', 'Sparks'), seed: 0, emit: 'burst', trail: 0 } as PlayLayer;
  const script = {
    ...defaultLayer('script', 's', 'Dots'),
    code: 'function draw(s) { circle(random(s.width), Math.random() * s.height, 2 + s.random() * 4); }',
    clear: true,
  } as PlayLayer;
  const bodies = { ...defaultLayer('bodies', 'b', 'Bodies'), count: 12 } as PlayLayer;
  const record: PlayRecord = { ...emptyPlayRecord(), layers: [particles, script, bodies] };

  it('makes unseeded particles, bursts, Script random(), Math.random() and s.random(), and scatter repeat', () => {
    const a = runLayers(record, 1234), b = runLayers(record, 1234);
    expect(a.drawn.length).toBeGreaterThan(100);
    expect(b.drawn).toEqual(a.drawn);
    expect([...b.sensors]).toEqual([...a.sensors]);
    expect(a.sensors.get('p::speed')).toBeGreaterThan(0); // the burst happened
    // Another seed, another run.
    expect(runLayers(record, 99).drawn).not.toEqual(a.drawn);
  });

  it('leaves them random without one', () => {
    expect(runLayers(record, 0).drawn).not.toEqual(runLayers(record, 0).drawn);
  });

  it('reaches a sketch’s own Math.random, only inside the sketch', () => {
    const st = klSketchCompile('function draw(s) { s.state.v = [Math.random(), random(), s.random()]; }');
    let n = 0;
    const s = { ctx: fakeCanvas(null).getContext('2d')!, width: 10, height: 10, dpr: 1, time: 0, dt: 0, frame: 0, params: {}, state: {} as Record<string, number[]>, mouse: { x: 0, y: 0, over: false, down: false }, random: () => (n += 0.25) };
    expect(klSketchStep(st as never, s as never, [], false)).toBeNull();
    expect((st as unknown as { state: { v: number[] } }).state.v).toEqual([0.25, 0.5, 0.75]);
    expect(Math.random()).not.toBe(1); // the real one is untouched
  });

  it('is kept with the take, and given to its render', () => {
    const c = new TakeCapture(emptyPlayRecord(), Infinity, 4321);
    for (let i = 0; i <= 30; i++) c.sample(i / 30);
    const take = c.toTake('Seeded')!;
    c.dispose();
    expect(take.seed).toBe(4321);
    const back = parsePlayRecord(JSON.parse(JSON.stringify({ ...emptyPlayRecord(), takes: [take] }))).takes![0];
    expect(back.seed).toBe(4321);
    expect(takeApplier(back, { setUniform: () => {}, width: 10, height: 10 }).seed).toBe(4321);
    // A take from the rolling buffer (no seed while it ran) still gets one, so playing back and rendering agree.
    const r = new TakeCapture(emptyPlayRecord());
    for (let i = 0; i <= 30; i++) r.sample(i / 30);
    expect(r.toTake('Rolling')!.seed).toBeGreaterThan(0);
    r.dispose();
  });

  it('starts the layers over with it when recording starts, and when it plays back', () => {
    const seeded = vi.spyOn(playOverlay, 'startSeeded');
    useTakes.getState().setSettings({ countIn: false, manual: true });
    useTakes.getState().begin();
    expect(seeded).toHaveBeenCalledTimes(1);
    const seed = seeded.mock.calls[0][0];
    for (let i = 0; i <= 30; i++) inputBus.tick(1 / 30, i / 30);
    const replaying = vi.spyOn(playOverlay, 'setReplaying');
    useTakes.getState().stop();
    expect(useNodeGraphStore.getState().play.takes![0].seed).toBe(seed);
    expect(replaying).toHaveBeenCalledWith(true, seed);
  });
});

// ── Audio layers ─────────────────────────────────────────────────────────────

/** An analyser's frame: a sine wave, and a spectrum with a peak near `hz`. */
function rawAudio(amp: number, hz: number) {
  const wave = new Float32Array(2048).map((_, i) => amp * Math.sin((i / 2048) * Math.PI * 8));
  const freq = new Float32Array(1024).map((_, k) => (Math.abs(k * 23.4375 - hz) < 200 ? -30 : -95));
  return { wave, freq, sampleRate: 48000 };
}

/** The bands an audio layer draws from a spectrum (as klDrawAudio averages them), 0..1. */
function bands(freq: Float32Array, sampleRate: number, n: number): number[] {
  const binHz = sampleRate / 2 / freq.length;
  return Array.from({ length: n }, (_, i) => {
    const lo = 40 * Math.pow(300, i / n), hi = 40 * Math.pow(300, (i + 1) / n);
    const a = Math.max(1, Math.floor(lo / binHz)), z = Math.max(a, Math.min(freq.length - 1, Math.ceil(hi / binHz)));
    let s = 0; for (let k = a; k <= z; k++) s += Math.max(-110, freq[k]);
    return Math.max(0, Math.min(1, (s / (z - a + 1) + 90) / 75));
  });
}

describe('audio layers in a take', () => {
  it('a frame comes back as the waveform and the bands the layer draws', () => {
    const raw = rawAudio(0.6, 2000);
    const back = unpackAudioFrame(packAudioFrame(raw, true, true), true, true)!;
    expect(back.wave!.length).toBe(AUDIO_BINS * 2);
    // Every even point is a recorded one (every 16th sample of the layer's 128).
    for (let i = 0; i < AUDIO_BINS; i++) expect(back.wave![i * 2]).toBeCloseTo(raw.wave[i * 32], 1);
    const want = bands(raw.freq, raw.sampleRate, 48), got = bands(back.freq!, back.sampleRate, 48);
    for (let i = 0; i < 48; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(0.12);
    // Input off stays off.
    expect(unpackAudioFrame(packAudioFrame(null, true, false), true, false)).toBeNull();
  });

  it('round-trips through the take format and plays back frame by frame', () => {
    const buf = new AudioFrameBuffer('live', false, true);
    for (let i = 0; i < 60; i++) buf.push(i / 30, i < 30 ? rawAudio(0.5, 300) : rawAudio(0.5, 5000));
    buf.push(2, null);
    const track = buf.toTrack(0, 2)!;
    const take: PlayTake = { id: 'a', name: 'Take', from: 10, length: 2, tracks: [], events: [], audioFrames: [track] };
    const back = parsePlayRecord(JSON.parse(JSON.stringify({ ...emptyPlayRecord(), takes: [take] }, null, 2))).takes![0];
    expect(back.audioFrames).toEqual([track]);
    const low = bands(takeAudioAt(back, 10.5, 'live')!.freq!, 48000, 16), high = bands(takeAudioAt(back, 11.5, 'live')!.freq!, 48000, 16);
    expect(low.indexOf(Math.max(...low))).toBeLessThan(high.indexOf(Math.max(...high)));
    expect(takeAudioAt(back, 12, 'live')).toBeNull(); // the input went off at the end
    expect(takeAudioAt(back, 11, 'song')).toBeUndefined(); // not recorded: the live sound
    // Corrupt frames are dropped.
    const bad = parsePlayRecord({ takes: [{ ...take, audioFrames: [{ ...track, data: track.data.slice(8) }] }] }).takes![0];
    expect(bad.audioFrames).toBeUndefined();
  });

  it('are recorded only while an audio layer shows, and a minute of them fits the budget', () => {
    const audio = { ...defaultLayer('audio', 'au', 'Bars'), style: 'bars' } as PlayLayer;
    vi.spyOn(liveAudio, 'raw').mockImplementation(() => rawAudio(Math.random(), 100 + Math.random() * 8000));
    const hidden = new TakeCapture({ ...emptyPlayRecord(), layers: [{ ...audio, visible: false }] });
    useNodeGraphStore.getState().setPlay({ ...emptyPlayRecord(), layers: [{ ...audio, visible: false }] });
    for (let i = 0; i <= 60; i++) hidden.sample(i / 60);
    expect(hidden.toTake('Hidden')!.audioFrames).toBeUndefined();
    hidden.dispose();

    useNodeGraphStore.getState().setPlay({ ...emptyPlayRecord(), layers: [audio] });
    const c = new TakeCapture({ ...emptyPlayRecord(), layers: [audio] });
    for (let i = 0; i <= 60 * 60; i++) c.sample(i / 60);
    const take = c.toTake('Loud minute')!;
    c.dispose();
    expect(take.length).toBeCloseTo(60);
    expect(takeSize(take)).toBeLessThanOrEqual(TAKE_BUDGET);
    const frames = take.audioFrames![0].times.split(',').length;
    expect(frames).toBeGreaterThan(60 * 25); // about 30 a second
    expect(takeAudioAt(take, 30, 'live')).not.toBeNull();
    // Two sounds at full rate go over: they are thinned, not dropped.
    const song = { ...audio, id: 'song', input: 'file', style: 'wave' } as PlayLayer;
    vi.spyOn(playOverlay, 'hasLayers').mockReturnValue(true);
    const two = { ...emptyPlayRecord(), layers: [audio, song, { ...audio, id: 'wave', style: 'wave' } as PlayLayer] };
    useNodeGraphStore.getState().setPlay(two);
    const c2 = new TakeCapture(two);
    for (let i = 0; i <= 60 * 60; i++) c2.sample(i / 60);
    const busy = c2.toTake('Busy')!;
    c2.dispose();
    expect(takeSize(busy)).toBeLessThanOrEqual(TAKE_BUDGET);
    expect(busy.audioFrames!.length).toBeGreaterThanOrEqual(2);
  });

  it('are handed to the render', () => {
    const buf = new AudioFrameBuffer('live', true, false);
    buf.push(0, rawAudio(0.8, 100));
    const take: PlayTake = { id: 'a', name: 'Take', from: 0, length: 1, tracks: [], events: [], audioFrames: [buf.toTrack(0, 1)!] };
    const applier = takeApplier(take, { setUniform: () => {}, width: 10, height: 10 });
    const layer = defaultLayer('audio', 'au', 'Wave');
    expect(applier.audio(0.5)(layer)!.wave![2]).toBeCloseTo(rawAudio(0.8, 100).wave[32], 1);
  });
});

// ── Scrubbing ────────────────────────────────────────────────────────────────

describe('scrubbing a take', () => {
  const take: PlayTake = {
    id: 'scrub', name: 'Take 1', from: 10, length: 3, seed: 77, tracks: [],
    events: [{ t: 0.5, do: 'burst', layerId: 'p', amount: 60 }, { t: 2, do: 'burst', layerId: 'p', amount: 30 }],
  };
  const bursts = (calls: unknown[][]) => calls.flatMap(c => (c[3] as { amount: number }[]).map(a => a.amount));

  it('back to before a burst and forward past it again: the burst is back', () => {
    useNodeGraphStore.getState().setPlay({ ...emptyPlayRecord(), takes: [take] });
    const reset = vi.spyOn(playOverlay, 'resetLayers');
    const step = vi.spyOn(playOverlay, 'stepLayers').mockImplementation(() => {});
    const acted = vi.spyOn(playOverlay, 'replayAct');
    useTakes.getState().replay('scrub');
    inputBus.tick(1 / 60, 10);
    for (let i = 1; i <= 75; i++) inputBus.tick(1 / 60, 10 + i / 60); // plays through the first burst
    expect(acted.mock.calls.map(c => c[0].amount)).toEqual([60]);

    // Scrubbed back to 1 s: the layers start over and run up to there, first burst included.
    step.mockClear();
    inputBus.tick(1 / 60, 11);
    expect(reset).toHaveBeenCalled();
    expect(bursts(step.mock.calls)).toEqual([60]);
    expect(step.mock.calls[0][0]).toBe(10);
    expect(step.mock.calls[step.mock.calls.length - 1][0]).toBeLessThan(11);

    // Scrubbed forward past the second: it runs through the skipped time, the burst at its moment.
    step.mockClear();
    inputBus.tick(1 / 60, 12.8);
    expect(bursts(step.mock.calls)).toEqual([30]);
    const at = step.mock.calls.find(c => (c[3] as unknown[]).length)![0] as number;
    expect(at).toBeGreaterThanOrEqual(12);
    expect(at).toBeLessThan(12.1);
    // Never twice: carrying on plays nothing more.
    acted.mockClear(); step.mockClear();
    inputBus.tick(1 / 60, 12.82);
    expect(acted).not.toHaveBeenCalled();
    expect(step).not.toHaveBeenCalled();
  });

  it('back to the very start plays the first frame’s actions again', () => {
    useNodeGraphStore.getState().setPlay({ ...emptyPlayRecord(), takes: [{ ...take, events: [{ t: 0, do: 'burst', layerId: 'p', amount: 9 }] }] });
    vi.spyOn(playOverlay, 'stepLayers').mockImplementation(() => {});
    const acted = vi.spyOn(playOverlay, 'replayAct');
    useTakes.getState().replay('scrub');
    inputBus.tick(1 / 60, 10);
    inputBus.tick(1 / 60, 10.5);
    inputBus.tick(1 / 60, 10);
    expect(acted.mock.calls.map(c => c[0].amount)).toEqual([9, 9]);
  });
});
