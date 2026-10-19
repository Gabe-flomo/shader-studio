/**
 * The Audio Source's three gaps (docs/audio-tools-plan.md): a picked sound is kept in the library and comes back after a
 * reload; the Video tab routes a video node's own sound into the analysis; and an exported page carries the sound and
 * runs the same per-frame sums as the app (the inlined kit, play/kit/audioTools.js), so on the same synthetic signal it
 * gives the same band levels, the same trigger frames, the same learned-sound matches and the same textures.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

/** The current analysis frame every fake analyser serves, and the fake Web Audio the engine reaches through audioEngine. */
const frame = vi.hoisted(() => ({ freq: new Float32Array(1024).fill(-200), wave: new Float32Array(2048), now: 0 }));
const fakes = vi.hoisted(() => {
  const analyser = () => ({
    fftSize: 2048, smoothingTimeConstant: 0, connect() {}, disconnect() {},
    getFloatFrequencyData(a: Float32Array) { a.set(frame.freq); },
    getFloatTimeDomainData(a: Float32Array) { a.set(frame.wave); },
  });
  const ctx = {
    sampleRate: 48000, state: 'running',
    createAnalyser: () => ({ ...analyser(), context: ctx }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {}, context: ctx }),
    createMediaElementSource: vi.fn(() => ({ connect() {}, disconnect() {}, context: ctx })),
    resume: () => Promise.resolve(),
  };
  const loaded = new Map<string, string>();
  const playingIds = new Set<string>();
  const audioEngine = {
    loadAudio: vi.fn(async (id: string, _buf: ArrayBuffer, name: string) => { loaded.set(id, name); }),
    isLoaded: (id: string) => loaded.has(id), duration: () => 4, isMasterPaused: () => false,
    startAudio: (id: string) => { playingIds.add(id); }, stopAudio: (id: string) => { playingIds.delete(id); }, removeAudio: (id: string) => { loaded.delete(id); playingIds.delete(id); },
    isPlaying: (id: string) => playingIds.has(id), position: () => 0, getFileName: (id: string) => loaded.get(id) ?? '',
    getAnalyser: (id: string) => (playingIds.has(id) ? { ...analyser(), context: ctx } : null),
    buffer: () => null, context: () => ctx, connectOutside: vi.fn(() => () => {}),
    setVolume: vi.fn(), positionAt: () => 0, heardTime: () => 0, outputLatency: () => 0, playToken: () => 1, seek: vi.fn(),
  };
  const el = { paused: false, currentTime: 1.5, muted: true };
  return { ctx, audioEngine, loaded, el };
});
vi.mock('../../audioEngine', () => ({ audioEngine: fakes.audioEngine }));
vi.mock('../../videoEngine', () => ({ videoEngine: { element: (id: string) => (id === 'vid' ? fakes.el : null) } }));

import type { GraphNode } from '../../../types/nodeGraph';
import { n } from '../../../store/graphBuilder';
import { compileGraph } from '../../../compiler/graphCompiler';
import { addVideoFile, deleteVideo, listVideos, isAudioType } from '../../backgroundLibrary';
import { audioToolsEngine } from '../engine';
import { audioToolsForWeb } from '../webExport';
import { spectrumDb } from '../dsp';
import { learnFromSamples } from '../learn';
import { buildPlayHtml, kitGroupsFor, kitScript, mediaCarried, playBundle, type PlayHtmlInput } from '../../../play/exportHtml';
import { webExportScope } from '../../../play/exportScope';
import type { AtListener, AtListenerSpec, AtSource } from '../../../play/kit/audioTools.js';
import { emptyPlayRecord } from '../../../types/play';
import { listenerSpecOf } from '../../../nodes/definitions/audioTools';

const host = { setTexture: () => {}, requestRender: () => {} };
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); };
afterEach(() => { audioToolsEngine.sync([]); audioToolsEngine.setHost(null); });

/** A tiny WAV file (silence), as a picked File. */
function wav(name: string, seconds = 0.1): File {
  const sr = 8000, len = Math.round(sr * seconds), b = new ArrayBuffer(44 + len * 2), v = new DataView(b);
  const s = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, len * 2, true);
  return new File([b], name, { type: 'audio/wav' });
}

describe('a picked sound is kept in the library', () => {
  it('is stored with the videos as a sound, and a reload opens it again from the node\'s sampleId', async () => {
    const meta = await addVideoFile(wav('beat.wav'));
    expect(isAudioType(meta.type)).toBe(true);
    expect((await listVideos()).filter(v => isAudioType(v.type)).map(v => v.name)).toContain('beat.wav');
    // "After a reload": nothing is open; the node only names the library id.
    fakes.loaded.clear();
    audioToolsEngine.setHost(host);
    audioToolsEngine.sync([n('audioSource', 'src', 0, 0, { sampleId: meta.id, _fileName: 'beat.wav' })]);
    expect(audioToolsEngine.status('src')).toMatch(/Opening "beat.wav" from the library/);
    await settle();
    expect(fakes.audioEngine.loadAudio).toHaveBeenCalledWith('src', expect.any(ArrayBuffer), 'beat.wav');
    expect(audioToolsEngine.sourceView('src')?.loaded).toBe(true);
    expect(audioToolsEngine.status('src')).toMatch(/^beat\.wav · playing/);
  });

  it('a sound removed from the library says so on the card', async () => {
    const meta = await addVideoFile(wav('gone.wav', 0.2));
    expect(await deleteVideo(meta.id)).toBe(true);
    fakes.loaded.clear();
    audioToolsEngine.setHost(host);
    audioToolsEngine.sync([n('audioSource', 'src2', 0, 0, { sampleId: meta.id, _fileName: 'gone.wav' })]);
    await settle();
    expect(audioToolsEngine.sourceView('src2')?.loaded).toBe(false);
    expect(audioToolsEngine.status('src2')).toMatch(/"gone.wav" isn't in this browser's library/);
  });
});

describe('the Video tab', () => {
  it('routes a video node\'s element into the analysis, reads its time, and lets go when the tab changes', () => {
    const nodes = (source: string): GraphNode[] => [
      n('videoInput', 'vid', 0, 0, { _fileName: 'clip.mp4' }),
      n('audioSource', 'vsrc', 0, 200, { source, videoNode: 'vid' }),
      n('audioBand', 'band', 300, 200, {}, { audio: ['vsrc', 'audio'] }),
    ];
    audioToolsEngine.setHost(host);
    audioToolsEngine.sync(nodes('video'));
    // A loud 100 Hz tone in the frame the "video" sounds.
    for (let i = 0; i < 2048; i++) frame.wave[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / 48000);
    frame.freq.set(spectrumDb(frame.wave));
    const written = new Map<string, number>();
    audioToolsEngine.tickInputs(1 / 60, 0, (k, v) => { written.set(k, v as number); });
    expect(fakes.ctx.createMediaElementSource).toHaveBeenCalledWith(fakes.el);
    expect(audioToolsEngine.videoRouted('vsrc')).toBe(fakes.el);
    expect(fakes.el.muted).toBe(false);
    expect(written.get('vsrc::time')).toBe(1.5);
    expect(written.get('vsrc::level')).toBeGreaterThan(0.5);
    expect(written.get('band::level')).toBeGreaterThan(0);
    expect(audioToolsEngine.status('vsrc')).toMatch(/clip\.mp4 · playing/);
    // Back to File: the video's sound is let go (and muted again, as the video node plays it).
    audioToolsEngine.sync(nodes('file'));
    expect(audioToolsEngine.videoRouted('vsrc')).toBeNull();
    expect(fakes.el.muted).toBe(true);
    // No video picked: the card asks for one.
    audioToolsEngine.sync([n('audioSource', 'vsrc', 0, 0, { source: 'video' })]);
    expect(audioToolsEngine.status('vsrc')).toMatch(/Pick a video node/);
    frame.wave.fill(0); frame.freq.fill(-200);
  });
});

// ── Web export ───────────────────────────────────────────────────────────────────────────────────────────────

/** Audio Source (a Kick band with a trigger, a learned sound) → Band level, Hit, Spectrum, Spectrogram, Waveform. */
function audioGraph(sounds: unknown[] = []): GraphNode[] {
  return [
    n('audioSource', 'src', 0, 0, { _fileName: 'loop.wav', gain: 1.5, bands: [{ id: 'b1', name: 'Kick', lo: 30, hi: 150, value: true, trigger: true, cooldown: 120 }, { id: 'b2', name: 'Air', lo: 6000, hi: 16000 }], sounds }),
    n('audioBand', 'band', 300, 0, { band: 'bass' }, { audio: ['src', 'audio'] }),
    n('audioHit', 'hit', 300, 100, { sound: 'kick' }, { audio: ['src', 'audio'] }),
    n('audioSpectrum', 'spec', 300, 200, { bins: '64' }, { audio: ['src', 'audio'] }),
    n('audioSpectrogram', 'gram', 300, 300, { bins: '64', history: '64' }, { audio: ['src', 'audio'] }),
    n('audioWaveform', 'wave', 300, 400, { samples: '256' }, { audio: ['src', 'audio'] }),
    n('add', 'a1', 500, 0, {}, { a: ['band', 'level'], b: ['hit', 'envelope'] }),
    n('add', 'a2', 600, 0, {}, { a: ['a1', 'result'], b: ['spec', 'value'] }),
    n('add', 'a3', 700, 0, {}, { a: ['a2', 'result'], b: ['gram', 'value'] }),
    n('add', 'a4', 800, 0, {}, { a: ['a3', 'result'], b: ['wave', 'value'] }),
    n('add', 'a5', 900, 0, {}, { a: ['a4', 'result'], b: ['src', 'b1_t'] }),
    n('output', 'out', 1000, 0, {}, { color: ['a5', 'result'] }),
  ];
}

/** A synthetic beat at 48 kHz: a decaying 60 Hz kick every 0.5 s, and a short noise burst (a hi-hat) between. */
function beat(seconds: number): Float32Array {
  const sr = 48000, out = new Float32Array(Math.round(seconds * sr));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr, k = t % 0.5, h = (t + 0.25) % 0.5;
    out[i] = 0.8 * Math.exp(-k * 18) * Math.sin(2 * Math.PI * 60 * k) + (h < 0.03 ? 0.3 * rnd() * Math.exp(-h * 120) : 0);
  }
  return out;
}

describe('an exported page runs the Audio nodes', () => {
  it('carries the sound, every listening node\'s settings, and the uniforms and samplers they fill', () => {
    const nodes = audioGraph();
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    const tools = audioToolsForWeb({
      nodes, liveUniforms: r.liveUniforms, textureUniforms: r.textureUniforms, videoUniforms: r.videoUniforms ?? {},
      mediaOf: id => (id === 'src' ? { kind: 'audio', name: 'loop.wav', bytes: 1000, dataUrl: 'data:audio/wav;base64,UklGRg==', tooBig: false } : null),
    })!;
    expect(tools.sources).toHaveLength(1);
    expect(tools.sources[0]).toMatchObject({ id: 'src', kind: 'file', name: 'loop.wav', src: 'data:audio/wav;base64,UklGRg==', gain: 1.5 });
    expect(tools.sources[0].bands.map(b => b.id)).toEqual(['b1', 'b2']);
    expect(tools.listeners.map(l => [l.id, l.sourceId, l.w, l.h])).toEqual([['band', 'src', 0, 0], ['hit', 'src', 0, 0], ['spec', 'src', 64, 1], ['gram', 'src', 64, 64], ['wave', 'src', 256, 1]]);
    // Every live uniform the shader reads is filled, every sampler too.
    expect(Object.keys(tools.uniforms).sort()).toEqual(Object.keys(r.liveUniforms).filter(u => u.startsWith('u_aud_')).sort());
    expect(Object.values(tools.textures).sort()).toEqual(['gram', 'spec', 'wave']);

    const input: PlayHtmlInput = {
      title: 'Audio page', fragmentShader: r.fragmentShader, uniforms: {}, paramBindings: {}, play: emptyPlayRecord(), aspect: 'free',
      media: { textures: {}, videos: {}, audio: [], audioTools: tools },
    } as unknown as PlayHtmlInput;
    const bundle = playBundle(input);
    expect(kitGroupsFor(bundle).has('audioTools')).toBe(true);
    expect((bundle.media as { audioTools?: { sources: Array<{ src: string | null }> } }).audioTools?.sources[0].src).toBe('data:audio/wav;base64,UklGRg==');
    expect(mediaCarried(input.media).map(m => m.what)).toContain('Sound “loop.wav” in Audio Source');
    const html = buildPlayHtml(input);
    expect(html).toContain('function atStepSource');
    expect(html).toContain('Tap to start sound');
    // A Mic source is left out of a page (the microphone never comes along) and said so.
    const mic = webExportScope({ ...input, media: { ...input.media!, audioTools: { ...tools, sources: [{ ...tools.sources[0], kind: 'mic', src: null }] } } });
    expect(mic.input.media?.audioTools?.sources).toEqual([]);
    expect(mic.frozen.map(f => f.what)).toContain('The microphone and live audio');
  });

  it('the page\'s inlined kit gives the same band levels, trigger frames, matches and textures as the app\'s engine', async () => {
    const sr = 48000, signal = beat(3);
    // Learn the kick from the first beat, as the window's Learn does.
    const learned = learnFromSamples(signal, sr, 0, 0.2);
    if ('error' in learned) throw new Error(learned.error);
    const nodes = audioGraph([{ id: 's1', name: 'Kick', match: 0.7, cooldown: 150, trigger: true, matchOut: true, spec: learned.spec, env: learned.env }]);
    const r = compileGraph({ nodes });
    const tools = audioToolsForWeb({ nodes, liveUniforms: r.liveUniforms, textureUniforms: r.textureUniforms, videoUniforms: {}, mediaOf: () => null })!;

    // The page: SSKit as the export inlines it, driven exactly as play-runtime.js tickAudioTools drives it.
    const SSKit = new Function(`${kitScript(new Set(['audioTools']))}\nreturn SSKit;`)() as {
      audioTools: {
        newSource(): AtSource; newListener(type: string, w: number, h: number): AtListener; applyGain(f: Float32Array, w: Float32Array, g: number): number;
        stepSource(...a: unknown[]): void; stepListener(l: AtListener, spec: AtListenerSpec, ...a: unknown[]): boolean;
      };
    };
    const K = SSKit.audioTools;
    const src = tools.sources[0], pageSt = K.newSource();
    const pageLis = tools.listeners.map(l => ({ cfg: l, run: K.newListener(l.spec.type, l.w, l.h) }));

    // The app: the engine with its "file" playing through the fake analyser.
    audioToolsEngine.setHost(host);
    audioToolsEngine.sync(nodes);
    expect(await audioToolsEngine.loadFile('src', wav('loop.wav'))).toBeNull();
    const nowSpy = vi.spyOn(performance, 'now');
    // Both start with no frame before (the first step takes 1/60 s).
    (audioToolsEngine as unknown as { lastTick: number }).lastTick = 0;

    const appTrig: number[] = [], pageTrig: number[] = [], appMatch: number[] = [], pageMatch: number[] = [];
    let compared = 0;
    let last = 0;
    for (let f = 1; f * 800 <= signal.length; f++) {
      const end = f * 800, block = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) { const k = end - 2048 + i; block[i] = k >= 0 ? signal[k] : 0; }
      frame.wave.set(block); frame.freq.set(spectrumDb(block));
      const nowMs = (f * 800 / sr) * 1000;
      nowSpy.mockReturnValue(nowMs);
      const app = new Map<string, number>();
      audioToolsEngine.tickInputs(1 / 60, 0, (k, v) => { app.set(k, v as number); });

      const page = new Map<string, number>();
      const dt = last ? Math.min(0.1, (nowMs - last) / 1000) : 1 / 60;
      last = nowMs;
      const freq = new Float32Array(frame.freq), wave = new Float32Array(frame.wave);
      page.set('src::level', K.applyGain(freq, wave, src.gain));
      K.stepSource(pageSt, src.bands, src.sounds, freq, sr, nowMs / 1000, dt, (ch: string, v: number) => page.set(`src::${ch}`, v), { delay: 0, wave });
      for (const l of pageLis) K.stepListener(l.run, l.cfg.spec, freq, wave, sr, true, nowMs, dt, (ch: string, v: number) => page.set(`${l.cfg.id}::${ch}`, v));

      for (const [k, v] of page) { expect(app.get(k), `${k} at frame ${f}`).toBe(v); compared++; }
      if (app.get('src::b1_t')) appTrig.push(f);
      if (page.get('src::b1_t')) pageTrig.push(f);
      if (app.get('src::s1_t')) appMatch.push(f);
      if (page.get('src::s1_t')) pageMatch.push(f);
      for (const l of pageLis) if (l.run.data) expect(Array.from(audioToolsEngine.readout(l.cfg.id)!.data!)).toEqual(Array.from(l.run.data));
    }
    nowSpy.mockRestore();
    expect(compared).toBeGreaterThan(1000);
    // The kicks fire the Kick band's trigger and the learned Kick, on the same frames in both.
    expect(appTrig.length).toBeGreaterThanOrEqual(5);
    expect(pageTrig).toEqual(appTrig);
    expect(appMatch.length).toBeGreaterThanOrEqual(4);
    expect(pageMatch).toEqual(appMatch);
    // The spec the page gets is the engine's own.
    expect(tools.listeners.find(l => l.id === 'hit')!.spec).toEqual(listenerSpecOf(nodes.find(x => x.id === 'hit')!));
  });
});
