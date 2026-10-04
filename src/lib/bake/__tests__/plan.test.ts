/** Bake planning (docs/bake.md): frames, sizes, the seamless loop's crossfade, and which frame shows when. */
import { describe, expect, it } from 'vitest';
import {
  BAKE_FADE_BUDGET, bakeFileName, bakeFrameAt, bakeSize, bakeSteps, bakeVideoTime, blendInto, estimateBake, fadeFramesFor, fadeWeight, packAlpha, planBake,
  DEFAULT_BAKE, type BakeSettings,
} from '../plan';

const s = (over: Partial<BakeSettings> = {}): BakeSettings => ({ ...DEFAULT_BAKE, ...over });

describe('planBake', () => {
  it('counts frames from duration × fps and keeps the preview’s shape at even sizes', () => {
    const p = planBake(s({ duration: 4, fps: 30, loop: 'none' }), 1281, 721);
    expect(p.frames).toBe(120);
    expect(p.duration).toBe(4);
    expect([p.width, p.height]).toEqual([1282, 722]);
    expect(p.fadeFrames).toBe(0);
    expect(p.renders).toBe(120);
  });

  it('half and fixed heights keep the aspect; huge sizes shrink to the encoder limit', () => {
    expect(bakeSize('half', 1920, 1080)).toEqual({ width: 960, height: 540 });
    expect(bakeSize(720, 1920, 1080)).toEqual({ width: 1280, height: 720 });
    const big = bakeSize('full', 8000, 4000);
    expect(big.width).toBe(4096);
    expect(big.height).toBe(2048);
  });

  it('an alpha bake’s frame is twice as tall (colour above alpha)', () => {
    const p = planBake(s({ alpha: true }), 640, 360);
    expect([p.frameWidth, p.frameHeight]).toEqual([640, 720]);
  });

  it('clamps nonsense to the limits', () => {
    const p = planBake(s({ duration: -3, fps: 1000, start: -1 }), 100, 100);
    expect(p.fps).toBe(120);
    expect(p.frames).toBeGreaterThanOrEqual(1);
    expect(p.start).toBe(0);
  });
});

describe('seamless loop crossfade', () => {
  it('fades up to a second (a quarter of short bakes), within the memory budget', () => {
    expect(fadeFramesFor('seamless', 30, 300, 1000)).toBe(30);
    expect(fadeFramesFor('seamless', 30, 40, 1000)).toBe(10);
    expect(fadeFramesFor('none', 30, 300, 1000)).toBe(0);
    expect(fadeFramesFor('seamless', 30, 300, BAKE_FADE_BUDGET / 4)).toBe(4);
  });

  it('renders the pre-roll first, then every frame; the tail blends towards the pre-roll', () => {
    const p = planBake(s({ duration: 2, fps: 10, start: 5, loop: 'seamless' }), 100, 100);
    expect(p.frames).toBe(20);
    expect(p.fadeFrames).toBe(5);
    const steps = bakeSteps(p);
    expect(steps).toHaveLength(25);
    // Pre-roll: the 5 frames just before the start, in order.
    expect(steps.slice(0, 5).map(x => x.preIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(steps[0].time).toBeCloseTo(4.5);
    expect(steps[4].time).toBeCloseTo(4.9);
    // Video frame i at start + i/fps.
    expect(steps[5]).toMatchObject({ frame: 0, blend: null });
    expect(steps[5].time).toBeCloseTo(5);
    expect(steps[24].frame).toBe(19);
    expect(steps[24].time).toBeCloseTo(6.9);
    // The last F frames blend with pre[k], weights rising towards it.
    const tail = steps.slice(20);
    expect(tail.map(x => x.blend?.index)).toEqual([0, 1, 2, 3, 4]);
    expect(tail.map(x => x.blend!.weight)).toEqual([1, 2, 3, 4, 5].map(k => k / 5));
    expect(steps[19].blend).toBeNull();
  });

  it('the loop point is continuous: the last frame is mostly the frame before the first', () => {
    // A picture that is just its own time: out[N−1] ≈ render(start − 1/fps), next comes render(start).
    const fps = 10, start = 0, N = 20, F = 5;
    const p = planBake(s({ duration: N / fps, fps, start, loop: 'seamless' }), 64, 64);
    const steps = bakeSteps(p);
    const pre: number[] = [];
    const out: number[] = [];
    for (const st of steps) {
      if (st.preIndex !== null) { pre[st.preIndex] = st.time; continue; }
      out[st.frame!] = st.blend ? st.time * (1 - st.blend.weight) + pre[st.blend.index] * st.blend.weight : st.time;
    }
    expect(out).toHaveLength(N);
    // Each step of the looped sequence moves by about one frame, including across the wrap.
    const loop = [...out, out[0]];
    const steps2 = loop.slice(1).map((v, i) => v - loop[i]);
    const wrap = steps2[N - 1];
    expect(Math.abs(wrap)).toBeLessThan(2 / fps);
    expect(fadeWeight(F - 1, F)).toBe(1);
    expect(out[N - 1]).toBeCloseTo(start - 1 / fps);
  });

  it('blendInto mixes bytes by the weight', () => {
    const a = new Uint8Array([0, 100, 200, 255]);
    blendInto(a, new Uint8Array([255, 100, 0, 255]), 0.25);
    expect([...a]).toEqual([64, 100, 150, 255]);
  });
});

describe('time sync', () => {
  const clock = { start: 2, duration: 3, fps: 10, loop: 'none' as const };
  it('frame = (t − start) × fps, held before the start and at the end', () => {
    expect(bakeFrameAt(2, clock)).toBe(0);
    expect(bakeFrameAt(2.1, clock)).toBe(1);
    expect(bakeFrameAt(2 + 7 / 10, clock)).toBe(7); // floating point stays on the frame
    expect(bakeFrameAt(0, clock)).toBe(0);
    expect(bakeFrameAt(100, clock)).toBe(29);
  });
  it('loops wrap, both ways', () => {
    const c = { ...clock, loop: 'seamless' as const };
    expect(bakeFrameAt(5, c)).toBe(0);
    expect(bakeFrameAt(5.5, c)).toBe(5);
    expect(bakeFrameAt(1.9, c)).toBe(29);
  });
  it('seeks to the middle of a frame', () => {
    expect(bakeVideoTime(0, 30)).toBeCloseTo(1 / 60);
    expect(bakeVideoTime(9, 10)).toBeCloseTo(0.95);
  });
  it('every frame of an offline render maps back to its own video frame', () => {
    const c = { start: 0, duration: 4, fps: 30, loop: 'seamless' as const };
    for (let i = 0; i < 120; i++) expect(bakeFrameAt(i / 30, c)).toBe(i);
  });
});

describe('alpha packing, estimate, file name', () => {
  it('colour on top (opaque), alpha as grey beneath', () => {
    const rgba = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 255]);
    const out = new Uint8Array(16);
    packAlpha(rgba, 2, 1, out);
    expect([...out]).toEqual([10, 20, 30, 255, 50, 60, 70, 255, 40, 40, 40, 255, 255, 255, 255, 255]);
  });
  it('estimates grow with pixels and frames', () => {
    const small = estimateBake(planBake(s({ duration: 5 }), 640, 360));
    const big = estimateBake(planBake(s({ duration: 10 }), 1280, 720));
    expect(big.bytes).toBeGreaterThan(small.bytes * 7);
    expect(estimateBake(planBake(s(), 640, 360), 40).seconds).toBeGreaterThan(estimateBake(planBake(s(), 640, 360), 4).seconds);
  });
  it('names the file after the source and the time', () => {
    expect(bakeFileName('Raymarch / scene!', 'mp4', new Date(2026, 9, 4, 9, 5, 7))).toBe('Baked Raymarch  scene 2026-10-04 09.05.07.mp4');
  });
});
