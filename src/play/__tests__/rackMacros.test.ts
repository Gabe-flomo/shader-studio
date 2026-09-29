/**
 * Rack macros (docs/audio-engine.md, "Macros"): the curve and range maths
 * (each curve, inversion, custom breakpoints joined monotonically), the
 * fan-out to targets (by hand into the record, and driven through the host's
 * valueOf), Move to macro / Detach as a control, presets carrying macros,
 * the migration of racks from before macros, and the macro as a target the
 * tape, takes and renders understand.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  g.addEventListener = () => undefined;
  g.removeEventListener = () => undefined;
});

import { mcCurve, mcTargetValue } from '../kit/macros.js';
import {
  AE_INST, RACK_MACROS, auPropId, auTarget, controlsKeptFor, fourCC, macroPropId, macroTarget, newRack, parseAudioEngine, parseMacroPoints, parseMacroTarget,
  rackMacros, rackTargetProp, readRackTargetValue, type AeRack, type PlayAudioEngine,
} from '../../types/playAudioEngine';
import { emptyPlayRecord, parsePlayRecord, parsePropTarget, type PlayRecord } from '../../types/play';
import { parseArrangement } from '../../types/playArrangement';
import {
  addMacroTarget, detachMacroTarget, ensureMacroControl, macroControl, macroParamTargets, macroValueAt, macroValueOf, moveControlToMacro, patchMacro, patchMacroTarget,
  removeMacroTarget, setMacroValue,
} from '../rackMacros';
import { addRackControl, rackControlsOf, rackControlTargets, regroupRackControls } from '../rackControls';
import { applyRackPreset, parseRackPreset, rackPresetFrom, rackPresetSummary } from '../rackPresets';
import { withEngine } from '../../components/play/engine/engineOps';
import { jobParams } from '../../lib/engineRender';
import { encodeKeys } from '../../lib/takePlayback';
import { tapeControlTracks } from '../../lib/tapeTake';
import { readControlValue } from '../playControls';

const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const DELAY = { type: fourCC('aufx'), subtype: fourCC('dely'), manufacturer: fourCC('appl'), name: 'AUDelay', vendor: 'Apple' };
const POSITION = '1', DENSITY = '5';

function granRack(): AeRack {
  return { ...newRack('rk1', []), name: 'Clouds', instrument: { id: AE_INST, kind: 'granulator', sample: { synth: 'pad', name: 'Pad chord' }, params: {} }, effects: [{ id: 'fx1', kind: 'au', unit: DELAY, params: { 3: 0.5 } }] };
}
function setup(): PlayRecord {
  return { ...emptyPlayRecord(), audioEngine: { racks: [granRack()] } };
}
const pos = { slot: AE_INST, address: POSITION, name: 'Position', lo: 0, hi: 1 };
const dens = { slot: AE_INST, address: DENSITY, name: 'Density', lo: 1, hi: 200 };
const rackOf = (p: PlayRecord) => p.audioEngine!.racks[0];
const paramOf = (p: PlayRecord, slot: string, a: string) => (slot === AE_INST ? rackOf(p).instrument!.params?.[a] : rackOf(p).effects.find(e => e.id === slot)!.params?.[a]);

describe('the curves and ranges', () => {
  it('shapes 0..1 as each curve says', () => {
    for (const c of ['linear', 'exp', 'log', 'scurve', 'custom']) { near(mcCurve(0, c), 0); near(mcCurve(1, c), 1); }
    near(mcCurve(0.25, 'linear'), 0.25);
    near(mcCurve(0.5, 'exp'), 0.25);
    near(mcCurve(0.25, 'log'), 0.5);
    near(mcCurve(0.5, 'scurve'), 0.5);
    near(mcCurve(0.25, 'scurve'), 0.15625);
    expect(mcCurve(0.9, 'scurve')).toBeGreaterThan(0.9);
    // Out of range and nonsense are held to the ends.
    near(mcCurve(-1, 'linear'), 0); near(mcCurve(2, 'exp'), 1); near(mcCurve(Number.NaN, 'log'), 0);
  });

  it('maps through the range, and a range the wrong way round inverts it', () => {
    near(mcTargetValue(0.5, { min: 0.2, max: 0.8, curve: 'exp' }), 0.35);
    near(mcTargetValue(0, { min: 200, max: 1, curve: 'linear' }), 200);
    near(mcTargetValue(1, { min: 200, max: 1, curve: 'linear' }), 1);
    near(mcTargetValue(0.5, { min: 200, max: 1, curve: 'linear' }), 100.5);
    // Beyond the parameter's own range is kept (typing past the max widens it).
    near(mcTargetValue(1, { min: 0, max: 3, curve: 'linear' }), 3);
  });

  it('custom breakpoints: through each point, monotone between them, flat past the ends', () => {
    const pts = [0.1, 0.2, 0.4, 0.3, 0.6, 0.9, 0.9, 1];
    for (let i = 0; i < pts.length; i += 2) near(mcCurve(pts[i], 'custom', pts), pts[i + 1], 1e-9);
    near(mcCurve(0, 'custom', pts), 0.2); near(mcCurve(1, 'custom', pts), 1);
    let last = -1;
    for (let x = 0; x <= 1.0001; x += 0.005) { const y = mcCurve(x, 'custom', pts); expect(y).toBeGreaterThanOrEqual(last - 1e-12); last = y; }
    // A step: never overshoots its neighbours (the monotone cubic).
    const step = [0, 0, 0.45, 0, 0.55, 1, 1, 1];
    for (let x = 0; x <= 1; x += 0.01) { const y = mcCurve(x, 'custom', step); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1); }
    for (let x = 0; x <= 0.45; x += 0.01) near(mcCurve(x, 'custom', step), 0);
    // Falling points fall monotonically too.
    const down = [0, 1, 0.5, 0.7, 1, 0];
    let prev = 2;
    for (let x = 0; x <= 1; x += 0.01) { const y = mcCurve(x, 'custom', down); expect(y).toBeLessThanOrEqual(prev + 1e-12); prev = y; }
    // Fewer than two points: straight.
    near(mcCurve(0.3, 'custom', [0.5, 0.5]), 0.3);
  });

  it('parses breakpoints: sorted, clamped, at most 16, at least 2', () => {
    expect(parseMacroPoints([0.9, 1, 0.1, -2, 'x', 3])).toEqual([0.1, 0, 0.9, 1]);
    expect(parseMacroPoints([0.5, 0.5])).toBeUndefined();
    expect(parseMacroPoints(Array.from({ length: 40 }, (_, i) => i / 40))!.length).toBe(32);
  });
});

describe('the record: targets and fan-out', () => {
  it('a new rack has 8 empty macros; macro targets parse and read', () => {
    const r = newRack('rk9', []);
    expect(rackMacros(r).map(m => [m.id, m.name, m.value, m.targets.length])).toEqual(Array.from({ length: RACK_MACROS }, (_, i) => [`m${i + 1}`, `Macro ${i + 1}`, 0, 0]));
    expect(parseMacroTarget(macroTarget('rk1', 3))).toEqual({ rackId: 'rk1', n: 3 });
    for (const bad of ['macro:rk1::0', 'macro:rk1::9', 'macro:rk1::03', 'macro:::1', 'au:rk1:inst::1']) expect(parseMacroTarget(bad)).toBeNull();
    expect(parsePropTarget(macroTarget('rk1', 3))).toEqual({ layerId: macroPropId('rk1'), key: '3' });
    expect(rackTargetProp(macroTarget('rk1', 3))).toEqual({ id: 'macro:rk1', key: '3' });
    expect(rackTargetProp(auTarget('rk1', 'fx1', '3'))).toEqual({ id: auPropId('rk1', 'fx1'), key: '3' });
  });

  it('turning a macro writes every target through its curve and range, in one step', () => {
    let p = setup();
    p = addMacroTarget(p, 'rk1', 1, pos, { min: 0.2, max: 0.8, curve: 'exp' });
    p = addMacroTarget(p, 'rk1', 1, dens);
    p = patchMacroTarget(p, 'rk1', 1, 1, { min: 200, max: 1 });
    // The macro's Play control came with the first target: "Clouds · Macro 1" in "Clouds · Macros", 0..1.
    const c = macroControl(p, 'rk1', 1)!;
    expect(c).toMatchObject({ target: macroTarget('rk1', 1), label: 'Clouds · Macro 1', group: 'Clouds · Macros', min: 0, max: 1 });
    expect(p.controls.filter(x => x.target === c.target)).toHaveLength(1);
    p = setMacroValue(p, 'rk1', 1, 0.5);
    near(paramOf(p, AE_INST, POSITION)!, 0.35);
    near(paramOf(p, AE_INST, DENSITY)!, 100.5);
    expect(readRackTargetValue(p.audioEngine, c.target)).toBe(0.5);
    expect(readControlValue([], c.target, p)).toBe(0.5);
    p = setMacroValue(p, 'rk1', 1, 7); // held to 0..1
    near(paramOf(p, AE_INST, POSITION)!, 0.8); near(paramOf(p, AE_INST, DENSITY)!, 1);
    // A target's range or curve changed: the parameter follows at once.
    p = patchMacroTarget(p, 'rk1', 1, 0, { curve: 'linear', min: 0, max: 0.5 });
    near(paramOf(p, AE_INST, POSITION)!, 0.5);
    p = patchMacroTarget(p, 'rk1', 1, 0, { curve: 'custom' });
    expect(rackMacros(rackOf(p))[0].targets[0].points).toEqual([0, 0, 0.5, 0.5, 1, 1]);
    // No duplicates; the sample player and unknown granulator settings can't be targets.
    expect(addMacroTarget(p, 'rk1', 1, pos)).toBe(p);
    expect(addMacroTarget(p, 'rk1', 2, { ...pos, address: '999' })).toBe(p);
    // Removing a target leaves the parameter where it is.
    const before = paramOf(p, AE_INST, DENSITY);
    p = removeMacroTarget(p, 'rk1', 1, 1);
    expect(rackMacros(rackOf(p))[0].targets.map(t => t.address)).toEqual([POSITION]);
    expect(paramOf(p, AE_INST, DENSITY)).toBe(before);
  });

  it('a driven macro (a mapping, the tape) fans out through the host’s valueOf; undriven reads as before', () => {
    let p = setup();
    p = addMacroTarget(p, 'rk1', 1, pos, { min: 0.2, max: 0.8, curve: 'exp' });
    p = addMacroTarget(p, 'rk1', 1, { slot: 'fx1', address: '3', name: 'Mix', lo: 0, hi: 1 }, { min: 1, max: 0 });
    const driven = new Map<string, number>();
    const base = (id: string, key: string, b: number) => driven.get(`${id}/${key}`) ?? b;
    const vo = macroValueOf(p.audioEngine, base);
    // Not driven: the record (or a rack control's own mapping) as before.
    expect(vo(auPropId('rk1', AE_INST), POSITION, Number.NaN)).toBeNaN();
    driven.set(`${auPropId('rk1', 'fx1')}/3`, 0.33);
    expect(vo(auPropId('rk1', 'fx1'), '3', Number.NaN)).toBe(0.33);
    // Driven: the macro wins, through each target.
    driven.set(`${macroPropId('rk1')}/1`, 1);
    near(vo(auPropId('rk1', AE_INST), POSITION, Number.NaN), 0.8);
    near(vo(auPropId('rk1', 'fx1'), '3', Number.NaN), 0);
    driven.set(`${macroPropId('rk1')}/1`, 0.5);
    near(vo(auPropId('rk1', AE_INST), POSITION, Number.NaN), 0.35);
    near(vo(auPropId('rk1', 'fx1'), '3', Number.NaN), 0.5);
    // Other parameters pass straight through.
    expect(vo(auPropId('rk1', AE_INST), '6', 3)).toBe(3);
    // The host drives every parameter a macro turns, once each.
    expect(macroParamTargets(p.audioEngine)).toEqual([{ rackId: 'rk1', slotId: AE_INST, address: POSITION }, { rackId: 'rk1', slotId: 'fx1', address: '3' }]);
    // With no macro targets at all, valueOf is handed back as it is.
    expect(macroValueOf(setup().audioEngine, base)).toBe(base);
  });

  it('renders: a take’s macro track turns the settings (valueAt) and the native job’s parameters', () => {
    let p = setup();
    p = addMacroTarget(p, 'rk1', 2, { slot: 'fx1', address: '3', name: 'Mix', lo: 0, hi: 1 }, { min: 0.2, max: 0.6 });
    p = addMacroTarget(p, 'rk1', 2, pos);
    const target = macroTarget('rk1', 2);
    const keys = encodeKeys([0, 1], [0, 1], 1);
    const take = { id: 't', name: 'T', from: 0, length: 1, events: [], tracks: [{ kind: 'control' as const, id: 'c', target, label: 'M', width: 1 as const, keys }] };
    const steps = jobParams(p.audioEngine!.racks, take, 0, 1);
    // Only the Audio Unit's parameter goes to the native job (the Granulator renders in Web Audio).
    expect(steps.every(s => s.slot === 'fx1' && s.address === '3')).toBe(true);
    near(steps[0].value, 0.2);
    near(steps[steps.length - 1].value, 0.6, 0.01);
    // A Granulator's settings read through the macro when a take has its track.
    const valueAt = macroValueAt(p.audioEngine, (id: string, key: string, b: number, t: number) => (id === macroPropId('rk1') && key === '2' ? t : b));
    near(valueAt(auPropId('rk1', AE_INST), POSITION, 0.3, 0.25), 0.25);
    expect(valueAt(auPropId('rk1', AE_INST), '6', 3, 0.25)).toBe(3);
  });

  it('the tape records and replays a macro like a rack control', () => {
    let p = setup();
    p = addMacroTarget(p, 'rk1', 1, pos);
    expect(rackControlTargets(p, rackOf(p))).toEqual([macroTarget('rk1', 1)]);
    const arr = parseArrangement({ length: 2, bpm: 120, loop: true, tracks: { rk1: { notes: [], auto: { [macroTarget('rk1', 1)]: [0, 0, 1, 1], 'macro:rk1::12': [0, 1] }, arm: true } } })!;
    expect(Object.keys(arr.tracks.rk1.auto)).toEqual([macroTarget('rk1', 1)]);
    const tracks = tapeControlTracks(p, arr);
    expect(tracks.map(t => [t.target, t.id])).toEqual([[macroTarget('rk1', 1), macroControl(p, 'rk1', 1)!.id]]);
  });
});

describe('rack controls and macros', () => {
  function withControl(): PlayRecord {
    let p = setup();
    p = addRackControl(p, 'rk1', 'fx1', { address: '3', name: 'Mix', min: 0, max: 1, value: 0.5 });
    const c = p.controls[0];
    p = { ...p, mappings: [{ id: 'mp', controlId: c.id, source: { kind: 'midi', signal: 'cc', channel: 0, cc: 1 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }] };
    return p;
  }

  it('Move to macro n: the control becomes a target over its range and leaves the strip', () => {
    const p = moveControlToMacro(withControl(), 'rk1', 'fx1', '3', 4);
    const r = rackOf(p);
    expect(rackControlsOf(p, r, r.effects[0])).toEqual([]);
    expect(p.controls.map(c => c.target)).toEqual([macroTarget('rk1', 4)]);
    expect(p.mappings).toEqual([]);
    expect(rackMacros(r)[3].targets).toEqual([{ slot: 'fx1', address: '3', min: 0, max: 1, curve: 'linear', name: 'Mix', lo: 0, hi: 1 }]);
    // Not a rack control: nothing happens.
    expect(moveControlToMacro(p, 'rk1', 'fx1', '3', 1)).toBe(p);
  });

  it('Detach as a control: back on its device at its value; a full device refuses', () => {
    let p = moveControlToMacro(withControl(), 'rk1', 'fx1', '3', 4);
    p = setMacroValue(p, 'rk1', 4, 0.25);
    const r = detachMacroTarget(p, 'rk1', 4, 0);
    expect(r.ok).toBe(true);
    const rack = rackOf(r.record);
    expect(rackMacros(rack)[3].targets).toEqual([]);
    expect(rackControlsOf(r.record, rack, rack.effects[0]).map(x => [x.address, x.control.label, x.control.min, x.control.max])).toEqual([['3', 'Mix', 0, 1]]);
    near(paramOf(r.record, 'fx1', '3')!, 0.25);
    // Full: 8 other controls on the delay.
    let full = moveControlToMacro(withControl(), 'rk1', 'fx1', '3', 4);
    for (let a = 10; a < 18; a++) full = addRackControl(full, 'rk1', 'fx1', { address: String(a), name: `P${a}`, min: 0, max: 1, value: 0 });
    const no = detachMacroTarget(full, 'rk1', 4, 0);
    expect(no.ok).toBe(false);
    expect(no.record).toBe(full);
  });

  it('renames follow: the macro’s control label, and the rack’s name', () => {
    let p = addMacroTarget(setup(), 'rk1', 3, pos);
    p = patchMacro(p, 'rk1', 3, { name: 'Wash', color: '#35c3a4' });
    expect(macroControl(p, 'rk1', 3)!.label).toBe('Clouds · Wash');
    expect(rackMacros(rackOf(p))[2]).toMatchObject({ name: 'Wash', color: '#35c3a4' });
    p = patchMacro(p, 'rk1', 3, { color: '' });
    expect(rackMacros(rackOf(p))[2].color).toBeUndefined();
    expect(patchMacro(p, 'rk1', 3, { name: '  ' })).toBe(p);
    p = regroupRackControls({ ...p, audioEngine: { racks: [{ ...rackOf(p), name: 'Mist' }] } });
    expect(macroControl(p, 'rk1', 3)).toMatchObject({ label: 'Mist · Wash', group: 'Mist · Macros' });
  });

  it('a removed effect takes its macro targets; a removed rack its macro controls', () => {
    let p = addMacroTarget(setup(), 'rk1', 1, { slot: 'fx1', address: '3', name: 'Mix', lo: 0, hi: 1 });
    p = addMacroTarget(p, 'rk1', 1, pos);
    p = withEngine(p, { racks: [{ ...rackOf(p), effects: [] }] });
    expect(rackMacros(rackOf(p))[0].targets.map(t => t.slot)).toEqual([AE_INST]);
    expect(controlsKeptFor(p.controls, { racks: [] })).toEqual([]);
    expect(controlsKeptFor(p.controls, p.audioEngine)).toHaveLength(1);
    // Ensuring a control twice keeps one.
    expect(ensureMacroControl(p, 'rk1', 1).play).toBe(p);
  });
});

describe('files, presets and migration', () => {
  it('a rack from before macros reads as 8 empty ones; a saved one keeps its own, bad targets dropped', () => {
    const old = parseAudioEngine({ racks: [{ id: 'rk1', name: 'Old', instrument: { kind: 'sampler', zones: [] }, effects: [] }] })!;
    expect(old.racks[0].macros).toBeUndefined();
    expect(rackMacros(old.racks[0])).toHaveLength(RACK_MACROS);
    expect(rackMacros(old.racks[0]).every(m => !m.targets.length && m.value === 0)).toBe(true);
    const raw = {
      racks: [{
        id: 'rk1', name: 'Clouds', instrument: { kind: 'granulator', params: {} }, effects: [{ id: 'fx1', kind: 'au', unit: DELAY }],
        macros: [
          { name: 'Wash', value: 1.7, color: 'red', targets: [
            { slot: 'inst', address: POSITION, min: 0.2, max: 0.8, curve: 'exp' },
            { slot: 'inst', address: POSITION, min: 0, max: 1, curve: 'linear' },
            { slot: 'inst', address: '999', min: 0, max: 1 },
            { slot: 'fx9', address: '3', min: 0, max: 1 },
            { slot: 'fx1', address: '3', min: 1, max: 0, curve: 'custom', points: [1, 1, 0, 0] },
            { slot: 'fx1', address: '4', min: 0, max: 1, curve: 'custom', points: [0.5] },
            { slot: 'fx1', address: '5', curve: 'wobbly' },
          ] },
        ],
      }],
    };
    const ae = parseAudioEngine(raw)!;
    const ms = rackMacros(ae.racks[0]);
    expect(ae.racks[0].macros).toHaveLength(RACK_MACROS);
    expect(ms[0]).toMatchObject({ id: 'm1', name: 'Wash', value: 1 });
    expect(ms[0].color).toBeUndefined();
    expect(ms[0].targets.map(t => [t.slot, t.address, t.curve, t.min, t.max, t.points ?? null])).toEqual([
      ['inst', POSITION, 'exp', 0.2, 0.8, null],
      ['fx1', '3', 'custom', 1, 0, [0, 0, 1, 1]],
      ['fx1', '4', 'linear', 0, 1, null],
      ['fx1', '5', 'linear', 0, 1, null],
    ]);
    expect(ms[1]).toEqual({ id: 'm2', name: 'Macro 2', value: 0, targets: [] });
    // A whole record round-trips through JSON; the macro control survives, and a macro control on a gone rack doesn't.
    let p: PlayRecord = { ...emptyPlayRecord(), audioEngine: ae };
    p = ensureMacroControl(p, 'rk1', 1).play;
    p = { ...p, controls: [...p.controls, { id: 'x', target: macroTarget('gone', 1), kind: 'float', label: 'Gone', min: 0, max: 1 }] };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(p)));
    expect(back.controls.map(c => c.target)).toEqual([macroTarget('rk1', 1)]);
    expect(rackMacros(back.audioEngine!.racks[0])).toEqual(ms);
  });

  it('a rack preset keeps its macros, moved onto the new rack’s effects; no mappings come', () => {
    let p = addMacroTarget(setup(), 'rk1', 1, { slot: 'fx1', address: '3', name: 'Mix', lo: 0, hi: 1 }, { min: 0.1, max: 0.9, curve: 'scurve' });
    p = addMacroTarget(p, 'rk1', 1, pos);
    p = patchMacro(p, 'rk1', 1, { name: 'Wash', color: '#35c3a4' });
    p = setMacroValue(p, 'rk1', 1, 0.75);
    const c = macroControl(p, 'rk1', 1)!;
    p = { ...p, mappings: [{ id: 'mp', controlId: c.id, source: { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 } as never, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }] };
    const { preset, left } = rackPresetFrom(p, 'rk1', 'Wash pad', {}, 'rp1');
    expect(left).toContain('1 mapping onto its controls');
    const saved = parseRackPreset(JSON.parse(JSON.stringify(preset)))!;
    expect(rackPresetSummary(saved)).toBe('Granulator · 1 effect · 1 macro');
    let n = 0;
    const res = applyRackPreset(setup(), saved, { newId: k => `${k}_n${++n}` });
    const rack = res.play.audioEngine!.racks.find(r => r.id === res.rackId)!;
    const fxId = rack.effects[0].id;
    expect(fxId).not.toBe('fx1');
    const m = rackMacros(rack)[0];
    expect(m).toMatchObject({ name: 'Wash', color: '#35c3a4', value: 0.75 });
    expect(m.targets.map(t => [t.slot, t.address, t.curve, t.min, t.max])).toEqual([[fxId, '3', 'scurve', 0.1, 0.9], [AE_INST, POSITION, 'linear', 0, 1]]);
    expect(macroControl(res.play, res.rackId, 1)).toMatchObject({ label: `${rack.name} · Wash`, group: `${rack.name} · Macros` });
    expect(res.play.mappings).toEqual([]);
    // The values came too: the parameters sit where the macro put them.
    near(rack.instrument!.params![POSITION], 0.75);
    // Replacing a rack's devices with it: the old rack's macro control goes, the preset's comes.
    const rep = applyRackPreset(p, saved, { replace: 'rk1', newId: k => `${k}_r${++n}` });
    expect(rep.play.controls.filter(x => x.target === macroTarget('rk1', 1))).toHaveLength(1);
    expect(rep.play.controls.find(x => x.target === macroTarget('rk1', 1))!.id).not.toBe(c.id);
    expect(rep.play.mappings).toEqual([]);
  });

  it('the engine type keeps macros optional (a record built in code without them works)', () => {
    const ae: PlayAudioEngine = { racks: [{ id: 'r', name: 'R', instrument: null, effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false }] };
    expect(macroParamTargets(ae)).toEqual([]);
    expect(setMacroValue({ ...emptyPlayRecord(), audioEngine: ae }, 'r', 2, 0.5).audioEngine!.racks[0].macros![1].value).toBe(0.5);
  });
});
