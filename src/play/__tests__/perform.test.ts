/**
 * Perform mode (docs/perform-mode.md, Play audit P19): control kinds → widgets, the grid's items,
 * Randomize's values (strength-bounded), Reset's values, the Stage split (picture on the right,
 * stacked on phones), the Perform keys; and, through the store, Randomize / Reset as ONE undo step
 * and Panic stopping the sound and letting go of momentary things.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import {
  PERFORM_CELL, PERFORM_STACK_PX, RANDOM_STRENGTH, WIDGET_SPAN, performItems, performKey, performSplit, performWidget,
  randomizedValues, resetValues, unitOf, valueAt,
} from '../perform';
import { applyControlValues, currentControlValues, panic, randomizeControls, resetControls } from '../performActions';
import { undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { emptyPlayRecord, type PlayControl, type PlayRecord } from '../../types/play';
import { defaultLayer } from '../../types/playLayers';
import type { GraphNode } from '../../types/nodeGraph';
import { tape } from '../../lib/tape';
import { audioEngineHost } from '../../lib/audioEngineHost';
import { playEngine } from '../../lib/playEngine';
import { playSampler } from '../drumPads';

const f = (id: string, min: number, max: number, extra: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min, max, ...extra });

describe('control kinds → widgets', () => {
  it('levels are faders, ranged numbers knobs, switches toggles, colours swatches, actions pads', () => {
    expect(performWidget(f('mix', 0, 1))).toBe('fader');
    expect(performWidget(f('radius', 0.04, 0.3))).toBe('fader');
    expect(performWidget(f('angle', -3.14, 3.14))).toBe('knob');
    expect(performWidget(f('freq', 1, 30))).toBe('knob');
    expect(performWidget(f('count', 0, 1, { step: 1 }))).toBe('knob');
    expect(performWidget(f('on', 0, 16, { toggle: true }))).toBe('toggle');
    expect(performWidget({ ...f('tint', 0, 1), kind: 'color' })).toBe('swatch');
    expect(performWidget({ ...f('burst', 0, 1), kind: 'action' })).toBe('pad');
  });

  it('a position pair is one XY pad where its A is; groups start with a heading', () => {
    const cs = [f('x', -1, 1), f('size', 0, 1, { group: 'Look' }), f('y', -1, 1, { group: 'Look' }), f('b', 0, 1, { group: 'Look' })];
    const items = performItems(cs, [{ id: 'p', label: 'Dot', a: 'x', b: 'y', position: true }]);
    expect(items.map(i => i.kind)).toEqual(['xy', 'heading', 'fader', 'fader']);
    const xy = items[0];
    expect(xy.kind === 'xy' && xy.a.id === 'x' && xy.b.id === 'y').toBe(true);
    // A value pair (not a position) stays two widgets; a pair with a half hidden too.
    expect(performItems([f('x', -1, 1), f('y', -1, 1)], [{ id: 'p', label: 'P', a: 'x', b: 'y', position: false }]).map(i => i.kind)).toEqual(['knob', 'knob']);
    expect(performItems([f('x', -1, 1)], [{ id: 'p', label: 'P', a: 'x', b: 'y', position: true }]).map(i => i.kind)).toEqual(['knob']);
  });

  it('every widget is a 44 px+ target in every size; faders are two cells tall, XY pads two by two', () => {
    for (const s of ['S', 'M', 'L'] as const) expect(PERFORM_CELL[s]).toBeGreaterThanOrEqual(44 * 2);
    expect(WIDGET_SPAN.fader).toEqual({ cols: 1, rows: 2 });
    expect(WIDGET_SPAN.xy).toEqual({ cols: 2, rows: 2 });
    expect(PERFORM_CELL.S).toBeLessThan(PERFORM_CELL.M);
    expect(PERFORM_CELL.M).toBeLessThan(PERFORM_CELL.L);
  });

  it('maps values to and from 0–1 on the step', () => {
    const c = f('k', 2, 12, { step: 2 });
    expect(unitOf(7, c)).toBe(0.5);
    expect(valueAt(0.52, c)).toBe(8);
    expect(valueAt(2, c)).toBe(12);
    expect(valueAt(-1, c)).toBe(2);
  });
});

describe('Randomize values', () => {
  const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

  it('moves each number by at most strength × its range, inside the range', () => {
    const cs = [f('a', 0, 10), f('b', -1, 1), f('c', 0, 1)];
    const now = new Map<string, number | number[]>([['a', 5], ['b', 0.9], ['c', 0.5]]);
    for (const k of [0.05, 0.35, 1]) {
      for (let t = 0; t < 50; t++) {
        const out = randomizedValues(cs, now, k);
        for (const c of cs) {
          const v = (out.get(c.id) ?? now.get(c.id)) as number;
          expect(v).toBeGreaterThanOrEqual(c.min);
          expect(v).toBeLessThanOrEqual(c.max);
          expect(Math.abs(v - (now.get(c.id) as number))).toBeLessThanOrEqual(k * (c.max - c.min) + 1e-9);
        }
      }
    }
    // rand 1 → +strength, rand 0 → −strength (clamped)
    expect(randomizedValues([f('a', 0, 10)], new Map([['a', 5]]), 0.2, () => 1).get('a')).toBeCloseTo(7);
    expect(randomizedValues([f('a', 0, 10)], new Map([['a', 5]]), 0.2, () => 0).get('a')).toBeCloseTo(3);
    expect(randomizedValues([f('a', 0, 10)], new Map([['a', 9.5]]), 0.2, () => 1).get('a')).toBe(10);
  });

  it('keeps whole steps, flips switches with chance strength, nudges colours, leaves actions alone', () => {
    const out = randomizedValues([f('n', 0, 10, { step: 1 })], new Map([['n', 5]]), 0.33, () => 1);
    expect(Number.isInteger(out.get('n'))).toBe(true);
    const sw = f('s', 0, 1, { toggle: true });
    expect(randomizedValues([sw], new Map([['s', 1]]), 0.3, () => 0.1).get('s')).toBe(0);
    expect(randomizedValues([sw], new Map([['s', 1]]), 0.3, () => 0.5).has('s')).toBe(false);
    const col: PlayControl = { ...f('c', 0, 1), kind: 'color' };
    const c = randomizedValues([col], new Map([['c', [0, 0, 0]]]), 0.5, seq([1])).get('c') as number[];
    expect(c).toEqual([0.5, 0.5, 0.5]);
    const act: PlayControl = { ...f('go', 0, 1), kind: 'action' };
    expect(randomizedValues([act], new Map([['go', 0]]), 1).size).toBe(0);
    expect(RANDOM_STRENGTH.min).toBeGreaterThan(0);
    expect(RANDOM_STRENGTH.default).toBeLessThan(1);
  });

  it('Reset returns only what moved away from home', () => {
    const cs = [f('a', 0, 1), f('b', 0, 1), { ...f('c', 0, 1), kind: 'color' as const }];
    const home = new Map<string, number | number[]>([['a', 0.2], ['b', 0.5], ['c', [1, 0, 0]]]);
    const now = new Map<string, number | number[]>([['a', 0.9], ['b', 0.5], ['c', [1, 0, 0]]]);
    expect([...resetValues(cs, home, now)]).toEqual([['a', 0.2]]);
  });
});

describe('the Stage split: picture on the right, stacked on a phone', () => {
  it('gives the controls about 40 % on the left, kept between 300 and 620 px', () => {
    expect(performSplit(1440)).toEqual({ stacked: false, controls: 576 });
    expect(performSplit(1024).controls).toBe(410);
    expect(performSplit(820).controls).toBe(328);
    expect(performSplit(2560).controls).toBe(620);
    expect(performSplit(700).controls).toBe(300);
  });
  it('stacks at phone width', () => {
    expect(performSplit(390).stacked).toBe(true);
    expect(performSplit(PERFORM_STACK_PX).stacked).toBe(true);
    expect(performSplit(PERFORM_STACK_PX + 1).stacked).toBe(false);
  });
  it('keys: ⇧R randomize, ⇧H reset, ⇧P panic; never with ⌘ (⌘R is Record)', () => {
    const k = (code: string, mods: Partial<KeyboardEvent> = {}) => performKey({ code, shiftKey: true, metaKey: false, ctrlKey: false, altKey: false, ...mods });
    expect(k('KeyR')).toBe('randomize');
    expect(k('KeyH')).toBe('reset');
    expect(k('KeyP')).toBe('panic');
    expect(k('KeyR', { metaKey: true })).toBeNull();
    expect(k('KeyR', { shiftKey: false })).toBeNull();
    expect(k('KeyQ')).toBeNull();
  });
});

describe('Randomize, Reset and Panic on the app', () => {
  afterEach(() => vi.restoreAllMocks());

  const node = (id: string, params: Record<string, unknown>): GraphNode => ({ id, type: 'circleSDF', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params } as unknown as GraphNode);
  const setup = () => {
    const pop = defaultLayer('particles', 'pop', 'Sparks');
    const play: PlayRecord = {
      ...emptyPlayRecord(),
      layers: [pop],
      controls: [
        { id: 'r', target: 'circ::radius', kind: 'float', label: 'Radius', min: 0, max: 1 },
        { id: 'k', target: 'circ::posX', kind: 'float', label: 'X', min: -1, max: 1 },
        { id: 't', target: 'circ::tint', kind: 'color', label: 'Tint', min: 0, max: 1 },
        { id: 'o', target: 'layer:pop::opacity', kind: 'float', label: 'Opacity', min: 0, max: 1 },
        { id: 'b', target: 'act:pop::burst', kind: 'action', label: 'Burst', min: 0, max: 1 },
      ],
    };
    useNodeGraphStore.setState({ nodes: [node('circ', { radius: 0.3, posX: 0, tint: [1, 0.5, 0] })], play });
  };
  const radius = () => useNodeGraphStore.getState().nodes[0].params.radius as number;
  const opacity = () => (useNodeGraphStore.getState().play.layers[0] as unknown as { opacity: number }).opacity;

  it('Randomize moves the graph and the Play record together, as ONE undo step', () => {
    setup();
    const before = { r: radius(), o: opacity(), tint: useNodeGraphStore.getState().nodes[0].params.tint };
    const steps = undoManager.canUndo;
    expect(randomizeControls(1, () => 1)).toBeGreaterThan(0);
    expect(undoManager.canUndo).toBe(steps + 1);
    expect(radius()).toBe(1);
    expect(opacity()).toBe(1);
    expect(useNodeGraphStore.getState().nodes[0].params.tint).toEqual([1, 1, 1]);
    useNodeGraphStore.getState().undo();
    expect(radius()).toBe(before.r);
    expect(opacity()).toBe(before.o);
    expect(useNodeGraphStore.getState().nodes[0].params.tint).toEqual(before.tint);
  });

  it('Randomize by a small strength stays near; twice in a row is two steps', () => {
    setup();
    const steps = undoManager.canUndo;
    randomizeControls(0.1, () => 1);
    expect(radius()).toBeCloseTo(0.4);
    randomizeControls(0.1, () => 1);
    expect(radius()).toBeCloseTo(0.5);
    expect(undoManager.canUndo).toBe(steps + 2);
  });

  it('Reset puts every control back home in one step, and does nothing when nothing moved', () => {
    setup();
    const home = currentControlValues();
    randomizeControls(1, () => 0);
    expect(radius()).toBe(0);
    const steps = undoManager.canUndo;
    expect(resetControls(home)).toBeGreaterThan(0);
    expect(radius()).toBe(0.3);
    expect(undoManager.canUndo).toBe(steps + 1);
    expect(resetControls(home)).toBe(0);
    expect(undoManager.canUndo).toBe(steps + 1);
    expect(applyControlValues(new Map(), 'nothing')).toBe(0);
  });

  it('Panic stops the tape, every rack and Sampler, and lets go of held inputs; values stay', () => {
    setup();
    useNodeGraphStore.getState().setPlay(p => ({ ...p, layers: [...p.layers, defaultLayer('sampler', 'smp', 'Sampler')] }));
    const stop = vi.spyOn(tape, 'stop');
    const racks = vi.spyOn(audioEngineHost, 'panic');
    const pads = vi.spyOn(playSampler, 'stopAll');
    const held = vi.spyOn(playEngine, 'releaseAll');
    const r = radius();
    panic();
    expect(stop).toHaveBeenCalled();
    expect(racks).toHaveBeenCalled();
    expect(pads).toHaveBeenCalledWith('smp');
    expect(held).toHaveBeenCalled();
    expect(radius()).toBe(r);
  });

  it('the engine pieces of Panic run on their own without throwing', () => {
    expect(() => audioEngineHost.panic()).not.toThrow();
    expect(() => playEngine.releaseAll()).not.toThrow();
  });
});
