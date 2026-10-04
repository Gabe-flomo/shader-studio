/**
 * Look (Finish) effects, third pass: Pixel sort's motion (Flow, Drip, Breathe, Wander, Turbulence,
 * Trail), ASCII's typed characters (the Glyphs layer's sets, emoji, ordered by coverage) and the
 * rules' Look actions (Mosh, Reset mosh, Pulse a setting, Set a setting) in the kit, the record, the
 * engine, the Do menu and the exported kit.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import {
  FN_EFFECTS, FN_LOOK_ACTIONS, FN_SORT_MOTION, fnAnimated, fnAsciiTyped, fnBuildFinal, fnDefaultEffect, fnLookAct, fnLookNew, fnLookReset, fnLookStep, fnLookValue, fnSegments, fnSortTrails, type FnEffect,
} from '../kit/finish.js';
import { GY_SETS, gyCoverage, gyList, gyOrder } from '../kit/glyphs.js';
import { parseFinishEffect } from '../../types/playFinish';
import { emptyPlayRecord, parsePlayRecord, parseTake, type PlayControl, type PlayRecord } from '../../types/play';
import { defaultLayer } from '../../types/playLayers';
import { sgReactions } from '../kit/signals.js';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { doChoices, lookDefaults, reactionText } from '../../components/play/rules/reactionChoices';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); playEngine.resetLooks(); });

const fx = (kind: Parameters<typeof fnDefaultEffect>[0], patch: Record<string, unknown> = {}): FnEffect => ({ ...fnDefaultEffect(kind, kind), ...patch });

describe('pixel sort motion', () => {
  it('adds mappable motion settings that all start still, so saved stacks look the same', () => {
    const keys = FN_EFFECTS.pixelsort.params.map(p => p.key);
    for (const k of FN_SORT_MOTION) expect(keys).toContain(k);
    const d = fnDefaultEffect('pixelsort', 'p');
    for (const k of ['flow', 'drip', 'breathe', 'wander', 'turbulence', 'trail']) expect(d[k], k).toBe(0);
    // A pixel sort saved before motion: every motion number comes back at 0.
    const old = parseFinishEffect({ id: 'p', kind: 'pixelsort', threshold: 0.3, length: 0.5, angle: 0, amount: 1 })!;
    for (const k of ['flow', 'drip', 'breathe', 'wander', 'turbulence', 'trail']) expect(old[k], k).toBe(0);
    expect(fnAnimated({ on: true, effects: [old] })).toBe(false);
  });

  it('has Melt, Rain and Glitch drift presets beside Drip and Sideways, each setting every motion number', () => {
    const names = FN_EFFECTS.pixelsort.presets!.map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(['Drip', 'Sideways', 'Melt', 'Rain', 'Glitch drift']));
    for (const p of FN_EFFECTS.pixelsort.presets!) for (const k of FN_SORT_MOTION) expect(p.values[k], `${p.name}.${k}`).toBeTypeOf('number');
    for (const name of ['Melt', 'Rain', 'Glitch drift']) {
      const v = FN_EFFECTS.pixelsort.presets!.find(p => p.name === name)!.values;
      expect(fnAnimated({ on: true, effects: [fx('pixelsort', v)] }), name).toBe(true);
    }
  });

  it('moves with the clock: Flow, Drip and Rate-driven settings keep the preview drawing', () => {
    expect(fnAnimated({ on: true, effects: [fx('pixelsort', { flow: 0.2 })] })).toBe(true);
    expect(fnAnimated({ on: true, effects: [fx('pixelsort', { drip: 0.5 })] })).toBe(true);
    expect(fnAnimated({ on: true, effects: [fx('pixelsort', { breathe: 0.1 })] })).toBe(true);
    expect(fnAnimated({ on: true, effects: [fx('pixelsort', { breathe: 0.1, rate: 0 })] })).toBe(false);
    const src = fnBuildFinal([fx('pixelsort', { flow: 0.2 })]).src;
    expect(src).toContain('pixelsort_flow * uTime');
    expect(src).toContain('pixelsort_breathe');
    expect(src).toContain('pixelsort_wander');
  });

  it('a trail ends its pass (an empty pass follows it last in the stack) and reads the frame before', () => {
    const still = fx('pixelsort');
    const trail = fx('pixelsort', { trail: 0.5 });
    expect(fnSortTrails(still)).toBe(false);
    expect(fnSortTrails(trail)).toBe(true);
    // The renderer's mark (the value as driven now) wins over the record's.
    expect(fnSortTrails({ ...trail, trailOn: false })).toBe(false);
    expect(fnSegments([still]).length).toBe(1);
    expect(fnSegments([trail]).map(s => s.map(e => e.kind))).toEqual([['pixelsort'], []]);
    expect(fnSegments([fx('grade'), trail, fx('vignette')]).map(s => s.map(e => e.kind))).toEqual([['grade'], ['pixelsort'], ['vignette']]);
    const b = fnBuildFinal([trail], { segment: 0 });
    expect(b.psTrail).toBe(true);
    expect(b.src).toContain('uniform sampler2D uPsHist');
    expect(b.src).toContain('uPsKeep');
    expect(fnBuildFinal([still]).src).not.toContain('uPsHist');
    // The empty last pass only reads the one before (and draws the wipe).
    const last = fnBuildFinal([trail], { segment: 1 });
    expect(last.src).toContain('uniform sampler2D uStage');
    expect(last.psTrail).toBe(false);
  });
});

describe('ASCII typed characters', () => {
  it('shares the Glyphs layer’s sets: Classic is its default ramp, Moon its emoji hint', () => {
    expect(GY_SETS.find(s => s.name === 'Classic')!.chars).toBe((defaultLayer('glyphs', 'g', 'G') as unknown as { chars: string }).chars);
    expect(GY_SETS.find(s => s.name === 'Moon')!.chars).toBe('🌑🌒🌓🌔🌕');
    expect(new Set(GY_SETS.map(s => s.name)).size).toBe(GY_SETS.length);
  });

  it('keeps emoji whole when it splits a ramp', () => {
    expect(gyList('🌑🌒 a')).toEqual(['🌑', '🌒', ' ', 'a']);
    expect(gyList('❤️👍🏽')).toEqual(['❤️', '👍🏽']);
  });

  it('orders glyphs by how much of their cell they cover, or as typed', () => {
    // Three 2 × 2 cells side by side: full white, empty, half grey.
    const w = 6, data = new Uint8Array(w * 2 * 4);
    const px = (x: number, y: number, v: number, a: number) => { const k = (y * w + x) * 4; data[k] = data[k + 1] = data[k + 2] = v; data[k + 3] = a; };
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) px(x, y, 255, 255);
    for (const [x, y] of [[4, 0], [5, 0], [4, 1], [5, 1]]) px(x, y, 128, 255);
    const cov = gyCoverage(data, w, 3, 2, 3);
    expect(cov[0]).toBeCloseTo(1, 3);
    expect(cov[1]).toBe(0);
    expect(cov[2]).toBeCloseTo(128 / 255, 3);
    expect(gyOrder(cov, false)).toEqual([1, 2, 0]);
    expect(gyOrder(cov, true)).toEqual([0, 1, 2]);
    // Equal coverage keeps the typed order.
    expect(gyOrder([0.5, 0.2, 0.5], false)).toEqual([1, 0, 2]);
  });

  it('keeps its characters and order in the record; none (an older ASCII) draws the built-in ones', () => {
    const e = parseFinishEffect({ id: 'a', kind: 'ascii', chars: '🌑🌒🌓🌔🌕', keepOrder: true, own: 1 })!;
    expect(e.chars).toBe('🌑🌒🌓🌔🌕');
    expect(e.keepOrder).toBe(true);
    expect(e.own).toBe(1);
    const old = parseFinishEffect({ id: 'a', kind: 'ascii', size: 12 })!;
    expect(old.chars).toBe('');
    expect(old.keepOrder).toBe(false);
    expect(old.own).toBe(0);
    expect(fnAsciiTyped(old)).toBe(false);
    expect(fnAsciiTyped(e)).toBe(true);
    // A long paste is cut to the atlas's size, whole characters only.
    expect(gyList(parseFinishEffect({ id: 'a', kind: 'ascii', chars: '🌕'.repeat(200) })!.chars as string).length).toBe(96);
  });

  it('draws typed characters from an atlas, the built-in ones from their bitmaps', () => {
    const typed = fnBuildFinal([fx('grade'), fx('ascii', { chars: ' .:-=+*#%@' })], { segment: 1 });
    expect(typed.ascAtlas).toBe(true);
    expect(typed.src).toContain('uniform sampler2D uAscAtlas');
    expect(typed.src).toContain('ascii_own');
    expect(typed.src).not.toContain('FN_GLYPHS');
    const built = fnBuildFinal([fx('grade'), fx('ascii')], { segment: 1 });
    expect(built.ascAtlas).toBe(false);
    expect(built.src).toContain('FN_GLYPHS');
  });
});

describe('Look actions in the kit', () => {
  const id = 'finish:m';
  it('Mosh holds for its seconds, then lets go', () => {
    const st = fnLookNew();
    fnLookStep(st, 1);
    expect(fnLookAct(st, { do: 'mosh', layerId: id, seconds: 2 }, 1)).toBe(true);
    expect(fnLookValue(st, id, 'hold')).toBe(1);
    fnLookStep(st, 2.9);
    expect(fnLookValue(st, id, 'hold')).toBe(1);
    fnLookStep(st, 3);
    expect(fnLookValue(st, id, 'hold')).toBeUndefined();
  });

  it('Reset mosh is one frame of Reset, and ends a Mosh an action started', () => {
    const st = fnLookNew();
    fnLookAct(st, { do: 'mosh', layerId: id, seconds: 5 }, 0);
    fnLookStep(st, 1 / 60);
    fnLookAct(st, { do: 'moshreset', layerId: id }, 1 / 60);
    expect(fnLookValue(st, id, 'reset')).toBe(1);
    expect(fnLookValue(st, id, 'hold')).toBeUndefined();
    fnLookStep(st, 2 / 60);
    expect(fnLookValue(st, id, 'reset')).toBeUndefined();
  });

  it('a pulse sets a value for its seconds and puts it back; a set stays until the clock goes back', () => {
    const st = fnLookNew();
    fnLookAct(st, { do: 'fxpulse', layerId: 'finish:g', key: 'amount', value: 0.9, seconds: 0.5 }, 10);
    fnLookAct(st, { do: 'fxset', layerId: 'finish:f', key: 'trail', value: 0.99 }, 10);
    expect(fnLookValue(st, 'finish:g', 'amount')).toBe(0.9);
    fnLookStep(st, 10.5);
    expect(fnLookValue(st, 'finish:g', 'amount')).toBeUndefined();
    fnLookStep(st, 100);
    expect(fnLookValue(st, 'finish:f', 'trail')).toBe(0.99);
    // Sent back (a render's first frame, a rewind): everything goes.
    fnLookStep(st, 0);
    expect(fnLookValue(st, 'finish:f', 'trail')).toBeUndefined();
    fnLookAct(st, { do: 'fxset', layerId: 'finish:f', key: 'trail', value: 0.5 }, 0);
    fnLookReset(st);
    expect(st.entries.size).toBe(0);
  });

  it('ignores other actions and Look actions without what they need', () => {
    const st = fnLookNew();
    expect(fnLookAct(st, { do: 'burst', layerId: 'p' }, 0)).toBe(false);
    expect(fnLookAct(st, { do: 'fxpulse', layerId: 'finish:g', key: 'amount' }, 0)).toBe(true);
    expect(st.entries.size).toBe(0);
    expect([...FN_LOOK_ACTIONS]).toEqual(['mosh', 'moshreset', 'fxpulse', 'fxset']);
  });

  it('plays the same way twice from the same clock (a render)', () => {
    const run = () => {
      const st = fnLookNew(), out: Array<number | undefined> = [];
      for (let f = 0; f < 120; f++) {
        const t = f / 30;
        fnLookStep(st, t);
        if (f === 10) fnLookAct(st, { do: 'fxpulse', layerId: 'finish:g', key: 'amount', value: 1, seconds: 1 }, t);
        if (f === 50) fnLookAct(st, { do: 'mosh', layerId: 'finish:m', seconds: 0.5 }, t);
        out.push(fnLookValue(st, 'finish:g', 'amount'), fnLookValue(st, 'finish:m', 'hold'));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

const lookRecord = (): PlayRecord => {
  const src: PlayControl = { id: 'src', target: 'n::src', kind: 'float', label: 'src', min: 0, max: 1 };
  return {
    ...emptyPlayRecord(), controls: [src],
    finish: { on: true, effects: [fx('datamosh', { id: 'm' }) as never, fx('glitch', { id: 'g', amount: 0 }) as never] },
    signals: [{
      id: 'go', name: 'Go',
      inputs: [{ kind: 'trigger', trigger: { on: 'value', value: 'ctl:src', cmp: 'crossUp', threshold: 0.5, hysteresis: 0, tolerance: 0 } }],
      do: [
        { id: 'r1', do: 'mosh', layerId: 'finish:m', amount: 1, enabled: true, seconds: 1 },
        { id: 'r2', do: 'fxpulse', layerId: 'finish:g', key: 'amount', value: 0.8, seconds: 0.5, amount: 1, enabled: true },
      ],
    }],
  };
};

describe('Look actions in the record, the engine and the Do menu', () => {
  it('keeps a Look reaction’s setting, value and seconds; drops one whose effect is gone', () => {
    const rec = parsePlayRecord(JSON.parse(JSON.stringify(lookRecord())));
    const s = rec.signals!.find(x => x.id === 'go')!;
    expect(s.do).toEqual([
      expect.objectContaining({ do: 'mosh', layerId: 'finish:m', seconds: 1 }),
      expect.objectContaining({ do: 'fxpulse', layerId: 'finish:g', key: 'amount', value: 0.8, seconds: 0.5 }),
    ]);
    const gone = parsePlayRecord({ ...JSON.parse(JSON.stringify(lookRecord())), finish: { on: true, effects: [fx('datamosh', { id: 'm' })] } });
    expect(gone.signals!.find(x => x.id === 'go')!.do!.map(r => r.do)).toEqual(['mosh']);
    // The action runner gets them with their fields.
    expect(sgReactions(rec.signals!).find(a => a.id === 'r2')).toEqual(expect.objectContaining({ key: 'amount', value: 0.8, seconds: 0.5 }));
  });

  it('a take keeps a Look action’s fields', () => {
    const t = parseTake({ id: 't', name: 'T', from: 0, length: 2, tracks: [], events: [{ t: 0.5, do: 'fxpulse', layerId: 'finish:g', amount: 1, key: 'amount', value: 0.8, seconds: 0.5 }, { t: 1, do: 'mosh', layerId: 'finish:m', amount: 1, seconds: 2 }] });
    expect(t!.events).toEqual([
      expect.objectContaining({ do: 'fxpulse', key: 'amount', value: 0.8, seconds: 0.5 }),
      expect.objectContaining({ do: 'mosh', seconds: 2 }),
    ]);
  });

  it('fires live through the engine: the effect’s numbers change through layerValue, then come back', () => {
    playEngine.setRecord(lookRecord());
    let t = 100;
    const step = (v: number) => { playEngine.setBaseValues(new Map([['src', v]])); inputBus.tick(0.1, (t += 0.1)); };
    step(0);
    expect(playEngine.layerValue('finish:m', 'hold', 0)).toBe(0);
    step(1);
    expect(playEngine.layerValue('finish:m', 'hold', 0)).toBe(1);
    expect(playEngine.layerValue('finish:g', 'amount', 0)).toBe(0.8);
    for (let i = 0; i < 6; i++) step(1);
    expect(playEngine.layerValue('finish:g', 'amount', 0)).toBe(0);
    expect(playEngine.layerValue('finish:m', 'hold', 0)).toBe(1);
    for (let i = 0; i < 6; i++) step(1);
    expect(playEngine.layerValue('finish:m', 'hold', 0)).toBe(0);
    // A render keeps its own: layerValueNoLooks never sees the live ones.
    step(0); step(1);
    expect(playEngine.layerValueNoLooks('finish:m', 'hold', 0)).toBe(0);
  });

  it('offers Mosh and Reset mosh for Datamosh and a pulse or set for every effect, in words', () => {
    const play = lookRecord();
    const looks = doChoices(play).filter(c => c.layerId.startsWith('finish:')).map(c => c.label);
    expect(looks).toEqual(['Mosh · Datamosh', 'Reset mosh · Datamosh', 'Pulse a setting · Datamosh', 'Set a setting · Datamosh', 'Pulse a setting · Glitch', 'Set a setting · Glitch']);
    expect(lookDefaults('mosh', 'finish:m', play)).toEqual({ seconds: 2 });
    expect(lookDefaults('fxpulse', 'finish:g', play)).toEqual({ key: 'amount', value: 1, seconds: 1 });
    expect(lookDefaults('fxset', 'finish:g', play)).toEqual({ key: 'amount', value: 1 });
    const [r1, r2] = play.signals![0].do!;
    expect(reactionText(r1, play)).toBe('Mosh 1 s · Datamosh');
    expect(reactionText(r2, play)).toBe('Pulse Amount to 0.8 for 0.5 s · Glitch');
    expect(reactionText({ id: 'x', do: 'moshreset', layerId: 'finish:m', amount: 1, enabled: true }, play)).toBe('Reset mosh · Datamosh');
  });
});

describe('the exported kit and runtime', () => {
  it('carry the glyph sets, the atlas and the Look actions', () => {
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { finish: { looks: { create(): unknown; act(s: unknown, a: unknown, t: number): boolean; step(s: unknown, t: number): void; value(s: unknown, id: string, k: string): number | undefined; is(k: string): boolean } } };
    const L = SSKit.finish.looks;
    const st = L.create();
    expect(L.is('mosh')).toBe(true);
    L.act(st, { do: 'fxpulse', layerId: 'finish:g', key: 'amount', value: 0.7, seconds: 1 }, 0);
    expect(L.value(st, 'finish:g', 'amount')).toBe(0.7);
    L.step(st, 2);
    expect(L.value(st, 'finish:g', 'amount')).toBeUndefined();
    expect(kitScript()).toContain('function gyAtlas(');
    // The runtime reads them before its mappings' values, and fires them instead of handing them to the layer kit.
    expect(runtimeSource).toContain('LK.value(looks, id, key)');
    expect(runtimeSource).toContain('LK.act(looks, a, time)');
    expect(runtimeSource).toContain('LK.step(looks, time)');
  });
});
