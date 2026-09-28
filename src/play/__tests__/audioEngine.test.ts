/**
 * The Audio engine's web side (docs/audio-engine.md): the record (racks,
 * slots, targets, parsing), the protocol with the desktop engine (frames,
 * parameters, MIDI bytes), the host reconciling the record into engine
 * commands (with a fake Tauri bridge: nothing is heard), MIDI routing and
 * notes through takes, mapped parameters, readers on a rack, the Plugins
 * setting, Pro gates, and the Library bits (sounds in use).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  const store = new Map<string, string>();
  g.localStorage = {
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
  return store;
});

import {
  AE_INST, AE_PAD_BASE_NOTE, auPropId, auTarget, auTargetExists, controlsKeptFor, engineWithoutPlugins, fourCC, fourCCText, moveEffect, newRack,
  parseAudioEngine, parseAuTarget, patchSlot, rackHears, readAuValue, unitKey, zoneForNote, zonesFor, type AeRack, type PlayAudioEngine,
} from '../../types/playAudioEngine';
import { emptyPlayRecord, parsePlayRecord, parsePropTarget, type PlayRecord } from '../../types/play';
import { allNotesOff, decodeFrame, formatParam, midiEventBytes, parseParamList, soundExt, FRAME_DB_FLOOR } from '../../lib/audioEngineProtocol';
import { audioEngineHost, parseEnginePrefs, useEngineUi, RACK_ACT_PREFIX } from '../../lib/audioEngineHost';
import {
  DEFAULT_PLUGIN_PREFS, clearNewTags, enabledUnits, matchUnit, mergeScan, parsePluginPrefs, parseUnits, pluginEnabled, setPluginsEnabled, sortUnits, type AuUnitInfo,
} from '../../lib/pluginSettings';
import { engineSound, engineRackOfInput, engineReaderInput } from '../../lib/engineSound';
import { audioReaderBank } from '../../lib/audioReaderBank';
import { readerInputOptions } from '../../components/play/readersPanelUi';
import { playableForPlan, proOnlyParts } from '../planGates';
import { rackFromPads, withEngine } from '../../components/play/engine/engineOps';
import { readControlValue, controlExists } from '../playControls';
import { describeSetting } from '../../files/appSettings';
import { countVideoRefs, videoUses } from '../../lib/videoUsage';
import { usePlan } from '../../lib/plan';
import { sidebarView } from '../../components/play/playSplit';

const DLS = { type: fourCC('aumu'), subtype: fourCC('dls '), manufacturer: fourCC('appl'), name: 'DLSMusicDevice', vendor: 'Apple' };
const DELAY = { type: fourCC('aufx'), subtype: fourCC('dely'), manufacturer: fourCC('appl'), name: 'AUDelay', vendor: 'Apple' };
const LOWPASS = { type: fourCC('aufx'), subtype: fourCC('lpas'), manufacturer: fourCC('appl'), name: 'AULowpass', vendor: 'Apple' };

function rack(over: Partial<AeRack> = {}): AeRack {
  return { ...newRack('rk_a', []), instrument: { id: AE_INST, kind: 'au', unit: DLS }, effects: [{ id: 'fx_d', kind: 'au', unit: DELAY }], ...over };
}

// ── The record ──────────────────────────────────────────────────────────────

describe('four-char codes and targets', () => {
  it('round-trips four-char codes', () => {
    expect(fourCC('aumu')).toBe(0x61756d75);
    expect(fourCCText(fourCC('dls '))).toBe('dls ');
    expect(fourCCText(0x01020304)).toBe('????');
    expect(unitKey(DLS)).toBe('aumu/dls /appl');
  });

  it('parses au targets and gives the mapping engine a prop id', () => {
    const t = auTarget('rk_a', 'fx_d', '12');
    expect(t).toBe('au:rk_a:fx_d::12');
    expect(parseAuTarget(t)).toEqual({ rackId: 'rk_a', slotId: 'fx_d', address: '12' });
    expect(parseAuTarget('au:rk_a:inst::18446744073709551615')?.address).toBe('18446744073709551615');
    for (const bad of ['au:rk_a::1', 'au::inst::1', 'au:rk_a:inst::x', 'au:rk/a:inst::1', 'audiofx:master:e::mix', 'au:rk_a:inst:1']) expect(parseAuTarget(bad)).toBeNull();
    expect(parsePropTarget(t)).toEqual({ layerId: auPropId('rk_a', 'fx_d'), key: '12' });
  });

  it('reads values the record keeps, only for slots it has', () => {
    const ae: PlayAudioEngine = { racks: [rack({ effects: [{ id: 'fx_d', kind: 'au', unit: DELAY, params: { 3: 0.25 } }] })] };
    expect(readAuValue(ae, 'au:rk_a:fx_d::3')).toBe(0.25);
    expect(readAuValue(ae, 'au:rk_a:fx_d::4')).toBeUndefined();
    expect(auTargetExists(ae, 'au:rk_a:fx_d::4')).toBe(true);
    expect(auTargetExists(ae, 'au:rk_a:fx_gone::4')).toBe(false);
    expect(auTargetExists(ae, 'au:rk_b:inst::4')).toBe(false);
    // The sample player has no plug-in parameters.
    expect(auTargetExists({ racks: [rack({ instrument: { id: AE_INST, kind: 'sampler', zones: [] } })] }, 'au:rk_a:inst::1')).toBe(false);
  });
});

describe('parsing', () => {
  it('keeps what it can read, drops the rest', () => {
    const ae = parseAudioEngine({
      racks: [
        { id: 'rk_a', name: 'Keys', instrument: { kind: 'au', unit: DLS, params: { 1: 0.5, x: 2, 2: 'no' }, state: 'QUJD' }, effects: [{ id: 'fx_d', kind: 'au', unit: DELAY, bypass: true }, { id: 'fx_d', kind: 'au', unit: LOWPASS }, { id: 'fx_s', kind: 'sampler' }, { id: 'inst', kind: 'au', unit: DELAY }], keyboard: false, midi: 'Launchkey', channel: 3, volume: 5, mute: true, pads: 'layer_1' },
        { id: 'rk_a', name: 'Duplicate' },
        { id: 'bad id', name: 'Bad' },
        { id: 'rk_b', instrument: { kind: 'sampler', zones: [{ sampleId: 'snd_1', name: 'Kick', lo: 40, hi: 36, root: 36, gain: 9 }, { sampleId: '../x', lo: 1 }] } },
      ],
    })!;
    expect(ae.racks.map(r => r.id)).toEqual(['rk_a', 'rk_b']);
    const a = ae.racks[0];
    expect(a.instrument).toEqual({ id: AE_INST, kind: 'au', unit: DLS, params: { 1: 0.5 }, state: 'QUJD' });
    expect(a.effects).toEqual([{ id: 'fx_d', kind: 'au', unit: DELAY, bypass: true }]);
    expect([a.keyboard, a.midi, a.channel, a.volume, a.mute, a.pads]).toEqual([false, 'Launchkey', 3, 2, true, 'layer_1']);
    expect(ae.racks[1].instrument?.zones).toEqual([{ sampleId: 'snd_1', name: 'Kick', lo: 36, hi: 40, root: 36, gain: 2 }]);
    expect(ae.racks[1].name).toBe('Rack 2');
    expect(parseAudioEngine({ racks: [] })).toBeUndefined();
    expect(parseAudioEngine('nope')).toBeUndefined();
  });

  it('keeps controls only on slots the file has', () => {
    const raw = {
      ...emptyPlayRecord(),
      controls: [
        { id: 'c1', target: 'au:rk_a:fx_d::3', kind: 'float', label: 'Delay mix', min: 0, max: 100 },
        { id: 'c2', target: 'au:rk_a:fx_gone::3', kind: 'float', label: 'Gone', min: 0, max: 1 },
      ],
      audioEngine: { racks: [rack()] },
    };
    const p = parsePlayRecord(raw);
    expect(p.controls.map(c => c.id)).toEqual(['c1']);
    expect(p.audioEngine?.racks[0].effects[0].id).toBe('fx_d');
  });
});

describe('record edits', () => {
  it('moves effects and patches slots', () => {
    const ae: PlayAudioEngine = { racks: [rack({ effects: [{ id: 'fx_1', kind: 'au', unit: DELAY }, { id: 'fx_2', kind: 'au', unit: LOWPASS }] })] };
    expect(moveEffect(ae, 'rk_a', 'fx_2', -1).racks[0].effects.map(e => e.id)).toEqual(['fx_2', 'fx_1']);
    expect(moveEffect(ae, 'rk_a', 'fx_1', -1)).toEqual(ae);
    expect(patchSlot(ae, 'rk_a', 'fx_1', { bypass: true }).racks[0].effects[0].bypass).toBe(true);
    expect(patchSlot(ae, 'rk_a', AE_INST, { params: { 4: 1 } }).racks[0].instrument?.params).toEqual({ 4: 1 });
  });

  it('removing a slot takes its controls and their mappings', () => {
    const p: PlayRecord = {
      ...emptyPlayRecord(),
      controls: [{ id: 'c1', target: 'au:rk_a:fx_d::3', kind: 'float', label: 'x', min: 0, max: 1 }, { id: 'c2', target: 'u_x', kind: 'float', label: 'y', min: 0, max: 1 }],
      mappings: [{ id: 'm1', controlId: 'c1' }, { id: 'm2', controlId: 'c2' }] as unknown as PlayRecord['mappings'],
      audioEngine: { racks: [rack()] },
    };
    const out = withEngine(p, { racks: [rack({ effects: [] })] });
    expect(out.controls.map(c => c.id)).toEqual(['c2']);
    expect(out.mappings.map(m => m.id)).toEqual(['m2']);
    expect(withEngine(p, { racks: [] }).audioEngine).toBeUndefined();
    expect(controlsKeptFor(p.controls, undefined).map(c => c.id)).toEqual(['c2']);
  });

  it('names new racks after the ones there', () => {
    expect(newRack('rk_1', []).name).toBe('Rack 1');
    expect(newRack('rk_3', [{ ...newRack('a', []), name: 'Rack 2' }]).name).toBe('Rack 3');
  });

  it('makes zones and finds the one a note plays', () => {
    const kit = zonesFor([{ id: 's1', name: 'Kick' }, { id: 's2', name: 'Snare' }], 'keys');
    expect(kit.map(z => [z.lo, z.hi, z.root])).toEqual([[36, 36, 36], [37, 37, 37]]);
    const pitched = zonesFor([{ id: 's3', name: 'Pad' }, { id: 's4', name: 'x' }], 'pitched');
    expect(pitched).toEqual([{ sampleId: 's3', name: 'Pad', lo: 0, hi: 127, root: 60, gain: 1 }]);
    // The last zone covering a note wins (a drum key over a pitched range).
    const all = [...pitched, ...kit];
    expect(zoneForNote(all, 36)?.sampleId).toBe('s1');
    expect(zoneForNote(all, 60)?.sampleId).toBe('s3');
    expect(zoneForNote(kit, 50)).toBeUndefined();
  });

  it('makes a rack from drum pads that follows them', () => {
    const layer = { id: 'layer_p', label: 'Drums', pads: [{ sampleId: 'snd_k', name: '', fileName: 'kick.wav' }, { sampleId: '' }, { sampleId: 'snd_s', name: 'Snare', fileName: 's.wav' }] } as never;
    const r = rackFromPads('rk_p', layer, []);
    expect(r.pads).toBe('layer_p');
    expect(r.midi).toBe('off');
    expect(r.keyboard).toBe(false);
    expect(r.instrument?.zones?.map(z => [z.sampleId, z.lo, z.name])).toEqual([['snd_k', AE_PAD_BASE_NOTE, 'kick.wav'], ['snd_s', AE_PAD_BASE_NOTE + 2, 'Snare']]);
  });

  it('routes MIDI by device and channel', () => {
    const r = { keyboard: true, midi: '', channel: 0 };
    expect(rackHears(r, '', 1)).toBe(true);
    expect(rackHears(r, 'Launchkey', 5)).toBe(true);
    expect(rackHears({ ...r, keyboard: false }, '', 1)).toBe(false);
    expect(rackHears({ ...r, midi: 'off' }, 'Launchkey', 1)).toBe(false);
    expect(rackHears({ ...r, midi: 'Push' }, 'Launchkey', 1)).toBe(false);
    expect(rackHears({ ...r, midi: 'Push' }, 'Push', 1)).toBe(true);
    expect(rackHears({ ...r, channel: 2 }, 'Push', 1)).toBe(false);
  });
});

// ── The protocol ────────────────────────────────────────────────────────────

describe('protocol', () => {
  const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

  it('decodes frames the way analysis.rs packs them', () => {
    const f = decodeFrame({ rack: 'rk_a', sampleRate: 44100, bins: b64([0, 100, 255]), wave: b64([128, 255, 1]), rms: 0.2, peak: 0.9 }, 1000)!;
    expect([...f.freq]).toEqual([FRAME_DB_FLOOR, -80, -2.5]);
    expect([...f.wave].map(v => Math.round(v * 1000) / 1000)).toEqual([0, 1, -1]);
    expect([f.sampleRate, f.rms, f.peak, f.at]).toEqual([44100, 0.2, 0.9, 1000]);
    // Decoding into the last frame reuses its arrays.
    const again = decodeFrame({ rack: 'rk_a', sampleRate: NaN, bins: b64([2, 2, 2]), wave: b64([128, 128, 128]), rms: NaN, peak: 0 }, 2000, f)!;
    expect(again.freq).toBe(f.freq);
    expect(again.sampleRate).toBe(48000);
    expect(again.rms).toBe(0);
    expect(decodeFrame({ rack: 'x', sampleRate: 1, bins: '!!!', wave: '', rms: 0, peak: 0 }, 0)).toBeNull();
  });

  it('turns MIDI events into bytes', () => {
    expect(midiEventBytes({ kind: 'noteOn', channel: 2, note: 60, velocity: 100 })).toEqual([0x91, 60, 100]);
    expect(midiEventBytes({ kind: 'noteOn', channel: 1, note: 60, velocity: 0 })).toEqual([0x90, 60, 1]);
    expect(midiEventBytes({ kind: 'noteOff', channel: 16, note: 61 })).toEqual([0x8f, 61, 0]);
    expect(midiEventBytes({ kind: 'cc', channel: 1, cc: 74, value: 127 })).toEqual([0xb0, 74, 127]);
    expect(midiEventBytes({ kind: 'bend', channel: 1, value: 0 })).toEqual([0xe0, 0, 64]);
    expect(midiEventBytes({ kind: 'bend', channel: 1, value: 1 })).toEqual([0xe0, 127, 127]);
    expect(midiEventBytes({ kind: 'bend', channel: 1, value: -1 })).toEqual([0xe0, 0, 0]);
    expect(midiEventBytes({ kind: 'devices', inputs: [] })).toBeNull();
    expect(allNotesOff()).toHaveLength(48);
  });

  it('reads parameter lists and shows values', () => {
    const ps = parseParamList([
      { address: '0', name: 'Cutoff', min: 10, max: 22050, value: 1000, unit: 'Hz', kind: 'number', step: 0, log: true },
      { address: '1', name: 'Wave', min: 0, max: 2, value: 1, unit: '', kind: 'list', step: 1, log: false, values: ['Sine', 'Saw', 'Square'] },
      { address: 'bad', name: 'x', min: 0, max: 1, value: 0 },
      { address: '2', name: 'NaN', min: 0, max: 'x', value: 0 },
    ]);
    expect(ps.map(p => p.name)).toEqual(['Cutoff', 'Wave']);
    expect(formatParam(ps[0], 2500)).toBe('2.5 kHz');
    expect(formatParam(ps[0], 440)).toBe('440 Hz');
    expect(formatParam(ps[1], 2)).toBe('Square');
    expect(formatParam({ unit: '', kind: 'toggle', min: 0 }, 1)).toBe('On');
    expect(formatParam({ unit: 'dB', kind: 'number', min: -40 }, -6.25)).toBe('-6.25 dB');
  });

  it('names cached sound files', () => {
    expect(soundExt('audio/mpeg', 'a')).toBe('mp3');
    expect(soundExt('', 'Kick.AIFF')).toBe('aiff');
    expect(soundExt('', 'noext')).toBe('wav');
  });

  it('reads device settings', () => {
    expect(parseEnginePrefs(null)).toEqual({ output: 0, volume: 1, mute: false });
    expect(parseEnginePrefs('{"output":73,"volume":9,"mute":true}')).toEqual({ output: 73, volume: 2, mute: true });
    expect(parseEnginePrefs('{"output":-1}').output).toBe(0);
    expect(parseEnginePrefs('not json').volume).toBe(1);
  });
});

// ── The host, with a fake desktop engine ────────────────────────────────────

type Call = { cmd: string; args: Record<string, unknown> };

function fakeEngine() {
  const calls: Call[] = [];
  let listener: ((e: { payload: unknown }) => void) | null = null;
  const fail = new Set<string>();
  const invoke = vi.fn(async (cmd: string, args?: unknown, _options?: unknown) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (fail.has(cmd)) throw new Error(`${cmd} failed`);
    switch (cmd) {
      case 'ae_status': return { available: true, sampleRate: 48000 };
      case 'ae_params': return [{ address: '5', name: 'Mix', min: 0, max: 100, value: 50, unit: '%', kind: 'number', step: 0, log: false }, { address: '6', name: 'Mode', min: 0, max: 1, value: 0, unit: '', kind: 'toggle', step: 1, log: false }];
      case 'ae_sound_has': return false;
      case 'ae_outputs': return [{ id: 73, name: 'Speakers', default: true }];
      default: return null;
    }
  });
  const listen = vi.fn(async (_e: string, cb: (e: { payload: unknown }) => void) => { listener = cb; return () => { listener = null; }; });
  return { calls, invoke, listen, fail, emit: (p: unknown) => listener?.({ payload: p }), cmds: () => calls.map(c => c.cmd) };
}

describe('the host', () => {
  let eng: ReturnType<typeof fakeEngine>;
  const acts: Array<{ layerId: string; amount: number; vel: number }> = [];
  beforeEach(() => {
    audioEngineHost.resetForTests();
    eng = fakeEngine();
    acts.length = 0;
    audioEngineHost.configure({
      invoke: eng.invoke as never, listen: eng.listen as never,
      sounds: async id => ({ blob: new Blob([new Uint8Array([1, 2, 3])]), type: 'audio/wav', name: `${id}.wav` }),
      act: a => { acts.push(a); audioEngineHost.onPad(a); },
    });
    usePlan.getState().setSession({ status: 'signed-in', user: '', plan: 'pro', source: 'open' });
  });

  it('builds the racks the record has', async () => {
    const ae: PlayAudioEngine = { racks: [rack({ instrument: { id: AE_INST, kind: 'au', unit: DLS, params: { 7: 0.5 } }, effects: [{ id: 'fx_d', kind: 'au', unit: DELAY, bypass: true }, { id: 'fx_l', kind: 'au', unit: LOWPASS, state: 'QUJD' }], volume: 0.5 })] };
    audioEngineHost.frame(ae, []);
    await audioEngineHost.settled();
    expect(eng.cmds()).toEqual([
      'ae_status', 'ae_master', 'ae_set_output',
      'ae_rack_create', 'ae_set_instrument', 'ae_param_set', 'ae_params',
      'ae_effect_insert', 'ae_params', 'ae_effect_insert', 'ae_state_set', 'ae_params',
      'ae_bypass', 'ae_rack_volume',
    ]);
    const inst = eng.calls.find(c => c.cmd === 'ae_set_instrument')!;
    expect(inst.args).toEqual({ rack: 'rk_a', unit: { type: DLS.type, subtype: DLS.subtype, manufacturer: DLS.manufacturer } });
    expect(eng.calls.find(c => c.cmd === 'ae_param_set')!.args).toEqual({ rack: 'rk_a', slot: AE_INST, address: '7', value: 0.5, smooth: false });
    expect(eng.calls.filter(c => c.cmd === 'ae_effect_insert').map(c => [c.args.slot, c.args.index])).toEqual([['fx_d', 0], ['fx_l', 1]]);
    expect(useEngineUi.getState().params['rk_a/fx_d']?.map(p => p.name)).toEqual(['Mix', 'Mode']);
    expect(useEngineUi.getState().status).toMatchObject({ mode: 'native', ready: true });

    // Nothing changed: nothing sent.
    eng.calls.length = 0;
    audioEngineHost.frame({ racks: [...ae.racks] }, []);
    await audioEngineHost.settled();
    expect(eng.cmds()).toEqual([]);

    // Reorder, bypass off, a new parameter value, remove one.
    const r0 = ae.racks[0];
    audioEngineHost.frame({ racks: [{ ...r0, effects: [{ ...r0.effects[1], params: { 2: 9 } }, { ...r0.effects[0], bypass: false }] }] }, []);
    await audioEngineHost.settled();
    expect(eng.cmds()).toEqual(['ae_effect_move', 'ae_param_set', 'ae_bypass']);
    expect(eng.calls[0].args).toEqual({ rack: 'rk_a', slot: 'fx_l', index: 0 });

    eng.calls.length = 0;
    audioEngineHost.frame({ racks: [] }, []);
    await audioEngineHost.settled();
    expect(eng.cmds()).toEqual(['ae_rack_remove']);
  });

  it('shows a load failure on the slot, and tries again when asked', async () => {
    eng.fail.add('ae_effect_insert');
    const ae: PlayAudioEngine = { racks: [rack()] };
    audioEngineHost.frame(ae, []);
    await audioEngineHost.settled();
    expect(useEngineUi.getState().errors['rk_a/fx_d']).toMatch(/failed/);
    // Not tried again on every change.
    eng.calls.length = 0;
    audioEngineHost.frame({ racks: [{ ...ae.racks[0], volume: 0.9 }] }, []);
    await audioEngineHost.settled();
    expect(eng.cmds()).toEqual(['ae_rack_volume']);
    eng.fail.clear();
    audioEngineHost.retry('rk_a', 'fx_d');
    await audioEngineHost.settled();
    expect(eng.cmds()).toContain('ae_effect_insert');
    expect(useEngineUi.getState().errors['rk_a/fx_d']).toBeUndefined();
  });

  it('caches Library sounds for the sample player', async () => {
    const ae: PlayAudioEngine = { racks: [rack({ instrument: { id: AE_INST, kind: 'sampler', zones: zonesFor([{ id: 'snd_1', name: 'Kick' }], 'keys') }, effects: [] })] };
    audioEngineHost.frame(ae, []);
    await audioEngineHost.settled();
    expect(eng.cmds()).toEqual(['ae_status', 'ae_master', 'ae_set_output', 'ae_rack_create', 'ae_set_sampler', 'ae_sound_has', 'ae_sound_put', 'ae_sampler_zone']);
    const put = (eng.invoke.mock.calls as unknown as unknown[][]).find(c => c[0] === 'ae_sound_put')!;
    expect(put[1]).toBeInstanceOf(Uint8Array);
    expect(put[2]).toEqual({ headers: { 'x-sound-id': 'snd_1', 'x-sound-ext': 'wav' } });
    expect(eng.calls.find(c => c.cmd === 'ae_sampler_zone')!.args).toEqual({ rack: 'rk_a', index: 0, sound: 'snd_1', lo: 36, hi: 36, root: 36, gain: 1 });
  });

  it('leaves Audio Units out without Pro plugins, and everything out on Free', async () => {
    usePlan.getState().setSession({ status: 'signed-in', user: '', plan: 'free', source: 'open' });
    audioEngineHost.frame({ racks: [rack()] }, []);
    await audioEngineHost.settled();
    expect(eng.cmds()).toEqual([]);
    const p: PlayRecord = { ...emptyPlayRecord(), audioEngine: { racks: [rack()] } };
    expect(playableForPlan(p, 'free').audioEngine).toBeUndefined();
    expect(proOnlyParts(p, 'free')).toContain('1 Audio engine rack');
    expect(playableForPlan(p, 'pro')).toBe(p);
    expect(engineWithoutPlugins(p.audioEngine!).racks[0]).toMatchObject({ instrument: null, effects: [] });
  });

  it('plays notes through a take (pad actions on ae:<rack>), CC straight to the rack', async () => {
    const ae: PlayAudioEngine = { racks: [rack({ effects: [] })] };
    audioEngineHost.frame(ae, []);
    await audioEngineHost.settled();
    eng.calls.length = 0;
    audioEngineHost.input('rk_a', [0x90, 60, 127]);
    audioEngineHost.input('rk_a', [0x80, 60, 0]);
    audioEngineHost.input('rk_a', [0xb0, 1, 64]);
    expect(acts).toEqual([
      { do: 'pad', layerId: `${RACK_ACT_PREFIX}rk_a`, amount: 61, vel: 1 },
      { do: 'pad', layerId: `${RACK_ACT_PREFIX}rk_a`, amount: 61, vel: 0 },
    ]);
    expect(eng.calls.map(c => c.args.bytes)).toEqual([[0x90, 60, 127], [0x80, 60, 0], [0xb0, 1, 64]]);
    // A take playing a note back comes through the same way.
    eng.calls.length = 0;
    audioEngineHost.onPad({ layerId: 'ae:rk_a', amount: 65, vel: 0.5 });
    expect(eng.calls[0].args).toEqual({ rack: 'rk_a', bytes: [0x90, 64, 64] });
  });

  it('follows a drum pad layer, and lets go of held notes when a rack is re-routed', async () => {
    audioEngineHost.frame({ racks: [rack({ effects: [], pads: 'layer_p' })] }, []);
    await audioEngineHost.settled();
    eng.calls.length = 0;
    audioEngineHost.onPad({ layerId: 'layer_p', amount: 3, vel: 1 });
    expect(eng.calls[0].args).toEqual({ rack: 'rk_a', bytes: [0x90, AE_PAD_BASE_NOTE + 2, 127] });
    audioEngineHost.releaseHeld('rk_a');
    expect(eng.calls[1].args.bytes).toEqual(allNotesOff());
    // Nothing held: nothing sent.
    audioEngineHost.releaseHeld('rk_a');
    expect(eng.calls).toHaveLength(2);
  });

  it('sends mapped parameters when they change, gliding numbers, and puts the value back when let go', async () => {
    const ae: PlayAudioEngine = { racks: [rack({ effects: [{ id: 'fx_d', kind: 'au', unit: DELAY, params: { 5: 10 } }] })] };
    const controls = [{ target: 'au:rk_a:fx_d::5' }, { target: 'au:rk_a:fx_d::6' }];
    audioEngineHost.frame(ae, controls);
    await audioEngineHost.settled();
    eng.calls.length = 0;
    let driven: Record<string, number> = { '5': 42, '6': 1 };
    const valueOf = (id: string, key: string, base: number) => (id === 'au:rk_a:fx_d' && key in driven ? driven[key] : base);
    audioEngineHost.frame(ae, controls, valueOf);
    expect(eng.calls.map(c => c.args)).toEqual([
      { rack: 'rk_a', slot: 'fx_d', address: '5', value: 42, smooth: true },
      { rack: 'rk_a', slot: 'fx_d', address: '6', value: 1, smooth: false },
    ]);
    audioEngineHost.frame(ae, controls, valueOf);
    expect(eng.calls).toHaveLength(2);
    driven = {};
    audioEngineHost.frame(ae, controls, valueOf);
    expect(eng.calls.slice(2).map(c => c.args)).toEqual([{ rack: 'rk_a', slot: 'fx_d', address: '5', value: 10, smooth: true }]);
  });

  it('gives readers the rack\'s spectrum from its frames', async () => {
    audioEngineHost.frame({ racks: [rack({ effects: [] })] }, []);
    await audioEngineHost.settled();
    expect(engineSound.has('rk_a')).toBe(true);
    expect(engineSound.spectrum('rk_a')).toBeNull();
    const bins = new Array(1024).fill(0);
    bins[20] = 200; // −30 dB near 470 Hz
    eng.emit({ rack: 'rk_a', sampleRate: 48000, bins: btoa(String.fromCharCode(...bins)), wave: btoa('\x80'), rms: 0.1, peak: 0.3 });
    const s = engineSound.spectrum('rk_a')!;
    expect(s.freq[20]).toBe(-30);
    audioReaderBank.setConfig({ input: engineReaderInput('rk_a'), readers: [{ id: 'r1', name: 'x', hz: 470, width: 1 / 3, gain: 20, attack: 0, release: 0, colour: [1, 1, 1] }] });
    expect(audioReaderBank.inputState()).toBe('engine');
    expect(audioReaderBank.spectrum()?.freq[20]).toBe(-30);
    audioReaderBank.update();
    expect(audioReaderBank.value('r1')).toBeGreaterThan(0.5);
    audioReaderBank.setConfig({ input: engineReaderInput('rk_gone'), readers: [] });
    expect(audioReaderBank.inputState()).toBe('engine-missing');
    audioReaderBank.setConfig(undefined);
  });

  it('lists output devices', async () => {
    await audioEngineHost.refreshOutputs();
    expect(useEngineUi.getState().outputs).toEqual([{ id: 73, name: 'Speakers', default: true }]);
  });
});

// ── Readers, controls, the Library, settings ────────────────────────────────

describe('around the app', () => {
  it('offers racks as reader inputs, and names a gone one', () => {
    const opts = readerInputOptions('', [], [], [{ id: 'rk_a', name: 'Keys' }]);
    expect(opts.find(o => o.value === 'engine:rk_a')?.label).toBe('Audio engine · Keys');
    expect(readerInputOptions('engine:rk_x', [], [], []).some(o => o.label.includes('a rack no longer'))).toBe(true);
    expect(engineRackOfInput('engine:rk_a')).toBe('rk_a');
    expect(engineRackOfInput('pads:x')).toBeNull();
  });

  it('reads a parameter control\'s value from the record', () => {
    const p: PlayRecord = { ...emptyPlayRecord(), audioEngine: { racks: [rack({ effects: [{ id: 'fx_d', kind: 'au', unit: DELAY, params: { 5: 33 } }] })] } };
    expect(readControlValue([], 'au:rk_a:fx_d::5', p)).toBe(33);
    expect(readControlValue([], 'au:rk_a:fx_d::9', p)).toBe(0);
    expect(readControlValue([], 'au:rk_a:fx_x::9', p)).toBeUndefined();
    expect(controlExists([], { id: 'c', target: 'au:rk_a:fx_d::5', kind: 'float', label: '', min: 0, max: 1 }, p)).toBe(true);
  });

  it('counts sample player sounds as used', () => {
    const saved = JSON.stringify({ play: { audioEngine: { racks: [{ instrument: { zones: [{ sampleId: 'snd_1' }] } }] } } });
    expect(countVideoRefs(saved, 'snd_1')).toBe(1);
    const kv = { keys: () => ['shader-studio:Song'], get: () => saved };
    const uses = videoUses(['snd_1', 'snd_2'], kv, { name: null, layers: [], sounds: ['snd_2'] });
    expect(uses.get('snd_1')?.[0]).toMatchObject({ kind: 'graph', label: 'Song' });
    expect(uses.get('snd_2')?.[0]).toMatchObject({ kind: 'open' });
  });

  it('names its settings in Files → App settings', () => {
    expect(describeSetting('shader-studio:audio:plugins')).toMatchObject({ label: 'Audio Unit plugins', category: 'devices' });
    expect(describeSetting('shader-studio:audio:engine').category).toBe('devices');
  });

  it('has an Engine section in the sidebar and the split panel', () => {
    expect(sidebarView('engine', null)).toEqual({ tab: 'engine', tabs: ['controls', 'layers', 'finish', 'engine'], drawer: true });
    expect(sidebarView('engine', 'engine').tabs).not.toContain('engine');
  });
});

describe('the Plugins setting', () => {
  const unit = (code: string, kind: AuUnitInfo['kind'] = 'effect', name = code, vendor = 'Apple'): AuUnitInfo => ({ kind, type: 1, subtype: 2, manufacturer: 3, code, name, vendor, version: '1.0', v3: false, customView: false });
  beforeEach(() => store.clear());

  it('reads what it can', () => {
    expect(parsePluginPrefs(null)).toEqual(DEFAULT_PLUGIN_PREFS);
    expect(parsePluginPrefs('{"units":{"a":{"on":false,"new":true},"b":{}},"newOff":true,"scanned":5}')).toEqual({ units: { a: { on: false, new: true }, b: { on: true } }, newOff: true, scanned: 5 });
    expect(parsePluginPrefs('nope')).toEqual(DEFAULT_PLUGIN_PREFS);
  });

  it('adds units a scan finds: nothing New the first time, New after, off when new ones start off', () => {
    const first = mergeScan(DEFAULT_PLUGIN_PREFS, [unit('a'), unit('b')], 100);
    expect(first.added).toEqual([]);
    expect(first.prefs.units).toEqual({ a: { on: true }, b: { on: true } });
    const second = mergeScan(first.prefs, [unit('a'), unit('b'), unit('c')], 200);
    expect(second.added).toEqual(['c']);
    expect(second.prefs.units.c).toEqual({ on: true, new: true });
    const off = mergeScan({ ...second.prefs, newOff: true }, [unit('d')], 300);
    expect(off.prefs.units.d).toEqual({ on: false, new: true });
    expect(clearNewTags(off.prefs).units.d).toEqual({ on: false });
    // Not seen yet: follows newOff.
    expect(pluginEnabled({ ...DEFAULT_PLUGIN_PREFS, newOff: true }, 'zz')).toBe(false);
    expect(pluginEnabled(DEFAULT_PLUGIN_PREFS, 'zz')).toBe(true);
  });

  it('switches units, filters the pickers, searches and sorts', () => {
    const units = [unit('fx1', 'effect', 'AUDelay'), unit('in1', 'instrument', 'DLSMusicDevice'), unit('fx2', 'effect', 'Valhalla', 'Valhalla DSP')];
    const prefs = setPluginsEnabled(DEFAULT_PLUGIN_PREFS, ['fx1'], false);
    expect(enabledUnits(units, prefs).map(u => u.code)).toEqual(['in1', 'fx2']);
    expect(units.filter(u => matchUnit(u, 'valhalla')).map(u => u.code)).toEqual(['fx2']);
    expect(units.filter(u => matchUnit(u, 'instrument')).map(u => u.code)).toEqual(['in1']);
    expect(sortUnits(units).map(u => u.code)).toEqual(['in1', 'fx1', 'fx2']);
  });

  it('reads the engine\'s unit list', () => {
    const raw = [
      { kind: 'instrument', type: 1635085685, subtype: 1684828960, manufacturer: 1634758764, code: 'aumu/dls /appl', name: 'DLSMusicDevice', vendor: 'Apple', version: '1.7.0', v3: false, customView: true },
      { kind: 'generator', type: 1, subtype: 1, manufacturer: 1, code: 'x' },
      { kind: 'effect', type: -1, subtype: 1, manufacturer: 1, code: 'y' },
      'junk',
    ];
    const units = parseUnits(raw);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ name: 'DLSMusicDevice', customView: true });
  });
});
