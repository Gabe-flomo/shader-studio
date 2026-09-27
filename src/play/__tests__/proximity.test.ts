/**
 * Proximity triggers (two anchors closer or farther than a distance, with
 * hysteresis), the anchors of every positioned layer kind, the firing modes
 * every trigger has (once, held, every N frames or seconds, on release), the
 * file format, and takes of repeated firing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// The graph store reads saved presets on load.
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { anchorDistance, newFireState, proximityGate, stepFire, triggerKey } from '../triggers';
import { geoAnchor } from '../kit/geometry.js';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { kitScript } from '../exportHtml';
import { anchorChoice, anchorLabel, fireLabel, repeatHint, triggerFromKind, triggerLabel, withFire } from '../playSources';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { playOverlay } from '../overlay';
import { takeApplier, useTakes } from '../../lib/takes';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import {
  defaultLayer, emptyPlayRecord, handAnchor, parseHandAnchor, parsePlayRecord, usesHands,
  type FireSpec, type PlayAction, type PlayLayer, type PlayRecord, type TriggerSpec,
} from '../../types/play';

afterEach(() => {
  useTakes.getState().endReplay();
  useTakes.getState().cancel();
  useNodeGraphStore.getState().setPlay(emptyPlayRecord());
  playEngine.setRecord(emptyPlayRecord());
  vi.restoreAllMocks();
});

// ── Firing modes ─────────────────────────────────────────────────────────────

/** Run a mode over frames of [presses so far, held], and list how many fired each frame. */
function run(fire: FireSpec | undefined, frames: Array<[number, boolean]>, dt = 1 / 60): number[] {
  const st = newFireState(0, false);
  return frames.map(([p, g]) => stepFire(st, fire, p, g, dt));
}
const every = (n: number, unit: 'frames' | 'seconds'): FireSpec => ({ mode: 'every', every: n, unit });
// Press on frame 1, hold through frame 7, let go on frame 8.
const HOLD: Array<[number, boolean]> = [[0, false], [1, true], [1, true], [1, true], [1, true], [1, true], [1, true], [1, true], [1, false], [1, false]];

describe('firing modes', () => {
  it('once fires on the edge only (the default: no fire field)', () => {
    expect(run(undefined, HOLD)).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(run({ mode: 'once', every: 3, unit: 'frames' }, HOLD)).toEqual(run(undefined, HOLD));
  });

  it('continuously fires every frame while held', () => {
    expect(run({ mode: 'held', every: 1, unit: 'frames' }, HOLD)).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
  });

  it('every N frames fires at the start, then every N frames while held', () => {
    expect(run(every(3, 'frames'), HOLD)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
    expect(run(every(1, 'frames'), HOLD)).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
  });

  it('every N seconds keeps the rhythm at any frame rate', () => {
    const held = (n: number): Array<[number, boolean]> => [[1, true], ...Array.from({ length: n }, () => [1, true] as [number, boolean])];
    // 0.1 s at 60 fps: the press, then every 6th frame.
    const at60 = run(every(0.1, 'seconds'), held(30), 1 / 60);
    expect(at60.reduce((a, b) => a + b, 0)).toBe(6);
    expect(at60.slice(0, 8)).toEqual([1, 0, 0, 0, 0, 0, 1, 0]);
    // The same half second at 30 fps fires as often.
    expect(run(every(0.1, 'seconds'), held(15), 1 / 30).reduce((a, b) => a + b, 0)).toBe(6);
    // A long frame (a stalled tab) catches up by firing more than once.
    expect(run(every(0.1, 'seconds'), [[1, true], [1, true]], 0.35)).toEqual([1, 3]);
  });

  it('on release fires when it lets go, and for a tap that came and went between frames', () => {
    expect(run({ mode: 'release', every: 1, unit: 'frames' }, HOLD)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
    expect(run({ mode: 'release', every: 1, unit: 'frames' }, [[0, false], [1, false], [2, false]])).toEqual([0, 1, 1]);
    // Let go and pressed again within one frame: one release, and it's held again.
    expect(run({ mode: 'release', every: 1, unit: 'frames' }, [[1, true], [2, true], [2, false]])).toEqual([0, 1, 1]);
  });

  it('a tap between frames still fires once in every mode', () => {
    const tap: Array<[number, boolean]> = [[0, false], [1, false], [1, false]];
    for (const f of [undefined, { mode: 'held', every: 1, unit: 'frames' } as FireSpec, every(3, 'frames')]) expect(run(f, tap)).toEqual([0, 1, 0]);
  });
});

// ── Proximity ────────────────────────────────────────────────────────────────

describe('proximity', () => {
  it('opens below the distance and closes only past the margin (no flicker at the edge)', () => {
    const path = [0.5, 0.3, 0.2, 0.19, 0.21, 0.19, 0.22, 0.24, 0.26, 0.19];
    let open = false;
    const gates = path.map(d => (open = proximityGate(open, d, 'closer', 0.2, 0.05)));
    expect(gates).toEqual([false, false, false, true, true, true, true, true, false, true]);
  });

  it('farther than opens above the distance and holds down to distance − margin', () => {
    let open = false;
    const gates = [0.1, 0.31, 0.28, 0.26, 0.24].map(d => (open = proximityGate(open, d, 'farther', 0.3, 0.05)));
    expect(gates).toEqual([false, true, true, true, false]);
  });

  it('closes while an anchor is missing', () => {
    expect(proximityGate(true, null, 'closer', 0.2, 0.05)).toBe(false);
  });

  it('measures in picture heights, so a wide picture stretches x', () => {
    expect(anchorDistance({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 2)).toBeCloseTo(1.2);
    expect(anchorDistance({ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.6 }, 2)).toBeCloseTo(0.5);
  });

  it('hand anchors round-trip, and anything else is a layer', () => {
    expect(parseHandAnchor(handAnchor('left', 4))).toEqual({ side: 'left', point: 4 });
    expect(parseHandAnchor('hand:right:21')).toBeNull();
    expect(parseHandAnchor('layer_1')).toBeNull();
    expect(anchorChoice('hand:left', 'hand:right:12')).toBe('hand:left:12');
    expect(anchorChoice('hand:any', 'n1')).toBe('hand:any:8');
    expect(anchorLabel('hand:right:8')).toBe('Right · Index tip');
  });
});

// ── Anchors of each layer kind ───────────────────────────────────────────────

const L = (kind: PlayLayer['kind'], over: Record<string, unknown> = {}) => ({ ...defaultLayer(kind, kind, kind), ...over }) as unknown as PlayLayer & Record<string, unknown>;
function anchorOf(l: PlayLayer & Record<string, unknown>, reported: Record<string, number> = {}, others: Array<PlayLayer & Record<string, unknown>> = [], aspect = 1) {
  const value = (x: PlayLayer & Record<string, unknown>) => (k: string) => x[k] as number;
  const lookup = (id: string) => { const o = others.find(x => x.id === id); return o ? { layer: o, value: value(o) } : null; };
  return geoAnchor(l, value(l), aspect, k => reported[k], lookup);
}

describe('anchors', () => {
  it('nulls, text, images, cameras, lenses and audio: their position', () => {
    for (const kind of ['null', 'text', 'image', 'camera', 'lens', 'audio'] as const) expect(anchorOf(L(kind, { x: 0.3, y: 0.7 }))).toEqual({ x: 0.3, y: 0.7 });
  });

  it('shapes: the centre of a box, circle or line; a turned polygon’s bounds centre', () => {
    expect(anchorOf(L('shape', { shape: 'box', x: 0.4, y: 0.6, rotation: 45 }))).toEqual({ x: 0.4, y: 0.6 });
    // A triangle whose bounds run 0..0.2 across and 0..0.1 up from its position: centre (0.1, 0.05).
    const tri = { shape: 'polygon', x: 0.5, y: 0.5, points: [0, 0, 0.2, 0, 0.1, 0.1] };
    const flat = anchorOf(L('shape', { ...tri, rotation: 0 }))!;
    expect(flat.x).toBeCloseTo(0.6); expect(flat.y).toBeCloseTo(0.55);
    // Turned 90° clockwise on screen, (0.1, 0.05) goes to (0.05, −0.1).
    const turned = anchorOf(L('shape', { ...tri, rotation: 90 }))!;
    expect(turned.x).toBeCloseTo(0.55); expect(turned.y).toBeCloseTo(0.4);
    // On a picture twice as wide, an offset in picture heights is half as far across.
    expect(anchorOf(L('shape', { ...tri, rotation: 0 }), {}, [], 2)!.x).toBeCloseTo(0.55);
  });

  it('a layer’s shape is that layer’s centre; the picture’s bright parts, their reported centroid', () => {
    const word = L('text', { id: 'word', x: 0.2, y: 0.3 });
    expect(anchorOf(L('shape', { shape: 'layer', sourceId: 'word' }), {}, [word])).toEqual({ x: 0.2, y: 0.3 });
    expect(anchorOf(L('shape', { shape: 'picture' }), { 'shape::ax': 0.7, 'shape::ay': 0.2 })).toEqual({ x: 0.7, y: 0.2 });
    expect(anchorOf(L('shape', { shape: 'picture' }))).toEqual({ x: 0.5, y: 0.5 });
  });

  it('cloners: the grid or ring centre, a line’s middle, the copies’ centroid on a path', () => {
    expect(anchorOf(L('cloner', { arrange: 'ring', x: 0.3, y: 0.4 }))).toEqual({ x: 0.3, y: 0.4 });
    expect(anchorOf(L('cloner', { arrange: 'line', x: 0.2, y: 0.2, x2: 0.6, y2: 0.4 }))).toEqual({ x: 0.4, y: expect.closeTo(0.3) });
    expect(anchorOf(L('cloner', { arrange: 'path' }), { 'cloner::ax': 0.9, 'cloner::ay': 0.1 })).toEqual({ x: 0.9, y: 0.1 });
  });

  it('particles, bodies and brushes: the reported centroid, none while nothing is alive', () => {
    for (const kind of ['particles', 'bodies', 'brush'] as const) {
      expect(anchorOf(L(kind), { [`${kind}::ax`]: 0.25, [`${kind}::ay`]: 0.75 })).toEqual({ x: 0.25, y: 0.75 });
      expect(anchorOf(L(kind))).toBeNull();
      expect(anchorOf(L(kind), { [`${kind}::ax`]: NaN, [`${kind}::ay`]: NaN })).toBeNull();
    }
  });

  it('scripts: where the sketch sets s.anchor, else the picture’s centre', () => {
    expect(anchorOf(L('script'))).toEqual({ x: 0.5, y: 0.5 });
    expect(anchorOf(L('script'), { 'script::ax': 0.1, 'script::ay': 0.9 })).toEqual({ x: 0.1, y: 0.9 });
  });
});

// ── The file ─────────────────────────────────────────────────────────────────

const nul = (id: string, x: number, y = 0.5) => ({ ...defaultLayer('null', id, id.toUpperCase()), x, y }) as PlayLayer;
const burstLayer = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const near = (distance = 0.2, margin = 0.05): Extract<TriggerSpec, { on: 'proximity' }> => ({ on: 'proximity', a: 'a', b: 'b', when: 'closer', distance, margin });
const action = (id: string, trigger: TriggerSpec, amount = 10): PlayAction => ({ id, trigger, do: 'burst', layerId: 'p', amount, enabled: true });

describe('the play file', () => {
  it('old triggers parse unchanged: no fire field appears', () => {
    const old = {
      version: 1, controls: [], mappings: [], layers: [burstLayer(), defaultLayer('shape', 's', 'S')],
      actions: [
        { id: 'k', trigger: { on: 'key', code: 'Space' }, do: 'burst', layerId: 'p', amount: 5, enabled: true },
        { id: 'z', trigger: { on: 'zone', layerId: 's', event: 'enter', threshold: 0.5 }, do: 'burst', layerId: 'p', amount: 5, enabled: true },
        { id: 'b', trigger: { on: 'beat', bpm: 120, beats: 1 }, do: 'burst', layerId: 'p', amount: 5, enabled: true },
      ],
    };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(old)));
    expect(back.actions).toEqual(old.actions);
    expect(back.actions!.every(a => !('fire' in a.trigger))).toBe(true);
  });

  it('proximity triggers and firing modes round-trip', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), layers: [nul('a', 0.2), nul('b', 0.8), burstLayer()],
      actions: [
        action('once', near()),
        action('trail', { ...near(), fire: { mode: 'every', every: 3, unit: 'frames' } }),
        action('secs', { on: 'key', code: 'KeyA', fire: { mode: 'every', every: 0.25, unit: 'seconds' } }),
        action('hand', { on: 'proximity', a: handAnchor('right', 8), b: 'b', when: 'farther', distance: 0.4, margin: 0.02, fire: { mode: 'release', every: 3, unit: 'frames' } }),
      ],
    };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(rec)));
    expect(back).toEqual(rec);
    expect(usesHands(back)).toBe(true);
    expect(usesHands({ ...back, actions: back.actions!.slice(0, 3) })).toBe(false);
  });

  it('drops a proximity trigger whose layer is gone, and cleans up bad modes', () => {
    const back = parsePlayRecord({
      version: 1, controls: [], mappings: [], layers: [nul('a', 0.2), burstLayer()],
      actions: [
        action('gone', near()),
        { ...action('odd', { on: 'key', code: 'KeyA' }), trigger: { on: 'key', code: 'KeyA', fire: { mode: 'sometimes' } } },
        { ...action('clamp', { on: 'key', code: 'KeyB' }), trigger: { on: 'key', code: 'KeyB', fire: { mode: 'every', every: -4, unit: 'frames' } } },
      ],
    });
    expect(back.actions!.map(a => a.id)).toEqual(['odd', 'clamp']);
    expect(back.actions![0].trigger).toEqual({ on: 'key', code: 'KeyA' });
    expect(back.actions![1].trigger.fire).toEqual({ mode: 'every', every: 1, unit: 'frames' });
  });

  it('distance sensors reach any positioned layer and hand points', () => {
    const rec = parsePlayRecord({
      version: 1, layers: [defaultLayer('text', 't', 'Word'), nul('b', 0.5)],
      controls: [{ id: 'c', target: 'n::amount', kind: 'float', label: 'Amount', min: 0, max: 1 }],
      mappings: [
        { id: 'm1', controlId: 'c', source: { kind: 'sensor', layerId: 't', read: 'distance', otherId: 'b' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'm2', controlId: 'c', source: { kind: 'sensor', layerId: 't', read: 'distance', otherId: handAnchor('left', 4) }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      ],
    });
    expect(rec.mappings).toHaveLength(2);
    expect(usesHands(rec)).toBe(true);
  });
});

describe('the trigger vocabulary', () => {
  it('labels proximity and firing modes', () => {
    const layers = [{ id: 'a', label: 'Cursor' }, { id: 'b', label: 'Target' }];
    expect(triggerLabel(near(), layers)).toBe('Cursor near Target');
    expect(triggerLabel({ ...near(), when: 'farther' }, layers)).toBe('Cursor away from Target');
    expect(fireLabel({ on: 'key', code: 'Space' })).toBe('Once');
    expect(fireLabel({ ...near(), fire: { mode: 'every', every: 3, unit: 'frames' } })).toBe('Every 3 frames');
    expect(fireLabel({ ...near(), fire: { mode: 'release', every: 3, unit: 'frames' } })).toBe('On exit');
    expect(fireLabel({ on: 'key', code: 'Space', fire: { mode: 'release', every: 3, unit: 'frames' } })).toBe('On release');
  });

  it('keeps the firing mode when the trigger kind changes, and leaves Once out of the file', () => {
    const t: TriggerSpec = { on: 'key', code: 'Space', fire: { mode: 'held', every: 3, unit: 'frames' } };
    const layers = [{ id: 'x', kind: 'shape' }, { id: 'n', kind: 'null' }];
    expect(triggerFromKind('proximity', t, layers)).toEqual({ on: 'proximity', a: 'n', b: 'x', when: 'closer', distance: 0.15, margin: 0.03, fire: t.fire });
    expect(withFire(t, { mode: 'once', every: 3, unit: 'frames' })).toEqual({ on: 'key', code: 'Space' });
  });

  it('warns when a toggle repeats every frame, not for bursts or a slow rhythm', () => {
    const held: FireSpec = { mode: 'held', every: 1, unit: 'frames' };
    expect(repeatHint('toggle', held)).toMatch(/flickers/);
    expect(repeatHint('mode:toggle', held)).toMatch(/flickers/);
    expect(repeatHint('burst', held)).toBeNull();
    expect(repeatHint('toggle', undefined)).toBeNull();
    expect(repeatHint('toggle', { mode: 'every', every: 0.5, unit: 'seconds' })).toBeNull();
    expect(repeatHint('toggle', { mode: 'every', every: 3, unit: 'frames' })).toMatch(/flickers/);
  });
});

// ── Through the engine, and into a take ──────────────────────────────────────

/** Two nulls a and b, the particles p, and these actions. B sits at x 0.5; a walks toward it and back. */
function nullsRecord(actions: PlayAction[]): PlayRecord {
  return { ...emptyPlayRecord(), layers: [nul('a', 0.1), nul('b', 0.5), burstLayer()], actions };
}
/** Where a is on each frame: in from 0.1 to 0.45, a pause, and out again, crossing 0.3 (0.2 from b) both ways. */
const WALK = [0.1, 0.2, 0.28, 0.31, 0.35, 0.4, 0.45, 0.45, 0.45, 0.45, 0.45, 0.4, 0.33, 0.27, 0.2, 0.1];

function walk(fired: string[], from = 1): number {
  let t = from;
  for (const x of WALK) {
    playEngine.setOverride('a', 'x', x);
    inputBus.tick(1 / 60, (t += 1 / 60));
  }
  playEngine.setOverride('a', 'x', null);
  return fired.length;
}

describe('proximity through the Play engine', () => {
  it('fires once on arriving, every 3 frames while close, and on exit', () => {
    playEngine.setAspect(1);
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(a.id));
    playEngine.setRecord(nullsRecord([
      action('once', near(0.2, 0.05)),
      action('every3', { ...near(0.2, 0.05), fire: { mode: 'every', every: 3, unit: 'frames' } }),
      action('exit', { ...near(0.2, 0.05), fire: { mode: 'release', every: 3, unit: 'frames' } }),
    ]));
    walk(fired);
    off();
    // Close from x 0.31 (0.19 away) until 0.27 (0.23, past the margin): frames 3 to 12.
    expect(fired.filter(id => id === 'once')).toHaveLength(1);
    expect(fired.filter(id => id === 'exit')).toHaveLength(1);
    expect(fired.filter(id => id === 'every3')).toHaveLength(4); // frames 3, 6, 9, 12
    expect(fired.indexOf('exit')).toBe(fired.length - 1);
  });

  it('reads the distance between any two anchors as a sensor', () => {
    playEngine.setAspect(1);
    playEngine.setRecord({ ...nullsRecord([]), layers: [nul('a', 0.1), { ...defaultLayer('text', 't', 'Word'), x: 0.5, y: 0.8 } as PlayLayer] });
    expect(playEngine.readSource({ kind: 'sensor', layerId: 't', read: 'distance', otherId: 'a' })).toBeCloseTo(0.5);
    expect(playEngine.anchorGap('t', 'a')).toBeCloseTo(0.5);
    // A hand out of view has no position.
    expect(playEngine.readSource({ kind: 'sensor', layerId: 't', read: 'distance', otherId: handAnchor('right', 8) })).toBeNull();
  });

  it('keeps drawing while a repeating trigger is held, and not once it lets go', () => {
    playEngine.setAspect(1);
    playEngine.setRecord(nullsRecord([action('every3', { ...near(0.2, 0.05), fire: { mode: 'every', every: 3, unit: 'frames' } })]));
    playEngine.setOverride('a', 'x', 0.45);
    inputBus.tick(1 / 60, 1);
    expect(playEngine.isAnimating()).toBe(true);
    playEngine.setOverride('a', 'x', 0.1);
    inputBus.tick(1 / 60, 1.02);
    expect(playEngine.isAnimating()).toBe(false);
    playEngine.setOverride('a', 'x', null);
  });

  it('a take records every repeated fire at its time, and plays them back from the take, not from live positions', async () => {
    playEngine.setAspect(1);
    const rec = nullsRecord([action('every3', { ...near(0.2, 0.05), fire: { mode: 'every', every: 3, unit: 'frames' } }, 6)]);
    useNodeGraphStore.getState().setPlay(rec);
    playEngine.setRecord(rec);
    useTakes.getState().setSettings({ countIn: false, manual: true });
    useTakes.getState().begin();
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(a.id));
    walk(fired, 10);
    useTakes.getState().stop();
    off();
    await Promise.resolve();

    const take = useNodeGraphStore.getState().play.takes![0];
    expect(fired).toHaveLength(4);
    expect(take.events).toHaveLength(4);
    expect(take.events.every(e => e.do === 'burst' && e.amount === 6)).toBe(true);
    // Three frames apart.
    const gaps = take.events.slice(1).map((e, i) => e.t - take.events[i].t);
    for (const g of gaps) expect(g).toBeCloseTo(3 / 60, 5);

    // Playing back: the engine is muted (moving the null fires nothing live); the take's events fire instead.
    expect(useTakes.getState().phase).toBe('replay');
    const live: string[] = [];
    const offLive = playEngine.onAction(a => live.push(a.id));
    const replayed = vi.spyOn(playOverlay, 'replayAct');
    let t = take.from;
    for (let i = 0; i < 40; i++) {
      playEngine.setOverride('a', 'x', 0.45);
      inputBus.tick(1 / 60, (t += 1 / 60));
    }
    playEngine.setOverride('a', 'x', null);
    offLive();
    expect(live).toEqual([]);
    expect(replayed).toHaveBeenCalledTimes(4);
    useTakes.getState().endReplay();

    // Rendering offline at 30 fps: the same four, each once, in the frame that holds its time.
    const applier = takeApplier(take, { setUniform: () => {}, width: 100, height: 100 });
    let n = 0;
    for (let f = 0; f <= Math.ceil(take.length * 30) + 1; f++) n += applier.apply(take.from + f / 30).length;
    expect(n).toBe(4);
  });
});

describe('trigger keys', () => {
  it('two proximity triggers with different distances count separately', () => {
    expect(triggerKey(near(0.2))).not.toBe(triggerKey(near(0.3)));
    expect(triggerKey({ ...near(0.2), fire: { mode: 'held', every: 1, unit: 'frames' } })).toBe(triggerKey(near(0.2)));
  });
});

// ── The web runtime's copy ───────────────────────────────────────────────────


/** A top-level helper from the runtime, by name, as a callable function. */
function runtimeFn<T>(name: string): T {
  const start = runtimeSource.indexOf(`  function ${name}(`);
  const end = runtimeSource.indexOf('\n  }\n', start);
  if (start < 0 || end < 0) throw new Error(`no ${name} in the runtime`);
  return new Function(`${runtimeSource.slice(start, end + 4)}\nreturn ${name};`)() as T;
}

describe('the web runtime', () => {
  it('fires by the same modes, gates proximity the same way, and keys it the same', () => {
    const rtFire = runtimeFn<typeof stepFire>('stepFire');
    // The runtime gates proximity with the inlined kit's condition (signals.js), the same one the app runs.
    const SG = (new Function(`${kitScript()}\nreturn SSKit;`)() as { signals: { gate: (open: boolean, v: number | null, cmp: string, th: number, h: number, tol: number) => boolean } }).signals;
    const rtGate = (open: boolean, d: number | null, when: 'closer' | 'farther', distance: number, margin: number) => SG.gate(open, d, when === 'closer' ? 'below' : 'above', distance, margin, 0);
    const rtKey = runtimeFn<(t: TriggerSpec) => string>('triggerKey');
    const modes: Array<FireSpec | undefined> = [undefined, { mode: 'held', every: 1, unit: 'frames' }, every(3, 'frames'), every(0.05, 'seconds'), { mode: 'release', every: 1, unit: 'frames' }];
    for (const f of modes) {
      const a = newFireState(), b = newFireState();
      for (const [p, g] of [...HOLD, [2, false], [3, true], [3, true]] as Array<[number, boolean]>) expect(rtFire(b, f, p, g, 1 / 60)).toBe(stepFire(a, f, p, g, 1 / 60));
    }
    for (const d of [null, 0.1, 0.2, 0.24, 0.3]) for (const open of [false, true]) for (const when of ['closer', 'farther'] as const) {
      expect(rtGate(open, d, when, 0.2, 0.05)).toBe(proximityGate(open, d, when, 0.2, 0.05));
    }
    expect(rtKey(near(0.2))).toBe(triggerKey(near(0.2)));
  });

  it('carries the same anchors in the inlined kit', () => {
    const kit = new Function(`${kitScript()}\nreturn SSKit;`)() as { anchor: typeof geoAnchor };
    const tri = L('shape', { shape: 'polygon', x: 0.5, y: 0.5, rotation: 90, points: [0, 0, 0.2, 0, 0.1, 0.1] });
    const value = (k: string) => tri[k] as number;
    expect(kit.anchor(tri, value, 1.5, () => undefined, () => null)).toEqual(geoAnchor(tri, value, 1.5, () => undefined, () => null));
  });
});
