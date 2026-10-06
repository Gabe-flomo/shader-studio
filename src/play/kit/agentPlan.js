// agentPlan.js — the Agents engine's schedule (docs/agents-plan.md §3.4, §7, §8).
//
// Pure: no GPU. The app (src/lib/agentRunner.ts, three.js) and web pages
// (kit/agentHost.js, the page's own WebGL2) both run it, as passPlan.js is
// shared for passes: the schedule, each frame's steps per group, the birth
// windows, what the listening nodes hear and how Draw agents looks are worked
// out here once, so the two hosts can't drift. They only differ in how they
// put the result on the GPU. Every top-level name keeps the `ag`/`AG_` prefix
// (the layer kit's rule).
import { GP_PALETTES, gpLevelsPush, gpLevelsState, gpPlace, gpPlateListen, gpPlateSmooth, gpPlateState, gpPlateTargets, gpPlateUniforms, gpRising, gpSoundState, gpSoundStep, gpUnitBrightness, gpUnitInk } from './gpuParticles.js';
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

/**
 * The stand-in Beat of a listening node (Sound kick, Chladni): a silent kick
 * every beat at `bpm`, as a level that jumps to 1 on the beat and decays.
 * A pure function of the step's time, so a simulation driven by it is the
 * same live and offline. 0 (or less) is off.
 */
export function agBeatLevel(t, bpm) {
  const b = typeof bpm === 'number' && isFinite(bpm) ? bpm : 0;
  if (!(b > 0) || !(t >= 0)) return 0;
  const beats = t * b / 60 + 1e-9;
  return Math.exp(-(beats - Math.floor(beats)) * 9);
}

/*
 * Per-frame logic shared by both hosts (P5). `read(p, fallback)` reads a node setting: a number
 * as it is, or the uniform a slider writes (by name), else the fallback; `readColour(p, fallback)`
 * the same for a colour ([r, g, b]).
 */

/** A group's simulation state that isn't on the GPU; a host adds its textures to it. */
export function agGroupState() {
  return { step: 0, born: 0, live: agLiveState(), history: [], lastTarget: 0, listen: new Map(), burstEdge: {}, burstPending: false };
}

/** Back to step 0 with nobody born (the host clears the state textures and the listeners' state). */
export function agRestartGroup(s) {
  s.step = 0; s.born = 0; s.history.length = 0; s.lastTarget = 0; s.burstPending = false;
}

/**
 * How many steps group `g` runs this frame. o: { live, time, cap, restart (↺ on its card) }.
 * Live: as many as the clock asks for, at most `cap`; the group's Start over trigger (or `restart`)
 * starts it over, as a clock that went back does. Offline: exactly the steps up to `time` (a
 * time before the group's step starts it over). `restartState()` is called at the moment the
 * simulation starts over, to clear it. Emit's Burst is noted for the next step (agStepWindow).
 */
export function agGroupSteps(s, g, read, o, restartState) {
  // Emit's Burst (a trigger): each time it rises past 0.5, everyone is born again on the next step.
  if (gpRising(s.burstEdge, 'burst', read(g.emit.burst, 0))) s.burstPending = true;
  const spf = agStepsPerFrame(read(g.params.stepsPerFrame, 2));
  const preroll = read(g.params.preroll, 0);
  if (o.live) {
    // ↺ on the card, or the group's Start over trigger rising past 0.5 (a Play key, beat or rule): live only.
    const trigger = gpRising(s.burstEdge, 'restart', read(g.params.restart, 0));
    if (o.restart || trigger) s.live = agLiveState();
    s.live.step = s.step;
    const r = agLiveSteps(s.live, o.time, spf, preroll, o.cap);
    if (r.restart) restartState();
    const wanted = Math.max(0, r.target - s.lastTarget);
    s.lastTarget = r.target;
    return { steps: r.steps, spf, preroll, restarted: r.restart, rate: agRate(s.history, r.restart ? wanted : r.steps, wanted || r.steps) };
  }
  const target = agTargetStep(o.time, spf, preroll);
  let restarted = false;
  if (target < s.step) { restartState(); restarted = true; }
  return { steps: Math.max(0, target - s.step), spf, preroll, restarted, rate: 1 };
}

/** This step's birth window for group `g` of `n` agents ({ start, count }); a pending Burst is everyone. */
export function agStepWindow(s, g, n, read) {
  let win = agWindow(g.emit.mode, s.step, n, read(g.emit.rate, 0), s.born);
  s.born = win.born;
  // Burst: everyone born again at once, on the first step after it fired.
  if (s.burstPending) { win = { start: 0, count: n, born: win.born }; s.burstPending = false; }
  return win;
}

/** What one listening node (Sound kick, Chladni) has heard so far: part of its group's simulation. */
export function agListenState() {
  return { sound: gpSoundState(), levels: gpLevelsState(), shocks: [], plate: gpPlateState() };
}

/**
 * One step of listening for node `l` (agents spec listener), before its group's rule runs at
 * `time` (the step's own clock): the Particles engine's code as it is. Sound from Mic or the
 * Audio engine gives a spectrum (`sound(source)`); otherwise the level is Level plus the stand-in
 * Beat (Level is added to a spectrum too). `first`: the group's step 0 (the plate snaps).
 * Returns the uniform values: sound (level, bass, treble, onset); a kick its four shock rings
 * (x, y, start, strength) and `levels` (the level history moved on); a plate its modes, count, shake.
 */
export function agHear(st, l, read, sound, time, first) {
  const dt = 1 / AG_STEP_HZ;
  const heard = l.soundFrom !== 'graph' && sound ? sound(l.soundFrom) || null : null;
  const level = Math.max(0, read(l.params.level, 0)) + agBeatLevel(time, read(l.params.beat, 0));
  gpSoundStep(st.sound, heard || { level: Math.min(2, level) }, dt);
  if (heard) st.sound.level = Math.min(2, st.sound.level + level);
  else st.sound.bass = st.sound.mid = st.sound.treble = st.sound.level;
  const out = { sound: [st.sound.level, st.sound.bass, st.sound.treble, st.sound.onset] };
  if (l.kind === 'kick') {
    // A hit sends a ring out from where the centre is now (the last four stay in flight).
    if (st.sound.hit) {
      st.shocks.unshift({ x: read(l.params.x, 0), y: read(l.params.y, 0), t0: time, s: 0.4 + st.sound.onset });
      st.shocks.length = Math.min(st.shocks.length, 4);
    }
    const shocks = [];
    for (let i = 0; i < 4; i++) { const k = st.shocks[i]; if (k) shocks.push(k.x, k.y, k.t0, k.s); else shocks.push(0, 0, 0, 0); }
    gpLevelsPush(st.levels, st.sound.level, dt);
    out.shocks = shocks;
    out.levels = st.levels.levels;
    return out;
  }
  // A plate: its figure from N and M, or stepped on by the sound, gliding between figures.
  const shape = l.shape || 'square';
  const P = {
    modeFrom: l.modeFrom || 'manual', modeN: read(l.params.modeN, 3), modeM: read(l.params.modeM, 5),
    modes: read(l.params.modes, 1), plateFreq: read(l.params.plateFreq, 1), plateWeights: read(l.params.plateWeights, 0.5),
  };
  let want = null;
  if (P.modeFrom === 'sound') {
    const bands = gpPlateListen(st.plate, { spectrum: heard && heard.freq ? heard : null, level: st.sound.level, hit: st.sound.hit, dt });
    want = gpPlateTargets(P, shape, bands);
    if (!want && !st.plate.modes.length) want = gpPlateTargets(P, shape, null);
  } else want = gpPlateTargets(P, shape, null);
  gpPlateSmooth(st.plate, want, dt, first);
  const pu = gpPlateUniforms(st.plate.modes, shape);
  out.modes = pu.values;
  out.count = pu.count;
  // Shake: the slider, harder with the level and on every hit (the Particles node's rule).
  out.shake = read(l.params.shake, 0.6) * (0.6 + 0.8 * Math.min(st.sound.level, 1.5) + 1.2 * st.sound.onset);
  return out;
}

/** Colour by: Draw agents' choice as the draw shader's index. */
export const AG_COLOR_BY = ['single', 'species', 'speed', 'heading', 'age', 'agent', 'speedFast', 'headingRound'];

/**
 * How Draw agents `d` draws `n` walkers into a picture `h` pixels high: the draw shader's
 * settings (size, brightness, points or lines, ink, fade, colours) and the glow's. Brightness of
 * The crowd is the Particles node's rule: sizes in pixels of a 720-pixel-high picture, smaller for
 * big pools (fill rate), and each walker's light (ink) its share, so the cloud looks the same at
 * every count.
 */
export function agDrawLook(d, n, h, read, readColour) {
  const ink = d.style === 'ink';
  const streak = Math.max(0, read(d.params.streak, 0.25));
  const lines = d.style === 'streaks' || (ink && streak > 0);
  let size = Math.max(0.1, read(d.params.size, 1.5));
  let bright = read(d.params.brightness, 0.5);
  if (d.scaleBy === 'crowd') {
    size = Math.min(size, n > 1100000 ? 3 : n > 300000 ? 8 : 32);
    bright *= ink ? gpUnitInk(n, size) : gpUnitBrightness(n, size);
    size *= Math.max(0.5, h / 720);
  }
  const pal = d.palette === 'ab' ? undefined : GP_PALETTES[d.palette];
  return {
    ink, lines, size, bright, colorBy: AG_COLOR_BY.indexOf(d.colorBy), speedRef: read(d.params.speedRef, 0.5),
    thread: lines ? streak * 0.12 : 0, fade: !!d.fade,
    usePal: d.palette !== 'ab', rainbow: d.palette !== 'ab' && !pal, pal: pal || null,
    colA: readColour(d.params.colorA, [1, 0.75, 0.35]), colB: readColour(d.params.colorB, [0.25, 0.55, 1]),
    glow: read(d.params.glow, 1), halo: read(d.params.halo, 0.5),
  };
}

/**
 * Draw agents' lights at `time` (the Particles node's, gpPlace), round its centre: [{ x, y, z, reach,
 * power, colour }]. In 3D (d.space3d) orbiting lights also bob in depth, as the Particles node's do.
 */
export function agLights(d, read, readColour, time, aspect) {
  if (!d.lights) return [];
  const orbit = read(d.params.lightOrbit, 0.5);
  const P = {
    follow: 'none', lights: String(d.lights), emitSize: (orbit - 0.2) / 0.7, lightMotion: d.lightMotion, space: d.space3d ? '3d' : '2d', hands: 'off',
    lightReach: read(d.params.lightReach, 0.3), lightPower: read(d.params.lightPower, 1.6),
    lightColor: readColour(d.params.lightColor, [1, 0.55, 0.25]),
  };
  const cx = read(d.params.lightX, 0), cy = read(d.params.lightY, 0);
  return gpPlace(P, time, null, aspect).lights.map(l => ({ x: l.x + cx, y: l.y + cy, z: l.z || 0, reach: l.reach, power: l.power, colour: l.colour }));
}

/*
 * 3D (docs/agents-plan.md "3D"): a volume Trail's layout and Draw agents' camera, shared by both hosts.
 */

/** Widest a volume's texture is: its slices wrap onto more rows past this. */
export const AG_VOL_MAX_W = 4096;

/**
 * A volume Trail of `rows` for a picture of w × h: columns follow the picture's shape (cubic cells
 * over the box x ±aspect, y ±1, z ±1), as many slices as rows, the slices side by side (tx across,
 * ty down) in one texture of w × h texels.
 */
export function agVolLayout(rows, w, h) {
  const ny = Math.max(4, Math.round(rows) || 96), nz = ny;
  const nx = Math.max(4, Math.round(ny * Math.max(1, w) / Math.max(1, h)));
  const tx = Math.max(1, Math.min(nz, Math.floor(AG_VOL_MAX_W / nx)));
  const ty = Math.ceil(nz / tx);
  return { nx, ny, nz, tx, ty, w: tx * nx, h: ty * ny };
}

/** The volume's layout uniform: (columns, rows, slices, slices across). */
export function agVolUniform(L) { return [L.nx, L.ny, L.nz, L.tx]; }

const ag3Norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const ag3Cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const ag3Dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Draw agents' built-in camera at `time` (d.params; Angle, Elevation and Orbit speed in degrees):
 * Time Cube View's and the March Camera's orbit (it stands Distance from the point Translate X / Y / Z
 * moves, at Angle round it and Elevation above, its right the March Camera's cross(up, forward)), with the
 * Particles node's Drift on top (a slow turn, a bob and breathing, its gpCamera's numbers). With d.mirror
 * the right is the Particles node's own way round (Open as nodes). Zoom is the focal length in half
 * picture heights; Focus a share of Distance; Blur and Max blur in pixels of a 720-high picture.
 */
export function agCamera3(d, read, time, h) {
  const P = d.params;
  const deg = Math.PI / 180;
  const drift = read(P.drift, 0);
  const yaw = read(P.camAngle, 0) * deg + time * (read(P.rotSpeed, 0) * deg + drift * 0.35);
  const pitch = Math.max(-1.55, Math.min(1.55, read(P.camElevation, 15) * deg + 0.12 * Math.sin(time * drift * 0.23)));
  const dist = Math.max(0.05, read(P.camDist, 3.2)) * (1 + 0.06 * Math.sin(time * drift * 0.17));
  const T = [read(P.camX, 0), read(P.camY, 0), read(P.camZ, 0)];
  const hz = [Math.sin(yaw), 0, Math.cos(yaw)];
  const off = [dist * Math.cos(pitch) * hz[0], dist * Math.sin(pitch), dist * Math.cos(pitch) * hz[2]];
  const eye = [T[0] + off[0], T[1] + off[1], T[2] + off[2]];
  const fwd = [-off[0] / dist, -off[1] / dist, -off[2] / dist];
  const cu = ag3Norm([-Math.sin(pitch) * hz[0], Math.cos(pitch), -Math.sin(pitch) * hz[2]]);
  let right = ag3Norm(ag3Cross(cu, fwd));
  const up = ag3Cross(fwd, right);
  if (d.mirror) right = [-right[0], -right[1], -right[2]];
  const px = Math.max(0.5, h / 720);
  return {
    eye, fwd, right, up, dist,
    lens: Math.max(0.05, read(P.fov, 1.8)),
    ortho: Math.max(0, Math.min(1, read(P.ortho, 0))),
    focus: Math.max(0.05, read(P.focus, 1) * dist),
    focusShare: Math.max(0.05, read(P.focus, 1)),
    coc: Math.max(0, read(P.blur, 0)) * 52 * px,
    cap: Math.max(1, read(P.maxBlur, 7)) * px,
  };
}

/** Where a point lands through agCamera3's camera: picture units (x ±aspect, y ±1) and its depth (≤ 0: behind it). */
export function agProject3(cam, xyz) {
  const d = [xyz[0] - cam.eye[0], xyz[1] - cam.eye[1], xyz[2] - cam.eye[2]];
  const z = ag3Dot(d, cam.fwd);
  if (z < 0.06 && cam.ortho < 0.999) return { x: 0, y: 0, depth: -1 };
  const w = z + (cam.dist - z) * cam.ortho;
  return { x: ag3Dot(d, cam.right) * cam.lens / w, y: ag3Dot(d, cam.up) * cam.lens / w, depth: w };
}

/** The four points a scene camera probe reads its chain at (g_uv), and what each pixel holds (0 origin, 1 ray). */
export const AG_PROBE_POINTS = [[0, 0, 0], [0, 0, 1], [0.5, 0, 1], [0, 0.5, 1]];

/*
 * Readings (P6): what a group's walkers add up to, for Play (sensors on `ag:<group node id>`).
 * The hosts sum the state on the GPU (agentShaders.js AG_READ_FRAG, then AG_SUM_FRAG passes) into
 * a 2 × 1 target and read it back asynchronously; these two pure functions are the schedule and
 * the meaning, shared so the app and web pages can't drift.
 */

/** The readings a group gives, in the order Play lists them (the CPU Agents layer's names). */
export const AG_GROUP_READS = ['alive', 'speed', 'spread', 'centroidX', 'centroidY', 'group1', 'group2', 'group3', 'group4'];

/** The reduction's targets for a state of side × side: each pass's [width of one half, height]; the last is [1, 1]. */
export function agReadPlan(side) {
  const block = 8;
  const out = [];
  let w = Math.max(1, Math.ceil(side / block)), h = w;
  out.push([w, h]);
  while (w > 1 || h > 1) {
    w = Math.max(1, Math.ceil(w / block)); h = Math.max(1, Math.ceil(h / block));
    out.push([w, h]);
  }
  return out;
}

/**
 * The readings (all 0…1) from the two summed texels `px` (8 floats: live, Σx, Σy, Σ(x² + y²), then
 * Σ speed and the live of species 1–3) for `count` walkers in a picture of `aspect`:
 *   alive       the share of the walkers alive
 *   speed       their mean speed, 1 at a picture height (2 units) a second or more
 *   spread      how spread out they are: 0 all in one place, about 1 spread evenly over the picture
 *   centroidX/Y where their centre is, 0 left / bottom to 1 right / top
 *   group1…4    the share of the live walkers of each species
 * With nobody alive the centre stays in the middle and the rest read 0.
 */
export function agReadDecode(px, count, aspect) {
  const n = Math.max(0, px[0]);
  const out = { alive: count > 0 ? Math.min(1, n / count) : 0, speed: 0, spread: 0, centroidX: 0.5, centroidY: 0.5, group1: 0, group2: 0, group3: 0, group4: 0 };
  if (!(n > 0)) return out;
  const a = aspect > 0 ? aspect : 1;
  const mx = px[1] / n, my = px[2] / n;
  out.speed = Math.min(1, Math.max(0, px[4] / n / 2));
  out.spread = Math.min(1, Math.sqrt(Math.max(0, px[3] / n - mx * mx - my * my)) / (Math.hypot(a, 1) / Math.sqrt(3)));
  out.centroidX = Math.min(1, Math.max(0, mx / a * 0.5 + 0.5));
  out.centroidY = Math.min(1, Math.max(0, my * 0.5 + 0.5));
  const g1 = px[5] / n, g2 = px[6] / n, g3 = px[7] / n;
  out.group1 = Math.min(1, Math.max(0, g1)); out.group2 = Math.min(1, Math.max(0, g2)); out.group3 = Math.min(1, Math.max(0, g3));
  out.group4 = Math.min(1, Math.max(0, 1 - g1 - g2 - g3));
  return out;
}
