/**
 * Video layers (docs/video-layer.md): what a file may hold and the defaults
 * it falls back to, where the video is at a clock time, its size on the
 * picture, the file kept in the backgrounds library (fake-indexeddb here),
 * the audio readers listening to its sound (and saying so when it's gone),
 * and what a web export carries.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
});

import { defaultLayer, emptyPlayRecord, parseLayer, parsePlayRecord, type PlayLayer, type PlayRecord, type VideoLayer } from '../../types/play';
import { videoLayerOfInput, videoLayerTimeAt, videoReaderInput } from '../../types/playLayers';
import { klVideoFit } from '../kit/layers.js';
import { layerBounds, patchFor } from '../transform';
import { addVideoFile, deleteVideo, getVideo, hasVideo, listVideos, resetBackgroundCache } from '../../lib/backgroundLibrary';
import { audioReaderBank } from '../../lib/audioReaderBank';
import { videoSound, type VideoSoundState } from '../../lib/videoSound';
import { readerInputOptions } from '../../components/play/readersPanelUi';
import { readerVideoNote } from '../../components/play/videoSoundUi';
import { leftBehind, mediaCarried, playBundle, type PlayHtmlInput, type PlayMedia } from '../exportHtml';
import { BUILTIN_LAYERS } from '../../components/play/layers/addLayerCatalog';

const video = (over: Partial<VideoLayer> = {}): VideoLayer => ({ ...(defaultLayer('video', 'v1', 'Clip') as VideoLayer), ...over });

describe('the record', () => {
  it('a new Video layer: no file, muted, following the clock', () => {
    const l = video();
    expect(l).toMatchObject({ kind: 'video', videoId: '', fileName: '', bytes: 0, fit: 'contain', scale: 1, sound: 'off', follow: true, playing: true, loop: true, speed: 1, start: 0, matte: 'over', blend: 'normal' });
  });

  it('a file keeps what is valid and falls back to the defaults for the rest', () => {
    const l = parseLayer({ id: 'v', kind: 'video', label: 'Clip', videoId: 'vid_1', fileName: 'a.mp4', bytes: 1234, sound: 'loud', fit: 'sideways', speed: 100, start: -3, volume: 4, follow: 'yes', src: 'data:video/mp4;base64,AAAA' }) as VideoLayer;
    expect(l.kind).toBe('video');
    expect(l.videoId).toBe('vid_1');
    expect(l.fileName).toBe('a.mp4');
    expect(l.bytes).toBe(1234);
    expect(l.sound).toBe('off');
    expect(l.fit).toBe('contain');
    expect(l.speed).toBe(8);
    expect(l.start).toBe(0);
    expect(l.volume).toBe(1);
    expect(l.follow).toBe(true);
    // The file itself never lives in the setup.
    expect('src' in l).toBe(false);
  });

  it('an old file without the kind still loads; masks and mattes are kept', () => {
    const p = parsePlayRecord({
      ...emptyPlayRecord(),
      layers: [{ id: 'm', kind: 'shape', label: 'M' }, { id: 'v', kind: 'video', label: 'V', trackMatte: { id: 'm', mode: 'alpha', invert: false } }],
      audioReaders: { input: 'video:v', readers: [{ id: 'r', name: 'Low', hz: 80 }] },
    });
    const v = p.layers.find(l => l.id === 'v') as VideoLayer;
    expect(v.trackMatte).toEqual({ id: 'm', mode: 'alpha', invert: false });
    expect(p.audioReaders?.input).toBe('video:v');
  });

  it('is on the Add layer menu next to Image', () => {
    const i = BUILTIN_LAYERS.findIndex(b => b.kind === 'image');
    expect(BUILTIN_LAYERS[i + 1]).toMatchObject({ kind: 'video', label: 'Video', group: 'textImages' });
  });
});

describe('the clock', () => {
  it('shows start + t × speed, looped or held before the end', () => {
    expect(videoLayerTimeAt(2, 10, 1, true, 0)).toBe(2);
    expect(videoLayerTimeAt(2, 10, 2, true, 1)).toBe(5);
    expect(videoLayerTimeAt(12, 10, 1, true, 0)).toBeCloseTo(2);
    expect(videoLayerTimeAt(12, 10, 1, false, 0)).toBeCloseTo(9.999);
    expect(videoLayerTimeAt(-1, 10, 1, true, 3)).toBe(3);
    // Length unknown yet: its start.
    expect(videoLayerTimeAt(5, NaN, 1, true, 1.5)).toBe(1.5);
  });

  it('fits a frame inside, around, or to the picture height', () => {
    // A 4:3 frame on a 16:9 picture: inside is as tall as the picture; around is taller.
    expect(klVideoFit('contain', 4 / 3, 16 / 9)).toBe(1);
    expect(klVideoFit('cover', 4 / 3, 16 / 9)).toBeCloseTo((16 / 9) / (4 / 3));
    // A 21:9 frame on a 16:9 picture: inside is shorter; around is the picture height.
    expect(klVideoFit('contain', 21 / 9, 16 / 9)).toBeCloseTo((16 / 9) / (21 / 9));
    expect(klVideoFit('cover', 21 / 9, 16 / 9)).toBe(1);
    expect(klVideoFit('height', 21 / 9, 16 / 9)).toBe(1);
  });

  it('has handles like an image, sized by its fit, and a corner drag scales it', () => {
    const l = video({ scale: 0.5, fit: 'cover' });
    const v = (x: PlayLayer, k: string) => (x as unknown as Record<string, number>)[k];
    const b = layerBounds(l, v, { textWidth: () => 0, mediaAspect: () => 2, fitHeight: () => 1.5 })!;
    expect(b).toMatchObject({ w: 1.5, h: 0.75, uniform: true, turns: true });
    expect(patchFor(l, b, { ...b, w: 3, h: 1.5 }, v).scale).toBe(1);
    // Before the frame has loaded there is no box.
    expect(layerBounds(l, v, { textWidth: () => 0, mediaAspect: () => 0 })).toBeNull();
  });
});

describe('the library keeps the file', () => {
  beforeEach(() => { (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); resetBackgroundCache(); });

  it('adds, reuses the same file, reads back and deletes', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'clip.webm', { type: 'video/webm' });
    const a = await addVideoFile(file);
    expect(a).toMatchObject({ name: 'clip.webm', bytes: 4, type: 'video/webm' });
    // The same file picked again: the same record.
    expect((await addVideoFile(file)).id).toBe(a.id);
    expect(await listVideos()).toHaveLength(1);
    const got = await getVideo(a.id);
    expect(new Uint8Array(await got!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(await hasVideo(a.id)).toBe(true);
    expect(await deleteVideo(a.id)).toBe(true);
    expect(await getVideo(a.id)).toBeNull();
    expect(await deleteVideo(a.id)).toBe(false);
  });
});

describe('audio readers on a video’s sound', () => {
  const SR = 48000, BINS = 1024;
  const spectrum = (loudHz: number) => {
    const f = new Float32Array(BINS).fill(-120);
    const k = Math.round(loudHz / (SR / 2 / BINS));
    for (let i = k - 1; i <= k + 1; i++) f[i] = -25;
    return f;
  };
  const analyser = (f: Float32Array) => ({ frequencyBinCount: BINS, context: { sampleRate: SR }, getFloatFrequencyData: (b: Float32Array) => b.set(f) }) as unknown as AnalyserNode;
  const rd = (id: string, hz: number) => ({ id, name: id, hz, width: 1 / 3, gain: 40, attack: 0, release: 0, colour: [1, 1, 1] as [number, number, number] });

  it('names a video layer as an input, and back', () => {
    expect(videoReaderInput('abc')).toBe('video:abc');
    expect(videoLayerOfInput('video:abc')).toBe('abc');
    expect(videoLayerOfInput('song1')).toBeNull();
    expect(videoLayerOfInput('')).toBeNull();
  });

  it('lists each Video layer in Listen to, and says when the chosen one is gone', () => {
    const layers = [video({ id: 'v1', label: 'Clip', sound: 'listen' }), video({ id: 'v2', label: 'Muted', sound: 'off' })];
    const opts = readerInputOptions('', [{ id: 'n1', label: 'Beat', file: 'beat.mp3' }], layers);
    expect(opts.map(o => o.label)).toEqual(['Live input (mic, interface, cable)', 'Song · Beat · beat.mp3', 'Video · Clip', 'Video · Muted (sound off)']);
    expect(opts[2].value).toBe('video:v1');
    // The layer was deleted: still listed, saying so (not as a song).
    const gone = readerInputOptions('video:v9', [], layers);
    expect(gone[gone.length - 1]).toEqual({ value: 'video:v9', label: 'Video · a layer no longer in the setup' });
    expect(readerVideoNote('Clip', 'gone')).toMatch(/deleted/);
    expect(readerVideoNote('Clip', 'off')).toMatch(/Sound is Off/);
    expect(readerVideoNote('Clip', 'paused')).toMatch(/paused/);
    expect(readerVideoNote('Clip', 'playing')).toBe('');
  });

  it('reads the video’s analyser; nothing (null) once the layer is gone', () => {
    let now = 1e12;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 20));
    const analysers = new Map<string, AnalyserNode>([['v1', analyser(spectrum(80))]]);
    const states = new Map<string, VideoSoundState>([['v1', 'playing']]);
    videoSound.setHost({ analyser: id => analysers.get(id) ?? null, state: id => states.get(id) ?? 'gone' });
    audioReaderBank.setConfig({ input: 'video:v1', readers: [rd('low', 80), rd('high', 6000)] });
    expect(audioReaderBank.inputState()).toBe('video');
    audioReaderBank.update();
    expect(audioReaderBank.value('low')).toBeGreaterThan(0.5);
    expect(audioReaderBank.value('high')).toBe(0);
    // The layer is deleted (or its sound turned off): the readers read nothing, and say why.
    analysers.delete('v1'); states.delete('v1');
    expect(audioReaderBank.inputState()).toBe('video-missing');
    audioReaderBank.update();
    expect(audioReaderBank.value('low')).toBeNull();
    expect(videoSound.state('v1')).toBe('gone');
    videoSound.setHost(null);
    vi.restoreAllMocks();
  });
});

describe('web export', () => {
  const base = (play: PlayRecord, media?: PlayMedia): PlayHtmlInput => ({ title: 'T', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play, aspect: '16:9', media });
  const withVideo = (over: Partial<VideoLayer> = {}): PlayRecord => ({ ...emptyPlayRecord(), layers: [video({ videoId: 'vid_1', fileName: 'clip.mp4', bytes: 3000, ...over })] });

  it('carries a small file in its layer, and says what it adds', () => {
    const src = 'data:video/mp4;base64,AAAA';
    const media: PlayMedia = { layerVideos: { v1: { label: 'Clip', name: 'clip.mp4', src, bytes: src.length } } };
    const play = withVideo();
    const bundle = playBundle(base(play, media));
    expect((bundle.play.layers[0] as VideoLayer & { src: string }).src).toBe(src);
    expect(mediaCarried(media, undefined, play)).toEqual([{ what: 'Video “clip.mp4” in Clip', bytes: src.length }]);
    expect(leftBehind(play, media)).toEqual([]);
    // The record itself is untouched.
    expect('src' in play.layers[0]).toBe(false);
  });

  it('leaves out a file too big to carry (as background videos do) or not open, and says so', () => {
    const big = withVideo({ bytes: 9 * 1024 * 1024 });
    const left = leftBehind(big, { layerVideos: { v1: { label: 'Clip', name: 'clip.mp4', src: null, bytes: 9 * 1024 * 1024 } } });
    expect(left).toHaveLength(1);
    expect(left[0].what).toBe('The video “clip.mp4” (9.0 MB) in Clip');
    expect(left[0].why).toMatch(/over 4\.0 MB/);
    expect((playBundle(base(big)).play.layers[0] as VideoLayer & { src: string }).src).toBe('');
    // Readers on it: the note says they hear nothing there.
    const heard = { ...big, audioReaders: { input: 'video:v1', readers: [{ id: 'r', name: 'Low', hz: 80, width: 1, gain: 20, attack: 5, release: 150, colour: [1, 1, 1] as [number, number, number] }] } };
    expect(leftBehind(heard, undefined)[0].why).toMatch(/audio readers hear nothing/);
    // Small but not opened this session.
    expect(leftBehind(withVideo(), undefined)[0].why).toMatch(/isn’t open in this session/);
    // No file picked: nothing to say.
    expect(leftBehind(withVideo({ videoId: '' }), undefined)).toEqual([]);
  });
});
