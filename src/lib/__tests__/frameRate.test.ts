/**
 * The canvas frame rate (lib/frameRate.ts, docs/frame-rate.md): the screen's refresh rate from rAF
 * intervals, clamping, time stepped by 1/fps, which screen frames draw, held frames in offline
 * renders (exports, recordings, bakes), and the setting saved with the graph.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
    key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
  });
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});
import {
  clampFps, distinctFrames, estimateRefreshHz, gateFrame, newDrawGate, newOfflineHold, offlineFrame, parseFrameRate,
  posterizeTime, resolveFrameRate, stepIndex, useFrameRate, type EffectiveFrameRate,
} from '../frameRate';
import { screenKeyOf } from '../refreshRate';
import { parsePlayRecordAsSaved } from '../../types/play';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';

/** Intervals of a `hz` screen with a little jitter, and every `dropEvery`th frame dropped (two refreshes). */
function intervals(hz: number, n = 90, dropEvery = 0, jitter = 0.3): number[] {
  const p = 1000 / hz;
  return Array.from({ length: n }, (_, i) => (dropEvery && i % dropEvery === 0 ? 2 * p : p) + (i % 2 ? jitter : -jitter));
}

describe('the screen’s refresh rate', () => {
  it('reads 60, 120, 144 and 90 Hz from rAF intervals', () => {
    expect(estimateRefreshHz(intervals(60))).toBe(60);
    expect(estimateRefreshHz(intervals(120))).toBe(120);
    expect(estimateRefreshHz(intervals(144))).toBe(144);
    expect(estimateRefreshHz(intervals(90))).toBe(90);
  });
  it('a busy page dropping frames still reads the screen, not half of it', () => {
    expect(estimateRefreshHz(intervals(120, 90, 3))).toBe(120);
    expect(estimateRefreshHz(intervals(60, 90, 2))).toBe(60);
  });
  it('snaps to a common rate within 4%, else rounds; too few samples say nothing', () => {
    expect(estimateRefreshHz(Array(20).fill(1000 / 58.5))).toBe(60);
    expect(estimateRefreshHz(Array(20).fill(1000 / 111))).toBe(111);
    expect(estimateRefreshHz([16, 17, 16])).toBeNull();
    // A stall (a hidden tab) is thrown out.
    expect(estimateRefreshHz([...intervals(60, 30), 500, 1200])).toBe(60);
  });
  it('a different screen is a different key', () => {
    expect(screenKeyOf({ width: 1512, height: 982, availLeft: 0 }, 2)).not.toBe(screenKeyOf({ width: 2560, height: 1440, availLeft: 1512 }, 1));
  });
});

describe('clamping and the setting', () => {
  it('keeps a rate between 1 and the screen’s', () => {
    expect(clampFps(12, 120)).toBe(12);
    expect(clampFps(240, 120)).toBe(120);
    expect(clampFps(0, 60)).toBe(1);
    expect(clampFps(-5, 60)).toBe(1);
    expect(clampFps(23.976, 60)).toBe(23.98);
    expect(clampFps(NaN, 60)).toBe(60);
  });
  it('resolves the graph’s own, else the default, else Auto; live it caps at the screen', () => {
    expect(resolveFrameRate(undefined, undefined, 60)).toEqual({ fps: null, draw: false, posterize: false });
    expect(resolveFrameRate({ fps: 12 }, undefined, 60)).toEqual({ fps: 12, draw: true, posterize: true });
    expect(resolveFrameRate(undefined, { fps: 8, mode: 'draw' }, 60)).toEqual({ fps: 8, draw: true, posterize: false });
    expect(resolveFrameRate({ fps: 'auto' }, { fps: 8 }, 60).fps).toBeNull();
    expect(resolveFrameRate({ fps: 12, mode: 'posterize' }, undefined, 60)).toEqual({ fps: 12, draw: false, posterize: true });
    // 120 asked for on a 60 Hz screen: 60, drawing every frame.
    expect(resolveFrameRate({ fps: 120 }, undefined, 60)).toEqual({ fps: 60, draw: false, posterize: true });
    // Offline (no screen): as saved.
    expect(resolveFrameRate({ fps: 120 }, undefined)).toEqual({ fps: 120, draw: true, posterize: true });
  });
  it('parses what was saved and drops what is malformed', () => {
    expect(parseFrameRate({ fps: 12 })).toEqual({ fps: 12 });
    expect(parseFrameRate({ fps: 12, mode: 'draw' })).toEqual({ fps: 12, mode: 'draw' });
    expect(parseFrameRate({ fps: 12, mode: 'sideways' })).toEqual({ fps: 12 });
    expect(parseFrameRate({ fps: 'auto', mode: 'draw' })).toEqual({ fps: 'auto' });
    expect(parseFrameRate({ fps: '12' })).toBeUndefined();
    expect(parseFrameRate(null)).toBeUndefined();
  });
});

describe('time stepped by 1/fps', () => {
  it('holds to the start of each step', () => {
    expect(posterizeTime(0, 12)).toBe(0);
    expect(posterizeTime(0.08, 12)).toBe(0);
    expect(posterizeTime(1 / 12, 12)).toBeCloseTo(1 / 12, 12);
    expect(posterizeTime(0.5, 12)).toBeCloseTo(0.5, 12);
    expect(posterizeTime(37.32, 12)).toBeCloseTo(37.25, 12);
    expect(posterizeTime(1.234, null)).toBe(1.234);
  });
  it('a clock summed from 60 Hz frames lands in the right step (no float drift)', () => {
    let t = 0;
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) { seen.push(posterizeTime(t, 12)); t += 1 / 60; }
    const distinct = [...new Set(seen.map(x => +x.toFixed(9)))];
    expect(distinct).toHaveLength(24);
    distinct.forEach((x, k) => expect(x).toBeCloseTo(k / 12, 9));
    expect(stepIndex(5 / 60, 12)).toBe(1);
  });
});

/** A rAF loop at `hz` for `seconds` against a gate: which frames drew, and the time each showed. */
function runLoop(hz: number, fps: number, o: { stepped: boolean; seconds?: number; jitter?: number }): { draws: number; times: number[]; gaps: number[] } {
  const g = newDrawGate();
  const frames = Math.round((o.seconds ?? 1) * hz);
  let draws = 0, clock = 0, lastDraw = -1;
  const times: number[] = [], gaps: number[] = [];
  for (let i = 0; i < frames; i++) {
    const now = i * 1000 / hz + (o.jitter ? (i % 2 ? o.jitter : -o.jitter) : 0);
    clock = i / hz;
    if (gateFrame(g, { now, fps, time: clock, stepped: o.stepped, playing: true, wants: false, slackMs: 250 / hz })) {
      draws++;
      times.push(o.stepped ? posterizeTime(clock, fps) : clock);
      if (lastDraw >= 0) gaps.push(i - lastDraw);
      lastDraw = i;
    }
  }
  return { draws, times, gaps };
}

describe('render throttling', () => {
  it('12 fps on a 60 Hz screen: every 5th frame, each a new 1/12 s step', () => {
    const r = runLoop(60, 12, { stepped: true });
    expect(r.draws).toBe(12);
    expect(new Set(r.gaps)).toEqual(new Set([5]));
    r.times.forEach((t, k) => expect(t).toBeCloseTo(k / 12, 9));
  });
  it('12 fps on 120 Hz: 12 draws a second, every 10th frame', () => {
    const r = runLoop(120, 12, { stepped: true, seconds: 2 });
    expect(r.draws).toBe(24);
    expect(new Set(r.gaps)).toEqual(new Set([10]));
  });
  it('24 fps on 60 Hz alternates 3 and 2 frames and keeps 24 a second (draw only, with jitter)', () => {
    const r = runLoop(60, 24, { stepped: false, seconds: 2, jitter: 0.4 });
    expect(r.draws).toBe(48);
    expect(new Set(r.gaps)).toEqual(new Set([2, 3]));
  });
  it('24 fps stepped: no step drawn twice, none skipped', () => {
    const r = runLoop(60, 24, { stepped: true, seconds: 2 });
    expect(r.draws).toBe(48);
    r.times.forEach((t, k) => expect(t).toBeCloseTo(k / 24, 9));
  });
  it('paused: an edit draws at most once per interval; a stall starts the schedule over', () => {
    const g = newDrawGate();
    const ask = (now: number) => gateFrame(g, { now, fps: 10, time: 3, stepped: true, playing: false, wants: true });
    expect(ask(0)).toBe(true);
    expect(ask(16)).toBe(false);
    expect(ask(99)).toBe(true);
    expect(ask(5000)).toBe(true);
    expect(ask(5016)).toBe(false);
    expect(ask(5100)).toBe(true);
  });
  it('stepped and playing: an edit inside a step draws once the interval is up', () => {
    const g = newDrawGate();
    const at = (now: number, time: number, wants: boolean) => gateFrame(g, { now, fps: 12, time, stepped: true, playing: true, wants });
    expect(at(0, 0, false)).toBe(true);
    expect(at(16, 0.016, true)).toBe(false);
    expect(at(84, 0.0834, false)).toBe(true); // the next step
    expect(at(100, 0.1, true)).toBe(false);
  });
});

describe('recording and export frame holds', () => {
  const twelve: EffectiveFrameRate = { fps: 12, draw: true, posterize: true };
  it('a 60 fps export of a 12 fps graph renders every 5th frame and holds the rest', () => {
    const h = newOfflineHold();
    const rendered: number[] = [];
    for (let i = 0; i < 60; i++) {
      const f = offlineFrame(h, i / 60, twelve, { dt: 1 / 60, first: i === 0 });
      if (f.render) { rendered.push(i); expect(f.time).toBeCloseTo(rendered.length === 1 ? 0 : (rendered.length - 1) / 12, 9); }
      else expect(f.time).toBeCloseTo(Math.floor(i / 5) / 12, 9);
    }
    expect(rendered).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });
  it('a 30 fps recording of 12 fps holds frames 3, 2, 3, 2…; feedback steps 1/12 a time', () => {
    const h = newOfflineHold();
    const steps: (number | undefined)[] = [];
    const rendered: number[] = [];
    for (let i = 0; i < 30; i++) {
      const f = offlineFrame(h, i / 30, twelve, { dt: 1 / 30, first: i === 0 });
      if (f.render) { rendered.push(i); steps.push(f.dt); }
    }
    expect(rendered).toEqual([0, 3, 5, 8, 10, 13, 15, 18, 20, 23, 25, 28]);
    expect(steps[0]).toBeCloseTo(1 / 30, 9);
    for (const dt of steps.slice(1)) expect(dt).toBeCloseTo(1 / 12, 9);
    expect(distinctFrames(300, 30, twelve)).toBe(120);
  });
  it('step time only: every frame renders, at its stepped time, with the export’s own step', () => {
    const h = newOfflineHold();
    const fr: EffectiveFrameRate = { fps: 12, draw: false, posterize: true };
    const f = [0, 1, 2, 3, 4, 5].map(i => offlineFrame(h, i / 60, fr, { dt: 1 / 60, first: i === 0 }));
    expect(f.every(x => x.render)).toBe(true);
    expect(f.map(x => x.time)).toEqual([0, 0, 0, 0, 0, 1 / 12]);
    expect(f[3].dt).toBeCloseTo(1 / 60, 9);
  });
  it('Auto changes nothing; a still renders at its stepped time and stands alone', () => {
    const h = newOfflineHold();
    expect(offlineFrame(h, 0.37, { fps: null, draw: false, posterize: false }, { dt: 1 / 60 })).toEqual({ render: true, time: 0.37, dt: 1 / 60 });
    const still = offlineFrame(h, 0.37, twelve);
    expect(still.render).toBe(true);
    expect(still.time).toBeCloseTo(4 / 12, 9);
    expect(offlineFrame(h, 0.37, twelve).render).toBe(true);
  });
  it('a new render starts over (first)', () => {
    const h = newOfflineHold();
    offlineFrame(h, 0, twelve, { dt: 1 / 60, first: true });
    expect(offlineFrame(h, 0, twelve, { dt: 1 / 60, first: true }).render).toBe(true);
  });
});

describe('saved with the graph', () => {
  it('the play record keeps it', () => {
    expect(parsePlayRecordAsSaved({ controls: [], mappings: [], layers: [], frameRate: { fps: 12 } }).frameRate).toEqual({ fps: 12 });
    expect(parsePlayRecordAsSaved({ controls: [], mappings: [], layers: [], frameRate: { fps: 'x' } }).frameRate).toBeUndefined();
  });
  it('a graph file round-trips it, even with nothing else on Play', () => {
    const st = useNodeGraphStore.getState();
    st.setPlay(p => ({ ...p, frameRate: { fps: 8, mode: 'draw' } }));
    const json = useNodeGraphStore.getState().graphFileJson(false);
    expect(JSON.parse(json).play.frameRate).toEqual({ fps: 8, mode: 'draw' });
    useNodeGraphStore.getState().setPlay(p => { const { frameRate: _drop, ...rest } = p; return rest; });
    expect(useNodeGraphStore.getState().play.frameRate).toBeUndefined();
    expect(useNodeGraphStore.getState().importGraph(json).ok).toBe(true);
    expect(useNodeGraphStore.getState().play.frameRate).toEqual({ fps: 8, mode: 'draw' });
  });
  it('the default for other graphs is remembered', () => {
    useFrameRate.getState().setFallback({ fps: 12 });
    expect(JSON.parse(localStorage.getItem('shader-studio:frame-rate-default')!)).toEqual({ fps: 12 });
    useFrameRate.getState().setFallback(null);
    expect(localStorage.getItem('shader-studio:frame-rate-default')).toBeNull();
  });
});
