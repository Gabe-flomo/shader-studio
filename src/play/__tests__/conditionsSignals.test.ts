/**
 * Condition triggers ("when a value…"), signals, pair controls and axis swap:
 * the kit's pure logic (play/kit/signals.js), the Play engine running it, the
 * file format, takes, and the web runtime giving the same values frame by
 * frame.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// The graph store reads saved presets on load.
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { SG_DEPTH, sgCondNew, sgCondStep, sgGate, sgParseValueRef, sgRunActions, sgSwapNew, sgSwapStep } from '../kit/signals.js';
import { proximityGate, triggerKey } from '../triggers';
import { conditionLabel, triggerFromKind, triggerLabel, valueRefLabel } from '../playSources';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { useTakes } from '../../lib/takes';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { playableForPlan } from '../planGates';
import {
  defaultLayer, emptyPlayRecord, parsePlayRecord, usesHands,
  type CondCmp, type PlayAction, type PlayControl, type PlayLayer, type PlayPairMapping, type PlayRecord, type TriggerSpec, type ValueCondition,
} from '../../types/play';

afterEach(() => {
  useTakes.getState().endReplay();
  useTakes.getState().cancel();
  useNodeGraphStore.getState().setPlay(emptyPlayRecord());
  playEngine.setRecord(emptyPlayRecord());
  playEngine.setBaseValues(new Map());
});

const cond = (cmp: CondCmp, threshold: number, hysteresis = 0, tolerance = 0.01): ValueCondition => ({ value: 'ctl:src', cmp, threshold, hysteresis, tolerance });
/** Run a condition over readings and list what happened each frame. */
function steps(c: ValueCondition, vs: Array<number | null>) {
  const st = sgCondNew();
  return vs.map(v => sgCondStep(st, v, c));
}

// ── The condition itself ─────────────────────────────────────────────────────

describe('conditions', () => {
  it('above opens over the threshold and holds down to threshold − hysteresis', () => {
    expect(steps(cond('above', 0.5, 0.1), [0.2, 0.55, 0.45, 0.41, 0.39, 0.6])).toEqual([null, 'open', null, null, 'close', 'open']);
  });

  it('below mirrors it', () => {
    expect(steps(cond('below', 0.5, 0.1), [0.8, 0.45, 0.55, 0.61, 0.3])).toEqual([null, 'open', null, 'close', 'open']);
  });

  it('equals holds within the tolerance, and lets go past tolerance + hysteresis', () => {
    expect(steps(cond('equals', 0.5, 0.05, 0.02), [0.4, 0.51, 0.56, 0.58, 0.49])).toEqual([null, 'open', null, 'close', 'open']);
  });

  it('crossings tap once per pass, re-arm through the hysteresis, and need the other side first', () => {
    // Starting above: no crossing until it has been below.
    expect(steps(cond('crossUp', 0.5, 0.1), [0.7, 0.6, 0.3, 0.55, 0.45, 0.52, 0.3, 0.6])).toEqual([null, null, null, 'tap', null, null, null, 'tap']);
    expect(steps(cond('crossDown', 0.5), [0.7, 0.4, 0.3, 0.6, 0.2])).toEqual([null, 'tap', null, null, 'tap']);
  });

  it('a missing value (a hand out of view) closes it and forgets the side it was on', () => {
    expect(steps(cond('above', 0.5), [0.7, null, 0.7])).toEqual(['open', 'close', 'open']);
    expect(steps(cond('crossUp', 0.5), [0.2, null, 0.7])).toEqual([null, null, null]);
    expect(sgGate(true, null, 'below', 1, 0, 0)).toBe(false);
  });

  it('proximity is its distance case: the same gate, margin for hysteresis', () => {
    for (const d of [null, 0.1, 0.2, 0.24, 0.26]) for (const open of [false, true]) {
      expect(proximityGate(open, d, 'closer', 0.2, 0.05)).toBe(sgGate(open, d, 'below', 0.2, 0.05, 0));
      expect(proximityGate(open, d, 'farther', 0.2, 0.05)).toBe(sgGate(open, d, 'above', 0.2, 0.05, 0));
    }
  });

  it('value paths', () => {
    expect(sgParseValueRef('ctl:c1')).toEqual({ kind: 'control', id: 'c1' });
    expect(sgParseValueRef('layer:dot::x')).toEqual({ kind: 'prop', layerId: 'dot', key: 'x' });
    expect(sgParseValueRef('finish:e1::exposure')).toEqual({ kind: 'prop', layerId: 'finish:e1', key: 'exposure' });
    expect(sgParseValueRef('map:m1')).toEqual({ kind: 'mapping', id: 'm1' });
    expect(sgParseValueRef('dist:hand:right:8|pt:0.5,0.5')).toEqual({ kind: 'distance', a: 'hand:right:8', b: 'pt:0.5,0.5' });
    expect(sgParseValueRef('dist:|b')).toBeNull();
    expect(sgParseValueRef('layer:dot')).toBeNull();
    expect(sgParseValueRef('nonsense')).toBeNull();
  });
});

// ── Signals ──────────────────────────────────────────────────────────────────

type A = { id: string; do: string; signal?: string; trigger: { on: string; signal?: string } };
/** A toy hub: signals press their listeners' counters; `fires` reads and consumes them. */
function hub(actions: A[]) {
  // Presses counted per key; each action remembers how many it has seen (as the engine's firing modes do).
  const presses = new Map<string, number>();
  const seen = new Map<string, number>();
  const ran: string[] = [];
  const keyOf = (a: A) => (a.trigger.on === 'signal' ? `sig:${a.trigger.signal}` : a.trigger.on);
  const fires = (a: A) => {
    const now = presses.get(keyOf(a)) ?? 0;
    const n = now - (seen.get(a.id) ?? 0);
    seen.set(a.id, now);
    return n;
  };
  const press = (k: string) => presses.set(k, (presses.get(k) ?? 0) + 1);
  const frame = () => sgRunActions(actions, fires, a => ran.push(a.id), id => press(`sig:${id}`));
  return { ran, frame, press };
}
const sendOn = (id: string, on: string, signal: string): A => ({ id, do: 'signal', signal, trigger: on.startsWith('sig:') ? { on: 'signal', signal: on.slice(4) } : { on } });
const doOn = (id: string, signal: string): A => ({ id, do: 'burst', trigger: { on: 'signal', signal } });

describe('signals', () => {
  it('a chain runs within the frame, whatever order the actions are listed in', () => {
    const h = hub([doOn('burst', 'b'), sendOn('ab', 'sig:a', 'b'), sendOn('key', 'key', 'a')]);
    h.press('key');
    expect(h.frame()).toEqual(['a', 'b']);
    expect(h.ran).toEqual(['burst']);
  });

  it('a loop fires each signal once a frame and stops', () => {
    const h = hub([sendOn('ab', 'sig:a', 'b'), sendOn('ba', 'sig:b', 'a'), sendOn('key', 'key', 'a'), doOn('x', 'a')]);
    h.press('key');
    expect(h.frame()).toEqual(['a', 'b']);
    expect(h.ran).toEqual(['x']);
  });

  it('a chain longer than the depth carries on next frame', () => {
    const n = SG_DEPTH + 3;
    const chain: A[] = [sendOn('start', 'key', 's0')];
    // Listed backwards, so each link needs another pass.
    for (let i = 1; i < n; i++) chain.unshift(sendOn(`l${i}`, `sig:s${i - 1}`, `s${i}`));
    const h = hub(chain);
    h.press('key');
    const first = h.frame();
    expect(first.length).toBe(SG_DEPTH);
    expect([...first, ...h.frame(), ...h.frame()]).toEqual(Array.from({ length: n }, (_, i) => `s${i}`));
  });
});

// ── Through the Play engine ──────────────────────────────────────────────────

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });
const burstLayer = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const act = (id: string, trigger: TriggerSpec, over: Partial<PlayAction> = {}): PlayAction => ({ id, trigger, do: 'burst', layerId: 'p', amount: 5, enabled: true, ...over });

/** Tick the engine once per value of the `src` control, and return what `read` says after each frame. */
function drive<T>(values: number[], read: () => T, from = 1): T[] {
  let t = from;
  return values.map(v => {
    playEngine.setBaseValues(new Map([['src', v]]));
    inputBus.tick(1 / 60, (t += 1 / 60));
    return read();
  });
}

describe('condition triggers and signals in the engine', () => {
  it('"when a value crosses up" fires an action once per crossing; a signal chain fires the burst in the same frame', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), controls: [control('src')], layers: [burstLayer()],
      signals: [{ id: 's1', name: 'Hit' }, { id: 's2', name: 'Echo' }],
      actions: [
        act('burst', { on: 'signal', signal: 's2' }),
        act('relay', { on: 'signal', signal: 's1' }, { do: 'signal', layerId: '', signal: 's2' }),
        act('send', { on: 'value', ...cond('crossUp', 0.5, 0.1) }, { do: 'signal', layerId: '', signal: 's1' }),
      ],
    };
    playEngine.setRecord(rec);
    const fired: string[] = [];
    const heard: string[] = [];
    const off = playEngine.onAction(a => fired.push(a.id));
    const offSig = playEngine.onSignal(id => heard.push(id));
    const perFrame = drive([0.2, 0.6, 0.7, 0.45, 0.55, 0.3, 0.8], () => fired.length);
    off(); offSig();
    // Crossings on frames 2 and 7 (0.45 and 0.55 stay inside the hysteresis).
    expect(perFrame).toEqual([0, 1, 1, 1, 1, 1, 2]);
    expect(fired).toEqual(['burst', 'burst']);
    expect(heard).toEqual(['s1', 's2', 's1', 's2']);
    // Signal actions never reach the layers.
    expect(fired).not.toContain('relay');
  });

  it('a loop of signals can’t hang the frame', () => {
    playEngine.setRecord({
      ...emptyPlayRecord(), controls: [control('src')], layers: [burstLayer()], signals: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      actions: [
        act('ab', { on: 'signal', signal: 'a' }, { do: 'signal', layerId: '', signal: 'b' }),
        act('ba', { on: 'signal', signal: 'b' }, { do: 'signal', layerId: '', signal: 'a' }),
        act('go', { on: 'value', ...cond('above', 0.5) }, { do: 'signal', layerId: '', signal: 'a' }),
      ],
    });
    const heard: string[] = [];
    const off = playEngine.onSignal(id => heard.push(id));
    drive([0.2, 0.9], () => 0);
    off();
    // Frame 2: a, then b, then a again is refused. What's left (a's press from ba) runs next frame, so it keeps going only as fast as frames.
    expect(heard.slice(0, 2)).toEqual(['a', 'b']);
    expect(heard.filter(x => x === 'a').length).toBeLessThanOrEqual(2);
  });

  it('a mapping can trigger on a signal and on a condition, and meters the condition', () => {
    const toggle = (trigger: TriggerSpec) => ({ kind: 'trigger' as const, trigger, mode: 'toggle' as const, attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false });
    const rec: PlayRecord = {
      ...emptyPlayRecord(), controls: [control('src'), control('flag'), control('flag2')], layers: [burstLayer()], signals: [{ id: 's', name: 'S' }],
      actions: [act('send', { on: 'value', ...cond('crossDown', 0.3) }, { do: 'signal', layerId: '', signal: 's' })],
      mappings: [
        { id: 'm1', controlId: 'flag', source: toggle({ on: 'signal', signal: 's' }), outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'm2', controlId: 'flag2', source: toggle({ on: 'value', ...cond('above', 0.5) }), outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      ],
    };
    playEngine.setRecord(rec);
    // A new mapping starts from "nothing yet": the first frame only looks.
    const out = drive([0.2, 0.6, 0.2, 0.6, 0.2], () => [playEngine.liveValue('flag'), playEngine.liveValue('flag2')]);
    expect(out.map(o => o[0])).toEqual([0, 0, 1, 1, 0]);
    expect(out.map(o => o[1])).toEqual([0, 1, 1, 0, 0]);
    expect(playEngine.readValue('ctl:src')).toBeCloseTo(0.2);
    expect(playEngine.conditionOpen({ on: 'value', ...cond('above', 0.5) })).toBe(false);
  });

  it('distances reach the pointer and points on the picture', () => {
    playEngine.setAspect(1);
    playEngine.setRecord({ ...emptyPlayRecord(), layers: [{ ...defaultLayer('null', 'n', 'N'), x: 0.2, y: 0.5 } as PlayLayer] });
    expect(playEngine.readValue('dist:n|pt:0.5,0.5')).toBeCloseTo(0.3);
    expect(playEngine.readValue('dist:mouse|pt:0.5,0.5')).toBeCloseTo(0);
    expect(playEngine.readValue('layer:n::x')).toBeCloseTo(0.2);
    expect(playEngine.readValue('ctl:gone')).toBeNull();
  });
});

// ── Pairs ────────────────────────────────────────────────────────────────────

/** Controls src (the driver), ax and ay (the pair), and this pair mapping. */
function pairRecord(pm: Partial<PlayPairMapping>): PlayRecord {
  const axis = { outMin: 0, outMax: 10, curve: 'linear' as const, smoothMs: 0 };
  return {
    ...emptyPlayRecord(),
    controls: [control('src'), control('ax', { max: 10 }), control('ay', { max: 10 })],
    pairs: [{ id: 'p', label: 'XY', a: 'ax', b: 'ay', position: true }],
    signals: [{ id: 'sw', name: 'Swapped' }, { id: 'back', name: 'Back' }],
    pairMappings: [{ id: 'pm', pairId: 'p', source: { kind: 'value', source: { kind: 'control', controlId: 'src' } }, affect: 'both', a: { ...axis }, b: { ...axis, outMax: 20 }, enabled: true, ...pm }],
  };
}
const ab = () => [playEngine.liveValue('ax'), playEngine.liveValue('ay')] as Array<number | undefined>;

describe('pair mappings', () => {
  it('Affect both sends one source to each axis through its own range; Affect A leaves B to its slider', () => {
    playEngine.setRecord(pairRecord({}));
    expect(drive([0.5], ab)[0]).toEqual([5, 10]);
    playEngine.setRecord(pairRecord({ affect: 'a' }));
    expect(drive([0.25], ab)[0]).toEqual([2.5, undefined]);
    expect(playEngine.isDriven('ax')).toBe(true);
    expect(playEngine.isDriven('ay')).toBe(false);
  });

  it('a position drives both axes at once: x to A, y to B', () => {
    playEngine.setAspect(1);
    const rec = pairRecord({ source: { kind: 'position', anchor: 'n' } });
    playEngine.setRecord({ ...rec, layers: [{ ...defaultLayer('null', 'n', 'N'), x: 0.3, y: 0.8 } as PlayLayer] });
    const [a, b] = drive([0], ab)[0];
    expect(a).toBeCloseTo(3);
    expect(b).toBeCloseTo(16);
  });

  it('a per-axis condition holds the axis where it was while it isn’t met', () => {
    playEngine.setRecord(pairRecord({ affect: 'a', a: { outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, when: cond('below', 0.6) } }));
    expect(drive([0.2, 0.5, 0.9, 0.95, 0.4], () => playEngine.liveValue('ax'))).toEqual([2, 5, 5, 5, 4]);
  });

  it('axis swap: A until it crosses the swap threshold, then B until B crosses back; a signal on each swap; rewind starts on A', () => {
    playEngine.setRecord(pairRecord({ swap: { at: 8, dir: 'up', backAt: 5, backDir: 'down', signal: 'sw', backSignal: 'back' } }));
    const heard: string[] = [];
    const off = playEngine.onSignal(id => heard.push(id));
    const out = drive([0.5, 0.9, 0.3, 0.2, 0.7, 0.9], ab);
    off();
    // A to 9 (crosses 8: swap). B follows: 0.3 → 6, 0.2 → 4 (crosses 5 down: back to A). A: 7, then 9 crosses again.
    expect(out).toEqual([[5, undefined], [9, undefined], [9, 6], [9, 4], [7, 4], [9, 4]]);
    expect(heard).toEqual(['sw', 'back', 'sw']);
    expect(playEngine.pairNow(playEngine.getRecord().pairMappings![0]).axis).toBe('b');
    // The clock sent back: on A again.
    drive([0.1], ab, 0.5);
    expect(playEngine.pairNow(playEngine.getRecord().pairMappings![0]).axis).toBe('a');
  });

  it('the swap state machine alone', () => {
    const st = sgSwapNew(), sw = { at: 0.8, dir: 'up' as const, backAt: 0.2, backDir: 'down' as const };
    const seq: Array<[number | null, number | null]> = [[0.5, null], [0.85, null], [null, 0.5], [null, 0.1], [0.9, null], [0.5, null], [0.81, null]];
    expect(seq.map(([a, b]) => sgSwapStep(st, a, b, sw))).toEqual([null, 'toB', null, 'toA', null, null, 'toB']);
  });
});

// ── The file ─────────────────────────────────────────────────────────────────

describe('the play file', () => {
  it('conditions, signals, signal actions, pairs and pair mappings round-trip', () => {
    const rec: PlayRecord = {
      ...pairRecord({ swap: { at: 8, dir: 'up', backAt: 5, backDir: 'down', signal: 'sw' }, a: { outMin: 0, outMax: 10, curve: 'exp', smoothMs: 40, when: cond('equals', 0.5, 0.1, 0.05) } }),
      layers: [burstLayer()],
      actions: [
        act('send', { on: 'value', value: 'dist:p|pt:0.5,0.5', cmp: 'below', threshold: 0.1, hysteresis: 0.02, tolerance: 0.01, fire: { mode: 'every', every: 3, unit: 'frames' } }, { do: 'signal', layerId: '', signal: 'sw', amount: 1 }),
        act('burst', { on: 'signal', signal: 'sw' }),
      ],
    };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(rec)));
    expect(back).toEqual(rec);
  });

  it('drops pairs of missing or repeated controls and their mappings; fixes bad conditions', () => {
    const rec = pairRecord({});
    const back = parsePlayRecord({
      ...rec,
      pairs: [...rec.pairs!, { id: 'q', label: 'Again', a: 'ax', b: 'src', position: false }, { id: 'r', label: 'Gone', a: 'nope', b: 'src', position: false }],
      pairMappings: [...rec.pairMappings!, { ...rec.pairMappings![0], id: 'pm2', pairId: 'r' }],
      actions: [{ id: 'x', trigger: { on: 'value', value: 'bogus', cmp: 'above', threshold: 1 }, do: 'signal', signal: 'sw', enabled: true }],
    });
    expect(back.pairs!.map(p => p.id)).toEqual(['p']);
    expect(back.pairMappings!.map(m => m.id)).toEqual(['pm']);
    expect(back.actions).toBeUndefined();
  });

  it('a condition on a distance to a hand turns hand tracking on', () => {
    const rec = { ...emptyPlayRecord(), actions: [act('a', { on: 'value', value: 'dist:hand:right:8|pt:0.5,0.5', cmp: 'below', threshold: 0.1, hysteresis: 0, tolerance: 0 })] };
    expect(usesHands(rec)).toBe(true);
    expect(usesHands({ ...rec, actions: [act('a', { on: 'value', ...cond('above', 0.5) })] })).toBe(false);
  });

  it('Free plays pointer pairs, not a knob or a condition', () => {
    const rec = pairRecord({ source: { kind: 'position', anchor: 'mouse' } });
    expect(playableForPlan(rec, 'free').pairMappings).toHaveLength(1);
    expect(playableForPlan(pairRecord({ source: { kind: 'position', anchor: 'n' } }), 'free').pairMappings).toHaveLength(0);
  });
});

describe('words', () => {
  it('labels conditions and signals', () => {
    const ctx = { controls: [{ id: 'src', label: 'Radius' }], layers: [{ id: 'n', label: 'Dot' }], signals: [{ id: 's', name: 'Hit' }] };
    expect(conditionLabel(cond('above', 0.5), ctx)).toBe('Radius above 0.5');
    expect(conditionLabel({ ...cond('equals', 2, 0, 0.1), value: 'dist:n|mouse' }, ctx)).toBe('Dot ↔ Mouse equals 2 ± 0.1');
    expect(valueRefLabel('dist:n|pt:0.25,0.75', ctx)).toBe('Dot ↔ Point 0.25, 0.75');
    expect(triggerLabel({ on: 'signal', signal: 's' }, [], ctx)).toBe('Signal Hit');
    expect(triggerLabel({ on: 'signal', signal: 'x' }, [], ctx)).toBe('Signal Missing signal');
  });

  it('switching a proximity trigger to "when a value" keeps its distance', () => {
    const t = triggerFromKind('value', { on: 'proximity', a: 'a', b: 'b', when: 'closer', distance: 0.2, margin: 0.05 });
    expect(t).toEqual({ on: 'value', value: 'dist:a|b', cmp: 'below', threshold: 0.2, hysteresis: 0.05, tolerance: 0 });
    expect(triggerKey(t)).toBe('val:dist:a|b:below:0.2:0.05:0');
  });
});

// ── Takes ────────────────────────────────────────────────────────────────────

describe('takes', () => {
  it('records what a signal chain did, and a pair’s values, and plays them back muted', async () => {
    const rec: PlayRecord = {
      ...pairRecord({ swap: { at: 8, dir: 'up', backAt: 5, backDir: 'down' } }),
      layers: [burstLayer()],
      actions: [
        act('send', { on: 'value', ...cond('crossUp', 0.5) }, { do: 'signal', layerId: '', signal: 'sw' }),
        act('burst', { on: 'signal', signal: 'sw' }, { amount: 7 }),
      ],
    };
    useNodeGraphStore.getState().setPlay(rec);
    playEngine.setRecord(rec);
    useTakes.getState().setSettings({ countIn: false, manual: true });
    useTakes.getState().begin();
    drive([0.2, 0.6, 0.9, 0.3, 0.7, ...Array.from({ length: 20 }, () => 0.8)], () => 0, 10);
    useTakes.getState().stop();
    await Promise.resolve();
    const take = useNodeGraphStore.getState().play.takes![0];
    expect(take.events.map(e => [e.do, e.amount])).toEqual([['burst', 7], ['burst', 7]]);
    const ax = take.tracks.find(t => t.kind === 'control' && t.id === 'ax');
    const ay = take.tracks.find(t => t.kind === 'control' && t.id === 'ay');
    expect(ax && ay).toBeTruthy();
  });
});

// ── The web runtime ──────────────────────────────────────────────────────────

class El {
  tagName: string; children: El[] = []; style: Record<string, string> = {}; className = ''; textContent = ''; innerHTML = ''; parentElement: El | null = null;
  width = 300; height = 150; clientWidth = 400; clientHeight = 300; value = ''; disabled = false; dataset = {};
  classList = { add() {}, remove() {}, toggle() {} };
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  append(...c: El[]) { for (const e of c) { e.parentElement = this; this.children.push(e); } }
  appendChild(c: El) { this.append(c); return c; }
  prepend(...c: El[]) { this.append(...c); }
  replaceChildren(...c: El[]) { this.children = []; this.append(...c); }
  remove() {} setAttribute() {} removeAttribute() {} addEventListener() {} removeEventListener() {} setPointerCapture() {}
  load() {} pause() {} play() { return Promise.resolve(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }; }
  getContext(kind: string) {
    if (kind === '2d') return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? this : () => ({ data: new Uint8ClampedArray(4) })) });
    return new Proxy({}, { get: (_t, k: string) => (/^[A-Z0-9_]+$/.test(k) ? 1 : k === 'getShaderParameter' || k === 'getProgramParameter' ? () => true : k === 'checkFramebufferStatus' ? () => 1 : k === 'getExtension' ? () => ({}) : () => ({})) });
  }
}

/** Mount the runtime (with the kit) on a record and step it frame by frame, setting `src` before each. */
function runtimeRun(play: PlayRecord, values: number[], read: string[]) {
  const rafs: ((t: number) => void)[] = [];
  const win: Record<string, unknown> = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  const doc = { head: new El('head'), hidden: false, getElementById: () => null, createElement: (tag: string) => new El(tag), addEventListener() {}, removeEventListener() {} };
  const noop = class { observe() {} disconnect() {} };
  const fn = new Function('window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'URL', `${kitScript()}\n${runtimeSource}`);
  fn(win, doc, {}, (cb: (t: number) => void) => { rafs.push(cb); return rafs.length; }, () => {}, noop, noop, El.bind(null, 'img'), { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
  const api = win.ShaderStudioPlay as { mount: (el: unknown, b: unknown, o?: unknown) => { set(id: string, v: number): void; get(id: string): { value: number; driven: boolean } | null } };
  const bindings = Object.fromEntries(play.controls.map(c => [c.target, `u_${c.id}`]));
  const uniforms = Object.fromEntries(play.controls.map(c => [`u_${c.id}`, { type: 'float', value: 0 }]));
  const h = api.mount(new El('div'), { title: 'T', fragmentShader: 'void main(){}', uniforms, paramBindings: bindings, play, aspect: { id: 'free', ratio: null } }, { mode: 'player', panel: false });
  let now = 1000;
  return values.map(v => {
    h.set('src', v);
    rafs.shift()?.((now += 1000 / 60));
    return read.map(id => { const g = h.get(id); return g?.driven ? g.value : undefined; });
  });
}

describe('the web runtime', () => {
  it('drives a pair with axis swap and a condition → signal → toggle chain frame for frame like the app', () => {
    const toggle = { kind: 'trigger' as const, trigger: { on: 'signal' as const, signal: 'back' }, mode: 'toggle' as const, attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false };
    const rec: PlayRecord = {
      ...pairRecord({ swap: { at: 8, dir: 'up', backAt: 5, backDir: 'down', backSignal: 'back' }, a: { outMin: 0, outMax: 10, curve: 'exp', smoothMs: 0 }, b: { outMin: 0, outMax: 20, curve: 'linear', smoothMs: 20 } }),
      controls: [control('src'), control('ax', { max: 10 }), control('ay', { max: 10 }), control('flag'), control('hits', { max: 10 })],
      layers: [burstLayer()],
      actions: [act('send', { on: 'value', ...cond('crossDown', 0.25) }, { do: 'signal', layerId: '', signal: 'sw' })],
      mappings: [
        { id: 'm', controlId: 'flag', source: toggle, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'm2', controlId: 'hits', source: { ...toggle, trigger: { on: 'signal', signal: 'sw' }, mode: 'step', steps: 5 }, outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, enabled: true },
      ],
    };
    const values = [0.2, 0.6, 0.95, 0.99, 0.5, 0.2, 0.1, 0.4, 0.95, 1, 0.3, 0.1];
    const ids = ['ax', 'ay', 'flag', 'hits'];
    playEngine.setRecord(rec);
    const app = drive(values, () => ids.map(id => playEngine.liveValue(id) as number | undefined));
    const web = runtimeRun(rec, values, ids);
    expect(web.length).toBe(app.length);
    for (let i = 0; i < app.length; i++) for (let j = 0; j < ids.length; j++) {
      const a = app[i][j], w = web[i][j];
      if (a === undefined) expect(w, `${ids[j]} frame ${i}`).toBeUndefined();
      else expect(w, `${ids[j]} frame ${i}`).toBeCloseTo(a, 1);
    }
    // It did swap, and the signals did land.
    expect(app.some(r => r[1] !== undefined)).toBe(true);
    expect(app[app.length - 1][2]).toBe(1);
  });
});

// ── Pairing from the panel ───────────────────────────────────────────────────

describe('making pairs', () => {
  it('Add as position: finds or makes the X/Y partner and puts X on A', async () => {
    const { positionPair, layerPositionPair, makePair, unpair, partnerTarget } = await import('../pairs');
    expect(partnerTarget('circ::posX')).toEqual({ target: 'circ::posY', axis: 'y' });
    expect(partnerTarget('layer:n::y')).toEqual({ target: 'layer:n::x', axis: 'x' });
    const base: PlayRecord = { ...emptyPlayRecord(), controls: [control('y', { target: 'circ::posY', label: 'Pos Y' })] };
    const r = positionPair(base, 'y', t => (t === 'circ::posX' ? { label: 'Pos X', min: -1, max: 1 } : null));
    const made = r.play.controls.find(c => c.target === 'circ::posX')!;
    expect(r.play.pairs).toEqual([{ id: r.pairId, label: 'Pos', a: made.id, b: 'y', position: true }]);
    // From a layer's rows: both made.
    const withNull: PlayRecord = { ...emptyPlayRecord(), layers: [{ ...defaultLayer('null', 'n', 'Dot'), x: 0.2, y: 0.3 } as PlayLayer] };
    const l = layerPositionPair(withNull, 'n', 'y');
    expect(l.play.controls.map(c => c.target)).toEqual(['layer:n::y', 'layer:n::x']);
    expect(l.play.pairs![0].a).toBe(l.play.controls[1].id);
    // Pairing a control again takes it out of its old pair (and that pair's mappings go).
    const p1 = { ...pairRecord({}), controls: [...pairRecord({}).controls, control('c')] };
    const again = makePair(p1, 'ax', 'c', false).play;
    expect(again.pairs!.map(p => [p.a, p.b])).toEqual([['ax', 'c']]);
    expect(again.pairMappings).toBeUndefined();
    expect(unpair(again, again.pairs![0].id).pairs).toBeUndefined();
  });
});
