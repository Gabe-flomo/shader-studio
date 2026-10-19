/**
 * The Live tempo follower against the fake Live's transport stream (tools/fake-live.mjs):
 * jitter, packet loss, a tempo change, a loop, stop and start, a playhead jump. The phase
 * error must stay small and the beat must never run backwards while Live plays.
 */
import { describe, expect, it } from 'vitest';
import { FakeLive } from '../../../tools/fake-live.mjs';
import { decodeOsc } from '../osc/decode.js';
import { LiveState } from '../live/liveProtocol';
import { liveBeatAt, quartersPerBar, TempoFollower } from '../live/tempoFollower';

/** A seeded random (mulberry32), so a failing run repeats. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Run { errorsMs: number[]; backwards: number }

/** Drive LiveState from the fake for `ms`, frame by frame, measuring the error against Live's exact song time. */
function run(live: FakeLive, state: LiveState, from: number, ms: number, settleUntil = -Infinity, events: Array<[number, () => Uint8Array[]]> = []): Run {
  const errorsMs: number[] = [];
  let backwards = 0, prev = -Infinity;
  const feed = (packets: Uint8Array[], now: number) => { for (const p of packets) for (const m of decodeOsc(p)) state.apply({ address: m.address, args: m.args.filter((x): x is number | string | boolean => x !== null) }, now); };
  for (let now = from; now < from + ms; now += 1) {
    for (const [at, fn] of events) if (at === now) { feed(fn(), now); prev = -Infinity; }
    feed(live.tick(now), now);
    // Read on a 60 Hz frame.
    if (now % 16 === 0) {
      const b = state.follower.beatsAt(now);
      if (live.playing && b < prev - 1e-9) backwards++;
      prev = b;
      if (now >= settleUntil) errorsMs.push(((b - live.beatsAt(now)) * 60000) / live.tempo);
    }
  }
  return { errorsMs, backwards };
}

const maxAbs = (xs: number[]) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const meanAbs = (xs: number[]) => xs.reduce((m, x) => m + Math.abs(x), 0) / Math.max(1, xs.length);

describe('Live tempo follower', () => {
  it('locks to a clean 120 BPM stream', () => {
    const live = new FakeLive({ tempo: 120, rand: seeded(1) });
    const state = new LiveState();
    const r = run(live, state, 0, 4000, 500);
    expect(maxAbs(r.errorsMs)).toBeLessThan(1);
    expect(r.backwards).toBe(0);
  });

  it('stays within a few ms through jitter and packet loss, never running backwards', () => {
    const live = new FakeLive({ tempo: 124, jitterMs: 15, loss: 0.25, rand: seeded(7) });
    const state = new LiveState();
    const r = run(live, state, 0, 10000, 1000);
    // Delivery is 0–15 ms late (7.5 on average): the estimate sits about that far behind, and wobbles little.
    expect(maxAbs(r.errorsMs)).toBeLessThan(18);
    expect(meanAbs(r.errorsMs)).toBeLessThan(10);
    expect(r.backwards).toBe(0);
  });

  it('follows a tempo change, a loop jump, and stop then start', () => {
    const live = new FakeLive({ tempo: 120, jitterMs: 8, loss: 0.1, rand: seeded(3) });
    const state = new LiveState();
    run(live, state, 0, 2000);
    // Tempo change at 2 s.
    const a = run(live, state, 2000, 3000, 2600, [[2000, () => live.setTempo(140, 2000)]]);
    expect(state.follower.tempo).toBe(140);
    expect(maxAbs(a.errorsMs)).toBeLessThan(12);
    // A loop wrapping back to beat 0: snaps, then locks again.
    const b = run(live, state, 5000, 2000, 5300, [[5000, () => live.jump(0, 5000)]]);
    expect(maxAbs(b.errorsMs)).toBeLessThan(12);
    // Stop: the position holds; start: it carries on from there.
    const feed = (packets: Uint8Array[], now: number) => packets.forEach(p => { for (const m of decodeOsc(p)) state.apply({ address: m.address, args: m.args.filter((x): x is number | string | boolean => x !== null) }, now); });
    feed(live.setPlaying(false, 7000), 7000);
    const held = state.follower.beatsAt(7000);
    expect(state.follower.playing).toBe(false);
    expect(state.follower.beatsAt(9000)).toBe(held);
    feed(live.setPlaying(true, 9000), 9000);
    expect(Math.abs(state.follower.beatsAt(9000) - held)).toBeLessThan(0.05);
    const c = run(live, state, 9000, 2000, 9300);
    expect(maxAbs(c.errorsMs)).toBeLessThan(12);
  });

  it('beat and bar phases, and a beat trigger following Live', () => {
    const f = new TempoFollower();
    f.sample(0, 6.5, 120, true, 3, 4);
    expect(quartersPerBar(3, 4)).toBe(3);
    expect(f.barPhase(0)).toBeCloseTo(0.5 / 3, 6);
    expect(quartersPerBar(6, 8)).toBe(3);
    // Every beat: the count goes up on each beat, and the gate is open just after it.
    expect(liveBeatAt(0.01, 120, 1)).toEqual({ count: 1, gate: true });
    expect(liveBeatAt(0.5, 120, 1)).toEqual({ count: 1, gate: false });
    expect(liveBeatAt(1.02, 120, 1)).toEqual({ count: 2, gate: true });
    expect(liveBeatAt(7.9, 120, 4).count).toBe(2);
  });
});
