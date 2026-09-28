/**
 * Tracking a Video layer, and face and pose (docs/tracking.md), without a
 * model: synthetic landmark frames are baked with the same codec the
 * analysis uses, then read back by video time through the kit, the Play
 * engine and the web runtime. The models themselves are checked in the
 * browser.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { TK_PRIME_S, tkDecode, tkDrive, tkDriver, tkEncode, tkFrameAt, tkFromBase64, tkHandsFrame, tkItem, tkSample, tkToBase64, tkVideoTime, type TkRawFrame, type TkTrack } from '../kit/tracks.js';
import { hdCreate, hdPlacement, hdRead, hdToPicture, hdUpdate } from '../kit/hands.js';
import { FC_ANGLES, FC_BLEND_NAMES, fcCreate, fcGate, fcHeadAngles, fcPoint, fcRead, fcUpdate } from '../kit/face.js';
import { psCreate, psGate, psRead, psUpdate } from '../kit/pose.js';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { clearBakeCache, putBake } from '../../lib/trackBakes';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { kitScript, leftBehind, mediaCarried, playBundle, type PlayHtmlInput } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { sourceFromType, sourceLabel, triggerLabel } from '../playSources';
import { triggerKey } from '../triggers';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, type PlayControl, type PlayLayer, type PlayRecord, type PlaySource } from '../../types/play';
import { bakeFor, parseTrackAnchor, usesFace, usesPose, withBake, type TrackBakeRef } from '../../types/playTracking';

afterEach(() => {
  useNodeGraphStore.getState().setPlay(emptyPlayRecord());
  playEngine.setRecord(emptyPlayRecord());
  playEngine.setBaseValues(new Map());
  clearBakeCache();
});

// ── Synthetic tracks ─────────────────────────────────────────────────────────

/** A right hand whose landmarks all sit at (x, y) + a small spread, x moving with time. */
function handLm(x: number, y: number): number[] {
  const lm: number[] = [];
  // A hand-sized spread (a quarter of the frame tall) so the tracker believes it.
  for (let i = 0; i < 21; i++) lm.push(x + ((i % 5) - 2) * 0.03, y - 0.12 + (i / 20) * 0.25, 0);
  // The wrist below, the middle knuckle above it (palm size for readings).
  lm[0] = x; lm[1] = y + 0.13;
  return lm;
}

/** A 2 s clip at 30 fps: one right hand gliding left to right (index tip x = 0.2 + 0.3 t), gone between 1.2 s and 1.6 s. */
function handTrack(): { raw: TkRawFrame[]; bytes: Uint8Array } {
  const raw: TkRawFrame[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 30;
    raw.push({ t, items: t >= 1.2 && t < 1.6 ? [] : [{ meta: [1, 0.95], lm: handLm(0.2 + 0.3 * t, 0.5) }] });
  }
  return { raw, bytes: tkEncode({ kind: 'hands', w: 640, h: 480, duration: 2, fps: 30, frames: raw }) };
}

describe('the baked track codec', () => {
  it('encodes and decodes hands, a face and a body within the quantisation step', () => {
    const { raw, bytes } = handTrack();
    const tr = tkDecode(bytes) as TkTrack;
    expect(tr.kind).toBe('hands');
    expect([tr.frames, tr.items, tr.points, tr.ch, tr.meta, tr.w, tr.h, tr.fps]).toEqual([61, 2, 21, 3, 2, 640, 480, 30]);
    expect(tr.duration).toBeCloseTo(2, 5);
    expect(tr.counts[0]).toBe(1);
    expect(tr.counts[37]).toBe(0);
    const it0 = tkItem(tr, 10, 0);
    for (let k = 0; k < 63; k++) expect(Math.abs(it0.lm[k] - (raw[10].items[0].lm as number[])[k])).toBeLessThan(2e-4);
    expect(it0.meta[0]).toBeCloseTo(1, 3);
    expect(it0.meta[1]).toBeCloseTo(0.95, 3);
    // Compact: two hands' slots of int16 per frame, plus the time and count.
    expect(bytes.length).toBeLessThan(61 * (2 * 65 * 2 + 5) + 64 + 32);

    const face = new Float32Array(478 * 3).map((_, i) => (i % 3 === 2 ? -0.05 : 0.3 + (i % 7) * 0.01));
    const meta = new Float32Array(FC_ANGLES + FC_BLEND_NAMES.length).map((_, i) => i / 100);
    const fb = tkDecode(tkEncode({ kind: 'face', w: 320, h: 240, duration: 1, fps: 10, frames: [{ t: 0, items: [{ meta, lm: face }] }] })) as TkTrack;
    const f0 = tkItem(fb, 0, 0);
    expect(fb.points).toBe(478);
    expect(f0.lm[5]).toBeCloseTo(face[5], 3);
    expect(f0.meta[40]).toBeCloseTo(0.4, 3);

    const body = new Float32Array(33 * 4).map((_, i) => (i % 4 === 3 ? 0.9 : 0.5));
    const pb = tkDecode(tkEncode({ kind: 'pose', w: 320, h: 240, duration: 1, fps: 10, frames: [{ t: 0, items: [{ lm: body }] }] })) as TkTrack;
    expect(pb.ch).toBe(4);
    expect(tkItem(pb, 0, 0).lm[3]).toBeCloseTo(0.9, 3);
  });

  it('refuses bytes that are not a track, and survives base64 both ways', () => {
    expect(tkDecode(new Uint8Array([1, 2, 3]))).toBeNull();
    const { bytes } = handTrack();
    const back = tkFromBase64(tkToBase64(bytes));
    expect(back).toEqual(bytes);
    expect(tkDecode(back)?.frames).toBe(61);
  });
});

describe('video time → frame', () => {
  const tr = tkDecode(handTrack().bytes) as TkTrack;

  it('finds the frames either side, and how far between', () => {
    expect(tkFrameAt(tr, 0)).toEqual({ i: 0, j: 0, a: 0 });
    const m = tkFrameAt(tr, 0.5 + 1 / 60);
    expect([m.i, m.j]).toEqual([15, 16]);
    expect(m.a).toBeCloseTo(0.5, 3);
    expect(tkFrameAt(tr, 5)).toEqual({ i: 60, j: 60, a: 0 });
  });

  it('interpolates a moving hand between frames, and takes the nearer frame when one has no hand', () => {
    const s = tkSample(tr, 0.5 + 1 / 60);
    expect(s.t).toBeCloseTo(516.67, 1);
    expect(s.items.length).toBe(1);
    // Landmark 8 (the index tip) is x + 0.03 * ((8 % 5) - 2).
    expect(s.items[0].lm[8 * 3]).toBeCloseTo(0.2 + 0.3 * (0.5 + 1 / 60) + 0.03, 3);
    const edge = tkSample(tr, 1.2 - 0.01);
    expect(edge.items.length).toBe(0);
    expect(tkSample(tr, 1.3).items.length).toBe(0);
    expect(tkHandsFrame(tkSample(tr, 0.2)).hands[0].side).toBe('right');
  });

  it('a Video layer following the clock is at start + t × speed, looped or held; running free, where its element is', () => {
    const l = { follow: true, playing: true, start: 0.5, speed: 2, loop: true };
    expect(tkVideoTime(l, 0.25, 2, null)).toBeCloseTo(1, 6);
    expect(tkVideoTime(l, 1, 2, null)).toBeCloseTo(0.5, 6);
    expect(tkVideoTime({ ...l, loop: false }, 5, 2, null)).toBeCloseTo(1.999, 6);
    expect(tkVideoTime({ ...l, playing: false }, 5, 2, null)).toBeCloseTo(0.5, 6);
    expect(tkVideoTime({ ...l, follow: false }, 5, 2, 1.25)).toBe(1.25);
  });
});

describe('driving a tracker from a baked track', () => {
  const tr = tkDecode(handTrack().bytes) as TkTrack;
  const place = { cx: 0.5, cy: 0.5, h: 1, rot: 0, mirror: false };
  const o = { picAspect: 4 / 3, place, smoothing: 0.5 };

  /** Drive to each time in turn and return the index tip's x (null out of view). */
  function run(times: number[]) {
    let st = hdCreate();
    const drv = tkDriver();
    return times.map(t => {
      tkDrive(drv, tr, t, () => { st = hdCreate(); }, f => hdUpdate(st, tkHandsFrame(f), o));
      return hdRead(st, 'right', 'point', 8, 'x', 'pinch');
    });
  }

  it('feeds nothing for the same time twice, and replays the moments before a jump', () => {
    const drv = tkDriver();
    let fed = 0, resets = 0;
    tkDrive(drv, tr, 1, () => resets++, () => fed++);
    expect(resets).toBe(1);
    expect(fed).toBe(Math.ceil(TK_PRIME_S * 30) + 1);
    expect(tkDrive(drv, tr, 1, () => resets++, () => fed++)).toBe(false);
    tkDrive(drv, tr, 1 + 1 / 60, () => resets++, () => fed++);
    expect(resets).toBe(1);
    tkDrive(drv, tr, 0.5, () => resets++, () => fed++);
    expect(resets).toBe(2);
  });

  it('lands in the same place wherever it came from (scrubbing is deterministic)', () => {
    const direct = run([0.9]);
    const scrubbed = run([0.1, 1.9, 0.3, 0.9]);
    expect(direct[0]).not.toBeNull();
    expect(scrubbed[3]).toBeCloseTo(direct[0] as number, 9);
    // Playing through is smooth and follows the hand.
    const played = run(Array.from({ length: 40 }, (_, i) => 0.6 + i / 60));
    expect(played[39]).toBeGreaterThan(played[10] as number);
  });

  it('a hand that leaves in the video is held a moment, then gone', () => {
    const r = run(Array.from({ length: 30 }, (_, i) => 1.1 + i / 60));
    expect(r[0]).not.toBeNull();
    // 1.2 s: gone from the video; held 250 ms of video time after it was last seen (about 1.18 s): there at 1.35 s, gone by 1.45 s.
    expect(r[Math.round((1.35 - 1.1) * 60)]).not.toBeNull();
    expect(r[Math.round((1.45 - 1.1) * 60)]).toBeNull();
  });
});

describe('placing landmarks through a Video layer', () => {
  it('uses its position, Fit and Scale, rotation and Mirror', () => {
    const v = { ...defaultLayer('video', 'v', 'Clip'), x: 0.25, y: 0.75, scale: 0.5, rotation: 0, fit: 'height', mirror: false } as PlayLayer;
    const rec = { layers: [v] };
    const val = (l: PlayLayer, k: string) => (l as unknown as Record<string, number>)[k];
    const p = hdPlacement(rec, val, 4 / 3, 16 / 9, true, 'v');
    expect(p).toEqual({ cx: 0.25, cy: 0.75, h: 0.5, rot: 0, mirror: false });
    // The frame's centre is the layer's centre; its top-left corner is half the layer's size up and left.
    expect(hdToPicture(0.5, 0.5, p, 4 / 3, 16 / 9)).toEqual([0.25, 0.75]);
    const tl = hdToPicture(0, 0, p, 4 / 3, 16 / 9);
    expect(tl[0]).toBeCloseTo(0.25 - (0.5 * 4 / 3) / 2 / (16 / 9), 6);
    expect(tl[1]).toBeCloseTo(0.75 + 0.25, 6);
    // Mirrored, the left edge of the frame is on the right.
    const m = hdPlacement({ layers: [{ ...v, mirror: true } as PlayLayer] }, val, 4 / 3, 16 / 9, true, 'v');
    expect(hdToPicture(0, 0.5, m, 4 / 3, 16 / 9)[0]).toBeGreaterThan(0.25);
    // Fit inside a wider picture: the whole frame's height (contain) is the picture's.
    const c = hdPlacement({ layers: [{ ...v, fit: 'contain', scale: 1 } as PlayLayer] }, val, 4 / 3, 16 / 9, true, 'v');
    expect(c.h).toBe(1);
    // A missing layer: the camera's placement (covering the picture).
    expect(hdPlacement({ layers: [] }, val, 4 / 3, 16 / 9, true, 'gone').cx).toBe(0.5);
  });
});

// ── Face and pose readers ───────────────────────────────────────────────────

function faceFrame(t: number, blend: Record<string, number>, angles: [number, number, number] = [0, 0, 0]) {
  const lm = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) { lm[i * 3] = 0.4 + (i % 20) * 0.01; lm[i * 3 + 1] = 0.3 + Math.floor(i / 20) * 0.015; }
  lm[1 * 3] = 0.5; lm[1 * 3 + 1] = 0.5; // the nose tip in the middle
  lm[234 * 3] = 0.35; lm[454 * 3] = 0.65; // cheek edges
  const meta = new Float32Array(FC_ANGLES + FC_BLEND_NAMES.length);
  meta.set(angles, 0);
  for (const [k, v] of Object.entries(blend)) meta[FC_ANGLES + FC_BLEND_NAMES.indexOf(k)] = v;
  return { t, w: 640, h: 480, items: [{ meta, lm }] };
}

describe('face readings', () => {
  const o = { picAspect: 4 / 3, place: { cx: 0.5, cy: 0.5, h: 1, rot: 0, mirror: false }, smoothing: 0 };

  it('reads blendshapes, the head, and points, after it has appeared', () => {
    const st = fcCreate();
    expect(fcRead(st, 'mouthOpen', 0, 'x', 'mouthOpen')).toBeNull();
    fcUpdate(st, faceFrame(0, { jawOpen: 0.8 }), o);
    expect(st.present).toBe(false); // a new face counts after two frames
    fcUpdate(st, faceFrame(33, { jawOpen: 0.8, mouthSmileLeft: 0.6, mouthSmileRight: 0.4, eyeBlinkLeft: 0.9 }, [0.1, -0.05, 0.02]), o);
    expect(fcRead(st, 'mouthOpen', 0, 'x', 'mouthOpen')).toBeCloseTo(0.8, 5);
    expect(fcRead(st, 'smile', 0, 'x', 'mouthOpen')).toBeCloseTo(0.5, 5);
    expect(fcRead(st, 'blinkLeft', 0, 'x', 'mouthOpen')).toBeCloseTo(0.9, 5);
    expect(fcRead(st, 'yaw', 0, 'x', 'mouthOpen')).toBeCloseTo(0.6, 5);
    expect(fcRead(st, 'pitch', 0, 'x', 'mouthOpen')).toBeCloseTo(0.45, 5);
    expect(fcRead(st, 'blend', FC_BLEND_NAMES.indexOf('eyeBlinkLeft'), 'x', 'mouthOpen')).toBeCloseTo(0.9, 5);
    expect(fcRead(st, 'point', 1, 'x', 'mouthOpen')).toBeCloseTo(0.5, 5);
    expect(fcRead(st, 'point', 1, 'y', 'mouthOpen')).toBeCloseTo(0.5, 5);
    expect(fcPoint(st, 1)).toEqual({ x: 0.5, y: 0.5 });
    expect(fcRead(st, 'present', 0, 'x', 'mouthOpen')).toBe(1);
  });

  it('gestures have hysteresis: the mouth opens past 0.35 and closes below 0.2', () => {
    const st = fcCreate();
    const seq = [0, 0.3, 0.4, 0.25, 0.21, 0.19, 0.36];
    const out = seq.map((v, i) => { fcUpdate(st, faceFrame(i * 33, { jawOpen: v, eyeBlinkLeft: v, eyeBlinkRight: v }), o); return fcGate(st, 'mouthOpen'); });
    expect(out).toEqual([false, false, true, true, true, false, true]);
    expect(fcGate(st, 'appear')).toBe(true);
    // Gone: held, then it leaves.
    fcUpdate(st, { t: 7 * 33, w: 640, h: 480, items: [] }, o);
    expect(st.present).toBe(true);
    fcUpdate(st, { t: 7 * 33 + 300, w: 640, h: 480, items: [] }, o);
    expect(fcGate(st, 'leave')).toBe(true);
    expect(fcRead(st, 'mouthOpen', 0, 'x', 'mouthOpen')).toBeNull();
  });

  it('turns MediaPipe’s transformation matrix into yaw, pitch and roll', () => {
    const a = 0.3, c = Math.cos(a), s = Math.sin(a);
    // A turn about the vertical axis (column-major).
    const yaw = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
    const [y, p, r] = fcHeadAngles(yaw);
    expect(y * Math.PI).toBeCloseTo(a, 5);
    expect(p).toBeCloseTo(0, 5);
    expect(r).toBeCloseTo(0, 5);
    expect(fcHeadAngles(null)).toEqual([0, 0, 0]);
  });
});

function bodyFrame(t: number, wristsY: number, vis = 0.9) {
  const lm = new Float32Array(33 * 4);
  const set = (i: number, x: number, y: number) => { lm[i * 4] = x; lm[i * 4 + 1] = y; lm[i * 4 + 3] = vis; };
  for (let i = 0; i < 33; i++) set(i, 0.5, 0.5);
  set(0, 0.5, 0.25); // nose
  set(11, 0.6, 0.4); set(12, 0.4, 0.4); // shoulders (the person's left is on the image's right)
  set(15, 0.65, wristsY); set(16, 0.35, wristsY);
  return { t, w: 640, h: 480, items: [{ meta: [], lm }] };
}

describe('pose readings', () => {
  const o = { picAspect: 4 / 3, place: { cx: 0.5, cy: 0.5, h: 1, rot: 0, mirror: false }, smoothing: 0 };

  it('reads points, visibility and the shoulders, and sees hands up', () => {
    const st = psCreate();
    psUpdate(st, bodyFrame(0, 0.7), o);
    psUpdate(st, bodyFrame(33, 0.7), o);
    expect(psRead(st, 'point', 15, 'x', 'handsUp')).toBeCloseTo(0.65, 5);
    expect(psRead(st, 'point', 15, 'y', 'handsUp')).toBeCloseTo(0.3, 5);
    expect(psRead(st, 'visibility', 15, 'x', 'handsUp')).toBeCloseTo(0.9, 5);
    expect(psRead(st, 'lean', 0, 'x', 'handsUp')).toBeCloseTo(0.5, 5);
    expect(psGate(st, 'handsUp')).toBe(false);
    psUpdate(st, bodyFrame(66, 0.1), o);
    expect(psGate(st, 'handsUp')).toBe(true);
    expect(psGate(st, 'leftHandUp')).toBe(true);
    // Not sure it sees the wrists: no gesture.
    psUpdate(st, bodyFrame(99, 0.1, 0.2), o);
    expect(psGate(st, 'handsUp')).toBe(false);
  });
});

// ── Types, labels, files ─────────────────────────────────────────────────────

describe('face and pose in setups', () => {
  it('reads sources, triggers, anchors and nulls from a file, and knows when a setup uses them', () => {
    const rec = parsePlayRecord({
      version: 1, controls: [{ id: 'c', target: 'n::c', kind: 'float', label: 'c', min: 0, max: 1 }],
      mappings: [{ id: 'm', controlId: 'c', source: { kind: 'face', read: 'smile', point: 1, axis: 'x', gesture: 'nope' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
      layers: [{ ...defaultLayer('null', 'n', 'N'), follow: 'pose', trackPoint: 16 }],
      actions: [],
      face: { smoothing: 0.3, overlay: false, colour: [1, 0, 0], mirror: true, source: 'v1', bakes: [{ key: 'face-abc', layerId: 'v1', videoId: 'vid', sig: 's', frames: 10, fps: 30, duration: 1, bytes: 100 }] },
    });
    expect(rec?.mappings[0].source).toEqual({ kind: 'face', read: 'smile', point: 1, axis: 'x', gesture: 'mouthOpen' });
    expect(rec?.face?.source).toBe('v1');
    expect(rec?.face?.bakes?.[0].key).toBe('face-abc');
    const n = rec?.layers[0] as Extract<PlayLayer, { kind: 'null' }>;
    expect([n.follow, n.trackPoint]).toEqual(['pose', 16]);
    expect(usesFace(rec!)).toBe(true);
    expect(usesPose(rec!)).toBe(true);
    expect(parseTrackAnchor('face:477')).toEqual({ kind: 'face', point: 477 });
    expect(parseTrackAnchor('pose:33')).toBeNull();
  });

  it('labels them and keys their triggers', () => {
    const f = sourceFromType('face:point', { kind: 'mouse', axis: 'x' });
    expect(sourceLabel(f)).toBe('Face · Nose tip · X');
    expect(sourceLabel(sourceFromType('pose:gesture', { kind: 'mouse', axis: 'x' }))).toBe('Pose · Both hands up (held)');
    expect(triggerLabel({ on: 'face', gesture: 'smile' })).toBe('Face · Smile');
    expect(triggerKey({ on: 'pose', gesture: 'armsOut' })).toBe('pose:armsOut');
  });

  it('keeps one bake per layer and file, newest first, and says when one is stale', () => {
    const b = (key: string, videoId = 'vid', sig = 's'): TrackBakeRef => ({ key, layerId: 'v1', videoId, sig, frames: 1, fps: 30, duration: 1, bytes: 1 });
    let list = withBake(undefined, b('a'));
    list = withBake(list, b('b', 'other'));
    list = withBake(list, b('c'));
    expect(list.map(x => x.key)).toEqual(['c', 'b']);
    expect(bakeFor(list, 'v1', 'vid', 's')).toEqual({ bake: list[0], fresh: true });
    expect(bakeFor(list, 'v1', 'vid', 'new settings')?.fresh).toBe(false);
    expect(bakeFor(list, 'v1', 'third', 's')).toBeNull();
  });
});

// ── The engine and the web page ──────────────────────────────────────────────

const control = (id: string): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1 });
const handX: PlaySource = { kind: 'hand', side: 'right', read: 'point', point: 8, axis: 'x', gesture: 'pinch' };

/** A setup whose hands track a Video layer that has been analysed (the bake under `key`). */
function videoHandsRecord(key: string): PlayRecord {
  const v = { ...defaultLayer('video', 'v1', 'Clip'), videoId: 'vid', fileName: 'clip.webm', bytes: 1000, fit: 'height', scale: 1, x: 0.5, y: 0.5, follow: true, playing: true, loop: false, speed: 1, start: 0 } as PlayLayer;
  return {
    ...emptyPlayRecord(), controls: [control('hx')], layers: [v],
    mappings: [{ id: 'm', controlId: 'hx', source: handX, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    hands: { smoothing: 0, overlay: true, colour: [1, 1, 1], mirror: true, source: 'v1', bakes: [{ key, layerId: 'v1', videoId: 'vid', sig: '', frames: 61, fps: 30, duration: 2, bytes: 1 }] },
  };
}

describe('the engine reads a baked track by video time', () => {
  it('drives a mapping from the hand in the video, the same every time', () => {
    putBake('hands-test', handTrack().bytes);
    const rec = videoHandsRecord('hands-test');
    playEngine.setRecord(rec);
    playEngine.setAspect?.(4 / 3);
    const at = (t: number) => { inputBus.tick(1 / 60, t); return playEngine.liveValue('hx') as number | undefined; };
    const first = [0.8, 0.9, 1.0].map(at);
    // The picture is as wide as the frame (Fit: Height, the same shape): x on the picture is x in the frame.
    expect(first[2]).toBeCloseTo(0.2 + 0.3 * 1.0 + 0.03, 2);
    // Back to 0.8 (a scrub): the same value again.
    expect(at(0.8)).toBeCloseTo(first[0] as number, 9);
    // The file changed: the old analysis is no longer read (the hand stays where it was, nothing new comes in).
    playEngine.setRecord({ ...rec, layers: [{ ...rec.layers[0], videoId: 'another' } as PlayLayer] });
    expect(playEngine.bakedTrack('hands')).toBeNull();
  });
});

describe('a web page carries and reads a baked track', () => {
  const input = (rec: PlayRecord, withTrack: boolean): PlayHtmlInput => ({
    title: 'T', fragmentShader: 'void main(){}', uniforms: { u_hx: 0 }, paramBindings: { 'n::hx': 'u_hx' }, play: rec, aspect: 'free',
    media: withTrack ? { tracks: { hands: { layerId: 'v1', label: '“Clip”', name: 'clip.webm', src: tkToBase64(handTrack().bytes), bytes: 1 } } } : {},
  });

  it('puts the track in the bundle, lists its size, and says when it is missing', () => {
    const rec = videoHandsRecord('k');
    const b = playBundle(input(rec, true)) as { tracks?: { hands?: { layerId: string; data: string } }; hands?: unknown };
    expect(b.tracks?.hands?.layerId).toBe('v1');
    expect(tkDecode(tkFromBase64(b.tracks!.hands!.data))?.frames).toBe(61);
    // No hand model needed for a video's hands.
    expect(b.hands).toBeUndefined();
    expect(mediaCarried(input(rec, true).media, undefined, rec).some(m => /Hands tracking of “Clip”/.test(m.what))).toBe(true);
    expect(leftBehind(rec, input(rec, true).media).some(l => /tracking/i.test(l.what))).toBe(false);
    expect(leftBehind(rec, {}).some(l => /Hands tracking of “Clip”/.test(l.what))).toBe(true);
    expect(leftBehind({ ...rec, face: { smoothing: 0.5, overlay: true, colour: [1, 1, 1], mirror: true }, mappings: [...rec.mappings, { ...rec.mappings[0], id: 'f', source: { kind: 'face', read: 'smile', point: 1, axis: 'x', gesture: 'smile' } }] }, {}).some(l => /Face tracking from the camera/.test(l.what))).toBe(true);
  });

  it('the page’s runtime reads the hand from the track at the video’s time', () => {
    const rec = videoHandsRecord('k');
    const bundle = playBundle(input(rec, true));
    const rafs: ((t: number) => void)[] = [];
    const win: Record<string, unknown> = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
    const doc = { head: new El('head'), hidden: false, getElementById: () => null, createElement: (tag: string) => new El(tag), addEventListener() {}, removeEventListener() {} };
    const noop = class { observe() {} disconnect() {} };
    const fn = new Function('window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'URL', `${kitScript()}\n${runtimeSource}`);
    fn(win, doc, {}, (cb: (t: number) => void) => { rafs.push(cb); return rafs.length; }, () => {}, noop, noop, El.bind(null, 'img'), { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
    const api = win.ShaderStudioPlay as { mount: (el: unknown, b: unknown, o?: unknown) => { get(id: string): { value: number; driven: boolean } | null } };
    const h = api.mount(new El('div'), { ...bundle, uniforms: { u_hx: { type: 'float', value: 0 } } }, { mode: 'player', panel: false });
    let now = 1000;
    const seen: number[] = [];
    for (let i = 0; i < 70; i++) { rafs.shift()?.((now += 1000 / 60)); const g = h.get('hx'); if (g?.driven) seen.push(g.value); }
    expect(seen.length).toBeGreaterThan(20);
    // The hand glides right with the video, as it does in the app.
    expect(seen[seen.length - 1]).toBeGreaterThan(seen[0] + 0.1);
    for (const v of seen) expect(v).toBeGreaterThan(0.2);
    for (const v of seen) expect(v).toBeLessThan(0.9);
  });
});

/** A stand-in DOM element for the runtime. */
class El {
  tagName: string; children: El[] = []; style: Record<string, string> = {}; className = ''; textContent = ''; innerHTML = ''; parentElement: El | null = null;
  width = 400; height = 300; clientWidth = 400; clientHeight = 300; value = ''; disabled = false; dataset = {};
  classList = { add() {}, remove() {}, toggle() {} };
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  append(...c: El[]) { for (const e of c) { e.parentElement = this; this.children.push(e); } }
  appendChild(c: El) { this.append(c); return c; }
  prepend(...c: El[]) { this.append(...c); }
  replaceChildren(...c: El[]) { this.children = []; this.append(...c); }
  remove() {} setAttribute() {} removeAttribute() {} addEventListener() {} removeEventListener() {} setPointerCapture() {}
  load() {} pause() {} play() { return Promise.resolve(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }; }
  getContext(kind: string) {
    if (kind === '2d') return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? this : () => ({ data: new Uint8ClampedArray(4) })) });
    return new Proxy({}, { get: (_t, k: string) => (/^[A-Z0-9_]+$/.test(k) ? 1 : k === 'getShaderParameter' || k === 'getProgramParameter' ? () => true : k === 'checkFramebufferStatus' ? () => 1 : k === 'getExtension' ? () => ({}) : () => ({})) });
  }
}
