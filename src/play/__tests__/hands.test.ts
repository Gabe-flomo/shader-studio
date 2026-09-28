/**
 * Hand tracking, without a camera: synthetic landmark frames go through the
 * same path the tracker's do (handFeed → Play engine → hands.js), so sources,
 * gestures, smoothing, following nulls, takes and the file format are all
 * checked here. The tracker itself (MediaPipe in a worker) is checked in the
 * browser (docs/tracking.md).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { hdCreate, hdEuroParams, hdEuroStep, hdGate, hdPlacement, hdPoint, hdRead, hdToPicture, hdTrackerOptions, hdTracks, hdUpdate, HD_APPEAR_FRAMES, HD_HOLD_MS, HD_SIDE_SWITCH_MS, type HdFrame, type HdUpdateOptions } from '../kit/hands.js';
import { createLayerKit, type KitEnv } from '../kit/kit.js';
import { handFeed } from '../../lib/handFeed';
import { inputBus } from '../../lib/inputBus';
import { playEngine } from '../../lib/playEngine';
import { playOverlay } from '../overlay';
import { useTakes } from '../../lib/takes';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { handSourceLabel, sourceFromType, sourceLabel, sourceType, triggerLabel } from '../playSources';
import { triggerKey } from '../triggers';
import { leftBehind, mediaCarried, playBundle } from '../exportHtml';
import { DEFAULT_HANDS, defaultLayer, emptyPlayRecord, oneHandUsed, parsePlayRecord, usesHands, type PlayLayer, type PlayRecord, type PlaySource } from '../../types/play';

// ── Synthetic hands ──────────────────────────────────────────────────────────

const CAM_W = 640, CAM_H = 480, CAM_ASPECT = CAM_W / CAM_H;

interface Pose {
  /** Centre of the knuckles in the camera image (0..1, y down). */
  cx?: number; cy?: number;
  /** Hand size in image heights (wrist to middle knuckle is about half of it). */
  s?: number;
  /** Curl per finger, index to pinky: 0 straight, 1 folded into the palm. */
  curl?: [number, number, number, number];
  /** Thumb tip this far (image heights) from a fingertip (8, 12, 16, 20), or undefined: thumb out to the side. */
  pinch?: { tip: number; gap: number };
}

/** 21 landmarks of a hand facing the camera, fingers up, as MediaPipe would give them (x, y in the image, z from the wrist). */
function handLm(p: Pose = {}): Float32Array {
  const cx = p.cx ?? 0.5, cy = p.cy ?? 0.5, s = p.s ?? 0.4, curl = p.curl ?? [0, 0, 0, 0];
  // Points in image heights around the knuckle centre (x right, y down), then converted.
  const pts: [number, number, number][] = new Array(21);
  pts[0] = [0, 0.5, 0];
  const mcps: [number, number][] = [[-0.18, 0], [-0.06, -0.02], [0.06, 0], [0.17, 0.04]];
  for (let f = 0; f < 4; f++) {
    const [mx, my] = mcps[f], c = curl[f], len = f === 3 ? 0.14 : 0.18;
    const base = 5 + f * 4;
    pts[base] = [mx, my, 0];
    // Straight: joints go up. Curled: the finger folds forward and back down toward the palm.
    const straight = [[mx, my - len], [mx, my - 2 * len], [mx, my - 3 * len]];
    const folded = [[mx, my - len * 0.8], [mx, my - len * 0.4], [mx, my + len * 0.45]];
    for (let j = 0; j < 3; j++) {
      const x = straight[j][0] + (folded[j][0] - straight[j][0]) * c;
      const y = straight[j][1] + (folded[j][1] - straight[j][1]) * c;
      pts[base + 1 + j] = [x, y, -0.08 * c * (j + 1)];
    }
  }
  pts[1] = [-0.2, 0.35, 0]; pts[2] = [-0.3, 0.22, 0]; pts[3] = [-0.42, 0.08, 0];
  pts[4] = [-0.52, -0.08, 0];
  if (p.pinch) {
    const t = pts[p.pinch.tip];
    pts[4] = [t[0] - p.pinch.gap, t[1], t[2]];
    pts[3] = [(pts[2][0] + pts[4][0]) / 2, (pts[2][1] + pts[4][1]) / 2, 0];
  }
  const out = new Float32Array(63);
  for (let i = 0; i < 21; i++) {
    out[i * 3] = cx + (pts[i][0] * s) / CAM_ASPECT;
    out[i * 3 + 1] = cy + pts[i][1] * s;
    out[i * 3 + 2] = (pts[i][2] * s) / CAM_ASPECT;
  }
  return out;
}

const OPEN: Pose = { curl: [0, 0, 0, 0] };
const FIST: Pose = { curl: [1, 1, 1, 1], pinch: undefined };
const POINT: Pose = { curl: [0, 1, 1, 1] };

let clock = 1000;
function frame(hands: { side: 'left' | 'right'; pose: Pose }[], dt = 33): HdFrame {
  clock += dt;
  return { t: clock, w: CAM_W, h: CAM_H, hands: hands.map(h => ({ side: h.side, score: 0.9, lm: handLm(h.pose) })) };
}

const PIC = 16 / 9;
const place = hdPlacement(null, null, CAM_ASPECT, PIC, true);
/** Readings tests: a hand counts from its first frame (the appearing debounce has its own tests below). */
const update = (st: ReturnType<typeof hdCreate>, f: HdFrame, smoothing = 0, more: Partial<HdUpdateOptions> = {}) => hdUpdate(st, f, { picAspect: PIC, place, smoothing, appearFrames: 1, ...more });

// ── Pure hands.js ────────────────────────────────────────────────────────────

describe('hands on the picture', () => {
  it('cover the picture with the camera image, mirrored like a selfie', () => {
    // A 4:3 camera covering a 16:9 picture: its width fits, its height is cropped.
    expect(place.h).toBeCloseTo(PIC / CAM_ASPECT);
    const [x, y] = hdToPicture(0.25, 0.5, place, CAM_ASPECT, PIC);
    expect(x).toBeCloseTo(0.75); // the left of the image is the right of the selfie view
    expect(y).toBeCloseTo(0.5);
    const unmirrored = hdToPicture(0.25, 0.5, { ...place, mirror: false }, CAM_ASPECT, PIC);
    expect(unmirrored[0]).toBeCloseTo(0.25);
  });

  it('line up with a Camera layer: its position, size and mirror', () => {
    const cam = { ...defaultLayer('camera', 'cam', 'Camera'), x: 0.3, y: 0.6, scale: 0.5, mirror: false } as PlayLayer;
    const value = (l: PlayLayer, k: string) => (l as unknown as Record<string, number>)[k];
    const p = hdPlacement({ layers: [cam] }, value, CAM_ASPECT, PIC, true);
    expect(p).toMatchObject({ cx: 0.3, cy: 0.6, h: 0.5, mirror: false });
    // The image's centre sits on the layer's centre; its top edge half a layer height above.
    expect(hdToPicture(0.5, 0.5, p, CAM_ASPECT, PIC)).toEqual([0.3, 0.6]);
    expect(hdToPicture(0.5, 0, p, CAM_ASPECT, PIC)[1]).toBeCloseTo(0.85);
  });

  it('read landmarks, the palm, pinch, openness, roll, size and the two hands’ distance', () => {
    const st = hdCreate();
    expect(hdRead(st, 'right', 'point', 8, 'x', 'pinch')).toBeNull(); // nothing yet: controls stay put
    update(st, frame([{ side: 'right', pose: { ...OPEN, cx: 0.3 } }, { side: 'left', pose: { ...OPEN, cx: 0.7 } }]));
    const lm = handLm({ ...OPEN, cx: 0.3 });
    const tip = hdToPicture(lm[24], lm[25], place, CAM_ASPECT, PIC);
    expect(hdRead(st, 'right', 'point', 8, 'x', 'pinch')).toBeCloseTo(tip[0], 5);
    expect(hdRead(st, 'right', 'point', 8, 'y', 'pinch')).toBeCloseTo(tip[1], 5);
    expect(hdRead(st, 'right', 'point', 0, 'z', 'pinch')).toBeCloseTo(0.5); // the wrist is level with itself
    expect(hdRead(st, 'right', 'palm', 0, 'x', 'pinch')).toBeGreaterThan(0.6); // mirrored: image left is picture right
    expect(hdRead(st, 'right', 'open', 0, 'x', 'pinch')).toBeGreaterThan(0.9);
    expect(hdRead(st, 'right', 'pinch', 8, 'x', 'pinch')).toBeGreaterThan(0.3);
    expect(hdRead(st, 'right', 'roll', 0, 'x', 'pinch')).toBeCloseTo(0.5, 1); // fingers up
    expect(hdRead(st, 'right', 'size', 0, 'x', 'pinch')).toBeGreaterThan(0.3);
    expect(hdRead(st, 'any', 'spread', 0, 'x', 'pinch')).toBeCloseTo(0.4 * CAM_ASPECT * place.h / PIC, 1);
    expect(hdRead(st, 'right', 'present', 0, 'x', 'pinch')).toBe(1);
    expect(hdPoint(st, 'right', 8)).toEqual({ x: expect.closeTo(tip[0], 5), y: expect.closeTo(tip[1], 5) });

    update(st, frame([{ side: 'right', pose: FIST }]));
    expect(hdRead(st, 'right', 'open', 0, 'x', 'pinch')).toBeLessThan(0.1);
    // The left hand is held for a moment, then gone: distance needs both.
    update(st, frame([{ side: 'right', pose: FIST }], HD_HOLD_MS + 50));
    expect(hdRead(st, 'left', 'present', 0, 'x', 'pinch')).toBe(0);
    expect(hdRead(st, 'any', 'spread', 0, 'x', 'pinch')).toBeNull();
    expect(hdRead(st, 'left', 'point', 8, 'x', 'pinch')).toBeNull();
  });

  it('give two detections of the same hand one each', () => {
    const st = hdCreate();
    update(st, { t: clock += 33, w: CAM_W, h: CAM_H, hands: [{ side: 'right', score: 0.95, lm: handLm({ cx: 0.3 }) }, { side: 'right', score: 0.7, lm: handLm({ cx: 0.7 }) }] });
    expect(st.right.present && st.left.present).toBe(true);
    expect(st.count).toBe(2);
  });

  it('pinch fires once and holds through jitter between the thresholds (hysteresis)', () => {
    const st = hdCreate();
    // Thumb-to-index gap against the palm's length: wide, closing (on below 0.28), jittering under the off threshold (0.42), open.
    const gaps = [0.8, 0.5, 0.2, 0.1, 0.35, 0.15, 0.38, 0.1, 0.6, 0.9].map(r => r * 0.523);
    const states = gaps.map(gap => { update(st, frame([{ side: 'right', pose: { ...OPEN, curl: [0.3, 0, 0, 0], pinch: { tip: 8, gap } } }])); return hdGate(st, 'right', 'pinch'); });
    expect(states).toEqual([false, false, true, true, true, true, true, true, false, false]);
  });

  it('tell a fist, an open palm and pointing apart, each with hysteresis', () => {
    const st = hdCreate();
    const seen = (pose: Pose) => { update(st, frame([{ side: 'right', pose }])); return (['fist', 'open', 'point'] as const).filter(g => hdGate(st, 'right', g)); };
    expect(seen(OPEN)).toEqual(['open']);
    expect(seen(FIST)).toEqual(['fist']);
    // Loosening a little doesn't let go of the fist.
    expect(seen({ curl: [0.75, 0.75, 0.75, 0.75] })).toEqual(['fist']);
    expect(seen(POINT)).toEqual(['point']);
    expect(seen(OPEN)).toEqual(['open']);
  });

  it('hold a hand that drops out for a frame, and report coming into and leaving view', () => {
    const st = hdCreate();
    expect(hdGate(st, 'right', 'leave')).toBe(false); // never seen: nothing has left
    update(st, frame([{ side: 'right', pose: OPEN }]));
    expect(hdGate(st, 'right', 'appear')).toBe(true);
    update(st, frame([], 100));
    expect(hdGate(st, 'right', 'appear')).toBe(true); // a missed frame
    update(st, frame([], HD_HOLD_MS));
    expect(hdGate(st, 'right', 'appear')).toBe(false);
    expect(hdGate(st, 'right', 'leave')).toBe(true);
    expect(hdGate(st, 'any', 'leave')).toBe(true);
  });

  it('smooth jitter away when still, and follow a quick move', () => {
    const f = { x: 0, dx: 0, t: -1 };
    let t = 0, worst = 0;
    for (let i = 0; i < 90; i++) {
      t += 33;
      const noisy = 0.5 + (i % 2 ? 0.01 : -0.01);
      const v = hdEuroStep(f, noisy, t, 0.6, 0.4);
      if (i > 30) worst = Math.max(worst, Math.abs(v - 0.5));
    }
    expect(worst).toBeLessThan(0.004); // ±0.01 of jitter, down to under 0.004
    // A fast move is followed closely within a few frames (the cutoff rises with speed).
    for (let i = 0; i < 6; i++) { t += 33; hdEuroStep(f, 0.9, t, 0.6, 4); }
    expect(f.x).toBeGreaterThan(0.85);

    // Smoothing 0 passes the landmarks straight through; 1 lags behind a jump.
    const raw = hdCreate(), smooth = hdCreate();
    update(raw, frame([{ side: 'right', pose: { cx: 0.3 } }]), 0); update(smooth, { ...frame([]), t: clock, hands: [{ side: 'right', score: 1, lm: handLm({ cx: 0.3 }) }] }, 1);
    const jump = frame([{ side: 'right', pose: { cx: 0.7 } }]);
    update(raw, jump, 0); update(smooth, jump, 1);
    const target = hdToPicture(handLm({ cx: 0.7 })[24], 0.5, place, CAM_ASPECT, PIC)[0];
    expect(hdRead(raw, 'right', 'point', 8, 'x', 'pinch')).toBeCloseTo(target, 5);
    expect(Math.abs(hdRead(smooth, 'right', 'point', 8, 'x', 'pinch')! - target)).toBeGreaterThan(0.05);
  });
});

// ── Steady hands: tracks, sides, phantoms ────────────────────────────────────

/** A detection as the tracker sends it: the classifier's side and score, landmarks for a pose. */
const det = (side: 'left' | 'right', pose: Pose, score = 0.95) => ({ side, score, lm: handLm(pose) });
/** A frame of detections, 33 ms after the last (about 30 a second). */
const at = (hands: ReturnType<typeof det>[], dt = 33): HdFrame => ({ t: (clock += dt), w: CAM_W, h: CAM_H, hands });
/** Default settings: the appearing debounce on, as the app runs it. */
const live = (st: ReturnType<typeof hdCreate>, f: HdFrame, more: Partial<HdUpdateOptions> = {}) => hdUpdate(st, f, { picAspect: PIC, place, smoothing: 0, ...more });
const sides = (st: ReturnType<typeof hdCreate>) => (['left', 'right'] as const).filter(s => st[s].present);

describe('steady hands', () => {
  it('keep a hand’s side while the classifier wavers, and change it only after it disagrees surely for a while', () => {
    const st = hdCreate();
    for (let i = 0; i < 5; i++) live(st, at([det('right', OPEN)]));
    expect(sides(st)).toEqual(['right']);
    const id = st.right.track;
    // A few frames labelled Left, even surely: still the right hand, same track.
    for (let i = 0; i < 6; i++) live(st, at([det('left', OPEN, 0.97)]));
    for (let i = 0; i < 3; i++) live(st, at([det('right', OPEN)]));
    expect(sides(st)).toEqual(['right']);
    expect(st.right.track).toBe(id);
    // Unsure disagreement never changes it, however long.
    for (let i = 0; i < 60; i++) live(st, at([det('left', OPEN, 0.6)]));
    expect(sides(st)).toEqual(['right']);
    // Sure, and for longer than HD_SIDE_SWITCH_MS: it is the left hand after all.
    const frames = Math.ceil(HD_SIDE_SWITCH_MS / 33) + 1;
    for (let i = 0; i < frames - 2; i++) live(st, at([det('left', OPEN, 0.95)]));
    expect(sides(st)).toEqual(['right']);
    for (let i = 0; i < 3; i++) live(st, at([det('left', OPEN, 0.95)]));
    expect(sides(st)).toEqual(['left']);
    expect(st.left.track).toBe(id); // the same hand, relabelled; nothing held over on the right
  });

  it('follow two hands by position when the classifier swaps their labels', () => {
    const st = hdCreate();
    // Your right hand on the image's left (an unmirrored camera), your left on its right.
    const R = { ...OPEN, cx: 0.3 }, L = { ...OPEN, cx: 0.7 };
    for (let i = 0; i < 4; i++) live(st, at([det('right', R), det('left', L)]));
    const ids = { right: st.right.track, left: st.left.track };
    const rx = hdRead(st, 'right', 'palm', 0, 'x', 'pinch')!;
    // Both labels flip for a handful of frames, in either order.
    for (let i = 0; i < 8; i++) live(st, at(i % 2 ? [det('left', R), det('right', L)] : [det('right', L), det('left', R)]));
    expect({ right: st.right.track, left: st.left.track }).toEqual(ids);
    expect(hdRead(st, 'right', 'palm', 0, 'x', 'pinch')).toBeCloseTo(rx, 5);
    // Swapped for good (the camera was mirrored all along): both change together.
    for (let i = 0; i < Math.ceil(HD_SIDE_SWITCH_MS / 33) + 2; i++) live(st, at([det('left', R), det('right', L)]));
    expect({ right: st.right.track, left: st.left.track }).toEqual({ right: ids.left, left: ids.right });
  });

  it('ignore a second hand that flickers in for a frame or two, and show one that stays', () => {
    const st = hdCreate();
    const counts: number[] = [];
    const R = { ...OPEN, cx: 0.3 }, ghost = { ...OPEN, cx: 0.75, s: 0.3 };
    for (let i = 0; i < 4; i++) { live(st, at([det('right', R)])); counts.push(st.count); }
    // A phantom for 1 frame, then 2 frames, then gone.
    for (const n of [1, 0, 0, 2, 0, 0, 0]) {
      for (let k = 0; k < Math.max(1, n); k++) { live(st, at(n ? [det('right', R), det('left', ghost, 0.7)] : [det('right', R)])); counts.push(st.count); }
    }
    expect(counts.slice(4).every(c => c === 1)).toBe(true);
    expect(st.left.ever).toBe(false); // never appeared, so it never "left" either
    expect(hdGate(st, 'left', 'leave')).toBe(false);
    // A real second hand: counts from its HD_APPEAR_FRAMES-th frame.
    const seen: number[] = [];
    for (let i = 0; i < HD_APPEAR_FRAMES; i++) { live(st, at([det('right', R), det('left', ghost)])); seen.push(st.count); }
    expect(seen).toEqual([...Array(HD_APPEAR_FRAMES - 1).fill(1), 2]);
    expect(sides(st)).toEqual(['left', 'right']);
  });

  it('with Max hands 1, never show a second hand', () => {
    const st = hdCreate();
    for (let i = 0; i < 20; i++) live(st, at([det('right', { ...OPEN, cx: 0.3 }, 0.9), det('left', { ...OPEN, cx: 0.7 }, 0.8)]), { maxHands: 1 });
    expect(st.count).toBe(1);
    expect(sides(st)).toEqual(['right']); // the surer one
    expect(hdTracks(st).tracks).toHaveLength(1);
    expect(hdTrackerOptions({ maxHands: 1 }).numHands).toBe(1);
    expect(hdTrackerOptions({}).numHands).toBe(2);
  });

  it('give a newcomer the other side when its label is taken', () => {
    const st = hdCreate();
    for (let i = 0; i < 4; i++) live(st, at([det('right', { ...OPEN, cx: 0.3 })]));
    for (let i = 0; i < 4; i++) live(st, at([det('right', { ...OPEN, cx: 0.3 }), det('right', { ...OPEN, cx: 0.75 }, 0.7)]));
    expect(sides(st)).toEqual(['left', 'right']);
    expect(hdRead(st, 'right', 'palm', 0, 'x', 'pinch')).toBeGreaterThan(0.5); // the first hand kept Right (mirrored: image left is picture right)
  });

  it('drop hands too small or off the frame to be real', () => {
    const st = hdCreate();
    for (let i = 0; i < 5; i++) live(st, at([det('right', { ...OPEN, s: 0.05 })]));
    expect(st.count).toBe(0);
    expect(hdTracks(st)).toMatchObject({ raw: 0, rejected: 1 });
    for (let i = 0; i < 5; i++) live(st, at([det('right', { ...OPEN, cx: 1.3 })]));
    expect(st.count).toBe(0);
    for (let i = 0; i < 5; i++) live(st, at([det('right', { ...OPEN, cx: 0.95 })])); // at the edge, partly out: fine
    expect(st.count).toBe(1);
  });

  it('swap left and right when asked', () => {
    const st = hdCreate();
    for (let i = 0; i < 4; i++) live(st, at([det('right', OPEN)]), { swap: true });
    expect(sides(st)).toEqual(['left']);
  });

  it('describe what it sees for the readout', () => {
    const st = hdCreate();
    live(st, at([det('right', OPEN, 0.9)]));
    expect(hdTracks(st).tracks).toEqual([{ id: 1, side: 'right', said: 'right', score: 0.9, shown: false, held: false }]);
    for (let i = 0; i < 3; i++) live(st, at([det('right', OPEN, 0.9)]));
    live(st, at([]));
    expect(hdTracks(st).tracks[0]).toMatchObject({ shown: true, held: true });
  });
});

describe('the one-euro filter', () => {
  /** Feed a still value with ±`noise` jitter, then a fast ramp; return the worst jitter left and the lag at the ramp's end. */
  function run(smoothing: number, responsiveness: number) {
    const { minCutoff, beta } = hdEuroParams(smoothing, responsiveness);
    const f = { x: 0, dx: 0, t: -1 };
    let t = 0, jitter = 0;
    for (let i = 0; i < 90; i++) { t += 33; const v = hdEuroStep(f, 0.5 + (i % 2 ? 0.004 : -0.004), t, minCutoff, beta); if (i > 45) jitter = Math.max(jitter, Math.abs(v - 0.5)); }
    // A quick move: 0.5 → 0.9 in 5 frames (about 2.4 picture widths a second).
    let target = 0.5;
    for (let i = 0; i < 5; i++) { t += 33; target += 0.08; hdEuroStep(f, target, t, minCutoff, beta); }
    return { jitter, lag: target - f.x };
  }

  it('calms a still hand more as Smoothing rises, and 0 passes straight through', () => {
    const lo = run(0.2, 0.5), mid = run(0.5, 0.5), hi = run(0.9, 0.5);
    expect(mid.jitter).toBeLessThan(lo.jitter);
    expect(hi.jitter).toBeLessThan(mid.jitter);
    expect(mid.jitter).toBeLessThan(0.0015); // ±0.004 down to under 0.0015
    expect(hdEuroParams(0, 0.5).minCutoff).toBeGreaterThan(8);
  });

  it('follows a fast move closely with Responsiveness, and lags without it', () => {
    const none = run(0.5, 0), mid = run(0.5, 0.5), high = run(0.5, 1);
    expect(none.lag).toBeGreaterThan(0.15); // a plain low-pass trails far behind
    expect(mid.lag).toBeLessThan(0.05);
    expect(high.lag).toBeLessThan(mid.lag);
    // Responsiveness doesn't disturb a still hand: the speed term is near zero there.
    expect(Math.abs(mid.jitter - none.jitter)).toBeLessThan(0.001);
  });
});

describe('tracker options', () => {
  it('map Strictness onto the three thresholds, a notch stricter than MediaPipe by default', () => {
    const d = hdTrackerOptions(undefined);
    expect(d.detection).toBeGreaterThan(0.5);
    expect(d.presence).toBeGreaterThan(0.5);
    expect(d.tracking).toBeGreaterThan(0.5);
    const lax = hdTrackerOptions({ strictness: 0 }), strict = hdTrackerOptions({ strictness: 1 });
    expect(lax.detection).toBeLessThan(d.detection);
    expect(strict.detection).toBeGreaterThan(d.detection);
    expect(strict.detection).toBeLessThanOrEqual(0.9);
    // Set by hand (Advanced): used as they are.
    expect(hdTrackerOptions({ strictness: 1, confidence: { detection: 0.4, presence: 0.5, tracking: 0.6 } })).toEqual({ numHands: 2, detection: 0.4, presence: 0.5, tracking: 0.6 });
  });
});

// ── Names ────────────────────────────────────────────────────────────────────

describe('hand sources and triggers, by name', () => {
  const src = (o: Partial<Extract<PlaySource, { kind: 'hand' }>>): Extract<PlaySource, { kind: 'hand' }> => ({ kind: 'hand', side: 'right', read: 'point', point: 8, axis: 'x', gesture: 'fist', ...o });
  it('read as a person would say them', () => {
    expect(handSourceLabel(src({}))).toBe('Right · Index tip · X');
    expect(handSourceLabel(src({ side: 'left', point: 4, axis: 'z' }))).toBe('Left · Thumb tip · Z');
    expect(handSourceLabel(src({ read: 'pinch' }))).toBe('Right · Pinch');
    expect(handSourceLabel(src({ read: 'pinch', point: 12 }))).toBe('Right · Middle pinch');
    expect(handSourceLabel(src({ read: 'palm', axis: 'y' }))).toBe('Right · Palm Y');
    expect(handSourceLabel(src({ read: 'open', side: 'any' }))).toBe('Either hand · Openness');
    expect(handSourceLabel(src({ read: 'gesture', gesture: 'point' }))).toBe('Right · Point (held)');
    expect(sourceLabel(src({ read: 'spread' }))).toBe('Hands apart');
    expect(triggerLabel({ on: 'hand', side: 'left', gesture: 'pinchRing' })).toBe('Left · Ring pinch');
    expect(triggerKey({ on: 'hand', side: 'right', gesture: 'fist' })).toBe('hand:right:fist');
  });
  it('switch readings in the picker, keeping the hand', () => {
    const left = src({ side: 'left', point: 20 });
    expect(sourceType(left)).toBe('hand:point');
    expect(sourceFromType('hand:pinch', left)).toMatchObject({ kind: 'hand', side: 'left', read: 'pinch', point: 20 });
    expect(sourceFromType('hand:pinch', src({ point: 0 }))).toMatchObject({ read: 'pinch', point: 8 });
    expect(sourceFromType('hand:palm', left)).toMatchObject({ side: 'left', read: 'palm', axis: 'x' });
  });
});

// ── Through the Play engine ──────────────────────────────────────────────────

const ctl = { id: 'c', target: 'n::amount', kind: 'float' as const, label: 'Amount', min: 0, max: 10 };
/** Smoothing off, so each frame's landmarks land as they are. */
function engineRecord(over: Partial<PlayRecord>): PlayRecord {
  return { ...emptyPlayRecord(), controls: [ctl], hands: { ...DEFAULT_HANDS, smoothing: 0 }, ...over };
}
function push(hands: { side: 'left' | 'right'; pose: Pose }[]) {
  clock = Math.max(clock + 33, performance.now());
  handFeed.push({ t: clock, w: CAM_W, h: CAM_H, hands: hands.map(h => ({ side: h.side, score: 0.9, lm: handLm(h.pose) })) });
}
/** A hand coming into view: seen for the frames it takes to count (ticking the engine at `at` seconds). */
function arrive(hands: { side: 'left' | 'right'; pose: Pose }[], at: number) {
  for (let i = 0; i < HD_APPEAR_FRAMES - 1; i++) { push(hands); inputBus.tick(1 / 60, at + i / 100); }
}

afterEach(() => {
  useTakes.getState().endReplay();
  useTakes.getState().cancel();
  useNodeGraphStore.getState().setPlay(emptyPlayRecord());
  playEngine.setRecord(emptyPlayRecord());
  inputBus.setParamBindings({});
  vi.restoreAllMocks();
});

describe('the Play engine with hands', () => {
  it('maps a hand source onto a control, and leaves it alone with no hand in view', () => {
    playEngine.setAspect(PIC);
    playEngine.setRecord(engineRecord({ mappings: [{ id: 'm', controlId: 'c', source: { kind: 'hand', side: 'right', read: 'open', point: 8, axis: 'x', gesture: 'fist' }, outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, enabled: true }] }));
    inputBus.setParamBindings({ 'n::amount': 'u_amount' });
    arrive([{ side: 'right', pose: OPEN }], 0.9);
    push([{ side: 'right', pose: OPEN }]);
    expect(inputBus.tick(1 / 60, 1).get('u_amount')).toBeGreaterThan(9);
    push([{ side: 'right', pose: FIST }]);
    expect(inputBus.tick(1 / 60, 1.02).get('u_amount')).toBeLessThan(1);
  });

  it('fires a gesture action once per gesture, and a gesture trigger plays an envelope', () => {
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(a.do));
    const trig: PlaySource = { kind: 'trigger', trigger: { on: 'hand', side: 'right', gesture: 'fist' }, mode: 'toggle', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false };
    playEngine.setRecord(engineRecord({
      layers: [defaultLayer('particles', 'p', 'Sparks')],
      mappings: [{ id: 'm', controlId: 'c', source: trig, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
      actions: [{ id: 'a', trigger: { on: 'hand', side: 'right', gesture: 'fist' }, do: 'burst', layerId: 'p', amount: 50, enabled: true }],
    }));
    inputBus.setParamBindings({ 'n::amount': 'u_amount' });
    let t = 2, last = 0;
    arrive([{ side: 'right', pose: OPEN }], 1.9);
    for (const pose of [OPEN, FIST, FIST, { curl: [0.7, 0.7, 0.7, 0.7] } as Pose, FIST, OPEN, FIST]) {
      push([{ side: 'right', pose }]);
      last = inputBus.tick(1 / 60, (t += 1 / 60)).get('u_amount') as number;
    }
    off();
    expect(fired).toEqual(['burst', 'burst']);
    expect(last).toBe(0); // toggled on by the first fist, off by the second
  });

  it('learns the landmark that moved most, and the gesture made', () => {
    playEngine.setAspect(PIC);
    playEngine.setRecord(engineRecord({}));
    vi.spyOn(handFeed, 'isOn').mockReturnValue(true);
    let learned: PlaySource | null = null;
    arrive([{ side: 'right', pose: { ...OPEN, cy: 0.5 } }], 2.9);
    const stop = playEngine.startLearn(s => { learned = s; });
    push([{ side: 'right', pose: { ...OPEN, cy: 0.5 } }]);
    inputBus.tick(1 / 60, 3);
    // Only the index finger curls: its tip moves most, downward.
    push([{ side: 'right', pose: { curl: [0.9, 0, 0, 0], cy: 0.5 } }]);
    inputBus.tick(1 / 60, 3.02);
    stop();
    expect(learned).toMatchObject({ kind: 'hand', side: 'right', read: 'point', point: 8, axis: 'y' });

    let gesture: unknown = null;
    const stop2 = playEngine.startLearnTrigger(t => { gesture = t; });
    push([{ side: 'right', pose: OPEN }]);
    inputBus.tick(1 / 60, 3.04);
    push([{ side: 'right', pose: FIST }]);
    inputBus.tick(1 / 60, 3.06);
    stop2();
    expect(gesture).toEqual({ on: 'hand', side: 'right', gesture: 'fist' });
  });
});

// ── Nulls that follow a hand ─────────────────────────────────────────────────

function fakeCanvas(log: string[] | null) {
  const canvas = { width: 160, height: 90, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const target: Record<string, unknown> = {
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    measureText: (s: string) => ({ width: String(s).length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    canvas: null,
  };
  const ctx: unknown = new Proxy(target, {
    get(t, k: string) { if (k in t) return t[k]; return () => { log?.push(k); }; },
    set(t, k: string, v) { t[k] = v; return true; },
  });
  return canvas;
}

describe('a null following a hand', () => {
  it('chases the fingertip on its spring, waits when the hand leaves, and draws the skeleton with the guides', () => {
    const g = globalThis as { document?: unknown };
    const had = g.document;
    g.document = { createElement: () => fakeCanvas(null) };
    try {
      const kit = createLayerKit();
      const nul = { ...defaultLayer('null', 'n', 'Tip'), follow: 'hand', handSide: 'right', handPoint: 8, spring: 0.8, wobble: 0 } as PlayLayer;
      const record: PlayRecord = { ...emptyPlayRecord(), layers: [nul] };
      const at = new Map<string, number>();
      const st = hdCreate();
      update(st, frame([{ side: 'right', pose: OPEN }]));
      let where: { x: number; y: number } | null = { x: 0.8, y: 0.3 };
      const asked: string[] = [];
      const log: string[] = [];
      const env = (): KitEnv => ({
        gl: fakeCanvas(null), W: 160, H: 90, dpr: 1, time: 0, dt: 1 / 30,
        value: (l, k) => at.get(`${l.id}::${k}`) ?? (l as unknown as Record<string, number>)[k],
        pointer: { x: 0.5, y: 0.5, over: false, down: false },
        markers: true, editing: false, hidden: false, backdrop: [0, 0, 0], audio: null, camera: null, image: () => null,
        sensor: () => {}, override: (id, k, v) => { if (v === null) at.delete(`${id}::${k}`); else at.set(`${id}::${k}`, v); },
        hand: (side, point) => { asked.push(`${side}:${point}`); return where; },
        hands: { state: st, colour: [1, 1, 1] },
      });
      const out = fakeCanvas(log).getContext('2d')!;
      for (let i = 0; i < 60; i++) kit.frame(out, record, env());
      expect(asked[0]).toBe('right:8');
      expect(at.get('n::x')).toBeCloseTo(0.8, 2);
      expect(at.get('n::y')).toBeCloseTo(0.3, 2);
      // The hand leaves: it waits where it was.
      where = null;
      for (let i = 0; i < 10; i++) kit.frame(out, record, env());
      expect(at.get('n::x')).toBeCloseTo(0.8, 2);
      // Skeleton: a dot per landmark (plus the null's marker and the L/R tag).
      expect(log.filter(k => k === 'arc').length).toBeGreaterThanOrEqual(21 * 70);
    } finally { g.document = had; }
  });
});

// ── Takes ────────────────────────────────────────────────────────────────────

describe('a take with hands', () => {
  it('records hand-driven values and gesture-fired actions, and rests the tracker while it plays back', async () => {
    const record = engineRecord({
      layers: [defaultLayer('particles', 'p', 'Sparks')],
      mappings: [{ id: 'm', controlId: 'c', source: { kind: 'hand', side: 'right', read: 'open', point: 8, axis: 'x', gesture: 'fist' }, outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, enabled: true }],
      actions: [{ id: 'a', trigger: { on: 'hand', side: 'right', gesture: 'fist' }, do: 'burst', layerId: 'p', amount: 70, enabled: true }],
    });
    useNodeGraphStore.getState().setPlay(record);
    playEngine.setRecord(record);
    inputBus.setParamBindings({ 'n::amount': 'u_amount' });
    useTakes.getState().setSettings({ countIn: false, manual: true });
    useTakes.getState().begin();
    for (let i = 0; i <= 60; i++) {
      push([{ side: 'right', pose: i < 30 ? OPEN : FIST }]);
      inputBus.tick(1 / 60, 20 + i / 60);
    }
    useTakes.getState().stop();
    await Promise.resolve();
    const take = useNodeGraphStore.getState().play.takes![0];
    expect(take.events).toEqual([{ t: expect.closeTo(0.5, 1), do: 'burst', layerId: 'p', amount: 70 }]);
    const amount = take.tracks.find(t => t.id === 'c')!;
    expect(amount.keys.split(',').length).toBeGreaterThanOrEqual(4);

    // Playing back: the tracker rests, and a fist made now fires nothing.
    expect(useTakes.getState().phase).toBe('replay');
    expect(handFeed.isPaused()).toBe(true);
    const fired = vi.fn();
    const off = playEngine.onAction(fired);
    push([{ side: 'right', pose: OPEN }]); inputBus.tick(1 / 60, 20.1);
    push([{ side: 'right', pose: FIST }]); inputBus.tick(1 / 60, 20.12);
    off();
    expect(fired).not.toHaveBeenCalled();
    useTakes.getState().endReplay();
    expect(handFeed.isPaused()).toBe(false);
  });
});

// ── Files and exports ────────────────────────────────────────────────────────

describe('hands in a play file', () => {
  const record: PlayRecord = {
    ...emptyPlayRecord(),
    controls: [ctl],
    layers: [
      defaultLayer('particles', 'p', 'Sparks'),
      { ...defaultLayer('null', 'n', 'Tip'), follow: 'hand', handSide: 'left', handPoint: 4 } as PlayLayer,
    ],
    mappings: [
      { id: 'm1', controlId: 'c', source: { kind: 'hand', side: 'any', read: 'point', point: 20, axis: 'z', gesture: 'fist' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      { id: 'm2', controlId: 'c', source: { kind: 'trigger', trigger: { on: 'hand', side: 'left', gesture: 'pinchPinky' }, mode: 'envelope', attack: 10, decay: 200, sustain: 0.5, release: 400, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
    ],
    actions: [{ id: 'a', trigger: { on: 'hand', side: 'right', gesture: 'leave' }, do: 'burst', layerId: 'p', amount: 60, enabled: true }],
    hands: { smoothing: 0.8, overlay: false, colour: [1, 0.5, 0], mirror: false },
  };

  it('round-trips hand sources, gesture triggers, hand-following nulls and the settings', () => {
    expect(parsePlayRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(usesHands(record)).toBe(true);
  });

  it('mends what it can: an unknown read, gesture or side falls back, the point is clamped', () => {
    const r = parsePlayRecord({ ...record, mappings: [{ ...record.mappings[0], source: { kind: 'hand', side: 'middle', read: 'wave', point: 99, axis: 'w', gesture: 'wave' } }], hands: { smoothing: 4 } });
    expect(r.mappings[0].source).toEqual({ kind: 'hand', side: 'right', read: 'point', point: 20, axis: 'x', gesture: 'pinch' });
    expect(r.hands).toEqual({ smoothing: 1, overlay: true, colour: [0.35, 1, 0.75], mirror: true });
  });

  it('round-trips the newer settings, and reads an older file’s settings back as they were', () => {
    const newer: PlayRecord = { ...record, hands: { ...record.hands!, responsiveness: 0.7, swap: true, maxHands: 1, strictness: 0.8, confidence: { detection: 0.7, presence: 0.6, tracking: 0.5 } } };
    expect(parsePlayRecord(JSON.parse(JSON.stringify(newer)))).toEqual(newer);
    const old = parsePlayRecord(JSON.parse(JSON.stringify(record)));
    expect(Object.keys(old.hands!).sort()).toEqual(['colour', 'mirror', 'overlay', 'smoothing']);
    const mended = parsePlayRecord({ ...record, hands: { ...record.hands, maxHands: 3, strictness: 7, swap: 'yes', confidence: { detection: 2 } } });
    expect(mended.hands).toEqual({ ...record.hands, strictness: 1, confidence: { detection: 0.95, presence: 0.6, tracking: 0.6 } });
  });

  it('knows when a setup reads only one hand', () => {
    expect(oneHandUsed(record)).toBeNull(); // either, left and right
    const tip = (side: 'left' | 'right' | 'any') => ({ ...defaultLayer('null', 'n' + side, 'Tip'), follow: 'hand', handSide: side, handPoint: 8 } as PlayLayer);
    expect(oneHandUsed({ ...emptyPlayRecord(), layers: [tip('right')] })).toBe('right');
    expect(oneHandUsed({ ...emptyPlayRecord(), layers: [tip('right'), tip('left')] })).toBeNull();
    expect(oneHandUsed({ ...emptyPlayRecord(), layers: [tip('any')] })).toBeNull();
    expect(oneHandUsed(emptyPlayRecord())).toBeNull();
  });

  it('leaves hand tracking out of a web page unless asked, and says so', () => {
    const input = { title: 't', fragmentShader: '', uniforms: {}, paramBindings: {}, play: record, aspect: '16:9' as const };
    expect(leftBehind(record).map(x => x.what)).toContain('Hand tracking');
    expect(leftBehind(record, undefined, { hands: true }).map(x => x.what)).not.toContain('Hand tracking');
    expect(mediaCarried(undefined, 'pending')[0].what).toMatch(/Hand tracking/);
    expect('hands' in playBundle(input)).toBe(false);
    const assets = { bundle: 'a', loader: 'b', wasm: 'c', model: 'd' };
    expect(playBundle({ ...input, handAssets: assets }).hands).toEqual(assets);
    expect(playBundle({ ...input, play: emptyPlayRecord(), handAssets: assets }).hands).toBeUndefined();
    expect(playBundle(input).play.hands).toEqual(record.hands);
  });
});

// The overlay only asks the engine for hands when drawing live; a take's replay and exports don't.
describe('the overlay', () => {
  it('hands the kit the engine’s hand points only while live', () => {
    const spy = vi.spyOn(playEngine, 'handPoint').mockReturnValue({ x: 0.1, y: 0.2 });
    const env = (playOverlay as unknown as { env: (...a: unknown[]) => KitEnv }).env(fakeCanvas(null), 160, 90, 1, 0, 1 / 60, false);
    expect(env.hand?.('right', 8)).toEqual({ x: 0.1, y: 0.2 });
    const exported = (playOverlay as unknown as { env: (...a: unknown[]) => KitEnv }).env(fakeCanvas(null), 160, 90, 1, 0, 1 / 60, true);
    expect(exported.hand).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the hand on the picture', () => {
  it('has its own switch: shown with the guides hidden, hidden by Show hand on picture', () => {
    const st = hdCreate(); st.live = true;
    vi.spyOn(playEngine, 'handState').mockReturnValue(st);
    const o = playOverlay as unknown as { record: PlayRecord; env: (...a: unknown[]) => KitEnv };
    const envOf = () => o.env(fakeCanvas(null), 160, 90, 1, 0, 1 / 60, false);
    const before = o.record;
    try {
      playOverlay.setGuides(false);
      o.record = { ...emptyPlayRecord(), hands: { ...DEFAULT_HANDS, overlay: true } };
      expect(envOf().hands).toMatchObject({ state: st });
      o.record = { ...emptyPlayRecord(), hands: { ...DEFAULT_HANDS, overlay: false } };
      expect(envOf().hands).toBeNull();
    } finally { o.record = before; playOverlay.setGuides(true); }
  });
});
