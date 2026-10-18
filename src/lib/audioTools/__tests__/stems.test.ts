/**
 * An Audio Source's stems (docs/stems.md, lib/audioTools/stems.ts): kept in the library beside the song, the Stem
 * picker routing (the analysis reads the stem, the speakers the mix unless Hear: This stem), the audio engine playing
 * the stem in step with the song, and web pages / play files carrying the stem.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

/** Two analysis frames: the song's (loud) and the stem's (quiet), and a fake audio engine with a stem slot. */
const fx = vi.hoisted(() => {
  const mixFreq = new Float32Array(1024).fill(-20), stemFreq = new Float32Array(1024).fill(-90);
  const wave = (a: number) => Float32Array.from({ length: 2048 }, (_, i) => a * Math.sin(i / 5));
  // An analyser connected into another (the engine's probe) reads what it is fed.
  type An = { src: An | null; freq: Float32Array; w: Float32Array; connect(p: An): void; disconnect(): void; getFloatFrequencyData(a: Float32Array): void; getFloatTimeDomainData(a: Float32Array): void; fftSize: number; smoothingTimeConstant: number };
  const analyser = (freq: Float32Array, w: Float32Array): An => ({
    fftSize: 2048, smoothingTimeConstant: 0, src: null, freq, w,
    connect(p: An) { p.src = this; }, disconnect() {},
    getFloatFrequencyData(a: Float32Array) { a.set((this.src ?? this).freq); }, getFloatTimeDomainData(a: Float32Array) { a.set((this.src ?? this).w); },
  });
  const ctx: Record<string, unknown> = {
    sampleRate: 48000, state: 'running',
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {}, context: ctx }),
    decodeAudioData: vi.fn(async () => ({ length: 480, sampleRate: 48000, numberOfChannels: 1, duration: 0.01, getChannelData: () => new Float32Array(480).fill(0.25) })),
    resume: () => Promise.resolve(),
  };
  ctx.createAnalyser = () => ({ ...analyser(mixFreq, wave(0.9)), context: ctx });
  const playing = new Set<string>(), loaded = new Map<string, string>();
  const stems = new Map<string, unknown>(), hear = new Map<string, boolean>();
  const mixAn = { ...analyser(mixFreq, wave(0.9)), context: ctx }, stemAn = { ...analyser(stemFreq, wave(0.0005)), context: ctx };
  const audioEngine = {
    loadAudio: vi.fn(async (id: string, _b: ArrayBuffer, name: string) => { loaded.set(id, name); stems.delete(id); }),
    isLoaded: (id: string) => loaded.has(id), duration: () => 4, isMasterPaused: () => false,
    startAudio: (id: string) => { playing.add(id); }, stopAudio: (id: string) => { playing.delete(id); }, removeAudio: (id: string) => { loaded.delete(id); playing.delete(id); stems.delete(id); },
    isPlaying: (id: string) => playing.has(id), position: () => 0, getFileName: (id: string) => loaded.get(id) ?? '',
    getAnalyser: (id: string) => (loaded.has(id) ? mixAn : null),
    buffer: () => ({ length: 480, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(480) }),
    context: () => ctx, connectOutside: vi.fn(() => () => {}),
    setStem: vi.fn((id: string, b: unknown) => { if (b) stems.set(id, b); else stems.delete(id); }),
    setHearStem: vi.fn((id: string, on: boolean) => { hear.set(id, on); }),
    stemAnalyser: (id: string) => (stems.has(id) ? stemAn : null),
    stemBuffer: (id: string) => (stems.get(id) ?? null),
  };
  return { audioEngine, stems, hear, ctx };
});
vi.mock('../../audioEngine', () => ({ audioEngine: fx.audioEngine, trackChainId: (k: string) => `node:${k}` }));

import type { GraphNode } from '../../../types/nodeGraph';
import { addVideoFile, getVideo, listVideos } from '../../backgroundLibrary';
import { audioToolsEngine } from '../engine';
import { audioToolsForWeb } from '../webExport';
import { analysedStem, analysedStemId, availableStems, hearsStem, isStemSampleId, removeStems, saveStems, stemOptions, stemsOf, type StemsBake } from '../stems';
import { mediaSource } from '../../mediaSources';
import { leftBehind, mediaCarried } from '../../../play/exportHtml';
import { emptyPlayRecord } from '../../../types/play';
import { videoIdsIn } from '../../../playfile/bundle';

const host = { setTexture: () => {}, requestRender: () => {} };
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); };
afterEach(() => { audioToolsEngine.sync([]); audioToolsEngine.setHost(null); });

const source = (params: Record<string, unknown>): GraphNode => ({
  id: 'src', type: 'audioSource', position: { x: 0, y: 0 }, inputs: {}, outputs: {},
  params: { source: 'file', playing: true, loop: true, gain: 1, sampleId: 'snd_song', _fileName: 'Song.mp3', bands: [], sounds: [], trimIn: 0, trimOut: 0, stem: 'mix', hear: 'mix', stems: null, ...params },
} as unknown as GraphNode);
const bake = (tracks: StemsBake['tracks'], of = 'snd_song'): StemsBake => ({ model: 'htdemucs', revision: 'r', of, tracks, at: 1 });

describe('the stems bake', () => {
  it('belongs to the song it was made from; the picker lists Full mix and the stems it has', () => {
    const b = bake([{ stem: 'bass', sampleId: 'stem_b', type: 'audio/webm', bytes: 10 }, { stem: 'drums', sampleId: 'stem_d', type: 'audio/webm', bytes: 10 }]);
    expect(stemsOf({ sampleId: 'snd_song', stems: b })?.tracks).toHaveLength(2);
    expect(stemsOf({ sampleId: 'snd_other', stems: b })).toBeNull();
    expect(availableStems(b)).toEqual(['drums', 'bass']);
    expect(stemOptions(b).map(o => o.label)).toEqual(['Full mix', 'Drums', 'Bass']);
    // A stem the bake doesn't have reads the mix; Hear: This stem only with a stem picked
    expect(analysedStem({ sampleId: 'snd_song', stems: b, stem: 'vocals' })).toBe('mix');
    expect(analysedStemId({ sampleId: 'snd_song', stems: b, stem: 'drums' })).toBe('stem_d');
    expect(hearsStem({ sampleId: 'snd_song', stems: b, stem: 'mix', hear: 'stem' })).toBe(false);
    expect(hearsStem({ sampleId: 'snd_song', stems: b, stem: 'bass', hear: 'stem' })).toBe(true);
  });

  it('keeps each stem in the library (ids stem_…), and removes them again', async () => {
    const r = {
      stems: [
        { name: 'drums' as const, bytes: new Uint8Array([1, 2, 3]), type: 'audio/webm', codec: 'opus' as const },
        { name: 'vocals' as const, bytes: new Uint8Array([4, 5]), type: 'audio/wav', codec: 'wav' as const },
      ], backend: 'webgpu' as const, threads: 1, ms: 1234,
    };
    const b = await saveStems({ id: 'snd_song', name: 'Song.mp3' }, 'htdemucs', r);
    expect(b).toMatchObject({ model: 'htdemucs', revision: 'a4a57cc0cf707e5b9a3e6ad3c2c4b21fcbe608c1', of: 'snd_song', backend: 'webgpu', ms: 1234 });
    expect(b.tracks.map(t => [t.stem, t.type, t.bytes])).toEqual([['drums', 'audio/webm', 3], ['vocals', 'audio/wav', 2]]);
    for (const t of b.tracks) expect(isStemSampleId(t.sampleId)).toBe(true);
    const kept = await getVideo(b.tracks[0].sampleId);
    expect(kept?.name).toBe('Song · Drums.weba');
    expect(new Uint8Array(await kept!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    await removeStems(b);
    expect((await listVideos()).filter(v => isStemSampleId(v.id))).toEqual([]);
  });

  it('a play file carries the stems: their ids are sampleIds in the saved graph', () => {
    const g = { nodes: [source({ stems: bake([{ stem: 'drums', sampleId: 'stem_d', type: 'audio/webm', bytes: 1 }]) })] };
    expect(videoIdsIn([{ kind: 'graph', data: JSON.stringify(g) } as never]).sort()).toEqual(['snd_song', 'stem_d']);
  });
});

describe('the Stem picker routes the analysis', () => {
  async function withStem(params: Record<string, unknown>) {
    const meta = await addVideoFile(new File([new Uint8Array([9, 9, 9, 9])], 'Song · Drums.weba', { type: 'audio/webm' }), { id: `stem_test_${Math.random().toString(36).slice(2)}` });
    const n = source({ stems: bake([{ stem: 'drums', sampleId: meta.id, type: 'audio/webm', bytes: 4 }]), ...params });
    audioToolsEngine.setHost(host);
    audioToolsEngine.sync([n]);
    expect(await audioToolsEngine.loadFile('src', new File([new Uint8Array(8)], 'Song.mp3'))).toBeNull();
    await settle();
    return { n, id: meta.id };
  }
  const level = () => {
    const writes = new Map<string, number>();
    audioToolsEngine.tickInputs(1 / 60, 0, (k, v) => writes.set(k, v as number));
    return writes.get('src::level')!;
  };

  it('Full mix: the song\'s analyser, no stem loaded', async () => {
    await withStem({ stem: 'mix' });
    expect(fx.stems.has('src')).toBe(false);
    expect(level()).toBeGreaterThan(0.5);
    expect(audioToolsEngine.sourceView('src')?.stem).toBe('mix');
  });

  it('Drums: the stem is loaded from the library and the analysis reads it; you still hear the mix', async () => {
    const { id } = await withStem({ stem: 'drums' });
    expect(fx.stems.has('src')).toBe(true);
    expect(fx.hear.get('src')).toBe(false);
    expect(level()).toBeLessThan(0.2); // the quiet stem, not the loud mix
    expect(audioToolsEngine.sourceView('src')?.stem).toBe('drums');
    expect(audioToolsEngine.status('src')).toMatch(/analysing Drums/);
    // Kept for a web page as the song is
    expect(mediaSource('src::stem')?.name).toBe('Song · Drums.weba');
    // Learn a sound reads the stem's samples
    expect(fx.audioEngine.stemBuffer('src')).toBeTruthy();
    void id;
  });

  it('Hear: This stem plays the stem on the speakers', async () => {
    await withStem({ stem: 'drums', hear: 'stem' });
    expect(fx.hear.get('src')).toBe(true);
    expect(audioToolsEngine.status('src')).toMatch(/\(heard\)/);
  });

  it('back to Full mix takes the stem away', async () => {
    const { n } = await withStem({ stem: 'drums' });
    audioToolsEngine.sync([{ ...n, params: { ...n.params, stem: 'mix' } }]);
    await settle();
    expect(fx.stems.has('src')).toBe(false);
    expect(level()).toBeGreaterThan(0.5);
  });

  it('a stem missing from the library: the mix is analysed and the card says so', async () => {
    const n = source({ stem: 'drums', stems: bake([{ stem: 'drums', sampleId: 'stem_gone', type: 'audio/webm', bytes: 4 }]) });
    audioToolsEngine.setHost(host);
    audioToolsEngine.sync([n]);
    await audioToolsEngine.loadFile('src', new File([new Uint8Array(8)], 'Song.mp3'));
    await settle();
    expect(fx.stems.has('src')).toBe(false);
    expect(audioToolsEngine.status('src')).toMatch(/stems aren't in this browser's library/);
    expect(level()).toBeGreaterThan(0.5);
  });
});

describe('web pages carry the stem', () => {
  const MB = 1024 * 1024;
  const input = (stemMedia: { dataUrl: string | null; bytes: number; tooBig: boolean }) => ({
    nodes: [source({ stem: 'drums', hear: 'mix', stems: bake([{ stem: 'drums', sampleId: 'stem_d', type: 'audio/webm', bytes: 4 }]) })],
    liveUniforms: {}, textureUniforms: {}, videoUniforms: {},
    mediaOf: (id: string) => (id === 'src' ? { kind: 'audio' as const, name: 'Song.mp3', bytes: 4, dataUrl: 'data:audio/mpeg;base64,AAAA', tooBig: false }
      : id === 'src::stem' ? { kind: 'audio' as const, name: 'Song · Drums.weba', ...stemMedia } : null),
  });

  it('a small stem rides along: the page analyses it and plays the song', () => {
    const t = audioToolsForWeb(input({ dataUrl: 'data:audio/webm;base64,BBBB', bytes: 4, tooBig: false }))!;
    expect(t.sources[0].stem).toEqual({ name: 'Song · Drums.weba', label: 'Audio Source', src: "data:audio/webm;base64,BBBB", bytes: 27, stem: 'Drums', hear: false });
    const media = { audioTools: t };
    expect(mediaCarried(media).map(m => m.what)).toContain('Stem “Song · Drums.weba” in Audio Source');
    expect(leftBehind(emptyPlayRecord(), media).filter(l => /stem/.test(l.what))).toEqual([]);
  });

  it('a stem over the limit stays out, and the export says the page analyses the whole song', () => {
    const t = audioToolsForWeb(input({ dataUrl: null, bytes: 9 * MB, tooBig: true }))!;
    expect(t.sources[0].stem?.src).toBeNull();
    const left = leftBehind(emptyPlayRecord(), { audioTools: t }).find(l => /Drums stem/.test(l.what));
    expect(left?.why).toMatch(/whole song/);
  });

  it('no stem picked: nothing extra', () => {
    const t = audioToolsForWeb({ ...input({ dataUrl: null, bytes: 0, tooBig: false }), nodes: [source({})] })!;
    expect(t.sources[0].stem).toBeUndefined();
  });
});
