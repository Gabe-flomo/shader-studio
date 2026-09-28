/** The output window's sync: frames encoded as changes, messages turned into the output's state, the followed clock. */
import { describe, expect, it } from 'vitest';
import { ClockFollower, FrameEncoder, FULL_EVERY, initialOutputState, reduceOutput, takeActions, type DownMsg, type FrameMsg, type OutputRecord } from '../protocol';
import { defaultProjection } from '../../types/projection';

const record = (rev: number): OutputRecord => ({ rev, title: 'T', bundle: {}, scripts: '', aspect: 16 / 9, follow: true });

describe('FrameEncoder', () => {
  it('sends everything first, then only what changed', () => {
    const e = new FrameEncoder();
    const f0 = e.encode(0, true, { u_a: 1, u_c: [1, 2, 3] }, { 'l1::x': 0.5 });
    expect(f0).toMatchObject({ seq: 0, full: true, u: { u_a: 1, u_c: [1, 2, 3] }, l: { 'l1::x': 0.5 } });
    const f1 = e.encode(0.016, true, { u_a: 1, u_c: [1, 2, 3] }, { 'l1::x': 0.5 });
    expect(f1.full).toBeUndefined();
    expect(f1.u).toBeUndefined();
    expect(f1.l).toBeUndefined();
    const f2 = e.encode(0.033, true, { u_a: 2, u_c: [1, 2, 4] }, { 'l1::x': 0.5, 'l1::y': 0.1 });
    expect(f2.u).toEqual({ u_a: 2, u_c: [1, 2, 4] });
    expect(f2.l).toEqual({ 'l1::y': 0.1 });
  });

  it('copies vectors, so a source mutating its array in place still counts as a change', () => {
    const e = new FrameEncoder();
    const v = [0, 0, 0];
    e.encode(0, true, { c: v }, {});
    v[1] = 1;
    expect(e.encode(0, true, { c: v }, {}).u).toEqual({ c: [0, 1, 0] });
  });

  it('sends a full frame on request and every FULL_EVERY frames', () => {
    const e = new FrameEncoder();
    for (let i = 0; i < FULL_EVERY; i++) e.encode(i, true, { a: 1 }, {});
    expect(e.encode(0, true, { a: 1 }, {}).full).toBe(true);
    expect(e.encode(0, true, { a: 1 }, {}).full).toBeUndefined();
    e.forceFull();
    expect(e.encode(0, true, { a: 1 }, {}).full).toBe(true);
  });

  it('carries the pointer and the actions', () => {
    const f = new FrameEncoder().encode(1, false, {}, {}, [0.2, 0.3, 1, 1], [{ do: 'burst', layerId: 'p', amount: 20 }]);
    expect(f.p).toEqual([0.2, 0.3, 1, 1]);
    expect(f.a).toEqual([{ do: 'burst', layerId: 'p', amount: 20 }]);
    expect(f.playing).toBe(false);
  });
});

describe('reduceOutput', () => {
  it('rebuilds the values from a full frame and the changes after it', () => {
    const e = new FrameEncoder();
    let s = initialOutputState();
    const frames: FrameMsg[] = [
      e.encode(0, true, { a: 1, b: [0, 0] }, { 'l::x': 0 }),
      e.encode(0.1, true, { a: 2, b: [0, 0] }, { 'l::x': 0 }),
      e.encode(0.2, true, { a: 2, b: [1, 0] }, { 'l::x': 0.7 }),
    ];
    for (const f of frames) s = reduceOutput(s, f, 100);
    expect(s.follow.uniforms).toEqual({ a: 2, b: [1, 0] });
    expect(s.follow.layers).toEqual({ 'l::x': 0.7 });
    expect(s.follow.t).toBe(0.2);
    expect(s.needsFull).toBe(false);
  });

  it('asks for a full frame when one went missing (and keeps the clock)', () => {
    const e = new FrameEncoder();
    let s = reduceOutput(initialOutputState(), e.encode(0, true, { a: 1 }, {}), 0);
    e.encode(0.1, true, { a: 2 }, {}); // lost on the way
    const f2 = e.encode(0.2, true, { a: 3, b: 1 }, {});
    s = reduceOutput(s, f2, 10);
    expect(s.needsFull).toBe(true);
    expect(s.follow.t).toBe(0.2);
    expect(s.follow.uniforms).toEqual({ a: 1 }); // not a half-applied delta
    s = reduceOutput(s, e.encode(0.25, true, { a: 4, b: 1 }, {}), 15);
    expect(s.follow.uniforms).toEqual({ a: 1 }); // still waiting for the full frame
    e.forceFull();
    s = reduceOutput(s, e.encode(0.3, true, { a: 3, b: 1 }, {}), 20);
    expect(s.needsFull).toBe(false);
    expect(s.follow.uniforms).toEqual({ a: 3, b: 1 });
  });

  it('a delta before any full frame waits for one', () => {
    const s = reduceOutput(initialOutputState(), { type: 'frame', seq: 5, t: 1, playing: true, u: { a: 1 } }, 0);
    expect(s.needsFull).toBe(true);
    expect(s.follow.uniforms).toEqual({});
  });

  it('keeps the newest record, notes one waiting in the app, and takes the mapping and edit state', () => {
    let s = initialOutputState();
    s = reduceOutput(s, { type: 'record', record: record(2) }, 0);
    expect(s.record?.rev).toBe(2);
    expect(reduceOutput(s, { type: 'record', record: record(1) }, 0)).toBe(s);
    s = reduceOutput(s, { type: 'recordReady', rev: 3 }, 0);
    expect(s.pendingRev).toBe(3);
    s = reduceOutput(s, { type: 'record', record: record(3) }, 0);
    expect(s.pendingRev).toBeNull();
    const projection = defaultProjection();
    s = reduceOutput(s, { type: 'mapping', projection, layers: { [projection.surfaces[0].id]: ['a'] } }, 0);
    expect(s.projection).toBe(projection);
    s = reduceOutput(s, { type: 'ui', ui: { edit: true, pattern: 'grid', selected: 'x' } }, 0);
    expect(s.ui).toEqual({ edit: true, pattern: 'grid', selected: 'x' });
    expect(reduceOutput(s, { type: 'bye' } as DownMsg, 0).closed).toBe(true);
  });

  it('queues actions until the player takes them', () => {
    const e = new FrameEncoder();
    let s = reduceOutput(initialOutputState(), e.encode(0, true, {}, {}, undefined, [{ do: 'burst', layerId: 'p', amount: 1 }]), 0);
    s = reduceOutput(s, e.encode(0, true, {}, {}, undefined, [{ do: 'drop', layerId: 'q', amount: 2 }]), 0);
    const t = takeActions(s);
    expect(t.actions.map(a => a.do)).toEqual(['burst', 'drop']);
    expect(t.state.follow.actions).toEqual([]);
    expect(takeActions(t.state).actions).toEqual([]);
  });
});

describe('ClockFollower', () => {
  it('runs the main window’s clock on between frames', () => {
    const c = new ClockFollower();
    c.update(10, true, 1000);
    expect(c.at(1000)).toBeCloseTo(10, 9);
    expect(c.at(1500)).toBeCloseTo(10.5, 9);
  });
  it('eases small differences and snaps big ones (a seek)', () => {
    const c = new ClockFollower();
    c.update(10, true, 1000);
    c.update(10.02, true, 1000); // 20 ms ahead: eased, not jumped
    expect(c.at(1000)).toBeCloseTo(10.002, 6);
    c.update(42, true, 1000);
    expect(c.at(1000)).toBeCloseTo(42, 9);
  });
  it('holds still while paused', () => {
    const c = new ClockFollower();
    c.update(3, false, 0);
    expect(c.at(5000)).toBe(3);
    c.update(3, true, 5000);
    expect(c.at(6000)).toBeCloseTo(4, 9);
  });
});
