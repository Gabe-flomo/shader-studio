/**
 * Play's performance readout (lib/perfStats.ts) and the engine's per-record
 * lookups: stages and counts are recorded only while someone watches, the
 * cached triggers follow a new record, and a big setup of conditions stays
 * well inside a frame.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { getPlayPerfSnapshot, playPerfOn, resetPlayStats, subscribePerf } from '../../lib/perfStats';
import { SG_DEPTH } from '../kit/signals.js';
import { defaultLayer, emptyPlayRecord, type PlayAction, type PlayControl, type PlayLayer, type PlayRecord, type TriggerSpec } from '../../types/play';

afterEach(() => {
  playEngine.setRecord(emptyPlayRecord());
  playEngine.setBaseValues(new Map());
  resetPlayStats();
});

const control = (id: string): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1 });
const burstLayer = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const act = (id: string, trigger: TriggerSpec, over: Partial<PlayAction> = {}): PlayAction => ({ id, trigger, do: 'burst', layerId: 'p', amount: 1, enabled: true, ...over });
const above = (threshold: number): TriggerSpec => ({ on: 'value', value: 'ctl:src', cmp: 'above', threshold, hysteresis: 0, tolerance: 0.01 });

function run(values: number[], from = 1): void {
  let t = from;
  for (const v of values) {
    playEngine.setBaseValues(new Map([['src', v]]));
    inputBus.tick(1 / 60, (t += 1 / 60));
  }
}

describe('Play performance readout', () => {
  it('records nothing while no one watches', () => {
    playEngine.setRecord({ ...emptyPlayRecord(), controls: [control('src')], layers: [burstLayer()], actions: [act('a', above(0.5))] });
    expect(playPerfOn()).toBe(false);
    run([0.2, 0.8]);
    expect(getPlayPerfSnapshot().stages.every(s => s.avg === null)).toBe(true);
  });

  it('times the stages and counts conditions, signals and chain depth while watched', () => {
    const off = subscribePerf(() => {});
    try {
      playEngine.setRecord({
        ...emptyPlayRecord(), controls: [control('src')], layers: [burstLayer()],
        signals: [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }],
        actions: [
          act('relay', { on: 'signal', signal: 's1' }, { do: 'signal', layerId: '', signal: 's2' }),
          act('send', above(0.5), { do: 'signal', layerId: '', signal: 's1' }),
          act('also', above(0.7)),
        ],
      });
      run([0.2, 0.8]);
      const snap = getPlayPerfSnapshot();
      for (const stage of ['inputs', 'conditions', 'actions', 'mappings'] as const) {
        expect(snap.stages.find(s => s.stage === stage)!.avg).not.toBeNull();
      }
      expect(snap.conditions).toBe(2);
      // Frame 2 sent s1 then s2: two signals over two frames.
      expect(snap.signals).toBe(1);
      expect(snap.maxDepth).toBeGreaterThanOrEqual(2);
      expect(snap.guardTrips).toBe(0);
    } finally { off(); }
  });

  it('counts a chain stopped by the depth guard', () => {
    const off = subscribePerf(() => {});
    try {
      const n = SG_DEPTH + 2;
      const signals = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `S${i}` }));
      const actions: PlayAction[] = [act('start', above(0.5), { do: 'signal', layerId: '', signal: 's0' })];
      // Listed backwards, so each link needs another pass.
      for (let i = 1; i < n; i++) actions.unshift(act(`l${i}`, { on: 'signal', signal: `s${i - 1}` }, { do: 'signal', layerId: '', signal: `s${i}` }));
      playEngine.setRecord({ ...emptyPlayRecord(), controls: [control('src')], layers: [burstLayer()], signals, actions });
      run([0.2, 0.8]);
      const snap = getPlayPerfSnapshot();
      expect(snap.maxDepth).toBe(SG_DEPTH);
      expect(snap.guardTrips).toBe(1);
    } finally { off(); }
  });
});

describe('the engine’s cached lookups', () => {
  it('follow a new record: a condition added later is evaluated, one removed lets go', () => {
    const fired: string[] = [];
    const offA = playEngine.onAction(a => fired.push(a.id));
    const base: PlayRecord = { ...emptyPlayRecord(), controls: [control('src')], layers: [burstLayer()], actions: [] };
    playEngine.setRecord(base);
    run([0.2, 0.8]);
    expect(fired).toEqual([]);
    playEngine.setRecord({ ...base, actions: [act('a', above(0.5))] });
    run([0.2, 0.8], 2);
    expect(fired).toEqual(['a']);
    playEngine.setRecord({ ...base, actions: [act('a', above(0.5), { enabled: false })] });
    run([0.2, 0.8], 3);
    expect(fired).toEqual(['a']);
    offA();
  });
});

describe('a large setup stays cheap', () => {
  it('500 conditions for 600 frames run well inside the frame budget', () => {
    const actions = Array.from({ length: 500 }, (_, i) => act(`a${i}`, above((i % 97) / 97)));
    playEngine.setRecord({ ...emptyPlayRecord(), controls: [control('src')], layers: [burstLayer()], actions });
    const values = Array.from({ length: 600 }, (_, i) => 0.5 + 0.5 * Math.sin(i / 20));
    const t0 = performance.now();
    run(values);
    const perFrame = (performance.now() - t0) / values.length;
    // A generous bound (a 60 fps frame is 16.6 ms); catches something quadratic creeping in.
    expect(perFrame).toBeLessThan(4);
  });
});
