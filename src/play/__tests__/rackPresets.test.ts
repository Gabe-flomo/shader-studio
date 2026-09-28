/**
 * Rack presets (docs/presets.md): a rack captured without its wiring (no
 * mappings, tape, Grains from, drum pad follow), added back as a new rack or
 * put on an existing one, a missing Audio Unit named and the rest loaded,
 * the Listener, a Granulator's Sound effects (and on the master chain), the
 * list in storage, and the Files page listing.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  g.addEventListener = () => undefined;
  g.removeEventListener = () => undefined;
});

import { applyRackPreset, loadRackPresets, parseRackPreset, presetSoundOnMaster, rackPresetFrom, rackPresetSummary, saveRackPreset, deleteRackPreset, RACK_PRESETS_KEY, type ListKV } from '../rackPresets';
import { emptyPlayRecord, type PlayRecord } from '../../types/play';
import { AE_INST, auTarget, fourCC, parseAuTarget, type AeRack } from '../../types/playAudioEngine';
import { afNewEffect } from '../kit/audioFx.js';
import { buildInventory } from '../../files/inventory';
import { memoryKV } from '../../files/mutate';

function mapKV(): ListKV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}

const unit = (name: string, type = 'aufx', sub = 'dely') => ({ type: fourCC(type), subtype: fourCC(sub), manufacturer: fourCC('appl'), name, vendor: 'Apple' });

function setup(): PlayRecord {
  const synth: AeRack = {
    id: 'rk1', name: 'Juno', keyboard: true, midi: 'Keystep', channel: 2, volume: 0.8, mute: true, color: '#ff8800', pads: 'drums',
    instrument: { id: AE_INST, kind: 'au', unit: unit('Juno-60', 'aumu', 'juno'), params: { 7: 0.4 }, state: 'QUJD', controls: ['7'] },
    effects: [
      { id: 'fx1', kind: 'au', unit: unit('AUDelay'), params: { 1: 0.3 }, bypass: true, controls: ['1'] },
      { id: 'fx2', kind: 'au', unit: unit('Vintage Verb', 'aufx', 'vvrb') },
    ],
  };
  const grains: AeRack = {
    id: 'rk2', name: 'Grains', keyboard: false, midi: '', channel: 0, volume: 1, mute: false,
    instrument: { id: AE_INST, kind: 'granulator', sample: { synth: 'pad', name: 'Pad chord' }, params: { 3: 80, 1: 0.6 }, controls: ['3'], from: { source: 'parts', boundary: '', births: true, links: [] } },
    effects: [],
  };
  return {
    ...emptyPlayRecord(),
    controls: [
      { id: 'c1', target: auTarget('rk1', AE_INST, '7'), kind: 'float', label: 'Cutoff', min: 0, max: 1, group: 'Juno · Juno-60' },
      { id: 'c2', target: auTarget('rk1', 'fx1', '1'), kind: 'float', label: 'Feedback', min: 0, max: 1, group: 'Juno · AUDelay' },
      { id: 'c3', target: auTarget('rk2', AE_INST, '3'), kind: 'float', label: 'Grain size', min: 2, max: 2000, step: 1, group: 'Grains · Granulator' },
    ],
    mappings: [{ id: 'm1', controlId: 'c1', source: { kind: 'midi', signal: 'cc', channel: 0, cc: 74 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    audioEngine: { racks: [synth, grains], listenAt: 1 },
    audioReaders: { input: 'engine:rk1', readers: [] },
    audioFx: { chains: { 'rack:rk2': { on: true, effects: [afNewEffect('reverb', 'fx_verb')] } } },
    arrangement: { bpm: 120, length: 4, loop: true, tracks: { rk1: { notes: [{ t: 0, d: 0.5, n: 60, v: 1 }], auto: {}, arm: true } } } as unknown as PlayRecord['arrangement'],
  };
}

let n = 0;
const newId = (k: string) => `${k}_t${++n}`;

describe('rack presets: capture', () => {
  it('keeps the devices, their state and the rack controls, and none of the wiring', () => {
    const { preset, left } = rackPresetFrom(setup(), 'rk1', 'Juno pad', { fx2: 'WFla' }, 'rp1');
    expect(preset).not.toBeNull();
    const r = preset!.rack;
    expect(r.instrument).toMatchObject({ kind: 'au', state: 'QUJD', params: { 7: 0.4 }, controls: ['7'] });
    expect(r.effects.map(e => [e.id, e.bypass ?? false, e.state ?? ''])).toEqual([['fx1', true, ''], ['fx2', false, 'WFla']]);
    expect(r).toMatchObject({ midi: 'Keystep', channel: 2, volume: 0.8, mute: false, keyboard: false, color: '#ff8800' });
    expect(r.pads).toBeUndefined();
    expect(preset!.controls).toEqual([{ slot: AE_INST, address: '7', label: 'Cutoff', min: 0, max: 1 }, { slot: 'fx1', address: '1', label: 'Feedback', min: 0, max: 1 }]);
    expect(preset!.listener).toEqual({ at: 1 });
    expect(left).toEqual(['the drum pad layer it follows', '1 mapping onto its controls', 'its clips on the tape']);
    expect(rackPresetSummary(preset!)).toBe('Juno-60 · 2 effects · 2 controls');
  });

  it('a Granulator keeps its sample, settings and Sound effects, not its Grains from', () => {
    const { preset, left } = rackPresetFrom(setup(), 'rk2', 'Clouds');
    expect(preset!.rack.instrument).toMatchObject({ kind: 'granulator', sample: { synth: 'pad' }, params: { 3: 80, 1: 0.6 } });
    expect(preset!.rack.instrument?.from).toBeUndefined();
    expect(preset!.soundFx?.effects.map(e => e.kind)).toEqual(['reverb']);
    expect(left).toContain('Grains from a layer (it names the setup’s layers)');
  });
});

describe('rack presets: apply', () => {
  it('adds a rack with fresh ids, its controls in their groups, no mappings, the Listener', () => {
    const { preset } = rackPresetFrom(setup(), 'rk1', 'Juno pad');
    const start: PlayRecord = { ...emptyPlayRecord(), controls: [{ id: 'mine', target: 'n1::x', kind: 'float', label: 'Cutoff', min: 0, max: 1 }] };
    const res = applyRackPreset(start, preset!, { newId });
    expect(res.missing).toEqual([]);
    const rack = res.play.audioEngine!.racks[0];
    expect(rack.id).toBe(res.rackId);
    expect(rack.name).toBe('Juno pad');
    expect(rack.effects.map(e => e.unit?.name)).toEqual(['AUDelay', 'Vintage Verb']);
    expect(rack.effects[0].id).not.toBe('fx1');
    expect(rack.effects[0].bypass).toBe(true);
    const ctls = res.play.controls.filter(c => parseAuTarget(c.target)?.rackId === rack.id);
    expect(ctls.map(c => [c.label, c.target, c.group])).toEqual([
      ['Cutoff (2)', auTarget(rack.id, AE_INST, '7'), 'Juno pad · Juno-60'],
      ['Feedback', auTarget(rack.id, rack.effects[0].id, '1'), 'Juno pad · AUDelay'],
    ]);
    expect(res.play.mappings).toEqual([]);
    expect(res.play.audioReaders?.input).toBe(`engine:${rack.id}`);
    expect(res.play.audioEngine?.listenAt).toBe(1);
    expect(res.play.arrangement).toBeUndefined();
  });

  it('leaves out an Audio Unit this computer doesn’t have, names it, and loads the rest', () => {
    const { preset } = rackPresetFrom(setup(), 'rk1', 'Juno pad');
    const res = applyRackPreset(emptyPlayRecord(), preset!, { newId, hasUnit: u => u.name !== 'Juno-60' });
    expect(res.missing).toEqual(['Juno-60']);
    expect(res.notes[0]).toBe('“Juno-60” isn’t on this computer, so it was left out');
    const rack = res.play.audioEngine!.racks[0];
    expect(rack.instrument).toBeNull();
    expect(rack.effects).toHaveLength(2);
    // The missing instrument's control didn't come; the delay's did.
    expect(res.play.controls.map(c => c.label)).toEqual(['Feedback']);
  });

  it('replaces an existing rack’s devices, keeping its name, colour and notes on the tape', () => {
    const p = setup();
    const { preset } = rackPresetFrom(p, 'rk2', 'Clouds');
    const res = applyRackPreset(p, preset!, { newId, replace: 'rk1' });
    const rack = res.play.audioEngine!.racks.find(r => r.id === 'rk1')!;
    expect(rack.name).toBe('Juno');
    expect(rack.color).toBe('#ff8800');
    expect(rack.instrument?.kind).toBe('granulator');
    expect(rack.effects).toEqual([]);
    // The old devices' controls and the mapping onto them went; the Granulator's came.
    expect(res.play.controls.filter(c => parseAuTarget(c.target)?.rackId === 'rk1').map(c => c.label)).toEqual(['Grain size (2)']);
    expect(res.play.mappings).toEqual([]);
    expect(res.notes).toContain('1 mapping onto the old devices’ controls went with them');
    expect(res.play.arrangement?.tracks.rk1.notes).toHaveLength(1);
    expect(res.play.audioFx?.chains['rack:rk1']?.effects.map(e => e.kind)).toEqual(['reverb']);
    expect(res.play.audioFx?.chains['rack:rk1']?.effects[0].id).not.toBe('fx_verb');
  });

  it('puts a preset’s Sound effects on Finish → Sound’s master chain', () => {
    const p = setup();
    const { preset } = rackPresetFrom(p, 'rk2', 'Clouds');
    const out = presetSoundOnMaster(emptyPlayRecord(), preset!);
    expect(out?.audioFx?.chains.master.effects.map(e => e.kind)).toEqual(['reverb']);
    // An Audio Unit rack has no web Sound effects to give.
    expect(presetSoundOnMaster(emptyPlayRecord(), rackPresetFrom(p, 'rk1', 'J').preset!)).toBeNull();
  });
});

describe('rack presets: storage and Files', () => {
  it('saves, reads back and deletes; lists under Presets → Racks', async () => {
    const kv = mapKV();
    const { preset } = rackPresetFrom(setup(), 'rk1', 'Juno pad', {}, 'rp1');
    expect(saveRackPreset(preset!, kv).ok).toBe(true);
    const back = loadRackPresets(kv);
    expect(back).toEqual([preset]);
    expect(parseRackPreset(JSON.parse(JSON.stringify(back[0])))).toEqual(preset);
    const inv = await buildInventory(memoryKV({ [RACK_PRESETS_KEY]: kv.data.get(RACK_PRESETS_KEY)! }));
    expect(inv.byId.get('section:presets/rack-presets')?.label).toBe('Racks');
    expect(inv.byId.get('rpre:rp1')?.detail).toBe('Juno-60 · 2 effects · 2 controls');
    deleteRackPreset('rp1', kv);
    expect(loadRackPresets(kv)).toEqual([]);
  });
});
