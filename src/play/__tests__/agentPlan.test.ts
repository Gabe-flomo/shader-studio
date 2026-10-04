/**
 * The Agents engine's schedule (play/kit/agentPlan.js, docs/agents-plan.md §8):
 * fixed-step counting, the birth windows, live stepping that falls behind
 * under load and catches up to the same step as an offline render, and the
 * GPU governor (fewer steps, never fewer agents).
 */
import { describe, expect, it } from 'vitest';
import {
  AG_MAX_STEPS, agGovern, agGovernorState, agKeep, agLiveState, agLiveSteps, agStepTime, agTargetStep, agTrailSize, agWindow,
} from '../kit/agentPlan.js';

describe('fixed steps', () => {
  it('a step is 1/60 s; Steps per frame multiplies; pre-roll adds steps', () => {
    expect(agTargetStep(1, 1, 0)).toBe(60);
    expect(agTargetStep(1, 2, 0)).toBe(120);
    expect(agTargetStep(0.5, 2, 1)).toBe(60 + 60);
    // t = n / 120 lands on n whatever the float rounding.
    for (let n = 0; n < 500; n++) expect(agTargetStep(n / 120, 2, 0)).toBe(n);
    expect(agStepTime(120, 2, 0)).toBeCloseTo(1);
  });

  it('offline reaches the same step at 30, 60 and 120 frames a second', () => {
    for (const fps of [30, 60, 120]) {
      let step = 0;
      for (let f = 1; f <= fps; f++) step += agTargetStep(f / fps, 2, 0) - step;
      expect(step).toBe(120);
    }
  });
});

describe('birth windows', () => {
  it('Fill: everyone on step 0, nobody after', () => {
    expect(agWindow('fill', 0, 1000, 0, 0)).toMatchObject({ start: 0, count: 1000 });
    expect(agWindow('fill', 1, 1000, 0, 1000)).toMatchObject({ count: 0 });
  });
  it('Rate: a ring of births, Rate a second (fractions carried)', () => {
    let born = 0; let total = 0; const starts: number[] = [];
    for (let s = 0; s < 120; s++) { const w = agWindow('rate', s, 1000, 90, born); born = w.born; total += w.count; starts.push(w.start); }
    expect(total).toBe(180); // 90 a second for 2 s
    expect(starts[0]).toBe(0);
    let b = 0;
    for (let s = 0; s < 1000; s++) b = agWindow('rate', s, 64, 600, b).born;
    expect(agWindow('rate', 0, 64, 600, b).start).toBe(Math.floor(b) % 64); // wraps round the ring
  });
});

describe('live stepping', () => {
  it('starts at step 0 on its first frame, then follows the clock', () => {
    const st = agLiveState();
    expect(agLiveSteps(st, 10, 2, 0, AG_MAX_STEPS)).toMatchObject({ steps: 0, restart: true });
    st.step = 0;
    const r = agLiveSteps(st, 10 + 1 / 60, 2, 0, AG_MAX_STEPS);
    expect(r.steps).toBe(2);
  });

  it('a stalled frame catches up (at most the cap a frame) to the same step as offline', () => {
    const st = agLiveState();
    agLiveSteps(st, 0, 2, 0, 8);
    let t = 0;
    for (let f = 0; f < 30; f++) { t += 1 / 60; st.step += agLiveSteps(st, t, 2, 0, 8).steps; }
    t += 0.1; // a 100 ms stall
    const r = agLiveSteps(st, t, 2, 0, 8);
    expect(r.steps).toBe(8);
    st.step += r.steps;
    for (let f = 0; f < 10; f++) { t += 1 / 60; st.step += agLiveSteps(st, t, 2, 0, 8).steps; }
    expect(st.step).toBe(agTargetStep(t, 2, 0));
  });

  it('under load it runs fewer steps and falls behind rather than skipping; past a second behind it re-anchors', () => {
    const st = agLiveState();
    agLiveSteps(st, 0, 4, 0, 1);
    let t = 0;
    for (let f = 0; f < 30; f++) { t += 1 / 60; st.step += agLiveSteps(st, t, 4, 0, 1).steps; }
    expect(st.step).toBe(30); // one step a frame, not four
    for (let f = 0; f < 120; f++) { t += 1 / 60; st.step += agLiveSteps(st, t, 4, 0, 1).steps; }
    expect(st.step).toBe(150);
    expect(st.anchorStep).toBeGreaterThan(0); // re-anchored: the simulation carries on from where it is
  });

  it('a clock that goes back starts over', () => {
    const st = agLiveState();
    agLiveSteps(st, 5, 2, 0, 8);
    st.step = 100;
    expect(agLiveSteps(st, 1, 2, 0, 8).restart).toBe(true);
    expect(st.step).toBe(0);
  });
});

describe('governor', () => {
  it('lowers the step cap when frames run long and raises it back when they are short', () => {
    const g = agGovernorState();
    expect(g.cap).toBe(AG_MAX_STEPS);
    for (let i = 0; i < 10; i++) agGovern(g, 16.7, 1000 / 60); // the display's own rate
    for (let i = 0; i < 4; i++) agGovern(g, 30, 1000 / 60);
    expect(g.cap).toBe(AG_MAX_STEPS - 1);
    for (let i = 0; i < 60; i++) agGovern(g, 30, 1000 / 60);
    expect(g.cap).toBeLessThan(AG_MAX_STEPS - 5);
    for (let i = 0; i < 400; i++) agGovern(g, 8, 1000 / 60);
    expect(g.cap).toBe(AG_MAX_STEPS);
    agGovern(g, 5000, 1000 / 60); // a hidden tab says nothing
    expect(g.cap).toBe(AG_MAX_STEPS);
  });

  it('a 30 Hz display is not load', () => {
    const g = agGovernorState();
    for (let i = 0; i < 300; i++) agGovern(g, 33.3, 1000 / 60);
    expect(g.cap).toBe(AG_MAX_STEPS);
  });
});

describe('trail', () => {
  it('half-life → share kept per step; size by share or fixed rows', () => {
    expect(Math.pow(agKeep(0.5), 30)).toBeCloseTo(0.5);
    expect(agTrailSize(1920, 1080, { scale: 0.5, rows: null })).toEqual([960, 540]);
    expect(agTrailSize(1920, 1080, { scale: null, rows: 1024 })).toEqual([1820, 1024]);
  });
});
