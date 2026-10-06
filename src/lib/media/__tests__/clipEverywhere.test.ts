/**
 * The clip editor as the app's one video editor (docs/clip-editor.md): the playlist maths every
 * playback host shares (play/kit/clipPlay.js: segments, reverse, speed, loop), the per-host
 * capabilities, what Result steps through (a playback host's playlist frames, the Time Cube's
 * frames in cube order), saving and migration (no clip: exactly as before), the GLSL crop, and
 * the web page's kit giving the same answers as the app.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { cpAt, cpFollow, cpFrames, cpIsPlain, cpLength, cpParse, cpPlaylist, cpResolve, cpTextureAffine } from '../../../play/kit/clipPlay.js';
import {
  CLIP_CAPS, HOST_OWN_SPEED, clipGlsl, cubeSequence, isPlaybackHost, outputToSource, playbackFrames, savedFromSettings, settingsFromSaved,
  type ClipHost, type ClipSettings,
} from '../clip';
import { planFrameStack, stackSettingsOf } from '../../timeCube/plan';
import { frameOrder, orderSettingsOf } from '../../timeCube/order';
import { parseLayer, parseBackgroundItems, type VideoLayer } from '../../../types/playLayers';
import { videoLayerClipAt } from '../../../play/videoLayers';
import { getNodeDefinition } from '../../../nodes/definitions';
import { kitScript, playBundle, type PlayHtmlInput } from '../../../play/exportHtml';
import { parsePlayRecord } from '../../../types/play';
import type { GraphNode } from '../../../types/nodeGraph';

const R = (a: number, b: number, reverse = false) => ({ in: a, out: b, reverse });

describe('the playlist (cpAt)', () => {
  const segs = [R(1, 3), R(5, 6, true), R(8, 9)];

  it('plays the segments one after another, a reversed one backwards', () => {
    expect(cpAt(segs, 0, 1, true)).toMatchObject({ time: 1, k: 0, reverse: false });
    expect(cpAt(segs, 1.5, 1, true).time).toBeCloseTo(2.5, 9);
    // Into the reversed segment: from its out down.
    expect(cpAt(segs, 2, 1, true)).toMatchObject({ k: 1, reverse: true });
    expect(cpAt(segs, 2, 1, true).time).toBeCloseTo(6 - 1e-3, 9);
    expect(cpAt(segs, 2.25, 1, true).time).toBeCloseTo(5.75, 9);
    expect(cpAt(segs, 3.5, 1, true)).toMatchObject({ k: 2 });
    expect(cpAt(segs, 3.5, 1, true).time).toBeCloseTo(8.5, 9);
  });

  it('speed scales the clock: 2× plays the 4 kept seconds in 2', () => {
    expect(cpLength(segs, 2)).toBeCloseTo(2, 9);
    expect(cpAt(segs, 0.75, 2, true).time).toBeCloseTo(2.5, 9);
    expect(cpAt(segs, 1.125, 2, true).time).toBeCloseTo(5.75, 9);
  });

  it('loops round, or holds the last frame', () => {
    expect(cpAt(segs, 4 + 0.5, 1, true).time).toBeCloseTo(1.5, 9);
    const end = cpAt(segs, 10, 1, false);
    expect(end.done).toBe(true);
    expect(end.k).toBe(2);
    expect(end.time).toBeCloseTo(9 - 1e-3, 9);
    // A last segment that is reversed holds its in.
    expect(cpAt([R(0, 1), R(2, 3, true)], 10, 1, false).time).toBeCloseTo(2, 9);
  });

  it('resolves "to the end" outs and empty segments as the Time Cube does', () => {
    expect(cpResolve([{ in: 2, out: 0 }], 5)).toEqual([R(2, 5)]);
    expect(cpResolve([{ in: 9, out: 12 }], 5)).toEqual([R(5 - 1e-3, 5)]);
    expect(cpResolve([], 5)).toEqual([R(0, 5)]);
  });

  it('the frames Result steps through are exactly cpAt at each frame time', () => {
    const f = cpFrames(segs, 1.5, true, 24);
    expect(f.length).toBe(Math.ceil((4 / 1.5) * 24));
    f.forEach((t, i) => expect(t).toBe(cpAt(segs, i / 24, 1.5, true).time));
    const c: ClipSettings = { segments: [{ in: 1, out: 3 }, { in: 5, out: 6, reverse: true }, { in: 8, out: 9 }], distribute: 'proportional', ramp: 'none', xf: { crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, flipX: false, flipY: false }, speed: 1.5, loop: true };
    expect(playbackFrames(c, 10, 24)).toEqual(f);
  });
});

describe('following a <video> (cpFollow)', () => {
  const fake = (t: number, paused = true) => {
    const el = { currentTime: t, paused, seeking: false, readyState: 4, playbackRate: 1, played: 0, play() { this.paused = false; this.played++; return Promise.resolve(); }, pause() { this.paused = true; } };
    return el;
  };
  it('forwards: plays at the speed, seeks only on a jump into another segment', () => {
    const segs = [R(1, 2), R(5, 6)];
    const el = fake(1.5);
    cpFollow(el as unknown as HTMLVideoElement, cpAt(segs, 0.25, 2, true), segs[0], 2, true);
    expect(el.paused).toBe(false);
    expect(el.playbackRate).toBe(2);
    expect(el.currentTime).toBe(1.5);
    // The playlist moved on to segment 2: the element is still past segment 1's out.
    el.currentTime = 2.04;
    const at = cpAt(segs, 0.55, 2, true);
    cpFollow(el as unknown as HTMLVideoElement, at, segs[at.k], 2, true);
    expect(el.currentTime).toBeCloseTo(5.1, 9);
  });
  it('backwards or stopped: paused, on the frame', () => {
    const segs = [R(1, 2, true)];
    const el = fake(1.9, false);
    const at = cpAt(segs, 0.5, 1, true);
    cpFollow(el as unknown as HTMLVideoElement, at, segs[0], 1, true);
    expect(el.paused).toBe(true);
    expect(el.currentTime).toBeCloseTo(1.5, 9);
  });
});

describe('the editor’s conveniences', () => {
  it('reads the filmstrip in view first, outwards, skipping what is kept', async () => {
    const { thumbOrder } = await import('../../../components/media/ClipEditor');
    expect(thumbOrder(8, 0, 1, new Set())).toEqual([3, 4, 2, 5, 1, 6, 0, 7]);
    expect(thumbOrder(8, 0.5, 0.75, new Set([4]))).toEqual([5, 3, 6, 2, 7, 1, 0]);
  });
  it('remembers Source / Result per host', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
    const { rememberedMode } = await import('../../../components/media/ClipEditor');
    expect(rememberedMode('timeCube')).toBe('source');
    store.set('shader-studio:clip-editor:preview:timeCube', 'result');
    expect(rememberedMode('timeCube')).toBe('result');
    expect(rememberedMode('videoLayer')).toBe('source');
  });
});

describe('capabilities per host', () => {
  it('the Time Cube samples frames; playback hosts get speed and loop; a viewer edits nothing', () => {
    expect(CLIP_CAPS.timeCube).toMatchObject({ frameSamples: true, ramp: true, distribute: true, segments: true, crop: true, speed: false, loop: false, edit: true });
    for (const h of ['videoInput', 'videoLayer'] as ClipHost[]) expect(CLIP_CAPS[h]).toMatchObject({ trim: true, segments: true, reverse: true, speed: true, loop: true, crop: true, rotate: true, flip: true, frameSamples: false, ramp: false, edit: true });
    expect(CLIP_CAPS.baked).toMatchObject({ trim: true, segments: false, speed: true, loop: true, crop: true, rotate: false, flip: false, frameSamples: false });
    expect(CLIP_CAPS.background).toMatchObject({ trim: true, segments: true, speed: true, loop: true, crop: false, rotate: false });
    expect(Object.values(CLIP_CAPS.viewer).every(v => v === false)).toBe(true);
    expect(isPlaybackHost('timeCube')).toBe(false);
    expect(isPlaybackHost('viewer')).toBe(false);
    expect(isPlaybackHost('baked')).toBe(true);
    expect(HOST_OWN_SPEED.baked).toBe(false);
    expect(HOST_OWN_SPEED.videoLayer).toBe(true);
  });
});

describe('Result for the Time Cube: the sampled frames in cube order', () => {
  it('is the plan’s times permuted by Frame order, exactly', () => {
    const params = { frames: 24, segments: [{ in: 1, out: 3 }, { in: 6, out: 8, reverse: true }], clip: { ramp: 'easeIn' }, frameOrder: 'shuffle', shuffleSeed: 7 };
    const plan = planFrameStack({ width: 640, height: 360, duration: 10 }, stackSettingsOf(params));
    const order = frameOrder(plan.frames, orderSettingsOf(params));
    const seq = cubeSequence(plan.times, order);
    expect(seq.length).toBe(plan.frames);
    seq.forEach((t, i) => expect(t).toBe(plan.times[order[i]]));
    expect([...seq].sort((a, b) => a - b)).toEqual([...plan.times].sort((a, b) => a - b));
    // Reversed segments really play backwards in time order.
    const rev = plan.segments[1];
    expect(plan.times[rev.first]).toBeGreaterThan(plan.times[rev.first + 1]);
    // Time order: the plan as it is.
    expect(cubeSequence(plan.times, frameOrder(plan.frames, orderSettingsOf({})))).toEqual(plan.times);
  });
});

describe('saving a playback clip, and migration', () => {
  const none = settingsFromSaved(null, 10, 1, true);
  it('the whole video, forwards, uncropped is no clip at all', () => {
    expect(none.segments).toEqual([{ in: 0, out: 10 }]);
    for (const h of ['videoInput', 'videoLayer', 'baked', 'background'] as ClipHost[]) expect(savedFromSettings(none, 10, h)).toBeNull();
    expect(cpIsPlain(null)).toBe(true);
  });
  it('a trim saves; an out at the end saves as "to the end"; round trips', () => {
    const v = { ...none, segments: [{ in: 2, out: 10 }, { in: 1, out: 1.5, reverse: true }] };
    const saved = savedFromSettings(v, 10, 'videoLayer')!;
    expect(saved.segments).toEqual([{ in: 2, out: 0 }, { in: 1, out: 1.5, reverse: true }]);
    expect(saved.speed).toBeUndefined();
    const back = settingsFromSaved(saved, 10, 1.5, false);
    expect(back.segments).toEqual(v.segments);
    expect(back.speed).toBe(1.5);
    expect(back.loop).toBe(false);
  });
  it('a host shows only what it can: a bake keeps one segment and no rotation; speed and loop in the clip', () => {
    const v = { ...none, segments: [{ in: 2, out: 4 }, { in: 6, out: 8 }], xf: { crop: { x: 0.1, y: 0, w: 0.5, h: 1 }, rotate: 90 as const, flipX: true, flipY: false }, speed: 2, loop: false };
    const saved = savedFromSettings(v, 10, 'baked', { speed: 1, loop: true })!;
    expect(saved.segments).toEqual([{ in: 2, out: 4 }]);
    expect(saved).toMatchObject({ rotate: 0, flipX: false, speed: 2, loop: false });
    expect(saved.crop).toEqual({ x: 0.1, y: 0, w: 0.5, h: 1 });
    // A bake's own loop is the default: the same value is not saved.
    expect(savedFromSettings({ ...none, loop: true, segments: [{ in: 1, out: 10 }] }, 10, 'baked', { speed: 1, loop: true })!.loop).toBeUndefined();
  });
  it('layers and backgrounds without a clip parse exactly as before; a plain one is dropped', () => {
    const raw = { id: 'v1', kind: 'video', label: 'V', videoId: 'x', speed: 1, loop: true, start: 2 };
    expect('clip' in (parseLayer(raw) as object)).toBe(false);
    expect('clip' in (parseLayer({ ...raw, clip: { segments: [{ in: 0, out: 0 }] } }) as object)).toBe(false);
    const kept = parseLayer({ ...raw, clip: { segments: [{ in: 1, out: 3 }, { in: 'x' }], rotate: 95 } }) as VideoLayer;
    expect(kept.clip).toMatchObject({ segments: [{ in: 1, out: 3 }, { in: 0, out: 0 }], rotate: 90 });
    const bg = parseBackgroundItems([{ id: 'b', kind: 'video', name: 'B', src: '' }])[0];
    expect(bg && 'clip' in bg).toBe(false);
    expect(parseBackgroundItems([{ id: 'b', kind: 'video', name: 'B', src: '', clip: { segments: [{ in: 2, out: 3 }] } }])[0]?.clip?.segments).toEqual([{ in: 2, out: 3 }]);
    expect(cpParse(undefined)).toBeNull();
    expect(cpParse([1, 2])).toBeNull();
  });
  it('a clipped layer follows its playlist on the clock; without one, nothing changes', () => {
    const l = parseLayer({ id: 'v1', kind: 'video', label: 'V', videoId: 'x', speed: 2, loop: true, playing: true, clip: { segments: [{ in: 4, out: 5 }, { in: 1, out: 2, reverse: true }] } }) as VideoLayer;
    expect(videoLayerClipAt(l, 0.25, 10)?.at.time).toBeCloseTo(4.5, 9);
    expect(videoLayerClipAt(l, 0.75, 10)?.at.time).toBeCloseTo(1.5, 9);
    expect(videoLayerClipAt({ ...l, playing: false }, 3, 10)?.at.time).toBe(4);
    expect(videoLayerClipAt({ ...l, clip: undefined }, 1, 10)).toBeNull();
    const pl = cpPlaylist(l.clip!, 10, l.speed, l.loop);
    expect(pl.speed).toBe(2);
  });
});

describe('the crop in the shader', () => {
  const node = (params: Record<string, unknown>): GraphNode => ({ id: 'vid1', type: 'videoInput', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params } as unknown as GraphNode);
  it('no clip, or one that does not crop or turn: the same GLSL as ever', () => {
    const def = getNodeDefinition('videoInput')!;
    const plain = def.generateGLSL(node({}), {}).code;
    expect(def.generateGLSL(node({ clip: { segments: [{ in: 2, out: 3 }] } }), {}).code).toBe(plain);
    expect(plain).not.toContain('_cst');
    const baked = getNodeDefinition('baked')!;
    const b0 = baked.generateGLSL({ ...node({ bakeInfo: { fps: 30, alpha: false } }), type: 'baked' } as GraphNode, {}).code;
    expect(b0).not.toContain('_cst');
  });
  it('a crop reads that part of the frame (rows flipped as the video texture is)', () => {
    const def = getNodeDefinition('videoInput')!;
    const code = def.generateGLSL(node({ clip: { segments: [{ in: 0, out: 0 }], crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 } } }), {}).code;
    expect(code).toContain('vec2 vid1_cst');
    expect(code).toContain('texture2D(u_vid_vid1, vid1_cst)');
    expect(clipGlsl('a', 'st', { crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 90 }).code).toContain('a_cst');
  });
  it('the texture affine is outputToSource with v flipped, for every turn and flip', () => {
    for (const rotate of [0, 90, 180, 270] as const) for (const flipX of [false, true]) {
      const xf = { crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 }, rotate, flipX, flipY: !flipX };
      const a = cpTextureAffine(xf);
      for (const [s, t] of [[0, 0], [1, 0], [0.3, 0.8], [1, 1]]) {
        const [x, y] = outputToSource(xf, s, 1 - t);
        expect(a[0] + a[1] * s + a[2] * t).toBeCloseTo(x, 9);
        expect(a[3] + a[4] * s + a[5] * t).toBeCloseTo(1 - y, 9);
      }
    }
  });
});

describe('web pages play the same clip', () => {
  it('the page’s bundle carries a video’s clip and a Baked video’s clock (it used to drop the clock)', () => {
    const clip = { segments: [{ in: 1, out: 2 }], crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0 as const, flipX: false, flipY: false };
    const clock = { start: 0, duration: 4, fps: 30, loop: 'seamless' as const };
    const media = { videos: { u_vid_a: { label: 'A', name: 'a', src: 'data:video/webm;base64,AA', bytes: 2, loop: true, speed: 1, clip }, u_vid_b: { label: 'B', name: 'b', src: null, bytes: 0, loop: true, speed: 1, clock }, u_vid_c: { label: 'C', name: 'c', src: null, bytes: 0, loop: false, speed: 2 } } };
    const bundle = playBundle({ title: 'T', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play: parsePlayRecord({}) ?? undefined, aspect: 'free', media } as unknown as PlayHtmlInput) as unknown as { media: { videos: Record<string, Record<string, unknown>> } };
    expect(bundle.media.videos.u_vid_a.clip).toEqual(clip);
    expect(bundle.media.videos.u_vid_b.clock).toEqual(clock);
    // Without either: exactly the old shape.
    expect(bundle.media.videos.u_vid_c).toEqual({ src: null, loop: false, speed: 2 });
  });
  it('the page’s kit carries the playlist maths and answers as the app does', () => {
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { clip: { at: typeof cpAt; playlist: typeof cpPlaylist; parse: typeof cpParse } };
    const raw = { segments: [{ in: 2, out: 4 }, { in: 1, out: 1.5, reverse: true }], speed: 1.5 };
    const app = cpPlaylist(cpParse(raw)!, 10, 1, true), page = SSKit.clip.playlist(SSKit.clip.parse(raw)!, 10, 1, true);
    expect(page).toEqual(app);
    for (let t = 0; t < 4; t += 0.13) expect(SSKit.clip.at(page.segs, t, page.speed, page.loop)).toEqual(cpAt(app.segs, t, app.speed, app.loop));
  });
});
