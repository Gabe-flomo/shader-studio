/**
 * Stepping the agents (agentBuilder/stepRun.ts): forward, back and the snapshot ring, over a small
 * CPU stand-in built like the GPU simulation: the state is arrays (positions, headings, a trail),
 * and a step is a pure function of the state, the step number and the seed (no hidden random state).
 */
import { describe, expect, it } from 'vitest';
import { BACK_BUDGET, BACK_MAX, SnapshotRing, Stepper, backReach, nextBatch, type Steppable } from '../stepRun';
import type { SnapGroupState } from '../../lib/agentSnapshots';

interface State { step: number; x: Float32Array; y: Float32Array; a: Float32Array; trail: Float32Array }

/** A hash of (agent, step, seed) in 0–1, as the GPU rule's random is. */
function hash(i: number, step: number, seed: number): number {
  let h = (i * 374761393 + step * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class StandIn implements Steppable<State> {
  s: State;
  readonly n: number; readonly side: number; readonly seed: number;
  constructor(n = 64, side = 32, seed = 7) {
    this.n = n; this.side = side; this.seed = seed;
    const s: State = { step: 0, x: new Float32Array(n), y: new Float32Array(n), a: new Float32Array(n), trail: new Float32Array(side * side) };
    for (let i = 0; i < n; i++) { s.x[i] = hash(i, 0, seed) * side; s.y[i] = hash(i, 1, seed) * side; s.a[i] = hash(i, 2, seed) * Math.PI * 2; }
    this.s = s;
  }
  private at(x: number, y: number) { const W = this.side; return this.s.trail[((Math.floor(y) % W + W) % W) * W + ((Math.floor(x) % W + W) % W)]; }
  /** One step: sense ahead left/right, turn, wobble, move, deposit; the trail fades. */
  private one(): void {
    const { s, side } = this;
    for (let i = 0; i < this.n; i++) {
      const L = this.at(s.x[i] + Math.cos(s.a[i] + 0.5) * 3, s.y[i] + Math.sin(s.a[i] + 0.5) * 3);
      const R = this.at(s.x[i] + Math.cos(s.a[i] - 0.5) * 3, s.y[i] + Math.sin(s.a[i] - 0.5) * 3);
      s.a[i] += (L > R ? 0.3 : L < R ? -0.3 : 0) + (hash(i, s.step, this.seed) - 0.5) * 0.4;
      s.x[i] = ((s.x[i] + Math.cos(s.a[i])) % side + side) % side;
      s.y[i] = ((s.y[i] + Math.sin(s.a[i])) % side + side) % side;
      s.trail[Math.floor(s.y[i]) * side + Math.floor(s.x[i])] += 1;
    }
    for (let k = 0; k < s.trail.length; k++) s.trail[k] *= 0.95;
    s.step++;
  }
  step(n: number) { for (let k = 0; k < n; k++) this.one(); }
  snapshot(): State { const s = this.s; return { step: s.step, x: s.x.slice(), y: s.y.slice(), a: s.a.slice(), trail: s.trail.slice() }; }
  restore(k: State) { this.s = { step: k.step, x: k.x.slice(), y: k.y.slice(), a: k.a.slice(), trail: k.trail.slice() }; }
  stepNow() { return this.s.step; }
  bytes(k: State) { return (k.x.length + k.y.length + k.a.length + k.trail.length) * 4; }
}

const same = (a: State, b: State) => {
  expect(a.step).toBe(b.step);
  expect(Array.from(a.x)).toEqual(Array.from(b.x));
  expect(Array.from(a.y)).toEqual(Array.from(b.y));
  expect(Array.from(a.a)).toEqual(Array.from(b.a));
  expect(Array.from(a.trail)).toEqual(Array.from(b.trail));
};

describe('agent stepping', () => {
  it('stepping forward N times while paused equals running N steps', () => {
    const ran = new StandIn(); ran.step(25);
    const sim = new StandIn();
    const st = new Stepper(sim);
    for (let k = 0; k < 25; k++) st.forward();
    same(sim.s, ran.s);
    expect(sim.stepNow()).toBe(25);
    // A whole frame at once (Shift+→ at 3 steps a frame) is the same as three single steps.
    const framed = new StandIn(); const sf = new Stepper(framed);
    for (let k = 0; k < 5; k++) sf.forward(3);
    const singles = new StandIn(); singles.step(15);
    same(framed.s, singles.s);
  });

  it('back then forward returns the same state', () => {
    const sim = new StandIn();
    const st = new Stepper(sim);
    st.forward(10);
    for (let k = 0; k < 6; k++) st.forward();
    const at16 = sim.snapshot();
    st.back(); st.back(); st.back();
    expect(sim.stepNow()).toBe(13);
    const ref = new StandIn(); ref.step(13);
    same(sim.s, ref.s);
    st.forward(); st.forward(); st.forward();
    same(sim.s, at16);
  });

  it('pause holds the state: no ops, nothing moves', () => {
    const sim = new StandIn();
    const st = new Stepper(sim);
    st.forward(4);
    const held = sim.snapshot();
    st.apply([]);
    same(sim.s, held);
    // Back with nothing kept does nothing.
    const fresh = new StandIn(); const sf = new Stepper(fresh);
    const before = fresh.snapshot();
    expect(sf.back()).toBe(false);
    same(fresh.s, before);
  });

  it('queued ops are worked through in order (the backs at the head, else forward steps up to the next back)', () => {
    expect(nextBatch([{ back: true }, { back: true }, { forward: 1 }, { forward: 2 }, { back: true }]))
      .toEqual({ backs: 2, forward: 0, rest: [{ forward: 1 }, { forward: 2 }, { back: true }] });
    expect(nextBatch([{ forward: 1 }, { forward: 2 }, { back: true }, { forward: 1 }]))
      .toEqual({ backs: 0, forward: 3, rest: [{ back: true }, { forward: 1 }] });
    expect(nextBatch([])).toEqual({ backs: 0, forward: 0, rest: [] });
    const sim = new StandIn(); const st = new Stepper(sim);
    st.apply([{ forward: 1 }, { forward: 1 }, { forward: 1 }, { back: true }, { back: true }, { forward: 1 }]);
    // Three steps as one batch, two back (to step 1), then one step.
    expect(sim.stepNow()).toBe(2);
    const ref = new StandIn(); ref.step(2);
    same(sim.s, ref.s);
  });

  it('back is one step even into played frames (restore, then the steps between again)', () => {
    const sim = new StandIn();
    const st = new Stepper(sim);
    // Played: frames of 4 steps, a snapshot before each (steps 0, 4, 8, 12 kept).
    for (let f = 0; f < 4; f++) st.forward(4);
    expect(sim.stepNow()).toBe(16);
    expect(st.ring.size).toBe(4);
    for (let want = 15; want >= 0; want--) {
      expect(st.back()).toBe(true);
      expect(sim.stepNow()).toBe(want);
      const ref = new StandIn(); ref.step(want);
      same(sim.s, ref.s);
    }
    expect(st.canBack).toBe(false);
    expect(st.back()).toBe(false);
    // Several backs at once land where single ones would.
    const a = new StandIn(); const sa = new Stepper(a);
    for (let f = 0; f < 4; f++) sa.forward(4);
    sa.back(6);
    const ref = new StandIn(); ref.step(10);
    same(a.s, ref.s);
  });

  it('rewinding over everything kept lands on the oldest kept step', () => {
    const sim = new StandIn();
    const st = new Stepper(sim, new SnapshotRing<State>(() => {}, 5));
    for (let k = 0; k < 9; k++) st.forward();
    expect(st.ring.size).toBe(5);
    expect(st.ring.firstStep).toBe(4);
    while (st.canBack) st.back();
    expect(sim.stepNow()).toBe(4);
    const ref = new StandIn(); ref.step(4);
    same(sim.s, ref.s);
  });
});

describe('the snapshot ring', () => {
  it('keeps at most max entries and drops the oldest first', () => {
    const dropped: number[] = [];
    const r = new SnapshotRing<number>(s => dropped.push(s), 3, Infinity);
    for (let k = 0; k < 6; k++) r.push(k, 10, k);
    expect(r.size).toBe(3);
    expect(dropped).toEqual([0, 1, 2]);
    expect(r.firstStep).toBe(3);
    expect(r.lastStep).toBe(5);
  });

  it('keeps within the byte budget, but always the newest', () => {
    const dropped: number[] = [];
    const r = new SnapshotRing<number>(s => dropped.push(s), 60, 100);
    r.push(1, 40, 1); r.push(2, 40, 2); r.push(3, 40, 3);
    expect(r.size).toBe(2);
    expect(r.bytes).toBe(80);
    expect(dropped).toEqual([1]);
    r.push(4, 500, 4);
    expect(r.size).toBe(1);
    expect(r.lastStep).toBe(4);
  });

  it('pop hands the newest over; free and clear give them back', () => {
    const dropped: number[] = [];
    const r = new SnapshotRing<number>(s => dropped.push(s), 10, Infinity);
    r.push(1, 1, 1); r.push(2, 1, 2);
    const k = r.pop()!;
    expect(k.state).toBe(2);
    expect(dropped).toEqual([]);
    r.free(k.state);
    r.clear();
    expect(dropped).toEqual([2, 1]);
    expect(r.size).toBe(0);
    expect(r.pop()).toBeUndefined();
  });

  it('says how many snapshots of a size fit', () => {
    expect(backReach(0)).toBe(BACK_MAX);
    expect(backReach(1024)).toBe(BACK_MAX);
    expect(backReach(BACK_BUDGET / 10)).toBe(10);
    expect(backReach(BACK_BUDGET * 3)).toBe(1);
  });
});

describe('the live runner side (lib/agentSnapshots.ts)', () => {
  it('queues ops only while a transport is open', async () => {
    const m = await import('../../lib/agentSnapshots');
    m.stepAgents(1);
    expect(m.agentStepInfo().pending).toBe(0);
    const close = m.armAgentStepping();
    expect(m.agentSteppingArmed()).toBe(true);
    m.stepAgents(1); m.stepAgentsBack();
    expect(m.agentStepInfo().pending).toBe(2);
    close();
    expect(m.agentSteppingArmed()).toBe(false);
  });

  it('after steps by hand the live clock carries on from there (no catch-up, no wait)', async () => {
    const THREE = await import('three');
    const { AgentSnapshots } = await import('../../lib/agentSnapshots');
    const { agGroupState, agLiveSteps } = await import('../../play/kit/agentPlan.js');
    const snaps = new AgentSnapshots({ renderer: {} as never, geometry: new THREE.BufferGeometry(), camera: new THREE.Camera() });
    const g = { ...agGroupState(), key: 'k', rt: [null, null], cur: 0 } as never as SnapGroupState;
    // Played to t = 1 s at 2 steps a frame: 120 steps.
    expect(agLiveSteps(g.live, 0, 2, 0, 8).restart).toBe(true);
    g.step = 0;
    for (let f = 1; f <= 60; f++) { g.live.step = g.step; g.step += agLiveSteps(g.live, f / 60, 2, 0, 8).steps; }
    expect(g.step).toBe(120);
    // Paused at t = 1, five steps by hand.
    g.step += 5;
    snaps.settle({ groups: new Map([['g', g]]), trails: new Map() }, 1, () => 0);
    g.live.step = g.step;
    expect(agLiveSteps(g.live, 1, 2, 0, 8).steps).toBe(0);
    // Playing again: the next frame is two steps on from 125.
    expect(agLiveSteps(g.live, 1 + 1 / 60, 2, 0, 8)).toMatchObject({ steps: 2, restart: false });
  });
});
