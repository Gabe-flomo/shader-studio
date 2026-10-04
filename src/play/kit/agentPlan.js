// agentPlan.js — the Agents engine's schedule (docs/agents-plan.md §3.4, §7, §8).
//
// Pure: no GPU. The app (src/lib/agentRunner.ts) uses it; the web runtime will
// share it when pages run agents (P5), as passPlan.js is shared for passes.
// Every top-level name keeps the `ag`/`AG_` prefix (the layer kit's rule).
//
// Determinism: a simulation is defined by its step number. One step is 1/60 s
// of simulated time; at clock time t a group has run floor(t · 60 · steps per
// frame) steps (plus its pre-roll). Randomness in the update shader is a hash
// of (agent, step, seed), so step n is the same state however the frames fell.

/** Steps a second at one step per frame: one step is 1/60 s of simulated time. */
export const AG_STEP_HZ = 60;
/** Most steps a live frame runs (a group falls behind past this, never drops steps). */
export const AG_MAX_STEPS = 8;
/** Most steps an offline frame or a pre-roll runs at once before it yields a "simulating…" frame. */
export const AG_OFFLINE_CHUNK = 600;

/** Steps per frame as a whole number 1…8. */
export function agStepsPerFrame(v) {
  const n = Math.round(typeof v === 'number' && isFinite(v) ? v : 2);
  return Math.max(1, Math.min(AG_MAX_STEPS, n));
}

/** Pre-roll seconds as steps. */
export function agPrerollSteps(seconds) {
  const s = typeof seconds === 'number' && isFinite(seconds) ? Math.max(0, seconds) : 0;
  return Math.round(s * AG_STEP_HZ);
}

/** The step a group should have reached at clock time t (seconds from its start). */
export function agTargetStep(t, spf, preroll) {
  const time = typeof t === 'number' && isFinite(t) ? Math.max(0, t) : 0;
  // A hair under a whole step counts as that step, so t = n / 60 lands on n whatever the rounding.
  return Math.floor(time * AG_STEP_HZ * agStepsPerFrame(spf) + 1e-6) + agPrerollSteps(preroll);
}

/** The clock time (seconds) at which step n happens: the update shader's u_time. */
export function agStepTime(step, spf, preroll) {
  return Math.max(0, step - agPrerollSteps(preroll)) / (AG_STEP_HZ * agStepsPerFrame(spf));
}

/**
 * The birth window of one step: { start, count } in agent indices (a ring of n).
 * Fill: everyone is born on step 0, nobody after. Rate: `rate` births a second,
 * at 1/60 s a step; `born` is how many were born before this step (the caller
 * keeps it; it starts at 0 with the simulation).
 */
export function agWindow(mode, step, n, rate, born) {
  if (mode !== 'rate') return step === 0 ? { start: 0, count: n, born: n } : { start: 0, count: 0, born };
  const r = typeof rate === 'number' && isFinite(rate) ? Math.max(0, rate) : 0;
  const before = Math.floor(born);
  const after = born + r / AG_STEP_HZ;
  const count = Math.min(n, Math.floor(after) - before);
  return { start: ((before % n) + n) % n, count, born: after };
}

/** The share of trail kept after one step for a half-life in seconds: 2^(−dt / halfLife). */
export function agKeep(halfLife) {
  const h = typeof halfLife === 'number' && isFinite(halfLife) ? Math.max(1e-4, halfLife) : 0.1;
  return Math.pow(2, -1 / (AG_STEP_HZ * h));
}

/** A Trail's texture size for a picture of w × h: a share of it, or a fixed height with the picture's aspect. */
export function agTrailSize(w, h, trail) {
  const W = Math.max(1, w), H = Math.max(1, h);
  if (trail && trail.rows) {
    const rows = Math.max(1, Math.round(trail.rows));
    return [Math.max(1, Math.round(rows * W / H)), rows];
  }
  const s = trail && trail.scale > 0 ? trail.scale : 0.5;
  return [Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s))];
}

/**
 * Live stepping for one group. `st` is { anchorTime, anchorStep, step, lastTime }
 * (agLiveState); `time` the clock now. Returns how many steps to run this frame,
 * at most `cap`. A clock that went backwards (a loop, a seek, ↺) starts over:
 * `restart` is true and the caller clears the state first. A group that has
 * fallen more than a second behind re-anchors (it carries on from where it is,
 * slower than the clock) rather than trying to catch up for ever.
 */
export function agLiveState() {
  return { anchorTime: NaN, anchorStep: 0, step: 0, lastTime: NaN };
}

export function agLiveSteps(st, time, spf, preroll, cap) {
  let restart = false;
  if (!isFinite(st.anchorTime) || time < st.lastTime - 1e-6) {
    // The first frame, or the clock went back: start over at this time (with the pre-roll).
    restart = true;
    st.anchorTime = time; st.anchorStep = 0; st.step = 0;
  }
  st.lastTime = time;
  const target = st.anchorStep + agTargetStep(time - st.anchorTime, spf, preroll);
  let behind = Math.max(0, target - st.step);
  const perSecond = AG_STEP_HZ * agStepsPerFrame(spf);
  if (behind > perSecond + agPrerollSteps(preroll) && st.step > 0) {
    // More than a second behind: re-anchor here, so the simulation runs on (slower) instead of chasing the clock.
    // This frame still runs as many steps as it may.
    st.anchorTime = time;
    st.anchorStep = st.step - agPrerollSteps(preroll);
    behind = cap;
  }
  const limit = st.step === 0 && agPrerollSteps(preroll) > 0 ? Math.max(cap, Math.min(AG_OFFLINE_CHUNK, behind)) : cap;
  return { steps: Math.min(behind, Math.max(1, limit)), restart, target };
}

/**
 * Under GPU load, run fewer steps (never fewer agents). `gov` is
 * { cap, slow, fast, base }: `base` is the display's own frame interval (the
 * shortest frames seen lately, relaxing very slowly), so a 30 Hz display is
 * not mistaken for load. Frames well over it for a few frames lower the cap by
 * one; frames close to it for a while raise it again, up to AG_MAX_STEPS.
 */
export function agGovernorState() {
  return { cap: AG_MAX_STEPS, slow: 0, fast: 0, base: 0 };
}

export function agGovern(gov, frameMs, budgetMs) {
  if (!(frameMs > 0) || frameMs > 250) return gov.cap; // a stall or a hidden tab says nothing about load
  gov.base = gov.base > 0 ? Math.min(gov.base * 1.0001, frameMs) : frameMs;
  const budget = Math.max(budgetMs > 0 ? budgetMs : 1000 / 60, gov.base);
  if (frameMs > budget * 1.35) { gov.slow++; gov.fast = 0; } else if (frameMs < budget * 1.1) { gov.fast++; gov.slow = 0; } else { gov.slow = 0; gov.fast = 0; }
  if (gov.slow >= 4 && gov.cap > 1) { gov.cap--; gov.slow = 0; }
  if (gov.fast >= 30 && gov.cap < AG_MAX_STEPS) { gov.cap++; gov.fast = 0; }
  return gov.cap;
}

/**
 * How fast the simulation runs against the clock over the last frames:
 * steps run ÷ steps wanted (1 = keeping up; 0.5 = half speed, "running at ×0.5").
 */
export function agRate(history, ran, wanted) {
  history.push([ran, wanted]);
  if (history.length > 60) history.shift();
  let r = 0, w = 0;
  for (const [a, b] of history) { r += a; w += b; }
  return w > 0 ? Math.min(1, r / w) : 1;
}
